# Economy Analytics + Wealth Time Machine — Design Spec

> **Status:** Phases 1–2 shipped 2026-07-04 — analytics.js, all five
> commands (/economy /wealth /records /mystats /compare) on the v1
> sparkline tier, gini + stats helpers + classifyType contract test
> (with a fifth 'gamble' class: sign decides mint vs burn), and all
> three achievements. Phase 3 (@napi-rs/canvas image charts — a new
> native dependency, ask first) and phase 4 (AI chat tool, mobility,
> correlations) pending. Notes: streak records are "on record" (current
> tables), not all-time (broken streaks leave no trace); SQL is
> hand-verified — no test database exists, the pure math is what's
> unit-tested; risk profile (bet as % of balance-at-bet) deferred with
> phase 4's window-function work.

Goal: turn the append-only ledger into insight. Every monies movement
since day one is already recorded and hash-chained; this feature is
almost pure SQL — window functions, FILTER aggregates, percentiles,
even correlation — surfaced through commands, charts, and the AI chat.
The spec deliberately lists MORE uses than v1 should ship; it's a menu.
Follow all CLAUDE.md conventions.

---

## 1. Architecture

- `src/database/analytics.js` — every query lives here, each as a small
  documented function returning plain data. No Discord code. This module
  is the product; commands are thin renderers over it.
