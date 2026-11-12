import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/client.js';

const url = process.env['SPIKE_DATABASE_URL'];
if (!url) throw new Error('SPIKE_DATABASE_URL is required');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const started = performance.now();
const [{ version }] = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`;
await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS spike_hello (id uuid PRIMARY KEY, message text NOT NULL)');
const row = await prisma.spikeHello.create({ data: { message: 'hello from Prisma 7 + adapter-pg' } });
const count = await prisma.spikeHello.count();
const native = await prisma.$queryRaw<Array<{ v: string }>>`SELECT uuidv7()::text AS v`;
await prisma.$disconnect();
console.log(
  JSON.stringify({ version, created: row, count, nativeUuidv7: native[0]?.v, ms: Math.round(performance.now() - started) }, null, 2),
);
