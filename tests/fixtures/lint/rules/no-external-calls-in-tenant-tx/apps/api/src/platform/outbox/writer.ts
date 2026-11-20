// D-ARCH-106 (ADR-0005 am. 11 item 18; TASK-043) positive control: apps/api/src/platform/outbox/writer.ts is a
// whole-file T-83 root, and the writer itself does only database work on the transaction it is given.
interface EventStore {
  insert(event: { type: string; aggregateId: string }): Promise<{ id: string }>;
}

export const outbox = {
  async publish(db: EventStore, event: { type: string; aggregateId: string }): Promise<{ id: string }> {
    return db.insert(event);
  },
};
