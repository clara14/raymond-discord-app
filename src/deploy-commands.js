// ============================================================
// deploy-commands.js — Registers slash commands with Discord.
// Run this (npm run deploy) whenever you add a command or change
// its name/description/options. Not needed for logic-only edits.
// ============================================================

import { REST, Routes } from 'discord.js';  // REST client + API route builders
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Collect the JSON definition of every command to send to Discord.
const commands = [];
const commandsPath = join(__dirname, 'commands');

// Loop category folders, then command files within them.
const categories = readdirSync(commandsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

for (const category of categories) {
  const categoryPath = join(commandsPath, category);
  const commandFiles = readdirSync(categoryPath).filter((file) => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = join(categoryPath, file);
    const command = await import(pathToFileURL(filePath).href);
    // .toJSON() converts the SlashCommandBuilder into the raw payload
    // Discord's API expects.
    if ('data' in command) {
      commands.push(command.data.toJSON());
    }
  }
}

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
