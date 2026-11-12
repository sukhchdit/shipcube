/**
 * Seeded negative fixtures (US-001, REQ-PLAT-002, NFR-MAINT-001; TASK-002). Every layering rule and every custom or
 * policy lint rule has a `bad-*` fixture under tests/fixtures/lint that must fail with exactly the expected rule(s),
 * and the `ok-*` / allow-listed fixtures beside it must lint clean. The fixtures are linted with the real
 * eslint.config.mjs and stylelint.config.mjs by tools/lint/lint-fixtures.mjs in one child process (plain Node loads the
 * ESM-only linters; see that script for the hermetic overrides). The same report carries configuration evidence on
 * the repository itself: in-memory probes at repository paths, ignore decisions and effective rule severities.
 *
 * Mode (tools/lint/fixture-expectations.mjs): `exact` by default; lane A runs the BASE ref's copy of this suite against
 * the head configs with LINT_FIXTURE_MODE=no-weakening (PR2-SEC-08, D-ORCH-018), where every expected finding must
 * still fire, extra findings with a rule id (rules the head adds) are listed instead of failed, findings without a rule
 * id fail on every fixture (review M1), and only the positive halves (exact clean sets, case-table completeness,
 * ignore and "off" decisions) are skipped. A test that mixes both kinds is split: its weakening half always runs.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { fixtureMode, formatExtras, logText, missingSteps, noWeakening, summaryMarkdown } from './fixture-expectations.mjs';
import type { Severity } from './fixture-expectations.mjs';

interface Finding {
  ruleId: string | null;
  message: string;
  severity: Severity;
}
type Report = Record<string, Finding[]>;
interface FixtureReport {
  eslint: Report;
  stylelint: Report;
  resolver: Record<string, string | null>;
  probes: Report;
  localRules: string[];
  ignored: { eslint: Record<string, boolean>; stylelint: Record<string, boolean> };
  effective: Record<string, Record<string, string> | null>;
}

/**
 * [test title, fixture path relative to tests/fixtures/lint, expected rule (or the exact set of rules, for a fixture
 * caught by two independent controls), fragment of the expected message (found in every finding)].
 */
type Violation = readonly [title: string, file: string, ruleId: string | readonly string[], message: string];

const API = 'apps/api/src/modules';
const BOUNDARIES = 'boundaries/dependencies';

const LAYERING: readonly Violation[] = [
  // The three Examples rows of the US-001 outline "Each layering rule is enforced by a seeded negative fixture".
  [
    '[AT-US-001-03-1] controller imports a repository -> "controllers contain no business logic"',
    `layering/controller-imports-repository/${API}/orders/controller/bad-orders.controller.ts`,
    BOUNDARIES,
    'controllers contain no business logic',
  ],
  [
    '[AT-US-001-03-2] service imports from express -> "services import no Express types"',
    `layering/service-imports-express/${API}/orders/service/bad-orders.service.ts`,
    BOUNDARIES,
    'services import no Express types',
  ],
  [
    '[AT-US-001-03-3] service imports @prisma/client -> "only repositories import Prisma"',
    `layering/service-imports-prisma/${API}/orders/service/bad-orders.service.ts`,
    BOUNDARIES,
    'only repositories import Prisma',
  ],
  // The remaining ADR-0003 policies.
  [
    'routes import a service (routes -> controller only)',
    `layering/routes-layer/${API}/orders/routes/bad-routes-service.ts`,
    BOUNDARIES,
    'routes map HTTP paths to controllers only',
  ],
  [
    'routes import a repository (routes -> controller only)',
    `layering/routes-layer/${API}/orders/routes/bad-routes-repository.ts`,
    BOUNDARIES,
    'routes map HTTP paths to controllers only',
  ],
  [
    "routes import another module's public index.ts (R2-n7: routes -> controller only)",
    `layering/routes-layer/${API}/quotes/routes/bad-routes-other-module.ts`,
    BOUNDARIES,
    'a route must not import a module index.ts',
  ],
  [
    'controller imports routes',
    `layering/routes-layer/${API}/orders/controller/bad-controller-routes.ts`,
    BOUNDARIES,
    'controllers sit below routes',
  ],
  [
    'repository imports a service',
    `layering/repository-imports-service/${API}/orders/repository/bad-orders.repository.ts`,
    BOUNDARIES,
    'repositories are the lowest layer',
  ],
  [
    'Prisma beside the planned audit store, outside its exact path',
    'layering/prisma-planned-paths/packages/audit/src/store/bad-other-store.ts',
    BOUNDARIES,
    'only repositories import Prisma',
  ],
  [
    'Prisma beside the planned outbox writer, outside its exact path',
    'layering/prisma-planned-paths/apps/api/src/platform/outbox/bad-relay.ts',
    BOUNDARIES,
    'only repositories import Prisma',
  ],
  [
    'module imports another module internals instead of its index.ts',
    `layering/module-internals/${API}/quotes/service/bad-quotes.service.ts`,
    BOUNDARIES,
    'only through its public index.ts',
  ],
  ['package imports an app', 'layering/package-imports-app/packages/shared/src/bad-leak.ts', BOUNDARIES, 'packages may not import apps'],
  [
    'packages/pricing imports node:fs (I/O)',
    'layering/pricing-io/packages/pricing/src/bad-price.ts',
    BOUNDARIES,
    'packages/pricing has no I/O imports',
  ],
  [
    'apps/web imports apps/api',
    'layering/web-imports-api/apps/web/app/bad-client.ts',
    BOUNDARIES,
    'apps/web and apps/admin never import from another app',
  ],
  [
    'apps/worker imports a module controller',
    'layering/worker-imports-controller/apps/worker/src/jobs/bad-sync.ts',
    BOUNDARIES,
    'apps/worker imports module services through the module public index.ts',
  ],
];

