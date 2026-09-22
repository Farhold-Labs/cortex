# Communities — threat model

Phase 0, 2026-09-18. Scope: what a federated Communities layer would be exposed
to, what the current stack already defends, and what it does not.

Findings marked **[verified]** were reproduced against the code. Findings marked
**[design gap]** describe something that does not exist yet rather than something
that is broken.

---

## 0. Architecture this assumes

Updated 2026-09-18 after the decisions in implementation plan §2. A Community
**lives on one node**; its members may hold accounts elsewhere and arrive via
cross-port auth as local stub users. There is no replicated Community state.

That removes several threat classes outright (split-brain, replication
disagreement, cross-node TOCTOU) and sharpens what remains: the trust boundary
is **the cross-port exchange and the node signature behind it**, not a consensus
protocol.

## 1. Adversaries

| | Capability |
| --- | --- |
| **Anonymous internet** | Can reach `/api/public/*` and `/api/federation/identity`. Cannot pass node auth. |
| **Local member** | Authenticated on this node. Holds whatever roles they were given. The privilege-escalation adversary. |
| **Remote member** | Authenticated on *their* node, a member of a shared Community. **We never see their credentials** — we see their node's assertion about them. |
| **Malicious allied node** | Holds a valid federation keypair and `active` status. Can sign anything — **including asserting that any handle on it just authenticated**, since cross-port codes are minted by the home node. Mutual federation is therefore a real trust decision, not a routing detail. **The primary Communities adversary.** |
| **Compromised-then-revoked node** | Was allied, holds captured traffic, has since been suspended. |
| **Buggy peer** | Not hostile; sends duplicates, reordering, stale state, malformed payloads. Must fail safely. |
| **Network attacker** | Between nodes. Largely handled by TLS; signatures are defence in depth. |

The brief's second invariant is the right frame: *a node is not trusted because
it federates.* Today Cortex has no Community state for a node to lie about, so
this adversary is mostly theoretical. Communities makes it real.

---

## 2. Existing federation defences, assessed

### What holds up

- **Public key comes from the node record**, not from the request's `keyId`. No key-confusion.
- **Algorithm is hard-coded** to RSA-SHA256, not taken from the header. No algorithm-confusion / `none` downgrade.
- **Digest is recomputed and compared** to the body when present (:16849).
- **5-minute `Date` window** bounds replay (:16863).
- **`federation_inbox_log` dedupes by message id** before processing (`database-sqlite.js:8911`).
- Unknown node → 403; non-`active` status → 403; missing key → 403.

That is a better starting position than most federated projects have.

### F-1 — the signed-header set is sender-chosen **[verified]**

`verifyHttpSignature` (:16777) rebuilds the signing string from
`signatureParts.headers` — a value inside the `Signature` header the sender
controls. It does not require any minimum set.

A sender that signs only `(request-target)` produces a request with no `Date`
header. The freshness check then does:

```js
const requestDate = new Date(undefined);          // Invalid Date
const diffMinutes = Math.abs(now - requestDate) / 60000;   // NaN
if (diffMinutes > 5) { reject }                    // NaN > 5 === false → PASSES
```

Reproduced: `diffMinutes = NaN`, `NaN > 5 === false`. **A signed request that
omits `Date` bypasses the replay window entirely.**

Likewise, `Digest` is only checked *if the header is present*, so a request
signed without it has an unauthenticated body.

Forgery is still not possible — the signature must verify over the reconstructed
string, and the attacker has no private key. The exposure is:

- **indefinite replay** of a captured request from an allied node, limited only
  by the inbox-log dedupe (which covers enveloped messages carrying an id, not
  necessarily every route), and
- a **compromised-then-revoked** node's captured traffic staying replayable.

*Fix, before Communities rides on this:* require a minimum signed set —
`(request-target)`, `host`, `date`, plus `digest` whenever a body is present —
and reject a request whose `Date` fails to parse rather than letting `NaN`
through. Small, self-contained, and testable today.

