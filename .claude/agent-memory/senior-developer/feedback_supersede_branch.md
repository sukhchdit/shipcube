---
name: supersede-branch
description: Recipe for a D-ORCH-017/018 superseding PR (fresh branch carrying a tainted PR's net diff) and the lane A record trap it hits
metadata:
  type: feedback
---

To supersede a PR whose pushed range is tainted (for example gitleaks on a merge commit), work from the approved diff, not from the old branch. PR #11 → #18 (2026-11-13) took about 45 calls, and the full gate plus lane A matched on the first push.

**Why:** The commits stay in the PR range for good, because force pushes are not allowed. Only a fresh ancestry clears them, and reviewers want tree-equality proof instead of a re-review.

**How to apply:**
- Steps:
  - `git worktree add -b <new-name> ../X origin/main`, then `git branch --unset-upstream`, so the branch does not track main.
  - `git diff <old-merge-base> <old-head> --binary > scratch.diff`, then `git apply --index --3way`.
  - "Falling back to direct application" is normal for new files. Only real overlaps conflict.
- Commit split:
  - Commit 1 is the net change with each conflicted file left at main's version (`git checkout origin/main -- <file>`).
  - Commit 2 is the resolution, saved to scratch first.
  - Say in the PR that commit 1 alone is not green.
- Proof for reviewers:
  - Main-only files: `git diff origin/main HEAD -- <main-only files>` is empty.
  - Old-PR-only files: `git diff <old-head> HEAD -- <PR-only files>` is empty.
  - No old commit is an ancestor (loop `merge-base --is-ancestor`).
  - `git log --merges` over the range is empty.
- **Security record trap:** `check-security-owned-paths` looks for `docs/05-quality/security/PR-00NN-*.md` with the **new** PR number. A supersede round appended to the old PR's record does not satisfy it. Tell the orchestrator that security-analyst must write a `PR-00NN` record, or a file that points to the old one, naming the new head. Run the checker locally with `--pr <new N>` to confirm.
- To replicate the base-ref fixture step locally, extract the step's `run:` block from ci.yml verbatim into a scratch script. Run it with `RANGE_BASE`, `GITHUB_STEP_SUMMARY` and `LINT_FIXTURE_MODE=no-weakening` set. It restores the worktree afterwards (check porcelain).

Related: [[lane-a-merge-pitfalls]], [[lane-a-pr-hygiene]], [[merge-main-pass]]
