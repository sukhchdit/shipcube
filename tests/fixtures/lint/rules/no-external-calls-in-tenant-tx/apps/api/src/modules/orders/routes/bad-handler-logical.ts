type Handler = (ctx: { id: string }) => Promise<unknown>;

interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare const deps: Deps;
declare const maybe: Handler | undefined;
declare const override: false | Handler;
declare const enabled: boolean;
declare function defineRoute(spec: object): unknown;

// PR44-SEC-04 H03: a logical expression phase is walked through every operand, like a conditional.
export const nullish = defineRoute({ operationId: 'nullish', handler: maybe ?? (async () => deps.queue.add('nullish', {})) });
export const either = defineRoute({
  operationId: 'either',
  load: override || (async () => deps.queue.add('either', {})),
  handler: async () => ({ status: 200 }),
});
export const both = defineRoute({ operationId: 'both', handler: enabled && (async () => deps.queue.add('both', {})) });
