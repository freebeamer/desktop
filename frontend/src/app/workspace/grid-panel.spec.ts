import { TestBed } from '@angular/core/testing';
import { DesktopGateway } from '../core/desktop-gateway';
import { PlotlyRuntime } from '../visualization/plotly-runtime';
import { DocumentTabsStore, GridPanelLayout } from './document-tabs-store';
import { GridPanel } from './grid-panel';
import { WorkspaceStore } from './workspace-store';
import { ActiveEditorStore } from '../shell/active-editor-store';
import type { types } from '../../../wailsjs/go/models';

const axis = (overrides: Partial<types.AxisDetail> = {}): types.AxisDetail =>
  ({ units: '', formula: 'X', addressed: false, elementBits: 16, ...overrides }) as types.AxisDetail;

function scalarDetail(id: number, title: string): types.MapDetail {
  return {
    id,
    title,
    description: '',
    categories: [],
    shape: 'scalar',
    rows: 1,
    columns: 1,
    x: axis(),
    y: axis(),
    z: axis({ units: 'rpm' }),
    zValues: [[id * 10]],
    zRaw: [[id]],
    zAddresses: [['0x0']],
  } as unknown as types.MapDetail;
}

function workspaceSummary(): types.WorkspaceSummary {
  return {
    generation: 1,
    xdfPath: '/tmp/def.xdf',
    binPath: '/tmp/image.bin',
    rom: { sizeBytes: 4194304, sha256: 'a'.repeat(64) },
    ecu: { manufacturer: '', vendor: '', family: '', engine: '', confidence: 'none' },
    xdf: { version: '1.70', categories: 1, tables: 2, flags: 0 },
    compatibility: { regionFitsRom: true, addressedMaps: 2, totalMaps: 2, mapValidationErrors: 0 },
    checksum: { provider: '', status: 'unsupported', regions: 0 },
    editingAllowed: true,
    changedBytes: 0,
    editCount: 0,
    canUndo: false,
    canRedo: false,
  } as types.WorkspaceSummary;
}

class FakeGateway implements DesktopGateway {
  detailById = new Map<number, types.MapDetail>([
    [1, scalarDetail(1, 'First map')],
    [2, scalarDetail(2, 'Second map')],
  ]);

  health = (): Promise<types.HealthStatus> =>
    Promise.resolve({ ready: true, apiVersion: 'desktop-v1', engine: 'FreeBeamer Go' });
  chooseAndOpenWorkspace = (): Promise<types.WorkspaceSummary> => Promise.resolve(workspaceSummary());
  openWorkspace = (): Promise<types.WorkspaceSummary> => Promise.resolve(workspaceSummary());
  getWorkspace = (): Promise<types.WorkspaceSummary> => Promise.resolve(workspaceSummary());
  closeWorkspace = (): Promise<void> => Promise.resolve();
  recentWorkspaces = (): Promise<types.RecentEntry[]> => Promise.resolve([]);
  listMaps = (): Promise<types.MapPage> =>
    Promise.resolve({ generation: 1, total: 0, categories: [], maps: [] } as unknown as types.MapPage);
  applyCellOperation = (): Promise<types.BatchEditOutcome> => Promise.reject(new Error('unused'));
  setCell = (): Promise<types.EditOutcome> => Promise.reject(new Error('unused'));
  setIndex = (): Promise<types.EditOutcome> => Promise.reject(new Error('unused'));
  undo = (): Promise<types.EditOutcome> => Promise.reject(new Error('unused'));
  redo = (): Promise<types.EditOutcome> => Promise.reject(new Error('unused'));
  getDiff = (): Promise<types.DiffSummary> =>
    Promise.resolve({ changedBytes: 0, edits: [] } as unknown as types.DiffSummary);
  verifyChecksums = (): Promise<types.ChecksumSummary> => Promise.reject(new Error('unused'));
  saveAs = (): Promise<types.SaveOutcome> => Promise.reject(new Error('unused'));
  chooseAndSaveAs = (): Promise<types.SaveOutcome> => Promise.reject(new Error('unused'));

  getMap(mapId: number): Promise<types.MapDetail> {
    const detail = this.detailById.get(mapId);
    return detail ? Promise.resolve(detail) : Promise.reject(new Error(`desktop: no map with id ${mapId}`));
  }
}

/**
 * DocumentTabsStore's reset-on-open effect is deferred, and its own state
 * right after construction (one tab, no active grid) is indistinguishable
 * from "already reset" — so polling for that state proves nothing; it can
 * return immediately before the effect has run even once, and the effect
 * can then flush later and wipe out mutations made in between. A flat delay
 * long enough for the deferred flush to have happened is used instead, and
 * every grid mutation this file makes after it runs in one synchronous
 * block (no further `await`) so nothing can interleave before the assertion.
 */
