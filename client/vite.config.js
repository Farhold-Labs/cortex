import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import viteCompression from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    react(),
    // Generate .gz pre-compressed files alongside every asset
    viteCompression({ algorithm: 'gzip', deleteOriginFile: false }),
    // Generate .br pre-compressed files (brotli — ~20% smaller than gzip)
    viteCompression({ algorithm: 'brotliCompress', ext: '.br', deleteOriginFile: false }),
  ],
  build: {
    // Emit manifest so the post-build script can inject asset URLs into sw.js
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React core — changes rarely, earns a long browser cache life
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor-react';
          }
          // LiveKit (~800KB) — only loaded in voice calls, split so main bundle loads faster
          if (id.includes('node_modules/livekit-client') || id.includes('node_modules/@livekit')) {
            return 'vendor-livekit';
          }
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
