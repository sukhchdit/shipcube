---
name: task034-fc3
description: TASK-034 fix cycle 3 (D-ARCH-238, 2026-11-21) - local main ahead of origin/main, never-pushed branch with upstream origin/main, package copies under reports/ break repo scanners, gitleaks base must be the main tip
metadata:
  type: feedback
---

- **Local main can be ahead of origin/main** (the orchestrator commits docs on the main checkout and does not push). When
  the ruling text a test reads (a data-model fence) exists only there, merge origin/main first, then the local `main`
  SHA as a second docs-only merge, and prove each with `git diff --raw <merge>^1 <merge>` vs main's own raw diff.
- **A task branch may never have been pushed** and may track `origin/main` as upstream (`git rev-parse @{u}` shows it).
  `git ls-remote origin refs/heads/feat/TASK-xxx*` first; push with an explicit `HEAD:refs/heads/<branch>` refspec, then
  `git branch --set-upstream-to=origin/<branch>`. A bare `git push` there would target main.
- **Never copy a package into the worktree** (even git-ignored `reports/`): `tools/ci/check-install-flags` scans every
  `package.json` it finds and failed on a PGlite copy. Import PGlite from `node_modules/@electric-sql/pglite/dist/index.js`.
- **gitleaks range:** `<old branch head>..HEAD` with `--diff-merges=first-parent` still lists every main commit the merge
  brings (128 commits, 2 known main-wide hits). Use the origin/main tip as base and check "N commits scanned" equals
  `git rev-list --count base..head`.
- **commitlint:** a body line shaped `Token: text` (`F8: …`, `D-TASK034-15: …`) starts the footer (trailer pattern), so
  later lines warn `footer-leading-blank`; write `F8 (D-ARCH-236): …` instead. Run `commitlint --edit <file>` before committing.
- **Fix cycle at full size in one session worked** because nothing heavy ran locally: PGlite probes for the SQL, unit
  fakes for both refusals, int cases left to lane B, npm ci under docker.lock in a background script started first.

**Why:** each item cost a retry in this cycle; the never-pushed branch would have pushed to main with a plain push.
**How to apply:** every merge-main pass, first push of a branch, and commit body with decision lists.
Related: [[feedback_merge_main_pass]], [[task034-fc2]], [[feedback_task051_fc1]]
