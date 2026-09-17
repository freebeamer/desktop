import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Config, Data, Layout, PlotHoverEvent, PlotMouseEvent } from 'plotly.js';
import { DesktopGateway } from '../core/desktop-gateway';
import { EditHistoryStore } from '../workspace/edit-history-store';
import { WorkspaceStore } from '../workspace/workspace-store';
import { PlotlyRuntime } from '../visualization/plotly-runtime';
import { MapEditor } from './map-editor';
import type { types } from '../../../wailsjs/go/models';

const axis = (overrides: Partial<types.AxisDetail> = {}): types.AxisDetail =>
  ({ units: '', formula: 'X', addressed: false, elementBits: 16, ...overrides }) as types.AxisDetail;

function scalarDetail(): types.MapDetail {
  return {
    id: 1,
    title: 'Idle target',
    description: 'Idle RPM target',
    categories: ['Idle'],
    shape: 'scalar',
    rows: 1,
    columns: 1,
    x: axis(),
    y: axis(),
    z: axis({ units: 'rpm', formula: 'X*10' }),
    zValues: [[850]],
    zRaw: [[85]],
    zAddresses: [['0x300']],
  } as types.MapDetail;
}

function matrixDetail(): types.MapDetail {
  return {
    id: 2,
    title: 'Boost target',
    description: '',
    categories: ['Boost'],
    shape: 'matrix',
    rows: 2,
    columns: 2,
    x: axis({ units: 'rpm', formula: 'X*10', addressed: true }),
    y: axis({ units: 'kPa', formula: 'X', addressed: true }),
    z: axis({ units: 'kPa', formula: 'X*0.1' }),
    xValues: [1000, 2000],
    yValues: [10, 20],
    zValues: [
      [1, 2],
      [3, 4],
    ],
    zRaw: [
      [10, 20],
      [30, 40],
    ],
    zAddresses: [
      ['0x200', '0x202'],
      ['0x204', '0x206'],
    ],
  } as types.MapDetail;
}

function oneAxisDetail(): types.MapDetail {
  return {
    id: 4,
    title: 'Boost target X (autogen)',
    description: '',
    categories: [],
    shape: 'one-axis',
    rows: 1,
    columns: 3,
    x: axis({ units: 'rpm', formula: 'X*10', addressed: true }),
    y: axis(),
    z: axis({ units: 'kPa', formula: 'X*0.1' }),
    xValues: [1000, 2000, 3000],
    zValues: [[1, 2, 3]],
    zRaw: [[10, 20, 30]],
    zAddresses: [['0x100', '0x102', '0x104']],
  } as unknown as types.MapDetail;
}

function hugeMatrixDetail(): types.MapDetail {
  const size = 200; // 40,000 cells, over MAX_INTERACTIVE_SURFACE_CELLS
  const row = Array.from({ length: size }, (_, i) => i);
  return {
    id: 5,
    title: 'Huge matrix',
    description: '',
    categories: [],
    shape: 'matrix',
    rows: size,
    columns: size,
    x: axis({ addressed: true }),
    y: axis({ addressed: true }),
    z: axis(),
    xValues: row,
    yValues: row,
    zValues: Array.from({ length: size }, () => row),
    zRaw: Array.from({ length: size }, () => row),
    zAddresses: Array.from({ length: size }, () => row.map(String)),
  } as unknown as types.MapDetail;
}

class FakePlotlyRuntime implements PlotlyRuntime {
  renderCalls: Array<{ data: Data[]; layout: Partial<Layout> }> = [];
  shouldFail = false;
  private clickHandler?: (event: PlotMouseEvent) => void;

  async render(_el: HTMLElement, data: Data[], layout: Partial<Layout>, _config: Partial<Config>): Promise<void> {
    this.renderCalls.push({ data, layout });
    if (this.shouldFail) {
      throw new Error('render failed');
    }
  }

  purge(): void {}
  resize(): void {}

  onClick(_el: HTMLElement, handler: (event: PlotMouseEvent) => void): void {
    this.clickHandler = handler;
  }

  onHover(_el: HTMLElement, _handler: (event: PlotHoverEvent) => void): void {}
  onWebglContextLost(): void {}

