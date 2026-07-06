// ============================================================
// gini.js (lib) — The Gini coefficient: the standard 0..1
// measure of inequality (0 = everyone equal, →1 = one person
// has everything). THE headline number when friends cry
// "rigged economy!". Pure and tested against known
// distributions.
// ============================================================

/**
 * Gini coefficient of a set of holdings, via the standard sorted
 * formula: G = (2·Σ i·xᵢ)/(n·Σ xᵢ) − (n+1)/n  (i is 1-based rank).
 *
 * Conventions for our data: negative worth (deep loan debt) is clamped
 * to 0 — Gini is only defined for non-negative values, and "broke" is
 * broke. Empty input, a single holder, or an all-zero economy return 0
 * (no inequality to measure).
 */
export function gini(values) {
  const xs = values.map((v) => Math.max(0, v)).sort((a, b) => a - b);
  const n = xs.length;
  if (n <= 1) return 0;

  const total = xs.reduce((sum, x) => sum + x, 0);
  if (total === 0) return 0;

  let rankWeighted = 0;
  for (let i = 0; i < n; i++) {
    rankWeighted += (i + 1) * xs[i];
  }
  return (2 * rankWeighted) / (n * total) - (n + 1) / n;
}
