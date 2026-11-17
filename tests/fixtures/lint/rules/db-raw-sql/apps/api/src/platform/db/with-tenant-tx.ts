interface RawClient {
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * PR44-SEC-05: the exact-file exemption of withTenantTx admits SET TRANSACTION READ ONLY (no finding) and nothing
 * else: SET TRANSACTION READ WRITE in the same file is still reported (one finding).
 */
export const readOnly = (tx: RawClient): Promise<unknown> => tx.$queryRaw`SET TRANSACTION READ ONLY`;
export const readWrite = (tx: RawClient): Promise<unknown> => tx.$queryRaw`SET TRANSACTION READ WRITE`;
