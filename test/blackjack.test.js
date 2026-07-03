// ============================================================
// blackjack.test.js — Unit tests for src/lib/blackjack.js.
//
// Focus areas: ace revaluation in handValue (the only genuinely
// subtle math in blackjack), the full settle() outcome matrix
// (naturals beat ordinary 21s — a rule casual implementations
// miss), and payoutCredit (which must mirror how the bet was
// debited up front by the command layer).
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDeck,
  shuffle,
  cardValue,
  handValue,
  isBlackjack,
  isBust,
  playDealer,
  settle,
  payoutCredit,
} from '../src/lib/blackjack.js';
import { mulberry32 } from './helpers/prng.js';

// Tiny helper: build a hand from rank strings. Suit is irrelevant to every
// value/settle function, so a fixed one keeps the test cases readable.
const hand = (...ranks) => ranks.map((rank) => ({ rank, suit: '♠' }));

// ---------------------------------------------------------------
// Deck construction + shuffle
// ---------------------------------------------------------------

test('makeDeck builds 52 unique rank+suit combinations', () => {
  const deck = makeDeck();
  assert.equal(deck.length, 52);
  // Uniqueness via a Set of "rank|suit" keys — 52 keys means no dupes.
  const keys = new Set(deck.map((c) => `${c.rank}|${c.suit}`));
  assert.equal(keys.size, 52);
});

test('shuffle is a permutation, is deterministic under a seed, and does not mutate', () => {
  const deck = makeDeck();
  const snapshot = [...deck];

  // Same seed → same order: the game can be replayed for debugging.
  const a = shuffle(deck, mulberry32(42));
  const b = shuffle(deck, mulberry32(42));
  assert.deepEqual(a, b);

  // A different seed should (overwhelmingly) give a different order —
  // catches a shuffle that ignores its rng entirely.
  const c = shuffle(deck, mulberry32(43));
  assert.notDeepEqual(a, c);

  // Permutation check: same multiset of cards, nothing lost or invented.
  const key = (cards) => cards.map((x) => `${x.rank}|${x.suit}`).sort().join(',');
  assert.equal(key(a), key(deck));

  // The input deck must be untouched (shuffle copies) — the command layer
  // relies on that to keep its own references stable.
  assert.deepEqual(deck, snapshot);
});

// ---------------------------------------------------------------
// Card + hand values (ace handling)
// ---------------------------------------------------------------

test('cardValue: aces are 11, faces and tens are 10, pips are face value', () => {
  assert.equal(cardValue('A'), 11);
  for (const rank of ['K', 'Q', 'J', '10']) assert.equal(cardValue(rank), 10);
  assert.equal(cardValue('2'), 2);
  assert.equal(cardValue('9'), 9);
});

test('handValue downgrades aces from 11 to 1 only as needed', () => {
  // The classic cases, in increasing trickiness:
  assert.equal(handValue(hand('A', 'K')), 21);           // natural — ace stays 11
  assert.equal(handValue(hand('A', '5')), 16);           // soft 16 — ace stays 11
  assert.equal(handValue(hand('A', '5', 'K')), 16);      // 26 busts, so the ace drops to 1
  assert.equal(handValue(hand('A', 'A')), 12);           // 22 busts — ONE ace drops, not both
  assert.equal(handValue(hand('A', 'A', '9')), 21);      // 11 + 1 + 9 — one high ace survives
  assert.equal(handValue(hand('A', 'A', 'A', '8')), 21); // 11 + 1 + 1 + 8
  assert.equal(handValue(hand('A', 'K', 'Q', 'J')), 31); // all aces already low, still bust
});

test('isBlackjack requires exactly two cards totalling 21', () => {
  assert.equal(isBlackjack(hand('A', 'K')), true);
  // A three-card 21 is a fine hand but NOT a natural — it pays 1:1, not 3:2.
  assert.equal(isBlackjack(hand('7', '7', '7')), false);
  assert.equal(isBlackjack(hand('A', '9')), false); // two cards, but only 20
});

