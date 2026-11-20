// Unit tests of the outbox-purge schedule handler with fakes (ADR-0004 item 6; data-model §6.1, §10.5; D-ARCH-167,
// D-ARCH-171; D-SECPR039-01 conditions (i)-(ii); TASK-043). The 29-day / 31-day rows on PostgreSQL 18 are
// relay.int.test.ts (lane B).
import { createRuntimeLog, type TenantContext } from '@platform/api/runtime';
import { describe, expect, it } from '@jest/globals';
import { ANONYMOUS_ACTOR_ID, CORRELATION_ID_PATTERN } from '@platform/shared';

import type { JobExecutionLedger } from '../jobs/idempotent-processor.js';
import type { ProcessorJob } from '../queues/job-handler.js';
import { createOutboxPurge, PURGE_BATCH_SIZE, PURGE_MAX_BATCHES, PURGE_TABLES, rawJobExecutionLedger } from './purge.js';
import type { RawDb, SystemTxRunner } from './system-tx.js';

const OCCURRENCE = 'repeat:outbox-purge:1763600000000';

const job = (overrides: Partial<ProcessorJob> = {}): ProcessorJob => ({
  queue: 'housekeeping',
  id: OCCURRENCE,
  name: 'outbox-purge',
  attemptsMade: 0,
  correlationId: 'outbox-purge-1763600000000',
  signal: new AbortController().signal,
  ...overrides,
});

const quiet = createRuntimeLog('worker', { write: () => undefined }, { level: 'debug' });

/** Remaining purgeable rows per table; each DELETE removes min(remaining, LIMIT). Records SQL and contexts. */
function fakeDatabase(remaining: Record<string, number>) {
  const deletes: { readonly table: string; readonly sql: string; readonly limit: unknown }[] = [];
  const contexts: TenantContext[] = [];
  const runner: SystemTxRunner = {
    async withTenantTx(ctx, fn) {
      contexts.push(ctx);
      const db: RawDb = {
        $queryRaw: () => Promise.reject(new Error('no query expected')),
        $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join('$');
          const table = /DELETE FROM public\.(\w+)/.exec(sql)?.[1] ?? '?';
          const limit = Number(values[0]);
          const deleted = Math.min(remaining[table] ?? 0, limit);
          remaining[table] = (remaining[table] ?? 0) - deleted;
          deletes.push({ table, sql, limit: values[0] });
          return Promise.resolve(deleted);
        },
      };
      return fn(db);
    },
  };
  return { runner, deletes, contexts };
}

/** A ledger with unique keys; `committed` pre-seeds keys of an earlier delivery. */
function fakeLedger(committed: string[] = []): JobExecutionLedger<RawDb> & { readonly keys: string[] } {
  const keys = [...committed];
  return {
    keys,
    claim(_db, { jobKey, queue }) {
      expect(queue).toBe('housekeeping');
      if (keys.includes(jobKey)) return Promise.resolve(false);
      keys.push(jobKey);
      return Promise.resolve(true);
    },
  };
}

