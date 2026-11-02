import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveGateway } from '../live-data/live-gateway';
import { GaragePanel } from './garage-panel';
import { GarageGateway, GarageStore } from './garage-store';

async function render() {
  const live = {
    onStatus: () => () => {},
    onBatch: () => () => {},
    status: async () => ({
      generation: 0,
      state: 'disconnected',
      retryable: false,
      catchingUp: false,
    }),
    createPairingLink: vi.fn(async () => ({
      pairingToken: 'tok',
      deepLink: 'freebeamer://connect?pairing_token=tok',
      displayName: 'Bay 3',
      expiresAt: new Date().toISOString(),
    })),
  };
  const garage = {
    restore: vi.fn(async () => ({ url: '', configured: false })),
    configure: vi.fn(async (url: string) => ({ url, configured: true })),
  };
  await TestBed.configureTestingModule({
    imports: [GaragePanel],
    providers: [
      { provide: LiveGateway, useValue: live },
      { provide: GarageGateway, useValue: garage },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(GaragePanel);
  TestBed.inject(GarageStore).open.set(true);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, live, root: fixture.nativeElement as HTMLElement };
}

afterEach(() => TestBed.resetTestingModule());

describe('GaragePanel', () => {
  it('creates and displays a pairing link, then dismisses it', async () => {
    const { fixture, live, root } = await render();
    const url = root.querySelector<HTMLInputElement>('input[type=url]')!;
    const token = root.querySelector<HTMLInputElement>('input[type=password]')!;
    const name = root.querySelector<HTMLInputElement>('input[placeholder="Bay 3 - N55"]')!;
    url.value = 'https://relay.example';
    token.value = 'admin-token';
    name.value = 'Bay 3';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const create = [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Create pairing link'),
    )!;
    expect(create.disabled).toBe(false);
    create.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(live.createPairingLink).toHaveBeenCalledWith(
      'https://relay.example',
      'admin-token',
      'Bay 3',
    );
    expect(root.textContent).toContain('Bay 3');
    expect(root.querySelector<HTMLInputElement>('.pairing-link-row input')!.value).toBe(
      'freebeamer://connect?pairing_token=tok',
    );
    const dismiss = [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Dismiss'),
    )!;
    dismiss.click();
    fixture.detectChanges();
    expect(root.querySelector('.pairing-link')).toBeNull();
  });
});
