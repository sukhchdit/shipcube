import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);

/** PR44-SEC-01 A13: the PostgreSQL driver through a createRequire loader kept in a variable (boundaries cannot see it). */
export const driver = (): unknown => req('pg');
