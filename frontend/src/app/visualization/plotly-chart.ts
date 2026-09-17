import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, effect, inject, input, output, viewChild } from '@angular/core';
import type { Config, Data, Layout, PlotMouseEvent } from 'plotly.js';
import { PlotlyRuntime } from './plotly-runtime';

/**
 * The Plotly adapter: purely mechanical. It knows nothing about calibration
 * maps or cells — it forwards data/layout/config to Plotly.react and
 * forwards Plotly's own events back out untouched. Callers (MapEditor) own
 * theme defaults and point-to-cell interpretation.
 */
@Component({
  selector: 'app-plotly-chart',
  standalone: true,
  template: `<div #host class="plotly-chart-host"></div>`,
  styleUrl: './plotly-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlotlyChart implements OnDestroy {
  readonly data = input.required<Data[]>();
  readonly layout = input<Partial<Layout>>({});
  readonly config = input<Partial<Config>>({});

  readonly pointClick = output<PlotMouseEvent>();
  readonly rendered = output<void>();
  readonly renderFailed = output<void>();

  private readonly runtime = inject(PlotlyRuntime);
  private readonly hostRef = viewChild<ElementRef<HTMLDivElement>>('host');
  private resizeObserver?: ResizeObserver;
  private listenersAttached = false;
  private renderGeneration = 0;

  constructor() {
    effect(() => {
      const host = this.hostRef();
      const data = this.data();
      const layout = this.layout();
      const config = this.config();
      if (!host) {
        return;
      }
      void this.render(host.nativeElement, data, layout, config);
      this.ensureResizeObserver(host.nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    const host = this.hostRef();
    if (host) {
      this.runtime.purge(host.nativeElement);
    }
  }

  resize(): void {
    const host = this.hostRef();
    if (host) {
      this.runtime.resize(host.nativeElement);
    }
  }

  private ensureResizeObserver(el: HTMLElement): void {
    if (this.resizeObserver || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.runtime.resize(el));
    this.resizeObserver.observe(el);
  }

  private async render(el: HTMLElement, data: Data[], layout: Partial<Layout>, config: Partial<Config>): Promise<void> {
    const generation = ++this.renderGeneration;
    try {
      await this.runtime.render(el, data, layout, config);
    } catch {
      if (generation === this.renderGeneration) {
        this.renderFailed.emit();
      }
      return;
    }
    if (generation !== this.renderGeneration || this.listenersAttached) {
      if (generation === this.renderGeneration) {
        this.runtime.resize(el);
        this.rendered.emit();
      }
      return;
    }
    this.runtime.resize(el);
    this.rendered.emit();
    this.listenersAttached = true;
    this.runtime.onClick(el, (event) => this.pointClick.emit(event));
    this.runtime.onWebglContextLost(el, () => this.renderFailed.emit());
  }
}
