---
name: project-security-review-conventions
description: How security findings are expressed and routed in this project (OWASP 2021 codes, severity rule, read-only on ADRs, npm registry checks work from the host)
metadata:
  type: project
---

Findings use the CLAUDE.md §11 scale with CWE and OWASP Top 10:2021 codes (threat-model.md uses 2021 codes, e.g. A10 = SSRF; keep consistent). Severity matrix from threat-model.md §1: Impact×Likelihood, C×H=CRITICAL, C×L/M or H×M/H=HIGH, H×L or M×M/H=MEDIUM, else LOW. Security-analyst never edits ADRs/requirements: findings go to principal-architect (technical) or product-manager (functional), and proposed decision text is handed to them to log in DECISIONS.md.

**Why:** Orchestrator instructions for P3 (read-only scope, no commits, no human questions); consistency with threat-model.md lets quality-gatekeeper trace IDs.

**How to apply:** Registry checks (`npm view <pkg> license version time.modified --json`) work from the Windows host when prefixed with `export PATH="$APPDATA/fnm/aliases/default:$PATH";` (D-ORCH-002) — no need to spawn dependency-auditor for spot checks before a lockfile exists. Notable licence facts found 2026-11-12: caniuse-lite is CC-BY-4.0, spdx-exceptions CC-BY-3.0 (stale), argparse 3.x is PSF-2.0, nodemailer MIT-0, tslib 0BSD, lru-cache BlueOak-1.0.0.

**dependency-auditor hits its 30-turn limit.** A 4-task dispatch on 2026-11-12 (age sweep, provenance, maintenance, gitleaks) stopped before it reported. Its scratchpad outputs (`sweep-stdout.json`, `packuments-condensed.json`, `gitleaks-out/`) were still usable.
- Give it at most 2 tasks per dispatch.
- Or run the licence, audit and maintenance checks yourself with Node scripts; this is fast.
- gitleaks works via the Docker image with `--redact`. In Git Bash, prefix it with `MSYS_NO_PATHCONV=1`, otherwise `/repo` is rewritten to `C:/Program Files/Git/repo`. For worktree commits, mount the main repo, which holds the shared object store, and use `--log-opts=<base>..<head>`.
- **gitleaks `dir` mode** (scanning a `git archive` tree) reports paths as `/scan/...`.
  - The path-anchored allowlists in `.gitleaks.toml` (`^docs/...`) therefore do not match in that mode.
  - So the 17 PR1-SEC-11 hits (`openapi.yaml`, the agent docs) always show up there. Triage them as allow-listed; lane A's git mode reports repo-relative paths.
  - Lane A scans `base.sha..head.sha` with `--diff-merges=first-parent`. Any text on main that a branch has not yet merged arrives as *added lines* in that branch's next main-merge.
  - Therefore never quote a flagged value in docs, records or memory (PR13-SEC-11).
- Semgrep is not installed on the host.
- **Probing lint configs without running the suite.** A single-process `ESLint#lintText` against the worktree's real `eslint.config.mjs` stays light enough for the memory-constrained host. Load ESLint from the worktree with `createRequire(<worktree>/package.json)`, and add the `tseslint.configs.disableTypeChecked` + `projectService: false` overrides, because the probe files are not on disk. `isPathIgnored` / `calculateConfigForFile` show coverage holes. Write the probe file with a heredoc, not a `node -e` string, because quoting breaks in Git Bash.
- **Probe scripts with regex escapes.** A Bash-tool heredoc (even `<<'EOF'`) turned `\\b` into `\b` in one case (PR-0005, 2026-11-12). The probe then silently matched nothing. Write such probes with the Write tool, and include a positive control line in every probe. **But the Write tool decodes ` `-style escapes into raw characters** (PR-0020, 2026-11-13: a raw U+2028 inside a regex literal gave a SyntaxError; `sed` repair with `\\u` failed too, GNU `\u` = uppercase). For control and line-separator characters, build them with `String.fromCharCode` and test by code point, never with escapes in the source.
- **Lock-only fix-cycle deltas.** A generic deep JSON diff of the base and head `package-lock.json` (every differing path, with a positive control) proves "only X changed" faster and more strictly than the tuple diff. Used for PR-0002 R2, 2026-11-12.
- **Merge-only rounds: "the lockfile delta is unchanged" (PR-0004 R3).** Compare the leaf-level `delta(old base → old head)` with `delta(new main parent → new head)` as (path, before, after) sets. Use `delta(old base → main)` as the positive control. Script: `scratchpad/review/PR-4-sec-r3/scripts/lockdelta-eq.mjs` (session-scoped). Then a clean `git merge-tree` equal to the merge tree, plus the three-way tree compare, settles every other path.
- **Pre-lint head code in lane A's fast-lane:**
  - `deps:rebuild` → `prisma generate` loads the unowned `prisma.config.ts`;
  - since PR #4, `npm run lint`/`typecheck` start with `typegen`, which runs workspace scripts, `vite.config.ts`, `react-router.config.ts` and `routes.ts` (PR4-SEC-13).

  The fast-lane gates can therefore be tampered with by unowned files. When a PR adds a new pre-gate execution point, check it against this class.
