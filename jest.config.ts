/**
 * Jest 30 configuration (ADR-0024). Five projects selected by the root scripts:
 *   unit        `*.test.ts`         -> npm run test:unit (Node environment)
 *   unit-dom    `*.test.tsx`        -> npm run test:unit (jsdom: React Testing Library component tests)
 *   integration `*.int.test.ts(x)`  -> npm run test:integration (Testcontainers; Docker required)
 *   api         `*.api.test.ts(x)`  -> npm run test:api (Supertest + OpenAPI validation)
 *   generated   `tests/generated/**` `*.{api,int}.test.ts(x)` -> npm run test:generated (RBAC matrix, audit, RLS and
 *               abuse generators, which need an app or a database; TASK-276, T-QA-03). `integration` and `api` ignore
 *               tests/generated, so a generated suite never runs twice; a plain `*.test.ts(x)` there (route-registry,
 *               contract drift) stays a lane A unit test (PR #34 R1-M1). tools/repo/jest-projects.test.ts pins the map.
 * Sources are transpiled by @swc/jest with the inline SWC_JEST_OPTIONS below (CommonJS output, no
 * type-check; `npm run typecheck` is the type gate). Workspace packages resolve to their TypeScript
 * sources through the `@platform/source` export condition, the same condition `tsconfig.base.json` uses.
 */
import type { Config } from 'jest';

type ProjectConfig = Exclude<NonNullable<Config['projects']>[number], string>;

/**
 * @swc/jest options (PR17-SEC-01). Inline options stop @swc/jest from reading `<cwd>/.swcrc`, and `swcrc: false` stops
 * @swc/core from applying the nearest `.swcrc` above each compiled file, so an unowned `.swcrc` (e.g. a `jsc.paths`
 * redirect of `@jest/globals`) cannot change how any suite compiles. The transform lives only in this owned file and in
 * the owned base-ref copy tools/lint/jest.base-fixtures.config.json (tools/ci/jest-transform.test.ts keeps them equal);
 * check-workflow-policy rejects any committed `.swcrc`.
 */
export const SWC_JEST_OPTIONS = {
  swcrc: false,
  jsc: {
    parser: { syntax: 'typescript', tsx: true },
    target: 'es2023',
    keepClassNames: true,
    transform: { react: { runtime: 'automatic' } },
  },
  module: { type: 'commonjs' },
  sourceMaps: 'inline',
};

const IGNORED_PATHS = ['/node_modules/', '/dist/', '/build/', '/fixtures/'];

/** Folder of the `generated` project; `integration` and `api` ignore it (their suffixes would match its suites too). */
const GENERATED_PATH = '/tests/generated/';

/** Module paths the resolver never sees (exported for tools/repo/jest-config-owned.test.ts). */
export const MODULE_PATH_IGNORE_PATTERNS = ['<rootDir>/.*/dist/', '<rootDir>/.*/build/', '/__mocks__/'];

// NodeNext sources import siblings as `./x.js`; map them back to the `.ts` file.
const JS_EXTENSION_MAPPER = { '^(\\.{1,2}/.*)\\.js$': '$1' };

const common: ProjectConfig = {
  rootDir: '.',
  // Explicit roots: patterns like '<rootDir>/{a,b}/**' match nothing on Windows (SPK-01).
  roots: ['<rootDir>/apps', '<rootDir>/packages', '<rootDir>/prisma', '<rootDir>/tests', '<rootDir>/tools'],
  testEnvironment: 'node',
  testEnvironmentOptions: {
    customExportConditions: ['@platform/source', 'node', 'node-addons'],
  },
  transform: { '^.+\\.(t|j)sx?$': ['@swc/jest', SWC_JEST_OPTIONS] },
  moduleNameMapper: JS_EXTENSION_MAPPER,
  // /__mocks__/ (PR4-SEC-11, PR17-SEC-09): suites mock with jest.mock(name, factory) only. Without this pattern Jest 30
  // would serve ANY <roots>/**/__mocks__/<pkg>.js as <pkg> for a bare require in EVERY suite, so an unowned file could
  // replace @platform/authz or pg in the RBAC, audit and RLS suites. The jest-manual-mocks repository rule also rejects
  // any __mocks__ directory, and CODEOWNERS owns **/__mocks__/. tools/lint/jest.base-fixtures.config.json mirrors it.
  modulePathIgnorePatterns: MODULE_PATH_IGNORE_PATTERNS,
  testPathIgnorePatterns: [...IGNORED_PATHS, GENERATED_PATH],
};

