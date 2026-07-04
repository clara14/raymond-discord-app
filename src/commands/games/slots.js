// ============================================================
// slots.js (command) — Spin the slot machine. Weighted reels,
// tuned payout table (~88.5% RTP), atomic wager via the
// economy's generic resolveWager helper.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { resolveWager, ensureWelcomeBonus } from '../../database/economy.js';
import { spinReels, evaluateSpin, payout } from '../../lib/slots.js';
import { checkAchievements } from '../../database/achievements.js';
import { announceAchievements } from '../../lib/achievements.js';
import { formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('slots')
  .setDescription('Spin the slot machine. Triples pay big; sevens pay biggest.')
  .addIntegerOption((o) =>
    o
      .setName('bet')
      .setDescription('How many monies to wager')
      .setRequired(true)
      .setMinValue(1),
  );

export async function execute(interaction) {
  const bet = interaction.options.getInteger('bet');
  await ensureWelcomeBonus(interaction.guildId, interaction.user.id);

  // The wager helper handles funds check + lock + ledger row; we just
  // supply the game: spin, score, and report the signed net.
  const result = await resolveWager(
    interaction.guildId,
    interaction.user.id,
    bet,
    (wager) => {
      const reels = spinReels();
      const { multiplier, label } = evaluateSpin(reels);
      const credit = payout(wager, multiplier); // total returned on a win
      return {
        net: credit - wager, // win: credit-bet; loss: -bet
        type: 'slots',
        metadata: { bet: wager, reels, multiplier },
        reels,
        label,
        credit,
      };
    },
  );

  if (!result.ok) {
    await interaction.reply({
      content: `You don't have ${formatCurrency(bet)} to bet.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const won = result.net > 0;
  const pushed = result.net === 0;

  // The reel display is the fun part — make it look like a machine.
  const display = `╔═══════════╗\n║ ${result.reels.join(' │ ')} ║\n╚═══════════╝`;

  const outcome = won
    ? `🎉 ${result.label} You won **${formatCurrency(result.net)}**!`
    : pushed
      ? `${result.label} Your bet came back.`
      : `😢 ${result.label} You lost **${formatCurrency(bet)}**.`;

  const embed = new EmbedBuilder()
    .setColor(won ? 0x2ecc71 : pushed ? 0x95a5a6 : 0xe74c3c)
    .setTitle('🎰 Slots')
    .setDescription(`${display}\n\n${outcome}\nNew balance: ${formatCurrency(result.newBalance)}`);

  await interaction.reply({ embeds: [embed] });

  // Achievement checks run after the spin committed. The reels ride
  // along — that's how the jackpot check will read triple sevens.
  const earned = await checkAchievements(interaction.guildId, interaction.user.id, 'slots', {
    bet,
    reels: result.reels,
    multiplier: result.multiplier,
    net: result.net,
    newBalance: result.newBalance,
  });
  await announceAchievements(interaction, earned);
}
