import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Directive, ElementRef, HostListener, OnDestroy, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import type { Data, PlotHoverEvent, PlotMouseEvent } from 'plotly.js';
import { DesktopGateway } from '../core/desktop-gateway';
import { EditHistoryStore } from '../workspace/edit-history-store';
import { WorkspaceStore } from '../workspace/workspace-store';
import { ActiveEditorStore, CellRange } from '../shell/active-editor-store';
import { PlotlyChart } from '../visualization/plotly-chart';
import {
  buildHeatmapTrace,
  buildLineTrace,
  buildSurfaceTrace,
  buildOperatingPointTrace,
  buildSelectionTrace,
  heatmapLayout,
  lineIndexToCell,
  lineLayout,
  matrixPointToCell,
  isSurfaceEligible,
  surfaceIneligibleReason,
  surfaceLayout,
} from '../visualization/traces';
import { CHART_CONFIG, valueGradientColor } from '../visualization/theme';
import type { types } from '../../../wailsjs/go/models';
import { LiveStore } from '../live-data/live-store';
import { OperatingPointStore } from '../operating-point/operating-point-store';
import { OperatingPoint, describeReading, operatingPoint as locateOperatingPoint } from '../operating-point/operating-point';

interface CellSelection {
  row: number;
  column: number;
}

export type ViewMode = 'grid' | 'line' | 'heatmap' | 'surface';
export interface MapLoadedEvent { shape: string; rows: number; columns: number; }

/** The native `autofocus` attribute isn't reliably honored by every
 * embedding WebView (notably WebKitGTK) for elements a framework inserts
 * after the initial page load, so the cell-edit input focuses itself here
 * instead of relying on it. */
@Directive({ selector: 'input[appAutofocus]', standalone: true })
class AutofocusInput {
  private readonly host = inject(ElementRef<HTMLInputElement>);

  constructor() {
    // Deferred past the current render (rather than done in ngAfterViewInit,
    // which runs mid change-detection cycle): focus() synchronously fires a
    // native focusin event, which bubbles to the map-editor container's own
    // (focusin) handler and writes to a signal shared app-wide — doing that
    // while Angular is still mid-cycle triggered a reentrant CD pass
    // ("detectChangesInViewWhileDirty"), which repeated on every keystroke's
    // focus and read as the app hanging.
    afterNextRender(() => {
      this.host.nativeElement.focus();
      this.host.nativeElement.select();
    });
  }
}

