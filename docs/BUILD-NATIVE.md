# Native Build Instructions

These instructions cover building the Cortex desktop and mobile apps for all platforms.

> **Architecture note**: All Electron apps (Linux, Windows, macOS) are remote wrappers — they load the web UI from `https://cortex.farhold.com` via `electron/app/index.html`. They only need rebuilding when `electron/main.js`, `electron/preload.cjs`, or native dependencies change. The Android and iOS Capacitor apps similarly load from the server after initial launch.

---

## Table of Contents

- [Linux Build — Electron](#linux-build--electron)
  - [Prerequisites](#prerequisites)
  - [Build](#build)
  - [Output](#output)
  - [Building specific formats](#building-specific-formats)
- [Windows Build — Electron](#windows-build--electron)
  - [Prerequisites](#prerequisites-1)
  - [Build](#build-1)
  - [Output](#output-1)
  - [Code signing](#code-signing)
  - [Cross-compilation from Linux](#cross-compilation-from-linux)
- [macOS Build — Electron](#macos-build--electron)
  - [Prerequisites](#prerequisites-2)
  - [Generate a macOS icon (.icns)](#generate-a-macos-icon-icns)
  - [Build the DMG](#build-the-dmg)
  - [Code Signing & Notarization](#code-signing--notarization-for-distribution)
  - [Unsigned local build](#unsigned-local-build-for-testing-only)
- [Android Build — Capacitor](#android-build--capacitor)
  - [Prerequisites](#prerequisites-3)
  - [Build and sync web assets](#build-and-sync-web-assets)
  - [Build APK (sideloading)](#build-apk-sideloading)
  - [Build AAB (Google Play Store)](#build-aab-google-play-store)
  - [Build from Android Studio](#build-from-android-studio)
  - [Signing](#signing)
  - [Key configuration](#key-configuration)
  - [Common commands cheat sheet](#common-commands-cheat-sheet)
  - [Troubleshooting](#troubleshooting)
- [iOS Build — Capacitor](#ios-build--capacitor)
  - [Prerequisites](#prerequisites-4)
  - [Build and sync web assets](#build-and-sync-web-assets-1)
  - [Open in Xcode](#open-in-xcode)
  - [Configure signing in Xcode](#configure-signing-in-xcode)
  - [Build for Simulator](#build-for-simulator-testing)
  - [Build for physical device](#build-for-physical-device)
  - [Build for App Store / TestFlight](#build-for-app-store--testflight)
  - [Build for Ad Hoc distribution](#build-for-ad-hoc-distribution-ipa)
  - [Push Notifications setup](#push-notifications-setup)
  - [Project structure reference](#project-structure-reference)
  - [Key configuration](#key-configuration-1)
  - [Common commands cheat sheet](#common-commands-cheat-sheet-1)
  - [Troubleshooting](#troubleshooting-1)
- [Electron architecture notes](#electron-architecture-notes)
- [Release workflow](#release-workflow)

---

## Linux Build — Electron

### Prerequisites

- **Node.js** 18+ and npm

### Build

```bash
cd client
npm install
npm run build
npm run electron:build:linux
```

### Output

All artifacts appear in `client/electron-dist/`:

| File | Arch | Format |
|------|------|--------|
| `Cortex-{version}.AppImage` | x64 | AppImage (portable, no install) |
| `Cortex-{version}-arm64.AppImage` | arm64 | AppImage |
| `cortex_{version}_amd64.deb` | x64 | Debian/Ubuntu package |
| `cortex-{version}.x86_64.rpm` | x64 | Fedora/RHEL package |

### Building specific formats

```bash
npm run electron:build -- --linux AppImage    # AppImage only
npm run electron:build -- --linux deb         # .deb only
npm run electron:build -- --linux rpm         # .rpm only
npm run electron:build -- --linux --arm64     # arm64 only
npm run electron:build -- --linux --x64       # x64 only
```

---

## Windows Build — Electron

### Prerequisites

- **Node.js** 18+ and npm

### Build

```bash
cd client
npm install
npm run build
npm run electron:build:win
```

### Output

All artifacts appear in `client/electron-dist/`:

| File | Arch |
|------|------|
| `Cortex Setup {version}.exe` | x64 |
| `Cortex Setup {version}-arm64.exe` | arm64 |

### Code signing

For signed builds, set these environment variables before building:

```bash
export CSC_LINK="/path/to/certificate.pfx"
export CSC_KEY_PASSWORD="certificate-password"
npm run electron:build:win
```

### Cross-compilation from Linux

Windows builds can be cross-compiled from Linux. electron-builder handles this automatically — `npm run electron:build:win` works on Linux. Wine is required for NSIS installers and is usually auto-downloaded by electron-builder if not present.

---

## macOS Build — Electron

### Prerequisites

- **macOS** (required for signing and notarization)
- **Node.js** 18+ and npm
- **Xcode Command Line Tools**: `xcode-select --install`
- **Apple Developer account** (for signing/notarization — optional for unsigned local builds)

### Generate a macOS icon (.icns)

Electron on macOS requires `.icns` format. Generate one from the existing 512px PNG:

```bash
cd client

# Create iconset directory
mkdir -p /tmp/Cortex.iconset

# Generate required sizes from source PNG
SOURCE="public/icons/icon-512x512.png"
sips -z 16   16   "$SOURCE" --out /tmp/Cortex.iconset/icon_16x16.png
sips -z 32   32   "$SOURCE" --out /tmp/Cortex.iconset/icon_16x16@2x.png
sips -z 32   32   "$SOURCE" --out /tmp/Cortex.iconset/icon_32x32.png
sips -z 64   64   "$SOURCE" --out /tmp/Cortex.iconset/icon_32x32@2x.png
sips -z 128  128  "$SOURCE" --out /tmp/Cortex.iconset/icon_128x128.png
sips -z 256  256  "$SOURCE" --out /tmp/Cortex.iconset/icon_128x128@2x.png
sips -z 256  256  "$SOURCE" --out /tmp/Cortex.iconset/icon_256x256.png
sips -z 512  512  "$SOURCE" --out /tmp/Cortex.iconset/icon_256x256@2x.png
sips -z 512  512  "$SOURCE" --out /tmp/Cortex.iconset/icon_512x512.png
cp "$SOURCE"       /tmp/Cortex.iconset/icon_512x512@2x.png

# Convert to .icns
iconutil -c icns /tmp/Cortex.iconset -o electron/icon.icns
```

> **Note**: The `.icns` file must be generated on macOS (requires `sips` and `iconutil`). Commit it to the repo so non-Mac builders don't need to regenerate it.

### Build the DMG

```bash
cd client
npm install
npm run build
npm run electron:build:mac

# Or for a specific arch only:
npm run electron:build -- --mac --arm64    # Apple Silicon
npm run electron:build -- --mac --x64      # Intel
```

Output appears in `client/electron-dist/`:

| File | Description |
|------|-------------|
| `Cortex-{version}-arm64.dmg` | Apple Silicon installer |
| `Cortex-{version}.dmg` | Intel installer |
| `Cortex-{version}-arm64-mac.zip` | Apple Silicon zip (for auto-updater) |
| `Cortex-{version}-mac.zip` | Intel zip (for auto-updater) |

### Code Signing & Notarization (for distribution)

For the DMG to open without Gatekeeper warnings, it must be signed and notarized. Set these environment variables **before** building:

```bash
# Apple Developer identity (from Keychain Access → "Developer ID Application: ...")
export CSC_NAME="Developer ID Application: Your Name (TEAM_ID)"

# Or provide a .p12 certificate file instead
export CSC_LINK="/path/to/certificate.p12"
export CSC_KEY_PASSWORD="certificate-password"

# For notarization (App Store Connect API key — recommended approach)
export APPLE_API_KEY="/path/to/AuthKey_XXXXXXXX.p8"
export APPLE_API_KEY_ID="XXXXXXXX"
export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# Then build — electron-builder handles signing & notarization automatically
npm run electron:build:mac
```

### Unsigned local build (for testing only)

To skip signing entirely (the app will show Gatekeeper warnings on other machines):

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run electron:build:mac
```

---

## Android Build — Capacitor

### Prerequisites

- **Node.js** 18+ and npm
- **Android Studio** with SDK 36 installed
- **Java** 17+ (bundled with Android Studio, or install separately)
- **Android SDK Build-Tools** and **Android SDK Platform 36** (install via Android Studio → SDK Manager)

### Build and sync web assets

```bash
cd client
npm install

# Build the React app into dist/
npm run build

# Sync web assets + plugins to the Android project
npx cap sync android
```

`cap sync` does three things:
1. Copies `dist/` into `android/app/src/main/assets/public/`
2. Updates the native `capacitor.config.json` from `capacitor.config.ts`
3. Resolves and links Capacitor plugin native code

> **Important**: You must run `npm run build && npx cap sync android` every time the web code changes before building.

### Build APK (sideloading)

```bash
npm run cap:build:android
```

Output: `client/android/app/build/outputs/apk/release/app-release-unsigned.apk`

### Build AAB (Google Play Store)

```bash
npm run cap:build:android:aab
```

Output: `client/android/app/build/outputs/bundle/release/app-release.aab`

### Build from Android Studio

```bash
npx cap open android    # Opens project in Android Studio
```

Then: **Build → Generate Signed Bundle / APK** and follow the wizard.

### Signing

For release builds, you need a keystore. Create one if you don't have one:

```bash
keytool -genkey -v -keystore cortex-release.keystore -alias cortex \
  -keyalg RSA -keysize 2048 -validity 10000
```

**Option A** — Configure signing in `client/android/app/build.gradle`:

```gradle
android {
    signingConfigs {
        release {
            storeFile file('/path/to/cortex-release.keystore')
            storePassword 'your-store-password'
            keyAlias 'cortex'
            keyPassword 'your-key-password'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
```

**Option B** — Sign via Android Studio's **Build → Generate Signed Bundle / APK** wizard (no config changes needed).

**Option C** — Sign after build with `apksigner`:

```bash
apksigner sign --ks cortex-release.keystore \
  --ks-key-alias cortex \
  app-release-unsigned.apk
```

> **Security**: Never commit keystores or passwords to the repository.

### Key configuration

| Setting | Value |
|---------|-------|
| App ID | `com.farhold.cortex` |
| Min SDK | 24 (Android 7.0) |
| Target SDK | 36 |
| Compile SDK | 36 |
| Gradle plugin | 8.13.0 |
| Capacitor version | 8.1.0 |
| Firebase | Included (google-services 4.4.4) |
| Web dir | `dist` (built React app) |
| Production server | `https://cortex.farhold.com` |

### Common commands cheat sheet

```bash
npm run build                   # Build web assets into dist/
npx cap sync android            # Copy web assets + sync plugins to Android project
npx cap open android            # Open Android project in Android Studio
npx cap run android             # Build & run on emulator or connected device
npx cap copy android            # Copy web assets only (skip plugin sync — faster)
npm run cap:build:android       # Build release APK via Gradle
npm run cap:build:android:aab   # Build release AAB via Gradle
```

### Troubleshooting

| Problem | Solution |
|---------|----------|
| `SDK location not found` | Create `client/android/local.properties` with `sdk.dir=/path/to/Android/Sdk` |
| Gradle sync fails | Open in Android Studio → File → Sync Project with Gradle Files |
| `assets/public/` empty | Run `npm run build && npx cap sync android` before building |
| Build fails with Java errors | Ensure Java 17+ is installed: `java -version` |
| Firebase `google-services.json` missing | Place your `google-services.json` in `client/android/app/` |
| Stale web assets after code change | Always run `npm run build && npx cap sync android` before building |

---

## iOS Build — Capacitor

### Prerequisites

- **macOS** with **Xcode 15+** (install from the App Store)
- **Xcode Command Line Tools**: `xcode-select --install`
- **Node.js** 18+ and npm
- **Apple Developer account** (required for device builds and App Store submission)
- An iPhone/iPad or Xcode Simulator

### Build and sync web assets

```bash
cd client
npm install

# Build the React app into dist/
npm run build

# Sync web assets + plugins to the native iOS project
npx cap sync ios
```

`cap sync` does three things:
1. Copies `dist/` into `ios/App/App/public/`
2. Updates the native `capacitor.config.json` from `capacitor.config.ts`
3. Resolves and links Capacitor plugin native code via Swift Package Manager

> **Important**: You must run `npm run build && npx cap sync ios` every time the web code changes before building in Xcode.

### Open in Xcode

```bash
npx cap open ios
```

This opens `client/ios/App/App.xcodeproj` in Xcode.

### Configure signing in Xcode

1. In the Xcode sidebar, select the **App** project (blue icon at the top)
2. Select the **App** target
3. Go to the **Signing & Capabilities** tab
4. Check **Automatically manage signing**
5. Select your **Team** (your Apple Developer account)
6. Verify the **Bundle Identifier** is `com.farhold.cortex`

### Build for Simulator (testing)

```bash
# From command line (lists available simulators and runs):
npx cap run ios --target "iPhone 16"

# Or from Xcode:
# 1. Select a simulator from the device dropdown (top bar)
# 2. Press Cmd+R (or Product → Run)
```

### Build for physical device

1. Connect the iPhone/iPad via USB
2. In Xcode, select the device from the device dropdown (top bar)
3. On first use, trust the developer certificate on the device: **Settings → General → VPN & Device Management**
4. Press **Cmd+R** to build and run

### Build for App Store / TestFlight

1. In Xcode, select **Any iOS Device (arm64)** from the device dropdown
2. **Product → Archive** (not Cmd+B — you must use Archive)
3. When archiving completes, the **Organizer** window opens automatically
4. Select the archive → click **Distribute App**
5. Choose **App Store Connect** → **Upload**
6. Follow the prompts for signing options
7. Once uploaded, go to [App Store Connect](https://appstoreconnect.apple.com) to submit for TestFlight or App Store review

### Build for Ad Hoc distribution (.ipa)

1. Archive as above (**Product → Archive**)
2. In Organizer → **Distribute App** → **Ad Hoc**
3. Select the provisioning profile
4. Export — produces a `.ipa` file you can install via Apple Configurator or `ios-deploy`

### Push Notifications setup

The app uses `@capacitor/push-notifications`. For push to work on iOS:

1. In Xcode → **Signing & Capabilities** tab → click **+ Capability** → add **Push Notifications**
2. Also add **Background Modes** capability → check **Remote notifications**
3. In your [Apple Developer account](https://developer.apple.com/account/resources/authkeys/list), create an **APNs Key** (Keys → +) — download the `.p8` file
4. The server's VAPID keys handle web push; native iOS push requires the APNs key to be configured with your push notification service

### Project structure reference

```
client/ios/
├── App/
│   ├── App/
│   │   ├── AppDelegate.swift        ← App lifecycle (standard Capacitor, no custom code)
│   │   ├── Info.plist               ← Bundle metadata
│   │   ├── capacitor.config.json    ← Auto-generated from capacitor.config.ts by cap sync
│   │   ├── Assets.xcassets/         ← App icons & splash screen images
│   │   ├── Base.lproj/             ← Storyboards (LaunchScreen, Main)
│   │   └── public/                  ← Web assets (copied from dist/ by cap sync)
│   ├── App.xcodeproj/               ← Xcode project file
│   └── CapApp-SPM/
│       └── Package.swift            ← Swift Package Manager deps (Capacitor 8.1.0)
```

### Key configuration

| Setting | Value |
|---------|-------|
| App ID | `com.farhold.cortex` |
| Min iOS version | 15 |
| Package manager | Swift Package Manager (not CocoaPods) |
| Capacitor version | 8.1.0 |
| Web dir | `dist` (built React app) |
| Production server | `https://cortex.farhold.com` |
| Background color | `#050805` |
| Plugins | App, Haptics, PushNotifications, SplashScreen, StatusBar |

### Common commands cheat sheet

```bash
npm run build              # Build web assets into dist/
npx cap sync ios           # Copy web assets + sync plugins to iOS project
npx cap open ios           # Open iOS project in Xcode
npx cap run ios            # Build & run on simulator or connected device
npx cap copy ios           # Copy web assets only (skip plugin sync — faster)
```

### Troubleshooting

| Problem | Solution |
|---------|----------|
| SPM package resolution fails | Xcode → File → Packages → Reset Package Caches, then File → Packages → Resolve Package Versions |
| Signing errors | Ensure you're signed into Xcode with your Apple ID: Xcode → Settings → Accounts |
| `public/` folder empty in Xcode | Run `npm run build && npx cap copy ios` before building |
| Push notifications not working on Simulator | Push only works on physical devices — this is an Apple limitation |
| Build fails with "no such module" | Run `npx cap sync ios` to ensure all plugin native code is linked |
| Stale web assets after code change | Always run `npm run build && npx cap sync ios` before building in Xcode |

---

## Electron architecture notes

- **Production mode**: The app loads a redirect page (`electron/app/index.html`) that navigates to `https://cortex.farhold.com`. There is no bundled offline app — it's a wrapper around the web app.
- **Dev mode**: Run `npm run dev` first (starts Vite on port 3000), then `npm run electron:dev` — it connects to `http://localhost:3000` with DevTools auto-opened.
- Window state (position/size/maximized) persists across launches via `window-state.json` in the user data directory.
- Deep links via `cortex://` protocol are registered automatically.
- macOS gets `hiddenInset` title bar style for native look.
- Auto-updater code exists but is currently disabled in `electron/main.js` — uncomment the block in `app.whenReady()` once GitHub Releases with electron-builder artifacts are being published.

---

## Release workflow

1. Merge to `master` via PR chain (`develop` → `qa` → `master`)
2. Tag the release: `git tag vX.Y.Z && git push origin vX.Y.Z`
3. Build native artifacts on their respective platforms:
   - **Linux**: `npm run electron:build:linux` (can run on any Linux machine or CI)
   - **Windows**: `npm run electron:build:win` (can cross-compile from Linux)
   - **macOS**: `npm run electron:build:mac` (requires macOS)
   - **Android**: `npm run cap:build:android` / `npm run cap:build:android:aab`
   - **iOS**: Archive from Xcode on macOS
4. Create GitHub release and attach Electron artifacts (`.AppImage`, `.deb`, `.rpm`, `.exe`, `.dmg`, `.zip`)
5. Upload Android AAB to Google Play Console
6. Upload iOS build to App Store Connect via Xcode Organizer
