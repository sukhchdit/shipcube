/**
 * Test double of the store's {@link AuditSqlPort}: records every tagged-template statement (text with `$n`
 * placeholders, whitespace collapsed) and its bound values, and answers from a script of results.
 */
import type { AuditSqlPort } from '../store/prisma-store.js';

export interface RecordedStatement {
  readonly kind: 'query' | 'execute';
  readonly text: string;
  readonly values: readonly unknown[];
}

export type Answer = unknown[] | number | Error;

export interface FakeSql extends AuditSqlPort {
  readonly statements: RecordedStatement[];
  /** Answers consumed in order; a function answers from the statement. */
  readonly script: Array<Answer | ((statement: RecordedStatement) => Answer)>;
  /** Every failure passed to `markRollbackOnly`, in call order (PR42-SEC-02). */
  readonly marked: Error[];
  /** How many works were started through `track` (PR42-SEC-13). */
  readonly tracked: () => number;
  /** Every check registered through `beforeCommit` (D-ARCH-122 I3), in registration order. */
  readonly checks: Array<() => Error | undefined>;
  /** What `contextOrgId()` answers ('' = an organisation-less transaction); settable per test. */
  orgId: string;
}

const render = (strings: TemplateStringsArray): string =>
  strings
    .reduce((text, part, index) => (index === 0 ? part : `${text}$${String(index)}${part}`), '')
    .replace(/\s+/g, ' ')
    .trim();

export function fakeSql(...script: Array<Answer | ((statement: RecordedStatement) => Answer)>): FakeSql {
  const statements: RecordedStatement[] = [];
  const marked: Error[] = [];
  const checks: Array<() => Error | undefined> = [];
  let tracked = 0;
  const answer = (statement: RecordedStatement): Promise<unknown> => {
    statements.push(statement);
    const next = script.shift();
    if (next === undefined) return Promise.reject(new Error(`unscripted statement: ${statement.text.slice(0, 60)}`));
    const value = typeof next === 'function' ? next(statement) : next;
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  };
  return {
    statements,
    script,
    marked,
    tracked: () => tracked,
    checks,
    orgId: '',
    beforeCommit(check: () => Error | undefined): void {
      checks.push(check);
    },
    contextOrgId(): string {
      return this.orgId;
    },
    markRollbackOnly(failure: Error): void {
      marked.push(failure);
    },
    track<T>(work: () => Promise<T>): Promise<T> {
      tracked += 1;
      return work();
    },
    $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> {
      return answer({ kind: 'query', text: render(query), values }) as Promise<T>;
    },
    $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number> {
      return answer({ kind: 'execute', text: render(query), values }) as Promise<number>;
    },
  };
}

/** A Prisma driver-adapter error carrying a SQLSTATE (the shape `toAuditWriteError` reads). */
export function driverError(sqlState: string, message = 'server message'): Error {
  return Object.assign(new Error('Raw query failed'), {
    code: 'P2010',
    meta: { driverAdapterError: { cause: { originalCode: sqlState, originalMessage: message, kind: 'postgres' } } },
  });
}

/** A head row as statement 2 returns it. */
export const headRow = (entryCount: number, headHash = '00'.repeat(32), headUs: string | null = null, nowUs = '1763000000123456') => [
  { entry_count: String(entryCount), head_hash: headHash, head_us: headUs, now_us: nowUs },
];
