// ============================================================
// blackjack.js (database) — Persists games and settles money.
// Wraps the pure rules from ../lib/blackjack.js with the ledger
// and the blackjack_games table.
// ============================================================

import { withTransaction, lockMoney, ledgerBalance, insertLedger } from './tx.js';
import { getBalance } from './economy.js';
import { BLACKJACK } from '../config.js';
import {
  makeDeck,
  shuffle,
  isBlackjack,
  isBust,
  playDealer,
  settle,
  payoutCredit,
} from '../lib/blackjack.js';

// Converts a DB row into a tidy game object. pg parses JSONB columns into
// JS arrays automatically, so deck/hands come back ready to use.
function rowToGame(r) {
  return {
    id: r.id,
    guildId: r.guild_id,
    userId: r.user_id,
    bet: Number(r.bet),
    deck: r.deck,
    playerHand: r.player_hand,
    dealerHand: r.dealer_hand,
    status: r.status,
  };
}

// Credits whatever a finished game owes the player (nothing on a loss).
async function creditResult(client, guildId, userId, result, bet) {
  const credit = payoutCredit(result, bet);
  if (credit > 0) {
    const type = result === 'push' ? 'blackjack_push' : 'blackjack_win';
    await insertLedger(client, guildId, userId, credit, type);
  }
}

// Inserts a game row (active or finished) and returns it as a game object.
async function insertGame(client, guildId, userId, bet, deck, playerHand, dealerHand, status) {
  const { rows } = await client.query(
    `INSERT INTO blackjack_games
       (guild_id, user_id, bet, deck, player_hand, dealer_hand, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      guildId,
      userId,
      bet,
      JSON.stringify(deck),
      JSON.stringify(playerHand),
      JSON.stringify(dealerHand),
      status,
    ],
  );
  return rowToGame(rows[0]);
}

/**
 * Starts a new game, or resumes the user's existing active one.
 * - Stale actives (older than staleMinutes) are abandoned first — the bet
 *   is forfeited — so a lost game message can't block new games forever.
 * - New games check and debit the bet up front (the reserve), then either
 *   finish immediately on a natural blackjack or stay active.
 * Returns one of:
 *   { ok:false, reason:'insufficient' }
 *   { ok:true, resumed:true, game }
 *   { ok:true, resumed:false, finished:true, game, result, newBalance }
 *   { ok:true, resumed:false, finished:false, game }
 */
export async function startOrResume(guildId, userId, bet) {
  const outcome = await withTransaction(async (client) => {
    await lockMoney(client, guildId, userId);

    // Abandon a stale active game (its debited bet stays forfeited).
    await client.query(
      `UPDATE blackjack_games SET status = 'finished', updated_at = now()
       WHERE guild_id = $1 AND user_id = $2 AND status = 'active'
         AND created_at < now() - make_interval(mins => $3)`,
      [guildId, userId, BLACKJACK.staleMinutes],
    );

    // Resume a still-fresh active game if one exists.
    const active = await client.query(
      `SELECT * FROM blackjack_games
       WHERE guild_id = $1 AND user_id = $2 AND status = 'active'`,
      [guildId, userId],
    );
    if (active.rows.length > 0) {
      return { ok: true, resumed: true, game: rowToGame(active.rows[0]) };
    }

    // New game: confirm funds, then reserve the bet by debiting it now.
    if ((await ledgerBalance(client, guildId, userId)) < bet) {
      return { ok: false, reason: 'insufficient' };
    }
    await insertLedger(client, guildId, userId, -bet, 'blackjack_bet');

    // Deal: two cards each from the front of a shuffled deck.
    const deck = shuffle(makeDeck());
    const playerHand = [deck.shift(), deck.shift()];
    const dealerHand = [deck.shift(), deck.shift()];

    // A natural blackjack on either side ends the game on the deal.
    if (isBlackjack(playerHand) || isBlackjack(dealerHand)) {
      const result = settle(playerHand, dealerHand);
      await creditResult(client, guildId, userId, result, bet);
      const game = await insertGame(
        client, guildId, userId, bet, deck, playerHand, dealerHand, 'finished',
      );
      return { ok: true, resumed: false, finished: true, game, result };
    }

    // Otherwise the game stays active for the player to hit/stand.
    const game = await insertGame(
      client, guildId, userId, bet, deck, playerHand, dealerHand, 'active',
    );
    return { ok: true, resumed: false, finished: false, game };
  });

  // Attach a fresh balance to finished games for the result message.
  if (outcome.ok && outcome.finished) {
    outcome.newBalance = await getBalance(guildId, userId);
  }
  return outcome;
}

/**
 * Applies a button action ('hit' or 'stand') to a game. The FOR UPDATE
 * row lock serializes rapid double-clicks so a click can't double-process.
 * Returns:
 *   { ok:false, reason:'not_found'|'not_owner'|'not_active'|'bad_action' }
 *   { ok:true, finished:false, game }
 *   { ok:true, finished:true, result, game, newBalance }
 */
export async function applyAction(gameId, userId, action) {
  const outcome = await withTransaction(async (client) => {
    // Row-lock the game so concurrent clicks queue up.
    const res = await client.query(
      `SELECT * FROM blackjack_games WHERE id = $1 FOR UPDATE`,
      [gameId],
    );
    if (res.rows.length === 0) return { ok: false, reason: 'not_found' };
    const game = rowToGame(res.rows[0]);

    // Only the owner may act, and only on an active game.
    if (game.userId !== userId) return { ok: false, reason: 'not_owner' };
    if (game.status !== 'active') return { ok: false, reason: 'not_active' };

    // Money lock for the settlement writes.
    await lockMoney(client, game.guildId, userId);

    let deck = [...game.deck];
    let playerHand = [...game.playerHand];
    let dealerHand = [...game.dealerHand];
    let finished = false;
    let result = null;

    if (action === 'hit') {
      playerHand.push(deck.shift());
      if (isBust(playerHand)) {
        result = 'lose';
        finished = true;
      }
    } else if (action === 'stand') {
      // Dealer plays out, then the hands are compared.
      const played = playDealer(dealerHand, deck);
      dealerHand = played.dealerHand;
      deck = played.deck;
      result = settle(playerHand, dealerHand);
      finished = true;
    } else {
      return { ok: false, reason: 'bad_action' };
    }

    if (finished) {
      await creditResult(client, game.guildId, userId, result, game.bet);
    }
    await client.query(
      `UPDATE blackjack_games
       SET deck = $2, player_hand = $3, dealer_hand = $4,
           status = $5, updated_at = now()
       WHERE id = $1`,
      [
        gameId,
        JSON.stringify(deck),
        JSON.stringify(playerHand),
        JSON.stringify(dealerHand),
        finished ? 'finished' : 'active',
      ],
    );

    return {
      ok: true,
      finished,
      result,
      game: { ...game, deck, playerHand, dealerHand, status: finished ? 'finished' : 'active' },
    };
  });

  if (outcome.ok && outcome.finished) {
    outcome.newBalance = await getBalance(outcome.game.guildId, userId);
  }
  return outcome;
}
