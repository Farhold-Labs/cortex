# Encryption across servers — design

Status: **decided** (2026-11-20). **Phase 0 built in v2.143.0, phase 1 in v2.149.0** (see "Phase 1 as built" below), **phase 2 in v2.152.0** ("Phase 2 as built"), **phase 3 in v2.153.0** ("Phase 3 as built"): encrypted waves now include people on other servers. **Fingerprints and format 2 are being revised** by `02-identity-keys.md` (decided 2026-11-24): the fingerprint becomes that of a lasting identity key, and pings are signed. Jared's decisions of 2026-11-07 (a person's
public key comes from their home server over signed federation; members can
see and compare key fingerprints, with a change flagged) and 2026-11-20 (the
five questions) are recorded at the end and folded into the text. Not built.

## Why

An end-to-end encrypted wave cannot include people on other servers. It never
worked: federation carries no wave key, nonce or key version, so travellers saw
ciphertext, and their own pings came back in plain text and were stored that
way inside the "encrypted" wave. v2.142.0 refuses the combination
(`ENCRYPTED_NO_TRAVELLERS`). This design makes it work, and lifts the refusal.

## What exists today (v2.142.0)

| Piece | How it works |
| --- | --- |
| **Your keypair** | ECDH P-384, made on your device. The private key is wrapped with a key derived from your passphrase (PBKDF2, 600k) and stored on your server; the public key is stored beside it (`user_encryption_keys`). |
| **Wave key** | AES-256-GCM, made by the device of whoever encrypts the wave. One per wave per version. |
| **Giving someone the wave key** | A member's device wraps it with ECDH(own private key, recipient's public key) and stores the result for the recipient (`wave_encryption_keys`, with the wrapper's public key alongside). |
| **Pings** | AES-GCM under the wave key, random 96-bit nonce; the server stores `content`, `nonce`, `key_version`, `encrypted`. |
| **Lost key** | The member posts a key request; the server pushes `wave_key_request` with the requester's public key to every other member; the first device online with the key wraps it and posts a grant. |
| **Rotation** | `POST /api/waves/:id/key/rotate` exists (creator or admin). |
| **Whose public key** | `GET /api/e2ee/keys/user/:id`, answered by your own server. Nothing is shown to people; there are no fingerprints. |

### Gaps found while writing this (local, today)

These are in the encryption used on a single server, not only across servers,
and federated encryption is built on top of them. They are fixed first
(phase 0) whatever else is decided.

1. **[SECURITY] A device gives the wave key to whatever public key it is
   handed.** On `wave_key_request` the client wraps the wave key for the
   `requesterPublicKey` in the push (`MainApp.jsx`, `grantWaveKey`), without
   checking that the key belongs to the requester, or that the requester has
   ever had a different key. So the server can obtain any wave's key by
   sending one push message, with no change to the app, and no member sees
   anything. PRIVACY.md says "Not even the instance operator can read these
   conversations"; against an operator willing to do this, that is not true.
   (An operator who serves the app can always serve a different app; that
   limit is inherent to web-delivered encryption and should be said plainly.
   This gap is worse because it needs no change to the app and leaves no trace
   on the device.)
2. **[SECURITY] Keys are never rotated.** `rotateWaveKey` exists in
   `e2ee-context.jsx` and nothing calls it. Removing someone stops the server
   sending them pings, but they still hold the key, so anything they obtain
   later (from a copy, a backup, a careless server) they can read. Today
   removal is access control, not encryption.
3. **Wrapped keys and pings are not bound to anything.** The wrap has no
   associated data, and the ECDH output is used as the AES key directly. A
   server can hand a person the wrapped key of wave X as the key of wave Y
   (same pair of people), or move a ciphertext between waves that share a key
   version, and the device will not notice. The recipient also never checks
   that the wrapper's public key belongs to someone in the wave.
4. **Any member can overwrite another member's wrapped key**
   (`/key/distribute` updates an existing row). It gains them nothing they
   don't already have, but it can lock that member out of the wave.
5. **The server does not refuse a plain-text ping in an encrypted wave.** The
   client always encrypts, but nothing on the server insists.

## What this protects against, and what it doesn't

**Protects against:**

- An allied server reading a wave its people are in. It stores and relays
  ciphertext only; it holds wrapped keys it cannot open.
- Anyone with a copy of any server's database, or its backups.
- A server quietly changing someone's key: members see the change (fingerprints
  and the flag). Devices still give the changed key the wave key, so this is
  detection, not prevention (decision 1).

