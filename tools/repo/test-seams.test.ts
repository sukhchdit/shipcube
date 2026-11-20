/**
 * Test seams stay out of production code (PR34-SEC-01; NFR-PERF-006, D-TASK276-03). The Prisma query counter
 * (apps/api/src/platform/db/query-counter.ts) is mounted by tests only: no non-test source under apps/*\/src imports it,
 * statically, through `export ... from`, `import()` or `require`. The `db-test-seam` boundaries policy in eslint.config.mjs
 * is the lint-time arm of the same rule; this scan is the tripwire that needs no lint configuration. PR043-SEC-02 adds
 * the outbox test factory and the catalogue-parameterised writer module (only the outbox barrel imports it); its
 * resolved-file boundaries twin waits for the next lint-lock holder (code review R2-C5).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';

const repoRoot = findRepoRoot();

/**
 * Module specifiers that resolve to a test seam (with or without the NodeNext `.js` / `.ts` extension): the Prisma query
 * counter, the outbox test factory (`tests/test-outbox`) and the api test subpath that serves it (`@platform/api/testing`,
 * PR043-SEC-02).
 */
const SEAM_SPECIFIER = /(?:^|\/)(?:query-counter|test-outbox)(?:\.(?:js|ts))?$|^@platform\/api\/testing(?:\/.*)?$/;
/** The outbox writer module, whose `createOutbox` takes any catalogue (PR043-SEC-02, code review m5). */
const OUTBOX_WRITER = 'apps/api/src/platform/outbox/writer';
/** The only production files that may import the writer module: the outbox barrel (it re-exports `outbox` only). */
const OUTBOX_WRITER_IMPORTERS: ReadonlySet<string> = new Set(['apps/api/src/platform/outbox/index.ts']);
/** `from '...'`, `import('...')`, `require('...')` and a bare `import '...'`. */
const SPECIFIERS = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g;
const TEST_FILE = /\.test\.tsx?$|(?:^|\/)(?:test|tests|__tests__)\//;

/** Specifiers in `source` that name a test seam. */
function seamImports(source: string): string[] {
  return [...source.matchAll(SPECIFIERS)].map((match) => match[2] ?? '').filter((specifier) => SEAM_SPECIFIER.test(specifier));
}

/**
 * Specifiers in `source` (of the repository-relative POSIX `file`) that resolve to the outbox writer module: a relative
 * specifier resolved against the file, or a deep specifier ending in `platform/outbox/writer` (PR043-SEC-02).
 */
function writerImports(file: string, source: string): string[] {
  return [...source.matchAll(SPECIFIERS)]
    .map((match) => match[2] ?? '')
    .filter((specifier) => {
      const target = specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(file), specifier)) : specifier;
      const bare = target.replace(/\.(?:js|ts)$/, '');
      return bare === OUTBOX_WRITER || /(?:^|\/)platform\/outbox\/writer$/.test(bare);
    });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'dist' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Every non-test source under apps/*\/src, repository-relative POSIX paths. */
function productionSources(): string[] {
  const appsDir = join(repoRoot, 'apps');
  return readdirSync(appsDir, { withFileTypes: true })
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
    .filter((path) => !TEST_FILE.test(path));
}

const read = (path: string): string => readFileSync(join(repoRoot, ...path.split('/')), 'utf8');

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

  it('[PR043-SEC-02] finds an outbox test-factory import in every import form (positive control)', () => {
    const planted = [
      "import { createTestOutbox } from '../outbox/tests/test-outbox.js';",
      "export { createTestOutbox } from './tests/test-outbox';",
      "const seam = await import('@platform/api/testing');",
      "const legacy = require('@platform/api/testing/outbox');",
      "import '../platform/outbox/tests/test-outbox.ts';",
    ].join('\n');
    expect(seamImports(planted)).toHaveLength(5);
    expect(seamImports("import { x } from './test-outboxes.js'; import y from '@platform/api/testingx';")).toEqual([]);
  });

  it('[PR043-SEC-02] finds a writer import in every form and spelling (positive control)', () => {
    const file = 'apps/api/src/modules/orders/service/orders.service.ts';
    const planted = [
      "import { createOutbox } from '../../../platform/outbox/writer.js';",
      "export { createOutbox } from '../../../platform/outbox/writer';",
      "const w = await import('../../../platform/outbox/writer.ts');",
      "const r = require('@platform/api/src/platform/outbox/writer.js');",
      "import '../../../platform/outbox/../outbox/writer.js';",
    ].join('\n');
    expect(writerImports(file, planted)).toHaveLength(5);
    expect(writerImports(file, "import { outbox } from '../../../platform/outbox/index.js'; import { w } from './writer.js';")).toEqual([]);
    // The barrel's own relative import is found too (it is the allow-listed importer).
    expect(writerImports('apps/api/src/platform/outbox/index.ts', "export { outbox } from './writer.js';")).toHaveLength(1);
  });

  it('no non-test source under apps/*/src imports a test seam (the Prisma query counter, the outbox test factory)', () => {
    expect(productionSources().filter((path) => seamImports(read(path)).length > 0)).toEqual([]);
  });

  it('[PR043-SEC-02] no non-test source under apps/*/src but the outbox barrel imports the outbox writer module', () => {
    const offenders = productionSources()
      .filter((path) => !OUTBOX_WRITER_IMPORTERS.has(path) && `${OUTBOX_WRITER}.ts` !== path)
      .filter((path) => writerImports(path, read(path)).length > 0);
    expect(offenders).toEqual([]);
    // The scan is not vacuous: the barrel is seen importing the writer.
    expect(writerImports('apps/api/src/platform/outbox/index.ts', read('apps/api/src/platform/outbox/index.ts'))).toHaveLength(1);
  });
});
