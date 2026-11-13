/** PR11-SEC-17 a: `db[k]` hides which member is read (k may be '$queryRawUnsafe' or '$parent'). */
export const member = (db: Record<string, unknown>, k: string): unknown => db[k];
