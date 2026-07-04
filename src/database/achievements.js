// ============================================================
// achievements.js (database) — The framework's engine: the
// idempotent award write, the checkAchievements runner that
// commands call after a success, and the reads behind the
// /achievements command. The catalog itself lives in
// src/data/achievements.js.
// ============================================================

import { pool, query } from './db.js';
import { ledgerBalance } from './tx.js';
import { bankedBalance } from './bank.js';
import { ACHIEVEMENTS } from '../data/achievements.js';

// Ledger types that make up a gambling career. Bets and their payouts
// net against each other; refunds cancel voided bets. Wordle is a reward,
// not a wager, so it stays out.
const GAMBLING_TYPES = [
  'coinflip', 'slots',
  'blackjack_bet', 'blackjack_win', 'blackjack_push',
  'lol_bet', 'lol_bet_win', 'lol_bet_refund',
];

/**
 * Records one earned achievement. Idempotent by construction: the
 * composite PK plus ON CONFLICT DO NOTHING means racing calls (or
 * re-checks) can never double-award. RETURNING tells us which case we
 * hit — a returned row means "newly earned, worth announcing".
 */
export async function awardAchievement(guildId, userId, achievementId) {
  const { rows } = await query(
    `INSERT INTO user_achievements (guild_id, user_id, achievement_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING achievement_id`,
    [guildId, userId, achievementId],
  );
  return rows.length > 0;
}

/**
 * Builds the `queries` half of a check's ctx — targeted aggregate
 * lookups a check calls when the event alone can't answer it. Everything
 * here is lazy: nothing runs unless a subscribed check actually calls it,
 * so a trigger that only fires event-carried checks costs zero queries.
 * Tests inject a plain-object fake in place of this whole thing.
 */
export function makeQueries(guildId, userId) {
  return {
    /** Wallet right now (the usual derived SUM). */
    walletBalance: () => ledgerBalance(pool, guildId, userId),

    /** Banked total right now. */
    bankedBalance: () => bankedBalance(pool, guildId, userId),

    /** Wallet + banked — the worth-tier checks' input. */
    totalWorth: async () =>
      (await ledgerBalance(pool, guildId, userId)) +
      (await bankedBalance(pool, guildId, userId)),

    /** Lifetime positive /daily + /work earnings (credit-limit rule's input). */
    lifetimeEarned: async () => {
      const { rows } = await query(
        `SELECT COALESCE(SUM(amount), 0)::bigint AS earned
         FROM transactions
         WHERE guild_id = $1 AND user_id = $2
           AND type IN ('daily', 'work') AND amount > 0`,
        [guildId, userId],
      );
      return Number(rows[0].earned);
    },

    /** How many ledger rows of one type the user has (lifetime counters). */
    countType: async (type) => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM transactions
         WHERE guild_id = $1 AND user_id = $2 AND type = $3`,
        [guildId, userId, type],
      );
      return rows[0].n;
    },

    /** Same, but only rows from today (DB clock — consistent everywhere). */
    countTodayType: async (type) => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM transactions
         WHERE guild_id = $1 AND user_id = $2 AND type = $3
           AND created_at::date = CURRENT_DATE`,
        [guildId, userId, type],
      );
      return rows[0].n;
    },

    /** Total monies sent to others (pay + gift are negative rows; flip the sign). */
    sumGivenAway: async () => {
      const { rows } = await query(
        `SELECT COALESCE(-SUM(amount), 0)::bigint AS given
         FROM transactions
         WHERE guild_id = $1 AND user_id = $2
           AND type IN ('pay_sent', 'gift_sent')`,
        [guildId, userId],
      );
      return Number(rows[0].given);
    },

    /** How many DISTINCT bribe kinds the user has paid for. */
    bribeKinds: async () => {
      const { rows } = await query(
        `SELECT COUNT(DISTINCT metadata->>'kind')::int AS n
         FROM transactions
         WHERE guild_id = $1 AND user_id = $2 AND type = 'bribe'`,
        [guildId, userId],
      );
      return rows[0].n;
    },

    /** Net over all gambling types — positive means the house is losing. */
    gamblingNet: async () => {
      const { rows } = await query(
        `SELECT COALESCE(SUM(amount), 0)::bigint AS net
         FROM transactions
         WHERE guild_id = $1 AND user_id = $2 AND type = ANY($3)`,
        [guildId, userId, GAMBLING_TYPES],
      );
      return Number(rows[0].net);
    },

    /** The signed amounts of the user's last N rows of a type, newest first. */
    lastNets: async (type, n) => {
      const { rows } = await query(
        `SELECT amount::bigint AS amount FROM transactions
         WHERE guild_id = $1 AND user_id = $2 AND type = $3
         ORDER BY id DESC LIMIT $4`,
        [guildId, userId, type, n],
      );
      return rows.map((r) => Number(r.amount));
    },

    /** won/lost booleans of the last N coinflips, newest first. */
    lastCoinflipResults: async (n) => {
      const { rows } = await query(
        `SELECT (metadata->>'won')::boolean AS won FROM transactions
         WHERE guild_id = $1 AND user_id = $2 AND type = 'coinflip'
         ORDER BY id DESC LIMIT $3`,
        [guildId, userId, n],
      );
      return rows.map((r) => r.won);
    },

    /** Successful robberies of one specific victim (metadata carries who). */
    countRobsFrom: async (victimId) => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM transactions
         WHERE guild_id = $1 AND user_id = $2 AND type = 'rob_steal'
           AND metadata->>'from' = $3`,
        [guildId, userId, victimId],
      );
      return rows[0].n;
    },

    /**
     * The user's record AS A VICTIM: attempts against them (successful
     * hits + damages collected from failures) and how many succeeded.
     * One FILTER-ed pass, same trick as the profile stats.
     */
    victimRecord: async () => {
      const { rows } = await query(
        `SELECT
           COUNT(*) FILTER (WHERE type = 'rob_victim')::int  AS times_robbed,
           COUNT(*) FILTER (WHERE type = 'rob_damages')::int AS damages_collected
         FROM transactions
         WHERE guild_id = $1 AND user_id = $2`,
        [guildId, userId],
      );
      return {
        timesRobbed: rows[0].times_robbed,
        attemptsOnMe: rows[0].times_robbed + rows[0].damages_collected,
      };
    },

    /** Lifetime wordle solves in this guild. */
    countWordleSolves: async () => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM wordle_games
         WHERE guild_id = $1 AND user_id = $2 AND solved`,
        [guildId, userId],
      );
      return rows[0].n;
    },

    /** How many facts exist ABOUT this user (the Local Legend input). */
    countFactsAboutMe: async () => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM user_facts
         WHERE guild_id = $1 AND user_id = $2`,
        [guildId, userId],
      );
      return rows[0].n;
    },

    /** How many achievements the user holds (the completionist input). */
    countAchievements: async () => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM user_achievements
         WHERE guild_id = $1 AND user_id = $2`,
        [guildId, userId],
      );
      return rows[0].n;
    },

    // --- LoL lookups. Match history is keyed by puuid, not guild, so
    // these resolve the user's link with a join — guild-independent by
    // design (the same games count in every configured guild). ---

    /** win/loss booleans of the last N recorded games, newest first. */
    lolLastResults: async (n) => {
      const { rows } = await query(
        `SELECT h.win FROM lol_match_history h
         JOIN linked_accounts l ON l.puuid = h.puuid
         WHERE l.user_id = $1
         ORDER BY h.ended_at DESC LIMIT $2`,
        [userId, n],
      );
      return rows.map((r) => r.win);
    },

    /** Total recorded games for the user's linked account. */
    lolGameCount: async () => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM lol_match_history h
         JOIN linked_accounts l ON l.puuid = h.puuid
         WHERE l.user_id = $1`,
        [userId],
      );
      return rows[0].n;
    },

    /** Recorded games in one queue (420 solo, 450 ARAM, ...). */
    lolQueueCount: async (queueId) => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM lol_match_history h
         JOIN linked_accounts l ON l.puuid = h.puuid
         WHERE l.user_id = $1 AND h.queue_id = $2`,
        [userId, queueId],
      );
      return rows[0].n;
    },

    /** correct/incorrect booleans of the last N SETTLED bets, newest first. */
    lastBetResults: async (n) => {
      const { rows } = await query(
        `SELECT (b.on_win = m.won) AS correct
         FROM lol_bets b
         JOIN lol_matches m ON m.id = b.match_row_id
         WHERE b.bettor_id = $1 AND m.guild_id = $2 AND m.status = 'settled'
         ORDER BY b.placed_at DESC LIMIT $3`,
        [userId, guildId, n],
      );
      return rows.map((r) => r.correct);
    },
  };
}

