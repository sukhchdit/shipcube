/**
 * TASK-003 acceptance (ADR-0023 am. J item 2, verification paragraph): "`npm run deps:rebuild` regenerates the Prisma
 * client with scripts disabled" runs with an EMPTY engine directory and no PRISMA_* variables. The engine is fetched
 * from the fixed origin and verified against tools/deps/prisma-engines.json (SEC-TC-64 real run).
 *
 * Integration lane, not unit: it deletes and re-fetches the real engine (network, about 20 MB) and regenerates the
 * real client. It holds PRISMA_TREE_LOCK, which the Testcontainers harness and the unit real-run tests also take.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { engineFileName, locateInstall, readManifest } from './prisma-engines.mjs';
import { PRISMA_TREE_LOCK, withFileLock } from '../test-support/fs-lock.js';
import { findRepoRoot, runNpm } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

describe('deps:rebuild from an empty engine directory (SEC-TC-64, ADR-0023 am. J item 2)', () => {
  it('[SEC-TC-64] npm run deps:rebuild with scripts disabled, no PRISMA_* variables and an empty engine directory fetches, verifies and regenerates', async () => {
    const manifest = readManifest(join(repoRoot, 'tools', 'deps', 'prisma-engines.json'));
    const { enginesDir } = locateInstall(repoRoot);
    const generatedClient = join(repoRoot, 'prisma', 'generated', 'prisma', 'client.ts');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PRISMA_|DEPS_REBUILD_)/i.test(key)));

    await withFileLock(PRISMA_TREE_LOCK, () => {
      for (const name of readdirSync(enginesDir).filter((file) => file.startsWith('schema-engine'))) rmSync(join(enginesDir, name));
      expect(readdirSync(enginesDir).filter((file) => file.startsWith('schema-engine'))).toEqual([]);
      const ignoreScripts = runNpm(['config', 'get', 'ignore-scripts'], { cwd: repoRoot, env });
      expect(ignoreScripts.stdout.trim()).toBe('true');

      const started = Date.now();
      const result = runNpm(['run', 'deps:rebuild'], { cwd: repoRoot, env, timeoutMs: 300_000 });
      expect(result.stderr).not.toContain('[deps:rebuild]');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`[prisma-engines] fetching ${manifest.source}${manifest.enginesVersion}/`);
      expect(result.stdout).toMatch(/\[deps:rebuild\] prisma-engines: .* verified \(fetched\)/);
      expect(result.stdout).toContain('Generated Prisma Client');

      const files = readdirSync(enginesDir).filter((file) => file.startsWith('schema-engine'));
      expect(files).toHaveLength(1);
      const target = (files[0] as string).replace(/^schema-engine-/, '').replace(/\.exe$/, '');
      expect(files[0]).toBe(engineFileName(target));
      expect(sha256(readFileSync(join(enginesDir, files[0] as string)))).toBe(manifest.schemaEngine[target]?.sha256);
      if (process.platform !== 'win32') expect(statSync(join(enginesDir, files[0] as string)).mode & 0o777).toBe(0o755);
      expect(statSync(generatedClient).mtimeMs).toBeGreaterThanOrEqual(started - 2_000);
    });
  }, 360_000);
});
