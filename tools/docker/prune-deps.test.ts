/**
 * prune-deps.mjs (TASK-014; platform.md §3.2 prod-deps row, §3.4 size budget): only the production closure of the
 * named workspace stays installed; resolution follows Node's node_modules walk and workspace links.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { closure, main, outermost, outsideClosure, resolveFrom, type LockPackages } from './prune-deps.mjs';

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('prune-deps CLI on an installed tree', () => {
  it('[D-ARCH-117] --dev --leaf: keeps the CLI, tsx and the stub, drops the rest and the empty scope folders', () => {
    const root = mkdtempSync(join(tmpdir(), 'prune-deps-'));
    temps.push(root);
    const hidden = {
      packages: {
        prisma: { dependencies: { pg: '8' }, devDependencies: { prisma: '7', tsx: '4' } },
        'node_modules/pg': {},
        'node_modules/prisma': {
          dependencies: { '@prisma/studio-core': '0' },
          peerDependencies: { typescript: '*' },
          peerDependenciesMeta: { typescript: { optional: true } },
        },
        'node_modules/@prisma/studio-core': { dependencies: { '@radix-ui/react-slot': '1' } },
        'node_modules/@radix-ui/react-slot': {},
        'node_modules/tsx': {},
        'node_modules/typescript': {},
        'node_modules/@eslint/js': {},
      },
    };
    writeFileSync(join(root, 'package.json'), '{"devDependencies":{"typescript":"6"}}');
    mkdirSync(join(root, 'prisma'));
    for (const path of Object.keys(hidden.packages).filter((key) => key.startsWith('node_modules/'))) {
      mkdirSync(join(root, ...path.split('/')), { recursive: true });
    }
    writeFileSync(join(root, 'node_modules', '.package-lock.json'), JSON.stringify(hidden));
    expect(main(['--root', root, '--dev', '--leaf', 'node_modules/@prisma/studio-core', 'prisma'])).toBe(0);
    const present = (path: string): boolean => existsSync(join(root, 'node_modules', ...path.split('/')));
    expect(['pg', 'prisma', 'tsx', '@prisma/studio-core'].filter((path) => !present(path))).toEqual([]);
    expect(['typescript', '@radix-ui', '@eslint'].filter(present)).toEqual([]);
  });
});

/** A miniature hidden lockfile: api uses express (-> nested debug@2) and @platform/config (-> joi); web uses react-dom. */
const tree: LockPackages = {
  '': { devDependencies: { tsx: '4' } },
  'apps/api': { dependencies: { express: '5', '@platform/config': '0.0.0' }, devDependencies: { typescript: '6' } },
  'apps/web': { dependencies: { 'react-dom': '19' } },
  'packages/config': { dependencies: { joi: '18' }, peerDependencies: { zod: '4' } },
  'node_modules/@platform/config': { link: true, resolved: 'packages/config' },
  'node_modules/@platform/web': { link: true, resolved: 'apps/web' },
  'node_modules/express': { dependencies: { debug: '2' }, optionalDependencies: { 'not-installed': '1' } },
  'node_modules/express/node_modules/debug': { dependencies: { ms: '2' } },
  'node_modules/debug': { dependencies: { ms: '2' } },
  'node_modules/ms': {},
  'node_modules/joi': {},
  'node_modules/zod': {},
  'node_modules/react-dom': { dependencies: { scheduler: '0' } },
  'node_modules/scheduler': {},
  'node_modules/typescript': {},
  'node_modules/tsx': {},
};

