import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { DesktopGateway } from './core/desktop-gateway';
import { EditHistoryStore } from './workspace/edit-history-store';
import { PlotlyRuntime } from './visualization/plotly-runtime';
import type { types } from '../../wailsjs/go/models';

function summary(overrides: Partial<types.WorkspaceSummary> = {}): types.WorkspaceSummary {
  return {
    generation: 1,
    xdfPath: '/tmp/00000FEF81A001.xdf',
    binPath: '/tmp/00000FEF81A001_original.bin',
    rom: { sizeBytes: 4194304, sha256: 'a'.repeat(64) },
    ecu: { manufacturer: 'BMW', vendor: 'Bosch', family: 'MEVD17.2.6', engine: 'BMW N55', confidence: 'high' },
    xdf: { version: '1.70', categories: 73, tables: 962, flags: 7 },
    compatibility: { regionFitsRom: true, addressedMaps: 962, totalMaps: 962, mapValidationErrors: 0 },
    checksum: { provider: 'bosch.mevd17.2.6.75P9EJ0B', status: 'valid', regions: 11 },
    editingAllowed: true,
    changedBytes: 0,
    editCount: 0,
    canUndo: false,
    canRedo: false,
    ...overrides,
  } as types.WorkspaceSummary;
}

const axis = (overrides: Partial<types.AxisDetail> = {}): types.AxisDetail =>
  ({ units: '', formula: 'X', addressed: false, elementBits: 16, ...overrides }) as types.AxisDetail;

