// ============================================================
// work.js — Earn a small random payout, once per hour.
// Demonstrates the generic cooldown helper plus random rewards
// and randomized flavor text.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  addTransaction,
  ensureWelcomeBonus,
  getBalance,
} from '../../database/economy.js';
import { tryUseCooldown } from '../../database/cooldowns.js';
import { garnishEarnings } from '../../database/loans.js';
import { checkAchievements } from '../../database/achievements.js';
import { announceAchievements } from '../../lib/achievements.js';
import { WORK, formatCurrency, formatDuration } from '../../config.js';

// Flavor scenarios. {amount} is swapped for the formatted payout at runtime.
// Add or edit freely — purely cosmetic, they don't affect the numbers.
const JOBS = [
  'You walked some dogs around the block and earned {amount}.',
  'You sold a box of old junk online and earned {amount}.',
  'You picked up a shift at the local cafe and earned {amount}.',
  'You mowed a neighbor\'s lawn and earned {amount}.',
  'You fixed a friend\'s computer and earned {amount}.',
  'You delivered a few pizzas and earned {amount}.',
  'You found some coins in the couch and earned {amount}.',
  'You helped someone move a sofa and earned {amount}.',
];

// Inclusive random integer between min and max.
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const data = new SlashCommandBuilder()
  .setName('work')
  .setDescription('Do a quick job for some monies. Usable once an hour.');

export async function execute(interaction) {
  const { guildId, user } = interaction;

  // Make sure they have their starting bonus (no-op if already granted).
  await ensureWelcomeBonus(guildId, user.id);

  // Atomically try to claim a work turn. If they're still on cooldown,
  // this tells us how long is left without paying out.
  const cooldown = await tryUseCooldown(guildId, user.id, 'work', WORK.cooldownSec);
  if (!cooldown.ok) {
    await interaction.reply({
      content: `😴 You're worn out. Try again in **${formatDuration(cooldown.remainingSec)}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Roll the payout and record it as a 'work' ledger entry.
  const amount = randomInt(WORK.min, WORK.max);
  await addTransaction(guildId, user.id, amount, 'work');

  // If they're in debt, a cut of this payout goes to the loan automatically.
  const garnish = await garnishEarnings(guildId, user.id, amount);

  // Fetch the updated balance and pick a random flavor line.
  const balance = await getBalance(guildId, user.id);
  const flavor = JOBS[randomInt(0, JOBS.length - 1)].replace(
    '{amount}',
    `**${formatCurrency(amount)}**`,
  );

  // Append a garnishment note if part of the payout went to their loan.
  let description = `${flavor}\n`;
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
    .setTitle('💼 Work')
    .setDescription(description);

  await interaction.reply({ embeds: [embed] });

  // Fire achievement checks after the payout committed (never before).
  const earned = await checkAchievements(guildId, user.id, 'work', { amount });
  await announceAchievements(interaction, earned);
}
