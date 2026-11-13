import { createRequire } from 'node:module';

/** PR32-SEC-07 (a) positive control: literal (and no-substitution template) loads of an allowed module. */
export const load = async (): Promise<unknown[]> => [
  await import('node:crypto'),
  await import(`node:os`),
  createRequire(import.meta.url)('node:util'),
];
