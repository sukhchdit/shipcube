/**
 * Image suite (TASK-014; US-004, SEC-TC-64 (vi), D-ARCH-105, PR4-SEC-02/-12, D-ORCH-007 item 2; platform.md §3.1-§3.4;
 * WAVE-00 sheet lines 530-547). Opt-in: `npm run test:stack -- tests/compose/images`. Builds the images through
 * compose.yaml (tags shipcube-*:local), then inspects and runs them with `docker run` (no host ports).
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { ComposeStack, docker, ROOT, uniqueProject, waitFor } from './helpers/stack.js';

const IMAGES = {
  api: 'shipcube-api:local',
  worker: 'shipcube-worker:local',
  web: 'shipcube-web:local',
  admin: 'shipcube-admin:local',
  tooling: 'shipcube-tooling:local',
} as const;
const DOCKERFILES: Readonly<Record<keyof typeof IMAGES, string>> = {
  api: 'apps/api/Dockerfile',
  worker: 'apps/worker/Dockerfile',
  web: 'apps/web/Dockerfile',
  admin: 'apps/admin/Dockerfile',
  tooling: 'prisma/Dockerfile',
};
const MB = 1024 * 1024;
const NODE_SERVICES = ['api', 'worker'] as const;
const NGINX_SERVICES = ['web', 'admin'] as const;
const NGINX_TMPFS = ['--tmpfs', '/tmp', '--tmpfs', '/var/cache/nginx', '--tmpfs', '/var/run'];

const builder = new ComposeStack(uniqueProject());
const started: string[] = [];
const tag = randomBytes(4).toString('hex');

interface ImageConfig {
  User?: string;
  Healthcheck?: { Test?: string[] };
  Labels?: Record<string, string>;
}

const inspect = (image: string): { Size: number; Config: ImageConfig } => {
  const result = docker(['image', 'inspect', image], { timeoutMs: 60_000 });
  expect(result.status).toBe(0);
  return (JSON.parse(result.stdout) as { Size: number; Config: ImageConfig }[])[0] ?? { Size: 0, Config: {} };
};

/** A detached container this suite removes in afterAll. */
function runDetached(args: readonly string[]): string {
  const name = `t014-${tag}-${String(started.length)}`;
  const result = docker(['run', '-d', '--name', name, ...args], { timeoutMs: 120_000 });
  expect(result.status).toBe(0);
  started.push(name);
  return name;
}

const containerState = (
  name: string,
): { Status: string; ExitCode: number; StartedAt: string; FinishedAt: string; Health?: { Status: string } } =>
  JSON.parse(docker(['inspect', '--format', '{{json .State}}', name], { timeoutMs: 30_000 }).stdout) as {
    Status: string;
    ExitCode: number;
    StartedAt: string;
    FinishedAt: string;
    Health?: { Status: string };
  };

beforeAll(() => {
  const build = builder.run(['build', 'api', 'worker', 'web', 'admin', 'bootstrap'], 3_600_000);
  expect(build.status).toBe(0);
}, 3_700_000);

afterAll(() => {
  for (const name of started) docker(['rm', '-f', '-v', name], { timeoutMs: 60_000 });
  builder.down();
}, 300_000);

