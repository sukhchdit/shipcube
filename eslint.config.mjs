// @ts-check
/**
 * ESLint 10 flat configuration (ADR-0002 §5 and amendments; ADR-0003 layering; TASK-002).
 *
 * Layers, in order: ignores, JS/TS baselines (type-aware typescript-eslint through the project service), import-x
 * (resolution through the `@platform/source` export condition), eslint-plugin-boundaries (ADR-0003 layering), the
 * local `platform/*` rules (tools/eslint-rules), React (hooks, jsx-a11y-x, i18next) and the file-scoped exceptions.
 * Every rule that is custom or layering has a seeded negative fixture in tests/fixtures/lint, linted by
 * tools/lint/negative-fixtures.test.ts with this same file (the fixture tree is its own repository root).
 * `npm run lint` runs with `--max-warnings 0`.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import boundaries from 'eslint-plugin-boundaries';
import i18next from 'eslint-plugin-i18next';
import * as importX from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

import platform from './tools/eslint-rules/index.mjs';
import { resolverOptions } from './tools/lint/resolver.mjs';

const ROOT = import.meta.dirname;
const RESOLVER_MODULE = join(ROOT, 'tools', 'lint', 'resolver.mjs');

// ---------------------------------------------------------------------------------------------------------------
// Path vocabulary (ADR-0003, ADR-0007, ADR-0016, ADR-0026). Globs are relative to the repository root.
// ---------------------------------------------------------------------------------------------------------------

/** The one module allowed to import `bcrypt` / `bcryptjs`: the `PasswordHasher` implementation (D-ARCH-042, ADR-0006 am. 16). TASK-049 creates it. */
const PASSWORD_HASHER_MODULE = 'apps/api/src/modules/identity/service/bcrypt-password-hasher.ts';
/** The bcrypt family: `bcrypt`, `bcryptjs`, `bcrypt-ts`, `@node-rs/bcrypt` ... and their subpaths (picomatch, boundaries). */
const BCRYPT_FAMILY = ['bcrypt*', '@*/bcrypt*'];
const BCRYPT_MESSAGE = `only the PasswordHasher implementation (${PASSWORD_HASHER_MODULE}) imports the bcrypt family; everything else uses the PasswordHasher port (D-ARCH-042, ADR-0006 am. 16).`;
/** Static-import net over every linted file (ADR-0002 PR1-SEC am. item 3); the boundaries policy below adds import(), require and createRequire. */
const BCRYPT_IMPORT_PATTERN = { regex: '^(?:@[^/]+/)?bcrypt[-.\\w]*(?:/.*)?$', message: BCRYPT_MESSAGE };
/**
 * Raw Supertest is confined to the contract helper (api/README.md §16, PR #21 R1-m5 (a), D-ARCH-084): every API test
 * goes through `api(app)` / `expectContract(res)` in tests/api/helpers, so no response escapes contract validation.
 */
const SUPERTEST_IMPORT_PATTERN = {
  regex: '^supertest(?:/.*)?$',
  message:
    "import 'supertest' only in tests/api/helpers: use api(app) / expectContract(res) from tests/api/helpers/expect-contract.ts, which validate every response against openapi.yaml (api/README.md §16).",
};
/** The one S3 seam (D-ARCH-097 (6), PR30-SEC-08 (e)): the ObjectStorage port and its S3 adapter. */
const S3_SEAM = 'apps/api/src/platform/storage';
/**
 * The AWS SDK, the raw SigV4 signer and the legacy v2 SDK stay behind the ObjectStorage port (D-ARCH-097 (6),
 * PR30-SEC-08 (e), PR #32 code review M1). The static-import twin of apps/api/src/platform/storage/boundary.test.ts.
 */
const S3_SDK_IMPORT_PATTERN = {
  regex: '^(?:@aws-sdk/.*|@smithy/signature-v4(?:/.*)?|aws-sdk(?:/.*)?)$',
  message: `only ${S3_SEAM} imports the AWS SDK, the SigV4 signer or aws-sdk: everything else uses the ObjectStorage port (D-ARCH-097, PR30-SEC-08).`,
};
/**
 * Every `no-restricted-imports` pattern of the repository. Flat config replaces (does not merge) rule options, so a
 * file-scoped block re-declares the rule from this list minus its own exception, never `'off'`.
 */
const RESTRICTED_IMPORT_PATTERNS = [BCRYPT_IMPORT_PATTERN, SUPERTEST_IMPORT_PATTERN, S3_SDK_IMPORT_PATTERN];
/** `no-restricted-imports` with every repository pattern except `exception`. */
const restrictedImportsExcept = (/** @type {object} */ exception) =>
  /** @type {const} */ (['error', { patterns: RESTRICTED_IMPORT_PATTERNS.filter((pattern) => pattern !== exception) }]);
/**
 * Files that may import Supertest directly. The helper folder, plus exact files only (a new file beside them does not
 * inherit the exception), each with its reason. apps/api cannot import tests/api (boundaries: apps import no other
 * workspace), so its colocated tests cannot use the helper.
 */
const SUPERTEST_ALLOW_LIST = [
  // The contract helper itself: the one wrapper around supertest(app).
  'tests/api/helpers/**',
  // US-007 problem handler over createApp with stub routers: throws arbitrary errors from routes that are not contract
  // operations, to test the RFC 9457 mapping itself (a framework seam below the contract helper).
  'apps/api/src/platform/errors/problem-handler.api.test.ts',
  // TASK-017 runtime seams (version prefix, deprecated fixture operation, ApiMode, OPTIONS answer): fixture routes and
  // headers below the contract helper.
  'apps/api/src/platform/openapi/runtime-seams.api.test.ts',
  // US-035 Swagger UI at /api/docs: HTML, ETag and docs-path routes that are not contract operations.
  'apps/api/src/platform/openapi/serve.api.test.ts',
  // Health router unit test (unit lane): the router in isolation, no contract document loaded.
  'apps/api/src/platform/health/router.test.ts',
  // Health integration test (integration lane, Testcontainers): real dependencies; contract checks live in tests/api.
  'apps/api/src/platform/health/health.int.test.ts',
  // US-008 logging sink (TASK-010): access, error and careless-code lines read from an in-memory log sink; the routes
  // are framework fixtures, not contract operations (a logging seam below the contract helper).
  'apps/api/src/platform/logging/logging.api.test.ts',
];

/** Every file extension ESLint lints (PR2-SEC-03: `.jsx` included, so no source file is silently skipped). */
const LINTED = '{js,jsx,mjs,cjs,ts,tsx,mts,cts}';
/** TypeScript source extensions. */
const TS = '{ts,tsx,mts,cts}';
const TEST_FILES = ['**/*.test.{ts,tsx,js,jsx}', '**/{test,tests,__tests__}/**'];
const APP_AND_PACKAGE_SOURCES = [`apps/*/{src,app}/**/*.${LINTED}`, `packages/*/src/**/*.${LINTED}`, 'prisma/seed/**/*.ts'];
/** Browser packages: not server code (TASK-065 puts the Axios session client in packages/ui/src/session). */
const BROWSER_PACKAGES = ['packages/ui/**'];
/** Server code: the api, the worker and every package except the browser ones (new packages are covered by default). */
const SERVER_SOURCES = [`apps/api/src/**/*.${LINTED}`, `apps/worker/src/**/*.${LINTED}`, `packages/*/src/**/*.${LINTED}`];
const REACT_SOURCES = ['apps/web/app/**/*.{ts,tsx,js,jsx}', 'apps/admin/app/**/*.{ts,tsx,js,jsx}', 'packages/ui/src/**/*.{ts,tsx,js,jsx}'];
const REACT_TSX = ['apps/web/app/**/*.{tsx,jsx}', 'apps/admin/app/**/*.{tsx,jsx}', 'packages/ui/src/**/*.{tsx,jsx}'];

