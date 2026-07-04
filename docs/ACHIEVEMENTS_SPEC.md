# Achievements System — Design Spec

> **Status:** Phases 1–3 shipped 2026-07-03 (framework, full catalog of
> 72, all wiring, hourly self-healing sweep with retroactive backfill on
> first run, announce_channel_id migration with lol_channel_id fallback).
> Phase 4 (lol_match_history stat columns) pending. Moment-only awards
> the sweep can never grant: poll_starter, loan_maxed, raffle_underdog,
> bj_natural, bj_five_card, bj_comeback. No command sets
> announce_channel_id yet — the LoL-channel fallback covers it.

Goal: a trophy system derived (almost) entirely from data the bot ALREADY
records — the ledger, match history, wordle boards, blackjack games,
streak tables — plus a framework that makes every future feature cheap to
instrument. Written in Chat, to be implemented in Code. Follow all
CLAUDE.md conventions (comments, monies, test-before-done).

---

## 1. Architecture

### Catalog lives in code, awards live in the database

- `src/data/achievements.js` — the catalog: an array of achievement
  definitions. Adding an achievement = adding an entry here (+ a check
  function). No schema change ever needed for new achievements.
- New table (additive, in initDatabase):

```sql
CREATE TABLE IF NOT EXISTS user_achievements (
  guild_id       TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  achievement_id TEXT NOT NULL,          -- catalog id, e.g. 'slots_jackpot'
  earned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id, achievement_id)
);
```

Awarding is idempotent by construction:
`INSERT ... ON CONFLICT DO NOTHING RETURNING achievement_id` — a returned
row means "newly earned, announce it"; nothing returned means already had
it. Same pattern as the welcome bonus.

### Definition shape

```js
{
  id: 'slots_jackpot',
  name: 'Lucky Sevens',
  emoji: '7️⃣',
  description: 'Hit the triple-seven jackpot on slots.',
  tier: 'legendary',        // common | uncommon | rare | epic | legendary
  secret: false,            // secret = hidden in lists until earned
  triggers: ['slots'],      // which events cause this check to run
  check: async (ctx) => ctx.event.metadata?.reels?.every(r => r === '7️⃣'),
}
```

### Detection: event-driven first, sweep second

**Event-driven (primary).** A single entry point:
`checkAchievements(guildId, userId, trigger, event)` — called AFTER a
relevant action commits (never inside the money transaction; achievements
must never roll back money). It runs only the checks subscribed to that
trigger. `event` carries the just-happened facts (bet, reels, result,
attempts, …) so most checks are zero-query; the rest run one targeted
aggregate.

Wire-in points (small, explicit calls — do NOT hide this in insertLedger;
money plumbing stays pure):
- economy commands after success: daily, work, pay, gift, bribe, bank,
  loan, rob, raffle
- game commands after resolution: coinflip, slots, blackjack (on finish),
  wordle (on solve/fail)
- lol: link command; matchPoller after settlement (bets) and after
  history sync (match-based checks, batched per player)
- chat: fact add

**Sweep (secondary).** A slow periodic task (reuse the poller's
self-rescheduling setTimeout pattern; hourly is plenty) re-checks
aggregate/streak achievements per active user. This catches anything the
event path missed (e.g. awards added retroactively to a new achievement)
and makes the system self-healing. Sweep checks are the same check
functions run with `event = null` — every aggregate check must therefore
work from queries alone when `event` is absent.

### Announcements

- Earned via a command interaction → follow-up embed in that channel:
  "🏆 **Cesar** earned **Lucky Sevens** 7️⃣ — Hit the triple-seven jackpot!"
- Earned via background settlement/sweep → post to the configured
  announcements channel (add `announce_channel_id` to guild_settings as an
  additive migration; fall back to lol_channel_id; if neither, stay silent
  and it still shows in /achievements).
- Tier colors: common gray, uncommon green, rare blue, epic purple,
  legendary gold. Legendary+epic announcements always public.

### /achievements command

