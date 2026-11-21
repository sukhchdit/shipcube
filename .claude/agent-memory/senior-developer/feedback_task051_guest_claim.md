---
name: task051-guest-claim
description: TASK-051 resume lessons - shared probe modules between prisma/tests and tests/generated/rls, SEC-TC-07 suite placement, sibling rule trap, Write-after-cat
metadata:
  type: feedback
---

Shared test modules used by both `prisma/tests/**` and `tests/generated/rls/**` go in `prisma/tests/harness/` (the
only prisma/tests folder the tests/generated/rls lint ignore allows; eslint.config.mjs is the TASK-041 `lint` lock),
and must be added to the `files` list of `tests/generated/tsconfig.json` (composite base: TS6307 otherwise).
**Why:** a pending required case (e.g. SEC-TC-07 of `rls-cross-tenant`) only counts when the suite runner's project
runs it: suite-runners.json maps rls-cross-tenant to `--selectProjects generated` over `tests/generated/rls/`, so a
test in `prisma/tests/rls` never credits it.
**How to apply:** before placing a SEC-TC/AT test, check `tools/quality/suite-runners.json` + the jest project testMatch
for the suite named in required-suites.json / gherkin-test-map.

Pure finding rules with "sibling" lookups must exclude the row itself and require the exact shape (a key bound through
BOTH owner columns is unchecked under MATCH SIMPLE and must be nobody's sibling) - the host fixture test caught it.

The Write/Edit tools refuse a file only seen via `cat` in Bash: Read it (even 3 lines) first. Related: [[feedback_pr33_fc1]].
