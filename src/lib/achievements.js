// ============================================================
// achievements.js (lib) — Announcement rendering for earned
// achievements: the embed builder (pure, unit-tested), the
// interaction follow-up helper commands call after wiring in
// checkAchievements, and the channel announcer used by
// background earners (match poller settlements/history sync).
// ============================================================

import { EmbedBuilder } from 'discord.js';
import { TIERS } from '../data/achievements.js';

/**
 * Pure function: one embed announcing 1..n newly earned achievements.
 * The embed takes the color of the FANCIEST tier in the batch — if a
 * legendary lands alongside a common, the moment is gold.
 */
export function achievementEmbed(displayName, earned) {
  const top = earned.reduce(
    (best, a) => (TIERS[a.tier].rank > TIERS[best.tier].rank ? a : best),
    earned[0],
  );

  const lines = earned.map(
    (a) => `${TIERS[a.tier].marker} ${a.emoji} **${a.name}** — ${a.description}`,
  );

  return new EmbedBuilder()
    .setColor(TIERS[top.tier].color)
    .setDescription(
      `🏆 **${displayName}** earned ${earned.length === 1 ? 'an achievement' : `${earned.length} achievements`}!\n\n` +
        lines.join('\n'),
    );
}

/**
 * Posts the announcement as a follow-up to the interaction that earned
 * it. Safe to call unconditionally: no-ops on an empty list, and a
 * failed follow-up (deleted channel, missing perms) is swallowed — the
 * award is already saved and shows in /achievements regardless.
 * Follow-ups are public even when the original reply was ephemeral,
 * which is exactly what we want: the flex is the announcement.
 *
 * `displayName` overrides who the trophy is credited to — for awards
 * where the earner isn't the person who ran the command (the raffle
 * winner on a mod's /raffle draw, the victim of a /rob). A user mention
 * string like `<@id>` works too; Discord renders it inside embeds.
 */
export async function announceAchievements(interaction, earned, displayName = null) {
  if (!earned || earned.length === 0) return;
  const name =
    displayName ?? interaction.user.displayName ?? interaction.user.username;
  await interaction
    .followUp({ embeds: [achievementEmbed(name, earned)] })
    .catch(() => {});
}

/**
 * Background counterpart: posts the announcement straight to a channel,
 * for achievements earned with no interaction to follow up on (bet
 * settlements, match-history sync — and the phase-3 sweep). Same
 * swallow-everything contract: the award is already durable.
 */
export async function announceToChannel(client, channelId, displayName, earned) {
  if (!earned || earned.length === 0 || !channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    await channel.send({ embeds: [achievementEmbed(displayName, earned)] });
  } catch (err) {
    console.error('Achievement channel announce error:', err.message);
  }
}
