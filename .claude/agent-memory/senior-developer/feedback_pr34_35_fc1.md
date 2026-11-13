---
name: pr34-35-fc1
description: PR #34/#35 fix cycle 1 (2026-11-13) - stray failed run dirs from reaped heavy runs, Edit/Write turn \u2028 escapes into literals, merge-commit subjects vs commitlint, jest --listTests short-path trap, lock held by Docker-hung agents
metadata:
  type: feedback
---

PR #35 (tools/quality traceability) and PR #34 (test harness) fix cycle 1. One opus test-engineer took the leakage scanner (23 tool calls, 26 mutants killed, clean report); I did jest config, eslint seam policy, fake clock, factories, heavy.mjs and all of PR #35.

**Why:** these traps cost time in this cycle and recur.

**How to apply:**
- **Stray untracked run dir in a worktree** (`docs/05-quality/tests/runs/<stamp>_<sha>/`, verdict FAIL) = an earlier heavy run that finished after a Docker hang. Move it to scratch (do not commit it) before any gate; porcelain and check-evidence fail otherwise.
- **Edit/Write tools decode `\u2028` (and `\u00a0`) escapes into raw characters.** In a regex literal that breaks SWC parsing ("Invalid regular expression: missing /"). Fix with a scratch node script using `String.fromCharCode`; verify with a node scan for raw U+2028/U+00A0. Tell specialists the same.
- **Merge commit subjects:** `git merge --no-edit` gives "Merge remote-tracking branch ..." which commitlint ignores; amending to `merge: ...` fails type-enum in a local `--from origin/main` run. Lane A lints only the PR title, so it is cosmetic, but keep the default subject (add the trailer with `--amend -m <same subject> -m <trailer>`).
- **`jest --listTests` in a scratch extract prints long paths** (C:\Users\<name>\...) while the scratch path is the 8.3 short form, so `path.relative` filters miss. Grep the raw output instead.
- **Node `path.posix.matchesGlob`** (stable in Node 24) supports braces and `**`; good enough for a unit test that pins which Jest project runs which file (`tools/repo/jest-projects.test.ts`).
- **docker.lock can be held for 40+ min by an agent whose integration run waits on a hung Docker.** Unit-only evidence still waits for it per protocol; prepare the other PR meanwhile. After Docker came back, a pr32-fc2 evidence script grabbed the lock first.
- `quality:trace` output: `--out` now must be inside the root and outside the runs tree (default `reports/ac-trace.json`); delete `reports/` after ad-hoc runs (`/reports/` ignore lands with PR #32).

Related: [[batch-276-277]], [[lane-b-evidence-run]], [[pr32-fc1]]

**Later in the same cycle:**
- The first real execution of a Docker-bound test written during a Docker outage found a product bug (query counter `measure()` awaited a lazy PrismaPromise outside the AsyncLocalStorage scope). Never treat "int test not executed" as low risk; budget a fix plus a second heavy run.
- Main moved WITH code (PR #35 and #36 merged) while PR #34's evidence was unpushed: reset to the fix commit, re-merge, re-run gates and heavy (about 40 min with lock waits). Check `git diff --name-only <old base> origin/main` for non-docs paths right before every evidence push.
- Main's `string-redaction.test.ts` "< 50 ms" absolute-time case flakes under parallel host load (3 of 6 runs). Re-run heavy once; route the test to a ratio form.
