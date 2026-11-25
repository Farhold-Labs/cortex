# Cortex Privacy Policy

*Last updated: October 2026 — applies to Cortex v2.130.0+*

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

## If You RSVP to a Public Event Without an Account

A server can publish a wave's calendar to a public page. Anyone can respond to
an event there without signing up, and doing so means handing the server an
email address. That is the only route by which Cortex stores data about someone
who has no account, so it is worth being explicit about it.

When you RSVP as a guest, the server stores:

- **Name** — as you typed it, in plaintext. Shown to members of the wave the
  event belongs to, and to moderators. **Never shown on the public page** —
  visitors see counts only, never who is coming.
- **Email** — encrypted (AES-256-GCM) with a SHA-256 hash alongside it for
  lookup, exactly as account emails are handled. It is used to send you a
  confirmation and event reminders, and to recognise a repeat response as the
  same person rather than a duplicate. It is visible to **moderators only**, in
  the attendee list and its CSV export — not to ordinary members.
- **Party size and your answer** — going, maybe, or can't.
- **A cancellation token** — stored only as a hash. The usable token is sent to
  you by email and is not recoverable from the database, so a leaked copy yields
  no working cancellation links. Each reminder carries a new one, and since
  v2.146.1 the links in earlier emails keep working too, in case a reminder
  never arrived.

**Removing it:** the cancellation link in any confirmation or reminder email
deletes the RSVP outright, including the stored name and email. Deleting the
event does the same for every RSVP attached to it.

**Reminders:** if you RSVP, the server emails you a day before and an hour
before the event. There is no separate marketing list — the address is used for
that event and nothing else.

---

## Message Content

End-to-end encryption (E2EE) is **set per wave**, using ECDH P-384 key exchange and AES-256-GCM. A wave is encrypted when it is created encrypted, or on every wave if the operator sets `FORCE_WAVE_ENCRYPTION`. Each wave shows whether it is encrypted.

**In an encrypted wave:**

