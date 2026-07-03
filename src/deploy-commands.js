// ============================================================
// deploy-commands.js — Registers slash commands with Discord.
// Run this (npm run deploy) whenever you add a command or change
// its name/description/options. Not needed for logic-only edits.
// ============================================================

import { REST, Routes } from 'discord.js';  // REST client + API route builders
import 'dotenv/config';
import { loadCommandModules } from './handlers/commandHandler.js';

// Reuse the bot's own command discovery, then convert each definition to
// the raw JSON payload Discord's API expects. Only `data` matters here —
// deployment sends definitions, not behavior.
const commands = (await loadCommandModules())
  .filter(({ module }) => 'data' in module)
  .map(({ module }) => module.data.toJSON());

// Authenticate the REST client with the bot token.
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

try {
  console.log(`Deploying ${commands.length} slash command(s)...`);

  // applicationGuildCommands registers to ONE server and updates instantly —
  // ideal during development. For a public bot, switch to
  // Routes.applicationCommands(CLIENT_ID) to register globally (can take ~1hr).
  const data = await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands },
  );

  console.log(`Successfully deployed ${data.length} command(s).`);
} catch (error) {
  console.error(error);
}
