/**
 * Seeded negative fixtures (US-001, REQ-PLAT-002, NFR-MAINT-001; TASK-002). Every layering rule and every custom or
 * policy lint rule has a `bad-*` fixture under tests/fixtures/lint that must fail with exactly the expected rule(s),
 * and the `ok-*` / allow-listed fixtures beside it must lint clean. The fixtures are linted with the real
 * eslint.config.mjs and stylelint.config.mjs by tools/lint/lint-fixtures.mjs in one child process (plain Node loads the
 * ESM-only linters; see that script for the hermetic overrides). The same report carries configuration evidence on
 * the repository itself: in-memory probes at repository paths, ignore decisions and effective rule severities.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';

interface Finding {
  ruleId: string | null;
  message: string;
  severity: 'error' | 'warning';
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

const ANY_SUPPRESSION: readonly Violation[] = ['bad-next-line', 'bad-block', 'bad-blanket'].map((name): Violation => [
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

const TENANT_CONTEXT = 'platform/tenant-context-sql';
const CLIENT_CONSTRUCTION = 'platform/prisma-client-construction';
/** Tenant context, the private root client and raw SQL (ADR-0005 am. 10 items 1, 2, 4, 12; PR2-SEC-05; TASK-016). */
const TENANT_DB: readonly Violation[] = [
  [
    'AT-US-075-03: source containing a session-level SET of a tenant-context key fails lint',
    `rules/tenant-context-sql/${API}/orders/repository/bad-session-set.ts`,
    TENANT_CONTEXT,
    'Session-level SET/RESET',
  ],
  [
    'platform/tenant-context-sql: a security key outside withTenantTx',
    `rules/tenant-context-sql/${API}/orders/service/bad-context-key.ts`,
    TENANT_CONTEXT,
    'outside withTenantTx',
  ],
  [
    'platform/tenant-context-sql: the context setter in a template literal outside withTenantTx',
    `rules/tenant-context-sql/${API}/orders/repository/bad-context-template.ts`,
    TENANT_CONTEXT,
    'outside withTenantTx',
  ],
  [
    'platform/tenant-context-sql: the session-scoped setter in a file exempted for tokens only',
    'rules/tenant-context-sql/prisma/tests/rls/with-tenant-tx.int.test.ts',
    TENANT_CONTEXT,
    'is_local = false',
  ],
  [
    'platform/db-raw-sql: an unsafe raw-SQL member in platform/db',
    'rules/db-raw-sql/apps/api/src/platform/db/bad-unsafe.ts',
    'platform/db-raw-sql',
    'interpolates SQL',
  ],
  [
    'platform/db-raw-sql: SET LOCAL text in a repository',
    `rules/db-raw-sql/${API}/orders/repository/bad-set-local.ts`,
    'platform/db-raw-sql',
    'SET LOCAL',
  ],
  [
    'platform/db-raw-sql: Prisma.raw in a repository (PR #11 m5, PR11-SEC-05)',
    `rules/db-raw-sql/${API}/orders/repository/bad-prisma-raw.ts`,
    'platform/db-raw-sql',
    'Prisma.raw interpolates SQL',
  ],
  [
    'platform/db-raw-sql: a named import of raw from the Prisma runtime in a repository (PR11-SEC-05)',
    `rules/db-raw-sql/${API}/orders/repository/bad-raw-import.ts`,
    'platform/db-raw-sql',
    'Prisma.raw interpolates SQL',
  ],
  [
    'platform/db-raw-sql: a non-tagged $queryRaw call in a repository (PR #11 m5)',
    `rules/db-raw-sql/${API}/orders/repository/bad-non-tagged.ts`,
    'platform/db-raw-sql',
    'without a tagged template',
  ],
  [
    'platform/db-raw-sql: $parent.$queryRawUnsafe in a service (PR11-SEC-01, PR11-SEC-05)',
    `rules/db-raw-sql/${API}/orders/service/bad-parent-unsafe.ts`,
    ['platform/db-raw-sql', 'platform/db-raw-sql'],
    'ADR-0005 am. 10 item',
  ],
  [
    'a repository imports the pg driver and builds a Pool (PR2-SEC-05 addendum, PR11-SEC-05)',
    `layering/sql-driver/${API}/orders/repository/bad-pg-pool.ts`,
    BOUNDARIES,
    'only the database platform core',
  ],
  [
    'the planned audit store imports the pg driver (PR11-SEC-05)',
    'layering/sql-driver/packages/audit/src/store/prisma-store.ts',
    BOUNDARIES,
    'only the database platform core',
  ],
  [
    'platform/tenant-context-sql: a new file under prisma/tests/catalog/ inherits no exemption (PR11-SEC-08)',
    'rules/tenant-context-sql/prisma/tests/catalog/helper.ts',
    TENANT_CONTEXT,
    'Session-level SET/RESET',
  ],
  [
    'platform/tenant-context-sql: a transaction-local setter in session-integrity.ts (keys only) fails (PR11-SEC-08)',
    'rules/tenant-context-sql/apps/api/src/platform/db/session-integrity.ts',
    TENANT_CONTEXT,
    'Tenant-context setter outside withTenantTx',
  ],
  [
    'platform/no-alter-role-sql: ALTER ROLE in apps/*/src',
    'rules/no-alter-role-sql/apps/api/src/platform/health/bad-alter-role.ts',
    'platform/no-alter-role-sql',
    '',
  ],
  [
    'platform/no-alter-role-sql: ALTER USER in packages/*/src',
    'rules/no-alter-role-sql/packages/shared/src/bad-alter-user.ts',
    'platform/no-alter-role-sql',
    '',
  ],
  [
    'platform/prisma-client-construction: a repository imports PrismaClient and constructs it (PR2-SEC-05)',
    `rules/prisma-client-construction/${API}/orders/repository/bad-new-client.ts`,
    [CLIENT_CONSTRUCTION, CLIENT_CONSTRUCTION],
    'PR2-SEC-05',
  ],
  [
    'platform/prisma-client-construction: a repository imports the pg adapter (PR2-SEC-05)',
    `rules/prisma-client-construction/${API}/orders/repository/bad-adapter.ts`,
    CLIENT_CONSTRUCTION,
    'PR2-SEC-05',
  ],
  [
    'a repository imports the root database client (ADR-0005 am. 10 item 2, PR2-SEC-05)',
    `layering/root-client-privacy/${API}/orders/repository/bad-root-client.ts`,
    BOUNDARIES,
    'the root database client (platform/db/client.ts) is private',
  ],
  [
    'prisma/tests imports packages/*/src (PR #5 R3-n1)',
    'layering/prisma-tests-imports/prisma/tests/rls/bad-package-import.int.test.ts',
    BOUNDARIES,
    'prisma/tests may import only',
  ],
];

