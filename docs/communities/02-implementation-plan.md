# Communities — implementation plan

Phase 0 output, 2026-09-18. Proposed build mapped onto real Cortex modules.
**Nothing here is built. This document is the thing to argue with before code
exists.**

---

## 1. Where this disagrees with the brief

Four places. Each is a recommendation, not a decision.

### 1.1 Fix federation signing first, as its own release

Threat model **F-1** is verified and affects federation as it ships today: a
signed request omitting `Date` bypasses the 5-minute replay window because
`NaN > 5` is false. Communities would be built on top of that.

**Recommendation: a small release before Phase 1** — require a minimum signed
header set, reject an unparseable `Date`, require `Digest` when a body exists.
Perhaps 30 lines and a test file. Doing it inside Phase 4 buries a live fix
behind months of feature work.

### 1.2 Phase 3 "local Communities" cannot validate the hard part

The brief has Phase 3 build Communities for users on one node, then add
federation in Phase 4. That validates the domain model — worth having — but the
genuinely difficult work is **authorization of actors with no local account**,
and a single-node phase exercises none of it.

**Recommendation:** keep Phase 3, but treat it as *domain model validation only*
and explicitly do not let it set the shape of the authorization API. Write
`authorize()` from the start to take an actor that **may be remote**, even while
every caller in Phase 3 passes a local one. Otherwise Phase 4 rewrites it.

### 1.3 The three-node lab belongs in Phase 4, not Phase 7

Two nodes hide symmetry assumptions; the brief says so in §33 and then schedules
the lab at deployment. Several failure classes — split state, a node that is
behind, a peer that disappears — cannot be tested with two.

**Recommendation:** stand up the three-node harness *as the Phase 4 deliverable*,
in the existing disposable-server style (three servers, three temp SQLites,
`PORT=0`). Cortex already spawns real servers in tests; three is not much harder
than one.

### 1.4 Say plainly that Community channels are not E2EE in V1

`wave_encryption_keys.user_id` references `users(id)`, so a remote member cannot
hold a content key. Cross-node E2EE needs new key distribution, which is its own
project.

**Recommendation:** V1 Community channels are explicitly **not** end-to-end
encrypted, stated in the UI. Preserve the metadata/content split so it can be
added later. A channel that appears encrypted but is readable by every
participating node's operator is worse than one that admits it is not.

---

## 2. The identity problem, concretely

Communities requires a subject that can hold rights and may be remote. Three
options:

**(a) Extend `users` with remote rows.** Cheapest to write, worst to live with:
every existing query that assumes `users` means "people with accounts here"
becomes subtly wrong, including authentication.

**(b) A separate `community_actors` table**, one row per (community, identity),
where identity is `local_user_id` *or* `handle@node`. Contained, but membership
tables then join to a Community-scoped identity, and cross-Community identity
correlation gets awkward.

**(c) A node-wide `federated_identities` table** — one row per `handle@node`
ever seen, referenced by Community membership. Remote-only; local users continue
to use `users(id)`.

**Recommendation: (c)**, with membership carrying a nullable `user_id` *and* a
nullable `federated_identity_id`, exactly one non-null. It keeps local
authentication untouched, gives remote identities a stable primary key for
membership and roles, and leaves room for key material later.

This is the single biggest design decision in the project and the main thing to
push back on before Phase 1.

---

## 3. Proposed module layout

Following existing conventions: extracted modules under `server/lib/`, routes in
`server/server.js`, one DB class.

```
server/lib/communities/
  authorize.js        the single evaluator — actor may be local or remote
  capabilities.js     capability constants + role defaults
  state.js            canonical state, versioning, snapshot/diff
  events.js           envelope build/parse/validate, schema + limits
  federation.js       outbound send, inbound validate, peer set
  invites.js          token mint/hash/redeem (atomic)
  audit.js            append-only log
```

Reused unchanged: `authenticateToken`, `requireStepUp`, `sanitizeInput`, the
rate limiters, `createFederationAuthMiddleware`, `createFederationEnvelope`,
`federation_inbox_log`, `broadcastToWave`'s delivery shape, the ping engine for
channel messages, `encryptEmail`-style at-rest encryption for membership.

**One canonical evaluator.** The brief's §10 warning is well-founded — Cortex has
lost real time to duplicated logic (the wave row menu existing twice in v2.84.1,
notification defaults in three places in v2.66.0). No controller may compute
permissions inline.

