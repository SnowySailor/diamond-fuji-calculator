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
  test: {
    environment: 'node',
  },
});
