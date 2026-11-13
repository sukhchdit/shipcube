/**
 * Jest 30 configuration (ADR-0024). Four projects (five with the opt-in stack project) selected by the root scripts:
 *   unit        `*.test.ts`         -> npm run test:unit (Node environment)
 *   unit-dom    `*.test.tsx`        -> npm run test:unit (jsdom: React Testing Library component tests)
 *   integration `*.int.test.ts(x)`  -> npm run test:integration (Testcontainers; Docker required)
 *   api         `*.api.test.ts(x)`  -> npm run test:api (Supertest + OpenAPI validation)
 *   stack       `tests/compose/*.stack.test.ts` -> npm run test:stack (images + docker compose; opt-in, TASK-014)
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
  modulePathIgnorePatterns: ['<rootDir>/.*/dist/', '<rootDir>/.*/build/'],
  testPathIgnorePatterns: IGNORED_PATHS,
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
    '!**/*.generated.ts',
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
  // COVERAGE_TARGET (CLAUDE.md §3), global part: 85 % line / 75 % branch. The 95 % per-path thresholds for
  // packages/{pricing,audit,authz} are added by TASK-015 (coverage gates) once those packages contain code:
  // Jest fails a path threshold that matches no files.
  coverageThreshold: {
    global: { lines: 85, branches: 75 },
  },
  projects: [
    {
      ...common,
      displayName: 'unit',
      testMatch: ['**/*.test.ts'],
      testPathIgnorePatterns: [...IGNORED_PATHS, '\\.(int|api|stack)\\.test\\.ts$', '/tests/e2e/'],
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
    },
    {
      ...common,
      displayName: 'api',
      testMatch: ['**/*.api.test.{ts,tsx}'],
    },
    // TASK-014: the Compose/image stack suite builds every image and runs `docker compose up`, so the project exists
    // only when JEST_STACK=1 (`npm run test:stack`, tools/compose/run-stack-tests.mjs); test:unit, test:integration
    // and test:coverage never include it.
    ...(process.env.JEST_STACK === '1' ? [{ ...common, displayName: 'stack', testMatch: ['**/tests/compose/**/*.stack.test.ts'] }] : []),
  ],
};

export default config;
