// ============================================================
// lolHistory.js (database) — Recording and querying per-player
// match history. Rows arrive via the /link backfill and the
// poller's periodic sync; /history and /lolstats read them.
// ============================================================

import { query } from './db.js';
import { getMatch, getRecentMatchIds } from '../lib/riot.js';
import { LOL } from '../config.js';

/**
 * Pure function: pulls one player's line out of a MATCH-V5 response.
 * Exported for testing. Returns null if the player isn't in the match
 * (shouldn't happen, but the API is the API).
 */
export function extractParticipant(matchDetail, puuid) {
  const me = matchDetail?.info?.participants?.find((p) => p.puuid === puuid);
  if (!me) return null;
  return {
    champion: me.championName,
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    win: me.win,
    queueId: matchDetail.info.queueId,
    durationSec: matchDetail.info.gameDuration,
    endedAt: new Date(
      // gameEndTimestamp is the reliable field on modern matches; fall back
      // to start + duration for older records.
      matchDetail.info.gameEndTimestamp ??
        matchDetail.info.gameStartTimestamp + matchDetail.info.gameDuration * 1000,
    ),
  };
}

/** Inserts one match row; idempotent thanks to the composite PK. */
export async function recordMatch(matchId, puuid, userId, p) {
  await query(
    `INSERT INTO lol_match_history
       (match_id, puuid, user_id, champion, kills, deaths, assists,
        win, queue_id, duration_sec, ended_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (match_id, puuid) DO NOTHING`,
    [matchId, puuid, userId, p.champion, p.kills, p.deaths, p.assists,
     p.win, p.queueId, p.durationSec, p.endedAt],
  );
}

/**
 * Fetches and records any of the player's recent matches we haven't seen.
 * Shared by the /link backfill and the poller's sync — the only difference
 * is how many match ids they ask for. Returns the newly recorded rows
 * (matchId + the participant stats) so the poller can run match-based
 * achievement checks on exactly what's new; length = how many.
 */
export async function syncPlayerHistory(puuid, userId, count) {
  const ids = await getRecentMatchIds(puuid, count);
  if (!ids || ids.length === 0) return [];

  // One round trip to learn which of these we already have.
  const { rows } = await query(
    `SELECT match_id FROM lol_match_history
     WHERE puuid = $1 AND match_id = ANY($2)`,
    [puuid, ids],
  );
  const known = new Set(rows.map((r) => r.match_id));

  const recorded = [];
  for (const matchId of ids) {
    if (known.has(matchId)) continue;

    const detail = await getMatch(matchId);
    const p = detail ? extractParticipant(detail, puuid) : null;
    if (!p) continue;

    await recordMatch(matchId, puuid, userId, p);
    recorded.push({ matchId, ...p });
  }
  return recorded;
}

/** The player's most recent recorded matches, newest first. */
export async function getHistory(puuid, limit = 10) {
  const { rows } = await query(
    `SELECT match_id, champion, kills, deaths, assists, win,
            queue_id, duration_sec, ended_at
     FROM lol_match_history
     WHERE puuid = $1
     ORDER BY ended_at DESC
     LIMIT $2`,
    [puuid, limit],
  );
  return rows;
}

/**
 * Aggregate stats for /lolstats: totals, winrate inputs, and KDA sums in
 * one FILTER-ed pass, plus a small GROUP BY for the most-played champions.
 */
export async function getStats(puuid) {
  const { rows } = await query(
    `SELECT
       COUNT(*)::int                          AS games,
       COUNT(*) FILTER (WHERE win)::int       AS wins,
       COALESCE(SUM(kills), 0)::int           AS kills,
       COALESCE(SUM(deaths), 0)::int          AS deaths,
       COALESCE(SUM(assists), 0)::int         AS assists
     FROM lol_match_history
     WHERE puuid = $1`,
    [puuid],
  );

  const { rows: champs } = await query(
    `SELECT champion, COUNT(*)::int AS games,
            COUNT(*) FILTER (WHERE win)::int AS wins
     FROM lol_match_history
     WHERE puuid = $1
     GROUP BY champion
     ORDER BY games DESC, wins DESC
     LIMIT 3`,
    [puuid],
  );

  return { ...rows[0], topChampions: champs };
}
