import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import { CORRELATION_ID_PATTERN } from '../correlation/correlation-id.js';

import {
  BACKOFF_BASE_MS,
  BACKOFF_JITTER,
  BACKOFF_TYPE,
  COMPLETED_RETENTION,
  DEAD_LETTER_RETENTION,
  FAILED_RETENTION,
  retryAndRetentionOptions,
  SCHEDULED_JOBS,
  scheduledPayload,
  validateDequeuedJob,
  MAX_ISSUES,
  carriesTenantContext,
  isJobIdOf,
  SCHEDULE_NAMES,
  SCHEDULE_NAME_PATTERN,
  SCHEDULED_JOB_ID,
  deadLetterQueueName,
  isJobPayloadV2,
  isQueueName,
  JOB_ATTEMPTS,
  JOB_ID_PATTERN,
  JOB_KINDS,
  jobIdFor,
  jobOptions,
  mergeQueues,
  QUEUE_MODULES,
  QUEUE_NAMES,
  QUEUES,
  retryDelayMs,
  validateJobPayload,
} from './index.js';
import { isTracestate, payloadSchemaFor } from './payload-v2.js';

/** Characters String#trim would strip but the W3C tracestate grammar does not allow (built by code, not typed). */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

const ID = '0193a5b2-7c1e-7d4a-9f3b-000000000f01';
const payload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 2,
  kind: 'outbox_event',
  id: ID,
  correlation_id: 'demo-booking-0001',
  trace_context: null,
  ...overrides,
});

describe('named queues (ADR-0013 §1, REQ-PLAT-013; TASK-035)', () => {
  it('aggregates every queues/<module>.ts file, and nothing else', () => {
    const helpers = new Set(['index.ts', 'queue-definition.ts', 'job-options.ts', 'payload-v2.ts', 'scheduled-job.ts']);
    const files = readdirSync(dirname(fileURLToPath(import.meta.url)))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !helpers.has(name))
      .map((name) => name.slice(0, -'.ts'.length))
      .sort();
    expect(Object.keys(QUEUE_MODULES).sort()).toEqual(files);
  });

  it('names the nine ADR-0013 queues as constants, each with a dead-letter queue', () => {
    expect(QUEUE_NAMES).toEqual([
      'audit-maintenance',
      'booking',
      'documents',
      'housekeeping',
      'notifications',
      'outbox-relay',
      'payments',
      'pickups',
      'tracking-poll',
    ]);
    expect(deadLetterQueueName('booking')).toBe('booking-dead');
    for (const name of QUEUE_NAMES) expect(deadLetterQueueName(name)).not.toContain(':');
    expect(isQueueName('booking')).toBe(true);
    expect(isQueueName('booking-dead')).toBe(false);
    expect(isQueueName('toString')).toBe(false);
  });

  it('uses only job_context kinds, with the ADR-0013 §6 concurrency defaults', () => {
    for (const definition of Object.values(QUEUES)) {
      for (const kind of definition.kinds) expect(JOB_KINDS).toContain(kind);
      expect(definition.concurrency).toBeGreaterThanOrEqual(1);
    }
    expect(QUEUES.booking.concurrency).toBe(5);
    expect(QUEUES['tracking-poll'].concurrency).toBe(10);
    expect(QUEUES['audit-maintenance'].concurrency).toBe(1);
  });

  it('refuses a queue declared twice, a name with ":" and a name that collides with a dead-letter queue', () => {
    const one = { kinds: [], concurrency: 1 };
    expect(() => mergeQueues({ a: { x: one }, b: { x: one } })).toThrow('Queue x is declared by both a and b');
    expect(() => mergeQueues({ a: { 'x:dead': one } })).toThrow('is not a lower-case kebab name');
    expect(() => mergeQueues({ a: { 'x-dead': one } })).toThrow('is not a lower-case kebab name');
    expect(() => mergeQueues({ a: { Booking: one } })).toThrow('is not a lower-case kebab name');
  });
});

