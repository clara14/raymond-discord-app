// ============================================================
// ledgerHash.js (lib) — The tamper-evidence math: canonical
// serialization, row hashing, and chain verification. Pure
// functions only, so every piece is testable.
//
// The idea (borrowed from blockchains, minus the consensus):
// every transaction stores a hash of its own contents AND the
// hash of the previous row. Editing any historical row breaks
// every hash after it — the chain is evidence.
// ============================================================

import { createHash } from 'node:crypto';

// The first row of each guild's chain links to this instead of a real hash.
export const GENESIS = 'GENESIS';

/**
 * Deterministic JSON stringify: object keys sorted recursively. Needed
 * because JSONB does NOT preserve key order — the metadata we read back
 * for verification may be ordered differently than what we wrote, so the
 * hash must be independent of key order.
 */
export function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`);
  return `{${parts.join(',')}}`;
}

/**
 * The hash of one ledger row. Fields are joined with a separator that
 * can't appear ambiguously, then SHA-256'd. createdAtText must be the
 * DATABASE's text rendering of the timestamp (created_at::text) — a
 * stable string, immune to driver date-parsing precision quirks.
 */
export function hashRow({ id, guildId, userId, amount, type, metadata, createdAtText, prevHash }) {
  const canonical = [
    String(id),
    guildId,
    userId,
    String(amount),
    type,
    canonicalStringify(metadata ?? {}),
    createdAtText,
    prevHash,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verifies a full chain of rows (one guild, ordered by id ascending).
 * Each row must: (1) link its prev_hash to the previous row's row_hash
 * (GENESIS for the first), and (2) have a row_hash that matches a fresh
 * recomputation of its contents.
 *
 * Returns { ok:true, checked, headHash } or
 * { ok:false, brokenAtId, reason, checked }.
 */
export function verifyChain(rows) {
  let prevHash = GENESIS;

  for (const row of rows) {
    // Link check: does this row point at the actual previous row?
    if (row.prev_hash !== prevHash) {
      return {
        ok: false,
        brokenAtId: row.id,
        reason: 'broken link: prev_hash does not match the previous row',
        checked: rows.indexOf(row),
      };
    }

    // Content check: does the stored hash match a recomputation?
    const recomputed = hashRow({
      id: row.id,
      guildId: row.guild_id,
      userId: row.user_id,
      amount: String(row.amount),
      type: row.type,
      metadata: row.metadata,
      createdAtText: row.created_at_text,
      prevHash: row.prev_hash,
    });
    if (recomputed !== row.row_hash) {
      return {
        ok: false,
        brokenAtId: row.id,
        reason: 'content mismatch: row was modified after hashing',
        checked: rows.indexOf(row),
      };
    }

    prevHash = row.row_hash;
  }

  return { ok: true, checked: rows.length, headHash: prevHash };
}
