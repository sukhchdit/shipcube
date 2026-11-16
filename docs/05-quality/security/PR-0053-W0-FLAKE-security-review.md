# PR-0053: TASK-W0-FLAKE deterministic timing under host load, security review

| Field | Value |
|---|---|
| PR | #53 `test: deterministic timing under host load (W0-FLAKE)`, https://github.com/sukhchdit/shipcube/pull/53, branch `test/w0-flake-host-load`. Commits on the merge base `73addb0`: `b274d15`, `4bc756a`, `73d8555`, `1c08263`, `d384d49`, `08efc1c`, `595fa20`, `680d741`, `57f9cf4` (test changes and the seed CLI seam), two merges of `main` (`c8460b2`, `10b5aeb`), and `8a48139` (evidence only: 8 added files under one run directory). `main` was `cb96be4` when this round was written; since the merge base it has moved by docs, code-review records and agent notes only |
| Head | 8a4813937bbe91f020985f6d708980737cb76b4b |
| Lane A evidence | Run 43721465119 on `8a48139`. **fast-lane `success`**: workflow policy, install flags, migrations immutable, lockfile, licences, signatures, audit, "Lane B evidence" (run `20261115T1341Z_57f9cf4` accepted), lint, format, type-check, unit, negative fixtures, build, Semgrep rule self-test. **scans**: "Gitleaks (PR commit range)" `success`; the only red step is "Security-owned paths need a review record" (14 owned paths, no `PR-0053-*` record). `ci-gate` is red only as the aggregate. This file is the missing record |
| Owned paths changed | 14: `prisma/seed/index.ts` (the one non-test change), `tools/test-support/process.ts` (`runNode` default), `apps/api/src/platform/routing/tests/loopback.ts` (test helpers), and the tests `apps/api/src/platform/{authn/authenticate,authz/authorise,health/router,routing/pipeline,routing/pipeline-guards}.test.ts`, `apps/api/src/platform/openapi/serve.api.test.ts`, `apps/api/src/platform/storage/s3-object-storage.http.test.ts`, `prisma/seed/cli.test.ts`, `prisma/tests/db/query-counter.int.test.ts`, `tests/generated/rls/api-cases.test.ts`, `tools/docker/healthcheck.test.ts` |
| Unowned paths changed | `apps/api/src/start-api.test.ts`, `apps/worker/src/platform/health/server.test.ts`, `tests/generated/route-metadata.test.ts`, `tools/openapi/contract.test.ts`, and the run directory `docs/05-quality/tests/runs/20261115T1341Z_57f9cf4/` (8 files) |
| Binding items checked | D-ORCH-096/097/098 (host saturation, W0-FLAKE scope), PR13-SEC-01..03 (seed redaction), PR30-SEC-01 (S3 time bounds), PR20-SEC-07/-18 (redaction growth), D-ARCH-115 (test helpers pruned from images), AT-US-012-03, D-SEC-PR23-02 (evidence commit shape) |
| Reviewer / date | security-analyst, 2026-11-15, round 1. Read-only. Git object reads ran in the main checkout. Probes ran on a type-stripped extract of `loopback.ts` in the session scratchpad; no junction, no install, no Jest, no Docker, no commit. The record simulation used a sparse `git clone --shared`. In the PR worktree I only wrote and read this file (no git command there). Line numbers come from single-file reads at `8a48139`. The code-review twin `docs/05-quality/reviews/PR-0053-W0-FLAKE-code-review.md` (CHANGES_REQUESTED, two MAJORs) landed on `main` in `cb96be4` while this round was being written; I read it before finalising, it corrected my first reading of the S3 bounds (§5.3), and I cite its IDs (routing in D-ORCH-099) |

## 1. Summary

The PR makes the loopback, health, S3, seed CLI and composition suites stable under host load: a one-shot HTTP helper (`fetchOnce`) replaces the pooled `fetch` in five api suites, upper timing bounds become "deadline plus 20 s" on a stall-corrected time (`timeOperation`), lower bounds stay exact, per-file Jest budgets rise to 60 s or 180 s, the healthcheck import probe moves into a fresh child process, `runNode` waits 300 s instead of 120 s, and the seed CLI `main` gains an optional client-factory parameter for the fake-server cases.

Most requested properties hold. The seed seam changes no production behaviour: the CLI entry passes no factory, so `withMigratorConnection` gets the same empty options as on the base, and no environment variable, argument or configuration reaches the parameter; an injected factory still receives the full pinned configuration and still passes the session pin check. `fetchOnce`, `timeOperation` and the other helpers are imported by tests only and are pruned from the runtime image. The redaction growth tests (PR20-SEC-07/-18) and every SEC-TC case are untouched. The 300 s `runNode` default fails closed.

One security timing test did lose power: the PR30-SEC-01 S3 deadline cases (the evidence that closed a MEDIUM finding) still tell "the deadline fired" from "hung", but no longer pin the deadline's magnitude, so a deadline ten times longer passes (PR53-SEC-04, LOW; the code review's R1-M2 and its surviving mutant S1). That is a merge condition (C1) in line with the code review's CHANGES_REQUESTED. The readiness bound (AT-US-012-03, code review R1-M1) lost its magnitude pin the same way; it is an availability acceptance criterion rather than a security control, and the same fix pattern applies.

Three INFO items are recorded for the follow-up task, each matching a code-review item: `timeOperation` subtracts the operation's own event-loop blocking and reads about a third low on Windows, so it must not spread to CPU-bound checks (PR53-SEC-01, = R1-m1); the worker health server's slowloris bounds have no test and the test fixture now overrides them (PR53-SEC-02, = R1-n2); `fetchOnce` silently ignores `fetch` options a future security test might rely on (PR53-SEC-03, = R1-n1).

Findings: 0 Critical, 0 High, 0 Medium, 1 LOW, 3 INFO.

**Verdict: PASS_WITH_CONDITIONS.**

## 2. Method

1. Read the full diff `73addb0...8a48139`, `prisma/seed/migrator-connection.ts`, the seed CLI entry and its callers, `tools/docker/prune-dist.mjs` and its test, the production `createWorkerHealthServer` and `readiness.ts` constants, the S3 adapter time-bound configuration and its unit pin, and D-ORCH-096..098.
2. **Import graph**: `git grep` for every importer of `routing/tests/loopback`, `tools/test-support/process` and `prisma/seed/index` at the head, split into test and non-test files.
3. **Bound-by-bound analysis** of every changed timing assertion: the target regression, the next failure mode above the new bound, and whether the old and new bound both catch it (§5.3).
4. **Stall probe** (`stall-probe.mjs`, `bias-probe.mjs`): the head's `timeOperation`, type-stripped, over an async wait (control), a synchronous busy-wait inside the operation, and a timer followed by a busy-wait; then plain async waits of 500, 1,000 and 2,000 ms and the observed `setInterval(20)` period on this host. A third probe (`worker-probe.mjs`) runs the same cases against the remediation design of PR53-SEC-01.
5. Read the code-review twin (its V6 bound mutants R1, R2, S1, its V7 heartbeat probe and V8 `fetchOnce` probe agree with mine where they overlap) and D-ORCH-099.
6. Response-shape check of `fetchOnce`: `Set-Cookie` preservation through `new Response(…)` on Node 24, and every call site's `init` members and response reads.
7. Evidence checks: lane A step list, the run's JUnit (counts per changed test file, 0 failures), the attachment hash, a count-only host-fragment scan with a positive control, a secret-shape scan, the evidence-commit shape.
8. Record simulation (§9).

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR53-SEC-04 | The PR30-SEC-01 S3 deadline tests lost their magnitude pin: upper bounds moved from `deadline + 1 s` (raw) to `deadline + 20 s` (stall-corrected), so a `bounded()` deadline ten times longer (production `get` 150 s instead of 15 s) passes the head suite and fails `main`'s | LOW | CWE-400 (regression guard of PR30-SEC-01) | A05 | `apps/api/src/platform/storage/s3-object-storage.http.test.ts:203-204, 219, 234`; production `s3-object-storage.ts:235-236` (`bounded`) | senior-developer, **this PR's fix cycle** (condition C1; same fix as code review R1-M2) |
| PR53-SEC-01 | `timeOperation` and the inline worker heartbeat subtract every late tick: blocking caused by the operation itself is removed (a 1,500 ms synchronous block reads as 20 ms) and Windows timer granularity removes about 36 % of an idle wait. Safe for today's async-hang checks; blind if reused for CPU-bound, ReDoS or scaling checks | INFO | CWE-682 | A04 | `apps/api/src/platform/routing/tests/loopback.ts:38-58`; `apps/worker/src/platform/health/server.test.ts:95-110` | Same item as code review R1-m1: this PR's fix cycle (D-ORCH-099), else TASK-W0-FLAKE-2 |
| PR53-SEC-02 | The worker health server's slowloris bounds (`headersTimeout`, `requestTimeout`, `keepAliveTimeout` = 5 s) are pinned by no test, and the test fixture now overrides two of them to 180 s on every instance | INFO | CWE-400 | A05 | `apps/worker/src/platform/health/server.ts:58-60`; `apps/worker/src/platform/health/server.test.ts:52-53` | Same item as code review R1-n2: this PR's fix cycle, else TASK-W0-FLAKE-2 |
| PR53-SEC-03 | `fetchOnce` silently ignores `signal`, `redirect`, `credentials` and `keepalive`, sends a string body chunked without the `fetch` default `content-type`, and still sends the request after rejecting an unsupported body | INFO | CWE-1068 | A04 | `apps/api/src/platform/routing/tests/loopback.ts:67-111` | Same item as code review R1-n1: this PR's fix cycle, else TASK-W0-FLAKE-2 |

