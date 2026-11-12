# PR-0007 / TASK-008: change-scoped security review (SPK-03, RLS with Prisma 7 interactive transactions)

| Field | Value |
|---|---|
| PR | #7 `test(db): SPK-03 RLS with Prisma 7 interactive transactions and pooled connections (TASK-008)`, https://github.com/sukhchdit/shipcube/pull/7 |
| Branch / head | `feat/TASK-008-spk-03-spike-rls-prisma` @ `985a552`; merge-base `84ac551`; 1 commit; 2 files, +888 / −0 (`docs/04-plan/spikes/SPK-03.md`, `prisma/tests/spikes/spk03-rls-tx.int.test.ts`) |
| Scope | The GO verdict for ADR-0005 `withTenantTx`, and findings F-01..F-13 as binding input for TASK-016 (also TASK-051, TASK-006, TASK-010, TASK-276). The PR adds no product code, migration or dependency |
| Security requirements in scope | NFR-TENANT-001; REQ-RLS-003/004/013; US-075 AT-01..04; ADR-0005 (amendments 1–9); data-model §4.1–§4.6, §7.7; threat-model T-30, T-34, T-35, T-36, T-44, T-83; SEC-TC-06, SEC-TC-07; R-02 |
| Reviewer / date | security-analyst, 2026-11-12. Read-only. No install, build, Docker or test runs (D-ORCH-010). Node 24.22.3 for source reads only |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open, so the merge rule (D-ORCH-004, CLAUDE.md §5) is met. **1 MEDIUM, 7 LOW, 2 INFO**, all routed. The GO conclusion is security-sound for the in-process `pg` pool on direct connections. Three of the findings (PR7-SEC-01, -02, -05) are **binding conditions on TASK-016**, because the spike's consumer guidance understates them. |

## 1. Summary

The spike's core claim holds. A Prisma 7.10.1 interactive transaction over `@prisma/adapter-pg`, whose first statement is a parameterised `SELECT set_config('app.*', $n, true)`, scopes the tenant context to one transaction on one pooled backend.
- **Exit (a).** The tests show the context does not survive COMMIT, ROLLBACK or a following autocommit statement. They use the same backend pid with `poolMax 1`, plus interleaved and 50-parallel runs on `poolMax 2`.
- **Exit (b).** Unset, empty and malformed values (`' OR true --` included) return 0 rows. Foreign writes are rejected by `WITH CHECK` (42501). A raw `platform_app` connection sees nothing.
- **Exit (c).** The claim UPDATE passes the guest `USING` and the tenant `WITH CHECK`. Concurrent claims let exactly one organisation win, and the operator branch is read-only and membership-gated.
- **Injection.** `set_config` is bound through Prisma's tagged template, and the GUC names are literals. (e4) proves that `SET LOCAL` cannot take a bind parameter, so the only alternative would be `$executeRawUnsafe`.

The test design is good:
- it uses the production client factory and the `NOBYPASSRLS` runtime role;
- policies are created by the migrator, with `FORCE` set;
- it reads `pg_backend_pid()` to prove the same connection is reused;
- a superuser connection is used only as a `pg_stat_activity` observer.

Where the spike falls short is the guidance it hands to TASK-016. Four findings matter most:
1. **F-02 understates the root-client hazard (PR7-SEC-01, MEDIUM).**
   - "0 rows, no error" is fail-closed for confidentiality only. Any absence-based decision on an RLS table fails **open**.
   - SYSTEM-class tables (`outbox_events`, `idempotency_keys`, `processed_events`, `audit_*`) have no RLS. On them the root client **succeeds**, on another connection and outside the business transaction.
   - A nested `withTenantTx`, the realistic form of the same bug, gives the same split transaction and can self-deadlock.
   - The recommended lint check is weaker than US-075 AT-04 ("the data layer throws before reaching the database").
2. **The fail-closed results rest on two preconditions that no test asserts (PR7-SEC-02).**
   - `set_config` is not strict (verified in the PostgreSQL 18 source). A NULL value means RESET to the session default, and a NULL `is_local` means **session scope**.
   - Session defaults for `app.*` can come from the `PGOPTIONS` environment variable, which `pg` 8.23.1 reads when the config has no `options`.
3. **The transaction client exposes savepoints and raw SQL (PR7-SEC-05).** Code holding it can switch tenant context in the middle of a transaction, or swallow a 42501 inside a savepoint and still commit. Hiding `$transaction` and the `*Unsafe` methods must be binding, not just "recommended".
4. **The guest policy pair allows an org → guest "de-claim" (PR7-SEC-04).** Under the claim context, an org quote can be moved back into guest space. This is the one place where ADR-0005's "WITH CHECK is the mass-assignment defence" does not hold. The spike did not test it.

The other findings are LOW or INFO hardening items:
- **PR7-SEC-03:** F-06 covers only the raw-query error path. Model operations surface the same errors as `P2039`.
- **PR7-SEC-06:** `platform_app` can rewrite its own role-level `lock_timeout` and `idle_in_transaction_session_timeout`, which F-03 and F-09 rely on.
- **PR7-SEC-07:** the policy predicates need an allow-list, because the `''` / NULL handling works only for equality predicates.
- **PR7-SEC-08:** a risk statement for external poolers.
- **PR7-SEC-09:** the definer ownership pattern.
- **PR7-SEC-10:** the spike file stays in the permanent suite.

## 2. Method

