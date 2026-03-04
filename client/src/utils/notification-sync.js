import { API_URL } from '../config/constants.js';

const POLL_INTERVAL = 30000;     // 30 seconds
const INITIAL_DELAY = 5000;      // 5 seconds (let WS connect first)
const RECONNECT_DELAY = 2000;    // 2 seconds after WS reconnect

export class NotificationSync {
  constructor({ token, getCurrentWaveId, onNotificationsReceived, onRefreshBell }) {
    this.token = token;
    this.getCurrentWaveId = getCurrentWaveId;
    this.onNotificationsReceived = onNotificationsReceived;
    this.onRefreshBell = onRefreshBell;
    this.intervalId = null;
    this.timeoutId = null;
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    // Initial poll after delay to let WS connect
    this.timeoutId = setTimeout(() => {
      if (this.stopped) return;
      this.poll(true); // suppress local notifications on initial load
      this.intervalId = setInterval(() => this.poll(false), POLL_INTERVAL);
    }, INITIAL_DELAY);

    // Poll immediately (but suppress notifications) when tab becomes visible
    this._onVisibility = () => {
      if (!document.hidden) {
        this.poll(true); // visible — refresh bell but don't show popups
      }
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  stop() {
    this.stopped = true;
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.intervalId) clearInterval(this.intervalId);
    document.removeEventListener('visibilitychange', this._onVisibility);
  }

  onWebSocketReconnect() {
    // Poll shortly after WS reconnects to catch missed notifications
    setTimeout(() => {
      if (!this.stopped) this.poll(true);
    }, RECONNECT_DELAY);
  }

  async poll(suppressLocalNotif = false) {
    if (this.stopped) return;
    try {
      const res = await fetch(`${API_URL}/notifications/pending`, {
        headers: { 'Authorization': `Bearer ${this.token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const notifications = data.notifications || [];

      if (notifications.length === 0) return;

      // Refresh bell and wave badges
      this.onRefreshBell?.();
      this.onNotificationsReceived?.();

      // Show local browser notifications for missed messages (only when tab is hidden)
      if (!suppressLocalNotif && document.hidden && Notification.permission === 'granted') {
        const currentWaveId = this.getCurrentWaveId?.();
        for (const n of notifications) {
          // Skip notifications for the wave the user is currently viewing
          if (n.waveId && n.waveId === currentWaveId) continue;
          try {
            new Notification(n.title || 'Cortex', {
              body: n.body || n.preview || '',
              tag: n.id, // deduplicate
              data: { waveId: n.waveId },
            });
          } catch (_) {
            // Notification API may not be available in all contexts
          }
        }
      }
    } catch (_) {
      // Network error — will retry on next interval
    }
  }
}
