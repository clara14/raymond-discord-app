// ============================================================
// analytics.test.js — The pure math under the analytics
// feature: gini against known distributions, sparkline
// bucketing/normalization, the stats helpers against
// hand-computed fixtures, and the classifyType CONTRACT test —
// every ledger type the codebase writes must be classified
// (THE regression net against new features forgetting the
// taxonomy). The SQL itself is hand-verified, not integration-
// tested (no test database) — stated per the spec.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gini } from '../src/lib/gini.js';
import { sparkline } from '../src/lib/sparkline.js';
import { mean, median, percentileRank } from '../src/lib/stats.js';
import { classifyType, TYPE_CLASSES } from '../src/lib/ledgerTypes.js';

// ------------------------------------------------------------
// gini — known distributions
// ------------------------------------------------------------

test('gini: perfect equality is 0', () => {
  assert.equal(gini([5, 5, 5, 5]), 0);
  assert.equal(gini([1_000_000, 1_000_000]), 0);
});

test('gini: one-has-all is (n-1)/n', () => {
  // The theoretical max for n holders — 0.75 at n=4, approaching 1.
  assert.equal(gini([0, 0, 0, 100]), 0.75);
  assert.equal(gini([0, 100]), 0.5);
});

test('gini: degenerate inputs are 0, negatives clamp to 0', () => {
  assert.equal(gini([]), 0);
  assert.equal(gini([42]), 0);        // one holder — no inequality to measure
  assert.equal(gini([0, 0, 0]), 0);   // an economy of broke people is equal
  assert.equal(gini([-50, 100]), 0.5); // debt clamps to 0 → same as [0, 100]
});

test('gini: order-independent', () => {
  assert.equal(gini([10, 90, 40, 60]), gini([90, 10, 60, 40]));
});

// ------------------------------------------------------------
// sparkline
// ------------------------------------------------------------

test('sparkline: full ramp maps to all eight blocks', () => {
  assert.equal(sparkline([1, 2, 3, 4, 5, 6, 7, 8], 8), '▁▂▃▄▅▆▇█');
});

test('sparkline: flat series renders level, single point renders one block', () => {
  assert.equal(sparkline([7, 7, 7], 10), '▄▄▄');
  assert.equal(sparkline([42], 10), '▄');
});

test('sparkline: long series buckets down to the width', () => {
  const values = Array.from({ length: 100 }, (_, i) => i);
  const line = sparkline(values, 24);
  assert.equal(line.length, 24);
  // Monotonic input → the line never goes down.
  const blocks = '▁▂▃▄▅▆▇█';
  for (let i = 1; i < line.length; i++) {
    assert.ok(blocks.indexOf(line[i]) >= blocks.indexOf(line[i - 1]),
      `sparkline dipped at position ${i}: ${line}`);
  }
});

test('sparkline: empty input is an empty string', () => {
  assert.equal(sparkline([]), '');
  assert.equal(sparkline(null), '');
});

// ------------------------------------------------------------
// stats helpers — hand-computed fixtures
// ------------------------------------------------------------

test('median: odd, even (interpolated), and empty', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
});

test('mean: simple average, empty is 0', () => {
  assert.equal(mean([2, 4, 6]), 4);
  assert.equal(mean([]), 0);
});

test('percentileRank: strictly-below convention', () => {
  const worths = [100, 200, 300, 400];
  assert.equal(percentileRank(worths, 300), 50);  // beats 100 and 200
  assert.equal(percentileRank(worths, 500), 100); // beats everyone
  assert.equal(percentileRank(worths, 100), 0);   // beats no one (ties don't count)
  assert.equal(percentileRank([], 100), 0);
});

// ------------------------------------------------------------
// classifyType — THE contract
// ------------------------------------------------------------

// Every ledger type string the codebase writes, by feature. A new
// feature minting a new type must register it in TYPE_CLASSES AND here —
// the two lists guard each other.
const ALL_LEDGER_TYPES = [
  'welcome', 'daily', 'work', 'wordle', 'birthday',
  'pay_sent', 'pay_received', 'gift_sent', 'gift_received',
  'bribe',
  'bank_deposit', 'bank_withdraw',
  'loan_disbursement', 'loan_repayment', 'loan_garnish',
  'rob_steal', 'rob_victim', 'rob_fail', 'rob_damages',
  'raffle_entry', 'raffle_pot', 'raffle_payout', 'raffle_win',
  'coinflip', 'slots', 'blackjack_bet', 'blackjack_win', 'blackjack_push',
  'lol_bet', 'lol_bet_win', 'lol_bet_refund',
];

const VALID_CLASSES = new Set(['faucet', 'sink', 'transfer', 'internal', 'gamble']);

test('classifyType: every ledger type the codebase writes is classified', () => {
  for (const type of ALL_LEDGER_TYPES) {
    const cls = classifyType(type);
    assert.notEqual(cls, 'unknown', `ledger type "${type}" is not in the taxonomy`);
    assert.ok(VALID_CLASSES.has(cls), `ledger type "${type}" has invalid class "${cls}"`);
  }
});

test('classifyType: the taxonomy contains no orphaned entries', () => {
  // The reverse direction: a type in the map that no feature writes is
  // stale (renamed or removed) — both lists must match exactly.
  for (const type of Object.keys(TYPE_CLASSES)) {
    assert.ok(ALL_LEDGER_TYPES.includes(type),
      `taxonomy entry "${type}" isn't a type the codebase writes`);
  }
});

test('classifyType: unknown types answer "unknown", never crash', () => {
  assert.equal(classifyType('heist_payout'), 'unknown');
  assert.equal(classifyType(undefined), 'unknown');
});

test('classifyType: spot-check the accounting-critical assignments', () => {
  assert.equal(classifyType('daily'), 'faucet');
  assert.equal(classifyType('bribe'), 'sink');
  assert.equal(classifyType('loan_disbursement'), 'faucet'); // principal in...
  assert.equal(classifyType('loan_repayment'), 'sink');      // ...interest out
  assert.equal(classifyType('gift_sent'), 'transfer');       // fee = pair residual
  assert.equal(classifyType('bank_deposit'), 'internal');
  assert.equal(classifyType('slots'), 'gamble');             // sign decides
});
