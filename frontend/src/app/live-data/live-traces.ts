import type { Data } from 'plotly.js';
import { LiveSample } from './live-gateway';
import { STALE_MS } from './live-store';

export function liveTrace(samples: LiveSample[], channel: string): Data[] {
  const x: string[] = [];
  const y: (number | null)[] = [];
  let previous: LiveSample | undefined;
  for (const sample of samples) {
    if (
      previous &&
      (sample.gapBefore > 0 ||
        Date.parse(sample.timestamp) <= Date.parse(previous.timestamp) ||
        Date.parse(sample.timestamp) - Date.parse(previous.timestamp) > STALE_MS)
    ) {
      x.push(sample.timestamp);
      y.push(null);
    }
    x.push(sample.timestamp);
    const value = sample.values[channel];
    y.push(Number.isFinite(value) ? value : null);
    previous = sample;
  }
  return [
    {
      type: 'scatter',
      mode: 'lines',
      x,
      y,
      connectgaps: false,
      name: channel,
      line: { color: '#68a9ec', width: 2 },
    },
  ];
}
