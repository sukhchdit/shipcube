/**
 * The generated Prisma client package `@platform/prisma/client` (D-ARCH-102, D-ARCH-103 (7); data-model §7.2 amendment
 * 2026-11-13; TASK-020 part 020-B): the pinned generator block, the package manifest and the TypeScript project shape,
 * and the third resolution mode: plain `node` (no conditions, as in the images) resolves the package from apps/api to
 * the compiled prisma/dist/client and reaches the driver. The other two modes are `tsc -b` (the typecheck gate) and
 * the Jest unit project under `@platform/source` (apps/api/src/platform/db/generated.test.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from '@jest/globals';

import { PRISMA_TREE_LOCK, withFileLock } from '../test-support/fs-lock.js';
import { findRepoRoot, runNode } from '../test-support/process.js';

const ROOT = findRepoRoot();
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const json = (path: string): Record<string, unknown> => JSON.parse(read(path)) as Record<string, unknown>;

/** `key = "value"` assignments of the `generator client { ... }` block of prisma/schema/_base.prisma. */
function generatorBlock(schema: string): Record<string, string> {
  const block = /^generator client \{\n([^}]*)\n\}/mu.exec(schema.replace(/\r\n/gu, '\n'));
  if (block?.[1] === undefined) throw new Error('no generator client block');
  return Object.fromEntries(
    block[1].split('\n').flatMap((line) => {
      const match = /^\s*(\w+)\s*=\s*"([^"]*)"\s*$/u.exec(line);
      return match?.[1] === undefined || match[2] === undefined ? [] : [[match[1], match[2]]];
    }),
  );
}

describe('generator block (D-ARCH-102 (1))', () => {
  it('pins provider, output and the four emit options, and nothing else', () => {
    expect(generatorBlock(read('prisma/schema/_base.prisma'))).toEqual({
      provider: 'prisma-client',
      output: '../generated/prisma',
      runtime: 'nodejs',
      moduleFormat: 'esm',
      generatedFileExtension: 'ts',
      importFileExtension: 'js',
    });
  });

  it('the parser reads every assignment line (a dropped option is seen)', () => {
    const mutant = 'generator client {\n  provider = "prisma-client"\n  output   = "../generated/prisma"\n}\n';
    expect(generatorBlock(mutant)).toEqual({ provider: 'prisma-client', output: '../generated/prisma' });
  });
});

describe('package manifest and scripts (D-ARCH-102 (3))', () => {
  it('prisma/package.json exports exactly ./client with @platform/source, types, default in that order', () => {
    const exportsMap = json('prisma/package.json')['exports'] as Record<string, Record<string, string>>;
    expect(Object.keys(exportsMap)).toEqual(['./client']);
    expect(Object.entries(exportsMap['./client'] ?? {})).toEqual([
      ['@platform/source', './generated/prisma/client.ts'],
      ['types', './dist/client/client.d.ts'],
      ['default', './dist/client/client.js'],
    ]);
  });

  it('build compiles the client project; typegen is the check-only script (it never generates)', () => {
    expect(json('prisma/package.json')['scripts']).toEqual({ build: 'tsc -b client', typegen: 'node ../tools/db/check-prisma-client.mjs' });
  });

  it('db:generate is the only root script that generates besides deps:rebuild, and no db:* script chains it', () => {
    const scripts = json('package.json')['scripts'] as Record<string, string>;
    expect(scripts['db:generate']).toBe('node tools/deps/prisma-cli.mjs generate');
    const generating = Object.entries(scripts).filter(([, command]) => /prisma-cli\.mjs generate\b/u.test(command));
    expect(generating.map(([name]) => name)).toEqual(['db:generate']);
  });

  it('apps/api declares @platform/prisma; apps/worker does not (it goes through @platform/api/runtime)', () => {
    expect((json('apps/api/package.json')['dependencies'] as Record<string, string>)['@platform/prisma']).toBe('0.0.0');
    expect(json('apps/worker/package.json')['dependencies']).not.toHaveProperty('@platform/prisma');
  });
});

