# Backlog — Epics outside this run (M2–M5 and LATER)

Version 1.1 · 2026-11-18 · owner product-manager. Every item below is **MoSCoW: Won't (this run)** per D-001. They are listed so that seams required by the brief are visible to principal-architect and so later `/sdlc-change Implement milestone Mx` runs start from a known list. No detailed stories exist for these epics yet, except those in "Backlog stories written ahead of their milestone" at the end of this file.

v1.1 (D-PM-070): new M5 epic EPIC-B-508 and backlog story US-B-001 (first operator staff user in production, D-ARCH-153, R-ARCH-33); EPIC-B-207 row cross-references it.

Seams that THIS run must leave in place for them are called out in the "Seam now" column; they are requirements in `REQUIREMENTS.md` (tagged M0/M1), not backlog work.

## M2 — Admin ERP core (brief §12, §6)
Exit demo: staff create an order for a customer, override a price with a signed reason, refund it, and export the complete audit history of that order.

| Epic | One-line description | Brief | Seam now |
|---|---|---|---|
| EPIC-B-201 Orders & shipments admin | Global search, full detail with timeline/charges/documents/carrier messages/notes/audit history; cancel, void, re-book, re-print, manual status change with reason | §6.2 | Shipment entity history (REQ-AUDIT), state machine (REQ-BOOK) |
| EPIC-B-202 Booking on behalf | Same wizard with staff-only options: price override with signed reason, choose carrier account, charge saved method, send payment link, record offline payment; `created_by_user_id` + `on_behalf_of_org_id`; "Booked by <staff>" in customer history | §4.2, §6.2 | `on_behalf_of_org_id` column + audit field (REQ-ORG/REQ-AUDIT); re-auth primitive (REQ-AUTH) |
| EPIC-B-203 Customers & organisations admin | Profiles, contacts, KYC status, credit limit/terms, pricing overrides, discounts, wallet, notes, merge, block/suspend | §6.3 | Org types and membership model (REQ-ORG) |
| EPIC-B-204 Carriers & accounts admin | Carriers, services, accounts with credentials + connection test, sandbox/production toggle per account, transit days, holidays, availability rules by lane | §6.4 | Carrier account/environment model, service reference data (REQ-CARR, REQ-DATA) |
| EPIC-B-205 Pricing administration & simulator | Rate cards (versioning, draft/publish, effective dates), zones, margin/discount rules, surcharges, remote areas, cover terms, coupons, FX, tax rules, import/export, price simulator explaining rules fired | §6.5 | Pure engine with explanation output and rate-card cost-source discriminator (REQ-PRICE); FX table (REQ-DATA) |
| EPIC-B-206 Payments, refunds & invoices admin | Payments list, refunds with approval workflow (partial), invoices and credit notes as PDFs with per-country numbering | §6.6, §4.7 | Payment records and gateway abstraction (REQ-PAY); number-sequence mechanism (REQ-DATA) |
| EPIC-B-207 Users, roles & permission matrix editor | Staff users, role/permission editor (signed), MFA enforcement, sessions, access reviews. Every further staff user is created here by an existing Super Admin; the first one in production comes from EPIC-B-508 (US-B-001) | §6.13 | Permission catalogue + roles as data (REQ-RBAC) |
| EPIC-B-208 Audit exports & regulator report | CSV/PDF export (async for large ranges), regulator-ready report with query, generator, count, content hash and chain result; exports audited | §4.9, §6.14 | Viewer filters and chain verification (REQ-AUDIT) |
| EPIC-B-209 Electronic signature for critical actions | Re-authentication + typed reason bound to the audit entry for refunds, overrides, role changes, carrier account changes, manual status changes, rate-card publication, audit exports | §4.9 | Re-auth primitive and `reason` field in audit entry (REQ-AUTH, REQ-AUDIT) |
| EPIC-B-210 Core dashboard & settings | Bookings, revenue, margin, carrier mix, on-time, exceptions widgets; settings for countries, currencies, units, sequences, compliance packs, branding | §6.1, §6.15 | Analytics event stream seam (REQ-PLAT); compliance pack model (REQ-COMP) |

