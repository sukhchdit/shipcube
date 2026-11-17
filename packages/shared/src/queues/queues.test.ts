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

  it('builds deterministic job ids from the business key, without ":"', () => {
    expect(jobIdFor({ kind: 'outbox_event', id: ID })).toBe(`outbox_event.${ID}`);
    expect(jobIdFor({ kind: 'saga', id: ID, step: 'book-carrier' })).toBe(`saga.${ID}.book-carrier`);
    expect(JOB_ID_PATTERN.test(jobIdFor({ kind: 'saga', id: ID, step: 'book-carrier' }))).toBe(true);
    expect(() => jobIdFor({ kind: 'saga', id: ID.toUpperCase() })).toThrow('job id must be a lower-case UUID');
    expect(() => jobIdFor({ kind: 'saga', id: ID, step: 'a:b' })).toThrow('job step must be');
  });
});
