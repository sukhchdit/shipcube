import { createRequire } from 'node:module';

/** PR32-SEC-07 (a): createRequire(url)(literal) naming the SYSTEM accessor is a load of it (reported, untracked). */
export const load = (): unknown => createRequire(import.meta.url)('../../../platform/db/system-db.js');
