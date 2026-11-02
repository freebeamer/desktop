package desktop

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"

	"github.com/freebeamer/core/pkg/relayapi"
	"github.com/freebeamer/core/pkg/telemetry"
	"github.com/freebeamer/core/pkg/types"
	"github.com/freebeamer/core/pkg/vehicleprofile"
)

type profileAssociation struct {
	profile                             types.VehicleProfile
	workspaceGeneration, liveGeneration uint64
	sessionFingerprint                  string
}

func (l *LiveData) rememberBindingSessionLocked(envelope relayapi.LiveEnvelope) {
	if l.sessions == nil {
		l.sessions = map[sourceKey]types.BindingSession{}
	}
	scope, _ := json.Marshal([]string{l.scope.relayURL, l.scope.clientID})
	hash := sha256.Sum256(scope)
	session := types.BindingSession{ScopeSHA256: hex.EncodeToString(hash[:]), DeviceID: envelope.DeviceID, Channels: []string{}}
	if envelope.Session != nil {
		session.SessionID = envelope.Session.ID
		session.CatalogID = envelope.Session.CatalogID
		session.CatalogVersion = envelope.Session.CatalogVersion
		if claim := envelope.Session.Vehicle; claim != nil {
			session.VehicleLabel = claim.Label
			session.ECUFamily = claim.ECUFamily
			session.Software = claim.Software
		}
	}
	for id := range envelope.Values {
		session.Channels = append(session.Channels, id)
	}
	sort.Strings(session.Channels)
	l.sessions[sourceKey{session.DeviceID, session.SessionID}] = session
}

// WithBindingSession holds the live scope stable across an association operation.
// Lock order is always live.mu -> Service.mu; Service never calls back into LiveData.
func (l *LiveData) WithBindingSession(generation uint64, device, session string, action func(types.BindingSession) error) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.generation != generation {
		return fmt.Errorf("live source changed; refresh before associating")
	}
	if l.lastStatus.State != "connected" {
		return fmt.Errorf("connect to a live source before associating")
	}
	value, ok := l.sessions[sourceKey{device, session}]
	if !ok {
		return fmt.Errorf("selected source has not been observed")
	}
	if l.scope.selectedDevice != "" && (device != l.scope.selectedDevice || (l.scope.selectedSession != "" && session != l.scope.selectedSession)) {
		return fmt.Errorf("selected live scope differs from requested source")
	}
	return action(value)
}

func (s *Service) profileFileLocked() (string, error) {
	if s.profilePath != "" {
		return s.profilePath, nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "freebeamer", "vehicle-profiles-v1.json"), nil
}
func (s *Service) bindingContextLocked(session types.BindingSession) vehicleprofile.Context {
	ws := s.workspace
	context := vehicleprofile.Context{Workspace: ws.bindingIdentity, Session: session, ECUFamily: ws.identity.ECUFamily, Software: ws.identity.Software, Axes: []types.BindingAxisOption{}}
	counts := map[string]int{}
	for _, parameter := range ws.definition.Parameters {
		counts[parameter.ID]++
	}
	for _, parameter := range ws.definition.Parameters {
		if parameter.ID == "" || counts[parameter.ID] != 1 || parameter.Kind == "flag" {
			continue
		}
		decoded, err := ws.decoder.DecodeParameter(parameter)
		if err != nil {
			continue
		}
		for _, name := range []string{"x", "y"} {
			axis, exists := parameter.Axes[name]
			if !exists || axis.Count < 2 {
				continue
			}
			if axis.Layout == nil && len(axis.FixedPoints) == 0 && len(axis.StaticValues) == 0 {
				continue
			}
			values := decoded.X
			if name == "y" {
				values = decoded.Y
			}
			expected := 0
			if name == "x" && len(decoded.Z) > 0 {
				expected = len(decoded.Z[0])
			}
			if name == "y" {
				expected = len(decoded.Z)
			}
			if len(values) != axis.Count || expected != axis.Count {
				continue
			}
			numeric := true
			for _, v := range values {
				if math.IsNaN(v) || math.IsInf(v, 0) {
					numeric = false
				}
			}
			if !numeric {
				continue
			}
			context.Axes = append(context.Axes, types.BindingAxisOption{ParameterID: parameter.ID, Title: parameter.Name, Axis: name, Unit: axis.Unit, Count: axis.Count})
		}
	}
	// v2 only accepts this exact catalog today. Unknown/legacy catalogs cannot
	// borrow its units or claim evidence simply because channel names match.
	if session.CatalogID == telemetry.MG1CatalogID && session.CatalogVersion == telemetry.MG1CatalogVersion {
		for _, channel := range telemetry.MonitorCatalog().Channels {
			meaning := ""
			if channel.ID == "RPM" {
				meaning = "engine-speed"
			}
			context.Channels = append(context.Channels, vehicleprofile.Channel{ID: channel.ID, Unit: channel.Unit, Meaning: meaning})
		}
	}
	return context
}

