# PR-0036 / qa-lead gherkin map classification: 13 D-065 scenarios, map v1.1, empty KNOWN_DRIFT (D-QA-016)

| Field | Value |
|---|---|
| PR | #36 `chore(quality): classify 13 D-065 scenarios, gherkin map v1.1, empty KNOWN_DRIFT (D-QA-016)`, branch `chore/qa-gherkin-map-classify-d065`, https://github.com/sukhchdit/shipcube/pull/36. Two linear commits on the `main` tip `e4ecff2` (`e88bc46` the change, `3eb7689` the lane B evidence). Base `e4ecff25fd9352001e2158e729010b0aad9dfe1d`; main had not moved when this was written. |
| Head | 3eb7689ed2a85791fd39ee9ba05299a61919b295 |
| Lane A evidence | Run [43486331834](https://github.com/sukhchdit/shipcube/actions/runs/43486331834) on `3eb7689`. `fast-lane` green: 33 steps, 31 success and 2 skipped by design (the base-ref lint-fixture step and the Semgrep rule self-test run only when their inputs change); commitlint, lint, format, actionlint, type-check, unit, build and "Lane B evidence" all ran. `scans`: Gitleaks, Semgrep and oasdiff green; red only at "Security-owned paths need a review record" (expected until this record is committed). `ci-gate` red as the aggregate of that step. |
| Owned paths changed | 2, per the base-ref `check-security-owned-paths` (section 5): `tools/quality/gen-gherkin-map.test.ts` and `tools/quality/lib/test-ids.test.ts`. The other seven changed files are unowned: `docs/05-quality/TEST-STRATEGY.md`, `gherkin-suite-assignments.json`, `gherkin-test-map.md` and the four files of run `20261113T1845Z_e88bc46`. |
| Reviewer / date | security-analyst, 2026-11-14, round 1. Read-only. Probes ran on `git archive` extracts and a scratch `git clone --shared`; no Docker (nothing here needs it, the only required suite is `unit`). Disclosure: in the PR's own worktree, which was to stay read only, I ran read-only `git status`, `git log`, `git rev-parse`, `git branch --show-current`, `git check-ignore` and `ls`, and read the untracked `reports/ac-trace.json` for a count-only host-fragment scan. Nothing was written there. |

## 1. Summary

PR #36 is a qa-lead data and test-pin PR. It classifies 13 scenarios that D-065 appended to five Must stories (US-066, US-121, US-129, US-137, US-222) in `gherkin-suite-assignments.json`, regenerates `gherkin-test-map.md` (v1.0 to v1.1: 1,599 to 1,612 rows, 1,593 to 1,606 G3-counted), empties `KNOWN_DRIFT` in `gen-gherkin-map.test.ts`, updates the count pins in two owned test files, adds TEST-STRATEGY v1.4 and one lane B evidence run. No production code, tool, workflow, manifest, lockfile or configuration changes.

**What holds.**
- **The two owned test edits are a strengthening, not a weakening.** With the old tests, appending an unclassified scenario to US-066 or US-129, or renaming a scenario inside US-066, left all 32 tests green (the five stories were rebuilt from the map's own rows, so the comparison was circular for them). With the new tests the same mutants fail 3, 3 and 1 tests, and the generator's `--check` exits 1. A rename in a story that never drifted fails on both. The count pins are changed to the new truth, not removed; no `skip`, `only`, timeout or import change (section 3).
- **No other owned path.** The diff has 9 paths, all regular files (mode 100644), no mode change, no gitlink and no symlink (`git diff --raw --ignore-submodules=none`, so the PR31-SEC-01 blind spot is excluded). The base-ref `check-security-owned-paths` simulation reports exactly the two test files (section 5).
- **The evidence run is accepted** by the base-ref `check-evidence` (`PASS`), the lock and manifest hashes it records equal the head blobs, `git_dirty` is false, `env_overrides` is empty, the only change since the measured commit is docs (section 4).
- **Host fragments: 0** on 10 labels over the run directory and the whole diff (count only, positive control 10/10). Gitleaks: lane A green, my emulation 0 over 7,559 added lines (positive controls fire).
- **D-ORCH-021 levers and the lock: no delta.** No file under `.github/`, `tools/ci`, `tools/deps`, `tools/hooks`, `tools/isolated`, `.npmrc`, any `package.json` or `package-lock.json`, `jest.config.ts`, `tools/test-support`, `eslint.config.mjs`, `.gitignore` or `CLAUDE.md` changed; the lock, `package.json`, `.npmrc` and `required-suites.json` are blob-identical to the base (section 6).
- **Closes** PR35-SEC-05 (INFO): `quality:gherkin-map --check` exits 0 on this head (it exited 1 on the base).

**What does not hold.** One INFO, no Critical, High, Medium or Low:
- **PR36-SEC-01 (INFO):** TEST-STRATEGY v1.4 repeats the false statement that `reports/ac-trace.json` is git-ignored. It is not (carried from PR #35 R2-n1).

**Findings: 1 INFO.** Verdict in section 9.

## 2. What was checked

| | Check | Result |
|---|---|---|
| (a) | The diff: `git diff --raw --no-renames --ignore-submodules=none e4ecff2 3eb7689`; gitlinks in the head tree; symlink entries in the diff | 9 paths (3 `M` docs, 4 `A` run files, 2 `M` tests), all 100644; 0 gitlinks; 0 symlinks |
| (b) | The two owned test files, line by line | Only the `KNOWN_DRIFT` constant (now `string[] = []`), its comment and the count pins (1599 to 1612, 1593 to 1606). No `skip`, `only`, `todo`, `xit`, timeout, `eslint-disable` or import change |
| (c) | Does the committed map equal the generator output? `npm run quality:gherkin-map -- --check` on head and base extracts | head: `up to date`, exit 0; base: exit 1 naming the five stories (positive control). Row-by-row compare of the two maps through the real parser: 1,599 base rows 0 removed and 0 changed in any column, same order; 13 added; 1,612 rows, 1,606 G3, 218 stories; numbering contiguous in every story |
| (d) | Mutation controls on head and base tests | Section 3 |
| (e) | Evidence run `20261113T1845Z_e88bc46` | Section 4 |
| (f) | Owned-path record check, simulated with negative controls | Section 5, 22 of 22 as expected |
| (g) | Workflow levers, lock, supply chain | Section 6 |
| (h) | Secrets and host fragments | Lane A Gitleaks and Semgrep green on the head. Emulation: Gitleaks v8.30.1 default rules (222 rules, 220 compile), 7,559 added lines of the whole PR diff incl. the run directory: 0 findings; runtime-built positive controls (GitHub token shape, AWS key id shape, generic key) all fire. Host scan, count only: OS user name, its 8.3 stem, home dir (two spellings), temp dir (two spellings), host name, git e-mail local part, the project-path and AppData fragments: 0 in the four blobs of the run directory (879,950 characters), 0 in the full diff (909,733 bytes) and in the non-run part (20,298 bytes); positive control: all 10 needles found in a synthetic text. The author's untracked `reports/ac-trace.json`: 0 |
| (i) | TEST-STRATEGY v1.4 claims | `quality:trace` default output `reports/ac-trace.json`: true (my default run wrote it). A hand-placed `ac-trace.json` in the run directory makes the base-ref `check-evidence` FAIL "unlisted file ac-trace.json (every file needs a SHA-256 in summary.json)": true. "git-ignored": **false** (PR36-SEC-01) |
| (j) | Overlap with open PRs | #34 (`4643265`), #32 (`5eee2d0`), #29 (`1519283`), #16: none touches either owned file, the map or TEST-STRATEGY. A later main-merge into #36 would arrive as added lines only if main moves |

## 3. Not a weakening: mutation controls

Jest `unit` project over the two owned test files (32 tests) plus `gen-gherkin-map --check`, on a head extract and a base extract. Each mutant is applied to the extract and restored from the pristine copy.

| Mutant | New tests (head) | Old tests (base) |
|---|---|---|
| none | 0 failed; `--check` exit 0 | 0 failed; `--check` exit 1 (the drift this PR removes) |
| append an unclassified scenario to US-066 | 3 failed (byte-identical render, counts, drift ratchet); `--check` exit 1 naming US-066 | **0 failed** |
| the same to US-129 | 3 failed; exit 1 naming US-129 | **0 failed** |
| rename a scenario title inside US-066 (same count) | 1 failed (byte-identical render); exit 1 | **0 failed** |
| rename a title in a story that never drifted (US-067) | 1 failed; exit 1 | 1 failed |
| reclassify US-066-12 in the assignments without regenerating | 1 failed; exit 1 | not applicable (row absent on base) |
| hand-edit the suite cell of a new map row | 1 failed; exit 1 | not applicable |
| delete a new map row | 2 failed (render, 1612-row pin); exit 1 | not applicable |

So the drift check is stricter: until this PR a change to any scenario of the five stories could not fail a test. Two residual notes, both non-security: the ratchet assertion `named` equals `KNOWN_DRIFT` depends on a message shape when the list is empty (code review R1-n1), and the substitution bridge is unexercised while the list is empty (R1-n4).

## 4. Lane B evidence

| Check | Result |
|---|---|
| Base-ref `check-evidence --profile pr --base e4ecff2 --head 3eb7689`, from the base-ref copy, in a clean scratch clone | `run 20261113T1845Z_e88bc46 accepted`; verdict `PASS`. The ten older runs print "not an ancestor of the head", as after every squash |
| `summary.json` facts | `git_sha` e88bc46, `git_dirty` false, `build_clean` true, `env_overrides` `[]`, profile `pr`, suite `unit` 3,779 tests, 0 failures, 0 errors, 2 skipped; attachment `coverage-summary.json` with its SHA-256; coverage 95.92 % line, 96.05 % branch (informational) |
| Binding to the head | `lockfile_sha256` equals the SHA-256 of the head `package-lock.json`; `manifest_sha256` equals that of the head `tools/quality/required-suites.json` (both blob-identical to the base); the only paths changed between `e88bc46` and `3eb7689` are the four run files |
| The 2 skips | Both are `packages/config/src/file-secret-provider.test.ts` cases (O_NOFOLLOW swap, group- or world-writable mode) that skip on the Windows host and run in lane A on Linux |
| The two edited tests inside the run | present and passing: "renders the committed map byte-identically", "counts 218 Must stories and 1612 scenarios, 1606 of them G3-counted", the ratchet, "every Must story ... has an assignment entry", and "gherkin-test-map.md: 1612 rows, 1606 counted for G3" |
| `quality:trace` on the run | `must-AC 62/1606 (0 Must scenarios unmapped) ... 94 IDs · 0 orphans · 0 problems` |

## 5. Owned-path record check, simulated

Shared clone at the head, base-ref copy of `tools/ci/check-security-owned-paths.mjs` (byte-identical to the head copy), `--base e4ecff2 --pr 36 --head HEAD`. The owned set for the PR is exactly the two test files. The record is written to the working tree, as the checker reads it there.

| # | Scenario | Result |
|---|---|---|
| A | no record | `missing`, exit 1 |
| B | this record's text as written (Head row = the head) | `pass`, satisfied by `3eb7689`, 2 owned |
| B2 | same, `--event push` | `skipped`, exit 0 |
| C | Head row = the code head `e88bc46` (the evidence commit after it is docs only) | `pass` |
| C2 | Head row abbreviated to 7 hex | `pass` |
| D | Head row = the base tip (not a commit of the PR range) | `missing` |
| E1 to E5 | Verdict `FAIL`; `PENDING`; no Verdict row (prose only); earlier row PASS then a final row FAIL; Verdict row only inside a fenced block | each `missing` |
| E6 | earlier row FAIL, final row `PASS_WITH_FOLLOW-UPS` (last wins) | `pass` |
| F, F2 | record named for PR 35 only; this record with `--pr 37` | each `missing` |
| G1 to G3 | after the reviewed commit, an owned edit of `test-ids.test.ts`; of `gen-gherkin-map.test.ts`; of a third owned file (`tools/quality/heavy.mjs`) | each `missing` |
| G4, G5 | after the reviewed commit, an edit of `.gitignore`; of `.github/workflows/ci.yml` | each `missing` |
| G6 | after the reviewed commit, an edit of unowned `TEST-STRATEGY.md` | `pass` (so the R1-m1 doc fix does not void this record) |
| G7 | an owned edit, then a record whose Head row is the new tip | `pass` |
| G8 | an owned edit and its revert, record names the old head | `pass` (the known net-change residual, PR10-SEC-21) |

22 scenarios, 22 as expected. Any owned-path commit after `3eb7689` (for example the code review's R1-n1 test edit) voids this record's Head row: batch such edits with the next `tools/quality` change and re-review.

## 6. D-ORCH-021 levers, lock and supply chain

| Lever | State |
|---|---|
| `RANGE_BASE`, `BASH_ENV`, `PATH`, `BASH_FUNC_*`, `defaults.run`, folded `run: >` on a gate step, `$GITHUB_ENV` / `$GITHUB_PATH` writes | not applicable: no `.github/workflows/**` file in the diff (PR #36 has no workflow change to rule on) |
| Gate tooling (`tools/ci`, `tools/deps`, `tools/hooks`, `tools/isolated`, `tools/quality` non-test files, `tools/test-support`) and `jest.config.ts`, `eslint.config.mjs`, `.gitignore`, `.npmrc`, `.claude/settings.json`, `CLAUDE.md` | 0 changed paths (path-filtered `git diff --name-only`); the two `tools/quality` files are tests only |
| Lock delta | none: `package.json`, `package-lock.json`, `.npmrc` and `tools/quality/required-suites.json` have identical blob IDs on base and head. No new dependency, no install-script surface |
| Evidence-tree content | 4 files in one new run directory; the base-ref `check-evidence` recomputes the verdict and every hash; no unlisted file |

## 7. Finding

### PR36-SEC-01 (INFO): TEST-STRATEGY says `reports/ac-trace.json` is git-ignored; it is not

- **Class:** CWE-16 Configuration; OWASP A05:2021 Security Misconfiguration (a documented control that does not exist). Severity INFO: no exploit path, the generated file holds test titles, IDs and counts (host scan 0), and no gate reads `reports/`.
- **Where:** `docs/05-quality/TEST-STRATEGY.md:189` (section 6 rule 2, new in v1.4), copied from the comment at `tools/quality/trace.mjs:67` (PR #35 R2-n1, left open by D-SEC-PR35-02 "with the next `tools/quality` change").
- **Evidence:** `.gitignore` and `.prettierignore` have no `reports` entry; `git check-ignore -v reports/ac-trace.json` exits 1 in the PR worktree, where the author's trace output sits as an untracked `reports/` (`git status`: `?? reports/`); `prettier --check` warns on the generated file, so `npm run format:check` fails locally after a default `quality:trace`. The hazard is an accidental `git add -A` of generated output, or a red local format gate.
- **Fix:** doc half, in this PR (unowned, does not void this record, simulation G6): drop "git-ignored" or say "not yet git-ignored". Owned half (devops-engineer, with a security record, with 015-B, before G3): `/reports/` in `.gitignore`, `reports/` in `.prettierignore`, a `tools/repo/gitignore.test.ts` matrix row, and the `trace.mjs` comment.
- **Verification:** `git check-ignore -v reports/ac-trace.json` exits 0 and `prettier --check .` is green after `quality:trace` with no `--out`.

## 8. Status of earlier items touched by this PR

| Item | State |
|---|---|
| PR35-SEC-05 (INFO, `quality:gherkin-map --check` exits 1 until the 13 scenarios are classified) | **closed**: exit 0 on this head, exit 1 on the base |
| PR #35 R2 INFO 04 / D-TASK277-03 wording (TEST-STRATEGY says `<run>/ac-trace.json`) | **closed** except the "git-ignored" clause (PR36-SEC-01); the rest of rule 2 is correct (section 2 (i)) |
| PR #35 R2-n1 (`reports/` not git-ignored) | open, now PR36-SEC-01; owner devops-engineer with 015-B |
| PR #35 R2-n2..n4, PR35-SEC-06 (8.3 alias of the evidence-tree guard), INFO 06 | open, unchanged, not touched by this PR; owners as in D-SEC-PR35-02 |
| Quality-side observations (AT-US-066-12 is G3-counted with a leg on a cuttable Should task; TEST-STRATEGY nits) | in the code review, not security findings |

## 9. Method, limits, verdict

Method: `git archive` extracts of the head and the base with `node_modules` as junctions to main's; a scratch `git clone --shared` for the base-ref `check-evidence` and `check-security-owned-paths` runs and the 22-scenario simulation (commits only in the clone); a row-level map comparison through the real parser; a mutation harness over the two test files; a count-only host scan with a positive control; a Gitleaks emulator with runtime positive controls. Scratch removed afterwards; main's `node_modules` unchanged.

Limits: no Docker; the real Gitleaks image and Semgrep were not run by me (lane A's green runs are the evidence, my emulation is corroboration); the `unit` evidence run was produced on the author's host and is judged by its recorded hashes and the base-ref verifier, not re-run; my extract run of `tools/ci` tests had one failure caused by the extract not being a repository (lane A's unit step is green).

PR #36 changes no production behaviour and no gate; its two owned edits make the drift check stricter; the evidence is accepted; no lever, lock or workflow delta. One INFO with an owner.

| **Verdict** | PASS_WITH_FOLLOW-UPS. No Critical, High, Medium or Low finding. The two owned test edits strengthen the drift check (old tests stayed green under 3 of 4 applicable mutants, new tests catch all 7); the only owned paths are `tools/quality/gen-gherkin-map.test.ts` and `tools/quality/lib/test-ids.test.ts`; run `20261113T1845Z_e88bc46` is accepted by the base-ref check-evidence and the host-fragment scan is 0; no `.github` lever, lock or tool delta. Follow-up: PR36-SEC-01 INFO (git-ignored claim; owner devops-engineer with 015-B, doc half in this PR). The record covers `3eb7689`: any later owned-path commit needs a new Head row. |
