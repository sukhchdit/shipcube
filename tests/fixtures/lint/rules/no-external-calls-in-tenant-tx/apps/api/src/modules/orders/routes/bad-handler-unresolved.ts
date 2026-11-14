type Handler = (ctx: { id: string }) => Promise<unknown>;

declare function defineRoute(spec: object): unknown;
declare function makeHandler(deps: object): Handler;
declare const deps: object;

// D-ARCH-111 (b): a root phase the rule cannot follow is reported.
// A route-building helper: the handler is a parameter.
export const build = (handler: Handler): unknown => defineRoute({ operationId: 'built', handler });

// A let binding.
let reassigned: Handler = async () => ({ status: 200 });
export const swap = (next: Handler): void => {
  reassigned = next;
};
export const fromLet = defineRoute({ operationId: 'fromLet', handler: reassigned });

// A call with no function argument, inline and through a const.
export const made = defineRoute({ operationId: 'made', handler: makeHandler(deps) });
const prepared = makeHandler(deps);
export const fromConst = defineRoute({ operationId: 'fromConst', handler: prepared });

// A load parameter.
export const buildLoad = (load: Handler): unknown => defineRoute({ operationId: 'builtLoad', load, handler: async () => ({}) });
