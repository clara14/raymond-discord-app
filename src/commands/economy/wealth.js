// ============================================================
// wealth.js (command) — The time machine: net-worth-over-time
// as a sparkline (the v1 zero-dependency chart tier), plus
// all-time high, server percentile, and recent deltas. Built on
// the running-SUM window query in analytics.js.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { worthHistory, worthByUser } from '../../database/analytics.js';
import { sparkline } from '../../lib/sparkline.js';
import { percentileRank } from '../../lib/stats.js';
import { ensureWelcomeBonus } from '../../database/economy.js';
import { formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('wealth')
  .setDescription('Your net worth over time — the wealth time machine.')
  .addUserOption((o) =>
    o.setName('user').setDescription('Whose history (default: you)').setRequired(false),
  )
  .addIntegerOption((o) =>
    o
      .setName('days')
      .setDescription('Window to the last N days (default: all time)')
      .setRequired(false)
      .setMinValue(2),
  )
  .addBooleanOption((o) =>
    o.setName('public').setDescription('Show to the whole channel (default: just you)').setRequired(false),
  );

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const days = interaction.options.getInteger('days');
  const isPublic = interaction.options.getBoolean('public') ?? false;

  await interaction.deferReply(isPublic ? {} : { flags: MessageFlags.Ephemeral });
  await ensureWelcomeBonus(interaction.guildId, target.id);

  const history = await worthHistory(interaction.guildId, target.id, days);
  if (history.length === 0) {
    await interaction.editReply('No history in that window — nothing to chart yet.');
    return;
  }

  const worths = history.map((h) => h.worth);
  const current = worths[worths.length - 1];

  // All-time high and when it happened (first day it was reached).
  const athIndex = worths.indexOf(Math.max(...worths));
  const ath = history[athIndex];

  // Deltas: worth now vs the last close ≥ N days back (clamped to the
  // start of the visible window).
  const deltaSince = (n) => {
    const cutoff = history.length - 1 - n;
    const base = history[Math.max(0, cutoff)].worth;
    return current - base;
  };
  const fmtDelta = (d) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toLocaleString()}`;

  // Standing among everyone with a ledger.
  const everyone = (await worthByUser(interaction.guildId)).map((w) => w.worth);
  const pct = percentileRank(everyone, current);

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
    .setTitle(`📈 Wealth history${days ? ` — last ${days} days` : ''}`)
    .setDescription(
      `\`${sparkline(worths)}\`\n` +
        `${history[0].day} → ${history[history.length - 1].day}`,
    )
    .addFields(
      { name: 'Now', value: `**${formatCurrency(current)}**`, inline: true },
      {
        name: 'All-time high',
        value: `${formatCurrency(ath.worth)}\n-# on ${ath.day}`,
        inline: true,
      },
      {
        name: 'Standing',
        value: `Richer than **${pct.toFixed(0)}%** of members`,
        inline: true,
      },
      {
        name: 'Momentum',
        value: `7d: **${fmtDelta(deltaSince(7))}** · 30d: **${fmtDelta(deltaSince(30))}**`,
      },
    );

  await interaction.editReply({ embeds: [embed] });
}
