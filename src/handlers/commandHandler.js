// ============================================================
// commandHandler.js — Auto-loads every command file.
// Walks commands/<category>/*.js and registers each one on the
// client, so adding a command never means editing this file.
// ============================================================

import { readdirSync } from 'node:fs';               // Read directory contents
import { join, dirname } from 'node:path';           // Build cross-platform paths
import { fileURLToPath, pathToFileURL } from 'node:url'; // ESM path <-> URL helpers

// In ES modules there's no __dirname, so we derive it from import.meta.url.
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Loads every command from commands/ and its subfolders onto client.commands.
 * Each command file must export `data` (a SlashCommandBuilder) and `execute`.
 */
export async function loadCommands(client) {
  // Path to the top-level commands directory.
  const commandsPath = join(__dirname, '..', 'commands');

  // Get each category subfolder (utility, moderation, games, genshin).
  const categories = readdirSync(commandsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  // Walk each category folder.
  for (const category of categories) {
    const categoryPath = join(commandsPath, category);

    // Only pick up .js files inside the category.
    const commandFiles = readdirSync(categoryPath).filter((file) => file.endsWith('.js'));

    // Import each command file and register it if it has the required shape.
    for (const file of commandFiles) {
      const filePath = join(categoryPath, file);

      // pathToFileURL makes dynamic import work reliably across OSes.
      const command = await import(pathToFileURL(filePath).href);

      // Guard: a valid command must expose both `data` and `execute`.
      if ('data' in command && 'execute' in command) {
        // Key the command by its slash name so events can look it up fast.
        client.commands.set(command.data.name, command);
        console.log(`  ✓ Loaded command: ${command.data.name} (${category})`);
      } else {
        // Warn (don't crash) on malformed files so one bad command
        // doesn't take the whole bot down at startup.
        console.warn(`  ⚠ Skipped ${filePath} — missing "data" or "execute" export`);
      }
    }
  }
}