## M3 — Partner platform (brief §12, §7)
Exit demo: a partner connects its own sandbox carrier account, books through the API with an idempotency key, and receives signed tracking webhooks.

| Epic | One-line description | Brief | Seam now |
|---|---|---|---|
| EPIC-B-301 Partner onboarding | Application, verification, approval by staff, acceptance of terms | §7 | PARTNER org type and roles seeded (REQ-ORG, REQ-RBAC) |
| EPIC-B-302 Bring-your-own carrier accounts | Guided forms or OAuth per carrier, "Test connection", sandbox/production, write-only credentials, envelope encryption per tenant; programme-rules ADR | §4.3, §7 | CarrierContext carries account ownership (REQ-CARR) |
| EPIC-B-303 API keys & test/live modes | `pk_test_`/`pk_live_` keys shown once, hashed, scoped, revocable, last-used; mode selected by prefix | §4.2, §4.8 | Actor type API_KEY in audit; test/live mode seam (REQ-API) |
| EPIC-B-304 Public API hardening & developer portal | Rate limits per key, deprecation/sunset, Swagger + portal page, quick-starts, Postman collection, changelog | §4.8, §7 | OpenAPI contract-first pipeline (REQ-API) |
| EPIC-B-305 Outbound webhooks | HMAC-signed, timestamped, retried, dead-lettered, replayable; delivery logs | §4.8 | Outbox events (REQ-PLAT) |
| EPIC-B-306 Usage metering | Requests, labels, tracked shipments per key/org for future subscription billing | §2.2, §4.8 | Metering counters seam (REQ-API) |
| EPIC-B-307 Partner pricing & sub-accounts | Partner margin rules over own costs; end customers within the partner tenant | §7 | Rule dimension "carrier account" (REQ-PRICE) |

## M4 — Operations and finance depth (brief §12)
Exit demo: a carrier invoice is imported, mismatches are flagged, one discrepancy is re-charged to the customer and the ledger balances.

| Epic | One-line description | Brief | Seam now |
|---|---|---|---|
| EPIC-B-401 PayPal gateway | Second gateway through the same abstraction | §4.7 | Gateway abstraction (REQ-PAY) |
| EPIC-B-402 Wallet, credit accounts & double-entry ledger | Balances derived from ledger entries; top-ups, statements, credit limits and terms | §4.7 | Payment records reference a ledger seam (REQ-PAY) |
| EPIC-B-403 Carrier invoice import & reconciliation | CSV/Excel import, match to booked shipments, billing discrepancies with dispute tracking and re-charge | §6.6 | Shipment stores carrier cost snapshot (REQ-PRICE/REQ-BOOK) |
| EPIC-B-404 Exception queue & operations board | Failed delivery, address problem, customs hold, damaged, lost, RTS; assignment, SLAs, pickup board, manifests | §6.7 | EXCEPTION state and canonical tracking taxonomy (REQ-TRACK) |
| EPIC-B-405 Claims | Intake, evidence, carrier claim reference, decision, payout via ledger | §6.8 | CLAIM_OPEN state (REQ-BOOK) |
| EPIC-B-406 Support tickets & inbound email | Ticket inbox linked to shipments/customers, canned replies, per-tenant inbound address via SES + Lambda | §3.3, §6.9 | Notification provider interface (REQ-NOTIF) |
| EPIC-B-407 Bulk shipment upload | CSV/Excel with row-level validation and fix-in-place grid; multiple pickup addresses; cost centres; monthly statement | §5 Business extras | Shipment create API is batch-friendly (REQ-BOOK) |
| EPIC-B-408 CMS & localised content | Landing pages, FAQs, help, banners, prohibited-items lists, legal documents with versions | §6.11 | Pre-rendered public routes (REQ-UI) |
| EPIC-B-409 Notification template editor & channels | Versioned editable templates with preview; SMS/WhatsApp providers | §4.13 | Templates versioned, channel interface (REQ-NOTIF) |
| EPIC-B-410 Reports | Shipments, revenue/margin by carrier/lane/customer/period, carrier performance, coupons, tax per country; scheduled delivery; CSV/Excel/PDF | §6.12 | Analytics event stream seam (REQ-PLAT) |
| EPIC-B-411 Feature-flag administration | UI for per-environment/per-org/percentage targeting | §4.13 | Flag service (REQ-PLAT) |
| EPIC-B-412 Compliance packs: strategy code, sanctions screening, KYC | Pluggable screening provider with manual review queue; DG declarations; KYC document capture and verification | §4.12 | `screening_status` field (REQ-CUST); pack versioning (REQ-COMP) |
| EPIC-B-413 Privacy workflows | Consent management, data-subject export/erasure workflows, retention schedules by jobs, processing inventory | §4.12 | PII field classification, retention periods recorded (REQ-COMP, REQ-RLS) |
| EPIC-B-414 System health screen | Queue depths, failures, carrier status/latency, webhook deliveries, scheduled jobs, error log search | §6.16 | Job observability metrics (REQ-PLAT) |

