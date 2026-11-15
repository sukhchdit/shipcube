import { describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

import {
  createReadinessProbe,
  type PendableComponent,
  pendingCheck,
  READINESS_CACHE_TTL_MS,
  READINESS_DEADLINE_MS,
  READINESS_COMPONENTS,
  type ReadinessBody,
  type ReadinessCheck,
  type ReadinessComponent,
  type ReadinessOptions,
} from '../runtime/readiness.js';
import { defaultPipelineSlots, mountRoutes } from '../routing/pipeline.js';
import { HOST_LOAD_SLACK_MS, LOOPBACK_TEST_TIMEOUT_MS } from '../routing/tests/loopback.js';
import { healthRoutes } from './router.js';

// Every case makes real HTTP requests; the 5 s Jest default timed out under parallel host load (W0-FLAKE).
jest.setTimeout(LOOPBACK_TEST_TIMEOUT_MS);

const critical = (name: ReadinessComponent): boolean => name !== 'audit_chain';

/** A check that fails with a message full of internals the body must never show (AT-US-012-05). */
const failing = (name: ReadinessComponent): ReadinessCheck => ({
  name,
  critical: critical(name),
  check: () => Promise.reject(new Error(`connect ECONNREFUSED db.internal.example:5432 (postgres 18.1) at ${name}`)),
});

/** A dependency that never answers and ignores its abort signal. */
const hanging = (name: ReadinessComponent): ReadinessCheck => ({
  name,
  critical: critical(name),
  check: () => new Promise<void>(() => undefined),
});

/** A dependency that answers. */
const passing = (name: ReadinessComponent): ReadinessCheck => ({ name, critical: critical(name), check: () => Promise.resolve() });

function checksWith(overrides: Partial<Record<ReadinessComponent, ReadinessCheck>> = {}): ReadinessCheck[] {
  return READINESS_COMPONENTS.map((name) => overrides[name] ?? passing(name));
}

/** A check that counts its runs and answers after `release()`. */
function gated(name: ReadinessComponent) {
  let runs = 0;
  let release: () => void = () => undefined;
  const check: ReadinessCheck = {
    name,
    critical: critical(name),
    check: () => {
      runs += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  };
  return { check, runs: () => runs, release: () => release() };
}

function appWith(checks: readonly ReadinessCheck[], options: ReadinessOptions = {}) {
  const probe = createReadinessProbe(checks, options);
  const app = express();
  app.use(mountRoutes(express.Router(), healthRoutes({ probe }), defaultPipelineSlots({ tenantTx: undefined })));
  return { app, probe };
}

const bodyOf = (response: { body: unknown }): ReadinessBody => response.body as ReadinessBody;

const allOk = { database: 'ok', redis: 'ok', object_storage: 'ok', audit_partitions: 'ok', audit_chain: 'ok' };

describe('US-012 liveness and readiness endpoints (api)', () => {
  it('AT-US-012-01: healthy stack, live and ready return 200 without authentication; ready lists every dependency ok', async () => {
    const { app } = appWith(checksWith());
    const live = await request(app).get('/health/live');
    expect(live.status).toBe(200);
    expect(live.body).toEqual({ status: 'ok' });
    expect(live.headers['cache-control']).toBe('no-store');
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.headers['content-type']).toMatch(/^application\/json/);
    expect(ready.headers['cache-control']).toBe('no-store');
    expect(ready.body).toEqual({ status: 'ok', components: allOk });
  });

  it.each([
    ['postgres', 'database'],
    ['redis', 'redis'],
    ['object-storage', 'object_storage'],
  ] as const)('AT-US-012-02-%s: an unreachable dependency makes ready 503 with it down; live stays 200', async (_row, component) => {
    const { app } = appWith(checksWith({ [component]: failing(component) }));
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ status: 'unavailable', components: { ...allOk, [component]: 'unavailable' } });
    expect((await request(app).get('/health/live')).status).toBe(200);
  });

  it('AT-US-012-03: a dependency that does not answer is bounded (per-check timeout and overall deadline)', async () => {
    const { app } = appWith(checksWith({ database: hanging('database') }));
    const started = performance.now();
    const ready = await request(app).get('/health/ready');
    expect(performance.now() - started).toBeLessThan(READINESS_DEADLINE_MS + HOST_LOAD_SLACK_MS);
    expect(ready.status).toBe(503);
    expect(bodyOf(ready).components).toEqual({ ...allOk, database: 'unavailable' });
  });

  it('AT-US-012-03: the overall deadline bounds checks even when the per-check timeout is longer', async () => {
    const { app } = appWith(checksWith({ redis: hanging('redis') }), { checkTimeoutMs: 60_000, deadlineMs: 100 });
    const started = performance.now();
    const ready = await request(app).get('/health/ready');
    expect(performance.now() - started).toBeLessThan(100 + HOST_LOAD_SLACK_MS);
    expect(bodyOf(ready).components.redis).toBe('unavailable');
  });

  it('AT-US-012-04: a failing audit_chain check reports degraded and readiness stays 200', async () => {
    const { app } = appWith(checksWith({ audit_chain: failing('audit_chain') }));
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'degraded', components: { ...allOk, audit_chain: 'degraded' } });
  });

  it('AT-US-012-04: a late audit partition (check resolves "degraded") reports degraded and readiness stays 200', async () => {
    const late: ReadinessCheck = { name: 'audit_partitions', critical: true, check: () => Promise.resolve('degraded' as const) };
    const { app } = appWith(checksWith({ audit_partitions: late }));
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'degraded', components: { ...allOk, audit_partitions: 'degraded' } });
  });

  it('[PR12-SEC-02 item 3, D-ARCH-076] a failing audit_partitions check (missing month or squat) makes readiness 503', async () => {
    const { app } = appWith(checksWith({ audit_partitions: failing('audit_partitions') }));
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ status: 'unavailable', components: { ...allOk, audit_partitions: 'unavailable' } });
  });

  it('"degraded" from a component whose schema enum lacks it fails closed', async () => {
    const odd: ReadinessCheck = { name: 'redis', critical: true, check: () => Promise.resolve('degraded' as const) };
    const { app } = appWith(checksWith({ redis: odd }));
    expect(bodyOf(await request(app).get('/health/ready')).components.redis).toBe('unavailable');
  });

  it('AT-US-012-05: bodies hold no version, host name, error message or stack, and nothing beyond the schema', async () => {
    const { app } = appWith(checksWith({ database: failing('database'), audit_chain: failing('audit_chain') }));
    for (const path of ['/health/live', '/health/ready']) {
      const response = await request(app).get(path);
      expect(response.text).not.toMatch(/ECONNREFUSED|internal|example|\d+\.\d+|postgres|stack|Error/);
      expect(response.headers['x-powered-by']).toBeUndefined();
    }
    const ready = await request(app).get('/health/ready');
    expect(Object.keys(ready.body as object)).toEqual(['status', 'components']);
    expect(Object.keys((ready.body as { components: object }).components)).toEqual([...READINESS_COMPONENTS]);
  });

  it('a synchronous throw in a check counts as a failure, not a crash', async () => {
    const throwing: ReadinessCheck = {
      name: 'redis',
      critical: true,
      check: () => {
        throw new TypeError('sync');
      },
    };
    const { app } = appWith(checksWith({ redis: throwing }));
    expect(bodyOf(await request(app).get('/health/ready')).components.redis).toBe('unavailable');
  });

  it('[NFR-AVAIL-002] readiness answers 503 at once while draining, without running checks', async () => {
    let runs = 0;
    const counted: ReadinessCheck = { name: 'database', critical: true, check: () => Promise.resolve(void runs++) };
    const { app, probe } = appWith(checksWith({ database: counted }));
    probe.startDraining();
    expect(probe.draining).toBe(true);
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(503);
    expect(bodyOf(ready).status).toBe('unavailable');
    expect(runs).toBe(0);
    expect((await request(app).get('/health/live')).status).toBe(200);
  });

  it.each([
    ['a missing component', checksWith().slice(1)],
    ['a duplicated component', [...checksWith(), pendingCheck('redis')]],
    ['an audit check marked critical', checksWith({ audit_chain: { ...passing('audit_chain'), critical: true } })],
  ])('refuses %s at construction', (_label, checks) => {
    expect(() => createReadinessProbe(checks)).toThrow(TypeError);
  });

  it('[PR9-SEC-11, PR #24 R1-n2] an audit component is never stubbed; a pending critical check passes', async () => {
    for (const name of ['audit_partitions', 'audit_chain'] as const) {
      expect(() => pendingCheck(name as ReadinessComponent as PendableComponent)).toThrow(TypeError);
    }
    const { app } = appWith(checksWith({ object_storage: pendingCheck('object_storage') }));
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ok', components: allOk });
  });
});

