// ============================================================
// achievements.test.js — Contract tests for the catalog shape
// (mirroring commands.test.js) plus FIXTURE tests: every check
// function is fed synthetic events and fake queries and must
// answer true/false exactly as designed. No database, no
// Discord — ctx.queries is just a plain object here, which is
// the whole point of the injectable seam.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACHIEVEMENTS, TIERS, TRIGGERS } from '../src/data/achievements.js';
import { achievementEmbed } from '../src/lib/achievements.js';
import { ROB, LOL } from '../src/config.js';

const byId = new Map(ACHIEVEMENTS.map((d) => [d.id, d]));

// ------------------------------------------------------------
// Contract: the catalog's shape
// ------------------------------------------------------------

test('the catalog is non-empty', () => {
  assert.ok(ACHIEVEMENTS.length > 0, 'the achievement catalog is empty');
});

test('every definition honors the catalog contract', () => {
  for (const def of ACHIEVEMENTS) {
    const where = `achievement "${def.id ?? '<no id>'}"`;

    assert.equal(typeof def.id, 'string', `${where}: id must be a string`);
    assert.match(def.id, /^[a-z0-9_]+$/, `${where}: id must be snake_case`);

    for (const field of ['name', 'emoji', 'description']) {
      assert.equal(typeof def[field], 'string', `${where}: ${field} must be a string`);
      assert.ok(def[field].length > 0, `${where}: ${field} is empty`);
    }

    assert.ok(def.tier in TIERS, `${where}: unknown tier "${def.tier}"`);
    assert.equal(typeof def.secret, 'boolean', `${where}: secret must be a boolean`);

    assert.ok(Array.isArray(def.triggers) && def.triggers.length > 0,
      `${where}: triggers must be a non-empty array`);
    for (const t of def.triggers) {
      assert.ok(TRIGGERS.has(t), `${where}: unknown trigger "${t}"`);
    }

    assert.equal(typeof def.check, 'function', `${where}: check must be a function`);
  }
});

test('achievement ids are unique', () => {
  const seen = new Set();
  for (const def of ACHIEVEMENTS) {
    assert.ok(!seen.has(def.id), `duplicate achievement id "${def.id}"`);
    seen.add(def.id);
  }
});

test('tier metadata is complete and ranks are distinct', () => {
  const ranks = new Set();
  for (const [key, tier] of Object.entries(TIERS)) {
    assert.equal(typeof tier.rank, 'number', `tier ${key}: rank must be a number`);
    assert.equal(typeof tier.color, 'number', `tier ${key}: color must be a number (embed int)`);
    assert.ok(tier.label.length > 0, `tier ${key}: label is empty`);
    assert.ok(tier.marker.length > 0, `tier ${key}: marker is empty`);
    assert.ok(!ranks.has(tier.rank), `tier ${key}: duplicate rank ${tier.rank}`);
    ranks.add(tier.rank);
  }
});

test('every trigger in TRIGGERS has at least one subscriber', () => {
  // A trigger nothing listens to is either dead wiring or a typo'd
  // subscription elsewhere — both worth a loud failure.
  const used = new Set(ACHIEVEMENTS.flatMap((d) => d.triggers));
  for (const t of TRIGGERS) {
    assert.ok(used.has(t), `trigger "${t}" has no subscribed achievements`);
  }
});

// ------------------------------------------------------------
// Fixtures: every check answers its cases correctly
// ------------------------------------------------------------

// The nine phase-1 "first time" awards: the trigger firing IS the
// qualification (the composite PK supplies the "first").
const STARTER_IDS = [
  'first_daily', 'first_work', 'first_pay', 'first_bet', 'first_gift',
  'first_bank', 'link_account', 'first_fact', 'first_wordle',
];

test('the getting-started checks qualify on their bare trigger event', async () => {
  for (const id of STARTER_IDS) {
    const def = byId.get(id);
    assert.ok(def, `starter achievement "${id}" is missing from the catalog`);
    assert.ok(await def.check({ event: {}, queries: {} }),
      `${id}: check should qualify when its trigger fires`);
  }
});

