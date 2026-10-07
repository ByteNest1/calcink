import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests drive the production build (with its service worker) in Chromium
 * using real mouse input. Set CHROMIUM_PATH to use a pre-installed browser,
 * otherwise run `npx playwright install chromium` once.
 */
const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 } }],
  webServer: {
    command: 'npm run build && npm run preview -- --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
