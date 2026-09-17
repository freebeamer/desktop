import { ChangeDetectionStrategy, Component, ElementRef, inject, input, viewChild } from '@angular/core';
import { CdkDrag, CdkDragEnd } from '@angular/cdk/drag-drop';
import { MapEditor, MapLoadedEvent } from '../map-editor/map-editor';
import { DocumentTabsStore, GridPanelLayout } from './document-tabs-store';
import { ActiveEditorStore } from '../shell/active-editor-store';

const MIN_PANEL_WIDTH = 240;
const MIN_SCALAR_PANEL_WIDTH = 192;

/** The content of one grid tab: any number of maps freely positioned and
 * sized on a canvas, added by clicking or dragging them from the sidebar,
 * so several can be viewed/edited side by side at whatever size the user
 * wants — nothing here auto-shrinks or auto-flows panels to fit. A panel
 * has no chrome of its own beyond a remove button and resize handle — it's
 * dragged by MapEditor's own header (see CdkDragHandle there) rather than
 * an extra bar, so the map's content isn't squeezed by a redundant one. */
@Component({
  selector: 'app-grid-panel',
  standalone: true,
  imports: [MapEditor, CdkDrag],
  templateUrl: './grid-panel.html',
  styleUrl: './grid-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GridPanel {
  readonly gridId = input.required<string>();
  readonly panels = input.required<GridPanelLayout[]>();

  protected readonly tabs = inject(DocumentTabsStore);
  private readonly activeEditor = inject(ActiveEditorStore);
  private readonly canvas = viewChild<ElementRef<HTMLElement>>('canvas');
  private readonly loadedMaps = new Map<number, MapLoadedEvent>();
  private readonly minimumPanelWidths = new Map<number, number>();

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    const raw = event.dataTransfer?.getData('text/plain');
    const mapId = raw ? Number(raw) : Number.NaN;
    if (Number.isFinite(mapId)) {
      this.tabs.addMapToGrid(this.gridId(), mapId, this.dropPosition(event));
    }
  }

  private dropPosition(event: DragEvent): { x: number; y: number } | undefined {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) {
      return undefined;
    }
    const rect = target.getBoundingClientRect();
    return { x: Math.max(0, event.clientX - rect.left), y: Math.max(0, event.clientY - rect.top) };
  }

  protected remove(mapId: number): void {
    this.activeEditor.clear(mapId);
    this.tabs.removeMapFromGrid(this.gridId(), mapId);
  }

  protected trackByMapId(_index: number, panel: GridPanelLayout): number {
    return panel.mapId;
  }

  protected onDragEnded(event: CdkDragEnd, panel: GridPanelLayout): void {
    const { x, y } = event.source.getFreeDragPosition();
    this.tabs.updatePanelLayout(this.gridId(), panel.mapId, { x, y });
  }

  protected onMapLoaded(panel: GridPanelLayout, event: MapLoadedEvent): void {
    this.loadedMaps.set(panel.mapId, event);
    this.tabs.fitPanelToMap(this.gridId(), panel.mapId, event);
    this.measurePanelSize(panel.mapId, true);
  }

  protected onMapLayoutChanged(mapId: number): void {
    this.measurePanelSize(mapId);
  }

  private measurePanelSize(mapId: number, measureInitialWidth = false): void {
    const map = this.loadedMaps.get(mapId);
    if (!map) {
      return;
    }
    // The table's real vertical footprint depends on wrapped titles, optional
    // controls, and the cell inspector. Measure after Angular paints and keep
    // height content-owned; the user resize affordance changes width only.
    setTimeout(() => {
      const root = this.canvas()?.nativeElement;
      const cell = root?.querySelector<HTMLElement>(`.grid-panel__cell[data-map-id="${mapId}"]`);
      const editor = cell?.querySelector<HTMLElement>('app-map-editor');
      const table = editor?.querySelector<HTMLElement>('.matrix-workbench .map-grid');
      if (table) {
        const tableWidth = Math.max(table.scrollWidth, table.getBoundingClientRect().width);
        if (tableWidth > 0) {
          const minimumWidth = Math.ceil(tableWidth + 16);
          this.minimumPanelWidths.set(mapId, minimumWidth);
          if (measureInitialWidth) {
            this.tabs.syncPanelWidthToTable(this.gridId(), mapId, map, minimumWidth);
          }
        }
      }
      if (editor && editor.scrollHeight > 0) {
        this.tabs.syncPanelHeightToContent(this.gridId(), mapId, map, editor.scrollHeight + 16);
      }
    });
  }

  /** Resize is implemented by hand (CDK drag-drop only moves elements) by
   * tracking the pointer from the handle's pointerdown to its pointerup and
   * writing the new size back to the store as it changes. */
  protected onResizePointerDown(event: PointerEvent, panel: GridPanelLayout): void {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = panel.width;
    const gridId = this.gridId();
    const mapId = panel.mapId;
    const scalar = !!(event.currentTarget as HTMLElement | null)?.closest('.grid-panel__cell')?.querySelector('.scalar-editor');

    const onMove = (moveEvent: PointerEvent) => {
      const minimumWidth = scalar
        ? MIN_SCALAR_PANEL_WIDTH
        : Math.max(MIN_PANEL_WIDTH, this.minimumPanelWidths.get(mapId) ?? 0);
      const width = Math.max(minimumWidth, startWidth + (moveEvent.clientX - startX));
      this.tabs.updatePanelLayout(gridId, mapId, { width });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.measurePanelSize(mapId);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  protected dragBoundary(): HTMLElement {
    return this.canvas()!.nativeElement;
  }
}
