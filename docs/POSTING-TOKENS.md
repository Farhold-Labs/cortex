# Posting Tokens

Posting tokens let external scripts and services post messages to a Cortex wave without a user account or session. They are wave-specific, created by the wave creator, and require no authentication header — the token itself identifies both the caller and the target wave.

---

## Two ways to post programmatically

Cortex has two separate systems for programmatic posting. Choose the one that fits your use case:

| | Posting Tokens | Admin Bot API |
|---|---|---|
| **Created by** | Wave creator (in Wave Settings) | Server admin (in Admin Panel) |
| **Scope** | One wave per token | Any wave the bot is granted access to |
| **Auth method** | Token in the URL path | `Authorization: Bearer` header |
| **Wave ID needed** | No — encoded in the token | Yes — passed in the request body |
| **Use case** | Simple per-wave scripts, webhooks | Multi-wave bots, server integrations |

This document covers **Posting Tokens**. For the Admin Bot API see [API.md](API.md).

---

## Creating a posting token

1. Open the wave you want to post to.
2. Click the settings icon (⚙) to open Wave Settings.
3. Scroll to **Posting Tokens** — this section is only visible to the wave creator.
4. Note the **Wave ID** shown at the top of the section (you may need it to identify the wave in your script, but it is not required to post).
5. Click **+ Create posting token**, enter a descriptive name (e.g. `Status Bot`, `CI Alerts`), and click **Create Token**.
6. **Copy the token immediately** — it is shown once and never stored in plaintext. If you lose it, revoke it and create a new one.

Each wave supports up to 10 active tokens.

---

## Posting a message

```
POST /api/post/:token
Content-Type: application/json
```

No `Authorization` header is required. The token in the URL path identifies the wave and authorises the request.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `content` | string | Yes | The message content. Plain text or limited HTML (see below). Max 10,000 characters. |

### Response

**201 Created**

```json
{
  "ping": {
    "id": "ping-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "waveId": "thread-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  }
}
```

**Error responses**

| Status | Meaning |
|---|---|
| 400 | Missing or empty `content` |
| 403 | Token is invalid or has been revoked |
| 404 | Wave no longer exists |
| 429 | Rate limit exceeded |

---

## Examples

### curl

```bash
curl -X POST https://cortex.farhold.com/api/post/YOUR_TOKEN \
  -H "Content-Type: application/json" \
  -d '{"content": "Deployment complete — v1.4.2 is live."}'
```

### Python

```python
import requests

TOKEN = "your_posting_token_here"
SERVER = "https://cortex.farhold.com"

def post_to_wave(message):
    resp = requests.post(
        f"{SERVER}/api/post/{TOKEN}",
        json={"content": message},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()

post_to_wave("Build passed. Deploying to production.")
```

### Node.js

```js
const TOKEN = 'your_posting_token_here';
const SERVER = 'https://cortex.farhold.com';

async function postToWave(message) {
  const res = await fetch(`${SERVER}/api/post/${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message }),
  });
  if (!res.ok) throw new Error(`Post failed: ${res.status}`);
  return res.json();
}

postToWave('Tests passed ✓');
```

### GitHub Actions

```yaml
- name: Notify Cortex
  run: |
    curl -s -X POST "${{ secrets.CORTEX_SERVER }}/api/post/${{ secrets.CORTEX_TOKEN }}" \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"${{ github.repository }} — build #${{ github.run_number }} passed.\"}"
```

Store the token as a repository secret (`CORTEX_TOKEN`). Never hardcode it in source files.

---

## Content formatting

Message content is sanitized on the server. Allowed HTML tags:

| Tag | Use |
|---|---|
| `<strong>` | Bold |
| `<em>` | Italic |
| `<code>` | Inline code |
| `<pre>` | Code block |
| `<a href="...">` | Link |
| `<br>` | Line break |
| `<p>` | Paragraph |
| `<img src="...">` | Image |

Everything else is stripped. No `<h1>`–`<h6>`, no `<ul>`/`<li>`, no `<b>` (use `<strong>`).

For bullet lists, use `•` with `<br>` line breaks:

```json
{
  "content": "Deployment summary:<br>• 3 services updated<br>• 0 errors<br>• Rollback window: 30 min"
}
```

---

## Rate limiting

Posting token requests share the bot rate limiter: **300 requests per minute**. Exceeding this returns `429 Too Many Requests`.

---

## Security

- **Treat the token like a password.** Anyone with the token can post to the wave.
- Store it in environment variables or a secrets manager, never in source code.
- Each token should have one purpose — use separate tokens for separate integrations so you can revoke one without affecting others.
- Revoke tokens that are no longer in use or may have been exposed. Open Wave Settings → Posting Tokens → **Revoke** next to the token.
- Tokens do not expire automatically; they remain valid until revoked.

---

## Revoking a token

1. Open Wave Settings → **Posting Tokens**.
2. Click **Revoke** next to the token you want to remove.
3. Confirm the prompt.

Any script using the revoked token will immediately start receiving `403 Invalid token`.
