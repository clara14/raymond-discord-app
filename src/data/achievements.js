// ============================================================
// achievements.js (data) — The achievement CATALOG.
// Adding an achievement = adding an entry here. Awards are
// stored by id in user_achievements, so the catalog can grow
// forever without schema changes. Phases 1–3 of
// docs/ACHIEVEMENTS_SPEC.md: framework, full catalog, sweep.
//
// SWEEP CONTRACT (the rule that keeps the sweep safe): the
// hourly sweep runs EVERY check with event = null. A check must
// therefore either (a) verify the feat from queries alone when
// event is absent, or (b) return false on a null event (for
// feats only observable in the moment, like betting against
// your squad on a specific settlement... or starting a poll,
// which leaves no database trace at all). A check that answered
// true on a null event would be mass-awarded to the whole
// server — the test suite proves a blank user sweeps clean.
// ============================================================

import { ROB, LOL } from '../config.js';

// Display metadata per tier. `rank` orders tiers (higher = fancier) and
// drives which color an announcement uses when several achievements land
// at once; colors follow the spec (gray/green/blue/purple/gold).
export const TIERS = {
  common:    { rank: 0, color: 0x95a5a6, label: 'Common',    marker: '⬜' },
  uncommon:  { rank: 1, color: 0x2ecc71, label: 'Uncommon',  marker: '🟩' },
  rare:      { rank: 2, color: 0x3498db, label: 'Rare',      marker: '🟦' },
  epic:      { rank: 3, color: 0x9b59b6, label: 'Epic',      marker: '🟪' },
  legendary: { rank: 4, color: 0xf1c40f, label: 'Legendary', marker: '🟨' },
};

// Every trigger the wiring can fire. The contract test checks each
// catalog entry subscribes only to triggers listed here, so a typo in a
// definition fails the suite instead of silently never firing.
export const TRIGGERS = new Set([
  'daily',      // /daily claimed (event: reward, streak, garnish fields)
  'work',       // /work payout (event: amount, garnish fields)
  'pay',        // /pay sent (event: amount, to)
  'gift',       // /gift delivered (event: item, price, to)
  'bank',       // /bank DEPOSIT succeeded (event: amount, banked)
  'bribe',      // /bribe performed (event: kind, price)
  'loan',       // /loan borrow or repay (event: action, ...)
  'rob',        // /rob attempted — ROBBER side (event: success, ...)
  'robbed',     // /rob attempted — VICTIM side (event: success, ...)
  'raffle',     // /raffle enter (event: amount, userTickets, pot)
  'raffle_win', // raffle drawn — fired for the WINNER
  'coinflip',   // coinflip resolved (event: bet, won, newBalance)
  'slots',      // slots resolved (event: bet, reels, multiplier, net, newBalance)
  'blackjack',  // blackjack game FINISHED (event: bet, result, playerCards, newBalance)
  'wordle',     // wordle finished, solve or fail (event: solved, attempts, streak)
  'link',       // Riot account linked
  'fact',       // /fact add — the TEACHER
  'fact_about', // /fact add — the SUBJECT
  'poll',       // /poll created
  'warn',       // warning received (fired for the warned user)
  'lolbet',     // a match bet settled (event: correct, amount, onWin)
  'lol_match',  // a new match landed in lol_match_history (event: the row)
  'meta',       // fired by the runner itself after any award (completionists)
]);

// A recorded LoL game shorter than this is a remake — nobody earns
// "deathless" for a 3-minute surrender.
const MIN_REAL_GAME_SEC = 600;

// Reusable check builders so the catalog entries stay one-liners.
// "first time" family: the trigger firing qualifies; the sweep verifies
// the same feat from recorded data instead.
const firstOf = (verify) => async ({ event, queries }) =>
  event ? true : Boolean(await verify(queries));
const worthAtLeast = (n) => async ({ queries }) => (await queries.totalWorth()) >= n;
const dailyStreakAtLeast = (n) => async ({ event, queries }) =>
  (event ? event.streak ?? 0 : await queries.currentDailyStreak()) >= n;
