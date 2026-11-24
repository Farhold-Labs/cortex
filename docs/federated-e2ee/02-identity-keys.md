# Identity keys — a fingerprint that lasts

Status: **decided** (2026-11-24). Revises `01-design.md`: the fingerprints of
phase 1 (v2.149.0), and format 2 before anything writes it. Phase 1b being
built.

## Why

In v2.149.0 a fingerprint is the fingerprint of a person's encryption key, and
**Mark as verified** is for that key. So every legitimate key change (a lost
password with no recovery key, an account broken into) loses the
verification, and everyone who compared fingerprints has to compare again.

Jared, 2026-11-24: a fingerprint should never change and, once verified,
should never lose its verification. Encryption keys should change whenever
needed: lost password, compromised account, and so on. A verified check mark
should rest on the fingerprint, not on the encryption key.

## The limit

**Verification can only survive a key change because the person signs the new
key.** If it survived an unsigned change, the server could swap anyone's key
and keep the check mark, which is exactly what verification exists to catch.
So every key change has to carry a signature from something the server never
holds. That something is the **identity key**, and the fingerprint is its
fingerprint.

The identity key can't be protected by the login password. The password
already unlocks the encryption key (`reencryptWithPassword`), and anyone who
steals the password logs in, fetches the wrapped key and opens it. An identity
key wrapped the same way would be stolen with it, and the thief would stay
verified. So the identity key is wrapped **only by the recovery key**, the
24-character code everyone is given when they set up encryption.

## The keys

| Key | Kind | Wrapped by | Used for | Changes |
| --- | --- | --- | --- | --- |
| **Identity** | ECDSA P-384 | recovery key only | signing the other two; nothing else | almost never (see below) |
| **Encryption** | ECDH P-384 (today's key) | login password, and recovery key | receiving wave keys | whenever needed |
| **Signing** | ECDSA P-384, new | login password, and recovery key | signing pings | with the encryption key |

The signing key is new because pings must be signed on every device, which
needs a key the password unlocks, and an ECDH key cannot sign. The identity
key is used only when keys are made or replaced, so it is never kept on a
device: it is opened with the recovery key, used, and dropped.

### The key statement

The identity key signs a **key statement**:

```
"cortex-keys-v1" ‖ address ‖ seq ‖ encryption key (SPKI) ‖ signing key (SPKI) ‖ issuedAt
```

- **address** is `<user id>@<server name>`, as in format 2, so a statement
  can't be moved to another account.
- **seq** goes up by one with each replacement. Devices remember the highest
  seq seen per person (in the encrypted record of keys seen) and refuse a
  lower one, so the server can't hand out an older, perhaps stolen, pair.
- `‖` is one 0x00 byte, through `sealContext()`.

The server stores the statement and its signature beside the public keys and
returns them with every lookup (`lookUpKey`, and the federation key lookup of
phase 2).

### The fingerprint

SHA-256 over `"cortex-id-v1" ‖ identity key (SPKI)`, first 16 bytes, 8 groups of
4 hex characters. Same look as now; the different label means an identity
fingerprint can never equal a v2.149.0 encryption-key fingerprint.

## What a device checks

When it looks someone up:

1. The statement's signature checks against the identity key served with it,
   names this person's address, and its seq is not lower than the highest seen.
2. The identity key is compared with the one on record for this person.

| Identity | Statement | Standing | Wave key given? |
| --- | --- | --- | --- |
| same as verified | valid, seq same or higher | **verified ✓**; a new seq is a quiet "keys renewed" | yes |
| same as seen, not verified | valid | seen | yes |
| first time seen | valid | seen | yes |
| **changed** | valid | flagged "changed"; if it was verified, "changed since you verified" (as now) | yes, flagged (decision 1 of 2026-11-20) |
| any | **invalid, missing, or lower seq** | flagged "keys not signed by their identity" | **no** (question 1) |

An identity that signs correctly never produces an invalid statement, so the
last row means the server (or a bug) is serving keys the person didn't make.

**Your own keys.** On every unlock your device checks that the server serves
your own identity and your latest statement. A statement you didn't make (a
higher seq) means someone with your recovery key replaced your keys: the
device says so, with the date.

**Wrapped wave keys.** Static ECDH already proves that a wrapped key came from
the holder of the wrapper's encryption key. With statements, a device also
checks that the wrapper's key is in a valid statement of a member of the wave.
That is the "wrapper is a member" check `01-design.md` left for phase 3, now
for every server.

## Each situation

| Situation | What happens | Fingerprint | ✓ |
| --- | --- | --- | --- |
| Forgot password, has recovery key | Recovery key opens the encryption key, as today. Nothing changes. | same | kept |
| Password stolen | Change password, then **Replace my keys** (enter recovery key): new encryption and signing keys, statement seq+1. The thief's copies are superseded. | same | kept |
| Encryption key exposed some other way | **Replace my keys**, the same | same | kept |
| Forgot password **and** lost recovery key | Reset: a new identity. | **new** | lost; people compare again |
| Recovery key stolen (with the password, or the account) | **Replace my identity**: a new identity. | **new** | lost, as it must be: otherwise the thief stays verified |
| Server swaps someone's keys | Statement invalid, or identity changed | — | flagged |

