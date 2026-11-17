interface RawClient {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/**
 * PR44-SEC-05 (020-D): statements that change the pooled session (they outlive the transaction and the request), and
 * SET TRANSACTION READ ONLY outside withTenantTx.
 */
export const shapes = (db: RawClient): Promise<number>[] => [
  db.$executeRaw`SET search_path TO elsewhere, public`,
  db.$executeRaw`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`,
  db.$executeRaw`RESET ALL`,
  db.$executeRaw`DISCARD ALL`,
  db.$executeRaw`LISTEN changes`,
  db.$executeRaw`NOTIFY changes`,
  db.$executeRaw`SET TRANSACTION READ ONLY`,
];
