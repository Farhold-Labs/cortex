# Federation Testing Checklist

> **Historical document.** Written against v1.13.0. Federation has changed substantially since — re-broadcast, per-wave settings propagation and history backfill all postdate it. Kept for the reasoning behind the design, not as a description of how Cortex works today — see CHANGELOG.md and docs/API.md for current behaviour.

**Version:** v1.13.0
**Last Updated:** December 2025

This checklist covers end-to-end testing of the Cortex federation feature.

---

## Prerequisites

### Environment Setup

- [ ] **Server A** running on port 3001 (e.g., `cortex-a.local`)
- [ ] **Server B** running on port 3002 (e.g., `cortex-b.local`)
- [ ] Both servers have `FEDERATION_ENABLED=true`
- [ ] Both servers have unique `FEDERATION_NODE_NAME` values
- [ ] Both servers using SQLite (`USE_SQLITE=true`) for full federation support
- [ ] Admin accounts on both servers

### Test Accounts

| Server | Handle | Role | Password |
|--------|--------|------|----------|
| Server A | `admin-a` | Admin | (your password) |
| Server A | `user-a` | User | (your password) |
| Server B | `admin-b` | Admin | (your password) |
| Server B | `user-b` | User | (your password) |

---

## 1. Server Identity Setup

### 1.1 Generate Identity (Server A)

- [ ] Login as admin on Server A
- [ ] Navigate to Profile Settings → Federation (admin section)
- [ ] Click "Generate Identity"
- [ ] Verify RSA public key is displayed
- [ ] Verify node name matches `FEDERATION_NODE_NAME`

### 1.2 Generate Identity (Server B)

- [ ] Repeat steps for Server B
- [ ] Confirm different public key generated

### 1.3 Identity Endpoint Test

```bash
# Test Server A identity endpoint (no auth required)
curl http://localhost:3001/api/federation/identity

# Expected: { nodeName, publicKey, createdAt }
```

- [ ] Returns 200 with valid JSON
- [ ] Public key is PEM format
- [ ] Node name matches configuration

---

## 2. Node Trust Setup

### 2.1 Add Server B as Trusted Node (on Server A)

- [ ] In Federation panel, click "Add Node"
- [ ] Enter Server B's node name
- [ ] Enter Server B's base URL (e.g., `http://localhost:3002`)
- [ ] Node appears in list with status "pending"

### 2.2 Add Server A as Trusted Node (on Server B)

- [ ] Repeat for Server A on Server B
- [ ] Both nodes show as "pending"

### 2.3 Initiate Handshake

- [ ] On Server A, click "Handshake" for Server B node
- [ ] Verify Server B's public key is fetched and stored
- [ ] Status changes to "active"
- [ ] On Server B, click "Handshake" for Server A node
- [ ] Both nodes show "active" status

### 2.4 Handshake API Test

```bash
# Get nodes list (admin auth required)
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/api/admin/federation/nodes

# Expected: { nodes: [{ id, nodeName, baseUrl, status, publicKey, ... }] }
```

- [ ] Returns list of trusted nodes
- [ ] Active nodes have public keys populated

---

## 3. User Resolution

### 3.1 Resolve Local User

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/api/users/resolve/admin-a

# Expected: { user: { ..., isLocal: true } }
```

- [ ] Returns local user with `isLocal: true`

### 3.2 Resolve Federated User

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/api/users/resolve/@user-b@cortex-b.local

# Expected: { user: { ..., isLocal: false, nodeName: "cortex-b.local" } }
```

- [ ] Returns federated user with `isLocal: false`
- [ ] User is cached in `remote_users` table
- [ ] Subsequent requests return cached data

### 3.3 Invalid User Resolution

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/api/users/resolve/@nonexistent@unknown.server

