// ============================================================
// slots.js (lib) — Pure slot machine math: weighted reels and
// the payout table. No money, no Discord — fully testable,
// including a Monte Carlo check of the designed house edge.
//
// DESIGN: return-to-player (RTP) ≈ 88.5%, i.e. an ~11.5% house
// edge, with a ~50% hit rate so wins feel frequent. Rare-symbol
// triples pay big; any pair pays slightly over the stake.
// ============================================================

// Each reel draws independently from this weighted symbol set.
// Weights sum to 20, so probability = weight / 20 per reel.
export const SYMBOLS = [
  { emoji: '🍒', weight: 5 },  // p = .25
  { emoji: '🍋', weight: 5 },  // p = .25
  { emoji: '🍊', weight: 4 },  // p = .20
  { emoji: '🔔', weight: 3 },  // p = .15
  { emoji: '💎', weight: 2 },  // p = .10
  { emoji: '7️⃣', weight: 1 },  // p = .05
];

// Multiplier of the BET paid back for three of a kind, per symbol.
// (A losing spin pays 0; the bet was already debited.)
const TRIPLE_PAYOUTS = {
  '7️⃣': 50, // the jackpot
  '💎': 20,
  '🔔': 12,
  '🍊': 8,
  '🍋': 6,
  '🍒': 5,
};

const TWO_SEVENS_PAYOUT = 4;  // exactly two 7️⃣s
const PAIR_PAYOUT = 1.2;      // any other exactly-two-of-a-kind

// Total of all weights, computed once.
const TOTAL_WEIGHT = SYMBOLS.reduce((sum, s) => sum + s.weight, 0);

/**
 * Draws one symbol according to the weights. rng is injectable so tests
 * can be deterministic.
 */
export function drawSymbol(rng = Math.random) {
  let r = rng() * TOTAL_WEIGHT;
  for (const symbol of SYMBOLS) {
    r -= symbol.weight;
    if (r < 0) return symbol.emoji;
  }
  return SYMBOLS[SYMBOLS.length - 1].emoji; // float-rounding safety net
}

/** Spins the three reels. Returns e.g. ['🍒','💎','🍒']. */
export function spinReels(rng = Math.random) {
  return [drawSymbol(rng), drawSymbol(rng), drawSymbol(rng)];
}

/**
 * Scores a spin. Returns { multiplier, label }:
 *  - multiplier: what fraction/multiple of the bet is paid back (0 = loss)
 *  - label: a short human description for the result embed
 */
export function evaluateSpin(reels) {
  const [a, b, c] = reels;

  // Three of a kind — the big payouts.
  if (a === b && b === c) {
    return {
      multiplier: TRIPLE_PAYOUTS[a],
      label: a === '7️⃣' ? 'JACKPOT! Triple sevens!' : `Triple ${a}!`,
    };
  }

  // Exactly two sevens (any position).
  const sevens = reels.filter((s) => s === '7️⃣').length;
  if (sevens === 2) {
    return { multiplier: TWO_SEVENS_PAYOUT, label: 'Two sevens!' };
  }

  // Any other exactly-two-of-a-kind.
  if (a === b || b === c || a === c) {
    return { multiplier: PAIR_PAYOUT, label: 'A pair — small win!' };
  }

  return { multiplier: 0, label: 'No match.' };
}

/**
 * The credit (total monies returned) for a bet and multiplier.
 * Floored so fractional multipliers (the 1.2x pair) stay integer monies.
 */
export function payout(bet, multiplier) {
  return Math.floor(bet * multiplier);
}
