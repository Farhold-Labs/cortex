# Organization Features Plan

This document outlines the planned implementation for making Cortex suitable for organizations, broken into four discrete features.

---

## Feature 1 — Calendar Event Ingestion

**Goal:** Allow organizations to push external calendar events into Cortex waves (e.g. from an HR system, ticketing platform, or automation tool) without requiring a full CalDAV server.

### Mechanism
Extend the existing Bot API with a calendar-specific endpoint. Any system with an HTTP client can POST events.

### Endpoint
```
POST /api/bot/calendar-event
Authorization: Bearer <bot-key>

{
  "waveId": "thread-...",
  "title": "Board Meeting",
  "startAt": "2026-06-01T14:00:00Z",
  "endAt": "2026-06-01T15:00:00Z",
  "description": "Quarterly review",
  "location": "Conference Room A",
  "recurrence": null          // or { rule: "RRULE:FREQ=WEEKLY;..." }
}
```

### Server Changes
- Validate and insert directly into the existing `events` table (used by the calendar feature)
- Associate the event with the wave so it appears in that wave's calendar view
- Trigger a `calendar_event_created` WebSocket broadcast to wave participants
- Return the created event ID

### UI
No UI changes needed — events ingested via API appear in the existing calendar view automatically.

---

## Feature 2 — CalDAV Subscription Feed (Read-Only .ics)

**Goal:** Let users subscribe to a Cortex wave's calendar from any standards-compliant calendar client (Apple Calendar, Google Calendar, Outlook, Thunderbird).

### How It Works
Generate a per-user, per-wave iCalendar (`.ics`) feed URL. Calendar clients poll this URL periodically and display events alongside their own calendars.

### Endpoint
```
GET /api/calendar/:waveId/feed.ics?token=<feed-token>
```

- Feed tokens are scoped to a single user+wave combination and are read-only
- Token is generated on demand from Wave Settings and stored hashed in a new `calendar_feed_tokens` table
- No session cookie required — the token authenticates the request
- Response: `text/calendar` with VCALENDAR/VEVENT blocks for all events in the wave

### Database
```sql
CREATE TABLE calendar_feed_tokens (
    id TEXT PRIMARY KEY,
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
);
```

### UI
- "Subscribe to Calendar" button in Wave Settings (participants only, not admin-only)
- Clicking generates a feed token (if not already created) and shows the `.ics` URL
- Copy-to-clipboard button; instructions for Apple Calendar, Google Calendar, Outlook
- Option to revoke/regenerate the token

### Notes
- Read-only — external clients cannot write events back through this feed
- Tokens should be long random strings (32+ bytes hex)
- Include proper `DTSTAMP`, `UID`, `SUMMARY`, `DTSTART`, `DTEND`, `DESCRIPTION`, `LOCATION` fields
- Support `RRULE` for recurring events

---

## Feature 3 — Embeddable Calendar Widget

**Goal:** Allow organizations to embed a public wave's event calendar on an external website (e.g. a church bulletin page, club website, community portal).

**Scope:** Public waves only. Private, Crew, and Verse-Wide waves are excluded — there is no auth mechanism in an embed context.

### Endpoint
```
GET /api/calendar/:waveId/embed
```
- Returns a standalone HTML page (no Cortex chrome) with the wave's upcoming events
- Only works if `wave.privacy === 'public'`
- Returns 403 for non-public waves
- No authentication required

### Embed Code
```html
<iframe
  src="https://cortex.farhold.com/api/calendar/thread-.../embed"
  width="100%"
  height="400"
  frameborder="0"
  style="border-radius: 8px;">
</iframe>
```

### Widget Design
- Dark-on-light or light-on-dark, configurable via `?theme=light|dark` query param
- Shows next N upcoming events (default 10)
- Each event: date, time, title, location (if set)
- Clicking an event deep-links to the Cortex wave (opens in new tab)
- Responsive, mobile-friendly
- No JavaScript dependencies — pure server-rendered HTML + inline CSS

### UI in Cortex
- "Embed Calendar" section in Wave Settings, visible only on public waves
- Shows the iframe snippet with a copy button
- Preview link to open the embed page in a new tab

---

## Feature 4 — Email Notifications

**Goal:** Allow users to opt into email notifications for wave activity, mentions, and calendar event reminders.

### Email Verification Flow
1. User enters email in Profile Settings (separate from account email if applicable)
2. Server sends a verification link (time-limited JWT, 24h)
3. User clicks link → email marked verified in DB
4. Notification emails only sent to verified addresses

### Database Changes
```sql
-- Add to users table:
ALTER TABLE users ADD COLUMN notification_email TEXT;
ALTER TABLE users ADD COLUMN notification_email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN notification_email_token TEXT;      -- pending verification token hash
ALTER TABLE users ADD COLUMN notification_email_token_exp TEXT;  -- expiry timestamp

-- New table for email notification preferences:
CREATE TABLE email_notification_prefs (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    direct_mention INTEGER NOT NULL DEFAULT 1,   -- 1 = enabled
    reply INTEGER NOT NULL DEFAULT 1,
    wave_activity INTEGER NOT NULL DEFAULT 0,    -- off by default (noisy)
    calendar_reminders INTEGER NOT NULL DEFAULT 1,
    digest_frequency TEXT NOT NULL DEFAULT 'immediate'  -- 'immediate', 'hourly', 'daily'
);
```

### Server Changes
- `POST /api/auth/email/verify-request` — send verification email
- `GET /api/auth/email/verify?token=<token>` — confirm verification
- SMTP config via env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- Pluggable transport: support Nodemailer with SMTP (covers SendGrid, Mailgun, SES, self-hosted Postfix)
- Email templates: plain-text first (no HTML required for v1); include unsubscribe link in every email
- `immediate` digest: send on each qualifying notification event
- `hourly`/`daily` digest: batch via a scheduled job (cron-style interval in server process)

### Calendar Reminders
- At event creation/update, schedule a reminder email N minutes before start (configurable per-user, default 15 min)
- Store pending reminders in a `calendar_reminders` table; server polls on startup and sets timers

### UI
- "Email Notifications" section in Profile Settings
- Enter notification email, click "Send verification"
- After verification: checkboxes for mention, reply, wave_activity, calendar reminders
- Digest frequency selector
- "Remove email" / re-verify option

### Privacy
- Notification emails contain minimal content — subject line only for encrypted wave messages (same as push notification policy)
- Unsubscribe link in every email bypasses auth (token-based one-click unsubscribe)

---

## Implementation Order (Recommended)

1. **CalDAV Feed** — standalone, no dependencies on other features, immediately useful
2. **Calendar Ingestion** — builds on existing Bot API and events table
3. **Embeddable Widget** — purely additive, no DB changes
4. **Email Notifications** — most complex; requires SMTP setup, verification flow, and digest scheduling

Each feature ships as its own minor version under a `v2.49.x` or `v2.50.x` milestone.
