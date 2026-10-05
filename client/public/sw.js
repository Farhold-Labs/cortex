// Cortex Service Worker
// Includes: Push notifications, offline caching,
//           pre-caching of hashed build assets at install time (v2.13.0),
//           a deadline on the app shell so a congested network boots from cache (v2.106.0)
// NOTE: the cache-name version below is rewritten to the current app version
// at build time by scripts/inject-sw-assets.mjs (dev keeps the fallback value).
const CACHE_NAME = 'cortex-v2.59.1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// How long a navigation waits for the network before booting the cached shell.
// On a healthy connection the shell arrives well inside this and the app always
// boots current; on a congested one (v2.106.0) the old network-only wait was
// the black screen people saw, so past this deadline the cached copy wins and
// the network response is still collected in the background.
const NAV_TIMEOUT_MS = 2000;

// Injected at build time by scripts/inject-sw-assets.mjs —
// contains all hashed JS/CSS filenames from the Vite manifest.
// __PRECACHE_ASSETS__
const PRECACHE_ASSETS = [];

// A response is "poison" for an asset request when the server answered with
// HTML instead of the asset — e.g. an SPA fallback returning 200 index.html
// for a hashed bundle that was deleted by a deploy. Caching it bricks the app
// on the next cold start (v2.60.3).
function isHtmlForAsset(request, response) {
  if (!response || !response.ok) return false;
  const pathname = new URL(request.url).pathname;
  // Only file-like, non-HTML paths can be poisoned
  if (!/\.[a-z0-9]{2,5}$/i.test(pathname) || pathname.endsWith('.html')) return false;
  const type = response.headers.get('content-type') || '';
  return type.includes('text/html');
}

// ============ App shell ============
// The v2.63.1 incident was a cached index.html pointing at bundles a deploy had
// deleted. The rule that prevents it now: a shell is only ever SERVED from cache
// when every asset it references is in the same cache, and only ever STORED
// once those assets have been fetched and validated. A cached shell therefore
// always boots, however old it is.

