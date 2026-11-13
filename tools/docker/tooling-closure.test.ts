/**
 * The tooling image (prisma/Dockerfile) runs the seed and bootstrap from TypeScript sources through the
 * @platform/source condition, so it must ship the package.json and src/ of every @platform workspace package the
 * prisma workspace reaches. TASK-020 made @platform/authz import @platform/shared, and the seed one-shot failed with
 * ERR_MODULE_NOT_FOUND in the image (TASK-014 stack run 7); this test fails on such drift without building an image.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
});
