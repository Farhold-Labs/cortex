import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_URL } from '../config/constants.js';
import { storage, getTokenExpiry, getTokenIssuedAt } from '../utils/storage.js';
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

  // Session expiry monitoring (v2.29.0)
  const [sessionExpiring, setSessionExpiring] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [isAutoRenewing, setIsAutoRenewing] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState(() => getTokenExpiry(storage.getToken()));
  const dismissedUntilRef = useRef(0);
  const lastAutoRenewalRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    // Check for browser session timeout (24 hours for non-PWA browser tabs)
    if (token && storage.isSessionExpired()) {
      clearTimeout(timeoutId);
      console.log('⏰ Browser session expired. Logging out...');
      storage.removeToken(); storage.removeUser(); storage.removeSessionStart();
      setToken(null); setUser(null);
      setLoading(false);
      return () => controller.abort();
    }

    if (token) {
      fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      })
        .then(res => {
          clearTimeout(timeoutId);
          if (res.ok) return res.json();
          // Clear session on 401 (invalid/expired token/session)
          if (res.status === 401) {
            storage.removeToken(); storage.removeUser(); storage.removeSessionStart();
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
    if (isAutoRenewing) return;
    if (Date.now() - lastAutoRenewalRef.current < AUTO_RENEW_COOLDOWN_MS) return;
    setIsAutoRenewing(true);
    try {
      const res = await fetch(`${API_URL}/auth/renew`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      storage.setToken(data.token);
      storage.setUser(data.user);
      storage.setSessionStart(storage.getSessionDuration());
      setSessionExpiresAt(getTokenExpiry(data.token));
      setSessionExpiring(false);
      setToken(data.token);
      setUser(data.user);
      lastAutoRenewalRef.current = Date.now();
    } catch {
      // Silent failure — warning modal will surface on next check cycle
    } finally {
      setIsAutoRenewing(false);
    }
  }, [token, isAutoRenewing]);

  // Session expiry monitoring timer (v2.29.0)
  useEffect(() => {
    if (!token) return;

    const checkExpiry = () => {
      const expiry = getTokenExpiry(token);
      if (expiry) {
        setSessionExpiresAt(expiry);
        const remaining = expiry - Date.now();

        if (remaining <= 0) {
          const expiredAgo = -remaining;
          if (expiredAgo < GRACE_PERIOD_MS) {
            // Within grace period — show re-auth overlay instead of logging out
            console.log('⏰ Session expired, grace period active.');
            setSessionExpired(true);
            setSessionExpiring(false);
          } else {
            // Grace period over — full logout
            console.log('⏰ Session expired and grace period elapsed. Logging out...');
            pendingPasswordRef.current = null;
            storage.removeToken(); storage.removeUser(); storage.removeSessionStart();
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
          if (!isAutoRenewing && Date.now() > dismissedUntilRef.current) {
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
  }, [token, autoRenewSession, isAutoRenewing]);

  // Get pending password for E2EE unlock (one-time read, clears after access)
  const getPendingPassword = () => {
    const pwd = pendingPasswordRef.current;
    return pwd;
  };

  // Clear pending password after E2EE has used it
  const clearPendingPassword = () => {
    pendingPasswordRef.current = null;
  };

  const login = async (handle, password, sessionDuration = '24h') => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, password, sessionDuration }),
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
      // Store password for later E2EE unlock after MFA
      pendingPasswordRef.current = password;
      return { mfaRequired: true, mfaChallenge: data.mfaChallenge, mfaMethods: data.mfaMethods };
    }
    // Store password for E2EE unlock
    pendingPasswordRef.current = password;
    storage.setToken(data.token); storage.setUser(data.user);
    storage.setSessionStart(sessionDuration); // Start browser session timer with user's selected duration
    setSessionExpiresAt(getTokenExpiry(data.token));
    setSessionExpiring(false);
    dismissedUntilRef.current = 0;
    setToken(data.token); setUser(data.user);
    return { success: true };
  };

  const completeMfaLogin = async (challengeId, method, code) => {
    const res = await fetch(`${API_URL}/auth/mfa/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, method, code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'MFA verification failed');
    // Note: MFA completion should use the duration from the original login attempt
    // For now, we'll use a safe default since the duration isn't passed through MFA flow
    const duration = storage.getSessionDuration() || '24h';
    storage.setToken(data.token); storage.setUser(data.user);
    storage.setSessionStart(duration); // Start browser session timer
    setSessionExpiresAt(getTokenExpiry(data.token));
    setSessionExpiring(false);
    dismissedUntilRef.current = 0;
    setToken(data.token); setUser(data.user);
    return { success: true };
  };

  const register = async (handle, email, password, displayName, sessionDuration = '24h') => {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, email, password, displayName, sessionDuration }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    // Store password for E2EE setup
    pendingPasswordRef.current = password;
    storage.setToken(data.token); storage.setUser(data.user);
    storage.setSessionStart(sessionDuration); // Start browser session timer with user's selected duration
    setSessionExpiresAt(getTokenExpiry(data.token));
    setSessionExpiring(false);
    dismissedUntilRef.current = 0;
    setToken(data.token); setUser(data.user);
  };

  const logout = async () => {
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
    storage.removeToken(); storage.removeUser(); storage.removeSessionStart();
    setSessionExpiring(false);
    setSessionExpiresAt(null);
    setToken(null); setUser(null);
  };

  const updateUser = (updates) => {
    const updatedUser = { ...user, ...updates };
    setUser(updatedUser);
    storage.setUser(updatedUser);
  };

  // Refresh session with password (v2.29.0)
  const refreshSession = useCallback(async (password, sessionDuration) => {
    const duration = sessionDuration || storage.getSessionDuration() || '24h';
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ password, sessionDuration: duration }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Session refresh failed');

    // Update token and user state
    storage.setToken(data.token); storage.setUser(data.user);
    storage.setSessionStart(data.sessionDuration || duration);
    setSessionExpiresAt(getTokenExpiry(data.token));
    setSessionExpiring(false);
    dismissedUntilRef.current = 0;
    setToken(data.token); setUser(data.user);
    return data;
  }, [token]);

  // Re-authenticate after session expiry — uses grace-period endpoint (v2.45.3)
  const reauth = useCallback(async (password, sessionDuration) => {
    const duration = sessionDuration || storage.getSessionDuration() || '24h';
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
        storage.removeToken(); storage.removeUser(); storage.removeSessionStart();
        setSessionExpired(false);
        setSessionExpiresAt(null);
        setToken(null); setUser(null);
        throw new Error('Session expired. Please log in again.');
      }
      throw new Error(data.error || 'Re-authentication failed');
    }
    storage.setToken(data.token); storage.setUser(data.user);
    storage.setSessionStart(data.sessionDuration || duration);
    setSessionExpiresAt(getTokenExpiry(data.token));
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

  if (loading) return <LoadingSpinner />;

  return (
    <AuthContext.Provider value={{
      user, token, login, completeMfaLogin, register, logout, updateUser,
      getPendingPassword, clearPendingPassword,
      sessionExpiring, sessionExpired, isAutoRenewing,
      sessionExpiresAt, refreshSession, reauth, dismissSessionWarning, triggerSessionExpiry
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthProvider;
