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

Further rules. (a) `transaction: 'none'` allows only `handler` and `afterCommit`; `load` without `call` is refused by `defineRoute` (the handler's own transaction can read). (b) A route with only a `handler` pipelines exactly as today: one transaction, nothing to change in existing routes. (c) `load` and `handler` each take a D-ARCH-086 admission permit and release it at their `COMMIT`; none is held across `call`, so a second admission can reject with `TENANT_CONCURRENCY_LIMIT` after the call, which the idempotent-effect rule makes safe to retry. (d) The idempotency window (ADR-0014) wraps all four phases. (e) A stream result (SSE; TASK-044 defines the result type and the framing) is completed after `COMMIT`, in the position of `afterCommit`, and its replay read is a short transaction (`load` or `handler`). (f) `RouteContext.req` is replaced by a frozen transport view in every phase (PR32-SEC-05 (c)). (g) Types: `RouteSpec<L, C>`; `defineRoute` infers `L` from `load` and `C` from `call`. (h) The checkout shape is the model: `load` (order, price snapshots, attempt count) then `call` (authorise at the gateway with `auth:<order_id>:<attempt>`) then `handler` (payment row with the gateway reference, audit, `order.checkout_started`); the client secret goes into the response and nowhere else. *Amended 2026-11-20 by the amendment of that date (D-ARCH-202): rule (d) is made precise (the claim, a re-authentication check and the lease renewals around the phases); rules (i) to (l) are added (the version comparison between `load` and `call`, what a `call` may do, the inputs of a derived key, the record of a `call` whose write did not commit); in rule (h) the `call` creates the intent and never confirms it, and its key is `auth:<order_id>:<order_version>:<attempt>`. The client secret is also kept, encrypted, in the stored response of the request's idempotency key (ADR-0014 amendment 15).*

Owner and timing: TASK-020 part 020-C (D-ARCH-108). Until it merges the descriptor has no phase fields and the T-83 lint (ADR-0005 am. 11 item 20) is the only control; no `transaction: 'tenant'` route with external I/O may merge before it.

## Amendment (2026-11-14, PR #38 security review PR38-SEC-02 (LOW); D-ARCH-114; narrows item 2 of the 2026-11-13 generated-client amendment)

Item 2 of the 2026-11-13 amendment allows a **value** import of `@platform/prisma/client` from the whole `db-platform-core` category (`apps/*/src/platform/db/**`, both apps), while its items 3 and 4 say that `apps/api/src/platform/db/generated.ts` is the one value importer and that the worker has no composition of its own. The lint was wider than the rule, and the gap included `apps/worker/src/platform/db/`, which no CODEOWNERS line covered until PR #38 (D-TASK020-43). Verified before ruling: on `main` the only non-fixture value importer in the repository is `apps/api/src/platform/db/generated.ts` (`client.ts` imports the SQL driver and the adapter only), so the narrowing changes no code.

1. **The allow selects the file, not the category.** The allow policy that follows the `prisma-generated` value disallow selects `from: { file: { path: 'apps/api/src/platform/db/generated.ts' } }` plus the `prisma`, `tools-db` and `test` categories. Consequence: no other file under `apps/api/src/platform/db/`, and nothing under `apps/worker/src/platform/db/`, has a static value path to the generated client. The worker keeps taking the runner from `createRuntimeServices` and its types from `@platform/api/runtime` (item 4 unchanged); a worker repository may still type-import. `PRISMA_GENERATED_VALUE_MESSAGE` names the file and D-ARCH-114. The `db-root-client` category pattern keeps `apps/*/src/platform/db/generated.ts`, so a future worker `generated.ts` would still be private to its folder, but privacy is not permission: that pattern grants no value path.
2. **Residual, stated in the policy comment.** The dynamic forms the finding probed (template-literal `import()`, `createRequire`) are outside static import analysis. They stay covered by `platform/prisma-client-construction` (a `new PrismaClient` anywhere else) and by CODEOWNERS for `apps/worker/src/platform/db/` (D-TASK020-43, `REQUIRED_CODEOWNED_PATHS`), which PR #38 added as the default closure of PR38-SEC-02. The narrowing converts the static case from a review control into a build failure; it does not replace the ownership line.
3. **Encoding and owner.** TASK-020 part 020-C (`lint` lock; `eslint.config.mjs` is an owned path, so the security record of that PR covers it): fixtures under `tests/fixtures/lint/layering/` — a value import from `apps/worker/src/platform/db/` fails; a value import from a second `apps/api/src/platform/db/` file fails; `generated.ts` passes; a `prisma/tests` value import passes; the 2026-11-13 fixtures stay green.

## Amendment (2026-11-16, SHEET-FOLD-8: PR #44 security review PR44-SEC-01 (MEDIUM, pre-existing), D-SEC-PR44-01 / D-ORCH-069; PR #54 (020-D) D-TASK020-83/85/86/89; D-ARCH-130; corrects item 2 of the 2026-11-14 amendment)

Item 2 of the 2026-11-14 amendment called `createRequire` a dynamic form "outside static import analysis" that `platform/prisma-client-construction` and CODEOWNERS cover. Both halves were wrong when written, as PR44-SEC-01 showed on `main`: `createRequire` is a **static** import of `node:module` whose loads the import controls simply did not resolve (`boundaries` saw only the inline `createRequire(x)('m')`, `moduleSourceVisitor` only a bare `require('m')`), and `const C = req('@platform/prisma/client').PrismaClient; new C({})` built a second client past the constructor rule. The residual is restated:

1. **Static loaders are resolved, then refused.** 020-C (PR #44, D-TASK020-62..72): `isRequireCall` resolves `createRequire` through import aliases, namespace and default members and held loaders (`const req = createRequire(u); req('m')`); every visitor-based import rule uses it; `createRequire` is allowed in `apps/*/src` and `packages/*/src` only as `createRequire(<x>).resolve('<literal>')`; `prisma-client-construction` catches aliased constructors and is on in `platform/db` except the three homes. 020-D (PR #54, in its fix cycle; D-TASK020-83/86/89): `node:module` and `node:process` are refused repository-wide by `no-restricted-imports` (tooling may import `builtinModules` only), `getBuiltinModule` and `dlopen` are matched on any receiver, `static-module-specifier` splits its strictness (any use of `import('node:module')` other than a static member read, static-key destructuring, one `const` or an inline `.then` parameter is a loader), and the dynamic `Module._load` / `register` / `registerHooks` members (PR #54 R1-m1 / PR54-SEC-03) close in the same fix cycle. What a reviewer still has to catch is not "a `createRequire` somewhere" but a `platform/db` file other than the three homes re-exporting the generated module whole (PR44-SEC-01 D04/D06) — and that folder is CODEOWNED (D-TASK020-43).
2. **What is dynamic.** A computed or template-literal `import()` specifier is the one form static analysis cannot name; `static-module-specifier` refuses it outright, so it is a build failure, not a review item.
3. **Reading rule.** Where this ADR or ADR-0005 item 22 says "a fixture each and nothing more" about loader shapes, read "refused by configuration, with a fixture each" (ADR-0005 amendment of the same date).

## Amendment (2026-11-20, the phases around the idempotency claim, the version check before `call`, and what a `call` may do: conditions QG-040-C1 (b) and QG-040-C2 of D-QG-003; product rule D-PM-083; PR040-SEC-08; D-ARCH-202; amends the route I/O phases amendment of 2026-11-13 and the example in "Route metadata")

The handler transaction that follows a `call` can fail to commit: its conditional write loses a race (412), a statement fails, admission is refused, the claim of its idempotency key is lost, or the process dies. The 2026-11-13 amendment answered this with one rule, a key derived from `loaded`, which makes a repeat harmless. It did not say what a `call` may do when nobody repeats the request. ADR-0014 amendment 7 then moved the `If-Match` comparison into the handler, behind the `call`. This amendment closes both.

1. **Rule (d), made precise.** For a request that carries an `Idempotency-Key`, the tx slot runs in this order: the claim; the re-authentication check of a route with `reauth` metadata (TASK-187); `load`; `call`; `handler`; the completion; `afterCommit`.
   - "The idempotency window wraps all four phases" holds for a request that executes.
   - A refused proof leaves the window: the claim is released and nothing is stored under the key (ADR-0014 amendment 7).
   - The lease of the claim is renewed before `call` and before `handler`. A renewal that finds the claim taken over ends the request with 409 (ADR-0014 amendment 10).
2. **Rule (i): the version is compared after `load` and before `call`.** It applies to a route that requires `If-Match` and declares `call`.
   - The route declares where `load` returns the identifier and the version of the row. The tx slot compares them with the expected value of step 7b after `load` and before `call`. A stale request is answered 412 `CONCURRENCY_CONFLICT` with the current ETag, and `call` does not run.
   - `defineRoute` refuses a route that requires `If-Match`, declares `call` and declares no such source.
   - The conditional write of the handler stays the deciding check, because the row can change during `call`. A route without `call` has only that check.
   - This is the requirement of REQ-API-013 and DR-A08 as D-PM-083 worded them: a request that is already stale when it arrives reaches no carrier and no gateway.
   - Owner: TASK-096. Until it merges, step 7b is a pass-through and no route enforces `If-Match`. TASK-096 declares the source on every such operation that is mounted when it merges; a later task declares its own.
3. **Rule (j): what a `call` may do.** A `call` makes an external effect only if that effect is right whatever happens to the handler transaction that follows. Three classes qualify:

   | Class | Meaning | Examples |
   |---|---|---|
   | `read` | asks a provider or computes; changes nothing outside the process | rates, address suggestions, service points, pickup availability, tracking, retrieving an intent, the object read of an integrity check, password hashing |
   | `inert` | creates an object at a provider that binds nobody until a later step, which needs the committed write, confirms it | a PaymentIntent that is created and not confirmed; a SetupIntent |
   | `reachable` | acts on a provider object that a row committed by an earlier request names; the next request, webhook or sweep derives the state from the provider again | `confirmPayment`: retrieve the intent and void the authorisation when the CVC rule requires it |

   - An effect that is right only if the state change commits is made after the commit: the handler transaction writes the change and its outbox event, and a worker step persists its reference, calls with its own key and records the outcome (ADR-0005 item 18 (a); ADR-0014 G2 and G3). This covers a carrier booking, cancellation and pickup, a capture, a refund, and a message to a person.
   - A hold on a card is placed only on an intent that a committed payment row names. So `checkoutOrder` creates its intent in `call` and never confirms it there, with the Mock gateway as with Stripe. The confirmation comes from the browser, which needs the client secret of the committed response, or from a step that follows `order.checkout_started`.
   - Consequence: a request that loses the race at its conditional write after `call` has made nothing that must be reversed. What can remain is an intent that binds nobody and that no row names (risks.md R-ARCH-39).
4. **Rule (k): a derived key covers every input of the provider request.** "Derived from `loaded`" is not enough when the key names the aggregate and not its state: a provider that compares the parameters of a repeated key refuses the second request when they differ, and Stripe does. The key therefore contains the version of the aggregate that `load` read, or a digest of the inputs. For the checkout: `auth:<order_id>:<order_version>:<attempt>`. A repeat of the same execution finds the same object, and an execution on a changed order creates a new one.
5. **Rule (l): the record, and the list of `call` routes.**
   - When a handler transaction does not commit after `call` returned, the tx slot logs WARN `api.call_without_commit` with the operation id, the status of the answer and the correlation id, and no value. The outbound call has its own log line under the same correlation id (REQ-PLAT-011). A lost race is not audited (a 412 is not, D-PM-083); a claim lost after `call` is (D-PM-084).
   - The route-metadata test pins the operations that declare `call`, each with its class. A `call` on an operation that is not in that table fails the test, so a new one is a reviewed change, like the set of `transaction: 'none'` operations.
   - Each `inert` and `reachable` row has a fault test: the handler transaction fails after `call`; the provider fake shows no hold, charge, booking or message that no row names; the next request converges.
   - Owner: TASK-096 for the event, the table and its rows for the routes that exist when it merges. A later task adds its row and its fault test.
6. **The example in "Route metadata".** It shows where the phase fields go. It is not the shape of `cancelShipment`: that operation has no `call`. Its handler makes the transition to `CANCELLED` under the version check, and the cancellation saga calls the carrier after the commit (ADR-0014). Under rule (j) a carrier cancellation could not be a `call`: it is right only if the transition wins the race against the first scan (DR-B20).

Not chosen:
- **A write phase before `call`** that records the intent, with a second write afterwards. It is the complete answer for an effect that binds someone, and it is what a saga step does. In a request it would mean two write transactions, two places for the audit entry and for the completion of the idempotency key, and a reconciliation job for the rows whose second write never came. Rule (j) keeps such effects out of the request instead.
- **A compensation after the rollback**, declared by the route and run by the slot or recorded as an outbox event. It runs exactly when the database has just failed the request, so it cannot be relied on, and a compensation that voids an authorisation races the retry that would adopt it.
- **Letting the `call` run first and answering 412 afterwards** (the second option of QG-040-C2). It contradicts REQ-API-013 as worded by D-PM-083.

## Reversibility

High within the monolith (module moves); medium for extraction (needs network interfaces).
