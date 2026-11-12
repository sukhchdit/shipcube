# Decision Log (append-only)
Format: ID · date · who · decision · why · alternatives · reversibility

### D-001 · 2026-11-12 · sdlc-orchestrator · Run scope = M0 + M1 only
- **Decision:** This run delivers milestones M0 (Foundation) and M1 (Customer MVP) from brief §12. M2–M5 and LATER items are backlog; only the seams the brief requires are built.
- **Why:** Explicit human instruction in `/sdlc-start`; brief Appendix C §5 recommends milestone-sized runs.
- **Alternatives:** whole product in one run (rejected: unreviewable gates, unbounded cost).
- **Reversibility:** High. Later milestones arrive via `/sdlc-change`.

### D-002 · 2026-11-12 · sdlc-orchestrator · Operating parameters resolved
- DEPLOY_TARGET_STAGING = local/ephemeral via `docker compose` (default; blank in CLAUDE.md).
- DEPLOY_TARGET_PRODUCTION = none. The release ends with a tagged version, published artifacts/images and a deploy-ready pipeline (default).
- CI_PLATFORM = GitHub Actions, repo `sukhchdit/shipcube` (set).
- CLOUD_BUDGET_MONTHLY_USD = 0. No paid resources; Terraform is fmt/validate/plan-less (no AWS creds)/Checkov only (set).
- LICENSE_ALLOWLIST = MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, Unlicense, CC0-1.0 (default). Note: transitive deps commonly include 0BSD, BlueOak-1.0.0, Python-2.0, CC-BY-4.0 (data); any such case is handled by dependency-auditor with a logged decision.
- CANARY_STEPS = 5% → 25% → 50% → 100%, 10 min bake (default; designed into the pipeline but not exercised, since there is no prod target).
- ROLLBACK_TRIGGERS = error rate > 2× baseline, p95 > NFR budget, SLO fast-burn, failed health checks (default).
- COVERAGE_TARGET = 85% line / 75% branch overall; 95% on pricing, ledger, audit, authz (set).
- MAX_FIX_CYCLES = 3 (default). MAX_PARALLEL_DEVELOPERS = 4, drop to 2 on merge conflicts (set).
- **Reversibility:** High. Edit CLAUDE.md §3 and `/sdlc-resume`.

### D-003 · 2026-11-12 · human (Q-001) · Carrier/payment credentials: fixtures + Mock
- **Decision:** DHL Express, FedEx and UPS adapters are built against current official docs (version and date checked recorded in each adapter README), with recorded/synthesised `nock` fixtures and the shared contract suite. The Mock carrier and Stripe test mode (fixture-backed when no key is present) drive all e2e tests. Live sandbox runs are opt-in (`CARRIER_LIVE_SANDBOX=1`, `STRIPE_TEST_LIVE=1`).
- **Consequence:** The M1 exit demo "real sandbox label from each carrier" cannot run in this session. It becomes a tracked **post-release verification condition (COND-SANDBOX-DEMO)**, executable via one documented command once credentials are supplied. G3/G4 judge the demo with the Mock carrier + fixture replay.
- **Reversibility:** High.

### D-004 · 2026-11-12 · human (Q-002) · Push to GitHub and run CI there
- Task branches `feat/TASK-xxx-slug` are pushed; PRs via `gh`; merge to `main` after code-reviewer APPROVED + security-analyst no Critical/High + green CI. No force pushes.

### D-005 · 2026-11-12 · human (Q-003) · Release publishes tag + GitHub Release + GHCR images
- Semver tag, GitHub Release with notes, changelog and SBOM; container images pushed to `ghcr.io/sukhchdit/shipcube-*` by the GitHub Actions CD workflow (GITHUB_TOKEN, no long-lived secrets). No AWS deployment ($0 budget). Note: `docker push` from a terminal is denied by settings and isn't needed; publishing happens in CI only.

### D-006 · 2026-11-12 · human (Q-004) · Cadence: pre-release after M0
- One pipeline run. P5 waves are ordered M0 → M1. Once all M0 waves pass regression, release-manager cuts the `v0.1.0-m0` pre-release through CI (lightweight dossier, no gate). Full `v0.1.0` follows G4.

### D-007 · 2026-11-12 · sdlc-orchestrator · Brief §14 defaults adopted as-is
- Launch countries US, IN, UK, CA + an EU template pack (US→IN primary lane); currency/units follow origin; Stripe now, PayPal at M4; Part 11 controls only; per-tenant inbound email (M4); ECS on EC2 (Terraform written, not applied); documents + parcels; email+password with optional MFA (mandatory for operator staff per §4.2); placeholder brand.

