/**
 * Service Worker for Fluxology Website
 * Provides offline support and performance caching.
 *
 * NOTE: files in public/ bypass the bundler, so no console logging here —
 * it would ship to production verbatim. (A postbuild terser pass minifies
 * dist/service-worker.js; this source copy stays readable.)
 */

// Single version string — both cache names derive from it, so one bump on a
// deploy that changes cached behavior/content evicts everything stale.
const CACHE_VERSION = 'v2.4.0';
const CACHE_NAME = 'fluxology-' + CACHE_VERSION;
// Versioned so the activate handler evicts stale runtime entries on each
// release instead of serving poisoned/outdated assets indefinitely.
const RUNTIME_CACHE = 'fluxology-runtime-' + CACHE_VERSION;

// Precache the app shell HTML and the dedicated offline fallback page.
// Content-hashed CSS/JS and the astro:fonts woff2 files under /_assets are
// discovered at install time by parsing '/' (see below) and cached at runtime
// by the fetch handler afterwards. Listing hashed filenames here would go
// stale every build, and any 404 in this list makes cache.addAll reject and
// the install fail.
const ASSETS_TO_CACHE = ['/', '/offline.html'];
const OFFLINE_URL = '/offline.html';

// Minimal last-resort offline response — every respondWith() path must
// produce a real Response, or the browser shows a connection error page.
// Only reachable if the /offline.html precache entry has been evicted.
function offlineResponse() {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Offline</title></head>' +
      '<body style="font-family:sans-serif;background:#1B3A4B;color:#fff;display:flex;' +
      'align-items:center;justify-content:center;min-height:100vh;text-align:center">' +
      '<div><h1>You appear to be offline</h1><p>Reconnect and try again.</p></div></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// Serve the precached offline page for failed navigations with no cached
// copy of the requested URL. Re-wrapped as a 503 so an uncached route is
// never impersonated as a 200 under the wrong URL.
function offlineFallback() {
  return caches.match(OFFLINE_URL).then((cached) => {
    if (!cached) {
      return offlineResponse();
    }
    return cached.blob().then(
      (body) =>
        new Response(body, {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        })
    );
  });
}

// Same-origin subresource discovery for install-time priming. The shell HTML
// is scanned for asset attributes (including Astro island component-url /
// renderer-url) plus inline-<style> url(...) refs (astro:fonts emits its
// @font-face rules inline), fetched CSS for url(...) references (background
// images), and fetched JS modules for their import specifiers (Svelte runtime
// chunks) — so fonts, island hydration, and CSS imagery also work offline
// after one visit. Extension-gated so page links like /fabrication/ are
// skipped.
const HTML_ASSET_PATTERN =
  /(?:href|src|component-url|renderer-url)="(\/[^"]+\.(?:css|js|mjs|woff2?|webp|avif|png|jpe?g|svg|ico))"/g;
const CSS_URL_PATTERN = /url\(\s*['"]?(\/[^'")]+)['"]?\s*\)/g;
const JS_IMPORT_PATTERN = /(?:import|from)\s*\(?\s*["']([^"']+\.(?:js|mjs))["']/g;

function extractMatches(text, pattern) {
  const urls = [];
  let match;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(text)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

// Fetch-and-cache a set of asset paths, recursively following CSS/JS
// references. Wholly best-effort: one missing asset must not fail the whole
// install. cache:'reload' bypasses the HTTP cache — primed entries must come
// from the network, not a possibly stale local copy.
function primeRuntimeCache(paths) {
  const seen = new Set();

  function resolvePath(ref, basePath) {
    try {
      const resolved = new URL(ref, self.location.origin + basePath);
      if (resolved.origin !== self.location.origin || seen.has(resolved.pathname)) {
        return null;
      }
      seen.add(resolved.pathname);
      return resolved.pathname;
    } catch (err) {
      return null;
    }
  }

  function primeOne(path) {
    return fetch(new Request(path, { cache: 'reload' }))
      .then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return undefined;
        }
        const cacheCopy = response.clone();
        const stored = caches.open(RUNTIME_CACHE).then((cache) => cache.put(path, cacheCopy));

        let nestedPattern = null;
        if (path.endsWith('.css')) {
          nestedPattern = CSS_URL_PATTERN;
        } else if (path.endsWith('.js') || path.endsWith('.mjs')) {
          nestedPattern = JS_IMPORT_PATTERN;
        }
        const nested = nestedPattern
          ? response.text().then((text) =>
              Promise.all(
                extractMatches(text, nestedPattern)
                  .map((ref) => resolvePath(ref, path))
                  .filter((p) => p !== null)
                  .map(primeOne)
              )
            )
          : Promise.resolve();

        return Promise.all([stored, nested]);
      })
      .catch(() => undefined);
  }

  return Promise.all(
    paths
      .map((ref) => resolvePath(ref, '/'))
      .filter((p) => p !== null)
      .map(primeOne)
  );
}

