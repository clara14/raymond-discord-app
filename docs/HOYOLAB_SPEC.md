# HoYoLAB Integration (Genshin Real Account Data) — Design Spec

Goal: real Genshin account data in Discord — live resin, daily
commissions, realm currency, expedition timers, Spiral Abyss stats, and
an opt-in auto check-in. Powered by HoYoLAB's UNOFFICIAL API (the same
one community tools like Paimon.moe and genshin.py use).

**This spec is security-first on purpose.** It requires storing friends'
HoYoLAB session cookies — real credentials to real accounts. That is a
custody responsibility unlike anything else in the bot, and the design
treats it accordingly. Follow all CLAUDE.md conventions.

---

## 0. Honest framing (put a version of this in the consent flow)

- There is NO official API. HoYoLAB's endpoints are reverse-engineered;
  using them via third-party tools is a ToS gray zone. Community tools
  have done it for years at scale without reported bans, but the risk is
  not zero and belongs to the account owner.
- Mitigations we adopt: gentle request rates (nothing more frequent than
  a human refreshing the app), no write actions except the official
  check-in endpoint (opt-in), immediate hard failure + relink prompt on
  auth errors (never retry-hammer a dead cookie).

## 1. Credential handling — the heart of the spec

### What's stored
HoYoLAB v2 cookies: `ltuid_v2` (numeric account id — NOT secret) and
`ltoken_v2` (the session secret). Never ask for full cookie dumps;
exactly these two, via a **modal** (never a slash-command option —
options linger in the user's client command history).

### Encryption at rest (non-negotiable)
- AES-256-GCM via node:crypto. Key from env `HOYOLAB_CRYPTO_KEY`
  (64 hex chars = 32 bytes); feature politely no-ops without it (the
  established missing-key pattern).
- Per-row random 12-byte IV; store `iv || authTag || ciphertext`
  (base64). GCM's auth tag gives tamper DETECTION on decrypt — a corrupt
  or fiddled row throws instead of returning garbage.
- `lib/secretBox.js`: `seal(plaintext)` / `open(sealed)` — pure-ish,
  heavily unit-tested (roundtrip, wrong key fails, flipped-bit fails,
  IV uniqueness across calls).
- ltoken NEVER appears in: logs, error messages, embeds, metadata,
  or achievement events. Add a test that greps the sealed blob format
  is what's stored (i.e., the module's output, never raw input).
