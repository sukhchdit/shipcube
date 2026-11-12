import { createDatabaseClient } from './client.js';

export const withTenantTx = (): number => createDatabaseClient();
