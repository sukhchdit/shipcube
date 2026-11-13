/**
 * Prisma query counter for the API suite (NFR-PERF-006: "no N+1, <= 12 queries per list request"; T-QA-03; TASK-276).
 *
 * A test-support seam that lives with the database platform because it hooks the Prisma client. It is never mounted by
 * the production composition root: the API test app builder extends the client with {@link QueryCounter.extension} and
 * mounts {@link QueryCounter.middleware} first, then each request's query count is read from
 * {@link QueryCounter.requests}.
 *
 * What is counted: every Prisma operation that reaches the engine, model operations (`user.findMany`) and raw queries
 * (`$queryRaw`, `$executeRaw`), including those inside interactive transactions. One `include` is ONE operation, so the
 * counter catches the N+1 shape that matters (a repository call per row) rather than the join strategy. The tenant
 * context statement of `withTenantTx` is a raw query and is therefore counted too: budgets are written with it in
 * mind (one extra round trip per request, data-model §4.1), or exclude it with `excludeRaw`.
 *
 * Scoping is by AsyncLocalStorage: concurrent requests and `measure()` calls never see each other's queries. The
 * report holds operation names only, never arguments, so it cannot carry a value into a failure message.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RecordedQuery {
  readonly kind: 'model' | 'raw';
  readonly model?: string;
  readonly operation: string;
}

export interface QueryReport {
  readonly count: number;
  readonly modelCount: number;
  readonly rawCount: number;
  readonly queries: readonly RecordedQuery[];
}

export interface RequestQueryReport extends QueryReport {
  readonly method: string;
  /** Matched route pattern (`/api/v1/orders/:id`), or `unmatched` when no route matched. */
  readonly route: string;
  readonly status: number;
}

/** Prisma extension object (`Prisma.defineExtension` input shape) with one top-level `$allOperations` hook. */
export interface QueryCounterExtension {
  readonly name: 'query-counter';
  readonly query: {
    $allOperations(params: {
      readonly model?: string;
      readonly operation: string;
      readonly args: unknown;
      readonly query: (args: unknown) => Promise<unknown>;
    }): Promise<unknown>;
  };
}

/** The part of a Prisma client this module touches. */
export interface CountableClient {
  $extends(extension: QueryCounterExtension): unknown;
}

interface RequestLike {
  readonly method: string;
  readonly baseUrl?: string;
  readonly route?: { readonly path?: unknown } | undefined;
}
interface ResponseLike {
  readonly statusCode: number;
  once(event: 'finish' | 'close', listener: () => void): unknown;
}

export interface QueryCounter {
  readonly extension: QueryCounterExtension;
  /** Runs `fn` in a fresh scope and returns its result with the queries it issued (also those after an `await`). */
  measure<T>(fn: () => Promise<T>): Promise<{ readonly result: T; readonly report: QueryReport }>;
  /** Express-compatible middleware: one scope per request, reported to {@link QueryCounter.requests} when the response ends. */
  middleware(): (req: RequestLike, res: ResponseLike, next: (error?: unknown) => void) => void;
  /** Completed requests, oldest first (bounded to the last {@link MAX_REQUEST_REPORTS}). */
  requests(): readonly RequestQueryReport[];
  /** The most recent request for `method` + `route`, or undefined. */
  lastRequest(method: string, route: string): RequestQueryReport | undefined;
  reset(): void;
}

export const MAX_REQUEST_REPORTS = 1_000;

interface Scope {
  readonly queries: RecordedQuery[];
}

function buildReport(queries: readonly RecordedQuery[]): QueryReport {
  const rawCount = queries.filter((query) => query.kind === 'raw').length;
  return Object.freeze({ count: queries.length, modelCount: queries.length - rawCount, rawCount, queries: Object.freeze([...queries]) });
}

export function createQueryCounter(): QueryCounter {
  const storage = new AsyncLocalStorage<Scope>();
  let completed: RequestQueryReport[] = [];

  const extension: QueryCounterExtension = {
    name: 'query-counter',
    query: {
      $allOperations({ model, operation, query, args }) {
        // Recorded before the call: a failing query still cost a round trip.
        storage.getStore()?.queries.push(model === undefined ? { kind: 'raw', operation } : { kind: 'model', model, operation });
        return query(args);
      },
    },
  };

  return {
    extension,
    async measure(fn) {
      const scope: Scope = { queries: [] };
      // Await INSIDE the scope: a PrismaPromise is lazy and runs its query (and the hook) only when `then` is called, so
      // awaiting the bare return value outside `run` would execute it with no scope (found by the integration suite).
      const result = await storage.run(scope, async () => await fn());
      return { result, report: buildReport(scope.queries) };
    },
    middleware() {
      return (req, res, next) => {
        const scope: Scope = { queries: [] };
        let reported = false;
        const finish = (): void => {
          if (reported) return;
          reported = true;
          const path = typeof req.route?.path === 'string' ? req.route.path : undefined;
          const route = path === undefined ? 'unmatched' : `${req.baseUrl ?? ''}${path}`;
          completed = [...completed, { ...buildReport(scope.queries), method: req.method, route, status: res.statusCode }].slice(
            -MAX_REQUEST_REPORTS,
          );
        };
        res.once('finish', finish);
        res.once('close', finish);
        storage.run(scope, next);
      };
    },
    requests: () => completed,
    lastRequest: (method, route) => [...completed].reverse().find((entry) => entry.method === method && entry.route === route),
    reset() {
      completed = [];
    },
  };
}

/** Extends `client` with the counter and returns the extended client (same pool and engine). */
export function withQueryCounter<TClient extends CountableClient>(client: TClient, counter: QueryCounter): TClient {
  const extended = client.$extends(counter.extension);
  if (typeof extended !== 'object' || extended === null) throw new TypeError('withQueryCounter: $extends returned no client');
  return extended as TClient;
}

export interface BudgetOptions {
  /** Leave raw queries (the tenant-context statement, `set_config`) out of the count. */
  readonly excludeRaw?: boolean;
}

/** The count that a budget applies to. */
export function budgetCount(report: QueryReport, options: BudgetOptions = {}): number {
  return options.excludeRaw === true ? report.modelCount : report.count;
}

/** `model.operation` -> times issued, for operations issued at least `minRepeats` times: the N+1 signature. */
export function repeatedOperations(report: QueryReport, minRepeats = 3): Record<string, number> {
  const counts = new Map<string, number>();
  for (const query of report.queries) {
    const key = query.model === undefined ? `$${query.operation}` : `${query.model}.${query.operation}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].filter(([, n]) => n >= minRepeats).sort(([a], [b]) => a.localeCompare(b)));
}

/** Throws when the request issued more than `max` queries; the message lists repeated operations (names only). */
export function assertQueryBudget(report: QueryReport, max: number, options: BudgetOptions = {}): void {
  const count = budgetCount(report, options);
  if (count <= max) return;
  const repeated = Object.entries(repeatedOperations(report))
    .map(([key, n]) => `${key} x${n}`)
    .join(', ');
  throw new Error(`query budget exceeded: ${count} queries, budget ${max}${repeated === '' ? '' : ` (repeated: ${repeated})`}`);
}

/** Throws unless every report has the same count: the page-size independence check (page 10 and page 100 cost the same). */
export function assertConstantQueryCount(reports: readonly QueryReport[], options: BudgetOptions = {}): void {
  const counts = reports.map((report) => budgetCount(report, options));
  if (new Set(counts).size > 1) throw new Error(`query count depends on the input: ${counts.join(' vs ')} (N+1 suspected)`);
}
