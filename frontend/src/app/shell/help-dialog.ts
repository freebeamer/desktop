import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { HelpStore } from './help-store';

interface Shortcut {
  keys: string;
  action: string;
}

const GLOBAL_SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl/Cmd O', action: 'Open a workspace' },
  { keys: 'Ctrl/Cmd Shift S', action: 'Review and save as a new BIN' },
  { keys: 'Ctrl/Cmd K', action: 'Focus the map search field' },
  { keys: 'Ctrl/Cmd Z', action: 'Undo the most recent edit' },
  { keys: 'Ctrl/Cmd Shift Z, Ctrl/Cmd Y', action: 'Redo' },
  { keys: 'Ctrl/Cmd N', action: 'Create a new grid' },
  { keys: 'Ctrl/Cmd Shift C', action: 'Open Changes' },
  { keys: 'F1', action: 'Open this help' },
];

const GRID_SHORTCUTS: Shortcut[] = [
  { keys: 'Arrow keys', action: 'Move the selected cell' },
  { keys: 'Shift + click/arrow', action: 'Extend the rectangular selection' },
  { keys: 'Pointer drag', action: 'Select a rectangular range' },
  { keys: 'Ctrl/Cmd A', action: 'Select all map cells' },
  { keys: 'Enter, F2', action: 'Start editing the selected cell' },
  { keys: 'Enter', action: 'Commit the value; fills all cells when a range is selected' },
  { keys: 'Escape', action: 'Cancel the value being edited' },
  { keys: 'Delete, Backspace', action: 'Restore the selected cell to its pre-edit value' },
];

/** Pinned to the versions actually declared in go.mod / frontend/package.json — update alongside those files. */
const VERSIONS: Shortcut[] = [
  { keys: 'FreeBeamer', action: 'desktop-v1' },
  { keys: 'Wails', action: 'v2.15.0' },
  { keys: 'Angular', action: 'v22.1.4' },
];

@Component({
  selector: 'app-help-dialog',
  standalone: true,
  templateUrl: './help-dialog.html',
  styleUrl: './help-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpDialog {
  protected readonly store = inject(HelpStore);
  protected readonly globalShortcuts = GLOBAL_SHORTCUTS;
  protected readonly gridShortcuts = GRID_SHORTCUTS;
  protected readonly versions = VERSIONS;

  protected close(): void {
    this.store.close();
  }
}
