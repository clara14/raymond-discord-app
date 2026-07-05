# /remindme — Design Spec

> **Status:** Shipped 2026-07-04 — schema + partial index, parseDuration
> (heaviest test table in the suite), /remindme in|list|cancel, the 30s
> scheduler with FOR UPDATE SKIP LOCKED + DM fallback + late apology,
> owner-only allowedMentions, and all three achievements. One deliberate
> divergence: the daily cleanup SCRUBS old delivered messages instead of
> deleting rows, because reminder_veteran counts lifetime deliveries and
> row deletion would silently reset it.

Goal: `/remindme in 2h check the oven` → two hours later the bot pings
you with your message. Small surface, but the engineering is a proper
**durable job queue**: reminders must survive restarts, fire on time-ish,
and degrade gracefully when the bot was asleep at the appointed hour.
Follow all CLAUDE.md conventions.

---

## 1. Schema (additive)

```sql
CREATE TABLE IF NOT EXISTS reminders (
  id           BIGSERIAL PRIMARY KEY,
  guild_id     TEXT NOT NULL,
  channel_id   TEXT NOT NULL,            -- where to deliver
  user_id      TEXT NOT NULL,
  message      TEXT NOT NULL,            -- max 500 chars (option maxLength)
  remind_at    TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ               -- null = pending
);
CREATE INDEX IF NOT EXISTS idx_reminders_due
  ON reminders (remind_at) WHERE delivered_at IS NULL;
```

Partial index: the scheduler's only question is "what's due and
undelivered" — index exactly that. Delivered rows are kept (history is
cheap and /remindme list can show recent past); a weekly cleanup of
delivered rows older than 30 days can ride the dailyTasks registry.

## 2. Duration parsing — the pure-function heart

`lib/duration.js`: `parseDuration(str)` → seconds or null. Accept
compound forms, case-insensitive, optional spaces: `10m`, `1h30m`, `2d`,
`1w`, `45s`, `1d 12h`. Units: s/sec/second(s), m/min, h/hr/hour(s),
d/day(s), w/week(s). Reject: negatives, zero, garbage, bare numbers
without units (ambiguity is a bug factory). Bounds: min 1 minute
(prevents spam-machine usage), max 365 days.
Also `formatDuration` already exists in config — reuse for confirmations.
This function gets the heaviest unit-test table in the PR.

`/remindme at <time>` (absolute times) is deliberately v2 — timezones
make "at 5pm" a lie for someone; durations are timezone-proof.

## 3. Commands

`/remindme` subcommands:
- `in <duration> <message>` — validate, insert, confirm ephemerally with
  the absolute fire time as a Discord timestamp (`<t:...:F>` renders in
  the READER's timezone — sidesteps timezone math entirely).
- `list` — your pending reminders, ids + relative timestamps (ephemeral).
- `cancel <id>` — delete if `user_id = you AND delivered_at IS NULL`.
  Ownership in the WHERE clause, not an app-layer check.

Limits: max 15 pending per user (checked on create). Content note: the
message is echoed back verbatim later — strip @everyone/@here and role
mentions at DELIVERY time via allowedMentions (only the reminder's owner
may be pinged). Never let /remindme become a scheduled mass-ping cannon.

## 4. The scheduler

`src/tasks/reminderScheduler.js` — poller pattern, every 30s:

```sql
SELECT * FROM reminders
WHERE delivered_at IS NULL AND remind_at <= now()
ORDER BY remind_at LIMIT 25;
```

For each: deliver, then `UPDATE ... SET delivered_at = now()`. Mark AFTER
successful send; a crash between send and mark means one duplicate
delivery after restart — the right failure direction (at-least-once
beats silently-never).

Delivery: post in the stored channel — `<@user> ⏰ Reminder: <message>`
(+ "set <t:created:R>"). If the channel fetch/send fails (deleted,
no perms), fall back to DM; if the DM also fails, mark delivered with a
log — undeliverable ≠ retry-forever.

Late delivery (bot was down): if `now() - remind_at > 5 min`, prepend
"(sorry — delivered late, I was offline)". Honesty is a feature.

30s polling = worst-case 30s late; fine for a friend server and immune
to the setTimeout drift/32-bit-ms problems of long timers. Do NOT
setTimeout per reminder.

## 5. Edge cases checklist

- Reminder for a channel the user has since lost access to: delivery
  still happens where it was set (they chose it); DM fallback covers
  deletions.
- User left the server: DM attempt only; else mark + log.
- Bot restarts: nothing to recover — the table IS the state (this is the
  demonstration case for "database as the single source of truth").
- Two schedulers (paranoia): the LIMIT+mark pattern tolerates it at this
  scale; a `FOR UPDATE SKIP LOCKED` on the select is the textbook
  hardening — include it, it's one clause and it's free education.

## 6. Achievements (same PR)

- `first_reminder` — "Object Permanence ⏰" (common): set a reminder.
  Sweep: EXISTS on reminders.
- `reminder_veteran` — "Externalized Memory 🧠" (uncommon): 25 delivered
  reminders. Sweep: COUNT delivered.
- `reminder_year` — "See You Next Year 📅" (rare, secret): set a reminder
  ≥ 180 days out. Event: duration; sweep: EXISTS remind_at - created_at
  ≥ 180 days.

## 7. Testing requirements

parseDuration: the big table (valid compounds, unit aliases, spaces,
rejects, bounds). Scheduler: extract `dueQuery` results → delivery-plan
as a testable step; fixture rows with injected now. allowedMentions
config asserted in the delivery payload builder (pure).
