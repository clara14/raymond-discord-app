// ============================================================
// leaderboard.js — Server rankings: richest members (monies)
// or hottest daily streaks. Demonstrates a choice option that
// switches between two aggregations.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getLeaderboard } from '../../database/economy.js';
import { getStreakLeaderboard } from '../../database/stats.js';
import { formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('See who\'s on top in this server.')
  // One command, two boards — a choice option keeps them together.
  .addStringOption((o) =>
    o
      .setName('board')
      .setDescription('Which ranking to show (default: monies)')
      .setRequired(false)
      .addChoices(
        { name: 'Monies', value: 'monies' },
        { name: 'Daily streaks', value: 'streaks' },
      ),
  );

export async function execute(interaction) {
  const board = interaction.options.getString('board') ?? 'monies';

  if (board === 'streaks') return showStreaks(interaction);
  return showMonies(interaction);
}

// Resolves a user ID to a username, tolerating users who left the server.
async function resolveName(client, userId) {
  try {
    const user = await client.users.fetch(userId);
    return user.username;
  } catch {
    return `Unknown (${userId})`;
  }
}

// Medals for the top three, plain numbers after that.
function rankBadge(index) {
  return ['🥇', '🥈', '🥉'][index] ?? `**${index + 1}.**`;
}

// --- Monies board (the original leaderboard) ---
async function showMonies(interaction) {
  const top = await getLeaderboard(interaction.guildId, 10);

  if (top.length === 0) {
    await interaction.reply('No one has any monies yet. Try `/daily` to get started!');
    return;
  }

  const lines = await Promise.all(
    top.map(async (entry, index) => {
      const name = await resolveName(interaction.client, entry.userId);
      return `${rankBadge(index)} ${name} — ${formatCurrency(entry.balance)}`;
    }),
  );

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`💰 Richest in ${interaction.guild.name}`)
    .setDescription(lines.join('\n'));

  await interaction.reply({ embeds: [embed] });
}

// --- Streaks board ---
async function showStreaks(interaction) {
  const top = await getStreakLeaderboard(interaction.guildId, 10);

  if (top.length === 0) {
    await interaction.reply(
      'No active streaks right now. Claim `/daily` today and tomorrow to start one!',
    );
    return;
  }

  const lines = await Promise.all(
    top.map(async (entry, index) => {
      const name = await resolveName(interaction.client, entry.userId);
      return `${rankBadge(index)} ${name} — 🔥 ${entry.streak} day(s)`;
    }),
  );

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`🔥 Hottest streaks in ${interaction.guild.name}`)
    .setDescription(lines.join('\n'));

  await interaction.reply({ embeds: [embed] });
}
