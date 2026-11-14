type Handler = (ctx: { id: string }) => Promise<unknown>;

interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare const deps: Deps;
declare const flag: boolean;
declare const maybe: Handler | undefined;
declare function defineRoute(spec: object): unknown;

// Code review R1-m5 (b) Q2: a const bound to a conditional of two inline functions is walked through both branches.
const pick = flag ? async () => deps.queue.add('first', {}) : async () => deps.queue.add('second', {});
export const picked = defineRoute({ operationId: 'picked', handler: pick });

// A const nullish default, and a const alias of it, as a load phase.
const chosen = maybe ?? (async () => deps.queue.add('chosen', {}));
const again = chosen;
export const chosenRoute = defineRoute({ operationId: 'chosen', load: again, handler: async () => ({ status: 200 }) });
