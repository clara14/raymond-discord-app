# Database Model

The relational model behind the bot, as ER diagrams with design notes.

> **Maintenance rule:** this document mirrors `initDatabase()` in
> `src/database/db.js`. Any schema change there — new table, new column,
> new index — updates this file in the same commit. The diagrams are
> Mermaid, so GitHub renders them and changes show up in diffs.

## Design principles

1. **Discord is the authority for people and places.** There is no `users`
   or `guilds` table — `guild_id` / `user_id` columns hold Discord
   snowflake IDs (as TEXT, since they overflow 32-bit ints and we never do
   math on them). That's why most "relationships" below are *logical*
   (dotted), not foreign keys: the parent rows live in Discord, not here.
2. **Derive, don't store.** Balances, banked totals, and loan debt are
   computed at read time from source-of-truth rows. Only two real FKs
   exist (`raffle_entries → raffles`, `lol_bets → lol_matches`) because
   those parents genuinely live in our schema.
3. **The ledger is append-only and hash-chained.** `transactions` is the
   heart of the model: never UPDATE or DELETE a row (except the one-time
   `row_hash` stamp at insert); every row commits to the previous one via
   SHA-256, so `/audit` can prove history unedited.
4. **Partial unique indexes enforce "one active X".** One open raffle per
   guild, one active blackjack game per player, one active loan per
   borrower — enforced by the database, not by application discipline.
5. **Composite primary keys make writes idempotent.** Recording the same
   LoL match twice, double-betting a match, replaying a wordle day, or
   re-earning an achievement inserts nothing instead of corrupting state.
6. **The database clock is the only clock.** Cooldowns, streaks, and the
   wordle day all use `now()` / `CURRENT_DATE` so behavior doesn't depend
   on where the bot process runs.

## Economy core

`transactions` is the hub of the whole model. Every monies movement — pay,
gamble, rob, raffle, loan, bank — is a signed row here; `type` + `metadata`
say why. The raffle pot itself is a ledger "user" (the `__raffle_jar__`
sentinel), so even the pot is auditable.

```mermaid
erDiagram
    transactions {
        bigserial id PK
        text guild_id "Discord snowflake"
        text user_id "Discord snowflake or sentinel"
        bigint amount "signed: + credit, - debit"
        text type "daily, pay_sent, coinflip, bank_deposit, ..."
        jsonb metadata "flexible context (who, what, which round)"
        timestamptz created_at
        text row_hash "SHA-256 of this row (hash chain)"
        text prev_hash "previous row's hash, or GENESIS"
    }
    daily_streaks {
        text guild_id PK
        text user_id PK
        date last_claim "DB clock; 0=today 1=yesterday keeps streak"
        int streak
    }
    cooldowns {
        text guild_id PK
        text user_id PK
        text command PK "work, rob, robbed, chat, ..."
        timestamptz last_used
    }
    loans {
        bigserial id PK
        text guild_id
        text user_id
        bigint principal
        numeric daily_rate_pct "rate snapshot at borrow time"
        bigint repaid
        text status "active | paid (one active per user: partial unique)"
        timestamptz borrowed_at "owed = f(principal, rate, age) - repaid"
        timestamptz paid_at
    }
    raffles {
        bigserial id PK
        text guild_id "one open per guild: partial unique"
        text status "open | drawn"
        text winner_id
        timestamptz created_at
        timestamptz drawn_at
    }
    raffle_entries {
        bigint raffle_id PK, FK
        text user_id PK
        bigint tickets "1 ticket per money contributed"
    }

    raffles ||--o{ raffle_entries : "has"
    loans ||..o{ transactions : "metadata.loan_id (disburse/repay/garnish rows)"
    raffles ||..o{ transactions : "metadata.raffle_id (entry/pot/payout rows)"
```

**Derived values (never stored):** wallet = `SUM(amount)`; banked =
`-SUM(amount) FILTER (type IN bank_deposit, bank_withdraw)`; loan owed =
`ceil(principal × (1 + rate% × age_days)) - repaid`; lifetime earned =
`SUM` over positive `daily`/`work` rows (feeds the credit limit).

## Games

Game *money* lives in `transactions` (types `blackjack_bet`, `slots`,
`coinflip`, `wordle`, ...). These tables hold game *state*.

```mermaid
erDiagram
    blackjack_games {
        bigserial id PK
        text guild_id
        text user_id "one active per user: partial unique"
        bigint bet "debited up front; wins credited at settle"
        jsonb deck "remaining cards - survives restarts"
        jsonb player_hand
        jsonb dealer_hand
        text status "active | finished (stale actives forfeited)"
        timestamptz created_at
        timestamptz updated_at
    }
    wordle_games {
        text guild_id PK
        text user_id PK
        date day PK "DB clock; word derived from date hash"
        jsonb guesses "[[guess, marks], ...]"
        boolean solved
    }
    wordle_streaks {
        text guild_id PK
        text user_id PK
        date last_solve
        int streak
    }

    wordle_games ||..|| wordle_streaks : "same (guild,user) on solve"
```

## League of Legends

