package desktop

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/freebeamer/core/pkg/relayapi"
	"github.com/freebeamer/core/pkg/telemetry"
	"github.com/freebeamer/core/pkg/types"
)

// fakeEmitter records every emitted status/batch, so LiveData's
// connection/batching logic is verifiable without a running Wails
// frontend — mirrors FileDialog's fakeDialog test double.
type fakeEmitter struct {
	mu       sync.Mutex
	statuses []types.LiveConnectionStatus
	batches  []types.LiveBatch
}

func (f *fakeEmitter) EmitStatus(s types.LiveConnectionStatus) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.statuses = append(f.statuses, s)
}

func (f *fakeEmitter) EmitBatch(b types.LiveBatch) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.batches = append(f.batches, b)
}

func (f *fakeEmitter) Statuses() []types.LiveConnectionStatus {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]types.LiveConnectionStatus{}, f.statuses...)
}

func (f *fakeEmitter) Batches() []types.LiveBatch {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]types.LiveBatch{}, f.batches...)
}

func (f *fakeEmitter) AllSamples() []types.LiveSample {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []types.LiveSample
	for _, b := range f.batches {
		out = append(out, b.Samples...)
	}
	return out
}

func newLiveDataForTest() (*LiveData, *fakeEmitter) {
	l := NewLiveData()
	emitter := &fakeEmitter{}
	l.SetEmitter(emitter)
	return l, emitter
}

// postSample POSTs a v2 sample directly to the relay's /v1/telemetry,
// bypassing pkg/telemetry.Uploader/UploaderService's queue/spool/retry
// machinery — this test only needs precise control over exactly what's
// sent and when, not Phase 3's reliable-delivery behavior (already
// covered by pkg/telemetry's own tests).
func postSample(t *testing.T, relayURL, apiKey string, sample telemetry.Sample) {
	t.Helper()
	data, err := json.Marshal(sample)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, relayURL+"/v1/telemetry", bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("post sample: status %d", resp.StatusCode)
	}
}

func v2Sample(deviceID string, session telemetry.Session, sequence uint64, values map[string]float64) telemetry.Sample {
	seq := sequence
	return telemetry.Sample{
		Version:   telemetry.ContractVersion,
		Session:   &session,
		Sequence:  &seq,
		DeviceID:  deviceID,
		Timestamp: time.Now().UTC(),
		Values:    values,
	}
}

func waitFor(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !cond() {
		t.Fatal("condition not met within timeout")
	}
}

func TestLiveDataEndToEndKnownValues(t *testing.T) {
	server, apiKey := newFakeRelayServer(t)
	l, emitter := newLiveDataForTest()
	t.Cleanup(l.Disconnect)

	if err := l.Connect(server.URL, fakeRelayAdminToken, "client-1"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 2*time.Second, func() bool {
		for _, s := range emitter.Statuses() {
			if s.State == "connected" {
				return true
			}
		}
		return false
	})

	session, err := telemetry.NewSession()
	if err != nil {
		t.Fatal(err)
	}
	postSample(t, server.URL, apiKey, v2Sample("device-1", session, 0, map[string]float64{"RPM": 1234}))
	postSample(t, server.URL, apiKey, v2Sample("device-1", session, 1, map[string]float64{"RPM": 5678}))

	waitFor(t, 2*time.Second, func() bool { return len(emitter.AllSamples()) >= 2 })

	samples := emitter.AllSamples()
	if len(samples) != 2 {
		t.Fatalf("got %d samples, want 2: %+v", len(samples), samples)
	}
	if samples[0].Values["RPM"] != 1234 || samples[1].Values["RPM"] != 5678 {
		t.Fatalf("values wrong: %+v", samples)
	}
	if samples[0].DeviceID != "device-1" || samples[0].SessionID != session.ID {
		t.Fatalf("identity wrong: %+v", samples[0])
	}
}

