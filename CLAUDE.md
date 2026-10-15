# CLAUDE.md

This file provides guidance to Claude Code when working with the Cortex codebase.

Current version: **2.117.2**. Last brought current 2026-10-14.

## Project Overview

Cortex is a privacy-first federated communication platform inspired by Google Wave with a Firefly aesthetic. Client-server architecture, real-time WebSocket communication, end-to-end encryption, and node-to-node federation.

### Terminology

| Term | Description | Old name |
|------|-------------|----------|
| **Wave** | Conversation container | (unchanged) |
| **Ping** | Individual message | Droplet |
| **Thread** | Isolated reply chain within a wave | Burst/Ripple |
| **Crew** | User group | Group |

Since **v2.82.0** these nouns are an **instance setting**, not a constant. `client/src/config/terminology.js` defines the `firefly` (default) and `standard` presets; only `{ one, many }` is configured per term and every other form — plural, capitalised, title case — is derived, so an admin cannot get the variants out of sync. UI strings go through the `T` proxy / `useTerms()` hook rather than hardcoding "wave" or "ping".

A per-user setting was considered and rejected: support, docs and email all have to agree, so the vocabulary is per-node.

**Tech stack:**
- **Server:** Node.js + Express + WebSocket (`ws`)
- **Client:** React + Vite
- **Storage:** SQLite (production) or JSON files (legacy/dev)
- **Encryption:** Web Crypto API (ECDH P-384 + AES-256-GCM)
- **Native:** Capacitor (Android/iOS) + Electron (desktop) — both load the deployed URL at runtime, so client fixes need a **server deploy** to reach them

---

## Developer Workflow

### Git branching strategy

Three permanent branches with GitHub branch protection enforced:

| Branch | Purpose | PR required | Approvals |
|--------|---------|-------------|-----------|
| `develop` | Active development — all new code merges here | Yes | 0 (self-merge OK) |
| `qa` | Testing/QA — merge from develop | Yes | 1 |
| `master` | Production — merge from qa after QA approval | Yes | 1 (stale reviews dismissed) |

Protection applies to admins too.

**Workflow:**
1. Branch off `develop` (e.g. `feat/file-attachments`, `fix/…`)
2. Apply the version bump at the **start** of feature work, not the end
3. Commit and push the feature branch
4. PR feature → `develop` (always `--base develop`; self-merge OK)
5. PR `develop` → `qa` when ready to test
6. PR `qa` → `master` after QA approval
7. Back-merge `master` → `qa` → `develop` after every release

**Never:** push directly to `develop`/`qa`/`master`, or cherry-pick between them.

### Version numbering

Format `vMAJOR.MINOR.PATCH`. Major = breaking/architecture, minor = features, patch = fixes.

The version lives in **five** places and they must agree:

```
server/package.json                              "version"
client/package.json                              "version"
client/src/config/constants.js                   VERSION
client/android/app/build.gradle                  versionCode 2117002 / versionName "2.117.2"
client/ios/App/App.xcodeproj/project.pbxproj     CURRENT_PROJECT_VERSION 2117002 / MARKETING_VERSION 2.117.2
```

Native build numbers are the version with no dots and a trailing two-digit patch: `2.86.0` → `28600`, `2.113.3` → `2113003`. These were forgotten for every release between v2.31.0 and v2.81.4, which meant no native build could present itself as an upgrade. Don't skip them. Remember `npm install --package-lock-only` in `server/` and `client/` so the lockfiles carry the new version too.

### Testing requirements

Before committing:

```bash
npm test                 # from the repo root: node --test tests/*.test.cjs
cd client && npm run build
pm2 restart cortex-api cortex-web && pm2 logs cortex-api --lines 20
```

Restart **`cortex-web` as well** after every client build. `serve.mjs` holds `index.html` in memory, so a new build isn't served until it restarts. Until then the app hangs at "ESTABLISHING SIGNAL", asking for bundles that no longer exist.

`tests/` holds about 35 suites; most start a disposable server against a throwaway database. Notable ones:

