interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare const deps: Deps;
declare function defineRoute(spec: object): unknown;

// Code review R1-m5 (a), PR44-SEC-04 S01-S04: a spread of an inline or same-file const object literal is walked as
// part of the route spec, recursively.
// S01: `{ ...decl, ...phases }`: both phases of the const literal are roots.
const decl = { operationId: 'spreadPhases' };
const phases = {
  load: async () => deps.queue.add('load', {}),
  handler: async () => deps.queue.add('handler', {}),
};
export const spreadPhases = defineRoute({ ...decl, ...phases });

// S02: an inline `...{ load }`.
export const inlineSpread = defineRoute({
  operationId: 'inlineSpread',
  ...{ load: async () => deps.queue.add('inline', {}) },
  handler: async () => ({ status: 200 }),
});

// S03: a const `{ load }` spread before an explicit handler.
const loadOnly = { load: async () => deps.queue.add('loadOnly', {}) };
export const constLoad = defineRoute({ operationId: 'constLoad', ...loadOnly, handler: async () => ({ status: 200 }) });

// S04: a const literal that itself spreads another const literal.
const inner = { handler: async () => deps.queue.add('nested', {}) };
const outer = { operationId: 'nested', ...inner };
export const nested = defineRoute({ ...outer });
