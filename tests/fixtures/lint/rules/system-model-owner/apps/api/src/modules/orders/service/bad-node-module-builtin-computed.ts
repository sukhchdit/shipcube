declare const process: { getBuiltinModule(id: string): Record<string, (url: string) => (id: string) => unknown> };

/** PR44-SEC-10 (fail closed): a computed member of process.getBuiltinModule('module') whose key is not a static string. */
export const load = (key: string): unknown => process.getBuiltinModule('module')[key]?.(import.meta.url)('node:util');