// The hashed files a shell needs to boot: entry script, modulepreloads, CSS.
function shellAssets(html) {
  return [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
}

async function shellIsComplete(cache, html) {
  for (const asset of shellAssets(html)) {
    const hit = await cache.match(asset);
    if (!hit || isHtmlForAsset(new Request(asset), hit)) return false;
  }
  return true;
}

// Returns the stored HTML, or null when an asset could not be fetched (the
// previous shell then stays in place, which is the point).
async function storeShell(cache, key, response) {
  const html = await response.clone().text();
  for (const asset of shellAssets(html)) {
    if (await cache.match(asset)) continue;
    const request = new Request(asset);
    const assetResponse = await fetch(request);
    if (!assetResponse.ok || isHtmlForAsset(request, assetResponse)) return null;
    await cache.put(asset, assetResponse);
  }
  await cache.put(key, response);
  return html;
}

async function cachedShellFor(cache, request) {
  for (const key of [request, '/index.html', '/']) {
    const hit = await cache.match(key);
    if (!hit) continue;
    const html = await hit.text();
    if (await shellIsComplete(cache, html)) return html;
  }
  return null;
}

// Serving from cache is marked in the page itself, so the app knows to treat
// the connection as slow. If the server has moved on meanwhile, the WebSocket's
// serverVersion raises the existing update banner, and because the new shell is
// stored in the background, a reload — or simply the next launch — boots it.
function shellResponse(html, how) {
  return new Response(html.replace('<head>', `<head><meta name="cortex-boot" content="${how}">`), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

async function handleNavigation(event) {
  const { request } = event;
  const cachePromise = caches.open(CACHE_NAME);

  const network = fetch(request);
  // Store whatever the network eventually returns, even if a cached shell was
  // served first. waitUntil must be called synchronously during dispatch — a
  // call made once the response has been served throws — hence up here.
  event.waitUntil(
    network
      .then(async (response) => {
        if (!response || !response.ok) return;
        const copy = response.clone(); // before anything awaits: the page may consume the body next
        await storeShell(await cachePromise, request, copy);
      })
      .catch((err) => console.warn('[SW] Could not store app shell:', err.message))
  );

  const cache = await cachePromise;
  const cachedHtml = await cachedShellFor(cache, request);
  if (!cachedHtml) {
    // First visit, or nothing that would boot: the network is the only option.
    try { return await network; } catch { return Response.error(); }
  }

  const deadline = new Promise((resolve) => setTimeout(() => resolve('timeout'), NAV_TIMEOUT_MS));
  try {
    const winner = await Promise.race([network, deadline]);
    if (winner === 'timeout') return shellResponse(cachedHtml, 'cache-slow');
    if (winner.ok) return winner;
    return shellResponse(cachedHtml, 'cache-error'); // e.g. a 5xx mid-deploy
  } catch {
    return shellResponse(cachedHtml, 'cache-offline');
  }
}

// Install: pre-cache static shell + all hashed build assets.
// Each asset is fetched and validated individually (instead of cache.addAll,
// which happily caches a 200 HTML fallback) — a poisoned or failed asset
// aborts the install so the previous working SW stays active (v2.60.3).
self.addEventListener('install', (event) => {
  const allAssets = [...STATIC_ASSETS, ...PRECACHE_ASSETS];
  console.log(`[SW] Installing ${CACHE_NAME} — pre-caching ${allAssets.length} assets`);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(allAssets.map(async (asset) => {
        // Hashed assets are immutable, so the browser's HTTP cache may supply
        // them (v2.106.0); the page usually fetched them moments ago. Forcing
        // revalidation cost a round trip each, on exactly the connections where
        // an install is slowest. The shell and manifest still revalidate.
        const hashed = asset.startsWith('/assets/');
        const request = new Request(asset, { cache: hashed ? 'default' : 'no-cache' });
        const response = await fetch(request);
        if (!response.ok) throw new Error(`[SW] Pre-cache failed: ${asset} → ${response.status}`);
        if (isHtmlForAsset(request, response)) throw new Error(`[SW] Pre-cache got HTML for asset: ${asset}`);
        await cache.put(asset, response);
      }))
    )
  );
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
            if (name === CACHE_NAME) return false;
            // Delete old farhold/cortex caches — including the cortex-api-*
            // wave-list cache retired in v2.106.0 (it was not per-user).
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

  // API requests: network only. The wave list used to be cached here, keyed by
  // URL alone — so after one person logged out, the next to log in on the same
  // browser could be served the previous person's waves. The app now keeps its
  // own per-user copy (src/utils/waveCache.js), which logout clears (v2.106.0).
  if (url.pathname.startsWith('/api/')) return;

  // Media files: Skip caching (206 Partial Content can't be cached)
  if (url.pathname.startsWith('/uploads/media/')) {
    return;
  }

  // Navigation requests (HTML): network with a deadline (v2.106.0).
  // v2.63.1 made this network-first with no limit, to stop stale shells that
  // pointed at deleted bundles. That fixed the stale shell but meant a slow
  // network — not a failed one — held the app on a black screen for as long as
  // the request took. Now a healthy connection still always boots current, a
  // congested one boots the cached shell after NAV_TIMEOUT_MS, and a cached
  // shell is only used when its bundles are cached too (see handleNavigation).
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  // Hashed build assets: Cache-first (immutable — Vite hashes the filenames).
  // NOTE (v2.60.3): the previous pattern /\.[a-f0-9]{8,}\.(js|css)$/ never
  // matched Vite's `name-Hash.ext` naming, so bundles silently took the
  // network-first path below. Match the whole /assets/ dir instead, and
  // self-heal by purging any poisoned (HTML-as-JS) entry before serving.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached && !isHtmlForAsset(request, cached)) return cached;
      if (cached) await cache.delete(request); // poisoned — drop and refetch
      const response = await fetch(request);
      if (response.ok && !isHtmlForAsset(request, response)) {
        cache.put(request, response.clone());
      }
      return response;
    })());
    return;
  }

  // Other assets: Network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic' && !isHtmlForAsset(request, response)) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        // Never serve a poisoned cache entry as an offline fallback
        if (cached && isHtmlForAsset(request, cached)) return Response.error();
        return cached;
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
