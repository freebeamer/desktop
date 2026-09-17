package desktop

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/freebeamer/core/pkg/relayapi"
	"github.com/freebeamer/core/pkg/telemetry"
	"github.com/freebeamer/core/pkg/types"
)

const (
	// batchFlushInterval is how often accumulated samples are coalesced
	// into one emitted types.LiveBatch, decoupling UI update frequency
	// from the (variable, unknown-to-the-desktop-app) acquisition rate.
	batchFlushInterval = 250 * time.Millisecond
	// dedupWindowSize bounds the recent (sessionID, sequence) set used to
	// drop samples that legitimately arrive in both the connect-time
	// backfill burst and the live channel (internal/relay's Hub.Subscribe
	// happens before Store.RecentSamples, so this overlap is real, not
	// hypothetical). Comfortably above the relay's own backfillLimit (50).
	dedupWindowSize = 200
)

type sourceKey struct{ deviceID, sessionID string }
type sampleKey struct {
	sessionID string
	sequence  uint64
}

type liveScope struct {
	relayURL        string
	adminToken      string
	clientID        string
	selectedDevice  string
	selectedSession string
}

// LiveData owns the desktop app's one live relay connection at a time — a
// sibling of Service, not nested inside it, since Phase 4 requires
// monitoring without a loaded calibration workspace. See
// docs/live-data-and-vehicle-mapping-plan.md's Phase 4 section for the
// full design rationale.
//
// Connect/Disconnect/SetDeviceSession are serialized against each other by
// lifecycleMu; the state fields below are additionally guarded by mu,
// which the background read-loop goroutine also touches (via ingest/flush)
// concurrently with a caller invoking one of those three methods.
type LiveData struct {
	lifecycleMu sync.Mutex

	mu                   sync.Mutex
	emitter              LiveEventEmitter
	cancel               context.CancelFunc // non-nil while a connection attempt/session is active
	done                 chan struct{}      // closed when the run() goroutine actually exits
	generation           uint64             // display scope: changes on client/device/session selection
	connectionGeneration uint64             // transport lifetime: unaffected by device/session selection
	scope                liveScope
	lastStatus           types.LiveConnectionStatus

	conn     *websocket.Conn // the currently open connection, if any; closed by the ctx-watcher on cancellation
	sessions map[sourceKey]types.BindingSession
	sources  map[sourceKey]struct{}
	seen     []sampleKey            // FIFO dedup window
	seenSet  map[sampleKey]struct{} // mirrors seen, for O(1) membership
	lastSeq  map[string]uint64      // per-session last sequence seen
	pending  []types.LiveSample     // accumulated since the last flush
}

// NewLiveData returns a LiveData with no active connection. Its event
// ticker runs for the returned value's whole lifetime; SetEmitter should
// be called once the real Wails context is available (App.startup).
func NewLiveData() *LiveData {
	l := &LiveData{emitter: noopLiveEventEmitter{}, lastStatus: types.LiveConnectionStatus{State: "disconnected"}}
	go l.runTicker()
	return l
}

// SetEmitter replaces the event sink used for all future emissions.
func (l *LiveData) SetEmitter(emitter LiveEventEmitter) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.emitter = emitter
}

// Status returns the most recently observed connection state, for an
// initial synchronous render before the first "live:status" event arrives.
func (l *LiveData) Status() types.LiveConnectionStatus {
	l.mu.Lock()
	defer l.mu.Unlock()
	status := l.lastStatus
	status.Generation = l.generation
	return status
}

// Connect starts a new live connection to relayURL scoped to clientID,
// tearing down any existing connection first. It validates its arguments
// and returns promptly; the connect attempt itself (and every subsequent
// reconnect) proceeds in the background, observable via "live:status"
// events — Connect does not block on the network.
func (l *LiveData) Connect(relayURL, adminToken, clientID string) error {
	if _, err := relayBaseURL(relayURL); err != nil {
		return err
	}
	if clientID == "" {
		return errors.New("relay: client_id is required")
	}

	l.lifecycleMu.Lock()
	defer l.lifecycleMu.Unlock()

	l.disconnectLocked()

	l.mu.Lock()
	l.generation++
	l.connectionGeneration++
	generation := l.connectionGeneration
	l.scope = liveScope{relayURL: relayURL, adminToken: adminToken, clientID: clientID}
	l.sources = map[sourceKey]struct{}{}
	l.sessions = map[sourceKey]types.BindingSession{}
	l.seen = nil
	l.seenSet = map[sampleKey]struct{}{}
	l.lastSeq = map[string]uint64{}
	l.pending = nil
	ctx, cancel := context.WithCancel(context.Background())
	l.cancel = cancel
	done := make(chan struct{})
	l.done = done
	l.mu.Unlock()

	l.setStatus(types.LiveConnectionStatus{State: "connecting", CatchingUp: true})
	go l.run(ctx, done, generation)
	return nil
}

