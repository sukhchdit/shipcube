import Stripe from 'stripe';

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

export function makeCharger(apiKeyRef: string) {
  const stripe = new Stripe(apiKeyRef);
  return (ctx: unknown, amount: number): Promise<unknown> =>
    withTenantTx(ctx, async () => stripe.paymentIntents.create({ amount, currency: 'usd' }));
}