- **Diff.** `gh pr diff 7`: two files, read in full. The test is 720 lines and SPK-03.md is 168 lines.
- **Design inputs.** ADR-0005 with amendments 1–9; data-model §4.1–§4.6, §7.6, §7.7; threat-model T-30..T-37, T-44, T-79, T-83; security-test-cases SEC-TC-05/06/07/33; US-075 AT-01..04; WAVE-00 sheets for TASK-008, TASK-016 and TASK-024; D-TASK008-01.
- **PostgreSQL 18 source, `REL_18_STABLE`, read to verify the claims.**
  - `src/backend/utils/misc/guc_funcs.c:332-375` (`set_config_by_name`): a NULL value means RESET, and a NULL `is_local` gives `GUC_ACTION_SET` (session scope).
  - `src/include/catalog/pg_proc.dat:6502-6505`: `set_config` has `proisstrict => 'f'`.
  - `src/backend/utils/misc/guc.c:1177-1217`: a placeholder is `PGC_USERSET`, and its reset value starts NULL.
  - `guc.c:6714-6780` (`validate_option_array_item`): `pg_db_role_setting` entries for placeholders need superuser or `SET` on the parameter. Known `USERSET` parameters are allowed.
  - `src/backend/commands/user.c:1000-1045` (`AlterRoleSet`): an ordinary role may change its **own** settings.
  - `src/backend/rewrite/rowsecurity.c:200-300`: on UPDATE, the new row is checked against the permissive `WITH CHECK` policies OR-ed together, plus the ALL/SELECT `USING` policies when SELECT rights are needed.
- **Third-party code at the locked versions.**
  - `@prisma/adapter-pg@7.10.1` `dist/index.mjs:400-545` (`convertDriverError`, `mapDriverError`).
  - `@prisma/client@7.10.1` `runtime/client.js`, which is minified:
    - P2010 "Raw query failed. Code … Message …" versus P2039 "Database error. Code … Message …";
    - the `ITXClientDenyList` `["$connect","$disconnect","$on","$use","$extends"]`;
    - savepoint names `prisma_sp_<n>`;
    - the default `errorFormat`, which is `minimal` only when `NODE_ENV === 'production'`.
  - `pg@8.23.1` `lib/connection-parameters.js:9-23, :83`: `options` falls back to `PGOPTIONS` when the config value is falsy.
- **RDS Proxy pinning behaviour.** AWS RDS User Guide, "Avoiding pinning an RDS Proxy", read 2026-11-12.
- **Secrets.** I grepped the diff for credential-shaped strings and got 0 hits. A positive control on the same diff (`set_config|tokenHash`) got 46 hits. gitleaks was not run, because Docker was off-limits; lane A covers the merge.
- **Supply chain.** No dependency or lockfile change. The PR evidence shows `npm audit --audit-level=high` 0, unchanged from main.
- **SAST.** Semgrep is not installed. I reviewed the test-only TypeScript manually.
- **Tests.** I did not execute them (constraint). I rely on senior-developer's D-ORCH-004 evidence (integration 45/45 on `985a552`) and judged adequacy by reading the code. PR7-SEC-04 and the NULL semantics in PR7-SEC-02 are derived from the source and **not executed**. Each one names the test that must prove it.

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner (task) | Status |
|---|---|---|---|---|---|---|---|
| PR7-SEC-01 | A root client, or a nested `withTenantTx`, used inside a tenant transaction is not uniformly fail-closed. RLS reads return 0 rows, so absence-based checks fail open. SYSTEM-table reads and writes succeed outside the business transaction. Nested transactions split atomicity and can self-deadlock. F-02's lint-only remedy does not meet US-075 AT-04 | MEDIUM | CWE-636, CWE-662, CWE-400 | A04 | `SPK-03.md:134` (F-02); test `spk03-rls-tx.int.test.ts:644-657` (e2) | TASK-016 (binding); TASK-025 (audit writer) and TASK-006 consume it | Open |
| PR7-SEC-02 | Fail-closed depends on two unasserted preconditions. (i) `set_config` is not strict: NULL value = RESET to the session default, NULL `is_local` = session scope. (ii) Session defaults for `app.*` are empty, but `PGOPTIONS` (read by `pg`), startup options or a privileged `ALTER ROLE/DATABASE … SET app.*` can set them. Nothing type-checks the bound values at run time | LOW | CWE-665, CWE-1188 | A04 | `spk03-rls-tx.int.test.ts:69-74`; `SPK-03.md:139` (F-07); data-model §7.7; `apps/api/src/platform/db/client.ts:55-72` | TASK-016 (binding); TASK-014 / TASK-006 (`PGOPTIONS` refusal) | Open |
| PR7-SEC-03 | F-06 documents the raw-query error path only. Model operations surface DB errors as `P2039`. Mapped kinds carry `originalCode` but no `code`. The default kind carries `detail`/`hint`. Prisma's non-minimal `errorFormat` (any `NODE_ENV` other than `production`) adds call-site frames and rendered arguments | LOW | CWE-209, CWE-532 | A04 (A09) | `SPK-03.md:138` (F-06), `:141` (F-09); `@prisma/adapter-pg` `index.mjs:410-540` | TASK-016 (DB error mapping); TASK-006 (problem+json); TASK-010 (log serializer) | Open |
| PR7-SEC-04 | The GUEST_CAPABLE policy pair permits an **org → guest de-claim**. With both `app.org_id` and `app.guest_token_hash` set, `UPDATE … SET org_id = NULL, guest_token_hash = <hash>` on an org quote passes the tenant `USING` and the guest `WITH CHECK`. The row leaves tenant scope and becomes readable through a guest token | LOW | CWE-639, CWE-284 | A01 | `spk03-rls-tx.int.test.ts:243-249`; data-model §4.3 (GUEST_CAPABLE), §4.4 `:2717-2719` (column grants include `org_id`, `guest_token_hash`) | data-architect (data-model §4.3 amendment); TASK-051 (trigger + test); TASK-016 (renderer template) | Open |
| PR7-SEC-05 | The transaction client handed to repositories exposes `$transaction` (savepoints), `$queryRawUnsafe` and `$executeRawUnsafe`, and `$executeRaw` can call `set_config`. Code can therefore switch tenant mid-transaction, or swallow a 42501 in a savepoint and commit partial work. F-01 marks hiding them as "recommended" | LOW | CWE-284, CWE-693 | A04 | `SPK-03.md:133` (F-01), `:136` (F-04); test `:623-642` (e1), `:691-701` (e4) | TASK-016 (binding) | Open |
| PR7-SEC-06 | `platform_app` can `ALTER ROLE platform_app [IN DATABASE …] SET/RESET` its own `USERSET` defaults. `lock_timeout 2s`, `idle_in_transaction_session_timeout 15s` and `search_path` (relied on by F-03/F-09 and T-83) can be removed durably by one raw-SQL or injection defect. `default_transaction_read_only = on` is a persistent platform-wide DoS | LOW | CWE-15 | A05 | `prisma/bootstrap/00-roles.sql:55-57` (TASK-003 baseline); PostgreSQL `user.c:1038-1040` | TASK-016 (per-tx values, C13); TASK-006 (readiness drift check) | Open |
| PR7-SEC-07 | `''`/NULL safety (F-07) holds only because every predicate is an equality against a NULL-returning helper. Predicates using `IS [NOT] DISTINCT FROM`, `coalesce`, `<>`/`NOT`, or a raw `current_setting('app.org_id' …)` would fail open. `org_id IS NOT DISTINCT FROM app_org_id()` would expose every guest row to every context-less session. No predicate allow-list exists | LOW | CWE-697, CWE-636 | A01 | `SPK-03.md:139` (F-07); data-model §4.3, §4.6 C3/C12 | TASK-016 (renderer + C3); TASK-024 (C12 generator) | Open |
| PR7-SEC-08 | No transaction-mode pooler (PgBouncer, RDS Proxy) was tested. Transaction-local settings are compatible by design. The residual risks: RDS Proxy pins on `set_config`, so platform.md's multiplexing claim is unverified; it does **not** detect state changes made inside functions; session-level state leaks across clients; statement mode breaks interactive transactions | LOW | CWE-488 | A04 | `SPK-03.md:157` (§6 item 3); platform.md §DB pooling (`:637`) | platform-architect (G4-production checklist); devops (M5) | Open (M5) |
| PR7-SEC-09 | F-10's grant-then-chown leaves a `SECURITY DEFINER` function owned by `platform_migrator` between the two statements. That window is safe only while both run in one implicit transaction. The pattern that never creates a migrator-owned definer function is `SET ROLE platform_definer` | INFO | CWE-269 | A04 | `SPK-03.md:142` (F-10); test `:219-226` | TASK-016 / TASK-051 (definer migrations); linter rule | Open (note) |
| PR7-SEC-10 | The throwaway spike is merged into the permanent integration suite, against the TASK-008 DoD ("throwaway code is not merged"). It contains `$executeRawUnsafe` with string interpolation, which a future repository ban must exempt narrowly. It also carries a host-sensitive timing assertion | INFO | CWE-1164 | A04 | `prisma/tests/spikes/spk03-rls-tx.int.test.ts:696`, `:617-618` | senior-developer / orchestrator; TASK-016 (port, then delete) | Open (note) |

