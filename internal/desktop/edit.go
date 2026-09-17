package desktop

import (
	"bytes"
	"errors"
	"fmt"
	"math"

	"github.com/freebeamer/core/pkg/calibration"
	"github.com/freebeamer/core/pkg/expression"
	"github.com/freebeamer/core/pkg/types"
)

var (
	ErrNothingToUndo = errors.New("desktop: no edit to undo")
	ErrNothingToRedo = errors.New("desktop: no edit to redo")
)

// cellChange captures exact bytes and display values for one changed cell.
// Undo and Redo never re-run conversions or table operations.
type cellChange struct {
	mapID       int
	mapTitle    string
	row, column int
	index       int
	offset      uint64
	before      []byte
	after       []byte
	beforeRaw   int64
	afterRaw    int64
	beforeValue float64
	afterValue  float64
	requested   float64
}

// editTransaction is one user action and may contain one or many cell changes.
type editTransaction struct {
	changes []cellChange
}

func (s *Service) SetCell(mapID, row, column int, value float64) (types.EditOutcome, error) {
	return s.applySingleEdit(mapID, row, column, -1, value)
}

func (s *Service) SetIndex(mapID, index int, value float64) (types.EditOutcome, error) {
	return s.applySingleEdit(mapID, -1, -1, index, value)
}

func (s *Service) applySingleEdit(mapID, row, column, index int, value float64) (types.EditOutcome, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	ws, parameter, before, row, column, err := s.editContextLocked(mapID, row, column, index)
	if err != nil {
		return types.EditOutcome{}, err
	}
	result, err := ws.decoder.SetCell(parameter, row, column, value)
	if err != nil {
		return types.EditOutcome{}, err
	}
	change := cellChangeFromResult(mapID, parameter.Name, row, column, index, before, result, value)
	if !bytes.Equal(change.before, change.after) {
		ws.undo = append(ws.undo, editTransaction{changes: []cellChange{change}})
		ws.redo = nil
	}
	return s.outcomeLocked(change, result.Raw, result.Actual, value), nil
}

// ApplyCellOperation transforms a calculated-value selection. All cells commit
// as one history transaction, or the original image is restored on failure.
func (s *Service) ApplyCellOperation(request types.CellOperationRequest) (types.BatchEditOutcome, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if math.IsNaN(request.Operand) || math.IsInf(request.Operand, 0) {
		return types.BatchEditOutcome{}, expression.ErrNonFinite
	}
	if request.Operation == types.CellOperationDivide && request.Operand == 0 {
		return types.BatchEditOutcome{}, errors.New("desktop: cannot divide cells by zero")
	}
	if !validCellOperation(request.Operation) {
		return types.BatchEditOutcome{}, fmt.Errorf("desktop: unsupported cell operation %q", request.Operation)
	}
	if s.workspace == nil {
		return types.BatchEditOutcome{}, ErrNoWorkspace
	}
	if request.Generation != s.workspace.generation {
		return types.BatchEditOutcome{}, fmt.Errorf("desktop: stale workspace generation %d; current generation is %d", request.Generation, s.workspace.generation)
	}

	ws, parameter, decoded, _, _, err := s.editContextLocked(request.MapID, 0, 0, -1)
	if err != nil {
		return types.BatchEditOutcome{}, err
	}
	selection := normalizeRange(request.Selection)
	rows := len(decoded.Z)
	columns := 0
	if rows > 0 {
		columns = len(decoded.Z[0])
	}
	if selection.StartRow < 0 || selection.StartColumn < 0 || selection.EndRow >= rows || selection.EndColumn >= columns {
		return types.BatchEditOutcome{}, fmt.Errorf("%w: selection rows %d-%d columns %d-%d for %dx%d map",
			calibration.ErrCellOutOfRange, selection.StartRow, selection.EndRow, selection.StartColumn, selection.EndColumn, rows, columns)
	}

	snapshot := ws.image.Bytes()
	changes := make([]cellChange, 0, (selection.EndRow-selection.StartRow+1)*(selection.EndColumn-selection.StartColumn+1))
	minimum, maximum := math.Inf(1), math.Inf(-1)
	for row := selection.StartRow; row <= selection.EndRow; row++ {
		for column := selection.StartColumn; column <= selection.EndColumn; column++ {
			requested, operationErr := applyOperation(decoded.Z[row][column], request.Operation, request.Operand)
			if operationErr != nil {
				_ = ws.image.Write(0, snapshot)
				return types.BatchEditOutcome{}, fmt.Errorf("desktop: transform row %d column %d: %w", row, column, operationErr)
			}
			result, editErr := ws.decoder.SetCell(parameter, row, column, requested)
			if editErr != nil {
				_ = ws.image.Write(0, snapshot)
				return types.BatchEditOutcome{}, fmt.Errorf("desktop: edit row %d column %d with value %g: %w", row, column, requested, editErr)
			}
			minimum = math.Min(minimum, result.Actual)
			maximum = math.Max(maximum, result.Actual)
			change := cellChangeFromResult(request.MapID, parameter.Name, row, column, -1, decoded, result, requested)
			if !bytes.Equal(change.before, change.after) {
				changes = append(changes, change)
			}
		}
	}

	selectedCells := (selection.EndRow - selection.StartRow + 1) * (selection.EndColumn - selection.StartColumn + 1)
	if len(changes) > 0 {
		ws.undo = append(ws.undo, editTransaction{changes: changes})
		ws.redo = nil
	}
	return types.BatchEditOutcome{
		MapID: request.MapID, MapTitle: parameter.Name, SelectedCells: selectedCells,
		ChangedCells: len(changes), UnchangedCells: selectedCells - len(changes),
		Minimum: minimum, Maximum: maximum, ChangedBytes: len(ws.image.Diff()),
		CanUndo: len(ws.undo) > 0, CanRedo: len(ws.redo) > 0,
	}, nil
}

