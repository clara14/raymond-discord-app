// ============================================================
// achievements.js (data) — The achievement CATALOG.
// Adding an achievement = adding an entry here. Awards are
// stored by id in user_achievements, so the catalog can grow
// forever without schema changes. Phases 1+2 of
// docs/ACHIEVEMENTS_SPEC.md: the framework set plus the full
// event-carried catalog.
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

// Reusable check builders for the threshold families, so the catalog
// entries below stay one-liners.
const worthAtLeast = (n) => async ({ queries }) => (await queries.totalWorth()) >= n;
const dailyStreakAtLeast = (n) => ({ event }) => (event?.streak ?? 0) >= n;
const wordleStreakAtLeast = (n) => ({ event }) => Boolean(event?.solved) && (event?.streak ?? 0) >= n;
const achievementsAtLeast = (n) => async ({ queries }) => (await queries.countAchievements()) >= n;

/**
 * Definition shape (see docs/ACHIEVEMENTS_SPEC.md):
 *   id          — stable snake_case key stored in the database
 *   name/emoji  — display identity
 *   description — announcements + the goal line in /achievements locked
 *   tier        — key into TIERS
 *   secret      — hidden in the locked list until earned
 *   triggers    — which events cause this check to run
 *   check(ctx)  — ctx = { event, queries }; sync or async, side-effect
 *                 free. Event-only "first time" checks return true — the
 *                 awards table's composite PK supplies the "first".
 *                 Query-backed checks must tolerate event = null so the
 *                 phase-3 sweep can re-run them from data alone.
 */