### D-008 · 2026-11-12 · product-manager · Minimal admin slice inside M0/M1
- **Decision:** The admin app in this run contains only what the M0/M1 exit demos and the brief's hard obligations need: staff sign-in with mandatory TOTP enrolment/verification, the admin shell (sidebar, breadcrumb, locale switch, permission-denied/empty/error states), a **read-only audit viewer** (filters: date range, user, role, organisation, entity, entity ID, action, IP, outcome; entry detail with field diff; entity-level history), and "my sessions". No other admin screens. CSV/PDF export, regulator report, dashboard, orders, pricing admin etc. stay in M2.
- **Why:** M0 exit demo requires "sign in to both apps" and "audit entries appear in the viewer"; §4.2 makes MFA mandatory for staff. Anything more is M2 scope.
- **Alternatives:** no admin app until M2 (fails M0 demo); full audit module incl. exports (scope creep).
- **Reversibility:** High.

### D-009 · 2026-11-12 · product-manager · Account required to book; verified email required to pay
- **Decision:** Guests quote, compare, share and start the wizard without an account. Before step 1 of the booking wizard is saved, the guest must register or sign in; the quote is claimed by that account (§4.5). Checkout (payment) requires a verified email address. Unverified users can save drafts and addresses.
- **Why:** Labels, documents, refunds and tracking need a tenant and an auditable actor; emailed documents need a confirmed address; matches the §11 e2e journey "guest quote → compare → register → book → pay".
- **Alternatives:** guest checkout with email only (rejected: no tenant for RLS, weak audit identity, fraud risk); verification before wizard (rejected: adds friction before value).
- **Reversibility:** High (funnel telemetry on the verification step will validate).

### D-010 · 2026-11-12 · product-manager · Pricing engine v1 scope and configuration-as-seed
- **Decision:** Engine v1 (M1) supports: billable weight (actual vs volumetric, divisor per service and unit system), live-carrier cost source, margin and discount rules by carrier / service / carrier account / content type / weight band / lane / customer segment / date range with a default rule and documented precedence, fuel surcharge (percentage by date range) plus pass-through of carrier-returned surcharges, protection cover (included liability + optional cover with min charge and max insurable value), customer discounts incl. coupon codes with explicit stackability, per-country tax from the compliance pack (inclusive/exclusive display per country), FX snapshot. **Deferred to M2:** rate-card (own-rate) cost source and operator-configured remote-area/peak/residential/oversize surcharges (the engine input model carries the discriminators so they slot in without redesign). Since there is no pricing admin UI in M1, pricing configuration is **versioned seed data** loaded by the seed script; a booked shipment stores the immutable price snapshot.
- **Why:** Brief §12 M1 = "margins, fuel, cover, tax, currency"; §4.4 output/snapshot rules are mandatory; admin pricing UI is M2.
- **Alternatives:** full §4.4 engine in M1 (over-scope); margins only (fails tax/currency obligations).
- **Reversibility:** Medium (seed-based config is replaced by admin UI in M2 without engine change).

### D-011 · 2026-11-12 · product-manager · Payment gateway: Mock gateway in M0, Stripe test mode in M1
- **Decision:** A gateway abstraction with a deterministic **Mock gateway** exists from M0 so the booking saga (authorise → create carrier shipment → capture → documents → pickup → notify) runs end to end in the M0 demo. M1 adds **Stripe test mode** with hosted fields (Payment Element) and PaymentIntent authorise-then-capture, verified idempotent replayable webhooks, 3-D Secure test cards, and optional saved payment methods (gateway tokens only). When no Stripe key is configured the Stripe adapter runs fixture-backed (D-003). PayPal, wallet, credit accounts and payment links are M4.
- **Why:** PCI scope SAQ A (§4.7); saga requires an authorise/capture split; M0 demo needs a payment step without Stripe.
- **Alternatives:** Stripe in M0 (couples foundation to a credentialled integration); capture-immediately (breaks the "no captured payment without a shipment" rule).
- **Reversibility:** High.

