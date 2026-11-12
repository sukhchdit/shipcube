# ADR-0003: Modular monolith, bounded contexts, layering and route metadata

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §4.1, §4.2; REQ-PLAT-001/002, REQ-RBAC-005/006, REQ-AUDIT-001/006; NFR-MAINT-001, NFR-AUDIT-004; ADR-0004 (outbox), ADR-0008 (RBAC), ADR-0007 (audit)

## Context

Brief §4.1 mandates a modular monolith deployed as two processes (`api`, `worker`) plus two static frontends, with modules talking through in-process interfaces and a transactional outbox so that any module can be extracted later. Layering `routes → controller → service → repository` must be lint-enforced; every route must declare permission, audit descriptor and validation schema with a build-time test. Options analysis against the drivers (evolvability, auditability, tenant isolation, time-to-M1 with four parallel developers, $0 infrastructure):

| Option | Evolvability | Audit/RLS consistency (same-tx writes) | Build cost | Ops cost ($0 now) | Verdict |
|---|---|---|---|---|---|
| A. Modular monolith (brief default) | High (bounded contexts, outbox, extractable) | Native: one DB transaction per request | Low | Low | **Chosen** |
| B. Microservices per context | High in theory | Hard: cross-service audit atomicity needs sagas everywhere | Very high | High | Rejected |
| C. Layered monolith without module boundaries | Low (coupling creeps) | Native | Lowest | Low | Rejected: fails brief §4.1 and NFR-MAINT-001 |

## Decision

### Modules (bounded contexts) in this run

`apps/api/src/modules/<module>/{routes,controller,service,repository,schemas,policies,events,tests}`. Modules instantiated in M0/M1 and the REQ areas they own:

| Module | Owns (REQ areas / concerns) | Public interface (in-process) | Emits (outbox) |
|---|---|---|---|
| `identity` | REQ-AUTH, REQ-ADMIN-002..004/007/008 sign-in mechanics, sessions, MFA, re-auth, revocation | `IdentityService` (authenticate, issueTokens, verifyAccess, revokeSession, reauthProof) | `auth.*`, `user.*` events (catalogue in api/README.md) |
| `organisations` | REQ-ORG, address book (REQ-ACCT-004/008), terms acceptance, invitations | `OrganisationService`, `MembershipQuery` (active membership + roles for authz) | `org.invitation_created` |
| `quotes` | REQ-QUOTE, rate-shopping orchestration (fan-out, SSE, cache), claim, share, save | `QuoteService` | `quote.created`, `quote.claimed` |
| `pricing` | REQ-PRICE config loading (versioned seed), FX snapshot access, call into `packages/pricing` | `PricingService.price(input)` | — |
| `carriers` | REQ-CARR adapter registry, carrier accounts from config, service reference data, raw payload store, carrier status, push-webhook seam | `CarrierGateway` (resilience-wrapped adapter per account) | — |
| `shipments` | REQ-BOOK state machine, parties, packages, transitions, cancellation (DR-B20) | `ShipmentService`, `ShipmentStateMachine` | `shipment.*` |
| `orders` | REQ-BOOK basket/order, order numbers, checkout, saga orchestration state | `OrderService`, `BookingSaga` | `order.*` |
| `payments` | REQ-PAY gateway abstraction, Mock + Stripe adapters, webhooks, refunds, saved methods, sweeper | `PaymentService`, `PaymentGateway` | `payment.*` |
| `customs` | REQ-CUST declarations, items, prohibited/restricted checks, de-minimis | `CustomsService` | — |
| `documents` | REQ-DOC generation (pdfkit), versions, object storage, downloads, email | `DocumentService` | `document.generated` |
| `pickups` | REQ-PICK availability, schedule, cancel, service points | `PickupService` | `pickup.*` |
| `tracking` | REQ-TRACK events, canonical mapping, poll schedule, public tracking | `TrackingService` | `tracking.*` |
| `notifications` | REQ-NOTIF templates, event→template mapping, preferences, log, providers | `NotificationService` (consumer of events) | — |
| `compliance` | REQ-COMP packs, legal texts, consent records | `CompliancePackResolver` | `config.changed` |
| `audit` | REQ-AUDIT-019..023 viewer API, chain status (writer lives in `packages/audit`) | `AuditQueryService` | — |
| `admin-settings` | REQ-DATA-016 reference-data read API, REQ-PLAT-020/021 feature flags, REQ-DATA-015 number sequences | `ReferenceDataService`, `FeatureFlagService`, `NumberSequenceService` | `featureflag.changed` |

