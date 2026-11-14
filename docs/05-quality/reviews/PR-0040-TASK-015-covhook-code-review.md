# Code review: PR #40, TASK-015 merged-coverage hook (round 1)

- **PR:** https://github.com/sukhchdit/shipcube/pull/40, branch `feat/TASK-015-merged-coverage-hook`
- **Head reviewed:** `2b651f7c57c181b351c1edd7a80affdea4f36d1d` (5262707 code + evidence commit)
- **Scope:** D-ORCH-047 split from 015-B; closes PR #33 R1-m4 and PR33-SEC-06; D-TASK015-20..27
- **Reviewer:** code-reviewer, 2026-11-14

```
VERDICT: CHANGES_REQUESTED
SUMMARY: Solid, well-tested hook: fail-closed project checks, tripwire, conditional `generated`, manifest names and the
  pr diff gate all work, and no threshold was weakened. One MAJOR: the branch merge can over-report the branch
  PERCENTAGE (shown with real Jest output: 75.00 % merged vs 71.42 % for one combined run), contrary to D-TASK015-22.
FINDINGS: 1 MAJOR, 4 MINOR, 6 NIT (section 3)
GOOD: real-Jest validation against a combined run, injectable seams in mergedCoverageStep, outputs deleted before the
  run, listing failure counted as required, a repo pin tying merged_coverage to the jest.config.ts projects
SECURITY-FLAGS: required_cases match by substring of any passing title (R1-m4 b); head jest.config.ts imported
  in-process by heavy (accepted: heavy already runs head code)
```

## 1. What I verified myself

| Check | Result |
|---|---|
| `git log origin/main..2b651f7` | 4 commits: a7541cf feature, 8437586 cap fix, 5262707 merge of main, 2b651f7 evidence only |
| Changed test files (coverage-merge, coverage-run, heavy, manifest, jest-esm), run on the worktree head | 146 tests. 145 passed in the 5-file parallel run; one heavy.test e2e `coverageRun` hit runNode's 180 s timeout on the loaded host (see R1-n5). `heavy.test.ts` alone: 31/31 green. |
| Lane A on the exact head (run 43536312585) | fast-lane: all steps executed and green. scans: only "Security-owned paths need a review record" failed (expected). ci-gate: red as a consequence. Lint, format and typecheck were not re-run locally; I relied on these executed lane-A steps. |
| Thresholds (focus 3) | `tools/ci/coverage-gate.mjs`, `diff-coverage.mjs` and `jest.config.ts` are not in the diff. `COVERAGE_THRESHOLDS` is unchanged: 85/75 overall; 95/95 for pricing, audit and authz, the D-QA-003 money paths, `apps/api/src/modules/ledger` and `packages/ledger`. The tripwire reads `{lines:85, branches:75}`, which the repository pin asserts. Partial runs pass `--coverageThreshold={}`; the evidence integration+api coverage-only run passed, which confirms that Jest's own threshold is off for partial runs. Nothing is weaker. |
| `summarizeCoverage` vs Jest's own `json-summary` | Real Jest 30.5.2 run in the scratchpad: 5 entries × 4 metrics × total/covered/pct = 0 differences |
| Line coverage exact (focus 1) | 45 real-Jest A/B/combined differential trials: merged lines equal combined lines in every trial |
| Branch lower bound (focus 1) | **Fails.** See R1-M1 |
| Block cap and the anonymous-function case (focus 1) | Sound for the case it targets. An uncalled anonymous function in run R is non-block with an empty name, so v8-to-istanbul records only zeroed lines; the interior-line cap returns 0. Mutants M1 (no cap) and M17 (end line counted as interior) are killed by the `dedicated-connection.ts` test. |
| Fail-closed behaviour (focus 2) | Missing, unreadable, malformed, empty and placeholder-only sources each fail by name (M3/M4/M13 killed; heavy H1 killed). Gap: grouped projects (R1-m1). |
| `generated` conditional (focus 4) | Required while `--listTests` lists a file, and when listing throws (M5 killed). A renamed project makes Jest exit non-zero, so the project stays required (fail closed). |
| Manifest names (focus 5) | `^coverage gate: [a-z0-9][a-z0-9/._-]* (?:lines|branches)$` accepts exactly the 4 required names. Evidence runs already on main (030fae9, 5a145a8, 7d8496b, 5b08fe8) each carry all 4 with classname `unit`, so in-flight PRs are unaffected. |
| Mutation spot-check (focus 7) | 25 independent mutants: 17 killed, 8 survived. 4 of the survivors are near-equivalent; the real gaps are R1-m2 and R1-n1/n6. The developer's "18 killed" is plausible for their set but is not a full picture. |
| PR #38 union (sequencing) | `git merge-tree 2b651f7 origin/pr38` is clean (tree fca5a26). The only overlap is `package.json`, where the two PRs edit different script lines (section 6). |

