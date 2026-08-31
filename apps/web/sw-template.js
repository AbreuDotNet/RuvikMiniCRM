/* ==========================================================================
   Ruvik service worker

   Written by hand rather than generated, because what this file must NOT do
   matters more than what it does: it caches the application shell and nothing
   else. Every byte of business data stays on the network.

   The cache version and the precache list below are placeholders; the
   serviceWorker() plugin in vite.config.ts fills them in at build time, once
   it knows the content-hashed asset filenames. Editing this file by hand is
   safe; editing the built dist/sw.js is not, it is overwritten every build.
   ========================================================================== */

const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `ruvik-shell-${VERSION}`;

/** The navigation fallback: the SPA entry point, served when offline. */
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Each build gets its own cache name, so anything else is a past build.
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Every precache lookup ignores Vary.
 *
 * The entries are stored from plain URL strings, so they carry no request
 * headers. A server that answers with `Vary: Origin` — anything with CORS
 * enabled, including Vite's own preview server — then makes those entries
 * unmatchable for the requests that actually matter: Vite marks its module
 * scripts and stylesheet `crossorigin`, so the browser sends an Origin header
 * with them and the Vary comparison fails. The result is an app that looks
 * cached but serves a blank page offline, because every asset misses.
 *
 * Ignoring Vary is safe here precisely because these URLs are content-hashed:
 * one URL has exactly one representation, so there is nothing to vary on.
 */
const matchPrecache = (request) => caches.match(request, { ignoreVary: true });

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await matchPrecache(SHELL);
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function cacheFirst(request) {
  const cached = await matchPrecache(request);
  if (cached) return cached;
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Anything that changes state has to reach the server, always.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the API. It answers with quotes, invoices, client records and
  // audit entries scoped to whoever is signed in; a Cache Storage entry
  // outlives the session, is readable by any script on this origin, and would
  // survive a sign-out or a change of user on a shared device. Letting these
  // fall through means they are never stored at all.
  if (url.pathname.startsWith('/api/')) return;

  // A navigation prefers fresh HTML and falls back to the cached shell, so a
  // deep link still opens the app with no connection. React Router then
  // renders the route, and the screens report their own network failures.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Build assets carry a content hash in the filename, so a cache hit can
  // never be stale: a changed file is a different URL.
  event.respondWith(cacheFirst(request));
});
