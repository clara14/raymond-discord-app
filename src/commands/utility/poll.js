// ============================================================
// poll.js — Creates a yes/no poll.
// Demonstrates a command that takes user input (an option) and
// adds reactions to its own message.
// ============================================================

import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('poll')
  .setDescription('Create a simple yes/no poll.')
  // Add a required text option for the poll question.
  .addStringOption((option) =>
    option
      .setName('question')
      .setDescription('What do you want to ask?')
      .setRequired(true),
  );

export async function execute(interaction) {
  // Read the value the user typed for the "question" option.
  const question = interaction.options.getString('question');

  // Post the poll message; withResponse gives us the message object back
  // so we can react to it.
  const message = await interaction.reply({
    content: `📊 **${question}**\n\nReact to vote!`,
    withResponse: true,
  });

  // Add thumbs-up / thumbs-down as the voting buttons.
  await message.resource.message.react('👍');
  await message.resource.message.react('👎');
}
