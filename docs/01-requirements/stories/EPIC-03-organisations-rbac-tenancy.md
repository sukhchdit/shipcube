# EPIC-03 — Organisations, RBAC and tenant isolation

- **Goal:** Every request is evaluated in exactly one organisation, with server-resolved permissions declared on every route, and no tenant can ever read or write another tenant's data.
- **Milestone(s):** M0+M1
- **REQ areas covered:** REQ-ORG, REQ-RBAC, REQ-RLS (every REQ in these areas is linked by at least one story below)
- **Exit-demo contribution:** PRD §6.1 M0 exit demo: seeded roles and memberships, permission on every route with build-time metadata test, RBAC matrix generator passing, RLS isolation, both app sign-ins landing in the right organisation. M1: customer-organisation team management (D-028) and download/export permissions.
- **Depends on epics:** EPIC-01 (PLAT: Postgres, migrations, route registry, worker, scheduler), EPIC-02 (AUTH/ADMIN: sign-in, access token, sessions), EPIC-04 (audit writer for `PERMISSION_DENIED` and mutations), EPIC-16 (API: problem+json, ETag/If-Match, `UNKNOWN_FIELD` validation), EPIC-17 (DATA: seed)

## Story summary

| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs |
|---|---|---|---|---|---|---|
| US-061 | Organisation types and the single operator organisation | M0 | Must | S | EPIC-01 | REQ-ORG-001 |
| US-062 | Personal organisation and memberships with type-checked roles | M0 | Must | M | US-061, US-066, EPIC-02 | REQ-ORG-002, REQ-ORG-003, REQ-ORG-004 |
| US-063 | Active organisation context and `GET /api/v1/me` | M0 | Must | M | US-062, EPIC-02 | REQ-ORG-005 |
| US-064 | Server-controlled standard columns, UTC time and the on-behalf seam | M0 | Must | M | EPIC-01, EPIC-16 | REQ-RLS-009, REQ-RLS-012, REQ-ORG-007 |
| US-065 | Typed permission catalogue | M0 | Must | S | EPIC-01 | REQ-RBAC-001, REQ-RBAC-014 |
| US-066 | Seeded roles, role-permission matrix document and privilege-escalation guard test | M0 | Must | M | US-065, EPIC-17 | REQ-RBAC-002, REQ-RBAC-003, REQ-RBAC-004 |
| US-067 | Mandatory route metadata with build-time route test | M0 | Must | M | US-065, EPIC-04, EPIC-16 | REQ-RBAC-005 |
| US-068 | Request pipeline order, 401/403 outcomes and live permission resolution | M0 | Must | M | US-063, US-066, US-067 | REQ-RBAC-006, REQ-RBAC-008 |
| US-069 | Permission-denied audit and cross-tenant 404 | M0 | Must | S | US-068, US-075, EPIC-04 | REQ-RBAC-007 |
| US-070 | Permission-aware UI helper and frontend route guard | M0 | Must | M | US-063, EPIC-05 | REQ-RBAC-009, REQ-RBAC-010 |
| US-071 | RBAC matrix test generator | M0 | Must | M | US-066, US-067, US-077 | REQ-RBAC-011 |
| US-072 | Download and export routes with their own permission | M1 | Must | S | US-068, EPIC-04 | REQ-RBAC-012 |
| US-073 | Role definitions change only via versioned migration | M0 | Should | S | US-066, EPIC-04 | REQ-RBAC-013 |
| US-074 | RLS enabled and forced on every tenant-owned table, separate DB roles | M0 | Must | M | EPIC-01 | REQ-RLS-001, REQ-RLS-002, REQ-RLS-005 |
| US-075 | Per-transaction tenant context with SET LOCAL and fail-closed default | M0 | Must | S | US-074 | REQ-RLS-003, REQ-RLS-004 |
| US-076 | Operator cross-tenant scope | M0 | Must | S | US-075, US-066 | REQ-RLS-006 |
| US-077 | Generated cross-tenant isolation tests | M0 | Must | M | US-074, US-075, US-067 | REQ-RLS-007 |
| US-078 | Tenant context in worker jobs | M0 | Must | S | US-075, EPIC-01 | REQ-RLS-008 |
| US-079 | Soft delete and optimistic locking | M0 | Must | M | US-064, EPIC-16 | REQ-RLS-010, REQ-RLS-011 |
| US-080 | Guest-capable tables and atomic claim | M0 | Must | S | US-074 | REQ-RLS-013 |
| US-081 | Switch active organisation | M1 | Should | S | US-063 | REQ-ORG-006 |
| US-082 | Organisation profile and creating a business organisation | M1 | Should | M | US-062, US-079 | REQ-ORG-008, REQ-ORG-009 |
| US-083 | Invite members into a business organisation | M1 | Should | M | US-062, EPIC-15 | REQ-ORG-010 |
| US-084 | Accept an invitation | M1 | Should | S | US-083, EPIC-02 | REQ-ORG-011 |
| US-085 | Manage members, last-Owner and individual-organisation safeguards | M1 | Should | M | US-062, US-068 | REQ-ORG-012, REQ-ORG-013, REQ-ORG-014 |

## Stories

