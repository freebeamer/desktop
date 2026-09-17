import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { WorkspaceStore } from '../workspace/workspace-store';
import { SaveReviewStore } from './save-review-store';

@Component({
  selector: 'app-save-review-dialog',
  standalone: true,
  templateUrl: './save-review-dialog.html',
  styleUrl: './save-review-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaveReviewDialog {
  protected readonly store = inject(SaveReviewStore);
  private readonly workspace = inject(WorkspaceStore);

  protected readonly blocked = computed(() => this.store.checksum()?.status === 'unsupported');

  protected close(): void {
    this.store.close();
  }

  protected save(): void {
    void this.store.confirmSave();
  }

  protected retry(): void {
    void this.store.open();
  }

  protected openSavedCopy(): void {
    const outcome = this.store.outcome();
    const xdfPath = this.workspace.summary()?.xdfPath;
    if (!outcome || !xdfPath) {
      return;
    }
    void this.workspace.open(xdfPath, outcome.path);
    this.store.close();
  }
}
