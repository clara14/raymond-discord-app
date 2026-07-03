// ============================================================
// stats.js (database) — Aggregations for profile cards and the
// streak leaderboard. Every stat is derived from data other
// features already record; nothing new is written here.
// ============================================================

import { query } from './db.js';
import { getBalance } from './economy.js';
import { getLoanStatus } from './loans.js';
import { bankedBalance } from './bank.js';
import { pool } from './db.js';

/**
 * Top ACTIVE daily streaks in a guild. The stored streak is only real if
 * the user claimed today or yesterday — otherwise the streak is broken and
 * they simply don't belong on the board. (CURRENT_DATE - last_claim) gives
 * days since claim: 0 = today, 1 = yesterday (still alive).
 */
export async function getStreakLeaderboard(guildId, limit = 10) {
  const { rows } = await query(
    `SELECT user_id, streak
     FROM daily_streaks
     WHERE guild_id = $1
       AND (CURRENT_DATE - last_claim) <= 1
     ORDER BY streak DESC, last_claim DESC
     LIMIT $2`,
    [guildId, limit],
  );
  return rows.map((r) => ({ userId: r.user_id, streak: Number(r.streak) }));
}

/**
 * A user's current effective streak: the stored value if it's still alive
 * (claimed today or yesterday), else 0.
 */
export async function getCurrentStreak(guildId, userId) {
  const { rows } = await query(
    `SELECT streak, (CURRENT_DATE - last_claim) AS days_since
     FROM daily_streaks
     WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId],
  );
  if (rows.length === 0) return 0;
  return rows[0].days_since <= 1 ? Number(rows[0].streak) : 0;
}

/**
 * Everything the profile card shows, gathered from the ledger and the
 * loan/streak state. One FILTER-ed aggregation pass over the user's
 * transactions covers all the money stats in a single query.
 */
export async function getProfile(guildId, userId) {
  // FILTER (WHERE ...) computes several conditional aggregates in one scan —
  // much nicer than running five separate SUM queries.
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE type IN ('daily','work') AND amount > 0), 0)::bigint AS lifetime_earned,
       COALESCE(SUM(amount) FILTER (WHERE type IN ('coinflip','blackjack_bet','blackjack_win','blackjack_push')), 0)::bigint AS gambling_net,
       COUNT(*) FILTER (WHERE type = 'coinflip' AND (metadata->>'won')::boolean) ::int AS coinflip_wins,
       COUNT(*) FILTER (WHERE type = 'coinflip' AND NOT (metadata->>'won')::boolean)::int AS coinflip_losses,
       COUNT(*) FILTER (WHERE type = 'raffle_win')::int AS raffle_wins
     FROM transactions
     WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId],
  );
  const t = rows[0];

  // Balance, banked savings, and loan state (all derived values).
  const balance = await getBalance(guildId, userId);
  const banked = await bankedBalance(pool, guildId, userId);
  const loan = await getLoanStatus(guildId, userId);
  const debt = loan.active ? loan.owed : 0;

  return {
    balance,
    banked,
    debt,
    netWorth: balance + banked - debt,  // wallet + savings minus what you owe
    streak: await getCurrentStreak(guildId, userId),
    lifetimeEarned: Number(t.lifetime_earned),
    gamblingNet: Number(t.gambling_net),
    coinflipWins: t.coinflip_wins,
    coinflipLosses: t.coinflip_losses,
    raffleWins: t.raffle_wins,
  };
}