describe('job options (ADR-0013 §2, DR-A25)', () => {
  it('[PR64-SEC-04] 5 attempts, the jittered exponential backoff from 2 s, completed jobs kept 24 h / 10,000, failed jobs 7 days / 1,000', () => {
    expect(jobOptions('outbox_event.x')).toEqual({
      jobId: 'outbox_event.x',
      attempts: JOB_ATTEMPTS,
      backoff: { type: BACKOFF_TYPE, delay: BACKOFF_BASE_MS },
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: FAILED_RETENTION,
      // PR64-SEC-02: BullMQ keeps no stack frames in the job hash.
      stackTraceLimit: 0,
    });
    expect([JOB_ATTEMPTS, BACKOFF_BASE_MS]).toEqual([5, 2_000]);
  });

  it('[AT-US-009-01] retry delays are about 2 s, 4 s, 8 s, 16 s, each within the jitter band', () => {
    expect([1, 2, 3, 4].map((retry) => retryDelayMs(retry, BACKOFF_BASE_MS, () => 0.5))).toEqual([2_000, 4_000, 8_000, 16_000]);
    for (const retry of [1, 2, 3, 4]) {
      const nominal = BACKOFF_BASE_MS * 2 ** (retry - 1);
      expect(retryDelayMs(retry, BACKOFF_BASE_MS, () => 0)).toBe(Math.round(nominal * (1 - BACKOFF_JITTER)));
      expect(retryDelayMs(retry, BACKOFF_BASE_MS, () => 0.999_999)).toBe(Math.round(nominal * (1 + BACKOFF_JITTER * 0.999_998)));
    }
    // Defaults: Math.random within the band; a hostile draw or attempt count is clamped.
    const delay = retryDelayMs(1);
    expect(delay).toBeGreaterThanOrEqual(1_600);
    expect(delay).toBeLessThanOrEqual(2_400);
    expect(retryDelayMs(0, 100, () => 7)).toBe(120);
    expect(retryDelayMs(Number.NaN, 100, () => -1)).toBe(80);
    expect(retryDelayMs(1_000, 1, () => 0.5)).toBe(2 ** 29);
  });
});

