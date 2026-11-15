---
name: pr54-evidence-push
description: PR #54 (TASK-020 020-D) evidence commit + single push after a usage-limit stop (2026-11-15) - union-needed check recipe, remerge-diff proof, nested node_modules cleanup
metadata:
  type: feedback
---

Committing a surviving PASS run and opening PR #54 took about 35 calls, with no surprises. Lane A came back as expected: fast-lane green, and only the security-record step red, so ci-gate showed BLOCKED.

**Why:** a resumed "commit evidence and push once" brief goes fastest with a fixed checklist.

**How to apply:**
- **Is a union needed?** Run these four checks:
  - `git diff --name-only <merge-base> origin/main` against `git diff --name-only origin/main...HEAD` (use `comm -12`); any overlap means a union.
  - `git merge-tree --write-tree origin/main HEAD` must merge clean.
  - The main delta must not touch `tools/quality` or the bootstrap tooling.
  - If all four pass, the evidence stays valid.
- **Prove that earlier main merges had no hand resolution** with `git show --remerge-diff --format= <merge>`: 0 lines means none. Cite it in the PR body.
- **check-evidence needs the run committed.** Commit it first (local only), then run the base-ref `cev.sh` with full SHAs. It prints rejections for many old runs; only the "Accepted run" line and the PASS matter.
- **Hostscan positive control:** write `os.homedir()` into a scratch file via node argv and scan it. The total must be greater than 0. Then scan the PR diff, the commit messages and the PR body file.
- **Run cleanup over every nested node_modules,** not just the root. The ev worktrees have node_modules in `apps/admin`, `apps/web`, `packages/carriers`, `prisma` and `tests/e2e`. First run `find <all nm dirs> -type l`, plain `rm` each link, and confirm 0 links remain. Only then `rm -rf`. Afterwards, verify porcelain shows only the run dir.

Related: [[lane-b-evidence-run]], [[pr39-push]], [[pr42-fc2]], [[task020d-resume]]
