# Outgoing Webhooks Feature Plan

> **Historical document.** Planning document; outgoing webhooks have shipped. Kept for the reasoning behind the design, not as a description of how Cortex works today — see CHANGELOG.md and docs/API.md for current behaviour.

This document outlines the implementation plan for adding outgoing webhook support to Cortex, enabling automatic forwarding of wave messages to external services like Discord, Slack, etc.

## Overview

**Goal:** Allow administrators to configure webhooks that automatically forward messages from specific waves to external services.

**Primary Use Case:** Forward Cortex Updates wave messages to a Discord channel.

---

## Database Schema

### New Table: `wave_webhooks`

```sql
CREATE TABLE wave_webhooks (
    id TEXT PRIMARY KEY,
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                    -- Display name (e.g., "Discord Updates")
    url TEXT NOT NULL,                     -- Webhook URL
    platform TEXT DEFAULT 'generic',       -- discord, slack, teams, generic
    enabled INTEGER DEFAULT 1,

    -- Filtering options
    include_bot_messages INTEGER DEFAULT 1, -- Forward bot messages?
    include_encrypted INTEGER DEFAULT 0,    -- Forward encrypted (shows "[Encrypted]")?

    -- Rate limiting
    cooldown_seconds INTEGER DEFAULT 0,     -- Min seconds between webhook calls
    last_triggered_at TEXT,

    -- Stats & debugging
    total_sent INTEGER DEFAULT 0,
    total_errors INTEGER DEFAULT 0,
    last_error TEXT,
    last_error_at TEXT,

    -- Metadata
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT
);

CREATE INDEX idx_wave_webhooks_wave ON wave_webhooks(wave_id);
CREATE INDEX idx_wave_webhooks_enabled ON wave_webhooks(enabled);
```

---

## API Endpoints

### List Webhooks for Wave
```
GET /api/waves/:waveId/webhooks
Auth: Required (wave admin or system admin)
Response: { webhooks: [...] }
```

### Create Webhook
```
POST /api/waves/:waveId/webhooks
Auth: Required (wave admin or system admin)
Body: {
  name: "Discord Updates",
  url: "https://discord.com/api/webhooks/...",
  platform: "discord",
  includeBotMessages: true,
  includeEncrypted: false,
  cooldownSeconds: 0
}
Response: { webhook: {...} }
```

### Update Webhook
```
PUT /api/webhooks/:webhookId
Auth: Required (wave admin or system admin)
Body: { enabled: false, name: "New Name", ... }
Response: { webhook: {...} }
```

### Delete Webhook
```
DELETE /api/webhooks/:webhookId
Auth: Required (wave admin or system admin)
Response: { success: true }
```

### Test Webhook
```
POST /api/webhooks/:webhookId/test
Auth: Required (wave admin or system admin)
Response: { success: true, response: "..." }
```

---

## Platform-Specific Payloads

### Discord

Discord webhook format:
```json
{
  "username": "Cortex",
  "avatar_url": "https://cortex.example.com/logo.png",
  "embeds": [{
    "title": "New message in Wave Name",
    "description": "Message content here...",
    "color": 16750848,
    "author": {
      "name": "Username",
      "icon_url": "https://cortex.example.com/avatar/..."
    },
    "timestamp": "2026-01-23T12:00:00.000Z",
    "footer": {
      "text": "Cortex"
    }
  }]
}
```

### Slack

Slack webhook format:
```json
{
  "username": "Cortex",
  "icon_url": "https://cortex.example.com/logo.png",
  "attachments": [{
    "fallback": "New message from Username in Wave Name",
    "color": "#ffd23f",
    "author_name": "Username",
    "author_icon": "https://cortex.example.com/avatar/...",
    "title": "Wave Name",
    "text": "Message content here...",
    "ts": 1706018400
  }]
}
```

### Microsoft Teams

Teams webhook format:
```json
{
  "@type": "MessageCard",
  "@context": "http://schema.org/extensions",
  "themeColor": "ffd23f",
  "summary": "New message in Wave Name",
  "sections": [{
    "activityTitle": "Username",
    "activitySubtitle": "Wave Name",
    "activityImage": "https://cortex.example.com/avatar/...",
    "text": "Message content here..."
  }]
}
```

### Generic