**Depends on (the decided trust model):**

- **Your own server**, which serves you the app.
- **Each member's home server**, which vouches for that member's public key.
  Only a server allied with theirs asks it (decision 2).

Any of these could substitute a key. The protection is that the substitution is
visible: everyone in the wave can compare fingerprints, and a change is
flagged on every device that had seen the old key.

**Does not protect:**

- **Who is in the wave.** The servers decide membership. A server could add a
  member who doesn't exist; devices would give them the key. Members see the
  member list and its changes; nothing stronger is proposed.
- **Metadata:** who talks to whom, when, message sizes, reactions, thread
  structure, expiry times. Same as today.
- **Files, broadcasts and recordings.** Not end-to-end encrypted today, on one
  server or across servers (PRIVACY.md says so). Unchanged by this design.

## The model

### One wave key, held on each person's own server

The wave key stays one key per version, shared by everyone in the wave on
every server. Each server holds wrapped copies only for **its own people**, in
its existing `wave_encryption_keys` (which references `users`, so a traveller
cannot be stored there anyway). A traveller's wrapped key is made by some
member's device, carried to the traveller's server, and stored there for them.
Neither server can open it.

The **wave's server (the origin)** owns the key version: `wave_key_metadata` on
the origin is authoritative, copies mirror it.

### Public keys from home servers

- **New signed federation endpoint**, `POST /api/federation/e2ee-keys`,
  `{ handles: [...] }` → `[{ handle, publicKey, keyVersion, updatedAt }]`.
  A server answers only for its own people, and only for people who share an
  encrypted wave with the asking server, or who are being invited into one by
  it (so it is not a directory of everyone's keys).
- **Cache:** `remote_user_keys (node_name, handle, public_key, key_version,
  fingerprint, fetched_at, changed_at)`. Refreshed on use when older than a day,
  and on push.
- **Push on change:** when someone resets or rotates their keypair, their server
  sends a signed `e2ee_key_changed` to every server that shares an encrypted
  wave with them. The receiver updates the cache and pushes the change to its
  members in those waves.
- **For devices:** `GET /api/e2ee/keys/remote?address=handle@node`, answered by
  your own server from its cache or a fresh lookup.

### Keys of people on a third server

Servers in a wave are allied with the wave's server, not necessarily with each
other. If you are on B, the wave is on A, and Zoe is on C, and B is not allied
with C, **B does not get Zoe's key and its people cannot give her the wave key**
(decision 2). No server relays another server's people's keys. This costs
nothing in practice: the wave's server is allied with every server in the
wave, so its members (and its owner, who rotates) can always give everyone the
key, and members on C can give it to Zoe. A device that cannot look someone up
simply doesn't answer their key request; someone else does.

### Fingerprints

- **What:** the first 16 bytes (128 bits) of SHA-256 over `"cortex-fp-v1" ‖
  SPKI public key`, shown as **8 groups of 4 hex characters**, upper case
  (`3F9A 0C71 …`) (decision 5). 128 bits cannot be matched by trial, so it is as
  safe in practice as Signal's 60 digits, shorter to compare, and the simplest
  to make. A QR code to scan can come later.
- **Where:**
  - Settings → Encryption: "Your key", your own fingerprint.
  - A wave's member list (wave settings): each member's fingerprint, with
    **Mark as verified** after comparing.
  - A person's profile card: the same, for that person.
- **Keys you've seen.** Each device records, per person (`userId` here,
  `handle@node` elsewhere), the key it has seen and whether you verified it.
  The record is stored on your server **encrypted under your own key**, like the
  encrypted contact list (`deriveContactsKey`), so it follows you between
  devices and the server cannot read it or forge entries in it. It can delete
  or roll it back; then a change looks like a first sighting rather than a
  change. That limit is accepted.
