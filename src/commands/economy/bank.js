// ============================================================
// bank.js (command) — Deposit monies for safekeeping. Banked
// monies can't be spent or gambled — but they also can't be
// robbed, which is the whole point.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { deposit, withdraw, getBankStatus } from '../../database/bank.js';
import { ensureWelcomeBonus } from '../../database/economy.js';
import { formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('bank')
  .setDescription('Keep your monies safe from robbers (but out of reach).')
  .addSubcommand((sc) =>
    sc
      .setName('deposit')
      .setDescription('Move monies from your wallet into the bank.')
      .addIntegerOption((o) =>
        o.setName('amount').setDescription('How much to deposit').setRequired(true).setMinValue(1),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('withdraw')
      .setDescription('Move monies from the bank back to your wallet.')
      .addIntegerOption((o) =>
        o.setName('amount').setDescription('How much to withdraw').setRequired(true).setMinValue(1),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName('status').setDescription('See your wallet and bank balances.'),
  );

// Renders the standard wallet/bank summary used by all three subcommands.
function balancesEmbed(title, wallet, banked, note = '') {
  return new EmbedBuilder()
    .setColor(0x2c8fd6)
    .setTitle(title)
    .setDescription(
      `${note}${note ? '\n\n' : ''}` +
        `👛 Wallet: **${formatCurrency(wallet)}** (spendable — and robbable)\n` +
        `🏦 Banked: **${formatCurrency(banked)}** (safe from robbers)`,
    );
}

export async function execute(interaction) {
  await ensureWelcomeBonus(interaction.guildId, interaction.user.id);
  const sub = interaction.options.getSubcommand();

  if (sub === 'status') {
    const s = await getBankStatus(interaction.guildId, interaction.user.id);
    await interaction.reply({
      embeds: [balancesEmbed('🏦 Your Accounts', s.wallet, s.banked)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const amount = interaction.options.getInteger('amount');

  if (sub === 'deposit') {
    const r = await deposit(interaction.guildId, interaction.user.id, amount);
    if (!r.ok) {
      await interaction.reply({
        content: `You don't have ${formatCurrency(amount)} in your wallet to deposit.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [
        balancesEmbed('🏦 Deposit Complete', r.wallet, r.banked,
          `Deposited **${formatCurrency(amount)}**.`),
      ],
    });
    return;
  }

  // withdraw
  const r = await withdraw(interaction.guildId, interaction.user.id, amount);
  if (!r.ok) {
    await interaction.reply({
      content: `You don't have ${formatCurrency(amount)} in the bank to withdraw.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.reply({
    embeds: [
      balancesEmbed('🏦 Withdrawal Complete', r.wallet, r.banked,
        `Withdrew **${formatCurrency(amount)}**.`),
    ],
  });
}
