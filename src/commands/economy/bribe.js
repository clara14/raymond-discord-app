// ============================================================
// bribe.js — Pay the bot to compliment, roast, or tell a
// fortune. The payment is fully burned ("the bot pockets it"),
// and the performance comes from the AI with its usual
// personality. Demonstrates deferred replies for slow work.
// ============================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { burn, ensureWelcomeBonus } from '../../database/economy.js';
import { chatCompletion } from '../../lib/anthropic.js';
import { BRIBE, formatCurrency } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('bribe')
  .setDescription('Pay the bot to perform. It keeps the monies. Obviously.')
  // /bribe compliment <user>
  .addSubcommand((sc) =>
    sc
      .setName('compliment')
      .setDescription(`Pay ${BRIBE.compliment.price} for a (grudging) compliment.`)
      .addUserOption((o) =>
        o.setName('user').setDescription('Who to compliment').setRequired(true),
      ),
  )
  // /bribe roast <user>
  .addSubcommand((sc) =>
    sc
      .setName('roast')
      .setDescription(`Pay ${BRIBE.roast.price} to have someone roasted.`)
      .addUserOption((o) =>
        o.setName('user').setDescription('The victim').setRequired(true),
      ),
  )
  // /bribe fortune
  .addSubcommand((sc) =>
    sc
      .setName('fortune')
      .setDescription(`Pay ${BRIBE.fortune.price} to hear your fortune.`),
  );

// What the AI is asked to do for each bribe type. {buyer} and {target} are
// substituted with display names at runtime.
const PERFORMANCES = {
  compliment:
    '{buyer} just paid you {price} monies to compliment {target}. Deliver a ' +
    'genuinely nice compliment about {target}, but make it clear you\'re only ' +
    'doing it because you were paid. 1-3 sentences.',
  roast:
    '{buyer} just paid you {price} monies to roast {target}. Deliver a playful, ' +
    'clever roast of {target} — teasing between friends, never actually cruel. ' +
    '1-3 sentences.',
  fortune:
    '{buyer} just paid you {price} monies to tell their fortune. Give them an ' +
    'amusing, vaguely mystical prediction — ideally involving monies, gambling ' +
    'luck, or their loan debt. 1-3 sentences.',
};

export async function execute(interaction) {
  if (!process.env.ANTHROPIC_API_KEY) {
    await interaction.reply({
      content: 'The bot can\'t be bribed until its owner sets an ANTHROPIC_API_KEY.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const price = BRIBE[sub].price;
  const target = interaction.options.getUser('user') ?? interaction.user;

  await ensureWelcomeBonus(interaction.guildId, interaction.user.id);

  // Take the money first — a pure burn with a balance check.
  const paid = await burn(interaction.guildId, interaction.user.id, price, 'bribe', {
    kind: sub,
    target: target.id,
  });
  if (!paid.ok) {
    await interaction.reply({
      content: `A ${sub} costs ${formatCurrency(price)}, which you don't have. Awkward.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // The API call can exceed Discord's 3-second interaction deadline, so we
  // defer: Discord shows "thinking..." and gives us 15 minutes to editReply.
  await interaction.deferReply();

  // Build the one-off instruction for the AI (it still gets its usual
  // snarky system prompt from config via chatCompletion).
  const buyerName = interaction.user.displayName ?? interaction.user.username;
  const targetName = target.displayName ?? target.username;
  const instruction = PERFORMANCES[sub]
    .replaceAll('{buyer}', buyerName)
    .replaceAll('{target}', targetName)
    .replaceAll('{price}', String(price));

  let performance;
  try {
    performance = await chatCompletion([{ role: 'user', content: instruction }]);
  } catch (err) {
    // The monies are already burned; own it in character rather than
    // refunding (the bank always wins).
    console.error('Bribe error:', err);
    performance =
      '*pockets the monies* ...I\'ll owe you one. My muse is on break.';
  }

  const titles = {
    compliment: '💐 A Paid Compliment',
    roast: '🔥 A Paid Roast',
    fortune: '🔮 A Paid Fortune',
  };

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(titles[sub])
    .setDescription(performance.slice(0, 4000))
    .setFooter({
      text: `${buyerName} paid ${formatCurrency(price)} for this. The bot keeps it.`,
    });

  await interaction.editReply({ embeds: [embed] });
}
