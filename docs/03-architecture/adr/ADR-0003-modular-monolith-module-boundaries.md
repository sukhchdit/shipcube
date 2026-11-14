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
  // Optional I/O phases (amendment 2026-11-13; TASK-020 part 020-C): load (read-only tx) -> call (no tx) -> handler -> afterCommit.
  load: controller.loadForCancel,                   // (ctx) => plain data, read under RLS
  call: controller.cancelAtCarrier,                 // (ctx, loaded) => external result; ctx.signal; idempotency key from loaded
  handler: controller.cancel,                       // (ctx, { loaded, called }) => the one write transaction + audit
  afterCommit: controller.afterCancel,              // (ctx, result) => best effort after the response
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

## Amendment (2026-11-13, generated Prisma client package: D-TASK020-05 / PR #32; D-ARCH-102, D-ARCH-103, D-ARCH-104; amends item 1 of the batch 0.2 part 2 amendment, "Who imports Prisma and the SQL driver")

The generated client is the package specifier `@platform/prisma/client` (data-model 7.2 amendment 2026-11-13). Verified on the PR #32 tree (scratch extract, `eslint` with the repository configuration) before ruling:

1. **No new pattern, no carve-out for `platform/db/runtime.ts`.** A bare specifier that resolves to a repository file is classified by that file (`prisma/generated/**` is the `prisma-generated` category), so the existing disallow of `PRISMA_TARGETS` and the `DATABASE_CODE` allow already decide it: services, controllers, routes, other platform folders and other packages are refused with "only repositories import Prisma"; `apps/*/src/platform/db/**` (`db-platform`) is already allowed. The PR #32 reading that the rule "allows only repositories" is imprecise; the blocker was TypeScript project layout (`rootDir`, TS6307), not lint.
2. **Value versus type.** Two policies follow the `DATABASE_CODE` allow: disallow `{ to: { file: { categories: 'prisma-generated' } }, dependency: { kind: 'value' } }` (message: the generated client package is imported as a value only by apps/*/src/platform/db, prisma/, tools/db and tests; repositories and the planned stores use import type), then allow the same target from `db-platform-core`, `prisma`, `tools-db` and `test`. Result: a **value** import is possible only in the database platform core, `prisma/**`, `tools/db/**` and tests; a **type-only** import (`import type`, `export type … from`) is additionally possible in module and worker repositories and in the two exact planned stores (`PLANNED_PRISMA_FILES`: `packages/audit/src/store/prisma-store.ts`, `apps/api/src/platform/outbox/writer.ts`). A `module: { source }` selector must **not** be used for this: the workspace specifier resolves to a local file and is not an external module for the plugin (a first attempt with it matched nothing).
3. **One value importer, private like the root client.** The pattern of the `db-root-client` category becomes `['apps/*/src/platform/db/client.ts', 'apps/*/src/platform/db/generated.ts']`: only the database platform core and `prisma/tests` may import `generated.ts`; `platform/tx`, `platform/runtime`, modules and the worker receive the runner from `runtime.ts` and the types from `platform/db/index.ts` (re-exported `AppDb`, `AppTransactionClient`, `Prisma`, types only, so `Prisma.sql`, `Prisma.raw` and `Prisma.Decimal` have no value path outside `platform/db`). `platform/prisma-client-construction` (by name) keeps refusing a value `PrismaClient` anywhere else.
4. **The worker.** `apps/worker` has no composition of its own (PR11-SEC-09, "never a second composition"): it takes the runner from `createRuntimeServices` and the types from the `api-runtime-entry` (`@platform/api/runtime`). A worker repository may type-import `@platform/prisma/client` directly; it then declares `@platform/prisma` and references `prisma/client` (preferred: the runtime-entry type re-export, which needs neither).
5. **Packages.** `packages/audit/src/store/prisma-store.ts` (TASK-025) may type-import; it then declares `@platform/prisma` and references `prisma/client`. Preferred: a structural port of the two tagged-template raw methods, which needs neither. No other package imports it (`packages/pricing` already refuses `prisma-generated`).
6. **Declarations.** An exported repository or service function is `async` or carries a return type: a non-async function returning a `PrismaPromise` fails declaration emit with TS2883.

Encoding (`lint` lock, held by TASK-020 part 020-B): one fixture per arm under `tests/fixtures/lint/layering/` — repository value import fails; repository `import type` passes; service `import type` fails; `platform/tx` importing `../db/generated.js` fails (`db-root-client`); `platform/db` value import passes; `prisma/tests` value import passes; the exact planned store type import passes and a different file in the same package fails.

## Amendment (2026-11-13, route I/O phases: PR32-SEC-01, code review PR #32 m4; D-ARCH-106; amends "Route metadata"; ADR-0005 amendment 11 is the rule, this is the shape)

`handler` stays the one transaction that writes. A route that needs an external result gains three optional fields so the call has a sanctioned place outside the transaction:

| Field | Transaction | Database handle | Rules |
|---|---|---|---|
| `load(ctx)` optional | one short **read-only** tenant transaction (a write fails with SQLSTATE 25006) | `ctx.db` | Resolves the addressed resource under RLS (a miss is 404 before any external call) and reads what the call needs (amounts from stored snapshots, attempt counters). Returns plain data. Writes nothing and no audit entry. |
| `call(ctx, loaded)` optional | none | none (the context has none) | The only place for HTTP, queue, Valkey, object-storage and SMTP work and for heavy CPU (password hashing). `ctx.signal` aborts at the request deadline or on client disconnect. **Every external effect carries an idempotency key derived from `loaded` (order id and attempt, never a random value)**, so a repeat after a failed `handler` transaction produces the same effect once (ADR-0014 G3). Returns plain data. |
| `handler(ctx, { loaded, called })` required | the one **write** transaction | `ctx.db` | Writes, outbox events, optimistic checks. It re-validates what `load` read (version-conditional update, DR-B20), because the state may have changed during `call`. The audit hook runs at the end of this transaction only, so every state change stays audited in the transaction that makes it. |
| `afterCommit(ctx, result)` optional | none | none | Runs after `COMMIT` and after the response was written. In-process and best-effort: never required for correctness (durable work is an outbox event). A throw is logged as `api.after_commit_failed` (route template and correlation id, no values) and never changes the response. Pending work is tracked and drained at shutdown inside the 30 s window (ADR-0013 item 7). |

Further rules. (a) `transaction: 'none'` allows only `handler` and `afterCommit`; `load` without `call` is refused by `defineRoute` (the handler's own transaction can read). (b) A route with only a `handler` pipelines exactly as today: one transaction, nothing to change in existing routes. (c) `load` and `handler` each take a D-ARCH-086 admission permit and release it at their `COMMIT`; none is held across `call`, so a second admission can reject with `TENANT_CONCURRENCY_LIMIT` after the call, which the idempotent-effect rule makes safe to retry. (d) The idempotency window (ADR-0014) wraps all four phases. (e) A stream result (SSE; TASK-044 defines the result type and the framing) is completed after `COMMIT`, in the position of `afterCommit`, and its replay read is a short transaction (`load` or `handler`). (f) `RouteContext.req` is replaced by a frozen transport view in every phase (PR32-SEC-05 (c)). (g) Types: `RouteSpec<L, C>`; `defineRoute` infers `L` from `load` and `C` from `call`. (h) The checkout shape is the model: `load` (order, price snapshots, attempt count) then `call` (authorise at the gateway with `auth:<order_id>:<attempt>`) then `handler` (payment row with the gateway reference, audit, `order.checkout_started`); the client secret goes into the response and nowhere else.

Owner and timing: TASK-020 part 020-C (D-ARCH-108). Until it merges the descriptor has no phase fields and the T-83 lint (ADR-0005 am. 11 item 20) is the only control; no `transaction: 'tenant'` route with external I/O may merge before it.

## Amendment (2026-11-14, PR #38 security review PR38-SEC-02 (LOW); D-ARCH-114; narrows item 2 of the 2026-11-13 generated-client amendment)

Item 2 of the 2026-11-13 amendment allows a **value** import of `@platform/prisma/client` from the whole `db-platform-core` category (`apps/*/src/platform/db/**`, both apps), while its items 3 and 4 say that `apps/api/src/platform/db/generated.ts` is the one value importer and that the worker has no composition of its own. The lint was wider than the rule, and the gap included `apps/worker/src/platform/db/`, which no CODEOWNERS line covered until PR #38 (D-TASK020-43). Verified before ruling: on `main` the only non-fixture value importer in the repository is `apps/api/src/platform/db/generated.ts` (`client.ts` imports the SQL driver and the adapter only), so the narrowing changes no code.

1. **The allow selects the file, not the category.** The allow policy that follows the `prisma-generated` value disallow selects `from: { file: { path: 'apps/api/src/platform/db/generated.ts' } }` plus the `prisma`, `tools-db` and `test` categories. Consequence: no other file under `apps/api/src/platform/db/`, and nothing under `apps/worker/src/platform/db/`, has a static value path to the generated client. The worker keeps taking the runner from `createRuntimeServices` and its types from `@platform/api/runtime` (item 4 unchanged); a worker repository may still type-import. `PRISMA_GENERATED_VALUE_MESSAGE` names the file and D-ARCH-114. The `db-root-client` category pattern keeps `apps/*/src/platform/db/generated.ts`, so a future worker `generated.ts` would still be private to its folder, but privacy is not permission: that pattern grants no value path.
2. **Residual, stated in the policy comment.** The dynamic forms the finding probed (template-literal `import()`, `createRequire`) are outside static import analysis. They stay covered by `platform/prisma-client-construction` (a `new PrismaClient` anywhere else) and by CODEOWNERS for `apps/worker/src/platform/db/` (D-TASK020-43, `REQUIRED_CODEOWNED_PATHS`), which PR #38 added as the default closure of PR38-SEC-02. The narrowing converts the static case from a review control into a build failure; it does not replace the ownership line.
3. **Encoding and owner.** TASK-020 part 020-C (`lint` lock; `eslint.config.mjs` is an owned path, so the security record of that PR covers it): fixtures under `tests/fixtures/lint/layering/` — a value import from `apps/worker/src/platform/db/` fails; a value import from a second `apps/api/src/platform/db/` file fails; `generated.ts` passes; a `prisma/tests` value import passes; the 2026-11-13 fixtures stay green.

## Reversibility

High within the monolith (module moves); medium for extraction (needs network interfaces).
