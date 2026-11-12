# Seeded lint fixtures

Each directory below this one is a miniature repository root. `tools/lint/negative-fixtures.test.ts` lints the files
listed in its case tables with the real `eslint.config.mjs` / `stylelint.config.mjs` (the fixture directory is the ESLint
`cwd`, so the path-based layering rules apply to the fixture-relative paths) and asserts the exact rule that fires.

- `bad-*` files violate exactly one rule on purpose.
- `ok-*` files, and files at an allow-listed path, must lint clean.

The tree is excluded from `npm run lint`, Prettier, `tsc` and Jest discovery.
