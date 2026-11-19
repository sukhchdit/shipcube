/**
 * Error catalogue versus the contract and the code (US-036, REQ-API-005, api/README.md §3 and §11; TASK-036).
 *
 * - Parity: the catalogue codes, statuses and titles equal the named examples of the shared problem responses
 *   (`components/responses`) of openapi.yaml, and each example's `type` is the URI derived from its code. The only
 *   catalogue code without an example is the framework-level METHOD_NOT_ALLOWED (api/README.md §3: framework errors
 *   apply to every path and are not repeated per operation).
 * - Thrown codes (AT-US-036-04): every `new AppError('<CODE>')` in the production sources of apps/ and packages/ names a
 *   catalogue code. The compiler already refuses an unknown literal (`ErrorCode`); this scan also catches a cast or a
 *   JavaScript caller and names the code. The scan also reads the SCREAMING_SNAKE string literals passed to
 *   `new <Name>Error(` and `super(` (inside a class that extends Error, AppError or another *Error) so a domain error
 *   class that carries a literal code is checked (TASK-292, PR #63 review R1-m2): such a code must be a catalogue
 *   code, a code README §11 lists under "Codes that are not HTTP problem codes", or belong to a class in
 *   EXEMPT_ERROR_CLASSES. It is a regex scan: only a literal first argument is seen (not a variable, a computed value
 *   or an options object), and comments are not stripped.
 * - README §11 (TASK-292, PR #63 review R1-m1): the code and HTTP status of every row of the error-code table equal
 *   the catalogue in both directions, so the table cannot drift from the code.
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

/** README §11 error-code table rows: a back-quoted code, then a three-digit HTTP status (`| `CODE` | 404 | ...`). */
const README_ROW = /^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|\s*(\d{3})\s*\|/;
const README_PATH = join(REPO_ROOT, 'docs', '03-architecture', 'api', 'README.md');
const SECTION_END = /^(?:##\s|###\s|---\s*$)/;

/** The lines of one README section: after the heading matching `start`, up to (excluding) the next heading or rule. */
function sectionLines(readme: string, start: RegExp): string[] {
  const lines = readme.split(/\r?\n/);
  const from = lines.findIndex((line) => start.test(line));
  if (from < 0) return [];
  const rest = lines.slice(from + 1);
  const length = rest.findIndex((line) => SECTION_END.test(line));
  return length < 0 ? rest : rest.slice(0, length);
}

/** The table rows (code and status) of README §11, in order. */
function readmeTableRows(readme: string): Array<{ readonly code: string; readonly status: number }> {
  return sectionLines(readme, /^##\s+11\.\s/).flatMap((line) => {
    const match = README_ROW.exec(line);
    return match === null ? [] : [{ code: match[1] ?? '', status: Number(match[2]) }];
  });
}

/** Disagreements between the README §11 table and the catalogue (code and status, both directions); [] when equal. */
function readmeTableProblems(readme: string, catalogue: Readonly<Record<string, { readonly status: number }>>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const row of readmeTableRows(readme)) {
    if (seen.has(row.code)) problems.push(`${row.code}: more than one README §11 table row`);
    seen.add(row.code);
    const entry = catalogue[row.code];
    if (entry === undefined) problems.push(`${row.code}: README §11 row is not in the error catalogue`);
    else if (entry.status !== row.status)
      problems.push(`${row.code}: README §11 status ${String(row.status)}, catalogue ${String(entry.status)}`);
  }
  for (const code of Object.keys(catalogue)) {
    if (!seen.has(code)) problems.push(`${code}: catalogue code without a README §11 table row`);
  }
  return problems;
}

