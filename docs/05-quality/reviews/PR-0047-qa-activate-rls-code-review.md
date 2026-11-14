# Code review: PR #47, manifest-only activation of `rls-cross-tenant` (round 1)

| Field | Value |
|---|---|
| PR | #47 `test(quality): activate rls-cross-tenant suite and move SEC-TC-29 to required` |
| Branch / head | `chore/qa-activate-rls-cross-tenant` @ `be8780b` (3 commits: `2430a25` manifest, `120a2d9` + `be8780b` evidence) |
| Merge-base | `47f942d` (main has moved to `9645b34` since; docs and memory only) |
| Story / records | US-077 · D-TASK024-16 · D-ORCH-071 · D-SEC-PR43-04/05 · D-ORCH-039 (1) · D-QA-017..020 · D-ORCH-080 |
| Reviewer | code-reviewer · 2026-11-14 · round 1 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The manifest diff is exactly D-TASK024-16 plus the SEC-TC-29 move, which the SHEET-FOLD-5 routing and
         D-ORCH-039 (1) authorize. The JSON is valid, the loader and activation tests pass, min_tests 126 equals the
         generated count, and I reproduced both check-evidence views. One MINOR (SEC-TC-74 is parked although it is
         implemented; this is mandated, and the consequence falls at Wave-0 exit) and three NITs, all routed outside this PR.