// One row per case: [achievement id, ctx fragment, expected verdict].
// `event: null` cases simulate the phase-3 sweep re-running a check from
// queries alone. Fake queries return canned numbers — the seam in action.
const CASES = [
  // Wealth thresholds (boundary on both sides).
  ['worth_1k',  { queries: { totalWorth: async () => 1_000 } }, true],
  ['worth_1k',  { queries: { totalWorth: async () => 999 } },   false],
  ['worth_5k',  { queries: { totalWorth: async () => 5_000 } }, true],
  ['worth_5k',  { queries: { totalWorth: async () => 4_999 } }, false],
  ['worth_10k', { queries: { totalWorth: async () => 10_000 } }, true],
  ['worth_10k', { queries: { totalWorth: async () => 9_999 } },  false],
  ['worth_25k', { queries: { totalWorth: async () => 25_000 } }, true],
  ['worth_25k', { queries: { totalWorth: async () => 24_999 } }, false],

  // Rock Bottom: event balance when present, query fallback otherwise.
  ['flat_broke', { event: { newBalance: 0 } }, true],
  ['flat_broke', { event: { newBalance: 5 } }, false],
  ['flat_broke', { event: {}, queries: { walletBalance: async () => 0 } }, true],
  ['flat_broke', { event: {}, queries: { walletBalance: async () => 12 } }, false],

  ['earned_10k', { queries: { lifetimeEarned: async () => 10_000 } }, true],
  ['earned_10k', { queries: { lifetimeEarned: async () => 9_999 } },  false],

  // Daily streaks come straight off the claim event.
  ['daily_streak_7',   { event: { streak: 7 } },   true],
  ['daily_streak_7',   { event: { streak: 6 } },   false],
  ['daily_streak_30',  { event: { streak: 30 } },  true],
  ['daily_streak_30',  { event: { streak: 29 } },  false],
  ['daily_streak_100', { event: { streak: 100 } }, true],
  ['daily_streak_100', { event: { streak: 99 } },  false],

  ['work_100', { queries: { countType: async (t) => (t === 'work' ? 100 : 0) } }, true],
  ['work_100', { queries: { countType: async () => 99 } }, false],

  ['generous_1k', { queries: { sumGivenAway: async () => 1_000 } }, true],
  ['generous_1k', { queries: { sumGivenAway: async () => 999 } },   false],

  ['big_spender', { event: { item: 'diamond' } }, true],
  ['big_spender', { event: { item: 'beer' } },    false],

  ['bribe_menu', { queries: { bribeKinds: async () => 3 } }, true],
  ['bribe_menu', { queries: { bribeKinds: async () => 2 } }, false],

  // Banking & loans.
  ['banked_5k', { event: { banked: 5_000 } }, true],
  ['banked_5k', { event: { banked: 4_999 } }, false],
  ['banked_5k', { event: {}, queries: { bankedBalance: async () => 6_000 } }, true],

  ['loan_taken', { event: { action: 'borrow', amount: 100, limit: 250 } }, true],
  ['loan_taken', { event: { action: 'repay' } }, false],

  ['loan_cleared', { event: { action: 'repay', cleared: true } },  true],
  ['loan_cleared', { event: { action: 'repay', cleared: false } }, false],
  ['loan_cleared', { event: { garnishCleared: true } },  true],  // via /daily or /work
  ['loan_cleared', { event: { garnishCleared: false } }, false],

  ['loan_maxed', { event: { action: 'borrow', amount: 250, limit: 250 } }, true],
  ['loan_maxed', { event: { action: 'borrow', amount: 249, limit: 250 } }, false],
  ['loan_maxed', { event: { action: 'repay', amount: 250, limit: 250 } },  false],

  ['garnished_10', { event: { garnished: 25 }, queries: { countType: async () => 10 } }, true],
  ['garnished_10', { event: { garnished: 25 }, queries: { countType: async () => 9 } },  false],
  ['garnished_10', { event: { garnished: 0 } }, false],
  ['garnished_10', { event: null, queries: { countType: async () => 10 } }, true], // sweep

  // Crime — robber side.
  ['first_rob', { event: { success: true } },  true],
  ['first_rob', { event: { success: false } }, false],
  ['rob_fail',  { event: { success: false } }, true],
  ['rob_fail',  { event: { success: true } },  false],
  ['rob_max',   { event: { success: true, amount: ROB.maxSteal } }, true],
  ['rob_max',   { event: { success: true, amount: ROB.maxSteal - 1 } }, false],
  ['rob_max',   { event: { success: false, amount: ROB.maxSteal } }, false],
  ['serial_robber', { event: { success: true, victim: 'v1' },
    queries: { countRobsFrom: async (v) => (v === 'v1' ? 3 : 0) } }, true],
  ['serial_robber', { event: { success: true, victim: 'v1' },
    queries: { countRobsFrom: async () => 2 } }, false],
  ['serial_robber', { event: { success: false, victim: 'v1' } }, false],

  // Crime — victim side.
  ['robbed', { event: { success: true } },  true],
  ['robbed', { event: { success: false } }, false],
  ['damages_earned', { queries: { countType: async () => 5 } }, true],
  ['damages_earned', { queries: { countType: async () => 4 } }, false],
  ['untouchable', { queries: { victimRecord: async () => ({ timesRobbed: 0, attemptsOnMe: 5 }) } }, true],
  ['untouchable', { queries: { victimRecord: async () => ({ timesRobbed: 1, attemptsOnMe: 5 }) } }, false],
  ['untouchable', { queries: { victimRecord: async () => ({ timesRobbed: 0, attemptsOnMe: 4 }) } }, false],

  // Raffle.
  ['raffle_win',      { event: {} }, true],
  ['raffle_underdog', { event: { tickets: 4, pot: 100 } }, true],   // 4% share
  ['raffle_underdog', { event: { tickets: 5, pot: 100 } }, false],  // exactly 5% is not < 5%
  ['raffle_underdog', { event: { tickets: 0, pot: 0 } },   false],  // empty pot guard
  ['raffle_whale',    { event: { userTickets: 1_000 } }, true],
  ['raffle_whale',    { event: { userTickets: 999 } },   false],

  // Blackjack.
  ['bj_natural',   { event: { result: 'blackjack' } }, true],
  ['bj_natural',   { event: { result: 'win' } },       false],
  ['bj_five_card', { event: { result: 'win', playerCards: 5 } }, true],
  ['bj_five_card', { event: { result: 'win', playerCards: 4 } }, false],
  ['bj_five_card', { event: { result: 'lose', playerCards: 6 } }, false],
  ['bj_push_3', { event: { result: 'push' }, queries: { countTodayType: async () => 3 } }, true],
  ['bj_push_3', { event: { result: 'push' }, queries: { countTodayType: async () => 2 } }, false],
  ['bj_push_3', { event: { result: 'win' } }, false],
  ['bj_comeback', { event: { result: 'win', bet: 500 } },       true],
  ['bj_comeback', { event: { result: 'blackjack', bet: 500 } }, true],
  ['bj_comeback', { event: { result: 'win', bet: 499 } },       false],
  ['bj_comeback', { event: { result: 'lose', bet: 500 } },      false],

  // Slots.
  ['slots_jackpot', { event: { reels: ['7️⃣', '7️⃣', '7️⃣'] } }, true],
  ['slots_jackpot', { event: { reels: ['7️⃣', '7️⃣', '🍒'] } }, false],
  ['slots_triple',  { event: { multiplier: 5 } },   true],
  ['slots_triple',  { event: { multiplier: 4 } },   false], // two sevens pays 4x, not a triple
  ['slots_dry_10', { event: { net: -5 },
    queries: { lastNets: async () => Array(10).fill(-5) } }, true],
  ['slots_dry_10', { event: { net: -5 },
    queries: { lastNets: async () => Array(9).fill(-5) } }, false], // only 9 spins ever
  ['slots_dry_10', { event: { net: -5 },
    queries: { lastNets: async () => [-5, -5, 6, ...Array(7).fill(-5)] } }, false],
  ['slots_dry_10', { event: { net: 6 } }, false], // a win ends the misery
  ['slots_dry_10', { event: null,
    queries: { lastNets: async () => Array(10).fill(-1) } }, true], // sweep
  ['slots_100', { queries: { countType: async () => 100 } }, true],
  ['slots_100', { queries: { countType: async () => 99 } },  false],

  // Coinflip streaks & the gambling career.
  ['flip_streak_5', { event: { won: true },
    queries: { lastCoinflipResults: async () => [true, true, true, true, true] } }, true],
  ['flip_streak_5', { event: { won: true },
    queries: { lastCoinflipResults: async () => [true, true, false, true, true] } }, false],
  ['flip_streak_5', { event: { won: false } }, false],
  ['flip_cold_5', { event: { won: false },
    queries: { lastCoinflipResults: async () => [false, false, false, false, false] } }, true],
  ['flip_cold_5', { event: { won: false },
    queries: { lastCoinflipResults: async () => [false, false] } }, false],
  ['flip_cold_5', { event: { won: true } }, false],
  ['gambler_net_5k', { queries: { gamblingNet: async () => 5_000 } },  true],
  ['gambler_net_5k', { queries: { gamblingNet: async () => 4_999 } },  false],
  ['house_wins',     { queries: { gamblingNet: async () => -5_000 } }, true],
  ['house_wins',     { queries: { gamblingNet: async () => -4_999 } }, false],

  // Wordle.
  ['wordle_hole_in_one', { event: { solved: true, attempts: 1 } }, true],
  ['wordle_hole_in_one', { event: { solved: true, attempts: 2 } }, false],
  ['wordle_in_two',      { event: { solved: true, attempts: 2 } }, true],
  ['wordle_in_two',      { event: { solved: true, attempts: 3 } }, false],
  ['wordle_clutch',      { event: { solved: true, attempts: 6 } }, true],
  ['wordle_clutch',      { event: { solved: false, attempts: 6 } }, false],
  ['wordle_fail',        { event: { solved: false } }, true],
  ['wordle_fail',        { event: { solved: true } },  false],
  ['wordle_streak_7',  { event: { solved: true, streak: 7 } },  true],
  ['wordle_streak_7',  { event: { solved: true, streak: 6 } },  false],
  ['wordle_streak_30', { event: { solved: true, streak: 30 } }, true],
  ['wordle_streak_30', { event: { solved: false, streak: 30 } }, false],
  ['wordle_50', { event: { solved: true }, queries: { countWordleSolves: async () => 50 } }, true],
  ['wordle_50', { event: { solved: true }, queries: { countWordleSolves: async () => 49 } }, false],
  ['wordle_50', { event: { solved: false } }, false],
  ['wordle_50', { event: null, queries: { countWordleSolves: async () => 50 } }, true], // sweep

  // LoL — recorded matches. (600s floor keeps remakes out of "deathless".)
  ['lol_deathless', { event: { deaths: 0, durationSec: 1_800 } }, true],
  ['lol_deathless', { event: { deaths: 1, durationSec: 1_800 } }, false],
  ['lol_deathless', { event: { deaths: 0, durationSec: 599 } },   false],
  ['lol_20kills', { event: { kills: 20 } }, true],
  ['lol_20kills', { event: { kills: 19 } }, false],
  ['lol_0_10', { event: { kills: 0, deaths: 10 } }, true],
  ['lol_0_10', { event: { kills: 1, deaths: 10 } }, false],
  ['lol_0_10', { event: { kills: 0, deaths: 9 } },  false],
  ['lol_win_streak_5', { event: { win: true },
    queries: { lolLastResults: async () => [true, true, true, true, true] } }, true],
  ['lol_win_streak_5', { event: { win: true },
    queries: { lolLastResults: async () => [true, false, true, true, true] } }, false],
  ['lol_win_streak_5', { event: { win: false } }, false],
  ['lol_loss_streak_5', { event: { win: false },
    queries: { lolLastResults: async () => [false, false, false, false, false] } }, true],
  ['lol_loss_streak_5', { event: { win: true } }, false],
  ['lol_100_games', { queries: { lolGameCount: async () => 100 } }, true],
  ['lol_100_games', { queries: { lolGameCount: async () => 99 } },  false],
  ['lol_aram_50', { queries: { lolQueueCount: async (q) => (q === 450 ? 50 : 0) } }, true],
  ['lol_aram_50', { queries: { lolQueueCount: async () => 49 } }, false],
  ['lol_pentakill', { event: { pentaKills: 1 } }, true],
  ['lol_pentakill', { event: { pentaKills: 0 } }, false],
  ['lol_first_blood', { event: { firstBlood: true } },  true],
  ['lol_first_blood', { event: { firstBlood: false } }, false],
  ['lol_cs_300', { event: { cs: 300 } }, true],
  ['lol_cs_300', { event: { cs: 299 } }, false],

  // LoL — betting.
  ['bet_first_win', { event: { correct: true } },  true],
  ['bet_first_win', { event: { correct: false } }, false],
  ['bet_streak_5', { event: { correct: true },
    queries: { lastBetResults: async () => [true, true, true, true, true] } }, true],
  ['bet_streak_5', { event: { correct: true },
    queries: { lastBetResults: async () => [true, true, true] } }, false],
  ['bet_streak_5', { event: { correct: false } }, false],
  ['bet_traitor', { event: { correct: true, onWin: false } }, true],
  ['bet_traitor', { event: { correct: true, onWin: true } },  false],
  ['bet_traitor', { event: { correct: false, onWin: false } }, false],
  ['bet_max_win', { event: { correct: true, amount: LOL.maxBet } }, true],
  ['bet_max_win', { event: { correct: true, amount: LOL.maxBet - 1 } }, false],
  ['bet_max_win', { event: { correct: false, amount: LOL.maxBet } },  false],

  // Birthdays.
  ['birthday_set', { event: { month: 7, day: 4 } }, true],
  ['birthday_celebrated', { event: { year: 2026 } }, true],
  ['birthday_generous', { event: { to: 'u2' },
    queries: { isUsersBirthdayToday: async (u) => u === 'u2' } }, true],
  ['birthday_generous', { event: { to: 'u3' },
    queries: { isUsersBirthdayToday: async (u) => u === 'u2' } }, false],

  // Meta & social.
  ['facts_about_you_5', { queries: { countFactsAboutMe: async () => 5 } }, true],
  ['facts_about_you_5', { queries: { countFactsAboutMe: async () => 4 } }, false],
  ['poll_starter', { event: {} }, true],
  ['warned',       { event: {} }, true],
  ['completionist_25', { queries: { countAchievements: async () => 25 } }, true],
  ['completionist_25', { queries: { countAchievements: async () => 24 } }, false],
  ['completionist_50', { queries: { countAchievements: async () => 50 } }, true],
  ['completionist_50', { queries: { countAchievements: async () => 49 } }, false],
];

