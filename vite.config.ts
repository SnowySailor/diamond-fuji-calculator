import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 4778,
    strictPort: true,
    // Bind mounts on macOS don't deliver fs events into the container.
    watch: { usePolling: true, interval: 300 },
  },
  build: {
    // MapLibre is one ~1.1 MB chunk, loaded after the page has rendered.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Ship MapLibre's worker as .js: servers don't all send .mjs as JavaScript (nginx's
        // defaults don't), and browsers won't start a module worker served as anything else.
        assetFileNames: (a) =>
          a.names[0]?.endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    environment: 'node',
  },
});
