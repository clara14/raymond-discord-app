// ============================================================
// voice.js (lib) — Voice connection manager.
// One connection + audio player per guild, a speech queue so
// utterances never talk over each other, and an idle timer so
// the bot politely leaves after a quiet spell.
// Destination when reintegrated: src/lib/voice.js
// ============================================================

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import { synthesize } from './tts.js';
import { sanitizeForSpeech, VOICE } from '../config.js';

// Per-guild voice state, keyed by guild ID.
const sessions = new Map();

/** Whether the bot currently has a voice session in this guild. */
export function inVoice(guildId) {
  return sessions.has(guildId);
}

/** Joins a voice channel and sets up the session (player, queue, timers). */
export async function join(channel) {
  const guildId = channel.guild.id;

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true, // we talk, we don't listen
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
  });
  connection.subscribe(player);

  const session = { connection, player, queue: [], speaking: false, idleTimer: null };
  sessions.set(guildId, session);

  player.on(AudioPlayerStatus.Idle, () => {
    session.speaking = false;
    playNext(guildId);
  });
  connection.on(VoiceConnectionStatus.Disconnected, () => leave(guildId));

  resetIdleTimer(guildId);
  return session;
}

/** Leaves the voice channel and clears all session state for the guild. */
export function leave(guildId) {
  const session = sessions.get(guildId);
  if (!session) return false;

  clearTimeout(session.idleTimer);
  for (const job of session.queue) job.cleanup();
  session.queue = [];

  try {
    session.player.stop();
    session.connection.destroy();
  } catch {
    // Already torn down — fine.
  }
  sessions.delete(guildId);
  return true;
}

// (Re)starts the auto-leave countdown. Any speech activity resets it.
function resetIdleTimer(guildId) {
  const session = sessions.get(guildId);
  if (!session) return;
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => leave(guildId), VOICE.idleLeaveMin * 60_000);
}

// Plays the next queued utterance, if any and if not already speaking.
function playNext(guildId) {
  const session = sessions.get(guildId);
  if (!session || session.speaking) return;

  const job = session.queue.shift();
  if (!job) return;

  session.speaking = true;
  const resource = createAudioResource(job.path);
  session.player.play(resource);
  session.player.once(AudioPlayerStatus.Idle, () => job.cleanup());
}

/**
 * Speaks `text` in the guild's voice channel: sanitize -> synthesize ->
 * enqueue. Returns false if the bot isn't in voice there.
 */
export async function speak(guildId, text) {
  const session = sessions.get(guildId);
  if (!session) return false;

  const cleaned = sanitizeForSpeech(text);
  if (!cleaned) return false;

  const job = await synthesize(cleaned);
  session.queue.push(job);
  resetIdleTimer(guildId);
  playNext(guildId);
  return true;
}
