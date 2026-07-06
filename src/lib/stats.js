// ============================================================
// stats.js (lib) — Small pure statistics helpers for the
// analytics module: mean, interpolated median, and percentile
// rank. Kept in JS (not percentile_cont in SQL) so they're
// unit-testable against hand-computed fixtures.
// ============================================================

/** Arithmetic mean; 0 for empty input. */
export function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Median with linear interpolation between the two middle values for
 * even counts — the same convention as SQL's percentile_cont(0.5).
 */
export function median(values) {
  if (values.length === 0) return 0;
  const xs = [...values].sort((a, b) => a - b);
  const mid = (xs.length - 1) / 2;
  const lo = Math.floor(mid);
  const hi = Math.ceil(mid);
  return (xs[lo] + xs[hi]) / 2;
}

/**
 * What fraction (0..100) of `values` sit strictly below `x` — the
 * "richer than N% of members" number. Ties don't count as beaten:
 * being exactly median-rich beats half of… no one at that value.
 */
export function percentileRank(values, x) {
  if (values.length === 0) return 0;
  const below = values.filter((v) => v < x).length;
  return (below / values.length) * 100;
}
