// ============================================================
// riot.js (lib) — Minimal Riot Games API client.
// Handles the two routing schemes (the classic stumbling block):
//  - CLUSTER routing (americas/asia/europe): account + match data
//  - PLATFORM routing (na1/euw1/...): live games + ranked data
// ============================================================

// Read at call time (not import time) so dotenv has loaded first.
function apiKey() {
  return process.env.RIOT_API_KEY;
}
function clusterBase() {
  return `https://${process.env.RIOT_CLUSTER || 'americas'}.api.riotgames.com`;
}
function platformBase() {
  return `https://${process.env.RIOT_PLATFORM || 'na1'}.api.riotgames.com`;
}

/** Whether the Riot integration is configured at all. */
export function riotAvailable() {
  return Boolean(apiKey());
}

/**
 * Pure function: parses a Riot ID string like "Name#NA1" into its parts.
 * Riot IDs are gameName#tagLine; the name may contain spaces. Returns
 * { gameName, tagLine } or null if the format is wrong.
 */
export function parseRiotId(input) {
  const trimmed = (input ?? '').trim();
  const hash = trimmed.lastIndexOf('#');
  if (hash <= 0 || hash === trimmed.length - 1) return null;

  const gameName = trimmed.slice(0, hash).trim();
  const tagLine = trimmed.slice(hash + 1).trim();
  if (!gameName || !tagLine || tagLine.length > 5) return null;
  return { gameName, tagLine };
}

/**
 * Core request helper. Returns parsed JSON on 200, null on 404 (a normal
 * "doesn't exist" answer for this API — unknown account, not in game), and
 * throws with a useful message on anything else (bad key, rate limit, ...).
 */
async function riotFetch(url) {
  const response = await fetch(url, {
    headers: { 'X-Riot-Token': apiKey() },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Riot API ${response.status} for ${url.split('?')[0]}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

/**
 * Looks up an account by Riot ID. Returns { puuid, gameName, tagLine }
 * with Riot's canonical capitalization, or null if no such account.
 * (CLUSTER routing.)
 */
export function getAccountByRiotId(gameName, tagLine) {
  return riotFetch(
    `${clusterBase()}/riot/account/v1/accounts/by-riot-id/` +
      `${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
  );
}

/**
 * The player's current live game, or null if they aren't in one.
 * This is the poller's heartbeat question. (PLATFORM routing.)
 */
export function getActiveGame(puuid) {
  return riotFetch(
    `${platformBase()}/lol/spectator/v5/active-games/by-summoner/${puuid}`,
  );
}

/**
 * Full details of a finished match (participants, win/loss, KDA...).
 * Used to settle bets. (CLUSTER routing — note: not platform!)
 */
export function getMatch(matchId) {
  return riotFetch(`${clusterBase()}/lol/match/v5/matches/${matchId}`);
}

/**
 * The player's most recent match IDs, newest first. Used to find the
 * finished game after the live game disappears. (CLUSTER routing.)
 */
export function getRecentMatchIds(puuid, count = 3) {
  return riotFetch(
    `${clusterBase()}/lol/match/v5/matches/by-puuid/${puuid}/ids?count=${count}`,
  );
}

/**
 * Ranked entries (solo/duo, flex) for a player. For /rank and future
 * leaderboards. (PLATFORM routing.)
 */
export function getRankedEntries(puuid) {
  return riotFetch(
    `${platformBase()}/lol/league/v4/entries/by-puuid/${puuid}`,
  );
}
