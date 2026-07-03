// ============================================================
// achievements.js (lib) — Announcement rendering for earned
// achievements: the embed builder (pure, unit-tested) and the
// interaction follow-up helper commands call after wiring in
// checkAchievements. Background/sweep announcements come in
// phase 3 and will reuse the same embed builder.
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
 */
export async function announceAchievements(interaction, earned) {
  if (!earned || earned.length === 0) return;
  const name = interaction.user.displayName ?? interaction.user.username;
  await interaction
    .followUp({ embeds: [achievementEmbed(name, earned)] })
    .catch(() => {});
}
