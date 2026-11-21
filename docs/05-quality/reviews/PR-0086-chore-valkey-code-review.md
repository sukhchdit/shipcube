# Code review: PR #86 Valkey back on the harness digest, Dependabot ignore for Valkey majors (D-SECPOST-01 O-1), round 1

| Field | Value |
|---|---|
| PR | #86, branch `chore/main-red-gitleaks-valkey-baseline`, head `72e3dc9f` (pushed; `origin` equals the head), worktree `Shipqube-CHORE-VALKEY` (clean except the untracked lane-B run folder `docs/05-quality/tests/runs/20261121T1629Z_72e3dc9/`) |
| Commit | `72e3dc9f` build(compose) on main `88fd7360`; `88fd7360..main` is `docs/` and `.claude/` only; `git merge-tree --write-tree main 72e3dc9f` is clean |
| Diff | `compose.yaml` (1 line), `.github/dependabot.yml` (+8), `tools/ci/sec-static.test.ts` (+2) |
| Bindings read | D-SECPOST-01 O-1 (`docs/05-quality/security/POST-MERGE-2026-11-21-security-review.md` lines 261-265), D-ORCH-170, D-DEVOPS-001; ADR-0001 / CLAUDE.md §2 ("BullMQ 6 on Valkey 8"); `tools/quality/suite-runners.json` `testcontainers_images`; `tools/compose/compose-stack.test.ts:92-96`; the PR25-SEC-02 Dependabot block of `sec-static.test.ts`; `.orch/laneb-queue/queue.log` |
| Reviewer | code-reviewer, 2026-11-21 (orchestrator session C dispatch; D-CRCHORE-01) |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: compose.yaml's redis image is byte-for-byte the Testcontainers harness entry and the pre-#49 line, so
         compose-stack.test.ts:94-95 holds again. The ignore is valid Dependabot syntax, in the form the npm block already
         uses and the sec-static parser already reads. One MINOR: digest-only and 8.x minor bumps still desync compose
         from the harness (the #49 class minus majors). One NIT.
```

The branch name still says "gitleaks", but the gitleaks half was rightly left to #85 (D-DEVOPS-001), so nothing here touches the baseline, its count or its pins.

## 1. What I verified myself

Dispatch constraints: git, grep and reads only. No npm, Jest, Docker or Node.

| Check | How | Result |
|---|---|---|
| Valkey pin | `compose.yaml:44` at `72e3dc9f`, against `suite-runners.json:6` and `7db3b8b5^:compose.yaml:44` (the parent of Dependabot #49) | All three are `valkey/valkey:8.1-alpine@sha256:2602ace2be6569bc2bbb06f873776516ab9089821525be34f4305c67eb9db02a` |
| What #49 changed that stays | `git diff 7db3b8b5^ 72e3dc9f -- compose.yaml` | Only `amazon/aws-cli` 2.36.0 -> 2.39.7 remains (a minor bump with no harness pin; D-DEVOPS-001 keeps it, and I agree) |
| Dependabot syntax | `.github/dependabot.yml:71-78` | `ignore:` sits at the update level beside `groups:`, `dependency-name: valkey/valkey` is the compose image name, and `update-types: ['version-update:semver-major']` is a valid value. It is the same shape as the existing npm `typescript` ignore (line 22-25). Dependabot applies ignore before grouping, so the rest of `compose-images` is unaffected |
| sec-static pin | `sec-static.test.ts:316` | The parsed docker-compose entry gains exactly the ignore; the `yaml-subset` parser already handles the identical npm list-of-maps form. The D-ORCH-027 test (`cooldown` x4, the typescript regex) is untouched |
| Light run | `.orch/laneb-queue/queue.log` 16:29:21Z | `LIGHT Shipqube-CHORE-VALKEY rc=0 (sec-static + compose-stack)` |
| Lane B | `20261121T1629Z_72e3dc9` (D-DEVOPS-001) | FAIL: the 2 gitleaks-full cases with exactly the 2 PR080-SEC-07 fingerprints #85 adds, plus an `open-queue.test.ts` 5 s timeout outside the diff under host load (1,427 s unit). `compose-stack.test.ts` green. A re-run is queued (queue.log 16:55:45Z) |
| New gitleaks hits | over-approximating grep of the generic-api-key rule over `88fd7360..72e3dc9f` | One candidate, the Valkey ignore line of sec-static (the image name followed by the update-types key): a letter-only value, dropped by the rule's `^[a-zA-Z_.-]+$` allow-list. `compose.yaml`'s `valkey/valkey:8.1-alpine@` cannot end a match (`@` is not a terminator), and the same text is already on main |
| Conflicts with #85 and #87 | `git merge-tree --write-tree` pairwise and of all three | Clean. In `dependabot.yml` #87 inserts at line 56 (docker block) and #86 at line 70 (docker-compose block); in `sec-static.test.ts` the hunks are at 160 (#85), 305 (#87) and 314 (#86). The union carries both `ignore` keys, each in its own ecosystem |

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `.github/dependabot.yml:71-78`; `tools/quality/suite-runners.json:6`; `compose.yaml:44` (also `postgres:18`) | The ignore stops majors only. Dependabot `docker-compose` still proposes a new digest for the same `8.1-alpine` tag (Alpine rebuilds) and 8.x minor bumps, and likewise for `postgres:18`. `suite-runners.json` is not a file Dependabot edits, so each such PR desyncs compose from the harness again and `compose-stack.test.ts:94-95` goes red: the #49 class without the major. The comment's "must move the harness pin in the same PR" names a manual step with no mechanism behind it. The guard is fail-closed (compose-stack is in the unit project, so lane A runs it), but #49 shows that Dependabot PRs get merged while hosted CI is blocked. | devops-engineer follow-up, not a merge condition. Either (a) ignore `valkey/valkey` and `postgres` fully in the `docker-compose` block and bump harness + compose together in a task PR, or (b) make one file the single source (the harness reads the compose digests, or the reverse). Record the choice in a D-DEVOPS entry. |
| R1-n1 | NIT | `.github/dependabot.yml:8-10` | The header still lists only the typescript ignore and says "Other majors stay visible for review on purpose". With #86 (and #87) that is incomplete. | One header bullet that names the Valkey (and Node) major ignores. Whichever of #86 and #87 merges second can carry it, or a later chore. |

## 3. Merge conditions

1. Merge after #85 (section 4). Textually any order is clean; the order only matters for lane-B evidence.
2. Lane B: the queued re-run must be read correctly. On the current head (no #85 in its ancestry, base main before #85) the expected reds are the 2 PR080-SEC-07 fingerprints only. Once #85 is on main, a lane-B run of this head stops `gitleaks-full` with exit 2 (`holds 22 fingerprints, exactly 17 expected`, PR-0085 R1-m1 (b)). A clean record needs a merge of main (with #85) into this branch first. Otherwise D-ORCH-170's "PASS except PR080-SEC-07" reading of `20261121T1629Z_72e3dc9`, plus the load timeout, is what this PR merges on.
3. Commit the lane-B evidence folder (currently untracked in the worktree) or the re-run's.
4. security-analyst confirms O-1 closed (it is their observation).

## 4. Merge order for #85, #86, #87

- Recommended: **#85 -> #86 -> #87** (#86 and #87 commute).
- No rebase-by-merge is needed for the squash merges. `git merge-tree` of main with each head, of every pair and of all three is clean.
- A merge of main into #86 and #87 is needed only to produce a fresh lane-B record after #85 lands (see condition 2). The same applies to every other open branch (TASK-034, 040-B, 041-B, 044, 045 ...): after #85, merge main before the next lane-B run.

## 5. Good

- The fix restores the exact pre-#49 line instead of choosing a new digest, so no new image enters the stack.
- The comment ties the Valkey 9 path to a superseding ADR that moves harness and compose together.