Simple JSON payload:
```json
{
  "event": "new_message",
  "wave": {
    "id": "wave-...",
    "title": "Wave Name"
  },
  "message": {
    "id": "droplet-...",
    "content": "Message content...",
    "author": {
      "id": "user-...",
      "name": "Username",
      "handle": "username"
    },
    "createdAt": "2026-01-23T12:00:00.000Z"
  }
}
```

---

## Server Implementation

### Webhook Trigger Logic

In `server.js`, after a message is created, trigger webhooks:

```javascript
// After creating a ping/droplet in createMessage or bot ping endpoint
async function triggerWaveWebhooks(waveId, message, wave) {
  try {
    const webhooks = db.getWaveWebhooks(waveId);
    if (!webhooks || webhooks.length === 0) return;

    for (const webhook of webhooks) {
      if (!webhook.enabled) continue;

      // Skip bot messages if configured
      if (message.isBot && !webhook.include_bot_messages) continue;

      // Skip encrypted messages if configured
      if (message.encrypted && !webhook.include_encrypted) continue;

      // Check cooldown
      if (webhook.cooldown_seconds > 0 && webhook.last_triggered_at) {
        const elapsed = (Date.now() - new Date(webhook.last_triggered_at).getTime()) / 1000;
        if (elapsed < webhook.cooldown_seconds) continue;
      }

      // Build platform-specific payload
      const payload = buildWebhookPayload(webhook.platform, message, wave);

      // Send async (don't block message creation)
      sendWebhook(webhook, payload).catch(err => {
        console.error(`Webhook ${webhook.id} failed:`, err.message);
        db.updateWebhookError(webhook.id, err.message);
      });
    }
  } catch (err) {
    console.error('Webhook trigger error:', err);
  }
}

async function sendWebhook(webhook, payload) {
  const response = await fetch(webhook.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000) // 10s timeout
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  db.updateWebhookSuccess(webhook.id);
  return response;
}

function buildWebhookPayload(platform, message, wave) {
  const content = message.encrypted ? '[Encrypted message]' : stripHtml(message.content);
  const authorName = message.sender_name || 'Unknown';
  const authorAvatar = message.sender_avatar_url
    ? `${BASE_URL}${message.sender_avatar_url}`
    : null;

  switch (platform) {
    case 'discord':
      return {
        username: 'Cortex',
        embeds: [{
          title: wave.title,
          description: content.substring(0, 2000), // Discord limit
          color: 0xffd23f, // Amber
          author: {
            name: authorName,
            icon_url: authorAvatar
          },
          timestamp: message.created_at,
          footer: { text: 'Cortex' }
        }]
      };

    case 'slack':
      return {
        username: 'Cortex',
        attachments: [{
          fallback: `${authorName} in ${wave.title}: ${content.substring(0, 100)}`,
          color: '#ffd23f',
          author_name: authorName,
          author_icon: authorAvatar,
          title: wave.title,
          text: content,
          ts: Math.floor(new Date(message.created_at).getTime() / 1000)
        }]
      };

    case 'teams':
      return {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        themeColor: 'ffd23f',
        summary: `${authorName} in ${wave.title}`,
        sections: [{
          activityTitle: authorName,
          activitySubtitle: wave.title,
          activityImage: authorAvatar,
          text: content
        }]
      };

    default: // generic
      return {
        event: 'new_message',
        wave: { id: wave.id, title: wave.title },
        message: {
          id: message.id,
          content,
          author: {
            id: message.author_id,
            name: authorName,
            handle: message.sender_handle
          },
          createdAt: message.created_at
        }
      };
  }
}
```

---

## UI Implementation

### Wave Settings Modal Addition

Add a "Webhooks" tab to the Wave Settings modal:

```jsx
// In WaveSettingsModal.jsx or new WebhooksTab.jsx

const WebhooksTab = ({ wave, fetchAPI, showToast }) => {
  const [webhooks, setWebhooks] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchAPI(`/waves/${wave.id}/webhooks`)
      .then(data => setWebhooks(data.webhooks))
      .catch(err => console.error(err));
  }, [wave.id]);

  return (
    <div>
      <h3>Outgoing Webhooks</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Automatically forward messages to external services like Discord or Slack.
      </p>

      {webhooks.map(webhook => (
        <WebhookItem
          key={webhook.id}
          webhook={webhook}
          onUpdate={...}
          onDelete={...}
          onTest={...}
        />
      ))}

      <button onClick={() => setShowAddModal(true)}>
        + Add Webhook
      </button>

      {showAddModal && (
        <AddWebhookModal
          waveId={wave.id}
          onClose={() => setShowAddModal(false)}
          onAdd={(webhook) => setWebhooks([...webhooks, webhook])}
        />
      )}
    </div>
  );
};
```

