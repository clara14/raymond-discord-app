// ============================================================
// economy.js — All currency logic: balances, transfers, daily
// claims, coinflips, gifts, and burns. Built on the shared
// transaction toolkit in tx.js; commands call these helpers so
// the money rules stay in one audited place.
// ============================================================

import { pool, query } from './db.js';
import {
  withTransaction,
  lockMoney,
  ledgerBalance,
  insertLedger,
} from './tx.js';
import { computeDailyReward, WELCOME_BONUS } from '../config.js';

/**
 * A user's current balance — a casual (unlocked) read via the pool.
 * For check-then-spend logic, read inside a transaction with lockMoney
 * held instead (see transfer/burn below).
 */
export function getBalance(guildId, userId) {
  return ledgerBalance(pool, guildId, userId);
}

/**
 * Records a single unconditional ledger entry (e.g. a /work payout).
 * Runs in its own transaction (hash-chaining requires one) under the
 * user's money lock. Operations that must check a balance first use
 * their own locked transactions below.
 */
export function addTransaction(guildId, userId, amount, type, metadata = {}) {
  return withTransaction(async (client) => {
    await lockMoney(client, guildId, userId);
    await insertLedger(client, guildId, userId, amount, type, metadata);
  });
}

/**
 * Grants the one-time welcome bonus the first time we see a user.
 * Idempotent: INSERT ... WHERE NOT EXISTS does the check-and-write in one
 * statement, and the money lock serializes concurrent calls — the bonus
 * can never be granted twice.
 */
