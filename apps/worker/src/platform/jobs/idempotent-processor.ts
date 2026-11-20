/**
 * Idempotent job effects (ADR-0013 §4; REQ-PLAT-014, NFR-RES-004, NFR-SCALE-002; US-010; TASK-039).
 *
 * BullMQ delivers at least once: a worker killed after its effect committed but before BullMQ marked the job
 * completed has the job re-delivered (stalled-job detection), and an operator may retry a job. `idempotentProcessor`
 * makes a second delivery of the same job a no-op: inside the effect's own database transaction it first claims the
 * `(queue, job id)` in `job_executions` (Prisma `createMany` with `skipDuplicates`, a target-less
 * `INSERT … ON CONFLICT DO NOTHING` that meets `ux_job_executions__queue_job_key`), and runs the effect only when the
 * claim inserted the row. The key is unique per queue: BullMQ scopes job ids per queue, and one payload kind can be a
 * job of two queues (data-model §3.5, D-ARCH-171; code review R1-m1, PR039-SEC-02).
 *
 * - The claim and the effect commit together or not at all: an effect that throws rolls the claim back, so the retry
 *   runs the effect again.
 * - An attempt whose deadline passed rolls back even when its effect finished (`signal.throwIfAborted()` before commit).
 * - Two concurrent deliveries of one key: the second INSERT waits on the unique index until the first transaction ends;
 *   after a commit it inserts nothing (skipped), after a rollback it claims and runs.
 * - The job key is the BullMQ job id: `<kind>.<id>[.<step>]` (checked against the payload at dequeue, PR64-SEC-07) or
 *   `repeat:<schedule>:<millis>` for a scheduled occurrence. A job without an id is refused (no key, no idempotency).
 *
 * The transaction is the caller's: until TASK-047 (tenant context from `platform.job_context`) a processor opens it
 * SYSTEM-scope; TASK-047 opens the tenant transaction with the resolved organisation and hands it in. The production
 * ledger reaches `job_executions` (SYSTEM class, module `worker`) through the worker's SYSTEM accessor, which is bound
 * by the composition root when the worker gets its first tenant transaction (TASK-047) and throws until then (fail
 * closed); no processor registered on main uses it before that.
 */
import type { JobPayload, QueueName } from '@platform/shared/queues';

import type { RuntimeLog } from '@platform/api/runtime';

import { systemDelegates } from '../db/system-db.js';
import { NonRetryableError } from '../queues/errors.js';
import type { JobProcessor, ProcessorJob } from '../queues/job-handler.js';

/** The `job_executions` row a claim inserts (data-model §3.5, D-ARCH-171). */
export interface JobExecutionRow {
  readonly jobKey: string;
  readonly queue: QueueName;
  readonly status: 'completed';
}

/** The Prisma `jobExecution` delegate surface the ledger uses. */
export interface JobExecutionDelegate {
  createMany(args: { data: JobExecutionRow[]; skipDuplicates: true }): PromiseLike<{ count: number }>;
}

/** Claims a job key inside the caller's transaction. */
export interface JobExecutionLedger<TTx> {
  /** True when this transaction inserted the key (run the effect); false when a committed execution has it. */
  claim(tx: TTx, execution: { readonly jobKey: string; readonly queue: QueueName }): Promise<boolean>;
}

/** Upper bound of a job key (the `ck_job_executions__job_key` CHECK): the longest BullMQ id this platform produces. */
export const MAX_JOB_KEY_LENGTH = 200;

export function createJobExecutionLedger<TTx>(delegateOf: (tx: TTx) => JobExecutionDelegate): JobExecutionLedger<TTx> {
  return {
    async claim(tx, { jobKey, queue }) {
      const { count } = await delegateOf(tx).createMany({ data: [{ jobKey, queue, status: 'completed' }], skipDuplicates: true });
      return count === 1;
    },
  };
}

/** The production ledger: `job_executions` through the worker SYSTEM accessor (bound by TASK-047; fails closed). */
export function systemJobExecutionLedger(): JobExecutionLedger<object> {
  return createJobExecutionLedger((tx: object) => (systemDelegates(tx) as { readonly jobExecution: JobExecutionDelegate }).jobExecution);
}

/** Runs `fn` in one database transaction for this job (SYSTEM-scope until TASK-047). */
export type JobTransaction<TTx> = <R>(job: ProcessorJob, fn: (tx: TTx) => Promise<R>) => Promise<R>;

/** The effect of a job, run at most once per job key; it writes only through `tx`. */
export type JobEffect<TTx> = (payload: JobPayload, job: ProcessorJob, tx: TTx) => Promise<void>;

export interface IdempotentProcessorOptions<TTx> {
  readonly transaction: JobTransaction<TTx>;
  readonly ledger: JobExecutionLedger<TTx>;
  readonly log: RuntimeLog;
}

/** Wraps an effect so a duplicate delivery of a completed job returns without a second effect (REQ-PLAT-014). */
export function idempotentProcessor<TTx>(options: IdempotentProcessorOptions<TTx>, effect: JobEffect<TTx>): JobProcessor {
  const { transaction, ledger, log } = options;
  return async (payload, job) => {
    if (job.id === '' || job.id.length > MAX_JOB_KEY_LENGTH) throw new NonRetryableError('PAYLOAD_INVALID', 'job without a usable job key');
    const ran = await transaction(job, async (tx) => {
      if (!(await ledger.claim(tx, { jobKey: job.id, queue: job.queue }))) return false;
      await effect(payload, job, tx);
      // PR039-SEC-03 (D-TASK039-09): an attempt whose deadline passed has already been failed (and maybe dead-lettered)
      // by the handler; throwing here, inside the transaction, rolls the claim and the effect back instead of committing
      // them behind the failure. The retry then claims the key and runs the effect.
      job.signal.throwIfAborted();
      return true;
    });
    if (!ran) log.info('worker.job_duplicate_skipped', { queue: job.queue, jobId: job.id, attempt: job.attemptsMade + 1 });
  };
}