### US-061 — Organisation types and the single operator organisation
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** EPIC-01
- **Linked REQs:** REQ-ORG-001
- **As a** platform operator **I want** organisations to have an immutable type with exactly one `OPERATOR` organisation **so that** tenancy and role scoping cannot be subverted.
- **Notes:** Partner onboarding is M3; no API creates `PARTNER` or a second `OPERATOR`. Invariants in DR-A06.

#### Acceptance criteria
```gherkin
Feature: Organisation types
  Scenario: Seed creates exactly one OPERATOR organisation
    Given an empty database When the reference seed runs twice
    Then exactly 1 organisation has type "OPERATOR" and the row count is identical after the second run

  Scenario: Creating a PARTNER or second OPERATOR organisation is refused
    Given an authenticated user When they POST an organisation with type "PARTNER" (or "OPERATOR")
    Then the response is 422 problem+json with code "ORG_TYPE_NOT_ALLOWED" and no row is created

  Scenario: Type is immutable
    Given a BUSINESS_CUSTOMER organisation When any update tries to set type "INDIVIDUAL"
    Then the request is rejected with 400 "VALIDATION_ERROR" sub-code "UNKNOWN_FIELD" and a database-level check also rejects a direct SQL update of type

  Scenario: Unauthenticated organisation creation
    When an anonymous client POSTs an organisation Then the response is 401 "AUTH_REQUIRED"

  Scenario: Audit of a refused attempt
    Given an authenticated user attempts to create type "PARTNER"
    Then an audit entry exists with outcome "FAILED", action "CREATE", entity "organisation", written in a separate transaction
```

### US-062 — Personal organisation and memberships with type-checked roles
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-061, US-066, EPIC-02
- **Linked REQs:** REQ-ORG-002, REQ-ORG-003, REQ-ORG-004
- **As a** registering individual **I want** my own personal organisation and role-checked memberships **so that** I can book immediately and be added to other organisations later.
- **Notes:** Membership statuses and transitions per DR-A05. Re-adding a removed member creates a new row.

#### Acceptance criteria
```gherkin
Feature: Personal organisation and memberships
  Scenario: Registration creates a personal organisation in the same transaction
    Given a new visitor registers with display name "Asha Rao"
    Then an organisation of type "INDIVIDUAL" named "Asha Rao" exists with one ACTIVE membership holding role "Owner" for that user
    And if the user insert is forced to fail, no organisation row exists

  Scenario: Role must belong to the organisation type
    Given a BUSINESS_CUSTOMER organisation When a membership is assigned the operator role "Support"
    Then the response is 422 "ROLE_NOT_ALLOWED_FOR_ORG_TYPE" and no membership changes

  Scenario: Duplicate non-removed membership is refused
    Given user U is ACTIVE in organisation O When a second membership for (U, O) is inserted
    Then the unique constraint rejects it; and after U's membership is REMOVED a new membership row for (U, O) is accepted and the old row remains

  Scenario: Personal organisation cannot be deleted while the user is active
    Given an ACTIVE user with a personal organisation When a delete of that organisation is attempted
    Then it is refused and the organisation remains

  Scenario: Permission denied on assigning roles
    Given a caller holding only the customer role "Viewer" When they assign a role to a membership
    Then the response is 403 "AUTHZ_DENIED" and a "PERMISSION_DENIED" audit entry exists

  Scenario: Audit of membership change
    When a membership is created or its status changes
    Then one audit entry records entity "membership", the old/new status and role set diff, in the same transaction
```

### US-063 — Active organisation context and `GET /api/v1/me`
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-062, EPIC-02
- **Linked REQs:** REQ-ORG-005
- **As a** signed-in user **I want** every request evaluated in one active organisation and my memberships and permissions returned by `/me` **so that** I act with the right rights in the right tenant.
- **Notes:** Login chooses last-used active organisation, else personal. Removal effect within 5 s (see US-068).

#### Acceptance criteria
```gherkin
Feature: Active organisation context
  Scenario: /me returns memberships, active organisation and effective permissions
    Given the seeded customer Owner of "Acme Exports" is signed in
    When they GET /api/v1/me
    Then the response is 200 and lists memberships, activeOrganisation "Acme Exports" and the Owner permission list

  Scenario: Login selects last-used organisation, else personal
    Given a user whose last-used organisation is "Acme Exports" When they sign in Then the token's active organisation is "Acme Exports"
    And a user with no last-used organisation gets their INDIVIDUAL organisation

  Scenario: Token whose organisation has no ACTIVE membership
    Given a valid access token naming organisation O and the user's membership in O is REMOVED
    When the user calls any protected route Then the response is 403 "AUTHZ_DENIED"

  Scenario: Unauthenticated /me
    When an anonymous client calls GET /api/v1/me Then the response is 401 "AUTH_REQUIRED"

  Scenario: Audit of /me
    When /me is called Then one "VIEW" entry for entity "user_profile" with outcome "SUCCESS" is recorded (sensitive entity, fail-closed per US-089)
```

### US-064 — Server-controlled standard columns, UTC time and the on-behalf seam
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-01, EPIC-16
- **Linked REQs:** REQ-RLS-009, REQ-RLS-012, REQ-ORG-007
- **As a** developer **I want** every table to carry server-set standard columns and UTC timestamps, and `on_behalf_of_org_id` reserved but unusable **so that** records are uniformly attributable and clients cannot forge identity.
- **Notes:** `id` is UUIDv7. System user ID is reserved for seed and jobs. `on_behalf_of_org_id` always null in this run (DR-A06).

