import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  /* The ai deliberately takes 600-1800ms to answer, like a person would, so a test
     that plays several turns is minutes of real table time, not milliseconds. */
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry' },
  // One real server, serving the real build: the e2e exercises the same bundle that
  // ships, over the same websocket protocol.
  webServer: {
    command: 'pnpm build && PORT=4173 node apps/server/dist/main.js',
    url: 'http://localhost:4173/health',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
});
