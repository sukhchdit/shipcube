# Code review: PR #17, TASK-007 follow-up (round 1)

- **PR:** #17 `fix/ci-base-fixture-subset`, head `ea78d38` (1 commit on `eccdca1`; main has since gained docs/memory-only commits, `git merge-tree` is clean)
- **Scope:** lane A step "Lint negative fixtures from the base ref against the head configs (PR2-SEC-08)" moves to no-weakening (subset) semantics. New `tools/lint/fixture-expectations.mjs`. The suite gains a mode split. `--testNamePattern` is removed. The step becomes a required gate with a pinned `env:`, and a new `lint-fixture-mode` workflow-policy rule is added.
- **Decisions:** D-ORCH-018 item 2, D-TASK007-03. Context: PR #10 review m3 (base-ref sourcing) and R2-m2 (self-policing rules are tripwires).
- **Reviewer:** code-reviewer · 2026-11-13

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A small, well-reasoned fix with a good shape: the mode comes from the step env only and fails closed on unknown values, the
         assertion module is taken from the base, and the evidence table runs the real ci.yml script. It passes the real PR #11
         configs (2 extras, 0 missing). One MAJOR: findings without a rule id (ESLint "Unused eslint-disable directive") count as
         allowed extras. Turning off `@typescript-eslint/no-explicit-any` everywhere passes the new base run green, but failed the old one.
