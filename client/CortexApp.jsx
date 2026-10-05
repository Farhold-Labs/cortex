import React from 'react';

// The app shell. Everything the app renders lives under src/ — this file used
// to hold some 3,000 lines of components that had been extracted there long
// ago and were never deleted: second copies of RichEmbed, the crawl bar, the
// notification bell, the GIF picker, the install prompt, the call UI and more,
// none of them reachable from the export below (removed in v2.106.0). The
// danger was not only size: a fix applied to the copy here would have changed
// nothing, the same drift trap as the three message-processing copies.
import AuthProvider from './src/views/AuthProvider.jsx';
import E2EEWrapper from './src/views/E2EEWrapper.jsx';

// ============ SERVICE WORKER REGISTRATION ============
// Registered in the Android app too since v2.106.0. It had been skipped on the
// belief that Capacitor could not run one, which left the app with no cached
// shell at all: every launch waited on the network for index.html before it
// could paint anything. The Android WebView supports service workers for an
// https origin, and Capacitor injects its bridge at document start, so a page
// served from the worker's cache still gets native push and the back button.
// iOS only exposes navigator.serviceWorker for app-bound domains, so the
// feature check below decides there. Electron is still skipped: it has its own
// cache handling (clearCacheAndReload) and was not part of this change.
const _isElectron = typeof window !== 'undefined' && window.navigator?.userAgent?.includes('Electron');
if ('serviceWorker' in navigator && !_isElectron) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[PWA] Service worker registered:', registration.scope);

        // Check for updates periodically (every hour)
        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);

        // Handle updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New version available
                console.log('[PWA] New version available');
              }
            });
          }
        });
      })
      .catch((error) => {
        console.error('[PWA] Service worker registration failed:', error);
      });
  });
}

// ============ MAIN APP ENTRY POINT ============
export default function CortexApp() {
  return (
    <AuthProvider>
      <E2EEWrapper />
    </AuthProvider>
  );
}
