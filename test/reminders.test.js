// ============================================================
// reminders.test.js — parseDuration's big table (the spec's
// "heaviest unit-test table in the PR") and the pure delivery
// payload builder: the owner-only allowedMentions property and
// the late-delivery apology.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/lib/duration.js';
import { buildReminderPayload } from '../src/lib/reminders.js';

// [input, expected seconds or null]
const DURATION_TABLE = [
  // Single units, every alias family.
  ['45s', 45], ['45sec', 45], ['45secs', 45], ['1second', 1], ['10 seconds', 10],
  ['10m', 600], ['10min', 600], ['10mins', 600], ['1minute', 60], ['5 minutes', 300],
  ['2h', 7_200], ['2hr', 7_200], ['2hrs', 7_200], ['1hour', 3_600], ['3 hours', 10_800],
  ['2d', 172_800], ['1day', 86_400], ['7 days', 604_800],
  ['1w', 604_800], ['1week', 604_800], ['2 weeks', 1_209_600],

  // Compounds, with and without spaces, mixed case.
  ['1h30m', 5_400],
  ['1h 30m', 5_400],
  ['1H30M', 5_400],
  ['1d 12h', 129_600],
  ['1w2d3h4m5s', 604_800 + 172_800 + 10_800 + 240 + 5],
  ['  10m  ', 600],           // outer whitespace tolerated

  // Rejections: ambiguity and garbage are null, never a guess.
  ['90', null],               // bare number — 90 what?
  ['', null],
  ['   ', null],
  ['soon', null],
  ['h', null],                // unit without a number
  ['10', null],
  ['-5m', null],              // negative (the sign is unconsumed garbage)
  ['0m', null],               // zero isn't a wait
  ['0h0m', null],
  ['10 fortnights', null],    // unknown unit
  ['10mm', null],             // not a real alias
  ['1h30', null],             // trailing bare number invalidates the lot
  ['ten minutes', null],      // words aren't digits
  ['1.5h', null],             // fractions are ambiguous with the '.' unconsumed
];

test('parseDuration: the big table', () => {
  for (const [input, expected] of DURATION_TABLE) {
    assert.equal(
      parseDuration(input), expected,
      `parseDuration(${JSON.stringify(input)}) should be ${expected}`,
    );
  }
});

test('parseDuration rejects non-strings outright', () => {
  assert.equal(parseDuration(null), null);
  assert.equal(parseDuration(undefined), null);
  assert.equal(parseDuration(600), null);
});

// --- The delivery payload builder ---

const REMINDER = {
  userId: '123456',
  message: 'check the oven @everyone @here',
  createdEpoch: 1_760_000_000,
  remindEpoch: 1_760_003_600,
};

test('payload pings ONLY the owner regardless of message content', () => {
  const p = buildReminderPayload(REMINDER, REMINDER.remindEpoch * 1000);
  // The stored message contains @everyone/@here — allowedMentions must
  // pin pings to the owner alone, making mass-ping smuggling impossible.
  assert.deepEqual(p.allowedMentions, { users: ['123456'] });
  assert.ok(p.content.includes('<@123456>'));
  assert.ok(p.content.includes('check the oven'), 'message text is echoed verbatim');
  assert.ok(p.content.includes(`<t:${REMINDER.createdEpoch}:R>`), 'shows when it was set');
});

test('payload apologizes when delivered late, and only then', () => {
  const onTime = buildReminderPayload(REMINDER, (REMINDER.remindEpoch + 60) * 1000);
  assert.ok(!onTime.content.includes('delivered late'), '60s late is within tolerance');

  const late = buildReminderPayload(REMINDER, (REMINDER.remindEpoch + 600) * 1000);
  assert.ok(late.content.includes('delivered late'), '10 min late owes an apology');
  assert.ok(late.content.startsWith('*(sorry'), 'apology leads the message');
});

test('payload late threshold is configurable', () => {
  const p = buildReminderPayload(REMINDER, (REMINDER.remindEpoch + 120) * 1000, 60);
  assert.ok(p.content.includes('delivered late'), '2 min late with a 1-min threshold');
});