- `review.test.cjs`: sanitization, schema lifecycle, session/auth.
- `media-security.test.cjs`: simulated Jellyfin/Plex upstreams.
- `attachment-access.test.cjs`: the `/uploads` gate, and deleted waves.
- `communities-*.test.cjs`
- `broadcasts.test.cjs` and `broadcast-recording.test.cjs`: fake LiveKit Twirp and S3.

**Security fixes ship with a counterfactual test.** It runs the same scenario with the fix stripped out of a copy of `server.js` and asserts the bug reappears. That proves the main test fails for the right reason.

**CI** (`.github/workflows/ci.yml`, since v2.89.0) runs, on every PR:

- `npm test` and `tools/generate-schema.mjs --check`;
- a client build, checking the service worker was stamped;
- `npm audit --audit-level=moderate` for server and client;
- `tools/secret-scan.py` over the whole history.

It runs on PRs, but merges use `--admin`, so run the tests yourself before merging.

Then test the affected functionality manually. For UI work, drive the real running app headlessly (Chrome DevTools Protocol) at a phone size; it catches what a build cannot. Real-device behaviour (rotation, camera, downloads in the Android app) needs a person with a phone, so say when something is only verified headlessly.

### Documentation requirements

- **CHANGELOG.md** — all detailed changes, kept current with every commit, not just releases. Entries explain *why*, and record what was measured or verified.
- **CLAUDE.md** — workflow and essential architecture only (this file).
- **docs/** — deeper subsystem docs (`API.md`, `DEPLOYMENT.md`, `MEDIA-SECURITY.md`, `BUILD-NATIVE.md`, …).
- After each merge to master: git tag, GitHub release, and a bot announcement in the Cortex Updates wave.

### Release process

1. `git tag vX.Y.Z && git push origin vX.Y.Z`
2. Create the GitHub release with notes.
   - **Server-only release:** publish directly.
   - **With app builds:** create it with `--draft` **before** building, attach the builds, check the APK's `versionCode` and signing certificate, then publish.
   - **Published releases are immutable (HTTP 422).** Deleting one does not free its tag: the tag can never be published again. **Never delete a published release.** If builds were missed, release the same code as the next patch version. Details in `docs/BUILD-NATIVE.md`.
3. **Take a verified database backup before any release that migrates.** Standing rule, no exceptions. Use `tools/backup-release-db.sh <version>`: it snapshots `data/farhold.db` (or `DB_FILE`) and fails unless the copy is non-empty, passes `integrity_check` and has a `users` table. Dev and QA keep a stale empty `data/cortex.db`, which the script used to back up by mistake.
4. Deploy, restarting `cortex-api` **and** `cortex-web`, to dev, QA, port1, farhold and PMP. Verify each from outside:
   - `/api/health` reports the new version;
   - `sw.js` `CACHE_NAME` is `cortex-v<version>`;
   - the main bundle returns 200;
   - a made-up `/assets/…js` returns **404**, not 200 HTML (the v2.60.3 service-worker poisoning incident).
5. Post the release notice to the Cortex Updates wave (plain text — the bot endpoint does not take HTML).

---

## Security Guidelines

**Cortex is a privacy-first platform. Code with a hacker's mindset.**

### Principles

1. **Never trust user input** — sanitize everything with `sanitize-html`
2. **Validate on the server** — client validation is for UX only
3. **Least privilege** — users access only their own data
4. **Defense in depth** — multiple layers
5. **Fail closed** — if a security control is unavailable (e.g. requested database encryption), refuse to start rather than continue unprotected

### Attack vectors to guard against

| Attack | Prevention |
|--------|------------|
| **XSS** | Sanitize all HTML, strict CSP, escape output |
| **SQL injection** | Parameterized queries (better-sqlite3 does this) |
| **CSRF** | JWT in headers, not cookies |
| **Auth bypass** | Always use `authenticateToken`; check session revocation before handlers run |
| **Authorization bypass** | An ID is a *locator*, never a permission — see media access below |
| **Data leakage** | Check permissions before returning data; never log credentials or upstream URLs |
| **Rate-limit bypass** | Apply limiters to all sensitive endpoints |

### Message sanitization

The message allow-list is `img, a, br, p, strong, em, code, pre, video` (`server/server.js`). No headings, no lists, no `b`/`i`. Rich text reaches the user through **client-side markdown rendering at display time** (`client/src/utils/markdown.js`) — stored content stays raw markdown source and no new tags come off the wire.

**Text from the database is entity-encoded** (`sanitizeInput` escapes on the way in). Decode it only at non-HTML exits, such as emails' plain parts, push payloads, `<title>` and React text, with `plainText()` (`client/src/utils/plainText.js`, `server/lib/plain-text.js`). Decoding before HTML output reintroduces XSS; never decoding shows `&amp;` to users (v2.107.0).

**Message processing exists in three copies that drift** — `server/server.js`, `server/database-sqlite.js` (the one production actually uses) and `client/src/components/messages/MessageWithEmbeds.jsx`. Patch all three, or the fix will appear to work in one wave type and not another.

### E2EE

Encrypted pings never reach server-side processing — the server cannot read them by design. Anything that needs message content must happen pre-encryption on the client or post-decryption at render. Features that need server knowledge must be modelled as **explicit metadata**, not inferred from message text.

The unlocked key lives in `E2EEProvider`, above the routes; the unlock gate (`E2EEAuthenticatedApp`) unmounts on full-page routes such as `/about` and `/watch`. So the gate's re-check must keep a key already in memory, and **any sign-out must clear it**. The provider clears it whenever the token goes null, not only when the gate's logout button is used (v2.114.1).

### Media access (v2.86.0)

Jellyfin/Plex playback requires an item-specific, **wave-scoped grant** (`media_shares`), and all playback is **proxied through Cortex** so upstream credentials never reach a client. `server/lib/media-access.js` holds the authorization decision, `server/lib/media-proxy.js` the transport and HLS URI rewriting. A connection ID, item ID or copied embed URL grants nothing on its own. Full model in `docs/MEDIA-SECURITY.md`.

### Attachments (v2.104.0, v2.113.3)

- **The gate.** Files under `/uploads` are rows in `attachments`. A file **bound** to a wave is served only to people who can read that wave, checked on every request. Media elements authenticate with a 15-minute HttpOnly cookie from `POST /api/attachments/session`.
- **Unbound files stay public:** avatars, profile media, pre-v2.104 uploads, and anything in a public wave.
- **Recordings** (voice and video messages) are served from `/api/media`, which applies the same check through `attachmentRefusal()`, the one function both routes call (v2.116.2). Any new route that serves stored files must call it too.
- **S3 storage (v2.117.0)** hands out the same Cortex URLs as local storage. A file not on disk is streamed from the private bucket by `storage.stream()`, after the check. Never return a bucket URL. Deletes go through `lib/s3-delete.js`, which removes **every version**: on B2 a plain delete only hides the file.
- **Uploads.** Every upload goes through `uploadFile()` (`client/src/utils/uploads.js`, which gives progress, the refresh guard and cancel) and sends `waveId`. Binding fails closed: if it can't be written, the file is deleted.
- **Encrypted waves.** The client binds after decrypting, via `/api/attachments/bind`. Only the uploader may bind, because binding restricts the file.
- **Deleted waves** cascade their `attachments` rows away. A trigger writes `attachment_tombstones`, `/uploads` refuses tombstoned paths, and a sweep deletes the files.
- **Never treat "a file with no row" as orphaned:** that also describes every legitimate legacy upload. Act only on what a trigger recorded, the same pattern as `recording_deletions`.

### Security checklist for new features

- [ ] All user input sanitized before storage
- [ ] Authentication required on sensitive endpoints
- [ ] Authorization checked — can *this* user access *this* resource?
- [ ] Rate limiting applied where appropriate
- [ ] No sensitive data in logs or error messages
- [ ] E2EE respected (encrypted content stays encrypted on the server)
- [ ] Server-side enforcement — the client hiding a control is a courtesy, never the control

### When you find a security issue

1. Note it immediately in the code or commit message
2. Fix it before completing the feature if possible
3. If complex, create a follow-up task with a `[SECURITY]` prefix

---

## Development Commands

### Root
```bash
npm test                 # node --test tests/*.test.cjs
```

### Server
```bash
cd server
npm install
npm start                # production server (port 3001)
npm run dev              # node --watch
```

### Client
```bash
cd client
npm install
npm run dev              # Vite dev server (port 3000)
npm run build            # atomic production build (see below)
npm run build:inplace    # in-place build with a raised heap limit, for low-RAM boxes
npm start                # serve.mjs — static server for dist
```

`npm run build` runs `scripts/build.mjs`, which builds into `dist.staging`, injects the service-worker asset manifest there, and only then swaps it into `dist`. A failed build leaves the previous `dist` untouched. This matters because the dev box serves `client/dist` straight out of the working copy — an in-place build 404s the live site for its duration, and the service worker then falls back to a cached shell that may be several versions old.

Production VPS nodes can OOM on a remote client build; ship a locally built `dist` or use `build:inplace`.

### Native
```bash
cd client
npm run cap:sync
npm run cap:build:android        # or :aab
npm run electron:build           # :win / :mac / :linux
```

### PM2 (production)
```bash
pm2 restart cortex-api           # backend
pm2 restart cortex-web           # static client
pm2 logs cortex-api --lines 50
```

---

## Core Architecture

### Server

- **`server/server.js`** (~27k lines) — single-file Express app in `// =====` sections: configuration, security middleware, API routes by feature, WebSocket server.
- **`server/database-sqlite.js`** (~15k lines) — SQLite wrapper and the schema-update logic.
- **`server/lib/`** — extracted modules:
  - `communities/` (domain model, the `authorize()` evaluator, limits);
  - `media-access.js` and `media-proxy.js`;
  - `broadcast-recording.js` (LiveKit Egress to S3);
  - `wave-roles.js`, `plain-text.js`, `reserved-handles.js`, `field-crypto-health.js`;
  - the field-level crypto helpers (`crew-membership-crypto.js`, `wave-participation-crypto.js`, `push-subscription-crypto.js`, `crawl-secret-crypto.js`).
- **`server/email-service.js`**, **`storage.js`**, **`holidays.js`**.

### Client

`client/CortexApp.jsx` is a ~60-line shell; the UI lives in `client/src/`:

```
src/views/        AuthProvider, MainApp, AppContent, LoginScreen, public + cross-port views
src/components/   admin calendar calls categories compose contacts crawl effects feed focus
                  groups media messages modals notifications profile reports search session
                  settings ui waves
src/hooks/        useAPI useWebSocket useTheme useTerms usePullToRefresh useSwipeActions
                  useVoiceCall useSystemBack …
src/utils/        markdown embed media html storage waveCache sessionRefresh stepUp pwa …
src/config/       constants themes terminology emojiData holidays
```

E2EE lives in `client/crypto.js`, `e2ee-context.jsx` and `e2ee-components.jsx`.

**Loading.**
- **Lazy loading.** Heavy or rare screens load on demand through `lazyComponent()` (`src/utils/lazyComponent.jsx`): LiveKit, hls.js, admin, the login screen and the broadcast pages.
- **Public pages are deliberately eager.** `/events` and `/portal` stay in the main bundle because `serve.mjs` puts a readable copy of them inside `#root` for readers without JavaScript. A lazy page would replace that copy with a spinner.
- **`client/serve.mjs` is the production static server.** It composes per-page `<head>` metadata, the no-JavaScript fallback, trailing-slash routes and real 404s for missing assets. Never replace it with `pm2 serve --spa`.

**Native.** The Android app has local Capacitor plugins (`CortexOrientation`, v2.113.0) registered in `MainActivity` before `super.onCreate`. Reach them through `window.Capacitor` and never `import '@capacitor/core'`, which stubs `window.Capacitor` in browsers. See `docs/BUILD-NATIVE.md`. The installed app's version (`App.getInfo`, or `electronAPI.getAppVersion` on desktop) is shown in Settings → About; `VERSION` is always the server's build (v2.114.0).

### Database

SQLite via better-sqlite3. Tables include users, user_sessions, user_encryption_keys, waves, wave_participants, wave_encryption_keys, wave_mutes, pings, ping_read_by, groups, group_members, contacts, notifications, events, media_shares, instance_config, crawl_config.

**`server/schema.sql` is GENERATED.** Never hand-add a table to it. Schema changes go into the update logic in `database-sqlite.js`, then:

```bash
node tools/generate-schema.mjs            # regenerate
node tools/generate-schema.mjs --check    # verify only (CI-shaped)
```

Migrations are applied idempotently at boot from within `database-sqlite.js` rather than as numbered files, so a fresh install and a migrated one must end up identical — that is exactly what `--check` verifies.

### Communities (v2.94.0–v2.108.0)

A first-class layer of Community → channel → waves (a channel **contains** waves; it is not itself a wave). Anyone can create one. It is an opt-in instance feature.

- **Authorization:** one evaluator, `server/lib/communities/authorize.js`. Channel overrides pool, and deny wins.
- **Remote members** join with their home identity. Their standing is re-checked with their home node, so suspending or unpairing reaches them.
- **Ownership** transfers by offer and accept.
- **Design docs:** `docs/communities/`. The audit register is in `docs/SECURITY-AUDIT-STATE.md` and the Communities docs.

### Live broadcasts (v2.109.0–v2.113.1)

A member streams to a wave through LiveKit; viewers get hidden, subscribe-only tokens.

- **Opt-in instance feature `broadcasts`,** off by default because each viewer costs LiveKit minutes. Public links need `publicPortal`.
- **Recording:** LiveKit Egress writes the room composite straight into a private S3/B2 bucket (`RECORDING_S3_*`). Viewers stream it through `/api/recordings/:id/stream`, which checks membership on each request. A sweep settles finished recordings every 30 s.
- **Deleted broadcasts:** a trigger queues their files in `recording_deletions`.
- **The studio** (`BroadcastStudio.jsx`) publishes the moment it opens. So orientation is chosen in the Go Live dialog, locked inside the START tap, and carried as `?orientation=`. Camera zoom uses the track's `zoom` capability.

### Federation

Node-to-node, **push-only and opt-in**. There is no discovery, join or subscribe path by design: a receiving node cannot request a wave. Consequences worth remembering — a port allied after a wave was promoted never received it (hence the v2.83.0 re-broadcast action), and settings that don't travel with the broadcast payload arrive at permissive defaults on the far side.

### Role-based access control

Hierarchy **Admin > Moderator > User**.

| Role | Level | Permissions |
|------|-------|-------------|
| **User** | 1 | Normal access to own data |
| **Moderator** | 2 | Reports, warnings, user management, activity log |
| **Admin** | 3 | Moderator permissions + handle requests, crawl bar, alerts, federation, public portal, instance config, role assignment |

```javascript
// server.js
const ROLES = { ADMIN: 'admin', MODERATOR: 'moderator', USER: 'user' };
if (!requireRole(user, ROLES.MODERATOR, res)) return;   // 403 if below
if (hasRole(user, ROLES.ADMIN)) { … }                   // boolean

// client — constants.js
if (canAccess(user, 'moderator')) { … }
```

`role` column on users; the first user gets `admin`.

### Instance configuration

Preferences resolve in **three layers: code default ← instance default ← user override**. Store **only explicit overrides** — `null` clears an override, and `false` is a real value, not an absence. Feature switches (videoFeed, crawlBar, calendar, publicPortal, registration) are enforced **server-side with 403**; hiding the UI is not the control. Public read via `GET /api/instance-config`.

**Opt-in instance features** (off unless an admin enables them) are listed in `INSTANCE_OPT_IN_FEATURES`: `publicServerEvents`, `communities` and `broadcasts`.

Instance-level settings also cover branding, terminology, notification defaults, security policy and **timezone** — naive event times are interpreted in the instance zone, not the server's, because a UTC box rolls "today" over at the wrong moment for its users.

### Sessions and auth (v2.75.0)

The access token is **not** the session. A 1-hour rotating access token sits on top of a 90-day sliding refresh-token session, with reuse detection that revokes an entire token family on replay, step-up re-auth for sensitive actions, new-device email alerts, and password change ending all other sessions.

Every path that completes an authentication must go through `issueAuthCredentials` — it was wired only into `/api/auth/login` until v2.81.2, so most users silently kept getting legacy long-lived JWTs.

---

## Environment Variables

See **`server/.env.example`** (heavily commented) for the full list, including LiveKit and broadcast recording. Core:

```bash
PORT=3001
JWT_SECRET=…                 # openssl/crypto randomBytes(64)
ALLOWED_ORIGINS=https://your-domain.com
USE_SQLITE=true

FEDERATION_ENABLED=true
FEDERATION_NODE_NAME=cortex.example.com

# GIF provider (Tenor was shut down by Google in 2026)
GIF_PROVIDER=giphy           # giphy | klipy | both | tenor (legacy)
GIPHY_API_KEY=…
KLIPY_API_KEY=…

# Field-level encryption keys — openssl rand -hex 32 each
EMAIL_ENCRYPTION_KEY=…
WAVE_PARTICIPATION_KEY=…
PUSH_SUBSCRIPTION_KEY=…
CREW_MEMBERSHIP_KEY=…

# Push
VAPID_PUBLIC_KEY=…
VAPID_PRIVATE_KEY=…
VAPID_EMAIL=mailto:admin@example.com
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json   # native push

# Email — cloud hosts block SMTP outright, so production nodes send over
# HTTPS via Resend. SMTP_* remain supported for self-hosted mail.
EMAIL_PROVIDER=resend
EMAIL_FROM=cortex@example.com
RESEND_API_KEY=re_…
SMTP_HOST= SMTP_PORT= SMTP_USER= SMTP_PASS= SMTP_SECURE=

# Voice/video calls and live broadcasts (LiveKit) — no client rebuild; each
# node needs its own project. Broadcasts additionally need the instance feature.
LIVEKIT_URL=wss://….livekit.cloud
LIVEKIT_API_KEY=…
LIVEKIT_API_SECRET=…

# Broadcast recording — all five, or recording is not offered. Private bucket.
RECORDING_S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com
RECORDING_S3_REGION=…  RECORDING_S3_BUCKET=…
RECORDING_S3_ACCESS_KEY=…  RECORDING_S3_SECRET_KEY=…
```

The crawl bar is **no longer configured here** — as of v2.80.0 its feeds, keys, symbols and intervals live in the database and are edited under Settings → ADMINISTRATION → CRAWL BAR CONFIG.

---

## Testing Accounts

With `SEED_DEMO_DATA=true` (password `Demo123!`): `mal` (admin), `zoe`, `wash`, `kaylee`, `jayne` — five accounts, one crew, five waves, five pings. `inara`, `simon` and `river` were listed here but have never been in `seedDemoData`.

---

## Firefly Aesthetic Theme

Dark green terminal aesthetic — background `#050805`, amber accent `#ffd23f`, status green `#0ead69`, monospace type, CRT scanlines and phosphor glow. All colours are CSS variables; themes live in `client/src/config/themes.js`, and operators can pick a separate public theme for `/portal` and `/events`.

Email is the deliberate exception: **emails are plain and light**, system fonts, dark text on white. Dark HTML email does not survive Outlook, Gmail or Apple Mail.

---

## Reference

- **CHANGELOG.md** — complete version history with technical detail
- **docs/API.md** — API endpoints
- **docs/DEPLOYMENT.md** — hardened VPS deployment, hardware sizing, broadcasts/recording setup, release backups
- **docs/PRIVACY.md** — what the software stores and who can see it (keep it true when features change)
- **OUTSTANDING-FEATURES.md** — the roadmap
- **docs/MEDIA-SECURITY.md** — Jellyfin/Plex grant model and proxy
- **docs/BUILD-NATIVE.md** — Electron and Capacitor builds
- **README.md** — user-facing documentation
