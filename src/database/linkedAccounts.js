// ============================================================
// linkedAccounts.js (database) — Discord user <-> Riot account
// mapping. The foundation for all LoL features: match
// announcements, betting, and ranks all start from PUUIDs.
// ============================================================

import { query } from './db.js';

/**
 * Links (or re-links) a Discord user to a Riot account. Upsert on the
 * Discord user: re-running /link simply points them at the new account.
 * The UNIQUE constraint on puuid prevents two Discord users claiming the
 * same Riot account — that surfaces as an error the command translates.
 */
export async function linkAccount(userId, puuid, gameName, tagLine) {
  await query(
    `INSERT INTO linked_accounts (user_id, puuid, game_name, tag_line)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id)
     DO UPDATE SET puuid = $2, game_name = $3, tag_line = $4, linked_at = now()`,
    [userId, puuid, gameName, tagLine],
  );
}

/** Removes a user's link. Returns true if there was one to remove. */
export async function unlinkAccount(userId) {
  const { rowCount } = await query(
    `DELETE FROM linked_accounts WHERE user_id = $1`,
    [userId],
  );
  return rowCount > 0;
}

/** A single user's link, or null. */
export async function getLink(userId) {
  const { rows } = await query(
    `SELECT user_id, puuid, game_name, tag_line
     FROM linked_accounts WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

/** Every linked account — what the match poller iterates over. */
export async function getAllLinks() {
  const { rows } = await query(
    `SELECT user_id, puuid, game_name, tag_line FROM linked_accounts`,
  );
  return rows;
}
