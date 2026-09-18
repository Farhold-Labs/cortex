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

**Recommendation:** treat Community encryption as exactly the same question as
wave encryption — under §2b it *is* the same question, because the waves inside a
channel are ordinary waves and keep their own keys. A channel may therefore
contain encrypted waves in V1 with no new cryptography at all; what V1 does not
get is an encrypted *channel-wide* stream, which was never a separate thing once
channels became containers. Decide in Phase 3 whether a cross-port session
performs E2EE setup, and do not claim encryption in the UI that a given member's
session cannot actually provide.

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
  *Amended by §2b — it is a content migration as well as an authority handoff.*

## 2b. Structure — DECIDED 2026-09-18

**Supersedes §6.3**, which had a Community channel *be* a wave. The superseded
reasoning is left in place below for the same reason as §2: why it was wrong is
the useful part.

### The model

```
Community
└── Channel            container — organises waves, is not itself a conversation
    └── Wave           the conversation, unchanged from what Cortex has today
        └── Ping
            └── threaded pings
```

A channel **holds** waves. It does not replace them.

### Why this beat channel-as-wave

**1. It removes the migration hazard.** Under channel-as-wave, moving an
existing wave into a Community flipped its access authority from
`wave_participants` to Community membership — a four-person private wave joining
a forty-member Community would disclose its entire history to thirty-six people,
irreversibly. Under containers the wave keeps its own participant list and
privacy and merely gains a `channel_id`. Migration in becomes a label change:
safe, and reversible.

It also disarms the two awkward populations measured on farhold — **12 encrypted
waves** (no re-keying required, because the key holders do not change) and **14
crew-owned waves** (no collision between crew and Community membership, because
crew membership still governs the wave).

And it dissolves the problem in the other direction. Under channel-as-wave,
moving a wave *out* had no defensible default, because a channel has no
participant list of its own — "everyone in the Community", "everyone who posted"
and "staff only" were all wrong in different ways. Under containers the wave
already has its participants, so leaving is clearing `channel_id` and nobody's
access changes. **Both directions are in scope for V1**, which was not true of
the superseded model.

**2. Waves keep their meaning.** No redefinition of the object every user already
understands, and no pressure on threaded pings to carry sub-conversation load
they were not built for.

**3. It matches how the nodes are actually used.** A theatre node wants a
*Productions* channel holding a wave per production. Under channel-as-wave that
is a channel per production, and the rail becomes unusable within a season.
Containers give a handful of stable channels with waves flowing through them.

**4. Cortex already has the concept.** `wave_categories` +
`wave_category_assignments` (`server/schema.sql:134`) are exactly "a thing that
organises waves." They are **per-user** (`user_id NOT NULL`,
`UNIQUE(user_id, name)`). A channel is the same idea made **shared and
container-scoped**. This is a promotion of an existing level, not a new one.

### The cost, stated plainly

Three authorization layers instead of two: Community membership → channel
visibility → wave privacy and participants. Without one clear rule this becomes
a permanent bug source. The rule:

> **Channel visibility gates discovery. Wave privacy gates content.**

You must be able to see the channel to find the waves listed in it; whether you
may *open* a given wave still follows today's wave rules, unchanged. A private
wave inside a public channel stays private and is simply not listed for
non-participants.

**One wrinkle to write into the schema comment**, because someone will otherwise
assume the other thing: a wave marked `public` *inside a Community* means
visible to Community members, not to the internet. `privacy` is read relative to
its container.

Secondary costs, both accepted: navigation is four levels deep
(community → channel → wave → thread), which needs care on mobile; and posting
always requires a wave to exist first — which is how Cortex already works, so it
should read as native rather than as friction.

### Containers are nullable, and that is permanent

Every one of the 44 waves across both production nodes today belongs to no
Community. Both `community_id` and `channel_id` are nullable on waves, and
uncontained waves are the **normal case indefinitely** — not a migration
backlog to be drained.

Framing that collapses this to one model: **the node behaves as an implicit
Community that everyone on it belongs to**, in which only admins may create
channels. The rail renders the node at the top and Communities beneath it.

