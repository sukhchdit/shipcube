/**
 * Lints the seeded fixtures under tests/fixtures/lint with the repository's real ESLint and Stylelint configurations
 * and prints one JSON report on stdout (TASK-002). Run in a child process by tools/lint/negative-fixtures.test.ts, so
 * the ESM-only linters and the `.mjs` configurations load in plain Node rather than through Jest's module registry.
 *
 * Every directory under `layering/` and `rules/`, plus `react/` and `resolution/`, is a miniature repository root: it
 * is both the ESLint `cwd` and the boundaries root path, so the path-based layering and allow-list globs apply to
 * fixture-relative paths. Overrides keep the run fast and hermetic, and leave every rule under test unchanged:
 *  - non-type-aware parsing (the fixtures belong to no tsconfig project);
 *  - `import-x/no-extraneous-dependencies` off everywhere (fixture roots have no package.json);
 *  - `import-x/no-unresolved` off except under `resolution/`, which proves end to end that ESLint resolves
 *    `@platform/*` workspace imports and NodeNext `./x.js` specifiers, and reports a missing module.
 *
 * Besides the fixture findings, the report carries configuration evidence computed on the repository itself:
 * `ignored` (ESLint and Stylelint ignore decisions for a path matrix), `effective` (rule severities for a path
 * matrix, through `calculateConfigForFile`), the local rule names and the resolver output.
 *
 * Usage: node tools/lint/lint-fixtures.mjs  ->  { eslint, stylelint, resolver, probes, localRules, ignored, effective }
 */
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { ESLint } from 'eslint';
import stylelint from 'stylelint';
import tseslint from 'typescript-eslint';

import platform from '../eslint-rules/index.mjs';
import { resolve as resolveModule } from './resolver.mjs';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const FIXTURES = join(REPO_ROOT, 'tests', 'fixtures', 'lint');
const ESLINT_CONFIG = join(REPO_ROOT, 'eslint.config.mjs');
const STYLELINT_CONFIG = join(REPO_ROOT, 'stylelint.config.mjs');
const LINTED_FILE = /\.(?:[cm]?js|jsx|tsx?)$/u;

/**
 * @typedef {{ ruleId: string | null; message: string; severity: 'error' | 'warning' }} Finding
 * @typedef {Record<string, Finding[]>} Report fixture-relative POSIX path -> findings
 */

/** @param {string} path */
const toKey = (path) => relative(FIXTURES, path).split(sep).join('/');

/**
 * @param {string} dir
 * @returns {string[]}
 */
const listFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );

/** @returns {string[]} */
const eslintRoots = () => [
  ...['layering', 'rules'].flatMap((group) =>
    readdirSync(join(FIXTURES, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(FIXTURES, group, entry.name)),
  ),
  join(FIXTURES, 'react'),
];

/**
 * @param {string} root
 * @param {{ resolution?: boolean }} [options] `resolution: true` keeps `import-x/no-unresolved` on.
 * @returns {Promise<Report>}
 */
async function lintRoot(root, { resolution = false } = {}) {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: ESLINT_CONFIG,
    overrideConfig: [
      tseslint.configs.disableTypeChecked,
      { files: ['**/*.{ts,tsx}'], languageOptions: { parserOptions: { projectService: false } } },
      {
        rules: {
          'import-x/no-extraneous-dependencies': 'off',
          ...(resolution ? {} : { 'import-x/no-unresolved': 'off' }),
        },
      },
      { settings: { 'boundaries/root-path': root } },
    ],
  });
  const files = listFiles(root).filter((file) => LINTED_FILE.test(file));
  const results = await eslint.lintFiles(files);
  return Object.fromEntries(
    results.map((result) => [
      toKey(result.filePath),
      result.messages.map(({ ruleId, message, severity }) => ({ ruleId, message, severity: severity === 2 ? 'error' : 'warning' })),
    ]),
  );
}

/** @returns {Promise<Report>} */
async function lintCss() {
  const cssRoot = join(FIXTURES, 'css');
  const { results } = await stylelint.lint({
    // The fixture directory is the cwd, so the repository .stylelintignore (which ignores the fixtures) does not apply.
    cwd: cssRoot,
    files: listFiles(cssRoot),
    configFile: STYLELINT_CONFIG,
  });
  return Object.fromEntries(
    results.map((result) => [
      toKey(result.source ?? ''),
      result.warnings.map(({ rule, text, severity }) => ({
        ruleId: rule,
        message: text,
        severity: severity === 'error' ? 'error' : 'warning',
      })),
    ]),
  );
}

