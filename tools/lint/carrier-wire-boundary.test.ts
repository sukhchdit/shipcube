/**
 * AT-US-121-05 (REQ-CARR-001, ADR-0010 §Context; TASK-075): carrier wire formats cannot leak out of packages/carriers.
 * The package publishes one entry (`exports` has `.` only) and its barrel re-exports canonical types only, so a file
 * outside the package can reach an adapter's wire module only by a deep specifier or a relative path. Both are probed
 * with the repository's real eslint.config.mjs (in memory, non-type-aware, one child process, as
 * tools/lint/audit-capture-boundary.test.ts does): the deep specifier is `import-x/no-unresolved`, the relative path
 * `import-x/no-relative-packages`, each naming the forbidden import. A source scan pins the barrel side: no export of
 * packages/carriers/src/index.ts comes from an `adapters/` or `wire` module. Residual: `import-x/no-unresolved` skips
 * type-only imports, so an `import type` of a deep path is caught by the type-check gate instead (TypeScript resolves
 * through the same `exports` map and refuses the subpath); the probes are value imports.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';

interface Finding {
  readonly ruleId: string | null;
  readonly message: string;
}

const repoRoot = findRepoRoot();
/** A real module of the package, standing in for an adapter wire module (`adapters/<carrier>/wire.ts`). */
const DEEP_SPECIFIER = '@platform/carriers/src/canonical/types.js';
const DEEP_WIRE_SPECIFIER = '@platform/carriers/adapters/ups/wire.js';
const RELATIVE_SPECIFIER = '../../../../../../packages/carriers/src/canonical/types.js';
const probe = (specifier: string): string => `import * as wire from '${specifier}';

export const probe = (): unknown => wire;
`;
const PROBES: Readonly<Record<string, string>> = {
  'apps/api/src/modules/quotes/service/lint-probe-bad-deep.ts': probe(DEEP_SPECIFIER),
  'apps/api/src/modules/quotes/service/lint-probe-bad-deep-wire.ts': probe(DEEP_WIRE_SPECIFIER),
  'apps/api/src/modules/quotes/service/lint-probe-bad-relative.ts': probe(RELATIVE_SPECIFIER),
  'apps/worker/src/processors/lint-probe-bad-deep.ts': probe(DEEP_SPECIFIER),
  'apps/api/src/modules/quotes/service/lint-probe-ok-root.ts': probe('@platform/carriers'),
};

const lintScript = (probes: Readonly<Record<string, string>>, root: string): string =>
  [
    "import { join } from 'node:path';",
    "import { ESLint } from 'eslint';",
    "import tseslint from 'typescript-eslint';",
    `const probes = ${JSON.stringify(probes)};`,
    `const root = ${JSON.stringify(root)};`,
    'const eslint = new ESLint({',
    '  cwd: root,',
    "  overrideConfigFile: join(root, 'eslint.config.mjs'),",
    '  overrideConfig: [',
    '    tseslint.configs.disableTypeChecked,',
    "    { files: ['**/*.{ts,tsx}'], languageOptions: { parserOptions: { projectService: false } } },",
    "    { rules: { 'import-x/no-extraneous-dependencies': 'off' } },",
    '  ],',
    '});',
    'const report = {};',
    'for (const [path, code] of Object.entries(probes)) {',
    "  const [result] = await eslint.lintText(code, { filePath: join(root, ...path.split('/')) });",
    '  report[path] = (result?.messages ?? []).map(({ ruleId, message }) => ({ ruleId, message }));',
    '}',
    'process.stdout.write(JSON.stringify(report));',
  ].join('\n');

let report: Record<string, Finding[]>;

beforeAll(() => {
  const result = runNode(['--input-type=module'], { cwd: repoRoot, input: lintScript(PROBES, repoRoot), timeoutMs: 110_000 });
  if (result.status !== 0) throw new Error(`the lint probe exited ${String(result.status)}:\n${result.stderr}`);
  report = JSON.parse(result.stdout) as Record<string, Finding[]>;
}, 120_000);

function findingsOf(path: string): Finding[] {
  const findings = report[path];
  if (findings === undefined) throw new Error(`no lint result for ${path}`);
  expect(findings.filter(({ ruleId }) => ruleId === null)).toEqual([]);
  return findings;
}

describe('[AT-US-121-05] wire formats cannot leak out of packages/carriers', () => {
  it.each([
    ['a deep package specifier from an api module', 'apps/api/src/modules/quotes/service/lint-probe-bad-deep.ts', DEEP_SPECIFIER],
    [
      'a deep adapter wire specifier from an api module',
      'apps/api/src/modules/quotes/service/lint-probe-bad-deep-wire.ts',
      DEEP_WIRE_SPECIFIER,
    ],
    ['a deep package specifier from the worker', 'apps/worker/src/processors/lint-probe-bad-deep.ts', DEEP_SPECIFIER],
  ])('[AT-US-121-05] %s fails lint naming the forbidden import', (_label, path, specifier) => {
    const findings = findingsOf(path).filter(({ ruleId }) => ruleId === 'import-x/no-unresolved');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(specifier);
  });

  it('[AT-US-121-05] a relative path into packages/carriers fails lint naming the forbidden import', () => {
    const findings = findingsOf('apps/api/src/modules/quotes/service/lint-probe-bad-relative.ts').filter(
      ({ ruleId }) => ruleId === 'import-x/no-relative-packages',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(RELATIVE_SPECIFIER);
  });

  it('[AT-US-121-05] control: the package root resolves and lints clean', () => {
    expect(
      findingsOf('apps/api/src/modules/quotes/service/lint-probe-ok-root.ts').filter(({ ruleId }) => ruleId?.startsWith('import-x/')),
    ).toEqual([]);
  });

  it('[AT-US-121-05] the package publishes the root entry only, and its barrel exports nothing from adapters/ or wire modules', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'packages', 'carriers', 'package.json'), 'utf8')) as { exports: object };
    expect(Object.keys(manifest.exports)).toEqual(['.']);
    const barrel = readFileSync(join(repoRoot, 'packages', 'carriers', 'src', 'index.ts'), 'utf8');
    const sources = [...barrel.matchAll(/from\s+'([^']+)'/gu)].map((match) => match[1] ?? '');
    expect(sources.length).toBeGreaterThan(0);
    // The one sanctioned exception (TASK-079, D-TASK079-01): the deterministic Mock has no wire format and the
    // composition root must be able to register it; it is named exactly, so no other adapter folder can follow.
    const MOCK_ENTRY = './adapters/mock/index.js';
    expect(sources.filter((source) => source !== MOCK_ENTRY && /(?:^|\/)(?:adapters|wire)(?:\/|\.|$)/u.test(source))).toEqual([]);
    expect(sources.filter((source) => source === MOCK_ENTRY)).toHaveLength(1);
  });
});
