# Code review: PR #37, relative-growth redaction timing checks (flake fix, PR #20 R4-m1), round 1

Reviewer: code-reviewer role, done in one pass with the security review (matching record: `docs/05-quality/security/PR-0037-redaction-timing-security-review.md`). Head reviewed: `ff3de1154060ae7c6853695cb230d5c24b727de5` (the test change is `7d8496b`, the head adds only the lane B evidence commit). Base: merge-base `d693e8c`; `main` has since moved to `9c8dca7` by docs only (agent memory, reviews, `docs/sdlc`), so nothing the PR touches moved.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Test-only, four files under packages/shared/src/logging plus one evidence run. The linearity checks are meaningful: removing `pattern.lastIndex = end` from the object-key branch of redactQuotedLists fails exactly one test (SEC-18, best-of-3 ratio 76 against the limit 40), while the healthy code scores 9 to 16 on every family and about 1 on the key-length test; four concurrent full runs of the logging directory were 4/4 green.
  No BLOCKER or MAJOR. One MINOR: the key-length test is titled "cost does not grow with key length" but its limit of 40 lets a linear regression through (it did before as well). Two NITs. Lane A (run 43504477171) is green on the head.
```

## 1. What I verified myself (and what I did not)

Method: `git archive` extract of the exact head in the scratchpad, `node_modules` as a junction to main's, Node 24.22.3, no Docker, no builds; a scratch `git clone --shared` for the base-ref verifiers. Mutations ran only in the extract and the extract's source was restored from `ff3de11` after each run (byte-compared). Scratch removed afterwards.

| Check | Result |
|---|---|
| Scope | `git diff --raw --no-renames --ignore-submodules=none d693e8c ff3de11`: 11 paths, all 100644, no gitlink, no symlink. Four are `packages/shared/src/logging/**/*.test.ts`; seven are the files of run `20261113T2034Z_7d8496b`. No product file, no `string-redaction.ts` change, no new module (helpers `perCall`, `median`, `growthRatio` are inlined at the top of `string-redaction.test.ts`, nothing lands in `dist`). No `.skip`, `.only`, `.todo`, `xit`, `setTimeout` in the four test files |
| `packages/shared/src/logging` on the head extract | 9 suites, 427 tests, all pass |
| Healthy ratios (best-of-3 rounds printed from a patched copy of the test, all 30 `growthRatio` call sites) | 8 KiB families: per-round ratios 8.1 to 25.0, the best-of-3 value 8.1 to 17.1 (margin 2.3x or more to 40). Key-length test: 0.93 to 1.06. SEC-18 (healthy): about 11 to 12 in the printed runs |
| Mutation M1 (the required one): delete `pattern.lastIndex = end;` in the `startsPair` branch of `redactQuotedLists` | Exactly one failure: "[PR20-SEC-18] list items that close only at the end of the string: 16x the input takes at most 40x the time"; 242 others pass. Rounds 76.0, 137.3, 147.0, so the best-of-3 is 76.0 against 40 (the PR body says 120.6 on its host; same verdict) |
| Mutation M2: remove the `MAX_KEY_LENGTH` cap (both `const head = key.length > MAX_KEY_LENGTH ? ... : key` sites) | New tests: all 427 pass (rounds 16.6 to 23.6 on the key test, below 40). The base test (`< 50 ms` on a 1 MiB key) also passes under M2, so the new test is not weaker than the old one at detecting this, see R1-m1 |
| Flake resistance | Four concurrent copies of the full logging directory on this host (each a jest worker pool): 4/4 `427 passed`. The PR body claims 10/10 under a parallel full `test:unit`. Lane A's hosted "Unit tests" step is the second independent sample (green, below) |
| `prettier --check` on the four test files | clean |
| Evidence | base-ref `check-evidence --profile pr --base d693e8c --head ff3de11`: `run 20261113T2034Z_7d8496b accepted`, `PASS`. `summary.json`: `git_sha` `7d8496bee4e2...` (the test commit), `git_dirty` false, `build_clean` true, `env_overrides` `[]`, suites api 94, catalog-c1-c14 74, integration 253, unit 3779 all passed. The only change after the measured commit is the docs run directory |
| Lane A (run 43504477171) | `fast-lane`, `scans` and `ci-gate` all completed, success; only the base-ref lint-fixture step and the Semgrep rule self-test were skipped, by design (their inputs did not change). The hosted "Unit tests" step is a second flake sample on a different host: green |

NOT re-run: whole-repo lint, type-check, build, `test:unit` (lane A runs them on the real head and the author's evidence run covers them); Docker-bound suites (not needed, none touched).

## 2. Assessment against the brief

| Item | Verdict |
|---|---|
| Linearity checks meaningful | Yes. `growthRatio` takes three rounds, each the ratio of the median of five large-input samples to the median of five small-input samples, returns the minimum, and floors the denominator at 1e-6 ms. The 16x input ratio is the correct design for a linear/quadratic split (linear 16x, quadratic 256x). Taking the minimum of three medians means scheduler noise, which only inflates the large or the small timing at random, cannot keep every round high, while a true super-linear cost raises all three rounds (M1: 76, 137, 147) |
| 2 s catastrophic ceilings only where inputs are size-capped | Yes. `redaction.test.ts` (100 kB pathological input, bounded by `MAX_STRING_LENGTH` before any regex), `redaction-walk.test.ts` (per-call budget; the length, suffix and `MORE_KEY` assertions that actually prove the budget are kept), `serializers/error.test.ts` (stack frame cap) all change only the elapsed bound 200/250 ms to 2000 ms. The growth tests carry the same 2 s ceiling on one call as a second guard |
| Still catches the quadratic regression | Yes: M1 fails exactly the SEC-18 test and nothing else |
| PR #20 R4-m1 limit 20 to 40 | Done and recorded with the decision tag in the comment. Linear scores about 11 on SEC-18, the mutant 76 to 147; margin now 3.6x on the healthy side and 1.9x on the mutant side (it was 1.8x and 3.8x with 20), see R1-n2 |
| No product code changed | Confirmed (section 1) |
| Helpers inlined, no dist module | Confirmed |
| Flake-resistance argument sound | Yes for the bound that failed (50 ms absolute, 3 of 6 runs under load per the PR body): an absolute bound cannot be made load-proof, a ratio of two timings taken seconds apart on the same worker can. Residual: a ratio is not immune to a load spike that lands only on the small samples; the minimum of three rounds is the protection, and the healthy best-of-3 has 2.3x or more headroom |

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `packages/shared/src/logging/string-redaction.test.ts:128-139` | The test is renamed "classifies a 1 MiB key from its first MAX_KEY_LENGTH characters, cheaply: cost does not grow with key length", but it asserts `growthRatio(...) <= 40` for a 16x key. A regression that scans the whole key (M2, healthy 0.93 to 1.06, mutant 16.6 to 23.6) is linear and passes. The old `< 50 ms` bound did not catch it either, so nothing is lost, but the title now claims more than the assertion proves | Either give this one test its own limit (for example 4: the capped cost is about 1, an uncapped scan is about 16, 4x headroom each side) or soften the title to "does not grow super-linearly". The first is one line and restores the property the title names |
| R1-n1 | NIT | the four test files | Constant-factor slowdowns are now invisible: the old 50/200/250 ms bounds would have caught a 10x slower linear implementation, the new tests only catch super-linear growth or more than 2 s per call. This is the intended trade (those bounds are what flaked) and the PR body says so; it is worth one line in the PR #20 follow-up note so nobody later reads "linear" as "fast" | Record in DECISIONS with the PR number (below). No code change |
| R1-n2 | NIT | `string-redaction.test.ts:23-24` and the SEC-18 comment | Raising the limit to 40 halves the detection margin on a partial regression (a pass that is quadratic only on a fraction of the input and scores 20 to 40x would now pass). Healthy 11 and mutant 76 to 147 leave room for 40 and the author's reasoning (16 x 2.5 headroom) is stated in the code comment, so I accept it as the R4-m1 resolution | None. Keep 40 unless a flake is seen again |

## 4. Merge conditions

1. Lane A green on `ff3de11`: met (run 43504477171, `ci-gate` success).
2. The security record `PR-0037-redaction-timing-security-review.md` committed by the orchestrator; no security-owned path changed (`check-security-owned-paths` prints `not-required`), so the check does not demand it, but the DoD does.
3. Optional before merge: R1-m1 (one line). It may follow as a minor.

## 5. Decisions from the PR body to log (DECISIONS.md)

- Redaction timing tests assert growth (best-of-3 median ratios, 16x input at most 40x time) plus a 2 s catastrophic ceiling instead of absolute 50/200/250 ms wall times; applies to PR20-SEC-07 and the 8 KiB family tests.
- PR20-SEC-18 ratio limit 20 to 40 (PR #20 review R4-m1, D-SEC-PR20-04); linear about 11 to 16x, quadratic re-scan about 76 to 256x.
- Inputs that are size-capped keep fixed-work checks with the 2 s ceiling only (`redaction.test.ts`, `redaction-walk.test.ts`, `serializers/error.test.ts`); budget enforcement stays proven by the length, suffix and `MORE_KEY` assertions, not by time.
- Timing helpers stay inlined in `string-redaction.test.ts` (no shared test-support module, nothing in `dist`).

GOOD: the mutation evidence in the PR body reproduces; the comment on SEC-18 explains why an absolute bound cannot work for that shape; assertions that prove the budget (length, suffix) were kept when the time bound was loosened; evidence run is bound to the test commit and clean.

SECURITY-FLAGS: none beyond the security record (ReDoS/CPU-DoS guard strength is the only security-relevant property; assessed there).
