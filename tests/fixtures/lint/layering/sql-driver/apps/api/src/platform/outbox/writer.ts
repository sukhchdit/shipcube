// PR2-SEC-05 addendum / PR11-SEC-05 item 2 (D-ARCH-074; TASK-043): the outbox writer takes the TenantDb of the business
// transaction and nothing else; a pg pool beside it would write outside that transaction.
import pg from 'pg';

export const pool = new pg.Pool();
