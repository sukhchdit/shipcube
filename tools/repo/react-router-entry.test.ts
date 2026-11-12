/**
 * PR1-SEC-03 / SPK-01 F-SEC-1 / ADR-0026 am. 10 / D-ARCH-039: without a committed `app/entry.server.tsx`, `@react-router/dev`
 * rewrites package.json (adds `isbot`) and runs `npm install` during `react-router build` and `typegen`.
 * Guards: every React Router workspace commits its server entry, and no manifest declares `isbot`.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import { dependencyEntries, listManifests } from './workspaces.js';

const ENTRY_SERVER_CANDIDATES = ['app/entry.server.tsx', 'app/entry.server.ts', 'app/entry.server.jsx', 'app/entry.server.js'];

/** Workspaces with a `react-router.config.ts` that lack a committed server entry. */
function missingServerEntries(repoRoot: string): string[] {
  return listManifests(repoRoot)
    .map(({ dir }) => dir)
    .filter((dir) => existsSync(join(repoRoot, ...dir.split('/'), 'react-router.config.ts')))
    .filter((dir) => !ENTRY_SERVER_CANDIDATES.some((entry) => existsSync(join(repoRoot, ...dir.split('/'), ...entry.split('/')))))
    .map((dir) => `${dir}/app/entry.server.tsx`);
}

const TYPEGEN_SCRIPT = 'react-router typegen';

/** Workspaces with a `react-router.config.ts` whose package.json lacks `"typegen": "react-router typegen"` (ADR-0026 am. 13). */
function missingTypegenScripts(repoRoot: string): string[] {
  return listManifests(repoRoot)
    .filter(({ dir }) => existsSync(join(repoRoot, ...dir.split('/'), 'react-router.config.ts')))
    .filter(({ manifest }) => manifest.scripts?.['typegen'] !== TYPEGEN_SCRIPT)
    .map(({ dir }) => `${dir}/package.json`);
}

/** Manifests (root and workspaces) that declare `isbot` in any dependency field. */
function manifestsDeclaringIsbot(repoRoot: string): string[] {
  return listManifests(repoRoot)
    .filter(({ manifest }) => dependencyEntries(manifest).some(([name]) => name === 'isbot'))
    .map(({ dir }) => `${dir}/package.json`);
}

const repoRoot = findRepoRoot();

describe('React Router apps commit their server entry and never declare isbot (PR1-SEC-03)', () => {
  const fixtures: string[] = [];
  afterAll(() => fixtures.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  /** A minimal workspace root with one React Router app; `withEntry: false` omits `app/entry.server.tsx`. */
  function appFixture(options: {
    withEntry: boolean;
    isbotIn?: 'dependencies' | 'devDependencies' | 'peerDependencies';
    typegenScript?: string;
  }): string {
    const root = mkdtempSync(join(tmpdir(), 'rr-entry-'));
    fixtures.push(root);
    const write = (rel: string, content: string) => {
      const path = join(root, ...rel.split('/'));
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, content);
    };
    write('package.json', JSON.stringify({ name: 'fixture', private: true, workspaces: ['apps/*'] }));
    const manifest: Record<string, unknown> = { name: '@fixture/web', private: true };
    if (options.isbotIn !== undefined) manifest[options.isbotIn] = { isbot: '^5' };
    if (options.typegenScript !== undefined) manifest['scripts'] = { typegen: options.typegenScript };
    write('apps/web/package.json', JSON.stringify(manifest));
    write('apps/web/react-router.config.ts', 'export default {};\n');
    if (options.withEntry) write('apps/web/app/entry.server.tsx', 'export default null;\n');
    return root;
  }

  it('[PR1-SEC-03] every workspace with a react-router.config.ts has app/entry.server.tsx', () => {
    expect(missingServerEntries(repoRoot)).toEqual([]);
    for (const app of ['apps/web', 'apps/admin']) {
      expect(existsSync(join(repoRoot, app, 'react-router.config.ts'))).toBe(true);
      expect(existsSync(join(repoRoot, app, 'app', 'entry.server.tsx'))).toBe(true);
    }
  });

  it('[PR1-SEC-03] no manifest (root and all workspaces) declares isbot in any dependency field', () => {
    expect(manifestsDeclaringIsbot(repoRoot)).toEqual([]);
  });

  it('[PR1-SEC-03] negative: the check fails when apps/web/app/entry.server.tsx is missing', () => {
    expect(missingServerEntries(appFixture({ withEntry: false }))).toEqual(['apps/web/app/entry.server.tsx']);
    expect(missingServerEntries(appFixture({ withEntry: true }))).toEqual([]);
  });

  it('[ADR-0026 am. 13] every workspace with a react-router.config.ts declares "typegen": "react-router typegen"', () => {
    expect(missingTypegenScripts(repoRoot)).toEqual([]);
  });

  it('[ADR-0026 am. 13] negative: the check fails when the typegen script is absent or different', () => {
    expect(missingTypegenScripts(appFixture({ withEntry: true }))).toEqual(['apps/web/package.json']);
    expect(missingTypegenScripts(appFixture({ withEntry: true, typegenScript: 'react-router build' }))).toEqual(['apps/web/package.json']);
    expect(missingTypegenScripts(appFixture({ withEntry: true, typegenScript: TYPEGEN_SCRIPT }))).toEqual([]);
  });

  it.each(['dependencies', 'devDependencies', 'peerDependencies'] as const)(
    '[PR1-SEC-03] negative: the check fails when a workspace declares isbot in %s',
    (field) => {
      expect(manifestsDeclaringIsbot(appFixture({ withEntry: true, isbotIn: field }))).toEqual(['apps/web/package.json']);
    },
  );
});
