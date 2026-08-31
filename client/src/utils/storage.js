// ============ STORAGE UTILITIES ============

// Check if running as installed PWA (standalone mode)
export const isPWA = () => {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true || // iOS Safari
         document.referrer.includes('android-app://'); // Android TWA
};

// Decode JWT expiry timestamp (ms) from token payload without signature verification
export function getTokenExpiry(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // base64url → base64 → decode
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(payload));
    return decoded.exp ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Decode JWT issued-at timestamp (ms) from token payload without signature verification
export function getTokenIssuedAt(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(payload));
    return decoded.iat ? decoded.iat * 1000 : null;
  } catch {
    return null;
  }
}

export const storage = {
  getToken: () => sessionStorage.getItem('farhold_token') || localStorage.getItem('farhold_token'),
  setToken: (token, sessionOnly = false) => {
    if (sessionOnly) {
      sessionStorage.setItem('farhold_token', token);
      localStorage.removeItem('farhold_token');
    } else {
      localStorage.setItem('farhold_token', token);
      sessionStorage.removeItem('farhold_token');
    }
  },
  removeToken: () => {
    localStorage.removeItem('farhold_token');
    sessionStorage.removeItem('farhold_token');
  },
  isSessionOnly: () => !!sessionStorage.getItem('farhold_token') && !localStorage.getItem('farhold_token'),

  // ===== Refresh token + session expiry (v2.75.0) =====
  // The access token is now short-lived; the refresh token is what keeps you
  // signed in for months. It lives beside the access token and follows the same
  // session-only rule — a session-only login never receives one at all.
  getRefreshToken: () => sessionStorage.getItem('farhold_refresh') || localStorage.getItem('farhold_refresh'),
  setRefreshToken: (t, sessionOnly = false) => {
    if (!t) return;
    if (sessionOnly) {
      sessionStorage.setItem('farhold_refresh', t);
      localStorage.removeItem('farhold_refresh');
    } else {
      localStorage.setItem('farhold_refresh', t);
      sessionStorage.removeItem('farhold_refresh');
    }
  },
  removeRefreshToken: () => {
    localStorage.removeItem('farhold_refresh');
    sessionStorage.removeItem('farhold_refresh');
  },
  // When the *session* ends, as opposed to when the access token expires. E2EE
  // "until my session expires" follows this, not the hourly access token.
  getSessionExpiresAt: () => {
    const v = localStorage.getItem('farhold_session_expires') || sessionStorage.getItem('farhold_session_expires');
    const n = v ? Date.parse(v) : NaN;
    return Number.isFinite(n) ? n : null;
  },
  setSessionExpiresAt: (iso, sessionOnly = false) => {
    if (!iso) return;
    if (sessionOnly) sessionStorage.setItem('farhold_session_expires', iso);
    else localStorage.setItem('farhold_session_expires', iso);
  },
  removeSessionExpiresAt: () => {
    localStorage.removeItem('farhold_session_expires');
    sessionStorage.removeItem('farhold_session_expires');
  },
  getUser: () => { try { return JSON.parse(localStorage.getItem('farhold_user')); } catch { return null; } },
  setUser: (user) => {
    localStorage.setItem('farhold_user', JSON.stringify(user));
    // Also store theme separately for fast access on page load
    if (user?.preferences?.theme) {
      localStorage.setItem('farhold_theme', user.preferences.theme);
    }
  },
  removeUser: () => { localStorage.removeItem('farhold_user'); localStorage.removeItem('farhold_theme'); },
  getPushEnabled: () => localStorage.getItem('farhold_push_enabled') === 'true', // Default false (opt-in)
  setPushEnabled: (enabled) => localStorage.setItem('farhold_push_enabled', enabled ? 'true' : 'false'),
  getTheme: () => localStorage.getItem('farhold_theme'),
  setTheme: (theme) => localStorage.setItem('farhold_theme', theme),
  // Session start time tracking for browser session timeout
  getSessionStart: () => {
    const start = localStorage.getItem('farhold_session_start');
    return start ? parseInt(start, 10) : null;
  },
  setSessionStart: (duration = '7d') => {
    localStorage.setItem('farhold_session_start', Date.now().toString());
    // Don't persist 'session' as a preference — it's a device-specific choice
    if (duration !== 'session') {
      localStorage.setItem('farhold_session_duration', duration);
    }
  },
  removeSessionStart: () => {
    localStorage.removeItem('farhold_session_start');
    // Intentionally keep 'farhold_session_duration' — it doubles as a preference
    // so the login form can pre-fill the user's last-used duration next time.
  },
  getSessionDuration: () => localStorage.getItem('farhold_session_duration') || '7d',
  // Server URL override (v2.30.0)
  getServerUrl: () => localStorage.getItem('farhold_server_url'),
  setServerUrl: (url) => localStorage.setItem('farhold_server_url', url),
  removeServerUrl: () => localStorage.removeItem('farhold_server_url'),
  // Check if the SESSION has expired (v2.29.0; corrected v2.75.0).
  //
  // This used to read the access token's exp as "source of truth", which was
  // right while the JWT *was* the session. With rotation the access token
  // expires roughly hourly by design, so that reading logs the user out every
  // hour — and worse, it runs before the start-up refresh, destroying the
  // refresh token that would have recovered the session.
  isSessionExpired: () => {
    if (storage.getRefreshToken()) {
      const sessionEnd = storage.getSessionExpiresAt();
      // No recorded end (older login, or the server did not send one): the
      // refresh token itself is the authority, so let the server decide.
      return sessionEnd ? Date.now() > sessionEnd : false;
    }

    const token = storage.getToken();
    const expiry = getTokenExpiry(token);
    if (expiry) return Date.now() > expiry;

    // Fallback: client-side duration tracking for legacy tokens without exp
    const sessionStart = storage.getSessionStart();
    if (!sessionStart) return false;

    const duration = storage.getSessionDuration();
    const durationMs = duration === '7d' ? 7 * 24 * 60 * 60 * 1000 :
                       duration === '30d' ? 30 * 24 * 60 * 60 * 1000 :
                       24 * 60 * 60 * 1000;

    const elapsed = Date.now() - sessionStart;
    return elapsed > durationMs;
  },
};
