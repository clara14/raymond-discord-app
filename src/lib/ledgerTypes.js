// ============================================================
// ledgerTypes.js (lib) — The ledger-type taxonomy: every type
// string the codebase writes, classified for the analytics
// accounting. The contract test asserts the map is exhaustive,
// so a new feature that mints a new type without registering it
// here fails the suite (mirroring the achievements catalog).
//
// Classes:
//  faucet   — mints monies into existence (always positive rows)
//  sink     — burns monies out of existence (always negative rows)
//  transfer — moves monies between users; SUM over a matched pair
//             is 0… except gifts, whose pair nets −fee. That
//             residual IS the gift-shop burn, and the flow
//             queries count it that way.
//  internal — moves monies between a user's own pockets
//             (wallet ↔ bank); invisible to supply and flow
//  gamble   — two-way house flows where the SIGN decides:
//             positive rows are house payouts (minted), negative
//             rows are house takings (burned). The spec's
//             four-class taxonomy called failed gambles "sinks";
//             a fifth class keeps wins/losses in one place
//             instead of pretending a type is only ever one.
// ============================================================

export const TYPE_CLASSES = {
  // Faucets — the economy's money printers.
  welcome: 'faucet',
  daily: 'faucet',
  work: 'faucet',
  wordle: 'faucet',
  birthday: 'faucet',
  loan_disbursement: 'faucet', // principal enters circulation...

  // Sinks — where monies go to die.
  bribe: 'sink',
  loan_repayment: 'sink',      // ...and leaves with interest: the loan
  loan_garnish: 'sink',        // types net to burned interest over time

  // Transfers — player to player (gift pairs net −fee; see header).
  pay_sent: 'transfer',
  pay_received: 'transfer',
  gift_sent: 'transfer',
  gift_received: 'transfer',
  rob_steal: 'transfer',
  rob_victim: 'transfer',
  rob_fail: 'transfer',
  rob_damages: 'transfer',
  raffle_entry: 'transfer',
  raffle_pot: 'transfer',
  raffle_payout: 'transfer',
  raffle_win: 'transfer',

  // Internal — same owner, different pocket.
  bank_deposit: 'internal',
  bank_withdraw: 'internal',

  // Gambles — sign decides mint vs burn.
  coinflip: 'gamble',
  slots: 'gamble',
  blackjack_bet: 'gamble',
  blackjack_win: 'gamble',
  blackjack_push: 'gamble',
  lol_bet: 'gamble',
  lol_bet_win: 'gamble',
  lol_bet_refund: 'gamble',
};

/**
 * The class for a ledger type. 'unknown' (never null) for anything
 * unregistered — the dashboard surfaces unknown-typed volume as a
 * "someone forgot the taxonomy" alarm instead of crashing.
 */
export function classifyType(type) {
  return TYPE_CLASSES[type] ?? 'unknown';
}

/** All type strings in one class — feeds SQL `= ANY($n)` filters. */
export function typesInClass(cls) {
  return Object.keys(TYPE_CLASSES).filter((t) => TYPE_CLASSES[t] === cls);
}
