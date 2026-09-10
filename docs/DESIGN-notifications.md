# Cortex Notifications System Design

> **Historical document.** Early design note using pre-v2.0.0 terminology. Notifications have since gained per-instance defaults, per-wave mute and email delivery. Kept for the reasoning behind the design, not as a description of how Cortex works today — see CHANGELOG.md and docs/API.md for current behaviour.

## Overview

This document outlines the notification system design for Cortex, with particular focus on how notifications work with the Droplets architecture (Focus View and Break Out features).

---

## Current Notification Infrastructure

### Existing Systems (v1.9.0)

1. **WebSocket Real-Time Events**
   - `new_message` - New droplet created
   - `message_edited` - Droplet content updated
   - `wave_created`, `wave_updated`, `wave_deleted`
   - `contact_request_received/accepted/declined`
   - `group_invitation_received/accepted/declined`
   - `report_resolved`, `warning_received`

2. **Push Notifications (PWA)**
   - Server-sent via Web Push API
   - Shows when app is backgrounded/closed
   - Click navigates to specific wave
   - Unique tags per message prevent replacement

3. **In-App Indicators**
   - Unread count badges on navigation
   - Amber border on unread droplets
   - Per-message `readBy[]` tracking

---

## Notification Challenges with Droplets

### Problem Areas

1. **Focus View Context**
   - User focused on droplet D in Wave A
   - New reply arrives to D
   - Where should notification appear?

2. **Break Out Transitions**
   - Droplet D broken out from Wave A to Wave B
   - User following Wave A wants to know about activity
   - User following Wave B also needs notifications

3. **Cross-Wave @Mentions**
   - User @mentioned in Wave B (broken out from A)
   - User only has access to Wave A
   - How do they get notified?

4. **Nested Focus Depth**
   - User focused 3 levels deep: Wave A → D1 → D2 → D3
   - New reply to D1 arrives
   - Should it bubble up? Interrupt current focus?

---

## Proposed Notification Architecture

### Notification Types

| Type | Trigger | Priority | Sound |
|------|---------|----------|-------|
| `direct_mention` | @mentioned in droplet | High | Yes |
| `reply_to_yours` | Reply to user's droplet | High | Yes |
| `wave_activity` | New droplet in wave user follows | Medium | Optional |
| `breakout_from_followed` | Droplet broken out of followed wave | Medium | No |
| `focus_activity` | Activity in user's current focus chain | Low | No |

### Notification Routing Rules

```
1. Direct @mention → Always notify, regardless of context
2. Reply to user's droplet → Notify unless user is focused on that droplet
3. Wave activity → Notify based on user's wave notification settings
4. Break out events → Notify original wave followers with link to new wave
```

---

## Focus View Notifications

### Unread Bubble-Up

When user is NOT in Focus View:
- Unread indicators bubble up to parent droplet
- Parent shows count: "3 unread replies"
- Wave list shows aggregate unread for entire wave

When user IS in Focus View:
- Show unread within current focus context only
- Don't interrupt with notifications for visible content
- Subtle indicator for activity outside focus scope

### Focus Context Awareness

```javascript
// Notification decision tree
function shouldNotify(notification, userContext) {
  // Always notify for direct mentions
  if (notification.type === 'direct_mention') return true;

  // Don't notify if user is actively viewing the droplet
  if (userContext.focusChain.includes(notification.dropletId)) {
    return false; // Mark as read instead
  }

  // Don't notify if user is in same wave and it's visible
  if (userContext.currentWaveId === notification.waveId &&
      userContext.visibleDropletIds.includes(notification.dropletId)) {
    return false;
  }

  return true;
}
```

### Visual Indicators in Focus View

```
┌─────────────────────────────────────────┐
│ Wave: Project Discussion                │
│ ← ← Root > Design Review > API Changes  │
│                              ┌─────┐    │
│                              │ 🔔 2│    │  ← Activity outside focus
│                              └─────┘    │
├─────────────────────────────────────────┤
│ [Focused Droplet Content]               │
│                                         │
│ ├─ Reply 1 (unread) ●                   │  ← Unread in focus
│ │  └─ Reply 1.1                         │
│ └─ Reply 2                              │
└─────────────────────────────────────────┘
```

