# Product Requirements Document — Multi-Carrier Shipping Platform

| Field | Value |
|---|---|
| Version | 1.0 (P1 Requirements, run scope M0 + M1) |
| Date | 2026-11-12 |
| Owner | product-manager |
| Source of truth | `docs/sdlc/BRIEF.md` (brief §1–§14, Appendices A–D), `docs/sdlc/DECISIONS.md` D-001..D-029, `CLAUDE.md` |
| Companion documents | `REQUIREMENTS.md` (functional), `NFR.md` (non-functional), `stories/EPIC-*.md`, `BACKLOG.md`, `ASSUMPTIONS.md`, `docs/sdlc/traceability.md` |

---

## 1. Vision

A multinational carrier-aggregation platform on which people and businesses get instant quotes, compare DHL Express, FedEx and UPS services side by side, book, pay, print labels and customs documents, schedule pickups and track shipments — while the operator runs the whole business from one audit-ready back office and partners ship through the Platform's API on their own carrier accounts.

Three standing obligations shape every feature (brief §1): **compliance is per country and is data**, **every create/update/delete/view/download is captured in an immutable audit trail**, and **no endpoint, screen or export exists without an explicit permission**.

The brand is configuration (`BRAND_*`); the product is "the Platform".

## 2. Problem

### 2.1 The customer problem
Cross-border shippers (the primary lane is US → India, ~88% of legacy volume per Appendix A) face opaque carrier pricing, three separate carrier portals, confusing customs paperwork and no single place to compare, book and track. Individuals abandon when they cannot see a price without an account; small businesses re-key the same sender, receiver and customs data for every shipment.

### 2.2 The operator problem
The legacy .NET system (Appendix A: 43 tables, 17 stored functions, integer keys, **no audit trail**, credentials in plain columns, pricing in stored procedures, quotes mixed with shipments — ~75% of 221k "shipment" rows never had a carrier selected) cannot support multi-country compliance, auditability or partners. It must be replaced before the business scales beyond its current ~16.7k orders.

### 2.3 Why now
The operator must satisfy per-country rules (GDPR/UK GDPR, India DPDP, US state privacy) and prove auditability to customers and regulators; competitors (Appendix D: Parcel Monkey, CourierPoint, Shiprocket, NimbusPost, Garudavega) already offer instant quotes without an account, side-by-side comparison, customs documents during booking and branded tracking. The capability gap is a direct revenue leak.

### 2.4 Alternatives considered
- Keep the legacy system and bolt on an audit layer — rejected: no tenant model, no RLS, pricing in stored procedures.
- Buy a white-label aggregator — rejected: no control over compliance-as-data, partner model or margin rules; the brief fixes a build.
- Build everything in one run — rejected (D-001): milestone-sized runs keep gates meaningful; this run is M0 + M1.

## 3. Personas

### 3.1 Active in this run (M0 + M1)

| Persona | Who | Jobs to be done | Pain points today |
|---|---|---|---|
| **Guest shipper** | Anyone landing on the public site, mostly on a phone | See a real price for a parcel or document in under a minute without creating an account; understand delivery time and what is included; share or save the quote | Forced sign-up before any price; prices that change at checkout; no idea what customs needs |
| **Registered individual** | A person shipping gifts, documents or personal effects (US → IN typical) | Book and pay in one sitting on mobile; get the label and customs invoice by email; schedule a doorstep pickup; track without logging in; repeat a past shipment | Re-typing addresses; printing the wrong form; not knowing when the courier comes |
| **Business customer (Owner / Admin / Shipper / Finance / Viewer)** | A small exporter with several staff who ship weekly | Keep an address book; let colleagues book under one account with appropriate rights; see spend and shipment status; download documents later | Shared logins; no visibility of who booked what; invoices scattered |
| **Operator Super Admin** (minimal slice, D-008) | Head of operations / platform owner | Sign in to the admin app securely (MFA); confirm the audit trail captures everything during the M0 demo; manage own sessions | Legacy system has no audit trail at all |
| **Compliance Auditor** (minimal slice, D-008) | Internal/external auditor, read-only | Filter and inspect audit entries by user, entity, action, outcome and date; see the history of a single record | No evidence of who changed what, when |
| **System actor** | Worker jobs, schedulers | Book with the carrier, poll tracking, generate documents, send notifications, verify the audit chain | — |

