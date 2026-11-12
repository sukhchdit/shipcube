/**
 * A single `pg` connection outside the runtime pool, built from the same validated settings (`toPoolConfig`): same
 * role, TLS, `statement_timeout`, `query_timeout` and connect timeout. Used where a check must see a connection on
 * which no transaction ever ran, i.e. the session-integrity start-up check (PR-0009 code review M1).
 */
import pg from 'pg';

import { type DatabaseClientOptions, toPoolConfig } from './client.js';
import type { DedicatedConnection } from './session-integrity.js';

/** Returns a connector that opens a new connection per call; the caller ends it. */
export function dedicatedConnector(options: DatabaseClientOptions): () => Promise<DedicatedConnection> {
  const config = toPoolConfig(options);
  return async () => {
    const client = new pg.Client(config);
    // An idle client's socket error is emitted as 'error'; without a listener it would crash the process.
    client.on('error', () => undefined);
    try {
      await client.connect();
    } catch (error) {
      await client.end().catch(() => undefined);
      throw error;
    }
    return client;
  };
}
