// ============ CAPACITOR NATIVE PUSH NOTIFICATIONS ============
// Uses dynamic import() so Capacitor plugin modules are only loaded inside
// the native shell. Static imports would create a window.Capacitor stub on
// web browsers, breaking native-app detection in pwa.js and constants.js.

import { API_URL } from '../config/constants.js';

const FCM_TOKEN_KEY = 'farhold_fcm_token';
const DEVICE_ID_KEY = 'farhold_device_id';

// Cached plugin instances — initialized on first use via dynamic import
let _PushNotifications = null;
let _Haptics = null;
let _initPromise = null;

async function ensurePlugins() {
  if (_PushNotifications) return true;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      // Import the actual plugin packages (not raw registerPlugin proxies).
      // Each plugin package exports a pre-configured instance with proper
      // native method signatures, permission handling, and event listeners.
      const pushMod = await import('@capacitor/push-notifications');
      const hapticsMod = await import('@capacitor/haptics');
      _PushNotifications = pushMod.PushNotifications;
      _Haptics = hapticsMod.Haptics;
      return true;
    } catch (e) {
      console.error('[CapPush] Failed to load Capacitor plugins:', e.message);
      return false;
    }
  })();

  return _initPromise;
}

function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

function getPlatform() {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  return 'unknown';
}

/**
 * Trigger haptic feedback (fire-and-forget, safe to call from sync context).
 */
export function triggerHaptic() {
  if (!_Haptics) {
    // First call — kick off async init, haptic will work from second tap onwards
    ensurePlugins();
    return;
  }
  _Haptics.impact({ style: 'LIGHT' });
}

/**
 * Request permission and register for native push notifications.
 * Sends the FCM/APNs token to the server.
 */
export async function registerCapacitorPush(authToken) {
  const ready = await ensurePlugins();
  if (!ready || !_PushNotifications) {
    console.log('[CapPush] PushNotifications plugin not available');
    return { success: false, reason: 'Native push plugin not available' };
  }

  try {
    // Request permission
    const permResult = await _PushNotifications.requestPermissions();
    console.log('[CapPush] Permission result:', permResult.receive);

    if (permResult.receive !== 'granted') {
      return { success: false, reason: 'Push notification permission denied' };
    }

    // Clean up any stale listeners from previous attempts before registering new ones
    await _PushNotifications.removeAllListeners();

    // Register with the native push service (FCM/APNs)
    // The token arrives asynchronously via the 'registration' event
    const token = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Push registration timed out'));
      }, 15000);

      _PushNotifications.addListener('registration', (regToken) => {
        clearTimeout(timeout);
        resolve(regToken.value);
      });

      _PushNotifications.addListener('registrationError', (error) => {
        clearTimeout(timeout);
        reject(new Error(error.error || 'Registration failed'));
      });

      _PushNotifications.register();
    });

    console.log('[CapPush] Got FCM token:', token.substring(0, 20) + '...');

    // Store locally
    localStorage.setItem(FCM_TOKEN_KEY, token);

    // Send to server
    const response = await fetch(`${API_URL}/push/fcm/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        token,
        platform: getPlatform(),
        deviceId: getOrCreateDeviceId(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[CapPush] Server registration failed:', response.status, errorText);
      return { success: false, reason: `Server rejected token: ${errorText}` };
    }

    console.log('[CapPush] FCM token registered with server');
    return { success: true };
  } catch (error) {
    console.error('[CapPush] Registration error:', error.message);
    return { success: false, reason: error.message };
  }
}

/**
 * Set up listeners for incoming push notifications.
 * @param {function} onNotificationTap - Called with { waveId } when user taps a notification
 */
let _listenersSetUp = false;

export async function setupCapacitorPushListeners(onNotificationTap) {
  // Prevent duplicate listener registration (useEffect can re-run)
  if (_listenersSetUp) return;

  const ready = await ensurePlugins();
  if (!ready || !_PushNotifications) return;

  _listenersSetUp = true;

  // Foreground notification — log it (OS shows nothing by default, our config enables alert)
  await _PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.log('[CapPush] Foreground notification:', notification.title, notification.body);
  });

  // User tapped a notification (background or killed state)
  await _PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    console.log('[CapPush] Notification tapped:', action.notification?.data);
    const data = action.notification?.data;
    if (data?.waveId && onNotificationTap) {
      onNotificationTap({ waveId: data.waveId });
    }
  });
}

/**
 * Register with server using a pre-stored FCM token (for remote-origin WebView
 * where the Capacitor bridge is unavailable). The launcher script obtains the
 * FCM token on the local origin and passes it via URL hash; the early bootstrap
 * script stores it in localStorage as 'farhold_fcm_token'.
 */
export async function registerStoredFcmToken(authToken) {
  const fcmToken = localStorage.getItem(FCM_TOKEN_KEY);
  if (!fcmToken) {
    return { success: false, reason: 'No FCM token available. Restart the app to register for push notifications.' };
  }

  try {
    const response = await fetch(`${API_URL}/push/fcm/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        token: fcmToken,
        platform: getPlatform(),
        deviceId: getOrCreateDeviceId(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[CapPush] Stored FCM token registration failed:', response.status, errorText);
      return { success: false, reason: `Server rejected token: ${errorText}` };
    }

    console.log('[CapPush] Stored FCM token registered with server');
    return { success: true };
  } catch (error) {
    console.error('[CapPush] Stored FCM token registration error:', error.message);
    return { success: false, reason: error.message };
  }
}

/**
 * Unregister stored FCM token from the server (remote-origin WebView path).
 * Keeps the token in localStorage so re-enabling push works without a cold start.
 */
export async function unregisterStoredFcmToken(authToken) {
  const token = localStorage.getItem(FCM_TOKEN_KEY);
  if (!token) return;

  try {
    await fetch(`${API_URL}/push/fcm/unregister`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token }),
    });
    console.log('[CapPush] Stored FCM token unregistered from server');
  } catch (error) {
    console.warn('[CapPush] Server unregister failed:', error.message);
  }
}

/**
 * Unregister from native push notifications.
 * Removes the FCM token from the server and clears local storage.
 */
export async function unregisterCapacitorPush(authToken) {
  const token = localStorage.getItem(FCM_TOKEN_KEY);

  try {
    await fetch(`${API_URL}/push/fcm/unregister`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token }),
    });
    console.log('[CapPush] FCM token unregistered from server');
  } catch (error) {
    console.warn('[CapPush] Server unregister failed:', error.message);
  }

  localStorage.removeItem(FCM_TOKEN_KEY);
}
