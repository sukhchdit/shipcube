# BRIEF: Multi-Carrier Shipping Platform ("the Platform", repo: shipcube)

- **Received:** 2026-11-12 via `/sdlc-start shipping-platform-brief.md  Scope this run to milestones M0 and M1 in §12. Treat M2–M5 as the backlog.`
- **Source document:** `shipping-platform-brief.md` (repo root) — reproduced verbatim below the summary.

## Run scope instruction (verbatim from the human)
> Scope this run to milestones M0 and M1 in §12. Treat M2–M5 as the backlog.

## Structured summary (orchestrator)

**Product.** A multinational carrier-aggregation shipping marketplace + operator back-office ERP + partner developer platform. Customers quote, compare, book, pay, print labels/customs docs, schedule pickups and track across DHL Express, FedEx, UPS (+ a deterministic Mock carrier). Brand is configuration (`BRAND_*`).

**Standing obligations.** (1) Per-country compliance as data (compliance packs); (2) immutable, hash-chained, partitioned audit trail of every C/U/D/View/Download; (3) explicit RBAC permission on every endpoint, screen and export.

**Fixed stack (brief §3, CLAUDE.md §2).** TypeScript strict. React + React Router (framework-mode pre-rendering for public pages) + Vite + Tailwind + Radix + TanStack Query/Table + RHF + Zod + react-i18next (en/es/fr). Node 20 LTS + Express + Prisma + Joi + Pino + JWT access/refresh. PostgreSQL (UUIDv7, soft delete, RLS, monthly-partitioned audit). BullMQ + Redis. Docker multi-stage + Compose. AWS (ECS on EC2, RDS, S3, etc.) via Terraform + Checkov. GitHub Actions. Jest, Supertest, Testcontainers, nock, Playwright, axe, k6, ZAP, Semgrep, Gitleaks, Trivy.

**Architecture.** Modular monolith (`apps/api`, `apps/worker`, `apps/web`, `apps/admin`; `packages/shared|ui|carriers|pricing|audit|authz|config`; `prisma`, `infra`, `tests`). Layering routes→controller→service→repository enforced by ESLint. Route metadata declares permission + audit descriptor + validation schema (build-time test). Transactional outbox. Carrier adapter interface (§4.3). Pure pricing engine with integer minor-unit money (§4.4). Shipment state machine and idempotent booking saga (§4.5).

**THIS RUN = M0 + M1 (brief §12).**
- **M0 Foundation:** monorepo, tooling, Docker Compose, CI skeleton, typed config, error handling, logging, identity & sessions, organisations, RBAC catalogue, audit middleware with immutable partitioned store, RLS, design system + app shells (web, admin), i18n scaffolding, OpenAPI pipeline, Mock carrier, seed data. *Exit demo:* sign in to both apps; guest gets a mock quote; one mock booking flows API→queue→worker; audit entries appear in the viewer; RBAC and audit test generators pass.
- **M1 Customer MVP:** quote & comparison with DHL/FedEx/UPS sandboxes; pricing engine v1 (margins, fuel, cover, tax, currency); booking wizard; basket; Stripe test-mode checkout; labels & customs docs; pickup scheduling; tracking + public page; customer account; email notifications; en/es/fr. *Exit demo:* a real sandbox label from each of the three carriers, booked and paid end to end from the customer app on phone and desktop.

**BACKLOG (not built this run):** M2 Admin ERP core, M3 Partner platform, M4 Ops & finance depth, M5 Production readiness, LATER items. Seams only where the brief requires them.

**Key NFRs (§9).** API p95 ≤ 300 ms / p99 ≤ 800 ms @ 300 rps; rate shopping first result ≤ 1.5 s, complete ≤ 5 s; 99.9% availability; RPO ≤ 5 min / RTO ≤ 60 min; LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1; WCAG 2.2 AA; ASVS L2, no open Critical/High; 100% audit capture; zero cross-tenant access; coverage ≥ 85/75, ≥ 95% on pricing/ledger/audit/authz.

**Defaults already in the brief (§14):** launch countries US, IN, UK, CA + EU template (US→IN primary lane); currency/units follow origin; Stripe + PayPal (PayPal is M4); Part 11 controls only; inbound email per tenant; ECS on EC2; legacy migration at M5; documents + parcels; partner pays carrier directly; email+password (+ optional MFA); placeholder brand; no cloud spend during build.

**Hard guardrails.** No production carrier/payment endpoints; sandbox/test only; Mock carrier until sandbox creds supplied via env/secrets outside repo; legacy backup never touched; no secrets in repo; no paid cloud resources; Terraform plan/validate/Checkov only (no apply).

---

## Verbatim source: shipping-platform-brief.md

# Master Build Brief: Multi-Carrier Shipping Platform

**What this file is:** the complete product and engineering brief for Claude Code. It defines what to build, the fixed technology stack, the architecture rules, the delivery order and the definition of done.

**How to run it**

- **With the autonomous SDLC agent team** (`claude-code-sdlc-agent-team.md` in the same repo): bootstrap the team, then run `/sdlc-start shipping-platform-brief.md`. Appendix C has the exact steps and the operating parameters to set first.
- **Without the agent team:** start Claude Code in an empty git repo and say: *"Read `shipping-platform-brief.md` in full. Follow §13 (Working Agreement) and begin with Milestone M0 in §12."*

Throughout this brief, **MUST** marks a hard requirement, **SHOULD** a strong default that needs an ADR to change, and **LATER** something you design a seam for now but do not build.

---

## 1. Mission and Role

You are acting as Principal Software Architect, Senior Full-Stack Engineer, DevOps and Cloud Infrastructure Architect, Security and Compliance Architect, and Product Engineering Partner.

Build an enterprise-grade, horizontally scalable, secure, audit-ready **multinational shipping platform** on which people and businesses search, compare, book, pay for and track shipments across DHL, FedEx, UPS and further carriers, and on which the operator runs the whole business from one back office.

Three standing obligations apply to every feature:

1. **Compliance is per country.** The system operates in several countries and must satisfy each one's rules. Country rules are data (§4.12), never hard-coded branches.
2. **Audit-ready at all times.** Every create, update, delete, view and download is captured in an immutable, exportable audit trail (§4.9).
3. **Role-based access everywhere.** No endpoint, screen or export exists without an explicit permission (§4.2).

The brand name, logo, colours and domains are configuration (`BRAND_*`), because white-labelling is on the roadmap. Refer to the product as "the Platform" in code and docs.

---

## 2. Product Overview

### 2.1 What it is

A carrier-aggregation marketplace plus an operations ERP plus a developer platform:

| Surface | Users | Purpose |
|---|---|---|
| **Customer web app** | Guests, individual shippers, business customers | Get instant quotes, compare carrier services, book, pay, print labels and customs documents, schedule pickups, track, manage account |
| **Admin web app (ERP)** | Operator staff: operations, finance, support, sales, compliance, administrators | End-to-end back office: orders (including placing orders **on behalf of customers**), customers, carriers, pricing, finance, reconciliation, exceptions, claims, partners, content, reports, audit |
| **Partner workspace + public API** | Small shipping companies and integrators | Connect **their own** DHL, FedEx or UPS accounts, then rate, book and track through the Platform's API and UI using those accounts |

### 2.2 Business model to support

- **Platform carrier accounts:** the operator's negotiated carrier accounts. Customer price = carrier cost + configurable margin − discounts + surcharges + tax.
- **Partner carrier accounts (bring your own account):** a partner's own carrier credentials. The carrier bills the partner directly; the Platform meters usage for a platform fee (subscription billing is LATER, metering is now).
- **Own-rate services:** operator-defined services priced from zone and weight-band rate cards rather than a live carrier quote (for consolidated or warehouse-routed services).

### 2.3 Personas

