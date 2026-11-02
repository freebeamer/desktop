import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { GaragePanel } from './garage/garage-panel';
import { GarageStore } from './garage/garage-store';
import { ProfilePanel } from './vehicle-profiles/profile-panel';
import { LiveView } from './live-data/live-view';
import { DiffPanel } from './changes/diff-panel';
import { SaveReviewDialog } from './changes/save-review-dialog';
import { DesktopGateway } from './core/desktop-gateway';
import { MapTree } from './map-browser/map-tree';
import { HelpDialog } from './shell/help-dialog';
import { KeyboardCommandDispatcher } from './shell/commands/keyboard-command-dispatcher';
import { TopToolbar } from './shell/toolbar/top-toolbar';
import { DocumentTab, DocumentTabsStore } from './workspace/document-tabs-store';
import { GridPanel } from './workspace/grid-panel';
import { WorkspaceStore } from './workspace/workspace-store';

type BackendState = 'checking' | 'ready' | 'offline';

@Component({
  selector: 'app-root',
  imports: [GaragePanel, ProfilePanel, LiveView, NgTemplateOutlet, DecimalPipe, MapTree, DiffPanel, SaveReviewDialog, HelpDialog, GridPanel, TopToolbar],
  styleUrl: './app.scss',
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private readonly gateway = inject(DesktopGateway);
  private readonly garage = inject(GarageStore);
  protected readonly workspace = inject(WorkspaceStore);
  protected readonly tabs = inject(DocumentTabsStore);
  private readonly keyboard = inject(KeyboardCommandDispatcher);

  protected readonly view = signal<'editor' | 'live' | 'profiles'>('editor');

  protected readonly backendState = signal<BackendState>('checking');
  protected readonly backendLabel = signal('Connecting to Go engine');

  ngOnInit(): void {
    void this.checkBackend();
    void this.garage.initialize();
  }

  protected chooseAndOpenWorkspace(): void {
    void this.workspace.chooseAndOpen();
  }

  protected tabLabel(tab: DocumentTab): string {
    switch (tab.kind) {
      case 'overview':
        return 'Workspace overview';
      case 'changes':
        return 'Changes';
      default:
        return tab.title;
    }
  }

  protected closeTab(event: Event, tab: DocumentTab): void {
    event.stopPropagation();
    this.tabs.close(tab);
  }

  @HostListener('document:keydown', ['$event'])
  protected onGlobalKeydown(event: KeyboardEvent): void {
    if (this.view() === 'editor') this.keyboard.dispatch(event);
  }

  private async checkBackend(): Promise<void> {
    try {
      const health = await this.gateway.health();
      if (!health.ready) {
        throw new Error('backend reported not ready');
      }
      this.backendLabel.set(`${health.engine} · ${health.apiVersion}`);
      this.backendState.set('ready');
    } catch {
      this.backendLabel.set('Go engine unavailable');
      this.backendState.set('offline');
    }
  }
}
