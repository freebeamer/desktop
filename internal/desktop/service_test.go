package desktop

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/freebeamer/core/pkg/types"
)

func TestHealth(t *testing.T) {
	got := NewService().Health()
	if !got.Ready || got.APIVersion != APIVersion || got.Engine != "FreeBeamer Go" {
		t.Fatalf("Health() = %#v", got)
	}
}

func basicXDF() string {
	return filepath.Join("..", "..", "testdata", "public", "xdf", "basic.xdf")
}

// fittingBIN writes a BIN large enough for basic.xdf's declared 4MiB region
// and populated so the "Boost target" table decodes cleanly.
func fittingBIN(t *testing.T) string {
	t.Helper()
	data := make([]byte, 0x400000)
	binary.LittleEndian.PutUint16(data[0x100:], 100)
	binary.LittleEndian.PutUint16(data[0x102:], 200)
	for index, value := range []uint16{10, 20, 30, 40} {
		binary.LittleEndian.PutUint16(data[0x200+index*2:], value)
	}
	path := filepath.Join(t.TempDir(), "fitting.bin")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func tinyBIN(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "tiny.bin")
	if err := os.WriteFile(path, make([]byte, 0x208), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestOpenWorkspaceRequiresBothPaths(t *testing.T) {
	service := NewService()
	if _, err := service.OpenWorkspace("", ""); err == nil {
		t.Fatal("expected an error for missing paths")
	}
	if _, err := service.OpenWorkspace(basicXDF(), ""); err == nil {
		t.Fatal("expected an error for a missing BIN path")
	}
}

func TestOpenWorkspaceFittingImage(t *testing.T) {
	service := NewService()
	summary, err := service.OpenWorkspace(basicXDF(), fittingBIN(t))
	if err != nil {
		t.Fatal(err)
	}
	if summary.Generation != 1 {
		t.Fatalf("generation = %d, want 1", summary.Generation)
	}
	if summary.XDF.Version != "1.70" || summary.XDF.Categories != 2 || summary.XDF.Tables != 1 || summary.XDF.Flags != 1 {
		t.Fatalf("XDF summary = %#v", summary.XDF)
	}
	if !summary.Compatibility.RegionFitsROM {
		t.Fatal("expected the region to fit")
	}
	if summary.Compatibility.AddressedMaps != 1 || summary.Compatibility.TotalMaps != 1 || summary.Compatibility.MapValidationErrors != 0 {
		t.Fatalf("compatibility = %#v", summary.Compatibility)
	}
	if summary.Checksum.Status != "unsupported" {
		t.Fatalf("checksum status = %q, want unsupported for a synthetic image", summary.Checksum.Status)
	}
	if !summary.EditingAllowed || summary.RefusalReason != "" {
		t.Fatalf("expected editing to be allowed, got allowed=%v reason=%q", summary.EditingAllowed, summary.RefusalReason)
	}
}

func TestOpenWorkspaceRefusesUndersizedImage(t *testing.T) {
	service := NewService()
	summary, err := service.OpenWorkspace(basicXDF(), tinyBIN(t))
	if err != nil {
		t.Fatal(err)
	}
	if summary.Compatibility.RegionFitsROM {
		t.Fatal("expected the declared region not to fit a tiny image")
	}
	if summary.EditingAllowed {
		t.Fatal("expected editing to be refused for an incompatible pairing")
	}
	if summary.RefusalReason == "" {
		t.Fatal("expected a refusal reason")
	}
}

func TestOpenWorkspaceRejectsMissingFiles(t *testing.T) {
	service := NewService()
	if _, err := service.OpenWorkspace("does-not-exist.xdf", fittingBIN(t)); err == nil {
		t.Fatal("expected an error for a missing XDF")
	}
	if _, err := service.OpenWorkspace(basicXDF(), "does-not-exist.bin"); err == nil {
		t.Fatal("expected an error for a missing BIN")
	}
}

func TestGetWorkspaceWithoutOpen(t *testing.T) {
	service := NewService()
	if _, err := service.GetWorkspace(); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("err = %v, want ErrNoWorkspace", err)
	}
}

func TestGetWorkspaceAndClose(t *testing.T) {
	service := NewService()
	opened, err := service.OpenWorkspace(basicXDF(), fittingBIN(t))
	if err != nil {
		t.Fatal(err)
	}
	got, err := service.GetWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	if got != opened {
		t.Fatalf("GetWorkspace() = %#v, want %#v", got, opened)
	}
	service.CloseWorkspace()
	if _, err := service.GetWorkspace(); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("err after close = %v, want ErrNoWorkspace", err)
	}
}

type fakeDialog struct {
	xdfPath, binPath, savePath string
	xdfErr, binErr, saveErr    error
}

func (f fakeDialog) OpenXDF(context.Context) (string, error)         { return f.xdfPath, f.xdfErr }
func (f fakeDialog) OpenBIN(context.Context) (string, error)         { return f.binPath, f.binErr }
func (f fakeDialog) SaveBIN(context.Context, string) (string, error) { return f.savePath, f.saveErr }

func TestChooseAndOpenWorkspace(t *testing.T) {
	service := NewService()
	dialog := fakeDialog{xdfPath: basicXDF(), binPath: fittingBIN(t)}
	summary, err := service.ChooseAndOpenWorkspace(context.Background(), dialog)
	if err != nil {
		t.Fatal(err)
	}
	if summary.XDFPath != dialog.xdfPath || summary.BinPath != dialog.binPath {
		t.Fatalf("summary paths = %q/%q, want %q/%q", summary.XDFPath, summary.BinPath, dialog.xdfPath, dialog.binPath)
	}
}

