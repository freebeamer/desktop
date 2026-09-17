import { TestBed } from '@angular/core/testing';
import { DesktopGateway } from '../core/desktop-gateway';
import { WorkspaceStore } from './workspace-store';
import type { types } from '../../../wailsjs/go/models';

function summary(overrides: Partial<types.WorkspaceSummary> = {}): types.WorkspaceSummary {
  return {
    generation: 1,
    xdfPath: '/tmp/def.xdf',
    binPath: '/tmp/image.bin',
    rom: { sizeBytes: 4194304, sha256: 'abc123' },
    ecu: { manufacturer: 'BMW', vendor: 'Bosch', family: 'MEVD17.2.6', engine: 'BMW N55', confidence: 'high' },
    xdf: { version: '1.70', categories: 73, tables: 962, flags: 7 },
    compatibility: { regionFitsRom: true, addressedMaps: 962, totalMaps: 962, mapValidationErrors: 0 },
    checksum: { provider: 'bosch.mevd17.2.6.75P9EJ0B', status: 'valid', regions: 11 },
    editingAllowed: true,
    ...overrides,
  } as types.WorkspaceSummary;
}

class FakeGateway implements DesktopGateway {
  openResult: types.WorkspaceSummary | Error = summary();

  health(): Promise<types.HealthStatus> {
    return Promise.resolve({ ready: true, apiVersion: 'desktop-v1', engine: 'FreeBeamer Go' });
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
    return Promise.resolve({ generation: 1, total: 0, categories: [], maps: [] } as unknown as types.MapPage);
  }

  getMap(): Promise<types.MapDetail> {
    return Promise.reject(new Error('not used in this test'));
  }

  setCell(): Promise<types.EditOutcome> {
    return Promise.reject(new Error('not used in this test'));
  }

  applyCellOperation(): Promise<types.BatchEditOutcome> {
    return Promise.reject(new Error('not used in this test'));
  }

  setIndex(): Promise<types.EditOutcome> {
    return Promise.reject(new Error('not used in this test'));
  }

  undo(): Promise<types.EditOutcome> {
    return Promise.reject(new Error('not used in this test'));
  }

  redo(): Promise<types.EditOutcome> {
    return Promise.reject(new Error('not used in this test'));
  }

  getDiff(): Promise<types.DiffSummary> {
    return Promise.reject(new Error('not used in this test'));
  }

  verifyChecksums(): Promise<types.ChecksumSummary> {
    return Promise.reject(new Error('not used in this test'));
  }

  saveAs(): Promise<types.SaveOutcome> {
    return Promise.reject(new Error('not used in this test'));
  }

  chooseAndSaveAs(): Promise<types.SaveOutcome> {
    return Promise.reject(new Error('not used in this test'));
  }
}

describe('WorkspaceStore', () => {
  let gateway: FakeGateway;
  let store: WorkspaceStore;

  beforeEach(() => {
    gateway = new FakeGateway();
    TestBed.configureTestingModule({ providers: [{ provide: DesktopGateway, useValue: gateway }] });
    store = TestBed.inject(WorkspaceStore);
  });

  it('starts empty', () => {
    expect(store.phase()).toBe('empty');
    expect(store.summary()).toBeNull();
  });

  it('moves to ready when the engine allows editing', async () => {
    await store.chooseAndOpen();
    expect(store.phase()).toBe('ready');
    expect(store.summary()?.checksum.status).toBe('valid');
  });

  it('moves to unsupported when the engine refuses editing', async () => {
    gateway.openResult = summary({ editingAllowed: false, refusalReason: 'region mismatch' });
    await store.chooseAndOpen();
    expect(store.phase()).toBe('unsupported');
    expect(store.summary()?.refusalReason).toBe('region mismatch');
  });

  it('returns to empty without an error banner when the dialog is cancelled', async () => {
    gateway.openResult = new Error('desktop: file selection was cancelled');
    await store.chooseAndOpen();
    expect(store.phase()).toBe('empty');
    expect(store.errorMessage()).toBe('');
  });

  it('surfaces a real failure as an error state', async () => {
    gateway.openResult = new Error('load XDF: unexpected element');
    await store.chooseAndOpen();
    expect(store.phase()).toBe('error');
    expect(store.errorMessage()).toContain('unexpected element');
  });

  it('resets to empty on close', async () => {
    await store.chooseAndOpen();
    await store.close();
    expect(store.phase()).toBe('empty');
    expect(store.summary()).toBeNull();
  });
});
