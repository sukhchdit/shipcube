/**
 * Pooled-fetch ratchet (TASK-291; D-ORCH-113 (a); D-ARCH-146; PR #56 code review R2-n3): every file under apps, packages,
 * tests and tools that calls the global fetch against a loopback server is on a checked-in allow-list that may only shrink
 * and holds no file of tests/generated. Pure text scan, no server, no Docker (lane A unit project).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
  callsGlobalFetchOnLoopback,
  inScanScope,
  type AllowListEntry,
  ratchetFindings,
  scanLoopbackFetchUsers,
  withoutComments,
} from './loopback-scan.js';

/** The repository root: two levels above tests/generated (Jest transpiles to CommonJS, so __dirname is the file's folder). */
const ROOT = resolve(__dirname, '..', '..');
const ALLOW_LIST = (
  JSON.parse(readFileSync(join(ROOT, 'tests/generated/loopback-fetch-allowlist.json'), 'utf8')) as { entries: AllowListEntry[] }
).entries;

/**
 * The ceiling of the allow-list (TASK-291 pre-push review R1-m1): every file that may be on it. The list may only shrink, so an entry that is
 * not here fails; adding one is a deliberate edit of this pin in the same PR (CODEOWNERS covers this file), shown in review.
 */
const PINNED_CEILING: readonly string[] = [
  'apps/api/src/platform/audit/audit-failure.api.test.ts',
  'apps/api/src/platform/audit/capture.api.test.ts',
  'apps/api/src/platform/errors/problem-handler.api.test.ts',
  'apps/api/src/platform/http/json-body-text.api.test.ts',
  'apps/api/src/platform/openapi/serve.api.test.ts',
  'apps/api/src/platform/tx/execute-phases.test.ts',
  'apps/api/src/platform/tx/route-phases.int.test.ts',
  'apps/api/src/platform/tx/runner-activation.int.test.ts',
  'apps/worker/src/platform/health/server.test.ts',
  'tests/contract-stubs/contract-stubs.api.test.ts',
];

describe('pooled-fetch ratchet over the repository (TASK-291, D-ORCH-113 (a))', () => {
  it('[TASK-291] no file calls the global fetch against a loopback server unless it is on the allow-list, and no listed file is stale', () => {
    expect(ratchetFindings(scanLoopbackFetchUsers(ROOT), ALLOW_LIST)).toEqual([]);
  });

  it('[TASK-291] the allow-list holds no file of tests/generated: the generated suites use fetchOnce', () => {
    expect(ALLOW_LIST.filter((entry) => entry.file.startsWith('tests/generated/'))).toEqual([]);
  });

  it('[TASK-291] the allow-list never grows beyond the pinned ceiling of 10 entries', () => {
    expect(ALLOW_LIST.length).toBeLessThanOrEqual(PINNED_CEILING.length);
    expect(ALLOW_LIST.map((entry) => entry.file).filter((file) => !PINNED_CEILING.includes(file))).toEqual([]);
  });

  it('[TASK-291] every entry names the folder lock of the task that converts it, with no duplicate and in sorted order', () => {
    expect(ALLOW_LIST.filter((entry) => entry.lock.trim() === '')).toEqual([]);
    const files = ALLOW_LIST.map((entry) => entry.file);
    expect(new Set(files).size).toBe(files.length);
    expect(files).toEqual([...files].sort());
  });

  it('[TASK-291] the generated suites of this task use fetchOnce and closeLoopbackServer', () => {
    for (const file of ['tests/generated/route-metadata.test.ts', 'tests/generated/rls/api-cases.ts']) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      expect(text).toContain('fetchOnce');
      expect(callsGlobalFetchOnLoopback(text)).toBe(false);
    }
    for (const file of [
      'tests/generated/route-metadata.test.ts',
      'tests/generated/rls/api-cases.test.ts',
      'tests/generated/rls/cross-tenant.int.test.ts',
    ]) {
      expect(readFileSync(join(ROOT, file), 'utf8')).toContain('closeLoopbackServer(');
    }
  });
});

describe('pooled-fetch scanner (seeded defects, TASK-291)', () => {
  it.each([
    ['a bare fetch against a literal loopback address', 'const r = await fetch(`http://127.0.0.1:${String(port)}/x`);'],
    ['a fetch against a base built from a listening server', 'const s = app.listen(0);\nawait fetch(`${base}/x`);'],
    ['a globalThis.fetch call', "const s = createServer().listen(0);\nawait globalThis.fetch('http://localhost:1/');"],
    ['a fetch against a stub server url', 'await fetch(`${server.url}/health`);'],
  ])('flags %s', (_title, text) => {
    expect(callsGlobalFetchOnLoopback(text)).toBe(true);
  });

  it.each([
    ['fetchOnce', 'await fetchOnce(`http://127.0.0.1:${String(port)}/x`);'],
    ['a method named fetch', 'await client.fetch(`http://127.0.0.1:1/x`);'],
    ['a fetch with no loopback marker', 'await fetch(url);'],
    ['a fetch only in a comment', '// fetch(`http://127.0.0.1:1/`)\n/* fetch(`${base}`) */\nconst x = 1;'],
  ])('does not flag %s', (_title, text) => {
    expect(callsGlobalFetchOnLoopback(text)).toBe(false);
  });

  it('keeps a URL scheme separator inside a string when it strips comments', () => {
    expect(withoutComments("const u = 'http://127.0.0.1:1'; // note")).toContain('http://127.0.0.1:1');
  });

  it('scopes to source files under apps, packages, tests and tools, never fixtures, dist or this scanner', () => {
    expect(inScanScope('apps/api/src/a.test.ts')).toBe(true);
    expect(inScanScope('tools/quality/heavy.mjs')).toBe(true);
    expect(inScanScope('prisma/tests/x.ts')).toBe(false);
    expect(inScanScope('tests/fixtures/semgrep/outbound-http.ts')).toBe(false);
    expect(inScanScope('apps/api/dist/x.js')).toBe(false);
    expect(inScanScope('tests/generated/loopback-scan.ts')).toBe(false);
    expect(inScanScope('docs/readme.md')).toBe(false);
  });

  it('reports a new user and a stale entry, and nothing when the list matches', () => {
    const allowed: AllowListEntry[] = [{ file: 'a.ts', lock: 'l' }];
    expect(ratchetFindings(['a.ts'], allowed)).toEqual([]);
    expect(ratchetFindings(['a.ts', 'b.ts'], allowed)).toHaveLength(1);
    expect(ratchetFindings([], allowed)).toEqual([expect.stringContaining('a.ts: converted or removed')]);
  });
});