Guest shipper, registered individual, business customer (multi-user organisation with roles), partner owner, partner developer, operations agent, finance officer, support agent, sales/account manager, compliance officer/auditor (read-only plus audit export), super administrator.

### 2.4 Benchmark

Appendix D summarises what Parcel Monkey, CourierPoint, Garudavega, Shiprocket and NimbusPost offer. Match or exceed those capabilities and interaction patterns. Do **not** copy their text, imagery, branding or layouts.

---

## 3. Technology Stack (fixed)

The stack below is a constraint, not a suggestion. ADR-0001 records it; do not re-select it. Use **TypeScript in strict mode** across frontend, backend, workers and infrastructure code.

### 3.1 As specified

| Layer | Technology |
|---|---|
| Frontend | React (latest stable), React Router, Axios, React Hook Form, Zod, i18n (English, Spanish, French), JWT-based auth |
| Backend | Node.js (current LTS), Express.js, Prisma ORM, Joi validation, JWT access + refresh tokens, RBAC, structured logging with Pino |
| Database | PostgreSQL: UUID primary keys, soft deletes, row-level security, partitioned audit tables, explicit indexing strategy, migration tooling |
| Jobs | BullMQ + Redis |
| Containers | Docker for frontend and backend, multi-stage optimised builds, Docker Compose for local development |
| Cloud (AWS) | EC2 behind an Application Load Balancer with Auto Scaling, RDS PostgreSQL, S3, IAM, CloudWatch, AWS WAF, AWS Backup, VPC with private subnets, Secrets Manager, SES, Lambda |
| CI/CD | GitHub + GitHub Actions: tests, Docker image builds, security scanning, deployment to AWS, Infrastructure as Code with Terraform |
| Testing | Jest, integration tests, API tests, RBAC tests, audit-log validation tests, k6 load tests, OWASP security checks |

### 3.2 Sanctioned additions (SHOULD; each gets a one-paragraph ADR)

- **Build and UI:** Vite; Tailwind CSS with design tokens; Radix UI primitives for accessible components; TanStack Query (server state, on top of Axios); TanStack Table (data grids); `react-i18next`; Recharts; a motion library for micro-interactions.
- **Backend:** `helmet`, `express-rate-limit` with a Redis store, `jsonwebtoken` or `jose`, `bcrypt`, `opossum` (circuit breaker), `pdfkit` or headless Chromium for PDFs, `exceljs` for bulk files, OpenTelemetry SDK.
- **Testing:** Supertest, Testcontainers (PostgreSQL, Redis), `nock` for recorded carrier fixtures, Playwright for end-to-end and cross-browser runs, `axe-core`, OWASP ZAP baseline, Semgrep, Gitleaks, Trivy.
- **AWS:** ElastiCache for Redis (required by BullMQ and rate limiting), KMS, CloudFront in front of static assets, ECR.

### 3.3 Resolved ambiguities in the stack file

| Topic | Decision |
|---|---|
| Zod **or** Yup | **Zod** on the frontend. Joi stays on the backend as specified. Limits, enums, regexes and field names shared by both live in `packages/shared` so the two validators cannot drift; a test asserts parity on the critical schemas (address, parcel, customs item). |
| Winston **or** Pino | **Pino** (JSON, low overhead), with correlation ID, tenant ID and actor ID on every line and a redaction list for secrets and personal data. |
| Terraform **or** CDK | **Terraform**, remote state in S3 with locking, policy-as-code with Checkov. |
| "EC2 (App Hosting)" with Docker | Containers run on EC2 instances in an Auto Scaling Group. Default: ECS with an EC2 capacity provider for rolling and canary deploys. Plain ASG with launch templates is the alternative; decide in an ADR. |
| Row-level security "if applicable" | Applicable. Every tenant-owned table carries `org_id` and an RLS policy (§4.10). |
| "Electronic signature compliance (21 CFR Part 11)" | Part 11 is a US FDA rule for regulated life-science records. It is **not** treated as a certification target here. Its useful controls are adopted for critical actions: unique user identity, re-authentication at the moment of signing, a mandatory reason for change, a signature record bound to the audited record, and tamper-evident audit. See §4.9. If the operator later ships regulated pharmaceutical goods under contract, formal validation becomes a separate project. |
| "Dedicated email id per study" (SES + Lambda) | Reinterpreted for this domain as a **dedicated inbound email address per tenant** (operator, partner or business customer), for example `acme-ops@inbound.<domain>`. SES receives the mail, stores it in S3, and a Lambda posts it to the API, which attaches it to the matching shipment, ticket or carrier invoice. |
| Public marketing and quote pages | SEO matters for the public site. Public pages MUST be pre-rendered or server-rendered (React Router framework-mode pre-rendering or an equivalent); authenticated areas are client-rendered. |

---

## 4. Architecture Directives

### 4.1 Shape and repository layout

A **modular monolith** with strict bounded contexts, deployed as two processes from one codebase (`api` and `worker`), plus two static frontends. Modules talk through in-process interfaces and a transactional outbox, so any module can be extracted later without a rewrite.

```
/apps
  /web          Customer app + partner workspace (React)
  /admin        Admin ERP (React)
  /api          Express API (REST, /api/v1)
  /worker       BullMQ processors and schedulers
/packages
  /shared       Types, constants, enums, validation rule constants, money and unit helpers
  /ui           Design tokens and shared React components used by web and admin
  /carriers     Carrier adapter interface + DHL, FedEx, UPS and Mock adapters
  /pricing      Pure pricing engine (no I/O)
  /audit        Audit middleware, diffing, redaction, hash chain
  /authz        Permission catalogue, policy checks, RBAC test generator
  /config       Typed, validated environment configuration
/prisma         Schema and migrations (SQL migrations for RLS, partitions, triggers)
/infra          Terraform modules and environment overlays
/tests          e2e (Playwright), load (k6), contract, security
/docs           ADRs, architecture, API, runbooks, compliance packs
```

Backend modules (one folder each under `apps/api/src/modules`, each with `routes`, `controller`, `service`, `repository`, `schemas`, `policies`, `events`, `tests`): `identity`, `organisations`, `quotes`, `shipments`, `orders`, `payments`, `ledger`, `invoicing`, `carriers`, `pricing`, `tracking`, `pickups`, `documents`, `customs`, `compliance`, `claims`, `support`, `notifications`, `partners`, `developer-api`, `webhooks`, `reconciliation`, `content`, `reports`, `audit`, `admin-settings`.

Layering rule: `routes → controller → service → repository`. Controllers hold no business logic. Services never import Express types. Repositories are the only code that touches Prisma. Enforce with ESLint boundary rules.

### 4.2 Tenancy, identity and access

- **Tenants:** `Organisation` with type `OPERATOR`, `BUSINESS_CUSTOMER`, `PARTNER`, or `INDIVIDUAL` (a personal organisation of one). Every tenant-owned row carries `org_id`.
- **Users** belong to one or more organisations through memberships that carry roles.
- **RBAC:** permissions are fine-grained strings (`shipment:create`, `shipment:create:on_behalf`, `refund:approve`, `audit:export`, …) declared in one catalogue in `packages/authz`. Roles are named sets of permissions, editable by administrators. Seed these roles:
  - Operator: Super Admin, Admin, Operations, Finance, Support, Sales, Compliance Auditor (read-only + audit export), Content Manager
  - Customer organisation: Owner, Admin, Shipper, Finance, Viewer
  - Partner organisation: Owner, Developer, Operations, Finance
