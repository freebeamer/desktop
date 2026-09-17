import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { PlotlyChart } from '../visualization/plotly-chart';
import { CHART_CONFIG, chartLayout } from '../visualization/theme';
import { LiveStore } from './live-store';
import { sourceKey } from './live-gateway';
import { liveTrace } from './live-traces';

@Component({
  selector: 'app-live-view',
  imports: [DatePipe, DecimalPipe, PlotlyChart],
  templateUrl: './live-view.html',
  styleUrl: './live-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveView {
  readonly store = inject(LiveStore);
  readonly config = CHART_CONFIG;
  readonly clientId = signal('');
  // Tracked as a signal (not read live off the DOM at template-eval
  // time) because this component is OnPush: an <input> with no
  // (input)/(change) binding never re-triggers change detection on its
  // own keystrokes, so a [disabled] expression reading pairingName's
  // raw .value would silently go stale — caught live by an actual
  // click-through of this form, not by a unit test.
  readonly pairingNameValue = signal('');
  readonly plotted = signal<string[] | null>(null);
  readonly chartError = signal(false);
  readonly devices = computed(() => [
    ...new Set(this.store.sources().map((source) => source.deviceId)),
  ]);
  readonly sessions = computed(() =>
    this.store.sources().filter((source) => source.deviceId === this.store.selected()?.deviceId),
  );
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

  constructor() {
    this.store.initialize();
  }

  async connect(
    url: HTMLInputElement,
    token: HTMLInputElement,
    client: HTMLSelectElement,
  ): Promise<void> {
    const secret = token.value;
    token.value = '';
    await this.store.connect(url.value.trim(), secret, client.value);
  }

  async createPairingLink(
    url: HTMLInputElement,
    token: HTMLInputElement,
    name: HTMLInputElement,
  ): Promise<void> {
    await this.store.createPairingLink(url.value.trim(), token.value, name.value.trim());
  }

  async copyPairingLink(deepLink: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(deepLink);
    } catch {
      // Clipboard access can be denied/unavailable; the link is still
      // shown in the panel for manual copy either way.
    }
  }

  chooseDevice(device: string): void {
    const source = this.store.sources().find((source) => source.deviceId === device);
    if (source) void this.store.select(source);
  }

  chooseSession(session: string): void {
    const source = this.sessions().find((source) => source.sessionId === session);
    if (source) void this.store.select(source);
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
