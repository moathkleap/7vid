import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Serves/builds the renderer as a plain web app for browser development mode and end-to-end tests. */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  define: { 'import.meta.env.VITE_DEVBRIDGE_URL': JSON.stringify(process.env.SEVENVID_DEVBRIDGE_URL ?? '') },
  server: { port: Number(process.env.SEVENVID_WEB_PORT ?? 5177), strictPort: true, host: '127.0.0.1' },
  build: { outDir: resolve(__dirname, 'out/browser'), emptyOutDir: true },
});
