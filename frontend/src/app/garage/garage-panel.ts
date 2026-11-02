import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { GarageStore } from './garage-store';

@Component({
  selector: 'app-garage-panel',
  imports: [DatePipe],
  templateUrl: './garage-panel.html',
  styleUrl: './garage-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GaragePanel {
  readonly store = inject(GarageStore);
  // Tracked as a signal because this component is OnPush: an <input>
  // keystroke alone never re-runs change detection, so a [disabled]
  // expression reading the input's raw .value would go stale.
  readonly pairingNameValue = signal('');

  save(url: HTMLInputElement, token: HTMLInputElement): void {
    const secret = token.value;
    token.value = '';
    void this.store.configure(url.value, secret);
  }

  /** Mints a single-use device pairing link with the admin token typed
   * into this form (the token is not read back from saved settings). */
  async createPairingLink(
    url: HTMLInputElement,
    token: HTMLInputElement,
    name: HTMLInputElement,
  ): Promise<void> {
    const relay = url.value.trim() || this.store.url();
    await this.store.live.createPairingLink(relay, token.value, name.value.trim());
  }

  async copyPairingLink(deepLink: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(deepLink);
    } catch {
      // Clipboard access can be denied/unavailable; the link is still
      // shown in the panel for manual copy either way.
    }
  }
}
