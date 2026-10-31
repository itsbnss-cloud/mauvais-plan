import { defineConfig } from 'vite';

const SERVER_PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/socket.io': { target: `http://localhost:${SERVER_PORT}`, ws: true },
    },
  },
});
