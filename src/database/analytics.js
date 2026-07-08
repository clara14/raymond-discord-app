// ============================================================
// analytics.js (database) — The ledger turned into insight.
// Every query lives here as a small documented function
// returning plain data; commands are thin renderers over it.
// No new tables: everything derives live from transactions
// (+ streak/wordle/LoL tables for the records).
//
// HONESTY NOTE (per the spec's testing section): with no test
// database in the suite, these queries are hand-verified, not
// integration-tested. The pure math they feed (gini, stats,
// sparkline, classifyType) IS unit-tested.
// ============================================================

import { query } from './db.js';
import { JAR_SENTINEL } from './raffle.js';
import { typesInClass } from '../lib/ledgerTypes.js';
import { gini } from '../lib/gini.js';

// Sentinel "users" (non-numeric ids) — the raffle jar today. Excluded
// from every per-person statistic; included in supply (escrow counts).
const HUMAN_ID = `^[0-9]+$`;

const FAUCET = typesInClass('faucet');
const SINK = typesInClass('sink');
const TRANSFER = typesInClass('transfer');
const INTERNAL = typesInClass('internal');
const GAMBLE = typesInClass('gamble');

/**
 * The money supply and where it sits. Definitions:
 *  wallets = Σ per-human ledger sums (bank rows already subtract)
 *  banked  = −Σ over internal (bank) rows
 *  jar     = the raffle sentinel's balance (escrow between draws)
 *  total   = wallets + banked + jar — all monies in existence
 */
export async function moneySupply(guildId) {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE user_id ~ $2), 0)::bigint  AS human_sum,
       COALESCE(-SUM(amount) FILTER (WHERE type = ANY($3)), 0)::bigint AS banked,
       COALESCE(SUM(amount) FILTER (WHERE user_id !~ $2), 0)::bigint AS jar
     FROM transactions
     WHERE guild_id = $1`,
    [guildId, HUMAN_ID, INTERNAL],
  );
  const r = rows[0];
  // human_sum is Σ over every human ledger row. By the wallet = Σ(rows)
  // invariant — and because a bank deposit is a single negative wallet
  // row — that sum IS the total LIQUID wallet money: the deposits have
  // already subtracted themselves out. banked re-derives what's parked
  // in the bank. The three buckets are disjoint and sum to the supply.
  const wallets = Number(r.human_sum);
  const banked = Number(r.banked);
  const jar = Number(r.jar);
  return { wallets, banked, jar, total: wallets + banked + jar };
}

/**
 * Minted vs burned inside a trailing window — THE health metric.
 *  minted = faucet rows + positive gamble rows (house payouts)
 *  burned = sink rows + negative gamble rows (house takings)
 *           + the transfer-class residual (gift fees; matched
 *             transfer pairs cancel, the fee remainder is the burn —
 *             pairs straddling the window edge add small noise, fine
 *             at friend scale)
 */
export async function flowWindow(guildId, days) {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE type = ANY($3)), 0)::bigint            AS faucet,
       COALESCE(SUM(amount) FILTER (WHERE type = ANY($4)), 0)::bigint            AS sink,
       COALESCE(SUM(amount) FILTER (WHERE type = ANY($5)), 0)::bigint            AS transfer_net,
       COALESCE(SUM(amount) FILTER (WHERE type = ANY($6) AND amount > 0), 0)::bigint AS gamble_paid,
       COALESCE(SUM(amount) FILTER (WHERE type = ANY($6) AND amount < 0), 0)::bigint AS gamble_taken
     FROM transactions
     WHERE guild_id = $1 AND created_at > now() - make_interval(days => $2)`,
    [guildId, days, FAUCET, SINK, TRANSFER, GAMBLE],
  );
  const r = rows[0];
  const minted = Number(r.faucet) + Number(r.gamble_paid);
  const burned =
    -Number(r.sink) - Number(r.gamble_taken) - Number(r.transfer_net);
  return { minted, burned, net: minted - burned };
}

/**
 * Velocity: transfer volume over the window relative to supply —
 * "is money moving or hoarding?". Volume counts each matched pair
 * once (sum of positive transfer rows).
 */
