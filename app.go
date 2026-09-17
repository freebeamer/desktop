package main

import (
	"context"

	"github.com/freebeamer/desktop/internal/desktop"
	"github.com/freebeamer/core/pkg/types"
	"github.com/freebeamer/core/pkg/vehicleprofile"
)

type App struct {
	ctx     context.Context
	service *desktop.Service
	dialog  desktop.FileDialog
	live    *desktop.LiveData
}

func NewApp() *App {
	return &App{service: desktop.NewService(), dialog: desktop.WailsFileDialog{}, live: desktop.NewLiveData()}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.live.SetEmitter(desktop.NewWailsLiveEventEmitter(ctx))
}

func (a *App) Health() types.HealthStatus { return a.service.Health() }

// OpenWorkspace loads an XDF/BIN pair given explicit paths.
func (a *App) OpenWorkspace(xdfPath, binPath string) (types.WorkspaceSummary, error) {
	return a.service.OpenWorkspace(xdfPath, binPath)
}

// ChooseAndOpenWorkspace prompts for an XDF then a BIN via native dialogs
// and opens the resulting pair.
func (a *App) ChooseAndOpenWorkspace() (types.WorkspaceSummary, error) {
	return a.service.ChooseAndOpenWorkspace(a.ctx, a.dialog)
}

// GetWorkspace returns the currently open workspace summary, if any.
func (a *App) GetWorkspace() (types.WorkspaceSummary, error) {
	return a.service.GetWorkspace()
}

// CloseWorkspace discards the active workspace, if any.
func (a *App) CloseWorkspace() { a.service.CloseWorkspace() }

// RecentWorkspaces lists previously opened XDF/BIN pairs for this run.
func (a *App) RecentWorkspaces() []types.RecentEntry { return a.service.RecentWorkspaces() }

// ListMaps returns the maps in the open workspace matching filter.
func (a *App) ListMaps(filter types.MapFilter) (types.MapPage, error) {
	return a.service.ListMaps(filter)
}

// GetMap decodes and returns the detail for one map in the open workspace.
func (a *App) GetMap(mapID int) (types.MapDetail, error) {
	return a.service.GetMap(mapID)
}

// SetCell edits one matrix/scalar cell by row and column.
func (a *App) SetCell(mapID, row, column int, value float64) (types.EditOutcome, error) {
	return a.service.SetCell(mapID, row, column, value)
}

// SetIndex edits one cell by its flat row-major index, for a one-axis map.
func (a *App) SetIndex(mapID, index int, value float64) (types.EditOutcome, error) {
	return a.service.SetIndex(mapID, index, value)
}

// ApplyCellOperation transforms a rectangular map selection as one edit.
func (a *App) ApplyCellOperation(request types.CellOperationRequest) (types.BatchEditOutcome, error) {
	return a.service.ApplyCellOperation(request)
}

// Undo reverses the most recent edit.
func (a *App) Undo() (types.EditOutcome, error) { return a.service.Undo() }

// Redo re-applies the most recently undone edit.
func (a *App) Redo() (types.EditOutcome, error) { return a.service.Redo() }

// GetDiff summarizes every changed byte, grouped by calibration edit.
func (a *App) GetDiff() (types.DiffSummary, error) { return a.service.GetDiff() }

// VerifyChecksums re-verifies the current working image without saving.
func (a *App) VerifyChecksums() (types.ChecksumSummary, error) {
	return a.service.VerifyChecksums()
}

// SaveAs corrects a clone through the checksum provider, post-verifies
// every region, and writes it to a new file at path.
func (a *App) SaveAs(path string) (types.SaveOutcome, error) {
	return a.service.SaveAs(path)
}

// ChooseAndSaveAs prompts for a destination via a native save dialog, then
// behaves exactly like SaveAs.
func (a *App) ChooseAndSaveAs() (types.SaveOutcome, error) {
	return a.service.ChooseAndSaveAs(a.ctx, a.dialog)
}

// ConnectLive starts a live relay connection scoped to clientID, tearing
// down any existing one first. Connection outcome (including auth
// failure) is reported asynchronously via "live:status" events, not this
// call's return value — see LiveData.Connect. The returned generation
// identifies the display scope so Angular can reject delayed events. Works whether or not a
// calibration workspace is open.
func (a *App) ConnectLive(relayURL, adminToken, clientID string) (uint64, error) {
	err := a.live.Connect(relayURL, adminToken, clientID)
	return a.live.Status().Generation, err
}

// DisconnectLive tears down the active live connection, if any.
func (a *App) DisconnectLive() { a.live.Disconnect() }

// ListLiveClients returns relayURL's registered clients, for the live
// connection form's client picker — independent of any active connection.
func (a *App) ListLiveClients(relayURL, adminToken string) ([]types.LiveClientSummary, error) {
	return a.live.ListClients(a.ctx, relayURL, adminToken)
}

// GetLiveCatalog returns the connected relay's telemetry channel catalog.
// Errors if not currently connected.
func (a *App) GetLiveCatalog() (types.LiveCatalog, error) {
	return a.live.Catalog(a.ctx)
}

// SetLiveDeviceSession filters the live connection's stream to one
// discovered (deviceID, sessionID) pair; "", "" clears the filter.
func (a *App) SetLiveDeviceSession(deviceID, sessionID string) uint64 {
	a.live.SetDeviceSession(deviceID, sessionID)
	return a.live.Status().Generation
}

// LiveConnectionStatus returns the most recently observed live connection
// state, for an initial render before the first "live:status" event.
func (a *App) LiveConnectionStatus() types.LiveConnectionStatus {
	return a.live.Status()
}

// GetBindingContext snapshots the open workspace and an observed live source.
func (a *App) GetBindingContext(request types.BindingRequest) (types.BindingContext, error) {
	var result types.BindingContext
	err := a.live.WithBindingSession(request.LiveGeneration, request.DeviceID, request.SessionID, func(session types.BindingSession) error {
		var err error
		result, err = a.service.BindingContext(request.WorkspaceGeneration, request.LiveGeneration, session)
		return err
	})
	return result, err
}
func (a *App) SaveBindingProfile(request types.BindingRequest) (types.BindingContext, error) {
	var result types.BindingContext
	err := a.live.WithBindingSession(request.LiveGeneration, request.DeviceID, request.SessionID, func(session types.BindingSession) error {
		var err error
		result, err = a.service.SaveBindingProfile(request, session)
		return err
	})
	return result, err
}
func (a *App) AssociateBindingProfile(request types.BindingRequest) (types.BindingContext, error) {
	var result types.BindingContext
	err := a.live.WithBindingSession(request.LiveGeneration, request.DeviceID, request.SessionID, func(session types.BindingSession) error {
		var err error
		result, err = a.service.AssociateBindingProfile(request, session)
		return err
	})
	return result, err
}
func (a *App) ClearBindingProfile() { a.service.ClearBindingProfile() }

func (a *App) BindingUnitConversion(source, target, meaning string) (types.BindingConversion, error) {
	scale, offset, err := vehicleprofile.Conversion(source, target, meaning)
	return types.BindingConversion{Scale: scale, Offset: offset}, err
}
