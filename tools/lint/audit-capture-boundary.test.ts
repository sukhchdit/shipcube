/**
 * The api-side audit composition boundary (REQ-AUDIT-001, ADR-0007; TASK-029, PR #42 code review R3-n1/R3-n2, story
 * scenario AT-US-086-03), probed with the repository's real eslint.config.mjs:
 *  - R3-n1: only the tx slot (apps/api/src/platform/tx) value-imports the capture hook (platform/audit/capture.ts);
 *    any other api module is reported with the composition message, and a type-only import passes;
 *  - R3-n2: a two-hop re-export through an allow-listed folder is not seen by the resolved-file policy (known residual
 *    D-TASK025-22), pinned as a tripwire, plus a source scan proving no such re-export exists in the repository today;
 *  - AT-US-086-03: `platform/audit-writer-allowlist` refuses the writer in a feature module and lets the allow-listed
 *    callers through.
 *
 * The probes are linted in memory (`lintText`, nothing is written) by one child process, so the ESM-only linter and the
 * `.mjs` configuration load in plain Node rather than through Jest's module registry (as tools/lint/lint-fixtures.mjs
 * does). Type-aware parsing is off (the rules under test are not type-aware, and in-memory files belong to no
 * tsconfig project). Repository probes resolve to the REAL capture.ts and @platform/audit; the two-hop probe needs a
 * real intermediate file, so it runs against the existing fixture root tests/fixtures/lint/layering/
 * audit-writer-composition (its stand-in writer.ts and the new platform/authz/ok-two-hop-writer-reexport.ts).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { beforeAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';

interface Finding {
  readonly ruleId: string | null;
  readonly message: string;
}
type Report = Record<string, Finding[]>;
interface ProbeGroup {
  readonly name: string;
  /** ESLint cwd and boundaries root path. */
  readonly root: string;
  /** Root-relative POSIX path -> source. */
  readonly probes: Readonly<Record<string, string>>;
}

const repoRoot = findRepoRoot();
const COMPOSITION_ROOT = join(repoRoot, 'tests', 'fixtures', 'lint', 'layering', 'audit-writer-composition');
const BOUNDARIES = 'boundaries/dependencies';
const WRITER_ALLOWLIST = 'platform/audit-writer-allowlist';
const COMPOSITION_TAG = 'REQ-AUDIT-001';
const COMPOSITION_MESSAGE = 'REQ-AUDIT-001: apps/api/src/platform/audit composes the audit writer';

const valueImport = (specifier: string): string =>
  `import * as target from '${specifier}';\n\nexport const probe = (): unknown => target;\n`;
const typeImport = (specifier: string): string => `import type * as Target from '${specifier}';\n\nexport type Probe = typeof Target;\n`;
const WRITER_IMPORT = "import { createAuditWriter } from '@platform/audit';\n\nexport const probe = (): unknown => createAuditWriter;\n";

/** R3-n1 and AT-US-086-03: at repository paths, against the real capture.ts and the real @platform/audit. */
const REPO: ProbeGroup = {
  name: 'repo',
  root: repoRoot,
  probes: {
    // R3-n1
    'apps/api/src/modules/orders/service/lint-probe-bad-capture.ts': valueImport('../../../platform/audit/capture.js'),
    'apps/api/src/platform/routing/lint-probe-bad-capture.ts': valueImport('../audit/capture.js'),
    'apps/api/src/modules/orders/service/lint-probe-ok-capture-type.ts': typeImport('../../../platform/audit/capture.js'),
    'apps/api/src/platform/tx/lint-probe-ok-capture.ts': valueImport('../audit/capture.js'),
    // AT-US-086-03
    'apps/api/src/modules/orders/service/lint-probe-bad-writer.ts': WRITER_IMPORT,
    'apps/api/src/modules/identity/lint-probe-ok-writer.ts': WRITER_IMPORT,
    'apps/api/src/modules/compliance/lint-probe-ok-writer.ts': WRITER_IMPORT,
    'apps/worker/src/processors/lint-probe-ok-writer.ts': WRITER_IMPORT,
    'packages/audit/src/lint-probe-ok-writer.ts': WRITER_IMPORT,
  },
};