// Sweep-path fixtures: event = null, verdict must come from queries
// alone. One true case per sweep-capable check proves retroactive
// awarding works; the blank-user test below proves the false side.
const SWEEP_CASES = [
  ['first_daily',  { countType: async (t) => (t === 'daily' ? 1 : 0) }, true],
  ['first_work',   { countType: async (t) => (t === 'work' ? 1 : 0) }, true],
  ['first_pay',    { countType: async (t) => (t === 'pay_sent' ? 1 : 0) }, true],
  ['first_bet',    { hasAnyWager: async () => true }, true],
  ['first_gift',   { countType: async (t) => (t === 'gift_sent' ? 1 : 0) }, true],
  ['first_bank',   { countType: async (t) => (t === 'bank_deposit' ? 1 : 0) }, true],
  ['link_account', { hasLink: async () => true }, true],
  ['first_fact',   { countFactsITaught: async () => 1 }, true],
  ['first_wordle', { countWordleGames: async () => 1 }, true],
  ['flat_broke',   { walletBalance: async () => 0, countType: async () => 1 }, true],
  ['flat_broke',   { walletBalance: async () => 0, countType: async () => 0 }, false], // empty ≠ broke
  ['daily_streak_7',  { currentDailyStreak: async () => 7 }, true],
  ['daily_streak_7',  { currentDailyStreak: async () => 6 }, false],
  ['big_spender',  { hasSentGift: async (i) => i === 'diamond' }, true],
  ['loan_taken',   { hasLoanEver: async () => true }, true],
  ['loan_cleared', { hasPaidLoan: async () => true }, true],
  ['loan_maxed',   {}, false], // moment-only: sweep must never grant it
  ['first_rob',    { countType: async (t) => (t === 'rob_steal' ? 1 : 0) }, true],
  ['rob_fail',     { countType: async (t) => (t === 'rob_fail' ? 1 : 0) }, true],
  ['robbed',       { countType: async (t) => (t === 'rob_victim' ? 1 : 0) }, true],
  ['rob_max',      { maxRobHaul: async () => ROB.maxSteal }, true],
  ['rob_max',      { maxRobHaul: async () => ROB.maxSteal - 1 }, false],
  ['serial_robber', { maxRobsFromOneVictim: async () => 3 }, true],
  ['serial_robber', { maxRobsFromOneVictim: async () => 2 }, false],
  ['raffle_win',   { countType: async (t) => (t === 'raffle_win' ? 1 : 0) }, true],
  ['raffle_underdog', {}, false], // moment-only
  ['raffle_whale', { maxRaffleTickets: async () => 1_000 }, true],
  ['bj_natural',   {}, false],    // moment-only
  ['slots_jackpot', { hasSlotsTriple: async (s) => s === '7️⃣' }, true],
  ['slots_triple',  { hasSlotsMultiplierAtLeast: async (n) => n === 5 }, true],
  ['wordle_hole_in_one', { hasWordleSolveIn: async (n) => n === 1 }, true],
  ['wordle_in_two',      { hasWordleSolveIn: async (n) => n === 2 }, true],
  ['wordle_clutch',      { hasWordleSolveIn: async (n) => n === 6 }, true],
  ['wordle_fail',        { hasWordleFail: async () => true }, true],
  ['wordle_streak_7',    { currentWordleStreak: async () => 7 }, true],
  ['wordle_streak_7',    { currentWordleStreak: async () => 6 }, false],
  ['lol_deathless', { hasLolGameWhere: async (b) => b.maxDeaths === 0 }, true],
  ['lol_20kills',   { hasLolGameWhere: async (b) => b.minKills === 20 }, true],
  ['lol_0_10',      { hasLolGameWhere: async (b) => b.minDeaths === 10 }, true],
  ['lol_pentakill',   { hasLolGameWhere: async (b) => b.minPentas === 1 }, true],
  ['lol_first_blood', { hasLolGameWhere: async (b) => b.firstBlood === true }, true],
  ['lol_cs_300',      { hasLolGameWhere: async (b) => b.minCs === 300 }, true],
  ['bet_first_win', { hasCorrectBet: async () => true }, true],
  ['bet_traitor',   { hasTraitorWin: async () => true }, true],
  ['bet_max_win',   { maxCorrectBet: async () => LOL.maxBet }, true],
  ['bet_max_win',   { maxCorrectBet: async () => LOL.maxBet - 1 }, false],
  ['poll_starter',  {}, false],   // no database trace — sweep must never grant it
  ['warned',        { hasWarning: async () => true }, true],
  ['birthday_set',        { hasBirthdaySet: async () => true }, true],
  ['birthday_celebrated', { countType: async (t) => (t === 'birthday' ? 1 : 0) }, true],
  ['birthday_generous',   {}, false], // moment-only: sweep must never grant it
];