## 2. Focus-by-focus summary

1. **Istanbul merge (D-TASK015-22).** Lines are exact. The branch merge can over-report the percentage (R1-M1), although the uncovered-branch count is never lower than in a combined run.
2. **Fail-closed.** Holds for every source-level failure. Per-project emptiness inside a grouped Jest run is not detected (R1-m1). A failing coverage-only run is untested (R1-m2).
3. **85/75 on the merged total, Jest thresholds off for partial runs.** Confirmed; no threshold is weaker anywhere, critical scopes included.
4. **`generated` conditional and listing failure.** Confirmed.
5. **Manifest names.** Confirmed. The regex strictness itself is only partly pinned by tests (R1-n6).
6. **Diff gate in heavy `--profile pr`.** A sensible default: `base...HEAD`, fail-closed on a git error, merged lcov, unchanged thresholds. TEST-STRATEGY §8 still assigns it to lane A (R1-m3). The branch undercount can cause false failures on small changed-line denominators; that is fail-safe but should be documented.
7. **Test quality.** Good overall. Gaps are in R1-m2 and R1-n1/n6.

## 3. Findings

| ID | Sev | Location | Issue | Required fix |
|---|---|---|---|---|
| R1-M1 | MAJOR | `tools/ci/coverage-merge.mjs:16-19` (header claim), `:174` `impliedCount`, `:206` `mergeFileCoverage`; D-TASK015-22 | **The branch merge can over-report the branch percentage; the D-TASK015-22 lower-bound claim is false.** See "Proof" and "Required fix" below this table. | Faithful merge (preferred) or decision plus restatement (fallback), both with a real-Jest regression fixture. Details below. |
| R1-m1 | MINOR | `coverage-merge.mjs:442` `projectProblems`; `coverage-merge.test.ts:317` | **Per-project measurement is per source, not per project.** The case `coverage merge: project unit-dom measured` passes when unit-dom ran zero test files, as long as `unit` in the same Jest run measured anything; the unit test asserts exactly this (`'unit-dom': null` with a shared source). The same holds for `api` in the coverage-only `[integration, api]` group, and for every coverage-run group. `test:api` still carries `--passWithNoTests`, so "api lost all its tests" is a realistic shape. The gate numbers stay honest, but the case name overclaims and focus 2 ("ran no files must fail") is unmet for grouped projects. | For each project in a grouped run, require at least one of its test files to have run. Two ways: (a) intersect `jest --listTests --selectProjects <p>` with the `testResults[].name` of the Jest JSON report (heavy already has the report; coverage-run can add `--json --outputFile`); or (b) at minimum require a non-empty listing for every always-required project. Add a test with a group where one project lists 0 files. |
| R1-m2 | MINOR | `tools/quality/heavy.mjs:775-782` | **The failure path of a coverage-only run is untested.** Mutants H3 (`bad > 0` → `false`) and H7 (`result.status !== 0` → `false`) each survive `heavy.test.ts` (31/31). With both removed, failing integration/api tests in a coverage-only run are invisible, and that run is the only execution of those suites on tools-only PRs. The fake Jest never fails. | Add a fake-Jest scenario where the coverage-only project writes a failing report and exits 1, and assert that `coverage merge: <p> coverage run` fails with its message. Add a timed-out variant if cheap. |
| R1-m3 | MINOR | `docs/05-quality/TEST-STRATEGY.md:390` vs D-TASK015-27 | **Strategy drift.** §8 row 1 places the changed-files gate in "Lane A diff gate / `ci-gate`". This PR implements it in lane B `--profile pr` and states that lane A is unchanged. Lane A runs no coverage, so the strategy row describes a gate that no task owns. Also, the branch undercount (−0.23 pp overall; `fallback.ts` 49/54 vs 51/56) can fail small changed-line denominators that a combined run would pass. | qa-lead amends §8 row 1 (lane B `pr` evidence, `coverage diff:` cases in the unit JUnit) or records the deviation as a D-QA decision. Add one sentence on the false-fail direction and the remedy (one combined Jest run), as the PR body already does for critical scopes. |
| R1-m4 | MINOR | `tools/quality/required-suites.json` (unit); `tools/quality/check-evidence.mjs:334` | (a) `required_cases` cover only overall and authz. When TASK-025 activates `packages/audit` (and later pricing, the money paths and the ledger), their `coverage gate: <scope> lines/branches` names must be added, or the base-ref verifier will not require them. (b) Matching is `nameHasId`, a substring match on any passing case, so a Jest test titled `… coverage gate: overall lines …` satisfies the requirement even if the merged step never ran. The PR body names the exact-title case; the substring case is wider. | (a) A sheet line for qa-lead: add each critical scope's two names in its activation PR (TASK-025 for audit). (b) For `coverage gate:` IDs, also require `classname === <suite id>`: the gate cases carry `unit`, Jest cases carry file paths. **Security flag.** |
| R1-n1 | NIT | `coverage-merge.mjs` `loadJestGlobalThreshold` | Mutant M12 survives: the empty-`global` guard is untested. A `global: {}` would yield zero tripwire cases, i.e. silent. The repository pin covers the real config. | One test with `{ coverageThreshold: { global: {} } }`. |
| R1-n2 | NIT | `coverage-merge.mjs` function merge | M16 survives: function implied counts → 0 changes nothing tested. Functions are not gated, and M15/M18 are near-equivalent under the v8 provider. | Optional: one assertion on `f` for a run where the function is absent. |
| R1-n3 | NIT | `heavy.mjs:674` `coverageFrom` | No production caller remains (exported only for heavy.test). | Remove it with its test, or note that it is kept for the test only. |
| R1-n4 | NIT | `coverage-merge.mjs:39,116` | The size bound is checked after `readFileSync`, so `ERR_STRING_TOO_LONG` (~512 MiB) fires first. Both outcomes fail closed. | Check `statSync(file).size` before reading. |
| R1-n5 | NIT | `tools/quality/heavy.test.ts` e2e coverage cases | Each spawns a full heavy CLI. In a 5-file parallel run, one exceeded runNode's 180 s on this host (386 s wall); green in isolation and in lane A. | Consider a larger timeout or a lighter fixture (e.g. a shared fixture repo per describe). |
| R1-n6 | NIT | `tools/quality/lib/manifest.test.ts` | Mutants M8 (metric `(?:lines|branches)` → `\w+`) and M14 (drop `^`) survive. "Exactly the names" (D-TASK015-26) is half pinned. | Negative cases `coverage gate: overall statements` and `x coverage gate: overall lines`. |

