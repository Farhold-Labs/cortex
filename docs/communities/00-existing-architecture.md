# Cortex as it exists today

Reconnaissance for the Communities project, 2026-09-18, against `master` at
v2.93.0. Everything here was read out of the repository rather than recalled;
line numbers are `server/server.js` unless stated otherwise and will drift.

The purpose is to establish what Communities can reuse, what it must not
duplicate, and where the genuine gaps are.

---

## 1. Identity

**There is exactly one identity table, and it is local.**

`users` holds local accounts (`server/schema.sql`). A handle is unique within a
node. The node's own name comes from `db.getServerIdentity()?.nodeName`.

Remote people are represented by `remote_users`:

```sql
CREATE TABLE remote_users (
    id TEXT PRIMARY KEY,
    node_name TEXT NOT NULL,
    handle TEXT NOT NULL,
    display_name TEXT, avatar TEXT, avatar_url TEXT, bio TEXT,
    cached_at TEXT, updated_at TEXT,
    UNIQUE(node_name, handle)
);
```

This is a **profile cache**, populated for display. It confers nothing.
`parseFederatedIdentifier()` (:17028) parses `user@node` strings.

### The constraint that matters

Every table that grants a right references `users(id)`:

| Table | Column | Consequence |
| --- | --- | --- |
| `wave_participants` | `user_id REFERENCES users(id)` | only local users participate |
| `wave_encryption_keys` | `user_id REFERENCES users(id)` | only local users can hold an E2EE key |
| `crew_members` | `user_id REFERENCES users(id)` | crews are local |
| `event_invites`, `event_attendance`, `event_rsvp` | `user_id REFERENCES users(id)` | events are local |
| `wave_roles_encrypted` | blob of `{userId: role}` | wave staff are local |

**There is no object in Cortex that represents "a person, wherever they are
hosted, who holds rights here."** Communities needs one. This is the crux.

---

## 2. Authentication

### Local users — mature, do not rebuild

Password login plus, since v2.75.0, a split between token and session:

- 60-minute rotating **access token**; 90-day sliding **refresh session**
- refresh-token **reuse detection** revokes the whole family
- **step-up re-auth** for sensitive actions — `requireStepUp` (:5251)
- new-device email alerts; password change ends other sessions
- policy per instance in `instance_config.security` (`SECURITY_POLICY_DEFAULTS`, :111)

Middleware: `authenticateToken`. Session validation failures **deny** (fixed in
the v2.86.0 review).

Communities should use this unchanged. Reference: `docs/` + the v2.75.0 work.

### Nodes — HTTP Signatures

`createFederationAuthMiddleware(allowedStatuses)` (:16810) is the server-to-server gate:

1. resolve the calling node in `federation_nodes`; reject unknown
2. reject unless `node.status` is in the allowed set
3. reject if no stored public key
4. **verify `Digest` against the body** — *only if the header is present* (:16849)
5. verify the HTTP signature with the node's stored public key
6. **reject if `Date` is more than 5 minutes from now** (:16863)
7. attach `req.federationNode`, record contact

Signing is RSA-SHA256 over `(request-target)`, `host`, `date`, and `digest` when
there is a body (`createHttpSignatureFromString`, :16718). The verifier
reconstructs the signing string from the **sender's** `headers` list (:16777).

Two properties worth naming precisely, because they bound what Communities can
assume:

- The public key is looked up **from the node record**, not fetched from the
  `keyId` in the header, and the algorithm is hard-coded to RSA-SHA256 rather
  than taken from the header. Both are correct and avoid key-confusion and
  algorithm-confusion attacks.
- The signed-header *set* is nevertheless attacker-chosen. See
  [01-threat-model.md](01-threat-model.md) §2 for what that costs.

### Replay

`federation_inbox_log` records message ids and is checked before processing
(`database-sqlite.js:8911`). Combined with the 5-minute date window this is a
real, layered replay defence — and a good foundation for Communities events.

---

## 3. Authorization

Three independent layers exist. All of them evaluate **local user ids**.

**Instance** — `hasRole` / `requireRole` (:548, :558), ladder admin > moderator > user, `role` column on users.

**Wave** — deliberately separates *see* from *write*:
- `canAccessWaveFromCache(waveId, userId)` (:4711) — public / crossServer / crew / participant
- `canPostToWave(wave, userId)` (:630)
- v2.88.0 added per-wave staff: `getWaveRole()` → `owner | admin | moderator`,
  resolving creator, explicit appointment, and inheritance from the owning crew;
  `canManageWave` / `canModerateWave` (:621, :626)
- role map stored **encrypted** in `wave_roles_encrypted`, one blob per wave,
  under `WAVE_PARTICIPATION_KEY`

**Crew** — `crew_members.role` ∈ admin | moderator | member, enforced server-side.

**Events** — `canManageEvent` (:12368), `canRsvpToEvent`, `canSeeEventRsvps`.

### What is missing

There is **no authorization path for a remote actor**. Nothing in the codebase
answers "may `alice@other-node` do X here?" — because nothing remote can hold a
right in the first place. Communities introduces that question for the first
time, and with it the whole class of federated authorization bugs.

---

## 4. Federation protocol

**Push-only, opt-in, no discovery, by design.** There is no join, subscribe or
request path; a receiving node cannot ask for a wave. (This is why v2.83.0 had
to add an explicit re-broadcast action — a port allied *after* a wave was
promoted never received it, and nothing could fix it from either side.)

Endpoints:

