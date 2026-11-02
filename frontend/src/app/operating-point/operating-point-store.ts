import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { types } from '../../../wailsjs/go/models';
import { LiveStore } from '../live-data/live-store';
import { sourceKey } from '../live-data/live-gateway';
import { ProfileGateway } from '../vehicle-profiles/profile-gateway';
import { WorkspaceStore } from '../workspace/workspace-store';
import { OverlayBinding } from './operating-point';

/**
 * Tracks the backend's active profile association for operating-point
 * overlays. It refetches the binding context whenever the workspace, live
 * scope, selected source or its session metadata changes (the backend clears
 * a stale association on that fetch), and the profile panel calls refresh()
 * after associating or clearing.
 */
@Injectable({ providedIn: 'root' })
export class OperatingPointStore {
  private readonly workspace = inject(WorkspaceStore);
  private readonly live = inject(LiveStore);
  private readonly gateway = inject(ProfileGateway);
  readonly context = signal<types.BindingContext | null>(null);
  private revision = 0;

  // String equality prevents a backend request on every sample batch.
  private readonly scope = computed(() => {
    const selected = this.live.selected();
    const summary = this.workspace.summary();
    if (!selected || !summary || this.live.status().state !== 'connected' || this.workspace.phase() === 'loading' || this.workspace.phase() === 'error') return '';
    const source = this.live.sources().find((item) => sourceKey(item) === sourceKey(selected));
    return JSON.stringify([summary.generation, this.live.scopeGeneration(), sourceKey(selected), source?.bindingRevision]);
  });

  /** The associated profile, only while the fetched context still matches the
   * current workspace, live scope and selected session. */
  readonly association = computed(() => {
    const context = this.context();
    const selected = this.live.selected();
    if (!context || !selected || !this.scope()) return null;
    if (context.workspaceGeneration !== this.workspace.summary()?.generation || context.liveGeneration !== this.live.scopeGeneration()) return null;
    if (context.session.deviceId !== selected.deviceId || context.session.sessionId !== selected.sessionId) return null;
    const state = context.compatibility.state;
    const profile = context.profiles.find((item) => item.id === context.activeProfileId);
    if (!profile || (state !== 'manual' && state !== 'validated')) return null;
    return { profile, verified: context.compatibility.verified, source: { deviceId: selected.deviceId, sessionId: selected.sessionId } };
  });

  constructor() {
    effect(() => {
      this.scope();
      untracked(() => void this.refresh());
    });
  }

  bindingsFor(parameterId: string | undefined): OverlayBinding[] {
    const association = this.association();
    if (!association || !parameterId) return [];
    return association.profile.bindings
      .filter((binding) => binding.parameterId === parameterId && (binding.axis === 'x' || binding.axis === 'y'))
      .map((binding) => ({ axis: binding.axis as 'x' | 'y', channelId: binding.channelId, scale: binding.scale, offset: binding.offset }));
  }

  async refresh(): Promise<void> {
    const revision = ++this.revision;
    this.context.set(null);
    const selected = this.live.selected();
    const summary = this.workspace.summary();
    const liveGeneration = this.live.scopeGeneration();
    if (!this.scope() || !selected || !summary || liveGeneration === null) return;
    try {
      const context = await this.gateway.context({
        workspaceGeneration: summary.generation, liveGeneration, deviceId: selected.deviceId,
        sessionId: selected.sessionId, sessionFingerprint: '', profile: {} as types.VehicleProfile,
      } as types.BindingRequest);
      if (revision === this.revision) this.context.set(context);
    } catch {
      // No overlay without a current, backend-confirmed association.
    }
  }
}
