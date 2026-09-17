import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { DesktopGateway } from '../core/desktop-gateway';
import { EditHistoryStore } from '../workspace/edit-history-store';
import type { types } from '../../../wailsjs/go/models';

/** The full byte diff, grouped by calibration edit (docs/desktop-v1-plan.md
 * Phase 4). Refreshes whenever an edit, undo, or redo happens anywhere. */
@Component({
  selector: 'app-diff-panel',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './diff-panel.html',
  styleUrl: './diff-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffPanel {
  private readonly gateway = inject(DesktopGateway);
  protected readonly editHistory = inject(EditHistoryStore);

  protected readonly diff = signal<types.DiffSummary | null>(null);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');

  constructor() {
    effect(() => {
      this.editHistory.revision();
      void this.refresh();
    });
  }

  protected retry(): void {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      this.diff.set(await this.gateway.getDiff());
    } catch (error) {
      this.diff.set(null);
      this.errorMessage.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected cellLabel(edit: types.EditDiff): string {
    return edit.index >= 0 ? `index ${edit.index}` : `row ${edit.row}, col ${edit.column}`;
  }
}