### F-2 — no per-request nonce beyond the message id **[design gap]**

Replay defence rests on the envelope id landing in `federation_inbox_log`. Any
Communities route that does not carry an enveloped id inherits only the date
window — which F-1 can defeat. Communities events must **always** be enveloped
and always dedupe.

---

## 3. Authorization

### A-1 — no authorization path for remote actors exists **[ADDRESSED v2.95.0]**

Every authorization helper takes a local `userId` and consults local tables.
Communities is the first feature where the *actor may not exist locally*.

The brief's §8 chain is the correct target, and none of it is currently built:

```
authenticate node → verify signature → verify event → resolve actor
   → verify current community state → evaluate capability → accept/reject
```

Risk if rushed: a receiving node accepts "Alice banned Bob" because the envelope
is well-signed by Alice's node, without checking that Alice held `member.ban` in
*this node's* view of Community state. That is trusting the peer's conclusion
instead of verifying its premises.

**Addressed in v2.95.0.** `lib/communities/authorize.js` takes an actor of kind
`user` or `federated`. A federated actor is resolved against the cross-port stub
rows by `(home_node, home_user_id)` — never by handle alone, since handles
collide across nodes — and is **denied outright if no local row exists**. Holding
a local row is then still not membership, and membership is still not capability.
Each of those three steps has its own test, as does the case of a peer claiming a
purely local account.

### A-2 — TOCTOU on stale authority **[design gap — largely dissolved 2026-09-18]**

**With a single authoritative node per Community (implementation plan §2), there
is no second node evaluating authority against its own copy of state, and this
class mostly disappears.** It returns the moment Communities replicate, so the
requirement below is recorded for whenever that happens rather than deleted.

The brief's §31 case, which has no existing machinery at all:

```
12:00  Alice is ADMIN
12:01  Alice is demoted
12:02  event arrives: "Alice banned Bob", timestamp 11:59
```

Timestamps are attacker-controlled and clocks disagree; a 5-minute window does
not resolve this. Authorization must be evaluated against a **state version the
event commits to**, not against wall-clock time.

*Design requirement:* every Community mutation carries `expected_state_version`.
On mismatch, **reject or defer and resynchronise** — never merge
security-sensitive state silently. Detecting a conflict and refusing is an
acceptable V1; guessing is not.

### A-3 — privilege escalation within a Community **[ADDRESSED v2.95.0]**

Classic, and entirely on us to prevent:

- member grants themselves a role
- admin grants themselves owner
- invite carries an administrative role
- role priority inversion — a moderator edits the admin role's permissions
- last owner leaves, Community becomes unadministrable

*Requirements:* one canonical evaluator; a rule that **you cannot grant a
capability you do not hold**; role priority compared on assignment and on role
edit; invites forbidden from conferring OWNER/ADMIN (brief §17); the
`>= 1 owner` invariant enforced in the same transaction as the mutation.

**Addressed in v2.95.0**, each as a named function rather than left to callers:
`canGrantRole` (unheld capabilities and priority), `canEditRole` (inversion, and
managed roles immutable), `canActOnMember` (strictly greater priority — equal is
refused, so two admins cannot remove each other), `canInviteConferRole` (checks
**capabilities, not the role name**, so a custom role holding `member.roles` is
caught too), and `wouldLeaveNoOwner`. The last must still be called inside the
transaction it guards; the function exists, the discipline is Phase 3's.

### A-4 — cross-Community IDOR **[ADDRESSED v2.95.0]**

`channel_id` and `membership_id` will be opaque and globally unique, which makes
guessing hard but authorization-by-obscurity. Every handler must verify the
resource belongs to the Community in the path, not merely that it exists.

**Addressed in v2.95.0.** `authorize()` takes an optional `resource`
`{ type, id }` and refuses when it belongs to another Community — or when it does
not exist, which is refused rather than ignored, so a bad id can never read as
"no constraint given".

---

## 4. Membership and privacy

### M-1 — enumeration **[ADDRESSED v2.96.0]**