const TWO_HOP_IMPORTER = 'apps/api/src/modules/orders/service/lint-probe-two-hop-importer.ts';
const DIRECT_IMPORTER = 'apps/api/src/modules/orders/service/lint-probe-direct-importer.ts';
const MISSING_IMPORTER = 'apps/api/src/modules/orders/service/lint-probe-missing-importer.ts';
const TWO_HOP_INTERMEDIATE = 'apps/api/src/platform/authz/ok-two-hop-writer-reexport.ts';
const UNRESOLVED = 'import-x/no-unresolved';

/** R3-n2: the intermediate module must exist on disk, so this group runs in the composition fixture root. */
const FIXTURE: ProbeGroup = {
  name: 'fixture',
  root: COMPOSITION_ROOT,
  probes: {
    [TWO_HOP_IMPORTER]: valueImport('../../../platform/authz/ok-two-hop-writer-reexport.js'),
    // Control: the same writer imported directly is reported, so the probe mechanism is not vacuous.
    [DIRECT_IMPORTER]: valueImport('../../../platform/audit/writer.js'),
    // Control: resolution is checked here, so the two-hop importer's silence is not an unresolved import.
    [MISSING_IMPORTER]: valueImport('../../../platform/authz/lint-probe-missing.js'),
    // The intermediate itself, linted as its on-disk text: the allow-listed folder may re-export it.
    [TWO_HOP_INTERMEDIATE]: readFileSync(join(COMPOSITION_ROOT, ...TWO_HOP_INTERMEDIATE.split('/')), 'utf8'),
  },
};

/** The child script: one ESLint instance per probe group (the repository config, non-type-aware), one JSON report. */
const lintScript = (groups: readonly ProbeGroup[], configFile: string): string =>
  [
    "import { join } from 'node:path';",
    "import { ESLint } from 'eslint';",
    "import tseslint from 'typescript-eslint';",
    `const groups = ${JSON.stringify(groups)};`,
    `const configFile = ${JSON.stringify(configFile)};`,
    'const report = {};',
    'for (const group of groups) {',
    '  const eslint = new ESLint({',
    '    cwd: group.root,',
    '    overrideConfigFile: configFile,',
    '    overrideConfig: [',
    '      tseslint.configs.disableTypeChecked,',
    "      { files: ['**/*.{ts,tsx}'], languageOptions: { parserOptions: { projectService: false } } },",
    "      { rules: { 'import-x/no-extraneous-dependencies': 'off' } },",
    "      { settings: { 'boundaries/root-path': group.root } },",
    '    ],',
    '  });',
    '  for (const [path, code] of Object.entries(group.probes)) {',
    "    const [result] = await eslint.lintText(code, { filePath: join(group.root, ...path.split('/')) });",
    "    report[group.name + ':' + path] = (result?.messages ?? []).map(({ ruleId, message }) => ({ ruleId, message }));",
    '  }',
    '}',
    'process.stdout.write(JSON.stringify(report));',
  ].join('\n');

let report: Report;

beforeAll(() => {
  const result = runNode(['--input-type=module'], {
    cwd: repoRoot,
    input: lintScript([REPO, FIXTURE], join(repoRoot, 'eslint.config.mjs')),
    timeoutMs: 110_000,
  });
  if (result.status !== 0) throw new Error(`the lint probe exited ${String(result.status)}:\n${result.stderr}`);
  report = JSON.parse(result.stdout) as Report;
}, 120_000);

function findingsOf(group: ProbeGroup, path: string): Finding[] {
  const findings = report[`${group.name}:${path}`];
  if (findings === undefined) throw new Error(`no lint result for ${group.name}:${path}`);
  // A finding without a rule id (an ignored file, a parse error) would make every "not reported" below vacuous.
  expect(findings.filter(({ ruleId }) => ruleId === null)).toEqual([]);
  return findings;
}