- Key rotation story (document, don't build): decrypt-all + re-seal
  script; losing the key = everyone relinks. Acceptable and stated.

### Schema (additive)
```sql
CREATE TABLE IF NOT EXISTS hoyolab_accounts (
  user_id        TEXT PRIMARY KEY,        -- Discord user (global, like linked_accounts)
  ltuid          TEXT NOT NULL,
  ltoken_sealed  TEXT NOT NULL,           -- AES-GCM sealed
  genshin_uid    TEXT,                    -- resolved on link via game-record roles
  region         TEXT NOT NULL DEFAULT 'os_usa',
  status         TEXT NOT NULL DEFAULT 'active',  -- active | invalid
  checkin_optin  BOOLEAN NOT NULL DEFAULT false,
  resin_alert_at INT,                     -- null = no alerts; else threshold (e.g. 150)
  last_alert_at  TIMESTAMPTZ,             -- alert dedupe
  linked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Consent & lifecycle
- `/genshin link` → consent embed (the framing above, plainly) with a
  Continue button → modal for the two cookies → verify live against the
  API → resolve UID → seal → store. All ephemeral. Reply includes how to
  get the cookies (hoyolab.com → logged in → browser devtools → cookies;
  link a reputable community guide).
- `/genshin unlink` → hard DELETE, confirmed. Mention it in every
  privacy-adjacent reply: leaving takes one command.
- Auth failure anywhere → status='invalid', DM the owner once to relink,
  and STOP all polling for that account until relinked.

## 2. The API client — `lib/hoyolab.js`

The unofficial API requires a signed `DS` header per request:
`DS = t,r,md5("salt=<SALT>&t=<t>&r=<r>")` with the well-known overseas
salt (genshin.py documents it; cite it in a comment). Implement
`generateDS()` as a pure function — deterministic given (salt, t, r),
unit-tested against a known-good tuple.

Headers: DS, x-rpc-app_version (2.x overseas), x-rpc-client_type: 5,
Cookie: `ltuid_v2=...; ltoken_v2=...`.

Endpoints (overseas base `bbs-api-os.hoyolab.com` / `sg-public-api...`;
verify exact hosts against genshin.py source at build time — they drift):
- **daily note** — THE endpoint: current/max resin + full-at timestamp,
  realm currency, commissions done/total, expeditions with timers.
- **game record index** — stats: achievements, days active, characters,
  exploration; also resolves genshin_uid at link time.
- **spiral abyss** (current/previous schedule) — floor, stars, notable
  battles.
- **sign-in claim** (opt-in daily check-in) — the only write.

Response envelope is `{ retcode, message, data }`: retcode 0 = ok;
-100/10001 = invalid cookie (→ invalidate flow); 1009/-5003 variants =
already checked in (success for our purposes); anything else = log +
generic failure. Centralize retcode handling in one place.

## 3. Commands (all replies ephemeral by default — it's YOUR account)

- `/resin` — the flagship: current/max, exact full-at as a Discord
  timestamp, capped warning. Include the derived-regen fallback note: if
  the API errors transiently, show last-known + regen math rather than
  nothing (8 min/resin — derive, don't fail).
- `/genshin notes` — full daily note: resin, realm currency, commissions,
  expeditions.
- `/genshin stats [public]` — game record card; public flag to flex.
- `/genshin abyss` — current cycle floor/stars.
- `/genshin checkin on|off` — auto daily check-in opt-in.
- `/genshin alert <threshold|off>` — resin DM alert opt-in.
- `/genshin link` / `unlink` / `status`.

## 4. Background tasks (one poller, gentle by design)

`src/tasks/hoyolabPoller.js`, self-rescheduling every 30 min:
- **Resin alerts**: for accounts with resin_alert_at set AND status
  active: fetch daily note; if resin ≥ threshold AND last_alert_at older
  than 8h → DM ("resin at 152/200, full <t:...:R>") + set last_alert_at.
  Dedupe by design, not by hope.
- **Auto check-in**: once per day (ride the dailyTasks registry from the
  birthdays spec) for opted-in accounts; DM only on FIRST failure.
- Serial requests with a 2–3s spacing between accounts; ~9 users every
  30 min is far below any plausible threshold, but politeness is policy.

## 5. Privacy rules

- Commands operate on YOUR linked account only. No `/resin @friend` — 
  someone's play-state is theirs (the deliberate contrast with LoL,
  where match data is public by nature).
- Public output only via explicit `public` flags.
- The AI chat gets NO hoyolab tool in v1 — revisit only with per-user
  opt-in, because the bot volunteering your resin count is a privacy
  leak with a personality.

## 6. Achievements (same PR — none may touch credentials)

- `genshin_linked` — "Welcome, Traveler ✨" (common): link. Sweep:
  EXISTS row (status any).
- `resin_capped` — "Resin Overflow 😴" (uncommon, secret): a poll/command
  observes resin at max. Event-only.
- `checkin_faithful` — "Daily Diligence 📋" (rare): 30 successful
  auto check-ins. Needs a tiny counter column or count of checkin log
  rows — prefer a `checkin_count INT DEFAULT 0` on the account row
  (it's operational state, not economy history; storing is fine here).

## 7. Testing requirements

secretBox: roundtrip, wrong-key, tampered-ciphertext, IV uniqueness.
generateDS: known-vector test. Retcode handler: table of retcode →
behavior (ok / invalid-cookie / already-claimed / unknown). Poller alert
logic as pure decision function (resin, threshold, last_alert_at) →
{alert: bool}. Fixture JSON for each endpoint's response shape so
parsers are tested offline. NO test may contain a real cookie.

## 8. Phases

1. secretBox + DS signing + API client with fixtures; /genshin link,
   unlink, status, /resin.
2. notes, stats, abyss commands.
3. Poller: resin alerts; auto check-in on dailyTasks.
4. Achievements + polish (public flags, relink UX).
