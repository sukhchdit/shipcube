import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';
import ts from 'typescript';

import {
  BRAND_KEYS,
  BRAND_NAME_MAX_LENGTH,
  BRAND_URL_KEYS,
  BRAND_URL_MAX_LENGTH,
  brandNameLength,
  isBrandName,
  isBrandUrl,
} from './brand-rules.js';
import { CONFIG_SCHEMA } from './schema.js';
import { BRAND_VALUE_SCHEMAS, webConfigSchema } from './web/web-schema.js';

// Jest runs from the repository root (rootDir of jest.config.ts).
const srcDir = resolve(process.cwd(), 'packages', 'config', 'src');

type Verdict = { accepted: true; value: unknown } | { accepted: false };

const joiVerdict = (key: (typeof BRAND_KEYS)[number], value: string): Verdict => {
  const result = CONFIG_SCHEMA[key].joi.validate(value, { convert: true });
  const converted: unknown = result.value;
  return result.error === undefined ? { accepted: true, value: converted } : { accepted: false };
};

const zodVerdict = (key: (typeof BRAND_KEYS)[number], value: string): Verdict => {
  const result = BRAND_VALUE_SCHEMAS[key].safeParse(value);
  return result.success ? { accepted: true, value: result.data } : { accepted: false };
};

const EMOJI = '😀';

const NAME_VECTORS: readonly [string, string, boolean][] = [
  ['empty', '', false],
  ['whitespace only', '   ', false],
  ['ordinary', 'Shipqube', true],
  ['40 characters', 'x'.repeat(BRAND_NAME_MAX_LENGTH), true],
  ['41 characters', 'x'.repeat(BRAND_NAME_MAX_LENGTH + 1), false],
  ['40 characters after trimming', ` ${'x'.repeat(BRAND_NAME_MAX_LENGTH)} `, true],
  ['surrounding spaces', '  Ship qube  ', true],
  ['unicode', 'Envíos Ñandú', true],
  // R2-m1 (Probe R3): lengths are code points on both sides, so astral characters count once.
  ['21 emoji (42 UTF-16 units)', EMOJI.repeat(21), true],
  ['40 emoji', EMOJI.repeat(BRAND_NAME_MAX_LENGTH), true],
  ['41 emoji', EMOJI.repeat(BRAND_NAME_MAX_LENGTH + 1), false],
  ['39 letters and an emoji', `${'x'.repeat(39)}${EMOJI}`, true],
  ['40 letters and an emoji', `${'x'.repeat(40)}${EMOJI}`, false],
  ['a decomposed accent counts as two code points', `${'x'.repeat(38)}é`, true],
  ['a lone surrogate', '\uD800', true],
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
  ['https URL with a fragment', 'https://cdn.example.org/logo.svg#dark', true],
  ['percent-encoded space', 'https://cdn.example.org/a%20b.svg', true],
  ['punycode host', 'https://xn--bcher-kva.example/logo.svg', true],
  ['IPv6 host with a port', 'https://[::1]:8443/logo.svg', true],
  ['relative path', 'logo.svg', false],
  ['path with a space', '/my logo.svg', false],
  ['backslash path', '/\\evil.example', false],
  ['over-long URL', `https://cdn.example.org/${'a'.repeat(BRAND_URL_MAX_LENGTH)}`, false],
  ['over-long path', `/${'a'.repeat(BRAND_URL_MAX_LENGTH)}`, false],
  // R2-m1 (Probe R3): every vector on which Joi `.uri()` and Zod `z.url()` used to disagree.
  ['upper-case scheme', 'HTTPS://cdn.example.org/logo.svg', false],
  ['space in the path', 'https://cdn.example.org/a b.svg', false],
  ['scheme without //', 'http:cdn.example.org/x', false],
  ['empty authority', 'https:///logo.svg', false],
  ['leading space', ' https://cdn.example.org/logo.svg', false],
  ['trailing space', 'https://cdn.example.org/logo.svg ', false],
  ['angle brackets in the query', 'https://cdn.example.org/logo.svg?x=<script>', false],
  ['braces', 'https://cdn.example.org/{x}', false],
  ['double quote', 'https://cdn.example.org/a"b', false],
  ['backtick', 'https://cdn.example.org/a`b', false],
  ['caret', 'https://cdn.example.org/a^b', false],
  ['pipe', 'https://cdn.example.org/a|b', false],
  ['IDN host (not punycode)', 'https://bücher.example/logo.svg', false],
  ['port out of range', 'https://cdn.example.org:99999/x', false],
  ['empty host with a port', 'http://:80/x', false],
  ['credentials', 'https://user:pw@cdn.example.org/logo.svg', false],
  ['backslash after the host', 'https://cdn.example.org\\logo.svg', false],
  ['malformed percent escape', 'https://cdn.example.org/%zz', false],
];

describe('BRAND_* parity: backend Joi and web Zod call the brand-rules.ts predicates (brief §3.3, AT-US-002-04)', () => {
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

  it('brandNameLength counts code points, not UTF-16 units', () => {
    expect(brandNameLength(EMOJI.repeat(3))).toBe(3);
    expect(brandNameLength('é')).toBe(2);
    expect(isBrandName('')).toBe(false);
  });
});

/** Fragments that broke parity before R2-m1 or sit on a boundary of the shared grammar. */
const ADVERSARIAL_PARTS = ['', ' ', '\t', 'HTTPS://', 'http:', 'https:///', '"', '<', '>', '{', '|', '^', '`', '\\', '%', '%2', 'ü', EMOJI];
const ADVERSARIAL_PORTS = ['', ':0', ':443', ':65535', ':65536', ':99999', ':'];

