/**
 * Container HEALTHCHECK probe of the api and worker images (TASK-014, US-004 scenario 4; platform.md §2.2/§3.2): 200
 * within 2 s is healthy, anything else (other status, timeout, refused connection) is unhealthy; bodies are never
 * printed; an unknown or missing service never reports healthy.
 */
import { readFileSync } from 'node:fs';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { BUDGET_MS, READY_PATH, SERVICES, main, probePort, probeReady } from './healthcheck.mjs';

const repoRoot = findRepoRoot();
const SCRIPT = join(repoRoot, 'tools', 'docker', 'healthcheck.mjs');

const servers: Server[] = [];
afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve).closeAllConnections())));
});

async function listen(handler: RequestListener): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/** A port nothing listens on (bound once, then closed). */
async function closedPort(): Promise<number> {
  const port = await listen((_req, res) => res.end());
  await new Promise((resolve) => servers.pop()?.close(resolve));
  return port;
}

/** The literal readiness path constant of an app source file (tools tests do not import app source). */
function sourceConstant(rel: string, pattern: RegExp): string | undefined {
  return pattern.exec(readFileSync(join(repoRoot, rel), 'utf8'))?.[1];
}

// Real loopback HTTP: 20 s timed out when the host starved the suite (W0-FLAKE; same hang-detector budget as the api loopback suites).
// The probe's own 2 s budget is pinned by BUDGET_MS and by the explicit 200 ms case; a case that expects a 200 passes the wide
// budget below, because a loaded host can take longer than 2 s to deliver an answer the server already sent.
jest.setTimeout(180_000);
const LOAD_TOLERANT_BUDGET_MS = 120_000;

describe('image healthcheck probe (TASK-014)', () => {
  it('targets the readiness routes of the api router and the worker health server with a 2 s budget', () => {
    const apiReady = sourceConstant('apps/api/src/platform/health/router.ts', /export const HEALTH_READY_PATH = '([^']+)'/);
    const workerReady = sourceConstant(
      'apps/worker/src/platform/health/server.ts',
      /export const HEALTH_PATHS = Object\.freeze\(\{[^}]*\bready: '([^']+)'/,
    );
    expect(apiReady).toBe(READY_PATH);
    expect(workerReady).toBe(READY_PATH);
    expect(BUDGET_MS).toBe(2000);
    expect(SERVICES).toEqual({
      api: { portVariable: 'APP_PORT', defaultPort: 3000 },
      worker: { portVariable: 'APP_HEALTH_PORT', defaultPort: 9464 },
    });
    // Importing the module ran no probe (the entry point is guarded by import.meta.main). Checked in a fresh process: the
    // exit code of this one is shared with every earlier test file when Jest runs in band (W0-FLAKE, D-ORCH-097).
    const imported = runNode(
      [
        '--input-type=module',
        '--eval',
        `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)}); await new Promise((resolve) => setTimeout(resolve, 300)); process.stdout.write('exit=' + String(process.exitCode ?? 0));`,
      ],
      { cwd: repoRoot },
    );
    expect(imported).toMatchObject({ status: 0, stdout: 'exit=0' });
  });

  it('is healthy on 200 from GET /health/ready and prints nothing', async () => {
    const seen: string[] = [];
    const write = jest.spyOn(process.stdout, 'write');
    const port = await listen((req, res) => {
      seen.push(`${req.method ?? ''} ${req.url ?? ''}`);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ready","secret-looking":"body"}');
    });
    await expect(probeReady(port, { budgetMs: LOAD_TOLERANT_BUDGET_MS })).resolves.toBe(true);
    expect(seen).toEqual(['GET /health/ready']);
    expect(write).not.toHaveBeenCalled();
  });

  it.each([503, 500, 404, 302])('is unhealthy on HTTP %i', async (status) => {
    const port = await listen((_req, res) => res.writeHead(status).end());
    await expect(probeReady(port)).resolves.toBe(false);
  });

  it('is unhealthy when the answer does not arrive within the budget', async () => {
    const port = await listen(() => undefined);
    const timers = jest.spyOn(globalThis, 'setTimeout');
    try {
      const started = performance.now();
      // The server never answers, so the probe can only resolve false because its own budget fired (a hang would hit the Jest budget).
      await expect(probeReady(port, { budgetMs: 200 })).resolves.toBe(false);
      expect(performance.now() - started).toBeGreaterThanOrEqual(150);
      // Magnitude, deterministic: the configured budget is what the probe armed (a wall-clock upper bound is not host-load-proof).
      expect(timers.mock.calls.filter(([, ms]) => ms === 200)).toHaveLength(1);
    } finally {
      timers.mockRestore();
    }
  });

  it('main without options arms the production BUDGET_MS (the seam does not change the image default)', async () => {
    const port = await listen(() => undefined);
    const timers = jest.spyOn(globalThis, 'setTimeout');
    try {
      // The server never answers, so this resolves 1 only because the probe's own default budget fired.
      await expect(main(['api'], { APP_PORT: String(port) })).resolves.toBe(1);
      expect(timers.mock.calls.filter(([, ms]) => ms === BUDGET_MS)).toHaveLength(1);
    } finally {
      timers.mockRestore();
    }
  });

  it('is unhealthy when nothing listens', async () => {
    await expect(probeReady(await closedPort())).resolves.toBe(false);
  });

  it.each([
    [undefined, 3000, 3000],
    ['', 3000, 3000],
    ['8081', 3000, 8081],
    ['0', 3000, 3000],
    ['65536', 3000, 3000],
    ['3000abc', 3000, 3000],
    ['-1', 3000, 3000],
    [undefined, 9464, 9464],
    ['9500', 9464, 9500],
    ['not-a-port', 9464, 9464],
  ])('port variable %j with default %i selects port %i', (value, fallback, port) => {
    expect(probePort(value, fallback)).toBe(port);
  });
});