## 4. Finding details

### PR53-SEC-04 (LOW): the PR30-SEC-01 deadline magnitude is no longer pinned

**Description.** PR30-SEC-01 (MEDIUM) was closed on evidence that every S3 operation without a caller signal rejects `UNAVAILABLE` at its own deadline (15 s data, 5 s metadata), with the deadline mutants killed. The production values are pinned (`s3-object-storage.test.ts:586`, `S3_TIMEOUTS`), but how `bounded()` turns them into a signal (`s3-object-storage.ts:235-236`, `AbortSignal.timeout(deadlineMs)`, alone or under `AbortSignal.any`) is pinned only by the loopback timing cases. The PR moved their upper bounds from `ms < deadline + 1_000` (and `< 1_800` for the trickle, `< 1_300` for the caller signal) to `workMs < deadline + 20_000` with the test deadlines at 400 ms and 800 ms. A deadline applied ten times too long now ends the call at 4-8 s, inside the new bound.

**Evidence.** The code review ran the mutant (its S1: `bounded()` deadline × 10) on a scratch copy: it passes all 8 cases of the head file and fails 2 cases of `main`'s file. I confirmed the arithmetic from the source (test deadline 800 ms × 10 = 8 s < 20.8 s; with the Windows under-count of PR53-SEC-01, `workMs` reads about 5 s). I first rated these rows "still detected" because a deadline that never fires runs into the 120 s request timeout; that is true for "fired versus hung" but not for magnitude.

**Impact.** No production change; the loss is regression detection for a closed MEDIUM control. Should a later change stretch the deadlines (a unit slip, a multiplier, a wrong constant passed to `bounded`), a silent or trickling store would hold request handlers and sockets for minutes instead of 15 s, which is the CWE-400 lever PR30-SEC-01 removed, and lane A would stay green. Impact M, likelihood L: LOW. Because it undoes closure evidence I relied on, I make the fix a merge condition.

**Remediation.** Keep the 20 s slack only as the structural "fired, not hung" check and pin the magnitude deterministically, as the code review proposes: `jest.spyOn(AbortSignal, 'timeout')` and assert it is called with exactly 800 for `put`, `putIfAbsent` and `get`, 400 for `head` and `delete`, and that the caller-signal case composes with `AbortSignal.any` (spy) while the 300 ms caller signal wins; or bound `workMs` by a multiple that a × 10 bug cannot pass (for example `< deadline * 3` with the PR53-SEC-01 estimator fixed). Keep the exact lower bounds.

**Verification test.** Re-run the code review's S1 mutant (`bounded()` deadline × 10) against the fixed head file: it must fail, and the unmutated control must pass. With the spy form, a × 2 variant must fail too (any multiplier is caught); with a multiple bound, document which multipliers it catches. My delta round re-checks this.

### PR53-SEC-01 (INFO): stall correction also removes the operation's own blocking

**Description.** `timeOperation` runs a 20 ms `setInterval` heartbeat in the same thread as the operation and adds every tick's lateness to `stalledMs`; `workMs = ms − stalledMs` (`loopback.ts:41-53`). The worker test copies the same loop (`server.test.ts:95-110`). Lateness has three causes, and the helper cannot tell them apart: the host froze the process (the intended case), the operation blocked the event loop, and the timer granularity of the platform.

**Probe** (head helper, type-stripped):

| Case | `ms` | `workMs` |
|---|---|---|
| Async wait 1,500 ms (control) | 1,506 | 975 |
| Synchronous busy-wait 1,500 ms inside the operation | 1,500 | **20** |
| 300 ms timer, then a 1,500 ms busy-wait in its callback | 1,801 | **200** |
| Async waits 500 / 1,000 / 2,000 ms | 505 / 1,000 / 2,007 | 335 / 640 / 1,280 (64-66 %) |

`setInterval(20)` fired every 31.6 ms (median of 50; p10 30.9, p90 32.0) on this host, so each idle tick counts about 11.6 ms as a stall.

**Exploitability and impact.** No current check is weakened into blindness: every user of the helper (`router.test.ts`, `s3-object-storage.http.test.ts`, the worker test) guards against an I/O wait that never ends, which does not block the event loop, and the next failure mode lies far above "deadline plus 20 s" (§5.3). The risk is reuse: the helper is documented as the upper-bound tool for "answers within X" checks, and a CPU-bound security check written with it (a ReDoS bound, a redaction growth bound like PR20-SEC-07/-18, a payload-size scaling bound, a bcrypt-cost bound) would subtract exactly the time it is meant to catch.

**Remediation.** Measure host stalls outside the event loop under test: start the heartbeat in a `worker_threads` Worker that adds lateness above a threshold (for example 100 ms, well above timer granularity) into a `SharedArrayBuffer` counter (`Atomics.add`); `timeOperation` reads the counter with `Atomics.load` before and after the operation. A host freeze stops both threads and is subtracted; the main thread's own blocking is not. Share the one implementation with the worker test. A jitter threshold alone (the code review's first option) removes the Windows bias but not the self-blocking, and `perf_hooks.monitorEventLoopDelay` (its second option) samples the same event loop, so it has the same blind spot; the separate thread is what tells the two apart. I probed that design (worker thread, 20 ms interval, lateness above 100 ms added with `Atomics.add`): an idle 1,000 ms wait gives `workMs` 1,002, a 1,500 ms synchronous block 1,500, and a timer followed by a 1,500 ms block 1,808, so neither the operation's own blocking nor the Windows granularity is subtracted (a real host freeze, which stops both threads, was not simulated on this host). State in the JSDoc: "never for CPU-bound, ReDoS or scaling checks; those keep raw-time ratio assertions (PR20-SEC-18 pattern)".

**Verification test.** A unit test of the helper: `timeOperation(async () => busy(500))` gives `workMs ≥ 450`; an idle `sleep(1000)` gives `workMs ≥ 900` on Windows and Linux; a simulated freeze (a child process sending `SIGSTOP`/`SIGCONT` on Linux, skipped on Windows) is subtracted.

### PR53-SEC-02 (INFO): the worker health server's slowloris bounds are untested

**Description.** `createWorkerHealthServer` sets `headersTimeout`, `requestTimeout` and `keepAliveTimeout` to 5,000 ms so a slow client cannot hold probe sockets (`server.ts:58-60`, CLAUDE.md §9). No test on the base or the head reads these values or exercises them. The PR's `start()` fixture now raises `headersTimeout` and `requestTimeout` to 180 s on every server it creates (`server.test.ts:52-53`), which is correct for the readiness cases but means the file cannot host a bound test through `start()`.

**Impact.** A regression that dropped the bounds would ship unnoticed; the server is reachable only on the worker's health port inside the task network, so the exposure is a resource-exhaustion lever for whoever can reach that port.

**Remediation.** Add one test that builds `createWorkerHealthServer(probe)` without the fixture and asserts `[server.headersTimeout, server.requestTimeout, server.keepAliveTimeout]` equals `[5000, 5000, 5000]`; optionally a raw-socket test that sends a partial request line and asserts the socket closes (raw time, generous bound, since this is I/O). Verification: mutate line 58 to `60_000`; the new test fails.

### PR53-SEC-03 (INFO): `fetchOnce` differs from `fetch` in undocumented ways

**Description.** The JSDoc says "only string and byte bodies, no redirects". Beyond that, `fetchOnce` ignores `init.signal`, `redirect`, `credentials` and `keepalive` without error; a string body goes out with chunked transfer encoding and no `content-type` (`fetch` sends `Content-Length` and `text/plain;charset=UTF-8`); the response has `url` `''` and `redirected` `false` and is not decompressed; and an unsupported body rejects the promise while `request.end()` still sends the request without a body (`loopback.ts:109-110`).

