# Code review: PR #85 gitleaks-full baseline 17 -> 22 (PR080-SEC-07), round 1

| Field | Value |
|---|---|
| PR | #85, branch `ci/gitleaks-baseline-pr080-sec-07`, head `72249e40` (pushed; `origin` equals the head), worktree `Shipqube-GLBASE` (clean) |
| Commits | `518a8075` two main fingerprints (17 -> 19), `72249e40` three branch-only merge fingerprints (19 -> 22) |
| Base | `1a2b9d7d` (D-ORCH-168 reword). `1a2b9d7d..main` (`4d649af3`, 29 commits) is `docs/` and `.claude/` only; `git merge-tree --write-tree main 72249e40` is clean |
| Bindings read | D-ORCH-168, D-ORCH-170, D-DEVOPS-001, D-DEVOPS-002, D-SECPOST-01 (O-1, C1), D-SEC-PR45-01 (exact fingerprints only); `gitleaks-full.mjs` (whole), both gitleaks-full test files, the PR25-SEC-01 block of `sec-static.test.ts`, `suite-runners.json` (`--ref {base}`) |
| Reviewer | code-reviewer, 2026-11-21 (orchestrator session C dispatch; D-CRCHORE-01) |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The five added lines are exact D-SEC-PR45-01 fingerprints of the one false-positive prose line; each commit,
         path and line number re-derives from git objects, and BASELINE_COUNT, the sec-static pin, the unit and int
         counts move together. The int test holds on main after the merge (19 used + 3 inert lines, first line on main).
         One MINOR on how lane B reads a count change (process, no code change), three NITs.
