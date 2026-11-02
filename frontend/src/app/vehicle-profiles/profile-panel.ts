import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { types } from '../../../wailsjs/go/models';
import { WorkspaceStore } from '../workspace/workspace-store';
import { LiveStore } from '../live-data/live-store';
import { sourceKey } from '../live-data/live-gateway';
import { ProfileGateway } from './profile-gateway';
import { OperatingPointStore } from '../operating-point/operating-point-store';

const meanings = ['engine-speed', 'load-measured', 'load-requested', 'pressure-absolute', 'pressure-gauge', 'temperature', 'torque-measured', 'torque-requested', 'vehicle-speed', 'lambda'];

@Component({
  selector: 'app-profile-panel', imports: [FormsModule], templateUrl: './profile-panel.html', styleUrl: './profile-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePanel implements OnDestroy {
  readonly workspace = inject(WorkspaceStore);
  readonly live = inject(LiveStore);
  private readonly gateway = inject(ProfileGateway);
  private readonly operatingPoints = inject(OperatingPointStore);
  readonly context = signal<types.BindingContext | null>(null);
  readonly draft = signal<types.VehicleProfile | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly meanings = meanings;
  axisKey = '';
  channelId = '';
  channelMeaning = '';
  axisMeaning = '';
  readonly channels = computed(() => (this.live.catalog()?.channels ?? []).filter(channel => this.context()?.session.channels.includes(channel.id)));
  // String equality prevents a backend request on every 250ms sample batch.
  private readonly scope = computed(() => {
    const selected = this.live.selected();
    const summary = this.workspace.summary();
    if (!selected || !summary || this.live.status().state !== 'connected' || this.workspace.phase() === 'loading' || this.workspace.phase() === 'error') return '';
    const source = this.live.sources().find(source => sourceKey(source) === sourceKey(selected));
    return JSON.stringify([summary.generation, this.live.scopeGeneration(), sourceKey(selected), source?.bindingRevision, this.live.catalog()]);
  });
  private revision = 0;
  private request: types.BindingRequest | null = null;

  constructor() {
    this.live.initialize();
    effect(() => {
      const scope = this.scope();
      untracked(() => {
        ++this.revision;
        this.context.set(null); this.draft.set(null); this.error.set(''); this.notice.set(''); this.busy.set(false);
        this.axisKey = ''; this.channelId = ''; this.channelMeaning = ''; this.axisMeaning = '';
        this.request = scope ? this.currentRequest() : null;
        if (this.request) void this.refresh();
      });
    });
  }

  private currentRequest(): types.BindingRequest {
    return { workspaceGeneration: this.workspace.summary()!.generation, liveGeneration: this.live.scopeGeneration()!,
      deviceId: this.live.selected()!.deviceId, sessionId: this.live.selected()!.sessionId, sessionFingerprint: '', profile: {} as types.VehicleProfile } as types.BindingRequest;
  }

  async refresh(): Promise<void> {
    if (!this.request) return;
    const revision = this.revision; this.busy.set(true);
    try { const context = await this.gateway.context(this.request); if (revision === this.revision) { this.context.set(context); this.request = {...this.request!, sessionFingerprint: context.sessionFingerprint} as types.BindingRequest; } }
    catch (error) { if (revision === this.revision) this.error.set(String(error)); }
    finally { if (revision === this.revision) this.busy.set(false); }
  }

  newProfile(): void {
    const context = this.context(); if (!context) return;
    this.draft.set(types.VehicleProfile.createFrom({ id: crypto.randomUUID(), label: '', ecuFamily: context.session.ecuFamily, software: context.session.software,
      telemetryEvidence: '', calibrationEvidence: '', workspace: context.workspace,
      catalogs: [{ id: context.session.catalogId, version: context.session.catalogVersion }], bindings: [] }));
    this.notice.set('New profile. Identity fields are operator assertions until independently validated.');
  }

  selectProfile(id: string): void {
    const profile = this.context()?.profiles.find(profile => profile.id === id);
    this.draft.set(profile ? structuredClone(profile) : null);
    this.notice.set('Selecting a saved profile does not associate it automatically.');
  }

  key(axis: types.BindingAxisOption): string { return JSON.stringify([axis.parameterId, axis.axis]); }

  async addBinding(): Promise<void> {
    const axis = this.context()?.axes.find(axis => this.key(axis) === this.axisKey);
    const channel = this.channels().find(channel => channel.id === this.channelId);
    if (!axis || !channel || !this.draft() || !this.request || this.busy()) return;
    if (this.channelMeaning !== this.axisMeaning) { this.error.set('Channel and axis physical meanings differ. Contextual conversions are not supported.'); return; }
    const revision = this.revision; const draftId = this.draft()!.id;
    this.busy.set(true); this.error.set('');
    try {
      const conversion = await this.gateway.conversion(channel.unit, axis.unit, this.channelMeaning);
      if (revision !== this.revision || this.draft()?.id !== draftId) return;
      const binding = { parameterId: axis.parameterId, axis: axis.axis, channelId: channel.id, channelMeaning: this.channelMeaning,
        axisMeaning: this.axisMeaning, sourceUnit: channel.unit, targetUnit: axis.unit, scale: conversion.scale, offset: conversion.offset };
      this.draft.update(profile => profile ? { ...profile, bindings: [...profile.bindings.filter(b => b.parameterId !== axis.parameterId || b.axis !== axis.axis), binding] } as types.VehicleProfile : null);
    } catch { if (revision === this.revision) this.error.set('Unsupported unit conversion or physical meaning. Check the channel and axis selections.'); }
    finally { if (revision === this.revision) this.busy.set(false); }
  }

  remove(index: number): void { this.draft.update(profile => profile ? { ...profile, bindings: profile.bindings.filter((_, i) => i !== index) } as types.VehicleProfile : null); }

  async save(): Promise<void> { await this.mutate('save'); }
  async associate(): Promise<void> { await this.mutate('associate'); }
  private async mutate(action: 'save' | 'associate'): Promise<void> {
    if (!this.request || !this.draft() || this.busy()) return;
    const revision = this.revision;
    this.busy.set(true); this.error.set(''); this.notice.set('');
    try {
      const context = await this.gateway[action]({ ...this.request, profile: this.draft()! } as types.BindingRequest);
      if (revision !== this.revision) return;
      this.context.set(context);
      void this.operatingPoints.refresh();
      if (action === 'save') this.notice.set('Profile saved locally. Associate it explicitly to use it with this source.');
    } catch (error) { if (revision === this.revision) this.error.set(String(error)); }
    finally { if (revision === this.revision) this.busy.set(false); }
  }

  async clear(): Promise<void> {
    if (this.busy()) return;
    const revision = this.revision; this.busy.set(true); this.error.set('');
    try { await this.gateway.clear(); void this.operatingPoints.refresh(); if (revision === this.revision) await this.refresh(); }
    catch (error) { if (revision === this.revision) this.error.set(String(error)); }
    finally { if (revision === this.revision) this.busy.set(false); }
  }


  updateField(field: 'label' | 'ecuFamily' | 'software' | 'telemetryEvidence' | 'calibrationEvidence', value: string): void {
    this.draft.update(profile => profile ? {...profile, [field]: value} as types.VehicleProfile : null);
  }

  ngOnDestroy(): void { ++this.revision; }

  readonly savedDraft = computed(() => {
    const draft = this.draft();
    return !!draft && JSON.stringify(draft) === JSON.stringify(this.context()?.profiles.find(profile => profile.id === draft.id));
  });
}
