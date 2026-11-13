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
 * Every `no-restricted-imports` pattern of the repository. Flat config replaces (does not merge) rule options, so a
 * file-scoped block re-declares the rule from this list minus its own exception, never `'off'`.
 */
const RESTRICTED_IMPORT_PATTERNS = [BCRYPT_IMPORT_PATTERN];

/** Every file extension ESLint lints (PR2-SEC-03: `.jsx` included, so no source file is silently skipped). */
const LINTED = '{js,jsx,mjs,cjs,ts,tsx,mts,cts}';
const TEST_FILES = ['**/*.test.{ts,tsx,js,jsx}', '**/{test,tests,__tests__}/**'];
const APP_AND_PACKAGE_SOURCES = [`apps/*/{src,app}/**/*.${LINTED}`, `packages/*/src/**/*.${LINTED}`, 'prisma/seed/**/*.ts'];
/** Browser packages: not server code (TASK-065 puts the Axios session client in packages/ui/src/session). */
const BROWSER_PACKAGES = ['packages/ui/**'];
/** Server code: the api, the worker and every package except the browser ones (new packages are covered by default). */
const SERVER_SOURCES = [`apps/api/src/**/*.${LINTED}`, `apps/worker/src/**/*.${LINTED}`, `packages/*/src/**/*.${LINTED}`];
const REACT_SOURCES = ['apps/web/app/**/*.{ts,tsx,js,jsx}', 'apps/admin/app/**/*.{ts,tsx,js,jsx}', 'packages/ui/src/**/*.{ts,tsx,js,jsx}'];
const REACT_TSX = ['apps/web/app/**/*.{tsx,jsx}', 'apps/admin/app/**/*.{tsx,jsx}', 'packages/ui/src/**/*.{tsx,jsx}'];

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
/** Repository layer files (folder or single file), for the raw-SQL and expectAffected rules. */
const REPOSITORY_FILES = ['apps/api/src/modules/*/repository/**', 'apps/api/src/modules/*/repository.{ts,tsx}'];
/**
 * `platform/tenant-context-sql` exemptions (ADR-0005 am. 10 items 1 and 4; TASK-016 lead decision 6; PR11-SEC-08).
 * Exact files only (no folder globs: a new file in an exempted folder must not inherit the exemption), each with the
 * forms it may contain: `setter` (the context setter function name), `keys` (the four security keys, e.g. a
 * readiness read), `session-set` (`SET [SESSION] app.…` / `RESET app.…`), `session-set-config` (the setter with
 * is_local = false). Every other file gets the rule with no exemption.
 */
const ALL_CONTEXT_FORMS = ['setter', 'keys', 'session-set', 'session-set-config'];
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
  // SPK-03 spike, kept until the C-1 artifact is recorded (lead decision 3): ran every form, including the leak control.
  // Remove this entry in the commit that deletes the spike file (a stale entry would exempt any future file there).
  { files: ['prisma/tests/spikes/spk03-rls-tx.int.test.ts'], allow: ALL_CONTEXT_FORMS },
  // SPK-08 spike (PR #12, merged): one migrate-diff probe policy reads a key directly. Remove this entry in the commit
  // that ports and deletes the spike file (TASK-021, D-TASK012-02 (1)).
  { files: ['prisma/tests/spikes/spk08-audit-owner.int.test.ts'], allow: ['keys'] },
  // Catalog C-series: the prosrc scan's negative fixtures create functions that run a session SET of a context key
  // (transaction-local setter fixtures only: no is_local = false).
  { files: ['prisma/tests/catalog/c01-c12.int.test.ts'], allow: ['setter', 'keys', 'session-set'] },
  // The catalog scan helpers name the keys (the renderer's deparsed operator-scope atom).
  { files: ['prisma/tests/catalog/scans.ts'], allow: ['keys'] },
  // The RLS renderer emits the §4.3 policies over the §4.2 helpers.
  { files: ['tools/db/render-rls.ts', 'tools/db/render-rls.test.ts'], allow: ['keys'] },
  // Migration-linter rule 16 names the forms it rejects; its tests and the shared form list's tests name every
  // evasion form, session forms included (PR11-SEC-02).
  { files: ['tools/db/lint-migrations.ts'], allow: ['setter', 'keys'] },
  { files: ['tools/db/lint-migrations.test.ts', 'tools/db/tenant-key-forms.test.ts'], allow: ALL_CONTEXT_FORMS },
  // pg_dump's own preamble `set_config('search_path', '', false)`, asserted verbatim (no tenant key; not a session form).
  { files: ['tools/db/up-down-up.test.ts'], allow: ['setter'] },
];
/** Domain code in which non-null assertions are forbidden (NFR-MAINT-002). */
const DOMAIN_CODE = ['packages/{pricing,audit,authz,carriers}/src/**/*.ts', 'apps/api/src/modules/*/service/**/*.ts'];

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
  { pattern: DB_PLATFORM, category: 'db-platform' },
  // The folder itself (without the planned Prisma files below): the only importers of the root client.
  { pattern: DB_PLATFORM, category: 'db-platform-core' },
  { pattern: 'apps/*/src/platform/db/client.ts', category: 'db-root-client' },
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
const EXPRESS_PACKAGES = ['express', 'express-serve-static-core', '@types/express', '@types/express-serve-static-core'];
const NOT_SAME_MODULE = '!{{ from.file.captured.module }}';
const NOT_SAME_APP = '!{{ from.file.captured.app }}';
const IMPORTER_APP = (/** @type {string} */ app) => ({ file: { categories: { anyOf: ['app'], noneOf: ['test'] }, captured: { app } } });
const IMPORTER_MODULE = { file: { categories: { anyOf: ['api-module'], noneOf: ['test'] } } };
const IMPORTER_PACKAGE = (/** @type {string} */ pkg) => ({
  file: { categories: { anyOf: ['package'], noneOf: ['test'] }, captured: { pkg } },
});

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
      'the root database client (platform/db/client.ts) is private to apps/*/src/platform/db: use withTenantTx / TenantDb (ADR-0005 am. 10 item 2).',
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
    // The OpenAPI drift test (TASK-017, api/README.md §15) builds fixture Express 5 routers to prove the route walker
    // against the real router stack; `express` is a dependency of apps/api, not of the root manifest. Narrow
    // allowance for this one file, like the jest-esm one above.
    files: ['tools/openapi/drift.test.ts'],
    rules: {
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true, packageDir: [ROOT, join(ROOT, 'apps/api')] }],
    },
  },
  {
    // Contract-validated API tests (TASK-017, US-034, api/README.md §16) run the real createApp and health router with
    // stub Express routers. Neither createApp nor `express` is reachable through a package entry point (`express` is
    // an apps/api dependency), so relative imports into apps/api are the only way in, as for prisma/tests below.
    // Scoped to the *.api.test.ts files under tests/api; the tests/api helpers stay free of apps/api imports.
    files: ['tests/api/**/*.api.test.ts'],
    rules: {
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true, packageDir: [ROOT, join(ROOT, 'apps/api')] }],
      'import-x/no-relative-packages': 'off',
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
    rules: {
      'no-restricted-imports': ['error', { patterns: RESTRICTED_IMPORT_PATTERNS.filter((pattern) => pattern !== BCRYPT_IMPORT_PATTERN) }],
    },
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
