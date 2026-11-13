interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare const deps: Deps;
declare function defineRoute(spec: object): unknown;

// D-ARCH-106 R2 (PR32-SEC-01 T2b): an injected queue reached from a defineRoute handler (no transaction declared).
export const label = defineRoute({
  operationId: 'createLabel',
  handler: async (ctx: { id: string }) => deps.queue.add('label', { id: ctx.id }),
});
