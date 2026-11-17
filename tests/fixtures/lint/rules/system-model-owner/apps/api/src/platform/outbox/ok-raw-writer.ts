interface RawClient {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/** D-ARCH-124 positive control (fold 7 "the outbox writer passes"): platform/outbox owns outbox_events. */
export const enqueue = (db: RawClient, id: string): Promise<number> => db.$executeRaw`INSERT INTO outbox_events (id) VALUES (${id})`;
