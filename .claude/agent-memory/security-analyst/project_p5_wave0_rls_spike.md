---
name: project-p5-wave0-rls-spike
description: PR #7 (TASK-008 SPK-03 RLS/Prisma spike) R1+R2 PASS_WITH_FOLLOW-UPS (2026-11-12); verified PG/Prisma/pg/RDS Proxy facts; ADR-0005 am. 10 status; binding checks for TASK-016/051/024/006/010
metadata:
  type: project
---

PR #7 (TASK-008) review: `docs/05-quality/security/PR-0007-TASK-008-security-review.md`. R1 @`985a552`, R2 @`065aa3e` (code delta `c21485d..518d281`), both PASS_WITH_FOLLOW-UPS. IDs PR7-SEC-01..14: 01 MEDIUM; 02–08 + 11 LOW; 09, 10, 12–14 INFO. GO holds for the in-process pg pool on direct connections, conditional on TASK-016 implementing review §5 + PR7-SEC-11.

**Facts verified 2026-11-12 (PG `REL_18_STABLE`; `@prisma/*` 7.10.1; pg 8.23.1). Re-verify after upgrades.**
- `set_config` is `proisstrict 'f'`: NULL value = RESET to the session reset value; NULL `is_local` = **session scope**.
- `app.*` placeholders start with a NULL reset value; `platform_app` cannot persist `app.*` in `pg_db_role_setting` (needs superuser or `SET ON PARAMETER`) but CAN `set_config(…, false)` and it leaks (proven by the R2 negative control).
- `SET LOCAL`/`set_config(…, true)` reverts to the **session** value, so `withTenantTx` masks a leaked value only for its own tx; a fresh-connection probe cannot see mid-life leaks.
- adapter-pg `commit()`/`rollback()` just `client.release()` (no reset), `dist/index.mjs:676-684`.
- Self `ALTER ROLE self SET` works on USERSET GUCs. `platform_app` has NO role-level `statement_timeout` (00-roles.sql:55-57 sets only search_path, idle-in-tx 15s, lock_timeout 2s).
- pg falls back to `PGOPTIONS` when `config.options` is falsy.
- Prisma: raw error P2010, model error **P2039**; adapter omits `code` for mapped kinds (use `originalCode`); `errorFormat` minimal only when `NODE_ENV==='production'`. ITX deny list `$connect,$disconnect,$on,$use,$extends`; nested `tx.$transaction` = savepoint `prisma_sp_<n>`. After maxWait abort, the pending checkout stays queued and is rolled back later.
- RDS Proxy (PostgreSQL) pins on `SET`/`set_config`, does not detect state changes inside functions.
- RLS UPDATE: new row must pass OR-ed permissive WITH CHECK (+ SELECT USING) → GUEST_CAPABLE de-claim possible. Out-of-context UPDATE/DELETE = 0 rows silently (not 42501).

**ADR-0005 am. 10 landed on main (`151add9`).** All four R1 §4a gaps applied (item 2 runtime guard, item 4 NULL/is_local, item 6 originalCode, C-1 text). Residual text defects raised in R2: item 1 `prosrc` scan says "non-platform functions" (PR7-SEC-11 LOW, scan by form incl. `platform`); item 2 "(existing lint rule)" is false; item 4 negative-control sentence inverted; item 12 lists a non-existent role `statement_timeout`; item 11 / data-model §4.3 trigger narrower than `IS DISTINCT FROM`; data-model §4.5 `job_context` block still OWNER-before-GRANT (PR7-SEC-12).

**Why:** RLS is the O3 control; TASK-016 builds `withTenantTx` from SPK-03 + am. 10, so text defects there become code defects.

**How to apply — check at these reviews:**
- **TASK-016:** §5 list (no exported client; `NESTED_TENANT_TX`; SYSTEM writers on `TenantDb`; P2028→503; literal `true` + validated strings; fresh-connection probe; factory refuses `PGOPTIONS`; C13 no `app.%`; session-scope negative control kept; Proxy hiding `$transaction`/`*Unsafe`; token ban with exact-file exemptions; per-tx lock/idle/statement timeouts; predicate allow-list + C3; `mapDbError` on `originalCode`; `errorFormat: 'minimal'`; rule 15). Plus R2: prosrc scan covers `platform` by form (11); state-transition repos assert affected-row count (13); optional MATERIALIZED-CTE leak detector (14); spike file ported then deleted, C-1 recorded with `SPK03_BENCH=1`.
- **TASK-051:** de-claim trigger (`GUEST_DECLAIM_FORBIDDEN`), ideally `IS DISTINCT FROM` forms, tested as superuser too.
- **TASK-006** (dispatched before D-ORCH-011; sheet lacks items): never echo DB message/detail/meta; `errorFormat: 'minimal'`; readiness drift on `pg_db_role_setting`. **TASK-010:** Prisma error serializer `{name, code, originalCode, kind}`. **TASK-024:** C12 guest-row probes. None are on their WAVE sheets — check in dispatch/review.
- **G4-production / platform-architect:** re-run SPK-03 (a)/(b) through any pooler (PR7-SEC-08); measure RDS Proxy pinning (C-2).

Related: [[project-p5-wave0-db-baseline]], [[project-p5-wave0-config-review]], [[project-p3-security-conditions]], [[project-security-review-conventions]]
