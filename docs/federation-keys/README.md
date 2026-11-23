# Federation keys: replacing a server's key by handshake

Decided and **built in v2.147.0** (2026-11-23). This was the one credential that v2.146.1 left out of the rule that nothing is retired until its replacement is known to have arrived.

## The problem before v2.147.0

Each server signs every request it sends to an allied server with its RSA key (`server_identity.private_key`, HTTP Signatures). The ally checks the signature against the copy of our public key it saved when the two were paired (`federation_nodes.public_key`).

`POST /api/admin/federation/identity` with `regenerateKeys` replaces our key on the spot. No ally is told. From that moment:

- **Every signed request to every ally fails** with `401 Invalid signature`: posts, edits, invitations, history pulls, member removals.
- **Queued messages are lost.** `federation_queue` gives up after 5 attempts. Five 401s and the message is marked failed for good.
- **People signed in from another server stop being re-vouched.** The cross-port `verify` and `exchange` calls are signed too. Renewals and step-up fail until the ally catches up.
- **The only repair is by hand, on every ally.** Its admin presses Handshake, which fetches `/api/federation/identity` and stores whatever key it gets back, with no check that the key changed or why.

This is the same failure as the sign-out on farhold: the old credential is retired at the moment of the swap, before anyone knows the new one arrived.

## The rule, applied

1. **Keep both keys while the change is in progress.** Our server holds the current key and the next one. Allies keep accepting the current key the whole time.
2. **Tell each ally, and count the change as received only when the ally replies.** If no reply comes, keep the change pending and send it again later. Never assume.
3. **Sign with the new key for an ally only after that ally has confirmed it.** No ally ever sees a signature it can't check.
4. **The ally switches over when it first sees the new key in use.** This is the equivalent of the `rt` claim in v2.146.1: our first request signed with the new key confirms the change at the ally's end.
5. **Destroy the old private key only when every active ally has confirmed.** An ally that is offline holds the change open. That is the cost of the rule, and the admin panel shows it.

## How a change goes

```
admin: REPLACE KEY ─► next key made, kept beside the current one
                      /identity now also lists nextKeyId
                       │
   for each active ally│ POST /api/federation/key-rotation
                       │   signed with the CURRENT key (continuity)
                       │   body: newPublicKey, newKeyId, proof signed with the NEW key (possession)
                       ▼
   ally: checks the signature with our current key, the proof with the new key,
         and that our /identity over HTTPS lists the same nextKeyId (second channel)
         → stores it as our next key, beside the current one
         → replies 200 { received: newKeyId }
                       │
   no reply / error ───┼─► stays pending; resent every 10 min, no attempt cap
   reply received  ────┴─► that ally is marked confirmed; we sign to it with the new key from now on
                            │
   ally sees first request signed with the new key ─► promotes it to our key;
                            the old one is still accepted for 5 minutes (requests already in flight)
                            │
   every active ally confirmed ─► our next key becomes current; old private key deleted
```

### Why the announcement needs three checks

An announcement signed only with the old key is exactly what a thief holding the old key could forge, to swap in a key of their own. So the ally needs all three before it accepts:

- **Signed with our current key:** it comes from whoever holds our key.
- **A proof signed with the new key:** the sender holds the new private key, not just a copy of someone else's public key.
- **Our `/api/federation/identity`, fetched over HTTPS, lists the same next key:** it comes from whoever controls our domain.

A forgery would need both our old key and our domain. Either one alone is refused.

### Answers are safe to lose

The ally stores the key before it replies, and receiving the same key again gives the same reply. A lost reply therefore costs only a resend. If a different next key arrives while one is pending (a cancelled change, then a new one), the newer key replaces the older, provided it is signed with the current key and listed by `/identity`.

## Storage

| Where | What | Kept by |
|-------|------|---------|
| `server_identity` | `next_public_key`, `next_private_key`, `rotation_started_at` | the server changing its key |
| `federation_key_handovers` | `node_id` PK → `federation_nodes` ON DELETE CASCADE; `key_id`, `action` (`announce` or `withdraw`), `attempts`, `last_attempt_at`, `last_error`, `confirmed_at` | the server changing its key: one row per ally |
| `federation_nodes` | `next_public_key`, `next_key_received_at`, `previous_public_key`, `previous_key_until` | the ally: our next key while pending, our old key for 5 minutes after the switch |

- **Key id** (`federationKeyId()`): 32 hex characters of SHA-256 over the public key's DER, computed and never stored. It is also the fingerprint admins compare, shown in groups of four.
- **The signature's `keyId` is unchanged** (`…/api/federation/identity#main-key`), so older servers read our requests as they always have.
- **`/api/federation/identity`** keeps `publicKey` as the current key, so older servers and the manual Handshake read what they read today. It adds `keyId`, `nextPublicKey` and `nextKeyId`, and lists `key-rotation` in `capabilities`.
- **Which key signs:** everything goes through `signingKeyFor(node)`: `sendSignedFederationRequest` and the three direct signers (cross-port `verify` and the two `exchange` calls). It returns the next key for an ally only once that ally's handover row is confirmed. The announcement and the withdrawal are always signed with the current key (`{ currentKey: true }`), since that is the key the ally can check. A pairing request is signed with the current key, which is the key it carries.
- **Which key verifies** (`verifyWithNodeKeys()`): the ally's current key; then its announced next key, and if that verifies it becomes the key (the ally-side switch); then its previous key until `previous_key_until`. The withdrawal route accepts the previous key at any age.

