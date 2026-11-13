/**
 * openapi-breaking (NFR-MAINT-004, PR #21 R1-m6, D-ORCH-023 (1)): the pure decision, the oasdiff output parser, the
 * docker arguments, and the git plumbing against throw-away repositories with a fake Docker runner. The real image runs
 * in openapi-breaking.int.test.ts (integration project).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import {
  CONTRACT_PATH,
  NO_TAG,
  OASDIFF_IMAGE,
  changeKey,
  checkOpenapiBreaking,
  decide,
  latestReleaseTag,
  oasdiffArgs,
  parseArgs,
  parseOasdiffJson,
  toMarkdown,
} from './openapi-breaking.mjs';

type Change = ReturnType<typeof parseOasdiffJson>[number];
const removed: Change = {
  id: 'api-path-removed-without-deprecation',
  text: 'api path removed without deprecation',
  level: 3,
  operation: 'GET',
  operationId: 'getB',
  path: '/api/v1/b',
};
const warning: Change = { ...removed, id: 'response-optional-property-removed', level: 2, operationId: 'getA' };
const SUPERSEDING = '# ADR-0099\n\n- Supersedes: ADR-0016 section 1 for getB\n';

describe('decide (pure)', () => {
  it('[R1-m6] no release tag: skip with "no release tag"', () => {
    expect(decide({ tag: undefined, changes: [removed], adrs: [] })).toMatchObject({ verdict: 'skip', message: NO_TAG });
  });

  it('[NFR-MAINT-004] only ERR-level changes break; WARN/INFO pass', () => {
    expect(decide({ tag: 'v0.1.0-m0', changes: [warning], adrs: [] }).verdict).toBe('pass');
    expect(decide({ tag: 'v0.1.0-m0', changes: [warning, removed], adrs: [] })).toMatchObject({
      verdict: 'fail',
      errors: [removed],
      uncovered: [removed],
    });
  });

  it('[D-TASK015-03] a changed ADR with a Supersedes line naming every broken operationId is the record', () => {
    const adrs = [{ path: 'docs/03-architecture/adr/ADR-0099-v2.md', text: SUPERSEDING }];
    expect(decide({ tag: 'v1.0.0', changes: [removed], adrs })).toMatchObject({ verdict: 'pass', records: [adrs[0]?.path] });
  });

  it('[D-TASK015-03] mutation: no Supersedes line, an ADR that misses an operation, or a non-ADR file is not a record', () => {
    const other: Change = { ...removed, operationId: 'getC', path: '/api/v1/c' };
    const cases = [
      [{ path: 'docs/03-architecture/adr/ADR-0099-v2.md', text: '# ADR-0099\n\ngetB is removed.\n' }],
      [{ path: 'docs/03-architecture/adr/ADR-0099-v2.md', text: 'Supersedes nothing for getB\n' }],
      [{ path: 'docs/03-architecture/api/README.md', text: SUPERSEDING }],
    ];
    for (const adrs of cases) expect(decide({ tag: 'v1.0.0', changes: [removed], adrs }).verdict).toBe('fail');
    const partial = decide({
      tag: 'v1.0.0',
      changes: [removed, other],
      adrs: [{ path: 'docs/03-architecture/adr/ADR-0099-v2.md', text: SUPERSEDING }],
    });
    expect(partial).toMatchObject({ verdict: 'fail', uncovered: [other] });
    expect(partial.message).toContain('not named by the superseding ADR record(s)');
  });

  it('changeKey falls back to METHOD /path and then the rule id; the summary lists each error', () => {
    expect(changeKey(removed)).toBe('getB');
    expect(changeKey({ ...removed, operationId: '' })).toBe('GET /api/v1/b');
    expect(changeKey({ ...removed, operationId: '', operation: '', path: '' })).toBe(removed.id);
    const markdown = toMarkdown(decide({ tag: 'v1.0.0', changes: [removed], adrs: [] }));
    expect(markdown).toContain('### OpenAPI breaking changes (oasdiff, NFR-MAINT-004): FAIL');
    expect(markdown).toContain('| `api-path-removed-without-deprecation` | `getB` | no record |');
  });
});

describe('parsing and arguments', () => {
  it('latestReleaseTag takes the first line of the version-sorted listing', () => {
    expect(latestReleaseTag('v1.2.0\nv1.10.0\n')).toBe('v1.2.0');
    expect(latestReleaseTag('\n\n')).toBeUndefined();
  });

  it('parseOasdiffJson validates the shape and fails closed', () => {
    expect(parseOasdiffJson('')).toEqual([]);
    expect(parseOasdiffJson(JSON.stringify([{ ...removed, baseSource: { line: 9 } }]))).toEqual([removed]);
    for (const bad of ['{}', '[1]', '[{"id":"x"}]', '[{"level":3}]', 'not json']) expect(() => parseOasdiffJson(bad)).toThrow();
  });

  it('[R1-m6] oasdiff runs digest-pinned, without network, read-only, without capabilities and as a non-root user', () => {
    const args = oasdiffArgs(OASDIFF_IMAGE, '/tmp/specs');
    expect(args.slice(0, 2)).toEqual(['run', '--rm']);
    for (const flag of [['--network', 'none'], ['--read-only'], ['--cap-drop', 'ALL'], ['--user', '65534:65534']]) {
      expect(args.join(' ')).toContain(flag.join(' '));
    }
    expect(args).toContain('type=bind,source=/tmp/specs,target=/specs,readonly');
    expect(args.slice(-6)).toEqual([OASDIFF_IMAGE, 'breaking', '/specs/base.yaml', '/specs/head.yaml', '--format', 'json']);
    expect(() => oasdiffArgs('docker.io/tufin/oasdiff:v1.35.0', '/tmp/specs')).toThrow(/digest/u);
    expect(() => oasdiffArgs(OASDIFF_IMAGE, '/tmp/a,b')).toThrow(/comma/u);
  });

  it('[R1-m6] the script pin equals ci.yml OASDIFF_IMAGE, and the lane A step passes it', () => {
    const ci = readFileSync(join(findRepoRoot(), '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain(`  OASDIFF_IMAGE: ${OASDIFF_IMAGE}\n`);
    expect(ci).toMatch(
      /node "\$GATE_OPENAPI_BREAKING" --root "\$GITHUB_WORKSPACE" --base "\$RANGE_BASE" --head "\$RANGE_HEAD" --image "\$OASDIFF_IMAGE"/u,
    );
  });

  it('parseArgs requires --base and rejects unknown flags', () => {
    expect(() => parseArgs([])).toThrow('--base');
    expect(() => parseArgs(['--base', 'main', '--all'])).toThrow('unknown argument');
    expect(parseArgs(['--base', 'main', '--image', OASDIFF_IMAGE])).toMatchObject({ base: 'main', image: OASDIFF_IMAGE });
  });
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repo(): { root: string; write: (path: string, text: string) => void; commit: () => void; git: (...args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), 'openapi-breaking-'));
  roots.push(root);
  const git = (...args: string[]): string =>
    execFileSync(
      'git',
      ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const commit = (): void => {
    git('add', '-A');
    git('commit', '-q', '-m', 'x');
  };
  git('init', '-q', '-b', 'main');
  write(CONTRACT_PATH, 'openapi: 3.1.0\n');
  commit();
  return { root, write, commit, git };
}

describe('checkOpenapiBreaking (git plumbing, fake Docker)', () => {
  const fake = (stdout: string, status = 0) => {
    const calls: string[][] = [];
    const runner = (args: readonly string[]) => {
      calls.push([...args]);
      return { status, stdout, stderr: status === 0 ? '' : 'boom' };
    };
    return { calls, runner };
  };

  it('[R1-m6] without a v* tag the check skips and never starts Docker', () => {
    const { root, git } = repo();
    git('tag', 'not-a-release');
    const { calls, runner } = fake('[]');
    expect(checkOpenapiBreaking({ root, base: 'main', runner })).toMatchObject({ verdict: 'skip', message: NO_TAG });
    expect(calls).toEqual([]);
  });

  it('[NFR-MAINT-004] compares against the latest tag; a breaking change without a record fails, the ADR record passes', () => {
    const { root, write, commit, git } = repo();
    git('tag', 'v0.1.0-m0');
    write(CONTRACT_PATH, 'openapi: 3.1.0\n# head\n');
    commit();
    git('tag', 'v0.2.0-m1');
    git('checkout', '-q', '-b', 'feature');
    write(CONTRACT_PATH, 'openapi: 3.1.0\n# feature\n');
    commit();
    const broken = fake(JSON.stringify([removed]));
    expect(checkOpenapiBreaking({ root, base: 'main', runner: broken.runner })).toMatchObject({ verdict: 'fail', tag: 'v0.2.0-m1' });
    expect(broken.calls).toHaveLength(1);

    write('docs/03-architecture/adr/ADR-0099-v2.md', SUPERSEDING);
    commit();
    expect(checkOpenapiBreaking({ root, base: 'main', runner: fake(JSON.stringify([removed])).runner })).toMatchObject({
      verdict: 'pass',
      records: ['docs/03-architecture/adr/ADR-0099-v2.md'],
    });
  });

  it("[D-TASK015-03] an ADR already on the base is not this PR's record", () => {
    const { root, write, commit, git } = repo();
    write('docs/03-architecture/adr/ADR-0099-v2.md', SUPERSEDING);
    commit();
    git('tag', 'v1.0.0');
    git('checkout', '-q', '-b', 'feature');
    write(CONTRACT_PATH, 'openapi: 3.1.0\n# feature\n');
    commit();
    expect(checkOpenapiBreaking({ root, base: 'main', runner: fake(JSON.stringify([removed])).runner }).verdict).toBe('fail');
  });

  it('fails closed: oasdiff exiting non-zero or a tag without the contract is an error', () => {
    const { root, git, write, commit } = repo();
    git('tag', 'v1.0.0');
    expect(() => checkOpenapiBreaking({ root, base: 'main', runner: fake('', 2).runner })).toThrow(/oasdiff exited 2/u);
    git('rm', '-q', CONTRACT_PATH);
    write('README.md', 'x\n');
    commit();
    git('tag', 'v1.1.0');
    expect(() => checkOpenapiBreaking({ root, base: 'main', runner: fake('[]').runner })).toThrow(/release tag v1\.1\.0 has no/u);
  });
});
