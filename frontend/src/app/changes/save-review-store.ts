import { Injectable, inject, signal } from '@angular/core';
import { DesktopGateway } from '../core/desktop-gateway';
import type { types } from '../../../wailsjs/go/models';

export type SaveReviewPhase = 'closed' | 'reviewing' | 'saving' | 'done' | 'error';

const CANCELLED_MARKER = 'file selection was cancelled';

/**
 * Drives the save-review screen (docs/desktop-v1-plan.md Phase 5): review
 * current checksum status and pending changes before committing, then
 * ChooseAndSaveAs does dialog + correct-a-clone + post-verify + write as one
 * backend call. Cancelling the native save dialog returns to review rather
 * than surfacing an error.
 */
@Injectable({ providedIn: 'root' })
export class SaveReviewStore {
  private readonly gateway = inject(DesktopGateway);

  private readonly phaseState = signal<SaveReviewPhase>('closed');
  private readonly checksumState = signal<types.ChecksumSummary | null>(null);
  private readonly diffState = signal<types.DiffSummary | null>(null);
  private readonly outcomeState = signal<types.SaveOutcome | null>(null);
  private readonly errorMessageState = signal('');

  readonly phase = this.phaseState.asReadonly();
  readonly checksum = this.checksumState.asReadonly();
  readonly diff = this.diffState.asReadonly();
  readonly outcome = this.outcomeState.asReadonly();
  readonly errorMessage = this.errorMessageState.asReadonly();

  async open(): Promise<void> {
    this.phaseState.set('reviewing');
    this.outcomeState.set(null);
    this.errorMessageState.set('');
    try {
      const [checksum, diff] = await Promise.all([this.gateway.verifyChecksums(), this.gateway.getDiff()]);
      this.checksumState.set(checksum);
      this.diffState.set(diff);
    } catch (error) {
      this.errorMessageState.set(error instanceof Error ? error.message : String(error));
      this.phaseState.set('error');
    }
  }

  close(): void {
    this.phaseState.set('closed');
  }

  async confirmSave(): Promise<void> {
    this.phaseState.set('saving');
    this.errorMessageState.set('');
    try {
      const outcome = await this.gateway.chooseAndSaveAs();
      this.outcomeState.set(outcome);
      this.phaseState.set('done');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(CANCELLED_MARKER)) {
        this.phaseState.set('reviewing');
        return;
      }
      this.errorMessageState.set(message);
      this.phaseState.set('error');
    }
  }
}
