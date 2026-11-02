import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { PlotlyChart } from '../visualization/plotly-chart';
import { CHART_CONFIG, chartLayout } from '../visualization/theme';
import { LiveStore } from './live-store';
import { sourceKey } from './live-gateway';
import { liveTrace } from './live-traces';

@Component({
  selector: 'app-live-view',
  imports: [DecimalPipe, PlotlyChart],
  templateUrl: './live-view.html',
  styleUrl: './live-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveView {
  readonly store = inject(LiveStore);
  readonly config = CHART_CONFIG;
  readonly plotted = signal<string[] | null>(null);
  readonly chartError = signal(false);
  readonly devices = computed(() => [
    ...new Set(this.store.sources().map((source) => source.deviceId)),
  ]);
  readonly channels = computed(() => {
    const metadata = this.store.catalog()?.channels ?? [];
    const ids = new Set([
      ...metadata.map((channel) => channel.id),
      ...Object.keys(this.store.latest()?.values ?? {}),
    ]);
    return [...ids].map(
      (id) =>
        metadata.find((channel) => channel.id === id) ?? {
          id,
          label: id,
          unit: 'unknown unit',
          sourceUnit: '',
          validation: 'unknown',
        },
    );
  });
  readonly plots = computed(() => {
    const chosen =
      this.plotted() ??
      this.channels()
        .slice(0, 1)
        .map((channel) => channel.id);
    return chosen.map((id) => {
      const channel = this.channels().find((channel) => channel.id === id);
      return {
        id,
        title: `${channel?.label ?? id} · ${channel?.unit || 'unitless'}`,
        data: liveTrace(this.store.history(), id),
        layout: chartLayout({
          height: 250,
          showlegend: false,
          uirevision: sourceKey(this.store.selected() ?? { deviceId: '', sessionId: '' }) + id,
          xaxis: { type: 'date', title: { text: 'Acquisition time' }, gridcolor: '#2c343d' },
          yaxis: { title: { text: channel?.unit ?? 'unknown unit' }, gridcolor: '#2c343d' },
        }),
      };
    });
  });

  chooseDevice(device: string): void {
    void this.store.selectDevice(device);
  }

  togglePlot(id: string): void {
    const current = this.plots().map((plot) => plot.id);
    this.plotted.set(
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id].slice(-4),
    );
    this.chartError.set(false);
  }

  isPlotted(id: string): boolean {
    return this.plots().some((plot) => plot.id === id);
  }
  retryTime(): string {
    const until = this.store.status().backoffUntil;
    return until ? new Date(until).toLocaleTimeString() : '';
  }
}
