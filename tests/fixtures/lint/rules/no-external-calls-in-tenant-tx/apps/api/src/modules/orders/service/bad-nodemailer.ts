import nodemailer from 'nodemailer';

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

export const send = (ctx: unknown, to: string): Promise<unknown> =>
  withTenantTx(ctx, async () => nodemailer.createTransport({}).sendMail({ to }));