describe('job payload v2 (ADR-0013 amendment 1; SEC-P3-12, SEC-TC-50)', () => {
  const relay = QUEUES['outbox-relay'];

  it('accepts identifiers only: v, kind, id, correlation_id, trace_context', () => {
    expect(validateJobPayload(relay, payload())).toEqual({ ok: true, payload: payload() });
    const traced = payload({ trace_context: { traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`, tracestate: 'k=v' } });
    expect(isJobPayloadV2(relay, traced)).toBe(true);
  });

  it('refuses an unknown field, business data, a wrong version, a kind of another queue and a malformed id, naming paths only', () => {
    const result = validateJobPayload(relay, payload({ v: 1, kind: 'saga', id: 'not-a-uuid', token: 'secret-value', data: { x: 1 } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect([...result.issues].sort()).toEqual([
      'data: object.unknown',
      'id: string.pattern.base',
      'kind: any.only',
      'token: object.unknown',
      'v: any.only',
    ]);
    expect(JSON.stringify(result)).not.toContain('secret-value');
    expect(result.carriesTenantContext).toBe(false);
  });

  it('flags a payload that carries tenant context (org_id / actor_id) as a forgery, even beside valid fields', () => {
    for (const key of ['org_id', 'actor_id', 'orgId']) {
      const result = validateJobPayload(relay, payload({ [key]: ID }));
      expect(result).toMatchObject({ ok: false, carriesTenantContext: true });
    }
  });

  it('refuses a converted value (no coercion), a missing field, a null or non-object payload, and every payload on a queue without kinds', () => {
    expect(isJobPayloadV2(relay, payload({ v: '2' }))).toBe(false);
    expect(isJobPayloadV2(relay, payload({ trace_context: undefined }))).toBe(false);
    expect(isJobPayloadV2(relay, payload({ correlation_id: 'bad id with spaces' }))).toBe(false);
    expect(isJobPayloadV2(relay, payload({ trace_context: { traceparent: `00-${'0'.repeat(32)}-${'b'.repeat(16)}-01` } }))).toBe(false);
    expect(validateJobPayload(relay, null)).toMatchObject({ ok: false, issues: ['(root): object.base'] });
    expect(isJobPayloadV2(relay, 'x')).toBe(false);
    expect(isJobPayloadV2(QUEUES.housekeeping, payload())).toBe(false);
  });

  it('[R1-m1] a queue without kinds refuses every payload, including one with no kind at all', () => {
    const kindless = Object.fromEntries(Object.entries(payload()).filter(([key]) => key !== 'kind'));
    for (const name of ['housekeeping', 'audit-maintenance'] as const) {
      expect(QUEUES[name].kinds).toEqual([]);
      expect(validateJobPayload(QUEUES[name], kindless)).toMatchObject({ ok: false, issues: ['kind: any.required'] });
      expect(validateJobPayload(QUEUES[name], payload())).toMatchObject({ ok: false, issues: ['kind: any.invalid'] });
      // `undefined` is "no payload", which Joi accepts for an object schema unless it is required.
      expect(validateJobPayload(QUEUES[name], undefined)).toMatchObject({ ok: false, issues: ['(root): any.required'] });
      expect(isJobPayloadV2(QUEUES['outbox-relay'], undefined)).toBe(false);
      expect(isJobPayloadV2(QUEUES[name], {})).toBe(false);
    }
  });

  it('builds the schema of a queue once', () => {
    expect(payloadSchemaFor(relay)).toBe(payloadSchemaFor(relay));
    expect(payloadSchemaFor(relay)).not.toBe(payloadSchemaFor(QUEUES.booking));
  });

  describe('[PR64-SEC-05] trace_context.tracestate follows the W3C grammar', () => {
    const traced = (tracestate: string): Record<string, unknown> =>
      payload({ trace_context: { traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`, tracestate } });

    it('accepts well-formed lists: vendor keys, tenant@system keys, 32 members, a 256-character value', () => {
      for (const ok of [
        'k=v',
        'vendor1=abc123,tenant@vendor2=x-y_z',
        ' a=1 ,\tb=2',
        `k=${'v'.repeat(256)}`,
        Array.from({ length: 32 }, (_item, index) => `k${String(index)}=v`).join(','),
      ])
        expect([ok.slice(0, 20), isTracestate(ok)]).toEqual([ok.slice(0, 20), true]);
      expect(isJobPayloadV2(QUEUES['outbox-relay'], traced('vendor1=abc123,tenant@vendor2=x-y_z'))).toBe(true);
    });

    it('refuses control characters, free text, a malformed member and an over-long list or value', () => {
      for (const bad of [
        'a=b\r\nX-Injected: 1',
        'a=b\0',
        `a=b${LINE_SEPARATOR}c`,
        `a=b${NO_BREAK_SPACE}`,
        'novalue',
        '=v',
        'a=',
        'A=v',
        'a=b,c',
        'a=b,,c=d',
        'a=b,',
        `k=${'v'.repeat(257)}`,
        Array.from({ length: 33 }, (_item, index) => `k${String(index)}=v`).join(','),
        'k=v\u0085',
        'a=x=y',
      ])
        expect([JSON.stringify(bad).slice(0, 30), isTracestate(bad)]).toEqual([JSON.stringify(bad).slice(0, 30), false]);
      expect(validateJobPayload(QUEUES['outbox-relay'], traced('a=b\r\nHost: evil'))).toMatchObject({
        ok: false,
        issues: ['trace_context.tracestate: any.invalid'],
      });
      expect(isJobPayloadV2(QUEUES['outbox-relay'], traced('x'.repeat(513)))).toBe(false);
    });

    it('is linear in the input: near-miss blank and key runs 8 times longer take far less than 64 times as long', () => {
      const best = (input: string): number => {
        let fastest = Number.POSITIVE_INFINITY;
        for (let run = 0; run < 7; run += 1) {
          const start = performance.now();
          for (let repeat = 0; repeat < 20; repeat += 1) isTracestate(input);
          fastest = Math.min(fastest, performance.now() - start);
        }
        return Math.max(fastest, 0.001);
      };
      const shapes = [
        (n: number) => `a=${' '.repeat(n)}x`,
        (n: number) => `${' '.repeat(n)}a=b${LINE_SEPARATOR}`,
        (n: number) => `${'a'.repeat(n)}@`,
      ];
      for (const shape of shapes) expect(best(shape(128_000)) / best(shape(16_000))).toBeLessThan(32);
    });
  });

  it('builds deterministic job ids from the business key, without ":"', () => {
    expect(jobIdFor({ kind: 'outbox_event', id: ID })).toBe(`outbox_event.${ID}`);
    expect(jobIdFor({ kind: 'saga', id: ID, step: 'book-carrier' })).toBe(`saga.${ID}.book-carrier`);
    expect(JOB_ID_PATTERN.test(jobIdFor({ kind: 'saga', id: ID, step: 'book-carrier' }))).toBe(true);
    expect(() => jobIdFor({ kind: 'saga', id: ID.toUpperCase() })).toThrow('job id must be a lower-case UUID');
    expect(() => jobIdFor({ kind: 'saga', id: ID, step: 'a:b' })).toThrow('job step must be');
  });
});

