import * as nm from 'node:module';

declare const key: 'createRequire';

/** PR44-SEC-10 (fail closed): a computed destructuring key on the node:module namespace that is not a static string. */
const { [key]: make } = nm;

export const load = (): unknown => make(import.meta.url)('node:util');
