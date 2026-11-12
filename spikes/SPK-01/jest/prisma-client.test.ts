import { describe, expect, it } from '@jest/globals';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../spikes/SPK-01/prisma/generated/client.js';

describe('SPK-01 Prisma 7 client under Jest', () => {
  it('queries PG 18 through adapter-pg', async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env['SPIKE_DATABASE_URL'] ?? '' }) });
    expect(await prisma.spikeHello.count()).toBeGreaterThan(0);
    await prisma.$disconnect();
  });
});
