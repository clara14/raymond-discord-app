# CLAUDE.md — Discord Bot Project

A multipurpose Discord bot for a small server of friends: a virtual economy
("monies"), gambling games, League of Legends match announcements + betting,
an AI chat personality, and moderation/utility commands. Built across many
sessions in Claude chat; this file transfers that accumulated knowledge.

## Owner context

- Cesar: telecom engineer (IT at a medical network), strong relational-DB
  background — treat schema design as a first-class topic, not boilerplate.
- The bot is also a deliberate learning vehicle: prefer explaining *why* a
  pattern is used. PostgreSQL was chosen over MySQL for career relevance.
- Deployment target: a Proxmox home-lab node (not built yet). Until then the
  bot runs anywhere with Node 18+ and PostgreSQL.

## Hard conventions (do not violate)

1. **All code gets explanatory inline comments throughout.** This is a
   standing rule for every file, every time. Comments explain *why*, in the
   voice of a helpful senior explaining to a sharp colleague.
2. **Currency is "monies"** — same word singular and plural, emoji 🪙,
   yellow embeds (#f1c40f) for economy. Use `formatCurrency()` from config.
3. **Concise responses preferred** in discussion; thorough comments in code.
4. **Test before done.** Every change: `node --check` on touched files, the
   loader smoke test (all commands load), and unit tests for pure logic.
   Probability features get Monte Carlo verification (slots RTP test is the
   model). A feature isn't finished until the suite passes.

## Architecture map

- `src/index.js` — startup (load commands → events → initDatabase → login),
  client.commands + client.components Collections, graceful shutdown
  (SIGTERM/SIGINT → client.destroy → pool.end, 10s failsafe, exit 0).
- `src/handlers/` — auto-loaders. Commands: any `src/commands/<category>/*.js`
  exporting `data` + `execute` self-registers. NEVER put non-command js in
  src/commands. Events likewise from `src/events/`.
- `src/events/interactionCreate.js` — router. Slash → command. Buttons AND
  modals route by customId prefix `"prefix:action:data"`: first to a command
  with handleButton/handleModal, else `client.components` registry (used by
  background tasks, e.g. 'lolbet' registered in ready.js).
- `src/database/tx.js` — THE transaction toolkit: `withTransaction`,
  `acquireLock`, `lockMoney`, `ledgerBalance`, `insertLedger`,
  `LOCK = { MONEY:1, RAFFLE:2, LEDGER:3 }`. All money code builds on this.
- `src/database/db.js` — pool + `initDatabase()`: CREATE TABLE IF NOT EXISTS
  plus **additive migrations** (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
  Schema evolves ONLY this way — no destructive changes, no migration tool.
  Ends by calling `backfillLedgerHashes()` (idempotent).
- `src/database/guildSettings.js` — per-server config (the guild_settings
  table; currently just the LoL announcement channel). Future per-guild
  settings belong here as new columns, not in feature modules.
- `src/tasks/matchPoller.js` — background LoL poller (self-rescheduling
  setTimeout, never setInterval; survives all errors). Detects live games,
  announces with betting buttons, settles/voids, syncs match history every
  5th cycle. Owns the 'lolbet' button+modal handlers.
- `src/lib/` — pure logic, one concern per file, all unit-testable:
  blackjack, slots, wordle, ledgerHash, riot (API client), anthropic
  (Messages API + tool-use loop), chatTools, wordle guess dict in src/data/.
- Achievements (spec: docs/ACHIEVEMENTS_SPEC.md): catalog in
  `src/data/achievements.js` (defs + check functions; contract-tested),
  runner/award/reads in `src/database/achievements.js`, announce embed in
  `src/lib/achievements.js`. checkAchievements is called AFTER a success
  commits — never inside a money transaction — and never throws. Every
  new feature ships with 2–3 achievements in the same PR.

## Money & ledger invariants (sacred)

- **Append-only ledger.** Balances are ALWAYS derived: wallet = SUM(amount);
  banked = −SUM over bank_deposit/bank_withdraw rows; loan owed computed at
  read time. Never store a balance. Never UPDATE/DELETE ledger rows.
- **Every balance-checked write happens inside withTransaction under
  lockMoney** (check-then-write must be atomic). Simple unconditional
  credits go through economy.addTransaction (which now also opens a tx).
- **insertLedger REQUIRES a transaction client, never the pool** — it takes
  the per-guild LEDGER advisory lock and hash-chains the row (row_hash,
  prev_hash; SHA-256 over canonical fields incl. created_at::text; GENESIS
  for first row). `/audit` verifies the chain. If you touch hashing, keep
  canonicalStringify (JSONB reorders keys) and ::text timestamps.
- **Two-user money ops lock in canonical sorted-key order** (see
  robbery.js lockBoth) to prevent deadlock. Raffle takes guild lock before
  money lock. Keep lock ordering consistent everywhere.
- **Welcome bonus**: ensureWelcomeBonus at the top of economy commands —
  idempotent INSERT WHERE NOT EXISTS under the money lock.
- Game wagers use economy.resolveWager (funds check + lock + one signed
  row via a play() callback). New games should use it too.

## Recurring gotchas

- Riot API: TWO routing bases — cluster (americas: account, match) vs
  platform (na1: spectator, league). 404 = normal "not found", not an error.
- Dates/cooldowns use the DATABASE clock (CURRENT_DATE / now()), never JS
  Date, for consistency (daily, wordle, loans).
- Ephemeral replies: `flags: MessageFlags.Ephemeral` (the `ephemeral: true`
  option is deprecated).
- Discord messages cap at 2000 chars; slash replies must come within 3s —
  defer anything that hits an external API.
- pg returns BIGINT as string — cast `::bigint` + Number() or `::text`
  deliberately (hashing uses ::text on purpose).
- User-authored text injected into AI prompts (user_facts) is framed as
  quoted untrusted trivia, never instructions — keep that framing.
- The AI chat's tools resolve usernames via a per-conversation nameMap;
  chat_messages.user_id exists for this.

## Current state (26 commands)

economy: audit (mod-gated), balance, bank, bribe, daily, gift, leaderboard,
loan, pay, profile, raffle, rob, work · games: blackjack, coinflip, slots,
wordle · lol: history, link, lolchannel, lolstats · moderation: warn ·
utility: achievements, fact, ping, poll

Achievements: phases 1–3 shipped (framework, full 72-achievement
catalog, all wiring, hourly self-healing sweep in
src/tasks/achievementSweep.js — SWEEP CONTRACT: every check must verify
from queries alone on a null event or return false; the blank-user test
enforces it). Phase 4 of docs/ACHIEVEMENTS_SPEC.md pending
(lol_match_history stat columns for penta/first-blood/cs badges).

Config knobs all live in `src/config.js`. Env template: `.env.example`
(DISCORD_TOKEN, CLIENT_ID, GUILD_ID, DATABASE_URL, ANTHROPIC_API_KEY,
RIOT_API_KEY, RIOT_CLUSTER, RIOT_PLATFORM). No .env exists until deploy:
`cp .env.example .env`. Slash command registration: `npm run deploy`
(needed whenever command definitions change, incl. permission gates).

## Places to know

- `docs/IDEAS.md` — the feature backlog (checklist; keep it updated).
- `docs/DATABASE.md` — ER diagrams + schema design notes. ANY schema
  change in db.js (table, column, index) updates this file in the same
  commit — it must always mirror initDatabase().
- `docs/shelved/voice-tts/` — complete shelved voice/TTS feature with
  reintegration NOTES.md (likely revival: /say only, no chat integration).
- Update workflow on a live host: git pull → npm install (if deps changed)
  → npm run deploy (if commands changed) → pm2 restart. Data safety comes
  from DB transactions, not the shutdown handler.

## Known deliberate limitations

- LoL announcements assume linked users are members of every configured
  guild (friends-server assumption).
- lolstats covers matches recorded since linking (+10-game backfill), not
  lifetime history — Riot only exposes recent match lists.
- HoYoLAB (Genshin) integration deliberately deferred; owner is open to
  cookie-based unofficial API later — revisit security framing then.
