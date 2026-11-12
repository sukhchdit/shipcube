---
name: project-p5-wave0-rls-spike
description: PR #7 (TASK-008 SPK-03 RLS/Prisma spike) review 2026-11-12 PASS_WITH_FOLLOW-UPS; verified PG/Prisma/pg/RDS Proxy facts (non-strict set_config, self ALTER ROLE SET, P2039, errorFormat) and binding conditions for TASK-016/051/024/006/010
metadata:
  type: project
---

The PR #7 review (TASK-008, head `985a552`) is in `docs/05-quality/security/PR-0007-TASK-008-security-review.md`. IDs are PR7-SEC-01..10. Verdict PASS_WITH_FOLLOW-UPS: 01 MEDIUM; 02–08 LOW; 09–10 INFO. GO is sound for the in-process pg pool on direct connections, but conditional on TASK-016 implementing 01, 02 and 05 (review §5).

**Facts verified 2026-11-12 (PG `REL_18_STABLE` source; `@prisma/*` 7.10.1; pg 8.23.1). Re-verify after upgrades.**
- **`set_config` is `proisstrict 'f'`** (`guc_funcs.c:347-368`).
  - A NULL value means RESET to the session reset value.
  - A NULL `is_local` means **session scope**.
- **Placeholders and role settings.** `app.*` placeholders start with a NULL reset value. A `pg_db_role_setting` entry for a placeholder needs superuser or `SET ON PARAMETER`, so `platform_app` cannot persist `app.*`.
- **Self `ALTER ROLE`.** Any role CAN run `ALTER ROLE self [IN DATABASE] SET/RESET` on USERSET GUCs (`user.c:1038-1040`): `lock_timeout`, `idle_in_transaction_session_timeout`, `search_path`, `default_transaction_read_only`.
- **pg reads `PGOPTIONS`.** `pg` falls back to `PGOPTIONS` when `config.options` is falsy, and `''` does not override it.
- **Prisma error paths.**
  - A raw-query DB error becomes P2010; a model-operation error of kind `postgres` becomes **P2039**. Both put the DB message into `error.message`.
  - adapter-pg always sets `originalCode`. For mapped kinds (40001/40P01/23505/22P02…) it omits `code`. The default kind carries `detail`/`hint`.
  - Prisma uses `errorFormat` `minimal` only when `NODE_ENV==='production'`. This project uses `APP_ENV`.
- **Transaction client.** The ITX deny list is only `$connect,$disconnect,$on,$use,$extends`. A nested `tx.$transaction` is a savepoint named `prisma_sp_<n>`.
- **RDS Proxy (PostgreSQL)** pins on `SET`/`set_config`, and does NOT detect state changes made inside functions. It has no session pinning filters for PostgreSQL.
- **RLS on UPDATE.** The new row must pass the permissive WITH CHECK policies, OR-ed together, plus the SELECT `USING` policies when the `WHERE` needs SELECT rights. As a result, a GUEST_CAPABLE "de-claim" (org → guest) passes under the claim context.

**Pending ADR-0005 amendment 10 (D-ARCH-058).** It was uncommitted in the main tree at review time and makes F-01..F-13 binding. Review §4a lists the deltas sent to principal-architect:
- item 2 is lint-only;
- item 6 covers P2010 + `cause.code` only;
- item 4 says nothing about NULL / `is_local`;
- the C-1 text conflicts with the spike's `:618` assertion.

When the amendment lands, check that these deltas were applied.

**Code-review m3 guard and my re-entrance guard.** A `$extends` guard on the root client is inherited by its transaction clients. So `withTenantTx` must call `$transaction` on a separate unguarded private client.

**Why:** RLS is the O3 control. The spike's consumer guidance (F-02, F-06, F-07, F-01) understated these hazards, and TASK-016 will build `withTenantTx` from it.

**How to apply.** In these reviews, check:
- **TASK-016:**
  - **PR7-SEC-01:** no exported client; an AsyncLocalStorage re-entrance guard (`NESTED_TENANT_TX`); SYSTEM-table writers typed on `TenantDb`; P2028 → 503; AT-US-075-04 as a run-time throw.
  - **PR7-SEC-02:** literal `true` in the SQL text; string-only, validated values (no NULL, `undefined` or `Prisma.Sql`); a fresh-connection NULL probe; the factory refuses `PGOPTIONS`; C13 finds no `app.%` in `pg_db_role_setting` or `pg_parameter_acl`; a session-scope negative-control test.
  - **PR7-SEC-05:** a `TenantDb` Proxy that hides `$transaction`/`*Unsafe`; the token ban list, with exact-file test exemptions; a `prosrc` scan for `set_config`/`SET` on `app.*`.
  - **PR7-SEC-06:** `lock_timeout` and idle timeout set per transaction; C13 asserts `platform_app`'s settings rows.
  - **PR7-SEC-07:** a predicate allow-list plus a C3 scan for forbidden tokens.
  - **PR7-SEC-03:** `mapDbError` keyed on `originalCode`; `errorFormat: 'minimal'`.
  - **PR7-SEC-09:** a definer-ownership linter rule.
- **TASK-051:** a one-way ownership trigger on the four GUEST_CAPABLE tables, with a de-claim negative test (PR7-SEC-04). `guest_token_hash` is set only on guest and claim routes.
- **TASK-024:** C12 guest-row probes.
- **TASK-006 / TASK-010:** no `message`/`detail`/`meta` in problem+json or in logs; a readiness drift check on `pg_db_role_setting`.
- **G4-production / platform-architect:** re-run SPK-03 (a)/(b) through any pooler (PR7-SEC-08); measure RDS Proxy pinning (C-2).
- **PR7-SEC-10:** the spike file is deleted or ported after C-1. Any lint exemption for it must name the exact file and have an expiry.

Related: [[project-p5-wave0-db-baseline]], [[project-p5-wave0-config-review]], [[project-p3-security-conditions]], [[project-security-review-conventions]]