  fireClick(event: PlotMouseEvent): void {
    this.clickHandler?.(event);
  }
}

function invalidDetail(): types.MapDetail {
  return {
    id: 3,
    title: 'Broken map',
    description: '',
    categories: [],
    shape: 'invalid',
    diagnostics: 'map "Broken map" axis z: XDF axis has no embedded address',
    rows: 0,
    columns: 0,
    x: axis(),
    y: axis(),
    z: axis(),
  } as unknown as types.MapDetail;
}

function workspaceSummary(overrides: Partial<types.WorkspaceSummary> = {}): types.WorkspaceSummary {
  return {
    generation: 1,
    xdfPath: '/tmp/def.xdf',
    binPath: '/tmp/image.bin',
    rom: { sizeBytes: 4194304, sha256: 'a'.repeat(64) },
    ecu: { manufacturer: '', vendor: '', family: '', engine: '', confidence: 'none' },
    xdf: { version: '1.70', categories: 1, tables: 1, flags: 0 },
    compatibility: { regionFitsRom: true, addressedMaps: 1, totalMaps: 1, mapValidationErrors: 0 },
    checksum: { provider: '', status: 'unsupported', regions: 0 },
    editingAllowed: true,
    changedBytes: 0,
    editCount: 0,
    canUndo: false,
    canRedo: false,
    ...overrides,
  } as types.WorkspaceSummary;
}

function editOutcome(overrides: Partial<types.EditOutcome> = {}): types.EditOutcome {
  return {
    mapId: 0,
    mapTitle: '',
    row: 0,
    column: 0,
    index: -1,
    requested: 0,
    encoded: 0,
    raw: 0,
    address: '0x0',
    changedBytes: 1,
    canUndo: true,
    canRedo: false,
    ...overrides,
  } as types.EditOutcome;
}

function batchOutcome(overrides: Partial<types.BatchEditOutcome> = {}): types.BatchEditOutcome {
  return {
    mapId: 0, mapTitle: '', selectedCells: 4, changedCells: 4, unchangedCells: 0,
    minimum: 1, maximum: 4, changedBytes: 4, canUndo: true, canRedo: false, ...overrides,
  } as types.BatchEditOutcome;
}

class FakeGateway implements DesktopGateway {
  detailById = new Map<number, types.MapDetail>();
  workspaceSummaryResult = workspaceSummary();
  setCellCalls: Array<{ mapId: number; row: number; column: number; value: number }> = [];
  setCellResult: types.EditOutcome | Error = editOutcome();
  operationCalls: types.CellOperationRequest[] = [];
  operationResult: types.BatchEditOutcome | Error = batchOutcome();
  diffResult: types.DiffSummary = { changedBytes: 0, edits: [] } as unknown as types.DiffSummary;
  undoResult: types.EditOutcome | Error = editOutcome({ canUndo: false, canRedo: true });
  redoResult: types.EditOutcome | Error = editOutcome({ canUndo: true, canRedo: false });

  health = (): Promise<types.HealthStatus> =>
    Promise.resolve({ ready: true, apiVersion: 'desktop-v1', engine: 'FreeBeamer Go' });
  chooseAndOpenWorkspace = (): Promise<types.WorkspaceSummary> => Promise.resolve(this.workspaceSummaryResult);
  openWorkspace = (): Promise<types.WorkspaceSummary> => Promise.resolve(this.workspaceSummaryResult);
  getWorkspace = (): Promise<types.WorkspaceSummary> => Promise.resolve(this.workspaceSummaryResult);
  closeWorkspace = (): Promise<void> => Promise.resolve();
  recentWorkspaces = (): Promise<types.RecentEntry[]> => Promise.resolve([]);
  listMaps = (): Promise<types.MapPage> =>
    Promise.resolve({ generation: 1, total: 0, categories: [], maps: [] } as unknown as types.MapPage);

  getMap(mapId: number): Promise<types.MapDetail> {
    const detail = this.detailById.get(mapId);
    return detail ? Promise.resolve(detail) : Promise.reject(new Error(`desktop: no map with id ${mapId}`));
  }