func TestLiveDataAuthFailureIsTerminal(t *testing.T) {
	server, _ := newFakeRelayServer(t)
	l, emitter := newLiveDataForTest()
	t.Cleanup(l.Disconnect)

	if err := l.Connect(server.URL, "wrong-token", "client-1"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 2*time.Second, func() bool {
		for _, s := range emitter.Statuses() {
			if s.State == "error" {
				return true
			}
		}
		return false
	})

	// Give any (incorrect) retry a moment to happen, then confirm it didn't.
	time.Sleep(200 * time.Millisecond)
	statuses := emitter.Statuses()
	last := statuses[len(statuses)-1]
	if last.State != "error" || last.Retryable {
		t.Fatalf("last status = %+v, want a terminal, non-retryable error", last)
	}
	for _, s := range statuses {
		if s.State == "backingOff" || s.State == "reconnecting" {
			t.Fatalf("a 401 must not be retried, but saw state %q", s.State)
		}
	}
}

func TestLiveDataReconnectsWithBackoff(t *testing.T) {
	server, apiKey := newFakeRelayServer(t)
	failing := httptest.NewServer(failNUpgradesHandler(server.Config.Handler, 2))
	t.Cleanup(failing.Close)
	_ = apiKey

	l, emitter := newLiveDataForTest()
	t.Cleanup(l.Disconnect)

	started := time.Now()
	if err := l.Connect(failing.URL, fakeRelayAdminToken, "client-1"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 5*time.Second, func() bool {
		for _, s := range emitter.Statuses() {
			if s.State == "connected" {
				return true
			}
		}
		return false
	})
	elapsed := time.Since(started)
	// Two failures before success: expect at least ~1s (first backoff) +
	// ~2s (second backoff) minus jitter, i.e. comfortably over 2s, and
	// nowhere near the 60s cap.
	if elapsed < 2*time.Second {
		t.Fatalf("connected too fast (%v) for 2 injected failures with 1s/2s backoff", elapsed)
	}
	if elapsed > 10*time.Second {
		t.Fatalf("connected too slow (%v); backoff may not be capped correctly", elapsed)
	}

	sawBackingOff := false
	for _, s := range emitter.Statuses() {
		if s.State == "backingOff" {
			sawBackingOff = true
		}
	}
	if !sawBackingOff {
		t.Fatal("expected at least one backingOff status before connecting")
	}
}

func TestLiveDataSetDeviceSessionRejectsStaleBatch(t *testing.T) {
	server, apiKey := newFakeRelayServer(t)
	l, emitter := newLiveDataForTest()
	t.Cleanup(l.Disconnect)

	if err := l.Connect(server.URL, fakeRelayAdminToken, "client-1"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 2*time.Second, func() bool {
		for _, s := range emitter.Statuses() {
			if s.State == "connected" {
				return true
			}
		}
		return false
	})

	session, err := telemetry.NewSession()
	if err != nil {
		t.Fatal(err)
	}
	postSample(t, server.URL, apiKey, v2Sample("device-a", session, 0, map[string]float64{"RPM": 1}))
	waitFor(t, 2*time.Second, func() bool { return len(emitter.AllSamples()) >= 1 })

	// Selecting a source with no matching data must filter everything
	// out of subsequent batches, and must never re-show what already
	// arrived under the old (unfiltered) scope.
	l.SetDeviceSession("device-that-never-sends", "no-such-session")
	postSample(t, server.URL, apiKey, v2Sample("device-a", session, 1, map[string]float64{"RPM": 2}))
	time.Sleep(500 * time.Millisecond) // let at least one flush tick pass

	for _, b := range emitter.Batches() {
		for _, s := range b.Samples {
			if s.DeviceID == "device-a" && s.Sequence == 1 {
				t.Fatalf("sample delivered after an unrelated source was selected: %+v", s)
			}
		}
	}
}

