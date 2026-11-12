# Backlog — Epics outside this run (M2–M5 and LATER)

Version 1.0 · 2026-11-12 · owner product-manager. Every item below is **MoSCoW: Won't (this run)** per D-001. They are listed so that seams required by the brief are visible to principal-architect and so later `/sdlc-change Implement milestone Mx` runs start from a known list. No detailed stories exist for these epics yet.

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
| EPIC-B-207 Users, roles & permission matrix editor | Staff users, role/permission editor (signed), MFA enforcement, sessions, access reviews | §6.13 | Permission catalogue + roles as data (REQ-RBAC) |
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
