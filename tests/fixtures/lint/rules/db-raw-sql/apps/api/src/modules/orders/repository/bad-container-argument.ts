import { Prisma } from '@prisma/client';

/** PR11-SEC-17 a: the Prisma namespace passed as an argument; the callee could read `raw` from it unseen. */
export const leak = (sink: (value: unknown) => void): void => {
  sink(Prisma);
};
