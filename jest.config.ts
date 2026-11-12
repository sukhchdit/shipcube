/**
 * Jest 30 configuration (ADR-0024). Three projects selected by the root scripts:
 *   unit        `*.test.ts(x)`      -> npm run test:unit
 *   integration `*.int.test.ts(x)`  -> npm run test:integration (Testcontainers; Docker required)
 *   api         `*.api.test.ts(x)`  -> npm run test:api (Supertest + OpenAPI validation)
 * Sources are transpiled by @swc/jest using the root `.swcrc` (CommonJS output, no type-check;
 * `npm run typecheck` is the type gate). Workspace packages resolve to their TypeScript sources
 * through the `@platform/source` export condition, the same condition `tsconfig.base.json` uses.
 */
import type { Config } from 'jest';

type ProjectConfig = Exclude<NonNullable<Config['projects']>[number], string>;

const IGNORED_PATHS = ['/node_modules/', '/dist/', '/build/', '/fixtures/'];

const common: ProjectConfig = {
  rootDir: '.',
  // Explicit roots: patterns like '<rootDir>/{a,b}/**' match nothing on Windows (SPK-01).
  roots: ['<rootDir>/apps', '<rootDir>/packages', '<rootDir>/prisma', '<rootDir>/tests', '<rootDir>/tools'],
  testEnvironment: 'node',
  testEnvironmentOptions: {
    customExportConditions: ['@platform/source', 'node', 'node-addons'],
  },
  transform: { '^.+\\.(t|j)sx?$': '@swc/jest' },
  // NodeNext sources import siblings as `./x.js`; map them back to the `.ts` file.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
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
    // Test helpers beside sources (the module `tests/` layer, fixtures) and generated output.
    '!**/{tests,fixtures}/**',
    '!**/.react-router/**',
    '!prisma/generated/**',
    // Package entry points only re-export; the v8 provider would count them as uncovered lines.
    '!packages/*/src/index.ts',
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
      testMatch: ['**/*.test.{ts,tsx}'],
      testPathIgnorePatterns: [...IGNORED_PATHS, '\\.(int|api)\\.test\\.tsx?$', '/tests/e2e/'],
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
  ],
};

export default config;
