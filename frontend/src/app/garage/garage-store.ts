import { Injectable, inject, signal } from '@angular/core';
import { ConfigureGarage, RestoreGarage } from '../../../wailsjs/go/main/App';
import { LiveStore } from '../live-data/live-store';

@Injectable({ providedIn: 'root' })
export class GarageGateway {
  restore() {
    return RestoreGarage();
  }
  configure(url: string, token: string) {
    return ConfigureGarage(url, token);
  }
}

@Injectable({ providedIn: 'root' })
export class GarageStore {
  readonly live = inject(LiveStore);
  private readonly gateway = inject(GarageGateway);
  readonly url = signal('');
  readonly configured = signal(false);
  readonly open = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.live.initialize();
    await this.connect(() => this.gateway.restore());
  }

  async configure(url: string, token: string): Promise<void> {
    await this.connect(() => this.gateway.configure(url.trim(), token));
  }

  private async connect(
    action: () => Promise<{ url: string; configured: boolean }>,
  ): Promise<void> {
    if (this.busy() || this.live.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.live.changeConnection(async () => {
        const settings = await action();
        this.url.set(settings.url);
        this.configured.set(settings.configured);
        this.open.set(!settings.configured);
      });
    } catch {
      this.error.set('Could not open the garage connection. Check your garage settings.');
      this.open.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
