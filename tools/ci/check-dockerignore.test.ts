/**
 * Docker build-context hygiene (TASK-014; WAVE-00 sheet line 543: PR27-SEC-01, PR28-SEC-03 item 6, PR30-SEC-08 (b),
 * D-ARCH-100 item 3). The in-house matcher follows Docker's .dockerignore semantics; its own behaviour is
 * mutation-proven below so that a matcher bug cannot make the repository assertions pass vacuously.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { copySources, findDockerfiles, instructions } from './check-dockerfiles.mjs';
import { REQUIRED_IGNORED, REQUIRED_VISIBLE, compile, isIgnored, parse } from './check-dockerignore.mjs';

const repoRoot = findRepoRoot();
const rules = parse(readFileSync(join(repoRoot, '.dockerignore'), 'utf8'));
const ignored = (path: string) => isIgnored(rules, path);

describe('Docker-compatible matcher (sheet line 543: in-house, <= 80 lines)', () => {
  it('is at most 80 lines', () => {
    expect(
      readFileSync(join(repoRoot, 'tools', 'ci', 'check-dockerignore.mjs'), 'utf8')
        .trimEnd()
        .split('\n').length,
    ).toBeLessThanOrEqual(80);
  });

  it('anchors a bare name at the context root (a bare `tests` misses prisma/tests)', () => {
    const bare = parse('tests\n');
    expect(isIgnored(bare, 'tests/load/spikes/spk04-audit.js')).toBe(true);
    expect(isIgnored(bare, 'prisma/tests/spikes/spk04/server.ts')).toBe(false);
    expect(isIgnored(bare, 'apps/api/src/platform/storage/tests/rustfs.ts')).toBe(false);
  });

  it('`**/` matches any depth, zero directories included', () => {
    const deep = parse('**/tests\n');
    expect(isIgnored(deep, 'tests/x.ts')).toBe(true);
    expect(isIgnored(deep, 'prisma/tests/spikes/spk04/server.ts')).toBe(true);
    expect(isIgnored(deep, 'a/b/c/tests/d/e.ts')).toBe(true);
    expect(isIgnored(deep, 'contests/x.ts')).toBe(false);
    expect(isIgnored(deep, 'apps/latests/x.ts')).toBe(false);
    expect(compile('**').test('any/thing')).toBe(true);
    expect(compile('a/**').test('a/b/c')).toBe(true);
  });

  it('`*` and `?` never cross a separator; character classes work', () => {
    expect(isIgnored(parse('*.pem\n'), 'key.pem')).toBe(true);
    expect(isIgnored(parse('*.pem\n'), 'certs/key.pem')).toBe(false);
    expect(isIgnored(parse('**/*.pem\n'), 'certs/key.pem')).toBe(true);
    expect(isIgnored(parse('a?c\n'), 'abc')).toBe(true);
    expect(isIgnored(parse('a?c\n'), 'a/c')).toBe(false);
    expect(isIgnored(parse('file[0-9].txt\n'), 'file7.txt')).toBe(true);
    expect(isIgnored(parse('file[!0-9].txt\n'), 'file7.txt')).toBe(false);
    expect(isIgnored(parse('a.b\n'), 'axb')).toBe(false);
  });

  it('a matching parent directory excludes everything below it; `!` re-includes; the last match wins', () => {
    const docs = parse('docs\n!docs/keep/me.yaml\n');
    expect(isIgnored(docs, 'docs/other/file.md')).toBe(true);
    expect(isIgnored(docs, 'docs/keep/me.yaml')).toBe(false);
    expect(isIgnored(docs, 'docs/keep/other.yaml')).toBe(true);
    expect(isIgnored(parse('!docs/keep/me.yaml\ndocs\n'), 'docs/keep/me.yaml')).toBe(true);
  });

  it('ignores comments and blank lines and normalises ./ and leading or trailing slashes', () => {
    const r = parse('# comment\n\n/node_modules/\n./coverage\n');
    expect(r.map((rule) => rule.source)).toEqual(['/node_modules/', './coverage']);
    expect(isIgnored(r, 'node_modules/x/index.js')).toBe(true);
    expect(isIgnored(r, './coverage/lcov.info')).toBe(true);
  });
});

describe('repository .dockerignore (sheet line 543, platform.md §3.2)', () => {
  it.each([...REQUIRED_IGNORED])('hides %s', (path) => {
    expect(ignored(path)).toBe(true);
  });

  it.each([...REQUIRED_VISIBLE])('keeps %s visible', (path) => {
    expect(ignored(path)).toBe(false);
  });

  it('keeps the API contract as the single docs/ exception', () => {
    for (const path of [
      'docs/03-architecture/api/other.yaml',
      'docs/03-architecture/api/openapi.yml',
      'docs/03-architecture/platform.md',
      'docs/sdlc/DECISIONS.md',
      'docs/01-requirements/PRD.md',
    ]) {
      expect(ignored(path)).toBe(true);
    }
    expect(rules.filter((rule) => rule.negate).map((rule) => rule.source)).toEqual(['!docs/03-architecture/api/openapi.yaml']);
  });

  it.each([
    'tests/e2e/smoke.spec.ts',
    'apps/web/tests/prerender.int.test.ts',
    'apps/api/src/modules/quotes/tests/quote.api.test.ts',
    'packages/config/src/fixtures/start-service.ts',
    'tools/ci/fixtures/dockerfiles/bad.Dockerfile',
    'apps/api/src/app.test.ts',
    'tools/x.test.js',
    '.git/HEAD',
    '.env',
    '.env.local',
    'apps/api/.env.local',
    'node_modules/pg/package.json',
    'apps/web/node_modules/@hookform/resolvers/package.json',
    'coverage/lcov.info',
    'apps/api/dist/main.js',
    'apps/web/build/client/index.html',
    'prisma/generated/prisma/client.ts',
    'reports/rehearsal/20261121T101500Z-backup/platform.dump',
    'server.pem',
    'certs/server.key',
    '.claude/settings.json',
    '.github/workflows/ci.yml',
  ])('hides %s', (path) => {
    expect(ignored(path)).toBe(true);
  });

  it.each([
    'package.json',
    'package-lock.json',
    'apps/api/src/main.ts',
    'apps/api/src/platform/storage/s3-object-storage.ts',
    'packages/config/src/index.ts',
    'prisma/migrations/migration_lock.toml',
    'prisma/seed/index.ts',
    'prisma/bootstrap/00-roles.sql',
    'prisma.config.ts',
    'tools/deps/prisma-engines.json',
    'tools/docker/entrypoint.sh',
    'infra/nginx/web.conf.template',
  ])('keeps build input %s visible', (path) => {
    expect(ignored(path)).toBe(false);
  });

  it('the CLI agrees (exit 0 on the repository)', () => {
    const result = runNode([join(repoRoot, 'tools', 'ci', 'check-dockerignore.mjs'), repoRoot], { cwd: repoRoot });
    expect(result.status).toBe(0);
  });
});

describe('Dockerfiles copy explicit paths only (sheet line 543)', () => {
  const dockerfiles = findDockerfiles(repoRoot);

  it('finds the five image Dockerfiles (fixtures excluded)', () => {
    expect(dockerfiles).toEqual(
      expect.arrayContaining([
        'apps/admin/Dockerfile',
        'apps/api/Dockerfile',
        'apps/web/Dockerfile',
        'apps/worker/Dockerfile',
        'prisma/Dockerfile',
      ]),
    );
    expect(dockerfiles.filter((file) => file.startsWith('tools/ci/fixtures/'))).toEqual([]);
  });

  it.each(dockerfiles)('%s never COPYs ., ./ or the bare prisma directory', (file) => {
    const text = readFileSync(join(repoRoot, file), 'utf8');
    const sources = instructions(text)
      .filter((i) => i.instruction === 'COPY' || i.instruction === 'ADD')
      .flatMap((i) => copySources(i.args).map((source) => source.replace(/\/+$/, '')));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter((source) => ['', '.', './', '*', 'prisma', './prisma'].includes(source))).toEqual([]);
  });
});
