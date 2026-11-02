import { describe, expect, it } from 'vitest';
import type { LiveSample } from '../live-data/live-gateway';
import type { types } from '../../../wailsjs/go/models';
import { buildOperatingPointTrace } from '../visualization/traces';
import { describeReading, locateOnAxis, operatingPoint, OverlayBinding, OverlayMap } from './operating-point';

const source = { deviceId: 'phone', sessionId: 'session-1' };
const sample = (values: Record<string, number>, overrides: Partial<LiveSample> = {}): LiveSample => ({
  ...source, sequence: 1, timestamp: '2026-10-13T00:00:00Z', values, backfill: false, gapBefore: 0, ...overrides,
});
const rpm: OverlayBinding = { axis: 'x', channelId: 'RPM', scale: 1, offset: 0 };
const load: OverlayBinding = { axis: 'y', channelId: 'LOAD', scale: 1, offset: 0 };
const matrix: OverlayMap = { rows: 3, columns: 4, xValues: [1000, 2000, 3000, 4000], yValues: [20, 50, 80] };

describe('locateOnAxis', () => {
  it('brackets values between ascending breakpoints', () => {
    expect(locateOnAxis([1000, 2000, 3000], 2500)).toEqual({ kind: 'inside', lower: 1, upper: 2, fraction: 0.5 });
  });

  it('brackets values between descending breakpoints', () => {
    expect(locateOnAxis([3000, 2000, 1000], 2500)).toEqual({ kind: 'inside', lower: 0, upper: 1, fraction: 0.5 });
    expect(locateOnAxis([3000, 2000, 1000], 1250)).toEqual({ kind: 'inside', lower: 1, upper: 2, fraction: 0.75 });
  });

  it('places exact boundaries on one breakpoint, including both edges', () => {
    expect(locateOnAxis([1000, 2000, 3000], 1000)).toEqual({ kind: 'inside', lower: 0, upper: 0, fraction: 0 });
    expect(locateOnAxis([1000, 2000, 3000], 2000)).toEqual({ kind: 'inside', lower: 1, upper: 1, fraction: 0 });
    expect(locateOnAxis([3000, 2000, 1000], 1000)).toEqual({ kind: 'inside', lower: 2, upper: 2, fraction: 0 });
  });

  it('reports out-of-range values instead of clamping them', () => {
    expect(locateOnAxis([1000, 2000, 3000], 999)).toEqual({ kind: 'below', limit: 1000 });
    expect(locateOnAxis([1000, 2000, 3000], 3001)).toEqual({ kind: 'above', limit: 3000 });
    expect(locateOnAxis([3000, 2000, 1000], 3500)).toEqual({ kind: 'above', limit: 3000 });
    expect(locateOnAxis([3000, 2000, 1000], 500)).toEqual({ kind: 'below', limit: 1000 });
  });

  it('rejects repeated, non-monotonic and non-numeric axes', () => {
    expect(locateOnAxis([1000, 1000, 2000], 1500).kind).toBe('invalid');
    expect(locateOnAxis([1000, 2000, 2000], 1500).kind).toBe('invalid');
    expect(locateOnAxis([1000, 3000, 2000], 1500).kind).toBe('invalid');
    expect(locateOnAxis([1000, NaN, 2000], 1500).kind).toBe('invalid');
    expect(locateOnAxis([1000], 1000).kind).toBe('invalid');
  });
});