const ANY_SUPPRESSION: readonly Violation[] = ['bad-next-line', 'bad-block', 'bad-blanket', 'bad-no-task-id'].map((name): Violation => [
  `[AT-US-001-05] Unjustified any suppression is rejected (${name})`,
  `rules/any-justification/packages/pricing/src/${name}.ts`,
  'platform/any-justification',
  '',
]);

/** Static imports are caught by both `no-restricted-imports` (every file) and the boundaries policy (all forms). */
const BCRYPT_BOTH = ['no-restricted-imports', BOUNDARIES] as const;
const BCRYPT = 'only the PasswordHasher implementation';

const bcryptCase = (title: string, file: string, ruleId: Violation[2], message = BCRYPT): Violation => [
  `bcrypt confinement (D-ARCH-042): ${title}`,
  `rules/${file}`,
  ruleId,
  message,
];

const BCRYPT_CONFINEMENT: readonly Violation[] = [
  bcryptCase('a service imports bcrypt', `bcrypt-confinement/${API}/orders/service/bad-hash.ts`, BCRYPT_BOTH),
  bcryptCase(
    'an identity module file other than the hasher imports a bcryptjs subpath',
    `bcrypt-confinement/${API}/identity/service/bad-hash-js.ts`,
    BCRYPT_BOTH,
  ),
  bcryptCase('a sibling package (bcrypt-ts)', `bcrypt-confinement/${API}/orders/service/bad-sibling.ts`, BCRYPT_BOTH),
  bcryptCase('a scoped sibling package (@node-rs/bcrypt)', `bcrypt-confinement/${API}/orders/service/bad-scoped-sibling.ts`, BCRYPT_BOTH),
  bcryptCase('dynamic import()', `bcrypt-confinement/${API}/orders/service/bad-dynamic-hash.ts`, BOUNDARIES),
  bcryptCase('createRequire(import.meta.url)(...)', `bcrypt-confinement/${API}/orders/service/bad-create-require.ts`, BOUNDARIES),
  bcryptCase('require() in a .cjs file', `bcrypt-confinement/${API}/orders/service/bad-require.cjs`, BOUNDARIES),
  bcryptCase('module.require() in a .cjs file', `bcrypt-confinement/${API}/orders/service/bad-module-require.cjs`, BOUNDARIES),
  bcryptCase(
    'the hasher module re-exports bcrypt',
    `bcrypt-hasher-reexport/${API}/identity/service/bcrypt-password-hasher.ts`,
    BOUNDARIES,
    'never re-exports it',
  ),
];

