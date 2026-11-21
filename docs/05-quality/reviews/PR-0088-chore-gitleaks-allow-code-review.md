# Code review: PR #88 commit-bound gitleaks allow entries for three merge commits (PR080-SEC-07 route (c)), round 1

| Field | Value |
|---|---|
| PR | #88, branch `chore/gitleaks-allow-merge-commits-pr080-sec-07`, head `641ff03c` (pushed; `origin` equals the head), worktree `Shipqube-GLALLOW` (clean) |
| Commits | `641ff03c` only, on `origin/main` `88fd7360` |
| Files | `.gitleaks.toml` (+41), `tools/ci/sec-static.test.ts` (+112 / -2) |
| Bindings read | D-SEC-PR45-01 and D-ORCH-070 (PR #45), D-SECPR040-02 (extension to review-bound commits), D-SECPR080-03 (PR080-SEC-07), D-ORCH-168, D-ORCH-172, D-CRCHORE-01, D-DEVOPS-003; precedent records `PR-0045-gitleaks-allow-code-review.md`, `PR-0085-chore-gitleaks-baseline-code-review.md`; lane A gitleaks step `ci.yml:577-587` and its tested-base config copy `ci.yml:535-549` |
| Reviewer | code-reviewer, 2026-11-21 (orchestrator session C dispatch; D-CRCHORE-02) |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The three tables are exactly commit-bound: one full SHA, one rule, one anchored path and one anchored line
         whose only variable part is the 12-character class, and the pattern matches line 7697 of each merge blob.
         Every widening the PR claims to refuse is killed by an exact pin in the shape test. No conflict with #85,
         #86 or #87. Two MINORs: the PR45-SEC-01 pin that was due before this change, and no retirement owner.
```

## 1. What I verified myself

Dispatch constraints: git, grep and reads only. No npm, Jest, Docker or Node. Nothing in any worktree was modified. The flagged value is never printed: matches below are counts, and line identity is a blob hash.

| Check | How | Result |
|---|---|---|
| Merge commits | `git cat-file -t`, `git log -1 --format=%P` | `c33e5e92` = `cbd590db` + main `4ba683ad`; `0ccdd009` = `a4aadd2e` + main `4ba683ad`; `aade2672` = `12b8a10a` + main `3d54cef8`. All three are merges, matching the table comments |
| Ancestry | `git merge-base --is-ancestor` vs `main`, `origin/main`; `git branch -a --contains` | None of the three is in main. Each is in exactly one branch: TASK-044 (local only, `33262314`), 040-B (`9d1687b1`), 041-B (`214ec79b`). `d7585e78` is an ancestor of main |
| Pattern matches the committed line | the TOML regex (minus `^\n?`) run with `grep -cP` on `git show <c>:docs/sdlc/DECISIONS.md \| sed -n 7697p` | 1 match in `c33e5e92`, `0ccdd009`, `aade2672` and `d7585e78`; 0 in main and in `641ff03c` (reworded by `1a2b9d7d`). Line 7697 has the same blob hash (`e56ad62a`) in all four commits. No CR in the line |
| One class, three identical patterns | `grep -o` of the class; `sort -u` of the three `regexes` lines | The class `[a-z=]{12}` appears once; the three patterns are byte-identical |
| First-parent re-add | `git diff <c>^1 <c> -- docs/sdlc/DECISIONS.md`, added lines matched with the pattern | Exactly 1 added line in each merge; the hunk covers line 7697 |
| No other commit needs a table | every commit of `main..<branch>` for the three branches, first-parent diff of `DECISIONS.md` against the pattern | Only the three merges. 041-B's other merges (`0614a90f`, `ba4d0aaa`, `56cf335a`) add 0. Lane B and the security emulations (D-SECPR040B1-02 item 6, D-SECPR041B-03) report one gitleaks finding per range, which is this line |
| D-SEC-PR45-01 condition 7 (the text leaves before merge) | `git merge-tree --write-tree origin/main <head>` for `33262314`, `9d1687b1`, `214ec79b` | All three merge cleanly, and the result holds 0 matching lines: each branch head carries the merge-base version of line 7697 unchanged, so the squash takes main's rewording |
| Value never quoted | the value read into a shell variable from `d7585e78`, then `grep -c -F` over `git show 641ff03c` (diff and message) and main's `DECISIONS.md` | 0 and 0 |
| Suppression lint | `tools/lint/check-suppressions.mjs` treats `.gitleaks.toml` as a hash-comment file | The new comments hold no `gitleaks:allow`, `nosemgrep` or directive text |
| Other consumers of `.gitleaks.toml` | `git grep` on `641ff03c` | `ci.yml` (base-ref copy), `check-workflow-policy.mjs` (step text only), `gitleaks-full.mjs` (reads it at the ref). No test counts the tables except `sec-static.test.ts` |
| Merge with #85, #86, #87 | `git merge-tree --write-tree` of `641ff03c` with `72249e40`, `72e3dc9f`, `0ccac6bf`, `origin/main`, local `main` (`13ecf05d`), and the stacked merge of all four | Clean in every case. `sec-static.test.ts` hunks are disjoint: #85 edits the PR25-SEC-01 block, #86 and #87 add tests further down, #88 edits the D-ORCH-068 pin and inserts after the dd7a2dd controls |

Not run (dispatch): Jest, ESLint, Prettier, `tsc`, the real gitleaks image. The developer reports `sec-static.test.ts` 20/20, Prettier clean, 0 type errors in the touched file (D-DEVOPS-003). The real-image before/after is D-SEC-PR45-01 condition 5 and belongs to the security record.

## 2. Are the tables exactly commit-bound?

Yes. Each table has `condition = "AND"`, `regexTarget = "line"`, one 40-hex `commits` entry, `targetRules = ['''generic-api-key''']`, `paths = ['''^docs/sdlc/DECISIONS\.md$''']` and one `^\n?<line>$` pattern. The pattern's literal parts escape every regex metacharacter (`\*`, `\(`, `\)`, `\.`), and the only non-literal part is `[a-z=]{12}`, followed by a literal backtick.

Commits are immutable, so a table can only ever suppress lines of its own merge's first-parent diff. In that diff, exactly one `DECISIONS.md` line matches the pattern, so each table removes exactly one fingerprint. Under AND, a key added later can only narrow a table.

Main's `d7585e78` and `ed156913` are correctly left out. Lane A scans `base.sha..head.sha`, and both commits are ancestors of every current base. If an event ever carried a stale `base.sha` from before `d7585e78`, the scan would fail closed (the negative control pins that `d7585e78` is still reported), so this is not a gap.

## 3. Do the tests kill the widenings they claim?

Yes, at the config level. The shape test (`sec-static.test.ts:295`) pins each table exactly:

- `commits` equals the one SHA by index;
- `targetRules` equals `['generic-api-key']`;
- `paths` equals the one anchored path;
- the first pattern equals a string built from `triageLine` with the class substituted;
- the three patterns are equal (`Set` size 1).

`condition` and `regexTarget` are checked for every block by the D-ORCH-068 loop at :194, and the description list pins the table count and order. Each claimed widening therefore fails an exact `toEqual`/`toBe` against the committed config:

- a wider class, `{1,64}`, `[^\n]*` or `.*`;
- a dropped `$` or `^\n?`;
- `^docs/sdlc/` or any other path;
- a second commit, an abbreviated SHA;
- another or an extra rule;
- a fourth table.

The mutation probes (:316-327) exercise the helpers `literalButClass` and `commitBoundViolations` on mutated text, not the config. They are not vacuous: an unchanged source returns `true` and fails `toBe(false)`. They prove the helpers would also refuse the shape, which is useful for future tables.

The negative controls (:330) use the same oracle as PR #45. Their outcomes are deterministic, even though the phrases are random:

- a digit, an upper-case letter, 13 characters or an AWS shape break the class or the length;
- `trimStart` breaks the two-space indent;
- a second `\n` breaks `^\n?`.

All keys are present in the new tables, so PR #45's R1-m2 (absent keys treated as failing checks) does not weaken these controls.

The tests cannot tie the pattern to the committed blob, because the value is never quoted and branch-only commits are absent from a CI checkout. My `grep -P` above makes that link. The real-image run is the authority (merge condition 1).

## 4. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `tools/ci/sec-static.test.ts:122,194-216`; `.gitleaks.toml:21-22` | PR45-SEC-01 (LOW, D-ORCH-070) was due "before the next `.gitleaks.toml` change". #88 is that change, and the pin is still open. It required three things: (a) `[extend]` holds `useDefault = true` and nothing else; :122 checks only that the key is present, so a `disabledRules` line in `[extend]` is not caught; (b) a key/literal map per description, which #88 provides for its own three tables but not for the dd7a2dd table, whose pattern sources are still only counted (PR #45 R1-m1); (c) the oracle should treat absent keys as "no check" (PR #45 R1-m2). #88 does not widen anything, so this is the debt of 015-C. However, the security condition named this change. | Either fold (a) and the dd7a2dd literal pin into #88 (about 10 test lines: parse the `[extend]` block to exactly `useDefault = true`, and `toEqual` the two dd7a2dd pattern sources), or security-analyst re-dates PR45-SEC-01 explicitly in the #88 record. Orchestrator: do not let a fifth `.gitleaks.toml` change pass without it. |
| R1-m2 | MINOR | `.gitleaks.toml:45-51`; `sec-static.test.ts:194-202` | No retirement owner or trigger for the three tables (D-SEC-PR45-01 lifetime: remove after the PR is squash-merged or closed and the commit is not in main). This is a recurring gap: PR #45's dd7a2dd table is still on main, although PR #39 squash-merged as `3f589352` and `dd7a2dd` is not an ancestor of main. The removal PR routed by D-ORCH-070 (R1-m3) never happened. Each dead table costs a test-pin edit and a security review to remove. | devops-engineer owns one shrink-only removal PR, with a trigger written into STATUS/DECISIONS: once TASK-044, 040-B and 041-B have squash-merged (or closed), drop the three tables and the dd7a2dd table together, together with #85's three inert baseline lines (PR-0085 R1-n3). Name it in the #88 security record or in D-ORCH. |
| R1-n1 | NIT | `tools/ci/sec-static.test.ts:307` | "The exact fingerprint is recorded next to the entry" is checked with a whole-file `toContain`. The comment sits above its `[[allowlists]]` header, so it is not in the entry's block. Swapping two fingerprint comments still passes. | Assert order: the index of `# Fingerprint: <sha>` lies between the previous table's description and this table's description, or check the block text that precedes each `[[allowlists]]`. |
| R1-n2 | NIT | `.gitleaks.toml:11-15` (header) | The header describes the class as "a false positive in a commit that was already pushed to a PR". `c33e5e92` is local only. It is in the class only through D-SECPR040-02's extension to commits that review records have already bound (D-CRPR044-01 r3 at `33262314`). | Either amend the header sentence ("pushed, or bound by review records, D-SECPR040-02"), or have the security record state the basis. If TASK-044 redoes its merge after `1a2b9d7d` (route (a)), drop that table instead. |

No BLOCKER or MAJOR.

## 5. Deviation rulings

- **The `c33e5e92` table for a local-only merge is accepted.** D-SECPR040-02 extends D-SEC-PR45-01 to review-bound commits, and TASK-044's r3 merge-only approval binds this one. Redoing the merge would void that approval and its lane-B record for no security gain. See R1-n2.
- **One table per commit instead of one table with three SHAs is correct.** D-SEC-PR45-01 allows exactly one SHA per table, and `commitBoundViolations` enforces it.
- **Leaving `d7585e78`/`ed156913` out of `.gitleaks.toml` is correct** (section 2). They stay baseline-only through #85.

## 6. Follow-up closure

- PR080-SEC-07 route (c) for lane A: met by this PR once merged, subject to the merge conditions.
- PR-0085 R1-n3 (retire #85's three branch-only baseline lines): now coupled to R1-m2 here. Retire both in one PR.
- PR45-SEC-01 / D-ORCH-070: see R1-m1.

## 7. Merge order and conditions

**Order:** #88 is textually independent of #85, #86 and #87. All pairs and the stacked merge of all four are clean, and #88 needs no rebase. Recommended order: #85 -> #86/#87 -> #88, per D-DEVOPS-003. Any order is safe. #88 must land before hosted lane A is counted for TASK-044, 040-B PR1 and 041-B.

**Conditions for #88:**

1. A security record on `641ff03c` (owned paths `.gitleaks.toml` and `tools/ci/**`), with the real-image before/after required by D-SEC-PR45-01 condition 5. Each of `c33e5e92`, `0ccdd009` and `aade2672` must go from 1 finding to 0 with this config. The controls must still report: `d7585e78`, another commit, another path, another rule. The record also rules on R1-m1 (fold or re-date PR45-SEC-01) and on the basis for `c33e5e92` (R1-n2).
2. Hosted CI on `641ff03c` when billing returns. #88 changes a PR46-SEC-16 lane A input, so lane A on #88 itself runs with the base's config (without the tables), which is the intended bootstrap.

**Conditions for the three task PRs after #88 lands:**

3. Each task PR needs a new `pull_request` event (a push) after #88 is on main. Lane A reads `.gitleaks.toml` from the event's `base.sha`, so re-running an older event keeps the old config and stays red. This is the PR45-SEC-02 pattern. TASK-044 must also push `c33e5e92` first; it is local only today.
4. The orchestrator re-reads earlier hosted proofs as void for those PRs (PR46-SEC-16, already in D-DEVOPS-003).

## 8. Good

- Values are parameterised as a class plus length everywhere: config, tests, commit message. The test generates shaped phrases at run time, and no value is committed.
- Exact `toEqual` pins on every key, plus pattern identity across the three tables, mean a widening in any one table fails the suite. The structural helper is kept for future tables.
- The negative controls name main's own commit, so the "main stays baseline-only" decision is pinned, not just stated.
- The fingerprint comments carry the full SHA, path, rule and line, the format lane B reports.

## 9. Security flags (for security-analyst)

- Condition 5 of D-SEC-PR45-01 (real image before/after with controls) is outstanding; it is merge condition 1.
- PR45-SEC-01 is due on this change (R1-m1).
- The basis for the local-only `c33e5e92` is D-SECPR040-02, not D-SEC-PR45-01 as the header words it (R1-n2).
- Retirement of the four commit-bound tables has no owner (R1-m2).
