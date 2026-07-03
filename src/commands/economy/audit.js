// ============================================================
// audit.js — Verify the economy's tamper-evidence hash chain.
// Walks every transaction in this server, recomputes every
// hash, and checks every link. Gated to moderators (Manage
// Server); the results posted are public, so verification is
// still visible to everyone even if initiation isn't.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { query } from '../../database/db.js';
import { verifyChain } from '../../lib/ledgerHash.js';

export const data = new SlashCommandBuilder()
  .setName('audit')
  .setDescription('Cryptographically verify the server\'s entire transaction ledger.')
  // Moderator-gated by owner's choice. Design note: opening this to
  // everyone is also legitimate — public verifiability is the feature's
  // philosophical point — so ungating is just deleting the next line.
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  // Big ledgers take a moment to fetch and hash — defer past the 3s limit.
  await interaction.deferReply();

  // The whole chain for this guild, in append order. amount comes back as
  // text so the hash input matches exactly what was hashed at write time.
  const { rows } = await query(
    `SELECT id, guild_id, user_id, amount::text AS amount, type, metadata,
            created_at::text AS created_at_text, row_hash, prev_hash
     FROM transactions
     WHERE guild_id = $1
     ORDER BY id ASC`,
    [interaction.guildId],
  );

  if (rows.length === 0) {
    await interaction.editReply('The ledger is empty — nothing to audit (yet).');
    return;
  }

  const started = Date.now();
  const result = verifyChain(rows);
  const ms = Date.now() - started;

  if (result.ok) {
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🔒 Ledger Audit: CLEAN')
      .setDescription(
        `Verified **${result.checked.toLocaleString()}** transaction(s) in ${ms}ms.\n` +
          `Every hash recomputed, every link intact — history has not been altered.\n\n` +
          `**Chain head:** \`${result.headHash.slice(0, 16)}…\`\n` +
          `-# The head hash commits to the entire history. Screenshot it: if a future ` +
          `audit's head differs for the same rows, something changed.`,
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // A broken chain is a five-alarm result — say exactly where.
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🚨 Ledger Audit: TAMPERING DETECTED')
    .setDescription(
      `Chain verification FAILED at transaction **#${result.brokenAtId}**.\n` +
        `Reason: ${result.reason}\n` +
        `${result.checked.toLocaleString()} row(s) verified clean before the break.\n\n` +
        `Every row from #${result.brokenAtId} onward is now unverifiable. ` +
        `Someone edited history — the ledger itself just told on them.`,
    );
  await interaction.editReply({ embeds: [embed] });
}
