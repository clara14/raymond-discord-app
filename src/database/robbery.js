// ============================================================
// robbery.js (database) — The money movement for /rob.
// Robberies touch TWO users' wallets at once, which introduces
// a deadlock hazard: if A robs B while B robs A and each locks
// themselves first, both wait forever. The fix is canonical
// lock ordering — always acquire the two money locks in sorted
// key order, so every transaction requests them the same way.
// ============================================================

import { withTransaction, acquireLock, ledgerBalance, insertLedger, LOCK } from './tx.js';
import { ROB, computeSteal, computePenalty } from '../config.js';

/**
 * Locks both users' money in canonical (sorted) order. Every code path
 * that needs two money locks must do it this way — consistent ordering is
 * what makes concurrent cross-robberies queue instead of deadlock.
 */
async function lockBoth(client, guildId, userA, userB) {
  const keys = [`${guildId}:${userA}`, `${guildId}:${userB}`].sort();
  for (const key of keys) {
    await acquireLock(client, LOCK.MONEY, key);
  }
}

/**
 * Attempts a robbery. Assumes cooldowns/shields were already handled by
 * the command layer. Wallet-only by construction: ledgerBalance excludes
 * banked monies, so deposits are untouchable.
 *
 * `rolls` is injectable for testing: { success: 0..1, amount: 0..1 }.
 *
 * Returns one of:
 *   { ok:false, reason:'victim_broke', minimum }
 *   { ok:true, success:true,  amount, robberWallet, victimWallet }
 *   { ok:true, success:false, penalty, robberWallet, victimWallet }
 */
export function attemptRob(guildId, robberId, victimId, rolls = null) {
  const success = (rolls?.success ?? Math.random()) < ROB.successPct / 100;
  const amountRoll = rolls?.amount ?? Math.random();

  return withTransaction(async (client) => {
    await lockBoth(client, guildId, robberId, victimId);

    // Read both wallets inside the locks.
    const victimWallet = await ledgerBalance(client, guildId, victimId);
    const robberWallet = await ledgerBalance(client, guildId, robberId);

    // Broke victims aren't worth the trouble (and it protects new players).
    if (victimWallet < ROB.minVictimWallet) {
      return { ok: false, reason: 'victim_broke', minimum: ROB.minVictimWallet };
    }

    if (success) {
      // Steal a rolled percentage of the victim's wallet, capped.
      const amount = computeSteal(victimWallet, amountRoll);
      await insertLedger(client, guildId, victimId, -amount, 'rob_victim', {
        by: robberId,
      });
      await insertLedger(client, guildId, robberId, amount, 'rob_steal', {
        from: victimId,
      });
      return {
        ok: true,
        success: true,
        amount,
        robberWallet: robberWallet + amount,
        victimWallet: victimWallet - amount,
      };
    }

    // Failure: the robber pays the victim damages. Paying the victim
    // (rather than burning) means a botched robbery actually compensates
    // the target — nice for balance, and the monies stay conserved.
    const penalty = computePenalty(robberWallet);
    if (penalty > 0) {
      await insertLedger(client, guildId, robberId, -penalty, 'rob_fail', {
        victim: victimId,
      });
      await insertLedger(client, guildId, victimId, penalty, 'rob_damages', {
        from: robberId,
      });
    }
    return {
      ok: true,
      success: false,
      penalty,
      robberWallet: robberWallet - penalty,
      victimWallet: victimWallet + penalty,
    };
  });
}