Modules listed in brief §4.1 but not needed before M2+ (`ledger`, `invoicing`, `claims`, `support`, `partners`, `developer-api`, `webhooks`, `reconciliation`, `content`, `reports`) are **not** created until their first feature lands (brief §13 rule 5: no silent stubs). Seams they need are columns/enums/interfaces recorded in ARCHITECTURE.md §9.

Cross-cutting code lives in packages: `shared` (types, enums, constants, error catalogue, Money/units helpers, queue names, event names, validation constants), `authz` (permission catalogue, role seeds, policy checks, matrix generator), `audit` (middleware, differ, redaction, classification registry, hash chain, PII tokenisation), `carriers`, `pricing`, `config`, `ui`. Platform plumbing (`apps/api/src/platform`): HTTP bootstrap, request context, error handler, idempotency, rate limiting, RLS transaction wrapper, outbox writer, OpenAPI serving, health.

### Layering and dependency rules (ESLint `boundaries`)

- `routes` → `controller` → `service` → `repository`. Controllers: HTTP mapping only. Services: domain logic; never import `express` types or Prisma. Repositories: the only code importing the Prisma client (via the tenant transaction handle) and raw SQL.
- A module may import another module **only** through its `index.ts` public interface (service types), never its repository or controller. Cycles are forbidden (`import-x/no-cycle`).
- `packages/pricing` has no I/O imports (allow-list: `@platform/shared` only). `packages/carriers` may import the HTTP client and Redis token cache abstractions only through injected ports.
- `apps/web` and `apps/admin` never import from `apps/api`; they import `@platform/shared` and `@platform/ui`. `apps/worker` imports module services (not controllers/routes).
- Each rule has a negative fixture test (NFR-MAINT-001).

### Route metadata

Every route is declared with `defineRoute()`:

```ts
defineRoute({
  method: 'POST', path: '/shipments/:id/cancel',
  permission: 'shipment:cancel',                    // or { public: true, justification } | { authenticated: true, justification }
  audit: { action: 'UPDATE', entity: 'shipment', entityId: (req) => req.params.id, sensitivity: 'SENSITIVE', reasonRequired: true },
  schema: { params, body },                        // Joi, unknown fields rejected
  idempotency: 'required',                          // 'required' | 'optional' | 'not-applicable'
  rateLimit: 'authenticated',                       // class per DR-A22
  tenancy: 'tenant',                                // 'tenant' | 'operator-cross-tenant' | 'guest' | 'public' | 'user'
  reauth: false,
  handler: controller.cancel,
});
```

The router refuses to mount a route missing any required field (REQ-RBAC-005). A build-time test enumerates the registry and `docs/03-architecture/api/openapi.yaml`, asserting equal method/path sets and matching `x-permission`, `x-audit`, `x-idempotency` (NFR-AUDIT-004, NFR-MAINT-004). Pipeline order per DR-A08: correlation → authenticate → MFA gate → authorise → rate limit → validate → idempotency/If-Match → execute in one RLS transaction with the audit entry and outbox write.

### Worker

`apps/worker` hosts BullMQ processors and repeatable schedulers that call module services with a job-derived context (`org_id`, `actor_id = SYSTEM_JOB`, correlation ID). It shares the module code; it does not expose HTTP except `/health/*` and `/metrics`.

## Alternatives considered

See table above. Also considered **one process for api + worker**: rejected because queue consumers and HTTP must scale and drain independently (NFR-SCALE-002, NFR-AVAIL-002) and the brief fixes two processes.

## Consequences

- Positive: same-transaction audit + outbox is trivial; module extraction later = move folder + replace in-process interface with the outbox events already emitted.
- Negative: discipline is lint-enforced, so new developers meet lint errors early; module public interfaces must be kept small (reviewed in code review).
- Verification: boundary lint with negative fixtures; route-metadata build test; RBAC matrix and audit generators (ADR-0007/0008).

