/**
 * BullMQ connection options from `REDIS_URL` (ADR-0013; ADR-0010 am. 7; TASK-035). Built from the same explicit,
 * validated options as the runtime's Valkey client (`buildValkeyOptions`: host, port, db, ACL user, TLS; never the raw
 * URL), in two profiles (PR64-SEC-03, R1-m4):
 *
 * - `worker`: for BullMQ `Worker` instances only. `maxRetriesPerRequest: null` (a worker's blocking commands must never
 *   be failed by a retry cap) and no `commandTimeout` (a blocking BZPOPMIN waits longer than the 2 s readiness budget).
 * - `queue`: for every non-blocking `Queue` (metrics, dead-letter writes, the producer queues of TASK-043). Fail-fast
 *   (CLAUDE.md §9): the 2 s command timeout and the one retry per request of `buildValkeyOptions`, and no offline
 *   queue, so a command issued while Valkey is down or refuses AUTH is rejected at once instead of waiting for it.
 */
import { buildValkeyOptions } from '@platform/api/runtime';
import type { ConnectionOptions } from 'bullmq';

export type ConnectionProfile = 'worker' | 'queue';

export function queueConnectionOptions(url: string, connectionName: string, profile: ConnectionProfile): ConnectionOptions {
  const options: Record<string, unknown> = { ...buildValkeyOptions({ url, connectionName }) };
  if (profile === 'queue') return { ...options, enableOfflineQueue: false };
  delete options['commandTimeout'];
  return { ...options, maxRetriesPerRequest: null };
}
