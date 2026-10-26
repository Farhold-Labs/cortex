# High availability: a warm standby in another provider

**Status: proposal (2026-10-26). Nothing here is built yet.**

On 2026-10-26 Bluehost's Ashburn site had an outage. The box at `50.6.203.21` hosts both farhold and PMP, so both nodes went down together, for hours, with nothing to fail over to. This document is the plan for making the next one a few minutes of reconnecting.

## Goals

| | Today | Target |
|---|---|---|
| **Data lost in a total loss of the box** (RPO) | up to 24 h (daily offsite backup) | seconds |
| **Time to serve again** (RTO) | until the provider recovers, or a manual rebuild from backup | 5–15 min at first (a person promotes), 2–3 min once promotion is automatic |
| **Survives** | a process crash | the loss of a box, a datacenter, or a whole provider |

Not goals: zero-downtime failover, active-active serving, or surviving the loss of Backblaze B2 *and* the primary at the same time.

## Principles

1. **The name moves, not an IP address.** Everything that talks to a node uses its domain: the browser, the Android and desktop apps (which load `cortex.farhold.com` at runtime), federation peers (which sign to and deliver to the name) and LiveKit's webhook. A floating or reserved IP only moves within one provider and usually one region. That is exactly the failure we just had.
2. **The standby is in a different provider and region.** A second Bluehost box in Ashburn would have gone down with the first.
3. **One writer, always.** Cortex is SQLite, so there is one writable database. Two primaries at once (split brain) produce two histories that can't be merged. Every part of this design defers to that rule, even at the cost of a slower failover.
4. **The two boxes never judge each other alone.** A box that can't reach its peer can't tell "the peer is down" from "the link between us is down". The decision rests on an outside witness: health checks run from several regions by the DNS provider.
5. **TLS stays end to end.** No proxy that terminates TLS in front of Cortex (see *Rejected options*).

## Architecture

```
                    DNS provider (health-checked failover records, TTL 60)
                    ├─ probes https://<node>/api/health from several regions
                    └─ answers PRIMARY's IP while healthy, else STANDBY's (if healthy)

  PRIMARY (Bluehost, Ashburn)                 STANDBY (other provider/region)
  ├─ nginx + certbot (DNS-01)                 ├─ nginx + certbot (DNS-01), valid cert
  ├─ cortex-api + cortex-web  RUNNING         ├─ cortex-api + cortex-web  STOPPED
  ├─ litestream replicate ─────────┐          ├─ same release, same .env, same keys
  ├─ crons (offsite backup, prune) │          └─ crons installed but lease-guarded
  └─ holds the lease               │
                                   ▼
                     B2: <node>-replica (encrypted WAL stream)
                     B2: uploads bucket (already shared)
                     B2: ha/<node>/lease  (who is primary, epoch)
```

The standby is **warm**: code, configuration, certificates and secrets are all in place. The API is stopped, and the database is restored from the replica only at promotion.

## 1. Routing

**Health-checked DNS failover**, using either:

- **AWS Route 53 failover records**, a primary and a secondary record each tied to a health check; or
- **Cloudflare Load Balancing in DNS-only mode** (grey cloud), with two pools.

Either one probes `/api/health` through nginx. When cortex-api is stopped, nginx returns 502, so a stopped or fenced node is "unhealthy" with no extra work. The resolver answers with the secondary only when the primary is unhealthy *and* the secondary is healthy. A dark standby therefore never receives traffic by accident: it becomes eligible only once promotion starts its API.

**TTL 60** on every record that should move. Today's records are 1800, so a failover would take up to 30 minutes to reach people. Lowering them is the first step and costs nothing.

**Records that move, per node:**
- farhold: `cortex.farhold.com`, plus `farhold.com` and `www` if they're served by the same box;
- PMP: `cortex.pottermckeanplayers.org`.

MX and mail records don't move: email goes out through Resend's API, not from the box.

**Failback is not automatic.** Both Route 53 and Cloudflare send traffic back to the primary as soon as it is healthy again. A primary returning from an outage holds stale data, so it must not become healthy on its own. That is the boot guard's job (§3).

### Rejected options

- **Cloudflare proxy (orange cloud).** It fails over in seconds and hides the server IPs. But Cloudflare would terminate TLS and see every request in plaintext: passwords, access and refresh tokens, and the content of every ping that isn't end-to-end encrypted. That isn't compatible with what `docs/PRIVACY.md` promises.
- **Floating or reserved IPs.** They only move within one provider and region.
- **Anycast with our own address space and BGP.** It works, but it's far beyond the scale and the operational budget of two nodes.
- **Two boxes heartbeating each other and promoting themselves.** This is split brain by design (principle 4).

## 2. Data

### Database: Litestream

