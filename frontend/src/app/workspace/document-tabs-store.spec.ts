import { TestBed } from '@angular/core/testing';
import { DesktopGateway } from '../core/desktop-gateway';
import { DocumentTabsStore } from './document-tabs-store';
import { WorkspaceStore } from './workspace-store';
import type { types } from '../../../wailsjs/go/models';

function summary(generation: number): types.WorkspaceSummary {
  return {
    generation,
    xdfPath: '/tmp/def.xdf',
    binPath: '/tmp/image.bin',
    rom: { sizeBytes: 4194304, sha256: 'abc' },
    ecu: { manufacturer: '', vendor: '', family: '', engine: '', confidence: 'none' },
    xdf: { version: '1.70', categories: 1, tables: 1, flags: 0 },
    compatibility: { regionFitsRom: true, addressedMaps: 1, totalMaps: 1, mapValidationErrors: 0 },
    checksum: { provider: '', status: 'unsupported', regions: 0 },
    editingAllowed: true,
  } as types.WorkspaceSummary;
}

class FakeGateway implements DesktopGateway {
  openResult: types.WorkspaceSummary = summary(1);
  health = (): Promise<types.HealthStatus> =>
    Promise.resolve({ ready: true, apiVersion: 'desktop-v1', engine: 'FreeBeamer Go' });
  chooseAndOpenWorkspace = (): Promise<types.WorkspaceSummary> => Promise.resolve(this.openResult);
  openWorkspace = (): Promise<types.WorkspaceSummary> => Promise.resolve(this.openResult);
  getWorkspace = (): Promise<types.WorkspaceSummary> => Promise.reject(new Error('unused'));
  closeWorkspace = (): Promise<void> => Promise.resolve();
  recentWorkspaces = (): Promise<types.RecentEntry[]> => Promise.resolve([]);
  listMaps = (): Promise<types.MapPage> =>
    Promise.resolve({ generation: 1, total: 0, categories: [], maps: [] } as unknown as types.MapPage);
  getMap = (): Promise<types.MapDetail> => Promise.reject(new Error('unused'));
  applyCellOperation = (): Promise<types.BatchEditOutcome> => Promise.reject(new Error('unused'));
  setCell = (): Promise<types.EditOutcome> => Promise.reject(new Error('unused'));
  setIndex = (): Promise<types.EditOutcome> => Promise.reject(new Error('unused'));
  undo = (): Promise<types.EditOutcome> => Promise.reject(new Error('unused'));
  redo = (): Promise<types.EditOutcome> => Promise.reject(new Error('unused'));
  getDiff = (): Promise<types.DiffSummary> => Promise.reject(new Error('unused'));
  verifyChecksums = (): Promise<types.ChecksumSummary> => Promise.reject(new Error('unused'));
  saveAs = (): Promise<types.SaveOutcome> => Promise.reject(new Error('unused'));
  chooseAndSaveAs = (): Promise<types.SaveOutcome> => Promise.reject(new Error('unused'));
}

