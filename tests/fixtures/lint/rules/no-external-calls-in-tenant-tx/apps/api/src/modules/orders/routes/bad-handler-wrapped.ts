interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare const deps: Deps;
declare function defineRoute(spec: object): unknown;
declare function timed<T>(fn: T): T;
declare function traced<T>(name: string, fn: T): T;

// D-ARCH-111 (b): a wrapped phase is walked through the function arguments of the wrapper call.
async function archive(ctx: { id: string }): Promise<unknown> {
  return deps.queue.add('archive', { id: ctx.id });
}

export const inline = defineRoute({
  operationId: 'timedInline',
  handler: timed(async (ctx: { id: string }) => deps.queue.add('inline', { id: ctx.id })),
});

export const named = defineRoute({ operationId: 'timedNamed', handler: timed(archive) });

// A conditional is walked through both branches.
export const either = defineRoute({ operationId: 'either', handler: deps.queue ? timed(archive) : async () => deps.queue.add('else', {}) });

// Nested wrappers, and a wrapped load phase.
export const nested = defineRoute({
  operationId: 'nestedLoad',
  load: traced(
    'load',
    timed(async (ctx: { id: string }) => deps.queue.add('load', { id: ctx.id })),
  ),
  handler: async () => ({ status: 200 }),
});
