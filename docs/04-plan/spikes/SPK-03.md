# SPK-03 — RLS with Prisma 7 interactive transactions and pooled connections

| Field | Value |
|---|---|
| Task | TASK-008 (Wave 0) · branch `feat/TASK-008-spk-03-spike-rls-prisma` |
| Risk | R-ARCH-03 (RLS + Prisma 7 interactive transactions: nested transactions, pooling, `set_config` overhead) |
| NFR / requirements | NFR-TENANT-001; REQ-RLS-003, REQ-RLS-004, REQ-RLS-013; ADR-0005 (incl. amendments 2, 6, 8, 9); data-model.md §4.1–§4.3 |
| Date / host | 2026-11-12 · Windows 11 Pro 10.0.26300, Node v24.22.3, Docker Desktop 29.8.0 (API 1.56), `postgres:18` = PostgreSQL 18.6 (`sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42`, the SPK-01 / harness pin) · `prisma` / `@prisma/client` / `@prisma/adapter-pg` 7.10.1, `pg` 8.23.1 |
| Owner | database-engineer |
| Evidence | `prisma/tests/spikes/spk03-rls-tx.int.test.ts` — 17 tests, 17 passed (run 4, 28.5 s) |
| **Verdict** | **GO** for ADR-0005's `withTenantTx` = Prisma 7 interactive transaction over `@prisma/adapter-pg` with a parameterised `set_config(…, true)` first statement. The raw-`pg` fallback wrapper (PLAN.md §9) is **not needed**. Exit items (a), (b) and (c) are green as written. Exit item (d) is green for the cost of `set_config` itself (server-side p95 0.087 ms; client-observed p95 0.48 ms above a bare `SELECT 1` round trip). The per-transaction end-to-end delta is one extra network round trip. On this Docker Desktop host that round trip is ≈ 1.4–1.7 ms p50, so the literal "transaction with vs without the statement" p95 delta was 1.5–3.6 ms across runs (§4). Condition C-1: re-measure on a native-Linux Docker host. |

Throwaway code: the spike creates **no versioned migration**. Its tables (`public.spk03_*`), helper functions
(`platform.spk03_app_*`) and policies are created inside the test as `platform_migrator`, on a clone of the
bootstrapped template database (`PlatformPostgres.template({ migrated: false })`). Runtime connections are
`platform_app` (`NOSUPERUSER NOBYPASSRLS`) built by the production factory `apps/api/src/platform/db/client.ts`
with the generated Prisma 7 client (`prisma/generated/prisma`, produced by `deps:rebuild`). The generated client
was usable as is. Spike tables have no Prisma models, so all statements are `$queryRaw`/`$executeRaw` tagged templates.

## 0. What was built

- **Schema (in-test, as migrator).** `spk03_shipments` (TENANT: `org_id NOT NULL`), `spk03_quotes` (GUEST_CAPABLE:
  `org_id NULL` + `guest_token_hash bytea`, `CHECK ((org_id IS NULL) <> (guest_token_hash IS NULL))`) and
  `spk03_operator_members`. Every table has `ENABLE` + `FORCE ROW LEVEL SECURITY`. The data-model §4.3 templates:
  tenant `FOR ALL` USING/WITH CHECK `org_id = app_org_id()`, operator `FOR SELECT` only (ADR-0005 am. 2), and guest
  `FOR ALL` on the quotes table. `platform_app` has `SELECT, INSERT, UPDATE` only (no `DELETE`) and explicit `EXECUTE`
  on the helpers. Default privileges revoke `EXECUTE` from `PUBLIC`, so the grants have to be explicit.
- **Helpers.** Verbatim copies of data-model §4.2: `app_org_id()`/`app_actor_id()` return NULL for a malformed value
  (regex guard), and `app_guest_token_hash()` accepts lowercase hex only. `app_is_operator()` is `SECURITY DEFINER`,
  `SET search_path = pg_catalog, pg_temp`, owned by `platform_definer`, and reads through a `TO platform_definer`
  definer-read policy.
