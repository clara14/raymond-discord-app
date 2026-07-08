// ============================================================
// economy.js (command) — The macroeconomic suite (mod-gated):
//   report   — supply, flows, velocity, inequality, house RTP
//   insights — mobility, correlations, hoarding, jar forensics
//   trend    — weekly gini + jar balance charts over history
// Thin renderers over database/analytics.js — the queries are
// the product.
// ============================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import {
  moneySupply,
  flowWindow,
  velocity,
  worthByUser,
  houseReport,
  wealthMobility,
  correlations,
  hoardingGap,
  weeklyGini,
  jarHistory,
} from '../../database/analytics.js';
import { renderTimeSeries, renderBarChart } from '../../lib/charts.js';
import { gini } from '../../lib/gini.js';
import { mean, median } from '../../lib/stats.js';
import { checkAchievements } from '../../database/achievements.js';
import { announceAchievements } from '../../lib/achievements.js';
import { formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('economy')
  .setDescription('The server\'s macroeconomic dashboards (moderators only).')
  .addSubcommand((sc) =>
    sc.setName('report').setDescription('Supply, flows, inequality, and the house report.'),
  )
  .addSubcommand((sc) =>
    sc.setName('insights').setDescription('Mobility, correlations, hoarding, and jar forensics.'),
  )
  .addSubcommand((sc) =>
    sc.setName('trend').setDescription('Inequality and raffle-jar charts over the whole history.'),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  // Every view runs aggregate passes over the whole ledger — defer.
  await interaction.deferReply();

  const sub = interaction.options.getSubcommand();
  if (sub === 'report') await showReport(interaction);
  if (sub === 'insights') await showInsights(interaction);
  if (sub === 'trend') await showTrend(interaction);

  // The Concerned Economist checks ride the analytics trigger.
  const earned = await checkAchievements(interaction.guildId, interaction.user.id, 'analytics', {
    command: `economy ${sub}`,
  });
  await announceAchievements(interaction, earned);
}

// --- /economy report (the original dashboard) ---
async function showReport(interaction) {
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
          `Wallets: ${formatCurrency(supply.wallets)} · ` +
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

  // Minted vs burned at a glance; numbers live above, so a rendering
  // failure costs nothing.
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
}

// --- /economy insights (the fancy stats) ---
async function showInsights(interaction) {
  const guildId = interaction.guildId;
  const [mobility, corr, hoard, supply] = await Promise.all([
    wealthMobility(guildId, 30),
    correlations(guildId),
    hoardingGap(guildId),
    moneySupply(guildId),
  ]);

  // Biggest climber/faller by rank shift, deltas as tiebreaker.
  const movers = [...mobility].sort(
    (a, b) => b.rankShift - a.rankShift || b.delta - a.delta,
  );
  const climber = movers[0];
  const faller = movers[movers.length - 1];
  const moverLine = (m, arrow) =>
    m
      ? `${arrow} <@${m.userId}> — #${m.rankThen} → #${m.rankNow} ` +
        `(${m.delta >= 0 ? '+' : '−'}${Math.abs(m.delta).toLocaleString()} in 30d)`
      : 'Not enough history yet.';

  // Correlations always ship with the small-n honesty clause.
  const rLine = (label, c) =>
    c.r == null
      ? `${label}: not enough data`
      : `${label}: r = **${c.r.toFixed(2)}** (n = ${c.n} — tiny sample, vibes only)`;

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`🔬 ${interaction.guild.name} — economic insights`)
    .addFields(
      {
        name: 'Wealth mobility (30d)',
        value:
          mobility.length >= 2
            ? `${moverLine(climber, '📈 Climber:')}\n${moverLine(faller, '📉 Faller:')}`
            : 'Not enough members with history yet.',
      },
      {
        name: 'Correlations',
        value:
          `${rLine('Wordle solve rate ↔ worth', corr.wordleVsWorth)}\n` +
          `${rLine('Daily streak ↔ gambling net', corr.streakVsGambling)}`,
      },
      {
        name: 'Hoarding',
        value: hoard
          ? `Monies sit **~${hoard.days.toFixed(1)} days** between an earn and the next spend (${hoard.spends} spends measured).`
          : 'Nobody has spent anything yet. Impressive restraint.',
      },
      {
        name: 'Raffle jar forensics',
        value:
          `Currently holds **${formatCurrency(supply.jar)}**` +
          (supply.jar === 0
            ? ' — exactly 0 between rounds, as the audit gods intended.'
            : ' — a round is open (or something is wrong; see /economy trend).'),
      },
    );

  await interaction.editReply({ embeds: [embed] });
}

// --- /economy trend (charts over the whole history) ---
async function showTrend(interaction) {
  const guildId = interaction.guildId;
  const [giniWeeks, jar] = await Promise.all([weeklyGini(guildId), jarHistory(guildId)]);

  if (giniWeeks.length === 0) {
    await interaction.editReply('No history yet — trends need time.');
    return;
  }

  const embeds = [];
  const files = [];

  try {
    // Gini plotted ×100: the chart's integer axis labels would render
    // a 0..1 series as all-zeros.
    const giniPng = await renderTimeSeries('Inequality over time (gini × 100)', [
      {
        label: 'gini ×100',
        points: giniWeeks.map((w) => ({ day: w.week, value: Math.round(w.gini * 100) })),
      },
    ]);
    if (giniPng) {
      files.push(new AttachmentBuilder(giniPng, { name: 'gini.png' }));
      embeds.push(
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('📈 Is this getting worse?')
          .setDescription(
            `Weekly gini, all time. Now: **${giniWeeks[giniWeeks.length - 1].gini.toFixed(2)}**.`,
          )
          .setImage('attachment://gini.png'),
      );
    }

    const jarPng =
      jar.length > 0
        ? await renderTimeSeries('Raffle jar balance (audit view)', [
            { label: 'jar', points: jar.map((j) => ({ day: j.day, value: j.balance })) },
          ])
        : null;
    if (jarPng) {
      files.push(new AttachmentBuilder(jarPng, { name: 'jar.png' }));
      embeds.push(
        new EmbedBuilder()
          .setColor(0x95a5a6)
          .setTitle('🫙 Jar forensics')
          .setDescription('Should saw-tooth up with entries and snap to 0 at every draw.')
          .setImage('attachment://jar.png'),
      );
    }
  } catch (err) {
    console.error('Trend chart render failed:', err.message);
  }

  if (embeds.length === 0) {
    // Chartless fallback: at least say the number.
    await interaction.editReply(
      `Current gini: **${giniWeeks[giniWeeks.length - 1].gini.toFixed(2)}** ` +
        '(charts unavailable right now).',
    );
    return;
  }

  await interaction.editReply({ embeds, files });
}
