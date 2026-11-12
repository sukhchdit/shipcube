# SPK-03 — RLS with Prisma 7 interactive transactions and pooled connections

| Field | Value |
|---|---|
| Task | TASK-008 (Wave 0) · branch `feat/TASK-008-spk-03-spike-rls-prisma` |
| Risk | R-ARCH-03 (RLS + Prisma 7 interactive transactions: nested transactions, pooling, `set_config` overhead) |
| NFR / requirements | NFR-TENANT-001; REQ-RLS-003, REQ-RLS-004, REQ-RLS-013; ADR-0005 (incl. amendments 2, 6, 8, 9); data-model.md §4.1–§4.3 |
| Date / host | 2026-11-12 · Windows 11 Pro 10.0.26300, Node v24.22.3, Docker Desktop 29.8.0 (API 1.56), `postgres:18` = PostgreSQL 18.6 (`sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42`, the SPK-01 / harness pin) · `prisma` / `@prisma/client` / `@prisma/adapter-pg` 7.10.1, `pg` 8.23.1 |
| Owner | database-engineer |
| Evidence | `prisma/tests/spikes/spk03-rls-tx.int.test.ts` — 20 tests. Default run (run 7): 19 passed, 1 skipped (the opt-in (d) benchmark), 20.1 s. With `SPK03_BENCH=1` (run 6): 20 passed, 25.5 s |
| **Verdict** | **GO** for ADR-0005's `withTenantTx` = Prisma 7 interactive transaction over `@prisma/adapter-pg` with a parameterised `set_config(…, true)` first statement. The raw-`pg` fallback wrapper (PLAN.md §9) is **not needed**. Exit items (a), (b) and (c) are green as written. Exit item (d) is green for the cost of `set_config` itself (server-side p95 0.087 ms in run 4 and 0.069 ms in run 6; client-observed p95 0.48 / 0.39 ms above a bare `SELECT 1` round trip, recorded). The per-transaction end-to-end delta is one extra network round trip. On this Docker Desktop host that round trip is ≈ 1.1–1.7 ms p50, so the literal "transaction with vs without the statement" p95 delta was 1.9–3.6 ms across runs 2–4 (2.3 ms in run 6) (§4). Condition C-1 (TASK-016, before G3): re-measure on a native-Linux Docker host with `SPK03_BENCH=1`. |

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
- **Helpers.** `app_org_id()`/`app_actor_id()`/`app_guest_token_hash()` are verbatim copies of data-model §4.2:
  the first two return NULL for a malformed value (regex guard), and `app_guest_token_hash()` accepts lowercase hex
  only. `app_is_operator()` is **simplified**: it is `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`,
  owned by `platform_definer` and reads through a `TO platform_definer` definer-read policy, but it checks one
  membership table with no `ACTIVE` status and no OPERATOR-organisation join. Amendment 2's status semantics were
  not exercised.
- **Prototype `withTenantTx(prisma, ctx, fn, options?)`.** Pools: `client` `poolMax 2` and `single` `poolMax 1`, so
  connection reuse can be shown with `pg_backend_pid()`. The context statement sets all six data-model §4.1 settings
  (fix cycle 1, code review m2): the four ADR-0005 keys plus `app.correlation_id` and a transaction-local
  `statement_timeout` (default `'5000'` ms). Every value is bound as a string; `is_local` stays the literal `true`.

  ```ts
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true), set_config('app.actor_id', ${actorId}, true),
                                set_config('app.actor_scope', ${actorScope}, true),
                                set_config('app.guest_token_hash', ${guestTokenHash}, true),
                                set_config('app.correlation_id', ${correlationId}, true),
                                set_config('statement_timeout', ${String(statementTimeoutMs)}, true)`;
    return fn(tx);
  }, options);
  ```

Commands (Docker lock held; the test path goes **before** `--selectProjects`, see F-12):

```
# default run: (a), (b), (c), (e); the (d) benchmark is skipped
node --experimental-vm-modules --disable-warning=ExperimentalWarning node_modules/jest/bin/jest.js \
  prisma/tests/spikes/spk03-rls-tx.int.test.ts --selectProjects integration -i
# Tests: 1 skipped, 19 passed, 20 total · Time: 20.1 s (run 7; container start + template bootstrap included)

