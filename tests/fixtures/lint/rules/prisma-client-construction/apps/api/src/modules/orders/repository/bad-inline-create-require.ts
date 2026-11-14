import { createRequire } from 'node:module';

type Constructor = new (options: object) => unknown;

/** PR #44 code review p8: an inline createRequire(u)(G) load of the generated client, then new PrismaClient(). */
const { PrismaClient } = createRequire(import.meta.url)('@platform/prisma/client') as { PrismaClient: Constructor };

export const client = new PrismaClient({});
