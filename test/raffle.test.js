// ============================================================
// raffle.test.js — Unit tests for pickWeightedWinner from
// src/database/raffle.js.
//
// Only the PURE export is tested here — enterRaffle/drawRaffle
// need a live PostgreSQL and belong to integration testing.
// (Importing the module is safe without a database: the pg Pool
// constructor doesn't open a connection until the first query.)
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWeightedWinner } from '../src/database/raffle.js';
import { mulberry32 } from './helpers/prng.js';

test('pickWeightedWinner: empty or zero-ticket rounds return null', () => {
  // The draw command treats null as "nothing to draw" — both the no-entry
  // case and the degenerate all-zero case must land there, never in a
  // divide-by-zero or an arbitrary winner.
  assert.equal(pickWeightedWinner([]), null);
  assert.equal(
    pickWeightedWinner([
      { userId: 'a', tickets: 0 },
      { userId: 'b', tickets: 0 },
    ]),
    null,
  );
});

test('pickWeightedWinner: a single entrant always wins', () => {
  const entries = [{ userId: 'only', tickets: 7 }];
  // Whatever the rng says, there is only one slice to land in.
  for (const value of [0, 0.3, 0.999]) {
    assert.equal(pickWeightedWinner(entries, () => value), 'only');
  }
});

test('pickWeightedWinner: the rng value maps onto ticket slices in entry order', () => {
  // Entries a:2, b:3, c:5 → total 10. The algorithm walks entries
  // subtracting tickets from r = rng()*10, so the slices are
  // [0,2) → a, [2,5) → b, [5,10) → c. Probe each slice and both edges;
  // upper edges are EXCLUSIVE (r-=tickets hits 0, which is not < 0,
  // so the walk moves to the next entry).
  const entries = [
    { userId: 'a', tickets: 2 },
    { userId: 'b', tickets: 3 },
    { userId: 'c', tickets: 5 },
  ];
  const cases = [
    [0.0, 'a'],   // bottom of a's slice
    [0.19, 'a'],  // just inside a
    [0.2, 'b'],   // boundary → b (a's edge is exclusive)
    [0.49, 'b'],
    [0.5, 'c'],   // boundary → c
    [0.99, 'c'],
  ];
  for (const [value, expected] of cases) {
    assert.equal(pickWeightedWinner(entries, () => value), expected, `rng()=${value}`);
  }
});

test('pickWeightedWinner: zero-ticket entries can never win', () => {
  // A zero slice has no width — even an rng() landing exactly on its
  // position falls through to the next entry.
  const entries = [
    { userId: 'ghost', tickets: 0 },
    { userId: 'real', tickets: 1 },
  ];
  assert.equal(pickWeightedWinner(entries, () => 0), 'real');
});

test('pickWeightedWinner: the float-overshoot safety net returns the last entry', () => {
  // Math.random() never returns exactly 1, but the function guards against
  // float rounding pushing r past the final slice. Force the worst case
  // with rng() = 1: r = total, never goes negative, loop falls through —
  // the safety net must hand the win to the LAST entry, not crash or
  // return undefined.
  const entries = [
    { userId: 'a', tickets: 1 },
    { userId: 'b', tickets: 1 },
  ];
  assert.equal(pickWeightedWinner(entries, () => 1), 'b');
});

test('Monte Carlo: win frequency tracks ticket share (odds scale with contribution)', () => {
  // The raffle's fairness promise: tickets are 1:1 with monies, so someone
  // holding 70% of the tickets should win ~70% of draws. 20k seeded draws
  // gives a standard error under 0.4% per share, so a ±2% band is roomy
  // and — because the seed is fixed — the result is identical every run.
  const entries = [
    { userId: 'small', tickets: 10 },  // 10%
    { userId: 'medium', tickets: 20 }, // 20%
    { userId: 'whale', tickets: 70 },  // 70%
  ];
  const rng = mulberry32(2026);
  const N = 20_000;

  const wins = { small: 0, medium: 0, whale: 0 };
  for (let i = 0; i < N; i++) {
    wins[pickWeightedWinner(entries, rng)] += 1;
  }

  for (const [userId, share] of [['small', 0.1], ['medium', 0.2], ['whale', 0.7]]) {
    const observed = wins[userId] / N;
    assert.ok(
      Math.abs(observed - share) < 0.02,
      `${userId}: observed ${observed.toFixed(3)}, expected ~${share}`,
    );
  }
});
