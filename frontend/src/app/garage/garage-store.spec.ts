import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveGateway } from '../live-data/live-gateway';
import { LiveStore } from '../live-data/live-store';
import { GarageGateway, GarageStore } from './garage-store';

async function setup(configured = true) {
  const garage = {
    restore: vi.fn(async () => ({ url: configured ? 'https://garage.example' : '', configured })),
    configure: vi.fn(async (url: string) => ({ url, configured: true })),
  };
  const live = {
    onStatus: vi.fn(() => () => {}),
    onBatch: vi.fn(() => () => {}),
    status: vi.fn(async () => ({
      generation: 1,
      state: 'connecting',
      retryable: false,
      catchingUp: true,
    })),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: GarageGateway, useValue: garage },
      { provide: LiveGateway, useValue: live },
    ],
  });
  return { store: TestBed.inject(GarageStore), garage, live };
}

afterEach(() => TestBed.resetTestingModule());

describe('GarageStore', () => {
  it('subscribes and restores once at app startup without opening Live Data', async () => {
    const { store, garage, live } = await setup();
    garage.restore.mockImplementation(async () => {
      expect(live.onStatus).toHaveBeenCalledOnce();
      expect(live.onBatch).toHaveBeenCalledOnce();
      return { url: 'https://garage.example', configured: true };
    });
    await store.initialize();
    await store.initialize();
    expect(garage.restore).toHaveBeenCalledOnce();
    expect(store.configured()).toBe(true);
    expect(store.open()).toBe(false);
  });

  it('opens garage setup on first launch and clears old telemetry when changing garage', async () => {
    const { store, garage } = await setup(false);
    await store.initialize();
    expect(store.open()).toBe(true);
    const live = TestBed.inject(LiveStore);
    live.sources.set([{ deviceId: 'old', sessionId: 'old' }]);
    await store.configure(' https://new-garage.example ', 'secret');
    expect(garage.configure).toHaveBeenCalledWith('https://new-garage.example', 'secret');
    expect(live.sources()).toEqual([]);
    expect(store.url()).toBe('https://new-garage.example');
    expect(store.open()).toBe(false);
  });

  it('keeps settings available after restore fails without exposing credentials', async () => {
    const { store, garage } = await setup();
    garage.restore.mockRejectedValue(new Error('private-token'));
    await store.initialize();
    expect(store.open()).toBe(true);
    expect(store.error()).not.toContain('private-token');
    expect(store.busy()).toBe(false);
  });
});
