// Access-token refresh, shared by every caller (v2.75.0).
//
// The access token now lasts about an hour while the session lasts months, so
// refreshing is routine rather than exceptional. Two things make that safe:
//
//  1. SINGLE FLIGHT. A page can easily fire a dozen requests at once; if the
//     token has just expired they all 401 together. Each one must NOT start its
//     own rotation — the first would succeed and invalidate the token the others
//     are still holding, and the server would read those as replays and revoke
//     the whole family. That would turn an ordinary expiry into a forced logout.
//     So exactly one rotation runs and everyone awaits the same promise.
//
//  2. IMMEDIATE PERSISTENCE. The rotated refresh token is written to storage
//     before the promise resolves, so a reload mid-flight cannot lose it.
//
//  3. ONE AT A TIME ACROSS TABS (v2.146.1). Tabs share the stored token but not
//     the in-flight promise, so a browser lock queues their swaps; a tab that
//     waited picks up the token the other tab stored instead of swapping again.
//
//  4. A RECEIPT (v2.146.1). The server retires the old refresh token only once
//     this client shows it has the new one. It sends the receipt right after
//     storing it, by using the new access token. If the answer never arrives
//     the old token still works, and presenting it again gets the same new one.

import { storage } from './storage.js';
import { API_URL } from '../config/constants.js';

let inFlight = null;
let onSessionLost = null;

// Long enough for a slow phone on bad signal, short enough that a dead
// connection does not look like a hung app.
const REFRESH_TIMEOUT_MS = 12000;

// Called when the session is definitively over (revoked, expired, or the
// refresh token is gone) so the app can drop to the login screen.
export function setSessionLostHandler(fn) {
  onSessionLost = fn;
}

export function hasRefreshToken() {
  return !!storage.getRefreshToken();
}

// Run fn holding a lock shared by every tab of this origin, where the browser
// has one (an older WebView may not).
function withRefreshLock(fn) {
  try {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return navigator.locks.request('cortex-token-refresh', fn);
    }
  } catch { /* fall through */ }
  return fn();
}

function confirmSwap(accessToken) {
  fetch(`${API_URL}/auth/token/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
  }).catch(() => { /* the next request with this token confirms it anyway */ });
}

// Returns a fresh access token, or null when the session cannot be recovered.
// Concurrent callers share one network round-trip.
export function refreshAccessToken() {
  if (inFlight) return inFlight;

  const known = storage.getRefreshToken();
  if (!known) return Promise.resolve(null);

  inFlight = withRefreshLock(async () => {
    // Another tab may have swapped while this one waited for the lock.
    const refreshToken = storage.getRefreshToken();
    if (!refreshToken) return null;
    if (refreshToken !== known && storage.getToken()) {
      const token = storage.getToken();
      window.dispatchEvent(new CustomEvent('cortex:token-refreshed', {
        detail: { token, user: null, sessionExpiresAt: storage.getSessionExpiresAt() || null },
      }));
      return token;
    }
    const sessionOnly = storage.isSessionOnly();
    try {
      const res = await fetch(`${API_URL}/auth/token/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        // MUST have a deadline. Start-up awaits this call before it will render
        // anything, so a request that never settles leaves the app on its
        // loading screen forever — and relaunching just repeats it, which is
        // why force-closing did not help. A stalled connection (patchy mobile
        // data, captive portal) produces exactly that: `fetch` on its own has
        // no timeout at all and will wait indefinitely.
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });

      if (!res.ok) {
        let code = null;
        try { code = (await res.json())?.code; } catch { /* body may be empty */ }

        // A 5xx or a dropped connection is not proof the session is gone — keep
        // the refresh token and let the next attempt try again. Only an explicit
        // rejection ends the session.
        const terminal = res.status === 401 || res.status === 403;
        if (terminal) {
          storage.removeRefreshToken();
          storage.removeSessionExpiresAt();
          onSessionLost?.(code || 'REFRESH_INVALID');
        }
        return null;
      }

      const data = await res.json();
      if (!data?.token) return null;

      // Persist before resolving: a reload between here and the caller's
      // continuation must not lose the rotated token, or the next start-up
      // would present the spent one and trip reuse detection.
      storage.setToken(data.token, sessionOnly);
      if (data.refreshToken) storage.setRefreshToken(data.refreshToken, sessionOnly);
      if (data.sessionExpiresAt) storage.setSessionExpiresAt(data.sessionExpiresAt, sessionOnly);
      if (data.user) storage.setUser(data.user);

      // Stored: now tell the server, so it can retire the old token.
      confirmSwap(data.token);

      // Let the rest of the app pick up the new token without prop-drilling.
      window.dispatchEvent(new CustomEvent('cortex:token-refreshed', {
        detail: { token: data.token, user: data.user || null, sessionExpiresAt: data.sessionExpiresAt || null },
      }));

      return data.token;
    } catch {
      // Network error or timeout — same reasoning as the 5xx case above. NOT
      // terminal: the refresh token is kept and the next attempt tries again.
      // Treating a flaky connection as an ended session would sign people out
      // for being on a train.
      return null;
    }
  }).finally(() => {
    inFlight = null;
  });

  return inFlight;
}
