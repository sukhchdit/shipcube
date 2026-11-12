# ADR-0005: Tenancy model and PostgreSQL row-level security

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect, data-architect
- **Related:** brief §3.3 (RLS applicable), §4.2, §4.10; REQ-RLS-001..013, REQ-ORG, DR-A06, DR-A14, DR-A15, DR-A17; NFR-TENANT-001/002, NFR-SEC-011; A-042, A-055; ADR-0007 (audit), ADR-0008 (RBAC)

## Context

Every tenant-owned row carries `org_id`; the API must set `app.org_id`/`app.actor_id` with `SET LOCAL` inside each request transaction via a Prisma client extension; operator staff reach other tenants through an explicit audited policy; guest quotes exist before an account does (D-009) and must be reachable only by an unguessable token (A-055); integration tests must prove zero cross-tenant reads/writes. The official Prisma RLS example (github.com/prisma/prisma-client-extensions/row-level-security, checked 2026-11-12) wraps every query in a batch transaction with `SELECT set_config('app.current_company_id', $1, TRUE)`, and warns that explicit `$transaction` calls inside such an extension behave unexpectedly. Prisma 7 removed the Rust engine and uses driver adapters (`@prisma/adapter-pg`); interactive transactions remain available.

## Decision

### Tenant model

- `organisations.type ∈ {OPERATOR, BUSINESS_CUSTOMER, PARTNER, INDIVIDUAL}`; exactly one OPERATOR org; each user owns one INDIVIDUAL org; memberships carry roles (ADR-0008). Every authenticated request has exactly one **active organisation** (claim `org` in the access token; switch via `POST /auth/switch-organisation`, which re-issues tokens after checking an ACTIVE membership).
- Table classes: `TENANT` (`org_id NOT NULL`), `GUEST_CAPABLE` (`org_id NULL` allowed: `quotes`, `quote_packages`, `quote_options`, `quote_shares`), `USER_OWNED` (`users`, `sessions`, `refresh_tokens`, `mfa_*`, `notification_preferences` keyed by `user_id`), `GLOBAL` (reference data, roles/permissions, compliance packs, FX, feature flags, number sequences — read-only at runtime, no RLS), `SYSTEM` (`outbox_events`, `processed_events`, `idempotency_keys`, `audit_*` — no RLS; access only through platform code with explicit scoping columns).

### Transaction-scoped context (replaces "SET LOCAL" literally with its `set_config` equivalent)

All database access of a request or job runs inside `withTenantTx(ctx, fn)`:

```sql
SELECT set_config('app.org_id',          $1, true),   -- '' when none (guest/public)
       set_config('app.actor_id',        $2, true),   -- user id | system user id | '' anonymous
       set_config('app.actor_scope',     $3, true),   -- 'TENANT' | 'OPERATOR'
       set_config('app.guest_token_hash',$4, true);   -- hex sha256 of guest quote token, or ''
```

`set_config(..., true)` is transaction-local (equivalent to `SET LOCAL`), so pooled connections cannot leak context (REQ-RLS-003). The wrapper opens a Prisma **interactive transaction**, runs the statement above first, then passes the transaction client to repositories. Repositories receive only this handle (type `TenantDb`); the root `PrismaClient` is not exported outside `apps/api/src/platform/db` (lint rule). The Prisma client extension is used for soft-delete filtering and standard-column stamping, **not** for RLS (avoids the documented nested-transaction caveat). Workers set the same context from job payloads and fail non-retryably without a valid `org_id` when touching tenant data (REQ-RLS-008).

### Policies (templates; full SQL in data-model.md)

```sql
ALTER TABLE t ENABLE ROW LEVEL SECURITY; ALTER TABLE t FORCE ROW LEVEL SECURITY;
-- TENANT tables
CREATE POLICY t_tenant ON t FOR ALL TO platform_app
  USING (org_id = app_org_id())            -- app_org_id() = NULLIF(current_setting('app.org_id', true),'')::uuid
  WITH CHECK (org_id = app_org_id());
CREATE POLICY t_operator ON t FOR ALL TO platform_app
  USING (current_setting('app.actor_scope', true) = 'OPERATOR')
  WITH CHECK (current_setting('app.actor_scope', true) = 'OPERATOR');
-- GUEST_CAPABLE tables add:
CREATE POLICY t_guest ON t FOR ALL TO platform_app
  USING (org_id IS NULL AND guest_token_hash = app_guest_token_hash())
  WITH CHECK (org_id IS NULL AND guest_token_hash = app_guest_token_hash());
```

