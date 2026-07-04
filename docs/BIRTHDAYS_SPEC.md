# Birthdays — Design Spec

> **Status:** Shipped 2026-07-04 — schema, /birthday (set/remove/next/
> list), /announcechannel, the dailyTasks registry primitive with the
> birthday job as first tenant, all three achievements, and pure-lib
> tests (validation, leap years, Feb 29 rule, year wrap, registry
> isolation). BIRTHDAY.roleId defaults to null (role feature off).

Goal: members register their birthday; the bot celebrates it — an
announcement, a monies gift, and optionally a birthday role for the day.
Small feature, but it introduces one new primitive the backlog reuses
everywhere: the **daily scheduled task**. Follow all CLAUDE.md
conventions (comments, monies, test-before-done, ships with achievements).

---

## 1. Schema (additive, in initDatabase)

```sql
CREATE TABLE IF NOT EXISTS birthdays (
  guild_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  month           INT  NOT NULL CHECK (month BETWEEN 1 AND 12),
  day             INT  NOT NULL CHECK (day BETWEEN 1 AND 31),
  birth_year      INT,                    -- OPTIONAL; null = age never shown
  last_celebrated INT,                    -- year of last announcement (dedupe)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id)
);
```

Notes:
- `last_celebrated` is the idempotency key: the daily task celebrates only
  when `(today is their birthday) AND (last_celebrated IS DISTINCT FROM
  current year)`, then sets it. Restart-safe, double-run-safe.
- Validate real dates in the command layer (reject Apr 31, Feb 30; accept
  Feb 29 — see edge cases). A pure `isValidBirthday(month, day)` helper in
  lib, unit-tested.

Also needed: guild_settings gains a proper setter for
`announce_channel_id` (the column already exists from achievements; no
command sets it yet). Add `/announcechannel set|off|status` (ManageGuild,
mirror lolchannel) in this PR — birthdays announce there, falling back to
lol_channel_id, else silent.

## 2. Commands

`/birthday` with subcommands:
- `set <month> <day> [year]` — upsert own birthday. Month as a choice
  option (1–12 with names), day as integer. Year optional and clearly
  described as "only if you want your age shown."
- `remove` — delete own row (privacy is one command away).
- `next` — the next 3 upcoming birthdays in the server, with relative
  Discord timestamps. Sorting across the year boundary is the classic
  fencepost: compute days-until with modular arithmetic — pure function
  `daysUntilBirthday(month, day, today)`, unit-tested incl. year wrap.
- `list` — all registered birthdays ordered by upcoming (ephemeral).

No `set` for other users — birthdays are self-declared only (mods can ask
people to remove; the bot never stores third-party personal data).

## 3. The daily task — the new primitive

`src/tasks/dailyTasks.js`: a self-rescheduling task (poller pattern) that
computes the ms until the next local midnight **by the database clock**
(`SELECT (date_trunc('day', now()) + interval '1 day') - now()`), sleeps
until then, runs its jobs, reschedules. Also runs once ~60s after boot to
catch a restart that slept through midnight (last_celebrated makes the
re-run harmless).

Design it as a tiny registry: `registerDailyJob(name, fn)` — birthdays is
the first job; hall-of-shame, Morning Monies Times, and season rollovers
will register alongside later. Jobs run sequentially; each wrapped in
try/catch so one failure never starves the rest.

Birthday job per guild:
1. `SELECT` today's birthdays not yet celebrated this year (handle Feb 29:
   celebrate on Mar 1 in non-leap years — `WHERE (month, day) = (m, d) OR
   (month=2 AND day=29 AND m=3 AND d=1 AND NOT is_leap_year)`; put leap
   logic in the pure helper, tested).
2. For each: credit the gift via `economy.addTransaction(guild, user,
   BIRTHDAY.gift, 'birthday', { year })` — a normal hash-chained ledger row.
3. Announce in the announce channel: "🎂 Happy birthday <@user>!" + "+500
   monies" (+ "turning N today!" ONLY when birth_year is set).
4. Optional role: if `BIRTHDAY.roleId` configured, add role now; the NEXT
   day's run removes it from yesterday's celebrants (query
   last_celebrated = this year AND birthday was yesterday). Role
   add/remove failures are logged, never fatal (missing perms shouldn't
   break the gift).
5. Set last_celebrated = current year.

Config: `BIRTHDAY = { gift: 500, roleId: null }`.

## 4. Edge cases checklist

- Feb 29 (see above; test both leap and non-leap years).
- User left the server: announcement mention still renders as raw ID —
  check membership first (guild.members.fetch, catch) and skip departed
  users WITHOUT setting last_celebrated (they get celebrated if they
  return... same year only; acceptable).
- Two birthdays same day: one announcement listing all celebrants beats
  N messages.
- Timezone honesty: "birthday" means the DATABASE's calendar date. State
  it in /birthday set's reply ("celebrated at midnight server time").
  Per-user timezones are deliberately out of scope v1.

## 5. Achievements (ship in same PR)

- `birthday_set` — "Cake Registered 🎂" (common): register a birthday.
  Trigger: birthday_set event. Sweep: EXISTS on birthdays row.
- `birthday_celebrated` — "It's My Day 🎉" (uncommon): receive a birthday
  gift. Sweep: countType('birthday') >= 1.
- `birthday_generous` — "Birthday Buddy 🎁" (rare, secret): /pay or /gift
  someone ON their birthday. Event check in pay/gift wiring: look up
  recipient's birthday row; moment-only (sweep returns false on null).

## 6. Testing requirements

Pure: isValidBirthday (incl. Feb 29 accept, Apr 31 reject),
daysUntilBirthday (today, tomorrow, year wrap, Feb 29 in both year
kinds), leap-year helper. Task: extract "who gets celebrated today" as a
testable query-builder or run it against fixture rows with injected
"today". Contract: dailyTasks registry runs all jobs even when the first
throws.
