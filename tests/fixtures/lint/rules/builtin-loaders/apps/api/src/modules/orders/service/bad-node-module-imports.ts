import nodeModule, { Module, register } from 'node:module';
import * as moduleNamespace from 'module';
import { getBuiltinModule } from 'node:process';

/**
 * PR44-SEC-14 (020-D): node:module gives only createRequire, builtinModules and isBuiltin. Module (Module._load),
 * register (a resolve hook), the default import and a namespace import are refused, and so are the node:process
 * named exports that load a built-in module.
 */
export const loaders = (): unknown[] => [nodeModule, Module, register, moduleNamespace, getBuiltinModule('node:http')];