// Install event - cache the app shell, then prime the runtime cache with the
// shell's actual subresources so a single visit is enough for a styled,
// hydrated offline render.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache
          .addAll(ASSETS_TO_CACHE.map((url) => new Request(url, { cache: 'reload' })))
          .then(() => cache.match('/'))
      )
      .then((response) => (response ? response.text() : ''))
      .then((html) =>
        primeRuntimeCache(
          extractMatches(html, HTML_ASSET_PATTERN).concat(extractMatches(html, CSS_URL_PATTERN))
        )
      )
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
  const url = new URL(request.url);

  // Only handle same-origin GET requests. Cross-origin and non-GET
  // (e.g. the contact form's POST to /api/contact) pass straight through.
  // Compare parsed origins — a string prefix check would also match foreign
  // hosts like fluxology.ca.evil.example.
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // The self-hosted API is network-only, always: its responses are
  // per-request (validation results, rate-limit state) and must never be
  // cached or replayed from cache. POSTs already fall out above; this also
  // covers any future GET endpoint such as /api/health.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
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
            // copies when caches.match(request) runs in the fallback below.
            if (url.pathname === '/') {
              const shellCopy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put('/', shellCopy));
            }
          }
          return response;
        })
        .catch(() =>
          // Cached copy of the requested page, else the offline page — never
          // another page's content masquerading under the requested URL.
          caches.match(request).then((cached) => cached || offlineFallback())
        )
    );
    return;
  }

  // Content-hashed assets under /_assets/: cache-first forever. The hash in
  // the filename changes whenever the content does, so a cached copy can
  // never be stale.
  if (url.pathname.startsWith('/_assets/')) {
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
    return;
  }

  // Unhashed same-origin assets (public/ images, icons, manifest, robots…):
  // stale-while-revalidate. Serve the cache for speed/offline, but refresh in
  // the background so a replaced file reaches returning visitors without a
  // manual CACHE_VERSION bump.
  event.respondWith(
    caches.open(RUNTIME_CACHE).then((cache) =>
      cache.match(request).then((cachedResponse) => {
        // cache:'no-cache' makes the refresh revalidate with the server —
        // a plain fetch could be answered by still-"fresh" HTTP cache entries,
        // which would defeat the revalidation half of stale-while-revalidate.
        const networkRefresh = fetch(request, { cache: 'no-cache' }).then((response) => {
          const contentType = response && response.headers.get('content-type');
          const isHtml = contentType && contentType.includes('text/html');
          if (response && response.status === 200 && response.type === 'basic' && !isHtml) {
            cache.put(request, response.clone());
          }
          return response;
        });

        if (cachedResponse) {
          // Keep the background revalidation alive after the response returns;
          // swallow its failure — the cached copy already answered.
          event.waitUntil(networkRefresh.catch(() => undefined));
          return cachedResponse;
        }

        return networkRefresh.catch(() => Response.error());
      })
    )
  );
});

// No SKIP_WAITING message handler: install() already calls skipWaiting()
// unconditionally and activate() claims clients, so a waiting worker never
// exists to release — and no client code posts that message. The old handler
// was dead code and has been removed rather than wired up.

// Push notification support (for future use)
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'New update available',
    icon: '/icon-192.png',
    badge: '/badge-72.png'
  };

  event.waitUntil(
    self.registration.showNotification('Fluxology, Inc.', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.openWindow('/')
  );
});