const RULES: readonly Violation[] = [
  [
    'platform/barrel-reexport-only: a package index.ts declares a value',
    'rules/barrel-reexport-only/packages/shared/src/index.ts',
    'platform/barrel-reexport-only',
    'may only re-export',
  ],
  [
    'platform/audit-writer-allowlist: a module outside the allow-list imports the audit writer',
    `rules/audit-writer-allowlist/${API}/orders/service/bad-orders.service.ts`,
    'platform/audit-writer-allowlist',
    '',
  ],
  ['import-x/no-cycle: a <-> b (a)', 'rules/import-cycle/packages/shared/src/bad-a.ts', 'import-x/no-cycle', ''],
  ['import-x/no-cycle: a <-> b (b)', 'rules/import-cycle/packages/shared/src/bad-b.ts', 'import-x/no-cycle', ''],
  ['platform/money-arith: `+` on minor units', 'rules/money-arith/packages/pricing/src/bad-total.ts', 'platform/money-arith', ''],
  ['platform/no-innerhtml: innerHTML assignment', 'rules/no-innerhtml/apps/web/app/bad-dom.ts', 'platform/no-innerhtml', ''],
  ['platform/no-innerhtml: dangerouslySetInnerHTML', 'rules/no-innerhtml/apps/web/app/components/bad-raw.tsx', 'platform/no-innerhtml', ''],
  ...['bad-to-fixed', 'bad-intl', 'bad-intl-call', 'bad-parse-float'].map((name): Violation => [
    `platform/no-tofixed-tolocalestring: ${name}`,
    `rules/no-tofixed-tolocalestring/${API}/quotes/service/${name}.ts`,
    'platform/no-tofixed-tolocalestring',
    '',
  ]),
  [
    'platform/node-path-only: bare "path" specifier',
    'rules/node-path-only/apps/api/src/platform/bad-paths.ts',
    'platform/node-path-only',
    '',
  ],
  ...['bad-fetch', 'bad-axios', 'bad-http'].map((name): Violation => [
    `platform/outbound-http-via-client: ${name}`,
    `rules/outbound-http-via-client/${API}/carriers/service/${name}.ts`,
    'platform/outbound-http-via-client',
    '',
  ]),
  [
    'platform/outbound-http-via-client: a server package (packages/carriers) calls fetch',
    'rules/outbound-http-via-client/packages/carriers/src/bad-carrier-fetch.ts',
    'platform/outbound-http-via-client',
    '',
  ],
  // Output folders are ignored only at the root and the workspace roots: a source folder named coverage/build/dist is linted.
  ...['packages/shared/src/coverage/bad-coverage.ts', `${API}/shipments/build/bad-build.ts`, 'packages/carriers/src/dist/bad-dist.ts'].map(
    (path): Violation => [`source folder is linted, not ignored: ${path}`, `rules/output-ignores/${path}`, 'no-console', ''],
  ),
];

const REACT: readonly Violation[] = [
  ['jsx-a11y-x/alt-text: <img> without alt', 'react/apps/web/app/components/bad-logo.tsx', 'jsx-a11y-x/alt-text', ''],
  ['react-hooks/rules-of-hooks: conditional hook', 'react/apps/admin/app/hooks/bad-thing.tsx', 'react-hooks/rules-of-hooks', ''],
  ['i18next/no-literal-string: JSX text in apps/web', 'react/apps/web/app/routes/bad-heading.tsx', 'i18next/no-literal-string', ''],
  ['i18next/no-literal-string: JSX text in a .jsx file', 'react/apps/web/app/routes/bad-heading-jsx.jsx', 'i18next/no-literal-string', ''],
  ['i18next/no-literal-string: translatable attribute', 'react/apps/web/app/routes/bad-attribute.tsx', 'i18next/no-literal-string', ''],
  ['i18next/no-literal-string: JSX text in packages/ui', 'react/packages/ui/src/bad-label.tsx', 'i18next/no-literal-string', ''],
];

const RESOLUTION: readonly Violation[] = [
  [
    'import-x/no-unresolved (on): a missing relative module',
    'resolution/apps/api/src/platform/bad-unresolved.ts',
    'import-x/no-unresolved',
    './missing.js',
  ],
];