### PR7-SEC-01 (MEDIUM): the root client and nested transactions inside `withTenantTx` are not uniformly fail-closed

**Description.** Test (e2) proves the mechanism: the root client gets a different backend, and that backend has no context. SPK-03 F-02 concludes "0 rows, no error" and recommends a lint rule plus a test that no repository imports the client module. The effect depends on the table class:

| Table class | Effect of a root-client call inside `withTenantTx` | Fail mode |
|---|---|---|
| TENANT / GUEST_CAPABLE / USER_OWNED (RLS) | Reads: 0 rows | Confidentiality: closed. **Decisions based on absence: open.** Examples: MFA attempt counters (`mfa_challenges`, USER_OWNED) read 0 → no lockout; a pre-check for "payment already captured" or "label already issued" reads 0 → a second capture or label (CLAUDE.md §1 guardrails); a uniqueness pre-check reads 0 → a duplicate |
| same | Writes: 42501 | Closed |
| SYSTEM (`outbox_events`, `idempotency_keys`, `processed_events`, `audit_*`; no RLS per ADR-0005) | Reads **and writes succeed**, on another connection, in another transaction | **Open (integrity).** The audit entry commits even if the business transaction rolls back, or is lost if it commits first (O4: 100 % audit completeness). An outbox event is emitted for a rolled-back booking, so the label or charge job runs. The idempotency key is recorded for work that never committed |

The realistic form of the defect is not a repository importing the client. It is a service running inside `withTenantTx` that calls another service, which opens its **own** `withTenantTx` (same context, new connection). That inner transaction:
- does not see the outer transaction's uncommitted rows, which leads to false "not found" results or duplicate inserts;
- commits independently of the outer one;
- waits on the outer transaction's row locks until `lock_timeout` (2 s) fails it.

Under load, N requests × 1 nested checkout with `poolMax N` stall until `maxWait`, the starvation shown in (e2) with `poolMax 1`. This is threat-model T-83 (CWE-400).

**Exploitability / impact.** Exploiting it needs a developer defect, not attacker input. It is a common dependency-injection mistake: a service is handed the client singleton, or one service calls another. ADR-0005's module-private rule lowers the likelihood but does not remove it. Impact: integrity of audit, outbox and idempotency, the money and label guardrails, and availability. Likelihood L–M × Impact H → **MEDIUM**.

**Remediation (binding on TASK-016; verify at its review).**
1. `apps/api/src/platform/db` exports no `PrismaClient` instance.
   - Hold the factory result in a module-private closure.
   - The public surface is `withTenantTx(ctx, fn)`, plus any narrowly named system variants that also set an explicit `''` context.
   - The ESLint boundaries / `no-restricted-imports` rule bans the generated client and `platform/db/client.ts` everywhere except the composition root and `platform/db`.
2. **Re-entrance guard.** `withTenantTx` keeps an `AsyncLocalStorage` marker. If it is entered while a tenant transaction is already active on the same async chain, it throws `NESTED_TENANT_TX` before checkout. It neither silently opens a second connection nor joins the outer transaction.
   ```ts
   const active = new AsyncLocalStorage<true>();
   export async function withTenantTx<T>(ctx: DbContext, fn: (db: TenantDb) => Promise<T>): Promise<T> {
     if (active.getStore()) throw new NestedTenantTxError(); // AT-US-075-04 / PR7-SEC-01
     return active.run(true, () => client.$transaction(async (tx) => { await setContext(tx, ctx); return fn(asTenantDb(tx)); }, TX_OPTIONS));
   }
   ```