### 3.2 Backlog personas (not active this run)
Partner owner, partner developer (M3); operations agent, finance officer, support agent, sales/account manager, content manager (M2/M4). Their seeded roles exist in the RBAC catalogue from M0 so permissions can be tested, but they have no screens this run.

## 4. Goals and success metrics

This run has no production target (D-002). Success is measured on (a) gate evidence produced in this run and (b) product telemetry designed in now and read after launch. North-star and guardrails are defined so later milestones inherit them unchanged.

### 4.1 North-star (post-launch, instrumented now)
**Paid bookings per week** (shipments reaching `PAID` → `LABEL_READY`). Leading indicator: **quote → paid conversion ≥ 8%** for guests who see at least one result (industry benchmark for aggregators is 5–10%; measured from the analytics event stream seeded in M1).

### 4.2 Run-level outcomes (verified at G3/G4)

| # | Outcome | Target | Measured by |
|---|---|---|---|
| O1 | Both exit demos pass end to end on Mock carrier + fixtures | M0 demo and M1 demo scripts green on Chromium, Firefox and WebKit at 360 px and 1280 px viewports | Playwright suites in `tests/e2e` (G3) |
| O2 | Time to first quote result | ≤ 1.5 s first result, ≤ 5 s complete with partial results (brief §9) | k6 against compose with Mock latency profiles |
| O3 | Zero cross-tenant access and 100% route coverage for permission + audit + validation metadata | 0 failures in RLS integration tests; build-time route-metadata test passes for 100% of routes; RBAC matrix generator covers 100% route × role | Jest/Testcontainers suites (G3) |
| O4 | Audit completeness | 100% of mutating routes and sensitive reads produce exactly one chained entry; update/delete attempts fail for every DB role | Audit test generator (G3) |
| O5 | Quality and accessibility bar | Coverage ≥ 85% line / 75% branch (≥ 95% pricing, audit, authz); 0 serious/critical axe violations; 0 open Critical/High security findings | CI coverage gate, axe in e2e, Semgrep/Trivy/ZAP (G3) |

### 4.3 Guardrail metrics (must stay at zero)
- Captured payments without a booked shipment: **0** (saga compensation; tested with Mock failure injection).
- Duplicate labels bought for one shipment on retry: **0** (idempotency keys; tested).
- Personal data on the public tracking page beyond city-level location: **0** fields (contract test).
- Secrets or PII in logs or audit values: **0** (redaction tests).

### 4.4 Post-launch product metrics (designed now, read later)
Verification-step drop-off (validates D-009), share-link usage (validates D-021 Should), pickup vs drop-off split (validates D-014), cancellation rate within window (validates D-017), locale distribution (validates D-023 investment).

## 5. Scope

### 5.1 In scope — this run (M0 Foundation + M1 Customer MVP, brief §12)

**M0 Foundation**
- Monorepo per §4.1, tooling, Docker Compose one-command local environment, CI skeleton, typed configuration, centralised error handling (problem+json), structured logging (Pino, correlation/tenant/actor IDs, redaction).
- Identity and sessions (§4.2): email + password, email verification, JWT access + rotating refresh cookie with reuse detection, password reset, lockout, staff TOTP (mandatory), re-authentication primitive.
- Organisations and memberships; RBAC permission catalogue with seeded roles; route metadata (permission + audit descriptor + validation schema) with build-time test; RBAC matrix test generator.
- Audit middleware with immutable, hash-chained, monthly-partitioned store; audit test generator; **minimal admin audit viewer** (D-008).
- Row-level security and the standard data-model columns (§4.10).
- Design system (`packages/ui` tokens, light/dark, density, states), web and admin app shells, i18n scaffolding with en/es/fr complete for shipped strings (D-023), WCAG 2.2 AA, responsive breakpoints.
- OpenAPI 3.1 pipeline with Swagger UI; API conventions (§4.8) used by the Platform's own frontends.
- Carrier adapter interface + deterministic Mock carrier; payment gateway abstraction + Mock gateway (D-011); shipment state machine core; one mock booking flowing API → queue → worker.
- Seed data (D-022): countries, carriers/services, Mock carrier, sample pricing configuration, compliance packs (unreviewed), one user per role.