/** Repository-relative paths whose ESLint ignore decision is reported (they need not exist). */
const IGNORE_MATRIX = [
  'dist/x.js',
  'build/x.js',
  'coverage/lcov-report/x.js',
  'apps/web/build/client/x.js',
  'apps/api/dist/server.js',
  'packages/shared/dist/index.js',
  'apps/api/coverage/x.js',
  'apps/web/.react-router/types/x.ts',
  'packages/shared/src/coverage/a.ts',
  'packages/carriers/src/build/a.ts',
  'packages/carriers/src/dist/a.ts',
  'apps/api/src/modules/shipments/build/a.ts',
  'apps/web/app/routes/a.jsx',
  // PR4-SEC-10: Playwright output is ignored only at the root and the workspace roots.
  'playwright-report/x.js',
  'tests/e2e/test-results/x.js',
  'tests/e2e/playwright-report/x.js',
  'apps/api/src/modules/quotes/test-results/a.ts',
  'packages/authz/src/playwright-report/a.ts',
];
/** Repository-relative paths whose Stylelint ignore decision is reported. */
const STYLE_IGNORE_MATRIX = [
  'dist/x.css',
  'apps/web/build/client/assets/x.css',
  'packages/ui/dist/x.css',
  'coverage/x.css',
  'apps/web/app/coverage/x.css',
  'packages/ui/src/build/x.css',
  'playwright-report/x.css',
  'tests/e2e/playwright-report/x.css',
  'apps/web/app/test-results/x.css',
  'packages/ui/src/playwright-report/x.css',
];

/** Repository-relative paths whose effective rule severities are reported (`calculateConfigForFile`). */
const EFFECTIVE_MATRIX = [
  'apps/api/src/modules/orders/service/a.ts',
  'apps/api/src/modules/identity/service/bcrypt-password-hasher.ts',
  'apps/api/src/platform/a.cjs',
  'apps/web/app/routes/a.jsx',
  'apps/web/app/routes/a.test.tsx',
  'packages/ui/src/session/client.ts',
  'packages/shared/src/a.ts',
  // TASK-016: the narrowed audit-writer allow-list (n5) and the scope of the tenant-database rules.
  'apps/api/src/platform/http/a.ts',
  'apps/api/src/platform/audit/a.ts',
  'apps/worker/src/platform/a.ts',
  'apps/worker/src/processors/a.ts',
  'apps/api/src/modules/orders/repository/a.ts',
  'prisma/tests/rls/a.int.test.ts',
  // PR11-SEC-05: db-raw-sql covers the planned non-repository Prisma files.
  'packages/audit/src/store/prisma-store.ts',
];
const EFFECTIVE_RULES = [
  'no-restricted-imports',
  'boundaries/dependencies',
  'platform/outbound-http-via-client',
  'platform/no-innerhtml',
  'i18next/no-literal-string',
  'jsx-a11y-x/alt-text',
  'platform/audit-writer-allowlist',
  'platform/tenant-context-sql',
  'platform/prisma-client-construction',
  'platform/db-raw-sql',
  'platform/expect-affected',
  'import-x/no-relative-packages',
];

/**
 * @param {unknown} entry
 * @returns {'error' | 'warn' | 'off'}
 */
const severityOf = (entry) => {
  const level = Array.isArray(entry) ? /** @type {unknown} */ (entry[0]) : entry;
  if (level === 2 || level === 'error') return 'error';
  if (level === 1 || level === 'warn') return 'warn';
  return 'off';
};

