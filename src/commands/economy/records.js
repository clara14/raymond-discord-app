// ============================================================
// records.js (command) — The hall of records: single-row
// superlatives from the ledger and the streak tables. Public
// and purely for fun; every line is one query in analytics.js.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { records } from '../../database/analytics.js';
import { formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('records')
  .setDescription('The server\'s hall of records — biggest, longest, most.');

export async function execute(interaction) {
  await interaction.deferReply();

  const r = await records(interaction.guildId);

  // One line per record that exists; silence for empty categories.
  const money = (rec, label) =>
    rec ? `${label}: **${formatCurrency(rec.amount)}**${rec.userId ? ` — <@${rec.userId}>` : ''}` : null;

  const lines = [
    money(r.biggestWin, '🎰 Biggest single win'),
    money(r.biggestLoss, '🕳️ Biggest single loss'),
    money(r.biggestPay, '💸 Largest /pay ever'),
    money(r.biggestGift, '🎁 Priciest gift bought'),
    money(r.biggestRob, '🦹 Biggest heist'),
    money(r.biggestDamages, '🤕 Biggest damages payout'),
    money(r.biggestRafflePot, '🎟️ Largest raffle pot won'),
    r.longestDailyStreak != null ? `☕ Longest daily streak on record: **${r.longestDailyStreak} days**` : null,
    r.longestWordleStreak != null ? `🧩 Longest wordle streak on record: **${r.longestWordleStreak} days**` : null,
    r.mostGarnished ? `😮‍💨 Most garnished debtor: <@${r.mostGarnished.userId}> (**${formatCurrency(r.mostGarnished.amount)}**)` : null,
    r.busiestDay ? `📅 Busiest day ever: **${r.busiestDay.day}** (${r.busiestDay.n} transactions)` : null,
  ].filter(Boolean);

  if (lines.length === 0) {
    await interaction.editReply('No records yet — someone go do something historic.');
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`🏛️ ${interaction.guild.name} — hall of records`)
    .setDescription(lines.join('\n'));

  await interaction.editReply({ embeds: [embed] });
}
