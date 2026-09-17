package desktop

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/freebeamer/core/pkg/types"
)

// Wails event names LiveData emits. Angular listens for these via
// wailsjs/runtime's EventsOn.
const (
	LiveStatusEvent  = "live:status"
	LiveSamplesEvent = "live:samples"
)

// LiveEventEmitter is the sink LiveData pushes status/batch updates
// through. Production wiring uses WailsLiveEventEmitter; tests use a fake
// that records emitted values, so LiveData's connection/batching logic is
// verifiable without a running Wails frontend — mirrors FileDialog's
// port/adapter split (dialog.go/dialog_wails.go), except the emitter is
// pushed to asynchronously from LiveData's own background goroutine
// rather than called synchronously from an App method.
type LiveEventEmitter interface {
	EmitStatus(types.LiveConnectionStatus)
	EmitBatch(types.LiveBatch)
}

// noopLiveEventEmitter discards everything — the default LiveData is
// constructed with, before App.startup provides the real Wails context.
// Never panics if a method is somehow invoked before startup runs.
type noopLiveEventEmitter struct{}

func (noopLiveEventEmitter) EmitStatus(types.LiveConnectionStatus) {}
func (noopLiveEventEmitter) EmitBatch(types.LiveBatch)             {}

// WailsLiveEventEmitter implements LiveEventEmitter by pushing Wails
// runtime events to the frontend. Unlike WailsFileDialog, ctx is captured
// once at construction (App.startup, when the real Wails context first
// becomes available) rather than passed per call — LiveData emits
// asynchronously from its own background goroutine, not synchronously
// from an App method invocation that could supply a fresh ctx each time.
type WailsLiveEventEmitter struct {
	ctx context.Context
}

func NewWailsLiveEventEmitter(ctx context.Context) *WailsLiveEventEmitter {
	return &WailsLiveEventEmitter{ctx: ctx}
}

var _ LiveEventEmitter = (*WailsLiveEventEmitter)(nil)

func (e *WailsLiveEventEmitter) EmitStatus(status types.LiveConnectionStatus) {
	runtime.EventsEmit(e.ctx, LiveStatusEvent, status)
}

func (e *WailsLiveEventEmitter) EmitBatch(batch types.LiveBatch) {
	runtime.EventsEmit(e.ctx, LiveSamplesEvent, batch)
}
