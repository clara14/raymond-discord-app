// ============================================================
// lolBets.js (database) — Match tracking + betting money logic.
// Bets are debited at placement; settlement pays correct bets
// 2x, and voided matches refund everyone. All ledger rows.
// ============================================================

import { query } from './db.js';
import { withTransaction, lockMoney, ledgerBalance, insertLedger } from './tx.js';

/**
 * Records a newly detected live game. The unique (guild, riot_game_id)
 * index makes this idempotent: re-detecting the same game inserts nothing
 * and returns null, so the poller can't double-announce.
 * `participants` is the list of linked players found in the game.
 */
export async function trackMatch(guildId, userId, puuid, riotGameId, channelId, closesAt, participants = []) {
  const { rows } = await query(
    `INSERT INTO lol_matches
       (guild_id, user_id, puuid, riot_game_id, channel_id, betting_closes_at, participants)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (guild_id, riot_game_id) DO NOTHING
     RETURNING id`,
    [guildId, userId, puuid, riotGameId, channelId, closesAt, JSON.stringify(participants)],
  );
  return rows[0]?.id ?? null;
}

/** Saves the announcement message id so settlement can edit it later. */
export async function setMatchMessage(matchRowId, messageId) {
  await query(`UPDATE lol_matches SET message_id = $2 WHERE id = $1`, [
    matchRowId,
    messageId,
  ]);
}

/** All matches still live — the poller's watchlist. */
export async function getLiveMatches() {
  const { rows } = await query(
    `SELECT * FROM lol_matches WHERE status = 'live'`,
  );
  return rows;
}

/** Bumps the failed-result-lookup counter and returns the new count. */
export async function bumpResultAttempts(matchRowId) {
  const { rows } = await query(
    `UPDATE lol_matches SET result_attempts = result_attempts + 1
     WHERE id = $1 RETURNING result_attempts`,
    [matchRowId],
  );
  return rows[0].result_attempts;
}

/**
 * Places a bet: atomically debits the wallet and records the bet row.
 * The composite primary key rejects a second bet from the same user on
 * the same match — surfaced as reason 'already_bet'.
 * The betting window and match status are re-checked INSIDE the
 * transaction so a bet can't slip in after closure or settlement.
 */
export function placeBet(matchRowId, guildId, bettorId, amount, onWin) {
  return withTransaction(async (client) => {
    await lockMoney(client, guildId, bettorId);

    // Window/status check inside the transaction (authoritative).
    const { rows: match } = await client.query(
      `SELECT status, betting_closes_at <= now() AS closed
       FROM lol_matches WHERE id = $1`,
      [matchRowId],
    );
    if (match.length === 0) return { ok: false, reason: 'not_found' };
    if (match[0].status !== 'live') return { ok: false, reason: 'not_live' };
    if (match[0].closed) return { ok: false, reason: 'closed' };

    if ((await ledgerBalance(client, guildId, bettorId)) < amount) {
      return { ok: false, reason: 'insufficient' };
    }

    // Record the bet; the PK catches double-betting.
    try {
      await client.query(
        `INSERT INTO lol_bets (match_row_id, bettor_id, amount, on_win)
         VALUES ($1, $2, $3, $4)`,
        [matchRowId, bettorId, amount, onWin],
      );
    } catch (err) {
      if (String(err.message).includes('lol_bets_pkey')) {
        return { ok: false, reason: 'already_bet' };
      }
      throw err;
    }

    // Debit the wager now — winners are paid back 2x at settlement.
    await insertLedger(client, guildId, bettorId, -amount, 'lol_bet', {
      match: matchRowId,
      on_win: onWin,
    });
    return { ok: true };
  });
}

/**
 * Settles a finished match: pays every correct bet 2x its wager, marks
 * the match settled, and returns a summary for the announcement edit.
 */
export function settleMatch(matchRowId, guildId, won) {
  return withTransaction(async (client) => {
    // Lock the match row so settle/void can't race each other.
    const { rows: match } = await client.query(
      `SELECT status FROM lol_matches WHERE id = $1 FOR UPDATE`,
      [matchRowId],
    );
    if (match.length === 0 || match[0].status !== 'live') {
      return { settled: false };
    }

    const { rows: bets } = await client.query(
      `SELECT bettor_id, amount::bigint AS amount, on_win
       FROM lol_bets WHERE match_row_id = $1`,
      [matchRowId],
    );

    // Pay each correct bet double its stake.
    const winners = [];
    let totalWagered = 0;
    for (const bet of bets) {
      const amount = Number(bet.amount);
      totalWagered += amount;
      if (bet.on_win === won) {
        await insertLedger(client, guildId, bet.bettor_id, amount * 2, 'lol_bet_win', {
          match: matchRowId,
        });
        winners.push({ userId: bet.bettor_id, paid: amount * 2 });
      }
    }

    await client.query(
      `UPDATE lol_matches
       SET status = 'settled', won = $2, settled_at = now()
       WHERE id = $1`,
      [matchRowId, won],
    );

    return { settled: true, bets: bets.length, totalWagered, winners };
  });
}

/**
 * Voids a match whose result never turned up (remakes, API gaps): refunds
 * every wager in full and marks the match void.
 */
export function voidMatch(matchRowId, guildId) {
  return withTransaction(async (client) => {
    const { rows: match } = await client.query(
      `SELECT status FROM lol_matches WHERE id = $1 FOR UPDATE`,
      [matchRowId],
    );
    if (match.length === 0 || match[0].status !== 'live') {
      return { voided: false };
    }

    const { rows: bets } = await client.query(
      `SELECT bettor_id, amount::bigint AS amount
       FROM lol_bets WHERE match_row_id = $1`,
      [matchRowId],
    );
    for (const bet of bets) {
      await insertLedger(client, guildId, bet.bettor_id, Number(bet.amount), 'lol_bet_refund', {
        match: matchRowId,
      });
    }

    await client.query(
      `UPDATE lol_matches SET status = 'void', settled_at = now() WHERE id = $1`,
      [matchRowId],
    );
    return { voided: true, refunded: bets.length };
  });
}
