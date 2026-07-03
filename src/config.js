// ============================================================
// config.js — Central place for tunable economy settings.
// Change values here rather than hunting through command files.
// ============================================================

// The currency's display identity. Rename these to fit your server's
// vibe — every command reads from here, so one edit changes it everywhere.
// "monies" is used regardless of amount, so singular and plural match.
export const CURRENCY = {
  name: 'monies',    // used for all amounts
  singular: 'monies', // same word even when the amount is 1
  symbol: '🪙',       // emoji shown next to amounts
};

// One-time bonus granted the first time the bot sees a user in a guild.
// This is written as a ledger transaction (not a stored balance), so the
// audit trail stays complete — see ensureWelcomeBonus() in economy.js.
export const WELCOME_BONUS = 500;

// Tuning knobs for the /work command.
export const WORK = {
  min: 25,          // smallest possible payout
  max: 75,          // largest possible payout
  cooldownSec: 3600, // how long before /work can be used again (1 hour)
};

// Raffle settings. Tickets are 1:1 with monies contributed, so odds scale
// with how much you tip in. minEntry is the smallest allowed contribution.
export const RAFFLE = {
  minEntry: 1,
};

// Blackjack settings. minBet is the smallest wager; staleMinutes is how long
// an unfinished game can sit before it's considered abandoned (and the bet
// forfeited), which prevents a lost game message from blocking new games.
export const BLACKJACK = {
  minBet: 1,
  staleMinutes: 30,
};

// Loan settings. Interest accrues continuously at dailyRatePct per day
// (simple interest, computed at read time from the loan's age). While in
// debt, garnishPct of each /daily and /work payout goes to the loan.
export const LOAN = {
  dailyRatePct: 2,   // 2% of principal per day
  garnishPct: 25,    // % of earnings auto-applied to debt
  minLoan: 50,       // smallest loan you can take
  baseCap: 250,      // everyone can borrow at least this much
  maxCap: 5000,      // absolute borrowing ceiling
  earnFactor: 0.5,   // credit limit grows by this fraction of lifetime earnings
};

/**
 * Pure function: how much is owed on a loan right now.
 * Simple interest: principal grows by dailyRatePct per day of age (fractional
 * days count), then payments are subtracted. Ceil rounds in the bank's favor;
 * never returns less than 0.
 */
export function computeOwed(principal, dailyRatePct, ageDays, repaid) {
  const grown = principal * (1 + (dailyRatePct / 100) * ageDays);
  return Math.max(0, Math.ceil(grown) - repaid);
}

/**
 * Pure function: a user's borrowing cap from their lifetime earnings
 * (the creditworthiness rule). Base + earnFactor × earned, capped at maxCap.
 */
export function computeCreditLimit(lifetimeEarned) {
  const scaled = LOAN.baseCap + Math.floor(lifetimeEarned * LOAN.earnFactor);
  return Math.min(scaled, LOAN.maxCap);
}

// Gift catalog for /gift. The sender pays `price`; the recipient receives
// price minus the shop fee — the fee is burned (removed from circulation),
// which quietly fights inflation. Add items freely.
export const GIFT = {
  feePct: 20, // % of the price burned as the "gift shop fee"
  items: [
    { id: 'beer', name: 'a cold beer', emoji: '🍺', price: 50 },
    { id: 'coffee', name: 'a fancy coffee', emoji: '☕', price: 30 },
    { id: 'flowers', name: 'a bouquet of flowers', emoji: '💐', price: 100 },
    { id: 'pizza', name: 'a whole pizza', emoji: '🍕', price: 150 },
    { id: 'trophy', name: 'a shiny trophy', emoji: '🏆', price: 500 },
    { id: 'diamond', name: 'an actual diamond', emoji: '💎', price: 2000 },
  ],
};

// Pure helper: what the recipient nets from a gift after the burn fee.
export function giftNet(price) {
  return price - Math.floor(price * (GIFT.feePct / 100));
}

// Bribe menu for /bribe. Every bribe is fully burned — the bot "pockets" it.
export const BRIBE = {
  compliment: { price: 50 },
  roast: { price: 75 },
  fortune: { price: 25 },
};

