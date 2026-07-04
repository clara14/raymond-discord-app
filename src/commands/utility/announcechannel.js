// ============================================================
// announcechannel.js — Mod command: choose where the bot's
// general announcements go (birthdays, achievement sweeps,
// future daily rituals). Mirrors /lolchannel. When unset,
// announcements fall back to the LoL channel; when neither is
// set they stay silent.
// ============================================================

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { setAnnounceChannel, getAnnounceChannel } from '../../database/guildSettings.js';

export const data = new SlashCommandBuilder()
  .setName('announcechannel')
  .setDescription('Configure the bot\'s announcement channel (moderators only).')
  .addSubcommand((sc) =>
    sc
      .setName('set')
      .setDescription('Send birthdays and background announcements to a channel.')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Where announcements go')
          .addChannelTypes(ChannelType.GuildText) // text channels only
          .setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName('off').setDescription('Clear it (falls back to the LoL channel, if set).'),
  )
  .addSubcommand((sc) =>
    sc.setName('status').setDescription('Show where announcements currently go.'),
  )
  // Server-configuration command — gate it to Manage Server.
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'set') {
    const channel = interaction.options.getChannel('channel');
    await setAnnounceChannel(interaction.guildId, channel.id);
    await interaction.reply(
      `📣 Birthday and background announcements will be posted in ${channel}.`,
    );
    return;
  }

  if (sub === 'off') {
    await setAnnounceChannel(interaction.guildId, null);
    await interaction.reply(
      '🔕 Dedicated announcement channel cleared. ' +
        'Announcements fall back to the LoL channel if one is set, else stay silent.',
    );
    return;
  }

  // status — shows the EFFECTIVE channel (including the fallback).
  const channelId = await getAnnounceChannel(interaction.guildId);
  await interaction.reply({
    content: channelId
      ? `Announcements are going to <#${channelId}>.`
      : 'No announcement channel is set (and no LoL channel to fall back to) — background announcements are silent.',
    flags: MessageFlags.Ephemeral,
  });
}
