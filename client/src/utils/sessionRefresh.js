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

import { storage } from './storage.js';
import { API_URL } from '../config/constants.js';

let inFlight = null;
let onSessionLost = null;

// Called when the session is definitively over (revoked, expired, or the
// refresh token is gone) so the app can drop to the login screen.
export function setSessionLostHandler(fn) {
  onSessionLost = fn;
}

export function hasRefreshToken() {
  return !!storage.getRefreshToken();
}

// Returns a fresh access token, or null when the session cannot be recovered.
// Concurrent callers share one network round-trip.
export function refreshAccessToken() {
  if (inFlight) return inFlight;

  const refreshToken = storage.getRefreshToken();
  if (!refreshToken) return Promise.resolve(null);

  const sessionOnly = storage.isSessionOnly();

  inFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/token/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
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

      // Let the rest of the app pick up the new token without prop-drilling.
      window.dispatchEvent(new CustomEvent('cortex:token-refreshed', {
        detail: { token: data.token, user: data.user || null, sessionExpiresAt: data.sessionExpiresAt || null },
      }));

      return data.token;
    } catch {
      // Network error — same reasoning as 5xx above: not terminal.
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
