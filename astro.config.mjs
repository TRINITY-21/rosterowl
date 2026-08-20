import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';
import AstroPWA from '@vite-pwa/astro';
import { cspHeaders } from './tools/csp/integration.mjs';
import { redirects } from './tools/redirects/integration.mjs';

export default defineConfig({
  site: 'https://rosterowl.com',
  build: {
    // Astro's default inlines small scoped <style> blocks into the HTML, which
    // meant 21 style hashes in the Content-Security-Policy. External stylesheets
    // are covered by a bare `style-src 'self'`, keeping the header far under
    // Cloudflare's 2,000-character _headers line limit — and they cache across
    // pages instead of being re-sent with every document.
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      rollupOptions: {
        output: {
          // Without this, pdfjs-dist lands in a chunk named "pdf" — the same
          // name Vite gives src/lib/pdf.ts, the seating chart's own renderer.
          // The service worker below has to treat the two very differently, so
          // they must be told apart by something better than a hashed filename.
          manualChunks: (id) => (id.includes('node_modules/pdfjs-dist') ? 'pdfjs' : undefined),
        },
      },
    },
  },
  integrations: [
    svelte(),
    sitemap(),
    AstroPWA({
      // 'prompt', not 'autoUpdate': a teacher mid-way through building a chart
      // should not have the page swapped under them. Layout.astro offers the
      // reload instead, and the swap happens when they say so.
      registerType: 'prompt',
      // Registration is hand-rolled in Layout.astro so the update prompt costs
      // no Svelte island on the static marketing and SEO pages.
      injectRegister: false,
      // public/site.webmanifest is already the source of truth.
      manifest: false,
      workbox: {
        globDirectory: 'dist',
        globPatterns: [
          '**/*.{html,js,mjs,css,svg,ico,webmanifest}',
          // Screen faces.
          'fonts/*.woff2',
          // Embedded into every generated PDF — miss these and the tools look
          // like they work offline right up until someone presses Download.
          // Baloo2-Variable.ttf is deliberately absent: it is only a fallback
          // for browsers without woff2, and it is 683 KB.
          'fonts/AtkinsonHyperlegible-Regular.ttf',
          'fonts/AtkinsonHyperlegible-Bold.ttf',
          'fonts/Baloo2-Display.ttf',
          'apple-touch-icon.png',
          'icon-*.png',
        ],
        // pdf.js is 1.6 MB and serves one optional button ("Copy image"), so it
        // is fetched on first use and cached then, rather than charged to every
        // first visit on a school connection. pdf-lib stays precached — building
        // a PDF offline is the entire point of the feature.
        globIgnores: ['**/pdf.worker.min*.mjs', '**/pdfjs*.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/_astro\/(pdfjs|pdf\.worker)/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'rosterowl-pdfjs',
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Keeps entries as "seating-chart/index.html".
        //
        // Supplying any manifestTransforms replaces vite-plugin-pwa's default
        // one, which rewrites "seating-chart/index.html" to "seating-chart" —
        // and that is the point of having this. Astro's directory build links to
        // "/seating-chart/", and Workbox resolves a trailing-slash request by
        // appending its directoryIndex ("index.html"). Against the stripped
        // URLs nothing matches, so every navigation quietly falls through to the
        // network and offline fails at precisely the moment it should work.
        //
        // tests/smoke-offline.mjs is what catches this if it ever regresses.
        manifestTransforms: [
          (entries) => ({
            manifest: entries.map((entry) =>
              // navigateFallback points at /404.html, so that one keeps its name.
              entry.url === '404' ? { ...entry, url: '404.html' } : entry,
            ),
            warnings: [],
          }),
        ],
        // Unknown routes while offline land on the 404 page, which lists every
        // tool — a better dead end than the browser's dinosaur.
        navigateFallback: '/404.html',
        // /api/* MUST be denied, not merely uncached. navigateFallback makes the
        // service worker answer *every* navigation it has no route for with the
        // 404 page — and signing in is a navigation (location.href to
        // /api/auth/google/start, then Google navigating back to the callback).
        // Without this the worker swallows both hops and the teacher lands on
        // "That page flew off" having never reached the network. It is invisible
        // to curl, which does not run service workers.
        // Three exclusions, and the third is the general case the first two are
        // instances of: navigateFallback answers *every* navigation the worker
        // has no route for with the 404 page, so anything that is not a page
        // has to be excluded explicitly or it silently becomes "That page flew
        // off". /api/ broke Google sign-in that way; the extension rule catches
        // sitemap-index.xml, robots.txt and every file added later, without
        // anyone having to remember this rule exists.
        //
        // Real pages are directory routes ending in "/", so they never match.
        navigateFallbackDenylist: [/^\/_astro\//, /^\/api\//, /\/[^/?]+\.[a-z0-9]+$/i],
        cleanupOutdatedCaches: true,
      },
    }),
    // cspHeaders runs last: it hashes the inline scripts the other integrations
    // have finished emitting.
    cspHeaders(),
    redirects(),
  ],
});
