import { Injectable, computed, inject, signal } from '@angular/core';
import { DesktopGateway } from '../core/desktop-gateway';
import { EditHistoryStore } from '../workspace/edit-history-store';
import { WorkspaceStore } from '../workspace/workspace-store';
import type { types } from '../../../wailsjs/go/models';

export type CellOperation = 'fill' | 'offset' | 'multiply' | 'divide' | 'scale-percent';

export interface CellRange {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

export interface ActiveEditorContext {
  generation: number;
  mapId: number;
  title: string;
  units: string;
  editable: boolean;
  selection: CellRange;
}

@Injectable({ providedIn: 'root' })
export class ActiveEditorStore {
  private readonly gateway = inject(DesktopGateway);
  private readonly history = inject(EditHistoryStore);
  private readonly workspace = inject(WorkspaceStore);
  private readonly contextState = signal<ActiveEditorContext | null>(null);
  private readonly pendingState = signal(false);
  private readonly errorState = signal('');
  private readonly resultState = signal<types.BatchEditOutcome | null>(null);

  readonly context = this.contextState.asReadonly();
  readonly pending = this.pendingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly result = this.resultState.asReadonly();
  readonly selectionRows = computed(() => {
    const range = this.normalizedSelection();
    return range ? range.endRow - range.startRow + 1 : 0;
  });
  readonly selectionColumns = computed(() => {
    const range = this.normalizedSelection();
    return range ? range.endColumn - range.startColumn + 1 : 0;
  });
  readonly selectionCount = computed(() => this.selectionRows() * this.selectionColumns());
  readonly canApply = computed(() => !!this.contextState()?.editable && this.selectionCount() > 0 && !this.pendingState());

  constructor() {
    this.workspace.onWorkspaceChanged(() => this.clear());
  }

  activate(context: ActiveEditorContext): void {
    const changedMap = this.contextState()?.mapId !== context.mapId;
    this.contextState.set(context);
    if (changedMap) {
      this.errorState.set('');
      this.resultState.set(null);
    }
  }

  updateSelection(mapId: number, selection: CellRange): void {
    const context = this.contextState();
    if (context?.mapId === mapId) {
      this.contextState.set({ ...context, selection });
    }
  }

  clear(mapId?: number): void {
    if (mapId === undefined || this.contextState()?.mapId === mapId) {
      this.contextState.set(null);
      this.errorState.set('');
      this.resultState.set(null);
    }
  }

  async apply(operation: CellOperation, operand: number): Promise<boolean> {
    const context = this.contextState();
    const selection = this.normalizedSelection();
    if (!context?.editable || !selection || this.pendingState()) {
      return false;
    }
    this.pendingState.set(true);
    this.errorState.set('');
    try {
      const outcome = await this.gateway.applyCellOperation({
        generation: context.generation,
        mapId: context.mapId,
        selection,
        operation,
        operand,
      } as types.CellOperationRequest);
      this.resultState.set(outcome);
      this.history.noteEdit(outcome);
      return true;
    } catch (error) {
      this.errorState.set(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      this.pendingState.set(false);
    }
  }

  private normalizedSelection(): CellRange | null {
    const selection = this.contextState()?.selection;
    if (!selection) return null;
    return {
      startRow: Math.min(selection.startRow, selection.endRow),
      startColumn: Math.min(selection.startColumn, selection.endColumn),
      endRow: Math.max(selection.startRow, selection.endRow),
      endColumn: Math.max(selection.startColumn, selection.endColumn),
    };
  }
}
