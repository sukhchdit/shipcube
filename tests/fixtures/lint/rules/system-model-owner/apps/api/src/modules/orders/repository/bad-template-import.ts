/** PR32-SEC-07 (a) S2: a no-substitution template literal is a literal specifier: the dynamic load is reported. */
export const load = async (): Promise<unknown> => import(`../../../platform/db/system-db.js`);
