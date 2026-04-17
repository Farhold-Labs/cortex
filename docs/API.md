# Cortex REST API Documentation

Version: 2.47.2

## Overview

The Cortex API is a RESTful API that powers the Cortex federated communication platform (formerly Cortex). All endpoints return JSON responses and require `Content-Type: application/json` headers for requests with body content.

### Terminology (v2.0.0)
- **Ping** = message (formerly "droplet")
- **Burst** = break-out thread (formerly "ripple")
- **Crew** = user group (formerly "group")

> **Note:** The API maintains backward compatibility with the old endpoint names (`/api/droplets/*`, `/api/groups/*`) while also supporting new names (`/api/pings/*`, `/api/crews/*`).

**Base URL:** `http://localhost:3001` (development)

**Content-Type:** `application/json`

## Table of Contents

1. [Authentication](#authentication)
2. [Rate Limiting](#rate-limiting)
3. [Error Responses](#error-responses)
4. [Endpoints](#endpoints)
   - [Authentication](#authentication-endpoints)
   - [Users](#users-endpoints)
   - [Profile](#profile-endpoints)
   - [Contacts](#contacts-endpoints)
   - [Groups/Crews](#groups-endpoints)
   - [Waves](#waves-endpoints)
   - [Messages](#messages-endpoints)
   - [Pings](#pings-endpoints)
   - [Search](#search-endpoint)
   - [GIFs](#gifs-endpoints)
   - [Uploads](#uploads-endpoints)
   - [Embeds](#embeds-endpoints)
   - [Push Notifications](#push-notifications-endpoints)
   - [Moderation](#moderation-endpoints)
   - [Admin](#admin-endpoints)
   - [Reports](#reports-endpoints)
   - [Maintenance](#maintenance-endpoints)
   - [Federation](#federation-endpoints)
   - [Crawl Bar](#crawl-bar-endpoints)
5. [WebSocket API](#websocket-api)

---

## Authentication

Cortex uses **JWT (JSON Web Tokens)** for authentication. After successful login or registration, you'll receive a token that must be included in subsequent requests.

### Token Format

All authenticated endpoints require an `Authorization` header with a Bearer token:

```
Authorization: Bearer <your-jwt-token>
```

### Token Lifecycle

- **Expiration:** 7 days (configurable via `JWT_EXPIRES_IN` environment variable)
- **Refresh:** No automatic refresh; users must re-authenticate after expiration
- **Logout:** Tokens are not invalidated server-side; logout only updates user status

### Example Authentication Flow

```bash
# 1. Register or login to get a token
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"handle": "mal", "password": "demo123"}'

# Response:
# {
#   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
#   "user": { ... }
# }

# 2. Use the token in subsequent requests
curl http://localhost:3001/api/waves \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## Rate Limiting

Cortex implements rate limiting to prevent abuse. Rate limits are enforced per IP address and tracked in-memory.

### Global Rate Limits

| Endpoint Category | Requests | Window | Configurable Via |
|-------------------|----------|--------|------------------|
| **Login** | 30 | 15 minutes | `RATE_LIMIT_LOGIN_MAX` |
| **Registration** | 15 | 1 hour | `RATE_LIMIT_REGISTER_MAX` |
| **General API** | 300 | 1 minute | `RATE_LIMIT_API_MAX` |
| **GIF Search** | 30 | 1 minute | `RATE_LIMIT_GIF_MAX` |
| **oEmbed** | 30 | 1 minute | `RATE_LIMIT_OEMBED_MAX` |

### Rate Limit Headers

Responses include standard rate limit headers:

```
RateLimit-Limit: 300
RateLimit-Remaining: 299
RateLimit-Reset: 1734567890
```

### Account Lockout

Failed login attempts trigger account lockout:

- **Threshold:** 15 failed attempts (configurable via `LOCKOUT_THRESHOLD`)
- **Duration:** 15 minutes (configurable via `LOCKOUT_DURATION_MINUTES`)
- **Scope:** Per handle/username

---

## Error Responses

All errors follow a consistent JSON format:

```json
{
  "error": "Human-readable error message"
}
```

### Common HTTP Status Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| `400` | Bad Request | Missing required fields, invalid input format |
| `401` | Unauthorized | Missing or invalid authentication token |
| `403` | Forbidden | Insufficient permissions for requested action |
| `404` | Not Found | Requested resource doesn't exist |
| `409` | Conflict | Resource already exists (e.g., duplicate handle) |
| `429` | Too Many Requests | Rate limit exceeded or account locked |
| `500` | Internal Server Error | Server-side error (check logs) |

---

## Endpoints

### Authentication Endpoints

#### POST /api/auth/register

Register a new user account.

**Authentication:** Not required

**Rate Limit:** 15 requests per hour

**Request Body:**

```json
{
  "handle": "mal",
  "email": "mal@serenity.ship",
  "password": "demo123",
  "displayName": "Malcolm Reynolds"
}
```

**Validation Rules:**

- `handle`: 3-20 characters, letters/numbers/underscores only
- `email`: Valid email format
- `password`: Min 8 characters, must contain uppercase, lowercase, and number
- `displayName`: Optional, max 50 characters

**Response (201 Created):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-550e8400-e29b-41d4-a716-446655440000",
    "handle": "mal",
    "email": "mal@serenity.ship",
    "displayName": "Malcolm Reynolds",
    "avatar": "M",
    "avatarUrl": null,
    "bio": null,
    "nodeName": "Local",
    "status": "online",
    "isAdmin": false,
    "preferences": {
      "theme": "firefly",
      "fontSize": "medium"
    }
  }
}
```

**Errors:**

- `400`: Invalid handle format, invalid email, weak password
- `409`: Handle or email already exists

---

#### POST /api/auth/login

Authenticate an existing user.

**Authentication:** Not required

**Rate Limit:** 30 requests per 15 minutes

**Request Body:**

```json
{
  "handle": "mal",
  "password": "demo123"
}
```

**Response (200 OK):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-550e8400-e29b-41d4-a716-446655440000",
    "handle": "mal",
    "email": "mal@serenity.ship",
    "displayName": "Malcolm Reynolds",
    "avatar": "M",
    "avatarUrl": "/uploads/avatars/user-550e8400-1734567890.webp",
    "bio": "Captain of Serenity",
    "nodeName": "Local",
    "status": "online",
    "isAdmin": true,
    "preferences": {
      "theme": "firefly",
      "fontSize": "medium"
    }
  }
}
```

**Errors:**

- `400`: Missing handle or password
- `401`: Invalid credentials
- `429`: Account locked due to too many failed attempts

---

#### GET /api/auth/me

Get current authenticated user's information.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "id": "user-550e8400-e29b-41d4-a716-446655440000",
  "handle": "mal",
  "email": "mal@serenity.ship",
  "displayName": "Malcolm Reynolds",
  "avatar": "M",
  "avatarUrl": "/uploads/avatars/user-550e8400-1734567890.webp",
  "bio": "Captain of Serenity",
  "nodeName": "Local",
  "status": "online",
  "isAdmin": true,
  "preferences": {
    "theme": "firefly",
    "fontSize": "medium"
  }
}
```

---

#### POST /api/auth/logout

Log out the current user (updates status to offline, revokes session).

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true
}
```

---

#### POST /api/auth/refresh

Refresh the current session by issuing a new JWT token. Requires a valid (non-expired) token and the user's password. Revokes the old session and creates a new one. Rate-limited.

**Authentication:** Required (token must not be expired)

**Request Body:**

```json
{
  "password": "string (required)",
  "sessionDuration": "24h | 7d | 30d (optional, defaults to 24h)"
}
```

**Response (200 OK):**

```json
{
  "token": "eyJhbGc...",
  "sessionDuration": "24h",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "handle": "mal",
    "email": "mal@serenity.ship",
    "displayName": "Malcolm Reynolds",
    "avatar": "🚀",
    "avatarUrl": null,
    "bio": null,
    "nodeName": "farhold.com",
    "status": "online",
    "isAdmin": true,
    "role": "admin",
    "preferences": { "theme": "serenity", "fontSize": "medium" }
  }
}
```

**Response (401 Unauthorized):**

```json
{
  "error": "Invalid password"
}
```

*Added in v2.29.0*

---

### Session Management (v1.18.0)

#### GET /api/auth/sessions

List all active sessions for the current user.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "sessions": [
    {
      "id": "sess-550e8400-e29b-41d4-a716-446655440000",
      "deviceInfo": "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:146.0)",
      "ipAddress": "192.168.1.100",
      "createdAt": "2025-12-23T10:00:00.000Z",
      "lastActive": "2025-12-23T15:30:00.000Z",
      "expiresAt": "2025-12-30T10:00:00.000Z",
      "isCurrent": true
    }
  ],
  "enabled": true
}
```

---

#### POST /api/auth/sessions/:id/revoke

Revoke a specific session (cannot revoke current session via this endpoint).

**Authentication:** Required

**URL Parameters:**

- `id` (string, required): Session ID to revoke

**Response (200 OK):**

```json
{
  "success": true
}
```

**Response (400 Bad Request):**

```json
{
  "error": "Use logout to revoke current session"
}
```

---

#### POST /api/auth/sessions/revoke-all

Revoke all sessions except the current one.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true,
  "revokedCount": 3
}
```

---

#### POST /api/auth/renew

Silently renew a session token without requiring a password. Used for auto-renewal when a session is approaching expiry. Preserves the original session duration.

**Authentication:** Required (valid, non-expired token)

**Rate Limit:** 1 request per 5 minutes per client

**Request Body:** None required

**Response (200 OK):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Responses:**
- `401 TOKEN_EXPIRED` — Token is already expired; use `/api/auth/reauth` instead

---

#### POST /api/auth/reauth

Re-authenticate after session expiry using a password. Accepts tokens expired within the last hour (grace period). Issues a new token with the user's chosen session duration.

**Authentication:** Required (token may be expired within the last hour)

**Request Body:**

```json
{
  "password": "your-password",
  "sessionDuration": "7d"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `password` | string | Yes | User's current password |
| `sessionDuration` | string | No | `24h`, `7d`, or `30d` (defaults to previous duration) |

**Response (200 OK):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Responses:**
- `401` — Password incorrect
- `403` — Token expired more than 1 hour ago; full login required

---

### Account Management (v1.18.0 GDPR)

#### GET /api/account/export

Download all personal data as JSON (GDPR data export).

**Authentication:** Required

**Rate Limit:** 5 requests per hour

**Response (200 OK):**

```json
{
  "exportedAt": "2025-12-23T15:30:00.000Z",
  "user": {
    "id": "user-550e8400-e29b-41d4-a716-446655440000",
    "handle": "mal",
    "email": "mal@serenity.ship",
    "displayName": "Malcolm Reynolds",
    "bio": "Captain of Serenity",
    "createdAt": "2025-01-01T00:00:00.000Z"
  },
  "contacts": [...],
  "pings": [...],
  "waveParticipation": [...],
  "groupMemberships": [...],
  "sessions": [...],
  "activityLog": [...]
}
```

---

#### POST /api/account/delete

Permanently delete account (GDPR right to erasure).

**Authentication:** Required

**Rate Limit:** 5 requests per hour

**Request Body:**

```json
{
  "password": "current_password"
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Account deleted successfully"
}
```

**Response (400 Bad Request):**

```json
{
  "error": "Cannot delete the only admin account. Transfer admin rights first."
}
```

**Response (401 Unauthorized):**

```json
{
  "error": "Invalid password"
}
```

**Deletion Behavior:**
- Sessions: All revoked
- Pings: Author set to "[Deleted User]" (content preserved)
- Waves created: Transferred to other participant, or deleted if sole participant
- Groups created: Transferred to next admin/member, or deleted if sole member
- Contacts, requests, blocks, mutes: Deleted
- Activity log: User ID set to null (records preserved)

---

### Users Endpoints

#### GET /api/users/search

Search for users by handle or display name.

**Authentication:** Required

**Query Parameters:**

- `q` (string, required): Search query

**Example:**

```bash
curl "http://localhost:3001/api/users/search?q=mal" \
  -H "Authorization: Bearer <token>"
```

**Response (200 OK):**

```json
[
  {
    "id": "user-550e8400-e29b-41d4-a716-446655440000",
    "handle": "mal",
    "displayName": "Malcolm Reynolds",
    "avatar": "M",
    "avatarUrl": "/uploads/avatars/user-550e8400-1734567890.webp",
    "status": "online"
  }
]
```

---

#### GET /api/users/:id/profile

Get public profile information for any user.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "id": "user-550e8400-e29b-41d4-a716-446655440000",
  "handle": "mal",
  "displayName": "Malcolm Reynolds",
  "avatar": "M",
  "avatarUrl": "/uploads/avatars/user-550e8400-1734567890.webp",
  "bio": "Captain of Serenity",
  "createdAt": "2025-11-15T12:00:00.000Z"
}
```

**Note:** This endpoint only returns public fields. Email, preferences, and other private data are not exposed.

---

### Profile Endpoints

#### PUT /api/profile

Update current user's profile.

**Authentication:** Required

**Request Body:**

```json
{
  "displayName": "Captain Reynolds",
  "avatar": "CR",
  "bio": "Captain of the Firefly-class ship Serenity"
}
```

**Field Limits:**

- `displayName`: Max 50 characters
- `avatar`: Max 2 characters
- `bio`: Max 500 characters (set to `null` to clear)

**Response (200 OK):**

```json
{
  "id": "user-550e8400-e29b-41d4-a716-446655440000",
  "handle": "mal",
  "displayName": "Captain Reynolds",
  "avatar": "CR",
  "avatarUrl": "/uploads/avatars/user-550e8400-1734567890.webp",
  "bio": "Captain of the Firefly-class ship Serenity",
  "preferences": {
    "theme": "firefly",
    "fontSize": "medium"
  }
}
```

---

#### POST /api/profile/avatar

Upload a profile avatar image.

**Authentication:** Required

**Content-Type:** `multipart/form-data`

**Request Body:**

- `avatar` (file): Image file (jpg, jpeg, png, gif, webp)
- **Max size:** 2MB
- **Processing:** Resized to 256×256, converted to webp, EXIF stripped

**Example:**

```bash
curl -X POST http://localhost:3001/api/profile/avatar \
  -H "Authorization: Bearer <token>" \
  -F "avatar=@/path/to/avatar.jpg"
```

**Response (200 OK):**

```json
{
  "success": true,
  "avatarUrl": "/uploads/avatars/user-550e8400-1734567890.webp"
}
```

**Errors:**

- `400`: No file uploaded, file too large, or invalid file type

---

#### DELETE /api/profile/avatar

Delete current user's profile avatar.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true
}
```

---

#### PUT /api/profile/preferences

Update user preferences (theme, font size, etc.).

**Authentication:** Required

**Request Body:**

```json
{
  "theme": "highContrast",
  "fontSize": "large",
  "colorMode": "default"
}
```

**Valid Values:**

- `theme`: `"firefly"` (default), `"highContrast"`, `"light"`
- `fontSize`: `"small"`, `"medium"`, `"large"`, `"xlarge"`
- `colorMode`: `"default"` (reserved for future use)

**Response (200 OK):**

```json
{
  "theme": "highContrast",
  "fontSize": "large",
  "colorMode": "default"
}
```

---

#### POST /api/profile/password

Change current user's password.

**Authentication:** Required

**Request Body:**

```json
{
  "currentPassword": "oldpass123",
  "newPassword": "newpass123"
}
```

**Response (200 OK):**

```json
{
  "success": true
}
```

---

#### POST /api/profile/handle-request

Request a handle (username) change.

**Authentication:** Required

**Request Body:**

```json
{
  "newHandle": "captain_mal"
}
```

**Notes:**

- Handle changes require admin approval
- 30-day cooldown between approved changes
- Old handles reserved for 90 days

**Response (201 Created):**

```json
{
  "id": "hr-550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-550e8400-e29b-41d4-a716-446655440000",
  "oldHandle": "mal",
  "newHandle": "captain_mal",
  "status": "pending",
  "createdAt": "2025-12-09T12:00:00.000Z"
}
```

---

### Contacts Endpoints

#### GET /api/contacts

Get current user's contact list.

**Authentication:** Required

**Response (200 OK):**

```json
[
  {
    "id": "user-660e8400-e29b-41d4-a716-446655440001",
    "handle": "zoe",
    "displayName": "Zoe Washburne",
    "avatar": "Z",
    "avatarUrl": null,
    "status": "online",
    "addedAt": "2025-11-20T10:00:00.000Z"
  }
]
```

---

#### POST /api/contacts

Add a contact directly (deprecated - use contact requests instead).

**Authentication:** Required

**Request Body:**

```json
{
  "contactId": "user-660e8400-e29b-41d4-a716-446655440001"
}
```

**Response (201 Created):**

```json
{
  "success": true
}
```

---

#### DELETE /api/contacts/:id

Remove a contact.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true
}
```

---

#### POST /api/contacts/request

Send a contact request to another user.

**Authentication:** Required

**Request Body:**

```json
{
  "toUserId": "user-660e8400-e29b-41d4-a716-446655440001",
  "message": "Let's stay in touch!"
}
```

**Response (201 Created):**

```json
{
  "id": "cr-550e8400-e29b-41d4-a716-446655440000",
  "fromUserId": "user-550e8400-e29b-41d4-a716-446655440000",
  "toUserId": "user-660e8400-e29b-41d4-a716-446655440001",
  "message": "Let's stay in touch!",
  "status": "pending",
  "createdAt": "2025-12-09T12:00:00.000Z"
}
```

**WebSocket Event:** Recipient receives `contact_request_received` event

**Errors:**

- `400`: Missing toUserId or already contacts
- `403`: Cannot send request to blocked user

---

#### GET /api/contacts/requests

Get incoming contact requests (pending).

**Authentication:** Required

**Response (200 OK):**

```json
[
  {
    "id": "cr-550e8400-e29b-41d4-a716-446655440000",
    "fromUserId": "user-770e8400-e29b-41d4-a716-446655440002",
    "fromUserHandle": "wash",
    "fromUserDisplayName": "Hoban Washburne",
    "fromUserAvatar": "W",
    "fromUserAvatarUrl": null,
    "message": "Hey there!",
    "status": "pending",
    "createdAt": "2025-12-09T11:30:00.000Z"
  }
]
```

---

#### GET /api/contacts/requests/sent

Get outgoing contact requests (sent by current user).

**Authentication:** Required

**Response (200 OK):**

```json
[
  {
    "id": "cr-660e8400-e29b-41d4-a716-446655440003",
    "toUserId": "user-880e8400-e29b-41d4-a716-446655440004",
    "toUserHandle": "kaylee",
    "toUserDisplayName": "Kaylee Frye",
    "message": "Want to connect?",
    "status": "pending",
    "createdAt": "2025-12-09T10:00:00.000Z"
  }
]
```

---

#### POST /api/contacts/requests/:id/accept

Accept a contact request.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true
}
```

**WebSocket Event:** Sender receives `contact_request_accepted` event

**Notes:**

- Creates mutual contact relationship
- Request status updated to "accepted"

---

#### POST /api/contacts/requests/:id/decline

Decline a contact request.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true
}
```

**WebSocket Event:** Sender receives `contact_request_declined` event

---

#### DELETE /api/contacts/requests/:id

Cancel a sent contact request.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true
}
```

**WebSocket Event:** Recipient receives `contact_request_cancelled` event

---

### Groups Endpoints

#### GET /api/groups

Get all groups current user is a member of.

**Authentication:** Required

**Response (200 OK):**

```json
[
  {
    "id": "group-550e8400-e29b-41d4-a716-446655440000",
    "name": "Serenity Crew",
    "description": "The crew of Firefly",
    "createdBy": "user-550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2025-11-01T10:00:00.000Z",
    "privacy": "private"
  }
]
```

---

#### GET /api/groups/:id

Get details of a specific group.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "id": "group-550e8400-e29b-41d4-a716-446655440000",
  "name": "Serenity Crew",
  "description": "The crew of Firefly",
  "createdBy": "user-550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2025-11-01T10:00:00.000Z",
  "privacy": "private",
  "members": [
    {
      "id": "user-550e8400-e29b-41d4-a716-446655440000",
      "handle": "mal",
      "displayName": "Malcolm Reynolds",
      "avatar": "M",
      "avatarUrl": "/uploads/avatars/user-550e8400-1734567890.webp",
      "role": "admin"
    }
  ]
}
```

**Errors:**

- `403`: User is not a member of the group

---

#### POST /api/groups

Create a new group.

**Authentication:** Required

**Request Body:**

```json
{
  "name": "Serenity Crew",
  "description": "The crew of Firefly",
  "privacy": "private"
}
```

**Response (201 Created):**

```json
{
  "id": "group-550e8400-e29b-41d4-a716-446655440000",
  "name": "Serenity Crew",
  "description": "The crew of Firefly",
  "createdBy": "user-550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2025-12-09T12:00:00.000Z",
  "privacy": "private"
}
```

**Notes:**

- Creator is automatically added as admin
- Valid privacy values: `"private"`, `"public"`

---

#### PUT /api/groups/:id

Update group information.

**Authentication:** Required

**Authorization:** Must be group admin

**Request Body:**

```json
{
  "name": "New Group Name",
  "description": "Updated description"
}
```

**Response (200 OK):**

```json
{
  "id": "group-550e8400-e29b-41d4-a716-446655440000",
  "name": "New Group Name",
  "description": "Updated description"
}
```

---

#### DELETE /api/groups/:id

Delete a group.

**Authentication:** Required

**Authorization:** Must be group admin

**Response (200 OK):**

```json
{
  "success": true
}
```

---

#### POST /api/groups/:id/members

Add a member to a group (deprecated - use invitations instead).

**Authentication:** Required

**Authorization:** Must be group admin

**Request Body:**

```json
{
  "userId": "user-660e8400-e29b-41d4-a716-446655440001"
}
```

**Response (201 Created):**

```json
{
  "success": true
}
```

---

#### DELETE /api/groups/:id/members/:userId

Remove a member from a group or leave a group.

**Authentication:** Required

**Authorization:** Admin to remove others, any member to remove themselves

**Response (200 OK):**

```json
{
  "success": true
}
```

**Notes:**

- When a user leaves, they lose access to all group waves
- Group participants are automatically cleaned up

---

#### PUT /api/groups/:id/members/:userId

Update a member's role.

**Authentication:** Required

**Authorization:** Must be group admin

**Request Body:**

```json
{
  "role": "admin"
}
```

**Valid Roles:**

- `"member"` - Regular group member
- `"admin"` - Can manage group, invite users, delete waves

**Response (200 OK):**

```json
{
  "success": true
}
```

---

#### POST /api/groups/:id/invite

Invite users to a group.

**Authentication:** Required

**Authorization:** Must be group member

**Request Body:**

```json
{
  "userIds": [
    "user-660e8400-e29b-41d4-a716-446655440001",
    "user-770e8400-e29b-41d4-a716-446655440002"
  ],
  "message": "Join our crew!"
}
```

**Response (201 Created):**

```json
{
  "success": true,
  "invitations": [
    {
      "id": "gi-550e8400-e29b-41d4-a716-446655440000",
      "groupId": "group-550e8400-e29b-41d4-a716-446655440000",
      "fromUserId": "user-550e8400-e29b-41d4-a716-446655440000",
      "toUserId": "user-660e8400-e29b-41d4-a716-446655440001",
      "message": "Join our crew!",
      "status": "pending",
      "createdAt": "2025-12-09T12:00:00.000Z"
    }
  ]
}
```

**WebSocket Event:** Recipients receive `group_invitation_received` event

**Errors:**

- `403`: Cannot invite blocked users or users already in group

---

#### GET /api/groups/invitations

Get incoming group invitations (pending).

**Authentication:** Required

**Response (200 OK):**

```json
[
  {
    "id": "gi-550e8400-e29b-41d4-a716-446655440000",
    "groupId": "group-550e8400-e29b-41d4-a716-446655440000",
    "groupName": "Serenity Crew",
    "fromUserId": "user-550e8400-e29b-41d4-a716-446655440000",
    "fromUserHandle": "mal",
    "fromUserDisplayName": "Malcolm Reynolds",
    "message": "Join our crew!",
    "status": "pending",
    "createdAt": "2025-12-09T11:30:00.000Z"
  }
]
```

---

#### GET /api/groups/:id/invitations/sent

Get outgoing invitations for a specific group.

**Authentication:** Required

**Authorization:** Must be group member

**Response (200 OK):**

```json
[
  {
    "id": "gi-660e8400-e29b-41d4-a716-446655440001",
    "toUserId": "user-880e8400-e29b-41d4-a716-446655440004",
    "toUserHandle": "kaylee",
    "toUserDisplayName": "Kaylee Frye",
    "message": "Join our crew!",
    "status": "pending",
    "createdAt": "2025-12-09T10:00:00.000Z"
  }
]
```

---

#### POST /api/groups/invitations/:id/accept

Accept a group invitation.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true
}
```

**WebSocket Event:** Sender receives `group_invitation_accepted` event

**Notes:**

- User is added to group with "member" role
- Can now access group waves

---

#### POST /api/groups/invitations/:id/decline

Decline a group invitation.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true
}
```

**WebSocket Event:** Sender receives `group_invitation_declined` event

---

#### DELETE /api/groups/invitations/:id

Cancel a sent group invitation.

**Authentication:** Required

**Authorization:** Must be invitation sender

**Response (200 OK):**

```json
{
  "success": true
}
```

**WebSocket Event:** Recipient receives `group_invitation_cancelled` event

---

### Waves Endpoints

Waves are conversation threads that can be private, group-based, cross-server, or public.

#### GET /api/waves

Get all waves for current user.

**Authentication:** Required

**Query Parameters:**

- `archived` (boolean): Include archived waves if `"true"`

**Response (200 OK):**

```json
[
  {
    "id": "wave-550e8400-e29b-41d4-a716-446655440000",
    "title": "Mission Planning",
    "privacy": "group",
    "groupId": "group-550e8400-e29b-41d4-a716-446655440000",
    "groupName": "Serenity Crew",
    "createdBy": "user-550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2025-12-01T10:00:00.000Z",
    "creator_name": "Malcolm Reynolds",
    "creator_handle": "mal",
    "message_count": 42,
    "last_message_at": "2025-12-09T11:45:00.000Z",
    "archived": false,
    "unread_count": 3
  }
]
```

---

#### GET /api/waves/:id

Get full details of a specific wave, including messages and participants.

**Authentication:** Required

**Authorization:** Must have access to wave (participant or group member)

**Query Parameters:**

- `limit` (integer): Number of messages to return (default: 50, max: 100)

**Response (200 OK):**

```json
{
  "id": "wave-550e8400-e29b-41d4-a716-446655440000",
  "title": "Mission Planning",
  "privacy": "group",
  "groupId": "group-550e8400-e29b-41d4-a716-446655440000",
  "group_name": "Serenity Crew",
  "createdBy": "user-550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2025-12-01T10:00:00.000Z",
  "creator_name": "Malcolm Reynolds",
  "creator_handle": "mal",
  "can_edit": true,
  "participants": [
    {
      "id": "user-550e8400-e29b-41d4-a716-446655440000",
      "handle": "mal",
      "displayName": "Malcolm Reynolds",
      "avatar": "M",
      "avatarUrl": "/uploads/avatars/user-550e8400-1734567890.webp",
      "archived": false
    }
  ],
  "messages": [
    {
      "id": "msg-550e8400-e29b-41d4-a716-446655440000",
      "waveId": "wave-550e8400-e29b-41d4-a716-446655440000",
      "authorId": "user-550e8400-e29b-41d4-a716-446655440000",
      "sender_name": "Malcolm Reynolds",
      "sender_handle": "mal",
      "sender_avatar": "M",
      "sender_avatar_url": "/uploads/avatars/user-550e8400-1734567890.webp",
      "content": "We have a job to do.",
      "parent_id": null,
      "created_at": "2025-12-09T10:00:00.000Z",
      "edited_at": null,
      "reactions": [],
      "readBy": ["user-550e8400-e29b-41d4-a716-446655440000"],
      "children": []
    }
  ],
  "all_messages": [],
  "total_messages": 42,
  "hasMoreMessages": false
}
```

**Notes:**

- `messages` are returned as a tree structure with `children` arrays
- `all_messages` contains flat list of messages
- Initial load is limited; use `/api/waves/:id/messages` for pagination

---

#### GET /api/waves/:id/messages

Load older messages for a wave (pagination).

**Authentication:** Required

**Authorization:** Must have access to wave

**Query Parameters:**

- `limit` (integer): Number of messages to return (default: 50, max: 100)
- `before` (string): Message ID to load messages before

**Response (200 OK):**

```json
{
  "messages": [
    {
      "id": "msg-660e8400-e29b-41d4-a716-446655440001",
      "waveId": "wave-550e8400-e29b-41d4-a716-446655440000",
      "authorId": "user-660e8400-e29b-41d4-a716-446655440001",
      "sender_name": "Zoe Washburne",
      "content": "Ready when you are, sir.",
      "parent_id": null,
      "created_at": "2025-12-09T09:30:00.000Z"
    }
  ],
  "hasMore": true,
  "total": 42
}
```

---

#### POST /api/waves

Create a new wave.

**Authentication:** Required

**Request Body:**

```json
{
  "title": "New Mission",
  "privacy": "group",
  "groupId": "group-550e8400-e29b-41d4-a716-446655440000",
  "participants": [
    "user-660e8400-e29b-41d4-a716-446655440001"
  ]
}
```

**Privacy Levels:**

- `"private"` - Only specified participants (◉)
- `"group"` - All group members (requires `groupId`) (◈)
- `"crossServer"` - Cross-server federation (◇)
- `"public"` - Visible to all users (○)

**Response (201 Created):**

```json
{
  "id": "wave-770e8400-e29b-41d4-a716-446655440002",
  "title": "New Mission",
  "privacy": "group",
  "groupId": "group-550e8400-e29b-41d4-a716-446655440000",
  "createdBy": "user-550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2025-12-09T12:00:00.000Z",
  "creator_name": "Malcolm Reynolds",
  "creator_handle": "mal",
  "participants": [],
  "message_count": 0
}
```

**WebSocket Event:** `wave_created` broadcast to participants

**Errors:**

- `400`: Missing title or invalid privacy
- `403`: Not a group member for group waves

---

#### PUT /api/waves/:id

Update wave title or privacy.

**Authentication:** Required

**Authorization:** Must be wave creator

**Request Body:**

```json
{
  "title": "Updated Mission Plan",
  "privacy": "private",
  "groupId": null
}
```

**Response (200 OK):**

```json
{
  "id": "wave-550e8400-e29b-41d4-a716-446655440000",
  "title": "Updated Mission Plan",
  "privacy": "private"
}
```

**WebSocket Event:** `wave_updated` broadcast to participants

---

#### POST /api/waves/:id/archive

Archive or unarchive a wave (per-user).

**Authentication:** Required

**Request Body:**

```json
{
  "archived": true
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "archived": true
}
```

**Notes:**

- Archiving is per-user and doesn't affect other participants
- Archived waves are hidden by default in wave list

---

#### POST /api/waves/:id/read

Mark all messages in a wave as read.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true
}
```

**Notes:**

- Updates `readBy` array for all messages in the wave
- Resets unread count to 0

---

#### DELETE /api/waves/:id

Delete a wave and all its messages.

**Authentication:** Required

**Authorization:** Must be wave creator

**Response (200 OK):**

```json
{
  "success": true
}
```

**WebSocket Event:** `wave_deleted` broadcast to all participants

**Notes:**

- Cascade deletes all messages, message history, and participant records
- Participants are redirected if currently viewing the wave

---

### Messages Endpoints

> **⚠️ DEPRECATED (v1.10.0):** These endpoints are deprecated. Use the `/api/pings/*` endpoints instead.
>
> **Response Headers:**
> - `X-Deprecated: true`
> - `X-Deprecated-Message: This endpoint is deprecated. Use /api/pings/* instead.`
> - `Sunset: Sat, 01 Mar 2026 00:00:00 GMT`
>
> **Migration Guide:**
> - `POST /api/messages` → `POST /api/waves/:id/pings`
> - `PUT /api/messages/:id` → `PUT /api/pings/:id`
> - `DELETE /api/messages/:id` → `DELETE /api/pings/:id`
> - `POST /api/messages/:id/react` → `POST /api/pings/:id/react`
> - `POST /api/messages/:id/read` → `POST /api/pings/:id/read`

#### POST /api/messages

> ⚠️ **DEPRECATED** - Use `POST /api/waves/:id/pings` instead.

Create a new message in a wave.

**Authentication:** Required

**Request Body:**

```json
{
  "wave_id": "wave-550e8400-e29b-41d4-a716-446655440000",
  "content": "This is my message with <strong>rich content</strong>",
  "parent_id": null
}
```

**Field Details:**

- `wave_id` (string, required): ID of the wave
- `content` (string, required): Message content (HTML allowed, sanitized server-side, max 10,000 chars)
- `parent_id` (string, optional): ID of parent message for threaded replies

**Response (201 Created):**

```json
{
  "id": "msg-880e8400-e29b-41d4-a716-446655440005",
  "waveId": "wave-550e8400-e29b-41d4-a716-446655440000",
  "authorId": "user-550e8400-e29b-41d4-a716-446655440000",
  "sender_name": "Malcolm Reynolds",
  "sender_handle": "mal",
  "sender_avatar": "M",
  "sender_avatar_url": "/uploads/avatars/user-550e8400-1734567890.webp",
  "content": "This is my message with <strong>rich content</strong>",
  "parent_id": null,
  "created_at": "2025-12-09T12:05:00.000Z",
  "edited_at": null,
  "reactions": [],
  "readBy": ["user-550e8400-e29b-41d4-a716-446655440000"]
}
```

**WebSocket Event:** `new_message` broadcast to wave participants

**Push Notification:** Sent to offline/backgrounded users

**Errors:**

- `400`: Missing wave_id or content, or message too long
- `403`: Access denied to wave
- `404`: Wave not found

---

#### PUT /api/messages/:id

> ⚠️ **DEPRECATED** - Use `PUT /api/pings/:id` instead.

Edit an existing message.

**Authentication:** Required

**Authorization:** Must be message author

**Request Body:**

```json
{
  "content": "Updated message content"
}
```

**Response (200 OK):**

```json
{
  "id": "msg-880e8400-e29b-41d4-a716-446655440005",
  "content": "Updated message content",
  "edited_at": "2025-12-09T12:10:00.000Z",
  "version": 2,
  "history": [
    {
      "version": 1,
      "content": "Original message content",
      "edited_at": "2025-12-09T12:05:00.000Z"
    }
  ]
}
```

**WebSocket Event:** `message_edited` broadcast to wave participants

**Notes:**

- Edit history is tracked with version numbers
- Max 10,000 characters

---

#### DELETE /api/messages/:id

> ⚠️ **DEPRECATED** - Use `DELETE /api/pings/:id` instead.

Delete a message.

**Authentication:** Required

**Authorization:** Must be message author

**Response (200 OK):**

```json
{
  "success": true
}
```

**WebSocket Event:** `message_deleted` broadcast to wave participants

**Notes:**

- If message has replies, it's replaced with "[Message deleted]" placeholder
- If no replies, message is completely removed from UI

---

#### POST /api/messages/:id/react

> ⚠️ **DEPRECATED** - Use `POST /api/pings/:id/react` instead.

Add or remove a reaction (emoji) to a message.

**Authentication:** Required

**Request Body:**

```json
{
  "emoji": "👍"
}
```

**Response (200 OK):**

```json
{
  "id": "msg-880e8400-e29b-41d4-a716-446655440005",
  "reactions": [
    {
      "emoji": "👍",
      "users": [
        {
          "id": "user-550e8400-e29b-41d4-a716-446655440000",
          "handle": "mal",
          "displayName": "Malcolm Reynolds"
        }
      ]
    }
  ]
}
```

**WebSocket Event:** `message_edited` broadcast to wave participants

**Notes:**

- Clicking same emoji again removes the reaction
- Multiple users can react with the same emoji

---

#### POST /api/messages/:id/read

> ⚠️ **DEPRECATED** - Use `POST /api/pings/:id/read` instead.

Mark a specific message as read.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true
}
```

**Notes:**

- Adds current user to message's `readBy` array
- Used for per-message read tracking (click-to-read UI)

---

### Pings Endpoints

Pings are the new name for messages (v2.0.0, formerly "droplets" in v1.10.0). All `/api/pings` endpoints are aliases for `/api/messages` endpoints with enhanced functionality.

#### GET /api/waves/:id/pings

Get pings for a wave (alias for `/api/waves/:id/messages`).

**Authentication:** Required

**Query Parameters:**

- `limit` (integer): Number of pings to return (default: 50, max: 100)
- `before` (string): Ping ID to load pings before (pagination)

**Response (200 OK):**

```json
{
  "pings": [...],
  "hasMore": true,
  "total": 42
}
```

---

#### POST /api/waves/:id/pings

Create a new ping in a wave (alias for `/api/messages`).

**Authentication:** Required

**Request Body:**

```json
{
  "content": "This is my ping with <strong>rich content</strong>",
  "parent_id": null
}
```

**Response (201 Created):**

```json
{
  "id": "ping-880e8400-e29b-41d4-a716-446655440005",
  "waveId": "wave-550e8400-e29b-41d4-a716-446655440000",
  "authorId": "user-550e8400-e29b-41d4-a716-446655440000",
  "sender_name": "Malcolm Reynolds",
  "content": "This is my ping",
  "parent_id": null,
  "created_at": "2025-12-09T12:05:00.000Z"
}
```

**WebSocket Event:** `new_ping` (and `new_message` for backward compatibility)

---

#### PUT /api/pings/:id

Edit an existing ping.

**Authentication:** Required

**Authorization:** Must be ping author

**Request Body:**

```json
{
  "content": "Updated ping content"
}
```

**Response (200 OK):**

```json
{
  "id": "ping-880e8400-e29b-41d4-a716-446655440005",
  "content": "Updated ping content",
  "edited_at": "2025-12-09T12:10:00.000Z",
  "version": 2
}
```

**WebSocket Event:** `ping_edited` (and `message_edited` for backward compatibility)

---

#### DELETE /api/pings/:id

Delete a ping.

**Authentication:** Required

**Authorization:** Must be ping author

**Response (200 OK):**

```json
{
  "success": true
}
```

**WebSocket Event:** `ping_deleted` (and `message_deleted` for backward compatibility)

---

#### POST /api/pings/:id/read

Mark a specific ping as read.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true
}
```

---

#### POST /api/pings/:id/react

Add or remove a reaction (emoji) to a ping.

**Authentication:** Required

**Request Body:**

```json
{
  "emoji": "👍"
}
```

**Response (200 OK):**

```json
{
  "id": "ping-880e8400-e29b-41d4-a716-446655440005",
  "reactions": [
    {
      "emoji": "👍",
      "users": [...]
    }
  ]
}
```

---

#### POST /api/pings/:id/burst

Spin off a ping and its replies into a new wave.

**Authentication:** Required

**Request Body:**

```json
{
  "title": "New Discussion",
  "participants": [
    "user-550e8400-e29b-41d4-a716-446655440000",
    "user-660e8400-e29b-41d4-a716-446655440001"
  ]
}
```

**Response (201 Created):**

```json
{
  "success": true,
  "newWave": {
    "id": "wave-770e8400-e29b-41d4-a716-446655440002",
    "title": "New Discussion",
    "privacy": "private",
    "rootPingId": "ping-880e8400-e29b-41d4-a716-446655440005",
    "brokenOutFrom": "wave-550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2025-12-09T12:00:00.000Z"
  },
  "originalWaveId": "wave-550e8400-e29b-41d4-a716-446655440000"
}
```

**WebSocket Events:**

- `ping_burst` - Sent to original wave participants
- `wave_created` - Sent to new wave participants

**Notes:**

- Creates a new wave with the ping as the root
- Original ping displays as a "Burst to wave..." link card
- Participants default to original wave participants
- Inherits privacy level from original wave
- Nested bursts build a `breakout_chain` for lineage tracking

**Errors:**

- `400`: Missing title or invalid participants
- `403`: User doesn't have access to original wave
- `404`: Ping not found

---

### Search Endpoint

#### GET /api/search

Full-text search across all accessible messages.

**Authentication:** Required

**Query Parameters:**

- `q` (string, required): Search query

**Example:**

```bash
curl "http://localhost:3001/api/search?q=mission" \
  -H "Authorization: Bearer <token>"
```

**Response (200 OK):**

```json
[
  {
    "id": "msg-550e8400-e29b-41d4-a716-446655440000",
    "content": "We have a mission to do.",
    "snippet": "We have a <mark>mission</mark> to do.",
    "waveId": "wave-550e8400-e29b-41d4-a716-446655440000",
    "waveName": "Mission Planning",
    "authorId": "user-550e8400-e29b-41d4-a716-446655440000",
    "authorName": "Malcolm Reynolds",
    "authorHandle": "mal",
    "createdAt": "2025-12-09T10:00:00.000Z",
    "parentId": null
  }
]
```

**Notes:**

- Uses SQLite FTS5 (Full-Text Search) with BM25 ranking
- Results are relevance-ranked
- `snippet` contains highlighted matches with `<mark>` tags
- Prefix matching supported: `"term"*` matches partial words
- Falls back to LIKE search if FTS query fails

---

### GIFs Endpoints

Requires `GIPHY_API_KEY` environment variable to be set.

#### GET /api/gifs/search

Search for GIFs via GIPHY API.

**Authentication:** Required

**Rate Limit:** 30 requests per minute

**Query Parameters:**

- `q` (string, required): Search query
- `limit` (integer): Number of results (default: 20, max: 50)
- `offset` (integer): Pagination offset (default: 0)

**Example:**

```bash
curl "http://localhost:3001/api/gifs/search?q=excited&limit=10" \
  -H "Authorization: Bearer <token>"
```

**Response (200 OK):**

```json
{
  "gifs": [
    {
      "id": "3o7btPCcdNniyf0ArS",
      "title": "Excited Dog GIF",
      "url": "https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif",
      "preview": "https://media.giphy.com/media/3o7btPCcdNniyf0ArS/200w.gif",
      "width": 480,
      "height": 270
    }
  ],
  "pagination": {
    "total_count": 1000,
    "count": 10,
    "offset": 0
  }
}
```

**Errors:**

- `503`: GIPHY API key not configured
- `500`: GIPHY API request failed

---

#### GET /api/gifs/trending

Get trending GIFs from GIPHY.

**Authentication:** Required

**Rate Limit:** 30 requests per minute

**Query Parameters:**

- `limit` (integer): Number of results (default: 20, max: 50)
- `offset` (integer): Pagination offset (default: 0)

**Response (200 OK):**

Same format as `/api/gifs/search`

---

### Uploads Endpoints

#### POST /api/uploads

Upload an image for use in messages.

**Authentication:** Required

**Content-Type:** `multipart/form-data`

**Request Body:**

- `image` (file): Image file (jpg, jpeg, png, gif, webp)
- **Max size:** 10MB
- **Processing:** Resized to max 1200×1200 (preserves aspect ratio), converted to webp (except animated GIFs)

**Example:**

```bash
curl -X POST http://localhost:3001/api/uploads \
  -H "Authorization: Bearer <token>" \
  -F "image=@/path/to/image.jpg"
```

**Response (200 OK):**

```json
{
  "success": true,
  "url": "/uploads/messages/user-550e8400-1734567890.webp"
}
```

**Errors:**

- `400`: No file uploaded, file too large, or invalid file type

**Notes:**

- Uploaded images are automatically embedded in messages when URL is included
- Images displayed as thumbnails with click-to-zoom lightbox

---

### Embeds Endpoints

#### POST /api/embeds/detect

Detect embeddable URLs in content (YouTube, Vimeo, Spotify, TikTok, Twitter, SoundCloud).

**Authentication:** Required

**Request Body:**

```json
{
  "content": "Check out this video: https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

**Response (200 OK):**

```json
{
  "embeds": [
    {
      "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "type": "youtube",
      "id": "dQw4w9WgXcQ"
    }
  ]
}
```

---

#### GET /api/embeds/oembed

Proxy oEmbed requests for Twitter and SoundCloud embeds.

**Authentication:** Required

**Rate Limit:** 30 requests per minute

**Query Parameters:**

- `url` (string, required): URL to fetch oEmbed data for

**Example:**

```bash
curl "http://localhost:3001/api/embeds/oembed?url=https://twitter.com/..." \
  -H "Authorization: Bearer <token>"
```

**Response (200 OK):**

Returns oEmbed JSON response from the platform's oEmbed endpoint.

**Notes:**

- Responses are cached for 15 minutes
- Supports Twitter/X and SoundCloud
- Script tags are stripped from HTML for security

---

#### GET /api/embeds/info

Get lightweight embed info without fetching external data.

**Authentication:** Required

**Query Parameters:**

- `url` (string, required): URL to get embed info for

**Response (200 OK):**

```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "type": "youtube",
  "id": "dQw4w9WgXcQ",
  "embedUrl": "https://www.youtube.com/embed/dQw4w9WgXcQ"
}
```

---

### Push Notifications Endpoints

Requires `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` environment variables.

#### GET /api/push/vapid-key

Get public VAPID key for client-side push subscription.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "publicKey": "BKxN..."
}
```

**Errors:**

- `503`: Push notifications not configured

---

#### POST /api/push/subscribe

Subscribe to push notifications.

**Authentication:** Required

**Request Body:**

```json
{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/...",
    "keys": {
      "auth": "...",
      "p256dh": "..."
    }
  }
}
```

**Response (200 OK):**

```json
{
  "success": true
}
```

**Notes:**

- Subscription object obtained from browser's `PushManager.subscribe()`
- Multiple subscriptions per user supported (multi-device)

---

#### DELETE /api/push/subscribe

Unsubscribe from push notifications.

**Authentication:** Required

**Request Body:**

```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/..."
}
```

**Response (200 OK):**

```json
{
  "success": true
}
```

---

#### POST /api/push/test

Send a test push notification (development only).

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Test notification sent"
}
```

---

### Moderation Endpoints

#### POST /api/users/:id/block

Block a user.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true
}
```

**Effects:**

- Blocked user cannot send contact requests
- Blocked user cannot invite you to groups
- Messages from blocked user are hidden in waves
- Block is bidirectional

---

#### DELETE /api/users/:id/block

Unblock a user.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true
}
```

---

#### GET /api/users/blocked

Get list of blocked users.

**Authentication:** Required

**Response (200 OK):**

```json
[
  {
    "id": "user-990e8400-e29b-41d4-a716-446655440009",
    "handle": "niska",
    "displayName": "Adelai Niska",
    "avatar": "N",
    "avatarUrl": null
  }
]
```

---

#### POST /api/users/:id/mute

Mute a user.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true
}
```

**Effects:**

- Messages from muted user are hidden in waves
- Muted user can still interact normally (one-directional)

---

#### DELETE /api/users/:id/mute

Unmute a user.

**Authentication:** Required

**Response (200 OK):**

```json
{
  "success": true
}
```

---

#### GET /api/users/muted

Get list of muted users.

**Authentication:** Required

**Response (200 OK):**

```json
[
  {
    "id": "user-aa0e8400-e29b-41d4-a716-446655440010",
    "handle": "badger",
    "displayName": "Badger",
    "avatar": "B",
    "avatarUrl": null
  }
]
```

---

### Admin Endpoints

Require `isAdmin: true` on user account.

#### GET /api/admin/handle-requests

Get all pending handle change requests.

**Authentication:** Required

**Authorization:** Admin only

**Response (200 OK):**

```json
[
  {
    "id": "hr-550e8400-e29b-41d4-a716-446655440000",
    "userId": "user-660e8400-e29b-41d4-a716-446655440001",
    "oldHandle": "zoe",
    "newHandle": "zoe_washburne",
    "status": "pending",
    "createdAt": "2025-12-09T10:00:00.000Z",
    "user": {
      "displayName": "Zoe Washburne",
      "email": "zoe@serenity.ship"
    }
  }
]
```

---

#### POST /api/admin/handle-requests/:id/approve

Approve a handle change request.

**Authentication:** Required

**Authorization:** Admin only

**Response (200 OK):**

```json
{
  "success": true
}
```

**WebSocket Event:** `handle_request_reviewed` sent to user

**Notes:**

- Updates user's handle
- Adds old handle to `handleHistory`
- Reserves old handle for 90 days

---

#### POST /api/admin/handle-requests/:id/reject

Reject a handle change request.

**Authentication:** Required

**Authorization:** Admin only

**Request Body:**

```json
{
  "reason": "Handle already taken"
}
```

**Response (200 OK):**

```json
{
  "success": true
}
```

**WebSocket Event:** `handle_request_reviewed` sent to user

---

### Reports Endpoints

#### POST /api/reports

Report content (message, user, or wave).

**Authentication:** Required

**Request Body:**

```json
{
  "type": "message",
  "targetId": "msg-550e8400-e29b-41d4-a716-446655440000",
  "reason": "spam",
  "description": "This is spam content"
}
```

**Valid Types:**

- `"message"` - Report a message
- `"user"` - Report a user
- `"wave"` - Report a wave

**Valid Reasons:**

- `"spam"` - Spam or advertising
- `"harassment"` - Harassment or bullying
- `"inappropriate"` - Inappropriate content
- `"other"` - Other reason

**Response (201 Created):**

```json
{
  "id": "report-550e8400-e29b-41d4-a716-446655440000",
  "type": "message",
  "targetId": "msg-550e8400-e29b-41d4-a716-446655440000",
  "reportedBy": "user-550e8400-e29b-41d4-a716-446655440000",
  "reason": "spam",
  "description": "This is spam content",
  "status": "pending",
  "createdAt": "2025-12-09T12:00:00.000Z"
}
```

---

#### GET /api/admin/reports

Get all reports (admin only).

**Authentication:** Required

**Authorization:** Admin only

**Response (200 OK):**

```json
[
  {
    "id": "report-550e8400-e29b-41d4-a716-446655440000",
    "type": "message",
    "targetId": "msg-550e8400-e29b-41d4-a716-446655440000",
    "reportedBy": "user-550e8400-e29b-41d4-a716-446655440000",
    "reporterHandle": "mal",
    "reporterDisplayName": "Malcolm Reynolds",
    "reason": "spam",
    "description": "This is spam content",
    "status": "pending",
    "createdAt": "2025-12-09T12:00:00.000Z"
  }
]
```

---

#### POST /api/admin/reports/:id/resolve

Resolve a report (admin only).

**Authentication:** Required

**Authorization:** Admin only

**Request Body:**

```json
{
  "action": "deleted",
  "notes": "Content removed"
}
```

**Valid Actions:**

- `"no_action"` - No action taken
- `"warning"` - User warned
- `"deleted"` - Content deleted
- `"banned"` - User banned

**Response (200 OK):**

```json
{
  "success": true
}
```

---

### Maintenance Endpoints

Administrative endpoints for privacy hardening and data migration.

#### GET /api/admin/maintenance/privacy-status

Get encryption and privacy protection status for all data types.

**Authentication:** Required

**Authorization:** Admin only

**Response (200 OK):**

```json
{
  "totalUsers": 150,
  "emailProtection": {
    "hashed": 150,
    "encrypted": 150,
    "plaintext": 0,
    "migrationNeeded": 0
  },
  "waveParticipation": {
    "totalWaves": 42,
    "encryptedWaves": 42,
    "cacheStats": {
      "waveCount": 42,
      "userCount": 85,
      "totalMappings": 312,
      "encryptionEnabled": true
    },
    "migrationNeeded": 0
  },
  "pushSubscriptions": {
    "totalUsers": 75,
    "totalSubscriptions": 120,
    "encryptedUsers": 75,
    "cacheStats": {
      "userCount": 75,
      "subscriptionCount": 120,
      "encryptionEnabled": true
    },
    "migrationNeeded": 0
  },
  "crewMembership": {
    "totalCrews": 8,
    "encryptedCrews": 8,
    "cacheStats": {
      "crewCount": 8,
      "userCount": 45,
      "totalMappings": 45,
      "encryptionEnabled": true
    },
    "migrationNeeded": 0
  },
  "config": {
    "emailEncryptionEnabled": true,
    "waveParticipationEncryptionEnabled": true,
    "pushSubscriptionEncryptionEnabled": true,
    "crewMembershipEncryptionEnabled": true,
    "activityLogRetentionDays": 30,
    "sessionMaxAgeDays": 30
  }
}
```

---

#### POST /api/admin/maintenance/migrate-emails

Migrate existing plaintext emails to encrypted storage.

**Authentication:** Required

**Authorization:** Admin only

**Response (200 OK):**

```json
{
  "success": true,
  "migrated": 25,
  "message": "Migrated 25 users to encrypted email storage"
}
```

**Notes:**
- Requires `EMAIL_ENCRYPTION_KEY` environment variable
- Creates SHA-256 hash for lookup and AES-256-GCM encrypted copy for password reset

---

#### POST /api/admin/maintenance/migrate-wave-participants

Migrate wave participation data to encrypted storage.

**Authentication:** Required

**Authorization:** Admin only

**Response (200 OK):**

```json
{
  "success": true,
  "migratedWaves": 42,
  "message": "Migrated 42 waves to encrypted storage"
}
```

**Notes:**
- Requires `WAVE_PARTICIPATION_KEY` environment variable
- Encrypts participant lists per wave using AES-256-GCM
- Server uses in-memory cache for runtime lookups

---

#### POST /api/admin/maintenance/migrate-push-subscriptions

Migrate push subscription data to encrypted storage.

**Authentication:** Required

**Authorization:** Admin only

**Response (200 OK):**

```json
{
  "success": true,
  "migratedUsers": 75,
  "migratedSubscriptions": 120,
  "message": "Migrated 75 users with 120 push subscriptions to encrypted storage"
}
```

**Notes:**
- Requires `PUSH_SUBSCRIPTION_KEY` environment variable
- Encrypts subscription lists per user using AES-256-GCM
- User identified by SHA-256 hash for deduplication

---

#### POST /api/admin/maintenance/migrate-crew-members

Migrate crew membership data to encrypted storage.

**Authentication:** Required

**Authorization:** Admin only

**Response (200 OK):**

```json
{
  "success": true,
  "migratedCrews": 8,
  "message": "Migrated 8 crews to encrypted storage"
}
```

**Notes:**
- Requires `CREW_MEMBERSHIP_KEY` environment variable
- Encrypts member lists per crew using AES-256-GCM
- Plaintext table kept for metadata (role, joined_at)
- Server uses in-memory cache for runtime lookups

---

### Health Endpoint

#### GET /api/health

Check server health status.

**Authentication:** Not required

**Response (200 OK):**

```json
{
  "status": "ok",
  "timestamp": "2025-12-09T12:00:00.000Z"
}
```

---

## WebSocket API

Cortex uses WebSockets for real-time bidirectional communication.

**WebSocket URL:** `ws://localhost:3001` (development)

### Connection Flow

1. **Connect:** Client establishes WebSocket connection
2. **Authenticate:** Client sends `auth` message with JWT token
3. **Receive Events:** Server broadcasts events to connected clients
4. **Send Events:** Client can send typing indicators and heartbeat pings

### Authentication

After connecting, clients must authenticate by sending:

```json
{
  "type": "auth",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Server Response (Success):**

```json
{
  "type": "auth_success",
  "userId": "user-550e8400-e29b-41d4-a716-446655440000"
}
```

**Server Response (Error):**

```json
{
  "type": "auth_error",
  "error": "Invalid token"
}
```

### Heartbeat

Client should send periodic ping messages to keep connection alive:

```json
{
  "type": "ping"
}
```

**Server Response:**

```json
{
  "type": "pong"
}
```

**Server Heartbeat:**

- Server sends native WebSocket ping every 30 seconds
- Connections that don't respond are terminated

### Client-Sent Events

#### Typing Indicator

Notify other wave participants that user is typing:

```json
{
  "type": "user_typing",
  "waveId": "wave-550e8400-e29b-41d4-a716-446655440000"
}
```

**Notes:**

- Throttled on client-side (typically every 2-3 seconds)
- Only sent to other participants in the wave
- Automatically expires after a few seconds

### Server-Broadcast Events

#### new_ping (v2.0.0+)

New ping created in a wave. Legacy `new_message` event also broadcast for backward compatibility.

```json
{
  "type": "new_ping",
  "data": {
    "id": "ping-880e8400-e29b-41d4-a716-446655440005",
    "waveId": "wave-550e8400-e29b-41d4-a716-446655440000",
    "authorId": "user-550e8400-e29b-41d4-a716-446655440000",
    "sender_name": "Malcolm Reynolds",
    "content": "This is a new ping",
    "created_at": "2025-12-09T12:05:00.000Z"
  }
}
```

---

#### ping_edited (v2.0.0+)

Ping was edited. Legacy `message_edited` event also broadcast for backward compatibility.

```json
{
  "type": "ping_edited",
  "data": {
    "id": "ping-880e8400-e29b-41d4-a716-446655440005",
    "content": "Updated ping content",
    "edited_at": "2025-12-09T12:10:00.000Z"
  }
}
```

---

#### ping_deleted (v2.0.0+)

Ping was deleted. Legacy `message_deleted` event also broadcast for backward compatibility.

```json
{
  "type": "ping_deleted",
  "pingId": "ping-880e8400-e29b-41d4-a716-446655440005",
  "waveId": "wave-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### ping_burst (v2.0.0+)

Ping was burst to create a new wave.

```json
{
  "type": "ping_burst",
  "pingId": "ping-880e8400-e29b-41d4-a716-446655440005",
  "newWaveId": "wave-770e8400-e29b-41d4-a716-446655440002",
  "newWaveTitle": "New Discussion",
  "waveId": "wave-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### new_message (legacy)

New message created in a wave. (Legacy event for backward compatibility)

```json
{
  "type": "new_message",
  "data": {
    "id": "msg-880e8400-e29b-41d4-a716-446655440005",
    "waveId": "wave-550e8400-e29b-41d4-a716-446655440000",
    "authorId": "user-550e8400-e29b-41d4-a716-446655440000",
    "sender_name": "Malcolm Reynolds",
    "content": "This is a new message",
    "created_at": "2025-12-09T12:05:00.000Z"
  }
}
```

---

#### message_edited (legacy)

Message was edited. (Legacy event for backward compatibility)

```json
{
  "type": "message_edited",
  "data": {
    "id": "msg-880e8400-e29b-41d4-a716-446655440005",
    "content": "Updated message content",
    "edited_at": "2025-12-09T12:10:00.000Z"
  }
}
```

---

#### message_deleted

Message was deleted.

```json
{
  "type": "message_deleted",
  "messageId": "msg-880e8400-e29b-41d4-a716-446655440005",
  "waveId": "wave-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### wave_created

New wave created.

```json
{
  "type": "wave_created",
  "wave": {
    "id": "wave-770e8400-e29b-41d4-a716-446655440002",
    "title": "New Mission",
    "privacy": "group",
    "createdBy": "user-550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2025-12-09T12:00:00.000Z"
  }
}
```

---

#### wave_updated

Wave title or privacy changed.

```json
{
  "type": "wave_updated",
  "wave": {
    "id": "wave-550e8400-e29b-41d4-a716-446655440000",
    "title": "Updated Mission Plan",
    "privacy": "private"
  }
}
```

---

#### wave_deleted

Wave was deleted by creator.

```json
{
  "type": "wave_deleted",
  "waveId": "wave-550e8400-e29b-41d4-a716-446655440000",
  "deletedBy": "user-550e8400-e29b-41d4-a716-446655440000",
  "wave": {
    "title": "Mission Planning"
  }
}
```

---

#### user_typing

Another user is typing in a wave.

```json
{
  "type": "user_typing",
  "waveId": "wave-550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-660e8400-e29b-41d4-a716-446655440001",
  "userName": "Zoe Washburne",
  "timestamp": 1734567890000
}
```

---

#### contact_request_received

Received a new contact request.

```json
{
  "type": "contact_request_received",
  "request": {
    "id": "cr-550e8400-e29b-41d4-a716-446655440000",
    "fromUserId": "user-770e8400-e29b-41d4-a716-446655440002",
    "message": "Let's connect!"
  }
}
```

---

#### contact_request_accepted

Contact request was accepted.

```json
{
  "type": "contact_request_accepted",
  "requestId": "cr-550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-660e8400-e29b-41d4-a716-446655440001"
}
```

---

#### contact_request_declined

Contact request was declined.

```json
{
  "type": "contact_request_declined",
  "requestId": "cr-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### contact_request_cancelled

Contact request was cancelled by sender.

```json
{
  "type": "contact_request_cancelled",
  "requestId": "cr-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### group_invitation_received

Received a new group invitation.

```json
{
  "type": "group_invitation_received",
  "invitation": {
    "id": "gi-550e8400-e29b-41d4-a716-446655440000",
    "groupId": "group-550e8400-e29b-41d4-a716-446655440000",
    "groupName": "Serenity Crew",
    "fromUserId": "user-550e8400-e29b-41d4-a716-446655440000",
    "message": "Join our crew!"
  }
}
```

---

#### group_invitation_accepted

Group invitation was accepted.

```json
{
  "type": "group_invitation_accepted",
  "invitationId": "gi-550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-660e8400-e29b-41d4-a716-446655440001",
  "groupId": "group-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### group_invitation_declined

Group invitation was declined.

```json
{
  "type": "group_invitation_declined",
  "invitationId": "gi-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### group_invitation_cancelled

Group invitation was cancelled by sender.

```json
{
  "type": "group_invitation_cancelled",
  "invitationId": "gi-550e8400-e29b-41d4-a716-446655440000"
}
```

---

#### handle_request_reviewed

Handle change request was reviewed by admin.

```json
{
  "type": "handle_request_reviewed",
  "request": {
    "id": "hr-550e8400-e29b-41d4-a716-446655440000",
    "status": "approved",
    "newHandle": "captain_mal",
    "reviewedAt": "2025-12-09T12:00:00.000Z",
    "reason": null
  }
}
```

---

### Rate Limiting

WebSocket connections are rate-limited per IP:

- **Limit:** 10 connections per minute
- **Window:** 60 seconds
- **Action:** Connection closed with code 1008

---

### Connection Management

**Auto-Reconnect:** Clients should implement exponential backoff for reconnection

**Status Updates:**

- User status set to `"online"` on successful auth
- User status set to `"offline"` when all connections close

**Multi-Device Support:**

- Multiple WebSocket connections per user are supported
- Events broadcast to all connected clients for a user

---

## Appendix

### Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `JWT_SECRET` | *(required)* | Secret key for JWT signing |
| `JWT_EXPIRES_IN` | `7d` | JWT token expiration |
| `ALLOWED_ORIGINS` | `null` | CORS whitelist (comma-separated) |
| `SEED_DEMO_DATA` | `false` | Seed demo accounts on startup |
| `USE_SQLITE` | `false` | Use SQLite database instead of JSON files |
| `GIPHY_API_KEY` | `null` | GIPHY API key for GIF search |
| `VAPID_PUBLIC_KEY` | `null` | VAPID public key for push notifications |
| `VAPID_PRIVATE_KEY` | `null` | VAPID private key for push notifications |
| `VAPID_EMAIL` | `mailto:admin@cortex.local` | VAPID contact email |
| `RATE_LIMIT_LOGIN_MAX` | `30` | Login requests per 15 minutes |
| `RATE_LIMIT_REGISTER_MAX` | `15` | Registration requests per hour |
| `RATE_LIMIT_API_MAX` | `300` | API requests per minute |
| `RATE_LIMIT_GIF_MAX` | `30` | GIF search requests per minute |
| `RATE_LIMIT_OEMBED_MAX` | `30` | oEmbed requests per minute |
| `LOCKOUT_THRESHOLD` | `15` | Failed login attempts before lockout |
| `LOCKOUT_DURATION_MINUTES` | `15` | Account lockout duration |
| `FEDERATION_ENABLED` | `false` | Enable server-to-server federation |
| `FEDERATION_NODE_NAME` | `null` | Server's public hostname for federation |

### Data Storage

**JSON Files (default):**

- `data/users.json` - User accounts
- `data/waves.json` - Waves and participants
- `data/messages.json` - Messages and history
- `data/groups.json` - Groups and members
- `data/handle-requests.json` - Handle change requests
- `data/contact-requests.json` - Contact requests
- `data/group-invitations.json` - Group invitations
- `data/moderation.json` - Blocks and mutes
- `data/reports.json` - Content reports
- `data/push-subscriptions.json` - Push notification subscriptions

**SQLite (optional):**

- `data/cortex.db` - Single database file
- Schema: `schema.sql` (14+ tables with indexes)
- Migration: `node migrate-json-to-sqlite.js`

### File Uploads

**Avatar Images:**

- Location: `uploads/avatars/`
- Format: `{userId}-{timestamp}.webp`
- Size: 256×256px, max 2MB input

**Message Images:**

- Location: `uploads/messages/`
- Format: `{userId}-{timestamp}.{ext}`
- Size: Max 1200×1200px, max 10MB input

**Static Serving:**

- `/uploads/avatars/` - Avatar images
- `/uploads/messages/` - Message images

---

## Federation Endpoints

Federation enables server-to-server communication for cross-instance waves. These endpoints require `FEDERATION_ENABLED=true`.

### Public Federation Endpoints

#### GET /api/federation/identity

Get this server's federation identity (public key). No authentication required.

**Response (200 OK):**

```json
{
  "nodeName": "cortex.example.com",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjAN...",
  "createdAt": "2025-12-12T10:00:00.000Z"
}
```

**Response (404 Not Found):** Federation not enabled or identity not configured.

---

### Server-to-Server Endpoints

These endpoints require HTTP Signature authentication from a trusted federation node.

#### POST /api/federation/inbox

Receive signed messages from other servers. This is the main entry point for federated content delivery.

**Authentication:** HTTP Signature (RSA-SHA256)

**Request Body:**

```json
{
  "id": "msg-uuid-12345",
  "type": "wave_invite | new_ping | ping_edited | ping_deleted | user_profile | heartbeat",
  "payload": { ... }
}
```

**Message Types:**

| Type | Description | Payload |
|------|-------------|---------|
| `wave_invite` | Invite local user to federated wave | `{ wave, participants, invitedUserHandle }` |
| `new_ping` | New ping in federated wave | `{ ping, originWaveId, author }` |
| `ping_edited` | Ping edited | `{ pingId, originWaveId, content, editedAt, version }` |
| `ping_deleted` | Ping deleted | `{ pingId, originWaveId }` |
| `user_profile` | User profile update | `{ user }` |
| `heartbeat` | Connectivity test | `{}` |

**Response (200 OK):**

```json
{
  "success": true,
  "processed": true
}
```

**Notes:**

- Messages are idempotent (duplicate IDs return success without reprocessing)
- Rate limit: 500 requests per minute per node

---

#### GET /api/federation/users/:handle

Get a local user's public profile for remote servers.

**Authentication:** HTTP Signature (RSA-SHA256)

**Response (200 OK):**

```json
{
  "user": {
    "id": "user-uuid",
    "handle": "mal",
    "displayName": "Malcolm Reynolds",
    "avatar": "M",
    "avatarUrl": "/uploads/avatars/user-uuid.webp",
    "bio": "Captain of Serenity",
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
}
```

---

### User Federation Endpoints

#### GET /api/users/resolve/:identifier

Resolve a user identifier (local or federated).

**Authentication:** Required (JWT)

**Parameters:**

- `:identifier` - Local handle (`mal`) or federated (`@mal@other-server.com`)

**Response (200 OK) - Local User:**

```json
{
  "user": {
    "id": "user-uuid",
    "handle": "mal",
    "displayName": "Malcolm Reynolds",
    "avatar": "M",
    "avatarUrl": "/uploads/avatars/user-uuid.webp",
    "bio": "Captain of Serenity",
    "isLocal": true
  }
}
```

**Response (200 OK) - Federated User:**

```json
{
  "user": {
    "id": "remote-user-uuid",
    "handle": "zoe",
    "displayName": "Zoe Washburne",
    "avatar": "Z",
    "avatarUrl": null,
    "bio": "First mate",
    "isLocal": false,
    "nodeName": "other-server.com"
  }
}
```

---

### Admin Federation Endpoints

These endpoints require admin authentication.

#### GET /api/admin/federation/status

Get federation status and configuration.

**Authentication:** Required (Admin)

**Response (200 OK):**

```json
{
  "enabled": true,
  "configured": true,
  "nodeName": "cortex.example.com",
  "nodeCount": 2,
  "activeNodes": 1,
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjAN..."
}
```

---

#### POST /api/admin/federation/identity

Generate server identity (RSA keypair). Only callable if no identity exists.

**Authentication:** Required (Admin)

**Response (201 Created):**

```json
{
  "success": true,
  "identity": {
    "nodeName": "cortex.example.com",
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjAN...",
    "createdAt": "2025-12-12T10:00:00.000Z"
  }
}
```

---

#### GET /api/admin/federation/nodes

List all federation nodes.

**Authentication:** Required (Admin)

**Response (200 OK):**

```json
{
  "nodes": [
    {
      "id": "node-uuid",
      "nodeName": "other-cortex.example.com",
      "baseUrl": "https://other-cortex.example.com",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...",
      "status": "active",
      "lastContactAt": "2025-12-12T10:30:00.000Z",
      "failureCount": 0,
      "createdAt": "2025-12-12T10:00:00.000Z"
    }
  ]
}
```

**Node Status Values:**

| Status | Description |
|--------|-------------|
| `pending` | Added but not yet connected |
| `active` | Connected and exchanging messages |
| `suspended` | Temporarily disabled |
| `blocked` | Permanently blocked |

---

#### POST /api/admin/federation/nodes

Add a new federation node.

**Authentication:** Required (Admin)

**Request Body:**

```json
{
  "nodeName": "other-cortex.example.com",
  "baseUrl": "https://other-cortex.example.com"
}
```

**Response (201 Created):**

```json
{
  "success": true,
  "node": {
    "id": "node-uuid",
    "nodeName": "other-cortex.example.com",
    "baseUrl": "https://other-cortex.example.com",
    "status": "pending",
    "createdAt": "2025-12-12T10:00:00.000Z"
  }
}
```

---

#### DELETE /api/admin/federation/nodes/:id

Remove a federation node.

**Authentication:** Required (Admin)

**Response (200 OK):**

```json
{
  "success": true
}
```

---

#### POST /api/admin/federation/nodes/:id/handshake

Initiate handshake with a federation node to exchange public keys.

**Authentication:** Required (Admin)

**Response (200 OK):**

```json
{
  "success": true,
  "node": {
    "id": "node-uuid",
    "nodeName": "other-cortex.example.com",
    "status": "active",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n..."
  }
}
```

**Notes:**

- Fetches the remote server's public key
- Updates local node record with the key
- Node status changes to `active` on success

---

### HTTP Signature Format

Server-to-server requests use HTTP Signatures (RSA-SHA256) for authentication.

**Signature Header Format:**

```
Signature: keyId="https://server.com/api/federation/identity#main-key",
           algorithm="rsa-sha256",
           headers="(request-target) host date digest",
           signature="base64-encoded-signature"
```

**Required Headers:**

| Header | Description |
|--------|-------------|
| `Host` | Target server hostname |
| `Date` | RFC 2822 formatted date |
| `Digest` | SHA-256 hash of request body (if present) |
| `Signature` | HTTP Signature header |

**Example Request:**

```bash
curl -X POST https://other-server.com/api/federation/inbox \
  -H "Host: other-server.com" \
  -H "Date: Thu, 12 Dec 2025 10:00:00 GMT" \
  -H "Digest: SHA-256=X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=" \
  -H "Signature: keyId=\"https://my-server.com/api/federation/identity#main-key\",algorithm=\"rsa-sha256\",headers=\"(request-target) host date digest\",signature=\"...\"" \
  -H "Content-Type: application/json" \
  -d '{"id":"msg-1","type":"ping","payload":{}}'
```

---

### Federation Database Tables

| Table | Description |
|-------|-------------|
| `server_identity` | Server's RSA keypair (singleton) |
| `federation_nodes` | Trusted federation partners |
| `remote_users` | Cached profiles from other servers |
| `remote_pings` | Cached pings from federated waves |
| `wave_federation` | Wave-to-node relationships |
| `federation_queue` | Outbound message queue with retries |
| `federation_inbox_log` | Inbound message deduplication |

---

## Crawl Bar Endpoints

The Crawl Bar feature provides real-time stock quotes, weather data, and news headlines in a scrolling ticker. These endpoints require JWT authentication.

### Rate Limiting

| Endpoint | Limit |
|----------|-------|
| `/api/crawl/*` | 60 requests/minute (configurable via `RATE_LIMIT_CRAWL_MAX`) |

---

### GET /api/crawl/stocks

Get stock quotes for configured symbols.

**Authentication:** Required (JWT)

**Response (200 OK):**

```json
{
  "enabled": true,
  "stocks": [
    {
      "symbol": "AAPL",
      "price": 185.42,
      "change": 2.15,
      "changePercent": 1.17
    },
    {
      "symbol": "GOOGL",
      "price": 139.80,
      "change": -0.45,
      "changePercent": -0.32
    }
  ]
}
```

**Response (501 Not Configured):**

```json
{
  "enabled": false,
  "stocks": [],
  "error": "Stock data not configured"
}
```

---

### GET /api/crawl/weather

Get weather data for user's location.

**Authentication:** Required (JWT)

**Location Priority:**
1. User preference (`user.preferences.crawlBar.location`)
2. IP geolocation (automatic)
3. Server default location

**Response (200 OK):**

```json
{
  "enabled": true,
  "weather": {
    "temp": 72,
    "description": "Partly cloudy",
    "location": "New York, NY"
  },
  "alerts": [
    {
      "event": "Heat Advisory",
      "sender": "NWS",
      "description": "Heat advisory in effect until 8 PM EDT"
    }
  ]
}
```

**Response (501 Not Configured):**

```json
{
  "enabled": false,
  "weather": null,
  "alerts": [],
  "error": "Weather data not configured"
}
```

---

### GET /api/crawl/news

Get news headlines.

**Authentication:** Required (JWT)

**Response (200 OK):**

```json
{
  "enabled": true,
  "news": [
    {
      "title": "Breaking: Major announcement expected today",
      "source": "Reuters",
      "url": "https://example.com/article"
    },
    {
      "title": "Markets surge on positive economic data",
      "source": "Bloomberg",
      "url": "https://example.com/article2"
    }
  ]
}
```

**Response (501 Not Configured):**

```json
{
  "enabled": false,
  "news": [],
  "error": "News data not configured"
}
```

---

### GET /api/crawl/all

Get all crawl bar data in a single request (recommended for efficiency).

**Authentication:** Required (JWT)

**Response (200 OK):**

```json
{
  "stocks": {
    "enabled": true,
    "stocks": [
      { "symbol": "AAPL", "price": 185.42, "change": 2.15, "changePercent": 1.17 }
    ]
  },
  "weather": {
    "enabled": true,
    "weather": { "temp": 72, "description": "Partly cloudy", "location": "New York, NY" },
    "alerts": []
  },
  "news": {
    "enabled": true,
    "news": [
      { "title": "Breaking news headline", "source": "Reuters", "url": "https://..." }
    ]
  }
}
```

---

### PUT /api/profile/crawl-preferences

Update user's crawl bar preferences.

**Authentication:** Required (JWT)

**Request Body:**

```json
{
  "crawlBar": {
    "enabled": true,
    "showStocks": true,
    "showWeather": true,
    "showNews": true,
    "scrollSpeed": "normal",
    "location": {
      "lat": 40.7128,
      "lon": -74.0060,
      "name": "New York, NY"
    }
  }
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Show/hide crawl bar |
| `showStocks` | boolean | Show stock section |
| `showWeather` | boolean | Show weather section |
| `showNews` | boolean | Show news section |
| `scrollSpeed` | string | "slow", "normal", or "fast" |
| `location` | object | Custom location override (optional) |
| `location.lat` | number | Latitude |
| `location.lon` | number | Longitude |
| `location.name` | string | Display name |

**Response (200 OK):**

```json
{
  "success": true,
  "preferences": {
    "theme": "firefly",
    "fontSize": "medium",
    "crawlBar": {
      "enabled": true,
      "showStocks": true,
      "showWeather": true,
      "showNews": true,
      "scrollSpeed": "normal"
    }
  }
}
```

---

### GET /api/admin/crawl/config

Get server-wide crawl bar configuration.

**Authentication:** Required (Admin)

**Response (200 OK):**

```json
{
  "config": {
    "stock_symbols": ["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA"],
    "news_sources": [],
    "default_location": {
      "lat": 40.7128,
      "lon": -74.0060,
      "name": "New York, NY"
    },
    "stock_refresh_interval": 60,
    "weather_refresh_interval": 300,
    "news_refresh_interval": 180,
    "stocks_enabled": true,
    "weather_enabled": true,
    "news_enabled": true,
    "apiKeys": {
      "finnhub": true,
      "openweathermap": true,
      "newsapi": true,
      "gnews": false
    }
  }
}
```

---

### PUT /api/admin/crawl/config

Update server-wide crawl bar configuration.

**Authentication:** Required (Admin)

**Request Body (all fields optional):**

```json
{
  "stock_symbols": ["AAPL", "GOOGL", "MSFT"],
  "default_location": {
    "lat": 34.0522,
    "lon": -118.2437,
    "name": "Los Angeles, CA"
  },
  "stock_refresh_interval": 60,
  "weather_refresh_interval": 300,
  "news_refresh_interval": 180,
  "stocks_enabled": true,
  "weather_enabled": true,
  "news_enabled": true
}
```

**Response (200 OK):**

```json
{
  "config": {
    "stock_symbols": ["AAPL", "GOOGL", "MSFT"],
    "default_location": {
      "lat": 34.0522,
      "lon": -118.2437,
      "name": "Los Angeles, CA"
    },
    "stocks_enabled": true,
    "weather_enabled": true,
    "news_enabled": true,
    "apiKeys": {
      "finnhub": true,
      "openweathermap": true,
      "newsapi": true,
      "gnews": false
    }
  }
}
```

---

### Crawl Bar Database Tables

| Table | Description |
|-------|-------------|
| `crawl_config` | Server-wide crawl bar configuration (singleton) |
| `crawl_cache` | External API response caching with TTL |

---

### External API Integrations

| Provider | Endpoint | Cache TTL | Free Tier |
|----------|----------|-----------|-----------|
| **Finnhub** | Stock quotes | 60 seconds | 60 calls/min |
| **OpenWeatherMap** | Weather data | 5 minutes | 1,000 calls/day |
| **NewsAPI.org** | News headlines | 3 minutes | 100 calls/day (dev only) |
| **GNews.io** | News headlines (backup) | 3 minutes | 100 calls/day |
| **ip-api.com** | IP geolocation | Per session | 45 calls/min |

---

**End of Documentation**

For more information, see:

- [Project README](../README.md)
- [CLAUDE.md](../CLAUDE.md) - Development guide for AI assistants
- [GitHub Repository](https://github.com/Farhold-Labs/cortex)
