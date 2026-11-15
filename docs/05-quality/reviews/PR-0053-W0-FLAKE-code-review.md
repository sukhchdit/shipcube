# Code review: PR #53, TASK-W0-FLAKE deterministic timing under host load (round 1)

| Field | Value |
|---|---|
| PR | #53 `test: deterministic timing under host load (W0-FLAKE)` |
| Branch / head | `test/w0-flake-host-load` @ `8a48139` (12 commits: 9 test/code, 2 merges of main, 1 evidence) |
| Merge-base with current main | `73addb0`. Main is now `78cd2a4`. The delta touches only `.claude/agent-memory/senior-developer/*`, `docs/sdlc/DECISIONS.md` and `docs/sdlc/STATUS.md`. |
| Records | D-ORCH-080/084/096/097/098 · FU-PR34-1 · PR #38 R1-n1 · PR30-SEC-01 (S3 deadlines) · US-012 AT-US-012-03 |
| Reviewer | code-reviewer · 2026-11-15 · round 1 |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: fetchOnce, the shared budget constant, the connection count, the fresh-process healthcheck check and the
         seed seam are sound. The seam does not change production behaviour. But "no assertion weakened" does not
         hold. The new upper bounds (deadline + 20 s, and for AT-US-012-03 derived from the constant under test) let
         through two regressions that main's tests kill: readiness answering in 8 s (AT-US-012-03 says 2.5 s), and
         every S3 deadline 10x longer (PR30-SEC-01). Two MAJORs; the fix is deterministic magnitude pins, not
         tighter wall-clock bounds. Two MINORs on the stall estimator and on the 180 s budget's diagnosability.
