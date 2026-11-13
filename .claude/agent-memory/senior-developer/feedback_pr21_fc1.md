---
name: pr21-fc1-lessons
description: PR #21 fix cycle 1 (2026-11-13) - re-merge recipe when main merges code after the gate, fetch/304 pitfall, commitlint range, docker.lock owner file, AT text vs RFC fixes
metadata:
  type: feedback
---

PR #21 fix cycle 1 was done solo: 15 findings, about 130 calls, and both full gate runs green. Lane A fast-lane passed on the first push, and only the expected security-record step was red.

**Why:** These traps cost time or nearly caused a bad push. Each one is generic to this repo's P5 flow.

**How to apply:**
- **Main merges a code PR after your full gate but before you push** (here PR #4). Keep one merge commit:
  1. `git branch tmp HEAD`.
  2. `reset --hard <PR remote head>`, then merge the new main, resolving conflicts as a union with a scratch `resolve.mjs`.
  3. Cherry-pick the fix commits.
  4. Prove the fixes are unchanged: diff the `+/-` lines of `git diff <oldmerge> <oldhead>` against those of `git diff <newmerge> HEAD` (identical), and check that the stat of `git diff <oldhead> HEAD` equals the stat of main's own range.
  5. Re-run the full gate (main brought code).
- **`commitlint --from <old PR head>` after a merge of main also lints main's commits.** Main's `docs(sdlc): PR #…` subjects fail `subject-case`. Use `--from <origin/main sha>`.
  - Gate the push with `&&`, not `;`. One push went out un-gated this way; it turned out fine.
- **Testing a 304 with Node `fetch`:** a conditional request gets `Cache-Control: no-cache` added unless you set one, and then Express's `req.fresh` is false. Send `'Cache-Control': 'max-age=0'` with `If-None-Match`.
- **docker.lock:** holders now write an `owner` file inside the lock DIRECTORY (TASK-011 uses `gates3 TASK-011 rN`). Acquire with `mkdir` plus an owner file. Release with `rm owner` and `rmdir`, and only when the owner file is still yours (scratch `fix/PR-21/gates.sh`).
- **A reviewer-asked RFC fix can contradict a merged Gherkin line.** Here the 405 `Allow` gained OPTIONS, but AT-US-007-02 says "GET, HEAD". Implement it, update the test title, keep one revert point (`allowHeader()`), and route the one-line AT text change to product-manager in the PR comment.
- **Express 5 layers keep no mount path.** To walk a composed app, probe each path-mounted router layer with `layer.match(candidate)`, require `layer.path === candidate`, and require no match when any one segment is replaced by a probe (this rejects `/:x` and `/*rest`). Walk `app.router`.

Related: [[merge-main-pass]], [[lane-a-pr-hygiene]], [[batch-010-017-lessons]]
