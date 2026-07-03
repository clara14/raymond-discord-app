// ============================================================
// achievements.js (database) — The framework's engine: the
// idempotent award write, the checkAchievements runner that
// commands call after a success, and the reads behind the
// /achievements command. The catalog itself lives in
// src/data/achievements.js.
// ============================================================

import { query } from './db.js';
import { ACHIEVEMENTS } from '../data/achievements.js';

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
 * lookups a check can call when the event alone can't answer it.
 * Phase 1's checks are all event-only, so this is an empty seam;
 * phase 2/3 grow it (lifetime counts, streak reads, worth queries...)
 * and tests inject a fake in its place.
 */
export function makeQueries(guildId, userId) {
  return {};
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
