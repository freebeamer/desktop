package desktop

import (
	"path/filepath"
	"testing"

	"github.com/freebeamer/core/pkg/telemetry"
	"github.com/freebeamer/core/pkg/types"
	"github.com/freebeamer/core/pkg/vehicleprofile"
)

// openBindingWorkspace opens the shared basic.xdf/fittingBIN fixture with an
// isolated, per-test profile store so profile persistence tests never touch a
// real OS user-config directory or collide with each other.
func openBindingWorkspace(t *testing.T) (*Service, types.WorkspaceSummary) {
	t.Helper()
	service := NewService()
	service.profilePath = filepath.Join(t.TempDir(), "vehicle-profiles-v1.json")
	summary, err := service.OpenWorkspace(basicXDF(), fittingBIN(t))
	if err != nil {
		t.Fatal(err)
	}
	return service, summary
}

// bindingTestSession is a fully-known session: eligible catalog, asserted
// identity, and an observed RPM channel — the minimum Evaluate needs to
// reach "manual" instead of stopping at "session/catalog identity unknown".
func bindingTestSession() types.BindingSession {
	return types.BindingSession{
		ScopeSHA256: "scope-hash", DeviceID: "device-1", SessionID: "session-1",
		CatalogID: telemetry.MG1CatalogID, CatalogVersion: telemetry.MG1CatalogVersion,
		ECUFamily: "N55", Software: "MEVD17.2.6", Channels: []string{"RPM"},
	}
}

// compatibleProfile binds basic.xdf's one eligible axis (x, rpm, 2 points)
// to the session's RPM channel with an identity (rpm -> rpm) conversion.
func compatibleProfile(context types.BindingContext) types.VehicleProfile {
	axis := context.Axes[0]
	return types.VehicleProfile{
		ID: "profile-1", Label: "N55 test profile",
		ECUFamily: "N55", Software: "MEVD17.2.6",
		Workspace: context.Workspace,
		Catalogs:  []types.BindingCatalog{{ID: telemetry.MG1CatalogID, Version: telemetry.MG1CatalogVersion}},
		Bindings: []types.AxisBinding{{
			ParameterID: axis.ParameterID, Axis: axis.Axis, ChannelID: "RPM",
			ChannelMeaning: "engine-speed", AxisMeaning: "engine-speed",
			SourceUnit: "rpm", TargetUnit: axis.Unit, Scale: 1, Offset: 0,
		}},
	}
}

func containsReason(reasons []string, reason string) bool {
	for _, r := range reasons {
		if r == reason {
			return true
		}
	}
	return false
}

func bindingRequest(summary types.WorkspaceSummary, liveGeneration uint64, session types.BindingSession, profile types.VehicleProfile) types.BindingRequest {
	return types.BindingRequest{
		WorkspaceGeneration: summary.Generation, LiveGeneration: liveGeneration,
		DeviceID: session.DeviceID, SessionID: session.SessionID,
		SessionFingerprint: vehicleprofile.SessionFingerprint(session), Profile: profile,
	}
}

func TestBindingContextBeforeAnyProfileIsUnknown(t *testing.T) {
	service, summary := openBindingWorkspace(t)
	context, err := service.BindingContext(summary.Generation, 1, bindingTestSession())
	if err != nil {
		t.Fatal(err)
	}
	if context.Compatibility.State != "unknown" || context.ActiveProfileID != "" {
		t.Fatalf("compatibility = %+v, activeProfileId = %q, want unknown/empty before any profile exists", context.Compatibility, context.ActiveProfileID)
	}
}

func TestBindingContextOnlyExposesNumericExplicitAxes(t *testing.T) {
	service, summary := openBindingWorkspace(t)
	context, err := service.BindingContext(summary.Generation, 1, bindingTestSession())
	if err != nil {
		t.Fatal(err)
	}
	// basic.xdf has one table (an explicit numeric "x" axis, unit rpm, 2
	// points) and one flag ("Example switch"); the flag must not appear.
	if len(context.Axes) != 1 {
		t.Fatalf("axes = %+v, want exactly 1", context.Axes)
	}
	axis := context.Axes[0]
	if axis.Axis != "x" || axis.Unit != "rpm" || axis.Count != 2 {
		t.Fatalf("axis = %+v, want x/rpm/2", axis)
	}
}

func TestSaveBindingProfilePersistsWithoutActivating(t *testing.T) {
	service, summary := openBindingWorkspace(t)
	session := bindingTestSession()
	context, err := service.BindingContext(summary.Generation, 1, session)
	if err != nil {
		t.Fatal(err)
	}
	profile := compatibleProfile(context)
	request := bindingRequest(summary, 1, session, profile)

	saved, err := service.SaveBindingProfile(request, session)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Profiles) != 1 || saved.Profiles[0].ID != profile.ID {
		t.Fatalf("profiles = %+v, want the saved profile", saved.Profiles)
	}
	if saved.ActiveProfileID != "" || saved.Compatibility.State != "unknown" {
		t.Fatalf("save must not activate: activeProfileId=%q state=%q", saved.ActiveProfileID, saved.Compatibility.State)
	}
}

