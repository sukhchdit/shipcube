// Unit tests of the job platform pieces of TASK-039 with fakes: schedule registration (one upsert per schedule with
// the retention bounds in the template), the schedule dispatcher, the idempotent processor over a ledger
// (REQ-PLAT-014), and the producer refusal of AT-US-010-03 (D-PM-072 wording). The Valkey and PostgreSQL halves are
// consumer.int.test.ts, retention.int.test.ts and prisma/tests/worker/job-executions.int.test.ts.
import { createJobProducer, createRuntimeLog, JobProducerError } from '@platform/api/runtime';
import { describe, expect, it } from '@jest/globals';
import { COMPLETED_RETENTION, FAILED_RETENTION, JOB_ATTEMPTS, type QueueName } from '@platform/shared/queues';

import { NonRetryableError } from '../queues/errors.js';
import type { ProcessorJob } from '../queues/job-handler.js';
import { createJobExecutionLedger, idempotentProcessor, type JobExecutionRow } from './idempotent-processor.js';
import { createScheduleProcessor, registerSchedules, SCHEDULE_EVERY_MS, type ScheduleTemplate } from './schedulers.js';

const quiet = createRuntimeLog('worker', { write: () => undefined }, { level: 'debug' });

const job = (overrides: Partial<ProcessorJob> = {}): ProcessorJob => ({
  queue: 'outbox-relay',
  id: 'outbox_event.0193a5b2-7c1e-7d4a-9f3b-000000000f01',
  name: 'outbox_event',
  attemptsMade: 0,
  correlationId: 'demo-booking-0001',
  signal: new AbortController().signal,
  ...overrides,
});

describe('Job Schedulers (ADR-0013 §5, REQ-PLAT-015; D-TASK039-01)', () => {
  it('upserts each schedule on its queue under its own name, hourly, with retries and both retention bounds in the template', async () => {
    const upserts: [QueueName, string, { every: number }, ScheduleTemplate][] = [];
    const names = await registerSchedules((queue) => ({
      upsertJobScheduler: (id, repeat, template) => {
        upserts.push([queue, id, repeat, template]);
        return Promise.resolve();
      },
    }));
    expect(names).toEqual(['queue-retention']);
    expect(SCHEDULE_EVERY_MS['queue-retention']).toBe(3_600_000);
    expect(upserts).toEqual([
      [
        'housekeeping',
        'queue-retention',
        { every: 3_600_000 },
        {
          name: 'queue-retention',
          data: { v: 2, schedule: 'queue-retention' },
          opts: expect.objectContaining({
            attempts: JOB_ATTEMPTS,
            removeOnComplete: COMPLETED_RETENTION,
            removeOnFail: FAILED_RETENTION,
            stackTraceLimit: 0,
          }),
        },
      ],
    ]);
  });

  it('dispatches an occurrence to its handler; anything else is non-retryable', async () => {
    const ran: string[] = [];
    const processor = createScheduleProcessor({ 'queue-retention': (occurrence) => Promise.resolve(void ran.push(occurrence.id)) });
    await processor({ v: 2, schedule: 'queue-retention' }, job({ id: 'repeat:queue-retention:1', queue: 'housekeeping' }));
    expect(ran).toEqual(['repeat:queue-retention:1']);
    const aggregate = { v: 2, kind: 'outbox_event', id: 'x', correlation_id: 'demo-booking-0001', trace_context: null } as const;
    await expect(processor(aggregate, job())).rejects.toMatchObject({ reason: 'PAYLOAD_INVALID' });
    await expect(createScheduleProcessor({})({ v: 2, schedule: 'queue-retention' }, job())).rejects.toMatchObject({
      reason: 'NO_PROCESSOR',
    });
  });
});

/** An in-memory ledger with the unique-key semantics of `ux_job_executions__job_key`, inside fake transactions. */
function fakeDatabase() {
  const committed: JobExecutionRow[] = [];
  const effects: string[] = [];
  type Tx = { readonly rows: JobExecutionRow[]; readonly effects: string[] };
  const ledger = createJobExecutionLedger<Tx>((tx) => ({
    createMany: ({ data, skipDuplicates }) => {
      expect(skipDuplicates).toBe(true);
      // ux_job_executions__queue_job_key: unique per (queue, job_key).
      const fresh = data.filter(
        (row) => ![...committed, ...tx.rows].some((existing) => existing.jobKey === row.jobKey && existing.queue === row.queue),
      );
      tx.rows.push(...fresh);
      return Promise.resolve({ count: fresh.length });
    },
  }));
  const transaction = async <R>(_job: ProcessorJob, fn: (tx: Tx) => Promise<R>): Promise<R> => {
    const tx: Tx = { rows: [], effects: [] };
    const result = await fn(tx);
    committed.push(...tx.rows);
    effects.push(...tx.effects);
    return result;
  };
  return { committed, effects, ledger, transaction };
}

