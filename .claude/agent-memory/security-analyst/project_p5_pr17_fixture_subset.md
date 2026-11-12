---
name: project-p5-pr17-fixture-subset
description: PR #17 (TASK-007 follow-up, D-ORCH-018 item 2) R1 @ea78d38 PASS_WITH_FOLLOW-UPS; PR17-SEC-01..06 (.swcrc unowned, location-blind subset, gate deny-list, wiring twin); swc/Jest/runner facts; record-row pitfall
metadata:
  type: project
---

The PR #17 review is `docs/05-quality/security/PR-0017-TASK-007-security-review.md`.
- **R1:** head `ea78d38`, 2026-11-13. Verdict PASS_WITH_FOLLOW-UPS, with 4 LOW and 2 INFO findings.
- **Record check:** simulated with main's tool, and it passed.
- **Change under review:** the base-ref lint fixture step now runs in `LINT_FIXTURE_MODE=no-weakening` (subset) mode. The head `test:unit` run stays exact.

**Findings (all open):**
- **01 (LOW).** Unowned `.swcrc` files compile every Jest suite, including the base-ref suite.
- **02 (LOW).** The matcher is location-blind.
  - 32 of the 63 expectations use an empty message fragment.
  - In subset mode, "substitution plus an extra same-rule finding" passes, where exact mode failed it.
- **03 (LOW).** The required-gate `run:` check is a deny-list. Kebab-case flags, `--listTests`/`--showConfig`/`--onlyChanged`, `|| true`, `shell:`/`working-directory:` and a split-string `$GITHUB_ENV` write all pass.
- **04 (LOW).** The lint-script wiring check (`check-suppressions` inside `npm run lint`) is skipped in the base run. It needs a subset ("no-weakening") version instead.
- **05 (INFO).** The step summary uses a fixed code fence, so untrusted text can break out of it.
- **06 (INFO).** The base-sourcing closure is incomplete (it misses `npm-cli.mjs` and `jest.config.ts`). The claim wording in D-TASK007-03 needs fixing.

**Facts, probe-confirmed 2026-11-13:**
- **@swc/jest 0.2.39 with no inline options**
  - It reads `<cwd>/.swcrc` and passes the result to `transformSync` without a `swcrc` key.
  - @swc/core then also uses the NEAREST `.swcrc` above each file, and that file beats the root one.
  - A `jsc.paths` entry for `@jest/globals` redirects `expect`/`it` to a shim.
  - `swcrc: false` stops the lookup.
  - Fix for 01: inline options in `jest.config.ts`; add `/.swcrc` and `**/.swcrc` to CODEOWNERS.
- **Jest 30.5.2**
  - Accepts `--test-name-pattern`, `--pass-with-no-tests` and `--test-path-ignore-patterns`.
  - `-tvalue` (value attached) is not a filter.
  - Positional test paths are regexes.
- **jest-util** gives every test file its own copy of `process.env`. Accidental cross-file env leaks are impossible; vm escape is still possible.
- **The GitHub runner refuses `NODE_OPTIONS` from `$GITHUB_ENV`** (v2.309.0+). The existing `node-options-preload` rule catches it in step/job/workflow `env:`.
- **Record pitfall.** `recordHeadShas` treats ANY table row whose first cell starts with "Head" (word boundary, case-insensitive) as a head row, e.g. "Head parser change". Never start a first cell with "Head" except the real Head row.

**Why:** 01 affects the Wave-1 authz/audit/RLS Jest gates without triggering the security-owned-paths record. 02–04 are cheap fixes to a control cited for PR2-SEC-08.

**How to apply:**
- **TASK-015 / the next devops PR:** check
  - 01: inline swc options with `swcrc:false`, CODEOWNERS entries, a repo rule, and a test with a planted nested `.swcrc`;
  - 03: exact-text pin of the step, `--runTestsByPath`, and a ban on `shell`/`working-directory` (together with PR10-SEC-17).
- **The next change to the fixture harness or TASK-020:** check
  - 02: line/column in the harness;
  - 04: the subset wiring check;
  - 05: a fence-safe summary.
- **Before 01 is fixed:** in every PR, look for `.swcrc` files anywhere in the diff.
- **Before merge:** owned-path overlap with main was nil on 2026-11-13. Re-check it if owned paths land on main first.

Related: [[project-p5-pr10-ci-lane]], [[project-p5-pr2-lint-controls]], [[project-security-review-conventions]]
