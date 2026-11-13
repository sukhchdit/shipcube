import * as https from 'node:https';

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

// Nested closure inside the callback: still inside the transaction.
export const ping = (ctx: unknown, url: string): Promise<unknown> =>
  withTenantTx(ctx, async () => new Promise((resolve) => https.get(url, resolve)));
