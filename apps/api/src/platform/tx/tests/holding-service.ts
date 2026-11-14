/**
 * The defect the T-83 runtime twin exists for (D-ARCH-106 (6); TASK-020 part 020-C (e)): a service in ANOTHER file
 * than its route, without a transaction-handle type on its parameter (so neither R2/R3 nor R6 of the lexical lint
 * reaches it), that keeps the handler's transaction open across a carrier call. Never imported by production code.
 */

/** The two shapes the service uses; structural, so the lint's type-name root (R6) does not apply. */
export interface Reader {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}
export interface Carrier {
  rate(shipmentId: string, signal?: AbortSignal): Promise<{ amount: number }>;
}

/** Reads, calls the carrier while the transaction stays open, then reads again: the twin must make this fail. */
export async function rateWhileHolding(db: Reader, carrier: Carrier, shipmentId: string): Promise<{ amount: number }> {
  await db.$queryRaw`SELECT 1`;
  const rate = await carrier.rate(shipmentId);
  await db.$queryRaw`SELECT 1`;
  return rate;
}
