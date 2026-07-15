import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The server serves the client build + REST /api + WebSocket /ws on ONE origin.
// On a free Render dyno a cold start means the shell itself is unavailable, so a
// plain browser shows a blank page for ~30s. The service worker below precaches
// the static shell so the app opens INSTANTLY (even offline / while Render wakes)
// and then falls back to the app's existing "honest states" + localStorage
// last-known-good for data. See the VitePWA block for why /api is NOT cached.
const isCapacitor = !!process.env.CAP_BUILD;

// Vite dev server proxies /api (REST) and /ws (WebSocket) to the Node server
// so the client can use same-origin relative paths in development.
export default defineConfig({
  // Capacitor serves the bundled web app from a custom scheme, so assets must be
  // referenced relatively. Set CAP_BUILD=1 for the mobile build; desktop/web
  // (served at the origin root) keep absolute '/'.
  base: isCapacitor ? './' : '/',
  plugins: [
    react(),
    // Service workers don't run under Capacitor's custom scheme (capacitor://),
    // so the PWA is only wired up for the web/desktop build, never the APK/IPA.
    ...(isCapacitor
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate', // new SW takes over silently on next load
            includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
            manifest: {
              id: '/',
              name: 'PT Financial Advisor',
              short_name: 'PT Finance',
              description:
                'Multi-asset portfolio dashboard — Thai & US stocks, ETFs, crypto, and gold with live prices, charts, dividends, and FX.',
              theme_color: '#0b0e14',
              background_color: '#0b0e14',
              display: 'standalone',
              start_url: '/',
              scope: '/',
              lang: 'en',
              categories: ['finance', 'productivity'],
              icons: [
                { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
                {
                  src: 'pwa-maskable-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
              ],
            },
            workbox: {
              // Precache the static shell (hashed JS/CSS/HTML + icons) but NOT
              // the ~1.9 MiB tfjs bundle (its own `tfjs-vendor` chunk, reachable
              // only via the on-demand Forecast panel) — precaching it would bloat
              // the install for a feature most users never open. It loads on
              // demand when online. Task 4.5 slims tfjs further.
              globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
              globIgnores: ['**/tfjs-vendor-*.js'],
              cleanupOutdatedCaches: true,
              clientsClaim: true,
              // SPA fallback: any navigation not matching a precached file serves
              // index.html — EXCEPT API/WebSocket paths, which must always hit the
              // network. We deliberately do NOT runtime-cache /api: live prices
              // flow over /ws and the app already persists last-known-good in
              // localStorage with honest freshness states. Caching /api here would
              // let the SW serve stale prices behind the app's back.
              navigateFallback: 'index.html',
              navigateFallbackDenylist: [/^\/api/, /^\/ws/],
            },
            // Keep the SW out of `vite dev` — it only complicates local iteration.
            devOptions: { enabled: false },
          }),
        ]),
  ],
  build: {
    rollupOptions: {
      output: {
        // Split rarely-changing vendor code into its own chunks so an app edit
        // doesn't invalidate the cached React / charting bytes. (tfjs is left
        // alone — it's already dynamically imported into the Forecast chunk.)
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) {
            return 'react-vendor';
          }
          if (id.includes('lightweight-charts')) return 'charts-vendor';
          // Keep tfjs in a stable-named chunk so the service worker can exclude it
          // from the precache (globIgnores). Only reached via dynamic import, so
          // this stays lazy — the name just becomes predictable.
          if (id.includes('@tensorflow')) return 'tfjs-vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true
      }
    }
  }
});
