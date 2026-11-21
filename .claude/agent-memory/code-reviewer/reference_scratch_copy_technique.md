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
- **Working form (PR #3 r3):** `W=$(cygpath -w copy/node_modules); M=$(cygpath -w <main>/node_modules); MSYS_NO_PATHCONV=1 cmd /c "mklink /J $W $M"`. Remove it with `MSYS_NO_PATHCONV=1 cmd /c "rmdir $W"`.
  - `cmd //c mklink /J "$W" "$M"` fails ("Invalid switch").
  - `cmd //c "mklink /J \"$W\" …"` fails ("syntax incorrect").
- **Appending long markdown to a review file:** a quoted bash heredoc failed ("unexpected EOF looking for `'`"). Write the section to the scratchpad with Write, then `cat >>` it.

**Junction-free type-aware probe:** in the scratch dir, write a `tsconfig.json` with `paths: { "vite": ["<main>/node_modules/vite/dist/node/index.d.ts"] }` and a minimal reproduction file. Then run a script that loads eslint/typescript-eslint via `createRequire('<main>/package.json')`, with `overrideConfigFile: true` plus `parserOptions.project`. This reproduced `no-unnecessary-type-assertion` and the `no-unsafe-*` errors on an unresolved `./+types` import in about 5 s.

**Busy-worktree variant (PR #5 r2):** use this when the brief forbids commands in the PR worktree (merge-main running).
1. Run `git archive <sha> <paths>` from the MAIN repo.
2. Junction `node_modules` to MAIN's `node_modules`, building the path with `cygpath -w`.
3. Run `node node_modules/tsx/dist/cli.mjs probe.ts`, which imports the PR functions.

This is enough for pure tools/db-style modules: no build, about 2 s. Write the probe file with the Write tool. A bash heredoc failed on a long markdown/regex body, and a `\0…` escape inside a TS template literal breaks esbuild; build backslashes with `String.fromCharCode(92)`.

**Why:** reviewers have no write access, but claims like "typecheck catches errors in any workspace" or "the layering rules encode the ADR" need injection tests.
**How to apply:** use this whenever a PR's correctness claim needs a mutation or probe. See [[project-review-conventions]].

**Workspace-link override (PR #9 r3):** when the root `node_modules` junction points at a checkout whose `@platform/*` sources are older than the PR, add `copy/apps/node_modules/@platform/<pkg>` and `copy/packages/node_modules/@platform/<pkg>` junctions to the copy's own packages. Node and Jest resolve these first.
- tsx needs `NODE_OPTIONS=--conditions=@platform/source`; the `--conditions` flag passed to the CLI is not forwarded.
- PR #20 r2: with the root junction pointing at MAIN, override EVERY `@platform/*` package the PR changed. The worker imports `@platform/api/runtime`, so a missing `apps/node_modules/@platform/api` gave a false "now is not a function". Fixture lint roots also need `tests/node_modules/@platform/<pkg>`.
- Lint probe on a PR's own config: drop a mini-root at `copy/tests/fixtures/lint/layering/zz-probe/` and run the real `tools/lint/lint-fixtures.mjs`. Filter the JSON `eslint` report for `zz-probe` keys (about 11 s, no config rewrite). For mutation runs, sed `eslint.config.mjs` and run `negative-fixtures -t '<tag>'` (about 12 s each).
- Jest in a partial archive needs empty `prisma/` and `tests/` dirs (the `roots` validation).

**PR #11 pitfall (2026-11-12):** the copy's node_modules junction vanished mid-review, after the tools/db unit run. Cause unknown; the worktree was intact. Run `ls copy/node_modules` before each run and recreate the junction if needed. Copy git-ignored `prisma/generated` into the copy when probes import the generated client.

**Running a real ci.yml step script end to end (PR #17 r2):**
1. In the archive copy (with the node_modules junction), run `git init`, add `node_modules` to `.git/info/exclude` and commit the tree as "base". Head mutations go into the working tree.
2. Extract the step `run:` with the repo `yaml` package. `createRequire` needs the copy path from `pwd -W`, not a relative path.
3. Run it under `bash` with `RANGE_BASE=$(git rev-parse HEAD)`, `GITHUB_STEP_SUMMARY=<file>` and the step env.

The step restores itself with `git checkout HEAD --`, so `git status` stays clean between runs. Each run takes about 60 s.

Write memory or markdown edits as a .cjs file with the Write tool. An inline `node -e` breaks on apostrophes in the text.

**PGlite for SQL probes without Docker (PR #24, 2026-11-13).** `@electric-sql/pglite` 0.4.3 (PG 17.5 WASM) is in the worktree node_modules. Event triggers fire, and SET ROLE and CREATE ROLE work.
- Apply `prisma/bootstrap/*.sql` in order after these substitutions:
  - psql vars: `:'x_password'` → `NULL`, `:"db_name"` → current_database();
  - drop the CREATE EXTENSION lines;
  - `uuidv7()` → `gen_random_uuid()` (PG 18 only).
- Probe each statement in `BEGIN; SET LOCAL ROLE platform_migrator; …; RESET ROLE; <readiness SQL>; SAVEPOINT; ensure(); ROLLBACK`.
- Run it with tsx from the scratch dir and pass the head dir as an argument. About 30 s and light on memory, so it is allowed under D-ORCH-010.
- Mutate the guard file in the copy to verify a proposed fix.

**PR #23 additions (2026-11-13).**
- Node's `fs.symlinkSync(target, path, 'junction')` creates junctions without admin; handy inside a patched test fixture. A fixture repo holding such a junction needs a committed `.gitignore` with `node_modules`, or `git add -A` walks it and stalls for minutes.
- Patch a copy's test with a small node script (sed with `\n` literals silently did not match); verify with grep.
- Leftover `/tmp/evidence-*` fixture dirs (a timed-out Jest run skips afterAll) keep the junction: `cmd /c rmdir` the junction in each BEFORE `rm -rf`, then recheck the worktree node_modules count (748).
- `pkill` is denied by the auto-mode classifier; rely on `timeout`.

**String-replace mutants (PR #45, 2026-11-14):** a replacement STRING containing `$'` (for example TOML `'''…$'''`) expands to "text after match" and silently produces a garbage mutant that some unrelated pin catches. Always use a function replacer (`s.replace(x, () => "…")`). Also, Bash heredocs written through the tool lost `\` escapes: write probe scripts with the Write tool.

**Loopback-heavy suites in a %TEMP% scratch copy (PR #48, 2026-11-15):** ran ~100x slower per HTTP request (1-2 s) and failed with ECONNRESET; unusable for mutants of HTTP suites. Use a tsx probe in the scratchpad that imports worktree modules by absolute `pathToFileURL` (with `NODE_OPTIONS=--conditions=@platform/source`, run `node <wt>/node_modules/tsx/dist/cli.mjs`) and swaps slots/functions in-process; unit-only mutants still work in the copy.

**Busy PR worktree (TASK-040 r2, 2026-11-20):** when the PR worktree runs lane B, junction `node_modules` to an IDLE sibling worktree whose `package-lock.json` md5 equals the PR head's (loop `md5sum Shipqube-*/package-lock.json`), add `@platform/*` junctions under `<copy>/{apps,packages,tests,prisma,tools}/node_modules/@platform/` to the copy's own packages, and run `JITI_FS_CACHE=false node tools/deps/prisma-cli.mjs generate` in the copy (writes only the copy's prisma/generated). Remove the inner junctions with `cmd /c rmdir` before `rm -rf`.
**Disk-full trap (TASK-040 r4, 2026-11-20):** never chain the extract set-up as `archive | tar && cd "$S" && …; for …; node …; sed -i …` — when tar failed (C: full) the `;`-separated steps ran in the MAIN checkout (sed rewrote 10 tracked tsconfig.json, prisma generate rewrote main's client). Check `df -B1 /c` first, and guard every step with `cd "$S" || exit 1` in a subshell.
**`tsc -b tools` through a junction (TASK-043 r4, 2026-11-21):** `tools/tsconfig.json` has `noEmit` but `tsBuildInfoFile: ../node_modules/.cache/tools.tsbuildinfo`, so it writes into the evidence worktree's git-ignored cache. It is harmless, but disclose it, or drop `tools` from the `tsc -b` list in a junctioned copy. A per-guard mutant runner (`mutants.cjs`: replace with a function replacer, spawn jest on the pinning suite, restore, then `cmp` against the worktree) took about 4 min for 11 mutants.
**PGlite full-schema replay (TASK-051, 2026-11-21):** script `scratchpad/review/TASK-051-cr/probe/pg.mts` (run with tsx from the extract, `.mts` for top-level await). Bootstrap: substitute `:'x'` -> NULL, `:"db_name"` -> postgres, `uuidv7\(\)` -> gen_random_uuid() (escape the parens!), drop CREATE EXTENSION lines (load `@electric-sql/pglite/dist/contrib/btree_gist.js` via `new PGlite({extensions:{btree_gist}})` when needed). Migrations must run statement by statement (`splitStatements`) as platform_migrator, else "cannot ALTER TABLE users because it has pending trigger events". pg-shaped adapter: no params -> `db.exec` (multi-statement renderRls blocks), else `db.query`; rowCount = `affectedRows`. Import the PR's own case modules (cases.ts, probe harness) and replay them. On Windows Git Bash, `git show rev:path` applied eol conversion (CRLF); use `MSYS_NO_PATHCONV=1 git cat-file -p rev:path` for byte comparisons.
**TASK-080 r2 (2026-11-21):** `tools/lint/check-suppressions` CLI rows run `git ls-files` and fail in an archive extract; `git init`, exclude node_modules, commit with `core.hooksPath=/dev/null --no-verify`, then 21/21. PGlite migration replay of one migration needs only `CREATE SCHEMA platform` + roles + `uuidv7()` swap (script `scratchpad/review/t080-r2-probe/trunc.mjs`).

**Real Prisma 7 client without Docker (TASK-045, 2026-11-21).** `@electric-sql/pglite-socket` 0.1.3 is installed: `new PGLiteSocketServer({ db: await PGlite.create(), port, host:'127.0.0.1' }).start()`, then the generated client (`prisma/generated/prisma/client.ts`) with `new PrismaPg({ connectionString:'postgresql://postgres:postgres@127.0.0.1:<port>/postgres', max:1 })` and `log:[{emit:'event',level:'query'}]` to capture the SQL. Probe file must be `.mts` (tsx refuses top-level await in .ts); import PR modules by `pathToFileURL`. Ran in ~20 s; PG 17, so `gen_random_uuid()` instead of `uuidv7()`.
**gitleaks generic-api-key emulation without Docker (TASK-051 r2, 2026-11-21):** `scratchpad/review/TASK-051-cr/glscan.mjs` reads a diff on stdin and applies the default regex (Node 24 supports `(?-i:...)`), entropy >= 3.5 on group 1, allowlist `^[a-zA-Z_.-]+$`. It reproduced the lane-B L-2 hit (a backticked `child=parent` after the word "key", entropy 3.58). Supplementary only; gitleaks-full on lane B is the proof.