func TestLiveDataSelectionKeepsStreamAlive(t *testing.T) {
	server, apiKey := newFakeRelayServer(t)
	l, emitter := newLiveDataForTest()
	t.Cleanup(l.Disconnect)
	if err := l.Connect(server.URL, fakeRelayAdminToken, "client-1"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 2*time.Second, func() bool { return l.Status().State == "connected" })
	session, err := telemetry.NewSession()
	if err != nil {
		t.Fatal(err)
	}
	postSample(t, server.URL, apiKey, v2Sample("device-a", session, 0, map[string]float64{"RPM": 1000}))
	waitFor(t, 2*time.Second, func() bool { return len(emitter.AllSamples()) == 1 })
	previous := l.Status().Generation
	l.SetDeviceSession("device-a", session.ID)
	selected := l.Status().Generation
	if selected <= previous {
		t.Fatal("selection must advance display generation")
	}
	for seq := uint64(1); seq <= 3; seq++ {
		postSample(t, server.URL, apiKey, v2Sample("device-a", session, seq, map[string]float64{"RPM": float64(1000 + seq)}))
		waitFor(t, 2*time.Second, func() bool {
			for _, batch := range emitter.Batches() {
				for _, sample := range batch.Samples {
					if sample.Sequence == seq && batch.Generation == selected {
						return true
					}
				}
			}
			return false
		})
	}
	if l.Status().State != "connected" {
		t.Fatal("selection stopped connection")
	}
}

func TestLiveDataIngestDedupesAndDetectsGaps(t *testing.T) {
	l, _ := newLiveDataForTest()
	l.mu.Lock()
	l.generation = 1
	l.sources = map[sourceKey]struct{}{}
	l.seenSet = map[sampleKey]struct{}{}
	l.lastSeq = map[string]uint64{}
	l.mu.Unlock()

	seq := func(n uint64) *uint64 { return &n }
	session := &telemetry.Session{ID: "session-1"}

	l.ingest(relayapi.LiveEnvelope{DeviceID: "d1", Session: session, Sequence: seq(0), Values: map[string]float64{"RPM": 1}})
	l.ingest(relayapi.LiveEnvelope{DeviceID: "d1", Session: session, Sequence: seq(0), Values: map[string]float64{"RPM": 1}}) // exact duplicate
	l.ingest(relayapi.LiveEnvelope{DeviceID: "d1", Session: session, Sequence: seq(3), Values: map[string]float64{"RPM": 4}}) // skips 1,2

	l.mu.Lock()
	pending := append([]types.LiveSample{}, l.pending...)
	l.mu.Unlock()

	if len(pending) != 2 {
		t.Fatalf("got %d pending samples, want 2 (duplicate must be dropped): %+v", len(pending), pending)
	}
	if pending[0].Sequence != 0 || pending[0].GapBefore != 0 {
		t.Fatalf("first sample wrong: %+v", pending[0])
	}
	if pending[1].Sequence != 3 || pending[1].GapBefore != 2 {
		t.Fatalf("second sample should report a gap of 2 (sequences 1,2 missing): %+v", pending[1])
	}
}

func TestLiveDataDedupWindowStaysBounded(t *testing.T) {
	l, _ := newLiveDataForTest()
	l.mu.Lock()
	l.generation = 1
	l.sources = map[sourceKey]struct{}{}
	l.seenSet = map[sampleKey]struct{}{}
	l.lastSeq = map[string]uint64{}
	l.mu.Unlock()

	session := &telemetry.Session{ID: "session-1"}
	for i := uint64(0); i < uint64(dedupWindowSize)*3; i++ {
		seq := i
		l.ingest(relayapi.LiveEnvelope{DeviceID: "d1", Session: session, Sequence: &seq, Values: map[string]float64{"RPM": 1}})
	}

	l.mu.Lock()
	seenLen := len(l.seen)
	seenSetLen := len(l.seenSet)
	l.mu.Unlock()

	if seenLen != dedupWindowSize || seenSetLen != dedupWindowSize {
		t.Fatalf("dedup window not bounded: len(seen)=%d len(seenSet)=%d, want %d", seenLen, seenSetLen, dedupWindowSize)
	}
}

func TestLiveDataDisconnectIsIdempotentAndPrompt(t *testing.T) {
	server, _ := newFakeRelayServer(t)
	l, emitter := newLiveDataForTest()

	if err := l.Connect(server.URL, fakeRelayAdminToken, "client-1"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 2*time.Second, func() bool {
		for _, s := range emitter.Statuses() {
			if s.State == "connected" {
				return true
			}
		}
		return false
	})

	started := time.Now()
	l.Disconnect()
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("Disconnect took %v, want prompt", elapsed)
	}
	l.Disconnect() // must not panic or hang when already disconnected

	status := l.Status()
	if status.State != "disconnected" {
		t.Fatalf("Status() = %+v, want disconnected", status)
	}
}
