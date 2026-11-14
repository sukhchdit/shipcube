import * as nm from 'node:module';

/** PR44-SEC-10 (fail closed): a computed member of the node:module namespace whose key is not a static string. */
export const load = (key: 'createRequire'): unknown => nm[key](import.meta.url)('node:util');