### R1-M1 detail

**Mechanism.** Within one Jest run, V8 and `@bcoe/v8-coverage` normalisation merge *adjacent sibling ranges with equal counts* into one range. Example: the `then` block plus the continuation after an early return, both 0. Another run, with different counts, keeps the same span split differently. `mergeFileCoverage` keeps the coalesced range as its own key and gives it the other run's implied count: the interior line count is 1 and the enclosing function count is 1, so the cap does not help. The merged map therefore holds a *covered* branch that a single combined run does not have. Total and covered both grow by 1, so the percentage rises, while the uncovered count stays equal.

The PR's own validation ("0 entries report fewer uncovered items") checks exactly that invariant. It therefore cannot see this. The gate judges percentages, not uncovered counts.

**Proof.** Real Jest 30.5.2 (`coverageProvider: v8`, v8-to-istanbul 9.3.0), run A, run B and A+B, merged with this PR's `mergeCoverageMaps` and `summarizeCoverage`. The source file is:

```js
function g(z, a) { if (z) { return -1; } if (a) { return 0; } return 2; }   // one statement per line in the probe
function h(x) { if (x) { return 1; } return 0; }
function m() { return 3; }
```

Run A calls `g(1,0); h(0); m()`. Run B calls `g(0,1); h(0)`. File branches:

- **merged:** 6/8 = **75.00 %**
- **combined run:** 5/7 = **71.42 %**

So the 75 % branch threshold (the overall gate, the jest tripwire, and the diff gate on a new file) passes on the merge and fails on one combined run. With `g` alone, the merge gives 4/5 = 80 % against 3/4 = 75 % combined.

A random differential over try/catch, loop `break`/`continue`, early returns, a switch with fall-through and nested ternaries over-reported a file in 3 of 25 trials, e.g. 77.41 % vs 75.86 %. In every flagged case the uncovered count was equal. On `m.js` (switch/ifs/arrow/loop/logical) 12 of 12 trials were fine.