#### Acceptance criteria
```gherkin
Feature: Standard columns and time handling
  Scenario: Server sets columns on create
    When an authenticated user creates any record
    Then the row has a time-ordered UUIDv7 "id", "created_at"=="updated_at", "created_by"= caller, "version"=1 and "on_behalf_of_org_id" null

  Scenario: Seed and system-job writes use the reserved system user
    When the seed or a SYSTEM_JOB inserts a row Then created_by equals the reserved system user ID

  Scenario: Client-supplied server fields are rejected
    When a body contains "id", "created_by", "version" or "on_behalf_of_org_id"
    Then the response is 400 "VALIDATION_ERROR" sub-code "UNKNOWN_FIELD" and nothing is persisted

  Scenario: Schema test rejects naive timestamps
    Given a migration adds a column of type "timestamp without time zone"
    Then the schema test fails CI naming the table and column

  Scenario: Local-by-nature dates carry a zone
    Given a pickup date column Then it is stored as a date plus an IANA time-zone identifier column

  Scenario: Permission path
    Given a customer Viewer When they attempt to create a record Then the response is 403 "AUTHZ_DENIED" and no row is created

  Scenario: Audit entry records both fields
    When a record is created Then the audit entry has created-by user and on-behalf-of organisation null in the same transaction
```

### US-065 — Typed permission catalogue
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** EPIC-01
- **Linked REQs:** REQ-RBAC-001, REQ-RBAC-014
- **As a** developer **I want** one typed catalogue of permission strings **so that** no route or UI references an unknown permission.
- **Notes:** Includes the Part B names listed in REQ-RBAC-014 (`quote:create`, `shipment:create`, `org:member:manage`, `webhook:stripe:receive`, `public` marker, etc.) plus the Part A names. Note REQ-RBAC-001 lists `org:member:invite`/`org:member:manage` while REQ-RBAC-014 lists `org:member:manage`; both must exist until the architect reconciles (see report).

#### Acceptance criteria
```gherkin
Feature: Permission catalogue
  Scenario: Catalogue contains required permissions
    Then it contains shipment:create, shipment:create:on_behalf, refund:approve, audit:read, audit:export, org:update, org:member:invite, org:member:manage, featureflag:manage, quote:create, document:download, pickup:schedule, session:manage and the "public" marker

  Scenario: Format and uniqueness
    When a permission is "Shipment:Create" or duplicated or has a segment outside [a-z_]
    Then the unit test fails

  Scenario: Unknown reference fails type check
    Given code references the string "shipment:fly" Then the TypeScript compile fails

  Scenario: Route declares a permission absent from the catalogue
    Then the unit test fails CI naming the method and path

  Scenario: Permission path: unauthenticated access to the catalogue is not exposed
    Given no API lists permission definitions Then GET /api/v1/permissions returns 404 "NOT_FOUND"
```

### US-066 — Seeded roles, role-permission matrix document and privilege-escalation guard test
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-065, EPIC-17
- **Linked REQs:** REQ-RBAC-002, REQ-RBAC-003, REQ-RBAC-004
- **As an** operator Super Admin **I want** the operator, customer and partner roles seeded idempotently with a generated matrix and guard test **so that** a seed edit can never silently escalate privileges.
- **Notes:** Operator roles: Super Admin, Admin, Operations, Finance, Support, Sales, Compliance Auditor, Content Manager. Customer: Owner, Admin, Shipper, Finance, Viewer. Partner (Owner, Developer, Operations, Finance) is data only. Matrix doc `docs/` generated from the seed. DR-A07.

#### Acceptance criteria
```gherkin
Feature: Seeded roles
  Scenario: Idempotent seed
    When the role seed runs twice Then 8 operator, 5 customer and 4 partner roles exist once each and no existing role's permission set widened

  Scenario: Generated role-permission matrix
    When the matrix generator runs Then docs contains a role-permission table matching the seed exactly, and CI fails if the committed document differs

  Scenario: Guard invariants hold
    Then "Super Admin" holds every catalogue permission, "Compliance Auditor" holds only read and audit permissions, customer "Viewer" holds no create/update/delete/manage permission

  Scenario: Customer or partner role holding an operator-only permission
    Given a seed edit gives customer "Admin" the permission "audit:read" or any ":any_org" permission
    Then the build-time test fails CI

  Scenario: Partner roles are unused
    Then no route, UI or membership references a partner role in this run

  Scenario: Permission path
    Given a customer Shipper When they call a route requiring an operator-only permission Then the response is 403 "AUTHZ_DENIED"
```

### US-067 — Mandatory route metadata with build-time route test
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-065, EPIC-04, EPIC-16
- **Linked REQs:** REQ-RBAC-005
- **As a** developer **I want** a route to be unmountable unless it declares permission, audit descriptor and validation schema **so that** no endpoint ships unprotected, unaudited or unvalidated.
- **Notes:** `public`/`authenticated` markers need a written justification. Unknown query parameters count as part of the schema.

