// ============================================================
// lolHistory.test.js — extractParticipant: pulling one player's
// line out of a MATCH-V5 payload, including the phase-4
// highlight stats (pentakills, first blood, cs) and the
// defensive fallbacks for old/odd payloads.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractParticipant } from '../src/database/lolHistory.js';

// A minimal MATCH-V5 shape with two participants — only the fields
// extractParticipant reads.
function fixtureMatch(overrides = {}) {
  return {
    info: {
      queueId: 450,
      gameDuration: 1_500,
      gameStartTimestamp: 1_700_000_000_000,
      gameEndTimestamp: 1_700_000_000_000 + 1_500_000,
      participants: [
        {
          puuid: 'me',
          championName: 'Jinx',
          kills: 12, deaths: 3, assists: 9, win: true,
          pentaKills: 1,
          firstBloodKill: true,
          totalMinionsKilled: 250,
          neutralMinionsKilled: 60,
          ...overrides,
        },
        { puuid: 'them', championName: 'Thresh', kills: 1, deaths: 8, assists: 20, win: false },
      ],
    },
  };
}

test('extractParticipant pulls the right player with all stats', () => {
  const p = extractParticipant(fixtureMatch(), 'me');
  assert.equal(p.champion, 'Jinx');
  assert.equal(p.kills, 12);
  assert.equal(p.win, true);
  assert.equal(p.queueId, 450);
  assert.equal(p.pentaKills, 1);
  assert.equal(p.firstBlood, true);
  // cs = lane minions + jungle monsters combined.
  assert.equal(p.cs, 310);
  // endedAt comes from gameEndTimestamp when present.
  assert.equal(p.endedAt.getTime(), 1_700_000_000_000 + 1_500_000);
});

test('extractParticipant defaults missing highlight fields safely', () => {
  // Old or unusual payloads may lack the highlight stats entirely —
  // recording must still work, with neutral defaults.
  const p = extractParticipant(
    fixtureMatch({
      pentaKills: undefined,
      firstBloodKill: undefined,
      totalMinionsKilled: undefined,
      neutralMinionsKilled: undefined,
    }),
    'me',
  );
  assert.equal(p.pentaKills, 0);
  assert.equal(p.firstBlood, false);
  assert.equal(p.cs, 0);
});

test('extractParticipant falls back to start + duration for endedAt', () => {
  const match = fixtureMatch();
  delete match.info.gameEndTimestamp;
  const p = extractParticipant(match, 'me');
  assert.equal(p.endedAt.getTime(), 1_700_000_000_000 + 1_500 * 1000);
});

test('extractParticipant returns null when the player is absent', () => {
  assert.equal(extractParticipant(fixtureMatch(), 'someone-else'), null);
});
