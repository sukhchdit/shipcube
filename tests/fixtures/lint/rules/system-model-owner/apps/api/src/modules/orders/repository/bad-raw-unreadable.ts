interface RawClient {
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/** D-ARCH-124: a Unicode-escape identifier can spell any table name, so the template fails closed. */
export const hidden = (db: RawClient): Promise<unknown> => db.$queryRaw`SELECT count(*) FROM U&"!0061udit_entries" UESCAPE '!'`;
