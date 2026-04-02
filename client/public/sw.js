// Cortex Service Worker v2.12.1
// Includes: Push notifications, offline caching, low-bandwidth API caching
// v2.10.0: Added stale-while-revalidate for wave list API
const CACHE_NAME = 'cortex-v2.12.1';
const API_CACHE_NAME = 'cortex-api-v2.12.1';
const API_CACHE_MAX_AGE = 30000; // 30 seconds for API cache
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Stale-while-revalidate helper for API requests (v2.10.0)
// Returns cached response immediately, then updates cache in background
async function staleWhileRevalidate(request, cacheName, maxAge) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  // Always fetch fresh data in background
  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        // Store response with timestamp
        const responseToCache = networkResponse.clone();
        const headers = new Headers(responseToCache.headers);
        headers.set('x-sw-cached-at', Date.now().toString());

        // We can't modify response headers directly, so store the timestamp separately
        cache.put(request, networkResponse.clone());
        cache.put(request.url + '__timestamp', new Response(Date.now().toString()));
      }
      return networkResponse;
    })
    .catch((error) => {
      console.warn('[SW] Network fetch failed for:', request.url, error);
      return cachedResponse || new Response(JSON.stringify({ error: 'Offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    });

  // If we have a cached response, check if it's still valid
  if (cachedResponse) {
    try {
      const timestampResponse = await cache.match(request.url + '__timestamp');
      if (timestampResponse) {
        const timestamp = parseInt(await timestampResponse.text());
        const age = Date.now() - timestamp;

        if (age < maxAge) {
          console.log('[SW] Serving from cache (age:', Math.round(age/1000), 's):', request.url);
          // Return cached response, but still update in background
          fetchPromise; // Don't await, let it update in background
          return cachedResponse;
        }
      }
    } catch (e) {
      // Timestamp check failed, fall through to network
    }
  }

  // No valid cache, wait for network
  return fetchPromise;
}

// Install: Cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker v2.10.0...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // Activate immediately without waiting
  self.skipWaiting();
});

// Message handler for client communication
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_ALL_CACHES') {
    console.log('[SW] Clearing all caches...');
    caches.keys().then((names) => {
      return Promise.all(names.map((name) => caches.delete(name)));
    }).then(() => {
      console.log('[SW] All caches cleared');
      event.ports[0]?.postMessage({ success: true });
    }).catch((err) => {
      console.error('[SW] Failed to clear caches:', err);
      event.ports[0]?.postMessage({ success: false, error: err.message });
    });
  }
});

// Activate: Clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            // Keep current caches
            if (name === CACHE_NAME || name === API_CACHE_NAME) return false;
            // Delete old farhold/cortex caches
            return name.startsWith('farhold-') || name.startsWith('cortex-');
          })
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// Fetch: Network-first for HTML, cache-first for hashed assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip WebSocket requests
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) return;

  // API requests: Low-bandwidth mode caching (v2.10.0)
  // Use stale-while-revalidate for wave list to enable faster loads
  if (url.pathname.startsWith('/api/')) {
    // Wave list endpoint: Use stale-while-revalidate for faster perceived load
    // This returns cached data immediately while fetching fresh data in background
    if (url.pathname === '/api/waves' || url.pathname.match(/^\/api\/waves\?/)) {
      event.respondWith(staleWhileRevalidate(request, API_CACHE_NAME, API_CACHE_MAX_AGE));
      return;
    }

    // All other API requests: Network only (real-time data needs to be fresh)
    return;
  }

  // Media files: Skip caching (206 Partial Content can't be cached)
  if (url.pathname.startsWith('/uploads/media/')) {
    return;
  }

  // Navigation requests (HTML): Network-first, fall back to cache
  // This ensures users always get the latest app version
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache the fresh HTML for offline use
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Offline: try to serve cached HTML
          return caches.match(request).then((cached) => cached || caches.match('/'));
        })
    );
    return;
  }

  // Hashed assets (JS/CSS with hash in filename): Cache-first (immutable)
  // These files have unique hashes so cached versions are always valid
  if (url.pathname.match(/\.[a-f0-9]{8,}\.(js|css)$/i)) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Other assets: Network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});

// Handle push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    data = {
      title: 'Cortex',
      body: event.data.text()
    };
  }

  // Use unique tag per message to prevent notification replacement
  // Fall back to timestamp if no messageId provided
  const uniqueTag = data.messageId
    ? `farhold-msg-${data.messageId}`
    : `farhold-${Date.now()}`;

  const options = {
    body: data.body || 'New message received',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    tag: uniqueTag,
    renotify: true,
    requireInteraction: false, // Auto-dismiss after a while on mobile
    silent: false, // Ensure notification makes sound
    data: {
      url: data.url || '/',
      waveId: data.waveId,
      messageId: data.messageId
    },
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  // Check if app is in foreground - if so, skip notification
  // (WebSocket will deliver the message directly to the app)
  // Unless the user has disabled suppress-while-viewing, in which case always show.
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if any client window is visible/focused
        const hasVisibleClient = clientList.some(client =>
          client.visibilityState === 'visible'
        );

        // Respect user's suppressWhileFocused preference.
        // Default true (suppress) when not specified (existing behaviour).
        const shouldSuppress = data.suppressWhileFocused !== false;

        // Only show notification if app is not visible, or user disabled suppression
        if (!hasVisibleClient || !shouldSuppress) {
          return self.registration.showNotification(data.title || 'Cortex', options);
        }
        // App is visible and suppression is enabled — WebSocket delivers the message directly
        return Promise.resolve();
      })
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an existing Farhold window
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          // Navigate to the specific wave if provided
          if (event.notification.data?.waveId) {
            client.postMessage({
              type: 'navigate-to-wave',
              waveId: event.notification.data.waveId,
              pingId: event.notification.data.messageId
            });
          }
          return client.focus();
        }
      }
      // No existing window, open new one
      return clients.openWindow(urlToOpen);
    })
  );
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
