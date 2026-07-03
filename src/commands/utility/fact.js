// ============================================================
// fact.js — Teach the bot trivia about server members. Facts
// get woven into the AI chat's context so its banter "knows"
// people. Anyone can add; the adder or a mod can remove.
// ============================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import {
  addFact,
  getFacts,
  removeFact,
  MAX_FACTS_PER_USER,
  MAX_FACT_LENGTH,
} from '../../database/userFacts.js';
import { checkAchievements } from '../../database/achievements.js';
import { announceAchievements } from '../../lib/achievements.js';

export const data = new SlashCommandBuilder()
  .setName('fact')
  .setDescription('Teach the bot facts about members (it uses them in chat).')
  .addSubcommand((sc) =>
    sc
      .setName('add')
      .setDescription('Teach the bot something about a member.')
      .addUserOption((o) =>
        o.setName('user').setDescription('Who the fact is about').setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('fact')
          .setDescription('The fact (keep it fun, not cruel)')
          .setRequired(true)
          .setMaxLength(MAX_FACT_LENGTH),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('list')
      .setDescription('See what the bot knows about a member.')
      .addUserOption((o) =>
        o.setName('user').setDescription('Whose facts (default: you)').setRequired(false),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('remove')
      .setDescription('Remove a fact by its id (yours, or any if you\'re a mod).')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('The fact id from /fact list').setRequired(true),
      ),
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'add') return handleAdd(interaction);
  if (sub === 'list') return handleList(interaction);
  if (sub === 'remove') return handleRemove(interaction);
}

// --- /fact add ---
async function handleAdd(interaction) {
  const target = interaction.options.getUser('user');
  const fact = interaction.options.getString('fact');

  // Facts about bots are pointless; facts must be about people.
  if (target.bot) {
    await interaction.reply({
      content: 'The bot already knows everything about itself. Pick a human.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await addFact(interaction.guildId, target.id, interaction.user.id, fact);
  if (!result.ok) {
    await interaction.reply({
      content: `${target.username} already has ${MAX_FACTS_PER_USER} facts. Remove one first (\`/fact list\`).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply(
    `🧠 Noted (fact #${result.id}): **${target.username}** — "${fact}"\nThe bot will remember this in chat.`,
  );

  // Achievement check for the TEACHER (facts-about-you checks for the
  // subject come with the phase 2 catalog).
  const earned = await checkAchievements(interaction.guildId, interaction.user.id, 'fact', {
    about: target.id,
  });
  await announceAchievements(interaction, earned);
}

// --- /fact list ---
async function handleList(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const facts = await getFacts(interaction.guildId, target.id);

  if (facts.length === 0) {
    await interaction.reply({
      content: `The bot knows nothing about ${target.username}. A blank slate. Use \`/fact add\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = facts.map((f) => `**#${f.id}** — "${f.fact}" *(added by <@${f.added_by}>)*`);
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`🧠 What the bot knows about ${target.username}`)
    .setDescription(lines.join('\n'));

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// --- /fact remove ---
async function handleRemove(interaction) {
  const factId = interaction.options.getInteger('id');
  const isMod = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;

  const removed = await removeFact(interaction.guildId, factId, interaction.user.id, isMod);
  await interaction.reply({
    content: removed
      ? `🗑️ Fact #${factId} forgotten.`
      : 'No such fact — or it isn\'t yours to remove (mods can remove any).',
    flags: MessageFlags.Ephemeral,
  });
}