# exit (d) benchmark (C-1 re-run): opt-in
SPK03_BENCH=1 node --experimental-vm-modules --disable-warning=ExperimentalWarning node_modules/jest/bin/jest.js \
  prisma/tests/spikes/spk03-rls-tx.int.test.ts --selectProjects integration -i
# Tests: 20 passed, 20 total · Time: 25.5 s (run 6)
# SPK03_REPORT=<file> writes the measured values and the observed error shapes as JSON.
```

Runs: run 1 (all six integration suites in parallel because of F-12; 2 spike defects: `$queryRaw` on a `void`
column, and (d) asserted end-to-end), run 2 (16/17 green; (d) end-to-end delta 1.9 ms), run 3 (16/17; the (d)
transaction-level delta against `SELECT 1` was asserted and reached 1.28 ms under host load), run 4 (17/17).
Fix cycle 1 (code review M1, m1–m6, n1–n8; security review PR7-SEC-01/-02/-03/-05/-07): run 5 (default, 19 passed,
1 skipped, 22.8 s), run 6 (`SPK03_BENCH=1`, 20/20, six-setting statement), run 7 (default, final code, 19 passed,
1 skipped).

## 1. Exit (a) — context isolation across pooled connections: GREEN

| Test | Evidence |
|---|---|
| `SPK-03 (a) interleaved org A and org B transactions on two pooled connections each see only their own rows` | A's transaction stays open while B's runs on the second connection (different `pg_backend_pid`). A sees `[A,A,A]` before and after B, and B sees `[B,B]`. |
| `SPK-03 (a) after COMMIT and after ROLLBACK the reused connection carries no context` | `poolMax 1`, so every step uses the same backend pid. After the commit, after a callback throw (rollback) and in an autocommit statement, `current_setting('app.org_id', true)` = `''` and 0 rows. `afterCommit.org === ''` is asserted exactly (pins F-07). |
| `SPK-03 (a) the transaction-local statement_timeout and app.correlation_id are honoured inside the transaction and revert on the pooled connection` | Same backend pid throughout. Baseline `statement_timeout` = `0` (`platform_app` has no role-level value). Inside `withTenantTx(…, { statementTimeoutMs: 250, correlationId: 'spk03-m2' })`: `250ms` and `spk03-m2`. After COMMIT: `0` and `''`. With `statementTimeoutMs: 200`, `pg_sleep(1)` is cancelled with `P2010` / `originalCode 57014`; after that ROLLBACK the settings are `0` and `''` again, and a context-free `pg_sleep(0.3)` on the same backend completes. |
| `SPK-03 (a) negative control: a session-level set_config(..., false) leaks into the next transaction on the same backend; the transaction-local form does not` | `poolMax 1`. After `withTenantTx(org A)` the next plain transaction reads `''` and 0 rows. After `set_config('app.org_id', A, false)` in one transaction, **the next plain transaction and an autocommit statement both read org A and see A's 3 rows** with no `withTenantTx` at all (the REQ-RLS-003 leak; adapter-pg releases connections without a reset). `withTenantTx(org B)` overrides it for its own transaction (`[B,B]`), but afterwards the backend reads org A again: `SET LOCAL` semantics revert to the session value, not to `''`. The test then runs `RESET app.org_id` and asserts `''` / 0 rows. See F-04. |
| `SPK-03 (a) 50 parallel transactions over a pool of two never leak context` | 50 transactions (A/B/no context, round robin), each probing twice around a `pg_sleep(0.002)`. Every transaction saw exactly its own rows, with 2 distinct backend pids. `maxWait 20000` / `timeout 20000` are explicit: the test checks isolation, not queueing time. |

## 2. Exit (b) — fail-closed: GREEN

| Test | Evidence |
|---|---|
| `SPK-03 (b) unset context returns 0 rows and every INSERT is rejected by WITH CHECK (42501)` | 0 rows on both tables inside `withTenantTx(NO_CONTEXT)` and through the root client with no wrapper. An INSERT into `spk03_shipments` for org A or B, and a guest-shaped INSERT into `spk03_quotes` (`org_id NULL` + a hash), each fail with the pinned shape `{ code: 'P2010', meta: { driverAdapterError: { cause: { kind: 'postgres', code: '42501', originalCode: '42501' } } } }` ("new row violates row-level security policy for table "spk03_shipments""). |
| `SPK-03 (b) a malformed app.org_id yields 0 rows without raising (ADR-0005 am. 6)` | `not-a-uuid`, a uuid with a trailing space, a non-hex digit, `' OR true --` and `A,B` all return 0 rows with no error. Writes get 42501. |
| `SPK-03 (b) a foreign org_id is rejected by WITH CHECK and a foreign UPDATE touches 0 rows` | Under org B, `INSERT … org A` gives 42501, `UPDATE … WHERE org_id = A` updates 0 rows and `UPDATE SET org_id = A` (mass-assignment) gives 42501. Org A still has 3 rows. |
| `SPK-03 (b) a raw pg connection as platform_app outside any wrapper sees 0 rows` | `pg.Client` as `platform_app` (`rolbypassrls = false`) counts 0 rows on both tables (REQ-RLS-004). |

