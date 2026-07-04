// ============================================================
// guildSettings.js (database) — Per-server configuration, one
// row per guild in guild_settings. Currently that's just the
// LoL announcement channel, but future settings (quote channel,
// birthday channel, ...) belong here too — as new columns, via
// additive migrations in db.js.
// ============================================================

import { query } from './db.js';

/** The channel configured for LoL announcements in a guild (or null). */
export async function getLolChannel(guildId) {
  const { rows } = await query(
    `SELECT lol_channel_id FROM guild_settings WHERE guild_id = $1`,
    [guildId],
  );
  return rows[0]?.lol_channel_id ?? null;
}

/** Sets (or clears, with null) the LoL announcement channel for a guild. */
export async function setLolChannel(guildId, channelId) {
  // Upsert: first configuration inserts the guild's row; later changes
  // update it in place. One row per guild, always.
  await query(
    `INSERT INTO guild_settings (guild_id, lol_channel_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET lol_channel_id = $2`,
    [guildId, channelId],
  );
}

/** Every guild that has an announcement channel configured. */
export async function getConfiguredGuilds() {
  const { rows } = await query(
    `SELECT guild_id, lol_channel_id FROM guild_settings
     WHERE lol_channel_id IS NOT NULL`,
  );
  return rows;
}

/**
 * The guild's general announcement channel (achievement sweeps,
 * birthdays, future daily jobs): the dedicated announce channel if set
 * via /announcechannel, else the LoL channel, else null (stay silent).
 */
export async function getAnnounceChannel(guildId) {
  const { rows } = await query(
    `SELECT COALESCE(announce_channel_id, lol_channel_id) AS channel_id
     FROM guild_settings WHERE guild_id = $1`,
    [guildId],
  );
  return rows[0]?.channel_id ?? null;
}

/** Sets (or clears, with null) the dedicated announcement channel. */
export async function setAnnounceChannel(guildId, channelId) {
  await query(
    `INSERT INTO guild_settings (guild_id, announce_channel_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET announce_channel_id = $2`,
    [guildId, channelId],
  );
}
