/**
 * api container HEALTHCHECK probe (TASK-014, US-004 scenario 4; platform.md §2.2/§3.2): 200 within 2 s is healthy,
 * anything else (other status, timeout, refused connection) is unhealthy; bodies are never printed.
 */
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { BUDGET_MS, DEFAULT_PORT, READY_PATH, probePort, probeReady } from './healthcheck.js';
import { HEALTH_READY_PATH } from './platform/health/router.js';

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

describe('api healthcheck probe (TASK-014)', () => {
  it('targets the readiness route of the api router with a 2 s budget and port 3000 by default', () => {
    expect(READY_PATH).toBe(HEALTH_READY_PATH);
    expect(BUDGET_MS).toBe(2000);
    expect(DEFAULT_PORT).toBe(3000);
    // Importing the module ran no probe (the entry point is guarded by import.meta.main).
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('is healthy on 200 from GET /health/ready and prints nothing', async () => {
    const seen: string[] = [];
    const write = jest.spyOn(process.stdout, 'write');
    const port = await listen((req, res) => {
      seen.push(`${req.method ?? ''} ${req.url ?? ''}`);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ready","secret-looking":"body"}');
    });
    await expect(probeReady(port)).resolves.toBe(true);
    expect(seen).toEqual(['GET /health/ready']);
    expect(write).not.toHaveBeenCalled();
  });

  it.each([503, 500, 404, 302])('is unhealthy on HTTP %i', async (status) => {
    const port = await listen((_req, res) => res.writeHead(status).end());
    await expect(probeReady(port)).resolves.toBe(false);
  });

  it('is unhealthy when the answer does not arrive within the budget', async () => {
    const port = await listen(() => undefined);
    const started = Date.now();
    await expect(probeReady(port, { budgetMs: 200 })).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('is unhealthy when nothing listens', async () => {
    const port = await listen((_req, res) => res.end());
    await new Promise((resolve) => servers.pop()?.close(resolve));
    await expect(probeReady(port)).resolves.toBe(false);
  });

  it.each([
    [undefined, 3000],
    ['', 3000],
    ['8081', 8081],
    ['0', 3000],
    ['65536', 3000],
    ['3000abc', 3000],
    ['-1', 3000],
  ])('APP_PORT %j selects port %i', (value, port) => {
    expect(probePort(value)).toBe(port);
  });
});
