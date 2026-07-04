// ============================================================
// warn.js — Issues a warning and records it in PostgreSQL.
// Demonstrates the full pattern: permissions, options, and
// database reads/writes.
// ============================================================

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { query } from '../../database/db.js'; // Shared DB helper
import { checkAchievements } from '../../database/achievements.js';
import { announceAchievements } from '../../lib/achievements.js';

export const data = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Issue a warning to a member (recorded in the database).')
  // Required: which user to warn.
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('The member to warn')
      .setRequired(true),
  )
  // Optional: a reason for the warning.
  .addStringOption((option) =>
    option
      .setName('reason')
      .setDescription('Why are they being warned?')
      .setRequired(false),
  )
  // Permission gate: only members with the "Moderate Members" permission
  // can even see or use this command. Discord enforces this server-side.
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction) {
  // Pull the option values the moderator provided.
  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') ?? 'No reason provided';

  // Insert the warning. Parameterized ($1..$4) to prevent SQL injection.
  // RETURNING id hands back the new row's id in the same round trip.
  const { rows } = await query(
    `INSERT INTO warnings (guild_id, user_id, moderator_id, reason)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [interaction.guildId, target.id, interaction.user.id, reason],
  );

  // Count how many warnings this user now has in this server.
  // ::int casts the COUNT (which comes back as a string) to a number.
  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS total
     FROM warnings
     WHERE guild_id = $1 AND user_id = $2`,
    [interaction.guildId, target.id],
  );

  const total = countRows[0].total;

  // Reply privately (ephemeral) so the warning isn't broadcast to the channel.
  await interaction.reply({
    content: `⚠️ Warned **${target.tag}** (warning #${rows[0].id}).\nReason: ${reason}\nThey now have **${total}** warning(s).`,
    flags: MessageFlags.Ephemeral,
  });

  // Achievement for the WARNED user. Deliberately a public follow-up
  // even though the warning itself is ephemeral — "Seen the Mod Side" is
  // friendly-server comedy, and it reveals only that a warning happened,
  // not the reason.
  const earned = await checkAchievements(interaction.guildId, target.id, 'warn', {});
  await announceAchievements(interaction, earned, `<@${target.id}>`);
}