The brief's §22 is right, and Cortex already has the house pattern: unknown
slug, unpublished wave and disabled feature all return an **identical 404**, and
the follower sign-up answers identically whether an address is known.

Communities must extend that to the federation surface: an unauthorised remote
node should ideally not distinguish *private Community exists* from *no such
Community*. Note the honest limit — a node that legitimately participates in a
Community necessarily learns of its existence and of the members it must route
to. Privacy here is against *non-participants*.

### M-2 — membership as a social graph at rest **[precedent exists]**

Cortex already encrypts participation, crew membership and wave roles at rest so
a database dump does not yield a social graph. **Community membership must
follow the same rule** or Communities quietly undoes that work at a larger
scale. It is also the brief's §21 split: the node must read membership and roles
to enforce anything, but never needs to read message content.

---

## 5. Invitations

### I-1 — token handling **[ADDRESSED v2.96.0]**

Cortex already does this correctly twice — account invitations (v2.67.0) and
follower confirmations store **only a hash**, show the raw value once, and
answer uniformly for spent versus forged tokens. Communities should reuse the
pattern rather than reinvent it.

### I-2 — use-count races **[ADDRESSED v2.96.0]**

`max_uses` checked and then incremented non-atomically is a classic
over-redemption bug; concurrent redemptions of a 1-use invite can both succeed.
The increment must be a conditional single-statement update
(`UPDATE ... SET use_count = use_count + 1 WHERE id = ? AND use_count < max_uses`)
and the join must be gated on it having changed a row.

### I-3 — federated invite resolution **[ADDRESSED v2.98.0]**

An invite must resolve to the **immutable Community id**, never a hostname —
otherwise a migrated Community's outstanding invites either break or, worse,
point somewhere else.

---

## 6. Denial of service

### D-1 — unbounded payloads **[ADDRESSED v2.98.0]**

The brief's §12 list is not optional. There is a partial precedent:
`BROADCAST_PING_LIMIT` caps wave broadcasts at 1000 pings, added after a very
long wave produced a request receiving nodes rejected outright — losing the
entire broadcast rather than most of it. That failure mode is instructive:
**limits should degrade, not discard.**

Needs explicit caps: name/description/channel/role lengths, counts of roles,
channels, members and federation participants, event payload size, and a bound
on state-snapshot size.

### D-2 — federation amplification **[ADDRESSED v2.98.0]**

A Community with N participating nodes turns one local action into N signed
requests. A malicious member creating and deleting channels in a loop becomes a
fan-out attack on peers. Needs per-actor rate limits on *state-mutating* events,
not only on HTTP.

### D-3 — state resynchronisation cost **[DEFERRED — nothing to resynchronise yet]**

*As of v2.98.0:* there is no state replication and no snapshot endpoint, so
there is nothing a peer can force a resync of. This becomes live the moment
Communities replicate, and the requirement below is kept intact for then.


"Reject and resynchronise" (A-2) is the right conflict answer, but a peer that
can force repeated full-state syncs has a cheap amplification vector. Snapshots
need to be bounded, cached, and rate-limited per peer.

---

## 7. Encryption

### E-1 — corrected 2026-09-18 **[superseded in part]**

*Original finding:* `wave_encryption_keys.user_id REFERENCES users(id)`, so a
remote identity cannot hold a content key and a Community channel cannot be E2EE
to remote members.

**That holds for `remote_users` under wave federation. It does not hold under the
architecture since decided** (implementation plan §2): a member arriving by
cross-port auth *is* a local `users` row, so nothing structural prevents them
holding wave keys.

What remains true is narrower and still worth stating: they hold none until E2EE
is set up for that session on that node, because keys are generated client-side.
The one cross-port user in production holds zero.

This must be stated plainly in the UI rather than implied. The v2.86.0 review
already established the house position that a security control which silently
does nothing is worse than an absent one. A channel that looks encrypted but is
readable by three nodes' operators would be exactly that.

