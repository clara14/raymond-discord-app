// ============================================================
// join.js — Summon the bot into your current voice channel.
// Destination when reintegrated: src/commands/voice/join.js
// ============================================================

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { join } from '../../lib/voice.js';
import { ttsAvailable } from '../../lib/tts.js';

export const data = new SlashCommandBuilder()
  .setName('join')
  .setDescription('Summon the bot into your voice channel.');

export async function execute(interaction) {
  // The caller must actually be in a voice channel for us to know where to go.
  const channel = interaction.member?.voice?.channel;
  if (!channel) {
    await interaction.reply({
      content: 'Join a voice channel first, then summon me.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Warn (but still join) if TTS isn't configured — the bot would sit mute.
  const ttsNote = ttsAvailable()
    ? ''
    : '\n⚠️ TTS isn\'t configured (set PIPER_VOICE in .env), so I can\'t speak yet.';

  // Joining involves a network handshake that can be slow — defer first.
  await interaction.deferReply();
  try {
    await join(channel);
    await interaction.editReply(`🔊 Joined **${channel.name}**.${ttsNote}`);
  } catch (err) {
    console.error('Voice join error:', err);
    await interaction.editReply('Couldn\'t join the voice channel. Check my permissions?');
  }
}