## Amendment (2026-11-12, batch 0.2 part 2): exact Prisma importers, the `@platform/config/web` allowance, `packages/ui` as the browser-shared package (`eslint.config.mjs` on `main` @2720891, TASK-002 PR #2; PR #2 code review m2/m3/m9, D-TASK002-02 items 3–4; `rulings/batch-0.2-rulings.md` Part 2 items 11 and 13; D-ARCH-054, D-ARCH-056; amends "Layering and dependency rules")

1. **Who imports Prisma and the SQL driver** (precision of "Repositories: the only code importing the Prisma client"). The Prisma client (`@prisma/client`, `@prisma/adapter-pg`, `prisma/generated/**`) and the driver (`pg`, `pg-pool`) are imported by: module repositories (`apps/api/src/modules/*/repository/**`); the database platform (`apps/*/src/platform/db/**`: adapter factory, pool, `withTenantTx`, client extensions); **two named stores that are repositories by function but live outside a module's `repository/` folder** — `packages/audit/src/store/prisma-store.ts` (the audit writer's store, ADR-0007: it must write inside the caller's transaction and lives in a package; TASK-025) and `apps/api/src/platform/outbox/writer.ts` (the outbox writer and `SKIP LOCKED` relay, ADR-0004; TASK-043); and the tooling categories `prisma/**`, `tools/db/**` and test files. The two paths are **exact** (`PLANNED_PRISMA_FILES` in `eslint.config.mjs`, D-TASK002-02 item 3); TASK-025 and TASK-043 create exactly them. Any further importer is a `lint`-locked configuration edit **and** an amendment to this list — a conformance review returns NEEDS-ADR otherwise. Services still never import Prisma; the rule message "only repositories import Prisma" remains the rule of thumb.
2. **Web and admin import allow-list.** "`apps/web` and `apps/admin` … import `@platform/shared` and `@platform/ui`" stands for application code, with one addition: the subpath **`@platform/config/web`** (never the root `@platform/config`, `@platform/config/testing` or any other server package) may be imported (i) as a **value** from the apps' build configuration files `apps/{web,admin}/vite.config.ts` and `react-router.config.ts`, and (ii) as a **type-only** import (`import type`, `export type … from`) from `apps/{web,admin}/app/**` — ADR-0018 amendment 7 is the consumption model. Encoding (`lint` lock; specification L1–L5 in `rulings/batch-0.2-rulings.md` Part 2; TASK-002 conventions: one probe or fixture per arm, positive control): `BOUNDARIES_FILES` gains the categories `app-build-config` (`apps/*/{vite,react-router}.config.ts`, capture `app`) and `config-web` (`packages/config/src/web/**`); two allow policies follow the existing web/admin disallow+allow pair — build-config files → `@platform/config/web` (external-specifier arm **and** resolved-file arm), application code → the same targets with `dependency: { kind: 'type' }` (the matcher the config already uses with `nodeKind: 'export'`; eslint-plugin-boundaries 7.4.1); value imports, `import()` and `export * from` of the subpath from `app/**`, and any import of the root package or `./testing` from the apps, stay reported.
3. **`packages/ui` is the browser-shared package; `packages/shared` holds no HTTP library.** `packages/shared` (consumed by api, worker, web and admin) stays transport-agnostic — types including `src/api/types.gen.ts`, constants, enums, the error catalogue, pure helpers — declares no `axios`, `undici`, `node-fetch`, `got` or `ky` (toolchain structure test, added with the client) and remains under `platform/outbound-http-via-client`. The thin typed Axios client of ADR-0026 §4 lives in **`packages/ui/src/api/**`** (ADR-0026 amendment 14), beside TASK-065's `src/session/**` interceptor: `packages/ui` is excluded from the outbound-HTTP rule (`BROWSER_PACKAGES`) and never enters a server image, so `axios` cannot reach the api/worker closure in which ADR-0016 §13 makes `OutboundHttpClient` the only egress. Consequently `apps/api` and `apps/worker` **never import `@platform/ui`** (policy L5). Created by TASK-026 (walking skeleton, the first API consumer). The brief §4.1 package list is unchanged.

## Reversibility

High within the monolith (module moves); medium for extraction (needs network interfaces).
