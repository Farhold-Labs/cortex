# Security audit recovery — 2026-10-05

## Resolution — v2.107.2 (2026-10-05)

All four findings from this continuation were re-verified against `a16bae5`
(v2.107.1) before fixing — none of the affected code had changed since the
reviewed revision — and are **fixed in v2.107.2**. Each fix has a regression
test that was run against the pre-fix code and **failed there**, so the tests
discriminate rather than pass for an unrelated reason.

| Finding | Fix | Regression |
| --- | --- | --- |
| **R-01** override order | `channelCapabilities` pools every role's allows and denies, applies allows first and denies last: **deny always wins**, independent of role order. Restricted-channel admission needs an allow of `channel.view` that no role denies. Matches the documented model (finding 011: deny "takes one thing away"). | `tests/security-audit-r01-r04.test.cjs` — both role orders, equal priorities, an action-only deny, and a plain allow still admitting |
| **R-02** binding failure | Server: a failed binding write now deletes the stored file and fails the upload (500), for a named private wave **and** for an upload awaiting its wave — the latter otherwise had no ownership row, so the later bind answered "unknown" and the file stayed public permanently. Client: `registerAttachments` remembers a path only after a **final** answer (2xx, or 400/403/404/409); 401, 408, 429, 5xx and network errors are retried (2 s, 10 s, 30 s) and, if still unsettled, forgotten so the next send retries. | `tests/attachment-access.test.cjs` (R-02 case: disposable server with the binding write forced to fail; asserts 500, no URL, file removed from a directory proven to have received it) and `tests/attachment-registration.test.cjs` (429→200, 500→200, network→200 each retried; 403 final) |
| **R-03** return type | `effectiveCapabilities` returns an empty `Set` on an evaluation error. There were **three** consumers, not one: besides `channelCapabilities`, `server.js` spreads the result (`[...caps]`) and calls `.has()`; both threw, turning a denial into a 500. | `tests/security-audit-r01-r04.test.cjs` |
| **R-04** reserved handles | `server/lib/reserved-handles.js`: `admin, administrator, root, system, support, moderator, mod, staff, security, official, sysop, superuser, owner, help, cortex, farhold, everyone, here` — exact, case-insensitive. Enforced at signup, at handle-change request, **and at approval** (so a request filed before the rule cannot be approved). **No administrator override**, by decision. Neither production node had an existing account with a reserved handle (checked 2026-10-05). | `tests/security-audit-r01-r04.test.cjs`; verified live on dev: `admin`, `Support`, `EVERYONE` refused at signup, `Root` refused as a handle change |

Three community tests registered a user with the handle `owner` and were
updated to `founder` — the rule doing its job, not a regression.

Prior findings **002**, **016** and **021** — listed below as still open —
were **closed in v2.108.0**; see `docs/communities/01-threat-model.md` §11 and
the CHANGELOG. The remaining audit scope listed at the end is unchanged.

## Verified state

Reviewed revision: `8fd026a23dc66c05c02c6ccc56faf73ef7000e2c` (server v2.105.11).
The working tree was clean when this review began. Earlier `/tmp/cortex*`
audit artifacts no longer exist. The previous conversational checkpoint cannot
be recovered from those artifacts; this report reconstructs state from the
repository, rather than claiming the previous audit finished.

The durable prior findings register is `docs/communities/01-threat-model.md`,
section 11. Tests include `communities-audit-closure.test.cjs` and
`audit-002-024.test.cjs`. The register covers 24 findings against v2.103.0.
Its fixed/accepted statuses are historical assertions, not a blanket security
certification. Changes from the earlier audit baseline `b683bfa` span 45 files.

## Findings confirmed during this continuation

### R-01: conflicting channel overrides can undo a deny — Medium

Evidence: `server/lib/communities/authorize.js:462–469` processes each role's
deny and then allow; `server/database-sqlite.js:14111` returns roles in descending
priority. A high-priority role denies `channel.view` and `channel.create_wave`;
a lower-priority role allows those capabilities. The lower role restores both,
including admission to a restricted channel. Reversing the role order produces
an empty capability set. This is reproducible with the production evaluator
and a stub database returning those role/override records.

The documented model says priority answers member hierarchy questions, not
capability precedence (`capabilities.js` header), and describes deny as removing
a capability. There is no documented rule that a lower-priority allow wins.
The result can expose restricted channel metadata and enable channel actions;
wave content access remains separately authorized. Exploitation requires the
member to have the conflicting roles; no unauthenticated escalation is claimed.

Recommendation: specify conflict semantics explicitly. If deny wins, collect
all allows first and apply all denies last, with a regression covering multiple
roles, both view and action permissions, and equal priorities.

### R-02: attachment binding errors can leave private-wave files public — Medium

Evidence: `server/server.js:5037–5055` records upload binding but catches database
failure and returns upload success, explicitly leaving the file public.
The upload serving gate at `server/server.js:4982` restricts only attachments
with a nonempty `wave_id`; absent or unbound rows are publicly served.

The retry path at `client/src/utils/attachments.js:100–109` caches the path before
the request and never checks the HTTP response. A 429/500 response resolves
`fetch`, so subsequent calls skip the path. A production-helper reproduction
using a stub HTTP 429 response and two registration calls makes exactly one
request. WaveView, FocusView, and ThreadPanel call registration after sending
without awaiting a successful binding.

