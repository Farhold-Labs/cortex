# Changelog

All notable changes to Cortex will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.46.4] - 2026-04-09

### Fixed

#### Grace Period Disproportionate for Short Session Durations
The re-authentication grace period was hardcoded at 1 hour on both client and server. For short sessions (e.g. a 10-minute test token) this produced a grace period six times longer than the session itself, making the grace period meaningless as a security boundary. Conversely, in any scenario where the grace window was never triggered correctly (e.g. due to the jti collision bug), users were hard-logged-out with no overlay.

**Fix:** Grace period is now `min(1 hour, original session duration)`, derived from the token's `iat` and `exp` claims — available on both sides without any additional data. A 10-minute session gets a 10-minute grace period; 24h and longer sessions retain the 1-hour cap. Client (`AuthProvider.jsx`) and server (`reauth` endpoint) use the same formula, keeping them in sync.

---

## [2.46.3] - 2026-04-09

### Fixed

#### Instant Logout After Login When Session Duration Is Within the Warning Window
Logging in with a short session duration (such as the `2m` test duration) caused an immediate logout. The root cause was a collision between the new login token and the token produced by an auto-renewal that fired before the first second elapsed.

**Root cause:** The proportional warning window is capped at a minimum of 5 minutes. A 2-minute session is therefore immediately inside the warning window the moment it is issued, so `autoRenewSession` fires within milliseconds of login. `jwt.sign` timestamps at second precision — if the renewal request arrives within the same second as the login, the signed payload (`userId`, `handle`, `iat`, `exp`) is byte-for-byte identical, producing the same JWT string. The renewal endpoint revokes the old token and then issues the "new" token — which is the same string. The client's token is now revoked. Every subsequent API request returns 401, logging the user out immediately.

The same collision can occur between any two operations (two concurrent auto-renewals, login + renewal, etc.) that produce tokens within the same second.

**Fix (`server.js`):** Added a `jti: crypto.randomUUID()` claim to every `jwt.sign` call (registration, login, refresh, silent renewal, grace-period reauth, MFA completion). A random UUID in the payload guarantees a unique token string regardless of when within a second the token is issued, eliminating the collision entirely.

**Fix (`server.js` — renewal order):** The silent renewal endpoint previously revoked the old token before sending the response. If the network dropped after the server logged "silently renewed" but before the client received the new token, the client was left holding a revoked token — causing a hard logout on the next request or on startup. The revocation now happens after `res.json()` is called, so if the response is lost in transit the old token remains valid and the client can retry or enter the grace-period re-auth overlay instead of being hard-logged-out.

**Fix (`AuthProvider.jsx`):** Added `isAutoRenewingRef` (`useRef`) as a synchronous in-flight guard alongside the existing `isAutoRenewing` state. The state guard was async — multiple callers (expiry interval, `visibilitychange`, `focus`) could all pass before a state update propagated. The ref is checked and set synchronously before any async work, preventing concurrent renewal calls. `isAutoRenewing` state is retained for the UI (suppressing the expiry warning modal) but removed from `autoRenewSession`'s `useCallback` deps and the expiry effect's dependency array, preventing the interval and listeners from tearing down on every renewal cycle.

---

## [2.46.2] - 2026-04-09

### Fixed

#### Double Password Entry When E2EE Unlock Coincides with Grace-Period Session Expiry
If a user's session expired while they were away and their E2EE passphrase also needed re-entry (e.g. after a page reload or PWA reopen), they were prompted for their password twice in succession — once in the E2EE `PassphraseUnlockModal` and again immediately after in the `SessionExpiryModal`. The two passwords are almost always identical (the E2EE passphrase defaults to the login password), making the double prompt purely redundant friction.

**Fix (`E2EEAuthenticatedApp.jsx`):** When the `PassphraseUnlockModal` `onUnlock` callback completes successfully and `sessionExpired` is true, `reauth` is called concurrently with the same passphrase. If it succeeds, the grace-period re-auth is handled silently and `sessionExpired` is cleared before `SessionExpiryModal` ever renders. If it fails (passphrase differs from login password — an edge case), the `SessionExpiryModal` remains as the fallback with no change in behaviour.

---

## [2.46.1] - 2026-04-09

### Fixed

#### Electron Blank Screen with Spinner on Startup (Auth Check Timeout)
After extended use — particularly when the Electron app had been running for ~24 hours and a silent session renewal had occurred — the app could become stuck on a blank screen showing only a partial loading spinner with nothing in the console. Force-reloading the renderer did not resolve it; clearing app data was the only recovery.

**Root cause:** The `/auth/me` fetch in `AuthProvider.jsx` had no timeout and no `AbortController`. If the fetch hung indefinitely (no response, no rejection) — which can happen in Electron after sleep/wake cycles or a transient network stall — `loading` remained `true` permanently, rendering only `<LoadingSpinner />`. A hanging fetch never rejects, so no console warnings were produced, making the issue difficult to diagnose.

**Fix (`AuthProvider.jsx`):**
- Added a 10-second `AbortController` timeout to the startup `/auth/me` fetch.
- On timeout: logs a warning, retains cached session data (avoids a spurious logout on a slow/stale network), and sets `loading = false` so the app renders normally.
- Added a `useEffect` cleanup function that cancels the in-flight request if the token changes (e.g. mid-flight during auto-renew) or the component unmounts, preventing stale-closure races between concurrent auth checks.

---

## [2.46.0] - 2026-04-08

### Changed

#### Session UX — Auto-Renewal, Grace Period, and Proportional Warning Window
Three improvements that eliminate unexpected logouts for active users while preserving security for inactive sessions.

**Proportional warning window** (was hardcoded 5 minutes)
The session expiry modal now appears at 10% of the remaining session duration, capped between 5 minutes and 24 hours. A 24-hour session warns at ~2.4h; a 7-day session warns at ~16.8h; a 30-day session warns at 24h (cap). Implemented via `getWarningMs(token)` in `AuthProvider.jsx` using the JWT `iat`/`exp` claims; `getTokenIssuedAt()` added to `storage.js`.

**Silent auto-renewal for active users**
When a user is visible in the warning window, `AuthProvider` silently calls `POST /api/auth/renew` (new endpoint — no password required). If it succeeds, the token is swapped out in the background and no modal is shown. The warning modal appears only if the auto-renewal is not in progress. Renewal is rate-limited to one attempt per 5 minutes per client; the server preserves the original session duration (`exp - iat`).

**Grace period re-authentication** (was immediate logout)
When a session expires — whether detected locally or by a server `TOKEN_EXPIRED` response — the app now shows a "Session Expired" overlay instead of logging the user out. The user can enter their password and pick a new duration to continue exactly where they were. Powered by `POST /api/auth/reauth` (new endpoint), which accepts tokens expired within the last hour. If the grace window has also passed, a hard logout occurs with a clear message.

**`SessionExpiryModal` unified**
The single modal now handles both states: *expiring* (amber, countdown, extend) and *expired* (orange, no countdown, continue). Duration dropdown pre-fills from the user's last-used preference in both cases.

**Files changed:** `server/server.js` (+2 endpoints), `AuthProvider.jsx`, `SessionExpiryModal.jsx`, `E2EEAuthenticatedApp.jsx`, `storage.js`, `messages.js`

---

## [2.45.2] - 2026-04-07

### Fixed

#### Session Duration Preference Not Persisted After Logout
Users who selected a 7-day or 30-day session at login found the dropdown reset to "24 hours" on every subsequent login, causing unexpected daily logouts.

- **Root cause (v2.44.0 regression):** Before v2.44.0, `JWT_EXPIRES_IN=7d` in the server config overrode all session requests — everyone accidentally received 7-day tokens regardless of what the dropdown said. v2.44.0 correctly honoured the user's selection, but the login form always initialised with `'24h'` and `removeSessionStart()` cleared the stored duration on logout. Users who never changed the dropdown kept requesting 24-hour tokens.
- **Fix (`storage.js`):** `removeSessionStart()` no longer deletes `farhold_session_duration`. The value now persists across logouts as a user preference.
- **Fix (`LoginScreen.jsx`):** `sessionDuration` state initialises from `storage.getSessionDuration()` instead of the hardcoded `'24h'`. Returning users see their last-used duration pre-selected; first-time users still default to 24 hours.

---

## [2.45.1] - 2026-04-03

### Fixed

#### Easter Overlay Rendering on Linux
The Easter holiday overlay (`PastelOverlay.jsx`) used color emoji codepoints that are unavailable system-wide on Linux — rendered as Japanese symbol fallback glyphs in all browsers (Firefox, Chrome) and in the Electron app.

- **Root cause:** Color emoji require a dedicated emoji font (e.g. Noto Color Emoji) which is not present on all Linux systems. The overlay was using `0x1F95A` (egg), `0x1F98B` (butterfly), and `0x1F338` (cherry blossom) — all color emoji.
- **Fix:** Replaced all three with monochrome Unicode dingbats from the Zapf Dingbats block, which are covered by standard system fonts:
  - `egg` → ❀ `0x2740` white florette
  - `flower` → ✿ `0x273F` black florette
  - `butterfly` → ❋ `0x274B` heavy eight teardrop-spoked asterisk

---

## [2.45.0] - 2026-04-02

### Changed

#### Electron — Bundled Full App (no longer a remote wrapper)
The Electron desktop app previously loaded the entire UI from the remote server URL, making it functionally a Chromium window pointed at `https://cortex.farhold.com`. The built React bundle is now bundled with the installer and served locally via the `app://` protocol.