Permissive policies OR together. An unset or invalid `app.org_id` yields NULL comparisons → zero rows and rejected writes (REQ-RLS-004). `WITH CHECK` prevents writing a foreign `org_id` even if the application is buggy (mass assignment defence, NFR-SEC-011).

**Operator cross-tenant scope (DR-A15).** `app.actor_scope = 'OPERATOR'` is set by the server only when (a) the actor has an ACTIVE membership in the OPERATOR org and (b) the route's metadata declares `tenancy: 'operator-cross-tenant'` (in M1: the audit viewer only). The audit entry stores `target_org_id` (REQ-RLS-006). Client input can never set it (it is not a header or body field; a test asserts a customer member never obtains it).

**Guest rows (A-055, REQ-RLS-013).** `POST /quotes` as a guest creates the row with `org_id NULL` and `guest_token_hash = sha256(token)`; the 256-bit token is returned once and sent back as `X-Quote-Token`. Claiming (first `POST /quotes/{id}/claim` or booking by an authenticated account) runs, with both `app.org_id` and `app.guest_token_hash` set: `UPDATE quotes SET org_id = app_org_id(), claimed_by_user_id = app_actor_id(), claimed_at = now(), guest_token_hash = NULL WHERE id = $1 AND org_id IS NULL`. The guest policy admits the row for `USING`; the tenant policy admits the new values for `WITH CHECK`. Zero rows → the service re-reads under its own org scope: visible → already claimed by this org (idempotent 200); not visible → 409 `QUOTE_ALREADY_CLAIMED` if the quote exists for another org (detected via a SECURITY DEFINER helper `quote_claim_state(id)` returning only `CLAIMED_ELSEWHERE | UNKNOWN`), else 404. Share links use `quote_shares.share_token_hash` with the same branch pattern and a projection view that strips personal data (DR-B31 analogue).

**USER_OWNED tables (DR-A14).** Policy `user_id = app_actor_id()` OR operator scope; memberships additionally readable by members of the same org (`org_id = app_org_id()`).

### Roles

`platform_app` (runtime): `NOSUPERUSER NOBYPASSRLS NOCREATEDB`, not the owner; `SELECT/INSERT/UPDATE` on tenant tables, **no `DELETE`** on soft-deletable tables, `INSERT/SELECT` only on audit tables, `DELETE` only on the hard-delete allow-list. `platform_migrator`: owner, runs migrations and seed only; never used by api/worker (REQ-RLS-005). Tests read `pg_roles`/`pg_class.relrowsecurity`/`relforcerowsecurity` and `information_schema.role_table_grants`.

### Cross-tenant 404 (A-042)

A crafted foreign ID is invisible under RLS, so the API answers 404 `NOT_FOUND`; no `PERMISSION_DENIED` audit entry can be written for an invisible row. The platform counts 404s per actor per minute and emits `cross_tenant_probe` (security log) above 20/min (REQ-SEC-012).

## Alternatives considered

- **Schema-per-tenant or database-per-tenant.** Strong isolation but thousands of INDIVIDUAL orgs make it unmanageable with Prisma migrations; rejected.
- **Application-level filtering only.** One missed `where` leaks data; brief §3.3 makes RLS mandatory.
- **RLS via Prisma query extension wrapping every call in a batch transaction** (official example). Rejected for the nested-transaction caveat and because the audit entry and outbox must share the business transaction anyway; the explicit `withTenantTx` makes the transaction boundary visible.
- **`BYPASSRLS` role for operator staff.** Rejected by brief §4.10 ("not by bypassing RLS globally"); the explicit policy branch is audited per route.
- **Guest quotes stored outside the tenant tables (Redis only).** Rejected: quotes must survive 24 h, be shareable and be claimed atomically; A-055's nullable-`org_id` pattern keeps one table.

## Consequences

- Positive: defence in depth (RLS + authz + validation); operator access is explicit and audited; one transaction per request simplifies audit atomicity.
- Negative: every repository call needs the transaction handle (enforced by types); `set_config` adds ~0.2 ms per transaction; policies must be re-generated for every new tenant table (data-model.md provides the template and a catalog test fails on omissions).
- Verification: generated RLS tests per table and per route (REQ-RLS-007, NFR-TENANT-001), raw-connection fail-closed test (REQ-RLS-004), guest/claim race test, operator-scope negative test, role attribute test.

