import { TestBed } from '@angular/core/testing';
import type { Config, Data, Layout, PlotHoverEvent, PlotMouseEvent } from 'plotly.js';
import { PlotlyChart } from './plotly-chart';
import { PlotlyRuntime } from './plotly-runtime';

class FakePlotlyRuntime implements PlotlyRuntime {
  renderCalls: Array<{ el: HTMLElement; data: Data[]; layout: Partial<Layout>; config: Partial<Config> }> = [];
  purgeCalls: HTMLElement[] = [];
  resizeCalls: HTMLElement[] = [];
  shouldFail = false;
  private clickHandler?: (event: PlotMouseEvent) => void;
  private hoverHandler?: (event: PlotHoverEvent) => void;

  async render(el: HTMLElement, data: Data[], layout: Partial<Layout>, config: Partial<Config>): Promise<void> {
    this.renderCalls.push({ el, data, layout, config });
    if (this.shouldFail) {
      throw new Error('render failed');
    }
  }

  purge(el: HTMLElement): void {
    this.purgeCalls.push(el);
  }

  resize(el: HTMLElement): void {
    this.resizeCalls.push(el);
  }

  onClick(_el: HTMLElement, handler: (event: PlotMouseEvent) => void): void {
    this.clickHandler = handler;
  }

  onHover(_el: HTMLElement, handler: (event: PlotHoverEvent) => void): void {
    this.hoverHandler = handler;
  }

  onWebglContextLost(): void {}

  fireClick(event: PlotMouseEvent): void {
    this.clickHandler?.(event);
  }

  fireHover(event: PlotHoverEvent): void {
    this.hoverHandler?.(event);
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function createChart(runtime: FakePlotlyRuntime, data: Data[]) {
  TestBed.configureTestingModule({ providers: [{ provide: PlotlyRuntime, useValue: runtime }] });
  const fixture = TestBed.createComponent(PlotlyChart);
  fixture.componentRef.setInput('data', data);
  fixture.detectChanges();
  await waitUntil(() => runtime.renderCalls.length > 0);
  return fixture;
}

describe('PlotlyChart', () => {
  it('renders through the injected runtime instead of touching Plotly directly', async () => {
    const runtime = new FakePlotlyRuntime();
    await createChart(runtime, [{ type: 'scatter', x: [1], y: [1] }]);
    expect(runtime.renderCalls[0].data).toEqual([{ type: 'scatter', x: [1], y: [1] }]);
    expect(runtime.resizeCalls).toEqual([runtime.renderCalls[0].el]);
  });

  it('announces when the chart has rendered at its final container size', async () => {
    const runtime = new FakePlotlyRuntime();
    TestBed.configureTestingModule({ providers: [{ provide: PlotlyRuntime, useValue: runtime }] });
    const fixture = TestBed.createComponent(PlotlyChart);
    let rendered = false;
    fixture.componentInstance.rendered.subscribe(() => (rendered = true));
    fixture.componentRef.setInput('data', [{ type: 'scatter', x: [1], y: [1] }]);
    fixture.detectChanges();
    await waitUntil(() => rendered);
    expect(runtime.resizeCalls.length).toBe(1);
  });

  it('re-renders when the data input changes', async () => {
    const runtime = new FakePlotlyRuntime();
    const fixture = await createChart(runtime, [{ type: 'scatter', x: [1], y: [1] }]);
    const callsBefore = runtime.renderCalls.length;

    fixture.componentRef.setInput('data', [{ type: 'scatter', x: [2], y: [2] }]);
    fixture.detectChanges();
    await waitUntil(() => runtime.renderCalls.length > callsBefore);

    expect(runtime.renderCalls.at(-1)?.data).toEqual([{ type: 'scatter', x: [2], y: [2] }]);
  });

  it('forwards click events untouched', async () => {
    const runtime = new FakePlotlyRuntime();
    const fixture = await createChart(runtime, [{ type: 'scatter', x: [1], y: [1] }]);
    let received: PlotMouseEvent | undefined;
    fixture.componentInstance.pointClick.subscribe((event) => (received = event));

    const event = { points: [{ pointIndex: [1, 2] }] } as unknown as PlotMouseEvent;
    runtime.fireClick(event);
    expect(received).toBe(event);
  });

  it('emits renderFailed when the runtime throws', async () => {
    const runtime = new FakePlotlyRuntime();
    runtime.shouldFail = true;
    TestBed.configureTestingModule({ providers: [{ provide: PlotlyRuntime, useValue: runtime }] });
    const fixture = TestBed.createComponent(PlotlyChart);
    let failed = false;
    fixture.componentInstance.renderFailed.subscribe(() => (failed = true));
    fixture.componentRef.setInput('data', [{ type: 'scatter', x: [1], y: [1] }]);
    fixture.detectChanges();
    await waitUntil(() => failed);
    expect(failed).toBe(true);
  });

  it('purges the runtime on destroy', async () => {
    const runtime = new FakePlotlyRuntime();
    const fixture = await createChart(runtime, [{ type: 'scatter', x: [1], y: [1] }]);
    fixture.destroy();
    expect(runtime.purgeCalls.length).toBe(1);
  });
});
