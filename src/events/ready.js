// ============================================================
// ready.js — Fires once, when the bot finishes connecting.
// Startup logging plus kicking off background tasks that need
// a live client (like the LoL match poller).
// ============================================================

import { Events } from 'discord.js'; // Named event constants (avoids typos)
import { startMatchPoller, handleButton, handleModal } from '../tasks/matchPoller.js';

// The Discord event this file handles.
export const name = Events.ClientReady;

// `once` = true means this runs a single time, not on every reconnect.
export const once = true;

// Runs when the bot is fully logged in and ready.
export function execute(client) {
  console.log(`\n🤖 Logged in as ${client.user.tag}`);
  console.log(`   Serving ${client.guilds.cache.size} server(s)\n`);

  // Register the betting UI handlers under the 'lolbet' prefix, then start
  // the background poller (it no-ops politely if RIOT_API_KEY isn't set).
  client.components.set('lolbet', { handleButton, handleModal });
  startMatchPoller(client);
}
