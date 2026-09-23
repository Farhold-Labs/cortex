import { storage } from './storage.js';

/**
 * Private attachments (v2.104.0, CORTEX-COMM-009).
 *
 * Files under /uploads used to be served to anyone who knew the path. A URL
 * copied out of a private wave — or guessed — was a working link forever. The
 * server now gates any file it knows belongs to a wave, and needs two things
 * from the client to do it:
 *
 *   1. a short-lived cookie saying WHO is asking, because an <img> tag cannot
 *      carry an Authorization header;
 *   2. for encrypted waves, a note saying WHICH wave a file belongs to. The
 *      server cannot read those messages, so it cannot work this out itself.
 *
 * Both requests go to a RELATIVE path on purpose. Embedded attachments are
 * bare `/uploads/...` paths resolved against the page origin, so the cookie
 * has to be set on the page origin too — which is also the one configuration
 * a same-site cookie survives in (production serves app and API together; the
 * Vite dev server proxies /api and /uploads to :3001).
 */

// Refresh well before the server's 15-minute expiry: a cookie that lapses
// between render and image load looks exactly like a broken image.
const REFRESH_MS = 11 * 60 * 1000;

let refreshTimer = null;
let inFlight = null;
let lastMinted = 0;

async function mint() {
  const token = storage.getToken();
  if (!token) return false;
  try {
    const res = await fetch('/api/attachments/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'same-origin',
    });
    if (!res.ok) return false;
    lastMinted = Date.now();
    return true;
  } catch {
    // Offline. The cached shell still renders; images come back with the
    // network, and the visibility handler re-mints then.
    return false;
  }
}

/** Mint now if we have no fresh cookie, collapsing concurrent callers. */
export async function ensureAttachmentSession(force = false) {
  if (!force && lastMinted && Date.now() - lastMinted < REFRESH_MS) return true;
  if (inFlight) return inFlight;
  inFlight = mint().finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * Keep a cookie alive for as long as the session lasts. Also re-mints when a
 * backgrounded tab comes forward, because a sleeping laptop blows straight
 * through any timer.
 */
export function startAttachmentSession() {
  stopAttachmentSession();
  ensureAttachmentSession(true);
  refreshTimer = setInterval(() => ensureAttachmentSession(true), REFRESH_MS);
  document.addEventListener('visibilitychange', onVisible);
}

export function stopAttachmentSession() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  document.removeEventListener('visibilitychange', onVisible);
  lastMinted = 0;
}

function onVisible() {
  if (document.visibilityState === 'visible') ensureAttachmentSession();
}

const UPLOAD_PATH = /\/uploads\/[A-Za-z0-9._\-/]+/g;
const registered = new Set();

/**
 * Tell the server which wave a file belongs to, for content it cannot read.
 *
 * Called with the PLAINTEXT of a ping we just sent, so it also covers the
 * encrypted case. Only the uploader is allowed to file an attachment, so a
 * failure here is ordinary — someone else's file quoted into a message is not
 * ours to restrict — and never worth interrupting the send for.
 */
export async function registerAttachments(content, waveId) {
  if (!content || !waveId) return;
  const token = storage.getToken();
  if (!token) return;

  for (const match of String(content).match(UPLOAD_PATH) || []) {
    const key = `${waveId}:${match}`;
    if (registered.has(key)) continue;
    registered.add(key);
    try {
      await fetch('/api/attachments/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'same-origin',
        body: JSON.stringify({ path: match, waveId }),
      });
    } catch {
      registered.delete(key);
    }
  }
}

export default { ensureAttachmentSession, startAttachmentSession, stopAttachmentSession, registerAttachments };
