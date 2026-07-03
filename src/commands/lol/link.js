// ============================================================
// link.js — Connect your Riot account to the bot.
// /link set <riotid> verifies the account against the Riot API
// and stores the PUUID; everything LoL (announcements, betting,
// ranks) keys off this.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  riotAvailable,
  parseRiotId,
  getAccountByRiotId,
} from '../../lib/riot.js';
import {
  linkAccount,
  unlinkAccount,
  getLink,
} from '../../database/linkedAccounts.js';
import { syncPlayerHistory } from '../../database/lolHistory.js';
import { checkAchievements } from '../../database/achievements.js';
import { announceAchievements } from '../../lib/achievements.js';
import { LOL } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Connect your League of Legends account to the bot.')
  .addSubcommand((sc) =>
    sc
      .setName('set')
      .setDescription('Link your Riot ID (e.g. YourName#NA1).')
      .addStringOption((o) =>
        o
          .setName('riotid')
          .setDescription('Your Riot ID in the form Name#TAG')
          .setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName('remove').setDescription('Unlink your Riot account.'),
  )
  .addSubcommand((sc) =>
    sc.setName('status').setDescription('See which account you have linked.'),
  );

export async function execute(interaction) {
  if (!riotAvailable()) {
    await interaction.reply({
      content: 'LoL features aren\'t configured — the bot owner needs to set RIOT_API_KEY.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'set') return handleSet(interaction);
  if (sub === 'remove') return handleRemove(interaction);
  if (sub === 'status') return handleStatus(interaction);
}

// --- /link set ---
async function handleSet(interaction) {
  const input = interaction.options.getString('riotid');

  // Validate the Name#TAG shape before spending an API call on it.
  const parsed = parseRiotId(input);
  if (!parsed) {
    await interaction.reply({
      content: 'That doesn\'t look like a Riot ID. The format is `Name#TAG`, e.g. `Faker#KR1`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // The Riot API call can be slow — defer to beat the 3-second deadline.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Verify the account actually exists; null means "no such Riot ID".
    const account = await getAccountByRiotId(parsed.gameName, parsed.tagLine);
    if (!account) {
      await interaction.editReply(
        `No Riot account found for **${parsed.gameName}#${parsed.tagLine}**. Check the spelling and tag.`,
      );
      return;
    }

    // Store using Riot's canonical capitalization, not what the user typed.
    await linkAccount(
      interaction.user.id,
      account.puuid,
      account.gameName,
      account.tagLine,
    );

    await interaction.editReply(
      `✅ Linked to **${account.gameName}#${account.tagLine}**. ` +
        'Match announcements and betting will now track this account.',
    );

    // Backfill recent matches in the background (fire-and-forget) so
    // /history and /lolstats are useful immediately. Failures just mean
    // the poller's next sync picks the games up instead.
    syncPlayerHistory(account.puuid, interaction.user.id, LOL.backfillCount)
      .catch((err) => console.error('Backfill error:', err.message));

    // Achievement check after the link stored. (In a DM guildId is null
    // and checkAchievements no-ops — awards are per-guild.)
    const earned = await checkAchievements(interaction.guildId, interaction.user.id, 'link', {
      riotId: `${account.gameName}#${account.tagLine}`,
    });
    await announceAchievements(interaction, earned);
  } catch (err) {
    // The puuid UNIQUE constraint fires if another Discord user already
    // claimed this Riot account.
    if (String(err.message).includes('linked_accounts_puuid_key')) {
      await interaction.editReply(
        'That Riot account is already linked to someone else in this server.',
      );
      return;
    }
    console.error('Link error:', err);
    await interaction.editReply('Something went wrong talking to the Riot API. Try again shortly.');
  }
}

// --- /link remove ---
async function handleRemove(interaction) {
  const removed = await unlinkAccount(interaction.user.id);
  await interaction.reply({
    content: removed
      ? '🔓 Unlinked. The bot will stop tracking your matches.'
      : 'You don\'t have a linked account.',
    flags: MessageFlags.Ephemeral,
  });
}

// --- /link status ---
async function handleStatus(interaction) {
  const link = await getLink(interaction.user.id);
  if (!link) {
    await interaction.reply({
      content: 'No account linked. Use `/link set` with your Riot ID.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x0a96aa)
    .setTitle('🔗 Linked Account')
    .setDescription(`**${link.game_name}#${link.tag_line}**`);
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
