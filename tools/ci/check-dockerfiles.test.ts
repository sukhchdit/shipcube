/**
 * Static Dockerfile rules (TASK-014, US-004; platform.md §3.2/§3.4; WAVE-00 sheet lines 530, 531, 537, 543). Every rule
 * has a passing and a failing input; the real repository Dockerfiles must all pass.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import {
  assignments,
  baseCodename,
  baseImageKind,
  checkDockerfileText,
  checkRepository,
  copyParts,
  copySources,
  crossFileBaseFindings,
  instructions,
  nodeMajorFindings,
  nodeTagVersion,
  readNodePolicy,
  runtimeCodenameFindings,
  satisfiesEngines,
  stages,
  versionParts,
} from './check-dockerfiles.mjs';

const repoRoot = findRepoRoot();
const NODE = 'node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0';
const DEBIAN = 'debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2';
const OTHER_DIGEST = `@sha256:${'0'.repeat(64)}`;
const NGINX = 'nginxinc/nginx-unprivileged:1.31.7-alpine-slim@sha256:a8cb0f33d51fa107c96fd2bd3a71aaf564ec131e9d2bdf8700944f0ed8b170d7';

/** A minimal Node service Dockerfile that passes every rule; `edit` swaps lines for the negative cases. */
const good = [
  `FROM ${NODE} AS base`,
  'ENV NODE_ENV=production CHECKPOINT_DISABLE=1 SCARF_ANALYTICS=false',
  'WORKDIR /app',
  'FROM base AS deps',
  'COPY package.json package-lock.json .npmrc ./',
  'RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --include=dev',
  'FROM base AS runtime',
  'COPY --from=deps --chown=node:node /app/node_modules /app/node_modules',
  'COPY apps/api/package.json apps/api/',
  'COPY --chmod=0555 tools/docker/entrypoint.sh /app/entrypoint.sh',
  'USER node',
  'HEALTHCHECK --interval=5s CMD ["/usr/bin/env", "-u", "NODE_OPTIONS", "node", "/app/healthcheck.mjs", "api"]',
  'ENTRYPOINT ["/app/entrypoint.sh"]',
  'CMD ["dist/main.js"]',
].join('\n');
const service = { service: true, nodeService: true };
const rulesOf = (text: string, options = service) => checkDockerfileText(text, options).map((finding) => finding.rule);
const edit = (from: string, to: string) => {
  if (!good.includes(from)) throw new Error(`fixture line not found: ${from}`);
  return good.replace(from, to);
};
/** The reference with a debian runtime stage that takes only the Node binary from the node stage, as apps/api does. */
const slim = good.replace(
  'FROM base AS runtime',
  [`FROM ${DEBIAN} AS runtime`, 'ENV NODE_ENV=production', 'COPY --from=base /usr/local/bin/node /usr/local/bin/node'].join('\n'),
);
/** The Node policy of the repository root (ADR-0001), written into a scratch root for the repository-mode tests. */
const writeNodePolicy = (root: string) => {
  writeFileSync(join(root, '.node-version'), '24\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ engines: { node: '>=24.2 <25', npm: '>=11.10' } }));
};

describe('check-dockerfiles parsing helpers', () => {
  it('joins continuations, skips comment lines inside them and upper-cases instructions', () => {
    const list = instructions('# top\nrun echo a \\\n  # inner comment\n  && echo b\nCOPY a b\n');
    expect(list).toEqual([
      { instruction: 'RUN', args: 'echo a    && echo b', line: 2 },
      { instruction: 'COPY', args: 'a b', line: 5 },
    ]);
  });

  it('reads COPY sources in shell and JSON form, flags dropped', () => {
    expect(copySources('--from=build --chown=node:node /a /b ./')).toEqual(['/a', '/b']);
    expect(copySources('["a b", "c"]')).toEqual(['a b']);
  });

  it('reads ENV/ARG assignments in both forms', () => {
    expect(assignments('A=1 B="two words" C=')).toEqual([
      ['A', '1'],
      ['B', 'two words'],
      ['C', ''],
    ]);
    expect(assignments('LEGACY some value')).toEqual([['LEGACY', 'some value']]);
  });
});

describe('check-dockerfiles rules', () => {
  it('passes the reference Dockerfile', () => {
    expect(rulesOf(good)).toEqual([]);
  });

  it.each([
    ['from-digest', `FROM ${NODE} AS base`, 'FROM node:24 AS base'],
    ['from-digest', `FROM ${NODE} AS base`, 'FROM node@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS base'],
    ['from-digest', 'FROM base AS deps', 'FROM unknown-stage AS deps'],
    ['final-user', 'USER node', 'USER root'],
    ['final-user', 'USER node', 'USER 0:0'],
    ['final-user', 'USER node', ''],
    [
      'healthcheck',
      'HEALTHCHECK --interval=5s CMD ["/usr/bin/env", "-u", "NODE_OPTIONS", "node", "/app/healthcheck.mjs", "api"]',
      'HEALTHCHECK NONE',
    ],
    ['node-flags', 'CMD ["dist/main.js"]', 'CMD ["--conditions=@platform/source", "dist/main.js"]'],
    ['node-flags', 'ENTRYPOINT ["/app/entrypoint.sh"]', 'ENTRYPOINT ["node", "--experimental-vm-modules", "dist/main.js"]'],
    ['copy-explicit', 'COPY apps/api/package.json apps/api/', 'COPY . .'],
    ['copy-explicit', 'COPY apps/api/package.json apps/api/', 'COPY ./ /app/'],
    ['copy-explicit', 'COPY apps/api/package.json apps/api/', 'COPY prisma ./prisma'],
    ['copy-explicit', 'COPY apps/api/package.json apps/api/', 'COPY ["prisma/", "/app/prisma"]'],
    ['copy-env', 'COPY apps/api/package.json apps/api/', 'COPY .env.local /app/'],
    ['npm-rebuild', 'WORKDIR /app', 'RUN npm rebuild bcrypt --ignore-scripts=false'],
    ['npx', 'WORKDIR /app', 'RUN npx prisma generate'],
    ['ignore-scripts', 'npm ci --ignore-scripts --include=dev', 'npm ci --include=dev'],
    ['ignore-scripts', 'npm ci --ignore-scripts --include=dev', 'npm ci --ignore-scripts --include=dev && npm install left-pad'],
    // R1-n2: the check-install-flags predicate (npm-command.mjs npmInvocations) rejects every re-enabling spelling.
    ['ignore-scripts', 'npm ci --ignore-scripts --include=dev', 'npm ci --ignore-scripts false --include=dev'],
    ['ignore-scripts', 'npm ci --ignore-scripts --include=dev', 'npm ci --ignore-scripts=false --include=dev'],
    ['ignore-scripts', 'npm ci --ignore-scripts --include=dev', 'npm ci --no-ignore-scripts --include=dev'],
    ['ignore-scripts', 'npm ci --ignore-scripts --include=dev', 'npm clean-install --include=dev'],
    ['entrypoint', 'ENTRYPOINT ["/app/entrypoint.sh"]', ''],
    ['entrypoint', 'ENTRYPOINT ["/app/entrypoint.sh"]', 'ENTRYPOINT ["node", "dist/main.js"]'],
    ['entrypoint', 'ENTRYPOINT ["/app/entrypoint.sh"]', 'ENTRYPOINT /app/entrypoint.sh'],
    ['entrypoint', 'COPY --chmod=0555 tools/docker/entrypoint.sh /app/entrypoint.sh', 'COPY tools/docker/entrypoint.sh /app/entrypoint.sh'],
    [
      'entrypoint',
      'COPY --chmod=0555 tools/docker/entrypoint.sh /app/entrypoint.sh',
      'COPY --chmod=0755 tools/docker/entrypoint.sh /app/entrypoint.sh',
    ],
    ['secret-name', 'WORKDIR /app', 'ARG NPM_TOKEN'],
    ['secret-name', 'WORKDIR /app', 'ENV DATABASE_PASSWORD=x'],
    ['secret-name', 'WORKDIR /app', 'ENV JWT_SIGNING_KEY local'],
    ['telemetry-env', 'ENV NODE_ENV=production CHECKPOINT_DISABLE=1 SCARF_ANALYTICS=false', 'ENV NODE_ENV=production CHECKPOINT_DISABLE=1'],
    [
      'node-env',
      'ENV NODE_ENV=production CHECKPOINT_DISABLE=1 SCARF_ANALYTICS=false',
      'ENV NODE_ENV=development CHECKPOINT_DISABLE=1 SCARF_ANALYTICS=false',
    ],
  ])('%s: rejects %j -> %j', (rule, from, to) => {
    expect(rulesOf(edit(from, to))).toContain(rule);
  });

  it('allows a secret-looking name only through the explicit allow-list', () => {
    const text = edit('WORKDIR /app', 'ARG BUILDKIT_INLINE_CACHE_KEY=1');
    expect(rulesOf(text)).toContain('secret-name');
    expect(checkDockerfileText(text, { ...service, nonSecretNames: ['BUILDKIT_INLINE_CACHE_KEY'] })).toEqual([]);
  });

  it('applies the node-flags and healthcheck rules to service images only', () => {
    const text = edit('CMD ["dist/main.js"]', 'CMD ["--conditions=@platform/source", "x.js"]').replace(/^HEALTHCHECK.*$/m, '');
    expect(rulesOf(text, { service: false, nodeService: false })).toEqual([]);
  });

  it('accepts an nginx runtime with a numeric non-root UID and requires no NODE_ENV there', () => {
    const nginx = [
      `FROM ${NODE} AS build`,
      `FROM ${NGINX} AS runtime`,
      'USER root',
      'RUN rm -f /etc/nginx/conf.d/default.conf',
      'USER 101',
      'HEALTHCHECK CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/healthz"]',
    ].join('\n');
    expect(rulesOf(nginx, { service: true, nodeService: false })).toEqual([]);
    expect(rulesOf(nginx.replace('USER 101', 'USER 0'), { service: true, nodeService: false })).toEqual(['final-user']);
  });

  it('treats a Node service final stage on a slim OS base as a Node stage (NODE_ENV required, R1-03)', () => {
    const slim = good.replace(
      'FROM base AS runtime',
      'FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2 AS runtime',
    );
    expect(rulesOf(slim)).toContain('node-env');
    expect(rulesOf(slim.replace(/(AS runtime)/, '$1\nENV NODE_ENV=production'))).toEqual([]);
  });

  it('reports an empty Dockerfile', () => {
    expect(rulesOf('')).toEqual(['from-digest']);
  });
});

describe('runtime-codename (D-ARCH-116, PR #39 R3)', () => {
  const slimEdit = (from: string, to: string) => {
    if (!slim.includes(from)) throw new Error(`fixture line not found: ${from}`);
    return slim.replace(from, to);
  };
  const codenameMessages = (text: string) =>
    checkDockerfileText(text, service)
      .filter((finding) => finding.rule === 'runtime-codename')
      .map((finding) => finding.message);

  it('helpers: base image kind, codename and COPY parts', () => {
    expect(baseImageKind(NODE)).toBe('node');
    expect(baseImageKind(`docker.io/library/${DEBIAN}`)).toBe('debian');
    expect(baseImageKind('base')).toBeUndefined();
    expect(baseImageKind(NGINX)).toBeUndefined();
    expect(baseCodename(NODE)).toBe('trixie');
    expect(baseCodename(DEBIAN)).toBe('trixie');
    expect(baseCodename(`node:24-slim${OTHER_DIGEST}`)).toBeUndefined();
    expect(baseCodename(`debian:13-slim${OTHER_DIGEST}`)).toBeUndefined();
    expect(baseCodename('node:24.22.3-trixie-slim')).toBeUndefined();
    expect(copyParts('--from=base --chown=1000 /usr/local/bin/node /usr/local/bin/node')).toEqual({
      from: 'base',
      sources: ['/usr/local/bin/node'],
      destination: '/usr/local/bin/node',
    });
    expect(copyParts('["a", "b", "/c/"]')).toEqual({ from: undefined, sources: ['a', 'b'], destination: '/c/' });
  });

  it('passes the debian runtime reference and does not apply without a debian stage', () => {
    expect(rulesOf(slim)).toEqual([]);
    // The node-only reference may take anything from base: (c) is about the debian runtime.
    expect(rulesOf(edit('COPY apps/api/package.json apps/api/', 'COPY --from=base /usr/local/lib /usr/local/lib'))).toEqual([]);
    expect(runtimeCodenameFindings(stages(instructions(good)))).toEqual([]);
  });

  it.each([
    [
      'node bookworm vs debian trixie',
      `FROM ${NODE} AS base`,
      `FROM node:24.22.3-bookworm-slim${OTHER_DIGEST} AS base`,
      'codenames differ',
    ],
    [
      'node trixie vs debian bookworm',
      `FROM ${DEBIAN} AS runtime`,
      `FROM debian:bookworm-slim${OTHER_DIGEST} AS runtime`,
      'codenames differ',
    ],
    ['node tag without a codename', `FROM ${NODE} AS base`, `FROM node:24.22.3-slim${OTHER_DIGEST} AS base`, 'names no Debian codename'],
    [
      'debian tag without a codename',
      `FROM ${DEBIAN} AS runtime`,
      `FROM debian:13-slim${OTHER_DIGEST} AS runtime`,
      'names no Debian codename',
    ],
  ])('(a) %s is a finding', (_name, from, to, message) => {
    expect(codenameMessages(slimEdit(from, to))).toEqual(expect.arrayContaining([expect.stringContaining(message)]));
  });

  it.each([
    ['another file from base', 'COPY --from=base /usr/local/bin/npm /usr/local/bin/npm'],
    ['the binary to another path', 'COPY --from=base /usr/local/bin/node /usr/bin/node'],
    ['the binary plus more', 'COPY --from=base /usr/local/bin/node /usr/local/lib/node_modules /usr/local/'],
    ['a directory', 'COPY --from=base /usr/local/ /usr/local/'],
    ['JSON form, another file', 'COPY --from=base ["/usr/local/lib/node_modules", "/usr/local/lib/node_modules"]'],
    ['straight from the node image', `COPY --from=${NODE} /usr/local/lib/node_modules /usr/local/lib/node_modules`],
  ])('(c) a debian stage that copies %s from the node stage is a finding', (_name, line) => {
    expect(codenameMessages(slimEdit('COPY apps/api/package.json apps/api/', line))).toEqual([
      expect.stringContaining('must copy exactly /usr/local/bin/node to /usr/local/bin/node'),
    ]);
  });

  it('(c) a RUN --mount from the node stage into a debian stage is a finding; from a build stage it is not', () => {
    const mounted = slimEdit(
      'COPY apps/api/package.json apps/api/',
      'RUN --mount=type=bind,from=base,target=/n cp -r /n/usr/local/lib /usr/local/',
    );
    expect(codenameMessages(mounted)).toEqual([expect.stringContaining('RUN --mount from the node stage (base)')]);
    expect(codenameMessages(mounted.replace(',from=base,', ',from=deps,'))).toEqual([]);
  });

  it('(c) also covers a stage built from the debian stage', () => {
    const derived = `${slim}\nFROM runtime AS final\nCOPY --from=base /usr/local/bin/npm /usr/local/bin/npm\nUSER node`;
    expect(codenameMessages(derived)).toEqual([expect.stringContaining('must copy exactly')]);
  });

  describe('(b) cross-file byte identity', () => {
    const api = slim;
    const worker = slim;

    it('identical node and debian references across files pass', () => {
      expect(
        crossFileBaseFindings([
          { file: 'apps/api/Dockerfile', text: api },
          { file: 'apps/worker/Dockerfile', text: worker },
          { file: 'prisma/Dockerfile', text: good },
        ]),
      ).toEqual([]);
    });

    it.each([
      ['node digest', NODE, NODE.replace(/@sha256:.*$/u, OTHER_DIGEST)],
      ['node tag', NODE, NODE.replace('24.22.3', '24.22.4')],
      ['node registry prefix', NODE, `docker.io/library/${NODE}`],
      ['debian digest', DEBIAN, DEBIAN.replace(/@sha256:.*$/u, OTHER_DIGEST)],
    ])('a %s that differs in one file is reported in that file', (_name, from, to) => {
      const findings = crossFileBaseFindings([
        { file: 'apps/api/Dockerfile', text: api },
        { file: 'apps/worker/Dockerfile', text: worker },
        { file: 'prisma/Dockerfile', text: slim.replace(from, to) },
      ]);
      expect(findings).toEqual([
        {
          file: 'prisma/Dockerfile',
          finding: expect.objectContaining({
            rule: 'runtime-codename',
            message: expect.stringContaining(`FROM ${to} differs from ${from}`),
          }),
        },
      ]);
    });

    it('repository mode (--root) reports the cross-file finding and exits 1', () => {
      const root = mkdtempSync(join(tmpdir(), 'check-dockerfiles-'));
      try {
        writeNodePolicy(root);
        for (const [dir, text] of [
          ['apps/api', api],
          ['apps/worker', slim.replace(DEBIAN, DEBIAN.replace(/@sha256:.*$/u, OTHER_DIGEST))],
          ['prisma', api],
        ] as const) {
          mkdirSync(join(root, dir), { recursive: true });
          writeFileSync(join(root, dir, 'Dockerfile'), text);
        }
        const results = checkRepository(root);
        expect(results.map((r) => [r.file, r.findings.map((f) => f.rule)])).toEqual([
          ['apps/api/Dockerfile', []],
          ['apps/worker/Dockerfile', ['runtime-codename']],
          ['prisma/Dockerfile', []],
        ]);
        const cli = runNode([join(repoRoot, 'tools', 'ci', 'check-dockerfiles.mjs'), '--root', root], { cwd: repoRoot });
        expect(cli.status).toBe(1);
        expect(cli.stderr).toContain('apps/worker/Dockerfile:');
        expect(cli.stderr).toContain('[runtime-codename]');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});

describe('node-major (PR87-SEC-01 (a), PR-0087 R1-m1)', () => {
  const policy = { nodeVersion: '24', enginesNode: '>=24.2 <25' };
  const NODE26 = 'node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc';
  const messagesOf = (text: string, p: { nodeVersion: string | undefined; enginesNode: string | undefined } = policy) =>
    nodeMajorFindings([{ file: 'apps/api/Dockerfile', text }], p).map(({ file, finding }) => {
      expect(file).toBe('apps/api/Dockerfile');
      expect(finding.rule).toBe('node-major');
      return finding.message;
    });

  it.each([
    [NODE, '24.22.3'],
    [`docker.io/library/${NODE}`, '24.22.3'],
    ['node:24-trixie-slim@sha256:' + 'a'.repeat(64), '24'],
    ['node:24.22@sha256:' + 'a'.repeat(64), '24.22'],
    ['node:lts-trixie-slim@sha256:' + 'a'.repeat(64), undefined],
    [DEBIAN, undefined],
  ])('nodeTagVersion(%s) = %s', (from, expected) => {
    expect(nodeTagVersion(from)).toBe(expected);
  });

  it.each([
    ['24', [24]],
    ['v24.22.3', [24, 22, 3]],
    [' 24.2\n', [24, 2]],
    ['24.x', undefined],
    ['lts/*', undefined],
    ['24.0.0-rc.1', undefined],
  ])('versionParts(%j)', (text, expected) => {
    expect(versionParts(text)).toEqual(expected);
  });

  it.each([
    ['24.22.3', '>=24.2 <25', true],
    ['24.2.0', '>=24.2 <25', true],
    ['24.1.9', '>=24.2 <25', false],
    ['25.0.0', '>=24.2 <25', false],
    ['26.13.1', '>=24.2 <25', false],
    ['24.22.3', '>= 24.2 < 25', true],
    ['26.13.1', '>=24.2 <25 || >=26', true],
    ['24.0.0', '>24', false],
    ['25.0.0', '>24', true],
    ['24.9.9', '<=24', true],
    ['25.0.0', '<=24', false],
    ['24.22.3', '24', true],
    ['25.0.0', '24', false],
    ['24.22.3', '=24.22.3', true],
    ['24.22.4', '24.22.3', false],
    ['24.22.3', '>24.22.3', false],
    ['24.22.3', '<=24.22.3', true],
    ['24.22.3', '^24.2.0', undefined],
    ['24.22.3', '~24.2', undefined],
    ['24.22.3', '24.x', undefined],
    ['24.22.3', '24.0.0 - 24.99.0', undefined],
    ['24.22.3', '', undefined],
    ['24.22.3', '>=24 ||', undefined],
    ['24', '>=24', undefined],
  ])('satisfiesEngines(%s, %j) = %s', (version, range, expected) => {
    expect(satisfiesEngines(version, range)).toBe(expected);
  });

  it('passes the ADR-0001 pin (Node 24.22.3, .node-version 24, engines ">=24.2 <25") in every stage', () => {
    expect(messagesOf(slim)).toEqual([]);
    expect(messagesOf(good)).toEqual([]);
  });

  it('a node:26 base (Dependabot #50 and #90) fails both the major and the engines check', () => {
    expect(messagesOf(slim.replace(NODE, NODE26))).toEqual([
      expect.stringContaining('is Node 26 but .node-version is 24'),
      expect.stringContaining('does not satisfy engines.node ">=24.2 <25"'),
    ]);
  });

  it('a 24.x below the engines floor fails only the engines check; a floating major tag fails it too', () => {
    expect(messagesOf(slim.replace('24.22.3', '24.1.0'))).toEqual([expect.stringContaining('node:24.1.0 does not satisfy')]);
    expect(messagesOf(slim.replace('24.22.3', '24'))).toEqual([expect.stringContaining('node:24 does not satisfy')]);
  });

  it('a node tag without a numeric version is a finding', () => {
    expect(messagesOf(slim.replace('24.22.3-trixie-slim', 'lts-trixie-slim'))).toEqual([
      expect.stringContaining('has no numeric node version'),
    ]);
  });

  it('fails closed on a missing .node-version, a missing engines.node or an unreadable range', () => {
    expect(messagesOf(slim, { nodeVersion: undefined, enginesNode: policy.enginesNode })).toEqual([
      expect.stringContaining('.node-version is missing'),
    ]);
    expect(messagesOf(slim, { nodeVersion: 'lts/*', enginesNode: policy.enginesNode })).toEqual([
      expect.stringContaining('.node-version is missing'),
    ]);
    expect(messagesOf(slim, { nodeVersion: '24', enginesNode: undefined })).toEqual([expect.stringContaining('no string engines.node')]);
    expect(messagesOf(slim, { nodeVersion: '24', enginesNode: '^24.2.0' })).toEqual([
      expect.stringContaining('range syntax this check does not read'),
    ]);
  });

  it('ignores Dockerfiles without a node base', () => {
    const nginx = `FROM ${NGINX}\nUSER nginx`;
    expect(messagesOf(nginx, { nodeVersion: undefined, enginesNode: undefined })).toEqual([]);
  });

  it('readNodePolicy reads .node-version and engines.node; absent files give undefined', () => {
    const root = mkdtempSync(join(tmpdir(), 'check-dockerfiles-policy-'));
    try {
      expect(readNodePolicy(root)).toEqual({ nodeVersion: undefined, enginesNode: undefined });
      writeNodePolicy(root);
      expect(readNodePolicy(root)).toEqual(policy);
      expect(readNodePolicy(repoRoot)).toEqual(policy);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('repository mode (--root) reports a node:26 Dockerfile and exits 1; without a policy every node FROM is reported', () => {
    const root = mkdtempSync(join(tmpdir(), 'check-dockerfiles-'));
    try {
      for (const dir of ['apps/api', 'apps/worker']) {
        mkdirSync(join(root, dir), { recursive: true });
        writeFileSync(join(root, dir, 'Dockerfile'), slim.replace(NODE, NODE26));
      }
      const unpoliced = checkRepository(root).map((r) => [r.file, r.findings.map((f) => f.rule)]);
      expect(unpoliced).toEqual([
        ['apps/api/Dockerfile', ['node-major', 'node-major']],
        ['apps/worker/Dockerfile', ['node-major', 'node-major']],
      ]);
      writeNodePolicy(root);
      expect(checkRepository(root).map((r) => [r.file, r.findings.map((f) => f.rule)])).toEqual(unpoliced);
      const cli = runNode([join(repoRoot, 'tools', 'ci', 'check-dockerfiles.mjs'), '--root', root], { cwd: repoRoot });
      expect(cli.status).toBe(1);
      expect(cli.stderr).toContain('apps/worker/Dockerfile:');
      expect(cli.stderr).toContain('[node-major] FROM node:26.13.1 is Node 26 but .node-version is 24');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('repository Dockerfiles (US-004)', () => {
  const results = checkRepository(repoRoot);

  it('covers every image Dockerfile', () => {
    expect(results.map((r) => r.file)).toEqual(
      expect.arrayContaining([
        'apps/admin/Dockerfile',
        'apps/api/Dockerfile',
        'apps/web/Dockerfile',
        'apps/worker/Dockerfile',
        'prisma/Dockerfile',
      ]),
    );
  });

  it.each(results.map((r) => [r.file, r.findings] as const))('%s passes every rule', (_file, findings) => {
    expect(findings).toEqual([]);
  });

  it('the CLI exits 0 on the repository', () => {
    const result = runNode([join(repoRoot, 'tools', 'ci', 'check-dockerfiles.mjs'), '--root', repoRoot], { cwd: repoRoot });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
