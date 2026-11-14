import { createRequire } from 'node:module';
import * as nodeModule from 'node:module';

declare const use: (value: unknown) => void;
declare const process: { getBuiltinModule(id: string): typeof nodeModule };

/** PR44-SEC-01: createRequire aliased, passed, returned, destructured, reached through import() and getBuiltinModule. */
const make = createRequire;
use(createRequire);
export const factory = (): unknown => createRequire;
const { createRequire: viaPattern } = nodeModule;
export const fromImport = async (): Promise<unknown> => (await import('node:module')).createRequire(import.meta.url)('node:util');
export const fromBuiltin = (): unknown => process.getBuiltinModule('node:module').createRequire(import.meta.url)('node:util');
export const computedResolve = (name: string): string => createRequire(import.meta.url).resolve(name);
export { make, viaPattern };
