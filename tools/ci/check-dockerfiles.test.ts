/**
 * Static Dockerfile rules (TASK-014, US-004; platform.md §3.2/§3.4; WAVE-00 sheet lines 530, 531, 537, 543). Every rule
 * has a passing and a failing input; the real repository Dockerfiles must all pass.
 */
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { assignments, checkDockerfileText, checkRepository, copySources, instructions } from './check-dockerfiles.mjs';

const repoRoot = findRepoRoot();
const NODE = 'node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0';
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
  'USER node',
  'HEALTHCHECK --interval=5s CMD ["/usr/bin/env", "-u", "NODE_OPTIONS", "node", "dist/healthcheck.js"]',
  'ENTRYPOINT ["/app/entrypoint.sh"]',
  'CMD ["dist/main.js"]',
].join('\n');
const service = { service: true, nodeService: true };
const rulesOf = (text: string, options = service) => checkDockerfileText(text, options).map((finding) => finding.rule);
const edit = (from: string, to: string) => {
  if (!good.includes(from)) throw new Error(`fixture line not found: ${from}`);
  return good.replace(from, to);
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
      'HEALTHCHECK --interval=5s CMD ["/usr/bin/env", "-u", "NODE_OPTIONS", "node", "dist/healthcheck.js"]',
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