- **Every route declares** its permission, its audit descriptor and its validation schema in route metadata. A build-time test fails if any route lacks one of the three.
- **Authentication:** email + password (bcrypt, cost ≥ 12); short-lived JWT access token held in memory; rotating refresh token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie with reuse detection and server-side revocation; email verification; password reset with single-use expiring tokens; account lockout and progressive delay; session list with remote sign-out.
- **MFA:** TOTP with recovery codes. Mandatory for all operator staff and partner owners, optional for customers.
- **API clients:** partner API keys (shown once, stored hashed, prefixed `pk_test_` / `pk_live_`, scoped, revocable, with last-used tracking).
- **Acting on behalf:** operator staff with `shipment:create:on_behalf` can create quotes, orders and payments for a customer. The record stores both `created_by_user_id` and `on_behalf_of_org_id`, the audit entry records both, and the customer sees "Booked by <staff name>" in their history.

### 4.3 Carrier integration layer

One interface, many adapters. Nothing outside `packages/carriers` knows a carrier's wire format.

```ts
interface CarrierAdapter {
  readonly code: 'DHL_EXPRESS' | 'FEDEX' | 'UPS' | 'MOCK' | string;
  capabilities(): CarrierCapabilities;           // which operations and options this adapter supports
  getRates(req: RateRequest, ctx: CarrierContext): Promise<RateQuote[]>;
  createShipment(req: ShipmentRequest, ctx: CarrierContext): Promise<ShipmentConfirmation>; // labels, AWB, documents
  cancelShipment(ref: CarrierShipmentRef, ctx: CarrierContext): Promise<CancelResult>;
  schedulePickup(req: PickupRequest, ctx: CarrierContext): Promise<PickupConfirmation>;
  cancelPickup(ref: PickupRef, ctx: CarrierContext): Promise<CancelResult>;
  track(trackingNumbers: string[], ctx: CarrierContext): Promise<TrackingResult[]>;
  validateAddress?(addr: Address, ctx: CarrierContext): Promise<AddressValidation>;
  findServicePoints?(q: ServicePointQuery, ctx: CarrierContext): Promise<ServicePoint[]>;   // drop-off locations
  uploadCustomsDocuments?(req: PaperlessRequest, ctx: CarrierContext): Promise<void>;
  estimateLandedCost?(req: LandedCostRequest, ctx: CarrierContext): Promise<LandedCost>;
}
```

Requirements:

- **Adapters to deliver:** DHL Express (MyDHL API), FedEx (REST), UPS (REST, OAuth), and a deterministic **Mock carrier** used for local development, CI and demos. The system MUST be fully usable end to end with only the Mock carrier configured.
- **`CarrierContext`** carries the carrier account (platform-owned or partner-owned), the environment (`sandbox` or `production`) and the correlation ID. Environment is a property of each carrier account, never a global flag, so sandbox and live accounts coexist.
- **Sandbox first:** all development and automated testing use the DHL, FedEx and UPS sandbox environments (Appendix B). Before coding each adapter, read the carrier's current official documentation and confirm endpoints, API versions and authentication; record what you confirmed in the adapter's README. Do not rely on memory for versioned paths.
- **Credentials:** carrier secrets are never stored in plain columns. Platform accounts reference AWS Secrets Manager. Partner-supplied credentials are envelope-encrypted with a per-tenant KMS data key before storage, never returned by any API after creation, and never logged. OAuth tokens are cached in Redis until shortly before expiry.
- **Resilience:** per-call timeout, retry with exponential backoff and jitter on idempotent operations only, one circuit breaker per carrier account, bulkheads so one slow carrier cannot exhaust the pool.
- **Rate shopping:** fan out to all eligible carrier accounts in parallel with a per-carrier deadline. Return partial results when a carrier is slow or down, and stream results to the browser as each carrier answers (server-sent events). Cache identical rate requests briefly in Redis.
- **Normalisation:** map carrier services, surcharges, errors and tracking events to Platform canonical codes. Keep the raw carrier request and response (secrets and personal data redacted) in S3, linked to the shipment, for support and dispute work.
- **Onboarding a new carrier** must require only a new adapter, a capability declaration and seed data. Prove this by having the Mock carrier implement the same contract test suite as the real ones.
- **Third-party account rules:** before building partner account connection, check each carrier's programme rules for platforms that ship on other companies' accounts (for example UPS's OAuth authorisation flow for third-party access and FedEx's integrator programme) and record the outcome in an ADR. Design the connection flow so either "customer enters credentials" or "customer authorises via OAuth" works per carrier.

### 4.4 Rating and pricing engine

`packages/pricing` is a pure, deterministic library: same inputs, same output, no I/O. It receives carrier cost quotes plus pricing configuration and returns a fully itemised price.

Inputs and rules it MUST support:

- **Billable weight:** the greater of actual and volumetric weight, with the volumetric divisor configured per carrier service and unit system (metric and imperial both supported; users can enter either).
- **Cost source per service:** live carrier rate, or operator rate card (zones → countries/postcode ranges, weight bands → price).
- **Margin and discount rules** by carrier, service, carrier account, content type (document or parcel), weight band, lane (origin/destination), customer segment and date range, with a default rule and explicit precedence.
- **Surcharges:** fuel (percentage by date range), remote area (by postcode list), peak or emergency, residential, oversize, pickup fee; each either passed through from the carrier or configured.
- **Protection cover:** included liability (percentage, per kilogram or fixed), optional additional cover priced as a percentage with a minimum charge and a maximum insurable value.
- **Customer discounts:** by email domain, by specific customer or organisation, coupon codes, volume tiers; date-bounded; stackability rules explicit.
- **Tax:** per-country tax rules (VAT, GST, sales tax) from the compliance pack; tax-inclusive or exclusive display per country.
- **Currency:** price in the customer's currency using a stored FX rate snapshot; store carrier cost currency, sell currency, rate and timestamp on the quote.
- **Output:** an immutable list of charge lines (code, label, amount, tax, source) plus totals and a machine-readable explanation of which rules fired. The booked shipment stores this snapshot; later rule changes never alter a booked price.

Money is stored as integer minor units with an ISO 4217 code. No floating-point arithmetic on money anywhere. Use property-based tests for the engine.

### 4.5 Quote, order and shipment lifecycle

- **Quote:** a separate entity with an expiry, never a half-built shipment. Guests can quote without an account; a quote is claimed by the account that books it.
- **Order:** a basket of one or more shipments paid together.
- **Shipment state machine** (explicit, enforced in the service layer, every transition audited): `DRAFT → QUOTED → PENDING_PAYMENT → PAID → BOOKING → BOOKED → LABEL_READY → PICKUP_SCHEDULED | DROPPED_OFF → IN_TRANSIT → CUSTOMS_HOLD? → OUT_FOR_DELIVERY → DELIVERED`, with side paths `EXCEPTION`, `RETURNED_TO_SENDER`, `CANCELLED`, `VOIDED`, `REFUNDED`, `CLAIM_OPEN`.
- **Booking saga:** authorise payment → create carrier shipment → capture payment → generate documents → schedule pickup → notify. Each step is idempotent and has a compensation (void label, release authorisation, refund). A failed carrier booking never leaves a captured payment without a shipment, and a retry never buys a second label. Use idempotency keys end to end and a transactional outbox for events.
- **Shipment directions:** export, import and domestic. **Content types:** document and parcel now; pallets and freight LATER (model `package_type` so they slot in).
- **Collection modes:** courier pickup with date and time window, or drop-off at a service point.

### 4.6 Tracking

- Canonical status taxonomy shared by all carriers, with the carrier's original event preserved.
- Updates arrive by carrier push where the carrier offers it and by scheduled polling otherwise, with adaptive intervals (frequent while moving, sparse when idle, stopped when final).
- Each new event can trigger notifications, partner webhooks and exception-queue entries.
- Public tracking page by tracking number, order number or customer reference, with no login, rate-limited, exposing no personal data beyond city-level location.

### 4.7 Payments, wallet and ledger

