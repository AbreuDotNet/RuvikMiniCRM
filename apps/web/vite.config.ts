import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Files the bundle does not list at the point this plugin runs: everything
 * copied verbatim from public/, plus index.html, which Vite's own HTML plugin
 * emits in a later hook. index.html is the service worker's offline
 * navigation fallback, so leaving it out would silently break the one thing
 * offline support exists for.
 */
const STATIC_ASSETS = [
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

/**
 * Emits dist/sw.js from sw-template.js with the real, content-hashed asset
 * names substituted in. The service worker has to know those names to precache
 * them, and they only exist once Rollup has produced the bundle.
 *
 * The cache name is derived from that same list, so a build whose output did
 * not change keeps its cache instead of forcing every client to refetch.
 */
function serviceWorker(): Plugin {
  return {
    name: 'ruvik-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const emitted = Object.keys(bundle)
        // Source maps are for debugging, not worth an offline download.
        .filter((name) => !name.endsWith('.map'))
        .map((name) => `/${name}`);

      const precache = ['/', ...emitted, ...STATIC_ASSETS].sort();
      const version = createHash('sha256')
        .update(precache.join('|'))
        .digest('hex')
        .slice(0, 12);

      const templatePath = fileURLToPath(new URL('sw-template.js', import.meta.url));
      // replaceAll, not replace: a stray mention of a placeholder anywhere in
      // the template would otherwise consume the substitution and leave the
      // real declaration untouched, shipping a worker that throws on load.
      const source = readFileSync(templatePath, 'utf8')
        .replaceAll('__VERSION__', version)
        .replaceAll('__PRECACHE__', JSON.stringify(precache, null, 2));

      if (source.includes('__VERSION__') || source.includes('__PRECACHE__')) {
        this.error('service worker template still has unsubstituted placeholders');
      }

      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// The dev server proxies the API so the browser sees one origin, which keeps
// the refresh cookie first-party. `preview` needs the same treatment: it
// serves the production build, and that is the only way to exercise the
// service worker, which never registers in dev.
const apiProxy = {
  '/api': { target: 'http://localhost:4000', changeOrigin: true },
};

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: { vendor: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
});
