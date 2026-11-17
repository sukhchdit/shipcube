/**
 * PR54-SEC-03 control: createRequire destructured from the dynamic import of node:module is reported once, as it was
 * before (the function is taken out, PR44-SEC-01); the allow-list adds no second finding.
 */
export const resolvePg = async (): Promise<string> => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url).resolve('pg');
};