**Impact.** None today: the call sites pass headers only (`authenticate.test.ts`, `pipeline.test.ts`, `pipeline-guards.test.ts`), `GET` or a bodiless `POST` (`authorise.test.ts`) and `OPTIONS`; no assertion reads `redirected`, `url`, `Set-Cookie` or the content encoding; `Set-Cookie` survives `new Response(…)` on Node 24 (checked). A future security test written against `fetch` semantics (a CSRF "text/plain simple request is refused" case, an abort, an open-redirect check through `redirected`) would silently send a different request.

**Remediation.** Throw synchronously, before any socket opens, on a `signal`, a `redirect` other than `'manual'`, `credentials`, `keepalive`, or a body that is not a string or `Uint8Array`; set `content-length` for a body; require an explicit `content-type` header whenever a body is given. Verification: a unit test per refused member against a counting loopback server shows the error and zero received requests.

## 5. Verification of the requested items

### 5.1 The seed CLI seam

- **Change.** `main(argv, env, output, createClient?)` (`prisma/seed/index.ts:89-95`) passes `createClient === undefined ? {} : { createClient }` to `withMigratorConnection` (`:124`). The `createClient` option of `withMigratorConnection` already existed on the base ("`pg.Client` stand-in (unit tests)", `migrator-connection.ts:191-193`); the PR threads it one level up.
- **Production behaviour unchanged.** The entry point calls `main(process.argv.slice(2))` (`index.ts:151-152`): no fourth argument, so the options are `{}` and the default `pgClientFactory` is used, as on the base. The npm scripts `db:seed` / `db:seed:demo` and the tooling image (`tools/docker/tooling-entrypoint.sh:48-49`) run the file as the entry point. No environment variable, argument or configuration value reaches the parameter, and the demo path is unchanged.
- **No production injection path.** `@platform/prisma` exports only `./client`; the only importers of `prisma/seed/index` are `prisma/seed/cli.test.ts` and `prisma/tests/seed/seed.int.test.ts`.
- **An injected client stays pinned.** The factory receives `migratorClientConfig(…)` (TLS settings, statement, query and idle timeouts, the pinned `search_path` options) and `assertPinnedSession` still runs on the injected client before any seed statement (`migrator-connection.ts:232-238`). The test's `patientClient` spreads that configuration and changes only `connectionTimeoutMillis` (10 s to 120 s). The PR13-SEC-01..03 cases keep every assertion; only the extra argument and `jest.setTimeout(60_000)` were added (17 cases pass in the run).

### 5.2 `fetchOnce` and the helpers stay test-only

- `loopback.ts` gains `HOST_LOAD_SLACK_MS`, `closeLoopbackServer`, `timeOperation` and `fetchOnce`. Every importer is a test file (8 files); there is no non-test importer.
- `tsc -b` emits `dist/platform/routing/tests/loopback.js`, and `tools/docker/prune-dist.mjs` removes `fixtures/`, `tests/` and `spikes/` directories from `dist` before the runtime stage copies it (D-ARCH-115; `prune-dist.test.ts:81-88` names this file). A production import would therefore fail at start in the image (fail closed). No lint category bars production code from importing `routing/tests/**`; that is the pre-existing D-ARCH-115 arrangement (the file also holds the fixture route), and `fetchOnce` adds no capability beyond the global `fetch`, so no new finding.
- `tools/test-support/process.ts` is in the `test-support` lint category; besides test files its importers are the test harnesses `prisma/tests/harness/postgres.ts` and `prisma/tests/spikes/spk04/runner.ts`.

### 5.3 Widened bounds and security-relevant timing tests

| Test | Bound before → after | Guarded failure and the next mode above the bound | Still detected |
|---|---|---|---|
| PR20-SEC-07/-18 redaction growth (`packages/shared/src/logging/string-redaction.test.ts`, `redaction-walk.test.ts`) | not touched | n/a. No Jest config, package script, manifest or `tools/quality` change in the PR; 243 + 11 cases pass in the run | yes |
| SEC-TC cases | not touched | No SEC-TC id appears in the diff; no rate-limit, lockout, MFA, CSRF or session timing test changed | yes |
| PR30-SEC-01 request timeout (`s3-object-storage.http.test.ts`) | raw < 4 s → `workMs` < 30 s; metadata deadline 10 s → 120 s; `seen` 3 → `connections` 3 | Without `throwOnRequestTimeout` the call waits for the 120 s deadline on one connection and the SDK warns: fails on `connections`, `workMs` and the `console.warn` spy | yes |
| PR30-SEC-01 deadlines without a caller signal (`:203-204`) | lower bound `ms ≥ deadline − 50` unchanged (raw); upper raw < deadline + 1 s → `workMs` < deadline + 20 s; request timeout 10 s → 120 s | Fired versus hung: a deadline that never fires runs into the 120 s request timeout. Magnitude: a deadline × 10 ends at 4-8 s, inside the bound | hung: yes. **Magnitude: no** (code review mutant S1 survives) → PR53-SEC-04 |
| PR30-SEC-01 caller signal, trickle (`:219`, `:234`) | raw < 1.3 s / 1.8 s → `workMs` < 20.3 s / 20.8 s | An ignored signal waits for the 120 s timeouts; an endless trickle hits the 180 s Jest budget. A deadline × 10 on the trickle (8 s) passes | hung: yes. **Magnitude: no** (S1 survives the trickle case) → PR53-SEC-04 |
| AT-US-012-03 readiness (api `router.test.ts:104, 112`, worker `server.test.ts:110`) | raw < 2.5 s / 1 s / 2.5 s → `workMs` < deadline + 20 s (the first bound is derived from `READINESS_DEADLINE_MS` itself) | A check that never answers hangs to the Jest budget. An 8 s readiness answer (code review mutant R2) or a deadline × 20 (R1) passes | hung: yes. **Magnitude: no** → code review R1-M1 (availability AC; same fix pattern) |
| `query-counter.int.test.ts` | DB budgets 5 s / 2 s → 30 s | No case asserts a timeout (checked); budgets only | n/a |
| Composition and contract suites (authn, authz, pipeline, pipeline-guards, serve.api, route-metadata, rls api-cases, contract, start-api) | Jest per-test budget only (60 s or 180 s) | Assertions unchanged | yes |

The request-timeout case (`:176`) keeps its power for the flag it guards (`throwOnRequestTimeout`), and the production request-timeout value is pinned separately (`s3-object-storage.test.ts:592-603`, `requestTimeout: 10_000, throwOnRequestTimeout: true`). The deadline cases lost their magnitude pin (PR53-SEC-04, condition C1). Readiness magnitude is code review R1-M1: `/health/ready` is anonymous, but concurrent requests share one in-flight evaluation and the result is cached for `READINESS_CACHE_TTL_MS` (1 s; `readiness.ts:76, 189-202`), so a slower readiness is an operability regression, not a security lever, and I leave its severity to the code review. The worker fixture's timeout override and `timeOperation` itself are PR53-SEC-02 and PR53-SEC-01.

### 5.4 The `runNode` 300 s default

`process.ts:43` raises the default `spawnSync` timeout from 120 s to 300 s. On expiry the child is killed and `result.error` (ETIMEDOUT) is thrown (`:46`), so a hung child still fails its test, later. Because `spawnSync` blocks, the Jest timeout cannot interrupt it; the worst case is CI time, and lane A's `fast-lane` job has `timeout-minutes: 25`, which fails the job closed. No test asserts the default timeout (no test expects ETIMEDOUT from `runNode`), and no gate or production script uses the helper. Safe (the code review's R1-n4 reaches the same ruling). The related lane A concern of code review R1-m2 (nine hanging loopback cases at 180 s exceed the 25-minute job, which is then cancelled without JUnit) is diagnosability only: a cancelled `fast-lane` is not `success`, so `ci-gate` fails closed.

### 5.5 Evidence hygiene (`docs/05-quality/tests/runs/20261115T1341Z_57f9cf4/`)

