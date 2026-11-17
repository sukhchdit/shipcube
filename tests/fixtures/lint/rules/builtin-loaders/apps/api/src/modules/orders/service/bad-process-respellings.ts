type Load = (id: string) => unknown;
type Members = Record<string, Load>;

declare const name: 'getBuiltinModule';

/**
 * PR54-SEC-03: the members of process reached other than by a static name (platform/static-module-specifier
 * `processMember`), and binding through globalThis.process and an alias (no-restricted-properties, property-only).
 */
// 5. A computed key, an alias, Reflect and Object.
const p = process;
export const concatenated = (): unknown => (process as unknown as Members)['getBuiltin' + 'Module']?.('module');
export const viaConstName = (): unknown => (process as unknown as Members)[name]?.('module');
export const viaGlobalName = (): unknown => (globalThis['process'] as unknown as Members)[name]?.('module');
export const viaReflect = (): unknown => (Reflect.get(process, 'getBuiltinModule') as Load)('module');
export const viaDescriptor = (): unknown => (Object.getOwnPropertyDescriptor(process, 'getBuiltinModule')?.value as Load)('module');
export const viaDefault = (q = process): unknown => q.binding('fs');
const { ...rest } = process;

// 6. binding on globalThis.process and on an alias.
export const viaGlobal = (): unknown => globalThis.process.binding('fs');
export const viaAlias = (): unknown => p.binding('fs');
export const all = (): unknown => rest;
