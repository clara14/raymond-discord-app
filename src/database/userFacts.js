// ============================================================
// userFacts.js (database) — Background trivia members teach the
// bot about each other, injected into the chat prompt so the
// personality "knows" people. Managed via the /fact command.
// ============================================================

import { query } from './db.js';

// Guardrails: keep the prompt small and one person from being spammed.
export const MAX_FACTS_PER_USER = 10;
export const MAX_FACT_LENGTH = 200;

/**
 * Adds a fact about a user. Enforces the per-user cap.
 * Returns { ok:true, id } or { ok:false, reason:'too_many' }.
 */
export async function addFact(guildId, userId, addedBy, fact) {
  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS n FROM user_facts
     WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId],
  );
  if (countRows[0].n >= MAX_FACTS_PER_USER) {
    return { ok: false, reason: 'too_many' };
  }

  const { rows } = await query(
    `INSERT INTO user_facts (guild_id, user_id, added_by, fact)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [guildId, userId, addedBy, fact],
  );
  return { ok: true, id: rows[0].id };
}

/** All facts about one user, oldest first (for /fact list). */
export async function getFacts(guildId, userId) {
  const { rows } = await query(
    `SELECT id, fact, added_by FROM user_facts
     WHERE guild_id = $1 AND user_id = $2
     ORDER BY id ASC`,
    [guildId, userId],
  );
  return rows;
}

/**
 * Deletes a fact by id, but only if the requester added it or has mod
 * override (checked by the command). Returns the deleted row or null.
 */
export async function removeFact(guildId, factId, requesterId, isMod) {
  const { rows } = await query(
    isMod
      ? `DELETE FROM user_facts WHERE guild_id = $1 AND id = $2 RETURNING id`
      : `DELETE FROM user_facts WHERE guild_id = $1 AND id = $2 AND added_by = $3 RETURNING id`,
    isMod ? [guildId, factId] : [guildId, factId, requesterId],
  );
  return rows[0] ?? null;
}

/**
 * Facts about a set of users at once (the people in the current
 * conversation), for prompt injection. Returns rows with user_id + fact.
 */
export async function getFactsForUsers(guildId, userIds) {
  if (userIds.length === 0) return [];
  const { rows } = await query(
    `SELECT user_id, fact FROM user_facts
     WHERE guild_id = $1 AND user_id = ANY($2)
     ORDER BY user_id, id`,
    [guildId, userIds],
  );
  return rows;
}
