/**
 * Lints the seeded fixtures under tests/fixtures/lint with the repository's real ESLint and Stylelint configurations
 * and prints one JSON report on stdout (TASK-002). Run in a child process by tools/lint/negative-fixtures.test.ts, so
 * the ESM-only linters and the `.mjs` configurations load in plain Node rather than through Jest's module registry.
 *
 * Every directory under `layering/`, `rules/` and `react/` is a miniature repository root: it is both the ESLint `cwd`
 * and the boundaries root path, so the path-based layering and allow-list globs apply to fixture-relative paths. Two
 * overrides keep the run fast and hermetic, and leave every rule under test unchanged:
 *  - non-type-aware parsing (the fixtures belong to no tsconfig project);
 *  - `import-x/no-extraneous-dependencies` and `import-x/no-unresolved` off (fixture roots have no package.json and
 *    must not depend on what happens to be hoisted into node_modules). The resolver is reported separately.
 *
 * Usage: node tools/lint/lint-fixtures.mjs  ->  { "eslint": {...}, "stylelint": {...}, "resolver": {...} }
 */
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { ESLint } from 'eslint';
import stylelint from 'stylelint';
import tseslint from 'typescript-eslint';

import { resolve as resolveModule } from './resolver.mjs';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const FIXTURES = join(REPO_ROOT, 'tests', 'fixtures', 'lint');

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
 * @returns {Promise<Report>}
 */
async function lintRoot(root) {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: join(REPO_ROOT, 'eslint.config.mjs'),
    overrideConfig: [
      tseslint.configs.disableTypeChecked,
      {
        files: ['**/*.{ts,tsx}'],
        languageOptions: { parserOptions: { projectService: false } },
        rules: { 'import-x/no-extraneous-dependencies': 'off', 'import-x/no-unresolved': 'off' },
      },
      { settings: { 'boundaries/root-path': root } },
    ],
  });
  const files = listFiles(root).filter((file) => /\.tsx?$/u.test(file));
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
    configFile: join(REPO_ROOT, 'stylelint.config.mjs'),
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

const reports = await Promise.all(eslintRoots().map(lintRoot));
const importer = join(REPO_ROOT, 'packages', 'pricing', 'src', 'index.ts');
const shared = resolveModule('@platform/shared', importer);

process.stdout.write(
  JSON.stringify({
    eslint: Object.assign({}, ...reports),
    stylelint: await lintCss(),
    resolver: { '@platform/shared': shared.found && shared.path ? relative(REPO_ROOT, shared.path).split(sep).join('/') : null },
  }),
);