describe('[PR-0009 m3, PR9-SEC-08] readiness single-flight and short reuse', () => {
  it('50 concurrent readiness calls run each check once', async () => {
    const database = gated('database');
    const probe = createReadinessProbe(checksWith({ database: database.check }), { cacheTtlMs: 0 });
    const calls = Array.from({ length: 50 }, () => probe.readiness());
    await new Promise((resolve) => setImmediate(resolve));
    database.release();
    const reports = await Promise.all(calls);
    expect(database.runs()).toBe(1);
    expect(new Set(reports).size).toBe(1);
    expect(reports[0]?.httpStatus).toBe(200);
  });

  it('a completed report is reused within the TTL and re-evaluated after it; draining answers at once regardless', async () => {
    let clock = 0;
    let runs = 0;
    const counted: ReadinessCheck = { name: 'redis', critical: true, check: () => Promise.resolve(void runs++) };
    const probe = createReadinessProbe(checksWith({ redis: counted }), { cacheTtlMs: 1_000, now: () => clock });
    await probe.readiness();
    clock = 999;
    await probe.readiness();
    expect(runs).toBe(1);
    clock = 1_000;
    await probe.readiness();
    expect(runs).toBe(2);
    probe.startDraining();
    expect((await probe.readiness()).httpStatus).toBe(503);
    expect(runs).toBe(2);
  });

  it('the default reuse window is 1 s', async () => {
    let clock = 0;
    let runs = 0;
    const counted: ReadinessCheck = { name: 'redis', critical: true, check: () => Promise.resolve(void runs++) };
    const probe = createReadinessProbe(checksWith({ redis: counted }), { now: () => clock });
    await probe.readiness();
    clock = READINESS_CACHE_TTL_MS - 1;
    await probe.readiness();
    expect(runs).toBe(1);
    clock = READINESS_CACHE_TTL_MS;
    await probe.readiness();
    expect(runs).toBe(2);
  });
});
