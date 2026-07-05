// ============================================================
// reminderScheduler.js (task) — Delivers due reminders. The
// poller pattern again (self-rescheduling setTimeout, survives
// everything), every 30s: claim due rows, deliver each, mark
// delivered. Deliberately NOT one setTimeout per reminder —
// long timers drift, die on restart, and overflow 32-bit ms;
// the table is the state and polling reads it.
// ============================================================

import { claimDueReminders, markDelivered } from '../database/reminders.js';
import { buildReminderPayload } from '../lib/reminders.js';
import { checkAchievements } from '../database/achievements.js';
import { announceToChannel } from '../lib/achievements.js';
import { REMINDERS } from '../config.js';

let clientRef = null;

/** Starts the delivery loop. Called once from the ready event. */
export function startReminderScheduler(client) {
  clientRef = client;
  console.log(`  ✓ Reminder scheduler running (every ${REMINDERS.pollIntervalSec}s)`);
  scheduleNext(10_000); // first look shortly after boot (catch missed ones)
}

function scheduleNext(ms = REMINDERS.pollIntervalSec * 1000) {
  setTimeout(async () => {
    try {
      await pollOnce();
    } catch (err) {
      // The loop must survive anything — log and keep going.
      console.error('Reminder scheduler error:', err);
    }
    scheduleNext();
  }, ms);
}

async function pollOnce() {
  const due = await claimDueReminders(REMINDERS.batchLimit);
  for (const reminder of due) {
    await deliver(reminder);
  }
}

// Delivers one reminder: channel first, DM fallback, then mark. Marking
// happens AFTER the attempts — undeliverable ≠ retry-forever, but a
// crash mid-delivery re-runs it next cycle (at-least-once).
async function deliver(reminder) {
  const payload = buildReminderPayload(reminder, Date.now(), REMINDERS.lateAfterSec);

  // Preferred: the channel where the reminder was set (the user chose
  // it — losing read access since doesn't change that choice).
  let deliveredInChannel = false;
  try {
    const channel = await clientRef.channels.fetch(reminder.channelId);
    await channel.send(payload);
    deliveredInChannel = true;
  } catch {
    // Channel gone or unwritable — fall back to a DM.
    try {
      const user = await clientRef.users.fetch(reminder.userId);
      await user.send(payload);
    } catch (err) {
      // Both routes dead (left the server, DMs closed). Mark anyway,
      // with a log — the alternative is retrying forever.
      console.error(
        `Reminder ${reminder.id} undeliverable (channel + DM failed):`, err.message,
      );
    }
  }

  await markDelivered(reminder.id);

  // Delivery-count achievement pass; announced in the reminder's channel
  // when that worked (a DM-only delivery keeps the trophy quiet — it
  // still shows in /achievements).
  const earned = await checkAchievements(reminder.guildId, reminder.userId, 'reminder_delivered', {});
  if (deliveredInChannel) {
    await announceToChannel(clientRef, reminder.channelId, `<@${reminder.userId}>`, earned);
  }
}