## M5 — Production readiness (brief §12, §10)
Exit demo: staging runs on AWS from CI; load test meets budgets; restore drill passes; migration dry-run reconciles.

| Epic | One-line description | Brief | Seam now |
|---|---|---|---|
| EPIC-B-501 Terraform for all environments, applied in CI | VPC 3 AZ, ALB+WAF, ECS on EC2 ASG, RDS Multi-AZ, ElastiCache, S3 (Object Lock for audit), SES, Lambda, Secrets Manager, KMS, CloudWatch, AWS Backup | §10 | Terraform written, validated and Checkov-checked this run (CLAUDE.md §3) |
| EPIC-B-502 Progressive delivery & rollback | Canary 5→25→50→100 with automatic rollback on triggers | §10, CLAUDE.md §3 | CD pipeline stages present, no-op without targets |
| EPIC-B-503 Observability, SLOs & alerts | Dashboards, burn-rate alerts, on-call runbooks | §9, §10 | OpenTelemetry instrumentation (NFR-OBS) |
| EPIC-B-504 Load & security testing on AWS to §9 | k6 at 300 rps, soak, ZAP full | §9, §11 | Local k6/ZAP baselines (NFR-PERF/SEC) |
| EPIC-B-505 DR drill, backup/restore, retention & privacy jobs, audit archive to S3 Object Lock | RPO/RTO proof; partition export with manifest | §4.9, §10 | Partitioning and chain verification (REQ-AUDIT) |
| EPIC-B-506 Legacy data migration | Appendix A ETL with crosswalk, MIGRATED audit entries, reconciliation, dry run | App. A | UUIDv7 keys, `MIGRATED` action in audit taxonomy (REQ-AUDIT) |
| EPIC-B-507 Documentation set & multi-region notes | DR plan, runbooks, retention policy, architecture notes for active-passive/active-active | §10 | Region in configuration (REQ-PLAT) |
| EPIC-B-508 Go-live bootstrap: first operator staff user | One-shot audited pipeline command `ops:staff-bootstrap` that creates the first Super Admin in the reserved operator organisation, without credentials, with a set-password link. Precondition of G4 for a production release (R-ARCH-33). Story US-B-001 below | §4.2, §10, D-ARCH-153 | Reserved operator organisation row and `OPERATOR_ORG_ID` (TASK-037, D-ARCH-151); staff-provisioning function exported from the service layer (TASK-089); `ops:staff-reactivate` command family and e-mailed first-enrolment code (REQ-AUTH-018); set-password link through the reset flow (REQ-DATA-002) |

