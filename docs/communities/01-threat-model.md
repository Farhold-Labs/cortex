# Communities — threat model

Phase 0, 2026-09-18. Scope: what a federated Communities layer would be exposed
to, what the current stack already defends, and what it does not.

Findings marked **[verified]** were reproduced against the code. Findings marked
**[design gap]** describe something that does not exist yet rather than something
that is broken.

---

## 1. Adversaries

| | Capability |
| --- | --- |
| **Anonymous internet** | Can reach `/api/public/*` and `/api/federation/identity`. Cannot pass node auth. |
| **Local member** | Authenticated on this node. Holds whatever roles they were given. The privilege-escalation adversary. |
| **Remote member** | Authenticated on *their* node, a member of a shared Community. **We never see their credentials** — we see their node's assertion about them. |
| **Malicious allied node** | Holds a valid federation keypair and `active` status. Can sign anything. **The primary Communities adversary.** |
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

### A-1 — no authorization path for remote actors exists **[design gap]**

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

### A-2 — TOCTOU on stale authority **[design gap]**

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

### A-3 — privilege escalation within a Community **[design gap]**

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

### A-4 — cross-Community IDOR **[design gap]**

`channel_id` and `membership_id` will be opaque and globally unique, which makes
guessing hard but authorization-by-obscurity. Every handler must verify the
resource belongs to the Community in the path, not merely that it exists.

---

## 4. Membership and privacy

### M-1 — enumeration **[design gap, precedent exists]**

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

### I-1 — token handling **[precedent exists]**

Cortex already does this correctly twice — account invitations (v2.67.0) and
follower confirmations store **only a hash**, show the raw value once, and
answer uniformly for spent versus forged tokens. Communities should reuse the
pattern rather than reinvent it.

### I-2 — use-count races **[design gap]**

`max_uses` checked and then incremented non-atomically is a classic
over-redemption bug; concurrent redemptions of a 1-use invite can both succeed.
The increment must be a conditional single-statement update
(`UPDATE ... SET use_count = use_count + 1 WHERE id = ? AND use_count < max_uses`)
and the join must be gated on it having changed a row.

### I-3 — federated invite resolution **[design gap]**

An invite must resolve to the **immutable Community id**, never a hostname —
otherwise a migrated Community's outstanding invites either break or, worse,
point somewhere else.

---

## 6. Denial of service

### D-1 — unbounded payloads **[design gap]**

The brief's §12 list is not optional. There is a partial precedent:
`BROADCAST_PING_LIMIT` caps wave broadcasts at 1000 pings, added after a very
long wave produced a request receiving nodes rejected outright — losing the
entire broadcast rather than most of it. That failure mode is instructive:
**limits should degrade, not discard.**

Needs explicit caps: name/description/channel/role lengths, counts of roles,
channels, members and federation participants, event payload size, and a bound
on state-snapshot size.

### D-2 — federation amplification **[design gap]**

A Community with N participating nodes turns one local action into N signed
requests. A malicious member creating and deleting channels in a loop becomes a
fan-out attack on peers. Needs per-actor rate limits on *state-mutating* events,
not only on HTTP.

### D-3 — state resynchronisation cost **[design gap]**

"Reject and resynchronise" (A-2) is the right conflict answer, but a peer that
can force repeated full-state syncs has a cheap amplification vector. Snapshots
need to be bounded, cached, and rate-limited per peer.

---

## 7. Encryption

### E-1 — E2EE is local-only today **[verified]**

`wave_encryption_keys.user_id REFERENCES users(id)`. A remote identity cannot
hold a content key, so a federated Community channel **cannot be end-to-end
encrypted to remote members** without new key distribution.

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
| **3** | A-2 — state-version-linked authorization | Designed in from V1 or retrofitted never |
| **4** | A-3 — escalation invariants | Highest-likelihood exploit class |
| **5** | I-2 — atomic invite redemption | Easy to get wrong, easy to get right |
| **6** | D-1 — payload and count limits | Cheap now, expensive after a public beta |
| **7** | M-2 — membership encrypted at rest | Consistency with existing privacy posture |
| **8** | E-1 — state the encryption boundary honestly | Avoids a misleading security claim |

**F-1 is worth fixing on its own merits, before any Communities code**, since it
affects federation as it ships today.