- The evidence commit `8a48139` adds exactly 8 files under the one run directory on parent `57f9cf4`; `summary.json` names `git_sha` `57f9cf4…`, `git_dirty false`, `build_clean true`, profile `pr`, verdict PASS, empty `invalid_reasons` and `env_overrides`; the `coverage-summary.json` attachment hash matches the committed blob.
- Suites: unit 5,657 (2 skipped), integration 321 (1 skipped), api 128, catalog 102, rls-cross-tenant 126; 0 failures in every JUnit file. Path rules fired: `backend`, `jobs-and-platform` (no migrations suite, consistent with the manifest; lane A's evidence step accepted the run). Changed test files present with their cases, for example S3 http 8, api health router 20, worker health server 9, seed CLI 17, healthcheck 30, pipeline 21, pipeline-guards 16, authenticate 22, authorise 20, query-counter 4.
- Count-only host-fragment scan (OS user name, its 8.3 stem, home and temp directory forms, host name, git e-mail) over all 8 files: 0 for every needle; the positive control built at run time scored 5.
- Path- and secret-shaped strings: test names with synthetic fixtures already present in earlier runs on `main` (placeholder database and Redis URLs, `/run/secrets/...` locators, the AWS documentation account id, ECS metadata URLs, the per-run random password of `check-tooling-env.test.ts:14`). No real credential, no host path. Lane A's Gitleaks over the commit range passed.

## 6. Sequencing and unions

- `main` moved by docs, code-review records and agent notes only since the merge base. `git merge-tree` of the head with `main` (`78cd2a4`, and the docs-only `cb96be4` after it), with PR #52 (`a718dcd`) and with PR #46 (`4bbce92`) is clean, and none of them shares a changed path with this PR, so a later merge of `main` that brings only their paths keeps this record valid (simulation S7, S8); it would stale the lane-B evidence, though (`main` carries `.claude/agent-memory/*`).
- The code review's CHANGES_REQUESTED means a fix cycle on owned paths (`s3-object-storage.http.test.ts`, `router.test.ts`, `loopback.ts`), which voids this record for lane A by design (simulation S5). Round 2 is a delta round: PR53-SEC-04 mutants (C1), the PR53-SEC-01..03 fixes if they land, the seed seam and `process.ts` blobs unchanged or re-checked, fresh lane-B evidence, record simulation.
- D-ORCH-098 opens TASK-W0-FLAKE-2 (the `prisma/generated` reader-side lock); any of PR53-SEC-01..03 not fixed in this PR goes there.

## 7. Proposed decision

**D-SEC-PR53-01 · 2026-11-15 · security-analyst (to be logged by the orchestrator) · PR #53 r1; W0-FLAKE test seams and timing bounds.**
- **Decision:** (1) The optional `createClient` parameter of the seed CLI `main` is accepted as a test seam: the entry point never passes it, no configuration reaches it, and an injected client keeps the pinned configuration and the session pin check. (2) The `runNode` 300 s default is accepted (fails closed; CI time only). (3) Upper timing bounds of the form "deadline plus host-load slack on stall-corrected time" are accepted only as "fired, not hung" checks for I/O waits; the magnitude of a security bound is pinned deterministically (the constant against its required value and a spy on the call that applies it), and CPU-bound, ReDoS and scaling checks (the PR20-SEC-07/-18 class) keep raw-time ratio assertions and must not use `timeOperation` until PR53-SEC-01 is fixed. (4) **Condition C1:** PR53-SEC-04 (LOW, = code review R1-M2) is fixed in this PR's fix cycle, with the × 10 `bounded()` deadline mutant failing the head file (and a × 2 variant too if the spy form is used); a security delta round on the final head confirms it (C2). (5) PR53-SEC-01..03 (INFO, = code review R1-m1, R1-n2, R1-n1) go with the code review's fix cycle where D-ORCH-099 already routes them, otherwise to TASK-W0-FLAKE-2.
- **Why:** the PR removes host-load flakiness, but the 20 s slack also removed the magnitude evidence on which PR30-SEC-01 (MEDIUM) was closed, and its stall correction cannot tell a host freeze from the operation's own blocking.
- **Alternatives rejected:** keeping tight raw bounds (they fail under the saturated host of D-ORCH-096); accepting the magnitude loss as INFO (it re-opens a regression path for a closed MEDIUM control without any signal in lane A).
- **Reversibility:** High.

## 8. Earlier items

PR30-SEC-01 (MEDIUM, closed in the PR-0030 round 2): its "fired versus hung" tests keep their power, but the magnitude half of the closure evidence is lost in this PR (PR53-SEC-04, C1). PR13-SEC-01..03's redaction tests keep every assertion (§5.1). No other open finding of mine is touched.

## 9. Record validation

Simulated with `main`'s `tools/ci/check-security-owned-paths.mjs` in a sparse shared clone, over plumbing commits (nothing checked out in the worktree):

| Scenario | Expected | Result |
|---|---|---|
| S0: `8a48139` without a record, base `73addb0` (control) | missing | missing, exit 1, 14 owned paths (the lane A failure) |
| S1: this record committed on `8a48139`, base `73addb0` | pass | pass, satisfied by `8a48139`, 14 owned paths |
| S1b: as S1, base = `main` tip `cb96be4` | pass | pass, satisfied by `8a48139` |
| S2: `--pr 52` (control) | missing | missing |
| S3: the last `Verdict` row set to FAIL (control) | missing | missing |
| S4: the `Head` row names the `main` tip (control) | missing | missing |
| S5: `prisma/seed/index.ts` edited after the record | missing | missing ("changed after it") |
| S5b: `tools/test-support/process.ts` edited after the record | missing | missing |
| S6: a docs-only commit after the record | pass | pass |
| S7: merge of the `main` tip `cb96be4` after the record | pass | pass |
| S8: merge of the PR #52 head after the record (no shared path) | pass | pass |

Checks on the file itself: exactly one table row has a first cell starting with `Head` (the full SHA); the only `Verdict` row is the last table row (§10); Gitleaks emulation (v8.30.1 rules) over this file: 0 findings with its run-time positive controls firing; count-only host-fragment scan of this file: 0 for every needle; line endings LF.

## 10. Verdict

| Field | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium, 1 LOW (PR53-SEC-04), 3 INFO (PR53-SEC-01 to -03) |
| Conditions | **C1** PR53-SEC-04 fixed in this PR (deterministic magnitude pin of the PR30-SEC-01 deadlines; the × 10 `bounded()` mutant fails the head file, and a × 2 variant too if the spy form is used; same fix as code review R1-M2). **C2** A security delta round naming the final head; any fix commit voids this record for lane A by design |
| Follow-ups | PR53-SEC-01 to -03: with the code review's fix cycle (D-ORCH-099), else TASK-W0-FLAKE-2. Until PR53-SEC-01 is fixed, no CPU-bound, ReDoS or scaling check uses `timeOperation` (D-SEC-PR53-01 item 3) |
| **Verdict** | **PASS_WITH_CONDITIONS.** The seed CLI seam is test-only and changes no production behaviour; `fetchOnce` and the helpers are imported by tests only and pruned from the image; the redaction growth tests and SEC-TC cases are untouched and the `runNode` default fails closed; the evidence is clean. The widened S3 bounds no longer pin the PR30-SEC-01 deadline magnitude (C1). No Critical or High finding is open for this change |

---

## Delta round 2 (fix cycles 1–2 + union, head 378af72)

| Field | Value |
|---|---|
| Head | 378af725723fd3faca1c673767d9b22dc50b11d2 |
| Code under review | `60a1659` = merge of `main` `f68cc38` into the fix commit `64504ab`; `378af72` adds only the run directory `20261115T1711Z_60a1659` (8 files) |
| Delta since round 1 (`8a48139`) | `ab9c6c8` (round-1 record) → `fbf438b` (fix cycle 1: magnitude pins, shared timing helper, `fetchOnce`) → `4cd83fe` (merge of `main` `dbfb1bd`) → `b5dc741` (fix cycle 1: healthcheck seam) → `69a0d75` (evidence) → `64504ab` (fix cycle 2: `@platform/api/testing`, `image-exports.test.ts`, `stallBooked`, R2-n1, R2-n2) → `60a1659` (merge of `main` `f68cc38`) → `378af72` (evidence) |
| Owned paths | 19 against the merge base `f68cc38`: round 1's 14 plus `apps/api/package.json`, `apps/api/src/platform/routing/tests/{loopback.test,timing}.ts`, `tools/docker/healthcheck.mjs` (production) and `tools/docker/image-exports.test.ts`. Changed since `8a48139`: those 5 plus `routing/tests/loopback.ts`, `health/router.test.ts`, `storage/s3-object-storage.http.test.ts` and `tools/docker/healthcheck.test.ts`. The other 10 have the same blobs as at `8a48139`, including `prisma/seed/index.ts` (the seed seam of D-SEC-PR53-01 item 1) and `tools/test-support/process.ts` (item 2). The worker `server.test.ts` changed and is not owned |
| Lane A evidence | Run 43741823824 on `378af72`. **`fast-lane` `success`, every step executed**: workflow policy, install flags, migrations immutable, lockfile, release cooldown, licences, signatures, audit, "Lane B evidence" (run `20261115T1711Z_60a1659` accepted), lint, format, type-check, unit (which runs `image-exports.test.ts`), negative fixtures, build. **`scans`**: Gitleaks (PR commit range), Semgrep and oasdiff `success`; the only red step is "Security-owned paths need a review record" (19 owned paths; the round-1 record names `8a48139`, after which 9 of them changed). `security-integration` was skipped because `security_integration_due` needs `record_ok` (`tools/ci/lane-scope.mjs:44`); `ci-gate` is red only as the aggregate |
| Inputs | Fix-cycle comments `#issuecomment-6897722009` (fc1) and `#issuecomment-6898583839` (fc2); code review rounds 2 and 3 in `docs/05-quality/reviews/PR-0053-W0-FLAKE-code-review.md` (round 3, APPROVED_WITH_NITS, landed on `main` in `7652ee2` while this round was running; I read it before finalising and cite its IDs); D-ORCH-103, D-ORCH-104 |
| Reviewer / date | security-analyst, 2026-11-15, delta round 2. Read-only. Git object reads ran in the main checkout. Probes ran on two `git archive 378af72` extracts in the session scratchpad (`node_modules` = junctions to the main checkout's entries, `@platform/*` to the extract's own workspaces, so the PR's sources and manifests win). No Docker, no install, no commit, no git command in the worktree; the only file written there is this record. An earlier round-2 attempt the same day was cut off by the usage limit and wrote nothing (D-ORCH-103 (2)). Line numbers come from single-file reads at `378af72` |

### R2.1 Summary

Condition C1 is met. The PR30-SEC-01 deadline cases now pin the magnitude deterministically: `recordAbortTimeouts()` records every `AbortSignal.timeout` the adapter arms, and the cases assert exactly 3 × 800 ms and 2 × 400 ms (maximum 800), exactly `[120_000]` in the caller-signal case and one 800 ms in the trickle case. On the head file the `bounded()` × 10 and × 2 mutants fail 3 cases each, and six further deadline mutants fail too (§R2.4.1). PR53-SEC-04 is closed. This round is condition C2.

The other requested items hold:

- **Healthcheck seam.** No argument, environment variable or container command can reach the new `budgetMs` option, and the image budget stays 2 s, pinned both as a constant and through the no-options spy case.
- **`@platform/api/testing`.** The export is test-only. Its target lies under a `tests/` directory that prune-dist deletes from both images, and the runtime stage copies no `src/`, so the helper never ships. A production module that imported it would fail `docker build` at the preflight. Lint refuses it from the worker, the packages, web and prisma.
- **D-SEC-PR53-01 item 3.** No CPU-bound, ReDoS or scaling check uses `timeOperation`.
- **Unions.** Both merges of `main` are pure unions, and lane A starts again.
- **Evidence.** The run is clean.

Two new INFO items record what the code review's round 3 also found as NITs:

- **PR53-SEC-05** (= R3-n3). Lint does not stop the api's own production code from importing the test helper through `@platform/api/testing` or `../routing/tests/timing.js`; the image preflight is the backstop. The pre-existing `@platform/config/testing` helper has the same lint gap and no backstop, because it is not pruned.
- **PR53-SEC-06** (= R3-n1, R3-n2). `image-exports.test.ts` is a real regression check for the defect it targets, and it fails closed on that defect. Its exemption list `SKIPPED_EXPORTS` is not value-pinned, though, and it misses non-`default` conditions, the `prisma` workspace and a `./testing` target outside a pruned directory. Five mutants pass all 23 cases.

Findings this round: 0 Critical, 0 High, 0 Medium, 0 LOW, 2 INFO (new). Round 1's LOW is closed. Its INFO items 01 to 03 are closed, 01 and 03 with stated residuals.

**Verdict: PASS_WITH_FOLLOW-UPS.**

### R2.2 Method

1. Read the full code delta `8a48139..378af72` for the 10 changed code files, both fix-cycle comments, the code review rounds 2 and 3, D-ORCH-103/104, `tools/docker/{preflight,prune-dist}.mjs`, both Dockerfiles, `compose.yaml` and the lane A log of run 43741823824.
2. **Mutants** on an extract of `378af72`. Each edit is an exact, unique string replacement. One Jest run (`--selectProjects unit --runInBand`) per mutant, and the file is restored from a pristine extract after each run. There are 9 rows on the S3 adapter, 5 on the healthcheck and 9 on `image-exports.test.ts`, each with its unmutated control (§R2.4.1, §R2.4.2, §R2.4.4).
3. **Lint probes.** 17 probe files on real paths of a second extract, linted with the head's `eslint.config.mjs` (type-checked rules off). The controls are a worker test file, the `@platform/api/runtime` entry, a relative import into api internals and `@platform/web` (§R2.4.3).
4. **Node resolution probe** for the two export shapes that `image-exports.test.ts` passes but the preflight cannot load (§R2.4.4).
5. **Stall probe** of the head's `timeOperation`, type-stripped, plus a call-site grep (§R2.4.5).
6. **Union proof.** Predicted `merge-tree` against the actual merge trees, and the path overlap of both sides (§R2.4.6).
7. **Evidence checks** (§R2.4.7): report and attachment hashes, the lockfile hash, JUnit counts, the evidence-commit shape and the D-SEC-PR23-02 statements. The count-only host-fragment scan uses run-time needles and a positive control.
8. Record simulation (§R2.7).

### R2.3 Findings (new this round)

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR53-SEC-05 | Test helpers exported as `./testing` are not lint-confined from the api's own production code: `@platform/api/testing` (self-reference), `../routing/tests/timing.js` and `@platform/config/testing` are lint-clean in an api platform or module file, and `@platform/config/testing` also in a worker production file. The image preflight fails closed for the api helper; nothing does for the config helper, which is not pruned and ships in both images | INFO | CWE-489 | A04 | `eslint.config.mjs:544-557` (the worker policy is the only one that applies); `apps/api/package.json:9-13`; `packages/config/package.json` `./testing` → `dist/testing/index.js` | senior-developer: TASK-W0-FLAKE-2, or the first PR after PR #54 that edits `eslint.config.mjs`, whichever comes first (= code review R3-n3) |
| PR53-SEC-06 | `image-exports.test.ts` and the preflight exemption are only partly pinned. `SKIPPED_EXPORTS` has no value pin, so a new exempt name passes every test. `defaultTargets` follows only the `default` condition, so a pruned target behind `import` or a nested `node` condition passes, although the preflight cannot load it. The `prisma` workspace (a dependency of both apps) is not scanned. Nothing pins that the api's `./testing` target stays in a pruned directory | INFO | CWE-1164 | A05 | `tools/docker/preflight.mjs:25`; `tools/docker/image-exports.test.ts:23-28, 42, 48-51` | senior-developer: the next PR that touches `tools/docker/`, at the latest TASK-W0-FLAKE-2 (= code review R3-n1, R3-n2) |

#### PR53-SEC-05 (INFO): `./testing` helpers are not lint-confined from api production code

**Description.** The boundaries policies refuse `@platform/api/testing` from the worker, the packages and web/admin. Its resolved file `apps/api/src/platform/routing/tests/timing.ts` is an `app` file of `api`, and the worker may import only the runtime and module entries. But no rule stops a non-test file of `apps/api` itself from importing a `tests/` file or a `./testing` subpath. The lint probes (§R2.4.3) show:

- api production → `@platform/api/testing` (A1), relative `../routing/tests/timing.js` (A2) and an api module service file (A3): lint-clean.
- api production (A4) and worker production (W5) → `@platform/config/testing`: lint-clean.

The relative spelling predates this PR: round 1 §5.2 and code review r2 V9 both flagged it as a pre-existing gap. The PR adds the package-specifier spelling.

**Exploitability and impact.** A developer must write the import, and review must miss it.

- **Api helper.** `@platform/api/testing` resolves to `dist/platform/routing/tests/timing.js`, which prune-dist deletes. The preflight imports every compiled production module, so `docker build` fails with `cannot load dist/<module>`. This is code review r3 V3's probe; I did not re-run it, since it needs no new evidence. Lane A and lane B stay green, because neither builds an image. Before failing, the helper's `recordAbortTimeouts` would have replaced the global `AbortSignal.timeout` in tests.
- **Config helper.** `@platform/config/testing` (`createTestEnv`) has no backstop: `dist/testing/` is not a pruned name, so a production import would load in the image. It carries no secret value. Every secret is generated at run time (`randomBytes`, `generateKeyPairSync`; `packages/config/src/testing/test-env.ts:2-3, 12-36`), the hosts are on the `.test` TLD and the production Stripe entries are secret-manager references (`:79-80`). The impact is therefore misconfiguration or an outage, not disclosure. This answers code review R3.6's second flag.

**Remediation (code-level).**

1. In the repository-wide `no-restricted-imports` declaration of `eslint.config.mjs`, add a `patterns` group `{ group: ['@platform/*/testing', '@platform/*/testing/*'], message: 'test helpers: test files only' }`, switched off for `TEST_FILES` and the test-support harnesses.
2. Add a boundaries policy for the resolved-file arm: `{ from: { file: { categories: { anyOf: ['app', 'package'], noneOf: ['test'] } } }, disallow: { to: { file: { categories: 'test' } } }, message: … }`. This covers `../routing/tests/*.js` and any spelling that resolves into a `tests/` folder.
3. Decide separately whether `@platform/config/testing` should move under a pruned name, or be deleted from the runtime images by a prune rule (`dist/testing/` of `packages/config` only).

**Verification test.** Re-run the 17-case probe of §R2.4.3: A1 to A4 and W5 must be refused, while K1 and the real suites stay lint-clean (`router.test.ts` and `s3-object-storage.http.test.ts` import `routing/tests/*`; the worker `server.test.ts` imports `@platform/api/testing`). Then run lane A's lint over the tree with no new finding.

#### PR53-SEC-06 (INFO): the image-export regression check and its exemption are only partly pinned

**Description and evidence.** The check imports `SKIPPED_EXPORTS` from `preflight.mjs` and exempts it (`image-exports.test.ts:42, 67`). Nothing asserts the value: `preflight.test.ts` pins `ENTRY_FILES` but not `SKIPPED_EXPORTS`, matching code review r3 V5 and its mutant X2. `defaultTargets` (`:23-28`) reads only `default`, and the manifest list (`:48-51`) covers `apps/*` and `packages/*`. Mutants on the extract, each with all 23 cases run (§R2.4.4):

| Mutant | What changes | Real effect | `image-exports.test.ts` |
|---|---|---|---|
| E4 | `SKIPPED_EXPORTS` gains `./clock`, and the api exports `./clock` → `dist/platform/routing/tests/timing.js` | The preflight skips it; dangling export | **passes** |
| E5 | `./clock` with `import` → a `tests/` path before `default` → a runtime path | Node resolves `import` first: `ERR_MODULE_NOT_FOUND`, so `docker build` fails | **passes** |
| E6 | `./clock` with `{ node: { default: <tests/ path> } }` | Same: `ERR_MODULE_NOT_FOUND` | **passes** |
| E7 | The api `./testing` default target moved to `./dist/platform/testing/timing.js` | With the source moved too, the helper ships in both images unflagged. The preflight skips `./testing`, and `cleanTree` does not flag a `testing/` directory (as with `@platform/config/testing` today) | **passes** |
| E8 | `prisma/package.json` exports `./seed-testing` → `./dist/tests/seed.js` | The preflight imports it (both apps depend on `@platform/prisma`) and fails | **passes** |

A Node resolution probe confirms E5 and E6. A scratch package with exactly those two shapes and a missing `tests/` file gives `ERR_MODULE_NOT_FOUND` for both, and the control export loads.

**Exploitability and impact.** No security exposure today. Every manifest uses only `@platform/source`, `types` and `default` (code review r3 V4), and the api helper's target is pruned. The two failure directions are fail-closed (a broken `docker build`) or dead test code in the image (E7). `/tools/docker/` is CODEOWNED (`.github/CODEOWNERS:106`) and in the security-owned set, so a `SKIPPED_EXPORTS` change needs a security record: simulation S5 shows that a `preflight.mjs` edit voids this record. It therefore cannot grow without a review, but it can grow without a failing test.

**Remediation (code-level), in `tools/docker/image-exports.test.ts`.**

1. Add `expect(SKIPPED_EXPORTS).toEqual(['./testing'])`, with a comment that widening it needs a security record.
2. For `@platform/api`, assert that every `./testing` runtime target IS pruned (`defaultTargets(entry).every(isPruned)`). Extend the assertion to every `./testing` export once PR53-SEC-05 (3) is decided.
3. Replace `defaultTargets` with a walk that collects every string leaf, array element included, of every condition key except `types` and `@platform/source`. Alternatively, assert that each entry's condition-key set is exactly `{@platform/source, types, default}`.
4. Build the manifest list from the root `package.json` `workspaces` (or add `prisma`).

**Verification test.** E4 to E8 must fail on the fixed file, while E1 to E3 still fail and the unmutated control passes.

### R2.4 Verification of the requested items

#### R2.4.1 C1: the PR30-SEC-01 magnitude pin (PR53-SEC-04)

The production `bounded()` (`apps/api/src/platform/storage/s3-object-storage.ts:235-236`) and its callers are unchanged since `main`. The head test arms the recorder around the five operations and asserts the magnitudes (`s3-object-storage.http.test.ts:195-212`). The caller-signal case creates its own 300 ms signal before the recorder and asserts `[LONG_REQUEST_MS]` (`:226-237`), and the trickle case asserts one 800 (`:250-263`). The exact lower bounds stay. Results:

| Mutant (production `s3-object-storage.ts`) | Result on the head file (8 cases) |
|---|---|
| C0 control (unmutated) | 8/8 pass |
| S1 `bounded()` deadline × 10, both arms | **killed**: 3 failed (no caller signal, caller signal, trickle) |
| S2 `bounded()` deadline × 2, both arms | **killed**: 3 failed (same cases) |
| S1u × 10 only without a caller signal | **killed**: 2 failed |
| S1c × 10 only under `AbortSignal.any` (caller signal) | **killed**: 1 failed |
| Splus deadline + 1 s | **killed**: 3 failed |
| Sget `get` armed with the metadata deadline | **killed**: 2 failed |
| Shead `head` armed with the data deadline (400 → 800) | **killed**: 1 failed |
| Sctl `bounded()` refactored to an `AbortController` + `setTimeout` at × 10 (no `AbortSignal.timeout`) | **killed**: 3 failed (the recorder sees no deadline; a refactor must update the pin, which fails closed) |

Under S2 the stretched deadlines (1.6 s and 0.8 s) still satisfy every wall-clock bound, so the recorder assertions alone kill it. That is the magnitude pin C1 asked for. The production values stay pinned separately (`S3_TIMEOUTS`, `s3-object-storage.test.ts`). This agrees with code review r3 V9 (S1 to S3 killed).

#### R2.4.2 The healthcheck seam (`tools/docker/healthcheck.mjs`, production)

- **The CLI path cannot set it.** The entry calls `main(process.argv.slice(2))` (`healthcheck.mjs:93-96`), so `options` is `{}` and `probeReady(port, {})` uses `BUDGET_MS` (`:21`, `:50`). Any argument after the service name is refused with exit 1 (`:83-86`), pinned by the `['api', 'extra']` case (`healthcheck.test.ts:170`). The environment supplies only the port, through `probePort` (digits, 1 to 65535).
- **`main` forwards only `budgetMs`** (`:88`), so `host` and `path` cannot pass through the seam.
- **The container path cannot set it either.** The image command is the exec form `["/usr/bin/env", "-u", "NODE_OPTIONS", "node", "/app/healthcheck.mjs", "api"|"worker"]` (`apps/api/Dockerfile:133-134`, `apps/worker/Dockerfile:128-129`), and `compose.yaml` defines no `healthcheck` for the `api` or `worker` services.
- **The image probe stays at 2 s.** It is pinned by `expect(BUDGET_MS).toBe(2000)` (`healthcheck.test.ts:60`) and by the new case "main without options arms the production BUDGET_MS" (`:110-116`).

Mutants (31 cases):

| Mutant | Result |
|---|---|
| C0 control | 31/31 pass |
| H4 `main` without options arms 20 s | **killed** (the no-options case) |
| HB `BUDGET_MS` = 20000 | **killed** (the constant pin) |
| Henv a budget read from a new environment variable | survives, as expected: tests cannot pin the absence of a future feature. The guard is review, because `tools/docker/healthcheck.mjs` is security-owned and any edit voids this record (simulation S5) |
| Hall `main` forwards the whole `options` object (the R2-n2 (c) revert) | survives; not reachable, because the CLI passes no options. No security impact |

#### R2.4.3 `@platform/api/testing`: test-only, lint confinement, image layout, `SKIPPED_EXPORTS`

**Test-only.**
- The export (`apps/api/package.json:9-13`) maps `default` to `./dist/platform/routing/tests/timing.js` and `@platform/source` to the `.ts` source.
- Its only importer is the worker test `apps/worker/src/platform/health/server.test.ts:12`. The api tests import `routing/tests/timing.js` relatively: `router.test.ts`, `s3-object-storage.http.test.ts` and `loopback.test.ts`.
- No non-test file imports it (grep at `378af72`).

**Lint.** Probe files on real paths of the extract, with the head's configuration:

| Case | Result |
|---|---|
| W1 worker production, static import | refused (`boundaries/dependencies`: "apps/worker imports apps/api only through @platform/api/runtime …") |
| W2 worker production, re-export | refused (same rule) |
| W3 worker production, dynamic `import()` | refused (same rule) |
| W4 worker production, `import type` | refused (same rule) |
| P1 `packages/shared`, P2 `packages/config` | refused (`boundaries/dependencies` "packages may not import apps", `import-x/no-extraneous-dependencies`) |
| F1 `apps/web` | refused (`boundaries/dependencies`, `import-x/no-extraneous-dependencies`) |
| R1 `prisma/seed` | refused (`import-x/no-extraneous-dependencies`) |
| A1 api platform production, `@platform/api/testing` | **lint-clean** → PR53-SEC-05 |
| A2 api platform production, `../routing/tests/timing.js` | **lint-clean** (pre-existing) → PR53-SEC-05 |
| A3 api module service file, `@platform/api/testing` | **lint-clean** → PR53-SEC-05 |
| A4 api production, W5 worker production → `@platform/config/testing` | **lint-clean** (pre-existing) → PR53-SEC-05 |
| K1 control: worker test file, `@platform/api/testing` (the real usage) | clean |
| K2 control: worker production → `@platform/api/runtime` | no `boundaries` finding |
| K3 control: worker production → api internals by relative path | refused (`boundaries`, `import-x/no-relative-packages`) |
| K4 control: worker production → `@platform/web` | refused (`boundaries`) |

This agrees with code review r3 V6.

**Image layout: the helper does not ship.**
- Both Dockerfiles run `prune-dist.mjs --declarations … apps/api/dist …` in the build stage (`apps/api/Dockerfile:59`, `apps/worker/Dockerfile:59`). `shouldRemove` deletes every `tests/` directory outside `node_modules`, so `dist/platform/routing/tests/timing.js` is gone before the runtime stage.
- The runtime stage copies only `apps/api/package.json` and `apps/api/dist`, with no `src/` (`apps/worker/Dockerfile:116-117`, `apps/api/Dockerfile:121-122`). So neither the `default` target nor the `@platform/source` target exists in either image. The `./testing` manifest key remains as a dangling export, and importing it gives `ERR_MODULE_NOT_FOUND`.
- The preflight runs without `--conditions` (`apps/api/Dockerfile:131`, `apps/worker/Dockerfile:126`). `cleanTree` refuses any `tests/` path left in the app's dist or in an `@platform/*` dependency's dist (`preflight.mjs:64`, `:107`). It also imports every compiled production module, so a production import of the helper fails the build (`:140`; code review r3 V3 reproduced it, without Docker).
- The developer reports real `docker build` runs of both Dockerfiles at exit 0 (fc2 comment). I did not start Docker.

**`SKIPPED_EXPORTS`.** The value `['./testing']` (`preflight.mjs:25`) is unchanged by the PR; its blob is the same as on `main`.
- A change needs a security record: `/tools/docker/` is CODEOWNED (`.github/CODEOWNERS:106`), and simulation S5 shows that a `preflight.mjs` edit voids this record.
- No test pins the value. Growth by the R2-B1 name is caught (E3, below), growth by any other name is not (E4) → PR53-SEC-06.
- Code review R3.6's first flag ("does widening need a test-enforced review?"): yes. One assertion is enough, see PR53-SEC-06 remedy 1.

#### R2.4.4 `image-exports.test.ts`: a fail-closed regression check?

For R2-B1 it is real and fails closed:

- It applies prune-dist's own `shouldRemove` to every path prefix of every `default` target, in all 11 `apps/*` and `packages/*` manifests.
- It proves itself non-vacuous: the api, worker and config manifests must be found.
- It re-adds the exact R2-B1 export to the real api manifest.

Mutants (23 cases):

| Mutant | Result |
|---|---|
| C0 control | 23/23 pass |
| E1 the R2-B1 export `./test-support/timing` re-added to the real `apps/api/package.json` | **killed**: 2 failed ("@platform/api exports no path that prune-dist deletes", "never publishes a timing or other test helper through a non-testing subpath") |
| E2 a pruned export under an innocuous name (`./clock`) | **killed**: 2 failed |
| E3 `SKIPPED_EXPORTS` gains `./test-support/timing` | **killed**: 1 failed (the re-added-export case) |
| E4 to E8 | **survive** → PR53-SEC-06 (table there) |

It is a sound fix for the defect it targets. The five survivors are gaps in fidelity to the preflight and in the exemption pin, not a way around the image build: E5, E6 and E8 still fail `docker build`. E4 and E7 are review-guarded, because `tools/docker/` and the manifests are CODEOWNED.

#### R2.4.5 D-SEC-PR53-01 item 3 (`timeOperation`)

Call sites at `378af72` (grep over the tree, `docs` and `.claude` excluded):

- `apps/api/src/platform/health/router.test.ts:113, 131` (readiness),
- `apps/api/src/platform/storage/s3-object-storage.http.test.ts:106` (the `timed()` helper of the S3 deadline cases),
- `apps/worker/src/platform/health/server.test.ts:99` (readiness),
- `apps/api/src/platform/routing/tests/loopback.test.ts` (the helper's own tests).

All of them time I/O waits. None is a CPU-bound, ReDoS, redaction-growth (PR20-SEC-07/-18) or scaling check, and `packages/shared` does not import the helper.

The JSDoc now states the rule (`timing.ts:5-9`, `:37-44`: "Use `performance.now()` directly for those checks, never `timeOperation`").

Stall probe of the head helper. It was type-stripped, and it ran while the mutant Jest runs loaded the host:

| Case | `ms` | `workMs` |
|---|---|---|
| Async waits 500 / 1,000 / 2,000 ms | 520 / 1,027 / 2,003 | 520 / 1,027 / 2,003 (round 1: 64-66 %) |
| Synchronous 1,500 ms busy-wait inside the operation | 1,500 | 20 |
| 300 ms timer, then a 1,500 ms busy-wait | 1,804 | 323 |

The Windows granularity bias is gone, because ticks up to `HEARTBEAT_JITTER_MS` = 50 are not booked (`stallBooked`, `timing.ts:33-35`). Self-blocking is still subtracted, by design and as documented. PR53-SEC-01 is closed on that basis. The rule becomes standing in D-SEC-PR53-02 item 4.

#### R2.4.6 Union purity and lane A start-up

- `4cd83fe` (merge of `dbfb1bd`) and `60a1659` (merge of `f68cc38`) each have exactly the tree that `git merge-tree --write-tree` predicts for their parents: `6bd347f` and `2ee98f0`. The path overlap of the two sides is empty in both (PR side 30 and 40 files, `main` side 33 and 111). So both are pure unions with no hand edits.
- The merge base `f68cc38` carries `tools/ci/lane-scope.mjs` and `tools/ci/security-paths.mjs`, which `dbfb1bd` lacked. Lane A bootstrapped its gate tooling from it (`RANGE_BASE` `f68cc38`), and every step ran. The O-1 crash of run 43736296983 is gone.
- `main` has since moved to `7652ee2`: `81f26a8`, `91b5dc7`, `a1db134` and `7652ee2` touch only docs and `.claude/agent-memory`. Its `merge-tree` with the head is clean, with no overlap. Merging it would stale the lane-B evidence, so it should not be merged (code review R3.4 item 2). A merge that brings only such paths keeps this record valid (simulation S7).

#### R2.4.7 Evidence hygiene (`docs/05-quality/tests/runs/20261115T1711Z_60a1659/`)

- **Commit shape.** `378af72` adds exactly 8 files under the one run directory on parent `60a1659`.
- **`summary.json`.**
  - `git_sha` is `60a1659…` (full), `git_dirty` false, `build_clean` true; lane B, profile `pr` (no `wave` or `gate` run is committed), verdict PASS; `invalid_reasons` and `env_overrides` are empty.
  - All 5 report hashes and the `coverage-summary.json` attachment hash match the committed blobs.
  - `lockfile_sha256` matches `package-lock.json` at `60a1659`.
- **Suites.** Unit 5,937 (2 skipped), integration 315 (0 skipped), api 128, catalog-c1-c14 102, rls-cross-tenant 126. There are 0 `<failure` and 0 `<error` elements in all 5 JUnit files.
- **Changed files present.** `image-exports` 23, healthcheck 31, `loopback.test` 16, S3 http 8, api health router 21, worker health server 10. The redaction growth suites are present, 243 + 11.
- **D-SEC-PR23-02 statements, verbatim, in the fc2 gate table.**
  - "`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first (then `npm run db:generate`)".
  - "`.git/info/exclude` | is empty".
  - The evidence commit message repeats the install statement ("after npm ci --ignore-scripts and npm run deps:rebuild").
- **Host-fragment scan.** A count-only scan of all 8 files used needles computed at run time: the OS user name, its 8.3 stem, the home and temp directory forms, the host name and the git e-mail. Every needle scored 0. A synthetic positive control found 9 of 9, and the fix-cycle-1 run `20261115T1620Z_b5dc741` also scored 0.
- **Secrets.** Lane A Gitleaks over the PR commit range passed.

### R2.5 Round-1 items

| Item | Status | Evidence |
|---|---|---|
| PR53-SEC-04 (LOW, C1) | **Closed** | §R2.4.1: × 10, × 2 and six more deadline mutants fail the head file |
| PR53-SEC-01 (INFO) | **Closed, residual accepted** | §R2.4.5: Windows bias removed; self-blocking still subtracted, documented, no CPU-bound user; standing rule D-SEC-PR53-02 item 4 |
| PR53-SEC-02 (INFO) | **Closed** | `expect([server.headersTimeout, server.requestTimeout]).toEqual([5_000, 5_000])` before the fixture override (`apps/worker/src/platform/health/server.test.ts:53`). `keepAliveTimeout` (5 s, the Node default) is not pinned. I accept that: it bounds idle keep-alive sockets, not a slow request |
| PR53-SEC-03 (INFO) | **Closed, residual accepted** | `fetchOnce` now honours `signal` (sends nothing if already aborted), sends `Content-Length`, refuses an unsupported body before any socket opens and has a named 60 s deadline (`loopback.ts:36-47`; code review r2 V4). It still ignores `redirect`, `credentials` and `keepalive` and sets no default `content-type`. That is acceptable for a test-only helper whose JSDoc names its contract; a future security test that needs those semantics uses `fetch` |
| D-SEC-PR53-01 items 1, 2 | Unchanged | `prisma/seed/index.ts` and `tools/test-support/process.ts` have the same blobs as at `8a48139` |

### R2.6 Sequencing and merge prerequisites

- **A docs-only commit of this record** makes the record step pass (simulation S1, S6). The next lane A run then has `record_ok` = true with `security_paths` = true (13 security-critical paths), so `security-integration` becomes due and must run green before `ci-gate` can pass (`tools/ci/lane-scope.mjs:44, 685`).
- **No further merge of `main` before the squash.** `main` carries `.claude/agent-memory` changes after the evidence (§R2.4.6). Any push to an owned path voids this record (simulation S5).
- **Routing.** PR53-SEC-05 and -06 match code review R3-n3, R3-n1 and R3-n2, which round 3 marks optional for this PR. Shipping them here would need another code push and lane-B run, so they go to the follow-up named in §R2.3.

### R2.7 Proposed decision

**D-SEC-PR53-02 · 2026-11-15 · security-analyst (to be logged by the orchestrator) · PR #53 delta round 2; W0-FLAKE fix cycles 1-2.**
- **Decision:**
  1. The PR #53 security delta round at `378af72` (code `60a1659`) gives PASS_WITH_FOLLOW-UPS. D-SEC-PR53-01 C1 is closed: PR53-SEC-04's magnitude pin is restored by `recordAbortTimeouts`, and the × 10, × 2 and six further deadline mutants fail the head file. C2 is met by this round.
  2. `@platform/api/testing` (D-ORCH-104) is accepted as test-only. Its target lies under a `tests/` directory that prune-dist deletes from both images, the runtime stage copies no `src/`, and the image preflight fails `docker build` for any production module that imports it. Lint refuses it from the worker, the packages, web/admin and prisma, but not from api production code (PR53-SEC-05).
  3. The healthcheck `budgetMs` seam is accepted. No argument, environment variable or container command reaches it, and the image budget stays 2 s, pinned as a constant and by the no-options case.
  4. D-SEC-PR53-01 item 3 becomes a standing rule. `timeOperation` subtracts the measured operation's own synchronous blocking by design, as `timing.ts` documents. No CPU-bound, ReDoS, redaction-growth or scaling check may use it, and a new call site of that kind is a blocking review item for the code review and security. PR53-SEC-01 is closed on that basis.
  5. Widening `SKIPPED_EXPORTS` needs a security record, because `/tools/docker/` is CODEOWNED and security-owned. Its value pin and the fidelity fixes of `image-exports.test.ts` are PR53-SEC-06 (= code review R3-n1, R3-n2). The lint confinement of `./testing` helpers, including the pre-existing, unpruned `@platform/config/testing`, is PR53-SEC-05 (= R3-n3). Both are INFO. They go to TASK-W0-FLAKE-2, or to the first PR after PR #54 that touches `tools/docker/` or `eslint.config.mjs`, whichever comes first.
  6. Merge prerequisites: no further `main` merge before the squash; lane A on the record commit runs `security-integration` and ends with `ci-gate` green.
- **Why:** the fix restores the closure evidence of PR30-SEC-01 deterministically, under any host load. The new export and seam add no production path. The remaining gaps fail closed (a broken image build) or are review-guarded, so they do not justify another code push and lane-B run here.
- **Alternatives rejected:**
  - Requiring PR53-SEC-05/-06 in this PR: an INFO hardening for one more fix cycle, where the fail-closed backstops already exist.
  - Relying on CODEOWNERS alone for `SKIPPED_EXPORTS`: that is review-only, and mutant E4 passes every test.
  - Requiring the worker-thread heartbeat of round 1's PR53-SEC-01 remedy: the documented rule plus the call-site audit covers the risk at lower cost.
- **Reversibility:** High.

### R2.8 Record validation

Simulated with the base-ref copy (`f68cc38`) of `tools/ci/check-security-owned-paths.mjs` (as lane A runs it, `--json`) in a sparse `git clone --shared`, over plumbing commits. Nothing was checked out in the worktree. The candidate is this file: the round-1 text plus this section.

| Scenario | Expected | Result |
|---|---|---|
| S0: `378af72` with the round-1 record only (control; the lane A failure) | missing | missing ("names 8a48139, but … changed after it"), 19 owned paths |
| S1: this record committed on `378af72`, base = merge base `f68cc38` (lane A) | pass | pass, satisfied by `378af72`, 19 owned paths |
| S1b: as S1, base = `main` tip | pass | pass, satisfied by `378af72` |
| S2: `--pr 52` (control) | missing | missing |
| S3: this round's `Verdict` row set to FAIL (control) | missing | missing |
| S4: this round's `Head` row names the `main` tip (control) | missing | missing (the round-1 head row still names `8a48139`) |
| S4b: this section without its own `Verdict` row (procedural, PR10-SEC-04) | pass | pass: the round-1 PASS_WITH_CONDITIONS row is then the last one, so each round must append its own |
| S5: an owned path edited after the record: `tools/docker/healthcheck.mjs`, `apps/api/package.json`, `tools/docker/image-exports.test.ts`, `routing/tests/timing.ts`, `prisma/seed/index.ts`, and `tools/docker/preflight.mjs` (owned, not changed by the PR) | missing ×6 | missing ×6 |
| S6: a docs-only commit after the record | pass | pass |
| S7: merge of the `main` tip after the record, base = `main` tip | pass | pass |
| S8: merge of a `main` commit that edits `tools/docker/healthcheck.mjs` (an owned path the PR also changes), base = that commit | missing | missing |
| S9: merge of a `main` commit that edits `tools/docker/preflight.mjs` (owned, not in the PR), base = that commit | pass | pass |

Checks on the file itself:

- Exactly one table row per round has a first cell starting with `Head`, each naming the full SHA. The checker binds both; the round-1 one only adds a note.
- The last `Verdict` row is this round's (§R2.9).
- Gitleaks emulation (v8.30.1 default rules, 221 of 222 compiled) over the whole file found 0, with its run-time positive controls firing 3 of 3.
- The count-only host-fragment scan of the file scored 0 for every needle.
- Line endings are LF, and the first 184 lines (round 1) are byte-identical to `378af72`.

### R2.9 Verdict (delta round 2)

| Field | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium, 0 LOW open; 2 INFO new (PR53-SEC-05, PR53-SEC-06). Closed: PR53-SEC-04 (LOW, C1), PR53-SEC-01 and -03 (INFO, residuals accepted), PR53-SEC-02 (INFO) |
| Conditions | None open. C1 is closed (§R2.4.1), and C2 is this round |
| Follow-ups | PR53-SEC-05 and -06 → TASK-W0-FLAKE-2, or the first PR after PR #54 that touches `eslint.config.mjs` or `tools/docker/` (D-SEC-PR53-02 item 5). Merge prerequisites (§R2.6): `security-integration` green on the record commit, no further `main` merge, squash |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** The PR30-SEC-01 deadline magnitude is pinned again (C1 closed; × 10 and × 2 mutants killed). The healthcheck seam has no production path and the image probe stays at 2 s. `@platform/api/testing` is test-only and never ships in an image. Both unions are pure, the evidence is clean, and no Critical or High finding is open for this change |
