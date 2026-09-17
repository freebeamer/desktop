import { Injectable, inject, signal } from '@angular/core';
import { DesktopGateway } from '../core/desktop-gateway';
import { WorkspaceStore } from './workspace-store';
import type { types } from '../../../wailsjs/go/models';

/**
 * Tracks undo/redo availability and a revision counter every successful
 * edit, undo, or redo bumps. Undo/redo are workspace-level (not tied to one
 * map), so the toolbar drives this store directly; MapEditor watches
 * `revision` to know when to refresh a map it did not itself just edit.
 */
@Injectable({ providedIn: 'root' })
export class EditHistoryStore {
  private readonly gateway = inject(DesktopGateway);
  private readonly workspace = inject(WorkspaceStore);

  private readonly revisionState = signal(0);
  private readonly canUndoState = signal(false);
  private readonly canRedoState = signal(false);
  private readonly errorMessageState = signal('');

  readonly revision = this.revisionState.asReadonly();
  readonly canUndo = this.canUndoState.asReadonly();
  readonly canRedo = this.canRedoState.asReadonly();
  readonly errorMessage = this.errorMessageState.asReadonly();

  constructor() {
    this.workspace.onWorkspaceChanged(() => {
      const summary = this.workspace.summary();
      this.revisionState.set(0);
      this.canUndoState.set(summary?.canUndo ?? false);
      this.canRedoState.set(summary?.canRedo ?? false);
      this.errorMessageState.set('');
    });
  }

  /** Called by whoever made the edit (MapEditor) with the outcome it already has, so no extra round-trip is needed. */
  noteEdit(outcome: Pick<types.EditOutcome, 'canUndo' | 'canRedo'>): void {
    this.canUndoState.set(outcome.canUndo);
    this.canRedoState.set(outcome.canRedo);
    this.revisionState.update((value) => value + 1);
    // Checksum status, changed-byte count, and edit count all live on the
    // workspace summary shown in the shell status bar — keep it current.
    void this.workspace.refreshSummary();
  }

  async undo(): Promise<void> {
    try {
      const outcome = await this.gateway.undo();
      this.errorMessageState.set('');
      this.noteEdit(outcome);
    } catch (error) {
      this.errorMessageState.set(error instanceof Error ? error.message : String(error));
    }
  }

  async redo(): Promise<void> {
    try {
      const outcome = await this.gateway.redo();
      this.errorMessageState.set('');
      this.noteEdit(outcome);
    } catch (error) {
      this.errorMessageState.set(error instanceof Error ? error.message : String(error));
    }
  }
}
