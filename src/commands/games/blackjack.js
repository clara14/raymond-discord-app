// ============================================================
// blackjack.js (command) — Play blackjack with Hit/Stand buttons.
// Demonstrates message components (buttons), a button handler
// routed via customId, and rendering game state as embeds.
// ============================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { startOrResume, applyAction } from '../../database/blackjack.js';
import { ensureWelcomeBonus } from '../../database/economy.js';
import { handValue } from '../../lib/blackjack.js';
import { formatCurrency, BLACKJACK } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('blackjack')
  .setDescription('Play a hand of blackjack against the dealer.')
  .addIntegerOption((o) =>
    o
      .setName('bet')
      .setDescription('How many monies to wager')
      .setRequired(true)
      .setMinValue(BLACKJACK.minBet),
  );

// --- Rendering helpers ---

// Renders a hand like "A♠  10♥".
function handString(hand) {
  return hand.map((c) => `${c.rank}${c.suit}`).join('  ');
}

// The Hit/Stand button row. customIds embed the game id so the handler can
// find the right game, and so buttons keep working after a restart.
function activeComponents(gameId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`blackjack:hit:${gameId}`)
        .setLabel('Hit')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`blackjack:stand:${gameId}`)
        .setLabel('Stand')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// Embed for an in-progress game: dealer's hole card stays hidden.
function activeEmbed(game) {
  const dealerUp = game.dealerHand[0];
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🃏 Blackjack')
    .addFields(
      {
        name: 'Your hand',
        value: `${handString(game.playerHand)}  **(${handValue(game.playerHand)})**`,
      },
      {
        name: 'Dealer shows',
        value: `${dealerUp.rank}${dealerUp.suit}  🂠`,
      },
    )
    .setFooter({ text: `Bet: ${formatCurrency(game.bet)}` });
}

// Embed for a finished game: reveal the dealer's full hand and the outcome.
function finishedEmbed(game, result, newBalance) {
  const outcomes = {
    blackjack: '🎉 Blackjack! You win 3:2.',
    win: '✅ You win!',
    lose: '❌ You lose.',
    push: '➖ Push — your bet is returned.',
  };
  const color =
    result === 'lose' ? 0xe74c3c : result === 'push' ? 0x95a5a6 : 0x2ecc71;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle('🃏 Blackjack')
    .addFields(
      {
        name: 'Your hand',
        value: `${handString(game.playerHand)}  **(${handValue(game.playerHand)})**`,
      },
      {
        name: 'Dealer hand',
        value: `${handString(game.dealerHand)}  **(${handValue(game.dealerHand)})**`,
      },
    )
    .setDescription(outcomes[result])
    .setFooter({
      text:
        newBalance != null
          ? `New balance: ${formatCurrency(newBalance)}`
          : `Bet: ${formatCurrency(game.bet)}`,
    });
}

// --- Slash command entry ---
export async function execute(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'Blackjack only works in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const bet = interaction.options.getInteger('bet');
  await ensureWelcomeBonus(interaction.guildId, interaction.user.id);

  const res = await startOrResume(interaction.guildId, interaction.user.id, bet);

  if (!res.ok) {
    await interaction.reply({
      content: `You don't have ${formatCurrency(bet)} to bet.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Already had a game going — re-show it with fresh buttons.
  if (res.resumed) {
    await interaction.reply({
      content: 'You already have a game in progress:',
      embeds: [activeEmbed(res.game)],
      components: activeComponents(res.game.id),
    });
    return;
  }

  // Natural blackjack on the deal — game's already over.
  if (res.finished) {
    await interaction.reply({
      embeds: [finishedEmbed(res.game, res.result, res.newBalance)],
    });
    return;
  }

  // Normal case: an active game with Hit/Stand buttons.
  await interaction.reply({
    embeds: [activeEmbed(res.game)],
    components: activeComponents(res.game.id),
  });
}

// --- Button handler (routed here by interactionCreate) ---
export async function handleButton(interaction) {
  // customId is "blackjack:<action>:<gameId>".
  const [, action, gameId] = interaction.customId.split(':');

  const res = await applyAction(gameId, interaction.user.id, action);

  if (!res.ok) {
    // Someone else's game — tell just them, don't touch the message.
    if (res.reason === 'not_owner') {
      await interaction.reply({
        content: 'This isn\'t your game.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    // Game is gone or already finished — clear the buttons.
    await interaction
      .update({ content: 'This game has ended.', embeds: [], components: [] })
      .catch(() => {});
    return;
  }

  // update() edits the message the button is attached to.
  if (res.finished) {
    await interaction.update({
      content: null,
      embeds: [finishedEmbed(res.game, res.result, res.newBalance)],
      components: [],
    });
  } else {
    await interaction.update({
      embeds: [activeEmbed(res.game)],
      components: activeComponents(res.game.id),
    });
  }
}
