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

### 1.3 The three-node lab belongs in Phase 4, not Phase 7 — *largely moot after §2*

Two nodes hide symmetry assumptions; the brief says so in §33 and then schedules
the lab at deployment. Several failure classes — split state, a node that is
behind, a peer that disappears — cannot be tested with two.

**Recommendation:** stand up the harness *as the Phase 4 deliverable*, in the
existing disposable-server style. **Amended 2026-09-18:** with a single
authoritative node per Community (§2), the third node buys much less — most of
what it would have caught was replication disagreement, which no longer exists.
Two nodes is the sensible V1 harness; revisit if Communities ever replicate.

### 1.4 E2EE — *corrected 2026-09-18*

The original claim here was that a remote member cannot hold a content key,
because `wave_encryption_keys.user_id` references `users(id)`. **That is true of
`remote_users` under wave federation, and false under the architecture in §2:** a
cross-port member *is* a local `users` row, so nothing structural stops them
holding wave keys.

What remains true is that they will not have any **until E2EE is set up for that
session on that node** — keys are generated client-side. The live cross-port user
on PMP holds none.

**Recommendation:** treat Community channel encryption as exactly the same
question as wave encryption, because a channel is a wave (§6.3). Decide in Phase
3 whether a cross-port session performs E2EE setup; do not claim encryption in
the UI that a given member's session cannot actually provide.

---

## 2. Identity — DECIDED 2026-09-18

**Decision: reuse cross-port auth. No new identity table in V1.**

This supersedes the three options originally proposed here, and supersedes the
recommendation that went with them. Recording the reasoning because the
superseded version was wrong for a specific and instructive reason.

### What was originally proposed

Three ways to give Communities a subject that can hold rights and may be remote:
(a) remote rows in `users`, (b) a per-Community `community_actors` table,
(c) a node-wide `federated_identities` table — recommended.

### Why that was the wrong question

All three assumed a Community **replicated across nodes**, where a node must
reason about an identity it does not host. Jared's model is different and
simpler:

> A Community lives on one node. Its **members** may come from other nodes.
> "I could invite jempson@pmp to the gaming community on cortex.farhold."

For that, Cortex already has the mechanism — **cross-port auth, v2.56.0** —
and it is in production use today.

### How it actually works

`POST /api/cross-port/initiate` → redirect to the home node →
`POST /api/cross-port/approve` (user authenticates **at home**) → single-use code
→ `POST /api/federation/cross-port/exchange` (server-to-server, RSA HTTP
signatures, the same path hardened in v2.93.1) → `POST /api/cross-port/session`.

The guest node ends up with a **cross-port stub user**: an ordinary `users` row
with `is_cross_port = 1`, `home_node`, `home_user_id`. Handle collisions take a
`_<shortnode>` suffix.

**That row is a local user for every purpose.** Membership, roles, channel
participation, encryption keys and audit all reference `users(id)` and need no
new identity concept. Verified in production: PMP holds one cross-port user
(`oldwulf`, home node farhold) which already participates in a wave.

### What this costs, stated plainly

- **Mutual federation is required** — both nodes must list each other `active`.
  Members can be invited from allied ports, not from the federation at large.
- **Cross-port sessions are 24h, non-renewable** (ordinary sessions are 7d
  renewable). A remote member re-authenticates daily. If that proves annoying in
  practice it is a session-policy change, not an architecture change.
- Cross-port users cannot themselves grant cross-port access.
- A stub user is a real row in `users`, so it appears anywhere users are
  enumerated. Admin surfaces and user search should be checked for leakage
  during Phase 1 rather than after.

### Consequences for the rest of the plan

- **No `federated_identities` table.** Membership references `users(id)`.
- **No replicated state machine.** One Community, one authoritative node.
  State versioning conflicts, split-brain and cross-node TOCTOU (threat model
  A-2) stop being V1 problems — see §5.
- **Migration** is an authority handoff: the Community admin requests, the
  receiving node's admin accepts. Still V2/V3, but the schema must not derive
  Community identity from hostname or local row id, per the brief's §25.

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
| **4** | Remote membership via cross-port: invite an identity from an allied node, join, hold roles, post in channels. **No state replication** (see §2) — the work is authorization and lifecycle for stub users, not consensus. Two-node harness suffices; a third adds little once there is a single authority. | Integration tests across two nodes, plus the relevant chaos cases from brief §30 |
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
3. ~~Whether Communities and waves converge~~ — **DECIDED**: a Community channel
   **is a wave** carrying a community id, and a sub-conversation within a channel
   is a **threaded ping**. This is the largest simplification available: channels
   inherit privacy, E2EE, pings, threads, pins, reactions and the realtime
   delivery path unchanged. Phase 1 must reconcile `wave_participants` against
   Community membership — the likely rule being that membership *drives*
   participation rather than duplicating it.
4. ~~How much state a non-member node may hold~~ — **DISSOLVED** by §2. With one
   authoritative node per Community there is no replica to scope.
5. ~~Ban scope~~ — **DECIDED**: per-Community, with escalation to a node or
   verse-wide ban where warranted. Both already exist separately
   (`federation_nodes.status`, user blocking) and must stay distinct per brief §18;
   escalation is an admin action, never an automatic consequence.

---

## 6a. Prerequisites for production — not for Phase 1

Recorded 2026-09-18 so they are not rediscovered at deployment.

### P-1 — cross-port sessions are 24h and non-renewable **[blocking full production]**

Jared, on reviewing this plan: *"I would want to fix the 24-hour non-renewable
sessions issue before fully deploying to production."*

Ordinary Cortex sessions are a 60-minute rotating access token over a 90-day
sliding refresh session (v2.75.0). **Cross-port sessions are neither** — 24 hours,
no renewal — which was a reasonable conservatism when cross-port meant an
occasional visit, and is the wrong shape when it is how a Community member
attends every week.

The effect is that a remote member re-runs the full approve-at-home redirect
daily, on a flow with more steps than a login.

This is a **session-policy change, not an architecture change**, and it can be
done independently of Communities:

- decide the lifetime deliberately rather than inheriting 24h — the v2.75.0
  argument applies here too, that forced re-authentication mostly punishes the
  people the feature exists for;
- consider a refresh path for cross-port sessions with reuse detection, as
  local sessions already have;
- keep the home node authoritative — a renewal must not outlive the member's
  standing at home, which is the reason the short lifetime was chosen and must
  not simply be discarded;
- and consider whether the operator should be able to set it, since
  `instance_config.security` already carries the local policy.

**Gate: do not open Communities to production traffic until this is settled.**
Phase 1 to 3 are unaffected — they involve no cross-port members.

### P-2 — stub-user leakage audit

A cross-port stub user is an ordinary `users` row and therefore appears anywhere
users are enumerated: search, admin lists, mention autocomplete, member pickers.
Audit before production, not after.

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
