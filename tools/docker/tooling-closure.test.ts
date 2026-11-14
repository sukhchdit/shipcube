/**
 * The tooling image (prisma/Dockerfile) runs the seed and bootstrap from TypeScript sources through the
 * @platform/source condition, so it must ship the package.json and src/ of every @platform workspace package the
 * prisma workspace reaches. TASK-020 made @platform/authz import @platform/shared, and the seed one-shot failed with
 * ERR_MODULE_NOT_FOUND in the image (TASK-014 stack run 7); this test fails on such drift without building an image.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';

const root = findRepoRoot();
const manifest = (path: string): { dependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };

/** @platform package names reachable from the prisma workspace through `dependencies`. */
function platformClosure(): string[] {
  const seen = new Set<string>();
  const visit = (path: string): void => {
    for (const name of Object.keys(manifest(path).dependencies ?? {})) {
      if (!name.startsWith('@platform/') || seen.has(name)) continue;
      seen.add(name);
      visit(join('packages', name.slice('@platform/'.length)));
    }
  };
  visit('prisma');
  return [...seen].sort();
}

describe('tooling image source closure (TASK-014)', () => {
  it('copies package.json and src/ of every @platform package the prisma workspace reaches', () => {
    const dockerfile = readFileSync(join(root, 'prisma', 'Dockerfile'), 'utf8');
    const closure = platformClosure();
    expect(closure).toEqual(expect.arrayContaining(['@platform/authz', '@platform/config', '@platform/shared']));
    const missing = closure.flatMap((name) => {
      const dir = `packages/${name.slice('@platform/'.length)}`;
      return [`COPY ${dir}/package.json ${dir}/`, `COPY ${dir}/src/ ${dir}/src/`].filter((line) => !dockerfile.includes(line));
    });
    expect(missing).toEqual([]);
  });

  it('[D-ARCH-117] installs the prisma workspace without the root, and prunes to its own dev closure', () => {
    const dockerfile = readFileSync(join(root, 'prisma', 'Dockerfile'), 'utf8');
    const install = /npm ci [^\n]*/.exec(dockerfile)?.[0] ?? '';
    expect(install).toContain('--workspace=prisma');
    expect(install).toContain('--include=dev');
    expect(install).not.toContain('--include-workspace-root');
    expect(dockerfile).toMatch(/node tools\/docker\/prune-deps\.mjs --dev (?:--leaf \S+ )*prisma\b/);
    // The stubs written by prune-migrate-image.mjs are leaves, so the real packages' dependencies do not stay.
    expect(dockerfile).toMatch(/--leaf node_modules\/@prisma\/studio-core\b/);
    expect(dockerfile).toMatch(/--leaf node_modules\/@prisma\/dev\b/);
    const stub = dockerfile.indexOf('node tools/docker/prune-migrate-image.mjs --stub-studio');
    expect(stub).toBeGreaterThan(-1);
    expect(stub).toBeLessThan(dockerfile.indexOf('node tools/docker/prune-deps.mjs --dev'));
  });

  it('[D-ARCH-117] every package the image runs from source is in the prisma workspace closure', () => {
    const prisma = JSON.parse(readFileSync(join(root, 'prisma', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    // Bare imports of the image's TypeScript entry points must be installable from the prisma workspace: its
    // dependencies, its own devDependencies (the Prisma CLI, tsx) or a dependency of a reached @platform package.
    const available = new Set([
      ...Object.keys(prisma.dependencies ?? {}),
      ...Object.keys(prisma.devDependencies ?? {}),
      ...platformClosure().flatMap((name) => Object.keys(manifest(join('packages', name.slice('@platform/'.length))).dependencies ?? {})),
    ]);
    expect([...available]).toEqual(expect.arrayContaining(['prisma', 'tsx', 'pg']));
    const sources = [
      'prisma.config.ts',
      ...['bootstrap', 'check-tooling-env', 'scram', 'sql-text', 'shadow-init', 'audit-external-tables'].map(
        (name) => `tools/db/${name}.ts`,
      ),
      ...readdirSync(join(root, 'prisma', 'seed'), { recursive: true, encoding: 'utf8' })
        .map((rel) => `prisma/seed/${rel.split(sep).join('/')}`)
        .filter((rel) => rel.endsWith('.ts') && !rel.endsWith('.test.ts') && !rel.includes('/tests/')),
    ];
    const bare = new Set<string>();
    for (const rel of sources) {
      const text = readFileSync(join(root, rel), 'utf8');
      for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"./][^'"]*)['"]/g)) {
        const specifier = match[1] ?? '';
        if (specifier.startsWith('node:')) continue;
        const parts = specifier.split('/');
        bare.add(specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? ''));
      }
    }
    expect(bare.size).toBeGreaterThan(0);
    expect([...bare].filter((name) => !available.has(name)).sort()).toEqual([]);
  });
});
