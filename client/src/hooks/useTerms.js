import { useSyncExternalStore } from 'react';
import { getTerms, subscribeTerms } from '../config/terminology.js';

/**
 * The instance vocabulary (v2.82.0).
 *
 *   const T = useTerms();
 *   <h2>{T.Waves}</h2>          // "Waves" or "Messages"
 *   `No ${T.pings} yet`         // "pings" or "comments"
 *
 * Backed by an external store rather than context so any component can read it
 * without threading a provider through the tree, and so the value is available
 * synchronously on first paint from the cached instance config.
 */
export function useTerms() {
  return useSyncExternalStore(subscribeTerms, getTerms, getTerms);
}

export default useTerms;