describe('DocumentTabsStore', () => {
  let gateway: FakeGateway;
  let workspace: WorkspaceStore;
  let tabs: DocumentTabsStore;

  beforeEach(() => {
    gateway = new FakeGateway();
    TestBed.configureTestingModule({ providers: [{ provide: DesktopGateway, useValue: gateway }] });
    workspace = TestBed.inject(WorkspaceStore);
    tabs = TestBed.inject(DocumentTabsStore);
  });

  it('starts with only the overview tab active', () => {
    expect(tabs.tabs()).toEqual([{ kind: 'overview' }]);
    expect(tabs.activeGridId()).toBeNull();
    expect(tabs.isActive({ kind: 'overview' })).toBe(true);
  });

  it('adding a map with no grid active creates a new grid tab', () => {
    tabs.addMapToActiveGrid(0); // regression: map id 0 must not be treated as falsy/missing
    expect(tabs.tabs().length).toBe(2);
    const gridId = tabs.activeGridId();
    expect(gridId).not.toBeNull();
    expect(tabs.activeGridMapIds()).toEqual([0]);
    expect(tabs.isMapInActiveGrid(0)).toBe(true);
  });

  it('adding another map while a grid is active adds it to the same grid', () => {
    tabs.addMapToActiveGrid(3);
    const gridId = tabs.activeGridId()!;
    tabs.addMapToActiveGrid(7);
    expect(tabs.tabs().length).toBe(2); // still one grid tab, not two
    expect(tabs.activeGridId()).toBe(gridId);
    expect(tabs.activeGridMapIds()).toEqual([3, 7]);
  });

  it('fits a newly loaded scalar panel once but preserves a user-resized width', () => {
    tabs.addMapToActiveGrid(3);
    const gridId = tabs.activeGridId()!;
    tabs.fitPanelToMap(gridId, 3, { shape: 'scalar', rows: 1, columns: 1 });
    expect(tabs.activeGridPanels()[0]).toMatchObject({ width: 240, height: 72 });

    tabs.updatePanelLayout(gridId, 3, { width: 330 });
    tabs.fitPanelToMap(gridId, 3, { shape: 'scalar', rows: 1, columns: 1 });
    expect(tabs.activeGridPanels()[0].width).toBe(330);
  });

  it('sizes table panels from their decoded row and column counts', () => {
    tabs.addMapToActiveGrid(3);
    const gridId = tabs.activeGridId()!;
    tabs.fitPanelToMap(gridId, 3, { shape: 'matrix', rows: 2, columns: 2 });
    expect(tabs.activeGridPanels()[0]).toMatchObject({ width: 480, height: 246 });

    tabs.addMapToGrid(gridId, 7);
    tabs.fitPanelToMap(gridId, 7, { shape: 'matrix', rows: 6, columns: 6 });
    expect(tabs.activeGridPanels()[1]).toMatchObject({ width: 552, height: 362 });
  });

  it('keeps table height synchronized to rendered content', () => {
    tabs.addMapToActiveGrid(3);
    const gridId = tabs.activeGridId()!;
    const map = { shape: 'matrix', rows: 2, columns: 2 };
    tabs.fitPanelToMap(gridId, 3, map);
    tabs.syncPanelHeightToContent(gridId, 3, map, 198.2);
    expect(tabs.activeGridPanels()[0].height).toBe(199);

    tabs.syncPanelHeightToContent(gridId, 3, map, 190);
    expect(tabs.activeGridPanels()[0].height).toBe(190);
  });

  it('uses the rendered matrix table width as the initial width only', () => {
    tabs.addMapToActiveGrid(3);
    const gridId = tabs.activeGridId()!;
    const map = { shape: 'matrix', rows: 2, columns: 2 };
    tabs.fitPanelToMap(gridId, 3, map);
    tabs.syncPanelWidthToTable(gridId, 3, map, 314.2);
    expect(tabs.activeGridPanels()[0].width).toBe(315);

    tabs.updatePanelLayout(gridId, 3, { width: 400 });
    tabs.syncPanelWidthToTable(gridId, 3, map, 280);
    expect(tabs.activeGridPanels()[0].width).toBe(400);
  });

  it('does not cap a measured table width', () => {
    tabs.addMapToActiveGrid(3);
    const gridId = tabs.activeGridId()!;
    const map = { shape: 'matrix', rows: 2, columns: 12 };
    tabs.fitPanelToMap(gridId, 3, map);
    tabs.syncPanelWidthToTable(gridId, 3, map, 1040);
    expect(tabs.activeGridPanels()[0].width).toBe(1040);
  });

  it('does not duplicate a map already in the grid, and activating an inactive grid keeps its contents', () => {
    tabs.addMapToActiveGrid(3);
    const first = tabs.activeGridId()!;
    tabs.newGrid();
    tabs.addMapToActiveGrid(3); // same map, but now the second grid is active
    expect(tabs.tabs().length).toBe(3);

    tabs.addMapToGrid(first, 3); // adding it again to the first grid is a no-op
    tabs.activate({ kind: 'grid', id: first, title: '', panels: [] });
    expect(tabs.activeGridMapIds()).toEqual([3]);
  });

  it('dragging a map onto a specific grid adds it there and activates that grid', () => {
    const a = tabs.newGrid();
    const b = tabs.newGrid();
    tabs.addMapToGrid(a.id, 9);
    expect(tabs.activeGridId()).toBe(a.id); // addMapToGrid activates the target grid
    expect(tabs.activeGridMapIds()).toEqual([9]);

    tabs.activate(b);
    expect(tabs.activeGridMapIds()).toEqual([]);
  });

  it('removes a single map from a grid without closing the tab', () => {
    const grid = tabs.newGrid();
    tabs.addMapToGrid(grid.id, 1);
    tabs.addMapToGrid(grid.id, 2);
    tabs.removeMapFromGrid(grid.id, 1);
    expect(tabs.tabs().length).toBe(2);
    expect(tabs.activeGridMapIds()).toEqual([2]);
  });

  it('closing the active grid tab falls back to the previous tab', () => {
    const a = tabs.newGrid();
    tabs.newGrid();
    tabs.activate(a);
    tabs.close(tabs.activeTab());
    expect(tabs.tabs().length).toBe(2); // overview + the remaining grid
    expect(tabs.activeGridId()).not.toBeNull();
  });

  it('cannot close the overview tab', () => {
    tabs.close({ kind: 'overview' });
    expect(tabs.tabs()).toEqual([{ kind: 'overview' }]);
  });

  it('opens a single changes tab regardless of how many times it is requested', () => {
    tabs.newGrid();
    tabs.openChanges();
    tabs.openChanges();
    expect(tabs.tabs().filter((tab) => tab.kind === 'changes').length).toBe(1);
    expect(tabs.isActive({ kind: 'changes' })).toBe(true);
  });

  it('can close the changes tab', () => {
    tabs.openChanges();
    tabs.close({ kind: 'changes' });
    expect(tabs.tabs()).toEqual([{ kind: 'overview' }]);
  });

  it('resets open tabs whenever the workspace changes', async () => {
    tabs.addMapToActiveGrid(5);
    expect(tabs.activeGridId()).not.toBeNull();

    gateway.openResult = summary(2);
    await workspace.chooseAndOpen();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(tabs.tabs()).toEqual([{ kind: 'overview' }]);
    expect(tabs.activeGridId()).toBeNull();
  });
});