/** Warning-level rules ([title, file, rule]); `npm run lint` runs with --max-warnings 0, so each still blocks. */
const WARNINGS: readonly (readonly [title: string, file: string, ruleId: string])[] = [
  [
    'platform/expect-affected: an updateMany result not passed to expectAffected (ADR-0005 am. 10 item 15)',
    `rules/expect-affected/${API}/orders/repository/bad-unchecked.ts`,
    'platform/expect-affected',
  ],
];

const ESLINT_VIOLATIONS = [...LAYERING, ...ANY_SUPPRESSION, ...BCRYPT_CONFINEMENT, ...RULES, ...TENANT_DB, ...REACT, ...RESOLUTION];

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

const expectOnly = (findings: Finding[], ruleId: string | readonly string[], message: string) => {
  const expected = typeof ruleId === 'string' ? [ruleId] : [...ruleId];
  expect(findings.map((finding) => finding.ruleId).sort()).toEqual(expected.sort());
  for (const finding of findings) {
    expect(finding.severity).toBe('error');
    expect(finding.message).toContain(message);
  }
};

const ruleIdsOf = (violations: readonly Violation[]): Set<string> =>
  new Set(violations.flatMap(([, , ruleId]) => (typeof ruleId === 'string' ? [ruleId] : [...ruleId])));