export async function velocity(guildId, days) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE type = ANY($3) AND amount > 0), 0)::bigint AS volume
     FROM transactions
     WHERE guild_id = $1 AND created_at > now() - make_interval(days => $2)`,
    [guildId, days, TRANSFER],
  );
  const { total } = await moneySupply(guildId);
  const volume = Number(rows[0].volume);
  return { volume, ratioPct: total > 0 ? (volume / total) * 100 : 0 };
}

/**
 * Every human's total worth (wallet + banked), for gini / median /
 * concentration. worth = Σ rows − Σ bank rows (bank rows cancel out of
 * worth: −500 deposit + un-subtracting it = wallet 0, banked 500).
 */
export async function worthByUser(guildId) {
  const { rows } = await query(
    `SELECT user_id,
            (SUM(amount)
             - COALESCE(SUM(amount) FILTER (WHERE type = ANY($3)), 0)
            )::bigint AS worth
     FROM transactions
     WHERE guild_id = $1 AND user_id ~ $2
     GROUP BY user_id`,
    [guildId, HUMAN_ID, INTERNAL],
  );
  return rows.map((r) => ({ userId: r.user_id, worth: Number(r.worth) }));
}

/**
 * The house report: observed return-to-player per game vs the design.
 * RTP = returned / wagered. Voided LoL bets (refunds) are removed from
 * the wagered base — a refunded bet was never really played.
 */
export async function houseReport(guildId) {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM((metadata->>'bet')::bigint) FILTER (WHERE type = 'slots'), 0)    AS slots_wagered,
       COALESCE(SUM(amount) FILTER (WHERE type = 'slots'), 0)::bigint                AS slots_net,
       COALESCE(SUM((metadata->>'bet')::bigint) FILTER (WHERE type = 'coinflip'), 0) AS flip_wagered,
       COALESCE(SUM(amount) FILTER (WHERE type = 'coinflip'), 0)::bigint             AS flip_net,
       COALESCE(-SUM(amount) FILTER (WHERE type = 'blackjack_bet'), 0)::bigint       AS bj_wagered,
       COALESCE(SUM(amount) FILTER (WHERE type IN ('blackjack_win','blackjack_push')), 0)::bigint AS bj_returned,
       COALESCE(-SUM(amount) FILTER (WHERE type = 'lol_bet'), 0)::bigint             AS bet_wagered,
       COALESCE(SUM(amount) FILTER (WHERE type = 'lol_bet_win'), 0)::bigint          AS bet_returned,
       COALESCE(SUM(amount) FILTER (WHERE type = 'lol_bet_refund'), 0)::bigint       AS bet_refunded
     FROM transactions
     WHERE guild_id = $1`,
    [guildId],
  );
  const r = rows[0];
  const games = [
    // For single-signed-row games (slots/coinflip), returned = wagered + net.
    { game: 'Slots', designedPct: 88.5,
      wagered: Number(r.slots_wagered), returned: Number(r.slots_wagered) + Number(r.slots_net) },
    { game: 'Coinflip', designedPct: 100,
      wagered: Number(r.flip_wagered), returned: Number(r.flip_wagered) + Number(r.flip_net) },
    { game: 'Blackjack', designedPct: 99,
      wagered: Number(r.bj_wagered), returned: Number(r.bj_returned) },
    { game: 'LoL bets', designedPct: 100,
      wagered: Number(r.bet_wagered) - Number(r.bet_refunded), returned: Number(r.bet_returned) },
  ];
  return games.map((g) => ({
    ...g,
    observedPct: g.wagered > 0 ? (g.returned / g.wagered) * 100 : null,
  }));
}

/**
 * The time machine: a user's NET WORTH at each day's close. Bank moves
 * don't change worth, so internal rows are simply excluded, and the
 * running SUM window over daily nets is the whole trick:
 *   daily net (GROUP BY day) → SUM(...) OVER (ORDER BY day).
 */
export async function worthHistory(guildId, userId, sinceDays = null) {
  const { rows } = await query(
    `SELECT day::text AS day, running::bigint AS worth FROM (
       SELECT created_at::date AS day,
              SUM(SUM(amount)) OVER (ORDER BY created_at::date) AS running
       FROM transactions
       WHERE guild_id = $1 AND user_id = $2 AND NOT (type = ANY($3))
       GROUP BY created_at::date
     ) daily
     WHERE $4::int IS NULL OR day > CURRENT_DATE - make_interval(days => $4)
     ORDER BY day`,
    [guildId, userId, INTERNAL, sinceDays],
  );
  return rows.map((r) => ({ day: r.day, worth: Number(r.worth) }));
}

