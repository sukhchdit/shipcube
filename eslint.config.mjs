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
/** Importers of the audit writer: the audit package and its allow-listed callers (REQ-AUDIT-001, ADR-0007). */
const AUDIT_WRITER_ALLOW_LIST = [
  'packages/audit/**',
  'apps/api/src/platform/**', // request pipeline: audit middleware, withTenantTx
  'apps/worker/src/**', // system jobs
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
  { pattern: `${MODULE}/**`, category: 'api-module', capture: ['module'] },
  { pattern: 'apps/*/**', category: 'app', capture: ['app'] },
  { pattern: 'packages/*/**', category: 'package', capture: ['pkg'] },
  { pattern: 'apps/*/src/platform/db/**', category: 'db-platform' },
  { pattern: PLANNED_PRISMA_FILES, category: 'db-platform' },
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
/** Code that may touch Prisma and the SQL driver: repositories, the database platform, the prisma workspace, tools and tests. */
const DATABASE_CODE = { file: { categories: { anyOf: ['repository', 'db-platform', 'prisma', 'tools-db', 'test'] } } };
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
    message: 'only repositories import the PostgreSQL driver and run raw SQL (ADR-0003).',
  },
  { from: DATABASE_CODE, allow: SQL_DRIVER_TARGETS.map((to) => ({ to })) },

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
  {
    from: IMPORTER_APP('worker'),
    disallow: { to: toLayer('api-module') },
    message:
      'apps/worker imports module services through the module public index.ts, never controllers, routes or other internals (ADR-0003).',
  },
  { from: IMPORTER_APP('worker'), allow: { to: toLayer('module-entry') } },

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
    // Playwright output (git-ignored; the HTML report bundles third-party viewer JS/CSS) (PR #2 R2-n9).
    '**/playwright-report/**',
    '**/test-results/**',
    'docs/**',
    '.claude/**',
    // Seeded negative fixtures violate rules on purpose; tools/lint/negative-fixtures.test.ts lints them explicitly.
    'tests/fixtures/lint/**',
    'tools/deps/fixtures/**',
  ]),

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
    // React Router framework-mode route configuration: read by the `@react-router/dev` Vite plugin at build time and
    // never bundled, so its `@react-router/dev/routes` import is a dev dependency (TASK-004). Exact files only.
    files: ['apps/web/app/routes.ts', 'apps/admin/app/routes.ts'],
    rules: {
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true }],
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