- **Boundaries head-vs-main probe (PR-0019).**
  - `git archive <sha> eslint.config.mjs tools/eslint-rules tools/lint` into `cfg-head` / `cfg-main`, and junction each `node_modules` to the MAIN checkout's.
  - Write a scratch mini-repo, then run `new ESLint({cwd, overrideConfigFile, overrideConfig:[disableTypeChecked, projectService:false, no-unresolved off, {settings:{'boundaries/root-path': root}}]})`.
  - File descriptors accumulate categories, so a new category never removes an old one.
  - **Gotchas (PR-0020 R2, 2026-11-13):**
    - The mini-repo needs a root `package.json`, otherwise `import-x/no-relative-packages` crashes with "path … null".
    - Turn `import-x/no-cycle` off (it crashes the same way).
    - To test the *resolved-file* arm, junction `root/node_modules/@platform/<pkg>` → `root/packages/<pkg>`, and build every junction target from the **long** path (`/c/Users/<long user dir>/AppData/...`), never the 8.3 short form (`<FIRST6>~1`). An 8.3 short-path target puts the resolved file outside `boundaries/root-path`, and the arm silently misses. That produced a false "`?worker` bypass" until re-run.
    - A junctioned root dir has the same problem. Copy the root instead.
    - `unrs-resolver` strips `?query` suffixes, so the resolved arm catches `x?worker`/`x?raw`.
- **Probing a git-object-reading verifier (PR-0023).** Build scenario commits with plumbing in a scratch repo and never check them out:
  - a temporary `GIT_INDEX_FILE`, `read-tree <parent>`, `update-index -z --index-info` (mode `0` deletes), `write-tree`, `commit-tree`;
  - `-c core.protectNTFS=false` lets the Windows host commit LF/CR/colon path names;
  - the work tree stays at the base, so `git status` stays clean.
  Run the PR's script from outside the repo with `--manifest`, which simulates the base copy. Copy `node_modules` packages instead of using junctions when the probe swaps them. Script: `scratchpad/review/PR-23-sec/scripts/probe.mjs` (session-scoped).
- **Probing a PR head without touching its worktree** (PR-0005 R2):
  - `git show <sha>:<file>` the `.ts` sources into scratch.
  - Rewrite the `./x.js` imports to `./x.ts`, and bare `pg`-style imports to file URLs into the main checkout's `node_modules/<pkg>/esm/index.mjs`.
  - Run them with plain `node` (Node 24 strips types).
  - For URL guards, diff the guard's result against `new pg.Client({connectionString})`'s `host`/`port`/`database`, which needs no connection.
- **Type-stripping PR sources (PR-0008).**
  - Use `stripTypeScriptTypes(code, { mode: 'transform' })`. The default strip mode rejects constructor parameter properties (`constructor(readonly x: string)`), which the authz package uses.
  - In probe scripts, build file URLs with `pathToFileURL`. Hand-built `replaceAll('\\', '/')` broke again in a Bash heredoc.
