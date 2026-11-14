import { createRequire as makeRequire } from 'node:module';
import * as nodeModule from 'node:module';

const load = makeRequire(import.meta.url);

/** D-ARCH-111 (h): createRequire through an import alias (called directly and kept in a variable) and a namespace member. */
export const loadAll = (name: string): unknown[] => [
  makeRequire(import.meta.url)(name),
  load(name),
  nodeModule.createRequire(import.meta.url)(name),
];
