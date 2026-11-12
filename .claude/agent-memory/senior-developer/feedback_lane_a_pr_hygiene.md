---
name: lane-a-pr-hygiene
description: Lane A traps on PR branches (since 2026-11-13) — gitleaks scans the whole PR commit range so a pushed test-literal "password" is permanent; merging main voids the security record; main moves mid-cycle
metadata:
  type: feedback
---

Before pushing any commit to a PR branch, run gitleaks locally on the new commits. Generate every test password at run time (`randomBytes`), never as a literal.

**Why:** In PR #13 fix cycle 1 (2026-11-13), `const PASSWORD = 'pw-0123456789';` in a unit test tripped gitleaks `generic-api-key`. Lane A scans `base..head` of the PR. Fixing the line in a later commit does not help: the commit stays in the range, and there are no force pushes. The only remedy is a narrow allowlist (commit + path + line) committed to `.gitleaks.toml` on **main**, because lane A reads it from the base ref. That needs the orchestrator and security-analyst, so lane A stayed red.

**How to apply:**
- Run this before the push, from the worktree:
  `docker run --rm --network none -v "<git-common-dir>:/repo/.git:ro" -v "<wt>/.gitleaks.toml:/config/gitleaks.toml:ro" -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/repo <GITLEAKS_IMAGE from ci.yml> git /repo --config /config/gitleaks.toml --log-opts="--diff-merges=first-parent origin/<branch>..HEAD" --ignore-gitleaks-allow --redact --no-banner --exit-code 1 -v`
  - Prefix it with `MSYS_NO_PATHCONV=1` and convert paths with `cygpath -w`.
  - `gitleaks dir` takes ONE path. Given several, it scanned the container root.
- `check-security-owned-paths` condition (d) is a plain `git diff <record-head> HEAD`. Merging main voids the round-1 record whenever main changed an owned path that the PR also changes (here `package.json` and `package-lock.json`). Expect the record step to need a new security record after every merge-main that touches those files. Say so in the PR comment rather than trying to fix it in code.
- Main moved three times in one cycle (docs, then PR #9 code, then PR #12). Before each push, run `git fetch` + `merge-base --is-ancestor`. A code merge means re-running the gates. PR #9 published `RUNTIME_DATABASE_URL_PARAMS` (the single DATABASE_URL allow-list), which superseded the export I had added. Check main for the shared helper again right before pushing.
- The TASK-006 health tests (`apps/api/.../health/router.test.ts`, `apps/worker/.../health/server.test.ts`) hit the 5 s Jest timeout once under host load. A re-run passed.

Related: [[merge-main-pass]], [[p5-dispatch]]
