/**
 * Playwright configuration (ADR-0024, TASK-004): Chromium, Firefox and WebKit at 360 px and 1280 px (NFR-COMPAT-001/002).
 * Project names follow TEST-STRATEGY §7.8 (`<engine>-mobile` = 360 x 780, `<engine>-desktop` = 1280 x 800). The mobile
 * projects use touch descriptors so the `pointer-coarse:` 44 px targets are exercised; Firefox has no `isMobile`, so it
 * gets the viewport plus `hasTouch` only (documented limitation, D-QA-005). The 390 px projects arrive with T-QA-05.
 *
 * The suite runs against the production builds (`npm run build` first), served by support/static-server.ts with the
 * routing of the Nginx templates. Ports stay below the Windows dynamic range (49152+), and a server already listening
 * there is never reused: it could be another checkout's build.
 */
import { defineConfig, devices } from '@playwright/test';

import { ADMIN_BASE_URL, ADMIN_PORT, WEB_BASE_URL, WEB_PORT } from './support/servers.js';

const CI = process.env['CI'] !== undefined;
/** Whole-run cap in CI (lane C shards run one engine; WebKit with --repeat-each=5). */
const GLOBAL_TIMEOUT_MS = 20 * 60_000;
const JUNIT_FILE = process.env['E2E_JUNIT_FILE'] === '' ? undefined : process.env['E2E_JUNIT_FILE'];

const MOBILE_VIEWPORT = { width: 360, height: 780 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: CI,
  // Lanes B and C retry once to detect flakiness only (TEST-STRATEGY §11); local runs never retry.
  retries: CI ? 1 : 0,
  // PR #4 R3-n6 (COND-E2E-FF): a run-wide cap in CI, so a browser that hangs on close (seen with WebKit) fails the job
  // with Playwright's 'Timed out waiting ... for the test suite to run' instead of running into the job timeout.
  globalTimeout: CI ? GLOBAL_TIMEOUT_MS : 0,
  // Lane C writes a JUnit report per shard when E2E_JUNIT_FILE is set (tools/quality/inventory.mjs reads it).
  reporter: CI
    ? [['list'], ['html', { open: 'never' }], ...(JUNIT_FILE === undefined ? [] : [['junit', { outputFile: JUNIT_FILE }] as const])]
    : 'list',
  use: {
    baseURL: WEB_BASE_URL,
    trace: 'retain-on-failure',
    locale: 'en-GB',
  },
  projects: [
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'], viewport: MOBILE_VIEWPORT } },
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: DESKTOP_VIEWPORT } },
    { name: 'firefox-mobile', use: { ...devices['Desktop Firefox'], viewport: MOBILE_VIEWPORT, hasTouch: true } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'], viewport: DESKTOP_VIEWPORT } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 15'], viewport: MOBILE_VIEWPORT } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], viewport: DESKTOP_VIEWPORT } },
  ],
  webServer: [
    {
      command: `node support/static-server.ts web ${WEB_PORT}`,
      url: `${WEB_BASE_URL}/en/`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `node support/static-server.ts admin ${ADMIN_PORT}`,
      url: `${ADMIN_BASE_URL}/`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
