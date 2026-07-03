// ============================================================
// config.test.js — Unit tests for the pure functions in
// src/config.js: loan math, daily rewards, robbery math, the
// gift-shop burn, and the display formatters.
//
// These functions ARE the economy's rules — a one-character slip
// in any of them silently changes what everyone earns or owes.
// Where tests reference tuning constants (LOAN, ROB, ...), the
// expected values are written out numerically ON PURPOSE: if a
// knob changes, the failing test forces a conscious look at the
// new economics instead of the test bending to match.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOwed,
  computeCreditLimit,
  computeDailyReward,
  computeSteal,
  computePenalty,
  giftNet,
  formatDuration,
  formatCurrency,
  CURRENCY,
} from '../src/config.js';

// ---------------------------------------------------------------
// Loans
// ---------------------------------------------------------------

test('computeOwed: simple interest accrues per day of age', () => {
  // Day 0: no time has passed, nothing repaid → exactly the principal.
  assert.equal(computeOwed(100, 2, 0, 0), 100);
  // 25 days at 2%/day = +50% → 150. (25 days chosen deliberately: the
  // growth factor 1.5 is exact in binary floating point, so this case
  // tests the FORMULA with no rounding noise in the way.)
  assert.equal(computeOwed(100, 2, 25, 0), 150);
});

test('computeOwed: fractional days accrue, and ceil rounds in the bank\'s favor', () => {
  // Half a day on 100 at 2%/day → factor 1.01 → 101 exactly.
  assert.equal(computeOwed(100, 2, 0.5, 0), 101);
  // A tenth of a day grows the debt to ~100.2 → ceil → 101. The borrower
  // never benefits from rounding; that asymmetry is deliberate.
  assert.equal(computeOwed(100, 2, 0.1, 0), 101);
});

test('computeOwed: float representation can ceil an extra money (documented behavior)', () => {
  // The "obvious" answer for 5 days at 2% is 110 — but in IEEE-754
  // doubles, 100 * 1.1 evaluates to 110.00000000000001, and Math.ceil
  // dutifully rounds that to 111. So the bank charges one money more than
  // the pencil-and-paper number here. This is harmless in practice ONLY
  // because /loan uses computeOwed for BOTH display and repayment — the
  // user is shown 111 and pays 111, so the books stay consistent. If a
  // future refactor ever computes "owed" a second way, this test is the
  // reminder that the two ways won't agree.
  assert.equal(computeOwed(100, 2, 5, 0), 111);
  // Self-consistency: repaying the displayed figure zeroes the debt...
  assert.equal(computeOwed(100, 2, 5, 111), 0);
  // ...while repaying the pencil-and-paper 110 leaves 1 owing.
  assert.equal(computeOwed(100, 2, 5, 110), 1);
});

test('computeOwed: repayments subtract, and the result never goes negative', () => {
  assert.equal(computeOwed(100, 2, 25, 60), 90);  // 150 grown − 60 repaid
  assert.equal(computeOwed(100, 2, 25, 150), 0);  // fully repaid
  // Overpaying (or stale data) must clamp at 0 — a negative debt would
  // read as the bank owing the user monies.
  assert.equal(computeOwed(100, 2, 25, 500), 0);
});

test('computeCreditLimit: base floor, earnings scaling, and the hard ceiling', () => {
  // A brand-new user can still borrow the base cap.
  assert.equal(computeCreditLimit(0), 250);
  // Limit grows by half of lifetime earnings (earnFactor 0.5), floored.
  assert.equal(computeCreditLimit(100), 300);   // 250 + 50
  assert.equal(computeCreditLimit(101), 300);   // 250 + floor(50.5)
  // The boundary where scaling exactly reaches the ceiling...
  assert.equal(computeCreditLimit(9500), 5000); // 250 + 4750
  // ...and beyond it, the cap holds no matter how rich you get.
  assert.equal(computeCreditLimit(1_000_000), 5000);
});

// ---------------------------------------------------------------
// Daily rewards
// ---------------------------------------------------------------