### D-012 · 2026-11-12 · product-manager · Carrier accounts in M1 are platform-owned sandbox accounts from configuration
- **Decision:** M1 ships one platform-owned carrier account per carrier (DHL Express, FedEx, UPS), environment `sandbox`, credentials referenced from environment/secret-manager references only, plus the Mock carrier which is always enabled outside production. No carrier/account admin UI (M2). Rate shopping fans out to every enabled account whose service capabilities match the request; the Mock carrier's results are shown in non-production environments and hidden in production.
- **Why:** §4.3 account model; M2 owns carrier administration; D-003 (no credentials yet).
- **Reversibility:** High.

### D-013 · 2026-11-12 · product-manager · Address validation: format rules Must, carrier suggestions Should
- **Decision:** Country-aware format validation (postcode pattern, required fields, state/province lists) from reference data is Must. Carrier `validateAddress` suggestions (where the adapter declares the capability; Mock implements it deterministically) are Should.
- **Why:** Formatting rules are deterministic and offline; carrier validation needs sandbox credentials.
- **Reversibility:** High.

### D-014 · 2026-11-12 · product-manager · Collection modes in M1
- **Decision:** Courier pickup with date and time window (constrained by service cut-off, holidays and carrier pickup availability) is Must. Drop-off at a service point via `findServicePoints` as a **list** is Should. The map view is Could, contingent on a zero-cost tile source that satisfies its usage policy (principal-architect decides).
- **Why:** CLOUD_BUDGET = 0; map library is not part of the fixed stack; the exit demo uses pickup.
- **Reversibility:** High.

### D-015 · 2026-11-12 · product-manager · Customs in M1
- **Decision:** For non-document, cross-border shipments the wizard collects itemised customs lines (description, quantity, unit value, currency, commodity code, country of manufacture, weight), reason for export and Incoterm (DAP default, DDP where the carrier supports it). The Platform generates a commercial or pro-forma invoice PDF and stores any carrier-returned customs documents. Commodity-code search uses a **seeded sample HS list** (clearly labelled sample) plus 6/8/10-digit format validation; the operator supplies the licensed full list later. Prohibited/restricted-item checks run inline against seeded per-country and per-carrier lists. **Sanctions/denied-party screening is M4**; M1 records `screening_status = NOT_SCREENED` explicitly (no silent stub). Paperless-trade upload is Should where the carrier supports it.
- **Why:** Brief §5 step 2, §4.12; US→IN primary lane requires customs documents; screening provider is M4.
- **Reversibility:** High.

### D-016 · 2026-11-12 · product-manager · Tracking in M1
- **Decision:** Scheduled polling by the worker with adaptive intervals (Must). Carrier push-webhook ingestion endpoints are Should (cannot be demonstrated locally without a public URL). Public tracking page by tracking number or order number (Must), customer reference (Should), rate-limited, exposing only status, timestamps and city-level location. Tracking events map to the canonical taxonomy and keep the raw carrier event.
- **Reversibility:** High.

### D-017 · 2026-11-12 · product-manager · Self-service cancellation with automatic full refund (Should)
- **Decision:** A customer can cancel a shipment while it is BOOKED, LABEL_READY or PICKUP_SCHEDULED (before the carrier reports pickup/first scan). Cancellation voids the carrier shipment, cancels the pickup, and issues an **automatic full refund** through the gateway in test mode. Partial refunds, refund approval workflow and staff-initiated refunds are M2. If the carrier void fails, the shipment enters EXCEPTION and the refund is not issued automatically.
- **Why:** Without any admin in M1, a "cancel request" would have no handler; a non-cancellable booking is unacceptable for a payment flow.
- **Reversibility:** High.

### D-018 · 2026-11-12 · product-manager · Notifications in M1
- **Decision:** Email only, through a provider interface (SES adapter written; a local mail catcher in Compose receives everything; no live sends this run). Templates are versioned code + seed, localised en/es/fr; the admin template editor is M4. Events: email verification, password reset, new-device/security events, booking confirmation with documents, payment receipt, pickup scheduled/cancelled, tracking milestones (picked up, in transit, out for delivery, delivered, exception), cancellation and refund. Users control tracking-update and marketing preferences; transactional security mails cannot be disabled. SMS/WhatsApp interface only, no provider (LATER).
- **Reversibility:** High.

### D-019 · 2026-11-12 · product-manager · FX rates from a seeded snapshot table
- **Decision:** A `fx_rates` snapshot table with a provider interface. M1 seeds USD, INR, GBP, CAD and EUR rates with a timestamp and source label; updates are by seed/migration in this run; the admin FX screen is M2. The quote stores cost currency, sell currency, rate and timestamp (§4.4).
- **Why:** No budget for a paid FX feed; the mechanism, not the data freshness, is what M1 proves.
- **Reversibility:** High.

