# PR-0035 / TASK-277: test-ID traceability tooling: `quality:trace`, `quality:gherkin-map`, `quality:flake-report` (senior-developer / devops-engineer)

| Field | Value |
|---|---|
| PR | #35 `feat(quality): test-id traceability tooling, trace, gherkin map, flake report (TASK-277)`, branch `feat/TASK-277-test-id-traceability-tooling-quality`, https://github.com/sukhchdit/shipcube/pull/35. Three commits (`66bf1d8` trace, test-id library and flake report; `6636f9e` gherkin map generator and the suite-assignments file; merge `76808c8`). Base `55d6474` (the `main` tip when this round was written, and the merge's second parent, so `base...head` is exactly the PR's own change and the merge adds no `main`-side owned path). +2,317 / -1 lines, 11 files. |
| Head | 76808c8c35407bd2f3b9c1f6a0cd162e6f66c314 |
| Lane A evidence | Run [43455151593](https://github.com/sukhchdit/shipcube/actions/runs/43455151593) on `76808c8` (`pull_request`). Green: classifier, base-ref gate tooling, workflow policy, install flags, migrations, lockfile, cooldown, install, licences, signatures, audit, **Gitleaks (PR commit range)** and **Semgrep**. Red, both as expected: "Lane B evidence" (base-ref `check-evidence`: no accepted run for the required suite `unit`; orchestrator-owned) and "Security-owned paths need a review record" (this record). The evidence failure skips lint, format, type-check, unit and build in CI; section 2 (h) gives my substitutes. |
| Owned paths changed | 10, per the base-ref `check-security-owned-paths` (section 10): `package.json`, `tools/quality/trace.mjs`, `trace.test.ts`, `gen-gherkin-map.mjs`, `gen-gherkin-map.test.ts`, `flake-report.mjs`, `flake-report.test.ts`, `lib/cli.mjs`, `lib/test-ids.mjs`, `lib/test-ids.test.ts`. The eleventh file, `docs/05-quality/tests/gherkin-suite-assignments.json`, is unowned. |
| Reviewer / date | security-analyst, 2026-11-13, round 1. Read-only. Git commands ran in the main checkout against commit SHAs (after `git fetch`) or in a scratch `git clone --shared`; probes ran on `git archive` extracts and scratch roots. **No Docker** (host Docker Desktop is hung); nothing here needs it, because the only required lane B suite is `unit`. The shared scratchpad was wiped once mid-round; the probe results below are the ones recorded before the wipe, and the fixes in section 3 were re-verified afterwards. |

## 1. Summary

PR #35 adds three read-mostly CLIs under the security-owned `tools/quality/`: `quality:trace` extracts `AT-`, `NT-`, `SEC-TC-` and `J-` IDs from a lane B run's JUnit files and writes `ac-trace.json` (coverage ratios, orphans); `quality:gherkin-map` regenerates `gherkin-test-map.md` from the story files plus a committed suite-assignments file; `quality:flake-report` lists mixed-outcome tests over the stored runs. It adds no dependency, no workflow and no change to `check-evidence.mjs`, `lib/junit.mjs`, `lib/manifest.mjs` or the manifests.

**What holds.**
- **No evidence content is ever executed.** The five new sources contain no `eval`, `Function`, `child_process`, dynamic `import()` or environment read. Input is read with `readBounded` (lstat, regular file only, 5 MiB cap) and the existing strict JUnit parser (XXE-safe, 5 MiB, 200,000 cases).
- **`--run` is confined as documented.** 22 spellings on this Windows host: the 7 that name the real run directory resolve to it; the 15 others (child, parent, the runs directory itself, outside the repository, relative traversal out, upper-case SHA, a file, a missing name, NTFS stream suffix, trailing dot or space, `\\?\` prefix, empty string, and two junctions named like a run) are refused. The default (latest) selection skips junctions, files and malformed names (section 2 (b)).
- **JSON handling is clean.** Five assignments-file attacks (`__proto__` at the top level, in `stories`, `suite_lanes` and `overrides`; `constructor` and `toString` as suite names) pollute nothing; `stableJson` keeps an own `__proto__` key as data.
- **stdout is safe for a workflow log.** `trace` prints counts, a validated run name and regex-bounded IDs; `flake-report` prints `JSON.stringify` output, which escapes CR and LF: with hostile test names (CR, LF, `::error::`) 0 lines start with `::` under LF or CR/LF splitting.
- **`check-evidence` is not weakened.** Its files and manifests are untouched; the base-ref copy decides. D-TASK277-03 ("`ac-trace.json` is not committed into run directories") is enforced: a commit adding it to the newest run directory makes the base-ref `check-evidence` FAIL, a docs-only control passes (section 2 (e)).
- Lane A Gitleaks and Semgrep green; my Gitleaks emulation over the 2,317 added lines: 0 findings (positive controls fire). D-ORCH-021 levers, lock and base-ref gates: unchanged (section 6).

**What does not hold.** Two LOW and three INFO:
- **PR35-SEC-01 (LOW):** the three tools write through symlinks (`writeFileSync`), `--out` is unconfined, and `trace` defaults to a path inside the evidence directory.
- **PR35-SEC-02 (LOW):** the `Scenario:` line regex is quadratic. One 80 KB line stalls the parser for 4 s; the 5 MiB cap allows hours. Lane A's unit run reads the real story files, so a docs-only PR can hang it.
- INFO: tool messages echo repository-controlled text unescaped (PR33-SEC-04 class), not reachable from CI today (03); the wording of D-TASK277-03 is stale (04); `quality:gherkin-map --check` exits 1 on this head because five stories outgrew the assignments file (05).

**Findings: 2 LOW, 3 INFO. Nothing Critical, High or Medium.** Verdict in section 11.

## 2. What was checked

| | Check | Result |
|---|---|---|
| (a) | Execution and imports. `git grep` of the five sources for `eval`, `new Function`, `child_process`, `spawn`, `exec*`, `import(`, `require(`, `process.env` | None. Only `node:fs`, `node:path`, `node:url`, `node:crypto` and the local libs |
| (b) | `--run` handling: `resolveRunDir` on a scratch root, 22 spellings (list in section 1), junction and file-named-like-a-run fixtures, default selection | As described in section 1. Intermediate path components are not checked, only the last (`lstat`): on Linux a committed symlink at `docs/05-quality/tests/runs` would be followed (PR35-SEC-01) |
| (c) | JSON and prototype pollution: `parseAssignments` with five hostile files, `stableJson` with an own `__proto__` | No pollution; `proto_in_stories`, `proto_in_lanes`, `proto_in_overrides` and the `constructor` suite name are refused (`MapError`); a top-level own `__proto__` is accepted and ignored |
| (d) | Output: `main()` with captured `io` for `trace` (NFR cell with a CR, run name), `flake-report` (test names built from `&#10;`, `&#13;`, `&#8232;`, `&#8233;` and `&#x85;` entities that put a `::` command after each), `gen-gherkin-map` (JSON keys holding a line feed) | `flake-report` stdout: 0 `::` lines under LF and CR/LF splits (3 appear only if U+0085, U+2028, U+2029 count as line ends, which they do not for a .NET line reader to my knowledge; not re-verified). stderr text from `trace` and `gen-gherkin-map` carries repository text raw: PR35-SEC-03 |
| (e) | D-TASK277-03 and `check-evidence`. Shared clone at `main`; commit B1 adds `ac-trace.json` to `docs/05-quality/tests/runs/20261113T1409Z_e02c4f9/`, commit B2 adds an unrelated docs file; base-ref `check-evidence --profile pr` on each | B1: FAIL ("run ... added or changed by this range fails integrity": `unlisted file ac-trace.json (every file needs a SHA-256 in summary.json)`). B2: PASS. PR35-SEC-04 |
| (f) | Cost of the regexes: scaling probes at 4x sizes on hostile input (`ANY_ID`, `NFR_PART`, `tableCells`, `SCENARIO_LINE`) | Linear except `SCENARIO_LINE`: PR35-SEC-02 |
| (g) | Real data: head tools on the head's own docs and latest committed run (`20261113T1409Z_e02c4f9`) | `quality:trace`: must-AC 62 of 1,593, 94 IDs, 0 orphans, 0 problems, exit 0. `quality:flake-report`: 9 runs, 4,198 tests, 0 mixed, exit 0. `quality:gherkin-map --check`: exit 1 (PR35-SEC-05) |
| (h) | Lane A skipped lint, type-check, unit. Substitutes on the head extract: ESLint (real config) on the 9 source and test files: clean (control run on the PR #34 extract: an unused variable is reported); `tsc -b tools` (covers the `.mjs` files with `checkJs`): clean, an injected type error is reported (control); the four new test files: 32 passed | Real `npm run lint`, `format:check` and `build` not run |
| (i) | Secrets. Gitleaks v8.30.1 default rules emulated in Node (222 rules compile; runtime positive controls for a GitHub token, an AWS id and a generic key fire) over the 2,317 added lines | 0 findings |

## 3. Findings

### PR35-SEC-01: the tools write through symlinks, `--out` is unconfined, and `trace` writes into the evidence directory by default (LOW)

| | |
|---|---|
| Severity | LOW (Impact M: overwrites one file with a JSON document of IDs and counts; Likelihood L: needs a symlink committed into the repository and an operator running the tool on a POSIX host; a Windows checkout without `core.symlinks` cannot create one) |
| CWE / OWASP | CWE-59 Link Following · A01:2021 |
| Location | `trace.mjs:312, :316`, `gen-gherkin-map.mjs:259, :276`, `flake-report.mjs:156` |
| Description | `writeFileSync(out, ...)` opens the path without `O_NOFOLLOW`, so a symlink at the output path, including a committed `docs/05-quality/tests/runs/<run>/ac-trace.json`, is followed and its target overwritten. `--out` is any path (`resolve(...)`): probe, `--out` pointing outside the root overwrote the file there. A pre-planted **hard link** at `<run>/ac-trace.json` was overwritten in place (this host refused to create a file symlink without developer mode, EPERM, so the symlink variant rests on the open(2) semantics, not on a run). `resolveRunDir` checks only the last path component, so a committed symlink at `docs`, `runs` or an intermediate folder is followed on POSIX. The default output is `<run>/ac-trace.json`, i.e. into a directory that `check-evidence` hashes |
| Exploitability / impact | A hostile branch checked out on a Linux host, then `npm run quality:trace` or `quality:gherkin-map` run by an operator, overwrites a file of the attacker's choosing with deterministic JSON or Markdown. The content is not attacker-shaped beyond IDs and counts, so the harm is destruction (a config or a hook file), not execution |
| Remediation | One shared writer in `lib/cli.mjs`, used by all three tools: `export function writeOutput(root, out, text) { const rel = relative(root, out); if (rel.startsWith('..') \|\| isAbsolute(rel)) throw new UsageError('--out must be inside --root'); const tmp = `${out}.${process.pid}.tmp`; writeFileSync(tmp, text, { flag: 'wx', mode: 0o644 }); renameSync(tmp, out); }`. `rename` replaces a link instead of following it. In `resolveRunDir` compare `realpathSync(path)` with `realpathSync(runsDir)` plus a separator. Make `--out` mandatory for `trace` unless it is called from `heavy.mjs` with the staging directory (see PR35-SEC-04) |
| Verification | A test that plants a hard link (and, where the platform allows, a file symlink) at `<run>/ac-trace.json` and asserts the target's bytes are unchanged after the run; `--out ../x` exits 2; a run directory reached through a symlinked parent is refused |
| Owner / due | senior-developer, in the PR #35 fix cycle if there is one, otherwise before `quality:trace` is called from `heavy.mjs` (the `ac-trace` suite activation, T-QA-02) and before G3 |

### PR35-SEC-02: `SCENARIO_LINE` is quadratic on a long whitespace run, and lane A's unit run reads the real story files (LOW)

| | |
|---|---|
| Severity | LOW (Impact L: availability of a CI job or a local tool; Likelihood L: needs a hostile docs change, whose author can already add any slow test; but docs paths are unowned and review-light) |
| CWE / OWASP | CWE-1333 Inefficient Regular Expression Complexity · A05:2021 |
| Location | `lib/test-ids.mjs:141` `const SCENARIO_LINE = /^\s*Scenario( Outline)?:\s*(.*?)\s*$/;`, used at `:175` for every line inside a ```gherkin block |
| Description | `(.*?)\s*$` backtracks over a whitespace run once per lazy step. Probe, `Scenario: a` + N spaces + `b`: N = 10,000 takes 42 ms, 20,000 takes 169 ms, 80,000 takes 3,155 ms (x4 size gives x18.6). `MAX_MAP_BYTES` is 5 MiB, so one 5 MB line extrapolates to hours. `gen-gherkin-map.test.ts:25-26, :38, :72, :85` and `test-ids.test.ts:27-28, :119` call `loadStories(repoRoot, ...)` on the checked-out PR's real `docs/01-requirements/stories/EPIC-*.md`, so lane A's unit job parses PR-controlled text; the same call runs in `quality:trace` and `quality:gherkin-map` |
| Exploitability / impact | A docs-only PR (no owned path, no record) hangs lane A's unit step until the job timeout. No data impact. All other regexes of the PR scale linearly (ratios 2.6 to 4.5 at x4 size) |
| Remediation | `const SCENARIO_LINE = /^\s*Scenario( Outline)?:(.*)$/;` and `title: scenario[2].trim()`. Verified: on all 17 real story files (2,171 scenarios) the parse is identical to the head's; 7 whitespace variants identical; the hostile line takes 0.3 ms at 80,000 spaces and 15 ms at 4,000,000 (head: 4 s at 80,000) |
| Verification | Keep the scaling test as a ratio, not an absolute: `time(8k) / time(1k) < 16` on the `a` + spaces + `b` line; the equivalence check above as a unit test over the real stories |
| Owner / due | senior-developer, same cycle as SEC-01 (two lines), otherwise before G3 |

### PR35-SEC-03: tool messages echo repository-controlled text unescaped (INFO)

Same class as PR33-SEC-04, not reachable from CI today because no workflow or lane B runner calls these tools. `gen-gherkin-map.mjs:62, :68, :80` interpolate raw JSON keys of the assignments file into `MapError`, which `main` prints to stderr: probe with a key holding a line feed gives a stderr line that starts with `::error::` (3 of 3 shapes; a clean key gives one line). `test-ids.mjs:355` prints 20 characters of a Run cell of `nfr-traceability.md`: a bare CR plus `::notice::` in the cell gives a physical line that starts with `::` when split on CR (the runner's .NET line reader splits on a lone CR, to my knowledge; not re-verified). `trace.mjs:176, :185-190` and `flake-report.mjs:47, :65-70` print `relPath(...)` of file names, and a POSIX file name may hold a line feed (`relPath` keeps it). Effect if wired into a workflow: annotation forgery, `::add-mask::`, `::stop-commands::` (`set-env` and `add-path` are off by default). CWE-117 · A09:2021. Fix: use the `clean` helper of `tools/ci/openapi-breaking.mjs:127` (control characters, DEL, C1, U+2028 and U+2029 become a space) in a shared `lib/cli.mjs` `safe()` that every `io.err` and `io.out` line passes through, and print echoed fragments with `JSON.stringify(...).slice(0, 80)`. Owner: senior-developer, due before the first workflow or lane B runner calls these tools (015-C or the `ac-trace` activation).

### PR35-SEC-04: D-TASK277-03 states the wrong reason and the default output sits in the evidence directory (INFO)

The decision says `check-evidence` rejects `ac-trace.json` as an unknown file and that allow-listing it "belongs to 015-B/C or the Wave-0-exit activation". The name is already allow-listed: `check-evidence.mjs:71-91` (`FIXED_RUN_FILES`, `:80-81` name `flake-report.json` and `ac-trace.json`) and `heavy.mjs:431-444` (`FIXED_FILES`, `:443`). What rejects the file is the rule "every file other than `summary.json` / `summary.md` needs a SHA-256 in `summary.json`" (`check-evidence.mjs:476-478`), verified in section 2 (e): an unhashed `ac-trace.json` in a run directory makes the run tampered and fails the check, which is the right outcome. Two consequences: (1) what the activation PR must add is the lane B producer (a `suite-runners.json` entry and a `heavy.mjs` step that writes the file into the staging directory before `summary.json` is hashed), not an allow-list entry; (2) an operator who runs `quality:trace` on an already committed run directory and commits the result breaks that run's evidence. Safer default: no default `--out` (stdout, or a path outside `docs/`), and `heavy.mjs` passes `--out <staging>/ac-trace.json`. Owner: orchestrator (log a correction of D-TASK277-03), senior-developer (default).

### PR35-SEC-05: `quality:gherkin-map --check` exits 1 on this head (INFO)

Probe on the head's real docs: "qa-lead must classify 5 stories: US-066 (12 scenarios in the story file, 8 classified); US-121 (7, 6); US-129 (10, 5); US-137 (8, 7); US-222 (10, 8)". The generator fails closed as designed (D-TASK277-01), but it means the drift guard is red today and cannot be wired into a gate until qa-lead updates `gherkin-suite-assignments.json`. Not a security matter; listed so the orchestrator does not wire `--check` into lane A before that. Owner: qa-lead.

## 4. Design notes (no finding)

- **Trust model.** The tools run on the operator's checkout (lane B host, developer machine), over files a PR author controls: story files, maps, run directories. The controls are bounded reads, a strict XML parser, anchored regexes (one exception: SEC-02) and refusal of symlinks for inputs. The output side (SEC-01, SEC-03) is the weak half.
- **ID extraction.** IDs come from test names and class names, and a `describe` title applies to its tests (D-TASK277-04). A test title that merely mentions an ID counts as coverage. That is a deliberate evidence-quality trade-off, not a boundary; `required_cases` in the base-ref manifest remains the exact-ID control for security suites (`check-evidence`).
- **Coverage semantics are conservative:** a skipped test makes an AC "not covered" and a SEC-TC "not passing"; an orphan ID or an unparseable JUnit file exits 1.
- **Memory.** `flake-report` loads every run directory (each at most 5 MiB and 200,000 cases) with no aggregate cap; `quality:prune` bounds the number of runs. Informational.

## 5. Probe inventory

`trace-probe.mjs` (22 `--run` spellings, output and injection checks, assignments attacks, regex scaling), `flake-probe.mjs` (hostile test names), `gen-inject.mjs` (JSON-key echo), `scenario-fix.mjs` (the SEC-02 fix against the real stories), `record-sim.mjs`, `gl-emul.mjs`, `added-lines.mjs`. All under the session scratchpad, which is session-scoped (and was wiped once; re-create from section 2 if gone).

## 6. D-ORCH-021 levers, lock delta, base-ref gates

- `git diff origin/main...76808c8 -- .github` is empty: `RANGE_BASE`, `BASH_ENV`, `PATH`, `BASH_FUNC_*`, `defaults.run`, folded `run: >` on gate steps and `$GITHUB_ENV` / `$GITHUB_PATH` writes: none changed.
- `package-lock.json`: no change. `package.json`: three added scripts (`quality:trace`, `quality:gherkin-map`, `quality:flake-report`, each `node tools/quality/<name>.mjs`, no `npx`, no lifecycle hook). No dependency, `overrides` or `.npmrc` change.
- `tools/ci`, `tools/deps`, `.gitleaks.toml`, `.gitleaksignore`, `eslint.config.mjs`, `tools/tsconfig.json`, `check-evidence.mjs`, `lib/junit.mjs`, `lib/manifest.mjs`, `required-suites.json`, `suite-runners.json`, `summary.schema.json`: unchanged. No weakening of a base-ref gate.

## 7. D-SEC-PR23-02 interim controls (evidence pending)

| Control | State on this head |
|---|---|
| Lockfile PR states the `node_modules/ajv` entry and no non-`@platform` `link:true` entry | Not applicable: no lockfile change |
| No `wave` or `gate` run committed | True: no run directory in the diff |
| Evidence commit's gate table states `npm ci --ignore-scripts` + `deps:rebuild` before `quality:heavy` and an empty `info/exclude` | **Pending.** No lane B evidence exists for this head. The only required suite is `unit`, which needs no Docker, so the orchestrator can produce it while Docker is down; its gate table must carry that statement |

## 8. What this review could not prove

- The real `npm run lint`, `format:check` and `build`, and any Linux behaviour (symlinks, file names with line feeds, `O_NOFOLLOW` semantics), were not run on this Windows host. The symlink variant of SEC-01 and the CR line-splitting of the runner (SEC-03) rest on documented behaviour.
- The tools were run on the head's docs and on scratch roots, not under a real lane B run.

## 9. Routing and checkpoints

| Item | Severity | Owner | Due |
|---|---|---|---|
| PR35-SEC-01 | LOW | senior-developer | PR #35 fix cycle if any, else before `heavy.mjs` calls `quality:trace`, before G3 |
| PR35-SEC-02 | LOW | senior-developer | same cycle (two lines), else before G3 |
| PR35-SEC-03 | INFO | senior-developer | before any workflow or runner calls the tools |
| PR35-SEC-04 | INFO | orchestrator (correct D-TASK277-03), senior-developer (default output) | with the `ac-trace` activation |
| PR35-SEC-05 | INFO | qa-lead | before `--check` is wired anywhere |
| Lane B evidence (`unit`) | process | orchestrator | before merge |

Checkpoints: the `ac-trace` activation PR adds the producer into the staging directory (not an allow-list entry) and gets its own record; `quality:gherkin-map --check` joins lane A only after the assignments file is current.

ASVS L2 (touched): V12.3 file execution and path handling (SEC-01), V5.1 input validation (SEC-02), V7.1 log content (SEC-03), V14.2 dependencies (no change). No runtime surface, no new dependency, no secret.

## 10. Record check simulation (`check-security-owned-paths --pr 35`)

Method: `git clone --shared` of the main checkout (nothing written to its `.git`), base `55d6474`, head `76808c8`, this record copied into the clone's working tree, the base-ref `tools/ci` from `origin/main`, scenario commits built with plumbing on top of the head.

The tool reads the record from the clone's working tree. 17 scenarios, all as predicted (the record text used is this file; the sim script names it `PR-0035-sim-security-review.md`). Owned count 10.

| Case | Scenario | Result |
|---|---|---|
| A, A2 | record as written / Head row abbreviated to 7 hex | pass, satisfied at `76808c8` |
| B | no record | missing |
| C | record file named for PR 34 | missing |
| D, D2, D3, D4 | final Verdict FAIL / PENDING / a later FAIL row after the PASS row / no Verdict row | missing (the last Verdict row wins) |
| E | Head row names the first PR commit `66bf1d8` (owned paths changed after it) | missing |
| E2 | Head row names the `main` tip (not a commit of the PR) | missing |
| E3 | Head row removed | missing |
| F | owned `tools/quality/trace.mjs` edited after the named head | missing |
| G | unowned `docs/05-quality/zz-sim.md` added after the named head | pass |
| J | `.github/workflows/ci.yml` edited after the named head | missing (owned count 11) |
| K | `package-lock.json` re-added with identical bytes | pass (no net change) |
| P | an owned change after the record, then a round-2 record naming the new head | pass, satisfied at the new head |
| Q | the same with a FAIL round 2 | missing |

At the end of the round `origin/main` had moved to `e8829ef`: docs and `.claude/agent-memory` only since `55d6474`, so no owned path overlaps this PR and no merge-only round is needed on that account.

The base-ref checker is the one from `main` (this PR changes nothing under `tools/ci`). PR10-SEC-21 (an older round's head row stays bindable) is unchanged and still open.

## 11. Verdict

| Item | Value |
|---|---|
| Critical / High / Medium open | 0 / 0 / 0 |
| LOW open | 2 (PR35-SEC-01, -02) |
| INFO open | 3 (PR35-SEC-03 to -05) |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No evidence content is executed, `--run` is confined to a non-symlink child of the runs directory (22 spellings), JSON handling is free of prototype pollution, stdout is safe from workflow-command injection, `check-evidence` and the manifests are untouched and still reject an unhashed `ac-trace.json` (verified), D-ORCH-021 levers, lock and base-ref gates unchanged, Gitleaks emulation clean. Two LOW follow-ups (symlink-following and unconfined output; a quadratic regex that lane A's unit run can reach) are due as routed in section 9, not blocking; take both, and SEC-03, in any fix cycle, because a fix commit on an owned path voids this record and needs a round 2. Lane B evidence (`unit`, no Docker needed) is the orchestrator's merge precondition. |

## Round 2 (head 907b6a2, delta + merge)

| Field | Value |
|---|---|
| PR | #35, branch `feat/TASK-277-test-id-traceability-tooling-quality`, round 2 after fix cycle 1. Base: merge base with `main` `6420f90` (the merge's second parent); `main` when this round was written: `8e71ef5`, docs and `.claude/agent-memory` only since `6420f90` (and since round 1's base `55d6474`), so no merge-only round is owed. |
| Head | 907b6a2e971ea6d4014e5c5eda2796a71e15e9b8 |
| Commits since round 1 (`76808c8`) | `013a053` merge of `origin/main` (`6420f90`, D-065 story order); `07ba7a0` `fix(quality): confine tool output, pin trace guards, linear scenario regex` (9 files under `tools/quality`, +556/-57: the three tools, `lib/cli.mjs`, `lib/test-ids.mjs` and four test files); `907b6a2` `test(evidence): heavy lane pr 07ba7a0 pass` (4 files in the new run directory, docs only). |
| Lane A evidence | Run [43471372682](https://github.com/sukhchdit/shipcube/actions/runs/43471372682) on `907b6a2`. `fast-lane`: 33 of 33 steps success, including "Lane B evidence (quality:check-evidence)", Lint (ESLint, Stylelint, suppressions), Format check, Type-check, Unit tests, Build and both "must not mutate the tree" steps. `scans`: Gitleaks (PR commit range) and Semgrep success; the only red step is "Security-owned paths need a review record", whose input is this record. Because the evidence step now passes, lint, type-check, unit and build ran in CI on this PR for the first time: no substitute runs were needed. |
| Lane B evidence | Run `20261113T1711Z_07ba7a0` (profile `pr`, suite `unit`), accepted by the base-ref `check-evidence` (section R2.5). `907b6a2` only adds its four files. |
| Owned paths changed | 10, unchanged set: `package.json` (unchanged since round 1) and nine `tools/quality` files; the fix commit touches the nine. The eleventh file of the PR, `docs/05-quality/tests/gherkin-suite-assignments.json`, is unowned. |
| Reviewer / date | security-analyst, 2026-11-13, round 2, acting with code-reviewer's round 2 in one pass (separate sections). Read-only: git commands ran in the main checkout against commit SHAs (after `git fetch`) or in a scratch `git clone --shared`; probes ran on `git archive` extracts of `907b6a2` and `76808c8` (the latter as the positive control). The PR worktree was not touched. No Docker. |

### R2.1 Summary

The fix commit does what round 1 asked, and the probes confirm it rather than the tests' own words: the output channel is now one shared module (`lib/cli.mjs`: `resolveOutput`, `writeOutput`, `firstLink`, `clean`, `safeIo`) used by all three tools, the scenario regex is linear, and every changed guard has a killed mutant.

- **PR35-SEC-01 (LOW): closed.** `--out` must be a file inside `--root` and outside `docs/05-quality/tests/runs`; every existing component below the root must be a real directory (symlinks and junctions refused), an existing target must be a regular file, and the bytes go to a fresh `wx` temporary file that is renamed over the target, so a hard link is replaced, not written through. `quality:trace` no longer defaults into the evidence directory (`reports/ac-trace.json`) and refuses a run directory reached through a link. Positive control: the same four attacks against round 1's build all land (hard link overwritten, `--out` outside the root written, junction written through, default output inside the run directory); against the head none does.
- **PR35-SEC-02 (LOW): closed.** `SCENARIO_LINE` is `/^\s*Scenario( Outline)?:(.*)$/` plus `.trim()`: 0.6 ms at 80,000 spaces (round 1's pattern: 12.5 s on this host today), 31 ms at 4,000,000; the real parser needs 23 to 88 ms on 4 MB lines of six shapes, ratio 4.4 for 4x size (linear). Identical parse of the 17 real story files (2,171 scenarios, LF and CRLF forms).
- **PR35-SEC-03 (INFO): closed.** Hostile keys and cells now print as one cleaned line of at most 2,000 characters (round 1's build: 4 and 1 lines starting a workflow command on the same inputs, the head: 0).
- **PR35-SEC-04 (INFO): code half closed, wording open.** The default output left the evidence tree; D-TASK277-03 on `main` still states the old default and the old reason (orchestrator).
- **PR35-SEC-05 (INFO): open.** `quality:gherkin-map --check` still exits 1 on the same five stories (13 scenarios appended after the classified ones); D-065 removed the renumbering risk and `quality:trace` now lists the 13 as `must_ac.unmapped`.
- **PR35-SEC-06 (INFO): new.** The evidence-tree guard compares path segments textually, so an explicit `--out` spelled with the 8.3 alias of `docs/05-quality` bypasses it on a Windows host with 8.3 names (operator-chosen argument; the write is still confined and link-free).

Merge `013a053` is a pure union with no path outside `docs/` and `.claude/agent-memory/`. Evidence accepted; host-label scan 0; Gitleaks emulation 0 findings over the delta; D-ORCH-021 levers, lock and base-ref gates unchanged. **Findings after this round: 0 Critical, 0 High, 0 Medium, 0 LOW, 3 INFO (04 partly, 05, 06).** Verdict in R2.9.

### R2.2 Closure checks, finding by finding

**PR35-SEC-01 (output confinement, links, default location).**

| Check | Result |
|---|---|
| Code path | `trace`, `gen-gherkin-map` and `flake-report` call `resolveOutput(root, requested, default)` before any work and `writeOutput(root, out, text)` to write; `trace.resolveRunDir` first runs `firstLink(root, runsDir)`, so a link at `docs`, `docs/05-quality`, `.../tests` or `.../runs` is refused (message names the root-relative path only). No other write path exists in the five sources (grep: no `writeFileSync` outside `cli.mjs`) |
| 21 `--out` spellings on a scratch root | 7 refused as evidence tree (plain, upper-case, `./` segment, `..` segment, the runs directory itself, a run subdirectory, an NTFS stream suffix), 5 refused as outside the root (`\\?\` prefix, `../`, absolute elsewhere, the root, the empty string), 1 refused by the OS (`::$INDEX_ALLOCATION`), 8 accepted: trailing dot, trailing space, dotted `docs.`, two 8.3-style spellings that name no existing alias, two sibling names (`runs-extra`, `runs2.json`) and a plain `reports/ok.json`. The evidence directory held only its run directory afterwards: the first five created separate, literally named directories on this host (re-checked by listing the files), so they are not a bypass. A genuine 8.3 alias of `05-quality` is a bypass: SEC-06 |
| Links | hard link at the target: replaced, the other name keeps its bytes; junction at the target, at the parent (`reports`) and in the middle of the path: refused with a message, nothing written to the link target; directory at the target: refused; a hard link or a junction planted at the temporary name: `EEXIST` from the `wx` open, no write-through, the victim unchanged. A file symlink could not be created on this Windows host (EPERM, no developer mode); the unit tests create real symlinks on the Linux runner (`symlinkSync` ignores the `junction` type there) and lane A's unit step is green |
| Positive control (round 1's build, same attacks, scratch root) | hard link: victim OVERWRITTEN; `--out` outside the root: WRITTEN; junction at the parent: WRITTEN through; default output: INSIDE the evidence run directory. Head: unchanged / not written / not written / `reports/ac-trace.json` |
| Mutants of the writer and resolver | 13 mutants, 11 killed. Survivors: `wx` to `w` on the temporary file (would need a file named after the process id; defence in depth) and the regular-file or directory check (a directory at the target still fails one step later at the rename, same exit code) |
| Residual | (a) a concurrent writer that swaps a directory for a link between the `lstat` walk and the write needs write access inside the repository tree, which already is the attacker's goal; (b) `--root` itself may be a link (operator chosen); (c) the generic error path prints the OS message, which can carry an absolute path on stderr (`EEXIST ... open '<path>'`); operator console only |

**PR35-SEC-02 (quadratic regex).**

| Check | Result |
|---|---|
| Timings, `Scenario: a` + N spaces + `b` | round 1 pattern: 10,000 = 336 ms, 20,000 = 1,166 ms, 80,000 = 12.5 s (a loaded host; 3.2 s in round 1); head pattern: 80,000 = 0.6 ms, 1,000,000 = 6 ms, 4,000,000 = 31 ms |
| The real parser on 4 MB lines (inner, trailing, leading, only after the colon, tabs, a non-matching line) | 41, 71, 65, 51, 23 and 88 ms; 4,000,000 / 1,000,000 spaces: ratio 4.4 |
| Equivalence on the real stories | 17 files, 2,171 scenarios, 0 differences between the round 1 and the head parser, with LF and with CRLF line ends |
| Differential fuzz, 400,000 random lines over the grammar and the confusing characters | 68,445 differ, every one of the form "old matches, new does not" with a CR, U+2028 or U+2029 in the leading or trailing whitespace of the title (old `\s` swallowed it, new `.` stops at it). The 17 real story files contain none of those characters; `STORY_HEADING` already behaved this way. Not a security matter (a scenario would be dropped, which the parser-versus-`grep` count and the drift test notice); reported to code review as R2-n4 |
| Other regexes added by the fix (`ID_LIKE`, `ID_PREFIX`) and the helpers (`clean`, `safeIo`, `extractIds`) | 11 hostile shapes x 5 functions at 1 MB and 4 MB (55 cases): maximum ratio 5.4 for 4x size, slowest case 0.31 s at 4 MB |
| Test pin | the unit test (1,000,000 spaces, bound 2 s) fails a regression only by hanging: the reverted pattern blocks the worker (the mutant is killed by my 90 s timeout), and with `.trim()` dropped Jest needs more than 90 s to diff two 1 MB strings. Detected, not fail-fast: code review R2-n3 (use 60,000 spaces and a ratio) |

**PR35-SEC-03 (unescaped repository text on stderr).** `main` of each tool wraps its `Io` in `safeIo` (stdout lines cleaned, every stderr message one cleaned line capped at 2,000 characters); `clean` maps C0 (including CR and LF), DEL, C1 (including U+0085), U+2028 and U+2029 to a space. Probe through the real `main` with a scratch root: an assignments key holding LF, CR, U+2028, U+2029 and four workflow commands gives 1 stderr message and 0 lines starting with `::` after splitting on LF, CR, U+2028, U+2029 and U+0085 (round 1's build: 4); an `nfr-traceability.md` Run cell with CR, U+2028, U+0085 and three commands gives 1 message, 0 command lines (round 1: 1); a 100 KB key gives a 2,000-character message (round 1: 100,100). Eleven mutants of `safeIo`, `clean` and the three wrappers: 11 killed. No `console.*` or `process.std*` call exists in the three tools or `lib/cli.mjs` outside `CONSOLE_IO`, which is reachable only through the wrapped default.

**PR35-SEC-04 (default location; D-TASK277-03).** Default `--out` is `reports/ac-trace.json`; the writer refuses the evidence tree for every `--out` spelling that is textually inside it. `check-evidence` is unchanged (base-ref copy decides; the "every file needs a SHA-256" rule still rejects an unhashed `ac-trace.json`, verified in round 1). Still open: (1) D-TASK277-03 at `main` `8e71ef5` (DECISIONS.md line 1952) names `<run>/ac-trace.json` and "check-evidence rejects unknown files", both stale; TEST-STRATEGY §6 rule 2 and §15 still say "into the run directory" (they wait for the `quality:heavy` attachment hook); owner orchestrator (decision text) and qa-lead. (2) `reports/` is not in `.gitignore`, although a code comment says so, so a default run leaves an untracked file that `git add -A` commits; `.gitignore` is CODEOWNED, so the entry belongs in the next PR that touches an owned path (code review R2-n1). Neither affects an evidence directory.

**PR35-SEC-05 (`--check` exits 1).** Unchanged: exit 1 naming US-066 (12 scenarios, 8 classified), US-121 (7, 6), US-129 (10, 5), US-137 (8, 7), US-222 (10, 8). What D-065 changed: all 34 classified positions of these five stories now carry the same titles as the map (16 mismatches at `76808c8`), so IDs that tests already use are stable again. The 13 appended scenarios are exactly `must_ac.unmapped` in `ac-trace.json`. Owner qa-lead, before `--check` joins lane A.

### R2.3 New finding

**PR35-SEC-06: the evidence-tree guard does not see Windows 8.3 aliases (INFO).** `resolveOutput` compares textual path segments (case-insensitively) with `docs/05-quality/tests/runs`. On a Windows volume with 8.3 names the directory `05-quality` also answers to `05-QUA~1`, so `--out docs/05-QUA~1/tests/runs/x.json` passes the guard and the file lands in the evidence directory (probe: accepted, file present in `runs`; the control spelling `05-quality` is refused). Not reachable by repository content: `--out` is an operator argument, the write itself stays inside the root, link-free and atomic, and a committed stray file in a run directory still fails the base-ref `check-evidence` ("unlisted file ... every file needs a SHA-256"), as verified in round 1. CWE-41 Improper Resolution of Path Equivalence · A01:2021. Optional hardening: compare `realpathSync.native` of the deepest existing ancestor of the output path with the real evidence directory. Owner senior-developer, with the next change to `tools/quality`; no gate depends on it.

### R2.4 Merge verification

- `git merge-tree --write-tree 76808c8 6420f90` writes tree `805e7b4f`, which is exactly the tree of `013a053`: clean, no conflicts, nothing hand-resolved. The delta `76808c8` to `013a053` is 25 paths, all under `docs/` or `.claude/agent-memory/` (D-065 story edits in `EPIC-03`, `EPIC-06`, `EPIC-11`, `PRD.md`, records, decisions, memory); none under `tools/`, `.github`, `package.json` or `package-lock.json`.
- Owned set of the PR (`6420f90...907b6a2`, `--no-renames`): 11 paths = `package.json`, the nine `tools/quality` files, the unowned assignments file; plus the four run files; no owned path moved except the nine in `07ba7a0`.

### R2.5 Evidence run, host-label scan, secrets

- **Base-ref `check-evidence --profile pr`** (copy from `main` `8e71ef5`, run in a scratch clone at `907b6a2`, once with base `6420f90` and once with base `8e71ef5`): both PASS, "run 20261113T1711Z_07ba7a0 accepted". The run: `git_sha` `07ba7a0` (the fix commit, an ancestor of the head), `git_dirty` false, `build_clean` true, `env_overrides` empty, lockfile hash equals the head's `package-lock.json`, suite `unit` 3,779 tests, 0 failures, 0 errors, 2 skipped, coverage 95.92 % lines and 96.05 % branches (attached `coverage-summary.json` hashed). Older runs are reported as "not an ancestor", as designed.
- **Count-only host-label scan** (labels built at run time: OS user name, its 8.3 stem, home directory in two spellings, temp directory in two spellings, host name, the local part of the git e-mail, a `documents/projects` path fragment, `appdata`; values never printed): run directory 4 blobs, 879,950 characters: **0 hits on all 10 labels**. The scanner finds 10 of 10 needles in a synthetic text, and the same pipeline over 32 blobs (`tools/quality` and the assignments file) reports nonzero counts for `appdata` only (9, the environment-variable name in lane B tooling), so the `git show` path is live. Matches the gate table of the evidence commit ("0 hits, 4 files, 5 labels").
- **Gitleaks v8.30.1 default rules emulated in Node** (222 rules, 220 compile and one pattern does not translate; runtime positive controls for a GitHub token, an AWS access key id and a generic API key all fire): **0 findings** over the 10,381 lines added since `76808c8` (first-parent diffs, so the lines the main merge brings count) and over the 28,921 added lines of the whole `6420f90..907b6a2` range. Lane A's real Gitleaks step is green.
- **D-SEC-PR23-02 interim controls:** lockfile statement not applicable (no lockfile change); no `wave` or `gate` run committed (profile `pr`); the evidence commit's gate table states `npm ci --ignore-scripts` then `deps:rebuild` (exit 0 / exit 0), 0 porcelain lines and 0 non-comment `info/exclude` lines before `quality:heavy`.

### R2.6 D-ORCH-021 levers, lock delta, base-ref gates, execution surface

- `git diff origin/main...907b6a2 -- .github` is empty: `RANGE_BASE`, `BASH_ENV`, `PATH`, `BASH_FUNC_*`, `defaults.run`, folded `run: >` on gate steps and `$GITHUB_ENV` / `$GITHUB_PATH` writes: none changed.
- `package-lock.json` and `package.json`: no difference between `76808c8` and `907b6a2` (the three `quality:*` scripts of round 1 stand; no dependency, `overrides` or `.npmrc` change). `.gitleaks.toml`, `.gitleaksignore`, `eslint.config.mjs`, `tools/tsconfig.json`, `tools/ci`, `tools/deps`, `check-evidence.mjs`, `lib/junit.mjs`, `lib/manifest.mjs`, `heavy.mjs`, `required-suites.json`, `suite-runners.json`: unchanged.
- Execution surface of the five sources at the head: no `eval`, `new Function`, `child_process`, dynamic `import()`, `require`, `process.env`, network call or `process.chdir` (the only `import(` hits are JSDoc types and the matches of `.exec` are regex calls); `lib/cli.mjs` imports `node:fs`, `node:path`, `node:url` only.

### R2.7 Record-check simulation (`check-security-owned-paths --pr 35`)

Method: `git clone --shared` of the main checkout, detached at `907b6a2`; base-ref `tools/ci` from `origin/main` `8e71ef5` run from outside the clone (`--base 6420f90 --pr 35 --head HEAD --root <clone> --json`); scenario commits are real commits in the clone only; the record under test is this file as it will be committed (the checker reads the record from the working tree). 31 scenarios, all as predicted; owned count 10 (11 when `.github` is touched).

| Case | Scenario | Result |
|---|---|---|
| A, A2, A3 | record as written / Head row abbreviated to 7 hex / `--base` = `main` tip `8e71ef5` | pass, satisfied at `907b6a2` |
| B | the round 1 record only (what `main` and the merge carry today) | missing: "names 76808c8, but 9 tools/quality files changed after it" (this is the red lane A step) |
| C, C2 | no record / record file named for PR 34 | missing |
| D, D2, D6 | final Verdict FAIL / PENDING / lower-case token | missing |
| D3 | a later FAIL Verdict row after the PASS row | missing (the last Verdict row wins) |
| D4 | no Verdict row in the new round | pass, because the round 1 PASS row is then the last one: each round must append its own final row (procedural, PR10-SEC-04) |
| D5 | Verdict PASS_WITH_CONDITIONS | pass |
| E | Head row = the fix commit `07ba7a0` (the evidence commit after it is docs only) | pass, satisfied at `07ba7a0` |
| E2 | Head row = merge `013a053` (owned paths changed after it) | missing |
| E3, E5, E6 | Head row = `main` tip (not in the range) / the round 1 head / a non-hex token | missing |
| E4 | the new Head row removed (round 1 row remains) | missing |
| F, F2, F3 | owned `trace.mjs` / `lib/cli.mjs` / `package.json` edited after the named head | missing |
| G, G2 | unowned docs file added after / evidence run file edited after | pass (the second is `check-evidence`'s job, not this checker's) |
| H | `.github/workflows/ci.yml` edited after | missing (owned count 11) |
| I | `package-lock.json` deleted, then re-added with identical bytes | pass (no net change) |
| J | a real merge of newer `main` (`8e71ef5`, docs only) after the record | pass |
| K | `git revert` of the fix commit after the record | pass, satisfied at `76808c8`: the round 1 Head row still binds (PR10-SEC-21, unchanged and open); the tree is then the round 1 tree and the lane B evidence for `07ba7a0` would be stale |
| M | `--event push` | skipped |
| N | the new Head row inside a fenced block only | missing |
| O | an extra Head row naming a non-PR commit above the right one | pass |
| P | duplicate of A (identity transform; counted, not a control) | pass |

### R2.8 What this round could not prove

- File-symlink behaviour on a Linux host (no developer mode here: EPERM): the unit tests exercise it on the Linux runner and lane A is green, but I did not run it myself. Junction, hard-link, 8.3 and NTFS-stream behaviour is from this Windows host.
- The Docker-bound lane B suites other than `unit` (this PR needs only `unit`) and the real Gitleaks image (the emulator plus lane A's green step stand in).
- A race between the link walk and the write (section R2.2 residual (a)).

### R2.9 Verdict (round 2)

| Item | Value |
|---|---|
| PR35-SEC-01 (LOW) | **Closed.** Output confined to the root and outside the evidence tree, no link followed (components, target, temporary name), atomic replace; default `reports/ac-trace.json`; positive control on round 1's build lands all four attacks |
| PR35-SEC-02 (LOW) | **Closed.** Linear (31 ms at 4 MB), identical on the real stories, differential fuzz explained; the new regexes and helpers scale linearly |
| PR35-SEC-03 (INFO) | **Closed.** One cleaned, bounded line per message; 0 forged command lines against 5 on round 1's build |
| PR35-SEC-04 (INFO) | Open, wording only: D-TASK277-03 (orchestrator), strategy text (qa-lead), `/reports/` in `.gitignore` with the next owned-path change |
| PR35-SEC-05 (INFO) | Open: qa-lead classifies the 13 scenarios before `--check` joins lane A |
| PR35-SEC-06 (INFO) | New, optional hardening (8.3 alias of the evidence path with an explicit `--out`, Windows operator only) |
| Evidence and scans | Run `20261113T1711Z_07ba7a0` accepted by the base-ref checker (both bases); host-label scan 0 of 10 labels; Gitleaks emulation 0 findings; D-ORCH-021 levers, lock and base-ref gates unchanged; merge `013a053` a pure union |
| Critical / High / Medium / LOW open | 0 / 0 / 0 / 0 |
| INFO open | 3 (PR35-SEC-04 partly, -05, -06) |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** Both round 1 LOW findings and the INFO on unescaped output are closed with positive controls, the evidence run is accepted, the merge adds nothing outside docs, and the lever, lock and base-ref gates are unchanged. Remaining items are INFO and not blocking. A later commit on an owned path voids this record and needs a round 3, so take the code-review nits (R2-n1 to R2-n4) and PR35-SEC-06 with the next change to `tools/quality`, not in this PR; docs-only commits (the decision correction, STATUS) do not void it. |