## 3. Exit (c) — guest claim under both policies: GREEN

| Test | Evidence |
|---|---|
| `SPK-03 (c) a guest creates a quote with org_id NULL; the claim UPDATE with both settings succeeds and ends guest access` | Guest context (hash only): INSERT with `org_id NULL` passes the guest WITH CHECK, and the row is visible only to that hash. Claim with `app.org_id = A` + the hash: `UPDATE … SET org_id = app_org_id(), claimed_by_user_id = app_actor_id(), guest_token_hash = NULL WHERE id = $1 AND org_id IS NULL` → **1 row**. The guest USING admits the old row and the tenant WITH CHECK admits the new one. Afterwards the guest sees 0 rows, and org A sees the row with `claimed_by = actor` and the hash cleared. A retried claim → 0 rows (the service's idempotent re-read path). |
| `SPK-03 (c) a wrong, missing or malformed guest token hash claims 0 rows` | A different hash, `''`, the **uppercase** hex of the right hash, and a 63-character prefix: each → 0 rows. With the right hash, a different org (B) claims → 1. |
| `SPK-03 (c) two concurrent claims by different organisations: exactly one wins, the other updates 0 rows` | A updates (1 row) and holds the transaction. B's UPDATE blocks on the row lock (a superuser observer saw `wait_event_type = 'Lock'` for `application_name = 'spk03'`, polled against a 1.5 s deadline that stays below `lock_timeout` 2 s). After A commits, B's re-check finds `org_id IS NOT NULL` and the row no longer passes the guest USING → **0 rows**. Final owner: A. |
| `SPK-03 (c) a claim loser that waits longer than lock_timeout (2 s) fails with 55P03 instead of updating 0 rows` | Same race, but A holds the row lock until B has settled. B fails after ~2.1 s with `{ code: 'P2010', meta: { driverAdapterError: { cause: { kind: 'postgres', code: '55P03', originalCode: '55P03' } } } }` ("canceling statement due to lock timeout"). A's claim commits. Proves F-09. |
| `SPK-03 (c) the operator branch reads across tenants but cannot write` | `actor_scope = OPERATOR` + an operator member reads all 5 shipments. `UPDATE` on either table → 0 rows, INSERT → 42501 (read-only branch, ADR-0005 am. 2). Not a member + OPERATOR scope → 0 rows. A member with TENANT scope and no org → 0 rows. |

## 4. Exit (d) — `set_config` overhead: GREEN for the statement cost; end-to-end condition C-1

`SPK-03 (d) set_config server-side cost <= 1 ms p95; client-observed deltas recorded (N=400 per variant, rotating order, after warm-up)`
is **opt-in** (`SPK03_BENCH=1`; code review M1). Exit (d) is a one-time measurement and this section is its record;
it is not a regression guard, and a wall-clock assertion must not gate the shared integration suite. The test runs
50 warm-up rounds, then 400 rounds. Each round runs six variants sequentially, rotating the order every round. The
client is `poolMax 2`; the raw-`pg` variants use a separate `pg.Pool` of 1. The workload is `SELECT count(*)` on the
RLS table. Runs 2–4 measured the four-setting ADR-0005 statement; run 6 measured the six-setting data-model §4.1
statement (m2). The two extra settings make no material difference.

| Variant (ms) | run 4 p50 | p95 | p99 | run 6 p50 | p95 | p99 |
|---|---|---|---|---|---|---|
| Prisma tx, `set_config` first (= `withTenantTx`) | 5.678 | 9.723 | 16.889 | 4.358 | 6.166 | 8.571 |
| Prisma tx, `SELECT 1` first (control: same shape, trivial statement) | 5.173 | 9.004 | 13.499 | 3.927 | 5.478 | 6.631 |
| Prisma tx, no first statement | 3.720 | 7.190 | 15.201 | 2.794 | 3.915 | 5.121 |
| `set_config` statement alone (client-observed, inside the tx) | 1.732 | 2.923 | 7.662 | 1.379 | 1.918 | 3.076 |
| `SELECT 1` statement alone (client-observed, inside the tx) | 1.408 | 2.439 | 4.370 | 1.103 | 1.532 | 1.981 |
| **`set_config` server-side** (`EXPLAIN (ANALYZE)` planning + execution) | **0.046** | **0.087** | 0.119 | **0.034** | **0.069** | 0.101 |
| raw `pg` tx with `set_config` | 3.857 | 7.089 | 14.321 | 2.956 | 4.118 | 4.555 |
| raw `pg` tx without | 2.637 | 5.578 | 11.818 | 1.972 | 2.734 | 3.302 |

| Derived | run 4 | run 6 | Asserted |
|---|---|---|---|
| server-side `set_config` p95 | 0.087 ms | 0.069 ms | ≤ 1 ms ✔ |
| p95(`set_config` statement) − p95(`SELECT 1` statement) | 0.484 ms | 0.386 ms | recorded (asserted in run 4; dropped in fix cycle 1, M1) |
| p95(tx with `set_config`) − p95(tx with `SELECT 1`) | 0.719 ms (run 3, under host load: 1.282 ms) | 0.688 ms | recorded |
| p95(tx with) − p95(tx without) (one extra round trip + `set_config`) | 2.533 ms (p50 1.958 ms; run 2: 1.914 ms; run 3: 3.599 ms) | 2.251 ms (p50 1.564 ms) | recorded |
| raw `pg` p95(with) − p95(without) | 1.511 ms (run 2: 1.336 ms) | 1.384 ms | recorded |

Every "delta" above is a difference of two p95s (or p50s), not a percentile of per-pair differences.

Interpretation:

- **The statement itself is cheap.** Execution is 0.03–0.09 ms, and client-observed it costs ~0.3–0.5 ms more than
  any other one-row round trip.
- **The real cost is one extra network round trip per transaction.** Neither Prisma's interactive-transaction API nor
  the `pg` extended protocol lets a parameterised statement share the `BEGIN` round trip. Through the Docker Desktop
  for Windows port proxy (WSL2) one round trip is ~1.1–1.4 ms p50 / ~1.5–2.4 ms p95. So the literal acceptance
  wording ("transaction with vs without the statement ≤ 1 ms p95") **cannot be met on this host by any statement**:
  the difference of the two p95s, p95(tx with) − p95(tx without), moved between 1.9 and 3.6 ms across runs 2–4.
  Run-to-run noise comes from other agents' containers sharing the host.
- **The literal criterion cannot distinguish GO from FALLBACK.** The raw-`pg` fallback wrapper pays the same extra
  round trip (p95 delta 1.511 ms in run 4, 1.384 ms in run 6), so choosing it would not change the number.
- In the target topology (ECS on EC2 → RDS in the same AZ, RTT typically 0.1–0.5 ms) the end-to-end delta is
  expected to be about RTT + 0.1 ms. That is an expectation, **not measured here**: see C-1.
- ADR-0005 "Consequences" says "`set_config` adds ~0.2 ms per transaction". The more accurate wording is "one extra
  round trip plus ~0.1 ms server-side" (wording note W-1, §7).
- Side observation: on this host a Prisma interactive transaction costs ~0.8–1.1 ms p50 more than the same three
  statements over raw `pg` (run 4: 3.72 vs 2.64 ms). This is client-side query-compiler/adapter work, not RLS.

## 5. Findings for consumers

| ID | Finding | Consumer / action |
|---|---|---|
| F-01 | **Nested `$transaction` inside an interactive transaction is a savepoint on the same connection** in Prisma 7.10.1. The transaction client's deny-list is only `$connect, $disconnect, $on, $use, $extends` (`ITXClientDenyList`, `runtime/client.d.ts`). The runtime's transaction manager names savepoints `prisma_sp_<n>` through the adapter's `createSavepoint`/`rollbackToSavepoint`/`releaseSavepoint`. Test `SPK-03 (e1) …`: the inner transaction has the same pid and the same context; an inner throw rolls back only the inner INSERT, and the outer transaction continues and commits. The "nested-transaction caveat" ADR-0005 cites applies to the RLS-by-extension pattern, not to `withTenantTx`. | TASK-016 (**binding**, PR7-SEC-05): `TenantDb = Omit<Prisma.TransactionClient, '$transaction' \| '$queryRawUnsafe' \| '$executeRawUnsafe'>`, and `asTenantDb(tx)` is a run-time `Proxy` that throws `FORBIDDEN_DB_METHOD` for those names (`Omit` alone is bypassed by a cast). <br>• Why (PR7-SEC-05): with savepoints a caught 42501 rolls back only to the savepoint and the outer transaction commits partial work; without them the 42501 aborts the whole unit (25P02). `tx.$executeRaw` can still call `set_config('app.org_id', B, true)` and switch tenant mid-transaction, so `set_config`/`current_setting('app.`/`SET`/`RESET`/`DISCARD`/`Prisma.raw(`/`*Unsafe` are allowed only in `platform/db/with-tenant-tx.ts` (lint + Semgrep, see F-04). A `savepoint(fn)` is added only with a use case and its own review. |
| F-02 | **Using the root client inside `withTenantTx` silently runs on another connection, in another transaction, without context.** Test `SPK-03 (e2) …`. With `poolMax 1` the inner `$transaction` cannot get a connection and fails after `maxWait` with `{ code: 'P2028' }` "Unable to start a transaction in the given time" (≈ 515 ms at `maxWait 500`). Under load the same pattern starves any pool: N concurrent requests × 1 nested call with `poolMax N` all stall until `maxWait`. <br>• Fail modes (PR7-SEC-01): reads of RLS tables (TENANT / GUEST_CAPABLE / USER_OWNED) **return 0 rows** (proven) — confidentiality is closed, but absence-based decisions fail **open** (an "already captured" / "label already issued" / uniqueness pre-check or an MFA attempt counter reads 0). Writes to RLS tables get **42501** (proven for no context) — closed. Reads **and writes** of SYSTEM tables without RLS (`outbox_events`, `idempotency_keys`, `processed_events`, `audit_*`) **succeed** outside the RLS context and outside the business transaction's atomicity (follows from ADR-0005's table classes; not exercised here) — integrity open: an audit entry or outbox event commits for a rolled-back booking, or is lost. <br>• A nested `withTenantTx` (service A calls service B, which opens its own) has the same context but a new connection: it does not see the outer transaction's uncommitted rows, commits independently, and waits on the outer transaction's row locks until `lock_timeout` fails it with 55P03 (the F-09 mechanism, proven in `SPK-03 (c) a claim loser …`). | TASK-016 (**binding**): <br>• `platform/db` exports no `PrismaClient` instance; the public surface is `withTenantTx(ctx, fn)` plus narrowly named system variants. Repositories and SYSTEM-table writers (audit store, outbox, idempotency, processed-events) accept `TenantDb` only (type-enforced). <br>• **Runtime guard**: `withTenantTx` runs `fn` inside an `AsyncLocalStorage` scope and throws `NESTED_TENANT_TX` before checkout if a scope is already active (AT-US-075-04: pool `totalCount` unchanged). Any client instance other code can reach is wrapped with a `$extends` query hook that throws `ROOT_CLIENT_IN_TENANT_TX` while the scope is active; `withTenantTx` itself uses a separate unguarded module-private client, because a transaction client inherits its parent's query extensions (F-05/e5). This turns the silent fail-open into a loud test failure. <br>• Plus the ESLint boundaries / `no-restricted-imports` rule that TASK-016 must **add** (ADR-0005) banning the generated client and `platform/db/client.ts` outside the composition root and `platform/db`. No such rule exists today (`eslint.config.mjs` lets every `repository`/`db-platform` file import the client). |
| F-03 | **Interactive-transaction defaults: `maxWait 2000 ms`, `timeout 5000 ms`.** Source: `getPrismaClient` `transactionOptions` defaults. Confirmed in test `SPK-03 (e3) …` with pinned shapes: an expired transaction fails the next query with `{ code: 'P2028', meta: { operation: 'query', timeout: 5000, timeTaken: ~5300 } }` ("A query cannot be executed on an expired transaction"); Prisma rolls it back and the connection comes back clean (no context, 0 rows). A transaction waiting for a busy `poolMax 1` client fails with `{ code: 'P2028', meta: {} }` after ≈ 2004 ms. `maxWait` covers the pool checkout through the adapter. The transaction-local `statement_timeout` from the context statement is honoured (57014) and reverts on the pooled connection (`SPK-03 (a) the transaction-local statement_timeout …`). <br>• When `maxWait` expires, the `pg.Pool` checkout **stays queued**: Prisma later receives the connection, sends `ROLLBACK` and releases it (`client.js` transaction manager). P2028s therefore do not shed queue load under pool exhaustion. | TASK-016: set `transactionOptions` explicitly in the factory: `maxWait ≤ connectionTimeoutMs` (5000) and `timeout` ≥ the per-request `statement_timeout` (data-model §4.1) and < `idle_in_transaction_session_timeout` 15 s. Map `P2028` to a retryable 503 (`DB_BUSY`), never 500, with a `Retry-After` sized for the queued checkouts above. Note that the role setting `lock_timeout 2s` also applies. |
| F-04 | **The leak hazard is session-level state on a pooled connection, not `SET LOCAL`.** `@prisma/adapter-pg` returns connections to the pool without any reset (`index.mjs:676-684`), so a session-level `SET app.*`, `set_config(…, false)` (or `is_local` NULL, F-07) or `RESET` rides into the next request's checkout. Negative control `SPK-03 (a) negative control: …`: after a committed `set_config('app.org_id', A, false)`, the next plain transaction and an autocommit statement on the same backend read org A and see A's rows; `withTenantTx(B)` overrides it only for its own transaction, after which the session value (A) is back. The transaction-local form leaves `''`. <br>• Separately, `SET LOCAL` cannot be parameterised: ``tx.$executeRaw`SET LOCAL app.org_id = ${x}` `` fails with `{ code: 'P2010', … originalCode: '42601' }` "syntax error at or near "$1"" (test `SPK-03 (e4) …`). Only `$executeRawUnsafe` with string interpolation works (an injection surface). `set_config(name, $1, true)` is the parameterised transaction-local equivalent. | TASK-016: keep `set_config(…, true)` with `is_local` as a literal in the template text (as ADR-0005 says). Lint rule plus a Semgrep backstop: ban session-level `SET` / `SET SESSION`, `set_config(…, false)` or a non-literal `is_local`, `RESET`, `DISCARD`, `SET LOCAL` and `$queryRawUnsafe`/`$executeRawUnsafe` everywhere except `platform/db/with-tenant-tx.ts` (tests: exact-file exemption only). Keep this negative control in the ported suite to document why the ban exists. |
| F-05 | **A query extension needs no RLS logic and does not break the context.** `client.$extends({ query: { $allOperations } })` sees raw operations too (3 calls in the test, all inside the transaction), and `extended.$transaction` + `setContext` keeps the context. Test `SPK-03 (e5) …`. | TASK-016: the soft-delete/stamping extension can wrap the client; `withTenantTx` runs on the extended client. The extension never uses the base client (data-model §7.6). |
| F-06 | **Error shape for raw-query DB errors (pinned with `toMatchObject` in (b), (c), (e4)).** `PrismaClientKnownRequestError` `{ code: 'P2010', meta: { driverAdapterError: { name: 'DriverAdapterError', cause: { kind: 'postgres', code: '42501', originalCode: '42501', originalMessage, message, severity } } } }`. The message names the table. <br>• (PR7-SEC-03) This is the raw path only (spike tables have no models). **Model operations** surface DB errors as `P2039` ("Database error. Code: … Message: …"). The adapter always sets `originalCode`/`originalMessage`, but **mapped kinds omit `code`** (`40001`/`40P01` → `TransactionWriteConflict`, `23505` → P2002, `22P02`, …), so a mapper keyed on `cause.code` misses them. Prisma uses `errorFormat: 'minimal'` only when `NODE_ENV === 'production'`; otherwise messages carry call-site frames and rendered arguments (this project keys environments on `APP_ENV`). 42501 is overloaded (RLS WITH CHECK, missing privilege, audit-immutability triggers). | TASK-016: one `mapDbError(e)` in `platform/db`, keyed on `meta.driverAdapterError.cause.originalCode` for P2010/P2039/P2002…: 42501 → 404/403 per ADR-0005 / A-042; `55P03`, `57014`, `40001`, `40P01` → retryable 409/503 (claim: re-read, F-09); `P2028` → 503; anything else → 500 with no message. `createDatabaseClient` passes `errorFormat: 'minimal'` explicitly. **Never echo** `message`, `originalMessage`, `detail`, `hint` or `meta` to clients (TASK-006) or logs (TASK-010 serializer: `{ name, code, originalCode, kind }` only). Pick the security-event name from the internal message prefix, never echoed. |
| F-07 | **After the first transaction on a connection, `current_setting('app.org_id', true)` is `''`, not NULL** (the placeholder GUC survives with an empty reset value); a fresh connection reads NULL. Pinned: `afterCommit.org === ''` in `SPK-03 (a) after COMMIT …`. The helpers treat `''` as NULL. <br>• (PR7-SEC-02) `set_config` is not strict: a NULL **value** performs a RESET to the session default, and a NULL **`is_local`** means session scope (`false`), which survives COMMIT on the pooled backend (F-04). The session default of `app.*` is empty only if nothing set it at session start: `PGOPTIONS` (read by `pg` when `options` is unset), startup options or a privileged `ALTER ROLE/DATABASE … SET app.*` change it, and then out-of-wrapper queries (F-02) and NULL binds run with that context instead of failing closed. <br>• (PR7-SEC-07) `''`/NULL safety holds only because every predicate is an equality against a NULL-returning helper. `IS [NOT] DISTINCT FROM`, `coalesce`, `<>`/`NOT`, or a raw `current_setting('app.org_id' …)` comparison would fail open (e.g. `org_id IS NOT DISTINCT FROM app_org_id()` exposes every guest row to context-less sessions). | TASK-016: any new helper or check treats `''` and NULL alike. `setContext` keeps `is_local` literal `true` and type-checks every bound value at run time (`''`/UUID, `TENANT`/`OPERATOR`, `''`/64 lowercase hex, correlation-id pattern, integer timeout); NULL/`undefined`/`Prisma.raw` never reach the template. Fresh-connection precondition (all `app.*` NULL, else not ready + security event); the factory refuses a defined `PGOPTIONS`; C13 checks `pg_db_role_setting` / `pg_parameter_acl` hold no `app.%` row. Renderer + migration linter accept only the data-model §4.3 predicate forms; C3 rejects `DISTINCT FROM`, `COALESCE`, `NULLIF`, `<>`, `NOT ` and raw `current_setting('app.…` in policies; TASK-024's C12 probes each GUEST_CAPABLE table with no settings, `''`, org A's context and a different hash. |
| F-08 | **The guest hash must be lowercase hex.** `app_guest_token_hash()` matches `^[0-9a-f]{64}$`, so an uppercase hash fails closed (0 rows). Node `digest('hex')` is lowercase. | Quotes module: compute the hash server-side from the raw token with `digest('hex')`; never pass client-supplied hex. |
| F-09 | **Claim race.** The loser of two concurrent claims waits on the row lock and then updates 0 rows (EvalPlanQual re-check plus the RLS re-check). **Proven** (fix cycle 1, code review m5): if the winner holds the lock longer than `platform_app`'s `lock_timeout` (2 s), the loser fails with `P2010` / `originalCode '55P03'` instead (test `SPK-03 (c) a claim loser that waits longer than lock_timeout (2 s) fails with 55P03 …`). Under `RepeatableRead`/`Serializable` the loser would get `40001` (a mapped kind: `originalCode` only, PR7-SEC-03) — not exercised. | Quotes claim service: treat `55P03` (and `40001`/`40P01`) like 0 rows (re-read → 200/409), keyed on `originalCode` (F-06), and keep the claim transaction short. |
| F-10 | **Definer-function ordering in migrations.** `platform_migrator` holds `platform_definer` `WITH INHERIT FALSE, SET TRUE`. The spike issues `GRANT EXECUTE … TO platform_app` **before** `ALTER FUNCTION … OWNER TO platform_definer`. A grant after the owner change is expected to fail, because the migrator then lacks owner rights on the function (PostgreSQL 16+ ownership checks respect `INHERIT FALSE`); the reverse order was **not exercised**. The same rule hits later migrations: `CREATE OR REPLACE` of a definer-owned function needs ownership, so the migrator must `SET ROLE platform_definer` to redefine it. | TASK-016 / TASK-051 definer migrations: preferred pattern is `SET ROLE platform_definer` for creating, granting and every later `CREATE OR REPLACE` (no migrator-owned definer function ever exists, PR7-SEC-09); the grant-then-chown order shown here is acceptable only inside one transaction. |
| F-11 | `$queryRaw` cannot deserialize a `void` column (`SELECT pg_sleep(…)` → "Failed to deserialize column of type 'void'"). | Use `$executeRaw` for void-returning functions, or cast. |
| F-12 | **Harness/command: Jest's `--selectProjects` is variadic.** `jest.js --selectProjects integration <path>` treats the path as a second project name and runs **every** integration suite (run 1 ran six suites in parallel; `runtime-role.int.test.ts` then failed under that load, not investigated). Put the path first: `jest.js <path> --selectProjects integration`. `npm run test:integration -- <path>` has the same problem, because the script ends in `--selectProjects integration`. | TASK-276 harness docs and the orchestrator's dispatch template. |
| F-13 | **Harness pattern used** (re-usable by TASK-276): clone of the bootstrapped template, then in-test DDL as the migrator over `pg`. Runtime clients come from `createDatabaseClient(PrismaClient, { poolMax })` with the generated client imported under `PRISMA_TREE_LOCK`. A superuser observer (`db.superuser(database)`) watches `pg_stat_activity` for lock waits (deadline-bounded below `lock_timeout`), and seed rows go in before `FORCE` RLS, because the owner has no policy afterwards. | TASK-276 (RLS test helpers: `withTenantTx` fixture, a lock-wait observer, a "raw platform_app sees 0 rows" helper). |

## 6. Open questions

1. **C-1 (condition of the GO):** re-run exit (d) with `SPK03_BENCH=1` on ubuntu-latest with native Docker, which
   has a sub-0.2 ms loopback RTT, to measure the end-to-end per-transaction delta against the 1 ms budget.
   **Owner: TASK-016. Due: before G3.** Lifecycle of this spike file (code review m7): TASK-016 ports the (a)–(c)
   and (e) assertions (including the F-04 negative control and the pinned error shapes) into the RLS foundations /
   TASK-024 suite, runs (d) once with `SPK03_BENCH=1` for C-1, records the result here, and then deletes
   `prisma/tests/spikes/spk03-rls-tx.int.test.ts`.
2. Out of scope for this spike and **still open** from `prisma/README.md` ("Findings for SPK-03/SPK-08"): whether
   `migrate dev` keeps raw-SQL partial indexes, `migrations.initShadowDb` with the rendered bootstrap SQL, and
   `migrate dev` against a migrator-owned shadow database. The task sheet's acceptance does not list them. The
   orchestrator should assign them (TASK-016 or SPK-08 follow-up).
3. Transaction-mode poolers (PgBouncer / RDS Proxy) were not exercised. `set_config(…, true)` is transaction-scoped, so
   it is compatible by design. RDS Proxy pinning behaviour is an M5 question.
4. `TenantDb` and savepoints (F-01): resolved by PR7-SEC-05 — hidden, with a run-time guard; binding on TASK-016.

## 7. ADR notes for principal-architect (no amendment required for GO)

- **W-1 (wording, ADR-0005 Consequences):** replace "`set_config` adds ~0.2 ms per transaction" with "the context
  statement costs one extra database round trip per transaction plus ~0.1 ms server-side (SPK-03 §4)".
- **W-2 (clarification, ADR-0005 "Transaction-scoped context"):** the nested-transaction caveat applies to RLS by
  query extension, not to `withTenantTx`. In Prisma 7.10.1 a nested `tx.$transaction` is a savepoint on the same
  connection (F-01). The real hazard is calling the **root** client, or a nested `withTenantTx`, inside the callback
  (F-02). The lint rule that TASK-016 must add (ADR-0005) lowers the likelihood; the F-02 runtime guard
  (`AsyncLocalStorage` re-entrance check plus the root-client query hook) is the control that makes it fail loudly.
