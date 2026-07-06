// ============================================================
// charts.js (lib) — The v2 chart tier: real PNG images via
// @napi-rs/canvas (prebuilt binaries, no node-gyp). EXACTLY two
// chart functions, per the spec — a time series and a bar
// chart. Resist the urge to grow a charting framework; if a
// third shape is ever needed, that's a design conversation.
//
// Both render dark-surface cards tuned for Discord embeds and
// return PNG Buffers (attach + embed.setImage('attachment://')).
// Callers should try/catch and fall back to sparklines — a
// rendering failure must never kill a command.
// ============================================================

import { createCanvas } from '@napi-rs/canvas';

// One canonical size: reads well on desktop, scales fine on mobile.
const W = 800;
const H = 320;
const PAD = { top: 44, right: 28, bottom: 40, left: 72 };

// Discord-dark palette. BG matches the embed surface so the card
// floats; series colors start with economy gold.
const BG = '#2b2d31';
const TEXT = '#b5bac1';
const GRID = 'rgba(255, 255, 255, 0.08)';
const SERIES_COLORS = ['#f1c40f', '#3498db', '#2ecc71', '#e74c3c'];

// Shared scaffolding: dark card, title, and the plot rectangle.
function makeCard(title) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = TEXT;
  ctx.font = '600 16px sans-serif';
  ctx.fillText(title, PAD.left, 26);

  return {
    canvas,
    ctx,
    plot: {
      x: PAD.left,
      y: PAD.top,
      w: W - PAD.left - PAD.right,
      h: H - PAD.top - PAD.bottom,
    },
  };
}

// Horizontal gridlines + y-axis labels for a value range.
function drawYAxis(ctx, plot, min, max, ticks = 4) {
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= ticks; i++) {
    const v = min + ((max - min) * i) / ticks;
    const y = plot.y + plot.h - (plot.h * i) / ticks;
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
    ctx.fillStyle = TEXT;
    ctx.fillText(Math.round(v).toLocaleString(), plot.x - 8, y + 4);
  }
  ctx.textAlign = 'left';
}

/**
 * A time-series chart. `series` = [{ label, points: [{ day, value }] }]
 * with day as 'YYYY-MM-DD'; multiple series share one time axis (the
 * /compare case). Returns a PNG Buffer, or null when there's nothing
 * to draw — the caller keeps its sparkline fallback for that.
 */
export async function renderTimeSeries(title, series) {
  const drawable = (series ?? []).filter((s) => s.points.length > 0);
  if (drawable.length === 0) return null;

  const { canvas, ctx, plot } = makeCard(title);

  // Shared domains across every series: time on x, value on y.
  const allPoints = drawable.flatMap((s) => s.points);
  const times = allPoints.map((p) => Date.parse(p.day));
  const values = allPoints.map((p) => p.value);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  let vMin = Math.min(...values, 0); // anchor 0 — wealth charts lie without it
  let vMax = Math.max(...values);
  if (vMax === vMin) vMax = vMin + 1; // flat/single-point guard

  drawYAxis(ctx, plot, vMin, vMax);

  const xOf = (t) => (tMax === tMin ? plot.x + plot.w / 2 : plot.x + ((t - tMin) / (tMax - tMin)) * plot.w);
  const yOf = (v) => plot.y + plot.h - ((v - vMin) / (vMax - vMin)) * plot.h;

  drawable.forEach((s, i) => {
    const color = s.color ?? SERIES_COLORS[i % SERIES_COLORS.length];
    const pts = s.points.map((p) => ({ x: xOf(Date.parse(p.day)), y: yOf(p.value) }));

    if (pts.length === 1) {
      // A single close: a dot says more than an invisible zero-length line.
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Area fill under the line — single-series only: overlapping fills
    // turn to mud where two lines cross, so head-to-heads stay lines.
    if (drawable.length === 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, yOf(Math.max(vMin, 0)));
      pts.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pts[pts.length - 1].x, yOf(Math.max(vMin, 0)));
      ctx.closePath();
      ctx.fillStyle = `${color}22`; // ~13% alpha hex suffix
      ctx.fill();
    }

    ctx.beginPath();
    pts.forEach((p, j) => (j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  });

  // X labels: first and last day (the middle rarely earns its clutter).
  ctx.fillStyle = TEXT;
  ctx.font = '11px sans-serif';
  ctx.fillText(new Date(tMin).toISOString().slice(0, 10), plot.x, H - 14);
  ctx.textAlign = 'right';
  ctx.fillText(new Date(tMax).toISOString().slice(0, 10), plot.x + plot.w, H - 14);
  ctx.textAlign = 'left';

  // Legend, only when there's more than one series to tell apart.
  if (drawable.length > 1) {
    let lx = plot.x + plot.w;
    // Right-aligned: measure first, then draw left-to-right.
    const entries = drawable.map((s, i) => ({
      label: s.label,
      color: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length],
      width: ctx.measureText(s.label).width + 26,
    }));
    lx -= entries.reduce((sum, e) => sum + e.width, 0);
    for (const e of entries) {
      ctx.fillStyle = e.color;
      ctx.fillRect(lx, 18, 10, 10);
      ctx.fillStyle = TEXT;
      ctx.fillText(e.label, lx + 16, 27);
      lx += e.width;
    }
  }

  return canvas.encode('png');
}

/**
 * A bar chart. `bars` = [{ label, value, color? }]. Values ≥ 0 (this
 * economy's flows are reported as magnitudes). Returns a PNG Buffer,
 * or null for an empty list.
 */
export async function renderBarChart(title, bars) {
  if (!bars || bars.length === 0) return null;

  const { canvas, ctx, plot } = makeCard(title);

  const vMax = Math.max(...bars.map((b) => b.value), 1);
  drawYAxis(ctx, plot, 0, vMax);

  // Bars fill the plot with half-bar gaps between them.
  const slot = plot.w / bars.length;
  const barW = Math.min(slot * 0.6, 90);

  bars.forEach((b, i) => {
    const x = plot.x + slot * i + (slot - barW) / 2;
    const h = (b.value / vMax) * plot.h;
    const y = plot.y + plot.h - h;

    ctx.fillStyle = b.color ?? SERIES_COLORS[i % SERIES_COLORS.length];
    ctx.fillRect(x, y, barW, h);

    // Value above the bar, label below it.
    ctx.fillStyle = TEXT;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(b.value.toLocaleString(), x + barW / 2, y - 6);
    ctx.fillText(b.label, x + barW / 2, H - 14);
    ctx.textAlign = 'left';
  });

  return canvas.encode('png');
}