The probe sources are kept in the reviewer scratchpad (`review/PR-40-cr/`: `drive.mjs`, `show.mjs`, `m5.js`, `jest.config.cjs`). Each trial takes about 3 s and needs no Docker.

**Required fix (preferred).** Merge at range-tree level instead of key level:

- Per function root, sum the per-run count step functions over (line, column) positions and re-derive the normalised ranges. This is the semantics of `@bcoe/v8-coverage` `mergeFunctionCovs`, which can be ported in-house under D-TASK015-20.
- Keep the interior-line cap as the rule that synthesises a 0-range in a run whose uncalled anonymous function v8-to-istanbul dropped.

**Fallback.** An orchestrator/qa-lead decision that relaxes the requirement to "uncovered branches never fewer than a combined run; the percentage may exceed it by coalesced ranges". In that case:

- restate D-TASK015-22 and the module header (`:16-19`);
- re-run the PR's 162-entry validation comparing **pct** per entry (the combined-run artefacts exist) and record the count.

**Either way.** Add a regression test from real Jest output: committed A/B/combined `coverage-final.json` triples for the `g` and `m5` shapes, plus the generator script. Assert `pct(merged) <= pct(combined)` per file and metric (preferred fix) or the documented invariant (fallback).

## 4. Deviation and decision rulings

| Decision | Ruling |
|---|---|
| D-TASK015-20 in-house merge, no dependency | Accepted. A port of the `@bcoe/v8-coverage` algorithm (MIT) for R1-M1 stays within it. |
| D-TASK015-21 separate runs per group | Accepted. The numbers are plausible (1231 s vs 192 + 336 s). |
| D-TASK015-22 merge semantics | **Not accepted as stated** (R1-M1). Lines exact: accepted. |
| D-TASK015-23 gate judged once on the merge | Accepted. Same case names in the same suite; the per-suite gate is replaced, not dropped. |
| D-TASK015-24 Jest threshold off per partial run, tripwire on the merge | Accepted. Verified nothing is weaker (section 1). |
| D-TASK015-25 `generated` via `--listTests` | Accepted (M5 killed; listing failure counts as required). |
| D-TASK015-26 exact gate names in `required_cases` | Accepted. NIT R1-n6; hardening R1-m4 (b). |
| D-TASK015-27 diff gate in heavy `pr` | Accepted as the default, subject to R1-m3 (strategy text). |

## 5. Follow-up closure

| Item | Status |
|---|---|
| PR #33 R1-m4 (heavy judged unit-only coverage) | Closed in mechanism. The merged gate is in every profile; correctness depends on R1-M1. |
| PR33-SEC-06 (gate names required by the verifier) | Closed in code. Security-analyst to confirm, with R1-m4 (b). |
| D-ORCH-047 (hook before TASK-025 merges) | Met once R1-M1 is fixed. TASK-025 needs the R1-m4 (a) line for `packages/audit`. |

## 6. Sequencing with PR #38 (merges first, D-ORCH-056): what the union must preserve

- `package.json` is the only shared file. #38 adds `db:generate`; #40 changes `test:coverage`. `git merge-tree 2b651f7 origin/pr38` is clean (tree fca5a26). Keep `"test:coverage": "node tools/ci/coverage-run.mjs"`.
- `tools/repo/jest-esm.test.ts` lists the Jest scripts. `db:generate` is not a Jest script, so the list is unchanged. Verify it on the union run.
- #38's new sources (`apps/api/src/platform/db/generated.ts`, credentials and Prisma client package files) enter the merged gate.
- **Fresh lane-B evidence after the union.** It is a non-docs main delta. Use `--profile pr --base origin/main`; the diff gate should then list only #40's files, which are not source, so expect "no changed source file in scope".
- Keep `merged_coverage` and the `coverage: true` flags in `suite-runners.json`, and the 4 `required_cases`.
- A security record must name the final head.

## 7. Merge conditions

1. R1-M1 fixed (or the fallback decision recorded) with the real-Jest regression fixture.
2. R1-m1 and R1-m2 in-PR (cheap). R1-m3 and R1-m4 (a) may be routed to qa-lead with owners; R1-m4 (b) is in-PR or routed to 015-C via the security analyst.
3. PR #38 merged, union per section 6, fresh `quality:heavy --profile pr` evidence on the union.
4. PR-0040 security record naming the final head. Lane A green with all steps executed. Squash merge.

Round 2: a delta check of the merge rewrite against the probe triples (I will re-run the scratchpad differential, 25+ trials), plus the m1/m2 tests and the union commit.
