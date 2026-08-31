/**
 * Registers the service worker that makes Ruvik installable and lets it open
 * without a connection.
 *
 * Deliberately does NOT call skipWaiting. Forcing an update reloads the page
 * out from under whoever is using it, and this app is full of half-finished
 * quotes, invoices and job notes. A new build therefore waits, takes over the
 * next time the app is opened cold, and `onUpdateReady` lets the UI say so.
 *
 * Returns a cleanup function, and is a no-op where service workers are
 * unavailable — a private window, an insecure origin, or the dev server.
 */
export function registerServiceWorker(onUpdateReady: () => void): () => void {
  // Dev is served unbundled and unhashed; a precache there would only serve
  // stale modules and hide the very changes being worked on.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return () => undefined;
  }

  let cancelled = false;

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      if (cancelled) return;

      // A worker already waiting means a build landed during a previous visit.
      if (registration.waiting && navigator.serviceWorker.controller) {
        onUpdateReady();
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // A controller already exists, so this is an update rather than the
          // very first install — that one should stay silent.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdateReady();
          }
        });
      });
    } catch {
      // An unregistrable worker costs offline support, nothing else. The app
      // works exactly as it did before.
    }
  };

  // Registration competes with the first data fetches for bandwidth, so it
  // waits until the page has finished loading.
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', register, { once: true });

  return () => {
    cancelled = true;
    window.removeEventListener('load', register);
  };
}
