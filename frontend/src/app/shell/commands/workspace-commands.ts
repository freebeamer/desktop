import { Injectable, computed, inject, signal } from '@angular/core';
import { DesktopGateway } from '../../core/desktop-gateway';
import { SaveReviewStore } from '../../changes/save-review-store';
import { HelpStore } from '../help-store';
import { DocumentTabsStore } from '../../workspace/document-tabs-store';
import { EditHistoryStore } from '../../workspace/edit-history-store';
import { WorkspaceStore } from '../../workspace/workspace-store';
import type { AppCommand } from './app-command';
import type { types } from '../../../../wailsjs/go/models';

@Injectable({ providedIn: 'root' })
export class WorkspaceCommands {
  private readonly workspace = inject(WorkspaceStore);
  private readonly history = inject(EditHistoryStore);
  private readonly tabs = inject(DocumentTabsStore);
  private readonly saveReview = inject(SaveReviewStore);
  private readonly help = inject(HelpStore);
  private readonly gateway = inject(DesktopGateway);
  private readonly recentsState = signal<types.RecentEntry[]>([]);
  readonly recents = this.recentsState.asReadonly();

  private readonly hasWorkspace = computed(() => ['ready', 'unsupported'].includes(this.workspace.phase()));
  private readonly canOpen = computed(() => this.workspace.phase() !== 'loading');
  private readonly always = computed(() => true);

  readonly open: AppCommand = {
    id: 'workspace.open', label: 'Open', description: 'Open a definition and BIN workspace', shortcut: 'Ctrl+O', icon: 'open',
    enabled: this.canOpen, execute: async () => { await this.workspace.chooseAndOpen(); await this.refreshRecents(); },
  };
  readonly saveAs: AppCommand = {
    id: 'workspace.save-as', label: 'Save As', description: 'Review changes and save a new BIN', shortcut: 'Ctrl+Shift+S', icon: 'save',
    enabled: this.hasWorkspace, execute: () => this.saveReview.open(),
  };
  readonly close: AppCommand = {
    id: 'workspace.close', label: 'Close', description: 'Close the current workspace', icon: 'close',
    enabled: this.hasWorkspace, execute: () => this.workspace.close(),
  };
  readonly undo: AppCommand = {
    id: 'edit.undo', label: 'Undo', description: 'Undo the last edit transaction', shortcut: 'Ctrl+Z', icon: 'undo',
    enabled: this.history.canUndo, execute: () => this.history.undo(),
  };
  readonly redo: AppCommand = {
    id: 'edit.redo', label: 'Redo', description: 'Redo the last edit transaction', shortcut: 'Ctrl+Y', icon: 'redo',
    enabled: this.history.canRedo, execute: () => this.history.redo(),
  };
  readonly newGrid: AppCommand = {
    id: 'workspace.new-grid', label: 'New Grid', description: 'Create an empty map grid', shortcut: 'Ctrl+N', icon: 'grid',
    enabled: this.hasWorkspace, execute: () => { this.tabs.newGrid(); },
  };
  readonly changes: AppCommand = {
    id: 'workspace.changes', label: 'Changes', description: 'Review changed calibration cells', shortcut: 'Ctrl+Shift+C', icon: 'changes',
    enabled: this.hasWorkspace, execute: () => { this.tabs.openChanges(); },
  };
  readonly search: AppCommand = {
    id: 'workspace.search', label: 'Search', description: 'Focus map search', shortcut: 'Ctrl+K', icon: 'search',
    enabled: this.hasWorkspace,
    execute: () => { document.querySelector<HTMLInputElement>('.search-field input:not(:disabled)')?.focus(); },
  };
  readonly helpCommand: AppCommand = {
    id: 'help.shortcuts', label: 'Help', description: 'Open help and keyboard shortcuts', shortcut: 'F1', icon: 'help',
    enabled: this.always, execute: () => { this.help.open(); },
  };

  readonly primary = [this.open, this.saveAs];
  readonly editing = [this.undo, this.redo];
  readonly workspaceGroup = [this.newGrid, this.changes];

  constructor() { void this.refreshRecents(); }

  async openRecent(entry: types.RecentEntry): Promise<void> {
    if (!this.canOpen()) return;
    await this.workspace.open(entry.xdfPath, entry.binPath);
    await this.refreshRecents();
  }

  private async refreshRecents(): Promise<void> {
    try {
      // Go marshals a nil slice as JSON null. Keep the UI-facing signal's
      // array invariant even before the first workspace has been opened.
      this.recentsState.set((await this.gateway.recentWorkspaces()) ?? []);
    } catch {
      // Recent entries are a convenience and must not interfere with opening.
    }
  }
}
