/**
 * Node security-release comparison (PR87-SEC-01 (b), D-DEVOPS-005): the pure status function, the pin reader, the
 * bounded fetch and the CLI exit codes (0 current, 1 behind, 2 cannot run). No test touches the network.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { CheckError, NODE_INDEX_URL, fetchNodeIndex, nodeSecurityStatus, pinnedNodeVersion, run } from './check-node-security.mjs';

const repoRoot = findRepoRoot();
const DIGEST = `@sha256:${'a'.repeat(64)}`;
/** The shape of https://nodejs.org/dist/index.json (newest first), trimmed to the fields the check reads. */
const INDEX = [
  { version: 'v26.13.1', date: '2026-11-10', security: true },
  { version: 'v26.13.0', date: '2026-10-28', security: false },
  { version: 'v24.22.3', date: '2026-11-10', security: true },
  { version: 'v24.22.2', date: '2026-10-27', security: false },
  { version: 'v24.22.1', date: '2026-10-20', security: true },
  { version: 'v24.22.0', date: '2026-10-14', security: false },
];

const withRoot = (nodeTags: readonly string[], body: (root: string) => void | Promise<void>) => async () => {
  const root = mkdtempSync(join(tmpdir(), 'check-node-security-'));
  try {
    nodeTags.forEach((tag, i) => {
      const dir = join(root, 'apps', `app${String(i)}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'Dockerfile'), `FROM node:${tag}-trixie-slim${DIGEST} AS base\nFROM base\nUSER node\n`);
    });
    writeFileSync(join(root, 'index.json'), JSON.stringify(INDEX));
    await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe('nodeSecurityStatus', () => {
  it('a pin on the newest security release is current', () => {
    expect(nodeSecurityStatus(INDEX, '24.22.3')).toEqual({
      major: 24,
      pinned: '24.22.3',
      newest: '24.22.3',
      newestSecurity: '24.22.3',
      newestSecurityDate: '2026-11-10',
      behind: false,
    });
  });

  it('a pin below the newest security release of its major is behind; a later non-security patch is not required', () => {
    expect(nodeSecurityStatus(INDEX, '24.22.2')).toMatchObject({ newestSecurity: '24.22.3', behind: true });
    expect(nodeSecurityStatus(INDEX, '24.22.0')).toMatchObject({ behind: true });
    const nonSecurityNewest = [{ version: 'v24.22.4', security: false }, ...INDEX];
    expect(nodeSecurityStatus(nonSecurityNewest, '24.22.3')).toMatchObject({ newest: '24.22.4', newestSecurity: '24.22.3', behind: false });
  });

  it('compares numerically and only within the major of the pin', () => {
    const index = [
      { version: 'v24.9.0', security: true },
      { version: 'v24.10.0', security: true },
      { version: 'v26.13.1', security: true },
    ];
    expect(nodeSecurityStatus(index, '24.9.0')).toMatchObject({ newestSecurity: '24.10.0', behind: true });
    expect(nodeSecurityStatus(index, '26.13.1')).toMatchObject({ newestSecurity: '26.13.1', behind: false });
  });

  it('a major with no security release yet is not behind', () => {
    expect(nodeSecurityStatus([{ version: 'v24.0.0', security: false }], '24.0.0')).toMatchObject({
      newestSecurity: undefined,
      behind: false,
    });
  });

  it.each([
    ['not an array', { versions: [] }, '24.22.3', 'not an array'],
    ['an entry without a version', [{ security: true }], '24.22.3', 'without a string version'],
    ['no release of the major', INDEX, '22.1.0', 'no release of Node 22'],
    ['a partial pin', INDEX, '24', 'not a full'],
  ])('fails closed on %s', (_name, index, pinned, message) => {
    expect(() => nodeSecurityStatus(index, pinned)).toThrow(CheckError);
    expect(() => nodeSecurityStatus(index, pinned)).toThrow(message);
  });
});

describe('pinnedNodeVersion', () => {
  it('reads the one node base version of the repository (the ADR-0001 pin)', () => {
    expect(pinnedNodeVersion(repoRoot)).toBe('24.22.3');
  });

  it(
    'identical pins across files give one version',
    withRoot(['24.22.3', '24.22.3'], (root) => {
      expect(pinnedNodeVersion(root)).toBe('24.22.3');
    }),
  );

  it(
    'differing pins fail closed',
    withRoot(['24.22.3', '24.22.2'], (root) => {
      expect(() => pinnedNodeVersion(root)).toThrow('found 2');
    }),
  );

  it(
    'no node pin fails closed',
    withRoot([], (root) => {
      expect(() => pinnedNodeVersion(root)).toThrow('found 0');
    }),
  );

  it(
    'a partial pin fails closed',
    withRoot(['24'], (root) => {
      expect(() => pinnedNodeVersion(root)).toThrow('not a full');
    }),
  );
});

describe('fetchNodeIndex', () => {
  const response = (status: number, body: unknown = INDEX) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('GETs index.json with a timeout signal and no redirects', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, init });
      return Promise.resolve(response(200));
    }) as typeof fetch;
    await expect(fetchNodeIndex({ fetchImpl })).resolves.toEqual(INDEX);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(NODE_INDEX_URL);
    expect(calls[0]?.init?.redirect).toBe('error');
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('retries 5xx and network errors up to three attempts, then fails closed', async () => {
    let n = 0;
    const flaky = (() => {
      n += 1;
      if (n === 1) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(n === 2 ? response(503) : response(200));
    }) as typeof fetch;
    await expect(fetchNodeIndex({ fetchImpl: flaky, retryDelayMs: 1 })).resolves.toEqual(INDEX);
    expect(n).toBe(3);
    let m = 0;
    const down = (() => {
      m += 1;
      return Promise.resolve(response(502));
    }) as typeof fetch;
    await expect(fetchNodeIndex({ fetchImpl: down, retryDelayMs: 1 })).rejects.toThrow('after 3 attempts');
    expect(m).toBe(3);
  });

  it('does not retry a 4xx other than 429', async () => {
    let n = 0;
    const notFound = (() => {
      n += 1;
      return Promise.resolve(response(404));
    }) as typeof fetch;
    await expect(fetchNodeIndex({ fetchImpl: notFound, retryDelayMs: 1 })).rejects.toThrow('HTTP 404');
    expect(n).toBe(1);
  });
});

describe('CLI', () => {
  it(
    'exits 0 on a current pin (offline --index)',
    withRoot(['24.22.3'], (root) => {
      const cli = runNode([join(repoRoot, 'tools', 'ci', 'check-node-security.mjs'), '--root', root, '--index', join(root, 'index.json')], {
        cwd: repoRoot,
      });
      expect(cli.stderr).toBe('');
      expect(cli.stdout).toContain('[check-node-security] OK: pinned node:24.22.3; newest 24.x 24.22.3; newest security release 24.22.3');
      expect(cli.status).toBe(0);
    }),
  );

  it(
    'exits 1 on a pin behind the security release and names the hand-bump rule',
    withRoot(['24.22.2'], (root) => {
      const cli = runNode([join(repoRoot, 'tools', 'ci', 'check-node-security.mjs'), '--root', root, '--index', join(root, 'index.json')], {
        cwd: repoRoot,
      });
      expect(cli.stderr).toContain('BEHIND: pinned node:24.22.2');
      expect(cli.stderr).toContain('docs/07-ops/CI-CD.md section 6');
      expect(cli.status).toBe(1);
    }),
  );

  it(
    'exits 2 when the index cannot be read',
    withRoot(['24.22.3'], async (root) => {
      const result = await run(['--root', root, '--index', join(root, 'missing.json')]);
      expect(result.code).toBe(2);
      expect(result.err).toContain('[check-node-security] ERROR:');
    }),
  );

  it(
    'uses the network fetch without --index (stubbed here)',
    withRoot(['24.22.1'], async (root) => {
      const fetchImpl = (() => Promise.resolve(new Response(JSON.stringify(INDEX), { status: 200 }))) as typeof fetch;
      const result = await run(['--root', root], { fetchImpl });
      expect(result).toMatchObject({ code: 1, out: '' });
      expect(result.err).toContain('newest security release 24.22.3 (2026-11-10)');
    }),
  );
});