- **A change is flagged:** a line in each encrypted wave you share ("Zoe's
  encryption key changed"), and a mark on Zoe in member lists until you open
  it. If you had verified Zoe, the mark says the verification no longer
  holds.

### Giving people the wave key (local and across servers)

The rule a device follows, everywhere:

> Wrap the wave key only for a public key the device has looked up itself for
> a member of this wave, **never the key carried in a request**, and compare it
> with the key it has seen for that person before.

- Same key as before, or first time seen: give the key.
- Changed key: give the key and flag the change, whether or not the person
  was verified (decision 1: seamless until this is finished; asking first can
  come later).

This closes gap 1 on a single server too.

**Across servers, the request and the grant travel through the wave's server:**

1. Zoe on B joins the wave (accepts the invitation), or lost her key. Her
   device posts a key request to B; B sends a signed `wave_key_request` to the
   wave's server A, naming only the wave and Zoe's address. No key travels in
   it.
2. A records it (`remote_wave_key_requests`, since `wave_key_requests`
   references `users`) and passes it to its own members and to every server in
   the wave, which pass it to theirs.
3. The first member's device online with the key looks up Zoe's key through
   its own server, applies the rule above, wraps the wave key with
   **format 2** (below), and posts the grant to its own server.
4. That server sends a signed `wave_key_grant` to A, which checks there is a
   pending request for Zoe, then forwards the grant to B. B accepts it only
   from the wave's server, only for its own member of a wave it holds a copy
   of, and only for a pending request. It stores the grant in
   `wave_encryption_keys` and pushes `wave_key_granted` to Zoe.

The same path covers someone who is already in the wave and resets their key.

### Versions and rotation

- **When:** whenever someone leaves or is removed, on any server. The wave's
  server marks the wave `rekey_needed` and tells the other servers.
- **Who:** the wave's **owner, or one of its admins or moderators** (wave roles,
  v2.88.0, including those that come from a crew), on the wave's own server
  (decision 3). Wave roles don't federate, so travellers never rotate. Their
  device rotates as soon as it is unlocked and sees `rekey_needed`: on unlock,
  on the `wave_rekey_needed` push, or on opening the wave. The server refuses
  a rotation from anyone else (403).
- **Until then** the others keep sending with the old key, which the person who
  left still holds. The gap lasts until the owner or a moderator is next
  online. The wave shows "Waiting for the owner to renew the key" so members
  know. A wave whose owner has deleted their account and has no admins or
  moderators can never rotate; it says so, and the owner role passes as it does
  today.
- **How:**
  1. The device makes a new key, version n+1, and wraps it for every member
     still in the wave. It gets the member list and their keys from its own
     server, which asks the wave's server for members elsewhere.
  2. It posts the rotation to its own server, which passes it to the wave's
     server.
  3. The wave's server accepts it only if it is exactly version
     current+1 and covers exactly the current members. Otherwise it answers
     409 and the device starts again.
  4. The wave's server sends each server only the wrapped keys for its own
     people, plus the new version number. Every server broadcasts
     `wave_key_rotated`.
- **Old versions stay.** A member keeps every version they were given, so older
  messages still open (`/keys/all`, unchanged). Someone who joins later gets
  only the current version, as now.

### Messages on the wire

- `new_ping`, `ping_edited` and history backfill carry `encrypted`, `nonce`,
  `keyVersion` and `format`. `remote_pings` gains the same columns.
- The wave payload sent with an invitation and on copy creation carries
  `encrypted: true` and the current key version, so the copy is made encrypted.
- **Every server refuses plain text in an encrypted wave** (400
  `ENCRYPTION_REQUIRED`): local pings and edits, and pings from other servers
  (dropped and logged). A server can check only the form (`nonce` is 12 bytes
  of base64, `content` is base64, the key version exists), not the content.
  This closes gap 5.

### Format 2: binding keys and pings to their place

New writes use format 2; devices read both formats, so old messages and old
wrapped keys still open.

- **Wrapping a wave key:** ECDH → HKDF-SHA256 (salt empty, info
  `"cortex-wavekey-v2" ‖ originWaveId ‖ keyVersion ‖ recipient address`) →
  AES-GCM with the same string as associated data. When opening it, the device
  also checks that the wrapper's public key is one it knows for a member of
  the wave. Gap 3.
- **Pings:** AES-GCM with associated data `"cortex-ping-v2" ‖ originWaveId ‖
  author address`. The origin wave id is used because each server's copy has
  its own wave id.
- A `format` column (default 1) on `pings`, `remote_pings` and
  `wave_encryption_keys`.
- Devices must read format 2 before any device writes it. So reading ships one
  release before writing.

### Servers that are not ready

The refusal stays for any server that hasn't announced it can do this.
Servers announce it with `protocol_version` 3 on `federation_nodes`, set at the
handshake and re-checked by a signed capabilities call. The message becomes
"zoe's server can't take part in encrypted waves yet". A traveller who hasn't
set up encryption is treated like a local member without keys: they are told
to set it up, and their key request follows when they do.

