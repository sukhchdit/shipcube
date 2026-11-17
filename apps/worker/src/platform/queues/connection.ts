/**
 * BullMQ connection options from `REDIS_URL` (ADR-0013; ADR-0010 am. 7; TASK-035). Built from the same explicit,
 * validated options as the runtime's Valkey client (`buildValkeyOptions`: host, port, db, ACL user, TLS; never the raw
 * URL), with the two BullMQ requirements: `maxRetriesPerRequest: null` (a worker's blocking commands must never be
 * failed by a retry cap) and no `commandTimeout` (a blocking BZPOPMIN waits longer than the 2 s readiness budget).
 */
import { buildValkeyOptions } from '@platform/api/runtime';
import type { ConnectionOptions } from 'bullmq';

export function queueConnectionOptions(url: string, connectionName: string): ConnectionOptions {
  const options: Record<string, unknown> = { ...buildValkeyOptions({ url, connectionName }) };
  delete options['commandTimeout'];
  return { ...options, maxRetriesPerRequest: null };
}