const compositionFindings = (group: ProbeGroup, path: string): Finding[] =>
  findingsOf(group, path).filter(({ ruleId, message }) => ruleId === BOUNDARIES && message.includes(COMPOSITION_TAG));
const writerFindings = (group: ProbeGroup, path: string): Finding[] =>
  findingsOf(group, path).filter(({ ruleId }) => ruleId === WRITER_ALLOWLIST);

describe('[R3-n1] only the tx slot value-imports the capture hook (apps/api/src/platform/audit/capture.ts)', () => {
  it.each([
    ['a feature service', 'apps/api/src/modules/orders/service/lint-probe-bad-capture.ts'],
    ['a platform folder outside the allow-list (platform/routing)', 'apps/api/src/platform/routing/lint-probe-bad-capture.ts'],
  ])('[R3-n1] a value import of capture.ts from %s is reported with the composition message', (_label, path) => {
    const findings = compositionFindings(REPO, path);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(COMPOSITION_MESSAGE);
  });

  it('[R3-n1] a type-only import of capture.ts from a feature service is not reported', () => {
    expect(compositionFindings(REPO, 'apps/api/src/modules/orders/service/lint-probe-ok-capture-type.ts')).toEqual([]);
  });

  it('[R3-n1] control: the same value import from the tx slot (apps/api/src/platform/tx) is not reported', () => {
    expect(findingsOf(REPO, 'apps/api/src/platform/tx/lint-probe-ok-capture.ts').filter(({ ruleId }) => ruleId === BOUNDARIES)).toEqual([]);
  });
});