# Expected: 404 error
```

- [ ] Returns 404 for unknown federated users

---

## 4. Federated Wave Creation

### 4.1 Create Wave with Federated Participant

On Server A as `user-a`:

- [ ] Create new wave with title "Federation Test"
- [ ] Add local participant: `admin-a`
- [ ] Add federated participant: `@user-b@cortex-b.local`
- [ ] Wave created successfully

### 4.2 Verify Wave Invitation Sent

- [ ] Check Server A logs for outbound federation message
- [ ] Message type should be `wave_invite`
- [ ] Check `federation_queue` table if message queued

### 4.3 Verify Wave Received on Server B

On Server B as `user-b`:

- [ ] Wave appears in wave list
- [ ] Wave shows correct title and participants
- [ ] Wave marked as federated (participant server)

---

## 5. Federated Droplet Exchange

### 5.1 Send Droplet from Origin Server

On Server A as `user-a`:

- [ ] Open federated wave
- [ ] Send droplet: "Hello from Server A!"
- [ ] Droplet appears locally

### 5.2 Verify Droplet Received on Participant Server

On Server B as `user-b`:

- [ ] Droplet appears in wave
- [ ] Author shown as `user-a@cortex-a.local`
- [ ] Content matches original
- [ ] Droplet stored in `remote_droplets` table

### 5.3 Send Reply from Participant Server

On Server B as `user-b`:

- [ ] Reply to droplet: "Hello from Server B!"
- [ ] Reply appears locally

### 5.4 Verify Reply Received on Origin Server

On Server A:

- [ ] Reply appears in wave thread
- [ ] Author shown as `user-b@cortex-b.local`

---

## 6. Droplet Edit/Delete Propagation

### 6.1 Edit Droplet on Origin

On Server A as `user-a`:

- [ ] Edit original droplet to "Hello from Server A! (edited)"
- [ ] Edit appears locally

### 6.2 Verify Edit Propagated

On Server B:

- [ ] Edit appears in wave
- [ ] Edit history shows version change

### 6.3 Delete Droplet

On Server A as `user-a`:

- [ ] Delete a droplet
- [ ] Droplet removed/marked deleted locally

### 6.4 Verify Deletion Propagated

On Server B:

- [ ] Droplet shows as deleted or removed
- [ ] Thread structure maintained if replies exist

---

## 7. Message Queue & Retry

### 7.1 Test Queue Processing

- [ ] Stop Server B temporarily
- [ ] Send droplet from Server A
- [ ] Check `federation_queue` table - message should be queued
- [ ] Start Server B
- [ ] Wait for queue processor (30s interval)
- [ ] Verify message delivered after retry

### 7.2 Verify Exponential Backoff

- [ ] Check queue entries for increasing `next_retry_at` times
- [ ] Backoff pattern: 1min → 5min → 25min → 2hr → 10hr

### 7.3 Queue Cleanup

- [ ] Verify old messages (>7 days) are cleaned up

---

## 8. HTTP Signature Verification

### 8.1 Valid Signature

- [ ] All server-to-server requests succeed
- [ ] Check logs for signature verification success

### 8.2 Invalid Signature Rejection

```bash
# Send request without proper signature
curl -X POST http://localhost:3001/api/federation/inbox \
  -H "Content-Type: application/json" \
  -d '{"id":"test","type":"ping","payload":{}}'

# Expected: 401 Unauthorized
```

- [ ] Unsigned requests rejected with 401

### 8.3 Unknown Node Rejection

- [ ] Requests from untrusted nodes rejected
- [ ] Proper error message returned

---

## 9. Inbox Deduplication

### 9.1 Duplicate Message Handling

- [ ] Send same message ID twice
- [ ] First request processed
- [ ] Second request returns success without reprocessing
- [ ] Check `federation_inbox_log` for entry

---

## 10. Error Handling

### 10.1 Network Failure Recovery

- [ ] Disconnect Server B mid-operation
- [ ] Server A queues message
- [ ] Reconnect Server B
- [ ] Message eventually delivered

### 10.2 Invalid Payload Handling

- [ ] Send malformed inbox message
- [ ] Server returns appropriate error
- [ ] No crash or data corruption

### 10.3 Rate Limiting

- [ ] Send >500 requests/minute from federated node
- [ ] Rate limiting kicks in
- [ ] Proper 429 response

---

## 11. UI Verification

### 11.1 Federation Admin Panel

- [ ] Panel only visible to admins
- [ ] Shows federation enabled/disabled status
- [ ] Node list displays correctly
- [ ] Add/remove/handshake buttons work
- [ ] Status indicators accurate

### 11.2 Federated User Display

- [ ] Federated users show `@handle@server` format
- [ ] Avatar/display name loaded from remote
- [ ] Profile modal works for federated users

### 11.3 Wave Participant List

- [ ] Local and federated users distinguished
- [ ] Server indicator for federated users

---

## 12. Database Integrity

### 12.1 Local Tables

```sql
-- Check federation tables exist
.tables
-- Should include: server_identity, federation_nodes, remote_users,
-- remote_droplets, wave_federation, federation_queue, federation_inbox_log
```

- [ ] All federation tables created
- [ ] Indexes exist for performance

### 12.2 Data Consistency

- [ ] `wave_federation` links waves to nodes correctly
- [ ] `remote_users` caches valid user data
- [ ] `remote_droplets` stores federated content

---

## 13. Security Checks

### 13.1 Key Security

- [ ] Private key never exposed in API responses
- [ ] Private key never logged
- [ ] Key stored securely in database

### 13.2 Trust Boundary

- [ ] Only admin can manage federation nodes
- [ ] Only trusted nodes can send messages
- [ ] User cannot bypass federation checks

### 13.3 Content Validation

- [ ] Federated content sanitized before display
- [ ] XSS attacks in federated droplets blocked

---

## Test Results Summary

| Category | Pass | Fail | Blocked |
|----------|------|------|---------|
| Server Identity | | | |
| Node Trust | | | |
| User Resolution | | | |
| Wave Creation | | | |
| Droplet Exchange | | | |
| Edit/Delete | | | |
| Message Queue | | | |
| HTTP Signatures | | | |
| Deduplication | | | |
| Error Handling | | | |
| UI | | | |
| Database | | | |
| Security | | | |
| **TOTAL** | | | |

---

## Notes & Issues

Record any issues discovered during testing:

| # | Category | Description | Severity | Status |
|---|----------|-------------|----------|--------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

---

## Sign-off

- [ ] All critical tests passed
- [ ] No high-severity issues outstanding
- [ ] Ready for production deployment

**Tested By:** ________________
**Date:** ________________
**Version:** v1.13.0
