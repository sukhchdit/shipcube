---
name: pr80-unions
description: PR #80 union pass (2026-11-21) - shared origin/main ref moved under me twice, so merge messages named the wrong main; coordinator took over a worktree mid-run; check the parent SHA after every merge
metadata:
  type: feedback
---

PR #80 union pass over three branches (TASK-051, TASK-044, TASK-045): about 45 calls.

**Why:** worktrees share `refs/remotes/origin/*`. Another session's fetch moves `origin/main` between my fetch and my
merge. Here main went 3308474b -> 61c53b5e (#81, #82) -> 4ba683ad (#83, #84) within an hour, and the user merged PRs
with CI red (D-ORCH-162).

**How to apply:**
- Write the merge-message SHA from `git rev-parse origin/main` immediately before `git merge`. After merging, check
  `git log -1 --format=%P` and re-check `git ls-remote origin refs/heads/main` before you report.
- If main moved while the merge is still unpushed, run `git reset --keep <pre-merge head>`, merge again and cherry-pick
  the follow-up fix. Each lock change (#84 bumped 28 packages) means another `npm ci` + `deps:rebuild`.
- A coordinator can take over a worktree mid-run. A subagent cannot reply until handback, so stop touching the worktree
  and list what you changed in the final report.
- The brief-mandated subject `merge origin/main into <task> (...)` fails local commitlint (type-empty). PR CI lints only
  the PR title, so it does not block; say so in the report.
- AT-US-080-03 (guest-claim.int.test.ts) matches `attname = 'org_id'` exactly. idempotency_keys.scope_org_id does not
  need a NULLABLE_ORG_ID_SYSTEM entry.
- The generic proof script `preserve-proof` (file-by-file patch equality, falling back to +/- body lines when main
  moved hunks) took about 1 s per branch. Keep a copy in each task scratch folder.

Related: [[merge-main-pass]], [[pr39-union42]], [[task051-fc1]]
