/**
 * Test helpers of the idempotency store (TASK-040). Never imported by production code.
 *
 * `MemoryKeys` is an in-memory `idempotency_keys` table behind a Prisma-shaped `idempotencyKey` delegate that supports
 * exactly the statements the store issues (`createManyAndReturn` with `skipDuplicates`, `findUnique` by scope hash,
 * `updateMany` / `updateManyAndReturn` / `deleteMany` with the store's conditions), with per-transaction undo: a
 * rolled-back transaction leaves nothing. `memoryRunner` is a `TenantTxRunner` that hands each transaction the REAL
 * `TenantDb` guard (`createTenantDb`), so the store reaches the delegate through the real `systemDelegates(tx)` port.
 * The real statements on PostgreSQL 18 are prisma/tests/idempotency/idempotency-keys.int.test.ts.
 */
import { randomUUID } from 'node:crypto';

import { createTenantDb } from '../../db/tenant-db.js';
import type { TenantContext, TenantTxCallOptions, TenantTxRunner } from '../../db/with-tenant-tx.js';
import type { IdempotencyLog, IdempotencyLogFields } from '../store.js';

export interface KeyRow {
  id: string;
  version: number;
  scopeHash: Uint8Array;
  scopeOrgId: string | null;
  actorId: string | null;
  method: string;
  path: string;
  idemKey: string;
  fingerprint: Uint8Array;
  status: string;
  leaseUntil: Date;
  responseStatus: number | null;
  responseHeaders: unknown;
  responseBody: Uint8Array | null;
  responseBodyKeyId: string | null;
  expiresAt: Date;
}

type Where = Readonly<Record<string, unknown>>;
type Select = Readonly<Record<string, boolean>> | undefined;

const sameBytes = (a: unknown, b: unknown): boolean =>
  a instanceof Uint8Array && b instanceof Uint8Array && Buffer.from(a).equals(Buffer.from(b));

function matches(row: KeyRow, where: Where): boolean {
  return Object.entries(where).every(([field, condition]) => {
    const value = (row as unknown as Record<string, unknown>)[field];
    if (condition instanceof Uint8Array) return sameBytes(value, condition);
    if (typeof condition === 'object' && condition !== null && 'lte' in condition) {
      return value instanceof Date && value.getTime() <= (condition as { lte: Date }).lte.getTime();
    }
    return value === condition;
  });
}

const pick = (row: KeyRow, select: Select): Record<string, unknown> => {
  const copy = { ...row } as unknown as Record<string, unknown>;
  if (select === undefined) return copy;
  return Object.fromEntries(Object.keys(select).map((field) => [field, copy[field]]));
};

/**
 * The row CHECKs the store's writes can reach (migrations 20261120100000 and 20261121000000): a COMPLETED row has its
 * status and its sealed response with the key id, an IN_PROGRESS row has neither. A violation throws like PostgreSQL.
 */
function checkRow(row: KeyRow): void {
  const completed = row.status === 'COMPLETED';
  if (completed !== (row.responseStatus !== null)) throw new Error('check violation: ck_idempotency_keys__completed');
  if (completed !== (row.responseBody !== null)) throw new Error('check violation: ck_idempotency_keys__completed_body');
  if ((row.responseBody === null) !== (row.responseBodyKeyId === null)) throw new Error('check violation: ck_idempotency_keys__body_key');
}

/** The operations a test can make fail (inside the transaction that issues them). */
export type KeyOperation = 'createManyAndReturn' | 'findUnique' | 'updateMany' | 'updateManyAndReturn' | 'deleteMany';

export class MemoryKeys {
  readonly rows = new Map<string, KeyRow>();
  /** Every statement issued, in order (operation names). */
  readonly statements: KeyOperation[] = [];
  /** When set, the next statement of this kind throws (once). */
  failNext: KeyOperation | undefined;
  /**
   * Claims answered as conflicts although no row exists (a row that another request released or let expire between
   * this request's insert and its read), counted down per claim.
   */
  phantomConflicts = 0;

