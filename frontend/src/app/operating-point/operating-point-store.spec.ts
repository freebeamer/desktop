import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { types } from '../../../wailsjs/go/models';
import { LiveStore } from '../live-data/live-store';
import { ProfileGateway } from '../vehicle-profiles/profile-gateway';
import { WorkspaceStore } from '../workspace/workspace-store';
import { OperatingPointStore } from './operating-point-store';

const binding = { parameterId: 'boost-target', axis: 'x', channelId: 'RPM', scale: 1, offset: 0 };
const profile = { id: 'profile-1', bindings: [binding, { ...binding, parameterId: 'other' }] };

function context(overrides: Partial<types.BindingContext> = {}): types.BindingContext {
  return {
    workspaceGeneration: 1, liveGeneration: 7, sessionFingerprint: 'f',
    session: { deviceId: 'phone', sessionId: 'session-1' },
    profiles: [profile], activeProfileId: 'profile-1',
    compatibility: { state: 'manual', reasons: [], verified: false },
    ...overrides,
  } as unknown as types.BindingContext;
}

describe('OperatingPointStore', () => {
  let gateway: { context: ReturnType<typeof vi.fn> };
  let summary: ReturnType<typeof signal<{ generation: number } | null>>;
  let selected: ReturnType<typeof signal<{ deviceId: string; sessionId: string } | null>>;
  let store: OperatingPointStore;

  beforeEach(async () => {
    gateway = { context: vi.fn(async () => context()) };
    summary = signal<{ generation: number } | null>({ generation: 1 });
    selected = signal<{ deviceId: string; sessionId: string } | null>({ deviceId: 'phone', sessionId: 'session-1' });
    TestBed.configureTestingModule({
      providers: [
        { provide: ProfileGateway, useValue: gateway },
        { provide: WorkspaceStore, useValue: { summary, phase: signal('ready') } },
        { provide: LiveStore, useValue: {
          selected, sources: signal([{ deviceId: 'phone', sessionId: 'session-1', bindingRevision: 'r1' }]),
          status: signal({ state: 'connected' }), scopeGeneration: signal(7),
        } },
      ],
    });
    store = TestBed.inject(OperatingPointStore);
    TestBed.tick();
    await vi.waitFor(() => expect(store.context()).not.toBeNull());
  });

  it('exposes only the associated profile bindings for one parameter', () => {
    expect(store.bindingsFor('boost-target')).toEqual([{ axis: 'x', channelId: 'RPM', scale: 1, offset: 0 }]);
    expect(store.bindingsFor(undefined)).toEqual([]);
    expect(store.association()?.verified).toBe(false);
  });

  it('offers no overlay without a manual or validated association', async () => {
    gateway.context.mockResolvedValue(context({ compatibility: { state: 'unknown', reasons: [], verified: false } } as Partial<types.BindingContext>));
    await store.refresh();
    expect(store.association()).toBeNull();
    expect(store.bindingsFor('boost-target')).toEqual([]);
  });

  it('drops the association as soon as the workspace or session changes', async () => {
    summary.set({ generation: 2 });
    expect(store.association()).toBeNull();
    summary.set({ generation: 1 });
    await store.refresh();
    selected.set({ deviceId: 'phone', sessionId: 'session-2' });
    expect(store.association()).toBeNull();
  });
});