3. Writers of SYSTEM tables accept `TenantDb` only, and this is type-enforced. These are the `packages/audit` store adapter, the outbox, idempotency and processed-events writers. None of them can reach a client of its own.
4. `P2028` (pool checkout or expired transaction) maps to a retryable 503 `DB_BUSY`, never a 500. Data-model §7.7 sets `transactionOptions` explicitly (`maxWait ≤ connectionTimeoutMs`, `timeout` < `idle_in_transaction_session_timeout`). No external I/O happens inside `withTenantTx` (T-83 lint).

**Code-review m3 proposes a different guard.** That guard is a `$extends` query hook on the root client that throws while the `AsyncLocalStorage` scope is active. It is compatible with item 2 only if `withTenantTx` calls `$transaction` on a **separate, unguarded, module-private** client. The reason is that a transaction client inherits its parent's query extensions: test (e5) shows the hook firing for operations inside the transaction. If both guards are used, put the hook on the instance that other code could reach. The re-entrance check in item 2 is still needed, because a nested `withTenantTx` never touches the guarded instance.

**Verification.**
- **AT-US-075-04.** A unit test shows that a call to `withTenantTx` inside `withTenantTx` rejects with `NESTED_TENANT_TX` without checking out a connection. The pool's `totalCount` is unchanged.
- A lint fixture importing the client from `modules/**` fails.
- An integration test: inside `withTenantTx`, an attempt to write `audit_entries` through any non-`TenantDb` path does not compile (type test), or throws.
- `P2028` → 503 mapping test.

### PR7-SEC-02 (LOW): the fail-closed result depends on unasserted preconditions (non-strict `set_config`, session defaults)

**Description.** PostgreSQL 18 `set_config` has `proisstrict => 'f'` (`pg_proc.dat:6503`), and `set_config_by_name` (`guc_funcs.c:347-368`) does two things:
- **Value NULL.** It performs a RESET, so the setting returns to its **session reset value** (`value = NULL`, "SET DEFAULT … is equivalent to RESET").
- **`is_local` NULL.** It sets `is_local = false`, which is `GUC_ACTION_SET`: **session scope**, surviving COMMIT on the pooled backend. That is exactly the REQ-RLS-003 failure.

The spike binds `''` and the literal `true`, so it is safe. But nothing stops TASK-016 from introducing either form. Data-model §7.7 coalesces `orgId` and `guestTokenHash` but not `actorId`, `scope` or `correlationId`.

The session reset value of `app.*` is empty only if nothing set it at session start. `pg@8.23.1` uses `config.options || process.env.PGOPTIONS` (`connection-parameters.js:9-23, :83`), and an empty `options` does not override it. So `PGOPTIONS='-c app.actor_scope=OPERATOR -c app.actor_id=<operator uuid>'` changes the reset value for every runtime connection. Two consequences follow:
- out-of-wrapper queries (PR7-SEC-01) would then run with that context instead of returning 0 rows;
- a NULL bind would RESET to it.

`ALTER ROLE/DATABASE … SET app.*` has the same effect. PostgreSQL refuses it to `platform_app` (`guc.c:6752-6762`, placeholders need superuser or `SET` on the parameter), but the bootstrap superuser and the RDS master can do it. The factory already rejects a URL `options` parameter (`client.ts:60-61`), but not `PGOPTIONS`.

A further gap: Prisma's tagged template splices a `Prisma.Sql` / `Prisma.raw()` value as SQL, not as a bind parameter. If a non-string reached `setContext` through `any`, the result would be SQL injection, so the values need a run-time type check.

**Exploitability / impact.** Each precondition alone fails closed. A cross-tenant read needs a NULL bind or out-of-wrapper query **and** a populated session default. The populated default comes from environment control, which normally also exposes the DB credentials, or from a misconfiguration. Likelihood L × Impact M (after the compound requirement) → **LOW**. The control is cheap and it protects the core O3 property, so the remediation is binding.

