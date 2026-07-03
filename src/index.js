// ============================================================
// index.js — Main entry point for the bot.
// Boots everything up in order: commands, events, database,
// then logs in to Discord.
// ============================================================

// Core discord.js classes:
//  - Client: the bot connection itself
//  - Collection: an enhanced Map, used here to store commands
//  - GatewayIntentBits: declares which events Discord should send us
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import 'dotenv/config'; // Loads variables from .env into process.env

// Our own modules that do the heavy lifting.
import { loadCommands } from './handlers/commandHandler.js';
import { loadEvents } from './handlers/eventHandler.js';
import { initDatabase, pool } from './database/db.js';

// Create the bot client and declare intents.
// Each intent is a category of events we want to receive; requesting
// only what we need keeps the bot efficient and respects Discord's rules.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,          // Server create/update, channels, roles
    GatewayIntentBits.GuildMembers,    // Member join/leave/update (needs portal toggle)
    GatewayIntentBits.GuildMessages,   // Messages sent in servers
    GatewayIntentBits.MessageContent,  // Actual text of messages (needs portal toggle)
  ],
});

// Attach a Collection to the client to hold every loaded command.
// Events (like interactionCreate) read from this to find the right handler.
client.commands = new Collection();

// Startup sequence, wrapped in an async function so we can await each step.
async function main() {
  console.log('Starting bot...\n');

  // 1. Discover and register all command files.
  console.log('Loading commands:');
  await loadCommands(client);

  // 2. Discover and wire up all event files.
  console.log('\nLoading events:');
  await loadEvents(client);

  // 3. Connect to PostgreSQL and ensure tables exist.
  console.log('\nConnecting to database:');
  await initDatabase();

  // 4. Log in to Discord — this is what actually brings the bot online.
  await client.login(process.env.DISCORD_TOKEN);
}

// Run startup; if anything critical fails, log it and exit so a process
// manager (PM2/systemd) can restart cleanly rather than run half-broken.
main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

// ------------------------------------------------------------
// Graceful shutdown.
// PM2/systemd (and `pm2 restart`) send SIGTERM; Ctrl+C sends SIGINT.
// On either, we stop taking new work and close our connections cleanly:
//  1. client.destroy() — disconnect from Discord (stops new events)
//  2. pool.end() — waits for in-flight database queries to finish,
//     then closes the connections politely
// Data safety does NOT depend on this — every money operation is a
// database transaction, so even a hard kill can't tear a write. This
// just avoids noisy connection-reset errors in PostgreSQL's logs and
// ends the process crisply.
// ------------------------------------------------------------
let shuttingDown = false;

async function shutdown(signal) {
  // A second signal while already shutting down = exit immediately.
  if (shuttingDown) process.exit(1);
  shuttingDown = true;

  console.log(`\n${signal} received — shutting down gracefully...`);

  // Belt and braces: if anything hangs, force-exit after 10 seconds
  // rather than block PM2's restart. unref() lets the process exit
  // sooner if cleanup finishes first.
  setTimeout(() => {
    console.error('Shutdown timed out; forcing exit.');
    process.exit(1);
  }, 10_000).unref();

  try {
    // Stop receiving Discord events (no new commands arrive after this).
    client.destroy();
    console.log('  ✓ Discord connection closed');

    // Let in-flight queries finish, then close the pool.
    await pool.end();
    console.log('  ✓ Database pool drained and closed');
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }

  console.log('Goodbye! 👋');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM')); // PM2/systemd stop & restart
process.on('SIGINT', () => shutdown('SIGINT'));   // Ctrl+C in a terminal
