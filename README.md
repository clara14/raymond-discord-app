# Discord Bot

A multipurpose Discord bot for a small server of friends, built on Node.js + discord.js v14 with PostgreSQL. What started as "moderation and some games" has grown into:

- 🪙 **A virtual economy** ("monies") with an append-only, hash-chained transaction ledger — balances are always derived, never stored, and `/audit` cryptographically verifies the entire history
- 🎰 **Gambling games** — blackjack (with buttons that survive restarts), slots (tuned to ~88.5% RTP), coinflip, and a daily wordle with streaks and payouts
- 🎮 **League of Legends integration** — link your Riot account, and a background poller announces live games with 2x-payout betting buttons, then settles bets when the match ends
- 🤖 **An AI chat personality** — @mention the bot for snarky banter; it has real tools to look up members' economy profiles and League stats, so it roasts with actual numbers
- 🛠️ **Moderation & utility** — warnings, polls, member "facts" that feed the chat personality

## Commands (25)

| Category | Commands |
| --- | --- |
| economy | `audit` `balance` `bank` `bribe` `daily` `gift` `leaderboard` `loan` `pay` `profile` `raffle` `rob` `work` |
| games | `blackjack` `coinflip` `slots` `wordle` |
| lol | `history` `link` `lolchannel` `lolstats` |
| moderation | `warn` |
| utility | `fact` `ping` `poll` |

Economy highlights: `/bank` protects monies from `/rob` (wallet-only theft), `/loan` accrues 2%/day interest with earnings garnishment, `/raffle` pools tickets for a weighted draw, and `/gift` and `/bribe` burn fees to fight inflation.

## Architecture

The design is built around **auto-loading** — adding a feature never means editing plumbing, you just drop a file in the right folder.

```
src/
├── index.js              # Entry point: load commands → events → init DB → login
├── deploy-commands.js    # Registers slash commands with Discord (run after adding/changing commands)
├── config.js             # Every tunable knob in one place, plus pure helper functions
├── handlers/
│   ├── commandHandler.js # Auto-loads every command from commands/*/ (walker shared with deploy + tests)
│   └── eventHandler.js   # Auto-loads every event from events/
├── events/
│   ├── ready.js          # Startup logging; kicks off the match poller
│   ├── interactionCreate.js  # Routes slash commands, buttons, and modals (by customId prefix)
│   └── messageCreate.js  # The AI chat: replies to @mentions with history + tools
├── commands/
│   ├── economy/  games/  lol/  moderation/  utility/
├── database/             # One module per feature; all money logic builds on tx.js
│   ├── db.js             # Pool + schema init (CREATE TABLE IF NOT EXISTS + additive migrations)
│   ├── tx.js             # THE transaction toolkit: locks, ledger appends, hash chaining
│   └── ...               # economy, bank, loans, raffle, robbery, blackjack, wordle, lol*, chat, ...
├── lib/                  # Pure logic, one concern per file, all unit-tested
│   ├── blackjack.js  slots.js  wordle.js  ledgerHash.js
│   ├── riot.js           # Riot API client (cluster vs platform routing)
│   ├── anthropic.js      # Messages API client with a tool-use loop
│   └── chatTools.js      # The AI chat's real-data tools
├── tasks/
│   └── matchPoller.js    # Self-rescheduling background loop: detect → announce → settle
└── test/                 # 87 tests on the built-in node:test runner (zero extra deps)
```

### The money rules (short version)

The ledger is **append-only**: every balance is `SUM(amount)` over a user's rows, every balance-checked write happens inside a transaction under an advisory lock, and every row is hash-chained to the previous one (edit history and `/audit` will tell on you). See `CLAUDE.md` for the full invariants.

## One-time setup

1. **Create the bot application**
   - Go to https://discord.com/developers/applications → New Application.
   - Under **Bot**, click "Reset Token" and copy the token.
   - Under **Bot**, enable the **Server Members Intent** and **Message Content Intent**.
   - Under **OAuth2 → URL Generator**, select scopes `bot` and `applications.commands`, pick permissions, and use the generated URL to invite the bot to your server.

2. **Have a PostgreSQL database ready** — any Postgres 14+ works. The schema creates itself on first boot; you just supply an empty database.

3. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Required: `DISCORD_TOKEN`, `CLIENT_ID` (Application ID), `GUILD_ID` (right-click your server with Developer Mode on → Copy Server ID), `DATABASE_URL`.
   Optional: `ANTHROPIC_API_KEY` (AI chat + `/bribe`), `RIOT_API_KEY` + `RIOT_CLUSTER`/`RIOT_PLATFORM` (all LoL features). Features without their key politely no-op.

4. **Install, register, run**
   ```bash
   npm install
   npm run deploy   # registers slash commands (re-run when command definitions change)
   npm start        # or: npm run dev  (auto-restarts on file changes)
   ```

## Testing

```bash
npm test
```

87 tests on the built-in `node:test` runner — no test dependencies. Pure game/ledger logic is unit-tested (including a 1M-spin Monte Carlo verifying the slots' designed RTP), and a loader smoke test imports every command file to catch broken exports before startup would.

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

Then `npm run deploy` and restart — the handler finds it automatically. If it wagers monies, build on `economy.resolveWager` so the funds check, locking, and ledger write come for free.

## Roadmap & shelved work

- `docs/IDEAS.md` — the living feature backlog (Genshin utilities are the founding idea and still unbuilt!)
- `docs/shelved/voice-tts/` — a complete voice/TTS feature, shelved with reintegration notes

## Running on your homelab

This is designed to run as a long-lived service on Proxmox — either an LXC container or a small VM. Point `DATABASE_URL` at your PostgreSQL instance and use **PM2** (`pm2 start src/index.js --name discord-bot`) or a systemd service for restarts. Update workflow on a live host: `git pull` → `npm install` (if deps changed) → `npm run deploy` (if commands changed) → `pm2 restart discord-bot`. Data safety comes from the database transactions, not the shutdown handler.
