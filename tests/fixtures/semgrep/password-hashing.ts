// Semgrep test fixture for .semgrep/password-hashing.yml (PR2-SEC-02 residual forms, R2.4 table). Never executed.
import * as nodeModule from 'node:module';
import { createRequire } from 'node:module';
import { createRequire as makeLoader } from 'node:module';

// ruleid: platform.password-hashing.bcrypt-outside-hasher
import bcrypt from 'bcrypt';
// ruleid: platform.password-hashing.bcrypt-outside-hasher
import * as bcryptjs from 'bcryptjs';
// ruleid: platform.password-hashing.bcrypt-outside-hasher
import { hash } from '@node-rs/bcrypt';
// ruleid: platform.password-hashing.bcrypt-outside-hasher, platform.password-hashing.hasher-reexports-bcrypt
export { compare } from 'bcrypt-ts';
// ok: platform.password-hashing.bcrypt-outside-hasher
import { z } from 'zod';

export async function forms(name: string, holder: Record<string, (id: string) => unknown>): Promise<unknown[]> {
  // R2.4 form 1: `$R = createRequire(...)` ... `$R("bcrypt")`, any binding name.
  const load = createRequire(import.meta.url);
  // ruleid: platform.password-hashing.bcrypt-outside-hasher
  const viaBinding = load('bcrypt');
  // R2.4 form 1, aliased import: `import { createRequire as $C }`.
  const aliased = makeLoader(import.meta.url);
  // ruleid: platform.password-hashing.bcrypt-outside-hasher
  const viaAlias = aliased('bcryptjs');
  // R2.4 form 2: `$X.createRequire(...)("bcrypt")`.
  // ruleid: platform.password-hashing.bcrypt-outside-hasher
  const viaNamespace = nodeModule.createRequire(import.meta.url)('bcrypt');
  // R2.4 form 3: `Module._load("bcrypt")`.
  // ruleid: platform.password-hashing.bcrypt-outside-hasher
  const viaLoad = (nodeModule.Module as unknown as { _load: (id: string) => unknown })._load('bcrypt');
  // R2.4 form 4: `require.call(...)` / `require.apply(...)`.
  // ruleid: platform.password-hashing.bcrypt-outside-hasher
  const viaCall = load.call(undefined, 'bcrypt');
  // ruleid: platform.password-hashing.dynamic-module-load
  const viaRequireCall = require.call(undefined, name);
  // ruleid: platform.password-hashing.dynamic-module-load
  const viaRequireApply = require.apply(undefined, [name]);
  // R2.4 form 5: `$O["require"]("bcrypt")`.
  // ruleid: platform.password-hashing.bcrypt-outside-hasher
  const viaIndex = holder['require']('bcrypt');
  // Literal dynamic import of the family.
  // ruleid: platform.password-hashing.bcrypt-outside-hasher
  const viaImport = await import('bcrypt');
  // R2.4 form 6: non-literal import($E) / require($E) / loader($E).
  // ruleid: platform.password-hashing.dynamic-module-load
  const computedImport = await import(name);
  // ruleid: platform.password-hashing.dynamic-module-load
  const computedRequire = require(`./${name}`);
  // ruleid: platform.password-hashing.dynamic-module-load
  const computedLoader = load(name);
  // ruleid: platform.password-hashing.dynamic-module-load
  const computedIndex = holder['require'](name);
  // ruleid: platform.password-hashing.dynamic-module-load
  const computedLoad = (nodeModule.Module as unknown as { _load: (id: string) => unknown })._load(name);
  // ruleid: platform.password-hashing.bcrypt-outside-hasher, platform.password-hashing.dynamic-module-load
  const requireCallLiteral = require.call(undefined, 'bcrypt');
  // ruleid: platform.password-hashing.bcrypt-outside-hasher, platform.password-hashing.dynamic-module-load
  const requireApplyLiteral = require.apply(undefined, ['bcrypt']);
  // ok: platform.password-hashing.dynamic-module-load
  const literalImport = await import('./sibling.js');
  // ok: platform.password-hashing.bcrypt-outside-hasher
  const unrelated = load('argon2-free-module');
  return [viaBinding, viaAlias, viaNamespace, viaLoad, viaCall, viaRequireCall, viaRequireApply, viaIndex, viaImport];
}

// R2.4 forms H5/H6 (the hasher module re-exports the primitive), scoped to the hasher path by the rule.
// ruleid: platform.password-hashing.hasher-reexports-bcrypt
export { bcrypt };
// ruleid: platform.password-hashing.hasher-reexports-bcrypt
export default bcryptjs;
// ruleid: platform.password-hashing.hasher-reexports-bcrypt
export const primitive = hash;
// ok: platform.password-hashing.hasher-reexports-bcrypt
export const port = { hash: (value: string) => value, z };
