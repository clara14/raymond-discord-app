// ============================================================
// wordle.js (command) — The daily word puzzle. Guessing is
// private (ephemeral boards with letters); finishing posts a
// public spoiler-free emoji grid. Solves pay monies scaled by
// attempts, with a solve streak.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { submitGuess, getGame, getToday } from '../../database/wordle.js';
import { ensureWelcomeBonus } from '../../database/economy.js';
import { checkAchievements } from '../../database/achievements.js';
import { announceAchievements } from '../../lib/achievements.js';
import { VALID_GUESSES, tilesRow, boardRow } from '../../lib/wordle.js';
import { formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('wordle')
  .setDescription('The daily 5-letter word puzzle. Solve it for monies!')
  .addSubcommand((sc) =>
    sc
      .setName('guess')
      .setDescription('Make a guess at today\'s word.')
      .addStringOption((o) =>
        o
          .setName('word')
          .setDescription('A 5-letter word')
          .setRequired(true)
          .setMinLength(5)
          .setMaxLength(5),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName('board').setDescription('See your board for today\'s puzzle.'),
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'guess') return handleGuess(interaction);
  if (sub === 'board') return handleBoard(interaction);
}

// Renders a player's full private board (tiles + letters per row).
function privateBoard(guesses) {
  return guesses.map(([g, marks]) => boardRow(g, marks)).join('\n');
}

// Renders the public spoiler-free grid (tiles only, no letters).
function publicGrid(guesses) {
  return guesses.map(([, marks]) => tilesRow(marks)).join('\n');
}

// --- /wordle guess ---
async function handleGuess(interaction) {
  const raw = interaction.options.getString('word').toLowerCase().trim();

  // Validate shape and dictionary membership before touching the game.
  if (!/^[a-z]{5}$/.test(raw)) {
    await interaction.reply({
      content: 'Guesses must be exactly 5 letters (a–z only).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!VALID_GUESSES.has(raw)) {
    await interaction.reply({
      content: `**${raw.toUpperCase()}** isn't in the word list. Try a real word.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await ensureWelcomeBonus(interaction.guildId, interaction.user.id);

  const result = await submitGuess(interaction.guildId, interaction.user.id, raw);

  if (!result.ok) {
    await interaction.reply({
      content: '🗓️ You\'ve already finished today\'s puzzle. A new word drops at midnight (server time).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // --- Solved! Private confirmation + public spoiler-free brag. ---
  if (result.solved) {
    const embed = new EmbedBuilder()
      .setColor(0x538d4e)
      .setTitle(`🎉 Solved in ${result.attempts}/6!`)
      .setDescription(
        `${privateBoard(result.guesses)}\n\n` +
          `**+${formatCurrency(result.reward)}** · 🔥 solve streak: **${result.streak}**`,
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    // The public grid: colors only — everyone sees HOW you did, not the word.
    const brag = new EmbedBuilder()
      .setColor(0x538d4e)
      .setDescription(
        `**${interaction.user.displayName ?? interaction.user.username}** solved today's wordle in **${result.attempts}/6**\n\n` +
          `${publicGrid(result.guesses)}\n\n+${formatCurrency(result.reward)} · streak ${result.streak}`,
      );
    await interaction.channel?.send({ embeds: [brag] }).catch(() => {});

    // The 'wordle' trigger fires on FINISHING (solve or fail), never on
    // mid-game guesses — attempts and streak ride along for later checks.
    const earned = await checkAchievements(interaction.guildId, interaction.user.id, 'wordle', {
      solved: true,
      attempts: result.attempts,
      streak: result.streak,
    });
    await announceAchievements(interaction, earned);
    return;
  }

  // --- Out of guesses: reveal privately, post the grid publicly. ---
  if (result.failed) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('💀 Out of guesses!')
      .setDescription(
        `${privateBoard(result.guesses)}\n\nThe word was **${result.word.toUpperCase()}**.`,
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    const grid = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setDescription(
        `**${interaction.user.displayName ?? interaction.user.username}** couldn't crack today's wordle (X/6)\n\n${publicGrid(result.guesses)}`,
      );
    await interaction.channel?.send({ embeds: [grid] }).catch(() => {});

    // A failed board still counts as finishing (win or lose per spec).
    const earned = await checkAchievements(interaction.guildId, interaction.user.id, 'wordle', {
      solved: false,
      attempts: result.guesses.length,
    });
    await announceAchievements(interaction, earned);
    return;
  }

  // --- Still going: private board update. ---
  const embed = new EmbedBuilder()
    .setColor(0x0a96aa)
    .setTitle(`Daily puzzle — guess ${result.guesses.length} of 6`)
    .setDescription(
      `${privateBoard(result.guesses)}\n\n${result.attemptsLeft} guess(es) left.`,
    );
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// --- /wordle board ---
async function handleBoard(interaction) {
  const { day } = await getToday();
  const game = await getGame(interaction.guildId, interaction.user.id, day);

  if (!game || game.guesses.length === 0) {
    await interaction.reply({
      content: 'You haven\'t started today\'s puzzle. `/wordle guess` away!',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const status = game.solved
    ? 'Solved! 🎉'
    : game.guesses.length >= 6
      ? 'Out of guesses for today.'
      : `${6 - game.guesses.length} guess(es) left.`;

  const embed = new EmbedBuilder()
    .setColor(0x0a96aa)
    .setTitle('Your board — today\'s puzzle')
    .setDescription(`${privateBoard(game.guesses)}\n\n${status}`);
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
