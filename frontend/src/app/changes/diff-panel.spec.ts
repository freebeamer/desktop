import { TestBed } from '@angular/core/testing';
import { DesktopGateway } from '../core/desktop-gateway';
import { EditHistoryStore } from '../workspace/edit-history-store';
import { DiffPanel } from './diff-panel';
import type { types } from '../../../wailsjs/go/models';

class FakeGateway implements DesktopGateway {
  diffResult: types.DiffSummary | Error = { changedBytes: 0, edits: [] } as unknown as types.DiffSummary;
  diffCalls = 0;

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
    this.diffCalls++;
    return this.diffResult instanceof Error ? Promise.reject(this.diffResult) : Promise.resolve(this.diffResult);
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

async function render(gateway: FakeGateway) {
  TestBed.configureTestingModule({ providers: [{ provide: DesktopGateway, useValue: gateway }] });
  const fixture = TestBed.createComponent(DiffPanel);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('DiffPanel', () => {
  it('shows an empty state with no edits', async () => {
    const fixture = await render(new FakeGateway());
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.sidebar-empty')?.textContent).toContain('No changes yet');
  });

  it('lists edits grouped by calibration edit', async () => {
    const gateway = new FakeGateway();
    gateway.diffResult = {
      changedBytes: 2,
      edits: [
        { mapId: 0, mapTitle: 'Performance gauge scaling', row: 0, column: 0, index: -1, address: '0x18171c', beforeRaw: 0, afterRaw: 12, beforeValue: 0, afterValue: 1.2 },
        { mapId: 1, mapTitle: 'Boost target X (autogen)', row: -1, column: -1, index: 2, address: '0x104', beforeRaw: 30, afterRaw: 90, beforeValue: 3, afterValue: 9 },
      ],
    } as unknown as types.DiffSummary;
    const fixture = await render(gateway);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.status-pill')?.textContent).toContain('2 bytes changed');
    const rows = Array.from(compiled.querySelectorAll('.diff-table tbody tr'));
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Performance gauge scaling');
    expect(rows[0].textContent).toContain('row 0, col 0');
    expect(rows[0].textContent).toContain('0x18171c');
    expect(rows[1].textContent).toContain('index 2');
  });

  it('shows an error panel when the diff fails to load', async () => {
    const gateway = new FakeGateway();
    gateway.diffResult = new Error('desktop: no workspace is open');
    const fixture = await render(gateway);
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.status-panel--danger')?.textContent).toContain('no workspace is open');
  });

  it('refreshes when editHistory.revision() changes', async () => {
    const gateway = new FakeGateway();
    const fixture = await render(gateway);
    TestBed.inject(EditHistoryStore).noteEdit({ canUndo: true, canRedo: false } as types.EditOutcome);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(gateway.diffCalls).toBeGreaterThan(1);
  });
});
