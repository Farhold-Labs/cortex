import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { API_URL } from '../config/constants.js';
import { storage, getTokenExpiry, getTokenIssuedAt } from '../utils/storage.js';
import { refreshAccessToken, hasRefreshToken, setSessionLostHandler } from '../utils/sessionRefresh.js';
import { unsubscribeFromPush } from '../utils/pwa.js';
import { AuthContext } from '../hooks/useAPI.js';
import { LoadingSpinner } from '../components/ui/SimpleComponents.jsx';

// How often to check expiry
const EXPIRY_CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds
// Dismiss snooze duration
const DISMISS_SNOOZE_MS = 2 * 60 * 1000; // 2 minutes
// Grace period after expiry before full logout
const GRACE_PERIOD_MS = 60 * 60 * 1000; // 1 hour
// Minimum time between auto-renewal attempts
const AUTO_RENEW_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Proportional warning window: 10% of session duration, capped 5min–24h
function getWarningMs(token) {
  const expiry = getTokenExpiry(token);
  const issued = getTokenIssuedAt(token);
  if (!expiry || !issued) return 5 * 60 * 1000;
  const duration = expiry - issued;
  return Math.max(5 * 60 * 1000, Math.min(24 * 60 * 60 * 1000, duration * 0.10));
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(storage.getUser());
  const [token, setToken] = useState(storage.getToken());
  const [loading, setLoading] = useState(true);
  // Temporary password storage for E2EE unlock (cleared after use)
  const pendingPasswordRef = useRef(null);
  // Track session-only logins through MFA flow
  const pendingSessionOnlyRef = useRef(false);

  // Session expiry monitoring (v2.29.0)
  const [sessionExpiring, setSessionExpiring] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [isAutoRenewing, setIsAutoRenewing] = useState(false);
  const isAutoRenewingRef = useRef(false); // Synchronous guard — state is async and can't prevent concurrent calls
  const tokenJustRenewedRef = useRef(false); // Skip /auth/me re-check after renewal (user data already fresh)
  // What the UI calls "session expires" must be the session's end, not the
  // access token's — the latter is an hour away at all times once rotation is on.
  const sessionEndOf = (tok) => storage.getSessionExpiresAt() ?? getTokenExpiry(tok);
  const [sessionExpiresAt, setSessionExpiresAt] = useState(() => sessionEndOf(storage.getToken()));
  const dismissedUntilRef = useRef(0);
  const lastAutoRenewalRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    let timeoutId = setTimeout(() => controller.abort(), 10000);

    // Check for browser session timeout (24 hours for non-PWA browser tabs)
    if (token && storage.isSessionExpired()) {
      clearTimeout(timeoutId);
      console.log('⏰ Browser session expired. Logging out...');
      storage.removeToken(); storage.removeUser(); storage.removeSessionStart(); storage.removeRefreshToken(); storage.removeSessionExpiresAt();
      setToken(null); setUser(null);
      setLoading(false);
      return () => controller.abort();
    }

    // Skip /auth/me after silent renewal — user data was already refreshed from the renewal response.
    // Avoids a redundant context update that would cause all fetchAPI consumers to re-fetch.
    if (tokenJustRenewedRef.current) {
      tokenJustRenewedRef.current = false;
      clearTimeout(timeoutId);
      setLoading(false);
      return () => controller.abort();
    }

    if (token) {
      // Start-up identity check. This is THE path that decides whether someone
      // returning after a long gap is greeted by their waves or by a login form,
      // so an expired access token must be rotated here rather than treated as
      // the end of the session. It deliberately does not use fetchAPI: this runs
      // before the provider exists, so the retry is written out by hand.
      const checkMe = async (bearer) => fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${bearer}` },
        signal: controller.signal,
      });

      (async () => {
        let res = await checkMe(token);
        if (res.status === 401 && hasRefreshToken()) {
          // The 10s budget was sized for one request; rotating needs two more.
          // Without extending it, a slow network aborts mid-recovery and the
          // user falls back to a cached session holding a dead token.
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => controller.abort(), 15000);
          const fresh = await refreshAccessToken();
          if (fresh) {
            setToken(fresh);
            res = await checkMe(fresh);
          }
        }
        return res;
      })()
        .then(res => {
          clearTimeout(timeoutId);
          if (res.ok) return res.json();
          // Still unauthorised after a rotation attempt: the session really is
          // over (revoked, reused, or idle window elapsed).
          if (res.status === 401) {
            storage.removeToken(); storage.removeUser(); storage.removeSessionStart(); storage.removeRefreshToken(); storage.removeSessionExpiresAt();
            setToken(null); setUser(null);
          }
          // For other errors (network, 500, etc.), keep existing user data from localStorage
          return Promise.reject(new Error(`Auth check failed: ${res.status}`));
        })
        .then(userData => {
          setUser(userData);
          storage.setUser(userData); // Save to localStorage
        })
        .catch(err => {
          if (err.name === 'AbortError') {
            // Fetch timed out — keep cached session so user isn't logged out on slow/stale network
            console.warn('Auth check timed out, keeping cached session');
          } else {
            // Network errors - don't clear session, user may still have valid token
            console.warn('Auth check failed, keeping cached session:', err.message);
          }
        })
        .finally(() => setLoading(false));
    } else {
      clearTimeout(timeoutId);
      // No token — clear any stale user data left over from a session-only login
      // (token was in sessionStorage and cleared when the browser closed, but
      // the user object remained in localStorage)
      if (storage.getUser()) {
        storage.removeUser();
        storage.removeSessionStart();
        setUser(null);
      }
      setLoading(false);
    }

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [token]);

  // Silently renew session — no password required, active users only (v2.46.0)
  // Must be declared before the expiry useEffect that references it.
  const autoRenewSession = useCallback(async () => {
    if (isAutoRenewingRef.current) return; // Synchronous check — prevents concurrent calls
    if (Date.now() - lastAutoRenewalRef.current < AUTO_RENEW_COOLDOWN_MS) return;
    isAutoRenewingRef.current = true;
    setIsAutoRenewing(true);
    try {
      const res = await fetch(`${API_URL}/auth/renew`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const sessionOnly = storage.isSessionOnly();
      storage.setToken(data.token, sessionOnly);
      storage.setUser(data.user);
      storage.setSessionStart(sessionOnly ? 'session' : storage.getSessionDuration());
      setSessionExpiresAt(sessionEndOf(data.token));
      setSessionExpiring(false);
      tokenJustRenewedRef.current = true; // suppress /auth/me re-check on token change
      setToken(data.token);
      setUser(data.user);
      lastAutoRenewalRef.current = Date.now();
    } catch {
      // Silent failure — warning modal will surface on next check cycle
    } finally {
      isAutoRenewingRef.current = false;
      setIsAutoRenewing(false);
    }
  }, [token]);

  // When rotation fails terminally (reuse detected, revoked, idle window over)
  // there is nothing to recover — clear local state and show the login screen.
  useEffect(() => {
    setSessionLostHandler((code) => {
      console.warn(`🔒 Session ended (${code}) — signing out.`);
      pendingPasswordRef.current = null;
      storage.removeToken(); storage.removeUser(); storage.removeSessionStart();
      storage.removeRefreshToken(); storage.removeSessionExpiresAt();
      setSessionExpired(false); setSessionExpiring(false); setSessionExpiresAt(null);
      setToken(null); setUser(null);
    });
    return () => setSessionLostHandler(null);
  }, []);

  // Adopt tokens rotated by other parts of the app (useAPI retries, the
  // background timer) so React state does not keep serving a stale one.
  useEffect(() => {
    const onRefreshed = (e) => {
      if (e.detail?.token) setToken(e.detail.token);
      if (e.detail?.user) setUser(e.detail.user);
      setSessionExpiresAt(sessionEndOf(e.detail?.token));
    };
    window.addEventListener('cortex:token-refreshed', onRefreshed);
    return () => window.removeEventListener('cortex:token-refreshed', onRefreshed);
  }, []);

  // Session expiry monitoring timer (v2.29.0)
  useEffect(() => {
    if (!token) return;

    const checkExpiry = () => {
      const expiry = getTokenExpiry(token);
      if (expiry) {
        setSessionExpiresAt(expiry);
        const remaining = expiry - Date.now();

        // With a refresh token the access token expiring is a non-event: rotate
        // and carry on. None of the warning/grace/logout machinery below applies
        // — that existed only because the access token *was* the session, so its
        // expiry meant the user really was being thrown out. Start early enough
        // that a brief outage has room to retry before anything is user-visible.
        if (hasRefreshToken()) {
          setSessionExpiring(false);
          setSessionExpired(false);
          const rotateAhead = Math.min(5 * 60 * 1000, Math.max(30 * 1000, (expiry - (getTokenIssuedAt(token) || 0)) * 0.15));
          if (remaining <= rotateAhead) refreshAccessToken();
          return;
        }

        if (remaining <= 0) {
          const expiredAgo = -remaining;
          const issued = getTokenIssuedAt(token);
          const originalDurationMs = issued ? (expiry - issued) : GRACE_PERIOD_MS;
          const graceMs = Math.min(GRACE_PERIOD_MS, originalDurationMs);
          if (expiredAgo < graceMs) {
            // Within grace period — show re-auth overlay instead of logging out
            console.log('⏰ Session expired, grace period active.');
            setSessionExpired(true);
            setSessionExpiring(false);
          } else {
            // Grace period over — full logout
            console.log('⏰ Session expired and grace period elapsed. Logging out...');
            pendingPasswordRef.current = null;
            storage.removeToken(); storage.removeUser(); storage.removeSessionStart(); storage.removeRefreshToken(); storage.removeSessionExpiresAt();
            setSessionExpired(false);
            setSessionExpiring(false);
            setSessionExpiresAt(null);
            setToken(null); setUser(null);
          }
          return;
        }

        const warningMs = getWarningMs(token);
        if (remaining <= warningMs) {
          // Silently renew if user is active — no modal interruption during attempt
          if (document.visibilityState === 'visible') {
            autoRenewSession();
          }
          // Show warning modal only when not actively renewing
          if (!isAutoRenewingRef.current && Date.now() > dismissedUntilRef.current) {
            setSessionExpiring(true);
          }
        } else {
          setSessionExpiring(false);
        }
      }
    };

    // Check immediately
    checkExpiry();

    // Periodic check
    const interval = setInterval(checkExpiry, EXPIRY_CHECK_INTERVAL_MS);

    // Also check on visibility change / focus (device waking from sleep)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkExpiry();
    };
    const handleFocus = () => checkExpiry();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [token, autoRenewSession]);

  // Get pending password for E2EE unlock (one-time read, clears after access)
  // Every handler below is wrapped so its identity survives a re-render. They
  // are values on the auth context, and a context value that changes identity
  // re-renders every consumer in the app — and anything that lands in an effect
  // dependency array re-fires that effect. See the logout note further down for
  // the concrete cascade this caused.
  const getPendingPassword = useCallback(() => {
    const pwd = pendingPasswordRef.current;
    return pwd;
  }, []);

  // Clear pending password after E2EE has used it
  const clearPendingPassword = useCallback(() => {
    pendingPasswordRef.current = null;
  }, []);

  const login = useCallback(async (handle, password, sessionDuration = '7d') => {
    const sessionOnly = sessionDuration === 'session';
    const serverDuration = sessionOnly ? '24h' : sessionDuration;
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // supportsRefresh tells the server this client can rotate tokens, so it
      // is safe to hand out a short-lived access token. Without it the server
      // keeps issuing the old long-lived JWT for clients running stale bundles.
      body: JSON.stringify({ handle, password, sessionDuration: serverDuration, supportsRefresh: true, sessionOnly }),
    });
    const data = await res.json();
    if (!res.ok) {
      // Propagate moderation error details (v2.37.0)
      if (data.code === 'ACCOUNT_DISABLED' || data.code === 'ACCOUNT_BANNED') {
        const err = new Error(data.error || 'Account moderated');
        err.code = data.code;
        err.reason = data.reason;
        err.moderatedAt = data.moderatedAt;
        err.canAppeal = data.canAppeal;
        throw err;
      }
      throw new Error(data.error || 'Login failed');
    }
    // Check if MFA is required
    if (data.mfaRequired) {
      // Store password and session preference for later E2EE unlock after MFA
      pendingPasswordRef.current = password;
      pendingSessionOnlyRef.current = sessionOnly;
      return { mfaRequired: true, mfaChallenge: data.mfaChallenge, mfaMethods: data.mfaMethods };
    }
    // Store password for E2EE unlock
    pendingPasswordRef.current = password;
    storage.setToken(data.token, sessionOnly); storage.setUser(data.user);
    if (data.refreshToken) storage.setRefreshToken(data.refreshToken, sessionOnly);
    if (data.sessionExpiresAt) storage.setSessionExpiresAt(data.sessionExpiresAt, sessionOnly);
    storage.setSessionStart(sessionDuration); // Start browser session timer with user's selected duration
    setSessionExpiresAt(sessionEndOf(data.token));
    setSessionExpiring(false);
    dismissedUntilRef.current = 0;
    setToken(data.token); setUser(data.user);
    return { success: true };
  }, []);

  const completeMfaLogin = useCallback(async (challengeId, method, code) => {
    const res = await fetch(`${API_URL}/auth/mfa/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, method, code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'MFA verification failed');
    const sessionOnly = pendingSessionOnlyRef.current;
    pendingSessionOnlyRef.current = false;
    const duration = sessionOnly ? 'session' : (storage.getSessionDuration() || '7d');
    storage.setToken(data.token, sessionOnly); storage.setUser(data.user);
    storage.setSessionStart(duration); // Start browser session timer
    setSessionExpiresAt(sessionEndOf(data.token));
    setSessionExpiring(false);
    dismissedUntilRef.current = 0;
    setToken(data.token); setUser(data.user);
    return { success: true };
  }, []);

  const register = useCallback(async (handle, email, password, displayName, sessionDuration = '7d', inviteToken = null) => {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, email, password, displayName, sessionDuration, inviteToken }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    // Store password for E2EE setup
    pendingPasswordRef.current = password;
    storage.setToken(data.token); storage.setUser(data.user);
    storage.setSessionStart(sessionDuration); // Start browser session timer with user's selected duration
    setSessionExpiresAt(sessionEndOf(data.token));
    setSessionExpiring(false);
    dismissedUntilRef.current = 0;
    setToken(data.token); setUser(data.user);
  }, []);

  // Read the token through a ref so logout's identity never changes. logout is a
  // dependency of fetchAPI (useAPI.js), which in turn is in the dependency array
  // of effects all over the app — as a plain function it took a new identity on
  // every render here, re-firing all of those effects and their fetches. Keying
  // it on `token` instead would reintroduce the same churn on every silent
  // session renewal, which is exactly what useAPI's own tokenRef guards against.
  const logoutTokenRef = useRef(token);
  useEffect(() => { logoutTokenRef.current = token; }, [token]);

  const logout = useCallback(async () => {
    const token = logoutTokenRef.current;
    // Clean up push subscription before revoking token
    if (token && storage.getPushEnabled()) {
      try {
        await unsubscribeFromPush(token);
        storage.setPushEnabled(false);
        console.log('[Logout] Push subscription cleaned up');
      } catch (err) {
        console.error('[Logout] Push cleanup error:', err);
      }
    }
    // Revoke session on server
    if (token) {
      try {
        await fetch(`${API_URL}/auth/logout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch (err) {
        console.error('Logout API error:', err);
      }
    }
    // Clear password and local storage
    pendingPasswordRef.current = null;
    storage.removeToken(); storage.removeUser(); storage.removeSessionStart(); storage.removeRefreshToken(); storage.removeSessionExpiresAt();
    setSessionExpiring(false);
    setSessionExpiresAt(null);
    setToken(null); setUser(null);
  }, []);

  // Merge against the previous state rather than the `user` closure, so this
  // doesn't need `user` in its dependency array (which would give it a new
  // identity on every profile change). The storage write rides along inside the
  // updater: it is idempotent, so a double invocation would be harmless.
  const updateUser = useCallback((updates) => {
    setUser((prev) => {
      const updatedUser = { ...prev, ...updates };
      storage.setUser(updatedUser);
      return updatedUser;
    });
  }, []);

  // Refresh session with password (v2.29.0)
  const refreshSession = useCallback(async (password, sessionDuration) => {
    const sessionOnly = storage.isSessionOnly();
    const duration = sessionOnly ? '24h' : (sessionDuration || storage.getSessionDuration() || '7d');
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ password, sessionDuration: duration }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Session refresh failed');

    // Update token and user state
    storage.setToken(data.token, sessionOnly); storage.setUser(data.user);
    storage.setSessionStart(sessionOnly ? 'session' : (data.sessionDuration || duration));
    setSessionExpiresAt(sessionEndOf(data.token));
    setSessionExpiring(false);
    dismissedUntilRef.current = 0;
    setToken(data.token); setUser(data.user);
    return data;
  }, [token]);

  // Re-authenticate after session expiry — uses grace-period endpoint (v2.45.3)
  const reauth = useCallback(async (password, sessionDuration) => {
    const sessionOnly = storage.isSessionOnly();
    const duration = sessionOnly ? '24h' : (sessionDuration || storage.getSessionDuration() || '7d');
    const res = await fetch(`${API_URL}/auth/reauth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ password, sessionDuration: duration }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.code === 'GRACE_EXPIRED') {
        // Grace window closed — hard logout
        pendingPasswordRef.current = null;
        storage.removeToken(); storage.removeUser(); storage.removeSessionStart(); storage.removeRefreshToken(); storage.removeSessionExpiresAt();
        setSessionExpired(false);
        setSessionExpiresAt(null);
        setToken(null); setUser(null);
        throw new Error('Session expired. Please log in again.');
      }
      throw new Error(data.error || 'Re-authentication failed');
    }
    storage.setToken(data.token, sessionOnly); storage.setUser(data.user);
    storage.setSessionStart(sessionOnly ? 'session' : (data.sessionDuration || duration));
    setSessionExpiresAt(sessionEndOf(data.token));
    setSessionExpired(false);
    setSessionExpiring(false);
    dismissedUntilRef.current = 0;
    setToken(data.token); setUser(data.user);
    return data;
  }, [token]);

  // Dismiss session warning temporarily (v2.29.0)
  const dismissSessionWarning = useCallback(() => {
    dismissedUntilRef.current = Date.now() + DISMISS_SNOOZE_MS;
    setSessionExpiring(false);
  }, []);

  // Handle TOKEN_EXPIRED from useAPI — enter grace-period re-auth instead of immediate logout (v2.45.3)
  const triggerSessionExpiry = useCallback(() => {
    console.log('⏰ Token expired (server rejected). Entering grace-period re-auth...');
    setSessionExpired(true);
    setSessionExpiring(false);
  }, []);

  // An inline object literal here would be a new value on every render, which
  // re-renders every consumer no matter how stable the handlers are. With the
  // handlers memoised this changes only when auth state genuinely changes.
  const contextValue = useMemo(() => ({
    user, token, login, completeMfaLogin, register, logout, updateUser,
    getPendingPassword, clearPendingPassword,
    sessionExpiring, sessionExpired, isAutoRenewing,
    sessionExpiresAt, refreshSession, reauth, dismissSessionWarning, triggerSessionExpiry
  }), [
    user, token, login, completeMfaLogin, register, logout, updateUser,
    getPendingPassword, clearPendingPassword,
    sessionExpiring, sessionExpired, isAutoRenewing,
    sessionExpiresAt, refreshSession, reauth, dismissSessionWarning, triggerSessionExpiry
  ]);

  // Note: this early return sits *after* every hook above, which is required —
  // hooks must not be skipped on the loading render.
  if (loading) return <LoadingSpinner />;

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthProvider;
