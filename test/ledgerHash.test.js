// ============================================================
// ledgerHash.test.js — Unit tests for src/lib/ledgerHash.js.
//
// The tamper-evidence promise is only as good as two properties:
//  1. hashing is DETERMINISTIC across round-trips (JSONB reorders
//     object keys, so canonicalStringify must erase key order), and
//  2. verifyChain actually catches both failure modes — a broken
//     LINK (rows removed/reordered) and edited CONTENT (a row's
//     fields changed after hashing).
// This file proves both, plus the negative space around them.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENESIS,
  canonicalStringify,
  hashRow,
  verifyChain,
} from '../src/lib/ledgerHash.js';

// ---------------------------------------------------------------
// canonicalStringify
// ---------------------------------------------------------------

test('canonicalStringify: key order does not change the output', () => {
  // The whole reason this function exists: Postgres JSONB stores objects
  // in its own internal key order, so the metadata we read back for
  // verification may be ordered differently than what we hashed at write
  // time. Same data, either order → byte-identical string.
  const a = { game: 'slots', bet: 50, reels: ['🍒', '🍒', '💎'] };
  const b = { reels: ['🍒', '🍒', '💎'], bet: 50, game: 'slots' };
  assert.equal(canonicalStringify(a), canonicalStringify(b));
});

test('canonicalStringify: sorting recurses into nested objects', () => {
  // A shallow sort would miss reordered keys one level down.
  const a = { outer: { z: 1, a: 2 }, list: [{ b: 1, a: 2 }] };
  const b = { list: [{ a: 2, b: 1 }], outer: { a: 2, z: 1 } };
  assert.equal(canonicalStringify(a), canonicalStringify(b));
});

test('canonicalStringify: ARRAY order is preserved (it is data, not structure)', () => {
  // Only object keys are order-insensitive. [1,2] and [2,1] are different
  // values and must hash differently — e.g. slot reels in a different
  // order are a different spin.
  assert.notEqual(canonicalStringify([1, 2]), canonicalStringify([2, 1]));
});

test('canonicalStringify: primitives and null match plain JSON', () => {
  // For non-objects it should be indistinguishable from JSON.stringify,
  // so there's exactly one serialization story to reason about.
  for (const value of [null, 42, 'text', true, ['a', null, 1]]) {
    assert.equal(canonicalStringify(value), JSON.stringify(value));
  }
});

// ---------------------------------------------------------------
// hashRow
// ---------------------------------------------------------------

// A baseline row to vary one field at a time.
const BASE = {
  id: 1,
  guildId: 'guild-1',
  userId: 'user-1',
  amount: 100,
  type: 'daily',
  metadata: { streak: 3 },
  createdAtText: '2026-07-03 12:00:00+00',
  prevHash: GENESIS,
};

