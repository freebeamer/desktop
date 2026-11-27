package desktop

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/freebeamer/core/pkg/mapdef"
	"github.com/freebeamer/core/pkg/xdf"
)

// mapdefFromBasicXDF converts the basic XDF fixture to a .mapdef on disk, so a
// workspace can be opened from a .mapdef path (the A2L-imported case uses the
// same loadDefinition path).
func mapdefFromBasicXDF(t *testing.T) string {
	t.Helper()
	document, err := xdf.ImportMapDefinition(basicXDF())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "basic.mapdef")
	if err := mapdef.Save(path, document); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestOpenWorkspaceFromMapdef(t *testing.T) {
	service := NewService()
	summary, err := service.OpenWorkspace(mapdefFromBasicXDF(t), fittingBIN(t))
	if err != nil {
		t.Fatalf("open .mapdef workspace: %v", err)
	}
	// Same document as the XDF path, so the compatibility and map counts match
	// TestOpenWorkspaceFittingImage.
	if summary.Compatibility.AddressedMaps != 1 || summary.Compatibility.TotalMaps != 1 || summary.Compatibility.MapValidationErrors != 0 {
		t.Fatalf("compatibility = %#v", summary.Compatibility)
	}
	if summary.XDF.Categories != 2 || summary.XDF.Tables != 1 || summary.XDF.Flags != 1 {
		t.Fatalf("definition summary = %#v", summary.XDF)
	}
	if !summary.EditingAllowed {
		t.Fatalf("editing refused: %q", summary.RefusalReason)
	}
	if filepath.Ext(summary.XDFPath) != ".mapdef" {
		t.Fatalf("workspace path = %q, want a .mapdef", summary.XDFPath)
	}
}

func TestOpenWorkspaceRejectsInvalidMapdef(t *testing.T) {
	bad := filepath.Join(t.TempDir(), "bad.mapdef")
	if err := os.WriteFile(bad, []byte(`{"format":"freehorse.mapdef"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService()
	if _, err := service.OpenWorkspace(bad, fittingBIN(t)); err == nil {
		t.Fatal("expected an invalid .mapdef to be rejected")
	}
}