- `/achievements [user]` — trophy case: earned badges grouped by tier,
  earned_at dates, X/Y total, and **server rarity** ("held by 2/9
  members") — one GROUP BY over user_achievements.
- `/achievements locked` — the unearned list WITH descriptions as goals,
  secrets shown only as "??? (secret)".
- Ephemeral by default; the flex is the announcement, the browsing is
  private.

### Testing requirements (per CLAUDE.md)

Every check function must be pure-testable: take (ctx) where ctx = {
event, queries } with queries injectable, so tests feed fixture events
and fake query results. The catalog itself gets a contract test (unique
ids, valid tiers, every trigger key is a known trigger, every check is a
function) — mirror commands.test.js.

---

## 2. The catalog (launch set: 64)

Legend: tier · [S] = secret. "Logic" says what the check inspects.
Amounts are tuning suggestions — adjust freely in the catalog.

### Getting started (common)
| id | name | how | logic |
|---|---|---|---|
| first_daily | Early Bird 🌅 | claim your first /daily | trigger event |
| first_work | Gainfully Employed 💼 | first /work | trigger event |
| first_pay | It's on Me 🤝 | first /pay sent | trigger event |
| first_bet | Feeling Lucky 🎲 | first wager (any game) | trigger event |
| first_gift | Gift Giver 🎁 | send first /gift | trigger event |
| first_bank | Safety First 🏦 | first /bank deposit | trigger event |
| link_account | Summoner's Bind 🔗 | link a Riot account | trigger event |
| first_fact | Lore Keeper 🧠 | teach the bot a /fact | trigger event |
| first_wordle | Wordsmith ✏️ | finish a wordle (win or lose) | trigger event |

### Wealth & economy
| id | name | tier | how | logic |
|---|---|---|---|---|
| worth_1k | Four Figures 💰 | common | total worth ≥ 1,000 | wallet+banked query |
| worth_5k | Monied Class 💎 | uncommon | ≥ 5,000 | query |
| worth_10k | One Percent 🎩 | rare | ≥ 10,000 | query |
| worth_25k | Dragon's Hoard 🐉 | epic | ≥ 25,000 | query |
| flat_broke | Rock Bottom 🕳️ | uncommon [S] | wallet hits exactly 0 after any spend/loss | event: post-action balance == 0 |
| earned_10k | Grindset 📈 | rare | lifetime daily+work earnings ≥ 10,000 | FILTER aggregate |
| daily_streak_7 | Regular ☕ | common | 7-day daily streak | streak table |
| daily_streak_30 | Devoted 🗓️ | rare | 30-day streak | streak table |
| daily_streak_100 | Institution 🏛️ | legendary | 100-day streak | streak table |
| work_100 | Careerist 🧰 | uncommon | 100 lifetime /work uses | COUNT by type |
| generous_1k | Philanthropist 💝 | uncommon | 1,000+ monies gifted/paid to others | SUM sent types |
| big_spender | Diamond Hands 💍 | rare | send the diamond gift (2,000) | event: gift item id |
| bribe_menu | Corruption Connoisseur 🤫 | uncommon | use all three /bribe types | DISTINCT metadata over bribe rows |

### Banking & loans
| id | name | tier | how | logic |
|---|---|---|---|---|
| banked_5k | Vault Dweller 🔐 | uncommon | 5,000+ banked at once | banked query |
| loan_taken | Debtor's Waltz 📝 | common | take a loan | event |
| loan_cleared | Debt Free 🎉 | uncommon | fully repay a loan | event: cleared |
| loan_maxed | Living on Credit 🧾 | rare [S] | borrow at your exact credit limit | event: amount == limit |
| garnished_10 | Wage Garnishee 😮‍💨 | uncommon [S] | 10 lifetime garnishments | COUNT loan_garnish |

### Crime (rob)
| id | name | tier | how | logic |
|---|---|---|---|---|
| first_rob | Sticky Fingers 🦹 | common | first successful rob | event |
| rob_fail | Caught Red-Handed 🚨 | common | fail a robbery | event |
| robbed | Victim of Society 😤 | common | get robbed | event (victim side) |
| rob_max | Perfect Heist 💼 | epic | steal the 500 cap in one rob | event: amount == cap |
| damages_earned | Insurance Fraud 🤕 | uncommon [S] | collect damages from 5 failed robs on you | COUNT rob_damages |
| serial_robber | Repeat Offender 🔁 | rare | successfully rob the same person 3 times | COUNT rob_steal WHERE metadata.from |
| untouchable | Untouchable 🛡️ | rare [S] | be attacked 5+ times, never successfully robbed | COUNTs on victim-side types |

### Raffle
| id | name | tier | how | logic |
|---|---|---|---|---|
| raffle_win | Jackpot Adjacent 🎟️ | uncommon | win a raffle | event (draw settlement) |
| raffle_underdog | Lottery Miracle 🍀 | epic | win with < 5% of tickets | event: tickets/pot at draw |
| raffle_whale | Pot Committed 🐋 | uncommon | put 1,000+ into one raffle | entries row |

### Blackjack
| id | name | tier | how | logic |
|---|---|---|---|---|
| bj_natural | Natural 21 ♠️ | uncommon | dealt a blackjack | event: result 'blackjack' |
| bj_five_card | Sweating Bullets 😅 | rare [S] | win with a 5+ card hand | event: hand length |
| bj_push_3 | Groundhog Day 🔄 | uncommon [S] | push 3 times in one day | COUNT pushes today |
| bj_comeback | Double or Nothing 🎯 | rare | win a hand of 500+ | event: bet |

### Slots
| id | name | tier | how | logic |
|---|---|---|---|---|
| slots_jackpot | Lucky Sevens 7️⃣ | legendary | triple 7s | event: reels |
| slots_triple | Fruit Salad 🍒 | uncommon | any triple | event: multiplier ≥ 5 |
| slots_dry_10 | Due Any Spin Now 🫠 | uncommon [S] | 10 straight losing spins | last-10 query on slots rows |
| slots_100 | Lever Arm 💪 | uncommon | 100 lifetime spins | COUNT |

### Coinflip
| id | name | tier | how | logic |
|---|---|---|---|---|
| flip_streak_5 | Hot Hand 🔥 | rare | win 5 coinflips in a row | last-N query on coinflip rows |
| flip_cold_5 | Statistically Cursed 🧊 | rare [S] | lose 5 in a row | last-N query |
| gambler_net_5k | The House Fears You 🎰 | epic | lifetime gambling net ≥ +5,000 | SUM game types |
| house_wins | Pillar of the Economy 🏚️ | rare [S] | lifetime gambling net ≤ −5,000 | SUM game types |

### Wordle
| id | name | tier | how | logic |
|---|---|---|---|---|
| wordle_hole_in_one | Clairvoyant 🔮 | legendary | solve in 1 | event: attempts |
| wordle_in_two | Mind Reader 🧙 | epic | solve in 2 | event |
| wordle_clutch | Photo Finish 📸 | uncommon | solve on guess 6 | event |
| wordle_fail | Vocabulary Victim 📖 | common [S] | fail a wordle (X/6) | event |
| wordle_streak_7 | Daily Ritual 🕯️ | uncommon | 7-day solve streak | streak table |
| wordle_streak_30 | Lexicon Legend 📚 | epic | 30-day solve streak | streak table |
| wordle_50 | Cruciverbalist 🧩 | rare | 50 lifetime solves | COUNT solved |

### League of Legends (from lol_match_history + bets)
| id | name | tier | how | logic |
|---|---|---|---|---|
| lol_deathless | Untouched 😇 | rare | recorded game with 0 deaths | history row |
| lol_20kills | Smurf Behavior 🗡️ | rare | 20+ kills in a game | history row |
| lol_0_10 | Hall of Shame Inductee 💀 | rare [S] | 0 kills, 10+ deaths | history row |
| lol_win_streak_5 | On a Heater 🔥 | rare | 5 recorded wins in a row | ordered history query |
| lol_loss_streak_5 | It's the Team 🙃 | rare [S] | 5 recorded losses in a row | ordered history query |
| lol_100_games | Grinding the Rift 🏔️ | rare | 100 recorded matches | COUNT |
| lol_aram_50 | Bridge Troll 🌉 | rare | 50 ARAM games (queue 450) | COUNT by queue |
| bet_first_win | Oracle 🔮 | common | win a match bet | event (settlement) |
| bet_streak_5 | Sports Analyst 📊 | epic | 5 correct match bets in a row | ordered bets query |
| bet_traitor | Et Tu? 🗡️ | rare [S] | bet AGAINST the squad and win | settlement: on_win=false won |
| bet_max_win | High Roller 💸 | rare | win a max-size (1,000) match bet | event: amount |

### Meta & social
| id | name | tier | how | logic |
|---|---|---|---|---|
| facts_about_you_5 | Local Legend 📛 | uncommon | 5 facts exist about you | COUNT user_facts |
| poll_starter | Democracy Enjoyer 🗳️ | common | create a poll | event |
| warned | Seen the Mod Side ⚠️ | common [S] | receive a warning | event |
| completionist_25 | Trophy Hunter 🏆 | epic | earn 25 achievements | COUNT user_achievements |
| completionist_50 | Completionist 👑 | legendary | earn 50 achievements | COUNT (auto-scales as catalog grows) |

---

## 3. Growth conventions (the "forever" part)

1. **Every new feature ships with 2–3 achievements** in the same PR — one
   common ("did it once"), one skill/luck-based, ideally one secret.
   Make this a CLAUDE.md convention when implementing.
2. **New data unlocks new achievements.** Cheap additive migrations worth
   making when convenient: store `penta_kills`, `first_blood`, and cs in
   lol_match_history (extractParticipant already sees these fields in
   MATCH-V5 — currently discarded) → unlocks "Pentakill!" (legendary),
   "First Blood", CS-based badges.
3. **Already-designed backlog features come pre-instrumented:** heist
   (participant / mastermind / sole-survivor), shop (first purchase /
   collector), stock market (diamond hands / bag holder), hall of shame
   (crowned once / three-peat), bounties (placed / collected / survived).
4. **Retroactive awards are free** — because everything derives from
   history, adding an achievement means the next sweep grants it to
   everyone who already qualifies. That's the ledger design paying out
   one more time.

## 4. Implementation order (suggested Code sessions)

1. Framework: table, catalog module, checkAchievements + award +
   announce, /achievements command, contract tests. Ship with the
   "getting started" set only.
2. Event wiring across commands + the event-carried checks (the big
   middle of the catalog). Fixture tests per check.
3. Sweep task + aggregate/streak checks + retroactive backfill run.
4. The lol_match_history additive migration (penta/first blood/cs) and
   its achievements.