- **No new tables.** Everything derives live from `transactions` (+ the
  streak/history tables for cross-domain fun). At friend scale every
  query below is milliseconds. If any ever isn't, the sanctioned
  optimization is a nightly `economy_snapshots` cache row (rebuildable =
  still derive-don't-store in spirit) — but don't build it until a query
  is actually slow.
- One taxonomy helper: `classifyType(type)` → 'faucet' | 'sink' |
  'transfer' | 'internal' — a pure map over every ledger type in the
  codebase (daily/work/welcome/wordle/birthday = faucet; gift fee burn,
  bribes, failed gambles = sink; pay/gift/rob/raffle = transfer;
  bank_deposit/withdraw = internal). Contract test: every type string
  the codebase writes is classified — grep-proof against new features
  forgetting to register (mirror the achievements catalog test).

## 2. Charts: the rendering decision (be honest about tiers)

- **v1: zero dependencies.** Unicode sparklines (▁▂▃▄▅▆▇█) for trends
  inside embeds + numbers. `lib/sparkline.js`: pure `sparkline(values,
  width)` — bucket, normalize, map to blocks. Shockingly good for
  balance histories.
- **v2: real images.** `@napi-rs/canvas` (prebuilt binaries, no
  node-gyp pain) rendering line/area charts to PNG buffers attached to
  embeds. Build `lib/charts.js` with exactly two chart functions (time
  series, bar) — resist a charting framework. This tier also unlocks
  profile cards later.
- Never: external chart-URL services (someone else's uptime in your
  embeds).

## 3. The query catalog — every use I can imagine

### 3a. `/economy` — the macro dashboard (mod-gated like /audit)
- **Money supply**: total, split wallet vs banked vs raffle jar.
- **Faucets vs sinks** (7/30-day windows): minted vs burned by type,
  net inflation rate. THE health metric — if faucets outrun sinks 5:1,
  monies devalue and you tune config.
- **Velocity**: transfer volume / supply per window — is money moving
  or hoarding?
- **Gini coefficient** of total worth: `lib/gini.js`, pure, tested
  against known distributions (all-equal → 0; one-has-all → ~1).
  The headline number when friends cry "rigged economy!"
- **House report per game**: observed RTP vs designed (slots ~88.5%,
  coinflip ~100%, blackjack ~99%) from SUM(net)/SUM(wagered) FILTER by
  type. Statistical drift vs sample size = a great conversation.
- **Concentration**: top-3 share of total worth; wallet median vs mean
  (percentile_cont(0.5)).

### 3b. `/wealth [user]` — the time machine
- Balance-over-time via the window function this feature exists to
  teach: `SUM(amount) OVER (ORDER BY id)` per user → daily closes →
  sparkline (v1) / area chart (v2).
- Annotate: all-time high (and when), current percentile in the server
  ("richer than 78% of members"), 7/30-day deltas.
- `since` option: window to a date.

### 3c. `/records` — the hall of records (public, pure fun)
Single-row superlatives, all one query each: biggest single win & loss
(any game, from metadata), largest /pay and /gift ever, biggest rob and
biggest damages payout, largest raffle pot in history, longest daily and
wordle streaks ever (streak tables), fastest wordle solve distribution,
most-garnished debtor, single busiest day by transaction count.

### 3d. `/mystats` (or extend /profile) — personal finance report
- Income statement: earnings by source (daily/work/wins/gifts) vs
  spending by category, as percentages.
- **Gambling ROI per game**: net / wagered for slots, blackjack,
  coinflip, LoL bets, raffle — separately. "You're up on blackjack and
  down 1,200 on slots" is self-knowledge nobody asked for.
- Risk profile: average bet as % of balance-at-time-of-bet (window
  function: running balance joined to each wager row).
- Lifetime interest paid on loans; total burned in fees/bribes.
- Rob ledger: stolen vs lost vs damages collected.
- Largest single day (net) ever.

### 3e. `/compare @a @b` — head-to-head
Net worth histories on one chart, plus a stat table: streaks, gambling
ROI, wordle averages, LoL winrate. Rivalry fuel.

### 3f. Feeds into everything already built
- **AI chat tool**: add `get_economy_analytics` (supply, gini, top
  movers, house report) → the bot roasts with macroeconomics ("gini
  hit 0.71 — this server is a banana republic").
- **Morning Monies Times** (when built): yesterday's mint/burn, biggest
  mover, records broken — all from analytics.js.
- **Achievements**: sweep checks can consume analytics helpers
  (worth percentile, ROI thresholds).
- **Seasons** (when built): the season-end almanac IS 3a+3c archived.

### 3g. The genuinely fancy (v3, because PostgreSQL can)
- **Wealth mobility**: rank now vs rank 30 days ago (two windowed
  passes) → biggest climber / faller.
- **Correlations with corr()**: wordle solve rate vs net worth; daily
  streak length vs gambling ROI ("disciplined people gamble better —
  discuss"). Small-n caveat printed with every r value.
- Hoarding half-life: average days between earn and spend.
- Inequality trend: gini computed per week over history — one chart
  answering "is this getting worse?"
- Sentinel forensics: raffle jar flow over time (should always net ~0;
  its chart is an audit visualization).

## 4. Commands summary

/economy (mod) · /wealth [user] · /records · /mystats · /compare @a @b.
All defer replies (aggregate queries + chart render). /wealth, /mystats
ephemeral by default with a `public` boolean option.

## 5. Achievements (same PR)

- `records_holder` — "Record Breaker 📜" (rare): hold any /records
  superlative at check time. Sweep-capable (recompute + compare).
- `gini_watcher` — "Concerned Economist 🧐" (common, secret): run
  /economy or /mystats. Moment-only.
- `all_time_high` — "Peak Performance 📈" (uncommon): new personal ATH
  ≥ 5,000. Event on balance-changing actions; sweep via windowed max.

## 6. Testing requirements

Pure and heavy: gini (known distributions), sparkline (bucketing,
flat-line, single point), classifyType (contract: exhaustive over all
ledger types — THE regression net), percentile/median helpers against
hand-computed fixtures. SQL windows: test via small fixture ledgers in
integration-style tests if a test DB exists; otherwise assert
query-builders and hand-verify — and note which is which honestly in
the PR.

## 7. Phases

1. analytics.js core + /economy + /wealth with sparklines + gini +
   classifyType contract test.
2. /records + /mystats + /compare.
3. @napi-rs/canvas charts; swap sparklines where images earn it.
4. AI chat tool + fancy stats (mobility, correlations, trends).
