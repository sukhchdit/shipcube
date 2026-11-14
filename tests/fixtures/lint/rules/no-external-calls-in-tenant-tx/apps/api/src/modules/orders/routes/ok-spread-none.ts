interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare const deps: Deps;
declare function defineRoute(spec: object): unknown;

// R1-m5 (a): a readable spread is part of the spec, so a transaction: 'none' it carries still makes the handler a
// non-transactional phase (positive control).
const noTransaction = { operationId: 'spreadNone', transaction: 'none' } as const;
export const spreadNone = defineRoute({ ...noTransaction, handler: async () => deps.queue.add('ping', {}) });