### What each server sees

| | Wave's server | Traveller's server | Allied server not in the wave |
| --- | --- | --- | --- |
| Message text | ciphertext | ciphertext | nothing |
| Wave key | wrapped copies for its people | wrapped copies for its people | nothing |
| Members and their addresses | yes | yes, as today | nothing |
| Public keys | of everyone in the wave | its people's, and those of people on servers it is allied with | its people's |
| Who verified whom | no (stored encrypted) | no | no |

## Tables and messages (summary)

New tables:

- `remote_user_keys`
- `remote_wave_key_requests`
- `user_key_records`: one encrypted blob per person, holding the keys they've
  seen and verified.

New columns:

- `encrypted`, `nonce`, `key_version` and `format` on `remote_pings`;
- `format` on `pings` and `wave_encryption_keys`;
- `rekey_needed_at` on `wave_key_metadata`.

New signed federation traffic:

- `POST /api/federation/e2ee-keys`;
- inbox types `e2ee_key_changed`, `wave_key_request`, `wave_key_grant`,
  `wave_key_rotated` and `wave_rekey_needed`;
- a capabilities call.

## Phases

0. **Local fixes (security release, ships alone).**
   - The grant uses a key the device looked up, not the one in the push.
   - `/key/distribute` cannot overwrite another person's row.
   - The owner, an admin or a moderator rotates after anyone leaves or is
     removed.
   - Plain text is refused in encrypted waves.
   - PRIVACY.md is corrected.
   - Each fix gets a counterfactual test.
1. **Fingerprints and the record of keys seen, on one server.** Settings, member
   lists, profile cards and the change flag. Devices learn to read format 2.
2. **Federation plumbing, still refused at the door.**
   - The key lookup endpoint, its cache and the change push.
   - `protocol_version` 3.
   - The new fields on pings, edits and backfill, and the new `remote_pings`
     columns.
   - Plain text from other servers refused in encrypted waves.
3. **Keys across servers, and the refusal lifted** for servers at protocol 3.
   - Requests and grants through the wave's server.
   - Rotation across servers.
   - Devices write format 2.
   - Tested with real browsers on two servers (dev and QA), and a third
     (port1) not allied with one of them, to prove its people get no key
     from there.

Each phase is its own release. 1 and 2 can be built in either order.

Decided 2026-11-24 (`02-identity-keys.md`): **1b**, identity keys and
statements, and **1c**, signed pings on one server, before 2 and 3.

### Phase 1 as built (v2.149.0)

- **Fingerprints** as specified, in Settings → Security → Your encryption key
  (there is no separate Encryption category), on the people list of an
  encrypted wave (a KEY line under each name, opening to the fingerprint and
  Mark as verified) and on profile cards. Opening the people list looks up
  every member's key, so the marks there are about the key the server hands
  out now. Opening someone's key counts as seeing a change.
- **Verified** is per key: `verifiedKey` in the record of keys seen. A change
  drops it and sets `verificationLost`, shown as "changed since you verified"
  until the new key is verified. Seeing the flag does not clear that.
- **Format 2, read only.** `format` on `pings` and `wave_encryption_keys`
  (default 1), accepted on every write, returned on every read. Details that
  the text above left open, now fixed because format 2 bytes depend on them:
  - **An address is `<user id on the home server>@<home server name>`**, not
    the handle: a handle can be changed, and a binding to it would make every
    format-2 ping by that person unreadable afterwards. Remote pings already
    carry `author_id` and `author_node`.
  - **‖ is one 0x00 byte**; no field may contain it (`sealContext()` refuses),
    so two different lists of fields never give the same bytes.
  - The key version in the wrap context is its decimal string.
- **Left for phase 3**, where they first matter:
  - the origin wave id of an encrypted *copy* (phase 1 has none: encrypted
    waves and other servers are still refused), so devices use the wave id
    they asked for;
  - the check that a wrapped key's wrapper is a member of the wave. On one
    server the wrapper must already be the giver's own registered key
    (v2.143.0); across servers it needs the wrapper's address on the row.
  - **A server's name is part of every address.** Renaming is already refused
    while it has allies (v2.147.0); before devices write format 2, a server
    holding format-2 pings must refuse a rename (or a first name) outright,
    or those pings stop opening.

