// ============================================================
// mystats.js (command) — The personal finance report: income
// by source, gambling ROI per game ("up on blackjack, down
// 1,200 on slots" — self-knowledge nobody asked for), loan
// interest, the rob ledger, and your biggest day.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { personalReport } from '../../database/analytics.js';
import { ensureWelcomeBonus } from '../../database/economy.js';
import { checkAchievements } from '../../database/achievements.js';
import { announceAchievements } from '../../lib/achievements.js';
import { formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('mystats')
  .setDescription('Your personal finance report — income, gambling ROI, and more.')
  .addBooleanOption((o) =>
    o.setName('public').setDescription('Show to the whole channel (default: just you)').setRequired(false),
  );

export async function execute(interaction) {
  const isPublic = interaction.options.getBoolean('public') ?? false;
  await interaction.deferReply(isPublic ? {} : { flags: MessageFlags.Ephemeral });
  await ensureWelcomeBonus(interaction.guildId, interaction.user.id);

  const p = await personalReport(interaction.guildId, interaction.user.id);

  // Income by source, as amounts + share of the total.
  const incomeTotal = Object.values(p.income).reduce((s, v) => s + v, 0);
  const incomeLines = Object.entries({
    '/daily': p.income.daily,
    '/work': p.income.work,
    'wordle': p.income.wordle,
    'gambling wins (net)': p.income.gambling,
    'received from others': p.income.received,
    'other': p.income.other,
  })
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([label, v]) =>
      `${label}: ${formatCurrency(v)} (${incomeTotal > 0 ? ((v / incomeTotal) * 100).toFixed(0) : 0}%)`,
    );

  // Gambling ROI per game — only games actually played.
  const roiLines = Object.entries({
    Slots: p.gamblingRoi.slots,
    Coinflip: p.gamblingRoi.coinflip,
    Blackjack: p.gamblingRoi.blackjack,
    'LoL bets': p.gamblingRoi.lolBets,
  })
    .filter(([, g]) => g.wagered > 0)
    .map(([game, g]) =>
      `**${game}**: ${g.net >= 0 ? 'up' : 'down'} ${formatCurrency(Math.abs(g.net))} ` +
      `on ${formatCurrency(g.wagered)} wagered (${g.roiPct >= 0 ? '+' : ''}${g.roiPct.toFixed(1)}%)`,
    );

  const outgoings = [
    p.givenAway > 0 ? `Given away: ${formatCurrency(p.givenAway)}` : null,
    p.burned > 0 ? `Burned on bribes: ${formatCurrency(p.burned)}` : null,
    p.loanInterestPaid > 0 ? `Loan interest paid: ${formatCurrency(p.loanInterestPaid)}` : null,
  ].filter(Boolean);

  const rob = p.robLedger;
  const robActive = rob.stolen + rob.lostToRobbers + rob.damagesCollected + rob.finesPaid > 0;

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
    .setTitle('🧾 Personal finance report')
    .addFields(
      {
        name: `Income (${formatCurrency(incomeTotal)} lifetime)`,
        value: incomeLines.length > 0 ? incomeLines.join('\n') : 'No income yet. Try /daily.',
      },
      {
        name: 'Gambling ROI',
        value: roiLines.length > 0 ? roiLines.join('\n') : 'You\'ve never gambled. Statistically optimal; spiritually questionable.',
      },
      ...(outgoings.length > 0 ? [{ name: 'Outgoings', value: outgoings.join('\n') }] : []),
      ...(robActive
        ? [{
            name: 'Crime ledger',
            value:
              `Stolen: ${formatCurrency(rob.stolen)} · Lost to robbers: ${formatCurrency(rob.lostToRobbers)}\n` +
              `Damages collected: ${formatCurrency(rob.damagesCollected)} · Fines paid: ${formatCurrency(rob.finesPaid)}`,
          }]
        : []),
      ...(p.biggestDay
        ? [{
            name: 'Best day ever',
            value: `**${p.biggestDay.day}** — net ${p.biggestDay.net >= 0 ? '+' : ''}${p.biggestDay.net.toLocaleString()}`,
          }]
        : []),
    );

  await interaction.editReply({ embeds: [embed] });

  const earned = await checkAchievements(interaction.guildId, interaction.user.id, 'analytics', {
    command: 'mystats',
  });
  await announceAchievements(interaction, earned);
}