/** The hall of records: one superlative per row, guild-wide. */
export async function records(guildId) {
  // Ledger superlatives in one FILTER-ed pass over humans.
  const { rows } = await query(
    `SELECT
       MAX(amount) FILTER (WHERE type = ANY($3) AND amount > 0)::bigint  AS biggest_win,
       MIN(amount) FILTER (WHERE type = ANY($3) AND amount < 0)::bigint  AS biggest_loss,
       MAX(amount) FILTER (WHERE type = 'pay_received')::bigint          AS biggest_pay,
       MAX(-amount) FILTER (WHERE type = 'gift_sent')::bigint            AS biggest_gift,
       MAX(amount) FILTER (WHERE type = 'rob_steal')::bigint             AS biggest_rob,
       MAX(amount) FILTER (WHERE type = 'rob_damages')::bigint           AS biggest_damages,
       MAX(amount) FILTER (WHERE type = 'raffle_win')::bigint            AS biggest_raffle
     FROM transactions
     WHERE guild_id = $1 AND user_id ~ $2`,
    [guildId, HUMAN_ID, GAMBLE],
  );
  const r = rows[0];

  // Who holds a ledger superlative: the first row matching the record
  // amount within the given types. One tiny indexed lookup per record.
  const holder = async (types, amount) => {
    if (amount == null) return null;
    const { rows: h } = await query(
      `SELECT user_id FROM transactions
       WHERE guild_id = $1 AND type = ANY($2) AND amount = $3
       LIMIT 1`,
      [guildId, types, amount],
    );
    return h[0]?.user_id ?? null;
  };

  // Streak records: the streak tables hold CURRENT streaks only, so
  // this is "longest streak on record", not longest ever (a broken
  // streak leaves no trace — honest divergence from the spec).
  const { rows: streaks } = await query(
    `SELECT
       (SELECT MAX(streak) FROM daily_streaks  WHERE guild_id = $1) AS daily,
       (SELECT MAX(streak) FROM wordle_streaks WHERE guild_id = $1) AS wordle`,
    [guildId],
  );

  // Busiest day + most-garnished debtor.
  const { rows: busiest } = await query(
    `SELECT created_at::date::text AS day, COUNT(*)::int AS n
     FROM transactions WHERE guild_id = $1
     GROUP BY created_at::date ORDER BY n DESC LIMIT 1`,
    [guildId],
  );
  const { rows: garnished } = await query(
    `SELECT user_id, (-SUM(amount))::bigint AS total
     FROM transactions
     WHERE guild_id = $1 AND type = 'loan_garnish'
     GROUP BY user_id ORDER BY total DESC LIMIT 1`,
    [guildId],
  );

  return {
    biggestWin: r.biggest_win == null ? null
      : { amount: Number(r.biggest_win), userId: await holder(GAMBLE, Number(r.biggest_win)) },
    biggestLoss: r.biggest_loss == null ? null
      : { amount: -Number(r.biggest_loss), userId: await holder(GAMBLE, Number(r.biggest_loss)) },
    biggestPay: r.biggest_pay == null ? null
      : { amount: Number(r.biggest_pay), userId: await holder(['pay_received'], Number(r.biggest_pay)) },
    biggestGift: r.biggest_gift == null ? null
      : { amount: Number(r.biggest_gift), userId: await holder(['gift_sent'], -Number(r.biggest_gift)) },
    biggestRob: r.biggest_rob == null ? null
      : { amount: Number(r.biggest_rob), userId: await holder(['rob_steal'], Number(r.biggest_rob)) },
    biggestDamages: r.biggest_damages == null ? null
      : { amount: Number(r.biggest_damages), userId: await holder(['rob_damages'], Number(r.biggest_damages)) },
    biggestRafflePot: r.biggest_raffle == null ? null
      : { amount: Number(r.biggest_raffle), userId: await holder(['raffle_win'], Number(r.biggest_raffle)) },
    longestDailyStreak: streaks[0].daily == null ? null : Number(streaks[0].daily),
    longestWordleStreak: streaks[0].wordle == null ? null : Number(streaks[0].wordle),
    busiestDay: busiest[0] ?? null,
    mostGarnished: garnished[0]
      ? { userId: garnished[0].user_id, amount: Number(garnished[0].total) }
      : null,
  };
}

