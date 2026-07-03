// ============================================================
// wordle.js (database) — Atomic guess submission, streaks, and
// rewards for the daily puzzle. The day's word derives from the
// DATABASE's date so it flips consistently for everyone.
// ============================================================

import { pool } from './db.js';
import { withTransaction, lockMoney, insertLedger } from './tx.js';
import { wordOfTheDay, scoreGuess, wordleReward } from '../lib/wordle.js';

const MAX_GUESSES = 6;

/** Today's date string (YYYY-MM-DD) and word, by the database clock. */
export async function getToday() {
  const { rows } = await pool.query(`SELECT CURRENT_DATE::text AS day`);
  const day = rows[0].day;
  return { day, word: wordOfTheDay(day) };
}

/** A player's game row for a given day, or null. Plain read for /wordle board. */
export async function getGame(guildId, userId, day) {
  const { rows } = await pool.query(
    `SELECT guesses, solved FROM wordle_games
     WHERE guild_id = $1 AND user_id = $2 AND day = $3`,
    [guildId, userId, day],
  );
  return rows[0] ?? null;
}

/**
 * Submits one guess, atomically: locks the game row, validates state,
 * scores, appends, and — on a solve — bumps the streak and pays the
 * reward. The guess is assumed pre-validated (length + dictionary) by
 * the command layer.
 *
 * Returns one of:
 *   { ok:false, reason:'done_today' }              (already solved/failed)
 *   { ok:true, solved:true,  marks, attempts, reward, streak, guesses }
 *   { ok:true, solved:false, failed:true,  marks, word, guesses }
 *   { ok:true, solved:false, failed:false, marks, attemptsLeft, guesses }
 */
export function submitGuess(guildId, userId, guess) {
  return withTransaction(async (client) => {
    // Day + word by the database clock, inside the transaction.
    const { rows: dayRows } = await client.query(`SELECT CURRENT_DATE::text AS day`);
    const day = dayRows[0].day;
    const word = wordOfTheDay(day);

    // Money lock (a solve pays out) — taken first, consistent with the
    // rest of the economy.
    await lockMoney(client, guildId, userId);

    // Get or create today's game row, locked against concurrent guesses.
    const { rows: existing } = await client.query(
      `SELECT guesses, solved FROM wordle_games
       WHERE guild_id = $1 AND user_id = $2 AND day = $3
       FOR UPDATE`,
      [guildId, userId, day],
    );

    let guesses = [];
    if (existing.length > 0) {
      if (existing[0].solved || existing[0].guesses.length >= MAX_GUESSES) {
        return { ok: false, reason: 'done_today' };
      }
      guesses = existing[0].guesses;
    }

    // Score this guess and append it to the board.
    const marks = scoreGuess(guess, word);
    const solved = marks.every((m) => m === 'g');
    guesses = [...guesses, [guess.toLowerCase(), marks]];
    const attempts = guesses.length;

    await client.query(
      `INSERT INTO wordle_games (guild_id, user_id, day, guesses, solved)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (guild_id, user_id, day)
       DO UPDATE SET guesses = $4, solved = $5`,
      [guildId, userId, day, JSON.stringify(guesses), solved],
    );

    if (solved) {
      // Streak: same yesterday-continues / gap-resets rule as /daily.
      const { rows: sRows } = await client.query(
        `SELECT streak, (CURRENT_DATE - last_solve) AS days_since
         FROM wordle_streaks WHERE guild_id = $1 AND user_id = $2`,
        [guildId, userId],
      );
      const streak =
        sRows.length === 0 ? 1 : sRows[0].days_since === 1 ? sRows[0].streak + 1 : 1;

      await client.query(
        `INSERT INTO wordle_streaks (guild_id, user_id, last_solve, streak)
         VALUES ($1, $2, CURRENT_DATE, $3)
         ON CONFLICT (guild_id, user_id)
         DO UPDATE SET last_solve = CURRENT_DATE, streak = $3`,
        [guildId, userId, streak],
      );

      const reward = wordleReward(attempts);
      await insertLedger(client, guildId, userId, reward, 'wordle', {
        day, attempts, streak,
      });

      return { ok: true, solved: true, marks, attempts, reward, streak, guesses };
    }

    // Out of guesses: game over, reveal the word (to this player only —
    // the command keeps it ephemeral).
    if (attempts >= MAX_GUESSES) {
      return { ok: true, solved: false, failed: true, marks, word, guesses };
    }

    return {
      ok: true,
      solved: false,
      failed: false,
      marks,
      attemptsLeft: MAX_GUESSES - attempts,
      guesses,
    };
  });
}
