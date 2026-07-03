// ============================================================
// loans.js — Bank loan logic: borrow, repay, status, garnish.
// Owed amounts are derived at read time (principal + accrued
// interest − repaid), never stored.
// ============================================================

import { pool } from './db.js';
import { withTransaction, lockMoney, ledgerBalance, insertLedger } from './tx.js';
import { LOAN, computeOwed, computeCreditLimit } from '../config.js';

/**
 * Fetches a user's active loan with its age in fractional days (from the
 * DATABASE clock). `q` is a client or the pool; pass forUpdate:true inside
 * a transaction that intends to modify the loan. Returns null if none.
 */
async function fetchActiveLoan(q, guildId, userId, { forUpdate = false } = {}) {
  const { rows } = await q.query(
    `SELECT id, principal::bigint AS principal, daily_rate_pct,
            repaid::bigint AS repaid,
            EXTRACT(EPOCH FROM (now() - borrowed_at)) / 86400.0 AS age_days
     FROM loans
     WHERE guild_id = $1 AND user_id = $2 AND status = 'active'
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [guildId, userId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    principal: Number(r.principal),
    dailyRatePct: Number(r.daily_rate_pct),
    repaid: Number(r.repaid),
    ageDays: Number(r.age_days),
  };
}

// Owed right now for a fetched loan.
function owedFor(loan) {
  return computeOwed(loan.principal, loan.dailyRatePct, loan.ageDays, loan.repaid);
}

// Lifetime /daily + /work earnings — the input to the credit limit.
async function lifetimeEarned(q, guildId, userId) {
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(amount), 0)::bigint AS earned
     FROM transactions
     WHERE guild_id = $1 AND user_id = $2
       AND type IN ('daily', 'work') AND amount > 0`,
    [guildId, userId],
  );
  return Number(rows[0].earned);
}

/**
 * Records a repayment: debits the ledger, bumps the loan's repaid figure,
 * and closes the loan if the debt is cleared. Caller holds the money lock.
 * Returns the remaining owed.
 */
async function applyRepayment(client, guildId, userId, loan, amount, txType) {
  await insertLedger(client, guildId, userId, -amount, txType, { loan_id: loan.id });
  await client.query(`UPDATE loans SET repaid = repaid + $2 WHERE id = $1`, [
    loan.id,
    amount,
  ]);

  const owedAfter = owedFor({ ...loan, repaid: loan.repaid + amount });
  if (owedAfter <= 0) {
    await client.query(
      `UPDATE loans SET status = 'paid', paid_at = now() WHERE id = $1`,
      [loan.id],
    );
  }
  return owedAfter;
}

/**
 * Takes out a loan against the user's credit limit; disbursement is a
 * ledger credit. Returns { ok:false, reason:'active_loan'|'over_limit',
 * limit? } or { ok:true, amount, limit }.
 */
export function borrow(guildId, userId, amount) {
  return withTransaction(async (client) => {
    await lockMoney(client, guildId, userId);

    // One active loan at a time (the partial index enforces this too, but
    // a clean check gives a friendlier error than a constraint violation).
    if (await fetchActiveLoan(client, guildId, userId, { forUpdate: true })) {
      return { ok: false, reason: 'active_loan' };
    }

    // Creditworthiness: limit scales with lifetime earnings.
    const limit = computeCreditLimit(await lifetimeEarned(client, guildId, userId));
    if (amount > limit) {
      return { ok: false, reason: 'over_limit', limit };
    }

    // Open the loan (snapshotting today's rate) and disburse.
    const { rows } = await client.query(
      `INSERT INTO loans (guild_id, user_id, principal, daily_rate_pct)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [guildId, userId, amount, LOAN.dailyRatePct],
    );
    await insertLedger(client, guildId, userId, amount, 'loan_disbursement', {
      loan_id: rows[0].id,
    });
    return { ok: true, amount, limit };
  });
}

/**
 * Manually repays up to `amount`; the payment is capped at both the debt
 * and the user's balance. Returns { ok:false, reason:'no_loan'|'no_funds' }
 * or { ok:true, paid, owedRemaining, cleared }.
 */
export function repay(guildId, userId, amount) {
  return withTransaction(async (client) => {
    await lockMoney(client, guildId, userId);

    const loan = await fetchActiveLoan(client, guildId, userId, { forUpdate: true });
    if (!loan) return { ok: false, reason: 'no_loan' };

    // Pay the smallest of: what they asked, what they owe, what they have.
    const paid = Math.min(
      amount,
      owedFor(loan),
      await ledgerBalance(client, guildId, userId),
    );
    if (paid <= 0) return { ok: false, reason: 'no_funds' };

    const owedRemaining = await applyRepayment(
      client, guildId, userId, loan, paid, 'loan_repayment',
    );
    return { ok: true, paid, owedRemaining, cleared: owedRemaining <= 0 };
  });
}

/**
 * Read-only loan status for /loan status and /profile: current debt
 * breakdown plus the user's credit limit. No transaction needed.
 */
export async function getLoanStatus(guildId, userId) {
  const loan = await fetchActiveLoan(pool, guildId, userId);
  const limit = computeCreditLimit(await lifetimeEarned(pool, guildId, userId));

  if (!loan) return { active: false, limit };
  return {
    active: true,
    limit,
    principal: loan.principal,
    repaid: loan.repaid,
    owed: owedFor(loan),
    ageDays: loan.ageDays,
    dailyRatePct: loan.dailyRatePct,
  };
}

/**
 * Garnishment hook, called by /daily and /work after an earning lands.
 * Applies garnishPct of the earning to the loan, capped at the debt and
 * the user's balance so it can never drive anyone negative.
 * Returns null if nothing was garnished, else
 * { garnished, owedRemaining, cleared }.
 */
export function garnishEarnings(guildId, userId, earnedAmount) {
  return withTransaction(async (client) => {
    await lockMoney(client, guildId, userId);

    const loan = await fetchActiveLoan(client, guildId, userId, { forUpdate: true });
    if (!loan) return null;

    const cut = Math.floor(earnedAmount * (LOAN.garnishPct / 100));
    const garnished = Math.min(
      cut,
      owedFor(loan),
      await ledgerBalance(client, guildId, userId),
    );
    if (garnished <= 0) return null;

    const owedRemaining = await applyRepayment(
      client, guildId, userId, loan, garnished, 'loan_garnish',
    );
    return { garnished, owedRemaining, cleared: owedRemaining <= 0 };
  });
}
