interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare const deps: Deps;
declare function defineRoute(spec: object): unknown;

const HANDLER = 'handler';
const LOAD = `load` as const;

// PR44-SEC-04 K02-K04: a no-substitution template literal key and a same-file const string key resolve like the
// plain key.
export const templateLoad = defineRoute({
  operationId: 'templateLoad',
  [`load`]: async () => deps.queue.add('templateLoad', {}),
  handler: async () => ({ status: 200 }),
});
export const templateHandler = defineRoute({
  operationId: 'templateHandler',
  [`handler`]: async () => deps.queue.add('templateHandler', {}),
});
export const constHandler = defineRoute({ operationId: 'constHandler', [HANDLER]: async () => deps.queue.add('constHandler', {}) });
export const constLoad = defineRoute({
  operationId: 'constLoad',
  [LOAD]: async () => deps.queue.add('constLoad', {}),
  handler: async () => ({ status: 200 }),
});
