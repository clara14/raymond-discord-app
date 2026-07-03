// ============================================================
// lolchannel.js — Mod command: choose where LoL match
// announcements (and betting) happen, or turn them off.
// The poller only announces in guilds with a channel set.
// ============================================================

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { setLolChannel, getLolChannel } from '../../database/lolBets.js';

export const data = new SlashCommandBuilder()
  .setName('lolchannel')
  .setDescription('Configure LoL match announcements (moderators only).')
  .addSubcommand((sc) =>
    sc
      .setName('set')
      .setDescription('Announce matches (with betting) in a channel.')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Where announcements go')
          .addChannelTypes(ChannelType.GuildText) // text channels only
          .setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName('off').setDescription('Stop announcing matches in this server.'),
  )
  .addSubcommand((sc) =>
    sc.setName('status').setDescription('Show the current announcement channel.'),
  )
  // Server-configuration command — gate it to Manage Server.
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'set') {
    const channel = interaction.options.getChannel('channel');
    await setLolChannel(interaction.guildId, channel.id);
    await interaction.reply(
      `✅ LoL match announcements will be posted in ${channel}. ` +
        'Linked players\' games get detected within a couple of minutes of starting.',
    );
    return;
  }

  if (sub === 'off') {
    await setLolChannel(interaction.guildId, null);
    await interaction.reply('🔕 LoL match announcements are off for this server.');
    return;
  }

  // status
  const channelId = await getLolChannel(interaction.guildId);
  await interaction.reply({
    content: channelId
      ? `Announcements are going to <#${channelId}>.`
      : 'No announcement channel is set. Use `/lolchannel set`.',
    flags: MessageFlags.Ephemeral,
  });
}
