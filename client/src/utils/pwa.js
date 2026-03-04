// ============ PWA UTILITIES ============

import { API_URL, isNativeApp } from '../config/constants.js';
import { registerCapacitorPush, unregisterCapacitorPush, registerStoredFcmToken, unregisterStoredFcmToken } from './capacitor-push.js';

// PWA Badge API - shows unread count on installed app icon
// Note: Only works when installed as PWA (not in browser tab)
export const updateAppBadge = (count) => {
  const isInstalled = window.matchMedia('(display-mode: standalone)').matches ||
                      window.navigator.standalone === true;
  const hasAPI = 'setAppBadge' in navigator;

  console.log(`[Badge] Update requested: count=${count}, installed=${isInstalled}, hasAPI=${hasAPI}`);

  if (hasAPI) {
    if (count > 0) {
      navigator.setAppBadge(count)
        .then(() => console.log(`[Badge] Successfully set to ${count}`))
        .catch(err => console.log('[Badge] Failed to set:', err.message));
    } else {
      navigator.clearAppBadge()
        .then(() => console.log('[Badge] Successfully cleared'))
        .catch(err => console.log('[Badge] Failed to clear:', err.message));
    }
  } else {
    console.log('[Badge] API not available - requires installed PWA in supported browser');
  }
};

