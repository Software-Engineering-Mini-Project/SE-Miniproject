// E2E smoke suite (STP v1.0 §5.1, TC-E2E-01). Runs against the production build
// (`npm run build` first). In mock mode no backend is needed; the same specs run
// against the real API once NEXT_PUBLIC_API_MODE=http is set at build time.

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT) || 3100;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
