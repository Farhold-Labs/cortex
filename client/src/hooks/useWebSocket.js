import { useRef, useState, useEffect, useCallback } from 'react';
import { WS_URL } from '../config/constants.js';

// Heartbeat (v2.87.1).
//
// The server has always done this properly: it pings every 30s and terminates
// any socket that fails to pong. The client only ever sent pings and threw the
// replies away, which left one failure mode wide open — the *half-open* socket.
//
// When a phone suspends its webview (backgrounding, Doze, a wifi→cellular
// handover) the connection dies without a close frame. `readyState` stays OPEN,
// so every send appears to succeed while going nowhere, and `onclose` does not
// fire until the OS's own TCP timeout expires, which can take minutes. The
// 3-second auto-reconnect below was never the problem; nothing was triggering
// it. Symptom: a resumed phone silently receives nothing — no new pings, no
// typing indicators, no version banner — until the socket finally collapses.
//
// So: a pong that does not arrive within PONG_TIMEOUT_MS means the socket is
// dead, whatever it claims. Detection drops from minutes to ~40s at worst, and
// on resume it is immediate, because visibilitychange probes rather than
// waiting for an interval the browser was throttling anyway.
const PING_INTERVAL_MS = 30000;
const PONG_TIMEOUT_MS = 10000;
const RECONNECT_DELAY_MS = 3000;

// ============ WEBSOCKET HOOK ============
export function useWebSocket(token, onMessage) {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [serverVersion, setServerVersion] = useState(null);
  const onMessageRef = useRef(onMessage);
  const reconnectTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const pongTimeoutRef = useRef(null);

  // Keep onMessage ref updated without triggering reconnection
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!token) return;

    let intentionallyClosed = false;

    const clearHeartbeat = () => {
      clearInterval(pingIntervalRef.current);
      clearTimeout(pongTimeoutRef.current);
      pingIntervalRef.current = null;
      pongTimeoutRef.current = null;
    };

    const scheduleReconnect = (delay) => {
      if (intentionallyClosed) return;
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    // Declare the socket dead and start over. Detaching the handlers first
    // matters: a half-open socket may fire `onclose` minutes later, long after
    // its replacement is live, and we do not want that stale event tearing down
    // the new connection's timers or queueing a second reconnect.
    const dropAndReconnect = (ws, reason) => {
      if (wsRef.current !== ws) return;
      console.warn(`🔌 [WS] ${reason} — dropping socket and reconnecting`);
      clearHeartbeat();
      setConnected(false);
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try { ws.close(); } catch { /* already gone */ }
      wsRef.current = null;
      scheduleReconnect(0);
    };

    // Send a ping and require an answer. Called by the interval and, on resume,
    // directly — the interval cannot be trusted to have fired while the tab was
    // backgrounded, since browsers throttle timers there.
    const probe = (ws) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (pongTimeoutRef.current) return; // a probe is already outstanding
      ws.send(JSON.stringify({ type: 'ping' }));
      pongTimeoutRef.current = setTimeout(
        () => dropAndReconnect(ws, `no pong within ${PONG_TIMEOUT_MS}ms`),
        PONG_TIMEOUT_MS
      );
    };

    const connect = () => {
      if (intentionallyClosed) return;
      const existing = wsRef.current;
      if (existing && (existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN)) return;

      clearTimeout(reconnectTimeoutRef.current);
      clearHeartbeat();

      console.log('🔌 Connecting to WebSocket...');
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('✅ WebSocket connected');
        ws.send(JSON.stringify({ type: 'auth', token }));

        clearHeartbeat();
        pingIntervalRef.current = setInterval(() => probe(ws), PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Log ALL message types for debugging (except call_audio which spams)
          if (data.type && data.type !== 'call_audio' && data.type !== 'pong') {
            console.log(`🔌 [WS] Received: ${data.type}`, data);
          }

          if (data.type === 'auth_success') {
            setConnected(true);
            if (data.serverVersion) setServerVersion(data.serverVersion);
            console.log('✅ WebSocket authenticated');
            onMessageRef.current?.(data); // Forward so app can read server feature flags
          } else if (data.type === 'auth_error') {
            setConnected(false);
            console.error('❌ WebSocket auth failed');
          } else if (data.type === 'pong') {
            // The socket is demonstrably alive. Clearing the deadline is the
            // whole point of the heartbeat — an unanswered ping is now the
            // signal that used to be missing entirely.
            clearTimeout(pongTimeoutRef.current);
            pongTimeoutRef.current = null;
          } else {
            onMessageRef.current?.(data);
          }
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      ws.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        setConnected(false);
        clearHeartbeat();
        if (wsRef.current === ws) wsRef.current = null;

        if (!intentionallyClosed) {
          console.log('🔄 Reconnecting in 3 seconds...');
          scheduleReconnect(RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setConnected(false);
        // An error does not guarantee a close event on every platform, and the
        // interval used to be left running here — leaking one per reconnect.
        clearHeartbeat();
      };
    };

    // Coming back from a suspended webview or a network change is the exact
    // moment the socket is most likely to be dead while still claiming OPEN.
    // Probe immediately instead of waiting for a throttled interval.
    const checkAlive = () => {
      if (intentionallyClosed) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        scheduleReconnect(0);
      } else if (ws.readyState === WebSocket.OPEN) {
        probe(ws);
      }
    };

    const onVisibility = () => { if (document.visibilityState === 'visible') checkAlive(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', checkAlive);
    window.addEventListener('focus', checkAlive);

    connect();

    return () => {
      intentionallyClosed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', checkAlive);
      window.removeEventListener('focus', checkAlive);
      clearTimeout(reconnectTimeoutRef.current);
      clearHeartbeat();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token]);

  const sendMessage = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log('🔌 [WS] Sending message:', message.type);
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.error('🔌 [WS] Cannot send - WebSocket not open:', {
        hasWs: !!wsRef.current,
        readyState: wsRef.current?.readyState,
        messageType: message.type
      });
    }
  }, []);

  return { connected, sendMessage, serverVersion };
}
