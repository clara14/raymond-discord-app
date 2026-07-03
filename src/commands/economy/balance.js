// ============================================================
// balance.js — Shows a user's current credit balance.
// Demonstrates reading a derived value from the ledger and
// presenting it in an embed.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getBalance, ensureWelcomeBonus } from '../../database/economy.js';
import { formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('balance')
  .setDescription('Check your credit balance (or someone else\'s).')
  // Optional: look up another member. Defaults to the caller if omitted.
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('Whose balance to check')
      .setRequired(false),
  );

export async function execute(interaction) {
  // Use the given user, or fall back to whoever ran the command.
  const target = interaction.options.getUser('user') ?? interaction.user;

  // Make sure this user has received their starting bonus before we read
  // their balance (no-op if they already have it).
  await ensureWelcomeBonus(interaction.guildId, target.id);

  // Balance is computed on the fly from the ledger.
  const balance = await getBalance(interaction.guildId, target.id);

  // An embed just looks nicer than plain text for a stat like this.
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
    .setDescription(`**Balance:** ${formatCurrency(balance)}`);

  await interaction.reply({ embeds: [embed] });
}
