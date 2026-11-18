import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import {
  BACKOFF_BASE_MS,
  BACKOFF_JITTER,
  BACKOFF_TYPE,
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
    const helpers = new Set(['index.ts', 'queue-definition.ts', 'job-options.ts', 'payload-v2.ts']);
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
  it('5 attempts, the custom jittered exponential backoff from 2 s, completed jobs kept 24 h, failed jobs kept', () => {
    expect(jobOptions('outbox_event.x')).toEqual({
      jobId: 'outbox_event.x',
      attempts: JOB_ATTEMPTS,
      backoff: { type: BACKOFF_TYPE, delay: BACKOFF_BASE_MS },
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: false,
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
