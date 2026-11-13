---
name: pr20-fc3
description: PR #20 fix cycle 3 (2026-11-13) - second-merger union after #24/#26/#30/#27, ReDoS growth test, record redaction, owned-paths --report-only refusal, gate+evidence lock chaining
metadata:
  type: feedback
---

PR #20 fc3 was done solo in about 95 calls. Gate and evidence were both green on the first run; lane A came back as expected.

**Why:** these traps recur for any merge-second PR and any final fix cycle that has to produce evidence.

**How to apply:**
- **Shared refs move under you.** Worktrees share `refs/remotes`, so another agent's fetch moves `origin/main` while you are mid-merge. Before comparing anything to "main", check what was actually merged with `cat $(git rev-parse --git-path MERGE_HEAD)`.
- **Keep the merge commit union-only.** Park NIT edits in scratch, restore the union version, commit the merge, then re-apply the NITs as fix commits.
- **`check-security-owned-paths --report-only` is refused** (exit 2) once the base ref contains the check. Don't count it as a gate failure in a script that only starts evidence when "all gates pass". That bug cost me a separate evidence run.
- **Chain the evidence behind the gate.** Queue a second lock-waiting script (10 s poll) while the gate still holds docker.lock; it picks the lock up right after release.
- **Union-proof for owned paths.** Compare the sorted `^[+-]` lines of `git diff <reviewed head> HEAD -- f` with those of `git diff <old base> origin/main -- f`; identical hashes mean the change is a pure union.
- **ReDoS fixes need a growth test, not an absolute bound.** Test 16x the input against at most 20x the time. Take the best of three medians of 5, batching calls so the small input runs for measurable time. Mutation-prove it: the old line measured 97-119x.
- **Sink camelCase vs recording logs.** `prisma/tests` cannot import the runtime logger, so its fake log records the sink INPUT (`partitionName`), not the snake_case line. Assert the Pino shape in an apps/api test instead.
- **Making a deps member required in PR #26** broke PR #20's own test callers (`{ ...deps, onDbError }` without `scopeClient`). tsc finds these; the auto-merge does not.
- **commitlint `--from origin/main`** also lints earlier-cycle commits. Attribute any warnings per commit before writing them up.

Related: [[pr20-fc2-union]], [[lane-b-evidence-run]], [[merge-main-pass]], [[batch-020-015-lessons]]
