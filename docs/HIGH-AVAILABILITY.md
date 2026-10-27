# High availability: a warm standby in another provider

**Status: proposal (2026-10-26).**
- **Phase 0:** done for farhold, which is on Cloudflare with `cortex` at TTL 60. PMP's zone hasn't moved.
- **Phase 2:** largely done. The standby box exists, has the primary's configuration, and renews farhold's certificates itself.
- **Phases 1, 3 and 4:** not started. See *Current state*.

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

**TTL 60** on every record that should move. The Squarespace records were at 1800, so a failover would have taken up to 30 minutes to reach people. `cortex.farhold.com` has been at 60 since the zone moved to Cloudflare on 2026-10-26.

**Moving a zone: check every record by name, against the old nameservers.** When `farhold.com` moved from Squarespace to Cloudflare on 2026-10-26, Cloudflare's import missed five records:
- `cortex` (A);
- `send` (CNAME, used for Resend);
- `purelymail1` to `purelymail3._domainkey` (CNAMEs, email signing).

The zone also has a wildcard, `*.farhold.com`, pointing at a home IP. Every missing name silently fell through to it, so lookups still succeeded with a wrong address instead of failing. The app was down until the records were re-added.

The old nameservers keep answering for a while after the switch. Compare each expected name on both with `dig +short <type> <name> @<old ns>` and `@<new ns>`, before and after changing the nameservers.

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

HTTP challenges only work on the box the name currently points at, so a standby kept dark would never renew. **Both boxes renew farhold's certificates by DNS-01** (since 2026-10-26):

- **Plugin:** `python3-certbot-dns-cloudflare`.
- **Credentials:** `/root/.secrets/cloudflare-farhold.ini` on each box, mode 600. It holds a Cloudflare API token limited to Zone → DNS → Edit on `farhold.com`, and it can see no other zone.
- **Certificates:** `cortex.farhold.com` and `farhold.com` (with `www`). Each was switched with `certbot reconfigure -a dns-cloudflare --dns-cloudflare-credentials … --dns-cloudflare-propagation-seconds 30`, and `certbot renew --dry-run` succeeds on both boxes.
- **Each box renews its own copy.** Two certificates for the same names are fine; Let's Encrypt's duplicate limit is 5 a week.
- **Trade-off:** root on either box can rewrite the `farhold.com` zone. A box serving the domain is already trusted with about that much.

**PMP's domain is not on Cloudflare,** so `cortex.pottermckeanplayers.org` still renews over HTTP:
- On the primary this works, because the name points there.
- On the standby its renewal file has `autorenew = False`, so a real `certbot renew` skips it. `--dry-run` simulates every certificate regardless, so a dry run there reports PMP's as failed. That's expected.
- **Until the domain moves,** copy that certificate from the primary after each renewal. It expires 2027-01-02. Certificates last 90 days, so a copy a few weeks old is fine, but the copy breaks exactly when the primary is gone for a long time.

## 7. Where the standby lives

**One new box, `201.79.38.210`** (see *Current state*), outside Bluehost, hosting both nodes as two users the way the Bluehost box does. That's cheaper than one per node, but a standby failure is shared too.

**Considered and not used:** the two old DigitalOcean droplets, `147.182.175.15` (farhold's old box) and `137.184.55.252` (PMP's). They're still running, with their APIs stopped and nginx forwarding to Bluehost, and remain on the decommission list.

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

## Current state

**Standby box: `201.79.38.210`** (hostname `Cortex`; region `mkc1` in its metadata). Set up 2026-10-26 to match the Bluehost primary:
- Ubuntu 24.04, Node 24, pm2 7, nginx, ffmpeg, Litestream 0.5.17 (installed, its service disabled), 2 GB swap, UTC;
- users `cortex` (farhold, ports 3000/3001) and `pmp` (PMP, 3010/3011), key-only and without sudo, each with a pm2 boot unit and an empty process list;
- the same firewall as the primary: 22 rate-limited (the home IP exempt), 80 and 443, plus fail2ban for sshd; root login key-only;
- v2.122.0 installed in each user's `~/cortex`, prebuilt `dist`. Nothing running. `~/.config/cortex/ha-role` records `role=standby`.

**Copied from the primary on 2026-10-26** (sha256 matches):
- both `server/.env` files, both `ecosystem.config.cjs` files, farhold's `firebase-service-account.json`;
- both `~/.config/cortex` offsite configs;
- `/etc/letsencrypt`, the three nginx sites with `conf.d/websocket-upgrade.conf`, and `/var/www/farhold-landing`.

The sites are enabled, and certbot's timer is on: farhold's certificates renew here by DNS-01, and PMP's is skipped (§6). Checked with `curl --resolve` against the standby, with certificates valid:
- `cortex.farhold.com` and `cortex.pottermckeanplayers.org` return **502** for `/api/health`, because the API is stopped. That is the "not ready" a health check should see.
- `farhold.com` returns 200 (the static landing page).

The standby can also list both offsite buckets: the newest backups are `farhold-20261026-031501` and `pmp-20261026-033501`.

**Still to do, and what each step waits on:**

| Step | Waits on |
|---|---|
| PMP's certificate by DNS-01. Until then, copy it from the primary after each renewal (it expires 2027-01-02) | moving `pottermckeanplayers.org` to Cloudflare, which is PMP's call, or a `cortex` CNAME into a zone we control |
| re-copy `.env` and the ecosystem files whenever they change on the primary | a sync step in the release train |
| Litestream on the primaries, and the replica buckets | a B2 bucket and key in each B2 account |
| `ha-guard.sh`, `ha-promote.sh`, the health checks, the drill | Phase 3 |

**What a takeover could do today:** restore the newest offsite backup, losing up to a day of data. The backups decrypt only with the private key on the dev box (open question 3), so that box is part of the path.

## Open questions

1. ~~Where are the zones hosted?~~ `farhold.com` moved from Squarespace to Cloudflare (DNS-only) on 2026-10-26. **Still open:** who controls `pottermckeanplayers.org`, and whether it can move too.
2. **Does either node use SQLCipher?** (§2)
3. **Is the standby box allowed to hold the replica's decryption key?** It has to, to restore; the offsite backups were deliberately set up the other way.
4. **What's the budget?** Health checks and failover records cost a few dollars a month per node. The standby box costs whatever the droplets already cost.
5. **Who gets the alarm, and how?** Jared alone means promotion waits for Jared.
