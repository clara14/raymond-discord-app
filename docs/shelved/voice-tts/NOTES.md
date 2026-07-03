# Shelved feature: Voice / TTS (the talking bot)

Built and verified on 2026-07-01, then shelved by choice. Everything needed
to bring it back lives in this folder. The code here is NOT loaded by the
bot — the command/event auto-loaders only scan `src/`.

## What it was

- `/join` — summon the bot to your current voice channel
- `/leave` — dismiss it
- `/say <text>` — speak text aloud via local TTS (Piper), auto-joining if needed
- Optional integration: while in voice, the AI chat replies (@mention) were
  spoken aloud too. **Shelving reason:** didn't want every chat reply audible.
  If revived, consider bringing back only `/say` (explicit speech on demand)
  and skipping the chat integration — that was the specific objection.

## Files in this folder

- `voice.js` → goes to `src/lib/voice.js` (connection manager, speech queue, idle auto-leave)
- `tts.js` → goes to `src/lib/tts.js` (spawns the Piper binary; text in, WAV out)
- `commands/join.js`, `commands/leave.js`, `commands/say.js` → go to `src/commands/voice/`

## Reintegration checklist

1. Move the files to the locations above.
2. Dependencies: `npm install @discordjs/voice libsodium-wrappers opusscript`
   (and optionally `ffmpeg-static`; system ffmpeg via `apt install ffmpeg` is
   preferred and was verified working).
3. Add the voice intent in `src/index.js`:
   `GatewayIntentBits.GuildVoiceStates`
4. Re-add to `src/config.js`: the `VOICE` settings object and the
   `sanitizeForSpeech()` helper (both preserved in `config-additions.js` here).
5. `.env`: add `PIPER_PATH` (piper binary) and `PIPER_VOICE` (.onnx model path).
   Piper: https://github.com/rhasspy/piper — `en_US-lessac-medium` is a good default.
6. (Optional, was the objectionable part) chat-speaks-aloud: in
   `src/events/messageCreate.js`, after the text reply, call
   `if (inVoice(message.guildId)) speak(message.guildId, reply)`.
7. `npm run deploy` to register the three commands.

## Verified when shelved

- All imports and command loading passed.
- @discordjs/voice dependency report: opus (opusscript), encryption
  (libsodium-wrappers), and system ffmpeg with libopus all detected.
- `sanitizeForSpeech` unit tests passed (mentions/emoji/URLs/markdown
  stripping, whitespace collapse, 400-char truncation).
- NOT tested (needs real hardware): a live Discord voice connection and
  Piper synthesis itself.
