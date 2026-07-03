// ============================================================
// raffle.js — Community raffle command (subcommands).
// Demonstrates slash subcommands, a per-subcommand permission
// check, and reuse of the raffle logic layer.
// ============================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { enterRaffle, getRaffleStatus, drawRaffle } from '../../database/raffle.js';
import { ensureWelcomeBonus } from '../../database/economy.js';
import { formatCurrency, RAFFLE } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('raffle')
  .setDescription('Community raffle: tip into the pot for a chance to win it all.')
  // /raffle enter <amount>
  .addSubcommand((sc) =>
    sc
      .setName('enter')
      .setDescription('Add monies to the pot (1 money = 1 ticket).')
      .addIntegerOption((o) =>
        o
          .setName('amount')
          .setDescription('How much to contribute')
          .setRequired(true)
          .setMinValue(RAFFLE.minEntry),
      ),
  )
  // /raffle pot
  .addSubcommand((sc) =>
    sc.setName('pot').setDescription('See the current pot, entrants, and your odds.'),
  )
  // /raffle draw  (moderators only — checked in code below)
  .addSubcommand((sc) =>
    sc
      .setName('draw')
      .setDescription('Draw a winner and pay out the pot (moderators only).'),
  );

export async function execute(interaction) {
  // The raffle is a server feature; guard against use in DMs.
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'The raffle only works in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Route to the right handler based on which subcommand was used.
  const sub = interaction.options.getSubcommand();
  if (sub === 'enter') return handleEnter(interaction);
  if (sub === 'pot') return handlePot(interaction);
  if (sub === 'draw') return handleDraw(interaction);
}

// Helper: odds as a percentage string, guarding against divide-by-zero.
function oddsPct(tickets, pot) {
  if (pot <= 0) return '0%';
  return `${((tickets / pot) * 100).toFixed(1)}%`;
}

// --- /raffle enter ---
async function handleEnter(interaction) {
  const amount = interaction.options.getInteger('amount');

  // Make sure they have their starting bonus before spending.
  await ensureWelcomeBonus(interaction.guildId, interaction.user.id);

  const result = await enterRaffle(
    interaction.guildId,
    interaction.user.id,
    amount,
  );

  if (!result.ok) {
    await interaction.reply({
      content: `You don't have ${formatCurrency(amount)} to contribute.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🎟️ Raffle Entry')
    .setDescription(
      `${interaction.user} tipped **${formatCurrency(amount)}** into the pot!\n\n` +
        `**Pot:** ${formatCurrency(result.pot)}\n` +
        `**Your tickets:** ${result.userTickets} (${oddsPct(result.userTickets, result.pot)} chance)\n` +
        `**Entrants:** ${result.entrants}`,
    );

  await interaction.reply({ embeds: [embed] });
}

// --- /raffle pot ---
async function handlePot(interaction) {
  const status = await getRaffleStatus(interaction.guildId, interaction.user.id);

  // No open raffle: invite them to start one, and note the last winner.
  if (!status.open) {
    let msg = 'There\'s no active raffle right now. Use `/raffle enter` to start one!';
    if (status.lastWinner) {
      msg += `\n\nLast round's winner: <@${status.lastWinner}>`;
    }
    await interaction.reply(msg);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🎟️ Current Raffle')
    .setDescription(
      `**Pot:** ${formatCurrency(status.pot)}\n` +
        `**Entrants:** ${status.entrants}\n` +
        `**Your tickets:** ${status.userTickets} (${oddsPct(status.userTickets, status.pot)} chance)`,
    );

  await interaction.reply({ embeds: [embed] });
}

// --- /raffle draw (mod only) ---
async function handleDraw(interaction) {
  // Permission gate: only members who can Manage Server may draw.
  // We check here (not via setDefaultMemberPermissions) because that would
  // hide the whole command — but enter/pot should be open to everyone.
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'Only moderators can draw the raffle.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await drawRaffle(interaction.guildId);

  if (!result.ok) {
    const reason =
      result.reason === 'empty'
        ? 'The pot is empty — no one has entered yet.'
        : 'There\'s no active raffle to draw.';
    await interaction.reply({ content: reason, flags: MessageFlags.Ephemeral });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🎉 Raffle Winner!')
    .setDescription(
      `Congratulations <@${result.winnerId}>!\n\n` +
        `You won the pot of **${formatCurrency(result.pot)}** ` +
        `from ${result.entrants} entrant(s).`,
    );

  // Public announcement (not ephemeral) so the whole server sees it.
  await interaction.reply({ embeds: [embed] });
}
