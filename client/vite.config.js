import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: { '/ws': { target: 'ws://localhost:4600', ws: true } },
    fs: { allow: [path.resolve(root, '..')] },
  },
  build: { outDir: path.resolve(root, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