*V1 recommendation:* Community channels are **not** E2EE, and say so. Keep the
metadata/content split so that adding cross-node key distribution later does not
require re-architecting membership.

---

## 8. Operational

- **Secrets in logs** — federation payload logging must not dump envelopes containing invite tokens. `tools/secret-scan.py` scans git history, not runtime logs.
- **Metrics cardinality** — brief §32 is right: never label metrics with Community id, name or user id.
- **Rollback** — Communities tables must be isolated enough that disabling the feature leaves login, DMs, waves and existing federation working. Feature flags per the brief's §33.

---

## 9. Priorities

| | Item | Why |
| --- | --- | --- |
| **1** | F-1 — minimum signed headers, reject unparseable `Date` | Verified, small, and everything else rides on node auth |
| **2** | A-1 — remote authorization chain | The feature cannot be correct without it |
| — | A-2 — state-version-linked authorization | **Deferred**: dissolved by the single-authority decision; revisit if Communities ever replicate |
| **4** | A-3 — escalation invariants | Highest-likelihood exploit class |
| **5** | I-2 — atomic invite redemption | Easy to get wrong, easy to get right |
| **6** | D-1 — payload and count limits | Cheap now, expensive after a public beta |
| **7** | M-2 — membership encrypted at rest | Consistency with existing privacy posture |
| **8** | E-1 — state the encryption boundary honestly | Avoids a misleading security claim |

**F-1 is worth fixing on its own merits, before any Communities code**, since it
affects federation as it ships today.

---

## 10. Found while building Phase 4 — 2026-09-18

### S-1 — a cross-port user's standing was never re-checked **[ADDRESSED for Communities in v2.97.0]**

Once cross-port auth created a stub row, nothing ever asked again whether the
node that vouched for that person still did. Suspending or unpairing a
federation peer left its users' local rows — and everything those rows could
reach — completely intact.

`authorize()` now refuses a cross-port actor whose `home_node` is not an
**active** federation peer, and `effectiveCapabilities()` returns an empty set
for them. Suspension is reversible: re-activating the peer restores standing
without anyone re-inviting members.

**Deliberately scoped, and still open beyond Communities.** This gate covers
Communities only. A cross-port user whose node has been unpaired keeps any
existing session and any wave participation they already held, because
revoking those is a node-wide authentication decision rather than one for this
evaluator to make unilaterally. **Someone should decide what unpairing a node is
meant to mean for sessions and waves** — the answer is not obviously "nothing",
which is what it means today.

### S-2 — a handler computing its own capability list **[FIXED v2.97.0]**