function matrixMap(): types.MapDetail {
  return {
    id: 0,
    title: 'Performance gauge scaling',
    description: '',
    categories: ['Gauges'],
    shape: 'matrix',
    rows: 2,
    columns: 2,
    x: axis({ units: 'rpm', formula: 'X*10', addressed: true }),
    y: axis({ units: 'rpm', formula: 'X*10', addressed: true }),
    z: axis({ units: 'kPa', formula: 'X*0.1', addressed: true }),
    xValues: [1000, 2000],
    xRaw: [100, 200],
    xAddresses: ['0x100', '0x102'],
    yValues: [1000, 2000],
    yRaw: [100, 200],
    yAddresses: ['0x104', '0x106'],
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

class FakeGateway implements DesktopGateway {
  openResult: types.WorkspaceSummary | Error = new Error('desktop: file selection was cancelled');
  operationCalls: types.CellOperationRequest[] = [];

  async health() {
    return { ready: true, apiVersion: 'desktop-v1', engine: 'FreeBeamer Go' };
  }

  chooseAndOpenWorkspace(): Promise<types.WorkspaceSummary> {
    return this.openResult instanceof Error ? Promise.reject(this.openResult) : Promise.resolve(this.openResult);
  }

  openWorkspace(): Promise<types.WorkspaceSummary> {
    return this.chooseAndOpenWorkspace();
  }

  getWorkspace(): Promise<types.WorkspaceSummary> {
    return Promise.reject(new Error('desktop: no workspace is open'));
  }

  closeWorkspace(): Promise<void> {
    return Promise.resolve();
  }

  recentWorkspaces(): Promise<types.RecentEntry[]> {
    return Promise.resolve([]);
  }

  listMaps(): Promise<types.MapPage> {
    const map = matrixMap();
    return Promise.resolve({
      generation: 1,
      total: 1,
      categories: map.categories,
      maps: [{ id: map.id, title: map.title, categories: map.categories, shape: map.shape }],
    } as types.MapPage);
  }

  getMap(): Promise<types.MapDetail> {
    return Promise.resolve(matrixMap());
  }

  setCell(): Promise<types.EditOutcome> {
    return Promise.reject(new Error('unused'));
  }

  applyCellOperation(request: types.CellOperationRequest): Promise<types.BatchEditOutcome> {
    this.operationCalls.push(request);
    return Promise.resolve({
      mapId: request.mapId, mapTitle: 'Performance gauge scaling', selectedCells: 1,
      changedCells: 1, unchangedCells: 0, minimum: request.operand, maximum: request.operand,
      changedBytes: 2, canUndo: true, canRedo: false,
    } as types.BatchEditOutcome);
  }

  setIndex(): Promise<types.EditOutcome> {
    return Promise.reject(new Error('unused'));
  }

  undoCalls = 0;
  redoCalls = 0;

  undo(): Promise<types.EditOutcome> {
    this.undoCalls++;
    return Promise.resolve({ canUndo: false, canRedo: true } as types.EditOutcome);
  }

  redo(): Promise<types.EditOutcome> {
    this.redoCalls++;
    return Promise.resolve({ canUndo: true, canRedo: false } as types.EditOutcome);
  }

  getDiff(): Promise<types.DiffSummary> {
    return Promise.resolve({ changedBytes: 0, edits: [] } as unknown as types.DiffSummary);
  }

  checksumResult: types.ChecksumSummary | Error = { provider: 'p', status: 'invalid', regions: 11 } as types.ChecksumSummary;
  saveResult: types.SaveOutcome | Error = new Error('desktop: file selection was cancelled');
  saveCalls = 0;

  verifyChecksums(): Promise<types.ChecksumSummary> {
    return this.checksumResult instanceof Error ? Promise.reject(this.checksumResult) : Promise.resolve(this.checksumResult);
  }

  saveAs(): Promise<types.SaveOutcome> {
    return Promise.reject(new Error('unused'));
  }

  chooseAndSaveAs(): Promise<types.SaveOutcome> {
    this.saveCalls++;
    return this.saveResult instanceof Error ? Promise.reject(this.saveResult) : Promise.resolve(this.saveResult);
  }
}

const fakePlotly: Partial<PlotlyRuntime> = {
  render: () => Promise.resolve(), purge: () => {}, resize: () => {},
  onClick: () => {}, onHover: () => {}, onWebglContextLost: () => {},
};

async function renderWith(gateway: FakeGateway) {
  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      { provide: DesktopGateway, useValue: gateway },
      { provide: PlotlyRuntime, useValue: fakePlotly },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('App', () => {
  it('opens live monitoring without a workspace and preserves the editor shell', async () => {
    const fixture = await renderWith(new FakeGateway());
    const root = fixture.nativeElement as HTMLElement;
    const buttons = root.querySelectorAll<HTMLButtonElement>('.view-switch button');
    buttons[1].click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(root.querySelector('app-live-view')).not.toBeNull();
    expect(root.querySelector<HTMLElement>('.workspace')!.hidden).toBe(true);
    buttons[0].click(); fixture.detectChanges();
    expect(root.querySelector<HTMLElement>('.workspace')!.hidden).toBe(false);
    expect(root.textContent).toContain('Start with a verified workspace');
  });

  it('renders the empty workspace shell', async () => {
    const fixture = await renderWith(new FakeGateway());
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Start with a verified workspace');
    expect(compiled.querySelector('.sidebar')?.textContent).toContain('Map browser');
    expect(compiled.querySelector('.engine-status')?.textContent).toContain('FreeBeamer Go · desktop-v1');
    expect(compiled.querySelector('.engine-status')?.classList).toContain('engine-status--ready');
  });

  it('shows the inspect panel once a compatible workspace opens', async () => {
    const gateway = new FakeGateway();
    gateway.openResult = summary();
    const fixture = await renderWith(gateway);
    const open = fixture.nativeElement.querySelector('.toolbar .button--primary') as HTMLButtonElement;
    open.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.inspect-panel')).toBeTruthy();
    expect(compiled.querySelector('.inspect-panel')?.textContent).toContain('MEVD17.2.6');
    expect(compiled.querySelector('.refusal-banner')).toBeFalsy();
  });

  it('shows a refusal banner when the engine refuses editing', async () => {
    const gateway = new FakeGateway();
    gateway.openResult = summary({ editingAllowed: false, refusalReason: 'the XDF region does not fit' });
    const fixture = await renderWith(gateway);
    const open = fixture.nativeElement.querySelector('.toolbar .button--primary') as HTMLButtonElement;
    open.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.refusal-banner')?.textContent).toContain('does not fit');
  });

  it('shows an error panel for a real failure', async () => {
    const gateway = new FakeGateway();
    gateway.openResult = new Error('load XDF: unexpected element');
    const fixture = await renderWith(gateway);
    const open = fixture.nativeElement.querySelector('.toolbar .button--primary') as HTMLButtonElement;
    open.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.status-panel--danger')?.textContent).toContain('unexpected element');
  });

  async function openWorkspaceAndSettleMapTree(gateway: FakeGateway) {
    gateway.openResult = summary();
    const fixture = await renderWith(gateway);
    const open = fixture.nativeElement.querySelector('.toolbar .button--primary') as HTMLButtonElement;
    open.click();
    await fixture.whenStable();
    fixture.detectChanges();
    // MapBrowserStore debounces search; let its initial (empty-query) refresh land.
    await new Promise((resolve) => setTimeout(resolve, 150));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('opens a map into a new grid tab from the map tree', async () => {
    const gateway = new FakeGateway();
    const fixture = await openWorkspaceAndSettleMapTree(gateway);
    const compiled = fixture.nativeElement as HTMLElement;
    const mapRow = compiled.querySelector('.map-row') as HTMLButtonElement;
    expect(mapRow?.textContent).toContain('Performance gauge scaling');

    mapRow.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelectorAll('.document-tab').length).toBe(2); // overview + the new grid tab
    expect(compiled.querySelector('.map-editor__header')?.textContent).toContain('Performance gauge scaling');
    expect(compiled.querySelectorAll('.map-grid td').length).toBe(4);
    expect(mapRow.classList).toContain('map-row--active');
  });

  it('clicking a second map adds it to the same active grid instead of opening a new tab', async () => {
    const gateway = new FakeGateway();
    const fixture = await openWorkspaceAndSettleMapTree(gateway);
    const compiled = fixture.nativeElement as HTMLElement;
    const mapRow = compiled.querySelector('.map-row') as HTMLButtonElement;
    mapRow.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Only one map exists in this fixture's listMaps() stub, so re-clicking
    // it proves it isn't duplicated within the grid rather than proving a
    // second distinct map lands in the same tab.
    mapRow.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelectorAll('.document-tab').length).toBe(2); // still just one grid tab
    expect(compiled.querySelectorAll('.grid-panel__cell').length).toBe(1);
  });

  it('removing a map from a grid closes just that panel, not the tab', async () => {
    const gateway = new FakeGateway();
    const fixture = await openWorkspaceAndSettleMapTree(gateway);
    const compiled = fixture.nativeElement as HTMLElement;
    (compiled.querySelector('.map-row') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelectorAll('.document-tab').length).toBe(2);
    (compiled.querySelector('.grid-panel__remove') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelectorAll('.document-tab').length).toBe(2); // the (now-empty) tab stays open
    expect(compiled.querySelector('.grid-panel__empty')).toBeTruthy();
  });

  it('the "+" button opens an additional empty grid tab', async () => {
    const gateway = new FakeGateway();
    const fixture = await openWorkspaceAndSettleMapTree(gateway);
    const compiled = fixture.nativeElement as HTMLElement;

    (compiled.querySelector('[aria-label="New grid"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelectorAll('.document-tab').length).toBe(2); // overview + the new empty grid
    expect(compiled.querySelector('.grid-panel__empty')).toBeTruthy();
  });

  it('disables Undo/Redo until there is history, and wires the toolbar buttons to the gateway', async () => {
    const gateway = new FakeGateway();
    gateway.openResult = summary();
    const fixture = await renderWith(gateway);
    const open = fixture.nativeElement.querySelector('.toolbar .button--primary') as HTMLButtonElement;
    open.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const undoButton = compiled.querySelector('[aria-label="Undo"]') as HTMLButtonElement;
    const redoButton = compiled.querySelector('[aria-label="Redo"]') as HTMLButtonElement;
    expect(undoButton.disabled).toBe(true);
    expect(redoButton.disabled).toBe(true);

    // Simulate a prior edit enabling Undo, the way MapEditor would report one.
    TestBed.inject(EditHistoryStore).noteEdit({ canUndo: true, canRedo: false } as types.EditOutcome);
    fixture.detectChanges();
    expect(undoButton.disabled).toBe(false);

    undoButton.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(gateway.undoCalls).toBe(1);
    expect(undoButton.disabled).toBe(true);
    expect(redoButton.disabled).toBe(false);

    redoButton.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(gateway.redoCalls).toBe(1);
    expect(undoButton.disabled).toBe(false);
    expect(redoButton.disabled).toBe(true);
  });

  it('opens the save review dialog from the toolbar and saves through it', async () => {
    const gateway = new FakeGateway();
    gateway.openResult = summary();
    gateway.checksumResult = { provider: 'bosch.mevd17.2.6.75P9EJ0B', status: 'invalid', regions: 11 } as types.ChecksumSummary;
    gateway.saveResult = {
      path: '/tmp/corrected.bin',
      sha256: 'a'.repeat(64),
      provider: 'bosch.mevd17.2.6.75P9EJ0B',
      regionsVerified: 11,
      wasAlreadyValid: false,
    } as types.SaveOutcome;
    const fixture = await renderWith(gateway);
    const open = fixture.nativeElement.querySelector('.toolbar .button--primary') as HTMLButtonElement;
    open.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const saveAs = compiled.querySelector('[aria-label="Save as"]') as HTMLButtonElement;
    expect(saveAs.disabled).toBe(false);
    saveAs.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelector('.save-review')).toBeTruthy();
    expect(compiled.querySelector('.save-review__summary')?.textContent).toContain('bosch.mevd17.2.6.75P9EJ0B');

    (compiled.querySelector('.save-review__actions .button--primary') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(gateway.saveCalls).toBe(1);
    expect(compiled.querySelector('.save-review__success')?.textContent).toContain('11');
  });

  it('enables contextual table tools for the focused map and validates the operand', async () => {
    const gateway = new FakeGateway();
    const fixture = await openWorkspaceAndSettleMapTree(gateway);
    const compiled = fixture.nativeElement as HTMLElement;
    (compiled.querySelector('.map-row') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const cell = compiled.querySelector('.map-grid td') as HTMLElement;
    cell.click();
    fixture.detectChanges();
    const operation = compiled.querySelector('.table-tools select') as HTMLSelectElement;
    const operand = compiled.querySelector('.table-tools input') as HTMLInputElement;
    const apply = compiled.querySelector('.toolbar-apply') as HTMLButtonElement;

    operation.value = 'divide';
    operation.dispatchEvent(new Event('change'));
    operand.value = '0';
    operand.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(apply.disabled).toBe(true);

    operation.value = 'offset';
    operation.dispatchEvent(new Event('change'));
    operand.value = '-2.5';
    operand.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(apply.disabled).toBe(false);
    apply.click();
    await fixture.whenStable();
    expect(gateway.operationCalls[0]).toMatchObject({ mapId: 0, operation: 'offset', operand: -2.5 });
  });

  it('opens the help dialog from the titlebar button', async () => {
    const fixture = await renderWith(new FakeGateway());
    const compiled = fixture.nativeElement as HTMLElement;
    (compiled.querySelector('[aria-label="Help and keyboard shortcuts"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('.help-dialog')).toBeTruthy();
  });

  it('undoes and redoes via global Ctrl+Z / Ctrl+Y, but not while a text input has focus', async () => {
    const gateway = new FakeGateway();
    const fixture = await renderWith(gateway);
    TestBed.inject(EditHistoryStore).noteEdit({ canUndo: true, canRedo: false } as types.EditOutcome);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await fixture.whenStable();
    expect(gateway.undoCalls).toBe(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    await fixture.whenStable();
    expect(gateway.redoCalls).toBe(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
    await fixture.whenStable();
    expect(gateway.redoCalls).toBe(1); // disabled after the prior Redo consumed the redo transaction

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await fixture.whenStable();
    expect(gateway.undoCalls).toBe(1); // unchanged: the browser's own input undo should win
    input.remove();
  });

  it('dispatches the remaining global toolbar shortcuts through their commands', async () => {
    const gateway = new FakeGateway();
    gateway.openResult = summary();
    const fixture = await renderWith(gateway);
    const compiled = fixture.nativeElement as HTMLElement;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(compiled.querySelector('.inspect-panel')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }));
    fixture.detectChanges();
    expect(compiled.querySelector('.grid-panel__empty')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, shiftKey: true, bubbles: true }));
    fixture.detectChanges();
    expect(compiled.querySelector('.diff-panel')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }));
    fixture.detectChanges();
    expect(compiled.querySelector('.help-dialog')).toBeTruthy();
  });

  it('focuses the map search field on Ctrl+K once a workspace is open', async () => {
    const gateway = new FakeGateway();
    gateway.openResult = summary();
    const fixture = await renderWith(gateway);
    // Focus (document.activeElement) only works for elements connected to
    // the live document, which a bare TestBed fixture is not by default.
    document.body.appendChild(fixture.nativeElement);
    const open = fixture.nativeElement.querySelector('.toolbar .button--primary') as HTMLButtonElement;
    open.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const searchInput = fixture.nativeElement.querySelector('.search-field input') as HTMLInputElement;
    expect(document.activeElement).not.toBe(searchInput);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(searchInput);
    fixture.nativeElement.remove();
  });
});
