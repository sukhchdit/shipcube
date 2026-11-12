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
- Semgrep is not installed on the host.
- **Probing lint configs without running the suite.** A single-process `ESLint#lintText` against the worktree's real `eslint.config.mjs` stays light enough for the memory-constrained host. Load ESLint from the worktree with `createRequire(<worktree>/package.json)`, and add the `tseslint.configs.disableTypeChecked` + `projectService: false` overrides, because the probe files are not on disk. `isPathIgnored` / `calculateConfigForFile` show coverage holes. Write the probe file with a heredoc, not a `node -e` string, because quoting breaks in Git Bash.
- **Probe scripts with regex escapes.** A Bash-tool heredoc (even `<<'EOF'`) turned `\\b` into `\b` in one case (PR-0005, 2026-11-12). The probe then silently matched nothing. Write such probes with the Write tool, and include a positive control line in every probe.
- **Lock-only fix-cycle deltas.** A generic deep JSON diff of the base and head `package-lock.json` (every differing path, with a positive control) proves "only X changed" faster and more strictly than the tuple diff. Used for PR-0002 R2, 2026-11-12.
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
- **"No commands in worktree X" includes read-only git.** On 2026-11-13 (PR-0009 R2) I slipped and ran `git status` there; disclose any such slip in the record.
  - Check the worktree's state from the main checkout instead (`git worktree list`, `git show <sha>:<path>`).
  - Junctions into its `node_modules` are fine.
- **ReDoS-probe every regex that a fix adds over request input.** The PR-0009 HIGH (PR9-SEC-14) came from a charset fix.
  - Measure in a child-process server; same-process timings hide event-loop blocking.
  - Fuzz the proposed grammar for language equivalence.
- **Lockfile delta script.** Reusable at `scratchpad/review/PR-2-sec/scripts/lockdiff.mjs`, but scratch is session-scoped, so re-create it if it is gone. It reports new and removed tuples, integrity changes, flag moves, hosts, install scripts and licences.

Related: [[project-p3-security-conditions]], [[project-p5-wave0-supply-chain]]
