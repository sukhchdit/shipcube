interface Db {
  withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;
}
interface OutboundHttp {
  post(url: string): Promise<unknown>;
}

export class OrderSync {
  constructor(
    private readonly db: Db,
    private readonly outboundHttp: OutboundHttp,
  ) {}

  push(ctx: unknown, url: string): Promise<unknown> {
    return this.db.withTenantTx(ctx, async () => this.outboundHttp.post(url));
  }
}
