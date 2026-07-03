// ============================================================
// gift.js — Buy someone a gift from the catalog. The sender
// pays full price; the recipient nets price minus a burned
// "gift shop fee" — a social feature that's also a money sink.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { giftTransfer, ensureWelcomeBonus } from '../../database/economy.js';
import { checkAchievements } from '../../database/achievements.js';
import { announceAchievements } from '../../lib/achievements.js';
import { GIFT, giftNet, formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('gift')
  .setDescription('Buy someone a gift from the gift shop.')
  .addUserOption((o) =>
    o.setName('user').setDescription('Who to spoil').setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName('item')
      .setDescription('What to give them')
      .setRequired(true)
      // Build the choices straight from the config catalog, so adding an
      // item there automatically adds it here (after a redeploy).
      .addChoices(
        ...GIFT.items.map((item) => ({
          name: `${item.emoji} ${item.name} — ${item.price}`,
          value: item.id,
        })),
      ),
  );

export async function execute(interaction) {
  const recipient = interaction.options.getUser('user');
  const itemId = interaction.options.getString('item');
  const item = GIFT.items.find((i) => i.id === itemId);

  // --- Validation guards ---
  if (recipient.id === interaction.user.id) {
    await interaction.reply({
      content: 'Buying gifts for yourself? Bleak. (You can\'t.)',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (recipient.bot) {
    await interaction.reply({
      content: 'Bots don\'t want gifts. Try `/bribe` instead.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Both parties need a ledger (grants the 500 welcome if new).
  await ensureWelcomeBonus(interaction.guildId, interaction.user.id);
  await ensureWelcomeBonus(interaction.guildId, recipient.id);

  // Sender pays item.price; recipient nets price minus the burned fee.
  const net = giftNet(item.price);
  const result = await giftTransfer(
    interaction.guildId,
    interaction.user.id,
    recipient.id,
    item.price,
    net,
    { item: item.id },
  );

  if (!result.ok) {
    await interaction.reply({
      content: `You can't afford ${item.name} (${formatCurrency(item.price)}).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Public, celebratory announcement — that's the point of a gift.
  const embed = new EmbedBuilder()
    .setColor(0xe91e63)
    .setTitle(`${item.emoji} A gift!`)
    .setDescription(
      `${interaction.user} bought ${recipient} **${item.name}**!\n\n` +
        `${recipient} receives ${formatCurrency(net)} ` +
        `(the gift shop kept its ${GIFT.feePct}% fee).`,
    );

  await interaction.reply({ embeds: [embed] });

  // Achievement checks run after the gift committed. The item id rides
  // along for future item-specific checks (e.g. the diamond).
  const earned = await checkAchievements(interaction.guildId, interaction.user.id, 'gift', {
    item: item.id,
    price: item.price,
    to: recipient.id,
  });
  await announceAchievements(interaction, earned);
}
