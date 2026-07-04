// ============================================================
// dailyTasks.js (task) — The daily scheduled task primitive.
// A self-rescheduling loop (poller pattern) that sleeps until
// the next midnight BY THE DATABASE CLOCK, then runs every
// registered job. Birthdays are the first tenant; hall-of-shame
// and other daily rituals from the backlog will register
// alongside without touching this file.
//
// Also runs once shortly after boot: a restart that slept
// through midnight still gets its daily pass, and each job's
// own idempotency (e.g. birthdays' last_celebrated) makes the
// extra run harmless.
// ============================================================

import { query } from '../database/db.js';

// The registry: name → async job function. Insertion order = run order.
const jobs = new Map();

/**
 * Registers a daily job. Call before startDailyTasks (in practice: from
 * ready.js). Jobs run sequentially, each wrapped in try/catch — one
 * failure never starves the rest.
 */
export function registerDailyJob(name, fn) {
  jobs.set(name, fn);
}

/**
 * Runs every registered job, sequentially, isolating failures.
 * Exported so the contract test can prove one throwing job doesn't
 * stop the others — and so future admin tooling could force a pass.
 */
export async function runDailyJobs() {
  for (const [name, fn] of jobs) {
    try {
      await fn();
    } catch (err) {
      console.error(`Daily job "${name}" failed:`, err);
    }
  }
}

/** Seconds until the next midnight, by the database clock. */
async function secondsUntilDbMidnight() {
  const { rows } = await query(
    `SELECT EXTRACT(EPOCH FROM
       (date_trunc('day', now()) + interval '1 day') - now()
     )::float8 AS secs`,
  );
  return Number(rows[0].secs);
}

/** Starts the loop. Called once from the ready event. */
export function startDailyTasks() {
  console.log(`  ✓ Daily tasks running (${jobs.size} job(s), at DB midnight)`);
  // Boot catch-up pass ~60s in; scheduleNext() takes over from there.
  setTimeout(async () => {
    await runDailyJobs();
    scheduleNext();
  }, 60_000);
}

function scheduleNext() {
  // Compute the sleep fresh each cycle so drift can't accumulate. +2s of
  // margin puts the wake-up safely on the far side of midnight — jobs
  // asking the database "what day is it?" must get the NEW day.
  secondsUntilDbMidnight()
    .then((secs) => {
      setTimeout(async () => {
        await runDailyJobs(); // never throws; failures are per-job
        scheduleNext();
      }, (secs + 2) * 1000);
    })
    .catch((err) => {
      // Couldn't even ask the DB for the time (outage?) — retry the
      // scheduling itself in an hour rather than dying silently.
      console.error('Daily task scheduling error (retrying in 1h):', err);
      setTimeout(scheduleNext, 3_600_000);
    });
}
