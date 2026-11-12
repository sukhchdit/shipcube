import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const tscCli = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

/**
 * A two-workspace solution shaped like the repository (root `files: []` + references, a package
 * consumed by an app) whose projects extend the real `tsconfig.base.json`.
 */
function solutionFixture(appSource: string): string {
  const root = mkdtempSync(join(tmpdir(), 'typecheck-'));
  const write = (rel: string, content: string) => {
    const path = join(root, ...rel.split('/'));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  };
  const base = join(repoRoot, 'tsconfig.base.json').replaceAll('\\', '/');
  const project = (refs: string[]) =>
    JSON.stringify({
      extends: base,
      // `types: []`: the fixture has no node_modules, so @types/node is not resolvable here.
      compilerOptions: { rootDir: 'src', outDir: 'dist', types: [] },
      include: ['src'],
      references: refs.map((path) => ({ path })),
    });
  write('package.json', JSON.stringify({ name: 'fixture', private: true, type: 'module' }));
  write('tsconfig.json', JSON.stringify({ files: [], references: [{ path: 'packages/lib' }, { path: 'apps/app' }] }));
  write('packages/lib/package.json', JSON.stringify({ name: 'lib', private: true, type: 'module' }));
  write('packages/lib/tsconfig.json', project([]));
  write('packages/lib/src/index.ts', 'export const answer = (): number => 42;\n');
  write('apps/app/package.json', JSON.stringify({ name: 'app', private: true, type: 'module' }));
  write('apps/app/tsconfig.json', project(['../../packages/lib']));
  write('apps/app/src/index.ts', appSource);
  return root;
}

describe('root scripts (US-001, REQ-PLAT-003)', () => {
  const fixtures: string[] = [];
  afterAll(() => fixtures.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it.each([
    'lint',
    'format:check',
    'typecheck',
    'test:unit',
    'test:integration',
    'test:api',
    'test:e2e',
    'test:coverage',
    'build',
    'deps:rebuild',
  ])('[AT-US-001-04] root script "%s" exists', (name) => {
    expect(rootPkg.scripts[name]).toEqual(expect.any(String));
  });

  const typecheck = (source: string) => {
    const [bin, ...args] = (rootPkg.scripts['typecheck'] ?? '').split(' ');
    expect(bin).toBe('tsc');
    const dir = solutionFixture(source);
    fixtures.push(dir);
    return runNode([tscCli, ...args], { cwd: dir });
  };

  it('[AT-US-001-04] typecheck exits non-zero when a workspace has a type error', () => {
    const result = typecheck("import { answer } from '../../../packages/lib/src/index.js';\nexport const wrong: string = answer();\n");
    expect(result.stdout).toContain('error TS2322');
    expect(result.status).not.toBe(0);
  });

  it('[AT-US-001-04] typecheck exits zero on the same solution without the defect (control)', () => {
    const result = typecheck("import { answer } from '../../../packages/lib/src/index.js';\nexport const right: number = answer();\n");
    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  });
});
