import { useCallback, useContext, createContext, useMemo, useRef, useEffect } from 'react';
import { API_URL } from '../config/constants.js';
import { refreshAccessToken, hasRefreshToken } from '../utils/sessionRefresh.js';
import { getStepUpToken, requestStepUp } from '../utils/stepUp.js';
import { storage } from '../utils/storage.js';
import { useNetworkStatus } from './useNetworkStatus.js';

// Temporary: Import AuthContext (will remain in FarholdApp until Phase 5)
// For now, we'll re-export these to avoid circular imports
export const AuthContext = createContext();
export const useAuth = () => useContext(AuthContext);

// ============ API HOOK ============
// v2.10.0: Added low-bandwidth mode support
export function useAPI() {
  const { token, logout, triggerSessionExpiry } = useAuth();
  const { isSlowConnection } = useNetworkStatus();

  // Keep a ref to the latest token so fetchAPI doesn't need token in its dep array.
  // This prevents fetchAPI from being recreated on every silent renewal, which would
  // otherwise cause every component with fetchAPI in its useEffect deps to re-fetch.
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  // Memoized fetch function with bandwidth-aware mode
  const fetchAPI = useCallback(async (endpoint, options = {}) => {
    const requestToken = tokenRef.current; // capture at call time to detect rotation during flight
    const headers = { 'Content-Type': 'application/json' };
    if (requestToken) headers['Authorization'] = `Bearer ${requestToken}`;

    // Low-bandwidth mode (v2.10.0):
    // Auto-add minimal flag on slow connections unless skipMinimal is set
    // Note: Only apply to wave list and pings endpoints, NOT individual wave details
    // because WaveView needs pings to render content
    let finalEndpoint = endpoint;
    if (isSlowConnection && !options.skipMinimal) {
      // Check if endpoint supports minimal mode (waves endpoints)
      const supportsMinimal = endpoint.startsWith('/waves') && !endpoint.includes('minimal=');
      if (supportsMinimal) {
        const separator = endpoint.includes('?') ? '&' : '?';

        // Determine which minimal param to use based on endpoint
        if (endpoint.match(/^\/waves\/[^/]+\/pings/)) {
          // /waves/:id/pings uses fields=minimal
          finalEndpoint = `${endpoint}${separator}fields=minimal`;
        } else if (endpoint.match(/^\/waves(\?|$)/)) {
          // /waves (list) uses minimal=true
          finalEndpoint = `${endpoint}${separator}minimal=true`;
        }
        // Note: /waves/:id is NOT given minimal mode - WaveView needs pings

        if (finalEndpoint !== endpoint) {
          console.log(`[useAPI] Low-bandwidth mode: ${endpoint} → ${finalEndpoint}`);
        }
      }
    }

    const send = (bearer, stepUp = getStepUpToken()) => fetch(`${API_URL}${finalEndpoint}`, {
      ...options,
      headers: {
        ...headers,
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(stepUp ? { 'X-Step-Up-Token': stepUp } : {}),
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    let res = await send(requestToken);

    // Not every 401 means the token is stale. Read the code first: rotating in
    // response to "prove you're present" or "your session is over" burns a
    // rotation for nothing and churns auth state — which knocked E2EE back to
    // its locked state and unmounted the step-up prompt mid-flow.
    const codeOf = async (r) => {
      try { return (await r.clone().json())?.code ?? null; } catch { return null; }
    };

    if (res.status === 401) {
      let code = await codeOf(res);

      // An expired access token is now an ordinary event — roughly hourly
      // rather than monthly — so it is handled here rather than escalated to
      // the user. refreshAccessToken is single-flight, so a burst of
      // simultaneous 401s still costs one round-trip.
      const rotatable = code !== 'STEP_UP_REQUIRED'
        && code !== 'SESSION_REVOKED'
        && code !== 'SESSION_EXPIRED';
      if (rotatable && hasRefreshToken()) {
        const fresh = await refreshAccessToken();
        if (fresh) {
          res = await send(fresh);
          if (res.status === 401) code = await codeOf(res);
        }
      }

      // The route wants proof of presence. Prompt for the password once and
      // replay — callers need not know which routes are gated, and the prompt
      // is single-flight so a burst cannot stack dialogs.
      if (res.status === 401 && code === 'STEP_UP_REQUIRED' && !options.skipStepUp) {
        const proof = await requestStepUp(options.stepUpReason);
        if (proof) res = await send(storage.getToken(), proof);
      }
    }

    const data = await res.json();
    if (!res.ok) {
      // Preserve the machine-readable parts of the response: callers should be
      // able to branch on a code rather than pattern-matching the prose.
      const apiError = () => {
        const e = new Error(data.error || `API error: ${res.status}`);
        e.status = res.status;
        if (data.code) e.code = data.code;
        if (data.feature) e.feature = data.feature;
        return e;
      };
      if (res.status === 401) {
        // If the token was rotated during this request's flight (renewal), the 401 is stale —
        // the client already has a fresh token. Drop silently rather than logging out.
        if (requestToken !== storage.getToken()) {
          throw apiError();
        }
        // The session itself was ended server-side — a detected refresh-token
        // reuse, a revocation, or the idle window elapsing. No amount of
        // retrying helps; the user must sign in again.
        if (data.code === 'SESSION_REVOKED' || data.code === 'SESSION_EXPIRED') {
          logout?.();
          throw apiError();
        }
        // Step-up is a prompt, not a failure: the caller shows the password
        // dialog and retries. Never log the user out over it.
        if (data.code === 'STEP_UP_REQUIRED') {
          throw apiError();
        }
        // Token expired — show renewal modal instead of immediate logout (v2.29.0)
        if (data.code === 'TOKEN_EXPIRED') {
          triggerSessionExpiry?.();
        } else {
          logout?.();
        }
      } else if (res.status === 403 && (data.code === 'ACCOUNT_DISABLED' || data.code === 'ACCOUNT_BANNED')) {
        // Account moderated — force logout (v2.37.0)
        logout?.();
      }
      throw apiError();
    }
    return data;
  }, [logout, triggerSessionExpiry, isSlowConnection]);

  // Return both fetchAPI and connection status for components that need it
  return useMemo(() => ({
    fetchAPI,
    isSlowConnection,
  }), [fetchAPI, isSlowConnection]);
}