const CSS: readonly Violation[] = [
  ['platform/hover-in-media: :hover outside any @media', 'css/bad-hover-outside-media.css', 'platform/hover-in-media', ':hover'],
  ['platform/hover-in-media: :hover inside @media (hover: none)', 'css/bad-hover-wrong-media.css', 'platform/hover-in-media', ':hover'],
  ['csstools/use-logical: margin-left', 'css/bad-physical-property.css', 'csstools/use-logical', ''],
  ['csstools/use-logical: text-align: left', 'css/bad-text-align.css', 'csstools/use-logical', ''],
  ['reportNeedlessDisables: a disable with nothing to disable', 'css/bad-needless-disable.css', '--report-needless-disables', ''],
  [
    'reportDescriptionlessDisables: a disable without "-- description"',
    'css/bad-descriptionless-disable.css',
    '--report-descriptionless-disables',
    '',
  ],
  [
    'reportInvalidScopeDisables: a disable of a rule that is not configured (also needless)',
    'css/bad-invalid-scope-disable.css',
    ['--report-invalid-scope-disables', '--report-needless-disables'],
    'color-no-invalid-hex',
  ],
];

const ESLINT_VIOLATIONS = [...LAYERING, ...ANY_SUPPRESSION, ...BCRYPT_CONFINEMENT, ...RULES, ...REACT, ...RESOLUTION];

/** The steps of `npm run lint` (`&&`-separated), in order (PR2-SEC-01/02/03). */
const LINT_STEPS: readonly RegExp[] = [
  /^eslint \. .*--max-warnings 0/u,
  /^stylelint .*--max-warnings 0/u,
  /^node tools\/lint\/check-suppressions\.mjs$/u,
];

/** Throws on an unknown LINT_FIXTURE_MODE value, so the suite fails to load rather than run in a guessed mode. */
const MODE = fixtureMode(process.env);
/** Positive-only assertions (case-table completeness, ignore and "off" decisions): skipped by the base-ref run. */
const exactOnly = MODE === 'exact' ? it : it.skip;

const repoRoot = findRepoRoot();
let report: FixtureReport;

beforeAll(() => {
  const result = runNode([join(repoRoot, 'tools', 'lint', 'lint-fixtures.mjs')], { cwd: repoRoot, timeoutMs: 90_000 });
  if (result.status !== 0) throw new Error(`lint-fixtures.mjs exited ${String(result.status)}:\n${result.stderr}`);
  report = JSON.parse(result.stdout) as FixtureReport;
}, 120_000);

const findingsOf = (source: Report, file: string): Finding[] => {
  const findings = source[file];
  if (findings === undefined) throw new Error(`fixture not linted: ${file}`);
  return findings;
};

const expectOnly = (findings: Finding[], ruleId: string | readonly string[], message: string, severity: Severity) => {
  const expected = typeof ruleId === 'string' ? [ruleId] : [...ruleId];
  expect(findings.map((finding) => finding.ruleId).sort()).toEqual(expected.sort());
  for (const finding of findings) {
    expect(finding.severity).toBe(severity);
    expect(finding.message).toContain(message);
  }
};

const ruleIdsOf = (violations: readonly Violation[]): Set<string> =>
  new Set(violations.flatMap(([, , ruleId]) => (typeof ruleId === 'string' ? [ruleId] : [...ruleId])));

/**
 * Findings with a rule id the head reports beyond the expected ones (no-weakening mode only), per fixture, listed after
 * the run. Keyed by file: a clean fixture is checked by its own case and by the "every other fixture" sweep.
 */
const extras = new Map<string, Finding[]>();
const recordExtras = (file: string, found: Finding[]) => {
  if (found.length > 0) extras.set(file, found);
};

/** No-weakening mode: collects the extras of `file`; any failure (weakened expectation, ruleless finding) fails the test. */
const assertNoWeakening = (findings: Finding[], file: string, ruleId: string | readonly string[], message: string, severity: Severity) => {
  const result = noWeakening(findings, ruleId, message, { minSeverity: severity });
  recordExtras(file, result.extras);
  expect(result.failures).toEqual([]);
};

/**
 * `exact`: the fixture reports exactly `ruleId` at `severity`. `no-weakening`: it still reports `ruleId` at `severity` or
 * higher (m3: a warning case accepts an error) and nothing without a rule id; other findings are listed.
 */
const expectFindings = (
  source: Report,
  file: string,
  ruleId: string | readonly string[],
  message: string,
  severity: Severity = 'error',
) => {
  const findings = findingsOf(source, file);
  if (MODE === 'exact') expectOnly(findings, ruleId, message, severity);
  else assertNoWeakening(findings, file, ruleId, message, severity);
};