describe('image healthcheck entry (TASK-014)', () => {
  it.each([
    ['api', 'APP_PORT'],
    ['worker', 'APP_HEALTH_PORT'],
  ])('%s probes the port named by %s and exits 0 on 200', async (name, variable) => {
    const seen: string[] = [];
    const port = await listen((req, res) => {
      seen.push(req.url ?? '');
      res.writeHead(200).end('body');
    });
    await expect(main([name], { [variable]: String(port) }, { budgetMs: LOAD_TOLERANT_BUDGET_MS })).resolves.toBe(0);
    expect(seen).toEqual(['/health/ready']);
  });

  it('a service never reads the port variable of the other one', async () => {
    const port = await listen((_req, res) => res.writeHead(200).end());
    const closed = await closedPort();
    await expect(main(['worker'], { APP_PORT: String(port), APP_HEALTH_PORT: String(closed) })).resolves.toBe(1);
    await expect(
      main(['api'], { APP_PORT: String(port), APP_HEALTH_PORT: String(closed) }, { budgetMs: LOAD_TOLERANT_BUDGET_MS }),
    ).resolves.toBe(0);
  });

  it('exits 1 on 503', async () => {
    const port = await listen((_req, res) => res.writeHead(503).end());
    await expect(main(['api'], { APP_PORT: String(port) })).resolves.toBe(1);
  });

  it.each<[string[]]>([[[]], [['']], [['web']], [['API']], [['constructor']], [['toString']], [['api', 'extra']]])(
    'exits 1 (never healthy) for the arguments %j',
    async (argv) => {
      const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      await expect(main(argv, {})).resolves.toBe(1);
      expect(stderr).toHaveBeenCalledWith('usage: healthcheck.mjs api|worker\n');
    },
  );

  it('the CLI exits 1 without a service and when the service does not answer', async () => {
    const closed = await closedPort();
    const env = { ...process.env, NODE_OPTIONS: '' };
    const missing = runNode([SCRIPT], { cwd: repoRoot, env });
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe('');
    const down = runNode([SCRIPT, 'api'], { cwd: repoRoot, env: { ...env, APP_PORT: String(closed) } });
    expect(down.status).toBe(1);
    expect(`${down.stdout}${down.stderr}`).toBe('');
  });
});