`linked_accounts` is the root: it maps a Discord user to a Riot PUUID
(permanent even through name changes). The poller fans out from there.

```mermaid
erDiagram
    linked_accounts {
        text user_id PK "Discord snowflake, one link per user"
        text puuid UK "Riot permanent id"
        text game_name "canonical Riot ID name"
        text tag_line
        timestamptz linked_at
    }
    guild_settings {
        text guild_id PK
        text lol_channel_id "null = announcements off"
    }
    lol_matches {
        bigserial id PK
        text guild_id "unique with riot_game_id: no double-announce"
        text user_id "anchor player whose spectator call found it"
        text puuid
        bigint riot_game_id
        text status "live | settled | void"
        boolean won "filled at settlement"
        text message_id "announcement message, edited at settle"
        text channel_id
        timestamptz betting_closes_at
        int result_attempts "void + refund after max retries"
        jsonb participants "linked players: [{user_id, side: squad|rival}]"
        timestamptz created_at
        timestamptz settled_at
    }
    lol_bets {
        bigint match_row_id PK, FK
        text bettor_id PK "composite PK = one bet per user per match"
        bigint amount "debited at placement; correct bets paid 2x"
        boolean on_win
        timestamptz placed_at
    }
    lol_match_history {
        text match_id PK "Riot id, e.g. NA1_1234..."
        text puuid PK "composite PK = idempotent recording"
        text user_id
        text champion
        int kills
        int deaths
        int assists
        boolean win
        int queue_id "420 solo, 450 ARAM, ..."
        int duration_sec
        timestamptz ended_at
    }

    lol_matches ||--o{ lol_bets : "takes"
    linked_accounts ||..o{ lol_matches : "puuid (anchor)"
    linked_accounts ||..o{ lol_match_history : "puuid"
    guild_settings ||..o{ lol_matches : "announce channel"
    lol_matches ||..o{ transactions : "metadata.match (bet/win/refund rows)"
```

## Chat & social

```mermaid
erDiagram
    chat_messages {
        bigserial id PK
        text guild_id
        text channel_id "history fetched per channel, newest N"
        text role "user | assistant"
        text username "display name for user rows"
        text content
        text user_id "added by migration; resolves names for chat tools"
        timestamptz created_at
    }
    user_facts {
        bigserial id PK
        text guild_id
        text user_id "who the fact is about"
        text added_by "who taught it; enables remove-your-own"
        text fact "max 200 chars, max 10 per user"
        timestamptz created_at
    }
    warnings {
        serial id PK
        text guild_id
        text user_id
        text moderator_id
        text reason
        timestamptz created_at
    }
```

## Achievements

The catalog (names, tiers, check functions) lives in code —
`src/data/achievements.js` — so new achievements never need schema
changes. This table only records who earned what. Awarding uses
`INSERT ... ON CONFLICT DO NOTHING RETURNING` (the welcome-bonus
pattern): a returned row means "newly earned, announce it". Checks run
*after* money transactions commit, never inside them.

```mermaid
erDiagram
    user_achievements {
        text guild_id PK
        text user_id PK
        text achievement_id PK "catalog id from src/data/achievements.js"
        timestamptz earned_at
    }
```

## Indexes at a glance

| Index | Table | Purpose |
| --- | --- | --- |
| `(guild_id, user_id)` | transactions, warnings, user_facts | the dominant lookup everywhere |
| `(channel_id, created_at DESC)` | chat_messages | "newest N in this channel" |
| `(puuid, ended_at DESC)` | lol_match_history | "this player's games, newest first" |
| `(status)` | lol_matches | the poller's live-match watchlist |
| **unique** `(guild_id, riot_game_id)` | lol_matches | idempotent match detection |
| **partial unique** `(guild_id) WHERE status='open'` | raffles | one open raffle per guild |
| **partial unique** `(guild_id, user_id) WHERE status='active'` | blackjack_games, loans | one active game/loan per user |

## Anticipated extensions (from docs/IDEAS.md — not built yet)

Sketches only, to think ahead; update or delete as features land.

- **Shop / buyable roles** — `shop_items (guild_id, role_id, price)` +
  purchases as ledger rows (`type='shop_purchase'`, `metadata.role_id`).
  No owned-items table needed if Discord roles are the source of truth.
- **Heist events** — `heists (id, guild_id, status, buyin, opens_at,
  resolves_at)` + `heist_entries (heist_id FK, user_id)`; the pot follows
  the raffle-jar sentinel pattern.
- **Stock market** — the deep one: `stocks (symbol, guild_id)` +
  append-only `stock_prices (symbol, tick_at, price)` + holdings derived
  from signed `stock_trades` rows — same derive-don't-store philosophy as
  the ledger.
- **Genshin wish tracker** — the founding idea's "deep schema problem":
  `wishes (user_id, banner_id, item, rarity, pulled_at)` with per-banner
  pity derived at read time by counting rows since the last 5★.
- **Birthdays / reminders / quotes** — small `(guild_id, user_id, ...)`
  tables; birthdays likely just a column-less DATE table, quotes an
  append-only message archive.