/**
 * `exact`: the fixture lints clean. `no-weakening` (review M1): it reports nothing without a rule id (an unused disable
 * directive, a parse error, an ignored-file warning); findings with a rule id come from rules the head adds and are listed.
 */
const expectClean = (source: Report, file: string) => {
  const findings = findingsOf(source, file);
  if (MODE === 'exact') expect(findings).toEqual([]);
  else assertNoWeakening(findings, file, [], '', 'error');
};

afterAll(() => {
  // review n6: no summary when the report never loaded (beforeAll failed, so every test already failed).
  if (MODE !== 'no-weakening' || (report as FixtureReport | undefined) === undefined) return;
  const listed = [...extras].flatMap(([file, found]) => found.map((finding) => ({ file, finding })));
  const lines = formatExtras(listed, ruleIdsOf([...ESLINT_VIOLATIONS, ...CSS]));
  const heading = `No-weakening run: ${String(lines.length)} extra finding(s) with a rule id from the head configs (allowed).`;
  console.log(logText([heading, ...lines]));
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined && summary !== '') appendFileSync(summary, summaryMarkdown(heading, lines));
});

describe('seeded negative fixtures: ESLint (US-001, ADR-0003)', () => {
  it.each(ESLINT_VIOLATIONS)('%s', (_title, file, ruleId, message) => {
    expectFindings(report.eslint, file, ruleId, message);
  });

  it('every other fixture (ok-*, allow-listed paths, supporting modules) lints clean (no-weakening: reports nothing without a rule id)', () => {
    const expected = new Set(ESLINT_VIOLATIONS.map(([, file]) => file));
    const others = Object.keys(report.eslint).filter((file) => !expected.has(file));
    expect(others.length).toBeGreaterThan(0);
    if (MODE === 'exact') {
      expect(others.map((file) => [file, findingsOf(report.eslint, file)] as const).filter(([, findings]) => findings.length > 0)).toEqual(
        [],
      );
      return;
    }
    const failures = others.flatMap((file) => {
      const result = noWeakening(findingsOf(report.eslint, file), [], '');
      recordExtras(file, result.extras);
      return result.failures.map((failure) => `${file}: ${failure}`);
    });
    expect(failures).toEqual([]);
  });

  it.each([
    ['the module index.ts wires repository -> service -> controller -> routes', `layering/routes-layer/${API}/orders/index.ts`],
    ['routes import a controller (type) and a schema', `layering/routes-layer/${API}/orders/routes/ok-orders.routes.ts`],
    [
      'bcrypt confinement: the PasswordHasher implementation module',
      `rules/bcrypt-confinement/${API}/identity/service/bcrypt-password-hasher.ts`,
    ],
    ['Prisma in the planned audit store (TASK-025)', 'layering/prisma-planned-paths/packages/audit/src/store/prisma-store.ts'],
    ['Prisma in the planned outbox writer (TASK-043)', 'layering/prisma-planned-paths/apps/api/src/platform/outbox/writer.ts'],
    ['platform/barrel-reexport-only: re-exports and `export {}`', 'rules/barrel-reexport-only/packages/pricing/src/index.ts'],
    ['platform/any-justification: suppression with a justification', 'rules/any-justification/packages/pricing/src/ok-justified.ts'],
    [
      'platform/audit-writer-allowlist: allow-listed identity module',
      `rules/audit-writer-allowlist/${API}/identity/service/ok-login.service.ts`,
    ],
    ['platform/money-arith: the money helpers', 'rules/money-arith/packages/shared/src/money/add.ts'],
    ['platform/no-innerhtml: the sanitising component', 'rules/no-innerhtml/packages/ui/src/sanitised-html/sanitised-html.tsx'],
    ['platform/no-tofixed-tolocalestring: the Intl helpers', 'rules/no-tofixed-tolocalestring/packages/shared/src/intl/number.ts'],
    [
      'platform/outbound-http-via-client: the egress client',
      'rules/outbound-http-via-client/apps/api/src/platform/egress/outbound-http-client.ts',
    ],
    [
      'platform/outbound-http-via-client: packages/ui (browser) uses Axios',
      'rules/outbound-http-via-client/packages/ui/src/session/ok-session-client.ts',
    ],
    ['i18next/no-literal-string: literals in a *.test.tsx file', 'react/apps/web/app/routes/ok-heading.test.tsx'],
    [
      'import-x/no-unresolved (on): @platform/shared and a NodeNext ./x.js import resolve',
      'resolution/apps/api/src/platform/ok-workspace.ts',
    ],
    ['module imports another module through its index.ts', `layering/module-internals/${API}/quotes/service/ok-quotes.service.ts`],
    ['apps/worker imports a module through its index.ts', 'layering/worker-imports-controller/apps/worker/src/jobs/ok-sync.ts'],
    ['packages/pricing imports @platform/shared', 'layering/pricing-io/packages/pricing/src/ok-price.ts'],
  ])('allowed: %s', (_title, file) => {
    expectClean(report.eslint, file);
  });

  exactOnly('every bad-* fixture is listed in the case table (no untested fixture)', () => {
    const listed = new Set(ESLINT_VIOLATIONS.map(([, file]) => file));
    const unlisted = Object.keys(report.eslint).filter((file) => /\/bad-[^/]+$/u.test(file) && !listed.has(file));
    expect(unlisted).toEqual([]);
  });

  exactOnly('every local platform/* rule has at least one negative fixture', () => {
    const covered = ruleIdsOf(ESLINT_VIOLATIONS);
    expect(report.localRules.length).toBeGreaterThan(0);
    expect(report.localRules.map((rule) => `platform/${rule}`).filter((rule) => !covered.has(rule))).toEqual([]);
  });
});