[Litestream](https://litestream.io) runs beside cortex-api, as its own systemd service, and streams SQLite's write-ahead log to object storage about once a second. Cortex already runs in WAL mode (`journal_mode = WAL`, `server/database-sqlite.js`), which Litestream requires.

- **Replica:** one private B2 bucket per node (`farhold-replica`, `pmp-replica`), in that node's own B2 account. Use a key restricted to that bucket. The primary needs to write to it; the standby only needs to read.
- **Encryption:** the replica *is* the database. Field-level encryption covers emails, participation, push subscriptions and crew membership, but not ping text in waves that aren't end-to-end encrypted. So the replica must be encrypted before it leaves the box, using Litestream's `age` replica encryption, and not only B2's server-side encryption. The standby must hold the private key for this, unlike the offsite backups, whose private key is only on the dev box.
- **Promotion:** `litestream restore -o data/farhold.db <replica>` on the standby. At these database sizes it takes seconds.
- **Verification:** a daily job on the standby restores the replica into a scratch path and runs the same checks as `tools/backup-release-db.sh`: non-empty, `integrity_check`, and a `users` table. A replica nobody has restored is a hope, not a backup.
- **Unchanged:** the daily GPG offsite backups (`tools/offsite-backup.sh`) and the release backups stay as they are. Litestream protects against losing the box. The offsite backups protect against a bad write being faithfully replicated.

> **To check first:** whether either node runs SQLCipher (`DB_ENCRYPTION_KEY`). Litestream doesn't support SQLCipher-encrypted databases as far as I know, so that would need a different replication method. Confirm against the Litestream version we'd install.

### Everything else the standby needs

| Item | Plan |
|---|---|
| Uploads | already in B2 (`STORAGE_PROVIDER=s3`) and served through Cortex. Same `S3_*` keys on the standby; nothing to copy |
| Broadcast recordings | already in B2 (`RECORDING_S3_*`, PMP); same keys |
| `server/.env` | **byte-identical** to the primary's, apart from anything host-specific. `JWT_SECRET` and the four field-encryption keys must match, or every session dies and encrypted fields are unreadable (the "wrong key" banner, v2.105.5). The federation private key must match, or peers reject the node's signatures. Sync it with each release, and diff its checksum in the drill |
| `firebase-service-account.json`, `ecosystem.config.*` | copied with `.env` |
| LiveKit | LiveKit Cloud; the webhook targets the domain. The voice roster rebuilds itself within 10 s of start-up (reconcile loop) |
| Resend, VAPID, FCM | API keys and credentials only; nothing tied to the host |
| Code | the **same release** as the primary, deployed on every release (§5) |

### State that is lost in a failover, by design

These live only in the cortex-api process, so they don't need replicating:
- WebSocket connections: clients reconnect within about 15 s, thanks to the 10 s heartbeat;
- rate-limit counters (`express-rate-limit`, in-memory store);
- HLS proxy state for Jellyfin and Plex;
- the voice roster cache, which reconcile rebuilds.

Sessions, refresh tokens, the federation queue and every sweep's state are in the database, so they survive.

## 3. Who is primary: the lease and the boot guard

A small object in B2, `ha/<node>/lease`, records `{ "primary": "<box name>", "epoch": <n>, "since": "<ISO time>" }`.

- **Promotion** writes a lease that names the standby, with `epoch + 1`, *before* starting anything.
- **The boot guard,** `tools/ha-guard.sh`, runs before cortex-api starts (a pm2 pre-start step or systemd `ExecStartPre`) and before every cron job. It reads the lease. If the lease names another box, it refuses: the API stays down, so nginx returns 502, the DNS health check marks the box unhealthy, and no traffic comes back to it.
- **Fail closed:** if the lease can't be read (B2 is unreachable), the guard refuses too. A deliberate override for that case, `HA_GUARD_OVERRIDE=1` for one start, is logged loudly.
- **Background jobs:** cortex-api runs 14 `setInterval` loops in-process: expiry and attachment sweeps, recording settlement, voice reconcile, the federation queue, reminders and digests. They run only where the API runs, so the guard covers them. If two APIs ever ran at once, people would get every email and push twice and federation messages would be delivered twice. That's another reason the guard exists.

B2 offers no reliable compare-and-swap on an object, so this lease is a **fence for a promotion a person has decided on**. It is not a distributed lock. That's enough while a person runs promotion. Fully automatic promotion (Phase 4) needs a real arbiter, such as a third small box acting as witness, or a store with conditional writes.

## 4. Failover runbook

**Detection:** the DNS provider's health check alarms after N failed probes from several regions (N = 3 at a 30 s interval, so about 90 s), and notifies Jared by email or SMS.

**Promotion,** a single command on the standby, `tools/ha-promote.sh <node>`:

1. **Confirm independently.** The standby checks that the primary's `/api/health` fails from where it is too. If the primary is healthy from here, stop: the problem is probably the health checks' view, not the box.
2. **Take the lease** (epoch + 1).
3. **Try to stop the old primary,** best effort, with an `ssh … pm2 stop cortex-api` and a short timeout. Usually it won't answer; the lease covers that case.
4. **Restore the database** from the replica, then run the verification checks. If they fail, stop and fall back to the newest offsite backup, and say how old it is.
5. **Start** cortex-api, cortex-web and `litestream replicate`, which now replicates *from* the standby into a fresh generation.
6. **Wait** for the DNS health check to mark the standby healthy. The failover record then switches by itself, within the TTL.
7. **Verify from outside:** `/api/health`, `sw.js` `CACHE_NAME`, the main bundle returns 200, a made-up `/assets/…js` returns 404. Then post a status notice.

**What people see:** with a 60 s TTL, most clients reconnect within a few minutes of promotion. Federation peers keep retrying during the gap: the queue backs off 5, 25, 125 and 625 minutes, about 13 hours in total, before marking a delivery failed (`server/database-sqlite.js`). Outages shorter than that lose nothing inbound.

## 5. Failback and releases

**Failback is a planned move, never automatic.** Often the right answer is to stay: if the standby's hardware is adequate, it simply becomes the primary and the old box becomes the standby. Moving back is a promotion in the other direction, done at a quiet hour:
1. stop the API on the current primary;
2. let Litestream flush and confirm the replica is current;
3. promote the other box with the same runbook.

**Releases must deploy to both boxes.** The standby restores a database the primary has already migrated, so the standby's code must be the same release. Migrations are additive and idempotent, but code older than its database isn't something we test. The release train gains one step: deploy the standby, with its API left stopped, and check its version file. The client `dist` is built on the dev box and shipped to both, as now: the small boxes OOM on remote builds.

## 6. Certificates

Today certbot proves control of the domain over HTTP, which only works on the box the name currently points at. A standby kept dark would never renew.

- **Plan:** switch both boxes to **DNS-01** challenges with the DNS provider's certbot plugin. Use a token limited to TXT records, if the provider allows that, kept in root-only files. Both boxes then renew on their own, whichever is primary.
- **Fallback:** if a provider can't issue a scoped token, copy the primary's certificates to the standby weekly. Certificates last 90 days, so a week-old copy is fine. But this sync breaks exactly when the primary is gone for a long time, so treat it as second best.

## 7. Where the standbys live

The two old DigitalOcean droplets (`147.182.175.15`, farhold's old box, and `137.184.55.252`, PMP's) are still running, with their APIs stopped and nginx forwarding to Bluehost. They are on a different provider, which makes them obvious candidates instead of decommissioning them. Before choosing them:
- confirm their region and size against `docs/DEPLOYMENT.md` §0;
- upgrade the OS and install the current release;
- remove the forwarding nginx config, since the standby serves its own name;
- clear any stale data left from before the cutover.

The new boxes needn't mirror the current pairing. One standby can host both nodes as two users, the way the Bluehost box does. That's cheaper, but then a standby failure is shared too.

## 8. Testing

- **A drill on the lab nodes first:** QA as primary and port1 as standby, with a test subdomain on public DNS (or a hosts-file client, for the parts that don't need DNS). Promote, write while promoting, fail back. Confirm no pings were lost, sessions survived and no email went out twice.
- **Counterfactual for the guard:** start an old primary with the guard bypassed, and show that the duplicate-email and stale-data symptoms appear. This proves the guard is what prevents them, the same rule as security fixes.
- **Then a drill in production,** at a quiet hour, announced first, once a quarter.

## Phases

| Phase | Work | Value on its own |
|---|---|---|
| 0 | TTLs to 60 (Jared) | any later failover lands in minutes, not half an hour |
| 1 | Litestream on farhold and PMP, plus daily restore verification | data loss falls from a day to seconds, even without a standby |
| 2 | standby boxes: release, `.env` parity, DNS-01 certificates, API stopped | a manual rebuild becomes a manual promotion |
| 3 | health-checked DNS failover, alarms, `ha-guard.sh`, `ha-promote.sh`, the drill | the runbook in §4 |
| 4 | *optional:* automatic promotion with a third-party witness | about 2–3 min RTO without waiting for a person |

## Open questions

1. **Where are the zones hosted?** That decides whether health-checked failover and DNS-01 are available as they are, or whether the zones move (Route 53, or Cloudflare DNS-only). PMP's domain may be controlled by PMP, not by us.
2. **Does either node use SQLCipher?** (§2)
3. **Is the standby box allowed to hold the replica's decryption key?** It has to, to restore; the offsite backups were deliberately set up the other way.
4. **What's the budget?** Health checks and failover records cost a few dollars a month per node. The standby box costs whatever the droplets already cost.
5. **Who gets the alarm, and how?** Jared alone means promotion waits for Jared.