/**
 * The personal finance report behind /mystats: income by source,
 * spending by destination, per-game ROI, loan interest, rob ledger,
 * biggest single day.
 */
export async function personalReport(guildId, userId) {
  const { rows } = await query(
    `SELECT type,
            SUM(amount) FILTER (WHERE amount > 0)::bigint AS credited,
            SUM(amount) FILTER (WHERE amount < 0)::bigint AS debited,
            SUM((metadata->>'bet')::bigint) FILTER (WHERE type IN ('slots','coinflip'))::bigint AS wagered_meta,
            COUNT(*)::int AS n
     FROM transactions
     WHERE guild_id = $1 AND user_id = $2
     GROUP BY type`,
    [guildId, userId],
  );
  const byType = new Map(rows.map((r) => [r.type, {
    credited: Number(r.credited ?? 0),
    debited: Number(r.debited ?? 0),
    wageredMeta: Number(r.wagered_meta ?? 0),
    n: r.n,
  }]));
  const g = (t) => byType.get(t) ?? { credited: 0, debited: 0, wageredMeta: 0, n: 0 };

  // Per-game ROI: net / wagered (single-signed games read the bet from
  // metadata; bet-then-payout games read the debited bet rows).
  const roi = (net, wagered) => (wagered > 0 ? (net / wagered) * 100 : null);
  const slotsNet = g('slots').credited + g('slots').debited;
  const flipNet = g('coinflip').credited + g('coinflip').debited;
  const bjWagered = -g('blackjack_bet').debited;
  const bjNet = g('blackjack_win').credited + g('blackjack_push').credited - bjWagered;
  const betWagered = -g('lol_bet').debited - g('lol_bet_refund').credited;
  const betNet = g('lol_bet_win').credited + g('lol_bet_refund').credited + g('lol_bet').debited;

  const { rows: biggestDay } = await query(
    `SELECT created_at::date::text AS day, SUM(amount)::bigint AS net
     FROM transactions WHERE guild_id = $1 AND user_id = $2
     GROUP BY created_at::date ORDER BY net DESC LIMIT 1`,
    [guildId, userId],
  );

  return {
    riskProfile: await riskProfile(guildId, userId),
    income: {
      daily: g('daily').credited,
      work: g('work').credited,
      wordle: g('wordle').credited,
      gambling: Math.max(0, slotsNet) + Math.max(0, flipNet) + Math.max(0, bjNet) + Math.max(0, betNet),
      received: g('pay_received').credited + g('gift_received').credited,
      other: g('welcome').credited + g('birthday').credited + g('raffle_win').credited + g('rob_steal').credited + g('rob_damages').credited,
    },
    gamblingRoi: {
      slots: { net: slotsNet, wagered: g('slots').wageredMeta, roiPct: roi(slotsNet, g('slots').wageredMeta) },
      coinflip: { net: flipNet, wagered: g('coinflip').wageredMeta, roiPct: roi(flipNet, g('coinflip').wageredMeta) },
      blackjack: { net: bjNet, wagered: bjWagered, roiPct: roi(bjNet, bjWagered) },
      lolBets: { net: betNet, wagered: betWagered, roiPct: roi(betNet, betWagered) },
    },
    // Interest = everything repaid beyond what was ever disbursed.
    loanInterestPaid: Math.max(0,
      -g('loan_repayment').debited - g('loan_garnish').debited - g('loan_disbursement').credited),
    burned: -g('bribe').debited,
    givenAway: -g('pay_sent').debited - g('gift_sent').debited,
    robLedger: {
      stolen: g('rob_steal').credited,
      lostToRobbers: -g('rob_victim').debited,
      damagesCollected: g('rob_damages').credited,
      finesPaid: -g('rob_fail').debited,
    },
    biggestDay: biggestDay[0]
      ? { day: biggestDay[0].day, net: Number(biggestDay[0].net) }
      : null,
  };
}