## Decisions (Jared)

2026-11-07:

- A person's public key comes from their home server over signed federation.
- Members can see and compare key fingerprints, and a change is flagged.

2026-11-20:

1. **A verified person's key changes:** give them the wave key and flag the
   change, the same as for anyone. Seamless until this is finished.
2. **People on a server yours isn't allied with:** nothing until the servers
   are allied. No server relays another's people's keys.
3. **Who rotates:** the wave's owner, or a moderator if it has one (admins
   too, since they rank above moderators).
4. **Phase 0 ships first,** as its own security release.
5. **Fingerprints:** whichever is more secure or easiest to make. Hex, 128
   bits: as secure in practice as digits, shorter and simplest.

2026-11-24:

- **A fingerprint should never change, and a verification should never be
  lost, while encryption keys change as needed** (lost password, compromised
  account). Worked out in `02-identity-keys.md`.

### Phase 2 as built (v2.152.0)

- **Lookups are by the person's id on their own server, not their handle.**
  `POST /api/federation/e2ee-keys` takes `userIds`, as statements and seals
  use ids (handles can change). The answer carries every statement, so pings
  signed under an earlier one still check, and the server's `sealNodeName`.
- **The cache** is `remote_user_keys (node_name, user_id, …)`, a day fresh;
  `GET /api/e2ee/keys/remote?node=&userId=` for devices, only for a server the
  caller shares an encrypted wave with. The server carries statements; devices
  check them.
- **The change push** goes after any key change here: identity made, replaced
  or kept, keys replaced, registered, rotated, reset by the person or an
  admin. For a reset, the allies are worked out before the wave keys go.
- **Protocol 3** is in `/identity` and in every envelope; an ally's signed
  envelope updates `federation_nodes.protocol_version`, so no separate
  capabilities call was needed.
- **Who may look up whom** comes from the waves: encrypted waves the person
  holds a key for or created, which they can read, sent to that server (or a
  copy from it), or with an open invitation to someone there.
- **Not yet:** devices don't look up people elsewhere, and nothing lifts the
  refusal. Both are phase 3, which must also tell other servers the pinned
  seal name (v2.151.0) rather than assume the federation name.

### Phase 3 as built (v2.153.0)

- **The refusal is lifted for protocol-3 servers.** Creating an encrypted wave
  with people elsewhere, inviting them, and answering an invitation check every
  server involved (`encryptedServersRefusal()`), re-reading its identity page
  when what we last heard is below 3. `/encrypt` on a wave that already has
  people elsewhere is still refused: their copies hold its plain history.
- **The copy** is made encrypted at the version the answer gives, and its
  server asks for the key at once (a device otherwise asks only when a ping
  fails to open). A copy follows the wave's version (`setWaveKeyVersion`) and
  is never renewed where it is (`canRotateWaveKey` false on copies).
- **Requests and grants** as designed, with one simplification: only the
  wave's own server's members answer requests from elsewhere (it is allied
  with every server in the wave); requests are not relayed to third servers.
  `remote_wave_key_requests` on the wave's server; `/api/waves/:id/key-grant-remote`
  for its members' devices.
- **Rotation**: entries `{ remote: { nodeName, userId } }` for people
  elsewhere, checked against the wave's listed people there; each server in
  the wave is sent its own people's keys and the new version, possibly none.
  Someone left out (no keys, or keys not signed) asks. The device sends the
  version it bound the keys to (`keyVersion`), and `ifNeeded` for a pending
  renewal, which the server skips if no longer needed.
- **Who wrapped a key** is stored with it (`sender_user_id`, `sender_node`),
  and devices check format-2 keys against the wrapper's statements, signed by
  the fingerprint on record for them if there is one. Membership of the
  wrapper isn't checked by devices: the wave's server checks the giver holds
  the version, and the copy's server takes keys only from the wave's server.
- **Seals** use the wave's id on its own server (`originWaveId` in key
  responses) and each person's server's pinned seal name (from key lookups).
- **Keys made at creation and at `/encrypt` stay format 1**: the wave's id
  doesn't exist yet at creation. Every other wrap is format 2.
- **Tested** with two real servers and real browsers on one machine, then
  between the real dev and QA servers (a test account on QA): wave, key from
  the other server, pings both ways, renewal, removal. A third server not
  allied with one of the others was not tried: dev, QA and port1 are all
  paired with each other.