**M1 Customer MVP**
- Quote and comparison with DHL Express, FedEx and UPS sandbox adapters (fixture-backed per D-003) and Mock; SSE streaming, partial results, sort/filter/badges/breakdown; compare, save and share (Should).
- Pricing engine v1 (D-010): billable weight, margins, fuel, carrier pass-through surcharges, protection cover, coupons/discounts, tax from compliance pack, FX snapshot, immutable price snapshot with explanation.
- Booking wizard (steps 1–7), customs lines and commercial/pro-forma invoice (D-015), basket/order with coupon (Should), Stripe test-mode checkout with hosted fields and authorise-then-capture (D-011), idempotent booking saga with compensations.
- Labels and customs documents stored with hashes and audited downloads (D-025); pickup scheduling (D-014; drop-off list Should); tracking via polling with public tracking page (D-016).
- Customer account: dashboard, shipments, drafts/saved quotes, address book, payment methods (Should), notification preferences, security (password, optional MFA, sessions), organisation and team (Should), self-service cancellation with automatic refund (Should, D-017), privacy self-service (Could, D-027).
- Email notifications via provider interface with local mail catcher (D-018); en/es/fr throughout.
- Cross-cutting on every feature: RBAC, audit, RLS, three locales, WCAG 2.2 AA, responsive, six UI states, OpenAPI documentation, Compose runs it.

### 5.2 Minimum slices pulled forward from later milestones (explicitly limited)
| Slice | Why it is needed now | Limit |
|---|---|---|
| Admin app: staff sign-in with mandatory TOTP, shell, read-only audit viewer, my sessions | M0 exit demo ("sign in to both apps", "audit entries appear in the viewer"); §4.2 staff MFA | No exports, regulator report, dashboard or any other admin module (M2) |
| Seed users per role | M0 demo and RBAC matrix tests | Demo credentials from env; refuse defaults in production (D-022) |
| Feature-flag seam | §4.13; "no silent stubs" needs flags with tracked task IDs | DB-backed flags, per-environment/per-org targeting, audited; no admin UI (Should) |
| Compliance packs as data | Tax, customs thresholds, prohibited items for M1 | Seeded, unreviewed, flagged; strategy code, screening, KYC, retention jobs are M4/M5 |
| Pricing configuration as seed | Engine needs configuration; pricing admin is M2 | Versioned seed only |

### 5.3 Out of scope — this run (see `BACKLOG.md`)
Everything in M2 (admin ERP core: orders on behalf, customers, carrier/account admin, pricing admin and simulator, payments/refunds admin, invoices, users and roles editor, audit exports and regulator report, dashboard, settings), M3 (partner platform, API keys, webhooks, developer portal, usage metering), M4 (PayPal, wallet, credit accounts, ledger, carrier invoice reconciliation, billing discrepancies, exception queue, claims, support tickets and inbound email, bulk upload, CMS, template editor, reports, feature-flag UI, sanctions screening, KYC), M5 (Terraform apply, progressive delivery, SLO alerts, load/security testing on AWS, DR drill, retention and privacy jobs, legacy migration, documentation set) and LATER items. Production carrier or payment endpoints, live emails, paid cloud resources, and the legacy backup are excluded by guardrail (CLAUDE.md §5).

## 6. Milestone exit demonstrations as acceptance scenarios

These are the acceptance-level scenarios the Must stories must jointly satisfy. Each is implemented as a Playwright journey (G3) on Chromium, Firefox and WebKit at 360 px and 1280 px.

