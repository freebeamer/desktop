import { Injectable, inject } from '@angular/core';
import { WorkspaceCommands } from './workspace-commands';
import { isEditableTarget } from './app-command';

@Injectable({ providedIn: 'root' })
export class KeyboardCommandDispatcher {
  private readonly commands = inject(WorkspaceCommands);

  dispatch(event: KeyboardEvent): boolean {
    if (isEditableTarget(event.target)) return false;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    let command = null;
    if (event.key === 'F1') command = this.commands.helpCommand;
    else if (modifier && key === 'o' && !event.shiftKey) command = this.commands.open;
    else if (modifier && key === 's' && event.shiftKey) command = this.commands.saveAs;
    else if (modifier && key === 'z' && !event.shiftKey) command = this.commands.undo;
    else if (modifier && ((key === 'z' && event.shiftKey) || key === 'y')) command = this.commands.redo;
    else if (modifier && key === 'n' && !event.shiftKey) command = this.commands.newGrid;
    else if (modifier && key === 'c' && event.shiftKey) command = this.commands.changes;
    else if (modifier && key === 'k' && !event.shiftKey) command = this.commands.search;
    if (!command || !command.enabled()) return false;
    event.preventDefault();
    void command.execute();
    return true;
  }
}
