import { createRequire } from 'node:module';

declare const module: { require(id: string): unknown };

const load = createRequire(import.meta.url);

/** PR32-SEC-07 (a): createRequire(url)(x), a createRequire alias and module.require(x) with a computed specifier. */
export const loadAll = (name: string): unknown[] => [createRequire(import.meta.url)(name), load(name), module.require(name)];
