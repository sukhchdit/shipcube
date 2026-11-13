/**
 * openapi-breaking (NFR-MAINT-004, PR #21 R1-m6, D-ORCH-023 (1); PR #33 R1-M1, R1-M2, PR33-SEC-02..04): the pure
 * decision, the release-tag choice, the record rule, the oasdiff output parser, the docker arguments and spec-folder
 * modes, and the git plumbing against throw-away repositories with a fake Docker runner. The real image runs in
 * openapi-breaking.int.test.ts (integration project).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import {
  CONTRACT_PATH,
  NO_TAG,
  OASDIFF_IMAGE,
  SPEC_DIR_MODE,
  SPEC_FILE_MODE,
  changeKey,
  checkOpenapiBreaking,
  clean,
  compareReleaseTags,
  decide,
  isAccepted,
  latestReleaseTag,
  namesKey,
  oasdiffArgs,
  parseArgs,
  parseOasdiffJson,
  toMarkdown,
  writeSpecsDir,
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
const record = (status: string, names: string): string =>
  `# ADR-0099\n\n- **Status:** ${status}\n- Supersedes: ADR-0016 section 1 for ${names}\n`;
const SUPERSEDING = record('Accepted', 'getB');
const ADR = 'docs/03-architecture/adr/ADR-0099-v2.md';

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

  it('[D-TASK015-03] an Accepted ADR with a Supersedes line naming every broken operationId is the record', () => {
    const adrs = [{ path: ADR, text: SUPERSEDING }];
    expect(decide({ tag: 'v1.0.0', changes: [removed], adrs })).toMatchObject({ verdict: 'pass', records: [ADR] });
  });

  it('[D-TASK015-03] mutation: no Supersedes line, an ADR that misses an operation, or a non-ADR file is not a record', () => {
    const other: Change = { ...removed, operationId: 'getC', path: '/api/v1/c' };
    const cases = [
      [{ path: ADR, text: '# ADR-0099\n\n- **Status:** Accepted\n\ngetB is removed.\n' }],
      [{ path: ADR, text: '- **Status:** Accepted\nSupersedes nothing for getB\n' }],
      [{ path: 'docs/03-architecture/api/README.md', text: SUPERSEDING }],
    ];
    for (const adrs of cases) expect(decide({ tag: 'v1.0.0', changes: [removed], adrs }).verdict).toBe('fail');
    const partial = decide({ tag: 'v1.0.0', changes: [removed, other], adrs: [{ path: ADR, text: SUPERSEDING }] });
    expect(partial).toMatchObject({ verdict: 'fail', uncovered: [other] });
    expect(partial.message).toContain('not named by the superseding ADR record(s)');
  });

  it('[R1-M2] [PR33-SEC-03] a record must be Accepted: Proposed, Superseded, Draft or no status line is refused', () => {
    expect(isAccepted(SUPERSEDING)).toBe(true);
    expect(isAccepted('# ADR\n\n- **Status:** Accepted (design seam; build is M3)\n')).toBe(true);
    expect(isAccepted('Status: Accepted\n')).toBe(true);
    for (const status of ['Proposed', 'Superseded by ADR-0100', 'Draft', 'Rejected', 'Not Accepted']) {
      expect([status, isAccepted(record(status, 'getB'))]).toEqual([status, false]);
      expect(decide({ tag: 'v1.0.0', changes: [removed], adrs: [{ path: ADR, text: record(status, 'getB') }] }).verdict).toBe('fail');
    }
    expect(isAccepted('# ADR-0099\n\n- Supersedes: ADR-0016 for getB\n')).toBe(false);
    // The FIRST status line counts: a later "Status: Accepted" in a table or quote does not rescue a Proposed ADR.
    expect(isAccepted('- **Status:** Proposed\n\nStatus: Accepted\n')).toBe(false);
  });

  it('[R1-M2] (c) the record names an operation as a whole identifier, not a substring', () => {
    const covers = (names: string, change: Change) =>
      decide({ tag: 'v1.0.0', changes: [change], adrs: [{ path: ADR, text: record('Accepted', names) }] }).verdict;
    expect(covers('getBList only', removed)).toBe('fail');
    expect(covers('xgetB', removed)).toBe('fail');
    expect(covers('get_getB', removed)).toBe('fail');
    expect(covers('getB-v2', removed)).toBe('fail');
    expect(covers('getB, getC.', removed)).toBe('pass');
    expect(covers('`getB`', removed)).toBe('pass');
    const byPath: Change = { ...removed, operationId: '' };
    expect(covers('GET /api/v1/b/{id}', byPath)).toBe('fail');
    expect(covers('GET /api/v1/bc', byPath)).toBe('fail');
    expect(covers('GET /api/v1/b (removed)', byPath)).toBe('pass');
    expect(namesKey('a.b+c', 'a.b+c')).toBe(true);
    expect(namesKey('aXb+c', 'a.b+c')).toBe(false);
  });

  it('changeKey falls back to METHOD /path and then the rule id; the summary lists each error', () => {
    expect(changeKey(removed)).toBe('getB');
    expect(changeKey({ ...removed, operationId: '' })).toBe('GET /api/v1/b');
    expect(changeKey({ ...removed, operationId: '', operation: '', path: '' })).toBe(removed.id);
    const markdown = toMarkdown(decide({ tag: 'v1.0.0', changes: [removed], adrs: [] }));
    expect(markdown).toContain('### OpenAPI breaking changes (oasdiff, NFR-MAINT-004): FAIL');
    expect(markdown).toContain('| `api-path-removed-without-deprecation` | `getB` | no record |');
  });

  it('[PR33-SEC-04] PR-controlled strings cannot start a workflow command line or break the summary table', () => {
    const forged: Change = { ...removed, text: 'x\n::warning title=y::forged\r\n::add-mask::z', operationId: 'a|b`c\n::error::q' };
    expect(clean(forged.text).split('\n')).toHaveLength(1);
    expect(clean('a\u0085b\u2028c\u2029d\u007fe\u0000f')).toBe('a b c d e f');
    const markdown = toMarkdown(decide({ tag: 'v1.0.0', changes: [forged], adrs: [] }));
    expect(markdown.split('\n').filter((line) => line.startsWith('::'))).toEqual([]);
    expect(markdown).toContain('| `a\\|b\\`c ::error::q` |');
  });
});

describe('release tags and arguments', () => {
  it('[R1-M2] (b) only strict v<major>.<minor>.<patch>[-<pre>] names count, highest by semver precedence', () => {
    expect(latestReleaseTag('v1.2.0\nv1.10.0\n')).toBe('v1.10.0');
    expect(latestReleaseTag('v0.1.0-m0\nv0.1.0-rc1\nvnext\n')).toBe('v0.1.0-rc1');
    expect(latestReleaseTag('v1\nv1.2\nv1.2.3.4\nv1.2.3+build\nvnext\nv1.2.3-\nV1.2.3\n v2.0.0x\n')).toBeUndefined();
    expect(latestReleaseTag('v1.0.0-rc.1\nv1.0.0\n')).toBe('v1.0.0');
    expect(latestReleaseTag('\n\n')).toBeUndefined();
    const ordered = ['v0.9.9', 'v1.0.0-1', 'v1.0.0-alpha', 'v1.0.0-alpha.1', 'v1.0.0-alpha.beta', 'v1.0.0-rc.2', 'v1.0.0-rc.10', 'v1.0.0'];
    expect([...ordered].reverse().sort(compareReleaseTags)).toEqual(ordered);
    expect(compareReleaseTags('v99999999999999999999.0.0', 'v99999999999999999998.0.0')).toBe(1);
    expect(() => compareReleaseTags('vnext', 'v1.0.0')).toThrow(/not a release tag/u);
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
    expect(args.join(' ')).toContain('--security-opt no-new-privileges');
    expect(args).toContain('type=bind,source=/tmp/specs,target=/specs,readonly');
    expect(args.slice(-6)).toEqual([OASDIFF_IMAGE, 'breaking', '/specs/base.yaml', '/specs/head.yaml', '--format', 'json']);
    expect(() => oasdiffArgs('docker.io/tufin/oasdiff:v1.35.0', '/tmp/specs')).toThrow(/digest/u);
    expect(() => oasdiffArgs(OASDIFF_IMAGE, '/tmp/a,b')).toThrow(/comma/u);
  });

  it('[R1-M1] [PR33-SEC-02] the spec folder is 0755 and its two files 0644, so uid 65534 can read them on Linux', () => {
    const calls: [string, number][] = [];
    const dir = writeSpecsDir('base: 1\n', 'head: 2\n', {
      chmod: (path, mode) => {
        calls.push([path, mode]);
      },
    });
    try {
      expect([SPEC_DIR_MODE, SPEC_FILE_MODE]).toEqual([0o755, 0o644]);
      expect(calls).toEqual([
        [join(dir, 'base.yaml'), 0o644],
        [join(dir, 'head.yaml'), 0o644],
        [dir, 0o755],
      ]);
      expect(readFileSync(join(dir, 'base.yaml'), 'utf8')).toBe('base: 1\n');
      expect(readFileSync(join(dir, 'head.yaml'), 'utf8')).toBe('head: 2\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const real = writeSpecsDir('a\n', 'b\n');
    try {
      // POSIX hosts store the modes (Windows keeps only a read-only bit; the injected chmod above covers it there).
      if (process.platform !== 'win32') {
        expect(statSync(real).mode & 0o777).toBe(0o755);
        for (const name of ['base.yaml', 'head.yaml']) expect(statSync(join(real, name)).mode & 0o777).toBe(0o644);
      }
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  });

  it('[R1-m6] the script pin equals ci.yml OASDIFF_IMAGE, and the lane A step passes it', () => {
    const ci = readFileSync(join(findRepoRoot(), '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain(`  OASDIFF_IMAGE: ${OASDIFF_IMAGE}\n`);
    expect(ci).toContain(
      '        run: node "$GATE_OPENAPI_BREAKING" --root "$GITHUB_WORKSPACE" --base "$RANGE_BASE" --head "$RANGE_HEAD" --image "$OASDIFF_IMAGE" --summary "$GITHUB_STEP_SUMMARY"\n',
    );
  });

  it('parseArgs requires --base and rejects unknown flags and dash-led values', () => {
    expect(() => parseArgs([])).toThrow('--base');
    expect(() => parseArgs(['--base', 'main', '--all'])).toThrow('unknown argument');
    expect(() => parseArgs(['--base', '-x'])).toThrow('needs a value');
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
      [
        ...['-c', 'core.autocrlf=false', '-c', 'user.email=t@example.invalid', '-c', 'user.name=t'],
        ...['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args],
      ],
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
  /** A fake `docker run` that records each call and the two spec texts it would have mounted. */
  const fake = (stdout: string | ((specs: { base: string; head: string }) => string), status = 0) => {
    const calls: string[][] = [];
    const specs: { base: string; head: string }[] = [];
    const runner = (args: readonly string[]) => {
      calls.push([...args]);
      const mount = args.find((arg) => arg.startsWith('type=bind,source=')) ?? '';
      const dir = mount.slice('type=bind,source='.length, mount.indexOf(',target='));
      const seen = { base: readFileSync(join(dir, 'base.yaml'), 'utf8'), head: readFileSync(join(dir, 'head.yaml'), 'utf8') };
      specs.push(seen);
      return { status, stdout: typeof stdout === 'string' ? stdout : stdout(seen), stderr: status === 0 ? '' : 'boom' };
    };
    return { calls, specs, runner };
  };
  const mountDir = (args: readonly string[]) => {
    const mount = args.find((arg) => arg.startsWith('type=bind,source=')) ?? '';
    return mount.slice('type=bind,source='.length, mount.indexOf(',target='));
  };

  it('[R1-M1] without a release tag a smoke run compares the head contract with itself, then skips', () => {
    const { root, git, write, commit } = repo();
    git('tag', 'not-a-release');
    git('tag', 'vnext');
    write(CONTRACT_PATH, 'openapi: 3.1.0\n# head\n');
    commit();
    const { calls, specs, runner } = fake('[]');
    const decision = checkOpenapiBreaking({ root, base: 'main', runner });
    expect(decision).toMatchObject({ verdict: 'skip', message: NO_TAG });
    expect(decision.smoke).toContain('compared the head contract with itself');
    expect(calls).toHaveLength(1);
    expect(specs).toEqual([{ base: 'openapi: 3.1.0\n# head\n', head: 'openapi: 3.1.0\n# head\n' }]);
    expect(existsSync(mountDir(calls[0] ?? []))).toBe(false);
    expect(toMarkdown(decision)).toContain('PASS (no release tag)');
  });

  it('[R1-M1] the smoke run fails closed: a non-zero exit (EACCES on the mount) or an ERR change is an error', () => {
    const { root } = repo();
    expect(() => checkOpenapiBreaking({ root, base: 'main', runner: fake('', 102).runner })).toThrow(/oasdiff exited 102/u);
    expect(() => checkOpenapiBreaking({ root, base: 'main', runner: fake(JSON.stringify([removed])).runner })).toThrow(/smoke/u);
  });

  it('[PR33-SEC-03] (i) only the pinned OASDIFF_IMAGE is accepted, even another digest-pinned image', () => {
    const { root } = repo();
    const other = `docker.io/library/alpine:3@sha256:${'a'.repeat(64)}`;
    const { calls, runner } = fake('[]');
    expect(() => checkOpenapiBreaking({ root, base: 'main', image: other, runner })).toThrow(/pinned OASDIFF_IMAGE/u);
    expect(calls).toEqual([]);
    expect(() => checkOpenapiBreaking({ root, base: 'no-such-ref', runner })).toThrow(/is not a commit/u);
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
    expect(broken.specs).toEqual([{ base: 'openapi: 3.1.0\n# head\n', head: 'openapi: 3.1.0\n# feature\n' }]);

    write(ADR, SUPERSEDING);
    commit();
    expect(checkOpenapiBreaking({ root, base: 'main', runner: fake(JSON.stringify([removed])).runner })).toMatchObject({
      verdict: 'pass',
      records: [ADR],
    });
    write(ADR, record('Proposed', 'getB'));
    commit();
    expect(checkOpenapiBreaking({ root, base: 'main', runner: fake(JSON.stringify([removed])).runner }).verdict).toBe('fail');
  });

  it('[R1-M2] (b) [PR33-SEC-03] (ii) a tag not merged into the base, or a junk v* tag, is never the baseline', () => {
    const { root, write, commit, git } = repo();
    git('tag', 'v1.0.0');
    git('checkout', '-q', '-b', 'feature');
    write(CONTRACT_PATH, 'openapi: 3.1.0\n# weaker\n');
    commit();
    git('tag', 'v9.0.0');
    git('tag', 'vnext');
    write(CONTRACT_PATH, 'openapi: 3.1.0\n# feature\n');
    commit();
    const run = fake(JSON.stringify([removed]));
    expect(checkOpenapiBreaking({ root, base: 'main', runner: run.runner })).toMatchObject({ verdict: 'fail', tag: 'v1.0.0' });
    expect(run.specs[0]?.base).toBe('openapi: 3.1.0\n');
    // Only an unmerged tag: no baseline at all, so the smoke run (head against itself) happens instead.
    git('tag', '-d', 'v1.0.0');
    const smoke = fake('[]');
    expect(checkOpenapiBreaking({ root, base: 'main', runner: smoke.runner })).toMatchObject({ verdict: 'skip' });
    expect(smoke.specs[0]?.base).toBe('openapi: 3.1.0\n# feature\n');
  });

  it('[R1-M2] (a) a sanctioned break stays sanctioned for later PRs until the next tag; a new break still fails', () => {
    const { root, write, commit, git } = repo();
    git('tag', 'v0.1.0-m0');
    // PR1 removes getB with an Accepted superseding ADR, and merges.
    git('checkout', '-q', '-b', 'pr1');
    write(CONTRACT_PATH, 'openapi: 3.1.0\n# without getB\n');
    write(ADR, SUPERSEDING);
    commit();
    expect(checkOpenapiBreaking({ root, base: 'main', runner: fake(JSON.stringify([removed])).runner }).verdict).toBe('pass');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', 'merge pr1', 'pr1');
    // PR2 changes only a README: oasdiff still reports PR1's break against the tag, and PR1's record still covers it.
    git('checkout', '-q', '-b', 'pr2');
    write('README.md', 'docs only\n');
    commit();
    expect(checkOpenapiBreaking({ root, base: 'main', runner: fake(JSON.stringify([removed])).runner })).toMatchObject({
      verdict: 'pass',
      records: [ADR],
    });
    // PR3 adds a second, unrecorded break: it fails on that one only.
    const getC: Change = { ...removed, operationId: 'getC', path: '/api/v1/c' };
    write(CONTRACT_PATH, 'openapi: 3.1.0\n# without getB and getC\n');
    commit();
    expect(checkOpenapiBreaking({ root, base: 'main', runner: fake(JSON.stringify([removed, getC])).runner })).toMatchObject({
      verdict: 'fail',
      uncovered: [getC],
    });
    // After the next tag the old record no longer counts (tag..head no longer contains it).
    git('checkout', '-q', 'main');
    git('tag', 'v0.2.0-m1');
    git('checkout', '-q', 'pr2');
    expect(checkOpenapiBreaking({ root, base: 'main', runner: fake(JSON.stringify([removed])).runner }).verdict).toBe('fail');
  });

  it('[D-TASK015-03] an ADR already released with the tag is not a record for a new break', () => {
    const { root, write, commit, git } = repo();
    write(ADR, SUPERSEDING);
    commit();
    git('tag', 'v1.0.0');
    git('checkout', '-q', '-b', 'feature');
    write(CONTRACT_PATH, 'openapi: 3.1.0\n# feature\n');
    commit();
    expect(checkOpenapiBreaking({ root, base: 'main', runner: fake(JSON.stringify([removed])).runner }).verdict).toBe('fail');
  });

  it('fails closed: oasdiff exiting non-zero, a tag without the contract or a head without it is an error', () => {
    const { root, git, write, commit } = repo();
    git('tag', 'v1.0.0');
    expect(() => checkOpenapiBreaking({ root, base: 'main', runner: fake('', 2).runner })).toThrow(/oasdiff exited 2/u);
    git('rm', '-q', CONTRACT_PATH);
    write('README.md', 'x\n');
    commit();
    expect(() => checkOpenapiBreaking({ root, base: 'main', runner: fake('[]').runner })).toThrow(/HEAD has no/u);
    git('tag', 'v1.1.0');
    write(CONTRACT_PATH, 'openapi: 3.1.0\n');
    commit();
    expect(() => checkOpenapiBreaking({ root, base: 'main', runner: fake('[]').runner })).toThrow(/release tag v1\.1\.0 has no/u);
  });
});
