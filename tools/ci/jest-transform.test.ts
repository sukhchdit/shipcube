/**
 * PR17-SEC-01: an unowned `.swcrc` cannot change how Jest suites compile. jest.config.ts passes the @swc/jest options
 * inline with `swcrc: false` (no `<cwd>/.swcrc` read by @swc/jest, no nearest-`.swcrc` lookup by @swc/core), and the
 * base-ref lint fixture config (tools/lint/jest.base-fixtures.config.json) carries the same transform.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import config, { SWC_JEST_OPTIONS } from '../../jest.config.js';
import { findRepoRoot } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const TRANSFORM_KEY = '^.+\\.(t|j)sx?$';

interface SwcJestTransformer {
  process: (source: string, filename: string, options: Record<string, unknown>) => { code: string };
}
const { createTransformer } = createRequire(join(repoRoot, 'package.json'))('@swc/jest') as {
  createTransformer: (options?: Record<string, unknown>) => SwcJestTransformer;
};

/** The `require(...)` specifiers in compiled output. */
const requiresOf = (code: string): string[] => [...code.matchAll(/require\("([^"]+)"\)/gu)].map((match) => match[1] ?? '');

describe('PR17-SEC-01: Jest compiles with inline @swc/jest options and ignores .swcrc files', () => {
  it('every Jest project uses @swc/jest with the inline options, and they set swcrc: false', () => {
    const projects = (config.projects ?? []).map((project) => (typeof project === 'string' ? {} : project));
    expect(projects.length).toBeGreaterThan(0);
    for (const project of projects) expect(project.transform).toEqual({ [TRANSFORM_KEY]: ['@swc/jest', SWC_JEST_OPTIONS] });
    expect(SWC_JEST_OPTIONS.swcrc).toBe(false);
  });

  it('the base-ref lint fixture config carries the same transform', () => {
    const baseConfig = JSON.parse(readFileSync(join(repoRoot, 'tools', 'lint', 'jest.base-fixtures.config.json'), 'utf8')) as {
      transform: unknown;
    };
    expect(baseConfig.transform).toEqual({ [TRANSFORM_KEY]: ['@swc/jest', SWC_JEST_OPTIONS] });
  });

  it('a planted nested .swcrc mapping @jest/globals to a shim changes nothing (positive control: it would without swcrc: false)', () => {
    const root = mkdtempSync(join(tmpdir(), 'swcrc-'));
    try {
      mkdirSync(join(root, 'tools', 'lint'), { recursive: true });
      const redirect = { jsc: { baseUrl: '.', paths: { '@jest/globals': ['./shim'] } } };
      writeFileSync(join(root, '.swcrc'), JSON.stringify(redirect));
      writeFileSync(join(root, 'tools', '.swcrc'), JSON.stringify(redirect));
      const file = join(root, 'tools', 'lint', 'a.test.ts');
      const source = "import { it } from '@jest/globals';\nit('x', () => {});\n";
      writeFileSync(file, source);
      const compile = (options: Record<string, unknown>) =>
        requiresOf(createTransformer(options).process(source, file, { supportsStaticESM: false, instrument: false, config: {} }).code);

      expect(compile(SWC_JEST_OPTIONS)).toEqual(['@jest/globals']);
      const withoutSwcrcFalse: Record<string, unknown> = { ...SWC_JEST_OPTIONS };
      delete withoutSwcrcFalse['swcrc'];
      expect(compile(withoutSwcrcFalse)).toEqual(['../shim']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
