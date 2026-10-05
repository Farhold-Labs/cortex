// Low-Bandwidth Mode: Network Detection Hook (v2.10.0)
// Uses Network Information API with fallback latency measurement
//
// v2.106.0: one shared monitor for the whole app. Every useAPI() caller used to
// get its own copy of this hook — its own listeners and, without the Network
// Information API, its own latency probe — so a screen with thirty components
// probed thirty times a minute. It also only measured latency when that API was
// missing, and Android always has it: on a congested cell the API kept
// reporting "4g" while requests took seconds, and the app never noticed. The
// measured round-trip now counts on every platform, and so does the service
// worker having had to boot the cached shell because the network was too slow.

import { useSyncExternalStore } from 'react';
import { API_URL } from '../config/constants.js';

// Thresholds for determining slow connection
const SLOW_EFFECTIVE_TYPES = ['slow-2g', '2g'];
const SLOW_DOWNLINK_THRESHOLD = 1.5; // Mbps
const SLOW_RTT_THRESHOLD = 500; // ms
const FIRST_MEASUREMENT_DELAY = 3000;
const LATENCY_MEASUREMENT_INTERVAL = 60000; // Re-measure every 60 seconds

const getConnection = () =>
  typeof navigator !== 'undefined' ? (navigator.connection || navigator.mozConnection || navigator.webkitConnection) : null;

// Set by the service worker when navigation timed out and the cached shell was
// served instead (public/sw.js). Until a measurement says otherwise, that is
// the best evidence there is about this connection.
const bootedFromCache = () => {
  const how = typeof document !== 'undefined' && document.querySelector('meta[name="cortex-boot"]')?.content;
  return how === 'cache-slow' || how === 'cache-offline';
};

function isSlowFromConnection(connection) {
  if (!connection) return false;
  if (connection.saveData) return true;
  if (SLOW_EFFECTIVE_TYPES.includes(connection.effectiveType)) return true;
  if (connection.downlink && connection.downlink < SLOW_DOWNLINK_THRESHOLD) return true;
  if (connection.rtt && connection.rtt > SLOW_RTT_THRESHOLD) return true;
  return false;
}

function compute(measuredRtt, isOffline) {
  const connection = getConnection();
  const slowByMeasurement = measuredRtt != null
    ? measuredRtt > SLOW_RTT_THRESHOLD
    : bootedFromCache();
  // Congested: the network has been SEEN to be slow, as opposed to estimated.
  // Chrome's downlink figure is built from recent transfers, and small API
  // responses read low — 1.55 Mb/s on an unthrottled desktop link, against a
  // 1.5 threshold — which is fine for choosing smaller responses but not for
  // refusing someone a call. Measured latency, the cached-shell boot, being
  // offline or a 2G link are evidence; the downlink estimate is not.
  const congested = isOffline || slowByMeasurement ||
    SLOW_EFFECTIVE_TYPES.includes(connection?.effectiveType);
  return {
    effectiveType: connection ? (connection.effectiveType || '4g') : 'unknown',
    downlink: connection ? (connection.downlink || 10) : null,
    rtt: connection ? (connection.rtt || 50) : null,
    saveData: connection?.saveData || false,
    measuredRtt,
    isOffline,
    isSlowConnection: isOffline || isSlowFromConnection(connection) || slowByMeasurement,
    isCongested: congested,
    source: measuredRtt != null ? 'latency-measurement' : connection ? 'network-info-api' : 'default',
  };
}

let measuredRtt = null;
let isOffline = typeof navigator !== 'undefined' ? navigator.onLine === false : false;
let snapshot = compute(measuredRtt, isOffline);
const subscribers = new Set();
let stopMonitor = null;

function publish() {
  const next = compute(measuredRtt, isOffline);
  const changed = Object.keys(next).some((k) => next[k] !== snapshot[k]);
  if (!changed) return;
  snapshot = next;
  subscribers.forEach((fn) => fn());
}

// Measure actual latency by timing a small request
async function measureLatency() {
  try {
    const start = performance.now();
    await fetch(`${API_URL}/health`, { method: 'HEAD', cache: 'no-store' });
    measuredRtt = Math.round(performance.now() - start);
    publish();
    return measuredRtt;
  } catch (error) {
    console.warn('[useNetworkStatus] Failed to measure latency:', error.message);
    return null;
  }
}

function startMonitor() {
  const connection = getConnection();
  const onChange = () => publish();
  const onOnline = () => { isOffline = false; publish(); measureLatency(); };
  const onOffline = () => { isOffline = true; publish(); };

  connection?.addEventListener('change', onChange);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  const first = setTimeout(measureLatency, FIRST_MEASUREMENT_DELAY);
  const interval = setInterval(measureLatency, LATENCY_MEASUREMENT_INTERVAL);

  return () => {
    connection?.removeEventListener('change', onChange);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    clearTimeout(first);
    clearInterval(interval);
  };
}

function subscribe(fn) {
  subscribers.add(fn);
  if (!stopMonitor) stopMonitor = startMonitor();
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && stopMonitor) { stopMonitor(); stopMonitor = null; }
  };
}

const getSnapshot = () => snapshot;

export function useNetworkStatus() {
  const status = useSyncExternalStore(subscribe, getSnapshot);
  return {
    ...status,
    isOnline: !status.isOffline,
    measureLatency, // Expose for manual measurement
  };
}

// Hook for components that just need the slow connection boolean
export function useIsSlowConnection() {
  return useSyncExternalStore(subscribe, getSnapshot).isSlowConnection;
}

// For decisions that withhold a feature (calls): evidence, not estimates.
export function useIsCongested() {
  return useSyncExternalStore(subscribe, getSnapshot).isCongested;
}

export default useNetworkStatus;