## LATER (brief §12)
| Epic | One-line description | Seam now |
|---|---|---|
| EPIC-B-901 Subscription billing | Partner plans billed from metered usage | Metering (M3) |
| EPIC-B-902 White-label theming & custom domains | Per-tenant themes and domains | Tenant branding config, `BRAND_*`, themable tokens (REQ-UI) |
| EPIC-B-903 Multi-region deployment | Active-passive then active-active | Stateless API, region in config (REQ-PLAT) |
| EPIC-B-904 AI-driven analytics | Carrier recommendation, delivery-date prediction, anomaly detection | Analytics event stream (REQ-PLAT) |
| EPIC-B-905 Marketplace integrations | Shopify, WooCommerce, Amazon, eBay | Channel-integration interface seam |
| EPIC-B-906 Pallets & freight | New package types | `package_type` enum seam (REQ-BOOK) |
| EPIC-B-907 Cash-on-delivery | COD collection and remittance | Payment method enum seam (REQ-PAY) |
| EPIC-B-908 Native mobile apps | iOS/Android | Same `/api/v1` API |
| EPIC-B-909 Social and OTP login | Identity module extension | Identity module boundary (REQ-AUTH) |

## Backlog stories written ahead of their milestone

These stories are **Won't (this run)**. Each is written now because a Run 1 decision created an obligation that must not be lost before its milestone is planned. Their IDs are `US-B-NNN`, outside the `US-NNN` series. They are not counted in the PRD or traceability totals and have no `AT-` IDs, REQ row or task until their milestone is planned; the planning run for that milestone gives them a `US-NNN` ID and a requirement.

### US-B-001 — Create the first operator staff user in production (`ops:staff-bootstrap`)
- **Epic:** EPIC-B-508 · **Milestone:** M5 · **MoSCoW at M5:** Must (precondition of G4 for a production release, R-ARCH-33) · **Size:** M · **Depends on:** TASK-037 (reserved operator organisation, D-ARCH-151), TASK-089 (staff-provisioning function exported from the service layer), US-025 (mandatory TOTP and e-mailed first-enrolment code), EPIC-B-502 (the pipeline that runs the command)
- **Linked REQs:** none yet. Related Run 1 requirements: REQ-ORG-001, REQ-AUTH-011, REQ-AUTH-012, REQ-AUTH-018, REQ-DATA-002.
- **Source:** D-ARCH-153, ADR-0005 amendment 12 item 26, `docs/03-architecture/risks.md` R-ARCH-33, `docs/03-architecture/rulings/wave-1-batch-1.1-rulings.md` §2.4; placed by D-PM-070.
- **As a** platform operator going live **I want** the release pipeline to create exactly one Super Admin in the operator organisation, without a password, and send that person a set-password link **so that** the admin app has a first accountable staff user in production and nobody writes to the database by hand.
- **Notes:**
  - **Why it exists.** Every migrated database has the operator organisation (D-ARCH-151), but the organisation has no member. Staff users come from the demo seed, which never runs in production (REQ-DATA-001/002), and the staff-user screens are EPIC-B-207 (M2), which need a signed-in Super Admin to begin with.
  - **Fixed by the architecture (D-ARCH-153).** The command is of the same family as `ops:staff-reactivate`. It runs as `platform_app` through the identity and organisations services with a `SYSTEM_JOB` actor, as a pipeline task and never from a terminal (CLAUDE.md §5). It creates no `OPERATOR` organisation, and it refuses when the operator organisation already has a member.
  - **Product defaults that M5 planning confirms (A-110).** The refusal counts a membership in any status, so a suspended or removed staff member does not reopen the command. An address that already belongs to an account with a password is never promoted. The address domain must be on a configured operator allow-list. The run carries a pipeline run reference that is written to the audit entries. The reason names in the scenarios are proposals.
  - **Personal organisation.** The shared provisioning function creates the user's personal `INDIVIDUAL` organisation, as for every user (DR-A06). "Creates no organisation" in D-ARCH-153 is read as "no `OPERATOR`, `BUSINESS_CUSTOMER` or `PARTNER` organisation"; principal-architect confirms at M5.
  - **Not covered.** Recovery from a wrong address that passed the allow-list is a break-glass runbook item for EPIC-B-507, not a relaxation of the refusal. An expired set-password link is replaced through the normal password-reset request; the command is not re-run.
  - **Done for G4 when** the scenarios pass in CI and one rehearsal with `APP_ENV=staging` against the mail catcher is in the release dossier.

#### Acceptance criteria
Permission path: not applicable — the command has no HTTP route and no calling principal. The controls are the pipeline's environment approval, the refusal once a member exists, and the audit entries.

