// ============================================================
// reminders.js (database) — The durable job queue's row moves:
// create (with the per-user cap), list, cancel (ownership in
// the WHERE, not in app code), claim-due (FOR UPDATE SKIP
// LOCKED), mark-delivered, and the history cleanup.
// remind_at is always computed by the DATABASE clock.
// ============================================================

import { query } from './db.js';
import { withTransaction } from './tx.js';
import { REMINDERS } from '../config.js';

/**
 * Creates a reminder `delaySec` from now (DB clock). Enforces the
 * per-user pending cap. Returns { ok:false, reason:'too_many' } or
 * { ok:true, id, remindEpoch } (epoch seconds, for the <t:...> stamp).
 */
export async function createReminder(guildId, channelId, userId, message, delaySec) {
  // Cap check + insert aren't one atomic statement, so a determined
  // spammer double-clicking could land 16/15. The cap is UX guidance,
  // not a security boundary — not worth a lock.
  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS n FROM reminders
     WHERE user_id = $1 AND delivered_at IS NULL`,
    [userId],
  );
  if (countRows[0].n >= REMINDERS.maxPending) {
    return { ok: false, reason: 'too_many' };
  }

  const { rows } = await query(
    `INSERT INTO reminders (guild_id, channel_id, user_id, message, remind_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5::float8))
     RETURNING id, EXTRACT(EPOCH FROM remind_at)::bigint AS remind_epoch`,
    [guildId, channelId, userId, message, delaySec],
  );
  return { ok: true, id: Number(rows[0].id), remindEpoch: Number(rows[0].remind_epoch) };
}

/** The caller's pending reminders in this guild, soonest first. */
export async function listPending(guildId, userId) {
  const { rows } = await query(
    `SELECT id, message,
            EXTRACT(EPOCH FROM remind_at)::bigint AS remind_epoch
     FROM reminders
     WHERE guild_id = $1 AND user_id = $2 AND delivered_at IS NULL
     ORDER BY remind_at ASC`,
    [guildId, userId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    message: r.message,
    remindEpoch: Number(r.remind_epoch),
  }));
}

/**
 * Cancels a pending reminder. Ownership and pending-ness live in the
 * WHERE clause — someone else's id (or an already-delivered one) simply
 * matches zero rows, with no app-layer check to get wrong.
 */
export async function cancelReminder(id, userId) {
  const { rowCount } = await query(
    `DELETE FROM reminders
     WHERE id = $1 AND user_id = $2 AND delivered_at IS NULL`,
    [id, userId],
  );
  return rowCount > 0;
}

/**
 * The scheduler's claim: everything due and undelivered, oldest first,
 * capped per cycle. FOR UPDATE SKIP LOCKED is the textbook job-queue
 * hardening: were two schedulers ever polling at once, each would skip
 * rows the other has locked instead of double-claiming or blocking.
 * (One clause, free education — and harmless with a single poller.)
 */
export function claimDueReminders(limit) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, guild_id, channel_id, user_id, message,
              EXTRACT(EPOCH FROM created_at)::bigint AS created_epoch,
              EXTRACT(EPOCH FROM remind_at)::bigint  AS remind_epoch
       FROM reminders
       WHERE delivered_at IS NULL AND remind_at <= now()
       ORDER BY remind_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      guildId: r.guild_id,
      channelId: r.channel_id,
      userId: r.user_id,
      message: r.message,
      createdEpoch: Number(r.created_epoch),
      remindEpoch: Number(r.remind_epoch),
    }));
  });
}

/**
 * Stamps delivery AFTER the send attempt — a crash in between means one
 * duplicate delivery after restart, which is the right failure
 * direction (at-least-once beats silently-never).
 */
export async function markDelivered(id) {
  await query(`UPDATE reminders SET delivered_at = now() WHERE id = $1`, [id]);
}

/**
 * Cleanup (rides the daily task registry). The spec said "delete old
 * delivered rows", but the reminder_veteran achievement counts LIFETIME
 * deliveries — deleting rows would silently reset that count. So the
 * cleanup scrubs the MESSAGE (the only part with privacy weight or
 * meaningful size) and keeps the skeletal row: the count stays true and
 * the table stays effectively tiny. Idempotent via the message guard.
 */
export async function cleanupDelivered(olderThanDays) {
  const { rowCount } = await query(
    `UPDATE reminders SET message = ''
     WHERE delivered_at IS NOT NULL
       AND delivered_at < now() - make_interval(days => $1)
       AND message <> ''`,
    [olderThanDays],
  );
  return rowCount;
}
