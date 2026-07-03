// ============================================================
// say.js — Make the bot speak your text aloud in voice chat,
// via local TTS (Piper). Auto-joins your channel if needed.
// Destination when reintegrated: src/commands/voice/say.js
// ============================================================

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { join, speak, inVoice } from '../../lib/voice.js';
import { ttsAvailable } from '../../lib/tts.js';
import { VOICE } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('say')
  .setDescription('Make the bot say something out loud in voice chat.')
  .addStringOption((o) =>
    o
      .setName('text')
      .setDescription(`What to say (up to ${VOICE.maxSpeakChars} characters)`)
      .setRequired(true)
      .setMaxLength(VOICE.maxSpeakChars),
  );

export async function execute(interaction) {
  if (!ttsAvailable()) {
    await interaction.reply({
      content: 'TTS isn\'t configured — the bot owner needs to set PIPER_VOICE in .env.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const text = interaction.options.getString('text');

  // Synthesis + (maybe) joining can exceed the 3-second deadline — defer.
  await interaction.deferReply();
  try {
    // Auto-join the caller's channel if we're not already in voice here.
    if (!inVoice(interaction.guildId)) {
      const channel = interaction.member?.voice?.channel;
      if (!channel) {
        await interaction.editReply('Join a voice channel first (or use /join).');
        return;
      }
      await join(channel);
    }

    await speak(interaction.guildId, text);
    await interaction.editReply(`🗣️ "${text.slice(0, 200)}"`);
  } catch (err) {
    console.error('Say error:', err);
    await interaction.editReply('Something went wrong with speech synthesis.');
  }
}
