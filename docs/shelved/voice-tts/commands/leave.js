// ============================================================
// leave.js — Dismiss the bot from the voice channel.
// Destination when reintegrated: src/commands/voice/leave.js
// ============================================================

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { leave, inVoice } from '../../lib/voice.js';

export const data = new SlashCommandBuilder()
  .setName('leave')
  .setDescription('Dismiss the bot from the voice channel.');

export async function execute(interaction) {
  if (!inVoice(interaction.guildId)) {
    await interaction.reply({
      content: 'I\'m not in a voice channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  leave(interaction.guildId);
  await interaction.reply('👋 Left the voice channel.');
}