test('hashRow: deterministic, 64-char lowercase hex (SHA-256)', () => {
  const h1 = hashRow(BASE);
  const h2 = hashRow({ ...BASE });
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('hashRow: every field participates in the hash', () => {
  // If any field were accidentally dropped from the canonical string, an
  // attacker could edit that field invisibly. Flip each one and demand a
  // different hash.
  const variants = {
    id: 2,
    guildId: 'guild-2',
    userId: 'user-2',
    amount: 101,
    type: 'work',
    metadata: { streak: 4 },
    createdAtText: '2026-07-03 12:00:01+00',
    prevHash: 'f'.repeat(64),
  };
  const baseline = hashRow(BASE);
  for (const [field, value] of Object.entries(variants)) {
    assert.notEqual(
      hashRow({ ...BASE, [field]: value }),
      baseline,
      `changing ${field} must change the hash`,
    );
  }
});

test('hashRow: null/undefined metadata hashes like an empty object', () => {
  // insertLedger may write rows with no metadata; the ?? {} fallback means
  // NULL from the database and {} agree — verification can't diverge on it.
  const withNull = hashRow({ ...BASE, metadata: null });
  const withEmpty = hashRow({ ...BASE, metadata: {} });
  assert.equal(withNull, withEmpty);
});

// ---------------------------------------------------------------
// verifyChain — building a real chain and then attacking it
// ---------------------------------------------------------------

/**
 * Builds a valid N-row chain shaped like the rows /audit reads back from
 * the database: snake_case columns plus created_at_text (the ::text
 * rendering of the timestamp). Doing this with the REAL hashRow means the
 * test chain is honest — if hashRow changes, the chain rebuilds to match
 * and only genuine verification bugs can fail these tests.
 */
function buildChain(specs) {
  const rows = [];
  let prevHash = GENESIS; // the first row links to the sentinel, not a hash
  for (const [i, spec] of specs.entries()) {
    const row = {
      id: i + 1,
      guild_id: 'guild-1',
      user_id: spec.userId ?? 'user-1',
      amount: spec.amount,
      type: spec.type ?? 'test',
      metadata: spec.metadata ?? {},
      created_at_text: `2026-07-03 12:00:0${i}+00`,
      prev_hash: prevHash,
    };
    row.row_hash = hashRow({
      id: row.id,
      guildId: row.guild_id,
      userId: row.user_id,
      // verifyChain recomputes with String(amount) — mirror that here so
      // numeric amounts round-trip the way bigint-as-string does from pg.
      amount: String(row.amount),
      type: row.type,
      metadata: row.metadata,
      createdAtText: row.created_at_text,
      prevHash: row.prev_hash,
    });
    rows.push(row);
    prevHash = row.row_hash; // the next row links here
  }
  return rows;
}

test('verifyChain: a well-formed chain verifies, head hash = last row', () => {
  const rows = buildChain([
    { amount: 500, type: 'welcome_bonus' },
    { amount: -50, type: 'slots_bet' },
    { amount: 60, type: 'slots_win', metadata: { reels: ['🍒', '🍒', '🍒'] } },
  ]);
  const result = verifyChain(rows);
  assert.deepEqual(result, {
    ok: true,
    checked: 3,
    headHash: rows[2].row_hash,
  });
});

test('verifyChain: an empty chain is trivially valid with the GENESIS head', () => {
  // A brand-new guild has no ledger rows yet; /audit must report clean,
  // not crash.
  assert.deepEqual(verifyChain([]), { ok: true, checked: 0, headHash: GENESIS });
});

test('verifyChain: detects a CONTENT edit (the classic "give myself monies" attack)', () => {
  const rows = buildChain([{ amount: 100 }, { amount: 100 }, { amount: 100 }]);

  // The attack: quietly bump row 2's amount after the fact. Its stored
  // row_hash no longer matches a recomputation of its contents.
  rows[1].amount = 1_000_000;

  const result = verifyChain(rows);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAtId, rows[1].id); // pinpoints the edited row
  assert.match(result.reason, /content mismatch/);
  assert.equal(result.checked, 1); // one row verified clean before the break
});

test('verifyChain: detects a BROKEN LINK (a row deleted from the middle)', () => {
  const rows = buildChain([{ amount: 100 }, { amount: -40 }, { amount: 25 }]);

  // The attack: erase an embarrassing row entirely. Row 3 still points at
  // row 2's hash, but row 2 is gone — the link check fails on row 3.
  const withoutMiddle = [rows[0], rows[2]];

  const result = verifyChain(withoutMiddle);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAtId, rows[2].id);
  assert.match(result.reason, /broken link/);
});

test('verifyChain: detects a tampered first row (GENESIS link is enforced)', () => {
  const rows = buildChain([{ amount: 100 }]);
  // Point the first row at a fabricated hash instead of GENESIS — e.g.
  // someone splicing a forged prefix onto the chain.
  rows[0].prev_hash = 'a'.repeat(64);
  const result = verifyChain(rows);
  assert.equal(result.ok, false);
  assert.match(result.reason, /broken link/);
});

test('verifyChain: survives JSONB reordering metadata keys (the round-trip case)', () => {
  // Write-side hashed { b, a }; read-side JSONB hands back { a, b }.
  // canonicalStringify must make verification blind to the difference —
  // this is the integration point the canonicalStringify tests exist for.
  const rows = buildChain([
    { amount: -50, metadata: { game: 'blackjack', bet: 50 } },
  ]);
  // Simulate the reorder: same keys/values, different insertion order.
  rows[0].metadata = { bet: 50, game: 'blackjack' };
  assert.equal(verifyChain(rows).ok, true);
});