describe('[R3-n2] two-hop re-exports of the audit composition', () => {
  it('[R3-n2] control: a feature module importing the composed writer directly is reported', () => {
    expect(compositionFindings(FIXTURE, DIRECT_IMPORTER)).toHaveLength(1);
  });

  it('[R3-n2] tripwire: a two-hop re-export through an allow-listed folder is not seen by the resolved-file policy (known residual D-TASK025-22)', () => {
    // The allow-listed intermediate may re-export the writer, and the feature module importing it is judged on its
    // direct target (platform/authz) only. When the policy learns to follow re-exports, this tripwire fails: replace
    // it with a negative case that expects the composition message, and close D-TASK025-22.
    expect(findingsOf(FIXTURE, TWO_HOP_INTERMEDIATE).filter(({ ruleId }) => ruleId === BOUNDARIES)).toEqual([]);
    expect(compositionFindings(FIXTURE, TWO_HOP_IMPORTER)).toEqual([]);
    // ...and that silence is the policy's, not an unresolved import (the missing-target control proves the check runs).
    expect(findingsOf(FIXTURE, MISSING_IMPORTER).some(({ ruleId }) => ruleId === UNRESOLVED)).toBe(true);
    expect(findingsOf(FIXTURE, TWO_HOP_IMPORTER).filter(({ ruleId }) => ruleId === UNRESOLVED)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// R3-n2 source scan: no allow-listed api folder (other than platform/audit itself) re-exports the composition.
// ---------------------------------------------------------------------------------------------------------------

const AUDIT_DIR = resolve(repoRoot, 'apps', 'api', 'src', 'platform', 'audit');
const SOURCE_FILE = /\.(?:[cm]?[jt]s|tsx|jsx)$/u;
const TEST_FILE = /\.test\.(?:[cm]?[jt]s|tsx|jsx)$/u;
/**
 * `export * from`, `export * as x from` and `export { ... } from` (multi-line too); group 1 is `type ` for a type-only
 * re-export (types stay importable). No nested quantifiers: `[^}]*` stops at the first brace.
 */
const RE_EXPORT = /\bexport\s+(type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/gu;

/** The relative re-export specifiers in `source` (a file at `file`) that resolve into apps/api/src/platform/audit. */
function auditReExports(file: string, source: string): string[] {
  return [...source.matchAll(RE_EXPORT)]
    .filter(([, typeOnly, specifier]) => typeOnly === undefined && specifier?.startsWith('.') === true)
    .map(([, , specifier = '']) => specifier)
    .filter((specifier) => {
      const target = resolve(dirname(file), specifier);
      return target === AUDIT_DIR || target.startsWith(AUDIT_DIR + sep);
    });
}

const listSources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSources(path);
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : [];
  });

/** The api entries of AUDIT_WRITER_ALLOW_LIST in eslint.config.mjs (read from its text, so the scan follows the list). */
function apiAllowList(): string[] {
  const config = readFileSync(join(repoRoot, 'eslint.config.mjs'), 'utf8');
  const literal = /const AUDIT_WRITER_ALLOW_LIST = \[([^\]]*)\]/u.exec(config)?.[1];
  if (literal === undefined) throw new Error('AUDIT_WRITER_ALLOW_LIST not found in eslint.config.mjs');
  return [...literal.matchAll(/'([^']+)'/gu)].map(([, glob = '']) => glob).filter((glob) => glob.startsWith('apps/api/'));
}

describe('[R3-n2] source-scan tripwire: allow-listed api folders re-export nothing from platform/audit', () => {
  it('the scanner recognises value re-exports into platform/audit and ignores type-only ones and other targets', () => {
    const file = join(repoRoot, 'apps', 'api', 'src', 'platform', 'authz', 'x.ts');
    const source = [
      "export { auditWriterFromConfig } from '../audit/writer.js';",
      "export * from '../audit/capture.js';",
      "export * as audit from '../audit/index.js';",
      'export {\n  a,\n  b as c,\n} from "../audit/writer.js";',
      "export type { AuditHook } from '../audit/capture.js';",
      "export { authorise } from './authorise.js';",
      "export { x } from '../auditing/x.js';",
      "import { y } from '../audit/writer.js';",
    ].join('\n');
    expect(auditReExports(file, source)).toEqual(['../audit/writer.js', '../audit/capture.js', '../audit/index.js', '../audit/writer.js']);
  });

  it('[R3-n2] no non-test file under an allow-listed api folder (outside platform/audit) re-exports a value from platform/audit', () => {
    const globs = apiAllowList();
    // The list as of TASK-029; the scan derives its folders from the config, so a new entry is scanned automatically.
    expect(globs).toEqual(expect.arrayContaining(['apps/api/src/platform/audit/**', 'apps/api/src/platform/authz/**']));
    const folders = globs
      .map((glob) => glob.replace(/\/\*\*$/u, ''))
      .filter((folder) => folder !== 'apps/api/src/platform/audit')
      .map((folder) => join(repoRoot, ...folder.split('/')));
    expect(folders.length).toBeGreaterThan(0);
    const offenders = folders
      .flatMap((folder) => listSources(folder))
      .flatMap((file) =>
        auditReExports(file, readFileSync(file, 'utf8')).map(
          (specifier) => `${relative(repoRoot, file).split(sep).join('/')} -> ${specifier}`,
        ),
      );
    expect(offenders).toEqual([]);
  });
});

describe('[AT-US-086-03] the audit-writer allow-list', () => {
  it('[AT-US-086-03] a feature module importing the audit writer fails the lint; allow-listed callers (packages/audit, auth events, system jobs, config changes) pass', () => {
    expect(writerFindings(REPO, 'apps/api/src/modules/orders/service/lint-probe-bad-writer.ts').length).toBeGreaterThan(0);
    for (const path of [
      'apps/api/src/modules/identity/lint-probe-ok-writer.ts', // auth events
      'apps/api/src/modules/compliance/lint-probe-ok-writer.ts', // config changes
      'apps/worker/src/processors/lint-probe-ok-writer.ts', // system jobs
      'packages/audit/src/lint-probe-ok-writer.ts', // the audit package
    ]) {
      expect([path, writerFindings(REPO, path)]).toEqual([path, []]);
    }
  });
});