- **Gateway abstraction** with Stripe (test mode) first and PayPal second; further regional gateways plug in the same way. Card data never touches Platform servers: hosted fields or redirects only, keeping PCI DSS scope at SAQ A.
- **Methods:** card, PayPal, saved payment methods (gateway tokens only), prepaid wallet, credit account with limit and terms for approved businesses, payment link sent by staff, and recorded offline payment (finance permission + reason).
- **Double-entry ledger** for wallet balances, credit accounts, refunds, adjustments and partner fees. Balances are derived from ledger entries, never stored as a mutable number alone.
- **Invoices and credit notes** as PDFs with per-country numbering and tax presentation; refunds full or partial with approval workflow.
- Gateway webhooks are verified, idempotent and replayable.

### 4.8 Public API and webhooks

- REST under `/api/v1`, contract-first with **OpenAPI 3.1**; Swagger UI and a developer portal page are generated from the spec. The same API serves the Platform's own frontends.
- Errors use RFC 9457 `application/problem+json` with stable error codes. Cursor pagination, consistent filtering and sorting, `Idempotency-Key` on all unsafe operations, ETags for optimistic concurrency, rate-limit headers, deprecation and sunset headers.
- **Test and live modes** selected by the API key prefix: test keys reach only sandbox or mock carrier accounts and test payment modes.
- **Outbound webhooks** to partners: HMAC-signed, timestamped, retried with backoff, dead-lettered, visible and replayable in the partner workspace.
- Usage is metered per key and per organisation (requests, labels, tracked shipments) for future subscription billing.

### 4.9 Audit trail (non-negotiable)

**Capture:** every Create, Update, Delete, View and Download, plus login, logout, failed login, permission denial, export, impersonation-style on-behalf actions, configuration change and API-key use. Capture is automatic through middleware driven by route metadata; feature code never calls the audit writer by hand for standard CRUD.

**Each entry stores:** entry ID; occurred-at timestamp (UTC); user ID; role(s) at the time; actor type (user, API key, system job); organisation ID; on-behalf-of organisation ID; IP address; device and browser (parsed user agent plus raw string); source application (web, admin, API, worker); correlation ID and session ID; action type; entity name; entity ID; old value and new value (field-level JSON diff); reason for change where applicable; outcome (success, denied, failed); previous-entry hash and entry hash.

**Immutability, enforced in the database, not by convention:**

- The application database role has `INSERT` and `SELECT` only on audit tables.
- `BEFORE UPDATE OR DELETE` triggers raise an exception for every role.
- Entries are hash-chained (SHA-256 over the canonical entry plus the previous hash). A scheduled job verifies the chain and alerts on any break.
- Audit tables are **range-partitioned by month**. Closed partitions are exported to S3 with Object Lock (compliance mode) and a SHA-256 manifest.
- No API, admin screen or migration may edit or delete audit entries. A test attempts both and must fail.

**Consistency:** for mutations, the audit entry is written in the same database transaction as the change, so neither exists without the other. For views and downloads of sensitive entities, the request fails closed if the entry cannot be recorded.

**Redaction:** passwords, tokens, secrets and payment data never enter audit values. Personal data in old/new values follows a field classification so the privacy-erasure process (§4.12) can work without breaking the chain; decide the mechanism (per-subject key shredding or tokenised identifiers) in an ADR.

**Electronic signature for critical actions:** refunds, manual price overrides, role and permission changes, carrier account changes, manual status changes, rate-card publication and audit exports require re-authentication (password or MFA) and a typed reason. The signature record (who, when, meaning, reason) is bound to the audit entry.

**Viewing and export:** an audit viewer in the admin app with filters for date range, user, role, organisation, entity, entity ID, action, IP and outcome; entity-level history shown on each record's detail page; export to **CSV and PDF** (asynchronous for large ranges); a **regulator-ready report** containing the query parameters, who generated it and when, the entry count, a content hash and the chain verification result. Viewing and exporting the audit trail are themselves audited.

### 4.10 Data model directives

- PostgreSQL via Prisma. **UUID primary keys** (UUIDv7 for index locality). Human-readable numbers (order, invoice, credit note) come from separate per-country sequences.
- Every table: `id`, `created_at`, `updated_at`, `created_by`, `updated_by`, `version` (optimistic locking); tenant-owned tables add `org_id`; soft-deletable tables add `deleted_at`, `deleted_by`. Soft delete is the default; hard delete exists only in the privacy-erasure and retention jobs.
- **Row-level security:** enable RLS on every tenant-owned table. The API sets `app.org_id` and `app.actor_id` with `SET LOCAL` inside each request's transaction (Prisma client extension). Operator staff access other tenants through an explicit, audited policy, not by bypassing RLS globally. Integration tests prove one tenant cannot read or write another's rows even with a crafted ID.
- RLS policies, partitions, triggers and partial indexes that Prisma cannot express are written as raw SQL inside Prisma migrations and covered by tests.
- All timestamps `timestamptz`, stored in UTC, displayed in the viewer's local time zone with the zone shown. Dates that are local by nature (pickup date, holiday) are stored as dates plus an IANA zone.
- **Indexing strategy** documented per table against named access patterns; composite indexes lead with `org_id`; partial indexes exclude soft-deleted rows; every list endpoint has a supporting index and a query-plan check in tests for the hot paths.
- Migrations follow expand → migrate → contract and are zero-downtime.
- Reference data to model: countries (postcode format, location type, currency, unit system), states and provinces, postcode ranges, zones, holidays per country, transit days, remote areas, prohibited and restricted items per country and carrier, HS codes, reasons for export, Incoterms.
- Files (labels, invoices, customs documents, uploads, exports) live in S3 with versioning, SSE-KMS, a stored **SHA-256 integrity hash**, virus scanning on upload, and short-lived pre-signed URLs issued only after a permission check. Every download is audited.

### 4.11 Security

Passwords with bcrypt; HTTPS enforced with HSTS; TLS 1.2+ everywhere including to RDS and Redis; encryption at rest on RDS, S3, EBS and ElastiCache; AWS WAF managed rules plus rate-based rules on the load balancer; application rate limiting per IP, user and API key (Redis-backed); CSRF protection on every cookie-authenticated endpoint; strict Content Security Policy and output encoding against XSS; Helmet secure headers; strict CORS allow-list; input validation and sanitisation at every boundary (Joi), with unknown fields rejected; parameterised queries only; SSRF-safe outbound HTTP (allow-list of carrier and gateway hosts); upload type, size and content checks; secrets only from Secrets Manager; least-privilege IAM with no long-lived keys (GitHub OIDC for CI); dependency, container and secret scanning in CI; OWASP ASVS Level 2 as the baseline; centralised error handling that never leaks internals; security events logged and alarmed.

### 4.12 Compliance packs (per country)

Each operating country has a versioned **compliance pack**: a data record plus optional strategy code, covering tax rules and invoice format, data-protection regime and retention periods, identity/KYC requirements for shippers, customs document requirements and value thresholds, prohibited and restricted goods, consent and cookie rules, and mandatory notices. Thresholds and rates are data because they change.

Cross-cutting capabilities the packs configure:

- **Privacy:** consent records, privacy notices per locale, data-subject export and erasure workflows, retention schedules enforced by jobs, data-processing inventory. Design for GDPR and UK GDPR, India's DPDP Act and US state privacy laws.
- **Trade compliance:** denied-party and sanctions screening of sender and receiver through a pluggable screening provider, with a manual review queue; prohibited-item checks during booking; dangerous-goods declarations; export reason, Incoterms and commodity codes on customs items.
- **KYC:** document capture and verification status per shipper where the origin country requires it, stored encrypted with restricted access and audited views.
- **Accessibility:** WCAG 2.2 AA on both apps.

Each pack carries `reviewed_by`, `reviewed_at` and `effective_from`. Engineering supplies the mechanism; the operator's legal and compliance advisers confirm the content. Seed packs for the launch countries in §14 and mark unreviewed values clearly in the admin UI.