### 6.1 M0 Foundation exit demo (release `v0.1.0-m0`, D-006)
```gherkin
Feature: M0 Foundation exit demonstration
  Background:
    Given the stack was started with a single "docker compose up" and migrations and seeds have run
    And the Mock carrier and Mock payment gateway are the only enabled providers

  Scenario: Staff and customer sign-in to both apps
    When the seeded Super Admin signs in to the admin app with email, password and a TOTP code
    Then the admin shell is shown in the user's locale with the audit viewer in the navigation
    When the seeded customer Owner signs in to the customer web app
    Then the account dashboard shell is shown and the access token is held in memory only, the refresh token in an HttpOnly cookie

  Scenario: Guest gets a mock quote
    Given a guest with no session
    When they request a quote US 10001 -> IN 400001, parcel, 2 kg, 30x20x10 cm through the public quote endpoint (the quote widget UI is an M1 story, US-157/US-158; in M0 the demo uses the API and Swagger UI)
    Then at least one Mock carrier service is returned within 1.5 s with an itemised price in USD
    And a Quote entity with a 24 h expiry is stored and readable only with its guest access token

  Scenario: One mock booking flows API -> queue -> worker
    Given the customer Owner has a quote
    When they book it through the API with an Idempotency-Key
    Then the shipment moves DRAFT -> QUOTED -> PENDING_PAYMENT -> PAID -> BOOKING -> BOOKED -> LABEL_READY
    And the booking job ran in the worker and called the Mock carrier exactly once
    And replaying the same request with the same Idempotency-Key returns the same order without a second booking

  Scenario: Audit entries appear in the viewer
    Given the previous scenarios ran
    When the Compliance Auditor filters the audit viewer by the customer's organisation and today's date
    Then entries for LOGIN, quote CREATE, shipment CREATE and every state transition are listed with actor, IP, outcome and a verified hash chain
    And the auditor's own VIEW of the audit log is itself recorded

  Scenario: Generators pass
    Then the RBAC matrix test generator produces allow/deny tests for 100% of route x role combinations and they pass
    And the audit test generator proves every mutating route writes exactly one entry in-transaction and every audit UPDATE/DELETE attempt fails
```

### 6.2 M1 Customer MVP exit demo (release `v0.1.0`)
```gherkin
Feature: M1 Customer MVP exit demonstration
  Background:
    Given DHL Express, FedEx and UPS adapters are configured with sandbox accounts (fixture-backed when no credentials are present, D-003)
    And Stripe runs in test mode (fixture-backed when no key is present)
    And the demo is executed once on a 360 px phone viewport and once on a 1280 px desktop viewport in each of en, es and fr

  Scenario Outline: Book and pay a shipment end to end with <carrier>
    Given a guest on the home page requests a quote US 10001 -> IN 400001, parcel, 2 kg, 30x20x10 cm
    When results stream in, sorted by cheapest, with Cheapest and Fastest badges
    And the guest selects the <carrier> service and is asked to register or sign in
    And they register, verify their email via the mail catcher, and are returned to the wizard with the quote claimed
    And they complete sender and receiver, customs lines with an HS code, pickup date and window, extras, review and basket
    And they pay with a Stripe test card including a 3-D Secure challenge
    Then the order is PAID, the shipment is BOOKED then LABEL_READY with a <carrier> label and a commercial invoice PDF
    And a pickup reference is shown and the confirmation email with documents arrives in the mail catcher in the user's locale
    And the public tracking page shows the tracking number with status and city-level location only
    And the account shipment list shows the order with charges, documents and timeline
    Examples:
      | carrier     |
      | DHL_EXPRESS |
      | FEDEX       |
      | UPS         |

  Scenario: Real sandbox label (COND-SANDBOX-DEMO)
    Given sandbox credentials for the three carriers and Stripe are supplied via environment variables
    When the scenario outline above is run with CARRIER_LIVE_SANDBOX=1 and STRIPE_TEST_LIVE=1
    Then each carrier returns a real sandbox label
    # Recorded as a post-release verification condition (D-003); not required for G3/G4 in this run.
```

## 7. Release scope and slices (D-006, D-029)

| Slice | Content | Gate / artefact |
|---|---|---|
| **R0 — `v0.1.0-m0`** (pre-release) | All M0 Must stories plus M0 Should stories that pass regression | Regression green; lightweight dossier; no gate |
| **R1 — `v0.1.0`** | All M1 Must stories; M1 Should stories that pass; Could stories only if no Must/Should is at risk | G3 → G4; tag, GitHub Release, GHCR images (D-005) |
| **Post-release condition** | COND-SANDBOX-DEMO: live sandbox label from each carrier + Stripe test-live | One documented command once credentials exist |

Prioritisation uses WSJF-lite (D-029): Must = exit-demo critical path + non-negotiable cross-cutting obligations; Should = brief-listed M0/M1 functionality off the demo path; Could = conveniences or items whose full version arrives in M2–M5. Story files carry the per-story tag.

