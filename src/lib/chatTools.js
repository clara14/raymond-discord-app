// ============================================================
// chatTools.js (lib) — The AI chat's tools: real lookups into
// the economy and LoL data, so the bot roasts with facts.
// Usernames are resolved via a per-conversation name map built
// from the chat history (username -> Discord user id).
// ============================================================

import { getProfile } from '../database/stats.js';
import { getLeaderboard } from '../database/economy.js';
import { getLink } from '../database/linkedAccounts.js';
import { getStats, getHistory } from '../database/lolHistory.js';

// Tool schemas in the Anthropic Messages API format. The descriptions are
// written FOR THE MODEL — they're how it decides when to call what.
export const CHAT_TOOLS = [
  {
    name: 'get_economy_profile',
    description:
      'Look up a server member\'s real economy profile: wallet balance, banked ' +
      'savings, loan debt, net worth, daily streak, lifetime earnings, gambling ' +
      'record, and raffle wins. Use when someone\'s wealth, debt, or gambling is relevant.',
    input_schema: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'The member\'s username exactly as it appears in the conversation',
        },
      },
      required: ['username'],
    },
  },
  {
    name: 'get_lol_stats',
    description:
      'Look up a member\'s real League of Legends record from tracked matches: ' +
      'winrate, KDA, most-played champions, and their last few games. Use when ' +
      'their League performance comes up.',
    input_schema: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'The member\'s username exactly as it appears in the conversation',
        },
      },
      required: ['username'],
    },
  },
  {
    name: 'get_leaderboard',
    description:
      'Get the server\'s top 5 richest members (total worth including banked monies). ' +
      'Use for questions about who is richest or how people compare.',
    input_schema: { type: 'object', properties: {} },
  },
];

/**
 * Builds the executor for one conversation. `ctx` carries the guild and the
 * username -> user id map assembled from the chat history, so the model can
 * refer to people by the names it actually sees.
 * Every tool returns a JSON string — compact, unambiguous model food.
 */
export function makeToolExecutor(ctx) {
  const { guildId, nameMap } = ctx;

  // Case-insensitive username resolution against the conversation roster.
  function resolve(username) {
    const wanted = (username ?? '').trim().toLowerCase();
    for (const [name, id] of nameMap) {
      if (name.toLowerCase() === wanted) return id;
    }
    return null;
  }

  return async function executeTool(name, input) {
    if (name === 'get_economy_profile') {
      const userId = resolve(input.username);
      if (!userId) {
        return JSON.stringify({ error: `No member called "${input.username}" in this conversation.` });
      }
      const p = await getProfile(guildId, userId);
      return JSON.stringify({
        username: input.username,
        wallet: p.balance,
        banked: p.banked,
        loan_debt: p.debt,
        net_worth: p.netWorth,
        daily_streak: p.streak,
        lifetime_earned: p.lifetimeEarned,
        gambling_net: p.gamblingNet,
        coinflip_record: `${p.coinflipWins}W-${p.coinflipLosses}L`,
        raffle_wins: p.raffleWins,
      });
    }

    if (name === 'get_lol_stats') {
      const userId = resolve(input.username);
      if (!userId) {
        return JSON.stringify({ error: `No member called "${input.username}" in this conversation.` });
      }
      const link = await getLink(userId);
      if (!link) {
        return JSON.stringify({ error: `${input.username} has not linked a League account.` });
      }
      const s = await getStats(link.puuid);
      if (s.games === 0) {
        return JSON.stringify({ error: `No matches recorded yet for ${input.username}.` });
      }
      const recent = await getHistory(link.puuid, 3);
      return JSON.stringify({
        riot_id: `${link.game_name}#${link.tag_line}`,
        games: s.games,
        record: `${s.wins}W-${s.games - s.wins}L`,
        winrate_pct: Number(((s.wins / s.games) * 100).toFixed(1)),
        kda: s.deaths === 0 ? 'perfect' : Number(((s.kills + s.assists) / s.deaths).toFixed(2)),
        top_champions: s.topChampions.map((c) => `${c.champion} (${c.games} games)`),
        last_games: recent.map(
          (m) => `${m.win ? 'W' : 'L'} ${m.champion} ${m.kills}/${m.deaths}/${m.assists}`,
        ),
      });
    }

    if (name === 'get_leaderboard') {
      const top = await getLeaderboard(guildId, 5);
      // The ledger stores ids; report names where the conversation knows
      // them, otherwise a neutral placeholder (the model handles it).
      const idToName = new Map([...nameMap].map(([n, id]) => [id, n]));
      return JSON.stringify(
        top.map((e, i) => ({
          rank: i + 1,
          name: idToName.get(e.userId) ?? 'someone not in this chat',
          total_worth: e.balance,
        })),
      );
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  };
}