func (s *Service) BindingContext(workspaceGeneration, liveGeneration uint64, session types.BindingSession) (types.BindingContext, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.bindingSnapshotLocked(workspaceGeneration, liveGeneration, session)
}
func (s *Service) bindingSnapshotLocked(workspaceGeneration, liveGeneration uint64, session types.BindingSession) (types.BindingContext, error) {
	if s.workspace == nil {
		return types.BindingContext{}, ErrNoWorkspace
	}
	if s.workspace.generation != workspaceGeneration {
		return types.BindingContext{}, fmt.Errorf("workspace changed; refresh before associating")
	}
	path, err := s.profileFileLocked()
	if err != nil {
		return types.BindingContext{}, err
	}
	profiles, err := vehicleprofile.Read(path)
	if err != nil {
		return types.BindingContext{}, err
	}
	context := s.bindingContextLocked(session)
	result := types.BindingContext{SessionFingerprint: vehicleprofile.SessionFingerprint(session), WorkspaceGeneration: workspaceGeneration, LiveGeneration: liveGeneration, Workspace: context.Workspace, Session: session, Axes: context.Axes, Profiles: profiles, Compatibility: types.BindingCompatibility{State: "unknown", Reasons: []string{"no profile is associated with this workspace and live source"}}}
	if active := s.association; active != nil {
		if active.workspaceGeneration != workspaceGeneration || active.liveGeneration != liveGeneration || active.sessionFingerprint != vehicleprofile.SessionFingerprint(session) {
			s.association = nil
			result.Compatibility.Reasons = []string{"workspace or live session changed; explicitly reassociate a profile"}
		} else {
			result.ActiveProfileID = active.profile.ID
			// There is intentionally no reviewed real-vehicle evidence registry yet.
			result.Compatibility = vehicleprofile.Evaluate(active.profile, context, true, nil)
		}
	}
	return result, nil
}

// SaveBindingProfile validates against backend-owned current identities. A save
// persists a draft but does not activate it or turn evidence notes into proof.
func (s *Service) SaveBindingProfile(request types.BindingRequest, session types.BindingSession) (types.BindingContext, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.workspace == nil {
		return types.BindingContext{}, ErrNoWorkspace
	}
	if s.workspace.generation != request.WorkspaceGeneration {
		return types.BindingContext{}, fmt.Errorf("workspace changed; refresh before saving")
	}
	if request.SessionFingerprint != vehicleprofile.SessionFingerprint(session) {
		return types.BindingContext{}, fmt.Errorf("session metadata changed; refresh before saving")
	}
	compatibility := vehicleprofile.Evaluate(request.Profile, s.bindingContextLocked(session), true, nil)
	if compatibility.State == "incompatible" {
		return types.BindingContext{}, fmt.Errorf("profile refused: %v", compatibility.Reasons)
	}
	if err := vehicleprofile.Validate(request.Profile); err != nil {
		return types.BindingContext{}, err
	}
	path, err := s.profileFileLocked()
	if err != nil {
		return types.BindingContext{}, err
	}
	profiles, err := vehicleprofile.Read(path)
	if err != nil {
		return types.BindingContext{}, err
	}
	updated := false
	for i := range profiles {
		if profiles[i].ID == request.Profile.ID {
			profiles[i] = request.Profile
			updated = true
		}
	}
	if !updated {
		profiles = append(profiles, request.Profile)
	}
	if err := vehicleprofile.Write(path, profiles); err != nil {
		return types.BindingContext{}, err
	}
	if s.association != nil && s.association.profile.ID == request.Profile.ID {
		s.association = nil
	}
	return s.bindingSnapshotLocked(request.WorkspaceGeneration, request.LiveGeneration, session)
}
func (s *Service) AssociateBindingProfile(request types.BindingRequest, session types.BindingSession) (types.BindingContext, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.workspace == nil {
		return types.BindingContext{}, ErrNoWorkspace
	}
	if s.workspace.generation != request.WorkspaceGeneration {
		return types.BindingContext{}, fmt.Errorf("workspace changed; refresh before associating")
	}
	if request.SessionFingerprint != vehicleprofile.SessionFingerprint(session) {
		return types.BindingContext{}, fmt.Errorf("session metadata changed; refresh before associating")
	}
	path, err := s.profileFileLocked()
	if err != nil {
		return types.BindingContext{}, err
	}
	profiles, err := vehicleprofile.Read(path)
	if err != nil {
		return types.BindingContext{}, err
	}
	var profile *types.VehicleProfile
	for i := range profiles {
		if profiles[i].ID == request.Profile.ID {
			profile = &profiles[i]
		}
	}
	if profile == nil {
		return types.BindingContext{}, fmt.Errorf("save or select a stored profile first")
	}
	compatibility := vehicleprofile.Evaluate(*profile, s.bindingContextLocked(session), true, nil)
	if compatibility.State == "incompatible" || compatibility.State == "unknown" {
		s.association = nil
		result, err := s.bindingSnapshotLocked(request.WorkspaceGeneration, request.LiveGeneration, session)
		result.Compatibility = compatibility
		return result, err
	}
	s.association = &profileAssociation{profile: *profile, workspaceGeneration: request.WorkspaceGeneration, liveGeneration: request.LiveGeneration, sessionFingerprint: vehicleprofile.SessionFingerprint(session)}
	return s.bindingSnapshotLocked(request.WorkspaceGeneration, request.LiveGeneration, session)
}
func (s *Service) ClearBindingProfile() { s.mu.Lock(); defer s.mu.Unlock(); s.association = nil }

// BindingRevision includes availability as well as session identity. It lets the
// UI refresh compatibility only when metadata changes, not for every sample.
func (l *LiveData) bindingSourcesLocked() []types.LiveSource {
	sources := sourcesSliceLocked(l.sources)
	for i := range sources {
		session := l.sessions[sourceKey{sources[i].DeviceID, sources[i].SessionID}]
		data, _ := json.Marshal(session)
		hash := sha256.Sum256(data)
		sources[i].BindingRevision = hex.EncodeToString(hash[:])
	}
	return sources
}
