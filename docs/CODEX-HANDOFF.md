# Cortex handoff note

Updated 2026-09-10. This is a human-facing continuation note for future maintenance sessions.

## Completed

- Repository review completed; confirmed security, runtime, build, dependency, and metadata findings were fixed.
- Confirmed Claude Code artifacts were removed from the working source tree. `CLAUDE.md` was tracked and remains recoverable from Git history; `.claude/settings.local.json` was local and untracked.
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
4. Recover `CLAUDE.md` to a temporary path if needed for historical deployment guidance: `git show origin/master:CLAUDE.md > /tmp/CLAUDE.md`. Do not restore it to the application source tree.
5. Address remaining non-release follow-ups separately: dependency advisories, CI gates, active call device switching, watch-party UI wiring, legacy duplication, and broader device testing.

## Important limitations

No live external Plex/Jellyfin credentials, production database, iOS build, signed release, Electron GUI session, or real-device codec testing was used during review.
