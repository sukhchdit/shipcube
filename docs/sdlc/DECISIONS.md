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

### D-035 · 2026-11-12 · product-manager · G1-C1: one value per contradictory configuration default
- **Decision:** For each default that REQUIREMENTS.md and NFR.md stated differently, one value now holds in both documents, the affected stories and ASSUMPTIONS.md: (a) guest quote creation **20 requests/min and 100/h per IP** (REQ-QUOTE-002, US-155; NFR-SEC-005 changed from 60/min); (b) verification-resend and password-reset requests **3/h per account identifier and 10/h per IP** (REQ-AUTH-004/011, US-016/US-021, DR-A22; NFR-SEC-005 changed from 5/h per email); (c) compose all-healthy **≤ 180 s** with images already built or pulled (REQ-PLAT-005, US-003; NFR-OPS-001 changed from ≤ 10 min; cold build reported, not gated); (d) initial JavaScript of every public page incl. the pre-rendered home page **≤ 170 kB gzipped** (REQ-UI-018, US-111; NFR-WEB-004 changed from 200 kB); (e) the DR-A22 **5/min per account identifier** limit on authentication routes is kept and added to NFR-SEC-005, as are the REQ-TRACK-010 public-tracking values (300/h per IP, 10/min failed). (f) Found during reconciliation and fixed the same way: carrier resilience values in NFR-RES-001..003 now equal REQ-CARR-017/US-130 (tracking 10 s, cancel 10 s, pickup 15 s; max 2 retries; breaker opens at ≥ 50% of the last 20 calls (min 10) or 5 consecutive failures; bulkhead 10 per account). A-033, A-035, A-037, A-039 updated.
- **Why:** The architect needs one number per parameter; a design that satisfies one document and fails the other's test is the F1 risk. Where the two documents disagreed I kept the value that already had Gherkin scenarios written against it (REQ side) and the stricter abuse limit, because limits are configuration and are cheap to relax after telemetry but expensive to tighten after launch. 180 s is what the M0 demo needs on a laptop; 10 min was a loose default.
- **Alternatives:** Keep the looser NFR values (would require rewriting 6 story scenarios and weakens abuse resistance); pick a midpoint (satisfies neither document's existing tests).
- **Reversibility:** High. Every value is a configuration key; the NFR rows name the tests that would be re-thresholded.

### D-036 · 2026-11-12 · product-manager · G1-C2: milestone and priority tag corrections
- **Decision:** REQ-UI-014, REQ-UI-018 and REQ-AUTH-020 retagged **M0 → M1** (their only stories US-109, US-111, US-026 are M1; PRD §6.1 uses the quote API, not the widget UI). REQ-PICK-013 (drop-off confirmation and DROPPED_OFF transition) retagged **Must → Should** and US-239 follows (Must → Should): drop-off is Should per D-014, REQ-PICK-013 is unreachable without the Should list (REQ-PICK-010), and the PRD §6.2 demo uses courier pickup. REQ-DATA-014, REQ-SEC-008 and REQ-QUOTE-004 keep their M1 tag and are recorded in traceability.md as delivered early by M0 stories US-052, US-046 and US-156. Counts: REQs 317 Must / 94 Should / 19 Could, 204 M0 / 226 M1; stories 214 Must / 68 Should / 8 Could, 119 M0 / 171 M1.
- **Why:** An M0 REQ with only M1 stories would fail an R0 completeness check for no product reason; a Must that depends on a Should is not a Must.
- **Alternatives:** Add M0 stories for the three REQs (adds M0 scope with no demo value); split the drop-off confirmation page from the DROPPED_OFF event handling (two tiny stories for a Should feature).
- **Reversibility:** High.

### D-037 · 2026-11-12 · product-manager · G1-C5: demo-critical (DC) tag and re-scope ladder
- **Decision:** Every Must story that the PRD §6.1 or §6.2 demo script strictly needs carries `DC` in a new **DC** column of its epic story-summary table and of `traceability.md` "Story → Requirement". A story is DC only if a demo step or assertion cannot execute without it; cross-cutting Must obligations that the scripts do not assert (negative controls, hardening, generators' non-demo coverage, non-demo screens) are Must but not DC. Result: **134 DC stories (74 M0, 60 M1)** out of 214 Must. The re-scope order for the CLAUDE.md §7 escalation ladder is fixed in PRD §7.1: defer Could → defer Should → defer non-DC Must (becomes a tracked Should in the backlog with the gate condition it weakens) → split a DC Must into a smaller DC Must plus a Should; a DC story is never deferred, because deferring it means the release cannot demonstrate its milestone. P4 waves by DC first (senior-developer, qa-lead).
- **Why:** F5: 215 Must stories (~940 dev-day upper bound) with no agreed fallback. The DC subset gives P4 a critical path and the ladder a pre-agreed order so re-scoping never has to be invented under pressure.
- **Alternatives:** Lower the Must count by retagging cross-cutting obligations to Should (contradicts the brief's per-feature RBAC/audit/RLS/i18n/a11y rules and D-029); tag at epic level only (too coarse to wave by).
- **Reversibility:** High (a column and a PRD subsection; the tag can be moved per story with a logged decision).

### D-UX-001 · 2026-11-12 · ux-designer · System font stack, no web fonts
- **Decision:** Typography uses the platform system font stack (sans and mono). No web-font files are shipped.
- **Why:** LCP ≤ 2.5 s and the 170 kB budget on public pages; no font licensing; full Latin coverage for en, es and fr; native rendering at 14 px base size.
- **Alternatives:** An open-licence web font such as Inter (OFL), rejected because of the download cost and FOIT/FOUT layout-shift risk on mobile.
- **Reversibility:** High (one token change).

### D-UX-002 · 2026-11-12 · ux-designer · Neutral placeholder palette; DTCG tokens.json as source; contrast-gated tenant overrides
- **Decision:** A slate + blue placeholder palette with semantic light and dark themes in `docs/02-ux/design-system/tokens.json` (W3C DTCG format), which `packages/ui` compiles to CSS variables and a Tailwind preset. Tenants can override only the primary, link, focus and selected tokens. Every override must pass the same contrast-pair test as the defaults; a failing pair rejects that override for that theme.
- **Why:** Brief §8 (themable, light and dark, contrast-checked) and US-101/US-102. White-labelling is LATER, but a bad override must never break accessibility.
- **Alternatives:** Free-form theming (unsafe); no tenant seam (contradicts brief §1 BRAND_* config).
- **Reversibility:** High.

### D-UX-003 · 2026-11-12 · ux-designer · Breakpoints map to Tailwind screens xs 360, md 768, lg 1024, xl 1280, 2xl 1536
- **Decision:** The Tailwind preset replaces the default screens; the 640 px `sm` breakpoint is removed. Tables switch to card lists below 768 px. Fixed admin sidebar, wizard columns and the account side nav start at 1024 px.
- **Why:** Brief §8 lists exactly these breakpoints; an extra 640 breakpoint invites untested layouts.
- **Reversibility:** High.

### D-UX-004 · 2026-11-12 · ux-designer · Root font size untouched; 16 px input text on coarse pointers
- **Decision:** `html { font-size: 100% }`. Base UI text is 0.875rem (14 px). Inputs render at 16 px under `pointer: coarse` and 14 px under `pointer: fine`.
- **Why:** Respects user font settings (WCAG 1.4.4). Prevents iOS Safari auto-zoom on focus, which breaks the sticky-bar layout.
- **Reversibility:** High.

### D-UX-005 · 2026-11-12 · ux-designer · URL strategy: locale-prefixed pre-rendered pages, unprefixed app routes
- **Decision:** Pre-rendered public pages live under `/{lng}/…` (en, es, fr) with hreflang. `/` redirects by cookie, then Accept-Language, then en. Client-rendered app routes (`/quote`, `/book`, `/checkout`, `/orders`, `/account`, `/sign-in`) are unprefixed and use the profile, cookie or header locale. Filters, sort and cursor live in the query string.
- **Why:** US-112 needs per-locale static HTML. Story examples use unprefixed app paths. Stable authenticated URLs survive language changes.
- **Alternatives:** Prefix everything (duplicates SPA routes, return-URL complexity); no prefix anywhere (cannot pre-render per locale).
- **Reversibility:** Medium (URLs become bookmarked once released).

### D-UX-006 · 2026-11-12 · ux-designer · Wizard layout and step routes
- **Decision:** Mobile shows one step per screen with a "Step n of 7" progress bar and a sticky bottom bar (total, price-details bottom sheet, primary action). From 1024 px: vertical stepper, current step plus collapsed summaries of completed steps, and a sticky 360 px price summary. Step slugs: `addresses`, `contents`, `collection`, `extras`, `review`, plus `service` (choose the service again after a rate-relevant change). Payment and confirmation are separate routes shown in the same stepper. When US-190 (Extras, Should) is not built, the stepper shows 6 steps rather than a placeholder.
- **Why:** US-174 and brief §5/§8 (one step per screen on mobile, sticky summary, step indicator); no silent stubs.
- **Reversibility:** High.

### D-UX-007 · 2026-11-12 · ux-designer · Booking progress lives on the confirmation route
- **Decision:** `/orders/{id}/confirmation` opens in a progress state (saga step list from the stream, polling fallback) and turns into the confirmation in place. Failure, ambiguous-outcome and partial variants render on the same page.
- **Why:** One URL works for reload, email links and shipment-detail links (US-195 "reachable later"); no duplicate pages.
- **Reversibility:** High.

### D-UX-008 · 2026-11-12 · ux-designer · Streaming results never move the user's focus
- **Decision:** Results insert in sort order until the user's focus or pointer is inside the list. From then on, new results queue behind a "Show N new results" button and the focused card keeps its position. Badges show "so far" until the stream completes or 5 s pass.
- **Why:** US-161 (focus keeps on-screen position), WCAG 3.2.2, CLS ≤ 0.1 while streaming (NFR-WEB-003).
- **Reversibility:** High.

### D-UX-009 · 2026-11-12 · ux-designer · Email-link tokens in the URL fragment (recommendation to principal-architect)
- **Decision:** Verification, reset and invitation links carry the token as `#token=…`. The page reads it, posts it, then clears it with `history.replaceState`.
- **Why:** Fragments are not sent to servers, proxies or logs and do not leak via Referer; this supports the brief §4.11/ASVS requirement to keep secrets out of logs.
- **Alternatives:** Query parameter with `Referrer-Policy: no-referrer` (still lands in access logs).
- **Reversibility:** High until emails ship. The final link format is principal-architect's decision.

### D-UX-010 · 2026-11-12 · ux-designer · Live-region policy
- **Decision:** One app-level announcer (polite and assertive). Streaming results are throttled to one message per 2 s, and list counts are debounced. Booking steps are polite, and only a booking failure is assertive. Countdowns are never announced per tick. Toasts use status/alert roles.
- **Why:** WCAG 4.1.3 without screen-reader chatter; US-160 and US-207 require announcements.
- **Reversibility:** High.

### D-UX-011 · 2026-11-12 · ux-designer · Guest quote token: UX requirement, mechanism deferred to principal-architect
- **Decision:** The guest quote token must survive a reload and the sign-in or register detour in the same browser, and must never appear in a URL. The mechanism (for example a path-scoped HttpOnly cookie or tab-scoped storage) is principal-architect's choice.
- **Why:** US-155 (token never in URLs or referrers), US-171 (the selected option survives registration).
- **Reversibility:** High.

### D-UX-012 · 2026-11-12 · ux-designer · Static skeletons, no shimmer
- **Decision:** Skeletons are static blocks shown after 150 ms.
- **Why:** Avoids a long-running animation that conflicts with the 120–180 ms transition lint (US-103) and with reduced-motion; simpler to test.
- **Reversibility:** High.

### D-UX-013 · 2026-11-12 · ux-designer · Form conventions: "(optional)" labels and the error-summary pattern
- **Decision:** Required is the default and optional fields are labelled "(optional)". On a failed submit of a form with 2 or more errors, an error summary with field links appears above the form and focus moves to the first invalid field. Business-blocked actions use `aria-disabled` with a linked reason, not silent `disabled`.
- **Why:** US-106; WCAG 3.3.1/3.3.3; asterisk-only marking is ambiguous for screen-reader users and across locales.
- **Reversibility:** High.

### D-UX-014 · 2026-11-12 · ux-designer · Customs values use one currency chosen per shipment
- **Decision:** Step 2 asks once for "Currency of item values"; lines have no per-line currency control.
- **Why:** Makes `CUSTOMS_CURRENCY_MIXED` unreachable from the UI (US-181) and removes a confusing repeated control. The API still validates.
- **Reversibility:** High.

### D-UX-015 · 2026-11-12 · ux-designer · Rate-relevant edits in the wizard route through "Choose your service again"
- **Decision:** In step 1 the countries are fixed by the quote. Editing a postcode, residential flag or package (from Review) creates a new quote (US-168) and sends the user to `/book/{id}/service` with streamed results, the old price for reference, the price difference, and nothing auto-selected when the service has gone.
- **Why:** US-167/US-168: the price never changes silently, and the user must re-confirm.
- **Reversibility:** High.

### D-UX-016 · 2026-11-12 · ux-designer · No new UI libraries; CSS transitions; in-house SVG icon set
- **Decision:** Components use only Tailwind, Radix primitives, TanStack Table, RHF/Zod and react-i18next. The sanctioned "motion library" (brief §3.2) is not adopted: CSS transitions meet the 120–180 ms micro-interaction need. Icons are an original in-house SVG set in `packages/ui`.
- **Why:** P2 constraint, bundle budgets, licence hygiene.
- **Reversibility:** High (a motion library can be added by ADR).

### D-UX-017 · 2026-11-12 · ux-designer · In-house ARIA Combobox and date-grid Calendar in packages/ui
- **Decision:** Build the WAI-ARIA 1.2 combobox (positioned with Radix Popover) and the date-grid calendar in `packages/ui`, because Radix provides neither.
- **Why:** Country (about 250 items), HS-code search and the pickup calendar need them; the no-new-library constraint.
- **Alternatives:** A third-party combobox or date picker (new dependency, ADR needed).
- **Reversibility:** Medium.

### D-UX-018 · 2026-11-12 · ux-designer · No third-party imagery: carrier monograms, no flags, operator-supplied logos only
- **Decision:** Carriers are shown by name plus a monogram chip. Logo images render only from operator-configured asset URLs per carrier, and the repository ships none. Country selectors show names, not flags. Illustrations are text descriptions only.
- **Why:** Carrier logos are trademarks; P2 constraint "no copyrighted imagery"; flags are not languages or countries for every user.
- **Reversibility:** High.

### D-UX-019 · 2026-11-12 · ux-designer · Document shipments default to the seeded envelope size
- **Decision:** With content type Document, the widget hides the dimensions behind "Edit size", prefilled from a seeded envelope size; weight is still required.
- **Why:** Faster quotes for documents; dimension limits (US-156) still apply.
- **Reversibility:** High (seed value).

### D-UX-020 · 2026-11-12 · ux-designer · Environment chip in non-production; "Test mode" badge on checkout and confirmation
- **Decision:** Non-production builds of both apps show a "Test environment" chip in the header. Checkout, confirmation and the booking email show "Test mode" (text plus icon) whenever the gateway is Mock or Stripe test.
- **Why:** US-214 (visible, not colour-only); demos run on Mock carriers and must not be mistaken for live.
- **Reversibility:** High.

### D-UX-021 · 2026-11-12 · ux-designer · Decimal inputs are text with inputmode=decimal, not type=number
- **Decision:** Weights, dimensions and money use a DecimalField that accepts the locale decimal separator and ".".
- **Why:** `type=number` has inconsistent locale parsing (es and fr commas), scroll-wheel value changes and poor screen-reader output.
- **Reversibility:** High.

### D-UX-022 · 2026-11-12 · ux-designer · No command palette, global search or shortcuts in the D-008 admin slice
- **Decision:** The brief §8 admin command palette (Ctrl/Cmd+K), global search and keyboard shortcuts are deferred to M2. No placeholder is rendered.
- **Why:** With only two admin destinations, they add no value; brief §13 rule 5 forbids silent stubs.
- **Reversibility:** High.

### D-UX-023 · 2026-11-12 · ux-designer · Audit viewer: detail route is canonical; side-panel preview at xl is optional; filters apply on submit
- **Decision:** Rows link to `/audit/entries/{id}`. At ≥ 1280 px an optional "Preview" side panel (Should) may be added. Filters apply with an "Apply filters" button.
- **Why:** Deep links (US-032); fewer audit VIEW entries and screen-reader interruptions than apply-on-change.
- **Reversibility:** High.

### D-UX-024 · 2026-11-12 · ux-designer · Email verification: non-blocking banner, cross-tab detection, re-check action
- **Decision:** Unverified users see a banner in the account area and at Review. Checkout shows a blocking panel with Resend and "I've verified, check again". Successful verification in another tab of the same browser notifies waiting tabs through a same-origin BroadcastChannel (no token in the message).
- **Why:** D-009 friction is the main conversion risk (R-07); the user should not have to reload or re-enter anything.
- **Reversibility:** High.

### D-UX-025 · 2026-11-12 · ux-designer · Session time limits and WCAG 2.2.1
- **Decision:** The staff absolute session cap (US-033, Should) shows a non-modal warning 5 minutes before the end, offering "Sign in again now" and preserving URL state. Other limits (MFA challenge, enrolment, links) are restartable at no cost. Quote validity and cut-offs are real-time events shown as absolute times.
- **Why:** WCAG 2.2.1 compliance without weakening the security caps.
- **Reversibility:** High.

### D-UX-026 · 2026-11-12 · ux-designer · Accessible authentication: single OTP field, paste allowed, no CAPTCHA, no confirm-password
- **Decision:** One-time codes use a single input with `autocomplete="one-time-code"` (no split boxes). Paste and password managers are allowed everywhere. Show/hide replaces confirm-password fields. No CAPTCHA (rate limits and lockout are the abuse control).
- **Why:** WCAG 3.3.8 and 3.3.7 (NFR-A11Y-001).
- **Reversibility:** High.

### D-UX-027 · 2026-11-12 · ux-designer · Drop-off map not rendered
- **Decision:** The drop-off option is a list only. No map container or placeholder is rendered until US-240 (Could) has an approved zero-cost tile source.
- **Why:** D-014, CLOUD_BUDGET 0, no silent stubs.
- **Reversibility:** High.

### D-UX-028 · 2026-11-12 · ux-designer · i18n conventions: namespaces, semantic keys, ICU, formatting locale, grouping
- **Decision:** Namespaced JSON per locale. Keys are `ns:area.element[.variant]`, with error and enum codes used verbatim. ICU MessageFormat for plurals and selects, including the es/fr `many` form. Values are pre-formatted by shared Intl helpers and passed as placeholders; no translated string is used as a placeholder in another. The formatting locale is language plus region (profile country, else browser, else en-US/es-ES/fr-FR). Number helpers use `useGrouping: 'always'` so Spanish 4-digit numbers group ("1.234,50") as US-116 expects. es uses "tú" and fr uses "vous".
- **Why:** US-115, US-116, NFR-I18N-001..004. CLDR's Spanish minimum-grouping rule would otherwise fail the US-116 example.
- **Alternatives:** i18next native plural suffixes (fallback if the ICU plugin is not approved by ADR).
- **Reversibility:** Medium (key renames are mechanical but wide).

### D-UX-029 · 2026-11-12 · ux-designer · Public tracking uses a query parameter on one pre-rendered shell
- **Decision:** `/{lng}/track?number=…` with a client-side fetch. The URL updates with `replaceState` after a lookup. Responses that carry `number` must send `X-Robots-Tag: noindex`.
- **Why:** One static shell per locale (US-112, US-247); shareable result links from emails and confirmation.
- **Reversibility:** High.

### D-ARCH-001 · 2026-11-12 · principal-architect · Runtime baseline Node 24 LTS (Node 20 is EOL)
- **Decision:** All apps, images and CI run on Node 24 LTS (`.node-version`, `engines >=24 <25`, `node:24-trixie-slim` by digest). Node 26 is evaluated at M5.
- **Why:** Node 20 reached end-of-life on 2026-04-30 (nodejs/Release schedule, checked 2026-11-12); sanctioned `opossum` 10 requires Node ≥ 22; CLAUDE.md §5 requires maintained dependencies. The brief says "current LTS"; the host's Node 20 install is a developer-environment fact, not a requirement.
- **Alternatives:** stay on Node 20 (rejected: EOL, blocked libraries); Node 26 now (deferred: two weeks into LTS, ecosystem lag).
- **Consequence:** the Windows dev host must install Node 24 (fnm/nvm-windows); CLAUDE.md §2 "Dev environment" line should be updated by the orchestrator.
- **Reversibility:** High (base image + `.node-version`).

### D-ARCH-002 · 2026-11-12 · principal-architect · TypeScript 6.0.x now, TypeScript 7 (native compiler) later; Jest via @swc/jest
- **Decision:** Pin `typescript ~6.0.3`; use `@swc/jest` for Jest transforms and `tsc -b --noEmit` for type-checking; adopt TypeScript 7 when `typescript-eslint`, Jest tooling and Prisma declare support (Wave-0 spike SPK-01 re-checks).
- **Why:** `typescript@latest` is 7.0.2 (Go-native) while `ts-jest` 29.4.15 declares `typescript <7`; a transform that does not depend on the compiler version removes the coupling.
- **Reversibility:** High.

### D-ARCH-003 · 2026-11-12 · principal-architect · Licence policy interpretation and equivalences (to be confirmed by dependency-auditor/security-analyst)
- **Decision:** (1) LICENSE_ALLOWLIST governs code dependencies shipped or linked with the product; CI/dev **tools** run as containers or actions (Terraform BUSL-1.1, k6 AGPL-3.0, Semgrep LGPL/Commons Clause, Checkov Apache-2.0, ZAP Apache-2.0, Mailpit MIT, RustFS Apache-2.0, Valkey BSD-3) are admissible when OSI/FSF-recognised or source-available with a licence permitting our use; HCL is kept OpenTofu-compatible as a fallback. (2) Licences at least as permissive as MIT are accepted as equivalents: MIT-0 (`nodemailer`), 0BSD, BlueOak-1.0.0, Python-2.0 (transitives), CC0-1.0 (`stylelint-use-logical`), OFL-1.1 for embedded fonts (Noto Sans). (3) Rejected for licence: `ua-parser-js` 2.x (AGPL-3.0) → `bowser`; `redis:7.4`/Redis 8 images (RSALv2/SSPL/AGPL) → Valkey 8 (D-ARCH-005). (4) Rejected for staleness (> 18 months): `cookie-parser` (2024-10) → `cookie` 2.x; `jest-openapi`/`swagger-ui-express` → Ajv-based validator and `swagger-ui-dist`.
- **Why:** CLAUDE.md §5 dependency guardrail; D-002 note on transitive licences.
- **Reversibility:** High.

### D-ARCH-004 · 2026-11-12 · principal-architect · Resilience defaults follow DR-B32/REQ-CARR-017; NFR-RES-001..003 to be aligned
- **Decision:** Carrier timeouts rates 4 s / tracking 10 s / cancel 10 s / pickup 15 s / create 20 s; retries max 2 (base 200 ms, ×2, full jitter) on idempotent operations only; breaker opens at 50 % failures over the last 20 calls (min 10) or 5 consecutive failures, half-open after 30 s; bulkhead 10 concurrent calls per carrier account. All are configuration keys.
- **Why:** REQ-CARR-017/DR-B32 (functional, testable) and NFR-RES-001..003 (tracking 8 s, 3 retries, 10 s window, bulkhead 20) disagree; one value set is needed for tests. The functional requirement is the more specific source.
- **Action:** product-manager aligns NFR-RES-001..003 wording (or supersedes this decision). Alternatives: adopt NFR values (rejected: would contradict a Must REQ).
- **Reversibility:** High (configuration).

### D-ARCH-005 · 2026-11-12 · principal-architect · Valkey 8 as the Redis-compatible store (local, CI, ElastiCache for Valkey)
- **Decision:** Run BullMQ, rate limits and caches on Valkey 8 (BSD-3-Clause) via `ioredis`; ElastiCache for Valkey in AWS; `maxmemory-policy noeviction`. Fallback: `redis:7.2.x` (last BSD line).
- **Why:** The `redis:7` Docker tag is now the 7.4 line under RSALv2/SSPL and Redis 8 adds AGPL — none on LICENSE_ALLOWLIST (platform.md OI-01); Valkey is protocol-compatible so the brief's "BullMQ + Redis" architecture is unchanged. BullMQ/ioredis compatibility is verified in SPK-01.
- **Reversibility:** High (image/endpoint swap).

### D-ARCH-006 · 2026-11-12 · principal-architect · Security-driven amendments needing requirement wording updates (for product-manager)
- **Decision (applied in ADRs; recommended defaults):** (a) refresh cookies use the `__Host-` prefix with `Path=/`, read only by the auth routes (REQ-AUTH-006 "scoped to the auth path" → "read only by the auth routes"); (b) MFA failure lock is per **user** across challenges (DR-A02 says per challenge; per-user is stricter); (c) demo-seed default passwords are refused whenever `APP_ENV ≠ local`, not only in production (REQ-DATA-002); (d) a coarse per-IP rate limiter runs **before** authentication in addition to the DR-A08 per-user limiter after authorisation (DR-A08 order to be amended); (e) one-time tokens never travel in URL paths/queries: `POST /invitations/accept {token}` replaces `/invitations/{token}/accept`, shared quotes resolve via `POST /public/shared-quotes/resolve`, postcode-based tracking lookups are `POST /public/tracking/lookup`; e-mail links carry tokens in the URL fragment; (f) the 30-day customer refresh lifetime (D-024) deviates from ASVS 4.0.3 V3.3.2 L2 (12 h / 30 min idle) — kept for consumer UX with re-authentication on sensitive actions and recorded as an accepted deviation in the ASVS checklist, unless product-manager shortens it; admin sessions get a 30-minute idle timeout; (g) D-025 and REQ/NFR wording "MinIO" → "S3-compatible object storage (RustFS locally)" because MinIO's community edition is archived (ADR-0021).
- **Why:** threat-model.md R-06, R-07, R-13, R-14, R-26, T-23; platform.md OI-05.
- **Reversibility:** High.

### D-ARCH-007 · 2026-11-12 · principal-architect · Audit privacy-erasure mechanism = tokenised identifiers with an encrypted vault (closes A-045); chain scope = per stream (org / sharded SYSTEM) with nightly signed checkpoint (closes A-043); guest-row RLS pattern confirmed (closes A-055)
- **Decision:** See ADR-0007 and ADR-0005. Key reason for tokenisation over key shredding: closed audit partitions are exported to S3 Object Lock (compliance mode) at M5 and must contain no personal data; vault rows are hard-deleted on erasure while the chain hashes tokens only.
- **Reversibility:** Low once production data exists; high during this run.

### D-ARCH-008 · 2026-11-12 · principal-architect · Service-point map not built in M1 (D-014 Could); list only
- **Decision:** No map tiles in M1; `ServicePointMap` provider seam with a `NullMapProvider`. **Why:** no zero-cost tile source satisfies its usage policy without an API key under CLOUD_BUDGET = 0 (OSM tile policy; MapTiler/Stadia need keys). Aligns with D-UX-027. **Reversibility:** High.

### D-ARCH-009 · 2026-11-12 · principal-architect · CI capacity on a private repository (high-impact; orchestrator to raise with the human — platform.md OI-04)
- **Default applied:** self-hosted `heavy` runner on the dev host for integration/e2e jobs plus a hosted-runner PR fast lane (lint, typecheck, unit, contract), full matrices on `main` and nightly; soak tests weekly.
- **Why:** `sukhchdit/shipcube` is private; GitHub Free ≈ 2 000 Linux minutes/month on 2-vCPU runners versus an estimated ≈ 22 000 min/month in P5. **Alternatives:** make the repository public; approve an Actions spend of ≈ $100–150/month; PR fast lane only. **Impact if wrong:** P5 stalls when minutes run out. **Reversibility:** High.

### D-ORCH-001 · 2026-11-12 · human (Q-007) · CI capacity: hosted fast lane + local heavy suites (supersedes the D-ARCH-009 default)
- **Decision:** GitHub-hosted Actions runs the PR fast lane (install, lint, format, typecheck, unit + coverage, build, Gitleaks, dependency audit, Semgrep) on every PR. Heavy suites (integration/Testcontainers, API + RBAC/audit/RLS generated suites, Playwright e2e on 3 browsers, k6, ZAP, Trivy image scans) run locally on Docker Desktop via test-runner, with evidence (summaries, JUnit/coverage reports) committed under `docs/05-quality/`. The full hosted workflow runs on `main` (`workflow_dispatch` + push to main, path-filtered) at wave ends and before G3/G4, within the free-tier minutes. No self-hosted runner, no paid minutes, repo stays private.
- **Why:** $0 budget, nothing installed on the host, and the repo stays private.
- **Consequence:** principal-architect amends ADR-0023 and platform.md OI-04 to match. The merge-to-main DoD's "passing CI" = green fast lane on the PR + local heavy-suite evidence for the change.
- **Reversibility:** High (switching to a self-hosted runner later only changes a workflow label).

### D-ORCH-002 · 2026-11-12 · human (Q-006) + orchestrator · Node 24 via fnm, per-command PATH
- **Decision:** fnm 1.39.0 (winget, user scope) installed Node v24.22.3, set as the fnm default. The auto-mode safety classifier denied persisting it to the shell profile / user PATH, so the project convention is: every Bash command running node/npm/npx starts with `export PATH="$APPDATA/fnm/aliases/default:$PATH";` (written to CLAUDE.md §2). Containers and CI use node:24. ADR-0001 stands unchanged.
- **Reversibility:** High. The human can add the fnm dir to their PATH at any time, which makes the prefix a no-op.

### D-ARCH-010 · 2026-11-12 · principal-architect · CI lane model, evidence layout and merge DoD implementing D-ORCH-001 (ADR-0023 amendment)
- **Decision:** (1) **Lane A** — hosted PR fast lane on non-draft PRs: one `fast-lane` job (lint, format, commitlint, actionlint, hadolint, typecheck, unit + coverage, build + size-limit, Gitleaks diff, `npm audit` + osv, Semgrep, licence/age, contract drift, `quality:check-evidence`), `iac` only when `infra/**` changed, incremental (`jest --changedSince`, ESLint cache, `tsc -b`) with a **diff-coverage gate** (changed files ≥ 85/75, 95 on pricing/audit/authz); ≈ 8 job-min. (2) **Lane B** — local heavy lane run by test-runner (`npm run quality:heavy -- --profile pr|wave|gate`): integration, API + generated suites, Playwright (Chromium on `pr`; 3 browsers on `wave`/`gate`), k6, ZAP, Trivy, Lighthouse, Stryker/restore/valkey-compat on `gate`; evidence written as machine-generated JUnit/JSON under `docs/05-quality/{tests,security,performance}/runs/<UTCstamp>_<sha7>/` with a `summary.json` (SHA, timestamp, host spec, per-report SHA-256, verdict), 5 MB cap, no HTML/traces. (3) **Lane C** — hosted full lane on `workflow_dispatch` only (`wave-end` / `release-candidate`): fast lane non-incremental + integration + images (push `sha-*`) + e2e sharded per browser + iac; dispatched at every wave end, before G3, before G4 and per release candidate. (4) `push` to `main` re-runs the fast lane only when `CI_MAIN_FAST_LANE=true` (default `false`); `nightly.yml` has no schedule; no merge queue. (5) **"Passing CI" for the merge DoD** = lane A green on the PR head **and** lane B evidence `PASS` for the suites selected by the changed paths (table in ADR-0023 amendment C, enforced by `quality:check-evidence`) **and** D-004 reviews; wave ends and gates additionally need a green lane C run on the same SHA. (6) Budget ≈ 1,830 hosted min/month (≈ 92 % of ≈ 2,000) with guards at 70/90/100 % and a documented degraded mode. (7) Self-hosted runner kept only as the `HEAVY_RUNNER_LABELS` label switch.
- **Why:** D-ORCH-001 ($0, private repo, nothing extra on the host). Merge-triggered full runs (≈ 85 min × ≈ 100 merges) would alone exceed the allowance, so "push to main, path-filtered" is read as the fast lane re-run and the heavy jobs run on dispatch. Diff coverage on PRs is what makes an 8-minute incremental fast lane possible; whole-repository thresholds are kept in lanes B and C.
- **Alternatives:** full hosted matrix on every PR (≈ 22,000 min, rejected by the human); self-hosted runner (rejected by the human; kept as a switch); merge queue (doubles per-merge minutes); whole-repository coverage on every PR (forces non-incremental ≈ 14 min runs, ≈ 2,800 min/month alone).
- **Reversibility:** High. Lane membership is workflow conditions and two repository variables; evidence files are additive.

### D-ARCH-011 · 2026-11-12 · principal-architect · E-mail link format `#token=`, link origin by account affinity, registration issues no session (UX §5 items 1, 3, 7)
- **Decision:** Links are `<origin>/verify-email#token=<base64url>`, `/reset-password#token=…`, `/invitations/accept#token=…` (and `/q#token=…` for US-165); the SPA posts the token in a body and clears the fragment; no other link parameter. Origin = `ADMIN_APP_ORIGIN` for users with an ACTIVE OPERATOR membership, else `WEB_APP_ORIGIN`, independent of the requesting app. `registerUser` stays 202 with no session (EC-A01); the web app signs in immediately client-side with the in-memory credentials and falls back to the sign-in panel with the same `returnUrl` on `INVALID_CREDENTIALS`.
- **Why:** D-UX-009/D-UX-005 (fragment, unprefixed app routes) and ADR-0016 amendment 2 had different parameter names and path shapes; one format is needed for templates, routes and tests. Issuing a session from `registerUser` would break the identical-202 anti-enumeration property. A wrong-origin staff link would fail on the `__Host-` cookie model and confuse staff.
- **Alternatives:** `#t=` (shorter, but the UX docs already use `#token=`); `client_app` on `requestPasswordReset` (lets the requester choose the origin — rejected, the server knows the account type); 201 + tokens on register (rejected, enumeration).
- **Reversibility:** High before the first e-mail template ships; medium after (links in sent e-mails).

### D-ARCH-012 · 2026-11-12 · principal-architect · Guest quote token persisted in `localStorage` with TTL (UX §5 item 2)
- **Decision:** `qt:<quoteId>` → `{token, expires_at}`; deleted on claim, expiry, sign-out or 404; never in URLs; header `X-Quote-Token` unchanged.
- **Why:** D-UX-011 (survive reload and the register/sign-in detour, never in a URL). `sessionStorage` loses the token on tab close / new tab within the 24 h validity; an HttpOnly cookie would change the contract and CSRF model for a low-value, short-lived credential that reads one unclaimed quote without personal names. CSP is the XSS control.
- **Alternatives:** HttpOnly path-scoped cookie (recorded in ADR-0026 amendment 1 for a future revisit if guest quotes ever carry more data).
- **Reversibility:** High (client-only).

### D-ARCH-013 · 2026-11-12 · principal-architect · TOTP QR rendered client-side with `uqr` (UX §5 item 4)
- **Decision:** `uqr` 0.1.3 (MIT, zero dependencies, released 2026-04-03) encodes the `provisioning_uri`; `packages/ui` renders a React SVG (`role="img"`, fixed dark-on-light, ≥ 200 px); no `dangerouslySetInnerHTML`; API contract unchanged.
- **Why:** The client already holds the URI; a server image endpoint would be a second place the secret appears. `qrcode` 1.5.4 rejected: last release 2024-08-05 (> 18 months, CLAUDE.md §5) and heavy transitive deps.
- **Reversibility:** High.

### D-ARCH-014 · 2026-11-12 · principal-architect · ICU MessageFormat via `i18next-icu` + `intl-messageformat` (UX §5 item 5)
- **Decision:** Adopt `i18next-icu` 2.7.0 (MIT, 2026-11-05) with `intl-messageformat` 12.1.5 (BSD-3-Clause, 2026-11-08) and `@formatjs/icu-messageformat-parser` 3.5.23 (MIT) for plurals and selects; values pre-formatted by `packages/shared/format`; ICU runtime (≈ 15–20 kB gzipped expected) counted inside the 170 kB public-page budget and measured in Wave 0; fallback = native i18next suffix plurals for **all** strings if the budget is breached.
- **Why:** D-UX-028 specifies ICU syntax incl. the es/fr `many` form; licences and maintenance pass CLAUDE.md §5; i18next remains the sanctioned library.
- **Alternatives:** native suffix plurals now (loses translator-standard syntax; kept as fallback); FormatJS end to end (not sanctioned).
- **Reversibility:** Medium (message syntax across three locale files; mechanical conversion).

### D-ARCH-015 · 2026-11-12 · principal-architect · Root `/` locale redirect by Nginx, `/` not pre-rendered, `noindex` headers (UX §5 item 6)
- **Decision:** Nginx in the `web` image returns 302 to `/{lng}/` from cookie `lng` → first supported `Accept-Language` → `en`, with `Cache-Control: no-store` and `Vary: Cookie, Accept-Language`; `/` leaves the prerender list, so the SPA fallback is `index.html`; locale cookie `lng` (`Path=/`, 1 y, `SameSite=Lax`, `Secure`). `X-Robots-Tag: noindex` on `/{lng}/track` when `number` is present (Nginx `map`), on every admin-app response (+ `robots.txt` disallow) and on every API response.
- **Why:** IA §1 requires the redirect to work without JavaScript and left the mechanism to the architect; the same Nginx image runs locally and behind CloudFront (PD-01), so one implementation serves both; `CachingDisabled` for HTML keeps per-user redirects out of the edge cache. A JS-only locale page (ADR-0026 §2 original) fails the no-JS requirement.
- **Alternatives:** CloudFront Function redirect (AWS-only, breaks local parity); pre-rendered `/` with `<noscript>` links (adds a page nobody sees when Nginx redirects — a silent stub).
- **Reversibility:** High.

### D-ARCH-016 · 2026-11-12 · principal-architect · P2 → P3 reconciliations: carrier logo seam, `useGrouping: 'always'`, motion not adopted (UX §5 items 10, 11; D-UX-016)
- **Decision:** `carriers.logo_asset_key` resolves to same-origin `/brand/carriers/<key>.svg` from an operator-mounted directory; reserved `monogram` / 404 → monogram chip; CSP unchanged; M1 seed = `monogram`. Shared number/money formatters use `useGrouping: 'always'` on frontends and worker. ADR-0025 now records `motion` as sanctioned but not adopted (D-UX-016).
- **Why:** D-UX-018 forbids third-party imagery and the CSP forbids third-party image hosts, so logos must be operator-supplied and same-origin; US-116's "1.234,50" needs the explicit grouping option; ADR-0025 contradicted D-UX-016.
- **Reversibility:** High.

### D-038 · 2026-11-12 · product-manager · Accepted ASVS 4.0.3 V3.3.2 deviation: 30-day customer refresh token kept, compensated
- **Decision:** The customer app keeps the D-024 30-day rotating refresh token (90-day absolute cap) although ASVS 4.0.3 V3.3.2 L2 asks for re-authentication after 12 h or 30 min idle. Compensating controls, all already required: rotation with family revocation on reuse (REQ-AUTH-007/008), server-side revocation within 5 s (REQ-AUTH-009), `__Host-` cookie read only by the auth routes (REQ-AUTH-006), CSRF on cookie routes (REQ-SEC-004), and mandatory re-authentication proofs for every sensitive action (password change, TOTP disable, recovery-code regeneration, privacy delete, payment-method changes; REQ-AUTH-020, `x-reauth-scope`). The admin app does not deviate: 12 h absolute cap (REQ-ADMIN-004) plus a 30-minute idle timeout (ADR-0006 amendment 5). security-analyst records the item as "Deviation accepted, compensated" in the ASVS checklist (NFR-SEC-001, A-034).
- **Why:** A consumer shipping customer books a few times a year; forcing sign-in on every return visit is the main abandonment driver on the home → quote → book funnel (PRD R-07 already carries the verification-friction risk). Every attack the ASVS control mitigates (stolen cookie, forgotten shared device) is covered by rotation/reuse detection and by re-auth on the actions that could cause harm. Staff hold cross-tenant access, so they get the strict profile.
- **Alternatives:** Shorten to 12 h (rejected: UX cost without a matching risk reduction given the compensations); 7 days as a midpoint (rejected: still a deviation, so it buys nothing at the checklist while costing weekly re-logins).
- **Reversibility:** High (`AUTH_REFRESH_TTL` configuration key; one NFR-SEC-004 test re-thresholded). Logged as A-086.

### D-039 · 2026-11-12 · product-manager · Object storage wording: "S3-compatible object storage (RustFS locally)" supersedes "MinIO" in D-025
- **Decision:** Wherever D-025 and derived requirement text say "MinIO", read "S3-compatible object storage, RustFS in Compose and Testcontainers, S3 in AWS" (ADR-0021). D-025's substance (SHA-256, versioning, pre-signed 300 s downloads after permission check and audit, no uploads in M1) is unchanged. Updated: REQ-DOC-006 note, US-220 note, NFR-REC-003, NFR-OPS-001, NFR-AUDIT-007 (both rows). D-025 itself is not edited.
- **Why:** MinIO's community edition is archived (no images since 2025-10), which fails the CLAUDE.md §5 maintained-dependency guardrail; principal-architect selected RustFS (Apache-2.0, 1.0 GA 2026-09) with SeaweedFS as fallback (D-ARCH-006 (g), ADR-0021).
- **Reversibility:** High (one Compose service and one Testcontainers image behind the `ObjectStorage` port). Spike SPK-05 validates pre-signed URLs, versioning, path-style access and HEAD metadata (A-084).

### D-040 · 2026-11-12 · product-manager · REQ-NOTIF-012 vs NFR-PRIV-004: the notification log stores a masked recipient address and redacted identifiers, never a clear-text address or body
- **Decision:** REQ-NOTIF-012 now says "recipient user ID and the recipient email address in masked form (`a***@domain`) as at send time"; NFR-PRIV-004 now lists the same columns (template key/version, locale, channel, recipient user ID, masked address, status and attempt data, variables redacted to identifiers) and forbids clear-text addresses, rendered subject/body, names, street addresses, phone numbers and references. This matches `notification_log.recipient_address_masked` and `variables_redacted` in data-model.md §3.17. US-289 AC updated.
- **Why:** The REQ wanted the user to see which address a confirmation went to after an email change; the NFR wanted no full address stored. The masked form satisfies both: a user recognises `a***@acme.test`, and the row holds no personal data worth protecting beyond the user ID it already carries. Keeping the clear address would have duplicated personal data outside the identity module and complicated erasure (D-ARCH-007).
- **Alternatives:** Drop the address entirely (rejected: the US-289 "which address was used" scenario loses its value); store it in clear (rejected: contradicts NFR-PRIV-004 and the data model).
- **Reversibility:** High (one column's content).

### D-041 · 2026-11-12 · product-manager · Bounded reference lists may declare `x-max-limit` ≤ 300; REQ-API-007's 100 cap stays the default
- **Decision:** REQ-API-007 and DR-A21 allow a route-specific `x-max-limit` (≤ 300) only on global, read-only, cacheable reference lists (countries, subdivisions, currencies, Incoterms, export reasons, holidays). Every tenant/business list keeps the 100 cap (audit viewer 50/200). The contract test fails a tenant list that declares `x-max-limit`. US-037 gains two scenarios.
- **Why:** The country list is about 250 rows; three requests for a dropdown is a pointless round trip on a 170 kB-budget public page, and the rows are public reference data with `Cache-Control: public, max-age=3600`. The 100 cap exists to protect tenant queries and RLS-scoped scans, which these lists are not (ADR-0016 amendment 5(d)).
- **Alternatives:** Raise the global cap to 300 (rejected: weakens the tenant-list protection for no reason); keep 100 and page client-side (rejected: three requests and a flicker on the country combobox).
- **Reversibility:** High.

### D-042 · 2026-11-12 · product-manager · Error statuses confirmed: `ACCOUNT_HAS_ACTIVE_SHIPMENTS` 409, `LAST_OWNER` 422
- **Decision:** `ACCOUNT_HAS_ACTIVE_SHIPMENTS` is 409 (REQ-ACCT-017 note and EC-B45 now state the status; US-271 already had it). `LAST_OWNER` is 422 everywhere: REQ-ACCT-015 and EC-B46 corrected from 409 to 422 to match REQ-ORG-013, EC-A15, DR-A26, US-085, US-269 and the API contract (ADR-0016 amendment 5(f)).
- **Why:** The status rule in DR-A26/A-073 is "state conflict with the resource → 409; the request is well-formed but violates a business invariant → 422". Deletion refused because shipments are in flight is a conflict with the account's current state; the last-Owner rule is an invariant on the requested membership change. Two analysts had assigned different statuses to the same code; one catalogue entry per code (REQ-API-005) requires one answer.
- **Reversibility:** Medium once clients ship (customer-visible codes); high during this run.

### D-043 · 2026-11-12 · product-manager · Security-driven requirement wording adopted from D-ARCH-006 (a)–(e) and the ADR-0005/0006/0007/0008/0016 amendments
- **Decision:** Applied as wording amendments, no scope or priority change: (a) REQ-AUTH-006 "scoped to the auth path" → `__Host-` prefix, `Path=/`, read only by the auth routes (refresh, logout, CSRF); US-018 AC updated. (b) DR-A02 and REQ-AUTH-017: MFA lock is per **user** across challenges and IPs, not per challenge; US-024 gains a cross-challenge scenario. (c) REQ-DATA-002: demo seed never runs when `APP_ENV=production` and refuses default `SEED_*` passwords whenever `APP_ENV ≠ local`; US-049 scenarios now use `APP_ENV` and cover test/staging/production. (d) DR-A08 gains the coarse per-IP pre-authentication rate limit as the first step; REQ-SEC-005 states the two stages; US-040 gains a scenario. (e) One-time tokens never in paths or query strings: REQ-ORG-011/US-084/US-268 use `POST /invitations/accept {token}`, REQ-QUOTE-015/US-165 use `POST /public/shared-quotes/resolve {token}`, REQ-TRACK-009/US-250 use `POST /public/tracking/lookup`; email and share links carry tokens in the URL fragment (D-UX-009). Also: REQ-AUDIT-002 enum gains `MFA_RECOVERY_USED` and `SESSION_REVOKED` (ADR-0008 amendment; US-087 updated); REQ-AUDIT-006 `NONE` allow-list gains `GET /auth/csrf`, `POST /security/csp-report`, `GET /reference/volumetric`, `GET /reference/fx-rates/convert` (ADR-0016 amendment 5(c); US-086 updated); `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/csrf` are `public` rate class (DR-A22, REQ-SEC-005, NFR-SEC-005, US-040); webhooks 600/min per source IP recorded in DR-A22/NFR-SEC-005; NFR-DATA-003 exempts append-only tables from `updated_at/updated_by/version` (ADR-0007 amendment 6, data-model.md §12 OI-08).
- **Why:** Each item closes a threat-model finding (R-06, R-07, R-13, R-14, T-23) or a contract/data-model inconsistency that G2 would otherwise flag as a REQ-vs-ADR contradiction. None changes what the product does for a user; they fix how the obligation is stated so one test can satisfy both documents.
- **Alternatives:** Keep the REQ wording and have the architecture deviate with a note (rejected: G1/G2 rule is one source of truth per obligation); for refresh in the `auth` class, keep 10/min/IP (rejected: a shared-NAT office with 11 tabs refreshing would lock everyone out).
- **Reversibility:** High (wording; the limit values are configuration).

### D-044 · 2026-11-12 · product-manager · Requirements reflect Node 24 LTS (D-ARCH-001) and the CI evidence model (D-ORCH-001); `terraform apply` prohibition scoped to `ci.yml`
- **Decision:** REQ-PLAT-007, US-004, US-005, NFR "How to read", NFR-OPS-001, NFR-OPS-003, NFR-REC-003 and NFR-QUAL-006 now state: Node 24 LTS everywhere (`FROM node:24` in the US-004 lint example); on every PR only the hosted fast lane runs; heavy suites (integration/Testcontainers, generated RBAC/audit/RLS suites, e2e, k6, ZAP, Trivy, compose smoke, restore rehearsal) run in the full `ci.yml` on `main`/`workflow_dispatch` or locally via test-runner with evidence committed under `docs/05-quality/`, and either form is gate evidence. US-005's "no terraform apply" scenario is scoped to `ci.yml`; `cd.yml` holds the gated plan → policy → apply and canary jobs, no-op and never run in this run (ADR-0023). The NFR reference host is the ≥ 8-core developer machine; hosted-runner numbers are reported, not gated.
- **Why:** Requirements written at P1 assumed "CI" meant every suite on hosted runners; D-ORCH-001 (human answer Q-007) fixed a $0, private-repo model with local heavy suites. A story whose AC says "the PR runs integration tests on service containers" would fail G3 for a reason the human already decided. Node 20 is EOL (D-ARCH-001).
- **Reversibility:** High (a self-hosted runner or paid minutes later only changes where the heavy jobs run; the evidence rule stays).

### D-045 · 2026-11-12 · product-manager · UX and data-model defaults ratified: client-side auto sign-in after registration; unclaimed quotes hard-deleted 90 days after expiry; es "tú", fr "vous"; en-US/es-ES/fr-FR formatting fallbacks; full receiver ID on the customs invoice
- **Decision:** (1) Registration (REQ-AUTH-001) keeps the identical 202 for new and existing emails and never issues session tokens; the UX flow F02 "signed in immediately" is implemented by the web app calling login with the just-entered credentials after the 202, so a failed auto-login looks like any wrong-password login (REQ-AUTH-001 note, A-087). (2) Unclaimed quotes expired for more than 90 days and their options are hard-deleted by the allow-listed `housekeeping` purge; claimed or booked quotes are retained with the shipment (data-model.md §12 OI-17; NFR-DATA-003 allow-list; A-085). (3) Spanish copy uses "tú", French uses "vous" (D-UX-028; A-088). (4) Formatting locale falls back to en-US, es-ES, fr-FR when neither profile country nor browser region is known (D-UX-028; A-089). (5) The commercial/pro-forma invoice prints the receiver tax/identity reference in full because customs authorities require it; it is masked everywhere else (REQ-BOOK-008/REQ-CUST-012 notes; A-090).
- **Why:** (1) Issuing a session from the register endpoint would break EC-A01 anti-enumeration (an existing email could not receive the "same response"). (2) 600 M-row option growth in five years with no account linkage; 90 days comfortably exceeds the 24 h quote validity and any realistic "come back to my quote" window. (3)/(4) are the standard register for a consumer shipping product in those markets and keep translation review simple. (5) An invoice without the importer's tax ID is rejected at customs for the US → IN seeded lane; the document is SENSITIVE and audited on download.
- **Alternatives:** (1) Register returns tokens and a different response for existing emails (rejected: enumeration). (2) Keep unclaimed quotes indefinitely (rejected: storage growth, and privacy minimisation for guest IP/postcode data). (5) Mask on the invoice too (rejected: customs rejection).
- **Reversibility:** High for all five (configuration, copy or a one-line client flow).
