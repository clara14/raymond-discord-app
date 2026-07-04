// ============================================================
// db.js — PostgreSQL connection and schema setup.
// Exposes a single shared pool, a query() helper, and an
// initDatabase() that creates tables on startup.
// ============================================================

import pg from 'pg';        // node-postgres: the PostgreSQL client for Node
import 'dotenv/config';      // Ensure DATABASE_URL is loaded from .env
import { hashRow, GENESIS } from '../lib/ledgerHash.js'; // used by the startup backfill below

const { Pool } = pg;

// A connection Pool reuses a set of connections instead of opening a new
// one per query — essential for a long-running bot. Create it once and
// share it everywhere; never make a second pool.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Catch errors on idle clients so a dropped connection doesn't crash the bot.
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

/**
 * Thin wrapper around pool.query for convenience.
 * Always pass user data via the params array ($1, $2, ...) — never string
 * concatenation — so PostgreSQL parameterizes it and SQL injection can't happen.
 *   const { rows } = await query('SELECT * FROM warnings WHERE user_id = $1', [userId]);
 */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Creates tables if they don't already exist. Runs once at startup.
 * This is your schema's home base — add new CREATE TABLE statements here
 * as features need them, keeping the whole schema in one readable place.
 */
export async function initDatabase() {
  // Example table: moderation warnings. IF NOT EXISTS makes this safe to
  // run on every boot without error.
  await query(`
    CREATE TABLE IF NOT EXISTS warnings (
      id           SERIAL PRIMARY KEY,               -- auto-incrementing warning id
      guild_id     TEXT        NOT NULL,             -- which server the warning is in
      user_id      TEXT        NOT NULL,             -- who was warned
      moderator_id TEXT        NOT NULL,             -- who issued it
      reason       TEXT        NOT NULL DEFAULT 'No reason provided',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now() -- when it happened
    );
  `);

  // Index the most common lookup — "all warnings for this user in this
  // server" — so that query stays fast as the table grows.
  await query(`
    CREATE INDEX IF NOT EXISTS idx_warnings_guild_user
    ON warnings (guild_id, user_id);
  `);

  // Tamper-evidence (additive migration): every transaction stores its own
  // hash and the previous row's hash, forming a per-guild hash chain.
  // Any edit to history breaks every hash after it — see lib/ledgerHash.js
  // and the /audit command. Pre-existing rows are backfilled at startup.
  await query(`
    ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS row_hash TEXT,
    ADD COLUMN IF NOT EXISTS prev_hash TEXT;
  `);

  // --- Economy: append-only transaction ledger ---
  // This is the single source of truth for currency. We never store a
  // balance directly; a user's balance is SUM(amount) over their rows.
  // amount is signed: positive = credit (earned), negative = debit (spent).
  // BIGSERIAL because a ledger only ever grows — it's never edited or deleted.
  await query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id         BIGSERIAL PRIMARY KEY,
      guild_id   TEXT        NOT NULL,              -- which server
      user_id    TEXT        NOT NULL,              -- whose ledger this row affects
      amount     BIGINT      NOT NULL,              -- signed: + earned, - spent
      type       TEXT        NOT NULL,              -- 'daily','pay_sent','coinflip', etc.
      metadata   JSONB       NOT NULL DEFAULT '{}', -- flexible extra context (e.g. who paid whom)
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // The core query — "balance for this user in this guild" — filters and
  // groups on (guild_id, user_id), so index that pair.
  await query(`
    CREATE INDEX IF NOT EXISTS idx_transactions_guild_user
    ON transactions (guild_id, user_id);
  `);

  // --- Economy: daily claim streaks ---
  // Currency lives in the ledger, but the /daily cooldown and streak count
  // are metadata about claiming, so they get their own small table.
  // last_claim is a DATE so streaks work on calendar days. The composite
  // primary key means exactly one row per user per guild.
  await query(`
    CREATE TABLE IF NOT EXISTS daily_streaks (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      last_claim DATE NOT NULL,
      streak     INT  NOT NULL DEFAULT 1,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  // --- Generic command cooldowns ---
  // Reusable by any command that needs a per-user rate limit. Keyed by
  // command name too, so /work, and any future timed command, share this
  // one table. last_used is when the command was most recently claimed.
  await query(`
    CREATE TABLE IF NOT EXISTS cooldowns (
      guild_id  TEXT        NOT NULL,
      user_id   TEXT        NOT NULL,
      command   TEXT        NOT NULL,
      last_used TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (guild_id, user_id, command)
    );
  `);

  // --- Raffle: rounds and entries ---
  // Each row is one raffle round for a guild. status is 'open' until a mod
  // draws it, then 'drawn' with the winner recorded.
  await query(`
    CREATE TABLE IF NOT EXISTS raffles (
      id         BIGSERIAL PRIMARY KEY,
      guild_id   TEXT        NOT NULL,
      status     TEXT        NOT NULL DEFAULT 'open',  -- 'open' | 'drawn'
      winner_id  TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      drawn_at   TIMESTAMPTZ
    );
  `);

  // Enforce at most ONE open raffle per guild. A partial unique index only
  // applies to rows matching the WHERE — so many 'drawn' rows are fine, but
  // two 'open' rows for the same guild can't coexist. (Same trick you'd use
  // for "one active assignment per truck".)
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_raffle_per_guild
    ON raffles (guild_id) WHERE status = 'open';
  `);

  // Tickets held by each user in a given raffle round. 1 ticket per money
  // contributed; tickets increment as a user tips more into the same round.
  await query(`
    CREATE TABLE IF NOT EXISTS raffle_entries (
      raffle_id BIGINT NOT NULL REFERENCES raffles(id),
      user_id   TEXT   NOT NULL,
      tickets   BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (raffle_id, user_id)
    );
  `);

  // --- Blackjack: in-progress and finished games ---
  // Full game state lives here (deck and both hands as JSONB), so a game
  // survives a bot restart — the buttons on the old message keep working.
  await query(`
    CREATE TABLE IF NOT EXISTS blackjack_games (
      id          BIGSERIAL PRIMARY KEY,
      guild_id    TEXT        NOT NULL,
      user_id     TEXT        NOT NULL,
      bet         BIGINT      NOT NULL,
      deck        JSONB       NOT NULL,  -- remaining cards, drawn from the front
      player_hand JSONB       NOT NULL,
      dealer_hand JSONB       NOT NULL,
      status      TEXT        NOT NULL DEFAULT 'active', -- 'active' | 'finished'
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // One active game per user per guild (partial unique index again).
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_blackjack_per_user
    ON blackjack_games (guild_id, user_id) WHERE status = 'active';
  `);

  // --- Bank loans ---
  // One row per loan. The amount owed is NEVER stored — it's derived at
  // read time from principal, daily_rate_pct, borrowed_at (age), and
  // repaid. Same philosophy as balances: derive, don't duplicate.
  await query(`
    CREATE TABLE IF NOT EXISTS loans (
      id             BIGSERIAL PRIMARY KEY,
      guild_id       TEXT        NOT NULL,
      user_id        TEXT        NOT NULL,
      principal      BIGINT      NOT NULL,
      daily_rate_pct NUMERIC     NOT NULL,  -- snapshot the rate at borrow time
      repaid         BIGINT      NOT NULL DEFAULT 0,
      status         TEXT        NOT NULL DEFAULT 'active', -- 'active' | 'paid'
      borrowed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at        TIMESTAMPTZ
    );
  `);

  // One active loan per user per guild — partial unique index once more.
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_loan_per_user
    ON loans (guild_id, user_id) WHERE status = 'active';
  `);

  // --- Casual chat history ---
  // Recent conversation per channel, so the bot has context when replying
  // to @mentions. role is 'user' or 'assistant' (the bot's own replies).
  await query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id         BIGSERIAL PRIMARY KEY,
      guild_id   TEXT        NOT NULL,
      channel_id TEXT        NOT NULL,
      role       TEXT        NOT NULL,   -- 'user' | 'assistant'
      username   TEXT,                   -- display name for user messages
      content    TEXT        NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // History is always fetched as "most recent N in this channel".
  await query(`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_time
    ON chat_messages (channel_id, created_at DESC);
  `);

  // Additive migration: the Discord user id of the sender, so usernames in
  // conversation can be resolved to real accounts for the chat's tools.
  await query(`
    ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS user_id TEXT;
  `);

  // --- Chat: per-user facts ---
  // Fun background trivia members teach the bot about each other, injected
  // into the chat prompt. added_by enables "you can remove what you added".
  await query(`
    CREATE TABLE IF NOT EXISTS user_facts (
      id         BIGSERIAL PRIMARY KEY,
      guild_id   TEXT        NOT NULL,
      user_id    TEXT        NOT NULL,  -- who the fact is about
      added_by   TEXT        NOT NULL,  -- who taught the bot
      fact       TEXT        NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_user_facts_guild_user
    ON user_facts (guild_id, user_id);
  `);

  // --- League of Legends: linked Riot accounts ---
  // Maps a Discord user to their Riot account. The PUUID is Riot's
  // permanent player identifier — names change, PUUIDs don't. One link
  // per Discord user; re-linking overwrites (upsert in the command).
  await query(`
    CREATE TABLE IF NOT EXISTS linked_accounts (
      user_id   TEXT        PRIMARY KEY,  -- Discord user
      puuid     TEXT        NOT NULL UNIQUE,
      game_name TEXT        NOT NULL,     -- canonical Riot ID name
      tag_line  TEXT        NOT NULL,     -- canonical Riot ID tag
      linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // --- Guild settings ---
  // Small per-server configuration. Currently just the channel where LoL
  // match announcements are posted; future settings slot in as columns.
  await query(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id       TEXT PRIMARY KEY,
      lol_channel_id TEXT
    );
  `);

  // Additive migration: where background-earned achievements (sweep,
  // bet settlements without their own channel) get announced. Falls back
  // to lol_channel_id at read time; if neither is set the announcement
  // stays silent and the award still shows in /achievements.
  await query(`
    ALTER TABLE guild_settings
    ADD COLUMN IF NOT EXISTS announce_channel_id TEXT;
  `);

  // --- LoL: tracked matches ---
  // One row per detected live game per guild. The poller drives status:
  // 'live' (betting/playing) -> 'settled' (result found, bets paid) or
  // 'void' (result never found — remake etc. — bets refunded).
  await query(`
    CREATE TABLE IF NOT EXISTS lol_matches (
      id               BIGSERIAL PRIMARY KEY,
      guild_id         TEXT        NOT NULL,
      user_id          TEXT        NOT NULL,  -- Discord user being tracked
      puuid            TEXT        NOT NULL,
      riot_game_id     BIGINT      NOT NULL,  -- spectator's gameId
      status           TEXT        NOT NULL DEFAULT 'live',
      won              BOOLEAN,               -- filled at settlement
      message_id       TEXT,                  -- the announcement message
      channel_id       TEXT,
      betting_closes_at TIMESTAMPTZ NOT NULL,
      result_attempts  INT         NOT NULL DEFAULT 0,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      settled_at       TIMESTAMPTZ
    );
  `);

  // The poller repeatedly asks "which matches are live?" and dedupes new
  // detections by (guild, riot_game_id).
  await query(`
    CREATE INDEX IF NOT EXISTS idx_lol_matches_status
    ON lol_matches (status);
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lol_matches_guild_game
    ON lol_matches (guild_id, riot_game_id);
  `);

  // Additive migration: linked players sharing the tracked game, as
  // [{ user_id, game_name, puuid, side: 'squad'|'rival' }]. ADD COLUMN IF
  // NOT EXISTS makes this safe on both fresh and existing databases —
  // the standard way to evolve a table without a migration tool.
  await query(`
    ALTER TABLE lol_matches
    ADD COLUMN IF NOT EXISTS participants JSONB NOT NULL DEFAULT '[]';
  `);

  // --- LoL: bets on tracked matches ---
  // One bet per user per match (composite primary key). on_win is the
  // direction; the wager itself is debited from the wallet at placement.
  await query(`
    CREATE TABLE IF NOT EXISTS lol_bets (
      match_row_id BIGINT  NOT NULL REFERENCES lol_matches(id),
      bettor_id    TEXT    NOT NULL,
      amount       BIGINT  NOT NULL,
      on_win       BOOLEAN NOT NULL,
      placed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (match_row_id, bettor_id)
    );
  `);

  // --- LoL: per-player match history ---
  // One row per match per linked player, recorded by the backfill on /link
  // and the poller's periodic sync. The composite PK makes recording
  // idempotent — seeing the same match twice inserts nothing.
  await query(`
    CREATE TABLE IF NOT EXISTS lol_match_history (
      match_id      TEXT    NOT NULL,   -- Riot match id, e.g. 'NA1_1234...'
      puuid         TEXT    NOT NULL,
      user_id       TEXT    NOT NULL,   -- Discord user at time of recording
      champion      TEXT    NOT NULL,
      kills         INT     NOT NULL,
      deaths        INT     NOT NULL,
      assists       INT     NOT NULL,
      win           BOOLEAN NOT NULL,
      queue_id      INT     NOT NULL,   -- 420 ranked solo, 450 ARAM, ...
      duration_sec  INT     NOT NULL,
      ended_at      TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (match_id, puuid)
    );
  `);

  // /history and /lolstats always ask "this player's games, newest first".
  await query(`
    CREATE INDEX IF NOT EXISTS idx_lol_history_puuid_time
    ON lol_match_history (puuid, ended_at DESC);
  `);

  // Additive migration: highlight stats MATCH-V5 already returns that we
  // previously discarded — they unlock the pentakill/first-blood/cs
  // achievements. Rows recorded BEFORE this migration keep the defaults
  // (0/false), so historical pentas are invisible; only matches recorded
  // from now on count. cs = lane + jungle minions combined.
  await query(`
    ALTER TABLE lol_match_history
    ADD COLUMN IF NOT EXISTS penta_kills INT     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS first_blood BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS cs          INT     NOT NULL DEFAULT 0;
  `);

  // --- Wordle: daily puzzle state ---
  // One row per player per day per guild. Guesses accumulate as JSONB
  // [[guess, marks], ...]; the composite PK enforces one puzzle a day.
  await query(`
    CREATE TABLE IF NOT EXISTS wordle_games (
      guild_id  TEXT    NOT NULL,
      user_id   TEXT    NOT NULL,
      day       DATE    NOT NULL,
      guesses   JSONB   NOT NULL DEFAULT '[]',
      solved    BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (guild_id, user_id, day)
    );
  `);

  // Wordle solve streaks — same shape and rules as daily_streaks.
  await query(`
    CREATE TABLE IF NOT EXISTS wordle_streaks (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      last_solve DATE NOT NULL,
      streak     INT  NOT NULL DEFAULT 1,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  // --- Achievements: earned trophies ---
  // The CATALOG (names, tiers, check functions) lives in code —
  // src/data/achievements.js — so adding an achievement never needs a
  // schema change. This table only records who earned what, when.
  // The composite PK makes awarding idempotent: INSERT ... ON CONFLICT
  // DO NOTHING RETURNING tells us "newly earned" (row returned) vs
  // "already had it" (nothing) — the welcome-bonus pattern again.
  await query(`
    CREATE TABLE IF NOT EXISTS user_achievements (
      guild_id       TEXT        NOT NULL,
      user_id        TEXT        NOT NULL,
      achievement_id TEXT        NOT NULL,  -- catalog id, e.g. 'first_daily'
      earned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, user_id, achievement_id)
    );
  `);

  console.log('  ✓ Database initialized');

  // One-time (idempotent) backfill: hash any pre-existing rows so the
  // chain covers the ledger's entire history, not just rows written after
  // this feature shipped. Processes each guild's unhashed rows in id
  // order, chaining from the last already-hashed row (or GENESIS).
  await backfillLedgerHashes();
}

async function backfillLedgerHashes() {
  const { rows: guilds } = await query(
    `SELECT DISTINCT guild_id FROM transactions WHERE row_hash IS NULL`,
  );
  if (guilds.length === 0) return;

  let total = 0;
  for (const g of guilds) {
    // Resume point: the newest already-hashed row in this guild, if any.
    const { rows: tip } = await query(
      `SELECT row_hash FROM transactions
       WHERE guild_id = $1 AND row_hash IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
      [g.guild_id],
    );
    let prevHash = tip[0]?.row_hash ?? GENESIS;

    const { rows } = await query(
      `SELECT id, guild_id, user_id, amount::text AS amount, type, metadata,
              created_at::text AS created_at_text
       FROM transactions
       WHERE guild_id = $1 AND row_hash IS NULL
       ORDER BY id ASC`,
      [g.guild_id],
    );

    for (const row of rows) {
      const rowHash = hashRow({
        id: row.id,
        guildId: row.guild_id,
        userId: row.user_id,
        amount: row.amount,
        type: row.type,
        metadata: row.metadata,
        createdAtText: row.created_at_text,
        prevHash,
      });
      await query(
        `UPDATE transactions SET row_hash = $2, prev_hash = $3 WHERE id = $1`,
        [row.id, rowHash, prevHash],
      );
      prevHash = rowHash;
      total += 1;
    }
  }
  console.log(`  ✓ Ledger hash chain backfilled (${total} row(s))`);
}
