import { systemDelegates } from '../../../platform/db/system-db.js';

interface OutboxDelegate {
  findMany(): Promise<unknown[]>;
}

/** PR19-SEC-01: a module repository touching the outbox delegate outside the allow-list (platform/outbox only). */
export const pending = (tx: object): Promise<unknown[]> => (systemDelegates(tx) as { outboxEvent: OutboxDelegate }).outboxEvent.findMany();
