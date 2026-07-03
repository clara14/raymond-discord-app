// ============================================================
// riot.test.js — Unit tests for parseRiotId from src/lib/riot.js.
//
// Only the pure parser is covered — every other export hits the
// live Riot API. The parser is the /link command's front door,
// so the negative cases matter as much as the happy path: a bad
// parse should come back null (→ friendly error), never a
// half-parsed ID that sends garbage to the API.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRiotId } from '../src/lib/riot.js';

test('parseRiotId: the standard "Name#TAG" form', () => {
  assert.deepEqual(parseRiotId('Faker#KR1'), { gameName: 'Faker', tagLine: 'KR1' });
});

test('parseRiotId: game names may contain spaces', () => {
  // Riot allows spaces in the display name; only the tag is restricted.
  assert.deepEqual(parseRiotId('Hide on bush#KR1'), {
    gameName: 'Hide on bush',
    tagLine: 'KR1',
  });
});

test('parseRiotId: whitespace around and inside is trimmed', () => {
  // Users paste with stray spaces constantly; the parser cleans up both
  // the outer string and each side of the '#'.
  assert.deepEqual(parseRiotId('  Faker # KR1  '), {
    gameName: 'Faker',
    tagLine: 'KR1',
  });
});

test('parseRiotId: splits on the LAST # so names containing # still parse', () => {
  // lastIndexOf('#') means everything before the final hash is the name.
  // Odd, but deliberate: the tag is always the final segment.
  assert.deepEqual(parseRiotId('a#b#c'), { gameName: 'a#b', tagLine: 'c' });
});

test('parseRiotId: tag length is capped at 5', () => {
  assert.deepEqual(parseRiotId('Name#12345'), { gameName: 'Name', tagLine: '12345' });
  // Six characters is over Riot's limit → reject rather than send a
  // guaranteed-404 to the API.
  assert.equal(parseRiotId('Name#123456'), null);
});

test('parseRiotId: rejects malformed inputs with null', () => {
  const bad = [
    'NoHashHere',   // no separator at all
    '#NA1',         // empty name (hash at position 0)
    'Name#',        // empty tag (hash at the end)
    '#',            // both empty
    '',             // empty string
    '   ',          // whitespace only
    'Name#     ',   // outer trim eats the spaces → trailing hash → empty tag
  ];
  for (const input of bad) {
    assert.equal(parseRiotId(input), null, JSON.stringify(input));
  }
});

test('parseRiotId: null/undefined input is handled, not thrown', () => {
  // The ?? '' guard: a missing option from Discord should degrade to the
  // same "invalid format" path as any other bad string.
  assert.equal(parseRiotId(null), null);
  assert.equal(parseRiotId(undefined), null);
});