/** `@platform/shared/logging`: server-only (Pino, node:util; TASK-010, D-TASK010-01). Browser code and pricing never import it. */
const SHARED_LOGGING = 'packages/shared/src/logging/**';
/** Money helpers own the arithmetic on minor units (ADR-0009 §3). */
const MONEY_HELPERS = ['packages/shared/src/money/**'];
/** Intl-based formatting helpers (NFR-I18N-004). */
const FORMAT_HELPERS = ['packages/shared/src/intl/**', 'packages/shared/src/format/**'];
/** The single reviewed sanitising component (REQ-SEC-016, ADR-0026 §9). */
const SANITISING_COMPONENT = ['packages/ui/src/sanitised-html/**'];
/** The SSRF-safe outbound client module (ADR-0016 §13, TASK-113). */
const OUTBOUND_CLIENT = ['apps/api/src/platform/egress/**'];
/**
 * Importers of the audit writer: the audit package and its allow-listed callers (REQ-AUDIT-001, ADR-0007). Narrowed by
 * TASK-016 (TASK-002 code review n5): the request-pipeline folders that write entries, not all of platform/**, and
 * the worker's job processors, not all of apps/worker/src.
 */
const AUDIT_WRITER_ALLOW_LIST = [
  'packages/audit/**',
  'apps/api/src/platform/audit/**', // audit middleware (route audit descriptor)
  'apps/api/src/platform/authz/**', // permission denials (PERMISSION_DENIED entries)
  'apps/api/src/platform/db/**', // withTenantTx (system writers joined to the business transaction)
  'apps/worker/src/processors/**', // system jobs (BullMQ processors)
  'apps/api/src/modules/identity/**', // auth events
  'apps/api/src/modules/compliance/**', // config changes
  'apps/api/src/modules/admin-settings/**', // config changes (reference data, feature flags)
  'apps/api/src/modules/shipments/service/**', // the state machine writes STATE_TRANSITION entries
];
/**
 * Non-repository files planned to use Prisma, by exact path (narrow): the audit store (ADR-0007, TASK-025) and the
 * transactional outbox writer (TASK-043). Anything else beside them still goes through a repository.
 */
const PLANNED_PRISMA_FILES = ['packages/audit/src/store/prisma-store.ts', 'apps/api/src/platform/outbox/writer.ts'];
/** The database platform: the only home of the root Prisma client and of withTenantTx (ADR-0005 am. 10 item 2). */
const DB_PLATFORM = 'apps/*/src/platform/db/**';
/**
 * T-83 whole-file roots (D-ARCH-106 (5) R5, option `txFiles`): code that only ever runs inside the business
 * transaction (the audit hook, the outbox writer, the audit store). Test files are outside the rule's block.
 */
const TENANT_TX_FILES = ['apps/api/src/platform/audit/**', 'apps/api/src/platform/outbox/writer.ts', 'packages/audit/src/store/**'];
/** T-83 R6 (option `txHandleTypes`): a function with a parameter of one of these types runs inside the transaction. */
const TENANT_TX_HANDLE_TYPES = ['TenantDb', 'AppDb', 'AppTransactionClient'];
/**
 * `platform/system-model-owner` (PR19-SEC-01, D-ARCH-080): table-class manifest module -> the code that owns its
 * SYSTEM tables. A manifest module without an entry owns `apps/*\/src/modules/<module>/**` (e.g. `identity` for
 * login_attempt_counters, `payments` for gateway_webhook_events). The platform-level owners are explicit.
 */
const SYSTEM_MODEL_OWNERS = {
  // Bookkeeping tables (_prisma_migrations, bootstrap_migrations, reference_dataset_versions): the database platform.
  platform: ['apps/*/src/platform/db/**'],
  outbox: ['apps/*/src/platform/outbox/**'], // outbox_events: the writer (api) and the relay (worker)
  idempotency: ['apps/api/src/platform/idempotency/**'], // idempotency_keys
  worker: ['apps/worker/src/platform/**'], // job_context, processed_events
};
/**
 * The only files `platform/system-model-owner` does not lint (PR32-SEC-07 (b)): the SYSTEM accessor (api and worker
 * twins) and the TenantDb handle; both import the private system-port.
 */
const SYSTEM_ACCESSOR_HOMES = ['apps/*/src/platform/db/system-db.ts', 'apps/*/src/platform/db/tenant-db.ts'];
/** Repository layer files (folder or single file), for the raw-SQL and expectAffected rules. */
const REPOSITORY_FILES = ['apps/api/src/modules/*/repository/**', 'apps/api/src/modules/*/repository.{ts,tsx}'];
/**
 * `platform/tenant-context-sql` exemptions (ADR-0005 am. 10 items 1 and 4; TASK-016 lead decision 6; PR11-SEC-08).
 * Exact files only (no folder globs: a new file in an exempted folder must not inherit the exemption), each with the
 * forms it may contain: `setter` (the context setter function name), `keys` (the four security keys, e.g. a
 * readiness read), `session-set` (`SET [SESSION] app.…` / `RESET app.…`), `session-set-config` (the setter with
 * is_local = false), `unicode-escape` (a `U&'…'` string or `U&"…"` identifier, PR11-SEC-17). Every other file gets the
 * rule with no exemption.
 */
