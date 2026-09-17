import { TestBed } from '@angular/core/testing';
import { DesktopGateway } from '../core/desktop-gateway';
import { EditHistoryStore } from './edit-history-store';
import { WorkspaceStore } from './workspace-store';
import type { types } from '../../../wailsjs/go/models';

function summary(generation: number, overrides: Partial<types.WorkspaceSummary> = {}): types.WorkspaceSummary {
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
    changedBytes: 0,
    editCount: 0,
    canUndo: false,
    canRedo: false,
    ...overrides,
  } as types.WorkspaceSummary;
}

class FakeGateway implements DesktopGateway {
  openResult: types.WorkspaceSummary = summary(1);
  undoResult: types.EditOutcome | Error = { canUndo: false, canRedo: true } as types.EditOutcome;
  redoResult: types.EditOutcome | Error = { canUndo: true, canRedo: false } as types.EditOutcome;

  health = (): Promise<types.HealthStatus> =>
    Promise.resolve({ ready: true, apiVersion: 'desktop-v1', engine: 'FreeBeamer Go' });
  chooseAndOpenWorkspace = (): Promise<types.WorkspaceSummary> => Promise.resolve(this.openResult);
  openWorkspace = (): Promise<types.WorkspaceSummary> => Promise.resolve(this.openResult);
  getWorkspace = (): Promise<types.WorkspaceSummary> => Promise.resolve(this.openResult);
  closeWorkspace = (): Promise<void> => Promise.resolve();
  recentWorkspaces = (): Promise<types.RecentEntry[]> => Promise.resolve([]);
  listMaps = (): Promise<types.MapPage> =>
    Promise.resolve({ generation: 1, total: 0, categories: [], maps: [] } as unknown as types.MapPage);
  getMap = (): Promise<types.MapDetail> => Promise.reject(new Error('unused'));
  applyCellOperation = (): Promise<types.BatchEditOutcome> => Promise.reject(new Error('unused'));
  setCell = (): Promise<types.EditOutcome> => Promise.reject(new Error('unused'));
  setIndex = (): Promise<types.EditOutcome> => Promise.reject(new Error('unused'));
  getDiff = (): Promise<types.DiffSummary> => Promise.reject(new Error('unused'));
  verifyChecksums = (): Promise<types.ChecksumSummary> => Promise.reject(new Error('unused'));
  saveAs = (): Promise<types.SaveOutcome> => Promise.reject(new Error('unused'));
  chooseAndSaveAs = (): Promise<types.SaveOutcome> => Promise.reject(new Error('unused'));

  undo(): Promise<types.EditOutcome> {
    return this.undoResult instanceof Error ? Promise.reject(this.undoResult) : Promise.resolve(this.undoResult);
  }

  redo(): Promise<types.EditOutcome> {
    return this.redoResult instanceof Error ? Promise.reject(this.redoResult) : Promise.resolve(this.redoResult);
  }
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

describe('EditHistoryStore', () => {
  let gateway: FakeGateway;
  let workspace: WorkspaceStore;
  let history: EditHistoryStore;

  beforeEach(() => {
    gateway = new FakeGateway();
    TestBed.configureTestingModule({ providers: [{ provide: DesktopGateway, useValue: gateway }] });
    workspace = TestBed.inject(WorkspaceStore);
    history = TestBed.inject(EditHistoryStore);
  });

  it('starts with nothing to undo or redo', () => {
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.revision()).toBe(0);
  });

  it('adopts the opened workspace summary’s undo/redo state', async () => {
    gateway.openResult = summary(1, { canUndo: true, canRedo: false });
    await workspace.chooseAndOpen();
    await waitUntil(() => history.canUndo());
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it('bumps the revision and updates undo/redo state on noteEdit', async () => {
    await workspace.chooseAndOpen();
    history.noteEdit({ canUndo: true, canRedo: false } as types.EditOutcome);
    expect(history.revision()).toBe(1);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it('undo calls the gateway and updates state from the outcome', async () => {
    await workspace.chooseAndOpen();
    history.noteEdit({ canUndo: true, canRedo: false } as types.EditOutcome);
    await history.undo();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    expect(history.revision()).toBe(2);
  });

  it('redo calls the gateway and updates state from the outcome', async () => {
    await workspace.chooseAndOpen();
    await history.undo();
    await history.redo();
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it('surfaces an undo failure without crashing', async () => {
    await workspace.chooseAndOpen();
    gateway.undoResult = new Error('desktop: no edit to undo');
    await history.undo();
    expect(history.errorMessage()).toContain('no edit to undo');
  });

  it('resets when the workspace changes', async () => {
    await workspace.chooseAndOpen();
    history.noteEdit({ canUndo: true, canRedo: false } as types.EditOutcome);

    gateway.openResult = summary(2);
    await workspace.chooseAndOpen();
    await waitUntil(() => !history.canUndo());

    expect(history.revision()).toBe(0);
    expect(history.canUndo()).toBe(false);
  });
});
