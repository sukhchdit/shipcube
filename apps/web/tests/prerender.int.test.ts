/**
 * TASK-004 acceptance (ADR-0026 §1-2 and am. 4, NFR-WEB-005): `react-router build` pre-renders /en, /es and /fr with
 * a localised <title>, <html lang>, canonical and hreflang alternates; `/` is not pre-rendered; the admin SPA builds.
 *
 * Integration project (`npm run test:integration`), not `test:unit`: each case runs a real production build of an app
 * (Vite + the React Router pre-render), which takes seconds rather than milliseconds. The builds go to temporary
 * directories through `APP_BUILD_DIR` (react-router.config.ts), so the test neither needs nor touches `build/`, and
 * never skips: the build under test is produced by the test itself.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

const LOCALES = ['en', 'es', 'fr'] as const;
const BUILD_TIMEOUT_MS = 180_000;

/**
 * PR4-SEC-01: a build-time variable that is NOT `VITE_PUBLIC_*`. It is set in the environment of every build below and
 * must never reach the bundle (`envPrefix: 'VITE_PUBLIC_'`). Random per run, so a value left in a cache cannot satisfy
 * the assertion by accident.
 */
const CANARY_VALUE = `canary-${randomBytes(12).toString('hex')}`;
/** Positive control: a `VITE_PUBLIC_*` variable still reaches the pre-rendered canonical and hreflang URLs. */
const PUBLIC_ORIGIN = 'https://example.test';

function findRepoRoot(start: string): string {
  let dir = resolve(start);
  while (!existsSync(join(dir, 'tsconfig.base.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`No repository root above ${start}`);
    dir = parent;
  }
  return dir;
}

const repoRoot = findRepoRoot(process.cwd());
const reactRouterCli = join(repoRoot, 'node_modules', '@react-router', 'dev', 'bin.cjs');

interface AppBuild {
  outDir: string;
  output: string;
}

/**
 * `react-router build` for one app into a fresh temporary directory; throws with the CLI output on failure. The
 * directory sits under the repository's git-ignored `node_modules/.cache` rather than the OS temp dir because the
 * pre-render imports the server bundle, whose bare imports (`react-router`, `react-dom/server`) resolve through the
 * repository's node_modules.
 */
function buildApp(app: 'web' | 'admin'): AppBuild {
  const cacheDir = join(repoRoot, 'node_modules', '.cache', 'app-build-tests');
  mkdirSync(cacheDir, { recursive: true });
  const outDir = mkdtempSync(join(cacheDir, `${app}-`));
  const result = spawnSync(process.execPath, [reactRouterCli, 'build'], {
    cwd: join(repoRoot, 'apps', app),
    env: {
      ...process.env,
      APP_BUILD_DIR: outDir,
      NODE_ENV: 'production',
      VITE_CANARY_NOT_PUBLIC: CANARY_VALUE,
      VITE_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
    },
    encoding: 'utf8',
    timeout: BUILD_TIMEOUT_MS,
    windowsHide: true,
  });
  const output = `${result.stdout}${result.stderr}`;
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`react-router build of apps/${app} failed (status ${String(result.status)}):\n${output}`);
  }
  return { outDir, output };
}

function decodeEntities(text: string): string {
  return text.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function titleOf(html: string): string | undefined {
  const match = /<title>([^<]*)<\/title>/.exec(html);
  return match?.[1] === undefined ? undefined : decodeEntities(match[1]);
}

function hreflangAlternates(html: string): Record<string, string> {
  const alternates: Record<string, string> = {};
  for (const [, lang, href] of html.matchAll(/<link rel="alternate" hrefLang="([^"]+)" href="([^"]+)"\/>/g)) {
    if (lang !== undefined && href !== undefined) alternates[lang] = href;
  }
  return alternates;
}

function metaDescriptionOf(html: string): string | undefined {
  const match = /<meta name="description" content="([^"]*)"\/>/.exec(html);
  return match?.[1] === undefined ? undefined : decodeEntities(match[1]);
}

function headingOf(html: string): string | undefined {
  const match = /<h1[^>]*>([^<]*)<\/h1>/.exec(html);
  return match?.[1] === undefined ? undefined : decodeEntities(match[1]);
}

interface HomeMessages {
  home: { meta: { title: string; description: string }; hero: { title: string } };
}

function homeMessages(locale: string): HomeMessages['home'] {
  const messages = JSON.parse(readFileSync(join(repoRoot, 'apps', 'web', 'locales', locale, 'common.json'), 'utf8')) as HomeMessages;
  return messages.home;
}

