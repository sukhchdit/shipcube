# Code review: PR #23, TASK-011 (lane B local heavy lane and evidence integrity), round 1

| Field | Value |
|---|---|
| Reviewer | code-reviewer |
| PR | #23 `feat/TASK-011-lane-b-local-heavy-lane` |
| Head | f61e55d8a0b91aa64a276f90e42b0235c394a69c |
| Base compared | `origin/main` 84d9299 (merge base d38500a); PR #21 (62e4961) is on main |
| Date | 2026-11-13 |
| Round | 1 |
| **Verdict** | **CHANGES_REQUESTED** (1 MAJOR, 4 MINOR, 6 NIT) |

SUMMARY:
- The verifier is well built. The base-ref step works out of tree, hashing and tamper/reject handling are sound, the rename (d965629) is a pure rename, and all 25 check-evidence fixtures plus 121 tests under `tools/quality` pass. I found no way to forge or replay evidence beyond what the design admits (it is self-attested).
- One MAJOR: `tools/quality/**` (the verifier, manifest, schema, runners; about 4,900 lines) is not in CODEOWNERS. A later PR can weaken the gate that judges everyone else without a security record. The PR body and the manifest's `security_critical_paths` both say it is security-owned.
- Decision (8) active-only selection is accepted, but its stated reason is wrong for the code as written. Decisions (9), (10) and (11) are accepted with the notes in section 4.

## 1. What I verified myself, and what I did not

Run by me, in a `git archive f61e55d` copy with the worktree `node_modules` junctioned (worktree untouched, 748 modules before and after; junctions and temp repos removed):

| Check | Result |
|---|---|
| `jest --selectProjects unit --testPathPatterns tools/quality` | 8 suites, 121 tests, all pass (57 s) |
| **Base-ref step out of tree.** I copied `tools/quality` to a directory with no `node_modules` above it, pointed the 25 check-evidence fixtures at that copy, and gave each fixture repo its own `package.json` and `node_modules` junction. This is the real CI shape: script in `$RUNNER_TEMP`, `--root` = workspace. | 25/25 pass. Ajv is resolved from the checkout through `createRequire(root/package.json)`. CI never exercised this path (no run directory exists, so the validator is never loaded). |
| `prettier --check` on every changed file under tools/, .github/, package.json | clean |
| `prettier --check --ignore-path /dev/null tools/quality/required-suites.json` | warns, so the `.prettierignore` entry is needed (verbatim move). The entry is anchored and exact. |
| `git show -M --stat d965629` | `{docs/05-quality/tests => tools/quality}/required-suites.json  \| 0` (pure rename). Later diff is the `$comment` line only. |
| `check-security-owned-paths.mjs --base origin/main --head HEAD --pr 23` | owned = `.github/workflows/ci.yml`, `.prettierignore`, `package.json`, `tools/ci/ci-policy.test.ts`. **No `tools/quality/**` path.** See R1-M1. |
| JUnit parser probes (12 inputs) | all fail closed; see R1-n4 |
| Probe: all suites `planned`, a run with `unit/integration/rbac-matrix` JUnit committed | check **PASS**; run rejected "JUnit for a suite still 'planned' (rule 4)". See R1-m1. |
| Probe: same, with a tampered `unit.junit.xml` | check FAIL (touched + tampered). Tamper/reject split behaves as documented. |
| Probe: 31 newer junk runs, legit run touched | legit run still evaluated and accepted. Window can only deny, never forge. |
| Mutation: append `--report-only` to the base-ref `node` line of ci.yml | `ci-policy.test` "SEC-TC-48 (CI part)" **still passes** and `check-workflow-policy` exits 0. See R1-m2. |
| Union: `git merge-tree --write-tree origin/main f61e55d` | clean, tree dbf09fa. Both sides touched `package.json` and `tools/repo/root-scripts.test.ts`, both are additive. |
| PR #20 and PR #24 vs this head | zero file overlap, clean `merge-tree` |

