interface RawClient {
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * D-ARCH-124 positive control: a SYSTEM table name in a comment, in a string literal, as part of a longer name, or
 * quoted in another case is not a mention of the table.
 */
export const orders = (db: RawClient, kind: string): Promise<unknown> =>
  db.$queryRaw`SELECT id -- not outbox_events
    FROM orders /* audit_entries */ WHERE kind = ${kind} AND note <> 'audit_entries' AND label <> $tag$outbox_events$tag$
    AND audit_entries_count > 0 AND "AUDIT_ENTRIES" IS NOT NULL`;
