// ============================================================
// prng.js (test helper) — A seeded pseudo-random number
// generator for tests.
//
// Why not Math.random()? Because a Monte Carlo test that uses
// Math.random() gives a slightly different answer on every run,
// and a statistical assertion around it would fail once in a
// blue moon ("flaky"). Seeding makes the entire random sequence
// a fixed function of the seed: the RTP test computes the SAME
// number on every machine, every run — so it either always
// passes or always fails, never sometimes.
//
// NOTE: this file deliberately does NOT match the *.test.js
// naming pattern, so `node --test test/` imports it but never
// tries to run it as a test file.
// ============================================================

/**
 * mulberry32 — a tiny, well-known 32-bit PRNG. Not cryptographic
 * (we don't need that here), but fast and statistically good
 * enough for Monte Carlo work at the millions-of-samples scale.
 * Returns a function with the same contract as Math.random():
 * floats in [0, 1). That matters because every rng-injectable
 * function in src (drawSymbol, shuffle, pickWeightedWinner)
 * assumes exactly that contract.
 */
export function mulberry32(seed) {
  // >>> 0 coerces to an unsigned 32-bit int — the state space
  // the algorithm's constants were designed for.
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    // The scrambling below is the published mulberry32 mixing
    // function verbatim; Math.imul keeps multiplication in
    // 32-bit integer land (plain * would spill into floats).
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    // Divide by 2^32 to land in [0, 1), same range as Math.random.
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