Phase 3's rule is that no handler computes a permission inline. `GET
/api/communities/:id` broke it for the *listing* case: it called
`db.getMemberCapabilities` directly, which knows about roles and nothing about
standing. The result was a route that reported a remote member's full capability
list while every gated endpoint correctly refused them.

The two-node test caught it. The fix was to give the evaluator an
`effectiveCapabilities()` that applies the same gates as `authorize()`, so the
"what can they do" and "may they do this" questions cannot disagree.

The general lesson, which is why this is recorded here rather than only in the
changelog: **a rule that says "always go through X" needs X to answer every
shape of the question.** Leaving a gap makes the bypass the path of least
resistance.

---

## 11. Independent audit findings — 2026-09-21

An external audit of v2.103.0 raised 1 Critical, 9 High, 5 Medium, 4 Low and 5
Informational findings. Four were fixed in v2.103.1; the rest are recorded here
so their status is not guessed at later.

### CORTEX-COMM-001 — a peer could claim another peer's identities **[FIXED v2.103.1]**

The cross-port session handler selected the peer from the request's
`homeServerUrl` but took the principal's namespace from `exchangeData.homeNode`
— the answering peer's own claim. Since `upsertCrossPortUser` matches on
`(home_node, home_user_id)`, any active peer could answer the exchange with a
user id in another peer's namespace and receive a session on that person's
existing stub, inheriting every Community role attached to it.

The home-node standing check added in v2.100.0 did not help. It reads the same
`home_node` the attacker supplied, so the control meant to protect remote
membership was satisfied by the attacker's own assertion.

**Fixed** by binding the namespace to the peer that was authenticated: a
response naming a different home node is refused outright rather than
reconciled, and pending remote invitations bind only within that namespace.
Regression test drives B's real session endpoint against a stand-in peer that
claims another node's identity; it was confirmed to fail with the fix disabled.

**Not addressed:** a hostile home node impersonating *its own* users. Namespace
binding cannot reach that, and person-controlled identity signatures remain a
separate architectural decision.

### CORTEX-COMM-003 — legacy renewal bypassed revocation **[FIXED v2.103.1]**

`/api/auth/token/refresh` was gated on home-node standing in v2.100.0.
`/api/auth/renew` mints a session too and was not, so a person banned at home
could renew there indefinitely while their peer stayed paired. A revocation
control with a second door beside it is not a revocation control. Both routes
now revalidate. Grace-period re-auth is password-gated and cross-port stubs hold
no password, so it is not a third door.

### CORTEX-COMM-004 — role priority could be raised above the owner **[FIXED v2.103.1]**

`canEditRole()` judged the role's *current* priority and its proposed
permissions, and never saw the proposed priority. An admin could take a harmless
role they already held, lift it above the owner, and use their existing admin
powers to remove them. The evaluator now judges the role it is about to become,
and refuses a non-integer priority rather than coercing it.

The existing test was named "role priority inversion is blocked on edit" and only
ever edited an already-higher role — never the direction the attack uses.

### CORTEX-COMM-005 — removal did not revoke **[FIXED v2.103.1]**

Role grants survived every exit, so a removed admin could rejoin a public
Community through the ordinary join route and be an admin again. Removal the
removed person can undo is not removal.

`removed` and `banned` now revoke the grants and record what was taken in the
audit log; `left` keeps them, because leaving is the member's own decision.
Separating those two was the fix — they were one code path and one behaviour,
which is how the unsafe half went unnoticed. A last-owner guard was also added to
removal and ban, so rank is no longer the only thing protecting the owner.

### Accepted, deferred, or outside Communities

| Finding | Status |
| --- | --- |
| 002 — approval codes can be redirected | **Redirect FIXED v2.103.2** — the callback is now derived from the peer's registered base URL and a supplied one is ignored. The deeper hardening the audit asks for (binding the code to the initiating browser, audience and nonce) is a redesign of this flow and remains open. |
| 006, 007 — unjoined peers inject into origin waves; remote mutations unscoped | **Open, inherited.** Wave federation, affecting every wave on a node. |
| 008 — WebSocket auth bypasses session revocation | **FIXED v2.103.2.** The socket now calls the same `validateSession` the HTTP API does, so logout, password change, reuse detection and cross-port standing all reach the realtime layer. |
| 010 — active uploads execute in-origin | **FIXED v2.103.2.** `nosniff`, a `default-src 'none'; sandbox` CSP, and anything outside the media allowlist served as `application/octet-stream` with `Content-Disposition: attachment`. Real images and video are unaffected. |
| 009 — attachments served without authorization | **Open, inherited, and a design job.** The filesystem path carries no ownership, URLs are embedded in existing messages, the service worker caches them and native clients fetch them directly. Needs a decision between an ownership mapping and signed URLs before any code. |
| 011–019 | **Open.** Restricted channels, invite role drift, resource ceilings, metadata leaks, account deletion, audit atomicity, validation, feature-off paths, channel containment. |
| 020 — no Community event federation | **By design.** Single-host Communities with cross-port members; §2 decided this. |
| 021 — ownership transfer incomplete | **Open**, and a product decision as much as a gap. |
| 022 — removal does not revoke wave access | **Deliberate.** Wave privacy is the content authority; a Community never conferred it. |
| 023, 024 — dependency reachability, dormant resolution | **Informational.** |

The audit's own ordering is the right one: 001–004, then the inherited
node-wide findings, then removal/invitation semantics and the rest.
