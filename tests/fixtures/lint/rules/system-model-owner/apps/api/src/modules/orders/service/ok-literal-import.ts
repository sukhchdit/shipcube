import { createRequire } from 'node:module';

/**
 * PR32-SEC-07 (a) positive control: literal (and no-substitution template) loads of an allowed module. Since
 * PR44-SEC-01 createRequire is legal only as createRequire(<url>).resolve(<literal>), which loads nothing.
 */
export const load = async (): Promise<unknown[]> => [
  await import('node:crypto'),
  await import(`node:os`),
  createRequire(import.meta.url).resolve('node:util'),
];