  /** The `idempotencyKey` delegate of one transaction; `undo` restores what it changed. */
  delegate(undo: Array<() => void>) {
    const issue = (operation: KeyOperation): void => {
      this.statements.push(operation);
      if (this.failNext === operation) {
        this.failNext = undefined;
        throw new Error(`injected ${operation} failure`);
      }
    };
    const remember = (id: string): void => {
      const before = this.rows.get(id);
      const saved = before === undefined ? undefined : { ...before };
      undo.push(() => {
        if (saved === undefined) this.rows.delete(id);
        else this.rows.set(id, saved);
      });
    };
    const update = (where: Where, data: Readonly<Record<string, unknown>>): KeyRow[] => {
      const hit = [...this.rows.values()].filter((row) => matches(row, where));
      for (const row of hit) {
        remember(row.id);
        Object.assign(row, data, { version: row.version + 1 });
        checkRow(row);
      }
      return hit;
    };
    return {
      createManyAndReturn: async (args: {
        data: (Partial<KeyRow> & Pick<KeyRow, 'scopeHash'>)[];
        skipDuplicates: boolean;
        select?: Select;
      }) => {
        await Promise.resolve();
        issue('createManyAndReturn');
        if (this.phantomConflicts > 0) {
          this.phantomConflicts -= 1;
          return [];
        }
        const created: Record<string, unknown>[] = [];
        for (const data of args.data) {
          if ([...this.rows.values()].some((row) => sameBytes(row.scopeHash, data.scopeHash))) {
            if (args.skipDuplicates) continue;
            throw new Error('unique violation');
          }
          const row = {
            responseStatus: null,
            responseHeaders: null,
            responseBody: null,
            responseBodyKeyId: null,
            ...data,
            id: randomUUID(),
            version: 1,
          } as KeyRow;
          remember(row.id);
          this.rows.set(row.id, row);
          created.push(pick(row, args.select));
        }
        return created;
      },
      findUnique: async (args: { where: Where; select?: Select }) => {
        await Promise.resolve();
        issue('findUnique');
        const row = [...this.rows.values()].find((candidate) => matches(candidate, args.where));
        return row === undefined ? null : pick(row, args.select);
      },
      updateMany: async (args: { where: Where; data: Record<string, unknown> }) => {
        await Promise.resolve();
        issue('updateMany');
        return { count: update(args.where, args.data).length };
      },
      updateManyAndReturn: async (args: { where: Where; data: Record<string, unknown>; select?: Select }) => {
        await Promise.resolve();
        issue('updateManyAndReturn');
        return update(args.where, args.data).map((row) => pick(row, args.select));
      },
      deleteMany: async (args: { where: Where }) => {
        await Promise.resolve();
        issue('deleteMany');
        const hit = [...this.rows.values()].filter((row) => matches(row, args.where));
        for (const row of hit) {
          remember(row.id);
          this.rows.delete(row.id);
        }
        return { count: hit.length };
      },
    };
  }
}

/** A transaction client whose only model is the SYSTEM `IdempotencyKey`. */
class MemoryTx {
  readonly _runtimeDataModel = { models: { IdempotencyKey: {} } };
  readonly idempotencyKey: ReturnType<MemoryKeys['delegate']>;
  constructor(keys: MemoryKeys, undo: Array<() => void>) {
    this.idempotencyKey = keys.delegate(undo);
  }
}

export interface MemoryRunner extends TenantTxRunner<unknown> {
  /** `begin`, `commit`, `rollback` per transaction, interleaved with whatever the test records. */
  readonly events: string[];
  readonly contexts: TenantContext[];
}

/** A tenant-transaction runner over `keys` (see the header); `events` may be shared with the test. */
export function memoryRunner(keys: MemoryKeys, events: string[] = []): MemoryRunner {
  const runner: MemoryRunner = {
    events,
    contexts: [],
    transactionOptions: { maxWait: 1, timeout: 1 },
    probeFreshConnection: () => Promise.resolve(),
    withTenantTx: async <R>(ctx: TenantContext, fn: (db: never) => Promise<R>, call?: TenantTxCallOptions): Promise<R> => {
      runner.contexts.push(ctx);
      events.push(call?.readOnly === true ? 'begin:ro' : 'begin');
      const undo: Array<() => void> = [];
      const handle = createTenantDb(new MemoryTx(keys, undo));
      try {
        const result = await fn(handle.db as never);
        events.push('commit');
        return result;
      } catch (error) {
        for (const restore of undo.reverse()) restore();
        events.push('rollback');
        throw error;
      } finally {
        handle.revoke();
      }
    },
  };
  return runner;
}

/** A fixed 32-byte test key (not a secret: a test fixture, never configuration). */
export const TEST_BODY_KEY = { keyId: 'idempotency-body-v1', key: new Uint8Array(32).fill(7) } as const;
export const TEST_NEXT_BODY_KEY = { keyId: 'idempotency-body-v2', key: new Uint8Array(32).fill(3) } as const;
export const TEST_NETWORK_KEY = new Uint8Array(32).fill(9);

export interface LogLine {
  readonly level: 'info' | 'warn' | 'error';
  readonly event: string;
  readonly fields: IdempotencyLogFields | undefined;
}

/** An idempotency log that records its lines (`lines` may be shared with the test). */
export function recordingLog(lines: LogLine[] = []): IdempotencyLog & { readonly lines: LogLine[] } {
  const at =
    (level: LogLine['level']) =>
    (event: string, fields?: IdempotencyLogFields): void => {
      lines.push({ level, event, fields });
    };
  return { lines, info: at('info'), warn: at('warn'), error: at('error') };
}

export const SILENT_IDEMPOTENCY_LOG: IdempotencyLog = { info: () => undefined, warn: () => undefined, error: () => undefined };
