import { systemDelegates } from '../db/system-db.js';

interface OutboxDelegate {
  findMany(): Promise<unknown[]>;
}

/** PR19-SEC-01 positive control: the owning module (platform/outbox, per the outbox manifest) reads its own table. */
export const pending = (tx: object): Promise<unknown[]> => {
  const { outboxEvent } = systemDelegates(tx) as { outboxEvent: OutboxDelegate };
  return outboxEvent.findMany();
};
