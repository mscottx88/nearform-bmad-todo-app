import { defineConfig, devices } from '@playwright/test';

// Two run modes:
//   1. **Local dev** — set up via `make dev-db && (cd backend && uv run uvicorn ...)`
//      separately, then `npx playwright test`. The webServer hook below
//      starts the Vite dev server on :5173.
//   2. **Compose stack / CI** — `docker compose up --build`, then
//      `PLAYWRIGHT_BASE_URL=http://localhost:8080 npx playwright test`.
//      The PLAYWRIGHT_BASE_URL env var skips the webServer hook entirely
//      so the tests hit the running stack.
//
// In both modes, a backend reachable from the SPA is required — the
// E2E tests exercise real CRUD flows through the API. They do NOT
// stub the network.

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const useExternalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Skip webServer when PLAYWRIGHT_BASE_URL is set — CI / compose-stack
  // runs already have the stack up.
  webServer: useExternalServer
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
