import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import type { types } from '../../../wailsjs/go/models';
import { LiveBatch, LiveGateway, LiveSample, LiveSource, sourceKey } from './live-gateway';

export const HISTORY_LIMIT = 2000;
export const STALE_MS = 5000;

@Injectable({ providedIn: 'root' })
export class LiveStore implements OnDestroy {
  private readonly gateway = inject(LiveGateway);
  readonly status = signal<types.LiveConnectionStatus>({
    generation: 0,
    state: 'disconnected',
    retryable: false,
    catchingUp: false,
  } as types.LiveConnectionStatus);
  readonly clients = signal<types.LiveClientSummary[]>([]);
  readonly catalog = signal<types.LiveCatalog | null>(null);
  readonly sources = signal<LiveSource[]>([]);
  readonly selected = signal<LiveSource | null>(null);
  readonly history = signal<LiveSample[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly activeClient = signal('');
  readonly now = signal(Date.now());
  readonly gaps = signal(0);
  readonly latest = computed(() => this.history().at(-1) ?? null);
  readonly age = computed(() =>
    this.latest() ? this.now() - Date.parse(this.latest()!.timestamp) : null,
  );
  readonly freshness = computed(() => {
    const age = this.age();
    if (age === null) return 'Waiting for samples';
    if (age < -1000) return 'Device clock ahead';
    if (this.status().state !== 'connected') return 'Offline · last reading';
    return age > STALE_MS ? 'Stale' : 'Fresh';
  });
  readonly scopeGeneration = signal<number | null>(null);
  private generation: number | null = null;
  private changingScope = false;
  private initialized = false;
  private destroyed = false;
  private cleanups: (() => void)[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private pending: LiveBatch[] = [];
  private pendingStatus: types.LiveConnectionStatus | null = null;
  private catalogRequest = 0;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    let receivedStatus = false;
    try {
      this.cleanups.push(
        this.gateway.onStatus((status) => {
          receivedStatus = true;
          if (this.changingScope) {
            this.pendingStatus = status;
            return;
          }
          this.acceptStatus(status);
        }),
      );
      this.cleanups.push(
        this.gateway.onBatch((batch) => {
          if (this.changingScope) {
            // Bound both batch count and batch size while an IPC call is pending.
            this.pending = [
              ...this.pending,
              { ...batch, samples: (batch.samples ?? []).slice(-HISTORY_LIMIT) },
            ].slice(-8);
            return;
          }
          this.acceptBatch(batch);
        }),
      );
      void this.gateway
        .status()
        .then((status) => {
          if (!receivedStatus && !this.busy() && !this.destroyed) this.acceptStatus(status);
        })
        .catch(() => this.error.set('Desktop live-data service unavailable.'));
    } catch {
      this.error.set('Live data requires the desktop app.');
    }
    this.timer = setInterval(() => this.now.set(Date.now()), 1000);
  }

  async loadClients(url: string, token: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.clients.set([]);
    try {
      this.clients.set((await this.gateway.clients(url, token)) ?? []);
    } catch {
      this.error.set('Could not list clients. Check the relay URL and admin token.');
    } finally {
      this.finish();
    }
  }

  async connect(url: string, token: string, client: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.changingScope = true;
    this.reset(true);
    this.catalog.set(null);
    ++this.catalogRequest;
    try {
      this.generation = await this.gateway.connect(url, token, client);
      this.activeClient.set(
        this.clients().find((item) => item.id === client)?.displayName || client,
      );
    } catch {
      this.error.set('Could not connect. Check the relay URL, admin token and client.');
    } finally {
      this.finish();
    }
  }

  async disconnect(): Promise<void> {
    if (this.busy()) return;
    this.changingScope = true;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.gateway.disconnect();
      this.activeClient.set('');
      this.generation = null;
      this.reset(true);
      this.catalog.set(null);
      ++this.catalogRequest;
    } catch {
      this.error.set('Could not disconnect from the relay.');
    } finally {
      this.finish();
    }
  }

  async select(source: LiveSource): Promise<void> {
    if (this.busy()) return;
    this.changingScope = true;
    this.busy.set(true);
    this.error.set('');
    this.reset(false);
    this.selected.set(source);
    try {
      this.generation = await this.gateway.select(source);
    } catch {
      this.error.set('Could not change the selected source.');
      this.generation = null;
    } finally {
      this.finish();
    }
  }

  private finish(): void {
    this.scopeGeneration.set(this.generation);
    this.changingScope = false;
    this.busy.set(false);
    if (this.pendingStatus) this.acceptStatus(this.pendingStatus);
    this.pendingStatus = null;
    const batches = this.pending;
    this.pending = [];
    for (const batch of batches) this.acceptBatch(batch);
  }

  private acceptStatus(status: types.LiveConnectionStatus): void {
    if (this.destroyed || (this.generation !== null && status.generation < this.generation)) return;
    this.status.set(status);
    this.generation = status.generation;
    this.scopeGeneration.set(this.generation);
    if (status.state === 'connected' && !this.catalog()) void this.loadCatalog();
  }

  private async loadCatalog(): Promise<void> {
    const request = ++this.catalogRequest;
    try {
      const catalog = await this.gateway.catalog();
      if (!this.destroyed && request === this.catalogRequest) this.catalog.set(catalog);
    } catch {
      if (request === this.catalogRequest)
        this.error.set(
          'Channel catalog unavailable. Values are shown with channel IDs and unknown units.',
        );
    }
  }

  private acceptBatch(batch: LiveBatch): void {
    if (
      this.destroyed ||
      batch.generation !== this.generation ||
      this.status().state === 'disconnected'
    )
      return;
    this.sources.set(batch.sources ?? []);
    if (!this.selected() && batch.samples?.length)
      this.selected.set(batch.samples[batch.samples.length - 1]);
    const selected = this.selected();
    if (!selected) return;
    const history = [...this.history()];
    for (const sample of batch.samples ?? []) {
      if (
        sourceKey(sample) !== sourceKey(selected) ||
        !Number.isFinite(Date.parse(sample.timestamp))
      )
        continue;
      const last = history.at(-1);
      // Session sequence is authoritative even if the device clock moves backward.
      // Only legacy samples need acquisition time as an ordering fallback.
      if (
        last &&
        (sample.sessionId
          ? sample.sequence <= last.sequence
          : Date.parse(sample.timestamp) <= Date.parse(last.timestamp))
      )
        continue;
      const gapBefore = Math.max(
        sample.gapBefore,
        last && sample.sessionId ? sample.sequence - last.sequence - 1 : 0,
      );
      history.push({ ...sample, gapBefore });
      this.gaps.update((count) => count + gapBefore);
    }
    this.history.set(history.slice(-HISTORY_LIMIT));
    this.now.set(Date.now());
  }

  private reset(sources: boolean): void {
    this.history.set([]);
    this.gaps.set(0);
    this.pending = [];
    if (sources) {
      this.sources.set([]);
      this.selected.set(null);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    for (const cleanup of this.cleanups) cleanup();
    clearInterval(this.timer);
  }
}