/** SCREAMING_SNAKE codes README §11 lists in the "Values" column of "Codes that are not HTTP problem codes". */
function readmeNonProblemCodes(readme: string): ReadonlySet<string> {
  const lines = sectionLines(readme, /^###\s+Codes that are not HTTP problem codes\s*$/);
  const codes = lines.flatMap((line) => {
    const values = line.startsWith('|') ? (line.split('|')[2] ?? '') : '';
    return [...values.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((match) => match[1] ?? '');
  });
  return new Set(codes);
}

/**
 * Infrastructure error classes whose literal codes never reach an HTTP problem body (the error handler maps them to
 * INTERNAL_ERROR or SERVICE_UNAVAILABLE, or they surface at start-up or in a worker only), so their codes are not
 * catalogue or README §11 codes by design. The exemption is by class and is a review point: a new domain error class
 * that carries a code is not listed here and must use a catalogue code or add its codes to README §11 "Codes that are
 * not HTTP problem codes". Whether a class types its codes as a closed union is not the criterion (SecretFileError's
 * `code` is a plain string).
 */
const EXEMPT_ERROR_CLASSES: ReadonlySet<string> = new Set([
  'AuditWriteError', // packages/audit: write-failure kinds (typed union)
  'ObjectStorageError', // apps/api platform/storage: object-storage kinds (typed union)
  'SecretFileError', // packages/config: start-up only, SECRET_FILE_* or errno-style codes (string)
  'NonRetryableError', // apps/worker platform/queues: NonRetryableReason (typed union), worker only
]);

/** `new <Name>Error('<CODE>'`: a named error class (not AppError, scanned above) and a SCREAMING_SNAKE first argument. */
const DOMAIN_ERROR_NEW = /\bnew\s+(?!AppError\b)(\w+Error)\s*\(\s*(['"`])([A-Z][A-Z0-9_]+)\2/g;
/** `class <Name> extends <Parent>` headers, to know which class a `super(` belongs to. */
const CLASS_HEADER = /\bclass\s+(\w+)\s+extends\s+(\w+)/g;
const SUPER_LITERAL = /\bsuper\s*\(\s*(['"`])([A-Z][A-Z0-9_]+)\1/g;

interface DomainErrorCode {
  readonly errorClass: string;
  readonly code: string;
}

/** The SCREAMING_SNAKE codes passed to `new <Name>Error(` and to `super(` of a class extending Error, AppError or *Error. */
function domainErrorCodes(source: string): DomainErrorCode[] {
  const created = [...source.matchAll(DOMAIN_ERROR_NEW)].map((match) => ({ errorClass: match[1] ?? '', code: match[3] ?? '' }));
  const headers = [...source.matchAll(CLASS_HEADER)];
  const supered = [...source.matchAll(SUPER_LITERAL)].flatMap((match) => {
    const owner = headers.filter((header) => (header.index ?? 0) < (match.index ?? 0)).at(-1);
    const parent = owner?.[2] ?? '';
    return owner !== undefined && (parent === 'Error' || parent === 'AppError' || parent.endsWith('Error'))
      ? [{ errorClass: owner[1] ?? '', code: match[2] ?? '' }]
      : [];
  });
  return [...created, ...supered];
}

/** The domain-error codes in `source` that are neither catalogued, README-listed non-problem codes nor of a exempt class. */
function uncataloguedDomainCodes(source: string, nonProblemCodes: ReadonlySet<string>): string[] {
  return domainErrorCodes(source)
    .filter(({ errorClass, code }) => !isErrorCode(code) && !nonProblemCodes.has(code) && !EXEMPT_ERROR_CLASSES.has(errorClass))
    .map(({ errorClass, code }) => `${code} (${errorClass})`);
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

  describe('README §11 error-code table (TASK-292, PR #63 review R1-m1)', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    const row = (code: string): string => {
      const line = readme.split(/\r?\n/).find((candidate) => README_ROW.exec(candidate)?.[1] === code);
      if (line === undefined) throw new Error(`fixture: no README §11 row for ${code}`);
      return line;
    };

    it('[AT-US-036-01] the code and status of every README §11 table row equal the catalogue, in both directions', () => {
      expect(readmeTableRows(readme)).toHaveLength(Object.keys(ERROR_CATALOGUE).length);
      expect(readmeTableProblems(readme, ERROR_CATALOGUE)).toEqual([]);
    });

    it('[AT-US-036-01] mutant: a dropped table row is reported, naming the code', () => {
      const mutant = readme.replace(row('NOT_FOUND'), '');
      expect(mutant).not.toBe(readme);
      expect(readmeTableProblems(mutant, ERROR_CATALOGUE)).toEqual(['NOT_FOUND: catalogue code without a README §11 table row']);
    });

    it('[AT-US-036-01] mutant: a re-statused table row is reported, naming the code and both statuses', () => {
      const mutant = readme.replace(row('NOT_FOUND'), row('NOT_FOUND').replace('| 404 |', '| 400 |'));
      expect(mutant).not.toBe(readme);
      expect(readmeTableProblems(mutant, ERROR_CATALOGUE)).toEqual(['NOT_FOUND: README §11 status 400, catalogue 404']);
    });

    it('[AT-US-036-01] mutant: an extra or a duplicated table row is reported, naming the code', () => {
      const planted = '| `MY_NEW_ERROR` | 422 | Planted. | REQ-API-005 |';
      const extra = readme.replace(row('NOT_FOUND'), `${row('NOT_FOUND')}\n${planted}`);
      expect(readmeTableProblems(extra, ERROR_CATALOGUE)).toEqual(['MY_NEW_ERROR: README §11 row is not in the error catalogue']);
      const duplicated = readme.replace(row('NOT_FOUND'), `${row('NOT_FOUND')}\n${row('NOT_FOUND')}`);
      expect(readmeTableProblems(duplicated, ERROR_CATALOGUE)).toEqual(['NOT_FOUND: more than one README §11 table row']);
    });

    it('[AT-US-036-01] a README without a §11 table reports every catalogue code instead of passing', () => {
      expect(readmeTableProblems('# nothing here', ERROR_CATALOGUE)).toHaveLength(Object.keys(ERROR_CATALOGUE).length);
    });

    it('[AT-US-036-04] the non-problem-code allow-list is read from the README §11 "not HTTP problem codes" table', () => {
      const codes = readmeNonProblemCodes(readme);
      for (const code of ['SSRF_BLOCKED', 'CARD_DECLINED', 'NOT_STAFF', 'CARRIER_UNKNOWN_ERROR']) expect(codes.has(code)).toBe(true);
      expect(codes.has('MY_NEW_ERROR')).toBe(false);
      expect(codes.has('NOT_FOUND')).toBe(false);
      // The section ends at its last row: a code from a later README section (the security-event table of §13, whose
      // trigger column names CARRIER_DAILY_QUOTA) is not allow-listed, so a lost section end turns this red.
      expect(readme).toContain('`CARRIER_DAILY_QUOTA`');
      expect(codes.has('CARRIER_DAILY_QUOTA')).toBe(false);
      expect(codes.has('CARRIER_ANON_CALLS_PER_MIN')).toBe(false);
    });
  });

  describe('domain error classes carry catalogued or declared codes (TASK-292, PR #63 review R1-m2)', () => {
    const nonProblem = readmeNonProblemCodes(readFileSync(README_PATH, 'utf8'));

    it('[AT-US-036-04] a planted domain error class with an uncatalogued code fails, naming the code and the class', () => {
      const planted = [
        'export class BillingRuleError extends Error {',
        '  constructor(readonly code: string) {',
        "    super('MY_NEW_ERROR');",
        '  }',
        '}',
        "throw new BillingRuleError('ANOTHER_NEW_ERROR');",
        "throw new BillingRuleError('NOT_FOUND');",
      ].join('\n');
      expect(uncataloguedDomainCodes(planted, nonProblem)).toEqual([
        'ANOTHER_NEW_ERROR (BillingRuleError)',
        'MY_NEW_ERROR (BillingRuleError)',
      ]);
    });

    it('[AT-US-036-04] a super() literal is attributed to its class, and only in a class that extends Error, AppError or *Error', () => {
      const source = [
        "class Plain extends Base { constructor() { super('NOT_A_CODE'); } }",
        "class Rule extends AppError { constructor() { super('SUBCLASS_CODE'); } }",
        "class Domain extends DomainError { constructor() { super('DERIVED_CODE'); } }",
      ].join('\n');
      expect(uncataloguedDomainCodes(source, nonProblem)).toEqual(['SUBCLASS_CODE (Rule)', 'DERIVED_CODE (Domain)']);
    });

    it('[AT-US-036-04] a README-listed non-problem code, an exempt class and a catalogue code pass; free text and a bare Error are not scanned', () => {
      const source = [
        "throw new OrganisationRuleError('SSRF_BLOCKED');",
        "throw new OrganisationRuleError('NOT_STAFF');",
        "throw new ObjectStorageError('TOO_LARGE');",
        "throw new SomeError('CONFLICT');",
        "throw new SomeError('a free text message');",
        "throw new Error('NOT_A_NAMED_CLASS');",
      ].join('\n');
      expect(uncataloguedDomainCodes(source, nonProblem)).toEqual([]);
    });

    it('[AT-US-036-04] an internal code passes once README §11 lists it in the internal row (PR #65 MEMBERSHIP_STATUS_NOT_WRITABLE) and fails until then', () => {
      const source = "throw new OrganisationRuleError('MEMBERSHIP_STATUS_NOT_WRITABLE');";
      const header = '### Codes that are not HTTP problem codes\n\n| Namespace | Values | Where |\n|---|---|---|\n';
      const before = readmeNonProblemCodes(`${header}| Internal | \`PRICING_CONFIG_INVALID\` | engine |\n\n---\n`);
      expect(uncataloguedDomainCodes(source, before)).toEqual(['MEMBERSHIP_STATUS_NOT_WRITABLE (OrganisationRuleError)']);
      const after = readmeNonProblemCodes(
        `${header}| Internal | \`PRICING_CONFIG_INVALID\`, \`MEMBERSHIP_STATUS_NOT_WRITABLE\` | engine |\n\n---\n`,
      );
      expect(uncataloguedDomainCodes(source, after)).toEqual([]);
    });

    it('[AT-US-036-04] every domain error code the production sources of apps/ and packages/ throw is catalogued or declared; the files read are reported', () => {
      const files = SOURCE_ROOTS.flatMap((root) => productionSources(join(REPO_ROOT, root))).map((file) =>
        relative(REPO_ROOT, file).replaceAll('\\', '/'),
      );
      expect(files.length).toBeGreaterThan(50);
      expect(files).toContain('apps/api/src/platform/storage/s3-object-storage.ts');
      expect(files).toContain('packages/audit/src/errors.ts');
      const sources = files.map((file) => ({ file, source: readFileSync(join(REPO_ROOT, file), 'utf8') }));
      const offenders = sources.flatMap(({ file, source }) =>
        uncataloguedDomainCodes(source, nonProblem).map((code) => `${file}: ${code}`),
      );
      expect(offenders).toEqual([]);
      // The scan is not vacuous: it does see the literals of the exempt classes.
      expect(sources.some(({ source }) => domainErrorCodes(source).some(({ errorClass }) => errorClass === 'ObjectStorageError'))).toBe(
        true,
      );
    });
  });
});