func TestChooseAndOpenWorkspaceCancelled(t *testing.T) {
	service := NewService()
	if _, err := service.ChooseAndOpenWorkspace(context.Background(), fakeDialog{}); !errors.Is(err, ErrDialogCancelled) {
		t.Fatalf("err = %v, want ErrDialogCancelled for an empty XDF choice", err)
	}
	if _, err := service.ChooseAndOpenWorkspace(context.Background(), fakeDialog{xdfPath: basicXDF()}); !errors.Is(err, ErrDialogCancelled) {
		t.Fatalf("err = %v, want ErrDialogCancelled for an empty BIN choice", err)
	}
}

func TestChooseAndOpenWorkspaceNoDialog(t *testing.T) {
	service := NewService()
	if _, err := service.ChooseAndOpenWorkspace(context.Background(), nil); err == nil {
		t.Fatal("expected an error with no dialog port configured")
	}
}

func TestRememberRecentOrdersDedupsAndCaps(t *testing.T) {
	var entries []types.RecentEntry
	for i := 0; i < maxRecentEntries+2; i++ {
		entries = rememberRecent(entries, types.RecentEntry{XDFPath: fmt.Sprintf("d%d.xdf", i), BinPath: fmt.Sprintf("d%d.bin", i)})
	}
	if len(entries) != maxRecentEntries {
		t.Fatalf("len(entries) = %d, want %d", len(entries), maxRecentEntries)
	}
	newest := types.RecentEntry{XDFPath: fmt.Sprintf("d%d.xdf", maxRecentEntries+1), BinPath: fmt.Sprintf("d%d.bin", maxRecentEntries+1)}
	if entries[0] != newest {
		t.Fatalf("entries[0] = %#v, want the most recently opened entry %#v", entries[0], newest)
	}

	reopened := entries[3]
	entries = rememberRecent(entries, reopened)
	if len(entries) != maxRecentEntries {
		t.Fatalf("len(entries) after reopen = %d, want %d", len(entries), maxRecentEntries)
	}
	if entries[0] != reopened {
		t.Fatalf("entries[0] = %#v, want re-opened entry %#v moved to front", entries[0], reopened)
	}
	seen := 0
	for _, entry := range entries {
		if entry == reopened {
			seen++
		}
	}
	if seen != 1 {
		t.Fatalf("reopened entry appears %d times, want 1", seen)
	}
}

func TestRecentWorkspacesTracksOpens(t *testing.T) {
	service := NewService()
	bin := fittingBIN(t)
	if _, err := service.OpenWorkspace(basicXDF(), bin); err != nil {
		t.Fatal(err)
	}
	recents := service.RecentWorkspaces()
	if len(recents) != 1 || recents[0].XDFPath != basicXDF() || recents[0].BinPath != bin {
		t.Fatalf("recents = %#v", recents)
	}
}

func TestPrivateWorkspaceMatchesCLIInspect(t *testing.T) {
	private := filepath.Join("..", "..", "testdata", "private")
	xdfPath := filepath.Join(private, "00000FEF81A001.xdf")
	binPath := filepath.Join(private, "00000FEF81A001_original.bin")
	for _, path := range []string{xdfPath, binPath} {
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			t.Skip("private BMW fixtures are not installed")
		} else if err != nil {
			t.Fatal(err)
		}
	}

	raw, err := os.ReadFile(binPath)
	if err != nil {
		t.Fatal(err)
	}
	wantSHA := hex.EncodeToString(func() []byte { sum := sha256.Sum256(raw); return sum[:] }())

	summary, err := NewService().OpenWorkspace(xdfPath, binPath)
	if err != nil {
		t.Fatal(err)
	}

	if summary.ROM.SizeBytes != 4194304 {
		t.Errorf("ROM.SizeBytes = %d, want 4194304", summary.ROM.SizeBytes)
	}
	if summary.ROM.SHA256 != wantSHA {
		t.Errorf("ROM.SHA256 = %s, want %s", summary.ROM.SHA256, wantSHA)
	}
	if summary.ECU.Vendor != "Bosch" || summary.ECU.Family != "MEVD17.2.6" || summary.ECU.Engine != "BMW N55" {
		t.Errorf("ECU summary = %#v", summary.ECU)
	}
	if summary.XDF.Version != "1.70" || summary.XDF.Categories != 73 || summary.XDF.Tables != 962 || summary.XDF.Flags != 7 {
		t.Errorf("XDF summary = %#v", summary.XDF)
	}
	if !summary.Compatibility.RegionFitsROM || summary.Compatibility.AddressedMaps != 962 || summary.Compatibility.TotalMaps != 962 {
		t.Errorf("compatibility = %#v", summary.Compatibility)
	}
	if summary.Checksum.Provider != "bosch.mevd17.2.6.75P9EJ0B" || summary.Checksum.Status != "valid" || summary.Checksum.Regions != 11 {
		t.Errorf("checksum = %#v", summary.Checksum)
	}
	if !summary.EditingAllowed {
		t.Errorf("expected editing to be allowed for the validated fixture, reason=%q", summary.RefusalReason)
	}
}
