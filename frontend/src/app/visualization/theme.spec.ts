import { CHART_COLORS, valueGradientColor } from './theme';

describe('valueGradientColor', () => {
  it('returns pure blue at the minimum and pure red at the maximum', () => {
    expect(valueGradientColor(0, 0, 10)).toBe('hsl(216.0, 65%, 32.0%)');
    expect(valueGradientColor(10, 0, 10)).toBe('hsl(0.0, 65%, 28.0%)');
  });

  it('interpolates the hue for a value in between', () => {
    expect(valueGradientColor(5, 0, 10)).toBe('hsl(108.0, 65%, 30.0%)');
  });

  it('clamps a value outside the range instead of extrapolating the hue', () => {
    expect(valueGradientColor(-5, 0, 10)).toBe(valueGradientColor(0, 0, 10));
    expect(valueGradientColor(15, 0, 10)).toBe(valueGradientColor(10, 0, 10));
  });

  it('treats a constant finite map as entirely at its maximum', () => {
    expect(valueGradientColor(5, 5, 5)).toBe('hsl(0.0, 65%, 28.0%)');
  });

  it('uses a dark-to-bright blue gradient from the negative minimum to zero', () => {
    expect(valueGradientColor(-10, -10, 5)).toBe('hsl(216.0, 65%, 12.0%)');
    expect(valueGradientColor(-5, -10, 5)).toBe('hsl(216.0, 65%, 22.0%)');
    expect(valueGradientColor(0, -10, 5)).toBe('hsl(216.0, 65%, 32.0%)');
  });

  it('falls back to the neutral surface color for a non-finite value', () => {
    expect(valueGradientColor(Number.NaN, 0, 10)).toBe(CHART_COLORS.surfaceControl);
  });
});