describe('repository probes: workspace imports resolved to repository files (ADR-0003)', () => {
  it.each([
    ['apps/web imports @platform/config', 'apps/web/app/routes/lint-probe-bad-config.ts'],
    ['apps/admin imports @platform/pricing', 'apps/admin/app/routes/lint-probe-bad-pricing.ts'],
  ])('%s -> "import only @platform/shared and @platform/ui"', (_title, path) => {
    expectFindings(report.probes, path, BOUNDARIES, 'import only @platform/shared and @platform/ui');
  });

  it('[PR #2 m8] allowed: apps/worker imports @platform/api/runtime (package exports, resolved)', () => {
    expectClean(report.probes, 'apps/worker/src/jobs/lint-probe-ok-api-runtime.ts');
  });

  it('[PR #2 m8] apps/worker cannot reach a non-exported @platform/api subpath', () => {
    expect(findingsOf(report.probes, 'apps/worker/src/jobs/lint-probe-bad-api-subpath.ts').map((f) => f.ruleId)).toContain(
      'import-x/no-unresolved',
    );
  });

  it('[PR #2 m8] apps/worker importing apps/api platform internals by path is a layering violation', () => {
    const findings = findingsOf(report.probes, 'apps/worker/src/jobs/lint-probe-bad-api-relative.ts');
    const layering = findings.filter((finding) => finding.ruleId === BOUNDARIES);
    expect(layering.map((finding) => finding.message).join('\n')).toContain('only through @platform/api/runtime');
  });

  it('allowed: apps/web imports @platform/shared and @platform/ui (resolved, no-unresolved on)', () => {
    expectClean(report.probes, 'apps/web/app/routes/lint-probe-ok-shared-ui.ts');
  });
});

describe('seeded negative fixtures: Stylelint (NFR-I18N-003, NFR-A11Y-006)', () => {
  it.each(CSS)('%s', (_title, file, ruleId, message) => {
    expectFindings(report.stylelint, file, ruleId, message);
  });

  it('allowed: logical properties and :hover inside @media (hover: hover)', () => {
    expectClean(report.stylelint, 'css/ok-logical-and-hover.css');
  });

  exactOnly('every CSS fixture is listed in the case table', () => {
    const listed = new Set([...CSS.map(([, file]) => file), 'css/ok-logical-and-hover.css']);
    expect(Object.keys(report.stylelint).filter((file) => !listed.has(file))).toEqual([]);
  });
});