// Casual chat settings (the bot replies when @mentioned).
export const CHAT = {
  model: 'claude-haiku-4-5', // fast + cheapest; swap for a smarter model anytime
  maxTokens: 350,            // cap on reply length (cost + Discord-friendly)
  historyLimit: 24,          // how many recent messages of context to send
  historyMaxAgeMin: 180,     // ignore context older than this (conversation "expires")
  cooldownSec: 10,           // per-user rate limit between chat replies
  maxToolRounds: 3,          // how many tool-use round trips one reply may take
  // The bot's personality. Edit freely — this is the fun knob.
  systemPrompt:
    'You are a snarky, sarcastic Discord bot hanging out in a small server of friends. ' +
    'You run the server\'s economy of a currency called "monies" (commands like /daily, ' +
    '/work, /blackjack, /raffle, /loan, /rob, /bank) and the League of Legends match ' +
    'announcements and betting. Be witty, a little smug, and playfully roast ' +
    'people, but never be genuinely mean, and keep it friendly underneath. ' +
    'Keep replies short — a sentence or three, like a real chat message. ' +
    'Messages are prefixed with the sender\'s username so you can tell people apart; ' +
    'don\'t prefix your own replies with anything. ' +
    'You have tools to look up members\' REAL economy profiles, League stats, and the ' +
    'leaderboard — use them when someone\'s wealth, debt, gambling record, or League ' +
    'performance is relevant, and roast with the actual numbers.',
};

/**
 * Formats a number of seconds into a short human string like "42m 15s".
 * Used to tell a user how long is left on a cooldown.
 */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds)); // never show negative time
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  if (minutes > 0 && seconds > 0) return `${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

// Tuning knobs for the /daily reward.
export const DAILY = {
  base: 100,        // credits granted for a normal daily claim
  streakBonus: 25,  // extra credits per consecutive day
  maxBonusDays: 7,  // cap so long streaks don't pay out infinitely
};

/**
 * Pure function: how many credits a daily claim is worth for a given streak.
 * Kept separate (and side-effect free) so it's easy to reason about and test.
 * Streak 1 = base only; each additional consecutive day adds streakBonus,
 * up to maxBonusDays.
 */
export function computeDailyReward(streak) {
  // Clamp the bonus days between 0 and the cap.
  const bonusDays = Math.min(Math.max(streak - 1, 0), DAILY.maxBonusDays);
  return DAILY.base + bonusDays * DAILY.streakBonus;
}

/**
 * Formats a raw number into a friendly currency string, e.g. "🪙 1,234 credits".
 * toLocaleString() adds thousands separators; we pick singular/plural correctly.
 */
export function formatCurrency(amount) {
  const word = amount === 1 ? CURRENCY.singular : CURRENCY.name;
  return `${CURRENCY.symbol} ${amount.toLocaleString()} ${word}`;
}

// Robbery settings for /rob. Robbers can only steal from a victim's WALLET
// (banked monies are safe — that's the whole point of /bank deposit).
export const ROB = {
  cooldownSec: 7200,      // robber can attempt once per 2 hours
  victimShieldSec: 3600,  // a victim can't be targeted again for 1 hour
  successPct: 40,         // chance the robbery succeeds
  stealMinPct: 10,        // success steals a random 10–30% of the victim's wallet...
  stealMaxPct: 30,
  maxSteal: 500,          // ...capped so whales can't be wiped out in one hit
  failPenaltyPct: 15,     // failure costs the robber 15% of their own wallet...
  minPenalty: 25,         // ...but at least this much (if they have it)
  minVictimWallet: 50,    // wallets below this aren't worth robbing
};

/**
 * Pure function: how much a successful robbery steals, given the victim's
 * wallet and a roll in [0,1). A random percentage between stealMinPct and
 * stealMaxPct, floored, capped at maxSteal.
 */
export function computeSteal(victimWallet, roll) {
  const pct = ROB.stealMinPct + roll * (ROB.stealMaxPct - ROB.stealMinPct);
  return Math.min(Math.floor(victimWallet * (pct / 100)), ROB.maxSteal);
}

/**
 * Pure function: the fine for a failed robbery — failPenaltyPct of the
 * robber's wallet, at least minPenalty, but never more than they have.
 */
export function computePenalty(robberWallet) {
  const pct = Math.floor(robberWallet * (ROB.failPenaltyPct / 100));
  return Math.min(Math.max(pct, ROB.minPenalty), robberWallet);
}

// League of Legends match announcements + betting.
export const LOL = {
  pollIntervalSec: 120,   // how often the poller checks linked accounts
  betWindowMin: 8,        // betting stays open this long after announcement
  minBet: 10,             // smallest wager on a match
  maxBet: 1000,           // largest wager on a match
  resultRetryMax: 15,     // poll cycles to hunt for a finished match's result
                          // before voiding the match and refunding all bets
  historyEveryCycles: 5,  // sync match history every Nth poll cycle (~10 min)
  historyFetchCount: 5,   // how many recent match ids to check per sync
  backfillCount: 10,      // matches pulled when an account is first linked
};
