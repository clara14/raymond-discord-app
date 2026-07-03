// ============================================================
// tx.js — Shared transaction toolkit for the database layer.
// Every money operation used to hand-roll the same scaffolding:
// connect, BEGIN, advisory lock, balance query, COMMIT/ROLLBACK,
// release. It now lives here, once.
// ============================================================

import { pool } from './db.js';
import { hashRow, GENESIS } from '../lib/ledgerHash.js';

// Advisory-lock namespaces, centralized so no two features collide.
export const LOCK = {
  MONEY: 1,   // per-user money serialization: key `${guildId}:${userId}`
  RAFFLE: 2,  // per-guild raffle serialization: key guildId
  LEDGER: 3,  // per-guild ledger APPEND serialization: key guildId
              // (hash-chaining needs an unambiguous "previous row")
};

/**
 * Runs `fn(client)` inside a database transaction.
 * COMMITs on success, ROLLBACKs on throw, always releases the client.
 * Business-level failures (like "insufficient funds") should simply return
 * early — every such path in this codebase checks before writing, so an
 * empty COMMIT is harmless and cheap.
 *
 * Usage:
 *   const result = await withTransaction(async (client) => {
 *     ...queries via client...
 *     return something;
 *   });
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Takes a transaction-scoped advisory lock (auto-released at COMMIT/ROLLBACK).
 * Concurrent transactions requesting the same (namespace, key) queue up here,
 * which is what makes check-then-write money logic race-safe.
 */
export async function acquireLock(client, namespace, key) {
  await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
    namespace,
    key,
  ]);
}

/**
 * The standard per-user money lock. Take this before reading a balance you
 * intend to spend from — it serializes with every other money operation for
 * the same user (pay, coinflip, blackjack, loans, raffle, gifts, burns).
 */
export function lockMoney(client, guildId, userId) {
  return acquireLock(client, LOCK.MONEY, `${guildId}:${userId}`);
}

/**
 * A user's balance = SUM over their ledger rows. `q` is anything with a
 * .query method — a transaction client (for locked reads) or the pool
 * (for casual reads).
 */
export async function ledgerBalance(q, guildId, userId) {
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(amount), 0)::bigint AS balance
     FROM transactions
     WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId],
  );
  return Number(rows[0].balance);
}

/**
 * Appends one ledger row AND links it into the guild's tamper-evidence
 * hash chain. Signed amount: positive = credit, negative = debit.
 *
 * MUST be called with a transaction client (not the pool): chaining needs
 * the per-guild LEDGER advisory lock so "the previous row" is unambiguous
 * even when different users transact simultaneously. (Serializing appends
 * is the same price real blockchains pay for their chain.)
 *
 * Steps: lock the guild's chain -> insert (RETURNING id + the DATABASE's
 * text rendering of created_at, which is what gets hashed — stable across
 * write and verify) -> read the previous row's hash -> compute this row's
 * hash -> stamp it on.
 */
export async function insertLedger(client, guildId, userId, amount, type, metadata = {}) {
  // Serialize appends for this guild's chain.
  await acquireLock(client, LOCK.LEDGER, guildId);

  const { rows: inserted } = await client.query(
    `INSERT INTO transactions (guild_id, user_id, amount, type, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at::text AS created_at_text`,
    [guildId, userId, amount, type, JSON.stringify(metadata)],
  );
  const { id, created_at_text } = inserted[0];

  // The previous row in this guild's chain (by id), or GENESIS.
  const { rows: prev } = await client.query(
    `SELECT row_hash FROM transactions
     WHERE guild_id = $1 AND id < $2 AND row_hash IS NOT NULL
     ORDER BY id DESC LIMIT 1`,
    [guildId, id],
  );
  const prevHash = prev[0]?.row_hash ?? GENESIS;

  const rowHash = hashRow({
    id,
    guildId,
    userId,
    amount: String(amount),
    type,
    metadata,
    createdAtText: created_at_text,
    prevHash,
  });

  await client.query(
    `UPDATE transactions SET row_hash = $2, prev_hash = $3 WHERE id = $1`,
    [id, rowHash, prevHash],
  );
}
