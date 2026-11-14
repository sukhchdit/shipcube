/**
 * PR44-SEC-10 / D-TASK020-59 residual: a two-hop alias of the dynamic import of node:module (the second variable is
 * reported; its createRequire member is the usual loader finding).
 */
export const load = async (): Promise<unknown> => {
  const loaded = await import('node:module');
  const again = loaded;
  return again.createRequire(import.meta.url)('node:util');
};