#### Acceptance criteria
```gherkin
Feature: Route metadata
  Scenario: Complete route mounts
    Given a route with permission "shipment:read", an audit descriptor and a validation schema Then it mounts and the build test passes

  Scenario: Missing any of the three refuses mount
    When a route lacks its permission, its audit descriptor or its validation schema
    Then application start-up refuses to mount it and the router-enumeration test fails naming "GET /api/v1/example"

  Scenario: Marker without justification
    Given a route marked "public" with an empty justification Then the build test fails

  Scenario: Permission path: not applicable — build-time tooling has no principal. Second negative: unknown query parameter
    When a request adds "?debug=1" to a route whose schema does not declare it Then the response is 400 "VALIDATION_ERROR" sub-code "UNKNOWN_FIELD"
```

### US-068 — Request pipeline order, 401/403 outcomes and live permission resolution
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-063, US-066, US-067
- **Linked REQs:** REQ-RBAC-006, REQ-RBAC-008
- **As a** security-conscious operator **I want** requests processed authenticate, authorise, validate, execute with permissions resolved server-side every time **so that** denied callers learn nothing and role changes apply within 5 s.
- **Notes:** DR-A08 order. Permission cache TTL at most 5 s, invalidated on membership change.

#### Acceptance criteria
```gherkin
Feature: Authorisation pipeline
  Scenario: Authorised request executes
    Given a Shipper with "shipment:create" When they POST a valid body Then the response is 201

  Scenario: Unauthenticated call
    When an anonymous client calls a protected route Then the response is 401 "AUTH_REQUIRED" problem+json

  Scenario: Authorisation precedes validation
    Given a Viewer without "shipment:create" When they POST an invalid body
    Then the response is 403 "AUTHZ_DENIED" and contains no validation details

  Scenario: Role change takes effect within 5 s
    Given a Shipper with a valid access token When an Owner removes their membership
    Then within 5 s the Shipper's next call returns 403 "AUTHZ_DENIED" with the same unexpired token

  Scenario: Claims in token or client headers are ignored
    Given a token carrying an extra claim "permissions":["audit:read"] When the user calls "/audit/entries" Then the response is 403 "AUTHZ_DENIED"

  Scenario: Public route skips authentication
    Given a route marked "public" When an anonymous client calls it Then it responds without a 401 and still writes its declared audit descriptor
```

### US-069 — Permission-denied audit and cross-tenant 404
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-068, US-075, EPIC-04
- **Linked REQs:** REQ-RBAC-007
- **As a** Compliance Auditor **I want** denied attempts recorded and cross-tenant probes indistinguishable from missing resources **so that** abuse is visible and existence is never disclosed.
- **Notes:** EC-A08, GAP-A-06. Denied attempts at audit-viewer routes are included.

#### Acceptance criteria
```gherkin
Feature: Denial behaviour
  Scenario: Denial is audited and logged
    Given a Viewer calls "POST /api/v1/shipments" without permission
    Then the response is 403 "AUTHZ_DENIED"
    And an audit entry has action "PERMISSION_DENIED", outcome "DENIED", the actor, organisation, route template and required permission "shipment:create"
    And a security log event "permission_denied" is emitted and its counter increments

  Scenario: Cross-tenant resource returns 404
    Given user A of organisation A requests shipment ID of organisation B
    Then the response is 404 "NOT_FOUND" identical in body shape to a nonexistent ID and no "PERMISSION_DENIED" entry is written
    And the repeated-404 security counter increments

  Scenario: Denied attempt at the audit viewer
    Given a customer Owner calls "GET /api/v1/audit/entries" Then 403 "AUTHZ_DENIED" and a "PERMISSION_DENIED" entry exist

  Scenario: Unauthenticated probe
    Then an anonymous call to a protected route returns 401 "AUTH_REQUIRED" and writes an ANONYMOUS-actor entry with IP and user agent

  Scenario: Repeated cross-tenant probes
    When one user receives more than 20 cross-tenant 404s in one minute Then a security event "repeated_cross_tenant_404" is emitted
```

### US-070 — Permission-aware UI helper and frontend route guard
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-063, EPIC-05
- **Linked REQs:** REQ-RBAC-009, REQ-RBAC-010
- **As a** customer or staff user **I want** navigation, buttons and routes to reflect only what I may do **so that** I am never offered actions that fail.
- **Notes:** UI gating is convenience; server re-checks. Applies to web and admin apps, three locales, 360 px and 1280 px.

#### Acceptance criteria
```gherkin
Feature: Permission-aware UI
  Scenario: Controls follow /me permissions through one helper
    Given a customer Viewer is signed in When the dashboard renders at 360 px and 1280 px
    Then the "Book shipment" button is absent from the accessibility tree, not merely invisible

  Scenario: Guarded route shows permission-denied without a data request
    Given a customer Owner opens the admin deep link "/audit" (no "audit:read")
    Then the permission-denied state (REQ-UI-007) is shown in en, es and fr and no request to "/api/v1/audit/entries" is issued

  Scenario: Permission-denied offers actions
    Then the state shows "Go home" and, with 2 or more memberships, "Switch organisation"

  Scenario: Server still authoritative
    Given the UI is tampered to show a hidden button When it is clicked Then the API answers 403 "AUTHZ_DENIED" and the error is shown with the correlation ID

  Scenario: Unauthenticated deep link
    When an anonymous visitor opens a guarded route Then they are redirected to sign-in with the return URL

  Scenario: Keyboard and axe
    Then the guarded and denied states are keyboard operable and axe reports zero serious or critical violations
```

