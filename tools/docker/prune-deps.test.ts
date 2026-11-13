/**
 * prune-deps.mjs (TASK-014; platform.md §3.2 prod-deps row, §3.4 size budget): only the production closure of the
 * named workspace stays installed; resolution follows Node's node_modules walk and workspace links.
 */
import { describe, expect, it } from '@jest/globals';

import { closure, outermost, outsideClosure, resolveFrom, type LockPackages } from './prune-deps.mjs';

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

  it('lists only outermost paths', () => {
    expect(outermost(['node_modules/a/node_modules/b', 'node_modules/a', 'node_modules/c'])).toEqual(['node_modules/a', 'node_modules/c']);
  });
});
