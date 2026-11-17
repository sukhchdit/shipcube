interface RawClient {
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/** D-ARCH-124 positive control (fold 7 "the audit store passes"): the audit package owns the audit tables. */
export const head = (db: RawClient, id: string): Promise<unknown[]> =>
  db.$queryRaw<unknown[]>`SELECT id FROM public.audit_entries WHERE stream_id = ${id} ORDER BY seq DESC LIMIT 1`;