Not re-run (relied on lane A run 43350657854 and the developer's table): lint, typecheck, full `test:unit`, `test:api`, `test:integration`, `test:coverage`, build, audit, gitleaks. Reason: the dispatch memory cap. Lane A on f61e55d: `fast-lane` success (it ran the new step in bootstrap mode: "no active lane B suite is required ... PASS (report-only)"); `scans` and `ci-gate` fail only on the missing security record. I did not run anything that needs Docker.

## 2. Findings

| ID | Sev | Where | Finding | Required fix |
|---|---|---|---|---|
| **R1-M1** | **MAJOR** | `.github/CODEOWNERS` (no line); `tools/ci/check-workflow-policy.mjs:851` `REQUIRED_CODEOWNED_PATHS` | `tools/quality/` is not code-owned. It holds the verifier, `required-suites.json` (the SEC-P3-31 base-ref manifest), `summary.schema.json`, `suite-runners.json` (arbitrary `cmd` arrays run by `quality:heavy`) and the heavy runner. The base-ref step stops a PR from weakening the rules that judge *itself*, but the PR that weakens them (flip a suite `active` to `planned`, lower `min_tests`, drop `unit` from `profiles.pr.always`, add `--report-only` handling) lands with no security record and then judges every later PR. Proof: the owned-paths checker on this very PR lists four owned files and none under `tools/quality/`. This contradicts the PR body ("Security-owned paths: ... `tools/quality/**`"), the manifest's own `security_critical_paths`, TEST-STRATEGY 9.3 ("every change needs security-analyst review"), platform.md 7.2 ("code-owned via CODEOWNERS") and the task sheet DoD. Same class as PR #4 R3-M1 (files moved to or created in a place no one owns). | Add `/tools/quality/   @sukhchdit` to CODEOWNERS and to `REQUIRED_CODEOWNED_PATHS`, plus the matching `checkCodeowners` mutation test (delete the line, expect `codeowners-*` finding). The PR is already security-record-gated through ci.yml, so no extra cycle is added. |
| R1-m1 | MINOR | `tools/quality/check-evidence.mjs:302` (`soft.push(... rule 4)`), TEST-STRATEGY 9.2 rule 4, manifest `planned_suite_reported` | Rule 4 says a JUnit for a `planned` suite "fails the check". The code only **rejects the run**; the check fails only if that run was needed. Probe: all suites `planned` plus a run containing `unit.junit.xml` gives check PASS. Also, decision (8) as described is wrong: the activation PR does **not** fail on its own evidence. Under the base manifest its suite is `planned`, nothing is required, and the check passes with the run rejected. The real exposure is the opposite: the activation PR's own run is never credited, and from the next PR on every code PR needs fresh evidence. | Orchestrator or qa-lead ruling, then either (a) keep the behaviour and reword rule 4 / manifest rule to "the run is not credited", adding a test that pins it ("planned JUnit, nothing required: PASS, run rejected"), or (b) make a touched run holding a planned-suite JUnit a `problem`, which forces the manifest-only activation PR first. I recommend (a): it also makes D-QA-010 ("activate in the PR that adds the first test") work. Either way correct the PR-body wording before it becomes D-TASK011-01. |
| R1-m2 | MINOR | `tools/ci/ci-policy.test.ts` (new test, `toContain` on the base-ref line) | The test pins the *prefix* of the base-ref `node` line. Appending `--report-only` to it (the checker always exits 0 with that flag) passes this test and `check-workflow-policy` (both verified by mutation). The head-copy line is pinned with `--report-only$`, the base line is not pinned at its end. Mitigated by ci.yml and the test both being security-owned, but it is a tripwire gap on the one flag that turns the gate off. | Assert that `--report-only` occurs exactly once in the step and on the head-copy line only; pin the base line with `$`. |
| R1-m3 | MINOR | `.github/workflows/ci.yml` new step; `check-evidence.mjs` `resolveCommit`/ancestry | The step is unconditional, and runs also on `push` to main when `CI_MAIN_FAST_LANE=true`. There the range is the squash commit, so every run's `git_sha` is a branch commit that is not an ancestor, and once suites are `active` main goes red ("no accepted lane B evidence"). `check-security-owned-paths.mjs` already skips `--event push` for this exact reason. Latent today (variable unset, no active suite). | Add `--event pull_request|push` to the checker (skip on push, like the owned-paths check) and pass `${{ github.event_name }}` through an `env:` variable, or state in the README that the push lane must not enable the step. |
| R1-m4 | MINOR | `tools/quality/check-evidence.test.ts` | No test for the run-selection logic that the PR body lists as a focus: the newest-30 window, "every run the range touches", untouched-and-tampered run (not a problem), touched-and-rejected-but-not-tampered run (not a problem), summary.json files that disagree across the three roots, a multi-root run at all. All fixtures use the `tests/` root and one run. | Add fixtures for: 31 runs (legit run touched beyond the window is still evaluated); untouched tampered run does not fail the check; roots disagreeing on git_sha/profile/stamp; a `security/` root run. |
| R1-n1 | NIT | `heavy.mjs:631` `jestToCases(readJson(outputFile))`, `:644` `readJson(coverageFile)` | The Jest branch has no try/catch (the command branch has). A report truncated by the suite-timeout kill throws out of `main`: exit 2, no evidence, no "malformed" case. Fail closed, but loses the diagnostics. | Wrap both reads and fall back to `malformed('jest', ...)`. |
| R1-n2 | NIT | `heavy.mjs:910-916` | The "run directory already exists" check runs inside the write loop, so a re-run in the same minute that adds a second evidence root can leave a half-written run. | Check all `out.dir` first, then write. |
| R1-n3 | NIT | `check-evidence.mjs:509`, SEC-TC-48 wording | In lane A the checkout is clean by construction, so "untracked files in code paths" is only meaningful when the checker is run locally. In CI the real signal is the self-reported `git_dirty`. Also `--untracked-files=all` does not show git-ignored files, so a source file hidden by `.git/info/exclude` or a global ignore evades both the heavy run and the checker. | Say so in the README ("How check-evidence decides" item 4); note it as a residual for security-analyst. |
| R1-n4 | NIT | `lib/junit.mjs:181` | The tag scanner ends a start tag at the first `>`, so a raw `>` inside an attribute value (legal XML; many third-party writers do not escape it) throws "attribute ... is not terminated". Any `<!DOCTYPE` inside CDATA (an e2e failure dump of an HTML page) is also rejected. Both fail closed, and the own writer escapes `>`; only the `converter: junit` command path (Playwright reporter, later) is affected. | No change now. Route to the TASK that wires the first `converter: junit` suite (T-QA-05 / TASK-015). |
| R1-n5 | NIT | `heavy.mjs` default `--out-root` | A `--suites` debug run (always INVALID) writes into the real `docs/05-quality` tree by default, so it can be committed by accident. The checker handles it (declared INVALID, never accepted), but it clutters `runs/` and pruning keeps it. | Default restricted runs to a temp `--out-root`, or print a "do not commit" line. |
| R1-n6 | NIT | docs | (a) `docs/05-quality/tests/security-test-cases.md:3` still links `required-suites.json` in its own folder (now broken). (b) The manifest `tooling_inputs` and the `docs-or-ci-only` exclude still name the old manifest path and `docs/05-quality/tests/schema/**` (the PR body already flags this for qa-lead; harmless because both new locations are non-docs and so always stale-making). (c) ADR-0023 am. B still names `docs/05-quality/tests/schema/heavy-run.schema.json`. | (a) fix the link; (b) qa-lead; (c) architect, with D-TASK011-02. |

## 3. Focus items

| Item asked | Result |
|---|---|
| Base-ref ci.yml step: no PR-controlled code in the check | The script, `lib/junit.mjs`, `lib/manifest.mjs`, the schema and the manifest all come from `git archive $RANGE_BASE tools/quality`, and the step imports nothing from the head tree except Ajv. Residual: Ajv and its four dependencies come from the head's `node_modules` (head lockfile, installed by the earlier `npm ci`). The lockfile-provenance and cooldown steps run before, and every later step runs head code anyway, so I rate this a doc point (R1-n3 neighbour), not a finding; "before any head code" in the step comment is slightly generous. The bootstrap branch runs the head copy with `--report-only`; it is selected only when the base has no `check-evidence.mjs`. Workflow-policy: no `if:`, no `continue-on-error`, no `${{ }}` in the script, placed after `npm ci` and before `deps:rebuild` (all pinned by the test). Gap: R1-m2. |
| check-evidence tamper vs reject split and hashing | Sound. Hash = SHA-256 of the git blob bytes; the writer hashes the same string it writes (LF, `eol=lf` attribute, no CR in JUnit or JSON). Hard facts (failures, skips, SEC-TC cases, dirty, build_clean, SKIP_) under a declared PASS are tampering; manifest-dependent differences (missing case, planned suite, `min_tests`) only reject. Only touched runs can fail the check as tampered. Declared FAIL or INVALID with a matching recompute is neither accepted nor tampered. Unsafe references, duplicate references, unlisted files, foreign suite names, size cap before reading, symlinks and submodules as strays: all handled. |
| Bounded scan: forge, or a stale run satisfying a newer head | Not forgeable beyond self-attestation. `git_sha` must be an ancestor and `git diff --no-renames git_sha head` must lie in the staleness allow-list; stamp and SHA are tied to the directory name. The window is ordered by the attacker-controlled stamp, so junk runs can push an older untouched run out, but that only causes a false FAIL (fail closed), and runs added by the range are always evaluated (probe). A run for an older SHA is accepted only if no non-docs path changed since, which is exactly the design. |
| Jest arg recording | `-i` and `--testTimeout` are added for `integration` and `api`, recorded once in `jest_args` from the same function that builds the args. Paths are placed before the variadic `--selectProjects`. CLI `--testTimeout` overrides per-project config; nothing in the repo calls `jest.setTimeout` outside the verifier test. Not enforced by the verifier (informational), which is acceptable for the folded flake item. |
| JUnit conversion robustness | Test file that fails to run becomes an error case; Jest exit non-zero with no failing case adds an error case; todo/pending count as skipped; malformed native reports give one error case; the writer drops XML-invalid characters, escapes `>` and CR/LF/TAB; the parser re-reads the writer output so counts match by construction. Findings R1-n1, R1-n4. |
| `.prettierignore` entry | Needed and minimal (verified). Anchored by the slash, exact file. Security-owned and already covered by the owned-paths list. |
| Manifest rename purity (d965629) | Pure rename (0 changed lines). Only `$comment` changes later (1 line). |
| Windows / Linux paths | `/` everywhere in git paths and run-directory names; `\` normalised in `matchGlob`, `rel()` and `relativiseCoverage`; `fileURLToPath`/`pathToFileURL` for the script and manifest; process-tree kill uses `taskkill /T` on Windows and a process group elsewhere; Jest path patterns are `/`-based and Jest converts them (my own run used one). No problem found. |
| Tests mapped to sheet lines | All four sheet acceptance bullets and every row of the PR table map to a real test. The two weak spots are R1-m1 (rule 4 semantic) and R1-m4 (selection logic). Mutation M-ci (R1-m2) shows the CI-part test is a prefix check. |
| Union with main 62e4961/84d9299, PR #24, PR #20 | Textually clean. Semantically nothing collides: PR #21 adds `tools/openapi/**`, `tests/api`, `tests/contract-stubs`, eslint ignores and root scripts; none touch `tools/quality`. The new `tools/**` and `tests/**` files are clean-tree paths for the checker, which is intended. PR #20 and #24 do not overlap any file. After this merges, the first PRs judged by the base-ref checker (PR #20, #24, #22) pass with "nothing required, all planned" as long as `ajv` resolves; it is lazily loaded, so nothing happens until evidence exists. |

## 4. Rulings on the developer decisions (for D-TASK011-01..04)

1. **(8) Active-only selection: accept.** Rule 5 (gate: all suites active or deferred) is the backstop that makes "nothing required today" safe, and the README states the current state. Correct the rationale (R1-m1): the activation PR does not fail; it passes with its run uncredited. Manifest-only pre-activation is therefore optional, not required. qa-lead should flip `unit` first, because `profiles.pr.always` makes it the first required suite on every code PR.
2. **(9) Schema at `tools/quality/summary.schema.json`: accept.** It is better than the ADR path: it is a base-ref input, a non-docs path (changes make evidence stale) and travels with the verifier. Architect to amend ADR-0023 am. B (R1-n6c).
3. **(10) One summary.json per root, `--suites` always INVALID, fast-lane record outside `runs/`: accept.** The checker requires the roots to agree. R1-n5 and R1-m4 are the follow-ups.
4. **(11) `unit` = unit + unit-dom: accept.** It matches `npm run test:unit` (`--selectProjects unit unit-dom`).

## 5. Good

- Evidence is read from git objects of the head, never the working tree.
- Glob matcher is a two-pointer algorithm with no regexp built from manifest text, with a pathological-input test.
- Parser: DOCTYPE and ENTITY rejected, five predefined entities only, size and depth bounded, declared counts must match (an edited attribute cannot hide a failure). Round-trip property test for the writer.
- Env values are never recorded, only names; host paths are scrubbed from messages and coverage keys; Gitleaks native values are redacted before commit.
- `heavy.mjs` shares the run-file allow-list pattern text with the verifier and validates its own summary against the schema before writing.
- An active suite with no runner entry is an error case, not a silent skip.
- Docs: README states the current "requires nothing" state and the three not-yet-implemented rules.

## 6. Merge conditions

1. **R1-M1 fixed**: `/tools/quality/` in CODEOWNERS, `REQUIRED_CODEOWNED_PATHS` and its test (mutation proof requested).
2. R1-m1 ruled (orchestrator, with qa-lead or architect) and the PR-body / D-TASK011-01 wording corrected; R1-m2 and R1-m4 fixed in-PR, or routed with an owner (TASK-015 for m2/m4 is acceptable).
3. R1-m3 fixed or recorded against TASK-015/TASK-222 (the push lane), before `CI_MAIN_FAST_LANE` is ever set.
4. Security record `docs/05-quality/security/PR-0023-*.md` whose head row names a commit at or after the R1-M1 fix (the fix touches CODEOWNERS and check-workflow-policy.mjs, both owned). Lane A is red on `scans` until then.
5. Squash merge (the PR is a mix of feat/chore/docs commits; only the squash header is linted). Lane A green on the exact head. Integration is not needed for this tooling PR; the developer's `test:integration -i` run is recorded.
6. Round 2 = delta check of the R1-M1 commit (CODEOWNERS line, required-path entry, test), the ci-policy pin if done in-PR, and a re-run of `merge-tree` against main. Expect APPROVED_WITH_NITS.

## 7. Routed items (owner)

- qa-lead: stale `tooling_inputs` / exclude entries; flip order for activation (`unit` first); `security-test-cases.md` link; D-QA-010 text to say the activation PR's run is uncredited.
- architect: ADR-0023 am. B schema path; rule 4 wording (R1-m1).
- TASK-015: R1-m2 pin if not done here; push-event handling (R1-m3); `converter: junit` parser limits (R1-n4); `journeys_required_at_gate` and "0 flaky" (already declared not implemented).
- security-analyst: R1-n3 residuals (ignored files, Ajv from head `node_modules`, self-attested evidence); R1-M1 confirmation.


---

## Round 2 (head c0b1b31)

| Field | Value |
|---|---|
| Head | c0b1b31a2a153892bc424e3adaf9a0d6b528dc83 (fix commits de1fae3, 8321ad0, 712e25d; two normal merges of `origin/main`, the second docs-only) |
| Base compared | `origin/main` 97bdd0a (merge base 6fd801f; main has moved by docs-only commits since the last merge) |
| Date | 2026-11-13 |
| **Verdict** | **APPROVED_WITH_NITS** (0 BLOCKER, 0 MAJOR, 0 MINOR, 3 NIT) |

SUMMARY:
- Every r1 finding is closed in code with a test that fails when the fix is reverted. I mutated the fixes in an extract and each mutation turned the intended test red (table below).
- The union with current main is clean; the only non-docs delta is the four `quality:*` scripts in `package.json`; `package-lock.json` is byte-identical to main.
- Remaining before merge is procedural: a security record naming `c0b1b31` (lane A is red on `scans` only for that reason).

### R2-1. What I ran myself

In a `git archive c0b1b31` copy with the worktree `node_modules` junctioned (worktree untouched: 748 modules, `git status` empty; junction and copy removed; no drive-root `node_modules`):

| Check | Result |
|---|---|
| `jest --selectProjects unit` on `tools/ci/ci-policy`, `tools/ci/check-workflow-policy`, `tools/quality/check-evidence`, `tools/quality/heavy` | 4 suites, 168 tests, all pass (101 s) |
| `check-security-owned-paths --base origin/main --head HEAD --pr 23` | the owned list now includes `tools/quality/check-evidence.mjs`, `check-evidence.test.ts`, `fastlane.mjs`, ... (r1: no `tools/quality` path). The checker reads patterns from base and head, so the new line is enough |
| `git merge-tree --write-tree origin/main c0b1b31` | clean, tree 0bf7e1a. `git diff --stat <tree> c0b1b31` shows only `STATUS.md` and the two untracked `.claude` agent-memory files (main's newer docs); no code. `git diff origin/main HEAD -- package-lock.json` is empty. `package.json` delta vs main: the four `quality:*` scripts only (the `openapi:*` scripts are already on main). |
| `gh pr view 23` rollup | `fast-lane` SUCCESS, `scans` FAILURE (security-owned-paths only, per the PR comment and the checker output above), `ci-gate` FAILURE |

Not re-run, relied on lane A run 43364590973 and the developer table: lint, typecheck, format, full `test:unit`, `test:api`, build, Gitleaks and Semgrep (both green in `scans`). No Docker, integration, e2e or coverage.

### R2-2. Mutation proof (my own, in the extract)

| # | Mutation | Result |
|---|---|---|
| A | delete the `/tools/quality/` line from CODEOWNERS | 7 failures in `check-workflow-policy.test.ts`, including the new "owns tools/quality and the path is required" and the generic "covers every required path" |
| B | drop `'tools/quality/'` from `REQUIRED_CODEOWNED_PATHS` | 5 failures (the four new `CODEOWNERS: tools/quality` tests and the pinned list) |
| C | append `--report-only` to the base-ref `node` line of ci.yml (my r1 mutation) | `ci-policy` "SEC-TC-48 (CI part, TASK-011)" fails. `check-workflow-policy` itself does not flag it; that is the known limit, the ci-policy tripwire is the guard |
| D | remove `--event "$GITHUB_EVENT_NAME"` from the base-ref line | 3 failures (mutation-proof test, the `--event` test, the TASK-011 test) |
| E | remove the `--event push` early return in `check-evidence.mjs` | 3 failures |
| F | accept any `--event` value | 1 failure ("rejects an unknown event with exit 2") |
| G | make a planned-suite JUnit a hard (tamper) problem instead of a soft reject | 2 failures (both rule-4 pins) |
| H | scan window 30 to 31 | 2 failures (window test, touched-run test) |
| I | drop the "every touched run" union from the evaluated set | 2 failures |

### R2-3. r1 findings: closure

| ID | Status | Evidence |
|---|---|---|
| **R1-M1** CODEOWNERS | **Closed** | `/tools/quality/   @sukhchdit` at `.github/CODEOWNERS` (with a comment naming the reason), entry in `REQUIRED_CODEOWNED_PATHS` (`check-workflow-policy.mjs`), pinned in the list test, plus a new describe with four tests: line deleted, ownerless, commented out, parent `/tools/` covers it, sibling `/tools/qualitys/` does not. Mutations A and B. Owned-paths checker now lists `tools/quality/**` |
| R1-m1 rule 4 | **Closed** | Behaviour kept (ruling (a)); wording changed consistently in `check-evidence.mjs` header and reason text, `required-suites.json` `planned_suite_reported`, `docs/05-quality/README.md` and TEST-STRATEGY 9.2 rule 4. All four texts say: the run is not credited; the check fails only if the run was needed; the first activation passes with its run uncredited; a later activation whose run also carries the newly activated suite is rejected as a whole. Three pinning tests (nothing required: PASS with the run rejected; active `unit` plus planned `integration` in one run: exit 1, "no accepted lane B evidence ... unit", not a tamper; the same run with only the active suite: accepted). Mutation G. The semantics match what I probed in r1 |
| R1-m2 `--report-only` | **Closed** | The echo text no longer contains the flag. The helper `laneBReportOnlyFindings` requires exactly one occurrence, on exactly the pinned head-copy line, and the base-ref line equal to the full pinned invocation (not a prefix). Nine mutations are exercised through the helper (appended, prepended, with a value, in a comment, dropped, doubled, `\|\| true`, event hard-coded, base line run from the head copy); the test asserts each one changed the text and produced a finding. My own mutations C and D agree |
| R1-m3 push range | **Closed** | `--event pull_request\|push` (default `pull_request`); `push` prints a note, appends a "skipped" block to `--summary` and returns 0 before any git call; an unknown value or a missing value exits 2. ci.yml passes `--event "$GITHUB_EVENT_NAME"` on both invocations and the step still has no `env:` (asserted). `GITHUB_EVENT_NAME` is runner-set, not attacker text, and is only quoted into an argument. Tests include a real squash commit whose evidence SHA is asserted not to be an ancestor (0 under `push`, 1 under `pull_request`). Mutations D, E, F. ci.yml triggers are only `pull_request` and `push`, so no other value reaches the step today |
| R1-m4 selection | **Closed** | New fixtures: 31 junk runs (window: 30 newest plus the touched legit run; 31st not evaluated), second touched run outside the window judged, untouched tampered run does not fail while the same run added by the range does, touched stale run is not a problem while another run is accepted, multi-root agree accepted, and a `it.each` for disagreement on profile, git_sha and stamp. Mutations H and I confirm they discriminate |
| R1-n1 | Closed | `jestCasesFrom` and `coverageFrom` in `heavy.mjs`, tests for missing, truncated, empty reports |
| R1-n2 | Closed | all `out.dir` are checked before the first write |
| R1-n3 | Closed | README item 4 states lane A is clean by construction and that git-ignored files evade the check (residual, PR23-SEC-05) |
| R1-n4 | Routed as ruled | first `converter: junit` task |
| R1-n5 | Closed | `resolveOutBase`: `--suites` runs go to a fresh temp dir unless `--out-root`, with a "do not commit" line; tested |
| R1-n6 | a, b closed; c routed | `security-test-cases.md` link fixed; dead manifest paths removed from `tooling_inputs` and `docs-or-ci-only.exclude`. ADR-0023 am. B path stays with the architect |

### R2-4. New findings

| ID | Sev | Where | Finding | Suggested fix |
|---|---|---|---|---|
| R2-n1 | NIT | `docs/05-quality/README.md` verdict list (item 3) | The list still says the recomputed verdict "is FAIL on ... a JUnit for a suite that is `planned`", then explains that it only rejects the run. A reader skimming the list gets the pre-fix reading. | Move the planned-suite case out of the FAIL list into its own sentence ("a run holding JUnit for a planned suite is rejected, not failed"). Docs only, any later docs PR. |
| R2-n2 | NIT | `check-evidence.mjs` `EVENTS`, `ci.yml` triggers | Unknown event exits 2 (as required). If a trigger such as `merge_group` or `workflow_dispatch` is ever added to ci.yml, lane A goes red on this step until `EVENTS` is extended, and per the ci.yml header the CLI changes in two steps (accept, then use), which the base-ref copy makes automatic. Fails closed, so it is the right default. | One sentence in the ci.yml header or the README: adding a trigger to ci.yml means extending `EVENTS` first. |
| R2-n3 | NIT | `check-workflow-policy.mjs` vs `ci-policy.test.ts` | The `--report-only` tripwire (mutation C) lives only in the unit test, not in the checker that runs from the base ref. Same residual as r1, now documented by the pin. Both files are CODEOWNED and security-gated, so it is acceptable. | None now; optional follow-up for TASK-015 (put a "`--report-only` at most once, bootstrap line only" rule into `check-workflow-policy`). |

GOOD (round 2):
- The mutation-proof helper pattern (`swap` plus a findings function asserted to change and flag every variant) is the right shape for tripwires on a security flag; reuse it for other gate invocations.
- The fix reuses the existing `check-security-owned-paths --event push` convention instead of inventing a new skip mechanism.
- Behaviour was not changed to make the wording right: ruling (a) was applied in four documents at once, with the same four statements.

SECURITY-FLAGS (for security-analyst round 2): (1) confirm PR23-SEC-01 / COND-PR23-1 by the CODEOWNERS line and `REQUIRED_CODEOWNED_PATHS` entry; (2) the owned paths changed after `f61e55d` are those listed in the PR comment, so the record must name `c0b1b31` (or a later commit with no owned path changed after it); (3) `--event "$GITHUB_EVENT_NAME"` is the only new data flowing from the runner into the verifier, quoted, never interpolated into the script; (4) PR23-SEC-03/04/05/06/07/10 stay routed per D-ORCH-028.

### R2-5. Merge conditions (round 2)

1. Security record `docs/05-quality/security/PR-0023-*.md` with verdict PASS / PASS_WITH_FOLLOW-UPS / PASS_WITH_CONDITIONS and a head row naming `c0b1b31` (or a later commit after which no owned path changed). Lane A `scans` and `ci-gate` are red only for this.
2. Lane A green (`ci-gate` success, not skipped) on the exact head that is merged. Main moved by docs-only commits since the last merge; a merge of it changes no owned path, but then the head SHA changes, so re-confirm the record names a commit with no owned-path change after it.
3. Squash merge with a linted subject and `--match-head-commit`.
4. Routed items as in section 7 above and D-ORCH-028; R2-n1..n3 may ride on any later docs or TASK-015 change.

No further code-review round is needed unless the head changes in a non-docs path.