func (s *Service) editContextLocked(mapID, row, column, index int) (*workspace, types.MapParameter, *types.DecodedTable, int, int, error) {
	if s.workspace == nil {
		return nil, types.MapParameter{}, nil, 0, 0, ErrNoWorkspace
	}
	ws := s.workspace
	if mapID < 0 || mapID >= len(ws.definition.Parameters) {
		return nil, types.MapParameter{}, nil, 0, 0, fmt.Errorf("desktop: no map with id %d", mapID)
	}
	parameter := ws.definition.Parameters[mapID]
	if allowed, reason := s.editingAllowedLocked(); !allowed {
		return nil, types.MapParameter{}, nil, 0, 0, fmt.Errorf("desktop: editing is refused for this workspace: %s", reason)
	}
	decoded, err := ws.decoder.DecodeParameter(parameter)
	if err != nil {
		return nil, types.MapParameter{}, nil, 0, 0, fmt.Errorf("decode before edit: %w", err)
	}
	rows := len(decoded.Z)
	columns := 0
	if rows > 0 {
		columns = len(decoded.Z[0])
	}
	if index >= 0 {
		if columns == 0 || index >= rows*columns {
			return nil, types.MapParameter{}, nil, 0, 0, fmt.Errorf("%w: index %d for %d-cell map", calibration.ErrCellOutOfRange, index, rows*columns)
		}
		row, column = index/columns, index%columns
	}
	if row < 0 || row >= rows || column < 0 || column >= columns {
		return nil, types.MapParameter{}, nil, 0, 0, fmt.Errorf("%w: row %d column %d for %dx%d map", calibration.ErrCellOutOfRange, row, column, rows, columns)
	}
	return ws, parameter, decoded, row, column, nil
}

func cellChangeFromResult(mapID int, mapTitle string, row, column, index int, before *types.DecodedTable, result *types.CalibrationEditResult, requested float64) cellChange {
	return cellChange{
		mapID: mapID, mapTitle: mapTitle, row: row, column: column, index: index,
		offset: result.Offset, before: result.Previous, after: result.Bytes,
		beforeRaw: before.Raw.Z[row][column], afterRaw: result.Raw,
		beforeValue: before.Z[row][column], afterValue: result.Actual, requested: requested,
	}
}

func normalizeRange(selection types.CellRange) types.CellRange {
	if selection.StartRow > selection.EndRow {
		selection.StartRow, selection.EndRow = selection.EndRow, selection.StartRow
	}
	if selection.StartColumn > selection.EndColumn {
		selection.StartColumn, selection.EndColumn = selection.EndColumn, selection.StartColumn
	}
	return selection
}

func validCellOperation(operation types.CellOperation) bool {
	switch operation {
	case types.CellOperationFill, types.CellOperationOffset, types.CellOperationMultiply, types.CellOperationDivide, types.CellOperationScalePercent:
		return true
	default:
		return false
	}
}

