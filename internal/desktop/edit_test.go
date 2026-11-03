package desktop

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/freebeamer/core/pkg/binfile"
	"github.com/freebeamer/core/pkg/calibration"
	"github.com/freebeamer/core/pkg/types"
)

func operationRequest(operation types.CellOperation, operand float64) types.CellOperationRequest {
	return types.CellOperationRequest{
		Generation: 1,
		MapID:      0,
		Selection:  types.CellRange{StartRow: 0, StartColumn: 0, EndRow: 1, EndColumn: 1},
		Operation:  operation,
		Operand:    operand,
	}
}

func decodedValues(t *testing.T, service *Service) [][]float64 {
	t.Helper()
	detail, err := service.GetMap(0)
	if err != nil {
		t.Fatal(err)
	}
	return detail.ZValues
}

func TestApplyCellOperationTransformsCalculatedSelection(t *testing.T) {
	tests := []struct {
		name      string
		operation types.CellOperation
		operand   float64
		want      [][]float64
	}{
		{"fill", types.CellOperationFill, 7, [][]float64{{7, 7}, {7, 7}}},
		{"offset", types.CellOperationOffset, -1, [][]float64{{0, 1}, {2, 3}}},
		{"multiply", types.CellOperationMultiply, 2, [][]float64{{2, 4}, {6, 8}}},
		{"divide", types.CellOperationDivide, 2, [][]float64{{0.5, 1}, {1.5, 2}}},
		{"scale percent", types.CellOperationScalePercent, 50, [][]float64{{1.5, 3}, {4.5, 6}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := openBasicWorkspace(t)
			outcome, err := service.ApplyCellOperation(operationRequest(test.operation, test.operand))
			if err != nil {
				t.Fatal(err)
			}
			if outcome.SelectedCells != 4 || outcome.ChangedCells != 4 || outcome.UnchangedCells != 0 || !outcome.CanUndo {
				t.Fatalf("outcome = %#v", outcome)
			}
			if got := decodedValues(t, service); !equalValues(got, test.want) {
				t.Fatalf("values = %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestApplyCellOperationNormalizesRangeAndUndoRedoIsOneTransaction(t *testing.T) {
	service := openBasicWorkspace(t)
	request := operationRequest(types.CellOperationOffset, 1)
	request.Selection = types.CellRange{StartRow: 1, StartColumn: 1, EndRow: 0, EndColumn: 0}
	if _, err := service.ApplyCellOperation(request); err != nil {
		t.Fatal(err)
	}
	if got := decodedValues(t, service); !equalValues(got, [][]float64{{2, 3}, {4, 5}}) {
		t.Fatalf("after Apply = %#v", got)
	}
	if _, err := service.Undo(); err != nil {
		t.Fatal(err)
	}
	if got := decodedValues(t, service); !equalValues(got, [][]float64{{1, 2}, {3, 4}}) {
		t.Fatalf("after one Undo = %#v", got)
	}
	if _, err := service.Undo(); !errors.Is(err, ErrNothingToUndo) {
		t.Fatalf("second Undo error = %v, want ErrNothingToUndo", err)
	}
	if _, err := service.Redo(); err != nil {
		t.Fatal(err)
	}
	if got := decodedValues(t, service); !equalValues(got, [][]float64{{2, 3}, {4, 5}}) {
		t.Fatalf("after one Redo = %#v", got)
	}
}

func TestApplyCellOperationFailureRollsBackEveryCellAndHistory(t *testing.T) {
	service := openBasicWorkspace(t)
	request := operationRequest(types.CellOperationOffset, 6550) // early cells fit uint16; the final cell does not
	if _, err := service.ApplyCellOperation(request); err == nil {
		t.Fatal("expected range failure")
	}
	if got := decodedValues(t, service); !equalValues(got, [][]float64{{1, 2}, {3, 4}}) {
		t.Fatalf("values after failed transaction = %#v", got)
	}
	if _, err := service.Undo(); !errors.Is(err, ErrNothingToUndo) {
		t.Fatalf("Undo error = %v, want no history", err)
	}
}

func TestApplyCellOperationNoOpCreatesNoHistory(t *testing.T) {
	service := openBasicWorkspace(t)
	request := operationRequest(types.CellOperationOffset, 0)
	outcome, err := service.ApplyCellOperation(request)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.ChangedCells != 0 || outcome.UnchangedCells != 4 || outcome.CanUndo {
		t.Fatalf("outcome = %#v", outcome)
	}
}

func TestApplyCellOperationRejectsInvalidRequests(t *testing.T) {
	tests := []types.CellOperationRequest{
		operationRequest(types.CellOperationDivide, 0),
		operationRequest(types.CellOperation("unknown"), 1),
		operationRequest(types.CellOperationOffset, math.Inf(1)),
	}
	for _, request := range tests {
		service := openBasicWorkspace(t)
		if _, err := service.ApplyCellOperation(request); err == nil {
			t.Fatalf("expected request %#v to fail", request)
		}
	}
}

func TestApplyCellOperationRejectsARequestFromThePreviousWorkspace(t *testing.T) {
	service := openBasicWorkspace(t)
	request := operationRequest(types.CellOperationOffset, 1)
	if _, err := service.OpenWorkspace(basicXDF(), fittingBIN(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ApplyCellOperation(request); err == nil || !strings.Contains(err.Error(), "stale workspace generation") {
		t.Fatalf("error = %v, want stale generation", err)
	}
	if got := decodedValues(t, service); !equalValues(got, [][]float64{{1, 2}, {3, 4}}) {
		t.Fatalf("replacement workspace was mutated: %#v", got)
	}
}

func TestApplyCellOperationHandlesRepresentativeLargeSelection(t *testing.T) {
	const side = 32
	path := filepath.Join(t.TempDir(), "large.bin")
	if err := os.WriteFile(path, make([]byte, 4096), 0o600); err != nil {
		t.Fatal(err)
	}
	image, err := binfile.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	address := uint64(0)
	definition := &types.MapDefinition{
		Memory: types.MapMemory{Segments: []types.MemorySegment{{Start: 0, Size: 4096}}},
		Parameters: []types.MapParameter{{
			Name:       "Large table",
			Layout:     types.DataLayout{Address: &address, DataType: "uint16", ByteOrder: "little", Dimensions: []int{side, side}, Order: "row-major"},
			Conversion: types.IdentityConversion(),
		}},
	}
	decoder, err := calibration.New(definition, image)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService()
	service.workspace = &workspace{generation: 1, definition: definition, image: image, decoder: decoder}
	request := types.CellOperationRequest{
		Generation: 1, MapID: 0, Operation: types.CellOperationFill, Operand: 42,
		Selection: types.CellRange{StartRow: 0, StartColumn: 0, EndRow: side - 1, EndColumn: side - 1},
	}
	outcome, err := service.ApplyCellOperation(request)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.SelectedCells != side*side || outcome.ChangedCells != side*side || outcome.ChangedBytes != side*side {
		t.Fatalf("outcome = %#v", outcome)
	}
	if _, err := service.Undo(); err != nil {
		t.Fatal(err)
	}
	if got := len(image.Diff()); got != 0 {
		t.Fatalf("changed bytes after one Undo = %d", got)
	}
}

func equalValues(got, want [][]float64) bool {
	if len(got) != len(want) {
		return false
	}
	for row := range got {
		if len(got[row]) != len(want[row]) {
			return false
		}
		for column := range got[row] {
			if math.Abs(got[row][column]-want[row][column]) > 1e-9 {
				return false
			}
		}
	}
	return true
}

func TestSetCellWithoutWorkspace(t *testing.T) {
	if _, err := NewService().SetCell(0, 0, 0, 1); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("err = %v, want ErrNoWorkspace", err)
	}
}

func TestSetIndexWithoutWorkspace(t *testing.T) {
	if _, err := NewService().SetIndex(0, 0, 1); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("err = %v, want ErrNoWorkspace", err)
	}
}

func TestUndoRedoWithoutWorkspace(t *testing.T) {
	service := NewService()
	if _, err := service.Undo(); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("Undo err = %v, want ErrNoWorkspace", err)
	}
	if _, err := service.Redo(); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("Redo err = %v, want ErrNoWorkspace", err)
	}
}

func TestGetDiffWithoutWorkspace(t *testing.T) {
	if _, err := NewService().GetDiff(); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("err = %v, want ErrNoWorkspace", err)
	}
}

// basic.xdf's "Boost target" (map id 0) is a 2x2 matrix: Z formula "X*0.1",
// 16-bit little-endian cells at 0x200 (row-major), decoded from
// fittingBIN's raw {10,20,30,40} as {{1,2},{3,4}}.

func TestSetCellAppliesEditAndTracksHistory(t *testing.T) {
	service := openBasicWorkspace(t)
	outcome, err := service.SetCell(0, 0, 0, 5.0)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.MapID != 0 || outcome.Row != 0 || outcome.Column != 0 || outcome.Index != -1 {
		t.Fatalf("outcome location = %#v", outcome)
	}
	if outcome.Raw != 50 || outcome.Encoded != 5.0 || outcome.Address != "0x200" {
		t.Fatalf("outcome value = %#v", outcome)
	}
	if outcome.ChangedBytes != 1 {
		t.Fatalf("ChangedBytes = %d, want 1 (only the low byte at 0x200 changes)", outcome.ChangedBytes)
	}
	if !outcome.CanUndo || outcome.CanRedo {
		t.Fatalf("CanUndo/CanRedo = %v/%v, want true/false", outcome.CanUndo, outcome.CanRedo)
	}

	summary, err := service.GetWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	if summary.EditCount != 1 || summary.ChangedBytes != 1 || !summary.CanUndo || summary.CanRedo {
		t.Fatalf("workspace summary after edit = %#v", summary)
	}
}

func TestSetIndexMatchesEquivalentSetCell(t *testing.T) {
	service := openBasicWorkspace(t)
	outcome, err := service.SetIndex(0, 3, 9.0) // 3 = row 1, column 1 in a 2-column table
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Row != 1 || outcome.Column != 1 || outcome.Index != 3 {
		t.Fatalf("outcome location = %#v", outcome)
	}
	if outcome.Raw != 90 {
		t.Fatalf("Raw = %g, want 90", outcome.Raw)
	}
}

func TestSetCellRejectsOutOfRangeCell(t *testing.T) {
	service := openBasicWorkspace(t)
	if _, err := service.SetCell(0, 5, 5, 1.0); err == nil {
		t.Fatal("expected an error for an out-of-range cell")
	}
}

func TestSetCellRejectsUnknownMap(t *testing.T) {
	service := openBasicWorkspace(t)
	if _, err := service.SetCell(99, 0, 0, 1.0); err == nil {
		t.Fatal("expected an error for an unknown map id")
	}
}

func TestUndoRestoresPreviousValueAndRedoReappliesEdit(t *testing.T) {
	service := openBasicWorkspace(t)
	if _, err := service.SetCell(0, 0, 0, 5.0); err != nil {
		t.Fatal(err)
	}

	undone, err := service.Undo()
	if err != nil {
		t.Fatal(err)
	}
	if undone.Raw != 10 || undone.Encoded != 1.0 {
		t.Fatalf("undo outcome = %#v, want the original raw=10/value=1.0", undone)
	}
	if undone.CanUndo || !undone.CanRedo {
		t.Fatalf("CanUndo/CanRedo after undo = %v/%v, want false/true", undone.CanUndo, undone.CanRedo)
	}
	if summary, err := service.GetWorkspace(); err != nil || summary.EditCount != 0 || summary.ChangedBytes != 0 {
		t.Fatalf("workspace summary after undo = %#v, err=%v", summary, err)
	}

	redone, err := service.Redo()
	if err != nil {
		t.Fatal(err)
	}
	if redone.Raw != 50 || redone.Encoded != 5.0 {
		t.Fatalf("redo outcome = %#v, want raw=50/value=5.0", redone)
	}
	if !redone.CanUndo || redone.CanRedo {
		t.Fatalf("CanUndo/CanRedo after redo = %v/%v, want true/false", redone.CanUndo, redone.CanRedo)
	}
}

func TestUndoWithoutHistory(t *testing.T) {
	service := openBasicWorkspace(t)
	if _, err := service.Undo(); !errors.Is(err, ErrNothingToUndo) {
		t.Fatalf("err = %v, want ErrNothingToUndo", err)
	}
}

func TestRedoWithoutHistory(t *testing.T) {
	service := openBasicWorkspace(t)
	if _, err := service.Redo(); !errors.Is(err, ErrNothingToRedo) {
		t.Fatalf("err = %v, want ErrNothingToRedo", err)
	}
}

func TestNewEditClearsRedoHistory(t *testing.T) {
	service := openBasicWorkspace(t)
	if _, err := service.SetCell(0, 0, 0, 5.0); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Undo(); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetCell(0, 0, 1, 7.0); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Redo(); !errors.Is(err, ErrNothingToRedo) {
		t.Fatalf("err = %v, want ErrNothingToRedo after a new edit superseded the undone one", err)
	}
}

func TestGetDiffGroupsByEditAndReflectsOnlyActiveEdits(t *testing.T) {
	service := openBasicWorkspace(t)
	if _, err := service.SetCell(0, 0, 0, 5.0); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetCell(0, 1, 1, 9.0); err != nil {
		t.Fatal(err)
	}
	diff, err := service.GetDiff()
	if err != nil {
		t.Fatal(err)
	}
	if diff.ChangedBytes != 2 || len(diff.Edits) != 2 {
		t.Fatalf("diff = %#v", diff)
	}
	if diff.Edits[0].Row != 0 || diff.Edits[0].Column != 0 || diff.Edits[0].AfterRaw != 50 {
		t.Fatalf("first edit = %#v", diff.Edits[0])
	}
	if diff.Edits[1].Row != 1 || diff.Edits[1].Column != 1 || diff.Edits[1].AfterRaw != 90 {
		t.Fatalf("second edit = %#v", diff.Edits[1])
	}

	if _, err := service.Undo(); err != nil {
		t.Fatal(err)
	}
	diff, err = service.GetDiff()
	if err != nil {
		t.Fatal(err)
	}
	if diff.ChangedBytes != 1 || len(diff.Edits) != 1 {
		t.Fatalf("diff after undo = %#v, want only the remaining active edit", diff)
	}
}

func TestEditingRefusedWhenRegionDoesNotFit(t *testing.T) {
	service := NewService()
	tooSmall := filepath.Join(t.TempDir(), "too-small.bin")
	if err := os.WriteFile(tooSmall, make([]byte, 0x208), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.OpenWorkspace(basicXDF(), tooSmall); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetCell(0, 0, 0, 5.0); err == nil {
		t.Fatal("expected editing to be refused when the region does not fit")
	}
}

// TestPrivatePerformanceGaugeEditUndoRedo is the Phase 4 acceptance test:
// the Performance gauge edit changes exactly the expected byte, undo
// restores the original hash, and redo restores the same modified hash.
func TestPrivatePerformanceGaugeEditUndoRedo(t *testing.T) {
	xdfPath := filepath.Join("..", "..", "testdata", "private", "00000FEF81A001.xdf")
	if _, err := os.Stat(xdfPath); errors.Is(err, os.ErrNotExist) {
		t.Skip("private BMW fixtures are not installed")
	} else if err != nil {
		t.Fatal(err)
	}

	binPath := filepath.Join(t.TempDir(), "synthetic-4mib.bin")
	original := make([]byte, 4*1024*1024)
	if err := os.WriteFile(binPath, original, 0o600); err != nil {
		t.Fatal(err)
	}
	originalHash := sha256.Sum256(original)

	service := NewService()
	if _, err := service.OpenWorkspace(xdfPath, binPath); err != nil {
		t.Fatal(err)
	}
	page, err := service.ListMaps(types.MapFilter{Query: "Performance gauge scaling"})
	if err != nil {
		t.Fatal(err)
	}
	var mapID = -1
	for _, m := range page.Maps {
		if m.Title == "Performance gauge scaling" {
			mapID = m.ID
			break
		}
	}
	if mapID < 0 {
		t.Fatalf("could not find 'Performance gauge scaling' in %#v", page.Maps)
	}

	outcome, err := service.SetCell(mapID, 0, 0, 1.23)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Raw != 12 || outcome.Address != "0x18171c" || outcome.ChangedBytes != 1 {
		t.Fatalf("outcome = %#v, want raw=12 address=0x18171c changedBytes=1", outcome)
	}

	afterEdit, err := service.GetWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	modifiedHash := afterEdit.ROM.SHA256
	if modifiedHash == hex.EncodeToString(originalHash[:]) {
		t.Fatal("ROM hash did not change after the edit")
	}

	if _, err := service.Undo(); err != nil {
		t.Fatal(err)
	}
	afterUndo, err := service.GetWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	if afterUndo.ROM.SHA256 != hex.EncodeToString(originalHash[:]) {
		t.Fatalf("hash after undo = %s, want the original hash %s", afterUndo.ROM.SHA256, hex.EncodeToString(originalHash[:]))
	}

	if _, err := service.Redo(); err != nil {
		t.Fatal(err)
	}
	afterRedo, err := service.GetWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	if afterRedo.ROM.SHA256 != modifiedHash {
		t.Fatalf("hash after redo = %s, want the modified hash %s", afterRedo.ROM.SHA256, modifiedHash)
	}
}
