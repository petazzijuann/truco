import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Where the dev proxy forwards `/ws`.
 *
 * Only used by a plain `pnpm dev`, where Vite and the Fastify server are two
 * separate local processes. In production -- and under `vercel dev` -- the two are
 * one origin and the platform routes `/ws` to the server service, so this proxy is
 * never consulted. `TRUCO_SERVER_URL` is here so a non-default local port does not
 * need a code change.
 */
const serverOrigin = process.env.TRUCO_SERVER_URL ?? 'http://localhost:3000';
const wsOrigin = serverOrigin.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: wsOrigin, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