test('every catalog check answers its fixtures correctly', async () => {
  for (const [id, ctx, expected] of CASES) {
    const def = byId.get(id);
    assert.ok(def, `fixture references unknown achievement "${id}"`);
    const verdict = Boolean(
      await def.check({ event: 'event' in ctx ? ctx.event : {}, queries: ctx.queries ?? {} }),
    );
    assert.equal(
      verdict, expected,
      `${id}: expected ${expected} for ctx ${JSON.stringify(ctx.event)}`,
    );
  }
});

test('sweep-path fixtures (event = null) answer from queries alone', async () => {
  for (const [id, queries, expected] of SWEEP_CASES) {
    const def = byId.get(id);
    assert.ok(def, `sweep fixture references unknown achievement "${id}"`);
    const verdict = Boolean(await def.check({ event: null, queries }));
    assert.equal(verdict, expected, `${id}: sweep expected ${expected}`);
  }
});

// A fake queries object representing a user with NO history at all —
// every lookup answers zero/false/empty.
const BLANK_USER_QUERIES = {
  walletBalance: async () => 500, // fresh users hold the welcome bonus
  bankedBalance: async () => 0,
  totalWorth: async () => 500,
  lifetimeEarned: async () => 0,
  countType: async () => 0,
  countTodayType: async () => 0,
  sumGivenAway: async () => 0,
  bribeKinds: async () => 0,
  gamblingNet: async () => 0,
  lastNets: async () => [],
  lastCoinflipResults: async () => [],
  countRobsFrom: async () => 0,
  victimRecord: async () => ({ timesRobbed: 0, attemptsOnMe: 0 }),
  countWordleSolves: async () => 0,
  countFactsAboutMe: async () => 0,
  countAchievements: async () => 0,
  lolLastResults: async () => [],
  lolGameCount: async () => 0,
  lolQueueCount: async () => 0,
  lastBetResults: async () => [],
  hasAnyWager: async () => false,
  hasLink: async () => false,
  countFactsITaught: async () => 0,
  countWordleGames: async () => 0,
  currentDailyStreak: async () => 0,
  currentWordleStreak: async () => 0,
  hasWordleSolveIn: async () => false,
  hasWordleFail: async () => false,
  hasSentGift: async () => false,
  hasLoanEver: async () => false,
  hasPaidLoan: async () => false,
  maxRobHaul: async () => 0,
  maxRobsFromOneVictim: async () => 0,
  maxRaffleTickets: async () => 0,
  hasSlotsTriple: async () => false,
  hasSlotsMultiplierAtLeast: async () => false,
  hasCorrectBet: async () => false,
  hasTraitorWin: async () => false,
  maxCorrectBet: async () => 0,
  hasLolGameWhere: async () => false,
  hasWarning: async () => false,
  hasBirthdaySet: async () => false,
  isUsersBirthdayToday: async () => false,
};

