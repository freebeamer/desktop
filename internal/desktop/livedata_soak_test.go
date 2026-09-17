//go:build soak

package desktop

import (
	"fmt"
	"testing"
	"time"

	"github.com/freebeamer/core/pkg/telemetry"
)

// TestSoak drives a sustained mock-producer-to-consumer stream through a
// real LiveData connection, for the "record a sustained mock streaming
// run and its resource usage" acceptance item in
// docs/live-data-and-vehicle-mapping-plan.md's Phase 4 section.
//
// Gated behind the "soak" build tag, not just testing.Short(): this
// repo's own `make test`/`go test ./...` convention (Makefile) runs
// without -short, so a Short()-only guard would silently make this
// expensive test part of every routine run. A build tag excludes the
// file from compilation entirely unless explicitly requested:
//
//	go test -tags soak ./internal/desktop/... -run TestSoak -v \
//	  -cpuprofile=/tmp/livedata-cpu.out -memprofile=/tmp/livedata-mem.out
//	go tool pprof /tmp/livedata-cpu.out
//
// This validates the Go consumer (dedup window, gap tracking, batching,
// dialLive/readConn goroutines) in isolation — it does not cover Wails
// IPC or Angular rendering overhead, which increment 4b's own manual
// full-app run is responsible for recording separately. Neither
// substitutes for the other.
func TestSoak(t *testing.T) {
	const (
		sessions       = 3
		samplesPerSess = 5000
		reportEvery    = 1000
	)

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

	started := time.Now()
	total := 0
	for s := 0; s < sessions; s++ {
		session, err := telemetry.NewSession()
		if err != nil {
			t.Fatal(err)
		}
		for seq := uint64(0); seq < samplesPerSess; seq++ {
			postSample(t, server.URL, apiKey, v2Sample("soak-device", session, seq, map[string]float64{"RPM": float64(seq)}))
			total++
			if total%reportEvery == 0 {
				t.Logf("posted %d/%d samples, %v elapsed", total, sessions*samplesPerSess, time.Since(started))
			}
		}
	}
	postDuration := time.Since(started)

	waitFor(t, 30*time.Second, func() bool { return len(emitter.AllSamples()) >= total })
	drainDuration := time.Since(started)

	// Bounded-state check: neither the dedup window nor the per-session
	// tracker should have grown proportionally to the number of samples
	// posted — that's the whole point of bounding them.
	l.mu.Lock()
	seenLen := len(l.seen)
	trackedSessions := len(l.lastSeq)
	l.mu.Unlock()
	if seenLen > dedupWindowSize {
		t.Fatalf("dedup window grew unbounded: %d entries, want <= %d", seenLen, dedupWindowSize)
	}
	if trackedSessions != sessions {
		t.Fatalf("lastSeq tracked %d sessions, want %d", trackedSessions, sessions)
	}

	t.Logf("soak run: %d samples across %d sessions; post phase %v (%.0f samples/s); fully drained after %v; final dedup window depth %d",
		total, sessions, postDuration, float64(total)/postDuration.Seconds(), drainDuration, seenLen)
	fmt.Println("record these numbers in docs/live-data-soak-test.md when run for real evidence")
}
