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

---

# Round 2 (head 69a0d75)

| Field | Value |
|---|---|
| Head / code | `69a0d75` (evidence only) / `b5dc741` |
| Delta since r1 (`8a48139`) | `ab9c6c8` (security record, branch-only) → `fbf438b` (fix: pins, shared timing, fetchOnce) → `4cd83fe` (merge of main `dbfb1bd`) → `b5dc741` (healthcheck seam and pins) → `69a0d75` (evidence `20261115T1620Z_b5dc741` PASS) |
| Reviewer | code-reviewer · 2026-11-15 · round 2 (delta check) |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: R1-M1 and R1-M2 are closed. Every requested mutant (R1, R2, R2w, R3, W10, S1, x2, caller-signal drop, H1-H3)
         dies on HEAD in a worktree-independent copy. fetchOnce, the jitter threshold and the healthcheck seam are correct.
         NEW BLOCKER: the `@platform/api/test-support/timing` export breaks the worker image build. The image preflight
         imports every exported entry of @platform/api, and prune-dist has removed `tests/` from dist (reproduced).
```

## R2.1 Verification I performed myself

| # | Check | Result |
|---|---|---|
| V1 | `git log`/`diff 8a48139..69a0d75` | Code delta: 8 files (`apps/api/package.json`, `routing/tests/{timing,loopback,loopback.test}.ts`, `router.test.ts`, `s3-object-storage.http.test.ts`, worker `server.test.ts`, `tools/docker/healthcheck.{mjs,test.ts}`). The merge `4cd83fe` brings only main's `dbfb1bd` delta: memory, reviews, PR #52 audit files and evidence. It touches no PR file. |
| V2 | **Mutants**, own script `scratchpad/pr53/mut-r2.mjs` on a fresh `git archive 69a0d75` copy. Unlike r1, `node_modules/@platform/*` is junctioned to the **copy's** workspaces, so the worker suite really sees the mutated `readiness.ts`. `prisma/generated` is junctioned in. | C0 control 69/69 pass. **Killed:** R1 (api overall ×20), R2 (8 s/9 s, api), R2w (8 s/9 s, worker), R3 (per-check ×10), W10 (worker deadline ×10), S1 (`bounded()` ×10), S2 (×2), S3 (`bounded()` drops the caller signal; killed after 125 s), H1 (entry unguarded), H2 (probe `setTimeout` ×10), H3 (`BUDGET_MS` 5000). **Survives:** H4 (`main()` default budget 20 s) → R2-n2. The developer's earlier `mut2-out.txt` W10 row matches mine. |
| V3 | Recorder values | Readiness: exactly one 2_250 and N×2_000 arms, max ≤ 2_500. Overall-deadline case: one 100 and N×60_000. Worker: one 300 and N×2_000; default case one `READINESS_DEADLINE_MS`. S3: 3×800 + 2×400, max ≤ 800; trickle one 800; caller case one 120_000 (the 300 is the test's own call, see R2-n1). The healthcheck `setTimeout` spy sees one 200. |
| V4 | fetchOnce probe (`fo2.mts`, tsx against the worktree source) | Default arms 60_000. Body sizes: `Uint8Array` gives `content-length: 3`; `''` gives 0; `'é€'` gives 5 (byte length, not string length). No `transfer-encoding` in any case. `URLSearchParams`, `Blob` and `ArrayBuffer` are refused with a TypeError and **0 requests sent**. `AbortSignal.abort()` gives AbortError and **0 sent**. A server that never answers gives `FetchOnceTimeoutError: fetchOnce: no response from DELETE /h within 250 ms` at 254 ms. A body that stalls after the headers also gives `FetchOnceTimeoutError` (instanceof true). A mid-body abort rejects with the caller's reason. |
| V5 | Heartbeat re-probe (r1 V7) | Idle 2,250 ms timer: `workMs` 2,261 = `ms` (r1: 1,440, −36 %). Async 8 s hang: `workMs` 8,013 (r1: 5,100). 6 s of sync work: `workMs` 20. This is still subtracted, but it is now documented in the module JSDoc and in `timeOperation`'s JSDoc, with "use `performance.now()` directly" for CPU-bound, ReDoS and scaling checks. |
| V6 | `timeOperation` users (grep) | 6 call sites. All are async deadline waits: readiness ×3, the S3 `timed()` helper and the helper's own tests. None is CPU-bound, ReDoS or scaling. |
| V7 | Changed suites in the worktree, positional, `--maxWorkers=2` (router, loopback, s3 http, worker server, healthcheck, preflight, prune-dist) | 7 suites, **144 passed**. |
| V8 | `prettier --check` and `eslint --max-warnings 0` on the 9 changed files; `tsc -p apps/{api,worker} --noEmit` | All clean. |
| V9 | **Is the subpath export confined? (focus b)** Typed lint probes via `--stdin-filename` on existing files | A worker production file importing `@platform/api/test-support/timing` fails lint: `boundaries/dependencies` "apps/worker imports apps/api only through @platform/api/runtime…". A `packages/*` import fails 3 rules. An api production file importing `../routing/tests/timing.js` is lint-clean. That gap predates this PR (same as `loopback.ts`). Fail-closed: prune-dist deletes `tests/` from the image. **But the export itself is NOT image-safe → R2-B1.** |
| V10 | **Image preflight reproduction** (no Docker): the real `tools/docker/preflight.mjs` run on a minimal image layout. The layout has `/apps/worker/{package.json,dist/main.js}` and `node_modules/@platform/api` junctioned to `apps/api` (manifest from the ref; `dist/` as prune-dist leaves it, without `tests/`), and the worker manifest is reduced to the `@platform/api` dependency. | **HEAD manifest:** `{"event":"preflight.failed","error":"PreflightError","reason":"cannot load @platform/api/test-support/timing"}`, exit 1. **Base (`dbfb1bd`) manifest:** `[preflight] ok: … entry points @platform/api/runtime`, exit 0. `preflight.mjs`, `prune-dist.mjs` and both Dockerfiles are unchanged by the PR. |
| V11 | Healthcheck seam (focus d) | The CLI still calls `main(process.argv.slice(2))`. `options = {}` passes to `probeReady(port, {})`, so the defaults are host `127.0.0.1`, `READY_PATH` and `BUDGET_MS`. That is byte-for-byte the old `probeReady(port)`, so production is unchanged. The 200 ms case pins the armed budget (H2 killed) and keeps an exact lower bound (≥ 150 ms). The dropped wall-clock `< 1500` is replaced by the spy, and a hang still fails at the 180 s Jest budget. |
| V12 | Assertions (focus e) | `.skip`, `.only`, `retryTimes` and `todo`: none in the delta. No upper bound loosened since r1. Every r1-weakened bound now has a deterministic pin next to it. One new live assertion is itself load-sensitive (R2-m1). |
| V13 | **Union (focus f)** with current `origin/main` `37275f9` | MB = `dbfb1bd`. The PR changes 39 files and main 108. **Overlap: none.** Main's delta: workflows, `tools/ci`, `tools/quality`, `tools/deps`, docs, evidence, plus `jest.config.ts` (one comment line), `package.json` (`ci:minutes` script) and `eslint.config.mjs` (3 deletions). No lock change. `git merge-tree --write-tree 69a0d75 origin/main` is clean (tree `bfc1ba3`). |
| V14 | CI on 69a0d75 (run 43736296983) | `fast-lane`, `scans` and `ci-gate` are **red before any check ran**. They fail with `MODULE_NOT_FOUND …/tools/ci/lane-scope.mjs` and `…/security-paths.mjs` → O-1. **No hosted lane A result exists for this head.** |
| Not re-run | full lint, typecheck, unit and build; integration and api projects; the flake table | Per the brief. I relied on evidence `20261115T1620Z_b5dc741` (PASS: unit 5,680, api 128, integration 333/1 skip, rls 126). That evidence contains **no image build**, and neither does lane A. That is why V10 was needed. |

## R2.2 Findings

| ID | Severity | Location | Issue | Required fix |
|---|---|---|---|---|
| R2-B1 | **BLOCKER** | `apps/api/package.json:9-13` (new `"./test-support/timing"` export); consumed by `apps/worker/Dockerfile:126` `RUN node /app/preflight.mjs /app/apps/worker/dist` | **The worker image no longer builds.** In the image, the preflight (`tools/docker/preflight.mjs` `platformEntryPoints`) imports every non-wildcard export of every `@platform/*` dependency of the app. Only `./testing` is skipped (`SKIPPED_EXPORTS`). `apps/worker` depends on `@platform/api`, so the preflight resolves `@platform/api/test-support/timing` to `/app/apps/api/dist/platform/routing/tests/timing.js`. prune-dist (`apps/worker/Dockerfile:59`) has already deleted every `tests/` directory there, so `docker build` fails with `cannot load @platform/api/test-support/timing` (V10, reproduced with the real preflight; the base manifest passes). That breaks `docker compose up` (the worker service) and the lane C images job. Neither lane A nor the lane B evidence builds images, so the PR would merge green and break main. | Remove the export. Either (a) **rename the subpath to `./testing`**, the established test-helper convention (`@platform/config/testing`) that the preflight already skips, or (b) move `timing.ts` to `tools/test-support/` (the r1 suggestion) and import it relatively from both app test files, with no package export. Add a regression check that needs no Docker: in `tools/docker/preflight.test.ts`, for the real `apps/worker/package.json` and `apps/api/package.json`, assert that every `platformEntryPoints()` entry's `default` target survives `shouldRemove` from `prune-dist.mjs` (or pin the exact entry list). Re-run V10 on the fixed manifest. |
| R2-m1 | MINOR | `apps/api/src/platform/routing/tests/loopback.test.ts:84-89` | **A new load-sensitive assertion in the flake-fix PR.** "an asynchronous wait is not hidden" asserts `workMs >= ms - HEARTBEAT_JITTER_MS`. Any real host stall over 50 ms during the 600 ms wait is subtracted **by design**: the next case proves it with a 400 ms block. So the case fails exactly when the host is saturated, which is the W0-FLAKE condition. It passed in the evidence run, but that shows the host was quiet in that window, not that the case is load-proof. | Test the jitter threshold deterministically. Either inject `now` and a scheduler into `timeOperation`, or export the pure booking step and feed it synthetic tick lateness (30 ms → 0 booked, 51 ms → 51 booked). Keep the live case to load-proof facts only: `ms >= 550` and `workMs <= ms`. |
| R2-n1 | NIT | `apps/api/src/platform/storage/s3-object-storage.http.test.ts:222-239` | In the caller-signal case, `filter(ms === 300)` counts the **test's own** `AbortSignal.timeout(300)`, which is created inside the recorder window as an argument to `get`. As a production pin it is vacuous. The case still kills a dropped caller signal through the `workMs` bound (mutant S3), but only after the full 120 s. | Create the caller signal before `recordAbortTimeouts()` and assert that the recorder saw exactly `[LONG_REQUEST_MS]`. |
| R2-n2 | NIT | `tools/docker/healthcheck.test.ts:97`; `tools/docker/healthcheck.mjs:81-88` | (a) `jest.spyOn(globalThis, 'setTimeout')` is never restored, and the Jest config has no `restoreMocks`. It calls through, so the leak is harmless, but it is unlike the `try/finally` discipline of `recordAbortTimeouts`. (b) **H4 survives:** no case pins that `main()` without options arms `BUDGET_MS`. The base tests did not pin it either, but the new seam makes it a one-token regression. (c) `main` forwards the whole `options` object, so `host` and `path` reach `probeReady` despite the `{ budgetMs? }` JSDoc. | (a) `mockRestore()` in a `finally`. (b) One case: `main(['api'], { APP_PORT: <never-answering> })` with the spy, expecting one 2000 arm. (c) Forward `options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }`. |

**O-1 (orchestrator, not a PR defect).** Lane A on `69a0d75` fails in the PR #46 gate bootstrap. `RANGE_BASE` = `github.event.pull_request.base.sha` was **stale** (`dbfb1bd`, although main already had `e6b1b3d`/`3e2da8b`). The fallback archives `tools/ci` from `RANGE_HEAD`. Neither commit has `lane-scope.mjs` or `security-paths.mjs`, while the test-merge checkout in `$GITHUB_WORKSPACE` does. This contradicts the D-ORCH-102 premise ("the PR's next lane A run uses the test-merge workflow"): every PR branched before PR #46 will crash this way. For #53, carry a union with `origin/main` in the R2-B1 fix push (the union is pure, V13). Route a fallback fix to devops as a PR #46 follow-up: archive from the merge checkout, or from `origin/<base_ref>`.

## R2.3 Round-1 closure

| r1 item | Status | Evidence |
|---|---|---|
| R1-M1 AT-US-012-03 | **Closed** | Static AC pin (2_000 / ≤ 2_500) in the api and worker suites, plus the recorder wiring pins. R1, R2, R2w, R3 and W10 are killed (V2). |
| R1-M2 PR30-SEC-01 | **Closed** | 3×800 + 2×400 with max ≤ 800; trickle 800; caller case 120 s. S1, S2 and S3 are killed (V2). Exact lower bounds are kept. |
| R1-m1 heartbeat | **Closed** | 50 ms threshold. Idle is exact and an async hang is no longer under-reported (V5). The JSDoc is corrected (sync work is subtracted; CPU-bound, ReDoS and scaling checks must not use it). There is one shared helper and the worker copy is gone. Its sharing mechanism causes R2-B1, and its own test causes R2-m1. |
| R1-m2 fetchOnce deadline | **Closed** | 60 s, `FetchOnceTimeoutError` naming the method and path (V4). |
| R1-n1 fetchOnce edges | **Closed** | (a) signal honoured, pre-aborted sends nothing; (b) `Content-Length` (byte length); (c) refused before sending; (d) IPv6 brackets stripped. |
| R1-n2 slowloris pin | **Closed** | `expect([headersTimeout, requestTimeout]).toEqual([5_000, 5_000])` before the override. |
| R1-n3 PR #48 R1-m4 | **Routed** | D-ORCH-099 → TASK-W0-FLAKE-2. |
| R1-n4 `runNode` sync | n/a | No action required. |

## R2.4 Merge conditions and round 3

1. Fix R2-B1, add the no-Docker regression check, and re-run V10 on the fixed manifest. R2-m1 should go in the same push (it is one test file). The NITs are optional.
2. Merge `origin/main` in the same push (O-1). Prove it with a clean `merge-tree` and no overlap.
3. Fresh lane B evidence bound to the final code sha. Any code push stales `b5dc741`.
4. Hosted lane A **green** on the final head (V14: there is none today).
5. A security record naming the final head (D-SEC-PR53-01 C2). Squash.

Round 3 is a delta check: R2-B1 by reproduction, the regression check by mutant (re-add a pruned-path export and the check must fail), R2-m1, then the `mut-r2.mjs` rows again on a fresh copy.

## R2.5 Good patterns worth keeping

- `recordAbortTimeouts` turns "the deadline is X" into a deterministic assertion that holds under any host load. It is the right tool, and it is now tested itself (it records, calls through and restores).
- The deadline and hang paths are tested in the helper's own suite (`loopback.test.ts`). The helpers decide whether product tests pass, so they need their own tests.
- The healthcheck seam is minimal, and the CLI is untouched.

## R2.6 Security flags (for security-analyst)

- R2-B1 is not a vulnerability, but it concerns an image-shipped manifest. Today, adding an `exports` entry to `@platform/api` silently changes what the image preflight imports. Please confirm the fix keeps test-only helpers out of every export the preflight loads.
- PR30-SEC-01 / PR53-SEC-04 magnitude pin: restored and verified by mutants S1, S2 and S3 (C1 closed from the code side).

---

# Round 3 (head 378af72)

| Field | Value |
|---|---|
| Head / code | `378af72` (evidence only) / `60a1659` |
| Delta since r2 (`69a0d75`) | `64504ab` (fix: `./testing` subpath, `image-exports.test.ts`, `stallBooked`, R2-n1, R2-n2) → `60a1659` (merge of origin/main `f68cc38`, O-1) → `378af72` (evidence `20261115T1711Z_60a1659` PASS) |
| Orchestrator ruling | The helper ships as `@platform/api/testing`, in the preflight's `SKIPPED_EXPORTS`, the same convention as `@platform/config/testing`. Accepted; I review the implementation, not the choice. |
| Reviewer | code-reviewer · 2026-11-15 · round 3 (delta check) |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R2-B1 is closed. The real preflight plus prune-dist fail on the r2 manifest and pass on the fixed one, and the
         new no-Docker check kills the re-added export. R2-m1, R2-n1 and R2-n2 are closed, and all 19 mutant rows die on
         a fresh copy (H4 included). The merge of f68cc38 is a pure union. Three NITs remain: SKIPPED_EXPORTS itself is
         unpinned (mutant X2 survives), the scan misses prisma/ and non-default conditions, and one pre-existing note.
```

## R3.1 Verification I performed myself

| # | Check | Result |
|---|---|---|
| V1 | `git log`/`diff 69a0d75..378af72` | Fix `64504ab`: 8 files. `apps/api/package.json` renames one key (`./test-support/timing` → `./testing`) and changes nothing else. `timing.ts` adds `stallBooked` and nothing else; `book()` calls it. Test changes: `loopback.test.ts`, `s3-object-storage.http.test.ts` and worker `server.test.ts` (the import specifier). `healthcheck.mjs` forwards only `budgetMs`, `healthcheck.test.ts` is updated, and `tools/docker/image-exports.test.ts` is new. `378af72` adds only the run directory. |
| V2 | **R2-B1 reproduction (V10 re-run, no Docker).** Script `scratchpad/cr53r3/v10.mjs`: the worktree's built `apps/api/dist` is copied, pruned by the real `prune-dist.mjs --declarations` (374 entries removed, `tests/` included), and given the manifest under test. A worker layout is built (`dist/main.js` only, manifest reduced to `@platform/api`), and the real `preflight.mjs` runs as the CLI. | **r2 manifest (`69a0d75`):** `{"event":"preflight.failed",…,"reason":"cannot load @platform/api/test-support/timing"}`, exit 1. **Fixed manifest (`378af72`):** `[preflight] ok: 0 module(s), entry points @platform/api/runtime`, exit 0. **Base (`dbfb1bd`):** the same ok line, exit 0. The developer's comment also reports real `docker build` of both Dockerfiles at exit 0 (not re-run: no Docker). |
| V3 | **Fail-closed probe:** in the fixed layout, a worker dist module `import '@platform/api/testing'` is added | `reason":"cannot load dist/prod-uses-testing.js"`, exit 1. A production import of the subpath cannot reach a built image: its target sits under `tests/`, which prune-dist deletes. |
| V4 | **`image-exports.test.ts`, read in full** | Scope: every `apps/*/package.json` and `packages/*/package.json` that exists (11 manifests, web, admin and ui included), with a non-vacuity case (api, worker and config are found; api has `exports`). Rule: prune-dist's own `shouldRemove` is applied to every path prefix of every `default` leaf target. Directories are passed as directories, and the query-counter `TEST_SEAM` regex is covered too. Exemption: `SKIPPED_EXPORTS` only. It is stricter than the preflight in two ways: wildcard and string targets are checked as well. Self-tests: tests, fixtures, `__fixtures__`, spikes, `*.test.*`, a wildcard through `tests/`, the query-counter seam, and the exact r2 export re-added to the real api manifest. Gaps → R3-n2. |
| V5 | **Is the `SKIPPED_EXPORTS` exemption pinned?** (grep, plus mutant X2) | **No.** `SKIPPED_EXPORTS` is imported, not asserted. `preflight.test.ts` pins `ENTRY_FILES` with `toEqual(['main.js'])` but not `SKIPPED_EXPORTS`. The "never publishes a test helper through a non-testing subpath" case also reads the live constant. X2 (adds `./test-support` both as a pruned-target api export and as a `SKIPPED_EXPORTS` entry) passes all 46 tests of `image-exports` and `preflight`. Mitigation: `/tools/docker/` and `**/package.json` are CODEOWNERS paths, and V3 shows that a production import of any pruned target still fails the image build. → R3-n1 (NIT). |
| V6 | **Lint confinement of `@platform/api/testing`** (ESLint API `lintText` probes on real file paths with the repo config, `scratchpad/cr53r3/lintprobe.mjs`) | A worker production file (`server.ts`) fails `boundaries/dependencies` ("apps/worker imports apps/api only through @platform/api/runtime…"). `packages/shared/src/index.ts` fails `boundaries` ("packages may not import apps") and `import-x/no-extraneous-dependencies`. web and admin are covered by the `toPackage('@platform/api')` disallow. An **api** production file (`router.ts`) importing `@platform/api/testing` (self-reference) is lint-clean, as is the relative `../routing/tests/timing.js` (the same pre-existing gap as r2 V9). The image preflight is the backstop (V3). The worker `server.test.ts` as it stands is clean. → R3-n3. |
| V7 | **R2-m1** (`loopback.test.ts`, `timing.ts`) | `stallBooked` is pure, and `book()` delegates to it, so the table tests the code path the helper really uses. Rows: 0, 30 and 50 → 0; 51 → 51; 400 → 400; −5 → 0. The −5 row matters because the final `book(now)` usually sees negative lateness. The fake-timer case is correct: Jest 30 modern timers fake `performance` by default (`ms` is exactly 600, which proves it), ticks arrive exactly on schedule, so `ms === workMs === 600`. `useRealTimers` runs in a `finally`, and `HEARTBEAT_TICK_MS < 600` guards against a vacuous run with no ticks. The live case keeps only `ms >= 550` and `workMs <= ms`. Both hold under any load, since stalls are ≥ 0 and are subtracted only from `workMs`. |
| V8 | **R2-n1, R2-n2** | n1: the caller signal is created before `recordAbortTimeouts()`, and `expect(timers.calls).toEqual([LONG_REQUEST_MS])`, which is stronger than r2's two filters (S1 and S2 now also fail this case). n2: (a) `mockRestore()` in `finally` in both spy cases; (b) a new case where `main(['api'], {APP_PORT})` arms exactly one `BUDGET_MS` (H4 is killed); (c) `main` forwards `{ budgetMs }` only, so `host`/`path` can no longer leak through the seam. The CLI still calls `main(process.argv.slice(2))` without options. |
| V9 | **Mutants (e)**: own script `scratchpad/cr53r3/mut-r3.mjs` on a fresh `git archive 378af72` copy. `node_modules` and `prisma/generated` are junctioned to the worktree, and `apps/node_modules/@platform/api` is junctioned to the **copy's** `apps/api`, so the worker suite sees the mutated `readiness.ts` (R2w and W10 prove it). Each row restores its files, and they were byte-compared to `378af72` afterwards. | **C0** control: 7 suites, 132/132 pass. **Killed:** R1 (api overall ×20), R2 (8 s/9 s, api), R2w (8 s/9 s, worker), R3 (per-check ×10), W10 (overall ×10, worker), S1 (`bounded()` ×10, 3 cases), S2 (×2, 3 cases), S3 (caller signal dropped; killed after 125 s by the `workMs` bound), H1 (entry unguarded), H2 (probe `setTimeout` ×10), H3 (`BUDGET_MS` 5000), **H4** (`main` default 20 s; survived in r2), N1 (threshold 500), N2 (`>=`), N3 (never book), N4 (book every lateness: the r1 bias), **X1** (re-add `./test-support/timing` to the real api manifest: 2 cases fail), X3 (`./runtime` retargeted into `fixtures/`). **Survives:** X2 (V5, R3-n1). |
| V10 | **Union with `f68cc38` (d)** | MB = `dbfb1bd`. PR side 40 files, main side 111; `comm -12` **overlap: none**. `git merge-tree --write-tree 64504ab f68cc38` = `2ee98f0` = the tree of `60a1659`, so it is byte-identical to a clean re-merge, with no hand edits. Current `origin/main` `81f26a8` is 3 commits ahead, all docs and `.claude/agent-memory`. Overlap with the PR is none, and `merge-tree HEAD origin/main` is clean. |
| V11 | Evidence `20261115T1711Z_60a1659` | `summary.json`: verdict PASS, sha `60a1659…`, `git_dirty` false, `build_clean` true. 0 `<failure` in all 5 JUnit files. Counts: unit 5,937 (2 skipped), integration 315, api 128, catalog 102, rls-cross-tenant 126. The unit JUnit holds the 23 `image-exports` cases. `60a1659..378af72` adds only the run directory. |
| V12 | Hosted lane A, run 43741823824 on `378af72` | `fast-lane` **success**, every step executed (lint, format, type-check, unit, which runs `image-exports.test.ts`, build, evidence check). `scans` fails **only** on "Security-owned paths need a review record", and `ci-gate` fails on aggregation as a consequence. The O-1 bootstrap crash is gone. |
| V13 | `prettier --check` and `eslint --max-warnings 0` on the 8 changed files | Prettier clean. ESLint: 0 problems on the code files; the only output is the "file ignored" warning for `package.json`, which I passed by mistake. |
| Not re-run | Full lint, typecheck, unit and build; integration and api projects; `docker build` | Per the brief (light, no Docker). I relied on V11 and V12. V2 replaces the image build for the R2-B1 question. |

## R3.2 Findings

| ID | Severity | Location | Issue | Required fix |
|---|---|---|---|---|
| R3-n1 | NIT | `tools/docker/preflight.mjs:25`; `tools/docker/image-exports.test.ts:42, 67`; `tools/docker/preflight.test.ts:84` | **The exemption list is not pinned.** Both new guards read the live `SKIPPED_EXPORTS`, so adding a name there also exempts it from the regression check: mutant X2 survives. The impact is bounded. The edit lands on CODEOWNERS paths. Any production import of a pruned target still fails `docker build` (V3). An unpruned target is never exempted anyway. But the convention the orchestrator ruled on ("test helpers ship only as `./testing`") is enforced only by review. | One line next to the `ENTRY_FILES` pin in `preflight.test.ts`, or in `image-exports.test.ts`: `expect(SKIPPED_EXPORTS).toEqual(['./testing'])`, with a comment that widening it needs a security review. |
| R3-n2 | NIT | `tools/docker/image-exports.test.ts:23-28, 31-37, 48` | **Scope and precision of the check.** (a) `prisma/package.json` (`@platform/prisma`, `./client`) is image-shipped (both Dockerfiles copy it, and the api preflight imports it), but it is not scanned: the roots are only `apps` and `packages`. (b) `defaultTargets` follows only `default`. The preflight resolves with Node's default conditions (`node`, `import`, `default`, in key order), so a future `import` or `node` condition pointing into a pruned path would be missed. Today every manifest uses only `@platform/source`, `types` and `default` (verified), so nothing is missed now. (c) A wildcard is checked by substituting a placeholder segment. It is not expanded against the file tree, so the PR comment's "wildcards expanded" overclaims. This is harmless, because the preflight never imports wildcard subpaths. | (a) Add `'prisma'` (or read the root `workspaces`) to the scanned manifests. (b) Follow every condition except `types` and `@platform/source`, or assert that the condition-key set stays `{@platform/source, types, default}`. (c) Fix the wording in the next touch. |
| R3-n3 | NIT (pre-existing; no action required in this PR) | `eslint.config.mjs:283-285, 545-554` | An api production file may import `@platform/api/testing` (self-reference) or `../routing/tests/timing.js` lint-clean (V6). The worker and every package are blocked. The fail-closed backstop is the image preflight (V3). The same lint gap applies to `@platform/config/testing` from worker production code, and **that** target (`dist/testing/index.js`) is **not** pruned, so it would ship. This predates the PR. | Optional, for the next touch of `eslint.config.mjs`: a `no-restricted-imports` pattern `@platform/*/testing` for non-test files. Routed to security-analyst below for the config case. |

## R3.3 Round-2 closure

| r2 item | Status | Evidence |
|---|---|---|
| R2-B1 worker image build | **Closed** | V2 (old fails, new and base pass on the real preflight + prune-dist), V3 (fail-closed), V4 and V9 X1/X3 (the no-Docker regression check kills the re-added export), V12 (it runs in hosted lane A). |
| R2-m1 load-sensitive assertion | **Closed** | V7: the pure `stallBooked` table, the fake-clock case and the live case reduced to load-proof facts. N1-N4 killed. |
| R2-n1 vacuous 300 pin | **Closed** | V8: `toEqual([LONG_REQUEST_MS])`. S1 and S2 now also fail this case. |
| R2-n2 spy restore / H4 / seam leak | **Closed** | V8: H4 killed (V9). |
| O-1 lane A bootstrap | **Resolved for #53** | V10 (pure union) and V12 (fast-lane green). The PR #46 fallback fix stays with devops (D-ORCH-103). |

## R3.4 Merge conditions

1. A security record naming the final head `378af72` (D-SEC-PR53-01). `scans` is red only on that step (V12). After it, re-run or confirm `ci-gate` green.
2. **Do not merge `origin/main` again before merging.** Its delta since `f68cc38` is docs and `.claude/agent-memory` only, with no overlap and a clean `merge-tree` (V10). Merging it would bring agent memory after the evidence, and that is unnecessary. Squash.
3. NITs R3-n1 and R3-n2 are optional. If they ship, they need a fresh lane-B run (any code push stales `60a1659`), so they are better done as a follow-up on the next touch of `tools/docker`. R3-n3 is not this PR's.

## R3.5 Good patterns worth keeping

- The regression check reuses prune-dist's own `shouldRemove` instead of copying its rules, so the check cannot drift from the pruner. It is also stricter than the preflight (wildcards and string targets).
- The check proves itself non-vacuous in two ways: the expected manifests are found, and the exact historical defect is re-added to the real manifest.
- `stallBooked` is extracted as a pure function and called by the helper itself, so the deterministic table tests the real code path, not a twin.
- A single fix push carried the main union with SHA-level proof (predicted tree = merge tree).

## R3.6 Security flags (for security-analyst)

- R2-B1 / R2.6: test-only helpers are now kept out of every export the preflight loads (V2, V4). The `./testing` exemption itself is not pinned (R3-n1). Decide whether widening `SKIPPED_EXPORTS` needs a test-enforced review.
- Pre-existing, outside this PR (R3-n3): `@platform/config/testing` (`createTestEnv`) is importable lint-clean from worker and api production code, and it is **not** pruned from the images. Please confirm it carries no secret-bearing defaults, or route a lint restriction.
- PR30-SEC-01 / PR53-SEC-04: the magnitude pins still hold on this head (S1-S3 killed, V9).
