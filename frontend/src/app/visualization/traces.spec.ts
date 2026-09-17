import {
  MAX_INTERACTIVE_SURFACE_CELLS,
  buildHeatmapTrace,
  buildLineTrace,
  buildSelectionTrace,
  buildSurfaceTrace,
  isSurfaceEligible,
  lineIndexToCell,
  matrixPointToCell,
  surfaceIneligibleReason,
} from './traces';
import type { types } from '../../../wailsjs/go/models';
import { valueColorscale, valueGradientColor } from './theme';

const axis = (overrides: Partial<types.AxisDetail> = {}): types.AxisDetail =>
  ({ units: '', formula: 'X', addressed: false, elementBits: 16, ...overrides }) as types.AxisDetail;

function rowVectorDetail(): types.MapDetail {
  return {
    id: 0,
    title: 'Row vector',
    description: '',
    categories: [],
    shape: 'one-axis',
    rows: 1,
    columns: 3,
    x: axis({ addressed: true }),
    y: axis(),
    z: axis(),
    xValues: [10, 20, 30],
    zValues: [[1, 2, 3]],
  } as unknown as types.MapDetail;
}

function columnVectorDetail(): types.MapDetail {
  return {
    id: 1,
    title: 'Column vector',
    description: '',
    categories: [],
    shape: 'one-axis',
    rows: 3,
    columns: 1,
    x: axis(),
    y: axis({ addressed: false }),
    z: axis(),
    zValues: [[1], [2], [3]],
  } as unknown as types.MapDetail;
}

function matrixDetail(overrides: Partial<types.MapDetail> = {}): types.MapDetail {
  return {
    id: 2,
    title: 'Matrix',
    description: '',
    categories: [],
    shape: 'matrix',
    rows: 2,
    columns: 2,
    x: axis({ addressed: true }),
    y: axis({ addressed: true }),
    z: axis(),
    xValues: [100, 200],
    yValues: [10, 20],
    zValues: [
      [1, 2],
      [3, 4],
    ],
    ...overrides,
  } as unknown as types.MapDetail;
}

describe('buildLineTrace', () => {
  it('uses addressed X values for a row vector', () => {
    const trace = buildLineTrace(rowVectorDetail()) as { x: number[]; y: number[] };
    expect(trace.x).toEqual([10, 20, 30]);
    expect(trace.y).toEqual([1, 2, 3]);
  });

  it('falls back to index labels for an unaddressed axis on a column vector', () => {
    const trace = buildLineTrace(columnVectorDetail()) as { x: number[]; y: number[] };
    expect(trace.x).toEqual([0, 1, 2]);
    expect(trace.y).toEqual([1, 2, 3]);
  });

  it('colors markers blue to red from the lowest through highest value', () => {
    const trace = buildLineTrace(rowVectorDetail()) as { marker: { color: string[] } };
    expect(trace.marker.color).toEqual([
      valueGradientColor(1, 1, 3),
      valueGradientColor(2, 1, 3),
      valueGradientColor(3, 1, 3),
    ]);
  });
});

describe('lineIndexToCell', () => {
  it('maps a row-vector index to column position', () => {
    expect(lineIndexToCell(rowVectorDetail(), 2)).toEqual({ row: 0, column: 2 });
  });

  it('maps a column-vector index to row position', () => {
    expect(lineIndexToCell(columnVectorDetail(), 2)).toEqual({ row: 2, column: 0 });
  });
});

describe('buildHeatmapTrace and buildSurfaceTrace', () => {
  it('use addressed axis values for both axes when available', () => {
    const heatmap = buildHeatmapTrace(matrixDetail()) as { x: number[]; y: number[]; z: number[][] };
    expect(heatmap.x).toEqual([100, 200]);
    expect(heatmap.y).toEqual([10, 20]);
    expect(heatmap.z).toEqual([
      [1, 2],
      [3, 4],
    ]);

    const surface = buildSurfaceTrace(matrixDetail()) as { x: number[]; y: number[] };
    expect(surface.x).toEqual([100, 200]);
    expect(surface.y).toEqual([10, 20]);
  });

  it('falls back to index labels when an axis is unaddressed', () => {
    const detail = matrixDetail({ x: axis({ addressed: false }) } as Partial<types.MapDetail>);
    const heatmap = buildHeatmapTrace(detail) as { x: number[] };
    expect(heatmap.x).toEqual([0, 1]);
  });

  it('falls back to complete index axes when addressed axis data is incomplete', () => {
    const detail = matrixDetail({ xValues: [100], yValues: [] } as Partial<types.MapDetail>);
    const heatmap = buildHeatmapTrace(detail) as { x: number[]; y: number[]; xgap: number; ygap: number };
    expect(heatmap).toMatchObject({ x: [0, 1], y: [0, 1], xgap: 1, ygap: 1 });
  });

  it('normalizes heatmap and surface colors to the same blue-to-red value range', () => {
    const heatmap = buildHeatmapTrace(matrixDetail()) as {
      colorscale: Array<[number, string]>;
      zmin: number;
      zmax: number;
    };
    const surface = buildSurfaceTrace(matrixDetail()) as {
      colorscale: Array<[number, string]>;
      cmin: number;
      cmax: number;
    };

    const colorscale = valueColorscale(1, 4);
    expect(heatmap).toMatchObject({ colorscale, zmin: 1, zmax: 4 });
    expect(surface).toMatchObject({ colorscale, cmin: 1, cmax: 4 });
    expect(colorscale[0][1]).toBe(valueGradientColor(1, 1, 4));
    expect(colorscale.at(-1)?.[1]).toBe(valueGradientColor(4, 1, 4));
  });
});

describe('matrixPointToCell', () => {
  it('reads a [row, column] pointIndex array', () => {
    expect(matrixPointToCell([1, 2])).toEqual({ row: 1, column: 2 });
  });

  it('returns null for a non-array pointIndex (e.g. a scatter trace)', () => {
    expect(matrixPointToCell(3)).toBeNull();
  });
});

describe('buildSelectionTrace', () => {
  it('places a heatmap selection outline at the selected cell coordinates', () => {
    const trace = buildSelectionTrace(matrixDetail(), 'heatmap', { row: 1, column: 0 }) as {
      x: number[]; y: number[]; customdata: number[][];
    };
    expect(trace).toMatchObject({ x: [100], y: [20], customdata: [[1, 0]] });
  });
});

describe('surface eligibility', () => {
  it('is eligible for a small matrix', () => {
    expect(isSurfaceEligible(matrixDetail())).toBe(true);
    expect(surfaceIneligibleReason(matrixDetail())).toBeNull();
  });

  it('is never eligible for a non-matrix shape', () => {
    expect(isSurfaceEligible(rowVectorDetail())).toBe(false);
    expect(surfaceIneligibleReason(rowVectorDetail())).toBeNull();
  });

  it('is ineligible above the interactive cell threshold, with a stated reason', () => {
    const side = Math.ceil(Math.sqrt(MAX_INTERACTIVE_SURFACE_CELLS)) + 1;
    const huge = matrixDetail({ rows: side, columns: side } as Partial<types.MapDetail>);
    expect(isSurfaceEligible(huge)).toBe(false);
    expect(surfaceIneligibleReason(huge)).toContain('3D is disabled');
  });
});
