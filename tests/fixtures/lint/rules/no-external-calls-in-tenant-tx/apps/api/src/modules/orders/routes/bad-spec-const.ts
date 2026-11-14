interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare const deps: Deps;
declare function defineRoute(spec: object): unknown;

// D-ARCH-111 (a): a spec held in a same-file const object literal is walked like an inline one (R2 and R4).
const cancelSpec = {
  operationId: 'cancelOrder',
  load: async (ctx: { id: string }) => deps.queue.add('load', { id: ctx.id }),
  handler: async (ctx: { id: string }) => deps.queue.add('cancel', { id: ctx.id }),
} satisfies object;

export const cancel = defineRoute(cancelSpec);
