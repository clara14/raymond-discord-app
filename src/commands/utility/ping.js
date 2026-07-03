// ============================================================
// ping.js — Simple health-check command.
// Demonstrates the most basic pattern: a stateless reply.
// ============================================================

import { SlashCommandBuilder } from 'discord.js';

// Define the slash command's name and description.
export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check if the bot is responsive and see its latency.');

// Runs when someone uses /ping.
export async function execute(interaction) {
  // Send an initial reply. withResponse: true gives us back the sent
  // message so we can measure how long the round trip took.
  const sent = await interaction.reply({
    content: 'Pinging...',
    withResponse: true,
  });

  // Roundtrip = time between the user's command and our reply landing.
  const roundtrip =
    sent.resource.message.createdTimestamp - interaction.createdTimestamp;

  // Heartbeat = the bot's ongoing websocket ping to Discord.
  const heartbeat = Math.round(interaction.client.ws.ping);

  // Replace the placeholder text with the real numbers.
  await interaction.editReply(
    `🏓 Pong!\n• Roundtrip: **${roundtrip}ms**\n• Websocket heartbeat: **${heartbeat}ms**`,
  );
}