## Amendments after the threat model (2026-11-12, threat-model.md R-01..R-04, T-32, T-37)

1. **Pre-authentication and cross-tenant lookups have an explicit, narrow access path (R-01).** Code paths that must read rows before a tenant/actor context exists — login by e-mail, refresh-token and one-time-token redemption (verify, reset, invitation, MFA challenge), public tracking lookups, shared-quote resolution, gateway-reference lookup for webhooks, carrier push matching, the payment sweeper and the tracking poll planner — never use the migrator role, `BYPASSRLS` or broad policies. Two mechanisms only:
   - **Allow-listed `SECURITY DEFINER` functions** owned by `platform_migrator`, each returning a fixed, minimal column set and taking a hashed/opaque key (`auth_lookup_user_by_email(email) → (user_id, status)`, `auth_lookup_credential(user_id)`, `auth_lookup_refresh_token(token_hash) → (token_id, family_id, session_id, user_id, status, expires_at)`, `auth_lookup_one_time_token(purpose, token_hash)`, `invitation_lookup(token_hash)`, `payment_lookup_by_gateway_ref(gateway, ref) → (payment_id, org_id)`, `quote_share_resolve(share_token_hash) → projection without personal data`). Each function is listed in `data-model.md §4.5`, has a dedicated test, and `platform_app` has `EXECUTE` on these only. After the lookup resolves the actor/org, the same transaction sets `app.actor_id`/`app.org_id` and continues under normal policies.
   - **Global index tables without personal data** (`tracking_index(tracking_number, order_number, shipment_id, org_id, carrier_code)`, `gateway_refs(gateway, gateway_ref, payment_id, org_id)`, `tracking_poll_schedule(shipment_id, org_id, next_poll_at, interval_class)`), maintained in the same transaction as their source rows; the worker iterates `org_id`s from them and then sets tenant context per organisation (REQ-RLS-008).
2. **Operator branch is read-only in M0/M1 and checks membership in the database (R-02).** `t_operator` policies are `FOR SELECT` only this run (the only cross-tenant route is the audit viewer); `USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND app_is_operator())`, where `app_is_operator()` is a `STABLE SECURITY DEFINER` function verifying an `ACTIVE` membership of `app_actor_id()` in the OPERATOR organisation. Write-capable operator branches arrive with M2 features through superseding migrations.
3. **Tenant context comes only from the token (R-03, T-32).** `app.org_id` is always the access token's active organisation; a path `{orgId}` that differs from it yields 404 `NOT_FOUND` before any query (operator cross-tenant routes carry the target organisation explicitly and are audited). A user who is Admin in A and Viewer in B must switch organisation (new token) to act in B.
4. **Guest claim re-scopes child rows; per-user policies for user-private data (R-04).** The claim transaction updates `quotes`, `quote_packages`, `quote_options` and `quote_shares` (`org_id`, `guest_token_hash = NULL`) atomically. `saved_payment_methods`, `notification_preferences`, `notification_log` and `sessions` are `USER_OWNED` (policy `user_id = app_actor_id()` within the org) so organisation members cannot read each other's private data.
5. **Operator scope only in the admin app (R-08 part).** The OPERATOR organisation can be the active organisation only for tokens with `app = admin`; the customer app never obtains operator scope.
6. **Roles refined (data-model.md §12, 2026-11-12).** The SECURITY DEFINER lookup functions are owned by a dedicated `NOLOGIN` role **`platform_definer`** (no table ownership, no DDL) that holds only the narrow policies and grants those functions need (SELECT on the tables they read; DELETE with an expiry predicate on token tables for `purge_expired_tokens()`); `platform_migrator` has no runtime policies; `platform_app` has EXECUTE on the functions only. Vault and erasure-scoped hard deletes belong to a separate **`platform_erasure`** role used only by the M4/M5 erasure job. `app_org_id()` returns NULL (zero rows) on a malformed setting instead of raising. `quote_claim_state(id, guest_token_hash)` requires the guest token hash so claim state cannot be probed by ID. Revoking another user's sessions writes the Redis revocation set synchronously (≤ 5 s, REQ-AUTH-009) and updates `sessions` in a worker job scoped to that user.

## Reversibility

Medium: policies and roles are migrations; the `withTenantTx` boundary is pervasive but mechanical.