const ALL_CONTEXT_FORMS = ['setter', 'keys', 'session-set', 'session-set-config', 'unicode-escape'];
const TENANT_CONTEXT_EXEMPTIONS = [
  // The one runtime writer of the context: transaction-local setter only (session forms stay errors).
  { files: ['apps/api/src/platform/db/with-tenant-tx.ts'], allow: ['setter', 'keys'] },
  // TASK-006 readiness probe: READS the app.* settings of a fresh connection; never a second writer.
  { files: ['apps/api/src/platform/db/session-integrity.ts', 'apps/api/src/platform/db/session-integrity.test.ts'], allow: ['keys'] },
  // TASK-006 session-integrity integration suite (D-ORCH-014 (e)): plants what the guard must detect, i.e. a
  // transaction-local setter on the pool (the '' reset value) and role-level defaults of a key (`ALTER ROLE … SET`,
  // the session-set form), and reads the keys. Never a runtime writer; no is_local = false form.
  { files: ['apps/api/src/platform/db/session-integrity.int.test.ts'], allow: ['setter', 'keys', 'session-set'] },
  // Integration suite of withTenantTx: asserts the context statement and its fail-closed behaviour.
  { files: ['prisma/tests/rls/with-tenant-tx.int.test.ts'], allow: ['setter', 'keys'] },
  // The session-scope negative control: the ONLY runtime-lane file allowed the is_local = false form (it proves the leak).
  { files: ['prisma/tests/rls/session-scope-leak.int.test.ts'], allow: ALL_CONTEXT_FORMS },
  // Catalog C-series: the prosrc scan's negative fixtures create functions that run a session SET of a context key
  // (transaction-local setter fixtures only: no is_local = false), and the U& evasion probes of the scan (PR11-SEC-14 a).
  { files: ['prisma/tests/catalog/c01-c12.int.test.ts'], allow: ['setter', 'keys', 'session-set', 'unicode-escape'] },
  // The catalog scan helpers name the keys (the renderer's deparsed operator-scope atom).
  { files: ['prisma/tests/catalog/scans.ts'], allow: ['keys'] },
  // The RLS renderer emits the §4.3 policies over the §4.2 helpers.
  { files: ['tools/db/render-rls.ts', 'tools/db/render-rls.test.ts', 'tools/db/render-rls-dr-a14.test.ts'], allow: ['keys'] },
  // Migration-linter rule 16 names the forms it rejects; its tests and the shared form list's tests name every
  // evasion form, session forms included (PR11-SEC-02).
  { files: ['tools/db/lint-migrations.ts'], allow: ['setter', 'keys'] },
  { files: ['tools/db/lint-migrations.test.ts', 'tools/db/tenant-key-forms.test.ts'], allow: ALL_CONTEXT_FORMS },
  // pg_dump's own preamble `set_config('search_path', '', false)`, asserted verbatim (no tenant key; not a session form).
  { files: ['tools/db/up-down-up.test.ts'], allow: ['setter'] },
];
/** Domain code in which non-null assertions are forbidden (NFR-MAINT-002). */
const DOMAIN_CODE = ['packages/{pricing,audit,authz,carriers}/src/**/*.ts', 'apps/api/src/modules/*/service/**/*.ts'];

/**
 * A RegExp path argument of an Express mount or route method (PR #32 code review m5, PR32-SEC-11; api/README §15): the
 * drift walker resolves string paths, and a RegExp (non-capturing group, character class, alternation) can serve paths
 * the walker never lists. Literal, `new RegExp(...)` and `RegExp(...)`, directly or inside an array of paths.
 */
const EXPRESS_PATH_METHODS = '/^(?:use|get|post|put|patch|delete|all|route|head|options)$/';
const EXPRESS_PATH_CALL = `CallExpression[callee.type='MemberExpression'][callee.property.name=${EXPRESS_PATH_METHODS}]`;
const REGEXP_ROUTE_PATH_MESSAGE =
  'Express paths are strings: a RegExp path in .use/.get/.post/.put/.patch/.delete/.all/.route/.head/.options can serve paths the OpenAPI drift walker never lists (api/README §15, PR #32 m5).';
const REGEXP_ROUTE_PATH_SELECTORS = [
  `${EXPRESS_PATH_CALL} > Literal.arguments[regex]`,
  `${EXPRESS_PATH_CALL} > :matches(NewExpression, CallExpression).arguments[callee.name='RegExp']`,
  `${EXPRESS_PATH_CALL} > ArrayExpression.arguments > Literal.elements[regex]`,
  `${EXPRESS_PATH_CALL} > ArrayExpression.arguments > :matches(NewExpression, CallExpression).elements[callee.name='RegExp']`,
].map((selector) => ({ selector, message: REGEXP_ROUTE_PATH_MESSAGE }));
/**
 * Every `no-restricted-syntax` entry of apps/api/src. Flat config replaces rule options, so a narrower block that
 * re-declares the rule spreads this list first (never `'off'`).
 */
const API_RESTRICTED_SYNTAX = [...REGEXP_ROUTE_PATH_SELECTORS];