test('SWEEP SAFETY: a blank user earns NOTHING from a null-event pass', async () => {
  // The single most important property of the sweep: a check that
  // answers true on a null event with empty data would be mass-awarded
  // to the entire server within the hour. Every check must sweep clean
  // for a user with no history. (A check calling a query missing from
  // the fake throws — which also fails this test, deliberately: the
  // fake doubles as the registry of legal query names.)
  for (const def of ACHIEVEMENTS) {
    const verdict = await def.check({ event: null, queries: BLANK_USER_QUERIES });
    assert.equal(
      Boolean(verdict), false,
      `${def.id}: a user with no history must not earn this from the sweep`,
    );
  }
});

test('every non-starter achievement has at least one fixture', () => {
  // The table above is only trustworthy if it's complete: a new catalog
  // entry without fixtures should fail loudly, not slip through untested.
  const covered = new Set(CASES.map(([id]) => id));
  for (const def of ACHIEVEMENTS) {
    if (STARTER_IDS.includes(def.id)) continue; // tested separately above
    assert.ok(covered.has(def.id), `achievement "${def.id}" has no fixture cases`);
  }
});

// ------------------------------------------------------------
// Announcement embed (pure rendering)
// ------------------------------------------------------------

test('achievementEmbed uses the fanciest tier color in a batch', () => {
  const common = byId.get('first_daily');
  const legendary = byId.get('slots_jackpot');
  const embed = achievementEmbed('Cesar', [common, legendary]);
  assert.equal(embed.data.color, TIERS.legendary.color);
});

test('achievementEmbed names every earned achievement', () => {
  const batch = ACHIEVEMENTS.slice(0, 3);
  const embed = achievementEmbed('Cesar', batch);
  for (const def of batch) {
    assert.ok(
      embed.data.description.includes(def.name),
      `announcement is missing "${def.name}"`,
    );
  }
  assert.ok(embed.data.description.includes('3 achievements'));
});
