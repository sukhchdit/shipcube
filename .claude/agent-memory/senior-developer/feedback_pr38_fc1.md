---
name: pr38-fc1
description: PR #38 fc1 + PR #34 union (2026-11-14) - fixes as commits after a proven-pure merge, jest --selectProjects swallows paths, MSYS rev:path mangling, info/exclude verbatim, lock-queued gitleaks
metadata:
  type: feedback
---

PR #38 fix cycle 1 combined with the second-merger union. About 95 calls, done solo. The evidence run passed first time, and lane A behaved as expected on the first push.

**Why:** these traps recur on every union, fix cycle and evidence run.

**How to apply:**
- **Merge first, prove the merge, then add the fixes.** Commit the merge with only the conflict resolved. Run `union-proof.sh <merge>` (scratch `wave0/pr38fc1`): branch-only files equal the branch, main-only files equal main, and for overlapping files the merge-vs-branch delta equals main's delta. Then run typecheck, lint and listtests on the merge. Put each fix in its own commit afterwards, so the security merge-only round diffs the merge alone.
- **`jest --selectProjects unit <paths>` swallows the paths**, because the flag is variadic, so the whole project runs. Put the paths first, or drop `--selectProjects` for targeted runs.
- **Git Bash MSYS conversion can turn `rev:path` into `rev\path;...`** inside some command chains (`git show origin/main:.gitleaks.toml` failed with "ambiguous argument"). Prefix `MSYS_NO_PATHCONV=1` for `git show rev:path` and for `docker -v host:ctr`.
- **The verbatim D-SEC-PR23-02 line "`.git/info/exclude` is empty":** the shared file held only git's 240-byte template comments. Truncate it (`: > file`), log its byte count in the evidence script, and record the step as a decision.
- **`timeout 300 bash lock.sh acquire` dies silently while another agent holds the lock.** Put the Docker step (gitleaks) in a background script that waits with no timeout, then poll with `until grep 'GL DONE'`. Run gitleaks before the push: a finding would be permanent in history.
- `check-evidence`'s parked note names only the manifest's suite ("pending ID SEC-TC-29 is implemented in suite api"), even when unit tests carry the ID as well. Word the gate row after the note.
- The heredoc backslash trap struck again (see [[pr23-fc1]]). Any node script whose strings contain `\n` or regex escapes goes through Write into scratch.

Related: [[pr34-union]], [[lane-b-evidence-run]], [[task020b-lessons]], [[merge-main-pass]]