### US-071 — RBAC matrix test generator
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-066, US-067, US-077
- **Linked REQs:** REQ-RBAC-011
- **As a** QA lead **I want** allow/deny tests generated for every route and seeded role **so that** a new route or role cannot ship without authorisation coverage.
- **Notes:** M0 exit demo: generator passing. Roles = 8 operator + 5 customer + 4 partner.

#### Acceptance criteria
```gherkin
Feature: RBAC matrix generator
  Scenario: Allow or deny per cell
    Given routes and seeded roles When the generator runs
    Then for each route x role it expects success if the role holds the route's permission, else 403 "AUTHZ_DENIED", and all cells pass

  Scenario: Unauthenticated test per protected route
    Then every protected route has a generated case expecting 401 "AUTH_REQUIRED"

  Scenario: Cross-tenant case per tenant-resource route
    Then every route taking a tenant-owned ID has a generated case expecting 404 "NOT_FOUND" and no data

  Scenario: Uncovered route or role fails CI
    Given a new route or role is added without regenerating Then CI fails naming it

  Scenario: Permission path: not applicable — test tooling has no principal. Second negative: seed drift
    Given a role's seeded permission is changed Then the generated expectation changes and a stale committed matrix fails CI
```

### US-072 — Download and export routes with their own permission
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-068, EPIC-04
- **Linked REQs:** REQ-RBAC-012
- **As a** business Owner **I want** labels, customs documents and invoices downloadable only by roles holding the specific download permission **so that** documents are not leaked to roles without need.
- **Notes:** Applies to Part B routes. `audit:export` is M2. Check precedes pre-signed URL or stream (300 s URL, D-025).

#### Acceptance criteria
```gherkin
Feature: Download permission
  Scenario: Permitted download
    Given a Shipper holding "document:download" When they request a label download
    Then a pre-signed URL valid 300 s is returned after a "DOWNLOAD" audit entry with document ID and version

  Scenario: Missing permission
    Given a Viewer without "document:download" Then 403 "AUTHZ_DENIED", no URL or stream is issued and a "PERMISSION_DENIED" entry exists

  Scenario: Route lacking its own download permission fails the build
    Given a route named "*/download" declares only "shipment:read" Then the route test fails

  Scenario: Cross-tenant
    Given a document of organisation B Then user A gets 404 "NOT_FOUND"
```

### US-073 — Role definitions change only via versioned migration
- **Milestone:** M0 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-066, EPIC-04
- **Linked REQs:** REQ-RBAC-013
- **As a** Compliance Auditor **I want** role and permission changes to occur only through audited migrations **so that** privilege changes are traceable.
- **Notes:** Role editor is M2.

#### Acceptance criteria
```gherkin
Feature: Migration-only role changes
  Scenario: Migration change is audited
    When a migration adds a permission to role "Operations"
    Then a "CONFIG_CHANGE" entry by actor type "SYSTEM_JOB" records role and old/new permission set

  Scenario: No API edits roles
    Then POST/PUT/PATCH/DELETE on "/api/v1/roles" and "/api/v1/role-permissions" return 404 or 405 and the admin app has no such screen

  Scenario: Runtime role cannot write role tables
    Given the runtime DB role When it runs UPDATE on role_permissions Then the statement fails with permission denied

  Scenario: No-op re-run writes nothing
    When the same migration seed re-runs Then no further "CONFIG_CHANGE" entry is written
```

### US-074 — RLS enabled and forced on every tenant-owned table, separate DB roles
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-01
- **Linked REQs:** REQ-RLS-001, REQ-RLS-002, REQ-RLS-005
- **As a** platform operator **I want** tenant tables protected by forced row-level security under a non-privileged runtime role **so that** isolation holds even if application code is wrong.
- **Notes:** Global tables list: reference data, permissions, roles, feature-flag definitions, FX rates, compliance packs. `users`, `sessions`, `memberships` per DR-A14.

#### Acceptance criteria
```gherkin
Feature: RLS foundation
  Scenario: org_id and index on every tenant table
    When the schema test enumerates tables Then each non-global table has non-null "org_id" referencing organisations and an index whose first column is "org_id"

  Scenario: Table without org_id not on global list fails build
    Given a migration adds table "widgets" without org_id Then the build-time test fails naming "widgets"

  Scenario: RLS enabled and forced
    Then every tenant-owned table has relrowsecurity and relforcerowsecurity true and policies USING and WITH CHECK on app.org_id

  Scenario: Runtime role attributes
    Then pg_roles shows the API/worker role is not superuser, has no BYPASSRLS and owns no tables, and migrations use a different role never used at runtime

  Scenario: Permission path
    Given the runtime role When it attempts ALTER TABLE ... DISABLE ROW LEVEL SECURITY Then it fails with permission denied
```

### US-075 — Per-transaction tenant context with SET LOCAL and fail-closed default
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-074
- **Linked REQs:** REQ-RLS-003, REQ-RLS-004
- **As a** developer **I want** every request's DB work wrapped in a transaction that sets the tenant context locally **so that** pooled connections cannot leak context.
- **Notes:** Never session-level SET.