describe('[ADR-0004 item 6] outbox-purge (D-ARCH-167, D-ARCH-171)', () => {
  it('deletes past the 30-day horizon in batches of 5,000 per table, each batch claimed under the occurrence id', async () => {
    const db = fakeDatabase({ outbox_events: 12_000, processed_events: 10, job_executions: 0 });
    const ledger = fakeLedger();
    const purge = createOutboxPurge({ runner: db.runner, log: quiet, ledger });
    expect(await purge.run(job())).toEqual({ outbox_events: 12_000, processed_events: 10, job_executions: 0 });
    expect(db.deletes.map((d) => d.table)).toEqual([
      'outbox_events',
      'outbox_events',
      'outbox_events',
      'processed_events',
      'job_executions',
    ]);
    expect(db.deletes.every((d) => d.limit === PURGE_BATCH_SIZE)).toBe(true);
    expect(PURGE_BATCH_SIZE).toBe(5_000);
    expect(ledger.keys).toEqual([
      `${OCCURRENCE}.outbox_events.0`,
      `${OCCURRENCE}.outbox_events.1`,
      `${OCCURRENCE}.outbox_events.2`,
      `${OCCURRENCE}.processed_events.0`,
      `${OCCURRENCE}.job_executions.0`,
    ]);
    // SYSTEM scope with the occurrence's correlation id (D-SECPR039-01 (i): nothing comes from the job's data).
    expect(new Set(db.contexts.map((ctx) => `${ctx.actorScope}/${ctx.orgId}/${ctx.correlationId}`))).toEqual(
      new Set(['TENANT//outbox-purge-1763600000000']),
    );
    // D-ARCH-187 (F12): the purge context's correlation id is inside ADR-0016 §15.
    for (const ctx of db.contexts) expect(ctx.correlationId).toMatch(CORRELATION_ID_PATTERN);
  });

  it('D-SECPR039-01 (ii): the age predicate is part of each DELETE (published, processed, completed > 30 days)', async () => {
    const db = fakeDatabase({});
    await createOutboxPurge({ runner: db.runner, log: quiet, ledger: fakeLedger() }).run(job());
    const sql = Object.fromEntries(db.deletes.map((d) => [d.table, d.sql.replace(/\s+/g, ' ')]));
    expect(Object.keys(sql)).toEqual([...PURGE_TABLES]);
    expect(sql['outbox_events']).toContain("WHERE published_at < pg_catalog.now() - interval '30 days' ORDER BY published_at LIMIT $::int");
    expect(sql['processed_events']).toContain("WHERE processed_at < pg_catalog.now() - interval '30 days' ORDER BY processed_at");
    expect(sql['job_executions']).toContain("WHERE completed_at < pg_catalog.now() - interval '30 days' ORDER BY completed_at");
  });

  it('a redelivered occurrence skips the batches it committed and goes on from there', async () => {
    const db = fakeDatabase({ outbox_events: 3_000 });
    const ledger = fakeLedger([`${OCCURRENCE}.outbox_events.0`]);
    const result = await createOutboxPurge({ runner: db.runner, log: quiet, ledger }).run(job());
    expect(result.outbox_events).toBe(3_000);
    expect(ledger.keys).toContain(`${OCCURRENCE}.outbox_events.1`);
  });

  it('is bounded: at most PURGE_MAX_BATCHES per table per occurrence, then a warning', async () => {
    const raw: string[] = [];
    const log = createRuntimeLog('worker', { write: (line: string) => raw.push(line) }, { level: 'debug' });
    const db = fakeDatabase({ outbox_events: Number.MAX_SAFE_INTEGER });
    await createOutboxPurge({ runner: db.runner, log, ledger: fakeLedger() }).run(job());
    expect(db.deletes.filter((d) => d.table === 'outbox_events')).toHaveLength(PURGE_MAX_BATCHES);
    expect(raw.join('\n')).toContain('worker.outbox_purge_capped');
  });

  it('stops when the occurrence deadline passes (no further batch starts)', async () => {
    const controller = new AbortController();
    controller.abort();
    const db = fakeDatabase({ outbox_events: 1 });
    await expect(
      createOutboxPurge({ runner: db.runner, log: quiet, ledger: fakeLedger() }).handler(job({ signal: controller.signal })),
    ).rejects.toThrow();
    expect(db.deletes).toEqual([]);
  });

  it('the raw ledger claims (queue, job key) with ON CONFLICT DO NOTHING as the transaction actor; true only when it inserted', async () => {
    const calls: { sql: string; values: unknown[] }[] = [];
    let inserted = 1;
    const db: RawDb = {
      $queryRaw: () => Promise.reject(new Error('unused')),
      $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ sql: strings.join('$'), values });
        return Promise.resolve(inserted);
      },
    };
    const ledger = rawJobExecutionLedger();
    expect(await ledger.claim(db, { jobKey: `${OCCURRENCE}.outbox_events.0`, queue: 'housekeeping' })).toBe(true);
    inserted = 0;
    expect(await ledger.claim(db, { jobKey: `${OCCURRENCE}.outbox_events.0`, queue: 'housekeeping' })).toBe(false);
    expect(calls[0]?.sql).toContain('INSERT INTO public.job_executions');
    expect(calls[0]?.sql).toContain('ON CONFLICT (queue, job_key) DO NOTHING');
    expect(calls[0]?.sql).toContain('platform.app_actor_id()');
    expect(calls[0]?.values).toEqual([`${OCCURRENCE}.outbox_events.0`, 'housekeeping', ANONYMOUS_ACTOR_ID]);
  });
});
