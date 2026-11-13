---
name: pr20-fc2-union
description: PR #20 fc2 (2026-11-13) - PR #21 union merge traps (interface merging, routePrefix auto-keep), re-merging main 3x with resolution reuse, docker.lock starvation, mutation-driven test gaps
metadata:
  type: feedback
---

PR #20 fix cycle 2 was done solo (no specialist): the PR #21 union, R2-m1/m2, PR20-SEC-13 items 1-3, PR21-SEC-07 (b) and the NITs, about 170 calls. Main moved three times (docs, docs, then TASK-011 code), so the merge was redone three times while keeping one merge commit.

**Why:** these traps are generic to the merge-second PR of a pair, and to long Docker queues.

**How to apply:**
- **Auto-merge hides semantic conflicts.** Two branches that each add an `export interface X` give TWO declarations, which TypeScript silently merges. Grep for duplicate declarations after every union. A "clean" side line (`routes.use(P, routePrefix(P), api)`) can survive the merge and break the other PR's checker. Mutation-prove it: restore the old form and expect the drift test to fail.
- **Reuse the resolution when main moves:**
  1. `git branch tmp HEAD`, then `reset --hard <PR remote head>` and `merge --no-commit <new main>`.
  2. `git checkout <old merge> -- <the hand-resolved files>`. This is valid only if main's new range does not touch those files; check with `git diff --name-only old..new -- files`.
  3. Prove the merge is a pure union: the `^[+-]` lines of `diff --cached <old merge>` equal those of main's own range.
  4. Cherry-pick the fixes and check that the fix-delta lines are identical.
- **When main brings code:** re-run the full gate. On main, `ci.yml` gained a lane B evidence step: archive `tools/quality` from the base, then run `check-evidence.mjs --base --head --event pull_request`. It passes while no suite is `active`.
- **docker.lock starvation:** with 15 s polling, other agents won the lock 3 times; the wait was about 50 min. Never wrap a lock-waiting script in a short `timeout`: it was killed before it acquired the lock. Start Docker steps early, in the background.
- **Under host memory pressure (2.6 GB free),** the parallel `test:api` hit 5 s timeouts and ECONNRESET, and `prerender.int` hit a V8 OOM in its build child. Run `test:api -- -i` in the gate. Coverage re-runs every project, which is the evidence for a flaked integration suite.
- **Mutation runs find gaps.** Script them: apply one mutation at a time, run the suites, restore in `finally`. One survivor was a lint policy's `noneOf` (no positive fixture where a logging file imports pino or a sibling). Another was the `#` reset, fixed by changing the behaviour.
- **An "it passes" free-text test can be vacuous.** `util.inspect(req)` is cut at the 8 KiB cap before its URL and header parts. Probe what the redacted field actually contains. A depth-0 inspect exposed a real `search:`/`query:` leak.
- **Do not wrap `Reflect.get(...)` inline in a test:** it returns `any` (`no-unsafe-assignment`). Assign it to an `unknown` const first.

Related: [[pr21-fc1-lessons]], [[merge-main-pass]], [[lane-a-pr-hygiene]], [[batch-010-017-lessons]]
