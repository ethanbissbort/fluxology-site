/**
 * Service Worker for Fluxology Website
 * Provides offline support and performance caching.
 *
 * NOTE: files in public/ bypass the bundler, so no console logging here —
 * it would ship to production verbatim.
 */

// Bump BOTH names on each deploy that changes cached behavior/content.
const CACHE_NAME = 'fluxology-v2.2.0';
// Versioned so the activate handler evicts stale runtime entries on each
// release instead of serving poisoned/outdated assets indefinitely.
const RUNTIME_CACHE = 'fluxology-runtime-v2.2.0';

// Precache only the app shell. All other assets (content-hashed CSS/JS and
// the astro:fonts woff2 files under /_assets) are cached at runtime by the
// fetch handler. Listing hashed filenames here would go stale every build,
// and any 404 in this list makes cache.addAll reject and the install fail.
const ASSETS_TO_CACHE = ['/'];

// Minimal last-resort offline response — every respondWith() path must
// produce a real Response, or the browser shows a connection error page.
function offlineResponse() {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Offline</title></head>' +
      '<body style="font-family:sans-serif;background:#1B3A4B;color:#fff;display:flex;' +
      'align-items:center;justify-content:center;min-height:100vh;text-align:center">' +
      '<div><h1>You appear to be offline</h1><p>Reconnect and try again.</p></div></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// Install event - cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  const currentCaches = [CACHE_NAME, RUNTIME_CACHE];

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cacheName) => {
            if (!currentCaches.includes(cacheName)) {
              return caches.delete(cacheName);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch event
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle same-origin GET requests. Cross-origin and non-GET
  // (e.g. the contact form POST to Netlify) pass straight through.
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) {
    return;
  }

  // Navigation / HTML requests: network-first so content and security fixes
  // reach already-visited clients, falling back to cache only when offline.
  const isNavigation =
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const runtimeCopy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, runtimeCopy));

            // Keep the app-shell copy of '/' fresh too — otherwise the
            // install-time snapshot in CACHE_NAME can shadow newer runtime
            // copies in the offline fallback below.
            const url = new URL(request.url);
            if (url.pathname === '/') {
              const shellCopy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put('/', shellCopy));
            }
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match('/'))
            .then((cached) => cached || offlineResponse())
        )
    );
    return;
  }

  // Static assets: cache-first, populating the runtime cache on miss.
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((response) => {
          // Only cache successful same-origin (basic) responses; never cache
          // errors, redirects, or opaque cross-origin responses. Also never
          // cache HTML under an asset URL (e.g. a server error/fallback page
          // served where a .js/.css/font was requested).
          const contentType = response && response.headers.get('content-type');
          const isHtml = contentType && contentType.includes('text/html');
          if (!response || response.status !== 200 || response.type !== 'basic' || isHtml) {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });

          return response;
        })
        .catch(() => Response.error());
    })
  );
});

// Message event - handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Push notification support (for future use)
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'New update available',
    icon: '/icon-192.png',
    badge: '/badge-72.png'
  };

  event.waitUntil(
    self.registration.showNotification('Fluxology Inc.', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.openWindow('/')
  );
});
