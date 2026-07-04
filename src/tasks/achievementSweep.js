// ============================================================
// achievementSweep.js (task) — The slow safety net under the
// event-driven achievement system. Every hour it re-runs every
// catalog check (event = null) for every active user, awarding
// whatever the data supports. This makes the system:
//  - self-healing: a crash between "action committed" and
//    "achievement checked" only delays the trophy an hour
//  - retroactive: a brand-new catalog entry is granted to
//    everyone who already qualifies on the next pass (the
//    first pass after boot IS the backfill run)
// Same survival pattern as the match poller: self-rescheduling
// setTimeout, never setInterval, survives every error.
// ============================================================

import { query } from '../database/db.js';
import { sweepUser } from '../database/achievements.js';
import { getAchievementChannel } from '../database/guildSettings.js';
import { announceToChannel } from '../lib/achievements.js';
import { ACHIEVEMENT_SWEEP } from '../config.js';

let clientRef = null;

/** Starts the sweep loop. Called once from the ready event. */
export function startAchievementSweep(client) {
  clientRef = client;
  console.log(`  ✓ Achievement sweep running (every ${ACHIEVEMENT_SWEEP.intervalSec}s)`);
  // The first pass runs shortly after boot — that's the retroactive
  // backfill working through whatever history predates the catalog.
  scheduleNext(ACHIEVEMENT_SWEEP.startupDelaySec * 1000);
}

function scheduleNext(ms = ACHIEVEMENT_SWEEP.intervalSec * 1000) {
  setTimeout(async () => {
    try {
      await sweepOnce();
    } catch (err) {
      // The loop must survive anything — log and keep going.
      console.error('Achievement sweep error:', err);
    }
    scheduleNext();
  }, ms);
}

/**
 * Everyone the sweep should look at: each (guild, user) pair that has
 * ever touched the ledger. The regex filter drops sentinel "users" like
 * the raffle jar — Discord snowflakes are purely numeric, sentinels
 * deliberately aren't, and a jar with a trophy case would be absurd.
 */
async function getActiveUsers() {
  const { rows } = await query(
    `SELECT DISTINCT guild_id, user_id FROM transactions
     WHERE user_id ~ '^[0-9]+$'`,
  );
  return rows;
}

// One full pass over every active user. Sequential on purpose: this is
// a background chore for a friends server, and a gentle stream of small
// indexed queries beats a thundering herd once an hour.
async function sweepOnce() {
  const users = await getActiveUsers();
  let awarded = 0;

  // Announce channels are per-guild; cache them across users.
  const channelCache = new Map();

  for (const { guild_id, user_id } of users) {
    const earned = await sweepUser(guild_id, user_id);
    if (earned.length === 0) continue;
    awarded += earned.length;

    if (!channelCache.has(guild_id)) {
      channelCache.set(guild_id, await getAchievementChannel(guild_id));
    }
    // Null channel = configured silence; the trophies still show in
    // /achievements, which is the durable record anyway.
    await announceToChannel(clientRef, channelCache.get(guild_id), `<@${user_id}>`, earned);
  }

  if (awarded > 0) {
    console.log(`  🏆 Achievement sweep granted ${awarded} award(s) across ${users.length} user(s)`);
  }
}
