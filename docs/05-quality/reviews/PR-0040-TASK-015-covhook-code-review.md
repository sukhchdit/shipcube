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


---

# Round 2 (head e8f4461)

- **Head reviewed:** `e8f4461f343e9b2949d6dc798d88f36161e006a4`. The final code commit is `08637c8`; `bc97720` is a docs-only merge of main and `e8f4461` is evidence only. `git diff --name-only 08637c8 e8f4461` contains only `docs/` and `.claude/agent-memory/` files.
- **Fix commits since round 1:** `da2f0a5` (R1-M1 range-tree merge, R1-m1, R1-m2, PR40-SEC-04, R1-n1/n3/n4), `87c7178` (PR40-SEC-01), `6b07dd6` (PR40-SEC-02, R1-n6). Merges: `0b7ce90` (PR #38 union), `08637c8`, `bc97720`.
- **Reviewer:** code-reviewer, 2026-11-14

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R1-M1 is fixed as asked: a faithful port of @bcoe mergeFunctionCovs (0 differences from the library on 5,000
  merges), and the requested differential on two new seeds has 0 of 59 trials above the combined run, with lines equal.
  Targeted TypeScript shapes still beat the combined run in 3 of 42 trials (+1 or +2 covered branches per file). That
  residual comes from per-run input, so it is MINOR R2-m1: amend the decision text and pin the cases. Union is pure.
FINDINGS: 0 BLOCKER, 0 MAJOR, 2 MINOR (R2-m1, R2-m2), 2 NIT (section R2-3)
GOOD: honest non-associativity caveat; uncrossing applied once per function to the union of all runs' spans; seeded,
  self-verifying fixture with a regeneration aid; fake-Jest failure, exit and timeout scenarios; exact-name verifier
SECURITY-FLAGS: none new. PR40-SEC-01/02/04 code paths re-run green here (diff-coverage, check-evidence,
  check-workflow-policy, path-case tests); the security-analyst delta must still name e8f4461 or later.
```

## R2-1. What I verified myself

| Check | Result |
|---|---|
| Requested differential, seed 4711, 30 random trials (+2 fixed) | `coverage-merge-probe.mjs --seed 4711 --trials 30`, then `--report`, exit 0 (2 min 3 s). **0 above**, 24 equal, 8 below. Lines are equal in 32/32. All 8 "below" trials are TypeScript. |
| Requested differential, seed 90210, 25 random trials (+2 fixed) | Exit 0. **0 above**, 20 equal, 7 below. Lines equal in 27/27. |
| Committed fixture (seed 40), replayed | 0 above. The uncovered count is never lower than in the combined run. At most 2 covered branches fewer. |
| Review probes `g`/`h`/`m` | Merged 5/7 = combined 5/7. `g` alone: 3/4 = 3/4. R1-M1's two concrete cases are closed. |
| **Targeted real-Jest shapes** (my scratch generator, through the PR's own `runTrial`/`compareTrial`; TypeScript via `@swc/jest` with the repository's SWC options). Shapes: async/await with try/finally, `??`, `?.`, `\|\|=`, for-of with one-line `continue`/`break`, class members (getter, `#private`, static, generator), destructured defaults, one-line `if (…) { return …; }` chains, nested closures and IIFEs | Seed 13 (18 trials): 2 above, 9 equal, 7 below. Seed 29 (24 trials): 1 above, 10 equal, 13 below. **3 of 42 above** (R2-m1). Lines are equal in 42/42. **The uncovered count is never lower than in the combined run in any of the 133 trials** (fixture 32, seeds 4711/90210, targeted 42). |
| Port faithfulness (b) | `mergeFunctionRanges` (non-conservative) against the installed `@bcoe/v8-coverage` 0.2.3 `mergeFunctionCovs`. Input: 5,000 random function sets of 1 to 4 inputs, including crossing children. **0 differences.** The detector works: the same harness in conservative mode differs in 1,790 of 2,000. Read side by side against `dist/lib/_src`: `RangeTree.fromSortedRanges`, `normalize`, `split`, `toRanges`, `mergeRangeTrees`, `StartEventQueue`, `mergeRangeTreeChildren`, `insertChild` and `nextChild` match. The documented deviations are the parent clip and the never-pop-root loop guard in `fromSortedRanges`, the `conservative` flag, and the ranges-in/ranges-out API. MIT notice and attribution are present. |
| D-TASK015-28 (4) proof: conservative ≤ M\* | Holds. On 5,000 V8-monotone random merges (no count under a 0 parent), the covered node set is identical and the result is never above. Even on 5,000 non-monotone merges the result is never above, although the covered count then differs in 229. Case analysis of `normalize`: an uncovered chain stays split; the `spansThis && count > 0` exception keeps the original's merge-then-fold, which is the one place where the original turns a covered node uncovered; and a fold under a 0 parent folds a 0 delta. The argument is correct for the tree-merge stage. It says nothing about the reconstruction stage (positions, uncrossing), which is where the residual over-report arises (R2-m1). |
| Non-associativity caveat | Confirmed and, if anything, understated. Synthetic monotone sets: per-run then cross-run differs from n-ary in 2,981 of 3,000; plain two-stage is higher in 1,084 and conservative two-stage in 238. In a V8-faithful model (fixed block structure; per file, nested ranges equal to the parent dropped and adjacent equal siblings merged), **exact** per-file trees still give conservative two-stage > n-ary in 769 of 20,000 functions. Equality with, or even a bound against, one combined run cannot be obtained from per-run istanbul output. Only raw per-file V8 coverage (`NODE_V8_COVERAGE` + `mergeProcessCovs`) would make it exact. |
| (c) R1-m1 per project | `projectProblems` intersects `listTests(project)` with the run's `ranTests` (Jest `--json --outputFile` `testResults[].name`). The comparison resolves paths and folds case on win32 only. 0 listed, a listing failure and a null report each fail by name. `coverage-run` adds `--json --outputFile` per group; heavy passes the suite's report. Tests: `coverage-merge.test.ts:444` (grouped unit/unit-dom with unit-dom at 0 ran, the `--passWithNoTests` shape, listing failure, unreadable report, case folding), plus heavy and coverage-run e2e. Mutants C9 (no intersection) and C10 (null report passes) are killed. The evidence carries `coverage merge: project unit\|unit-dom\|integration\|api measured`. **Closed.** |
| (d) R1-m2 | Fake-Jest `failing`/`exitOnly`/`sleep` drive `mergedCoverageStep`. I re-ran the round-1 mutants: **H3 (`bad > 0` → false) killed, H7 (`status !== 0` → false) killed**, plus H8 (timeout ignored) and H9 (report path lost) killed. **Closed.** |
| (d) NITs | n1 closed (empty/absent `global` rejected, test `:496`). n2 accepted as by design. n3 closed (`coverageFrom` is gone, grep finds 0). n4 closed (`statSync` before read, test `:487`). n5 partly done, accepted. n6 closed (`overall statements`, leading and trailing text all rejected). |
| (e) Union purity | Re-merging with `git merge-tree --write-tree` gives a tree identical to all three merge commits (`0b7ce90`, `08637c8`, `bc97720`); `git diff --stat` is empty for each. Files changed on both sides: only `package.json` in `0b7ce90`; none in the other two. Against main, `package.json` differs only in `test:coverage` (main's `db:generate` is kept). `jest.config.ts`, `DECISIONS.md` and `STATUS.md` equal the merge base `37afe2c`. Since then main has moved to `4a35f69`, which is docs-only (DECISIONS/STATUS); `git merge-tree HEAD origin/main` is clean. **Pure.** |
| (f) Mutation, new merge | 26 mutants on `v8-range-tree.mjs` and `coverage-merge.mjs` against the two merge test files (positional paths, scratch copy of `08637c8`): **22 killed, 4 survived**. The survivors are T4 (`pendingOffset <` → `<=`), T7 (`split` `child.start >=` → `>`), T11 (right part of a split dropped) and C13 (the `crosses` guard in `zeroFillAbsent`). All four are unreachable from `mergeFileCoverage`: `uncrossSpans` makes the union of spans laminar, so trees from different runs never cross and nothing is ever split. They do matter for the exported port: each differs from the library in 1,799 to 2,246 of 3,000 crossing inputs (R2-n1). |
| Tests on head | 9 changed tool test files: 371/371. `tools/quality/heavy.test.ts`: 34/34. |
| Lane A run 43558481519 on `e8f4461` | fast-lane success, all steps executed. scans fails only on "Security-owned paths need a review record" (expected until the security delta names the head), so ci-gate is red as a consequence. |
| Evidence `20261114T0437Z_bc97720` | PASS, profile `pr`. Merged lines 98.24 % (15289/15562), branches 96.45 % (3893/4036). All 4 projects measured; `generated` not required; integration+api coverage run passed. The 4 required gate names carry classname `unit`; tripwire passes; `coverage diff: no changed source file in scope` (as round 1 §6 predicted). 0 `<failure>`. |

## R2-2. Ruling on R1-M1 and the restated D-TASK015-22

**R1-M1: closed.** The preferred fix from round 1 is implemented and faithful. Both review cases now equal the combined run, and the requested differential (2 new seeds, 59 trials) has none above.

The restated D-TASK015-22 is **acceptable in substance, but its measured half needs amending** (R2-m1):

- Its proven bound (never above `mergeFunctionCovs` over the reconstructed trees) is correct.
- Withdrawing the guarantee against a combined run is correct and necessary.
- The text and the module header (`coverage-merge.mjs:25-32`) still leave the impression that "never above one combined run" holds in practice, because it held on the fixture. It does not hold in general for TypeScript.

Why this is MINOR and not MAJOR as in round 1:

- In round 1 the over-report came from a key-level algorithm for which a better fix existed. That fix is now in.
- The residual comes from the input itself: per-run istanbul output after source mapping. It cannot be removed without raw V8 data (see the model result above).
- The magnitude is +1 or +2 covered branches in an affected file.
- The invariant my round-1 fallback asked for (uncovered never fewer than a combined run) held in all 133 trials.
- The net direction on every corpus is under-report.

## R2-3. Findings

| ID | Sev | Location | Issue | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR | `tools/ci/coverage-merge.mjs:25-32` (header), D-TASK015-22/28 text (PR body; DECISIONS entry on main `4a35f69`), `coverage-merge-probe.mjs` `randomModule`, fixture test `:314` | **Residual percentage over-report against one combined run on TypeScript.** See "R2-m1 detail" below the table. | (a) Amend D-TASK015-22/28 (orchestrator, DECISIONS) and the module header. The fixture's "never above" is a property of those trials only. Counterexamples exist on TypeScript (3 of 42 targeted, +1 or +2 covered branches per file). The invariant that held in every trial is "uncovered branches never fewer than one combined run". The direction is predominantly under-report. (b) In-PR, or with qa-lead under PR40-SEC-06: add the three cases (or equivalent shapes) to the fixture, and assert the uncovered-count invariant on every trial. The percentage assertion stays for the random trials, and the three are named as known exceptions. Extend `randomModule` with async/try-finally, `??`/`?.`, for-of with one-line `continue`/`break`, and one-line `if (…) return x;`. (c) qa-lead at G3 (PR40-SEC-06): run one whole-repository comparison, per file, of merged against one combined run. Record the count of files above, the maximum gap, and the critical-scope totals. |
| R2-m2 | MINOR | `coverage-merge.test.ts:322-326`; TEST-STRATEGY §8 (R1-m3) | **The under-report is larger than the fixture shows, and the "tight" assertions are fitted to seed 40.** Seed 4711 trial 27 (ts): merged 18/27 (66.66 %) against combined 23/31 (74.19 %), that is 5 covered branches and 7.5 pp below. Targeted `chains 2` (seed 13): 12/22 against 16/25 (−9.5 pp). The fixture test's "at most 2 covered fewer" and "≥ 20 equal" would fail on another seed or after a tooling bump (the PR40-SEC-06 regeneration path) without any regression. In-scope source is TypeScript, so the diff gate (new files, small denominators) and the 95/95 critical scopes can false-fail. The failure is fail-safe, but it will block merges. | Mark those two assertions in the test as seed-40 regression pins, with a comment, or derive them from the fixture's own recorded numbers. Fold the observed magnitude (up to −7.5 pp per TypeScript file, net under-report) and the remedy (one combined Jest run) into the R1-m3 strategy text, which is already routed to qa-lead. |
| R2-n1 | NIT | `tools/ci/v8-range-tree.test.ts` | The split and pending paths of the port (`StartEventQueue.next` equal offset, `split` boundary, `pushPendingTree`) are not pinned by any committed test. Mutants T4, T7 and T11 survive. The 5,000-merge library comparison is a scratch artefact, not part of the repository. These paths are dead from `mergeFileCoverage` (after `uncrossSpans`), but the module exports a general port. | Add one or two crossing-input cases with literal expected ranges taken from the library (for example runs `[0,10)+[5,15)` and `[0,8)` under a common root). Otherwise, document in the JSDoc that callers must pass laminar unions. |
| R2-n2 | NIT | `coverage-merge.mjs` `projectProblems` / `readRanTests` | "Ran" means any `testResults` entry. That includes a file that failed to execute and a file whose tests are all skipped (`describe.skip`). A failed file already fails the run, but a project whose tests are all skipped passes "measured". | Optional: require at least one of the project's files with `numPassingTests > 0` (or an `assertionResults` entry with status `passed`). |

### R2-m1 detail

Merged is above the combined run in 3 of 42 targeted real-Jest TypeScript trials:

| Trial | Merged | Combined |
|---|---|---|
| seed 13 `chains 1` | 18/26 = 69.23 % | 17/25 = 68.00 % |
| seed 13 `asyncy 1` | 16/23 = 69.56 % | 15/22 = 68.18 % |
| seed 29 `chains 2` | 13/21 = 61.90 % | 11/19 = 57.89 % (+4.0 pp) |

In each of them the uncovered count is equal, and lines are equal.

**Mechanism.** Source-mapped TypeScript positions cross; uncrossing and splitting then leave extra covered pieces. Example, `const pick = (y: number): number => { if (y > 2) return 1; return y > 1 ? 2 : 3; };`:

- combined: `9:15-10:23=2`
- merged: `9:15-10:19=2`, `9:15-9:22=2`, `9:22-10:19=1`

Similarly, `if (a === 0) { return 0; }` gives combined `2:15-6:1=3` against merged `2:15-2:27=2` + `2:27-6:1=3`.

**Coverage gap in the probe.** The probe's generator emits none of these shapes, so the committed fixture cannot see this.

**Reproduction** (calls per test file; A and B have 2-3 files each):

- `chains` module:
  - `f0`: `if (a === 0) { return 0; }` / `if (a === 1) { return 1; }` / `if (a === 2) { return 2; } else if (b === 0) { return 3; } else { if (c) { return 4; } }` / `return 5;`
  - `f1`: closures `pick` (above) and `other = (y) => (y ? pick(y) : 0)`, then `return a > 1 ? other(b) : c > 1 ? pick(c) : xs.reduce((p, q) => p + (q > 1 ? q : 0), 0);`
  - `f2`: one-line nested ternaries plus an IIFE.
  - `chains 2` calls. A: `f1(0,0,1,[]); f1(0,0,2,[2]); f0(0,2,3,[1,0])` and `f0(0,3,1,[])`. B: `f1(1,1,0,[0,1]); f1(1,3,2,[0,2,2]); f1(1,1,3,[2,3,3])`, then `f1(0,0,3,[1,2])`, then `f0(0,1,1,[]); f1(2,0,1,[]); f2(2,0,1,[])`.
- `asyncy` module:
  - `f0`: async, `try { if (a > 1) { return await Promise.resolve(b); } acc += (xs[0] ?? c) > 1 ? 1 : 2; } finally { if (b === 2) { acc += 1; } }`
  - `f1`: `o?.v?.w ?? -1`, `acc ||= b`, one-line `if (c === 0) return acc;`
  - `f2`: for-of with one-line `continue`/`break`.

## R2-4. Decision rulings (fix cycle 1)

| Decision | Ruling |
|---|---|
| D-TASK015-22 (restated) | Accepted with the R2-m1 (a) amendment. Lines exact: confirmed again (133/133 trials). |
| D-TASK015-28 range-tree merge | Accepted. Faithful port (verified); bound against M\* proven for the merge stage; the reconstruction steps are sound in direction except for the TypeScript residual (R2-m1). |
| D-TASK015-29 measured per project | Accepted (R2-n2 optional). |
| D-TASK015-30 attribute-proof diff gate | Accepted on code reading and tests (`diff-coverage.test.ts` green). Security-analyst owns the verdict. |
| D-TASK015-31 exact gate names | Accepted. Closes R1-m4 (b). |
| D-TASK015-32 case folding on win32 only | Accepted. C11 (duplicate key ignored) and C12 (fold everywhere) are killed. |

## R2-5. Follow-up status

| Item | Status |
|---|---|
| R1-M1 | Closed. Residual is tracked as R2-m1. |
| R1-m1 | Closed. |
| R1-m2 | Closed. |
| R1-m3 | Routed to qa-lead (D-ORCH-057). Now also carries R2-m2's magnitude sentence. |
| R1-m4 (a) | Routed to qa-lead with TASK-025 (PR40-SEC-05). |
| R1-m4 (b) | Closed (D-TASK015-31). |
| R1-n1, n3, n4, n6 | Closed. |
| R1-n2 | Accepted as by design. |
| R1-n5 | Partly done, accepted. |
| PR #42 union note (watchlist) | When TASK-025 merges on top of this hook, judge `packages/audit` by the merged gate. Given R2-m2, a borderline 95 % branch result should be cross-checked against one combined run before anyone treats it as a real gap. |

## R2-6. Merge conditions

1. R2-m1 (a): amend the module header in-PR (comment only; a diff glance is enough, no re-review). The orchestrator amends the D-TASK015-22/28 text in DECISIONS.md. R2-m1 (b) is in-PR or routed to qa-lead with PR40-SEC-06, owner and due date recorded. R2-m1 (c) is a qa-lead G3 item.
2. R2-m2, R2-n1 and R2-n2 may be routed (qa-lead / devops-engineer).
3. A security-analyst delta record naming `e8f4461` or a later head. Lane A green with all steps executed on the merged head. Squash merge.
4. If the header amendment lands as a new commit, no fresh lane-B evidence is needed for a comment-only change. The verifier credits by SHA, so the orchestrator decides.
