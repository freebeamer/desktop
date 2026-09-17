import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { types } from '../../../wailsjs/go/models';
import { DesktopGateway } from '../core/desktop-gateway';
import { LiveGateway } from '../live-data/live-gateway';
import { LiveStore } from '../live-data/live-store';
import { WorkspaceStore } from '../workspace/workspace-store';
import { ProfileGateway } from './profile-gateway';
import { ProfilePanel } from './profile-panel';

function workspaceSummary(): types.WorkspaceSummary {
  return {
    generation: 1,
    xdfPath: '/tmp/def.xdf',
    binPath: '/tmp/image.bin',
    rom: { sizeBytes: 4194304, sha256: 'a'.repeat(64) },
    ecu: { manufacturer: 'BMW', vendor: 'Bosch', family: 'MEVD17.2.6', engine: 'BMW N55', confidence: 'high' },
    xdf: { version: '1.70', categories: 1, tables: 1, flags: 1 },
    compatibility: { regionFitsRom: true, addressedMaps: 1, totalMaps: 1, mapValidationErrors: 0 },
    checksum: { provider: '', status: 'unsupported', regions: 0 },
    editingAllowed: true,
  } as types.WorkspaceSummary;
}

// A minimal DesktopGateway fake: only openWorkspace is exercised by these
// tests (WorkspaceStore.open), everything else in the abstract shape is
// unused here.
class FakeDesktopGateway implements DesktopGateway {
  health(): Promise<types.HealthStatus> {
    return Promise.reject(new Error('not used in this test'));
  }
  chooseAndOpenWorkspace(): Promise<types.WorkspaceSummary> {
    return Promise.resolve(workspaceSummary());
  }
  openWorkspace(): Promise<types.WorkspaceSummary> {
    return Promise.resolve(workspaceSummary());
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
    return Promise.reject(new Error('not used in this test'));
  }
  getMap(): Promise<types.MapDetail> {
    return Promise.reject(new Error('not used in this test'));
  }
  applyCellOperation(): Promise<types.BatchEditOutcome> {
    return Promise.reject(new Error('not used in this test'));
  }
  setCell(): Promise<types.EditOutcome> {
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

// Mirrors live-store.spec.ts's fake: enough of LiveGateway's shape to drive
// LiveStore through connect()/select() without a real Wails runtime.
class FakeLiveGateway {
  generation = 0;
  statusHandler!: (value: types.LiveConnectionStatus) => void;
  onStatus(handler: typeof this.statusHandler) {
    this.statusHandler = handler;
    return () => {};
  }
  onBatch() {
    return () => {};
  }
  async status(): Promise<types.LiveConnectionStatus> {
    return { generation: this.generation, state: 'disconnected', retryable: false, catchingUp: false } as types.LiveConnectionStatus;
  }
  async connect(): Promise<number> {
    this.statusHandler({ generation: ++this.generation, state: 'connected', retryable: false, catchingUp: false } as types.LiveConnectionStatus);
    return this.generation;
  }
  async disconnect(): Promise<void> {
    this.statusHandler({ generation: ++this.generation, state: 'disconnected', retryable: false, catchingUp: false } as types.LiveConnectionStatus);
  }
  async select(): Promise<number> {
    return ++this.generation;
  }
  async clients(): Promise<types.LiveClientSummary[]> {
    return [];
  }
  async catalog(): Promise<types.LiveCatalog> {
    return {
      id: 'mhd.mg1.monitor',
      version: 1,
      provenance: '',
      channels: [{ id: 'RPM', label: 'RPM', unit: 'rpm', sourceUnit: 'rpm', validation: 'definition-derived' }],
    } as types.LiveCatalog;
  }
}

function bindingContext(overrides: Partial<types.BindingContext> = {}): types.BindingContext {
  return {
    sessionFingerprint: 'fingerprint-1',
    workspaceGeneration: 1,
    liveGeneration: 1,
    workspace: { definitionId: 'def-1', definitionSha256: 'c'.repeat(64), originalSha256: 'd'.repeat(64), originalSize: 4194304 },
    session: {
      scopeSha256: 'scope-1', deviceId: 'phone', sessionId: 'session-1',
      catalogId: 'mhd.mg1.monitor', catalogVersion: 1, vehicleLabel: '',
      ecuFamily: 'N55', software: 'MEVD17.2.6', channels: ['RPM'],
    },
    axes: [{ parameterId: 'boost-target', title: 'Boost target', axis: 'x', unit: 'rpm', count: 2 }],
    profiles: [],
    activeProfileId: '',
    compatibility: { state: 'unknown', reasons: ['no profile is associated with this workspace and live source'], verified: false },
    ...overrides,
  } as types.BindingContext;
}

class FakeProfileGateway {
  contextResult = bindingContext();
  conversionResult: types.BindingConversion = { scale: 1, offset: 0 } as types.BindingConversion;
  context = vi.fn(async (_request: types.BindingRequest) => this.contextResult);
  save = vi.fn(async (request: types.BindingRequest) => ({ ...this.contextResult, profiles: [request.profile] }) as types.BindingContext);
  associate = vi.fn(async (request: types.BindingRequest) =>
    types.BindingContext.createFrom({ ...this.contextResult, activeProfileId: request.profile.id, compatibility: { state: 'manual', reasons: [], verified: false } }),
  );
  clear = vi.fn(async () => {});
  conversion = vi.fn(async (_source: string, _target: string, _meaning: string) => this.conversionResult);
}

describe('ProfilePanel', () => {
  let fixture: ComponentFixture<ProfilePanel>;
  let panel: ProfilePanel;
  let live: LiveStore;
  let profileGateway: FakeProfileGateway;

  beforeEach(async () => {
    profileGateway = new FakeProfileGateway();
    TestBed.configureTestingModule({
      providers: [
        { provide: DesktopGateway, useValue: new FakeDesktopGateway() },
        { provide: LiveGateway, useValue: new FakeLiveGateway() },
        { provide: ProfileGateway, useValue: profileGateway },
      ],
    });
    fixture = TestBed.createComponent(ProfilePanel);
    panel = fixture.componentInstance;
    live = TestBed.inject(LiveStore);
    fixture.detectChanges();

    await TestBed.inject(WorkspaceStore).open('/tmp/def.xdf', '/tmp/image.bin');
    await live.connect('https://relay.example', 'token', 'client-1');
    await live.select({ deviceId: 'phone', sessionId: 'session-1' });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('loads the binding context for the connected workspace/source scope', () => {
    expect(panel.context()).toEqual(bindingContext());
    const request = profileGateway.context.mock.calls.at(-1)?.[0] as types.BindingRequest;
    expect(request.workspaceGeneration).toBe(1);
    expect(request.deviceId).toBe('phone');
    expect(request.sessionId).toBe('session-1');
  });

  it('newProfile seeds the draft from the current context, with no bindings', () => {
    panel.newProfile();
    const draft = panel.draft();
    expect(draft).toBeTruthy();
    expect(draft!.ecuFamily).toBe('N55');
    expect(draft!.software).toBe('MEVD17.2.6');
    expect(draft!.catalogs).toEqual([{ id: 'mhd.mg1.monitor', version: 1 }]);
    expect(draft!.bindings).toEqual([]);
  });

  it('selectProfile clones a stored profile instead of aliasing it', () => {
    const stored = types.VehicleProfile.createFrom({
      id: 'profile-1', label: 'Stored profile', ecuFamily: 'N55', software: 'MEVD17.2.6',
      telemetryEvidence: '', calibrationEvidence: '',
      workspace: bindingContext().workspace,
      catalogs: [{ id: 'mhd.mg1.monitor', version: 1 }],
      bindings: [],
    });
    panel.context.set(bindingContext({ profiles: [stored] }));

    panel.selectProfile('profile-1');
    panel.updateField('label', 'Edited locally');

    expect(panel.draft()!.label).toBe('Edited locally');
    expect(panel.context()!.profiles[0].label).toBe('Stored profile');
  });

  it('addBinding refuses when channel and axis physical meanings differ', async () => {
    panel.newProfile();
    panel.axisKey = panel.key(bindingContext().axes[0]);
    panel.channelId = 'RPM';
    panel.channelMeaning = 'load-measured';
    panel.axisMeaning = 'engine-speed';

    await panel.addBinding();

    expect(panel.error()).toContain('physical meanings differ');
    expect(panel.draft()!.bindings).toEqual([]);
    expect(profileGateway.conversion).not.toHaveBeenCalled();
  });

  it('addBinding stores a binding using the gateway-reported conversion', async () => {
    panel.newProfile();
    panel.axisKey = panel.key(bindingContext().axes[0]);
    panel.channelId = 'RPM';
    panel.channelMeaning = 'engine-speed';
    panel.axisMeaning = 'engine-speed';
    profileGateway.conversionResult = { scale: 2, offset: 1 } as types.BindingConversion;

    await panel.addBinding();

    expect(profileGateway.conversion).toHaveBeenCalledWith('rpm', 'rpm', 'engine-speed');
    expect(panel.draft()!.bindings).toEqual([
      { parameterId: 'boost-target', axis: 'x', channelId: 'RPM', channelMeaning: 'engine-speed', axisMeaning: 'engine-speed', sourceUnit: 'rpm', targetUnit: 'rpm', scale: 2, offset: 1 },
    ]);
  });

  it('save persists the draft through the gateway and updates context', async () => {
    panel.newProfile();
    panel.updateField('label', 'New profile');

    await panel.save();

    expect(profileGateway.save).toHaveBeenCalled();
    const request = profileGateway.save.mock.calls.at(-1)?.[0] as types.BindingRequest;
    expect(request.profile.label).toBe('New profile');
    expect(panel.context()!.profiles).toEqual([request.profile]);
  });

  it('associate activates a saved profile through the gateway', async () => {
    panel.newProfile();
    panel.updateField('label', 'New profile');
    await panel.save();

    await panel.associate();

    expect(profileGateway.associate).toHaveBeenCalled();
    expect(panel.context()!.activeProfileId).toBe(panel.draft()!.id);
    expect(panel.context()!.compatibility.state).toBe('manual');
  });

  it('a scope change resets the draft and refetches context for the new source', async () => {
    panel.newProfile();
    expect(panel.draft()).toBeTruthy();

    profileGateway.contextResult = bindingContext({
      session: { ...bindingContext().session, sessionId: 'other-session' },
    });
    await live.select({ deviceId: 'phone', sessionId: 'other-session' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(panel.draft()).toBeNull();
    expect(panel.error()).toBe('');
    expect(panel.notice()).toBe('');
    expect(panel.context()?.session.sessionId).toBe('other-session');
  });
});