---

## 4. Schema sketch

Tables per the brief's §27. Delete policies stated deliberately, per its warning
about ORM defaults — though note Cortex uses no ORM, so every FK is written by hand:

| Table | Notes |
| --- | --- |
| `communities` | `id` opaque; `state_version` from V1; `home_node`; `status` |
| `federated_identities` | `handle@node` → stable id (§2 option c) |
| `community_memberships` | exactly one of `user_id` / `federated_identity_id`; `state`; `version` |
| `community_roles` | `priority`, `permissions` (capability list), `managed` |
| `community_membership_roles` | join table |
| `community_channels` | `type` ∈ TEXT, ANNOUNCEMENT for V1 |
| `community_channel_permissions` | schema present, evaluator support deferred |
| `community_invites` | **hash only**, `max_uses`, `use_count`, `expires_at`, `revoked_at` |
| `community_bans` | survives membership deletion — a ban that vanishes with the row is not a ban |
| `community_events` | append-only, `sequence`, `state_version`, dedupe key |
| `community_federation_nodes` | participating peers per Community |
| `community_audit_log` | append-only; metadata only, never secrets |

Delete policy: `CASCADE` from `communities` to its own children; **`RESTRICT` on
`community_bans`**; `SET NULL` for `invited_by` / `created_by` so a departing
user does not erase history. Membership is **soft-deleted** via `state = LEFT`
because federation and audit both need the row to persist.

Migration mechanics follow the house rules in
[00-existing-architecture.md](00-existing-architecture.md) §6 — including that a
guarded `CREATE TABLE` does not gain later columns, and that
`generate-schema --check` compares object counts and will not catch a missing
one.

---

## 5. Phases

Phase numbering follows the brief. Each gate is human review.

| Phase | Deliverable | Gate |
| --- | --- | --- |
| **0** | *This document set* | **← we are here** |
| **0.5** | *Proposed:* F-1 federation signing fix, released on its own | Tests; normal release train |
| **1** | Domain model + migrations + unit tests. No federation, no routes. | Schema check; full suite |
| **2** | `authorize()` and capabilities. Actor type accommodates remote from day one. | The full authorization matrix from brief §29, including `remote user` |
| **3** | Local Communities end to end: create, invite, join, leave, roles, channels, messages, moderation | Suite; **explicitly not** a licence to shape the API around local-only |
| **4** | Federation: resolution, state sync, remote membership, signed events, remote authorization, federated channel messaging — **plus the three-node harness** | Three-node integration tests including the chaos list, brief §30 |
| **5** | Abuse and limits: rate limits, payload caps, replay/dedupe, audit log, malformed-event rejection, TOCTOU (brief §31) | Security test suite |
| **6** | UI | Backend stable first |
| **7** | Hardening only: fuzz, load, federation failure, migration, backward compatibility | Then Codex |

### Definition of done

The brief's §37 list, unchanged, with the one amendment from §1.4 above:
Community channels in V1 are not E2EE and say so.

---

## 6. What I would want decided before Phase 1

1. **Identity model** — §2 above. Everything downstream depends on it.
2. **Whether 0.5 happens first.** My recommendation is yes.
3. **Whether Communities and waves converge or coexist.** A Community channel and
   a wave are close cousins. Reusing the ping engine for content is settled; what
   is *not* settled is whether a Community channel eventually **is** a wave with
   a community id, or stays a separate object. Deciding late means a migration.
4. **How much state a non-member node may hold.** "Only participating nodes
   receive private Community state" (brief §13) needs a precise definition of
   participating — is a node with one member a full state replica?
5. **Ban scope across Communities.** Brief §18 separates Community ban, node
   block and identity block. Worth confirming a Community ban is per-Community
   only, with no cross-Community propagation, in V1.

---

## 7. Honest estimate of scale

For calibration against recent work: per-wave roles (v2.88.0) — one table, one
evaluator, one UI surface, no federation — took roughly a day including tests and
review, and still shipped with a bug where the third of three field-mapping sites
was missed.

Communities V1 as specified is **eleven tables, a capability system, a
replicated state machine with versioning, a federation protocol extension, a new
identity concept, an audit log and a UI**. Phases 1–3 are tractable. **Phase 4 is
the project** — everything genuinely hard lives there, and it is where a rushed
schedule would produce exactly the class of bug the Codex audit is meant to find.

The phase gates are the right instinct. I would not compress them.