// Disconnect tears down the active connection, if any, and waits for its
// goroutine to actually exit before returning.
func (l *LiveData) Disconnect() {
	l.lifecycleMu.Lock()
	defer l.lifecycleMu.Unlock()
	l.disconnectLocked()
	l.mu.Lock()
	l.generation++
	l.pending = nil
	l.scope = liveScope{}
	l.mu.Unlock()
	l.setStatus(types.LiveConnectionStatus{State: "disconnected"})
}

// disconnectLocked cancels and waits for any active connection's goroutine
// to exit. Caller must hold lifecycleMu (not mu — waiting on done must
// happen without mu held, since the run goroutine needs mu to update state
// on its way out).
func (l *LiveData) disconnectLocked() {
	l.mu.Lock()
	cancel := l.cancel
	done := l.done
	l.cancel = nil
	l.done = nil
	l.mu.Unlock()

	if cancel == nil {
		return
	}
	cancel()
	<-done
}

// SetDeviceSession filters the already-connected client's stream to one
// discovered (deviceID, sessionID) pair — or clears the filter if both are
// "". This does not reconnect: the relay has no subscription protocol
// below client_id, so device/session selection is client-side filtering
// of an already-flowing stream, not a relay-side resubscribe. Dedup/gap
// tracking for every discovered source keeps running regardless of
// selection.
func (l *LiveData) SetDeviceSession(deviceID, sessionID string) {
	l.lifecycleMu.Lock()
	defer l.lifecycleMu.Unlock()

	l.mu.Lock()
	l.generation++
	l.scope.selectedDevice = deviceID
	l.scope.selectedSession = sessionID
	l.pending = nil // drop anything buffered under the old scope; never show it under the new one
	l.mu.Unlock()
}

func (l *LiveData) run(ctx context.Context, done chan struct{}, generation uint64) {
	defer close(done)

	go func() {
		<-ctx.Done()
		l.mu.Lock()
		if l.conn != nil {
			l.conn.Close()
		}
		l.mu.Unlock()
	}()

	backoff := telemetry.DefaultInitialBackoff
	for {
		if ctx.Err() != nil || !l.stillCurrent(generation) {
			return
		}

		l.mu.Lock()
		scope := l.scope
		l.mu.Unlock()

		conn, err := dialLive(ctx, scope.relayURL, scope.adminToken, scope.clientID)
		if err != nil {
			if ctx.Err() != nil || !l.stillCurrent(generation) {
				return
			}
			if errors.Is(err, errInvalidAdminToken) {
				l.setStatus(types.LiveConnectionStatus{State: "error", Message: "invalid admin token", Retryable: false})
				return
			}
			until := time.Now().Add(backoff)
			l.setStatus(types.LiveConnectionStatus{State: "backingOff", Message: "cannot reach relay", Retryable: true, BackoffUntil: &until})
			if !telemetry.SleepWithJitter(ctx, backoff) {
				return
			}
			backoff = telemetry.NextBackoff(backoff)
			continue
		}

		l.mu.Lock()
		if !l.stillCurrentLocked(generation) {
			l.mu.Unlock()
			conn.Close()
			return
		}
		l.conn = conn
		l.mu.Unlock()

		backoff = telemetry.DefaultInitialBackoff
		l.setStatus(types.LiveConnectionStatus{State: "connected", CatchingUp: true})
		l.readConn(ctx, conn, generation)

		l.mu.Lock()
		l.conn = nil
		l.mu.Unlock()
		conn.Close()

		if ctx.Err() != nil || !l.stillCurrent(generation) {
			return
		}
		l.setStatus(types.LiveConnectionStatus{State: "reconnecting", Retryable: true})
	}
}