// ------------------------------------------------------------
// Phase 4 — "the genuinely fancy (because PostgreSQL can)"
// ------------------------------------------------------------

/**
 * Risk profile: each wager as a fraction of the WALLET at the moment of
 * the bet, via the running-balance window joined to the wager rows.
 * The bet comes from metadata for single-row games (coinflip/slots) and
 * from the debit itself for bet-then-payout games. bal_before ≤ 0 rows
 * are excluded (a bet can't exceed the wallet, so those are ordering
 * artifacts within a transaction batch).
 */
export async function riskProfile(guildId, userId) {
  const { rows } = await query(
    `SELECT AVG(bet::numeric / bal_before)::float8 AS avg_frac,
            MAX(bet::numeric / bal_before)::float8 AS max_frac,
            COUNT(*)::int AS n
     FROM (
       SELECT COALESCE((metadata->>'bet')::bigint, -amount) AS bet,
              type,
              SUM(amount) OVER (ORDER BY id) - amount AS bal_before
       FROM transactions
       WHERE guild_id = $1 AND user_id = $2
     ) x
     WHERE type IN ('coinflip', 'slots', 'blackjack_bet', 'lol_bet')
       AND bal_before > 0`,
    [guildId, userId],
  );
  const r = rows[0];
  return r.n > 0
    ? { avgPct: r.avg_frac * 100, maxPct: r.max_frac * 100, bets: r.n }
    : null;
}

/**
 * Wealth mobility: everyone's rank now vs rank `days` ago (two RANK()
 * passes over worth-then and worth-now). Positive rankShift = climbed.
 */
export async function wealthMobility(guildId, days = 30) {
  const { rows } = await query(
    `WITH now_w AS (
       SELECT user_id,
              (SUM(amount) FILTER (WHERE NOT (type = ANY($4))))::bigint AS w
       FROM transactions
       WHERE guild_id = $1 AND user_id ~ $2
       GROUP BY user_id
     ),
     then_w AS (
       SELECT user_id,
              (SUM(amount) FILTER (WHERE NOT (type = ANY($4))))::bigint AS w
       FROM transactions
       WHERE guild_id = $1 AND user_id ~ $2
         AND created_at <= now() - make_interval(days => $3)
       GROUP BY user_id
     )
     SELECT n.user_id,
            COALESCE(n.w, 0)::bigint AS now_w,
            COALESCE(t.w, 0)::bigint AS then_w,
            RANK() OVER (ORDER BY COALESCE(n.w, 0) DESC) AS rank_now,
            RANK() OVER (ORDER BY COALESCE(t.w, 0) DESC) AS rank_then
     FROM now_w n
     LEFT JOIN then_w t ON t.user_id = n.user_id`,
    [guildId, HUMAN_ID, days, INTERNAL],
  );
  return rows.map((r) => ({
    userId: r.user_id,
    worthNow: Number(r.now_w),
    worthThen: Number(r.then_w),
    delta: Number(r.now_w) - Number(r.then_w),
    rankNow: Number(r.rank_now),
    rankThen: Number(r.rank_then),
    rankShift: Number(r.rank_then) - Number(r.rank_now), // + = climbed
  }));
}

/**
 * The inequality trend: gini per week over the guild's whole history.
 * SQL assembles each week's per-user worth snapshot (cumulative rows up
 * to that week's end); the tested pure gini() does the math. O(weeks ×
 * rows) — a cross join a real system would cache, and exactly the kind
 * of thing friend scale lets us not care about.
 */
export async function weeklyGini(guildId) {
  const { rows } = await query(
    `WITH bounds AS (
       SELECT date_trunc('week', MIN(created_at)) AS start
       FROM transactions WHERE guild_id = $1
     ),
     weeks AS (
       SELECT generate_series((SELECT start FROM bounds), now(), interval '1 week') AS wk
     )
     SELECT (w.wk + interval '1 week')::date::text AS week,
            array_agg(u.worth) AS worths
     FROM weeks w
     CROSS JOIN LATERAL (
       SELECT user_id,
              (SUM(amount) FILTER (WHERE NOT (type = ANY($3))))::bigint AS worth
       FROM transactions
       WHERE guild_id = $1 AND user_id ~ $2
         AND created_at < w.wk + interval '1 week'
       GROUP BY user_id
     ) u
     GROUP BY w.wk
     ORDER BY w.wk`,
    [guildId, HUMAN_ID, INTERNAL],
  );
  return rows.map((r) => ({
    week: r.week,
    gini: gini(r.worths.map(Number)),
  }));
}

