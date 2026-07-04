// ============================================================
// birthdays.test.js — The pure calendar math (validation, leap
// years, the Feb 29 rule, days-until across the year boundary)
// plus the dailyTasks registry contract: one failing job must
// never starve the others.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLeapYear,
  isValidBirthday,
  isCelebrationDay,
  daysUntilBirthday,
  previousDay,
} from '../src/lib/birthdays.js';
import { registerDailyJob, runDailyJobs } from '../src/tasks/dailyTasks.js';

test('isLeapYear implements all three Gregorian clauses', () => {
  assert.equal(isLeapYear(2024), true);   // divisible by 4
  assert.equal(isLeapYear(2023), false);  // not divisible by 4
  assert.equal(isLeapYear(1900), false);  // century, not by 400
  assert.equal(isLeapYear(2000), true);   // divisible by 400
});

test('isValidBirthday accepts real dates and rejects impossible ones', () => {
  assert.equal(isValidBirthday(2, 29), true);   // leaplings are real people
  assert.equal(isValidBirthday(4, 31), false);  // April has 30 days
  assert.equal(isValidBirthday(2, 30), false);
  assert.equal(isValidBirthday(12, 31), true);
  assert.equal(isValidBirthday(1, 1), true);
  assert.equal(isValidBirthday(0, 5), false);   // out-of-range month
  assert.equal(isValidBirthday(13, 5), false);
  assert.equal(isValidBirthday(6, 0), false);   // out-of-range day
  assert.equal(isValidBirthday(1.5, 10), false); // non-integers
});

test('isCelebrationDay: exact date match', () => {
  assert.equal(isCelebrationDay(7, 4, { year: 2026, month: 7, day: 4 }), true);
  assert.equal(isCelebrationDay(7, 4, { year: 2026, month: 7, day: 5 }), false);
});

test('isCelebrationDay: the Feb 29 leapling rule', () => {
  // Leap year: celebrated on Feb 29 itself...
  assert.equal(isCelebrationDay(2, 29, { year: 2028, month: 2, day: 29 }), true);
  // ...and NOT again on Mar 1 of that same leap year.
  assert.equal(isCelebrationDay(2, 29, { year: 2028, month: 3, day: 1 }), false);
  // Non-leap year: deferred to Mar 1.
  assert.equal(isCelebrationDay(2, 29, { year: 2026, month: 3, day: 1 }), true);
  // Non-leaplings on Mar 1 are unaffected by the rule.
  assert.equal(isCelebrationDay(3, 1, { year: 2026, month: 3, day: 1 }), true);
  assert.equal(isCelebrationDay(2, 28, { year: 2026, month: 3, day: 1 }), false);
});

test('daysUntilBirthday: today, tomorrow, and the year wrap', () => {
  const today = { year: 2026, month: 7, day: 4 };
  assert.equal(daysUntilBirthday(7, 4, today), 0);    // today
  assert.equal(daysUntilBirthday(7, 5, today), 1);    // tomorrow
  assert.equal(daysUntilBirthday(7, 3, today), 364);  // just missed it — wraps
  // Dec 31 → Jan 1 fencepost across the boundary.
  assert.equal(daysUntilBirthday(1, 1, { year: 2026, month: 12, day: 31 }), 1);
});

test('daysUntilBirthday: Feb 29 birthdays in both year kinds', () => {
  // From Feb 28 of a LEAP year, the leapling's day is tomorrow.
  assert.equal(daysUntilBirthday(2, 29, { year: 2028, month: 2, day: 28 }), 1);
  // From Feb 28 of a NON-leap year, the deferred Mar 1 party is tomorrow.
  assert.equal(daysUntilBirthday(2, 29, { year: 2026, month: 2, day: 28 }), 1);
  // From Mar 2 of a non-leap year: next celebration is Mar 1 next year
  // (2027 is also non-leap) — 364 days out.
  assert.equal(daysUntilBirthday(2, 29, { year: 2026, month: 3, day: 2 }), 364);
});

test('previousDay handles month and year boundaries', () => {
  assert.deepEqual(previousDay({ year: 2026, month: 1, day: 1 }),
    { year: 2025, month: 12, day: 31 });
  assert.deepEqual(previousDay({ year: 2026, month: 3, day: 1 }),
    { year: 2026, month: 2, day: 28 });
  assert.deepEqual(previousDay({ year: 2028, month: 3, day: 1 }),
    { year: 2028, month: 2, day: 29 }); // leap February
});

test('dailyTasks registry: a throwing job never starves the rest', async () => {
  const ran = [];
  registerDailyJob('explodes', async () => {
    ran.push('explodes');
    throw new Error('synthetic failure');
  });
  registerDailyJob('survives', async () => {
    ran.push('survives');
  });

  // Must not reject, and BOTH jobs must have been attempted in order.
  await runDailyJobs();
  assert.deepEqual(ran, ['explodes', 'survives']);
});
