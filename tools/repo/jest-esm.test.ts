/**
 * Why the Jest scripts run `node --experimental-vm-modules … jest.js` (SPK-01 §2, deviation 2; ADR-0024): @swc/jest
 * transpiles tests and sources to CommonJS, so every import becomes `require()`, and ESM-only runtime dependencies
 * such as `jose` and `uuid` load only through Jest's `require(esm)` support, which needs the vm-modules flag.
 * Removing the flag makes this suite fail before any feature test does (PR #1 review m3).
 */
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import { SignJWT, jwtVerify } from 'jose';
import { v7 as uuidv7, version as uuidVersion } from 'uuid';

import { groupJestArgs } from '../ci/coverage-run.mjs';
import { findRepoRoot } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const scripts = (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;

describe('Jest loads ESM-only runtime dependencies (--experimental-vm-modules)', () => {
  it('[--experimental-vm-modules] every root Jest script passes the flag', () => {
    const jestScripts = Object.entries(scripts).filter(([, command]) => command.includes('jest'));
    expect(jestScripts.map(([name]) => name).sort()).toEqual([
      'test:api',
      'test:contract',
      'test:generated',
      'test:integration',
      'test:unit',
    ]);
    const withoutFlag = jestScripts.filter(([, command]) => !command.startsWith('node --experimental-vm-modules '));
    expect(withoutFlag).toEqual([]);
    // test:coverage runs one Jest process per project group (tools/ci/coverage-run.mjs, D-ORCH-047); each passes the flag.
    expect(scripts['test:coverage']).toBe('node tools/ci/coverage-run.mjs');
    expect(groupJestArgs({ projects: ['unit'], inBand: false }, { coverageDir: 'c', testTimeoutMs: 1, reportFile: 'r' })[0]).toBe(
      '--experimental-vm-modules',
    );
  });

  it('[--experimental-vm-modules] uuid (ESM-only) generates a version 7 id', () => {
    const id = uuidv7();
    expect(uuidVersion(id)).toBe(7);
  });

  it('[--experimental-vm-modules] jose (ESM-only) signs and verifies a JWT', async () => {
    // A random per-run key: nothing secret-shaped is committed.
    const key = webcrypto.getRandomValues(new Uint8Array(32));
    const token = await new SignJWT({ sub: 'user-1' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1m').sign(key);
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    expect(payload.sub).toBe('user-1');
  });
});
