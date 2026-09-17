import { Injectable, inject, signal } from '@angular/core';
import { DesktopGateway } from '../core/desktop-gateway';
import { WorkspaceStore } from '../workspace/workspace-store';
import type { types } from '../../../wailsjs/go/models';

const SEARCH_DEBOUNCE_MS = 120;

@Injectable({ providedIn: 'root' })
export class MapBrowserStore {
  private readonly gateway = inject(DesktopGateway);
  private readonly workspace = inject(WorkspaceStore);

  private readonly queryState = signal('');
  private readonly categoryState = signal('');
  private readonly pageState = signal<types.MapPage | null>(null);
  private readonly loadingState = signal(false);
  private readonly errorMessageState = signal('');
  private debounceHandle: ReturnType<typeof setTimeout> | undefined;
  private requestGeneration = 0;

  readonly query = this.queryState.asReadonly();
  readonly category = this.categoryState.asReadonly();
  readonly page = this.pageState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly errorMessage = this.errorMessageState.asReadonly();

  constructor() {
    this.workspace.onWorkspaceChanged(() => {
      this.queryState.set('');
      this.categoryState.set('');
      this.pageState.set(null);
      this.errorMessageState.set('');
      if (this.workspace.summary() !== null) {
        void this.refresh();
      }
    });
  }

  setQuery(query: string): void {
    this.queryState.set(query);
    this.scheduleRefresh();
  }

  setCategory(category: string): void {
    this.categoryState.set(this.categoryState() === category ? '' : category);
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.debounceHandle !== undefined) {
      clearTimeout(this.debounceHandle);
    }
    this.debounceHandle = setTimeout(() => void this.refresh(), SEARCH_DEBOUNCE_MS);
  }

  async refresh(): Promise<void> {
    const generation = ++this.requestGeneration;
    this.loadingState.set(true);
    try {
      const page = await this.gateway.listMaps({ query: this.queryState(), category: this.categoryState() });
      if (generation !== this.requestGeneration) {
        return; // a newer request superseded this one
      }
      this.pageState.set(page);
      this.errorMessageState.set('');
    } catch (error) {
      if (generation !== this.requestGeneration) {
        return;
      }
      this.errorMessageState.set(error instanceof Error ? error.message : String(error));
    } finally {
      if (generation === this.requestGeneration) {
        this.loadingState.set(false);
      }
    }
  }
}
