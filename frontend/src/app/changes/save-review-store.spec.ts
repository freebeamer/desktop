import { TestBed } from '@angular/core/testing';
import { DesktopGateway } from '../core/desktop-gateway';
import { SaveReviewStore } from './save-review-store';
import type { types } from '../../../wailsjs/go/models';

class FakeGateway implements DesktopGateway {
  checksumResult: types.ChecksumSummary | Error = { provider: 'p', status: 'invalid', regions: 11 } as types.ChecksumSummary;
  diffResult: types.DiffSummary | Error = { changedBytes: 1, edits: [{}] } as unknown as types.DiffSummary;
  saveResult: types.SaveOutcome | Error = { path: '/tmp/out.bin', sha256: 'abc', provider: 'p', regionsVerified: 11, wasAlreadyValid: false } as types.SaveOutcome;

  health = (): Promise<types.HealthStatus> =>
    Promise.resolve({ ready: true, apiVersion: 'desktop-v1', engine: 'FreeBeamer Go' });
  chooseAndOpenWorkspace = (): Promise<types.WorkspaceSummary> => Promise.reject(new Error('unused'));
  openWorkspace = (): Promise<types.WorkspaceSummary> => Promise.reject(new Error('unused'));
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

  getDiff(): Promise<types.DiffSummary> {
    return this.diffResult instanceof Error ? Promise.reject(this.diffResult) : Promise.resolve(this.diffResult);
  }

  verifyChecksums(): Promise<types.ChecksumSummary> {
    return this.checksumResult instanceof Error ? Promise.reject(this.checksumResult) : Promise.resolve(this.checksumResult);
  }

  saveAs(): Promise<types.SaveOutcome> {
    return Promise.reject(new Error('unused'));
  }

  chooseAndSaveAs(): Promise<types.SaveOutcome> {
    return this.saveResult instanceof Error ? Promise.reject(this.saveResult) : Promise.resolve(this.saveResult);
  }
}

describe('SaveReviewStore', () => {
  let gateway: FakeGateway;
  let store: SaveReviewStore;

  beforeEach(() => {
    gateway = new FakeGateway();
    TestBed.configureTestingModule({ providers: [{ provide: DesktopGateway, useValue: gateway }] });
    store = TestBed.inject(SaveReviewStore);
  });

  it('starts closed', () => {
    expect(store.phase()).toBe('closed');
  });

  it('open() loads checksum and diff for review', async () => {
    await store.open();
    expect(store.phase()).toBe('reviewing');
    expect(store.checksum()?.status).toBe('invalid');
    expect(store.diff()?.changedBytes).toBe(1);
  });

  it('close() returns to closed from any phase', async () => {
    await store.open();
    store.close();
    expect(store.phase()).toBe('closed');
  });

  it('surfaces a failure to load review data as an error phase', async () => {
    gateway.checksumResult = new Error('desktop: no workspace is open');
    await store.open();
    expect(store.phase()).toBe('error');
    expect(store.errorMessage()).toContain('no workspace is open');
  });

  it('confirmSave() saves and moves to done with the outcome', async () => {
    await store.open();
    await store.confirmSave();
    expect(store.phase()).toBe('done');
    expect(store.outcome()?.path).toBe('/tmp/out.bin');
  });

  it('confirmSave() returns to reviewing without an error when the save dialog is cancelled', async () => {
    await store.open();
    gateway.saveResult = new Error('desktop: file selection was cancelled');
    await store.confirmSave();
    expect(store.phase()).toBe('reviewing');
    expect(store.errorMessage()).toBe('');
  });

  it('confirmSave() surfaces a real save failure as an error phase', async () => {
    await store.open();
    gateway.saveResult = new Error('desktop: no checksum provider supports this firmware; refusing to save');
    await store.confirmSave();
    expect(store.phase()).toBe('error');
    expect(store.errorMessage()).toContain('refusing to save');
  });
});