**Volume (P1 baseline):** 430 requirements (318 Must / 93 Should / 19 Could; 207 M0 / 223 M1) in `REQUIREMENTS.md`; 90 NFRs in `NFR.md` (74 fully verifiable this run, 10 partial, 6 deferred to M5); 290 stories in 17 epics (215 Must / 67 Should / 8 Could; 119 M0 / 171 M1). R0 delivers the 119 M0 stories (112 Must); R1 the 171 M1 stories (103 Must). The Must share is high because RBAC, audit, RLS, i18n and accessibility are per-feature obligations of the brief, not optional polish.

## 8. Dependencies

| Dependency | Type | Status | Mitigation |
|---|---|---|---|
| DHL Express, FedEx, UPS sandbox credentials | External | Not available (D-003) | Adapters built from current official docs with recorded/synthesised fixtures; Mock carrier carries e2e; live run opt-in |
| Stripe test-mode key | External | Not available (D-003) | Fixture-backed Stripe stub; Mock gateway in M0 |
| Carrier API documentation currency (App. B) | External | Must be confirmed at implementation time (§13 rule 6) | Adapter README records version and date checked |
| Compliance pack content review (tax rates, thresholds, prohibited items) | Operator legal | Not reviewed | Seeded with `reviewed_by = null`, flagged unreviewed (D-020) |
| Licensed HS code list | Operator | Not available | Seeded sample list, labelled sample (D-015) |
| FX rates | Data | No paid feed | Seeded snapshot (D-019) |
| Translations review (es, fr) | Operator | Developer-authored | Tracked task for linguistic review (D-023) |
| GitHub Actions on `sukhchdit/shipcube` | Platform | Available (D-004) | — |
| AWS account / budget | Platform | None (D-002) | Terraform validated and policy-checked only; compose is staging |

## 9. Risks (product, technical, regulatory, adoption)

| ID | Risk | Type | Likelihood | Impact | Mitigation / owner |
|---|---|---|---|---|---|
| R-01 | Sandbox APIs behave differently from fixtures; real-label demo fails after credentials arrive | Technical | Medium | Medium | Contract suite shared by Mock and fixtures; adapter READMEs record doc versions; COND-SANDBOX-DEMO tracked; principal-architect/senior-developer |
| R-02 | Booking saga leaves a captured payment without a label or buys two labels | Product/Technical | Low | High | Idempotency keys, compensations, Mock failure injection tests; guardrail metric = 0; senior-developer/qa-lead |
| R-03 | Unreviewed tax/customs data shown to customers | Regulatory | High (content) | Low this run (test mode, no production) | Flagged unreviewed; operator review before any production release (M5); product-manager |
| R-04 | Scope creep from admin needs (e.g. "just one more admin screen") | Product | Medium | Medium | D-008 fixes the minimal admin slice; change requests only; product-manager |
| R-05 | Three-locale obligation inflates every story | Product | High | Medium | D-023 (locales from M0, CI parity check) keeps cost linear; translations developer-authored; ux-designer provides key conventions |
| R-06 | Performance budgets not representative on a laptop | Technical | High | Low | NFRs marked PARTIAL; k6 locally proves relative behaviour; M5 re-verifies on AWS; performance-engineer |
| R-07 | Customers blocked by email verification before payment (D-009) | Adoption | Medium | Medium | Mail catcher locally; funnel telemetry on verification step; reversible decision |
| R-08 | Carrier sandbox labels are not trackable; tracking demo relies on Mock | Technical | High | Low | Mock tracking scenarios; canned sandbox tracking numbers in fixtures; documented in App. B |
| R-09 | Privacy obligations (erasure, retention) only partially met in M1 | Regulatory | Medium | Low (no production) | D-027 Could; full workflows M4/M5 before production; security-analyst |
| R-10 | Audit volume (every view) degrades latency | Technical | Medium | Medium | NFR audit overhead budget; partitioning; sensitive-read scope defined per route; principal-architect |
| R-11 | Map/service-point UX without a budget for tiles | Product | Medium | Low | D-014: list Should, map Could; principal-architect decides tile source |

## 10. Open items resolved by default
All ambiguities found during P1 were resolved with logged defaults in `ASSUMPTIONS.md` (A-005 onward) and `DECISIONS.md` (D-008 onward). No question is pending for the human; answers that arrive later are applied through `/sdlc-change`.
