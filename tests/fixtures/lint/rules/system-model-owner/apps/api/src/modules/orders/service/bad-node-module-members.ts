type Loader = { _load: (id: string) => unknown };
type Members = Record<string, (url: string) => (id: string) => unknown>;

declare const key: string;

/**
 * PR54-SEC-03: every node:module value is bounded by NODE_MODULE_ALLOWED (createRequire, builtinModules, isBuiltin),
 * the same list no-restricted-imports applies to a static import. Each form below is one finding.
 */
// 1. A member outside the allow-list on the awaited import.
export const awaited = async (): Promise<unknown> => ((await import('node:module')).Module as unknown as Loader)._load('pg');

// 2. register / registerHooks through the one const.
export const hooks = async (): Promise<void> => {
  const m = await import('node:module');
  m.register('data:text/javascript,export%20{}');
  m.registerHooks({});
};

// 3. The default member is the whole module again (destructured, then _load or a computed key).
export const viaDefault = async (): Promise<unknown> => {
  const { default: M } = await import('node:module');
  return (M as unknown as Loader)._load('node:child_process');
};
export const viaDefaultKey = async (): Promise<unknown> => {
  const { default: M } = await import('node:module');
  return (M as unknown as Members)[key]?.(import.meta.url)('pg');
};

// 4. The parameter of an inline .then callback.
export const viaThen = (): Promise<unknown> => import('node:module').then((m) => (m.Module as unknown as Loader)._load('pg'));

// A rest element carries the other members.
export const viaRest = async (): Promise<unknown> => {
  const { isBuiltin, ...rest } = await import('node:module');
  return [isBuiltin('node:fs'), rest];
};

// The getBuiltinModule source too (no-restricted-properties reports the getBuiltinModule read as well).
export const viaBuiltin = (): unknown => (process.getBuiltinModule('node:module').Module as unknown as Loader)._load('pg');