## Edge cases

- **An ally that is offline or unreachable** keeps the change open, for days if need be. The panel shows each ally's state: confirmed, waiting (tries, last tried at, last error), or not yet told. The change completes only through that ally confirming, or the admin deliberately suspending or unpairing it. An unpaired ally's handover row is deleted and stops blocking.
- **A suspended ally** is still told, so it works when reactivated, but it does not hold the change open. If it missed the change, its admin presses FETCH KEY AGAIN.
- **An ally that pairs during a change** is active by the next sweep and is told then.
- **An ally on an older Cortex** answers the new route with 404 and stays waiting. Our servers deploy together, so this lasts one deploy. The panel says "ally needs v2.147 or later".
- **A pairing in progress** (`pending` or `outbound_pending`): starting a change is refused with 409 and names the ally. A pairing exchanges keys in its own messages, and changing the key mid-pairing gains nothing.
- **Cancel** is allowed until any ally confirms. From then on we sign to that ally with the new key, so the change has to finish. On cancel the next private key is deleted at once, so nothing can be signed with it again. Every ally that was told is sent a withdrawal, retried until answered, and clears the key if the id matches. An ally whose answer was lost may still hold the key, and the withdrawal reaches it too. An ally that kept a withdrawn public key is harmless, because the private half no longer exists.
- **The queue.** A `401` from an ally never uses up a delivery attempt. The message is tried again every retry interval, for up to a week from when it was queued. A refused signature means the two servers disagree about a key, which a handover or pairing again repairs; before this, five 401s lost the message.
- **The standby** has a copy of the database, so it carries the pending change along. Nothing to do.
- **Changing the node name** breaks allies in the same way, because the name is in every `keyId`. It is refused (409 `NAME_CHANGE_WITH_ALLIES`) while the server has an active, suspended or pairing ally. `regenerateKeys` on the identity form is refused (409 `USE_KEY_ROTATION`) once an identity exists.

## The one exception: a stolen key

If the old private key has leaked, keeping it valid until every ally confirms leaves the thief able to sign in our name during that time, and able to answer the announcement with a key of their own, if they also control our domain.

**Built:** a separate **KEY WAS EXPOSED** action (`POST /api/admin/federation/identity/replace-now`). It sits behind step-up and needs the server's name typed in, and it tells the admin how many allies it will cut off. It replaces the key immediately and announces nothing. Each ally's admin then presses **FETCH KEY AGAIN**, which re-reads `/identity` and says when the key changed, with the new fingerprint. The two admins compare that fingerprint over another channel.

This is the deliberate exception, as with token reuse in v2.146.1: retiring at once is the right answer only when we know the old credential is in someone else's hands.

## Tests

`tests/federation-key-handshake.test.cjs` runs three real servers: A changes its key, and B and C sit behind proxies that can drop A's announcements or lose the answers.

- **An ally offline:** C misses the announcement. The change stays open, A keeps signing to C with the old key, and nothing is deleted.
- **A lost answer:** C stores the key but its reply is lost. A keeps both keys; the resend gets the same answer and the change finishes.
- **The ally switches:** B switches on the first request signed with the new key. The old key is accepted just after and refused once its 5 minutes are over.
- **Forgeries are refused:** an announcement not signed by A, a proof not signed by the announced key, and a key A's identity page does not list.
- **The queue:** a 401 does not use up an attempt, and the message is kept.
- **Refusals:**
  - a name change or `regenerateKeys` while allies exist;
  - a change started during a pairing;
  - cancel after an ally confirmed.
- **Cancel before anyone confirmed:** the private key is deleted at once, and the withdrawal reaches the ally whose answer was lost.
- **A suspended ally** is told but doesn't hold the change open, and it works when reactivated.
- **Exposed key:** a wrong typed name is refused. B then refuses A until it fetches the key again, and B reports the same fingerprint A's admin sees.
- **Counterfactual:** a copy of `server.js` in which `signingKeyFor()` uses the new key whether or not the ally confirmed. C, which never received the key, then refuses A.

## Building it

**v2.147.0**, migrating, server only. Every ally needs v2.147.0 before anyone changes a key; an older ally answers the announcement with 404, which the panel shows, and the change waits for it. Admin panel, under FEDERATION → STATUS & IDENTITY:

- the signing key's fingerprint, with REPLACE KEY and KEY WAS EXPOSED;
- while a change is under way, each ally's state, with TELL AGAIN NOW, and CANCEL until an ally confirms.

Under ALLIED PORTS, every ally shows its key's fingerprint, any next key it has announced, and FETCH KEY AGAIN.

## Decided

1. **The exposed-key exception:** built.
2. **How long the old key is accepted after an ally switches:** 5 minutes, the signature date window.
3. **Node-name changes refused while the server has allies:** yes, in the same release.