- **Prototype `withTenantTx(prisma, ctx, fn, options?)`.** Pools: `client` `poolMax 2` and `single` `poolMax 1`, so
  connection reuse can be shown with `pg_backend_pid()`.

  ```ts
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${ctx.orgId}, true), set_config('app.actor_id', ${ctx.actorId}, true),
                                set_config('app.actor_scope', ${ctx.actorScope}, true),
                                set_config('app.guest_token_hash', ${ctx.guestTokenHash}, true)`;
    return fn(tx);
  }, options);
  ```

Command (Docker lock held; the test path goes **before** `--selectProjects`, see F-12):

```
node --experimental-vm-modules --disable-warning=ExperimentalWarning node_modules/jest/bin/jest.js \
  prisma/tests/spikes/spk03-rls-tx.int.test.ts --selectProjects integration --verbose
# Tests: 17 passed, 17 total · Time: 28.5 s (container start + template bootstrap included)
# SPK03_REPORT=<file> writes the measured values below as JSON.
```

Runs: run 1 (all six integration suites in parallel because of F-12; 2 spike defects: `$queryRaw` on a `void`
column, and (d) asserted end-to-end), run 2 (16/17 green; (d) end-to-end delta 1.9 ms), run 3 (16/17; the (d)
transaction-level delta against `SELECT 1` was asserted and reached 1.28 ms under host load), run 4 (17/17, final
assertions).

## 1. Exit (a) — context isolation across pooled connections: GREEN

| Test | Evidence (run 4) |
|---|---|
| `SPK-03 (a) interleaved org A and org B transactions on two pooled connections each see only their own rows` | A's transaction stays open while B's runs on the second connection (different `pg_backend_pid`). A sees `[A,A,A]` before and after B, and B sees `[B,B]`. |
| `SPK-03 (a) after COMMIT and after ROLLBACK the reused connection carries no context` | `poolMax 1`, so every step uses the same backend pid (442). After the commit, after a callback throw (rollback) and in an autocommit statement, `current_setting('app.org_id', true)` = `''` and 0 rows. |
| `SPK-03 (a) 50 parallel transactions over a pool of two never leak context` | 50 transactions (A/B/no context, round robin), each probing twice around a `pg_sleep(0.002)`. Every transaction saw exactly its own rows, with 2 distinct backend pids. Default `maxWait` 2000 ms was enough. |

## 2. Exit (b) — fail-closed: GREEN

| Test | Evidence |
|---|---|
| `SPK-03 (b) unset context returns 0 rows and every INSERT is rejected by WITH CHECK (42501)` | 0 rows on both tables inside `withTenantTx(NO_CONTEXT)` and through the root client with no wrapper. An INSERT for org A or B fails with `P2010`, `meta.driverAdapterError.cause.code = '42501'` ("new row violates row-level security policy for table "spk03_shipments""). |
| `SPK-03 (b) a malformed app.org_id yields 0 rows without raising (ADR-0005 am. 6)` | `not-a-uuid`, a uuid with a trailing space, a non-hex digit, `' OR true --` and `A,B` all return 0 rows with no error. Writes get 42501. |
| `SPK-03 (b) a foreign org_id is rejected by WITH CHECK and a foreign UPDATE touches 0 rows` | Under org B, `INSERT … org A` gives 42501, `UPDATE … WHERE org_id = A` updates 0 rows and `UPDATE SET org_id = A` (mass-assignment) gives 42501. Org A still has 3 rows. |
| `SPK-03 (b) a raw pg connection as platform_app outside any wrapper sees 0 rows` | `pg.Client` as `platform_app` (`rolbypassrls = false`) counts 0 rows on both tables (REQ-RLS-004). |

## 3. Exit (c) — guest claim under both policies: GREEN

