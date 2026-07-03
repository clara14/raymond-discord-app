// ============================================================
// achievements.js (data) — The achievement CATALOG.
// Adding an achievement = adding an entry here. Awards are
// stored by id in user_achievements, so the catalog can grow
// forever without schema changes. Per docs/ACHIEVEMENTS_SPEC.md
// this is phase 1: the framework + the "getting started" set.
// ============================================================

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

// Every trigger a command (or task) may fire. The contract test checks
// each catalog entry subscribes only to triggers listed here, so a typo
// in a definition fails the suite instead of silently never firing.
// Phase 2 will extend this as more of the catalog gets wired in.
export const TRIGGERS = new Set([
  'daily',      // /daily claimed
  'work',       // /work payout landed
  'pay',        // /pay transfer succeeded
  'gift',       // /gift delivered
  'bank',       // /bank deposit succeeded (deposits only — that's the milestone)
  'coinflip',   // coinflip resolved
  'slots',      // slots spin resolved
  'blackjack',  // blackjack game FINISHED (not started — resolution is the event)
  'wordle',     // wordle finished (solved or failed), not per-guess
  'link',       // Riot account linked
  'fact',       // /fact add succeeded
]);

/**
 * Definition shape (see docs/ACHIEVEMENTS_SPEC.md):
 *   id          — stable snake_case key stored in the database
 *   name/emoji  — display identity
 *   description — shown in announcements and as the goal in /achievements locked
 *   tier        — key into TIERS
 *   secret      — hidden in the locked list until earned
 *   triggers    — which events cause this check to run
 *   check(ctx)  — ctx = { event, queries }; may be sync or async. Must be
 *                 side-effect free: it answers "qualifies?", the runner
 *                 does the awarding. Event-only "first time" checks just
 *                 return true — the awards table's composite PK is what
 *                 makes "first" mean first.
 */
export const ACHIEVEMENTS = [
  // --- Getting started (one per core feature; all common, none secret) ---
  {
    id: 'first_daily',
    name: 'Early Bird',
    emoji: '🌅',
    description: 'Claim your first /daily.',
    tier: 'common',
    secret: false,
    triggers: ['daily'],
    check: () => true,
  },
  {
    id: 'first_work',
    name: 'Gainfully Employed',
    emoji: '💼',
    description: 'Do your first /work shift.',
    tier: 'common',
    secret: false,
    triggers: ['work'],
    check: () => true,
  },
  {
    id: 'first_pay',
    name: "It's on Me",
    emoji: '🤝',
    description: 'Send someone monies with /pay.',
    tier: 'common',
    secret: false,
    triggers: ['pay'],
    check: () => true,
  },
  {
    id: 'first_bet',
    name: 'Feeling Lucky',
    emoji: '🎲',
    description: 'Place your first wager on any game.',
    tier: 'common',
    secret: false,
    // Any of the three wagering games counts (wordle pays but takes no bet).
    triggers: ['coinflip', 'slots', 'blackjack'],
    check: () => true,
  },
  {
    id: 'first_gift',
    name: 'Gift Giver',
    emoji: '🎁',
    description: 'Buy someone a gift from the shop.',
    tier: 'common',
    secret: false,
    triggers: ['gift'],
    check: () => true,
  },
  {
    id: 'first_bank',
    name: 'Safety First',
    emoji: '🏦',
    description: 'Make your first bank deposit.',
    tier: 'common',
    secret: false,
    triggers: ['bank'],
    check: () => true,
  },
  {
    id: 'link_account',
    name: "Summoner's Bind",
    emoji: '🔗',
    description: 'Link your Riot account.',
    tier: 'common',
    secret: false,
    triggers: ['link'],
    check: () => true,
  },
  {
    id: 'first_fact',
    name: 'Lore Keeper',
    emoji: '🧠',
    description: 'Teach the bot a /fact about someone.',
    tier: 'common',
    secret: false,
    triggers: ['fact'],
    check: () => true,
  },
  {
    id: 'first_wordle',
    name: 'Wordsmith',
    emoji: '✏️',
    description: 'Finish a daily wordle — win or lose.',
    tier: 'common',
    secret: false,
    triggers: ['wordle'],
    check: () => true,
  },
];
