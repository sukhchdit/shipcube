interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

interface LoadContext {
  id: string;
  signal: AbortSignal;
}

declare const deps: Deps;
declare function defineRoute(spec: object): unknown;
declare function fixtureRoute(spec: object): unknown;

// D-ARCH-106 (5) R4: the load phase runs in a read-only tenant transaction, in every function form, whatever the
// route's transaction.
async function loadDeclared(ctx: LoadContext): Promise<unknown> {
  return deps.queue.add('declared', { id: ctx.id });
}

const loadConst = async (ctx: LoadContext): Promise<unknown> => deps.queue.add('const', { id: ctx.id });

export const arrow = defineRoute({
  operationId: 'arrowLoad',
  load: async (ctx: LoadContext) => deps.queue.add('arrow', { id: ctx.id }),
  handler: async () => ({ status: 200 }),
});

export const expression = defineRoute({
  operationId: 'expressionLoad',
  load: async function (ctx: LoadContext) {
    return deps.queue.add('expression', { id: ctx.id });
  },
  handler: async () => ({ status: 200 }),
});

export const method = defineRoute({
  operationId: 'methodLoad',
  load(ctx: LoadContext) {
    return deps.queue.add('method', { id: ctx.id });
  },
  handler: async () => ({ status: 200 }),
});

export const asyncMethod = defineRoute({
  operationId: 'asyncMethodLoad',
  async load(ctx: LoadContext) {
    return deps.queue.add('asyncMethod', { id: ctx.id });
  },
  handler: async () => ({ status: 200 }),
});

export const declared = defineRoute({ operationId: 'declaredLoad', load: loadDeclared, handler: async () => ({ status: 200 }) });
export const constant = defineRoute({ operationId: 'constLoad', load: loadConst, handler: async () => ({ status: 200 }) });

// A root whatever the transaction (defineRoute refuses load on transaction: 'none' at module load), fixtureRoute included.
export const none = defineRoute({
  operationId: 'noneLoad',
  transaction: 'none',
  load: async (ctx: LoadContext) => deps.queue.add('none', { id: ctx.id }),
  handler: async () => ({ status: 200 }),
});
export const fixture = fixtureRoute({ load: async (ctx: LoadContext) => deps.queue.add('fixture', { id: ctx.id }) });