### 4.13 Background jobs, notifications and documents

- **BullMQ queues** for carrier bookings, tracking polls, document generation, notifications, webhooks, bulk imports, reconciliation, exports, retention and audit archiving. Jobs are idempotent, retried with backoff, dead-lettered and observable in an admin "System health" screen.
- **Notifications:** email through SES now; SMS and WhatsApp through a provider interface (LATER for the providers, interface now). Templates are localised (en, es, fr), versioned and editable in the admin app with preview. Users control their preferences.
- **Documents:** shipping label, commercial or pro-forma invoice, customs declaration, pickup manifest, tax invoice, credit note, audit report. Each is versioned and hashed.
- **Feature flags:** a simple database-backed flag service with per-environment, per-organisation and percentage targeting, cached in Redis, audited on change.

---

## 5. Customer Web App: Functional Scope

**Public**

- Home with the quote widget above the fold: origin and destination country with postcode or city (format per country), residential or commercial, document or parcel, one or more packages with weight and dimensions, metric/imperial toggle, live volumetric and billable weight.
- **Results comparison:** cards or rows per service with carrier logo, service name, price, estimated delivery date, transit days, collection or drop-off, included cover, booking cut-off countdown and "printer required" hint. Sort by cheapest, fastest and best value. Filter by carrier, speed, collection mode and features. "Cheapest" and "Fastest" badges. Itemised price breakdown on demand. Results appear progressively as carriers respond, with skeleton placeholders. Compare up to three services side by side. Save or share a quote link.
- Public tracking; volumetric weight calculator; currency converter; prohibited-items lookup by country; country and service landing pages managed from the admin CMS; help centre and FAQs; contact and call-back form; cookie consent; language and currency switchers.

**Booking wizard** (resumable, autosaved, one step per screen on mobile)

1. Sender and receiver: address book, address validation and suggestions, tax references where required.
2. Contents: description, reason for export, itemised customs lines with commodity-code search, country of manufacture, values; prohibited-item and sanctions checks inline.
3. Collection: pickup date and time window constrained by cut-off times and holidays, or nearest drop-off points on a map and list.
4. Extras: additional protection cover, delivery options, reference fields.
5. Review and basket: add more shipments to the same order; coupon code.
6. Checkout: card, PayPal, saved method, wallet or credit account.
7. Confirmation: labels and customs documents to download or email, pickup reference, next-step instructions, tracking link.

**Account**

Dashboard (recent shipments, items needing action, spend); shipments with search, filters and saved views; drafts and saved quotes; repeat a past shipment; cancel and refund requests; address book with import; payment methods; wallet top-up and statement; invoices and credit notes; claims; support tickets with messaging; organisation, team members and roles; notification preferences; security (password, MFA, sessions); privacy (export my data, delete my account).

**Business extras:** bulk shipment creation by CSV/Excel upload with row-level validation and a fix-in-place grid; multiple pickup addresses; cost-centre references; monthly statement.

---

## 6. Admin Web App (ERP): Functional Scope

1. **Dashboard:** bookings, revenue, margin, carrier mix, on-time rate, exceptions, pending tasks; date and country filters; role-specific widgets.
2. **Orders and shipments:** global search (tracking number, order number, name, email, phone, reference); full detail with timeline, charges, documents, carrier messages, notes and audit history; **create quote and order on behalf of a customer** through the same wizard with staff-only options (price override with reason, choose carrier account, charge saved method, send payment link, record offline payment); cancel, void, re-book, re-print, manual status change with reason.
3. **Customers and organisations:** profiles, contacts, KYC status and documents, credit limit and terms, pricing overrides, discounts, wallet, notes, communication history, merge duplicates, block or suspend.
4. **Carriers:** carriers, services (codes, direction, content type, weight and dimension limits, volumetric divisor, cut-off times, liability terms, drop-off support), carrier accounts and credentials with connection test, sandbox/production toggle per account, transit days, holidays, service availability rules and exceptions by lane.
5. **Pricing:** rate cards with versioning, draft/publish and effective dates; zones; margin and discount rules; surcharges; remote areas; protection-cover terms; coupons and customer discounts; FX rates; tax rules; rate-card import and export; a **price simulator** that explains which rules fired for a sample shipment.
6. **Finance:** payments, refunds with approval, invoices, credit notes, wallet and credit ledgers, aged receivables, **carrier invoice import** (CSV/Excel) and **reconciliation** against booked shipments, **billing discrepancies** (weight or dimension re-rates, surcharges added after the fact) with dispute tracking and the option to re-charge the customer, partner usage and fees, accounting export.
7. **Operations:** pickup board, daily manifests, **exception queue** (failed delivery, address problem, customs hold, damaged, lost, return to sender) with assignment, SLAs, customer contact and resolution actions; bulk imports monitor.
8. **Claims:** intake, evidence, carrier claim reference, decision, payout through the ledger.
9. **Support:** ticket inbox linked to shipments and customers, canned replies, inbound email threading.
10. **Partners:** applications and approval, carrier accounts connected, API keys, webhooks, usage, limits, plan assignment, suspension.
11. **Content:** landing pages, FAQs, help articles, banners, prohibited-items lists, legal documents with versions, notification templates; all localised.
12. **Reports:** shipments, revenue and margin by carrier, lane, customer and period; carrier performance; discount and coupon usage; tax reports per country; scheduled email delivery; CSV, Excel and PDF export.
13. **Users and roles:** staff users, role and permission matrix editor, MFA enforcement, sessions, access reviews.
14. **Audit:** viewer, exports and regulator report as in §4.9.
15. **Settings:** countries, provinces, postcode rules, currencies, units, number sequences, compliance packs, data retention, feature flags, integrations, branding.
16. **System health:** queue depths and failures, carrier API status and latency, webhook deliveries, scheduled jobs, error log search.

---

## 7. Partner Workspace and Developer Platform

- **Onboarding:** partner application, verification, approval by operator staff, acceptance of terms.
- **Carrier accounts:** connect own DHL, FedEx and UPS accounts by guided forms or OAuth where the carrier supports it; "Test connection"; choose sandbox or production; credentials write-only after save.
- **Shipping:** partners use the same quote, booking, tracking and bulk tools as customers, routed to their own carrier accounts. Operator may optionally also expose platform accounts to a partner.
- **Own customers and pricing:** a partner can define its own margin rules over its carrier costs and manage its own end customers (sub-accounts) within its tenant. Full white-label theming and custom domains are LATER; keep branding in tenant configuration now.
- **Developer tools:** API keys (test and live), scoped permissions, webhook endpoints with secret rotation and delivery logs, request logs, usage charts, interactive API reference, quick-start guides with code samples (cURL, Node.js), Postman collection, changelog.
- **API coverage:** address validation, rates, shipments (create, get, list, cancel), labels and documents, pickups, tracking, service points, webhooks, carrier accounts, customers.

---

## 8. UX and Visual Design Direction

The design must be **compact, elegant and interactive**, fully responsive, mobile-friendly and consistent across browsers.

