// ============================================================
// eventHandler.js — Auto-loads every event file.
// Reads events/*.js and wires each one onto the client, so new
// events just drop in without editing this file.
// ============================================================

import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Derive __dirname for ES modules (not provided automatically).
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Loads every event from events/ and attaches it to the client.
 * Each event file exports `name` (the Discord event), an optional
 * `once` flag, and an `execute` function.
 */
export async function loadEvents(client) {
  const eventsPath = join(__dirname, '..', 'events');

  // Grab all .js event files in the folder.
  const eventFiles = readdirSync(eventsPath).filter((file) => file.endsWith('.js'));

  for (const file of eventFiles) {
    const filePath = join(eventsPath, file);
    const event = await import(pathToFileURL(filePath).href);

    // `once` events (like "ready") fire a single time; everything else
    // is registered with .on to fire every time the event occurs.
    // We pass `client` as a final arg so handlers can access it.
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client));
    }
    console.log(`  ✓ Loaded event: ${event.name}`);
  }
}
