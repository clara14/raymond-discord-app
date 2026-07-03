// ============================================================
// commandHandler.js — Auto-loads every command file.
// Walks commands/<category>/*.js and registers each one on the
// client, so adding a command never means editing this file.
// The walker itself is exported separately because the deploy
// script and the test suite need the same file discovery
// without a client.
// ============================================================

import { readdirSync } from 'node:fs';               // Read directory contents
import { join, dirname } from 'node:path';           // Build cross-platform paths
import { fileURLToPath, pathToFileURL } from 'node:url'; // ESM path <-> URL helpers

// In ES modules there's no __dirname, so we derive it from import.meta.url.
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Discovers and imports every command module under commands/<category>/,
 * WITHOUT touching a client. Returns [{ category, file, filePath, module }]
 * in directory order and does NO validation — each caller decides what a
 * "usable" command looks like (the bot needs data + execute; the deploy
 * script only needs data; the test suite checks the full shape itself).
 * This is the single source of truth for what counts as a command file,
 * shared by startup, deploy-commands.js, and the loader smoke test, so
 * they can never disagree.
 */
export async function loadCommandModules() {
  // Path to the top-level commands directory.
  const commandsPath = join(__dirname, '..', 'commands');

  // Get each category subfolder (economy, games, lol, moderation, utility).
  const categories = readdirSync(commandsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const modules = [];
  for (const category of categories) {
    const categoryPath = join(commandsPath, category);

    // Only pick up .js files inside the category.
    const commandFiles = readdirSync(categoryPath).filter((file) => file.endsWith('.js'));

    for (const file of commandFiles) {
      const filePath = join(categoryPath, file);

      // pathToFileURL makes dynamic import work reliably across OSes.
      const module = await import(pathToFileURL(filePath).href);
      modules.push({ category, file, filePath, module });
    }
  }
  return modules;
}

/**
 * Loads every command from commands/ and its subfolders onto client.commands.
 * Each command file must export `data` (a SlashCommandBuilder) and `execute`.
 */
export async function loadCommands(client) {
  for (const { category, filePath, module } of await loadCommandModules()) {
    // Guard: a valid command must expose both `data` and `execute`.
    if ('data' in module && 'execute' in module) {
      // Key the command by its slash name so events can look it up fast.
      client.commands.set(module.data.name, module);
      console.log(`  ✓ Loaded command: ${module.data.name} (${category})`);
    } else {
      // Warn (don't crash) on malformed files so one bad command
      // doesn't take the whole bot down at startup.
      console.warn(`  ⚠ Skipped ${filePath} — missing "data" or "execute" export`);
    }
  }
}
