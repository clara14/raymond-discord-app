// ============================================================
// matchPoller.test.js — Unit tests for partitionLinkedPlayers
// from src/tasks/matchPoller.js.
//
// This is the poller's "who's in this game and whose side are
// they on" brain: it decides which friends share an announcement,
// and — crucially for betting — which team the bets ride on.
// Everything else in the poller talks to Riot/Discord/Postgres
// and is exercised in production, not here. (Importing the module
// is side-effect free: the poller only starts when startMatchPoller
// is called from the ready event.)
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionLinkedPlayers } from '../src/tasks/matchPoller.js';

// Factories shaped like the real inputs: Riot spectator participants
// carry puuid + teamId (100 = blue, 200 = red); links come from our
// linked_accounts table.
const participant = (puuid, teamId) => ({ puuid, teamId });
const link = (puuid, userId, gameName) => ({
  puuid,
  user_id: userId,
  game_name: gameName,
});

test('partitionLinkedPlayers: solo linked player → a squad of one, no rivals', () => {
  const participants = [
    participant('anchor-puuid', 100),
    participant('random-1', 100),
    participant('random-2', 200),
  ];
  const links = [link('anchor-puuid', 'user-1', 'Cesar')];

  const { squad, rivals } = partitionLinkedPlayers(participants, 'anchor-puuid', links);

  // The anchor themselves counts as squad — the announcement lists them.
  assert.deepEqual(squad, [
    { user_id: 'user-1', game_name: 'Cesar', puuid: 'anchor-puuid', side: 'squad' },
  ]);
  assert.deepEqual(rivals, []);
});

test('partitionLinkedPlayers: teammates join the squad, enemies become rivals', () => {
  // The fun case: three friends in one lobby, one of them on the OTHER
  // team. Bets ride on the anchor's team, so the split must be exact.
  const participants = [
    participant('anchor-puuid', 100),
    participant('ally-puuid', 100),   // same team as anchor
    participant('enemy-puuid', 200),  // opposing team
    participant('stranger', 200),     // not linked — must be ignored
  ];
  const links = [
    link('anchor-puuid', 'user-1', 'Cesar'),
    link('ally-puuid', 'user-2', 'Dave'),
    link('enemy-puuid', 'user-3', 'Raymon'),
  ];

  const { squad, rivals } = partitionLinkedPlayers(participants, 'anchor-puuid', links);

  assert.deepEqual(squad.map((p) => p.user_id), ['user-1', 'user-2']);
  assert.deepEqual(rivals.map((p) => p.user_id), ['user-3']);
  // The side tag is what trackMatch persists and settlement later reads.
  assert.ok(squad.every((p) => p.side === 'squad'));
  assert.ok(rivals.every((p) => p.side === 'rival'));
});

test('partitionLinkedPlayers: unlinked participants never leak into either list', () => {
  // A full 10-player lobby where only the anchor is ours: the other nine
  // are strangers and must not appear, linked or not.
  const participants = [
    participant('anchor-puuid', 100),
    ...Array.from({ length: 4 }, (_, i) => participant(`blue-${i}`, 100)),
    ...Array.from({ length: 5 }, (_, i) => participant(`red-${i}`, 200)),
  ];
  const links = [link('anchor-puuid', 'user-1', 'Cesar')];

  const { squad, rivals } = partitionLinkedPlayers(participants, 'anchor-puuid', links);
  assert.equal(squad.length, 1);
  assert.equal(rivals.length, 0);
});

test('partitionLinkedPlayers: links not present in this game are ignored', () => {
  // getAllLinks returns EVERY linked account; only the ones actually in
  // this lobby belong in the partition.
  const participants = [participant('anchor-puuid', 100)];
  const links = [
    link('anchor-puuid', 'user-1', 'Cesar'),
    link('offline-puuid', 'user-9', 'NotPlaying'),
  ];

  const { squad, rivals } = partitionLinkedPlayers(participants, 'anchor-puuid', links);
  assert.deepEqual(squad.map((p) => p.user_id), ['user-1']);
  assert.equal(rivals.length, 0);
});

test('partitionLinkedPlayers: missing anchor → empty partition (defensive)', () => {
  // Shouldn't happen (the anchor's spectator call found the game), but if
  // Riot's participant list ever omits them we can't know which team is
  // "ours" — bailing to empty beats guessing where bets should ride.
  const participants = [participant('someone-else', 100)];
  const links = [link('anchor-puuid', 'user-1', 'Cesar')];

  const result = partitionLinkedPlayers(participants, 'anchor-puuid', links);
  assert.deepEqual(result, { squad: [], rivals: [] });
});
