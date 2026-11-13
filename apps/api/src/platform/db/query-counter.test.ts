import { EventEmitter } from 'node:events';

import { describe, expect, it } from '@jest/globals';

import {
  assertConstantQueryCount,
  assertQueryBudget,
  budgetCount,
  type CountableClient,
  createQueryCounter,
  MAX_REQUEST_REPORTS,
  type QueryCounter,
  type QueryReport,
  repeatedOperations,
  withQueryCounter,
} from './query-counter.js';

/** What the Prisma runtime does with the extension hook: call it, which calls the real query. */
async function run(counter: QueryCounter, model: string | undefined, operation: string, result: unknown = 'ok'): Promise<unknown> {
  return counter.extension.query.$allOperations({
    ...(model === undefined ? {} : { model }),
    operation,
    args: { where: { secret: 'never-recorded' } },
    query: () => Promise.resolve(result),
  });
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Minimal Express request/response doubles. */
function exchange(method: string, routePath: string | undefined, status = 200) {
  const req = { method, baseUrl: '/api/v1', ...(routePath === undefined ? {} : { route: { path: routePath } }) };
  const res = Object.assign(new EventEmitter(), { statusCode: status });
  return { req, res };
}

function report(queries: Array<[string | undefined, string]>): QueryReport {
  const items = queries.map(([model, operation]) =>
    model === undefined ? { kind: 'raw' as const, operation } : { kind: 'model' as const, model, operation },
  );
  const raw = items.filter((item) => item.kind === 'raw').length;
  return { count: items.length, modelCount: items.length - raw, rawCount: raw, queries: items };
}

describe('[NT-PERF-006-b] query counter: measure()', () => {
  it('counts model and raw operations of one scope, in order, and returns the result', async () => {
    const counter = createQueryCounter();
    const { result, report: r } = await counter.measure(async () => {
      await run(counter, undefined, '$queryRaw');
      await run(counter, 'Order', 'findMany');
      await tick();
      await run(counter, 'Order', 'findMany');
      return 42;
    });
    expect(result).toBe(42);
    expect(r.count).toBe(3);
    expect(r.modelCount).toBe(2);
    expect(r.rawCount).toBe(1);
    expect(r.queries.map((q) => q.operation)).toEqual(['$queryRaw', 'findMany', 'findMany']);
  });

  it('never records arguments, only operation names', async () => {
    const counter = createQueryCounter();
    const { report: r } = await counter.measure(() => run(counter, 'User', 'update'));
    expect(JSON.stringify(r)).not.toContain('never-recorded');
  });

  it('keeps concurrent scopes apart (AsyncLocalStorage), including across timers', async () => {
    const counter = createQueryCounter();
    const slow = counter.measure(async () => {
      await run(counter, 'A', 'findMany');
      await tick();
      await tick();
      await run(counter, 'A', 'findMany');
    });
    const fast = counter.measure(async () => {
      await run(counter, 'B', 'count');
    });
    const [a, b] = await Promise.all([slow, fast]);
    expect(a.report.queries.map((q) => q.model)).toEqual(['A', 'A']);
    expect(b.report.queries.map((q) => q.model)).toEqual(['B']);
  });

  it('counts a lazy query (PrismaPromise-like thenable) returned without await from the measured function', async () => {
    const counter = createQueryCounter();
    // Like a PrismaPromise: nothing runs (no hook call) until `then` is invoked.
    const lazy = (model: string): PromiseLike<unknown> => ({
      then: (onFulfilled, onRejected) => run(counter, model, 'count').then(onFulfilled, onRejected),
    });
    const [one, two] = await Promise.all([
      counter.measure(() => lazy('A') as Promise<unknown>),
      counter.measure(async () => {
        await lazy('B');
        await lazy('B');
      }),
    ]);
    expect(one.result).toBe('ok');
    expect(one.report.queries.map((q) => q.model)).toEqual(['A']);
    expect(two.report.queries.map((q) => q.model)).toEqual(['B', 'B']);
  });

  it('counts a query that fails, passes the result and the rejection through, and ignores calls outside any scope', async () => {
    const counter = createQueryCounter();
    await expect(run(counter, 'Order', 'findMany', 'free')).resolves.toBe('free');
    const failing = counter.measure(() =>
      counter.extension.query.$allOperations({
        model: 'Order',
        operation: 'create',
        args: {},
        query: () => Promise.reject(new Error('db down')),
      }),
    );
    await expect(failing).rejects.toThrow('db down');
    const { report: r } = await counter.measure(async () => {
      await counter.extension.query
        .$allOperations({ model: 'Order', operation: 'create', args: {}, query: () => Promise.reject(new Error('x')) })
        .catch(() => undefined);
    });
    expect(r.count).toBe(1);
  });
});

describe('[NT-PERF-006-b] query counter: per-request counts for the API suite', () => {
  it('reports one entry per request with method, matched route, status and counts', async () => {
    const counter = createQueryCounter();
    const { req, res } = exchange('GET', '/orders/:id', 404);
    await new Promise<void>((resolve) => {
      counter.middleware()(req, res, () => {
        void run(counter, undefined, '$queryRaw')
          .then(() => run(counter, 'Order', 'findFirst'))
          .then(() => {
            res.emit('finish');
            resolve();
          });
      });
    });
    expect(counter.requests()).toEqual([
      expect.objectContaining({ method: 'GET', route: '/api/v1/orders/:id', status: 404, count: 2, modelCount: 1, rawCount: 1 }),
    ]);
    expect(counter.lastRequest('GET', '/api/v1/orders/:id')?.count).toBe(2);
    expect(counter.lastRequest('POST', '/api/v1/orders/:id')).toBeUndefined();
  });

  it('records a request once even if both finish and close fire, and labels unmatched requests', () => {
    const counter = createQueryCounter();
    const { req, res } = exchange('GET', undefined);
    counter.middleware()(req, res, () => undefined);
    res.emit('finish');
    res.emit('close');
    expect(counter.requests()).toHaveLength(1);
    expect(counter.requests()[0]?.route).toBe('unmatched');
  });

  it('keeps simultaneous requests apart and bounds the history', async () => {
    const counter = createQueryCounter();
    const a = exchange('GET', '/a');
    const b = exchange('GET', '/b');
    await Promise.all([
      new Promise<void>((resolve) => {
        counter.middleware()(a.req, a.res, () => {
          void tick()
            .then(() => run(counter, 'A', 'findMany'))
            .then(() => {
              a.res.emit('finish');
              resolve();
            });
        });
      }),
      new Promise<void>((resolve) => {
        counter.middleware()(b.req, b.res, () => {
          void run(counter, 'B', 'findMany')
            .then(() => run(counter, 'B', 'findMany'))
            .then(() => {
              b.res.emit('finish');
              resolve();
            });
        });
      }),
    ]);
    expect(counter.lastRequest('GET', '/api/v1/a')?.count).toBe(1);
    expect(counter.lastRequest('GET', '/api/v1/b')?.count).toBe(2);
    for (let i = 0; i < MAX_REQUEST_REPORTS + 5; i += 1) {
      const x = exchange('GET', '/x');
      counter.middleware()(x.req, x.res, () => undefined);
      x.res.emit('finish');
    }
    expect(counter.requests()).toHaveLength(MAX_REQUEST_REPORTS);
    counter.reset();
    expect(counter.requests()).toEqual([]);
  });
});

describe('[NT-PERF-006-b] budgets and N+1 detection', () => {
  const nPlusOne = report([
    [undefined, '$queryRaw'],
    ['Order', 'findMany'],
    ...Array.from({ length: 10 }, (): [string, string] => ['Parcel', 'findFirst']),
  ]);

  it('assertQueryBudget passes within budget and names the repeated operations when over', () => {
    expect(() => assertQueryBudget(nPlusOne, 12)).not.toThrow();
    expect(() => assertQueryBudget(nPlusOne, 5)).toThrow('12 queries, budget 5 (repeated: Parcel.findFirst x10)');
  });

  it('excludeRaw leaves out the tenant-context statement', () => {
    expect(budgetCount(nPlusOne)).toBe(12);
    expect(budgetCount(nPlusOne, { excludeRaw: true })).toBe(11);
    expect(() => assertQueryBudget(nPlusOne, 11, { excludeRaw: true })).not.toThrow();
  });

  it('repeatedOperations groups by model.operation and honours the threshold', () => {
    expect(repeatedOperations(nPlusOne)).toEqual({ 'Parcel.findFirst': 10 });
    expect(repeatedOperations(nPlusOne, 1)).toEqual({ $$queryRaw: 1, 'Order.findMany': 1, 'Parcel.findFirst': 10 });
  });

  it('assertConstantQueryCount: page 10 and page 100 must cost the same (NT-PERF-006-b)', () => {
    const page10 = report([
      [undefined, '$queryRaw'],
      ['Order', 'findMany'],
    ]);
    const page100 = report([
      [undefined, '$queryRaw'],
      ['Order', 'findMany'],
    ]);
    expect(() => assertConstantQueryCount([page10, page100])).not.toThrow();
    expect(() => assertConstantQueryCount([page10, nPlusOne])).toThrow('query count depends on the input: 2 vs 12 (N+1 suspected)');
  });
});

describe('withQueryCounter', () => {
  it('extends the client with the counter extension and returns the extended client', () => {
    const counter = createQueryCounter();
    const extended = { extended: true };
    const seen: unknown[] = [];
    const client: CountableClient = {
      $extends: (extension) => {
        seen.push(extension);
        return extended;
      },
    };
    expect(withQueryCounter(client, counter)).toBe(extended);
    expect(seen).toEqual([counter.extension]);
    expect(() => withQueryCounter({ $extends: () => undefined }, counter)).toThrow('returned no client');
  });
});