- Messages are encrypted on your device before they leave it.
- The server stores only ciphertext and cannot read your messages.
- Only participants with the correct wave keys can decrypt message content.
- **What the operator could still do.** The app itself comes from the server, so an operator willing to serve a different app could read what it decrypts; that is true of any encryption delivered through a web page. Short of that, the server tells your device which public key belongs to whom. Your device remembers the keys it has seen, in a record stored encrypted under your own key, and when someone's key changes it says so in every encrypted wave you share with them ("Zoe's encryption key has changed"). It still gives them the wave key, so a substituted key is visible, not prevented. Before v2.143.0 the server could obtain any wave's key by asking every online member's device for it, with nothing shown.
- **Comparing fingerprints (v2.149.0; lasting since v2.150.0).** Each person has a fingerprint (32 characters, shown in Settings → Security → Your fingerprint, on the people list of an encrypted wave and on profile cards). Two people who read theirs to each other over a call or in person, and find them the same, know the server has not swapped the other's keys. Marking someone as verified is kept in the same encrypted record, so the server cannot see whom you have verified or forge it; it could delete the record, which makes a verification disappear rather than look valid.
- **The fingerprint lasts (v2.150.0).** It is the fingerprint of an identity key, which signs your encryption keys, so you can replace those (a stolen password, an exposed key) and your fingerprint, and everyone's verification of you, stays. The identity key is locked by your recovery key only, never your password: someone who steals your password can read what you can until you replace your keys, but cannot keep your fingerprint. Losing both your password and your recovery key, or replacing your fingerprint, gives you a new one, and the people who verified you see it change. The server stores your identity's public key and every statement it signed, in plain form, because everyone's device checks them; it never holds the identity unlocked. Keys the server hands out for someone that their identity didn't sign are shown as such, and your device gives them no wave key. Verifications made in v2.149.0 were of an encryption key and are shown as "compare once more".
- **Who wrote a ping (v2.151.0).** Pings in an encrypted wave are signed by their author, inside the encryption, so the server learns nothing new from it. Before, any member of the wave could post a ping in another member's name, since everyone holds the same wave key. A ✓ beside someone's name means the ping is signed by the fingerprint you verified for them; a ping whose signature doesn't check, or a copy of an earlier one, is not shown, and says why. Pings sent before this, or from an app without a fingerprint yet, are unsigned and carry no mark.
- **Your keys and other servers (v2.152.0).** An allied server can ask this one for your public encryption key, fingerprint key and key statements only if it shares an encrypted conversation with you, or someone there is being invited into one you're in. Nobody else's server gets them, and it isn't told whether you exist. It keeps a copy for a day, and is told when you change keys. Public keys are meant to be shared; your private keys never leave your devices. Since v2.153.0 an encrypted conversation can include people on other servers. Their servers store only ciphertext, and wrapped keys only for their own people; the conversation's own server passes keys between servers but can't open them. Each server still sees who is in the conversation and when messages are sent, as it does for any conversation. A server keeps the public keys of people whose messages are in conversations here, so their old messages can still be checked after they leave. Since v2.154.0 the conversation's own server tells every server in it which other servers are in it, and allied servers in the same conversation can then fetch each other's people's public keys. When someone needs the key, their request (who they are and which server they're on, never a key) goes to the other servers in the conversation, so a member there can answer. Since v2.155.0 a conversation with people on other servers can be encrypted after the fact: its earlier messages are re-encrypted on the creator's device, and the other servers are sent the encrypted versions to replace the plain copies they hold, including their own people's. A server could still keep a copy it made before (a backup, say); the app says so before you turn it on. A server joining a conversation late now also gets the earlier messages of its people on other servers, as everyone in it already could see them.
- **Replies in threads and the focus view were not encrypted before v2.143.0.** Those views sent text as typed, so replies and edits made there were stored as plain text inside encrypted waves, where the server could read them. The server now refuses plain text in an encrypted wave.
- **When someone leaves, the wave gets a new key** (since v2.143.0; before, keys were never changed). Until the wave's owner, an admin or a moderator next opens the app, the person who left still holds the key to what is sent, though the server no longer gives them the messages; the wave says so.
- **Your key on your device.** Your private key is unlocked with your passphrase (normally your login password). So that you aren't asked every time you open the app, a copy is kept in this browser or app until your session ends. It is protected by a key stored beside it, so anyone with access to your device could use it. Signing out removes it. Before v2.114.1, signing out from Settings left it in place until it expired.

**In a wave that is not encrypted,** including public waves, waves published to the portal and announcement waves, messages are stored as text the server can read. They are protected by access control, not encryption.

**Wave invitations (v2.130.0).** Being added to someone's wave outside a Community sends you an invitation first. While it is open, the server stores who invited whom to which wave, in plain form, so it can show you the question; the row is deleted when you accept, decline, the inviter withdraws it, or it expires after 30 days. An accepted invitation becomes ordinary wave participation, which is stored encrypted. Before accepting you see only who invited you, the wave's title and who is in it. You can decline, or decline and block the inviter; the inviter is not told which. Someone who has blocked you, or whom you have blocked, cannot invite you. Inside a Community there is no invitation: joining the Community is the consent, and only its members who can see a channel can be put into that channel's waves. A setting, off by default, accepts invitations from your contacts automatically. A Community's owner and admins can see, for each conversation filed in their channels, how many of its people cannot see that channel (v2.131.0), so they can decide what to do with it; they are not told who those people are, and they see the conversation's title only if they are in it. The server's administrator sees the same counts per Community, with no titles. A conversation started with two or more other people forms a group (v2.132.0); until someone names it, its name is worked out from its people each time it is shown and is not stored, so the server does not keep a plain-text list of who talks with whom beside the encrypted membership. A name someone types is stored as typed. A public wave inside a Community's channel is visible only to people who can see that channel, not to everyone on the server; before v2.128.0 it was visible to every account on the server, and its files to anyone with the link. Inside a Community, a conversation is either open to its channel or narrowed to named people and Community roles (v2.134.0). Only the Community's owners and admins can narrow one, and they can always read every narrowed conversation in their Community; "Who can see this" on the conversation says so. Who a conversation is narrowed to is stored in plain form (as are the members of Community roles), because the server checks it on every read. Conversations that, when this shipped, included people who cannot see their channel keep their access until the Community's owner or an admin decides: move it out of the Community, or keep it for the Community, in which case the people outside lose it unless they are invited to join and accept. Taking a conversation out of a Community keeps its named people and drops everyone else, including admins who had only looked in. Since v2.140.0 the same happens when its channel is deleted or the Community closed; before, a members-only conversation there became readable by everyone on the server. A conversation open to its channel becomes, outside it, a conversation of the people who have been in it, never everyone on the server: only the server's moderators and admins can open a conversation to the whole server. A Community's activity log (owners, admins and moderators, v2.140.0) records who did what in it: who joined, left, was removed or banned, roles given, channels and conversations changed, pings removed by moderators. It shows a conversation's title only to someone who can open it, and never a ping's content.

---

## Attachments, Live Broadcasts and Recordings

These are **not end-to-end encrypted, even in an encrypted wave.** The encryption covers the message text. A file, a broadcast or a recording is stored or relayed in a form the server and its operator can read.

- **Attached files** (pictures, documents, audio, video) are stored on the server, or in the operator's private S3 storage, as uploaded. Since v2.117.0 files in S3 storage are served through Cortex with the same checks as files on the server.
  - **Who can open them:** since v2.104.0, a file posted to a wave can be opened only by people who can read that wave, checked on every request. Recorded voice and video messages have had the same check since v2.116.2; before that, any account on the node could play them if it had the link. Files from before v2.104.0, and profile pictures and videos, are readable by anyone who has the link.
  - **When they're deleted:** a file posted to a wave is deleted with that wave (since v2.113.3). In S3 storage that means every stored copy: before v2.117.0, deleting a file or recording from a Backblaze B2 bucket only hid it there. It is not deleted when the uploader's account is deleted, because it is part of a conversation other people are still in.
- **Live broadcasts** (if the operator enables them) are relayed through LiveKit, a third-party media service the operator chooses (LiveKit Cloud or self-hosted).
  - Viewers are hidden from one another and cannot be seen or heard.
  - The performer can see how many people are watching, but not who.
  - A public link lets anyone watch without an account, until it is turned off or the broadcast ends.
- **Community logos** (v2.125.0) are pictures a Community's managers upload. Like avatars, a logo is not access-controlled: anyone holding its address can load it. The address is random and is only ever sent in answers that already describe the Community, so it reaches the people who can already see the Community's name. A logo is re-encoded on upload, which removes any metadata the original carried, and deleted when it is replaced, removed or the Community is closed.
- **Voice channels** (if the operator enables them, v2.118.0) are Community channels you can drop into for voice, video and screen sharing. They go through LiveKit, like calls.
  - **Who can see who is in one:** anyone who can see the channel in the Community's list, including people who have not joined it. In a restricted channel, only the people let into it.
  - **Encrypted so LiveKit cannot hear or see it** (since v2.119.0). Your device encrypts its audio, video and screen before they leave it, and decrypts what others send; LiveKit relays packets it cannot read. The key is made by the Cortex server that hosts the Community and handed to each person it lets in, so that server could derive it — it is not secret from the node, only from the media service. A browser that cannot do this encryption is not let in. Wave calls are not encrypted this way: there, LiveKit's servers could technically access the media. Voice channels are never recorded.
  - **What Cortex keeps:** nothing about who was in a voice channel or for how long. The server tracks who is in a room only while they are in it, in memory. On a stage, a raised hand and being brought up to speak are kept the same way, by LiveKit, only while you are in the room. Moderator mutes, disconnects, moves and stage changes are written to the Community's audit log.
  - **Idle disconnect:** you are disconnected after a while alone in a channel, and a channel where nobody has had a microphone, camera or screen on for a while is emptied. Listening while others talk does not count as idle. The operator sets both limits.
- **Direct calls** (v2.145.0): ringing a contact, outside waves. Only someone who has you as a contact, and whom you have as a contact, can ring you.
  - **Media** goes through LiveKit, like wave calls, and is not encrypted against it yet.
  - **What Cortex keeps:** a call history for the two people: who rang whom, audio or video, when, whether it was answered, and how long it lasted. Never what was said. Only the two people can see it. It is deleted after 90 days, or with either account.
  - **Notifications:** a ring and a missed call reach your devices as push notifications naming the caller. In the Android app (from v2.146.0) the ring is a message the app turns into a phone-style ring; it also carries a key that can decline that one call, so DECLINE works with the app closed. Like every push to the Android app, it passes through Google's Firebase service.
- **Your Jellyfin or Plex access token**, if you connect a media server: the server uses it to play what you share. It is stored encrypted (AES-256-GCM, since v2.156.1) and never sent to anyone's browser; disconnecting the server or deleting your account deletes it.
- **A refresh token waiting to be received** (v2.146.1): when your app trades its sign-in token for a new one, the server keeps the new one, encrypted with a key derived from its signing secret, until your app shows it arrived. Then the copy is deleted. That is what lets a lost answer be sent again instead of signing you out. A regenerated recovery code set, recovery key, bot key or calendar link likewise waits, as a hash or as the encrypted blob your device made, until you confirm it; deleting your account deletes them.
- **Which version of the app you use** (v2.146.0): each install reports its web build, its platform and, in an installed app, the app's version, under a random id kept on that device. The server stores no account with it. Admins see only counts by version. An install not seen for 90 days is deleted. Your Android app's version is also kept with its push token.
- **Recordings** are made only when the performer chooses to record.
  - **Where they're stored:** in the operator's S3-compatible bucket (for example Backblaze B2), written there by LiveKit.
  - **Who can watch:** members of the wave, through Cortex, which checks membership on every request. The bucket itself is private.
  - **Deleting:** the performer or wave staff can delete a recording, which removes the file from the bucket. Deleting the wave also removes its recordings.

---

## If You Follow a Public Page by Email

Anyone can ask to be kept posted about a public events page or portal wave without an account (v2.92.0). The server stores:

- **Your email**, encrypted (AES-256-GCM) with a hash for lookup, the same way account emails are held.
- **Your name**, if you give one.
- **Which pages you follow** and how often you want to hear.

How the address is handled:

- **Confirmation first.** Nothing is sent to an address until you confirm it, except the one confirmation email. Unconfirmed sign-ups are deleted after 7 days.
- **Unsubscribing deletes the record** rather than flagging it. Every email carries the same unsubscribe link.
- **Encrypted waves never send anything** to followers.

---

## Metadata Protections

Encrypting messages is table stakes. Cortex also protects the metadata around your activity:

- **Email addresses** — hashed + encrypted at rest; never stored in plaintext
- **IP addresses** — anonymized to /24 subnet before storage (e.g., 192.168.1.x); your exact IP is never written to disk
- **User-Agent strings** — truncated to browser and OS only; full fingerprint data is discarded
- **Timestamps** — activity timestamps rounded to 15-minute windows, session timestamps to 5-minute windows; precise timing cannot be reconstructed
- **Wave participation** — encrypted at rest; the database cannot reveal who is in which wave without the server's runtime key
- **Your list order** — the order you arrange your waves and Communities in is encrypted at rest with the same key, because a list of your waves is a list of the waves you are in (v2.121.0). The order of a Community's channels, and of the waves in a channel, is shared with its members and is not encrypted
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
- **Disappearing pings** — a ping sent with a timer, or in a wave that has one, is erased at that time: its text (or ciphertext), reactions, read receipts, edit history, pin, the notifications that quoted it, and the files its sender attached. Within about 15 seconds of the time the database holds none of it; before that, nobody is shown it. Allied ports erase their copies at the same time, but **a port running a version older than v2.122.0 keeps its copy**. Expiry cannot reach what someone has already seen, copied or screenshotted, push notifications or emails already delivered, or backups of the database taken while the ping existed, until those backups are themselves deleted (v2.122.0)
- **Attachments** — retained until their wave is deleted. A replaced profile picture is deleted. Deleting an account deletes its profile picture and profile videos (since v2.141.0; for accounts deleted earlier, the operator has to remove them).
- **Broadcast recordings** — retained until deleted by the performer or wave staff, or until the wave is deleted
- **Unconfirmed email follow sign-ups** — deleted after 7 days
- **Direct call history** — deleted after 90 days (v2.145.0)
- **Client version reports** — deleted 90 days after an install last reported (v2.146.0)
- **Account data** — retained until you delete your account

---

## Federation

When federation is enabled and your instance connects to other Cortex instances ("ports" in the Verse), some data crosses server boundaries:

**What is shared with federated instances:**
- Your handle, display name, and avatar (when you participate in cross-instance waves)
- Wave titles for federated waves
- Messages, as text the other server can read. End-to-end encryption does not yet work across servers: since v2.142.0 an encrypted wave cannot include people on other servers, and a wave that includes them cannot be encrypted. Before v2.142.0 the two could be combined; the people elsewhere then received ciphertext they could not read, and their own messages were stored as plain text inside the encrypted wave.

**Who can read a federated wave (v2.136.1):** a conversation with people on other servers is readable only by its people, on every server, and is sent only to the servers they are on. Only an instance admin can *broadcast* a wave to every allied server; a broadcast is readable by every account on every allied server, and on its own. Before v2.136.1 a server receiving a conversation let all its accounts read it.

**Invitations from other servers (v2.137.0):** being invited into a conversation on another server sends you a question on your own server, like a local invitation. Until you answer, your server stores only who asked, from which server, the conversation's title and how many people are in it; nothing of the conversation itself is sent to your server. Accepting tells their server yes and only then fetches the conversation; declining tells it no, never whether you also blocked the person. The inviting server keeps who it is waiting on (handle and server) until they answer, it is withdrawn, or it expires after 30 days. You can block people on other servers; the block is stored on your server by their address, declines their invitations, and stops you inviting them.

**People elsewhere in a conversation (v2.138.0):** the server a conversation lives on keeps a list of who is in it on other servers (their handle, server, display name and avatar), recorded when their server accepts an invitation or when they post, so the owner can see and remove them. It is deleted when they leave or are removed, or with the conversation. When nobody on a server is left in a conversation, that server deletes its copy and everything it cached of it. Muting someone on another server is stored on your server by their address.

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
- **Calendar events** — titles, dates, times, locations and descriptions are
  stored in plaintext, including events attached to an end-to-end encrypted
  wave. E2EE covers message content; it has never covered calendar entries. An
  event card shown inside an encrypted wave says so on the card itself.
- **Guest RSVP names**, and their email addresses via the moderator attendee
  list (see the guest RSVP section above)
- **Messages in waves that are not end-to-end encrypted**
- **Attached files and broadcast recordings**, in any wave (see above)
- **Direct call history**: who called whom, when and for how long (see above)
- **Dice rolls at a tabletop game** (v2.158.0, where the operator has turned
  the feature on): who rolled, in which wave, when, the dice (`1d20+5`), each
  die's face and the total, **including in an end-to-end encrypted wave**. The
  server does the rolling so nobody can fake one, so it has to know them. What
  a roll was for ("Stealth check") is part of the message and stays encrypted.
  The table's GMs can also see every roll at their table, even ones made for
  the GM only. Rolls are kept until the wave is deleted.

---

## What the Operator CANNOT See

Even with full database access, the operator cannot see:

- Message content in encrypted waves (they don't have the keys)
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
- **No third-party cookies.** Cortex uses JWT tokens in headers. Its only cookie is a first-party, 15-minute, HttpOnly cookie that lets your browser load private attachments. It is scoped to `/uploads` and is not a tracking cookie.
- **GIF providers.** If enabled by the operator, GIF search queries are sent to GIPHY and/or Klipy. Tenor was shut down by Google in 2026.
- **Calls, voice channels and live broadcasts.** If enabled by the operator, audio and video go through LiveKit (LiveKit Cloud or the operator's own LiveKit server). Voice channel media is encrypted so LiveKit cannot read it (v2.119.0); calls and broadcasts are not. LiveKit tells the server when people join and leave a room (a signed webhook), so others can see who is in a call or voice channel.
- **Broadcast recordings** are stored in the operator's S3-compatible bucket.
- **Email** is sent through the operator's mail provider, for example Resend or SMTP.

Cortex contacts these services only for the features above, and only when the operator has configured them.

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