describe('operatingPoint', () => {
  it('replays a deterministic sample sequence onto expected cells', () => {
    const replay: [Record<string, number>, ReturnType<typeof operatingPoint>['kind'], unknown][] = [
      [{ RPM: 1000, LOAD: 20 }, 'point', { rows: [0, 0], columns: [0, 0] }],
      [{ RPM: 1500, LOAD: 35 }, 'point', { rows: [0, 1], columns: [0, 1] }],
      [{ RPM: 3000, LOAD: 80 }, 'point', { rows: [2, 2], columns: [2, 2] }],
      [{ RPM: 3999, LOAD: 79 }, 'point', { rows: [1, 2], columns: [2, 3] }],
      [{ RPM: 4500, LOAD: 50 }, 'point', null],
    ];
    replay.forEach(([values, kind, cells], sequence) => {
      const point = operatingPoint(matrix, [rpm, load], sample(values, { sequence }), source, 'Fresh');
      expect(point.kind).toBe(kind);
      expect(point.kind === 'point' && point.cells).toEqual(cells);
    });
  });

  it('applies the binding unit conversion before locating', () => {
    const kpa: OverlayBinding = { axis: 'y', channelId: 'LOAD', scale: 10, offset: -5 };
    const point = operatingPoint(matrix, [rpm, kpa], sample({ RPM: 2000, LOAD: 5.5 }), source, 'Fresh');
    expect(point.kind === 'point' && point.readings[1]).toMatchObject({ measured: 5.5, value: 50 });
  });

  it('uses only the axes a one-axis map varies along', () => {
    const row: OverlayMap = { rows: 1, columns: 3, xValues: [1000, 2000, 3000] };
    const point = operatingPoint(row, [rpm], sample({ RPM: 2500 }), source, 'Fresh');
    expect(point.kind === 'point' && point.cells).toEqual({ rows: [0, 0], columns: [1, 2] });
    const column: OverlayMap = { rows: 3, columns: 1, yValues: [20, 50, 80] };
    expect(operatingPoint(column, [rpm], sample({ RPM: 2500 }), source, 'Fresh')).toMatchObject({ kind: 'unavailable' });
  });

  it('requires a coherent sample with every bound channel', () => {
    const point = operatingPoint(matrix, [rpm, load], sample({ RPM: 2000 }), source, 'Fresh');
    expect(point).toEqual({ kind: 'unavailable', reason: 'LOAD is missing from the latest sample.' });
  });

  it('requires both axes of a matrix to be bound', () => {
    expect(operatingPoint(matrix, [rpm], sample({ RPM: 2000, LOAD: 50 }), source, 'Fresh')).toMatchObject({ kind: 'unavailable' });
  });

  it('hides the point for stale, offline, missing or old-session readings', () => {
    const values = { RPM: 2000, LOAD: 50 };
    expect(operatingPoint(matrix, [rpm, load], null, source, 'Waiting for samples').kind).toBe('unavailable');
    expect(operatingPoint(matrix, [rpm, load], sample(values), source, 'Stale').kind).toBe('unavailable');
    expect(operatingPoint(matrix, [rpm, load], sample(values), source, 'Offline · last reading').kind).toBe('unavailable');
    expect(operatingPoint(matrix, [rpm, load], sample(values, { sessionId: 'session-0' }), source, 'Fresh').kind).toBe('unavailable');
  });

  it('refuses ambiguous axes', () => {
    const repeated = { ...matrix, xValues: [1000, 2000, 2000, 4000] };
    expect(operatingPoint(repeated, [rpm, load], sample({ RPM: 2500, LOAD: 50 }), source, 'Fresh')).toMatchObject({ kind: 'unavailable' });
  });
});

describe('describeReading', () => {
  it('describes bracketing and out-of-range readings', () => {
    const breakpoints = [1000, 2000, 3000];
    const reading = (value: number) => ({ axis: 'x' as const, channelId: 'RPM', measured: value, value, position: locateOnAxis(breakpoints, value) });
    expect(describeReading(reading(2500), breakpoints, 'rpm')).toBe('X RPM = 2500 rpm: between 2000 and 3000');
    expect(describeReading(reading(2000), breakpoints, 'rpm')).toBe('X RPM = 2000 rpm: on breakpoint 2000');
    expect(describeReading(reading(3500), breakpoints, 'rpm')).toBe('X RPM = 3500 rpm: above the axis maximum 3000 (not clamped)');
  });
});

describe('buildOperatingPointTrace', () => {
  const detail = (addressed: boolean) => ({
    rows: 3, columns: 4, xValues: matrix.xValues, yValues: matrix.yValues,
    x: { addressed }, y: { addressed }, zValues: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
  }) as unknown as types.MapDetail;
  const point = (rpmValue: number) => operatingPoint(matrix, [rpm, load], sample({ RPM: rpmValue, LOAD: 35 }), source, 'Fresh');

  it('marks heatmaps at measured values on addressed axes', () => {
    expect(buildOperatingPointTrace(detail(true), 'heatmap', point(1500), { min: 0, max: 1 })).toMatchObject({ x: [1500], y: [35] });
  });

  it('uses fractional cell indices when the chart plots indices', () => {
    expect(buildOperatingPointTrace(detail(false), 'heatmap', point(1500), { min: 0, max: 1 })).toMatchObject({ x: [0.5], y: [0.5] });
  });

  it('draws no marker for out-of-range points or 3D surfaces', () => {
    expect(buildOperatingPointTrace(detail(true), 'heatmap', point(5000), { min: 0, max: 1 })).toBeNull();
    expect(buildOperatingPointTrace(detail(true), 'surface', point(1500), { min: 0, max: 1 })).toBeNull();
  });
});
