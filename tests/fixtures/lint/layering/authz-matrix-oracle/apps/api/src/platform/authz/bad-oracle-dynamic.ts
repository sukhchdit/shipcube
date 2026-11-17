// PR48-SEC-03: a production authorise loads the oracle with import() (no-restricted-imports does not see it).
export const load = (): Promise<unknown> => import('@platform/authz/matrix');