#### Acceptance criteria
```gherkin
Feature: Tenant context
  Scenario: Sequential requests on a single-connection pool
    Given a pool of size 1 When request 1 for organisation A then request 2 for organisation B run
    Then each sees only its own rows and "app.org_id"/"app.actor_id" are reset after commit

  Scenario: Unset, empty or invalid context returns nothing
    Given a raw connection that sets nothing When it selects from a tenant table Then 0 rows are returned and inserts fail
    And "app.org_id" = '' or 'not-a-uuid' behaves identically

  Scenario: Session-level SET is rejected by lint
    Given source containing "SET app.org_id" without LOCAL Then the lint/Semgrep rule fails CI

  Scenario: Permission path: not applicable — infrastructure with no end-user principal. Second negative
    Given a query is issued outside a context-setting transaction Then the data layer throws before reaching the database
```

### US-076 — Operator cross-tenant scope
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-075, US-066
- **Linked REQs:** REQ-RLS-006
- **As a** Compliance Auditor **I want** operator staff to see other organisations only through an explicit, server-granted scope **so that** cross-tenant access is deliberate and auditable.
- **Notes:** DR-A15. Used by the audit viewer organisation filter.

#### Acceptance criteria
```gherkin
Feature: Operator scope
  Scenario: Operator on a cross-tenant-capable route sees other organisations
    Given an ACTIVE OPERATOR member calls a route flagged cross-tenant capable
    Then the server sets app.actor_scope='OPERATOR' and rows of other organisations are returned
    And the audit entry records the actor organisation and the target organisation

  Scenario: Client-supplied scope is ignored
    When any request sends header or body "actor_scope=OPERATOR" Then it is rejected as "UNKNOWN_FIELD"/ignored and scope is not set

  Scenario: Customer or partner member can never obtain scope
    Given a customer Owner calls the same route Then 403 "AUTHZ_DENIED" and app.actor_scope is never 'OPERATOR'

  Scenario: Operator on a route not flagged cross-tenant
    Then only the operator's own organisation rows are visible
```

### US-077 — Generated cross-tenant isolation tests
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-074, US-075, US-067
- **Linked REQs:** REQ-RLS-007
- **As a** QA lead **I want** isolation proven for every tenant table and tenant-addressing route **so that** zero cross-tenant reads or writes is evidenced.
- **Notes:** Real PostgreSQL via Testcontainers with the runtime role.

#### Acceptance criteria
```gherkin
Feature: Cross-tenant tests
  Scenario: Table-level proof
    Given rows in organisations A and B When a session of A selects, updates, deletes or inserts using B's exact ID or org_id
    Then 0 rows are affected and inserts fail the WITH CHECK policy for every tenant table

  Scenario: API-level proof
    When user A calls each tenant-resource route with B's ID Then every response is 404 "NOT_FOUND" with no B data

  Scenario: New table without a generated case
    Given a tenant table is added Then the generator picks it up automatically and CI fails if it is skipped

  Scenario: Permission path: not applicable — test tooling. Second negative: runtime role used
    Then the suite asserts it connects with the non-owner, non-BYPASSRLS runtime role
```

### US-078 — Tenant context in worker jobs
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-075, EPIC-01
- **Linked REQs:** REQ-RLS-008
- **As a** system actor **I want** jobs to run under the payload's tenant context **so that** background work cannot cross tenants.
- **Notes:** EC-A38; DR-A25. Tenant-spanning scheduled jobs iterate organisations explicitly.

#### Acceptance criteria
```gherkin
Feature: Worker tenant context
  Scenario: Job runs in payload context
    Given a job with org_id O and actor_id U When it runs Then it sees only O's rows with app.org_id=O and app.actor_id=U

  Scenario: Missing or invalid org_id
    Given a job touching tenant data with no org_id or "abc" Then it fails once without retry and lands in the dead-letter queue with reason "MISSING_TENANT_CONTEXT" and no data is read

  Scenario: Cross-tenant job iterates explicitly
    Given a scheduled job spanning tenants Then it opens one context per organisation and never an unscoped query

  Scenario: Permission path: not applicable — jobs run as actor type SYSTEM_JOB. Second negative
    Given a job payload with org_id of a deleted organisation Then it fails non-retryably with an audit entry outcome "FAILED"
```

### US-079 — Soft delete and optimistic locking
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-064, EPIC-16
- **Linked REQs:** REQ-RLS-010, REQ-RLS-011
- **As a** customer **I want** deleted items hidden but traceable and concurrent edits detected **so that** I never silently overwrite a colleague's change.
- **Notes:** DR-A16, DR-A17, EC-A25, EC-A26. Restore not available.

#### Acceptance criteria
```gherkin
Feature: Soft delete and versioning
  Scenario: Soft delete
    When a user deletes an address-book entry Then deleted_at and deleted_by are set, the row is absent from default lists, GET by ID returns 404 "NOT_FOUND" and an audit "DELETE" entry exists

  Scenario: Unique keys free after delete
    Given a deleted row with unique name "Home" Then a new row named "Home" can be created (partial index deleted_at IS NULL)

  Scenario: Runtime role cannot hard delete
    Then DELETE on a soft-deletable table fails with permission denied for the runtime role

  Scenario: Version increments
    When a row at version 1 is updated with If-Match matching Then version is 2 and the new ETag differs

  Scenario: Stale update
    When the update carries a stale If-Match Then the response is 412 "CONCURRENCY_CONFLICT" with the current ETag; internal conflicts return 409 "CONFLICT"

  Scenario: Two concurrent updates
    Given two updates from version 3 Then exactly one succeeds (version 4) and the other gets 412

  Scenario: Missing If-Match and no-op update
    Then a missing header returns 428 "PRECONDITION_REQUIRED"; an unchanged update returns 200 with no version bump and no audit entry

  Scenario: Permission denied
    Given a Viewer deletes the entry Then 403 "AUTHZ_DENIED" and the row is untouched
```

