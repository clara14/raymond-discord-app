// ============================================================
// pay.js — Transfer credits to another member.
// Demonstrates input validation plus an atomic, race-safe
// transfer through the ledger layer.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { transfer, ensureWelcomeBonus } from '../../database/economy.js';
import { checkAchievements } from '../../database/achievements.js';
import { announceAchievements } from '../../lib/achievements.js';
import { formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('pay')
  .setDescription('Send credits to another member.')
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('Who to pay')
      .setRequired(true),
  )
  .addIntegerOption((option) =>
    option
      .setName('amount')
      .setDescription('How many credits to send')
      .setRequired(true)
      .setMinValue(1), // Discord rejects < 1 before it ever reaches us
  );

export async function execute(interaction) {
  const recipient = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');

  // --- Validation guards ---
  // Paying yourself would be a pointless no-op (and clutters the ledger).
  if (recipient.id === interaction.user.id) {
    await interaction.reply({
      content: 'You can\'t pay yourself.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // Bots have no wallet to receive into.
  if (recipient.bot) {
    await interaction.reply({
      content: 'You can\'t pay a bot.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Ensure both parties have their starting bonus before the transfer:
  // the sender so they can actually spend, the recipient so their ledger
  // exists. Both are no-ops if already granted.
  await ensureWelcomeBonus(interaction.guildId, interaction.user.id);
  await ensureWelcomeBonus(interaction.guildId, recipient.id);

  // Attempt the atomic transfer; it tells us if funds were insufficient.
  const result = await transfer(
    interaction.guildId,
    interaction.user.id,
    recipient.id,
    amount,
  );

  if (!result.ok) {
    await interaction.reply({
      content: `You don't have enough credits to send ${formatCurrency(amount)}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setDescription(
      `💸 ${interaction.user} sent **${formatCurrency(amount)}** to ${recipient}.`,
    );

  await interaction.reply({ embeds: [embed] });

  // Achievement checks run after the transfer committed.
  const earned = await checkAchievements(interaction.guildId, interaction.user.id, 'pay', {
    amount,
    to: recipient.id,
  });
  await announceAchievements(interaction, earned);
}
