import { Prisma } from '@prisma/client';

/** PR11-SEC-17 a: the Prisma namespace through `?:` and `??`; the result is an untracked alias. */
export const pick = (flag: boolean, other: unknown): unknown => (flag ? Prisma : other);
export const fallback = (other: unknown): unknown => other ?? Prisma;
