// ============================================================
// compare.js (command) — Head-to-head: two members' wealth
// histories as stacked sparklines plus a stat table. Rivalry
// fuel, assembled entirely from analytics.js reads.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import { worthHistory, personalReport } from '../../database/analytics.js';
import { getCurrentStreak } from '../../database/stats.js';
import { renderTimeSeries } from '../../lib/charts.js';
import { sparkline } from '../../lib/sparkline.js';
import { ensureWelcomeBonus } from '../../database/economy.js';
import { formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('compare')
  .setDescription('Head-to-head wealth and stats for two members.')
  .addUserOption((o) =>
    o.setName('first').setDescription('First contender').setRequired(true),
  )
  .addUserOption((o) =>
    o.setName('second').setDescription('Second contender').setRequired(true),
  );

export async function execute(interaction) {
  const a = interaction.options.getUser('first');
  const b = interaction.options.getUser('second');

  if (a.id === b.id) {
    await interaction.reply({
      content: 'Comparing someone to themselves is a tie. Every time.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();
  const guildId = interaction.guildId;
  await ensureWelcomeBonus(guildId, a.id);
  await ensureWelcomeBonus(guildId, b.id);

  // Everything for both sides, concurrently — all reads.
  const [histA, histB, repA, repB, streakA, streakB] = await Promise.all([
    worthHistory(guildId, a.id),
    worthHistory(guildId, b.id),
    personalReport(guildId, a.id),
    personalReport(guildId, b.id),
    getCurrentStreak(guildId, a.id),
    getCurrentStreak(guildId, b.id),
  ]);

  const worthNow = (hist) => (hist.length > 0 ? hist[hist.length - 1].worth : 0);
  const gamblingNet = (rep) =>
    Object.values(rep.gamblingRoi).reduce((sum, g) => sum + g.net, 0);

  // Both histories on ONE chart — the whole point of a head-to-head.
  // Sparklines return per-block if the render fails.
  let files = [];
  try {
    const png = await renderTimeSeries(`${a.username} vs ${b.username} — net worth`, [
      { label: a.username, points: histA.map((h) => ({ day: h.day, value: h.worth })) },
      { label: b.username, points: histB.map((h) => ({ day: h.day, value: h.worth })) },
    ]);
    if (png) files = [new AttachmentBuilder(png, { name: 'compare.png' })];
  } catch (err) {
    console.error('Compare chart render failed (falling back to sparklines):', err.message);
  }
  const withChart = files.length > 0;

  // One block per contender; the sparkline line only appears when the
  // image chart didn't make it.
  const block = (user, hist, rep, streak) =>
    `**${user.username}**\n` +
    (withChart ? '' : `\`${sparkline(hist.map((h) => h.worth))}\`\n`) +
    `Worth: **${formatCurrency(worthNow(hist))}** · ` +
    `Daily streak: ${streak > 0 ? `🔥 ${streak}d` : 'none'} · ` +
    `Gambling: ${gamblingNet(rep) >= 0 ? 'up' : 'down'} ${formatCurrency(Math.abs(gamblingNet(rep)))} · ` +
    `Given away: ${formatCurrency(rep.givenAway)}`;

  const lead = worthNow(histA) - worthNow(histB);
  const verdict =
    lead === 0
      ? 'Dead even. Suspiciously so.'
      : `**${(lead > 0 ? a : b).username}** leads by ${formatCurrency(Math.abs(lead))}.`;

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`⚔️ ${a.username} vs ${b.username}`)
    .setDescription(
      `${block(a, histA, repA, streakA)}\n\n${block(b, histB, repB, streakB)}\n\n${verdict}`,
    );
  if (withChart) embed.setImage('attachment://compare.png');

  await interaction.editReply({ embeds: [embed], files });
}
