// ============================================================
// coinflip.js — Bet credits on a coin flip (a "game" that uses
// the economy). Demonstrates a choice option and an atomic,
// balance-checked wager through the ledger layer.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { resolveCoinflip, ensureWelcomeBonus } from '../../database/economy.js';
import { checkAchievements } from '../../database/achievements.js';
import { announceAchievements } from '../../lib/achievements.js';
import { formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('coinflip')
  .setDescription('Bet credits on a coin flip. Guess right to double your bet!')
  .addStringOption((option) =>
    option
      .setName('guess')
      .setDescription('Heads or tails')
      .setRequired(true)
      // addChoices restricts input to these two values — no validation needed.
      .addChoices(
        { name: 'Heads', value: 'heads' },
        { name: 'Tails', value: 'tails' },
      ),
  )
  .addIntegerOption((option) =>
    option
      .setName('bet')
      .setDescription('How many credits to wager')
      .setRequired(true)
      .setMinValue(1),
  );

export async function execute(interaction) {
  const guess = interaction.options.getString('guess');
  const bet = interaction.options.getInteger('bet');

  // Grant the starting bonus on first interaction (no-op if already granted).
  await ensureWelcomeBonus(interaction.guildId, interaction.user.id);

  // The ledger layer checks funds, flips, and records the result atomically.
  const result = await resolveCoinflip(
    interaction.guildId,
    interaction.user.id,
    bet,
    guess,
  );

  // Not enough credits to cover the wager.
  if (!result.ok) {
    await interaction.reply({
      content: `You don't have ${formatCurrency(bet)} to bet.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Build a result message. Green for a win, red for a loss.
  const outcome = result.won
    ? `🎉 It landed on **${result.result}** — you won **${formatCurrency(bet)}**!`
    : `😢 It landed on **${result.result}** — you lost **${formatCurrency(bet)}**.`;

  const embed = new EmbedBuilder()
    .setColor(result.won ? 0x2ecc71 : 0xe74c3c)
    .setTitle('🪙 Coin Flip')
    .setDescription(`${outcome}\nNew balance: ${formatCurrency(result.newBalance)}`);

  await interaction.reply({ embeds: [embed] });

  // Achievement checks run after the wager resolved and committed.
  const earned = await checkAchievements(interaction.guildId, interaction.user.id, 'coinflip', {
    bet,
    guess,
    result: result.result,
    won: result.won,
  });
  await announceAchievements(interaction, earned);
}
