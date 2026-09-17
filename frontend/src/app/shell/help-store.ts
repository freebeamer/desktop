import { Injectable, signal } from '@angular/core';

export type HelpTab = 'shortcuts' | 'about';

@Injectable({ providedIn: 'root' })
export class HelpStore {
  private readonly openState = signal(false);
  private readonly tabState = signal<HelpTab>('shortcuts');

  readonly isOpen = this.openState.asReadonly();
  readonly tab = this.tabState.asReadonly();

  open(tab: HelpTab = 'shortcuts'): void {
    this.tabState.set(tab);
    this.openState.set(true);
  }

  close(): void {
    this.openState.set(false);
  }

  setTab(tab: HelpTab): void {
    this.tabState.set(tab);
  }
}
