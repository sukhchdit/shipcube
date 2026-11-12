---
name: scratch-copy-technique
description: How to mutation-test a PR (type errors, lint-rule probes) without touching the read-only worktree, plus junction and shared-scratchpad pitfalls and known false failures
metadata:
  type: reference
---

To run experiments without touching the review worktree:
1. Run `git -C <worktree> archive <sha> | tar -x -C <scratchpad>/<unique-dir>`.
2. Run `cmd //c "mklink /J <copy>\node_modules <worktree>\node_modules"` (junctions need no admin rights).
3. Run Jest directly: `node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects unit --testPathPatterns <name>`.

**Lint-config probes (PR #2):**
- Copy `tools/lint/lint-fixtures.mjs` into a small probe script that takes a probe root from argv.
- Write probe files under `<copy>/tests/fixtures/lint/probe/<root>/` (a miniature repository root, the same convention as the PR fixtures).
- The probe script calls `new ESLint({ cwd: root, overrideConfigFile: <repo>/eslint.config.mjs, overrideConfig: [disableTypeChecked, {projectService:false}, {settings:{'boundaries/root-path': root}}] })`.
- About 10 s per run. Add `apps/*/package.json` stubs when testing cross-workspace imports (`no-relative-packages`).

**Pitfalls:**
- **The scratchpad is shared with other agents in the same session.** Use a reviewer-specific directory (e.g. `review/PR-<n>-cr`) and run `test -e` before extracting.
- Projects whose `tsBuildInfoFile` sits under the ROOT `node_modules/.cache` write through the junction into the worktree. Drop them from the copy's solution file before running `tsc -b`.
- `@platform/*` links resolve into the WORKTREE, not the copy. Expect false failures on path assertions; for example, the `@platform/source` resolver test in negative-fixtures fails in a copy.
- commitlint `--edit` needs a git root, so the commitlint tests fail in an archive copy (a false failure).
- Cleanup: run `cmd //c rmdir <copy>\node_modules` BEFORE `rm -rf` on the copy. Afterwards, check the worktree's node_modules count (740 at PR #2) and `git status`.

**Junction pitfalls (PR #4 r2, 2026-11-12):**
- `cmd //c "mklink /J $VAR\\node_modules …"` with a sed/tr-built path silently created `C:\node_modules` at the DRIVE ROOT. Removed with `cmd //c "rmdir C:\\node_modules"` (link only). Always check `cmd //c "dir C:\\ /AL"` afterwards.
- PowerShell `New-Item -ItemType Junction` is denied by the auto-mode classifier. Do not retry it.

**Junction-free type-aware probe:** in the scratch dir, write a `tsconfig.json` with `paths: { "vite": ["<main>/node_modules/vite/dist/node/index.d.ts"] }` and a minimal reproduction file. Then run a script that loads eslint/typescript-eslint via `createRequire('<main>/package.json')`, with `overrideConfigFile: true` plus `parserOptions.project`. This reproduced `no-unnecessary-type-assertion` and the `no-unsafe-*` errors on an unresolved `./+types` import in about 5 s.

**Busy-worktree variant (PR #5 r2):** use this when the brief forbids commands in the PR worktree (merge-main running).
1. Run `git archive <sha> <paths>` from the MAIN repo.
2. Junction `node_modules` to MAIN's `node_modules`, building the path with `cygpath -w`.
3. Run `node node_modules/tsx/dist/cli.mjs probe.ts`, which imports the PR functions.

This is enough for pure tools/db-style modules: no build, about 2 s. Write the probe file with the Write tool. A bash heredoc failed on a long markdown/regex body, and a `\0…` escape inside a TS template literal breaks esbuild; build backslashes with `String.fromCharCode(92)`.

**Why:** reviewers have no write access, but claims like "typecheck catches errors in any workspace" or "the layering rules encode the ADR" need injection tests.
**How to apply:** use this whenever a PR's correctness claim needs a mutation or probe. See [[project-review-conventions]].
