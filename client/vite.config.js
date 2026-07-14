import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev server proxies /api (REST) and /ws (WebSocket) to the Node server
// so the client can use same-origin relative paths in development.
export default defineConfig({
  // Capacitor serves the bundled web app from a custom scheme, so assets must be
  // referenced relatively. Set CAP_BUILD=1 for the mobile build; desktop/web
  // (served at the origin root) keep absolute '/'.
  base: process.env.CAP_BUILD ? './' : '/',
  plugins: [react()],
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
