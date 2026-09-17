import { TestBed } from '@angular/core/testing';
import { DesktopGateway } from '../core/desktop-gateway';
import { EditHistoryStore } from '../workspace/edit-history-store';
import { ActiveEditorStore } from './active-editor-store';
import type { types } from '../../../wailsjs/go/models';

class OperationGateway {
  calls: types.CellOperationRequest[] = [];
  outcome: types.BatchEditOutcome | Error = {
    mapId: 7, mapTitle: 'Fuel', selectedCells: 6, changedCells: 6, unchangedCells: 0,
    minimum: 1, maximum: 9, changedBytes: 12, canUndo: true, canRedo: false,
  } as types.BatchEditOutcome;
  deferred?: Promise<types.BatchEditOutcome>;

  applyCellOperation(request: types.CellOperationRequest): Promise<types.BatchEditOutcome> {
    this.calls.push(request);
    if (this.deferred) return this.deferred;
    return this.outcome instanceof Error ? Promise.reject(this.outcome) : Promise.resolve(this.outcome);
  }

  getWorkspace = (): Promise<types.WorkspaceSummary> => Promise.reject(new Error('unused'));
}

describe('ActiveEditorStore', () => {
  function setup() {
    const gateway = new OperationGateway();
    TestBed.configureTestingModule({ providers: [{ provide: DesktopGateway, useValue: gateway }] });
    return { gateway, store: TestBed.inject(ActiveEditorStore), history: TestBed.inject(EditHistoryStore) };
  }

  it('normalizes the active range and applies it through one backend command', async () => {
    const { gateway, store, history } = setup();
    store.activate({
      generation: 1, mapId: 7, title: 'Fuel', units: 'mg', editable: true,
      selection: { startRow: 2, startColumn: 3, endRow: 1, endColumn: 1 },
    });

    expect(store.selectionRows()).toBe(2);
    expect(store.selectionColumns()).toBe(3);
    expect(store.selectionCount()).toBe(6);
    expect(await store.apply('offset', -2.5)).toBe(true);
    expect(gateway.calls[0]).toMatchObject({
      generation: 1, mapId: 7, operation: 'offset', operand: -2.5,
      selection: { startRow: 1, startColumn: 1, endRow: 2, endColumn: 3 },
    });
    expect(history.revision()).toBe(1);
    expect(store.result()?.changedCells).toBe(6);
  });

  it('does not apply without an editable active map and exposes backend errors', async () => {
    const { gateway, store } = setup();
    expect(await store.apply('fill', 1)).toBe(false);
    expect(gateway.calls).toEqual([]);

    store.activate({ generation: 1, mapId: 7, title: 'Fuel', units: '', editable: false, selection: { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 } });
    expect(await store.apply('fill', 1)).toBe(false);

    store.activate({ ...store.context()!, editable: true });
    gateway.outcome = new Error('value cannot fit unsigned 16-bit');
    expect(await store.apply('fill', 99999)).toBe(false);
    expect(store.error()).toContain('cannot fit');
  });

  it('only lets the active map update or clear its selection', () => {
    const { store } = setup();
    store.activate({ generation: 1, mapId: 7, title: 'Fuel', units: '', editable: true, selection: { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 } });
    store.updateSelection(8, { startRow: 1, startColumn: 1, endRow: 2, endColumn: 2 });
    expect(store.selectionCount()).toBe(1);
    store.clear(8);
    expect(store.context()?.mapId).toBe(7);
    store.clear(7);
    expect(store.context()).toBeNull();
  });

  it('prevents a duplicate operation while the first is pending', async () => {
    const { gateway, store } = setup();
    let resolve!: (outcome: types.BatchEditOutcome) => void;
    gateway.deferred = new Promise((done) => { resolve = done; });
    store.activate({ generation: 1, mapId: 7, title: 'Fuel', units: '', editable: true, selection: { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 } });

    const first = store.apply('fill', 3);
    expect(store.pending()).toBe(true);
    expect(await store.apply('fill', 3)).toBe(false);
    expect(gateway.calls.length).toBe(1);
    resolve(gateway.outcome as types.BatchEditOutcome);
    expect(await first).toBe(true);
    expect(store.pending()).toBe(false);
  });
});
