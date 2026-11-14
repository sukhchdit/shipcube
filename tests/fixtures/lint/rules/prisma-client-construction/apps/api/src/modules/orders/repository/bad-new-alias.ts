import { createRequire } from 'node:module';

type Constructor = new (options: object) => unknown;

const req = createRequire(import.meta.url);

/** PR44-SEC-01 F17: the constructor taken by a member alias and by a destructuring alias, then constructed. */
const C = (req('@platform/prisma/client') as { PrismaClient: Constructor }).PrismaClient;
const { PrismaPg: A } = req('@prisma/adapter-pg') as { PrismaPg: Constructor };

export const client = new C({});
export const adapter = new A({});