export function ensureWelcomeBonus(guildId, userId) {
  return withTransaction(async (client) => {
    await lockMoney(client, guildId, userId);
    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, metadata)
       SELECT $1, $2, $3, 'welcome', '{}'::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM transactions
         WHERE guild_id = $1 AND user_id = $2 AND type = 'welcome'
       )`,
      [guildId, userId, WELCOME_BONUS],
    );
  });
}

/**
 * Atomically moves monies between users. The sender's lock makes the
 * check-then-write safe; two rows in one transaction means credits can
 * never be lost or duplicated.
 * Returns { ok:true } or { ok:false, reason:'insufficient' }.
 */
export function transfer(guildId, fromId, toId, amount) {
  return withTransaction(async (client) => {
    await lockMoney(client, guildId, fromId);

    if ((await ledgerBalance(client, guildId, fromId)) < amount) {
      return { ok: false, reason: 'insufficient' };
    }

    await insertLedger(client, guildId, fromId, -amount, 'pay_sent', { to: toId });
    await insertLedger(client, guildId, toId, amount, 'pay_received', { from: fromId });
    return { ok: true };
  });
}

/**
 * A gift: sender pays `price`, recipient nets `net` (price minus the burned
 * shop fee). The rows deliberately net negative — that's how monies leave
 * circulation. Returns { ok:true } or { ok:false, reason:'insufficient' }.
 */
export function giftTransfer(guildId, fromId, toId, price, net, metadata = {}) {
  return withTransaction(async (client) => {
    await lockMoney(client, guildId, fromId);

    if ((await ledgerBalance(client, guildId, fromId)) < price) {
      return { ok: false, reason: 'insufficient' };
    }

    await insertLedger(client, guildId, fromId, -price, 'gift_sent', { to: toId, ...metadata });
    await insertLedger(client, guildId, toId, net, 'gift_received', { from: fromId, ...metadata });
    return { ok: true };
  });
}

/**
 * Burns monies: an atomic, balance-checked spend with no recipient.
 * Used by /bribe and any future pure sink.
 * Returns { ok:true } or { ok:false, reason:'insufficient' }.
 */
export function burn(guildId, userId, amount, type, metadata = {}) {
  return withTransaction(async (client) => {
    await lockMoney(client, guildId, userId);

    if ((await ledgerBalance(client, guildId, userId)) < amount) {
      return { ok: false, reason: 'insufficient' };
    }

    await insertLedger(client, guildId, userId, -amount, type, metadata);
    return { ok: true };
  });
}

/**
 * Handles a /daily claim: once-per-day cooldown, streak tracking, and the
 * reward credit — atomically. Uses the DATABASE clock (CURRENT_DATE) so the
 * cooldown is consistent wherever the bot runs.
 * Returns { claimed:false } or { claimed:true, reward, streak, newBalance }.
 */
export async function claimDaily(guildId, userId) {
  const outcome = await withTransaction(async (client) => {
    await lockMoney(client, guildId, userId);

    // Existing streak row + how many days since the last claim.
    const { rows } = await client.query(
      `SELECT streak, (CURRENT_DATE - last_claim) AS days_since
       FROM daily_streaks
       WHERE guild_id = $1 AND user_id = $2`,
      [guildId, userId],
    );

    let newStreak;
    if (rows.length === 0) {
      newStreak = 1; // first ever claim
    } else if (rows[0].days_since === 0) {
      return { claimed: false }; // already claimed today
    } else if (rows[0].days_since === 1) {
      newStreak = rows[0].streak + 1; // claimed yesterday — streak continues
    } else {
      newStreak = 1; // missed a day — streak resets
    }

    const reward = computeDailyReward(newStreak);

    // Upsert the streak row (insert if new, update in place otherwise).
    await client.query(
      `INSERT INTO daily_streaks (guild_id, user_id, last_claim, streak)
       VALUES ($1, $2, CURRENT_DATE, $3)
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET last_claim = CURRENT_DATE, streak = $3`,
      [guildId, userId, newStreak],
    );

    await insertLedger(client, guildId, userId, reward, 'daily', { streak: newStreak });
    return { claimed: true, reward, streak: newStreak };
  });

  if (!outcome.claimed) return outcome;
  // Fresh balance for the confirmation message (post-commit is fine here).
  return { ...outcome, newBalance: await getBalance(guildId, userId) };
}

/**
 * Generic atomic wager: checks funds under the money lock, runs `play()`
 * (a pure-ish function returning the outcome), records ONE signed ledger
 * row for the net result, and returns the outcome + fresh balance.
 *
 * `play(bet)` must return { net, type, metadata, ...anything } where net
 * is the signed money change (win +X, lose -bet). Games like slots build
 * on this instead of re-rolling their own transaction scaffolding.
 * Returns { ok:false, reason:'insufficient' } or { ok:true, ...outcome, newBalance }.
 */
export async function resolveWager(guildId, userId, bet, play) {
  const outcome = await withTransaction(async (client) => {
    await lockMoney(client, guildId, userId);

    if ((await ledgerBalance(client, guildId, userId)) < bet) {
      return { ok: false, reason: 'insufficient' };
    }

    const result = play(bet);
    await insertLedger(client, guildId, userId, result.net, result.type, result.metadata ?? {});
    return { ok: true, ...result };
  });

  if (!outcome.ok) return outcome;
  return { ...outcome, newBalance: await getBalance(guildId, userId) };
}

/**
 * Resolves a coinflip: checks funds, flips, records one signed row
 * (win +bet, lose -bet). Returns { ok:false, reason:'insufficient' } or
 * { ok:true, won, result, newBalance }.
 */
export async function resolveCoinflip(guildId, userId, bet, guess) {
  const outcome = await withTransaction(async (client) => {
    await lockMoney(client, guildId, userId);

    if ((await ledgerBalance(client, guildId, userId)) < bet) {
      return { ok: false, reason: 'insufficient' };
    }

    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = result === guess;
    const net = won ? bet : -bet;

    await insertLedger(client, guildId, userId, net, 'coinflip', {
      bet, guess, result, won,
    });
    return { ok: true, won, result };
  });

  if (!outcome.ok) return outcome;
  return { ...outcome, newBalance: await getBalance(guildId, userId) };
}

/**
 * Top total worth in a guild: wallet PLUS banked, so parking monies in the
 * bank doesn't hide anyone from the leaderboard. Wallet = SUM(amount);
 * banked = -(sum over bank rows); total = wallet + banked, which works out
 * to SUM(amount) - SUM(bank rows). COALESCE guards users with no bank rows
 * (FILTER over zero rows yields NULL, which would poison the subtraction).
 */
export async function getLeaderboard(guildId, limit = 10) {
  const { rows } = await query(
    `SELECT user_id,
            (SUM(amount)
             - COALESCE(SUM(amount) FILTER (WHERE type IN ('bank_deposit','bank_withdraw')), 0)
            )::bigint AS total
     FROM transactions
     WHERE guild_id = $1
     GROUP BY user_id
     HAVING (SUM(amount)
             - COALESCE(SUM(amount) FILTER (WHERE type IN ('bank_deposit','bank_withdraw')), 0)) <> 0
     ORDER BY total DESC
     LIMIT $2`,
    [guildId, limit],
  );
  return rows.map((r) => ({ userId: r.user_id, balance: Number(r.total) }));
}
