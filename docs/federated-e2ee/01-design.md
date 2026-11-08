# Encryption across servers — design

Status: **proposed** (2026-11-08), for review. The two decisions already made
(Jared, 2026-11-07) are folded in: a person's public key comes from their home
server over signed federation, and members can see and compare key
fingerprints, with a change flagged. Questions still open are at the end.

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
  and the flag), and a device will not give the wave key to a changed key for
  someone it has verified without asking (see open question 1).

**Depends on (the decided trust model):**

- **Your own server**, which serves you the app.
- **Each member's home server**, which vouches for that member's public key.
- **The wave's server**, for members on servers yours is not allied with (see
  "Keys of people on a third server").

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
other. If you are on B, the wave is on A, and Zoe is on C, B may not be able to
ask C. Then B asks A, and A answers from what C told it. So for people on a
third server, the wave's server also vouches for their key. Fingerprints catch
a substitution the same way. (Open question 2.)

### Fingerprints

- **What:** SHA-256 over `"cortex-fp-v1" ‖ SPKI public key`, shown as **12
  groups of 5 digits** (each group is 5 bytes taken mod 100000, as Signal
  does). Easy to read aloud and compare. A QR code to scan can come later.
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
- Changed key, person not verified: give the key and flag the change.
- Changed key, person verified: **ask first** ("Zoe's key changed since you
  verified it. Give her the key to this wave?").

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
- **Who:** the next member device that sends a ping in that wave rotates first,
  then sends with the new key. Any member's device may rotate (open
  question 3). Until someone sends, nothing new needs protecting, so there is
  no gap.
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
| Public keys | of everyone in the wave | its people's, and others' when its people need them | its people's |
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
   - The next sender rotates after anyone leaves or is removed.
   - Plain text is refused in encrypted waves.
   - PRIVACY.md is corrected.
   - Each fix gets a counterfactual test.
1. **Fingerprints and the record of keys seen, on one server.** Settings, member
   lists, profile cards, the change flag, and asking before giving a verified
   person's changed key the wave key. Devices learn to read format 2.
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
   - Tested with real browsers on two servers (dev and QA), and a third for
     the "third server" path (port1).

Each phase is its own release. 1 and 2 can be built in either order.

## Open questions (Jared)

1. **A verified person's key changes.** Ask before giving them the wave key
   (recommended), or give it and flag it as for anyone else?
2. **People on a third server.** Accept that the wave's server vouches for keys
   of people on servers yours isn't allied with (recommended; fingerprints
   cover it), or refuse to give the key until your server can ask theirs
   directly?
3. **Who may rotate.** Any member's device (recommended: whoever sends next, so
   it happens), or only the owner's (today's rule, which in practice never
   happens)?
4. **Phase 0 first, as its own security release** (recommended), or fold it into
   phase 1?
5. **Fingerprint format.** 12 groups of 5 digits (recommended), or hex?