test('computeDailyReward: base + 25/day streak bonus, capped at 7 bonus days', () => {
  assert.equal(computeDailyReward(1), 100);  // day one: base only
  assert.equal(computeDailyReward(2), 125);  // one bonus day
  assert.equal(computeDailyReward(8), 275);  // 7 bonus days — the cap
  assert.equal(computeDailyReward(100), 275); // a huge streak pays no more
  // Defensive floor: a zero/negative streak (bad data) clamps to base
  // rather than producing a NEGATIVE bonus.
  assert.equal(computeDailyReward(0), 100);
  assert.equal(computeDailyReward(-5), 100);
});

// ---------------------------------------------------------------
// Robbery
// ---------------------------------------------------------------

test('computeSteal: the roll interpolates between 10% and 30% of the wallet', () => {
  // roll is in [0,1): 0 → the 10% floor, 0.5 → 20%, near 1 → near 30%.
  assert.equal(computeSteal(1000, 0), 100);
  assert.equal(computeSteal(1000, 0.5), 200);
  assert.equal(computeSteal(1000, 0.95), 290); // 10 + 0.95·20 = 29%
});

test('computeSteal: floors to integer monies and caps at 500', () => {
  // Small wallet: 10% of 33 = 3.3 → floored to 3 (fractional monies
  // don't exist anywhere in the ledger).
  assert.equal(computeSteal(33, 0), 3);
  // Whale protection: 20% of 10,000 would be 2,000 — the cap turns it
  // into 500 so one lucky rob can't wipe out a fortune.
  assert.equal(computeSteal(10_000, 0.5), 500);
});

test('computePenalty: 15% of the robber\'s wallet, min 25, never more than they have', () => {
  assert.equal(computePenalty(1000), 150); // plain 15%
  // 15% of 100 is only 15 — the 25 floor makes failure sting even for
  // small wallets...
  assert.equal(computePenalty(100), 25);
  // ...but the fine can't exceed what the robber actually holds (the
  // ledger must never push a wallet negative).
  assert.equal(computePenalty(10), 10);
  assert.equal(computePenalty(0), 0);
});

// ---------------------------------------------------------------
// Gifts
// ---------------------------------------------------------------

test('giftNet: recipient gets the price minus the 20% burn fee', () => {
  assert.equal(giftNet(50), 40);     // beer: 10 burned
  assert.equal(giftNet(100), 80);    // flowers
  assert.equal(giftNet(2000), 1600); // diamond
  // The fee FLOORS, so the burn rounds DOWN and the recipient keeps the
  // remainder — generosity wins the rounding, unlike loan interest.
  assert.equal(giftNet(33), 27); // fee floor(6.6) = 6
  assert.equal(giftNet(1), 1);   // fee floor(0.2) = 0 — tiny gifts burn nothing
});

// ---------------------------------------------------------------
// Display formatters
// ---------------------------------------------------------------

test('formatDuration: compact minutes/seconds forms', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(59), '59s');
  assert.equal(formatDuration(60), '1m');       // exact minutes omit the 0s
  assert.equal(formatDuration(61), '1m 1s');
  assert.equal(formatDuration(3599), '59m 59s'); // stays in minutes (no hours unit)
});

test('formatDuration: never shows negative time, rounds partial seconds UP', () => {
  // A cooldown that "expired 3 seconds ago" due to clock skew shows 0s,
  // and 0.2s remaining shows 1s — telling a user "0s left" while still
  // rejecting their command would read as a bug.
  assert.equal(formatDuration(-3), '0s');
  assert.equal(formatDuration(0.2), '1s');
});

test('formatCurrency: symbol + amount + the invariant "monies" word', () => {
  // "monies" is both singular and plural by decree, so amount 1 must NOT
  // switch to some other word. (Thousands separators are locale-dependent,
  // so amounts here stay below 1,000 to keep the assertion portable.)
  assert.equal(formatCurrency(1), `${CURRENCY.symbol} 1 monies`);
  assert.equal(formatCurrency(500), `${CURRENCY.symbol} 500 monies`);
});
