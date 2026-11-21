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
const TENANT_TX_IO = 'platform/no-external-calls-in-tenant-tx';
const OUTBOUND_HTTP = 'platform/outbound-http-via-client';
const PRICING_PURITY = 'platform/pricing-purity';

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
  // Two independent controls: the ADR-0003 allow-list and platform/pricing-purity (AT-US-138-02, TASK-076).
  [
    '[AT-US-138-02] packages/pricing imports node:fs (I/O)',
    'layering/pricing-io/packages/pricing/src/bad-price.ts',
    [BOUNDARIES, PRICING_PURITY],
    '',
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

/**
 * `@platform/shared/logging` is server-only (TASK-010, PR #20 M1, PR20-SEC-11; ADR-0003 am. 2 conventions): one fixture
 * per importer and arm. The specifier arm (`@platform/shared/logging` resolves to the repository's real package, outside
 * the fixture root, so only the specifier matches) and the resolved-file arm (a relative import into the fixture's
 * packages/shared/src/logging); `pino` from the web app; the web build configuration.
 */
const SHARED_LOGGING_ROOT = 'layering/shared-logging-server-only';
const SHARED_LOGGING_MESSAGE = '@platform/shared/logging is server-only (Pino); browser bundles and packages/pricing/ui never import it';
const sharedLoggingCase = (title: string, file: string): Violation => [
  `[TASK-010] ${title}`,
  `${SHARED_LOGGING_ROOT}/${file}`,
  BOUNDARIES,
  SHARED_LOGGING_MESSAGE,
];
const SHARED_LOGGING_IMPORTERS: readonly (readonly [importer: string, dir: string])[] = [
  ['apps/web app code', 'apps/web/app'],
  ['apps/admin app code', 'apps/admin/app'],
  ['packages/ui', 'packages/ui/src'],
  ['packages/pricing', 'packages/pricing/src'],
];
/**
 * The transitive path (PR #20 R2-m1, PR20-SEC-16): a packages/shared module outside src/logging (here the root barrel
 * re-exporting a logging file) would carry Pino into every importer of the `@platform/shared` root. One fixture per arm.
 */
const SHARED_ROOT_DIR = `${SHARED_LOGGING_ROOT}/packages/shared/src`;
const SHARED_ROOT_MESSAGE = 'packages/shared outside src/logging never imports or re-exports the logging module or Pino';
const SHARED_ROOT_CASES: readonly (readonly [title: string, file: string])[] = [
  ['the packages/shared root barrel re-exports a logging file (resolved file)', 'index.ts'],
  ['a packages/shared module imports @platform/shared/logging (package specifier)', 'bad-logging-specifier.ts'],
  ['a packages/shared module imports pino', 'bad-pino.ts'],
];
const SHARED_ROOT_LOGGING: readonly Violation[] = SHARED_ROOT_CASES.map(([title, file]): Violation => [
  `[TASK-010] ${title}`,
  `${SHARED_ROOT_DIR}/${file}`,
  BOUNDARIES,
  SHARED_ROOT_MESSAGE,
]);
const SHARED_LOGGING: readonly Violation[] = [
  ...SHARED_LOGGING_IMPORTERS.flatMap(([importer, dir]) => [
    sharedLoggingCase(`${importer} imports @platform/shared/logging (package specifier)`, `${dir}/bad-logging-specifier.ts`),
    sharedLoggingCase(`${importer} imports packages/shared/src/logging (resolved file)`, `${dir}/bad-logging-resolved.ts`),
  ]),
  sharedLoggingCase('apps/web build configuration (vite.config.ts) imports @platform/shared/logging', 'apps/web/vite.config.ts'),
  sharedLoggingCase('apps/web app code imports pino', 'apps/web/app/bad-pino.ts'),
  ...SHARED_ROOT_LOGGING,
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
  // PR44-SEC-01: the createRequire load itself is also refused (static-module-specifier `loader`).
  bcryptCase(
    'createRequire(import.meta.url)(...)',
    `bcrypt-confinement/${API}/orders/service/bad-create-require.ts`,
    [BOUNDARIES, 'platform/static-module-specifier'],
    '',
  ),
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
  // PR #42 R1-M1 / PR42-SEC-06: the write-capable store and the entry assembler are writer exports too.
  [
    'platform/audit-writer-allowlist: a module outside the allow-list imports the audit store (R1-M1)',
    `rules/audit-writer-allowlist/${API}/orders/service/bad-orders-store.service.ts`,
    'platform/audit-writer-allowlist',
    'allowed only in the audit-writer allow-list',
  ],
  [
    'platform/audit-writer-allowlist: a module outside the allow-list imports the entry assembler (PR42-SEC-06)',
    `rules/audit-writer-allowlist/${API}/orders/service/bad-orders-prepare.service.ts`,
    'platform/audit-writer-allowlist',
    'allowed only in the audit-writer allow-list',
  ],
  // PR #61 R1-M2 / PR61-SEC-02: the vault tokeniser and the privacy composition are writer exports (the composition root
  // excepted, exact file); the vault decrypt pair is narrower still: the audit viewer module only.
  ...(
    [
      ['a module imports the vault tokeniser', `${API}/orders/service/bad-orders-vault-tokeniser.service.ts`],
      ['a module imports the audit privacy composition', `${API}/orders/service/bad-orders-audit-privacy.service.ts`],
      ['a module imports the vault decrypt pair', `${API}/orders/service/bad-orders-vault-decrypt.service.ts`],
      ['a worker job imports the vault tokeniser', 'apps/worker/src/jobs/bad-vault-tokeniser.job.ts'],
      ['a writer-allow-listed module may not decrypt the vault', `${API}/identity/service/bad-identity-vault-decrypt.service.ts`],
      ['the audit viewer may decrypt but not write the vault', `${API}/audit/service/bad-viewer-tokeniser.service.ts`],
    ] as const
  ).map(([title, file]): Violation => [
    `[PR61-SEC-02] platform/audit-writer-allowlist: ${title}`,
    `rules/audit-writer-allowlist/${file}`,
    'platform/audit-writer-allowlist',
    'allowed only in the audit-writer allow-list',
  ]),
  [
    '[PR44-SEC-01 A05] platform/audit-writer-allowlist: the audit writer through an aliased createRequire (R1-m6)',
    `rules/audit-writer-allowlist/${API}/orders/service/bad-create-require-writer.ts`,
    ['platform/audit-writer-allowlist', 'platform/static-module-specifier'],
    '',
  ],
  ['import-x/no-cycle: a <-> b (a)', 'rules/import-cycle/packages/shared/src/bad-a.ts', 'import-x/no-cycle', ''],
  ['import-x/no-cycle: a <-> b (b)', 'rules/import-cycle/packages/shared/src/bad-b.ts', 'import-x/no-cycle', ''],
  ['platform/money-arith: `+` on minor units', 'rules/money-arith/packages/pricing/src/bad-total.ts', 'platform/money-arith', ''],
  [
    '[R1-m2] platform/money-arith: `t += line.amount` (the right-hand side of a compound assignment)',
    'rules/money-arith/packages/pricing/src/bad-compound.ts',
    'platform/money-arith',
    "'amount'",
  ],
  [
    '[R1-m2] platform/money-arith (type-aware): `sum += value` over Minor values',
    'typed/money-arith/packages/pricing/src/bad-minor-compound.ts',
    'platform/money-arith',
    "'value'",
  ],
  [
    '[R2-M1] platform/money-arith (type-aware): a Minor-typed `+=` accumulator (`t += k`, `total += line.amount`)',
    'typed/money-arith/packages/pricing/src/bad-minor-accumulator.ts',
    ['platform/money-arith', 'platform/money-arith'],
    'Arithmetic on the money minor-unit value',
  ],
  [
    '[PR #2 m10] platform/money-arith (type-aware): `+` on two Minor-branded values whose names the heuristic misses',
    'typed/money-arith/packages/pricing/src/bad-minor-brand.ts',
    'platform/money-arith',
    "'net'",
  ],
  ...(
    [
      ['Date.now()', 'bad-date-now', 'Date.now'],
      ['new Date() without an argument', 'bad-new-date', 'new Date()'],
      ['Math.random()', 'bad-math-random', 'Math.random'],
      ['crypto.randomUUID()', 'bad-random-uuid', 'crypto.randomUUID'],
      ['globalThis.crypto.getRandomValues()', 'bad-get-random-values', 'crypto.getRandomValues'],
      ['process.env', 'bad-process-env', 'process.env'],
      ['[R1-m1] a destructured process (const { env } = process)', 'bad-destructured-env', 'process'],
      ['[R1-m1] an aliased Date (const Clock = Date; new Clock())', 'bad-aliased-date', 'Date'],
      ['[R1-m1] process.hrtime.bigint()', 'bad-process-hrtime', 'process.hrtime'],
      ['[R1-m1] process.argv (environment)', 'bad-process-argv', 'process.argv'],
      ['[R1-m1] Date(x) still reads the clock', 'bad-date-call-with-argument', 'Date()'],
      ['[R1-m1] new Date(...spread)', 'bad-new-date-spread', 'new Date()'],
      ['[R1-m1] performance.timeOrigin', 'bad-performance-time-origin', 'performance.timeOrigin'],
      ['[PR076-SEC-01] Math[`random`] through a template key', 'bad-math-template-key', 'Math.random'],
      [
        '[PR076-SEC-01] uuidv7 (clock and randomness) from the allow-listed @platform/shared root',
        'bad-shared-uuidv7',
        '@platform/shared uuidv7',
      ],
      [
        '[PR076-SEC-01] a namespace import of @platform/shared (it carries uuidv7)',
        'bad-shared-namespace',
        '@platform/shared (whole module)',
      ],
      ['[R2-n2] a string-named import specifier { "uuidv7" as id }', 'bad-shared-string-name-import', '@platform/shared uuidv7'],
      ['[R2-n2] a string-named re-export { "uuidv7" as id } from', 'bad-shared-string-name-export', '@platform/shared uuidv7'],
      ['[R2-n1] navigator (locale and environment)', 'bad-navigator', 'navigator.language'],
    ] as const
  ).map(([title, name, what]): Violation => [
    `[AT-US-138-02] ${PRICING_PURITY}: ${title}`,
    `rules/pricing-purity/packages/pricing/src/${name}.ts`,
    PRICING_PURITY,
    `'${what}' is not allowed in packages/pricing`,
  ]),
  [
    '[AT-US-138-02] [PR076-SEC-01] platform/pricing-purity: production code imports a module of its tests/ folder',
    'rules/pricing-purity/packages/pricing/src/bad-tests-import.ts',
    PRICING_PURITY,
    'never imports a test module',
  ],
  [
    '[AT-US-138-02] platform/pricing-purity, the boundaries allow-list and outbound-http-via-client: packages/pricing imports axios',
    'rules/pricing-purity/packages/pricing/src/bad-axios.ts',
    [BOUNDARIES, PRICING_PURITY, OUTBOUND_HTTP],
    '',
  ],
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
  [
    `[PR44-SEC-04] ${OUTBOUND_HTTP}: X04-X08 http2, net (Socket, connect), tls, dgram, dns, dns/promises, child_process (named and import()) and the global WebSocket (bare, globalThis)`,
    `rules/outbound-http-via-client/${API}/carriers/service/bad-network.ts`,
    Array<string>(11).fill(OUTBOUND_HTTP),
    'through OutboundHttpClient',
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
  // T-83: one fixture per source. fetch, undici and node:https are also outbound HTTP (two independent controls).
  ...(
    [
      ['bad-fetch', [TENANT_TX_IO, OUTBOUND_HTTP]],
      ['bad-undici', [TENANT_TX_IO, OUTBOUND_HTTP]],
      ['bad-http', [TENANT_TX_IO, OUTBOUND_HTTP]],
      ['bad-ioredis', TENANT_TX_IO],
      // PR #32 M1: a module service importing the AWS SDK (a value and a type import) is also outside the S3 seam.
      ['bad-aws-sdk', [TENANT_TX_IO, 'no-restricted-imports', 'no-restricted-imports']],
      ['bad-stripe', TENANT_TX_IO],
      ['bad-nodemailer', TENANT_TX_IO],
      ['bad-name-list', TENANT_TX_IO],
      ['bad-name-list-deps', TENANT_TX_IO],
    ] as const
  ).map(([name, ruleId]): Violation => [
    `[T-83] ${TENANT_TX_IO}: ${name}`,
    `rules/no-external-calls-in-tenant-tx/${API}/orders/service/${name}.ts`,
    ruleId,
    // The fragment must be in every finding, so the two-control cases match on the rule ids only.
    typeof ruleId === 'string' ? 'inside a withTenantTx callback' : '',
  ]),
  ...['bad-sleep', 'bad-timers-promises'].map((name): Violation => [
    `[T-83] ${TENANT_TX_IO}: ${name}`,
    `rules/no-external-calls-in-tenant-tx/${API}/orders/service/${name}.ts`,
    TENANT_TX_IO,
    'sleeps inside a withTenantTx callback',
  ]),
  [
    `[T-83] ${TENANT_TX_IO}: a server package (packages/carriers) constructs a BullMQ queue inside the callback`,
    'rules/no-external-calls-in-tenant-tx/packages/carriers/src/bad-bullmq.ts',
    TENANT_TX_IO,
    "'Queue' (bullmq)",
  ],
  // D-ARCH-106 (5)/(7), PR32-SEC-01 (security condition C1), PR #32 code review m4: the roots R2, R3, R5 and R6. A
  // fixture with N findings of the rule lists the rule N times.
  ...(
    [
      [
        'R2 inline defineRoute handler: fetch plus a setTimeout sleep',
        'routes/bad-handler-inline',
        [TENANT_TX_IO, TENANT_TX_IO, OUTBOUND_HTTP],
        '',
      ],
      [
        'R3 named same-file handlers (function declaration, const arrow)',
        'routes/bad-handler-named',
        [TENANT_TX_IO, TENANT_TX_IO],
        'sleeps inside a defineRoute handler',
      ],
      ['R2 deps.queue.add() in a handler', 'routes/bad-handler-queue', TENANT_TX_IO, 'runs inside a defineRoute handler'],
      [
        'R2 handler() {} and async handler() {} method shorthand',
        'routes/bad-handler-method',
        [TENANT_TX_IO, TENANT_TX_IO],
        'runs inside a defineRoute handler',
      ],
      [
        "R2 a spread without transaction: 'none', a spread after it, a non-literal value",
        'routes/bad-handler-spread',
        [TENANT_TX_IO, TENANT_TX_IO, TENANT_TX_IO],
        'runs inside a defineRoute handler',
      ],
      ["R2 fixtureRoute with transaction: 'tenant'", 'routes/bad-fixture-route-tenant', TENANT_TX_IO, 'runs inside a defineRoute handler'],
      ['R6 create(db: AppDb) calling fetch', 'service/bad-app-db', [TENANT_TX_IO, OUTBOUND_HTTP], ''],
      [
        'R6 a service method with db: TenantDb calling deps.queue.add()',
        'service/bad-tenant-db-service',
        TENANT_TX_IO,
        'runs inside a function that receives a tenant transaction handle',
      ],
      [
        'R6 TenantDb<X>, Db.AppTransactionClient with a default value, a destructured TenantDb',
        'service/bad-tx-handle-forms',
        [TENANT_TX_IO, TENANT_TX_IO, TENANT_TX_IO],
        'runs inside a function that receives a tenant transaction handle',
      ],
    ] as const
  ).map(([title, name, ruleId, message]): Violation => [
    `[PR32-SEC-01] [D-ARCH-106] ${TENANT_TX_IO}: ${title}`,
    `rules/no-external-calls-in-tenant-tx/${API}/orders/${name}.ts`,
    ruleId,
    message,
  ]),
  // TASK-020 part C: R4 (D-ARCH-106 (5)), the load phase is a root in every form and whatever the transaction.
  [
    `[TASK-020] [D-ARCH-106] ${TENANT_TX_IO}: R4 load phase (arrow, function expression, load() {}, async load() {}, named declaration and const, transaction: 'none', fixtureRoute)`,
    `rules/no-external-calls-in-tenant-tx/${API}/orders/routes/bad-load.ts`,
    Array<string>(8).fill(TENANT_TX_IO),
    'runs inside a defineRoute load phase (it runs in a read-only tenant transaction)',
  ],
  [
    `[TASK-020] [D-ARCH-106] ${TENANT_TX_IO}: R4 call is never a root (fetch and a setTimeout sleep in call; only outbound-http fires)`,
    `rules/no-external-calls-in-tenant-tx/${API}/orders/routes/ok-call-phase.ts`,
    OUTBOUND_HTTP,
    '',
  ],
  // D-ARCH-111: the T-83 rule residuals (a)-(g). A fixture with N findings of the rule lists the rule N times.
  ...(
    [
      ['(a) a same-file const spec literal is walked (handler and load)', 'routes/bad-spec-const', 2, 'runs inside a defineRoute'],
      [
        '(a) a spec that is a parameter, an import, a call result or a let is reported',
        'routes/bad-spec-unreadable',
        4,
        'declare route specs as an inline literal or a same-file const literal',
      ],
      [
        '(b) wrapped phases are walked through their function arguments (inline, named, nested, load) and a conditional through both branches',
        'routes/bad-handler-wrapped',
        4,
        'runs inside a defineRoute',
      ],
      [
        '(b) a handler or load that is a parameter, a let, or a call with no function argument (inline or const) is reported',
        'routes/bad-handler-unresolved',
        5,
        'declare route handlers inline or as same-file const functions',
      ],
      ['(c) defineRoute and fixtureRoute through an import alias', 'routes/bad-factory-alias', 2, 'runs inside a defineRoute handler'],
      [
        '(d) holder chains at any depth (ctx.deps.queue, services.queue, this.x.queue) and one same-function const alias',
        'service/bad-holder-depth',
        4,
        'runs inside a withTenantTx callback',
      ],
      [
        '(e) every method of a class whose constructor takes a TenantDb parameter property',
        'service/bad-injected-handle',
        2,
        'runs inside a method of a class constructed with a tenant transaction handle',
      ],
      [
        '(f) scheduler.wait (named alias, namespace member) and Atomics.wait',
        'service/bad-waits',
        3,
        'sleeps inside a withTenantTx callback',
      ],
      [
        '(g) a literal import() of an external client module (string and template literal)',
        'service/bad-dynamic-import',
        2,
        'runs inside a withTenantTx callback',
      ],
    ] as const
  ).map(([title, name, count, message]): Violation => [
    `[D-ARCH-111] ${TENANT_TX_IO}: ${title}`,
    `rules/no-external-calls-in-tenant-tx/${API}/orders/${name}.ts`,
    Array<string>(count).fill(TENANT_TX_IO),
    message,
  ]),
  // PR #44 code review R1-m5 / R1-n8 and PR44-SEC-04: the residual route-spec shapes and sources. Each fixture injects
  // a deps.queue.add() or a sleep, so outbound-http-via-client cannot mask the result.
  ...(
    [
      [
        'R1-m5 (a) S01-S04 a spread of a same-file const or inline phases literal is walked (recursively)',
        'routes/bad-phase-spread',
        5,
        'runs inside a defineRoute',
      ],
      [
        'R1-m5 (a) a spread of a parameter, an import, a call result or a let with no handler after it is reported',
        'routes/bad-spread-unreadable',
        4,
        'declare route specs as an inline literal or a same-file const literal',
      ],
      [
        'K02-K04 a template-literal key and a const string key resolve like the plain key (handler and load)',
        'routes/bad-computed-key',
        4,
        'runs inside a defineRoute',
      ],
      [
        'K02-K04 any other computed key in a route spec is reported',
        'routes/bad-computed-key-unreadable',
        2,
        'declare route specs as an inline literal or a same-file const literal',
      ],
      [
        'F01-F03 defineRoute.call, a const alias, a sequence callee and an import alias used as a value are reported',
        'routes/bad-factory-indirection',
        4,
        'so the tenant-transaction lint can see the route spec',
      ],
      ['H03 a ??, || or && phase is walked through every operand', 'routes/bad-handler-logical', 3, 'runs inside a defineRoute'],
      [
        'R1-m5 (b) Q2 a const conditional, a const ?? and a const alias of it are followed',
        'routes/bad-handler-const-conditional',
        3,
        'runs inside a defineRoute',
      ],
      [
        'R1-n8 a destructured names key (const { queue: jobs } = deps, nested) matches like the const alias',
        'service/bad-holder-destructure',
        2,
        'runs inside a withTenantTx callback',
      ],
      [
        'X01-X03 node:timers (named, namespace, .promises), timers/promises setInterval, global.setTimeout, globalThis.setInterval',
        'service/bad-node-timers',
        7,
        'sleeps inside a withTenantTx callback',
      ],
    ] as const
  ).map(([title, name, count, message]): Violation => [
    `[PR44-SEC-04] ${TENANT_TX_IO}: ${title}`,
    `rules/no-external-calls-in-tenant-tx/${API}/orders/${name}.ts`,
    Array<string>(count).fill(TENANT_TX_IO),
    message,
  ]),
  [
    `[PR44-SEC-04] ${TENANT_TX_IO}: X04-X08 http2, net, tls, dgram, dns, dns/promises, child_process and the global WebSocket (T-83 and NFR-SEC-010 each)`,
    `rules/no-external-calls-in-tenant-tx/${API}/orders/service/bad-network-modules.ts`,
    [...Array<string>(8).fill(TENANT_TX_IO), ...Array<string>(8).fill(OUTBOUND_HTTP)],
    '',
  ],
  // Code review R2-m3 / R2-n3, PR44-SEC-11 (b) and PR44-SEC-14 (020-D): holder aliases in any enclosing scope (the
  // module-level forms crashed the rule), destructured holder methods, and the remaining timer forms.
  ...(
    [
      [
        '[PR44-SEC-11] R2-m3 a module-level const alias of a holder chain (no crash, reported)',
        'bad-holder-module-alias',
        1,
        0,
        'runs inside',
      ],
      [
        '[PR44-SEC-11] R2-m3 a module-level destructuring alias of a names key (no crash, reported)',
        'bad-holder-module-destructure',
        1,
        0,
        'runs inside',
      ],
      ['[PR44-SEC-14] R2-n3 a holder alias declared in the enclosing DI factory function', 'bad-holder-factory-alias', 1, 0, 'runs inside'],
      [
        '[PR44-SEC-14] R2-n3 a method destructured from a holder chain, flat and nested, called bare',
        'bad-holder-destructured-method',
        2,
        0,
        'runs inside',
      ],
      [
        '[PR44-SEC-14] R1-n2 a member alias of a holder method (const add = deps.queue.add, module-level .bind), called bare',
        'bad-holder-member-alias',
        2,
        0,
        'runs inside',
      ],
      [
        '[PR44-SEC-14] import { promises } / { promises as tp } from node:timers / timers, then .setTimeout / .scheduler.wait',
        'bad-timers-promises-member',
        3,
        1,
        '',
      ],
      [
        '[PR44-SEC-14] a literal import() of node:timers/promises, timers/promises and `node:timers`, and a const holding one',
        'bad-timers-dynamic-import',
        4,
        1,
        '',
      ],
    ] as const
  ).map(([title, name, count, nodePath, message]): Violation => [
    `${TENANT_TX_IO}: ${title}`,
    `rules/no-external-calls-in-tenant-tx/${API}/orders/service/${name}.ts`,
    [...Array<string>(count).fill(TENANT_TX_IO), ...Array<string>(nodePath).fill('platform/node-path-only')],
    message,
  ]),
  [
    `[PR32-SEC-01] [D-ARCH-106] ${TENANT_TX_IO}: R5 a function in a txFiles file (apps/api/src/platform/audit/)`,
    'rules/no-external-calls-in-tenant-tx/apps/api/src/platform/audit/bad-audit-hook.ts',
    TENANT_TX_IO,
    'runs inside a tenant-transaction file',
  ],
  [
    `[PR42-SEC-07] ${TENANT_TX_IO}: R6 a tokeniser taking db: AuditSqlPort (a sleep and fetch; outbound-http fires too)`,
    'rules/no-external-calls-in-tenant-tx/packages/audit/src/bad-kms-tokeniser.ts',
    [TENANT_TX_IO, TENANT_TX_IO, OUTBOUND_HTTP],
    '',
  ],
  [
    `[PR32-SEC-01] [D-ARCH-106] ${TENANT_TX_IO}: R6 is type-name based (ctx: CarrierContext, db: DatabaseRuntime and a TenantDb callback type are not roots; only outbound-http fires)`,
    'rules/no-external-calls-in-tenant-tx/packages/carriers/src/ok-carrier-context.ts',
    OUTBOUND_HTTP,
    '',
  ],
  // PR20-SEC-13 item 4 (a) and (b).
  ...[
    'apps/api/src/platform/bad-template.ts',
    'apps/api/src/platform/bad-concat.ts',
    'apps/api/src/platform/bad-destructured.ts',
    'packages/carriers/src/bad-binding.ts',
  ].map((path): Violation => [
    `[PR20-SEC-13] platform/no-catch-message-interpolation: ${path}`,
    `rules/no-catch-message-interpolation/${path}`,
    'platform/no-catch-message-interpolation',
    "the caught error's text",
  ]),
  ...[
    'apps/api/src/platform/http/bad-stringify.ts',
    'apps/api/src/platform/http/bad-template.ts',
    'apps/api/src/platform/http/bad-inspect.ts',
    'tools/bad-string.mjs',
  ].map((path): Violation => [
    `[PR20-SEC-13] platform/no-raw-request-in-log: ${path}`,
    `rules/no-raw-request-in-log/${path}`,
    'platform/no-raw-request-in-log',
    'bypassing the Pino serializers',
  ]),
  [
    '[PR #21 R1-m5] no-restricted-imports: a tests/api spec imports supertest directly (not through the contract helper)',
    'rules/supertest-confinement/tests/api/bad-supertest.api.test.ts',
    'no-restricted-imports',
    "import 'supertest' only in tests/api/helpers",
  ],
  ...(
    [
      ['RegExp literal paths in app.use and router.get', 'bad-regexp-literal', 2],
      ['new RegExp(...), RegExp(...) and a RegExp in an array of paths', 'bad-regexp-constructor', 3],
    ] as const
  ).map(([title, name, count]): Violation => [
    `[PR #32 m5] [PR32-SEC-11] no-restricted-syntax: ${title}`,
    `rules/regexp-route-path/apps/api/src/platform/http/${name}.ts`,
    Array.from({ length: count }, () => 'no-restricted-syntax'),
    'OpenAPI drift walker',
  ]),
  ...[`${API}/documents/service/bad-s3-client.ts`, 'packages/carriers/src/bad-sigv4.ts'].map((path): Violation => [
    `[PR #32 M1] [D-ARCH-097] no-restricted-imports: the S3 SDK outside apps/api/src/platform/storage (${path})`,
    `rules/s3-sdk-confinement/${path}`,
    'no-restricted-imports',
    'only apps/api/src/platform/storage imports the AWS SDK',
  ]),
  ...(
    [
      ['a value import', 'bad-carriers-deep-value'],
      ['an import type', 'bad-carriers-deep-type'],
      ['an export type … from', 'bad-carriers-deep-reexport'],
    ] as const
  ).map(([title, name]): Violation => [
    `[AT-US-121-05] no-restricted-imports: a deep @platform/carriers/* specifier (${title})`,
    `rules/carriers-deep-import/${API}/quotes/service/${name}.ts`,
    'no-restricted-imports',
    'import @platform/carriers from its package root only',
  ]),
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

const TOKEN_LINT = 'platform/token-lint';

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
  // platform/token-lint (US-101, TASK-038): one fixture per refused shape.
  ['[AT-US-101-02] a hex colour (#ff0000) fails with the literal named', 'css/bad-token-hex-colour.css', TOKEN_LINT, '#ff0000'],
  ['[AT-US-101-02] rgb(0, 0, 0) fails', 'css/bad-token-rgb-colour.css', TOKEN_LINT, 'rgb('],
  ['[AT-US-101-02] hsl() fails', 'css/bad-token-hsl-colour.css', TOKEN_LINT, 'hsl('],
  ['[AT-US-101-02] a named colour in a colour property fails', 'css/bad-token-named-colour.css', TOKEN_LINT, 'rebeccapurple'],
  ['[AT-US-101-03] margin: 13px (off the 4/8 grid) fails', 'css/bad-token-off-grid-px.css', TOKEN_LINT, '13px'],
  ['[AT-US-101-03] an off-grid rem length (0.8125rem = 13px) fails', 'css/bad-token-off-grid-rem.css', TOKEN_LINT, '0.8125rem'],
  ['[AT-US-101-05] var(--colour-nonexistent) fails as an unknown token', 'css/bad-token-unknown.css', TOKEN_LINT, '--colour-nonexistent'],
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
    'platform/db-raw-sql: `const { raw } = Prisma` from the workspace specifier @platform/prisma/client in platform/db (PR38-SEC-01)',
    'rules/db-raw-sql/apps/api/src/platform/db/bad-raw-bare-specifier.ts',
    'platform/db-raw-sql',
    'Prisma.raw interpolates SQL',
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
  // R2-m1 / PR11-SEC-13: the helpers are resolved through scope analysis, whatever the local name.
  [
    'platform/db-raw-sql: `import { Prisma as P }` + P.raw(s) in a repository (R2-m1, PR11-SEC-13)',
    `rules/db-raw-sql/${API}/orders/repository/bad-raw-aliased-import.ts`,
    'platform/db-raw-sql',
    'Prisma.raw interpolates SQL',
  ],
  [
    'platform/db-raw-sql: `const { raw } = Prisma` in a repository (R2-m1, PR11-SEC-13)',
    `rules/db-raw-sql/${API}/orders/repository/bad-raw-destructured.ts`,
    'platform/db-raw-sql',
    'Prisma.raw interpolates SQL',
  ],
  [
    'platform/db-raw-sql: `const r = Prisma.raw` in a repository (R2-m1, PR11-SEC-13)',
    `rules/db-raw-sql/${API}/orders/repository/bad-raw-const-alias.ts`,
    'platform/db-raw-sql',
    'Prisma.raw interpolates SQL',
  ],
  [
    'platform/db-raw-sql: `new Prisma.Sql([s], [])` in a repository (PR11-SEC-13)',
    `rules/db-raw-sql/${API}/orders/repository/bad-new-sql.ts`,
    'platform/db-raw-sql',
    "Prisma's Sql class",
  ],
  [
    'platform/db-raw-sql: a non-tagged `Prisma.sql([s])` call in a repository (PR11-SEC-13)',
    `rules/db-raw-sql/${API}/orders/repository/bad-sql-call.ts`,
    'platform/db-raw-sql',
    'only as a template tag',
  ],
  [
    'platform/db-raw-sql: `Prisma.join(ids, separator)` with a variable separator (PR11-SEC-13)',
    `rules/db-raw-sql/${API}/orders/repository/bad-join-separator.ts`,
    'platform/db-raw-sql',
    'are SQL text',
  ],
  [
    "platform/db-raw-sql: `import { Sql } from '@prisma/client/runtime/client'` (PR11-SEC-13)",
    `rules/db-raw-sql/${API}/orders/repository/bad-runtime-sql-import.ts`,
    'platform/db-raw-sql',
    "Prisma's Sql class",
  ],
  [
    'platform/db-raw-sql: a named import of makeTypedQueryFactory (PR11-SEC-15 f)',
    `rules/db-raw-sql/${API}/orders/repository/bad-typed-query-factory.ts`,
    'platform/db-raw-sql',
    'builds a TypedSql query',
  ],
  [
    "platform/db-raw-sql: `export { raw } from '@prisma/client/runtime/client'` (PR11-SEC-13)",
    `rules/db-raw-sql/${API}/orders/repository/bad-reexport-raw.ts`,
    'platform/db-raw-sql',
    'Re-exporting',
  ],
  [
    'platform/db-raw-sql: the service-layer variant `const { raw: fragment } = P` (also outside the Prisma layering)',
    `rules/db-raw-sql/${API}/orders/service/bad-raw-aliased.service.ts`,
    [BOUNDARIES, 'platform/db-raw-sql'],
    'ADR-000',
  ],
  // R2-M1 / PR11-SEC-12 / PR11-SEC-15 g: the escapes from the tenant transaction, by member, pattern or template key.
  [
    'platform/db-raw-sql: `.requestTransaction(null)` on a PrismaPromise (R2-M1, PR11-SEC-12)',
    `rules/db-raw-sql/${API}/orders/repository/bad-request-transaction.ts`,
    'platform/db-raw-sql',
    'caller-chosen transaction',
  ],
  [
    'platform/db-raw-sql: `db._originalClient` (R2-M1)',
    `rules/db-raw-sql/${API}/orders/repository/bad-original-client.ts`,
    'platform/db-raw-sql',
    'is the root client',
  ],
  [
    'platform/db-raw-sql: `const { $queryRawUnsafe } = db` (PR11-SEC-15 g)',
    `rules/db-raw-sql/${API}/orders/repository/bad-destructured-unsafe.ts`,
    'platform/db-raw-sql',
    'interpolates SQL',
  ],
  [
    'platform/db-raw-sql: db[`$parent`] (a template-literal computed key, PR11-SEC-15 g)',
    `rules/db-raw-sql/${API}/orders/repository/bad-template-key-parent.ts`,
    'platform/db-raw-sql',
    'reaches an unguarded client',
  ],
  // PR11-SEC-17 a / PR #11 R3-n2: every other use of a tracked container, fragment constructors, non-tag reads of the
  // raw members and `db[k]`, one fixture per form.
  [
    '[PR11-SEC-17] platform/db-raw-sql: the Prisma namespace as a call argument',
    `rules/db-raw-sql/${API}/orders/repository/bad-container-argument.ts`,
    'platform/db-raw-sql',
    'passed on as a value',
  ],
  [
    '[PR11-SEC-17] platform/db-raw-sql: the Prisma namespace in an object literal',
    `rules/db-raw-sql/${API}/orders/repository/bad-container-literal.ts`,
    'platform/db-raw-sql',
    'passed on as a value',
  ],
  [
    '[PR11-SEC-17] platform/db-raw-sql: the Prisma namespace through ?: and ??',
    `rules/db-raw-sql/${API}/orders/repository/bad-container-conditional.ts`,
    ['platform/db-raw-sql', 'platform/db-raw-sql'],
    'passed on as a value',
  ],
  [
    '[PR11-SEC-17] platform/db-raw-sql: new (Prisma.sql.constructor)(…)',
    `rules/db-raw-sql/${API}/orders/repository/bad-sql-constructor.ts`,
    'platform/db-raw-sql',
    'passed on as a value',
  ],
  [
    '[PR11-SEC-17] [R3-n2] platform/db-raw-sql: new (fragment.constructor)([s], []) (the Sql class of a tagged fragment)',
    `rules/db-raw-sql/${API}/orders/repository/bad-fragment-constructor.ts`,
    'platform/db-raw-sql',
    "Prisma's Sql class",
  ],
  [
    '[PR11-SEC-17] platform/db-raw-sql: an aliased $queryRaw (db.$queryRaw.bind(db))',
    `rules/db-raw-sql/${API}/orders/repository/bad-raw-member-alias.ts`,
    'platform/db-raw-sql',
    'read other than as a template tag',
  ],
  [
    '[PR11-SEC-17] platform/db-raw-sql: Reflect.apply(db.$executeRaw, db, args)',
    `rules/db-raw-sql/${API}/orders/repository/bad-reflect-apply.ts`,
    'platform/db-raw-sql',
    'read other than as a template tag',
  ],
  [
    '[PR11-SEC-17] platform/db-raw-sql: db[k] (a computed member of a database handle)',
    `rules/db-raw-sql/${API}/orders/repository/bad-dynamic-member.ts`,
    'platform/db-raw-sql',
    'A computed member of a database handle',
  ],
  // PR44-SEC-05 (TASK-020 part 020-D): transaction-control, session and setter statements in a tagged raw template.
  [
    '[PR44-SEC-05] platform/db-raw-sql: COMMIT, ROLLBACK, END, a second statement, SAVEPOINT, BEGIN, PREPARE TRANSACTION',
    `rules/db-raw-sql/${API}/orders/repository/bad-raw-transaction-control.ts`,
    Array<string>(7).fill('platform/db-raw-sql'),
    'A raw statement may not end, nest or prepare the transaction',
  ],
  [
    '[PR44-SEC-05] platform/db-raw-sql: SET search_path, SET SESSION CHARACTERISTICS, RESET ALL, DISCARD ALL, LISTEN, NOTIFY, SET TRANSACTION READ ONLY',
    `rules/db-raw-sql/${API}/orders/repository/bad-raw-session.ts`,
    Array<string>(7).fill('platform/db-raw-sql'),
    'A raw statement may not change the pooled session',
  ],
  [
    '[PR44-SEC-05] [D-SEC-PR42-02] platform/db-raw-sql: UPDATE pg_settings, a DO block with a concatenated setter, a non-literal is_local',
    `rules/db-raw-sql/${API}/orders/repository/bad-raw-setters.ts`,
    [...Array<string>(3).fill('platform/db-raw-sql'), TENANT_CONTEXT],
    '',
  ],
  [
    '[PR44-SEC-05] platform/db-raw-sql: the withTenantTx exemption admits SET TRANSACTION READ ONLY only (READ WRITE in the same file fails)',
    'rules/db-raw-sql/apps/api/src/platform/db/with-tenant-tx.ts',
    'platform/db-raw-sql',
    'A raw statement may not change the pooled session (SET)',
  ],
  // PR54-SEC-01 / PR54-SEC-02 (a), code review R1-M1 / R1-m3 / R1-n3 (PR #54): the lexer reads as PostgreSQL does, the
  // session forms widened, and the statement check in package sources.
  [
    '[PR54-SEC-01] platform/db-raw-sql: a CR-ended comment, a Unicode space before a dollar tag, a continued E string, $q${v}$q$, DECLARE, FETCH, a session advisory lock, a string-syntax setting',
    `rules/db-raw-sql/${API}/orders/repository/bad-raw-lexer-forms.ts`,
    // The Unicode-space template is also unreadable to rawSystemTable (fails closed).
    [...Array<string>(8).fill('platform/db-raw-sql'), 'platform/system-model-owner'],
    '',
  ],
  [
    '[PR54-SEC-04] platform/db-raw-sql: COMMIT in a package source (the statement check alone)',
    'rules/db-raw-sql/packages/shared/src/bad-raw-package-statement.ts',
    'platform/db-raw-sql',
    'A raw statement may not end, nest or prepare the transaction (COMMIT)',
  ],
  // D-ARCH-124 / PR32-SEC-07 (c) (TASK-020 part 020-D): a raw template names a SYSTEM table only from its owner's code.
  [
    '[D-ARCH-124] platform/system-model-owner: a quotes repository names outbox_events (plain, PUBLIC.-qualified upper case, quoted, DELETE)',
    `rules/system-model-owner/${API}/quotes/repository/bad-raw-outbox-events.ts`,
    Array<string>(4).fill('platform/system-model-owner'),
    "names the SYSTEM table outbox_events, declared by the 'outbox' table-class manifest",
  ],
  [
    '[D-ARCH-124] platform/system-model-owner: a module repository names audit_entries (a monthly partition) and audit_pii_vault',
    `rules/system-model-owner/${API}/orders/repository/bad-raw-audit-entries.ts`,
    Array<string>(3).fill('platform/system-model-owner'),
    "declared by the 'audit' table-class manifest",
  ],
  [
    '[D-ARCH-124] platform/system-model-owner: a Unicode-escape identifier makes the raw template unreadable (fails closed)',
    `rules/system-model-owner/${API}/orders/repository/bad-raw-unreadable.ts`,
    ['platform/system-model-owner', 'platform/db-raw-sql', TENANT_CONTEXT],
    'Unicode-escape',
  ],
  [
    '[PR54-SEC-01] platform/system-model-owner: audit_entries behind a CR-ended comment, a continued E string, $q${v}$q$; a Unicode space before a dollar tag (unreadable)',
    `rules/system-model-owner/${API}/orders/repository/bad-raw-lexer-disguises.ts`,
    [...Array<string>(4).fill('platform/system-model-owner'), 'platform/db-raw-sql'],
    '',
  ],
  // PR19-SEC-01 / D-ARCH-080: SYSTEM delegates only in the module whose table-class manifest declares the table.
  [
    '[PR19-SEC-01] platform/system-model-owner: a module repository touching the outbox delegate outside the allow-list',
    `rules/system-model-owner/${API}/orders/repository/bad-outbox-delegate.ts`,
    'platform/system-model-owner',
    "declared by the 'outbox' table-class manifest",
  ],
  [
    '[PR19-SEC-01] platform/system-model-owner: the accessor result kept in a variable (even in the owning module)',
    'rules/system-model-owner/apps/api/src/platform/outbox/bad-accessor-alias.ts',
    'platform/system-model-owner',
    'hides which SYSTEM model is reached',
  ],
  // PR32-SEC-07 (a) and (b).
  [
    '[PR32-SEC-07] platform/system-model-owner: a template-literal import() of platform/db/system-db.js (S2)',
    `rules/system-model-owner/${API}/orders/repository/bad-template-import.ts`,
    'platform/system-model-owner',
    'hides which SYSTEM model is reached',
  ],
  [
    '[PR32-SEC-07] platform/system-model-owner: createRequire(import.meta.url)(literal) of the SYSTEM accessor',
    `rules/system-model-owner/${API}/orders/repository/bad-create-require-accessor.ts`,
    // PR44-SEC-01: the createRequire load itself is also refused (static-module-specifier `loader`).
    ['platform/system-model-owner', 'platform/static-module-specifier'],
    '',
  ],
  [
    '[PR32-SEC-07] platform/system-model-owner: a platform/db file other than system-db.ts / tenant-db.ts re-exports the accessor (S4a)',
    'rules/system-model-owner/apps/api/src/platform/db/bad-reexport-accessor.ts',
    'platform/system-model-owner',
    'Re-exporting the SYSTEM accessor',
  ],
  [
    '[PR32-SEC-07] platform/static-module-specifier: a computed import(where) (S3)',
    `rules/system-model-owner/${API}/orders/service/bad-computed-import.ts`,
    'platform/static-module-specifier',
    'loads a module through a computed specifier',
  ],
  [
    '[PR32-SEC-07] platform/static-module-specifier: createRequire(import.meta.url)(x), a createRequire alias, module.require(x)',
    `rules/system-model-owner/${API}/orders/service/bad-computed-require.ts`,
    // Three computed loads, plus (PR44-SEC-01) two createRequire uses: called and stored.
    Array<string>(5).fill('platform/static-module-specifier'),
    'the import controls',
  ],
  [
    '[D-ARCH-111] platform/static-module-specifier: an import alias of createRequire (direct and kept in a variable) and a namespace member',
    `rules/system-model-owner/${API}/orders/service/bad-create-require-alias.ts`,
    // Three computed loads, plus (PR44-SEC-01) three createRequire uses, plus (PR44-SEC-14) the namespace import.
    [...Array<string>(6).fill('platform/static-module-specifier'), 'no-restricted-imports'],
    'the import controls',
  ],
  // PR44-SEC-01: createRequire is legal only as createRequire(<url>).resolve(<literal>) (static-module-specifier `loader`).
  [
    '[PR44-SEC-01 A13] platform/static-module-specifier: the pg driver through a createRequire loader kept in a variable',
    `rules/system-model-owner/${API}/orders/service/bad-require-pg.ts`,
    'platform/static-module-specifier',
    'uses createRequire other than as createRequire(<url>).resolve',
  ],
  [
    '[PR44-SEC-01] platform/static-module-specifier: createRequire aliased, passed, returned, destructured, via import() and getBuiltinModule, a computed resolve',
    `rules/system-model-owner/${API}/orders/service/bad-create-require-escapes.ts`,
    // PR44-SEC-14 (020-D): plus the namespace import (no-restricted-imports) and process.getBuiltinModule (no-restricted-properties).
    [...Array<string>(7).fill('platform/static-module-specifier'), 'no-restricted-imports', 'no-restricted-properties'],
    'the import controls',
  ],
  [
    '[PR44-SEC-01] platform/static-module-specifier: re-exporting createRequire from node:module',
    `rules/system-model-owner/${API}/orders/service/bad-create-require-reexport.ts`,
    'platform/static-module-specifier',
    'uses createRequire other than as createRequire(<url>).resolve',
  ],
  // PR44-SEC-10 / code review R2-m2 (020-D): the node:module value fails closed; a computed key that is not a static
  // string, and every use of the dynamic import other than a static member read, is a `loader` finding.
  ...(
    [
      ['a computed member nm[k] of the namespace import', 'bad-node-module-computed-key', 1, ['no-restricted-imports']],
      ['a computed destructuring key const { [k]: v } = nm', 'bad-node-module-computed-destructure', 1, ['no-restricted-imports']],
      ["Reflect.get(await import('node:module'), k) (D-TASK020-59)", 'bad-node-module-reflect-get', 1, []],
      ["a two-hop alias of await import('node:module'), then its createRequire", 'bad-node-module-import-alias', 2, []],
      [
        "import('node:module').then(...) handing the module on (parameter passed, non-inline callback)",
        'bad-node-module-import-then',
        2,
        [],
      ],
      ["process.getBuiltinModule('module')[k]", 'bad-node-module-builtin-computed', 1, ['no-restricted-properties']],
      // PR54-SEC-03 / code review R1-m1: every node:module value is bounded by NODE_MODULE_ALLOWED.
      [
        'PR54-SEC-03 node:module members outside the allow-list (.Module, register, registerHooks, default x2, inline .then, a rest, getBuiltinModule)',
        'bad-node-module-members',
        8,
        ['no-restricted-properties'],
      ],
      [
        "PR54-SEC-03 control: const { createRequire } = await import('node:module') stays one finding",
        'bad-node-module-destructured-create-require',
        1,
        [],
      ],
    ] as const
  ).map(([title, name, count, config]): Violation => [
    `[PR44-SEC-10] platform/static-module-specifier: ${title}`,
    `rules/system-model-owner/${API}/orders/service/${name}.ts`,
    [...Array<string>(count).fill('platform/static-module-specifier'), ...config],
    '',
  ]),
  // PR44-SEC-11 (a) (020-D): reads of `import x = ...` bindings no longer crash platform/static-module-specifier (or T-83).
  [
    "[PR44-SEC-11] import pg = require('pg') read in a module service lints (boundaries sees the driver load)",
    `rules/system-model-owner/${API}/orders/service/bad-import-equals-require.ts`,
    ['@typescript-eslint/no-require-imports', BOUNDARIES],
    '',
  ],
  [
    '[PR44-SEC-11] import X = NS.y read in a module service lints (no loader, no module load)',
    `rules/system-model-owner/${API}/orders/service/bad-import-equals-namespace.ts`,
    '@typescript-eslint/no-namespace',
    '',
  ],
  ['[D-ARCH-111] no-eval: eval(code) in apps/api/src', `rules/no-eval/${API}/orders/service/bad-eval.ts`, 'no-eval', 'eval'],
  // PR44-SEC-14 (TASK-020 part 020-D): built-in loaders outside every import control.
  [
    '[PR44-SEC-14] no-restricted-imports: Module, register, the default and a namespace import of node:module, getBuiltinModule from node:process',
    `rules/builtin-loaders/${API}/orders/service/bad-node-module-imports.ts`,
    [...Array<string>(5).fill('no-restricted-imports'), 'platform/node-path-only'],
    '',
  ],
  [
    '[PR44-SEC-14] no-restricted-properties: process.getBuiltinModule (direct, globalThis.process, destructured), binding, _linkedBinding, dlopen',
    `rules/builtin-loaders/${API}/orders/service/bad-process-loaders.ts`,
    Array<string>(6).fill('no-restricted-properties'),
    'load built-in or native modules',
  ],
  [
    '[PR54-SEC-03] platform/static-module-specifier processMember: process[k], an alias, a default, a rest, Reflect / Object; binding property-only',
    `rules/builtin-loaders/${API}/orders/service/bad-process-respellings.ts`,
    [...Array<string>(8).fill('platform/static-module-specifier'), ...Array<string>(3).fill('no-restricted-properties')],
    '',
  ],
  [
    '[PR44-SEC-14] no-restricted-properties: process.getBuiltinModule in packages/*/src',
    'rules/builtin-loaders/packages/shared/src/bad-timers-builtin.ts',
    'no-restricted-properties',
    'load built-in or native modules',
  ],
  // R2-m2 / PR11-SEC-15 g: the quoted and spaced GUC names of the shared form list.
  [
    'platform/tenant-context-sql: SET of a double-quoted namespace and key in a repository (R2-m2)',
    `rules/tenant-context-sql/${API}/orders/repository/bad-session-set-quoted.ts`,
    TENANT_CONTEXT,
    'Session-level SET/RESET',
  ],
  [
    'platform/tenant-context-sql: SET of a namespace and key spaced around the dot in a repository (R2-m2)',
    `rules/tenant-context-sql/${API}/orders/repository/bad-session-set-spaced.ts`,
    TENANT_CONTEXT,
    'Session-level SET/RESET',
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
  // PR44-SEC-01 / R1-m6: require-style loads of the client (moduleSourceVisitor sees every isRequireCall form), the
  // constructor through an alias, and the rule on in platform/db outside the three client homes. Every createRequire
  // load is also a static-module-specifier `loader` finding; both messages cite PR44-SEC-01.
  ...(
    [
      ['F08: a createRequire loader kept in a variable loads the client', 'bad-require-variable', 1],
      ['F09: an import alias of createRequire, mk(u)(G)', 'bad-create-require-alias', 1],
      ['F10: a namespace member, m.createRequire(u)(G)', 'bad-create-require-namespace', 1],
      ['F11: a default-import member, module.createRequire(u)(G)', 'bad-create-require-default', 1],
      ['F17: new C() through a member alias and a destructuring alias of the constructor', 'bad-new-alias', 4],
      ['code review p8: inline createRequire(u)(G), then new PrismaClient()', 'bad-inline-create-require', 2],
    ] as const
  ).map(([title, name, count]): Violation => [
    `[PR44-SEC-01] platform/prisma-client-construction: ${title}`,
    `rules/prisma-client-construction/${API}/orders/repository/${name}.ts`,
    [
      'platform/static-module-specifier',
      ...Array<string>(count).fill(CLIENT_CONSTRUCTION),
      // PR44-SEC-14 (020-D): a namespace or default import of node:module is refused by no-restricted-imports too.
      ...(/-(?:namespace|default)$/u.test(name) ? ['no-restricted-imports'] : []),
    ],
    'PR44-SEC-',
  ]),
  [
    '[PR44-SEC-01] platform/prisma-client-construction: a second apps/api/src/platform/db file takes the client namespace',
    `rules/prisma-client-construction/apps/api/src/platform/db/bad-second-client.ts`,
    CLIENT_CONSTRUCTION,
    'PR44-SEC-01',
  ],
  [
    '[PR44-SEC-01] platform/prisma-client-construction: the worker platform/db constructs a client (code review p1/p3/p7)',
    'rules/prisma-client-construction/apps/worker/src/platform/db/bad-second-client.ts',
    [CLIENT_CONSTRUCTION, CLIENT_CONSTRUCTION],
    'PR44-SEC-01',
  ],
  [
    '[PR44-SEC-01] platform/prisma-client-construction: the worker platform/db loads the client through a createRequire loader (p1)',
    'rules/prisma-client-construction/apps/worker/src/platform/db/bad-require-variable.ts',
    ['platform/static-module-specifier', CLIENT_CONSTRUCTION],
    'PR44-SEC-01',
  ],
  // PR44-SEC-10 / code review R2-m2 p9 and p15 (020-D): a template-literal key names createRequire; the loader is
  // seen, so the client load is too (plus no-restricted-imports on the namespace import).
  ...(
    [
      ['p9: nm[`createRequire`](u)(G)', 'bad-template-key-call'],
      ['p15: const { [`createRequire`]: make } = nm; make(u)(G)', 'bad-template-key-destructure'],
    ] as const
  ).map(([title, name]): Violation => [
    `[PR44-SEC-10] platform/prisma-client-construction: the worker platform/db loads the client through ${title}`,
    `rules/prisma-client-construction/apps/worker/src/platform/db/${name}.ts`,
    ['no-restricted-imports', 'platform/static-module-specifier', CLIENT_CONSTRUCTION],
    '',
  ]),
  [
    "[PR44-SEC-11] platform/prisma-client-construction: import x = require('@platform/prisma/client') is a require-style load",
    'rules/prisma-client-construction/apps/worker/src/platform/db/bad-import-equals.ts',
    ['@typescript-eslint/no-require-imports', CLIENT_CONSTRUCTION],
    '',
  ],
  [
    'a repository imports the root database client (ADR-0005 am. 10 item 2, PR2-SEC-05)',
    `layering/root-client-privacy/${API}/orders/repository/bad-root-client.ts`,
    BOUNDARIES,
    'the root database client (platform/db/client.ts) is private',
  ],
  [
    'the composition root imports the Prisma query counter test seam (PR34-SEC-01)',
    'layering/query-counter-seam/apps/api/src/bad-app.ts',
    BOUNDARIES,
    'platform/db/query-counter.ts is a test seam',
  ],
  [
    'a module service imports the Prisma query counter test seam (PR34-SEC-01)',
    `layering/query-counter-seam/${API}/orders/service/bad-counter.service.ts`,
    BOUNDARIES,
    'platform/db/query-counter.ts is a test seam',
  ],
  [
    'the tx slot imports the root database client instead of the runtime runner (PR11-SEC-09, TASK-020)',
    'layering/root-client-privacy/apps/api/src/platform/tx/bad-root-client.ts',
    BOUNDARIES,
    'the root database client (platform/db/client.ts) is private',
  ],
  [
    'prisma/tests imports packages/*/src (PR #5 R3-n1)',
    'layering/prisma-tests-imports/prisma/tests/rls/bad-package-import.int.test.ts',
    BOUNDARIES,
    'prisma/tests may import only',
  ],
  [
    'prisma/tests imports a prisma/ file outside prisma/seed (PR #5 R3-n1, PR #13 m6)',
    'layering/prisma-tests-imports/prisma/tests/rls/bad-prisma-import.int.test.ts',
    BOUNDARIES,
    'prisma/tests may import only',
  ],
  // D-ARCH-103 (ADR-0003 amendment 2026-11-13; TASK-020 part 020-B): the generated client is a value only in
  // platform/db, prisma/, tools/db and tests; a type elsewhere only in repositories and the two planned stores.
  [
    '[D-ARCH-103] a repository imports the generated Prisma client as a value',
    `layering/prisma-client-imports/${API}/orders/repository/bad-value-generated.ts`,
    BOUNDARIES,
    'the generated Prisma client (@platform/prisma/client) is a value only',
  ],
  [
    '[D-ARCH-103] a service imports a generated Prisma client type',
    `layering/prisma-client-imports/${API}/orders/service/bad-type-generated.ts`,
    BOUNDARIES,
    'only repositories import Prisma',
  ],
  [
    '[D-ARCH-103] the tx slot imports platform/db/generated.ts (category db-root-client)',
    'layering/prisma-client-imports/apps/api/src/platform/tx/bad-generated.ts',
    [CLIENT_CONSTRUCTION, BOUNDARIES],
    '',
  ],
  [
    '[D-ARCH-103] a packages/audit file other than the planned prisma-store.ts imports a generated client type',
    'layering/prisma-client-imports/packages/audit/src/store/bad-generated-store.ts',
    BOUNDARIES,
    'only repositories import Prisma',
  ],
  // D-ARCH-114 (ADR-0003 amendment 2026-11-14; TASK-020 part 020-C): the value allowance is the one file
  // apps/api/src/platform/db/generated.ts, not the db-platform-core category of both apps.
  [
    '[D-ARCH-114] the worker platform/db imports the generated Prisma client as a value',
    'layering/prisma-client-imports/apps/worker/src/platform/db/bad-value-generated.ts',
    BOUNDARIES,
    'is a value only in apps/api/src/platform/db/generated.ts',
  ],
  [
    '[D-ARCH-114] a second apps/api/src/platform/db file imports the generated Prisma client as a value',
    'layering/prisma-client-imports/apps/api/src/platform/db/bad-second-value.ts',
    BOUNDARIES,
    'is a value only in apps/api/src/platform/db/generated.ts',
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

/**
 * PR #42 R2-M1 / PR42-SEC-16 (REQ-AUDIT-001): api code outside the audit-writer allow-list value-imports nothing from
 * apps/api/src/platform/audit (the composed writer), judged on the resolved file whatever the spelling.
 */
const AUDIT_COMPOSITION_ROOT = 'layering/audit-writer-composition/apps/api/src';
const AUDIT_COMPOSITION_MESSAGE = 'REQ-AUDIT-001: apps/api/src/platform/audit composes the audit writer';
const AUDIT_COMPOSITION: readonly Violation[] = [
  ['V1 a named import (probe p7)', 'modules/orders/service/bad-orders-platform-writer.service.ts'],
  ['V2 a namespace import', 'modules/orders/service/bad-orders-platform-writer-namespace.service.ts'],
  ['V3 a dynamic import()', 'modules/orders/service/bad-orders-platform-writer-dynamic.service.ts'],
  ['V4 a re-export', 'modules/orders/service/bad-orders-platform-writer-reexport.service.ts'],
  ['V6 the ./ and platform/./audit spellings', 'modules/orders/service/bad-orders-platform-writer-dot.service.ts'],
  ['a .. detour through the folder', 'modules/orders/service/bad-orders-platform-writer-dotdot.service.ts'],
  ['V7 a file at the app root', 'bad-root-writer.ts'],
  ['a platform folder outside the allow-list (platform/http)', 'platform/http/bad-http-writer.ts'],
  ['the tx slot takes the writer, not only the capture hook', 'platform/tx/bad-tx-writer.ts'],
].map(([title, file]): Violation => [
  `[PR #42 R2-M1] api code outside the audit-writer allow-list imports the audit composition: ${title}`,
  `${AUDIT_COMPOSITION_ROOT}/${file}`,
  BOUNDARIES,
  AUDIT_COMPOSITION_MESSAGE,
]);

/**
 * PR48-SEC-03 (TASK-289): the RBAC matrix generator (@platform/authz/matrix, packages/authz/src/generator) is the US-071
 * test oracle. A static import of the subpath is caught by no-restricted-imports and the boundaries specifier arm; a
 * relative path, a re-export and import() by the boundaries arms (resolved file, specifier). The generated suite
 * (tests/generated/rbac/ok-runner.ts) and the generator folder itself (generator/ok-document.ts) stay clean.
 */
const AUTHZ_MATRIX_ROOT = 'layering/authz-matrix-oracle';
const AUTHZ_MATRIX_MESSAGE = 'the RBAC matrix generator (@platform/authz/matrix, packages/authz/src/generator) is the US-071 test oracle';
const AUTHZ_MATRIX_ORACLE: readonly Violation[] = (
  [
    [
      'production authorise imports the @platform/authz/matrix subpath',
      'apps/api/src/platform/authz/bad-oracle-specifier.ts',
      ['no-restricted-imports', BOUNDARIES],
    ],
    [
      'production authorise imports the generator by relative path (resolved file)',
      'apps/api/src/platform/authz/bad-oracle-resolved.ts',
      BOUNDARIES,
    ],
    ['production authorise loads the subpath with import()', 'apps/api/src/platform/authz/bad-oracle-dynamic.ts', BOUNDARIES],
    ['the @platform/authz package re-exports the generator (resolved file)', 'packages/authz/src/bad-oracle-reexport.ts', BOUNDARIES],
  ] as const
).map(([title, file, ruleId]): Violation => [`[PR48-SEC-03] ${title}`, `${AUTHZ_MATRIX_ROOT}/${file}`, ruleId, AUTHZ_MATRIX_MESSAGE]);

const ESLINT_VIOLATIONS = [
  ...LAYERING,
  ...AUTHZ_MATRIX_ORACLE,
  ...AUDIT_COMPOSITION,
  ...SHARED_LOGGING,
  ...ANY_SUPPRESSION,
  ...BCRYPT_CONFINEMENT,
  ...RULES,
  ...TENANT_DB,
  ...REACT,
  ...RESOLUTION,
];

/** The steps of `npm run lint` (`&&`-separated), in order (PR2-SEC-01/02/03). */
const LINT_STEPS: readonly RegExp[] = [
  // typegen first: type-aware rules must resolve the git-ignored ./+types on a clean checkout, and npm pre-hooks are
  // skipped under ignore-scripts (PR #4 R2-m2).
  /^npm run typegen$/u,
  /^eslint \. .*--max-warnings 0/u,
  /^stylelint .*--max-warnings 0/u,
  /^node tools\/lint\/check-suppressions\.mjs$/u,
];

/** Root `typegen` (PR4-SEC-13 item 2): the CLI in the two React Router apps, never a per-workspace `typegen` script. */
const ROOT_TYPEGEN = 'npm -w apps/web -w apps/admin exec --no -- react-router typegen';
const typegenFindings = (script: string): string[] => [
  ...(script === ROOT_TYPEGEN ? [] : [`root typegen must be exactly "${ROOT_TYPEGEN}"`]),
  ...(/\bnpm run\b|--workspaces\b|\s-ws\b/u.test(script) ? ['root typegen must not run workspace scripts (--workspaces / npm run)'] : []),
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
  const known = new Set([...ruleIdsOf([...ESLINT_VIOLATIONS, ...CSS]), ...WARNINGS.map(([, , ruleId]) => ruleId)]);
  const lines = formatExtras(listed, known);
  const heading = `No-weakening run: ${String(lines.length)} extra finding(s) with a rule id from the head configs (allowed).`;
  console.log(logText([heading, ...lines]));
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined && summary !== '') appendFileSync(summary, summaryMarkdown(heading, lines));
});

describe('seeded negative fixtures: ESLint (US-001, ADR-0003)', () => {
  it.each(ESLINT_VIOLATIONS)('%s', (_title, file, ruleId, message) => {
    expectFindings(report.eslint, file, ruleId, message);
  });

  // m3 b: a warning case still passes in the base run when the head raises the rule to error.
  it.each(WARNINGS)('%s (warning level)', (_title, file, ruleId) => {
    expectFindings(report.eslint, file, ruleId, '', 'warning');
  });

  it('every other fixture (ok-*, allow-listed paths, supporting modules) lints clean (no-weakening: reports nothing without a rule id)', () => {
    const expected = new Set([...ESLINT_VIOLATIONS, ...WARNINGS].map(([, file]) => file));
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
    [
      'a test file imports the Prisma query counter test seam',
      'layering/query-counter-seam/apps/api/src/platform/db/ok-query-counter.test.ts',
    ],
    ['Prisma in the planned outbox writer (TASK-043)', 'layering/prisma-planned-paths/apps/api/src/platform/outbox/writer.ts'],
    ['platform/barrel-reexport-only: re-exports and `export {}`', 'rules/barrel-reexport-only/packages/pricing/src/index.ts'],
    ['platform/any-justification: suppression with a justification', 'rules/any-justification/packages/pricing/src/ok-justified.ts'],
    [
      'platform/audit-writer-allowlist: allow-listed identity module',
      `rules/audit-writer-allowlist/${API}/identity/service/ok-login.service.ts`,
    ],
    [
      'platform/audit-writer-allowlist: the audit middleware folder composes the writer over the store (R1-M1)',
      'rules/audit-writer-allowlist/apps/api/src/platform/audit/ok-store.ts',
    ],
    [
      '[PR61-SEC-02] platform/audit-writer-allowlist: the API composition root builds the audit privacy dependencies',
      'rules/audit-writer-allowlist/apps/api/src/start-api.ts',
    ],
    [
      '[PR61-SEC-02] platform/audit-writer-allowlist: the audit viewer module decrypts the vault (TASK-073)',
      `rules/audit-writer-allowlist/${API}/audit/service/ok-vault-viewer.service.ts`,
    ],
    [
      'platform/audit-writer-allowlist: pure audit helpers outside the allow-list (PR42-SEC-06)',
      `rules/audit-writer-allowlist/${API}/orders/service/ok-pure-helpers.ts`,
    ],
    [
      '[PR #42 R2-M1] V8 the allow-listed identity module imports the audit composition',
      'layering/audit-writer-composition/apps/api/src/modules/identity/service/ok-identity-writer.service.ts',
    ],
    [
      '[PR #42 R2-M1] V9 a type-only import of the audit composition outside the allow-list',
      'layering/audit-writer-composition/apps/api/src/modules/orders/service/ok-type-only-platform-writer.ts',
    ],
    [
      '[PR #42 R2-M1] a test file imports the audit composition',
      'layering/audit-writer-composition/apps/api/src/modules/orders/service/ok-platform-writer.test.ts',
    ],
    [
      '[PR #42 R2-M1] the tx slot mounts the capture hook (capture.ts)',
      'layering/audit-writer-composition/apps/api/src/platform/tx/execute.ts',
    ],
    ['platform/money-arith: the money helpers', 'rules/money-arith/packages/shared/src/money/add.ts'],
    [
      '[PR #2 m10] platform/money-arith (type-aware): comparisons on Minor and arithmetic on plain numbers',
      'typed/money-arith/packages/pricing/src/ok-minor-compare.ts',
    ],
    [
      '[R2-M1] platform/money-arith (type-aware): `s += m.amount` onto a string builds text',
      'typed/money-arith/packages/pricing/src/ok-string-building.ts',
    ],
    ['[AT-US-138-02] platform/pricing-purity: new Date(input) and date arithmetic', 'rules/pricing-purity/packages/pricing/src/ok-pure.ts'],
    [
      '[AT-US-121-05] a module service imports @platform/carriers from its package root',
      `rules/carriers-deep-import/${API}/quotes/service/ok-carriers-root.ts`,
    ],
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
    [
      '[T-83] no-external-calls-in-tenant-tx: the same calls outside the callback and in an unrelated callback',
      `rules/no-external-calls-in-tenant-tx/${API}/orders/service/ok-outside.ts`,
    ],
    [
      '[T-83] no-external-calls-in-tenant-tx: test files are out of scope',
      `rules/no-external-calls-in-tenant-tx/${API}/orders/service/ok-sleep.test.ts`,
    ],
    [
      "[PR32-SEC-01] [D-ARCH-106] no-external-calls-in-tenant-tx: a transaction: 'none' handler (and a spread before the literal)",
      `rules/no-external-calls-in-tenant-tx/${API}/orders/routes/ok-handler-none.ts`,
    ],
    [
      '[PR32-SEC-01] [D-ARCH-106] no-external-calls-in-tenant-tx: outbox.publish(db, event) in a handler',
      `rules/no-external-calls-in-tenant-tx/${API}/orders/routes/ok-handler-outbox.ts`,
    ],
    [
      '[PR32-SEC-01] [D-ARCH-106] no-external-calls-in-tenant-tx: the fixtureRoute default; call and afterCommit are never roots',
      `rules/no-external-calls-in-tenant-tx/${API}/orders/routes/ok-fixture-route.ts`,
    ],
    [
      '[TASK-020] [D-ARCH-106] no-external-calls-in-tenant-tx: R4 afterCommit is never a root (a queue and the mailer)',
      `rules/no-external-calls-in-tenant-tx/${API}/orders/routes/ok-after-commit.ts`,
    ],
    [
      '[D-ARCH-111] no-external-calls-in-tenant-tx: (b) a member-expression handler, an imported handler, an unfollowable handler on a none route',
      `rules/no-external-calls-in-tenant-tx/${API}/orders/routes/ok-handler-member.ts`,
    ],
    ['[PR #32 M1] [D-ARCH-097] the S3 seam imports the AWS SDK', 'rules/s3-sdk-confinement/apps/api/src/platform/storage/ok-s3-adapter.ts'],
    [
      '[PR #32 m5] no-restricted-syntax: string mount and route paths (a RegExp elsewhere is fine)',
      'rules/regexp-route-path/apps/api/src/platform/http/ok-string-paths.ts',
    ],
    [
      '[PR20-SEC-13] no-catch-message-interpolation: the error as a structured field, rethrown',
      'rules/no-catch-message-interpolation/apps/api/src/platform/ok-structured.ts',
    ],
    [
      '[PR20-SEC-13] no-raw-request-in-log: req as a field, picked values',
      'rules/no-raw-request-in-log/apps/api/src/platform/http/ok-fields.ts',
    ],
    ['[PR #21 R1-m5] supertest is imported in tests/api/helpers', 'rules/supertest-confinement/tests/api/helpers/agent.ts'],
    [
      '[PR32-SEC-07] literal and no-substitution template loads (import()) of an allowed module, createRequire(u).resolve(literal)',
      `rules/system-model-owner/${API}/orders/service/ok-literal-import.ts`,
    ],
    [
      '[PR44-SEC-01] createRequire(u).resolve(literal) (the openapi/serve.ts shape) and typeof createRequire',
      `rules/system-model-owner/${API}/orders/service/ok-create-require-resolve.ts`,
    ],
    [
      '[PR32-SEC-07] platform/db/system-db.ts (the accessor home) is exempt from system-model-owner',
      'rules/system-model-owner/apps/api/src/platform/db/system-db.ts',
    ],
    [
      '[D-ARCH-124] the outbox writer names outbox_events in raw SQL',
      'rules/system-model-owner/apps/api/src/platform/outbox/ok-raw-writer.ts',
    ],
    ['[D-ARCH-124] the audit store names audit_entries in raw SQL', 'rules/system-model-owner/packages/audit/src/store/ok-raw-store.ts'],
    [
      '[D-ARCH-124] the api audit module (TASK-073 viewer) names an audit_entries partition in raw SQL',
      `rules/system-model-owner/${API}/audit/repository/ok-raw-viewer.ts`,
    ],
    [
      '[D-ARCH-124] SYSTEM table names in comments, strings, longer names and other-case quoted identifiers are not mentions',
      `rules/system-model-owner/${API}/orders/repository/ok-raw-mentions.ts`,
    ],
    [
      '[PR44-SEC-05] raw statements that only contain the keywords (quoted column, string, comment, UPDATE … SET, WITH)',
      `rules/db-raw-sql/${API}/orders/repository/ok-raw-statements.ts`,
    ],
    ['i18next/no-literal-string: literals in a *.test.tsx file', 'react/apps/web/app/routes/ok-heading.test.tsx'],
    [
      'import-x/no-unresolved (on): @platform/shared and a NodeNext ./x.js import resolve',
      'resolution/apps/api/src/platform/ok-workspace.ts',
    ],
    ['module imports another module through its index.ts', `layering/module-internals/${API}/quotes/service/ok-quotes.service.ts`],
    ['apps/worker imports a module through its index.ts', 'layering/worker-imports-controller/apps/worker/src/jobs/ok-sync.ts'],
    ['packages/pricing imports @platform/shared', 'layering/pricing-io/packages/pricing/src/ok-price.ts'],
    [
      '[TASK-010] apps/api imports @platform/shared/logging and pino (package specifier)',
      `${SHARED_LOGGING_ROOT}/apps/api/src/platform/logging/ok-logger.ts`,
    ],
    [
      '[TASK-010] apps/worker imports packages/shared/src/logging (resolved file)',
      `${SHARED_LOGGING_ROOT}/apps/worker/src/platform/logging/ok-logger-resolved.ts`,
    ],
    ['[TASK-010] apps/web still imports the @platform/shared root', `${SHARED_LOGGING_ROOT}/apps/web/app/ok-shared-root.ts`],
    [
      '[TASK-010] packages/shared/src/logging imports pino, its own files and the rest of packages/shared',
      `${SHARED_LOGGING_ROOT}/packages/shared/src/logging/ok-internal.ts`,
    ],
    [
      '[TASK-010] a packages/shared module outside src/logging imports another one',
      `${SHARED_LOGGING_ROOT}/packages/shared/src/ok-shared-module.ts`,
    ],
  ])('allowed: %s', (_title, file) => {
    expectClean(report.eslint, file);
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
      'db-raw-sql: tagged Prisma.sql fragments, Prisma.join(ids) and a literal separator, tagged $queryRaw (PR11-SEC-13 control)',
      `rules/db-raw-sql/${API}/orders/repository/ok-prisma-fragments.ts`,
    ],
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
      'prisma/tests imports tools/db, tools/test-support, platform/db, the seed framework and its harness (PR #13 m6)',
      'layering/prisma-tests-imports/prisma/tests/rls/ok-imports.int.test.ts',
    ],
  ])('allowed (TASK-016): %s', (_title, file) => {
    expectClean(report.eslint, file);
  });

  it.each([
    ['a repository imports a generated client type', `layering/prisma-client-imports/${API}/orders/repository/ok-type-generated.ts`],
    [
      'platform/db/generated.ts imports the generated client as a value',
      'layering/prisma-client-imports/apps/api/src/platform/db/generated.ts',
    ],
    ['prisma/tests import the generated client as a value', 'layering/prisma-client-imports/prisma/tests/rls/ok-generated.int.test.ts'],
    ['the planned audit store imports a generated client type', 'layering/prisma-client-imports/packages/audit/src/store/prisma-store.ts'],
  ])('allowed (D-ARCH-103): %s', (_title, file) => {
    expectClean(report.eslint, file);
  });

  exactOnly('every bad-* fixture is listed in the case table (no untested fixture)', () => {
    const listed = new Set([...ESLINT_VIOLATIONS, ...WARNINGS].map(([, file]) => file));
    const unlisted = Object.keys(report.eslint).filter((file) => /\/bad-[^/]+$/u.test(file) && !listed.has(file));
    expect(unlisted).toEqual([]);
  });

  exactOnly('every local platform/* rule has at least one negative fixture', () => {
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

  it.each([
    [
      'production authorise.ts imports { expectCell, generateMatrix }',
      'apps/api/src/platform/authz/authorise.ts',
      ['no-restricted-imports', BOUNDARIES],
    ],
    [
      'an authz platform file imports the oracle as a namespace',
      'apps/api/src/platform/authz/lint-probe-bad-oracle-namespace.ts',
      ['no-restricted-imports', BOUNDARIES],
    ],
    ['a module service loads it with import()', `${API}/shipments/service/lint-probe-bad-oracle-dynamic.ts`, [BOUNDARIES]],
    ['the @platform/authz package re-exports the generator entry', 'packages/authz/src/lint-probe-bad-oracle-reexport.ts', [BOUNDARIES]],
  ])('[PR48-SEC-03] the RBAC matrix oracle (resolved to packages/authz/src/generator): %s fails', (_title, path, rules) => {
    const findings = findingsOf(report.probes, path);
    expect([...new Set(findings.map((finding) => finding.ruleId))].sort()).toEqual([...rules].sort());
    for (const finding of findings) expect(finding.message).toContain(AUTHZ_MATRIX_MESSAGE);
  });

  it('[PR48-SEC-03] allowed: the generated RBAC suite imports @platform/authz/matrix', () => {
    expectClean(report.probes, 'tests/generated/rbac/lint-probe-ok-oracle.ts');
  });

  // PR #60 R1-n6: the positive fixtures of the oracle confinement, named so `-t PR48-SEC-03` shows the exemptions too.
  it.each([
    ['the generator folder imports its own modules (self-exemption)', `${AUTHZ_MATRIX_ROOT}/packages/authz/src/generator/ok-document.ts`],
    ['the generated RBAC suite imports @platform/authz/matrix', `${AUTHZ_MATRIX_ROOT}/tests/generated/rbac/ok-runner.ts`],
  ])('[PR48-SEC-03] allowed fixture: %s', (_title, file) => {
    expectClean(report.eslint, file);
  });

  it('[PR #21 R1-m4] allowed: an API contract test imports apps/api/src by relative path', () => {
    expectClean(report.probes, 'tests/api/lint-probe-ok-apps-api.api.test.ts');
  });

  it('[PR #21 R1-m4] an API contract test importing packages/*/src by relative path fails import-x/no-relative-packages', () => {
    const findings = findingsOf(report.probes, 'tests/api/lint-probe-bad-package-relative.api.test.ts');
    expect(findings.map((finding) => finding.ruleId)).toContain('import-x/no-relative-packages');
  });

  it('[PR21-SEC-09] [R2-n1] a `..` traversal after apps/api/src/ (apps/api/src/../../../packages/...) fails import-x/no-relative-packages', () => {
    const findings = findingsOf(report.probes, 'tests/api/lint-probe-bad-api-traversal.api.test.ts');
    expect(findings.map((finding) => finding.ruleId)).toContain('import-x/no-relative-packages');
  });

  it.each([
    ['tools/db', 'tests/generated/rls/lint-probe-ok-tools-db.ts'],
    ['prisma/tests/harness', 'tests/generated/rls/lint-probe-ok-harness.ts'],
  ])('[PR #43 R1-n3] allowed: the RLS generator imports %s by relative path', (_title, path) => {
    expectClean(report.probes, path);
  });

  it.each([
    ['a `..` traversal after tools/db/', 'tests/generated/rls/lint-probe-bad-tools-db-traversal.ts'],
    ['another prisma/tests folder (catalog)', 'tests/generated/rls/lint-probe-bad-catalog.ts'],
    ['tools/db from another tests/generated folder', 'tests/generated/lint-probe-bad-tools-db-elsewhere.ts'],
  ])('[PR #43 R1-n3] %s fails import-x/no-relative-packages', (_title, path) => {
    expect(findingsOf(report.probes, path).map((finding) => finding.ruleId)).toContain('import-x/no-relative-packages');
  });

  // D-ARCH-103 (1)-(2): the bare workspace specifier resolves to prisma/generated/** (category prisma-generated).
  it.each([
    [
      'a repository value import',
      `${API}/orders/repository/lint-probe-bad-prisma-value.ts`,
      'the generated Prisma client (@platform/prisma/client) is a value only',
    ],
    ['a service type import', `${API}/orders/service/lint-probe-bad-prisma-type.ts`, 'only repositories import Prisma'],
    [
      'an apps/worker value import',
      'apps/worker/src/jobs/lint-probe-bad-prisma-value.ts',
      'the generated Prisma client (@platform/prisma/client) is a value only',
    ],
  ])('[D-ARCH-103] @platform/prisma/client: %s is a layering violation', (_title, path, message) => {
    const layering = findingsOf(report.probes, path).filter((finding) => finding.ruleId === BOUNDARIES);
    expect(layering.map((finding) => finding.message).join('\n')).toContain(message);
  });

  it.each([
    ['a repository type import', `${API}/orders/repository/lint-probe-ok-prisma-type.ts`],
    ['a value import in apps/api/src/platform/db/generated.ts (D-ARCH-114)', 'apps/api/src/platform/db/generated.ts'],
  ])('[D-ARCH-103] allowed: @platform/prisma/client, %s (resolved, no-unresolved on)', (_title, path) => {
    expectClean(report.probes, path);
  });

  // D-ARCH-114: the value allowance is the one file generated.ts, proven with the bare workspace specifier (real resolution).
  it.each([
    ['a second apps/api/src/platform/db file', 'apps/api/src/platform/db/lint-probe-bad-prisma-value.ts'],
    ['apps/worker/src/platform/db', 'apps/worker/src/platform/db/lint-probe-bad-prisma-value.ts'],
  ])('[D-ARCH-114] @platform/prisma/client: a value import in %s is a layering violation', (_title, path) => {
    // PR44-SEC-01: platform/prisma-client-construction is on there too (only client.ts, generated.ts, runtime.ts are out).
    expectFindings(report.probes, path, [BOUNDARIES, CLIENT_CONSTRUCTION], '');
    const layering = findingsOf(report.probes, path).filter((finding) => finding.ruleId === BOUNDARIES);
    expect(layering.map((finding) => finding.message).join('\n')).toContain('is a value only in apps/api/src/platform/db/generated.ts');
  });

  /** The probe's findings of one rule; in exact mode the probe reports that rule and the D-ARCH-114 value import only. */
  const ruleFindings = (path: string, ruleId: string): Finding[] => {
    const findings = findingsOf(report.probes, path);
    if (MODE === 'exact') {
      const others = findings.filter((finding) => finding.ruleId !== ruleId);
      expect(others.map((finding) => [finding.ruleId, finding.message.includes('apps/api/src/platform/db/generated.ts')])).toEqual(
        others.map(() => [BOUNDARIES, true]),
      );
    }
    return findings.filter((finding) => finding.ruleId === ruleId);
  };

  // PR38-SEC-01: in platform/db the raw-SQL rule traces the helpers through the workspace specifier as it does through
  // @prisma/client. Each case was silent before the source list named it. Since D-ARCH-114 the value import itself is
  // also a layering finding on these paths (only generated.ts may import a value); the raw-SQL finding is read alone.
  it.each([
    ['`const { raw } = Prisma; raw(s)`', 'destructured', 'Prisma.raw interpolates SQL'],
    ['`import { Prisma as P }; P.raw(s)`', 'aliased-import', 'Prisma.raw interpolates SQL'],
    ['`Prisma.sql([s])` called as a function', 'sql-call', "'sql' called as a function"],
    ['`Prisma.join(ids, sep)` with a variable separator', 'join-separator', "The separator, prefix and suffix of 'join'"],
    ['a computed member `Prisma[k]`', 'computed-member', 'A computed member of the Prisma client namespace'],
    ['a re-export of `Prisma`', 'reexport', "Re-exporting 'Prisma'"],
    ['`const tag = Prisma.sql; tag([s])`', 'sql-alias', "'sql' called as a function"],
  ])('[PR38-SEC-01] @platform/prisma/client in platform/db: %s is a raw-SQL finding', (_title, name, message) => {
    const raw = ruleFindings(`apps/api/src/platform/db/lint-probe-bad-raw-${name}.ts`, 'platform/db-raw-sql');
    expect(raw.length).toBeGreaterThan(0);
    for (const finding of raw) expect(finding.message).toContain(message);
  });

  it('[PR38-SEC-01] allowed: a tagged Prisma.sql fragment and Prisma.join with a literal separator from @platform/prisma/client', () => {
    expect(ruleFindings('apps/api/src/platform/db/lint-probe-ok-raw-fragments.ts', 'platform/db-raw-sql')).toEqual([]);
  });
});

describe('seeded negative fixtures: Stylelint (NFR-I18N-003, NFR-A11Y-006)', () => {
  it.each(CSS)('%s', (_title, file, ruleId, message) => {
    expectFindings(report.stylelint, file, ruleId, message);
  });

  it('allowed: logical properties and :hover inside @media (hover: hover)', () => {
    expectClean(report.stylelint, 'css/ok-logical-and-hover.css');
  });

  it('[AT-US-101-01] allowed: token variables, on-grid lengths, keywords, component-local and Tailwind runtime variables', () => {
    expectClean(report.stylelint, 'css/ok-tokens.css');
  });

  exactOnly('every CSS fixture is listed in the case table', () => {
    const listed = new Set([...CSS.map(([, file]) => file), 'css/ok-logical-and-hover.css', 'css/ok-tokens.css']);
    expect(Object.keys(report.stylelint).filter((file) => !listed.has(file))).toEqual([]);
  });
});

describe('lint wiring (ADR-0002 am. item 3, NFR-MAINT-001, PR2-SEC-02/03)', () => {
  it('resolves workspace packages to their sources through the @platform/source condition', () => {
    expect(report.resolver['@platform/shared']).toBe('packages/shared/src/index.ts');
  });

  it('`npm run lint` generates route types, runs ESLint and Stylelint with --max-warnings 0, then the suppression check (PR2-SEC-01; no-weakening: every step still runs, in order, PR17-SEC-04)', () => {
    const { scripts } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const steps = (scripts['lint'] ?? '').split('&&').map((step) => step.trim());
    if (MODE === 'exact') expect(steps).toEqual(LINT_STEPS.map((step) => expect.stringMatching(step)));
    else expect(missingSteps(steps, LINT_STEPS)).toEqual([]);
    // No --allow-empty-input: Stylelint matching no CSS file fails instead of reading as clean (PR2-SEC-03).
    expect(steps.filter((step) => step.includes('--allow-empty-input'))).toEqual([]);
  });

  it('[PR4-SEC-13] root `typegen` calls the React Router CLI in the two apps directly, so no workspace script runs in lint', () => {
    const { scripts } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(scripts['typegen']).toBe(ROOT_TYPEGEN);
    expect(typegenFindings(scripts['typegen'] ?? '')).toEqual([]);
    // Mutation: the per-workspace script form (any workspace package.json could add a typegen script) is rejected.
    for (const weakened of ['npm run typegen --workspaces --if-present', 'npm run typegen --workspaces', 'npm run typegen -ws']) {
      expect(typegenFindings(weakened)).not.toEqual([]);
    }
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
    // PR4-SEC-10: Playwright output is anchored like the build output.
    'playwright-report/x.js': true,
    'tests/e2e/test-results/x.js': true,
    'tests/e2e/playwright-report/x.js': true,
    'apps/api/src/modules/quotes/test-results/a.ts': false,
    'packages/authz/src/playwright-report/a.ts': false,
  };
  const STYLELINT_IGNORED = {
    'dist/x.css': true,
    'apps/web/build/client/assets/x.css': true,
    'packages/ui/dist/x.css': true,
    'coverage/x.css': true,
    'apps/web/app/coverage/x.css': false,
    'packages/ui/src/build/x.css': false,
    'playwright-report/x.css': true,
    'tests/e2e/playwright-report/x.css': true,
    'apps/web/app/test-results/x.css': false,
    'packages/ui/src/playwright-report/x.css': false,
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

  // Mixed wiring cases are split (review m3 a): "on" decisions always run; "off" decisions only lint less when they flip,
  // so they are positive halves (exact mode only).
  it('the audit-writer allow-list is on outside platform/{audit,authz,db} and the worker processors (TASK-002 n5)', () => {
    expect(report.effective['apps/api/src/platform/http/a.ts']?.['platform/audit-writer-allowlist']).toBe('error');
    expect(report.effective['apps/worker/src/platform/a.ts']?.['platform/audit-writer-allowlist']).toBe('error');
  });

  exactOnly('the audit-writer allow-list is narrowed to platform/{audit,authz,db} and the worker processors (TASK-002 n5)', () => {
    // PR #61 R1-M2: the allow-list keeps the rule with the vault-decrypt exports only (the writer exports pass there:
    // ok-login, ok-store; the decrypt pair does not: bad-identity-vault-decrypt). packages/audit owns all of it.
    expect(report.effective['apps/api/src/platform/audit/a.ts']?.['platform/audit-writer-allowlist']).toBe('error');
    expect(report.effective['apps/worker/src/processors/a.ts']?.['platform/audit-writer-allowlist']).toBe('error');
    expect(report.effective['packages/audit/src/store/prisma-store.ts']?.['platform/audit-writer-allowlist']).toBe('off');
  });

  it('tenant-database rules: repositories get raw-SQL, client and expectAffected checks; prisma/tests keeps no-relative-packages on (TASK-016)', () => {
    const repository = report.effective['apps/api/src/modules/orders/repository/a.ts'];
    expect(repository).toMatchObject({
      'platform/tenant-context-sql': 'error',
      'platform/prisma-client-construction': 'error',
      'platform/db-raw-sql': 'error',
    });
    // m3 b: expect-affected is a warning; the base run accepts it raised to error.
    const affected = MODE === 'exact' ? ['warn'] : ['warn', 'error'];
    expect(affected).toContain(repository?.['platform/expect-affected']);
    expect(report.effective['prisma/tests/rls/a.int.test.ts']).toMatchObject({
      'platform/tenant-context-sql': 'error',
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

  exactOnly('tenant-database rules: prisma/tests may construct the client and run raw SQL (TASK-016)', () => {
    expect(report.effective['prisma/tests/rls/a.int.test.ts']).toMatchObject({
      'platform/prisma-client-construction': 'off',
      'platform/db-raw-sql': 'off',
    });
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
