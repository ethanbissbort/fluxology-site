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
// v2.5.0 changes both the install scope and the cache-key scheme, so the
// bump is what retires the old, image-heavy, URL-keyed caches on existing
// clients.
const CACHE_VERSION = 'v2.5.0';
const CACHE_NAME = 'fluxology-' + CACHE_VERSION;
// Versioned so the activate handler evicts stale runtime entries on each
// release instead of serving poisoned/outdated assets indefinitely.
const RUNTIME_CACHE = 'fluxology-runtime-' + CACHE_VERSION;

// Hard ceiling on runtime entries. Cache keys are normalised to the pathname
// (see cacheKey below), so a visitor can only ever store as many entries as
// there are files on the origin — dist ships ~134. This is a backstop against
// a future change reintroducing per-URL keys, not a policy anyone should hit:
// legitimate browsing cannot reach it.
const MAX_RUNTIME_ENTRIES = 200;

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
//
// Deliberately NOT matching image extensions (webp/avif/png/jpe?g/svg/ico).
// The <img> fallback `src` of every rendition on the shell is an image URL, so
// including them made install fetch the whole homepage image corpus up front:
// measured, a first mobile visit to '/' cost 87 requests / 4,768,282 B against
// the 26 / 646,084 B the page itself needs. Images the visitor actually loads
// are still cached by the fetch handler (/_assets/ cache-first, everything
// else stale-while-revalidate), so a visited page keeps its imagery offline;
// what is given up is priming images the visitor never saw.
const HTML_ASSET_PATTERN =
  /(?:href|src|component-url|renderer-url)="(\/[^"]+\.(?:css|js|mjs|woff2?))"/g;
const CSS_URL_PATTERN = /url\(\s*['"]?(\/[^'")]+)['"]?\s*\)/g;
const JS_IMPORT_PATTERN = /(?:import|from)\s*\(?\s*["']([^"']+\.(?:js|mjs))["']/g;

// Cache key for every runtime read and write: origin + pathname, query
// dropped. Everything this worker stores is a static file that the server
// resolves by PATH alone, so '?utm_source=…' and the dashboards'
// '?v=' + Date.now() cache-busters are noise. Keying on the full URL minted a
// brand-new permanent entry per variant that could never be hit again
// (measured: 4 visits to /?utm_source=x0..x3 stored 4 full ~100 kB HTML
// copies; the runtime cache grew 58 -> 70 in eight navigations and only a
// hand-bumped CACHE_VERSION ever cleared it). Normalising bounds the cache by
// the number of files on the origin instead of by the number of distinct URLs
// a visitor can be sent to.
function cacheKey(url) {
  return url.origin + url.pathname;
}

// Backstop eviction: keep the runtime cache under MAX_RUNTIME_ENTRIES,
// dropping the least-recently-written entries first. Cache.keys() is
// insertion-ordered and put() re-appends a replaced key, so the head of the
// list is the coldest entry.
function trimRuntimeCache() {
  return caches
    .open(RUNTIME_CACHE)
    .then((cache) =>
      cache.keys().then((keys) => {
        if (keys.length <= MAX_RUNTIME_ENTRIES) {
          return undefined;
        }
        return Promise.all(
          keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES).map((key) => cache.delete(key))
        );
      })
    )
    .catch(() => undefined);
}

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
// from the network, not a possibly stale local copy — except under /_assets/,
// where the filename contains a content hash and a local copy therefore
// cannot be stale. Letting the HTTP cache answer those is worth 14 requests /
// 438,036 B on a first visit, because the page has just downloaded most of
// them and 'reload' forced a second trip to the network for every one.
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
    const cacheMode = path.startsWith('/_assets/') ? 'default' : 'reload';
    return fetch(new Request(path, { cache: cacheMode }))
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
// shell's CSS, JS and fonts so a single visit is enough for a styled,
// hydrated offline render. Imagery is deliberately not primed here (see
// HTML_ASSET_PATTERN); it is cached as the visitor actually loads it.
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
      .then(trimRuntimeCache)
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
    const key = cacheKey(url);
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const runtimeCopy = response.clone();
            // waitUntil keeps the worker alive until the write lands: the UA
            // may terminate it as soon as respondWith settles, and a rejected
            // put (quota) would otherwise be an unhandled rejection.
            event.waitUntil(
              caches
                .open(RUNTIME_CACHE)
                .then((cache) => cache.put(key, runtimeCopy))
                .then(trimRuntimeCache)
                .catch(() => undefined)
            );

            // Keep the app-shell copy of '/' fresh too — otherwise the
            // install-time snapshot in CACHE_NAME can shadow newer runtime
            // copies when caches.match() runs in the fallback below.
            if (url.pathname === '/') {
              const shellCopy = response.clone();
              event.waitUntil(
                caches
                  .open(CACHE_NAME)
                  .then((cache) => cache.put('/', shellCopy))
                  .catch(() => undefined)
              );
            }
          }
          return response;
        })
        .catch(() =>
          // Cached copy of the requested page, else the offline page — never
          // another page's content masquerading under the requested URL.
          // Matched on the normalised key so /?utm_source=x resolves to the
          // stored copy of '/' rather than falling through to offline.html.
          caches.match(key).then((cached) => cached || offlineFallback())
        )
    );
    return;
  }

  // Content-hashed assets under /_assets/: cache-first forever. The hash in
  // the filename changes whenever the content does, so a cached copy can
  // never be stale.
  if (url.pathname.startsWith('/_assets/')) {
    const key = cacheKey(url);
    event.respondWith(
      caches.match(key).then((cachedResponse) => {
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
            event.waitUntil(
              caches
                .open(RUNTIME_CACHE)
                .then((cache) => cache.put(key, responseToCache))
                .catch(() => undefined)
            );

            return response;
          })
          .catch(() => Response.error());
      })
    );
    return;
  }

  // A query string on an unhashed subresource is a deliberate cache-buster —
  // the three dashboards fetch './data/listings.json?v=' + Date.now() exactly
  // so that no layer answers from a cache. Honour that: pass it straight to
  // the network, uncached. (Storing it was pure loss anyway — a timestamped
  // key can never be read back, so every load minted a permanent entry that
  // bought nothing.)
  if (url.search) {
    return;
  }

  // Unhashed same-origin assets (public/ images, icons, manifest, robots…):
  // stale-while-revalidate. Serve the cache for speed/offline, but refresh in
  // the background so a replaced file reaches returning visitors without a
  // manual CACHE_VERSION bump.
  const key = cacheKey(url);
  event.respondWith(
    caches.open(RUNTIME_CACHE).then((cache) =>
      cache.match(key).then((cachedResponse) => {
        // cache:'no-cache' makes the refresh revalidate with the server —
        // a plain fetch could be answered by still-"fresh" HTTP cache entries,
        // which would defeat the revalidation half of stale-while-revalidate.
        const networkRefresh = fetch(request, { cache: 'no-cache' }).then((response) => {
          const contentType = response && response.headers.get('content-type');
          const isHtml = contentType && contentType.includes('text/html');
          if (response && response.status === 200 && response.type === 'basic' && !isHtml) {
            // Called synchronously inside this handler, i.e. before the
            // response reaches respondWith, so the event is still active and
            // the copy is guaranteed a chance to finish.
            event.waitUntil(cache.put(key, response.clone()).catch(() => undefined));
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
