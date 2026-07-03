// ============================================================
// wordle.test.js — Unit tests for src/lib/wordle.js.
//
// The star of this file is scoreGuess's duplicate-letter
// handling: the two-pass green-then-yellow algorithm with a
// letter budget is the part of Wordle everyone implements
// wrong on the first try, so it gets the densest coverage.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWERS,
  VALID_GUESSES,
  wordOfTheDay,
  scoreGuess,
  tilesRow,
  wordleReward,
} from '../src/lib/wordle.js';

// ---------------------------------------------------------------
// scoreGuess — the basics
// ---------------------------------------------------------------

test('scoreGuess: exact match is all green', () => {
  assert.deepEqual(scoreGuess('crane', 'crane'), ['g', 'g', 'g', 'g', 'g']);
});

test('scoreGuess: no shared letters is all gray', () => {
  assert.deepEqual(scoreGuess('crane', 'toils'), ['b', 'b', 'b', 'b', 'b']);
});

test('scoreGuess: right letters in wrong spots go yellow', () => {
  // The example from the source comment: SOLAR vs ROAST.
  // Only the O aligns (green); S, A, R exist elsewhere (yellow);
  // L is not in ROAST at all (gray).
  assert.deepEqual(scoreGuess('solar', 'roast'), ['y', 'g', 'b', 'y', 'y']);
});

test('scoreGuess: is case-insensitive on both sides', () => {
  // Discord input arrives in whatever case the user typed; the answer
  // list is lowercase. Scoring must not care.
  assert.deepEqual(scoreGuess('CRANE', 'crane'), ['g', 'g', 'g', 'g', 'g']);
  assert.deepEqual(scoreGuess('Solar', 'ROAST'), ['y', 'g', 'b', 'y', 'y']);
});

// ---------------------------------------------------------------
// scoreGuess — the duplicate-letter rules (the tricky part)
// ---------------------------------------------------------------

test('scoreGuess: a repeated guess letter only earns one yellow when the answer has it once', () => {
  // LEVEL vs APPLE: the guess has two Ls and two Es; the answer has one
  // of each. Each answer letter can pay for exactly ONE mark, consumed
  // left-to-right — so the first L and first E go yellow, and the
  // SECOND L and SECOND E must be gray, not yellow. A naive
  // "is the letter anywhere in the word" check marks all four yellow.
  assert.deepEqual(scoreGuess('level', 'apple'), ['y', 'y', 'b', 'b', 'b']);
});

test('scoreGuess: greens claim their letter BEFORE yellows, regardless of position', () => {
  // EERIE vs CRANE: the answer has a single E, at the END. The guess's
  // final E is green — and that green claims the answer's only E, so the
  // two EARLIER Es in the guess must be gray. This is why the algorithm
  // needs two passes: a single left-to-right pass would hand the E to
  // position 0 as a yellow before discovering the green at position 4.
  assert.deepEqual(scoreGuess('eerie', 'crane'), ['b', 'b', 'y', 'b', 'g']);
});

test('scoreGuess: greens consume the duplicate budget too', () => {
  // GEESE vs THESE: the answer's two Es (positions 2 and 4) are BOTH
  // claimed by greens, along with the S. That leaves only T and H in the
  // budget, so the guess's leftover E at position 1 gets gray — even
  // though "there's an E in the word" — because every E is spoken for.
  assert.deepEqual(scoreGuess('geese', 'these'), ['b', 'b', 'g', 'g', 'g']);
});

test('scoreGuess: an answer with a double letter can pay two yellows', () => {
  // SPEED vs ERASE: no position aligns, so no greens. The answer has two
  // Es, and the guess's two Es (positions 2 and 3) each consume one from
  // the budget — both yellow. The S is also misplaced (yellow); P and D
  // aren't in the answer (gray).
  assert.deepEqual(scoreGuess('speed', 'erase'), ['y', 'b', 'y', 'y', 'b']);
});

// ---------------------------------------------------------------
// wordOfTheDay — determinism
// ---------------------------------------------------------------

test('wordOfTheDay: same date always yields the same word, from the answer pool', () => {
  // The date string is the seed — no storage, no scheduler. Calling twice
  // must agree, and the result must come from ANSWERS (so it's always a
  // legal, guessable word).
  const a = wordOfTheDay('2026-07-03');
  const b = wordOfTheDay('2026-07-03');
  assert.equal(a, b);
  assert.ok(ANSWERS.includes(a), `${a} should be in ANSWERS`);
  assert.equal(a.length, 5);
});

test('wordOfTheDay: different dates spread across the answer pool', () => {
  // A hash that collapsed many dates onto one word would make the game
  // boring and predictable. A month of dates should produce a healthy
  // number of distinct words (not a strict uniformity proof — just a
  // tripwire against a degenerate hash).
  const words = new Set();
  for (let day = 1; day <= 30; day++) {
    words.add(wordOfTheDay(`2026-06-${String(day).padStart(2, '0')}`));
  }
  assert.ok(words.size > 20, `only ${words.size} distinct words in 30 days`);
});

test('every answer is an accepted guess', () => {
  // wordle.js builds VALID_GUESSES as dictionary ∪ ANSWERS precisely so
  // the day's answer can always be typed. Verify the union actually holds.
  for (const answer of ANSWERS) {
    assert.ok(VALID_GUESSES.has(answer), `${answer} missing from VALID_GUESSES`);
  }
});

// ---------------------------------------------------------------
// Display + rewards
// ---------------------------------------------------------------

test('tilesRow renders marks as the spoiler-free emoji grid', () => {
  assert.equal(tilesRow(['g', 'y', 'b', 'b', 'g']), '🟩🟨⬛⬛🟩');
});

test('wordleReward pays the documented schedule and 0 outside it', () => {
  // Faster solves pay more; attempts 1 and 2 share the top prize.
  assert.equal(wordleReward(1), 200);
  assert.equal(wordleReward(2), 200);
  assert.equal(wordleReward(3), 150);
  assert.equal(wordleReward(4), 100);
  assert.equal(wordleReward(5), 75);
  assert.equal(wordleReward(6), 50);
  // Out-of-range attempts (a failed puzzle, or bad input) pay nothing —
  // the ?? 0 fallback in the implementation.
  assert.equal(wordleReward(0), 0);
  assert.equal(wordleReward(7), 0);
  assert.equal(wordleReward(undefined), 0);
});
