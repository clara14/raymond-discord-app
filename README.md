# Discord Bot

A multipurpose Discord bot built to grow: moderation, games, Genshin utilities, and practical tools. Node.js + discord.js v14, with PostgreSQL for persistent state.

## Architecture

The whole design is built around **auto-loading**, so adding a feature never means editing plumbing — you just drop a file in the right folder.

```
src/
├── index.js              # Entry point — wires everything together
├── deploy-commands.js    # Registers slash commands with Discord (run after adding/changing commands)
├── handlers/
│   ├── commandHandler.js # Auto-loads every command from commands/*/
│   └── eventHandler.js   # Auto-loads every event from events/
├── events/
│   ├── ready.js          # Fires once when the bot connects
│   └── interactionCreate.js  # Routes slash commands to the right file
├── commands/
│   ├── utility/          # ping, poll
│   ├── moderation/       # warn (uses the database + permissions)
│   ├── games/            # (empty — your next features go here)
│   └── genshin/          # (empty — your next features go here)
└── database/
    └── db.js             # PostgreSQL pool + schema initialization
```

## One-time setup

1. **Create the bot application**
   - Go to https://discord.com/developers/applications → New Application.
   - Under **Bot**, click "Reset Token" and copy the token.
   - Under **Bot**, enable the **Server Members Intent** and **Message Content Intent**.
   - Under **OAuth2 → URL Generator**, select scopes `bot` and `applications.commands`, pick permissions, and use the generated URL to invite the bot to your server.

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Fill in `DISCORD_TOKEN`, `CLIENT_ID` (Application ID), `GUILD_ID` (your server — right-click it with Developer Mode on → Copy Server ID), and `DATABASE_URL`.

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Register the slash commands**
   ```bash
   npm run deploy
   ```

5. **Start the bot**
   ```bash
   npm start      # or: npm run dev  (auto-restarts on file changes)
   ```

## Adding a new command

Create a file anywhere under `commands/` — for example `commands/games/roll.js`:

```js
import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('roll')
  .setDescription('Roll a six-sided die.');

export async function execute(interaction) {
  const result = Math.floor(Math.random() * 6) + 1;
  await interaction.reply(`🎲 You rolled a **${result}**!`);
}
```

Then run `npm run deploy` again (only needed when a command's name/options change) and restart. That's it — the handler finds it automatically.

## Database

The `warnings` table is created automatically on startup as an example. As you build features, add new `CREATE TABLE IF NOT EXISTS` statements in `initDatabase()` in `src/database/db.js`, and use the `query()` helper from any command. This keeps your schema in one place — a good habit that scales.

## Running on your homelab

This is designed to run as a long-lived service on Proxmox — either an LXC container or a small VM. Point `DATABASE_URL` at your PostgreSQL instance. For keeping it alive across crashes and reboots, use a process manager like **PM2** (`pm2 start src/index.js --name discord-bot`) or a systemd service. Logging and auto-restart are where you'll learn to operate a production-style service.
