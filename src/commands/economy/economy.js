// ============================================================
// economy.js (command) — The macro dashboard: money supply,
// faucets vs sinks, velocity, inequality (gini), concentration,
// and the house report. Mod-gated like /audit. A thin renderer
// over database/analytics.js — the queries are the product.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } from 'discord.js';
import { renderBarChart } from '../../lib/charts.js';
import {
  moneySupply,
  flowWindow,
  velocity,
  worthByUser,
  houseReport,
} from '../../database/analytics.js';
import { gini } from '../../lib/gini.js';
import { mean, median } from '../../lib/stats.js';
import { checkAchievements } from '../../database/achievements.js';
import { announceAchievements } from '../../lib/achievements.js';
import { formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('economy')
  .setDescription('The server\'s macroeconomic dashboard (moderators only).')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  // Several aggregate passes over the whole ledger — defer past 3s.
  await interaction.deferReply();
  const guildId = interaction.guildId;

  const [supply, flow7, flow30, velo, worths, house] = await Promise.all([
    moneySupply(guildId),
    flowWindow(guildId, 7),
    flowWindow(guildId, 30),
    velocity(guildId, 30),
    worthByUser(guildId),
    houseReport(guildId),
  ]);

  const worthValues = worths.map((w) => w.worth);
  const g = gini(worthValues);
  const top3Share =
    supply.total > 0
      ? ([...worthValues].sort((a, b) => b - a).slice(0, 3).reduce((s, v) => s + v, 0) /
          supply.total) * 100
      : 0;

  const flowLine = (label, f) =>
    `${label}: minted **${formatCurrency(f.minted)}**, burned **${formatCurrency(f.burned)}** ` +
    `(net ${f.net >= 0 ? '+' : ''}${f.net.toLocaleString()})`;

  const houseLines = house
    .filter((h) => h.observedPct !== null)
    .map((h) =>
      `**${h.game}** — observed RTP ${h.observedPct.toFixed(1)}% vs ~${h.designedPct}% designed ` +
      `(${formatCurrency(h.wagered)} wagered)`,
    );

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`📊 ${interaction.guild.name} — economic report`)
    .addFields(
      {
        name: 'Money supply',
        value:
          `Total: **${formatCurrency(supply.total)}**\n` +
          `Wallets: ${formatCurrency(supply.wallets - supply.banked)} · ` +
          `Banked: ${formatCurrency(supply.banked)} · ` +
          `Raffle jar: ${formatCurrency(supply.jar)}`,
      },
      {
        name: 'Faucets vs sinks',
        value: `${flowLine('7d', flow7)}\n${flowLine('30d', flow30)}`,
      },
      {
        name: 'Velocity (30d)',
        value:
          `${formatCurrency(velo.volume)} transferred between members — ` +
          `${velo.ratioPct.toFixed(0)}% of the supply changed hands.`,
      },
      {
        name: 'Inequality',
        value:
          `Gini coefficient: **${g.toFixed(2)}** (0 = equal, 1 = one owns all)\n` +
          `Top 3 hold **${top3Share.toFixed(0)}%** of all monies · ` +
          `median worth ${formatCurrency(Math.round(median(worthValues)))} vs ` +
          `mean ${formatCurrency(Math.round(mean(worthValues)))}`,
      },
      {
        name: 'House report',
        value: houseLines.length > 0 ? houseLines.join('\n') : 'No games played yet.',
      },
    );

  // Minted vs burned as a bar chart — the health metric at a glance.
  // Numbers stay in the fields above, so a render failure costs nothing.
  let files = [];
  try {
    const png = await renderBarChart('Money flow — minted vs burned', [
      { label: 'Minted (7d)', value: flow7.minted, color: '#2ecc71' },
      { label: 'Burned (7d)', value: flow7.burned, color: '#e74c3c' },
      { label: 'Minted (30d)', value: flow30.minted, color: '#2ecc71' },
      { label: 'Burned (30d)', value: flow30.burned, color: '#e74c3c' },
    ]);
    if (png) {
      files = [new AttachmentBuilder(png, { name: 'flow.png' })];
      embed.setImage('attachment://flow.png');
    }
  } catch (err) {
    console.error('Economy chart render failed:', err.message);
  }

  await interaction.editReply({ embeds: [embed], files });

  // The Concerned Economist checks ride the analytics trigger.
  const earned = await checkAchievements(guildId, interaction.user.id, 'analytics', {
    command: 'economy',
  });
  await announceAchievements(interaction, earned);
}
