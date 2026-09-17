import { ScrollingModule } from '@angular/cdk/scrolling';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, viewChild } from '@angular/core';
import { DocumentTabsStore } from '../workspace/document-tabs-store';
import { MapBrowserStore } from './map-browser-store';
import type { types } from '../../../wailsjs/go/models';

const SHAPE_LABELS: Record<string, string> = {
  scalar: 'Value',
  'one-axis': '1D',
  matrix: '2D',
  invalid: 'Invalid',
};

@Component({
  selector: 'app-map-tree',
  standalone: true,
  imports: [ScrollingModule],
  templateUrl: './map-tree.html',
  styleUrl: './map-tree.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapTree {
  protected readonly store = inject(MapBrowserStore);
  protected readonly tabs = inject(DocumentTabsStore);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  protected onQuery(event: Event): void {
    this.store.setQuery((event.target as HTMLInputElement).value);
  }

  @HostListener('document:keydown', ['$event'])
  protected onGlobalKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.searchInput()?.nativeElement.focus();
    }
  }

  protected open(map: types.MapSummary): void {
    this.tabs.addMapToActiveGrid(map.id);
  }

  protected onDragStart(event: DragEvent, map: types.MapSummary): void {
    event.dataTransfer?.setData('text/plain', String(map.id));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
    }
  }

  protected shapeLabel(shape: string): string {
    return SHAPE_LABELS[shape] ?? shape;
  }

  protected trackById(_index: number, map: types.MapSummary): number {
    return map.id;
  }
}
