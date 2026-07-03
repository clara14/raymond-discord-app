// ============================================================
// matchPoller.js (task) — The bot's first BACKGROUND task.
// Every cycle it: (1) checks linked accounts for new live games
// and announces them with betting buttons, and (2) checks
// tracked games for completion, then settles or voids bets.
// Also owns the 'lolbet' button + modal handlers.
// ============================================================

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { getAllLinks } from '../database/linkedAccounts.js';
import {
  getConfiguredGuilds,
  getLiveMatches,
  trackMatch,
  setMatchMessage,
  bumpResultAttempts,
  placeBet,
  settleMatch,
  voidMatch,
} from '../database/lolBets.js';
import { ensureWelcomeBonus } from '../database/economy.js';
import { getActiveGame, getRecentMatchIds, getMatch, riotAvailable } from '../lib/riot.js';
import { syncPlayerHistory } from '../database/lolHistory.js';
import { LOL, formatCurrency } from '../config.js';

let clientRef = null;
let cycleCount = 0; // drives the every-Nth-cycle history sync

/**
 * Starts the polling loop. Called once from the ready event. The loop is
 * a self-rescheduling setTimeout (not setInterval) so a slow cycle can
 * never overlap the next one.
 */
export function startMatchPoller(client) {
  if (!riotAvailable()) {
    console.log('  ⚠ Match poller not started (RIOT_API_KEY not set)');
    return;
  }
  clientRef = client;
  console.log(`  ✓ Match poller running (every ${LOL.pollIntervalSec}s)`);
  scheduleNext(5_000); // first pass shortly after startup
}

function scheduleNext(ms = LOL.pollIntervalSec * 1000) {
  setTimeout(async () => {
    try {
      await pollOnce();
    } catch (err) {
      // The loop must survive anything — log and keep going.
      console.error('Poller cycle error:', err);
    }
    scheduleNext();
  }, ms);
}

// One full cycle: settle finished games first (frees tracked slots),
// then look for new live games. Every Nth cycle, also sync match history
// for all linked accounts (catches games the live tracker missed).
async function pollOnce() {
  await checkTrackedMatches();
  await detectNewGames();

  cycleCount += 1;
  if (cycleCount % LOL.historyEveryCycles === 0) {
    await syncAllHistory();
  }
}

