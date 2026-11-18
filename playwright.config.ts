import { defineConfig } from '@playwright/test';

// Every run starts its own server, because the server builds the app once at start and a server left running
// would serve an old build. Two runs at the same time need different ports: set E2E_PORT on one of them.
const PORT = Number(process.env.E2E_PORT ?? 3217);

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  // The lag test times frames, so it must have the machine to itself: CI runs it in a pass of its own with one
  // worker (scripts/ci.ts sets E2E_FEEL to 'skip' for the main pass). Beside another worker it measured that
  // worker's load, a 67 ms frame where ten runs alone gave 17 to 33 ms.
  testIgnore: process.env.E2E_FEEL === 'skip' ? '**/feel.e2e.ts' : [],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 2,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // A tap blocked by a window fails in 15 s and names what is in the way, rather than hanging until the test timeout.
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    // A machine with its own Chromium (a cloud box) names it here. Without it Playwright uses the one it installed.
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {},
  },
  webServer: {
    command: 'bun server.ts',
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
  },
});
