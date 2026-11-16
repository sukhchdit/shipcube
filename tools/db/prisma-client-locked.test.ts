// `@platform/prisma/client` resolves under the prisma-tree read lock in every Jest project (TASK-288 = TASK-W0-FLAKE-2;
// D-ORCH-083, D-ORCH-098 residual, D-ARCH-137; NFR-MAINT-002): a Jest setup (moduleNameMapper), never per-suite
// boilerplate. The writer is a real child process holding PRISMA_TREE_LOCK the way withFileLock takes it; the assertion
// is about order (its `released` marker exists when the import returns), never elapsed time.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, jest } from '@jest/globals';

import config from '../../jest.config.js';
import { lockPath, PRISMA_TREE_LOCK } from '../test-support/fs-lock.js';
import { LockChildren, WRITER } from '../test-support/lock-children.js';
import { findRepoRoot } from '../test-support/process.js';

jest.setTimeout(120_000);

const SHIM = '<rootDir>/tools/db/prisma-client-locked.cjs';
const scratch = mkdtempSync(join(tmpdir(), 'shipqube-prisma-lock-'));
const children = new LockChildren(scratch);

afterEach(() => children.killAll());
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('@platform/prisma/client resolves under the prisma-tree read lock (D-ORCH-098 residual)', () => {
  it('every Jest project maps @platform/prisma/client to the locking shim', () => {
    const projects = (config.projects ?? []) as { displayName?: unknown; moduleNameMapper?: Record<string, unknown> }[];

    const unmapped = projects
      .filter((project) => project.moduleNameMapper?.['^@platform/prisma/client$'] !== SHIM)
      .map((project) => project.displayName);

    expect(projects.length).toBeGreaterThan(0);
    expect(unmapped).toEqual([]);
  });

  it('a suite that resolves @platform/prisma/client while another process holds PRISMA_TREE_LOCK waits for the release', async () => {
    const { ready, released } = children.markers();
    await children.start(WRITER, [lockPath(PRISMA_TREE_LOCK), ready, released, '400'], ready);

    let client: { PrismaClient?: unknown } = {};
    await jest.isolateModulesAsync(async () => {
      client = await import('@platform/prisma/client');
    });

    expect(existsSync(released)).toBe(true);
    expect(typeof client.PrismaClient).toBe('function');
  });

  it('the shim is a pass-through: it returns the generated client module itself', async () => {
    let viaShim: unknown;
    let direct: unknown;
    await jest.isolateModulesAsync(async () => {
      viaShim = await import('@platform/prisma/client');
      // The `@platform/source` target by absolute path: the same module record the shim loads.
      direct = await import(join(findRepoRoot(), 'prisma', 'generated', 'prisma', 'client.ts'));
    });

    expect(viaShim).toBe(direct);
  });
});
