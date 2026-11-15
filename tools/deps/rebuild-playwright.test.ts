/**
 * PR4-SEC-08 residual (TASK-015 part 015-B; COND-E2E-FF): `npm run deps:rebuild` refuses an inherited Playwright browser
 * download redirect when it is asked to install browsers, before any step runs (the Prisma engine redirects were already
 * refused; Playwright's were not).
 */
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { PLAYWRIGHT_HOST } from '../ci/check-workflow-policy.mjs';
import { PLAYWRIGHT_REDIRECT, plan, playwrightRedirects } from './rebuild.mjs';

const repoRoot = findRepoRoot();
const script = join(repoRoot, 'tools', 'deps', 'rebuild.mjs');

describe('deps:rebuild Playwright download redirects (PR4-SEC-08)', () => {
  it('names every redirect variable, any case, only when the plan installs browsers', () => {
    const steps = plan(['--playwright=firefox']);
    const env = {
      PLAYWRIGHT_DOWNLOAD_HOST: 'x',
      playwright_webkit_download_host: 'x',
      PLAYWRIGHT_FIREFOX_DOWNLOAD_HOST: 'x',
      PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: '',
      PLAYWRIGHT_BROWSERS_PATH: 'x',
      PLAYWRIGHT_DOWNLOAD_HOSTS: 'x',
    };
    expect(playwrightRedirects(env, steps)).toEqual([
      'PLAYWRIGHT_DOWNLOAD_HOST',
      'PLAYWRIGHT_FIREFOX_DOWNLOAD_HOST',
      'playwright_webkit_download_host',
    ]);
    expect(playwrightRedirects(env, plan([]))).toEqual([]);
  });

  it('[PR46-SEC-02] [review m3] the npm channels Playwright reads are redirects too: npm_config_* (.npmrc) and npm_package_config_* (package.json "config"), any case', () => {
    const steps = plan(['--playwright=webkit']);
    const env = {
      npm_config_playwright_download_host: 'x',
      npm_package_config_playwright_webkit_download_host: 'x',
      NPM_CONFIG_PLAYWRIGHT_DOWNLOAD_HOST: 'x',
      npm_config_playwright_browsers_path: 'x',
      npm_config_registry: 'x',
    };
    expect(playwrightRedirects(env, steps)).toEqual([
      'NPM_CONFIG_PLAYWRIGHT_DOWNLOAD_HOST',
      'npm_config_playwright_download_host',
      'npm_package_config_playwright_webkit_download_host',
    ]);
    expect(PLAYWRIGHT_REDIRECT.source).toBe(PLAYWRIGHT_HOST.source);
    expect(PLAYWRIGHT_REDIRECT.flags).toBe(PLAYWRIGHT_HOST.flags);
  });

  it('the CLI exits 1 before any step with a redirect set and a browser requested', () => {
    for (const name of [
      'PLAYWRIGHT_DOWNLOAD_HOST',
      'PLAYWRIGHT_WEBKIT_DOWNLOAD_HOST',
      'npm_config_playwright_download_host',
      'npm_package_config_playwright_webkit_download_host',
    ]) {
      const r = runNode([script, '--playwright=webkit'], {
        cwd: repoRoot,
        env: { ...process.env, [name]: 'https://mirror.example.invalid' },
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`Playwright download redirect(s) set in the environment: ${name} (PR4-SEC-08)`);
      expect(r.stdout).not.toContain('[deps:rebuild] bcrypt');
    }
  });
});