/**
 * Cross-domain correlations via corr(), the spec's party trick. r is
 * null when there's no variance or fewer than two pairs; every caller
 * must print the small-n caveat — at friend scale these are vibes with
 * confidence intervals wider than the chart.
 */
export async function correlations(guildId) {
  // Wordle solve rate vs current worth (players with ≥3 boards).
  const { rows: wordle } = await query(
    `WITH worth AS (
       SELECT user_id,
              (SUM(amount) FILTER (WHERE NOT (type = ANY($3))))::bigint AS w
       FROM transactions WHERE guild_id = $1 AND user_id ~ $2
       GROUP BY user_id
     ),
     solver AS (
       SELECT user_id, AVG(CASE WHEN solved THEN 1.0 ELSE 0.0 END)::float8 AS rate
       FROM wordle_games WHERE guild_id = $1
       GROUP BY user_id
       HAVING COUNT(*) >= 3
     )
     SELECT corr(worth.w::float8, solver.rate) AS r, COUNT(*)::int AS n
     FROM worth JOIN solver ON solver.user_id = worth.user_id`,
    [guildId, HUMAN_ID, INTERNAL],
  );

  // Live daily streak vs lifetime gambling net ("disciplined people
  // gamble better — discuss").
  const { rows: streak } = await query(
    `WITH net AS (
       SELECT user_id, SUM(amount)::bigint AS net
       FROM transactions
       WHERE guild_id = $1 AND type = ANY($2)
       GROUP BY user_id
     )
     SELECT corr(s.streak::float8, net.net::float8) AS r, COUNT(*)::int AS n
     FROM daily_streaks s
     JOIN net ON net.user_id = s.user_id
     WHERE s.guild_id = $1`,
    [guildId, GAMBLE],
  );

  return {
    wordleVsWorth: { r: wordle[0].r, n: wordle[0].n },
    streakVsGambling: { r: streak[0].r, n: streak[0].n },
  };
}

/**
 * Hoarding gap: for every spend, how long since that user last earned —
 * averaged. An honest approximation of "how long do monies sit" without
 * pretending we can FIFO-match individual coins. Bank shuffles excluded.
 */
export async function hoardingGap(guildId) {
  const { rows } = await query(
    `SELECT AVG(EXTRACT(EPOCH FROM (created_at - prev_earn)) / 86400.0)::float8 AS days,
            COUNT(*)::int AS n
     FROM (
       SELECT created_at, amount,
              MAX(created_at) FILTER (WHERE amount > 0) OVER (
                PARTITION BY user_id ORDER BY id
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ) AS prev_earn
       FROM transactions
       WHERE guild_id = $1 AND user_id ~ $2 AND NOT (type = ANY($3))
     ) x
     WHERE amount < 0 AND prev_earn IS NOT NULL`,
    [guildId, HUMAN_ID, INTERNAL],
  );
  return rows[0].n > 0 ? { days: rows[0].days, spends: rows[0].n } : null;
}

/**
 * Sentinel forensics: the raffle jar's balance over time. It should
 * saw-tooth up during entries and snap to 0 at every draw — this chart
 * IS an audit visualization (a jar that drifts nonzero means a bug).
 */
export async function jarHistory(guildId) {
  const { rows } = await query(
    `SELECT day::text AS day, running::bigint AS balance FROM (
       SELECT created_at::date AS day,
              SUM(SUM(amount)) OVER (ORDER BY created_at::date) AS running
       FROM transactions
       WHERE guild_id = $1 AND user_id = $2
       GROUP BY created_at::date
     ) d ORDER BY day`,
    [guildId, JAR_SENTINEL],
  );
  return rows.map((r) => ({ day: r.day, balance: Number(r.balance) }));
}