### US-080 — Guest-capable tables and atomic claim
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-074
- **Linked REQs:** REQ-RLS-013
- **As a** guest shipper **I want** my quote reachable only by my unguessable token and claimable by my account later **so that** nobody else can see it.
- **Notes:** EC-A44. Applies to tables flagged guest-capable (unclaimed guest quotes). Token at least 128 bits.

#### Acceptance criteria
```gherkin
Feature: Guest-capable rows
  Scenario: Token access
    Given an unclaimed guest quote with a 128-bit token When the guest presents the token Then the row is returned

  Scenario: Crafted IDs and wrong tokens
    When another guest or organisation uses the row ID or a guessed token Then the response is 404 "NOT_FOUND"

  Scenario: Null org_id only on flagged tables
    Given a non-flagged table Then inserting org_id NULL fails

  Scenario: Atomic claim
    When an authenticated account claims the quote Then org_id is set in one statement and the token no longer reads the row as a guest

  Scenario: Claim twice
    Given the quote was claimed by account X When account Y claims it Then 409 "QUOTE_ALREADY_CLAIMED"

  Scenario: Unauthenticated claim
    Then claiming without sign-in returns 401 "AUTH_REQUIRED"

  Scenario: Audit
    Then the claim writes an "UPDATE" entry with old org_id null, new org_id set, in the same transaction
```

### US-081 — Switch active organisation
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-063
- **Linked REQs:** REQ-ORG-006
- **As a** user with several memberships **I want** to switch organisation **so that** I act in the right company.
- **Notes:** Switcher UI visible only with 2 or more ACTIVE memberships; three locales; 360/1280 px.

#### Acceptance criteria
```gherkin
Feature: Organisation switch
  Scenario: Successful switch
    Given a user ACTIVE in "Acme Exports" and their personal organisation When they choose "Acme Exports"
    Then a new access token for that organisation is issued and an audit entry records old and new organisation

  Scenario: Switch to a non-member organisation
    Then 403 "AUTHZ_DENIED" and no token is issued

  Scenario: Switcher hidden with one membership
    Given one ACTIVE membership Then no switcher is in the DOM or accessibility tree

  Scenario: Unauthenticated switch
    Then 401 "AUTH_REQUIRED"

  Scenario: Keyboard and locales
    Then the switcher is operable by keyboard, labelled in en, es and fr, and axe reports zero serious violations
```

### US-082 — Organisation profile and creating a business organisation
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-062, US-079
- **Linked REQs:** REQ-ORG-008, REQ-ORG-009
- **As a** business customer Owner **I want** to create my company organisation and keep its profile current **so that** shipments and invoices carry correct details.
- **Notes:** Profile fields: display name 1–120 characters, legal name, country, address, contact email, phone E.164, tax references, default locale and currency. Owner-organisation cap 10 (ASSUMED).

#### Acceptance criteria
```gherkin
Feature: Organisation profile
  Scenario: Create business organisation
    Given an authenticated user When they POST name "Acme Exports", country "US", currency "USD"
    Then a BUSINESS_CUSTOMER organisation exists and the user is its ACTIVE Owner

  Scenario: Eleventh owned organisation refused
    Given the user owns 10 organisations Then 422 problem+json is returned and nothing is created

  Scenario: Update with optimistic concurrency
    Given a holder of "org:update" with matching If-Match When they change display name Then 200, version+1 and an audit entry with a field-level diff

  Scenario: Validation
    When display name is 121 characters or phone is "12345" or country is "ZZ" Then 400 "VALIDATION_ERROR" with a pointer per field

  Scenario: Stale If-Match
    Then 412 "CONCURRENCY_CONFLICT"

  Scenario: Permission denied
    Given a Viewer lacking "org:update" Then 403 "AUTHZ_DENIED" and "PERMISSION_DENIED" is audited

  Scenario: Type and ID not updatable
    When the body contains "type" Then 400 "UNKNOWN_FIELD"
```

### US-083 — Invite members into a business organisation
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-062, EPIC-15
- **Linked REQs:** REQ-ORG-010
- **As a** business Owner **I want** to invite colleagues by email with a role **so that** the team can book under one account.
- **Notes:** Token single-use, 7 days (DR-A01), stored hashed. Email sent in invitee locale via EPIC-15.

#### Acceptance criteria
```gherkin
Feature: Invitations
  Scenario: Invite
    Given an Owner holding "org:member:invite" When they invite "ravi@example.test" as "Shipper"
    Then an INVITED membership exists, the token hash is stored (never the raw token) and expires in 7 days

  Scenario: Owner role only by an Owner
    Given an Admin invites with role "Owner" Then 403 "AUTHZ_DENIED"

  Scenario: Already a member
    Given the address has an ACTIVE membership Then 409 "ALREADY_MEMBER"

  Scenario: List, resend and revoke
    Then the inviter lists pending invitations; resend works up to 3 times and the 4th is 422; revoke makes the token return 400 "TOKEN_INVALID"

  Scenario: Invalid email
    Then 400 "VALIDATION_ERROR"

  Scenario: Permission denied
    Given a Viewer Then 403 "AUTHZ_DENIED"

  Scenario: Cross-tenant
    Given an invitation ID of organisation B Then 404 "NOT_FOUND"

  Scenario: Audit
    Then invite, resend and revoke each write an entry without any raw token value
```

