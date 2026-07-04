// ============================================================
// birthdays.js (database) — Storage for self-declared birthdays
// and the reads the daily celebration job needs. All calendar
// LOGIC (leap years, Feb 29, days-until) lives in the pure
// lib/birthdays.js; this file only moves rows.
// ============================================================

import { query } from './db.js';

/**
 * Upserts the caller's own birthday. Re-setting simply overwrites —
 * and clears last_celebrated ONLY when the date actually changed, so
 * you can't farm a second party this year by re-saving the same date
 * after being celebrated (changing to a not-yet-passed date is fine;
 * the job only fires on the day itself).
 */
export async function setBirthday(guildId, userId, month, day, birthYear = null) {
  await query(
    `INSERT INTO birthdays (guild_id, user_id, month, day, birth_year)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET
       month = $3, day = $4, birth_year = $5,
       last_celebrated = CASE
         WHEN birthdays.month = $3 AND birthdays.day = $4
         THEN birthdays.last_celebrated  -- same date: keep the dedupe
         ELSE NULL                        -- new date: eligible again
       END`,
    [guildId, userId, month, day, birthYear],
  );
}

/** Deletes the caller's row. Returns true if there was one (privacy path). */
export async function removeBirthday(guildId, userId) {
  const { rowCount } = await query(
    `DELETE FROM birthdays WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId],
  );
  return rowCount > 0;
}

/** One user's birthday row, or null. */
export async function getBirthday(guildId, userId) {
  const { rows } = await query(
    `SELECT user_id, month, day, birth_year, last_celebrated
     FROM birthdays WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId],
  );
  return rows[0] ?? null;
}

/** Every registered birthday in a guild (sorting happens in the command). */
export async function listBirthdays(guildId) {
  const { rows } = await query(
    `SELECT user_id, month, day, birth_year FROM birthdays WHERE guild_id = $1`,
    [guildId],
  );
  return rows;
}

/**
 * Today by the DATABASE clock, as the plain { year, month, day } shape
 * the pure lib helpers take. The one-clock rule: every "is it their
 * birthday?" decision keys off this, never the JS Date.
 */
export async function getDbToday() {
  const { rows } = await query(
    `SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int  AS year,
            EXTRACT(MONTH FROM CURRENT_DATE)::int AS month,
            EXTRACT(DAY FROM CURRENT_DATE)::int   AS day`,
  );
  return rows[0];
}

/**
 * Everyone (all guilds) not yet celebrated this year. Deliberately a
 * broad cheap fetch — the actual "is today their day?" decision runs in
 * JS through the pure, unit-tested isCelebrationDay, so the Feb 29 rule
 * lives in exactly one place instead of being duplicated into SQL.
 */
export async function getCelebrationCandidates(currentYear) {
  const { rows } = await query(
    `SELECT guild_id, user_id, month, day, birth_year
     FROM birthdays
     WHERE last_celebrated IS DISTINCT FROM $1`,
    [currentYear],
  );
  return rows;
}

/** Stamps the dedupe year after a successful celebration. */
export async function markCelebrated(guildId, userId, year) {
  await query(
    `UPDATE birthdays SET last_celebrated = $3
     WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId, year],
  );
}

/**
 * Who was celebrated THIS year (for the next day's role removal —
 * the caller filters to yesterday's dates with the pure helper).
 */
export async function getCelebratedThisYear(year) {
  const { rows } = await query(
    `SELECT guild_id, user_id, month, day FROM birthdays
     WHERE last_celebrated = $1`,
    [year],
  );
  return rows;
}