- **Design system first:** tokens (colour, type scale, spacing, radius, elevation, motion) in `packages/ui`, themable per tenant, light and dark modes, contrast-checked. No hard-coded colours or spacing in feature code.
- **Density:** 14 px base UI text, 4/8 px spacing grid, 36 px controls on pointer devices and at least 44 px touch targets on touch devices. The admin app offers comfortable and compact table densities.
- **Hover and interaction:** every interactive element has distinct hover, focus-visible, active, disabled and loading states. Cards lift subtly with a border accent on hover; rows highlight with quick actions revealed; buttons and links transition in 120–180 ms. Apply hover styles only under `@media (hover: hover)` and give keyboard and touch users equivalent affordances. Respect `prefers-reduced-motion`.
- **Feedback:** skeleton loaders instead of spinners for content, optimistic updates where safe, inline validation on blur with clear messages, toasts for outcomes, confirmation with typed reason for destructive or signed actions, autosave indicators.
- **Every screen handles** loading, empty (with a next step), error (with retry), partial, permission-denied and offline states.
- **Customer app:** quote widget as the hero; sticky price summary during booking; step progress indicator; sticky primary action on mobile; map and list for drop-off points.
- **Admin app:** collapsible sidebar, breadcrumb, global search and command palette (Ctrl/Cmd + K), keyboard shortcuts, data grids with sticky headers, column chooser, saved views, server-side sort/filter/pagination, bulk actions, side-panel detail previews, and export.
- **Responsive:** mobile-first; breakpoints at 360, 768, 1024, 1280 and 1536 px; tables collapse to cards on small screens; no horizontal page scrolling.
- **Browser support:** current and previous major versions of Chrome, Edge, Firefox and Safari, plus iOS Safari and Android Chrome. Playwright runs the critical journeys on Chromium, Firefox and WebKit at mobile and desktop viewports.
- **Internationalisation:** all text through i18n keys (en, es, fr) with no concatenated strings; locale-aware numbers, dates, currencies, addresses and units; layouts tolerate 30% text expansion; use logical CSS properties so right-to-left languages can be added later.
- **Performance:** route-level code splitting, image optimisation, no layout shift; budgets in §9.

---

## 9. Non-Functional Requirements (default targets)

| Attribute | Target | Verified by |
|---|---|---|
| API latency (non-carrier endpoints) | p95 ≤ 300 ms, p99 ≤ 800 ms at 300 requests/s | k6 |
| Rate shopping | First result ≤ 1.5 s; complete or timed out ≤ 5 s with partial results | k6 with mock carrier latency profiles |
| Throughput headroom | 10× launch volume without architectural change; stateless API scales horizontally | k6 stress and soak |
| Availability | 99.9% monthly for API and apps | SLOs, burn-rate alerts |
| Recovery | RPO ≤ 5 min, RTO ≤ 60 min; restore tested on a schedule | DR drill runbook |
| Web performance | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 on a mid-range mobile over 4G for public pages | Lighthouse CI |
| Security | No open Critical or High findings; OWASP ASVS L2 | Semgrep, ZAP, Trivy, review |
| Accessibility | WCAG 2.2 AA | axe in CI + manual audit |
| Audit | 100% of mutating routes and sensitive reads produce a valid entry; chain verifies | Automated audit tests |
| Tenant isolation | Zero cross-tenant reads or writes | RLS integration tests |
| Test coverage | ≥ 85% line / 75% branch overall; ≥ 95% on pricing, ledger, audit and authorisation | Jest coverage gate |
| Observability | Structured logs, RED metrics per endpoint, traces across API → queue → worker → carrier | OpenTelemetry, CloudWatch dashboards |

---

## 10. DevOps and Infrastructure

- **Local:** `docker compose up` starts PostgreSQL, Redis, API, worker, both frontends, a mail catcher and S3-compatible storage, runs migrations and seeds demo data (countries, carriers, services, the Mock carrier, sample rate cards, one user per role). A new developer is productive with one command.
- **Images:** multi-stage builds, minimal base, non-root user, health checks, pinned digests, no secrets in layers. Frontends are built to static assets and served by a hardened Nginx image.
- **AWS topology:** VPC across three availability zones; public subnets hold only the load balancer and NAT; API, workers, RDS and Redis in private subnets; ALB with WAF; Auto Scaling on CPU, request count and queue depth; RDS PostgreSQL Multi-AZ with point-in-time recovery; S3 buckets for documents, exports, audit archive (Object Lock) and inbound mail; SES for outbound and inbound mail; Lambda for inbound-mail processing and upload scanning; Secrets Manager; KMS; CloudWatch logs, metrics, dashboards and alarms; AWS Backup plans with cross-region copy.
- **Terraform:** modules per concern, overlays for `dev`, `staging` and `prod`, tagged resources, least-privilege IAM, Checkov in CI. Applies happen only in CI.
- **GitHub Actions:** install → lint and format → type-check → unit tests with coverage gate → integration tests with service containers → build → Semgrep, Gitleaks, dependency audit → image build and Trivy scan → SBOM → push to ECR → Terraform plan with policy checks → deploy to staging → smoke and end-to-end tests → progressive production rollout with automatic rollback on error-rate, latency or health-check triggers.
- **Environments:** local, ephemeral preview per pull request where practical, staging (carrier sandboxes, payment test modes), production. Never production data outside production; seed and masked data only.
- **Operations documents:** disaster-recovery plan, backup and restore strategy with tested procedure, data-retention policy, incident and rollback runbooks, on-call alerts mapped to runbooks.
- **Multi-region is LATER:** keep the API stateless, keep region in configuration, avoid region-specific identifiers, and note in the architecture document what must change to go active-passive and then active-active.

---

## 11. Testing Strategy

- **Unit (Jest):** domain services, pricing engine (including property-based tests), state machines, validators, permission checks, utilities, React components and hooks (React Testing Library).
- **Integration:** repositories and services against real PostgreSQL and Redis in Testcontainers, including RLS, partitions, triggers and migrations up → down → up.
- **API tests (Supertest):** every endpoint for success, validation failure, unauthenticated, unauthorised, not found, conflict, idempotent replay and rate limit; responses validated against the OpenAPI contract.
- **RBAC matrix tests:** generated from the permission catalogue, asserting allow or deny for every route × role combination, plus cross-tenant denial.
- **Audit validation tests:** each mutating route writes exactly one correct audit entry in the same transaction; sensitive reads and downloads are recorded; update and delete on audit tables fail for every database role; the hash chain verifies; exports match the filtered set.
- **Carrier adapter contract tests:** one shared suite run against the Mock adapter and against recorded sandbox fixtures for DHL, FedEx and UPS. Live sandbox runs are opt-in (`CARRIER_LIVE_SANDBOX=1`) and scheduled nightly, because sandboxes are rate-limited and occasionally unavailable.
- **End-to-end (Playwright):** guest quote → compare → register → book → pay (test mode) → label → track; staff books on behalf of a customer; partner connects a carrier account and books through the API; refund; audit export. Run on Chromium, Firefox and WebKit, mobile and desktop.
- **Load (k6):** rate shopping, booking, tracking and admin list workloads with ramp, steady, spike and soak profiles against §9 budgets.
- **Security:** OWASP ZAP baseline in CI, Semgrep, secret and dependency scanning, authorisation abuse cases (IDOR, mass assignment, privilege escalation), upload abuse, rate-limit checks.
- **Accessibility:** axe on every page in the end-to-end run, plus keyboard-only passes of the critical journeys.

---

## 12. Delivery Plan

Build in vertical slices. Each milestone ends in a demonstrable, deployable state with its tests green.

