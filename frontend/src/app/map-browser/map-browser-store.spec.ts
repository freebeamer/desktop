import { TestBed } from '@angular/core/testing';
import { DesktopGateway } from '../core/desktop-gateway';
import { WorkspaceStore } from '../workspace/workspace-store';
import { MapBrowserStore } from './map-browser-store';
import type { types } from '../../../wailsjs/go/models';

function summary(generation: number): types.WorkspaceSummary {
  return {
    generation,
    xdfPath: '/tmp/def.xdf',
    binPath: '/tmp/image.bin',
    rom: { sizeBytes: 4194304, sha256: 'abc' },
    ecu: { manufacturer: '', vendor: '', family: '', engine: '', confidence: 'none' },
    xdf: { version: '1.70', categories: 1, tables: 2, flags: 0 },
    compatibility: { regionFitsRom: true, addressedMaps: 2, totalMaps: 2, mapValidationErrors: 0 },
    checksum: { provider: '', status: 'unsupported', regions: 0 },
    editingAllowed: true,
  } as types.WorkspaceSummary;
}

function page(maps: types.MapSummary[]): types.MapPage {
  return { generation: 1, total: maps.length, categories: ['Boost', 'Fuel'], maps } as unknown as types.MapPage;
}

class FakeGateway implements DesktopGateway {
  openResult: types.WorkspaceSummary = summary(1);
  listMapsCalls: types.MapFilter[] = [];
  listMapsResult: types.MapPage | Error = page([
    { id: 0, title: 'Boost target', categories: ['Boost'], shape: 'matrix' } as types.MapSummary,
  ]);

  health = (): Promise<types.HealthStatus> =>
    Promise.resolve({ ready: true, apiVersion: 'desktop-v1', engine: 'FreeBeamer Go' });
  chooseAndOpenWorkspace = (): Promise<types.WorkspaceSummary> => Promise.resolve(this.openResult);
  openWorkspace = (): Promise<types.WorkspaceSummary> => Promise.resolve(this.openResult);
  getWorkspace = (): Promise<types.WorkspaceSummary> => Promise.reject(new Error('unused'));
  closeWorkspace = (): Promise<void> => Promise.resolve();
  recentWorkspaces = (): Promise<types.RecentEntry[]> => Promise.resolve([]);
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

  listMaps(filter: types.MapFilter): Promise<types.MapPage> {
    this.listMapsCalls.push(filter);
    return this.listMapsResult instanceof Error ? Promise.reject(this.listMapsResult) : Promise.resolve(this.listMapsResult);
  }
}

/**
 * Effects created outside a component fixture (as MapBrowserStore's is)
 * flush on Angular's own scheduler, not deterministically within a fixed
 * number of microtasks. Polling a real condition instead of sleeping a
 * guessed duration avoids racing that first flush against the assertions.
 */
async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('MapBrowserStore', () => {
  let gateway: FakeGateway;
  let workspace: WorkspaceStore;
  let store: MapBrowserStore;

  beforeEach(() => {
    gateway = new FakeGateway();
    TestBed.configureTestingModule({ providers: [{ provide: DesktopGateway, useValue: gateway }] });
    workspace = TestBed.inject(WorkspaceStore);
    store = TestBed.inject(MapBrowserStore);
  });

  async function openAndSettle(): Promise<void> {
    await workspace.chooseAndOpen();
    await waitUntil(() => store.page() !== null || store.errorMessage() !== '');
  }

  it('has no page before a workspace opens', () => {
    expect(store.page()).toBeNull();
  });

  it('loads the map page once a workspace opens', async () => {
    await openAndSettle();
    expect(store.page()?.total).toBe(1);
    expect(store.page()?.maps[0].title).toBe('Boost target');
  });

  it('debounces search queries into a single request', async () => {
    await openAndSettle();
    gateway.listMapsCalls = [];

    store.setQuery('b');
    store.setQuery('bo');
    store.setQuery('boo');
    await waitUntil(() => gateway.listMapsCalls.length > 0);
    // The debounce window is short; give any (incorrect) extra call time to land.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(gateway.listMapsCalls.length).toBe(1);
    expect(gateway.listMapsCalls[0].query).toBe('boo');
  });

  it('toggles a category filter on and off', async () => {
    await openAndSettle();

    store.setCategory('Boost');
    expect(store.category()).toBe('Boost');
    await waitUntil(() => gateway.listMapsCalls.at(-1)?.category === 'Boost');

    store.setCategory('Boost');
    expect(store.category()).toBe('');
    await waitUntil(() => gateway.listMapsCalls.at(-1)?.category === '');
  });

  it('resets query, category, and page when the workspace changes', async () => {
    await openAndSettle();
    store.setQuery('boost');
    await waitUntil(() => gateway.listMapsCalls.at(-1)?.query === 'boost');

    gateway.openResult = summary(2);
    await workspace.chooseAndOpen();
    await waitUntil(() => store.query() === '' && store.category() === '');

    expect(store.query()).toBe('');
    expect(store.category()).toBe('');
  });

  it('surfaces a load failure as an error message', async () => {
    gateway.listMapsResult = new Error('desktop: no workspace is open');
    await openAndSettle();
    expect(store.errorMessage()).toContain('no workspace is open');
  });
});
