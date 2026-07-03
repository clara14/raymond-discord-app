// ============================================================
// tts.js (lib) — Local text-to-speech via Piper.
// Spawns the piper binary on this machine: text goes in on
// stdin, a WAV file comes out. No cloud, no cost, no API key.
// Destination when reintegrated: src/lib/tts.js
// ============================================================

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Binary and voice model come from .env so the deployment controls them.
const PIPER_PATH = process.env.PIPER_PATH || 'piper';
const PIPER_VOICE = process.env.PIPER_VOICE;

/** Whether TTS is configured at all (used for friendly error messages). */
export function ttsAvailable() {
  return Boolean(PIPER_VOICE);
}

/**
 * Synthesizes `text` to a WAV file and returns { path, cleanup }.
 * Call cleanup() once the audio has finished playing to remove the temp dir.
 */
export async function synthesize(text) {
  if (!ttsAvailable()) {
    throw new Error('TTS not configured: set PIPER_VOICE in .env');
  }

  const dir = await mkdtemp(join(tmpdir(), 'tts-'));
  const outPath = join(dir, `${randomUUID()}.wav`);

  await new Promise((resolve, reject) => {
    const proc = spawn(PIPER_PATH, ['--model', PIPER_VOICE, '--output_file', outPath]);

    let stderr = '';
    proc.stderr.on('data', (chunk) => (stderr += chunk));
    proc.on('error', reject); // e.g. binary not found
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`piper exited ${code}: ${stderr.slice(0, 500)}`));
    });

    proc.stdin.write(text);
    proc.stdin.end();
  });

  return {
    path: outPath,
    cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}),
  };
}