describe('seeded negative fixtures: ESLint (US-001, ADR-0003)', () => {
  it.each(ESLINT_VIOLATIONS)('%s', (_title, file, ruleId, message) => {
    expectOnly(findingsOf(report.eslint, file), ruleId, message);
  });

  it.each(WARNINGS)('%s (warning level)', (_title, file, ruleId) => {
    const findings = findingsOf(report.eslint, file);
    expect(findings.map((finding) => [finding.ruleId, finding.severity])).toEqual([[ruleId, 'warning']]);
  });

  it('every other fixture (ok-*, allow-listed paths, supporting modules) lints clean', () => {
    const expected = new Set([...ESLINT_VIOLATIONS, ...WARNINGS].map(([, file]) => file));
    const dirty = Object.entries(report.eslint).filter(([file, findings]) => !expected.has(file) && findings.length > 0);
    expect(dirty).toEqual([]);
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
    expect(findingsOf(report.eslint, file)).toEqual([]);
  });

  it.each([
    [
      'tenant-context-sql: withTenantTx sets the context transaction-local',
      'rules/tenant-context-sql/apps/api/src/platform/db/with-tenant-tx.ts',
    ],
    ['tenant-context-sql: the session-scope negative control', 'rules/tenant-context-sql/prisma/tests/rls/session-scope-leak.int.test.ts'],
    ['db-raw-sql: tests may probe the unsafe members (TenantDb Proxy)', 'rules/db-raw-sql/apps/api/src/platform/db/tenant-db.test.ts'],
    ['db-raw-sql: a tagged $queryRaw template in a repository', `rules/db-raw-sql/${API}/orders/repository/ok-tagged.ts`],
    [
      'tenant-context-sql: session-integrity.* may read a security key (keys only, PR11-SEC-08)',
      'rules/tenant-context-sql/apps/api/src/platform/db/session-integrity.test.ts',
    ],
    ['the database platform core imports the pg driver', 'layering/sql-driver/apps/api/src/platform/db/ok-pool.ts'],
    [
      'prisma-client-construction: type-only import in a repository',
      `rules/prisma-client-construction/${API}/orders/repository/ok-type-only.ts`,
    ],
    [
      'prisma-client-construction: the database platform builds the client',
      'rules/prisma-client-construction/apps/api/src/platform/db/client.ts',
    ],
    ['expect-affected: results passed to expectAffected', `rules/expect-affected/${API}/orders/repository/ok-checked.ts`],
    ['withTenantTx imports the root client', 'layering/root-client-privacy/apps/api/src/platform/db/with-tenant-tx.ts'],
    [
      'prisma/tests imports tools/db, tools/test-support, platform/db and its harness',
      'layering/prisma-tests-imports/prisma/tests/rls/ok-imports.int.test.ts',
    ],
  ])('allowed (TASK-016): %s', (_title, file) => {
    expect(findingsOf(report.eslint, file)).toEqual([]);
  });

  it('every bad-* fixture is listed in the case table (no untested fixture)', () => {
    const listed = new Set([...ESLINT_VIOLATIONS, ...WARNINGS].map(([, file]) => file));
    const unlisted = Object.keys(report.eslint).filter((file) => /\/bad-[^/]+$/u.test(file) && !listed.has(file));
    expect(unlisted).toEqual([]);
  });

  it('every local platform/* rule has at least one negative fixture', () => {
    const covered = new Set([...ruleIdsOf(ESLINT_VIOLATIONS), ...WARNINGS.map(([, , ruleId]) => ruleId)]);
    expect(report.localRules.length).toBeGreaterThan(0);
    expect(report.localRules.map((rule) => `platform/${rule}`).filter((rule) => !covered.has(rule))).toEqual([]);
  });
});

describe('repository probes: workspace imports resolved to repository files (ADR-0003)', () => {
  it.each([
    ['apps/web imports @platform/config', 'apps/web/app/routes/lint-probe-bad-config.ts'],
    ['apps/admin imports @platform/pricing', 'apps/admin/app/routes/lint-probe-bad-pricing.ts'],
  ])('%s -> "import only @platform/shared and @platform/ui"', (_title, path) => {
    expectOnly(findingsOf(report.probes, path), BOUNDARIES, 'import only @platform/shared and @platform/ui');
  });

  it('allowed: apps/web imports @platform/shared and @platform/ui (resolved, no-unresolved on)', () => {
    expect(findingsOf(report.probes, 'apps/web/app/routes/lint-probe-ok-shared-ui.ts')).toEqual([]);
  });
});

describe('seeded negative fixtures: Stylelint (NFR-I18N-003, NFR-A11Y-006)', () => {
  it.each(CSS)('%s', (_title, file, ruleId, message) => {
    expectOnly(findingsOf(report.stylelint, file), ruleId, message);
  });

  it('allowed: logical properties and :hover inside @media (hover: hover)', () => {
    expect(findingsOf(report.stylelint, 'css/ok-logical-and-hover.css')).toEqual([]);
  });

  it('every CSS fixture is listed in the case table', () => {
    const listed = new Set([...CSS.map(([, file]) => file), 'css/ok-logical-and-hover.css']);
    expect(Object.keys(report.stylelint).filter((file) => !listed.has(file))).toEqual([]);
  });
});