/** Workspace directories (apps/*, packages/*, tests/*, prisma) that own a package.json. */
const WORKSPACE_DIRS = ['apps', 'packages', 'tests']
  .flatMap((group) =>
    existsSync(join(ROOT, group))
      ? readdirSync(join(ROOT, group), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${group}/${entry.name}`)
      : [],
  )
  .concat('prisma')
  .filter((dir) => existsSync(join(ROOT, dir, 'package.json')));

// ---------------------------------------------------------------------------------------------------------------
// eslint-plugin-boundaries: file classification and layering policies (ADR-0003, NFR-MAINT-001)
// ---------------------------------------------------------------------------------------------------------------

const MODULE = 'apps/api/src/modules/*';
/** `<layer>/**` or `<layer>.ts`: a module layer may be a folder or a single file (tools/repo/structure.ts). */
const layerGlobs = (/** @type {string} */ name) => [`${MODULE}/${name}/**`, `${MODULE}/${name}.{ts,tsx}`];

const BOUNDARIES_FILES = [
  // Tests may import across layers (fakes, fixtures); the layering policies below exclude this category.
  { pattern: TEST_FILES, category: 'test' },
  { pattern: layerGlobs('routes'), category: 'routes' },
  { pattern: layerGlobs('controller'), category: 'controller' },
  { pattern: layerGlobs('service'), category: 'service' },
  { pattern: layerGlobs('repository'), category: 'repository' },
  { pattern: layerGlobs('schemas'), category: 'schemas' },
  { pattern: layerGlobs('policies'), category: 'policies' },
  { pattern: layerGlobs('events'), category: 'events' },
  { pattern: `${MODULE}/index.{ts,tsx}`, category: 'module-entry' },
  // The worker's only entry into apps/api platform code: `@platform/api/runtime` (PR #2 m8, D-TASK006-01).
  { pattern: 'apps/api/src/platform/runtime/index.ts', category: 'api-runtime-entry' },
  { pattern: `${MODULE}/**`, category: 'api-module', capture: ['module'] },
  { pattern: 'apps/*/**', category: 'app', capture: ['app'] },
  { pattern: 'packages/*/**', category: 'package', capture: ['pkg'] },
  // The server-only logging subpath of @platform/shared (Pino; TASK-010, PR #20 M1): the resolved-file arm of its guard.
  { pattern: SHARED_LOGGING, category: 'shared-logging' },
  { pattern: DB_PLATFORM, category: 'db-platform' },
  // The folder itself (without the planned Prisma files below): the only importers of the root client.
  { pattern: DB_PLATFORM, category: 'db-platform-core' },
  // The root client factory and the one value importer of the generated client (D-ARCH-103 (3)).
  { pattern: ['apps/*/src/platform/db/client.ts', 'apps/*/src/platform/db/generated.ts'], category: 'db-root-client' },
  // The Prisma query counter (NFR-PERF-006, TASK-276): a test seam, see the last policy (PR34-SEC-01).
  { pattern: 'apps/*/src/platform/db/query-counter.ts', category: 'db-test-seam' },
  { pattern: PLANNED_PRISMA_FILES, category: 'db-platform' },
  { pattern: 'prisma/tests/**', category: 'prisma-tests' },
  // The seed framework (TASK-023): prisma/tests/seed exercises it (D-ORCH-015 reconciliation, PR #13 code review m6).
  { pattern: 'prisma/seed/**', category: 'prisma-seed' },
  { pattern: 'tools/test-support/**', category: 'test-support' },
  { pattern: 'tools/authz/**', category: 'tools-authz' },
  { pattern: PASSWORD_HASHER_MODULE, category: 'password-hasher' },
  { pattern: 'prisma/generated/**', category: 'prisma-generated' },
  { pattern: 'prisma/**', category: 'prisma' },
  { pattern: 'tools/db/**', category: 'tools-db' },
  { pattern: 'tools/**', category: 'tools' },
  { pattern: 'tests/**', category: 'tests-workspace' },
];

/** Importing file selector: one of the layers, never a test file. */
const inLayer = (/** @type {string[]} */ ...names) => ({ file: { categories: { anyOf: names, noneOf: ['test'] } } });
/** Imported file selector. */
const toLayer = (/** @type {string[]} */ ...names) => ({ file: { categories: { anyOf: names } } });
/** Imported external package (and its subpaths). */
const toPackage = (/** @type {string[]} */ ...sources) => ({ module: { source: sources.flatMap((source) => [source, `${source}/**`]) } });

const PRISMA_TARGETS = [
  { module: { source: ['@prisma/client', '@prisma/client/**', '@prisma/adapter-pg'] } },
  { file: { categories: 'prisma-generated' } },
];
const SQL_DRIVER_TARGETS = [toPackage('pg', 'pg-pool')];
/** Code that may touch Prisma: repositories, the database platform (planned files included), prisma/, tools/db and tests. */
const DATABASE_CODE = { file: { categories: { anyOf: ['repository', 'db-platform', 'prisma', 'tools-db', 'test'] } } };
/**
 * Code that may import the SQL driver (`pg`, `pg-pool`): the database platform core only (not the planned Prisma
 * files, not repositories), prisma/, tools/db and tests (PR2-SEC-05 addendum, PR11-SEC-05).
 */
const SQL_DRIVER_CODE = { file: { categories: { anyOf: ['db-platform-core', 'prisma', 'tools-db', 'test'] } } };
/** Code that may import the generated Prisma client as a value (D-ARCH-103 (2)); the same set as the SQL driver. */
const PRISMA_GENERATED_VALUE_CODE = SQL_DRIVER_CODE;
const PRISMA_GENERATED_VALUE_MESSAGE =
  'the generated Prisma client (@platform/prisma/client) is a value only in apps/*/src/platform/db (through platform/db/generated.ts), prisma/, tools/db and tests: repositories and the planned stores use import type, services and other code import nothing from it (D-ARCH-103, ADR-0003 amendment 2026-11-13).';
const EXPRESS_PACKAGES = ['express', 'express-serve-static-core', '@types/express', '@types/express-serve-static-core'];
const NOT_SAME_MODULE = '!{{ from.file.captured.module }}';
const NOT_SAME_APP = '!{{ from.file.captured.app }}';
const IMPORTER_APP = (/** @type {string} */ app) => ({ file: { categories: { anyOf: ['app'], noneOf: ['test'] }, captured: { app } } });
const IMPORTER_MODULE = { file: { categories: { anyOf: ['api-module'], noneOf: ['test'] } } };
const IMPORTER_PACKAGE = (/** @type {string} */ pkg) => ({
  file: { categories: { anyOf: ['package'], noneOf: ['test'] }, captured: { pkg } },
});

/**
 * `@platform/shared/logging` and Pino (TASK-010, PR #20 M1). Specifier arm: `dependency.source` matches the import
 * specifier whatever its origin (a workspace subpath resolves to a local file, so a `module.source` selector, which
 * describes external and core modules, does not match it). Resolved-file arm: any import landing in
 * packages/shared/src/logging (relative path, or the workspace subpath resolved through `@platform/source`).
 */
const SERVER_LOGGING_TARGETS = [
  { dependency: { source: ['@platform/shared/logging', '@platform/shared/logging/**'] } },
  { to: toPackage('pino', 'pino-*') },
  { to: toLayer('shared-logging') },
];
const SERVER_LOGGING_MESSAGE =
  '@platform/shared/logging is server-only (Pino); browser bundles and packages/pricing/ui never import it (ADR-0003, TASK-010).';
/** A packages/shared file outside src/logging (tests excepted): the root barrel and every browser-safe module. */
const IMPORTER_SHARED_OUTSIDE_LOGGING = {
  file: { categories: { anyOf: ['package'], noneOf: ['test', 'shared-logging'] }, captured: { pkg: 'shared' } },
};
const SHARED_ROOT_LOGGING_MESSAGE =
  'packages/shared outside src/logging never imports or re-exports the logging module or Pino, so the @platform/shared root stays browser-safe (TASK-010, PR #20 R2-m1).';

/** Policies. The last matching policy decides and `default` is allow, so each entry is a prohibition or its narrow exception. */
const BOUNDARIES_POLICIES = [
  // --- Layering inside a module: routes -> controller -> service -> repository (ADR-0003). The module index.ts
  //     (category module-entry, unconstrained) is the composition root that wires repository -> service -> controller
  //     and hands the controller to the routes (D-ORCH-006); routes.ts is not a composition root.
  {
    from: inLayer('routes'),
    disallow: { to: toLayer('service', 'repository') },
    message:
      'routes map HTTP paths to controllers only: a route must not import a service or a repository; the module index.ts wires the layers (ADR-0003).',
  },
  {
    from: inLayer('controller'),
    disallow: { to: toLayer('routes') },
    message: 'controllers sit below routes: a controller must not import routes (ADR-0003).',
  },
  {
    from: inLayer('controller'),
    disallow: { to: toLayer('repository') },
    message: 'controllers contain no business logic: a controller must not import a repository, call a service (ADR-0003).',
  },
  {
    from: inLayer('service'),
    disallow: { to: toLayer('controller', 'routes') },
    message: 'services sit below controllers and routes: a service must not import them (ADR-0003).',
  },
  {
    from: inLayer('service'),
    disallow: { to: toPackage(...EXPRESS_PACKAGES) },
    message: 'services import no Express types: keep HTTP concerns in controllers (ADR-0003).',
  },
  {
    from: inLayer('repository'),
    disallow: { to: toLayer('service', 'controller', 'routes') },
    message: 'repositories are the lowest layer: a repository must not import services, controllers or routes (ADR-0003).',
  },
  {
    from: inLayer('schemas', 'policies', 'events'),
    disallow: { to: toLayer('controller', 'routes', 'repository') },
    message: 'schemas, policies and events must not import controllers, routes or repositories (ADR-0003).',
  },

  // --- Prisma and raw SQL are confined to repositories and the database platform (ADR-0003).
  {
    disallow: PRISMA_TARGETS.map((to) => ({ to })),
    message: 'only repositories import Prisma: go through a repository or the tenant transaction handle (ADR-0003).',
  },
  { from: DATABASE_CODE, allow: PRISMA_TARGETS.map((to) => ({ to })) },
  // --- The generated client (`@platform/prisma/client`, classified by the file it resolves to: prisma/generated/**)
  //     as a VALUE: the database platform core, prisma/, tools/db and tests only (D-ARCH-103 (2), ADR-0003 amendment
  //     2026-11-13). Repositories and the two planned stores keep type-only imports (`import type`), allowed above.
  //     Selected by file category: a `module.source` selector matches nothing for a workspace specifier.
  {
    disallow: { to: toLayer('prisma-generated'), dependency: { kind: 'value' } },
    message: PRISMA_GENERATED_VALUE_MESSAGE,
  },
  { from: PRISMA_GENERATED_VALUE_CODE, allow: { to: toLayer('prisma-generated'), dependency: { kind: 'value' } } },
  {
    disallow: SQL_DRIVER_TARGETS.map((to) => ({ to })),
    message:
      'only the database platform core (apps/*/src/platform/db), prisma/, tools/db and tests import the PostgreSQL driver: a second pool runs without the tenant context and outside the business transaction; repositories and SYSTEM writers use the TenantDb (ADR-0005 am. 10 item 2, PR2-SEC-05, PR11-SEC-05).',
  },
  { from: SQL_DRIVER_CODE, allow: SQL_DRIVER_TARGETS.map((to) => ({ to })) },

  // --- The root Prisma client is private to the database platform (ADR-0005 am. 10 item 2, PR2-SEC-05, F-02):
  //     repositories, services and system writers get a TenantDb from withTenantTx. The DB test lane (prisma/tests)
  //     builds runtime clients through the factory on purpose (harness, RLS and catalog suites).
  {
    disallow: { to: toLayer('db-root-client') },
    message:
      'the root database client (platform/db/client.ts) is private to apps/*/src/platform/db, and so is the generated client module (platform/db/generated.ts): use withTenantTx / TenantDb and the types of platform/db/index.ts (ADR-0005 am. 10 item 2, D-ARCH-103).',
  },
  { from: { file: { categories: { anyOf: ['db-platform-core', 'prisma-tests'] } } }, allow: { to: toLayer('db-root-client') } },

  // --- prisma/tests imports only what it exercises (TASK-016, PR #5 code review R3-n1): tools/db, tools/test-support,
  //     the authz seed generator (tools/authz, authz-seed suite), the database platform, the generated client, the
  //     seed framework (prisma/seed, seed suite; TASK-023, PR #13 code review m6) and its own files (harness
  //     included). Packages, apps outside platform/db, other tools and the rest of prisma/ stay out.
  {
    from: { file: { categories: 'prisma-tests' } },
    disallow: { to: toLayer('package', 'app', 'tools', 'tests-workspace', 'prisma') },
    message:
      'prisma/tests may import only tools/db, tools/test-support, tools/authz, apps/*/src/platform/db, prisma/generated, prisma/seed and its own files (PR #5 R3-n1, PR #13 m6).',
  },
  {
    from: { file: { categories: 'prisma-tests' } },
    allow: {
      to: toLayer('tools-db', 'test-support', 'tools-authz', 'db-platform-core', 'prisma-generated', 'prisma-seed', 'prisma-tests'),
    },
  },

  // --- The bcrypt family is confined to the PasswordHasher implementation (D-ARCH-042, ADR-0006 am. 16): import,
  //     export-from, import(), require, module.require and createRequire(...)(...) (see the additional dependency
  //     nodes). The hasher may use bcrypt but never re-export it (that would defeat the port).
  { disallow: { to: toPackage(...BCRYPT_FAMILY) }, message: BCRYPT_MESSAGE },
  { from: { file: { categories: 'password-hasher' } }, allow: { to: toPackage(...BCRYPT_FAMILY) } },
  {
    from: { file: { categories: 'password-hasher' } },
    disallow: { to: toPackage(...BCRYPT_FAMILY), dependency: { nodeKind: 'export' } },
    message: 'the PasswordHasher implementation uses bcrypt but never re-exports it: callers go through the port (D-ARCH-042).',
  },

  // --- Modules talk to each other only through the other module's public index.ts (ADR-0003).
  {
    from: IMPORTER_MODULE,
    disallow: { to: { file: { categories: 'api-module', captured: { module: NOT_SAME_MODULE } } } },
    message: 'a module may import another module only through its public index.ts, never its internals (ADR-0003).',
  },
  {
    from: IMPORTER_MODULE,
    allow: { to: { file: { categories: 'module-entry', captured: { module: NOT_SAME_MODULE } } } },
  },
  // Routes receive everything through their own composition root, so they import no module entry at all (R2-n7). This
  // sits after the cross-module allow above because the last matching policy decides.
  {
    from: inLayer('routes'),
    disallow: { to: toLayer('module-entry') },
    message:
      'routes map HTTP paths to controllers only: a route must not import a module index.ts (its own or another module); the module index.ts wires the layers (ADR-0003).',
  },

  // --- Apps (ADR-0003): web and admin import shared and ui only; api imports no other app; the worker imports
  //     module services through their public index.ts, never controllers or routes.
  {
    from: IMPORTER_APP('{web,admin}'),
    disallow: [{ to: toPackage('@platform/*') }, { to: { file: { categories: 'package', captured: { pkg: '!(shared|ui)' } } } }],
    message:
      'apps/web and apps/admin import only @platform/shared and @platform/ui; server packages (config, audit, authz, carriers, pricing) stay out of the browser bundle (ADR-0003).',
  },
  { from: IMPORTER_APP('{web,admin}'), allow: { to: toPackage('@platform/shared', '@platform/ui') } },
  {
    from: IMPORTER_APP('{web,admin}'),
    disallow: [
      { to: { file: { categories: 'app', captured: { app: NOT_SAME_APP } } } },
      { to: toPackage('@platform/api', '@platform/worker') },
    ],
    message:
      'apps/web and apps/admin never import from another app (apps/api, apps/worker); use @platform/shared and @platform/ui (ADR-0003).',
  },
  {
    from: IMPORTER_APP('api'),
    disallow: [
      { to: { file: { categories: 'app', captured: { app: NOT_SAME_APP } } } },
      { to: toPackage('@platform/worker', '@platform/web', '@platform/admin') },
    ],
    message: 'apps/api imports no other app (ADR-0003).',
  },
  {
    from: IMPORTER_APP('worker'),
    disallow: [
      { to: { file: { categories: 'app', captured: { app: '{web,admin}' } } } },
      { to: toPackage('@platform/web', '@platform/admin') },
    ],
    message: 'apps/worker imports no frontend app (ADR-0003).',
  },
  // Broad rule first: boundaries reports the LAST matching policy, so module internals keep their specific message.
  {
    from: IMPORTER_APP('worker'),
    disallow: { to: { file: { categories: 'app', captured: { app: 'api' } } } },
    message:
      'apps/worker imports apps/api only through @platform/api/runtime and the module entries @platform/api/modules/<module> (ADR-0003, D-TASK006-01).',
  },
  {
    from: IMPORTER_APP('worker'),
    disallow: { to: toLayer('api-module') },
    message:
      'apps/worker imports module services through the module public index.ts, never controllers, routes or other internals (ADR-0003).',
  },
  { from: IMPORTER_APP('worker'), allow: { to: toLayer('module-entry', 'api-runtime-entry') } },

  // --- Packages (ADR-0003): never import apps; pricing is pure.
  {
    from: inLayer('package'),
    disallow: [{ to: toLayer('app') }, { to: toPackage('@platform/api', '@platform/worker', '@platform/web', '@platform/admin') }],
    message: 'packages may not import apps (ADR-0003).',
  },
  {
    from: IMPORTER_PACKAGE('pricing'),
    disallow: [
      { to: { module: { origin: ['external', 'core'] } } },
      { to: { file: { categories: 'package', captured: { pkg: '!(pricing|shared)' } } } },
      { to: toLayer('prisma', 'prisma-generated', 'tools') },
    ],
    message: 'packages/pricing has no I/O imports (allow-list: @platform/shared only, ADR-0003).',
  },
  { from: IMPORTER_PACKAGE('pricing'), allow: { to: toPackage('@platform/shared') } },

  // --- The server-only logging subpath (ADR-0003, TASK-010; PR #20 M1, PR20-SEC-11). The allow-lists above expand
  //     `@platform/shared` to `@platform/shared/**`, so these come last (the last matching policy decides). Both arms:
  //     the package specifier (`@platform/shared/logging`, its subpaths, `pino`) and any import that resolves into
  //     packages/shared/src/logging (relative or workspace path). Applies to every web/admin file (app code and build
  //     configuration), packages/ui and packages/pricing.
  { from: IMPORTER_APP('{web,admin}'), disallow: SERVER_LOGGING_TARGETS, message: SERVER_LOGGING_MESSAGE },
  { from: IMPORTER_PACKAGE('{ui,pricing}'), disallow: SERVER_LOGGING_TARGETS, message: SERVER_LOGGING_MESSAGE },
  //     The transitive path (PR #20 R2-m1, PR20-SEC-16): web, admin, ui and pricing may import the `@platform/shared`
  //     root, so no other packages/shared module may import or re-export the logging module or Pino. The logging
  //     folder itself may import the rest of packages/shared (correlation, errors).
  { from: IMPORTER_SHARED_OUTSIDE_LOGGING, disallow: SERVER_LOGGING_TARGETS, message: SHARED_ROOT_LOGGING_MESSAGE },

  // --- The Prisma query counter is a test seam (NFR-PERF-006, D-TASK276-03; PR34-SEC-01): only test files (including
  //     module and app `tests/` folders, i.e. the API test app builder) and prisma/tests import it, so the production
  //     composition root cannot mount it. Last, so no broader allow above re-opens it; tools/repo/test-seams.test.ts is
  //     the source-scan tripwire for the same rule.
  {
    disallow: { to: toLayer('db-test-seam') },
    message:
      'platform/db/query-counter.ts is a test seam: only tests and prisma/tests import it; production code never mounts it (NFR-PERF-006, PR34-SEC-01).',
  },
  { from: { file: { categories: { anyOf: ['test', 'prisma-tests'] } } }, allow: { to: toLayer('db-test-seam') } },
];

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    // Build and coverage output, anchored to the output folders (root and workspace roots) so a source folder named
    // `build`, `dist` or `coverage` (declared-value coverage is a domain word) is still linted (PR2-SEC-03).
    '{dist,build,coverage}/**',
    '{apps,packages,tests}/*/{dist,build,coverage}/**',
    'prisma/{dist,build,coverage}/**',
    '{apps,packages}/*/.react-router/**',
    'prisma/generated/**',
    // Playwright output (git-ignored; the HTML report bundles third-party viewer JS/CSS) (PR #2 R2-n9), anchored like the
    // build output and .gitignore: a source folder named test-results or playwright-report is still linted (PR4-SEC-10).
    '{playwright-report,test-results}/**',
    '{apps,packages,tests}/*/{playwright-report,test-results}/**',
    'prisma/{playwright-report,test-results}/**',
    'docs/**',
    '.claude/**',
    // Seeded negative fixtures violate rules on purpose; tools/lint/negative-fixtures.test.ts lints them explicitly.
    'tests/fixtures/lint/**',
    // Semgrep rule fixtures (`// ruleid:` lines) violate the patterns on purpose; tools/ci/run-semgrep.mjs --test runs them.
    'tests/fixtures/semgrep/**',
    'tools/deps/fixtures/**',
  ]),
  // One generated TypeScript FILE, kept out of the folder matrix above (which .stylelintignore mirrors, R2-n8):
  // openapi-typescript output (~11.5k lines, its naming not ours), never hand-edited, Prettier-formatted by its
  // generator and kept fresh by `npm run openapi:types -- --check` (TASK-017, REQ-API-019). Importers stay linted.
  globalIgnores(['packages/shared/src/api/types.gen.ts']),

  { linterOptions: { reportUnusedDisableDirectives: 'error' } },

  // --- Baselines ----------------------------------------------------------------------------------------------
  {
    files: [`**/*.${LINTED}`],
    extends: [js.configs.recommended],
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-restricted-imports': ['error', { patterns: RESTRICTED_IMPORT_PATTERNS }],
    },
  },
  {
    files: ['**/*.jsx'],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  },
  {
    files: ['**/*.{mjs,cjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: ROOT } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'separate-type-imports' }],
    },
  },
  {
    // Plain JavaScript (config, tooling scripts) is outside the TypeScript project service: no type-aware rules.
    files: ['**/*.{js,jsx,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // k6 scripts run inside the grafana/k6 runtime (TASK-018; T-QA-06 reuses): k6 globals and built-in modules.
    files: ['tests/load/**/*.js'],
    languageOptions: { globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly', open: 'readonly', console: 'readonly' } },
    settings: { 'import-x/core-modules': ['k6/http', 'k6/execution'] },
  },
  {
    files: DOMAIN_CODE,
    ignores: TEST_FILES,
    rules: { '@typescript-eslint/no-non-null-assertion': 'error' },
  },
  {
    files: TEST_FILES,
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },
  {
    files: APP_AND_PACKAGE_SOURCES,
    ignores: TEST_FILES,
    rules: { 'no-console': 'error' },
  },

  // --- import-x: resolution, cycles, dependency declarations ----------------------------------------------------
  {
    files: [`**/*.${LINTED}`],
    plugins: { 'import-x': importX.importX },
    settings: {
      'import-x/extensions': resolverOptions.extensions,
      'import-x/external-module-folders': ['node_modules', 'node_modules/@types'],
      'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx', '.mts', '.cts'] },
      'import-x/resolver-next': [importX.createNodeResolver(resolverOptions)],
    },
    rules: {
      'import-x/no-unresolved': ['error', { ignore: ['^virtual:', '\\+types/', '\\?(?:url|raw|inline|worker)$'] }],
      'import-x/no-cycle': ['error', { ignoreExternal: true }],
      'import-x/no-self-import': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-relative-packages': 'error',
      'import-x/no-extraneous-dependencies': [
        'error',
        { devDependencies: [...TEST_FILES, 'tools/**', 'tests/**', 'prisma/tests/**', '**/*.config.{ts,mts,mjs,js,cjs}'] },
      ],
    },
  },
  // Workspace tests use the root-level test tooling (@jest/globals, testing-library ...) besides their own manifest.
  ...WORKSPACE_DIRS.map((dir) => ({
    files: TEST_FILES.map((pattern) => `${dir}/${pattern}`),
    rules: {
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true, packageDir: [ROOT, join(ROOT, dir)] }],
    },
  })),
  {
    // tools/repo/jest-esm.test.ts proves that Jest loads the ESM-only `jose` and `uuid`, which are dependencies of
    // apps/api (not of the root manifest). Narrow allowance for this one file; the rule stays on everywhere else.
    files: ['tools/repo/jest-esm.test.ts'],
    rules: {
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true, packageDir: [ROOT, join(ROOT, 'apps/api')] }],
    },
  },
  {
    // The leakage-scanner test (TASK-276) drives the real platform logger (`@platform/shared/logging`, a dependency of
    // apps/api, not of the root manifest) into its log capture. Narrow allowance for this one file, like jest-esm above.
    files: ['tests/helpers/leakage-scanner.test.ts'],
    rules: {
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true, packageDir: [ROOT, join(ROOT, 'apps/api')] }],
    },
  },
  {
    // Composed-app suites (TASK-020; api/README.md §15): the contract drift and route-metadata tests build the real
    // createApp (and fixture Express 5 routers for the walker), so they import apps/api sources and the tools/openapi
    // walker and loader by relative path, reached through tests/generated/tsconfig.json project references
    // (D-TASK017-01 (6); this replaces the former tools/openapi/drift.test.ts allowance and the file-URL loading of
    // api-mounts.ts). `express`, `joi` and the @platform packages come through apps/api's manifest. The ignore is
    // anchored like the tests/api one (PR21-SEC-09): no `..` segment may follow apps/api/src/ or tools/openapi/.
    files: ['tests/generated/**/*.ts'],
    rules: {
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true, packageDir: [ROOT, join(ROOT, 'apps/api')] }],
      'import-x/no-relative-packages': ['error', { ignore: ['^(?:\\.\\./)+(?:apps/api/src|tools/openapi)/(?!(?:.*/)?\\.\\.(?:/|$))'] }],
    },
  },
  {
    // The RLS generator (TASK-024, US-077) also drives the tools/db renderer and table-class manifests and the
    // PostgreSQL 18 Testcontainers harness of prisma/tests, which are no package entry points: exactly those two targets
    // are added, anchored like the rule above (no `..` segment may follow them). tests/generated/tsconfig.json lists the
    // files it type-checks.
    files: ['tests/generated/rls/**/*.ts'],
    rules: {
      'import-x/no-relative-packages': [
        'error',
        { ignore: ['^(?:\\.\\./)+(?:apps/api/src|tools/openapi|tools/db|prisma/tests/harness)/(?!(?:.*/)?\\.\\.(?:/|$))'] },
      ],
    },
  },
  {
    // Contract-validated API tests (TASK-017, US-034, api/README.md §16) run the real createApp and health router with
    // stub Express routers. Neither createApp nor `express` is reachable through a package entry point (`express` is
    // an apps/api dependency), so relative imports into apps/api are the only way in, as for prisma/tests below.
    // Scoped to the *.api.test.ts files under tests/api; the tests/api helpers stay free of apps/api imports. The rule
    // stays ON and ignores exactly apps/api/src (PR #21 R1-m4, the PR #5 R3-n1 pattern): a relative import into any
    // other workspace (packages/*/src, apps/worker, ...) still fails (lint probe in tools/lint/lint-fixtures.mjs).
    files: ['tests/api/**/*.api.test.ts'],
    rules: {
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true, packageDir: [ROOT, join(ROOT, 'apps/api')] }],
      // PR21-SEC-09 / R2-n1: anchored so that no `..` segment may follow apps/api/src/ (a traversal back out of
      // apps/api, e.g. apps/api/src/../../../packages/..., is rejected; third probe in tools/lint/lint-fixtures.mjs).
      'import-x/no-relative-packages': ['error', { ignore: ['^(?:\\.\\./)+apps/api/src/(?!(?:.*/)?\\.\\.(?:/|$))'] }],
    },
  },
  {
    // React Router framework-mode route configuration: read by the `@react-router/dev` Vite plugin at build time and
    // never bundled, so its `@react-router/dev/routes` import is a dev dependency (TASK-004). Exact files only.
    files: ['apps/web/app/routes.ts', 'apps/admin/app/routes.ts'],
    rules: {
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true }],
    },
  },
  {
    // The root Prisma CLI configuration imports `prisma/config` from the prisma workspace's pinned CLI (ADR-0023
    // am. J; TASK-003). Narrow allowance for this one file, like the jest-esm one above.
    files: ['prisma.config.ts'],
    rules: {
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true, packageDir: [ROOT, join(ROOT, 'prisma')] }],
    },
  },
  {
    // The cross-cutting DB test lane (D-TASK003-01: type-checked through tools/tsconfig.json) exercises the root
    // tooling it tests (tools/db, tools/test-support, tools/authz) and the database platform (apps/*/src/platform/db),
    // none of which is a package entry point, so relative imports are the only way in. The rule stays ON and ignores
    // exactly those relative targets (TASK-016, PR #5 R3-n1: the former tree-wide 'off' is removed); the boundaries
    // policy for the `prisma-tests` category enforces the same target list on the resolved files.
    files: ['prisma/tests/**'],
    rules: {
      'import-x/no-relative-packages': [
        'error',
        { ignore: ['^(?:\\.\\./)+(?:tools/(?:db|test-support|authz)|apps/[^/]+/src/platform/db)/[^/]+$'] },
      ],
    },
  },

  // --- Layering (eslint-plugin-boundaries) ----------------------------------------------------------------------
  {
    files: [`{apps,packages,prisma,tools,tests}/**/*.${LINTED}`],
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': ROOT,
      'boundaries/files': BOUNDARIES_FILES,
      // Besides import/export/import()/require (defaults): `createRequire(import.meta.url)('x')` and `module.require('x')`.
      'boundaries/additional-dependency-nodes': [
        {
          selector: 'CallExpression[callee.type="CallExpression"][callee.callee.name="createRequire"] > Literal',
          kind: 'value',
          name: 'require',
        },
        {
          selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name="require"] > Literal',
          kind: 'value',
          name: 'require',
        },
      ],
      // Same resolver (and `@platform/source` condition) as import-x, loaded by path (legacy interface v2).
      'import/resolver': { [RESOLVER_MODULE]: {} },
      'import/extensions': resolverOptions.extensions,
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        { default: 'allow', checkAllOrigins: true, checkInternals: true, checkUnknownLocals: true, policies: BOUNDARIES_POLICIES },
      ],
    },
  },

  // --- Local rules (tools/eslint-rules) -------------------------------------------------------------------------
  {
    files: [`**/*.${LINTED}`],
    plugins: { platform },
    rules: {
      'platform/any-justification': 'error',
      'platform/node-path-only': 'error',
    },
  },
  {
    files: ['packages/*/src/index.ts'],
    plugins: { platform },
    rules: { 'platform/barrel-reexport-only': 'error' },
  },
  {
    files: APP_AND_PACKAGE_SOURCES,
    ignores: TEST_FILES,
    plugins: { platform },
    rules: {
      'platform/money-arith': 'error',
      'platform/no-tofixed-tolocalestring': 'error',
      'platform/no-innerhtml': 'error',
      'platform/audit-writer-allowlist': 'error',
    },
  },
  {
    files: SERVER_SOURCES,
    ignores: [...TEST_FILES, ...BROWSER_PACKAGES],
    plugins: { platform },
    rules: { 'platform/outbound-http-via-client': 'error' },
  },
  {
    // T-83 (D-ARCH-074, D-ARCH-106 (5)): no external I/O or sleeps inside a tenant transaction, in all non-test
    // application code. Roots: withTenantTx callbacks, defineRoute handlers (unless transaction: 'none'), same-file
    // named handlers, the TENANT_TX_FILES and any function taking a TENANT_TX_HANDLE_TYPES parameter. Never disabled
    // inline (tools/lint/tenant-tx-disable-ratchet.test.ts); the only hatch is a route's transaction: 'none'.
    files: [`apps/*/src/**/*.${LINTED}`, `packages/*/src/**/*.${LINTED}`],
    ignores: TEST_FILES,
    plugins: { platform },
    rules: {
      'platform/no-external-calls-in-tenant-tx': ['error', { txFiles: TENANT_TX_FILES, txHandleTypes: TENANT_TX_HANDLE_TYPES }],
    },
  },
  {
    // PR #32 m5 / PR32-SEC-11: no RegExp mount or route path in apps/api/src, test files included (they build the
    // composed app the drift walker reads).
    files: [`apps/api/src/**/*.${LINTED}`],
    rules: { 'no-restricted-syntax': ['error', ...API_RESTRICTED_SYNTAX] },
  },
  {
    // PR20-SEC-13 item 4: log and error-message hygiene in application code and tooling (tests excluded).
    files: [`apps/*/src/**/*.${TS}`, `packages/*/src/**/*.${TS}`, 'tools/**/*.{ts,tsx,mts,cts,mjs}'],
    ignores: TEST_FILES,
    plugins: { platform },
    rules: { 'platform/no-raw-request-in-log': 'error' },
  },
  {
    // PR20-SEC-13 item 4 (a), application code only. tools/** is not wired yet: its CLI entry points print a fatal
    // error's message to the developer's or CI job's stderr (`${error instanceof Error ? error.message : String(error)}`),
    // a different channel than the application log; extending the rule there is a lead decision (TASK-020 S1 report).
    files: [`apps/*/src/**/*.${TS}`, `packages/*/src/**/*.${TS}`],
    ignores: TEST_FILES,
    plugins: { platform },
    rules: { 'platform/no-catch-message-interpolation': 'error' },
  },
  { files: MONEY_HELPERS, rules: { 'platform/money-arith': 'off' } },
  { files: FORMAT_HELPERS, rules: { 'platform/no-tofixed-tolocalestring': 'off' } },
  { files: SANITISING_COMPONENT, rules: { 'platform/no-innerhtml': 'off' } },
  { files: OUTBOUND_CLIENT, rules: { 'platform/outbound-http-via-client': 'off' } },
  { files: AUDIT_WRITER_ALLOW_LIST, rules: { 'platform/audit-writer-allowlist': 'off' } },

  // --- Tenant context and the database platform (ADR-0005 am. 10 items 1, 2, 4, 12, 15; PR2-SEC-05; TASK-016) ------
  {
    // Everywhere (tests and tooling included); the exact-file exemptions follow.
    files: [`**/*.${LINTED}`],
    plugins: { platform },
    rules: { 'platform/tenant-context-sql': 'error' },
  },
  ...TENANT_CONTEXT_EXEMPTIONS.map(({ files, allow }) => ({ files, rules: { 'platform/tenant-context-sql': ['error', { allow }] } })),
  {
    // A Prisma client is constructed only by the database platform, the prisma workspace, tools/db and tests.
    files: [`**/*.${LINTED}`],
    ignores: [DB_PLATFORM, 'prisma/**', 'tools/db/**', ...TEST_FILES],
    plugins: { platform },
    rules: { 'platform/prisma-client-construction': 'error' },
  },
  {
    // Parameterised raw SQL only, and no `$parent` escape, in all application code (services hold a TenantDb too) and
    // the planned non-repository Prisma files (PR11-SEC-05). Tests are excluded: they assert that TenantDb's Proxy
    // refuses these shapes.
    files: [`apps/*/src/**/*.${LINTED}`, ...PLANNED_PRISMA_FILES],
    ignores: TEST_FILES,
    plugins: { platform },
    rules: { 'platform/db-raw-sql': 'error' },
  },
  {
    // SYSTEM-class delegates are reached only through systemDelegates(tx), per model only by the module whose
    // table-class manifest declares the table (PR19-SEC-01, D-ARCH-080). The accessor's home (system-db.ts), the
    // handle that guards it (tenant-db.ts) and tests are outside the rule; every other file in apps and packages is in,
    // the rest of platform/db included, so none of it can re-export the accessor (PR32-SEC-07 (b)).
    files: [`apps/*/src/**/*.${LINTED}`, `packages/*/src/**/*.${LINTED}`],
    ignores: [...SYSTEM_ACCESSOR_HOMES, ...TEST_FILES],
    plugins: { platform },
    rules: { 'platform/system-model-owner': ['error', { owners: SYSTEM_MODEL_OWNERS }] },
  },
  {
    // PR32-SEC-07 (a): every import(), require(), module.require() and createRequire(...)() in application and package
    // code names its module with a literal, so no load escapes the import controls above.
    files: [`apps/*/src/**/*.${LINTED}`, `packages/*/src/**/*.${LINTED}`],
    ignores: TEST_FILES,
    plugins: { platform },
    rules: { 'platform/static-module-specifier': 'error' },
  },
  {
    // Role defaults belong to the bootstrap lane (item 12 d). Tests are excluded (drift probes may name the statement).
    files: [`apps/*/src/**/*.${LINTED}`, `packages/*/src/**/*.${LINTED}`],
    ignores: TEST_FILES,
    plugins: { platform },
    rules: { 'platform/no-alter-role-sql': 'error' },
  },
  {
    // Item 15 asks for warning level until the first state-transition module lands. NOTE: `npm run lint` runs with
    // --max-warnings 0, so this warning already blocks the lint gate; raise to 'error' with TASK-051 (first claim).
    files: REPOSITORY_FILES,
    ignores: TEST_FILES,
    plugins: { platform },
    rules: { 'platform/expect-affected': 'warn' },
  },
  {
    // The hasher keeps every other restricted pattern (re-declared from the shared list, never 'off').
    files: [PASSWORD_HASHER_MODULE],
    rules: { 'no-restricted-imports': restrictedImportsExcept(BCRYPT_IMPORT_PATTERN) },
  },
  {
    // The Supertest allow-list (see SUPERTEST_ALLOW_LIST): every other restricted pattern stays (re-declared, never 'off').
    files: SUPERTEST_ALLOW_LIST,
    rules: { 'no-restricted-imports': restrictedImportsExcept(SUPERTEST_IMPORT_PATTERN) },
  },
  {
    // The S3 seam (D-ARCH-097 (6), PR #32 M1), its tests included: every other restricted pattern stays (re-declared, never 'off').
    files: [`${S3_SEAM}/**`],
    rules: { 'no-restricted-imports': restrictedImportsExcept(S3_SDK_IMPORT_PATTERN) },
  },

  // --- React: hooks, accessibility (NFR-A11Y-*), string externalisation (NFR-I18N-001) -----------------------------
  {
    files: REACT_SOURCES,
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    files: REACT_TSX,
    extends: [jsxA11y.configs.recommended],
  },
  {
    // String externalisation applies to shipped UI, not to test files (their literals are assertions and fixtures).
    files: REACT_TSX,
    ignores: TEST_FILES,
    extends: [i18next.configs['flat/recommended']],
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': {
            exclude: [
              ...['className', 'styleName', 'style', 'type', 'key', 'id', 'width', 'height'],
              ...['role', 'name', 'htmlFor', 'to', 'href', 'rel', 'target', 'lang', 'dir', 'data-testid', 'autoComplete', 'inputMode'],
            ],
          },
        },
      ],
    },
  },
]);
