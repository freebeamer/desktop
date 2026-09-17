package desktop

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/freebeamer/core/pkg/checksum"
	"github.com/freebeamer/core/pkg/checksum/bmw/mevd1726"
	"github.com/freebeamer/core/pkg/types"
)

func TestSaveAsWithoutWorkspace(t *testing.T) {
	if _, err := NewService().SaveAs(filepath.Join(t.TempDir(), "out.bin")); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("err = %v, want ErrNoWorkspace", err)
	}
}

func TestVerifyChecksumsWithoutWorkspace(t *testing.T) {
	if _, err := NewService().VerifyChecksums(); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("err = %v, want ErrNoWorkspace", err)
	}
}

func TestSaveAsRefusesUnsupportedFirmware(t *testing.T) {
	service := openBasicWorkspace(t) // basic.xdf/fittingBIN: no checksum provider matches this synthetic image.
	out := filepath.Join(t.TempDir(), "out.bin")
	if _, err := service.SaveAs(out); !errors.Is(err, ErrUnsupportedFirmware) {
		t.Fatalf("err = %v, want ErrUnsupportedFirmware", err)
	}
	if _, statErr := os.Stat(out); statErr == nil {
		t.Fatal("SaveAs must not create a file when it refuses to save")
	}
}

func TestVerifyChecksumsReflectsCurrentImage(t *testing.T) {
	service := openBasicWorkspace(t)
	summary, err := service.VerifyChecksums()
	if err != nil {
		t.Fatal(err)
	}
	if summary.Status != "unsupported" {
		t.Fatalf("status = %q, want unsupported", summary.Status)
	}
}

func TestChooseAndSaveAsNoDialog(t *testing.T) {
	service := openBasicWorkspace(t)
	if _, err := service.ChooseAndSaveAs(context.Background(), nil); err == nil {
		t.Fatal("expected an error with no dialog port configured")
	}
}

func TestChooseAndSaveAsWithoutWorkspace(t *testing.T) {
	if _, err := NewService().ChooseAndSaveAs(context.Background(), fakeDialog{}); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("err = %v, want ErrNoWorkspace", err)
	}
}

func TestChooseAndSaveAsCancelled(t *testing.T) {
	service := openBasicWorkspace(t)
	if _, err := service.ChooseAndSaveAs(context.Background(), fakeDialog{}); !errors.Is(err, ErrDialogCancelled) {
		t.Fatalf("err = %v, want ErrDialogCancelled for an empty save path", err)
	}
}

func openPrivateWorkspaceCopy(t *testing.T) (*Service, string, string) {
	t.Helper()
	private := filepath.Join("..", "..", "testdata", "private")
	xdfPath := filepath.Join(private, "00000FEF81A001.xdf")
	originalPath := filepath.Join(private, "00000FEF81A001_original.bin")
	for _, path := range []string{xdfPath, originalPath} {
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			t.Skip("private BMW fixtures are not installed")
		} else if err != nil {
			t.Fatal(err)
		}
	}
	pristine, err := os.ReadFile(originalPath)
	if err != nil {
		t.Fatal(err)
	}
	workingPath := filepath.Join(t.TempDir(), "working.bin")
	if err := os.WriteFile(workingPath, pristine, 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService()
	if _, err := service.OpenWorkspace(xdfPath, workingPath); err != nil {
		t.Fatal(err)
	}
	return service, workingPath, originalPath
}

func TestSaveAsRefusesOriginalPathWrite(t *testing.T) {
	service, workingPath, _ := openPrivateWorkspaceCopy(t)
	if _, err := service.SaveAs(workingPath); err == nil {
		t.Fatal("expected SaveAs to refuse overwriting the workspace's own BIN path")
	}
	pristine, _ := os.ReadFile(workingPath)
	if len(pristine) == 0 {
		t.Fatal("working copy should be untouched, not truncated by a failed save")
	}
}

// TestPrivateSaveAsCorrectsVerifiesAndPreservesOriginal is the Phase 5
// acceptance test: the complete V0 mutation/correction oracle passes
// through the desktop service, the saved file verifies all 11 regions, and
// the original fixture is unchanged. The edit and expected SHA-256 match
// cmd/freebeamer's own TestPrivateBMWChecksumCLIEndToEnd oracle exactly, so
// both surfaces are checked against the same independently-reproduced hash.
func TestPrivateSaveAsCorrectsVerifiesAndPreservesOriginal(t *testing.T) {
	service, workingPath, originalPath := openPrivateWorkspaceCopy(t)
	originalBefore, err := os.ReadFile(originalPath)
	if err != nil {
		t.Fatal(err)
	}

	page, err := service.ListMaps(types.MapFilter{Query: "Performance gauge scaling"})
	if err != nil {
		t.Fatal(err)
	}
	mapID := -1
	for _, m := range page.Maps {
		if m.Title == "Performance gauge scaling" {
			mapID = m.ID
		}
	}
	if mapID < 0 {
		t.Fatalf("could not find 'Performance gauge scaling' in %#v", page.Maps)
	}
	if _, err := service.SetCell(mapID, 0, 0, 1.2); err != nil {
		t.Fatal(err)
	}

	verify, err := service.VerifyChecksums()
	if err != nil {
		t.Fatal(err)
	}
	if verify.Status != "invalid" {
		t.Fatalf("checksum status after the edit = %q, want invalid", verify.Status)
	}

	correctedPath := filepath.Join(t.TempDir(), "corrected.bin")
	outcome, err := service.SaveAs(correctedPath)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Provider != "bosch.mevd17.2.6.75P9EJ0B" {
		t.Fatalf("provider = %q", outcome.Provider)
	}
	if outcome.RegionsVerified != 11 {
		t.Fatalf("RegionsVerified = %d, want 11", outcome.RegionsVerified)
	}
	if outcome.WasAlreadyValid {
		t.Fatal("WasAlreadyValid = true, want false: the edit broke the checksum before saving")
	}

	const oracleSHA = "698dc5eb0a18923464d978a41880883789355c0d42f25096945e61b080f6a737"
	if outcome.SHA256 != oracleSHA {
		t.Fatalf("outcome.SHA256 = %s, want the independent oracle %s", outcome.SHA256, oracleSHA)
	}

	saved, err := os.ReadFile(correctedPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := hex.EncodeToString(func() []byte { sum := sha256.Sum256(saved); return sum[:] }()); got != oracleSHA {
		t.Fatalf("saved file SHA-256 = %s, want %s", got, oracleSHA)
	}

	registry, err := checksum.NewRegistry(mevd1726.New())
	if err != nil {
		t.Fatal(err)
	}
	_, results, err := registry.Verify(saved)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 11 || !checksum.AllValid(results) {
		t.Fatalf("independent verification of the saved file: %d results, allValid=%v", len(results), checksum.AllValid(results))
	}

	originalAfter, err := os.ReadFile(originalPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(originalBefore, originalAfter) {
		t.Fatal("the original fixture was modified")
	}

	workingAfter, err := os.ReadFile(workingPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(originalBefore, workingAfter) {
		t.Fatal("SaveAs must not modify the workspace's own BIN file on disk")
	}
}
