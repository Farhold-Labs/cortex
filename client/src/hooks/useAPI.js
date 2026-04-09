import { useCallback, useContext, createContext, useMemo, useRef, useEffect } from 'react';
import { API_URL } from '../config/constants.js';
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

    const res = await fetch(`${API_URL}${finalEndpoint}`, {
      ...options,
      headers: { ...headers, ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        // If the token was rotated during this request's flight (renewal), the 401 is stale —
        // the client already has a fresh token. Drop silently rather than logging out.
        if (requestToken !== storage.getToken()) {
          throw new Error(data.error || `API error: ${res.status}`);
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
      throw new Error(data.error || `API error: ${res.status}`);
    }
    return data;
  }, [logout, triggerSessionExpiry, isSlowConnection]);

  // Return both fetchAPI and connection status for components that need it
  return useMemo(() => ({
    fetchAPI,
    isSlowConnection,
  }), [fetchAPI, isSlowConnection]);
}
