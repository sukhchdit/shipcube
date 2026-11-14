---
name: pr39-fc1
description: PR #39 (TASK-014) fix cycle 1, 2026-11-14 - 3 parallel opus specialists all reported; allow-list comment quoting a scanner false positive tainted the PR range; PR-body host-path leak; tooling closure and node_modules scan facts
metadata:
  type: feedback
---

PR #39 fix cycle 1 (2026-11-14) took about 110 of my own calls, plus 3 opus specialists in the same worktree with disjoint files: preflight 66, tools/ci 72, secret scan 47 tool uses. All three reported, helped by a common brief file (`wave0/t014fc1-common.md`) with a no-commit rule, the jest path-first pitfall and the lock protocol.

**Why:** two avoidable slips cost the most: a permanent lane A taint and a host-path leak in a PR body revision.

**How to apply:**
- **Before EVERY push, run the local gitleaks over the new range with full SHAs** ([[lane-a-pr-hygiene]]). This applies even to "comment-only" commits.
  - I quoted a scanner false positive in an allow-list comment (a `XSymbolKey = "pkg/path"` assignment). Main's `.gitleaks.toml` flags it as `generic-api-key`, and the pushed commit taints the PR range for good.
  - When documenting a false positive, name the identifier without `= "value"`.
- **Never build PR-body text from absolute paths with a regex inside `node -e` in Bash.** The backslash was stripped, so the split failed and the host path (with the OS user name) went into a PR body revision.
  - Before any `gh pr edit` / `gh pr comment`, grep the file for `Users` and the user name.
  - GitHub keeps the old revision; the author must delete it in the UI.
- **Jest `--verbose` through `npm run test:stack` printed no test names.** Get the per-test list cheaply: `JEST_STACK=1 jest --selectProjects stack --testNamePattern '^NO_SUCH$' --json`. Hooks are skipped when every test is skipped, so nothing builds. Pair it with the run's pass count.
- **Tooling closure facts:**
  - `prisma` and `@prisma/client` pull in `typescript` as an OPTIONAL peer, so prune-deps must skip `peerDependenciesMeta.optional`. This leaves the api/worker closures unchanged; I proved it over the lockfile.
  - The Studio/dev stubs need `--leaf`, because the hidden lockfile still lists the real packages' dependencies.
  - Empty `@scope` folders fool a `find -path '*/node_modules/@x'` check.
  - `debian:trixie-slim` ships `libssl3t64`, so the Prisma schema engine runs on the slim runtime.
- **Scanning node_modules** (segment rename plus a forced `--config`) found 0 hits in api/worker and 7 identifier false positives in the tooling image (effect, Prisma CLI). Triage with the pinned gitleaks JSON report (`--redact`); its Match field shows the key name.
- **Any code change after the evidence commit makes check-evidence stale, even a comment in `tools/docker`.** Re-run heavy, then the stack suite (`npm ci` in the evidence run swaps node_modules, so never run them concurrently).

Related: [[task014-images-compose]], [[lane-a-pr-hygiene]], [[supersede-branch]], [[p5-dispatch]]