| Test | Evidence |
|---|---|
| `SPK-03 (c) a guest creates a quote with org_id NULL; the claim UPDATE with both settings succeeds and ends guest access` | Guest context (hash only): INSERT with `org_id NULL` passes the guest WITH CHECK, and the row is visible only to that hash. Claim with `app.org_id = A` + the hash: `UPDATE … SET org_id = app_org_id(), claimed_by_user_id = app_actor_id(), guest_token_hash = NULL WHERE id = $1 AND org_id IS NULL` → **1 row**. The guest USING admits the old row and the tenant WITH CHECK admits the new one. Afterwards the guest sees 0 rows, and org A sees the row with `claimed_by = actor` and the hash cleared. A retried claim → 0 rows (the service's idempotent re-read path). |
| `SPK-03 (c) a wrong, missing or malformed guest token hash claims 0 rows` | A different hash, `''`, the **uppercase** hex of the right hash, and a 63-character prefix: each → 0 rows. With the right hash, a different org (B) claims → 1. |
| `SPK-03 (c) two concurrent claims by different organisations: exactly one wins, the other updates 0 rows` | A updates (1 row) and holds the transaction. B's UPDATE blocks on the row lock (a superuser observer saw `wait_event_type = 'Lock'` for `application_name = 'spk03'`). After A commits, B's re-check finds `org_id IS NOT NULL` and the row no longer passes the guest USING → **0 rows**. Final owner: A. |
| `SPK-03 (c) the operator branch reads across tenants but cannot write` | `actor_scope = OPERATOR` + an operator member reads all 5 shipments. `UPDATE` on either table → 0 rows, INSERT → 42501 (read-only branch, ADR-0005 am. 2). Not a member + OPERATOR scope → 0 rows. A member with TENANT scope and no org → 0 rows. |

## 4. Exit (d) — `set_config` overhead: GREEN for the statement cost; end-to-end condition C-1

`SPK-03 (d) set_config costs <= 1 ms p95 beyond one round trip (N=400 per variant, rotating order, after warm-up)`:
the test runs 50 warm-up rounds, then 400 rounds. Each round runs six variants sequentially, rotating the order
every round. The client is `poolMax 2`; the raw-`pg` variants use a separate `pg.Pool` of 1. The workload is
`SELECT count(*)` on the RLS table.

Run 4 (ms):

| Variant | p50 | p95 | p99 |
|---|---|---|---|
| Prisma tx, `set_config` first (= `withTenantTx`) | 5.678 | 9.723 | 16.889 |
| Prisma tx, `SELECT 1` first (control: same shape, trivial statement) | 5.173 | 9.004 | 13.499 |
| Prisma tx, no first statement | 3.720 | 7.190 | 15.201 |
| `set_config` statement alone (client-observed, inside the tx) | 1.732 | 2.923 | 7.662 |
| `SELECT 1` statement alone (client-observed, inside the tx) | 1.408 | 2.439 | 4.370 |
| **`set_config` server-side** (`EXPLAIN (ANALYZE)` planning + execution) | **0.046** | **0.087** | 0.119 |
| raw `pg` tx with `set_config` | 3.857 | 7.089 | 14.321 |
| raw `pg` tx without | 2.637 | 5.578 | 11.818 |

| Derived (run 4) | Value | Asserted |
|---|---|---|
| server-side `set_config` p95 | 0.087 ms | ≤ 1 ms ✔ |
| p95(`set_config` statement) − p95(`SELECT 1` statement) | 0.484 ms | ≤ 1 ms ✔ |
| p95 tx with `set_config` − p95 tx with `SELECT 1` | 0.719 ms (run 3, under host load: 1.282 ms) | recorded |
| p95 tx with − p95 tx without (one extra round trip + `set_config`) | 2.533 ms (p50 1.958 ms; run 2: 1.914 ms; run 3: 3.599 ms) | recorded |
| raw `pg` p95 delta | 1.511 ms (run 2: 1.336 ms) | recorded |

Interpretation:

- **The statement itself is cheap.** Execution is 0.05–0.09 ms, and client-observed it costs ~0.3–0.5 ms more than any
  other one-row round trip.
- **The real cost is one extra network round trip per transaction.** Neither Prisma's interactive-transaction API nor
  the `pg` extended protocol lets a parameterised statement share the `BEGIN` round trip. Through the Docker Desktop
  for Windows port proxy (WSL2) one round trip is ~1.4 ms p50 / ~2.4 ms p95. So the literal acceptance wording
  ("transaction with vs without the statement ≤ 1 ms p95") **cannot be met on this host by any statement**, and the
  p95 of a difference of two jittery distributions moved between 1.3 and 3.6 ms across runs. Run-to-run noise comes
  from other agents' containers sharing the host.
- In the target topology (ECS on EC2 → RDS in the same AZ, RTT typically 0.1–0.5 ms) the end-to-end delta is
  expected to be about RTT + 0.1 ms. That is an expectation, **not measured here**: see C-1.
- ADR-0005 "Consequences" says "`set_config` adds ~0.2 ms per transaction". The more accurate wording is "one extra
  round trip plus ~0.1 ms server-side" (wording note W-1, §7).
- Side observation: on this host a Prisma interactive transaction costs ~1.1 ms p50 more than the same three
  statements over raw `pg` (3.72 vs 2.64 ms). This is client-side query-compiler/adapter work, not RLS.

## 5. Findings for consumers

| ID | Finding | Consumer / action |
|---|---|---|
| F-01 | **Nested `$transaction` inside an interactive transaction is a savepoint on the same connection** in Prisma 7.10.1. The transaction client's deny-list is only `$connect, $disconnect, $on, $use, $extends` (`ITXClientDenyList`, `runtime/client.d.ts`). The runtime's transaction manager names savepoints `prisma_sp_<n>` through the adapter's `createSavepoint`/`rollbackToSavepoint`/`releaseSavepoint`. Test `SPK-03 (e1) …`: the inner transaction has the same pid and the same context; an inner throw rolls back only the inner INSERT, and the outer transaction continues and commits. The "nested-transaction caveat" ADR-0005 cites applies to the RLS-by-extension pattern, not to `withTenantTx`. | TASK-016: decide whether `TenantDb` exposes `$transaction` (savepoints) or hides it and offers an explicit `savepoint(fn)`. Recommended: hide `$transaction`, `$queryRawUnsafe`, `$executeRawUnsafe` from `TenantDb` (type `Omit<Prisma.TransactionClient, …>`) and add `savepoint` only when a use case appears. |
| F-02 | **Using the root client inside `withTenantTx` silently runs on another connection without context** (0 rows, no error). Test `SPK-03 (e2) …`. With `poolMax 1` the inner `$transaction` cannot get a connection and fails after `maxWait` with `P2028` "Unable to start a transaction in the given time" (533 ms at `maxWait 500`). Under load the same pattern starves any pool: N concurrent requests × 1 nested root call with `poolMax N` all stall until `maxWait`. | TASK-016: the root `PrismaClient` must stay private to `apps/api/src/platform/db` (ADR-0005 lint rule). Repositories take `TenantDb` only. Add a unit test or lint check that no repository imports the client module. |
| F-03 | **Interactive-transaction defaults: `maxWait 2000 ms`, `timeout 5000 ms`.** Source: `getPrismaClient` `transactionOptions` defaults. Confirmed in test `SPK-03 (e3) …`: an expired transaction fails the next query with `P2028`, `meta { timeout: 5000, timeTaken: 5305 }` ("A query cannot be executed on an expired transaction"); Prisma rolls it back and the connection comes back clean (no context, 0 rows). A third transaction waiting for a busy `poolMax 1` client fails with `P2028` after 2003 ms. `maxWait` covers the pool checkout through the adapter. | TASK-016: set `transactionOptions` explicitly in the factory, e.g. `maxWait` ≈ pool checkout budget (≤ `connectionTimeoutMs` 5000) and `timeout` ≥ the per-request `statement_timeout` that data-model §4.1 sets in the same `set_config` statement. Map `P2028` to a retryable 503 (pool exhaustion), never 500. Note that the role settings `lock_timeout 2s` and `idle_in_transaction_session_timeout 15s` also apply. |
| F-04 | **`SET LOCAL` cannot be parameterised**: ``tx.$executeRaw`SET LOCAL app.org_id = ${x}` `` fails with `42601` "syntax error at or near "$1"". Only `$executeRawUnsafe` with string interpolation works (an injection surface). `set_config(name, $1, true)` is the transaction-local equivalent and is parameterised. Test `SPK-03 (e4) …`. | TASK-016: keep `set_config` (as ADR-0005 already says). Lint/grep rule: no `SET LOCAL` and no `$executeRawUnsafe` in `platform/db`. |
| F-05 | **A query extension needs no RLS logic and does not break the context.** `client.$extends({ query: { $allOperations } })` sees raw operations too (3 calls in the test, all inside the transaction), and `extended.$transaction` + `setContext` keeps the context. Test `SPK-03 (e5) …`. | TASK-016: the soft-delete/stamping extension can wrap the client; `withTenantTx` runs on the extended client. |
| F-06 | **Error shape for RLS violations.** `PrismaClientKnownRequestError` `code 'P2010'`, `meta.driverAdapterError.cause = { kind: 'postgres', code: '42501', originalCode: '42501', message: 'new row violates row-level security policy for table "<t>"' }`. The message names the table. | TASK-016 / error mapper: read `meta.driverAdapterError.cause.code`. Map 42501 to 404/403 per ADR-0005 (never echo the message). Map `55P03` (lock timeout) to a retryable 409/503. |
| F-07 | **After the first transaction on a connection, `current_setting('app.org_id', true)` is `''`, not NULL** (the placeholder GUC survives with an empty reset value). The helpers treat `''` as NULL. | Any new helper or check must treat `''` and NULL alike (catalog tests should cover it). |
| F-08 | **The guest hash must be lowercase hex.** `app_guest_token_hash()` matches `^[0-9a-f]{64}$`, so an uppercase hash fails closed (0 rows). Node `digest('hex')` is lowercase. | Quotes module: normalise before `set_config`; never pass client-supplied hex directly. |
| F-09 | **Claim race.** The loser of two concurrent claims waits on the row lock and then updates 0 rows (EvalPlanQual re-check plus the RLS re-check). **Inference, not tested:** if the winner holds the lock longer than `platform_app`'s `lock_timeout` (2 s), the loser gets `55P03` instead of 0 rows. | Quotes claim service: treat `55P03` like 0 rows (re-read → 200/409) and keep the claim transaction short. |
| F-10 | **Definer-function ordering in migrations.** `platform_migrator` holds `platform_definer` `WITH INHERIT FALSE, SET TRUE`. The spike therefore issues `GRANT EXECUTE … TO platform_app` **before** `ALTER FUNCTION … OWNER TO platform_definer`: after the owner change, the migrator no longer has owner rights on the function (PostgreSQL 16+ uses inherited privileges for ownership checks). The reverse order was not exercised. | TASK-016 / TASK-051 definer migrations: grant first, then change the owner (or grant as `SET ROLE platform_definer`). |
| F-11 | `$queryRaw` cannot deserialize a `void` column (`SELECT pg_sleep(…)` → "Failed to deserialize column of type 'void'"). | Use `$executeRaw` for void-returning functions, or cast. |
| F-12 | **Harness/command: Jest's `--selectProjects` is variadic.** `jest.js --selectProjects integration <path>` treats the path as a second project name and runs **every** integration suite (run 1 ran six suites in parallel; `runtime-role.int.test.ts` then failed under that load, not investigated). Put the path first: `jest.js <path> --selectProjects integration`. | TASK-276 harness docs and the orchestrator's dispatch template. |
| F-13 | **Harness pattern used** (re-usable by TASK-276): clone of the bootstrapped template, then in-test DDL as the migrator over `pg`. Runtime clients come from `createDatabaseClient(PrismaClient, { poolMax })` with the generated client imported under `PRISMA_TREE_LOCK`. A superuser observer (`db.superuser(database)`) watches `pg_stat_activity` for lock waits, and seed rows go in before `FORCE` RLS, because the owner has no policy afterwards. | TASK-276 (RLS test helpers: `withTenantTx` fixture, a lock-wait observer, a "raw platform_app sees 0 rows" helper). |

## 6. Open questions

1. **C-1 (condition of the GO):** re-run exit (d) on ubuntu-latest with native Docker, which has a sub-0.2 ms loopback
   RTT, to measure the end-to-end per-transaction delta against the 1 ms budget. Owner: performance-engineer or
   TASK-016 (one run of this file in lane C/D). Delete this spike file only after that run, or port the measurement
   into TASK-016's suite.
2. Out of scope for this spike and **still open** from `prisma/README.md` ("Findings for SPK-03/SPK-08"): whether
   `migrate dev` keeps raw-SQL partial indexes, `migrations.initShadowDb` with the rendered bootstrap SQL, and
   `migrate dev` against a migrator-owned shadow database. The task sheet's acceptance does not list them. The
   orchestrator should assign them (TASK-016 or SPK-08 follow-up).
3. Transaction-mode poolers (PgBouncer / RDS Proxy) were not exercised. `set_config(…, true)` is transaction-scoped, so
   it is compatible by design. RDS Proxy pinning behaviour is an M5 question.
4. TASK-016 must choose whether `TenantDb` exposes savepoints (F-01).

## 7. ADR notes for principal-architect (no amendment required for GO)

- **W-1 (wording, ADR-0005 Consequences):** replace "`set_config` adds ~0.2 ms per transaction" with "the context
  statement costs one extra database round trip per transaction plus ~0.1 ms server-side (SPK-03 §4)".
- **W-2 (clarification, ADR-0005 "Transaction-scoped context"):** the nested-transaction caveat applies to RLS by
  query extension, not to `withTenantTx`. In Prisma 7.10.1 a nested `tx.$transaction` is a savepoint on the same
  connection (F-01). The real hazard is calling the **root** client inside the callback (F-02), which the existing
  lint rule addresses.
