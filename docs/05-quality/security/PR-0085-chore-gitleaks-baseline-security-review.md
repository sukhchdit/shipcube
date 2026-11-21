# Security review: PR #85 gitleaks-full baseline 17 -> 22 (PR080-SEC-07), round 1

| Field | Value |
|---|---|
| PR | #85, branch `ci/gitleaks-baseline-pr080-sec-07` (worktree `Shipqube-GLBASE`, not touched), base `1a2b9d7d` (the D-ORCH-168 reword) |
| Head | 72249e40482e9df6aace5973ef6d42c6334f28e3 |
| Commits | `518a8075` two main fingerprints (17 -> 19); `72249e40` three branch-only merge fingerprints (19 -> 22) |
| Owned paths | 5, by main's `tools/ci/check-security-owned-paths.mjs` with `--base 1a2b9d7d`: `tools/ci/sec-static.test.ts`, `tools/quality/gitleaks-baseline.txt`, `tools/quality/gitleaks-full.int.test.ts`, `tools/quality/gitleaks-full.mjs`, `tools/quality/gitleaks-full.test.ts` |
| Bindings read | PR080-SEC-07 (D-SECPR080-03, D-SECPR041-04); D-ORCH-168, D-ORCH-170, D-ORCH-171, D-ORCH-172; D-DEVOPS-001, D-DEVOPS-002, D-DEVOPS-003 (PR #88, lane A route (c)); D-SEC-PR25-01 as clarified by D-SEC-PR45-01; D-SECPR040-02 (branch commits and the baseline); code review twin `docs/05-quality/reviews/PR-0085-chore-gitleaks-baseline-code-review.md` (D-CRCHORE-01, APPROVED_WITH_NITS) |
| Main when written | `7b7263f8` (= `origin/main` at commit time). Since each PR base, main has changed only `docs/` and `.claude/` paths |
| Reviewer / date | security-analyst, 2026-11-21 (orchestrator session C; D-SECCHORE-01) |
| Method | Static only. Git plumbing on the main checkout's object store and single-process Node 24 scripts in the session scratch directory: (1) a faithful emulation of the gitleaks v8.30.1 `generic-api-key` rule (regex, entropy above 3.5, both rule allow-lists, the line allow-list, stopwords; `config/gitleaks.toml` of the v8.30.1 tag), run per hunk over first-parent diffs as gitleaks does; (2) an over-approximating scan with all 221 default rules (keyword prefilter and regex only, no allow-lists). Both carry runtime-built positive controls, which fired. The scripts print fingerprints, lengths, character-class counts and SHA-256 prefixes, never a value. No Docker, Jest or npm; no command ran in any worktree; lane-B run artefacts were read as files. No `.env*` path was opened, and every `diff`/`log -p` excluded dot-env paths by pathspec (0 such paths streamed). |

## 1. Summary

**Verdict:** PASS_WITH_FOLLOW-UPS. No Critical, High, Medium or Low finding. Two INFO findings (PR85-SEC-01, PR85-SEC-02).

- **All five new fingerprints are the same false positive.** Each names a line that is an added line of its commit's first-parent diff, and on each line the rule matches exactly one value. The value is identical in all five: a prose quotation of a doc comment, not a credential. Nothing needs rotation.
- **The lines cannot widen the baseline.** Each is an exact `<commit>:<path>:generic-api-key:<line>` key on an immutable commit. It can silence only the one finding on that one line of that commit (§3). `.gitleaks.toml` is unchanged.
- **22 is complete for every open branch.** A sweep of all refs and worktree HEADs (1,663 commits) finds no other open branch that carries the line in a flagged form (§4).
- **The PR adds nothing flaggable.** Its own added lines give 0 findings (faithful rule) and 0 hits (all 221 rules, over-approximating).

## 2. The five fingerprints

The value in all five lines (SHA-256 prefix `f2bcf94401469a69`) has 12 characters: 11 lower-case letters and one `=`, all 12 distinct. That gives an entropy of 3.585, just above the rule's 3.5. It has no digit and no upper case. It is a child-equals-parent pair of two column words, 5 and 6 letters long; as words, they occur in 9 and 12 files under `prisma/` on main. The quoted source is the TASK-051 doc comment at `prisma/tests/catalog/tenant-keys.ts:75` in `b34f954e` (branch `feat/TASK-051-guest-capable-tables-atomic-claim`, superseded by the v2 squash, not on main). The emulation reports that origin too, which is the positive control.

| Fingerprint (baseline line) | Commit | First-parent diff | Rule on the line | Line content |
|---|---|---|---|---|
| `d7585e78…:docs/sdlc/DECISIONS.md:generic-api-key:7697` (38) | main, D-ORCH-147 triage | added (hunk of 15 lines); first parent `966687bd` has no such line | reported, 1 match; no stopword or allow-list | hash `429e5a9b7e2a5977`, 325 characters: the D-ORCH-147 bullet that names the original hit and quotes the doc comment (keyword, comma, the backticked pair) |
| `ed156913…:.claude/agent-memory/security-analyst/project_p5_task051.md:generic-api-key:23` (39) | main, TASK-034 brief notes; the file is new in this commit | added (hunk of 39 lines) | reported, 1 match | hash `edfa1d98855e9ec4`, 225 characters: my own memory note quoting the same phrase in the same shape |
| `c33e5e92…:docs/sdlc/DECISIONS.md:generic-api-key:7697` (45) | TASK-044 merge, parents `cbd590db` and main `4ba683ad` | added (hunk of 1,961 lines); first parent lacks it | reported, 1 match; the only finding of the hunk | hash `429e5a9b7e2a5977` (equal to `d7585e78`) |
| `0ccdd009…:docs/sdlc/DECISIONS.md:generic-api-key:7697` (47) | 040-B merge, parents `a4aadd2e` and main `4ba683ad` | added (hunk of 2,496 lines) | reported, 1 match; the only finding of the hunk | hash `429e5a9b7e2a5977` |
| `aade2672…:docs/sdlc/DECISIONS.md:generic-api-key:7697` (49) | 041-B merge, parents `12b8a10a` and main `3d54cef8` | added (hunk of 2,216 lines) | reported, 1 match; the only finding of the hunk | hash `429e5a9b7e2a5977` |

Line hashes are SHA-256 prefixes of the whole line. The merge parents and the branch heads that hold each merge match the comments in the baseline file (lines 41 to 49) and D-DEVOPS-002.

## 3. Can these lines widen the baseline?

No.

1. **Shape.** Each new line matches `BASELINE_LINE` (`gitleaks-full.mjs:41`): a 40-hex commit, a path with no colon or white space, `generic-api-key`, and a positive line number. `validateBaseline` stops the scan before anything is mounted if a line is commit-less, if there is a duplicate, or if the count differs from `BASELINE_COUNT`. A commit-less line is gitleaks' "global" `path:rule:line` key, which silences every commit.
2. **Matching.** gitleaks v8.30.1 looks up a finding's `commit:file:rule:line` key and its global `file:rule:line` key in a map, as exact strings. There is no prefix or wildcard. This was proven on the real image in PR-0025 and PR-0045: other commits, shifted lines, abbreviated SHAs and commit-less mutations all stay reported.
   - A key whose commit is a SHA covers exactly one line of one immutable commit's first-parent diff.
   - On each of these five lines the rule finds exactly one match, the known value (§2).
   - No later commit can take the same key.
3. **Pins.** `BASELINE_COUNT = 22` (`gitleaks-full.mjs:46`). The sec-static case `[PR25-SEC-01]` (`sec-static.test.ts:163`) pins:
   - 22 lines, all unique;
   - the set of 8 commit prefixes;
   - 15 `openapi.yaml` lines;
   - the 2 main lines and the 3 merge lines verbatim.

   The 17 old lines are byte-identical to main's. A swapped line either changes a pinned value or stops suppressing a live main finding, which turns the int test's 0-finding case red.
4. **No allow-list change.** `.gitleaks.toml` is not in the diff, so no path, commit or regex allow-list is added. Lane A's range scan never reads this file and is unaffected. For lane A, the same three merges are handled by PR #88 (D-DEVOPS-003), which needs its own record.
5. **Which baseline lane B reads today.** `gitleaks-full.int.test.ts:27-29` reads the baseline and `.gitleaks.toml` of HEAD, with the `BASELINE_COUNT` of HEAD's own script. In lane B, a branch's own baseline is therefore what gets tested. The control against a PR widening its own list remains what it was: the owned path plus a security record (D-ORCH-013 residual). This record is that control for #85.
   - The ref-bound runner (`gitleaks-full.mjs --ref {base}`) is `planned` in `tools/quality/required-suites.json` on main and on #85, so lane B does not run it.
   - Code review R1-m1 (exit 2 when the count and the ref's baseline disagree) is right for that runner once it is activated. Today it does not happen. #85's own lane-B int test should give 0 findings with 22 lines and 1 with 21. A branch without #85 shows the PR080-SEC-07 findings class (2 or 3 findings), which D-ORCH-172 class (1) already covers, not exit 2.

## 4. Is 22 enough? Sweep and range scans

- **Sweep.** I checked `git log --all` (every ref and worktree HEAD; 1,663 commits, first-parent diffs, dot-env excluded) for commits whose diff adds a line containing the value:
  - **Main.** Flagged: `d7585e78` and `ed156913`. Six other main commits add the value in contexts the rule does not match (PR-0083 records, memory notes, `DECISIONS.md:7741`).
  - **Flagged, off main.**
    - The three merges of this PR.
    - The squashed-PR unions `05e1e9da` (#83), `22f69a82` (#82) and `2805c809` (#81). Their PRs are merged, and they are in no open branch's ancestry.
    - `b34f954e`, the superseded TASK-051 branch.
  - **Not flagged, off main.** The TASK-034 merge `1a0cdeaf` and the TASK-045 merge `ff1489ff` carry the reworded text, or the value in unflagged contexts.
- **Rule-level ranges** (faithful emulation, each with its control):

  | Range | Commits | Findings |
  |---|---|---|
  | `33262314 ^origin/main` (TASK-044) | 7 | 1: `c33e5e92…:7697` |
  | `9d1687b1 ^origin/main` (040-B PR1) | 7 | 1: `0ccdd009…:7697` |
  | `214ec79b ^origin/main` (041-B) | 15 | 1: `aade2672…:7697` |
  | `7b7263f8 ^1a2b9d7d` (main since the reword, includes the code-review records and the session-C memory commit) | 37 | 0 |
  | `72249e40 ^1a2b9d7d` (this PR) | 2 | 0, and 0 hits with all 221 rules |

- **Real image.** The JUnit carries counts only.
  - Lane B `20261121T1605Z_3c4d9a6` (main ancestry) reported 2 findings over the 17-line baseline.
  - Lane B `20261121T1512Z_3326231` (TASK-044) reported 3.
  - The emulation names exactly those 2 and 3. The same emulation reproduced 18 of 18 real-image findings over a 610-commit ancestry in TASK-051 round 1.

## 5. Findings

| ID | Severity | Title |
|---|---|---|
| PR85-SEC-01 | INFO | Branch-only fingerprints in the main-history baseline need a retirement point |
| PR85-SEC-02 | INFO | Provenance comment names the wrong reword commit; the value is still quoted on main |

### PR85-SEC-01 (INFO): branch-only fingerprints in the main-history baseline need a retirement point

- **CWE:** CWE-1164 (Irrelevant Code). **OWASP:** A05:2021 Security Misconfiguration (allow-list hygiene).
- **Where:** `tools/quality/gitleaks-baseline.txt:45`, `:47`, `:49`; `tools/ci/sec-static.test.ts` (the exact three-line assertion and the prefixes `0ccdd00`, `aade267`, `c33e5e9`); `BASELINE_COUNT` at `gitleaks-full.mjs:46`.
- **Description:** D-SECPR040-02 item (1) kept branch commits out of this list. The baseline records main's history, and a branch line stays in an exact, count-pinned list for good. #85 adds three branch-only merge commits.
- **Ruling:** accepted for these three, as an exception to D-SECPR040-02 item (1).
  - `0ccdd009` and `aade2672` are pushed, and `c33e5e92` is bound by TASK-044's records.
  - The alternative, a v2 squash supersede of each branch, re-opens three record chains in flight.
  - An exact key on an immutable commit is inert everywhere except that commit.
- **Residual:** the lines never retire by themselves.
  - Once TASK-044, 040-B PR1 and 041-B are squash-merged, the lines match nothing on any gated ancestry.
  - Once PR #88 lands, they duplicate its `.gitleaks.toml` tables, because gitleaks-full reads that file too.
- **Exploitability / impact:** none. A key can match nothing but its own line (§3). Hygiene only: the list stops being "main's history", and a later reviewer has to re-derive why.
- **Remediation** (devops-engineer; concurs with code review R1-n3):
  - Remove the three lines and the matching pins (count 22 to 19, prefix set, the three-line assertion) in the first baseline-touching PR after each of the three PRs is squash-merged or closed, with its merge commit not an ancestor of main (the D-SEC-PR45-01 lifetime rule).
  - If TASK-044 redoes its union after `1a2b9d7d` (D-ORCH-168 route (a)), its line goes at the same time.
  - No further branch-only line goes into this file without a security ruling.
- **Verification:** sec-static pins 19 exact lines. The int test on main gives 0 findings with the full list and 1 with line 1 dropped.

### PR85-SEC-02 (INFO): provenance comment names the wrong reword commit; the value is still quoted on main

- **CWE:** CWE-1116 (Inaccurate Comments). **OWASP:** A05:2021 Security Misconfiguration (allow-list provenance).
- **Where:** `tools/quality/gitleaks-baseline.txt:36`.
- **Description:** the comment says both quotes were reworded on main in `1a2b9d7`. `1a2b9d7d` changed only `docs/sdlc/DECISIONS.md`. The memory-file quote of `ed156913` was reworded in `aad3e90d` (the TASK-044 brief commit).
  - Separately, the value is still present in prose on main (`7b7263f8`): 8 occurrences in 6 files. These are the two PR-0083 records, three memory notes (two of them mine) and the PR-0085 code review.
  - None matches the rule (0 findings over `7b7263f8 ^1a2b9d7d`).
- **Exploitability / impact:** none today. An edit that puts a rule keyword and a separator (`,`, `:` or `=`) just before the value would bring the class back. Every branch's next merge of main would then carry it.
- **Remediation:**
  - Correct the comment at the next baseline edit, with PR85-SEC-01.
  - Describe the value and never quote it (PR13-SEC-11; D-ORCH-168's wording, "a child-equals-parent pair").
  - Owners reword their own notes at their next edit. I reword mine in this session; memory edits are not part of this commit.
- **Verification:** the faithful `generic-api-key` emulation over each new range gives 0 findings (as in §4).

## 6. Follow-ups, conditions on the binding, and routes

- **F1 (evidence, not a merge blocker).** Run `gitleaks-full.int.test.ts` once on `72249e40`, or on main after the merge. Expected: 0 findings with 22 lines, and 1 with 21 (D-CRCHORE-01 condition).
  - Any other result comes back to security-analyst.
  - This does not block merging because the change fails closed: a wrong key can only leave a finding reported.
- **F2.** PR #88 (D-DEVOPS-003, lane A route (c)) needs its own security record, with the D-SEC-PR45-01 condition 5 real-image before/after. That is a separate dispatch.
- **F3.** D-SECPOST-01 C1: once #85 and #86 are on main, the main lane-B run should no longer show the PR080-SEC-07 pair or the compose-stack case.
- **Binding.** A later branch commit that touches an owned path needs a delta round first. A squash merge without updating the branch keeps this record valid.
  - #86 and #87 also change `tools/ci/sec-static.test.ts`. If either lands first and #85 is then updated by a merge of main, `sec-static.test.ts` changes after `72249e40`, and main's checker voids this record. A merge-only round is then owed.
  - The three pairwise `git merge-tree --write-tree` results (#85 with #86, #85 with #87, #86 with #87) are clean.
- **Routes:**
  - devops-engineer: PR85-SEC-01 and PR85-SEC-02, with code review R1-n1 to R1-n3.
  - orchestrator: F1; F2 dispatch; D-ORCH-172 class (2) can be read as "not expected while the runner is planned".
  - Code review R1-m1: concurred, for the activated runner.

## 7. Not checked

- **The real gitleaks image on `72249e40`.** The dispatch asked for static review only (F1). The real-image behaviour of exact keys is taken from the PR-0025 and PR-0045 probes.
- **Refs that are not in this repository.** No fork was fetched.
- **Whether lane B's merged-coverage step runs the int test.** I read it from the JUnit of the runs named in §4.

| Item | Result |
|---|---|
| Critical / High / Medium / Low | 0 / 0 / 0 / 0 |
| Info | 2 (PR85-SEC-01, PR85-SEC-02) |
| Verdict | **PASS_WITH_FOLLOW-UPS.** The five lines are exact fingerprints of one non-secret prose value. They cannot silence anything else, and the pins hold them verbatim. F1 is evidence owed after the merge. |
