// ============================================================
// history.js — A player's recent recorded matches: result,
// champion, KDA, and when. Reads the lol_match_history table
// that the backfill and poller sync keep filled.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getLink } from '../../database/linkedAccounts.js';
import { getHistory } from '../../database/lolHistory.js';

// Friendly names for the queue ids we'll see most.
const QUEUES = {
  420: 'Ranked Solo',
  440: 'Ranked Flex',
  450: 'ARAM',
  400: 'Normal Draft',
  430: 'Normal Blind',
  490: 'Quickplay',
  1700: 'Arena',
};

export const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription('Recent League matches for a linked player.')
  .addUserOption((o) =>
    o.setName('user').setDescription('Whose history (default: you)').setRequired(false),
  );

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;

  const link = await getLink(target.id);
  if (!link) {
    await interaction.reply({
      content:
        target.id === interaction.user.id
          ? 'You haven\'t linked an account. Use `/link set` first.'
          : `${target.username} hasn't linked a League account.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const matches = await getHistory(link.puuid, 10);
  if (matches.length === 0) {
    await interaction.reply({
      content: 'No matches recorded yet — play a game (or wait for the next sync).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // One compact line per match: result, champ, KDA, queue, duration, when.
  const lines = matches.map((m) => {
    const mins = Math.round(m.duration_sec / 60);
    const when = Math.floor(new Date(m.ended_at).getTime() / 1000);
    const queue = QUEUES[m.queue_id] ?? 'Other';
    return (
      `${m.win ? '✅' : '❌'} **${m.champion}** ${m.kills}/${m.deaths}/${m.assists}` +
      ` · ${queue} · ${mins}m · <t:${when}:R>`
    );
  });

  const embed = new EmbedBuilder()
    .setColor(0x0a96aa)
    .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
    .setTitle(`📜 Recent matches — ${link.game_name}#${link.tag_line}`)
    .setDescription(lines.join('\n'));

  await interaction.reply({ embeds: [embed] });
}
