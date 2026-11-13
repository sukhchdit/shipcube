# PR-0037 / relative-growth redaction timing checks (flake fix, PR #20 R4-m1, PR20-SEC-07 and PR20-SEC-18 guards)

| Field | Value |
|---|---|
| PR | #37 `test(shared): replace absolute wall-time redaction asserts with relative-growth checks`, branch `test/redaction-timing-ratios`, https://github.com/sukhchdit/shipcube/pull/37. Two linear commits on `d693e8c` (`7d8496b` the change, `ff3de11` the lane B evidence). `main` has since moved to `9c8dca7` by docs only. |
| Head | ff3de1154060ae7c6853695cb230d5c24b727de5 |
| Lane A evidence | Run [43504477171](https://github.com/sukhchdit/shipcube/actions/runs/43504477171) on `ff3de11`: `fast-lane` success (31 steps green, 2 skipped by design: base-ref lint-fixture step and Semgrep rule self-test, whose inputs did not change), `scans` success (Gitleaks, Semgrep, oasdiff), `ci-gate` success. |
| Owned paths changed | 0. Base-ref `check-security-owned-paths --base d693e8c --pr 37 --head ff3de11`: `not-required`. The four changed test files sit under `packages/shared/src/logging/`, which is not in `.github/CODEOWNERS`. This record is written for the DoD, not because the check demands it. |
| Reviewer / date | security-analyst role (combined pass with the code review `docs/05-quality/reviews/PR-0037-redaction-timing-code-review.md`), 2026-11-14, round 1. Read-only. Probes ran on a `git archive` extract and a scratch `git clone --shared`; no Docker; no secret-shaped literal read or printed. |

## 1. Summary

PR #37 is test-only. It replaces absolute wall-time assertions (50, 200, 250 ms) in four redaction test files with relative-growth checks (best of three median ratios, 16x the input at most 40x the time) where growth is meaningful, and with a 2 s catastrophic ceiling where inputs are size-capped. It raises the PR20-SEC-18 limit from 20 to 40 (PR #20 review R4-m1, D-SEC-PR20-04). No product file, workflow, lever or lock changes.

**What holds.**
- **The ReDoS / CPU-DoS controls are not weakened in the sense that matters.** The controls themselves (`MAX_STRING_LENGTH` and `MAX_KEY_LENGTH` caps, the linear pair and list scans, the per-call walk budget) are untouched. The tests that guard them still fail on super-linear growth: removing `pattern.lastIndex = end;` from the `startsPair` branch of `redactQuotedLists` fails exactly the PR20-SEC-18 test (best-of-3 ratio 76.0 against 40; rounds 76.0, 137.3, 147.0), and nothing else fails. Healthy code scores 8.1 to 17.1 on the 8 KiB families and about 11 on SEC-18.
- **The 2 s ceilings are catastrophic-only and sit where the input is size-capped.** The tests whose time bound was loosened (`redaction.test.ts`, `redaction-walk.test.ts`, `serializers/error.test.ts`) keep the assertions that prove the control, and those are unchanged: output length below `MAX_LINE_CHARS` plus 32 KiB, the truncation suffix, the `MORE_KEY` marker, and the stack frame count. Budget enforcement is proven by size, not by time.
- **Flake resistance does not come from a weaker check**: four concurrent runs of the whole logging directory were 4/4 green (427 tests each), and lane A's hosted run was green.
- **Evidence accepted.** Base-ref `check-evidence --profile pr --base d693e8c --head ff3de11` prints `run 20261113T2034Z_7d8496b accepted` and `PASS`. `git_sha` is the test commit `7d8496b`, `git_dirty` false, `build_clean` true, `env_overrides` `[]`; suites api 94, catalog-c1-c14 74, integration 253, unit 3779 all passed; the only change after the measured commit is the docs run directory.
- **Host-path scan, count only: 0.** Needles (OS user name, its 8.3 short form, home dir in both spellings, host name, git e-mail local part, `AppData`, temp dir, the project directory name, `c:\users`) searched in the whole `d693e8c..ff3de11` diff (1,013,888 bytes, run directory included): 0 for every needle; positive control: the user-name needle is found 1 time in a synthetic string. No value was printed.
- **No owned path weakened, no lever moved.** The 11 changed paths are all regular files (100644; no gitlink, no symlink, `--ignore-submodules=none`): four `packages/shared/src/logging/**/*.test.ts` and seven files of the run directory. Nothing under `.github/`, `tools/`, `.npmrc`, any `package.json`, `package-lock.json`, `jest.config.ts`, `eslint.config.mjs`, `tsconfig*`, `.gitignore`, `prisma/` or `CLAUDE.md` changed (diff outside the logging directory and the run directory: 0 files). D-ORCH-021 levers unchanged.
- **No test gating added.** No `.skip`, `.only`, `.todo`, `xit`, `xdescribe` or `setTimeout` in the four changed test files; the changed files pass `prettier --check`.

**What does not hold.** One INFO, no Critical, High, Medium or Low:
- **PR37-SEC-01 (INFO):** constant-factor slowdowns are no longer caught by any redaction test. With the old bounds, a linear implementation that became 10x slower per call (still small in absolute terms) would have failed 50/200/250 ms; now only super-linear growth, or more than 2 s per call, fails. For a log-path control the realistic exposure is a per-call cost increase that is still linear and below 2 s, which the length caps bound (8 KiB strings, 128-character keys, the line budget). Not exploitable as a DoS amplifier by itself. Mitigation is procedural: lane B `quality:heavy` and the k6 load suite (`tests/load`) are where throughput is judged.
- Related, not a finding: PR #20 R4-m1 accepted the limit of 40. It halves the detection margin for a partially quadratic regression (a pass that is quadratic on a fraction of the input and scores 20 to 40x would pass). The mutant measured 76 to 147, so the full regression is caught with a 1.9x margin; keep 40 unless a flake recurs.

**Findings: 1 INFO.** Verdict in section 4.

## 2. What was checked

| | Check | Result |
|---|---|---|
| (a) | The diff: `git diff --raw --no-renames --ignore-submodules=none d693e8c ff3de11`; gitlinks and symlink entries in the head tree | 11 paths (4 `M` tests, 7 `A` run files), all 100644; 0 gitlinks; 0 symlinks |
| (b) | The four test files, line by line | Only time-bound constants (200/250/50 ms to 2000 ms), the inlined helpers `perCall`, `median`, `growthRatio`, the 40 limit and the renamed test titles. No import change, no skip/only/timeout, no assertion on output removed (the SEC-07 length, suffix and `MORE_KEY` assertions and the SEC-18 `redactString(large) === large` precondition are all kept) |
| (c) | Mutation M1 on the head extract: delete `pattern.lastIndex = end;` in the `startsPair` branch of `redactQuotedLists` | 1 failure (SEC-18, 76.0 > 40), 242 pass in the file; source restored and byte-compared with the head blob |
| (d) | Mutation M2: remove the `MAX_KEY_LENGTH` cap at both key-fold sites | Not caught by the new key-length test (16.6 to 23.6 < 40); not caught by the old `< 50 ms` bound either, so no regression; reported as code-review R1-m1 (the test title claims more than it proves) |
| (e) | Healthy ratios and load | 30 `growthRatio` evaluations: best-of-3 8.1 to 17.1 on the families, about 1 on the key test, about 11 on SEC-18; per-round maximum 25.0; 4/4 concurrent full runs green |
| (f) | Evidence run `20261113T2034Z_7d8496b` | Accepted by the base-ref `check-evidence` (section 1) |
| (g) | Owned-path record check, base-ref script | `not-required` (0 owned paths changed) |
| (h) | Secrets and host fragments | Lane A Gitleaks and Semgrep green on the head; host scan 0 on 10 needle classes over the 1,013,888-byte diff, positive control fires |
| (i) | Levers, lock, supply chain | 0 files changed outside `packages/shared/src/logging/` and the run directory; no dependency added; the helpers are plain `performance.now()` loops |

## 3. Security flags and follow-ups

| ID | Severity | Finding | Follow-up |
|---|---|---|---|
| PR37-SEC-01 | INFO | Constant-factor slowdowns of the redaction path are not caught by the unit suite after this change (only super-linear growth and more than 2 s per call are). The caps bound the per-call cost | None required. If a per-call latency budget for the log path is wanted, add it to the lane B or k6 profile, where it can run on a quiet host, not to the unit suite |

Code-review R1-m1 (key-length test limit) is a correctness-of-claim nit on a control test; it does not change the verdict here: the PR20-SEC-07 key cap is protected by its own functional assertions (`isSensitiveKey(huge)` true, classification uses the first `MAX_KEY_LENGTH` characters) and was equally unprotected by the old time bound.

## 4. Verdict

| Field | Value |
|---|---|
| Critical / High / Medium / Low open | 0 / 0 / 0 / 0 |
| INFO | 1 (PR37-SEC-01) |
| Merge conditions | Lane A green on `ff3de11` (met, run 43504477171). This record committed by the orchestrator (not required by the owned-path check, required by the DoD). |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** The change does not weaken the PR20-SEC-07/18 ReDoS and CPU-DoS controls: the guards still fail on super-linear growth (M1 mutant fails, healthy ratio 8 to 17 against a 40 limit), the 2 s ceilings are catastrophic-only and sit on size-capped inputs, evidence is accepted, host-path scan 0, no owned path weakened, D-ORCH-021 levers unchanged. One INFO (PR37-SEC-01) and the code-review MINOR R1-m1 are follow-ups, neither blocks. |
