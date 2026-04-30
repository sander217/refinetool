// Builds the iframe-host (parent panel) as a standalone web app — separate
// from the Chrome extension build (vite.config.ts).
//
// Run after `vite build --config vite.companion.config.ts` so the companion
// bundle is present in public/ and gets copied into the final dist.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: 'dist-iframe',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/iframe/host.html'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    open: '/src/iframe/host.html',
  },
});
