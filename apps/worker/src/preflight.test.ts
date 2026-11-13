/**
 * Worker image preflight (TASK-014; ADR-0022 am. 13). The worker reaches the api runtime through @platform/api, whose
 * `./modules/*` wildcard export is skipped and whose `./runtime` export is imported through the dist condition.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from '@jest/globals';

import { preflight } from './preflight.js';

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('worker image preflight (TASK-014)', () => {
  it('imports the worker modules and the @platform/api runtime entry, never main.js', async () => {
    const root = mkdtempSync(join(tmpdir(), 'worker-preflight-'));
    temps.push(root);
    const files: Record<string, string> = {
      'apps/worker/package.json': JSON.stringify({ dependencies: { '@platform/api': '0.0.0', bullmq: '6' } }),
      'apps/worker/dist/main.js': 'throw new Error("main must not be imported");',
      'apps/worker/dist/platform/health/server.js': 'export const server = 1;',
      'node_modules/@platform/api/package.json': JSON.stringify({
        exports: { './runtime': { default: './dist/platform/runtime/index.js' }, './modules/*': { default: './dist/modules/*/index.js' } },
      }),
    };
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
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
