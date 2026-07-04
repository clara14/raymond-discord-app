// ============================================================
// birthdayJob.js (task) — The first daily job: celebrate every
// registered birthday. Per celebrant: credit the monies gift
// (a normal hash-chained ledger row), announce in the guild's
// announce channel (one message per guild, listing everyone),
// optionally grant a birthday role for the day, and stamp
// last_celebrated so restarts and double-runs can't re-gift.
// ============================================================

import {
  getDbToday,
  getCelebrationCandidates,
  markCelebrated,
  getCelebratedThisYear,
} from '../database/birthdays.js';
import { isCelebrationDay, previousDay } from '../lib/birthdays.js';
import { addTransaction } from '../database/economy.js';
import { getAnnounceChannel } from '../database/guildSettings.js';
import { checkAchievements } from '../database/achievements.js';
import { announceToChannel } from '../lib/achievements.js';
import { BIRTHDAY, formatCurrency } from '../config.js';

let clientRef = null;

/** Remembers the client; called from ready.js before registration. */
export function initBirthdayJob(client) {
  clientRef = client;
}

/** The job itself — registered with the daily task runner. */
export async function runBirthdayJob() {
  const today = await getDbToday();

  // Yesterday's birthday role comes off before today's goes on.
  await removeYesterdaysRoles(today).catch((err) =>
    console.error('Birthday role removal error:', err.message),
  );

  // Broad cheap fetch, then the pure tested helper decides who
  // celebrates today (including the Feb 29 → Mar 1 leapling rule).
  const candidates = await getCelebrationCandidates(today.year);
  const celebrants = candidates.filter((c) => isCelebrationDay(c.month, c.day, today));
  if (celebrants.length === 0) return;

  // Group by guild: one announcement per guild beats N messages.
  const byGuild = new Map();
  for (const c of celebrants) {
    if (!byGuild.has(c.guild_id)) byGuild.set(c.guild_id, []);
    byGuild.get(c.guild_id).push(c);
  }

  for (const [guildId, guildCelebrants] of byGuild) {
    await celebrateGuild(guildId, guildCelebrants, today).catch((err) =>
      console.error(`Birthday job error in guild ${guildId}:`, err.message),
    );
  }
}

// Runs one guild's celebration: gifts, marks, role, announcement.
async function celebrateGuild(guildId, celebrants, today) {
  // If the bot can't see the guild at all, skip WITHOUT marking anyone —
  // they'll be retried tomorrow (or when the bot rejoins).
  const guild = await clientRef.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const celebrated = [];
  for (const c of celebrants) {
    // Departed members are skipped without marking, so a leaver who
    // returns later the same year still gets their party.
    const member = await guild.members.fetch(c.user_id).catch(() => null);
    if (!member) continue;

    // The gift: an ordinary ledger credit — hash-chained and auditable
    // like every other money movement.
    await addTransaction(guildId, c.user_id, BIRTHDAY.gift, 'birthday', {
      year: today.year,
    });
    await markCelebrated(guildId, c.user_id, today.year);
    celebrated.push(c);

    // Optional party hat. Failures (missing perms, deleted role) are
    // logged and never fatal — the gift already landed.
    if (BIRTHDAY.roleId) {
      await member.roles.add(BIRTHDAY.roleId).catch((err) =>
        console.error(`Birthday role add failed for ${c.user_id}:`, err.message),
      );
    }
  }
  if (celebrated.length === 0) return;

  // One announcement listing every celebrant, ages only where opted in.
  const channelId = await getAnnounceChannel(guildId);
  if (channelId) {
    const lines = celebrated.map((c) => {
      const age = c.birth_year ? ` — turning **${today.year - c.birth_year}** today!` : '';
      return `🎂 Happy birthday <@${c.user_id}>!${age}`;
    });
    try {
      const channel = await clientRef.channels.fetch(channelId);
      await channel.send({
        content:
          `${lines.join('\n')}\n` +
          `🎁 Each of you just received **${formatCurrency(BIRTHDAY.gift)}**.`,
      });
    } catch (err) {
      console.error('Birthday announce error:', err.message);
    }
  }

  // Achievement pass per celebrant (It's My Day) — announced alongside.
  for (const c of celebrated) {
    const earned = await checkAchievements(guildId, c.user_id, 'birthday', {
      year: today.year,
    });
    await announceToChannel(clientRef, channelId, `<@${c.user_id}>`, earned);
  }
}

// Takes yesterday's birthday role off its celebrants (only relevant when
// the role feature is configured).
async function removeYesterdaysRoles(today) {
  if (!BIRTHDAY.roleId) return;

  const yesterday = previousDay(today);
  // Celebrants are stamped with the year they were celebrated IN — which
  // for yesterday is yesterday.year (matters exactly on Jan 1).
  const stamped = await getCelebratedThisYear(yesterday.year);
  const wasYesterday = stamped.filter((c) =>
    isCelebrationDay(c.month, c.day, yesterday),
  );

  for (const c of wasYesterday) {
    const guild = await clientRef.guilds.fetch(c.guild_id).catch(() => null);
    const member = await guild?.members.fetch(c.user_id).catch(() => null);
    await member?.roles.remove(BIRTHDAY.roleId).catch((err) =>
      console.error(`Birthday role removal failed for ${c.user_id}:`, err.message),
    );
  }
}