describe('[REQ-PLAT-014] idempotent job effects (job_executions)', () => {
  it('a duplicate delivery of a completed job returns without a second effect, and logs the skip', async () => {
    const db = fakeDatabase();
    const raw: string[] = [];
    const log = createRuntimeLog('worker', { write: (line: string) => raw.push(line) }, { level: 'debug' });
    const processor = idempotentProcessor({ ...db, log }, (_payload, delivered, tx) => Promise.resolve(void tx.effects.push(delivered.id)));
    const payload = { v: 2, schedule: 'queue-retention' } as const;
    await processor(payload, job());
    await processor(payload, job({ attemptsMade: 1 }));
    expect(db.effects).toEqual([job().id]);
    expect(db.committed).toEqual([{ jobKey: job().id, queue: 'outbox-relay', status: 'completed' }]);
    expect(raw.join('')).toContain('worker.job_duplicate_skipped');
  });

  it('an effect that throws rolls the claim back with it, so the retry runs the effect', async () => {
    const db = fakeDatabase();
    let fail = true;
    const processor = idempotentProcessor({ ...db, log: quiet }, (_payload, delivered, tx) => {
      if (fail) return Promise.reject(new Error('carrier timeout'));
      tx.effects.push(delivered.id);
      return Promise.resolve();
    });
    const payload = { v: 2, schedule: 'queue-retention' } as const;
    await expect(processor(payload, job())).rejects.toThrow('carrier timeout');
    expect(db.committed).toEqual([]);
    fail = false;
    await processor(payload, job({ attemptsMade: 1 }));
    expect(db.effects).toEqual([job().id]);
  });

  it('[R1-m1][PR039-SEC-02] the same job id on two queues is two jobs: both effects run', async () => {
    const db = fakeDatabase();
    const processor = idempotentProcessor({ ...db, log: quiet }, (_payload, delivered, tx) =>
      Promise.resolve(void tx.effects.push(`${delivered.queue}/${delivered.id}`)),
    );
    const id = 'shipment.0193a5b2-7c1e-7d4a-9f3b-000000000f01';
    await processor({ v: 2, schedule: 'queue-retention' }, job({ queue: 'documents', id }));
    await processor({ v: 2, schedule: 'queue-retention' }, job({ queue: 'tracking-poll', id }));
    expect(db.effects).toEqual([`documents/${id}`, `tracking-poll/${id}`]);
  });

  it('[PR039-SEC-03] an attempt whose deadline passed during the effect rolls back instead of committing behind its failure', async () => {
    const db = fakeDatabase();
    const controller = new AbortController();
    const processor = idempotentProcessor({ ...db, log: quiet }, (_payload, delivered, tx) => {
      tx.effects.push(delivered.id);
      controller.abort(new Error('deadline'));
      return Promise.resolve();
    });
    await expect(processor({ v: 2, schedule: 'queue-retention' }, job({ signal: controller.signal }))).rejects.toThrow('deadline');
    expect(db.committed).toEqual([]);
    expect(db.effects).toEqual([]);
  });

  it('refuses a job without a usable key (no id, or longer than the column allows)', async () => {
    const processor = idempotentProcessor({ ...fakeDatabase(), log: quiet }, () => Promise.resolve());
    for (const id of ['', 'x'.repeat(201)])
      await expect(processor({ v: 2, schedule: 'queue-retention' }, job({ id }))).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe('US-010 producer refusal (D-PM-072 wording)', () => {
  it('[AT-US-010-03] a job payload missing correlation_id is refused by the producer and nothing is enqueued', async () => {
    const added: unknown[] = [];
    const producer = createJobProducer({
      queueFor: () => ({ add: (...args: unknown[]) => Promise.resolve(void added.push(args)) }) as never,
      contextCorrelationId: () => undefined,
    });
    await expect(
      producer.enqueue('outbox-relay', { kind: 'outbox_event', id: '0193a5b2-7c1e-7d4a-9f3b-000000000f01' }),
    ).rejects.toBeInstanceOf(JobProducerError);
    expect(added).toEqual([]);
  });
});