### US-084 — Accept an invitation
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-083, EPIC-02
- **Linked REQs:** REQ-ORG-011
- **As an** invited colleague **I want** to accept with my verified email **so that** I join the team with the invited role.
- **Notes:** EC-A16. Account is created first if none exists.

#### Acceptance criteria
```gherkin
Feature: Accept invitation
  Scenario: Accept
    Given a signed-in user whose verified email matches Then the membership becomes ACTIVE with the invited role and created_by is the inviter

  Scenario: Expired token
    Then 410 "TOKEN_EXPIRED" and membership unchanged

  Scenario: Used or revoked token
    Then 400 "TOKEN_INVALID"

  Scenario: Different signed-in email
    Then 403 "INVITATION_EMAIL_MISMATCH"

  Scenario: No account yet
    Then the user registers first and then acceptance succeeds

  Scenario: Unauthenticated acceptance of an existing account
    Then 401 "AUTH_REQUIRED" with the return URL preserved

  Scenario: Audit
    Then an "UPDATE" entry on entity "membership" records INVITED to ACTIVE
```

### US-085 — Manage members, last-Owner and individual-organisation safeguards
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-062, US-068
- **Linked REQs:** REQ-ORG-012, REQ-ORG-013, REQ-ORG-014
- **As a** business Owner **I want** to change roles, suspend or remove members without ever orphaning the organisation **so that** access stays controlled.
- **Notes:** EC-A15, EC-A17. Admin cannot modify an Owner. Individual organisations: no invites, one member.

#### Acceptance criteria
```gherkin
Feature: Member management
  Scenario: Change roles
    Given a holder of "org:member:manage" When they change a Shipper to Finance
    Then the membership is updated, the member's sessions with this active organisation are revoked and an audit diff shows old/new role sets

  Scenario: Owner only by Owner
    Given an Admin assigns "Owner" Then 403 "AUTHZ_DENIED"; an Admin modifying an Owner also gets 403

  Scenario: Last Owner protected
    Given one ACTIVE Owner When they are demoted, suspended, removed or leave Then 422 "LAST_OWNER" and nothing changes

  Scenario: Removed member loses access within 5 s
    Then their next call returns 403 "AUTHZ_DENIED" and the client falls back to the personal organisation

  Scenario: Individual organisation restrictions
    When anyone invites into an INDIVIDUAL organisation or adds a second ACTIVE member Then 422 "ORG_TYPE_RESTRICTION"

  Scenario: Permission denied
    Given a Shipper Then 403 "AUTHZ_DENIED" and "PERMISSION_DENIED" is audited

  Scenario: Cross-tenant
    Given a membership of organisation B Then 404 "NOT_FOUND"
```

## Coverage check

| REQ | Stories |
|---|---|
| REQ-ORG-001 | US-061 |
| REQ-ORG-002 | US-062 |
| REQ-ORG-003 | US-062 |
| REQ-ORG-004 | US-062 |
| REQ-ORG-005 | US-063 |
| REQ-ORG-006 | US-081 |
| REQ-ORG-007 | US-064 |
| REQ-ORG-008 | US-082 |
| REQ-ORG-009 | US-082 |
| REQ-ORG-010 | US-083 |
| REQ-ORG-011 | US-084 |
| REQ-ORG-012 | US-085 |
| REQ-ORG-013 | US-085 |
| REQ-ORG-014 | US-085 |
| REQ-RBAC-001 | US-065 |
| REQ-RBAC-002 | US-066 |
| REQ-RBAC-003 | US-066 |
| REQ-RBAC-004 | US-066 |
| REQ-RBAC-005 | US-067 |
| REQ-RBAC-006 | US-068 |
| REQ-RBAC-007 | US-069 |
| REQ-RBAC-008 | US-068 |
| REQ-RBAC-009 | US-070 |
| REQ-RBAC-010 | US-070 |
| REQ-RBAC-011 | US-071 |
| REQ-RBAC-012 | US-072 |
| REQ-RBAC-013 | US-073 |
| REQ-RBAC-014 | US-065 |
| REQ-RLS-001 | US-074 |
| REQ-RLS-002 | US-074 |
| REQ-RLS-003 | US-075 |
| REQ-RLS-004 | US-075 |
| REQ-RLS-005 | US-074 |
| REQ-RLS-006 | US-076 |
| REQ-RLS-007 | US-077 |
| REQ-RLS-008 | US-078 |
| REQ-RLS-009 | US-064 |
| REQ-RLS-010 | US-079 |
| REQ-RLS-011 | US-079 |
| REQ-RLS-012 | US-064 |
| REQ-RLS-013 | US-080 |

All Must REQs in REQ-ORG, REQ-RBAC and REQ-RLS are covered by at least one Must story (ORG-001..005, 007: US-061..064; RBAC-001, 002, 004..012, 014: US-065..072; RLS-001..013: US-064, US-074..080). Should REQs (ORG-006, 008..014, RBAC-003, RBAC-013) are linked by Should stories or by the Must story that delivers the related seed (RBAC-003 in US-066).
