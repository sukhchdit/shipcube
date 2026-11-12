# Product Requirements Document — Multi-Carrier Shipping Platform

| Field | Value |
|---|---|
| Version | 1.6 (P5 Wave 0 batch-3 architecture alignment, D-059; see §11 for the full history since 1.1) |
| Date | 2026-11-12 |
| Owner | product-manager |
| Source of truth | `docs/sdlc/BRIEF.md` (brief §1–§14, Appendices A–D), `docs/sdlc/DECISIONS.md` D-001..D-037, `CLAUDE.md` |
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

**Volume (v1.3 after D-046..D-052; P1 baseline v1.1 was 430 / 90 / 290):** 434 requirements (324 Must / 91 Should / 19 Could; 205 M0 / 229 M1) in `REQUIREMENTS.md`; 91 NFRs in `NFR.md` (75 fully verifiable this run, 10 partial, 6 deferred to M5); 293 stories in 17 epics (218 Must / 67 Should / 8 Could; 120 M0 / 173 M1). R0 delivers the 120 M0 stories (113 Must, of which 74 demo-critical); R1 the 173 M1 stories (105 Must, of which 60 demo-critical). The v1.3 additions are security-review hardening (SEC-P3-01/02/05/06): Must because the gate verifies them (G3 SEC-TC cases), not demo-critical because no §6 demo step exercises them. The Must share is high because RBAC, audit, RLS, i18n and accessibility are per-feature obligations of the brief, not optional polish; §7.1 defines the smaller demo-critical core inside Must.

### 7.1 Demo-critical subset and re-scope ladder (D-037, closes G1-C5)

**Demo-critical (DC) stories.** A Must story is tagged `DC` when a step or assertion of the §6.1 or §6.2 demo script cannot execute without it. The tag is recorded in the **DC** column of every epic's story-summary table (`stories/EPIC-*.md`) and of `docs/sdlc/traceability.md` ("Story → Requirement"). Must stories without the tag are the brief's cross-cutting obligations and negative controls that the gate verifies (G3) but the demo scripts do not exercise: hardening, redaction, lockout, compensation paths, generators' non-demo coverage, non-demo screens.

| Slice | Must stories | of which DC | DC share |
|---|---|---|---|
| R0 — M0 (`v0.1.0-m0`) | 113 | 74 | 65% |
| R1 — M1 (`v0.1.0`) | 105 | 60 | 57% |
| **Total** | **218** | **134** | **61%** |

Per epic (DC / Must, v1.3): EPIC-01 8/12 · EPIC-02 11/17 · EPIC-03 13/19 · EPIC-04 9/13 · EPIC-05 9/17 · EPIC-06 10/18 · EPIC-07 4/13 · EPIC-08 8/11 · EPIC-09 13/18 · EPIC-10 14/18 · EPIC-11 5/7 · EPIC-12 4/6 · EPIC-13 5/9 · EPIC-14 2/4 · EPIC-15 9/11 · EPIC-16 3/14 · EPIC-17 7/11.

**How P4 uses it.** senior-developer waves DC stories first within each milestone (the critical path of the demo), then the remaining Must, then Should, then Could. qa-lead's e2e demo journeys are built from the DC set.

