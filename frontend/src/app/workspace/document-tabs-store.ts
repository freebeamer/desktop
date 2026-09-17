import { Injectable, computed, inject, signal } from '@angular/core';
import { WorkspaceStore } from './workspace-store';

/** Default size given to a panel when it's added without an explicit drop
 * position (e.g. clicked from the sidebar rather than dragged onto the
 * canvas). The user can resize/move it freely afterward. */
const DEFAULT_PANEL_WIDTH = 480;
const DEFAULT_PANEL_HEIGHT = 420;
const SCALAR_PANEL_WIDTH = 240;
const SCALAR_PANEL_HEIGHT = 72;
const MIN_TABLE_PANEL_WIDTH = 300;
const MAX_TABLE_PANEL_WIDTH = 760;
const MIN_MATRIX_WORKBENCH_WIDTH = 480;
const MIN_TABLE_PANEL_HEIGHT = 230;
const MAX_TABLE_PANEL_HEIGHT = 900;
const MIN_MEASURED_PANEL_HEIGHT = 160;
const MIN_MEASURED_PANEL_WIDTH = 240;
const CASCADE_STEP = 32;
const CASCADE_CYCLE = 6;

function cascadePosition(existingCount: number): { x: number; y: number } {
  const step = existingCount % CASCADE_CYCLE;
  return { x: 24 + step * CASCADE_STEP, y: 24 + step * CASCADE_STEP };
}

function fittedPanelSize(shape: string, rows: number, columns: number): { width: number; height: number } {
  if (shape === 'scalar') {
    return { width: SCALAR_PANEL_WIDTH, height: SCALAR_PANEL_HEIGHT };
  }
  if (shape === 'invalid') {
    return { width: 420, height: 210 };
  }
  const safeRows = Math.max(1, rows);
  const safeColumns = Math.max(1, columns);
  const rowHeaderWidth = safeRows > 1 ? 72 : 0;
  const columnHeaderHeight = safeColumns > 1 ? 30 : 0;
  const tableWidth = rowHeaderWidth + safeColumns * 72 + 48;
  const minimumWidth = shape === 'matrix' ? MIN_MATRIX_WORKBENCH_WIDTH : MIN_TABLE_PANEL_WIDTH;
  const width = Math.min(MAX_TABLE_PANEL_WIDTH, Math.max(minimumWidth, tableWidth));
  const height = Math.min(MAX_TABLE_PANEL_HEIGHT, Math.max(MIN_TABLE_PANEL_HEIGHT, safeRows * 29 + columnHeaderHeight + 158));
  return { width, height };
}

/** One map's position and size within a grid tab's freeform canvas — the
 * user drags to move and resizes via the handle, and both are persisted
 * here so the layout survives switching tabs. */
export interface GridPanelLayout {
  mapId: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A grid tab holds any number of maps, added by clicking or dragging them
 * from the sidebar, so several can be viewed/edited side by side. Each has
 * its own freely movable/resizable position on the tab's canvas. */
export interface GridTab {
  kind: 'grid';
  id: string;
  title: string;
  panels: GridPanelLayout[];
}

export type DocumentTab = { kind: 'overview' } | { kind: 'changes' } | GridTab;

function tabKey(tab: DocumentTab): string {
  if (tab.kind === 'overview') return 'overview';
  if (tab.kind === 'changes') return 'changes';
  return `grid:${tab.id}`;
}

/**
 * Tracks which document tabs are open and which is active. Resets whenever
 * the open workspace changes (including closing it) so tabs never point at
 * a map from a previous workspace/generation.
 */
@Injectable({ providedIn: 'root' })
export class DocumentTabsStore {
  private readonly workspace = inject(WorkspaceStore);

  private readonly tabsState = signal<DocumentTab[]>([{ kind: 'overview' }]);
  private readonly activeKeyState = signal<string>('overview');
  private nextGridNumber = 1;

  readonly tabs = this.tabsState.asReadonly();
  readonly activeKey = this.activeKeyState.asReadonly();
  readonly activeTab = computed<DocumentTab>(
    () => this.tabsState().find((tab) => tabKey(tab) === this.activeKeyState()) ?? { kind: 'overview' },
  );
  readonly activeGridId = computed<string | null>(() => {
    const tab = this.activeTab();
    return tab.kind === 'grid' ? tab.id : null;
  });
  readonly activeGridPanels = computed<GridPanelLayout[]>(() => {
    const tab = this.activeTab();
    return tab.kind === 'grid' ? tab.panels : [];
  });
  readonly activeGridMapIds = computed<number[]>(() => this.activeGridPanels().map((panel) => panel.mapId));

  constructor() {
    this.workspace.onWorkspaceChanged(() => this.reset());
  }

  isActive(tab: DocumentTab): boolean {
    return tabKey(tab) === this.activeKeyState();
  }

  isMapInActiveGrid(mapId: number): boolean {
    return this.activeGridMapIds().includes(mapId);
  }

  activate(tab: DocumentTab): void {
    this.activeKeyState.set(tabKey(tab));
  }

  newGrid(): GridTab {
    const number = this.nextGridNumber++;
    const grid: GridTab = { kind: 'grid', id: `grid-${number}`, title: `Grid ${number}`, panels: [] };
    this.tabsState.update((tabs) => [...tabs, grid]);
    this.activeKeyState.set(tabKey(grid));
    return grid;
  }