```

Scope: 5 files, all under `tools/ci` and `tools/quality`, exactly what D-ORCH-168 (b) and D-DEVOPS-002 route. No `.gitleaks.toml` change, no path or commit allow-list.

## 1. What I verified myself

Dispatch constraints: git, grep and reads only. No npm, Jest, Docker or Node. Nothing in any worktree was modified.

| Check | How | Result |
|---|---|---|
| Baseline shape | non-comment lines of `72249e40:tools/quality/gitleaks-baseline.txt` against `^[0-9a-f]{40}:[^:\s]+:generic-api-key:[1-9]\d*$` | 22 lines, 22 unique, 0 off-pattern, no CR. The first 17 are byte-identical to main's 17 |
| Fingerprint content | `git show <commit>:<path> \| sed -n <line>p` for all five | All five are the same false positive: the quoted TASK-051 doc-comment phrase (keyword `key columns`, a comma, a backticked `child=parent` value of 12 distinct characters, entropy about 3.58 > 3.5). Line 7697 of `DECISIONS.md` has md5 `9a3add00...` in `d7585e78` and in all three merges; line 23 of the memory file in `ed156913` is the second quote. No value is a credential |
| Merge parents | `git log -1 --format=%P` | `c33e5e92` = `cbd590db` + main `4ba683ad`; `0ccdd009` = `a4aadd2e` + main `4ba683ad`; `aade2672` = `12b8a10a` + main `3d54cef8`. Matches the comments in the baseline file |
| First-parent re-add | for every merge in `git rev-list --merges --all --not main` (203 refs), exact-line match of the two flagged lines in `git diff <m>^1 <m>` | 6 merges re-add line 7697. 3 are the three new lines. The other 3 (`05e1e9da` TASK-051 v2, `22f69a82` TASK-041 A, `2805c809` TASK-080) belong to branches already squashed into main as #83, #82 and #81 and are in no open branch's ancestry. No merge re-adds the memory-file line. The TASK-034 and TASK-045 merges of `88fd7360` carry only the reworded text |
| Open-branch ancestry | `git merge-base --is-ancestor` per merge per branch | TASK-044 `33262314` holds `c33e5e92` only; 040-B `9d1687b1` holds `0ccdd009` only; 041-B `214ec79b` holds `aade2672` only; TASK-034 `e17f1d6d` and TASK-045 `ff1489ff` hold none. The set is complete for every ref in this repository (I did not fetch) |
| Ancestry of the fingerprint commits | per commit vs main, `72249e40`, `72e3dc9f`, `0ccac6bf` | `63accea`, `b8f805f`, `d5cdfa2`, `d7585e7`, `ed15691`: ancestors of all four. `c33e5e9`, `0ccdd00`, `aade267`: ancestors of none |
| New hits since the last proven scan | Lane B on `72e3dc9f` (ancestry = main up to `88fd7360`) found exactly the two main fingerprints (D-DEVOPS-001). For `88fd7360..main`, `1a2b9d7d..72249e40`, `88fd7360..72e3dc9f` and `88fd7360..0ccac6bf` I ran an over-approximating grep of the rule (keyword, operator, a 10-150 character value with a non-letter) over the first-parent added lines | Controls: both flagged lines match. Candidates: `PR040-SEC-07`, `PR19-SEC-01`, `PR040-SEC-12` (entropy about 3.0-3.1, below 3.5) and letter-only values (`pg_restore`, `RATE_LIMIT_AUTH_PER_IP_PER_MIN`, `authenticator`, `update-types`), which the rule's `^[a-zA-Z_.-]+$` allow-list drops. No new fingerprint |
| Pins | read | `BASELINE_COUNT = 22`; sec-static: 22 lines, 22 unique, the sorted prefix list (`'0ccdd00' < '63accea' < 'aade267' < ... < 'ed15691'` in code-unit order), 15 openapi lines, the two and the three full lines in file order. Unit test 22; int test titles 22 and 21 |
| Merge with #86 and #87 | `git merge-tree --write-tree` pairwise and of all three | Clean in every combination; `sec-static.test.ts` hunks are disjoint (line 160 here, 303 and 312 there) |

Not run (dispatch): the unit and int tests. The developer reports `sec-static.test.ts` and `gitleaks-full.test.ts` 33/33 (D-DEVOPS-002). **Nobody has run `gitleaks-full.int.test.ts` on `72249e40`.**

## 2. Does the int test hold?

| Head | HEAD baseline / BASELINE_COUNT | Fingerprints in the ancestry | Case 1 (full list, 0 findings) | Case 2 (drop line 1 = `63accea`, 1 finding) |
|---|---|---|---|---|
| `72249e40` (#85) | 22 / 22 | 19 (the 3 merges are absent; gitleaks ignores unused entries) | holds | holds (`63accea` is on main) |
| main after #85 squashes | 22 / 22 | 19 | holds, given the scan in §1 | holds |
| `72e3dc9f` (#86), `0ccac6bf` (#87) as pushed | 17 / 17 | 19 | **fails, 2 findings** (the known PR080-SEC-07 class) | fails |
| #86 / #87 after merging a main that contains #85 | 22 / 22 | 19 | holds | holds |
| TASK-044, 040-B, 041-B after merging a main that contains #85 | 22 / 22 | 20 each | holds | holds |

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `tools/quality/gitleaks-full.mjs:46,163`; `tools/quality/suite-runners.json:18` | Lane B runs the **worktree's** runner (its `BASELINE_COUNT`) against the baseline **at `{base}`**. A count change therefore fails closed with exit 2 in two places that D-ORCH-170's reading rule ("exactly these 2 fingerprints") does not describe. (a) #85's own lane-B `gitleaks-full` reads main's 17 lines against 22 and stops with `baseline holds 17 fingerprints, exactly 22 expected`: it cannot be green before the merge. (b) Once #85 is on main, every branch without it (#86, #87, TASK-034, 040-B, 041-B, 044, 045 ...) stops with `holds 22 fingerprints, exactly 17 expected` until it merges main. Neither is a finding of a secret; both look like a broken runner. | Orchestrator: record both signatures as expected in the D-CRCHORE-01 follow-up (no code change in #85). #85's scan evidence is the int test run on `72249e40` (it reads HEAD), then main's lane B after the merge (D-SECPOST-01 C1). Optional devops follow-up: carry the expected count in the baseline file at the ref (a reviewed line too), so a branch and its base cannot disagree. |
| R1-n1 | NIT | `tools/quality/gitleaks-full.test.ts:138,191` | The two 16 + 1 fixtures were sized to the old count. With 22, `readInputs(root, b)` now throws on the count as well as on the commit-less line, so that assertion no longer isolates the per-line check (the CLI case at :145 still pins the message `baseline entry 17 is not an exact`). | Size both fixtures `BASELINE_COUNT - 1` valid lines + the bad line, and assert the per-line message in the `readInputs(root, b)` case. |
| R1-n2 | NIT | `tools/quality/gitleaks-full.int.test.ts:46` | Case 2 drops `baseline[0]` and relies on line 1 being a main commit. A reorder that puts a branch-only line first makes case 2 report 0 findings on main (fails closed, but confusingly). | Drop the first line whose commit is an ancestor of HEAD (`git merge-base --is-ancestor`), or pin `lines[0].startsWith('63accea')` in the sec-static block. |
| R1-n3 | NIT | `tools/quality/gitleaks-baseline.txt:41-49` | The three branch-only lines are inert on main and stay so after TASK-044, 040-B and 041-B squash (their merge commits never reach main). | Owner devops-engineer: once those three PRs are merged and no open branch contains the merges, remove the lines (count 19), shrink-only. |

## 4. Deviation rulings

- The three branch-only fingerprints (D-DEVOPS-002) are accepted. They are exact commit + path + rule + line entries (D-SEC-PR45-01), the content is the same non-secret line, and the alternative (a v2 squash supersede of three live branches) costs three re-reviews for no security gain. Lane A's range scan still does not read the baseline, so route (c) of PR080-SEC-07 stays open there, as D-DEVOPS-002 says.

## 5. Merge conditions

1. A security record on `72249e40` (`tools/quality/**` is security-critical; D-DEVOPS-002 notes it is requested and missing).
2. `gitleaks-full.int.test.ts` run once on `72249e40` (Docker, when the lock is free): 2/2. Read a lane-B `gitleaks-full` exit 2 with `holds 17 fingerprints, exactly 22 expected` as R1-m1 (a), not as a failure of this PR.
3. Merge #85 before #86 and #87 (section 6 of the PR-0086 record).
4. Hosted CI when billing returns, per the standing rule.

## 6. Good

- Every new line carries an ids-only comment naming the decision, the branch and the head that holds it; no value is quoted anywhere.
- The sec-static block pins the five lines by full text, so a sixth line or a path-only widening fails.
- The reword in `1a2b9d7d` stops new instances at the source instead of growing the baseline per merge.
