// Builds the iframe companion as a single IIFE bundle that the host can
// fetch and inject into the artifact iframe. Output goes to public/ so the
// iframe-host vite dev server (and the production build) serves it at
// `/companion.iife.js`.
import { defineConfig } from 'vite';

export default defineConfig({
  // public/ is *also* this build's outDir; tell vite not to treat it as the
  // dev publicDir to silence the warning.
  publicDir: false,
  build: {
    outDir: 'public',
    emptyOutDir: false,
    lib: {
      entry: 'src/iframe/companion.ts',
      name: 'IFLCompanion',
      formats: ['iife'],
      fileName: () => 'companion.iife.js',
    },
    rollupOptions: {
      output: {
        // No external; bundle everything (dom.ts, overlay.ts, types).
        extend: true,
      },
    },
    sourcemap: true,
    minify: false,
  },
});