async function settleDeferredEffects(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

function dropEventWithMapId(mapId: number): DragEvent {
  const data = new Map<string, string>([['text/plain', String(mapId)]]);
  return {
    preventDefault: () => {},
    dataTransfer: { getData: (format: string) => data.get(format) ?? '' } as unknown as DataTransfer,
  } as unknown as DragEvent;
}

function panelsFor(mapIds: number[]): GridPanelLayout[] {
  return mapIds.map((mapId, index) => ({ mapId, x: index * 40, y: index * 40, width: 480, height: 420 }));
}

async function render(gridId: string, mapIds: number[], gateway: FakeGateway) {
  TestBed.configureTestingModule({
    providers: [
      { provide: DesktopGateway, useValue: gateway },
      { provide: PlotlyRuntime, useValue: {} },
    ],
  });
  await TestBed.inject(WorkspaceStore).open('x.xdf', 'y.bin');
  const fixture = TestBed.createComponent(GridPanel);
  fixture.componentRef.setInput('gridId', gridId);
  fixture.componentRef.setInput('panels', panelsFor(mapIds));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('GridPanel', () => {
  it('shows an empty-state prompt with no maps', async () => {
    const fixture = await render('grid-1', [], new FakeGateway());
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.grid-panel__empty')?.textContent).toContain('This grid is empty');
    expect(compiled.querySelectorAll('.grid-panel__cell').length).toBe(0);
  });

  it('renders one map-editor panel per map id', async () => {
    const fixture = await render('grid-1', [1, 2], new FakeGateway());
    const compiled = fixture.nativeElement as HTMLElement;
    const headers = Array.from(compiled.querySelectorAll('.scalar-editor__title')).map((h) => h.textContent);
    expect(headers.some((text) => text?.includes('First map'))).toBe(true);
    expect(headers.some((text) => text?.includes('Second map'))).toBe(true);
    expect(compiled.querySelectorAll('.scalar-editor').length).toBe(2);
    expect(compiled.querySelectorAll('.cell-inspector').length).toBe(0);
  });

  it('targets the last-focused map and clears it when that panel is removed', async () => {
    const fixture = await render('grid-1', [1, 2], new FakeGateway());
    const active = TestBed.inject(ActiveEditorStore);
    const inputs = Array.from(fixture.nativeElement.querySelectorAll('.scalar-editor__input')) as HTMLInputElement[];
    const removeButtons = Array.from(fixture.nativeElement.querySelectorAll('.grid-panel__remove')) as HTMLButtonElement[];

    inputs[0].dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    expect(active.context()?.mapId).toBe(1);
    inputs[1].dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    expect(active.context()?.mapId).toBe(2);

    removeButtons[0].click();
    expect(active.context()?.mapId).toBe(2);
    removeButtons[1].click();
    expect(active.context()).toBeNull();
  });

  it('dropping a map onto the grid adds it', async () => {
    const gateway = new FakeGateway();
    TestBed.configureTestingModule({
      providers: [
        { provide: DesktopGateway, useValue: gateway },
        { provide: PlotlyRuntime, useValue: {} },
      ],
    });
    // DocumentTabsStore must be constructed before the workspace opens, the
    // same order App's own field initializers establish in the real app —
    // otherwise its reset-on-open effect can fire after this test's own
    // tab setup and wipe it, a race that doesn't happen in the real app.
    const tabs = TestBed.inject(DocumentTabsStore);
    await TestBed.inject(WorkspaceStore).open('x.xdf', 'y.bin');
    await settleDeferredEffects();
    const grid = tabs.newGrid();
    const fixture = TestBed.createComponent(GridPanel);
    fixture.componentRef.setInput('gridId', grid.id);
    fixture.componentRef.setInput('panels', tabs.activeGridPanels());
    fixture.detectChanges();

    // jsdom cannot construct a real DragEvent carrying a populated
    // DataTransfer, so this calls the component's own drop handler directly
    // with a stand-in event exposing the same dataTransfer.getData() shape
    // the real browser would provide.
    (fixture.componentInstance as unknown as { onDrop: (e: DragEvent) => void }).onDrop(dropEventWithMapId(1));

    expect(tabs.activeGridMapIds()).toEqual([1]);
  });

  it('removing a map takes it out of that grid in the store', async () => {
    const gateway = new FakeGateway();
    TestBed.configureTestingModule({
      providers: [
        { provide: DesktopGateway, useValue: gateway },
        { provide: PlotlyRuntime, useValue: {} },
      ],
    });
    const tabs = TestBed.inject(DocumentTabsStore);
    await TestBed.inject(WorkspaceStore).open('x.xdf', 'y.bin');
    await settleDeferredEffects();
    const grid = tabs.newGrid();
    tabs.addMapToGrid(grid.id, 1);
    tabs.addMapToGrid(grid.id, 2);
    const fixture = TestBed.createComponent(GridPanel);
    fixture.componentRef.setInput('gridId', grid.id);
    fixture.componentRef.setInput('panels', tabs.activeGridPanels());
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.grid-panel__remove') as HTMLButtonElement).click();

    expect(tabs.activeGridMapIds()).toEqual([2]);
  });

  it('resizes table panels horizontally without changing their content-owned height', async () => {
    const fixture = await render('grid-1', [], new FakeGateway());
    const tabs = TestBed.inject(DocumentTabsStore);
    const update = vi.spyOn(tabs, 'updatePanelLayout');
    const panel: GridPanelLayout = { mapId: 9, x: 0, y: 0, width: 300, height: 246 };
    const pointerDown = {
      clientX: 100,
      preventDefault: () => {},
      stopPropagation: () => {},
      currentTarget: null,
    } as unknown as PointerEvent;

    (fixture.componentInstance as unknown as {
      onResizePointerDown: (event: PointerEvent, panel: GridPanelLayout) => void;
    }).onResizePointerDown(pointerDown, panel);
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 140, clientY: 500 }));
    window.dispatchEvent(new MouseEvent('pointerup'));

    expect(update).toHaveBeenCalledWith('grid-1', 9, { width: 340 });
  });
});
