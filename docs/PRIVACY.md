# Cortex Privacy Policy

*Last updated: April 2026 — applies to Cortex v2.47.2+*

This policy describes what a Cortex instance actually does with your data. No legalese, no weasel words. If you can't verify a claim yourself, it shouldn't be in here.

Cortex is self-hosted software. Each instance is run by its own operator. This policy covers what the **software** does by default — your operator may configure things differently, and you should ask them if you're unsure.

---

## What We Collect at Signup

When you create an account, the server stores:

- **Handle** — your unique username, stored in plaintext (it's public by design)
- **Display name** — stored in plaintext (also public)
- **Email** — hashed (SHA-256) for lookup, encrypted (AES-256-GCM) for password reset; the server never stores your email in plaintext
- **Password** — bcrypt hashed; the server never stores or sees your actual password
- **Avatar** — stored with your user ID if you upload one
- **Bio** — stored in plaintext if you provide one

---

## Message Content

All message content is end-to-end encrypted (E2EE) using ECDH P-384 key exchange and AES-256-GCM encryption. This means:

- Messages are encrypted on your device before they leave it
- The server stores only ciphertext — it cannot read your messages
- Only participants with the correct wave keys can decrypt message content
- Not even the instance operator can read your conversations

---

## Metadata Protections

Encrypting messages is table stakes. Cortex also protects the metadata around your activity:

- **Email addresses** — hashed + encrypted at rest; never stored in plaintext
- **IP addresses** — anonymized to /24 subnet before storage (e.g., 192.168.1.x); your exact IP is never written to disk
- **User-Agent strings** — truncated to browser and OS only; full fingerprint data is discarded
- **Timestamps** — activity timestamps rounded to 15-minute windows, session timestamps to 5-minute windows; precise timing cannot be reconstructed
- **Wave participation** — encrypted at rest; the database cannot reveal who is in which wave without the server's runtime key
- **Push subscriptions** — encrypted at rest; subscription endpoints are not stored in plaintext
- **Crew membership** — encrypted at rest; group associations cannot be determined from the database alone
- **Contact lists** — client-side encrypted; only you can decrypt your own contact list; the server never sees it in plaintext

---

## Hidden Waves

Cortex supports PIN-protected hidden waves (Ghost Protocol). These waves:

- Don't appear in your wave list without entering a PIN
- Cannot be proven to exist without the user's key
- Provide cryptographic participation deniability — there is no way to prove a user is part of a hidden wave by examining the database

---

## Data Retention

- **Activity logs** — automatically deleted after 30 days (configurable by operator)
- **Sessions** — automatically cleaned up after 30 days (configurable by operator)
- **Messages** — retained until the wave is deleted by participants
- **Account data** — retained until you delete your account

---

## Federation

When federation is enabled and your instance connects to other Cortex instances ("ports" in the Verse), some data crosses server boundaries:

**What is shared with federated instances:**
- Your handle, display name, and avatar (when you participate in cross-instance waves)
- Wave titles for federated waves
- Message ciphertext (still encrypted — remote servers can't read it either)

**What is NOT shared:**
- Your email address
- Your IP address
- Your contact list
- Your crew memberships
- Which local waves you participate in

**Cover traffic protections (v2.28.0):** Federation connections include decoy traffic, message padding, and queue jitter to prevent traffic analysis. An observer monitoring the connection between two instances cannot determine the real volume or timing of actual messages.

---

## What the Operator CAN See

The instance operator (whoever runs the server) can see:

- Handles, display names, and avatars
- Wave titles
- That a user account exists
- Server logs (with anonymized IPs and truncated user-agents)

---

## What the Operator CANNOT See

Even with full database access, the operator cannot see:

- Message content (E2EE — they don't have the keys)
- Who is in which wave (encrypted at rest)
- Your contact list (client-side encrypted)
- Crew membership lists (encrypted at rest)
- Your email address (hashed + encrypted)
- Your exact IP address or full user-agent
- Precise timestamps of your activity

---

## Third-Party Services

- **No analytics** — Cortex does not phone home or track usage
- **No advertising** — no ads, no ad networks, no tracking pixels
- **No third-party cookies** — Cortex uses JWT tokens in headers, not cookies
- **GIF providers** — if enabled by the operator, GIF search queries are sent to Tenor and/or Giphy; this is the only external service Cortex contacts on your behalf

---

## Self-Hosting

Cortex is open-source software. Each instance operator controls their own deployment and data. This means:

- Your data lives on the server your operator runs — not on Cortex's infrastructure (there is none)
- Different instances may have different configurations and retention policies
- You can run your own instance and be your own operator
- The source code is available for audit at any time

---

## Your Data, Your Choice

- **Export your data** — use "Ship's Manifest" in account settings to download everything the server has associated with your account
- **Delete your account** — use "Abandon Ship" in account settings to permanently delete your account and associated data
- **Leave waves** — you can leave any wave at any time
- **Clear contacts** — you can clear your contact list at any time (it's client-encrypted, so the server never had it anyway)

---

## Changes to This Policy

This policy tracks the software's actual behavior. When the software changes, this policy will be updated to match. Check the version number at the top.

---

*"The black keeps secrets. So do we."*
