// ============================================================
// cooldowns.js — Generic per-user, per-command rate limiting.
// Any command that should only run every N seconds uses this.
// ============================================================

import { query } from './db.js';

/**
 * Atomically tries to "claim" a command use for a user.
 *
 * The whole check-and-claim is one SQL statement so it's race-safe: two
 * rapid calls can't both succeed. How it works:
 *  - If there's no cooldown row yet, INSERT it and return the row → allowed.
 *  - If a row exists, ON CONFLICT runs the UPDATE, but only WHERE enough
 *    time has passed. If the cooldown is still active, the WHERE is false,
 *    nothing updates, and no row is returned → blocked.
 *
 * Returns { ok: true } if allowed (and the cooldown was just reset), or
 * { ok: false, remainingSec } if still on cooldown.
 */
export async function tryUseCooldown(guildId, userId, command, durationSec) {
  const { rows } = await query(
    `INSERT INTO cooldowns (guild_id, user_id, command, last_used)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (guild_id, user_id, command)
     DO UPDATE SET last_used = now()
       WHERE cooldowns.last_used <= now() - make_interval(secs => $4::float8)
     RETURNING last_used`,
    [guildId, userId, command, durationSec],
  );

  // A returned row means the claim succeeded.
  if (rows.length > 0) {
    return { ok: true };
  }

  // Otherwise they're still on cooldown — work out how much time is left.
  // (A tiny race here only affects the displayed number, not correctness.)
  const { rows: remaining } = await query(
    `SELECT EXTRACT(EPOCH FROM (
       last_used + make_interval(secs => $4::float8) - now()
     )) AS remaining_sec
     FROM cooldowns
     WHERE guild_id = $1 AND user_id = $2 AND command = $3`,
    [guildId, userId, command, durationSec],
  );

  const remainingSec = remaining.length
    ? Math.max(0, Math.ceil(Number(remaining[0].remaining_sec)))
    : 0;

  return { ok: false, remainingSec };
}

/**
 * Read-only check: is this cooldown currently active, and how long remains?
 * Unlike tryUseCooldown, this CLAIMS NOTHING — use it when you need to know
 * the state before deciding whether to consume other cooldowns (e.g. /rob
 * peeks the robber's cooldown before claiming the victim's shield, so a
 * blocked robber doesn't waste the victim's protection).
 * Returns { active, remainingSec }.
 */
export async function peekCooldown(guildId, userId, command, durationSec) {
  const { rows } = await query(
    `SELECT GREATEST(0, EXTRACT(EPOCH FROM (
       last_used + make_interval(secs => $4::float8) - now()
     )))::float8 AS remaining_sec
     FROM cooldowns
     WHERE guild_id = $1 AND user_id = $2 AND command = $3`,
    [guildId, userId, command, durationSec],
  );

  const remainingSec = rows.length ? Math.ceil(Number(rows[0].remaining_sec)) : 0;
  return { active: remainingSec > 0, remainingSec };
}
