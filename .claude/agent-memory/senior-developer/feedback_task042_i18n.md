---
name: task042-i18n
description: TASK-042 i18n runtime and checker (2026-11-21) - i18next quirks (usedLng on miss, empty strings), JSON import attributes in NodeNext packages, Jest isolateModules + React, lint-lock workaround via a lint step
metadata:
  type: feedback
---

TASK-042 (US-115) was built solo in about 90 calls. These traps are worth knowing before the next frontend i18n task.

**Why:** each one cost a test or typecheck loop, and none can be seen from the code alone.

**How to apply:**
- **i18next `resolved.usedLng` is the LAST language tried, even when no language had the key.** To detect a miss, check `resolved.res` (`postProcessPassResolved: true`) as well as `usedLng !== requested`. i18next 27 also treats `''` as missing unless `returnEmptyString` is set; we set it to false on purpose.
- **ICU `#` uses `Intl.NumberFormat`:** es 1000000 is `1.000.000`, fr uses U+202F (which `\s` matches). es 1000 has no separator (minimumGroupingDigits); the shared helpers (TASK-050) own `useGrouping: 'always'`.
- **A NodeNext package (`packages/*`) importing JSON** needs `with { type: 'json' }` plus `"src/**/*.json"` in the tsconfig `include`. @swc/jest (CJS output) and Vite both accept the attribute.
- **Jest `isolateModulesAsync` for a module-load capture** (such as `SERVED_LANG`): import react-dom/server, react-router AND the module inside the isolated callback, so the hooks share one React. Outer JSX elements still work, because element symbols are global. Use a box object for the result, since TS loses the narrowing inside a nested function declaration.
- **When eslint.config.mjs is locked by another task,** a TS-parser checker under `tools/<x>` wired as an extra `npm run lint` step works. Extend `LINT_STEPS` in tools/lint/negative-fixtures.test.ts too: exact mode pins the steps, while base-ref no-weakening mode tolerates the extra step.
- A new `platform/*` rule in tools/eslint-rules/index.mjs without its config line fails the "every local rule has a fixture" test. Do not register a rule you cannot enable.
- An interface member written as a method signature (`translate(): string`) trips `@typescript-eslint/unbound-method` when it is destructured. Use `readonly translate: (...) => string`.
- Split a manifest change into its own commit by building the intermediate blob: `git hash-object -w` on the edited copy, then `git update-index --cacheinfo`.

Related: [[p5-worktrees]], [[playwright-harness]], [[merge-main-pass]]
