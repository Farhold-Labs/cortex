# Cortex handoff note

Updated 2026-09-10. This is a human-facing continuation note for future maintenance sessions.

## Completed

- Repository review completed; confirmed security, runtime, build, dependency, and metadata findings were fixed.
- Claude Code artifacts were removed from the working source tree during the security review. `.claude/settings.local.json` was local and untracked and stays removed.
- **`CLAUDE.md` has since been restored at the maintainer's request** (2026-09-10). It was not reverted from history — it was rewritten against the current tree, since the deleted copy described a v2.58-era codebase. It is the developer workflow and architecture guide, not a tool artifact.
- Jellyfin/Plex media authorization now uses item-specific, wave-scoped grants. Direct and HLS playback is proxied through Cortex without exposing upstream credentials.
- Cortex version is `2.86.0`; native build numbers are `28600`.
- Plex media embed follow-up prevents duplicate playback requests, ignores stale responses, and exits browser PiP before removing the video element.
- Validation: 44 Node tests pass; isolated production client build passes; schema, syntax, and Android checks passed during review.

## Git and release state

- Security release commit: `c21af7a` (`fix: harden media access and release 2.86.0`).
- Plex PiP follow-up commit: `7b5b892` (`fix: stabilize Plex picture-in-picture playback`).
- PR #716 merged into `develop`; PR #717 promoted the security release to `qa`; PR #718 merged the PiP follow-up into `develop`; PR #719 promoted it to `qa`.
- QA deployment and media credential rotation were completed. Native browser PiP remains limited by the video element lifecycle: navigating away from a wave unmounts the embed and stops playback. A persistent floating player is deferred as a future feature.

## Next production work

1. Create/merge the `qa` to `master` production PR for 2.86.0.
2. Tag `v2.86.0` after merge.
3. Document the production deployment method currently used: download/extract release archive, preserve environment/database/uploads, run migrations, restart services, health-check, and rollback.
4. Address remaining non-release follow-ups separately: dependency advisories, CI gates, active call device switching, watch-party UI wiring, legacy duplication, and broader device testing.

## Documentation pass (2026-09-10)

Done alongside the `CLAUDE.md` restore, before the production PR:

- `server/.env.example`: added the three **LiveKit** variables, which the server has always read but which were never documented. Added a media-security note to the Jellyfin section (proxied playback consumes this server's bandwidth; HLS session state is process-local, so multi-worker needs sticky routing). Marked `JWT_EXPIRES_IN` as the legacy path and pointed at the v2.75.0 instance security policy; clarified that `SESSION_MAX_AGE_DAYS` reaps session rows rather than setting session lifetime.
- `README.md`: version 2.72.3 → 2.86.0; Tenor replaced with GIPHY/Klipy; Resend preferred over SMTP; LiveKit added; crawl bar noted as admin-panel-configured; security section updated for the v2.75.0 session model, fail-closed encryption and scoped media.
- `docs/DEPLOYMENT.md`: same GIF/LiveKit/email corrections, with the blocked-port-587 warning made explicit.
- `docs/API.md`: version header refreshed and an honest coverage note added — roughly half of ~320 routes are undocumented, so `server/server.js` is authoritative.
- `OUTSTANDING-FEATURES.md`: completed table brought current through v2.86.0.
- `landing/index.html`: hardcoded fallback version refreshed (the live value is fetched from the latest GitHub release).
- Six superseded design/plan docs now carry a "Historical document" banner rather than reading as current.

## Important limitations

No live external Plex/Jellyfin credentials, production database, iOS build, signed release, Electron GUI session, or real-device codec testing was used during review.
