// ============================================================
// loan.js — Bank loans: borrow against your credit limit,
// repay manually, check your debt. Interest accrues daily;
// /daily and /work earnings are partly garnished while in debt.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { borrow, repay, getLoanStatus } from '../../database/loans.js';
import { ensureWelcomeBonus, getBalance } from '../../database/economy.js';
import { formatCurrency, LOAN } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('loan')
  .setDescription('Bank loans: borrow monies now, pay them back with interest.')
  // /loan borrow <amount>
  .addSubcommand((sc) =>
    sc
      .setName('borrow')
      .setDescription(`Take out a loan (${LOAN.dailyRatePct}%/day interest).`)
      .addIntegerOption((o) =>
        o
          .setName('amount')
          .setDescription('How much to borrow')
          .setRequired(true)
          .setMinValue(LOAN.minLoan),
      ),
  )
  // /loan repay [amount]
  .addSubcommand((sc) =>
    sc
      .setName('repay')
      .setDescription('Pay down your loan (omit amount to pay the max you can).')
      .addIntegerOption((o) =>
        o
          .setName('amount')
          .setDescription('How much to repay (default: as much as possible)')
          .setRequired(false)
          .setMinValue(1),
      ),
  )
  // /loan status
  .addSubcommand((sc) =>
    sc.setName('status').setDescription('See your debt and credit limit.'),
  );

export async function execute(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'Loans only work in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Everyone gets their starting bonus before touching the bank.
  await ensureWelcomeBonus(interaction.guildId, interaction.user.id);

  const sub = interaction.options.getSubcommand();
  if (sub === 'borrow') return handleBorrow(interaction);
  if (sub === 'repay') return handleRepay(interaction);
  if (sub === 'status') return handleStatus(interaction);
}

// --- /loan borrow ---
async function handleBorrow(interaction) {
  const amount = interaction.options.getInteger('amount');
  const result = await borrow(interaction.guildId, interaction.user.id, amount);

  if (!result.ok) {
    const msg =
      result.reason === 'active_loan'
        ? 'You already have an active loan. Pay it off first with `/loan repay`.'
        : `That's over your credit limit of **${formatCurrency(result.limit)}**. ` +
          'Your limit grows as you earn from `/daily` and `/work`.';
    await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    return;
  }

  const balance = await getBalance(interaction.guildId, interaction.user.id);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🏦 Loan Approved')
    .setDescription(
      `You borrowed **${formatCurrency(result.amount)}**.\n\n` +
        `Interest: **${LOAN.dailyRatePct}%/day** on the principal.\n` +
        `While in debt, **${LOAN.garnishPct}%** of your \`/daily\` and \`/work\` ` +
        `earnings go toward repayment automatically.\n\n` +
        `New balance: ${formatCurrency(balance)}`,
    );
  await interaction.reply({ embeds: [embed] });
}

// --- /loan repay ---
async function handleRepay(interaction) {
  // If no amount given, try to pay the whole debt (repay() caps it at
  // what's owed and what they can afford anyway).
  const amount =
    interaction.options.getInteger('amount') ?? Number.MAX_SAFE_INTEGER;

  const result = await repay(interaction.guildId, interaction.user.id, amount);

  if (!result.ok) {
    const msg =
      result.reason === 'no_loan'
        ? 'You don\'t have an active loan. Nice.'
        : 'You don\'t have any monies to repay with right now.';
    await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(result.cleared ? 0x2ecc71 : 0xf1c40f)
    .setTitle(result.cleared ? '🎉 Loan Paid Off!' : '🏦 Payment Received')
    .setDescription(
      `You paid **${formatCurrency(result.paid)}**.\n` +
        (result.cleared
          ? 'You\'re debt-free!'
          : `Remaining debt: **${formatCurrency(result.owedRemaining)}**`),
    );
  await interaction.reply({ embeds: [embed] });
}

// --- /loan status ---
async function handleStatus(interaction) {
  const status = await getLoanStatus(interaction.guildId, interaction.user.id);

  if (!status.active) {
    await interaction.reply({
      content:
        `You have no active loan. Your credit limit is **${formatCurrency(status.limit)}** ` +
        '(it grows as you earn from `/daily` and `/work`).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Show the debt breakdown: principal, accrued interest, payments.
  const interest = status.owed + status.repaid - status.principal;
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🏦 Loan Status')
    .setDescription(
      `**Owed now:** ${formatCurrency(status.owed)}\n\n` +
        `Principal: ${formatCurrency(status.principal)}\n` +
        `Interest accrued: ${formatCurrency(Math.max(0, interest))} ` +
        `(${status.dailyRatePct}%/day, ${status.ageDays.toFixed(1)} days old)\n` +
        `Repaid so far: ${formatCurrency(status.repaid)}`,
    );
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
