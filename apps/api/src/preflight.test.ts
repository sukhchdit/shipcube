/**
 * Image preflight (TASK-014; ADR-0022 am. 13): imports every compiled module except the entry scripts, imports every
 * @platform/* entry point through the default (dist) condition, and refuses test artifacts in the image.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from '@jest/globals';

import { ENTRY_FILES, PreflightError, platformEntryPoints, preflight, productionModules } from './preflight.js';

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function write(root: string, rel: string, text: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
}

/** A miniature image layout: /app/apps/api/{package.json,dist}, /app/node_modules/@platform/<pkg> (real dirs here). */
function layout(extra: Record<string, string> = {}): { app: string; dist: string } {
  const root = mkdtempSync(join(tmpdir(), 'preflight-'));
  temps.push(root);
  const files: Record<string, string> = {
    'apps/api/package.json': JSON.stringify({ dependencies: { '@platform/config': '0.0.0', express: '5', '@platform/shared': '0.0.0' } }),
    'apps/api/dist/main.js': 'throw new Error("main must not be imported");',
    'apps/api/dist/healthcheck.js': 'throw new Error("healthcheck must not be imported");',
    'apps/api/dist/preflight.js': '',
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
  };
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  return { app: join(root, 'apps', 'api'), dist: join(root, 'apps', 'api', 'dist') };
}

const fileResolver = (root: string) => (specifier: string) => {
  const [scope = '', name = '', ...rest] = specifier.split('/');
  const sub = rest.length > 0 ? `${rest.join('/')}/index.js` : 'index.js';
  return pathToFileURL(join(root, '..', '..', 'node_modules', scope, name, 'dist', sub)).href;
};

describe('image preflight (TASK-014, ADR-0022 am. 13)', () => {
  it('imports every compiled module except main, healthcheck and preflight', async () => {
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
    expect(ENTRY_FILES).toEqual(['main.js', 'healthcheck.js', 'preflight.js']);
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
        load: () => Promise.resolve(),
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
      preflight({
        distDir: dist,
        appManifest: join(app, 'package.json'),
        load: () => Promise.resolve(),
        resolveSpecifier: fileResolver(app),
      }),
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
});