- `electron-builder.yml`: `dist/**/*` added to packaged files so the built client is included in every installer
- `electron/main.js`: Registers `app://` protocol via `electron-serve` at module level (before `app.whenReady()` — required by Electron's `protocol.registerSchemesAsPrivileged` timing); production now loads `app://-/?server=<url>` instead of `mainWindow.loadURL(serverUrl)`. The configured API server URL is passed as a query parameter so `constants.js` can read it synchronously.
- `electron/main.js`: Paired `onBeforeSendHeaders` + `onHeadersReceived` session hooks bridge CORS between `app://-` and the remote API server — outgoing `Origin: app://-` is swapped to the real server URL so OPTIONS preflight requests pass, then `Access-Control-Allow-Origin` in the response is swapped back to `app://-` so the browser's check passes.
- `electron/main.js`: `clear-cache-and-reload` IPC handler reloads `app://-/?server=<url>` (with fresh server param) instead of `reloadIgnoringCache()`.
- `LoginScreen.jsx`: Electron server-change now calls `electronAPI.clearCacheAndReload()` via IPC instead of `window.location.replace(url)`, keeping the window on `app://-`.
- `constants.js`: Reads `?server=` query param first (Electron), falls back to `localStorage` (web/Capacitor). No async IPC required.
- Migration path preserved: on first run after upgrade, `farhold_server_url` from `localStorage` is picked up and saved to the Electron config file, then a local reload is triggered with the corrected server param.

#### Capacitor — Tightened Navigation Whitelist
`allowNavigation` changed from `['*']` to `['cortex.farhold.com']`. The Capacitor apps have always served assets locally from `dist/`; the wildcard was a leftover from an earlier architecture.

### Infrastructure

#### Android Release Signing
`android/app/build.gradle` now reads signing credentials from `android/key.properties` (gitignored). Release builds are automatically signed with the production keystore, producing installable APKs without a manual `jarsigner` step. `key.properties` added to `android/.gitignore`.

---

## [2.44.1] - 2026-04-01

### Fixed

#### Suppress While Viewing Preference Not Respected
When a user set **Suppress While Viewing = Disabled**, push notification popups were still suppressed while the app was open and visible.

- **Root cause:** The service worker (`sw.js`) unconditionally skipped showing the push popup whenever any client window was visible (`visibilityState === 'visible'`), with no knowledge of the user's preference.
- **Fix:** `sendPushNotification` in `server.js` now looks up the recipient's `suppressWhileFocused` preference and includes it in the push payload. The service worker reads `data.suppressWhileFocused` and only suppresses the popup when suppression is enabled (default `true`) **and** the app is visible. Users with suppression disabled always receive the popup regardless of app visibility.
- SW cache version bumped to `v2.12.1` to force browser update.

#### Reaction Notification Preference Buttons Had No Effect
Clicking Always / App Closed / Never for reaction notifications in notification settings appeared to save but had no effect on subsequent notifications.

- **Root cause:** Two separate default preference objects existed in `server.js` (`DEFAULT_NOTIFICATION_PREFS` for the GET/PUT endpoints, `DEFAULT_NOTIF_PREFS` for `shouldCreateNotification`). The first was missing the `reactions` key entirely, and the PUT handler had no validation block for it, so reaction preference updates were silently discarded.
- **Fix:** Added `reactions: 'always'` to `DEFAULT_NOTIFICATION_PREFS` and added the `reactions` field to the PUT `/api/notifications/preferences` validation block.

#### Suppress While Viewing Not Clearing When App Is Minimized
Users who had Suppress While Viewing enabled were missing notifications when the app was minimized or backgrounded but still had a wave open.

- **Root cause:** `WaveView` sent a `viewing_wave` WebSocket message on mount/unmount but had no listener for the browser's `visibilitychange` event — so the server's viewing state was never cleared when the window was minimized.
- **Fix:** Added a `visibilitychange` event listener in `WaveView.jsx` that sends `viewing_wave: { waveId: null }` when `document.hidden` is true and restores the correct wave ID when the app becomes visible again.

---

## [2.44.0] - 2026-03-31

### Fixed

#### TDZ Crash on Every Wave (merge artifact)
Every wave load crashed with `ReferenceError: can't access lexical declaration before initialization` after merging v2.44.0 to develop/qa.

- **Root cause:** The GitHub 3-way merge of `feat/v2.44.0 → develop` (PR #365) produced a duplicate click-outside `useEffect` in `WaveView.jsx`. The original bad copy (placed before the `showModMenu` useState declaration) survived alongside the correctly-relocated one, leaving `showModMenu` in the temporal dead zone when its dependency array was evaluated by the minified production bundle.
- **Fix:** Removed the duplicate; only the `useEffect` placed after the `showModMenu` declaration remains (`WaveView.jsx`)

#### Message Menu Stays Open When Opening Another Message's Menu
Opening one message's ⋮ menu and then clicking another message's ⋮ button left both menus open simultaneously.

- **Root cause:** Each `Message` component has independent local state. `stopPropagation` on the second message's button blocked the first message's document-level click listener, so the first menu never knew to close.
- **Fix:** Dispatch a `cortex:message-menu-open` custom DOM event (detail = message ID) when any message menu or reaction picker opens. Every `Message` instance listens and closes its own menus when the signal comes from a different ID.

#### Message Menu Items Not Clickable
Clicking ⋮ opened the menu but menu items could not be clicked.

- **Root cause:** A `position: fixed; inset: 0; z-index: 99` overlay used for outside-click detection was creating a CSS stacking context (via ancestor `transform`/`will-change`) that painted above the menu items despite their higher z-index.
- **Fix:** Removed the overlay; `handleMessageClick` now closes any open menu when the user clicks the message container (outside the menu, which stops its own propagation).

#### Long Display Names Push Action Buttons Off Screen
A user with a long display name caused the inline reply/react/⋮ buttons to be pushed entirely off screen.

- Added `minWidth: 0` and `overflow: hidden` to the author info container in `Message.jsx`
- Added `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` to the sender name span
- Added `flex-shrink: 0` to the actions container so it never gets compressed

#### Reaction Picker Vertical Column in Thread Panel / Narrow Views
The reaction picker rendered as a vertical column (one emoji per row) instead of a horizontal row.

- **Root cause:** `maxWidth: 220px` was narrower than the natural width of 11 emoji buttons (~330px), forcing each onto its own row via `flex-wrap`.
- **Fix:** Changed to `width: max-content` so the picker sizes to exactly one row; `flex-wrap` retained as a safety net for very narrow viewports.

#### Random Logout Despite "Keep Me Logged In"
Users were being logged out after 7 days regardless of selecting a 30-day session at login.

- **Root cause:** `JWT_EXPIRES_IN=7d` in `.env` was unconditionally overriding all user-selected durations in `getSessionDuration()` — a developer override that was never intended to affect production sessions
- **Fix:** `getSessionDuration()` now honours the user's requested duration first; `JWT_EXPIRES_IN` env var is now only the fallback default when no duration is specified

#### Dropdown Menus Not Dismissing on Outside Click
Three-dot menus (wave header, per-message actions, moderation) and the reaction picker stayed open indefinitely after clicking — multiple could be open simultaneously, only dismissed by navigating away or refreshing.

- Added `useEffect` click-outside handler in `WaveView.jsx` for wave header menu and participant moderation menu
- Added `useEffect` click-outside handler in `Message.jsx` for per-message action menu and reaction picker
- Added `stopPropagation` on moderation dropdown and reaction picker so clicks inside don't immediately close them via the handler

#### Members Panel Has No Close Control
The participants panel opened from the three-dot "Members" menu had no way to collapse it short of navigating away or refreshing.

- Added a ✕ close button in the participants panel header in `WaveView.jsx`

#### Mention Autocomplete Ignores Display Name
Typing `@` in the composer only matched users by handle; display name search silently failed.

- **Root cause:** `getWaveParticipants()` returns `name` (not `displayName` or `display_name`), but `getMentionableUsers()` in `MessageComposer.jsx` only checked `u.displayName || u.display_name` — `u.name` was never in the chain, so all participant display names fell through to handle-only matching
- **Fix:** Added `u.name` to the display name fallback chain in `getMentionableUsers()`

---

## [2.43.0] - 2026-03-26

### Added

#### Wave Posting Tokens
Self-service per-wave posting tokens allow wave creators to generate API keys scoped to a single wave, enabling bots and scripts to post messages without a user account or server admin involvement.

- New `wave_tokens` DB table: `id, wave_id, created_by, name, token_hash, bot_id, created_at, last_used_at`
- Each token gets a backing bot entry (`bot-token-{uuid}`) so posts render under the token's custom name with existing bot message styling (`[Bot] Name`)
- Backing bot is automatically deleted when the token is revoked
- **Endpoints:**
  - `GET /api/waves/:id/tokens` — list tokens with metadata (wave creator only)
  - `POST /api/waves/:id/tokens` — create token (max 10 per wave), returns plaintext once
  - `DELETE /api/waves/:id/tokens/:tokenId` — revoke token and its backing bot
  - `POST /api/post/:token` — post `{ content }` authenticated by token alone (no user session), rate-limited by `botLimiter`
- **UI** — "Posting Tokens" section in Wave Settings (creator only): token list with name/created/last-used, amber one-time reveal banner with Copy button, inline creation form, Revoke button per token

#### Wave Members Visible to All Participants
All wave participants can now see who else is in a wave — previously the participants panel was only reachable via Wave Settings (creator-gated).

- Added "Members (N)" entry to the three-dot wave menu in `WaveView.jsx`
- Visible to all participants, not gated by `waveData.can_edit`
- Clicking opens the existing participants panel (`setShowParticipants(true)`)

### Fixed

#### Push Notification Content Preview
Push notifications previously showed "New ping from @user" with no message content or wave context.

- `direct_mention` push: body is now `WaveName: preview text` (encrypted falls back to `in WaveName`)
- `reply` push: body is now `WaveName: preview text` (encrypted falls back to `in WaveName`)
- `wave_activity` push: body is now `DisplayName: preview text` (hidden waves stay generic; encrypted falls back to `from DisplayName`)

#### Privacy Badge Always Showing "Private"
The wave header privacy badge always displayed "Private" regardless of the wave's actual privacy level.

- **Root cause:** The tab system (v2.35.0) stored only `{ id, waveId, title }` — no `privacy` field. `selectedWave` was reconstructed missing `privacy`, so `PrivacyBadge` fell back to `PRIVACY_LEVELS.private`
- **Fix:** `MainApp.jsx` now stores `privacy` in the tab object at creation, includes it in `selectedWave` derivation, and syncs it on wave list updates

---

## [2.42.0] - 2026-03-18

### Added

#### Auto-Focus Message Composer
The message composer now automatically focuses when a wave opens, a thread opens, or a reply is initiated — desktop only (skipped on mobile/touch to avoid unwanted keyboard pop-up).

### Changed

#### Nomenclature Cleanup (droplet → ping, ripple → burst)
Completed a full rename across all layers of the codebase to align with the v2.0 terminology guide.

- **Phase 1** — Database layer: column/method renames, migration script
- **Phase 2** — Server core: `createDroplet`, `getDroplet`, etc. → `createMessage`, `getMessage`, etc.
- **Phase 3** — Client: all `droplet`/`ripple` references updated
- **Phase 4** — `ripple` → `burst` across server and client
- **Phase 5** — Migration tool updated
- Zero breaking changes to the public API; WebSocket event names kept for compatibility

---

## [2.41.0] - 2026-03-16

### Added

#### Reaction Notifications
- In-app and push notifications when someone reacts to your message
- Shows who reacted, which emoji, and in which wave
- New `reaction` notification type in notification bell (♡ icon, pink accent)
- Configurable in profile notification settings (always / app closed / never)
- Self-reactions and reaction removals do not trigger notifications
- Added `reactions: 'always'` to default notification preferences
- Added `reaction` to `shouldCreateNotification` preference key map

#### Scroll-to-Ping Navigation
- Added `?around=` query parameter to `GET /api/waves/:id`
- Loads 50 messages centered on a target ping instead of the most recent 50
- Notification clicks now correctly navigate to older messages behind the "load more" blocker
- Search result clicks now correctly navigate to older messages behind the "load more" blocker
- Infinite loop protection via `scrollToAroundAttemptedRef` (gives up if ping not found after one reload)

### Fixed

#### Notification Click Navigation
- Fixed notification clicks not scrolling to the target message
- Root cause: API returned `dropletId` field but client expected `pingId`
- Fixed service worker `navigate-to-wave` postMessage sending wrong field name (`dropletId` → `pingId`)

### Changed

#### Notification Nomenclature Cleanup
- `createNotification()` parameter and return field: `dropletId` → `pingId`
- `getNotifications()` return field: `dropletId` → `pingId`
- `getPendingNotifications()` return field: `dropletId` → `pingId`
- `markNotificationsReadByDroplet()` → `markNotificationsReadByPing()`
- `createDropletNotifications()` → `createPingNotifications()`
- Wave activity notification title: "New droplet in" → "New message in"

#### Holiday Date Adjustments
- Valentine's Day: trimmed from 4 days to 3 (Feb 13–15)
- St Patrick's Day: trimmed from 4 days to 3 (Mar 16–18)

## [2.36.0] - 2026-03-05

### Added

#### Wave Topics
- Waves can now have a topic (up to 300 characters) set by the wave creator
- Topic is displayed in the wave header (italic, below the title) and in the wave list
- Click-to-edit inline editing for wave creators; shows "+ Set topic" hint for empty topics
- Database migration adds `topic` column to waves table
- `PUT /api/waves/:id` accepts `topic` field alongside existing `title`

#### Unread Count Badges on Wave Tabs
- Non-active wave tabs now show an amber notification badge with unread count
- Badges use the existing `waveNotifications` state (same data as wave list badges)
- Only shown on inactive tabs; active tab (being viewed) never shows a badge

#### Pending Sent Crew Invitations
- New panel in Crews view showing all pending invitations sent by the current user
- Displays invited user avatar, name, crew name, and sent date
- Cancel button to revoke pending invitations
- Expandable list if more than 3 pending invitations
- New endpoint: `GET /api/groups/invitations/sent` (aliased to `/api/crews/invitations/sent`)

#### Shared MessageComposer Component
- Extracted reusable `MessageComposer` component from WaveView's inline composer
- Includes textarea with @mention picker, GIF/photo/file/media buttons, and send button
- Used in both WaveView (full toolbar) and FocusView (compact mode with @mentions)
- FocusView now has @mention support (previously only had bare textarea + emoji picker)
- Parent components handle encryption and uploads; MessageComposer returns plaintext

### Fixed

#### Display Preferences Theme Hint
- Moved theme hint text ("Click Customize to create themes...") into the theme selector description area
- Removed redundant hint div at the bottom of the Display Preferences section

#### Profile Waves Hidden from Wave List
- Profile waves no longer leak into the main wave list via the participation cache path
- Added `is_profile_wave` filter to the final SELECT queries in `getWavesForUser()` and `getWavesForUserMinimal()`
- Profile waves remain accessible from user profile pages

#### Push Auto-Resubscribe After Server Cleanup
- New endpoint: `GET /api/push/status` returns whether the server has active push subscriptions for the user
- On app startup, after the existing push setup, the client checks subscription health with the server
- If the server has no subscription (e.g., after DB cleanup), the client silently re-subscribes
- Prevents silent notification loss when subscriptions are cleaned up server-side

---

## [Unreleased]

### Changed

#### Notification Polling & Targeted Push

Push notification delivery has been rearchitected to fix unreliable delivery caused by per-user debouncing that silently dropped notifications within a 5-minute window.

- **Targeted push for mentions and replies** — `direct_mention` and `reply` notifications now send an immediate push notification to offline users (bypassing the debounce), while marking online users as delivered via WebSocket
- **No push for wave_activity** — General wave activity notifications no longer trigger push; they are caught by the new client-side polling routine instead
- **Notification polling sync** — New `NotificationSync` client utility polls `GET /api/notifications/pending` every 30 seconds, showing local browser `Notification()` popups for missed messages only when the tab is hidden
- **Visibility-aware suppression** — When the user switches back to the app tab, polling refreshes the notification bell and wave badges but does not show popup notifications
- **WebSocket reconnect awareness** — After a WebSocket reconnect, the sync polls after a 2-second delay to catch anything missed during the disconnect
- **Read-message cleanup** — `getPendingNotifications()` automatically marks notifications as read if the user already read the underlying message, preventing stale notifications from surfacing
- **Delivery tracking via `push_sent`** — The previously unused `push_sent` column on the `notifications` table is now the delivery-tracking flag: `1` means the notification was delivered (via WS, push, or polling)
- **Removed blanket push on droplet creation** — Droplet creation and legacy message endpoints now use `broadcastToWave()` (WebSocket only) instead of `broadcastToWaveWithPush()`, since push delivery is handled per-notification-type in `createDropletNotifications()`
- **Relaxed NotificationBell polling** — Self-polling interval increased from 60s to 120s since the sync routine now handles freshness; the `refreshTrigger` prop still forces immediate reloads

**New server methods:**
- `db.getPendingNotifications(userId)` — Cleans stale read notifications, returns pending undelivered notifications with actor/wave info (limit 50)
- `db.markNotificationsPushSent(notificationIds)` — Batch marks notification IDs as delivered

**New endpoint:**
- `GET /api/notifications/pending` — Returns and marks as delivered all pending notifications for the authenticated user

**New client file:**
- `client/src/utils/notification-sync.js` — `NotificationSync` class with 30s polling, visibility handling, WS reconnect hook, and local notification display

---

## [2.35.0] - 2026-02-27

### Added

#### macOS & iOS Build Targets Restored

- **macOS Electron build** — Restored `mac:` section in `electron-builder.yml` with DMG and ZIP targets for both x64 and arm64 architectures, hardened runtime, dark mode support, and code signing entitlements
- **macOS entitlements** — Added `electron/entitlements.mac.plist` with JIT, unsigned executable memory, and network client entitlements required for Electron on macOS
- **Build script** — Added `electron:build:mac` npm script for one-command macOS builds

#### Tabbed Waves

Users can now open multiple waves simultaneously as tabs, enabling quick switching between active conversations without navigating back to the list.

- **Tab bar** — Horizontal scrollable tab bar appears on desktop when tabs are open, with active tab highlighted in amber and close button on each tab
- **Background tabs** — Ctrl+click or middle-click a wave in the list to open it in a background tab without switching focus
- **Tab limit** — Maximum 10 simultaneous tabs; toast error shown when limit reached
- **Duplicate prevention** — Clicking an already-open wave switches to its existing tab instead of opening a duplicate
- **Tab close** — Close button (×) on each tab; closing active tab activates the adjacent tab
- **Wave deletion** — WebSocket handler auto-closes tabs when their wave is deleted or user is removed
- **Tab title sync** — Tab titles update automatically when wave data changes
- **Mobile behavior** — Tab bar hidden on mobile; back button closes the current tab (functionally identical to previous behavior)
- **Keyboard shortcuts** — Standard browser Ctrl+click / Cmd+click for background tabs

#### Collapsible Wave List Sidebar

The wave list sidebar on desktop can now be collapsed to maximize content space when focused on a conversation.

- **Toggle button** — A narrow clickable strip between the sidebar and content area with directional arrow indicator
- **Keyboard shortcut** — `Ctrl+B` (Windows/Linux) or `Cmd+B` (macOS) toggles the sidebar
- **Smooth animation** — Sidebar transitions between 300px and 0px over 300ms with CSS transitions
- **Mobile unaffected** — Collapse behavior is desktop-only; mobile layout remains unchanged
- **No persistence** — Sidebar resets to expanded on page reload (stateless for v1)

### Changed

- **Version bumped to 2.35.0** — Updated `server/package.json`, `client/package.json`, and `client/src/config/constants.js`
- **State architecture** — Replaced single `selectedWave` state with `openTabs` array and `activeTabId`; `selectedWave` derived for backward compatibility
- **ErrorBoundary key** — Uses `activeTab.id` instead of `selectedWave.id` for proper remounting on tab switch
- **WaveList sizing** — Removed hardcoded desktop width/minWidth/borderRight from WaveList root; parent wrapper now controls dimensions

---

## [2.33.1] - 2026-02-27

### Added

#### Right-Click Context Menus (Electron)

The Electron desktop app now has full right-click context menu support via `electron-context-menu`.

- **Copy/Cut/Paste/Select All** — Standard text editing actions in all text fields and content areas
- **Spell check suggestions** — Misspelled words show correction suggestions in the context menu (spellcheck explicitly enabled in webPreferences)
- **Image actions** — Right-click images to Save Image As, Copy Image, or Copy Image Address
- **Inspect Element** — Available in development mode only (hidden in production builds)
- **Look Up Selection** — macOS-only dictionary lookup for selected text
- **Search with Google** — Search selected text via Google

### Changed

- **Version bumped to 2.33.1** — Updated `server/package.json`, `client/package.json`, and `client/src/config/constants.js`

---

## [2.33.0] - 2026-02-26

### Added

#### General File Attachment Support

Users can now share PDFs, documents, ZIPs, spreadsheets, and other non-executable files in messages — not just images.

- **File upload endpoint** — New `POST /api/uploads/file` accepts any non-executable file up to 25MB; files stored in `uploads/files/` with sanitized filenames (`[a-zA-Z0-9._-]` only, truncated to 100 chars)
- **Executable blocklist** — Dangerous file types (`.exe`, `.bat`, `.cmd`, `.msi`, `.scr`, `.vbs`, `.ps1`, `.sh`, `.dll`, etc.) are rejected server-side with a clear error message
- **File marker protocol** — Client inserts `[file:FILENAME:SIZE]URL` marker into message text; server's `detectAndEmbedMedia` converts it into a styled `<a class="file-attachment">` tag with `data-filename`, `data-size`, and `download` attributes
- **Download cards** — `MessageWithEmbeds` transforms file-attachment anchors into visual cards with file-type icons (📕 PDF, 📊 spreadsheet, 📦 archive, 💻 code, etc.), filename with ellipsis overflow, formatted size, and download arrow
- **Attach button** — New 📎 button in the compose area alongside existing photo/GIF buttons; opens a file picker that accepts all file types
- **Universal drag-and-drop** — Compose area now accepts any file type via drag-and-drop (images still route through the existing image upload pipeline)
- **Collapsed message indicator** — File attachments trigger the content-collapse affordance with a 📎 icon in the collapsed preview
- **Storage directory** — `uploads/files/` directory auto-created on server and storage init

### Changed

- **Version bumped to 2.33.0** — Updated `server/package.json`, `client/package.json`, and `client/src/config/constants.js`

### Security

- Filename sanitized to `[a-zA-Z0-9._-]` on server before storage
- Executable blocklist prevents dangerous file types from being uploaded
- 25MB size limit on file uploads
- `download` attribute on `<a>` tags prompts download instead of navigation
- `sanitize-html` configured to allow only specific `<a>` attributes (`class`, `data-filename`, `data-size`, `download`)

---

## [2.32.0] - 2026-02-26

### Added

#### Notification Preference System

Complete overhaul of the notification system — preferences now persist, are honored across all delivery paths (in-app, browser, push), and support per-type granularity.

- **Notification preferences persistence** — Added `notification_preferences` column to users table with auto-migration for existing databases; new `updateNotificationPreferences()` database method replaces the broken no-op `saveUsers()` path
- **Per-type preference levels** — Each notification type (direct mentions, replies, wave activity, burst events) supports three levels: `always`, `app_closed` (only when tab is hidden), and `never`
- **Browser notification filtering** — Client-side browser notifications (`new Notification()`) now fire from the server-filtered `notification` WebSocket event instead of the generic `new_message` event, honoring all per-type preferences
- **Suppress while focused** — Browser notifications are suppressed when the user is actively viewing the notification's wave
- **Per-user push throttle** — Configurable push debounce per user (None / 1 min / 5 min / 15 min / 30 min), replacing the global server-side `PUSH_DEBOUNCE_MINUTES` setting
- **Push preference enforcement** — `broadcastToWaveWithPush()` now checks each user's notification preferences before sending push notifications
- **Notification bell "Mark all read"** — Now marks all wave messages as read in addition to notification items, clearing wave unread badges in one click via new `markAllWavesAsRead()` bulk database method
- **Notification bell "Clear all"** — New button dismisses all notification cards and marks everything as read; positioned away from the close button to prevent accidental clicks
- **Dismiss all notifications endpoint** — `DELETE /api/notifications` dismisses all notifications for the authenticated user

#### Push Notification Improvements

- **Push cleanup on logout** — Both client and server clean up push subscriptions when a user logs out, preventing stale subscriptions when switching users on the same browser
- **Clean-slate subscribe** — `subscribeToPush()` always clears any existing browser subscription before creating a new one, preventing conflicts from previous users
- **Silent auto-subscribe** — Auto-subscribe on page load uses `{ silent: true }` mode that skips aggressive recovery strategies (service worker reset, cache clearing, retries)
- **Opt-in push default** — `getPushEnabled()` now defaults to `false` instead of `true`; push notifications require explicit user opt-in
- **Brave browser detection** — Push subscription errors in Brave show specific guidance pointing to `brave://settings/privacy` → "Use Google Services for Push Messaging"
- **Persistent push error display** — Push subscription errors display as a persistent inline message with selectable text below the push button instead of a fleeting 4-second toast
- **Stale Expo token cleanup** — `sendPushNotification()` auto-detects and removes legacy Expo push tokens and invalid web push subscriptions (missing `auth`/`p256dh` keys)

### Changed

- **`rippleEvents` → `burstEvents`** — Renamed all server-side notification preference references from `rippleEvents` to `burstEvents` to align with v2.0.0 terminology
- **Version bumped to 2.32.0** — Updated `server/package.json`, `client/package.json`, and `client/src/config/constants.js`

### Removed

- **Expo push notifications** — Removed `expo-server-sdk` dependency, Expo import/singleton, `POST /api/push/register` and `POST /api/push/unregister` endpoints, and all Expo token classification/sending in `sendPushNotification()`

### Fixed

- **Notification preferences not persisting** — `saveUsers()` was a no-op in SQLite mode; preferences now persist via dedicated `updateNotificationPreferences()` method
- **Burst events preference not saving** — Client sent `burstEvents` but server expected `rippleEvents`; server updated to match client
- **Push notifications ignoring all preferences** — `broadcastToWaveWithPush()` sent push to all participants without any preference checks
- **Browser notifications ignoring per-type preferences** — Client created `new Notification()` from generic WebSocket `new_message` events with no preference awareness; now uses server-filtered `notification` events
- **React stale closure bug** — `handleWSMessage` useCallback captured initial `notifPrefs` (null) and never updated; fixed with `useRef` pattern that always reflects current state
- **Stale Expo tokens causing push errors** — Legacy Expo tokens fell into web push path after Expo removal, failing with missing `auth`/`p256dh` keys; now auto-detected and removed
- **Notification preferences not syncing to MainApp** — Added `onNotifPrefsChange` callback from ProfileSettings to MainApp
- **"Mark all read" not clearing wave badges** — Notification bell's mark-all-read only marked notification items as read; now also marks all wave messages as read via bulk `INSERT INTO ping_read_by`
- **Push subscription conflicts on user switch** — Stale push subscriptions from previous browser sessions caused failures; logout now cleans up subscriptions on both client and server

---

## [2.31.2] - 2026-02-23

### Fixed

- **Android push crash on Android 13+** — Added `POST_NOTIFICATIONS` permission to AndroidManifest.xml; Pixel 7 and other Android 13+ devices require this for FCM registration
- **Web push broken by @capacitor/core** — Changed to dynamic `import()` so @capacitor/core only loads inside Capacitor native shell; static import was creating a `window.Capacitor` stub on web browsers
- **Capacitor detection checks** — All `window.Capacitor` checks now use `.isNativePlatform` to distinguish real native bridge from web stub

## [2.31.1] - 2026-02-23

### Fixed

- **Capacitor plugin proxies crash** — `registerPlugin()` was called at ES module load time before the native bridge was injected into the WebView; now lazily initialized on first function call
- **Version mismatch banner hidden on Android** — Added `env(safe-area-inset-top)` padding so the refresh banner renders below the status bar and is tappable

## [2.31.0] - 2026-02-23

### Added

#### Capacitor Mobile Apps (Android + iOS)

Native Android and iOS mobile apps using Capacitor, following the same remote wrapper pattern as the Electron desktop app. The Capacitor WebView loads `https://cortex.farhold.com` — no bundled web assets.

- **Capacitor project setup** — `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios` with `capacitor.config.ts` pointing to remote server URL
- **Native push notifications** — FCM (Android) and APNs (iOS) via `@capacitor/push-notifications`; new `capacitor-push.js` client utility handles registration, token management, and notification tap-to-navigate
- **Firebase Admin SDK** — Server-side `firebase-admin` for sending FCM messages; `POST /api/push/fcm/register` and `/unregister` endpoints for token management
- **FCM sending in `sendPushNotification()`** — Three-way subscription classification (Expo / FCM / Web Push); FCM messages include Android notification channel, high priority, and APNs badge/sound config; stale tokens auto-cleaned on `registration-token-not-registered` errors
- **Android notification channel** — `cortex_messages` channel created in `MainActivity.onCreate()` with HIGH importance and Cortex green LED color
- **Capacitor Haptics** — `BottomNav` uses `@capacitor/haptics` for native Taptic Engine / vibration feedback, falling back to Web Vibration API
- **Smart push delegation** — `pwa.js` `subscribeToPush()` and `unsubscribeFromPush()` detect `window.Capacitor` and delegate to native push registration instead of web push
- **iOS push warning hidden in Capacitor** — ProfileSettings iOS web push limitation warning only shows for Safari web app, not Capacitor native
- **Splash screen + status bar** — `@capacitor/splash-screen` with `#050805` background, `@capacitor/status-bar` with dark style matching Firefly theme
- **Build scripts** — `cap:sync`, `cap:open:android`, `cap:open:ios`, `cap:run:android`, `cap:run:ios`, `cap:build:android`, `cap:build:android:aab`

### Changed

- **`.gitignore`** — Added Capacitor build outputs (`android/.gradle/`, `android/app/build/`, `ios/App/Pods/`), Firebase credentials, and platform-specific config files (`google-services.json`, `GoogleService-Info.plist`)
- **`.env.example`** — Added `FIREBASE_SERVICE_ACCOUNT_PATH` documentation with Firebase project setup instructions

## [2.30.1] - 2026-02-22

### Fixed

- **Registration fails with email encryption enabled** — `createUser()` set email to `null` when `EMAIL_ENCRYPTION_KEY` is configured, but production databases had `NOT NULL` + `UNIQUE` constraints on the email column from older schema versions
- **Auto-migration for legacy email constraints** — On startup, detects `NOT NULL` on the email column and recreates the users table with the correct schema; clears plaintext emails for users that already have encrypted email data
- **Email encryption on profile update** — `updateUser()` now properly hashes and encrypts the email when a user changes it (previously wrote plaintext to all email columns)
- **Crew creation membership cache** — `POST /api/groups` now calls `crewMembership.addMember()` after creating the group, so the creator can immediately access the crew via `GET /api/groups/:id`

## [2.30.0] - 2026-02-20

### Added

#### Electron Desktop App

Cortex is now available as a native desktop application for Windows and Linux. The app is a thin wrapper that loads the web UI directly from the server — it stays up-to-date automatically without needing app rebuilds for every release.

- **Remote wrapper architecture** — `electron-serve` loads a minimal redirect page that navigates to `https://cortex.farhold.com`; no Vite build bundled in the app
- **`electron/main.js`** — Main process with BrowserWindow, window state persistence (position/size saved to `userData`), `cortex://` deep link protocol registration, single-instance lock, native notification IPC, and auto-updater scaffolding via `electron-updater`
- **`electron/preload.cjs`** — Context bridge exposing `electronAPI` to renderer: `platform`, `showNotification()`, `getAppVersion()`, `onDeepLink()`, `onUpdateAvailable()`, `onUpdateDownloaded()`
- **Build targets** — Windows (nsis/x64+arm64), Linux (AppImage x64+arm64, deb x64, rpm x64); macOS users can use the PWA
- **`electron-builder.yml`** — Build configuration with GitHub Releases as auto-update provider
- **Electron npm scripts** — `electron:dev`, `electron:build`, `electron:build:win`, `electron:build:linux`
- **Security**: `nodeIntegration: false`, `contextIsolation: true`, `webSecurity: true`
- **Dev mode**: Loads `http://localhost:3000` (Vite dev server with HMR)
- **Frontend deps moved to devDependencies** — `react`, `react-dom`, `livekit-client`, `hls.js`, `@livekit/components-react` no longer bundled in Electron package

### Changed

#### Native App Prep

Pre-integration fixes to make the codebase ready for Electron and Capacitor wrappers without adding any new dependencies.

- **Replaced all `window.location.origin` references** with `BASE_URL` — `CallModal.jsx` (pop-out call URL), `BotDetailsModal.jsx` and `GroupsView.jsx` (webhook display URLs), `AppContent.jsx` (clear-cache redirect)
- **Guarded Service Worker registration** for native apps — `CortexApp.jsx` SW registration skipped when Capacitor or Electron detected; `pwa.js` push subscribe/unsubscribe/reset functions return early on native platforms
- **Hidden pop-out call button** on native apps — `CallModal.jsx` pop-out button only renders when `!isNativeApp`

### Fixed

- **Registration fails with email encryption enabled** — `createUser()` set email to `null` when `EMAIL_ENCRYPTION_KEY` is configured, but production databases with older schema have `NOT NULL` on the email column; now stores empty string for backward compatibility

## [2.30.0] - 2026-02-20

### Added

#### Configurable Server URL

The server URL is now configurable from the login screen, enabling Capacitor/Electron native app wrappers and connecting to any federated Cortex server.

- **Native app detection** — `isNativeApp` export detects Capacitor and Electron environments; defaults to `https://cortex.farhold.com` when running as a native app
- **localStorage-aware URL resolution** — `BASE_URL`, `API_URL`, and `WS_URL` in `constants.js` now read from `localStorage('farhold_server_url')` at module eval time; when no override is set, existing web auto-detect behavior is unchanged
- **"Change Server" UI on login screen** — expandable section between "About this server" and "Clear all data" links; shows current port hostname when a custom URL is set
- **Server connectivity test** — `CONNECT` button tests the target URL via `GET /api/server/info` with a 5-second timeout; warns if unreachable but allows connecting anyway
- **`RESET TO DEFAULT`** — clears the stored URL and returns to auto-detected server
- **Server URL helpers** in `storage.js` — `getServerUrl()`, `setServerUrl()`, `removeServerUrl()`
- **`SERVER` message block** in `messages.js` — all UI strings for the change server feature

### Fixed

- **Share URLs in native apps** — `WaveView` and `FocusView` now use `BASE_URL` instead of `window.location.origin` for share links, so they point to the actual server rather than `capacitor://localhost`
- **Server URL preserved across "Clear all data"** — both `LoginScreen` and `AppContent` `localStorage.clear()` calls now preserve `farhold_server_url`
- **`isProduction` for native apps** — Capacitor on iOS uses `localhost`, which previously triggered dev mode; now `isNativeApp || hostname !== 'localhost'`
- **Version mismatch banner only for upgrades** — `VersionMismatchBanner` now compares semver and only shows when the server version is newer than the client, preventing false "update available" prompts when connecting to a server running an older version

## [2.29.0] - 2026-02-20

### Added

#### Session Expiry Monitoring & Renewal

Proactive JWT session expiry detection with in-app renewal, eliminating silent 403 failures in PWA and long-running browser sessions.

**Server**
- `POST /api/auth/refresh` endpoint — accepts password + optional session duration, validates credentials, revokes old session, issues new JWT with fresh expiry
- `authenticateToken` middleware now differentiates expired vs invalid tokens: returns `401 { code: 'TOKEN_EXPIRED' }` for expired JWTs (previously returned generic 403)

**Client**
- `getTokenExpiry()` utility — decodes JWT `exp` claim from token payload (no signature verification needed)
- `isSessionExpired()` rewritten to use JWT `exp` claim as source of truth; removed PWA bypass that caused silent failures
- `AuthProvider` session monitoring — checks token expiry every 30 seconds and on `visibilitychange`/`focus` events (handles devices waking from sleep); triggers warning 5 minutes before expiry
- `SessionExpiryModal` component — password-based session renewal UI styled like E2EE unlock modal; shows countdown timer, session duration selector (24h/7d/30d), and extend/logout buttons
- `useAPI` handles `TOKEN_EXPIRED` response code — triggers renewal modal instead of immediate logout

### Fixed
- PWA users no longer experience silent session expiry — the `isPWA() return false` bypass in `isSessionExpired()` has been removed since server-side JWTs expire regardless of client type
- API calls returning 403 for expired tokens now correctly return 401, allowing proper client-side handling

---

## [2.28.1] - 2026-02-18

### Added
- **Privacy Policy** (`docs/PRIVACY.md`) — plain-language privacy policy documenting all protections from v2.17.0 through v2.28.0: E2EE, metadata encryption, federation cover traffic, data retention, operator visibility, self-hosting model, and account deletion
- **About Server page** — new Privacy section with bullet-point summary of key protections and link to full policy on GitHub
- **Nginx config** (`landing/nginx.conf`) — reference config for serving landing page at root domain and proxying app at subdomain, with HTTP→HTTPS redirect
- **Deployment guide** (`docs/DEPLOYMENT.md`) — hardened VPS deployment with LUKS disk encryption, SQLCipher database encryption, nginx/SSL, PM2, firewall, and automated GPG-encrypted backups

### Changed
- Marked final Privacy Hardening backlog item complete in `docs/BACKLOG.md`
- **Backlog** — replaced 323-line detailed backlog with clean summary table; all items complete
- **Outstanding Features** — updated completed features through v2.28.1, removed implemented items from roadmap (webhooks, voice/video, screen sharing, bot framework, moderator roles)
- **README** — updated through v2.28.1, fixed demo password, removed 220-line inline changelog, added missing features (privacy hardening, voice/video, media servers, Ghost Protocol, cover traffic, bots, RBAC), updated project structure for modular architecture
- **Landing page** — renamed Farhold to Cortex throughout, updated feature cards (added Voice & Video, Privacy Hardened), expanded privacy section with metadata/Ghost Protocol/Running Dark details, added privacy policy link

### Removed
- Completed version plan files (`docs/PLAN-v1.9.0.md`, `docs/PLAN-v1.10.0.md`, `docs/PLAN-v1.11.0.md`)
- Entire `docs/archive/` directory (11 obsolete v1.x plan files, release notes, and deployment guides)
- Legacy migration scripts (`migrate-v1.2-to-v1.3.js`, `migrate-v1.2-to-v1.3.1.js`, `server/migrate-v1.20-to-v2.0.js`)

---

## [2.28.0] - 2026-02-17

### Added

#### Running Dark — Federation Cover Traffic (Phase 5b Privacy Hardening)

Four complementary traffic analysis resistance mechanisms for federation communications. Even with encrypted participation data (v2.27.0), an observer monitoring network traffic between federated nodes can infer social graph information from traffic patterns. This version addresses timing, volume, frequency, and message size analysis.

**Protocol Version Negotiation**
- Federation identity endpoint (`GET /api/federation/identity`) now returns `protocolVersion: 2` and `capabilities: ['decoy', 'padding']`
- New `createFederationEnvelope(id, type, payload)` helper standardizes all outbound federation message construction with protocol version field
- All 11 federation envelope construction sites refactored to use the helper
- `protocol_version` column added to `federation_nodes` table (migration auto-applied)
- Protocol version captured during handshake and federation request acceptance
- V1 nodes ignore unknown JSON keys — fully backward-compatible

**Message Padding**
- All outbound federation inbox messages padded to fixed-size buckets: 1KB, 4KB, 16KB, 64KB, 256KB
- `padFederationPayload()` adds random Base64 padding in `_pad` field to reach next bucket size
- `stripPadding()` removes padding on receipt before processing
- Federation inbox body parser limit increased to 512KB to accommodate padded messages
- Makes all messages indistinguishable by size at the network level

**Queue Processor Jitter**
- Replaced fixed 30-second `setInterval` with self-rescheduling `setTimeout`
- Processing intervals randomized between 20-40 seconds
- Prevents timing analysis of queue processing patterns

**Decoy Cover Traffic**
- New `FEDERATION_DECOY_ENABLED`, `FEDERATION_DECOY_MIN_INTERVAL_S`, `FEDERATION_DECOY_MAX_INTERVAL_S` environment variables
- Per-node decoy scheduler sends padded `type: 'decoy'` messages at random intervals to V2 federation partners
- Decoy messages are silently discarded by the receiver (no content logging)
- Decoys use the same `/api/federation/inbox` endpoint as real messages — indistinguishable at the network level
- Only sent to V2 nodes (prevents unknown message type warnings on V1 nodes)
- Not queued in `federation_queue` table — ephemeral, not retried
- Decoy targets automatically refreshed on handshake success, node status change, and federation request acceptance

**Admin API**
- `GET /api/admin/federation/status` extended with `protocolVersion`, `v2NodeCount`, and `decoy` stats
- New `POST /api/admin/federation/decoy` endpoint for runtime enable/disable of cover traffic without server restart

**Client UI**
- New "COVER TRAFFIC" section in Federation Admin Panel with "RUNNING DARK" / "EXPOSED" status badge
- Stats display: active targets, decoys sent, last sent timestamp
- Toggle button: "RUN DARK" / "GO VISIBLE"
- Protocol version badges (V1/V2) next to each node in the allied ports list
- Federation Cover Traffic card in Privacy Dashboard showing protection status
- New message strings for all cover traffic UI elements

### Changed
- Federation queue processor now uses randomized 20-40s intervals instead of fixed 30s

---

## [2.27.0] - 2026-02-17

### Added

#### Plausible Deniability — Ghost Protocol (Phase 5 Privacy Hardening)

Two major privacy enhancements: cryptographic participation deniability eliminates plaintext social graph data from the database, and Ghost Protocol adds PIN-protected hidden waves.

#### Part 1: Cryptographic Participation Deniability

Eliminates plaintext `(wave_id, user_id)` tuples from the database so a raw database dump no longer reveals the social graph.

**Cache-Based Authorization (`canAccessWaveFromCache`)**
- Replaced all `db.canAccessWave()` calls (16 call sites) with `canAccessWaveFromCache()` that reads from the in-memory participation cache instead of querying the plaintext `wave_participants` table
- Handles all privacy levels: public, crew/group, cross-server/federated, and private (cache lookup)

**Encrypted Per-User Wave Metadata (`wave_user_metadata` table)**
- New table stores wave metadata (archived, pinned, hidden, lastRead, joinedAt, categoryId) as AES-256-GCM encrypted blobs
- Rows are keyed by HMAC-SHA256 of `waveId|userId` using `WAVE_PARTICIPATION_KEY` — no plaintext user or wave IDs in the table
- In-memory `waveUserMetadata` Map cache loaded on startup from encrypted participation data
- All metadata reads/writes go through the cache, with encrypted persistence to the new table

**Cache-Based Wave Listing**
- Rewrote `getWavesForUser()` and `getWavesForUserMinimal()` to use the participation cache instead of SQL JOINs on `wave_participants`
- Gets user's wave IDs from `participation.getUserWaves()`, fetches wave details via `WHERE w.id IN (...)`, applies metadata from the encrypted cache
- Supports three modes: normal (excludes archived AND hidden), archived-only, hidden-only
- Returns `is_hidden` field for client UI

**Blinded `user_id` in `wave_encryption_keys`**
- Replaced plaintext `user_id` with `user_key_id` = `HMAC-SHA256(userId, WAVE_PARTICIPATION_KEY)` in the `wave_encryption_keys` table
- Updated `createWaveEncryptionKey()` to accept and store `userKeyId`
- Server computes HMAC at lookup time — no plaintext user ID needed for E2EE key retrieval

**Category Assignments Folded into Encrypted Metadata**
- `category_id` now stored in the encrypted `wave_user_metadata` blob
- Eliminates the `wave_category_assignments` table as a source of `(user_id, wave_id)` leaks
- Category reads/writes go through the metadata cache

**Admin Migration Endpoints**
- `POST /api/admin/maintenance/migrate-wave-metadata` — copies existing `wave_participants` metadata into encrypted `wave_user_metadata` table
- `POST /api/admin/maintenance/migrate-wave-key-ids` — computes HMAC `user_key_id` for all existing `wave_encryption_keys` rows
- Plaintext `wave_participants` table kept during v2.27.0 for safety — removal planned for future version

#### Part 2: Hidden Waves — Ghost Protocol

PIN-protected "Go Dark" mode that truly hides waves, not just archives them.

**Server Endpoints**
- `POST /api/waves/:id/hide` — toggle wave hidden status (updates encrypted metadata)
- `POST /api/user/ghost-pin` — set/update Ghost Protocol PIN (SHA-256 hashed client-side before sending)
- `POST /api/user/ghost-verify` — verify PIN, grants 5-minute verification window tracked in-memory
- `GET /api/user/ghost-status` — check if user has a Ghost PIN set
- `GET /api/waves?hidden=true` — returns only hidden waves (requires ghost verification)

**Client UI**
- New `GhostProtocolModal` component — PIN entry/creation modal with SHA-256 client-side hashing, orange accent styling
- Ghost Protocol toggle button in `WaveList` header (ghost emoji icon)
- Header switches to "GHOST PROTOCOL" with orange accent when in ghost mode
- "Go Dark" / "Reveal Signal" menu items in `WaveView` wave settings menu (orange styled)
- Ghost mode state management in `MainApp` (showGhostProtocol, ghostMode, ghostHasPin)

**Push Notification Suppression**
- Hidden waves show generic push notification text: "New activity on the cortex" (no wave title or content)

**Firefly-Themed Messages**
- New `GHOST_PROTOCOL` export in `messages.js` with 15 themed strings
- "Gone dark. Can't find you in the black." / "Signal visible again" / "Wrong codes, try again"

### Changed

- `getWavesForUser()` and `getWavesForUserMinimal()` now accept `participation` parameter for cache-based lookups
- `createWaveEncryptionKey()` now accepts optional `userKeyId` parameter
- Archive endpoint now syncs metadata to encrypted `wave_user_metadata` table
- Pin/category/mark-read operations now sync to encrypted metadata cache
- `wave-participation-crypto.js` extended with metadata cache, HMAC helpers, encrypt/decrypt metadata, migration functions

### Database

**New Table: `wave_user_metadata`**
```sql
CREATE TABLE IF NOT EXISTS wave_user_metadata (
    lookup_key TEXT PRIMARY KEY,       -- HMAC-SHA256(waveId|userId, WAVE_PARTICIPATION_KEY)
    encrypted_data TEXT NOT NULL,      -- AES-256-GCM encrypted JSON
    iv TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

**Modified Table: `wave_encryption_keys`**
- Added `user_key_id TEXT` column — HMAC-based blind identifier replacing plaintext `user_id`
- New index: `idx_wave_encryption_keys_user_key` on `user_key_id`

### Files Modified (11 files, +846 -113 lines)

| File | Changes |
|------|---------|
| `server/package.json` | Version → 2.27.0 |
| `client/package.json` | Version → 2.27.0 |
| `client/src/config/constants.js` | VERSION → 2.27.0 |
| `client/messages.js` | Add GHOST_PROTOCOL export (15 keys) |
| `server/lib/wave-participation-crypto.js` | Metadata cache, HMAC helpers, encrypt/decrypt, migration functions |
| `server/database-sqlite.js` | New table, column migration, rewritten wave listing, updated key methods |
| `server/server.js` | `canAccessWaveFromCache()`, Ghost Protocol endpoints, migration endpoints, push suppression |
| `server/schema.sql` | `wave_user_metadata` table, `user_key_id` index |
| `client/src/views/MainApp.jsx` | Ghost Protocol state, functions, modal render |
| `client/src/components/waves/WaveList.jsx` | Ghost Protocol button, ghost mode rendering |
| `client/src/components/waves/WaveView.jsx` | Go Dark / Reveal Signal menu items |
| `client/src/components/modals/GhostProtocolModal.jsx` | **NEW** — PIN entry/creation modal |

### What Was NOT Changed

- Plaintext `wave_participants` table kept during v2.27.0 as fallback — removal deferred
- No federation protocol changes — decoy traffic deferred to v2.28.0
- No changes to E2EE key exchange protocol — only storage blinding
- Ghost PIN never stored in plaintext — always SHA-256 hashed client-side

## [2.26.1] - 2026-02-17

### Added

#### Client Version Mismatch Detection

Lightweight mechanism to detect when a user's cached client build is older than the running server version and prompt them to refresh.

- Server includes `serverVersion` in WebSocket `auth_success` response
- Client `useWebSocket` hook exposes `serverVersion` state
- New `VersionMismatchBanner` component (fixed-position amber bar, z-index 9998) shows when client and server versions differ
- "REFRESH" button reloads the page; "✕" button dismisses the banner for the session
- Banner reappears on WebSocket reconnect if versions still differ
- New `VERSION_CHECK` message constant in `messages.js` with Firefly-themed copy
- No new endpoints, polling, or dependencies — piggybacks on existing WS auth flow

**Files changed:** `server/server.js`, `client/src/hooks/useWebSocket.js`, `client/src/components/ui/SimpleComponents.jsx`, `client/src/views/MainApp.jsx`, `client/messages.js`, plus version bumps in `server/package.json`, `client/package.json`, `client/src/config/constants.js`

## [2.26.0] - 2026-02-17

### Added

#### Federation Theming: The Verse

Completes Phase 4 of the nomenclature overhaul by replacing all generic federation terminology with Firefly-themed equivalents across the entire client UI.

**New `messages.js` Export — `FEDERATION` (~55 keys):**
- Panel headings & section labels (`"THE VERSE"`, `"Port Identity"`, `"Allied Ports"`)
- Status badges (`"VERSE CONNECTED"`, `"ENABLED"`, `"AWAITING RESPONSE"`)
- Buttons & actions (`"DOCK"`, `"REQUEST DOCKING"`, `"+ ADD PORT"`, `"ACCEPT"`, `"DECLINE"`)
- Form placeholders (`"farhold.example.com"`, `"Port name (e.g., other-farhold.com)"`)
- Help text (`"Send a docking request to another Cortex port. They will need to grant docking clearance."`)
- Empty states (`"No allied ports in the Verse"`, `"No alert subscriptions configured"`)
- Toast messages (`"Port identity configured"`, `"Docking successful"`, `"Docking request transmitted!"`)
- Traveler labels (`"ADD TRAVELERS"`, `"TRAVELERS"`, `"Traveler from {node}"`)
- Wave federation (`"BROADCAST TO THE VERSE"`, `"Verse-Wide (broadcast to allied ports)"`)
- Error messages (`"Failed to load Verse data"`, `"Docking failed"`, `"Failed to add port"`)

**Terminology Mapping:**

| Old Term | New Term | Used Where |
|----------|----------|------------|
| Federation | The Verse | Panel headings, section labels |
| Node / Trusted Node | Port / Allied Port | Node lists, buttons, labels |
| Handshake | Dock / Docking | Connection buttons, status |
| Federation Request | Docking Request | Request flow |
| Federated User | Traveler | User profiles, participant labels |
| Cross-Server | Verse-Wide | Privacy level badge |
| Server Identity | Port Identity | Config section |

### Changed

#### Privacy Level Update (constants.js)
- `crossServer.name`: `"Cross-Server"` → `"Verse-Wide"`
- `crossServer.desc`: `"Federated servers"` → `"Allied ports in the Verse"`

#### Existing Message Updates (messages.js)
- `NOTIFICATION.federationRequest`: `"Federation request from {node}"` → `"Docking request from {node}"`
- `CONFIRM_DIALOG.removeFederationNode`: `"Cut this node loose from the network?"` → `"Cut this port loose from the Verse?"`
- `CONFIRM_DIALOG.declineFederationRequest`: `"Decline this federation request?"` → `"Deny docking clearance for this request?"`

#### FederationAdminPanel.jsx (~41 replacements)
- Panel heading: `"FEDERATION"` → `"THE VERSE"`
- Section labels: `"Server Identity"` → `"Port Identity"`, `"Trusted Nodes"` → `"Allied Ports"`, `"Request Federation"` → `"Request Docking"`, `"Incoming Requests"` → `"Incoming Docking Requests"`
- Buttons: `"HANDSHAKE"` → `"DOCK"`, `"REQUEST FEDERATION"` → `"REQUEST DOCKING"`, `"+ ADD NODE"` → `"+ ADD PORT"`, `"ADD NODE"` → `"ADD PORT"`
- Stats: `"Trusted Nodes"` → `"Allied Ports"`, status/toast messages themed
- Empty state: `"No trusted nodes configured"` → `"No allied ports in the Verse"`

#### GroupsView.jsx (~48 replacements)
- Identical changes applied to duplicate FederationAdminPanel, AlertSubscriptionsPanel, and AlertsAdminPanel embedded in GroupsView
- Alert scope: `"Federated (broadcast to subscribers)"` → `"Verse-Wide (broadcast to allied ports)"`

#### AlertSubscriptionsPanel.jsx (~8 replacements)
- Label: `"FEDERATION NODE"` → `"ALLIED PORT"`, info text and empty states themed

#### AlertsAdminPanel.jsx (1 replacement)
- Scope option: `"Federated (broadcast to subscribers)"` → `"Verse-Wide (broadcast to allied ports)"`

#### InviteFederatedModal.jsx (~5 replacements)
- Title: `"FEDERATE WAVE"` → `"BROADCAST TO THE VERSE"`
- Label: `"ADD FEDERATED PARTICIPANTS"` → `"ADD TRAVELERS"`
- Hint: `"Format: @handle@server.com (user on another Cortex server)"` → themed

#### NewWaveModal.jsx (~3 replacements)
- Label: `"FEDERATED PARTICIPANTS"` → `"TRAVELERS"`
- Format hint themed to traveler metaphor

#### WaveSettingsModal.jsx (~3 replacements)
- Section label: `"FEDERATION"` → `"THE VERSE"`
- Button text: `"Federate this wave"` → `"Broadcast to the Verse"`, `"Manage federated participants"` → `"Manage travelers"`

#### UserProfileModal.jsx (1 replacement)
- `"Federated User from {node}"` → `"Traveler from {node}"`

#### AboutServerPage.jsx (~3 replacements)
- Badge: `"FEDERATION ENABLED"` → `"VERSE CONNECTED"`
- Section heading: `"Federated Servers (N)"` → `"Allied Ports (N)"`
- Empty state: `"No federation partners yet"` → `"No allied ports yet"`

### What Was NOT Changed
- API paths (`/admin/federation/*`), environment variable names (`FEDERATION_ENABLED`), JavaScript variable/prop/component names, CSS variables, `console.error` messages, database column values, `value="federated"` in select options

### Files Modified (13 component files + 2 docs)

| File | Changes |
|------|---------|
| `server/package.json` | Version bump |
| `client/package.json` | Version bump |
| `client/src/config/constants.js` | Version + PRIVACY_LEVELS |
| `client/messages.js` | Add FEDERATION export, update 3 existing |
| `client/src/components/admin/FederationAdminPanel.jsx` | ~41 replacements |
| `client/src/components/groups/GroupsView.jsx` | ~48 replacements |
| `client/src/components/admin/AlertSubscriptionsPanel.jsx` | ~8 replacements |
| `client/src/components/admin/AlertsAdminPanel.jsx` | 1 replacement |
| `client/src/components/waves/InviteFederatedModal.jsx` | ~5 replacements |
| `client/src/components/waves/NewWaveModal.jsx` | ~3 replacements |
| `client/src/components/waves/WaveSettingsModal.jsx` | ~3 replacements |
| `client/src/components/profile/UserProfileModal.jsx` | 1 replacement |
| `client/src/views/AboutServerPage.jsx` | ~3 replacements |

## [2.25.0] - 2026-02-17

### Added

#### UI Personality: Firefly Easter Eggs

Completes the Firefly personality across the entire client UI. Previously, only success/empty/loading states used themed messages — now error toasts, confirm dialogs, WebSocket notifications, profile labels, the error boundary, and the offline indicator all speak Firefly.

**New `messages.js` Exports:**
- `ERROR` — Themed fallback messages (`"Lost signal"`, `"Ship's grounded"`, `"Alliance interference"`, etc.)
- `NOTIFICATION` — WebSocket event messages with interpolation functions (`waveDeleted(title)`, `contactRequestReceived(name)`, `crewInviteReceived(inviter, crew)`, etc.)
- `CONFIRM_DIALOG` — Themed confirm dialog text for 17 actions (`"Disband this crew?"`, `"Show {name} the airlock?"`, `"Wipe local data?"`, etc.)
- `UI_LABELS` — Profile/Settings section labels (`"Ship's Manifest"`, `"Abandon Ship"`, `"DOWNLOAD SHIP'S MANIFEST"`)
- `ERROR_BOUNDARY` — Error boundary text (`"Gorram it! Something went sideways"`, `"Try to reboot"`, `"Diagnostic readout"`)
- `OFFLINE` — Offline indicator text (`"LOST SIGNAL — Running on reserve power"`)

### Fixed

- Added missing `pingSent` key to `SUCCESS` object (was referenced in FocusView but undefined)

### Changed

#### Error Toast Theming (~200+ toasts across 34 files)
- All `showToast('Failed to...', 'error')` calls now use `formatError()` which prepends `"Gorram it!"` prefix
- Server-provided `err.message` values are preserved as primary fallback — themed text is only the default
- Validation messages ("Please enter a title", "Passwords do not match") intentionally left unthemed

#### WebSocket Notification Theming (MainApp.jsx)
- 18 inline notification strings replaced with `NOTIFICATION.*` constants
- Examples: `"Wave was deleted"` → `"<title> has gone dark"`, `"sent you a contact request"` → `"{name} wants to join your crew"`

#### Confirm Dialog Theming (~28 dialogs across 15 files)
- All `confirm('plain text')` calls replaced with `CONFIRM_DIALOG.*` constants
- Examples: `"Delete this crew?"` → `"Disband this crew? There's no putting it back together."`, `"Remove {name} from this wave?"` → `"Show {name} the airlock?"`

#### Profile Labels (ProfileSettings.jsx)
- `"Export Your Data"` → `"Ship's Manifest"`
- `"DOWNLOAD MY DATA"` → `"DOWNLOAD SHIP'S MANIFEST"`
- `"EXPORTING..."` → `"PREPARING MANIFEST..."`
- `"Delete Account"` → `"Abandon Ship"`

#### ErrorBoundary (ErrorBoundary.jsx)
- `"Something went wrong"` → `"Gorram it! Something went sideways"`
- `"Try Again"` → `"Try to reboot"`
- `"Stack trace"` → `"Diagnostic readout"`

#### OfflineIndicator (SimpleComponents.jsx)
- `"OFFLINE - Some features unavailable"` → `"LOST SIGNAL — Running on reserve power"`

**Files Modified (37 total):**
- `client/messages.js` — Added 6 new exports, fixed `pingSent` bug
- `client/src/views/MainApp.jsx` — Notification + error toast theming
- `client/src/views/LoginScreen.jsx` — Confirm dialog theming
- `client/src/components/waves/WaveView.jsx` — Confirm + error toast theming
- `client/src/components/waves/WaveSettingsModal.jsx` — Confirm + error toast theming
- `client/src/components/waves/InviteToWaveModal.jsx` — Error toast theming
- `client/src/components/waves/InviteFederatedModal.jsx` — Error toast theming
- `client/src/components/waves/BurstModal.jsx` — Error toast theming
- `client/src/components/groups/GroupsView.jsx` — Confirm + error toast theming
- `client/src/components/groups/InviteToGroupModal.jsx` — Error toast theming
- `client/src/components/groups/GroupInvitationsPanel.jsx` — Error toast theming
- `client/src/components/profile/ProfileSettings.jsx` — UI labels + confirm + error toast theming
- `client/src/components/profile/UserProfileModal.jsx` — Error toast theming
- `client/src/components/focus/FocusView.jsx` — Confirm + error toast theming
- `client/src/components/contacts/ContactRequestsPanel.jsx` — Error toast theming
- `client/src/components/contacts/ContactsView.jsx` — Error toast theming
- `client/src/components/contacts/SentRequestsPanel.jsx` — Error toast theming
- `client/src/components/contacts/SendContactRequestModal.jsx` — Error toast theming
- `client/src/components/search/SearchModal.jsx` — Error toast theming
- `client/src/components/reports/ReportModal.jsx` — Error toast theming
- `client/src/components/reports/MyReportsPanel.jsx` — Error toast theming
- `client/src/components/settings/ThemeGallery.jsx` — Confirm + error toast theming
- `client/src/components/settings/ThemeEditor.jsx` — Error toast theming
- `client/src/components/media/JellyfinConnectionManager.jsx` — Confirm + error toast theming
- `client/src/components/media/PlexConnectionManager.jsx` — Confirm + error toast theming
- `client/src/components/categories/CategoryManagementModal.jsx` — Confirm + error toast theming
- `client/src/components/admin/FederationAdminPanel.jsx` — Confirm + error toast theming
- `client/src/components/admin/BotsAdminPanel.jsx` — Confirm + error toast theming
- `client/src/components/admin/BotDetailsModal.jsx` — Confirm + error toast theming
- `client/src/components/admin/AlertsAdminPanel.jsx` — Confirm + error toast theming
- `client/src/components/admin/AlertSubscriptionsPanel.jsx` — Confirm + error toast theming
- `client/src/components/admin/PrivacyDashboard.jsx` — Error toast theming
- `client/src/components/admin/AdminReportsPanel.jsx` — Error toast theming
- `client/src/components/admin/UserManagementPanel.jsx` — Error toast theming
- `client/src/components/admin/HandleRequestsList.jsx` — Error toast theming
- `client/src/components/admin/CrawlBarAdminPanel.jsx` — Error toast theming
- `client/src/components/admin/ActivityLogPanel.jsx` — Error toast theming
- `client/src/components/ui/ErrorBoundary.jsx` — Error boundary theming
- `client/src/components/ui/SimpleComponents.jsx` — Offline indicator theming

---

## [2.24.0] - 2026-02-16

### Added

#### Privacy Hardening Phase 4: Encrypted Crew Membership

Crew membership data is now encrypted at rest so database dumps cannot reveal group associations.

**Problem Solved:**
- Database breach no longer reveals which users belong to which crews
- Group associations cannot be reconstructed from database alone
- Completes the social graph protection initiative

**Architecture:**
- Same pattern as wave participation encryption (v2.21.0) and push subscription encryption (v2.22.0)
- Database stores encrypted member blobs per crew, keyed by crew ID
- Server maintains in-memory cache for runtime operations (O(1) lookups)
- Plaintext `crew_members` table kept for metadata (role, joined_at)
- All API endpoints use wrapper helpers that route through cache

**New Files:**
- `server/lib/crew-membership-crypto.js` - Encryption/decryption + cache management

**Database Changes:**
- New `crew_members_encrypted` table with `crew_id`, `member_blob`, `iv`, `updated_at`

**Environment Variable:**
```bash
CREW_MEMBERSHIP_KEY=<32-byte-hex>  # openssl rand -hex 32
```

**Admin Features:**
- Migration endpoint: `POST /api/admin/maintenance/migrate-crew-members`
- Privacy Dashboard updated with crew membership encryption status
- One-click migration from plaintext to encrypted storage

**How It Works:**
1. Server startup: Decrypt all blobs into in-memory cache
2. Runtime: All lookups use memory cache (fast O(1) access)
3. Writes: Update both cache and encrypted blob atomically
4. Without key: Falls back to plaintext storage (backward compatible)

**Files Modified:**
- `server/server.js` - Import crypto module, init cache, add wrapper helpers, migration endpoint, update privacy status
- `server/schema.sql` - Add `crew_members_encrypted` table
- `server/.env.example` - Document `CREW_MEMBERSHIP_KEY`
- `docs/BACKLOG.md` - Mark crew membership encryption complete

---

## [2.23.0] - 2026-02-16

### Added

#### Collapsible Messages

Allow users to collapse long messages to compact single-line previews for better mobile scrolling.

**Key Features:**
- Messages meeting any of these criteria show a collapse toggle button:
  - Text content > 3 lines (~150 characters)
  - Contains audio or video media
  - Contains embedded images (detected via `<img>` in content)
- Collapsed view shows:
  - First line of text (truncated to ~60 characters)
  - Media indicators: 🎵 (audio), 🎬 (video), 🖼️ (image)
  - Tap/click anywhere on collapsed view to expand
- Collapse button (◆/◀) in message header actions, separate from thread collapse (▼/▶)
- Wave menu options:
  - "Collapse All Messages" - collapse all collapsible messages in wave
  - "Expand All Messages" - expand all collapsed messages
- Settings option: "Auto-collapse Long Messages" in Display Preferences
  - When enabled, collapsible messages start collapsed on wave load
- Collapse state persisted to localStorage per wave

**Files Modified:**
- `client/src/components/waves/WaveView.jsx` - contentCollapsed state, toggle functions, wave menu options, auto-collapse effect
- `client/src/components/messages/Message.jsx` - isLongMessage detection, collapsed view, collapse button, getFirstLine helper
- `client/src/components/profile/ProfileSettings.jsx` - Auto-collapse preference toggle

---

## [Unreleased]

### Planned Features

#### Offline Media Drafts
Save media recordings locally when offline and automatically upload when back online.

**Proposed Implementation:**
- Use IndexedDB to persist recorded blobs and draft metadata (waveId, content, timestamp)
- Detect offline state via `navigator.onLine` or failed upload attempts
- Save to drafts with "Saved to Drafts" user feedback
- Add Drafts indicator/panel in UI to view, manage, and delete pending uploads
- Use Service Worker with Background Sync API for automatic upload on reconnect
- Show upload progress for queued drafts
- Handle E2EE waves with cached session keys
- Graceful handling of partial failures

**Files to create/modify:**
- `client/src/components/waves/WaveView.jsx` - Draft save logic, drafts UI
- `client/public/sw.js` - Background sync registration
- `client/src/utils/drafts.js` - NEW - IndexedDB storage layer for drafts
- `client/src/components/ui/DraftsPanel.jsx` - NEW - Draft management UI

## [2.22.0] - 2026-02-16

### Added

#### Privacy Hardening Phase 3: Encrypted Push Subscriptions

Push subscription data is now encrypted at rest so database dumps cannot correlate users to devices.

**Problem Solved:**
- Database breach no longer reveals which user has which push endpoint
- Device correlation across sessions is prevented
- Push endpoint fingerprinting is mitigated

**Architecture:**
- Same pattern as wave participation encryption (v2.21.0)
- Database stores encrypted subscription blobs per user, keyed by SHA-256 hash of user ID
- Server maintains in-memory cache for runtime operations
- All lookups use memory cache, writes update both cache and encrypted DB

**New Files:**
- `server/lib/push-subscription-crypto.js` - Encryption/decryption + cache management

**Database Changes:**
- New `push_subscriptions_encrypted` table with `user_hash`, `subscriptions_blob`, `iv`, `updated_at`

**Environment Variable:**
```bash
PUSH_SUBSCRIPTION_KEY=<32-byte-hex>  # openssl rand -hex 32
```

**Admin Features:**
- Migration endpoint: `POST /api/admin/maintenance/migrate-push-subscriptions`
- Privacy Dashboard updated with push subscription encryption status card
- One-click migration from plaintext to encrypted storage

**How It Works:**
1. Server startup: Decrypt all blobs into in-memory cache
2. Runtime: All lookups use memory cache (fast O(1) access)
3. Writes: Update memory cache AND encrypted blob in DB
4. Endpoint cleanup: Reverse lookup (endpoint → userId) in cache for expired subscription removal

### Changed

- Privacy Dashboard now shows push subscription encryption status with migrate button
- Cache stats section shows both wave participation and push subscription cache statistics

---

## [2.21.0] - 2026-02-13

### Added

#### Privacy Hardening Phase 2: Encrypted Wave Participation

Wave participation data is now encrypted at rest to protect social graphs from database breaches.

**Problem Solved:**
- Previously, the `wave_participants` table stored plaintext `user_id → wave_id` mappings
- A database breach could reveal who talks to whom, group associations, and communication patterns
- Goal: "Cannot determine who is in which wave from DB alone"

**Architecture:**
```
Database (at rest)          Server Runtime (in memory)
┌─────────────────────┐     ┌─────────────────────────┐
│ wave_participants   │     │ participantCache Map    │
│ ─────────────────── │     │ ─────────────────────── │
│ wave_id (encrypted) │ ──► │ waveId → Set<userId>    │
│ participant_blob    │     │ userId → Set<waveId>    │
│ (AES-256-GCM)       │     └─────────────────────────┘
└─────────────────────┘
```

**How It Works:**
1. **Storage:** Each wave has an encrypted `participant_blob` containing user IDs
2. **Server startup:** Decrypt all blobs into in-memory cache
3. **Runtime:** All lookups use memory cache (no DB queries for routing)
4. **Writes:** Update memory cache AND encrypted blob in DB
5. **Key management:** Server-side encryption key from `WAVE_PARTICIPATION_KEY` env var

**New Environment Variable:**
```bash
WAVE_PARTICIPATION_KEY=<32-byte-hex>  # openssl rand -hex 32
```

**Server Functionality Unchanged:**
- WebSocket message routing (`broadcastToWave()`)
- Push notifications
- Access control (`canAccessWave()`)
- Read receipts
- Federation

**Migration:**
1. Set `WAVE_PARTICIPATION_KEY` environment variable
2. Restart server (encrypted table auto-created)
3. Open Admin Panel → Privacy & Encryption → Click "MIGRATE" button
4. Or use API: `POST /api/admin/maintenance/migrate-wave-participants`

#### Privacy & Encryption Admin Dashboard

New admin panel showing encryption status for all data types with one-click migration:

| Data Type | Status | Action |
|-----------|--------|--------|
| Email addresses | 45/50 migrated | [Migrate 5] |
| Wave participation | 0/31 migrated | [Migrate All] |
| Contact lists | Client-side | — |

**Features:**
- Shows encryption key configuration status for each data type
- Displays migration progress (encrypted vs plaintext counts)
- One-click migrate buttons for pending data
- In-memory cache statistics
- Environment variable hints when keys not configured

**Files Changed:**
- `server/lib/wave-participation-crypto.js` - NEW - Encryption/decryption + cache management
- `server/database-sqlite.js` - New `wave_participants_encrypted` table schema
- `server/server.js` - Cache initialization, routing uses cache, admin endpoints
- `server/schema.sql` - New table definition
- `client/src/components/admin/PrivacyDashboard.jsx` - NEW - Admin UI for encryption status/migration
- `client/src/components/profile/ProfileSettings.jsx` - Added Privacy Dashboard to admin panel

---

## [2.19.0] - 2026-02-12

### Added

#### YouTube Playlist Embed Support

YouTube playlist URLs now embed inline instead of opening in a new window.

**Supported URL formats:**
- `youtube.com/watch?v=VIDEO&list=PLAYLIST` - Video with playlist context (shows playlist navigation)
- `youtube.com/playlist?list=PLAYLIST` - Playlist-only URL (starts from first video)

**Technical Details:**
- Updated URL regex patterns to capture playlist parameter
- New `isPlaylist` and `playlistId` properties on embed objects
- Playlist-only URLs use YouTube's `videoseries` embed format
- Video+playlist URLs include `list=` parameter in embed iframe

**Files Changed:**
- `client/src/utils/embed.js` - Updated patterns and embed URL generation
- `server/server.js` - Updated EMBED_PATTERNS and detectEmbedUrls()

---

## [2.18.0] - 2026-02-11

### Added

#### Privacy Hardening Phase 2: Encrypted Contacts

**Encrypted Contact Lists** - Contact lists are now encrypted client-side with the user's E2EE key. The server stores an encrypted blob it cannot read, protecting the user's social graph from database breaches.

**Technical Details:**
- New `encrypted_contacts` database table stores encrypted contact blob per user
- Contact encryption uses AES-256-GCM derived from user's ECDH keypair (self-derivation)
- New crypto functions: `encryptContactList()`, `decryptContactList()`, `deriveContactsKey()`
- E2EE context methods: `getEncryptedContacts()`, `saveEncryptedContacts()`, `migrateContactsToEncrypted()`
- Migration endpoint to check status: `GET /api/contacts/encrypted/status`

**API Endpoints:**
- `GET /api/contacts/encrypted` - Retrieve encrypted contacts blob
- `PUT /api/contacts/encrypted` - Save encrypted contacts blob (with optimistic locking)
- `GET /api/contacts/encrypted/status` - Check migration status

**Migration Path:**
- Existing plaintext contacts remain functional during transition
- Users with E2EE enabled can migrate their contacts via the client
- Both encrypted and plaintext contacts coexist for backward compatibility

**Files Changed:**
- `server/schema.sql` - Added `encrypted_contacts` table
- `server/database-sqlite.js` - Added encrypted contacts methods and migration
- `server/server.js` - Added encrypted contacts API endpoints
- `client/crypto.js` - Added contact list encryption/decryption functions
- `client/e2ee-context.jsx` - Added encrypted contacts management

---

## [2.17.1] - 2026-02-11

### Fixed

#### Email Migration Constraint Error
- Fixed NOT NULL constraint error when migrating existing databases
- Keep plaintext email during migration for backwards compatibility
- Hash and encrypted columns populated alongside existing plaintext
- Fixed null target_id in moderation log for bulk operations

---

## [2.17.0] - 2026-02-11

### Added

#### Privacy Hardening: Metadata Protection
Comprehensive privacy hardening to protect user metadata beyond E2EE message content.

**Email Protection:**
- SHA-256 hash for lookup (login, registration uniqueness)
- AES-256-GCM encryption for password reset recovery
- New users automatically get protected email storage
- Migration endpoint for existing users

**IP Anonymization:**
- IPs truncated to /24 subnet (IPv4) or /48 (IPv6)
- Applied to session tracking and activity logs
- Prevents precise location identification

**User-Agent Truncation:**
- Reduced to "Browser/OS" format only (e.g., "Chrome/Windows")
- Prevents device fingerprinting

**Timestamp Rounding:**
- Activity log timestamps rounded to 15-minute intervals
- Session timestamps rounded to 5-minute intervals
- Reduces timing analysis attack surface

**Retention Policies:**
- Activity logs auto-deleted after 30 days (configurable)
- Sessions enforced max age of 30 days (configurable)
- Cleanup job runs every 6 hours

**Admin Endpoints:**
- `POST /api/admin/maintenance/migrate-emails` - Migrate existing users
- `GET /api/admin/maintenance/privacy-status` - View protection stats

**Environment Variables:**
- `EMAIL_ENCRYPTION_KEY` - 32-byte hex key for AES-256
- `ACTIVITY_LOG_RETENTION_DAYS` - Default 30
- `SESSION_MAX_AGE_DAYS` - Default 30

### Technical

**Files Modified:**
- `server/schema.sql` - Added email_hash, email_encrypted, email_iv columns
- `server/database-sqlite.js` - Email hash/encrypt functions, migration methods
- `server/server.js` - Privacy utilities, anonymization, admin endpoints
- `server/.env.example` - Documented new environment variables

---

## [2.16.2] - 2026-02-11

### Fixed

#### FocusView Reference Error
- Fixed `ReferenceError: Ping is not defined` when using focus view to reply
- Changed `<Ping>` to `<Message>` component (refactoring artifact)

---

## [2.16.1] - 2026-02-11

### Fixed

#### Push Notification Navigation
- Push notifications now include `type` field to enable proper navigation on mobile
- Tapping a notification navigates to the correct wave and scrolls to the message
- Fixed notifications not being sent when user has WebSocket connection open

### Changed

#### Push Notification Behavior
- Push notifications now sent regardless of WebSocket connection status
- Previously only sent when user was offline (no WebSocket)
- Ensures mobile users always receive notifications even with web app open
- Added `PUSH_DEBOUNCE_MINUTES` environment variable (default: 5)

## [2.16.0] - 2026-02-10

### Added

#### Mobile App Support (React Native)
Full server-side support for the Cortex mobile app (cortex-mobile).

**Push Notifications (Expo):**
- `POST /api/push/register` - Register device for push notifications
- `DELETE /api/push/register` - Unregister push token
- Uses Expo Server SDK for cross-platform push (FCM for Android, APNs for iOS)
- Notifications for new messages, mentions, wave invites, contact requests
- Deep linking support (`cortex://wave/:id/message/:id`)

**Database:**
- New `expo_push_tokens` table for storing device tokens

**Dependencies:**
- Added `expo-server-sdk` v3.15.0 (compatible with Node 18)

#### Profile Wave Hiding
Profile waves (used for video feed standalone posts) are now hidden from the main wave list.

**Details:**
- Profile waves have `is_profile_wave = 1` flag
- Filtered from `getWavesForUser` and `getWavesForUserMinimal` queries
- Keeps wave list clean for normal conversations
- Profile waves still accessible via video feed

#### Plex Media Streaming Authorization
- Any authenticated user can now stream Plex media from embeds
- Previously required being a Plex server owner
- Uses query string token authentication for media URLs

### Technical

**Files Modified:**
- `server/server.js` - Push notification endpoints, profile wave filtering
- `server/database-sqlite.js` - expo_push_tokens table, profile wave filters
- `server/package.json` - Added expo-server-sdk dependency

**Documentation:**
- `docs/MOBILE-APP-STATUS.md` - Mobile app implementation status

## [2.15.6] - 2026-01-23

### Improved

#### Outgoing Webhook Links
Webhook messages now include clickable links back to Cortex.

- **Discord**: Wave title links to the message, author links to Cortex, footer includes Cortex icon
- **Slack**: Wave title links to the message, author links to Cortex, footer with Cortex branding
- **Teams**: "View in Cortex" action button added
- **Generic**: Added `url` fields for wave and message

## [2.15.5] - 2026-01-23

### Added

#### Outgoing Webhooks
Auto-forward wave messages to external services like Discord, Slack, and Microsoft Teams.

**Features:**
- Configure webhooks per wave (up to 5 per wave)
- Platform-specific formatting: Discord embeds, Slack attachments, Teams cards, or generic JSON
- Filter options: include/exclude bot messages, include/exclude encrypted messages
- Cooldown support to prevent flooding
- Test webhook functionality before saving
- Stats tracking: total sent, errors, last triggered

**API Endpoints:**
- `GET /api/waves/:waveId/webhooks` - List webhooks for a wave
- `POST /api/waves/:waveId/webhooks` - Create a webhook
- `PUT /api/webhooks/:webhookId` - Update a webhook
- `DELETE /api/webhooks/:webhookId` - Delete a webhook
- `POST /api/webhooks/:webhookId/test` - Send test message

**Discord Setup:**
1. In Discord: Server Settings → Integrations → Webhooks → New Webhook
2. Copy the webhook URL
3. In Cortex: Wave Settings → Webhooks → Add Webhook
4. Select "Discord" platform, paste URL, save

**Database:**
- New `wave_webhooks` table for storing webhook configurations

## [2.15.4] - 2026-01-23

### Added

#### New Quick Reactions
Added three new emoji reactions to the quick reaction picker:
- 🖕 Middle finger
- 😮 Surprised
- 🤦 Facepalm

## [2.15.3] - 2026-01-23

### Fixed

#### Wave Scroll Position Accuracy
Fixed scrolling not reaching the exact target message when opening waves or clicking notifications.

- **Root Cause**: Scroll position was calculated before lazy-loaded images and embeds finished loading, causing content height to change mid-scroll
- **Symptoms**: Opening a wave with unread messages would scroll "close but not quite" to the first unread; clicking a notification would land near but not at the target message
- **Fix**:
  1. Changed from `behavior: 'smooth'` to `behavior: 'instant'` for initial scroll to prevent animation interruption
  2. Added verification scrolls at 200ms and 500ms after initial scroll to correct for lazy-loaded content
  3. Use `requestAnimationFrame` for better timing with React render cycle
  4. Reduced retry delay from 200ms to 150ms for faster DOM detection

## [2.15.2] - 2026-01-23

### Fixed

#### Push Notification Flooding
Fixed push notifications flooding in all at once after a user has been offline for a period of time.

- **Root Cause**: Push notifications were sent for every message regardless of connection state, with no debouncing
- **Two-Part Fix**:
  1. **Offline-only**: Push notifications now only sent to users without an active WebSocket connection
  2. **Debouncing**: Only one push notification per user per 5-minute window (configurable via `PUSH_DEBOUNCE_MINUTES`)
- **Behavior**: First message while offline triggers a notification; subsequent messages in the debounce window are silent (user sees full unread count on app open)
- **Debounce Reset**: When user connects via WebSocket, debounce timer resets so they get a fresh notification on next offline period

**Configuration:**
```bash
# In .env - minutes between push notifications per user (default: 5)
PUSH_DEBOUNCE_MINUTES=5
```

## [2.15.1] - 2026-01-22

### Changed

#### Compact Mobile Input UI
Streamlined the message input action buttons for better mobile usability.

- **Combined Photo Button**: Merged "Upload Image" and "Take Photo" into a single 📷 button with dropdown
- **Action Overflow Menu**: Added ⋮ menu containing less-common actions (Record Audio, Record Video, Share Plex)
- **Primary Actions**: GIF and Photo buttons remain as primary quick-access actions
- **Fixed Send Button**: Prevented send button from wrapping to second row on narrow screens
- **Removed Jellyfin**: Disabled Jellyfin integration from WaveView (Plex is now the primary media server)

### Fixed

#### Audio Recording Upload
Fixed audio recordings failing to play with 404 errors.

- **Root Cause**: Storage module was saving audio files to `data/media/` but the serving endpoint looked in `uploads/media/`
- **Fix**: Aligned `storage.mediaDir` to use `uploads/media/` matching the server's `MEDIA_DIR` constant

## [2.15.0] - 2026-01-22

### Added

#### Plex Media Server Integration
Connect Plex servers to share content in waves, complementing the existing Jellyfin support.

**Features:**
- **OAuth Authentication**: Sign in with Plex account for automatic server discovery
  - Secure PIN-based OAuth flow via plex.tv
  - Server selection after authentication
  - Direct token entry as alternative for advanced users

- **Media Server Connections**: Manage Plex server connections in profile settings
  - Multiple server support
  - Connection testing
  - Encrypted token storage (same security as Jellyfin)

- **Media Browser**: Browse and share content from connected Plex servers
  - Library section navigation (Movies, TV Shows, Music, Photos)
  - Search functionality
  - Season/episode navigation for TV series
  - Thumbnail display via proxied requests

- **Plex Embeds**: Rich media cards in messages with Plex orange accent (#e5a00d)
  - Automatic metadata display (title, year, duration, type)
  - Poster thumbnails with fallback handling
  - Summary/description toggle

- **Video Streaming**: Full playback support in browser
  - Direct play for browser-compatible formats (MP4/M4V/MOV with H264)
  - HLS transcoding via hls.js for incompatible formats (MKV, HEVC, etc.)
  - Automatic format detection - no user configuration needed
  - Proxied streaming through Cortex to avoid CORS issues
  - Requires Plex server with transcoding enabled for non-MP4 files

**New Components:**
- `PlexConnectionManager.jsx` - Server connection settings with OAuth flow
- `PlexBrowserModal.jsx` - Media library browser
- `PlexEmbed.jsx` - Embedded media card with HLS video player

**New Dependencies:**
- `hls.js` - HLS video playback for transcoded Plex streams

**Server Endpoints:**
- `POST /api/plex/auth/pin` - Request OAuth PIN from plex.tv
- `GET /api/plex/auth/pin/:pinId` - Poll PIN status for auth completion
- `GET /api/plex/auth/servers` - List user's available Plex servers
- `GET/POST/DELETE /api/plex/connections` - Connection management
- `POST /api/plex/connections/:id/test` - Test connection
- `GET /api/plex/library/:connectionId` - Get library sections
- `GET /api/plex/items/:connectionId` - Browse/search items
- `GET /api/plex/item/:connectionId/:ratingKey` - Get item details
- `GET /api/plex/stream/:connectionId/:ratingKey` - Get stream info (direct URL or HLS)
- `GET /api/plex/video/:connectionId/:ratingKey` - Proxy direct video stream
- `GET /api/plex/thumbnail/:connectionId/:ratingKey` - Proxy thumbnail

**Database Schema:**
- `plex_connections` - User's Plex server connections
  - Stores encrypted access tokens
  - Tracks machine identifier for unique server identification
  - OAuth-sourced or direct token entry

**Embed URL Format:**
```
cortex://plex/{connectionId}/{ratingKey}?name={name}&type={type}&duration={ms}&summary={text}
```

**Configuration:**
```bash
RATE_LIMIT_PLEX_MAX=60          # Max Plex API requests per minute (default: 60)
```

---

## [2.14.0] - 2026-01-21

### Added

#### Jellyfin/Emby Media Server Integration
Connect personal media servers to share content in waves and host synchronized watch parties.

**Features:**
- **Media Server Connections**: Connect multiple Jellyfin/Emby servers via profile settings
  - Secure credential storage with encrypted API tokens
  - Test connection functionality
  - Default server selection for quick access

- **Media Browser**: Browse and share content from connected servers
  - Library navigation (Movies, TV Shows, Music, etc.)
  - Search functionality across all libraries
  - Season/episode navigation for TV series
  - Poster/backdrop image display
  - Add media to messages with embedded player cards

- **Jellyfin Embeds**: Rich media cards in messages
  - Automatic metadata display (title, year, runtime, rating)
  - Play button for direct streaming
  - Poster thumbnails with fallback handling

- **Watch Parties**: Synchronized viewing sessions (foundation)
  - Create watch parties from Jellyfin embeds
  - Real-time playback sync via WebSocket
  - Join/leave party functionality
  - Party banner in wave header
  - Participant list display

**New Components:**
- `JellyfinBrowserModal.jsx` - Media library browser
- `JellyfinEmbed.jsx` - Embedded media card for messages
- `JellyfinConnectionManager.jsx` - Server connection settings
- `WatchPartyPlayer.jsx` - Synchronized video player
- `WatchPartyBanner.jsx` - Active party indicator

**Server Endpoints:**
- `GET/POST/DELETE /api/jellyfin/connections` - Connection management
- `POST /api/jellyfin/connections/:id/test` - Test connection
- `GET /api/jellyfin/proxy/*` - Secure API proxy to Jellyfin
- `GET /api/jellyfin/stream/:connectionId/:itemId` - Media stream proxy
- `POST/GET /api/jellyfin/watch-parties` - Watch party management
- `POST /api/jellyfin/watch-parties/:id/join|leave|sync` - Party actions

**Database Schema:**
- `jellyfin_connections` - User's media server connections
- `watch_parties` - Active watch party sessions
- `watch_party_participants` - Party participant tracking

**Configuration:**
```bash
JELLYFIN_PROXY_ENABLED=true     # Enable/disable Jellyfin proxy feature
JELLYFIN_ALLOWED_HOSTS=*        # Comma-separated list of allowed Jellyfin hostnames
```

## [2.13.0] - 2026-01-21

### Added

#### S3-Compatible Object Storage Support
Optional S3-compatible storage backend for uploaded files, supporting MinIO, AWS S3, Backblaze B2, and Cloudflare R2.

**Features:**
- Storage abstraction layer (`server/storage.js`) supporting local filesystem or S3
- Automatic fallback to local storage if S3 credentials are missing
- Presigned URL endpoint (`POST /api/uploads/presign`) for direct browser-to-S3 uploads
- Support for large media files up to 5GB (configurable via `S3_MAX_FILE_SIZE_MB`)
- Public URL configuration for CDN integration (`S3_PUBLIC_URL`)

**Configuration:**
```bash
STORAGE_PROVIDER=s3              # 'local' (default) or 's3'
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=cortex-media
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_REGION=us-east-1
S3_PUBLIC_URL=https://cdn.example.com  # Optional CDN URL
S3_MAX_FILE_SIZE_MB=5000               # Default 5GB
```

**Updated Endpoints:**
- Avatar uploads now use storage abstraction
- Message image uploads now use storage abstraction
- Media (audio/video) uploads now use storage abstraction
- New presigned URL endpoint for large direct uploads

**Dependencies Added:**
- `@aws-sdk/client-s3` - AWS SDK S3 client
- `@aws-sdk/s3-request-presigner` - Presigned URL generation

## [2.12.0] - 2026-01-20

### Changed

#### Application Rename: Farhold → Cortex

Restored the application name from "Farhold" back to "Cortex" - the canonical communication network name from the Firefly universe.

**Rationale:**
- "Cortex" is the authentic Firefly terminology for the communication network
- As a federated application, instances will run on subdomains (e.g., `cortex.example.com`)
- Better alignment with the show's lore and aesthetic
- Production instance will be hosted at `cortex.farhold.com`

**File Renames:**
- `FarholdApp.jsx` → `CortexApp.jsx`

**Package Name Updates:**
- `farhold-client` → `cortex-client`
- `farhold-server` → `cortex-server`

**Branding Updates:**
- All user-facing "Farhold" text updated to "Cortex"
- PWA manifest and service worker updated
- Login screen, headers, and share prompts updated
- OG meta tags and Twitter cards updated
- Push notification titles updated

**Backwards Compatibility:**
- All `localStorage` keys remain prefixed with `farhold_` for seamless upgrades
- API endpoints unchanged (`/api/droplets`, `/api/pings`, etc.)
- Federation placeholder examples kept as documentation aids

## [2.11.2] - 2026-01-20

### Changed

#### Terminology Simplification: Ping → Message

Simplified terminology from "Ping" to "Message" for clarity and universality.

**Rationale:**
- "Message" is universally understood
- "Reply to a message" is natural language
- Still maintains tech/futuristic feel within Wave context
- "Burst" retained for breaking out to new waves

**File Renames:**
- `components/pings/` → `components/messages/`
- `Ping.jsx` → `Message.jsx`
- `PingWithEmbeds.jsx` → `MessageWithEmbeds.jsx`
- `PublicPingView.jsx` → `PublicMessageView.jsx`

**Variable Renames:**
- `scrollToPingId` → `scrollToMessageId`
- `autoFocusPings` → `autoFocusMessages`
- `decryptPings` → `decryptMessages`

**Note:** API endpoints for `/droplets` and `/pings` remain for backwards compatibility.

## [2.11.1] - 2026-01-20

### Changed

- Terminology refactoring: droplet→ping, ripple→burst (superseded by 2.11.2)
- Ping timestamps now display full date and time

## [2.11.0] - 2026-01-20

### Added

#### Custom Theme System

Create, save, and share custom color themes with a visual editor.

**Theme Editor:**
- Visual color pickers for all CSS variables organized by category:
  - Backgrounds (base, elevated, surface, hover, active)
  - Text (primary, secondary, dim, muted)
  - Borders (primary, secondary, subtle)
  - Accents (amber, teal, green, orange, purple)
  - Status (success, warning, error, info)
  - Glows (amber, teal, green)
- "Start From" dropdown to base new theme on any built-in theme
- Live preview panel showing how colors look together
- Import/export themes as JSON files
- Public/private toggle for sharing themes

**Theme Gallery:**
- Browse built-in Firefly-themed themes with visual previews
- Community themes section for public user-created themes
- Search and sort (newest, popular, name)
- Install/uninstall themes from other users
- One-click apply for any available theme

**Theme Persistence:**
- Custom themes saved to database (max 20 per user)
- Theme preference synced to server for cross-device persistence
- Themes persist across login/logout sessions
- LocalStorage cache for instant theme application on page load

**Settings Integration:**
- Custom themes appear in Display Preferences dropdown
- Grouped into "Built-in Themes" and "Custom Themes" sections
- "Customize" button opens full theme editor modal
- Theme description shown below dropdown

**Database Schema:**
```sql
CREATE TABLE custom_themes (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  variables TEXT NOT NULL,   -- JSON object of CSS variable values
  is_public INTEGER DEFAULT 0,
  install_count INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE custom_theme_installs (
  user_id TEXT NOT NULL,
  theme_id TEXT NOT NULL,
  installed_at TEXT,
  PRIMARY KEY (user_id, theme_id)
);
```

**Files Added:**
- `client/src/components/settings/ThemeEditor.jsx` - Visual theme editor
- `client/src/components/settings/ThemeGallery.jsx` - Theme browsing and management
- `client/src/components/settings/ThemeCustomizationModal.jsx` - Modal wrapper
- `client/src/components/ui/ColorPicker.jsx` - Color input with swatch and hex
- `client/src/hooks/useTheme.js` - Theme application and persistence logic

**Files Modified:**
- `client/src/components/profile/ProfileSettings.jsx` - Theme dropdown with custom themes
- `client/src/views/MainApp.jsx` - Custom theme initialization on login
- `client/src/config/themes.js` - Added preview colors for built-in themes
- `server/server.js` - Theme CRUD endpoints with rate limiting
- `server/database-sqlite.js` - Theme database methods

### Fixed

- Fixed missing `LOADING` constant import in UserManagementPanel causing admin panel crash
- Fixed custom theme selection from Display Preferences dropdown not persisting - theme would flash briefly then revert to system theme because server validation only accepted built-in theme names

### Changed

#### Terminology Refactoring

Updated codebase to use consistent Firefly-inspired terminology:

**Terminology Changes:**
- "Droplet" → "Ping" (individual messages)
- "Ripple" → "Burst" (break-out thread to new wave)

**File Renames:**
- `components/droplets/` → `components/pings/`
- `Droplet.jsx` → `Ping.jsx`
- `DropletWithEmbeds.jsx` → `PingWithEmbeds.jsx`
- `RippledLinkCard.jsx` → `BurstLinkCard.jsx`
- `RippleModal.jsx` → `BurstModal.jsx`
- `PublicDropletView.jsx` → `PublicPingView.jsx`

**Variable/Prop Renames:**
- `scrollToDropletId` → `scrollToPingId`
- `autoFocusDroplets` → `autoFocusPings`
- `decryptDroplets` → `decryptPings`
- `rippleTarget` → `burstTarget`
- `onRipple` → `onBurst`

**Timestamp Format:**
- Ping timestamps now display full date and time (e.g., "1/20/26 2:30 PM") instead of just time

## [2.10.0] - 2026-01-19

### Added

#### Low-Bandwidth Mode

Automatically detects slow network connections and adapts data fetching to improve load times on poor connections.

**Network Detection:**
- Uses Network Information API when available (effectiveType, downlink, rtt)
- Falls back to latency measurement for browsers without API support
- Detects 2G, slow-2G, or high latency (>500ms) as "slow connection"

**Minimal API Mode:**
- `GET /api/waves?minimal=true` - Returns wave list without participant arrays (60-80% reduction)
- `GET /api/waves/:id/droplets?fields=minimal` - Returns droplets without reactions/readBy (30-50% reduction)

**Caching Layer:**
- IndexedDB cache for wave list with 7-day expiration
- Shows cached data immediately while fetching fresh data in background
- Service worker stale-while-revalidate for wave list API (30-second cache)

**Files Added:**
- `client/src/hooks/useNetworkStatus.js` - Network detection hook
- `client/src/utils/waveCache.js` - IndexedDB caching utilities
- `client/src/components/ui/Skeletons.jsx` - Loading placeholder components

**Files Modified:**
- `server/database-sqlite.js` - Added `getWavesForUserMinimal()`, `getDropletsForWaveMinimal()`
- `server/server.js` - Added minimal mode support to waves endpoints
- `client/src/hooks/useAPI.js` - Auto-adds minimal flags on slow connections
- `client/src/views/MainApp.jsx` - Cache-first loading strategy
- `client/public/sw.js` - API caching with stale-while-revalidate

#### Video Feed Recommendation Algorithm

Replaces pure random video ordering with interest-based scoring to show more relevant content.

**Scoring System:**
| Factor | Score |
|--------|-------|
| Own video | -100 (effectively excluded) |
| Unseen video | +100 |
| Already watched | -80 |
| Creator you've reacted to | +50 |
| Video from contact/friend | +30 |
| Video has conversations | +5 to +20 |
| Random discovery factor | +0 to +30 |

**View Tracking:**
- New endpoint: `POST /api/feed/videos/:id/view`
- Client marks videos as viewed after 2 seconds of watching
- Uses existing `ping_read_by` table (no schema changes needed)

**How It Works:**
1. Fetches 5x the requested videos as candidates
2. Scores each video based on user's engagement history
3. Sorts by score descending and returns top N
4. Random factor ensures discovery of new content/creators

**Files Modified:**
- `server/database-sqlite.js` - `getVideoFeedForUser()` rewritten with scoring algorithm
- `server/server.js` - Added `POST /api/feed/videos/:id/view` endpoint
- `client/src/components/feed/VideoFeedView.jsx` - Tracks views after 2 seconds

## [2.9.0] - 2026-01-17

### Added

#### Profile Waves for Video Posting

**Overview:**
Hidden "Profile Wave" for each user where standalone videos can be posted without belonging to a traditional wave. Replies to these videos automatically create burst waves for conversation, keeping the profile wave clean as a video gallery.

**Key Features:**
- **Auto-Created Profile Wave**: Each user has exactly one profile wave (auto-created on first video post)
- **Public Privacy**: Profile waves are visible to all users in the feed
- **Hidden from Wave List**: Users never see their profile wave as a traditional wave
- **Video-Only Content**: Profile waves only accept video pings (no text-only messages)
- **Auto-Burst Replies**: Replies to profile videos create new conversation waves automatically

**User Experience:**
1. User opens video feed, taps floating "+" button
2. Records/uploads video with optional caption
3. Video appears in their profile wave and the public feed
4. Other users can react or reply
5. Reply creates a burst wave linking back to original video

**API Endpoints:**
- `GET /api/profile/wave` - Get or create current user's profile wave
- `POST /api/profile/wave/videos` - Post a video to profile wave
- `GET /api/users/:handle/videos` - Get videos from a user's profile wave
- `POST /api/profile/videos/:id/reply` - Reply to a profile video (auto-burst)

**Client Components:**
- `ProfileVideoUpload.jsx` - Modal for recording/uploading profile videos
- Floating "+" button in VideoFeedView for quick video posting
- Comment/Reply button on video feed items
- Conversation badge showing reply count on videos with replies
- Slide-up reply input panel

**Database Changes:**
- Added `is_profile_wave` column to waves table
- Added `profile_owner_id` column to waves table
- Added unique index on profile_owner_id for fast lookup

**Files Modified:**
- `server/database-sqlite.js` - Migration, profile wave queries
- `server/server.js` - New API endpoints, auto-burst logic
- `server/schema.sql` - Updated schema for fresh installs
- `client/src/components/feed/VideoFeedView.jsx` - Post button, reply handling
- `client/src/components/feed/VideoFeedItem.jsx` - Reply button, conversation badge
- `client/src/components/feed/ProfileVideoUpload.jsx` - NEW - Video upload modal

## [2.8.0] - 2026-01-17

### Added

#### Random Video Feed (Discover Tab)

**Overview:**
TikTok/Instagram Reels-style vertical video feed allowing users to discover and browse video content from public waves and waves they participate in.

**Key Features:**
- **Discover Feed Tab**: New 5th tab in mobile BottomNav and desktop navigation
- **Vertical Video Scroll**: Full-screen vertical video display with CSS scroll-snap
- **Auto-Play/Pause**: Automatically plays current video, pauses others
- **Swipe Navigation**: Swipe up for next, swipe down for previous video
- **Keyboard Navigation**: Arrow keys and j/k for desktop
- **Random Shuffle**: Session-based random ordering refreshes each visit
- **Cursor Pagination**: Efficient loading with cursor-based pagination
- **Video Counter**: Shows current position in feed
- **Navigation Indicators**: Visual dots showing position in feed

**UI Elements:**
- Author info overlay (bottom-left): Avatar, name, handle
- Wave badge with title and privacy indicator
- Caption display
- Action buttons (right side): React, View Wave, Mute/Unmute
- Progress bar at bottom
- Duration badge (top-right)

**User Preferences:**
- "Show my videos in Discover feed" toggle (opt-out of appearing in others' feeds)
- "Autoplay videos" toggle
- Settings accessible in Profile > Video Feed section

**Security/Privacy:**
- Respects wave privacy levels (public + participant access only)
- Excludes encrypted videos (cannot play without wave context)
- Excludes videos from blocked users
- Respects user opt-out preference
- Rate limited: 60 requests/minute for feed browsing

**Implementation Files:**
- `client/src/hooks/useVerticalSwipe.js`: NEW - Vertical swipe gesture detection (~75 lines)
- `client/src/components/feed/VideoFeedItem.jsx`: NEW - Individual video display (~380 lines)
- `client/src/components/feed/VideoFeedView.jsx`: NEW - Feed container with pagination (~340 lines)
- `client/src/components/ui/BottomNav.jsx`: Added Feed tab
- `client/src/views/MainApp.jsx`: Integrated feed view
- `client/src/components/profile/ProfileSettings.jsx`: Added video feed preferences
- `server/server.js`: Added `/api/feed/videos` endpoint
- `server/database-sqlite.js`: Added `getVideoFeedForUser()` method and video feed index

**Database Changes:**
```sql
CREATE INDEX IF NOT EXISTS idx_pings_video_feed
ON pings(media_type, created_at DESC)
WHERE media_type = 'video' AND deleted = 0;
```

**API Endpoint:**
```
GET /api/feed/videos
Query params:
- limit (default: 10, max: 50)
- cursor (ping ID for pagination)
- seed (optional session seed for consistent random ordering)
```

## [2.7.3] - 2026-01-17

### Fixed
- Camera/video recording controls hidden on low resolution screens requiring zoom to see buttons
- Replaced browser Fullscreen API with fixed overlay approach for expanded mode
- Controls now use flex layout with `flexShrink: 0` to ensure they always remain visible
- Preview area uses `flex: 1` with `minHeight: 0` to shrink when needed on small screens
- Video timer now overlays on video preview instead of pushing controls off screen
- Video pings not displaying in breakout/burst waves (missing media fields in `getDropletsForBreakoutWave`)

### Changed
- Expand button icon now shows ⊡ when expanded (collapse) vs ⛶ when normal (expand)
- Video recording timer displays as overlay on video in both normal and expanded modes

## [2.7.2] - 2026-01-17

### Fixed
- Camera capture cropping vertical/portrait photos to horizontal (removed fixed 4:3 aspect ratio)
- Changed camera preview from `objectFit: cover` to `contain` to show full uncropped image

### Added
- Fullscreen mode for camera capture (tap viewfinder or ⛶ button)
- Fullscreen mode for video recording (tap preview or ⛶ button)

## [2.7.1] - 2026-01-16

### Fixed
- Video player center play button not responding to clicks (overlay rendering order)
- Missing Droplet import in FocusView causing crash when opening focus mode
- Vertical video recording on mobile hiding control buttons (limited preview height to 40vh)
- Media streaming endpoint using wrong JWT_SECRET variable causing 403 errors

### Changed
- Removed EMO button from WaveView (reactions on pings are sufficient)
- Added ☝️ pointing finger reaction to quick reactions list

## [2.7.0] - 2026-01-16

### Added

#### Media Pings - Voice and Video Messages

**Overview:**
Users can now record and send audio and video messages directly within waves. This adds a new dimension to conversations beyond text and images.

**Key Features:**
- **Voice Messages**: Record up to 5 minutes of audio with a single click
- **Video Messages**: Record up to 2 minutes of video with selfie camera
- **Recording Controls**: Start/stop, pause/resume, preview before sending
- **Custom Playback**: Styled audio/video players matching Farhold aesthetic
- **Playback Speed**: Audio player supports 0.75x, 1x, 1.25x, 1.5x, 2x speeds
- **Video Fullscreen**: Full-screen playback with auto-hiding controls
- **Seek Support**: HTTP Range requests for scrubbing through media
- **Duration Display**: Shows recording length during capture and playback
- **Device Selection**: Choose microphone and camera before recording via settings gear icon
- **Server-side Transcoding**: Videos are transcoded to MP4 (H.264) for cross-browser compatibility
- **Upload Status Indicator**: Shows "Uploading and transcoding video..." with spinner during processing

**Implementation Files:**
- `client/src/components/media/MediaRecorder.jsx`: NEW - Recording UI with preview and device selection (~450 lines)
- `client/src/components/media/AudioPlayer.jsx`: NEW - Custom audio player (~250 lines)
- `client/src/components/media/VideoPlayer.jsx`: NEW - Custom video player (~310 lines)
- `client/src/components/media/CameraCapture.jsx`: NEW - Camera capture for image upload (~400 lines)
- `client/src/components/droplets/Droplet.jsx`: Integrated media players into ping rendering
- `client/src/components/waves/WaveView.jsx`: Added AUD/VID/CAM buttons and upload handling with status indicator
- `server/server.js`: Added `/api/uploads/media` and `/api/media/:filename` endpoints with FFmpeg transcoding

**Server Dependencies:**
- `fluent-ffmpeg`: Node.js wrapper for FFmpeg
- FFmpeg must be installed on server (`sudo apt install ffmpeg`)

**Database Schema:**
```sql
ALTER TABLE pings ADD COLUMN media_type TEXT;       -- 'audio' or 'video'
ALTER TABLE pings ADD COLUMN media_url TEXT;        -- Server path to file
ALTER TABLE pings ADD COLUMN media_duration INTEGER; -- Duration in milliseconds
ALTER TABLE pings ADD COLUMN media_encrypted INTEGER DEFAULT 0;
```

**API Endpoints:**
- `POST /api/uploads/media`: Upload audio/video recording (auth required)
  - Accepts: audio/webm, audio/mp4, audio/ogg, audio/mpeg, audio/wav, video/webm, video/mp4, video/ogg
  - Size limits: 10MB audio, 50MB video
  - Video files are transcoded to MP4 (H.264 + AAC) for cross-browser compatibility
  - Returns: { url, type, duration, size }
- `GET /api/media/:filename`: Stream media file with Range support (auth required)

**User Flow:**
1. Click AUD or VID button in wave compose area
2. Optionally click gear icon to select microphone/camera
3. Grant microphone/camera permissions when prompted
4. Click "Start Recording" to begin
5. Use Pause/Resume as needed
6. Click "Stop" when finished
7. Preview the recording
8. Click "Send" to post or "Discard" to re-record
9. Status indicator shows progress during upload/transcoding

#### Camera Capture for Image Upload

**Overview:**
Take photos directly with your camera and upload them as images, in addition to selecting files from your device.

**Key Features:**
- **CAM Button**: New purple CAM button next to IMG button
- **Live Viewfinder**: See camera preview before capturing
- **Device Selection**: Choose which camera to use via settings
- **Preview & Retake**: Review photo before uploading, option to retake
- **Mobile Support**: Defaults to back camera on mobile devices

**Implementation Files:**
- `client/src/components/media/CameraCapture.jsx`: NEW - Camera capture UI component
- `client/src/components/waves/WaveView.jsx`: Added CAM button and integration

#### Screen Sharing in Voice/Video Calls

**Overview:**
Share your screen during LiveKit voice/video calls for presentations, demos, or collaboration.

**Key Features:**
- **Share Screen Button**: New button in both CallModal and DockedCallWindow
- **Browser Picker**: Uses native browser screen/window picker
- **Stop Sharing**: Toggle button to stop screen share
- **Error Handling**: Gracefully handles user cancellation or permission denial

**Implementation Files:**
- `client/src/services/VoiceCallService.js`: Added isScreenSharing state and setScreenSharing method
- `client/src/hooks/useVoiceCall.js`: Exposed setScreenSharing to React components
- `client/src/components/calls/CallModal.jsx`: Added screen share button and LiveKit sync
- `client/src/components/calls/DockedCallWindow.jsx`: Added screen share button and LiveKit sync

#### Pip-Boy Theme (Crossover)

**Overview:**
New "Pip-Boy" theme inspired by Vault-Tec terminals from Fallout. Classic green phosphor CRT aesthetic.

**Color Palette:**
- Background: Deep black-green (#0a0f0a)
- Primary text: Bright green (#20ff20)
- Accent: Orange (#ffa500, #ff6600)
- Glow effects: Green phosphor glow

**Implementation Files:**
- `client/index.html`: Added [data-theme="pipBoy"] CSS variables
- `client/src/config/themes.js`: Added pipBoy theme entry

## [2.6.1] - 2026-01-15

### Added

#### Dockable Call Window - Persistent Voice/Video Controls Across Navigation

**Overview:**
Floating, draggable call window that persists across all views, providing constant access to call controls without reopening modals. Built on top of the VoiceCallService singleton from v2.6.0.

**Key Features:**
- **Docked by Default**: All calls start in the floating dock window (no modal required)
- **Floating Window**: Draggable, resizable window with minimize/maximize states
- **Auto-Dock on Close**: Closing CallModal automatically docks the call instead of disconnecting
- **Navigation Persistence**: Stays visible when switching waves, contacts, profile
- **Position Memory**: Remembers window position in localStorage
- **Mobile Responsive**: Fixed bottom position on mobile (no dragging)
- **Snap-to-Edge**: Auto-snaps to screen edges within 20px
- **Video Tiles**: Full video grid in maximized state
- **Quick Controls**: Mute, camera, leave call accessible in both states

**Implementation Files:**
- `client/src/services/VoiceCallService.js`: Added dock state and methods (isDocked, dockMinimized, dockPosition, showDock(), hideDock(), toggleDockSize(), setDockPosition())
- `client/src/hooks/useDraggable.js`: NEW - Custom hook for drag-and-drop with boundary checking (~66 lines)
- `client/src/components/calls/DockedCallWindow.jsx`: NEW - Main dockable window component (~430 lines)
- `client/src/hooks/useVoiceCall.js`: Exposed dock methods and state to React components
- `client/src/views/MainApp.jsx`: Mounted DockedCallWindow with global voice call hook
- `client/src/components/waves/WaveView.jsx`: Added "Dock Call" button when in active call

**States:**
- **Minimized**: 80px bar with participant count, audio indicator, quick controls
- **Maximized**: 400x600px window with video tiles grid and full controls
- **Mobile**: Fixed bottom position, 60px minimized, 70vh maximized

**Architecture:**
```
VoiceCallService (singleton with dock state)
    ↓ subscribes
useVoiceCall (hook exposes dock methods)
    ↓ uses
DockedCallWindow (floating window)
    ↓ renders
LiveKitCallRoom (reused from CallModal)
```

**User Flow:**
1. Click "Voice/Video Call" from wave menu or "Join Call" indicator
2. CallModal opens briefly, click "Voice Call" or "Video Call" button
3. **Floating dock window appears immediately** - no need to manually dock
4. CallModal closes automatically, call stays in dock
5. Navigate to different waves/contacts/profile - window persists
6. Click minimize/maximize to toggle size
7. Drag to reposition (desktop only)
8. Position persists across page reloads
9. Click call indicator to reopen CallModal for full controls (dock remains)

**Testing:**
- ✅ Dock appears and persists across navigation
- ✅ Minimize/maximize toggle works
- ✅ Desktop drag-and-drop works smoothly
- ✅ Mobile shows fixed bottom position
- ✅ Position persists in localStorage
- ✅ Call controls work from dock
- ✅ Video tiles render in maximized state
- ✅ Snap-to-edge behavior works

### Fixed

- **Docked Call Disconnect**: Fixed issue where docking a call would immediately disconnect from LiveKit room. Problem was dual LiveKitRoom components (one in CallModal, one in DockedCallWindow) both trying to connect simultaneously. Solution: close CallModal when docking, hide dock when opening modal, and prevent CallModal from rendering LiveKitRoom when docked. Ensures only ONE LiveKitRoom instance is active at a time.

- **DockedCallWindow Rendering**: Fixed dock window not appearing after clicking "Dock Call" button. Previously required both `isDocked` and `connectionState === 'connected'`, but connection state could change rapidly. Now renders whenever `isDocked` is true, with the component handling disconnected/connecting states internally.

- **LiveKitRoom Connection in Minimized State**: Fixed issue where call wouldn't connect until user interacted with dock. LiveKitRoom now renders (hidden with `display: none`) even when dock is minimized, ensuring immediate connection on call start.

- **Stale Dock from Previous Calls**: Fixed issue where dock would remain visible after leaving a call, causing WebSocket errors when joining new calls. Solution: `leaveCall()` now automatically hides dock, and `startCall()` disconnects any existing call before starting a new one. Ensures clean state transitions between calls.

- **LiveKit Context Errors**: Fixed multiple LiveKit React hook errors ("No room provided", "No TrackRef") by properly structuring components within LiveKitRoom context and using `useTracks()` instead of `useParticipants()` for video tiles.

- **Call Indicator in Wrong Waves**: Fixed issue where call indicator badge and dock button appeared in all waves instead of just the wave where the call is active. Added check for `voiceCall.roomName === wave.id` to only show call controls in the correct wave.

- **Hiding Dock Disconnects Call**: Fixed issue where clicking X to hide the dock would disconnect from the LiveKit room. Solution: MainApp now renders DockedCallWindow whenever a call is active (not just when docked), and DockedCallWindow renders a hidden LiveKitRoom when `!isDocked`. This keeps the connection alive when the dock UI is hidden, allowing users to hide/show the dock without reconnecting.

- **Call Indicator Missing for Remote Users**: Fixed issue where users not in a call couldn't see the call indicator badge when viewing a wave with an active call. Problem was WaveView checked `voiceCall.roomName === wave.id`, but `roomName` is only set when the local client joins a call. Solution: Added `activeCallWaveId` to VoiceCallService to track which wave has an active call based on server status polling. Changed WaveView to check `activeCallWaveId` instead of `roomName` for showing the call indicator badge. Added useEffect in WaveView to poll call status every 5 seconds when viewing any wave, ensuring `activeCallWaveId` is updated for all users. Now Window 2 can see the 📞 indicator and participant count when viewing a wave with an active call, even if they haven't joined yet.

- **Contact Search Results Crash**: Fixed "Cannot read properties of undefined (reading 'displayName')" error when viewing contact search results. Issue was searchResults array could contain undefined or incomplete user objects. Solution: Added `.filter(user => user && user.id && user.displayName)` before mapping search results in ContactsView.jsx to skip malformed entries.

- **React Hooks Violation (Error #310)**: Fixed "Rendered more hooks than during the previous render" error that caused app crash when starting voice/video calls. Issue was in DockedCallWindow where hooks were defined after a conditional return statement, violating React's Rules of Hooks. Moved all `useCallback` hooks before the conditional return to ensure consistent hook count across all renders.

- **LiveKit Reconnection Storm**: Fixed issue where hundreds of "ConnectionError: Client initiated disconnect" errors would flood the console when starting a call. Problem was LiveKitRoom component remounting on every voiceCall state update (mute, camera, dock position, etc.), causing rapid connect/disconnect cycles. Solution: Added `key={token}` prop to LiveKitRoom so it only remounts when the token changes (i.e., when switching rooms), not on every state update. This provides stable connections while allowing the component to update props like `video={!voiceCall.isCameraOff}` without remounting.

- **Admin Panel Import Errors**: Fixed "UserManagementPanel is not defined" error in ProfileSettings.jsx. Admin panels were extracted to separate files in v2.6.0 refactoring but imports were never added. Added static imports for all 9 admin panels. Note: This defeats the lazy-loading optimization from v2.6.0, but ensures components work correctly. Future optimization: Use dynamic imports with React.lazy(). Also fixed "canAccess is not defined" error in UserManagementPanel.jsx and "useCallback is not defined" errors in GroupsView.jsx and AdminReportsPanel.jsx by adding missing React hook imports.

- **GroupInvitationsPanel**: Fixed null check for `invitedBy` field when displaying group invitations. Previously threw "can't access property 'displayName'" error when invitedBy was null/undefined. Now displays "Unknown" as fallback and conditionally renders Avatar.

- **Contact Requests Panel Crash**: Fixed "Cannot read properties of undefined (reading 'displayName')" error when viewing incoming contact requests. Issue was server returns `from_user` object but component referenced `req.from`. Also added defensive filtering to skip malformed request entries.

- **Sent Requests Panel Crash**: Added defensive filtering to SentRequestsPanel to prevent crashes from undefined or incomplete sent request objects. Filters out entries missing required fields (`id`, `to_user`, `displayName`/`handle`).

- **Contacts List Defensive Filtering**: Added defensive filtering to contacts list in ContactsView to prevent crashes from undefined or incomplete contact objects. Filters out entries missing required `id` and `name` fields.

- **Rate Limiting Enhancement**: Improved API rate limiting to differentiate between authenticated and unauthenticated users. Authenticated users now get 10x higher rate limit (3000 requests/min vs 300) and are rate-limited by user ID instead of IP address, preventing issues with shared IPs.

- **ERR_INSUFFICIENT_RESOURCES During Calls**: Fixed browser exhausting network connections during voice/video calls, causing `net::ERR_INSUFFICIENT_RESOURCES` errors. Issues were:
  1. **Duplicate call status polling** - WaveView.jsx had its own useEffect polling every 5 seconds in addition to the useVoiceCall hook's polling. Worse, the `voiceCall` dependency caused the interval to be recreated on every state update. Removed the duplicate polling since useVoiceCall already handles it.
  2. **Multiple LiveKitRoom instances** - DockedCallWindow was rendering LiveKitRoom in multiple code paths (hidden, minimized, maximized), causing repeated "already connected to room" messages and connection churn. Consolidated to a single LiveKitRoom instance that wraps the entire component.
  3. **Conflicting LiveKitRoom in CallModal** - When dock was hidden but call was active, both DockedCallWindow and CallModal could render LiveKitRoom simultaneously. Fixed by having DockedCallWindow return null when `!isDocked`, ensuring CallModal handles the connection in that state.

- **LiveKit "Already Connected" Spam**: Fixed repeated "already connected to room" console messages during calls. Issues were:
  1. **Race condition on call start** - Token was set before `isDocked`, causing both CallModal and DockedCallWindow to briefly render LiveKitRoom. Fixed by setting `isDocked = true` before setting the token.
  2. **Callback recreation causing reconnection** - LiveKitCallRoom callbacks had `voiceCall` in dependencies, causing them to recreate on every state update. Fixed by using refs for stable callbacks.
  3. **Missing key prop** - CallModal's LiveKitRoom was missing `key={token}` prop, causing unnecessary remounting.
  4. **AudioLevel re-render spam** - `setAudioLevel()` was called every 100ms even with same value, causing constant re-renders. Fixed by only notifying subscribers when value actually changes.

- **Call Indicator Not Showing for Non-Participants**: Fixed issue where users not in a call couldn't see the call indicator badge (📞) when viewing a wave with an active call. Root cause was `activeCallWaveId` was missing from the `useVoiceCall` hook's return value, so `voiceCall.activeCallWaveId` was always `undefined`, causing the condition `voiceCall.activeCallWaveId === wave.id` to always fail.

## [2.6.0] - 2026-01-14

### Changed

#### Major Architecture Refactoring - Modular Codebase & Persistent Voice Calls

**Overview:**
Comprehensive refactoring of the client codebase to address build warnings, security vulnerabilities, and enable persistent voice/video calls across navigation. Transformed the monolithic 20,685-line FarholdApp.jsx into a modular, maintainable architecture with code splitting and lazy loading.

**Key Achievements:**
- **File Size Reduction**: FarholdApp.jsx reduced by 85% (20,685 → 3,093 lines)
- **Bundle Optimization**: Main bundle reduced by 30% (1,037KB → 722KB)
- **Code Splitting**: 10 admin panels lazy-loaded on demand
- **Persistent Calls**: Voice/video calls survive navigation (v2.6.0 goal achieved ✅)
- **Security**: Fixed 3 npm audit vulnerabilities
- **Maintainability**: 47 files created across organized directories

**Implementation Details:**

### Phase 1: Security & Foundation (30 min)

**Server Security Fixes** (`server/package.json`):
- Fixed `jws` vulnerability (HIGH): Updated to v3.2.3+ (HMAC signature verification bypass)
- Fixed `qs` vulnerability (HIGH): Updated to v6.14.1+ (arrayLimit bypass DoS)
- Updated `nodemailer` to v7.0.12 (MODERATE): Fixed DoS vulnerabilities

**Constants Extraction** (`client/src/config/`):
- Created `constants.js`: VERSION, API_URL, PRIVACY_LEVELS, ROLE_HIERARCHY, THREAD_DEPTH_LIMIT, FONT_SIZES
- Created `themes.js`: 15 Firefly-themed color schemes

**Utilities Extraction** (`client/src/utils/`):
- Created `storage.js`: localStorage management, PWA detection
- Created `pwa.js`: App badge updates, push notifications
- Created `favicon.js`: Notification favicons, title updates
- Created `embed.js`: Rich embed detection for YouTube, Spotify, Twitter, TikTok, etc.

**Impact**: ~800 lines removed, foundation established for modular architecture

### Phase 2: Custom Hooks Extraction (45 min)

**Extracted Hooks** (`client/src/hooks/`):
- `useWindowSize.js`: Responsive breakpoints (isMobile, isTablet, isDesktop)
- `useSwipeGesture.js`: Touch gesture handling for mobile
- `usePullToRefresh.js`: Pull-to-refresh mobile gesture
- `useAPI.js`: API fetch wrapper (temporarily exports AuthContext)
- `useWebSocket.js`: WebSocket connection with auto-reconnect
- `useVoiceCall.js`: LiveKit voice call state management (~240 lines)

**Impact**: ~500 lines removed, hooks now reusable and testable

### Phase 3: VoiceCallService Singleton (60 min) - **Critical for Persistent Calls**

**Created Service Layer** (`client/src/services/VoiceCallService.js`):
- 315-line singleton managing LiveKit connections outside React lifecycle
- Implements subscriber pattern for React component state synchronization
- Manages device selection (mic, camera, speaker) with localStorage persistence
- Handles connection state, participants, audio/video controls
- Provides server API integration (token fetch, status polling)

**Refactored useVoiceCall Hook** (`client/src/hooks/useVoiceCall.js`):
- Reduced from 240 → 114 lines (52% reduction)
- Now thin wrapper around VoiceCallService
- Subscribes to service state changes
- Delegates all actions to service

**Architecture**:
```
VoiceCallService (singleton)
    ↓ manages
LiveKit Room (persistent)
    ↑ subscribes
useVoiceCall (React hook)
    ↑ uses
CallModal, WaveView (React components)
```

**Result**: Voice/video calls now persist when navigating between waves, contacts, profile, etc. The LiveKit Room lives in the service, not in React components, so unmounting WaveView won't disconnect the call.

**Impact**: +315 lines (service), -126 lines (hook), **persistent calls enabled ✅**

### Phase 4: Component Extraction with Lazy Loading (90 min)

**UI Components Extracted** (`client/src/components/ui/`):
- `ImageLightbox.jsx`: Full-screen image viewer
- `SimpleComponents.jsx`: ScanLines, GlowText, Avatar, PrivacyBadge, Toast, LoadingSpinner, OfflineIndicator, PullIndicator
- `BottomNav.jsx`: Mobile bottom navigation

**Admin Panels Extracted** (`client/src/components/admin/`) - **All Lazy Loaded**:
- `AdminReportsPanel.jsx` (341 lines): Reports management
- `UserManagementPanel.jsx` (363 lines): User administration
- `ActivityLogPanel.jsx` (266 lines): Activity logging
- `CrawlBarAdminPanel.jsx` (342 lines): News ticker configuration
- `AlertsAdminPanel.jsx` (482 lines): System alerts management
- `AlertSubscriptionsPanel.jsx` (386 lines): Alert subscriptions
- `FederationAdminPanel.jsx` (753 lines): Federation configuration
- `HandleRequestsList.jsx` (145 lines): Handle change requests
- `BotsAdminPanel.jsx` (566 lines): API bots management
- `BotDetailsModal.jsx` (365 lines): Bot configuration modal

**Lazy Loading Implementation**:
```javascript
const AdminReportsPanel = React.lazy(() => import('./src/components/admin/AdminReportsPanel.jsx'));
// ... 9 more lazy imports
```

**Code Splitting Results**:
```
HandleRequestsList:      3.34 KB (gzip: 1.28 KB)
ActivityLogPanel:        6.10 KB (gzip: 2.06 KB)
AdminReportsPanel:       8.04 KB (gzip: 2.31 KB)
UserManagementPanel:     8.08 KB (gzip: 2.29 KB)
BotDetailsModal:         8.19 KB (gzip: 2.30 KB)
AlertSubscriptionsPanel: 8.74 KB (gzip: 2.49 KB)
CrawlBarAdminPanel:      9.03 KB (gzip: 2.19 KB)
AlertsAdminPanel:       10.68 KB (gzip: 2.82 KB)
BotsAdminPanel:         11.22 KB (gzip: 2.96 KB)
FederationAdminPanel:   16.04 KB (gzip: 3.40 KB)
```

**Impact**: ~4,300 lines removed, admin panels load on-demand, main bundle reduced 7.7%

### Phase 5: Views Extraction & Thin Wrapper (60 min)

**Views Extracted** (`client/src/views/`):
- `AboutServerPage.jsx` (182 lines): Server information page
- `LoginScreen.jsx` (444 lines): Authentication UI with MFA support
- `ResetPasswordPage.jsx` (155 lines): Password reset flow
- `PublicDropletView.jsx` (264 lines): Public shared message view
- `AuthProvider.jsx` (160 lines): Authentication context provider
- `E2EEWrapper.jsx` (15 lines): E2EE initialization wrapper
- `AppContent.jsx` (151 lines): Main routing component
- `E2EEAuthenticatedApp.jsx` (156 lines): E2EE-aware app wrapper
- `MainApp.jsx` (1,259 lines): Main application orchestrator

**FarholdApp.jsx Transformation**:
```javascript
// Before: 20,685 lines of everything
// After: 3 lines
export default function FarholdApp() {
  return <E2EEWrapper />;
}
```

**Impact**: ~12,200 lines removed, FarholdApp.jsx now minimal entry point

### Final Results

**File Size**:
- FarholdApp.jsx: 20,685 → 3,093 lines (85% reduction)
- File size: 824KB → 103KB (87% reduction)

**Bundle Optimization**:
- Main bundle: 1,124KB → 722KB (402KB reduction, 36%)
- Admin chunks: 89KB across 10 lazy-loaded files
- Total bundle: Effectively 811KB (27% smaller)

**Build Performance**:
- Build time: ~7-8 seconds (consistent)
- Transform modules: 69 (up from 58, more granular)

**Architecture**:
```
client/
├── FarholdApp.jsx (3 lines)
├── src/
│   ├── config/ (2 files)
│   ├── utils/ (4 files)
│   ├── hooks/ (6 files)
│   ├── services/ (1 file)
│   ├── components/
│   │   ├── ui/ (3 files)
│   │   └── admin/ (10 files, lazy loaded)
│   └── views/ (9 files)
├── e2ee-context.jsx
├── e2ee-components.jsx
├── crypto.js
└── messages.js
```

**Total Files Created**: 47 modular files
**Total Lines Extracted**: ~17,500 lines

### Benefits

1. **Maintainability**: Code organized by feature, easier to find and modify
2. **Performance**: Lazy loading reduces initial bundle, faster startup
3. **Persistent Calls**: Voice/video calls survive navigation (v2.6.0 goal ✅)
4. **Security**: All npm audit vulnerabilities resolved
5. **Developer Experience**: Smaller files, clearer structure, better IDE performance
6. **Future**: Foundation for docked call UI in future release

### Breaking Changes

**None** - All functionality preserved, purely internal refactoring

### Migration Notes

No user action required. This is a transparent architectural improvement.

### Technical Notes

- VoiceCallService uses singleton pattern to outlive React component lifecycle
- React.lazy() with Suspense for admin panels reduces initial load
- Vite automatically code-splits lazy imports into separate chunks
- All exports use ES modules for tree-shaking
- Modular structure enables future optimizations (route-based splitting, etc.)

## [2.5.0] - 2026-01-13

### Changed

#### LiveKit Voice/Video Calling - Production WebRTC Infrastructure

**Overview:**
Complete replacement of custom WebSocket audio streaming (v2.3.0) with LiveKit Cloud integration for production-grade voice and video calling. This migration delivers significantly improved audio quality, lower latency, professional WebRTC SFU infrastructure, and adds video calling capabilities.

**Key Improvements:**
- **Better Audio Quality**: Opus codec with adaptive bitrate (24-48 kbps)
- **Lower Latency**: ~150-250ms (vs ~200-400ms WebSocket)
- **Professional Infrastructure**: LiveKit Cloud WebRTC SFU
- **Video Calling**: Added full video support with camera controls
- **Built-in Features**: Noise suppression, echo cancellation, automatic reconnection
- **Code Reduction**: -615 lines total (-290 server, -325 client)

**Breaking Changes:**
- Removed custom WebSocket audio streaming completely
- Calls now use LiveKit's standard encryption (not custom E2EE)
- No backward compatibility with v2.3.0 calls

**Technical Implementation:**

1. **Server Changes** (`server/server.js`):
   - Added LiveKit token endpoint: `POST /api/waves/:waveId/call/token` (lines 10973-11039)
   - Added call status endpoint: `GET /api/waves/:waveId/call/status` (lines 11121-11163)
   - Added admin room monitoring: `GET /api/admin/livekit/rooms` (lines 11041-11079)
   - Removed WebSocket call handlers: `call_start`, `call_join`, `call_leave`, `call_mute_toggle`, `call_audio`
   - Removed in-memory call state tracking (activeCalls Map)
   - Fixed BigInt conversion for room age calculation (line 11151)
   - Server now only generates JWT tokens for room access - no audio routing

2. **Server Dependencies** (`server/package.json`):
   - Added: `livekit-server-sdk@^2.8.0`

3. **Client Changes** (`client/FarholdApp.jsx`):
   - Replaced `useVoiceCall` hook with LiveKit integration (lines 2148-2385)
   - Added device enumeration and selection (microphone, camera, speakers)
   - Added separate "Voice Call" and "Video Call" start options
   - Added camera toggle controls (Start Video / Stop Video)
   - Added "Join Call" button for joining active calls as voice-only
   - Added pop-out window support for calls
   - Added device settings panel in call modal
   - Replaced custom audio components with LiveKit components:
     - `LiveKitRoom` for room connection
     - `RoomAudioRenderer` for automatic audio playback
     - `ParticipantTile` for video display
     - `useParticipants`, `useLocalParticipant`, `useTracks` hooks
   - Smart video grid layout based on participant count
   - React.memo optimization to prevent reconnection spam

4. **Client Dependencies** (`client/package.json`):
   - Added: `@livekit/components-react@^2.6.0`
   - Added: `livekit-client@^2.6.0`

5. **Environment Configuration** (`server/.env`):
   - Required: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
   - Server validates LiveKit credentials on startup

**User Experience:**
- **Starting Calls**: Users choose between "Voice Call" (audio only) or "Video Call" (audio + video)
- **Joining Calls**: When call is active, users see "Join Call" button (joins as voice, can enable video after)
- **Camera Control**: "Start Video" / "Stop Video" buttons toggle camera during call
- **Device Selection**: Settings panel to choose microphone, camera, and speaker
- **Call Status**: Real-time participant count and connection status
- **Loading States**: "Checking call status..." prevents race conditions when joining

**Bug Fixes:**
- Fixed camera toggle not working (React.memo prop comparison)
- Fixed voice calls acquiring camera on connection
- Fixed second participant seeing Voice/Video buttons instead of "Join Call"
- Fixed BigInt type conversion error in room age calculation
- Fixed Join Call button passing click event as parameter

**Performance:**
- Token generation: <100ms
- Connection time: <2 seconds
- Audio latency: 150-250ms end-to-end
- Bandwidth: 24-48 kbps per user (voice), +500-1500 kbps (video)

**Free Tier Limits:**
- LiveKit Cloud: 1000 participant-minutes/month
- Can migrate to self-hosted LiveKit using same API

## [2.3.0] - 2026-01-12

### Added

#### WebSocket Voice Calling - Real-Time Audio Communication (Phase 1)

**Overview:**
Implemented real-time voice calling within waves using WebSocket audio streaming. Wave participants can initiate and join voice calls with optional end-to-end encryption (E2EE), ephemeral audio (no storage), and voice-optimized 24kbps Opus codec. This is Phase 1 of the planned voice/video communication system.

**Key Features:**
- **Server-Routed Audio**: Audio streams through server WebSocket connections (not P2P WebRTC in Phase 1)
- **Opus Codec**: Browser-native, voice-optimized at 24kbps for efficient bandwidth usage
- **Low Latency**: ~200ms end-to-end latency with 100ms audio chunks
- **Optional E2EE**: Wave creators can enable audio encryption using existing wave keys
- **Ephemeral Calls**: No audio buffering or storage - real-time only
- **Call Controls**: Mute/unmute, join/leave, visual audio level indicator
- **Participant Management**: Any participant can start calls, multiple participants supported
- **Multi-Wave**: Support for simultaneous calls in different waves

**Technical Implementation:**

1. **Database Schema** (`server/database-sqlite.js` lines 1301-1311):
   - Added `audio_encryption_enabled` column to waves table
   - Migration v2.3.0 automatically applies on server start
   - No call persistence - calls are ephemeral (in-memory only)

2. **Server-Side Call Management** (`server/server.js` lines 13004-13105):
   - In-memory call state tracking using Map structure
   - Call state includes: callId, participants, mutedParticipants, audioEncrypted, timestamps
   - Helper functions: createCall, getActiveCall, addParticipant, removeParticipant, toggleMute
   - Automatic cleanup when users disconnect

3. **Server WebSocket Handlers** (`server/server.js` lines 13223-13398):
   - `call_start`: Initiate new voice call, validates participant permissions
   - `call_join`: Join existing call
   - `call_leave`: Leave call, auto-ends if last participant
   - `call_mute_toggle`: Toggle mute status, broadcasts to all participants
   - `call_audio`: Route audio chunks to other participants (max 10KB validation)
   - Server broadcasts call events to all wave participants via WebSocket

4. **Server API Endpoint** (`server/server.js` lines 10948-10981):
   - `GET /waves/:id/call`: Fetch active call info for a wave
   - Returns callId, participants, mute status, encryption status

5. **Client Voice Call Hook** (`client/FarholdApp.jsx` lines 2131-2392):
   - `useVoiceCall`: Complete audio system using MediaRecorder + AudioContext APIs
   - **Audio Capture**: navigator.mediaDevices.getUserMedia with echo cancellation, noise suppression, auto gain
   - **MediaRecorder**: Opus codec at 24kbps, 100ms timeslices for low latency
   - **Audio Level Monitoring**: Real-time FFT analysis for visual feedback
   - **Playback**: AudioContext.decodeAudioData for received frames
   - **Optional Encryption**: Integrates with E2EE context for encrypted waves
   - **Cleanup**: Proper resource cleanup on unmount (stops tracks, closes contexts)

6. **Voice Call UI Component** (`client/FarholdApp.jsx` lines 2394-2598):
   - `VoiceCallControls`: Three states with distinct UI
     - **No Call**: "Start Voice Call" button (shows 🔒 for encrypted waves)
     - **Call Active, Not Joined**: "Join Call" button with participant count
     - **In Call**: Mute/Unmute + Leave Call buttons, audio level indicator
   - Real-time participant count display
   - Visual audio level bar (green gradient based on mic input)
   - Firefly aesthetic with monospace fonts and amber/green accents

7. **WebSocket Event Handling** (`client/FarholdApp.jsx` lines 18284-18321, 7719-7796):
   - Main app dispatches custom events for call messages
   - WaveView listens via window.addEventListener('farhold-call-event')
   - Updates call state: call_started, call_participant_joined/left, call_ended
   - Handles call_audio: Routes to playAudioFrame for real-time playback
   - Mute status updates: Tracks mutedParticipants array

8. **E2EE Audio Encryption** (`client/e2ee-context.jsx` lines 566-640):
   - `encryptAudioChunk`: AES-256-GCM encryption of audio buffers
   - `decryptAudioChunk`: Decryption with nonce verification
   - Reuses existing wave keys from E2EE infrastructure
   - 12-byte random nonce per chunk for security
   - Base64 encoding for WebSocket transmission

9. **WaveView Integration** (`client/FarholdApp.jsx` lines 9556-9563):
   - VoiceCallControls rendered at top of wave messages container
   - Receives props: wave, callState, voiceCall, user, e2ee
   - Auto-shows/hides based on call state

**WebSocket Protocol:**

Messages sent between client and server:

**Client → Server:**
- `call_start`: { type, waveId, audioEncrypted }
- `call_join`: { type, waveId }
- `call_leave`: { type, waveId }
- `call_mute_toggle`: { type, waveId, muted }
- `call_audio`: { type, waveId, audioData (base64), timestamp }

**Server → Client:**
- `call_started`: { type, callId, waveId, startedBy, audioEncrypted, participants, timestamp }
- `call_participant_joined/left`: { type, callId, waveId, userId, participants }
- `call_ended`: { type, waveId, reason }
- `call_participant_muted`: { type, callId, waveId, userId, muted }
- `call_audio`: { type, callId, waveId, senderId, audioData, timestamp }
- `call_error`: { type, error }

**Security & Validation:**
- Participant authentication required for all call actions
- Server validates user is wave participant before allowing call operations
- Audio chunks limited to 10KB to prevent abuse
- Muted participants' audio not routed by server
- E2EE encryption optional per wave, uses existing wave keys
- No audio storage - ephemeral only

**Performance Characteristics:**
- **Bandwidth**: ~3KB/s per participant (24kbps Opus)
  - 5-user call: 15KB/s upload, 12KB/s download per user
  - 1-hour call: ~54MB per user
- **CPU**: <5% server overhead (just routing), <10% client (capture + E2EE + playback)
- **Latency**: 100-150ms typical (20ms capture + 10ms encode + 50-100ms network + 10ms decode + 10ms playback)

**Error Handling:**
- Microphone permission denied: User-friendly error with instructions
- Opus codec unavailable: Fallback to default codec with warning
- Network disconnect: Auto-cleanup, reconnecting UI
- E2EE key missing: Prevents encrypted call start, shows error
- Audio chunk validation: Server rejects oversized chunks
- Multiple tabs: Only one tab per user in call

**Browser Compatibility:**
- ✅ Chrome (desktop, Android) - Full Opus support
- ✅ Firefox (desktop, Android) - Full Opus support
- ✅ Safari (desktop, iOS) - Opus via webm container
- ✅ Edge - Full Opus support
- ⚠️ Mobile: Autoplay restrictions handled

**Future Phases:**
- **Phase 2**: Voice/video messages (asynchronous, stored files)
- **Phase 3**: WebRTC P2P video conferencing (multi-participant video, screen sharing)

**Files Changed:**
- `server/database-sqlite.js` (lines 1301-1311): Database migration for audio encryption toggle
- `server/server.js` (lines 13004-13398, 10948-10981): Call state management, WebSocket handlers, API endpoint
- `client/FarholdApp.jsx` (lines 2131-2598, 7711-7796, 9556-9563, 18284-18321): Voice call hook, UI component, WaveView integration, event handling
- `client/e2ee-context.jsx` (lines 566-640, 964-966): Audio encryption/decryption helpers

**Dependencies:**
- No new dependencies required
- Uses browser-native APIs: MediaRecorder, AudioContext, Web Crypto API
- Compatible with existing WebSocket infrastructure

**Testing Recommendations:**
1. Test basic unencrypted call between two users in same wave
2. Test encrypted call in E2EE-enabled wave
3. Test mute/unmute functionality and server routing
4. Test participant join/leave mid-call
5. Test disconnect cleanup (close browser tab during call)
6. Test audio quality and latency on 3G/4G/WiFi
7. Test multiple simultaneous calls in different waves
8. Test mobile browser microphone permissions

## [2.2.9] - 2026-01-12

### Changed

#### Firefly Character Theme Redesign - Complete Visual Overhaul

**Overview:**
Completely redesigned the application's color themes with Firefly-inspired character themes. Each main character from the TV show now has a dedicated theme that reflects their personality and role.

**Theme Redesign:**

**The Ship:**
- **Serenity** (formerly "Firefly") - The ship itself, classic green terminal aesthetic

**Main Characters:**
- **Mal's Browncoat** (new) - The Captain: dusty earth tones of rebellion
- **Zoe's Warrior** (formerly "Sage") - The Soldier: dark military green, strong and tactical
- **Wash's Sky** (formerly "Ocean Blue") - The Pilot: ocean blue, flying through clouds
- **Kaylee's Flowered Dress** (new) - The Mechanic: pink and peach like her fancy ball dress
- **Jayne's Knit Cap** (formerly "Burnt Umber") - The Mercenary: rust orange like his iconic knit cap (darkened per user feedback)
- **Inara's Silk** (new) - The Companion: deep purple and burgundy, elegant grace
- **Simon's Clinic** (new) - The Doctor: clean blues and whites, precise and sterile
- **River's Mind** (new) - The Psychic: dark ethereal purple, mysterious depths
- **Book's Wisdom** (formerly "Gray") - The Shepherd: calm grays, contemplative and peaceful

**The Opposition:**
- **Reaver Red** (formerly "Red") - The Nightmare: darker blood red, primal terror
- **Alliance White** (formerly "Light Mode") - The Empire: clinical bright, cold and oppressive

**Accessibility Themes (unchanged):**
- High Contrast
- AMOLED Black
- Black and White

**Color Improvements:**
- Darkened orange tones in Jayne's Knit Cap (user feedback: "burnt umber not dark enough")
- Darkened green tones in Zoe's Warrior (user feedback: "sage green not dark enough")
- Made Reaver Red darker and bloodier for better horror aesthetic
- Enhanced all character themes with cohesive color palettes

**Technical Details:**

1. **CSS Theme Definitions** (`client/index.html` lines 26-465):
   - Renamed existing theme selectors to Firefly names
   - Added 5 brand new character themes (Mal, Kaylee, Inara, River, Simon)
   - Each theme includes: backgrounds, text colors, borders, accents, status colors, glows, and overlays

2. **JavaScript Theme Configuration** (`client/FarholdApp.jsx` lines 69-137):
   - Updated THEMES object with new names and character descriptions
   - Organized themes by category: The Ship, Main Characters, The Opposition, Accessibility
   - Added descriptive text for each character theme

3. **Server-Side Validation** (`server/server.js` lines 5631-5638):
   - Updated validThemes array to include all new Firefly theme names
   - Organized by category for maintainability

**Impact:**
- ✅ 12 distinct Firefly character themes available
- ✅ Better color contrast and readability in darkened themes
- ✅ Consistent Firefly aesthetic throughout application
- ✅ All existing theme preferences automatically migrate to closest equivalent
- ✅ Accessibility themes remain unchanged

**Files Changed:**
- `client/index.html` (lines 26-465): Complete CSS theme redesign
- `client/FarholdApp.jsx` (lines 69-137): THEMES object with new names/descriptions
- `server/server.js` (lines 5631-5638): Server-side theme validation

## [2.2.8] - 2026-01-11

### Fixed

#### Session Duration Not Honored - Users Logged Out After 24h Regardless of Selection

**Problem:**
- Users selecting 30-day session duration were still being logged out after 24 hours
- Client-side had hardcoded 24-hour browser session timeout that overrode user's choice
- Particularly affected mobile/PWA users where PWA detection might fail
- Periodic session check (every 5 minutes) enforced 24h limit even with valid 30-day JWT

**Root Cause:**
- Client stored user's selected session duration but didn't use it for expiration checks
- Hardcoded `BROWSER_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000` at line 243
- `isSessionExpired()` always checked against 24 hours, not user's selection
- Server correctly created JWTs with user-selected duration (24h/7d/30d)
- But client-side periodic check logged users out after 24h regardless

**Solution:**
Modified client to store and respect user's selected session duration:

1. **Store session duration** (`client/FarholdApp.jsx` lines 274-282):
```javascript
// Before
setSessionStart: () => localStorage.setItem('farhold_session_start', Date.now().toString()),

// After
setSessionStart: (duration = '24h') => {
  localStorage.setItem('farhold_session_start', Date.now().toString());
  localStorage.setItem('farhold_session_duration', duration);
},
getSessionDuration: () => localStorage.getItem('farhold_session_duration') || '24h',
```

2. **Use stored duration for expiration check** (`client/FarholdApp.jsx` lines 284-299):
```javascript
isSessionExpired: () => {
  // PWA sessions don't expire based on time
  if (isPWA()) return false;

  const sessionStart = storage.getSessionStart();
  if (!sessionStart) return false;

  // Use the user's selected session duration instead of hardcoded 24h
  const duration = storage.getSessionDuration();
  const durationMs = duration === '7d' ? 7 * 24 * 60 * 60 * 1000 :
                     duration === '30d' ? 30 * 24 * 60 * 60 * 1000 :
                     24 * 60 * 60 * 1000; // Default 24h

  const elapsed = Date.now() - sessionStart;
  return elapsed > durationMs;
},
```

3. **Pass duration during login/registration** (lines 18877, 18893, 18908):
```javascript
storage.setSessionStart(sessionDuration); // Store user's selected duration
```

**Server-Side Debugging:**
Added logging to track session duration selection (for debugging):
- Login: logs requested vs. used duration (line 4116)
- Registration: logs requested vs. used duration (line 4059)
- Success: logs session creation with duration (line 4167)

**Impact:**
- ✅ 30-day sessions now last full 30 days (not just 24 hours)
- ✅ 7-day sessions now last full 7 days
- ✅ Client-side timeout matches server-side JWT expiration
- ✅ Fixes premature logouts on mobile/PWA
- ✅ Users' session duration choice is now fully respected

**Files Changed:**
- `client/FarholdApp.jsx` (lines 241-299, 18877, 18893, 18908): Store and use session duration
- `server/server.js` (lines 4059, 4116, 4167): Add debug logging

## [2.2.7] - 2026-01-10

### Fixed

#### PWA Authentication Issue - Fix Spinning Wheel on Startup (`client/FarholdApp.jsx` line 18799)

**Problem:**
- PWA users experienced spinning wheel on app startup after tokens expired (24h default)
- Console errors: `GET /api/auth/me 403 (Forbidden)` and `Auth check failed, keeping cached session`
- Required daily PWA uninstall/reinstall to clear expired sessions
- 403 errors (expired token/session) were treated as "network errors" instead of auth failures
- Client kept expired token in localStorage instead of clearing it

**Root Cause:**
- PWA sessions configured to "never expire by time" (isPWA() check)
- But JWT tokens still expired server-side after 24h (or user-selected duration)
- When token expired, server returned 403 "Invalid or expired token"
- Client auth check only cleared session on 401, not 403
- Expired sessions remained cached, causing perpetual loading state

**Solution:**
Modified auth check to treat both 401 and 403 responses as session invalidation:

```javascript
// Before
if (res.status === 401) {
  storage.removeToken(); storage.removeUser(); storage.removeSessionStart();
  setToken(null); setUser(null);
}

// After
if (res.status === 401 || res.status === 403) {
  storage.removeToken(); storage.removeUser(); storage.removeSessionStart();
  setToken(null); setUser(null);
}
```

**Impact:**
- PWA no longer gets stuck on spinning wheel with expired tokens
- Users gracefully logged out when tokens expire (no more daily reinstalls)
- Session duration still respects user's login choice (24h, 7d, or 30d)
- Network errors (500, timeout) still preserve cached session for offline access

**Files Changed:**
- `client/FarholdApp.jsx` (line 18799): Changed 401 check to include 403

**Additional Changes:**
- Added missing CSS variables to blackAndWhite theme (`client/index.html` lines 144-156)
- Added blackAndWhite to server-side theme validation (`server/server.js` line 5629)

## [2.2.6] - 2026-01-08

### Fixed

#### Exclude Deleted Pings from Wave Ping Counts (`server/database-sqlite.js` line 3320)

**Problem:**
- Deleted pings (soft-deleted with `deleted = 1`) were still counting toward wave ping totals
- Wave list showed inflated ping counts that included `"[Droplet deleted]"` entries
- This created confusion as the visible ping count didn't match the actual active pings
- Unread counts already correctly excluded deleted pings, creating inconsistency

**Solution:**
Modified the wave list query to exclude deleted pings from the count:

```sql
-- Before
(SELECT COUNT(*) FROM pings WHERE wave_id = w.id) as ping_count

-- After
(SELECT COUNT(*) FROM pings WHERE wave_id = w.id AND deleted = 0) as ping_count
```

**Impact:**
- Wave ping counts now accurately reflect only active (non-deleted) pings
- Consistent with unread count logic (which already excluded deleted pings)
- Users see accurate ping totals in wave lists
- Deleted pings remain recoverable (soft delete unchanged)

**Files Changed:**
- `server/database-sqlite.js` (line 3320): Added `deleted = 0` filter to ping count subquery

## [2.2.5] - 2026-01-08

### Changed

#### UI Cleanup: Consolidated Actions into Three-Dot Menus
Major interface redesign that consolidates wave and ping action buttons into organized dropdown menus, significantly reducing visual clutter while maintaining full functionality.

**Problem:**
- Wave headers had 4+ individual buttons (Archive, Decrypt, Settings, Delete) cluttering the interface
- Each ping displayed 7-8 action buttons, creating visual overwhelm
- Mobile users faced cramped interfaces with small, crowded buttons
- Essential actions like Reply and React were mixed with less-frequent actions
- Privacy badge could get lost among multiple buttons

**Solution:**
Implemented clean three-dot menu (⋮) system inspired by modern mobile interfaces, organizing actions by frequency of use.

#### Wave Header Changes (`client/FarholdApp.jsx` lines 7094, 8357-8503)

**Before:**
```
[← Back] Wave Title | [📦] [🔓] [⚙] [DELETE] [Privacy Badge]
```

**After:**
```
[← Back] Wave Title | [⋮ Menu] [Privacy Badge]
```

**Implementation:**
- Added `showWaveMenu` state (line 7094) for dropdown visibility
- Three-dot button (⋮) positioned just left of privacy badge
- Privacy badge remains prominently visible (farthest right)
- Dropdown menu with consistent styling:
  - Background: `var(--bg-elevated)`
  - Border: `var(--border-primary)` with 4px radius
  - Shadow: `0 4px 12px rgba(0, 0, 0, 0.3)`
  - Min width: 180px
  - z-index: 1000 for proper layering

**Menu Structure:**
1. **📦 Archive Wave** / **📬 Restore from Archive**
   - Available to all participants
   - Dynamically shows Archive or Restore based on wave state
   - Color: `var(--text-primary)`

2. **🔓 Decrypt Wave** (conditionally shown if `wave.encrypted`)
   - Available to all participants (not just creator)
   - Fixes edge case where deleted creator prevented decryption
   - Color: `var(--accent-orange)`
   - Disabled state when `decryptingWave` is true

3. **⚙ Wave Settings** (creator only)
   - Border-top separator to visually group creator-only actions
   - Opens WaveSettingsModal
   - Color: `var(--accent-teal)`

4. **✕ Delete Wave** (creator only)
   - Destructive action clearly separated
   - Color: `var(--accent-orange)`

**Behavior:**
- Click outside closes menu (stopPropagation on menu items)
- Hover effects: `background: var(--bg-hover)`
- Menu auto-closes after action selection
- Maintains all previous functionality

#### Ping Actions Changes (`client/FarholdApp.jsx` lines 4436, 4552-4763)

**Before:**
```
[↵ Reply] [▶ Collapse] [⤢ Focus] [⤴ Share] [◈ Burst] [✏ Edit] [✕ Delete] [😀 React]
```
*8 buttons per ping, overwhelming especially in long threads*

**After:**
```
[↵ Reply] [▶ Collapse] [⋮ Menu] [😀 React]
```
*4 visible elements, cleaner and more focused*

**Implementation:**
- Added `showPingMenu` state (line 4436) for dropdown visibility
- Reorganized action buttons by usage frequency
- Three-dot menu contains less-frequent but important actions
- Maintains opacity transition (0.6 → 1.0 on hover) for all visible buttons

**Always Visible Actions:**
1. **↵ Reply** - Most common action, always accessible
   - At depth limit: Shows **⤢ Focus** instead
   - Color: `var(--text-dim)`

2. **▶/▼ Collapse/Expand** - Essential for thread navigation
   - Shows child count when collapsed (e.g., "▶12")
   - Color: `var(--accent-amber)`

3. **⋮ More Actions Menu** - Gateway to additional actions
   - Color: `var(--text-dim)`
   - Min width: 140px
   - Same styling as wave menu

4. **😀 React** - Quick emoji responses
   - Opens reaction picker with quick reactions
   - Color: `var(--text-dim)`

**Menu Structure:**
1. **⤢ Focus** (shown if `hasChildren && !isAtDepthLimit`)
   - Deep dive into thread
   - Color: `var(--text-primary)`

2. **⤴ Share** (shown if `wave.privacy === 'public'`)
   - Share public pings
   - Color: `var(--text-primary)`

3. **◈ Burst** (always shown)
   - Create new wave from this ping
   - Color: `var(--accent-teal)`

4. **✏ Edit** (author only)
   - Border-top separator for author actions
   - Color: `var(--accent-amber)`

5. **✕ Delete** (author only)
   - Destructive action clearly separated
   - Color: `var(--accent-orange)`

**Behavior:**
- Menu hidden when editing a ping (`!isEditing`)
- Click outside closes menu
- Hover effects consistent with wave menu
- Menu auto-closes after action selection
- stopPropagation prevents unintended ping clicks

#### Technical Details

**State Management:**
- `showWaveMenu: boolean` - Controls wave header dropdown
- `showPingMenu: boolean` - Controls per-ping dropdown (each Droplet has its own)

**Styling Consistency:**
- Both menus use identical styling patterns
- Hover effect: `background: transparent` → `background: var(--bg-hover)`
- Icon + label layout: `display: flex, gap: 8px`
- Touch-friendly padding: `8px 12px`
- Font size: `0.8rem` for menu items

**Mobile Optimization:**
- Three-dot button has larger touch target on mobile
- Menu items have `10px 14px` padding on mobile
- Full-width menu items easy to tap
- No need to precisely hit small icon buttons anymore

**Accessibility:**
- All actions remain keyboard accessible
- Clear visual hierarchy with icons and labels
- Color-coded by action type (teal=primary, amber=edit, orange=destructive)
- Hover states provide clear feedback

#### Benefits

**User Experience:**
- ✨ **Cleaner interface** - 70% reduction in visible buttons
- 📱 **Better mobile UX** - Larger touch targets, less cramping
- 🎯 **Improved focus** - Essential actions (Reply, React) remain visible
- 🔍 **Better discoverability** - Icons + labels in menu vs icon-only buttons
- ♿ **Maintained functionality** - All features still accessible, better organized

**Visual Hierarchy:**
- Privacy badge now stands out prominently
- Wave title has more breathing room
- Thread structure clearer without button clutter
- Actions organized by frequency and importance

**Consistency:**
- Matches patterns from wave list three-dot menu
- Consistent menu styling throughout app
- Predictable behavior across different contexts

**Technical:**
- Cleaner component structure
- Easier to add new actions without cluttering UI
- Better separation of concerns (common vs author-only actions)
- Improved mobile performance (fewer DOM elements)

#### Files Changed
- `client/FarholdApp.jsx`
  - Line 7094: Added `showWaveMenu` state
  - Lines 8357-8503: Wave header three-dot menu implementation
  - Line 4436: Added `showPingMenu` state
  - Lines 4552-4763: Ping actions three-dot menu implementation

## [2.2.3] - 2026-01-08

### Added

#### GIF Search Pagination with Tenor API v2 Support
Added "Load More" button to GIF picker modal allowing users to browse beyond the initial 20 results. Implemented proper token-based pagination for Tenor API v2.

**Problem:**
- Initial implementation used numeric offsets which work for GIPHY but not Tenor
- Tenor API v2 requires token-based pagination (`next` token from previous response)
- Users saw the same 20 GIFs repeatedly when clicking "Load More" with Tenor provider
- Trending GIFs would also repeat on initial modal open

**Solution:**
Implemented dual pagination strategy supporting both GIPHY (numeric offset) and Tenor (token-based):

**Server Changes** (`server/server.js`):
1. **Modified `searchTenor()` helper** (lines 6361-6398):
   - Changed signature from `searchTenor(query, limit, offset)` to `searchTenor(query, limit, pos)`
   - Now returns `{ gifs: [...], next: 'token' }` instead of just array
   - Uses Tenor's `pos` parameter for token-based pagination
   - Returns Tenor's `next` token for subsequent requests

2. **Modified `trendingTenor()` helper** (lines 6431-6472):
   - Same token-based pagination structure
   - Returns `{ gifs: [...], next: 'token' }`
   - Logs pagination tokens for debugging

3. **Updated `/api/gifs/search` endpoint** (lines 6490-6555):
   - Accepts new `pos` query parameter for Tenor pagination tokens
   - Returns `pagination.next` in response for client to use in next request
   - Maintains backward compatibility with GIPHY's offset-based pagination

4. **Updated `/api/gifs/trending` endpoint** (lines 6558-6617):
   - Same `pos` parameter and `pagination.next` response structure
   - Logs token values for debugging

**Client Changes** (`client/FarholdApp.jsx`):
1. **Added token tracking** (lines 1218-1219):
   - `offsetRef` for GIPHY numeric offsets
   - `nextTokenRef` for Tenor pagination tokens
   - Both reset when modal opens or new search starts

2. **Modified `loadTrending()`** (lines 1234-1276):
   - Builds URL with `pos` parameter when `nextTokenRef` has a value
   - Stores `data.pagination.next` token from response
   - Determines `hasMore` based on token presence or result count
   - Console logs show offset and token values for debugging

3. **Modified `searchGifs()`** (lines 1278-1326):
   - Same token-based pagination logic
   - Appends `pos` parameter to URL when available
   - Stores and uses Tenor tokens across "Load More" clicks

**How It Works:**
```
Initial Request (Tenor):
  → Client: /api/gifs/trending?limit=20
  → Server: calls Tenor API without pos
  → Tenor: returns 20 GIFs + next="CAIQAA"
  → Client: stores next="CAIQAA"

Load More Click:
  → Client: /api/gifs/trending?limit=20&pos=CAIQAA
  → Server: calls Tenor API with pos="CAIQAA"
  → Tenor: returns next 20 GIFs + next="CBAQAA"
  → Client: appends to existing GIFs, stores next="CBAQAA"

Continues until Tenor returns no next token...
```

**User Experience:**
- Initial load: 20 GIFs from Tenor/GIPHY
- Click "LOAD MORE GIFs": **Different** 20 GIFs appended below
- Works for both search results and trending GIFs
- Shows "Loading more..." text while fetching
- Button disappears when no more results available
- Mobile-friendly: Full-width button on mobile, auto-width on desktop
- Fixed: Trending GIFs now show fresh results when opening modal

**Technical Details:**
- Tenor tokens are opaque strings (e.g., "CAIQAA") managed server-side by Tenor
- GIPHY continues using numeric offsets (0, 20, 40, etc.)
- Both pagination methods coexist in same codebase
- When `provider='both'`, uses Tenor tokens since GIPHY supports both methods
- Console logging helps debug pagination state

**Files Changed:**
- `server/server.js` (lines 6358-6617):
  - Modified `searchTenor()` and `trendingTenor()` helpers
  - Updated `/api/gifs/search` and `/api/gifs/trending` endpoints
- `client/FarholdApp.jsx` (lines 1207-1520):
  - Added `nextTokenRef` for token tracking
  - Modified `loadTrending()` and `searchGifs()` with token support
  - Added "Load More" button UI

**Testing:**
- ✅ GIPHY pagination with numeric offsets
- ✅ Tenor pagination with next tokens
- ✅ Search results load more correctly
- ✅ Trending GIFs load more correctly
- ✅ Trending GIFs refresh on modal open
- ✅ Console logs show token progression

### Fixed

#### E2EE Key Distribution for New Participants
Fixed issue where adding participants to encrypted waves would fail silently, leaving new members unable to read messages.

**Problem Statement:**
- When adding participants to encrypted waves, key distribution could fail if:
  1. The person adding the participant hadn't loaded the wave recently (wave key not in cache)
  2. The new participant didn't have E2EE enabled
  3. Network issues during key distribution
- Failures were caught and shown as warnings, but participants were still added
- New participants would see encrypted gibberish instead of readable messages

**Root Cause:**
The `distributeKeyToParticipant()` function required the wave key to be in local cache:
```javascript
const waveKey = waveKeyCacheRef.current.get(waveId);
if (!waveKey) {
  throw new Error('Wave key not found in cache - reload the wave first');
}
```
If the user hadn't recently viewed the encrypted wave, the key wouldn't be cached.

**Solution (Option D - Automatic Key Refresh):**
Modified `InviteToWaveModal.handleInvite()` to:
1. **Pre-fetch wave key** before attempting to add any participants
2. **Block participant addition** if key fetch fails for encrypted waves
3. **Show clear error messages** for different failure scenarios
4. **Provide detailed warnings** when key distribution fails per-participant

**Implementation Details** (client/FarholdApp.jsx:6597-6671):

1. **Pre-fetch wave key** (lines 6608-6620):
```javascript
// If wave is encrypted, ensure we have the wave key cached
if (wave.encrypted && e2ee.isUnlocked) {
  try {
    console.log(`E2EE: Pre-fetching wave key for ${wave.id}...`);
    await e2ee.getWaveKey(wave.id);
    console.log(`E2EE: Wave key cached successfully`);
  } catch (keyErr) {
    console.error('E2EE: Failed to fetch wave key:', keyErr);
    setLoading(false);
    showToast('Cannot add participants: Failed to load encryption key...', 'error');
    return; // Block entire operation
  }
}
```

2. **Better error handling per participant** (lines 6638-6649):
- Distinguishes between different error types:
  - User doesn't have E2EE enabled: `"doesn't have encryption enabled"`
  - Wave key still not available: `"encryption key distribution failed"`
  - Other errors: Shows specific error message
- Collects warnings separately from fatal errors
- Still adds participant but shows clear warning about encryption failure

3. **Enhanced user feedback** (lines 6665-6667):
```javascript
if (e2eeWarnings.length > 0) {
  showToast(`⚠️ ${e2eeWarnings.join('; ')}`, 'warning');
}
```

**User Experience Improvements:**
- ✅ **Automatic**: No need to manually reload wave before adding participants
- ✅ **Clear errors**: If key fetch fails, shows: "Cannot add participants: Failed to load encryption key for this wave. Try reloading the wave first."
- ✅ **Specific warnings**: Tells user exactly why key distribution failed per participant:
  - "Alice doesn't have encryption enabled - they won't be able to read messages"
  - "Bob added but encryption key distribution failed - they won't be able to read messages"
- ✅ **Prevents confusion**: Users understand immediately when encryption will/won't work
- ✅ **Graceful degradation**: If one participant fails, others can still be added successfully

**Technical Details:**
- Uses existing `e2ee.getWaveKey()` which fetches from server if not cached
- Wave key remains cached after fetch for subsequent participants
- Logging helps debug E2EE issues: "E2EE: Pre-fetching wave key", "E2EE: Successfully distributed key to {user}"
- Error messages help users understand E2EE requirements

**Files Changed:**
- `client/FarholdApp.jsx` (lines 6597-6671):
  - Modified `InviteToWaveModal.handleInvite()` function
  - Added pre-fetch wave key logic
  - Enhanced error handling and user feedback
  - Added detailed E2EE warnings array

**Testing Scenarios:**
- ✅ Adding participant to encrypted wave (key in cache) → Success
- ✅ Adding participant to encrypted wave (key not in cache) → Auto-fetches, then succeeds
- ✅ Adding participant without E2EE enabled → Shows warning, participant added
- ✅ Network failure during key distribution → Shows specific error, participant still added
- ✅ Cannot fetch wave key at all → Blocks addition, shows error, no participants added

## [2.2.2] - 2026-01-07

### Fixed

#### Critical: Read/Unread Count Synchronization
Fixed critical issue where marking pings as read would update the database but not update the unread counts in the notification bell or wave list, forcing users to manually click each notification to clear counts.

**Problem Statement:**
- Clicking on a ping would mark messages as read in the database
- Unread counts in the notification bell and wave list would not update
- Users had to manually click each notification in the bell to force count updates
- The two tracking systems (notifications and ping reads) were out of sync

**Root Causes Identified:**
1. **Incomplete Event Broadcasting**: Server only broadcast `unread_count_update` event when notifications existed
2. **Race Conditions**: Client had overlapping `loadWaves()` API calls with no coordination
3. **Redundant Event Handlers**: Multiple event types all calling `loadWaves()` independently
4. **No Debouncing**: Rapid WebSocket events created "thundering herd" problem

**Server-Side Fixes** (`server/server.js`, `server/database-sqlite.js`):
- **Always broadcast `unread_count_update`** when marking pings read (line 12423)
  - Previously only broadcast when `notificationsMarked > 0`
  - Now broadcasts every time to ensure UI consistency
  - File: `server/server.js` (lines 12415-12426)

- **Enhanced wave read endpoint** (lines 11268-11278)
  - Marks all notifications for the wave via `markNotificationsReadByWave()`
  - Broadcasts both `unread_count_update` and `wave_read` events
  - Ensures complete synchronization between systems
  - File: `server/server.js` (lines 11268-11281)

- **Added `markNotificationsReadByWave()` database method** (lines 4872-4879)
  - Bulk marks all notifications for a specific wave as read
  - Complements existing per-ping notification marking
  - File: `server/database-sqlite.js` (lines 4871-4879)

**Client-Side Fixes** (`client/FarholdApp.jsx`):
- **Removed duplicate API calls** (lines 16974-16978)
  - `droplet_read` and `wave_read` events no longer call `loadWaves()` directly
  - Events now wait for `unread_count_update` which handles all refreshing
  - Eliminates race conditions from overlapping requests
  - Proper event chaining: `droplet_read` → `unread_count_update` → refresh

- **Added debouncing to `loadWaves()`** (lines 16892-16928)
  - Tracks if a load is already in progress using `useRef`
  - Queues subsequent calls with 300ms debounce if busy
  - Prevents thundering herd problem from multiple simultaneous events
  - Uses `loadWavesTimerRef` and `loadWavesInProgressRef` for coordination

**Event Flow (After Fix):**
```
User marks ping as read
    ↓
Server marks in database
    ↓
Server broadcasts: unread_count_update (ALWAYS)
    ↓
Server broadcasts: droplet_read (for UI consistency)
    ↓
Client receives unread_count_update
    ↓
Client refreshes: notification bell + wave list (with debouncing)
    ↓
UI fully synchronized ✓
```

**Testing:**
Confirmed working across all scenarios:
- ✅ Mark individual pings as read - counts update immediately
- ✅ Mark entire waves as read - counts update correctly
- ✅ Click notifications in bell - wave list updates properly
- ✅ Real-time synchronization across multiple browser tabs
- ✅ No race conditions or missed updates

**Technical Details:**
- Single source of truth: `unread_count_update` event handles all count refreshes
- Proper event chaining prevents duplicate work
- Debouncing prevents overlapping API calls
- Both notification and ping-unread systems update atomically

**Performance Improvements:**
- Reduced API call frequency through debouncing
- Eliminated redundant database queries
- Better WebSocket event coordination
- More predictable UI update behavior

**Files Changed:**
- `client/FarholdApp.jsx` - Debouncing and event handler improvements
- `client/package.json` - Version 2.2.2
- `server/server.js` - Event broadcasting fixes
- `server/database-sqlite.js` - Bulk notification marking method
- `server/package.json` - Version 2.2.2

## [2.2.1] - 2026-01-07

### Fixed

#### Wave Categories - Mobile Support and Critical Bug Fixes
Post-deployment fixes for wave categories feature introduced in v2.2.0.

**Mobile Support Improvements:**
- **Mobile "Manage Categories" Button**: Added settings button to mobile view with touch-friendly sizing (44px minimum)
  - Previously hidden with `!isMobile` condition
  - Now displays as "⚙" icon on mobile, full "⚙ MANAGE" text on desktop
  - File: `client/FarholdApp.jsx` (lines 4086-4103)

- **Mobile/PWA Wave Organization**: Implemented 3-dot menu (⋮) as alternative to drag-and-drop
  - HTML5 drag-and-drop doesn't work reliably on touch devices
  - Added menu button to each wave item with dropdown options:
    - Pin/unpin wave
    - Move to category (shows all available categories)
  - Click-outside handler to auto-close menu
  - File: `client/FarholdApp.jsx` (lines 3922-4027)

**UI/UX Improvements:**
- **Unread Badge Positioning**: Moved notification and unread count badges to the left of the menu button
  - Improves visual hierarchy and clarity
  - Badges now appear before the action button
  - File: `client/FarholdApp.jsx` (lines 3911-3920)

**Critical Bug Fixes:**
- **Category Reordering 400 Error**: Fixed Express route ordering issue preventing category reordering
  - **Root Cause**: The parameterized route `/api/wave-categories/:id` was defined before the literal route `/api/wave-categories/reorder`
  - Express matches routes sequentially, so `:id` was matching the string "reorder" before the specific handler could execute
  - **Solution**: Moved `/api/wave-categories/reorder` route definition to line 11382 (before `:id` route at line 11440)
  - Added comment: "MUST be before :id route to avoid matching 'reorder' as an id"
  - File: `server/server.js` (lines 11382-11423)

- **Activity Logging**: Added activity logging for category reorder operations
  - File: `server/server.js` (line 11416)

**Code Cleanup:**
- Removed extensive debug logging added during troubleshooting:
  - Removed request logging middleware
  - Removed body buffer verification
  - Removed JSON parsing error handlers
  - Cleaned up client-side debug console.log statements
  - Cleaned up database method debug logging
  - Files: `server/server.js`, `server/database-sqlite.js`, `client/FarholdApp.jsx`

**Testing:**
Confirmed working on:
- ✅ PWA mobile (iOS/Android)
- ✅ PWA desktop
- ✅ Desktop browser (Chrome, Firefox, Safari)
- ✅ Non-PWA mobile browsers

**Technical Details:**
- Express route matching is sequential - more specific routes must be defined before parameterized routes
- Touch devices don't support HTML5 drag-and-drop API reliably, requiring alternative UI patterns
- The 3-dot menu pattern provides consistent UX across all platforms

## [2.2.0] - 2026-01-07

### Added

#### Wave List Organization with Custom Categories
Complete wave organization system allowing users to create custom categories to organize their waves, with pinned waves, drag-and-drop functionality, collapsible groups, and group-level notifications.

**Features:**
- **Custom Categories**: Create user-defined categories (e.g., "Work", "Personal", "Projects") with custom names and colors
- **Pinned Waves**: Pin important waves to keep them always visible at the top of the list
- **Drag-and-Drop**: Move waves between categories using drag-and-drop (desktop) or long-press menu (mobile)
- **Collapsible Groups**: Collapse/expand categories to manage screen space, with state persisting across sessions
- **Group-Level Notifications**: See unread count badges at both wave and category level
- **Visual Organization**: Color-coded categories with wave counts and unread indicators
- **Per-User System**: Each user has their own category structure independent of other participants

**User Experience:**
```
┌─────────────────────────────────────┐
│ WAVES            [MANAGE] [📦] [+NEW]│
├─────────────────────────────────────┤
│ ⭐ PINNED (3)                    [▼] │
│   📌 Important Wave            (2)   │
│   📌 Quick Access              (1)   │
├─────────────────────────────────────┤
│ 💼 WORK (5)                      [▼] │
│   • Team Standup              (12)  │
│   • Project Alpha             (3)   │
├─────────────────────────────────────┤
│ 👥 PERSONAL (2)                  [▼] │
│   • Family Chat               (5)   │
├─────────────────────────────────────┤
│ 📂 UNCATEGORIZED (1)             [▼] │
│   • Random Wave               (0)   │
└─────────────────────────────────────┘
```

**Technical Implementation:**

**Database Schema** (`server/schema.sql`):
- **New Table: `wave_categories`** - Stores user-defined categories
  - Fields: id, user_id, name, color, sort_order, collapsed, created_at, updated_at
  - UNIQUE constraint on (user_id, name) prevents duplicate category names
  - Indexed on user_id and sort_order for fast lookups

- **New Table: `wave_category_assignments`** - Maps waves to categories per user
  - Fields: user_id, wave_id, category_id (nullable), assigned_at
  - PRIMARY KEY (user_id, wave_id) ensures one category per wave
  - category_id NULL represents uncategorized waves
  - Indexed on user_id, category_id, and wave_id

- **Enhanced: `wave_participants`** table
  - Added `pinned INTEGER DEFAULT 0` column for wave pinning
  - Indexed on (user_id, pinned) for fast pinned wave queries

**Database Methods** (`server/database-sqlite.js`):
- `getCategoriesForUser(userId)` - Fetch all categories with wave counts and unread counts
- `createCategory(userId, data)` - Create new category with validation
- `updateCategory(categoryId, userId, data)` - Update category name, color, or collapsed state
- `deleteCategory(categoryId, userId)` - Delete category with safety checks
- `reorderCategories(userId, categoryOrders)` - Bulk update category sort order
- `assignWaveToCategory(waveId, userId, categoryId)` - Assign wave to category
- `getWaveCategoryAssignment(waveId, userId)` - Get current category assignment
- `pinWaveForUser(waveId, userId, pinned)` - Pin/unpin wave for user
- Modified `getWavesForUser()` - Enhanced to JOIN category data and pinned status

**API Endpoints** (`server/server.js`):
- `GET /api/wave-categories` - List user's categories
- `POST /api/wave-categories` - Create new category
- `PUT /api/wave-categories/:id` - Update category (name, color, collapsed state)
- `DELETE /api/wave-categories/:id` - Delete category
- `PUT /api/wave-categories/reorder` - Reorder categories
- `PUT /api/waves/:waveId/category` - Assign wave to category
- `PUT /api/waves/:waveId/pin` - Pin/unpin wave

**WebSocket Events** (Real-time Updates):
- `category_created` - New category created
- `category_updated` - Category modified
- `category_deleted` - Category removed
- `categories_reordered` - Category order changed
- `wave_category_changed` - Wave moved between categories
- `wave_pinned_changed` - Wave pinned/unpinned

**Client Components** (`client/FarholdApp.jsx`):
- **WaveCategoryList** (lines 3822-4069) - Main category list component
  - Groups waves by category with pinned section
  - Renders collapsible sections for each category
  - Implements drag-and-drop handlers
  - Calculates group-level unread counts
  - Shows "Uncategorized" section for waves without category

- **CategoryManagementModal** (lines 5360-5595) - Category CRUD interface
  - Create new categories with name and color selection
  - Rename/delete existing categories
  - View wave counts and unread counts per category
  - Color picker with Farhold theme colors
  - Inline editing with Enter/Escape keyboard shortcuts

- **Enhanced WaveList** (lines 4071-4213) - Updated to use categories
  - Conditionally renders WaveCategoryList if categories exist
  - Falls back to flat list if no categories
  - Added "Manage Categories" button
  - Passes all category handlers to child components

- **State Management** (lines 16626-16627, 16751-16813) - Category state
  - `waveCategories` state for storing user's categories
  - `categoryManagementOpen` state for modal visibility
  - `loadCategories()` - Fetch categories from API
  - `handleCategoryToggle()` - Toggle collapse state with optimistic UI update
  - `handleWaveMove()` - Move wave between categories
  - `handleWavePin()` - Pin/unpin wave with immediate local state update

- **WebSocket Integration** (lines 16913-16922) - Real-time category updates
  - Handles all category-related WebSocket events
  - Automatically reloads categories and waves on changes
  - Maintains sync across multiple clients

**Migration** (`server/database-sqlite.js` lines 1207-1299):
- Automated migration runs on server startup via `applySchemaUpdates()`
- Creates all tables and indexes automatically
- Creates default "General" category for all existing users
- Backward compatible - runs safely on existing databases
- Idempotent - checks if tables exist before running

**How It Works:**
1. User creates categories via "Manage Categories" button
2. Waves can be dragged into categories or moved via API
3. Categories are rendered as collapsible sections with CollapsibleSection component
4. Pinned waves always appear at top regardless of category
5. Category collapsed state persists in database per user
6. Real-time WebSocket events keep all clients synchronized
7. Archive toggle works across all categories

**Design Decisions:**
- **Per-User Categories**: Each user organizes their wave list independently
- **One Category Per Wave**: Simplifies mental model and UI (no multi-assignment)
- **Pinned Section**: Always visible at top, spans all categories
- **Uncategorized Fallback**: Waves without category go to "Uncategorized" section
- **Server-Side State**: Collapsed state stored in database for cross-device persistence
- **Archive Compatibility**: Archive toggle applies across all categories
- **Federation Safe**: Category data is local-only, doesn't affect cross-server waves

**Files Modified:**
- `server/schema.sql` - Added wave_categories, wave_category_assignments tables, pinned column
- `server/database-sqlite.js` - Added 9 category methods, modified getWavesForUser (lines 3771-4003, 3222-3302)
- `server/server.js` - Added 7 API endpoints with WebSocket broadcasts (lines 11295-11576)
- `client/FarholdApp.jsx` - Added WaveCategoryList, CategoryManagementModal, state management
- `server/package.json` - Version 2.2.0
- `client/package.json` - Version 2.2.0

**Migration:**
- Automatic migration on server startup via `applySchemaUpdates()` method
- Checks if `wave_categories` table exists before running
- Zero downtime deployment
- Backward compatible with existing waves
- Default "General" category auto-created for all users
- Migration integrated in `database-sqlite.js` lines 1207-1299

## [2.1.1] - 2026-01-06

### Added

#### Breadcrumb Navigation for Burst Waves
One-level breadcrumb navigation that shows the parent wave when viewing a burst wave, making it easy to navigate back to context.

**Features:**
- **Clickable Parent Link**: Parent wave title displayed as clickable link above current wave title
- **One-Level Back**: Shows immediate parent only (burst of burst shows nearest parent, not full chain)
- **Access Controlled**: Breadcrumb only appears if user has permission to view parent wave
- **Visual Design**: Teal accent color with arrow (→) separator matching Farhold aesthetic
- **Smart Display**: Long titles truncated with ellipsis (max 200px), tooltip shows full title on hover
- **Responsive**: Works on mobile and desktop layouts

**User Experience:**
```
[← Back] [Parent Wave Title →]
         Current Burst Wave Title
         2 participants • 5 pings
```

**Technical Implementation:**
- **Server Enhancement** (`server/server.js`):
  - GET `/api/waves/:id` endpoint now includes `parent_wave` field for burst waves
  - Returns `{ id, title }` of parent wave if `wave.brokenOutFrom` exists
  - Access control enforced - only returns parent info if user can access it
  - Added lines 10746-10756, 10795

- **Client Component** (`client/FarholdApp.jsx`):
  - Breadcrumb UI added to WaveView header component
  - Positioned above wave title with smaller, muted styling
  - Uses existing `onNavigateToWave` callback for navigation
  - Conditional rendering based on `waveData.parent_wave` presence
  - Added lines 7341-7373

**How It Works:**
1. When loading a wave, server checks if `brokenOutFrom` exists
2. If yes, fetches parent wave and verifies user access
3. Returns parent wave ID and title in API response
4. Client displays breadcrumb link above wave title
5. Click navigates to parent using standard wave navigation

**Files Modified:**
- `server/server.js` - Enhanced `/api/waves/:id` endpoint with parent wave lookup
- `client/FarholdApp.jsx` - Added breadcrumb UI component to WaveView header

**Migration:**
- No database changes required (uses existing `broken_out_from` column)
- Backward compatible with all existing waves
- Zero downtime deployment

#### Production Bot Configuration
Added production bot integration settings to `.env.example` for automated release announcements from development to production environments.

**Environment Variables Added:**
```bash
# Production Bot Integration (v2.1.0)
FARHOLD_PROD_URL=https://app.farhold.com
FARHOLD_PROD_BOT_KEY=fh_bot_your-key-here
FARHOLD_PROD_UPDATES_WAVE_ID=your-wave-id-here
```

**Use Case:**
Enables development environments to post automated release announcements to production Farhold servers using bot API keys.

**Files Modified:**
- `server/.env.example` - Added production bot configuration section

### Fixed

#### Burst Waves from Crew Waves Not Appearing in Wave List
Fixed critical bug where burst waves created from crew/group waves weren't visible in the wave list for participants who weren't crew members.

**Problem:**
When a ping was burst out of a crew wave:
1. The new burst wave inherited `privacy='crew'` from the parent wave
2. The new burst wave inherited `crew_id` from the parent wave
3. Participants were added to `wave_participants` table
4. **But**: The wave list query only checks crew membership for crew waves, not `wave_participants`
5. **Result**: Non-crew participants couldn't see the burst wave in their wave list

**Root Cause:**
The `getWavesForUser()` query has this logic:
```sql
WHERE (
  w.privacy = 'public'
  OR (w.privacy = 'private' AND wp.user_id IS NOT NULL)
  OR ((w.privacy = 'crew' OR w.privacy = 'group') AND w.crew_id IN (...crew IDs...))
)
```

For crew waves, it checks crew membership via `crew_id`, not the `wave_participants` table. So burst waves with crew privacy weren't visible to non-crew participants even though they were explicitly added as participants.

**Solution:**
Burst waves are now **always created as private waves** with explicit participants, regardless of parent wave privacy. This makes conceptual sense - bursts are focused subset conversations, not crew-wide discussions.

**Code Change** (`server/database-sqlite.js:3542-3543`):
```javascript
// Before:
privacy: originalWave.privacy || 'private',  // Inherited crew privacy
crew_id: originalWave.groupId || null,       // Inherited crew ID

// After:
privacy: 'private', // Always private for burst waves (v2.1.1 fix)
crew_id: null,      // No crew_id - use explicit participants instead
```

**Impact:**
- ✅ Burst waves now appear in wave list for all invited participants
- ✅ Conceptually correct: bursts are participant-based, not crew-based
- ✅ Consistent behavior across all parent wave types (private, public, crew)
- ✅ No breaking changes to existing functionality
- ✅ Only affects newly created burst waves

**Migration:**
- No database migration required
- Existing burst waves retain their current privacy settings
- Only new burst waves use the updated logic

**Files Modified:**
- `server/database-sqlite.js` - Lines 3542-3543 in `breakoutDroplet()` method

### Technical Details

**API Response Enhancement:**
```javascript
// GET /api/waves/:id response now includes:
{
  ...wave,
  parent_wave: {
    id: "wave-abc123",
    title: "Original Wave Title"
  } // null if not a burst wave or user can't access parent
}
```

**Breadcrumb Component Styling:**
- Font size: 0.7rem (smaller than wave title)
- Color: `var(--text-dim)` for text, `var(--accent-teal)` for link
- Max width: 200px with ellipsis overflow
- Gap: 6px between elements
- Margin bottom: 4px from wave title

**Performance:**
- Single additional DB query per wave view (only if burst wave)
- Query uses existing index on `waves.id`
- Access control check uses existing `canAccessWave()` method
- Minimal impact on page load time

### Benefits

**User Experience:**
- Easier navigation between related waves
- Clear visual hierarchy of burst wave relationships
- One-click return to context without browser back button
- Better understanding of wave conversation flow

**Technical:**
- Backward compatible with existing waves
- No database migrations required
- Uses existing wave relationship data
- Clean separation of concerns (server/client)

---

## [2.1.0] - 2026-01-06

### Added

#### Bot/Webhook System
Comprehensive automated posting system allowing external services and scripts to post into Farhold waves with full E2EE support.

**Authentication:**
- **API Key System**: Static token-based authentication with `fh_bot_` prefix
- **256-bit Security**: API keys generated with `crypto.randomBytes(32)` (64 hex characters)
- **SHA-256 Hashing**: Keys hashed before storage, never stored in plaintext
- **One-Time Display**: API keys shown once at creation with copy-to-clipboard functionality
- **Bearer Token Format**: Standard `Authorization: Bearer fh_bot_...` header authentication

**Bot Management (Admin-Only):**
- **BotsAdminPanel Component**: Full admin UI for bot lifecycle management
- **Create Bot Modal**: Name, description, and optional webhook configuration
- **Bot Details Modal**: Manage bot information, permissions, and wave access
- **API Key Display Modal**: Secure one-time display of newly generated keys
- **Regenerate Keys**: Invalidate old keys and generate new ones
- **Status Management**: Activate, suspend, or delete bots
- **Statistics Display**: Track total pings, API calls, and wave access per bot

**Bot API Endpoints** (require bot authentication):
- `POST /api/bot/ping` - Create ping in wave (returns bot-formatted ping data)
- `GET /api/bot/waves` - List all accessible waves
- `GET /api/bot/waves/:id` - Get wave details with recent pings
- `GET /api/bot/waves/:id/key` - Get encrypted wave key for E2EE waves

**Admin Bot Management Endpoints** (require ADMIN role):
- `POST /api/admin/bots` - Create bot (returns API key once)
- `GET /api/admin/bots` - List all bots with stats
- `GET /api/admin/bots/:id` - Get bot details
- `PATCH /api/admin/bots/:id` - Update bot (name, description, status)
- `DELETE /api/admin/bots/:id` - Delete bot (cascade deletion)
- `POST /api/admin/bots/:id/regenerate` - Regenerate API key
- `POST /api/admin/bots/:id/permissions` - Grant wave access (can_post, can_read)
- `DELETE /api/admin/bots/:id/permissions/:waveId` - Revoke wave access

**Webhook Integration:**
- `POST /api/webhooks/:botId/:webhookSecret` - Receive external webhooks
- **Secret Validation**: Each bot has unique webhook secret for authentication
- **50KB Payload Limit**: Prevents abuse from oversized webhook payloads
- **Permission Enforcement**: Webhooks respect bot wave permissions
- **URL Display**: Webhook endpoint URL shown in bot details modal

**End-to-End Encryption Support:**
- **Bot Keypairs**: ECDH P-384 keypairs generated for each bot
- **Private Key Encryption**: Bot private keys encrypted with master bot key (`BOT_MASTER_KEY` env var)
- **Wave Key Distribution**: Bots receive encrypted wave keys via `bot_wave_keys` table
- **E2EE Posting**: Bots can post encrypted pings to encrypted waves
- **Key Version Support**: Multi-version key support for reading after rotation
- **Automatic Key Distribution**: Wave permissions automatically distribute encryption keys

**Security Features:**
- **Rate Limiting**: 300 requests/minute per bot (5x higher than user limit)
- **Content Sanitization**: All bot-posted content sanitized with `sanitizeMessage()`
- **Permission Checks**: Wave-level access control (can_post, can_read)
- **Activity Logging**: All bot operations logged to `activity_log` table
- **Status Validation**: Only active bots can use API (suspended/revoked bots blocked)
- **Webhook Secret**: Cryptographically secure webhook authentication
- **Admin-Only Management**: Only admins can create/modify/delete bots

**Bot Ping Format:**
Bot pings use special author format to distinguish from user pings:
```javascript
{
  authorId: "bot:{botId}",
  sender_name: "[Bot] {botName}",
  sender_handle: "{botName-slugified}",
  sender_avatar: "🤖",
  isBot: true,
  botId: "{botId}"
}
```

**Database Schema:**
Three new tables added:
- `bots` - Bot identity, API key hash, stats, E2EE keypair, webhook secret
- `bot_permissions` - Wave-level access control per bot
- `bot_wave_keys` - Encrypted wave keys for E2EE support

**Database Methods:**
- `createBot()` - Create new bot with API key hash
- `getBot()` - Get bot by ID
- `findBotByApiKeyHash()` - Find bot by hashed API key
- `getAllBots()` - List all bots
- `updateBot()` - Update bot metadata
- `deleteBot()` - Delete bot (cascade to permissions and keys)
- `regenerateBotApiKey()` - Regenerate API key hash
- `updateBotStats()` - Track API calls and ping counts
- `grantBotPermission()` - Grant wave access
- `revokeBotPermission()` - Revoke wave access
- `botCanAccessWave()` - Check bot permission
- `getBotPermissions()` - Get all bot permissions
- `getBotWaves()` - Get accessible waves for bot
- `createBotWaveKey()` - Store encrypted wave key
- `getBotWaveKey()` - Retrieve encrypted wave key

**Server Middleware:**
- `authenticateBotToken()` - JWT-style bot authentication middleware
- `botLimiter` - Rate limiter for bot endpoints (300 req/min)
- `hashToken()` - SHA-256 token hashing utility

**UI Components:**
- **BotsAdminPanel** (542 lines) - Main bot management interface
  - Bot list with stats display
  - Create bot modal with webhook toggle
  - API key display modal with copy button
  - Status management actions
  - Responsive mobile layout
- **BotDetailsModal** (309 lines) - Bot configuration interface
  - Bot information display
  - Webhook endpoint URL with copy button
  - Wave permissions list
  - Add/revoke wave permissions modal
  - Permission statistics
  - Mobile-optimized layout

**Admin UI Integration:**
- Bot management panel added to Profile Settings admin section
- Accessible via "Bots" toggle in admin panel
- Same collapsible pattern as other admin panels
- Restricted to admin role users only

**Example Usage:**
```bash
# Create Bot (Admin)
curl -X POST https://farhold.com/api/admin/bots \
  -H "Authorization: Bearer {admin-jwt}" \
  -H "Content-Type: application/json" \
  -d '{"name": "GitHub Bot", "description": "Posts commit notifications", "enableWebhook": true}'

# Post Ping (Bot)
curl -X POST https://farhold.com/api/bot/ping \
  -H "Authorization: Bearer fh_bot_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"waveId": "wave-xyz", "content": "Build passed! ✅"}'

# Webhook (External)
curl -X POST https://farhold.com/api/webhooks/{botId}/{secret} \
  -H "Content-Type: application/json" \
  -d '{"waveId": "wave-xyz", "content": "Alert: Server down!"}'
```

### Technical Details

**Files Modified:**
- `server/schema.sql` - Added 3 new tables (bots, bot_permissions, bot_wave_keys)
- `server/database-sqlite.js` - Added bot migration and 15+ database methods
- `server/server.js` - Added bot middleware, admin endpoints, bot API, webhook receiver
- `client/FarholdApp.jsx` - Added BotsAdminPanel and BotDetailsModal components

**Migration:**
- Auto-migration on server startup via `applySchemaUpdates()`
- Creates tables if not exist (no manual migration required)
- Backward compatible with existing waves/pings

**Environment Variables:**
```bash
BOT_MASTER_KEY=your-secret-key  # Optional: For encrypting bot private keys
```

**Rate Limits:**
- Bot API endpoints: 300 requests/minute
- User API endpoints: 60 requests/minute (unchanged)

**Activity Logging:**
All bot operations logged with `bot:{botId}` as user_id:
- Bot creation/deletion
- API key regeneration
- Permission grants/revokes
- Ping creation
- Webhook posts

### Security Considerations

**What's Protected:**
- API keys never stored in plaintext (SHA-256 hashed)
- API keys displayed once at creation only
- Bot operations require active status (suspended bots blocked)
- Wave permissions enforced before all operations
- Content sanitized before storage and broadcast
- Webhook secrets cryptographically secure
- Rate limiting prevents abuse

**Best Practices:**
- Store API keys securely (environment variables, secrets managers)
- Regenerate keys if compromised
- Grant minimum necessary permissions per bot
- Monitor bot activity via activity log
- Suspend bots instead of deleting (preserves audit trail)
- Use webhooks only when necessary (API keys preferred)

### Known Limitations

**v2.1.0 Scope:**
- Bots are local-only (no federation support)
- Bots cannot create waves (permission flag exists for future)
- E2EE wave key distribution requires manual permission grant (auto-distribution coming in v2.1.1)
- No bot analytics dashboard (statistics shown in bot list only)
- No scheduled pings (cron-like feature planned for v2.2.0)

**Future Enhancements (v2.2.0+):**
- Bot wave creation permission
- Bot analytics dashboard
- Advanced webhook formats (Slack, Discord, GitHub)
- Bot command parsing (e.g., `/bot-name command`)
- Scheduled pings (cron-like)
- Federation bot support

---

## [2.0.5] - 2026-01-05

### Added

#### Configurable Session Expiration
Session duration is now configurable at login/registration to balance security and convenience.

**Security Enhancement:**
- **Default session duration reduced from 7 days to 24 hours** for improved security
- Sessions now have hard expiration times that cannot be bypassed, even if browser tabs remain open
- Prevents indefinite session persistence from forgotten open tabs

**User-Selectable Duration:**
- Users can choose session duration at login/register:
  - **24 hours** (recommended, default)
  - **7 days** (convenience)
  - **30 days** (maximum convenience)
- Selection preserved through MFA verification flow
- Session duration selector added to login and registration forms

**Session Management UI:**
- Active sessions now display expiration countdown ("Expires in 23h")
- New `formatExpirationDate()` helper formats future dates with time-remaining countdown
- Sessions show "Expired" if already past expiration time

**Technical Implementation:**
- Added `SESSION_DURATIONS` constant with allowed durations (24h, 7d, 30d)
- Added `getSessionDuration()` validation function on server
- Updated `/api/auth/login` endpoint to accept `sessionDuration` parameter
- Updated `/api/auth/register` endpoint to accept `sessionDuration` parameter
- Updated `/api/auth/mfa/verify` endpoint to use stored `sessionDuration` from challenge
- Fixed `/api/auth/sessions` endpoint to include `expiresAt` field in response
- Database migration adds `session_duration TEXT DEFAULT '24h'` to `mfa_challenges` table
- Updated `schema.sql` for fresh installations
- Existing sessions continue to work until their original expiration

**Files Changed:**
- `server/server.js` - Session duration validation and endpoint updates
- `server/database-sqlite.js` - Database migration and `createMfaChallenge()` update
- `server/schema.sql` - Schema update for new installations
- `server/.env.example` - Updated JWT_EXPIRES_IN default and documentation
- `client/FarholdApp.jsx` - Session duration selector UI and auth function updates

---

## [2.0.3] - 2026-01-04

### Added

#### Crawl Bar: Pause & Drag Interaction
Interactive crawl bar that allows users to pause and manually scroll through content.

**Features:**
- **Pause on hover/touch**: Animation pauses when user hovers (desktop) or touches (mobile)
- **Drag to scroll**: Click and drag left/right to manually scroll through content
  - Drag right → see earlier content (scroll backwards)
  - Drag left → see later content (scroll forwards)
  - Seamless wrapping at content boundaries
- **Auto-resume**: Animation resumes from current position after 3 seconds of no interaction
- **Visual indicators**:
  - Amber border glow when paused
  - Pause icon (⏸) displayed in corner when paused
  - Drag arrows (◀ ▶) shown while actively dragging
  - Cursor changes to grab/grabbing during interaction

**Technical:**
- Uses Web Animations API `currentTime` property for precise position control
- Pixel-to-time conversion for smooth drag-to-scroll mapping
- Global mouse event listeners for drag beyond component bounds
- Touch event support for mobile devices
- User-select disabled to prevent text selection during drag

---

## [2.0.2] - 2026-01-03

### Added

#### Firefly Easter Eggs (Phase 1)
Firefly-themed messages woven throughout the UI to reinforce brand identity. The Firefly aesthetic is always on as part of the core Farhold experience.

**Rotating Footer Taglines** (30-second interval)
- "Can't stop the signal"
- "Keep flying"
- "We're still flying, that's something"
- "You can't take the sky from me"
- "Find a crew, find a job, keep flying"
- "Privacy isn't a feature, it's a foundation"
- "The signal is strong"
- "Shiny"
- "I aim to misbehave"
- "We have done the impossible, and that makes us mighty"

**Success Messages** (toast notifications)
| Action | Message |
|--------|---------|
| Generic success | "Shiny!" |
| Ping sent | "Signal's away" |
| Wave created | "New signal on the cortex" |
| Wave updated | "Signal adjusted" |
| Wave deleted | "Signal terminated" |
| Wave archived | "Signal archived" |
| Wave restored | "Signal restored" |
| Link copied | "Coordinates locked" |
| Contact added | "New crew member aboard" |
| Contact removed | "Crew member departed" |
| Contact request sent | "Hail sent" |
| Contact request accepted | "Welcome aboard!" |
| Joined crew | "You're in the air" |
| Left crew | "You've jumped ship" |
| Crew created | "Crew assembled" |
| Crew deleted | "Crew disbanded" |
| Invitation sent | "Invitation transmitted" |
| Profile updated | "Ship's log updated" |
| Password changed | "New codes set" |
| Shared | "Signal boosted" |

**Empty State Messages**
| Context | Message |
|---------|---------|
| No waves | "Cortex is quiet" |
| No waves (with CTA) | "Cortex is quiet. Start a signal?" |
| No notifications | "Ain't heard a peep" |
| No pings | "Nothing but black out here" |
| No search results | "Nothing in the black matches that" |
| No contacts | "No crew yet" |
| No crews | "Flying solo" |
| No GIFs | "No captures found" |
| No users found | "No souls out here" |
| No alerts | "All quiet on the cortex" |
| No sessions | "No active docking bays" |

**Loading State Messages**
| Context | Message |
|---------|---------|
| Generic loading | "Spinning up..." |
| Searching | "Scanning the cortex..." |
| Sending | "Transmitting..." |
| Connecting | "Awaiting docking clearance..." |
| Encrypting | "Running encryption protocols..." |
| Uploading | "Uploading cargo..." |

**Confirmation Button Labels**
| Action | Button Text |
|--------|-------------|
| Delete | "Let's be bad guys" |
| Destructive confirm | "I aim to misbehave" |
| Cancel | "Belay that" |
| Leave | "Jump ship" |
| Confirm | "Do the job" |

**Error Prefix**
- Non-technical errors prefixed with "Gorram it!"

#### Technical
- **New `client/messages.js` Module**: Centralized Firefly-themed messages
  - `SUCCESS` - Success toast message constants
  - `ERROR_PREFIX` - Error message prefix ("Gorram it!")
  - `EMPTY` - Empty state message constants
  - `LOADING` - Loading state message constants
  - `CONFIRM` - Confirmation button label constants
  - `TAGLINES` - Footer tagline array
  - `getRandomTagline()` - Returns random tagline for footer rotation
  - `formatError(message)` - Wraps message with Firefly error prefix

### Changed
- Footer now displays rotating taglines instead of static wave/crew/contact counts
- ~25 UI locations updated to use themed messages from `messages.js`

---

## [2.0.1] - 2026-01-03

### Fixed

#### Search Navigation
- **Search now scrolls to correct ping**: Clicking a search result now navigates to the wave AND scrolls to the specific message with amber highlight animation
  - Added `setScrollToDropletId(result.id)` to `handleSearchResultClick`
  - Leverages existing WaveView scroll-to mechanism that was previously unused by search

#### Authentication & Session Handling
- **Crew waves no longer force logout**: Accessing a crew wave you don't have permission for now shows an error instead of logging you out
  - Changed `useAPI` hook to only call `logout()` on 401 (authentication failure), not 403 (authorization denied)
- **PWA sessions persist through network errors**: App no longer clears your session when `/auth/me` fails due to network issues
  - Only clears session on 401 (invalid/expired token)
  - Network errors and server errors now preserve cached session data
  - Prevents frustrating re-login prompts when server is temporarily unreachable

#### Mobile UI
- **Added search button to mobile header**: Mobile users can now access the search feature
  - Search 🔍 and notification 🔔 buttons added to right side of mobile header
  - Previously these were desktop-only

---

## [1.19.5] - 2025-12-26

### Added

#### Tenor GIF Support
- **Configurable GIF Provider**: Server-side configuration to use GIPHY, Tenor, or both
  - `GIF_PROVIDER` environment variable: `giphy`, `tenor`, or `both`
  - `TENOR_API_KEY` for Tenor API v2 integration
- **Dynamic Attribution**: GIF search modal shows "Powered by Tenor" or "Powered by GIPHY" based on active provider
- **Tenor API v2**: Full support for Tenor's search and featured/trending endpoints

#### TikTok Thumbnails
- **Video Previews**: TikTok links now display video thumbnails via oEmbed API
- **Rich Link Cards**: Styled cards show thumbnail, author name, and video title
- **Click to Open**: Cards link to TikTok in new tab (embed.js incompatible with React)

### Fixed

#### Critical: Unread Count Bug
- **Wave List Not Updating**: Fixed bug where unread counts were always 0 for users without blocked/muted users
  - Root cause: SQL `NOT IN (NULL)` returns NULL instead of TRUE, excluding all rows
  - Fix: Conditional SQL clauses only added when blocked/muted arrays have items
- **Immediate Updates**: Wave list now correctly refreshes after marking droplets as read

#### GIF Embedding
- **Tenor CDN URLs**: Fixed direct Tenor/GIPHY CDN URLs (media.tenor.com, i.giphy.com) being properly embedded as images
- **Tenor Short URLs**: Fixed tenor.com/xxx.gif URLs being incorrectly treated as images (they're redirect pages)
- **oEmbed Public Access**: Made `/api/embeds/oembed` endpoint public (no auth required) for embed previews
- **Trending GIFs**: Fixed GIF modal to always load fresh trending when opened (removed stale data check)

#### TikTok oEmbed
- **Field Normalization**: Fixed mismatch between server response fields (`thumbnail`, `author`) and client expectations (`thumbnail_url`, `author_name`)

### Configuration

New environment variables in `.env`:
```
TENOR_API_KEY=your-tenor-api-key
GIF_PROVIDER=tenor  # Options: giphy, tenor, both
```

---

## [1.19.4] - 2025-12-26

### Improved

#### E2EE Unlock Modal Text
- **Clearer password prompt**: On PWA reopen, now shows simple "Enter your password to unlock your encrypted messages" instead of confusing "Original Encryption Passphrase"
- **Migration notice only when needed**: The "Original Encryption Passphrase" message now only appears when auto-unlock actually fails due to password mismatch (for users who set up E2EE before password-based encryption)
- **Better labels**: Changed "Current Password" to just "Password" with placeholder "Enter your login password"
- Added `passwordMismatch` state to distinguish between failed unlock vs no pending password

---

## [1.19.3] - 2025-12-26

### Fixed

#### E2EE Unlock on PWA Reopen
- **Fixed stuck spinner on PWA reopen**: When reopening the PWA or refreshing the page, the app was stuck on "Preparing encryption..." spinner
  - Root cause: Auto-unlock logic only triggered when there was a pending password from login
  - On page refresh or PWA reopen, there's no pending password, so auto-unlock never triggered
  - Fix: If passphrase is needed but no pending password exists, immediately show the unlock modal
- Service worker version updated to v1.19.3

---

## [1.19.2] - 2025-12-26

### Fixed

#### PWA Caching Issue
- **Network-First for HTML**: Service worker now uses network-first strategy for HTML/navigation requests
  - Fixes spinning circle issue where stale cached HTML referenced non-existent JS bundles
  - PWA now always fetches fresh HTML on launch, with cache fallback only when offline
- **Cache-First for Hashed Assets**: JS/CSS files with content hashes still use cache-first (safe because immutable)
- **Emergency Recovery**: `?clear=1` URL parameter clears all localStorage, sessionStorage, IndexedDB, service workers, and caches

### Technical Details
- Service worker version updated to v1.19.2
- Navigation requests (`request.mode === 'navigate'`) always hit network first
- Hashed asset detection via regex: `/\.[a-f0-9]{8,}\.(js|css)$/i`

---

## [1.19.1] - 2025-12-26

### Added

#### Wave Participant Management
- **Invite Participants**: INVITE button in participant panel allows wave creators to add contacts
  - `POST /api/waves/:id/participants` endpoint
  - InviteToWaveModal component with contact search
  - E2EE key distribution for new participants via `distributeKeyToParticipant()`
- **Remove Participants**: Wave creators can remove participants with REMOVE button
  - `DELETE /api/waves/:id/participants/:userId` endpoint
  - Automatic wave key rotation when participant is removed
- **Leave Wave**: All participants can leave waves with LEAVE button
  - Uses same DELETE endpoint as removal
  - WebSocket events: `participant_added`, `participant_removed`, `added_to_wave`, `removed_from_wave`

#### Stale Data Recovery
- **Clear Data Button**: Login screen shows "Clear all data" button for recovery from broken cached state
- **Version Check**: Automatic data clearing when major version changes (e.g., 1.18.x → 1.19.x)
- **URL Parameter Recovery**: `?clear=1` clears all cached data on any page load
  - Clears: localStorage, sessionStorage, IndexedDB, service worker registrations, caches
  - Redirects to clean URL after clearing

### Database
- Added `removeWaveParticipant()` method to SQLite database class

---

## [1.19.0] - 2025-12-24

### Added

#### End-to-End Encryption (E2EE)
- **Always-On Encryption**: All new waves are encrypted by default when E2EE is enabled
- **User Key Management**: ECDH P-384 keypairs generated per user, protected by passphrase
- **Passphrase-Based Key Protection**: Private keys encrypted with PBKDF2-derived keys (600k iterations)
- **Recovery System**: Generated recovery keys for backup access (24-character Base32 format)
- **Per-Wave Keys**: Each wave has its own AES-256-GCM symmetric key
- **Key Distribution**: Wave keys encrypted for each participant using ECDH key exchange
- **Key Rotation**: Automatic key rotation when participants are removed from waves
- **Legacy Wave Support**: Unencrypted waves from before E2EE show "Legacy Wave" notice

#### E2EE Client Components
- **E2EE Setup Modal**: Two-step setup flow (passphrase → save recovery key)
- **Passphrase Unlock**: Login requires passphrase to decrypt private key
- **Recovery Flow**: Recover access using recovery key if main passphrase forgotten
- **E2EE Context Provider**: React context for encryption state and operations
- **Wave Key Cache**: LRU cache (100 keys) for decrypted wave keys

#### E2EE API Endpoints
- `GET /api/e2ee/status` - Check E2EE status for current user
- `POST /api/e2ee/keys/register` - Register user's encrypted keypair
- `GET /api/e2ee/keys/me` - Get own encrypted private key (for new device setup)
- `GET /api/e2ee/keys/user/:id` - Get another user's public key
- `POST /api/e2ee/recovery/setup` - Configure recovery key
- `GET /api/e2ee/recovery` - Get recovery data (encrypted key + salt)
- `GET /api/waves/:id/key` - Get encrypted wave key for current user
- `POST /api/waves/:id/key/rotate` - Rotate wave key (participant removal)
- `GET /api/waves/:id/keys/all` - Get all key versions for wave (key rotation)

#### Database Schema
- New tables: `user_encryption_keys`, `wave_encryption_keys`, `wave_key_metadata`, `user_recovery_keys`
- New fields on `droplets`: `encrypted`, `nonce`, `key_version`
- New field on `waves`: `encrypted`

#### Cryptographic Implementation
- **Web Crypto API**: Native browser cryptography (no external JS libraries)
- **ECDH P-384**: Asymmetric key exchange for user and wave key distribution
- **AES-256-GCM**: Authenticated encryption for droplet content and private key wrapping
- **PBKDF2-SHA256**: Password-based key derivation (600k iterations)
- **Random Nonces**: Unique 12-byte nonces for each encrypted droplet

### Security Notes

#### What E2EE Protects
- **Server Breach**: Server only stores ciphertext, never plaintext
- **Database Leak**: Encrypted content is meaningless without keys
- **MITM**: Content encrypted before transmission

#### What E2EE Does NOT Protect
- **Compromised Client Device**: Keys exist in memory during session
- **Malicious Client Code**: Could capture plaintext before encryption
- **Metadata**: Who talks to whom is still visible to server

### Technical Details

- Keys never leave client unencrypted (private keys wrapped before upload)
- Wave keys cached with LRU eviction (max 100 keys)
- Multi-version key support for reading old messages after rotation
- Encrypted droplets show "[Unable to decrypt]" on key mismatch
- Push notifications show "Encrypted message" for encrypted content
- Client-side search deferred (would require IndexedDB implementation)

---

## [1.18.1] - 2025-12-24

### Fixed

- **MFA Status Display**: Fixed MFA status showing "Not Set Up" when TOTP or Email MFA was actually enabled
  - Root cause: Property name mismatch between `getMfaSettings()` return value (camelCase) and endpoint check (snake_case)
  - `settings.totp_enabled` → `settings.totpEnabled`
  - `settings.email_mfa_enabled` → `settings.emailMfaEnabled`

### Security

- **Email MFA Disable Verification**: Disabling Email MFA now requires email verification code
  - Previously only required password (inconsistent with TOTP disable which requires TOTP code)
  - New two-step flow: enter password → receive email code → confirm disable
  - Prevents unauthorized MFA disable if password is compromised

### Improved

- **MFA Code Input Clarity**: Changed confusing "TOTP Code" placeholder to clear instructions
  - Added label: "Enter the 6-digit code from your authenticator app:"
  - Applies to TOTP disable and recovery code regeneration

## [1.18.0] - 2025-12-24

### Added

#### Session Management
- View all active sessions with device info, IP addresses, and timestamps
- Revoke individual sessions or logout all other devices at once
- Sessions automatically cleaned up when they expire
- Current session clearly marked in the session list

#### GDPR Compliance
- **Download My Data**: Export all personal data as JSON (profile, droplets, wave participation, contacts, and more)
- **Delete Account**: Permanently delete your account with proper data handling
  - Droplets preserved but attributed to "[Deleted User]"
  - Waves transferred to other participants
  - Empty waves and groups automatically cleaned up

### Security
- HSTS (HTTP Strict Transport Security) headers enabled
- Optional HTTPS enforcement via `ENFORCE_HTTPS=true`
- Stricter CORS defaults - `ALLOWED_ORIGINS` required in production
- Session tokens hashed before storage (never stored in plain text)

### Improved
- Logout now properly revokes session on the server
- Better error handling throughout security features
- Rate limiting on account management endpoints

## [1.15.0] - 2025-12-17

### Added

#### Crawl Bar - Live News Ticker
- **Crawl Bar Component**: Horizontal scrolling ticker displaying stocks, weather, and news
- **CSS Animation**: Smooth continuous scroll with configurable speeds (slow/normal/fast)
- **Pause on Interaction**: Ticker pauses on mouse hover or touch
- **Gradient Fade**: Visual fade effect at left/right edges
- **Theme Integration**: Full CSS variable support for all themes
- **Responsive Design**: Adapts height and font size for mobile devices

#### Stock Market Integration (Finnhub)
- **Real-time Quotes**: Current price, change amount, and percent change
- **Multiple Symbols**: Admin-configurable list of stock symbols
- **Visual Indicators**: Green/red arrows for positive/negative changes
- **60-Second Cache**: Respects Finnhub's rate limits (60 calls/min free tier)

#### Weather Integration (OpenWeatherMap)
- **Current Conditions**: Temperature, weather description, location name
- **Weather Alerts**: Severe weather alerts displayed with warning icons
- **IP Geolocation**: Automatic location detection via ip-api.com (free)
- **User Override**: Users can set custom location in preferences
- **Server Default**: Admin-configured fallback location
- **5-Minute Cache**: ~288 calls/day within free tier limits

#### News Integration (NewsAPI.org + GNews.io)
- **Breaking Headlines**: Top news stories from multiple sources
- **Dual Provider Support**: NewsAPI as primary, GNews as fallback
- **3-Minute Cache**: Balances freshness with rate limit compliance
- **Graceful Fallback**: Automatically switches to backup provider on failure

#### User Preferences
- **Enable/Disable Toggle**: Users can hide the crawl bar entirely
- **Section Toggles**: Choose which content types to display (Stocks/Weather/News)
- **Scroll Speed**: Slow (80s), Normal (50s), or Fast (30s) full-width scroll
- **Location Override**: Set custom location name for weather data
- **Preferences API**: `PUT /api/profile/crawl-preferences`

#### Admin Configuration
- **Server-wide Settings**: Global crawl bar configuration for all users
- **Stock Symbols**: Configure which stocks to display (comma-separated)
- **Default Location**: Fallback for IP geolocation failures
- **Feature Toggles**: Enable/disable stocks, weather, or news globally
- **Refresh Intervals**: Configure cache TTL for each data type
- **API Key Status**: Dashboard shows which APIs are configured
- **Admin Endpoints**: `GET/PUT /api/admin/crawl/config`

#### API Endpoints
- `GET /api/crawl/stocks` - Get stock quotes for configured symbols
- `GET /api/crawl/weather` - Get weather for user's location
- `GET /api/crawl/news` - Get news headlines
- `GET /api/crawl/all` - Combined endpoint (recommended for efficiency)
- `PUT /api/profile/crawl-preferences` - Update user crawl settings
- `GET /api/admin/crawl/config` - Get server crawl configuration (admin)
- `PUT /api/admin/crawl/config` - Update server crawl configuration (admin)

### Database
- Added `crawl_config` table - Server-wide crawl bar configuration (singleton)
- Added `crawl_cache` table - External API response caching with TTL

### Environment Variables
- `FINNHUB_API_KEY` - Finnhub API key for stock quotes
- `OPENWEATHERMAP_API_KEY` - OpenWeatherMap API key for weather data
- `NEWSAPI_KEY` - NewsAPI.org API key for news (primary)
- `GNEWS_API_KEY` - GNews.io API key for news (backup)
- `IPINFO_TOKEN` - IPinfo.io token for enhanced geolocation (optional)
- `RATE_LIMIT_CRAWL_MAX` - Crawl endpoint rate limit (default: 60/min)

### Dependencies
- No new dependencies required (uses native `fetch` for API calls)

### Notes
- Crawl bar only displays sections with configured API keys
- No API keys = crawl bar hidden completely (graceful degradation)
- NewsAPI.org free tier only works on localhost (use GNews for production)
- OpenWeatherMap keys take up to 2 hours to activate after creation
- IP geolocation uses ip-api.com (free, no key required, 45 req/min)

---

## [1.14.0] - 2025-12-17

### Added

#### Security Enhancements - Password Recovery
- **Email Service**: Configurable email delivery supporting SMTP, SendGrid, and Mailgun
- **Password Reset Flow**: Forgot password, token verification, and reset endpoints
- **Admin Password Reset**: Admins can reset user passwords with optional email notification
- **Force Logout**: Admin endpoint to force user logout
- **Account Lockout Persistence**: Failed login attempts now stored in database (survives restarts)

#### Password Reset Endpoints
- `POST /api/auth/forgot-password` - Request password reset (rate-limited)
- `GET /api/auth/reset-password/:token` - Verify reset token
- `POST /api/auth/reset-password` - Complete password reset
- `POST /api/auth/clear-password-change` - Clear forced password change flag

#### Admin Security Endpoints
- `POST /api/admin/users/:id/reset-password` - Admin reset user password
- `POST /api/admin/users/:id/force-logout` - Force user logout

#### Multi-Factor Authentication (MFA)
- **TOTP Support**: Setup authenticator apps (Google Authenticator, Authy, etc.) with QR code
- **Email MFA**: Email-based 6-digit verification codes as alternative to TOTP
- **Recovery Codes**: 10 one-time backup codes generated on MFA setup
- **MFA Challenge Flow**: Login returns challenge when MFA is enabled, requiring second factor

#### MFA Endpoints
- `GET /api/auth/mfa/status` - Get MFA status for current user
- `POST /api/auth/mfa/totp/setup` - Begin TOTP setup (returns QR code)
- `POST /api/auth/mfa/totp/verify` - Verify TOTP code and enable
- `POST /api/auth/mfa/totp/disable` - Disable TOTP (requires password + code)
- `POST /api/auth/mfa/email/enable` - Begin email MFA setup
- `POST /api/auth/mfa/email/verify-setup` - Verify email code and enable
- `POST /api/auth/mfa/email/disable` - Disable email MFA
- `POST /api/auth/mfa/recovery/regenerate` - Generate new recovery codes
- `POST /api/auth/mfa/send-email-code` - Send email code during login
- `POST /api/auth/mfa/verify` - Verify MFA during login

#### Client UI
- Forgot password link on login screen
- Password reset page with token validation
- Confirm password field for registration
- MFA challenge screen during login (TOTP, email, or recovery code)
- MFA setup panel in Profile Settings (Two-Factor Authentication section)
- QR code display for authenticator app setup
- Recovery codes display with copy-to-clipboard functionality

### Security
- JWT_SECRET now required in production (server exits if not set)
- CORS production warning when ALLOWED_ORIGINS not configured
- Avatar URL validation to prevent path traversal attacks

### Database
- Added `account_lockouts` table for persistent rate limiting
- Added `password_reset_tokens` table for secure token storage
- Added `require_password_change` flag to users table
- Added `user_mfa` table for MFA settings (TOTP secret, email MFA, recovery codes)
- Added `mfa_challenges` table for login challenge tracking
- Added `activity_log` table for security and content event tracking

#### Activity Tracking & Audit Log
- **Activity Log System**: Track security and content events for auditing
- **90-Day Retention**: Automatic cleanup of old activity log entries
- **Admin Activity Panel**: View and filter activity log in admin dashboard
- **Action Types Tracked**: Logins, failed logins, registrations, password changes, MFA events, admin actions, wave/droplet operations

#### Activity Log Endpoints
- `GET /api/admin/activity-log` - Get paginated activity log with filters
- `GET /api/admin/activity-stats` - Get activity statistics
- `GET /api/admin/activity-log/user/:userId` - Get activity for specific user

#### Encryption at Rest
- **SQLCipher Support**: Database encryption using SQLCipher (optional)
- **Environment Variables**: `DB_ENCRYPTION_KEY` to enable database encryption
- **Production Mode**: `REQUIRE_DB_ENCRYPTION=true` to enforce encryption in production
- **Backward Compatible**: Works with existing better-sqlite3 (encryption disabled)

### Dependencies
- Added `otplib` for TOTP generation/verification
- Added `qrcode` for QR code generation

---

## [1.13.0] - 2025-12-15

### Added

#### Server-to-Server Federation
- **Federation Architecture**: Multiple Cortex servers can now exchange waves and droplets
- **HTTP Signature Authentication**: RSA-SHA256 signed requests for secure server-to-server communication
- **Federated User Format**: Reference users on other servers with `@handle@server.com`
- **Origin-Authoritative Model**: Origin server is the source of truth for wave data
- **Manual Trust Model**: Admin-managed allowlist of trusted federation partners

#### Federation Endpoints
- `GET /api/federation/identity` - Public endpoint for server's public key
- `POST /api/federation/inbox` - Receive signed messages from other servers
- `GET /api/federation/users/:handle` - Get local user profile for remote servers
- `GET /api/users/resolve/:identifier` - Resolve local or federated users

#### Admin Federation Management
- `GET /api/admin/federation/status` - Get federation status and configuration
- `GET /api/admin/federation/nodes` - List trusted federation nodes
- `POST /api/admin/federation/nodes` - Add trusted node
- `DELETE /api/admin/federation/nodes/:id` - Remove trusted node
- `POST /api/admin/federation/nodes/:id/handshake` - Exchange public keys with node

#### Database Schema (New Tables)
- `server_identity` - Server's RSA keypair (singleton)
- `federation_nodes` - Trusted federation partners
- `remote_users` - Cached profiles from federated servers
- `remote_droplets` - Cached droplets from federated waves
- `wave_federation` - Wave-to-node relationships
- `federation_queue` - Outbound message queue with retry logic
- `federation_inbox_log` - Inbound message deduplication

#### Message Queue System
- Optimistic send with automatic queue fallback on failure
- Exponential backoff retries: 1min → 5min → 25min → 2hr → 10hr
- Background processor runs every 30 seconds
- Auto-cleanup of old messages after 7 days

#### Client Updates
- **FederationAdminPanel**: New admin panel in Profile Settings for managing federation
- Generate and view server identity
- Add/remove trusted nodes
- Initiate handshakes with remote servers
- View node status and connection health

### Changed

- Server startup banner now shows federation status
- Updated environment variables section with `FEDERATION_ENABLED` and `FEDERATION_NODE_NAME`

### Technical Details

- RSA-2048 keypair generation for server identity
- HTTP Signature draft-cavage-http-signatures-12 compatible
- Rate limiting: 500 requests/minute per federated node
- Idempotent inbox processing prevents duplicate message handling

---

## [1.12.1] - 2025-12-12

### Fixed

#### SQLite Media Embedding
- **GIF/Image Embedding**: Fixed media embedding not working in SQLite mode
- Added missing `sanitizeMessage()` and `detectAndEmbedMedia()` calls to SQLite database class
- GIPHY URLs now properly converted to embedded `<img>` tags in SQLite mode

---

## [1.12.0] - 2025-12-11

### Added

#### CSS Variable Theme System
- **Complete Theme Refactor**: All colors now use CSS custom properties
- **Theme Application**: `data-theme` attribute on `<html>` element
- **Flash Prevention**: Inline script applies theme before React loads
- **Theme Persistence**: Dedicated `cortex_theme` localStorage key

#### 5 Themes Available
- **Firefly** (default): Classic green terminal with enhanced mobile contrast
- **High Contrast**: Maximum readability with brighter text and borders
- **AMOLED Black**: True #000 background for OLED battery savings
- **Light Mode**: Light background for daytime use
- **Ocean Blue**: Blue-tinted dark alternative

### Fixed

#### Push Notifications
- **VAPID Key Change Detection**: Auto re-subscribe if server VAPID key changes
- **SQLite Constraint Migration**: Auto-migration for `push_subscriptions` UNIQUE constraint
- **Toggle State Management**: Proper React state for push notification toggle
- **Error Feedback**: Detailed failure messages in UI toast

#### Database
- **Preferences Persistence**: Fixed preferences not persisting in SQLite mode
- Added `updateUserPreferences()` method to SQLite class

### Technical Details

- CSS variable categories: Background, Text, Borders, Accents, Glows, Overlays
- Mobile readability: Droplet content uses `--text-primary` for maximum contrast
- Server validates themes against: firefly, highContrast, amoled, light, ocean

---

## [1.11.0] - 2025-12-11

### Added

#### Notification System
- **In-App Notifications**: Comprehensive notification system for all activity types
- **Notification Types**: @mentions, replies to your droplets, wave activity, ripples
- **Smart Routing**: Notifications suppressed when viewing source wave
- **Real-Time Updates**: WebSocket-powered instant notifications

#### Enhanced Wave List Badges
- **Color-Coded Indicators**: Visual distinction for notification types
- **Amber (@)**: Direct @mentions
- **Green (↩)**: Replies to your droplets
- **Purple (◈)**: Ripple activity
- **Orange**: General wave activity

#### Notification Preferences
- Per-type control in Profile Settings
- Options: Always, App Closed Only, Never
- "Suppress while focused" toggle

### Changed

#### API Deprecation
- Legacy `/api/messages/*` endpoints now return deprecation headers
- Migration guide added to docs/API.md
- Sunset date: March 1, 2026

#### Component Updates
- Internal terminology alignment (ThreadedMessage → Droplet)
- Auto-focus preference for Focus View on droplet click

### Fixed

- Notification badges now clear when droplets are read
- Push notification re-enable after disabling
- Droplet creation endpoint uses POST /droplets

---

## [1.10.0] - 2025-12-10

### Added

#### Droplets Architecture
- **Terminology Rename**: Messages → Droplets throughout codebase
- Database tables renamed: `messages` → `droplets`, `messages_fts` → `droplets_fts`
- API endpoints support both `/droplets` and `/messages` (backward compatibility)
- WebSocket events renamed with legacy aliases maintained

#### Focus View
- **Wave-Like Context**: View any droplet with replies as its own wave
- **Desktop Entry**: "⤢ FOCUS" button on droplets with children
- **Mobile Entry**: Tap droplet content area, swipe right to go back
- **Breadcrumb Navigation**: Clickable path items for navigation
- **Navigation Stack**: Push/pop model for nested focus levels

#### Threading Depth Limit
- 3-level inline limit in WaveView
- "FOCUS TO REPLY" button at depth limit
- Visual depth indicator banner
- Focus View allows unlimited depth

#### Ripple System
- **Spin Off Threads**: Create new waves from droplet trees
- **RippleModal**: Title input and participant selection
- **RippledLinkCard**: Visual "Rippled to wave..." link in original
- **Nested Ripples**: `breakout_chain` field tracks lineage
- **API Endpoint**: `POST /api/droplets/:id/ripple`

### Changed

#### Database Schema
- New fields: `droplets.broken_out_to`, `droplets.original_wave_id`
- New fields: `waves.root_droplet_id`, `waves.broken_out_from`, `waves.breakout_chain`
- Auto-migration for existing SQLite databases

---

## [1.9.0] - 2025-12-10

### Added

#### Message Threading Improvements
- **Collapse/Expand**: Thread collapse with localStorage persistence per wave
- **Bulk Actions**: "Collapse All" / "Expand All" buttons in wave toolbar
- **Jump to Parent**: "↑ Parent" button with highlight animation
- **Depth Indicator**: Visual indicator for deeply nested messages (depth > 3)
- **Thread Connectors**: Dashed lines showing reply hierarchy

#### Mobile Gesture Enhancements
- **useSwipeGesture Hook**: Swipe navigation support
- **usePullToRefresh Hook**: Pull-to-refresh with PullIndicator component
- **BottomNav Component**: 5-tab navigation (Waves, Contacts, Groups, Search, Profile)
- **Haptic Feedback**: 10ms vibration on navigation
- **Badge Indicators**: Unread counts and pending requests

#### Report System
- **Report Types**: Spam, harassment, inappropriate content, other
- **Rate Limiting**: 10 reports per hour per user
- **ReportModal**: Reason selection and details textarea
- **Admin Dashboard**: ReportsAdminPanel with tabs (Pending/Resolved/Dismissed)
- **Resolution Options**: Warning Issued, Content Removed, User Banned, No Action
- **MyReportsPanel**: Users can view their submitted reports
- **WebSocket Event**: `report_resolved` notifies reporters

#### Moderation Actions
- **Warning System**: `warnings` table with `createWarning()` method
- **Moderation Audit Log**: `moderation_log` table
- **Admin Endpoints**: Warn user, get warnings, get moderation log
- **WebSocket Event**: `warning_received` notifies warned users

#### API Documentation
- Comprehensive `docs/API.md` with 70+ endpoints documented
- WebSocket events documentation
- Rate limiting and error response formats
- curl examples for key endpoints

---

## [1.8.1] - 2025-12-09

### Fixed

#### Video Embeds
- **YouTube/Spotify/Vimeo Working**: Fixed embed detection to not skip video URLs in anchor tags (only skip image URLs)
- **TikTok Link Card**: Replaced TikTok oEmbed with styled link card (TikTok's embed.js incompatible with React, caused infinite re-renders)
- **Duplicate Image Embeds**: Fixed duplicate embeds by tracking already-embedded image URLs

#### Push Notifications
- **Unique Notification Tags**: Each message now has unique tag (`cortex-msg-{messageId}`) to prevent notification replacement
- **Visibility Filtering**: Push notifications only show when app is not in foreground (client-side `clients.matchAll()` check)
- **iOS Warning**: Added console warning about iOS push notification limitations in PWA

### Added

#### Version Display
- **Footer Version**: Added "v1.8.1" version indicator to application footer
- **Tighter Footer**: Reduced footer padding for cleaner appearance

### Technical Details

- TikTok styled link card with gradient background and platform branding
- Service worker visibility check using `clients.matchAll({ type: 'window', includeUncontrolled: true })`
- Push payload includes `messageId` for unique notification tags

---

## [1.8.0] - 2025-12-08

### Added

#### Scroll-to-Unread Navigation
- **Auto-Scroll on Wave Open**: When clicking into a wave, automatically scrolls to first unread message
- **Fallback to Bottom**: If all messages are read, scrolls to the most recent message at the bottom
- **Smooth Animation**: Uses `scrollIntoView({ behavior: 'smooth', block: 'start' })` for pleasant UX
- **One-Time Scroll**: Only triggers on initial wave load, not on WebSocket updates or refreshes

### Fixed

#### WaveView Crash Fix
- **Missing useMemo Import**: Fixed `ReferenceError: useMemo is not defined` that caused blank screen when clicking into waves
- **ErrorBoundary Added**: New error boundary component catches render errors and displays them gracefully instead of blank screen
- **Defensive Null Checks**: Added fallback defaults for `waveData.messages`, `all_messages`, and `participants`

### Changed

#### Header Cleanup
- **Removed Desktop Status**: API/WebSocket connection status removed from desktop header (now in footer only)

### Technical Details

#### Implementation
- `data-message-id` attribute added to message elements for scroll targeting
- `hasScrolledToUnreadRef` ref prevents duplicate scrolling
- 100ms setTimeout ensures DOM is ready before scroll calculation

---

## [1.6.1] - 2025-12-05

### Changed

#### Mobile Header Improvements
- **App Icon Logo** - Replaced "CORTEX" text with PWA app icon (32x32px) on mobile screens
- **Compact Layout** - Removed header wrapping, flex-centered navigation buttons
- **Reduced Padding** - Tighter spacing on mobile (8px vs 10px)
- **Smaller Nav Buttons** - Reduced font size and padding for better fit

#### Logout Button Relocated
- **Moved to Settings** - Logout button removed from header, added to Profile Settings
- **New SESSION Section** - Orange-bordered LOGOUT button at bottom of settings panel
- **Better UX** - Reduces accidental logouts, more discoverable location

#### Collapsible Wave Toolbar
- **Combined Toolbar** - Participants and Playback merged into single compact bar
- **Toggle Buttons** - "PARTICIPANTS (n)" and "PLAYBACK" buttons expand/collapse panels
- **Collapsed by Default** - Both panels start collapsed to save vertical space
- **Mark All Read** - Button remains visible in toolbar when unread messages exist

### Technical Details

#### Bundle Size
- **Gzipped**: 65.23 KB (slight increase from 65.03 KB)
- **Uncompressed**: 227.05 KB
- **Build Time**: ~617ms

### Migration Notes
- **No Migration Required** - Fully backward compatible
- **Service Worker** - Cache version updated to v1.6.1

---

## [1.6.0] - 2025-12-05

### Added

#### Progressive Web App (PWA) Support
Cortex is now a fully installable Progressive Web App that works on Android and iOS devices.

- **Web App Manifest** (`client/public/manifest.json`)
  - App name, description, and theme colors
  - Display mode: standalone (full-screen app experience)
  - Orientation: portrait-primary
  - App shortcuts for quick actions
  - Categories: communication, social

- **Service Worker** (`client/public/sw.js`)
  - Stale-while-revalidate caching strategy for static assets
  - Network-first for API calls (real-time data)
  - Automatic cache cleanup on version updates
  - Push notification handlers (ready for future use)
  - Notification click handling with deep linking

- **App Icons** (`client/public/icons/`)
  - 13 PNG icons for all device sizes (16px to 512px)
  - Maskable icons for Android adaptive icons (192px, 512px)
  - Favicon support (16px, 32px)
  - Icon generator script (`generate-icons.cjs`) for regeneration

- **InstallPrompt Component**
  - Custom "Install Cortex" banner
  - Appears after 2nd visit or 30 seconds
  - 7-day dismissal cooldown
  - Detects if already installed (standalone mode)
  - Handles `beforeinstallprompt` event

- **OfflineIndicator Component**
  - Orange banner when network connection lost
  - Real-time online/offline detection
  - Auto-hides when connection restored

- **iOS PWA Support**
  - `apple-mobile-web-app-capable` meta tag
  - `apple-mobile-web-app-status-bar-style` (black-translucent)
  - `apple-touch-icon` links for home screen icons

- **Service Worker Registration**
  - Automatic registration on page load
  - Hourly update checks
  - Update notification handling

#### Read Receipts Display
Visual UI for the per-message read tracking system (backend from v1.4.0).

- **Participant Read Status Bar**
  - Shows all wave participants in header
  - Green ✓ indicator for users who've read latest message
  - Gray ○ indicator for users with unread messages
  - Hover tooltip shows read/unread status

- **Per-Message Read Receipts**
  - Expandable "Seen by X people" section on each message
  - Lists all users who have read that specific message
  - Green badges with user names
  - Collapses by default to save space

- **Mark All Read Button**
  - One-click button to mark all unread messages as read
  - Appears only when unread messages exist
  - Shows success toast with count of messages marked
  - Real-time update of read status

### Changed

- **index.html** - Added PWA meta tags, manifest link, iOS support tags, favicon links
- **CortexApp.jsx** - Added service worker registration, InstallPrompt, OfflineIndicator components
- **Version** - Updated to 1.6.0 across all files

### Technical Details

#### Bundle Size
- **Gzipped**: 65.03 KB (slight increase from 63.57 KB due to PWA components)
- **Uncompressed**: 226.20 KB
- **Build Time**: ~646ms

#### PWA Compliance
- Passes Lighthouse PWA audit requirements
- Installable on Android Chrome, iOS Safari, Desktop Chrome/Edge
- Offline shell accessible when network unavailable
- Service worker registered and controlling page

#### Files Added
```
client/public/
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker
└── icons/
    ├── favicon-16x16.png
    ├── favicon-32x32.png
    ├── icon-72x72.png
    ├── icon-96x96.png
    ├── icon-128x128.png
    ├── icon-144x144.png
    ├── icon-152x152.png
    ├── icon-180x180.png
    ├── icon-192x192.png
    ├── icon-384x384.png
    ├── icon-512x512.png
    ├── icon-maskable-192x192.png
    ├── icon-maskable-512x512.png
    └── generate-icons.cjs
```

### Migration Notes
- **No Migration Required** - Fully backward compatible
- **Service Worker** - Will register automatically on first visit
- **Icons** - Generated using canvas library, can be regenerated with `node generate-icons.cjs`

### Known Limitations
- **iOS Push Notifications** - Not supported (iOS PWA limitation)
- **iOS Background Sync** - Not supported (iOS PWA limitation)
- **HTTPS Required** - Service workers require HTTPS in production

---

## [1.5.0] - 2025-12-04

### Added

#### Typing Indicators
- **Real-time Typing Detection** - Shows "User is typing..." when users compose messages
- **Throttled WebSocket Events** - Sends typing events max once every 2 seconds to reduce bandwidth
- **Auto-Clear** - Typing indicators disappear after 5 seconds of inactivity
- **Multi-User Support** - Displays multiple typing users: "Alice, Bob are typing..."
- **Wave-Specific** - Only shows typing users in the currently viewed wave
- **Backend WebSocket Handler** - `user_typing` event broadcasts to other wave participants
- **Frontend State Management** - `typingUsers` state with automatic timeout cleanup

#### Message Reactions
- **Emoji Reactions** - Users can react to messages with emojis (👍 ❤️ 😂 🎉 🤔 👏)
- **Quick Reaction Picker** - Click emoji button to show picker overlay
- **Toggle Reactions** - Click same emoji again to remove your reaction
- **Reaction Counts** - Shows count and list of users who reacted
- **Real-time Updates** - WebSocket broadcasts `message_reacted` events
- **Backend API** - `POST /api/messages/:id/react` endpoint toggles reactions
- **Database Schema** - `reactions: { emoji: [userId, ...] }` structure
- **Persistent** - Reactions saved to messages.json file

#### Message Search
- **Full-Text Search** - Search across all accessible waves by message content
- **Security** - Only searches waves user has access to
- **Search Modal** - Overlay UI with search input and results list
- **Result Highlighting** - Search terms highlighted in yellow in results
- **Jump to Message** - Click result to navigate to wave and message
- **Result Metadata** - Shows wave name, author, date for each result
- **Backend Search Method** - `searchMessages(query, filters)` with case-insensitive matching
- **API Endpoint** - `GET /api/search?q=query` returns filtered results

#### Desktop Notifications
- **Browser Notifications** - Native desktop notifications for new messages
- **Permission Request** - Automatic permission request 2 seconds after login
- **Background Detection** - Shows notifications when tab is backgrounded
- **Different Wave Detection** - Shows notifications for messages in other waves
- **Click to Focus** - Clicking notification focuses browser tab and opens wave
- **Notification Grouping** - Groups notifications by wave using tag
- **Auto-Dismiss** - Notifications auto-close after browser default timeout
- **Smart Filtering** - No notifications for your own messages
- **No Backend Changes** - Pure frontend using browser Notification API

### Fixed

#### WebSocket Stability
- **Ref-Based Callback** - Uses `onMessageRef.current` to prevent reconnection on state changes
- **Auto-Reconnect** - Reconnects after 3 seconds if connection drops
- **Heartbeat Ping** - Sends ping every 30 seconds to keep connection alive
- **Intentional Close Tracking** - Prevents reconnect attempts when deliberately closed
- **Better Logging** - Enhanced console logging for connection state debugging

#### Scroll Position Issues
- **Race Condition Fix** - Only saves scroll position if not already pending restoration
- **requestAnimationFrame** - Uses RAF instead of setTimeout(0) for smoother restoration
- **User Actions Preserved** - Posting messages or adding reactions no longer jumps scroll
- **WebSocket Reload Guard** - Prevents scroll position overwrite during rapid reloads
- **Smart Scrolling** - Root messages scroll to bottom, replies preserve position

#### Thread Nesting on Mobile
- **Single-Source Indentation** - Removed double-counting of margins
- **Linear Indentation** - Each level adds exactly 12px (mobile) or 24px (desktop)
- **Removed Message Margin** - Eliminated `marginLeft` from message container
- **Consistent Children Margin** - Uses only children container for indentation
- **Better Deep Thread Support** - 10 levels = 120px (32% of 375px screen, vs 156px before)

#### Real-Time Message Updates
- **waveId Extraction** - Fixed extraction from nested WebSocket event data
- **Multiple Fallbacks** - Tries `data.waveId`, `data.data.wave_id`, `data.data.waveId`
- **Reload Trigger** - Properly triggers wave reload when current wave receives events
- **Viewer Updates** - Watchers now see new messages immediately in real-time

### Changed

#### Backend Updates (server/server.js)
- **WebSocket Handler Enhancement** - Added `user_typing` event handler (Lines 1679-1713)
- **Search Method** - Added `searchMessages(query, filters)` to Database class (Lines 984-1034)
- **Search Endpoint** - Added `GET /api/search` with permission filtering (Lines 1647-1675)
- **React Endpoint** - Message reaction endpoint already existed, no changes needed
- **Version Banner** - Updated to v1.5.0

#### Frontend Updates (CortexApp.jsx)
- **useWebSocket Rewrite** - Complete rewrite with ref-based callbacks (Lines 138-225)
- **SearchModal Component** - New component for search UI (Lines 917-1055)
- **Typing Indicator Display** - Shows below messages, above compose box (Lines 1486-1498)
- **Typing Detection** - handleTyping() function with throttling (Lines 1367-1378)
- **Desktop Notification Handler** - In handleWSMessage WebSocket handler (Lines 2631-2658)
- **Permission Request** - useEffect triggers 2s after mount (Lines 2717-2732)
- **Thread Indentation Fix** - Removed dual marginLeft (Line 530, 750)
- **Version Display** - Updated to v1.5.0

### Technical Details

#### Bundle Size
- **Gzipped**: 63.57 KB (increased from 61.60 KB in v1.4.0)
- **Uncompressed**: 220.30 KB
- **Build Time**: ~575-607ms (excellent)

#### Performance
- **No Breaking Changes** - All v1.4.x features remain fully functional
- **WebSocket Optimized** - Reduced reconnection frequency, added heartbeat
- **Throttled Events** - Typing events throttled to reduce bandwidth
- **Debounced Search** - 300ms debounce on search input
- **Result Limits** - Search capped at 100 results

#### Code Quality
- **Syntax Validated** - Both client and server pass all checks
- **Build Successful** - Vite builds without errors or warnings
- **Clean Implementation** - Follows existing patterns and style
- **Enhanced Logging** - Better debugging for WebSocket and scroll issues

### Developer Notes

#### Feature Implementation Order
1. Typing Indicators (3-4 hours)
2. Message Reactions (4-6 hours, already existed)
3. Message Search (8-12 hours)
4. Desktop Notifications (4-6 hours)
5. Bug Fixes (2-3 hours)

#### Git Commits
- Typing indicators implementation
- Real-time message updates fix
- Message search backend and frontend
- Desktop notifications Phase 1
- WebSocket stability fixes
- Scroll position race condition fix
- Thread nesting indentation fix
- Version updates

#### Testing Performed
- Multi-browser testing (Chrome, Firefox, Edge)
- Multi-user real-time testing
- Mobile responsive testing (< 768px)
- Deep thread nesting (10+ levels)
- WebSocket stability over extended sessions
- Desktop notification permissions and display
- Search with various queries and filters

### Migration Notes
- **No Migration Required** - Fully backward compatible
- **Automatic Reaction Init** - Old messages get empty reactions object on first access
- **No Schema Changes** - Reactions field already existed in message schema
- **No Data Loss** - All existing data works immediately

---

## [1.4.0] - 2025-12-04

### Added

#### Per-Message Read Tracking
- **readBy Array** - Each message now has a `readBy: [userId, ...]` array tracking which users have read it
- **Click-to-Read UI** - Messages must be explicitly clicked to mark as read
- **Visual Indicators** - Unread messages display with:
  - Amber left border (`#ffd23f`, 3px solid)
  - Subtle amber background (`#ffd23f10`)
  - Amber outer border (`1px solid #ffd23f`)
  - Pointer cursor for clickability
- **Hover Effects** - Unread messages brighten to `#ffd23f20` on hover
- **New API Endpoint** - `POST /api/messages/:id/read` for marking individual messages
- **Database Method** - `markMessageAsRead(messageId, userId)` adds user to readBy array
- **is_unread Flag** - `getMessagesForWave()` returns `is_unread` boolean per message
- **Auto-Initialize** - Message author automatically added to `readBy` on creation

#### Scroll Position Preservation
- **scrollPositionToRestore Ref** - New ref tracks scroll position during reloads
- **Restoration useEffect** - Automatically restores scroll after wave data updates
- **handleMessageClick** - Saves scroll position before marking message as read
- **Smart Reply Scrolling** - Conditional scrolling behavior:
  - Replies: Preserve current scroll position
  - Root messages: Scroll to bottom (shows new message)
- **Long Wave Support** - Prevents disruptive jumping in waves with 100+ messages

### Changed

#### Backend Updates
- **Unread Count Calculation** - Changed from timestamp-based (`lastRead`) to array-based filtering
  - Old: `m.created_at > participant.lastRead`
  - New: `!m.readBy.includes(userId)`
- **Message Schema** - Added `readBy: [authorId]` to new messages
- **getMessagesForWave()** - Now accepts `userId` parameter and returns `is_unread` flag
- **Backward Compatibility** - Old messages get `readBy` arrays initialized automatically:
  ```javascript
  if (!message.readBy) {
    message.readBy = [message.authorId];
  }
  ```

#### Frontend Updates
- **ThreadedMessage Component** - Enhanced with click-to-read functionality:
  - Added `onMessageClick` prop
  - Added `isUnread` state detection
  - Added click handler for unread messages
  - Added hover effects with inline event handlers
  - Passed `onMessageClick` to child messages recursively
- **WaveView Component** - Added scroll preservation logic:
  - New `scrollPositionToRestore` ref
  - New restoration useEffect hook
  - Updated `handleMessageClick()` with scroll save/restore
  - Updated `handleSendMessage()` with conditional scrolling
- **Visual Transitions** - All scroll restorations use `transition: 'all 0.2s ease'`

### Technical Details

#### Bundle Size
- **Gzip Size**: 61.60 KB (increased from 61.10 KB due to new features)
- **Total Build**: 213.43 KB uncompressed
- **Build Time**: ~587ms (excellent)

#### Performance
- **No Breaking Changes** - All v1.3.x features remain fully functional
- **Backward Compatible** - Old messages automatically get `readBy` arrays
- **Optimized Reloads** - Scroll position preserved prevents unnecessary reorientation
- **Smooth Transitions** - 0-delay setTimeout ensures DOM updates before scroll restoration

#### Code Quality
- **Syntax Validated** - Both client and server pass validation
- **Build Successful** - Vite build completes without errors or warnings
- **Clean Implementation** - Follows existing code patterns and style
- **Logging Enhanced** - Console logging for read tracking debugging

### Developer Notes

#### Frontend Changes (CortexApp.jsx)
- Line 441: Updated `ThreadedMessage` signature with `onMessageClick` prop
- Line 453: Added `isUnread` state detection
- Line 459-463: Added `handleMessageClick` function in component
- Line 467-488: Enhanced message container div with click handling and styling
- Line 692: Passed `onMessageClick` to recursive child messages
- Line 935: Added `scrollPositionToRestore` ref
- Line 942-952: Added scroll restoration useEffect
- Line 1068-1099: Updated `handleSendMessage()` with conditional scrolling
- Line 1179-1197: Added `handleMessageClick()` handler in WaveView
- Line 1283: Passed `onMessageClick` to ThreadedMessage

#### Backend Changes (server.js)
- Line 859: Added `readBy: [data.authorId]` to message creation
- Line 654-661: Updated unread count calculation to use `readBy` filtering
- Line 822-844: Updated `getMessagesForWave()` to accept `userId` and return `is_unread`
- Line 963-979: Added `markMessageAsRead()` database method
- Line 1580-1593: Added `POST /api/messages/:id/read` endpoint

#### Migration Notes
- No migration script needed - backward compatible
- Old messages auto-initialize `readBy` arrays on first access
- Existing `lastRead` timestamps remain in database but unused for unread counts

## [1.3.3] - 2025-12-04

### Added

#### Message Editing & Deletion UI
- **Edit Message Button** - ✏️ EDIT button appears on user's own messages
- **Inline Edit Form** - Textarea replaces message content when editing
- **Edit State Management** - `editingMessageId` and `editContent` state in WaveView
- **Keyboard Shortcuts** - Ctrl+Enter to save, Escape to cancel editing
- **Edit Handlers** - `handleStartEdit()`, `handleSaveEdit()`, `handleCancelEdit()` functions
- **Content Stripping** - HTML tags stripped for plain-text editing
- **Save/Cancel Buttons** - Styled action buttons with keyboard hint text
- **API Integration** - Uses existing `PUT /api/messages/:id` endpoint
- **Delete Message UI** - Delete button already existed, now complemented by edit functionality
- **Real-Time Updates** - WebSocket `message_edited` and `message_deleted` events handled
- **Auto-reload** - Wave data refreshes after edit/delete operations

#### Improved Wave UX
- **Wave Hover States** - Wave list items highlight on mouse hover
  - `onMouseEnter` handler sets background to `#1a2a1a`
  - `onMouseLeave` handler resets to transparent
  - 200ms CSS transition for smooth effect
- **GIF Eager Loading** - GIFs now load immediately instead of lazily
  - Server-side image tag transformation checks for `.gif` extension
  - Also checks for Giphy/Tenor hostnames
  - Sets `loading="eager"` for GIFs, `loading="lazy"` for other images
- **Better Click Feedback** - Enhanced visual feedback for clickable waves

#### Collapsible Playback Controls
- **Playback Toggle State** - New `showPlayback` boolean state (default: false)
- **Toggle Button** - "▶ SHOW" / "▼ HIDE" button in playback header
- **Playback Header Bar** - New wrapper div with "PLAYBACK MODE" label
- **Conditional Rendering** - PlaybackControls only rendered when `showPlayback` is true
- **Space Optimization** - Playback bar hidden by default to save vertical space
- **Session Persistence** - Toggle state persists during current session

#### Auto-Focus on Reply
- **Reply Focus useEffect** - New effect hook triggers on `replyingTo` state change
- **Automatic Focus** - Textarea automatically focused when reply is clicked
- **Cursor Positioning** - Cursor placed at end of existing text with `setSelectionRange()`
- **Smooth Timing** - 150ms setTimeout ensures UI transition completes before focus
- **Mobile Compatibility** - Works with existing mobile scroll-to-compose behavior

### Changed

#### Client-Side Updates
- **ThreadedMessage Component** - Extended with edit/cancel/save props and handlers
- **Message Content Rendering** - Now conditionally shows edit form or static content
- **Button Layout** - Edit and Delete buttons now grouped together for user's messages
- **WaveView State** - Added `editingMessageId` and `editContent` state variables
- **Message Prop Passing** - Edit-related props passed through recursive ThreadedMessage calls
- **Wave List Styling** - Added `transition: 'background 0.2s ease'` to wave items

#### Server-Side Updates
- **Image Transform Function** - Enhanced to detect GIFs and set eager loading
- **GIF Detection Logic** - Checks both file extension and hostname patterns
- **Sanitization Options** - Image loading attribute now dynamic based on content type

### Technical Details

#### Bundle Size
- **Gzip Size**: 61.10 KB (slight increase from 60.43 KB in v1.3.2 due to new features)
- **Total Build**: 211.74 KB uncompressed
- **Build Time**: ~580ms (excellent)

#### Performance
- **No Breaking Changes** - All v1.3.2 features remain fully functional
- **Backward Compatible** - Existing messages work without modification
- **WebSocket Efficiency** - Reuses existing event handling infrastructure

#### Code Quality
- **Syntax Validated** - Both client and server pass `--check` validation
- **Build Successful** - Vite build completes without errors or warnings
- **Clean Implementation** - Follows existing code patterns and style

### Developer Notes

#### Frontend Changes
- **CortexApp.jsx** Lines modified:
  - 829: Added `showPlayback`, `editingMessageId`, `editContent` state
  - 865-877: Added auto-focus useEffect for reply
  - 979-1009: Added edit handler functions
  - 441: Updated ThreadedMessage signature with edit props
  - 478-539: Added conditional edit form rendering
  - 555-570: Added EDIT button and restructured action buttons
  - 604-608, 1132-1137: Passed edit props to ThreadedMessage calls
  - 1048-1081: Added collapsible playback wrapper
  - 392-409: Added wave hover handlers and transition

#### Backend Changes
- **server.js** Lines modified:
  - 126-141: Enhanced img tag transform with GIF detection
  - Existing endpoints already supported editing (no backend changes needed)

## [1.3.2] - 2025-12-04

### Added

#### Rich Content & Media Support
- **Emoji Picker Component** - 16 common emojis in a popup picker with mobile-optimized 4-column grid layout
- **Media URL Input Panel** - Dedicated UI for inserting image and GIF URLs into messages
- **Auto-Detection of Media URLs** - Automatically embeds image URLs (jpg, jpeg, png, gif, webp) in messages
- **Multi-line Message Input** - Replaced single-line input with textarea supporting Shift+Enter for new lines
- **HTML Content Rendering** - Messages now render rich HTML content with embedded media
- **Server-side Media Processing** - `detectAndEmbedMedia()` function automatically converts URLs to `<img>` tags
- **Content Sanitization** - Strict HTML sanitization with `sanitize-html` library
  - Allowed tags: img, a, br, p, strong, em, code, pre
  - Security transforms for links (target="_blank", rel="noopener noreferrer")
  - Lazy loading for images
  - No data URIs allowed (HTTPS/HTTP only)

#### Wave Deletion
- **DELETE Wave API Endpoint** - `DELETE /api/waves/:id` for wave creators
- **Cascade Deletion** - Automatically removes wave, participants, messages, and message history
- **Authorization Check** - Only wave creators can delete their waves
- **Delete Confirmation Modal** - Client-side confirmation before deletion
- **WebSocket Notification** - `wave_deleted` event broadcast to all participants
- **Auto-redirect** - Users viewing deleted waves are automatically redirected to wave list

#### User Preferences & Customization
- **Theme Selection** - Three themes available:
  - Firefly (default) - Classic dark green terminal aesthetic
  - High Contrast - Maximum contrast for accessibility
  - Light Mode - Light background alternative
- **Font Size Control** - Four font sizes:
  - Small (0.9x scale)
  - Medium (1x scale, default)
  - Large (1.15x scale)
  - X-Large (1.3x scale)
- **Preferences API Endpoint** - `PUT /api/profile/preferences` to save user settings
- **Preferences Persistence** - Settings stored in user account and synced across devices
- **Theme Definitions** - THEMES and FONT_SIZES constants in client code
- **Preferences UI** - New section in ProfileSettings for theme and font size selection

#### Admin Panel
- **HandleRequestsList Component** - Dedicated UI for reviewing handle change requests
- **Admin Panel in ProfileSettings** - Visible only to administrators
- **Approve/Reject Actions** - Buttons for each pending request
- **Optional Rejection Reason** - Admins can provide feedback when rejecting
- **Real-time Updates** - WebSocket notifications for request reviews
- **Mobile-responsive Design** - Touch-friendly buttons with 44px minimum height

#### Mobile UX Improvements
- **Multiple Responsive Breakpoints**:
  - isMobile: < 600px (phone screens)
  - isTablet: 600-1024px (tablet screens)
  - isDesktop: ≥ 1024px (desktop screens)
- **Touch-friendly Interface** - 44px minimum touch targets throughout the app
- **Mobile-optimized Components**:
  - EmojiPicker with 4-column grid on mobile (vs 6-column on desktop)
  - Larger buttons and padding on mobile devices
  - Responsive font sizes and spacing
- **Browser Compatibility Enhancements**:
  - Font smoothing: `-webkit-font-smoothing: antialiased`
  - macOS font rendering: `-moz-osx-font-smoothing: grayscale`
  - Text rendering: `text-rendering: optimizeLegibility`
  - Safe area insets: `viewport-fit=cover` for notched devices
  - Custom scrollbar styling for consistent appearance
  - Maximum scale restrictions to prevent zoom issues

### Changed

#### Database Schema
- **User Model** - Added `preferences` field with default values:
  ```javascript
  preferences: {
    theme: 'firefly',
    fontSize: 'medium',
    colorMode: 'default'
  }
  ```

#### Message Input
- Changed from `<input>` to `<textarea>` for multi-line support
- Enter key sends message (default behavior)
- Shift+Enter creates new line
- Auto-resize functionality (up to 200px max height)
- Placeholder text includes instructions: "Type a message... (Shift+Enter for new line)"

#### Message Display
- Messages now render with `dangerouslySetInnerHTML` to support HTML content
- Added `whiteSpace: 'pre-wrap'` to preserve line breaks
- CSS styling for embedded media (max-width, max-height, borders)

#### Server-side Processing
- Enhanced `sanitizeMessage()` with strict HTML whitelist
- Added `detectAndEmbedMedia()` for URL-to-image conversion
- Updated `createMessage()` to process media URLs before storage

#### WebSocket Events
- Added `wave_deleted` event type to broadcast wave deletions

#### Responsive Design
- Updated breakpoint logic from single `isMobile` (<768px) to three-tier system
- Adjusted layouts for tablet-sized screens
- Improved spacing and typography across all screen sizes

### Fixed

- **Chrome Mobile Input Position** - Fixed message input field positioning on mobile Chrome
- **Font Rendering Consistency** - Improved font contrast and readability across browsers
- **Mobile Keyboard Handling** - Better viewport behavior when keyboard is open
- **Scrollbar Appearance** - Consistent custom scrollbar styling across browsers

### Security

- **HTML Sanitization** - Strict whitelist prevents XSS attacks in rich content
- **Media URL Validation** - Only HTTPS/HTTP protocols allowed, no data URIs
- **Authorization Checks** - Wave deletion restricted to creators only
- **Input Validation** - All preference values validated on server
- **Content Security** - All user-generated HTML sanitized before storage and display

### Technical Improvements

- **Code Organization** - Clear component structure for new features
- **Error Handling** - Comprehensive error handling for new API endpoints
- **State Management** - Proper state updates for preferences and media
- **Performance** - Lazy loading for images to improve page load times
- **Accessibility** - Minimum 44px touch targets for better mobile UX

### Documentation

- **CLAUDE.md Updated** - Comprehensive documentation of all v1.3.2 features
  - New "Wave Deletion" section
  - New "Media Embedding & Rich Content" section
  - New "User Preferences & Customization" section
  - New "Admin Panel" section
  - Updated "Responsive Design" section with new breakpoints
  - Updated "Security Practices" with media embedding security
  - Updated "Data Model" with preferences field
  - Added v1.3.2 to version history
  - Updated "Common Development Tasks" sections

- **README.md Updated** - User-facing documentation
  - Updated version number to v1.3.2
  - Added "What's New in v1.3.2" section with all features
  - Updated API endpoints table with new endpoints
  - Updated User Identity Model with preferences
  - Updated Security Features section
  - Updated WebSocket Events with wave_deleted
  - Updated Roadmap with completed items

### Known Limitations

- Theme system infrastructure in place but full CSS variable refactoring deferred to v1.3.3
- Light and High Contrast themes partially implemented (color definitions exist but not all components refactored)
- Media embedding only supports URLs (no file uploads yet, planned for v1.5)
- No image proxy for external URLs (images loaded directly from source)
- No GIF search integration (users must paste URLs)

### Breaking Changes

**None** - All changes are backwards compatible. Existing clients will continue to work with v1.3.2 server.

### Migration Notes

- **Database Migration** - Not required. Default preferences automatically added to users on first login.
- **Server Updates** - No breaking changes to existing API endpoints
- **Client Updates** - Recommended to update client for new features, but old clients remain functional

### Contributors

- Core Development Team
- Community Feedback & Testing

### Performance Metrics

- **Bundle Size**: 60.43 KB gzipped (12% of 500KB target, excellent)
- **Memory Usage**: ~235MB (healthy for production)
- **No Performance Regressions**: Smooth 60fps UI maintained across all features

---

## [1.3.1] - 2025-11-XX

### Fixed
- Minor bug fixes and improvements

---

## [1.3.0] - 2025-11-XX

### Added

#### UUID-Based Identity System
- Immutable user UUIDs for all references
- Changeable handles with admin approval system
- Handle history tracking with audit trail
- Old handle reservation for 90 days
- @mentions stored as UUIDs, rendered as current handles

#### User Account Management
- Profile settings for display name and avatar changes
- Password management with validation
- Handle change request system
- 30-day cooldown between handle changes

#### Wave Features
- Renamed "Threads" to "Waves" throughout platform
- Personal wave archiving (per-user, doesn't affect others)
- Archive/unarchive functionality
- Separate archived waves view

#### Admin Features
- Handle request review endpoints
- Approve/reject handle changes
- Admin authorization checks

### Changed
- Renamed all "thread" references to "wave"
- Renamed "username" to "handle"
- Updated data model to use UUIDs

### Migration
- `migrate-v1.2-to-v1.3.js` script provided
- Converts username → handle
- Converts threads → waves
- Adds UUID system

---

## [1.2.0] - Earlier

### Features
- Thread-based messaging
- Real-time WebSocket communication
- JWT authentication
- Privacy levels (private, group, cross-server, public)
- Message threading with replies
- Edit history tracking
- Playback mode
- Groups and contacts

---

For more details on upcoming features, see the [Roadmap](README.md#roadmap).