```gherkin
Feature: First operator staff user in production
  Background:
    Given a database migrated to the release version, with APP_ENV "staging" for the rehearsal and "production" for the release
    And the reserved OPERATOR organisation exists and has no membership row in any status
    And the operator e-mail domain allow-list contains "ops.example.test"

  Scenario: Bootstrap creates exactly one Super Admin without credentials
    When the pipeline task runs ops:staff-bootstrap for "lead@ops.example.test" with run reference "run-1001"
    Then exactly one new user exists with that address, with no password hash and no TOTP secret
    And that user holds one ACTIVE membership in the OPERATOR organisation whose role set is exactly ["OPERATOR_SUPER_ADMIN"]
    And exactly 1 organisation of type "OPERATOR" exists, and the counts of BUSINESS_CUSTOMER and PARTNER organisations are unchanged
    And one single-use SET_PASSWORD link is e-mailed to "lead@ops.example.test"
    And the command exits with status 0

  Scenario: First sign-in follows the staff enrolment rules
    Given the bootstrapped user has set a password through the link
    When they sign in to the admin app
    Then every route except the MFA enrolment endpoints answers 403 "MFA_ENROLMENT_REQUIRED"
    And TOTP activation without the 6-digit e-mailed code answers 403 "MFA_ENROLMENT_CODE_REQUIRED"
    And a user who has not activated TOTP 24 hours after their first sign-in (fake clock) is SUSPENDED with reason "MFA_ENROLMENT_OVERDUE"

  Scenario Outline: A run is refused once the operator organisation has a member
    Given the OPERATOR organisation has one membership row with status "<status>"
    When ops:staff-bootstrap runs for "second@ops.example.test"
    Then the command exits with a non-zero status and the reason "OPERATOR_ALREADY_HAS_MEMBER"
    And no user, membership or link is created and no e-mail is sent
    And one audit entry with outcome "FAILED" and actor type "SYSTEM_JOB" records the refused run
    Examples:
      | status    |
      | ACTIVE    |
      | SUSPENDED |
      | REMOVED   |

  Scenario: An existing account with a password is never promoted
    Given a user "lead@ops.example.test" already exists and has a password
    When ops:staff-bootstrap runs for "lead@ops.example.test"
    Then the command exits with a non-zero status and the reason "ACCOUNT_EXISTS"
    And that user has no membership in the OPERATOR organisation and receives no e-mail

  Scenario: A run that stopped half-way is completed by running it again
    Given an earlier run created the user "lead@ops.example.test" without credentials as the SYSTEM_JOB actor and stopped before the operator membership was written
    When ops:staff-bootstrap runs again for "lead@ops.example.test"
    Then the ACTIVE membership with role "OPERATOR_SUPER_ADMIN" is added and still exactly one user has that address
    And exactly one SET_PASSWORD link for that user is valid
    And the command exits with status 0

  Scenario Outline: Invalid input is refused before anything is written
    When ops:staff-bootstrap runs with <input>
    Then the command exits with a non-zero status and the reason "<reason>"
    And no user, membership, link, e-mail or organisation is created
    Examples:
      | input                                          | reason                 |
      | no address                                     | ADDRESS_REQUIRED       |
      | the address "not-an-email"                     | ADDRESS_INVALID        |
      | the address "lead@elsewhere.example.test"      | ADDRESS_DOMAIN_REFUSED |
      | a valid address and no run reference           | RUN_REFERENCE_REQUIRED |

  Scenario: The command writes with the runtime role only
    When ops:staff-bootstrap runs
    Then every statement runs as the database role "platform_app" inside a tenant transaction
    And no connection is opened as the migrator, the audit owner or a cluster administrator

  Scenario: Audit and secrecy
    When the first scenario has run
    Then one "CREATE" entry for entity "user" and one "CREATE" entry for entity "membership" exist with actor type "SYSTEM_JOB", outcome "SUCCESS" and run reference "run-1001"
    And the membership entry shows the new role set ["OPERATOR_SUPER_ADMIN"]
    And standard output, the logs and the audit entries contain no password, token, link or enrolment-code value
```
