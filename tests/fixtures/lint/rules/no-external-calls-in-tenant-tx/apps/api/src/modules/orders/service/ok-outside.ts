import { Queue } from 'bullmq';
import Redis from 'ioredis';
import nodemailer from 'nodemailer';
import { setTimeout as sleep } from 'node:timers/promises';

declare function withTenantTx<T>(ctx: unknown, fn: (db: { find(id: string): Promise<unknown> }) => Promise<T>): Promise<T>;
declare function runLater(fn: () => Promise<unknown>): void;

const queue = new Queue('labels');
const cache = new Redis();

interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

// The same calls before and after the transaction, and inside a callback that is not a withTenantTx callback.
export async function book(deps: Deps, ctx: unknown, id: string): Promise<unknown> {
  await cache.get(id);
  await sleep(10);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const order = await withTenantTx(ctx, async (db) => db.find(id));
  await queue.add('label', { id });
  await deps.queue.add('label', { id });
  await nodemailer.createTransport({}).sendMail({ to: id });
  runLater(async () => queue.add('retry', { id }));
  return order;
}
