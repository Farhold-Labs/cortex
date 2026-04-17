# Cortex Native Distribution Plan — Electron + Capacitor

**Date:** 2026-02-20
**Version:** v2.30.0 baseline
**Status:** Planning complete, awaiting Phase 1 implementation

---

## Table of Contents

- [Codebase Audit Summary](#codebase-audit-summary)
- [Phase 1: Pre-Integration Prep](#phase-1-pre-integration-prep-no-new-dependencies)
- [Phase 2: Electron Integration](#phase-2-electron-integration)
- [Phase 3: Capacitor Integration](#phase-3-capacitor-integration)
- [Phase 4: Final Project Structure](#phase-4-final-project-structure)
- [Phase 5: Package.json Script Changes](#phase-5-packagejson-script-changes)
- [Risks & Blockers](#risks--blockers)
- [Implementation Order](#recommended-implementation-order)

---

## Codebase Audit Summary

### Routing

- **History-based** (`pushState`/`popstate`) with no router library — custom routing in `AppContent.jsx`
- No hash-based routing anywhere
- **No change needed for Capacitor** (WebView handles pushState natively)
- **Electron needs consideration**: if loading via `file://`, pushState won't work — must use a local HTTP server or `electron-serve` to serve from `localhost`

### Browser APIs Requiring Native Equivalents

| API | Files | Electron | Capacitor |
|-----|-------|----------|-----------|
| **Service Worker / Push** | `pwa.js`, `CortexApp.jsx`, `sw.js` | Not supported — skip SW registration, use Electron notifications | `@capacitor/push-notifications` |
| **Camera / getUserMedia** | `CameraCapture.jsx`, `MediaRecorder.jsx` | Works natively in Chromium | `@capacitor/camera` for photos; WebView getUserMedia works for video/audio |
| **Clipboard** | 7 files | Works natively | `@capacitor/clipboard` (or WebView API works in modern Capacitor) |
| **Web Share** | `WaveView.jsx`, `FocusView.jsx` | Not available — already has clipboard fallback | `@capacitor/share` |
| **Vibration** | `BottomNav.jsx` | Not available — harmless no-op | `@capacitor/haptics` |
| **Online/Offline** | `useNetworkStatus.js` | Works natively | `@capacitor/network` |
| **IndexedDB** | `waveCache.js` | Works natively | Works natively in WebView |
| **Web Crypto** | `crypto.js`, `e2ee-context.jsx` | Works natively | Works natively |
| **WebSocket** | `useWebSocket.js` | Works natively | Works natively |
| **localStorage** | `storage.js` + many | Works natively | Works natively in WebView |

**Key finding**: Most APIs work as-is in both Electron (Chromium) and Capacitor (modern WebView). The only **critical** gap is Service Worker/Push — which needs platform-specific notification code.

### Auth Flow

- JWT-based only, no OAuth/OIDC — no redirect callbacks or deep link auth needed
- Token stored in `localStorage` as `farhold_token`, sent as `Authorization: Bearer` header
- Server URL already configurable via `localStorage('farhold_server_url')` with native app detection (`isNativeApp` in `constants.js`)
- **No auth flow changes needed** — the v2.30.0 server select feature already handles the native app case

### CORS

- Server allows requests with **no `Origin` header** (line 4411, 4420 in `server.js`) — Electron `file://` and Capacitor `capacitor://` will both pass
- `ALLOWED_ORIGINS` only checked when an `Origin` header is present
- **No server CORS changes needed** for Electron; Capacitor may send `capacitor://localhost` as origin — add to `ALLOWED_ORIGINS` or rely on the no-origin bypass

### Build Output

- Vite produces `dist/` with **absolute paths** (`/assets/`, `/icons/`)
- Electron: must serve via local HTTP server (not `file://`) or set Vite `base: './'` for a relative-path build
- Capacitor: copies `dist/` into native project WebView assets — absolute paths work because it serves from root of its embedded server

### Problematic `window.location.origin` References

| File | Line | Usage | Fix Needed |
|------|------|-------|------------|
| `CallModal.jsx` | 220 | Pop-out call window URL | Use `BASE_URL` instead |
| `AppContent.jsx` | 52 | Clear cache redirect | Use `window.location.reload()` instead |
| `BotDetailsModal.jsx` | 155 | Display webhook URL | Use `BASE_URL` (display only) |
| `GroupsView.jsx` | 3773 | Display webhook URL | Use `BASE_URL` (display only) |

---

## Phase 1: Pre-Integration Prep (No New Dependencies)

**Goal**: Fix remaining `window.location.origin` references and guard Service Worker registration so the codebase is native-ready before adding Electron/Capacitor.

### 1.1 Fix remaining `window.location.origin` references

- `CallModal.jsx:220` — replace `window.location.origin + window.location.pathname` with `BASE_URL` (import from constants)
- `AppContent.jsx:52` — replace `window.location.href = window.location.origin + window.location.pathname` with `window.location.reload()` (the clear param is already removed by this point)
- `BotDetailsModal.jsx:155` and `GroupsView.jsx:3773` — replace display-only `window.location.origin` with `BASE_URL`

### 1.2 Guard Service Worker registration for native apps

In `CortexApp.jsx` (line 44-71), wrap the SW registration block:
```js
if ('serviceWorker' in navigator && !window.Capacitor && !navigator.userAgent.includes('Electron')) {
  navigator.serviceWorker.register('/sw.js');
}
```
Same guard in `pwa.js` functions that call `navigator.serviceWorker.*`.

### 1.3 Guard pop-out call windows for mobile

In `CallModal.jsx`, hide the pop-out button when `isNativeApp && isMobile` (Capacitor on phones can't open OS-level popup windows).

### 1.4 Add `base` option to Vite config for Electron builds

Add a conditional Vite config that supports both absolute (web) and relative (Electron) base paths:
```js
// vite.config.js
export default defineConfig({
  base: process.env.ELECTRON_BUILD ? './' : '/',
  // ...existing config
});
```

---

## Phase 2: Electron Integration

### 2.1 Dependencies

```
electron@^35              # Electron runtime
electron-builder@^26      # Build & packaging
electron-serve@^2         # Serve static files in production
electron-updater@^6       # Auto-update support
```

All installed in `client/` as `devDependencies` (Electron is a dev/build tool, not shipped in the web bundle).

### 2.2 Project Structure

```
client/
├── electron/
│   ├── main.js           # Main process entry
│   ├── preload.js        # Preload script (context bridge)
│   └── icon.png          # App icon (1024x1024)
├── electron-builder.yml  # Build/packaging config
├── dist/                 # Vite build output (loaded by Electron)
├── src/                  # Existing React source
├── vite.config.js        # Existing (with base:./ for Electron)
└── package.json          # Existing (add electron scripts)
```

### 2.3 Main Process (`client/electron/main.js`)

Minimal main process responsibilities:
- Create `BrowserWindow` loading `dist/index.html` (via `electron-serve` in production, `localhost:3000` in dev)
- Window state persistence (size/position saved to `electron-store` or a JSON file)
- Register `cortex://` deep link protocol (for future use — not needed for current JWT auth)
- Auto-updater hooks (check on launch, notify user of updates)
- Native notification forwarding (receive from renderer via IPC, show via Electron `Notification` API)
- **No local server** — the React app talks directly to remote APIs

Key design points:
- `nodeIntegration: false`, `contextIsolation: true` (security best practice)
- Preload script exposes only: `platform` identifier, `showNotification()`, `getAppVersion()`, `onDeepLink()`
- `webSecurity: true` — do NOT disable (CORS is already handled server-side)

### 2.4 Preload Script (`client/electron/preload.js`)

```js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onDeepLink: (callback) => ipcRenderer.on('deep-link', (_, url) => callback(url)),
});
```

The React app detects Electron via `window.navigator.userAgent.includes('Electron')` (already in `constants.js`) — no code changes needed for detection.

### 2.5 Build & Packaging (`client/electron-builder.yml`)

```yaml
appId: com.farhold.cortex
productName: Cortex
directories:
  output: electron-dist
  buildResources: electron
files:
  - dist/**/*
  - electron/**/*
  - package.json

mac:
  category: public.app-category.social-networking
  target:
    - target: dmg
      arch: [universal]
  icon: electron/icon.png
  hardenedRuntime: true

win:
  target:
    - target: nsis
      arch: [x64, arm64]
  icon: electron/icon.png

linux:
  target:
    - target: AppImage
      arch: [x64, arm64]
    - target: deb
      arch: [x64]
  category: Network
  icon: electron/icon.png

publish:
  provider: github
  owner: Farhold-Labs
  repo: cortex
```

### 2.6 How the React Build is Served

**Production**: `electron-serve` creates a local protocol handler that serves `dist/` files. The `BrowserWindow` loads `serve://dist/index.html`. All asset paths work because they're relative (with `base: './'`).

**Development**: `BrowserWindow` loads `http://localhost:3000` (Vite dev server). Hot reload works normally.

### 2.7 Deep Link Protocol

Register `cortex://` scheme via `app.setAsDefaultProtocolClient('cortex')`. Currently unnecessary (no OAuth), but wired up for future federated identity flows. The main process parses the URL and forwards via IPC to the renderer.

### 2.8 Auto-Updater

Use `electron-updater` with GitHub Releases as the update source. Check on app launch, show a non-intrusive notification when an update is available. User clicks to restart and apply.

---

## Phase 3: Capacitor Integration

### 3.1 Dependencies

```
@capacitor/core@^7                  # Capacitor runtime
@capacitor/cli@^7                   # CLI tools
@capacitor/app@^7                   # App lifecycle, deep links
@capacitor/push-notifications@^7    # Native push
@capacitor/haptics@^7               # Vibration replacement
@capacitor/share@^7                 # Native share dialog
@capacitor/network@^7               # Online/offline detection
@capacitor/status-bar@^7            # Status bar styling
@capacitor/splash-screen@^7         # Launch screen
@capacitor/keyboard@^7              # Keyboard handling
```

Install in `client/` — `@capacitor/core` as a dependency, the rest as dependencies per Capacitor convention.

### 3.2 Capacitor Config (`client/capacitor.config.ts`)

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.farhold.cortex',
  appName: 'Cortex',
  webDir: 'dist',
  server: {
    // No URL — serves from bundled dist/ assets
    // androidScheme: 'https' makes WebView behave like HTTPS context
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,  // Hide manually after React mounts
      backgroundColor: '#050805',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#050805',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
```

**Critical setting**: `androidScheme: 'https'` — makes the WebView treat the local content as a secure context, which is required for Web Crypto API and Service Worker-less localStorage access.

### 3.3 Project Initialization

```bash
cd client
npx cap init Cortex com.farhold.cortex --web-dir dist
npx cap add android
npx cap add ios
```

This creates:
```
client/
├── android/              # Android Studio project
├── ios/                  # Xcode project
├── capacitor.config.ts   # Capacitor config
├── dist/                 # Vite build (synced to native projects)
└── src/                  # Existing React source
```

### 3.4 Plugin Integration

#### Push Notifications

The biggest architectural change. In `pwa.js`, add a Capacitor branch:

```js
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

export async function registerPushNotifications(token) {
  if (Capacitor.isNativePlatform()) {
    // Native push via FCM/APNs
    await PushNotifications.requestPermissions();
    await PushNotifications.register();
    PushNotifications.addListener('registration', ({ value }) => {
      // Send FCM/APNs token to server via POST /api/push/subscribe-native
    });
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      // Handle foreground notification
    });
    return;
  }
  // Existing web push code unchanged
  // ...
}
```

**Server-side addition needed**: A new endpoint `POST /api/push/subscribe-native` that accepts FCM/APNs device tokens (vs the current VAPID web push subscriptions). The server would use `firebase-admin` for Android and a unified service for iOS.

#### Haptics

Replace `navigator.vibrate()` in `BottomNav.jsx`:
```js
import { Capacitor } from '@capacitor/core';
if (Capacitor.isNativePlatform()) {
  const { Haptics } = await import('@capacitor/haptics');
  Haptics.impact({ style: 'light' });
} else if (navigator.vibrate) {
  navigator.vibrate(10);
}
```

#### Share

The existing code already checks `navigator.share` and falls back to clipboard. Capacitor's WebView supports `navigator.share` natively on Android/iOS, so **no changes needed**.

#### Network

The existing `useNetworkStatus.js` uses `navigator.onLine` and `online`/`offline` events, which work in Capacitor's WebView. **No changes needed**.

### 3.5 Deep Links & `appUrlOpen`

Not needed for current JWT auth, but wire up for future use:

```js
import { App } from '@capacitor/app';

App.addListener('appUrlOpen', ({ url }) => {
  // Handle cortex:// deep links
  // e.g., cortex://share/pingId → navigate to shared message
});
```

### 3.6 Build Pipeline

**Android:**
```bash
cd client
npm run build                    # Vite production build
npx cap sync android             # Copy dist/ to Android project
cd android && ./gradlew assembleRelease   # APK
cd android && ./gradlew bundleRelease     # AAB (for Play Store)
```

**iOS:**
```bash
cd client
npm run build
npx cap sync ios
# Open in Xcode:
npx cap open ios
# Archive and export IPA from Xcode
```

### 3.7 iOS-Specific Considerations

- **Safe area insets**: Already handled — `index.html` has `viewport-fit=cover` and the CSS uses `env(safe-area-inset-*)` via the existing theme system
- **Keyboard**: `@capacitor/keyboard` with `resize: 'body'` handles the compose input being pushed up when keyboard opens
- **Status bar**: Dark theme with `#050805` background matches the Firefly aesthetic

### 3.8 Android-Specific Considerations

- **Back button**: Capacitor handles hardware back button by default. The app's custom back navigation (`onBack` callbacks) will work if wired to the `App.addListener('backButton')` event
- **Splash screen**: Use `#050805` background with the Cortex logo

---

## Phase 4: Final Project Structure

```
cortex/
├── client/
│   ├── android/                  # Capacitor Android project (gitignored mostly)
│   ├── ios/                      # Capacitor iOS project (gitignored mostly)
│   ├── electron/
│   │   ├── main.js               # Electron main process
│   │   ├── preload.js            # Context bridge
│   │   └── icon.png              # App icon
│   ├── dist/                     # Vite build output (shared by all targets)
│   ├── public/                   # Static assets (icons, sw.js, manifest.json)
│   ├── src/                      # React source (THE single codebase)
│   ├── capacitor.config.ts       # Capacitor config
│   ├── electron-builder.yml      # Electron packaging config
│   ├── vite.config.js            # Vite config (base path varies by target)
│   ├── package.json              # Scripts for all targets
│   └── ...existing files
├── server/                       # Unchanged
└── ...existing root files
```

Key principle: `dist/` is the **single build artifact** consumed by all three native wrappers (Electron, Android, iOS). The React source in `src/` is never forked.

---

## Phase 5: Package.json Script Changes

```json
{
  "scripts": {
    "dev": "vite --port 3000",
    "build": "vite build",
    "preview": "vite preview",

    "electron:dev": "ELECTRON_BUILD=1 vite build && electron electron/main.js",
    "electron:build": "ELECTRON_BUILD=1 vite build && electron-builder",
    "electron:build:mac": "ELECTRON_BUILD=1 vite build && electron-builder --mac",
    "electron:build:win": "ELECTRON_BUILD=1 vite build && electron-builder --win",
    "electron:build:linux": "ELECTRON_BUILD=1 vite build && electron-builder --linux",

    "cap:sync": "vite build && cap sync",
    "cap:android": "vite build && cap sync android && cap open android",
    "cap:ios": "vite build && cap sync ios && cap open ios",
    "cap:build:android": "vite build && cap sync android && cd android && ./gradlew assembleRelease",
    "cap:build:ios": "vite build && cap sync ios"
  }
}
```

---

## Risks & Blockers

### 1. Native Push Notifications (HIGH — Server Work Required)

The current push system is 100% VAPID/Web Push via Service Workers. Native apps need FCM (Android) and APNs (iOS). This requires:
- A new server endpoint for native device token registration
- Firebase project setup (free tier) for FCM
- Apple Push Notification service certificate/key
- Server-side logic to route notifications to web-push vs FCM/APNs based on subscription type

**Recommendation**: Ship v1 of native apps **without** push notifications. The WebSocket connection already delivers real-time messages while the app is open. Add native push in a follow-up version.

### 2. Pop-out Call Windows (MODERATE)

`window.open()` in `CallModal.jsx` won't work on mobile. On Electron it works but creates unmanaged windows. Consider:
- Mobile: Always use inline call UI (already the default on mobile viewport)
- Electron: Use `BrowserWindow` via IPC instead of `window.open()` for proper window management

### 3. CSP in Electron (LOW)

The server sets CSP via Helmet headers, but Electron loads from local files so those headers aren't present. Electron's default CSP is permissive. For hardening, add a CSP meta tag to `index.html` that only applies in Electron, or set CSP in the main process via `session.defaultSession.webRequest`.

### 4. Electron Code Signing (MODERATE — Cost)

- macOS: Requires Apple Developer account ($99/year) + notarization
- Windows: Requires EV code signing certificate (~$200-400/year) to avoid SmartScreen warnings
- Linux: No signing required for AppImage/deb

**Can ship unsigned initially** — users will see OS warnings but can proceed.

### 5. iOS App Store Review (MODERATE)

Apple may scrutinize a WebView-based app. Mitigations:
- Ensure native plugins are used (push, haptics, share) so it's not "just a WebView wrapper"
- The E2EE, camera capture, and real-time WebSocket features demonstrate genuine native capability
- Follow Apple's guidelines on minimum functionality

### 6. Capacitor Origin Header (LOW)

Capacitor apps with `androidScheme: 'https'` send `Origin: https://localhost` on Android. The server's CORS config allows `!origin` requests through but also validates against `ALLOWED_ORIGINS` when an origin IS present. May need to add `https://localhost` and `capacitor://localhost` to `ALLOWED_ORIGINS` on production servers, or add a special case in the CORS middleware for Capacitor origins.

---

## Recommended Implementation Order

1. **Phase 1** first — fix `window.location.origin` references and guard SW registration. Small, safe changes that benefit the web app too.
2. **Electron** next — faster iteration cycle, easier to test on your dev machine, no app store process.
3. **Capacitor Android** — test on physical device or emulator, no signing required for sideloading.
4. **Capacitor iOS** — requires Mac + Xcode + Apple Developer account. Do last.
5. **Native push** — separate feature, add after all platforms are stable.

---

## .gitignore Additions Needed

```gitignore
# Electron
client/electron-dist/

# Capacitor
client/android/.gradle/
client/android/app/build/
client/android/build/
client/android/.idea/
client/android/local.properties
client/ios/App/Pods/
client/ios/App/build/
client/ios/DerivedData/
```

---

## Reference: Exact File Locations for Phase 1 Fixes

### 1.1 — `window.location.origin` references to fix

| File | Line | Current Code | Replace With |
|------|------|-------------|--------------|
| `client/src/components/calls/CallModal.jsx` | 220 | `window.location.origin + window.location.pathname` | `BASE_URL` (add import from `../../config/constants.js`) |
| `client/src/views/AppContent.jsx` | 52 | `window.location.href = window.location.origin + window.location.pathname` | `window.location.reload()` |
| `client/src/components/admin/BotDetailsModal.jsx` | 155 | `window.location.origin` | `BASE_URL` (add import from `../../config/constants.js`) |
| `client/src/components/groups/GroupsView.jsx` | 3773 | `window.location.origin` | `BASE_URL` (add import from `../../config/constants.js`) |

### 1.2 — Service Worker guards needed

| File | Line | Guard Condition |
|------|------|----------------|
| `client/CortexApp.jsx` | 44-71 | Wrap SW registration: `if (!window.Capacitor && !navigator.userAgent.includes('Electron'))` |
| `client/src/utils/pwa.js` | 29+ | Guard all `navigator.serviceWorker.*` calls with same condition |
| `client/src/views/LoginScreen.jsx` | 524-532 | Guard `navigator.serviceWorker?.getRegistrations()` |
| `client/src/views/AppContent.jsx` | 40-48 | Guard `navigator.serviceWorker?.getRegistrations()` |

### 1.3 — Pop-out call window guard

| File | Line | Change |
|------|------|--------|
| `client/src/components/calls/CallModal.jsx` | ~215-227 | Hide pop-out button when `isNativeApp && isMobile` |