  /** Adds mapId to the active grid tab — creating a new grid tab first if
   * the active tab isn't one — which is what clicking a map in the sidebar
   * does. Dragging a map onto a specific grid uses addMapToGrid directly. */
  addMapToActiveGrid(mapId: number): void {
    const active = this.activeTab();
    const grid = active.kind === 'grid' ? active : this.newGrid();
    this.addMapToGrid(grid.id, mapId);
  }

  /** position is where the panel lands, e.g. the point a sidebar drag was
   * dropped at; omitted for a plain click, which cascades off the last
   * panel added so new panels never land exactly on top of each other. */
  addMapToGrid(gridId: string, mapId: number, position?: { x: number; y: number }): void {
    this.tabsState.update((tabs) =>
      tabs.map((tab) => {
        if (tab.kind !== 'grid' || tab.id !== gridId || tab.panels.some((panel) => panel.mapId === mapId)) {
          return tab;
        }
        const { x, y } = position ?? cascadePosition(tab.panels.length);
        const panel: GridPanelLayout = { mapId, x, y, width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT };
        return { ...tab, panels: [...tab.panels, panel] };
      }),
    );
    this.activeKeyState.set(`grid:${gridId}`);
  }

  /** Persists a drag (x/y) or resize-handle (width/height) change the user
   * just made to one panel. */
  updatePanelLayout(gridId: string, mapId: number, patch: Partial<Pick<GridPanelLayout, 'x' | 'y' | 'width' | 'height'>>): void {
    this.tabsState.update((tabs) =>
      tabs.map((tab) => {
        if (tab.kind !== 'grid' || tab.id !== gridId) {
          return tab;
        }
        return { ...tab, panels: tab.panels.map((panel) => (panel.mapId === mapId ? { ...panel, ...patch } : panel)) };
      }),
    );
  }

  /** Fits a newly decoded map to its content once. Once the user changes
   * either dimension, refreshes never overwrite that choice. */
  fitPanelToMap(gridId: string, mapId: number, map: { shape: string; rows: number; columns: number }): void {
    const fitted = fittedPanelSize(map.shape, map.rows, map.columns);
    this.tabsState.update((tabs) =>
      tabs.map((tab) => {
        if (tab.kind !== 'grid' || tab.id !== gridId) {
          return tab;
        }
        return {
          ...tab,
          panels: tab.panels.map((panel) =>
            panel.mapId === mapId && panel.width === DEFAULT_PANEL_WIDTH && panel.height === DEFAULT_PANEL_HEIGHT
              ? { ...panel, ...fitted }
              : panel,
          ),
        };
      }),
    );
  }

  /** Keeps the Y dimension equal to the rendered table content height. */
  syncPanelHeightToContent(
    gridId: string,
    mapId: number,
    map: { shape: string; rows: number; columns: number },
    contentHeight: number,
  ): void {
    if (map.shape === 'scalar' || !Number.isFinite(contentHeight)) {
      return;
    }
    const height = Math.min(MAX_TABLE_PANEL_HEIGHT, Math.max(MIN_MEASURED_PANEL_HEIGHT, Math.ceil(contentHeight)));
    this.tabsState.update((tabs) =>
      tabs.map((tab) => {
        if (tab.kind !== 'grid' || tab.id !== gridId) {
          return tab;
        }
        return {
          ...tab,
          panels: tab.panels.map((panel) => (panel.mapId === mapId && panel.height !== height ? { ...panel, height } : panel)),
        };
      }),
    );
  }

  /** Replaces the initial estimate with the matrix table's rendered width.
   * It only applies before the user changes the panel width. */
  syncPanelWidthToTable(
    gridId: string,
    mapId: number,
    map: { shape: string; rows: number; columns: number },
    contentWidth: number,
  ): void {
    if (map.shape !== 'matrix' || !Number.isFinite(contentWidth)) return;
    const estimated = fittedPanelSize(map.shape, map.rows, map.columns);
    const width = Math.max(MIN_MEASURED_PANEL_WIDTH, Math.ceil(contentWidth));
    this.tabsState.update((tabs) => tabs.map((tab) => {
      if (tab.kind !== 'grid' || tab.id !== gridId) return tab;
      return {
        ...tab,
        panels: tab.panels.map((panel) =>
          panel.mapId === mapId && panel.width === estimated.width ? { ...panel, width } : panel,
        ),
      };
    }));
  }

  openChanges(): void {
    if (!this.tabsState().some((tab) => tab.kind === 'changes')) {
      this.tabsState.update((tabs) => [...tabs, { kind: 'changes' }]);
    }
    this.activeKeyState.set('changes');
  }

  removeMapFromGrid(gridId: string, mapId: number): void {
    this.tabsState.update((tabs) =>
      tabs.map((tab) =>
        tab.kind === 'grid' && tab.id === gridId
          ? { ...tab, panels: tab.panels.filter((panel) => panel.mapId !== mapId) }
          : tab,
      ),
    );
  }

  close(tab: DocumentTab): void {
    if (tab.kind === 'overview') {
      return;
    }
    const key = tabKey(tab);
    const wasActive = this.activeKeyState() === key;
    const remaining = this.tabsState().filter((existing) => tabKey(existing) !== key);
    this.tabsState.set(remaining);
    if (wasActive) {
      this.activeKeyState.set(tabKey(remaining[remaining.length - 1] ?? { kind: 'overview' }));
    }
  }

  reset(): void {
    this.tabsState.set([{ kind: 'overview' }]);
    this.activeKeyState.set('overview');
    this.nextGridNumber = 1;
  }
}