**Do not insert a literal "node Community" row.** `community_id IS NULL` *means*
node-level. A real row invites questions with no good answers — can you leave
it, who owns it, does it federate. Channels take a nullable `community_id` on
the same basis, so a channel belongs either to a Community or to the node.

### Who may create what

| Action | Who |
| --- | --- |
| Create a **Community** | anyone |
| **Import** a Community from another node | node admin, at the Community owner's request |
| Create a **node-level channel** | node admin |
| Create a **node-level public wave** | node admin |
| Create a private or crew wave | anyone — no container, unchanged, forever |
| Profile wave | automatic, per user; exempt |
| Create a wave inside a Community channel | per Community role |

Forcing DMs and crew waves into a Community would be actively wrong: it would
give Community staff a structural claim over private conversations between two
people, which is the opposite of what Cortex is for. The restriction is on
**discoverable** things, not on waves.

Gating node-level public waves costs nothing today. Measured on farhold
2026-09-18: all six node-wide public waves were created by an admin already; the
only two created by a non-admin are auto-created profile waves, which the table
exempts. The gate formalises existing practice and grandfathers nothing.

Because anyone may create a Community, Community creation is the relief valve
that makes admin-only node channels tolerable — a member who wants a space makes
one rather than queueing for an admin. Two consequences to handle in Phase 5
rather than Phase 1: a **per-user creation cap**, and a node-admin power to
**suspend or delete** a Community, since open creation is an abuse surface.

### Community visibility

Three values, not two. `PRIVATE` and `PUBLIC` are what was asked for; `UNLISTED`
is included because it costs nothing at schema time and is unpleasant to
retrofit once real Communities exist.

| Value | Discoverable in search | Joinable |
| --- | --- | --- |
| `PUBLIC` | yes | per join policy |
| `UNLISTED` | no | by link or invite |
| `PRIVATE` | no | invite only |

The UI may expose only two at first. The column should hold three.

### Correction to §2: import is not only an authority handoff

§2 describes migration as an authority handoff. With waves living inside
channels, a Community's *content* is waves and pings stored on its home node —
so handing over authority without the data leaves the conversations behind.
Importing a Community means **moving waves, pings, attachments and reactions
across nodes**, which Cortex has never done: federation replicates, it does not
hand over.

That does not change any decision here. It does mean import is substantially
more work than the admin-approval handshake makes it sound, and it belongs in
V2/V3 with that understood rather than discovered.

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
| ~~`federated_identities`~~ | **Not built** — §2 dissolved it. A remote member is a local `users` row via cross-port auth. |
| `community_memberships` | `user_id` only, per §2. `state` (soft-delete via `left`/`removed`); `version` |
| `community_roles` | `priority`, `permissions` (capability list), `managed` |
| `community_membership_roles` | join table |
| `communities` (cont.) | `visibility` ∈ `PUBLIC` / `UNLISTED` / `PRIVATE` — §2b |
| `channels` | container for waves, **not** a wave. `community_id` **nullable** — `NULL` means node-level (§2b). `type` ∈ TEXT, ANNOUNCEMENT for V1 |
| `channel_permissions` | schema present, evaluator support deferred |
| `waves` (existing) | gains nullable `community_id` and `channel_id`. Uncontained is the normal case, permanently — all 44 waves in production today are uncontained |
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
| **0** | *This document set* | **✅ DONE — on master** |
| **0.5** | F-1 federation signing fix, released on its own | **✅ DONE — shipped as v2.93.1** |
| **1** | Domain model + migrations + unit tests. No federation, no routes. | Schema check; full suite — **✅ DELIVERED v2.94.0**, 23 model tests, suite 123 → 146 |
| **2** | `authorize()`. Capability constants and built-in roles already exist from Phase 1 (`lib/communities/capabilities.js`); this phase adds the evaluator. Actor type accommodates remote from day one. | The full authorization matrix from brief §29, including `remote user` |
| **3** | Local Communities end to end: create, invite, join, leave, roles, channels, messages, moderation | Suite; **explicitly not** a licence to shape the API around local-only |
| **4** | Remote membership via cross-port: invite an identity from an allied node, join, hold roles, post in channels. **No state replication** (see §2) — the work is authorization and lifecycle for stub users, not consensus. Two-node harness suffices; a third adds little once there is a single authority. | Integration tests across two nodes, plus the relevant chaos cases from brief §30 |
| **5** | Abuse and limits: rate limits, payload caps, replay/dedupe, audit log, malformed-event rejection, TOCTOU (brief §31) | Security test suite |
| **6** | UI | Backend stable first |
| **7** | Hardening only: fuzz, load, federation failure, migration, backward compatibility | Then Codex |