export const ACHIEVEMENTS = [
  // --- Getting started (one per core feature; all common, none secret) ---
  { id: 'first_daily', name: 'Early Bird', emoji: '🌅', tier: 'common', secret: false,
    description: 'Claim your first /daily.',
    triggers: ['daily'], check: () => true },
  { id: 'first_work', name: 'Gainfully Employed', emoji: '💼', tier: 'common', secret: false,
    description: 'Do your first /work shift.',
    triggers: ['work'], check: () => true },
  { id: 'first_pay', name: "It's on Me", emoji: '🤝', tier: 'common', secret: false,
    description: 'Send someone monies with /pay.',
    triggers: ['pay'], check: () => true },
  { id: 'first_bet', name: 'Feeling Lucky', emoji: '🎲', tier: 'common', secret: false,
    description: 'Place your first wager on any game.',
    triggers: ['coinflip', 'slots', 'blackjack'], check: () => true },
  { id: 'first_gift', name: 'Gift Giver', emoji: '🎁', tier: 'common', secret: false,
    description: 'Buy someone a gift from the shop.',
    triggers: ['gift'], check: () => true },
  { id: 'first_bank', name: 'Safety First', emoji: '🏦', tier: 'common', secret: false,
    description: 'Make your first bank deposit.',
    triggers: ['bank'], check: () => true },
  { id: 'link_account', name: "Summoner's Bind", emoji: '🔗', tier: 'common', secret: false,
    description: 'Link your Riot account.',
    triggers: ['link'], check: () => true },
  { id: 'first_fact', name: 'Lore Keeper', emoji: '🧠', tier: 'common', secret: false,
    description: 'Teach the bot a /fact about someone.',
    triggers: ['fact'], check: () => true },
  { id: 'first_wordle', name: 'Wordsmith', emoji: '✏️', tier: 'common', secret: false,
    description: 'Finish a daily wordle — win or lose.',
    triggers: ['wordle'], check: () => true },

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
    // Every trigger where the actor's wallet can shrink. The event's
    // post-action balance is used when the command provides it; otherwise
    // one targeted query answers it.
    triggers: ['pay', 'gift', 'bribe', 'coinflip', 'slots', 'blackjack', 'raffle', 'rob', 'robbed'],
    check: async ({ event, queries }) =>
      (event?.newBalance ?? (await queries.walletBalance())) === 0 },
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
    triggers: ['gift'], check: ({ event }) => event?.item === 'diamond' },
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
    triggers: ['loan'], check: ({ event }) => event?.action === 'borrow' },
  { id: 'loan_cleared', name: 'Debt Free', emoji: '🎉', tier: 'uncommon', secret: false,
    description: 'Fully repay a loan.',
    // Debt can clear via /loan repay OR via garnishment finishing the job
    // during /daily and /work — both paths mark `cleared`.
    triggers: ['loan', 'daily', 'work'],
    check: ({ event }) =>
      event?.action === 'repay' ? Boolean(event.cleared) : Boolean(event?.garnishCleared) },
  { id: 'loan_maxed', name: 'Living on Credit', emoji: '🧾', tier: 'rare', secret: true,
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
    triggers: ['rob'], check: ({ event }) => event?.success === true },
  { id: 'rob_fail', name: 'Caught Red-Handed', emoji: '🚨', tier: 'common', secret: false,
    description: 'Get caught failing a robbery.',
    triggers: ['rob'], check: ({ event }) => event?.success === false },
  { id: 'robbed', name: 'Victim of Society', emoji: '😤', tier: 'common', secret: false,
    description: 'Get robbed. It happens to the best of us.',
    triggers: ['robbed'], check: ({ event }) => event?.success === true },
  { id: 'rob_max', name: 'Perfect Heist', emoji: '💼', tier: 'epic', secret: false,
    description: `Steal the maximum ${ROB.maxSteal} monies in a single robbery.`,
    triggers: ['rob'],
    check: ({ event }) => event?.success === true && event.amount >= ROB.maxSteal },
  { id: 'damages_earned', name: 'Insurance Fraud', emoji: '🤕', tier: 'uncommon', secret: true,
    description: 'Collect damages from 5 failed robberies against you.',
    triggers: ['robbed'],
    check: async ({ queries }) => (await queries.countType('rob_damages')) >= 5 },
  { id: 'serial_robber', name: 'Repeat Offender', emoji: '🔁', tier: 'rare', secret: false,
    description: 'Successfully rob the same person 3 times.',
    triggers: ['rob'],
    check: async ({ event, queries }) =>
      event?.success === true && (await queries.countRobsFrom(event.victim)) >= 3 },
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
    triggers: ['raffle_win'], check: () => true },
  { id: 'raffle_underdog', name: 'Lottery Miracle', emoji: '🍀', tier: 'epic', secret: false,
    description: 'Win a raffle holding less than 5% of the tickets.',
    triggers: ['raffle_win'],
    check: ({ event }) =>
      (event?.pot ?? 0) > 0 && event.tickets / event.pot < 0.05 },
  { id: 'raffle_whale', name: 'Pot Committed', emoji: '🐋', tier: 'uncommon', secret: false,
    description: 'Put 1,000+ monies into a single raffle.',
    triggers: ['raffle'], check: ({ event }) => (event?.userTickets ?? 0) >= 1_000 },

  // --- Blackjack ---
  { id: 'bj_natural', name: 'Natural 21', emoji: '♠️', tier: 'uncommon', secret: false,
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
    triggers: ['slots'],
    check: ({ event }) =>
      Array.isArray(event?.reels) && event.reels.length === 3 && event.reels.every((r) => r === '7️⃣') },
  { id: 'slots_triple', name: 'Fruit Salad', emoji: '🍒', tier: 'uncommon', secret: false,
    description: 'Land any three of a kind on slots.',
    // Every triple pays 5x or better; pairs top out at 4x (two sevens).
    triggers: ['slots'], check: ({ event }) => (event?.multiplier ?? 0) >= 5 },
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
    triggers: ['wordle'],
    check: ({ event }) => Boolean(event?.solved) && event.attempts === 1 },
  { id: 'wordle_in_two', name: 'Mind Reader', emoji: '🧙', tier: 'epic', secret: false,
    description: 'Solve the wordle in two guesses.',
    triggers: ['wordle'],
    check: ({ event }) => Boolean(event?.solved) && event.attempts === 2 },
  { id: 'wordle_clutch', name: 'Photo Finish', emoji: '📸', tier: 'uncommon', secret: false,
    description: 'Solve the wordle on your very last guess.',
    triggers: ['wordle'],
    check: ({ event }) => Boolean(event?.solved) && event.attempts === 6 },
  { id: 'wordle_fail', name: 'Vocabulary Victim', emoji: '📖', tier: 'common', secret: true,
    description: 'Run out of wordle guesses. The word was probably fake anyway.',
    triggers: ['wordle'], check: ({ event }) => event?.solved === false },
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
  { id: 'lol_deathless', name: 'Untouched', emoji: '😇', tier: 'rare', secret: false,
    description: 'Finish a full game with zero deaths.',
    triggers: ['lol_match'],
    check: ({ event }) =>
      event != null && event.deaths === 0 && event.durationSec >= MIN_REAL_GAME_SEC },
  { id: 'lol_20kills', name: 'Smurf Behavior', emoji: '🗡️', tier: 'rare', secret: false,
    description: 'Rack up 20+ kills in a single game.',
    triggers: ['lol_match'], check: ({ event }) => (event?.kills ?? 0) >= 20 },
  { id: 'lol_0_10', name: 'Hall of Shame Inductee', emoji: '💀', tier: 'rare', secret: true,
    description: 'Go 0 kills and 10+ deaths in one game. Immortalized.',
    triggers: ['lol_match'],
    check: ({ event }) => event != null && event.kills === 0 && event.deaths >= 10 },
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

  // --- League of Legends: match betting ---
  { id: 'bet_first_win', name: 'Oracle', emoji: '🔮', tier: 'common', secret: false,
    description: 'Win your first match bet.',
    triggers: ['lolbet'], check: ({ event }) => event?.correct === true },
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
    check: ({ event }) => event?.correct === true && event.onWin === false },
  { id: 'bet_max_win', name: 'High Roller', emoji: '💸', tier: 'rare', secret: false,
    description: `Win a max-size (${LOL.maxBet}) match bet.`,
    triggers: ['lolbet'],
    check: ({ event }) => event?.correct === true && event.amount >= LOL.maxBet },

  // --- Meta & social ---
  { id: 'facts_about_you_5', name: 'Local Legend', emoji: '📛', tier: 'uncommon', secret: false,
    description: 'Have 5 facts on record about you.',
    triggers: ['fact_about'],
    check: async ({ queries }) => (await queries.countFactsAboutMe()) >= 5 },
  { id: 'poll_starter', name: 'Democracy Enjoyer', emoji: '🗳️', tier: 'common', secret: false,
    description: 'Start a poll.',
    triggers: ['poll'], check: () => true },
  { id: 'warned', name: 'Seen the Mod Side', emoji: '⚠️', tier: 'common', secret: true,
    description: 'Receive a warning from a moderator.',
    triggers: ['warn'], check: () => true },
  { id: 'completionist_25', name: 'Trophy Hunter', emoji: '🏆', tier: 'epic', secret: false,
    description: 'Earn 25 achievements.',
    triggers: ['meta'], check: achievementsAtLeast(25) },
  { id: 'completionist_50', name: 'Completionist', emoji: '👑', tier: 'legendary', secret: false,
    description: 'Earn 50 achievements.',
    triggers: ['meta'], check: achievementsAtLeast(50) },
];
