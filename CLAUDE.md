# CLAUDE.md

This file provides guidance to Claude Code when working with the Cortex codebase.

## Project Overview

Cortex is a privacy-first federated communication platform inspired by Google Wave with a Firefly aesthetic. It uses a client-server architecture with real-time WebSocket communication and end-to-end encryption.

### Terminology (v2.0.0)

| Term | Description | Old Name |
|------|-------------|----------|
| **Wave** | Conversation container | (unchanged) |
| **Ping** | Individual message | Droplet |
| **Thread** | Isolated reply chain within a wave | Burst/Ripple |
| **Crew** | User group | Group |

**Tech Stack:**
- **Server:** Node.js + Express + WebSocket (ws)
- **Client:** React (single JSX file) + Vite
- **Storage:** SQLite (production) or JSON files (development)
- **Encryption:** Web Crypto API (ECDH P-384 + AES-256-GCM)

---

## Developer Workflow

### Git Branching Strategy

Three permanent branches with GitHub branch protection enforced:

| Branch | Purpose | PR Required | Approvals |
|--------|---------|-------------|-----------|
| `develop` | Active development - all new code merges here | Yes | 0 (self-merge OK) |
| `qa` | Testing/QA - merge from develop for testing | Yes | 1 |
| `master` | Production - merge from qa after QA approval | Yes | 1 (stale reviews dismissed) |

All three branches enforce rules for admins — no one can bypass protections.

**Workflow:**
1. Create a feature branch off `develop` (e.g. `feat/file-attachments`)
2. Apply version at start of feature work, not at the end
3. Commit to the feature branch and push
4. Create PR from feature branch → `develop` (self-merge OK, no approval needed)
5. When ready for testing: create PR from `develop` → `qa` (requires 1 approval)
6. After QA approval: create PR from `qa` → `master` (requires 1 approval)

**Never:**
- Push directly to `develop`, `qa`, or `master` (branch protection blocks this)
- Cherry-pick commits between branches

### Version Numbering

Format: `vMAJOR.MINOR.PATCH`

| Type | When to Use | Example |
|------|-------------|---------|
| **Major** (v2.0.0) | Breaking changes, major architecture shifts | Database schema overhaul |
| **Minor** (v1.20.0) | New features, significant enhancements | New E2EE system |
| **Patch** (v1.19.5) | Bug fixes, small improvements | Fix unread count bug |

- Update version in `server/package.json` and `client/package.json`
- Update `VERSION` constant in `client/src/config/constants.js`
- Apply version at start of feature work, not at the end

### Testing Requirements

Before committing:
1. Rebuild client: `cd client && npm run build`
2. Restart server: `pm2 restart cortex-api`
3. Verify server starts without errors: `pm2 logs cortex-api --lines 20`
4. Test affected functionality manually

### Documentation Requirements

- **CHANGELOG.md**: All detailed changes, feature descriptions, technical details
- **CLAUDE.md**: Only workflow instructions and essential architecture (this file)
- Keep CHANGELOG updated with every commit, not just releases
- After each merge to master: create GitHub release with release notes

### Release Process

After merge to master:
1. Create git tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
2. Create GitHub release with detailed notes
3. Post release notice to Cortex Updates wave with:
   - Summary of changes
   - Upgrade instructions
   - Link to CHANGELOG.md

---

## Security Guidelines

**Cortex is a privacy-first platform. Code with a hacker's mindset.**

### Security Principles

1. **Never trust user input** - Sanitize everything with `sanitize-html`
2. **Validate on server** - Client validation is for UX only
3. **Least privilege** - Users should only access their own data
4. **Defense in depth** - Multiple layers of protection

### Common Attack Vectors to Guard Against

| Attack | Prevention |
|--------|------------|
| **XSS** | Sanitize all HTML, use strict CSP, escape output |
| **SQL Injection** | Use parameterized queries (better-sqlite3 does this) |
| **CSRF** | JWT tokens in headers, not cookies |
| **Auth Bypass** | Always use `authenticateToken` middleware |
| **Data Leakage** | Check user permissions before returning data |
| **Rate Limiting Bypass** | Apply rate limiters to all sensitive endpoints |

### Security Checklist for New Features

- [ ] All user input sanitized before storage
- [ ] Authentication required for sensitive endpoints
- [ ] Authorization checked (can THIS user access THIS resource?)
- [ ] Rate limiting applied where appropriate
- [ ] No sensitive data in logs or error messages
- [ ] E2EE respected (encrypted content stays encrypted on server)

### When You Find a Security Issue

1. Note it immediately in the code or commit message
2. Fix it before completing the feature if possible
3. If complex, create a follow-up task with `[SECURITY]` prefix