  setCell(mapId: number, row: number, column: number, value: number): Promise<types.EditOutcome> {
    this.setCellCalls.push({ mapId, row, column, value });
    return this.setCellResult instanceof Error ? Promise.reject(this.setCellResult) : Promise.resolve(this.setCellResult);
  }

  applyCellOperation(request: types.CellOperationRequest): Promise<types.BatchEditOutcome> {
    this.operationCalls.push(request);
    return this.operationResult instanceof Error ? Promise.reject(this.operationResult) : Promise.resolve(this.operationResult);
  }

  setIndex(): Promise<types.EditOutcome> {
    return Promise.reject(new Error('unused'));
  }

  undo(): Promise<types.EditOutcome> {
    return this.undoResult instanceof Error ? Promise.reject(this.undoResult) : Promise.resolve(this.undoResult);
  }

  redo(): Promise<types.EditOutcome> {
    return this.redoResult instanceof Error ? Promise.reject(this.redoResult) : Promise.resolve(this.redoResult);
  }

  getDiff(): Promise<types.DiffSummary> {
    return Promise.resolve(this.diffResult);
  }

  verifyChecksums(): Promise<types.ChecksumSummary> {
    return Promise.reject(new Error('unused'));
  }

  saveAs(): Promise<types.SaveOutcome> {
    return Promise.reject(new Error('unused'));
  }

  chooseAndSaveAs(): Promise<types.SaveOutcome> {
    return Promise.reject(new Error('unused'));
  }
}

@Component({
  selector: 'app-map-editor-host',
  standalone: true,
  imports: [MapEditor],
  template: `<app-map-editor [mapId]="mapId" (layoutChanged)="onLayoutChanged()" />`,
})
class HostComponent {
  mapId = 0;
  layoutChanges = 0;

  onLayoutChanged(): void {
    this.layoutChanges++;
  }
}

