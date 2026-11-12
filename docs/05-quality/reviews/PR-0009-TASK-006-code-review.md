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
