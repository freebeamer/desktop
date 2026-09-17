import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { types } from '../../../wailsjs/go/models';
import { LiveBatch, LiveGateway, LiveSample } from './live-gateway';
import { HISTORY_LIMIT, LiveStore } from './live-store';
import { liveTrace } from './live-traces';

const status = (generation = 1, state = 'connected') =>
  ({ generation, state, retryable: false, catchingUp: false }) as types.LiveConnectionStatus;
const sample = (sequence: number, overrides: Partial<LiveSample> = {}): LiveSample => ({
  deviceId: 'phone',
  sessionId: 'session',
  sequence,
  timestamp: new Date(100000 + sequence * 50).toISOString(),
  values: { RPM: sequence },
  backfill: false,
  gapBefore: 0,
  ...overrides,
});

class FakeGateway {
  statusHandler!: (value: types.LiveConnectionStatus) => void;
  batchHandler!: (value: LiveBatch) => void;
  cleanupStatus = vi.fn();
  cleanupBatch = vi.fn();
  generation = 1;
  onStatus(handler: typeof this.statusHandler) {
    this.statusHandler = handler;
    return this.cleanupStatus;
  }
  onBatch(handler: typeof this.batchHandler) {
    this.batchHandler = handler;
    return this.cleanupBatch;
  }
  async status() {
    return status();
  }
  async connect() {
    this.statusHandler(status(++this.generation));
    return this.generation;
  }
  async select() {
    return ++this.generation;
  }
  async disconnect() {
    this.statusHandler(status(++this.generation, 'disconnected'));
  }
  async clients() {
    return [];
  }
  async catalog() {
    return { id: 'test', channels: [] } as unknown as types.LiveCatalog;
  }
  batch(samples: LiveSample[], generation = this.generation) {
    this.batchHandler({
      generation,
      samples,
      sources: samples.map(({ deviceId, sessionId }) => ({ deviceId, sessionId })),
    });
  }
}

describe('LiveStore', () => {
  let gateway: FakeGateway;
  let store: LiveStore;
  beforeEach(async () => {
    gateway = new FakeGateway();
    TestBed.configureTestingModule({ providers: [{ provide: LiveGateway, useValue: gateway }] });
    store = TestBed.inject(LiveStore);
    store.initialize();
    await Promise.resolve();
  });
  afterEach(() => TestBed.resetTestingModule());

  it('keeps current values when overlap, duplicate or older replay arrives', () => {
    gateway.batch([sample(2), sample(3)]);
    gateway.batch([
      sample(2, { backfill: true }),
      sample(3),
      sample(1, { timestamp: new Date(1).toISOString() }),
    ]);
    expect(store.history().map((s) => s.sequence)).toEqual([2, 3]);
    expect(store.latest()?.values['RPM']).toBe(3);
  });

  it('uses sequence order when the device clock is corrected backward', () => {
    gateway.batch([sample(1, { timestamp: new Date(Date.now() + 30000).toISOString() })]);
    gateway.batch([sample(2, { timestamp: new Date().toISOString() })]);
    expect(store.latest()?.sequence).toBe(2);
    expect(store.freshness()).toBe('Fresh');
    const trace = liveTrace(store.history(), 'RPM')[0] as { y: (number | null)[] };
    expect(trace.y).toEqual([1, null, 2]);
  });

  it('bounds history during sustained streaming and counts gaps', () => {
    gateway.batch(
      Array.from({ length: HISTORY_LIMIT + 800 }, (_, index) =>
        sample(index, { gapBefore: index === 20 ? 2 : 0 }),
      ),
    );
    expect(store.history()).toHaveLength(HISTORY_LIMIT);
    expect(store.history()[0].sequence).toBe(800);
    expect(store.gaps()).toBe(2);
  });

  it('rejects old batches after selection and accepts new source samples', async () => {
    gateway.batch([sample(1)]);
    await store.select({ deviceId: 'other', sessionId: 'other-session' });
    gateway.batch([sample(2)], 1);
    gateway.batch([sample(3)], 2);
    expect(store.history()).toEqual([]);
    gateway.batch([sample(4, { deviceId: 'other', sessionId: 'other-session' })]);
    expect(store.latest()?.sequence).toBe(4);
  });

  it('retains a new-generation batch that races the selection response', async () => {
    gateway.select = async () => {
      ++gateway.generation;
      gateway.batch([sample(9)]);
      return gateway.generation;
    };
    await store.select({ deviceId: 'phone', sessionId: 'session' });
    expect(store.latest()?.sequence).toBe(9);
  });

  it('uses acquisition age for replay freshness and flags future device clocks', () => {
    gateway.batch([
      sample(1, { timestamp: new Date(Date.now() - 10000).toISOString(), backfill: true }),
    ]);
    expect(store.freshness()).toBe('Stale');
    gateway.batch([sample(2, { timestamp: new Date(Date.now() + 30000).toISOString() })]);
    expect(store.freshness()).toBe('Device clock ahead');
  });

  it('shows terminal authentication and retry states without swallowing them', () => {
    gateway.statusHandler({
      ...status(),
      state: 'error',
      message: 'invalid admin token',
      retryable: false,
    } as types.LiveConnectionStatus);
    expect(store.status().message).toBe('invalid admin token');
    gateway.statusHandler({
      ...status(),
      state: 'backingOff',
      retryable: true,
      backoffUntil: '2026-09-16T12:00:00Z',
    } as types.LiveConnectionStatus);
    expect(store.status().retryable).toBe(true);
  });

  it('clears data on disconnect and rejects queued batches from the connection', async () => {
    gateway.batch([sample(1)]);
    await store.disconnect();
    gateway.batch([sample(2)], 1);
    expect(store.history()).toEqual([]);
    expect(store.status().state).toBe('disconnected');
  });

  it('does not expose raw errors which may contain credentials', async () => {
    gateway.clients = async () => {
      throw new Error('SECRET');
    };
    await store.loadClients('https://relay', 'SECRET');
    expect(store.error()).not.toContain('SECRET');
    expect(store.busy()).toBe(false);
  });

  it('continues rendering while a client-list request is pending', async () => {
    let resolve!: (clients: never[]) => void;
    gateway.clients = () =>
      new Promise<never[]>((done) => {
        resolve = done;
      });
    const request = store.loadClients('https://relay', 'token');
    gateway.batch([sample(1)]);
    expect(store.latest()?.sequence).toBe(1);
    resolve([]);
    await request;
  });

  it('marks a discontinuity introduced by discarded or delayed samples', () => {
    gateway.batch([sample(1), sample(5)]);
    expect(store.latest()?.gapBefore).toBe(3);
    expect(store.gaps()).toBe(3);
  });

  it('unsubscribes both Wails listeners on destruction', () => {
    store.ngOnDestroy();
    expect(gateway.cleanupStatus).toHaveBeenCalledOnce();
    expect(gateway.cleanupBatch).toHaveBeenCalledOnce();
  });
});

it('breaks chart traces across sequence gaps, missing values and time gaps', () => {
  const trace = liveTrace(
    [
      sample(0),
      sample(2, { gapBefore: 1 }),
      sample(3, { values: {} }),
      sample(4, { timestamp: new Date(200000).toISOString() }),
    ],
    'RPM',
  )[0] as { y: (number | null)[]; connectgaps: boolean };
  expect(trace.y).toEqual([0, null, 2, null, null, 4]);
  expect(trace.connectgaps).toBe(false);
});