### D-020 · 2026-11-12 · product-manager · Compliance packs in M1 are data records seeded unreviewed
- **Decision:** Seed packs for US, IN, UK, CA and an EU template containing: tax rules (rate, inclusive/exclusive display, label), customs value thresholds (de minimis), prohibited and restricted items, privacy notice per locale, cookie/consent rule, retention periods (recorded, not yet enforced). Each pack has `version`, `effective_from`, `reviewed_by`, `reviewed_at`; unreviewed packs are flagged in API responses and shown with an "unreviewed" badge wherever staff see them. Strategy code, sanctions screening, KYC and retention jobs are M4/M5.
- **Reversibility:** High.

### D-021 · 2026-11-12 · product-manager · Quote and rate-shopping defaults
- **Decision:** Quote validity 24 h (configurable). Identical rate requests are cached for 300 s. Per-carrier deadline 4 s, overall rate-shopping deadline 5 s with partial results. Results stream via server-sent events. Compare up to 3 services side by side (Should). Save quote to account (Should) and share a quote by unguessable public link showing no personal data (Should). Sorting: cheapest, fastest, best value; filters: carrier, speed, collection mode, features.
- **Reversibility:** High.

### D-022 · 2026-11-12 · product-manager · Seed users and demo credentials
- **Decision:** The seed creates the operator organisation with one user per operator role, one business-customer organisation ("Acme Exports", US) with one user per customer role, one individual customer, and Mock carrier services and pricing configuration. Demo passwords are taken from `SEED_*` environment variables whose local-only defaults live in the Compose env file; the seed refuses to run with default passwords when `NODE_ENV=production`. Seeded staff users must complete TOTP enrolment on first sign-in.
- **Reversibility:** High.

### D-023 · 2026-11-12 · product-manager · Three locales from M0 for every shipped string
- **Decision:** en, es and fr resource files are complete for every string shipped from M0 onward (developer-authored translations, marked for operator linguistic review in a tracked task). A CI check fails on missing or unused keys. Locale affects numbers, dates, currencies, units and address formats.
- **Why:** Brief §8 (no concatenated strings), M1 lists en/es/fr; back-filling translations later is costlier.
- **Reversibility:** High.

### D-024 · 2026-11-12 · product-manager · Authentication parameters
- **Decision:** Access JWT 15 min; rotating refresh token 30 days (HttpOnly, Secure, SameSite=Strict cookie) with reuse detection revoking the whole family; bcrypt cost 12; password policy min 12 chars, checked against a breached-password list offline (top-10k list) — no external calls; lockout: progressive delay after 5 consecutive failures, 15-minute lock after 10, reset on success or password reset; verification and reset tokens single-use, 24 h and 60 min respectively; staff TOTP mandatory with 10 single-use recovery codes; customer TOTP optional (Should). Session list with remote sign-out (Should).
- **Reversibility:** High (values are configuration).

### D-025 · 2026-11-12 · product-manager · Document storage and uploads in M1
- **Decision:** Labels and documents are stored in S3-compatible object storage (MinIO in Compose) with SHA-256 hash, version and metadata; downloads use pre-signed URLs with a 300 s TTL issued only after a permission check and audited. M1 has **no end-user file uploads** (KYC, bulk upload, claims evidence are M4), so virus scanning is deferred to M4 with the interface noted.
- **Reversibility:** High.

### D-026 · 2026-11-12 · product-manager · Public pages pre-rendered
- **Decision:** Home (quote widget), public tracking, prohibited-items lookup, and static legal/help placeholder pages are pre-rendered (React Router framework mode). Results, wizard, checkout, account and admin are client-rendered. CMS-managed landing pages, help centre and FAQs are M4; M1 ships placeholder legal pages (terms, privacy per locale) from the compliance pack.
- **Reversibility:** High.

### D-027 · 2026-11-12 · product-manager · Privacy self-service in M1 is Could
- **Decision:** "Export my data" (JSON) and "Delete my account" (soft delete + 30-day grace) are Could in M1; full data-subject workflows, retention jobs and the processing inventory are M4/M5. Cookie consent banner with a stored consent record is Should.
- **Why:** No production target this run; the mechanism is M4 scope in the brief.
- **Reversibility:** High.

