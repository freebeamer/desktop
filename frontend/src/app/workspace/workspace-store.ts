import { Injectable, inject, signal } from '@angular/core';
import { DesktopGateway } from '../core/desktop-gateway';
import type { types } from '../../../wailsjs/go/models';

/**
 * 'unsupported' is a fully loaded workspace the V0 engine refuses to allow
 * editing on (see WorkspaceSummary.editingAllowed) — it is still inspectable,
 * just read-only.
 */
export type WorkspacePhase = 'empty' | 'loading' | 'ready' | 'unsupported' | 'error';

const CANCELLED_MARKER = 'file selection was cancelled';

@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  private readonly gateway = inject(DesktopGateway);

  private readonly phaseState = signal<WorkspacePhase>('empty');
  private readonly summaryState = signal<types.WorkspaceSummary | null>(null);
  private readonly errorMessageState = signal('');
  private readonly changeListeners = new Set<() => void>();
  private lastNotifiedGeneration: number | undefined;

  readonly phase = this.phaseState.asReadonly();
  readonly summary = this.summaryState.asReadonly();
  readonly errorMessage = this.errorMessageState.asReadonly();

  /**
   * Registers a callback invoked synchronously whenever a genuinely new
   * workspace is opened or the current one is closed — not on a routine
   * summary refresh after an edit, which changes the same workspace's
   * generation not at all. Per-workspace UI state (open tabs, undo/redo
   * history, map browser filters) uses this to reset deterministically.
   *
   * This exists instead of those consumers reactively watching `summary()`
   * in an `effect()`: an effect's first run is only guaranteed to happen
   * *eventually*, not before whatever code runs immediately after the
   * signal write that triggered it — so a consumer built that way can end
   * up resetting itself *after* other code has already reacted to the same
   * change, wiping out state that change legitimately produced. A direct
   * callback invoked from the same call stack as the state change has no
   * such ordering hazard.
   *
   * The listener also fires once immediately, synchronously, against
   * whatever the current state already is. Several consumers (MapBrowserStore
   * chief among them) are only constructed lazily, the first time a
   * workspace-dependent view mounts — by definition after a workspace has
   * already opened — so without this they would never see the change that
   * caused them to be constructed in the first place.
   */
  onWorkspaceChanged(listener: () => void): void {
    this.changeListeners.add(listener);
    listener();
  }

  async chooseAndOpen(): Promise<void> {
    if (this.phaseState() === 'loading') {
      return;
    }
    this.phaseState.set('loading');
    try {
      this.applySummary(await this.gateway.chooseAndOpenWorkspace());
    } catch (error) {
      this.handleOpenError(error);
    }
  }

  async open(xdfPath: string, binPath: string): Promise<void> {
    this.phaseState.set('loading');
    try {
      this.applySummary(await this.gateway.openWorkspace(xdfPath, binPath));
    } catch (error) {
      this.handleOpenError(error);
    }
  }

  async close(): Promise<void> {
    await this.gateway.closeWorkspace();
    this.summaryState.set(null);
    this.errorMessageState.set('');
    this.phaseState.set('empty');
    this.notifyIfGenerationChanged(undefined);
  }

  /** Re-fetches the current workspace summary in place (no loading-state
   * flicker) — used after an edit, undo, or redo changes checksum status,
   * changed-byte count, or undo/redo availability. */
  async refreshSummary(): Promise<void> {
    try {
      this.applySummary(await this.gateway.getWorkspace());
    } catch {
      // A stale summary beats clobbering workspace state on a transient failure.
    }
  }

  private applySummary(summary: types.WorkspaceSummary): void {
    this.summaryState.set(summary);
    this.errorMessageState.set('');
    this.phaseState.set(summary.editingAllowed ? 'ready' : 'unsupported');
    this.notifyIfGenerationChanged(summary.generation);
  }

  private notifyIfGenerationChanged(generation: number | undefined): void {
    if (generation === this.lastNotifiedGeneration) {
      return;
    }
    this.lastNotifiedGeneration = generation;
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  private handleOpenError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(CANCELLED_MARKER)) {
      const existing = this.summaryState();
      this.phaseState.set(existing ? (existing.editingAllowed ? 'ready' : 'unsupported') : 'empty');
      return;
    }
    this.errorMessageState.set(message);
    this.phaseState.set('error');
  }
}