// Records any unseen recent matches for every linked account.
async function syncAllHistory() {
  const links = await getAllLinks();
  for (const link of links) {
    try {
      await syncPlayerHistory(link.puuid, link.user_id, LOL.historyFetchCount);
    } catch (err) {
      console.error(`History sync error for ${link.game_name}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------
// Detection: is any linked account in a game we aren't tracking?
// ---------------------------------------------------------------

/**
 * Pure function (exported for tests): given a live game's participants,
 * the anchor player (whose spectator call found the game), and all links,
 * partition the linked players in this game into the anchor's team
 * ('squad') and the enemy team ('rivals'). Bets ride on the squad's result.
 */
export function partitionLinkedPlayers(gameParticipants, anchorPuuid, links) {
  const byPuuid = new Map(links.map((l) => [l.puuid, l]));
  const anchor = gameParticipants.find((p) => p.puuid === anchorPuuid);
  if (!anchor) return { squad: [], rivals: [] };

  const squad = [];
  const rivals = [];
  for (const p of gameParticipants) {
    const link = byPuuid.get(p.puuid);
    if (!link) continue; // not one of ours
    const entry = {
      user_id: link.user_id,
      game_name: link.game_name,
      puuid: link.puuid,
      side: p.teamId === anchor.teamId ? 'squad' : 'rival',
    };
    (entry.side === 'squad' ? squad : rivals).push(entry);
  }
  return { squad, rivals };
}

async function detectNewGames() {
  const guilds = await getConfiguredGuilds();
  if (guilds.length === 0) return; // nowhere to announce

  const links = await getAllLinks();
  const live = await getLiveMatches();

  // Every puuid already involved in a tracked game — anchor AND stored
  // participants — so teammates don't burn spectator calls each cycle.
  const livePuuids = new Set();
  for (const m of live) {
    livePuuids.add(m.puuid);
    for (const p of m.participants ?? []) livePuuids.add(p.puuid);
  }

  for (const link of links) {
    // Skip accounts already covered by a tracked game — saves API calls.
    if (livePuuids.has(link.puuid)) continue;

    const game = await getActiveGame(link.puuid); // null = not in game
    if (!game) continue;

    // Group play: find EVERY linked player in this game in one shot, so a
    // 4-stack gets one announcement instead of four, and their spectator
    // calls are skipped for the rest of this cycle and beyond.
    const { squad, rivals } = partitionLinkedPlayers(
      game.participants ?? [],
      link.puuid,
      links,
    );
    for (const p of [...squad, ...rivals]) livePuuids.add(p.puuid);

    // Announce in every configured guild (friends-server assumption:
    // linked users are members of the guilds the bot serves).
    for (const g of guilds) {
      const closesAt = new Date(Date.now() + LOL.betWindowMin * 60_000);
      const rowId = await trackMatch(
        g.guild_id, link.user_id, link.puuid, game.gameId, g.lol_channel_id,
        closesAt, [...squad, ...rivals],
      );
      if (!rowId) continue; // already tracked (idempotent insert)

      await announceMatch(g, link, rowId, closesAt, squad, rivals).catch((err) =>
        console.error('Announce error:', err),
      );
    }
  }
}

// Posts the announcement embed with the two betting buttons. Lists the
// whole squad, and flags linked players on the enemy team if any.
async function announceMatch(guildRow, link, matchRowId, closesAt, squad, rivals) {
  const channel = await clientRef.channels.fetch(guildRow.lol_channel_id);
  const closesTs = Math.floor(closesAt.getTime() / 1000);

  const squadMentions = squad.map((p) => `<@${p.user_id}>`).join(', ');
  const who =
    squad.length > 1
      ? `${squadMentions} are in a live game **together**!`
      : `<@${link.user_id}> (**${link.game_name}#${link.tag_line}**) is in a live game!`;

  // The rare-but-glorious case: linked friends on the enemy team.
  const rivalLine =
    rivals.length > 0
      ? `\n⚔️ Facing ${rivals.map((p) => `<@${p.user_id}>`).join(', ')} on the enemy team! ` +
        `(Bets are on ${squad.length > 1 ? 'the squad' : `<@${link.user_id}>`}'s team.)`
      : '';

  const embed = new EmbedBuilder()
    .setColor(0x0a96aa)
    .setTitle('🎮 Match Detected!')
    .setDescription(
      `${who}${rivalLine}\n\n` +
        `Think they'll win? Put your monies where your mouth is.\n` +
        `Bets pay **2x** and close <t:${closesTs}:R>.`,
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lolbet:win:${matchRowId}`)
      .setLabel('Bet on Win')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`lolbet:lose:${matchRowId}`)
      .setLabel('Bet on Loss')
      .setStyle(ButtonStyle.Danger),
  );

  const message = await channel.send({ embeds: [embed], components: [buttons] });
  await setMatchMessage(matchRowId, message.id);
}

// ---------------------------------------------------------------
// Settlement: have any tracked games finished?
// ---------------------------------------------------------------
async function checkTrackedMatches() {
  const live = await getLiveMatches();

  for (const match of live) {
    // Still in the game? Nothing to do yet.
    const game = await getActiveGame(match.puuid);
    if (game && String(game.gameId) === String(match.riot_game_id)) continue;

    // The game is over — hunt for the result in match history. Results can
    // lag a minute or two behind the game ending, hence the retry counter.
    const result = await findResult(match);

    if (result === null) {
      const attempts = await bumpResultAttempts(match.id);
      if (attempts >= LOL.resultRetryMax) {
        // Give up (remake / API gap): refund everyone.
        const v = await voidMatch(match.id, match.guild_id);
        if (v.voided) {
          await updateAnnouncement(match, {
            color: 0x95a5a6,
            line: `Result never appeared (remake?). All ${v.refunded} bet(s) refunded.`,
          });
        }
      }
      continue;
    }

    // Settle: pay correct bets 2x and update the announcement. Credit the
    // whole squad if this was a group game.
    const s = await settleMatch(match.id, match.guild_id, result.won);
    if (!s.settled) continue;

    const squad = (match.participants ?? []).filter((p) => p.side === 'squad');
    const names =
      squad.length > 1
        ? squad.map((p) => `<@${p.user_id}>`).join(', ')
        : `<@${match.user_id}>`;

    const outcome = result.won ? '🏆 **VICTORY**' : '💀 **DEFEAT**';
    const betLine =
      s.bets === 0
        ? 'No bets were placed.'
        : `${s.bets} bet(s), ${formatCurrency(s.totalWagered)} wagered — ` +
          (s.winners.length
            ? `${s.winners.length} winner(s) paid out!`
            : 'the house takes it all.');

    await updateAnnouncement(match, {
      color: result.won ? 0x2ecc71 : 0xe74c3c,
      line: `${outcome} for ${names}${result.kda ? ` (${result.kda})` : ''}\n${betLine}`,
    });
  }
}

// Looks through the player's recent matches for the tracked gameId and
// extracts their result. Returns { won, kda } or null if not found yet.
async function findResult(match) {
  const ids = await getRecentMatchIds(match.puuid, 3);
  if (!ids || ids.length === 0) return null;

  for (const matchId of ids) {
    // Match IDs look like "NA1_1234567890" — the number is the gameId.
    if (!matchId.endsWith(`_${match.riot_game_id}`)) continue;

    const detail = await getMatch(matchId);
    if (!detail) return null;

    const me = detail.info.participants.find((p) => p.puuid === match.puuid);
    if (!me) return null;

    return {
      won: me.win,
      kda: `${me.kills}/${me.deaths}/${me.assists} on ${me.championName}`,
    };
  }
  return null; // finished game not in history yet — retry next cycle
}

// Edits the original announcement with the outcome and removes the buttons.
async function updateAnnouncement(match, { color, line }) {
  if (!match.message_id || !match.channel_id) return;
  try {
    const channel = await clientRef.channels.fetch(match.channel_id);
    const message = await channel.messages.fetch(match.message_id);
    const embed = EmbedBuilder.from(message.embeds[0])
      .setColor(color)
      .setDescription(line);
    await message.edit({ embeds: [embed], components: [] });
  } catch (err) {
    console.error('Announcement update error:', err);
  }
}

// ---------------------------------------------------------------
// Betting UI: button opens a modal; modal submit places the bet.
// Registered under the 'lolbet' prefix via client.components.
// ---------------------------------------------------------------

// Button click -> show a modal asking for the wager amount.
export async function handleButton(interaction) {
  const [, side, matchRowId] = interaction.customId.split(':');

  const modal = new ModalBuilder()
    // The modal's customId carries the same routing info forward.
    .setCustomId(`lolbet:${side}:${matchRowId}`)
    .setTitle(side === 'win' ? 'Bet on Win' : 'Bet on Loss')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('amount')
          .setLabel(`Wager (${LOL.minBet}–${LOL.maxBet} monies)`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 100')
          .setRequired(true),
      ),
    );

  await interaction.showModal(modal);
}

// Modal submit -> validate and place the bet.
export async function handleModal(interaction) {
  const [, side, matchRowId] = interaction.customId.split(':');
  const raw = interaction.fields.getTextInputValue('amount').trim();

  // Modals only give us text, so validate the number ourselves.
  const amount = Number(raw);
  if (!Number.isInteger(amount) || amount < LOL.minBet || amount > LOL.maxBet) {
    await interaction.reply({
      content: `Enter a whole number between ${LOL.minBet} and ${LOL.maxBet}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await ensureWelcomeBonus(interaction.guildId, interaction.user.id);

  const result = await placeBet(
    Number(matchRowId),
    interaction.guildId,
    interaction.user.id,
    amount,
    side === 'win',
  );

  if (!result.ok) {
    const messages = {
      insufficient: `You don't have ${formatCurrency(amount)} in your wallet.`,
      already_bet: 'You already have a bet on this match.',
      closed: 'Betting has closed for this match.',
      not_live: 'This match has already ended.',
      not_found: 'This match no longer exists.',
    };
    await interaction.reply({
      content: messages[result.reason] ?? 'Couldn\'t place that bet.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `🎟️ Bet placed: **${formatCurrency(amount)}** on **${side === 'win' ? 'WIN' : 'LOSS'}**. Pays 2x if you're right.`,
    flags: MessageFlags.Ephemeral,
  });
}