### Definition of done

The brief's §37 list, unchanged, with the one amendment from §1.4 above: a
channel is a container, so encryption is a per-wave property inside it, and the
UI must not claim more than a given member's session can provide.

---

## 6. What I would want decided before Phase 1

1. **Identity model** — §2 above. Everything downstream depends on it.
2. **Whether 0.5 happens first.** My recommendation is yes.
3. ~~Whether Communities and waves converge~~ — **DECIDED, then revised. See §2b.**
   The first answer was that a channel *is* a wave. It was replaced on the same
   day by the container model: **a channel holds waves**, and a wave keeps its own
   participants, privacy and encryption. The reason for the change is the one that
   matters — channel-as-wave made every migration a mass disclosure, because the
   wave's access authority flipped to Community membership at the moment it moved.
   Containers keep `wave_participants` authoritative, so there is nothing to
   reconcile against membership.
4. ~~How much state a non-member node may hold~~ — **DISSOLVED** by §2. With one
   authoritative node per Community there is no replica to scope.
5. ~~Ban scope~~ — **DECIDED**: per-Community, with escalation to a node or
   verse-wide ban where warranted. Both already exist separately
   (`federation_nodes.status`, user blocking) and must stay distinct per brief §18;
   escalation is an admin action, never an automatic consequence.

---

## 6a. Prerequisites for production — not for Phase 1

Recorded 2026-09-18 so they are not rediscovered at deployment.

### P-1 — cross-port sessions are 24h and non-renewable **[ACCEPTED LIMITATION 2026-09-18]**

Jared, on reviewing this plan: *"I would want to fix the 24-hour non-renewable
sessions issue before fully deploying to production."* **Revised the same day**,
once the cost of fixing it properly was understood: *"acceptable limitation at
this time."* Phase 1 proceeds with it in place.

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

### Why this is a limitation and not a gap

The distinction matters, and it is the reason the gate was lifted.

**The current behaviour fails closed.** A 24-hour non-renewable session cannot
outlive the member's standing at home by more than a day, because it cannot be
extended at all. What it costs is convenience: a remote member re-runs the full
approve-at-home redirect daily, on a flow with more steps than a login.

**The obvious fix would open a real gap.** `POST /api/cross-port/session`
(`server/server.js:14375`) hand-rolls its own token rather than calling
`issueAuthCredentials` — the same bypass class as the v2.81.2 bug recorded in
CLAUDE.md. Routing it through `issueAuthCredentials` with `supportsRefresh` is a
one-line change and would grant a **90-day sliding session** to a user whose home
node may ban or delete them on day two, with nothing on this side to notice. That
trades a daily annoyance for a months-long stale credential.

**So a correct fix needs home-node revalidation on refresh** — a federation
endpoint that answers "is this identity still in good standing", plus a
cross-port branch in the refresh path that calls it and revokes the family when
the answer is no. That is federation work, which is why it does not belong in
Phase 1 ("domain model + migrations + unit tests. No federation, no routes"), and
why it is not a one-liner.

**When it actually bites: Phase 4.** Phases 1–3 are local-only and involve no
cross-port members at all, so nothing is blocked and nothing accrues. The natural
point to settle it is when remote membership becomes real — either as its own
small release, the way the F-1 signing fix was handled, or as a named piece of
Phase 4.

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
