import pg = require('pg');

/** PR44-SEC-11 (a): a read of an `import x = require('<literal>')` binding must not crash the lint run. */
export const pool = new pg.Pool();