Normal uploads from existing waves do send `waveId`, so a routine post-send
registration failure alone does not expose an already-bound file. Exposure
requires an initially unbound file or a failed initial binding. No anonymous
path guessing attack is claimed; anyone holding the resulting URL can read it.

Recommendation: enforce successful binding before returning success for uploads
that name private waves; distinguish intentionally public media from pending
private uploads. Cache client registration only after an OK response and retry
transient failures. Preserve the documented legacy-public-file policy separately.

### R-03: exception return type differs from capability API — Low

`effectiveCapabilities` promises a Set but its exception branch at
`server/lib/communities/authorize.js:256` returns a denial decision object.
A simulated database exception confirms the type mismatch. The channel caller
currently returns an empty Set because `base.size` is absent, so this does not
grant access. Return an empty Set consistently; inspect other consumers before
classifying any availability impact.

### R-04: reserved usernames are not blocked — Low

Source review: signup at `server/server.js:5284–5316` sanitizes and trims the
handle, requires `^[a-zA-Z0-9_]{3,20}$`, checks availability, and stores it
lowercase. The `username` request field is accepted as an alias for `handle`.
Handle-change requests at `server/server.js:7793` use the same format rule.
Neither route checks a reserved-name blocklist.

| Submitted username | Current signup format validation |
| --- | --- |
| `admin`, `Admin`, `root`, `system`, `support` | Pass; registration still requires availability and the other signup checks |
| `drop table` | Rejected: embedded spaces are prohibited |
| `drop_table`, `droptable` | Pass; no SQL-keyword blocklist |
| `'; DROP TABLE users;--` | Rejected: punctuation and spaces are prohibited |
| `alice😀`, `😀😀😀` | Rejected: emojis are outside the ASCII allowlist |
| `ab`, a handle longer than 20 characters | Rejected: length must be 3–20 |

This is an impersonation/policy gap: a regular user can claim an available
handle that suggests staff or system authority. The handle itself does not
grant administrator privileges. `DatabaseSQLite.createUser` assigns the first
account the admin role and subsequent accounts the user role independently of
the handle (`server/database-sqlite.js:3661`). User insertion uses a prepared
statement with bound parameters (`3395` and `createUser`), so an SQL-looking
handle is data rather than executable SQL in that insertion path.

These restrictions apply to usernames/handles. Signup display names are
sanitized separately and do not use the handle allowlist; they can contain
emojis. Reserving handles alone therefore does not prevent misleading display
names.

Recommendation: define a case-insensitive reserved-handle policy for names such
as `admin`, `administrator`, `root`, `system`, and `support`, and enforce it in
both signup and handle-change validation. SQL-keyword blocking is not a
substitute for parameterized queries. Decide how existing reserved handles and
legitimate staff accounts should be handled before enforcing a new policy.
This finding was validated by source inspection; no live signup requests or
new automated tests were run for it.

## Prior findings still open in current code

- **002, cross-port browser/request binding:** guest session lookup uses a nonce
  without tying it to the initiating browser (`server.js:14905`). The signed
  exchange sends code and guest node only (`14925`); home exchange checks the
  signing peer but does not check stored request ID/nonce (`14795`). The prior
  fixes remain in place, but the documented remaining gap is still present.
- **016, mutation/audit atomicity:** community update/delete mutate before a
  separate audit insert (`23758–23770`). An audit write failure can leave the
  change committed without its record. The register explicitly defers this.
- **021, ownership transfer and remote step-up:** the transfer capability has no
  consuming route; role grants reject priority equal to the actor's, and the
  last-owner guard blocks departure. Step-up still requires a local password
  comparison (`5518`), which cannot authenticate passwordless cross-port stubs.

## Validation completed

Security regression command:

```sh
node --test tests/communities-*.test.cjs tests/audit-002-024.test.cjs tests/federation-*.test.cjs tests/attachment-access.test.cjs tests/session-revocation.test.cjs tests/account-deletion.test.cjs tests/field-crypto-key-mismatch.test.cjs
```

Result: **229 passed, zero failed/skipped**.

Additional verification:

```sh
node --test tests/media-security.test.cjs tests/wave-roles.test.cjs tests/ws-heartbeat.test.cjs tests/static-server-routes.test.cjs tests/page-metadata.test.cjs
```

Result: **76 passed, zero failed/skipped**. Total: **305 passing tests**.
Read-only reproduction scripts ran successfully for R-01, R-02, and R-03.
Their transient locations are `/tmp/cortex-channel-audit-repro.mjs` and
`/tmp/cortex-attachment-audit-repro.mjs`; the scenarios above retain the evidence
if `/tmp` is cleared again. Regression success does not cover the new findings.

## Scope and next checkpoint

This continuation rechecked the outstanding register, reviewed channel override
composition and attachment binding end to end, and inspected participation
decryption fallback and media authorization helpers. A subsequent source review
checked signup and handle-change username validation (R-04). No application code was
changed, and no vulnerabilities were repaired during this audit.

Full-repository audit completion is **not established**. Remaining scope includes
a full diff review of database/server changes since `b683bfa`, a browser/three-node
cross-port attack reproduction, deployment/proxy and object-storage access
behavior, broader client E2EE/key lifecycle, and fresh dependency reachability
review. The prior dependency assessment is dated September 24 and was not
revalidated here. Public-page tests passed; that is not a manual security review
of every new public-page path. Start the next continuation with this file and
verify HEAD before treating these source locations as current.
