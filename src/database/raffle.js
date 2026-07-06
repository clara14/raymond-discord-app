// ============================================================
// raffle.js — Community raffle logic.
// The pot is held by a sentinel "user" in the ledger, while the
// raffles/raffle_entries tables track rounds and odds.
// ============================================================

import { query } from './db.js';
import {
  withTransaction,
  acquireLock,
  lockMoney,
  ledgerBalance,
  insertLedger,
  LOCK,
} from './tx.js';

// The pot's owner in the ledger. Discord user IDs are numeric strings, so
// this non-numeric sentinel can never collide with a real user. Exported
// for the analytics module's jar forensics.
export const JAR_SENTINEL = '__raffle_jar__';

/**
 * Picks a winner weighted by ticket count. Pure and deterministic given
 * `rng`, so it's unit-testable. Walks the entries subtracting each user's
 * tickets from a random point in [0, total) — whoever's slice the point
 * lands in wins.
 */
export function pickWeightedWinner(entries, rng = Math.random) {
  const total = entries.reduce((sum, e) => sum + e.tickets, 0);
  if (total <= 0) return null;

  let r = rng() * total;
  for (const entry of entries) {
    r -= entry.tickets;
    if (r < 0) return entry.userId;
  }
  // Floating-point safety net: rounding can overshoot the last slice.
  return entries[entries.length - 1].userId;
}

// Pot total + entrant count for a round (for display and confirmations).
async function roundTotals(q, raffleId) {
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(tickets), 0)::bigint AS pot, COUNT(*)::int AS entrants
     FROM raffle_entries WHERE raffle_id = $1`,
    [raffleId],
  );
  return { pot: Number(rows[0].pot), entrants: rows[0].entrants };
}

/**
 * Adds `amount` monies to the current raffle pot, creating an open raffle
 * if none exists. Takes BOTH locks — the guild raffle lock (so entries and
 * draws serialize) and the user's money lock (so a concurrent /pay or
 * /coinflip can't double-spend) — always in that order, so lock ordering
 * is consistent and can't deadlock.
 * Returns { ok:false, reason:'insufficient' } or
 * { ok:true, pot, entrants, userTickets }.
 */
export function enterRaffle(guildId, userId, amount) {
  return withTransaction(async (client) => {
    await acquireLock(client, LOCK.RAFFLE, guildId);
    await lockMoney(client, guildId, userId);

    // Find the open raffle, or create one.
    const existing = await client.query(
      `SELECT id FROM raffles WHERE guild_id = $1 AND status = 'open'`,
      [guildId],
    );
    const raffleId =
      existing.rows[0]?.id ??
      (
        await client.query(
          `INSERT INTO raffles (guild_id) VALUES ($1) RETURNING id`,
          [guildId],
        )
      ).rows[0].id;

    // Confirm the contributor can afford it, inside the lock.
    if ((await ledgerBalance(client, guildId, userId)) < amount) {
      return { ok: false, reason: 'insufficient' };
    }

    // Money movement: debit the contributor, credit the jar sentinel.
    await insertLedger(client, guildId, userId, -amount, 'raffle_entry', {
      raffle_id: raffleId,
    });
    await insertLedger(client, guildId, JAR_SENTINEL, amount, 'raffle_pot', {
      raffle_id: raffleId,
      from: userId,
    });

    // Record tickets (1 per money); repeat entries accumulate via upsert.
    await client.query(
      `INSERT INTO raffle_entries (raffle_id, user_id, tickets)
       VALUES ($1, $2, $3)
       ON CONFLICT (raffle_id, user_id)
       DO UPDATE SET tickets = raffle_entries.tickets + $3`,
      [raffleId, userId, amount],
    );

    const totals = await roundTotals(client, raffleId);
    const { rows: mine } = await client.query(
      `SELECT tickets FROM raffle_entries WHERE raffle_id = $1 AND user_id = $2`,
      [raffleId, userId],
    );
    return { ok: true, ...totals, userTickets: Number(mine[0].tickets) };
  });
}

/**
 * Read-only raffle state for /raffle pot: whether a round is open, the pot,
 * entrant count, the caller's tickets, and the most recent past winner.
 */
export async function getRaffleStatus(guildId, userId) {
  const open = await query(
    `SELECT id FROM raffles WHERE guild_id = $1 AND status = 'open'`,
    [guildId],
  );
  const last = await query(
    `SELECT winner_id FROM raffles
     WHERE guild_id = $1 AND status = 'drawn'
     ORDER BY drawn_at DESC LIMIT 1`,
    [guildId],
  );
  const lastWinner = last.rows[0]?.winner_id ?? null;

  if (open.rows.length === 0) {
    return { open: false, pot: 0, entrants: 0, userTickets: 0, lastWinner };
  }

  const raffleId = open.rows[0].id;
  const totals = await roundTotals({ query }, raffleId);
  const { rows: mine } = await query(
    `SELECT tickets FROM raffle_entries WHERE raffle_id = $1 AND user_id = $2`,
    [raffleId, userId],
  );
  return {
    open: true,
    ...totals,
    userTickets: mine[0] ? Number(mine[0].tickets) : 0,
    lastWinner,
  };
}

/**
 * Draws the open raffle: picks a weighted winner, pays them the whole pot,
 * and closes the round. `rng` is injectable for testing.
 * Returns { ok:false, reason:'no_raffle'|'empty' } or
 * { ok:true, winnerId, pot, entrants }.
 */
export function drawRaffle(guildId, rng = Math.random) {
  return withTransaction(async (client) => {
    // Same guild lock as entering, so no one can tip mid-draw.
    await acquireLock(client, LOCK.RAFFLE, guildId);

    const raffleRes = await client.query(
      `SELECT id FROM raffles WHERE guild_id = $1 AND status = 'open' FOR UPDATE`,
      [guildId],
    );
    if (raffleRes.rows.length === 0) return { ok: false, reason: 'no_raffle' };
    const raffleId = raffleRes.rows[0].id;

    // Load entries; bail if the pot is empty.
    const { rows } = await client.query(
      `SELECT user_id, tickets::bigint AS tickets
       FROM raffle_entries WHERE raffle_id = $1`,
      [raffleId],
    );
    const entries = rows.map((e) => ({ userId: e.user_id, tickets: Number(e.tickets) }));
    if (entries.reduce((s, e) => s + e.tickets, 0) <= 0) {
      return { ok: false, reason: 'empty' };
    }

    const winnerId = pickWeightedWinner(entries, rng);
    // The winner's own ticket count rides along for the underdog
    // achievement (win share is tickets/pot at draw time).
    const winnerTickets = entries.find((e) => e.userId === winnerId)?.tickets ?? 0;

    // Pot = the jar's ledger balance (the money truth), so the payout
    // empties the jar exactly.
    const pot = await ledgerBalance(client, guildId, JAR_SENTINEL);

    // Pay out: empty the jar, credit the winner, close the round.
    await insertLedger(client, guildId, JAR_SENTINEL, -pot, 'raffle_payout', {
      raffle_id: raffleId,
      winner: winnerId,
    });
    await insertLedger(client, guildId, winnerId, pot, 'raffle_win', {
      raffle_id: raffleId,
    });
    await client.query(
      `UPDATE raffles SET status = 'drawn', winner_id = $2, drawn_at = now()
       WHERE id = $1`,
      [raffleId, winnerId],
    );

    return { ok: true, winnerId, pot, entrants: entries.length, winnerTickets };
  });
}
