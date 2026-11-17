/**
 * PR44-SEC-14 (020-D): process.getBuiltinModule (on process, on globalThis.process, destructured), process.binding,
 * process._linkedBinding and process.dlopen load built-in or native modules past every import control.
 */
const { getBuiltinModule: builtin } = process;
export const http = (): unknown => process.getBuiltinModule('node:http');
export const childProcess = (): unknown => globalThis.process.getBuiltinModule('node:child_process');
export const net = (): unknown => builtin('node:net');
export const fs = (): unknown => process.binding('fs');
export const linked = (): unknown => process._linkedBinding('x');
export const native = (target: { exports: unknown }): void => process.dlopen(target, 'addon.node');
