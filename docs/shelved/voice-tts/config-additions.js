// Additions for src/config.js when the voice feature is reintegrated.

// Voice / TTS settings for the talking bot.
export const VOICE = {
  maxSpeakChars: 400,  // hard cap on how much text gets synthesized
  idleLeaveMin: 5,     // leave the voice channel after this many idle minutes
};

/**
 * Pure function: prepares text for speech synthesis.
 * Strips things that sound terrible read aloud — mentions, custom emoji,
 * URLs, markdown markers — collapses whitespace, and truncates to the cap.
 */
export function sanitizeForSpeech(text) {
  const cleaned = text
    .replace(/<a?:\w+:\d+>/g, '')        // custom emoji like <:pog:12345>
    .replace(/<@!?&?\d+>/g, '')           // user and role mentions
    .replace(/<#\d+>/g, '')               // channel mentions
    .replace(/https?:\/\/\S+/g, 'link')   // URLs -> the word "link"
    .replace(/[*_~`|>#]/g, '')            // markdown formatting characters
    .replace(/\s+/g, ' ')                 // collapse runs of whitespace
    .trim();
  return cleaned.slice(0, VOICE.maxSpeakChars);
}