- **Probing Prisma runtime behaviour without a database (PR-0011).**
  - Strip the PR's sources and the worktree's `prisma/generated/prisma` into scratch.
  - Build `new PrismaClient({ adapter: fakeFactory })`. `fakeFactory` is `{provider:'postgres', adapterName, connect()}`, and the adapter returns `{queryRaw, executeRaw, executeScript, startTransaction, dispose}`. The transaction has `options:{usePhantomQuery:false}` and savepoint methods.
  - Log each SQL with a `ROOT`/`TXn` tag. Result sets are `{columnNames, columnTypes (7 = Text), rows}`.
  - Throw `new DriverAdapterError({kind:'postgres', originalCode, originalMessage, …})` from `@prisma/driver-adapter-utils` to drive P2010/P2039.
  - This proves transaction-binding and escapes cheaply.
  - The scratch `node_modules` junction vanished once mid-session, so re-check it before re-running.
- **Probing a capability guard (Proxy / wrapper).** Also probe what the allowed members RETURN, and use that value after the guard is revoked. In PR-0011 R2, a "deep, deny-by-default" `TenantDb` still returned Prisma's raw `PrismaPromise`, and its `requestTransaction(null)` reached the root pool. For a lint or run-time check on a tagged template, also probe the interpolated values (`Sql` objects splice raw text).
- **Validating a record when the PR branch is not merged with main.** Use `checkSecurityOwnedPaths` with base `origin/main` and the PR head. Older head rows in the same record only produce notes, and the run still passes on the newest head (PR-0011 R2).
- **"No commands in worktree X" includes read-only git.** On 2026-11-13 (PR-0009 R2) I slipped and ran `git status` there; disclose any such slip in the record.
  - Check the worktree's state from the main checkout instead (`git worktree list`, `git show <sha>:<path>`).
  - Junctions into its `node_modules` are fine.
- **ReDoS-probe every regex that a fix adds over request input.** The PR-0009 HIGH (PR9-SEC-14) came from a charset fix.
  - Measure in a child-process server; same-process timings hide event-loop blocking.
  - Fuzz the proposed grammar for language equivalence.
- **Git attribute experiments: confirm them in a Linux container, not with host git** (PR-0010 R2, 2026-11-13). With an empty work tree, Git for Windows 2.52's `git log -p` still treated `package-lock.json` as binary. The attribute source is unexplained, and `-c attr.tree=<empty tree>` cleared it. Treat host results as hints only.
- **Probing PR code that imports `@platform/*` workspace packages (PR-0011 R3).**
  - The main checkout's `node_modules/@platform/*` resolve to main's TS sources (exports `default` → `dist`).
  - Use a `module.registerHooks` resolve hook (`probes/hooks.mjs`) mapping `@platform/<pkg>` → `<build>/packages/<pkg>/src/index.js`.
  - In Git Bash, pass `--import ./hooks.mjs` from the probes dir, or a `file:///$(cygpath -m …)` URL; a `/c/...` path fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME`.
  - Remove scratch junctions with `cmd //c "rmdir <dir>\\node_modules"`, never `rm -rf`, which would follow the junction.
  - **Full-app variant (PR-0021 R2).** This runs the real `createApp` with no build:
    - `git archive <sha> apps/api/src packages/*/src` into scratch;
    - a `registerHooks` resolve hook mapping `@platform/<pkg>` → `src/index.ts`, and relative `./x.js` → `./x.ts` when only the `.ts` exists;
    - a load hook with `stripTypeScriptTypes(src, {mode:'transform'})`;
    - a `node_modules` junction to the main checkout.
    Script: `scratchpad/review/PR-21-sec-r2/probes/hooks.mjs`.
