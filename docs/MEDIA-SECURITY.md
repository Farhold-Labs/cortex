# Scoped Jellyfin/Plex media sharing

The media-security follow-up fixes the connection-ID authorization bypass and stops sending upstream playback credentials to viewers. It also fixes Plex's HLS path, which previously embedded the Plex account token in the returned playlist URL.

## Authorization

A logged-in user may access an item when one of these conditions holds:

- They own its media-server connection.
- The connection owner explicitly created a grant for that exact provider, connection, item, and wave, and both the viewer and owner still have access to the wave.
- For Jellyfin watch parties, the exact item belongs to an active party hosted by the connection owner, and the viewer and host still have wave access.

Connection IDs, item IDs, and copied embed URLs alone are not permissions. A private-wave grant does not authorize users outside that wave. A public-wave grant follows the application's public-wave policy: any authenticated viewer with public-wave access can use it. Library browsing and connection management remain owner-only.

These checks cover item details, stream metadata, binary playback, thumbnails, and every Plex HLS request. Revoking a grant, deleting its connection, or removing wave access denies subsequent requests. Ending a watch party removes its non-owner playback permission. Existing authentication still enforces session revocation and account moderation.

Grants are explicit, durable permissions rather than inferred message contents. They work with E2EE because the client places only a grant ID in the encrypted embed; the server does not need to decrypt or scan messages. Grant metadata records the external item and target wave in SQLite. Deleting a message or abandoning a draft does **not** revoke a grant: explicitly revoke it or delete the connection. Already downloaded/buffered media cannot be recalled, and an already-open progressive stream is not retroactively interrupted; new requests are checked again.

## API and clients

Create a grant as the connection owner, with normal Cortex authentication:

```http
POST /api/media/shares
Content-Type: application/json
Authorization: Bearer <Cortex token>

{"provider":"plex","connectionId":"plex-...","itemId":"123","waveId":"wave-..."}
```

The response is `201 { "share": { "id": "share-...", ... } }`. `provider` is `plex` or `jellyfin`; IDs are strings. The owner must be allowed to post in the wave. Grant creation requires SQLite.

The media picker creates the grant before adding the item to the composer. The active Plex picker receives its wave ID from `WaveView`; the reusable Jellyfin picker also requires a `waveId` from its caller. Both embed formats support `share`:

```text
cortex://plex/plex-.../123?share=share-...&name=Example
cortex://jellyfin/jf-.../abc123?share=share-...&name=Example
```

Players carry the grant as `?share=share-...` on media requests. The server returns only Cortex playback URLs. The client validates the playback origin before attaching its Cortex token. Existing header/query Cortex authentication remains supported; do not distribute authenticated playback URLs as sharing links.

Revoke a grant as its owner:

```http
DELETE /api/media/shares/share-...
Authorization: Bearer <Cortex token>
```

No upstream API credential is returned from playback, thumbnails, watch-party objects, or feed-import objects. Plex's owner OAuth setup remains a separate authentication flow.

## Proxy behavior

Jellyfin `/stream` returns JSON pointing at the new `/api/jellyfin/video/:connectionId/:itemId` binary proxy. A watch-party player uses that proxy with `?party=<party-id>`. Plex direct video and thumbnails also use the proxy.

For HLS, Cortex rewrites playlist variant, segment, initialization-segment, and encryption-key URI references to opaque Cortex resource IDs. It registers the upstream resources itself; callers cannot submit an arbitrary upstream path. References are restricted to the configured server's transcode path, and upstream credentials are attached as server-side headers. Redirects are rejected rather than forwarding credentials elsewhere. This handles the URI forms described in [RFC 8216](https://datatracker.ietf.org/doc/html/rfc8216).

The proxy supports byte ranges, sends `private, no-store`, rejects HTML/SVG responses masquerading as media, limits playlist size, aborts stalled/disconnected requests, and handles stream errors without exposing upstream URLs or credentials. HLS sessions are tied to the Cortex user and recheck the live grant on each request. Sessions expire after eight hours; restarting playback obtains a new session. Session/resource counts are bounded, and one viewer restarting playback evicts their own oldest session rather than another viewer's.

HLS resource maps are process-local, as other realtime state in this application already is. Multi-worker deployments need sticky routing for a playback session. Restarting the server invalidates active HLS URLs; viewers can start playback again.

## Deployment

1. Back up the database and deploy the server and client changes together. The idempotent migration adds `media_shares` and its index; `schema.sql` includes the same schema.
2. **Rotate/revoke Plex and Jellyfin credentials that were exposed by the old playback paths.** The patch cannot invalidate copies of an upstream credential already obtained by a viewer. Reconnect Cortex using replacement credentials.
3. **Share old media links again from their intended wave.** Legacy links without grants remain usable by the connection owner but are deliberately denied to other viewers. An active, authorized watch party is a separate explicit permission.
4. Check actual Plex/Jellyfin direct play, transcoding, seeking, thumbnails, and native/Safari playback in staging. Streaming now uses Cortex server bandwidth, and upstream redirects must be corrected to a canonical configured server URL.

The patch does not deploy or rotate live credentials automatically. The existing watch-party UI wiring and real-device codec behavior are not certified by these server tests; the security checks cover the actual HTTP and WebSocket endpoints, and the reusable watch-party player uses the protected binary URL.

## Validation

- `npm test`: **44 tests pass** across the original review suite and new media tests.
- End-to-end tests boot a disposable Cortex server with a fresh SQLite database and simulated upstream Jellyfin/Plex servers. They exercise real login, grant creation, HTTP playback, HLS manifests/keys/segments, and WebSocket watch-party joins.
- Negative tests cover outsiders, forged/altered targets, legacy links without grants, revoked grants, removed members, logged-out sessions, cross-origin playlists, redirects, invalid byte ranges, and executable MIME types.
- Credential checks cover playback JSON, rewritten playlists, forwarded request URLs, application logs, and feed-import responses.
- Schema generation and `node tools/generate-schema.mjs --check` verify equivalent fresh/migrated schemas.
- The exact production client build passes in an isolated `/tmp` source copy, including service-worker injection/compression. The live `client/dist` was not replaced.
- JavaScript syntax and JSX scope checks pass for changed code. No real media account, external credential, or live user database was used for validation.

## Files in this follow-up

- `server/server.js`, `server/database-sqlite.js`, `server/schema.sql`
- `server/lib/media-access.js`, `server/lib/media-proxy.js`
- `client/src/utils/media.js`, `client/src/utils/embed.js`
- `client/src/components/media/JellyfinBrowserModal.jsx`, `JellyfinEmbed.jsx`, `PlexBrowserModal.jsx`, `PlexEmbed.jsx`, `WatchPartyPlayer.jsx`
- `client/src/components/messages/MessageWithEmbeds.jsx`, `client/src/components/waves/WaveView.jsx`
- `tests/media-security.test.cjs`
- This document, `docs/API.md`, and the follow-up status in `docs/CODE-REVIEW-2026-09-09.md`
