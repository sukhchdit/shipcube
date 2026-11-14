/**
 * prune-dist.mjs (TASK-014; platform.md §3.2 prod-deps/runtime rows, SPK-01 F-13): compiled tests and fixtures never
 * reach an image; production node_modules lose docs, maps, declarations and the non-PostgreSQL Prisma compilers.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { main, prune, shouldRemove } from './prune-dist.mjs';

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('prune-dist rules', () => {
  it.each([
    ['platform/db/client.test.js', false, {}, true],
    ['platform/db/client.test.d.ts', false, {}, true],
    ['platform/db/client.test.js.map', false, {}, true],
    ['modules/quotes/__fixtures__', true, {}, true],
    ['modules/quotes/tests', true, {}, true],
    // D-ARCH-115 / WAVE-00 sheet line 545 (R1-M1, PR39-SEC-01): the routing test seams go with their directory.
    ['platform/routing/tests', true, {}, true],
    // The file rule alone keeps a non-`.test.` file; only the directory rule above removes it.
    ['platform/routing/tests/fixture-route.js', false, {}, false],
    ['fixtures', true, {}, true],
    ['spikes', true, {}, true],
    ['.tsbuildinfo', false, {}, true],
    ['platform/db/client.js', false, {}, false],
    ['platform/db/client.js.map', false, {}, false],
    ['platform/db/client.d.ts', false, {}, false],
    ['platform/db/client.d.ts', false, { declarations: true }, true],
    ['platform/db/client.d.ts.map', false, { declarations: true }, true],
    ['pg/README.md', false, { nodeModules: true }, true],
    ['pg/LICENSE.md', false, { nodeModules: true }, false],
    ['pg/lib/index.js.map', false, { nodeModules: true }, true],
    ['pg/lib/index.d.ts', false, { nodeModules: true }, true],
    ['pg/lib/index.js', false, { nodeModules: true }, false],
    ['some-pkg/tests', true, { nodeModules: true }, false],
    ['some-pkg/lib/x.test.js', false, { nodeModules: true }, true],
    // PR #34 security checkpoint: the TASK-276 query counter (a test seam) never reaches an image.
    ['platform/db/query-counter.js', false, {}, true],
    ['platform/db/query-counter.js.map', false, {}, true],
    ['platform/db/query-counter.d.ts', false, {}, true],
    ['platform/db/query-counters.js', false, {}, false],
    ['platform/db/client.js', false, {}, false],
    ['@prisma/client/runtime/query_compiler_fast_bg.mysql.wasm-base64.mjs', false, { nodeModules: true }, true],
    ['@prisma/client/runtime/query_compiler_small_bg.sqlserver.js', false, { nodeModules: true }, true],
    ['@prisma/client/runtime/query_compiler_fast_bg.cockroachdb.mjs', false, { nodeModules: true }, true],
    ['@prisma/client/runtime/query_compiler_fast_bg.sqlite.wasm-base64.js', false, { nodeModules: true }, true],
    ['@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.mjs', false, { nodeModules: true }, false],
    ['@prisma/client/runtime/query_compiler_fast_bg.postgresql.mjs', false, { nodeModules: true }, false],
    ['@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.js', false, { nodeModules: true }, true],
    ['@prisma/client/runtime/query_compiler_fast_bg.postgresql.js', false, { nodeModules: true }, true],
    ['@prisma/client/runtime/query_compiler_small_bg.postgresql.wasm-base64.mjs', false, { nodeModules: true }, true],
    ['@prisma/client/runtime/query_compiler_small_bg.postgresql.mjs', false, { nodeModules: true }, true],
    ['@prisma/client/runtime/client.mjs', false, { nodeModules: true }, false],
    ['@prisma/client/runtime/query_compiler_small_bg.postgresql.mjs', false, {}, false],
    ['@prisma/client/runtime/client.mjs', false, { nodeModules: true }, false],
  ] as const)('%s (dir=%s, %j) -> remove=%s', (rel, isDir, options, expected) => {
    expect(shouldRemove(rel, isDir, options)).toBe(expected);
  });
});

describe('prune-dist on a directory', () => {
  it('removes the matches, keeps code and never follows symbolic links', () => {
    const root = mkdtempSync(join(tmpdir(), 'prune-dist-'));
    temps.push(root);
    for (const rel of ['dist/main.js', 'dist/main.test.js', 'dist/a/__fixtures__/f.json', 'dist/a/b.js', 'dist/.tsbuildinfo']) {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), '');
    }
    expect(prune(join(root, 'dist'))).toBe(3);
    expect(existsSync(join(root, 'dist', 'main.js'))).toBe(true);
    expect(existsSync(join(root, 'dist', 'a', 'b.js'))).toBe(true);
    expect(existsSync(join(root, 'dist', 'main.test.js'))).toBe(false);
    expect(existsSync(join(root, 'dist', 'a', '__fixtures__'))).toBe(false);
  });

  it('[D-ARCH-115] removes dist/platform/routing/tests (fixture route, loopback) and keeps define-route.js', () => {
    const root = mkdtempSync(join(tmpdir(), 'prune-dist-routing-'));
    temps.push(root);
    const files = [
      'dist/platform/routing/define-route.js',
      'dist/platform/routing/tests/fixture-route.js',
      'dist/platform/routing/tests/fixture-route.js.map',
      'dist/platform/routing/tests/loopback.js',
    ];
    for (const rel of files) {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), '');
    }
    expect(prune(join(root, 'dist'))).toBe(1);
    expect(existsSync(join(root, 'dist', 'platform', 'routing', 'tests'))).toBe(false);
    expect(existsSync(join(root, 'dist', 'platform', 'routing', 'define-route.js'))).toBe(true);
  });

  it('CLI: usage errors exit 2, a missing directory exits 1', () => {
    expect(main([])).toBe(2);
    expect(main(['--bogus', 'x'])).toBe(2);
    expect(main([join(tmpdir(), 'definitely-missing-prune-dist-dir')])).toBe(1);
  });
});