**Re-scope ladder** (applied by product-manager at CLAUDE.md §7 step 3, in this order, one rung at a time, each step logged in `DECISIONS.md`):
1. **Defer Could stories** of the affected epic (no gate impact).
2. **Defer Should stories** of the affected epic; each becomes a tracked backlog item with its REQs.
3. **Defer a non-DC Must story**: it becomes a Should in the backlog, and the gate condition it weakens (e.g. a G3 coverage or hardening assertion) is recorded as a named condition on the release so quality-gatekeeper can judge it explicitly. The cross-cutting obligation is never silently dropped (brief §13 rule 5).
4. **Split a DC Must story** into the smallest DC Must that still satisfies the demo step plus a Should carrying the rest. A DC story is never deferred outright: deferring it means the release cannot demonstrate its milestone, which is a scope change for sdlc-orchestrator, not a re-scope.

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
| R-01 | Sandbox APIs behave differently from fixtures; real-label demo fails after credentials arrive | Technical | Medium | Medium | Contract suite shared by Mock and fixtures; adapter READMEs record doc versions and whether a person diffed the adapter against the official spec (REQ-CARR-019); COND-SANDBOX-DEMO tracked; the two SPK-02 residuals are logged as A-105 (DHL cannot void; assumed not invoiced) and A-106 (UPS PDF via Label Recovery, R-ARCH-25, with the ZPL-only re-scope as the last resort); principal-architect/senior-developer |
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
| R-12 (RR-16) | Account-existence oracle: register (identical 202) followed by login reveals whether an address is free, because sign-in is allowed before verification (D-009). Accepted residual risk from the P3 security review (SEC-P3-05, adjudication (c)) | Security/Product | Medium (easy but noisy: every probe e-mails the target) | Medium (targeted phishing, credential stuffing) | D-049: register counted in the `email-send` class (3/h per address, 10/h per IP), ≤ 5 distinct addresses per IP per hour with `registration_probe` security event; identical 202 kept; pre-hijack closed by D-050. Revisit D-009 if `registration_probe` correlates with a stuffing campaign (A-095). Owner: product-manager; security-analyst records RR-16 |
| R-13 (RR-03) | Distributed anonymous rate-shopping floods can still deny guests quoting (not bookings) until the M5 WAF | Technical | Medium | Low (guests see "carrier busy" or cached results; paid bookings isolated by D-048) | D-048 anonymous budget, two bulkheads and daily quota guard (REQ-CARR-022/023, NFR-RES-007); D-053 closes the free-account bypass (SEC-P3-29: unverified users are anonymous callers, `quote-create` class 30/min + 300/h per user and 1,000/h per organisation, per-organisation quota share 10 %), so RR-03 is back to guests only; WAF at M5. Owner: principal-architect |
| R-15 (RR-19) | Tricked verification: a victim who redeems the verification link of an account an attacker pre-registered with the victim's address hands the attacker a *verified* account whose password the attacker holds; the attacker's session is revoked (D-050) but they can sign in again until the victim resets the password. Accepted residual risk (LOW) from the security review §14.2 SEC-P3-06 row | Security/Product | Low (needs the victim to act on an e-mail for an account they never created, within 7 days) | Low (an empty account under the victim's address; payment needs the attacker to supply a card; the victim's reset path takes the account back and revokes all sessions) | D-057: accepted; mitigated by the verification e-mail wording "if you did not create this account, ignore this e-mail", the "account already exists" e-mail's reset entry point, verification revoking every other session, and the 7-day unverified expiry (REQ-AUTH-001/004/012/026). The optional control (require sign-in before an anonymous verification redemption) is **not** applied: cross-device verification (link opened on a phone, D-UX-024 F02) is the common path and a forced sign-in there costs funnel conversion for a marginal gain. Validation: telemetry `auth.verify_anonymous_redemption` share and `auth.password_reset_after_verify` within 24 h reviewed monthly (A-102); revisit if a pre-hijack report appears. Owner: product-manager; security-analyst records RR-19 |
| R-14 | Step-up prompts (12 h `auth_time`, always-re-auth on payment methods and privacy export; D-046) add friction on team-management and saved-card actions | Adoption | Low (rare actions) | Low | Telemetry `auth.reauth_prompted` per 1,000 sessions < 20 and absolute-cap expiries < 2 % of refreshes (A-093); the 12 h age and the 30 d cap are configuration; re-auth dialog designed by ux-designer (D-UX-025). Owner: product-manager |

## 10. Open items resolved by default
All ambiguities found during P1 were resolved with logged defaults in `ASSUMPTIONS.md` (A-005 onward) and `DECISIONS.md` (D-008 onward). No question is pending for the human; answers that arrive later are applied through `/sdlc-change`.

