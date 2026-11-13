/**
 * Jest configuration ownership and manual-mock isolation (PR4-SEC-11 / PR #4 R3-M1 generalisation, PR17-SEC-09; TASK-015).
 * Every repository path jest.config.ts hands to Jest (test environments, setup files, moduleNameMapper targets,
 * transform modules, global setup/teardown, resolvers, reporters) must fall under a CODEOWNERS pattern, and a planted
 * `__mocks__/<pkg>.js` under the roots must not replace the real module.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import config, { MODULE_PATH_IGNORE_PATTERNS } from '../../jest.config.js';
import { ownedPaths, parseCodeowners } from '../ci/check-security-owned-paths.mjs';
import { findRepoRoot } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Config keys whose values name modules Jest loads (a string, an array of strings, or `[module, options]` tuples). */
const MODULE_KEYS = [
  'testEnvironment',
  'setupFiles',
  'setupFilesAfterEnv',
  'globalSetup',
  'globalTeardown',
  'resolver',
  'snapshotResolver',
  'testRunner',
  'testSequencer',
  'runner',
  'dependencyExtractor',
  'reporters',
  'watchPlugins',
  'prettierPath',
] as const;

function modulesOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) =>
    typeof item === 'string' ? [item] : Array.isArray(item) && typeof item[0] === 'string' ? [item[0]] : [],
  );
}

/**
 * Repository-relative paths a Jest config (and its projects) references. `<rootDir>/x` and `./x` are repository paths;
 * a bare name (`node`, `@swc/jest`) is an installed package; a mapper target with a capture (`$1`) stays relative to
 * the importing file, which the tree's own ownership covers.
 */
function referencedPaths(cfg: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const add = (spec: string) => {
    if (spec.includes('$')) return;
    if (spec.startsWith('<rootDir>/')) out.add(spec.slice('<rootDir>/'.length));
    else if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) out.add(spec.replace(/^\.\//, ''));
  };
  const visit = (c: Record<string, unknown>) => {
    for (const key of MODULE_KEYS) modulesOf(c[key]).forEach(add);
    for (const target of Object.values((c['moduleNameMapper'] ?? {}) as Record<string, unknown>)) modulesOf(target).forEach(add);
    for (const target of Object.values((c['transform'] ?? {}) as Record<string, unknown>)) modulesOf(target).forEach(add);
    for (const project of (c['projects'] ?? []) as unknown[])
      if (typeof project === 'object' && project !== null) visit(project as Record<string, unknown>);
  };
  visit(cfg);
  return [...out].sort();
}

const codeowners = parseCodeowners(readFileSync(join(repoRoot, '.github', 'CODEOWNERS'), 'utf8'));
const unowned = (paths: string[]) => paths.filter((p) => ownedPaths([p], codeowners).length === 0);

describe('Jest configuration ownership and manual mocks (PR4-SEC-11, PR17-SEC-09)', () => {
  it('[PR4-SEC-11] every repository path jest.config.ts references is under a CODEOWNERS pattern', () => {
    const paths = referencedPaths(config);
    expect(paths).toEqual(
      expect.arrayContaining(['tools/test-dom/jsdom-environment.mjs', 'tools/test-dom/dom-setup.ts', 'tools/test-dom/style-stub.ts']),
    );
    expect(unowned(paths)).toEqual([]);
  });

  it('[PR4-SEC-11] fixture: a config whose testEnvironment points to an unowned folder fails', () => {
    const fixture = {
      projects: [
        { testEnvironment: '<rootDir>/apps/web/test-env/env.mjs', setupFiles: ['./scratch/setup.ts'] },
        { transform: { '^.+\\.ts$': ['<rootDir>/tools/test-dom/x.mjs', {}] }, moduleNameMapper: { a: '$1', b: 'node' } },
      ],
    };
    expect(referencedPaths(fixture)).toEqual(['apps/web/test-env/env.mjs', 'scratch/setup.ts', 'tools/test-dom/x.mjs']);
    expect(unowned(referencedPaths(fixture))).toEqual(['apps/web/test-env/env.mjs', 'scratch/setup.ts']);
  });

  it('[PR17-SEC-09] modulePathIgnorePatterns hides __mocks__ in every project and in the base-ref fixture config', () => {
    expect(MODULE_PATH_IGNORE_PATTERNS).toEqual(['<rootDir>/.*/dist/', '<rootDir>/.*/build/', '/__mocks__/']);
    for (const project of (config.projects ?? []) as Array<{ modulePathIgnorePatterns?: string[] }>)
      expect(project.modulePathIgnorePatterns).toEqual(MODULE_PATH_IGNORE_PATTERNS);
    const base = JSON.parse(readFileSync(join(repoRoot, 'tools', 'lint', 'jest.base-fixtures.config.json'), 'utf8')) as {
      modulePathIgnorePatterns?: string[];
    };
    expect(base.modulePathIgnorePatterns).toEqual(MODULE_PATH_IGNORE_PATTERNS);
    expect(ownedPaths(['apps/x/__mocks__/pg.js', '__mocks__/pg.js', 'packages/a/src/__mocks__/b.ts'], codeowners)).toHaveLength(3);
  });

  /** A Jest run in a temp tree with node_modules/fake-pkg (real) and apps/x/__mocks__/fake-pkg.js (planted). */
  function plantedRun(patterns: readonly string[]): { status: number | null; output: string } {
    const root = mkdtempSync(join(tmpdir(), 'jest-mocks-'));
    temps.push(root);
    mkdirSync(join(root, 'node_modules', 'fake-pkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'fake-pkg', 'package.json'), '{"name":"fake-pkg","version":"1.0.0","main":"index.js"}\n');
    writeFileSync(join(root, 'node_modules', 'fake-pkg', 'index.js'), "module.exports = 'real';\n");
    mkdirSync(join(root, 'apps', 'x', '__mocks__'), { recursive: true });
    writeFileSync(join(root, 'apps', 'x', '__mocks__', 'fake-pkg.js'), "module.exports = 'planted';\n");
    writeFileSync(
      join(root, 'apps', 'x', 'probe.test.js'),
      "test('resolves fake-pkg', () => { expect(require('fake-pkg')).toBe('real'); });\n",
    );
    const cfg = {
      rootDir: root,
      roots: ['<rootDir>/apps'],
      testEnvironment: 'node',
      transform: {},
      cache: false,
      watchman: false,
      modulePathIgnorePatterns: patterns,
    };
    writeFileSync(join(root, 'jest.config.json'), JSON.stringify(cfg));
    const result = spawnSync(
      process.execPath,
      [join(repoRoot, 'node_modules', 'jest', 'bin', 'jest.js'), '--config', join(root, 'jest.config.json'), '--ci'],
      { cwd: root, encoding: 'utf8', timeout: 120_000, windowsHide: true },
    );
    if (result.error !== undefined) throw result.error;
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  it('[PR17-SEC-09] a planted <tmp>/apps/x/__mocks__/<pkg>.js does not replace the real module', () => {
    const guarded = plantedRun(MODULE_PATH_IGNORE_PATTERNS);
    expect([guarded.status, guarded.output]).toEqual([0, expect.stringContaining('1 passed')]);
    // Negative control: without the /__mocks__/ pattern Jest serves the planted file, so the guard is what holds.
    const open = plantedRun(['<rootDir>/.*/dist/', '<rootDir>/.*/build/']);
    expect(open.status).toBe(1);
    expect(open.output).toContain('"planted"');
  });
});