async function render(gateway: FakeGateway, mapId: number, plotly: FakePlotlyRuntime = new FakePlotlyRuntime()) {
  TestBed.configureTestingModule({
    providers: [
      { provide: DesktopGateway, useValue: gateway },
      { provide: PlotlyRuntime, useValue: plotly },
    ],
  });
  // MapEditor reads WorkspaceStore.summary().editingAllowed to gate its own
  // editing UI, so populate a workspace before the map itself loads.
  const workspace = TestBed.inject(WorkspaceStore);
  await workspace.open('x.xdf', 'y.bin');
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.mapId = mapId;
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('MapEditor', () => {
  it('renders a scalar as one compact editable control', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(1, scalarDetail());
    const fixture = await render(gateway, 1);
    const compiled = fixture.nativeElement as HTMLElement;
    expect((compiled.querySelector('.scalar-editor__input') as HTMLInputElement)?.value).toBe('850');
    expect(compiled.querySelector('.scalar-editor__units')?.textContent).toContain('rpm');
    expect(compiled.querySelector('.cell-inspector')).toBeFalsy();
  });

  it('edits a scalar directly through its single value input', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(1, scalarDetail());
    gateway.setCellResult = editOutcome({ mapId: 1, row: 0, column: 0, raw: 900, encoded: 900 });
    const fixture = await render(gateway, 1);
    const input = fixture.nativeElement.querySelector('.scalar-editor__input') as HTMLInputElement;

    input.dispatchEvent(new FocusEvent('focus'));
    input.value = '900';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitUntil(() => gateway.setCellCalls.length > 0);

    expect(gateway.setCellCalls).toEqual([{ mapId: 1, row: 0, column: 0, value: 900 }]);
  });

  it('does not mutate a scalar when it is focused and blurred unchanged', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(1, scalarDetail());
    const fixture = await render(gateway, 1);
    const input = fixture.nativeElement.querySelector('.scalar-editor__input') as HTMLInputElement;

    input.dispatchEvent(new FocusEvent('focus'));
    input.dispatchEvent(new FocusEvent('blur'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(gateway.setCellCalls).toEqual([]);
    expect(TestBed.inject(EditHistoryStore).revision()).toBe(0);
  });

  it('does not mutate a cell when its numeric value is entered equivalently', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(1, scalarDetail());
    const fixture = await render(gateway, 1);
    const input = fixture.nativeElement.querySelector('.scalar-editor__input') as HTMLInputElement;

    input.dispatchEvent(new FocusEvent('focus'));
    input.value = '850.0';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(gateway.setCellCalls).toEqual([]);
  });

  it('renders a matrix grid and updates the cell inspector on selection', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    const fixture = await render(gateway, 2);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelectorAll('.map-grid td').length).toBe(4);
    expect(compiled.querySelector('.map-grid thead th:nth-child(2)')?.textContent).toBe('1000');
    expect(compiled.querySelector('.map-grid tbody th')?.textContent).toBe('10');

    const cells = Array.from(compiled.querySelectorAll('.map-grid td')) as HTMLElement[];
    expect(cells[0].classList).toContain('map-grid__cell--selected');

    cells[3].click();
    fixture.detectChanges();
    expect(cells[3].classList).toContain('map-grid__cell--selected');
    expect(compiled.querySelector('.cell-inspector')?.textContent).toContain('0x206');
    expect(compiled.querySelector('.cell-inspector')?.textContent).toContain('40');
  });

  it('extends a rectangular selection with Shift+click and Shift+arrow', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    const fixture = await render(gateway, 2);
    const compiled = fixture.nativeElement as HTMLElement;
    const cells = Array.from(compiled.querySelectorAll('.map-grid td')) as HTMLElement[];

    cells[3].dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.map-grid__cell--selected').length).toBe(4);
    expect(compiled.querySelector('.cell-inspector')?.textContent).toContain('4 cells');

    const table = compiled.querySelector('.map-grid') as HTMLElement;
    table.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.map-grid__cell--selected').length).toBe(2);
  });

  it('selects a rectangular range by dragging across cells', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    const fixture = await render(gateway, 2);
    const compiled = fixture.nativeElement as HTMLElement;
    const cells = Array.from(compiled.querySelectorAll('.map-grid td')) as HTMLElement[];

    cells[0].dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));
    cells[3].dispatchEvent(new MouseEvent('pointerenter'));
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    fixture.detectChanges();

    expect(compiled.querySelectorAll('.map-grid__cell--selected').length).toBe(4);
  });

  it('selects the map body with Ctrl+A and fills it as one batch edit', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    gateway.operationResult = batchOutcome({ mapId: 2 });
    const fixture = await render(gateway, 2);
    const compiled = fixture.nativeElement as HTMLElement;
    const table = compiled.querySelector('.map-grid') as HTMLElement;

    table.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    table.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    const input = compiled.querySelector('.map-grid__input') as HTMLInputElement;
    input.value = '12.5';
    input.dispatchEvent(new Event('input'));
    table.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitUntil(() => gateway.operationCalls.length === 1);

    expect(gateway.setCellCalls).toEqual([]);
    expect(gateway.operationCalls[0]).toMatchObject({
      mapId: 2,
      operation: 'fill',
      operand: 12.5,
      selection: { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 },
    });
  });

  it('shades cells blue-to-red by relative value, skipping the selected cell', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail()); // zValues [[1,2],[3,4]]: min=1, max=4
    const fixture = await render(gateway, 2);
    const compiled = fixture.nativeElement as HTMLElement;
    const cells = Array.from(compiled.querySelectorAll('.map-grid td')) as HTMLElement[];

    // cells[0] (value 1, the minimum) is selected by default on load, so its
    // background must stay the selection accent, not the gradient color.
    expect(cells[0].classList).toContain('map-grid__cell--selected');
    expect(cells[0].style.backgroundColor).toBe('');

    // Exact string comparisons are avoided here since a browser's
    // CSSStyleDeclaration may re-serialize the hsl() value it's given.
    expect(cells[3].style.backgroundColor).not.toBe(''); // value 4, the maximum: colored
    expect(cells[3].style.backgroundColor).not.toBe(cells[1].style.backgroundColor); // value 4 vs value 2: different
  });

  it('renders diagnostics for an invalid map without a cell inspector', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(3, invalidDetail());
    const fixture = await render(gateway, 3);
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.diagnostics-panel')?.textContent).toContain('no embedded address');
    expect(compiled.querySelector('.cell-inspector')).toBeFalsy();
  });

  it('shows an error panel when decoding fails outright', async () => {
    const gateway = new FakeGateway();
    const fixture = await render(gateway, 99);
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.status-panel--danger')?.textContent).toContain('no map with id 99');
  });

  it('offers a grid/line toggle for a one-axis map and renders the line chart through the runtime', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(4, oneAxisDetail());
    const plotly = new FakePlotlyRuntime();
    const fixture = await render(gateway, 4, plotly);
    const compiled = fixture.nativeElement as HTMLElement;

    const buttons = Array.from(compiled.querySelectorAll('.view-toggle button')).map((b) => b.textContent?.trim());
    expect(buttons).toEqual(['Grid', 'Line']);
    expect(compiled.querySelector('app-plotly-chart')).toBeFalsy();

    (compiled.querySelector('.view-toggle button:nth-child(2)') as HTMLButtonElement).click();
    fixture.detectChanges();
    await waitUntil(() => plotly.renderCalls.length > 0);

    expect(compiled.querySelector('app-plotly-chart')).toBeTruthy();
    expect(plotly.renderCalls[0].data[0]).toEqual(
      expect.objectContaining({ type: 'scatter', x: [1000, 2000, 3000], y: [1, 2, 3] }),
    );
    expect(plotly.renderCalls[0].data[1]).toEqual(
      expect.objectContaining({ type: 'scatter', x: [1000], y: [1], customdata: [[0, 0]] }),
    );
    expect(fixture.componentInstance.layoutChanges).toBeGreaterThanOrEqual(2);
  });

  it('updates the selected cell when a chart point is clicked', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(4, oneAxisDetail());
    const plotly = new FakePlotlyRuntime();
    const fixture = await render(gateway, 4, plotly);
    const compiled = fixture.nativeElement as HTMLElement;

    (compiled.querySelector('.view-toggle button:nth-child(2)') as HTMLButtonElement).click();
    fixture.detectChanges();
    await waitUntil(() => plotly.renderCalls.length > 0);

    plotly.fireClick({ points: [{ pointIndex: 2 }] } as unknown as PlotMouseEvent);
    fixture.detectChanges();

    expect(compiled.querySelector('.cell-inspector')?.textContent).toContain('0x104');
  });

  it('keeps visualizations hidden by default and shows the selected 3D view on demand', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    const fixture = await render(gateway, 2);
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('.view-toggle .filter-chip')).map((b) =>
      (b as HTMLElement).textContent?.trim(),
    );
    expect(buttons).toEqual(['Heatmap', '3D']);
    expect(fixture.nativeElement.querySelector('.map-grid')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.filter-chip--active')?.textContent?.trim()).toBe('3D');
    expect(fixture.nativeElement.querySelector('app-plotly-chart')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('.view-action')?.textContent).toContain('Show graph');

    (fixture.nativeElement.querySelector('.view-action') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-plotly-chart')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.view-action')?.textContent).toContain('Hide graph');
  });

  it('ignores clicks on the 3D surface — picking a point there was unreliable to interact with cleanly', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    const plotly = new FakePlotlyRuntime();
    const fixture = await render(gateway, 2, plotly);
    (fixture.nativeElement.querySelector('.view-action') as HTMLButtonElement).click();
    fixture.detectChanges();
    await waitUntil(() => plotly.renderCalls.length > 0);

    const before = fixture.nativeElement.querySelector('.cell-inspector')?.textContent;
    plotly.fireClick({ points: [{ pointNumber: [0, 1], x: 1000.01, y: 19.99 }] } as unknown as PlotMouseEvent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.cell-inspector')?.textContent).toBe(before);
  });

  it('keeps the 3D surface trace object stable when the selection changes via the table, so only the selection marker re-renders', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    const plotly = new FakePlotlyRuntime();
    const fixture = await render(gateway, 2, plotly);
    (fixture.nativeElement.querySelector('.view-action') as HTMLButtonElement).click();
    fixture.detectChanges();
    await waitUntil(() => plotly.renderCalls.length > 0);

    const surfaceTrace = plotly.renderCalls[plotly.renderCalls.length - 1].data[0];
    expect(surfaceTrace).toEqual(expect.objectContaining({ type: 'surface' }));

    const cells = fixture.nativeElement.querySelectorAll('.matrix-workbench .map-grid td');
    (cells[cells.length - 1] as HTMLElement).click();
    fixture.detectChanges();
    await waitUntil(() => plotly.renderCalls.length > 1);

    // Rebuilding this trace rebuilds the whole WebGL mesh — expensive enough
    // that doing it on every selection change is what made the 3D chart laggy.
    expect(plotly.renderCalls[plotly.renderCalls.length - 1].data[0]).toBe(surfaceTrace);
  });

  it('hides 3D above the interactive cell threshold, with a stated reason', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(5, hugeMatrixDetail());
    const fixture = await render(gateway, 5);
    const compiled = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(compiled.querySelectorAll('.view-toggle .filter-chip')).map((b) => b.textContent?.trim());
    expect(buttons).toEqual(['Heatmap']);
    expect(compiled.querySelector('.view-toggle__note')?.textContent).toContain('3D unavailable');
  });

  it('falls back to the grid with a message when the chart runtime fails to render', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    const plotly = new FakePlotlyRuntime();
    plotly.shouldFail = true;
    const fixture = await render(gateway, 2, plotly);
    const compiled = fixture.nativeElement as HTMLElement;

    (compiled.querySelector('.view-action') as HTMLButtonElement).click();
    fixture.detectChanges();
    await waitUntil(() => !!compiled.querySelector('.chart-fallback'));

    expect(compiled.querySelector('.chart-fallback')).toBeTruthy();
    (compiled.querySelector('.chart-fallback button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('.map-grid')).toBeTruthy();
  });

  it('resets the view mode to grid when switching to a different map', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    gateway.detailById.set(4, oneAxisDetail());
    TestBed.configureTestingModule({
      providers: [
        { provide: DesktopGateway, useValue: gateway },
        { provide: PlotlyRuntime, useValue: new FakePlotlyRuntime() },
      ],
    });
    await TestBed.inject(WorkspaceStore).open('x.xdf', 'y.bin');
    // Driving mapId through componentRef.setInput() rather than a wrapping
    // host component's template binding: the latter does not reliably
    // notify a signal input's effect of a later change in this test
    // environment (see plotly-chart.spec.ts for the same finding).
    const fixture = TestBed.createComponent(MapEditor);
    fixture.componentRef.setInput('mapId', 2);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    (compiled.querySelector('.view-toggle button:first-child') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('.view-toggle button.filter-chip--active')?.textContent?.trim()).toBe('Heatmap');

    fixture.componentRef.setInput('mapId', 4);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelector('.view-toggle button.filter-chip--active')?.textContent?.trim()).toBe('Grid');
    expect(compiled.querySelector('.map-grid')).toBeTruthy();
  });

  it('edits the selected cell via Enter to start, Enter to commit', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    gateway.setCellResult = editOutcome({ mapId: 2, row: 0, column: 0, raw: 99, encoded: 9.9 });
    const fixture = await render(gateway, 2);
    const compiled = fixture.nativeElement as HTMLElement;
    const table = compiled.querySelector('.map-grid') as HTMLElement;

    table.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(compiled.querySelector('.map-grid__input')).toBeTruthy();

    const input = compiled.querySelector('.map-grid__input') as HTMLInputElement;
    input.value = '9.9';
    input.dispatchEvent(new Event('input'));
    table.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitUntil(() => gateway.setCellCalls.length > 0);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(gateway.setCellCalls).toEqual([{ mapId: 2, row: 0, column: 0, value: 9.9 }]);
    expect(compiled.querySelector('.map-grid__input')).toBeFalsy();
  });

  it('cancels an in-progress edit with Escape without calling setCell', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    const fixture = await render(gateway, 2);
    const compiled = fixture.nativeElement as HTMLElement;
    const table = compiled.querySelector('.map-grid') as HTMLElement;

    table.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(compiled.querySelector('.map-grid__input')).toBeTruthy();

    table.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(compiled.querySelector('.map-grid__input')).toBeFalsy();
    expect(gateway.setCellCalls.length).toBe(0);
  });

  it('shows a dirty marker for a cell GetDiff reports as edited', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    gateway.diffResult = {
      changedBytes: 1,
      edits: [{ mapId: 2, mapTitle: 'Boost target', row: 0, column: 0, index: -1, address: '0x200', beforeRaw: 10, afterRaw: 50, beforeValue: 1, afterValue: 5 }],
    } as unknown as types.DiffSummary;
    const fixture = await render(gateway, 2);
    const compiled = fixture.nativeElement as HTMLElement;
    await waitUntil(() => compiled.querySelector('.map-grid__cell--dirty') !== null);
    fixture.detectChanges();

    const cells = Array.from(compiled.querySelectorAll('.map-grid td')) as HTMLElement[];
    expect(cells[0].classList).toContain('map-grid__cell--dirty');
    expect(cells[1].classList).not.toContain('map-grid__cell--dirty');
    expect(compiled.querySelector('.cell-inspector')?.textContent).toContain('changed');
  });

  it('restores the selected cell to its pre-edit value via Delete', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    gateway.diffResult = {
      changedBytes: 1,
      edits: [{ mapId: 2, mapTitle: 'Boost target', row: 0, column: 0, index: -1, address: '0x200', beforeRaw: 10, afterRaw: 50, beforeValue: 1, afterValue: 5 }],
    } as unknown as types.DiffSummary;
    gateway.setCellResult = editOutcome({ mapId: 2, row: 0, column: 0, raw: 10, encoded: 1 });
    const fixture = await render(gateway, 2);
    const compiled = fixture.nativeElement as HTMLElement;
    const table = compiled.querySelector('.map-grid') as HTMLElement;

    table.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await waitUntil(() => gateway.setCellCalls.length > 0);

    expect(gateway.setCellCalls).toEqual([{ mapId: 2, row: 0, column: 0, value: 1 }]);
  });

  it('leaves an unedited cell alone when Delete is pressed', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    const fixture = await render(gateway, 2);
    const compiled = fixture.nativeElement as HTMLElement;
    const table = compiled.querySelector('.map-grid') as HTMLElement;

    table.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(gateway.setCellCalls.length).toBe(0);
  });

  it('navigates the selection with arrow keys', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    const fixture = await render(gateway, 2);
    const compiled = fixture.nativeElement as HTMLElement;
    const table = compiled.querySelector('.map-grid') as HTMLElement;

    table.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    let cells = Array.from(compiled.querySelectorAll('.map-grid td')) as HTMLElement[];
    expect(cells[1].classList).toContain('map-grid__cell--selected');

    table.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    cells = Array.from(compiled.querySelectorAll('.map-grid td')) as HTMLElement[];
    expect(cells[3].classList).toContain('map-grid__cell--selected');
  });

  it('disables editing UI when the workspace refuses it', async () => {
    const gateway = new FakeGateway();
    gateway.detailById.set(2, matrixDetail());
    gateway.workspaceSummaryResult = workspaceSummary({ editingAllowed: false, refusalReason: 'region mismatch' });
    const fixture = await render(gateway, 2);
    const compiled = fixture.nativeElement as HTMLElement;
    const table = compiled.querySelector('.map-grid') as HTMLElement;

    expect(compiled.querySelector('.edit-refusal-note')).toBeTruthy();
    table.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(compiled.querySelector('.map-grid__input')).toBeFalsy();
  });

  it('refreshes after an undo/redo made elsewhere (editHistory.revision changes)', async () => {
    const gateway = new FakeGateway();
    const first = matrixDetail();
    gateway.detailById.set(2, first);
    const fixture = await render(gateway, 2);
    const compiled = fixture.nativeElement as HTMLElement;
    expect((compiled.querySelectorAll('.map-grid td')[0] as HTMLElement).textContent?.trim()).toBe('1');

    const updated: types.MapDetail = {
      ...first,
      zValues: [
        [42, 2],
        [3, 4],
      ],
    } as types.MapDetail;
    gateway.detailById.set(2, updated);
    TestBed.inject(EditHistoryStore).noteEdit({ canUndo: true, canRedo: false } as types.EditOutcome);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect((compiled.querySelectorAll('.map-grid td')[0] as HTMLElement).textContent?.trim()).toBe('42');
  });
});