describe('TypeScript project shape (D-ARCH-102 (2))', () => {
  it('prisma/client is a composite project over prisma/generated/prisma with no references and no maps', () => {
    const config = json('prisma/client/tsconfig.json');
    expect(config['extends']).toBe('../../tsconfig.base.json');
    expect(config['compilerOptions']).toMatchObject({
      rootDir: '../generated/prisma',
      outDir: '../dist/client',
      sourceMap: false,
      declarationMap: false,
    });
    expect(config['compilerOptions']).not.toHaveProperty('composite', false);
    expect(config['include']).toEqual(['../generated/prisma/**/*.ts']);
    expect(config).not.toHaveProperty('references');
  });

  const references = (path: string): string[] => ((json(path)['references'] ?? []) as { path: string }[]).map((ref) => ref.path);

  it('apps/api and tools reference it; the root solution file does not (AT-US-001-04 pins that list)', () => {
    expect(references('apps/api/tsconfig.json')).toContain('../../prisma/client');
    expect(references('tools/tsconfig.json')).toContain('../prisma/client');
    expect(references('tsconfig.json').filter((path) => path.startsWith('prisma/'))).toEqual([]);
  });

  it('tools/tsconfig.json compiles no generated file itself and lists platform/db/generated.ts (TS6307 otherwise)', () => {
    const tools = json('tools/tsconfig.json');
    expect((tools['include'] as string[]).filter((glob) => glob.includes('generated'))).toEqual([]);
    expect(tools['files']).toContain('../apps/api/src/platform/db/generated.ts');
  });
});

describe('run-time resolution without conditions (D-ARCH-102 (2), (4): what the images run)', () => {
  beforeAll(async () => {
    // `npm run build` compiles prisma/client through the apps/api reference; here only that project is built, under
    // the lock that guards the generated client against a concurrent regeneration (tools/deps/ignore-scripts.test.ts).
    const built = await withFileLock(PRISMA_TREE_LOCK, () =>
      runNode([join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-b', join(ROOT, 'prisma', 'client')], { cwd: ROOT }),
    );
    expect({ status: built.status, stdout: built.stdout }).toEqual({ status: 0, stdout: '' });
  }, 300_000);

  it('plain node in apps/api resolves @platform/prisma/client to prisma/dist/client/client.js and reaches the driver', () => {
    const script = [
      "const url = import.meta.resolve('@platform/prisma/client');",
      "const { PrismaClient } = await import('@platform/prisma/client');",
      "const { PrismaPg } = await import('@prisma/adapter-pg');",
      // A refused connect (port 1 on loopback): the error must come from the driver, through the compiled client. No
      // connectionTimeoutMillis (TASK-288): a 2 s pg connect timer raced the immediate ECONNREFUSED and won whenever the
      // host starved this child for 2 s, failing as a plain Error "Connection terminated due to connection timeout" (runs
      // 20261115T1909Z and the TASK-288 stress series). A refused loopback connect needs no timer; runNode bounds a hang.
      "const adapter = new PrismaPg({ connectionString: 'postgresql://probe@127.0.0.1:1/probe' });",
      "const client = new PrismaClient({ adapter, errorFormat: 'minimal' });",
      "let name = 'none'; let detail = '';",
      'try { await client.$queryRaw`SELECT 1`; } catch (error) {',
      '  name = error.constructor.name;',
      "  detail = [error.message, error.cause?.message, String(error.stack).split('\\n').slice(1, 6).join(' | ')].join(' || ');",
      '}',
      'await client.$disconnect();',
      'console.log(JSON.stringify({ url, name, detail }));',
    ].join('\n');
    const result = runNode(['--input-type=module'], {
      cwd: join(ROOT, 'apps', 'api'),
      input: script,
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    expect(result.status).toBe(0);
    const outcome = JSON.parse(result.stdout.trim()) as { url: string; name: string; detail: string };
    expect(outcome.url.replace(/\\/gu, '/')).toMatch(/\/prisma\/dist\/client\/client\.js$/u);
    // The detail (message, cause, stack head) is shown only when the class is wrong, so a failure names its cause.
    expect({ name: outcome.name, detail: outcome.name === 'PrismaClientKnownRequestError' ? '' : outcome.detail }).toEqual({
      name: 'PrismaClientKnownRequestError',
      detail: '',
    });
  });
});
