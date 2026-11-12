# ADR-0008: RBAC permission catalogue, roles as data and generated matrix tests

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §4.2, §11; REQ-RBAC-001..014, DR-A07, DR-A08; NFR-TENANT-002, NFR-SEC-011; ADR-0003 (route metadata), ADR-0005 (RLS)

## Context

Permissions are fine-grained strings declared once in `packages/authz`; roles are named sets editable by administrators (M2) and seeded now (operator 8, customer 5, partner 4); every route declares its permission; a generated test asserts allow/deny for every route × role plus unauthenticated and cross-tenant cases; permissions must be resolved server-side per request so changes apply within 5 s.

## Decision

1. **Catalogue.** `packages/authz/src/permissions.ts` exports `PERMISSIONS` as a readonly tuple of `{ key: 'resource:action[:qualifier]', description, category, operatorOnly: boolean }` and the type `Permission = typeof PERMISSIONS[number]['key']`. Every reference in code (`defineRoute`, UI gating helper) is typed against `Permission`, so an unknown string fails type-check (REQ-RBAC-001). Format test: `^[a-z_]+:[a-z_]+(:[a-z_]+)?$`, uniqueness. Operator-only permissions: any `:any_org` qualifier, `audit:*`, `featureflag:manage`, `carrier:status:read` (DR-A07). Special markers `public` and `authenticated` are not permissions; they live in route metadata with a justification.
2. **Roles as data.** `roles(id, org_type, key, name, is_system)` and `role_permissions(role_id, permission_key)` (GLOBAL tables) seeded idempotently from `packages/authz/src/roles.seed.ts` (single source; the role–permission matrix document `docs/03-architecture/rbac-matrix.md` is generated from it in P5). Role changes in this run happen only by seed/migration and are audited as `CONFIG_CHANGE` by the system actor (REQ-RBAC-013). Partner roles are seeded without users (REQ-RBAC-003).
3. **Invariants test (build-time, REQ-RBAC-004):** Super Admin = full catalogue; Compliance Auditor ⊆ `*:read ∪ audit:*`; customer Viewer has no create/update/delete/manage; no customer/partner role holds an operator-only permission; every permission referenced by any route exists; every catalogue permission is held by at least one role or is explicitly marked `reserved` (seams such as `refund:approve`, `audit:export`, `shipment:create:on_behalf`).
4. **Resolution per request (REQ-RBAC-008).** `authorise()` loads the actor's ACTIVE membership in the token's active org and its roles → permission set; cached in Redis `authz:perms:<membership_id>` with TTL 5 s and invalidated on membership change. Order: authenticate → MFA gate → authorise → rate-limit → validate (DR-A08), so denied callers learn nothing about schemas. Denial → 403 `AUTHZ_DENIED` + audit `PERMISSION_DENIED` (route template, required permission) + security event `permission_denied`. `GET /me` returns the effective permission list for UI gating (REQ-RBAC-009); the UI helper `can(permission)` hides controls from the accessibility tree; route guards show the permission-denied state without fetching (REQ-RBAC-010). Download/export routes carry their own `*:download`/`*:export` permission checked before any URL is issued (REQ-RBAC-012).
5. **Matrix generator (REQ-RBAC-011).** `packages/authz/src/testing/matrix.ts` reads the route registry + role seed and emits Jest cases: for each route × seeded role → expect 2xx/other (allow) or 403 `AUTHZ_DENIED` (deny); for each protected route → 401 `AUTH_REQUIRED` unauthenticated; for each route with a tenant-owned `:id` → 404 for a foreign ID; staff routes → 403 `MFA_ENROLMENT_REQUIRED` for an un-enrolled staff session. Routes supply a `fixture` factory in metadata (`matrixFixture`) that creates a minimal valid request per role/tenant; a route without a fixture fails the generator ("not covered"). Run in CI; coverage count reported (NFR-TENANT-002).
6. **Seam for M2/M3.** Role editor and signed role changes (`reasonRequired`), API-key scopes (`API_KEY` actor with a permission subset), on-behalf (`shipment:create:on_behalf` + `on_behalf_of_org_id`) are catalogue entries now and features later.

## Alternatives considered

- **Permissions in the JWT.** Faster but violates REQ-RBAC-008 (5 s propagation) and bloats tokens.
- **Attribute-based policies (OPA/Cedar).** More expressive than needed for M1; the string catalogue + RLS covers tenant scoping; revisit if partner sub-account rules (M3) outgrow role sets.
- **Hand-written authz tests per route.** Rejected: the generated matrix is the brief's requirement and guarantees coverage as routes are added.

## Consequences

- Positive: a single typed catalogue; roles are data; coverage is mechanical; denial is audited.
- Negative: every route needs a matrix fixture (small, but mandatory — included in the task DoD); the 5 s cache means a revoked member keeps access for up to 5 s (accepted by REQ-RBAC-008).

## Amendment (2026-11-12, api-designer handback): catalogue additions and audit action enum

- Accepted into the catalogue: `carrier:status:read` (operator-only; `GET /carriers/status`, A-074) and `webhook:mock_gateway:receive` (signature-authenticated, non-production only; mirrors `webhook:stripe:receive`). Both are seeded: `carrier:status:read` to Super Admin, Admin, Operations, Support, Compliance Auditor; webhook permissions are held by no role (signature actor).
- `POST /shipments/{id}/tracking/refresh` declares `shipment:create` (one permission per route); the role-seed invariant test asserts every holder of `shipment:create` also holds `tracking:read` (A-074).
- Audit action enum (`packages/shared`, ADR-0007) gains `MFA_RECOVERY_USED` and `SESSION_REVOKED`, which DR-B28 references but REQ-AUDIT-002 omits — product-manager to add them to REQ-AUDIT-002.

## Reversibility

High (data + generator).
