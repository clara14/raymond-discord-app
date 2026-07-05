// ============================================================
// duration.js (lib) — Pure duration parsing for /remindme.
// "1h30m" → 5400. Compound forms, unit aliases, optional
// spaces, case-insensitive. Deliberately strict about
// everything else: bare numbers, negatives, zero, and any
// unparsed leftovers are null — ambiguity is a bug factory.
// Bounds (min/max) are POLICY, not parsing, so they live in
// config.REMINDERS and get checked by the command layer.
// ============================================================

// Every accepted unit spelling → its length in seconds.
const UNIT_SECONDS = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3_600, hr: 3_600, hrs: 3_600, hour: 3_600, hours: 3_600,
  d: 86_400, day: 86_400, days: 86_400,
  w: 604_800, week: 604_800, weeks: 604_800,
};

/**
 * Parses a human duration string into total seconds, or null if the
 * string isn't a clean sequence of <number><unit> tokens.
 *
 *   parseDuration('10m')      → 600
 *   parseDuration('1h30m')    → 5400
 *   parseDuration('1d 12h')   → 129600
 *   parseDuration('90')       → null  (bare number: 90 what?)
 *   parseDuration('soon')     → null
 *   parseDuration('0m')       → null  (zero isn't a wait)
 */
export function parseDuration(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (s.length === 0) return null;

  // Walk <digits><letters> tokens, tracking how much of the string they
  // legitimately consume. Comparing consumed vs input (whitespace
  // ignored) is what rejects garbage, bare numbers, and stray signs —
  // anything the tokens didn't account for invalidates the whole parse.
  const tokens = s.matchAll(/(\d+)\s*([a-z]+)/g);
  let total = 0;
  let consumed = '';
  for (const [whole, digits, unit] of tokens) {
    const unitSeconds = UNIT_SECONDS[unit];
    if (unitSeconds === undefined) return null; // "10 fortnights"
    total += Number(digits) * unitSeconds;
    consumed += whole;
  }

  if (consumed.replace(/\s+/g, '') !== s.replace(/\s+/g, '')) return null;
  return total > 0 ? total : null;
}