| Milestone | Scope | Exit demonstration |
|---|---|---|
| **M0 Foundation** | Monorepo, tooling, Docker Compose, CI skeleton, typed config, error handling, logging, identity and sessions, organisations, RBAC catalogue, audit middleware with immutable partitioned store, RLS, design system and app shells for web and admin, i18n scaffolding, OpenAPI pipeline, Mock carrier, seed data | Sign in to both apps; a guest gets a mock quote; one mock booking flows through API → queue → worker; audit entries appear in the viewer; RBAC and audit test generators pass |
| **M1 Customer MVP** | Quote and comparison with DHL, FedEx and UPS **sandboxes**; pricing engine v1 (margins, fuel, cover, tax, currency); booking wizard; basket; Stripe test-mode checkout; labels and customs documents; pickup scheduling; tracking with public page; customer account; email notifications; en/es/fr | A real sandbox label from each of the three carriers, booked and paid end to end from the customer app on a phone and on a desktop |
| **M2 Admin ERP core** | Orders and shipments, booking on behalf, customers, carriers and accounts, pricing administration with simulator, payments, refunds, invoices, users and roles with MFA, audit viewer with CSV/PDF export and regulator report, core dashboard, settings | Staff create an order for a customer, override a price with a signed reason, refund it, and export the complete audit history of that order |
| **M3 Partner platform** | Partner onboarding, bring-your-own carrier accounts with encrypted credentials, API keys with test and live modes, public API hardening, webhooks, developer portal, usage metering | A partner connects its own sandbox carrier account, books through the API with an idempotency key, and receives signed tracking webhooks |
| **M4 Operations and finance depth** | PayPal, wallet and credit accounts on the ledger, carrier invoice import and reconciliation, billing discrepancies, exception queue, claims, support tickets with inbound email, bulk upload, CMS, notification template editor, reports, feature flags, compliance packs with sanctions screening and KYC | A carrier invoice is imported, mismatches are flagged, one discrepancy is re-charged to the customer and the ledger balances |
| **M5 Production readiness** | Terraform for all environments, progressive delivery with rollback, observability and SLO alerts, load and security testing to §9, DR drill, retention and privacy jobs, legacy data migration (Appendix A), documentation set | Staging runs on AWS from CI; load test meets budgets; restore drill passes; migration dry-run reconciles |
| **LATER** | Subscription billing, white-label theming and custom domains, multi-region deployment, AI-driven analytics (carrier recommendation, delivery-date prediction, anomaly detection), marketplace integrations (Shopify, WooCommerce, Amazon, eBay), pallets and freight, cash-on-delivery, native mobile apps | Seams exist: usage metering, tenant branding config, region config, an analytics event stream, a channel-integration interface |

### Definition of Done (every feature)

- Business logic implemented behind the service layer
- RBAC enforced and covered by the generated matrix tests
- Audit trail captured automatically and covered by audit tests
- Validation and error handling at every boundary
- Unit tests and integration tests written and passing; coverage not reduced
- API documented in OpenAPI with examples
- All UI states, three locales, responsive layouts and accessibility checks done
- Secure coding standards followed; no new scanner findings
- Performance considered: indexes, pagination, no N+1 queries
- Configuration over hard-coding; no secrets in code
- Docker configuration updated so the feature runs in Compose and deploys
- Significant decisions recorded as ADRs

---

## 13. Working Agreement for Claude Code

1. **Read first.** Read this brief in full, then any existing code and docs, before writing anything.
2. **Plan before code.** For each milestone produce or update: requirements with acceptance criteria, architecture notes and ADRs, the OpenAPI contract, the data model, and a task list. Then implement.
3. **Ask once, never stall.** Put open questions in one batch with a recommended default for each. If no answer is available, apply the default, log it in `docs/sdlc/DECISIONS.md` and continue. §14 already holds the defaults for the known questions.
4. **Contract-first and test-first.** Define the API contract and the acceptance tests before the implementation of each slice.
5. **No silent stubs.** If something is not implemented, it is either absent or behind a feature flag with a tracked task ID. No placeholder data paths in production code.
6. **Verify external facts.** Confirm carrier and gateway API details against current official documentation at implementation time and note the version and date checked.
7. **Secrets:** never create, read, print or commit real secret values. Provide `.env.example` with placeholders. Sandbox credentials are supplied by the human through environment variables or Secrets Manager.
8. **Sanctioned external calls:** carrier **sandbox** APIs, payment **test** modes, package registries and GitHub. No production carrier calls, no real emails or messages to third parties, no paid cloud resources unless the operating parameters allow it.
9. **Restricted data:** the legacy database backup (Appendix A) is never committed, never copied into fixtures and never placed in prompts or logs. Use the structural profile in Appendix A; generate synthetic test data.
10. **Git:** trunk-based, short-lived branches, Conventional Commits, no force pushes, small reviewable changes.
11. **Keep the record:** ADRs in `docs/03-architecture/adr/`, a running `STATUS.md`, and a traceability matrix from requirement to story to task to test.
12. **Scope discipline:** build milestones in order. Raise scope ideas as change requests instead of building them unasked.

---

## 14. Assumptions and Open Questions (defaults applied unless told otherwise)

| # | Question | Default applied |
|---|---|---|
| 1 | Launch countries | United States, India, United Kingdom, Canada; an EU template pack. US → India is the primary lane. |
| 2 | Base currency and units | USD and imperial for US-origin shipments; currency and units follow the origin country; users may switch display. |
| 3 | Payment gateways | Stripe and PayPal, plus wallet and credit accounts. |
| 4 | 21 CFR Part 11 | Adopt its controls for critical actions (§4.9); no formal validation programme. |
| 5 | Dedicated email per study | Dedicated inbound email address per tenant (§3.3). |
| 6 | Compute | ECS on EC2 with Auto Scaling. |
| 7 | Legacy migration | In scope at M5 as described in Appendix A. |
| 8 | Package types at launch | Documents and parcels; pallets and freight later. |
| 9 | Marketplace integrations and cash-on-delivery | Later; CSV/Excel bulk upload covers business shippers first. |
| 10 | Partner pricing | Partners pay the carrier directly on their own accounts; the Platform records metered usage for future fees. |
| 11 | Customer login methods | Email and password with optional MFA; social and OTP login later behind the identity module. |
| 12 | Brand | Placeholder brand in configuration; neutral professional theme. |
| 13 | Cloud spend during the build | None. Terraform is written, validated and policy-checked but applied only once deployment targets and a budget are set. |

---

## Appendix A: Legacy System Profile and Migration

A PostgreSQL 12 backup of the system being replaced was profiled **for structure and aggregate shape only**. It is restricted data: it contains customer personal data, stored payment-method references, and carrier API credentials. Follow §13 rule 9.

**What the legacy system is:** an Entity Framework (.NET) application with 43 tables and 17 stored functions; integer keys; no audit trail.

**Shape of the data (approximate):** 12,500 customers; 16,700 orders; 15,600 payments; 221,000 shipment rows, of which roughly three quarters never had a carrier selected (quotes and abandoned baskets were stored as shipments); 247,000 packages; 83,000 address-book entries. About 99% of shipments originate in the United States and about 88% are destined for India, followed by US domestic, Canada, the United Kingdom, Australia and the UAE. Directions: export (dominant), domestic, import. Carriers: UPS, DHL and FedEx with about 60 configured services and two accounts per carrier. Payment methods: PayPal, card through Stripe, and credit. The volumetric factor in use is 139 (imperial).

**Legacy concepts the new system must cover** (all are reflected in §4–§6):

| Legacy area | Tables | New home |
|---|---|---|
| Customers, credentials, reset tokens, saved cards | `Customers`, `ResetPasswords`, `CustomerStripeCards` | identity, organisations, payments |
| Staff and three role codes | `AdminUsers` | identity, authz |
| Address book and shipment addresses | `AddressBooks`, `Addresses` | organisations, shipments |
| Orders, payments, itemised charges | `Orders`, `Payments`, `ShipmentCharges` | orders, payments, ledger, pricing snapshot |
| Shipments, packages, customs contents | `Shipments`, `ShipmentPackages`, `ShipmentContents` | quotes, shipments, customs |
| Carrier services, limits, liability terms, service notes | `Carriers`, `CarrierServiceInfos` | carriers |
| Carrier accounts and API credentials | `CarrierAccountDetails` | carriers (secrets moved to Secrets Manager; credentials are re-issued, not migrated) |
| Margin and discount by weight band, per carrier and per service | `CarrierWeightCommissions`, `CarrierServiceWeightCommissions` | pricing rules |
| Zones and weight-band price lists | `Zones`, `ZoneCountry`, `Pricelists`, `ManagePriceFiles`, `prices` | rate cards |
| Fuel surcharge by date range, remote areas, transit days, holidays, lane exceptions | `FuelSurcharges`, `RemoteAreas`, `TransitDays`, `Holidays`, `ShippingExceptions` | pricing, carriers, reference data |
| Discounts by email domain or specific customer, date-bounded, per carrier and content type | `DomainDiscountMaster` | pricing: customer discounts |
| Carrier invoice import and billing discrepancies | `CarrierBillings`, `BillingDiscrepancies` | reconciliation |
| Bulk shipments from Excel | `BulkShipmentExcelMaster`, `BulkShipmentExcelData` | bulk import |
| Warehouse address, landing pages, contact form | `WareHouseAddresses`, `LandingPages`, `ContactUs` | reference data, content, support |
| Countries, provinces, postcode rules | `Countries`, `StateProvinceCodes` | reference data |

