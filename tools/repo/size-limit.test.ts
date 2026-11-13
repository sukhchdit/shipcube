/**
 * TASK-004 acceptance: "size-limit budgets configured and enforced in `npm run build`" (NFR-WEB-004, ADR-0026).
 * The budgets live in `.size-limit.json`; `npm run build` ends with `npm run size`, so a budget overrun fails the build.
 * The enforcement itself is proven against a fixture file (no app build needed): the real CLI with the real
 * `@size-limit/file` plugin exits non-zero when the file exceeds its limit and zero when it fits.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';

interface SizeLimitCheck {
  name?: string;
  path: string;
  gzip?: boolean;
  limit?: string;
}

const repoRoot = findRepoRoot();
const sizeLimitCli = join(repoRoot, 'node_modules', 'size-limit', 'bin.js');
const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
const checks = JSON.parse(readFileSync(join(repoRoot, '.size-limit.json'), 'utf8')) as SizeLimitCheck[];

describe('size-limit budgets (TASK-004, NFR-WEB-004)', () => {
  const fixtures: string[] = [];
  afterAll(() => fixtures.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  /** Runs the size-limit CLI from the repository root (where its plugin is declared) against a temporary config. */
  function runWithLimit(limit: string) {
    const dir = mkdtempSync(join(tmpdir(), 'size-limit-'));
    fixtures.push(dir);
    writeFileSync(join(dir, 'bundle.js'), `export const payload = ${JSON.stringify('x'.repeat(2048))};\n`);
    writeFileSync(join(dir, '.size-limit.json'), JSON.stringify([{ name: 'fixture', path: 'bundle.js', limit }]));
    return runNode([sizeLimitCli, '--config', join(dir, '.size-limit.json')], { cwd: repoRoot });
  }

  it('`npm run build` runs the size check after the workspace builds', () => {
    expect(rootPkg.scripts['size']).toBe('size-limit');
    expect(rootPkg.scripts['build']).toMatch(/&& npm run size$/);
  });

  it('every check has a limit and measures gzip output of a built web or admin client bundle', () => {
    expect(checks.map(({ path }) => path).sort()).toEqual([
      'apps/admin/build/client/assets/*.css',
      'apps/admin/build/client/assets/*.js',
      'apps/web/build/client/assets/*.css',
      'apps/web/build/client/assets/*.js',
    ]);
    for (const check of checks) {
      expect(check.limit).toMatch(/^\d+(\.\d+)? kB$/);
      expect(check.gzip).toBe(true);
    }
  });

  it('negative: the CLI exits non-zero when a file exceeds its budget', () => {
    const result = runWithLimit('1 B');
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/Size limit has exceeded|exceeded/i);
  });

  it('the CLI exits zero when the file fits its budget', () => {
    const result = runWithLimit('10 kB');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