Today the reset (`/api/e2ee/keys/reset`) deletes the recovery key. Under this
design it keeps the identity: someone who forgot their password but still has
the recovery key never needs it, and someone who reset anyway can enter the
recovery key afterwards to keep their identity. Only "lost both" makes a new
one.

A password thief can't make a new identity without the owner noticing:
everyone who knew the old identity sees it change, and the owner's own device
sees that the identity is no longer the one its recovery key opens.

## Signed pings and the check mark

Format 2 is redefined before anything writes it (v2.149.0 reads it; nothing
writes it; the app is served by the server, so every device updates together).
A format-2 ping's plaintext is:

```
signature (96 bytes, ECDSA P-384 r‖s) ‖ message id (16 random bytes) ‖ text
```

signed over `"cortex-ping-sig-v2" ‖ originWaveId ‖ author address ‖ statement
seq ‖ message id ‖ text`, then sealed as now (AES-GCM, associated data binding
wave and author). The signature sits inside the encryption, so the server
learns nothing it didn't know. An edit is signed again with the same message
id. A device that sees the same message id twice in a wave shows it once, so
the server can't replay a ping.

**The mark beside the author's name:**

- **✓** the ping is signed by the signing key of a valid statement from the
  identity you verified;
- **⚠** the signature doesn't check ("can't confirm who wrote this"), or the
  author's identity has changed since you verified it;
- **nothing** you haven't verified this person, or the ping is format 1 (every
  ping written before signing starts, which can't be signed after the fact).

Today any member of a wave can forge a ping in another member's name, because
pings are sealed with the shared wave key. With signatures they can't, and the
✓ means the person you verified wrote it.

## Moving from v2.149.0

- **Existing people get an identity on their next unlock,** wrapped by their
  recovery key, so the device asks for it: "Enter your recovery key to create
  your identity", or "I don't have it", which makes a new recovery key, shown
  once, as at setup (question 2). New accounts get all three keys at setup.
- **Until someone has an identity** they show "no fingerprint yet", and wave
  keys are given to them as today (they can't be refused: most people won't
  have one on the first day).
- **Verifications made in v2.149.0** were for encryption keys, and can't carry
  over: the server could make an identity for someone and sign their existing
  public key with it. They show as "compare once more". v2.149.0 went out
  2026-11-24, so there are few.
- The record of keys seen gains `identity`, `verifiedIdentity` and `seq` per
  person; `verifiedKey` is dropped.

## Server

- **`user_identity_keys`**: `user_id`, identity public key, identity private
  key wrapped by the recovery key (salt, ciphertext), `created_at`. One row per
  person; replaced only by **Replace my identity** or a reset that has no
  recovery key.
- **`user_encryption_keys`** gains the signing public key and its wrapped
  private key, `statement`, `statement_sig`, `statement_seq`. The server
  refuses a statement whose seq isn't exactly one more than the current one,
  and checks the signature itself (it can, with the public key) so a broken
  client can't store a bad one.
- **Replacing keys follows the handshake rule** (v2.146.1): the new pair waits
  as a pending handover until a device confirms it has it.
- The reset keeps `user_identity_keys`.
- **Regenerating the recovery key needs the current one** once someone has
  an identity (today the password is enough): the new code has to wrap the
  identity, which only the old code opens. Otherwise a password thief could
  replace the recovery key and take the identity with it.
- Every lookup returns identity key, statement and signature.

## Phases (replacing phase 1's follow-on in `01-design.md`)

- **1b: identity keys** (next release). Identity, signing keys, statements,
  the new fingerprint, verification per identity, **Replace my keys**,
  **Replace my identity**, the move from v2.149.0, the redefined format 2
  readable. Migrates. Counterfactual tests: a statement with a lower seq, an
  unsigned key and a forged ping each accepted when the check is stripped.
- **1c: signed pings on one server.** Devices write format 2 in local waves;
  the ✓ and ⚠ on pings. Needs 1b on every device first, so a release later.
  Before it ships, a server holding format-2 pings refuses to be renamed (the
  address contains its name).
- **2 and 3 as in `01-design.md`,** with statements carried by the federation
  key lookup and checked by devices on other servers.

## Decisions (Jared, 2026-11-24)

1. **Keys not signed by the person's identity** (row 5 above): refuse to give
   them the wave key, or give it and flag? **Refuse.** Decision 1
   of 2026-11-20 (give and flag) was about a person's key changing, which may
   be legitimate. An unsigned key never is.
2. **Existing people without their recovery key:** offer "make a new recovery
   key" (the identity is wrapped by the new one)? **Yes.** The
   alternative is that they have no identity until they reset.

## What doesn't change

- Losing both the password and the recovery key still loses something: today
  the encrypted history, under this design also the identity.
- The server can still delete someone's identity and claim they reset. Everyone
  who knew the old one sees the change.
- Your own server serves you the app; a server willing to serve a different
  app is out of reach of any of this (PRIVACY.md).