| Route | Auth |
| --- | --- |
| `GET /api/federation/identity` | public — node's public key |
| `POST /api/federation/inbox/request` | bootstrap trust, signature with supplied key |
| `POST /api/federation/inbox/accept` \| `/decline` | `['active','outbound_pending']` |
| `POST /api/federation/inbox` | active nodes |
| `POST /api/federation/wave-backfill` | active nodes |
| `GET /api/federation/users/:handle` | active nodes |
| `POST /api/federation/cross-port/exchange` | active nodes |

Tables: `federation_nodes`, `federation_requests`, `wave_federation`,
`remote_users`, `remote_pings`, `federation_queue`, `federation_inbox_log`.

Envelope: `createFederationEnvelope(id, type, payload)` (:16892), padded by
`padFederationPayload` (:16899). Delivery is queued (`processFederationQueue`,
:23070; `queueFederationDelivery`, :23120).

### The shape of a federated wave

`buildWaveBroadcastPayload` (:19877) sends wave metadata, local participants,
and the newest `BROADCAST_PING_LIMIT` (1000) pings. `wave_federation` is
`(wave_id, node_name)` — **a wave is shared with a node, not with people**.
`remote_pings` stores `author_id` + `author_node` as attribution strings.

v2.83.1 established the precedent that matters most for Communities: settings
which govern who may write (`post_policy`, `allow_replies`, `allow_reactions`)
**must travel with the object**, and the origin is authoritative — a re-broadcast
repairs a copy that arrived before the fix. That is a small, working version of
the replicated-state model Communities needs.

---

## 5. Encryption boundary

Per-wave AES-256-GCM content key, wrapped for each member via ECDH P-384,
stored in `wave_encryption_keys` — whose `user_id` **references `users(id)`**.

**A remote identity cannot hold a wave key.** An encrypted wave therefore cannot
be read by anyone on an allied node; federation carries content that the server
can see.

Separately, several categories of metadata are encrypted at rest with
server-held keys so that a database dump does not yield a social graph:
`wave_participants_encrypted`, `crew_members_encrypted`,
`push_subscriptions_encrypted`, `wave_roles_encrypted`, follower emails.

This gives Communities its confidentiality split for free, and it matches the
brief's §21: **membership and authorization state must be readable by the node
(to enforce anything at all); message content need not be.**

---

## 6. Data layer

- `better-sqlite3`, one `DatabaseSQLite` class (~12k lines), synchronous
- `applySchemaUpdates()` runs **guarded migrations at every boot**; fresh installs
  can also be built from `server/schema.sql`
- **`server/schema.sql` is GENERATED** — `node tools/generate-schema.mjs`, with
  `--check` in CI verifying fresh and migrated converge

Two traps found the hard way in the last month, both of which Communities will
hit given its table count:

1. **A guarded `CREATE TABLE` does not gain columns.** Adding a column to a
   `if (!tableExists) CREATE TABLE ...` block does nothing for any database that
   already has the table. Added columns need their own explicit `ALTER`.
2. **`generate-schema --check` compares object *counts*.** A missing column does
   not change the count, so the check passes. It caught nothing in (1).

---

## 7. Realtime

`ws` server; `clients` is a Map of userId → socket set; `broadcastToWave(waveId, message, excludeWs)` (:22885) and `broadcastToWaveWithPush`. Auth over the socket returns `serverVersion`, which drives the client's upgrade banner.

Both directions run liveness checks: the server pings every 30s and terminates
dead sockets; since v2.87.1 the client treats an unanswered pong as a dead
socket and reconnects, and probes on resume.

---

## 8. API conventions

- Client routes under `/api/...`, `authenticateToken`, `sanitizeInput` on input
- Public, unauthenticated surfaces under `/api/public/*`
- Federation under `/api/federation/*`, node-authenticated, **separate from client APIs** (the brief's §26 requirement is already the house style)
- Rate limiters per surface (`publicRsvpLimiter`, `federationInboxLimiter`, `loginLimiter`, …) plus a `consumeRateLimit(key, n, windowMs)` helper for per-subject ceilings
- **Uniform responses on probing surfaces**: unknown slug, not-in-portal and
  feature-disabled all return an identical 404 so the endpoint cannot enumerate;
  the follower sign-up answers identically whether an address is new or known

---

## 9. Tests and CI

114 tests, `npm test` → `node --test tests/*.test.cjs`.

The established pattern for anything non-trivial is a **disposable server**:
copy `server/` to a temp dir, symlink `node_modules`, fresh SQLite, `PORT=0`,
spawn the real server, drive it over HTTP/WS. See `tests/media-security.test.cjs`,
`tests/wave-roles.test.cjs`, `tests/event-attendance.test.cjs`,
`tests/followers.test.cjs`.

CI (`.github/workflows/ci.yml`) runs on PRs to and pushes on develop/qa/master:
tests + `generate-schema --check`; client build + a service-worker stamp
assertion; `npm audit --audit-level=moderate` on both trees; and a git-history
secret scan with `fetch-depth: 0`.

---

## 10. Summary — reuse, extend, build

| Communities needs | Status |
| --- | --- |
| User authentication | **Reuse unchanged** |
| Node authentication, signing, replay defence | **Reuse**; harden per threat model §2 |
| Messaging/channel content | **Reuse** the ping engine — do not build a second one |
| E2EE | **Reuse**; accept that it is local-only today |
| Realtime delivery | **Reuse** `broadcastToWave` shape |
| Metadata-encrypted-at-rest pattern | **Reuse** for membership/roles |
| Capability-based authorization | **Build** — only role ladders exist |
| Cross-node identity that can hold rights | **Build** — nothing like it exists |
| Replicated, versioned object state | **Extend** — v2.83.1 is a minimal precedent |
| Authorization of remote actors | **Build** — no such path exists |
| Audit log | **Build** — `logActivity` exists but is not append-only or federated |
