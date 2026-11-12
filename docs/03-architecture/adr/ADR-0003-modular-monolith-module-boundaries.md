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

## Reversibility

High within the monolith (module moves); medium for extraction (needs network interfaces).
