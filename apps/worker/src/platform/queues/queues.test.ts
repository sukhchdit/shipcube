// Unit tests of the worker queue platform pieces that need no Valkey (TASK-035): non-retryable errors, dead-letter
// records, the metrics rendering and the BullMQ connection options. consumer.int.test.ts runs them against Valkey.
import { describe, expect, it } from '@jest/globals';
import { REDACTED } from '@platform/shared/logging';
import { UnrecoverableError } from 'bullmq';

import { queueConnectionOptions } from './connection.js';
import { deadLetterJobId, deadLetterRecord, MAX_FAILURE_MESSAGE, RETRIES_EXHAUSTED } from './dead-letter.js';
import { isNonRetryable, isUnrecoverable, NON_RETRYABLE_REASONS, NonRetryableError, nonRetryableReason } from './errors.js';
import { collectQueueMetrics, type CountableQueue, QUEUE_STATES, renderQueueMetrics } from './metrics.js';

const job = (data: unknown) => ({ queueName: 'outbox-relay', id: 'outbox_event.x', name: 'outbox_event', data });
const NOW = new Date('2026-11-17T10:00:00.000Z');

describe('non-retryable errors (ADR-0013 §2, DR-A25, EC-A38)', () => {
  it('are BullMQ UnrecoverableErrors (retries skipped) that carry their reason', () => {
    const error = new NonRetryableError('MISSING_TENANT_CONTEXT');
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(error.name).toBe('UnrecoverableError');
    expect([error.reason, error.message]).toEqual(['MISSING_TENANT_CONTEXT', 'MISSING_TENANT_CONTEXT']);
    expect(isNonRetryable(error)).toBe(true);
    expect(isNonRetryable(new UnrecoverableError('x'))).toBe(false);
    expect(isNonRetryable(new Error('x'))).toBe(false);
    expect(NON_RETRYABLE_REASONS).toEqual(
      expect.arrayContaining([
        'PAYLOAD_INVALID',
        'MISSING_TENANT_CONTEXT',
        'JOB_CONTEXT_NOT_FOUND',
        'VALIDATION_ERROR',
        'PERMISSION_DENIED',
        'UNRECOVERABLE',
      ]),
    );
  });

  it('[R1-m2] mirror BullMQ: an UnrecoverableError, or any error named so, is final with the reason UNRECOVERABLE', () => {
    const named = Object.assign(new Error('x'), { name: 'UnrecoverableError' });
    for (const error of [new UnrecoverableError('x'), named]) {
      expect([isUnrecoverable(error), nonRetryableReason(error)]).toEqual([true, 'UNRECOVERABLE']);
    }
    expect(nonRetryableReason(new NonRetryableError('PERMISSION_DENIED'))).toBe('PERMISSION_DENIED');
    for (const transient of [new Error('x'), 'text', null, undefined, { name: 'Other' }]) {
      expect([isUnrecoverable(transient), nonRetryableReason(transient)]).toEqual([false, undefined]);
    }
    expect(isUnrecoverable({ name: 'UnrecoverableError' })).toBe(true);
  });
});

