/**
 * Per-tenant admission bulkhead (ADR-0007 am. 10 item 3, D-ARCH-086, data-model §7.7; TASK-025). Unit level with an
 * injected manual clock: FIFO grants, direct hand-off, wait and depth refusals, release on commit and throw, per-key
 * isolation, idle cleanup, key derivation and the counters.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it, jest } from '@jest/globals';

import { DbError } from './map-db-error.js';
import {
  type AdmissionKey,
  admissionKeyOf,
  type AdmissionTimers,
  createTenantAdmission,
  EMPTY_ADMISSION_SNAPSHOT,
  TENANT_ADMISSION_METRICS,
  tenantConcurrencyLimitError,
} from './tenant-admission.js';

interface Pending {
  readonly at: number;
  readonly callback: () => void;
}

/** A manual clock: timers fire only when `advance` passes their deadline. */
function manualTimers() {
  const pending = new Map<number, Pending>();
  let now = 0;
  let sequence = 0;
  const timers: AdmissionTimers = {
    setTimeout: (callback, ms) => {
      sequence += 1;
      pending.set(sequence, { at: now + ms, callback });
      return sequence;
    },
    clearTimeout: (handle) => {
      pending.delete(handle as number);
    },
  };
  const advance = (ms: number): void => {
    now += ms;
    const due = [...pending].filter(([, timer]) => timer.at <= now).sort(([, a], [, b]) => a.at - b.at);
    for (const [id, timer] of due) {
      pending.delete(id);
      timer.callback();
    }
  };
  return { timers, advance, pending: () => pending.size };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

const LIMIT = { status: 503, code: 'SERVICE_UNAVAILABLE', reason: 'TENANT_CONCURRENCY_LIMIT', retryable: true, retryAfterSeconds: 1 };

const tenant = (): AdmissionKey => admissionKeyOf(randomUUID(), 'TENANT');

function setup(maxConcurrentTx = 1, waitMs = 250) {
  const clock = manualTimers();
  const admission = createTenantAdmission({ maxConcurrentTx, waitMs }, clock.timers);
  /** Starts `run` with a callback that records its start and parks until the returned gate is resolved. */
  const hold = (key: AdmissionKey, label: string, started: string[]) => {
    const gate = deferred<string>();
    const done = admission.run(key, () => {
      started.push(label);
      return gate.promise;
    });
    return { gate, done };
  };
  return { admission, clock, hold };
}

describe('[D-ARCH-086] admission key derivation (validated context values)', () => {
  it('operator scope is "operator" whatever the organisation; no organisation is "anonymous"; otherwise the lowercase org', () => {
    const org = randomUUID();
    expect(admissionKeyOf(org, 'OPERATOR')).toEqual({ key: 'operator', kind: 'operator' });
    expect(admissionKeyOf('', 'OPERATOR')).toEqual({ key: 'operator', kind: 'operator' });
    expect(admissionKeyOf('', 'TENANT')).toEqual({ key: 'anonymous', kind: 'anonymous' });
    expect(admissionKeyOf(org.toUpperCase(), 'TENANT')).toEqual({ key: org, kind: 'tenant' });
  });
});

describe('[D-ARCH-086] tenant admission bulkhead', () => {
  it('grants permits FIFO, by direct hand-off, and clears each granted waiter’s timer', async () => {
    const { admission, clock, hold } = setup(1);
    const key = tenant();
    const started: string[] = [];
    const first = hold(key, 'first', started);
    const second = hold(key, 'second', started);
    const third = hold(key, 'third', started);
    await flush();
    expect(started).toEqual(['first']);
    expect(admission.snapshot()).toMatchObject({ queued: 2, keys: 1, inflight: { tenant: 1 } });
    expect(clock.pending()).toBe(2);

    first.gate.resolve('a');
    await expect(first.done).resolves.toBe('a');
    await flush();
    // The permit passed to the head waiter: still one in flight, no free permit appeared, its timer is gone.
    expect(started).toEqual(['first', 'second']);
    expect(admission.snapshot()).toMatchObject({ queued: 1, inflight: { tenant: 1 } });
    expect(clock.pending()).toBe(1);

    // No barging: an arrival while the head holds the permit queues behind the existing waiter.
    const late = hold(key, 'late', started);
    second.gate.resolve('b');
    await expect(second.done).resolves.toBe('b');
    await flush();
    third.gate.resolve('c');
    await expect(third.done).resolves.toBe('c');
    await flush();
    late.gate.resolve('d');
    await expect(late.done).resolves.toBe('d');
    expect(started).toEqual(['first', 'second', 'third', 'late']);
    expect(admission.snapshot()).toEqual(EMPTY_ADMISSION_SNAPSHOT);
    expect(clock.pending()).toBe(0);
  });

  it('a waiter whose wait expires is refused with the retryable 503 (reason wait); its callback never runs', async () => {
    const { admission, clock, hold } = setup(1, 250);
    const key = tenant();
    const started: string[] = [];
    const holder = hold(key, 'holder', started);
    const waiter = hold(key, 'waiter', started);
    await flush();
    clock.advance(249);
    expect(admission.snapshot().queued).toBe(1);
    clock.advance(1);
    const error = await caught(waiter.done);
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject(LIMIT);
    expect(started).toEqual(['holder']);
    expect(admission.snapshot()).toMatchObject({ rejectedTotal: { wait: 1, depth: 0 }, queued: 0, keys: 1, inflight: { tenant: 1 } });
    holder.gate.resolve('done');
    await holder.done;
    expect(admission.snapshot()).toMatchObject({ keys: 0, inflight: { tenant: 0 } });
  });

  it('an arrival that finds 2 × cap waiters is refused at once (reason depth) without a timer', async () => {
    const { admission, clock, hold } = setup(2);
    const key = tenant();
    const started: string[] = [];
    const held = [hold(key, 'h1', started), hold(key, 'h2', started)];
    const waiting = [1, 2, 3, 4].map((n) => hold(key, `w${String(n)}`, started));
    await flush();
    expect(admission.maxQueued).toBe(4);
    expect(admission.snapshot()).toMatchObject({ queued: 4, inflight: { tenant: 2 } });
    const refused = await caught(admission.run(key, () => Promise.resolve('overflow')));
    expect(refused).toMatchObject(LIMIT);
    expect(admission.snapshot().rejectedTotal).toEqual({ wait: 0, depth: 1 });
    expect(clock.pending()).toBe(4);

    for (const entry of held) entry.gate.resolve('ok');
    await flush();
    expect(started).toEqual(['h1', 'h2', 'w1', 'w2']);
    for (const entry of waiting) entry.gate.resolve('ok');
    await Promise.all([...held, ...waiting].map((entry) => entry.done));
    expect(admission.snapshot()).toMatchObject({ keys: 0, queued: 0, inflight: { tenant: 0 } });
  });

  it('releases the permit when the callback commits and when it throws (synchronously or asynchronously)', async () => {
    const { admission } = setup(1);
    const key = tenant();
    await expect(admission.run(key, () => Promise.resolve('committed'))).resolves.toBe('committed');
    expect(admission.snapshot().keys).toBe(0);
    const failure = new Error('rolled back');
    expect(await caught(admission.run(key, () => Promise.reject(failure)))).toBe(failure);
    expect(admission.snapshot().keys).toBe(0);
    const syncThrow = (): Promise<never> => {
      throw failure;
    };
    expect(await caught(admission.run(key, syncThrow))).toBe(failure);
    expect(admission.snapshot()).toEqual(EMPTY_ADMISSION_SNAPSHOT);
  });

  it('a throwing holder hands its permit to the next waiter', async () => {
    const { admission, hold } = setup(1);
    const key = tenant();
    const started: string[] = [];
    const holder = hold(key, 'holder', started);
    const waiter = hold(key, 'waiter', started);
    await flush();
    holder.gate.reject(new Error('serialization failure'));
    await caught(holder.done);
    await flush();
    expect(started).toEqual(['holder', 'waiter']);
    waiter.gate.resolve('ok');
    await expect(waiter.done).resolves.toBe('ok');
    expect(admission.snapshot().keys).toBe(0);
  });

  it('isolates keys: org B is admitted at once while org A is saturated and its queue is full', async () => {
    const { admission, hold } = setup(1);
    const orgA = tenant();
    const orgB = tenant();
    const started: string[] = [];
    const a = [hold(orgA, 'a1', started), hold(orgA, 'a2', started), hold(orgA, 'a3', started)];
    await flush();
    expect(await caught(admission.run(orgA, () => Promise.resolve('a4')))).toMatchObject(LIMIT);
    await expect(admission.run(orgB, () => Promise.resolve('b'))).resolves.toBe('b');
    expect(admission.snapshot()).toMatchObject({ keys: 1, queued: 2, rejectedTotal: { depth: 1 } });
    for (const entry of a) entry.gate.resolve('ok');
    await Promise.all(a.map((entry) => entry.done));
    expect(admission.snapshot().keys).toBe(0);
  });

  it('keeps no state for idle keys (bounded memory over many organisations)', async () => {
    const { admission } = setup(2);
    await Promise.all(Array.from({ length: 1_000 }, () => admission.run(tenant(), () => Promise.resolve(1))));
    expect(admission.snapshot()).toEqual(EMPTY_ADMISSION_SNAPSHOT);
  });

  it('counts the in-flight gauge per key kind and the rejections per reason', async () => {
    const { admission, clock, hold } = setup(1, 100);
    const started: string[] = [];
    const operator = hold(admissionKeyOf(randomUUID(), 'OPERATOR'), 'operator', started);
    const anonymous = hold(admissionKeyOf('', 'TENANT'), 'anonymous', started);
    const org = tenant();
    const member = hold(org, 'tenant', started);
    const waiter = hold(org, 'waiter', started);
    await flush();
    expect(admission.snapshot()).toEqual({
      rejectedTotal: { wait: 0, depth: 0 },
      inflight: { tenant: 1, anonymous: 1, operator: 1 },
      queued: 1,
      keys: 3,
    });
    clock.advance(100);
    await caught(waiter.done);
    for (const entry of [operator, anonymous, member]) entry.gate.resolve('ok');
    await Promise.all([operator.done, anonymous.done, member.done]);
    expect(admission.snapshot()).toEqual({ ...EMPTY_ADMISSION_SNAPSHOT, rejectedTotal: { wait: 1, depth: 0 } });
    expect(TENANT_ADMISSION_METRICS).toEqual({
      rejectedTotal: 'db_tenant_admission_rejected_total',
      inflight: 'db_tenant_admission_inflight',
    });
  });

  it('snapshots are frozen copies', () => {
    const { admission } = setup();
    const snapshot = admission.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.rejectedTotal)).toBe(true);
    expect(Object.isFrozen(snapshot.inflight)).toBe(true);
  });

  it('the refusal is the 503 TENANT_CONCURRENCY_LIMIT DbError', () => {
    expect(tenantConcurrencyLimitError()).toMatchObject(LIMIT);
  });

  it.each([
    [{ maxConcurrentTx: 0, waitMs: 250 }, 'maxConcurrentTx'],
    [{ maxConcurrentTx: 1.5, waitMs: 250 }, 'maxConcurrentTx'],
    [{ maxConcurrentTx: 2, waitMs: 0 }, 'waitMs'],
    [{ maxConcurrentTx: 2, waitMs: Number.NaN }, 'waitMs'],
  ])('refuses invalid options %p', (options, name) => {
    expect(() => createTenantAdmission(options)).toThrow(new RangeError(`tenant admission: ${name} must be a positive integer`));
  });

  it('uses the global timers by default', async () => {
    const admission = createTenantAdmission({ maxConcurrentTx: 1, waitMs: 5 });
    const key = tenant();
    const gate = deferred();
    const holder = admission.run(key, () => gate.promise);
    expect(await caught(admission.run(key, () => Promise.resolve()))).toMatchObject(LIMIT);
    gate.resolve();
    await holder;
    expect(admission.snapshot()).toMatchObject({ keys: 0, rejectedTotal: { wait: 1 } });
  });
});

describe('[PR #42 R1-n7] default timers', () => {
  it("a queued waiter's wait timer is unref'd, so it never holds the process open at shutdown", async () => {
    const handles: Array<ReturnType<typeof setTimeout>> = [];
    const real = globalThis.setTimeout;
    const spy = jest.spyOn(globalThis, 'setTimeout').mockImplementation((callback: () => void, ms?: number) => {
      const handle = real(callback, ms);
      handles.push(handle);
      return handle;
    });
    try {
      const admission = createTenantAdmission({ maxConcurrentTx: 1, waitMs: 1_000 });
      const key = admissionKeyOf(randomUUID(), 'TENANT');
      const gate = deferred();
      const holder = admission.run(key, () => gate.promise);
      const waiter = admission.run(key, () => Promise.resolve('admitted'));
      await flush();
      expect(handles).toHaveLength(1);
      expect(handles[0]?.hasRef()).toBe(false);
      gate.resolve();
      await holder;
      await expect(waiter).resolves.toBe('admitted');
    } finally {
      spy.mockRestore();
    }
  });
});
