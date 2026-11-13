/**
 * Test seams stay out of production code (PR34-SEC-01; NFR-PERF-006, D-TASK276-03). The Prisma query counter
 * (apps/api/src/platform/db/query-counter.ts) is mounted by tests only: no non-test source under apps/*\/src imports it,
 * statically, through `export ... from`, `import()` or `require`. The `db-test-seam` boundaries policy in eslint.config.mjs
 * is the lint-time arm of the same rule; this scan is the tripwire that needs no lint configuration.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';

const repoRoot = findRepoRoot();

/** Module specifiers that resolve to a test seam (with or without the NodeNext `.js` / `.ts` extension). */
const SEAM_SPECIFIER = /(?:^|\/)query-counter(?:\.(?:js|ts))?$/;
/** `from '...'`, `import('...')`, `require('...')` and a bare `import '...'`. */
const SPECIFIERS = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g;
const TEST_FILE = /\.test\.tsx?$|(?:^|\/)(?:test|tests|__tests__)\//;

/** Specifiers in `source` that name a test seam. */
function seamImports(source: string): string[] {
  return [...source.matchAll(SPECIFIERS)].map((match) => match[2] ?? '').filter((specifier) => SEAM_SPECIFIER.test(specifier));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'dist' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('test seams', () => {
  it('finds a seam import in every import form (positive control)', () => {
    const planted = [
      "import { withQueryCounter } from './platform/db/query-counter.js';",
      "export { createQueryCounter } from '../db/query-counter';",
      "const seam = await import('./platform/db/query-counter.ts');",
      "const legacy = require('../platform/db/query-counter.js');",
      "import './platform/db/query-counter.js';",
    ].join('\n');
    expect(seamImports(planted)).toHaveLength(5);
    expect(seamImports("import { counter } from './query-counters.js'; import x from './db/my-query-counter.js';")).toEqual([]);
  });

  it('no non-test source under apps/*/src imports the Prisma query counter', () => {
    const appsDir = join(repoRoot, 'apps');
    const offenders = readdirSync(appsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const src = join(appsDir, entry.name, 'src');
        try {
          return sourceFiles(src);
        } catch {
          return [];
        }
      })
      .map((path) => relative(repoRoot, path).split(sep).join('/'))
      .filter((path) => !TEST_FILE.test(path))
      .filter((path) => seamImports(readFileSync(join(repoRoot, ...path.split('/')), 'utf8')).length > 0);
    expect(offenders).toEqual([]);
  });
});
