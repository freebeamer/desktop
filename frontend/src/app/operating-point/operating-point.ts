import type { LiveSample } from '../live-data/live-gateway';

/** Where a measured value falls on one axis's decoded breakpoints. This is a
 * position derived from measured values, not the ECU's own cell selection or
 * interpolation, which FreeBeamer does not know. */
export type AxisPosition =
  | { kind: 'inside'; lower: number; upper: number; fraction: number }
  | { kind: 'below' | 'above'; limit: number }
  | { kind: 'invalid'; reason: string };

export function locateOnAxis(breakpoints: readonly number[], value: number): AxisPosition {
  if (breakpoints.length < 2 || breakpoints.some((point) => !Number.isFinite(point))) {
    return { kind: 'invalid', reason: 'axis has no numeric breakpoints' };
  }
  const direction = Math.sign(breakpoints[1] - breakpoints[0]);
  for (let i = 1; i < breakpoints.length; i++) {
    if (direction === 0 || Math.sign(breakpoints[i] - breakpoints[i - 1]) !== direction) {
      return { kind: 'invalid', reason: 'axis breakpoints are repeated or non-monotonic' };
    }
  }
  const min = Math.min(breakpoints[0], breakpoints.at(-1)!);
  const max = Math.max(breakpoints[0], breakpoints.at(-1)!);
  // Out-of-range values are reported, never clamped onto an edge cell.
  if (value < min) return { kind: 'below', limit: min };
  if (value > max) return { kind: 'above', limit: max };
  const exact = breakpoints.indexOf(value);
  if (exact >= 0) return { kind: 'inside', lower: exact, upper: exact, fraction: 0 };
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const a = breakpoints[i];
    const b = breakpoints[i + 1];
    if ((value - a) * (value - b) < 0) {
      return { kind: 'inside', lower: i, upper: i + 1, fraction: (value - a) / (b - a) };
    }
  }
  return { kind: 'invalid', reason: 'value could not be placed on the axis' };
}

export interface OverlayBinding {
  axis: 'x' | 'y';
  channelId: string;
  scale: number;
  offset: number;
}

export interface OverlayMap {
  rows: number;
  columns: number;
  xValues?: number[];
  yValues?: number[];
}

export interface OverlaySource {
  deviceId: string;
  sessionId: string;
}

export interface AxisReading {
  axis: 'x' | 'y';
  channelId: string;
  measured: number;
  value: number;
  position: AxisPosition;
}

export type OperatingPoint =
  | { kind: 'unavailable'; reason: string }
  | {
      kind: 'point';
      readings: AxisReading[];
      /** Bracketing cells, or null when any reading is outside its axis. */
      cells: { rows: [number, number]; columns: [number, number] } | null;
    };

/** Axes that vary across this map, i.e. that the operating point must bind. */
export function requiredAxes(map: OverlayMap): ('x' | 'y')[] {
  const axes: ('x' | 'y')[] = [];
  if (map.columns > 1) axes.push('x');
  if (map.rows > 1) axes.push('y');
  return axes;
}

/**
 * Places one coherent sample on a map. Every axis reading comes from the same
 * sample: if the latest sample lacks a bound channel, the point is
 * unavailable rather than mixing in an older reading.
 */
export function operatingPoint(
  map: OverlayMap,
  bindings: readonly OverlayBinding[],
  sample: LiveSample | null,
  source: OverlaySource,
  freshness: string,
): OperatingPoint {
  const axes = requiredAxes(map);
  const missing = axes.filter((axis) => !bindings.some((binding) => binding.axis === axis));
  if (!axes.length) return { kind: 'unavailable', reason: 'This map has no varying axis.' };
  if (missing.length) {
    return { kind: 'unavailable', reason: `Bind the ${missing.join(' and ')} axis in the associated profile.` };
  }
  if (!sample) return { kind: 'unavailable', reason: 'Waiting for live samples.' };
  if (sample.deviceId !== source.deviceId || sample.sessionId !== source.sessionId) {
    return { kind: 'unavailable', reason: 'Latest reading belongs to a different session.' };
  }
  if (freshness !== 'Fresh') return { kind: 'unavailable', reason: `Readings unavailable: ${freshness}.` };

  const readings: AxisReading[] = [];
  for (const axis of axes) {
    const binding = bindings.find((item) => item.axis === axis)!;
    const measured = sample.values?.[binding.channelId];
    if (typeof measured !== 'number' || !Number.isFinite(measured)) {
      return { kind: 'unavailable', reason: `${binding.channelId} is missing from the latest sample.` };
    }
    const breakpoints = (axis === 'x' ? map.xValues : map.yValues) ?? [];
    if (breakpoints.length !== (axis === 'x' ? map.columns : map.rows)) {
      return { kind: 'unavailable', reason: `The ${axis} axis has no decoded breakpoints.` };
    }
    const value = measured * binding.scale + binding.offset;
    const position = locateOnAxis(breakpoints, value);
    if (position.kind === 'invalid') {
      return { kind: 'unavailable', reason: `The ${axis} axis cannot be used: ${position.reason}.` };
    }
    readings.push({ axis, channelId: binding.channelId, measured, value, position });
  }
  const inside = (axis: 'x' | 'y'): [number, number] | null => {
    const position = readings.find((reading) => reading.axis === axis)?.position;
    if (!position) return [0, 0];
    return position.kind === 'inside' ? [position.lower, position.upper] : null;
  };
  const columns = inside('x');
  const rows = inside('y');
  return { kind: 'point', readings, cells: rows && columns ? { rows, columns } : null };
}

const format = (value: number) => Number(value.toPrecision(6)).toString();

/** One reading as text, stating out-of-range values instead of hiding them. */
export function describeReading(reading: AxisReading, breakpoints: readonly number[], unit: string): string {
  const suffix = unit ? ` ${unit}` : '';
  const head = `${reading.axis.toUpperCase()} ${reading.channelId} = ${format(reading.value)}${suffix}`;
  const position = reading.position;
  switch (position.kind) {
    case 'inside':
      return position.lower === position.upper
        ? `${head}: on breakpoint ${format(breakpoints[position.lower])}`
        : `${head}: between ${format(breakpoints[position.lower])} and ${format(breakpoints[position.upper])}`;
    case 'below':
      return `${head}: below the axis minimum ${format(position.limit)} (not clamped)`;
    case 'above':
      return `${head}: above the axis maximum ${format(position.limit)} (not clamped)`;
    default:
      return `${head}: ${position.reason}`;
  }
}
