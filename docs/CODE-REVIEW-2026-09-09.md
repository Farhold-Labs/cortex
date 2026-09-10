# Repository review — 2026-09-09

The review found and fixed security, runtime, build, and validation defects. **Follow-up: the media-sharing authorization and playback credential-exposure issue has now been addressed; see [Scoped media sharing](MEDIA-SECURITY.md) for validation and rollout requirements. The other findings and verification limits below still apply.**

## Scope and stack

The starting repository had 294 tracked files, approximately 141,000 lines including documentation and native project files. Review included the tracked source inventory, JavaScript syntax parsing, JSX/module scope analysis, SQLite method-reference comparison, dependency audits, and focused manual inspection of authentication, authorization, media, storage, encryption, rendering, notifications, build scripts, and native configuration. This was not an exhaustive manual examination of every line or a penetration test of every endpoint.

- JavaScript/JSX: React 18 client, Vite 6/Rollup, Express 4 API, Express 5 static client server, WebSocket `ws`, SQLite through `better-sqlite3`; an older JSON database implementation also exists.
- TypeScript: Capacitor configuration; there is no configured application-wide TypeScript project.
- Desktop/mobile: Electron/electron-builder, Capacitor 8, Android Java/Gradle/JUnit/Android Lint, iOS Swift/Xcode/Swift Package Manager.
- SQL, HTML/CSS, shell build wrappers, JSON and YAML configuration.
- npm and three separate package/lockfile pairs; PM2 at the repository root.
- Before this review, neither JavaScript application package had test/lint/typecheck scripts. The only native tests found were Android template tests. A Node test suite is now available via `npm test` at the root after installing client/server dependencies.

## Fixed findings

| Priority | Finding and correction | Main files |
| --- | --- | --- |
| High | Decrypted messages and composer previews bypassed server HTML sanitization. Sanitize their final rendered HTML with DOMPurify, after markdown/mentions/attachment processing. | `client/src/utils/html.js`, `MessageWithEmbeds.jsx`, `MessageComposer.jsx` |
| High | Legacy message creation/reaction routes bypassed announcement posting/reply/reaction policies; legacy reactions also lacked wave-access authorization. Apply corresponding checks before mutation. | `server/server.js` |
| High | Both read-receipt routes accepted messages in inaccessible waves. Require wave access before writing receipts. | `server/server.js` |
| High | Five media endpoints checked JWT signatures without session revocation/account-status checks. Use the existing shared authentication middleware; query-string media tokens remain supported. | `server/server.js` |
| High | Session lookup exceptions authenticated users anyway. Database validation errors now deny authentication. | `server/server.js` |
| High | Ordinary SQLite silently ignores unsupported pragmas, so the application falsely reported database encryption enabled. Require a nonempty SQLCipher version and fail startup when an explicitly configured key cannot enable encryption. | `server/database-sqlite.js` |
| High | Electron passed arbitrary protocols to the OS URL launcher and accepted non-web persisted server URLs. Add URL allowlists and handle launcher rejection. | `client/electron/main.js`, `url-policy.js` |
| Medium | Storage path resolution accepted `../` keys outside uploads. Reject lexical escapes, absolute paths outside the root, empty keys and backslashes. No claim is made that this prevents a privileged local actor from planting symlinks. | `server/storage.js` |
| Medium | Watch-party routes called nonexistent database/WebSocket APIs; notifications could fail after database mutation. Use real wave/access and multi-session broadcasting APIs. | `server/server.js` |
| Medium | Moderator kicks called nonexistent `db.removeParticipant`; profile-video replies called nonexistent `broadcastToWaveParticipants`. Use existing helpers, including participation-cache synchronization. | `server/server.js` |
| Medium | Missing/non-string edit content caused exceptions rather than a client error. Validate content types on current/legacy edit routes and legacy creation. Legacy read notifications also omitted their recipient list. | `server/server.js` |
| Medium | Shared-message loading referenced an unimported `LOADING` constant. Also repair missing imports in retained admin definitions within `GroupsView.jsx`. The latter definitions are duplicated legacy code, not a demonstrated active GroupsView crash. | `PublicMessageView.jsx`, `GroupsView.jsx` |
| Medium | Build patched `sw.js` after generating compressed copies, so gzip/Brotli clients received the old service worker. Regenerate both compressed representations after injection. Support absolute validation output paths. | `client/scripts/inject-sw-assets.mjs` |
| Medium | Compressed index HTML received immutable caching because only `.html` was recognized. Treat `.html.gz`/`.html.br` as HTML. | `client/serve.mjs` |
| Medium | Android lint failed because camera permission implied mandatory hardware. Declare camera/autofocus optional. Correct the instrumented template test's stale package assertion. | Android manifest and instrumented test |
| Maintenance | Remove the permanently disabled old composer toolbar, which contained references to removed state. No working UI redesign was performed. | `MessageComposer.jsx` |
| Dependencies | Apply compatible audited dependency updates, add DOMPurify and jsdom test support, upgrade Nodemailer to 10 and Sharp to 0.35 for security fixes, and constrain `qs`/`js-yaml` to patched same-major versions. | All package/lockfile pairs |