@Component({
  selector: 'app-map-editor',
  standalone: true,
  imports: [DecimalPipe, PlotlyChart, CdkDrag, CdkDragHandle, AutofocusInput],
  templateUrl: './map-editor.html',
  styleUrl: './map-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapEditor implements OnDestroy {
  readonly mapId = input.required<number>();
  readonly mapLoaded = output<MapLoadedEvent>();
  readonly layoutChanged = output<void>();

  private readonly gateway = inject(DesktopGateway);
  private readonly workspace = inject(WorkspaceStore);
  private readonly activeEditor = inject(ActiveEditorStore);
  private readonly operatingPoints = inject(OperatingPointStore);
  private readonly live = inject(LiveStore);
  protected readonly editHistory = inject(EditHistoryStore);
  private requestGeneration = 0;
  private readonly chartDrag = viewChild(CdkDrag);
  private readonly chart = viewChild(PlotlyChart);

  protected readonly detail = signal<types.MapDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly selected = signal<CellSelection | null>(null);
  private readonly selectionAnchor = signal<CellSelection | null>(null);
  private pointerSelecting = false;
  private pointerDragged = false;
  protected readonly selectionRange = computed<CellRange | null>(() => {
    const anchor = this.selectionAnchor();
    const focus = this.selected();
    if (!anchor || !focus) return null;
    return { startRow: anchor.row, startColumn: anchor.column, endRow: focus.row, endColumn: focus.column };
  });
  protected readonly selectionCount = computed(() => {
    const range = this.selectionRange();
    if (!range) return 0;
    return (Math.abs(range.endRow - range.startRow) + 1) * (Math.abs(range.endColumn - range.startColumn) + 1);
  });
  protected readonly viewMode = signal<ViewMode>('grid');
  protected readonly chartVisible = signal(false);
  protected readonly chartDetached = signal(false);
  protected readonly chartRenderFailed = signal(false);
  protected readonly dirtyCells = signal<ReadonlySet<string>>(new Set());
  private chartHeightMeasured = false;

  protected readonly editingCell = signal<CellSelection | null>(null);
  protected readonly editValue = signal('');
  private readonly editInitialValue = signal('');
  protected readonly editError = signal('');

  protected readonly canEdit = computed(() => this.workspace.summary()?.editingAllowed ?? false);

  protected readonly showColumnHeaders = computed(() => (this.detail()?.columns ?? 0) > 1);
  protected readonly showRowHeaders = computed(() => (this.detail()?.rows ?? 0) > 1);

  protected readonly selectedRaw = computed(() => this.cellAt(this.detail()?.zRaw));
  protected readonly selectedValue = computed(() => this.cellAt(this.detail()?.zValues));
  protected readonly selectedAddress = computed(() => this.cellAt(this.detail()?.zAddresses));
  protected readonly selectedDirty = computed(() => {
    const cell = this.selected();
    return !!cell && this.isDirty(cell.row, cell.column);
  });

  /** Per-cell background colors, blue (lowest decoded value in this map) to
   * red (highest), so relative magnitude is visible at a glance. */
  protected readonly cellColors = computed<string[][]>(() => {
    const zValues = this.detail()?.zValues;
    if (!zValues) {
      return [];
    }
    const { min, max } = this.visualRange();
    return zValues.map((row) => row.map((value) => valueGradientColor(value, min, max)));
  });

  protected readonly visualRange = computed(() => {
    const flat = this.detail()?.zValues?.flat() ?? [];
    return { min: flat.length ? Math.min(...flat) : 0, max: flat.length ? Math.max(...flat) : 0 };
  });
  protected readonly legendGradient = computed(() => {
    const { min, max } = this.visualRange();
    const stops = Array.from({ length: 9 }, (_, index) => {
      const position = index / 8;
      return `${valueGradientColor(min + (max - min) * position, min, max)} ${position * 100}%`;
    });
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  });

  // The operating-point overlay is opt-in and purely visual: it never reads or
  // writes edit selection, undo history or BIN bytes.
  protected readonly showOperatingPoint = signal(false);
  protected readonly operatingBindings = computed(() => this.operatingPoints.bindingsFor(this.detail()?.parameterId));
  protected readonly operatingAssociation = this.operatingPoints.association;
  protected readonly operatingPoint = computed<OperatingPoint | null>(() => {
    const detail = this.detail();
    const association = this.operatingAssociation();
    if (!this.showOperatingPoint() || !detail || !association) return null;
    return locateOperatingPoint(detail, this.operatingBindings(), this.live.latest(), association.source, this.live.freshness());
  });
  protected readonly operatingLines = computed(() => {
    const point = this.operatingPoint();
    const detail = this.detail();
    if (point?.kind !== 'point' || !detail) return [];
    return point.readings.map((reading) => reading.axis === 'x'
      ? describeReading(reading, detail.xValues ?? [], detail.x.units)
      : describeReading(reading, detail.yValues ?? [], detail.y.units));
  });

  private readonly operatingCells = computed(() => {
    const point = this.operatingPoint();
    return point?.kind === 'point' ? point.cells : null;
  });

  protected isOperatingCell(row: number, column: number): boolean {
    const cells = this.operatingCells();
    return !!cells && row >= cells.rows[0] && row <= cells.rows[1] && column >= cells.columns[0] && column <= cells.columns[1];
  }

  protected readonly surfaceEligible = computed(() => {
    const detail = this.detail();
    return detail !== null && isSurfaceEligible(detail);
  });
  protected readonly surfaceDisabledReason = computed(() => {
    const detail = this.detail();
    return detail ? surfaceIneligibleReason(detail) : null;
  });

  // Kept separate from chartData so clicking a point (which only moves the
  // small selection marker) doesn't rebuild the underlying trace: Plotly's
  // react() skips recalculating a trace whose object identity is unchanged
  // from the previous render, and for a 3D surface that recalculation means
  // rebuilding the whole WebGL mesh — expensive enough to make clicking feel
  // laggy if it ran on every selection change.
  private readonly baseChartTrace = computed<Data | null>(() => {
    const detail = this.detail();
    if (!detail) {
      return null;
    }
    switch (this.viewMode()) {
      case 'line':
        return buildLineTrace(detail, this.visualRange());
      case 'heatmap':
        return buildHeatmapTrace(detail, this.visualRange());
      case 'surface':
        return buildSurfaceTrace(detail, this.visualRange());
      default:
        return null;
    }
  });

  protected readonly chartData = computed<Data[]>(() => {
    const detail = this.detail();
    const trace = this.baseChartTrace();
    if (!detail || !trace) {
      return [];
    }
    const selection = buildSelectionTrace(detail, this.viewMode(), this.selected());
    const operating = buildOperatingPointTrace(detail, this.viewMode(), this.operatingPoint(), this.visualRange());
    return [trace, selection, operating].filter((item): item is Data => item !== null);
  });

  protected readonly chartLayout = computed(() => {
    const detail = this.detail();
    if (!detail) {
      return {};
    }
    switch (this.viewMode()) {
      case 'line':
        return lineLayout(detail);
      case 'heatmap':
        return heatmapLayout(detail);
      case 'surface':
        return surfaceLayout(detail);
      default:
        return {};
    }
  });

  protected readonly chartConfig = CHART_CONFIG;

  constructor() {
    effect(() => {
      const id = this.mapId();
      void this.loadFresh(id);
    });

    // Undo/redo (and edits made elsewhere) bump editHistory.revision(); this
    // map reloads to stay in sync without losing its own selection/view.
    // The first run is the initial mount, already handled by the effect
    // above, so it is skipped here.
    let sawFirstRevision = false;
    effect(() => {
      this.editHistory.revision();
      if (!sawFirstRevision) {
        sawFirstRevision = true;
        return;
      }
      const id = untracked(() => this.mapId());
      void this.refresh(id);
    });
  }

  ngOnDestroy(): void {
    this.activeEditor.clear(this.mapId());
  }

  protected retry(): void {
    void this.loadFresh(this.mapId());
  }

  protected setViewMode(mode: ViewMode): void {
    this.chartRenderFailed.set(false);
    this.viewMode.set(mode);
    this.chartHeightMeasured = false;
    this.layoutChanged.emit();
  }

  protected toggleChart(): void {
    const showing = !this.chartVisible();
    this.chartVisible.set(showing);
    if (showing) {
      this.chartHeightMeasured = false;
      setTimeout(() => this.chart()?.resize());
    }
    this.layoutChanged.emit();
  }

  protected toggleChartDetached(): void {
    this.chartVisible.set(true);
    const attaching = this.chartDetached();
    this.chartDetached.set(!attaching);
    setTimeout(() => {
      if (attaching) {
        this.chartDrag()?.reset();
      }
      this.chart()?.resize();
      this.layoutChanged.emit();
    });
    this.layoutChanged.emit();
  }

  /** Fires once per view becoming visible/changing, not on every data-only
   * redraw (e.g. moving the selection marker on a click): re-measuring the
   * panel here resizes its container, which resizes the chart's WebGL
   * canvas in turn — a full framebuffer reallocation and scene redraw, not
   * a cheap operation, so doing it on every click made clicking the 3D
   * surface feel like it froze. */
  protected onChartRendered(): void {
    if (this.chartHeightMeasured) {
      return;
    }
    this.chartHeightMeasured = true;
    this.layoutChanged.emit();
  }

  private async loadFresh(id: number): Promise<void> {
    const generation = ++this.requestGeneration;
    this.loading.set(true);
    this.errorMessage.set('');
    this.selected.set(null);
    this.selectionAnchor.set(null);
    this.viewMode.set('grid');
    this.chartVisible.set(false);
    this.chartDetached.set(false);
    this.chartRenderFailed.set(false);
    this.editingCell.set(null);
    this.showOperatingPoint.set(false);
    try {
      const detail = await this.gateway.getMap(id);
      if (generation !== this.requestGeneration) {
        return;
      }
      this.detail.set(detail);
      if (detail.shape === 'matrix') {
        this.viewMode.set(isSurfaceEligible(detail) ? 'surface' : 'heatmap');
      }
      this.mapLoaded.emit({ shape: detail.shape, rows: detail.rows, columns: detail.columns });
      const first = detail.rows > 0 && detail.columns > 0 ? { row: 0, column: 0 } : null;
      this.selected.set(first);
      this.selectionAnchor.set(first);
      void this.refreshDirtyCells(id);
    } catch (error) {
      if (generation !== this.requestGeneration) {
        return;
      }
      this.detail.set(null);
      this.errorMessage.set(error instanceof Error ? error.message : String(error));
    } finally {
      if (generation === this.requestGeneration) {
        this.loading.set(false);
      }
    }
  }

  /** Re-fetches this same map's detail without disturbing the current
   * selection or view — used after an edit, undo, or redo. */
  private async refresh(id: number): Promise<void> {
    const generation = ++this.requestGeneration;
    try {
      const detail = await this.gateway.getMap(id);
      if (generation !== this.requestGeneration) {
        return;
      }
      this.detail.set(detail);
      const cell = this.selected();
      if (cell && (cell.row >= detail.rows || cell.column >= detail.columns)) {
        const first = detail.rows > 0 && detail.columns > 0 ? { row: 0, column: 0 } : null;
        this.selected.set(first);
        this.selectionAnchor.set(first);
      }
      void this.refreshDirtyCells(id);
    } catch (error) {
      if (generation !== this.requestGeneration) {
        return;
      }
      this.errorMessage.set(error instanceof Error ? error.message : String(error));
    }
  }

  private async refreshDirtyCells(id: number): Promise<void> {
    try {
      const diff = await this.gateway.getDiff();
      const keys = new Set(diff.edits.filter((edit) => edit.mapId === id).map((edit) => `${edit.row}:${edit.column}`));
      this.dirtyCells.set(keys);
    } catch {
      // Dirty-cell shading is a decoration, not a source of truth — never
      // block the map on it.
    }
  }

  protected selectCell(row: number, column: number, extend = false): void {
    const cell = { row, column };
    if (!extend || !this.selectionAnchor()) this.selectionAnchor.set(cell);
    this.selected.set(cell);
    this.activateEditor();
  }

  protected isSelected(row: number, column: number): boolean {
    const range = this.selectionRange();
    if (!range) return false;
    const startRow = Math.min(range.startRow, range.endRow);
    const endRow = Math.max(range.startRow, range.endRow);
    const startColumn = Math.min(range.startColumn, range.endColumn);
    const endColumn = Math.max(range.startColumn, range.endColumn);
    return row >= startRow && row <= endRow && column >= startColumn && column <= endColumn;
  }

  protected onCellPointerDown(event: PointerEvent, row: number, column: number): void {
    if (event.button !== 0) return;
    // A pointerdown inside the cell currently being edited is the user
    // placing their caret in its input, not starting a range drag — leave
    // it to the input's own native text-selection behavior.
    if (this.isEditing(row, column)) return;
    // Otherwise, without this, dragging across cells to select a range also
    // drags out a native text selection underneath.
    event.preventDefault();
    (event.currentTarget as HTMLElement | null)?.closest('table')?.focus({ preventScroll: true });
    this.pointerSelecting = true;
    this.pointerDragged = false;
    this.selectCell(row, column, event.shiftKey);
  }

  protected onCellPointerEnter(row: number, column: number): void {
    if (this.pointerSelecting) {
      this.pointerDragged = true;
      this.selectCell(row, column, true);
    }
  }

  protected onCellClick(event: MouseEvent, row: number, column: number): void {
    if (this.pointerDragged) {
      this.pointerDragged = false;
      return;
    }
    this.selectCell(row, column, event.shiftKey);
  }

  /** Selects a whole column (every row) so dragging across header cells
   * extends the selection column-by-column, the way spreadsheet header
   * selection works — the anchor's row/selected's row are pinned to the
   * first/last row rather than following selectCell's normal single-cell
   * anchoring. */
  protected selectColumn(column: number, extend = false): void {
    const rows = this.detail()?.rows;
    if (!rows) return;
    const anchor = this.selectionAnchor();
    const anchorColumn = extend && anchor ? anchor.column : column;
    this.selectionAnchor.set({ row: 0, column: anchorColumn });
    this.selected.set({ row: rows - 1, column });
    this.activateEditor();
  }

  protected isColumnSelected(column: number): boolean {
    const range = this.selectionRange();
    if (!range) return false;
    const startColumn = Math.min(range.startColumn, range.endColumn);
    const endColumn = Math.max(range.startColumn, range.endColumn);
    return column >= startColumn && column <= endColumn;
  }

  protected onColumnHeaderPointerDown(event: PointerEvent, column: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement | null)?.closest('table')?.focus({ preventScroll: true });
    this.pointerSelecting = true;
    this.pointerDragged = false;
    this.selectColumn(column, event.shiftKey);
  }

  protected onColumnHeaderPointerEnter(column: number): void {
    if (this.pointerSelecting) {
      this.pointerDragged = true;
      this.selectColumn(column, true);
    }
  }

  protected onColumnHeaderClick(event: MouseEvent, column: number): void {
    if (this.pointerDragged) {
      this.pointerDragged = false;
      return;
    }
    this.selectColumn(column, event.shiftKey);
  }

  @HostListener('document:pointerup')
  protected endPointerSelection(): void { this.pointerSelecting = false; }

  protected activateEditor(): void {
    const detail = this.detail();
    const selection = this.selectionRange();
    if (!detail || !selection) return;
    this.activeEditor.activate({
      generation: this.workspace.summary()?.generation ?? 0,
      mapId: detail.id,
      title: detail.title,
      units: detail.z.units,
      editable: this.canEdit(),
      selection,
    });
  }

  protected isDirty(row: number, column: number): boolean {
    return this.dirtyCells().has(`${row}:${column}`);
  }

  protected cellColor(row: number, column: number): string | null {
    return this.cellColors()[row]?.[column] ?? null;
  }

  protected isEditing(row: number, column: number): boolean {
    const cell = this.editingCell();
    return !!cell && cell.row === row && cell.column === column;
  }

  protected columnLabel(column: number): string {
    const detail = this.detail();
    const value = detail?.x.addressed ? detail.xValues?.[column] : undefined;
    return value === undefined ? String(column) : this.formatNumber(value);
  }

  protected rowLabel(row: number): string {
    const detail = this.detail();
    const value = detail?.y.addressed ? detail.yValues?.[row] : undefined;
    return value === undefined ? String(row) : this.formatNumber(value);
  }

  protected formatNumber(value: number): string {
    if (Number.isInteger(value)) {
      return value.toString();
    }
    return Number(value.toFixed(4)).toString();
  }

  protected beginEditAt(row: number, column: number): void {
    this.selectCell(row, column);
    this.beginEdit();
  }

  protected beginEdit(): void {
    if (!this.canEdit()) {
      return;
    }
    const cell = this.selected();
    const value = this.selectedValue();
    if (!cell || value === null) {
      return;
    }
    this.activateEditor();
    this.editingCell.set(cell);
    const formatted = this.formatNumber(value);
    this.editValue.set(formatted);
    this.editInitialValue.set(formatted);
    this.editError.set('');
  }

  protected cancelEdit(): void {
    this.editingCell.set(null);
    this.editInitialValue.set('');
    this.editError.set('');
  }

  protected setEditValue(value: string): void {
    this.editValue.set(value);
  }

  protected async commitEdit(): Promise<void> {
    const cell = this.editingCell();
    const detail = this.detail();
    if (!cell || !detail) {
      return;
    }
    const entered = this.editValue().trim();
    const parsed = Number(entered);
    if (entered === '' || !Number.isFinite(parsed)) {
      this.editError.set('Enter a number');
      return;
    }
    // Focus/blur and equivalent textual forms (for example 850 -> 850.0)
    // are not edits. Avoid sending them to Go, where they would otherwise
    // create history/dirty state; comparing the original formatted text also
    // prevents display rounding from changing a higher-precision value.
    if (this.selectionCount() === 1 && (entered === this.editInitialValue() || parsed === this.selectedValue())) {
      this.cancelEdit();
      return;
    }
    try {
      if (this.selectionCount() > 1) {
        if (await this.activeEditor.apply('fill', parsed)) this.cancelEdit();
        else this.editError.set(this.activeEditor.error());
        return;
      }
      const outcome = await this.gateway.setCell(detail.id, cell.row, cell.column, parsed);
      this.editHistory.noteEdit(outcome);
      this.editingCell.set(null);
      this.editInitialValue.set('');
      this.editError.set('');
    } catch (error) {
      this.editError.set(error instanceof Error ? error.message : String(error));
    }
  }

  /** Restores the selected cell to the value it had before its first edit
   * (the plan's "Delete to restore the original cell"). A no-op if the
   * cell was never edited. */
  protected async restoreSelected(): Promise<void> {
    const detail = this.detail();
    const cell = this.selected();
    if (!detail || !cell || !this.canEdit() || this.editingCell()) {
      return;
    }
    try {
      const diff = await this.gateway.getDiff();
      const entry = diff.edits.find((edit) => edit.mapId === detail.id && edit.row === cell.row && edit.column === cell.column);
      if (!entry) {
        return;
      }
      const outcome = await this.gateway.setCell(detail.id, cell.row, cell.column, entry.beforeValue);
      this.editHistory.noteEdit(outcome);
    } catch (error) {
      this.editError.set(error instanceof Error ? error.message : String(error));
    }
  }

  protected onGridKeydown(event: KeyboardEvent): void {
    if (this.editingCell()) {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.commitEdit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.cancelEdit();
      }
      return;
    }
    const cell = this.selected();
    const detail = this.detail();
    if (!cell || !detail) {
      return;
    }
    switch (event.key) {
      case 'a':
      case 'A':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.selectionAnchor.set({ row: 0, column: 0 });
          this.selected.set({ row: detail.rows - 1, column: detail.columns - 1 });
          this.activateEditor();
        }
        break;
      case 'Enter':
      case 'F2':
        event.preventDefault();
        this.beginEdit();
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        void this.restoreSelected();
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.moveSelection(detail, -1, 0, event.shiftKey);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.moveSelection(detail, 1, 0, event.shiftKey);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.moveSelection(detail, 0, -1, event.shiftKey);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.moveSelection(detail, 0, 1, event.shiftKey);
        break;
    }
  }

  private moveSelection(detail: types.MapDetail, deltaRow: number, deltaColumn: number, extend: boolean): void {
    const cell = this.selected();
    if (!cell) {
      return;
    }
    const row = Math.min(Math.max(cell.row + deltaRow, 0), detail.rows - 1);
    const column = Math.min(Math.max(cell.column + deltaColumn, 0), detail.columns - 1);
    this.selectCell(row, column, extend);
  }

  protected onChartPoint(event: PlotMouseEvent | PlotHoverEvent): void {
    // The 3D surface is a WebGL/gl3d plot: picking a point there means an
    // extra offscreen render pass and GPU readback on top of the orbit-drag
    // camera controls sharing the same canvas, and in practice that
    // combination has been unreliable to interact with cleanly. The
    // heatmap and line views use cheap SVG-based picking and keep this.
    if (this.viewMode() === 'surface') {
      return;
    }
    const detail = this.detail();
    const point = event.points?.[0];
    if (!detail || !point) {
      return;
    }
    if (Array.isArray(point.customdata) && point.customdata.length === 2) {
      this.selectCell(Number(point.customdata[0]), Number(point.customdata[1]));
      return;
    }
    if (this.viewMode() === 'line') {
      const cell = lineIndexToCell(detail, point.pointIndex as unknown as number);
      this.selectCell(cell.row, cell.column);
      return;
    }
    const pointNumber = (point as unknown as { pointNumber?: unknown }).pointNumber;
    const cell = matrixPointToCell(point.pointIndex)
      ?? matrixPointToCell(pointNumber)
      ?? this.matrixCoordinatesToCell(detail, point.x, point.y);
    if (cell) {
      this.selectCell(cell.row, cell.column);
    }
  }

  private matrixCoordinatesToCell(detail: types.MapDetail, x: unknown, y: unknown): CellSelection | null {
    const xValues = detail.x.addressed && detail.xValues
      ? detail.xValues
      : Array.from({ length: detail.columns }, (_, index) => index);
    const yValues = detail.y.addressed && detail.yValues
      ? detail.yValues
      : Array.from({ length: detail.rows }, (_, index) => index);
    const nearestIndex = (values: number[], target: unknown): number => {
      const numeric = Number(target);
      if (!Number.isFinite(numeric) || values.length === 0) return -1;
      return values.reduce((best, value, index) =>
        Math.abs(value - numeric) < Math.abs(values[best] - numeric) ? index : best, 0);
    };
    const column = nearestIndex(xValues, x);
    const row = nearestIndex(yValues, y);
    return row >= 0 && column >= 0 ? { row, column } : null;
  }

  protected onChartRenderFailed(): void {
    this.chartRenderFailed.set(true);
  }

  private cellAt<T>(rows: T[][] | undefined): T | null {
    const cell = this.selected();
    if (!rows || !cell) {
      return null;
    }
    return rows[cell.row]?.[cell.column] ?? null;
  }
}