```

## 1. Verification I performed myself

| # | Check | Result |
|---|---|---|
| V1 | `git diff origin/main...8a48139 --stat`; `git log` | 26 files. Non-test: `prisma/seed/index.ts` (seam). Test support: `apps/api/src/platform/routing/tests/loopback.ts` and `tools/test-support/process.ts`. 13 test files. Plus the evidence run. |
| V2 | The 13 changed unit-lane files, run positionally in the worktree with `--selectProjects unit --maxWorkers=2` | 13 suites, **236 passed**, 18 s, on the saturated host. |
| V3 | `prettier --check` and `eslint --max-warnings 0` on the changed files | Both clean. |
| V4 | Hosted CI on `8a48139` (run 43721465119) | `fast-lane` succeeded with every step executed. `scans` fails only on "Security-owned paths need a review record", and `ci-gate` fails as a consequence. |
| V5 | Evidence `20261115T1341Z_57f9cf4` | Verdict PASS, 0 `<failure>` across the JUnit files. `57f9cf4..8a48139` adds only the run directory. |
| V6 | **Bound mutants:** scratch copy (`git archive 8a48139` + `node_modules` junction). Each mutant was run against the HEAD test file and then against main's version of the same file. | See §3: **R1, R2 and S1 survive HEAD and are killed by main's tests.** H1 is killed by both. The control C0 passes in both. |
| V7 | **Heartbeat probe:** `timeOperation` from `loopback.ts` driven by tsx on this Windows 11 host | (a) idle 2,250 ms timer: `ms` 2,259, `workMs` **1,440** (−36 %). (b) the same timer with a 5 s freeze: `ms` 5,502, `workMs` 340. (c) an 8 s async hang: `workMs` **5,100**. (d) a 5 s freeze at the end: `workMs` 200. (e) **6 s of synchronous work by the code under test: `workMs` 20**. |
| V8 | **fetchOnce probe** against a loopback server | It sends a fresh socket with `Connection: close`. It keeps a multi-value `set-cookie` (`['a=1','b=2']`). A POST string body goes **chunked**, where global fetch sends `Content-Length: 7`. An **already-aborted `signal` is ignored** (200). An unsupported body (`URLSearchParams`) rejects, **but the request is still sent** (1 hit). |
| V9 | Seed seam | The CLI entry calls `main(process.argv.slice(2))` (`prisma/seed/index.ts:152`) with no 4th argument. `createClient === undefined ? {} : { createClient }` is the same as the old call with no options (`withMigratorConnection(…, options = {})` destructures the same defaults, `migrator-connection.ts:231`). `patientClient` spreads the production config and overrides only `connectionTimeoutMillis`. The only importer of `main` is `cli.test.ts`. **No production change.** |
| V10 | Unions | `git merge-tree` with `origin/main` is clean, and with PR #52 it is clean as well (tree `c2454d6`, no overlapping file). |
| Not re-run | full lint/typecheck/unit/build; integration (`query-counter.int.test.ts`) and api (`serve.api.test.ts`) projects; the flake table | Per the brief (light commands, no Docker). I relied on V4 and V5. |

## 2. Findings

| ID | Severity | Location | Issue | Required fix |
|---|---|---|---|---|
| R1-M1 | **MAJOR** | `apps/api/src/platform/health/router.test.ts:101-114`; `apps/worker/src/platform/health/server.test.ts:92-111` | **AT-US-012-03 ("GET /health/ready responds within 2.5 s", EPIC-01 US-012) is no longer asserted anywhere.** The bound went from `< 2_500` to `workMs < READINESS_DEADLINE_MS + 20_000` (22.25 s). That bound is derived from the very constant it should police, so raising the constant raises the bound. The overall-deadline case went from `< 1_000` to `< 100 + 20_000`, and the worker case from `< 2_500` to `< 300 + 20_000`. **Mutant R2** (check timeout 8 s, deadline 9 s, so the API answers a hanging dependency in about 8 s) passes the HEAD suite and is killed by main's. **Mutant R1** (overall deadline × 20) behaves the same. The 2.5 s checks in `health.int.test.ts` use STOPPED dependencies (immediate refusal), so they cannot catch either mutant. No other test references `READINESS_*_MS`. | Pin the magnitude deterministically and keep the generous bound only as the structural "fired, not hung" check: (1) a static AC pin, `expect(READINESS_CHECK_TIMEOUT_MS).toBe(2_000)` and `expect(READINESS_DEADLINE_MS).toBeLessThanOrEqual(2_500)`, with the AT-US-012-03 tag; (2) a wiring pin, `jest.spyOn(AbortSignal, 'timeout')` asserting it was called with the configured deadline (2_250 by default, 100 and 300 when passed). If you prefer a timing bound instead, use `workMs < 2_500` for the default case, after the R1-m1 fix. Show R1, R2 and a worker deadline × 10 killed. |
| R1-M2 | **MAJOR** | `apps/api/src/platform/storage/s3-object-storage.http.test.ts:176, 203-204, 219, 234` | **The PR30-SEC-01 deadline magnitudes are unpinned.** The rule (DECISIONS: 15 s for put/putIfAbsent/get and 5 s for metadata, as `AbortSignal.any([caller, AbortSignal.timeout(deadline)])`) was enforced by `ms < deadline + 1_000` (and `< 1_800` for the trickle). It is now `workMs < deadline + 20_000`, which is 26 to 51 times the 0.4-0.8 s test deadlines. **Mutant S1** (`bounded()` uses `deadlineMs * 10`, so production get becomes 150 s and head 50 s) passes 8/8 on HEAD. Main's file kills it in two tests ("without a caller signal …" and the trickle case). `S3_TIMEOUTS` values are pinned (`s3-object-storage.test.ts:586`), but how `bounded()` uses them is not. The "fired versus hung" separation (request timeout 120 s) is otherwise well designed. | As for M1: spy `AbortSignal.timeout` and assert it receives exactly 800 and 400, and 300 for the caller signal. Or bound `workMs` by a multiple a × 10 bug cannot pass (for example `deadline * 3`) once R1-m1 is fixed. Show S1 killed. Keep the exact lower bounds as they are. |
| R1-m1 | MINOR | `apps/api/src/platform/routing/tests/loopback.ts:30-60` (`timeOperation`); a duplicate inline copy at `apps/worker/src/platform/health/server.test.ts:95-110` | **The stall estimator is biased, and its JSDoc overclaims.** (a) Windows coalesces the 20 ms interval to about 31 ms, so each tick books about 11 ms of jitter as a "stall": idle `workMs` under-reports by 36 % (V7a), and an 8 s hang reads as 5.1 s (V7c). (b) The JSDoc says the lateness is "the time this process was not running (host load, GC, a suspended process)". It also includes the **process's own synchronous work**: 6 s of blocking in the code under test reads as 20 ms (V7e). So, on the focus question: for async waits (timers, sockets) the subtraction cannot hide a hang, because heartbeats arrive on time. For synchronous blocking it hides everything, and on Windows every bound is effectively 1.56 times looser. The worker test re-implements the loop and duplicates `180_000`/`20_000` instead of sharing them. | Count only lateness above a jitter threshold (for example `> tickMs`), or use `perf_hooks.monitorEventLoopDelay`. Document that synchronous work in the measured operation is subtracted, so these bounds do not police CPU-bound regressions. Move `timeOperation` and the constants to `tools/test-support` and import them from both apps. |
| R1-m2 | MINOR | `loopback.ts:9` (`LOOPBACK_TEST_TIMEOUT_MS = 180_000`), `fetchOnce` (no request deadline); `.github/workflows/ci.yml:60` (`fast-lane` `timeout-minutes: 25`) | **Is 180 s reasonable?** As a hang detector for the saturated local heavy lane, yes. No case uses it as a latency bound, a case takes 15-100 ms, and the AC bounds belong in assertions (M1/M2), not in the Jest budget. It does hide a 20-180 s "slow but correct" response, which is k6's job, not this suite's. **But it degrades lane A:** at 180 s per hanging case, about 9 hanging loopback cases on one worker exceed the 25-minute job timeout. The job is then cancelled with no JUnit and no test names. With 20 s, that took about 75 cases. A regression that hangs a shared slot hangs every case in `pipeline*.test.ts` (26 cases). `fetchOnce`, the helper meant to stop hangs, has no deadline of its own. | Give `fetchOnce` a per-request deadline (for example 60 s via `request.setTimeout` / an AbortSignal) that rejects with a named error (`fetchOnce: no response from <METHOD> <path> within 60 s`), so a hang fails fast and named. Optionally use a lower budget when `CI` is set and the run is not the heavy lane. |
| R1-n1 | NIT | `loopback.ts:67-111` (`fetchOnce`) | (a) It silently ignores `init.signal` (V8), `redirect`, `credentials` and so on. (b) String and byte bodies go chunked, with no `Content-Length`, unlike fetch, which matters for future body-limit or 411 tests. (c) An unsupported body rejects but `request.end()` still sends the request. (d) A bracketed IPv6 `hostname` is passed through. None of these affects current callers (no body, no signal). | Refuse unsupported `init` keys and bodies BEFORE `httpRequest`. Set `Content-Length` for string and byte bodies. Honour `signal`, or refuse it. |
| R1-n2 | NIT | `apps/worker/src/platform/health/server.test.ts:52-53` | The test instance overrides `headersTimeout`/`requestTimeout`, and the production 5 s slowloris bounds (`server.ts:58-59`) are pinned by no test. This predates the PR, but the override makes it easy to forget. | One line before the override: `expect([server.headersTimeout, server.requestTimeout]).toEqual([5_000, 5_000])`. |
| R1-n3 | NIT | routing | PR #48 review R1-m4 (`tests/generated/rbac/runner.ts` `observe()` has no per-request deadline, and a transport error aborts the 900 s test without naming a cell) was pointed at TASK-W0-FLAKE. It is not in D-ORCH-080's file list and is not addressed here. | Orchestrator: route it explicitly (to W0-FLAKE-2 or the next TASK-027 touch). It fits the R1-m2 `fetchOnce` deadline pattern. |
| R1-n4 | NIT | `tools/test-support/process.ts:43` | `runNode` uses `spawnSync`. Raising the default to 300 s means a hung child blocks the Jest worker synchronously for 5 minutes, and Jest's timeout cannot interrupt a synchronous call. Accepted for the healthcheck child, which finishes in under 1 s. | none required. Prefer the async `spawn` for any new long-running child. |

## 3. Bound mutants (V6): HEAD tests vs main's tests on the same mutated source

| ID | Mutant (production code) | HEAD tests | main's tests |
|---|---|---|---|
| C0 | none (control) | pass 28/28 | pass 28/28 |
| R1 | `readiness.ts:152` overall deadline × 20 (100 ms → 2 s) | **survives** 20/20 | killed (overall-deadline case) |
| R2 | `READINESS_CHECK_TIMEOUT_MS` 8_000, `READINESS_DEADLINE_MS` 9_000 (AT-US-012-03 violated) | **survives** 20/20 | killed (AT-US-012-03 per-check case) |
| S1 | `s3-object-storage.ts:236` `bounded()` deadline × 10 | **survives** 8/8 | killed (2 tests) |
| H1 | `healthcheck.mjs:90` entry unguarded on import | killed | killed |

A worker deadline × 10 mutant was not run, because the worker suite resolves `@platform/api/runtime` through the worktree symlink, not the copy. By construction it behaves like R1: 3 s is under the new 20.3 s bound and over main's 2.5 s.

## 4. Rulings on the focus items

1. **"No assertion weakened, skipped or retried."** Nothing is skipped or retried, and every lower bound stays exact (`ms >= deadline - 50` on the raw clock). Several upper bounds did lose discriminating power, though (M1, M2). Changed bound by changed bound:

   | Location | Old | New | Verdict |
   |---|---|---|---|
   | s3 http :176 | `seen` length 3; `ms < 4_000` | `connections === 3`; `workMs < 30_000`, deadline 120 s | Keeps strength. Without `throwOnRequestTimeout` the call waits 120 s, and `warn` and the count fail. Counting attempts as connections is equivalent: each timed-out attempt destroys its socket. |
   | s3 http :203-204 | `ms < deadline + 1_000` | `workMs < deadline + 20_000` | **Weakened**: S1. |
   | s3 http :219 | `ms < 1_300` | `workMs < 20_300` | Weakened. A caller signal that is ignored still fails (120 s deadline), but magnitude is lost. |
   | s3 http :234 | `ms < 1_800` | `workMs < 20_800` | **Weakened**: S1. |
   | api router :104 | `< 2_500` (the AC) | `< READINESS_DEADLINE_MS + 20_000` | **Weakened and self-referential**: R2. |
   | api router :112 | `< 1_000` | `< 20_100` | **Weakened**: R1. |
   | worker :110 | `< 2_500` | `< 20_300` | Weakened (same class as R1). |
   | healthcheck | in-process `exitCode` | fresh child, `status 0` + `exit=0` | Strength kept and order-independent (H1 killed). |
   | budgets (Jest, DB, seed connect) | 5-30 s | 60-180 s | Hang detectors only. Accepted (see R1-m2). |

2. **The heartbeat subtraction does not hide an async hang.** It does hide synchronous blocking, and it over-subtracts on Windows (R1-m1). The real loss of power comes from the 20 s slack, not from the subtraction.
3. **Seed CLI seam: no production behaviour change (V9). Accepted.**
4. **fetchOnce correctness: correct for every current caller.**
   - It uses a fresh socket with no pool and `Connection: close`.
   - The body is read in full before resolving.
   - Multi-value headers are preserved.
   - A null body is used for 101/204/205/304.
   - Request and response errors reject.

   This is a sound root-cause fix for the stalled pooled connect. The edge gaps are R1-n1, and the missing request deadline is R1-m2.
5. **180 s: reasonable as a hang ceiling.** It is not a latency target, and it does not mask an AC once M1 and M2 restore the magnitude pins. Its cost is diagnosability in lane A (R1-m2).
6. **Also accepted:**
   - `closeLoopbackServer` (`closeAllConnections`), as test hygiene.
   - The worker `headersTimeout` widening, which applies to the test instance only.
   - The query-counter DB budgets. The suite asserts no timeout behaviour (verified with grep).
   - The 60 s budgets on the cold-composition suites.

## 5. Round 2 = delta check

1. M1 and M2 fixes. I will re-run `mut.mjs` R1/R2/S1, which must be killed on HEAD, plus a worker deadline × 10.
2. The heartbeat jitter fix and the shared helper, re-probed with V7a/c/e.
3. The `fetchOnce` request deadline and the n1 fixes, re-probed with V8.
4. A fresh flake table (the 10 files, 20/20) under load with the tightened or deterministic pins.
5. Fresh lane-B evidence (any non-docs push stales `57f9cf4`).

Merge conditions after r2: a security record naming the final head (`scans` is red only on that step); no merge of main bringing `.claude/agent-memory` after the evidence; squash.

## 6. Good patterns worth keeping

- Exact lower bounds on the raw clock, with upper bounds separated from host stalls. The idea is right; only the slack and the estimator need work.
- "Fired versus hung" designed structurally: every bound not under test is set to 120 s, so a deadline that does not fire cannot hide behind another limit.
- The fresh-process check for a process-global side effect (`process.exitCode`) instead of relying on Jest file order.
- One shared budget constant, so a later change reaches every loopback suite.

## 7. Security flags (for security-analyst)

- PR30-SEC-01 (S3 time bounds) lost its magnitude pin in this PR (R1-M2). Please confirm the fix restores it.
- `prisma/seed/index.ts` gains an optional driver-factory seam on the exported `main`. The CLI passes nothing (V9). Confirm this is acceptable on a security-owned path.
