/**
 * PR54-SEC-03 positive control: the allowed node:module members (createRequire(<url>).resolve('<literal>'),
 * builtinModules, isBuiltin) on the dynamic import and its inline .then parameter, and a static destructuring of process.
 */
export const builtins = async (): Promise<readonly string[]> => (await import('node:module')).builtinModules;
export const builtin = (): Promise<boolean> => import('node:module').then((m) => m.isBuiltin('node:fs'));
export const resolvePg = async (): Promise<string> => (await import('node:module')).createRequire(import.meta.url).resolve('pg');
export const lookups = async (): Promise<boolean> => {
  const { builtinModules, isBuiltin } = await import('node:module');
  return builtinModules.every((name) => isBuiltin(name));
};

const { env } = process;
export const mode = (): string | undefined => env.NODE_ENV;
