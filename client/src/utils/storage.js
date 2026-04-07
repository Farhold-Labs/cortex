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
  getToken: () => localStorage.getItem('farhold_token'),
  setToken: (token) => localStorage.setItem('farhold_token', token),
  removeToken: () => localStorage.removeItem('farhold_token'),
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
  setSessionStart: (duration = '24h') => {
    localStorage.setItem('farhold_session_start', Date.now().toString());
    localStorage.setItem('farhold_session_duration', duration);
  },
  removeSessionStart: () => {
    localStorage.removeItem('farhold_session_start');
    // Intentionally keep 'farhold_session_duration' — it doubles as a preference
    // so the login form can pre-fill the user's last-used duration next time.
  },
  getSessionDuration: () => localStorage.getItem('farhold_session_duration') || '24h',
  // Server URL override (v2.30.0)
  getServerUrl: () => localStorage.getItem('farhold_server_url'),
  setServerUrl: (url) => localStorage.setItem('farhold_server_url', url),
  removeServerUrl: () => localStorage.removeItem('farhold_server_url'),
  // Check if browser session has expired — uses JWT exp claim as source of truth (v2.29.0)
  isSessionExpired: () => {
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
