/**
 * PR4-SEC-08 residual (TASK-015 part 015-B; COND-E2E-FF): `npm run deps:rebuild` refuses an inherited Playwright browser
 * download redirect when it is asked to install browsers, before any step runs (the Prisma engine redirects were already
 * refused; Playwright's were not).
 */
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { plan, playwrightRedirects } from './rebuild.mjs';

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

  it('the CLI exits 1 before any step with a redirect set and a browser requested', () => {
    for (const name of ['PLAYWRIGHT_DOWNLOAD_HOST', 'PLAYWRIGHT_WEBKIT_DOWNLOAD_HOST']) {
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
