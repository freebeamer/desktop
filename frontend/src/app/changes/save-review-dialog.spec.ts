import { TestBed } from '@angular/core/testing';
import { DesktopGateway } from '../core/desktop-gateway';
import { WorkspaceStore } from '../workspace/workspace-store';
import { SaveReviewDialog } from './save-review-dialog';
import { SaveReviewStore } from './save-review-store';
import type { types } from '../../../wailsjs/go/models';

function workspaceSummary(overrides: Partial<types.WorkspaceSummary> = {}): types.WorkspaceSummary {
  return {
    generation: 1,
    xdfPath: '/tmp/def.xdf',
    binPath: '/tmp/image.bin',
    rom: { sizeBytes: 4194304, sha256: 'a'.repeat(64) },
    ecu: { manufacturer: '', vendor: '', family: '', engine: '', confidence: 'none' },
    xdf: { version: '1.70', categories: 1, tables: 1, flags: 0 },
    compatibility: { regionFitsRom: true, addressedMaps: 1, totalMaps: 1, mapValidationErrors: 0 },
    checksum: { provider: '', status: 'invalid', regions: 11 },
    editingAllowed: true,
    changedBytes: 1,
    editCount: 1,
    canUndo: true,
    canRedo: false,
    ...overrides,
  } as types.WorkspaceSummary;
}

class FakeGateway implements DesktopGateway {
  openResult: types.WorkspaceSummary = workspaceSummary();
  checksumResult: types.ChecksumSummary | Error = { provider: 'bosch.mevd17.2.6.75P9EJ0B', status: 'invalid', regions: 11 } as types.ChecksumSummary;
  diffResult: types.DiffSummary = { changedBytes: 2, edits: [{}, {}] } as unknown as types.DiffSummary;
  saveResult: types.SaveOutcome | Error = {
    path: '/tmp/corrected.bin',
    sha256: 'deadbeef'.repeat(8),
    provider: 'bosch.mevd17.2.6.75P9EJ0B',
    regionsVerified: 11,
    wasAlreadyValid: false,
  } as types.SaveOutcome;

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
  undo = (): Promise<types.EditOutcome> => Promise.reject(new Error('unused'));
  redo = (): Promise<types.EditOutcome> => Promise.reject(new Error('unused'));

  getDiff(): Promise<types.DiffSummary> {
    return Promise.resolve(this.diffResult);
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

async function render(gateway: FakeGateway) {
  TestBed.configureTestingModule({ providers: [{ provide: DesktopGateway, useValue: gateway }] });
  await TestBed.inject(WorkspaceStore).chooseAndOpen();
  const fixture = TestBed.createComponent(SaveReviewDialog);
  fixture.detectChanges();
  return fixture;
}

describe('SaveReviewDialog', () => {
  it('renders nothing while closed', async () => {
    const fixture = await render(new FakeGateway());
    expect((fixture.nativeElement as HTMLElement).querySelector('.save-review')).toBeFalsy();
  });

  it('shows the review summary once opened', async () => {
    const fixture = await render(new FakeGateway());
    await TestBed.inject(SaveReviewStore).open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.save-review')).toBeTruthy();
    expect(compiled.querySelector('.save-review__summary')?.textContent).toContain('bosch.mevd17.2.6.75P9EJ0B');
    expect(compiled.querySelector('.save-review__summary')?.textContent).toContain('2 cells');
  });

  it('blocks saving and disables the button for unsupported firmware', async () => {
    const gateway = new FakeGateway();
    gateway.checksumResult = { provider: '', status: 'unsupported', regions: 0 } as types.ChecksumSummary;
    const fixture = await render(gateway);
    await TestBed.inject(SaveReviewStore).open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.save-review__warning')).toBeTruthy();
    expect((compiled.querySelector('.save-review__actions .button--primary') as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves and shows the outcome, with an option to open the saved copy', async () => {
    const gateway = new FakeGateway();
    const fixture = await render(gateway);
    const store = TestBed.inject(SaveReviewStore);
    await store.open();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.save-review__actions .button--primary') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.save-review__success')?.textContent).toContain('11');
    expect(compiled.querySelector('.save-review__summary')?.textContent).toContain('/tmp/corrected.bin');

    const openCopy = compiled.querySelector('.save-review__actions .button--primary') as HTMLButtonElement;
    expect(openCopy.textContent).toContain('Open saved copy');
    openCopy.click();
    expect(store.phase()).toBe('closed');
  });
});