**Remediation (binding on TASK-016).**
1. **The `setContext` SQL keeps `is_local` as the literal `true` in the template text**, never `${…}`. Every bound value is checked at run time with `typeof v === 'string'`:
   - `orgId` and `actorId`: `''` or a UUID (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/`);
   - `scope`: `'TENANT' | 'OPERATOR'`;
   - `guestTokenHash`: `''` or `/^[0-9a-f]{64}$/`;
   - `correlationId`: `/^[A-Za-z0-9._-]{1,64}$/`;
   - `statementTimeoutMs`: an integer in `[100, 30000]`.

   Anything else throws before checkout. NULL and `undefined` are never bound.
2. **Fresh-connection precondition.** Add a `pg.Pool` `connect` hook in the factory, or a single start-up probe, that runs `SELECT current_setting('app.org_id', true), …` for all four keys. Every one must be NULL. Otherwise refuse readiness, with a security log event (`db_session_default_tampered`).
3. **The factory refuses a defined `PGOPTIONS`** (and any `PG*` that changes session state) in every environment. This extends PR5-SEC-08 and the TASK-014 preflight to the factory itself, which the tests also use.
4. **C13 additions.**
   - `pg_db_role_setting` holds no `app.%` entry for any role or database.
   - `pg_parameter_acl` holds no `app.%` row.

**Verification.**
- **Unit.** A capturing fake `tx` shows that the template contains `, true)` four times and binds only strings. `null`, `undefined`, a `Prisma.raw('x')` object and a malformed UUID each throw.
- **Integration.** On a fresh `platform_app` connection, all `app.*` settings read NULL.
- **Negative control** (documents the dependency): on a `poolMax 1` client, a committed `set_config('app.org_id', A, false)` **is** visible to the next autocommit statement, and the next `withTenantTx` overrides it.
- **Factory test.** `PGOPTIONS` set → `DatabaseConfigError`.
- **Catalog test** for the C13 rows.

### PR7-SEC-03 (LOW): the error mapping guidance (F-06, F-09) is incomplete

**Description.** F-06 records `P2010` with `meta.driverAdapterError.cause.code = '42501'`. That is the raw-query path only, because the spike tables have no Prisma models.

In `@prisma/client@7.10.1`, a driver error of kind `postgres` from a **model** operation becomes `P2039` "Database error. Code: `<code>`. Message: `<message>`". In both paths the DB message is part of `error.message`.

`@prisma/adapter-pg` behaves as follows:
- It always sets `originalCode` and `originalMessage`.
- For the default kind it also sets `code`, `detail`, `hint` and `column`.
- For mapped kinds it omits `code`. These are `40001` and `40P01` (→ `TransactionWriteConflict`, which a claim under RepeatableRead or Serializable produces instead of F-09's 0 rows), `23505` (→ P2002), and `22P02` (whose message echoes the rejected input value).

A mapper that reads `cause.code`, as F-06 says, misses the mapped kinds. Prisma also chooses `errorFormat: 'minimal'` only when `NODE_ENV === 'production'`. Otherwise it uses `colorless`, which adds a call-site code frame and the rendered call arguments to the message. This project keys environments on `APP_ENV` (ADR-0018), so the minimal format is not guaranteed.

**Exploitability / impact.**
- Table names and input values could be echoed to clients, which is CWE-209 and also breaks A-042's uniform 404.
- PII from rendered arguments could reach logs, against the CLAUDE.md §1 guardrail.
- Retryable conflicts would surface as 500s.

Likelihood M × Impact L → **LOW**.

**SQLSTATE 42501 is overloaded.** PostgreSQL raises it for four different causes:
- an RLS `WITH CHECK` rejection;
- a missing privilege, such as `DELETE` without a grant;
- trigger-raised `AUDIT_IMMUTABLE` / `AUDIT_VAULT_IMMUTABLE` (data-model §5.2, §5.7);
- the PR7-SEC-04 trigger.

The client-facing status can be the same for all of them. The security-event name, however, should be chosen from the internal message prefix (`new row violates row-level security policy` → `rls_write_rejected`; trigger messages → their own event; otherwise `db_privilege_denied`), and that message is never echoed.

**Remediation.**
1. **TASK-016** adds one `mapDbError(e)` in `platform/db`. For any `PrismaClientKnownRequestError` whose `meta.driverAdapterError` is present (P2010, P2039, P2002…), it keys on `meta.driverAdapterError.cause.originalCode`:

   | `originalCode` | Mapped to |
   |---|---|
   | `42501` | `NotFound` (write to an invisible row) or `Forbidden` per ADR-0005 / A-042 |
   | `55P03`, `57014`, `40001`, `40P01` | retryable 409 / 503. The claim service treats them as "re-read" (F-09) |
   | `P2028` | 503 |
   | anything else | `500 INTERNAL` with no message |

2. **TASK-006.** The problem+json handler never copies `message`, `originalMessage`, `detail`, `hint` or `meta`.
3. **TASK-010.** The Pino serializer logs Prisma errors as `{name, code, originalCode, kind}` only.
4. `createDatabaseClient` passes `errorFormat: 'minimal'` explicitly. `PrismaClientConstructor` must accept it.

**Verification.**
- An integration test, with a TASK-016 model, gets a 42501 from a model `create` and asserts `P2039` → `NotFound`.
- A raw 42501 → the same result.
- A claim under `isolationLevel: 'Serializable'` loses with 40001 → re-read path.
- The API response body and log line contain neither the table name nor the input.

### PR7-SEC-04 (LOW): the GUEST_CAPABLE policies permit an org → guest de-claim

**Description.** The guest policy is `FOR ALL … USING (org_id IS NULL AND guest_token_hash = app_guest_token_hash()) WITH CHECK (same)`. The tenant policy is `USING/WITH CHECK (org_id = app_org_id())`. The claim context sets both org A and hash H. In that context, the following statement passes:

```sql
UPDATE quotes SET org_id = NULL, guest_token_hash = decode(H,'hex') WHERE id = <org-A quote>
```

- The old row passes the tenant `USING`.
- The new row passes the guest `WITH CHECK` (permissive policies are OR-ed, `rowsecurity.c:264-300`).
- It passes the guest SELECT `USING`, which applies because the `WHERE` needs SELECT rights.
- It passes the `CHECK ((org_id IS NULL) <> (guest_token_hash IS NULL))`.
- `platform_app` holds column `UPDATE` on `org_id` and `guest_token_hash` (data-model `:2717-2719`).

The quote, and its children if the same statement is applied to them, leaves the organisation's RLS scope and becomes readable to anyone holding a token that hashes to H. One example is a departing member who keeps reading quote data after their membership is removed. ADR-0005 claims "WITH CHECK prevents writing a foreign org_id even if the application is buggy". For GUEST_CAPABLE tables, writing `org_id = NULL` is the exception.

**Exploitability / impact.** It needs an application defect. Two are plausible:
- a mass-assignable `orgId` or `guestTokenHash` on a quote update (T-33);
- a route that sets `app.guest_token_hash` from `X-Quote-Token` outside the guest and claim flows.

Impact: quote data, which can include addresses, moves out of tenant scope. Likelihood L × Impact M → **LOW**. Spike test (c) covers guest → org only. The reverse was not tested.

**Remediation.**
1. **Data-model §4.3 amendment (data-architect).** Add a `BEFORE UPDATE` row trigger on `quotes`, `quote_packages`, `quote_options` and `quote_shares`, owned by the migrator, not `SECURITY DEFINER`, with `SET search_path = pg_catalog, pg_temp`. It makes ownership one-way:
   ```sql
   IF OLD.org_id IS NOT NULL AND NEW.org_id IS DISTINCT FROM OLD.org_id THEN
     RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QUOTE_OWNER_IMMUTABLE';
   END IF;
   IF NEW.guest_token_hash IS NOT NULL AND NEW.guest_token_hash IS DISTINCT FROM OLD.guest_token_hash THEN
     RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'GUEST_TOKEN_HASH_IMMUTABLE';
   END IF;
   ```
   Allowed: guest → org once, and hash → NULL. C7 or C11 lists the trigger.
2. **Route metadata (TASK-020 / TASK-051).** `app.guest_token_hash` is non-empty only on routes declaring `tenancy: 'guest'` and on the claim operation. Every other route binds `''`.

**Verification.**
- **TASK-051** (SEC-TC-07 family): under the claim context, the de-claim UPDATE fails with 42501 `QUOTE_OWNER_IMMUTABLE`. Changing a guest row's hash to another hash fails. The legitimate claim still succeeds.
- **TASK-024** generator: for every GUEST_CAPABLE table, the org → NULL update is rejected.

### PR7-SEC-05 (LOW): the `TenantDb` surface (savepoints, raw context switching)

**Description.** F-01, verified against `ITXClientDenyList` and `prisma_sp_<n>`, shows that `tx.$transaction` is a savepoint that keeps the context. That has two consequences:
- A `set_config('app.org_id', B, true)` issued through `tx.$executeRaw`, inside a savepoint that is then released or directly in the transaction, switches tenant for the rest of the transaction. This is T-35, without any SQL injection.
- A 42501 caught inside a nested `$transaction` rolls back only to the savepoint, so the outer transaction commits partial work. Without savepoints, the 42501 aborts the transaction (25P02) and the whole unit of work fails closed.

F-01 calls hiding these methods "recommended". `Omit<…>` alone is compile-time only: `as any` or a structural cast bypasses it.

**Remediation (binding on TASK-016).**
1. Define `type TenantDb = Omit<Prisma.TransactionClient, '$transaction' | '$queryRawUnsafe' | '$executeRawUnsafe'>`.
2. `asTenantDb(tx)` returns a `Proxy` that throws `FORBIDDEN_DB_METHOD` for those names. A future `savepoint(fn)` is added only with a use case and its own review.
3. A Semgrep or ESLint rule allows the following only in `apps/api/src/platform/db/with-tenant-tx.ts`: `set_config`, `current_setting('app.`, `SET LOCAL`, `SET SESSION`, `RESET `, `DISCARD`, `Prisma.raw(`, `$queryRawUnsafe`, `$executeRawUnsafe`, and the literals `app.org_id` / `app.actor_id` / `app.actor_scope` / `app.guest_token_hash`. Test folders get an exact-file exemption only (see PR7-SEC-10). This is US-075 AT-03 and R-02.
4. Migration linter plus a catalog check: no function body in `public` or `platform` (`pg_proc.prosrc`) contains `set_config(` or `SET ` targeting `app.`. This also covers PR7-SEC-08 (ii).

**Verification.**
- Unit: `asTenantDb(tx).$transaction` throws.
- A lint fixture per banned token in `modules/**` fails.
- Catalog: the `prosrc` scan returns 0 rows.

### PR7-SEC-06 (LOW): the runtime role can rewrite its own role-level settings

**Description.** `AlterRoleSet` (`user.c:1038-1040`) allows `roleid == GetUserId()`, and `validate_option_array_item` allows any known `USERSET` parameter. So `platform_app` can run `ALTER ROLE platform_app [IN DATABASE d] SET|RESET` on any of these:
- `lock_timeout`, `idle_in_transaction_session_timeout` and `search_path`, which `00-roles.sql:55-57` sets, and which F-03, F-09 and T-83 rely on;
- `statement_timeout`;
- `default_transaction_read_only`.

The change applies to every **new** connection of the role, across all API and worker tasks, and survives restarts. It is not introduced by this PR. It is raised here because the spike's timing and lock guidance assumes these values.

**Exploitability / impact.** It needs a raw-SQL or injection defect running as `platform_app` (T-35 rates this Hard). The effect is persistent: protections against pool exhaustion and lock waits are removed, or the platform is put into a durable read-only outage (`default_transaction_read_only = on`). Likelihood L × Impact M → **LOW**.

**Remediation.**
1. **TASK-016.** The context statement also sets `set_config('lock_timeout', '2s', true)` and `set_config('idle_in_transaction_session_timeout', '15s', true)`, next to `statement_timeout`. Per-transaction values beat role defaults.
2. **TASK-016 C13** asserts `platform_app`'s `pg_db_role_setting` rows exactly.
3. **TASK-006 readiness.** At start-up and on a slow interval, compare `pg_db_role_setting` for `current_user` with the expected set, and for drift report not-ready plus a security event. Also add the PR7-SEC-02 item 2 check.
4. **Lint.** Ban `ALTER ROLE` / `ALTER USER` in application code.

**Verification.**
- Integration: after `ALTER ROLE platform_app RESET lock_timeout` (as the role itself), a `withTenantTx` still shows `current_setting('lock_timeout') = '2s'`, and the readiness probe reports drift.

### PR7-SEC-07 (LOW): there is no allow-list for policy predicates

**Description.** After the first transaction on a connection, the settings read `''`; on a fresh connection they read NULL. Both are safe only because:
- every helper maps `''` and malformed values to NULL;
- every predicate is `col = helper()` or `current_setting('app.actor_scope', true) = 'OPERATOR' AND app_is_operator()`.

A template or hand-written policy using `IS NOT DISTINCT FROM`, `coalesce(…, '')`, `<>`, `NOT (…)`, or a raw `current_setting('app.org_id', true)` comparison would fail open. For example, `org_id IS NOT DISTINCT FROM platform.app_org_id()` makes every guest row (`org_id NULL`) visible to any session without org context.

C3 compares the policies with a committed snapshot. A renderer change updates both in the same PR, so detection rests on human review alone.

**Remediation.**
1. `render-rls.ts` and the migration linter accept only the exact predicate forms of data-model §4.3 (tenant, guest, operator, own, definer-read).
2. A C3 addition rejects any `pg_policies.qual` / `with_check` containing `DISTINCT FROM`, `COALESCE`, `NULLIF`, `<>`, `NOT `, or `current_setting('app.org_id'` / `'app.actor_id'` / `'app.guest_token_hash'`.
3. The C12 generator (TASK-024) adds, per GUEST_CAPABLE table, a guest row probed with:
   - no settings,
   - `''`,
   - org A's context,
   - a different hash.

   All four return 0 rows.

**Verification.** A negative fixture with an `IS NOT DISTINCT FROM` policy fails the linter and C3, and the C12 guest probes pass.

### PR7-SEC-08 (LOW, M5): risk statement for transaction-mode poolers

**Statement.** SPK-03 proved isolation for the in-process `pg` pool on direct connections only. Transaction-local `set_config` is compatible with transaction pooling by construction, because the settings end with the transaction. The residual risks for adopting a pooler (platform.md `:637` names RDS Proxy as "the 100× option") are:
1. **RDS Proxy pins sessions for PostgreSQL** when it sees `SET` or `set_config` (AWS "Avoiding pinning an RDS Proxy"). Every `withTenantTx` would then pin. This is safe, since pinned behaves like a session pool, but the multiplexing benefit platform.md assumes is unverified. Measure it, as condition C-2 for platform-architect.
2. **RDS Proxy does not detect session-state changes made inside functions or procedures.** A DB function that runs `set_config(…, false)` or `SET` would leak state across **client connections of different processes** without pinning. PR7-SEC-05 item 4 closes this at catalog level.
3. **PgBouncer.**
   - Transaction mode leaks any session-level state to other clients, so nothing may ever write session state (PR7-SEC-02 and -05 lints).
   - Statement mode breaks interactive transactions and must never be used.
   - `server_reset_query` does not run in transaction mode.
   - A `DISCARD ALL` reset query defeats pinning in RDS Proxy.
4. **Prepared statements.** `pg` uses unnamed statements for parameterised queries. Named prepared statements pin RDS Proxy and break older PgBouncer versions.

**Condition before any pooler is adopted (G4-production checklist).**
- Re-run SPK-03 (a)/(b) and the REQ-RLS-003 test through the pooler (a PgBouncer Testcontainer in transaction mode, or RDS Proxy in staging).
- Assert the `prosrc` scan from PR7-SEC-05.
- Record the pinning metric (`DatabaseConnectionsCurrentlySessionPinned`).

**Owner.** platform-architect, with devops at M5. This run has no deployment target, so nothing is exposed now.

### PR7-SEC-09 (INFO): ownership pattern for definer functions (F-10)

F-10 is correct.
- With `INHERIT FALSE`, PostgreSQL 16+ ownership checks fail for the migrator after `OWNER TO platform_definer`, so the grant has to come first.
- `aclnewowner` rewrites the grantor to `platform_definer`.
- `ALTER DEFAULT PRIVILEGES FOR ROLE platform_definer REVOKE EXECUTE … FROM PUBLIC` exists (`01-schemas.sql:31`).

Between `CREATE FUNCTION … SECURITY DEFINER` and `ALTER … OWNER`, the function runs as `platform_migrator` while `platform_app` already holds `EXECUTE`. The migrator has no runtime policies, so `FORCE` RLS leaves it 0 rows. But it **owns** the SYSTEM and GLOBAL tables, which have no RLS. The window is closed only if both statements commit together. A multi-statement simple-query file runs as one implicit transaction; TASK-016's rule-5 probe records how Prisma submits files.

**Preferred pattern.** The function is never migrator-owned:
```sql
SET ROLE platform_definer;
CREATE FUNCTION … SECURITY DEFINER SET search_path = pg_catalog, pg_temp …;
GRANT EXECUTE ON FUNCTION … TO platform_app;
RESET ROLE;
```
This works because `platform_definer` has `CREATE` on `platform` (amendment 8) and the migrator holds `SET TRUE`.

**Linter rule (TASK-016).** A `SECURITY DEFINER` in a migration must be either inside a `SET ROLE platform_definer … RESET ROLE` block, or followed in the same file by `OWNER TO platform_definer`. C11 already asserts the owner.

### PR7-SEC-10 (INFO): spike file kept in the permanent suite

The TASK-008 DoD says throwaway code is not merged. This PR merges `prisma/tests/spikes/spk03-rls-tx.int.test.ts` into the `integration` project (`testMatch **/*.int.test.ts`). It runs on every integration run and contains:
- `$executeRawUnsafe` with string interpolation (`:696`, a test-only UUID);
- p95 timing assertions (`:617-618`) on shared runners;
- `spk03_*` objects created in `public`/`platform` of a throwaway template clone.

The pending ADR-0005 amendment 10 (see §4a) ratifies keeping the file until TASK-016 closes C-1. That amendment also says that only the server-side statement cost is asserted. The client-observed delta assertion at `:618` (`p95StatementVsSelect1 ≤ 1`) contradicts it, so either remove `:618` or change the amendment text. This is a reliability point for code-reviewer.

There is no security exposure today. The lint ban from PR7-SEC-05 item 3 would have to exempt this file. That exemption must be exact to the file path and carry an expiry, never a `prisma/tests/**` or `**/spikes/**` glob, given PR-0002's test-folder hole. Track deletion after C-1, or port the file into TASK-016's suite (SPK-03 §6 item 1). Route: senior-developer / orchestrator, recorded in DECISIONS.

## 4. F-01..F-13 assessment (input to TASK-016)

| ID | Sound? | Complete for TASK-016? | Change / addition |
|---|---|---|---|
| F-01 | Yes (deny list and savepoint naming checked in the 7.10.1 runtime) | No | Hiding `$transaction`/`*Unsafe` is **binding**, with run-time enforcement (PR7-SEC-05) |
| F-02 | Mechanism yes | **No** | The consequence depends on table class, and the nested `withTenantTx` form is missing. A runtime guard is required (PR7-SEC-01) |
| F-03 | Yes | Mostly | `P2028` → 503 (PR7-SEC-01). Set `lock_timeout`/idle per transaction (PR7-SEC-06). Prisma `timeout` < 15 s idle-in-transaction |
| F-04 | Yes | Mostly | Widen the ban list. `is_local` stays a literal (PR7-SEC-02/05) |
| F-05 | Yes | Yes | Keep the data-model §7.6 rule that the extension never uses the base client |
| F-06 | Raw path only | **No** | P2039 path, `originalCode`, `errorFormat: 'minimal'`, log serializer (PR7-SEC-03) |
| F-07 | Yes for the current helpers | No | Session-default precondition (PR7-SEC-02); predicate allow-list (PR7-SEC-07). A fresh connection reads NULL, a reused one `''` |
| F-08 | Yes (fail-closed) | Mostly | **Compute** the hash server-side from the raw token with `digest('hex')`. Never accept or "normalise" client-supplied hex: the stored hash is the DB-level key. De-claim (PR7-SEC-04) |
| F-09 | Plausible inference | No | Also `40001` under RR/Serializable. Key the mapping on `originalCode` (PR7-SEC-03) |
| F-10 | Yes | Yes | Preferred `SET ROLE platform_definer` pattern and linter rule (PR7-SEC-09) |
| F-11 | n/a (functional) | — | — |
| F-12 | Yes | — | Evidence hygiene: a dispatch that claims one-file evidence ran six suites. Fix the TASK-276 / dispatch template |
| F-13 | Yes | Yes | The superuser connection stays an observer only. Runtime behaviour is always asserted through `platform_app` |

**Verdict on the GO.** Security-sound for the in-process `pg` pool on direct PostgreSQL connections. The GO is **conditional** on TASK-016 implementing PR7-SEC-01, -02 and -05 as written above. It does **not** extend to external poolers until PR7-SEC-08 is re-validated. No ADR amendment is required. The W-2 wording should add "and nested `withTenantTx`" to the hazard sentence.

## 4a. Interaction with the pending ADR-0005 amendment 10 (D-ARCH-058)

At review time, the main working tree held an **uncommitted** ADR-0005 amendment 10 ("Amendment after SPK-03", D-ARCH-058, citing `rulings/wave-0-batch-3-rulings.md` item 2, which is not yet present). It makes F-01..F-13 binding. Security-analyst does not edit ADRs. The following deltas go to principal-architect so the amendment and this review agree:

| Amendment 10 item | Gap | Requested text |
|---|---|---|
| 2 (root client private, lint/unit check) | Lint only. Does not meet AT-US-075-04 and does not cover nested `withTenantTx` or SYSTEM tables | Add the PR7-SEC-01 items 1–3: re-entrance guard `NESTED_TENANT_TX`, a run-time throw for AT-US-075-04, SYSTEM-table writers typed on `TenantDb` |
| 1 (`TenantDb = Omit<…>`) | Compile-time only. `set_config` is still reachable through `$executeRaw` | Add the run-time Proxy, plus the `set_config`/`app.*` token ban outside `with-tenant-tx.ts` and the `prosrc` scan (PR7-SEC-05) |
| 4 (`set_config(name, $1, true)` only) | Silent on NULL and `is_local` | Add: "`is_local` is the literal `true`; only validated strings are bound; never NULL, `undefined` or `Prisma.Sql`" (PR7-SEC-02 item 1) |
| 6 (P2010 + `cause.code === '42501'` → 403 `AUTHZ_DENIED`, `rls_write_rejected`) | Model operations surface as `P2039`. Mapped kinds lack `cause.code`. 42501 is overloaded | Key on `meta.driverAdapterError.cause.originalCode` for any Prisma error carrying `driverAdapterError`. Choose the event name from the internal message prefix. Add `40001`/`40P01`/`57014` to the retryable set (PR7-SEC-03) |
| 7 (`''` = NULL, "catalog C-series covers it") | No predicate allow-list. Session-default precondition missing | Add the PR7-SEC-07 allow-list and C3 token scan, and the PR7-SEC-02 fresh-connection probe and C13 `app.%` rows |
| 9 (grant before owner change; alternative `SET ROLE` for the grant) | Sound. Optional linter rule 15 | Prefer creating under `SET ROLE platform_definer` (PR7-SEC-09). Make the linter rule mandatory, not optional |
| C-1 paragraph ("only the server-side statement cost is asserted") | The spike asserts the client-observed delta at `:618` | Align the test or the text (PR7-SEC-10) |
| new | — | Add the de-claim rule for GUEST_CAPABLE tables (PR7-SEC-04) as a data-model §4.3 amendment, and the role-setting drift item (PR7-SEC-06) |

Amendment item 8 (hash computed server-side, never client hex) matches this review's F-08 position.

## 5. Binding conditions for TASK-016 (check at its security review)

1. **PR7-SEC-01:**
   - no exported client;
   - an `AsyncLocalStorage` re-entrance guard (`NESTED_TENANT_TX`);
   - SYSTEM-table writers typed on `TenantDb`;
   - `P2028` → 503;
   - AT-US-075-04 implemented as a run-time throw.
2. **PR7-SEC-02:**
   - literal `true`, and string-only, validated values (no NULL, `undefined` or `Prisma.Sql`);
   - the fresh-connection NULL probe;
   - the factory refuses `PGOPTIONS`;
   - C13: no `app.%` in `pg_db_role_setting` or `pg_parameter_acl`;
   - the session-scope negative-control test.
3. **PR7-SEC-05:**
   - the `TenantDb` Proxy;
   - the token ban list with exact-file test exemptions;
   - the `prosrc` scan.
4. **PR7-SEC-06 item 1 and C13 row assertion.**
5. **PR7-SEC-07:** renderer and linter predicate allow-list, and the C3 forbidden-token scan.
6. **PR7-SEC-03 item 1** (`mapDbError` on `originalCode`) and item 4 (`errorFormat: 'minimal'`).
7. **PR7-SEC-09** linter rule.

Other owners:
- **TASK-051** (with data-architect): PR7-SEC-04.
- **TASK-024:** PR7-SEC-07 item 3.
- **TASK-006 / TASK-010:** PR7-SEC-03 items 2–3; PR7-SEC-06 item 3.
- **platform-architect:** PR7-SEC-08, plus C-2 (pinning measurement).

## 6. ASVS / OWASP mapping

V4.1.1 and V4.1.3 (access control enforced at a trusted layer, least privilege): RLS fail-closed is proven. V4.1.5 (fail securely): PR7-SEC-01 and -02. V5.3.4 (parameterised queries): verified. V7.4.1 (generic error messages): PR7-SEC-03. V14.1.x (configuration hardening): PR7-SEC-06.

Sources consulted: PostgreSQL `REL_18_STABLE` source (`guc_funcs.c`, `guc.c`, `pg_proc.dat`, `user.c`, `rowsecurity.c`); [AWS RDS Proxy: Avoiding pinning](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-pinning.html); locked `node_modules` (`@prisma/client` / `@prisma/adapter-pg` 7.10.1, `pg` 8.23.1).
