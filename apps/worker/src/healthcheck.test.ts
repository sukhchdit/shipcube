/**
 * worker container HEALTHCHECK probe (TASK-014, US-004 scenario 4; platform.md §2.2/§3.2): GET :9464/health/ready,
 * 200 within 2 s is healthy, anything else is unhealthy; bodies are never printed.
 */
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { BUDGET_MS, DEFAULT_PORT, READY_PATH, probePort, probeReady } from './healthcheck.js';
import { HEALTH_PATHS } from './platform/health/server.js';

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

describe('worker healthcheck probe (TASK-014)', () => {
  it('targets the worker readiness path with a 2 s budget and port 9464 by default', () => {
    expect(READY_PATH).toBe(HEALTH_PATHS.ready);
    expect(BUDGET_MS).toBe(2000);
    expect(DEFAULT_PORT).toBe(9464);
    expect(probePort(undefined)).toBe(9464);
    expect(probePort('9500')).toBe(9500);
    expect(probePort('not-a-port')).toBe(9464);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('is healthy on 200 and prints nothing', async () => {
    const write = jest.spyOn(process.stdout, 'write');
    const port = await listen((req, res) => res.writeHead(req.url === '/health/ready' ? 200 : 404).end('body'));
    await expect(probeReady(port)).resolves.toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it('is unhealthy on 503, on a timeout and when nothing listens', async () => {
    const failing = await listen((_req, res) => res.writeHead(503).end());
    await expect(probeReady(failing)).resolves.toBe(false);
    const silent = await listen(() => undefined);
    await expect(probeReady(silent, { budgetMs: 200 })).resolves.toBe(false);
    await new Promise((resolve) => servers.pop()?.close(resolve));
    await expect(probeReady(silent)).resolves.toBe(false);
  });
});