func TestAssociateBindingProfileReachesManualNeverValidated(t *testing.T) {
	service, summary := openBindingWorkspace(t)
	session := bindingTestSession()
	context, err := service.BindingContext(summary.Generation, 1, session)
	if err != nil {
		t.Fatal(err)
	}
	profile := compatibleProfile(context)
	request := bindingRequest(summary, 1, session, profile)
	if _, err := service.SaveBindingProfile(request, session); err != nil {
		t.Fatal(err)
	}

	associated, err := service.AssociateBindingProfile(request, session)
	if err != nil {
		t.Fatal(err)
	}
	// No reviewed real-vehicle evidence registry exists yet (see
	// docs/vehicle-profile-format.md), so manual association can never
	// reach "validated" through this path.
	if associated.Compatibility.State != "manual" || associated.Compatibility.Verified {
		t.Fatalf("compatibility = %+v, want an unverified manual association", associated.Compatibility)
	}
	if associated.ActiveProfileID != profile.ID {
		t.Fatalf("activeProfileId = %q, want %q", associated.ActiveProfileID, profile.ID)
	}
}

func TestAssociateBindingProfileRefusesContradictingECUFamily(t *testing.T) {
	service, summary := openBindingWorkspace(t)
	session := bindingTestSession()
	context, err := service.BindingContext(summary.Generation, 1, session)
	if err != nil {
		t.Fatal(err)
	}
	profile := compatibleProfile(context)
	saveRequest := bindingRequest(summary, 1, session, profile)
	if _, err := service.SaveBindingProfile(saveRequest, session); err != nil {
		t.Fatal(err)
	}

	// A later session on the same source asserts a different ECU family
	// than the one the profile was saved against.
	contradicting := session
	contradicting.ECUFamily = "S55"
	associateRequest := bindingRequest(summary, 1, contradicting, profile)

	result, err := service.AssociateBindingProfile(associateRequest, contradicting)
	if err != nil {
		t.Fatal(err)
	}
	if result.Compatibility.State != "incompatible" || result.ActiveProfileID != "" {
		t.Fatalf("compatibility = %+v, activeProfileId = %q, want incompatible/empty", result.Compatibility, result.ActiveProfileID)
	}
}

func TestGetBindingContextClearsAssociationOnLiveScopeChange(t *testing.T) {
	service, summary := openBindingWorkspace(t)
	session := bindingTestSession()
	context, err := service.BindingContext(summary.Generation, 1, session)
	if err != nil {
		t.Fatal(err)
	}
	profile := compatibleProfile(context)
	request := bindingRequest(summary, 1, session, profile)
	if _, err := service.SaveBindingProfile(request, session); err != nil {
		t.Fatal(err)
	}
	if _, err := service.AssociateBindingProfile(request, session); err != nil {
		t.Fatal(err)
	}

	const reassociateReason = "workspace or live session changed; explicitly reassociate a profile"

	// Live generation advances (e.g. a reconnect or a new source selection)
	// without the workspace changing at all.
	changed, err := service.BindingContext(summary.Generation, 2, session)
	if err != nil {
		t.Fatal(err)
	}
	if changed.ActiveProfileID != "" {
		t.Fatalf("activeProfileId = %q, want cleared once live generation no longer matches the association", changed.ActiveProfileID)
	}
	if !containsReason(changed.Compatibility.Reasons, reassociateReason) {
		t.Fatalf("reasons = %v, want the reassociation-required reason", changed.Compatibility.Reasons)
	}

	// The clear must be real, not just reported once: a second call at the
	// same (already-invalidated) scope reports the plain "no profile
	// associated" reason, not the transient reassociation notice again.
	again, err := service.BindingContext(summary.Generation, 2, session)
	if err != nil {
		t.Fatal(err)
	}
	if containsReason(again.Compatibility.Reasons, reassociateReason) {
		t.Fatal("association must actually be cleared, not just reported once")
	}
}

func TestReopeningWorkspaceClearsAssociation(t *testing.T) {
	service, summary := openBindingWorkspace(t)
	session := bindingTestSession()
	context, err := service.BindingContext(summary.Generation, 1, session)
	if err != nil {
		t.Fatal(err)
	}
	profile := compatibleProfile(context)
	request := bindingRequest(summary, 1, session, profile)
	if _, err := service.SaveBindingProfile(request, session); err != nil {
		t.Fatal(err)
	}
	if _, err := service.AssociateBindingProfile(request, session); err != nil {
		t.Fatal(err)
	}

	summary2, err := service.OpenWorkspace(basicXDF(), fittingBIN(t))
	if err != nil {
		t.Fatal(err)
	}
	if summary2.Generation == summary.Generation {
		t.Fatal("reopening must advance the workspace generation")
	}

	after, err := service.BindingContext(summary2.Generation, 1, session)
	if err != nil {
		t.Fatal(err)
	}
	if after.ActiveProfileID != "" || after.Compatibility.State != "unknown" {
		t.Fatalf("compatibility = %+v, activeProfileId = %q, want cleared after reopening the workspace", after.Compatibility, after.ActiveProfileID)
	}
}

func TestClearBindingProfile(t *testing.T) {
	service, summary := openBindingWorkspace(t)
	session := bindingTestSession()
	context, err := service.BindingContext(summary.Generation, 1, session)
	if err != nil {
		t.Fatal(err)
	}
	profile := compatibleProfile(context)
	request := bindingRequest(summary, 1, session, profile)
	if _, err := service.SaveBindingProfile(request, session); err != nil {
		t.Fatal(err)
	}
	if _, err := service.AssociateBindingProfile(request, session); err != nil {
		t.Fatal(err)
	}

	service.ClearBindingProfile()

	after, err := service.BindingContext(summary.Generation, 1, session)
	if err != nil {
		t.Fatal(err)
	}
	if after.ActiveProfileID != "" || after.Compatibility.State != "unknown" {
		t.Fatalf("compatibility = %+v, activeProfileId = %q, want cleared after ClearBindingProfile", after.Compatibility, after.ActiveProfileID)
	}
}
