interface RawClient {
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/**
 * D-ARCH-124 (fold 7 fixture "a quotes repository naming outbox_events fails"): a module repository names the SYSTEM
 * table of another module in raw SQL: plain, public.-qualified and upper-case, quoted, and in a DELETE.
 */
export const peek = (db: RawClient, id: string): Promise<unknown> => db.$queryRaw`SELECT id FROM outbox_events WHERE id = ${id}`;
export const peekQualified = (db: RawClient): Promise<unknown> => db.$queryRaw`SELECT count(*) FROM PUBLIC.OUTBOX_EVENTS`;
export const peekQuoted = (db: RawClient): Promise<unknown> => db.$queryRaw`SELECT count(*) FROM "public"."outbox_events"`;
export const purge = (db: RawClient, id: string): Promise<number> => db.$executeRaw`DELETE FROM outbox_events WHERE id = ${id}`;