const brandUrlCandidates = fc.oneof(
  fc.webUrl({ withQueryParameters: true, withFragments: true }),
  fc.webUrl({ validSchemes: ['http', 'https', 'ftp', 'javascript'] }),
  fc
    .tuple(fc.constantFrom(...ADVERSARIAL_PARTS), fc.webUrl(), fc.constantFrom(...ADVERSARIAL_PARTS))
    .map(([prefix, url, suffix]) => `${prefix}${url}${suffix}`),
  fc
    .tuple(fc.constantFrom('http://', 'https://', 'HTTP://', 'http:'), fc.domain(), fc.constantFrom(...ADVERSARIAL_PORTS), fc.webPath())
    .map(([scheme, host, port, path]) => `${scheme}${host}${port}${path}`),
  fc.tuple(fc.constantFrom('/', '//', ''), fc.webPath(), fc.constantFrom(...ADVERSARIAL_PARTS)).map((parts) => parts.join('')),
  fc.string({ unit: 'grapheme', maxLength: 60 }),
  fc.string({ unit: 'binary', maxLength: 60 }),
);

const brandNameCandidates = fc.oneof(
  fc.string({ unit: 'grapheme', maxLength: BRAND_NAME_MAX_LENGTH + 5 }),
  fc.string({ unit: 'binary', maxLength: BRAND_NAME_MAX_LENGTH + 5 }),
  fc.string({ unit: 'grapheme-composite', maxLength: BRAND_NAME_MAX_LENGTH + 5 }),
  fc
    .tuple(fc.constantFrom('', ' ', ' ', '\n'), fc.integer({ min: 0, max: BRAND_NAME_MAX_LENGTH + 2 }), fc.constantFrom('x', EMOJI, 'é'))
    .map(([pad, count, unit]) => `${pad}${unit.repeat(count)}${pad}`),
);

describe('BRAND_* differential property: Joi and Zod verdicts are identical (R2-m1, AT-US-002-04 "rejected identically")', () => {
  it('property: every URL key gives the same verdict and value from Joi, Zod and the shared predicate', () => {
    fc.assert(
      fc.property(brandUrlCandidates, (value) => {
        for (const key of BRAND_URL_KEYS) {
          const joi = joiVerdict(key, value);
          expect(zodVerdict(key, value)).toEqual(joi);
          expect(joi.accepted).toBe(isBrandUrl(value));
        }
      }),
      { numRuns: 500 },
    );
  });

  it('property: BRAND_NAME gives the same verdict and value from Joi, Zod and the shared predicate', () => {
    fc.assert(
      fc.property(brandNameCandidates, (value) => {
        const joi = joiVerdict('BRAND_NAME', value);
        expect(zodVerdict('BRAND_NAME', value)).toEqual(joi);
        expect(joi.accepted).toBe(isBrandName(value.trim()));
      }),
      { numRuns: 500 },
    );
  });
});

const NON_LITERAL = '<non-literal>';

/**
 * Runtime module specifiers of one file, read from the TypeScript AST (R2-n1): static imports and re-exports
 * (type-only ones excluded), `import x = require()`, dynamic `import()` and `require()` calls. A non-literal
 * dynamic specifier is reported as `<non-literal>` so a test can refuse it.
 */
function runtimeSpecifiers(file: string): readonly string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const found: string[] = [];
  const add = (node: ts.Node | undefined): void => {
    found.push(node !== undefined && ts.isStringLiteralLike(node) ? node.text : NON_LITERAL);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword) add(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined && !node.isTypeOnly) add(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (!node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Runtime import specifiers of every module reachable from `entry` through relative imports. */
function runtimeImportGraph(entry: string): ReadonlyMap<string, readonly string[]> {
  const graph = new Map<string, readonly string[]>();
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (graph.has(file)) continue;
    const specifiers = runtimeSpecifiers(file);
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

const isZod = (specifier: string): boolean => specifier === 'zod' || specifier.startsWith('zod/');

describe('validator stacks stay apart (brief §3.3, D-ORCH-006 item 4)', () => {
  it('the scanner sees dynamic import, require, import-equals and re-exports, and skips type-only imports (R2-n1)', () => {
    const probe = join(srcDir, 'fixtures', 'import-scan-probe.ts.txt');
    expect(runtimeSpecifiers(probe)).toEqual(['zod', 'zod/mini', 'zod', 'zod', 'zod', NON_LITERAL, './x.js']);
  });

  it('the backend entry point (schema.ts and everything it reaches) never imports zod at run time', () => {
    const graph = runtimeImportGraph(join(srcDir, 'index.ts'));
    expect([...graph.keys()]).toEqual(expect.arrayContaining([join(srcDir, 'schema.ts'), join(srcDir, 'brand-rules.ts')]));
    const external = externalImports(graph);
    expect(external).toContain('joi');
    expect(external.filter(isZod)).toEqual([]);
    expect(external).not.toContain(NON_LITERAL);
    expect(external.filter((specifier) => specifier === 'module' || specifier === 'node:module')).toEqual([]);
  });

  it('the web entry point never imports joi or a node:* module, and brand-rules.ts imports nothing', () => {
    const external = externalImports(runtimeImportGraph(join(srcDir, 'web', 'index.ts')));
    expect(external).toEqual(['zod']);
    expect(runtimeImportGraph(join(srcDir, 'brand-rules.ts')).get(join(srcDir, 'brand-rules.ts'))).toEqual([]);
  });
});
