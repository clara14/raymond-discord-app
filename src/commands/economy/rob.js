// ============================================================
// rob.js — Attempt to steal from another member's WALLET.
// Banked monies are untouchable. Two cooldowns keep it fair:
// robbers act once per 2h, and victims get a 1h shield after
// any attempt so nobody gets pile-driven by the whole server.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { attemptRob } from '../../database/robbery.js';
import { ensureWelcomeBonus } from '../../database/economy.js';
import { tryUseCooldown, peekCooldown } from '../../database/cooldowns.js';
import { ROB, formatCurrency, formatDuration } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('rob')
  .setDescription('Attempt to rob someone\'s wallet. Risky. Banked monies are safe.')
  .addUserOption((o) =>
    o.setName('user').setDescription('Your target').setRequired(true),
  );

export async function execute(interaction) {
  const victim = interaction.options.getUser('user');
  const { guildId, user: robber } = interaction;

  // --- Validation guards ---
  if (victim.id === robber.id) {
    await interaction.reply({
      content: 'Robbing yourself is just taking monies out of your pocket.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (victim.bot) {
    await interaction.reply({
      content: 'Bots keep everything in the bank. Nothing to steal.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await ensureWelcomeBonus(guildId, robber.id);
  await ensureWelcomeBonus(guildId, victim.id);

  // --- Cooldown choreography (order matters) ---
  // 1. PEEK the robber's cooldown (claims nothing) — if they're blocked, we
  //    bail without touching the victim's shield.
  const mine = await peekCooldown(guildId, robber.id, 'rob', ROB.cooldownSec);
  if (mine.active) {
    await interaction.reply({
      content: `🚔 Laying low. You can rob again in **${formatDuration(mine.remainingSec)}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 2. Claim the victim's shield. If it's active, the target was recently
  //    hit — the robber's own cooldown stays unconsumed.
  const shield = await tryUseCooldown(guildId, victim.id, 'robbed', ROB.victimShieldSec);
  if (!shield.ok) {
    await interaction.reply({
      content: `🛡️ ${victim.username} is on guard after a recent attempt. Try again in **${formatDuration(shield.remainingSec)}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 3. Now claim the robber's cooldown for real (the peek above makes a
  //    race here vanishingly rare; if it happens, this still catches it).
  const claim = await tryUseCooldown(guildId, robber.id, 'rob', ROB.cooldownSec);
  if (!claim.ok) {
    await interaction.reply({
      content: `🚔 You can rob again in **${formatDuration(claim.remainingSec)}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // --- The attempt itself (atomic, wallet-only) ---
  const result = await attemptRob(guildId, robber.id, victim.id);

  if (!result.ok) {
    // Victim too broke to rob. The attempt still consumed the robber's
    // cooldown — casing a target is on you.
    await interaction.reply({
      content: `${victim.username}'s wallet is under ${formatCurrency(result.minimum)}. Not worth the risk.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Public outcome either way — robberies should be dramatic.
  const embed = result.success
    ? new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🦹 Robbery Successful!')
        .setDescription(
          `${robber} robbed ${victim} for **${formatCurrency(result.amount)}**!\n` +
            `Maybe keep your monies in the \`/bank\` next time...`,
        )
    : new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🚨 Robbery Failed!')
        .setDescription(
          `${robber} got caught trying to rob ${victim} and paid ` +
            `**${formatCurrency(result.penalty)}** in damages to their target!`,
        );

  await interaction.reply({ embeds: [embed] });
}