describe('lint wiring (ADR-0002 am. item 3, NFR-MAINT-001, PR2-SEC-02/03)', () => {
  it('resolves workspace packages to their sources through the @platform/source condition', () => {
    expect(report.resolver['@platform/shared']).toBe('packages/shared/src/index.ts');
  });

  it('`npm run lint` runs ESLint and Stylelint with --max-warnings 0', () => {
    const { scripts } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const steps = (scripts['lint'] ?? '').split('&&').map((step) => step.trim());
    expect(steps).toEqual([
      expect.stringMatching(/^eslint \. .*--max-warnings 0/u),
      expect.stringMatching(/^stylelint .*--max-warnings 0/u),
    ]);
  });

  it('ESLint ignores build/coverage output only at the root and the workspace roots', () => {
    expect(report.ignored.eslint).toEqual({
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
    });
  });

  it('Stylelint ignores build/coverage output only at the root and the workspace roots', () => {
    expect(report.ignored.stylelint).toEqual({
      'dist/x.css': true,
      'apps/web/build/client/assets/x.css': true,
      'packages/ui/dist/x.css': true,
      'coverage/x.css': true,
      'apps/web/app/coverage/x.css': false,
      'packages/ui/src/build/x.css': false,
    });
  });

  it('the bcrypt confinement rules are on everywhere; the hasher re-declares no-restricted-imports without the bcrypt pattern', () => {
    for (const [path, rules] of Object.entries(report.effective)) {
      expect([path, rules?.['no-restricted-imports'], rules?.['boundaries/dependencies']]).toEqual([path, 'error', 'error']);
    }
    const hasher = report.effective['apps/api/src/modules/identity/service/bcrypt-password-hasher.ts'];
    expect(hasher?.['no-restricted-imports:options']).not.toContain('bcrypt');
    expect(report.effective['apps/api/src/modules/orders/service/a.ts']?.['no-restricted-imports:options']).toContain('bcrypt');
  });

  it('.jsx and .cjs sources get the same rules as their TypeScript neighbours', () => {
    expect(report.effective['apps/web/app/routes/a.jsx']).toMatchObject({
      'i18next/no-literal-string': 'error',
      'jsx-a11y-x/alt-text': 'error',
      'platform/no-innerhtml': 'error',
    });
    expect(report.effective['apps/api/src/platform/a.cjs']).toMatchObject({ 'platform/outbound-http-via-client': 'error' });
  });

  it('the audit-writer allow-list is narrowed to platform/{audit,authz,db} and the worker processors (TASK-002 n5)', () => {
    expect(report.effective['apps/api/src/platform/http/a.ts']?.['platform/audit-writer-allowlist']).toBe('error');
    expect(report.effective['apps/worker/src/platform/a.ts']?.['platform/audit-writer-allowlist']).toBe('error');
    expect(report.effective['apps/api/src/platform/audit/a.ts']?.['platform/audit-writer-allowlist']).toBe('off');
    expect(report.effective['apps/worker/src/processors/a.ts']?.['platform/audit-writer-allowlist']).toBe('off');
  });

  it('tenant-database rules: repositories get raw-SQL, client and expectAffected checks; prisma/tests keeps no-relative-packages on (TASK-016)', () => {
    expect(report.effective['apps/api/src/modules/orders/repository/a.ts']).toMatchObject({
      'platform/tenant-context-sql': 'error',
      'platform/prisma-client-construction': 'error',
      'platform/db-raw-sql': 'error',
      'platform/expect-affected': 'warn',
    });
    expect(report.effective['prisma/tests/rls/a.int.test.ts']).toMatchObject({
      'platform/tenant-context-sql': 'error',
      'platform/prisma-client-construction': 'off',
      'platform/db-raw-sql': 'off',
      'import-x/no-relative-packages': 'error',
    });
    // PR11-SEC-05: services (they hold a TenantDb), the rest of apps/*/src and the planned Prisma files get db-raw-sql.
    for (const path of [
      'apps/api/src/modules/orders/service/a.ts',
      'apps/api/src/platform/http/a.ts',
      'packages/audit/src/store/prisma-store.ts',
    ]) {
      expect([path, report.effective[path]?.['platform/db-raw-sql']]).toEqual([path, 'error']);
    }
  });

  it('server-only rules skip the browser package; string externalisation skips test files', () => {
    expect(report.effective['packages/ui/src/session/client.ts']?.['platform/outbound-http-via-client']).toBe('off');
    expect(report.effective['packages/shared/src/a.ts']?.['platform/outbound-http-via-client']).toBe('error');
    expect(report.effective['apps/web/app/routes/a.test.tsx']).toMatchObject({
      'i18next/no-literal-string': 'off',
      'jsx-a11y-x/alt-text': 'error',
    });
  });
});
