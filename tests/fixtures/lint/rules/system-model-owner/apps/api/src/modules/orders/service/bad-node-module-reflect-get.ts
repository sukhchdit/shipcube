/** PR44-SEC-10 / D-TASK020-59 residual: the dynamic import of node:module passed to Reflect.get. */
export const load = async (key: string): Promise<unknown> => {
  const make = Reflect.get(await import('node:module'), key) as (url: string) => (id: string) => unknown;
  return make(import.meta.url)('node:util');
};
