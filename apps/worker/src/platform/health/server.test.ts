import type { AddressInfo } from 'node:net';

import {
  createReadinessProbe,
  isCriticalComponent,
  READINESS_CHECK_TIMEOUT_MS,
  READINESS_COMPONENTS,
  READINESS_DEADLINE_MS,
  type ReadinessCheck,
  type ReadinessComponent,
} from '@platform/api/runtime';
import { HOST_LOAD_SLACK_MS, LOOPBACK_TEST_TIMEOUT_MS, recordAbortTimeouts, timeOperation } from '@platform/api/test-support/timing';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { createWorkerHealthServer } from './server.js';

// Real HTTP over loopback: the 5 s Jest default timed out under parallel host load (W0-FLAKE; same budget and timing helpers as the
// api loopback suites). The upper bound of a timing check separates 'the deadline fired' from 'the call hung'; the magnitude of
// a deadline is pinned by what reaches the timer (recordAbortTimeouts), not by wall-clock slack.
const TEST_TIMEOUT_MS = LOOPBACK_TEST_TIMEOUT_MS;
jest.setTimeout(TEST_TIMEOUT_MS);

const failing = (name: ReadinessComponent, critical: boolean): ReadinessCheck => ({
  name,
  critical,
  check: () => Promise.reject(new Error('connect ECONNREFUSED valkey.internal.example:6379 (valkey 8.1)')),
});
const passing = (name: ReadinessComponent): ReadinessCheck => ({
  name,
  critical: isCriticalComponent(name),
  check: () => Promise.resolve(),
});
const hanging = (name: ReadinessComponent): ReadinessCheck => ({ name, critical: true, check: () => new Promise<void>(() => undefined) });
const checksWith = (overrides: Partial<Record<ReadinessComponent, ReadinessCheck>> = {}): ReadinessCheck[] =>
  READINESS_COMPONENTS.map((name) => overrides[name] ?? passing(name));
const allOk = { database: 'ok', redis: 'ok', object_storage: 'ok', audit_partitions: 'ok', audit_chain: 'ok' };

describe('US-012 liveness and readiness endpoints (worker health server)', () => {
  const servers: ReturnType<typeof createWorkerHealthServer>[] = [];
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => {
        const closed = new Promise((resolve) => server.close(resolve));
        server.closeAllConnections();
        return closed;
      }),
    );
  });

  async function start(checks: readonly ReadinessCheck[], deadlineMs?: number) {
    const probe = createReadinessProbe(checks, deadlineMs === undefined ? {} : { deadlineMs });
    const server = createWorkerHealthServer(probe);
    expect([server.headersTimeout, server.requestTimeout]).toEqual([5_000, 5_000]);
    // The production server drops a request whose headers take over 5 s (slowloris bound); a host stall that long reset the probe (W0-FLAKE). Widened on this test instance only.
    server.headersTimeout = TEST_TIMEOUT_MS;
    server.requestTimeout = TEST_TIMEOUT_MS;
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const call = async (path: string, method = 'GET') => {
      const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
        method,
        headers: { connection: 'close' },
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS - 5_000),
      });
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

  it('AT-US-012-03: worker readiness is bounded when PostgreSQL does not answer (the configured deadline reaches the timer)', async () => {
    const timers = recordAbortTimeouts();
    try {
      const { call } = await start(checksWith({ database: hanging('database') }), 300);
      const { value: ready, workMs } = await timeOperation(() => call('/health/ready'));
      expect(ready.status).toBe(503);
      // Magnitude, deterministic: a worker deadline x10 would arm 3 000 ms.
      expect(timers.calls.filter((ms) => ms === 300)).toHaveLength(1);
      expect(timers.calls.filter((ms) => ms === READINESS_CHECK_TIMEOUT_MS)).toHaveLength(READINESS_COMPONENTS.length);
      // Fired, not hung.
      expect(workMs).toBeLessThan(300 + HOST_LOAD_SLACK_MS);
    } finally {
      timers.restore();
    }
  });

  it('AT-US-012-03: the worker uses the AC readiness bounds by default (2 s per check, whole response within 2.5 s)', async () => {
    const timers = recordAbortTimeouts();
    try {
      const { call } = await start(checksWith());
      expect((await call('/health/ready')).status).toBe(200);
      expect(READINESS_CHECK_TIMEOUT_MS).toBe(2_000);
      expect(READINESS_DEADLINE_MS).toBeLessThanOrEqual(2_500);
      expect(timers.calls.filter((ms) => ms === READINESS_DEADLINE_MS)).toHaveLength(1);
      expect(Math.max(...timers.calls.filter((ms) => ms < TEST_TIMEOUT_MS - 5_000))).toBeLessThanOrEqual(2_500);
    } finally {
      timers.restore();
    }
  });

  it('AT-US-012-04: a failing audit_chain check degrades worker readiness without failing it', async () => {
    const { call } = await start(checksWith({ audit_chain: failing('audit_chain', false) }));
    expect(await call('/health/ready')).toMatchObject({
      status: 200,
      body: { status: 'degraded', components: { ...allOk, audit_chain: 'degraded' } },
    });
  });

  it('[PR12-SEC-02 item 3] a failing audit_partitions check takes worker readiness to 503', async () => {
    const { call } = await start(checksWith({ audit_partitions: failing('audit_partitions', true) }));
    expect(await call('/health/ready')).toMatchObject({
      status: 503,
      body: { status: 'unavailable', components: { ...allOk, audit_partitions: 'unavailable' } },
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
