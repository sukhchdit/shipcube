interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare const deps: Deps;
declare const base: object;
declare const mode: 'none' | 'tenant';
declare function defineRoute(spec: object): unknown;

// D-ARCH-106 R2: the effective transaction is not the literal 'none', so the handler counts as tenant.
// A spread without transaction: 'none'.
export const spread = defineRoute({ ...base, handler: async () => deps.queue.add('spread', {}) });

// transaction: 'none' followed by a spread that may override it.
export const overridden = defineRoute({ transaction: 'none', ...base, handler: async () => deps.queue.add('overridden', {}) });

// A non-literal transaction value.
export const computed = defineRoute({ transaction: mode, handler: async () => deps.queue.add('computed', {}) });
