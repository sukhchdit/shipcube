/**
 * The daily `outbox-purge` housekeeping job (ADR-0004 item 6; data-model §3.5, §6.1, §10.5 as corrected by D-ARCH-167;
 * D-ARCH-171; owner by D-SD-003, rulings/wave-1-r-arch-34-operator-rulings.md §7 item 1; TASK-043). It deletes, in
 * batches of 5,000 rows:
 *  - `outbox_events` published more than 30 days ago (a pending event is never purged);
 *  - `processed_events` processed more than 30 days ago;
 *  - `job_executions` completed more than 30 days ago.
 *
 * The schedule conditions of D-SECPR039-01:
 *  (i) every parameter is a code constant (tables, horizon, batch size, batch cap); nothing is read from the job;
 *  (ii) the age predicate is in each DELETE's own SQL (`< pg_catalog.now() - interval '30 days'`), so an early,
 *      repeated or forged occurrence can delete only what the policy allows at that moment; and since it writes, each
 *      batch runs through `idempotentProcessor` keyed by the occurrence id (`repeat:outbox-purge:<millis>`) plus the
 *      table and batch number, in its own short SYSTEM transaction (a 5,000-row DELETE fits the transaction timeout,
 *      the whole purge may not). A redelivered occurrence skips the batches it already committed;
 *  (iii) the name is in the closed SCHEDULE_NAMES list (12 characters);
 *  (iv) it runs only as an occurrence of its Job Scheduler.
 *
 * The ledger claim is a bound `INSERT … ON CONFLICT DO NOTHING` into `job_executions` on the batch's transaction
 * (`rawJobExecutionLedger`): the worker SYSTEM accessor that `systemJobExecutionLedger` uses is bound only by TASK-047
 * (D-TASK043-05). This file lives under apps/worker/src/platform/outbox/**, which owns `outbox_events` (module outbox)
 * and `processed_events` / `job_executions` (module worker) for `platform/system-model-owner`.
 */
import type { RuntimeLog } from '@platform/api/runtime';
import { ANONYMOUS_ACTOR_ID } from '@platform/shared';
import { scheduledPayload } from '@platform/shared/queues';

import { idempotentProcessor, type JobExecutionLedger } from '../jobs/idempotent-processor.js';
import type { ScheduleHandler } from '../jobs/schedulers.js';
import type { ProcessorJob } from '../queues/job-handler.js';
import { type RawDb, systemContext, type SystemTxRunner } from './system-tx.js';

/** Rows one DELETE removes at most (data-model §6.1). */
export const PURGE_BATCH_SIZE = 5_000;
/** Batches per table per occurrence (1,000,000 rows): a bound, so one occurrence can never loop forever. */
export const PURGE_MAX_BATCHES = 200;
/** The purged tables, in purge order. */
export const PURGE_TABLES = ['outbox_events', 'processed_events', 'job_executions'] as const;
export type PurgeTable = (typeof PURGE_TABLES)[number];

/** One DELETE of at most PURGE_BATCH_SIZE rows past the 30-day horizon; the predicate is part of the statement. */
async function deleteBatch(db: RawDb, table: PurgeTable): Promise<number> {
  switch (table) {
    case 'outbox_events':
      return db.$executeRaw`
        DELETE FROM public.outbox_events
         WHERE id IN (SELECT id FROM public.outbox_events
                       WHERE published_at < pg_catalog.now() - interval '30 days'
                       ORDER BY published_at LIMIT ${PURGE_BATCH_SIZE}::int)`;
    case 'processed_events':
      return db.$executeRaw`
        DELETE FROM public.processed_events
         WHERE id IN (SELECT id FROM public.processed_events
                       WHERE processed_at < pg_catalog.now() - interval '30 days'
                       ORDER BY processed_at LIMIT ${PURGE_BATCH_SIZE}::int)`;
    case 'job_executions':
      return db.$executeRaw`
        DELETE FROM public.job_executions
         WHERE id IN (SELECT id FROM public.job_executions
                       WHERE completed_at < pg_catalog.now() - interval '30 days'
                       ORDER BY completed_at LIMIT ${PURGE_BATCH_SIZE}::int)`;
  }
}

/**
 * The `job_executions` claim as a bound statement on the caller's transaction: true when it inserted the key. The
 * creator columns are the transaction's actor, as the standard-columns guard requires.
 */
export function rawJobExecutionLedger(): JobExecutionLedger<RawDb> {
  return {
    async claim(db, { jobKey, queue }) {
      const inserted = await db.$executeRaw`
        INSERT INTO public.job_executions (job_key, queue, status, created_by, updated_by)
        SELECT ${jobKey}::text, ${queue}::text, 'completed', ctx.actor, ctx.actor
          FROM (SELECT COALESCE(platform.app_actor_id(), ${ANONYMOUS_ACTOR_ID}::uuid) AS actor) AS ctx
        ON CONFLICT (queue, job_key) DO NOTHING`;
      return inserted === 1;
    },
  };
}

export interface OutboxPurgeOptions {
  readonly runner: SystemTxRunner;
  readonly log: RuntimeLog;
  /** Test seam: the ledger (default `rawJobExecutionLedger`). */
  readonly ledger?: JobExecutionLedger<RawDb>;
}

/** Rows deleted per table by one occurrence. */
export type PurgeResult = Readonly<Record<PurgeTable, number>>;

/** The `outbox-purge` schedule handler; `run` also returns the counts (tests). */
export function createOutboxPurge(options: OutboxPurgeOptions): { readonly handler: ScheduleHandler; run(job: ProcessorJob): Promise<PurgeResult> } {
  const { runner, log } = options;
  const ledger = options.ledger ?? rawJobExecutionLedger();
  const payload = scheduledPayload('outbox-purge');
  const run = async (job: ProcessorJob): Promise<PurgeResult> => {
    const result: Record<PurgeTable, number> = { outbox_events: 0, processed_events: 0, job_executions: 0 };
    for (const table of PURGE_TABLES) {
      for (let batch = 0; batch < PURGE_MAX_BATCHES; batch += 1) {
        job.signal.throwIfAborted();
        // A batch already committed by an earlier delivery is skipped; it counts as full, so the purge goes on.
        let deleted: number = PURGE_BATCH_SIZE;
        const step = idempotentProcessor<RawDb>(
          {
            transaction: (current, fn) => runner.withTenantTx(systemContext(current.correlationId), fn),
            ledger,
            log,
          },
          async (_payload, _job, db) => {
            deleted = await deleteBatch(db, table);
            result[table] += deleted;
          },
        );
        await step(payload, { ...job, id: `${job.id}.${table}.${String(batch)}` });
        if (deleted < PURGE_BATCH_SIZE) break;
        if (batch === PURGE_MAX_BATCHES - 1) log.warn('worker.outbox_purge_capped', { table, batches: PURGE_MAX_BATCHES });
      }
    }
    log.info('worker.outbox_purge_done', { ...result });
    return result;
  };
  return {
    run,
    handler: async (job) => {
      await run(job);
    },
  };
}
