interface RawClient {
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/**
 * D-ARCH-124 (fold 7 fixture "a module file naming audit_entries fails"): a monthly partition counts as its table, and
 * one template naming two SYSTEM tables is reported once per table.
 */
export const history = (db: RawClient, id: string): Promise<unknown[]> =>
  db.$queryRaw<unknown[]>`SELECT e.id FROM audit_entries_2026_11 AS e WHERE e.entity_id = ${id}`;
export const vaultJoin = (db: RawClient, id: string): Promise<number> =>
  db.$executeRaw`UPDATE audit_entries SET id = id FROM audit_pii_vault v WHERE v.entry_id = audit_entries.id AND v.id = ${id}`;