---

## Break Out Notifications

### When Droplet is Broken Out

**To Original Wave Followers:**
```
┌────────────────────────────────────────┐
│ 🔗 Thread moved to new wave            │
│                                        │
│ "API Discussion" was broken out to     │
│ new wave: "API v2 Design"              │
│                                        │
│ [View New Wave]  [Dismiss]             │
└────────────────────────────────────────┘
```

**To Break Out Chain Subscribers:**
- Users who participated in original thread get notified
- Option to "follow" the new wave automatically

### Break Out Activity Notifications

Activity in broken-out wave can optionally notify original wave followers:

```javascript
// User preference
preferences: {
  notifyBreakoutActivity: 'all' | 'mentions_only' | 'none'
}
```

### Link Card Notifications

When viewing original wave with link card:
- Show badge on link card if new activity in broken-out wave
- Format: "🔗 API v2 Design (3 new)"

---

## Cross-Wave @Mention Notifications

### Scenario

1. Wave A contains droplet D
2. D is broken out to Wave B
3. User X only has access to Wave A
4. User Y @mentions User X in Wave B

### Solution: Mention Bridge

```javascript
// When @mention detected in broken-out wave
if (mentionedUser.hasAccessTo(originalWaveId) &&
    !mentionedUser.hasAccessTo(currentWaveId)) {

  // Create notification with context
  notify(mentionedUser, {
    type: 'cross_wave_mention',
    message: `${mentioner} mentioned you in a discussion that originated from "${originalWaveName}"`,
    originalWaveId: originalWaveId,
    dropletPreview: truncate(dropletContent, 100),
    // Don't include direct link - they don't have access
    action: 'request_access' | 'view_origin'
  });
}
```

### Access Request Flow

```
┌────────────────────────────────────────┐
│ 📢 You were mentioned                  │
│                                        │
│ Sarah mentioned you in a discussion    │
│ that originated from "Project Alpha"   │
│                                        │
│ "...@john can you review the API..."   │
│                                        │
│ [Request Access] [View Original Wave]  │
└────────────────────────────────────────┘
```

---

## Notification Settings

### Per-Wave Settings

```javascript
waveNotificationSettings: {
  waveId: {
    enabled: true,
    level: 'all' | 'mentions' | 'none',
    sound: true,
    push: true
  }
}
```

### Global Preferences

```javascript
preferences: {
  notifications: {
    // Master toggle
    enabled: true,

    // By type
    directMentions: 'always',      // always | app_closed | never
    replies: 'always',
    waveActivity: 'app_closed',
    breakoutEvents: 'app_closed',

    // Behavior
    soundEnabled: true,
    vibrationEnabled: true,
    showPreview: true,             // Show message content in notification

    // Focus View specific
    suppressWhileFocused: true,    // Don't notify for visible content
    bubbleUpUnread: true,          // Show unread counts on parent droplets

    // Break out specific
    followBreakouts: 'participated', // all | participated | none
    notifyBreakoutActivity: 'mentions_only'
  }
}
```

### Do Not Disturb

```javascript
doNotDisturb: {
  enabled: false,
  schedule: {
    enabled: true,
    start: '22:00',
    end: '08:00',
    timezone: 'America/New_York'
  },
  allowUrgent: true  // Still allow direct mentions
}
```

---

## Database Schema Additions

### notifications Table