### Add Webhook Modal

```jsx
const AddWebhookModal = ({ waveId, onClose, onAdd, fetchAPI }) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState('discord');

  const handleSubmit = async () => {
    const webhook = await fetchAPI(`/waves/${waveId}/webhooks`, {
      method: 'POST',
      body: { name, url, platform }
    });
    onAdd(webhook.webhook);
    onClose();
  };

  return (
    <Modal title="Add Webhook" onClose={onClose}>
      <input
        placeholder="Name (e.g., Discord Updates)"
        value={name}
        onChange={e => setName(e.target.value)}
      />

      <select value={platform} onChange={e => setPlatform(e.target.value)}>
        <option value="discord">Discord</option>
        <option value="slack">Slack</option>
        <option value="teams">Microsoft Teams</option>
        <option value="generic">Generic (JSON)</option>
      </select>

      <input
        placeholder="Webhook URL"
        value={url}
        onChange={e => setUrl(e.target.value)}
      />

      <button onClick={handleSubmit}>Add Webhook</button>
    </Modal>
  );
};
```

---

## Security Considerations

1. **URL Validation** - Only allow HTTPS URLs (except localhost for testing)
2. **Rate Limiting** - Limit webhook calls per wave to prevent abuse
3. **Secret Validation** - For generic webhooks, optionally sign payloads with HMAC
4. **Permission Check** - Only wave creators/admins can manage webhooks
5. **No Sensitive Data** - Never send encrypted content or auth tokens
6. **Timeout** - 10 second timeout on webhook calls
7. **Retry Logic** - Optional: retry failed webhooks with exponential backoff

---

## Configuration

Add to `.env`:

```bash
# Outgoing Webhooks
WEBHOOKS_ENABLED=true
WEBHOOK_TIMEOUT_MS=10000
WEBHOOK_MAX_PER_WAVE=5
```

---

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Create `wave_webhooks` table
- [ ] Add database methods (CRUD)
- [ ] Implement `triggerWaveWebhooks` function
- [ ] Add Discord payload builder

### Phase 2: API Endpoints
- [ ] GET /api/waves/:waveId/webhooks
- [ ] POST /api/waves/:waveId/webhooks
- [ ] PUT /api/webhooks/:webhookId
- [ ] DELETE /api/webhooks/:webhookId
- [ ] POST /api/webhooks/:webhookId/test

### Phase 3: UI
- [ ] Add Webhooks tab to Wave Settings modal
- [ ] Add Webhook modal
- [ ] Webhook list with enable/disable toggle
- [ ] Test webhook button
- [ ] Error display

### Phase 4: Additional Platforms
- [ ] Slack payload builder
- [ ] Microsoft Teams payload builder
- [ ] Generic webhook with HMAC signing

### Phase 5: Polish
- [ ] Retry logic for failed webhooks
- [ ] Webhook activity log
- [ ] Rate limiting per wave
- [ ] Admin dashboard for all webhooks

---

## Quick Start: Discord Webhook Setup

1. In Discord: Server Settings → Integrations → Webhooks → New Webhook
2. Copy the webhook URL
3. In Cortex: Open wave → Settings → Webhooks → Add Webhook
4. Paste URL, select "Discord", save
5. New messages in the wave will automatically appear in Discord

---

## Files to Create/Modify

**Server:**
- `server/schema.sql` - Add `wave_webhooks` table
- `server/database-sqlite.js` - Add webhook CRUD methods
- `server/server.js` - Add API endpoints and trigger logic

**Client:**
- `client/src/components/waves/WaveSettingsModal.jsx` - Add Webhooks tab
- `client/src/components/waves/WebhooksTab.jsx` - NEW
- `client/src/components/waves/AddWebhookModal.jsx` - NEW

---

## Estimated Timeline

| Phase | Duration |
|-------|----------|
| Phase 1: Core | 2-3 hours |
| Phase 2: API | 1-2 hours |
| Phase 3: UI | 2-3 hours |
| Phase 4: Platforms | 1-2 hours |
| Phase 5: Polish | 2-4 hours |

**Total: 8-14 hours**
