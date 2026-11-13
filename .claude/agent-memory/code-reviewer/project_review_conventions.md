---
name: project-review-conventions
description: Where P5 code reviews are written, how PR worktrees are laid out, how to run Node in this repo during review, and what to do when the orchestrator restricts gate runs
metadata:
  type: project
---

P5 code reviews go to the MAIN repo at `docs/05-quality/reviews/PR-<nnnn>-TASK-<xxx>-code-review.md`, using the name the orchestrator dispatches. It is not the agent default `REVIEW-TASK-xxx-r<round>.md`. The file is not committed by the reviewer.

Contents:
- verdict block
- the verification I performed myself
- findings table (ID, severity, file:line, issue, required fix)
- deviation rulings
- follow-up closure
- merge conditions

Return a Handoff Report (`docs/sdlc/templates/HANDOFF.md`).

PR branches are checked out as sibling worktrees `..\Shipqube-TASK-xxx` with node_modules installed. Every node/npm/npx call needs `export PATH="$APPDATA/fnm/aliases/default:$PATH";`, because the system Node 20 fails on engine-strict.

Default: re-run lint, format:check, typecheck, test:unit, build and coverage yourself.

Exception: during parallel batches the orchestrator may forbid installs, builds, Docker and full suites because host memory is low (PR #5, 2026-11-12: "at most one targeted unit test file"). Then:
- run prettier on the changed files and the one most relevant unit test file;
- run cheap read-only probes, such as `tsx` scripts in the scratchpad that import the PR's functions;
- state in §1 of the review exactly what was not re-run and whose evidence you relied on.

**Why:** the orchestrator's dispatch briefs set these rules. Lane A/B CI did not exist yet (D-ORCH-004 bootstrap), so the reviewer is the independent gate.

**How to apply:** check the dispatch CONSTRAINTS before running anything heavy. See [[review-watchlist]] and [[scratch-copy-technique]].

**Merge-main delta check (PR #3 r4, PR #5 r3).** Prove the merge is a pure union by SHA, with no build:
- Get MB=`git merge-base P1 P2`.
- Use `comm -12` on `git diff --name-only MB P1` and `MB P2` to list the files changed on both sides. Usually that is only the lock.
- For each branch-only file, `git diff --quiet P1 M -- f`.
- `comm -23` on `git diff --name-only P2 M` minus the branch-changed files must be empty.
- The lock delta `git diff --text origin/main HEAD -- package-lock.json` must equal the branch's delta vs MB.
- Also run `gh pr view N --json statusCheckRollup`. An empty rollup means CI has not run on the head, which is a merge condition.
- Quickest proof (PR #9 r4): `git merge-tree --write-tree P1 P2`, then `git diff --stat <tree> M`. If the only output is conflict markers in the conflicted files, everything else is byte-identical to a clean re-merge, and `git show --cc M` shows the hand resolution.
- Delta conservation across several merges (PR #4 r4): file set of `main..HEAD` == union of the previous round delta (`MB..oldHead`) and the fix commits; for each non-fix file compare an md5 of the `^[+-]` lines of both diffs. Lock: parse `packages` maps and compare added/removed/changed sets. A lock marked binary in .gitattributes hashes equal trivially, so always use the parsed comparison for it.

**Supersede check (PR #18 r1, replaces PR #11).** Partition proof by SHA, no build:
- MB=`git merge-base origin/main OLD`. Old PR files = `diff --name-only MB OLD`; main delta = `diff --name-only MB origin/main`; overlap via `comm -12`.
- Old-only files: `git diff --name-only OLD NEW -- <files>` empty. Main-only files: `git diff --name-only origin/main NEW -- <files>` empty. File sets of `MB..OLD` and `origin/main..NEW` equal.
- Overlap file: `git merge-file -p main base old` and diff against NEW to isolate the hand resolution; extract case tables with awk and `cmp` them.
- Ancestry: loop `git merge-base --is-ancestor` over `git rev-list MB..OLD`; `git rev-list --merges origin/main..NEW` empty.
- CI: `gh run view <id> --log | grep "No-weakening run:\|rule new to the base"` gives the base-ref extras count.
