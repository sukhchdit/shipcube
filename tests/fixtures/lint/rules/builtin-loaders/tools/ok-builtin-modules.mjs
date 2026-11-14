import { builtinModules, createRequire, isBuiltin } from 'node:module';
import process from 'node:process';

/** PR44-SEC-14 positive control: the read-only node:module lookups, createRequire and the default process import stay legal. */
export const builtins = () => [builtinModules.length, isBuiltin('node:fs'), typeof createRequire, process.platform];
