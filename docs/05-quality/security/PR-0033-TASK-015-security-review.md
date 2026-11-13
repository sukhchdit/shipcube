# Security review: PR #33 (TASK-015 part 015-A: US-006 coverage gate, oasdiff, CODEOWNERS and bootstrap immutability, gitleaks baseline, lane A pins)

| Field | Value |
|---|---|
| Round | 1 (change-scoped, P5) |
| Head | `3ed048466667bff670610d1bd6f830253b9553c7` |
| Branch | `feat/TASK-015-spk-07-lane-c-full` (9 commits over merge base `d53fbc7`; main has since moved to `db72305` by non-docs PRs #26, #27, #30) |
| Reviewer | security-analyst |
| Date | 2026-11-13 |
| Scope | 36 paths changed. Security-owned: `.github/CODEOWNERS`, `.github/workflows/ci.yml`, `jest.config.ts`, `package.json`, `tools/ci/**` (18 files), `tools/lint/**` (2), `tools/quality/{check-evidence.mjs, check-evidence.test.ts, heavy.mjs, gitleaks-baseline.txt}`. Unowned: `tools/repo/*.test.ts` (3), `tools/openapi/README.md`, the committed lane B run `docs/05-quality/tests/runs/20261113T1051Z_2e17530/` |
| Input | PR body, D-TASK015-01..13, D-ORCH-043, D-ORCH-021, ADR-0023, my records PR-0004, 0017, 0021, 0023, 0024, 0025, 0026, 0031, the code review `PR-0033-TASK-015-code-review.md` (R1, CHANGES_REQUESTED) |
| Result | PASS_WITH_FOLLOW-UPS: 0 Critical, 0 High, 0 Medium, 3 LOW, 5 INFO. Ten earlier findings are implemented: nine are CLOSED (PR4-SEC-13 for items 1 to 3, PR24-SEC-06 for its immutability half), PR25-SEC-01 is half closed (its runner half is 015-B); PR4-SEC-13 item 4 stays with principal-architect and PR10-SEC-08 is not reopened |

## 1. Method and limits

Read: the full three-dot diff `origin/main...3ed0484` (code, tests, ci.yml, CODEOWNERS, package.json, jest.config.ts, lint harness, heavy and check-evidence), the head `ci.yml` end to end, and the PR's call sites of every new function.

Probed (all on `git archive` extracts of the head, the merge base and `origin/main`, the main checkout and the TASK-015 worktree never written; scripts in the session scratchpad `review/PR-33-sec/probes`):

- 34 edits of the real `ci.yml` (plus the unchanged control) through the head `checkWorkflow(..., {requiredGates:true})` and the base copy (positive control: 0 findings on both).
- `nonCanonicalNpmExec` / `segmentFindings` over 360 generated spellings (3 command words x 15 option prefixes x 8 tails) plus 53 hand-written forms, against the npm 11 `deref` table of the installed npm; the real npm with a local registry stub for the `--no` / `npm_config_*` questions.
- CODEOWNERS: `checkCodeowners` with each line deleted; old versus new `patternToRegExp` over all 1608 tracked paths.
- Bootstrap immutability: 17 scenarios in throw-away git repos through the head and the base CLI.
- `__mocks__`: Jest 30.5.2 with a `projects`-shaped config and planted bare and scoped mocks; the 15-case tree walk of the new repository rule.
- Real images under the shared `docker.lock`: gitleaks v8.30.1 (pinned digest, `--network none`) over the whole main history with the baseline and 6 mutations; the head `openapi-breaking.mjs` against the real oasdiff v1.35.0 image on throw-away repos (12 scenarios); the exact `docker run` arguments on a 0700 uid-1001 directory (Linux kernel semantics in the Docker Desktop VM). No other container was touched; the lock and the VM scratch directory were removed.
- The committed run: host-fragment scan (counts only) with a positive control from the earlier PR #31 probe; IPv4 and e-mail hits triaged by class.
- Registry GETs (no Docker) for the oasdiff digest, body hash, config and licence label.

Not done: full `lint`, `typecheck`, `build`, `test:*` (lane A `fast-lane` is green on this exact head, run 43417165257, no skipped step); the new `openapi-breaking` step has not yet executed on any runner (it is behind the red record step); no `semgrep` on the host.

## 2. Earlier findings that this PR implements

| Finding | Sev | Disposition | Evidence |
|---|---|---|---|
| PR4-SEC-13 (items 1 to 3) | INFO | **CLOSED** | Porcelain gate directly after Lint, found by step name and command, `if` pinned (probes M18 to M21 all flagged; position test). Root `typegen` is `npm -w apps/web -w apps/admin exec --no -- react-router typegen` (workspace scripts no longer run; `apps/web`, `apps/admin` are the only workspaces with the script). `/apps/*/vite.config.ts` owned. Item 4 (ADR-0023 am. K note) stays with principal-architect. Residual: PR33-SEC-05 |
| PR4-SEC-11 | LOW | **CLOSED** | `jest-config-owned.test.ts`: every path `jest.config.ts` references is CODEOWNED; fixture with an unowned folder fails. CI unit run green on the head |
| PR17-SEC-09 | LOW | **CLOSED** | Planted bare and scoped `__mocks__` are served with the old patterns and ignored with `/__mocks__/` (section 7). `**/__mocks__/` owned and required. New repository rule flags the directory at any depth and any tracked `node_modules/` path |
| PR21-SEC-04 | INFO | **CLOSED** | `!**/*.generated.ts` and `!**/*.gen.ts` replaced by two exact paths (`jest.config.ts:74`, the existing `types.gen.ts`); `coverage-scope.test.ts` pins them to `git ls-files` and has the suffix-wide and stale-path mutations |
| PR23-SEC-06 as amended (D-SEC-PR23-02 (2)), D-ORCH-032, PR #23 R2-n2, R2-n3 | LOW | **CLOSED** (residual PR33-SEC-01) | `LANE_B_EVIDENCE_SCRIPT` compared line by line, no step `env`, no `if`, no `shell`; `--event "$GITHUB_EVENT_NAME"` only; no head-copy branch; no base fails closed except on push; base without the verifier fails with the merge-main message; `--profile wave\|gate` refused; new triggers findings (`CI_TRIGGERS`); `GITHUB_*` and `RUNNER_*` env keys refused in every workflow; `check-evidence` refuses `--event push` with wave or gate. Mutations M01 to M17 all flagged by the head checker, none by the base checker |
| PR24-SEC-04 | LOW | **CLOSED** | `/prisma/`, `/tools/db/`, `/prisma.config.ts`, `/apps/api/src/platform/` owned and in `REQUIRED_CODEOWNED_PATHS`. Single-line deletion of each of the 8 new lines gives exactly one finding; no tracked path lost ownership (994 of 1608 now owned, 516 gained, 0 lost) |
| PR24-SEC-06 | INFO | **CLOSED** for the immutability half; the optional content-bound marker stays TASK-024 | Section 8: edit, delete, rename, type change and out-of-order add all fail; add after the last released file and non-SQL files pass |
| PR25-SEC-01 | LOW | **PARTLY CLOSED**: the baseline artifact is correct and exact; the runner half (base or gate ref extraction, read-only mount, ancestry scan) is 015-B and is due before `gitleaks-full` activates and before G3 | Section 5: 17 findings without, 0 with, the two sets equal, 6 mutations behave. Lane A is pinned neither to mount nor to read it |
| PR25-SEC-02 | INFO | **CLOSED** | Dependabot parsed per ecosystem with exact values; `.gitleaks.toml` may hold only `title`, `[extend]`, `[[allowlists]]` (mutation M10). The tests are head unit tests in an owned folder |
| PR26-SEC-07 | INFO | **CLOSED** | `/packages/shared/src/ids/` and `**/package.json` owned, required, mutation-tested |
| PR10-SEC-08 | LOW (closed in PR #25) | **Not reopened** | `.gitleaks.toml` is byte-identical to main; the baseline is outside gitleaks' own configuration and cannot be auto-loaded (named `gitleaks-baseline.txt`, mounted nowhere) |

Not in this PR and still open as routed: PR10-SEC-16..21, PR17-SEC-02, -07, -08, -10, PR23-SEC-07, -10, PR31-SEC-02 (015-C, before G3); PR23-SEC-03, -04, -05 (before the Wave-0-exit activation PR); PR31-SEC-01 (next `tools/quality` change).

## 3. ci.yml diff against the D-ORCH-021 lever list

Three-dot diff of `.github/workflows/ci.yml` (46 lines): the added lines contain no `BASH_ENV`, `PATH`, `BASH_FUNC_*`, `NODE_OPTIONS`, `defaults:`, `$GITHUB_PATH`, `$GITHUB_ENV` write, `shell:`, `working-directory`, `continue-on-error`, `permissions`, `secrets`, `pull_request_target` or folded `run: >`. Counts at base and head are equal: `GITHUB_ENV` 8, `RANGE_BASE` 27, `uses:` 5, `BASH_ENV` 0, `defaults:` 0, folded scalars 0. The only `$GITHUB_ENV` write that changed is the existing tool loop, which gains `openapi-breaking` (`GATE_OPENAPI_BREAKING`, same pattern as the other gates). `RANGE_BASE` / `RANGE_HEAD` stay defined only in the two job `env:` blocks.

| Check | Result |
|---|---|
| Actions pinned by commit SHA | 5 of 5 (`checkout` x2, `setup-node` x2, `cache` x1), same SHAs as main; no new `uses:` |
| New container | `OASDIFF_IMAGE` at workflow level. The pinned digest is the OCI index of `tufin/oasdiff:v1.35.0` (body SHA-256 equals the pin; tag resolves to the same digest). amd64 config: created 2026-10-28, entrypoint `/usr/bin/oasdiff`, label licence Apache-2.0, alpine base, 4 layers. v1.36.0 and v1.37.0 exist (inside the 7-day cooldown on 2026-11-13, as the PR states). `*_IMAGE` must be digest-pinned (probe M27 flagged) |
| oasdiff run | `--network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 65534:65534`, read-only bind mount of a private temp dir holding the two specs, no `-e`, no secret in the container; the specs come from `git show` objects, not the working tree. Executed with exactly these arguments in section 9. Findings PR33-SEC-02 and -03 |
| Base-ref tooling before head code | fast-lane order unchanged: workflow policy, install flags, migration immutability, lockfile, dependency age, `npm ci --ignore-scripts`, licences, signatures, audit, **lane B evidence (base copy only now)**, then `deps:rebuild` and the rest. `scans` still runs no npm and no head script, and the new step is its last step; `openapi-breaking.mjs` imports only `node:` modules, so the bootstrap extraction of `tools/ci` is self-contained |
| Porcelain gate placement | Immediately after Lint, before Format, Type-check, tests; same command as the post-build gate, found by step name (`^Lint must not mutate the tree`); the unit test pins "step after lint = lint + 1" |
| Bootstrap on this PR | Run 43417165257 shows `check-security-owned-paths` from the base and `openapi-breaking` from the head tree (bootstrap), as designed; `scans` failed only at the record step |
| Reserved env | The new `reserved-env` rule (`GITHUB_*`, `RUNNER_*` except `GITHUB_TOKEN`): `ci.yml` is the only workflow; nothing legitimate sets such a name (GitHub itself refuses secrets with that prefix), so `nightly.yml` and the `workflow_dispatch` jobs of 015-B must read these through the `github` context. No false positive on the tree |

Pin strength, from the 34-edit matrix: the lane B step resists every edit that changes a command line (M01 to M05, M10 to M14). The two new pins that are matched by pattern do not (PR33-SEC-03): M25, M26, M28 pass. Edits that need the still-open PR17-SEC-08 (`$GITHUB_ENV` writes of `RANGE_BASE`, `BASH_ENV`; M30, M31) pass as before, so they remain owned-path record decisions, not controls.

## 4. Findings

### PR33-SEC-01: pinned `run:` blocks treat a line that starts with Unicode whitespace plus `#` as a comment, bash runs it (LOW)

| | |
|---|---|
| Severity | LOW (Impact M-H: any early exit in a pinned step disables it; Likelihood L: needs an owned `ci.yml` edit that the record reviewer must see through an invisible character) |
| CWE / OWASP | CWE-436 Interpretation Conflict · A04:2021 |
| Location | `tools/ci/check-workflow-policy.mjs:170-180` `commandLines` (used by `LANE_B_EVIDENCE_SCRIPT`, `BASE_LINT_FIXTURES_SCRIPT`) |
| Description | `commandLines` drops a line when `line.trim() === ''` or it matches `/^\s*#/`. JavaScript `\s` includes U+00A0, U+FEFF and U+2028/9. Bash treats only ASCII blanks as separators, so a line `<U+00A0># \|\| exit 0` is the command word `<U+00A0>#`, which fails with "command not found", and the `or` branch then runs `exit 0`. Probe M06 (head ci.yml with that line inserted before the verifier line): **0 findings from head and base checker**. Real bash 5.2: exit status 0 and the following command never runs; with an ASCII blank in front the same line is a true comment and the verifier runs (control). U+FEFF and U+2028 are stopped earlier by the YAML subset parser (M07, M08 flagged). Trailing U+00A0 after `trimEnd()` is not exploitable: `set -euo pipefail<U+00A0>` aborts with exit 2 |
| Exploitability / impact | Disables the lane B evidence verification (and the base-ref lint fixture run) from lane A while the pin reports green. It is the PR17-SEC-07 class (checker and runner read the block differently) and now covers the step this PR pins "exactly" |
| Remediation | In `commandLines`: ASCII only, `/^[ \t]*$/` and `/^[ \t]*#/`, and `trimEnd` replaced by `replace(/[ \t]+$/, '')`. Add `if (/[^\x20-\x7E\t]/u.test(script)) problems.push('non-ASCII character in a pinned run:')` to `laneBEvidenceProblems` and to the base-lint-fixtures matcher (the pinned scripts are pure ASCII) |
| Verification | A `check-workflow-policy.test.ts` case per variant (U+00A0, U+2000-U+200A, U+3000 as the first character of an inserted comment line) expecting a `required-gates` finding; run M06 against the fixed checker |
| Owner / due | senior-developer, with the R1-m2 pin rewrite in the fix cycle (same helper), otherwise 015-C with PR17-SEC-07/-10 before G3 and before any further pin |

### PR33-SEC-02: the oasdiff container cannot read its spec directory on Linux, so the gate fails closed on every PR once a release tag exists (LOW)

| | |
|---|---|
| Severity | LOW (security impact is availability of a contract gate; code review R1-M1 rates the same defect MAJOR for the pipeline) |
| CWE / OWASP | CWE-693 Protection Mechanism Failure · A05:2021 |
| Location | `tools/ci/openapi-breaking.mjs:255` (`mkdtempSync`), `:160-183` `oasdiffArgs` (`--user 65534:65534` at :171, `--cap-drop ALL`) |
| Description | `mkdtempSync` creates the directory with mode 0700 owned by the runner user (uid 1001 on ubuntu-24.04). The container runs as uid 65534 with all capabilities dropped, so it cannot traverse the mount root. Probe: the exact arguments on a 0700 uid-1001 directory in the Docker VM give `failed to load base spec from "/specs/base.yaml": open /specs/base.yaml: permission denied`, exit 102; after `chmod 755` the same run returns `[]` and exit 0. The integration test passed on Windows Docker Desktop, which does not enforce POSIX modes, and the CI step has never run (no tag, and it is behind the red record step) |
| Exploitability / impact | After the first `v*` tag every PR gets exit 2 from this step. A red gate that nobody can satisfy invites disabling it, which is the real risk |
| Remediation | `chmodSync(dir, 0o755)` and write the two files with mode `0o644` (public repository content, still a private temp dir mounted read-only; do not widen further and do not drop `readonly`), or pass `--user "$(id -u):$(id -g)"`. Prove it on Linux once, cheapest durable form: in the no-tag branch also run the container on the head contract against itself, so every PR exercises pull, mount and parse |
| Verification | A test asserting the directory and file modes; the same real-image run on a Linux runner (or the VM probe `probes/docker-run.sh` part L) must return exit 0 |
| Owner / due | senior-developer, fix cycle of this PR (= code review R1-M1); at the latest before `v0.1.0-m0` |

### PR33-SEC-03: the oasdiff gate is trusted more than it is pinned: loose step pin, image and script swappable by step env, any pushed tag is the baseline, self-certifying record (LOW)

| | |
|---|---|
| Severity | LOW (the gate becomes live only at the first tag; every route needs a write-access collaborator and an owned `ci.yml` edit or a pushed tag) |
| CWE / OWASP | CWE-345 Insufficient Verification of Data Authenticity, CWE-1220 · A08:2021 |
| Location | `check-workflow-policy.mjs:304` (`CI_REQUIRED_GATES` entry); `openapi-breaking.mjs:44` (`DIGEST_PINNED`), `:249` (`git tag --list 'v*'`), `:128` and `:46` (record match) |
| Description | (i) The gate is found by `/node "\$GATE_OPENAPI_BREAKING" .*--image "\$OASDIFF_IMAGE"/`, unanchored and without `env: {}`. Probes: appending a trailing "or true" (M28), a step-level `env:` that sets `OASDIFF_IMAGE` to another digest-pinned image (M25) and a workflow-level swap (M26) all pass the base-ref policy. `--image` accepts any digest-pinned reference (O9), and a step `env: GATE_OPENAPI_BREAKING: ./x.mjs` (code review security flag 2) would run a head script inside the job that is supposed to run no head code. (ii) `latestReleaseTag` takes the first `v*` tag by version order: a tag pushed on an unmerged PR commit is the baseline (O10: the PR passes against its own weaker contract). (iii) The record is an ADR file the PR itself adds: a `Status: Proposed` ADR with one `Supersedes ADR-0016` line that names the operations passes (O7); `docs/03-architecture/adr/` is not security-owned. That matches D-TASK015-03 ("omission, not forgery") but should be written down |
| Exploitability / impact | Silent pass of a breaking contract change or a swapped checker, from a collaborator with an owned-path edit (record catches it) or a tag push (nothing catches it) |
| Remediation | (i) `env: {}` and an exact anchored run line for the new gate, as the lane B entry has; compare `--image` to the script's own `OASDIFF_IMAGE` constant (base-ref copy) and refuse a different value. (ii) `git tag --list 'v*' --merged "$base"` with the strict version regex of code review R1-M2 (b); optionally require annotated tags. (iii) Own `/docs/03-architecture/adr/` or require `Status: Accepted` on the base-ref copy of the named ADR; document the residual in api/README section 18 |
| Verification | Mutations M25, M26, M28 flagged; a tag-on-branch case (O10) fails; an ADR with `Status: Proposed` is refused if (iii) is taken |
| Owner / due | (i) and (ii): fix cycle (= code review R1-m2, R1-M2 (b)), before `v0.1.0-m0`; (iii): architect note plus 015-C |

### PR33-SEC-04: PR-controlled spec strings reach the job log and summary unescaped (INFO)

`openapi-breaking.mjs:307` prints `${change.id}: ${change.text} (${changeKey})` for each uncovered ERR change, and `toMarkdown` (`:269`) puts the same values into a table. oasdiff text contains names from the head spec. Probe O11: a head required query parameter whose name carries an escaped newline followed by a `::warning` command produces a stdout line that starts with `::warning` (also in `--json` mode, where the lines follow the JSON). The runner would execute it as a workflow command (`set-env` and `add-path` are disabled by default, so the effect is annotation forgery, `::add-mask::`, `::stop-commands::`). CWE-117 · A09:2021. Fix: replace `\r`, `\n` and any C0 control in every interpolated value (`replace(/[\u0000-\u001f\u007f]/g, ' ')`), escape `|` and backticks in the table, and print through one helper. Test: the O11 fixture expects no line starting with `::`. Owner: next touch of the tool (fix cycle if open, else 015-C).

### PR33-SEC-05: PR4-SEC-13 residual: two typegen-evaluated files and the new guard tests are still unowned (INFO)

`react-router typegen` (inside `npm run lint` and `npm run typecheck`) evaluates `apps/*/react-router.config.ts` and `apps/*/app/routes.ts`; both are unowned (probe of head CODEOWNERS), as are `.prettierrc`, `.size-limit.json` and the three new guard tests `tools/repo/{jest-config-owned,coverage-scope,root-scripts}.test.ts` (the typegen pin is also in the owned `tools/lint/negative-fixtures.test.ts`). Any code run in fast-lane before a later gate can append to `$GITHUB_ENV` or `$GITHUB_PATH`, which no porcelain check can see, so the post-lint porcelain gate is an accident guard and a narrow-window tamper guard, not a boundary; the boundary stays `scans` plus ownership plus the record (as ci.yml already says for PR10-SEC-02). CWE-1220 · A04:2021. Fix: add `/apps/*/react-router.config.ts`, `/apps/*/app/routes.ts` and `/tools/repo/` to CODEOWNERS and `REQUIRED_CODEOWNED_PATHS` with the usual mutation test. Owner: 015-C (before G3).

### PR33-SEC-06: the US-006 gate cases are produced but not required, and the gate runs nowhere in CI (INFO)

`heavy.mjs:703` appends the seven `coverage gate:` cases to the evidence of a coverage suite; `required-suites.json` (`unit.required_cases: []`) is untouched, so the base-ref verifier accepts a run that has none (code review R1-m1 shows the line can be deleted with every test green). Lane A runs no coverage and `coverage:diff` is unwired (D-TASK015-11). The committed run proves the cases exist today (overall and `packages/authz` pass; pricing, audit, ledger inactive). Gate analysis: absent required package, package with measurable source and no summary entry, zero lines, malformed counters and a missing summary are all errors; counts, not rounded percentages, are compared; Jest keeps 85/75 as a second tripwire. The structural `!**/{tests,fixtures}/**` exclusion also hides production code placed under such a folder inside a critical package; accepted as a code-review matter. CWE-693 · A04:2021. Fix: add the four `coverage gate: ...` names to `unit.required_cases` in a manifest-only follow-up (needs a record), and the merged `test:coverage` plus `coverage:gate` hook in 015-B or lane C (code review R1-m4); G3 needs the gate transcript either way. The D-QA-003 money paths (code review R1-M3) are a quality scope question and I agree with it. Owner: qa-lead / 015-B, before G3.

### PR33-SEC-07: `nonCanonicalNpmExec` does not recover shell-expanded command words (INFO)

360 generated spellings (all three `exec` words `exec`, `x`, `exe` that npm 11 derefs, 15 option prefixes including `--yes`, `-y`, `--prefix`, `--package`, `-w`, `--workspace`, `-ws`, `--include-workspace-root`, 8 tails) give 0 mismatches against the rule "only `npm (-w <ws> )*exec --no -- <bin>` passes"; the 53 hand-written forms (quotes, backslash, `npm.cmd`, `npm-cli.js`, absolute path, `env`, `command`, subshell, backtick, `sh -c`) also behave. Not recovered: `npm $'x' foo`, `npm ${V:-x} foo`, `npm "$CMD" foo`, `npm "$(echo x)" foo`, `npm {x,y} foo` (same as code review R1-m5), and `./node_modules/.bin/npx` (pre-existing, no such file ships). Verified with the real npm and a registry stub: `npm exec --no` never fetches a tarball even with `npm_config_yes=true` or `npm_config_package=...` in the environment (only the packument GET happens, then "canceled due to missing packages and no YES option"), so the environment variables are not a lever. Verdict on the bypass fix: complete for literal command lines. CWE-693 · A08:2021. Fix: treat `$` or a backtick among the words before the first `--` as non-canonical. Owner: 015-C.

### PR33-SEC-08: requirements for the future `gitleaks-full` runner that the baseline relies on (INFO)

gitleaks also honours a commit-less line `path:rule:line`: it suppressed that line in every commit (probe G6: 16 of 17 findings remain after one such line). The pin that every line is `<40 hex>:<path>:generic-api-key:<n>` therefore lives only in a head unit test (`sec-static.test.ts`, owned). Abbreviated commits, upper-case and shifted line numbers do not suppress (G5, G10, G11: 17 findings); CRLF is accepted (G12). CWE-693 · A08:2021. The 015-B runner must: extract the file from the base or gate ref with `git show`, validate every non-comment line with the same regex and the exact count before mounting, mount it read-only with `--gitleaks-ignore-path`, scan the gate SHA's ancestry (not `--all`), keep `--network none` and `--ignore-gitleaks-allow`, and have an integration case for 17 lines (0 findings), 16 lines (1) and a commit-less line (rejected before the scan). Owner: 015-B, before `gitleaks-full` leaves `planned`.

## 5. Gitleaks baseline (real image, v8.30.1, `--network none`, tip `c48910d`)

| Case | Findings |
|---|---|
| G1 first-parent history, no baseline | 17 (all `generic-api-key`) |
| G2 / G3 same, baseline with comments / lines only | 0 / 0 |
| Fingerprint set of G1 and of G7 versus the 17 baseline lines | equal (diff 0 lines) |
| G4 baseline minus one line | 1 |
| G5 every line number +1 | 17 |
| G6 one commit-less `path:rule:line` line | 16 (see PR33-SEC-08) |
| G7 / G8 whole ancestry without first-parent, no baseline / baseline | 17 / 0 |
| G9 lane A form `origin/main..head` (PR range) | 0 |
| G10 / G11 / G12 abbreviated commit / upper case / CRLF | 17 / 17 / 0 |

The baseline lines added by this PR are not themselves findings (G9; lane A `gitleaks` step green). Loaded from the base or gate ref: not yet implemented (PR33-SEC-08). Cannot be widened by a PR without a record: `/tools/quality/` is owned, and the file format is pinned by `sec-static.test.ts` (17 lines, three commit prefixes, 15 in `openapi.yaml`). `.gitleaks.toml` is untouched.

## 6. CODEOWNERS and `REQUIRED_CODEOWNED_PATHS`

`checkCodeowners(head CODEOWNERS)` returns no finding; the base CODEOWNERS fails exactly the 8 new required paths (positive control). Each new line deleted alone gives one finding for it. The `patternToRegExp` change (leading `**/` also matches at the root) widened ownership only: old versus new regex over the head CODEOWNERS own the same 994 tracked paths today; the ownership gain of 516 paths comes from the added lines (`tools/db` 343, `prisma/*` 96, `apps/api` 55; 8 of the 516 are new files in folders that were already owned). The old narrower lines are kept on purpose, so folding them later is not a silent loss. The record check reads patterns from base and head, so the new ownership applies to this very PR.

Consequence for the queue: after this PR merges, #20 and #32 (both change `apps/api/src/platform/**`), #29 and #16 (workspace `package.json` files) will need a security record on their next round. That is the intended cost of PR24-SEC-04 and PR26-SEC-07, not a defect.

## 7. `__mocks__` confinement

Jest 30.5.2, `projects`-shaped config, planted `apps/x/__mocks__/fake-pkg.js` and `packages/y/src/__mocks__/@sc/pkg.js`: with the head patterns both test cases receive the real modules (2 passed); with the old patterns both receive the planted files (2 failed). The repository rule on 15 trees: flags a `__mocks__` directory at the root, deep, scoped, in a dot folder and in a Jest root, and any tracked `node_modules/` path (also nested); clean on a tree without them, a case variant, a file called `__mocks__.js`, and the shipped head extract. A symlinked `__mocks__` directory is not flagged (the walk uses `isDirectory()`), which does not matter because Jest's crawler skips symlinks; the tree invariant for symlinks is PR31-SEC-02 (015-C).

## 8. Bootstrap immutability (head CLI, base CLI as the positive control)

| Scenario | Head | Base |
|---|---|---|
| Edit a released file (code, or a comment only) | exit 1 `released-changed` | exit 0 |
| Delete a released file | exit 1 | exit 0 |
| Rename a released file | exit 1 (delete plus out-of-order add) | exit 0 |
| Replace a released file with a symlink (120000) | exit 1 | exit 0 |
| Add a file that sorts after the last released one | exit 0 | exit 0 |
| Add a file that sorts before it, including `90-aaa.sql` and `90-audit-ddl-guard-b.sql` (`-` sorts before `.`) | exit 1 | exit 0 |
| README edit, `.SQL` extension, nested folder (the runner ignores all three) | exit 0 | exit 0 |
| Edit and revert in two commits | exit 0 | exit 0 |
| Edit a file that main added, after merging main | exit 1 | exit 0 |
| Existing migration rule (control) | exit 1 | exit 1 |

The check uses the same code-unit comparison and `.sql` suffix test as `tools/db/bootstrap.ts`, so the two cannot disagree. A gitlink replacing a released file is hidden by a worktree `ignore = all` (PR31-SEC-01 class) but the runner then fails on a directory, so it is not a content bypass.

## 9. oasdiff gate behaviour (head `openapi-breaking.mjs`, real image)

| Scenario | Result |
|---|---|
| O0 no release tag / O1 unchanged against the tag | skip, exit 0 / pass, exit 0 |
| O2 first path removed, no record | fail, exit 1, 1 uncovered |
| O3 ADR names the operation, no `Supersedes` line / O4 `Supersedes`, names nothing / O5 qualifying text in another folder | fail / fail / fail |
| O6 superseding ADR names the operation / O7 same with `Status: Proposed` | pass / pass |
| O8 `--image` without digest / O9 other digest-pinned image | exit 2 refused / accepted, pull attempted (PR33-SEC-03) |
| O10 tag pushed on the PR branch | pass against the PR's own contract (PR33-SEC-03) |
| O11 newline in a PR-controlled name | `::warning` line on stdout (PR33-SEC-04) |
| Linux modes | PR33-SEC-02 |

The sanctioned-break persistence defect (every later PR red until the next tag) and the substring record match are code review R1-M2 (a) and (c); I concur, they are not repeated here.

## 10. check-evidence, heavy, lock and licences

`check-evidence.mjs` gains one refusal (`--event push` with `--profile wave` or `gate` exits 2) and nothing is relaxed; staleness, the mode guard, activation and the manifest are untouched, so the PR #23 and #31 controls are unchanged. `heavy.mjs` only appends cases before `done()`, which scrubs every case (PR28-SEC-02 choke point); the committed run `20261113T1051Z_2e17530` has 0 hits for all 16 host labels and 11 generic shapes, and its 12 IPv4 hits are unspecified, loopback, link-local and RFC 1918 literals from SSRF tests while its one e-mail is on a reserved domain. The run is accepted by the base-ref verifier (code review reproduced PASS) and goes stale if main is merged (code review section 4).

Dependencies: `package.json` changes only `scripts` (`typegen`, `coverage:gate`, `coverage:diff`); `package-lock.json` is byte-identical to the merge base; the new tools import only `node:` modules; no licence, signature or advisory surface changed. The oasdiff image is a CI tool pulled by digest (Apache-2.0).

## 11. Routing and checkpoints

| ID | Sev | Owner | Due |
|---|---|---|---|
| PR33-SEC-02 | LOW | senior-developer, fix cycle (= code review R1-M1) | before `v0.1.0-m0` (preferably in this PR) |
| PR33-SEC-03 (i), (ii) | LOW | senior-developer, fix cycle (= R1-m2, R1-M2 b) | before `v0.1.0-m0` (preferably in this PR) |
| PR33-SEC-03 (iii) | LOW | principal-architect note, 015-C | before G3 |
| PR33-SEC-01 | LOW | senior-developer: with the pin rewrite if one happens, else 015-C | before G3 and before any further pin |
| PR33-SEC-04, -05, -07 | INFO | 015-C (or next touch) | before G3 |
| PR33-SEC-06 | INFO | qa-lead / 015-B | before G3 |
| PR33-SEC-08 | INFO | 015-B (gitleaks-full runner review) | before `gitleaks-full` activates |
| PR25-SEC-01 runner half | LOW | 015-B | before `gitleaks-full` activates and before G3 |
| PR4-SEC-13 item 4 | INFO | principal-architect (ADR-0023 am. K note) | with the next ADR-0023 amendment |

Round 2: the code review requires a fix cycle, so the head will move. A fix commit that touches `tools/ci/**`, `tools/quality/**`, `.github/**`, `jest.config.ts` or `package.json` voids this record (clause (d)); R2 is a delta round on the fix commits. If the fixes are limited to `openapi-breaking.mjs`, `check-workflow-policy.mjs`, their tests and `ci.yml`, I will re-run: M01 to M34, O0 to O11, part L, and the 360-case exec matrix. Evidence for the final head needs a fresh `quality:heavy --profile pr` on an ancestor (staleness once main is merged).

ASVS L2 (touched): V1.14 build and deploy hardening, V14.1 (CI gates, pinned images), V14.2 (dependency and supply chain), V8 data protection for logs (V7.1 for PR33-SEC-04). No new runtime surface, no new dependency, no secret.

## 12. Verdict

| Item | Value |
|---|---|
| Critical / High / Medium open | 0 / 0 / 0 |
| LOW open | 3 (PR33-SEC-01, -02, -03) plus PR25-SEC-01 runner half |
| INFO open | 5 (PR33-SEC-04 to -08) |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** Ten earlier findings implemented: PR4-SEC-11, PR4-SEC-13 (items 1 to 3), PR17-SEC-09, PR21-SEC-04, PR23-SEC-06 (as amended), PR24-SEC-04, PR24-SEC-06 (immutability half), PR25-SEC-02 and PR26-SEC-07 are CLOSED; PR25-SEC-01 is half closed (artifact verified exact, runner half is 015-B); PR10-SEC-08 not reopened. No new lever from the D-ORCH-021 list. This record names head `3ed0484`; the follow-ups that matter before the first release tag are PR33-SEC-02 and PR33-SEC-03 (i), (ii), which coincide with the code review's MAJOR fixes |

## 13. Record check simulation (`check-security-owned-paths --pr 33`)

Method: `git clone --shared --no-checkout` of the main checkout (nothing written to its `.git`), head `3ed0484` checked out detached, this record committed on top, base `origin/main` (`9a69797` at run time), `tools/ci` extracted from `origin/main` ("main tool", what CI runs today) and from the head ("head tool", what runs after this PR merges). The PR changes 28 owned paths (`.github/CODEOWNERS`, `ci.yml`, `jest.config.ts`, `package.json`, 18 in `tools/ci`, 2 in `tools/lint`, 4 in `tools/quality`). All 25 scenarios behaved as predicted.

| Case | Scenario | Result |
|---|---|---|
| A, A+ | record committed on top of the head; main tool / head tool | pass, satisfied by this record at `3ed0484` |
| A2, A2+ | then a real merge of current main into the branch; main tool / head tool | pass (main's owned changes `eslint.config.mjs`, `tools/tsconfig.json`, `package-lock.json`, `packages/shared/package.json` are not in the PR's net change) |
| B | no record | missing |
| C | record file named for PR 34 | missing |
| D, D2, D3, D4 | final Verdict FAIL / PENDING / a later FAIL row after the PASS row / no Verdict row | missing (the last Verdict row wins) |
| E, E2, E3 | Head row names `10b1db2` (an owned path changed after it) / names the main tip / removed | missing |
| F | owned `tools/ci/coverage-gate.mjs` edited after the named head | missing |
| G | unowned `tools/repo/zz.test.ts` added after the named head | pass |
| H, I, O | `prisma/README.md`, `packages/shared/package.json`, `apps/api/src/platform/db/zz.ts` changed after (owned only through lines this PR adds; the checker reads base and head CODEOWNERS) | missing (owned count 29) |
| J | `.github/workflows/ci.yml` edited after | missing |
| K | a line appended to `tools/quality/gitleaks-baseline.txt` after (baseline widening) | missing |
| L | `apps/x/__mocks__/pg.js` added after | missing |
| M / M+ | root `__mocks__/pg.js` added after; main tool / head tool | pass (old regex needs a leading folder) / missing (the `patternToRegExp` change makes `**/` match at the root) |
| N | `apps/web/react-router.config.ts` edited after | pass (still unowned, PR33-SEC-05) |
| P | an owned change after the record, then a second record that names the new head | pass, satisfied at the new head |

A fix cycle that touches any of the 28 owned paths needs the Round 2 delta record described in section 11; commits that touch only unowned paths (G) keep this record valid.

*Housekeeping:* the clone, the extracts, the registry stub and the Jest tree were removed from the scratchpad; `docker.lock` was acquired and released three times with an owner file; no container other than the probes' own was started; the main checkout (apart from this record) and the TASK-015 worktree were not written, and no command was run inside that worktree. The final record text was scanned with the pinned gitleaks image in `dir` mode: 0 findings.