const wordleStreakAtLeast = (n) => async ({ event, queries }) => {
  if (event) return Boolean(event.solved) && (event.streak ?? 0) >= n;
  return (await queries.currentWordleStreak()) >= n;
};
const wordleSolveIn = (n) => async ({ event, queries }) => {
  if (event) return Boolean(event.solved) && event.attempts === n;
  return queries.hasWordleSolveIn(n);
};
const achievementsAtLeast = (n) => async ({ queries }) => (await queries.countAchievements()) >= n;

/**
 * Definition shape (see docs/ACHIEVEMENTS_SPEC.md):
 *   id          — stable snake_case key stored in the database
 *   name/emoji  — display identity
 *   description — announcements + the goal line in /achievements locked
 *   tier        — key into TIERS
 *   secret      — hidden in the locked list until earned
 *   triggers    — which events cause this check to run (the sweep runs
 *                 every check regardless, with event = null)
 *   check(ctx)  — ctx = { event, queries }; sync or async, side-effect
 *                 free, and bound by the SWEEP CONTRACT above.
 */
export const ACHIEVEMENTS = [
  // --- Getting started (one per core feature; all common, none secret) ---
  { id: 'first_daily', name: 'Early Bird', emoji: '🌅', tier: 'common', secret: false,
    description: 'Claim your first /daily.',
    triggers: ['daily'],
    check: firstOf(async (q) => (await q.countType('daily')) > 0) },
  { id: 'first_work', name: 'Gainfully Employed', emoji: '💼', tier: 'common', secret: false,
    description: 'Do your first /work shift.',
    triggers: ['work'],
    check: firstOf(async (q) => (await q.countType('work')) > 0) },
  { id: 'first_pay', name: "It's on Me", emoji: '🤝', tier: 'common', secret: false,
    description: 'Send someone monies with /pay.',
    triggers: ['pay'],
    check: firstOf(async (q) => (await q.countType('pay_sent')) > 0) },
  { id: 'first_bet', name: 'Feeling Lucky', emoji: '🎲', tier: 'common', secret: false,
    description: 'Place your first wager on any game.',
    triggers: ['coinflip', 'slots', 'blackjack'],
    check: firstOf((q) => q.hasAnyWager()) },
  { id: 'first_gift', name: 'Gift Giver', emoji: '🎁', tier: 'common', secret: false,
    description: 'Buy someone a gift from the shop.',
    triggers: ['gift'],
    check: firstOf(async (q) => (await q.countType('gift_sent')) > 0) },
  { id: 'first_bank', name: 'Safety First', emoji: '🏦', tier: 'common', secret: false,
    description: 'Make your first bank deposit.',
    triggers: ['bank'],
    check: firstOf(async (q) => (await q.countType('bank_deposit')) > 0) },
  { id: 'link_account', name: "Summoner's Bind", emoji: '🔗', tier: 'common', secret: false,
    description: 'Link your Riot account.',
    triggers: ['link'],
    check: firstOf((q) => q.hasLink()) },
  { id: 'first_fact', name: 'Lore Keeper', emoji: '🧠', tier: 'common', secret: false,
    description: 'Teach the bot a /fact about someone.',
    triggers: ['fact'],
    check: firstOf(async (q) => (await q.countFactsITaught()) > 0) },
  { id: 'first_wordle', name: 'Wordsmith', emoji: '✏️', tier: 'common', secret: false,
    description: 'Finish a daily wordle — win or lose.',
    triggers: ['wordle'],
    check: firstOf(async (q) => (await q.countWordleGames()) > 0) },

  // --- Wealth & economy ---
  { id: 'worth_1k', name: 'Four Figures', emoji: '💰', tier: 'common', secret: false,
    description: 'Reach a total worth of 1,000 monies (wallet + bank).',
    triggers: ['daily', 'work', 'coinflip', 'slots', 'blackjack', 'raffle_win', 'lolbet'],
    check: worthAtLeast(1_000) },
  { id: 'worth_5k', name: 'Monied Class', emoji: '💎', tier: 'uncommon', secret: false,
    description: 'Reach a total worth of 5,000 monies.',
    triggers: ['daily', 'work', 'coinflip', 'slots', 'blackjack', 'raffle_win', 'lolbet'],
    check: worthAtLeast(5_000) },
  { id: 'worth_10k', name: 'One Percent', emoji: '🎩', tier: 'rare', secret: false,
    description: 'Reach a total worth of 10,000 monies.',
    triggers: ['daily', 'work', 'coinflip', 'slots', 'blackjack', 'raffle_win', 'lolbet'],
    check: worthAtLeast(10_000) },
  { id: 'worth_25k', name: "Dragon's Hoard", emoji: '🐉', tier: 'epic', secret: false,
    description: 'Reach a total worth of 25,000 monies.',
    triggers: ['daily', 'work', 'coinflip', 'slots', 'blackjack', 'raffle_win', 'lolbet'],
    check: worthAtLeast(25_000) },
  { id: 'flat_broke', name: 'Rock Bottom', emoji: '🕳️', tier: 'uncommon', secret: true,
    description: 'Watch your wallet hit exactly 0 after a spend or loss.',
    // Every trigger where the actor's wallet can shrink. Post-action
    // balance rides on the event when the command has it; the sweep (and
    // event-less commands) ask the ledger. A swept wallet sitting at 0
    // still earned its way there — you can't reach 0 without spending.
    triggers: ['pay', 'gift', 'bribe', 'coinflip', 'slots', 'blackjack', 'raffle', 'rob', 'robbed'],
    check: async ({ event, queries }) => {
      const wallet = event?.newBalance ?? (await queries.walletBalance());
      // A user with no ledger at all is "empty", not "broke".
      return wallet === 0 && (event != null || (await queries.countType('welcome')) > 0);
    } },
  { id: 'earned_10k', name: 'Grindset', emoji: '📈', tier: 'rare', secret: false,
    description: 'Earn 10,000 lifetime monies from /daily and /work.',
    triggers: ['daily', 'work'],
    check: async ({ queries }) => (await queries.lifetimeEarned()) >= 10_000 },
  { id: 'daily_streak_7', name: 'Regular', emoji: '☕', tier: 'common', secret: false,
    description: 'Hit a 7-day daily streak.',
    triggers: ['daily'], check: dailyStreakAtLeast(7) },
  { id: 'daily_streak_30', name: 'Devoted', emoji: '🗓️', tier: 'rare', secret: false,
    description: 'Hit a 30-day daily streak.',
    triggers: ['daily'], check: dailyStreakAtLeast(30) },
  { id: 'daily_streak_100', name: 'Institution', emoji: '🏛️', tier: 'legendary', secret: false,
    description: 'Hit a 100-day daily streak.',
    triggers: ['daily'], check: dailyStreakAtLeast(100) },
  { id: 'work_100', name: 'Careerist', emoji: '🧰', tier: 'uncommon', secret: false,
    description: 'Clock 100 lifetime /work shifts.',
    triggers: ['work'],
    check: async ({ queries }) => (await queries.countType('work')) >= 100 },
  { id: 'generous_1k', name: 'Philanthropist', emoji: '💝', tier: 'uncommon', secret: false,
    description: 'Give away 1,000+ monies via /pay and /gift.',
    triggers: ['pay', 'gift'],
    check: async ({ queries }) => (await queries.sumGivenAway()) >= 1_000 },
  { id: 'big_spender', name: 'Diamond Hands', emoji: '💍', tier: 'rare', secret: false,
    description: 'Send someone the diamond gift.',
    triggers: ['gift'],
    check: async ({ event, queries }) =>
      event ? event.item === 'diamond' : queries.hasSentGift('diamond') },
  { id: 'bribe_menu', name: 'Corruption Connoisseur', emoji: '🤫', tier: 'uncommon', secret: false,
    description: 'Pay for all three kinds of /bribe.',
    triggers: ['bribe'],
    check: async ({ queries }) => (await queries.bribeKinds()) >= 3 },

  // --- Banking & loans ---
  { id: 'banked_5k', name: 'Vault Dweller', emoji: '🔐', tier: 'uncommon', secret: false,
    description: 'Hold 5,000+ monies in the bank at once.',
    triggers: ['bank'],
    check: async ({ event, queries }) =>
      (event?.banked ?? (await queries.bankedBalance())) >= 5_000 },
  { id: 'loan_taken', name: "Debtor's Waltz", emoji: '📝', tier: 'common', secret: false,
    description: 'Take out your first loan.',
    triggers: ['loan'],
    check: async ({ event, queries }) =>
      event ? event.action === 'borrow' : queries.hasLoanEver() },
  { id: 'loan_cleared', name: 'Debt Free', emoji: '🎉', tier: 'uncommon', secret: false,
    description: 'Fully repay a loan.',
    // Debt can clear via /loan repay OR via garnishment finishing the job
    // during /daily and /work — both paths mark `cleared`. The sweep
    // reads it straight off the loans table.
    triggers: ['loan', 'daily', 'work'],
    check: async ({ event, queries }) => {
      if (!event) return queries.hasPaidLoan();
      return event.action === 'repay' ? Boolean(event.cleared) : Boolean(event.garnishCleared);
    } },
  { id: 'loan_maxed', name: 'Living on Credit', emoji: '🧾', tier: 'rare', secret: true,
    // Moment-only: the credit limit at borrow time isn't stored, so the
    // sweep can't reconstruct this. Null event → false.
    description: 'Borrow your exact credit limit in one loan.',
    triggers: ['loan'],
    check: ({ event }) => event?.action === 'borrow' && event.amount === event.limit },
  { id: 'garnished_10', name: 'Wage Garnishee', emoji: '😮‍💨', tier: 'uncommon', secret: true,
    description: 'Have earnings garnished toward a loan 10 times.',
    triggers: ['daily', 'work'],
    check: async ({ event, queries }) => {
      if (event && !(event.garnished > 0)) return false; // this claim wasn't garnished
      return (await queries.countType('loan_garnish')) >= 10;
    } },

  // --- Crime ---
  { id: 'first_rob', name: 'Sticky Fingers', emoji: '🦹', tier: 'common', secret: false,
    description: 'Pull off your first successful robbery.',
    triggers: ['rob'],
    check: async ({ event, queries }) =>
      event ? event.success === true : (await queries.countType('rob_steal')) > 0 },
  { id: 'rob_fail', name: 'Caught Red-Handed', emoji: '🚨', tier: 'common', secret: false,
    description: 'Get caught failing a robbery.',
    triggers: ['rob'],
    check: async ({ event, queries }) =>
      event ? event.success === false : (await queries.countType('rob_fail')) > 0 },
  { id: 'robbed', name: 'Victim of Society', emoji: '😤', tier: 'common', secret: false,
    description: 'Get robbed. It happens to the best of us.',
    triggers: ['robbed'],
    check: async ({ event, queries }) =>
      event ? event.success === true : (await queries.countType('rob_victim')) > 0 },
  { id: 'rob_max', name: 'Perfect Heist', emoji: '💼', tier: 'epic', secret: false,
    description: `Steal the maximum ${ROB.maxSteal} monies in a single robbery.`,
    triggers: ['rob'],
    check: async ({ event, queries }) =>
      event
        ? event.success === true && event.amount >= ROB.maxSteal
        : (await queries.maxRobHaul()) >= ROB.maxSteal },
  { id: 'damages_earned', name: 'Insurance Fraud', emoji: '🤕', tier: 'uncommon', secret: true,
    description: 'Collect damages from 5 failed robberies against you.',
    triggers: ['robbed'],
    check: async ({ queries }) => (await queries.countType('rob_damages')) >= 5 },
  { id: 'serial_robber', name: 'Repeat Offender', emoji: '🔁', tier: 'rare', secret: false,
    description: 'Successfully rob the same person 3 times.',
    triggers: ['rob'],
    check: async ({ event, queries }) => {
      if (event) {
        return event.success === true && (await queries.countRobsFrom(event.victim)) >= 3;
      }
      return (await queries.maxRobsFromOneVictim()) >= 3;
    } },
  { id: 'untouchable', name: 'Untouchable', emoji: '🛡️', tier: 'rare', secret: true,
    // Note: only attempts that produced ledger rows count — a failed rob
    // by a robber too broke to pay damages leaves no trace.
    description: 'Survive 5+ robbery attempts without ever being robbed.',
    triggers: ['robbed'],
    check: async ({ queries }) => {
      const v = await queries.victimRecord();
      return v.timesRobbed === 0 && v.attemptsOnMe >= 5;
    } },

  // --- Raffle ---
  { id: 'raffle_win', name: 'Jackpot Adjacent', emoji: '🎟️', tier: 'uncommon', secret: false,
    description: 'Win a raffle.',
    triggers: ['raffle_win'],
    check: async ({ event, queries }) =>
      event ? true : (await queries.countType('raffle_win')) > 0 },
  { id: 'raffle_underdog', name: 'Lottery Miracle', emoji: '🍀', tier: 'epic', secret: false,
    // Moment-only: the ticket share exists only at draw time (entries of
    // past raffles could be reconstructed, but the jar sentinel rows make
    // that more archaeology than it's worth). Null event → false.
    description: 'Win a raffle holding less than 5% of the tickets.',
    triggers: ['raffle_win'],
    check: ({ event }) =>
      (event?.pot ?? 0) > 0 && event.tickets / event.pot < 0.05 },
  { id: 'raffle_whale', name: 'Pot Committed', emoji: '🐋', tier: 'uncommon', secret: false,
    description: 'Put 1,000+ monies into a single raffle.',
    triggers: ['raffle'],
    check: async ({ event, queries }) =>
      event ? (event.userTickets ?? 0) >= 1_000 : (await queries.maxRaffleTickets()) >= 1_000 },

  // --- Blackjack ---
  { id: 'bj_natural', name: 'Natural 21', emoji: '♠️', tier: 'uncommon', secret: false,
    // Moment-only: settle results aren't stored per game outcome type
    // distinguishable from ordinary wins in the ledger. Null event → false.
    description: 'Get dealt a natural blackjack.',
    triggers: ['blackjack'], check: ({ event }) => event?.result === 'blackjack' },
  { id: 'bj_five_card', name: 'Sweating Bullets', emoji: '😅', tier: 'rare', secret: true,
    description: 'Win a hand holding five or more cards.',
    triggers: ['blackjack'],
    check: ({ event }) => event?.result === 'win' && event.playerCards >= 5 },
  { id: 'bj_push_3', name: 'Groundhog Day', emoji: '🔄', tier: 'uncommon', secret: true,
    description: 'Push three blackjack hands in one day.',
    triggers: ['blackjack'],
    check: async ({ event, queries }) => {
      if (event && event.result !== 'push') return false;
      return (await queries.countTodayType('blackjack_push')) >= 3;
    } },
  { id: 'bj_comeback', name: 'Double or Nothing', emoji: '🎯', tier: 'rare', secret: false,
    description: 'Win a blackjack hand of 500+ monies.',
    triggers: ['blackjack'],
    check: ({ event }) =>
      (event?.result === 'win' || event?.result === 'blackjack') && event.bet >= 500 },

  // --- Slots ---
  { id: 'slots_jackpot', name: 'Lucky Sevens', emoji: '7️⃣', tier: 'legendary', secret: false,
    description: 'Hit the triple-seven jackpot on slots.',
    // The reels live in each spin's ledger metadata, so the sweep can
    // find a historical jackpot the event path missed.
    triggers: ['slots'],
    check: async ({ event, queries }) => {
      if (event) {
        return Array.isArray(event.reels) && event.reels.length === 3 &&
          event.reels.every((r) => r === '7️⃣');
      }
      return queries.hasSlotsTriple('7️⃣');
    } },
  { id: 'slots_triple', name: 'Fruit Salad', emoji: '🍒', tier: 'uncommon', secret: false,
    description: 'Land any three of a kind on slots.',
    // Every triple pays 5x or better; pairs top out at 4x (two sevens).
    triggers: ['slots'],
    check: async ({ event, queries }) =>
      event ? (event.multiplier ?? 0) >= 5 : queries.hasSlotsMultiplierAtLeast(5) },
  { id: 'slots_dry_10', name: 'Due Any Spin Now', emoji: '🫠', tier: 'uncommon', secret: true,
    description: 'Lose 10 slots spins in a row.',
    triggers: ['slots'],
    check: async ({ event, queries }) => {
      if (event && (event.net ?? 0) >= 0) return false; // streak must END on a loss
      const nets = await queries.lastNets('slots', 10);
      return nets.length === 10 && nets.every((n) => n < 0);
    } },
  { id: 'slots_100', name: 'Lever Arm', emoji: '💪', tier: 'uncommon', secret: false,
    description: 'Pull the slots lever 100 times.',
    triggers: ['slots'],
    check: async ({ queries }) => (await queries.countType('slots')) >= 100 },

  // --- Coinflip & gambling career ---
  { id: 'flip_streak_5', name: 'Hot Hand', emoji: '🔥', tier: 'rare', secret: false,
    description: 'Win 5 coinflips in a row.',
    triggers: ['coinflip'],
    check: async ({ event, queries }) => {
      if (event && event.won !== true) return false;
      const results = await queries.lastCoinflipResults(5);
      return results.length === 5 && results.every(Boolean);
    } },
  { id: 'flip_cold_5', name: 'Statistically Cursed', emoji: '🧊', tier: 'rare', secret: true,
    description: 'Lose 5 coinflips in a row.',
    triggers: ['coinflip'],
    check: async ({ event, queries }) => {
      if (event && event.won !== false) return false;
      const results = await queries.lastCoinflipResults(5);
      return results.length === 5 && results.every((w) => w === false);
    } },
  { id: 'gambler_net_5k', name: 'The House Fears You', emoji: '🎰', tier: 'epic', secret: false,
    description: 'Reach +5,000 lifetime gambling profit.',
    triggers: ['coinflip', 'slots', 'blackjack', 'lolbet'],
    check: async ({ queries }) => (await queries.gamblingNet()) >= 5_000 },
  { id: 'house_wins', name: 'Pillar of the Economy', emoji: '🏚️', tier: 'rare', secret: true,
    description: 'Reach −5,000 lifetime gambling losses.',
    triggers: ['coinflip', 'slots', 'blackjack', 'lolbet'],
    check: async ({ queries }) => (await queries.gamblingNet()) <= -5_000 },

  // --- Wordle ---
  { id: 'wordle_hole_in_one', name: 'Clairvoyant', emoji: '🔮', tier: 'legendary', secret: false,
    description: 'Solve the wordle on your first guess.',
    triggers: ['wordle'], check: wordleSolveIn(1) },
  { id: 'wordle_in_two', name: 'Mind Reader', emoji: '🧙', tier: 'epic', secret: false,
    description: 'Solve the wordle in two guesses.',
    triggers: ['wordle'], check: wordleSolveIn(2) },
  { id: 'wordle_clutch', name: 'Photo Finish', emoji: '📸', tier: 'uncommon', secret: false,
    description: 'Solve the wordle on your very last guess.',
    triggers: ['wordle'], check: wordleSolveIn(6) },
  { id: 'wordle_fail', name: 'Vocabulary Victim', emoji: '📖', tier: 'common', secret: true,
    description: 'Run out of wordle guesses. The word was probably fake anyway.',
    triggers: ['wordle'],
    check: async ({ event, queries }) =>
      event ? event.solved === false : queries.hasWordleFail() },
  { id: 'wordle_streak_7', name: 'Daily Ritual', emoji: '🕯️', tier: 'uncommon', secret: false,
    description: 'Hit a 7-day wordle solve streak.',
    triggers: ['wordle'], check: wordleStreakAtLeast(7) },
  { id: 'wordle_streak_30', name: 'Lexicon Legend', emoji: '📚', tier: 'epic', secret: false,
    description: 'Hit a 30-day wordle solve streak.',
    triggers: ['wordle'], check: wordleStreakAtLeast(30) },
  { id: 'wordle_50', name: 'Cruciverbalist', emoji: '🧩', tier: 'rare', secret: false,
    description: 'Solve 50 wordles.',
    triggers: ['wordle'],
    check: async ({ event, queries }) => {
      if (event && !event.solved) return false; // only a solve can tip the count
      return (await queries.countWordleSolves()) >= 50;
    } },

  // --- League of Legends: recorded matches ---
  // Row checks read the event when the poller hands them a fresh match;
  // the sweep re-derives them from lol_match_history.
  { id: 'lol_deathless', name: 'Untouched', emoji: '😇', tier: 'rare', secret: false,
    description: 'Finish a full game with zero deaths.',
    triggers: ['lol_match'],
    check: async ({ event, queries }) =>
      event
        ? event.deaths === 0 && event.durationSec >= MIN_REAL_GAME_SEC
        : queries.hasLolGameWhere({ maxDeaths: 0, minDurationSec: MIN_REAL_GAME_SEC }) },
  { id: 'lol_20kills', name: 'Smurf Behavior', emoji: '🗡️', tier: 'rare', secret: false,
    description: 'Rack up 20+ kills in a single game.',
    triggers: ['lol_match'],
    check: async ({ event, queries }) =>
      event ? (event.kills ?? 0) >= 20 : queries.hasLolGameWhere({ minKills: 20 }) },
  { id: 'lol_0_10', name: 'Hall of Shame Inductee', emoji: '💀', tier: 'rare', secret: true,
    description: 'Go 0 kills and 10+ deaths in one game. Immortalized.',
    triggers: ['lol_match'],
    check: async ({ event, queries }) =>
      event
        ? event.kills === 0 && event.deaths >= 10
        : queries.hasLolGameWhere({ maxKills: 0, minDeaths: 10 }) },
  { id: 'lol_win_streak_5', name: 'On a Heater', emoji: '🔥', tier: 'rare', secret: false,
    description: 'Win 5 recorded games in a row.',
    triggers: ['lol_match'],
    check: async ({ event, queries }) => {
      if (event && event.win !== true) return false;
      const results = await queries.lolLastResults(5);
      return results.length === 5 && results.every(Boolean);
    } },
  { id: 'lol_loss_streak_5', name: "It's the Team", emoji: '🙃', tier: 'rare', secret: true,
    description: 'Lose 5 recorded games in a row.',
    triggers: ['lol_match'],
    check: async ({ event, queries }) => {
      if (event && event.win !== false) return false;
      const results = await queries.lolLastResults(5);
      return results.length === 5 && results.every((w) => w === false);
    } },
  { id: 'lol_100_games', name: 'Grinding the Rift', emoji: '🏔️', tier: 'rare', secret: false,
    description: 'Record 100 tracked matches.',
    triggers: ['lol_match'],
    check: async ({ queries }) => (await queries.lolGameCount()) >= 100 },
  { id: 'lol_aram_50', name: 'Bridge Troll', emoji: '🌉', tier: 'rare', secret: false,
    description: 'Play 50 recorded ARAM games.',
    triggers: ['lol_match'],
    check: async ({ queries }) => (await queries.lolQueueCount(450)) >= 50 },
  // Phase-4 highlight stats. Only matches recorded after the migration
  // carry real values (older rows default 0/false), so these can't be
  // earned retroactively for pre-migration games.
  { id: 'lol_pentakill', name: 'Pentakill!', emoji: '⚔️', tier: 'legendary', secret: false,
    description: 'Score a pentakill in a recorded game.',
    triggers: ['lol_match'],
    check: async ({ event, queries }) =>
      event ? (event.pentaKills ?? 0) >= 1 : queries.hasLolGameWhere({ minPentas: 1 }) },
  { id: 'lol_first_blood', name: 'First Blood', emoji: '🩸', tier: 'uncommon', secret: false,
    description: 'Draw first blood in a recorded game.',
    triggers: ['lol_match'],
    check: async ({ event, queries }) =>
      event ? event.firstBlood === true : queries.hasLolGameWhere({ firstBlood: true }) },
  { id: 'lol_cs_300', name: 'Farming Simulator', emoji: '🌾', tier: 'rare', secret: false,
    description: 'Farm 300+ cs in a single game.',
    triggers: ['lol_match'],
    check: async ({ event, queries }) =>
      event ? (event.cs ?? 0) >= 300 : queries.hasLolGameWhere({ minCs: 300 }) },

  // --- League of Legends: match betting ---
  { id: 'bet_first_win', name: 'Oracle', emoji: '🔮', tier: 'common', secret: false,
    description: 'Win your first match bet.',
    triggers: ['lolbet'],
    check: async ({ event, queries }) =>
      event ? event.correct === true : queries.hasCorrectBet() },
  { id: 'bet_streak_5', name: 'Sports Analyst', emoji: '📊', tier: 'epic', secret: false,
    description: 'Call 5 match bets correctly in a row.',
    triggers: ['lolbet'],
    check: async ({ event, queries }) => {
      if (event && event.correct !== true) return false;
      const results = await queries.lastBetResults(5);
      return results.length === 5 && results.every(Boolean);
    } },
  { id: 'bet_traitor', name: 'Et Tu?', emoji: '🗡️', tier: 'rare', secret: true,
    description: 'Bet AGAINST your own squad — and be right.',
    triggers: ['lolbet'],
    check: async ({ event, queries }) =>
      event ? event.correct === true && event.onWin === false : queries.hasTraitorWin() },
  { id: 'bet_max_win', name: 'High Roller', emoji: '💸', tier: 'rare', secret: false,
    description: `Win a max-size (${LOL.maxBet}) match bet.`,
    triggers: ['lolbet'],
    check: async ({ event, queries }) =>
      event
        ? event.correct === true && event.amount >= LOL.maxBet
        : (await queries.maxCorrectBet()) >= LOL.maxBet },

  // --- Meta & social ---
  { id: 'facts_about_you_5', name: 'Local Legend', emoji: '📛', tier: 'uncommon', secret: false,
    description: 'Have 5 facts on record about you.',
    triggers: ['fact_about'],
    check: async ({ queries }) => (await queries.countFactsAboutMe()) >= 5 },
  { id: 'poll_starter', name: 'Democracy Enjoyer', emoji: '🗳️', tier: 'common', secret: false,
    // Moment-only: polls leave no database trace, so only the event can
    // grant this — and the sweep must never (null event → false).
    description: 'Start a poll.',
    triggers: ['poll'], check: ({ event }) => event != null },
  { id: 'warned', name: 'Seen the Mod Side', emoji: '⚠️', tier: 'common', secret: true,
    description: 'Receive a warning from a moderator.',
    triggers: ['warn'],
    check: async ({ event, queries }) => (event ? true : queries.hasWarning()) },
  { id: 'completionist_25', name: 'Trophy Hunter', emoji: '🏆', tier: 'epic', secret: false,
    description: 'Earn 25 achievements.',
    triggers: ['meta'], check: achievementsAtLeast(25) },
  { id: 'completionist_50', name: 'Completionist', emoji: '👑', tier: 'legendary', secret: false,
    description: 'Earn 50 achievements.',
    triggers: ['meta'], check: achievementsAtLeast(50) },
];
