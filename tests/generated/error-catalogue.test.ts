/**
 * Error catalogue versus the contract and the code (US-036, REQ-API-005, api/README.md §3 and §11; TASK-036).
 *
 * - Parity: the catalogue codes, statuses and titles equal the named examples of the shared problem responses
 *   (`components/responses`) of openapi.yaml, and each example's `type` is the URI derived from its code. The only
 *   catalogue code without an example is the framework-level METHOD_NOT_ALLOWED (api/README.md §3: framework errors
 *   apply to every path and are not repeated per operation).
 * - Thrown codes (AT-US-036-04): every `new AppError('<CODE>')` in the production sources of apps/ and packages/ names a
 *   catalogue code. The compiler already refuses an unknown literal (`ErrorCode`); this scan also catches a cast or a
 *   JavaScript caller and names the code.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { beforeAll, describe, expect, it } from '@jest/globals';
import { ERROR_CATALOGUE, isErrorCode } from '@platform/shared';

import { DEFAULT_PROBLEM_TYPE_BASE } from '../../apps/api/src/platform/errors/problem.js';
import { loadContract, type OpenApiDocument, REPO_ROOT } from '../../tools/openapi/contract.js';

/** Catalogue codes that are framework-level only (no shared response example by design). */
const FRAMEWORK_ONLY_CODES: ReadonlySet<string> = new Set(['METHOD_NOT_ALLOWED']);

interface ExampleProblem {
  readonly response: string;
  readonly code: unknown;
  readonly status: unknown;
  readonly title: unknown;
  readonly type: unknown;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null;

/** Every named example of the problem+json content of `components/responses`. */
function responseExamples(doc: OpenApiDocument): ExampleProblem[] {
  const responses = isRecord(doc.components?.['responses']) ? doc.components['responses'] : {};
  return Object.entries(responses).flatMap(([response, value]) => {
    const content = isRecord(value) && isRecord(value['content']) ? value['content'] : {};
    const problem = content['application/problem+json'];
    const examples = isRecord(problem) && isRecord(problem['examples']) ? problem['examples'] : {};
    return Object.values(examples).flatMap((example) => {
      const body = isRecord(example) && isRecord(example['value']) ? example['value'] : undefined;
      return body === undefined ? [] : [{ response, code: body['code'], status: body['status'], title: body['title'], type: body['type'] }];
    });
  });
}

/** Disagreements between the catalogue and the shared response examples; [] when they are equal. */
function catalogueParityProblems(
  examples: readonly ExampleProblem[],
  catalogue: Readonly<Record<string, { readonly status: number; readonly title: string }>>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const example of examples) {
    const code = String(example.code);
    if (seen.has(code)) problems.push(`${code}: more than one shared response example`);
    seen.add(code);
    const entry = catalogue[code];
    if (entry === undefined) {
      problems.push(`${code}: example in components/responses/${example.response} is not in the error catalogue`);
      continue;
    }
    if (example.status !== entry.status)
      problems.push(`${code}: example status ${String(example.status)}, catalogue ${String(entry.status)}`);
    if (example.title !== entry.title)
      problems.push(`${code}: example title ${JSON.stringify(example.title)}, catalogue ${JSON.stringify(entry.title)}`);
    if (example.type !== `${DEFAULT_PROBLEM_TYPE_BASE}${code}`)
      problems.push(`${code}: example type ${String(example.type)} is not derived from the code`);
  }
  for (const code of Object.keys(catalogue)) {
    if (!seen.has(code) && !FRAMEWORK_ONLY_CODES.has(code)) problems.push(`${code}: catalogue code without a shared response example`);
  }
  return problems;
}

/** `new AppError('<CODE>'` with a string literal first argument; the code group may be any quoted text. */
const APP_ERROR_LITERAL = /\bnew\s+AppError\s*\(\s*(['"`])([^'"`\n]*)\1/g;

/** The codes thrown through `new AppError('<CODE>')` in `source` that are not catalogued, in order of appearance. */
function uncataloguedThrows(source: string): string[] {
  return [...source.matchAll(APP_ERROR_LITERAL)].map((match) => match[2] ?? '').filter((code) => !isErrorCode(code));
}

const SOURCE_ROOTS = ['apps', 'packages'];
const SKIPPED_DIRS: ReadonlySet<string> = new Set(['node_modules', 'dist', 'build', 'coverage', '.react-router', 'generated']);

/** Production TypeScript sources under apps/ and packages/ (tests, declarations and build output excluded). */
function productionSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : productionSources(path);
    const isSource = /\.(?:ts|tsx|mts)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name);
    return isSource ? [path] : [];
  });
}

describe('error catalogue versus openapi.yaml and the thrown codes (US-036, api/README.md §11)', () => {
  let doc: OpenApiDocument;

  beforeAll(async () => {
    doc = await loadContract();
  });

  it('[AT-US-036-01] every catalogue code has a shared problem example with its status, title and the type URI derived from the code', () => {
    const examples = responseExamples(doc);
    expect(examples.length).toBeGreaterThan(70);
    expect(catalogueParityProblems(examples, ERROR_CATALOGUE)).toEqual([]);
  });

  it('[AT-US-036-01] the parity check names a missing example, a changed status or title, and an underived type', () => {
    const base = { response: 'Conflict', code: 'CONFLICT', status: 409, title: 'Conflict', type: `${DEFAULT_PROBLEM_TYPE_BASE}CONFLICT` };
    const catalogue = { CONFLICT: { status: 409, title: 'Conflict' }, NOT_FOUND: { status: 404, title: 'Not found' } };
    expect(catalogueParityProblems([base], catalogue)).toEqual(['NOT_FOUND: catalogue code without a shared response example']);
    expect(
      catalogueParityProblems(
        [
          { ...base, status: 422, title: 'Clash', type: 'https://example.invalid/CONFLICT' },
          {
            ...base,
            response: 'NotFound',
            code: 'NOT_FOUND',
            status: 404,
            title: 'Not found',
            type: `${DEFAULT_PROBLEM_TYPE_BASE}NOT_FOUND`,
          },
          { ...base, code: 'MY_NEW_ERROR', type: `${DEFAULT_PROBLEM_TYPE_BASE}MY_NEW_ERROR` },
        ],
        catalogue,
      ),
    ).toEqual([
      'CONFLICT: example status 422, catalogue 409',
      'CONFLICT: example title "Clash", catalogue "Conflict"',
      'CONFLICT: example type https://example.invalid/CONFLICT is not derived from the code',
      'MY_NEW_ERROR: example in components/responses/Conflict is not in the error catalogue',
    ]);
  });

  it('[AT-US-036-04] a service that throws an uncatalogued code fails the catalogue test, naming the code', () => {
    const service = [
      "throw new AppError('NOT_FOUND');",
      "throw new AppError('MY_NEW_ERROR' as ErrorCode, { detail: 'x' });",
      'throw new AppError(\n  "CONFLICT",\n);',
    ].join('\n');
    expect(uncataloguedThrows(service)).toEqual(['MY_NEW_ERROR']);
  });

  it('[AT-US-036-04] every AppError the production sources of apps/ and packages/ throw names a catalogue code', () => {
    const files = SOURCE_ROOTS.flatMap((root) => productionSources(join(REPO_ROOT, root)));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.flatMap((file) =>
      uncataloguedThrows(readFileSync(file, 'utf8')).map((code) => `${relative(REPO_ROOT, file).replaceAll('\\', '/')}: ${code}`),
    );
    expect(offenders).toEqual([]);
  });
});
