# Code review: PR #18 (TASK-016 RLS foundations, supersedes PR #11)

- **Reviewer:** code-reviewer
- **Date:** 2026-11-13
- **Head:** `0f9ff276989127128cfe67922d050de095ad0d69` on `origin/main` `27b6f86` (after PR #17)
- **Commits:** `eac026a` (PR #11's net change, 376 of 377 files) and `0f9ff27` (`tools/lint/negative-fixtures.test.ts` resolved under PR #17's mode split)
- **Scope (D-ORCH-018, PR-0011 R3 §6 condition 1):** a supersede check. The content was graded in PR #11 rounds 1 to 3 (`PR-0011-TASK-016-code-review.md`, r3 APPROVED_WITH_NITS at `37a2109`) and is not re-reviewed. This round checks tree equality, ancestry, and the one hand-resolved file.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The tree is byte-identical to 37a2109 for all 376 PR #11-only files and to origin/main for all 39 other
         main-delta files (including PR #17's 14). None of the 21 commits in 63accea..37a2109 is an ancestor, and there
         is no merge commit. The negative-fixtures resolution keeps every PR #11 exact-mode assertion and applies PR #17's
         m3 a/b split correctly. Lane A fast-lane is green with exactly the 4 ruled extras. Only the security record is red.
FINDINGS: R18-n1 (NIT), R18-n2 (NIT). No BLOCKER/MAJOR/MINOR. R3-m1 is routed (STATUS ROUTED row). R3-m2 is routed to TASK-014 (not re-raised).
GOOD: a pure two-commit supersede; tables are copied byte-for-byte; the split follows m3 a/b exactly; the PR body carries its own SHA proofs.
SECURITY-FLAGS: none new. The lane A security-owned-paths record must name 0f9ff27 (R3.7 item 4).
```

## 1. Verification performed

Every check below was run read-only by SHA in the main checkout after `git fetch -q origin`. There were no commands in the worktree and no installs, builds or Docker, per the dispatch constraints.

| Check | Command (summary) | Result |
|---|---|---|
| Merge base of PR #11 | `git merge-base origin/main 37a2109` | `63accea` |
| File sets | `git diff --name-only 63accea 37a2109` (377) vs `git diff --name-only origin/main 0f9ff27` (377) | Identical sets. `comm -3` is empty. |
| Overlap | `comm -12` of PR #11's files and `git diff --name-only 63accea origin/main` (40) | Exactly one file: `tools/lint/negative-fixtures.test.ts` |
| 376 PR #11-only files | `git diff --name-only 37a2109 0f9ff27 -- <376 files>` | **empty** |
| 39 main-delta-only files (docs, `.claude`, PR #17) | `git diff --name-only origin/main 0f9ff27 -- <39 files>` | **empty** |
| PR #17's 15 files (`git show --name-only b622edc`) | `git diff --name-only origin/main 0f9ff27 -- <15>` | Only `tools/lint/negative-fixtures.test.ts`. The other 14 (including `.swcrc` staying deleted and `jest.config.ts`) are byte-identical. |
| `eac026a` alone | `git diff --quiet origin/main eac026a -- tools/lint/negative-fixtures.test.ts` | Equal to main. The resolution lives entirely in `0f9ff27`. |
| No `docs/` or `.claude/` in the delta | `git diff --name-only 27b6f86 0f9ff27 \| grep -c '^(docs\|.claude)/'` | 0 |
| Ancestry | `git merge-base --is-ancestor <c> 0f9ff27` for every commit in `git rev-list 63accea..37a2109` (21, including `d68898a` and `557aada`) | None is an ancestor |
| Merges | `git rev-list --merges origin/main..0f9ff27` | 0. Linear: `27b6f86` ← `eac026a` ← `0f9ff27` |
| Resolution vs mechanical 3-way merge | `git merge-file -p main base(63accea) pr11(37a2109)` (4 conflict hunks), then diffed against `0f9ff27` | Every difference outside the conflict hunks maps to PR body items 2, 3, 6 and 8 (§2) |
| PR #11 case tables | `TENANT_CONTEXT` … `WARNINGS` block (235 lines) and the `allowed (TASK-016)` table (30 lines), extracted from `37a2109` and `0f9ff27` | Byte-identical (`cmp`, `diff`) |
| Main's untouched parts | Lines 1–263 and the `server-only rules stay on…` tail through EOF, from `27b6f86` and `0f9ff27` | Identical |
| Lane A | `gh run view 43325215960` | headSha `0f9ff27`. `fast-lane` success; `scans` fails only at "Security-owned paths need a review record"; `ci-gate` fails as the aggregate. Unit: 2113 tests. Base-ref step: 94 passed, 7 skipped, and "4 extra finding(s)", all `platform/prisma-client-construction`: 2 on `bad-orders.service.ts` and 2 on `ok-orders.repository.ts`. None is ruleless. This matches PR-0017 R2.4 exactly. |
| `gh pr view 18` | headRefOid / base / mergeable | `0f9ff27…` / `main` / MERGEABLE |

**Not re-run (constraint):** `test:unit`, lint, typecheck, integration and coverage. I relied on lane A run 43325215960, which ran fast-lane `test:unit` and the base-ref step on this exact head, and on the developer's local gate table in the PR body for integration and coverage. Integration on this head is still R3 §6 condition 5 (orchestrator or lane B).

## 2. Review of the resolution in `0f9ff27` (PR body items 1–8)

PR #17's semantics, from `tools/lint/fixture-expectations.mjs`:
- `expectFindings` is `expectOnly` in exact mode and `noWeakening` (minSeverity) in no-weakening mode.
- `expectClean` is `toEqual([])` in exact mode and has no ruleless findings in no-weakening mode.
- `exactOnly` maps to `it.skip` in the base run.

| Item | Change | Exact mode vs PR #11 (`37a2109`) | No-weakening mode | Ruling |
|---|---|---|---|---|
| 1 | `TENANT_DB` added to `ESLINT_VIOLATIONS`, run through `expectFindings` | Same as PR #11. PR #11's `expectOnly` hard-coded `'error'`; main's passes `severity='error'` (the default) and checks sorted rule ids, severity and message, so the assertion is identical. | Expected rule(s) still reported at error with the fragment; other ruled findings become extras | Correct |
| 2 | `WARNINGS` → `expectFindings(…, '', 'warning')` | PR #11 asserted `[[ruleId,'warning']]` exactly. `expectOnly` checks sorted ids `== [ruleId]`, every severity `'warning'`, and message `contains ''` (always true). **Equivalent.** | `SEVERITY_RANK` accepts warning or error; rule off fails | Correct (PR-0017 R2.5 item 3, m3 b) |
| 3 | `allowed (TASK-016)` → `expectClean` | `toEqual([])`, same as PR #11 | Ruleless findings fail; ruled findings become extras. Not `exactOnly`, as R2.5 item 3 requires. | Correct |
| 4 | Sweep `expected` set includes `WARNINGS` | Main's exact branch fails on any dirty non-listed fixture. That is PR #11's assertion plus main's `others.length > 0`. | PR #17's body is unchanged | Correct |
| 5 | Case-table completeness and rule coverage stay `exactOnly` and include `WARNINGS` | PR #11's sets are unchanged. They now skip in the base run (PR #17's decision). | Skipped | Correct |
| 6a | audit-writer wiring split | The 2 `'error'` assertions are in `it` and the 2 `'off'` assertions in `exactOnly`. In exact mode all 4 still run. | The "on" half always runs. An "off" flipping to on is strengthening, so it is not asserted. | Correct (m3 a) |
| 6b | tenant-database wiring split | Repository: 3 × `'error'` via `toMatchObject`, plus `expect(['warn']).toContain(x)`, which (`===`) means `x === 'warn'`, the same as PR #11's `toMatchObject({…: 'warn'})`. prisma/tests: `tenant-context-sql` and `no-relative-packages` `'error'` always run; `prisma-client-construction` and `db-raw-sql` `'off'` move to a new `exactOnly` case. The `db-raw-sql` loop over 3 paths is unchanged. **All of PR #11's assertions still run in exact mode.** | `expect-affected` accepts `warn` or `error` and fails on `off`/undefined. The `'off'` halves are skipped. | Correct (m3 a/b) |
| 7 | Main's renamed server-only test and its `exactOnly` half | Byte-identical to main | — | Correct |
| 8 | Extras tagging: `known` also includes `WARNINGS` rule ids | No effect (afterAll returns early in exact mode) | Cosmetic, but now accurate: once this suite is the base, an `expect-affected` extra is tagged `[rule known to the base]`, because the base expects it on a warning fixture. Today's base (main) does not know `prisma-client-construction`, so the 4 extras correctly read `[rule new to the base]`. | Correct |

**Conclusion:** none of PR #11's exact-mode assertions is dropped or weakened. Every PR #11 `expect` call either survives verbatim or is replaced by an exactly equivalent helper call. Items 6 and 8 go beyond a literal merge. They apply PR #17's own m3 a/b rules to PR #11's new cases, which is what PR-0017 R2.5 item 3 asked for, and they cannot affect this PR's own base-ref run (the base is main's suite).

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R18-n1 | NIT | commit `eac026a` | `eac026a` alone fails `test:unit`: the completeness checks find unlisted `bad-*` fixtures until `0f9ff27`. The PR body says so. An intermediate commit that fails tests breaks `git bisect` on main if the PR is merged with a merge commit or rebase. | **Squash on merge**, as the PR body says. This is listed as merge condition 3. |
| R18-n2 | NIT | `tools/lint/negative-fixtures.test.ts` (`0f9ff27`, tenant-database wiring case, `expect(affected).toContain(repository?.['platform/expect-affected'])`) | When it fails, the message reads "expected array to contain undefined" and does not name the path or rule. The `db-raw-sql` loop next to it uses the `[path, value]` idiom for that reason. | Optional: `expect([rule, value]).toEqual([rule, expect.stringMatching(MODE === 'exact' ? /^warn$/u : /^(warn\|error)$/u)])`, or leave it as is. |

There are no new MINOR or higher findings. PR #11's own r3 items stand as routed:
- **R3-m1:** owners are recorded in the STATUS ROUTED row. The security-event sink goes to the TASK-010 logger, the leak-counter metric to TASK-214, and Client plus the boot assertion to TASK-020. The sheet fold is pending.
- **R3-m2:** routed to TASK-014 together with PR #9 R3-m1. Not re-raised.
- **R3-n1..n6:** routed.

## 4. Deviation rulings

- **PR-0011 R3 §6 condition 1 wording.** It expected `git diff 37a2109 <head> -- . ':!docs' ':!.claude'` to be empty. Since then PR #17 has landed on main, so that diff is now exactly PR #17's 15 non-docs files. **Accepted.** The equivalent proof is in §1: the 376 PR #11-only files match `37a2109`, the 39 main-only files match `origin/main`, and the one overlap is reviewed in §2.
- **The PR #11 overlay extras.** On this head the overlay gives 4 extras, as ruled in PR-0017 R2.4. **Met.**

## 5. Good (keep)

- A minimal supersede. One `git apply --3way` commit of the reviewed delta, then a separate commit for the only conflict. That made the equality and ancestry proofs mechanical.
- The PR #11 case tables were carried byte-for-byte. Only the helpers that call them changed.
- Each mixed wiring case is split into "on, always" and "off, exactOnly", with a comment citing m3 a. This is a reusable pattern for PR #4's and PR #13's merges.

## 6. Merge conditions

1. The security-analyst supersede round (R3.7) names `0f9ff27` or a later head. Lane A `scans` and `ci-gate` are then green on the final head.
2. PR-0011 R3 §6 condition 5: the orchestrator or lane B re-runs integration (Docker) on this head.
3. **Squash merge** (R18-n1).
4. If the head moves, re-check only the delta (`git diff 0f9ff27 <new>`), and re-run the base-ref step expecting exactly 4 extras.
5. The orchestrator closes PR #11 after the merge (D-ORCH-018).
