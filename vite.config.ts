import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the build works from any sub-path (GitHub Pages, Netlify, file servers).
  base: './',
  worker: { format: 'es' },
  optimizeDeps: {
    // ORT ships its own ESM/WASM loader; pre-bundling breaks its asset resolution.
    exclude: ['onnxruntime-web'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // The ORT WASM binary is ~14 MB; it's loaded lazily by the worker, not on the critical path.
    chunkSizeWarningLimit: 1000,
  },
  // 5280 avoids clashing with other Vite apps on the default 5173.
  server: { port: 5280, strictPort: false, host: true },
  preview: { port: 4173, host: true },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.svg', 'icons/*.png', 'models/*.onnx'],
      manifest: {
        name: 'CalcInk — Handwritten Math',
        short_name: 'CalcInk',
        description: 'Write math by hand; answers appear inline. 100% on-device and offline.',
        theme_color: '#f7f3ea',
        background_color: '#f7f3ea',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,wasm,onnx}'],
        globIgnores: ['**/*.map'],
        // The WASM runtime must be precached for airplane-mode operation.
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