### D-028 · 2026-11-12 · product-manager · Business customer features in M1
- **Decision:** Organisation profile, team member invitation and role assignment from the seeded customer roles (Owner, Admin, Shipper, Finance, Viewer) are Should. Bulk CSV/Excel upload, multiple pickup addresses, cost-centre references and monthly statements are M4.
- **Reversibility:** High.

### D-029 · 2026-11-12 · product-manager · Prioritisation method
- **Decision:** WSJF-lite. Must = everything on the critical path of the two exit demos plus the brief's non-negotiable cross-cutting obligations (RBAC on every route, audit on every route, RLS, i18n, WCAG 2.2 AA, responsive). Should = brief-listed M0/M1 functionality not needed for the exit demos. Could = conveniences and items whose full version arrives in M2–M5. Release slices: R0 = `v0.1.0-m0` (M0 Must + Should), R1 = `v0.1.0` (M1).
- **Reversibility:** High.

### D-030 · 2026-11-12 · product-manager · Shipment state semantics for payment and cancellation
- **Decision:** `PAID` means the payment is **authorised** (funds held); capture happens after `BOOKING` succeeds, consistent with the §4.5 saga order (authorise → create carrier shipment → capture). The cancellation side path is `CANCELLED` → `VOIDED` (carrier confirms void) → `REFUNDED` (gateway confirms refund); `CANCELLED` is terminal only when no carrier shipment exists. Definitions are in REQUIREMENTS.md DR-B01/DR-B02.
- **Why:** The brief lists the side paths without defining them; the saga order forces "PAID before BOOKED" to mean authorised.
- **Alternatives:** capture before booking (violates the no-captured-payment-without-shipment guarantee); a separate AUTHORISED state (changes the brief's state list).
- **Reversibility:** Medium (state names are in the API contract from M0).

### D-031 · 2026-11-12 · product-manager · M0 saga executes payment and carrier steps; documents, pickup and notify steps are added in M1
- **Decision:** In M0 the booking saga runs authorise (Mock gateway) → create carrier shipment (Mock carrier) → capture, reaching `LABEL_READY` with the Mock label reference stored on the shipment. The document-generation, pickup-scheduling and notification steps are registered in M1 (REQ-DOC, REQ-PICK, REQ-NOTIF). The saga step list is explicitly extensible; no no-op placeholder steps exist in M0 (brief §13 rule 5).
- **Reversibility:** High.

### D-032 · 2026-11-12 · product-manager · Order number format
- **Decision:** `<ISO 3166 alpha-2 origin>-<8-digit zero-padded per-country sequence><Luhn check digit>` (REQ-DATA-015, DR-A24); REQ-BOOK-026 aligned at merge. Public lookups reject bad check digits without a database query.
- **Why:** Two analysts proposed slightly different formats; the check digit reduces enumeration noise on the public tracking endpoint.
- **Reversibility:** Low after first production order (numbers are customer-visible); high during this run.

### D-033 · 2026-11-12 · product-manager · Requirements volume accepted at 430 atomic REQs
- **Decision:** Keep all 430 atomic requirements (Part A 220 incl. REQ-RBAC-014 added at merge, Part B 210) rather than merging to a smaller count. Stories group them (typically 3–5 REQs per story); traceability is per REQ.
- **Why:** G1 judges atomicity and testability; merged rows would hide individually testable obligations (RBAC/audit/RLS apply to every feature).
- **Alternatives:** trim Could rows (would lose documented seams); merge pairs (would break cross-references).
- **Reversibility:** High.

### D-034 · 2026-11-12 · product-manager · Part B defaults adopted
- **Decision:** Adopted the Part B analyst's defaults as requirements: EXCEPTION after ambiguous booking auto-releases the authorisation, flags `needs_review` and retries the void every 4 h for 24 h (staff screen M2); emails go only to users of the booking organisation, never to receivers or other third parties; multi-shipment orders have one currency, max 10 shipments, one payment, partial capture for booked shipments only; DDP offered only when the adapter returns a duty estimate; customs invoices in English; default seeded margin 15%; best-value score 0.6 × relative price + 0.4 × relative transit days; billable weight rounded per package to 0.5 kg / 1 lb with divisors 5000 (metric) and 139 (imperial); discounts never price below cost unless the rule allows; tax of the origin country applies. Each is logged with confidence in ASSUMPTIONS.md A-057..A-072.
- **Reversibility:** High (all are configuration or seed values).
