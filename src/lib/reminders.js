// ============================================================
// reminders.js (lib) — The pure half of reminder delivery: the
// message payload builder. Pure so the two properties that
// MATTER are unit-testable: (1) allowedMentions pins the ping
// to the reminder's owner — a stored "@everyone party time"
// can never become a scheduled mass-ping; (2) late deliveries
// apologize honestly.
// ============================================================

/**
 * Builds the Discord message payload for one reminder.
 * `reminder` carries { userId, message, createdEpoch, remindEpoch }
 * (epochs in SECONDS — they come straight from EXTRACT(EPOCH ...)).
 * `nowMs` is injected for testability.
 */
export function buildReminderPayload(reminder, nowMs, lateAfterSec = 300) {
  const lateBySec = nowMs / 1000 - reminder.remindEpoch;
  const apology =
    lateBySec > lateAfterSec
      ? '*(sorry — delivered late, I was offline)*\n'
      : '';

  return {
    content:
      `${apology}<@${reminder.userId}> ⏰ Reminder: ${reminder.message}\n` +
      `-# set <t:${reminder.createdEpoch}:R>`,
    // THE safety property: whatever the stored message contains —
    // @everyone, @here, role pings — only the owner is ever pinged.
    allowedMentions: { users: [reminder.userId] },
  };
}