- **Overlapping reviews.** The code reviewer often probes the same lint or walker items in parallel. Read their record on main (`docs/05-quality/reviews/`) and the latest D-ORCH rulings before finalising, so owners and fix forms align. main moves during a review, so re-fetch before writing "state of main".
- **Raw-socket HTTP probes (PR-0004 R2).** Send the request with `socket.write`, never `socket.end`. On a half-close (FIN), Node's http server drops responses that are written asynchronously, such as piped file streams; only synchronous 4xx responses come back, so every 200 reads as "no response". Use `Connection: close` and wait for `close`.
- **Signature and advisory spot checks without an installed tree.** `npm audit signatures` needs `node_modules`. Instead, verify each tuple's `dist.signatures` (ECDSA over `name@version:integrity`) against `-/npm/v1/keys` with `node:crypto`, add a tampered-integrity control, and POST to `-/npm/v1/security/advisories/bulk` with a known-vulnerable version as a positive control. Script: `scratchpad/review/PR-4-sec-r2/scripts/sigcheck.mjs` (session-scoped).
- **Gitleaks without Docker (PR-0021).** Emulate the default ruleset in Node.
  - Download `config/gitleaks.toml` for the pinned tag. Parse it with a minimal TOML reader: `[[rules]]`, `[[rules.allowlists]]`, `[allowlist]`, `'''` literals, arrays.
  - Convert RE2 to JS: strip `(?i)` into the `i` flag (over-approximates the mid-pattern ones), map `[:alnum:]`-style classes, `\z` → `$`. All 221 v8.30.1 rules compiled.
  - Apply the keyword prefilter, `secretGroup` (else the first non-empty group), entropy `<=` threshold, the generic-rule digit check, and the global and rule allowlists including lower-cased stopwords.
  - Run it per line, with runtime-generated positive controls.
  - Script: `scratchpad/review/PR-21-sec/scripts/gl-emul.mjs` (session-scoped). Treat the results as hints; devops confirms with the real image.
  - Also run it over your own record before hand-off.
- **Effective-config diff for an `eslint.config.mjs` block (PR-0027).**
  - Run `ESLint#calculateConfigForFile` over ~50 representative plus near-miss paths on two `git archive` extracts (head and base), scrub the root path, and diff every leaf. Add a mutation control (a widened glob and a rule turned off) to prove the probe can see them.
  - The extract needs `tools/eslint-rules`, `tools/lint` and the workspace `package.json` files, because the config reads the disk.
  - `tseslint.configs.disableTypeChecked` is one object, not an array.
  - Scripts: `scratchpad/review/PR-27-sec/effcfg.mjs`, `lintprobe.mjs`, `lintts.mjs`.
- **The scratchpad persists across sessions.** Earlier `review/PR-NN-*` folders are still there, including `record-sim.sh` (PR-21, PR-25, PR-27 variants) and the Gitleaks emulators; look before rewriting. `gl-emul-multi.mjs` prints the matched line, so a positive control built at run time shows up in tool output. Print counts only.
- **Pinned-image checks need no Docker.** Anonymous GETs to `auth.docker.io` and `registry-1.docker.io` give the manifest, config blob (user, created, entrypoint) and a body-hash check. Compare per-platform manifest digests with the moved tag, because only the attestations may differ. Script: `PR-27-sec/k6digest.mjs`.
- **Lockfile delta script.** Reusable at `scratchpad/review/PR-2-sec/scripts/lockdiff.mjs`, but scratch is session-scoped, so re-create it if it is gone. It reports new and removed tuples, integrity changes, flag moves, hosts, install scripts and licences.

- **Host quirks for scratch probes (PR-0028).**
  - With `MSYS_NO_PATHCONV=1`, Windows `git -C` and `node` need mixed paths (`cygpath -m`); `/c/...` fails ("cannot change to"). `cmd //c` then starts an interactive shell, so make a junction with `fs.symlinkSync(target, link, 'junction')` and remove it with `fs.rmdirSync(link)`.
  - A `git archive` extract of `tools/quality` (base and head) plus a shared clone with a `node_modules` junction runs the verifier's real CLI (`--root <clone> --base --head --json`). Scenario commits come from plumbing (`scratchpad/review/PR-28-sec/probes/scenarios.mjs`: `mk(parent, {path: content|null|{mode,content}})`), and a patched scratch copy of `lib/manifest.mjs` tests a candidate pattern. The record simulation is `probes/record-sim.sh`.
  - **Record Head rows:** the checker binds SHAs from ANY table row whose first cell starts with `Head` (word boundary), in any table. Keep exactly one such row, and never a first cell starting with `Verdict` before the final one.
  - `os.tmpdir()` on this host is the 8.3 form (`<FIRST6>~1`), so `homedir()`-based scrubbing misses it; never quote that fragment in a record.

Related: [[project-p3-security-conditions]], [[project-p5-wave0-supply-chain]], [[project-p5-pr28-w0act1]]
