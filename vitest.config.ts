import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/engine', 'packages/ai', 'apps/server', 'apps/web'],
  },
});