func applyOperation(value float64, operation types.CellOperation, operand float64) (float64, error) {
	var result float64
	switch operation {
	case types.CellOperationFill:
		result = operand
	case types.CellOperationOffset:
		result = value + operand
	case types.CellOperationMultiply:
		result = value * operand
	case types.CellOperationDivide:
		if operand == 0 {
			return 0, errors.New("cannot divide by zero")
		}
		result = value / operand
	case types.CellOperationScalePercent:
		result = value * (1 + operand/100)
	default:
		return 0, fmt.Errorf("unsupported operation %q", operation)
	}
	if math.IsNaN(result) || math.IsInf(result, 0) {
		return 0, expression.ErrNonFinite
	}
	return result, nil
}

func (s *Service) Undo() (types.EditOutcome, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.workspace == nil {
		return types.EditOutcome{}, ErrNoWorkspace
	}
	ws := s.workspace
	if len(ws.undo) == 0 {
		return types.EditOutcome{}, ErrNothingToUndo
	}
	transaction := ws.undo[len(ws.undo)-1]
	ws.undo = ws.undo[:len(ws.undo)-1]
	for index := len(transaction.changes) - 1; index >= 0; index-- {
		change := transaction.changes[index]
		if err := ws.image.Write(change.offset, change.before); err != nil {
			for restore := index + 1; restore < len(transaction.changes); restore++ {
				applied := transaction.changes[restore]
				_ = ws.image.Write(applied.offset, applied.after)
			}
			ws.undo = append(ws.undo, transaction)
			return types.EditOutcome{}, err
		}
	}
	ws.redo = append(ws.redo, transaction)
	change := transaction.changes[len(transaction.changes)-1]
	return s.outcomeLocked(change, change.beforeRaw, change.beforeValue, change.requested), nil
}

func (s *Service) Redo() (types.EditOutcome, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.workspace == nil {
		return types.EditOutcome{}, ErrNoWorkspace
	}
	ws := s.workspace
	if len(ws.redo) == 0 {
		return types.EditOutcome{}, ErrNothingToRedo
	}
	transaction := ws.redo[len(ws.redo)-1]
	ws.redo = ws.redo[:len(ws.redo)-1]
	for index, change := range transaction.changes {
		if err := ws.image.Write(change.offset, change.after); err != nil {
			for restore := index - 1; restore >= 0; restore-- {
				applied := transaction.changes[restore]
				_ = ws.image.Write(applied.offset, applied.before)
			}
			ws.redo = append(ws.redo, transaction)
			return types.EditOutcome{}, err
		}
	}
	ws.undo = append(ws.undo, transaction)
	change := transaction.changes[len(transaction.changes)-1]
	return s.outcomeLocked(change, change.afterRaw, change.afterValue, change.requested), nil
}

func (s *Service) GetDiff() (types.DiffSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.workspace == nil {
		return types.DiffSummary{}, ErrNoWorkspace
	}
	ws := s.workspace
	edits := make([]types.EditDiff, 0)
	for _, transaction := range ws.undo {
		for _, change := range transaction.changes {
			edits = append(edits, types.EditDiff{
				MapID: change.mapID, MapTitle: change.mapTitle, Row: change.row, Column: change.column,
				Index: change.index, Address: hexAddress(change.offset), BeforeRaw: change.beforeRaw,
				AfterRaw: change.afterRaw, BeforeValue: change.beforeValue, AfterValue: change.afterValue,
			})
		}
	}
	return types.DiffSummary{ChangedBytes: len(ws.image.Diff()), Edits: edits}, nil
}

func (s *Service) editingAllowedLocked() (bool, string) {
	ws := s.workspace
	regionFits := ws.definition.MemoryFits(ws.image.Size())
	checksumSummary := summarizeChecksum(s.checksums, ws.image.Bytes())
	return evaluateEditingGate(regionFits, checksumSummary)
}

func (s *Service) outcomeLocked(change cellChange, raw int64, value float64, requested float64) types.EditOutcome {
	ws := s.workspace
	return types.EditOutcome{
		MapID: change.mapID, MapTitle: change.mapTitle, Row: change.row, Column: change.column, Index: change.index,
		Requested: requested, Encoded: value, Raw: raw, Address: hexAddress(change.offset),
		ChangedBytes: len(ws.image.Diff()), CanUndo: len(ws.undo) > 0, CanRedo: len(ws.redo) > 0,
	}
}
