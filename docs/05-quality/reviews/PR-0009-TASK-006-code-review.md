# PR #9 — TASK-006 API and worker runtime skeleton — code review (round 1)

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A well-layered skeleton with strong error-leak hardening (own-data reads, hostile-Proxy property test, generic 5xx),
         a correct readiness runner, and clean worker import boundaries. One MAJOR: the session-integrity start-up check
         treats "first readiness probe" as "fresh connection", so a '' left by any transaction-local set_config gives a
         false tampering verdict and a 5-minute sticky 503 (probe-proven). Five MINORs, ten NITs.
```

| Field | Value |
|---|---|
| PR / head | #9 `feat/TASK-006-api-worker-runtime-skeleton-express` @ `374166d` (merge-base with main `7712c7c`) |
| Sheet | `docs/04-plan/tasks/WAVE-00.md` TASK-006 (incl. D-ARCH-070 routed lines 247–248) |
| Stories / ATs | US-007 (AT-US-007-01..05), US-012 DC (AT-US-012-01..05) |
| Decisions reviewed | D-TASK006-01..07 (DECISIONS.md L1231) |
| Hosted CI | `statusCheckRollup` empty (lane A not on main yet; D-ORCH-004 local-gate rule) |
| Reviewer | code-reviewer, 2026-11-12 |

## 1. Verification performed by the reviewer

Constraints (D-ORCH-010): no `npm ci`, no builds, no Docker, no full suites. The following ran from a `git archive 374166d` scratch copy with `node_modules` junctioned to the worktree (removed afterwards; the worktree is clean and its `node_modules` is intact):

| Check | Result |
|---|---|
| `jest --selectProjects api --testPathPatterns problem-handler` | 1 suite, **17 passed** (AT-US-007-01..05, PR7-SEC-03 item 2, fast-check hostile values) |
| `jest --selectProjects unit --testPathPatterns platform/db/session-integrity.test` | **11 passed** |
| `jest --selectProjects unit --testPathPatterns platform/health/router.test` | **14 passed** |
| `prettier --check` on every changed `.ts/.mjs/.json/.md` | clean |
| Behaviour probe (tsx + supertest against `createApp`) | corrupt `gzip`/`deflate` body → **500 INTERNAL_ERROR** (thrown: `Z_DATA_ERROR`, `status: 400`, no `type`), see m1. Valid gzip over real HTTP → 200. Unknown `Content-Encoding` → 415. `charset=latin1` → 415. JSON primitive → 400. `TRACE` on a known path → 405 + `Allow`. `OPTIONS` → Express's built-in 200 `text/plain` |
| Session-integrity probe (fake pool returning `context = ['', '', '', '']` on the first query) | t=0 s, 60 s, 299.999 s → **NOT READY (`db_session_default_tampered`)**; t=300 s → ready. One security event. See M1 |
| Lint probe (`eslint.config.mjs` of the PR, miniature repo) | a non-empty generated registry (`modules/index.generated.ts` → `./quotes/index.js`) lints clean. Worker relative imports into apps/api: runtime/module-entry → `no-relative-packages`; routes → boundaries message. The policies work as claimed |
| Express 5.3.0 `app.listen` source | the callback is registered as `server.once('error', done)` (n1) |

**Not re-run by me:** lint, typecheck, the full unit suite (985), integration (57; Testcontainers), build, coverage, `npm audit`. For these I rely on the author's gate table at `53af474` plus the partial re-run at `d927ce3`. The gatekeeper must re-run all gates on the merge-main head (§6).

## 2. Findings

| ID | Sev | Location | Issue | Required fix |
|---|---|---|---|---|
| **M1** | **MAJOR** | `apps/api/src/platform/db/session-integrity.ts:104,113` (`freshConnection: checkedAt === undefined`); `health-check.ts:21-22` | The sheet (L248) asks for the start-up probe to read the four `app.*` keys "**on a fresh connection**" and to require NULL. The code treats the *first readiness evaluation* as fresh, but it runs `pool.query` on whatever pooled connection is idle. Once TASK-016's `withTenantTx` exists, any transaction-local `set_config('app.*', …, true)` before the first probe leaves `''` on that backend. The module's own header (L10-11) and ADR-0005 item 16 (F-07) acknowledge this. The NULL-only rule then raises `db_session_default_tampered`. The findings are cached for `SESSION_INTEGRITY_INTERVAL_MS`, so the database stays **not ready for 5 minutes** (probe in §1). The worker is the likely victim: jobs start before the container's first health check, and repeated unhealthy checks make ECS replace the task, so the cycle can repeat. API traffic is gated by the ALB until healthy, but compose and dev are not. A false security event and a self-inflicted outage in a security control are a correctness defect, and the trigger (TASK-016) is in flight now. | (a) Run the start-up evaluation **eagerly at boot**, before `listen` and before any processor starts (the sheet says "at start-up"; D-TASK006-06's lazy start deviates from it). Use a **dedicated new connection**, e.g. a one-shot `pg.Client` built from the same validated `toPoolConfig`, then closed. Require NULL there. Pooled probes then always accept NULL or `''`. (b) Do not cache a *failing* result for the whole interval: while findings are non-empty, re-query on every probe and keep the per-transition event de-duplication, so a fixed drift recovers at once. (c) Tests: a unit test showing a first pooled row with `''` is not tampering when the start-up row was NULL. An integration test running `BEGIN; SELECT set_config('app.org_id', 'x', true); COMMIT` on the pool **before** the first probe, expecting `database: ok`. Keep the existing NULL-required negative test for the dedicated connection. |
| m1 | MINOR | `apps/api/src/platform/http/json-body.ts:41`; `platform/errors/classify.ts:8-15` | A malformed compressed body (bad gzip/deflate) is a client error. body-parser raises it as `status: 400` with no `type`, and the classifier answers **500 INTERNAL_ERROR** (probe-proven). This breaks REQ-PLAT-010 / EC-A50 ("malformed … 400; no handler runs"). It also lets unauthenticated clients raise the 5xx rate at will, and 5xx rate is the input to ROLLBACK_TRIGGERS and SLO burn alerts. | Map at the source, not in the global classifier: in `jsonBodyParser`, wrap the parser's callback so an error with a numeric `status` 400–499 that is not already mapped by `type` becomes `AppError('MALFORMED_REQUEST', { cause })`. Add API-test rows for corrupt `gzip`, `deflate` and `br`. |
| m2 | MINOR | `platform/runtime/services.ts:40-42`; `readiness.ts:169`; TASK-019/021 sheets | **Ruling on reviewer focus 2:** `pendingCheck` reporting `ok` is **acceptable for Wave 0**. `HealthReady` has `additionalProperties: false`, all five keys are required, and the enums are `ok`/`unavailable`/`degraded`, so neither "pending" nor omission is valid. `unavailable` would make every stack permanently not ready. The sheet (L246) scopes the real checks to DB and Valkey. **But nothing tracks the stubs.** TASK-019 is a spike whose DoD says "throwaway code is not merged". The TASK-021 sheet does not mention readiness. No sheet line replaces any of the three stubs. AT-US-012-02-object-storage and AT-US-012-04 are proven only against fakes, while traceability will record US-012 (DC) as completed by TASK-006. | Orchestrator: add acceptance lines to the task that merges the production S3 adapter (a HeadBucket check, plus AT-US-012-02-object-storage against RustFS) and to the audit store / chain-verification task (`audit_partitions`, `audit_chain`). Record US-012 as complete except those two rows until then. Optional interim: a 2 s TCP-reachability check of `STORAGE_ENDPOINT` instead of a constant `ok`. |
| m3 | MINOR | `platform/runtime/readiness.ts:151-156`; `health/router.ts:28` | `/health/ready` is public, unauthenticated and outside rate limiting by design (openapi `x-rate-limit-class: none`; the staging server is listed). Each call runs `SELECT 1` plus a possible catalog query on the **request pool** (api max 10) and a Valkey `PING`, with no coalescing. pg queries cannot be aborted: an abandoned probe's checkout stays queued up to `connectionTimeoutMillis` (5 s), then runs. A flood of probes therefore starves business requests of pool connections, and may make readiness fail as well. | In `createReadinessProbe`, single-flight concurrent calls and reuse the last report for a short TTL (e.g. 1 s, configurable). Add a unit test: 50 concurrent `readiness()` calls run each check once. Flag for security-analyst (see §5). |
| m4 | MINOR | `platform/errors/problem-handler.ts:80-81` | Problem responses send no `Cache-Control`, and they keep representation headers that a handler set before throwing (`ETag`, `Last-Modified`, `Content-Disposition`, `Cache-Control: public…`). 404 and 405 are heuristically cacheable (RFC 9110 §15.1), so an edge or CDN may store a problem body, including one request's `correlation_id`. ADR-0016 am. 1 already defaults authenticated responses to `no-store`. | Before sending: remove `ETag`, `Last-Modified`, `Content-Disposition` and `Content-Language`, and set `Cache-Control: no-store`. Add an assertion in `expectProblem`, plus one test where the route sets `ETag`/`Cache-Control: public` and then throws. |
| m5 | MINOR | `platform/runtime/log.ts:9-11`; `problem-handler.ts:60-71`; AT-US-007-03 | The AT's last line says "the full error is present in the server logs". The seam passes the raw value as a separate argument (tested), but the interim `RuntimeLog.error` drops it. Until TASK-010, a 500 in compose logs only `error_class`, so the AC holds only at the seam. Logging nothing unredacted is the right trade-off, but it must not stay unverified. | Route to TASK-010: an end-to-end AT-US-007-03 assertion that the Pino adapter writes the redacted error (message and stack, with `SECRET` redacted) for the same request. Name it in the AT map as "seam proven in TASK-006, sink in TASK-010". |
| n1 | NIT | `apps/api/src/main.ts:18`; `apps/worker/src/main.ts:165` | Express 5.3 `app.listen(port, cb)` registers `cb` as a once-`error` listener. On `EADDRINUSE` the log says `api.listening` and then `api.listen_failed`. The worker's `server.listen` (node:http) is fine. | `app.listen(port, (error?: Error) => { if (error === undefined) log.info(...) })`. |
| n2 | NIT | `platform/runtime/shutdown.ts:66-75`; `readiness.ts:124-128`; api `main.ts:26-30` | The comment says draining lets "the load balancer stop routing before the listener closes". `startDraining()` and `server.close()` happen in the same tick, so there is no such window: during ALB deregistration, new connections are refused and the ALB answers 502. | Route to TASK-214 (US-013): a configurable pre-close delay after `startDraining()` (e.g. 5–10 s, below the ECS stop timeout). Reword the comment now. |
| n3 | NIT | `platform/db/client.ts:30-31`; `packages/config/src/schema.ts:161-165` | "Default 25 000, the `platform_app` role value": `00-roles.sql` sets no `statement_timeout`. data-model §4.1 / A18 and the TASK-016 sheet add a **30 s** backstop in `02-role-backstops.sql`, while platform.md:341 still says 25 s. Also, the pool's startup parameter overrides a role default on every pooled connection, so TASK-016's backstop only affects non-pool sessions. | Reword both comments: "pool-level backstop, 25 s; the role backstop (TASK-016, 30 s) applies only outside the pool". Architect: fix platform.md:341. |
| n4 | NIT | `platform/db/session-integrity.test.ts:24-30` | The pin test parses only `00-roles.sql`. When TASK-016 extends `EXPECTED_ROLE_SETTINGS` with `statement_timeout=30s` from `02-role-backstops.sql`, the test must read both files. | Route to TASK-016: parse every `prisma/bootstrap/*.sql` with the same regex. |
| n5 | NIT | `packages/config/src/file-secret-provider.ts:29,142` | `open(O_RDONLY\|O_NOFOLLOW)` on a FIFO blocks before `fstat` can reject it. That costs a libuv thread, and the abort budget can't release it; start-up still ends with `ref.timeout`. Residual: parent-directory swaps between `realpath` and `open` (only the last component has `O_NOFOLLOW`). This needs write access to `/run/secrets`. | Add `O_NONBLOCK` on POSIX (no effect on regular files). Note the parent-component residual in the header. |
| n6 | NIT | `platform/runtime/services.ts:55-62`; `valkey/options.ts:106-107` | `DatabaseConfigError` (a URL query parameter outside the allow-list), `ValkeyConfigError` and the `URIError` from `decodeURIComponent('%zz')` are thrown after `loadRuntimeConfigOrExit`. They escape top-level `await` as exit 1 with a stack, not exit 78 with a key name. The messages are value-free, so this affects operability only. | Either enforce the PR5-SEC-08 allow-list and Valkey's no-query rule in the `@platform/config` URL types (best: one place, exit 78), or map these errors in both `main.ts` files to the config report. |
| n7 | NIT | PR description | Three statements in the description don't match the code. It says inbound `X-Request-Id`; the code uses `X-Correlation-Id`. It says one event `security.db_session_integrity`; the code emits one event per finding (`security.db_role_setting_drift` / `security.db_session_default_tampered`). It calls AT-US-007-04 an "UNAUTHENTICATED AppError"; the code uses `AUTH_REQUIRED`. The squash body becomes history. | Correct the PR body before squash-merge. |
| n8 | NIT | `platform/runtime/readiness.ts:143-163` | ADR-0005 am. 10 item 16 needs a process-level "not ready until restart" latch for `DB_SESSION_CONTEXT_LEAK`. `ReadinessProbe` only offers `startDraining()`. | Route to TASK-016: add a latch, e.g. `markUnready(component)` or a latch-reading database check. No change needed here. |
| n9 | NIT | `platform/http/fallback.ts` | `OPTIONS` on a known path gets Express's automatic 200 `text/plain` (`Allow` body), not problem+json. That is acceptable until CORS (TASK-017) owns `OPTIONS`. | Note for TASK-017. |
| n10 | NIT | `platform/valkey/options.ts:41,104` | `maxRetriesPerRequest: 1` is right for request-path commands. BullMQ `Worker` connections require `null` and throw otherwise. | Route to the first BullMQ task: build queue connections through `buildValkeyOptions` with a `maxRetriesPerRequest: null` override, not the readiness client. |

## 3. Rulings on the author's reviewer-focus items and decisions

1. **classify + problem-handler (focus 1):** no path copies a thrown value's message, stack or properties into the body. `ownDataProperty` never invokes getters. `safeInstanceOf` survives throwing traps. 5xx always carries `GENERIC_SERVER_DETAIL`, even for an `AppError` with a secret detail. `instance` drops the query and is capped at 2048. The `headersSent` path passes a code-only `AppError` to finalhandler. **Accepted.** The m1 mapping gap is a classification issue, not a leak.
2. **pendingCheck `ok` (focus 2, D-TASK006-04):** accepted for Wave 0, with tracking conditions (m2).
3. **holders.ts (focus 3, D-TASK006-02):** accepted. The refusal in staging/production plus the warning in local while `compose.env` is shared is the right interim. TASK-014's per-service env split must flip local to refusal (already noted on the watchlist).
4. **Exact-set comparison incl. database-level settings (focus 4):** accepted as designed ("exact set" is the sheet's wording). It is safe on RDS, because parameter-group values live in `postgresql.conf`, not in `pg_db_role_setting`. The runbook should say that a DBA-added `ALTER DATABASE … SET` fails readiness by design.
5. **win32 without O_NOFOLLOW (focus 5):** accepted (Linux containers only), with n5.
6. **api `build` runs the generator (focus 6):** accepted. Lane A's post-build porcelain step (PR #10 `check-porcelain`) catches a stale committed registry. TASK-014's builder stage must include `tools/api/`, prettier and the Prettier config.
7. **D-TASK006-01 (worker import surface):** accepted. `./runtime` re-exports no Express code. The lint policy order ("last matching policy wins") is correct, and the lint probe confirmed the relative, internal-subpath and routes forms are refused.
8. **D-TASK006-03 / 05 / 07:** accepted (n3 corrects the 25 s rationale). D-TASK006-06 (lazy start-up check) is **not accepted** as implemented (M1).

## 4. Follow-up closure (items routed to TASK-006)

| Item | Status |
|---|---|
| PR #2 m8 (worker package-specifier fixtures), R2-n7 (routes → module-entry) | **Closed**: `REPO_PROBES` plus the fixture `bad-routes-other-module.ts`; my lint probe agrees |
| PR #5 CR m7 (pool `statement_timeout`) | **Closed** (wording: n3) |
| PR3 m4 / PR3-SEC-05 (`loadRuntimeConfigOrExit`), m5 / PR3-SEC-06 (holders), PR3-SEC-16, PR3-SEC-07 residual (single open + `O_NOFOLLOW` + bounded read) | **Closed** (residual: n5) |
| PR3-SEC-02/-12 consumer half (ioredis from parsed parts, `servername`, TLS 1.2 floor, no query) | **Closed**: SNI is set only for DNS names (IP literal → IP-SAN verification), which is correct |
| PR5-SEC-08 (URL parameter allow-list, percent-decoded, repeats refused, no echo) | **Closed** (n6: enforce at the config layer for exit 78) |
| PR5-SEC-07 (`NODE_OPTIONS` dropped from Prisma children, case-insensitive) | **Closed** |
| PR7-SEC-03 items 2 and 4 (no Prisma/driver text in bodies; `errorFormat: 'minimal'`) | **Closed** (test asserts both; the constructor type pins `'minimal'`) |
| PR7-SEC-06 item 3 + PR7-SEC-02 item 2 (drift + fresh-connection check) | **Open: M1** |

## 5. Security flags for security-analyst

- **m1:** an unauthenticated client can inject 5xx (corrupt `Content-Encoding` body) → alerting and auto-rollback manipulation (CWE-755).
- **m3:** an amplification path from public `/health/ready` into the request DB pool (CWE-400).
- **M1:** a false-positive security event and self-inflicted not-ready in the PR7-SEC-06 control. Please confirm the dedicated-connection design for the start-up probe.
- **m4:** cacheable error responses at the edge (CWE-525).
- **n5:** secret-file FIFO blocking, and the parent-component TOCTOU residual (PR3-SEC-07).

## 6. Merge conditions

1. M1 fixed with the tests listed. m1, m3 and m4 are small and should land in the same cycle. m2 and m5 are orchestrator routing (sheet lines and traceability), not code.
2. Merge-main pass after PR #10. PR #10 also edits `eslint.config.mjs` and `package.json`, and adds Semgrep rules and suppression rules. Re-run lint (ESLint + Stylelint), Semgrep, format, typecheck, unit, api, the integration suites that touch health and session integrity, build, the post-build porcelain check, and coverage on the merged head. Prove the merge is a pure union apart from the conflict files.
3. Hosted lane A green on the final head (once PR #10 is on main), or the D-ORCH-004 local-gate record for it.
4. PR description corrected (n7); squash-merge, because commit `65e97d1` fails commitlint.

## 7. What is worth keeping

- The hostile-value fast-check property (Proxies with throwing traps, throwing getters, look-alike `type` values) is the right way to prove "no internals leak".
- The readiness runner bounds each check and the overall deadline with `AbortSignal.any` and races the check, so a non-cooperating check cannot hold the response. A wiring assertion (`assertReadinessChecks`) pins each check's criticality to the schema.
- The `Allow` header is derived from the mounted routers, with a test pinning the Express internals, rather than a hand-kept table.
- The generated module registry has a `--check` mode, and a test asserts the committed file is current.
- Value-free errors are used throughout: class names, errno codes and key names, never messages or URLs.

## Round 2 (head 05855b1)

```
VERDICT: CHANGES_REQUESTED
SUMMARY: Fix cycle 1 closes M1 correctly: a dedicated boot connection, NULL required, '' accepted on the pool afterwards,
         only passes cached, single-flight, startup never rejects. m1, m3, m4, n1, n3, n7 and the security items are closed too.
         But the new UTF-8 media-type check (PR9-SEC-01) adds an exponential-backtracking regex. One unauthenticated
         request with a 77-byte Content-Type blocks the API event loop for about 100 s (probe-proven): BLOCKER R2-B1.
```

| Field | Value |
|---|---|
| Delta | `374166d..05855b1` (5 commits: 3cf1526, 1ed09e7, 056cd46, 6af84ef, 05855b1); `main` not merged (D-ORCH-014: after PR #10) |
| Inputs | fix comment #issuecomment-6831965273; D-TASK006-02; D-ORCH-014; PR #9 security review (PR9-SEC-01..13) |
| Hosted CI | `statusCheckRollup` empty on `05855b1` (lane A not on main yet) |
| Reviewer | code-reviewer, 2026-11-12 |

### R2.1 Verification performed by the reviewer

Constraints: no commands in the TASK-006 worktree; no `npm ci`, builds, Docker or full suites. I ran everything below from a `git archive 05855b1` scratch copy, with `node_modules` junctioned to the worktree. The junction and the copy were removed afterwards. The worktree `node_modules` count is unchanged (740), there is no stray link at `C:\`, and the main checkout is clean apart from a pre-existing memory file.

| Check | Result |
|---|---|
| unit `platform/db/session-integrity.test` | **17 passed** |
| unit `platform/runtime/services.test` | **6 passed** |
| unit `platform/health/router.test` | **18 passed** |
| unit `platform/db/client.test` | **47 passed** |
| unit `tools/deps/npm-node-options.test` (real npm, 4 sources, positive controls) | **5 passed** (8 s) |
| api `problem-handler.api.test` | **40 passed** |
| `prettier --check` on every changed file (excluding `.env.example`) | clean |
| **ReDoS probe:** `isUtf8JsonContentType` directly; `type-is` accepts every input below as `application/json` | `application/json` + `';  '`×n + `'!'`: n=10 → 2 ms, n=14 → 153 ms, **n=18 (71 B) → 13.6 s, n=20 (77 B) → 101.6 s**. `' ;'`×22 → 100 ms. Long well-formed parameter lists stay linear (12 kB → 0.17 ms) |
| **ReDoS over real HTTP** (`createApp` + `app.listen(0)`, `POST /unauthenticated-anything`, body `{}`) | 415 every time, but n=14 → 143 ms, n=15 → 310 ms, n=16 (65 B) → **960 ms with a 950 ms event-loop stall** (×3 per 3 bytes) |
| Candidate fix (R2-B1): move the post-`;` OWS inside the optional parameter | adversarial inputs up to n=2000 run in < 5 ms; **0 differences** from the current regex over 200 000 random short headers (alphabet `` \t;a="\!/``) |
| pg TLS probe (`new pg.Client(toPoolConfig(…)).connectionParameters`) | no sslmode + `PGSSLMODE=no-verify` or `require` → `ssl:false`. `disable` + `PGSSLMODE=require` → `false`. `prefer`, `require(+uselibpqcompat)`, `verify-full(+uselibpqcompat)`, `sslnegotiation=direct` alone, `%76erify-full` → `{rejectUnauthorized:true}`. The connection string reaches pg without a query string; host and db parse correctly |
| Config-accepted params at the runtime | `?sslmode=verify-full&application_name=x` and `…&connect_timeout=5` → `DatabaseConfigError` (R2-m2) |
| `toBodyError` | http-errors 400 (status on the prototype) → `MALFORMED_REQUEST`; 413 typed → unchanged; 500 → unchanged; own `status:400` → mapped; status 5 prototypes deep → not mapped (bounded walk, as designed) |

**Not re-run by me:** lint, typecheck, the full unit suite (1041), integration (59; Testcontainers, including the new M1 `set_config`-before-first-probe test), build, `npm audit`, porcelain. For these I rely on the developer's gate table on `05855b1` in the fix comment. Coverage is owed on the merge-main head.

### R2.2 Findings

| ID | Sev | Location | Issue | Required fix |
|---|---|---|---|---|
| **R2-B1** | **BLOCKER** | `apps/api/src/platform/http/json-body.ts:31` (`MEDIA_TYPE`), reached from `:86` for every request with a body on every path, before routing and authentication | `(?:[ \t]*;[ \t]*(?:param)?)*[ \t]*$`: the parameter is optional, so a run of spaces between two `;` can be split between "after `;`" of one iteration and "before `;`" of the next in k+1 ways. A failing match therefore backtracks through (k+1)^m splits. `req.is()` runs first, but `type-is` accepts these headers as `application/json`, so nothing stops them. **One unauthenticated ~80-byte `Content-Type` freezes the whole API process:** ~100 s at 77 B, and hours a few bytes later. `/health/live` hangs too, so ECS restarts the task, and a trickle of requests keeps the service down. CWE-1333 / CWE-400. This was introduced by this fix cycle (PR9-SEC-01). | (1) Make the grammar unambiguous by moving the post-`;` OWS inside the optional parameter: ``new RegExp(`^[ \\t]*${TOKEN}/${TOKEN}(?:[ \\t]*;(?:[ \\t]*${TOKEN}=(?:${TOKEN}\|${QUOTED}))?)*[ \\t]*$`, 'u')``. My probe shows it is linear and accepts the same set. A small hand-written linear scanner is equally fine. (2) Defence in depth: refuse a `Content-Type` longer than a fixed bound (e.g. 256 B) with 415 before any regex. (3) Tests: unit rows for `';  '`×5000+`'!'`, `' ;'`×5000+`'!'` and `';\t \t'`×5000+`'!'`, each finishing within a small wall-clock budget (e.g. < 50 ms). A fast-check property: random strings over `` \t;a="\!/`` up to length 2000 each evaluate in < 50 ms. An api-test row with the adversarial header → 415. (4) Re-check `PARAMETER` and every other regex added in this delta against the same pattern (I found no other ambiguous one). |
| R2-m1 | MINOR | `apps/api/src/platform/runtime/services.test.ts:45-49,61,68-70` | The tripwires' `pending` half is vacuous. `pendingNames()` returns the *names* of all non-database/redis checks, so it includes `object_storage`, `audit_partitions` and `audit_chain` whether or not those are stubs. When TASK-019 does the right thing (S3 client plus a real HeadBucket check), the test still fails with `{usesS3:true, pending:true}`. The developer must edit it, and the obvious edit (`usesS3: true`) silently re-accepts a stub forever. | Brand the stubs: `pendingCheck` registers its result in a module `WeakSet` and exports `isPendingCheck(check)`. Assert the implication: `!(usesS3 && isPendingCheck(objectStorage))`, and the same for the audit pair. Then the test passes once the stub is replaced and fails only while replacement exists and the stub is wired. |
| R2-m2 | MINOR | `packages/config/src/guards.ts:62-69` vs `apps/api/src/platform/db/client.ts:68` | **Ruling on the allow-list inconsistency.** The config transport guard accepts `application_name` and `connect_timeout` on `DATABASE_URL`, but `toPoolConfig` refuses them (probe). The **runtime rule is correct**: `application_name` would override the per-service `applicationName` used for `pg_stat_activity` attribution, and `connect_timeout` would override the bounded `connectionTimeoutMillis`. Both sides fail closed, so this is not a security defect. But a URL that passes config validation in staging/production then dies in `createRuntimeServices` with exit 1 and a stack, instead of exit 78 naming the key (r1 n6). Two hand-kept allow-lists for one value will drift again. | Single-source the set in `@platform/config`, e.g. `RUNTIME_DATABASE_URL_PARAMS = ['sslmode','sslrootcert','sslnegotiation']`. The guard uses it, and `client.ts` imports it (an allowed edge). Apply the param-name and no-repeat part in **every** APP_ENV, not only hardened ones, so local fails with exit 78 too; the verify-full requirement stays hardened-only. Drop `uselibpqcompat` from both lists: it is now a no-op that suggests otherwise (D-TASK006-02 item 3). Fix in this PR or at the merge-main pass. If deferred, route to TASK-014 together with n6. |
| R2-n1 | NIT | `apps/api/src/platform/errors/problem-handler.ts:52-61` | `fallbackProblemBody` hard-codes `DEFAULT_PROBLEM_TYPE_BASE` and ignores `options.typeBase`. In a deployment with a configured base, the PR9-SEC-07 fallback 500 is the only problem whose `type` points at the example domain. | Pass `options.typeBase ?? DEFAULT_PROBLEM_TYPE_BASE` into the fallback. Add a test row with a custom `typeBase`. |
| R2-n2 | NIT | `apps/api/src/platform/db/session-integrity.ts:141-152` | After start-up, readiness checks a pooled connection that changes from call to call. A non-empty session-level leak on one connection (ADR-0005 item 16) therefore flaps the database component, and with "one event per transition" it emits an event on every flap. This is acceptable as a stop-gap, because the process-level latch is TASK-016 (r1 n8, D-ORCH-014 (c)). | TASK-016: once the leak latch exists, a pooled `context` finding should latch rather than flap. No change here. |

### R2.3 Rulings on the reviewer focus items

1. **M1 closure: closed.**
   - `createSessionIntegrityGuard` uses `connectDedicated` until a dedicated check has passed, with `freshConnection: true`, so NULL is required. From then on it uses the pool and accepts NULL or `''`.
   - `passedAt` is cleared at the start of every evaluation and set only on a pass. Drift and errors are therefore never reused.
   - `findings` is left unchanged on an error, so per-transition de-duplication survives a transient failure.
   - `inflight` coalesces readiness and the monitor.
   - `probeDedicated` always `end()`s, including on a malformed row, and `dedicatedConnector` ends a client whose `connect` failed.
   - The dedicated `pg.Client` uses the same `toPoolConfig`, so the same TLS pinning applies. It is bounded by `connectionTimeoutMillis`, `statement_timeout` and `query_timeout`, so a dead database delays boot by at most about 5 s.
   - `services.startup()` cannot reject: `runStartupIntegrityCheck` catches and logs only the error class, and the test proves no `ECONNREFUSED`, host or value appears in the log.
   - api: `await startup()` before `app.listen`. Worker: before `server.listen`, with a comment pinning processors after it.
   - The unit test reproduces my r1 scenario (pooled `''` at 0 / 60 % / 99.9 % / 100 % / 250 %). The integration test proves the backend really reads `''` before asserting ready.
   - D-TASK006-06 is superseded by D-TASK006-02; accepted.
2. **PR9-SEC-05 monitor:** accepted. It is unref'd, swallows failures, is closed first among the resources, and has a fake-timer test plus a `hasRef()` check.
3. **m3 readiness single-flight + TTL: closed.** One in-flight promise. `last` is set only on completion, timed at completion. Draining bypasses both the cache and I/O. The 50-way concurrency, 999/1000 ms boundary and default-TTL tests are good. `health.int.test` uses `cacheTtlMs: 0` with a reason.
4. **m1 status read from the prototype: closed.**
   - `statusOf` reads data properties only (no getter runs) and walks at most 4 levels, with a guarded `getPrototypeOf` (hostile Proxy).
   - Mapping happens at the source, as asked, and only for errors the classifier would call `unexpected`.
   - Corrupt gzip, deflate and br are proven over a real listener.
5. **m4 headers: closed.** The four representation headers are removed, `Cache-Control: no-store` is set, and `expectProblem` now asserts this on every problem test. Express's own weak ETag of the problem body is harmless under `no-store`.
6. **PR9-SEC-07 (INFO-07) fallback: accepted** (R2-n1 NIT).
   - The handler body is wrapped. With headers already sent it calls `destroy()`; otherwise it sends a pre-built body.
   - The logger call is guarded separately.
   - `instanceOf` and `markErrorResponse` cannot throw on Express inputs, so the fallback cannot itself escape to finalhandler's HTML.
   - The BigInt test proves no HTML and no stack.
7. **Degraded audit stubs (PR9-SEC-11): accepted.**
   - `HealthReady` allows `degraded` for the audit pair with HTTP 200.
   - US-012 "Healthy stack" (EPIC-01 L456-459) only requires 200 and postgres/redis/object-storage up, so AT-US-012-01 still holds on a real stack.
   - The test helpers now use explicit passing stubs, which is the right separation.
   - Tripwire design: see R2-m1. The S3 tripwire scans `apps/api/src`, which matches the planned `apps/api/src/platform/storage/s3-object-storage.ts` (WAVE-00 L705). m2 (sheet lines and US-012 traceability) is still orchestrator-owned.
8. **TLS pinning design (PR9-SEC-04): accepted.**
   - Taking the query string away from pg and deriving an explicit `ssl` is the right control. The probe shows URL, `PGSSLMODE` and `uselibpqcompat` cannot weaken it.
   - Treating `allow`/`prefer`/`require`/`verify-ca` as verify-full is a deliberate fail-closed deviation from libpq. It is documented in `client.ts` and D-TASK006-02.
   - Hardened environments only ever reach `verify-full` (the config guard requires it). In local/test, compose uses `sslmode=disable` → `ssl:false`.
   - `sslrootcert` → `ca` replaces Node's default roots, which is correct for the RDS bundle. libpq's `sslrootcert=system` fails closed (file not found) and the path is not echoed.
   - Valkey: `rejectUnauthorized: true` in both branches, enforced by the type.
   - `tlsVerificationGuard`: refusing any value other than `1` in staging/production is stricter than Node (only `'0'` disables), which is fine. The value is never printed (proven at exit 78).
   - Residuals routed: `NODE_EXTRA_CA_CERTS` (item 3) → TASK-014.
9. **Pre-existing inconsistency (config allows `application_name`/`connect_timeout`, `toPoolConfig` refuses them):** see R2-m2. The runtime rule wins; single-source it in `@platform/config`.
10. **PR9-SEC-02 `prismaExecArgs`: accepted.**
    - One builder is used by both callers, and the flag sits before `--`. A hostile Prisma argument stays after `--`.
    - The real-npm proof covers env (both casings), a userconfig `.npmrc` and a project `.npmrc`, each with a **positive control** that must show the preload. That is exactly the evidence standard asked for.
    - The `script-shell` residual and the `process.execPath`-on-the-CLI-entry design are rightly routed (TASK-007 / tools-deps follow-up).
11. **Test quality:** strong overall.
    - Fake clocks rather than sleeps, positive controls, and value-free assertions.
    - Integration evidence asserts the precondition (`''` on the backend) before the claim.
    - Two weak spots: the vacuous tripwire half (R2-m1), and no performance or adversarial test for the new parser (R2-B1).

### R2.4 Closure of round-1 findings

| ID | Status at 05855b1 |
|---|---|
| **M1** | **Closed** (§R2.3 item 1) |
| m1 | **Closed** (corrupt gzip/deflate/br → 400 over real HTTP) |
| m2 | Routed (orchestrator: TASK-019/TASK-021 sheet lines, US-012 traceability). Interim tripwires added; fix R2-m1 |
| m3 | **Closed** |
| m4 | **Closed** |
| m5 | Routed → TASK-010 (unchanged) |
| n1 | **Closed** (`app.listen` callback checks `error`) |
| n2 | Comment reworded here; pre-close delay routed → TASK-214 |
| n3 | **Closed** (both comments); platform.md:341 → architect |
| n4 | Routed → TASK-016 (D-ORCH-014 (a)) |
| n5 | **Open** (not in this cycle). `O_NONBLOCK` + parent-component note → TASK-014 or the next config touch |
| n6 | **Open**; merges with R2-m2 |
| n7 | **Closed** (PR body verified: `X-Correlation-Id`, `AUTH_REQUIRED`, per-finding events) |
| n8 | Routed → TASK-016 (D-ORCH-014 (c)) |
| n9 | Routed → TASK-017 |
| n10 | Routed → first BullMQ task |
| PR7-SEC-06 item 3 + PR7-SEC-02 item 2 | **Closed** with M1 |
| PR9-SEC-01 | Intent met (UTF-8 only, 415 before reading). **Implementation reopened by R2-B1** |
| PR9-SEC-02 items 1–2, -04 items 1/2/4, -05, -07, -08, -11 | **Closed** (§R2.3) |

### R2.5 Security flags for security-analyst

- **R2-B1 (new, introduced by the PR9-SEC-01 fix):** unauthenticated ReDoS on every request path. CWE-1333, OWASP A05/A04. Exploitability is trivial (one short header) and the impact is a full process stall. Please re-verify the replacement regex and the length bound.
- R2-m2: single-source the runtime DB URL allow-list (fail closed both ways; operability).
- Suggest a repo-wide control for this class (lane A owner, TASK-007): a Semgrep or ESLint super-linear-backtracking rule, which needs a dependency justification if it is `eslint-plugin-regexp`. Optional; not a merge condition.

### R2.6 Merge conditions

1. R2-B1 fixed with the tests listed, then a round-3 review of that delta. R2-m1 and R2-n1 are small and should land in the same cycle. R2-m2 should land here or at the merge-main pass; otherwise it is routed with n6 to TASK-014.
2. Unchanged from r1 §6 items 2–4: merge-main after PR #10 with full gates (lint incl. Semgrep, format, typecheck, unit, api, integration incl. session integrity and health, build, porcelain, coverage) plus the pure-union proof. Hosted lane A green, or the D-ORCH-004 local-gate record. Squash-merge.
3. PR #11 reconciliation per D-ORCH-014 (a)–(f) when it merges second. Note that (c) must keep the start-up order established here: dedicated check first, then the latch and `withTenantTx` wiring.

### R2.7 Worth keeping

- The fix comment maps every finding to the exact proof, including the reviewer's own scenario replayed at the same interval fractions.
- Real-tool proofs with positive controls (npm `node-options`), and integration tests that assert the precondition before the claim.
- TLS is decided in one place from allow-listed selectors, and the driver never sees the selectors. That pattern should be reused for every future driver URL.
