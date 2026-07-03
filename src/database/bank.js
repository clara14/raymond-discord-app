// ============================================================
// bank.js (database) — Savings accounts, built entirely on the
// existing ledger. A deposit is a negative wallet row of type
// 'bank_deposit'; a withdrawal is a positive 'bank_withdraw'
// row. So: wallet balance (the usual SUM) automatically
// excludes banked monies, and the banked balance is derived as
// the NEGATED sum over just those two types. No new tables.
// ============================================================

import { pool } from './db.js';
import { withTransaction, lockMoney, ledgerBalance, insertLedger } from './tx.js';

/**
 * How much a user has in the bank. Deposits are stored as negative wallet
 * rows and withdrawals as positive ones, so negating their sum gives the
 * banked total (deposit -500 => banked 500; withdraw +300 => banked 200).
 */
export async function bankedBalance(q, guildId, userId) {
  const { rows } = await q.query(
    `SELECT COALESCE(-SUM(amount), 0)::bigint AS banked
     FROM transactions
     WHERE guild_id = $1 AND user_id = $2
       AND type IN ('bank_deposit', 'bank_withdraw')`,
    [guildId, userId],
  );
  return Number(rows[0].banked);
}

/**
 * Moves monies from wallet to bank. Banked monies can't be spent, gambled,
 * or — the point — robbed. Returns { ok:false, reason:'insufficient' } or
 * { ok:true, wallet, banked }.
 */
export function deposit(guildId, userId, amount) {
  return withTransaction(async (client) => {
    await lockMoney(client, guildId, userId);

    if ((await ledgerBalance(client, guildId, userId)) < amount) {
      return { ok: false, reason: 'insufficient' };
    }

    await insertLedger(client, guildId, userId, -amount, 'bank_deposit');
    return {
      ok: true,
      wallet: await ledgerBalance(client, guildId, userId),
      banked: await bankedBalance(client, guildId, userId),
    };
  });
}

/**
 * Moves monies from bank back to wallet. Returns
 * { ok:false, reason:'insufficient' } or { ok:true, wallet, banked }.
 */
export function withdraw(guildId, userId, amount) {
  return withTransaction(async (client) => {
    await lockMoney(client, guildId, userId);

    if ((await bankedBalance(client, guildId, userId)) < amount) {
      return { ok: false, reason: 'insufficient' };
    }

    await insertLedger(client, guildId, userId, amount, 'bank_withdraw');
    return {
      ok: true,
      wallet: await ledgerBalance(client, guildId, userId),
      banked: await bankedBalance(client, guildId, userId),
    };
  });
}

/** Read-only wallet + banked snapshot for /bank status. */
export async function getBankStatus(guildId, userId) {
  return {
    wallet: await ledgerBalance(pool, guildId, userId),
    banked: await bankedBalance(pool, guildId, userId),
  };
}