## 11. Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-11-12 | product-manager | P1 baseline (PRD, REQUIREMENTS 1.0, NFR 1.0, 17 epics, BACKLOG). |
| 1.1 | 2026-11-12 | product-manager | G1 condition closure: D-035 one value per default, D-036 tag corrections, D-037 DC tag and re-scope ladder (§7.1). Counts: 430 REQs (317/94/19; 204 M0 / 226 M1), 290 stories (214/68/8; 119 M0 / 171 M1), 134 DC. |
| 1.2 | 2026-11-12 | product-manager | **P3 alignment before G2 (D-038..D-045).** Wording-only; no REQ/US IDs, priorities, milestones or counts changed. (1) REQ-AUTH-006 `__Host-` cookie read only by auth routes; US-018 AC. (2) DR-A02/REQ-AUTH-017 MFA lock per user; US-024 AC. (3) REQ-DATA-002 seed defaults refused when `APP_ENV ≠ local`; US-049 AC. (4) DR-A08 pre-authentication per-IP limiter; REQ-SEC-005; US-040 AC. (5) Token-free public paths: REQ-ORG-011/US-084/US-268 `POST /invitations/accept`, REQ-QUOTE-015/US-165 `POST /public/shared-quotes/resolve`, REQ-TRACK-009/US-250 `POST /public/tracking/lookup`. (6) D-038 ASVS V3.3.2 deviation (30-day refresh) accepted and compensated; NFR-SEC-004. (7) D-039 "MinIO" → "S3-compatible (RustFS locally)" in REQ-DOC-006, US-220, NFR-REC-003, NFR-OPS-001, NFR-AUDIT-007. (8) REQ-AUDIT-002 enum + `MFA_RECOVERY_USED`, `SESSION_REVOKED`; REQ-AUDIT-006 `NONE` closed list; US-086/US-087 AC. (9) NFR-DATA-003 append-only exemption. (10) D-042 `ACCOUNT_HAS_ACTIVE_SHIPMENTS` 409 confirmed; `LAST_OWNER` 422 in REQ-ACCT-015/EC-B46 (was 409). (11) D-041 REQ-API-007/DR-A21 `x-max-limit` ≤ 300 on bounded reference lists; US-037 AC. (12) D-040 REQ-NOTIF-012 / NFR-PRIV-004 reconciled (masked address, redacted identifiers); US-289 AC. (13) US-005 "no terraform apply" scoped to `ci.yml`; REQ-PLAT-007. (14) Refresh/logout/csrf in the `public` rate class (DR-A22, NFR-SEC-005). (15) D-044 Node 24 LTS and the D-ORCH-001 CI evidence model in REQ-PLAT-007, US-004, US-005, NFR "How to read", NFR-OPS-001/003, NFR-REC-003, NFR-QUAL-006. (16) D-045 and A-083..A-092: Node 24 via fnm, RustFS spike/fallback, 90-day unclaimed-quote purge, 30-day refresh, client-side auto sign-in after registration, es "tú"/fr "vous", en-US/es-ES/fr-FR fallbacks, full receiver ID on the customs invoice, CI evidence model, `x-max-limit` scope. A-021/023/035/041/044/054/082 updated. REQUIREMENTS.md → 1.2, NFR.md → 1.2, traceability.md → 1.2. |
| 1.3 | 2026-11-12 | product-manager | **P3 security remediation before G2 (D-046..D-052; `docs/05-quality/security/P3-architecture-security-review.md`).** IDs stable, new IDs appended. (1) **D-046 supersedes D-038:** customer session 30 d sliding inside a **30 d absolute cap** (REQ-AUTH-007, `SESSION_EXPIRED`), `auth_time` claim and 12 h age-based step-up (new REQ-AUTH-025), always-re-auth on payment-method setup/add/update/delete and privacy export (REQ-PAY-014, REQ-ACCT-016), 12 h step-up on invitation create/resend and member role change/suspend/remove (REQ-ORG-010/012, REQ-ACCT-014 note), CVC re-collection on saved-card checkout when `auth_time` > 12 h, 7-day refresh fallback; REQ-AUTH-020 Should → **Must**; NFR-SEC-004 rewritten; new story US-291 (Must). (2) **D-047:** REQ-AUTH-021/022 Should → Must; US-027 Should → Must (ASVS 3.3.4). (3) **D-048:** two carrier bulkheads `rates` 6 / `transactional` 4 (REQ-CARR-017, DR-B32, NFR-RES-003), anonymous budget (new REQ-CARR-022), daily quota guard (new REQ-CARR-023), `CARRIER_BUSY` retryable and non-ambiguous in the saga (REQ-BOOK-023, DR-B03, EC-B48/B49), streams never fan out and are capped 2/IP 5/user (REQ-CARR-009, DR-A22), new NFR-RES-007, new story US-293 (Must). (4) **D-049:** register in the `email-send` class + `registration_probe` (REQ-AUTH-001, REQ-SEC-005/012, DR-A22, EC-A52); RR-16 accepted as §9 R-12. (5) **D-050:** verification revokes other sessions (REQ-AUTH-004), reset sets `email_verified_at` (REQ-AUTH-012), 7-day unverified expiry (new REQ-AUTH-026, M0 Must; new story US-292), DR-A04, EC-A51. (6) **D-051:** pack `invoice_print: FULL \| MASKED` per reference type (REQ-COMP-001, REQ-CUST-012), SENSITIVE documents never attached (REQ-DOC-010, REQ-NOTIF-008), Viewer lacks `document:download`/`document:email`/`privacy:export` (REQ-RBAC-004). (7) **D-052:** admin input-idle mechanism (REQ-ADMIN-004), blob/allow-list redaction (REQ-CARR-018), staff first-enrolment e-mailed code + 24 h deadline + passwordless non-local seed (REQ-AUTH-018, REQ-DATA-002), guest token 7-day grace (REQ-QUOTE-002), Mock flags (REQ-CARR-006), `livemode` webhook rejection (REQ-PAY-012), NFR-SEC-012 licence closures, REQ-API-014 draft-06 headers, new security events. §7 volume and §7.1 table updated; §9 R-12..R-14 added. New A-093..A-098; A-023/035/037/041/074/086/090 updated. Counts: 434 REQs (324/91/19; 205 M0 / 229 M1), 91 NFRs (75/10/6), 293 stories (218/67/8; 120 M0 / 173 M1), 134 DC unchanged. REQUIREMENTS.md → 1.3, NFR.md → 1.3, traceability.md → 1.3. |
| 1.4 | 2026-11-12 | product-manager | **G2-C3 requirement side (D-053..D-057; `docs/sdlc/gates/G2-attempt-1.md` G2-C3, security review §14).** Wording and configuration only; no REQ/US IDs, priorities, milestones or counts changed (434 REQs, 91 NFRs, 293 stories, 134 DC). (1) **D-053 (SEC-COND-07 / SEC-P3-29):** signed-in `PENDING_VERIFICATION` users are anonymous callers for the carrier budget (REQ-CARR-022, REQ-QUOTE-002, DR-B32); new `quote-create` rate class 30/min + 300/h per user, 1,000/h per organisation on authenticated `POST /quotes` (REQ-SEC-005, DR-A22, NFR-SEC-005); `CARRIER_QUOTA_ORG_SHARE_PCT=10` per-organisation share of each carrier account's daily quota with `carrier_quota_org_share_exhausted` (REQ-CARR-023, NFR-RES-007, REQ-SEC-012); US-293 and US-040 AC (SEC-TC-62); EC-B50/B51; A-094 updated, A-099. (2) **D-054 (SEC-COND-06 / SEC-P3-28):** saved-card checkout with CVC re-collection is `AUTHORISED` only when `cvc_check = pass`, otherwise void + `FAILED/AUTHENTICATION_FAILED` + `cvc_recollection_failed` on confirm and webhook paths; Mock CVC outcomes (REQ-PAY-014, US-217 AC, EC-B52, A-100). (3) **D-055 (SEC-P3-32):** share link mint-and-revoke audited (`UPDATE quote_share` superseded), cap 10 per quote per hour, byte-identical 404 for unknown/revoked/superseded/expired (REQ-QUOTE-015, EC-B29, EC-B53, US-165 AC, A-101). (4) **D-056 (SEC-P3-30/33):** REQ-SEC-012 lists `job_context_mismatch`, `webhook_livemode_rejected`, `audit_anchor_missing`, `cvc_recollection_failed`, `carrier_quota_org_share_exhausted`; REQ-AUTH-018 aligned with ADR-0006 am. 14 (deadline from `first_signed_in_at`, 403 `MFA_ENROLMENT_CODE_REQUIRED`, `ops:staff-reactivate`; US-025 AC, A-098); REQ-BOOK-023 names `LOCAL_REJECT`, stays in BOOKING while retrying, DRAFT (not EXCEPTION) at the deadline (US-205 note). (5) **D-057:** RR-19 accepted as §9 R-15 (A-102); R-13 updated for the SEC-P3-29 closure. (6) US-027 checked after D-047: M1 · Must · not DC, consistent with REQ-AUTH-021/022 (M1 Must) and the epic table and traceability rows; no change. (7) Table fix: unescaped pipe in the REQ-COMP-001 row (`FULL \| MASKED`) that split the row into 7 cells since v1.3; consistency script now parses 434 = 324/91/19, 205/229 exactly. REQUIREMENTS.md → 1.4, NFR.md → 1.4; traceability.md untouched (no ID changes; principal-architect fills the Design column in parallel). |
| 1.5 | 2026-11-12 | product-manager | **P5 Wave 0 role-matrix ruling (D-058; PR #8 / TASK-013 D-T013-05).** Wording only; no REQ/US IDs, priorities, milestones or counts changed (434 REQs, 91 NFRs, 293 stories, 134 DC). The self-service set `session:manage`, `notification_pref:manage`, `notification:read` (own rows on `user`-tenancy `/me/*` routes) is held by every seeded role; REQ-RBAC-004 invariants carve it out and assert it positively, Super Admin holds every *role-assignable* permission (signature-only webhooks belong to no role); REQ-RBAC-014 note, REQ-ACCT scope note and DR-A07 aligned; grant corrections for TASK-013: Viewer + `session:manage`/`notification_pref:manage`, Finance + `notification_pref:manage`/`order:read`, customer Admin + `privacy:delete`, Compliance Auditor + `session:manage`/`notification_pref:manage`; Viewer confirmed without `payment:read`/`privacy:delete`. US-066 notes and AC extended; A-074 updated; A-103/A-104 added. REQUIREMENTS.md → 1.5; NFR.md and traceability.md untouched. |
| 1.6 | 2026-11-12 | product-manager | **P5 Wave 0 batch-3 architecture alignment (D-059; `docs/03-architecture/rulings/wave-0-batch-3-rulings.md`, D-ARCH-057..062, ADR-0010 am. 11, ADR-0008 am. 2).** Wording only; no REQ/US IDs, priorities, milestones, DC tags or counts changed (434 REQs, 91 NFRs, 293 stories, 134 DC). Demo-critical impact confirmed none: every touched story (US-121 DC keeps its AC and gains a scenario; US-129, US-130, US-137, US-196, US-215, US-216, US-222, US-229, US-252) is either non-DC or unchanged on its demo path. (1) Cancellation when the adapter cannot void (DHL Express `cancelShipment` unsupported): `carrier_void = UNSUPPORTED`, pickup cancelled, label VOIDED Platform-side, refund proceeds, never EXCEPTION (REQ-BOOK-029/030, REQ-DOC-013, DR-B21; US-196/US-215/US-216/US-229 AC). (2) Capability guard covers every operation the adapter declares unsupported; `operations.cancelShipment` boolean; optional `recoverLabel` in the interface, retryable and in the `transactional` pool (REQ-CARR-001/002/003/017, DR-B32, NFR-RES-003; US-121/US-130 AC). (3) Token-endpoint failure path: negative cache 60 s, per-carrier token bucket, 403 → 600 s carrier-wide cool-down, TTL from `expires_in` with skew/cap (REQ-CARR-016; US-129 AC, SEC-TC-68). (4) README field "Diffed against official spec by a person: yes (date, role) \| no" with spec commit SHA and "PII and redaction" subsection; `no` allowed under COND-SANDBOX-DEMO (REQ-CARR-019; US-137 AC). (5) No carrier push-authenticity scheme this run, `pushTracking = false` ×3, Platform HMAC contract only (REQ-TRACK-006; US-252 AC). (6) DR-A07 confirmed already at "every role-assignable permission" since 1.5 (D-ARCH-059 item closed, no edit). (7) UPS PDF labels via Label Recovery (`recoverLabel`, `labelFormats = [PDF_4X6, ZPL]`): REQ-DOC-002 satisfied as worded, noted with R-ARCH-25 (REQ-DOC-002 note; US-222 notes and AC). (8) A-105 (DHL does not invoice a never-handed-over shipment), A-106 (UPS Label Recovery unverified in CIE), A-107 (no push scheme). REQUIREMENTS.md → 1.6, NFR.md → 1.5 (NFR-RES-003 pool list only); traceability.md untouched (no ID changes). |