function homeTitle(locale: string): string {
  return homeMessages(locale).meta.title;
}

/** Every file below `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/** Build-output hygiene shared by both apps: no source maps, and no non-public build variable inlined (PR4-SEC-01). */
function expectCleanClientOutput(clientDir: string): void {
  const files = filesUnder(clientDir);
  expect(files.length).toBeGreaterThan(0);
  expect(files.filter((file) => file.endsWith('.map'))).toEqual([]);
  const leaking = files.filter((file) => {
    const content = readFileSync(file, 'utf8');
    return content.includes(CANARY_VALUE) || content.includes('VITE_CANARY_NOT_PUBLIC') || /[#@] sourceMappingURL=/.test(content);
  });
  expect(leaking).toEqual([]);
}

describe('apps/web pre-render (TASK-004, ADR-0026 am. 4, NFR-WEB-005)', () => {
  let build: AppBuild;
  beforeAll(() => {
    build = buildApp('web');
  }, BUILD_TIMEOUT_MS);
  afterAll(() => rmSync(build.outDir, { recursive: true, force: true }));

  it.each(LOCALES)('/%s is pre-rendered with its lang, localised title, canonical and hreflang alternates', (locale) => {
    const page = join(build.outDir, 'client', locale, 'index.html');
    expect(existsSync(page)).toBe(true);
    const html = readFileSync(page, 'utf8');

    expect(html).toMatch(new RegExp(`^<!DOCTYPE html><html lang="${locale}"`));
    expect(titleOf(html)).toBe(homeTitle(locale));
    expect(html).toContain(`<link rel="canonical" href="${PUBLIC_ORIGIN}/${locale}/"/>`);

    const alternates = hreflangAlternates(html);
    expect(Object.keys(alternates).sort()).toEqual(['en', 'es', 'fr', 'x-default']);
    for (const target of LOCALES) expect(alternates[target]).toBe(`${PUBLIC_ORIGIN}/${target}/`);
    expect(alternates['x-default']).toBe(alternates['en']);
  });

  it.each(LOCALES)('/%s has the localised meta description and primary heading in the raw HTML (NFR-WEB-005)', (locale) => {
    const html = readFileSync(join(build.outDir, 'client', locale, 'index.html'), 'utf8');
    const { meta, hero } = homeMessages(locale);

    expect(metaDescriptionOf(html)).toBe(meta.description);
    expect(headingOf(html)).toBe(hero.title);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it('inlines no non-VITE_PUBLIC_ build variable and ships no source maps (PR4-SEC-01)', () => {
    expectCleanClientOutput(join(build.outDir, 'client'));
  });

  it('/ is not pre-rendered: index.html is the content-free SPA fallback that Nginx serves for client routes', () => {
    // Nginx answers `/` itself with a 302 to /{lng}/ (infra/nginx/web.conf.template), so `/` is absent from the
    // prerender list and React Router writes the SPA fallback (root HydrateFallback only) to index.html.
    expect(build.output).toMatch(/Prerender \(html\): SPA Fallback -> \S*index\.html/);
    expect(build.output).not.toMatch(/Prerender \(html\): \/ ->/);

    const fallback = readFileSync(join(build.outDir, 'client', 'index.html'), 'utf8');
    expect(fallback).toContain('"isSpaMode":true');
    expect(fallback).not.toContain('rel="canonical"');
    expect(fallback).not.toContain('hrefLang=');
    for (const locale of LOCALES) {
      expect(fallback).not.toContain(homeTitle(locale));
    }
  });
});

describe('apps/admin SPA build (TASK-004, REQ-ADMIN-001)', () => {
  let build: AppBuild;
  beforeAll(() => {
    build = buildApp('admin');
  }, BUILD_TIMEOUT_MS);
  afterAll(() => rmSync(build.outDir, { recursive: true, force: true }));

  it('emits only the SPA fallback index.html and hashed assets: nothing is pre-rendered', () => {
    const fallback = readFileSync(join(build.outDir, 'client', 'index.html'), 'utf8');
    expect(fallback).toContain('"isSpaMode":true');
    expect(build.output).not.toMatch(/Prerender \(html\): \//);
    for (const locale of LOCALES) expect(existsSync(join(build.outDir, 'client', locale))).toBe(false);
  });

  it('inlines no non-VITE_PUBLIC_ build variable and ships no source maps (PR4-SEC-01)', () => {
    expectCleanClientOutput(join(build.outDir, 'client'));
  });
});