**Weaknesses not to carry over:** credentials in plain table columns; state held in scattered booleans and free text; raw gateway and carrier responses stored inline on rows; sender and receiver stored as serialised text; timestamps without time zone and dates stored as text; pricing logic inside stored procedures; quotes mixed with shipments.

**Migration approach (M5):**

1. Restore the backup only into an isolated, access-controlled database. Produce a field-level mapping document and a data-quality report first.
2. Write idempotent, resumable ETL jobs that map integer keys to new UUIDs through a persisted crosswalk table, so legacy order numbers and tracking numbers stay searchable.
3. Migrate customers, address books, orders, booked shipments, packages, contents, charges and payments. Treat never-booked shipment rows as expired quotes; migrate only a recent window of them, or none.
4. Do not migrate passwords or carrier credentials as-is. Inspect the legacy password format in the isolated environment, then either upgrade on first login or force a reset; record the choice in an ADR. Keep gateway customer and payment-method tokens only if the gateway account is retained.
5. Convert timestamps to UTC using the documented source time zone; convert money to minor units with currency.
6. Write a single audit entry per migrated record with action `MIGRATED` and the legacy identifier.
7. Reconcile: row counts, monetary totals per month, and a sampled record-by-record comparison. Run at least one full dry run before cut-over and document rollback.

---

## Appendix B: Carrier Sandbox Reference (confirm against official docs before use)

| Carrier | API | Authentication | Sandbox base URL | Production base URL |
|---|---|---|---|---|
| DHL Express | MyDHL API (REST) | HTTP Basic with API credentials; requires a DHL Express account number | `https://express.api.dhl.com/mydhlapi/test` | `https://express.api.dhl.com/mydhlapi` |
| FedEx | FedEx REST APIs | OAuth 2.0 client credentials, `POST /oauth/token` (form-encoded) | `https://apis-sandbox.fedex.com` | `https://apis.fedex.com` |
| UPS | UPS REST APIs | OAuth 2.0 client credentials, `POST /security/v1/oauth/token` | `https://wwwcie.ups.com` | `https://onlinetools.ups.com` |

Notes:

- **Portals:** `developer.dhl.com`, `developer.fedex.com`, `developer.ups.com`. Each API product (rating, shipping, tracking, pickup, address validation) must be enabled on the developer app.
- **FedEx paths seen in current integrations:** `/rate/v1/rates/quotes`, `/ship/v1/shipments`, `/track/v1/trackingnumbers`. **UPS** rating, shipping and tracking paths carry version segments that change over time; read the current version from the portal.
- **Sandbox behaviour differs from production.** The DHL test environment has a daily call quota per credential set. Sandbox tracking generally returns canned data for documented test numbers, and labels created in a sandbox may not be trackable there. Sandbox rates are not real negotiated rates. This is why the Mock carrier and recorded fixtures carry the automated test suite.
- **Tokens:** cache OAuth tokens until shortly before expiry; never request a token per call.
- **Sandbox and production credentials are separate.** Model them as separate carrier accounts.
- The older FedEx SOAP and UPS XML web services have been superseded by the REST APIs. Do not integrate against them.

---

## Appendix C: Running This Brief with the Autonomous SDLC Agent Team

1. Put `claude-code-sdlc-agent-team.md` and this file in the root of a new git repository.
2. Start Claude Code there and say: *"Read `claude-code-sdlc-agent-team.md` and execute Part 1."*
3. Edit `CLAUDE.md` §3 (Operating Parameters). Suggested values:

   | Parameter | Suggested value |
   |---|---|
   | DEPLOY_TARGET_STAGING | blank until an AWS account is ready (defaults to local Docker Compose) |
   | DEPLOY_TARGET_PRODUCTION | blank until M5 |
   | CI_PLATFORM | GitHub Actions |
   | CLOUD_BUDGET_MONTHLY_USD | blank (0) until M5, then your approved figure |
   | COVERAGE_TARGET | 85% line / 75% branch; 95% on pricing, ledger, audit, authz |
   | MAX_PARALLEL_DEVELOPERS | 4 (drop to 2 if merge conflicts appear) |

4. Add these project rules to `CLAUDE.md` so every agent inherits them:
   - **§2:** the stack in §3 of this brief is fixed; `principal-architect` documents it in ADR-0001 and does not re-select it.
   - **§5 (guardrails):** carrier sandbox APIs and payment test modes are permitted integrations; production carrier and payment endpoints are not, until G4 for a production release. The legacy backup is restricted data (this brief §13 rule 9).
   - **§8 (Definition of Done):** append the feature-level Definition of Done from §12 of this brief (RBAC, audit, API docs, Docker).
5. Launch and scope the first run to M0 + M1 rather than the whole product:
   ```bash
   claude --agent sdlc-orchestrator --permission-mode auto
   ```
   ```
   /sdlc-start shipping-platform-brief.md  Scope this run to milestones M0 and M1 in §12. Treat M2–M5 as the backlog.
   ```
6. After each release, start the next milestone with `/sdlc-change Implement milestone M2 from shipping-platform-brief.md §12`, and so on. Milestone-sized runs keep gate reviews meaningful and cost predictable.
7. Supply sandbox credentials for DHL, FedEx, UPS and Stripe as environment variables or secrets outside the repository. Until they exist, everything runs on the Mock carrier.

---

## Appendix D: Competitor Benchmark (capabilities to match)

| Product | Notable capabilities and patterns |
|---|---|
| **Parcel Monkey** | Quote by weight, dimensions and destination; side-by-side comparison of carrier services; collection or drop-off; customs documents produced during booking; own-brand services fulfilled by major carriers; tracking through the aggregator's own page |
| **CourierPoint** | Quote form with origin and destination country, optional postcodes, parcel/pallet/document and personal-or-gift content; inline help modals explaining terms; business accounts with custom pricing; order import from marketplaces and CSV; extensive customs, prohibited-items and sanctions guides; destination landing pages; call-back request |
| **Garudavega** | Instant quote without an account; volumetric calculator and currency converter; doorstep pickup booking; tracking by AWB; branch locator; sticky "Pickup" and "Get a quote" actions; express, air and ocean service tiers |
| **Shiprocket** | Courier aggregation with a recommendation engine; rate and volumetric calculators; bulk order creation and label printing; multiple pickup locations; failed-delivery (NDR) and return-to-origin management; weight-discrepancy handling; branded tracking page with email and SMS; channel integrations; API with webhooks; tracking widget accepting mobile number, AWB or order ID; wallet recharge |
| **NimbusPost** | Rule-based and automated courier allocation; weight freezing to limit disputes; early cash-on-delivery remittance; customisable branded tracking page; WhatsApp, SMS and email updates; returns with quality check; B2B cargo; analytics dashboard |

Where a capability above is listed as LATER in §12 (marketplace integrations, cash-on-delivery, freight), design the seam now and build it later.