FINDINGS: 1 MAJOR · 3 MINOR · 6 NIT (table in §3)
SECURITY-FLAGS: §6
```

## 1. Verification I performed myself

The dispatch forbade installs, builds, Docker and full suites (memory-constrained host). I made `git archive` scratch copies of `ea78d38` and of PR #11 `37a2109`, junctioned `node_modules` to the PR #17 and TASK-016 worktrees respectively, and added `apps/node_modules/@platform/*` override junctions. Afterwards I removed every junction and both copies. No link is left at `C:\`, the worktrees are clean, and both worktree `node_modules` still hold 740 entries.

| Check | Result |
|---|---|
| `git diff eccdca1 ea78d38` (10 files) | Read in full, plus the full suite, the harness's `reportUnusedDisableDirectives` / severity mapping, the ci.yml classifier, the gate-tooling step and the record step |
| `jest --selectProjects unit` on `fixture-expectations`, `check-workflow-policy`, `ci-policy` (copy) | 3 suites, **116 / 116 pass** |
| `negative-fixtures.test.ts`, `LINT_FIXTURE_MODE=no-weakening` (copy) | **68 pass / 26 skipped**, 0 extras. 3 failures are copy artefacts and also occur in exact mode: the 2 `@platform` probes and the resolver path, because workspace links resolve into the worktree (known, see scratch-copy notes). |
| Same suite, `exact` (copy) | 94 pass, the same 3 artefacts. The skip set equals the old `--testNamePattern` exclusions (all `allowed:` / `lints clean` / case-table / `npm run lint` titles) plus rule completeness. |
| **Motivating case:** `ea78d38`'s suite, fixtures, harness, `fixture-expectations.mjs` and `test-support` overlaid on PR #11 `37a2109` configs, no-weakening | **68 pass / 26 skipped**, only the 3 artefacts fail. Summary lists exactly the 2 `platform/prisma-client-construction` findings on `bad-orders.service.ts`, tagged `[rule new to the base]`. This reproduces E3/E7 on the real PR #11 configs. |
| **Mutation M-a:** `@typescript-eslint/no-explicit-any: 'off'` in `eslint.config.mjs:362` | **no-weakening: 68 pass, exit 0 apart from the artefacts**, 4 extras `(no rule id) (error): Unused eslint-disable directive (no problems were reported from '@typescript-eslint/no-explicit-any')`, tagged `[rule new to the base]`. **exact: 6 real failures** (4 × `[AT-US-001-05] … (bad-*)`, lints clean, `allowed: … justification`). Under the pre-PR filter the 4 `bad-*` cases ran exact, so they **would have failed** (M1). |
| **Mutation M-b:** `testNamePattern: 'nomatch'` added to the copy's `jest.config.ts` (head-controlled in the step) | no-weakening run: **97 skipped, exit 0** (m2) |
| `probe-gate.mjs`: the PR's `checkWorkflow(…, { requiredGates: true })` on 12 in-memory ci.yml mutations | **0 findings** for `--test-name-pattern x`, `-tx`, `--pass-with-no-tests --test-path-ignore-patterns …`, `--listTests`, `--onlyChanged`, `-o`, `--lastCommit`, `--shard=2/2`, `exit 0`, base checkout replaced by `true`, a `git checkout HEAD -- tools/lint/fixture-expectations.mjs` before Jest, `export "LINT_FIX""TURE_MODE=exact"` (m1, n3) |
| Jest 30 ground truth (copy, `fixture-expectations.test.ts`) | `--test-name-pattern nomatch`: exit 0, 19 skipped. `-tnomatch`: exit 0. `--listTests`: exit 0, nothing run. `--pass-with-no-tests --test-path-ignore-patterns …`: "No tests found, exiting with code 0". `--shard=2/2`: exit 1. `@jest/core` `exitWith0 = passWithNoTests \|\| lastCommit \|\| onlyChanged`. |
| `prettier --check` on the 10 changed files; `node tools/ci/check-workflow-policy.mjs --root .` on the PR worktree | clean; exit 0 |
| CI run 43308041320 (head `ea78d38`) | fast-lane **success**: unit 1651 passed. The base-ref step ran with `RANGE_BASE: 22eccb2` and `LINT_FIXTURE_MODE: no-weakening`, the old suite ran unfiltered and **97 passed** (E6 confirmed). scans red only on "Security-owned paths need a review record". |
| `git apply --check` of PR #11's net diff (`63accea..37a2109`) onto `ea78d38` | **fails** at `tools/lint/negative-fixtures.test.ts:253`. The PR #11 superseding branch must resolve this conflict by hand (§5). |
| Not re-run by me | full `lint`, `typecheck`, `test:unit`, `build`, actionlint, commitlint. I relied on CI run 43308041320 and the author's local table. |

## 2. What is good (keep)

- **Fail-closed mode selection.** `fixtureMode` throws on any value other than unset, `''`, `exact` or `no-weakening`, and it is evaluated at module load, so a typo stops the suite before it runs. The mode can be set only in the step `env:`. That is the weakest mode, so the head cannot gain anything by flipping the base run to a different mode.
- **Assertion module from the base.** `fixture-expectations.mjs` joins the harness in the base checkout and in the restore. The restore list is pinned by `ci-policy.test.ts`.
- **`noWeakening` matching is correct for the predicate used.** The predicate is rule id + `error` + message fragment, and every finding with the same rule id is interchangeable, so greedy one-to-one matching is optimal. Duplicate expectations need distinct findings. A downgrade to warning or a missing policy message is reported as `missing`, with the reported set shown.
- **The `--testNamePattern` removal** puts the skip set in the base suite. The `exactOnly` set equals the old exclusions plus rule completeness, as I verified.
- **Honest bootstrap.** E6 and the CI run show that main's old suite passes unfiltered on this PR. The PR body states the stale-`base.sha` behaviour.
- **The evidence table runs the actual ci.yml step script (E6–E8),** not only the suite.

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| M1 | **MAJOR** | `tools/lint/fixture-expectations.mjs:46-62`, `:73`; `tools/lint/negative-fixtures.test.ts:297-318`; `tools/lint/fixture-expectations.test.ts` ("extras of any kind … ruleless directive") | **A rule-id-less extra can be evidence of weakening, and the PR lets it pass.** `eslint.config.mjs:327` sets `reportUnusedDisableDirectives: 'error'`. When a head config stops reporting a rule that a base fixture's `eslint-disable` comment suppresses, ESLint reports `Unused eslint-disable directive (no problems were reported from 'X')` with `ruleId: null`. That finding says the head no longer reports X at that spot. `noWeakening` puts it in `extras`, and `formatExtras` labels it `[rule new to the base]`. Proof (mutation M-a): with `@typescript-eslint/no-explicit-any` turned **off** repo-wide, the new base run passes and lists 4 extras. The old base run (exact `bad-*` cases, which the old filter did not exclude) fails the 4 `[AT-US-001-05]` cases. `no-explicit-any` has no other signal in the base suite: it is not in `EFFECTIVE_RULES`, and the `allowed:` cases that would also catch it are now skipped. So this PR loses detection of a real weakening that the step caught before. | In no-weakening mode, fail on any extra with `ruleId === null`. This covers directive reports and fatal parse errors. A rule the head adds or widens always carries a rule id, so PR #11 (non-null extras only) still passes. Apply the same relaxed check to the skipped `ok-*` / `allowed:` fixtures instead of skipping them completely: "no `ruleId: null` findings", so unused-directive weakening in clean fixtures (e.g. `ok-justified.ts`) is caught too. Flip the unit case that allows a ruleless directive, and add (a) cases for an "Unused eslint-disable directive" extra and for a fatal parse error. Add evidence row **E9**: `no-explicit-any` off gives exit 1 in the ci.yml step script. Optional: add `@typescript-eslint/no-explicit-any` to `EFFECTIVE_RULES` in the harness. |
| m1 | MINOR | `tools/ci/check-workflow-policy.mjs:121-122`; `check-workflow-policy.test.ts` (filter loop) | **The required-gate deny-list misses the spellings of the very flags it names.** Jest accepts `--test-name-pattern`, `-tX`, `--pass-with-no-tests` and `--test-path-ignore-patterns`. All of them, plus `--listTests` and `--onlyChanged`/`-o`/`--lastCommit` (exit 0 with no tests), give 0 findings. D-TASK007-03 accepts that "the gate checks presence, not integrity" (`exit 0`). But the PR body and the JSDoc say the gate requires an unfiltered run and list these flags, and a reviewer reading a diff is more likely to miss a kebab-case flag than `exit 0`. | Use an allow-list instead of a deny-list. Anchor the two Jest lines exactly (`^node --experimental-vm-modules --disable-warning=ExperimentalWarning node_modules/jest/bin/jest\.js "\$suite" \\\n\s+--selectProjects unit \|\| status=\$\?$`, line-anchored with nothing else on either line) and require `exit "$status"` as the last line. Add the kebab, `-tX` and `--listTests` forms to the negative loop. Word the remaining claim as a tripwire, in line with PR #10 R2-m2. In-PR preferred (cheap), otherwise TASK-015 together with R2-m2. |
| m2 | MINOR | `.github/workflows/ci.yml:270-273`; PR body "Change"; D-TASK007-03 item 1 | **"The base suite decides what its mode skips" does not hold against the head `jest.config.ts`.** The step runs the base suite under the head Jest config. `testNamePattern` or `passWithNoTests` plus a project `testPathIgnorePatterns` entry skips the run with exit 0 (mutation M-b: 97 skipped, exit 0). A `moduleNameMapper` entry can redirect `./fixture-expectations.mjs` or `../test-support/process.js` to head code. This is the PR #10 m3 (a) residual. The backstop is that `jest.config.ts` is CODEOWNED and in `REQUIRED_CODEOWNED_PATHS`, so it needs a security record. The `ci-policy.test.ts:130` check that `jest.config.ts` never mentions the variable runs in the head and does not constrain the head. | Either run the step under a base-controlled config (`--config` with a JSON config extracted from `$RANGE_BASE`, or written inline and pinned by m1's allow-list), or add a post-run check on Jest `--json` output: `numTotalTests > 0`, `numFailedTests == 0`, and `numPendingTests` equal to the base suite's `exactOnly` count. At minimum, extend the D-TASK007-03 residual text to name `jest.config.ts` (`testNamePattern`, `passWithNoTests`, `testPathIgnorePatterns`, `moduleNameMapper`, `setupFiles`), and correct the PR body's "a PR cannot change what its own base run accepts". Route to TASK-015 if not fixed in-PR. |
| m3 | MINOR | `tools/lint/negative-fixtures.test.ts:441-495`; `fixture-expectations.mjs:53` (`severity === 'error'` hard-coded) | **Strengthening can still fail the base run through positive halves that remain in non-`exactOnly` tests, and the API cannot express "at least warning".** (a) `report.ignored.*` is compared with `toEqual` on `true` values. `packages/ui` `outbound-http-via-client` must be `'off'`, `i18next/no-literal-string` must be `'off'` in test files, and the hasher's options must `not.toContain('bcrypt')`. Turning any of these on is strengthening, yet the base run would fail. (b) PR #11 adds `it.each(WARNINGS)` with an exact `[[ruleId, 'warning']]` and `allowed (TASK-016): %s` clean cases as plain `it`. Once PR #11 lands in the base, raising `platform/expect-affected` from warn to error fails the base run, which is the D-ORCH-018 defect again. | Split each mixed test into a weakening half (always runs) and a positive half (`exactOnly`). Give `noWeakening` an expected minimum severity (warning ≤ error) so that raising a warning to error passes and downgrading or removing it fails. The PR #11 superseding branch must route its `WARNINGS` through it and mark `allowed (TASK-016)` as `exactOnly` (§5). In-PR for (a) and the API; (b) belongs to PR #11. |
| n1 | NIT | `negative-fixtures.test.ts:317` | Head rule messages go into a ```` ```text ```` fence in `$GITHUB_STEP_SUMMARY`. A message containing ```` ``` ```` breaks out of the fence and injects markdown (links, images) into the job summary. The list is also unbounded. | Use a fence longer than the longest backtick run in the text (or indent by 4 spaces), and cap the list (e.g. 200 lines + "N more"). |
| n2 | NIT | `fixture-expectations.mjs:73` | A `null` rule id is labelled `[rule new to the base]`. This folds into M1; if any null extra is ever kept, label it `[no rule id]`. | — |
| n3 | NIT | `check-workflow-policy.mjs` `mentionsOf`; `ci-policy.test.ts:126-132` | `lint-fixture-mode` matches literal mentions only (`export "LINT_FIX""TURE_MODE=exact"` gives 0 findings). The `package.json`/`jest.config.ts` assertion runs in the head. Both are tripwires. | Word the PR body and JSDoc as "literal mentions" / tripwire. |
| n4 | NIT | PR body "Bootstrap notes" | Runs whose `base.sha` predates the merge (reopen, re-run) run the old suite **unfiltered**. That is stricter than before: it adds the 26 positive cases, including the `npm run lint` wiring check, so it fails closed. Run 43308041320 shows `RANGE_BASE` = main tip at event time (`22eccb2`), not the fork point. | Add one sentence on this. Merge-order note in §5. |
| n5 | NIT | `ci.yml:97` (pre-existing) | The `LINT_CONTROLS` classifier ignores `package-lock.json`, so a lock-only bump of an ESLint/Stylelint plugin skips the base-ref step. | Route to TASK-015. |
| n6 | NIT | `negative-fixtures.test.ts:311-318` | When `beforeAll` fails, `afterAll` still prints "0 extra finding(s) … (allowed)". This is cosmetic. | Skip the summary when `report` is undefined. |

## 4. Rulings on focus questions

- **What counts as the same finding:** rule id + `error` + message fragment, matched one-to-one. This is correct and matches the old exact predicate. Counts are respected, and extra same-rule findings become extras. Directive reports are the gap (M1).
- **Can a head PR flip the mode?** Not through any route that weakens the base run. Only the step `env:` sets it, and `no-weakening` is already the weakest mode, so setting `exact` is stricter. The head *can* bypass the run as a whole through `jest.config.ts` (m2) or the step script (m1 / D-TASK007-03 residual). Both are CODEOWNED and need a security record.
- **`--testNamePattern` removal and the gate entry:** the removal is correct and the skip set is verified. The gate's deny-list is incomplete (m1).
- **`fixture-expectations.mjs` from the base, then restored:** correct, and pinned by `ci-policy.test.ts`. The bootstrap case (base lacks the file) is handled by the existing `cat-file` guard.
- **Extras in `$GITHUB_STEP_SUMMARY`:** they work (I saw them in the PR #11 probe). Fence/cap issue n1.
- **E0–E8:** adequate for (a) rule removed or downgraded, (b) rule added and (c) head stays exact. Missing: weakening that shows up only as a directive report (E9, M1).
- **Bootstrap for open PRs:** fail-closed (n4). PR #11's superseding branch gets the new suite as long as it is opened or pushed after #17 merges.

## 5. Merge conditions

1. M1 fixed, with unit cases and evidence row E9 (`no-explicit-any` off gives exit 1 through the step script). m1 and m3 (a) plus the severity API in-PR are preferred. m2 is either fixed or written into the D-TASK007-03 residual and routed to TASK-015.
2. security-analyst record for `ea78d38`'s successor (CODEOWNED `/.github/`, `/tools/ci/`, `/tools/lint/`); lane A green on the final head.
3. **Order:** merge #17 first, then open or push the PR #11 superseding branch from the new main. Its net diff does **not** apply cleanly on `ea78d38` (`negative-fixtures.test.ts:253`). When resolving it, its new cases must use the mode split: `bad-*` through `expectFindings`, `allowed (TASK-016)` as `exactOnly`, and `WARNINGS` through the severity-aware check (m3 b). Re-run the base suite against its configs in no-weakening mode.
4. Round 2 re-runs: mutation M-a (must fail), the PR #11 overlay probe (must pass with exactly the 2 extras), and `probe-gate.mjs` (the kebab / `-tX` / `--listTests` / `exit 0` forms must be flagged if m1 is fixed in-PR).

## 6. Security flags (for security-analyst)

- **M1:** the no-weakening control no longer catches a repo-wide `no-explicit-any` disable (AT-US-001-05). Weigh it under PR2-SEC-08.
- **m1 / m2:** the integrity of the required gate depends on `/.github/` and `jest.config.ts` record review. Confirm that the D-TASK007-03 LOW residual also covers Jest config `testNamePattern` / `passWithNoTests` / `moduleNameMapper` and the Jest flag spellings.
- **n1:** markdown injection from head rule messages into the job summary (INFO/LOW).

## Round 2 (head 8dd1d24)

- **Head:** `8dd1d24` (one commit on `ea78d38`, "ci(lint): fail ruleless findings and pin the base-ref fixture gate"), 13 files, +827/−201
- **Inputs:** `git diff ea78d38 8dd1d24` (read in full), fix comment #6837295158, D-TASK007-03/04, lane A run 43316597810
- **Reviewer:** code-reviewer · 2026-11-13

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: M1 is closed. Ruleless findings now fail in no-weakening mode, and clean fixtures run in both modes. E9 reproduced: with
         no-explicit-any off the real ci.yml step script exits 1 with 6 real failures. m1/m2 are closed by an exact command pin and
         a base-sourced Jest config (M-b: head filters change nothing). m3 is closed, n1–n4/n6 are closed, and the PR #11 overlay passes with 4 extras (ruled §R2.4).
         One pre-existing MINOR: no check proves that no-explicit-any is on, so turning it off and also turning off unused-directive reports passes.
FINDINGS: 0 BLOCKER · 0 MAJOR · 1 MINOR · 3 NIT (table R2.3)
SECURITY-FLAGS: R2.6
```

### R2.1 Verification I performed myself

The setup follows the dispatch constraints:
- I ran nothing in the worktree and ran no install, build, Docker or full suite.
- I made a `git archive 8dd1d24` scratch copy and junctioned its `node_modules` to the main checkout's (the lockfile is identical to main).
- To run the **real ci.yml step script** end to end, I turned the copy into a throwaway git repo and committed the `8dd1d24` tree as the "base" commit. That commit is what main looks like after the merge. Head mutations went into the working tree. `extract-step.mjs` parses `.github/workflows/ci.yml` with `yaml` and writes the step's `run:` to a file. I ran it with `bash`, `RANGE_BASE=<base commit>` and `LINT_FIXTURE_MODE=no-weakening`.

After every run, `git status` in the copy was clean, so the step's restore worked. Afterwards I removed the junction first and then the copy. No link is left at `C:\` (only the system `Documents and Settings`), the main `node_modules` still holds 740 entries, and the main checkout and the PR worktree are clean.

Three failures appear in **every** copy run, including the unmutated baseline. They are copy artefacts, known from round 1: `@platform/*` links resolve into the main checkout, which affects the resolver path test and the two `@platform/config` / `@platform/pricing` probes. Below, "real failures" excludes these three.

| Check | Result |
|---|---|
| `jest --selectProjects unit` on `fixture-expectations`, `check-workflow-policy`, `ci-policy`, `jest-transform` (copy) | 4 suites, **141 / 141 pass** |
| **Baseline**: step script, no mutation | 101 tests: **91 pass / 7 skipped** / 3 artefacts; 0 extras. The skip set shrank from 26 (r1) to 7, because clean fixtures, the lint-script check and the weakening halves now run in the base run. |
| **M-a / E9**: `eslint.config.mjs:362` `@typescript-eslint/no-explicit-any: 'off'` | **exit 1, 6 real failures**: 4 × `[AT-US-001-05] … (bad-*)`, `allowed: … suppression with a justification` (`ok-justified.ts`) and the "every other fixture" sweep. All are `a finding without a rule id is reported … Unused eslint-disable directive (…no-explicit-any)`. **M1 closed.** |
| **M-b**: head `jest.config.ts` gets `testNamePattern: 'nomatch'`, `passWithNoTests: true` and a `testPathIgnorePatterns` `'negative'` entry, plus M-a | **exit 1, the same 6 real failures, 101 tests run.** The head Jest config no longer reaches the base run. **m2 closed.** In round 1 this gave 97 skipped, exit 0. |
| **M-a2** (new): M-a plus `linterOptions.reportUnusedDisableDirectives: 'off'` (`:327`) | 91 pass, 0 real failures, 0 extras. The step would pass (R2-m1). Before this PR the step also passed this mutation, and so does the head exact suite. This is pre-existing, not a regression. |
| **PR #11 overlay**: `37a2109`'s `eslint.config.mjs` and `tools/eslint-rules/` (main has no drift on those paths since `63accea`) as the head, with the new suite, fixtures, harness and config as the base | **0 missing, 0 ruleless, 0 real failures.** 4 extras, all `platform/prisma-client-construction` `[rule new to the base]`: 2 on `bad-orders.service.ts` and 2 on `ok-orders.repository.ts`. The job summary renders in one ```` ```text ```` block. Ruling in R2.4. |
| `probe-gate2.mjs`: the PR's `checkWorkflow(…, { requiredGates: true })` on 28 in-memory ci.yml mutations | **Flagged** (`required-gates` + `lint-fixture-mode`): `--test-name-pattern`, `-tnomatch`, `--listTests`, `-o --lastCommit`, `--pass-with-no-tests`, `--shard=2/2`, `--config jest.config.ts`, `exit 0`, an extra line after `exit "$status"`, the base checkout replaced by `true`, a head checkout of `fixture-expectations.mjs` before Jest, a split-name export, a comment *after* a continuation, an indentation change, folded `run: >`. `shell:` and an extra step env `BASH_ENV` → `required-gates`; a duplicate `run:` key → `yaml-subset`; `continue-on-error` → `continue-on-error`. **0 findings, all harmless:** inserted comment or blank lines, `run: \|+`, CRLF, step `timeout-minutes: 0` (a timeout fails the step). **0 findings, not inert:** a trailing space or tab after a continuation backslash (R2-n1; fails closed, see below). Job-level `BASH_ENV` and job-level `RANGE_BASE` (D-TASK007-04 residual; R2.6). |
| Bash ground truth for R2-n1 | `printf … first \␠` followed by `  --config x \|\| status=$?` prints `[first][ ]`, then `--config: command not found`, `status=127`, exit 127. A trailing-whitespace edit to the pinned Jest or restore line therefore makes the step fail. It cannot pass. |
| `@swc/jest` 0.2.39 `buildSwcTransformOpts` | Inline options with at least one key skip `getOptionsFromSwrc()`, the `<cwd>/.swcrc` read. `swcrc: false` stops `@swc/core`'s nearest-file lookup, and `jest-transform.test.ts` proves it with a positive control. PR17-SEC-01's claim holds. |
| `prettier --check` on the 12 changed non-CODEOWNERS files; `node tools/ci/check-workflow-policy.mjs --root .` (copy, repository mode, including the new `swcrc` walk) | clean; exit 0 |
| CI run 43316597810 (head `8dd1d24`) | fast-lane **success**: unit **1680 passed**. The base-ref step passed **97 / 97**: main's old suite under the head copy of the config, the bootstrap case. scans fails only on "Security-owned paths need a review record", and ci-gate fails as a consequence. |
| Not re-run by me | full `lint`, `typecheck`, `test:unit`, `build`, actionlint, commitlint. I relied on run 43316597810. |

### R2.2 Closure of round-1 findings

| ID | Status | Evidence |
|---|---|---|
| M1 (MAJOR) ruleless extras pass | **Closed** | `noWeakening` (`fixture-expectations.mjs:62-89`) fails every unmatched `ruleId === null` finding. `expectClean` and the "every other fixture" sweep run in both modes, so ok-* / `allowed:` fixtures get the relaxed check I asked for. The unit case that allowed a ruleless directive is flipped. Directive, parse-error, ignored-file and clean-fixture cases were added. E9 was reproduced through the real step script (R2.1). The optional `no-explicit-any` in `EFFECTIVE_RULES` was not done; see R2-m1. |
| m1 (MINOR) deny-list misses spellings | **Closed** | Allow-list `BASE_LINT_FIXTURES_SCRIPT` with exact line comparison (`check-workflow-policy.mjs:133-185`). It adds `shell:` / `working-directory:` / exact step `env` / `defaults.run` checks and 15 flag mutations in the test. My 28 probes give the expected results, except R2-n1, which fails closed. |
| m2 (MINOR) head `jest.config.ts` steers the base run | **Closed** | The step uses `--config tools/lint/jest.base-fixtures.config.json --runTestsByPath "$suite"`, and the config is taken from the base. It is data-only JSON, `cache: false`, with an inline transform and `swcrc: false`. `ci-policy.test.ts` pins its key set. Mutation M-b proves it. The residual is reworded in D-TASK007-04 (job-level env, earlier head code, owned configuration). |
| m3 (MINOR) positive halves / severity API | **Closed (a) + API**; (b) belongs to PR #11 | Ignore maps are split into "source paths still linted" (always) and the exact map (`exactOnly`). The hasher's `not.toContain('bcrypt')` and the two `'off'` checks are `exactOnly`, and their weakening halves stay. `noWeakening(…, { minSeverity })` exists, and `expectFindings(…, severity)` routes it. The `npm run lint` check became an ordered subset (`missingSteps`) instead of being skipped (PR17-SEC-04), which is better than r1 asked. |
| n1 fence / cap | **Closed** | `summaryMarkdown` uses a fence of longest backtick run + 1 and caps at 200 lines; `logText` neutralises a leading `::` (workflow-command injection in the log). Both have unit tests. |
| n2 null label | **Closed** | `[no rule id]` |
| n3 literal-mention wording | **Closed** | JSDoc and ci.yml comment say "tripwire". `mentionsOf` also strips quotes and line continuations, and the split-name probe is now flagged. |
| n4 bootstrap sentence | **Closed** | PR body "Bootstrap notes" |
| n5 lock-only classifier | Routed | TASK-015 (unchanged; fix comment) |
| n6 summary without a report | **Closed** | `afterAll` returns when `report` is undefined |

**Scope additions** (security round 1: PR17-SEC-01/03/04/05):
- `.swcrc` is deleted, the options are inlined in `jest.config.ts`, a new `swcrc` repository rule rejects any `.swcrc`, and CODEOWNERS adds `/.swcrc` and `**/.swcrc` (tested in `REQUIRED_CODEOWNED_PATHS`).
- The policy tree walks skip nested checkouts.

These are coherent and tested, and I accept them. Under `.claude/worktrees/` the skip is necessary: this repo's own worktrees would otherwise be walked.

### R2.3 Findings (round 2)

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR (pre-existing, not a regression) | `tools/lint/lint-fixtures.mjs:151-158` (`EFFECTIVE_RULES`); `tests/fixtures/lint/rules/any-justification/` | **Nothing positively proves that `@typescript-eslint/no-explicit-any` is on.** The AT-US-001-05 fixtures only *suppress* it: they expect `platform/any-justification`, and `ok-justified.ts` is clean. So the only signal that the rule is on is the unused-directive report, which depends on `linterOptions.reportUnusedDisableDirectives: 'error'` from the head config. M-a2 turns both off, and the base step passes. So does the head's own exact suite. The step behaved the same way before this PR. | Add a weakening-half check that does not depend on directives. Either (a) add a `bad-raw-any.ts` fixture under `rules/any-justification/packages/pricing/src/` that expects `@typescript-eslint/no-explicit-any`, or (b) add `@typescript-eslint/no-explicit-any` to `EFFECTIVE_RULES` and assert it is `'error'` in `report.effective` (not `exactOnly`). Also assert in the harness that the effective `linterOptions.reportUnusedDisableDirectives` is `2` (ESLint's `calculateConfigForFile(...).linterOptions`), so that M1's signal cannot be switched off quietly. In-PR is preferred, because it touches the same files. Otherwise route it to TASK-015 / the TASK-007 follow-up. **Not a merge blocker.** |
| R2-n1 | NIT | `tools/ci/check-workflow-policy.mjs` `commandLines` (`line = raw.trimEnd()`) | `trimEnd` makes the pin accept `jest.js \␠` and `\<TAB>`, but bash treats backslash + space as an escaped space, not a line continuation. The probe gives 0 findings. Ground truth: the following line then runs as the command `--config`, and the step exits 127, so it fails closed. The pin says "exactly these commands", and this is the one place where its normalisation and bash disagree. | Strip only `\r` and reject trailing whitespace on non-blank lines, or at least do not `trimEnd` a line whose trimmed form ends in `\`. Add the case to the "any other spelling" test. |
| R2-n2 | NIT | `docs/04-plan/tasks/WAVE-00.md:56`, `docs/04-plan/generator/plan-data.mjs:8`, `docs/03-architecture/adr/ADR-0023-ci-cd-and-release.md:52` | These still list `.swcrc` as a TASK-001 deliverable or a full-trigger path. After PR17-SEC-01 any `.swcrc` is a policy finding. | Update the WAVE-00 / plan-data deliverable text (or annotate "removed by PR17-SEC-01"). The ADR-0023 trigger path is harmless; drop it when ADR-0023 is next amended. |
| R2-n3 | NIT | `check-workflow-policy.mjs:785` comment; ci.yml step comment | The step-env comment names `RANGE_BASE`, `BASH_ENV` and `PATH` as redirect levers that the exact-env check closes. The same variables at **job** level (`fast-lane.env`) give 0 findings (probe). D-TASK007-04 lists job-level env as residual, so this is not a defect, but the comment reads as if those levers are closed. | Add "(step level; job-level env is the D-TASK007-04 residual)". |

### R2.4 Ruling: PR #11 overlay gives 4 extras, not 2

**Accepted.** Round 1's "exactly 2 extras" assumed the base run skipped clean fixtures. M1's required fix said to apply the relaxed check to ok-* / `allowed:` fixtures instead of skipping them, so the clean `ok-orders.repository.ts` is now linted in the base run. The 2 extra findings there are genuine strengthening:
- The base (main) fixture constructs `new PrismaClient(...)` in a repository. PR #11's new `platform/prisma-client-construction` rule bans that outside `apps/*/src/platform/db`.
- `37a2109` changes that fixture to `Prisma.empty` (`git diff 37a2109 8dd1d24 -- tests/fixtures/lint/layering/service-imports-prisma`), so its own exact suite stays clean.

All 4 extras carry a rule id and are tagged `[rule new to the base]`, and the file-keyed `extras` map avoids double-listing from the sweep and the `allowed:` case. Merge condition 4 from round 1 now reads: the PR #11 overlay must give **0 failures and exactly 4 `platform/prisma-client-construction` extras** (2 × `bad-orders.service.ts`, 2 × `ok-orders.repository.ts`).

### R2.5 Merge conditions

1. A security-analyst record naming `8dd1d24` (or a later head) for the CODEOWNED `/.github/`, `/tools/ci/`, `/tools/lint/`, `/jest.config.ts` and `/.swcrc` changes. Lane A must be green on the final head (scans is red only on the record).
2. R2-m1 is in-PR or routed to TASK-015 with an owner. R2-n1 to R2-n3 are optional.
3. **Order (D-ORCH-020):** #17 first.
   - The PR #11 superseding branch must resolve its `negative-fixtures.test.ts` conflict under the mode split (round 1, condition 3):
     - `WARNINGS` go through `expectFindings(…, 'warning')`.
     - `allowed (TASK-016)` cases go through `expectClean`, not `exactOnly`.
   - Re-run the overlay (R2.4).
   - **PR #4's merge-main** must change its `unit-dom` project's transform from `'@swc/jest'` (string, `d2e867b` `jest.config.ts:28`) to `['@swc/jest', SWC_JEST_OPTIONS]`. Otherwise `tools/ci/jest-transform.test.ts` fails (every project must use the inline options), and the deleted root `.swcrc` would leave the jsdom project on @swc/jest defaults. It must not re-add a `.swcrc`, which the `swcrc` rule rejects.
4. **Future edits of the step are a two-step change:** first update `BASE_LINT_FIXTURES_SCRIPT` on main, then the step. This is documented in the JSDoc and D-TASK007-04. Any PR touching that step before then will fail `required-gates` by design.

### R2.6 Security flags (for security-analyst)

- **R2-m1:** the AT-US-001-05 control has no direct signal that the rule is on. Turning off `no-explicit-any` together with `reportUnusedDisableDirectives` passes both the head suite and the base step. This is pre-existing. Weigh it under PR2-SEC-08.
- **Job-level `RANGE_BASE` (pre-existing, PR #10 architecture, broader than this PR):** `fast-lane.env.RANGE_BASE` and `scans.env.RANGE_BASE` come from the head's ci.yml and are not pinned (probe: 0 findings). Setting them to the head SHA makes every "from the base ref" step take its inputs from the head:
  - gate tooling, including `check-workflow-policy.mjs` itself;
  - this step's suite;
  - the security-owned-paths record gate's diff range, which becomes empty.
  
  A pin in the base checker cannot close this, because the checker would then be fetched from the head. Only a default-branch-controlled mechanism can, for example a repository ruleset that requires a workflow from `main`, or a `pull_request_target` checker that reads `base.sha` from the event. D-TASK007-04 names "job-level env" as residual. Please confirm that the PR10-SEC-02 rating covers this collapse of the record gate, or raise it under TASK-015.
- **R2-n1:** the pin's normalisation differs from bash on `\␠`. It fails closed (exit 127). INFO.
