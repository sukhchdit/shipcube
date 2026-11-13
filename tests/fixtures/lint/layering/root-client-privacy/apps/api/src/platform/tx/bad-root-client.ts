// The tx slot gets its runner from the database runtime (RuntimeServices.tenantTx), never from the root client
// (PR11-SEC-09, TASK-020): this import must fail the boundaries rule.
import { createDatabaseClient } from '../db/client.js';

export const client = createDatabaseClient();
