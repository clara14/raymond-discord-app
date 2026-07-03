// ============================================================
// lolstats.js — Aggregate picture of a player's recorded
// matches: games, winrate, average KDA, top champions.
// All computed by the database from lol_match_history.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getLink } from '../../database/linkedAccounts.js';
import { getStats } from '../../database/lolHistory.js';

export const data = new SlashCommandBuilder()
  .setName('lolstats')
  .setDescription('Aggregate League stats for a linked player (from recorded matches).')
  .addUserOption((o) =>
    o.setName('user').setDescription('Whose stats (default: you)').setRequired(false),
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

  const s = await getStats(link.puuid);
  if (s.games === 0) {
    await interaction.reply({
      content: 'No matches recorded yet — stats will build as games are played.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const winrate = ((s.wins / s.games) * 100).toFixed(1);
  // Classic KDA: (kills + assists) / deaths, with the perfect-KDA guard.
  const kda =
    s.deaths === 0
      ? 'Perfect'
      : ((s.kills + s.assists) / s.deaths).toFixed(2);

  const champLines = s.topChampions
    .map(
      (c) =>
        `**${c.champion}** — ${c.games} game(s), ${((c.wins / c.games) * 100).toFixed(0)}% WR`,
    )
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x0a96aa)
    .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
    .setTitle(`📊 League stats — ${link.game_name}#${link.tag_line}`)
    .addFields(
      {
        name: 'Record',
        value: `${s.games} games · **${s.wins}W ${s.games - s.wins}L** (${winrate}%)`,
        inline: true,
      },
      {
        name: 'KDA',
        value: `**${kda}** (${s.kills}/${s.deaths}/${s.assists} total)`,
        inline: true,
      },
      {
        name: 'Most played',
        value: champLines,
        inline: false,
      },
    )
    .setFooter({ text: 'Based on matches recorded since linking.' });

  await interaction.reply({ embeds: [embed] });
}
