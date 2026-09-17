# Push notifications in a federated application

Written 2026-09-17, after asking what it would take to get native push working on the
second node. The answer turned out to be a design problem rather than a
configuration one, and it is the kind of thing that gets re-litigated every six
months unless it is written down.

**Decision for now: option A — do nothing.** Every node already has working push.
Options B and C below are the routes worth taking if that changes.

## The problem

Cortex federates. Anyone can run a node. But the Android app is published by one
party, and an FCM token belongs to **one Firebase project** — the project the app
was built against. Only that project's server credentials can push to it.

So "one app that works with any node" collides with "each node sends its own
push notifications". Solving it the obvious way — each operator builds and
publishes their own app — is not federation, it is twelve apps.

## Why the app cannot simply carry the credential

The instinct is to bundle the Firebase credentials in the app, encrypted, so
every node can use them. It does not work, for three separate reasons.

**`google-services.json` is not a secret and does not need protecting.** It
contains the project number, project id, storage bucket, app id, package name
and a client API key. Google documents it as non-sensitive, and it is
extractable from any published APK. There is nothing there to encrypt.

**The service account cannot be hidden in a client.** The credential that can
actually *send* is the service account JSON on the server. Shipping it inside
the app — encrypted or not — means shipping the decryption key too, because the
app has to decrypt it at runtime to use it. The attacker owns the device doing
the decrypting. This is not a question of algorithm strength.

**It would not help even if it were safe.** The app does not need the service
account. The app needs `google-services.json` to *obtain* a token; the server
needs the service account to *send* to that token. Putting server credentials on
the device does not give a node the ability to send.

That credential is also Firebase Admin — it can push to every Cortex user on
every node. Distributing it to every device would make each user a potential
sender to all users, which is a considerably larger problem than the one being
solved.

## Where things actually stand

Measured 2026-09-17:

| node | push subscriptions | native FCM | web push |
| --- | --- | --- | --- |
| farhold | 4 | **4** | 0 |
| PMP | 3 | 0 | **3** |

**Both nodes deliver push today.** farhold's users are on the native app; PMP's
are on the web. The second node is not missing notifications — it is missing a
store listing.

`client/capacitor.config.ts` hardcodes `server.url = https://cortex.farhold.com`,
so the published app always loads the first node whoever installs it, and FCM
registration only runs inside the Capacitor shell. A service account on the
second node would therefore sit waiting for tokens that can never arrive.

**Web push is already the federation-native answer.** Each node holds its own
VAPID keypair and pushes directly to the browser's push service. No shared
secret, no central party, nothing to coordinate between operators. It is FCM
that breaks federation, not Cortex.

## Options

### A. Leave it (current decision)

Web push for everyone; one native app, pointed at the first node.

Costs nothing and loses nothing except a store presence for other nodes. On
Android an installed PWA receives real push; iOS supports it in installed PWAs
from 16.4. The honest gap is discoverability and the home-screen icon, not
notifications.

### B. A push gateway

The shape Matrix settled on after hitting this exact wall (their implementation
is Sygnal). The app publisher runs a small relay holding the FCM and APNs
credentials. A node posts a push request to the relay; the relay forwards it to
Google or Apple.

One app, any number of nodes, and **no node ever holds the credential**.

Requires:
- the relay service, plus keeping it running — a new operational dependency
- a server picker in the app, and per-node authentication
- deep links that resolve to the right node

**Privacy constraint, decided up front:** the relay sees whatever the
notification carries. Cortex already does the right thing for encrypted waves —
it sends "Encrypted message — tap to read" rather than content — and a gateway
should use that shape for *everything*, waking the app to fetch rather than
carrying the message. Otherwise a relay run by one operator becomes a place
where other operators' conversations pass through in the clear, which is not a
thing to build into a privacy-first application by accident.

This also concentrates a dependency: if the relay is down, native push is down
everywhere. Web push would keep working, which is an argument for keeping both.

### C. UnifiedPush

The user chooses their own distributor (ntfy and similar); the app receives push
through it with no Google involvement. Genuinely decentralised, and the option
most in keeping with what Cortex is.

Android only, and it asks the user to install and understand a second app, so it
suits a minority of users. Worth considering **alongside** B rather than instead
of it.

### D. A build per node

Each operator publishes their own app with their own Firebase project. Rejected:
it is the thing federation exists to avoid, and it puts app-store maintenance on
every operator who wants notifications.

## Recommendation

Stay on A until a native app for a second node actually matters. When it does,
B is the answer, with C as a sympathetic addition rather than a replacement.

Do not start B in order to get one node into the Play Store — it introduces a
service that has to be run, monitored and trusted, and that is a decision to
make deliberately.

## The mistake to avoid

If B or C is ever built, the failure that costs an afternoon is this: **the
server's service account and the app's `google-services.json` must belong to the
same Firebase project.** Mismatch them and there is no error anywhere — the app
registers happily, the server sends happily, and nothing arrives.
