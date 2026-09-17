import { Injectable } from '@angular/core';
import type { Config, Data, Layout, PlotHoverEvent, PlotMouseEvent, PlotlyHTMLElement } from 'plotly.js';
import Plotly from 'plotly.js-dist-min';

/**
 * The Plotly adapter's dependency boundary. Plotly.js touches real Canvas
 * and WebGL APIs that jsdom cannot provide (heatmap throws for a missing
 * 2D canvas context; a gl3d surface trace crashes the Node test worker
 * outright) — so component tests inject a fake instead of RealPlotlyRuntime,
 * and only a genuine browser-level test exercises rendering itself.
 */
export abstract class PlotlyRuntime {
  abstract render(el: HTMLElement, data: Data[], layout: Partial<Layout>, config: Partial<Config>): Promise<void>;
  abstract purge(el: HTMLElement): void;
  abstract resize(el: HTMLElement): void;
  abstract onClick(el: HTMLElement, handler: (event: PlotMouseEvent) => void): void;
  abstract onHover(el: HTMLElement, handler: (event: PlotHoverEvent) => void): void;
  abstract onWebglContextLost(el: HTMLElement, handler: () => void): void;
}

@Injectable({ providedIn: 'root' })
export class RealPlotlyRuntime implements PlotlyRuntime {
  async render(el: HTMLElement, data: Data[], layout: Partial<Layout>, config: Partial<Config>): Promise<void> {
    await Plotly.react(el as PlotlyHTMLElement, data, layout, config);
  }

  purge(el: HTMLElement): void {
    Plotly.purge(el);
  }

  resize(el: HTMLElement): void {
    Plotly.Plots.resize(el as PlotlyHTMLElement);
  }

  onClick(el: HTMLElement, handler: (event: PlotMouseEvent) => void): void {
    (el as PlotlyHTMLElement).on('plotly_click', handler);
  }

  onHover(el: HTMLElement, handler: (event: PlotHoverEvent) => void): void {
    (el as PlotlyHTMLElement).on('plotly_hover', handler);
  }

  onWebglContextLost(el: HTMLElement, handler: () => void): void {
    // Not in @types/plotly.js's PlotlyHTMLElement.on() overloads, but it is
    // a real Plotly event name for gl3d/WebGL contexts.
    (el as PlotlyHTMLElement).on('plotly_webglcontextlost' as 'plotly_event', handler);
  }
}