---

## Development Commands

### Server
```bash
cd server
npm install              # Install dependencies
npm start                # Start production server (port 3001)
npm run dev              # Start with hot-reload
```

### Client
```bash
cd client
npm install              # Install dependencies
npm run dev              # Dev server (port 3000)
npm run build            # Production build
```

### PM2 (Production)
```bash
pm2 start server.js --name cortex-api --cwd /path/to/server
pm2 restart cortex-api
pm2 logs cortex-api --lines 50
```

---

## Core Architecture

### Server (`server/server.js`)

Single-file Express server organized in sections (marked with `// ============`):
- Configuration & environment variables
- Security middleware (rate limiting, sanitization, helmet)
- Database class (SQLite wrapper)
- API routes by feature (auth, users, waves, messages, etc.)
- WebSocket server for real-time events

### Client (`client/CortexApp.jsx`)

Single-file React application:
- Context providers (Auth, E2EE)
- Custom hooks (useAPI, useWebSocket, useSwipeGesture)
- UI components (modals, forms, lists)
- Main views (WaveList, WaveView, FocusView, etc.)

### Database (`server/database-sqlite.js`)

SQLite database with tables for:
- users, user_sessions, user_encryption_keys
- waves, wave_participants, wave_encryption_keys
- messages (pings), message_read_by
- groups, group_members, contacts
- And more (see schema.sql)

### Key Data Entities

- **Users**: UUID-based, with handles, profiles, E2EE keypairs
- **Waves**: Conversation threads with privacy levels and participants
- **Messages**: Messages within waves, threaded with parent/child
- **Groups**: User collections for group waves

### Role-Based Access Control (v1.20.0)

**Roles hierarchy**: Admin > Moderator > User

| Role | Level | Permissions |
|------|-------|-------------|
| **User** | 1 | Normal access to own data |
| **Moderator** | 2 | Reports, warnings, user management, activity log |
| **Admin** | 3 | All moderator permissions + handle requests, crawl bar, alerts, federation, role assignment |

**Server-side usage**:
```javascript
// Authorization helpers (server.js)
const ROLES = { ADMIN: 'admin', MODERATOR: 'moderator', USER: 'user' };
if (!requireRole(user, ROLES.MODERATOR, res)) return;  // Returns 403 if not moderator+
if (!hasRole(user, ROLES.ADMIN)) { ... }  // Boolean check
```

**Client-side usage**:
```javascript
// Role access helper (constants.js)
if (canAccess(user, 'moderator')) { ... }  // Show admin panel
if (canAccess(user, 'admin')) { ... }      // Show system config
```

**Database**: `role` column in users table. First user gets `admin` role. Migration auto-converts `is_admin` flag.

---

## Environment Variables

Key server configuration (see `.env.example` for full list):

```bash
# Required
PORT=3001
JWT_SECRET=your-secret-key

# Database
USE_SQLITE=true

# Security
ALLOWED_ORIGINS=https://your-domain.com

# Features
FEDERATION_ENABLED=true
FEDERATION_NODE_NAME=cortex.example.com

# GIF Provider
GIF_PROVIDER=tenor  # giphy, tenor, or both
TENOR_API_KEY=your-key
GIPHY_API_KEY=your-key

# Privacy Encryption (v2.17.0 - v2.24.0)
EMAIL_ENCRYPTION_KEY=<32-byte-hex>       # openssl rand -hex 32
WAVE_PARTICIPATION_KEY=<32-byte-hex>     # openssl rand -hex 32
PUSH_SUBSCRIPTION_KEY=<32-byte-hex>      # openssl rand -hex 32
CREW_MEMBERSHIP_KEY=<32-byte-hex>        # openssl rand -hex 32

# Push Notifications
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

---

## Testing Accounts

If `SEED_DEMO_DATA=true` (password: `Demo123!`):
- `mal` - Malcolm Reynolds (Admin)
- `zoe`, `wash`, `kaylee`, `jayne`, `inara`, `simon`, `river`

---

## Firefly Aesthetic Theme

The UI uses a dark green terminal aesthetic:
- **Background:** Dark green (#050805)
- **Accent:** Amber (#ffd23f)
- **Status:** Green (#0ead69)
- **Typography:** Monospace (Courier New, Monaco)
- **Effects:** CRT scanlines, text glow, phosphor effect

All colors use CSS variables (see theme system in client).

---

## Reference

For detailed feature documentation and version history, see:
- **CHANGELOG.md** - Complete version history with technical details
- **docs/API.md** - API endpoint documentation
- **README.md** - User-facing documentation