describe('prune-deps graph', () => {
  it('resolves nested before hoisted copies and follows workspace links', () => {
    expect(resolveFrom(tree, 'node_modules/express', 'debug')).toBe('node_modules/express/node_modules/debug');
    expect(resolveFrom(tree, 'node_modules/express/node_modules/debug', 'ms')).toBe('node_modules/ms');
    expect(resolveFrom(tree, 'apps/api', '@platform/config')).toBe('packages/config');
    expect(resolveFrom(tree, 'apps/api', 'missing')).toBeUndefined();
  });

  it('collects the production closure (no devDependencies, missing optionals skipped, peers followed)', () => {
    expect([...closure(tree, ['apps/api'])].sort()).toEqual([
      'apps/api',
      'node_modules/express',
      'node_modules/express/node_modules/debug',
      'node_modules/joi',
      'node_modules/ms',
      'node_modules/zod',
      'packages/config',
    ]);
  });

  it('removes everything outside the closure, including links to other workspaces, and keeps needed links', () => {
    expect(outsideClosure(tree, ['apps/api'])).toEqual([
      'node_modules/@platform/web',
      'node_modules/debug',
      'node_modules/react-dom',
      'node_modules/scheduler',
      'node_modules/tsx',
      'node_modules/typescript',
    ]);
  });

  it('[D-ARCH-117] --dev keeps the workspace own devDependencies closure, never the root or a reached package devDependencies', () => {
    const tooling: LockPackages = {
      '': { devDependencies: { typescript: '6', tsx: '4', eslint: '10' } },
      prisma: { dependencies: { '@platform/config': '0.0.0', pg: '8' }, devDependencies: { prisma: '7', tsx: '4' } },
      'packages/config': { dependencies: { zod: '4' }, devDependencies: { jest: '30' } },
      'node_modules/@platform/config': { link: true, resolved: 'packages/config' },
      'node_modules/pg': {},
      'node_modules/zod': {},
      'node_modules/prisma': {
        dependencies: { '@prisma/engines': '7', '@prisma/studio-core': '0' },
        devDependencies: { typescript: '6' },
        // An optional peer is not an edge (prisma 7.10.1 declares typescript this way).
        peerDependencies: { typescript: '>=5.4.0' },
        peerDependenciesMeta: { typescript: { optional: true } },
      },
      'node_modules/@prisma/engines': {},
      // The throwing stub of prune-migrate-image.mjs; the hidden lockfile still lists the real package's dependencies.
      'node_modules/@prisma/studio-core': { dependencies: { react: '19' } },
      'node_modules/react': {},
      'node_modules/tsx': { dependencies: { esbuild: '0' } },
      'node_modules/esbuild': { optionalDependencies: { '@esbuild/linux-x64': '0' } },
      'node_modules/@esbuild/linux-x64': {},
      'node_modules/typescript': {},
      'node_modules/eslint': {},
      'node_modules/jest': {},
    };
    const leaves = new Set(['node_modules/@prisma/studio-core']);
    expect(outsideClosure(tooling, ['prisma'], { dev: true, leaves })).toEqual([
      'node_modules/eslint',
      'node_modules/jest',
      'node_modules/react',
      'node_modules/typescript',
    ]);
    // Without the leaf the stub's stale dependencies would stay.
    expect(outsideClosure(tooling, ['prisma'], { dev: true })).toEqual([
      'node_modules/eslint',
      'node_modules/jest',
      'node_modules/typescript',
    ]);
    // Without --dev the CLI and tsx go too (the production-image behaviour is unchanged).
    expect(outsideClosure(tooling, ['prisma'])).toEqual([
      'node_modules/@esbuild/linux-x64',
      'node_modules/@prisma/engines',
      'node_modules/@prisma/studio-core',
      'node_modules/esbuild',
      'node_modules/eslint',
      'node_modules/jest',
      'node_modules/prisma',
      'node_modules/react',
      'node_modules/tsx',
      'node_modules/typescript',
    ]);
  });

  it('CLI: unknown flags, a leaf outside node_modules and no workspace are usage errors (exit 2)', () => {
    expect(main([])).toBe(2);
    expect(main(['--bogus', 'prisma'])).toBe(2);
    expect(main(['--leaf', '../outside', 'prisma'])).toBe(2);
    expect(main(['--leaf', 'node_modules/x'])).toBe(2);
  });

  it('lists only outermost paths', () => {
    expect(outermost(['node_modules/a/node_modules/b', 'node_modules/a', 'node_modules/c'])).toEqual(['node_modules/a', 'node_modules/c']);
  });
});
