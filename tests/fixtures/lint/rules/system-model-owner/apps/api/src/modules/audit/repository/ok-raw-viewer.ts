interface RawClient {
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/** D-ARCH-124 positive control: the api audit module (the TASK-073 viewer) owns the audit tables too. */
export const page = (db: RawClient, after: string): Promise<unknown[]> =>
  db.$queryRaw<unknown[]>`SELECT id FROM audit_entries_2026_11 WHERE id > ${after}::uuid ORDER BY id LIMIT 50`;
