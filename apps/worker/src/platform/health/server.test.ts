import type { AddressInfo } from 'node:net';

import {
  createReadinessProbe,
  pendingCheck,
  READINESS_COMPONENTS,
  type ReadinessCheck,
  type ReadinessComponent,
} from '@platform/api/runtime';
import { afterEach, describe, expect, it } from '@jest/globals';

import { createWorkerHealthServer } from './server.js';

const failing = (name: ReadinessComponent, critical: boolean): ReadinessCheck => ({
  name,
  critical,
  check: () => Promise.reject(new Error('connect ECONNREFUSED valkey.internal.example:6379 (valkey 8.1)')),
});
const hanging = (name: ReadinessComponent): ReadinessCheck => ({ name, critical: true, check: () => new Promise<void>(() => undefined) });
const checksWith = (overrides: Partial<Record<ReadinessComponent, ReadinessCheck>> = {}): ReadinessCheck[] =>
  READINESS_COMPONENTS.map((name) => overrides[name] ?? pendingCheck(name));
const allOk = { database: 'ok', redis: 'ok', object_storage: 'ok', audit_partitions: 'ok', audit_chain: 'ok' };

describe('US-012 liveness and readiness endpoints (worker health server)', () => {
  const servers: ReturnType<typeof createWorkerHealthServer>[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  async function start(checks: readonly ReadinessCheck[], deadlineMs?: number) {
    const probe = createReadinessProbe(checks, deadlineMs === undefined ? {} : { deadlineMs });
    const server = createWorkerHealthServer(probe);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const call = async (path: string, method = 'GET') => {
      const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, { method, signal: AbortSignal.timeout(5_000) });
      const text = await response.text();
      return { status: response.status, headers: response.headers, text, body: text === '' ? undefined : (JSON.parse(text) as unknown) };
    };
    return { call, probe };
  }

  it('AT-US-012-01: worker live and ready return 200 with every dependency ok, uncached', async () => {
    const { call } = await start(checksWith());
    const live = await call('/health/live');
    expect(live).toMatchObject({ status: 200, body: { status: 'ok' } });
    const ready = await call('/health/ready');
    expect(ready).toMatchObject({ status: 200, body: { status: 'ok', components: allOk } });
    expect(ready.headers.get('cache-control')).toBe('no-store');
    expect(ready.headers.get('content-type')).toMatch(/^application\/json/);
  });

  it.each([
    ['postgres', 'database'],
    ['redis', 'redis'],
    ['object-storage', 'object_storage'],
  ] as const)('AT-US-012-02-%s: worker ready is 503 with the dependency down; live stays 200', async (_row, component) => {
    const { call } = await start(checksWith({ [component]: failing(component, true) }));
    expect(await call('/health/ready')).toMatchObject({
      status: 503,
      body: { status: 'unavailable', components: { ...allOk, [component]: 'unavailable' } },
    });
    expect((await call('/health/live')).status).toBe(200);
  });

  it('AT-US-012-03: worker readiness is bounded when PostgreSQL does not answer', async () => {
    const { call } = await start(checksWith({ database: hanging('database') }), 300);
    const started = performance.now();
    expect((await call('/health/ready')).status).toBe(503);
    expect(performance.now() - started).toBeLessThan(2_500);
  });

  it('AT-US-012-04: a failing audit check degrades worker readiness without failing it', async () => {
    const { call } = await start(checksWith({ audit_partitions: failing('audit_partitions', false) }));
    expect(await call('/health/ready')).toMatchObject({
      status: 200,
      body: { status: 'degraded', components: { ...allOk, audit_partitions: 'degraded' } },
    });
  });

  it('AT-US-012-05: worker bodies hold no version, host name or error text; other paths and methods are minimal problems', async () => {
    const { call } = await start(checksWith({ redis: failing('redis', true) }));
    for (const path of ['/health/live', '/health/ready', '/metrics/../etc', '/']) {
      const response = await call(path);
      expect(response.text).not.toMatch(/ECONNREFUSED|internal|example|\d+\.\d+|valkey|Error/);
    }
    const missing = await call('/nope');
    expect(missing).toMatchObject({ status: 404, body: { type: 'about:blank', title: 'Not Found', status: 404 } });
    expect(missing.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    const post = await call('/health/live', 'POST');
    expect(post).toMatchObject({ status: 405, body: { status: 405 } });
    expect(post.headers.get('allow')).toBe('GET, HEAD');
    const head = await call('/health/ready?verbose=1', 'HEAD');
    expect(head.status).toBe(503);
    expect(head.text).toBe('');
  });

  it('[NFR-AVAIL-002] worker readiness answers 503 once draining', async () => {
    const { call, probe } = await start(checksWith());
    probe.startDraining();
    expect((await call('/health/ready')).status).toBe(503);
  });
});
