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
