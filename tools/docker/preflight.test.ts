/**
 * Image preflight (TASK-014; ADR-0022 am. 13): imports every compiled module except main.js, imports every @platform/*
 * entry point through the default (dist) condition, and refuses test artifacts in the image. One tool serves the api
 * and the worker runtime stages (`node /app/preflight.mjs /app/apps/<app>/dist`).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, afterEach, describe, expect, it, jest } from '@jest/globals';

import { ENTRY_FILES, PreflightError, main, platformEntryPoints, preflight, productionModules } from './preflight.mjs';

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
afterEach(() => {
  jest.restoreAllMocks();
});

/** Writes `files` (relative path → text) below a fresh temporary root that stands for /app. */
function tree(prefix: string, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

/** A miniature image layout: /app/apps/api/{package.json,dist}, /app/node_modules/@platform/<pkg> (real dirs here). */
function layout(extra: Record<string, string> = {}): { app: string; dist: string } {
  const root = tree('preflight-', {
    'apps/api/package.json': JSON.stringify({ dependencies: { '@platform/config': '0.0.0', express: '5', '@platform/shared': '0.0.0' } }),
    'apps/api/dist/main.js': 'throw new Error("main must not be imported");',
    'apps/api/dist/app.js': 'export const app = 1;',
    'apps/api/dist/platform/db/client.js': 'export const client = 1;',
    'apps/api/dist/platform/db/client.js.map': '{}',
    'apps/api/dist/platform/db/client.d.ts': 'export {};',
    'node_modules/@platform/config/package.json': JSON.stringify({
      exports: {
        '.': { '@platform/source': './src/index.ts', default: './dist/index.js' },
        './web': { default: './dist/web/index.js' },
        './testing': { default: './dist/testing/index.js' },
      },
    }),
    'node_modules/@platform/config/dist/index.js': '',
    'node_modules/@platform/shared/package.json': JSON.stringify({
      exports: { '.': { default: './dist/index.js' }, './theme.css': './src/theme.css', './modules/*': { default: './dist/*.js' } },
    }),
    'node_modules/@platform/shared/dist/index.js': '',
    ...extra,
  });
  return { app: join(root, 'apps', 'api'), dist: join(root, 'apps', 'api', 'dist') };
}

const fileResolver = (root: string) => (specifier: string) => {
  const [scope = '', name = '', ...rest] = specifier.split('/');
  const sub = rest.length > 0 ? `${rest.join('/')}/index.js` : 'index.js';
  return pathToFileURL(join(root, '..', '..', 'node_modules', scope, name, 'dist', sub)).href;
};

const noLoad = () => Promise.resolve();

describe('image preflight (TASK-014, ADR-0022 am. 13)', () => {
  it('imports every compiled module except main', async () => {
    const { app, dist } = layout();
    const loaded: string[] = [];
    const result = await preflight({
      distDir: dist,
      appManifest: join(app, 'package.json'),
      load: (specifier) => {
        loaded.push(specifier);
        return Promise.resolve();
      },
      resolveSpecifier: fileResolver(app),
    });
    expect(ENTRY_FILES).toEqual(['main.js']);
    expect(result.modules).toBe(2);
    expect(loaded.filter((s) => s.startsWith('file:')).map((s) => s.slice(s.indexOf('/dist/')))).toEqual([
      '/dist/app.js',
      '/dist/platform/db/client.js',
    ]);
    // Every @platform dependency entry point, sorted by package; ./testing, wildcard and non-JS exports are skipped.
    expect(result.entryPoints).toEqual(['@platform/config', '@platform/config/web', '@platform/shared']);
    expect(loaded.filter((s) => !s.startsWith('file:'))).toEqual(result.entryPoints);
  });

  it('runs the real loader over a layout whose modules import cleanly', async () => {
    const { app, dist } = layout();
    await expect(
      preflight({
        distDir: dist,
        appManifest: join(app, 'package.json'),
        resolveSpecifier: fileResolver(app),
        load: (s) => (s.startsWith('file:') ? import(s) : Promise.resolve()),
      }),
    ).resolves.toMatchObject({ modules: 2 });
  });

  it('fails when an entry point resolves to src (the @platform/source condition leaked)', async () => {
    const { app, dist } = layout();
    await expect(
      preflight({
        distDir: dist,
        appManifest: join(app, 'package.json'),
        load: noLoad,
        resolveSpecifier: (s) => pathToFileURL(join(app, 'node_modules', s, 'src', 'index.ts')).href,
      }),
    ).rejects.toThrow(PreflightError);
  });

  it('fails when a module cannot be loaded (a dependency is missing from the pruned install)', async () => {
    const { app, dist } = layout({ 'apps/api/dist/platform/broken.js': "import 'definitely-not-installed-package';" });
    const failure = preflight({ distDir: dist, appManifest: join(app, 'package.json'), resolveSpecifier: fileResolver(app) });
    // The preflight's own reason names the dist module; the loader error stays the cause (never printed, PR20-SEC-13).
    await expect(failure).rejects.toThrow('cannot load dist/platform/broken.js');
    await expect(failure).rejects.toMatchObject({
      name: 'PreflightError',
      reason: 'cannot load dist/platform/broken.js',
      cause: expect.objectContaining({ message: expect.stringContaining('definitely-not-installed-package') }) as unknown,
    });
  });

  it.each([
    ['apps/api/dist/app.test.js', 'a compiled test'],
    ['apps/api/dist/modules/quotes/tests/quote.api.js', 'a tests folder'],
    ['apps/api/dist/platform/__fixtures__/x.js', 'a __fixtures__ folder'],
    ['node_modules/@platform/config/dist/fixtures/start-service.js', 'a fixture of a package'],
    ['node_modules/@platform/shared/dist/index.test.d.ts', 'a package test declaration'],
  ])('refuses %s (%s)', async (rel) => {
    const { app, dist } = layout({ [rel]: '' });
    await expect(
      preflight({ distDir: dist, appManifest: join(app, 'package.json'), load: noLoad, resolveSpecifier: fileResolver(app) }),
    ).rejects.toThrow(/test artifacts/);
  });

  it('reports a @platform dependency that is not installed', () => {
    const { app } = layout({ 'apps/api/package.json': JSON.stringify({ dependencies: { '@platform/audit': '0.0.0' } }) });
    expect(() => platformEntryPoints(join(app, 'package.json'))).toThrow(/@platform\/audit is not installed/);
  });

  it('lists modules in a stable order', () => {
    const { dist } = layout({ 'apps/api/dist/a/z.js': '', 'apps/api/dist/a/b.js': '' });
    expect(productionModules(dist)).toEqual(['a/b.js', 'a/z.js', 'app.js', 'platform/db/client.js']);
  });

  it.each([
    ['the app directory', (app: string) => app],
    ['a missing dist', (app: string) => join(app, 'dsit')],
    ['a dist without main.js', (app: string) => join(app, '..', '..', 'node_modules', '@platform', 'config', 'dist')],
  ])('refuses %s as the dist argument, before importing anything', async (_label, pick) => {
    const { app } = layout();
    const loaded: string[] = [];
    const run = preflight({
      distDir: pick(app),
      appManifest: join(app, 'package.json'),
      load: (s) => {
        loaded.push(s);
        return Promise.resolve();
      },
      resolveSpecifier: fileResolver(app),
    });
    await expect(run).rejects.toThrow(/is not an app dist directory/);
    expect(loaded).toEqual([]);
  });
});

describe('worker image preflight (TASK-014)', () => {
  it('imports the worker modules and the @platform/api runtime entry, never main.js', async () => {
    const root = tree('worker-preflight-', {
      'apps/worker/package.json': JSON.stringify({ dependencies: { '@platform/api': '0.0.0', bullmq: '6' } }),
      'apps/worker/dist/main.js': 'throw new Error("main must not be imported");',
      'apps/worker/dist/platform/health/server.js': 'export const server = 1;',
      'node_modules/@platform/api/package.json': JSON.stringify({
        exports: { './runtime': { default: './dist/platform/runtime/index.js' }, './modules/*': { default: './dist/modules/*/index.js' } },
      }),
    });
    const loaded: string[] = [];
    const result = await preflight({
      distDir: join(root, 'apps', 'worker', 'dist'),
      appManifest: join(root, 'apps', 'worker', 'package.json'),
      load: (specifier) => {
        loaded.push(specifier.startsWith('file:') ? specifier.slice(specifier.indexOf('/dist/')) : specifier);
        return Promise.resolve();
      },
      resolveSpecifier: () => pathToFileURL(join(root, 'node_modules', '@platform', 'api', 'dist', 'platform', 'runtime', 'index.js')).href,
    });
    expect(result).toEqual({ modules: 1, entryPoints: ['@platform/api/runtime'] });
    expect(loaded).toEqual(['/dist/platform/health/server.js', '@platform/api/runtime']);
  });
});

describe('image preflight entry (TASK-014)', () => {
  function capture(): { out: () => string; err: () => string } {
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const text = (spy: typeof stdout) => spy.mock.calls.map(([chunk]) => String(chunk)).join('');
    return { out: () => text(stdout), err: () => text(stderr) };
  }

  it('prints one summary line and exits 0; the manifest defaults to <dist>/../package.json', async () => {
    const { app, dist } = layout();
    const io = capture();
    await expect(main([dist], { load: noLoad, resolveSpecifier: fileResolver(app) })).resolves.toBe(0);
    expect(io.out()).toBe('[preflight] ok: 2 module(s), entry points @platform/config @platform/config/web @platform/shared\n');
    expect(io.err()).toBe('');
  });

  it('takes an explicit app manifest as the second argument', async () => {
    const { app, dist } = layout({ 'apps/api/other.json': JSON.stringify({ dependencies: { '@platform/shared': '0.0.0' } }) });
    const io = capture();
    await expect(main([dist, join(app, 'other.json')], { load: noLoad, resolveSpecifier: fileResolver(app) })).resolves.toBe(0);
    expect(io.out()).toBe('[preflight] ok: 2 module(s), entry points @platform/shared\n');
  });

  it('prints a structured failure line with the reason and the cause class, never the caught message', async () => {
    const { app, dist } = layout({ 'apps/api/dist/platform/broken.js': "import 'definitely-not-installed-package';" });
    const io = capture();
    await expect(main([dist], { resolveSpecifier: fileResolver(app) })).resolves.toBe(1);
    expect(io.out()).toBe('');
    const line = io.err();
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({
      event: 'preflight.failed',
      error: 'PreflightError',
      reason: 'cannot load dist/platform/broken.js',
      cause: 'Error',
    });
    expect(line).not.toContain('definitely-not-installed-package');
  });

  it('names only an identifier-like cause class (no free text from a thrown object)', async () => {
    const { app, dist } = layout();
    const io = capture();
    const thrown = { name: 'secret value: s3cr3t', message: 'secret' };
    await expect(
      main([dist], { load: () => Promise.reject(thrown as unknown as Error), resolveSpecifier: fileResolver(app) }),
    ).resolves.toBe(1);
    expect(JSON.parse(io.err())).toEqual({ event: 'preflight.failed', error: 'PreflightError', reason: 'cannot load dist/app.js' });
    expect(io.err()).not.toContain('s3cr3t');
  });

  it.each<[string[]]>([[[]], [['']], [['--conditions=@platform/source']], [['a/dist', 'a/package.json', 'extra']]])(
    'exits 1 with a usage line for the arguments %j',
    async (argv) => {
      const io = capture();
      await expect(main(argv)).resolves.toBe(1);
      expect(io.err()).toBe('usage: preflight.mjs <apps/<app>/dist> [<app package.json>]\n');
    },
  );
});