describe('image hardening (US-004)', () => {
  it.each(Object.keys(IMAGES) as (keyof typeof IMAGES)[])('[AT-US-004-01] %s: multi-stage, pinned bases, non-root, HEALTHCHECK', (name) => {
    const dockerfile = readFileSync(join(ROOT, DOCKERFILES[name]), 'utf8');
    const froms = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((match) => match[1] ?? '');
    expect(froms.length).toBeGreaterThanOrEqual(2);
    const stageNames = new Set([...dockerfile.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)/gim)].map((match) => match[1] ?? ''));
    for (const from of froms) expect(stageNames.has(from) || /^[a-z0-9./_-]+:[\w.-]+@sha256:[0-9a-f]{64}$/.test(from)).toBe(true);
    const { Config } = inspect(IMAGES[name]);
    expect(Config.User ?? '').not.toMatch(/^(?:|0|root)(?::.*)?$/);
    if (name !== 'tooling') expect(Config.Healthcheck?.Test?.length ?? 0).toBeGreaterThan(0);
    expect(Config.Labels?.['org.opencontainers.image.title']).toBe(IMAGES[name].replace(':local', ''));
  });

  it.each(NGINX_SERVICES)('[AT-US-004-01] %s serves its static assets from Nginx', (name) => {
    const version = docker(['run', '--rm', '--entrypoint', 'nginx', IMAGES[name], '-v'], { timeoutMs: 60_000 });
    expect(`${version.stdout}${version.stderr}`).toMatch(/nginx version: nginx\//);
    const index = docker(['run', '--rm', '--entrypoint', 'test', IMAGES[name], '-f', '/usr/share/nginx/html/index.html'], {
      timeoutMs: 60_000,
    });
    expect(index.status).toBe(0);
  });

  it('[AT-US-004-02] a secret in a layer fails the scan, which names the layer and file, never the value', () => {
    const dir = mkdtempSync(join(tmpdir(), 't014-secret-probe-'));
    const probe = `t014-secret-probe:${tag}`;
    try {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      const keyId = `AKIA${[...randomBytes(16)].map((byte) => alphabet[byte % 32]).join('')}`;
      writeFileSync(join(dir, 'creds.txt'), `[default]\naws_access_key_id = ${keyId}\n`);
      const alpine = /^\s+FROM (alpine:\S+)$/m.exec(readFileSync(join(ROOT, 'compose.yaml'), 'utf8'))?.[1] ?? '';
      // The file is deleted in a later layer: the layer that added it still holds it.
      writeFileSync(join(dir, 'Dockerfile'), `FROM ${alpine}\nCOPY creds.txt /opt/creds.txt\nRUN rm /opt/creds.txt\nUSER 65534\n`);
      expect(docker(['build', '-q', '-t', probe, dir], { timeoutMs: 600_000 }).status).toBe(0);
      const result = spawnScanner(probe);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/layer \d+ \(sha256:[0-9a-f]{12}\) \/opt\/creds\.txt: \S+/);
      expect(`${result.stdout}${result.stderr}`).not.toContain(keyId);
      expect(`${result.stdout}${result.stderr}`).not.toContain(keyId.slice(4));
    } finally {
      docker(['image', 'rm', '-f', probe], { timeoutMs: 60_000 });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(Object.keys(IMAGES) as (keyof typeof IMAGES)[])('[AT-US-004-02] %s holds no secret in any layer or in its history', (name) => {
    const result = spawnScanner(IMAGES[name]);
    expect({
      status: result.status,
      findings: result.stderr.split('\n').filter((line) => line.includes('[scan-image-secrets] layer') || line.includes('history step')),
    }).toEqual({
      status: 0,
      findings: [],
    });
  });

  it('[AT-US-004-03] FROM node:24 without a digest makes the Dockerfile check exit non-zero', () => {
    const dir = mkdtempSync(join(tmpdir(), 't014-unpinned-'));
    try {
      writeFileSync(join(dir, 'Dockerfile'), 'FROM node:24\nUSER node\nENV NODE_ENV=production\n');
      const result = spawnNode(['tools/ci/check-dockerfiles.mjs', '--root', dir]);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/from-digest/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('[AT-US-004-04] the api with PostgreSQL unreachable is reported unhealthy', async () => {
    const name = runDetached([
      '--network',
      'none',
      '--read-only',
      '--tmpfs',
      '/tmp',
      '--init',
      '--cap-drop',
      'ALL',
      '--env-file',
      join(ROOT, 'compose.env'),
      '--env-file',
      join(ROOT, 'infra/local/env/api.env'),
      IMAGES.api,
    ]);
    const health = await waitFor(
      'api health status',
      () => {
        const state = containerState(name);
        if (state.Status !== 'running') return `exited:${String(state.ExitCode)}`;
        return state.Health?.Status === 'unhealthy' || state.Health?.Status === 'healthy' ? state.Health.Status : undefined;
      },
      180_000,
      2_000,
    );
    expect(health).toBe('unhealthy');
  });

  it.each([...NODE_SERVICES, ...NGINX_SERVICES])('[platform.md §3.4] %s stays within its uncompressed size budget', (name) => {
    const budget = NODE_SERVICES.includes(name as (typeof NODE_SERVICES)[number]) ? 300 * MB : 60 * MB;
    const { Size } = inspect(IMAGES[name]);
    process.stdout.write(`[stack] ${IMAGES[name]} ${(Size / MB).toFixed(1)} MiB (budget ${String(budget / MB)} MiB)\n`);
    expect(Size).toBeLessThanOrEqual(budget);
  });

  it.each(Object.keys(IMAGES) as (keyof typeof IMAGES)[])('[sheet line 543] %s holds no test, spike or load-test path', (name) => {
    const result = docker(
      [
        'run',
        '--rm',
        '--network',
        'none',
        '--entrypoint',
        'find',
        IMAGES[name],
        '/',
        '-path',
        '/proc',
        '-prune',
        '-o',
        '(',
        '-path',
        '*prisma/tests*',
        '-o',
        '-path',
        '*tests/load*',
        '-o',
        '-path',
        '*storage/tests*',
        '-o',
        '-name',
        'spikes',
        '-o',
        '-name',
        '*.test.js',
        ')',
        '-print',
      ],
      { timeoutMs: 120_000 },
    );
    expect({ status: result.status, found: result.stdout.trim() }).toEqual({ status: 0, found: '' });
  });

  it.each(NODE_SERVICES)('[SEC-TC-64 (vi)] [D-ARCH-105] %s holds no Prisma engines, schema engine or generated client sources', (name) => {
    const result = docker(
      [
        'run',
        '--rm',
        '--network',
        'none',
        '--entrypoint',
        'find',
        IMAGES[name],
        '/app',
        '(',
        '-path',
        '*node_modules/@prisma/engines',
        '-o',
        '-name',
        'schema-engine*',
        '-o',
        '-path',
        '*prisma/generated',
        ')',
        '-print',
      ],
      { timeoutMs: 120_000 },
    );
    expect({ status: result.status, found: result.stdout.trim() }).toEqual({ status: 0, found: '' });
  });

  it('[SEC-TC-64 (vi)] the tooling image prints the Prisma version with no network', () => {
    const result = docker(['run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp', IMAGES.tooling, 'prisma-version'], {
      timeoutMs: 120_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/prisma/i);
  });

  it.each(
    NODE_SERVICES.flatMap((service) => [
      [service, 'NODE_OPTIONS=--inspect-wait=0.0.0.0:9229'],
      [service, 'NODE_ENV=development'],
    ]),
  )('[D-ORCH-007 item 2] %s with APP_ENV=staging and %s exits 78 within 5 s and never listens on 9229', (service, variable) => {
    const name = runDetached(['--network', 'none', '-e', 'APP_ENV=staging', '-e', variable, IMAGES[service as 'api' | 'worker']]);
    const wait = docker(['wait', name], { timeoutMs: 30_000 });
    expect(wait.stdout.trim()).toBe('78');
    const state = containerState(name);
    expect(Date.parse(state.FinishedAt) - Date.parse(state.StartedAt)).toBeLessThanOrEqual(5_000);
    const logs = docker(['logs', name], { timeoutMs: 30_000 });
    expect(`${logs.stdout}${logs.stderr}`).not.toMatch(/Debugger listening|9229/);
  });
});

describe('web and admin Nginx (PR4-SEC-02, PR4-SEC-12; sheet line 537)', () => {
  it.each(NGINX_SERVICES)('%s: nginx -T holds exactly one server block', (name) => {
    const result = docker(['run', '--rm', ...NGINX_TMPFS, '--read-only', '--entrypoint', 'nginx', IMAGES[name], '-T'], {
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(0);
    const config = `${result.stdout}`;
    expect([...config.matchAll(/^\s*server\s*\{/gm)]).toHaveLength(1);
  });

  it.each(NGINX_SERVICES)('%s: Host localhost and other.example both get nosniff and a versionless Server; no 50x.html', async (name) => {
    const container = runDetached(['--read-only', ...NGINX_TMPFS, '--cap-drop', 'ALL', IMAGES[name]]);
    await waitFor('nginx health', () => (containerState(container).Health?.Status === 'healthy' ? true : undefined), 60_000);
    const path = name === 'web' ? '/en/' : '/';
    for (const host of ['localhost', 'other.example']) {
      const result = docker(
        ['exec', container, 'wget', '-S', '-O', '/dev/null', '--header', `Host: ${host}`, `http://127.0.0.1:8080${path}`],
        { timeoutMs: 30_000 },
      );
      const headers = result.stderr;
      expect({ host, nosniff: /^\s*X-Content-Type-Options: nosniff\s*$/im.test(headers) }).toEqual({ host, nosniff: true });
      expect({ host, server: /^\s*Server: (.*?)\s*$/im.exec(headers)?.[1] }).toEqual({ host, server: 'nginx' });
    }
    expect(docker(['exec', container, 'test', '!', '-e', '/usr/share/nginx/html/50x.html'], { timeoutMs: 30_000 }).status).toBe(0);
  });
});

function spawnNode(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 3_600_000,
    maxBuffer: 64 * MB,
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function spawnScanner(image: string): { status: number | null; stdout: string; stderr: string } {
  return spawnNode(['tools/docker/scan-image-secrets.mjs', image]);
}
