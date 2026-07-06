// ============================================================
// charts.test.js — The canvas chart tier renders real PNGs.
// We can't eyeball pixels in a test, but we CAN prove the
// contract: valid PNG bytes, the canonical dimensions, and the
// null returns commands rely on for their sparkline fallbacks.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTimeSeries, renderBarChart } from '../src/lib/charts.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Width/height live in the IHDR chunk, big-endian, right after the
// signature + chunk header (offsets 16 and 20).
function pngDimensions(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const SERIES = [
  {
    label: 'Cesar',
    points: [
      { day: '2026-07-01', value: 500 },
      { day: '2026-07-02', value: 750 },
      { day: '2026-07-03', value: 620 },
      { day: '2026-07-04', value: 1_100 },
    ],
  },
];

test('renderTimeSeries produces a valid 800x320 PNG', async () => {
  const png = await renderTimeSeries('net worth', SERIES);
  assert.ok(Buffer.isBuffer(png), 'should return a Buffer');
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE), 'should start with the PNG signature');
  assert.deepEqual(pngDimensions(png), { width: 800, height: 320 });
});

test('renderTimeSeries handles multiple series, flat lines, and single points', async () => {
  const png = await renderTimeSeries('versus', [
    ...SERIES,
    { label: 'Alex', points: [{ day: '2026-07-02', value: 500 }] },     // single point → dot
    { label: 'Sam', points: [{ day: '2026-07-01', value: 300 }, { day: '2026-07-04', value: 300 }] }, // flat
  ]);
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
});

test('renderTimeSeries returns null when there is nothing to draw', async () => {
  // The commands' sparkline fallback keys off this.
  assert.equal(await renderTimeSeries('empty', []), null);
  assert.equal(await renderTimeSeries('empty', [{ label: 'x', points: [] }]), null);
});

test('renderBarChart produces a valid PNG and tolerates zero values', async () => {
  const png = await renderBarChart('flow', [
    { label: 'Minted', value: 5_000 },
    { label: 'Burned', value: 0 }, // a zero bar must not divide by zero
  ]);
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
  assert.deepEqual(pngDimensions(png), { width: 800, height: 320 });
});

test('renderBarChart returns null for an empty list', async () => {
  assert.equal(await renderBarChart('empty', []), null);
});
