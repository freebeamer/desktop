import type { Data, Layout } from 'plotly.js';
import type { types } from '../../../wailsjs/go/models';
import { CHART_COLORS, chartLayout, valueColorscale, valueGradientColor } from './theme';

export interface CellPoint {
  row: number;
  column: number;
}

/** WebGL surfaces are disabled above this many cells until the real
 * threshold is established through profiling (docs/desktop-v1-plan.md
 * Phase 3): the largest map in the validated fixture is 20x20 (400 cells),
 * so 10,000 is a conservative ceiling rather than a measured one. */
export const MAX_INTERACTIVE_SURFACE_CELLS = 10_000;

function indexRange(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

function valueRange(values: number[]): { min: number; max: number } {
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** Line charts are the optional presentation for a one-axis map: a single
 * row (rows === 1) varies along X/columns, a single column (columns === 1)
 * varies along Y/rows. */
export function buildLineTrace(detail: types.MapDetail, range?: { min: number; max: number }): Data {
  const rowVector = detail.rows === 1;
  const values = rowVector ? detail.zValues![0] : detail.zValues!.map((row) => row[0]);
  const axis = rowVector ? detail.x : detail.y;
  const axisValues = rowVector ? detail.xValues : detail.yValues;
  const x = axis.addressed && axisValues ? axisValues : indexRange(values.length);
  const { min, max } = range ?? valueRange(values);
  return {
    type: 'scatter',
    mode: 'lines+markers',
    x,
    y: values,
    line: { color: CHART_COLORS.textTertiary, width: 2 },
    marker: { color: values.map((value) => valueGradientColor(value, min, max)), size: 7 },
    hovertemplate: '%{y}<extra></extra>',
  };
}

export function lineIndexToCell(detail: types.MapDetail, index: number): CellPoint {
  return detail.rows === 1 ? { row: 0, column: index } : { row: index, column: 0 };
}

export function lineLayout(detail: types.MapDetail): Partial<Layout> {
  const rowVector = detail.rows === 1;
  const axisUnits = (rowVector ? detail.x.units : detail.y.units) || 'index';
  return chartLayout({
    xaxis: { ...chartLayout().xaxis, title: { text: axisUnits } },
    yaxis: { ...chartLayout().yaxis, title: { text: detail.z.units || 'value' } },
  });
}

export function heatmapLayout(detail: types.MapDetail): Partial<Layout> {
  return chartLayout({
    margin: { l: 56, r: 18, t: 16, b: 72 },
    xaxis: { ...chartLayout().xaxis, automargin: true, title: { text: detail.x.units || 'index' } },
    yaxis: { ...chartLayout().yaxis, automargin: true, title: { text: detail.y.units || 'index' } },
  });
}

export function surfaceLayout(detail: types.MapDetail): Partial<Layout> {
  return chartLayout({
    scene: {
      xaxis: { title: { text: detail.x.units || 'index' }, gridcolor: CHART_COLORS.borderDefault, color: CHART_COLORS.textTertiary },
      yaxis: { title: { text: detail.y.units || 'index' }, gridcolor: CHART_COLORS.borderDefault, color: CHART_COLORS.textTertiary },
      zaxis: { title: { text: detail.z.units || 'value' }, gridcolor: CHART_COLORS.borderDefault, color: CHART_COLORS.textTertiary },
      bgcolor: 'rgba(0,0,0,0)',
    },
  });
}

function matrixAxisValues(detail: types.MapDetail): { x: number[]; y: number[] } {
  return {
    x: detail.x.addressed && detail.xValues?.length === detail.columns ? detail.xValues : indexRange(detail.columns),
    y: detail.y.addressed && detail.yValues?.length === detail.rows ? detail.yValues : indexRange(detail.rows),
  };
}

export function buildHeatmapTrace(detail: types.MapDetail, range?: { min: number; max: number }): Data {
  const { x, y } = matrixAxisValues(detail);
  const { min, max } = range ?? valueRange(detail.zValues!.flat());
  return {
    type: 'heatmap',
    z: detail.zValues!,
    x,
    y,
    colorscale: valueColorscale(min, max),
    zmin: min,
    zmax: max,
    zsmooth: false,
    xgap: 1,
    ygap: 1,
    connectgaps: false,
    showscale: true,
    colorbar: { orientation: 'h', thickness: 8, len: 0.72, x: 0.5, y: -0.2, title: { text: detail.z.units || 'value', side: 'right' } },
    hovertemplate: '%{z}<extra></extra>',
  };
}

export function buildSurfaceTrace(detail: types.MapDetail, range?: { min: number; max: number }): Data {
  const { x, y } = matrixAxisValues(detail);
  const { min, max } = range ?? valueRange(detail.zValues!.flat());
  const trace = {
    type: 'surface',
    z: detail.zValues!,
    x,
    y,
    colorscale: valueColorscale(min, max),
    cmin: min,
    cmax: max,
    showscale: false,
  };
  // Plotly surface traces support cmin/cmax at runtime, but the community
  // Data union used by this project omits those properties for this branch.
  return trace as unknown as Data;
}

export function buildSelectionTrace(
  detail: types.MapDetail,
  mode: 'grid' | 'line' | 'heatmap' | 'surface',
  cell: CellPoint | null,
): Data | null {
  if (!cell || mode === 'grid') return null;
  const { x, y } = matrixAxisValues(detail);
  const common = {
    mode: 'markers' as const,
    customdata: [[cell.row, cell.column]],
    hoverinfo: 'skip' as const,
    showlegend: false,
  };
  if (mode === 'line') {
    const rowVector = detail.rows === 1;
    const axis = rowVector ? detail.x : detail.y;
    const axisValues = rowVector ? detail.xValues : detail.yValues;
    const index = rowVector ? cell.column : cell.row;
    return {
      ...common, type: 'scatter', x: [axis.addressed && axisValues ? axisValues[index] : index],
      y: [detail.zValues![cell.row][cell.column]],
      marker: { size: 12, color: '#f5f9ff', symbol: 'circle-open', line: { width: 2, color: '#f5f9ff' } },
    } as Data;
  }
  if (mode === 'surface') {
    return {
      ...common, type: 'scatter3d', x: [x[cell.column]], y: [y[cell.row]], z: [detail.zValues![cell.row][cell.column]],
      marker: { size: 5, color: '#f5f9ff', line: { width: 2, color: '#1e242b' } },
    } as Data;
  }
  return {
    ...common, type: 'scatter', x: [x[cell.column]], y: [y[cell.row]],
    marker: { size: 18, color: 'rgba(0,0,0,0)', symbol: 'square-open', line: { width: 2, color: '#f5f9ff' } },
  } as Data;
}

/** Plotly's community type definitions type pointIndex as a plain number,
 * but heatmap/surface traces report it as [row, column] at runtime — the
 * exact convention DecodedTable.Z already uses, so no transposition needed. */
export function matrixPointToCell(pointIndex: unknown): CellPoint | null {
  if (Array.isArray(pointIndex) && pointIndex.length === 2) {
    const [row, column] = pointIndex as [number, number];
    return { row, column };
  }
  return null;
}

export function isSurfaceEligible(detail: types.MapDetail): boolean {
  return detail.shape === 'matrix' && detail.rows * detail.columns <= MAX_INTERACTIVE_SURFACE_CELLS;
}

export function surfaceIneligibleReason(detail: types.MapDetail): string | null {
  if (detail.shape !== 'matrix' || isSurfaceEligible(detail)) {
    return null;
  }
  return `This map has ${detail.rows * detail.columns} cells; 3D is disabled above ${MAX_INTERACTIVE_SURFACE_CELLS} cells for interactivity. Use the heatmap or grid instead.`;
}