test('isBust triggers strictly above 21', () => {
  assert.equal(isBust(hand('K', 'Q', 'A')), false); // 21 exactly — safe
  assert.equal(isBust(hand('K', 'Q', '2')), true);  // 22
});

// ---------------------------------------------------------------
// Dealer play
// ---------------------------------------------------------------

test('playDealer draws to 17 and stands on all 17s (including soft)', () => {
  // Hard 16 must draw. Stack the deck so the draw is known.
  const drew = playDealer(hand('10', '6'), hand('5', '9'));
  assert.equal(handValue(drew.dealerHand), 21);   // 16 + 5
  assert.equal(drew.dealerHand.length, 3);
  assert.deepEqual(drew.deck, hand('9'));          // one card consumed off the top

  // Soft 17 (A+6): handValue says 17, and the implementation stands on
  // ALL 17s — so no card is drawn. This is a deliberate house rule
  // (S17 is actually slightly player-friendly).
  const stood = playDealer(hand('A', '6'), hand('5'));
  assert.equal(stood.dealerHand.length, 2);
  assert.deepEqual(stood.deck, hand('5')); // deck untouched

  // Neither input array may be mutated — playDealer copies both.
  const dealerIn = hand('10', '6');
  const deckIn = hand('2', '3', '4');
  playDealer(dealerIn, deckIn);
  assert.equal(dealerIn.length, 2);
  assert.equal(deckIn.length, 3);
});

// ---------------------------------------------------------------
// Settlement matrix
// ---------------------------------------------------------------

test('settle: the full outcome matrix from the player perspective', () => {
  const cases = [
    // [player, dealer, expected, why]
    [hand('A', 'K'), hand('A', 'Q'), 'push', 'both naturals cancel out'],
    [hand('A', 'K'), hand('10', '9'), 'blackjack', 'natural beats a made hand'],
    [hand('A', 'K'), hand('7', '7', '7'), 'blackjack', 'natural beats a THREE-card 21'],
    [hand('7', '7', '7'), hand('A', 'K'), 'lose', 'a three-card 21 loses to a natural'],
    [hand('10', '9', '5'), hand('10', '7'), 'lose', 'player bust loses outright'],
    [hand('10', '9', '5'), hand('10', '9', '5'), 'lose', 'both bust → player still loses (they busted first, house wins)'],
    [hand('10', '8'), hand('10', '9', '5'), 'win', 'dealer bust with player standing'],
    [hand('10', '9'), hand('10', '8'), 'win', 'higher total wins'],
    [hand('10', '8'), hand('10', '9'), 'lose', 'lower total loses'],
    [hand('10', '9'), hand('10', '9'), 'push', 'equal totals push'],
    [hand('A', '6'), hand('10', '7'), 'push', 'soft 17 vs hard 17 — same value'],
  ];
  for (const [p, d, expected, why] of cases) {
    assert.equal(settle(p, d), expected, why);
  }
});

// ---------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------

test('payoutCredit mirrors the up-front debit: credit = stake back + winnings', () => {
  // The command debits the bet at deal time, so these CREDITS produce the
  // intended NET results: blackjack +1.5x, win +1x, push 0, lose −1x.
  assert.equal(payoutCredit('blackjack', 100), 250); // 100 stake + 150 (3:2)
  assert.equal(payoutCredit('win', 100), 200);       // 100 stake + 100
  assert.equal(payoutCredit('push', 100), 100);      // stake only
  assert.equal(payoutCredit('lose', 100), 0);        // debited bet forfeited

  // Odd bets: the 3:2 bonus floors so monies stay integers. Bet 5 →
  // 5 + floor(7.5) = 12 (net +7, not +7.5).
  assert.equal(payoutCredit('blackjack', 5), 12);
  assert.equal(payoutCredit('blackjack', 1), 2); // 1 + floor(1.5) = 2 — net +1
});
