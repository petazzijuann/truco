import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  /**
   * The workspace packages export TypeScript source, so they must be bundled in --
   * Node cannot load them at runtime. Everything from npm stays external and is
   * installed next to the bundle (see the Dockerfile).
   */
  noExternal: [/^@truco\//],
});
