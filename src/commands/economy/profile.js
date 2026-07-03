// ============================================================
// profile.js — A stats card for any member: net worth, streak,
// gambling record, and more. Everything is derived from the
// ledger — this command writes nothing.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getProfile } from '../../database/stats.js';
import { ensureWelcomeBonus } from '../../database/economy.js';
import { formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('See a member\'s economy profile card (or your own).')
  .addUserOption((o) =>
    o
      .setName('user')
      .setDescription('Whose profile to show')
      .setRequired(false),
  );

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;

  // Make sure the target's ledger exists (grants the 500 welcome if new).
  await ensureWelcomeBonus(interaction.guildId, target.id);

  const p = await getProfile(interaction.guildId, target.id);

  // Signed formatting for the gambling net: up, down, or exactly even.
  const gamblingLine =
    p.gamblingNet === 0
      ? 'dead even'
      : p.gamblingNet > 0
        ? `up ${formatCurrency(p.gamblingNet)}`
        : `down ${formatCurrency(-p.gamblingNet)}`;

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
    .setTitle('📇 Profile')
    .addFields(
      {
        name: 'Net worth',
        value:
          `**${formatCurrency(p.netWorth)}**\n` +
          `Wallet: ${formatCurrency(p.balance)}` +
          (p.banked > 0 ? `\nBanked: ${formatCurrency(p.banked)}` : '') +
          (p.debt > 0 ? `\nLoan debt: -${formatCurrency(p.debt)}` : ''),
        inline: true,
      },
      {
        name: 'Daily streak',
        value: p.streak > 0 ? `🔥 **${p.streak}** day(s)` : 'none right now',
        inline: true,
      },
      {
        name: 'Lifetime earned',
        value: formatCurrency(p.lifetimeEarned),
        inline: true,
      },
      {
        name: 'Gambling',
        value:
          `${gamblingLine}\n` +
          `Coinflips: ${p.coinflipWins}W / ${p.coinflipLosses}L`,
        inline: true,
      },
      {
        name: 'Raffle wins',
        value: `${p.raffleWins} 🎟️`,
        inline: true,
      },
    );

  await interaction.reply({ embeds: [embed] });
}
