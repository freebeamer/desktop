import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import type { types } from '../../../../wailsjs/go/models';
import type { AppCommand } from '../commands/app-command';
import { WorkspaceCommands } from '../commands/workspace-commands';
import { ActiveEditorStore, CellOperation } from '../active-editor-store';
import { WorkspaceStore } from '../../workspace/workspace-store';
import { ToolbarIcon } from './toolbar-icon';

interface OperationOption { value: CellOperation; label: string; }

@Component({
  selector: 'app-top-toolbar',
  standalone: true,
  imports: [ToolbarIcon],
  templateUrl: './top-toolbar.html',
  styleUrl: './top-toolbar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopToolbar {
  readonly backendState = input<'checking' | 'ready' | 'offline'>('checking');
  readonly backendLabel = input('Connecting to Go engine');
  protected readonly commands = inject(WorkspaceCommands);
  protected readonly activeEditor = inject(ActiveEditorStore);
  protected readonly workspace = inject(WorkspaceStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly operation = signal<CellOperation>('fill');
  protected readonly operand = signal('');
  protected readonly operandError = computed(() => {
    const text = this.operand().trim();
    if (!text) return 'Enter a value';
    const value = Number(text);
    if (!Number.isFinite(value)) return 'Enter a finite number';
    if (this.operation() === 'divide' && value === 0) return 'Cannot divide by zero';
    return '';
  });
  protected readonly canApply = computed(() => this.activeEditor.canApply() && !this.operandError());
  protected readonly filename = computed(() => {
    const path = this.workspace.summary()?.binPath;
    if (!path) return 'No workspace';
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
  });
  protected readonly dirty = computed(() => (this.workspace.summary()?.changedBytes ?? 0) > 0);
  protected readonly workspaceStatus = computed(() => {
    switch (this.workspace.phase()) {
      case 'loading': return 'Opening…';
      case 'ready': return 'Ready';
      case 'unsupported': return 'Read only';
      case 'error': return 'Error';
      default: return 'Idle';
    }
  });
  protected readonly operations: OperationOption[] = [
    { value: 'fill', label: 'Fill with value' },
    { value: 'offset', label: 'Offset' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'divide', label: 'Divide' },
    { value: 'scale-percent', label: 'Scale by %' },
  ];

  protected run(command: AppCommand): void {
    if (command.enabled()) void command.execute();
    this.closeMenus();
  }
  protected shortcut(command: AppCommand): string {
    const shortcut = command.shortcut ?? '';
    return /Mac|iPhone|iPad/.test(navigator.platform) ? shortcut.replaceAll('Ctrl', 'Cmd') : shortcut;
  }
  protected commandTitle(command: AppCommand): string {
    const shortcut = this.shortcut(command);
    return command.description + (shortcut ? ` (${shortcut})` : '');
  }
  protected openRecent(entry: types.RecentEntry): void {
    void this.commands.openRecent(entry);
    this.closeMenus();
  }
  protected basename(path: string): string { return path.split(/[\\/]/).pop() || path; }
  protected setOperation(value: string): void { this.operation.set(value as CellOperation); }
  protected setOperand(value: string): void { this.operand.set(value); }
  protected apply(): void {
    const value = Number(this.operand().trim());
    if (this.canApply()) void this.activeEditor.apply(this.operation(), value);
  }
  private closeMenus(): void {
    for (const menu of this.host.nativeElement.querySelectorAll('details[open]')) menu.removeAttribute('open');
  }
}
