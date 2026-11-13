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
