// ============ CAPACITOR BOOT ============
// Vite-bundled module that runs BEFORE main.jsx.
// On Capacitor local origin: obtains FCM token via proper ES import, then redirects
// to the saved remote server. main.jsx checks __capRedirectUrl and skips React mount.
// On web or remote origin: no-op, main.jsx loads normally.

(async () => {
  if (!window.__capRedirectUrl) return;

  const url = window.__capRedirectUrl;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    const perm = await PushNotifications.requestPermissions();
    if (perm.receive === 'granted') {
      // Clean up stale listeners from previous boots
      await PushNotifications.removeAllListeners();

      const token = await Promise.race([
        new Promise((resolve, reject) => {
          PushNotifications.addListener('registration', (t) => resolve(t.value));
          PushNotifications.addListener('registrationError', (e) =>
            reject(new Error(e.error || 'FCM registration failed'))
          );
          PushNotifications.register();
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);

      window.location.replace(url + '#cap=' + encodeURIComponent(token));
      return;
    }
  } catch (e) {
    console.warn('[CapBoot] FCM registration failed, redirecting without token:', e.message);
  }

  // Permission not granted or FCM failed — redirect without token
  window.location.replace(url + '#capacitor');
})();