/**
 * THE framework entry point. Commands call this AFTER a successful
 * action has committed — never inside a money transaction, so a slow or
 * buggy check can never roll money back (spec rule). It runs only the
 * catalog checks subscribed to `trigger`, awards whatever newly
 * qualifies, and returns the newly-earned definitions for announcing.
 *
 * Deliberately swallows every error (logging them): achievements are
 * garnish, and must never break the command that fired them.
 */
export async function checkAchievements(guildId, userId, trigger, event = null) {
  // No guild (DM) or no user — nothing to award against.
  if (!guildId || !userId) return [];

  const earned = [];
  try {
    const queries = makeQueries(guildId, userId);
    for (const def of ACHIEVEMENTS.filter((a) => a.triggers.includes(trigger))) {
      // Each check is isolated: one broken check shouldn't stop the rest.
      let qualifies = false;
      try {
        qualifies = Boolean(await def.check({ event, queries }));
      } catch (err) {
        console.error(`Achievement check "${def.id}" failed:`, err.message);
      }
      if (!qualifies) continue;

      // Only a genuinely NEW award goes in the announce list.
      if (await awardAchievement(guildId, userId, def.id)) {
        earned.push(def);
      }
    }

    // The meta pass: earning anything may itself complete a
    // completionist achievement. One recursive call with the 'meta'
    // trigger — and the trigger guard stops it recursing further, even
    // when the meta pass awards something.
    if (earned.length > 0 && trigger !== 'meta') {
      earned.push(...(await checkAchievements(guildId, userId, 'meta', null)));
    }
  } catch (err) {
    console.error('checkAchievements error:', err);
  }
  return earned;
}

/** Everything a user has earned in a guild, oldest first (trophy case). */
export async function getEarned(guildId, userId) {
  const { rows } = await query(
    `SELECT achievement_id, earned_at
     FROM user_achievements
     WHERE guild_id = $1 AND user_id = $2
     ORDER BY earned_at ASC`,
    [guildId, userId],
  );
  return rows;
}

/**
 * Server rarity: how many members hold each achievement, in one
 * GROUP BY. Returned as a Map(achievement_id -> holder count) so the
 * command can annotate lines cheaply.
 */
export async function getRarity(guildId) {
  const { rows } = await query(
    `SELECT achievement_id, COUNT(*)::int AS holders
     FROM user_achievements
     WHERE guild_id = $1
     GROUP BY achievement_id`,
    [guildId],
  );
  return new Map(rows.map((r) => [r.achievement_id, r.holders]));
}
