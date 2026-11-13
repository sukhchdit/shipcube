import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { listManifests } from './workspaces.js';

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
    'quality:check-evidence',
  ])('[AT-US-001-04] root script "%s" exists', (name) => {
    expect(rootPkg.scripts[name]).toEqual(expect.any(String));
  });

  const typecheck = (source: string) => {
    // `npm run typegen && tsc -b`: React Router route types are generated first (TASK-004); the fixture runs the tsc part.
    const tscCommand = (rootPkg.scripts['typecheck'] ?? '').split('&&').at(-1)?.trim() ?? '';
    const [bin, ...args] = tscCommand.split(' ');
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

/**
 * The fixture above proves the mechanism (`tsc -b` fails on an error in a referenced project). These checks tie
 * "a type error in any workspace" (AT-US-001-04) to the repository itself: `npm run typecheck` builds the root
 * solution file, so a workspace missing from its `references`, or a project that includes nothing, would drop out
 * of type-checking with every other test still green (PR #1 review M2).
 */
describe('the typecheck solution reaches every workspace (AT-US-001-04)', () => {
  interface TsProject {
    files?: string[];
    include?: string[];
    references?: Array<{ path: string }>;
  }
  const readProject = (dir: string): TsProject =>
    JSON.parse(readFileSync(join(repoRoot, ...dir.split('/'), 'tsconfig.json'), 'utf8')) as TsProject;
  const normalize = (path: string) => path.replace(/^\.\//, '').replace(/\/+$/, '');

  /** Projects outside the npm workspaces that the solution must still type-check. */
  // tests/api and tests/contract-stubs are test-only folders without a manifest (TASK-017), like tests/fixtures.
  const NON_WORKSPACE_PROJECTS = ['tools', 'tests/api', 'tests/contract-stubs'];
  const workspaceDirs = listManifests(repoRoot)
    .map(({ dir }) => dir)
    .filter((dir) => dir !== '.');
  const solution = readProject('.');
  const referenced = (solution.references ?? []).map(({ path }) => normalize(path));

  it('[AT-US-001-04] every workspace has a tsconfig.json', () => {
    expect(workspaceDirs.length).toBeGreaterThan(0);
    const missing = workspaceDirs.filter((dir) => !existsSync(join(repoRoot, ...dir.split('/'), 'tsconfig.json')));
    expect(missing).toEqual([]);
  });

  it('[AT-US-001-04] the root tsconfig.json references exactly the workspaces plus tools, once each', () => {
    expect(new Set(referenced).size).toBe(referenced.length);
    expect([...referenced].sort()).toEqual([...workspaceDirs, ...NON_WORKSPACE_PROJECTS].sort());
  });

  it('[AT-US-001-04] the root solution compiles nothing itself, so every file belongs to a referenced project', () => {
    expect(solution.files).toEqual([]);
    expect(solution.include).toBeUndefined();
  });

  it('[AT-US-001-04] every referenced project includes something (non-empty include or files)', () => {
    const empty = referenced.filter((dir) => {
      const project = readProject(dir);
      return (project.include ?? []).length === 0 && (project.files ?? []).length === 0;
    });
    expect(empty).toEqual([]);
  });
});