```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,  -- direct_mention, reply, wave_activity, breakout, etc.

  -- Source information
  wave_id TEXT REFERENCES waves(id),
  droplet_id TEXT REFERENCES messages(id),
  actor_id TEXT REFERENCES users(id),  -- Who triggered the notification

  -- For cross-wave mentions
  original_wave_id TEXT REFERENCES waves(id),

  -- Content
  title TEXT NOT NULL,
  body TEXT,
  preview TEXT,  -- Truncated droplet content

  -- State
  read BOOLEAN DEFAULT FALSE,
  dismissed BOOLEAN DEFAULT FALSE,
  push_sent BOOLEAN DEFAULT FALSE,

  -- Timestamps
  created_at TEXT NOT NULL,
  read_at TEXT,

  -- Grouping (for collapsing similar notifications)
  group_key TEXT,  -- e.g., 'wave:{waveId}:activity'

  FOREIGN KEY (wave_id) REFERENCES waves(id) ON DELETE SET NULL,
  FOREIGN KEY (droplet_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read) WHERE read = FALSE;
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_created ON notifications(created_at);
```

### notification_preferences Table

```sql
CREATE TABLE notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferences JSON NOT NULL DEFAULT '{}'
);
```

### wave_notification_settings Table

```sql
CREATE TABLE wave_notification_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT TRUE,
  level TEXT DEFAULT 'all',  -- all, mentions, none
  sound BOOLEAN DEFAULT TRUE,
  push BOOLEAN DEFAULT TRUE,
  PRIMARY KEY (user_id, wave_id)
);
```

---

## API Endpoints

### Notification Management

```
GET /api/notifications
  ?unread=true          - Only unread
  ?type=direct_mention  - Filter by type
  ?limit=50&offset=0    - Pagination

GET /api/notifications/count
  Returns: { unread: 5, byType: { direct_mention: 2, reply: 3 } }

POST /api/notifications/:id/read
  Mark single notification as read

POST /api/notifications/read-all
  Mark all notifications as read

DELETE /api/notifications/:id
  Dismiss notification

PUT /api/notifications/preferences
  Update global notification preferences

PUT /api/waves/:id/notifications
  Update per-wave notification settings
```

### WebSocket Events

```javascript
// Server → Client
{ type: 'notification', notification: {...} }
{ type: 'notification_read', notificationId: '...' }
{ type: 'unread_count_update', count: 5 }

// Client → Server (for real-time read tracking)
{ type: 'mark_notification_read', notificationId: '...' }
{ type: 'viewing_droplet', dropletId: '...' }  // Suppress notifications
```

---

## Implementation Phases

### Phase N1: Core Notification Infrastructure
- [ ] Create notifications table and API endpoints
- [ ] Notification preferences storage
- [ ] Basic notification creation on new droplet
- [ ] Notification list UI component

### Phase N2: Smart Notification Routing
- [ ] Implement shouldNotify() decision logic
- [ ] Focus context awareness
- [ ] Suppress notifications for visible content
- [ ] Real-time viewing state via WebSocket

### Phase N3: Break Out Notifications
- [ ] Notify on break out event
- [ ] Link card activity badges
- [ ] Break out chain subscription
- [ ] followBreakouts preference

### Phase N4: Cross-Wave @Mentions
- [ ] Detect mentions in broken-out waves
- [ ] Mention bridge notifications
- [ ] Access request flow
- [ ] View origin navigation

### Phase N5: Notification UI Polish
- [ ] Notification center/drawer
- [ ] Grouped notifications (collapse similar)
- [ ] Notification preferences UI
- [ ] Per-wave settings UI
- [ ] Do Not Disturb mode

### Phase N6: Push Notification Updates
- [ ] Update push payload for droplet context
- [ ] Focus-aware push (don't push if focused)
- [ ] Break out push notifications
- [ ] Cross-wave mention push with access context

---

## Open Questions (To Be Resolved)

1. **Notification Retention**: How long to keep notifications? 30 days? Until read + 7 days?

2. **Notification Grouping**: Group "5 new replies in Wave X" or show individually?

3. **Real-time Unread Sync**: How to sync unread state across devices?

4. **Offline Accumulation**: Max notifications to accumulate while offline?

5. **Break Out Notification Frequency**: Rate limit break-out activity notifications?

---

## Dependencies

- Requires: Droplets architecture (DESIGN-droplets.md)
- Integrates with: Push notification system (v1.8.0)
- Enhances: Per-message read tracking (v1.4.0)

---

*This document should be finalized before implementing notification phases.*