// Subscribe to push notifications
export async function subscribeToPush(token, { silent = false } = {}) {
  console.log('[Push] subscribeToPush called', silent ? '(silent/auto)' : '(manual)');

  // Capacitor native apps use FCM/APNs via capacitor-push.js
  // Check isNativePlatform to distinguish real Capacitor bridge from @capacitor/core web stub
  if (window.Capacitor?.isNativePlatform) {
    console.log('[Push] Capacitor detected — delegating to native push');
    return registerCapacitorPush(token);
  }

  // Capacitor WebView on remote server — bridge unavailable, use stored FCM token
  // The launcher script obtains the FCM token on local origin and passes it via URL hash
  if (localStorage.getItem('farhold_is_capacitor') === 'true') {
    console.log('[Push] Capacitor WebView (remote origin) — using stored FCM token');
    return registerStoredFcmToken(token);
  }

  // Other native apps (Electron) don't support web push
  if (isNativeApp) {
    console.log('[Push] Native app detected — web push not available');
    return { success: false, reason: 'Push notifications use native platform on this device' };
  }

  if (!('serviceWorker' in navigator)) {
    console.log('[Push] Service Worker not supported');
    return { success: false, reason: 'Service Worker not supported in this browser' };
  }

  if (!('PushManager' in window)) {
    console.log('[Push] PushManager not supported');
    return { success: false, reason: 'Push notifications not supported in this browser' };
  }

  try {
    // First check/request notification permission
    console.log('[Push] Current permission:', Notification.permission);
    let permission = Notification.permission;
    if (permission === 'default') {
      if (silent) {
        console.log('[Push] Permission not yet granted, skipping auto-subscribe');
        return { success: false, reason: 'Permission not yet granted' };
      }
      console.log('[Push] Requesting notification permission...');
      permission = await Notification.requestPermission();
      console.log('[Push] Permission result:', permission);
    }

    if (permission !== 'granted') {
      console.log('[Push] Notification permission not granted:', permission);
      return { success: false, reason: permission === 'denied' ? 'Notification permission denied. Check browser settings.' : 'Notification permission required' };
    }

    // Get VAPID public key from server
    console.log('[Push] Fetching VAPID key...');
    const response = await fetch(`${API_URL}/push/vapid-key`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      console.log('[Push] VAPID key fetch failed:', response.status);
      return { success: false, reason: 'Server push configuration unavailable' };
    }

    const { publicKey } = await response.json();
    console.log('[Push] Got VAPID key');

    // Get service worker registration
    console.log('[Push] Waiting for service worker...');
    const registration = await navigator.serviceWorker.ready;
    console.log('[Push] Service worker ready');

    // Always clear any existing subscription first for a clean state
    // This prevents stale subscriptions from previous users on the same browser
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      console.log('[Push] Clearing existing subscription for clean state...');
      try {
        await subscription.unsubscribe();
        console.log('[Push] Old subscription cleared');
      } catch (unsubError) {
        console.warn('[Push] Failed to clear old subscription:', unsubError.message);
      }
      subscription = null;
    }

    // Clear stored VAPID key so we always start fresh
    localStorage.removeItem('farhold_vapid_key');

    // Create new push subscription
    console.log('[Push] Creating new push subscription...');
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      console.log('[Push] New push subscription created');
    } catch (subError) {
      console.error('[Push] Failed to create subscription:', subError.name, subError.message);

      // For silent/auto-subscribe, don't do aggressive recovery
      if (silent) {
        console.log('[Push] Auto-subscribe failed, user can enable manually');
        return { success: false, reason: subError.message };
      }

      // For manual enable, try recovery strategies
      if (subError.name === 'AbortError') {
        console.log('[Push] AbortError detected - attempting recovery...');

        // Strategy: Re-register service worker and retry
        let newReg = null;
        try {
          console.log('[Push] Re-registering service worker...');
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const reg of registrations) {
            await reg.unregister();
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
          newReg = await navigator.serviceWorker.register('/sw.js');
          await navigator.serviceWorker.ready;
          await new Promise(resolve => setTimeout(resolve, 1000));
          console.log('[Push] Service worker re-registered');
        } catch (e) {
          console.log('[Push] Service worker reset error:', e.message);
        }

        // Retry subscription with increasing delays
        const retryDelays = [1000, 3000, 5000];
        for (let i = 0; i < retryDelays.length; i++) {
          try {
            console.log(`[Push] Subscription attempt ${i + 1}/${retryDelays.length}...`);
            const reg = newReg || await navigator.serviceWorker.ready;
            subscription = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(publicKey)
            });
            console.log('[Push] Subscription succeeded on retry');
            break;
          } catch (retryError) {
            console.log(`[Push] Attempt ${i + 1} failed:`, retryError.message);
            if (i < retryDelays.length - 1) {
              await new Promise(resolve => setTimeout(resolve, retryDelays[i]));
            }
          }
        }

        if (!subscription) {
          console.error('[Push] All recovery attempts failed');
          const isBrave = navigator.brave && typeof navigator.brave.isBrave === 'function';
          const isFirefox = navigator.userAgent.includes('Firefox');
          const isChrome = navigator.userAgent.includes('Chrome');
          let guidance = '';
          if (isBrave) {
            guidance = 'Brave blocks push by default. Go to brave://settings/privacy and enable "Use Google Services for Push Messaging", then refresh and try again.';
          } else if (isFirefox) {
            guidance = 'Push service error. Click the lock icon → Connection secure → More Information → Permissions → Clear "Receive Notifications" permission, then refresh and try again.';
          } else if (isChrome) {
            guidance = 'Push service error. Click the lock icon → Site settings → Notifications → Reset, then refresh and try again.';
          } else {
            guidance = 'Push service error. Reset notification permissions for this site in browser settings, then refresh.';
          }
          return { success: false, reason: guidance };
        }
      } else {
        return { success: false, reason: `Browser subscription failed: ${subError.message}` };
      }
    }

    // Send subscription to server
    console.log('[Push] Sending subscription to server...');
    const subscribeResponse = await fetch(`${API_URL}/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ subscription })
    });

    if (!subscribeResponse.ok) {
      const errorText = await subscribeResponse.text();
      console.error('[Push] Server rejected subscription:', subscribeResponse.status, errorText);
      return { success: false, reason: `Server rejected subscription: ${errorText}` };
    }

    // Store VAPID key to detect future changes
    localStorage.setItem('farhold_vapid_key', publicKey);
    console.log('[Push] Push subscription registered with server');
    return { success: true };
  } catch (error) {
    console.error('[Push] Failed to subscribe:', error.name, error.message, error);
    return { success: false, reason: `Unexpected error: ${error.message}` };
  }
}

// Unsubscribe from push notifications
export async function unsubscribeFromPush(token) {
  // Capacitor native apps — unregister FCM token
  if (window.Capacitor?.isNativePlatform) {
    await unregisterCapacitorPush(token);
    return true;
  }

  // Capacitor WebView on remote origin — unregister stored FCM token
  if (localStorage.getItem('farhold_is_capacitor') === 'true') {
    await unregisterStoredFcmToken(token);
    return true;
  }

  if (isNativeApp || !('serviceWorker' in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const endpoint = subscription.endpoint;

      // Unsubscribe locally first
      try {
        await subscription.unsubscribe();
        console.log('[Push] Local subscription removed');
      } catch (unsubError) {
        console.warn('[Push] Local unsubscribe failed:', unsubError.message);
        // Continue anyway to clean up server-side
      }

      // Tell server to remove subscription
      try {
        await fetch(`${API_URL}/push/subscribe`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ endpoint })
        });
        console.log('[Push] Server subscription removed');
      } catch (serverError) {
        console.warn('[Push] Server unsubscribe failed:', serverError.message);
      }
    }

    // Always clear stored VAPID key to ensure clean state for re-enable
    localStorage.removeItem('farhold_vapid_key');
    console.log('[Push] Push subscription cleanup complete');
    return true;
  } catch (error) {
    console.error('[Push] Failed to unsubscribe:', error);
    // Still try to clear VAPID key
    localStorage.removeItem('farhold_vapid_key');
    return false;
  }
}

// Force reset push notification state (for troubleshooting)
export async function forceResetPushState() {
  console.log('[Push] Force resetting push state...');

  if (isNativeApp) {
    console.log('[Push] Native app — skipping web push reset');
    return true;
  }

  try {
    // Clear stored VAPID key
    localStorage.removeItem('farhold_vapid_key');

    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;

      // Try to unsubscribe any existing subscription
      try {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
          console.log('[Push] Existing subscription unsubscribed');
        }
      } catch (e) {
        console.log('[Push] Could not unsubscribe:', e.message);
      }

      // Unregister service worker
      try {
        await registration.unregister();
        console.log('[Push] Service worker unregistered');
      } catch (e) {
        console.log('[Push] Could not unregister SW:', e.message);
      }

      // Re-register service worker
      await new Promise(resolve => setTimeout(resolve, 1000));
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      console.log('[Push] Service worker re-registered');
    }

    console.log('[Push] Force reset complete - try enabling notifications again');
    return true;
  } catch (error) {
    console.error('[Push] Force reset failed:', error);
    return false;
  }
}

// Convert base64 VAPID key to Uint8Array
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
