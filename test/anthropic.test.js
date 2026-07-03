// ============================================================
// anthropic.test.js — Unit tests for buildMessages from
// src/lib/anthropic.js.
//
// buildMessages is the seam between our chat_messages rows and
// the Messages API's strict conversation rules. The API rejects
// requests that violate them, so each rule gets a test:
//   1. user turns carry a "username: " prefix (multi-user chat)
//   2. consecutive same-role rows merge into one turn
//   3. the conversation must OPEN with a user turn
// The network-calling chatCompletion is not tested here — it's
// a thin wrapper whose interesting logic lives server-side.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages } from '../src/lib/anthropic.js';

// Row factory matching the shape chat.js returns (oldest-first).
const row = (role, username, content) => ({ role, username, content });

test('buildMessages: user rows get the username prefix, assistant rows never do', () => {
  // The prefix is how the model tells friends apart in a group chat.
  // The bot's own replies must stay bare — the system prompt explicitly
  // tells it not to prefix itself, and history has to match that.
  const messages = buildMessages([
    row('user', 'cesar', 'hey bot'),
    row('assistant', null, 'what do you want'),
  ]);
  assert.deepEqual(messages, [
    { role: 'user', content: 'cesar: hey bot' },
    { role: 'assistant', content: 'what do you want' },
  ]);
});

test('buildMessages: a user row with no username passes through unprefixed', () => {
  // Defensive path: a row missing its username (old data, system-injected
  // content) shouldn't render as "undefined: ...".
  const messages = buildMessages([row('user', null, 'plain text')]);
  assert.deepEqual(messages, [{ role: 'user', content: 'plain text' }]);
});

test('buildMessages: consecutive same-role rows merge into one turn', () => {
  // Two friends talking before the bot replies is ONE user turn to the
  // API (it requires strict user/assistant alternation). The merge joins
  // with newlines, keeping each speaker's prefix so attribution survives.
  const messages = buildMessages([
    row('user', 'cesar', 'who is richest'),
    row('user', 'dave', 'definitely not you'),
    row('assistant', null, 'let me check'),
    row('assistant', null, 'it is dave'),
  ]);
  assert.deepEqual(messages, [
    { role: 'user', content: 'cesar: who is richest\ndave: definitely not you' },
    { role: 'assistant', content: 'let me check\nit is dave' },
  ]);
});

test('buildMessages: alternating rows stay separate turns', () => {
  // Sanity check that merging ONLY fires on same-role neighbors.
  const messages = buildMessages([
    row('user', 'cesar', 'one'),
    row('assistant', null, 'two'),
    row('user', 'cesar', 'three'),
  ]);
  assert.equal(messages.length, 3);
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user']);
});

test('buildMessages: leading assistant rows are dropped', () => {
  // The history window can open mid-conversation with the bot's own reply
  // (the user turn that prompted it aged out of the window). The API
  // requires the first message to be a user turn, so those rows go.
  const messages = buildMessages([
    row('assistant', null, 'orphaned reply'),
    row('user', 'cesar', 'new topic'),
    row('assistant', null, 'sure'),
  ]);
  assert.deepEqual(messages, [
    { role: 'user', content: 'cesar: new topic' },
    { role: 'assistant', content: 'sure' },
  ]);
});

test('buildMessages: multiple leading assistant rows all drop (merge + shift)', () => {
  // Two orphaned bot messages first merge into one assistant turn, then
  // the leading-turn rule removes it — the while loop handles either path.
  const messages = buildMessages([
    row('assistant', null, 'orphan one'),
    row('assistant', null, 'orphan two'),
    row('user', 'dave', 'hello'),
  ]);
  assert.deepEqual(messages, [{ role: 'user', content: 'dave: hello' }]);
});

test('buildMessages: degenerate histories produce an empty list', () => {
  // No rows, or ONLY assistant rows — either way the result is [], which
  // the caller treats as "nothing to send". Better than an API 400.
  assert.deepEqual(buildMessages([]), []);
  assert.deepEqual(
    buildMessages([row('assistant', null, 'talking to myself')]),
    [],
  );
});