```

## 1. Verification I performed myself

| # | Check | Result |
|---|---|---|
| V1 | `git diff origin/main...be8780b --name-only` | 13 files. The only non-evidence file is `tools/quality/required-suites.json` (+4 / -3). The other 12 files are the two committed run directories. `git diff 2430a25 be8780b` touches only `docs/05-quality/tests/runs/`, so the head tree equals the manifest commit plus evidence. |
| V2 | Manifest hunks vs D-TASK024-16 (PR #43 body) and D-ORCH-071 | `rls-cross-tenant`: `status` `planned`→`active`, `min_tests` 1→126, `required_cases` [`SEC-TC-06`]. Pending gains `rls-cross-tenant: SEC-TC-07` (TASK-051, `v0.1.0-m0`) and `catalog-c1-c14: SEC-TC-74` (TASK-037, `v0.1.0-m0`). This matches item for item. Beyond D-TASK024-16: `api.required_cases` [] → [`SEC-TC-29`] and the `api` pending row removed (ruling D1). Nothing else changed: no `$comment`, rule or other suite. |
| V3 | JSON validity and format | `prettier --check` clean. Loaded through `loadManifest` by the tests below. |
| V4 | Activation and loader tests, run positionally: `jest tools/quality/lib/manifest.test.ts tools/quality/activation.test.ts tools/quality/check-evidence.test.ts --selectProjects unit` | **3 suites, 156 passed, 0 failed.** `activation.test.ts` covers: every active suite has a runner entry (`suite-runners.json` already holds `rls-cross-tenant` from PR #43); pending rows are on active suites only, with well-formed IDs, owner and checkpoint; pending IDs are disjoint from required IDs and each appears once. `heavy.test.ts` writes a synthetic manifest, so it is not affected. |
| V5 | `min_tests` | Run 20261114T1218Z_2430a25 `rls-cross-tenant.junit.xml`: `tests="126" failures="0" errors="0" skipped="0"`. 126 `<testcase>` elements, all with classname `tests/generated/rls/cross-tenant.int.test.ts`. 126 matches PR #43 fc1 and D-TASK020-77 ("RLS 126/126"). It equals the count at activation, as D-SEC-PR43-05 requires. |
| V6 | Required cases | `[SEC-TC-06]` appears in 13 passing rls cases. `[SEC-TC-29]` appears in 30 api cases, including the shared-helper case D-ORCH-039 (1) asks for. `[SEC-TC-74]` appears in 16 passing catalog cases. `git grep SEC-TC-07` on the head finds no code or test, so parking it is correct. |
| V7 | `check-evidence --profile pr --event pull_request --base 47f942d --head be8780b`, with the **base** manifest (`git show 47f942d:…` via `--manifest`) | **PASS**. `required: [unit]`. Accepted: `20261114T1250Z_120a2d9`. `20261114T1218Z_2430a25` is rejected by rule 4 ("JUnit for a suite still 'planned'") and by "SEC-TC-07 not in a passing test case". `tampered: false`. |
| V8 | The same with the **head** manifest | **PASS**. Both runs are accepted. Run `2430a25` reports `pendingImplemented: ["catalog-c1-c14:SEC-TC-74"]` (finding R1-m1). |
| V9 | Hosted CI on `be8780b` (run 43597954755) | `fast-lane` passes, and its check-evidence step prints the same accepted/rejected lines as V7. `scans` fails only on "Security-owned paths need a review record" (`tools/quality/required-suites.json`, no `PR-0047-*` record). `ci-gate` fails as a consequence. This is expected before security-analyst records the PR. |
| V10 | Why the two unit counts differ (4739 vs 4726) | I diffed the testcase names. Run 1 has 14 `coverage diff: <file>` cases because its `--base cc2a57d^` diff covers the PR #43/#44 sources. Run 2 has one `coverage diff: no changed source file in scope`. The coverage-merge case names differ as well. There is no other difference. |
| V11 | D-QA-019 FAIL run (untracked, not in the diff) | `20261114T1236Z_120a2d9`: 15 unit failures. 13 are "Exceeded timeout of 5000 ms" and 2 are `toBeLessThan` wall-clock bounds. Unit took 709.8 s. D-ORCH-080 tracks this as TASK-W0-FLAKE. |
| V12 | Union with open PRs | `git merge-tree --write-tree be8780b <head>` is clean against #42 `7e9fb3c` (the merged manifest parses and keeps both the rls/api hunks and #42's `coverage gate: packages/audit` cases) and against #46 `12ea6a6`. #39 does not touch these files. |
| V13 | Host-path scan, by count, over the 13 changed files | 0 |
| Not re-run | lint, typecheck, build, the full unit suite, Docker suites | The brief asked for light commands only. This PR changes no code, so I relied on the committed lane-B runs and on hosted `fast-lane`. |

## 2. Findings

| ID | Severity | Location | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `tools/quality/required-suites.json:51` (pending `catalog-c1-c14: SEC-TC-74`) | **SEC-TC-74 is parked although 16 passing `catalog-c1-c14` cases already carry it.** This contradicts the pending block's own `$comment` ("taken out … because no test carries them on main yet"). While parked, the ID is informational, so a PR that **deletes** the SEC-TC-74 tests would pass lane A; skipped or failed ones would still fail. Every later backend PR prints the `pr`-profile note, and the Wave-0-exit `wave` run fails rule 7 / PR28-SEC-01 (`check-evidence.mjs:645-651`). D-SEC-PR43-05 and D-ORCH-071 mandate this entry, and changing it on this branch would make both runs stale (`tools/**` is not staleness-allowed), so it should not be fixed here. | Already routed to security-analyst by D-QA-018. My recommendation: in the PR #47 security record, rule that SEC-TC-74 moves to `catalog-c1-c14.required_cases` in the **next** manifest PR. That PR must merge before TASK-037 merges and no later than the Wave-0-exit activation PR. The `$comment` should also gain an adoption clause if the SEC-TC-69..75 "adopt via pending" route (SHEET-FOLD-5 (4)) is kept. |
| R1-n1 | NIT | `docs/05-quality/tests/runs/20261114T1218Z_2430a25/summary.json`, `summary.md` (generated by `tools/quality/heavy.mjs`) | The run was taken with `--base cc2a57d^`, but neither artifact records the selection base. The only traces are "Path rules fired: backend, jobs-and-platform" and the commit message. Evidence provenance is therefore not self-describing. | Owner of `heavy.mjs` (015-C): write the selection base into `summary.json` (schema field) and `summary.md`. Nothing to do on this PR. |
| R1-n2 | NIT | merged `coverage-summary.json` of the three runs on byte-identical source | The merged **branch** denominator depends on the run path: 4201 in the rls-carrying run, 4193 in the credited run and 4188 in the FAIL run. The line totals are identical (16240). Nine files differ by one or two branches each, for example `with-tenant-tx.ts` 89 vs 90, `define-route.ts` 211 vs 210, `audit-partitions.ts` 56 vs 54, `apps/worker/src/main.ts` 1 vs 0. The gate is not at risk (96 % against 75 %), but a percentage gate whose denominator is not deterministic is weak. | qa-lead / 015-C: find out which project's istanbul branch map wins in the merge (suite run vs combined coverage run) and make the merge deterministic. Add a note to the US-006 gate description. |
| R1-n3 | NIT | `package.json:47` (`test:generated --passWithNoTests`), not in the diff | PR34-SEC-05 and SHEET-FOLD-5 (4) route "drop `--passWithNoTests` from `test:generated` when the first generated suite lands" to the qa-lead activation PRs. PR #43 fired that trigger. This PR neither does it nor lists it among its out-of-scope items. Lane B is unaffected (`heavy.mjs` never passes the flag, and `min_tests` 126 now catches an emptied suite), so the residual is the developer-facing script only. | Add the item to the next qa-lead activation PR's list (it is a `package.json` change and would select more suites, so it should not ride this PR). |

There are no BLOCKER or MAJOR findings.

## 3. Deviation rulings

- **D1: SEC-TC-29 move beyond "exactly the D-TASK024-16 diff" (D-SEC-PR43-05). Accepted.** The SHEET-FOLD-5 routing (DECISIONS, D-ARCH SHEET-FOLD-5 decision item (4)) assigns "move SEC-TC-29 from `required_cases_pending` back to `required_cases` (D-ORCH-039 (1))" to the next qa-lead activation PR. The dispatch brief names it, and 30 passing api cases back it. It adds a requirement and weakens nothing. Security-analyst should confirm it in the record, because D-SEC-PR43-05 says "exactly".
- **D2: `min_tests` 126 vs SHEET-FOLD-5 (4) "keep `min_tests: 1` … of the four generated suites at activation" (PR34-SEC-05). Accepted.** D-SEC-PR43-04/05 and D-ORCH-071 are later and specific to this suite, and they require the count at activation. The other three generated suites keep the earlier line.
- **D3: two evidence runs (D-QA-017). Accepted and verified (V7, V8, V10).** A single run that carries the suite cannot be credited (rule 4, documented in the manifest's own `planned_suite_reported` rule). Without a credited run for `unit`, lane A fails. `--base` is a documented `heavy.mjs` option, both runs are `git_dirty: false` and `build_clean: true`, and the rls-carrying run sits on the manifest commit whose tree equals the head minus evidence. Provenance gap: R1-n1.
- **D4: the FAIL run left untracked (D-QA-019). Accepted.** It is outside the diff and not a clean-tree path (it lives under `docs/`, so the porcelain gate ignores it). The credited pass is a same-SHA re-run after a timing FAIL, which is a retry-hidden flake pattern. It is disclosed, and TASK-W0-FLAKE (D-ORCH-080) owns it with a due point. Note that two of the flaky cases carry `[SEC-TC-29]`, so under host load any PR can fail the "no failed SEC-TC case anywhere" rule until TASK-W0-FLAKE lands.

## 4. Follow-up closure

| Item | Status |
|---|---|
| D-TASK024-16 / D-ORCH-071 manifest diff | Done (V2) |
| D-SEC-PR43-05: own run 126/0/0 (uncredited acceptable); `min_tests` = count at activation | Done (V5, V7) |
| D-ORCH-039 (1) SEC-TC-29 back to required | Done (V6, D1) |
| D-TASK025-21 acknowledgement of PR #42's `coverage gate: packages/audit` cases | Acknowledged in the PR body; union proven clean (V12) |
| SEC-TC-69..75 adoption, `k6-audit-ab` runner string, `required_from`, `KNOWN_DRIFT`, PR35-SEC-05, PR34-SEC-05 | Open; next activation PR (R1-n3 adds PR34-SEC-05 to the list) |

## 5. Merge conditions

1. A security-analyst record `docs/05-quality/security/PR-0047-*.md` with a passing verdict and a head row; `scans` / `ci-gate` green. The record is docs-only, so it does not make the evidence stale (`docs/**` is staleness-allowed). The ruling on R1-m1 and the D1 confirmation belong in that record.
2. **Merge order: merge #47 before PR #42 takes its fix-cycle-2 evidence.**
   - If #42 merges first, the base manifest requires `coverage gate: packages/audit lines|branches` in `unit`. This PR's credited run only has `coverage gate: packages/audit (inactive)`, so lane A would fail and both runs would have to be taken again.
   - If #47 merges first, every open PR that fires a rule selecting `rls-cross-tenant` (#42, #39, #46, and TASK-024-F) must merge main before taking evidence. `heavy.mjs` then reads the active head manifest and reports the suite, which must have at least 126 tests with `[SEC-TC-06]` and 0 skips.
3. No further non-docs push. Any change to `tools/**` makes both runs stale.