const config: Config = {
  coverageProvider: 'v8',
  // The 85/75 gate spans the whole repository (TEST-STRATEGY §8). The include globs cover every workspace source
  // root, i.e. each plain directory in a workspace tsconfig `include`: `src/` everywhere, the React Router
  // framework-mode `app/` of apps/web and apps/admin, and the Prisma seed framework. tests/* workspaces hold test
  // code only. tools/repo/coverage-scope.test.ts fails when the source roots and these globs drift apart.
  collectCoverageFrom: [
    '{apps,packages}/*/{src,app}/**/*.{ts,tsx}',
    'prisma/seed/**/*.{ts,tsx}',
    '!**/*.test.{ts,tsx}',
    '!**/*.d.ts',
    // Generator outputs by exact path, never by suffix (PR21-SEC-04): a hand-written `*.generated.ts` stays measured.
    // tools/repo/coverage-scope.test.ts keeps this list equal to the tracked `*.generated.ts` / `*.gen.ts` files.
    // tools/api/gen-module-registry.ts output (the API module registry).
    '!apps/api/src/modules/index.generated.ts',
    // openapi-typescript output (types only, TASK-017): v8 would count its ~11.5k type lines as uncovered.
    '!packages/shared/src/api/types.gen.ts',
    // Test helpers beside sources (the module `tests/` layer, fixtures) and generated output.
    '!**/{tests,fixtures}/**',
    '!**/.react-router/**',
    '!prisma/generated/**',
    // Package entry points only re-export; the v8 provider would count them as uncovered lines.
    '!packages/*/src/index.ts',
    // React Router build-time modules (ssr:false): the server entry and the route table run only inside
    // `react-router build` (pre-render) and `typegen`; apps/web/tests/prerender.int.test.ts exercises them (PR #4 m8).
    '!apps/*/app/{entry.server.tsx,routes.ts}',
  ],
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  // COVERAGE_TARGET (CLAUDE.md §3), global part: 85 % line / 75 % branch, an independent tripwire. The US-006 gate
  // proper (overall 85/75 plus 95/95 for packages/{pricing,audit,authz}, the D-QA-003 money paths and the ledger) is
  // tools/ci/coverage-gate.mjs over the json-summary report (D-TASK015-10): Jest path keys would error on a package
  // with no measured file yet and would subtract the matched files from `global`.
  coverageThreshold: {
    global: { lines: 85, branches: 75 },
  },
  projects: [
    {
      ...common,
      displayName: 'unit',
      testMatch: ['**/*.test.ts'],
      testPathIgnorePatterns: [...IGNORED_PATHS, '\\.(int|api)\\.test\\.ts$', '/tests/e2e/'],
    },
    {
      ...common,
      displayName: 'unit-dom',
      // Component tests resolve browser builds: `browser` replaces the Node-side `node`/`node-addons` conditions of `common` (m8).
      // jsdom plus the Fetch API globals react-router needs (tools/test-dom/jsdom-environment.mjs). The DOM support files
      // live outside tools/test-support, which lane A's base-ref lint-fixture step replaces with the base copy.
      testEnvironment: '<rootDir>/tools/test-dom/jsdom-environment.mjs',
      testEnvironmentOptions: { customExportConditions: ['@platform/source', 'browser'] },
      testMatch: ['**/*.test.tsx'],
      testPathIgnorePatterns: [...IGNORED_PATHS, '\\.(int|api)\\.test\\.tsx$', '/tests/e2e/'],
      setupFilesAfterEnv: ['<rootDir>/tools/test-dom/dom-setup.ts'],
      moduleNameMapper: { ...JS_EXTENSION_MAPPER, '\\.css$': '<rootDir>/tools/test-dom/style-stub.ts' },
    },
    {
      ...common,
      displayName: 'integration',
      testMatch: ['**/*.int.test.{ts,tsx}'],
      // No project-level testTimeout: Jest 30 reads only the global value (PR34-SEC-04). Container hooks set their own
      // budget (`afterAll(..., 60_000)` in seed.int and spk03); lane B passes --testTimeout to in-band projects.
    },
    {
      ...common,
      displayName: 'api',
      testMatch: ['**/*.api.test.{ts,tsx}'],
      // api/README.md §16 item 6: merges the (operationId, status) pairs into reports/api-contract-coverage.json (report, not a gate).
      globalTeardown: '<rootDir>/tests/api/helpers/coverage-teardown.ts',
    },
    {
      ...common,
      displayName: 'generated',
      // The generator suites that need an app or a database (`*.api.test.ts`, `*.int.test.ts`) under tests/generated;
      // lane B runs them with `<paths> --selectProjects generated`. Plain `*.test.ts` there stays in `unit` (R1-M1).
      testMatch: ['**/tests/generated/**/*.{api,int}.test.{ts,tsx}'],
      testPathIgnorePatterns: IGNORED_PATHS,
    },
  ],
};

export default config;