async function configEvidence() {
  const eslint = new ESLint({ cwd: REPO_ROOT, overrideConfigFile: ESLINT_CONFIG });
  /** @type {Record<string, boolean>} */
  const eslintIgnored = {};
  for (const path of IGNORE_MATRIX) eslintIgnored[path] = await eslint.isPathIgnored(join(REPO_ROOT, path));

  /** @type {Record<string, boolean>} */
  const stylelintIgnored = {};
  for (const path of STYLE_IGNORE_MATRIX) {
    const { results } = await stylelint.lint({
      cwd: REPO_ROOT,
      code: 'a { color: red; }\n',
      codeFilename: join(REPO_ROOT, path),
      configFile: STYLELINT_CONFIG,
    });
    // Stylelint returns no result at all for ignored code input.
    stylelintIgnored[path] = results.length === 0 || results[0]?.ignored === true;
  }

  /** @type {Record<string, Record<string, string> | null>} */
  const effective = {};
  for (const path of EFFECTIVE_MATRIX) {
    /** @type {{ rules?: Record<string, unknown> } | undefined} */
    const config = await eslint.calculateConfigForFile(join(REPO_ROOT, path));
    const rules = config?.rules;
    effective[path] = rules
      ? {
          ...Object.fromEntries(EFFECTIVE_RULES.map((rule) => [rule, severityOf(rules[rule])])),
          // Options are reported for no-restricted-imports, the rule a file-scoped block may re-declare.
          'no-restricted-imports:options': JSON.stringify(
            Array.isArray(rules['no-restricted-imports']) ? rules['no-restricted-imports'].slice(1) : [],
          ),
        }
      : null;
  }
  return { ignored: { eslint: eslintIgnored, stylelint: stylelintIgnored }, effective };
}

/**
 * In-memory probes linted at repository paths (`lintText`, nothing is written). Workspace imports such as
 * `@platform/config` resolve to repository files (packages/<name>/src), which a fixture root cannot classify, so the
 * policies keyed on those files are proven here, with real resolution (`import-x/no-unresolved` stays on).
 */
const REPO_PROBES = {
  'apps/web/app/routes/lint-probe-bad-config.ts':
    "import * as config from '@platform/config';\n\nexport const probe = (): unknown => config;\n",
  'apps/admin/app/routes/lint-probe-bad-pricing.ts':
    "import * as pricing from '@platform/pricing';\n\nexport const probe = (): unknown => pricing;\n",
  // PR #2 m8 / D-TASK006-01: the worker reaches apps/api through the package exports only.
  'apps/worker/src/jobs/lint-probe-ok-api-runtime.ts':
    "import { createRuntimeLog } from '@platform/api/runtime';\n\nexport const probe = (): unknown => createRuntimeLog;\n",
  'apps/worker/src/jobs/lint-probe-bad-api-subpath.ts':
    "import { problemHandler } from '@platform/api/src/platform/errors/problem-handler.js';\n\nexport const probe = (): unknown => problemHandler;\n",
  'apps/worker/src/jobs/lint-probe-bad-api-relative.ts':
    "import { problemHandler } from '../../../api/src/platform/errors/problem-handler.js';\n\nexport const probe = (): unknown => problemHandler;\n",
  'apps/web/app/routes/lint-probe-ok-shared-ui.ts':
    "import * as shared from '@platform/shared';\nimport * as ui from '@platform/ui';\n\nexport const probe = (): unknown => [shared, ui];\n",
};

/** @returns {Promise<Report>} */
async function lintRepoProbes() {
  const eslint = new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: ESLINT_CONFIG,
    overrideConfig: [
      tseslint.configs.disableTypeChecked,
      { files: ['**/*.{ts,tsx}'], languageOptions: { parserOptions: { projectService: false } } },
      // The probes are not declared in the app manifests' dependency lists on purpose (the layering rule is under test).
      { rules: { 'import-x/no-extraneous-dependencies': 'off' } },
    ],
  });
  /** @type {Report} */
  const report = {};
  for (const [path, code] of Object.entries(REPO_PROBES)) {
    const [result] = await eslint.lintText(code, { filePath: join(REPO_ROOT, path) });
    report[path] = (result?.messages ?? []).map(({ ruleId, message, severity }) => ({
      ruleId,
      message,
      severity: severity === 2 ? 'error' : 'warning',
    }));
  }
  return report;
}

const reports = await Promise.all([
  ...eslintRoots().map((root) => lintRoot(root)),
  lintRoot(join(FIXTURES, 'resolution'), { resolution: true }),
]);
const importer = join(REPO_ROOT, 'packages', 'pricing', 'src', 'index.ts');
const shared = resolveModule('@platform/shared', importer);

process.stdout.write(
  JSON.stringify({
    eslint: Object.assign({}, ...reports),
    stylelint: await lintCss(),
    resolver: { '@platform/shared': shared.found && shared.path ? relative(REPO_ROOT, shared.path).split(sep).join('/') : null },
    probes: await lintRepoProbes(),
    localRules: Object.keys(platform.rules ?? {}),
    ...(await configEvidence()),
  }),
);