// readConn reads envelopes until the connection errors or ctx is
// cancelled. A dedicated reader goroutine feeds a channel so this
// function can select on ctx.Done() without blocking indefinitely inside
// a gorilla/websocket ReadJSON call.
func (l *LiveData) readConn(ctx context.Context, conn *websocket.Conn, generation uint64) {
	type readResult struct {
		envelope relayapi.LiveEnvelope
		err      error
	}
	results := make(chan readResult)
	go func() {
		for {
			var envelope relayapi.LiveEnvelope
			err := conn.ReadJSON(&envelope)
			select {
			case results <- readResult{envelope, err}:
			case <-ctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()

	catchingUp := true
	for {
		select {
		case <-ctx.Done():
			return
		case r := <-results:
			if r.err != nil {
				return
			}
			if !l.stillCurrent(generation) {
				return
			}
			if catchingUp && !r.envelope.Backfill {
				catchingUp = false
				l.setStatus(types.LiveConnectionStatus{State: "connected", CatchingUp: false})
			}
			l.ingest(r.envelope)
		}
	}
}

// ingest deduplicates, gap-annotates, and buffers one envelope for the
// next batch flush. Safe to call from the read loop concurrently with
// Connect/Disconnect/SetDeviceSession — all guarded by mu.
func (l *LiveData) ingest(envelope relayapi.LiveEnvelope) {
	l.mu.Lock()
	defer l.mu.Unlock()

	sessionID := ""
	var sequence uint64
	if envelope.Session != nil {
		sessionID = envelope.Session.ID
	}
	if envelope.Sequence != nil {
		sequence = *envelope.Sequence
	}

	if sessionID != "" {
		key := sampleKey{sessionID: sessionID, sequence: sequence}
		if _, dup := l.seenSet[key]; dup {
			return
		}
		l.recordSeenLocked(key)
	}

	var gapBefore uint64
	if sessionID != "" {
		last, ok := l.lastSeq[sessionID]
		if ok && sequence > last+1 {
			gapBefore = sequence - last - 1
		}
		if !ok || sequence > last {
			l.lastSeq[sessionID] = sequence
		}
	}

	l.sources[sourceKey{deviceID: envelope.DeviceID, sessionID: sessionID}] = struct{}{}
	l.rememberBindingSessionLocked(envelope)

	l.pending = append(l.pending, types.LiveSample{
		DeviceID:  envelope.DeviceID,
		SessionID: sessionID,
		Sequence:  sequence,
		Timestamp: envelope.Timestamp,
		Values:    envelope.Values,
		Backfill:  envelope.Backfill,
		GapBefore: gapBefore,
	})
}

func (l *LiveData) recordSeenLocked(key sampleKey) {
	l.seen = append(l.seen, key)
	l.seenSet[key] = struct{}{}
	if len(l.seen) > dedupWindowSize {
		oldest := l.seen[0]
		l.seen = l.seen[1:]
		delete(l.seenSet, oldest)
	}
}

// runTicker flushes accumulated samples into an emitted batch every
// batchFlushInterval, for this LiveData's whole lifetime — simpler than
// starting/stopping a ticker goroutine per connection cycle, and a no-op
// (skipped entirely) whenever there's nothing pending.
func (l *LiveData) runTicker() {
	ticker := time.NewTicker(batchFlushInterval)
	defer ticker.Stop()
	for range ticker.C {
		l.flush()
	}
}

func (l *LiveData) flush() {
	l.mu.Lock()
	if l.cancel == nil || len(l.pending) == 0 {
		l.mu.Unlock()
		return
	}
	batch := types.LiveBatch{
		Generation: l.generation,
		Samples:    filterSamples(l.pending, l.scope.selectedDevice, l.scope.selectedSession),
		Sources:    l.bindingSourcesLocked(),
	}
	l.pending = nil
	emitter := l.emitter
	l.mu.Unlock()
	emitter.EmitBatch(batch)
}

func filterSamples(samples []types.LiveSample, device, session string) []types.LiveSample {
	if device == "" && session == "" {
		return samples
	}
	out := make([]types.LiveSample, 0, len(samples))
	for _, s := range samples {
		if s.DeviceID == device && s.SessionID == session {
			out = append(out, s)
		}
	}
	return out
}

func sourcesSliceLocked(sources map[sourceKey]struct{}) []types.LiveSource {
	out := make([]types.LiveSource, 0, len(sources))
	for k := range sources {
		out = append(out, types.LiveSource{DeviceID: k.deviceID, SessionID: k.sessionID})
	}
	return out
}

func (l *LiveData) setStatus(status types.LiveConnectionStatus) {
	l.mu.Lock()
	status.Generation = l.generation
	l.lastStatus = status
	emitter := l.emitter
	l.mu.Unlock()
	emitter.EmitStatus(status)
}

func (l *LiveData) stillCurrent(generation uint64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.stillCurrentLocked(generation)
}

func (l *LiveData) stillCurrentLocked(generation uint64) bool {
	return l.connectionGeneration == generation
}

// ListClients returns the relay's registered clients, for the desktop
// app's client picker. Independent of any active connection (it precedes
// one — the user picks a client, then connects scoped to it), so it takes
// relayURL/adminToken directly rather than reusing a connected scope.
func (l *LiveData) ListClients(ctx context.Context, relayURL, adminToken string) ([]types.LiveClientSummary, error) {
	return listClients(ctx, relayURL, adminToken)
}

// Catalog returns the currently connected relay's telemetry channel
// catalog. Errors if not connected.
func (l *LiveData) Catalog(ctx context.Context) (types.LiveCatalog, error) {
	l.mu.Lock()
	scope := l.scope
	connected := l.cancel != nil
	l.mu.Unlock()
	if !connected {
		return types.LiveCatalog{}, errors.New("relay: not connected")
	}
	return getCatalog(ctx, scope.relayURL, scope.adminToken)
}
