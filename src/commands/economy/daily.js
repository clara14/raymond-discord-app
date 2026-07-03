// ============================================================
// daily.js — Claim a once-per-day reward with a streak bonus.
// Demonstrates cooldown enforcement and streak state handled
// atomically in the ledger layer.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { claimDaily, ensureWelcomeBonus, getBalance } from '../../database/economy.js';
import { garnishEarnings } from '../../database/loans.js';
import { checkAchievements } from '../../database/achievements.js';
import { announceAchievements } from '../../lib/achievements.js';
import { formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('daily')
  .setDescription('Claim your daily credits. Come back each day to grow your streak!');

export async function execute(interaction) {
  // Grant the starting bonus on first interaction (no-op if already granted).
  await ensureWelcomeBonus(interaction.guildId, interaction.user.id);

  // All the cooldown/streak/reward logic is done in one atomic call.
  const result = await claimDaily(interaction.guildId, interaction.user.id);

  // claimed === false means they already claimed today.
  if (!result.claimed) {
    await interaction.reply({
      content: '🕒 You\'ve already claimed your daily today. Come back tomorrow!',
      flags: MessageFlags.Ephemeral, // only they see it — no channel clutter
    });
    return;
  }

  // If they're in debt, a cut of this reward goes to the loan automatically.
  const garnish = await garnishEarnings(
    interaction.guildId,
    interaction.user.id,
    result.reward,
  );

  // Re-read the balance if garnishment changed it.
  const balance = garnish
    ? await getBalance(interaction.guildId, interaction.user.id)
    : result.newBalance;

  // Success: show the reward, the new streak, and their updated balance —
  // plus a garnishment note if part of it went to their loan.
  let description =
    `You received **${formatCurrency(result.reward)}**.\n` +
    `🔥 Streak: **${result.streak}** day(s)\n`;
  if (garnish) {
    description +=
      `🏦 **${formatCurrency(garnish.garnished)}** went toward your loan` +
      (garnish.cleared
        ? ' — it\'s now paid off!\n'
        : ` (${formatCurrency(garnish.owedRemaining)} still owed).\n`);
  }
  description += `New balance: ${formatCurrency(balance)}`;

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('Daily Reward Claimed!')
    .setDescription(description);

  await interaction.reply({ embeds: [embed] });

  // Achievements fire AFTER the claim committed and the reply went out —
  // they can never break or roll back the money.
  const earned = await checkAchievements(interaction.guildId, interaction.user.id, 'daily', {
    reward: result.reward,
    streak: result.streak,
  });
  await announceAchievements(interaction, earned);
}
