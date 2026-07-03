// ============================================================
// chat.js (database) — Stores and retrieves per-channel chat
// history for the @mention conversation feature. Now also
// records the sender's user id so the chat's tools can resolve
// usernames to real accounts.
// ============================================================

import { query } from './db.js';
import { CHAT } from '../config.js';

/**
 * Saves one message (user or assistant) into the channel's history.
 * userId is null for the bot's own replies.
 */
export async function saveChatMessage(guildId, channelId, role, username, content, userId = null) {
  await query(
    `INSERT INTO chat_messages (guild_id, channel_id, role, username, content, user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [guildId, channelId, role, username, content, userId],
  );
}

/**
 * Fetches the recent conversation for a channel, oldest-first, limited to
 * the configured count and age. The inner query grabs the newest N rows;
 * the outer flips them back into chronological order for the API.
 */
export async function getRecentHistory(channelId) {
  const { rows } = await query(
    `SELECT role, username, content, user_id FROM (
       SELECT role, username, content, user_id, created_at
       FROM chat_messages
       WHERE channel_id = $1
         AND created_at > now() - make_interval(mins => $2)
       ORDER BY created_at DESC
       LIMIT $3
     ) recent
     ORDER BY created_at ASC`,
    [channelId, CHAT.historyMaxAgeMin, CHAT.historyLimit],
  );
  return rows;
}
