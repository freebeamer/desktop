import type { Signal } from '@angular/core';

export interface AppCommand {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  icon: string;
  enabled: Signal<boolean>;
  execute(): void | Promise<void>;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