describe('dead-letter records (REQ-PLAT-013; AT-US-009-02, AT-US-009-04)', () => {
  it('[AT-US-009-04] redact the job data: a "token" field shows [REDACTED]; the failure message passes the string redactor', () => {
    const data = { v: 2, kind: 'outbox_event', token: 'tok_live_secret_value', nested: { password: 'p4ss', ref: 'ok' } };
    const record = deadLetterRecord(job(data), new Error('upstream refused Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig'), 5, NOW);
    expect(record).toMatchObject({
      v: 1,
      queue: 'outbox-relay',
      job_id: 'outbox_event.x',
      job_name: 'outbox_event',
      reason: RETRIES_EXHAUSTED,
      error: 'Error',
      attempts: 5,
      failed_at: '2026-11-17T10:00:00.000Z',
      data: { v: 2, kind: 'outbox_event', token: REDACTED, nested: { password: REDACTED, ref: 'ok' } },
    });
    expect(JSON.stringify(record)).not.toMatch(/tok_live_secret_value|p4ss|eyJhbGciOiJIUzI1NiJ9/);
  });

  it('[AT-US-009-02] carry the non-retryable reason, the attempt count and a bounded message; a non-Error failure is named by type', () => {
    expect(deadLetterRecord(job({}), new NonRetryableError('PAYLOAD_INVALID', 'kind: any.only'), 1, NOW)).toMatchObject({
      reason: 'PAYLOAD_INVALID',
      error: 'NonRetryableError',
      message: 'kind: any.only',
      attempts: 1,
    });
    const long = deadLetterRecord(job({}), new Error('x'.repeat(5_000)), 5, NOW);
    expect(long.message.length).toBeLessThanOrEqual(MAX_FAILURE_MESSAGE);
    expect(deadLetterRecord({ ...job({}), id: undefined }, 'plain string failure', 3, NOW)).toMatchObject({
      job_id: '',
      error: 'string',
      message: 'plain string failure',
    });
    expect(deadLetterRecord(job({}), new Error('x'), 1).failed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('[R1-m2] a plain UnrecoverableError is recorded with the reason UNRECOVERABLE and its own class', () => {
    expect(deadLetterRecord(job({}), new UnrecoverableError('stop'), 2, NOW)).toMatchObject({
      reason: 'UNRECOVERABLE',
      error: 'UnrecoverableError',
      attempts: 2,
    });
  });

  it('[R1-M1] the record id is namespaced and never an integer, which BullMQ refuses as a custom id', () => {
    expect(deadLetterJobId('outbox_event.0193a5b2-7c1e-7d4a-9f3b-000000000f01', 5)).toBe(
      'outbox_event.0193a5b2-7c1e-7d4a-9f3b-000000000f01.dead.5',
    );
    // An auto-increment id ("7") would be refused as an integer; a ":" id keeps its part count (3 parts allowed).
    expect(deadLetterJobId('7', 1)).toBe('7.dead.1');
    expect(deadLetterJobId('a:b:c', 3)).toBe('a:b:c.dead.3');
    expect(Number.isInteger(Number(deadLetterJobId('7', 1)))).toBe(false);
    // Deterministic per final attempt (a re-delivered attempt is one record); a later final attempt has its own.
    expect(deadLetterJobId('7', 5)).toBe(deadLetterJobId('7', 5));
    expect(deadLetterJobId('7', 6)).not.toBe(deadLetterJobId('7', 5));
    expect([deadLetterJobId(undefined, 1), deadLetterJobId('', 1)]).toEqual([undefined, undefined]);
  });
});

describe('queue metrics (ADR-0013 §8; AT-US-009-05)', () => {
  const counts = (values: Record<string, number>): CountableQueue => ({ getJobCounts: () => Promise.resolve(values) });

  it('[AT-US-009-05] collects the job counts by state and the dead-letter depth per named queue, rendered as Prometheus gauges', async () => {
    const metrics = await collectQueueMetrics([
      {
        queue: 'booking',
        jobs: counts({ waiting: 3, active: 1, failed: 2, delayed: 4 }),
        deadLetter: counts({ waiting: 2, completed: 1 }),
      },
      { queue: 'payments', jobs: counts({}), deadLetter: counts({ waiting: Number.NaN, active: -1 }) },
    ]);
    expect(metrics).toEqual([
      { queue: 'booking', counts: { waiting: 3, active: 1, delayed: 4, prioritized: 0, completed: 0, failed: 2 }, deadLetter: 3 },
      { queue: 'payments', counts: { waiting: 0, active: 0, delayed: 0, prioritized: 0, completed: 0, failed: 0 }, deadLetter: 0 },
    ]);
    const text = renderQueueMetrics(metrics);
    expect(text).toContain('# TYPE platform_queue_jobs gauge\n');
    expect(text).toContain('platform_queue_jobs{queue="booking",state="waiting"} 3\n');
    expect(text).toContain('platform_queue_jobs{queue="booking",state="failed"} 2\n');
    expect(text).toContain('# TYPE platform_queue_dead_letter_jobs gauge\n');
    expect(text).toContain('platform_queue_dead_letter_jobs{queue="booking"} 3\n');
    expect(text).toContain('platform_queue_dead_letter_jobs{queue="payments"} 0\n');
    expect(text.split('\n').filter((line) => line.startsWith('platform_queue_jobs{'))).toHaveLength(2 * QUEUE_STATES.length);
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('BullMQ connection options (ADR-0013; ADR-0010 am. 7)', () => {
  it('[PR64-SEC-03] the worker profile (Workers only) has no retry cap and no command timeout: blocking commands', () => {
    const options = queueConnectionOptions('redis://worker:pw@valkey.internal:6380/2', 'worker-consumers', 'worker') as Record<
      string,
      unknown
    >;
    expect(options).toMatchObject({ host: 'valkey.internal', port: 6380, db: 2, username: 'worker', connectionName: 'worker-consumers' });
    expect(options['maxRetriesPerRequest']).toBeNull();
    expect('commandTimeout' in options).toBe(false);
    expect(() => queueConnectionOptions('http://valkey.internal', 'worker-queues', 'worker')).toThrow(
      'REDIS_URL must use redis:// or rediss://',
    );
  });

  it('[PR64-SEC-03, R1-m4] the queue profile (every non-blocking Queue) is fail-fast: command timeout, one retry, no offline queue', () => {
    const options = queueConnectionOptions('redis://worker:pw@valkey.internal:6380/2', 'worker-queues', 'queue') as Record<string, unknown>;
    expect(options).toMatchObject({
      host: 'valkey.internal',
      username: 'worker',
      connectionName: 'worker-queues',
      commandTimeout: 2_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    expect(() => queueConnectionOptions('http://valkey.internal', 'worker-queues', 'queue')).toThrow(
      'REDIS_URL must use redis:// or rediss://',
    );
  });
});