describe('[PR64-SEC-04] retention bounds (ADR-0013 am. 3; D-ARCH-159)', () => {
  it('exports the three constants with the ADR values (ages in seconds), frozen', () => {
    expect(COMPLETED_RETENTION).toEqual({ age: 86_400, count: 10_000 });
    expect(FAILED_RETENTION).toEqual({ age: 604_800, count: 1_000 });
    expect(DEAD_LETTER_RETENTION).toEqual({ age: 1_209_600, count: 2_000 });
    for (const bound of [COMPLETED_RETENTION, FAILED_RETENTION, DEAD_LETTER_RETENTION]) expect(Object.isFrozen(bound)).toBe(true);
    // Item 9: the record bounds are never below the failed-job bounds.
    expect(DEAD_LETTER_RETENTION.age).toBeGreaterThanOrEqual(FAILED_RETENTION.age);
    expect(DEAD_LETTER_RETENTION.count).toBeGreaterThanOrEqual(FAILED_RETENTION.count);
  });

  it('hands BullMQ fresh copies, never the frozen constants, and the scheduler template carries both bounds', () => {
    const options = jobOptions('outbox_event.x');
    expect(options.removeOnFail).not.toBe(FAILED_RETENTION);
    expect(options.removeOnComplete).not.toBe(COMPLETED_RETENTION);
    expect({ ...retryAndRetentionOptions(), jobId: 'outbox_event.x' }).toEqual(options);
  });
});