DOMPurify configuration preserves ordinary HTML formatting, media, download links and mention data attributes; executable event handlers, script/SVG markup and unsafe URLs are removed. Device-specific rendering still needs manual testing. The use of final-output sanitization follows [DOMPurify's integration guidance](https://github.com/cure53/DOMPurify). The Electron restriction follows its [security guidance for external URLs](https://www.electronjs.org/docs/latest/tutorial/security). SQLite documents that [unknown pragmas are silently ignored](https://www.sqlite.org/pragma.html).

## Remaining findings and limits

1. **Resolved in the media-security follow-up:** item/wave-scoped grants now gate Jellyfin/Plex media, and direct/HLS playback is proxied without exposing upstream playback credentials. The follow-up also checks watch-party membership and removes credential fields from feed/party objects. Old links require re-sharing; previously exposed upstream credentials still need rotation. See [MEDIA-SECURITY.md](MEDIA-SECURITY.md).
2. **Eight moderate server dependency findings remain**, principally `uuid` and Firebase/Google Cloud dependency paths. The application itself imports UUID v4, while the reported UUID advisory concerns buffer handling in other UUID APIs; this does not establish that every transitive consumer is safe. npm proposes major changes, including a Firebase downgrade, for some paths. No forced downgrade was applied.
3. **One low PM2 advisory remains in the updated root dependency tree.** The root-owned existing `node_modules` directory could not be updated because of OS permissions. The updated root manifest/lockfile was installed and audited in `/tmp`; the existing PM2 installation must be reinstalled from it by its owner. No PM2 daemon was restarted.
4. **Incomplete in-call device switching:** `VoiceCallService.changeMic`, `changeCamera`, and `changeSpeaker` persist preferences but retain TODOs for updating active tracks/output. Actual LiveKit calls/device transitions were not available to verify. This behavior remains.
5. **Legacy duplication and database parity:** `GroupsView.jsx` retains several thousand lines of duplicate admin component definitions alongside extracted components. The JSON backend is older and is not equivalent to SQLite's newer feature API. Guarded `getPingsForBreakoutWave` references fall back because that method was removed; they are not unresolved runtime calls on the tested branch. Broad extraction/deletion/backend migration was not undertaken.
6. Android lint now has **0 errors and 33 warnings**, including selected-photo access, dependency currency, resource and manifest-order warnings. Gradle also reports deprecated features. These were not suppressed. The template unit test is only an arithmetic assertion; it does not establish functional mobile coverage.
7. No iOS/macOS build, signed native release, device instrumentation run, Electron GUI session, or live SMTP/S3/Firebase/Jellyfin/Plex/LiveKit/federation integration was performed. A standard SQLite build was tested; a working SQLCipher build was unavailable.
8. API callback tests use isolated stubs and do not exercise the full HTTP stack for each endpoint. The separate disposable-server health smoke test verifies startup/import/schema integration. No exhaustive fuzzing, browser end-to-end suite, cryptographic protocol proof, or Git-history secret audit was performed.

## Validation

| Check | Result |
| --- | --- |
| Baseline JavaScript syntax and Vite build | Passed before changes |
| `npm test` | 28 passing regression/smoke tests after changes |
| Fresh in-memory SQLite schema and user/wave/ping/reaction/edit/delete lifecycle | Passed |
| Disposable server copy, fresh database, no real credentials, loopback bind; `GET /api/health` | HTTP 200; process shut down afterward |
| Exact `npm run build` in `/tmp/cortex-review-snapshot/client` | Passed, including SW injection and staging/swap; live `client/dist` not replaced |
| Tracked `.js`/`.mjs`/`.cjs` files with `node --check`; Babel JSX scope/reference scan | Passed syntax; remaining scope matches are browser globals `MessageChannel` and `IDBKeyRange` |
| Capacitor config `tsc --noEmit --skipLibCheck --moduleResolution bundler --module esnext --target es2022` | Passed; not application-wide type checking |
| Android `./gradlew testDebugUnitTest lintDebug assembleDebug --no-daemon --console=plain` | Passed; 0 lint errors, 33 warnings; debug APK produced |
| Client npm audit | 0 advisories, down from 26 |
| Server npm audit | 8 moderate, down from 22 total including high/critical |
| Root updated dependency tree audit in `/tmp` | 1 low, down from 9 total including high/critical; installed root-owned tree remains pending reinstall |
| Patched Sharp image resize/WebP and Nodemailer JSON transport | Passed without external services |
| `git diff --check` | Passed after final whitespace correction |

Vite still reports a large main chunk; no unrelated bundle redesign was attempted. Full build logs and temporary analysis output are under `/tmp/cortex-*` for this session and are not committed artifacts.

## Claude/Claude Code artifact audit

Removed confirmed tool-only files: tracked `CLAUDE.md` and untracked `.claude/settings.local.json` (and its empty directory). Removed the now-broken development-guide link in `docs/API.md` and the Claude-specific attribution line in `server/.env.example`; generic SSH deployment guidance remains useful and was preserved.

Retained and reported before any deletion: historical mentions in `CHANGELOG.md` and `docs/DESIGN-droplets.md`. They describe past documentation work and are not executable machine metadata. No ambiguous historical material was deleted. No application Anthropic integration, Claude session IDs, accidental system-reminder/assistant XML, or source-generation attribution was identified in the scanned working source. Legitimate application session identifiers, Android/Capacitor-generated XML, release signing material, build-system comments and historical architecture documentation were not classified as Claude debris. User data, real environment files and Git object history were outside this metadata/content scan.

## Changed files
- `CLAUDE.md`
- `client/android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java`
- `client/android/app/src/main/AndroidManifest.xml`
- `client/electron/main.js`
- `client/electron/url-policy.js`
- `client/package-lock.json`
- `client/package.json`
- `client/scripts/inject-sw-assets.mjs`
- `client/serve.mjs`
- `client/src/components/compose/MessageComposer.jsx`
- `client/src/components/groups/GroupsView.jsx`
- `client/src/components/messages/MessageWithEmbeds.jsx`
- `client/src/utils/html.js`
- `client/src/views/PublicMessageView.jsx`
- `docs/API.md`
- `docs/CODE-REVIEW-2026-09-09.md`
- `package-lock.json`
- `package.json`
- `server/.env.example`
- `server/database-sqlite.js`
- `server/package-lock.json`
- `server/package.json`
- `server/server.js`
- `server/storage.js`
- `tests/review.test.cjs`

Also deleted untracked `.claude/settings.local.json`; it does not appear in the Git diff.
