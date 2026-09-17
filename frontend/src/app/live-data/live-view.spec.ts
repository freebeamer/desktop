import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { types } from '../../../wailsjs/go/models';
import { PlotlyRuntime } from '../visualization/plotly-runtime';
import { LiveGateway } from './live-gateway';
import { LiveStore } from './live-store';
import { LiveView } from './live-view';

async function render() {
  const gateway = {
    onStatus: () => () => {},
    onBatch: () => () => {},
    status: async () => ({
      generation: 0,
      state: 'disconnected',
      retryable: false,
      catchingUp: false,
    }),
    clients: vi.fn(async () => [{ id: 'client-1', displayName: 'Test client' }]),
    connect: vi.fn(async () => 1),
    disconnect: vi.fn(async () => {}),
    select: vi.fn(async () => 2),
  };
  await TestBed.configureTestingModule({
    imports: [LiveView],
    providers: [
      { provide: LiveGateway, useValue: gateway },
      {
        provide: PlotlyRuntime,
        useValue: {
          render: async () => {},
          purge() {},
          resize() {},
          onClick() {},
          onWebglContextLost() {},
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(LiveView);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return {
    fixture,
    gateway,
    root: fixture.nativeElement as HTMLElement,
    store: TestBed.inject(LiveStore),
  };
}

describe('LiveView', () => {
  it('lists clients and clears the password before starting a connection', async () => {
    const { fixture, gateway, root } = await render();
    const url = root.querySelector<HTMLInputElement>('input[type=url]')!;
    const token = root.querySelector<HTMLInputElement>('input[type=password]')!;
    url.value = 'https://relay.example';
    url.dispatchEvent(new Event('input'));
    token.value = 'private-token';
    token.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const load = [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Load clients'),
    )!;
    load.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(gateway.clients).toHaveBeenCalledWith(url.value, 'private-token');
    const client = root.querySelector<HTMLSelectElement>('.connection-form select')!;
    client.value = 'client-1';
    client.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(root.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(token.value).toBe('');
    expect(gateway.connect).toHaveBeenCalledWith(url.value, 'private-token', 'client-1');
    await fixture.whenStable();
  });

  it('renders known readings, units and stale state without a workspace', async () => {
    const { fixture, root, store } = await render();
    store.catalog.set({
      channels: [
        { id: 'RPM', label: 'Engine speed', unit: 'rpm', validation: 'definition-derived' },
      ],
    } as types.LiveCatalog);
    store.history.set([
      {
        deviceId: 'phone',
        sessionId: 'session',
        sequence: 1,
        timestamp: new Date(Date.now() - 10000).toISOString(),
        values: { RPM: 850 },
        gapBefore: 0,
        backfill: true,
      },
    ]);
    store.status.set({
      generation: 1,
      state: 'connected',
      catchingUp: true,
      retryable: false,
    } as types.LiveConnectionStatus);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.textContent).toContain('Engine speed');
    expect(root.textContent).toContain('850');
    expect(root.textContent).toContain('rpm');
    expect(root.textContent).toContain('Stale');
    expect(root.textContent).toContain('Showing historical backfill');
    expect(root.querySelector('app-plotly-chart')).not.toBeNull();
    root.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    fixture.detectChanges();
    expect(root.querySelector('app-plotly-chart')).toBeNull();
  });
});
