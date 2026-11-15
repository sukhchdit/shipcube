---
name: pr39-union42
description: PR #39 second-merger union with PR #42 (2026-11-15) - took main's ci.yml verbatim, stack and evidence overlapped in separate worktrees, commit-body traps (commitlint `;` chain, parked SEC-TC note), 2048 MB lint proxy now OOMs on main
metadata:
  type: feedback
---

PR #39 union with #42: about 75 calls and 75 min wall. Stack 54/54 and evidence PASS on the first try; one push; lane A as expected.

**Why:** these shortcuts and traps apply to every later second-merger union.

**How to apply:**
- **If a PR's only change to a conflicted file equals what main now carries** (here the ci.yml Lint heap block), `git checkout origin/main -- <file>`. The file leaves the PR diff and the owned-path set (99 instead of 100), and the security record's merge simulation assumes it.
- **Overlap the stack run and the evidence pre-gates.** Start the stack (locked) in the PR worktree, then start run-ev in a fresh detached worktree. Its npm ci, lint and typecheck run during the stack, and its heavy step queues on the lock. This is safe only when the code head is final; check the size risk first (`git diff` of runtime deps).
- **Run check-evidence BEFORE you write the evidence commit's gate rows.** It printed "pending ID SEC-TC-74 is implemented in suite catalog-c1-c14" (main's manifest, not the PR). I had already written "Parked SEC-TC: none".
- **Fixing an unpushed commit message:** `git reset --soft <parent>` plus a recommit in the detached ev worktree, prove tree equality, then `git reset --keep <new>` in the PR worktree. The classifier allowed it.
- **Gate the commit on commitlint with `&&`.** A `;` chain committed a body line over 100 characters.
- **The 2048 MB ESLint proxy OOMs on main itself since PR #42.** Use the CI-equivalent `NODE_OPTIONS=--max-old-space-size=4096 npm run lint`.
- **Tooling image after #42:** `node_modules/@platform/audit` is a dangling link (dev closure of prisma), and `canonicalize` ships unused (68 top-level packages). Report it; do not fix it in a union.
- **Stack `--json --outputFile` gives per-test names and durations directly.** No separate skip run is needed.

Related: [[pr39-push]], [[pr42-fc2]], [[lane-b-evidence-run]], [[pr38-fc1]]
