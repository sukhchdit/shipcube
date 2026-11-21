# Seeded lint fixtures

Each directory below `layering/` and `rules/`, plus `react/` and `resolution/`, is a miniature repository root.
`tools/lint/negative-fixtures.test.ts` lints the files listed in its case tables with the real `eslint.config.mjs` /
`stylelint.config.mjs` (the fixture directory is the ESLint `cwd`, so the path-based layering rules apply to the
fixture-relative paths) and asserts the exact rule that fires.

- `bad-*` files violate one rule on purpose (two only where two independent controls cover the same import, as for
  the bcrypt confinement).
- `ok-*` files, and files at an allow-listed path, must lint clean.
- `resolution/` is linted with `import-x/no-unresolved` on, to prove workspace and NodeNext resolution through ESLint.
- `typed/<rule>/` roots carry their own `tsconfig.json` and are the only roots linted with type information, for the
  type-aware branch of that rule (`typed/money-arith`: the `Minor` brand, PR #2 m10, TASK-076). Every other root is
  parsed without types, so the run stays fast.

The tree is excluded from `npm run lint` (ESLint and Stylelint ignores), `tsc` and Jest discovery. Prettier does
format and check it, like any other source file.

Lane A also runs the **base ref's** copy of the suite, these fixtures, the harness and its Jest config
(`tools/lint/jest.base-fixtures.config.json`) against the PR's lint configs (PR2-SEC-08) with
`LINT_FIXTURE_MODE=no-weakening` (D-ORCH-018; `tools/lint/fixture-expectations.mjs`): every finding a base fixture
expects must still be reported, no fixture may report a finding without a rule id (an unused `eslint-disable`
directive, a parse error, an ignored file), extra findings with a rule id from rules the PR adds are listed in the job
summary instead of failing, and the positive-only checks (case-table and rule completeness, exact ignore and "off"
decisions) are left to the PR's own copy, which runs in the default `exact` mode.
