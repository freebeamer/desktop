import type { Config, Layout } from 'plotly.js';

/**
 * Plotly renders to SVG and WebGL canvases, neither of which resolves CSS
 * custom properties, so the dark design tokens from styles.scss are
 * mirrored here as literal values. Keep these in sync with :root by hand —
 * V1 ships a single dark theme, so there is no light-mode variant to track.
 */
export const CHART_COLORS = {
  surfaceControl: '#1e242b',
  borderDefault: '#2c343d',
  borderStrong: '#343e49',
  textSecondary: '#aeb8c3',
  textTertiary: '#77828e',
  accent: '#2869ad',
  accentBright: '#68a9ec',
  statusValid: '#42aa75',
  statusWarning: '#d49a42',
  operatingPoint: '#e45cff',
} as const;

/** Builds Plotly's scale from the same value function used by table cells. */
export function valueColorscale(min: number, max: number): Array<[number, string]> {
  return Array.from({ length: 17 }, (_, index) => {
    const position = index / 16;
    const value = min + (max - min) * position;
    return [position, valueGradientColor(value, min, max)];
  });
}

export const VALUE_COLORSCALE = valueColorscale(0, 1);

export function chartLayout(overrides: Partial<Layout> = {}): Partial<Layout> {
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: CHART_COLORS.textSecondary, family: 'Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', size: 11 },
    margin: { l: 48, r: 16, t: 16, b: 40 },
    xaxis: { gridcolor: CHART_COLORS.borderDefault, zerolinecolor: CHART_COLORS.borderStrong, linecolor: CHART_COLORS.borderStrong },
    yaxis: { gridcolor: CHART_COLORS.borderDefault, zerolinecolor: CHART_COLORS.borderStrong, linecolor: CHART_COLORS.borderStrong },
    autosize: true,
    ...overrides,
  };
}

export const CHART_CONFIG: Partial<Config> = {
  displaylogo: false,
  responsive: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d'],
};

/**
 * Negative values remain blue: the lowest is darkest and zero is brightest.
 * Positive values transition from bright blue to red at the positive maximum.
 */
export function valueGradientColor(value: number, min: number, max: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return CHART_COLORS.surfaceControl;
  }
  if (max === min) {
    if (value < 0) return 'hsl(216.0, 65%, 12.0%)';
    if (value === 0) return 'hsl(216.0, 65%, 32.0%)';
    return 'hsl(0.0, 65%, 28.0%)';
  }
  if (value <= 0 && min < 0) {
    const t = Math.min(1, Math.max(0, (value - min) / -min));
    return `hsl(216.0, 65%, ${(12 + 20 * t).toFixed(1)}%)`;
  }
  const start = min >= 0 ? min : 0;
  const t = Math.min(1, Math.max(0, (value - start) / (max - start)));
  const hue = 216 - 216 * t; // conventional ECU blue -> green -> yellow -> red
  return `hsl(${hue.toFixed(1)}, 65%, ${(32 - 4 * t).toFixed(1)}%)`;
}
