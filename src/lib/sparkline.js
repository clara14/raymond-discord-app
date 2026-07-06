// ============================================================
// sparkline.js (lib) — Unicode sparklines: ▁▂▄▇█ trends that
// live happily inside a Discord embed. Zero dependencies —
// the spec's v1 charting tier. Bucket → normalize → map to
// the eight block glyphs.
// ============================================================

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * Renders values as a sparkline of at most `width` characters.
 * More values than width → averaged into width buckets (so long
 * histories compress instead of truncating). A flat series renders as
 * a level mid-height line; empty input renders as an empty string.
 */
export function sparkline(values, width = 24) {
  if (!Array.isArray(values) || values.length === 0) return '';

  // Bucket down to `width` points by averaging each slice.
  let points = values;
  if (values.length > width) {
    points = [];
    const per = values.length / width;
    for (let i = 0; i < width; i++) {
      const start = Math.floor(i * per);
      const end = Math.max(Math.floor((i + 1) * per), start + 1);
      const slice = values.slice(start, end);
      points.push(slice.reduce((sum, v) => sum + v, 0) / slice.length);
    }
  }

  const min = Math.min(...points);
  const max = Math.max(...points);

  // Flat line (including a single point): level, mid-height. Rendering
  // relative change, not absolute value, is what sparklines are for.
  if (max === min) return BLOCKS[3].repeat(points.length);

  return points
    .map((v) => BLOCKS[Math.min(7, Math.floor(((v - min) / (max - min)) * 8))])
    .join('');
}