describe('[PR64-SEC-06] forgery signal and bounds of the payload check', () => {
  const relay = QUEUES['outbox-relay'];

  it.each([
    'ORG_ID',
    'OrgId',
    'orgID',
    'org-id',
    'tenant_id',
    'tenantId',
    'organisation_id',
    'organization_id',
    'actorID',
    'actor_type',
    // PR039-SEC-04: compound spellings.
    'on_behalf_of_org_id',
    'orgUuid',
    'user_id',
    'targetTenantId',
    'orgRefId',
  ])('flags %s as tenant context', (key) => {
    expect(validateJobPayload(relay, payload({ [key]: ID }))).toMatchObject({ ok: false, carriesTenantContext: true });
  });

  it('flags a nested tenant key (trace_context.org_id), and does not flag a valid traced payload', () => {
    const nested = payload({ trace_context: { traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`, org_id: ID } });
    expect(validateJobPayload(relay, nested)).toMatchObject({ ok: false, carriesTenantContext: true });
    expect(isJobPayloadV2(relay, payload({ trace_context: { traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01` } }))).toBe(true);
  });

  it('refuses and flags an own __proto__ key from JSON.parse instead of letting the schema clone drop it', () => {
    const parsed: unknown = JSON.parse(
      `{"v":2,"kind":"outbox_event","id":"${ID}","correlation_id":"demo-booking-0001","trace_context":null,"__proto__":{"x":1}}`,
    );
    expect(validateJobPayload(relay, parsed)).toEqual({ ok: false, issues: ['__proto__: object.unknown'], carriesTenantContext: true });
  });

  it('caps the issue list, and refuses an oversized payload without running the schema', () => {
    const many = Object.fromEntries(Array.from({ length: 25 }, (_unused, index) => [`k${String(index)}`, index]));
    const capped = validateJobPayload(relay, payload(many));
    expect(capped.ok).toBe(false);
    if (capped.ok) return;
    expect(capped.issues).toHaveLength(MAX_ISSUES + 1);
    expect(capped.issues.at(-1)).toBe('(+5 more)');
    const huge = Object.fromEntries(Array.from({ length: 100_000 }, (_unused, index) => [`k${String(index)}`, index]));
    // An oversized payload is refused without the schema, and flagged: no producer writes one (R1-m2).
    expect(validateJobPayload(relay, payload(huge))).toEqual({ ok: false, issues: ['(root): object.max'], carriesTenantContext: true });
  });

  it('[R1-m2][PR039-SEC-04] examines every root key before anything nested, and flags a payload past the walk bounds as unexamined', () => {
    // P1a: a root org_id behind a nested filler that alone exhausts the key budget.
    const filler = Object.fromEntries(Array.from({ length: 300 }, (_unused, index) => [`f${String(index)}`, index]));
    expect(carriesTenantContext({ a: filler, org_id: ID })).toBe(true);
    // The same filler without any tenant key: past the budget, so flagged as unexamined.
    expect(carriesTenantContext({ a: filler })).toBe(true);
    // 300 root keys.
    expect(carriesTenantContext(filler)).toBe(true);
    // Past the depth bound.
    expect(carriesTenantContext({ a: { b: { c: { d: { e: { f: 1 } } } } } })).toBe(true);
    // Legitimate shapes stay clean.
    expect(carriesTenantContext(payload())).toBe(false);
    expect(
      carriesTenantContext(payload({ trace_context: { traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`, tracestate: 'k=v' } })),
    ).toBe(false);
    expect(carriesTenantContext({ v: 2, schedule: 'queue-retention' })).toBe(false);
    expect(carriesTenantContext(null)).toBe(false);
  });
});

describe('[PR64-SEC-07] dequeue check: payload and job identity agree (D-TASK039-01)', () => {
  const relay = QUEUES['outbox-relay'];
  const housekeeping = QUEUES.housekeeping;
  const key = `outbox_event.${ID}`;

  it('accepts an aggregate job whose id is <kind>.<id>[.<step>] of its payload and whose name is the kind', () => {
    expect(validateDequeuedJob(relay, { id: key, name: 'outbox_event', data: payload() })).toEqual({
      ok: true,
      payload: payload(),
      correlationId: 'demo-booking-0001',
    });
    expect(validateDequeuedJob(QUEUES.booking, { id: `saga.${ID}.book`, name: 'saga', data: payload({ kind: 'saga' }) }).ok).toBe(true);
  });

  it('refuses a job whose id names another aggregate, has no id, or whose name is not the kind', () => {
    const other = '0193a5b2-7c1e-7d4a-9f3b-000000000f02';
    const cases = [
      { id: `outbox_event.${other}`, name: 'outbox_event' },
      { id: `${key}x`, name: 'outbox_event' },
      { id: `${key}.Bad:Step`, name: 'outbox_event' },
      { id: '7', name: 'outbox_event' },
      { id: undefined, name: 'outbox_event' },
      { id: key, name: 'saga' },
    ];
    for (const job of cases)
      expect(validateDequeuedJob(relay, { ...job, data: payload() })).toMatchObject({ ok: false, carriesTenantContext: false });
  });

  it('accepts a scheduled occurrence: schedule payload, name = schedule, id repeat:<schedule>:<millis>; the occurrence is the correlation id', () => {
    expect(SCHEDULED_JOBS).toEqual([
      { schedule: 'outbox-purge', queue: 'housekeeping' },
      { schedule: 'queue-retention', queue: 'housekeeping' },
    ]);
    const data = scheduledPayload('queue-retention');
    expect(data).toEqual({ v: 2, schedule: 'queue-retention' });
    expect(validateDequeuedJob(housekeeping, { id: 'repeat:queue-retention:1763550000000', name: 'queue-retention', data })).toEqual({
      ok: true,
      payload: data,
      correlationId: 'queue-retention-1763550000000',
    });
  });

  it('refuses a scheduled payload with a foreign id or name, on a queue without that schedule, or with extra keys', () => {
    const data = scheduledPayload('queue-retention');
    const refusedJobs = [
      { queue: housekeeping, id: 'queue-retention.x', name: 'queue-retention', data },
      { queue: housekeeping, id: 'repeat:other:1763550000000', name: 'queue-retention', data },
      { queue: housekeeping, id: 'repeat:queue-retention:1763550000000', name: 'other', data },
      { queue: housekeeping, id: 'repeat:queue-retention:1763550000000', name: 'queue-retention', data: { ...data, org_id: ID } },
      { queue: housekeeping, id: 'repeat:queue-retention:1763550000000', name: 'queue-retention', data: { v: 2, schedule: 'other' } },
      { queue: relay, id: 'repeat:queue-retention:1763550000000', name: 'queue-retention', data },
    ];
    for (const { queue, ...job } of refusedJobs) expect(validateDequeuedJob(queue, job).ok).toBe(false);
    expect(
      validateDequeuedJob(housekeeping, { id: 'repeat:queue-retention:1', name: 'queue-retention', data: { ...data, org_id: ID } }),
    ).toMatchObject({ ok: false, carriesTenantContext: true });
    // An aggregate payload on the schedule-only queue is still refused (no kinds).
    expect(validateDequeuedJob(housekeeping, { id: key, name: 'outbox_event', data: payload() }).ok).toBe(false);
  });

  it('[R1-n1] every schedule name fits the occurrence id grammar, so <schedule>-<millis> is a valid correlation id (D-SECPR039-01 (iii))', () => {
    for (const name of SCHEDULE_NAMES) {
      expect(name).toMatch(SCHEDULE_NAME_PATTERN);
      expect(`${name}-${String(Number.MAX_SAFE_INTEGER)}`).toMatch(CORRELATION_ID_PATTERN);
    }
    const longest = `a${'b'.repeat(46)}`;
    expect(SCHEDULED_JOB_ID.test(`repeat:${longest}:1`)).toBe(true);
    expect(SCHEDULED_JOB_ID.test(`repeat:${longest}b:1`)).toBe(false);
  });

  it('[R1-n2] isJobIdOf shares the step grammar of jobIdFor', () => {
    expect(isJobIdOf({ kind: 'saga', id: ID }, jobIdFor({ kind: 'saga', id: ID, step: 'book-carrier' }))).toBe(true);
    expect(isJobIdOf({ kind: 'saga', id: ID }, `saga.${ID}.Bad`)).toBe(false);
    expect(isJobIdOf({ kind: 'saga', id: ID }, `saga.${ID}.${'a'.repeat(41)}`)).toBe(false);
  });

  it('refuses a schedule declared on two queues at load time', () => {
    const one = { kinds: [], schedules: ['queue-retention'] as const, concurrency: 1 };
    expect(() => mergeQueues({ a: { x: one, y: one } })).toThrow('Schedule queue-retention is declared on both x and y');
  });
});