describe('lint wiring (ADR-0002 am. item 3, NFR-MAINT-001, PR2-SEC-02/03)', () => {
  it('resolves workspace packages to their sources through the @platform/source condition', () => {
    expect(report.resolver['@platform/shared']).toBe('packages/shared/src/index.ts');
  });

  it('`npm run lint` runs ESLint and Stylelint with --max-warnings 0, then the suppression check (PR2-SEC-01; no-weakening: every step still runs, in order, PR17-SEC-04)', () => {
    const { scripts } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const steps = (scripts['lint'] ?? '').split('&&').map((step) => step.trim());
    if (MODE === 'exact') expect(steps).toEqual(LINT_STEPS.map((step) => expect.stringMatching(step)));
    else expect(missingSteps(steps, LINT_STEPS)).toEqual([]);
  });

  // Ignore decisions: a source path that becomes ignored is weakening (always checked); an output path that stops
  // being ignored only lints more (positive half, exact mode only).
  const ESLINT_IGNORED = {
    'dist/x.js': true,
    'build/x.js': true,
    'coverage/lcov-report/x.js': true,
    'apps/web/build/client/x.js': true,
    'apps/api/dist/server.js': true,
    'packages/shared/dist/index.js': true,
    'apps/api/coverage/x.js': true,
    'apps/web/.react-router/types/x.ts': true,
    'packages/shared/src/coverage/a.ts': false,
    'packages/carriers/src/build/a.ts': false,
    'packages/carriers/src/dist/a.ts': false,
    'apps/api/src/modules/shipments/build/a.ts': false,
    'apps/web/app/routes/a.jsx': false,
  };
  const STYLELINT_IGNORED = {
    'dist/x.css': true,
    'apps/web/build/client/assets/x.css': true,
    'packages/ui/dist/x.css': true,
    'coverage/x.css': true,
    'apps/web/app/coverage/x.css': false,
    'packages/ui/src/build/x.css': false,
  };
  const linted = (expected: Record<string, boolean>) => Object.keys(expected).filter((path) => !expected[path]);

  it.each([
    ['ESLint', 'eslint', ESLINT_IGNORED],
    ['Stylelint', 'stylelint', STYLELINT_IGNORED],
  ] as const)('%s still lints source folders named build/coverage/dist (not ignored)', (_name, linter, expected) => {
    const reported = report.ignored[linter];
    expect(linted(expected).filter((path) => reported[path] !== false)).toEqual([]);
  });

  exactOnly.each([
    ['ESLint', 'eslint', ESLINT_IGNORED],
    ['Stylelint', 'stylelint', STYLELINT_IGNORED],
  ] as const)('%s ignores build/coverage output only at the root and the workspace roots', (_name, linter, expected) => {
    expect(report.ignored[linter]).toEqual(expected);
  });

  it('the bcrypt confinement rules are on everywhere; other modules keep the bcrypt pattern', () => {
    for (const [path, rules] of Object.entries(report.effective)) {
      expect([path, rules?.['no-restricted-imports'], rules?.['boundaries/dependencies']]).toEqual([path, 'error', 'error']);
    }
    expect(report.effective['apps/api/src/modules/orders/service/a.ts']?.['no-restricted-imports:options']).toContain('bcrypt');
  });

  exactOnly('the hasher re-declares no-restricted-imports without the bcrypt pattern', () => {
    const hasher = report.effective['apps/api/src/modules/identity/service/bcrypt-password-hasher.ts'];
    expect(hasher?.['no-restricted-imports:options']).not.toContain('bcrypt');
  });

  it('.jsx and .cjs sources get the same rules as their TypeScript neighbours', () => {
    expect(report.effective['apps/web/app/routes/a.jsx']).toMatchObject({
      'i18next/no-literal-string': 'error',
      'jsx-a11y-x/alt-text': 'error',
      'platform/no-innerhtml': 'error',
    });
    expect(report.effective['apps/api/src/platform/a.cjs']).toMatchObject({ 'platform/outbound-http-via-client': 'error' });
  });

  it('server-only rules stay on in server packages; test files keep the a11y rules', () => {
    expect(report.effective['packages/shared/src/a.ts']?.['platform/outbound-http-via-client']).toBe('error');
    expect(report.effective['apps/web/app/routes/a.test.tsx']).toMatchObject({ 'jsx-a11y-x/alt-text': 'error' });
  });

  exactOnly('server-only rules skip the browser package; string externalisation skips test files', () => {
    expect(report.effective['packages/ui/src/session/client.ts']?.['platform/outbound-http-via-client']).toBe('off');
    expect(report.effective['apps/web/app/routes/a.test.tsx']).toMatchObject({ 'i18next/no-literal-string': 'off' });
  });
});
