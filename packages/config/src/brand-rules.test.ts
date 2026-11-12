import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { BRAND_KEYS, BRAND_NAME_MAX_LENGTH, BRAND_URL_KEYS, BRAND_URL_MAX_LENGTH } from './brand-rules.js';
import { CONFIG_SCHEMA } from './schema.js';
import { BRAND_VALUE_SCHEMAS, webConfigSchema } from './web/web-schema.js';

// Jest runs from the repository root (rootDir of jest.config.ts).
const srcDir = resolve(process.cwd(), 'packages', 'config', 'src');

type Verdict = { accepted: true; value: unknown } | { accepted: false };

const joiVerdict = (key: (typeof BRAND_KEYS)[number], value: string): Verdict => {
  const result = CONFIG_SCHEMA[key].joi.validate(value, { convert: true });
  return result.error === undefined ? { accepted: true, value: result.value as unknown } : { accepted: false };
};

const zodVerdict = (key: (typeof BRAND_KEYS)[number], value: string): Verdict => {
  const result = BRAND_VALUE_SCHEMAS[key].safeParse(value);
  return result.success ? { accepted: true, value: result.data } : { accepted: false };
};

const NAME_VECTORS: readonly [string, string, boolean][] = [
  ['empty', '', false],
  ['whitespace only', '   ', false],
  ['ordinary', 'Shipqube', true],
  ['40 characters', 'x'.repeat(BRAND_NAME_MAX_LENGTH), true],
  ['41 characters', 'x'.repeat(BRAND_NAME_MAX_LENGTH + 1), false],
  ['40 characters after trimming', ` ${'x'.repeat(BRAND_NAME_MAX_LENGTH)} `, true],
  ['surrounding spaces', '  Ship qube  ', true],
  ['unicode', 'Envíos Ñandú', true],
];

const URL_VECTORS: readonly [string, string, boolean][] = [
  ['empty', '', false],
  ['root-relative path', '/logo.svg', true],
  ['root path', '/', true],
  ['nested path', '/brand/logo-dark.v2.svg', true],
  ['protocol-relative URL', '//evil.example/logo.svg', false],
  ['javascript: URL', 'javascript:alert(1)', false],
  ['data: URL', 'data:image/svg+xml;base64,PHN2Zz4=', false],
  ['file: URL', 'file:///etc/passwd', false],
  ['ftp: URL', 'ftp://cdn.example.org/logo.svg', false],
  ['https URL', 'https://cdn.example.org/logo.svg', true],
  ['http URL', 'http://localhost:8080/logo.svg', true],
  ['https URL with query', 'https://cdn.example.org/logo.svg?v=2', true],
  ['relative path', 'logo.svg', false],
  ['path with a space', '/my logo.svg', false],
  ['backslash path', '/\\evil.example', false],
  ['over-long URL', `https://cdn.example.org/${'a'.repeat(BRAND_URL_MAX_LENGTH)}`, false],
  ['over-long path', `/${'a'.repeat(BRAND_URL_MAX_LENGTH)}`, false],
];

describe('BRAND_* parity: backend Joi and web Zod built from brand-rules.ts (brief §3.3, AT-US-002-04)', () => {
  it('the backend schema and the web schema cover the same BRAND_* keys', () => {
    for (const key of BRAND_KEYS) {
      expect(CONFIG_SCHEMA[key].sensitivity).toBe('public');
      expect(Object.keys(webConfigSchema.shape)).toContain(key);
    }
    expect(Object.keys(BRAND_VALUE_SCHEMAS)).toEqual([...BRAND_KEYS]);
  });

  it.each(NAME_VECTORS)('[AT-US-002-04] BRAND_NAME %s: same verdict and value from Joi and Zod', (_label, value, accepted) => {
    const joi = joiVerdict('BRAND_NAME', value);
    expect(joi.accepted).toBe(accepted);
    expect(zodVerdict('BRAND_NAME', value)).toEqual(joi);
  });

  it.each(BRAND_URL_KEYS.flatMap((key) => URL_VECTORS.map(([label, value, accepted]) => [key, label, value, accepted] as const)))(
    '[AT-US-002-04] %s %s: same verdict and value from Joi and Zod',
    (key, _label, value, accepted) => {
      const joi = joiVerdict(key, value);
      expect(joi.accepted).toBe(accepted);
      expect(zodVerdict(key, value)).toEqual(joi);
    },
  );
});

const IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^;'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

/** Runtime (non-type) import specifiers of every module reachable from `entry` through relative imports. */
function runtimeImportGraph(entry: string): ReadonlyMap<string, readonly string[]> {
  const graph = new Map<string, readonly string[]>();
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (graph.has(file)) continue;
    const specifiers = [...readFileSync(file, 'utf8').matchAll(IMPORT)].map((match) => match[1] ?? '');
    graph.set(file, specifiers);
    for (const specifier of specifiers.filter((s) => s.startsWith('.'))) {
      const target = join(dirname(file), specifier.replace(/\.js$/, '.ts'));
      expect(existsSync(target)).toBe(true);
      pending.push(target);
    }
  }
  return graph;
}

const externalImports = (graph: ReadonlyMap<string, readonly string[]>): readonly string[] =>
  [...new Set([...graph.values()].flat().filter((specifier) => !specifier.startsWith('.')))].sort();

describe('validator stacks stay apart (brief §3.3, D-ORCH-006 item 4)', () => {
  it('the backend entry point (schema.ts and everything it reaches) never imports zod at run time', () => {
    const graph = runtimeImportGraph(join(srcDir, 'index.ts'));
    expect([...graph.keys()]).toEqual(expect.arrayContaining([join(srcDir, 'schema.ts'), join(srcDir, 'brand-rules.ts')]));
    const external = externalImports(graph);
    expect(external).toContain('joi');
    expect(external.filter((specifier) => specifier === 'zod' || specifier.startsWith('zod/'))).toEqual([]);
    expect(readFileSync(join(srcDir, 'schema.ts'), 'utf8')).not.toMatch(/from 'zod'/);
  });

  it('the web entry point never imports joi or a node:* module, and brand-rules.ts imports nothing', () => {
    const external = externalImports(runtimeImportGraph(join(srcDir, 'web', 'index.ts')));
    expect(external).toEqual(['zod']);
    expect(runtimeImportGraph(join(srcDir, 'brand-rules.ts')).get(join(srcDir, 'brand-rules.ts'))).toEqual([]);
  });
});
