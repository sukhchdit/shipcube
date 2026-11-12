# UX specification — Multi-Carrier Shipping Platform (P2, run scope M0 + M1)

Version 1.0 · 2026-11-12 · owner ux-designer · Inputs: `docs/sdlc/BRIEF.md` (§5, §6 for the D-008 admin slice, §8, Appendix D), `docs/01-requirements/PRD.md`, `NFR.md`, `stories/EPIC-*.md`, `docs/sdlc/DECISIONS.md` (D-001..D-034)

The product has two UIs:
- the **customer web app**: pre-rendered public pages plus a client-rendered authenticated SPA;
- the **admin app**, limited to the D-008 slice: staff sign-in with TOTP, shell, read-only audit viewer, and my sessions.

Brand is a neutral placeholder taken from `BRAND_*` configuration. The Appendix D benchmarks shaped the **capabilities** only: instant quote without an account, side-by-side comparison, customs documents during booking, doorstep pickup, tracking by AWB or order number, prohibited-items guide, live volumetric weight. No text, imagery or layout was copied from them.

## 1. Document index

| Document | Contents |
|---|---|
| [information-architecture.md](information-architecture.md) | URL and locale strategy, sitemaps (public, auth, booking and account, admin), navigation model, full route inventory with auth, permission, pre-render flag, stories and data needs |
| [flows/F01-guest-quote-and-compare.md](flows/F01-guest-quote-and-compare.md) | End-to-end M1 journey overview; quote widget; streaming results; compare; expired quote and re-quote; save and share |
| [flows/F02-auth-gate-and-wizard.md](flows/F02-auth-gate-and-wizard.md) | "Book" sign-in gate and quote claim; customer sign-in; wizard navigation, resume and conflicts; rate-relevant change; steps 2, 3 and 5 |
| [flows/F03-checkout-3ds-confirmation.md](flows/F03-checkout-3ds-confirmation.md) | Checkout gate; card payment with 3-D Secure and declines; booking progress; confirmation; schedule pickup; document download |
| [flows/F04-public-tracking.md](flows/F04-public-tracking.md) | Public tracking lookup and states |
| [flows/F05-account.md](flows/F05-account.md) | Shipments list and detail, drafts, cancellation notices, sign-out |
| [flows/F06-staff-signin-totp-audit.md](flows/F06-staff-signin-totp-audit.md) | Staff sign-in with TOTP, landing, audit viewer, entry detail, entity history, session cap |
| [flows/F07-password-reset.md](flows/F07-password-reset.md) | Password reset |
| [flows/F08-email-verification.md](flows/F08-email-verification.md) | Email verification and the checkout gate |
| [flows/F09-mfa-enrolment.md](flows/F09-mfa-enrolment.md) | Mandatory staff TOTP enrolment and recovery codes; customer optional MFA (Should) |
| [flows/F10-session-guards-and-errors.md](flows/F10-session-guards-and-errors.md) | Route guards, single-flight refresh, permission denial, error message resolution |
| [wireframes/](wireframes/) | W00–W17: one file per screen or screen group, each with 360 px and 1280 px layouts, all six states, interaction details, accessibility and i18n keys |
| [design-system/tokens.md](design-system/tokens.md) + [tokens.json](design-system/tokens.json) | Colour (light and dark, contrast-checked), type scale, spacing, radius, elevation, motion, sizes, breakpoints, z-index, tenant theming seam. The JSON is in DTCG format and carries the contrast-pair list for the CI test. |
| [design-system/components.md](design-system/components.md) | Component inventory on Tailwind + Radix + TanStack Table + RHF/Zod + react-i18next: variants, interaction state matrix, accessibility |
| [accessibility.md](accessibility.md) | WCAG 2.2 AA contract: structure, focus, live regions, forms and the error summary, accessible authentication, targets, dragging, timing, and the per-screen checklist |
| [content-and-i18n.md](content-and-i18n.md) | Voice and tone, i18n key and namespace convention, ICU rules, en/es/fr strings for critical UI, errors and statuses, glossary, locale-aware formatting rules |

Wireframe files:

| File | Screens |
|---|---|
| [W00](wireframes/W00-shells-and-shared-states.md) | Web shell, admin shell, admin welcome, the six shared states, not found, toasts |
| [W01](wireframes/W01-home-quote-widget.md) | S-W01 Home with quote widget |
| [W02](wireframes/W02-quote-results.md) | S-W02 Results, compare (Should), S-W02s shared quote (Should) |
| [W03](wireframes/W03-customer-auth.md) | S-A01..S-A06 Sign in, two-step, register, verify, forgot, reset |
| [W04](wireframes/W04-wizard-shell-and-addresses.md) | Wizard shell, S-B01 Addresses, S-B01a Choose service again |
| [W05](wireframes/W05-wizard-contents-customs.md) | S-B02 Contents and customs |
| [W06](wireframes/W06-wizard-collection.md) | S-B03 Collection (pickup, drop-off) |
| [W07](wireframes/W07-wizard-extras-review-basket.md) | S-B04 Extras (Should), S-B05 Review and basket |
| [W08](wireframes/W08-checkout.md) | S-B06 Checkout |
| [W09](wireframes/W09-booking-progress-confirmation.md) | S-B07 Progress and confirmation, schedule-pickup dialog |
| [W10](wireframes/W10-public-tracking.md) | S-W03 Public tracking |
| [W11](wireframes/W11-account-shipments-and-drafts.md) | S-C01 Overview, S-C02 Shipments, S-C04 Drafts |
| [W12](wireframes/W12-account-shipment-detail.md) | S-C03 Shipment detail |
| [W13](wireframes/W13-account-settings-should.md) | S-C05..S-C10 Account settings (all Should or Could), S-D08 shared sessions component |
| [W14](wireframes/W14-prohibited-items-legal.md) | S-W04 Prohibited items, S-W05 Legal and help |
| [W15](wireframes/W15-admin-auth.md) | S-D01 Staff sign-in, S-D02 MFA challenge, S-D03 MFA enrolment |
| [W16](wireframes/W16-admin-home-audit-sessions.md) | S-D04 Welcome, S-D05 Audit list, S-D06 Entry detail, S-D07 Entity history, S-D08 My sessions |
| [W17](wireframes/W17-emails-and-documents.md) | S-E01..S-E04 Emails, S-E05 Commercial or pro-forma invoice PDF |

## 2. Screen inventory

**Must** = the screen carries at least one Must story. **Should** = the screen exists only for Should or Could stories (build only if the story is scheduled; otherwise no route and no navigation entry).

| Screen | Name | App | Route | MoSCoW | Wireframe | Flow | Must stories | Should / Could stories |
|---|---|---|---|---|---|---|---|---|
| — | Web shell, account layout | web | all | Must | W00 §1 | F10 | US-019, US-020, US-070, US-102, US-104, US-105, US-107, US-108, US-117, US-120 | US-114, US-118 |
| — | Admin shell | admin | all | Must | W00 §2 | F10 | US-032, US-070, US-110 | US-111 |
| S-W01 | Home + quote widget | web | `/{lng}/` | Must | W01 | F01 §1 | US-109, US-112, US-139, US-155, US-156, US-157, US-158, US-173 | — |
| S-W02 | Quote results | web | `/quote/{id}` | Must | W02 | F01 §2–4 | US-143, US-149, US-154, US-155, US-156, US-159, US-160, US-161, US-167 | US-162, US-163, US-164, US-165, US-169 |
| S-W02s | Shared quote (read-only) | web | `/q/{token}` | Should | W02 §6 | F01 §5 | — | US-165 |
| S-W03 | Public tracking | web | `/{lng}/track` | Must | W10 | F04 | US-040, US-112, US-243, US-247, US-248, US-249 | US-250 |
| S-W04 | Prohibited items | web | `/{lng}/prohibited-items` | Must | W14 §1 | — | US-055, US-112 | US-170 |
| S-W05 | Legal pages, help | web | `/{lng}/legal/*`, `/{lng}/help` | Must | W14 §2–3 | — | US-059, US-112 | US-060, US-114 |
| S-W06 | Not found (web) | web | `*` | Must | W00 §3.7 | F10 | US-069, US-104, US-257 | US-273 |
| S-A01 | Sign in | web | `/sign-in` | Must | W03 §1 | F02 §1a | US-017, US-020, US-022, US-040, US-171 | — |
| S-A02 | Register | web | `/register` | Must | W03 §3 | F02 §1, F08 | US-015, US-171 | — |
| S-A03 | Verify email | web | `/verify-email` | Must | W03 §4 | F08 | US-016 | — |
| S-A04 | Forgot password | web | `/forgot-password` | Must | W03 §5 | F07 | US-021 | — |
| S-A05 | Reset password | web | `/reset-password` | Must | W03 §5 | F07 | US-021 | — |
| S-A06 | Two-step verification | web | `/sign-in/verify` | Must | W03 §2 | F02 §1a | US-024 | US-026 |
| S-B01 | Wizard shell + step 1 Addresses | web | `/book/new`, `/book/{id}/addresses` | Must | W04 | F02 §1–3 | US-039, US-119, US-166, US-171, US-172, US-174, US-175, US-176, US-177 | US-178, US-179 |
| S-B01a | Choose service again | web | `/book/{id}/service` | Must | W04 §3 | F02 §3 | US-167, US-168 | — |
| S-B02 | Step 2 Contents and customs | web | `/book/{id}/contents` | Must | W05 | F02 §4 | US-054, US-180, US-181, US-182, US-183, US-184 | US-185 |
| S-B03 | Step 3 Collection | web | `/book/{id}/collection` | Must | W06 | F02 §5 | US-189, US-232, US-233, US-234 | US-239 (drop-off, Should per D-036), US-240 (not built) |
| S-B04 | Step 4 Extras | web | `/book/{id}/extras` | Should | W07 §1 | — | — | US-190 |
| S-B05 | Step 5 Review and basket | web | `/book/{id}/review` | Must | W07 §2 | F02 §6, F03 §1 | US-149, US-150, US-167, US-191, US-192, US-208 | US-193, US-194 |
| S-B06 | Step 6 Checkout | web | `/checkout/{orderId}` | Must | W08 | F03 §1–2 | US-208, US-209, US-210, US-211, US-212, US-214 | US-217 |
| S-B07 | Progress + confirmation (step 7) | web | `/orders/{orderId}/confirmation` | Must | W09 | F03 §3–5 | US-072, US-195, US-204, US-205, US-206, US-207, US-223, US-224, US-225, US-226, US-235, US-236 | US-188, US-228, US-239 |
| S-C01 | Account overview | web | `/account` | Must (shell) | W11 §1 | F05 | US-070, US-108 | US-258 |
| S-C02 | Shipments list | web | `/account/shipments` | Must | W11 §2 | F05 §1 | US-037, US-254, US-257 | — |
| S-C03 | Shipment detail | web | `/account/shipments/{id}` | Must | W12 | F05 §1, §3; F03 §4–5 | US-072, US-150, US-224, US-225, US-226, US-236, US-237, US-243, US-251, US-255, US-257 | US-196, US-238, US-260, US-261 |
| S-C04 | Drafts | web | `/account/drafts` | Must | W11 §3 | F05 §2 | US-256, US-257 | — |
| S-C05 | Saved quotes | web | `/account/quotes` | Should | W13 §5 | — | — | US-164, US-259 |
| S-C06 | Address book | web | `/account/addresses` | Should | W13 §4 | — | — | US-262, US-263, US-264 |
| S-C07 | Security (password, MFA, sessions) | web | `/account/security` | Should | W13 §1 | F09 §2 | — | US-026, US-027, US-028, US-267 |
| S-C08 | Preferences and notifications | web | `/account/preferences` | Should | W13 §3 | — | — | US-266, US-272 |
| S-C09 | Organisation and team | web | `/account/organisation` | Should | W13 §7 | — | — | US-081..US-085, US-268, US-269 |
| S-C10 | Payment methods | web | `/account/payment-methods` | Should | W13 §6 | — | — | US-217, US-265 |
| — | Privacy (export, delete) | web | `/account/privacy` | Could | not specified (Could, D-027) | — | — | US-270, US-271 |
| S-D01 | Staff sign-in | admin | `/sign-in` | Must | W15 §1 | F06 §1 | US-017, US-022, US-030, US-031, US-040 | US-033 |
| S-D02 | Staff MFA challenge | admin | `/sign-in/verify` | Must | W15 §2 | F06 §1 | US-024, US-031 | — |
| S-D03 | Staff MFA enrolment + recovery codes | admin | `/mfa/enrol` | Must | W15 §3 | F09 §1 | US-023, US-025, US-031 | — |
| S-D04 | Admin welcome | admin | `/` | Must | W00 §2 | F06 §1 | US-032, US-110 | — |
| S-D05 | Audit list | admin | `/audit` | Must | W16 §1 | F06 §2 | US-032, US-037, US-093, US-097 | US-111 |
| S-D06 | Audit entry detail | admin | `/audit/entries/{id}` | Must | W16 §2 | F06 §2 | US-032, US-098 | — |
| S-D07 | Entity history | admin | `/audit/entities/{e}/{id}` | Must (route) | W16 §3 | F06 §2 | US-032 | US-099 |
| S-D08 | My sessions | admin | `/account/sessions` | Should (in D-008 slice) | W16 §4, W13 §1 | — | — | US-027 |
| S-D09 | Not found (admin) | admin | `*` | Must | W00 §3.7 | F10 | US-032, US-110 | — |
| S-E01 | Email: verification | email | — | Must | W17 §2 | F08 | US-016, US-279, US-280, US-282 | — |
| S-E02 | Email: password reset | email | — | Must | W17 §2 | F07 | US-021, US-279, US-280, US-282 | — |
| S-E03 | Email: security notice | email | — | Must | W17 §2 | — | US-279, US-280, US-282 | — |
| S-E04 | Email: booking confirmation | email | — | Must | W17 §2 | F03 | US-279, US-280, US-283 | US-218, US-286, US-287 |
| S-E05 | Commercial / pro-forma invoice PDF | document | — | Must | W17 §3 | — | US-186 | — |

Design-system-only Must stories (no single screen; they are delivered by the design system and apply to every screen): US-101, US-103, US-106, US-113, US-115, US-116, US-036. See §3.

## 3. Must-story coverage (UX trace)

The P2 exit criterion requires flows, wireframes, states, tokens and accessibility notes for every Must story that has a UI. After D-036 (US-239 moved from Must to Should), there are **214 Must stories**. **108 have a UI or a user-visible state** (direct or surfaced). **106 are non-UI** (back end, tooling, data, adapters) and are listed in §3.2 with the reason. US-239 (drop-off) stays fully specified (W06, W09) as a Should.

### 3.1 Must stories with UI → where specified

| Story | Title (short) | Screens | Flow | Other spec |
|---|---|---|---|---|
| US-015 | Register | S-A02 | F02 §1, F08 | content §4.3 |
| US-016 | Verify email | S-A03, S-E01 | F08 | — |
| US-017 | Sign in | S-A01, S-D01 | F02 §1a, F06 §1 | — |
| US-019 | Logout | Web shell account menu, admin user menu | F05 §4 | W00 |
| US-020 | Client token handling, signed-out redirect | S-A01 (signed-out notice) | F10 §1 | W00 §3.8 |
| US-021 | Password reset | S-A04, S-A05, S-E02 | F07 | — |
| US-022 | Delay and lockout messages | S-A01, S-D01 | F02 §1a, F06 §1 | W03 §1 |
| US-023 | TOTP enrolment, recovery codes | S-D03 | F09 §1 | W15 §3 |
| US-024 | MFA challenge | S-A06, S-D02 | F02 §1a, F06 §1 | W15 §2 |
| US-025 | Mandatory staff enrolment | S-D03 | F09 §1, F10 §1 | W15 §4 |
| US-030 | Admin route guard, staff-only admission | S-D01 | F06 §1, F10 | IA §4.2 |
| US-031 | Staff sign-in, MFA, enrolment screens | S-D01, S-D02, S-D03 | F06 §1, F09 | W15 |
| US-032 | Admin landing, navigation, audit routes | S-D04..S-D07, S-D09, admin shell | F06 | IA §2.4 |
| US-036 | Error catalogue → localised messages | all (error states) | F10 §3 | content §4.6 |
| US-037 | Cursor pagination (paging controls, invalid-cursor notice) | S-C02, S-D05 | F05 §1, F06 §2 | components Pagination |
| US-039 | ETags and optimistic concurrency | S-B01 (conflict dialog) | F02 §2 | W04 §1 |
| US-040 | Rate-limit messages | S-W01, S-W02, S-W03, S-A01, S-D01 | F01, F04, F06 | content §4.6 |
| US-054 | Sample datasets labelled (HS) | S-B02 | F02 §4 | W05 |
| US-055 | Prohibited items public lookup | S-W04 | — | W14 §1 |
| US-059 | Unreviewed flag and draft legal banner | S-W05, S-W02 (tax line), S-B05 | — | W14 §2, components UnreviewedBadge |
| US-069 | Cross-tenant 404 as not-found | S-W06, S-D09, all detail screens | F10 | W00 §3.7 |
| US-070 | Permission-aware UI and route guard | all screens | F10 §1–2 | W00 §3.5 |
| US-072 | Download permission | S-B07, S-C03 | F03 §5 | W09 §3 |
| US-093 | Chain verification status | S-D05 | F06 §2 | W16 §1 |
| US-097 | Audit list | S-D05 | F06 §2 | W16 §1 |
| US-098 | Audit entry detail and diff | S-D06 | F06 §2 | W16 §2 |
| US-101 | Design tokens | all | — | tokens.md, tokens.json |
| US-102 | Light and dark themes, contrast | all; ThemeSwitcher | — | tokens.md §3 |
| US-103 | Control sizing, states, reduced motion | all | — | components §0, tokens §7–8 |
| US-104 | Six screen states | all | F10 | W00 §3, components §4 |
| US-105 | Offline and toasts | all | — | W00 §3.6, §4 |
| US-106 | Inline validation, semantics | all forms | — | components §3, accessibility §5 |
| US-107 | Responsive, table-to-card | all | — | components §7, tokens §9 |
| US-108 | Customer web shell | web shell | — | W00 §1 |
| US-109 | Home hero, sticky mobile action bar | S-W01, S-B01..S-B06 | F01 §1 | W01, W04 §1 |
| US-110 | Admin shell | admin shell | — | W00 §2 |
| US-112 | Pre-rendered public pages per locale | S-W01, S-W03, S-W04, S-W05 | — | IA §1, §4 |
| US-113 | Accessibility gate | all | — | accessibility.md |
| US-115 | Localisable strings, ICU | all | — | content §2 |
| US-116 | Locale-aware formatting | all | — | content §5 |
| US-117 | Locale resolution and persistence | shells, LocaleSwitcher, emails | — | IA §1, content §5.1 |
| US-119 | Country-driven address layout | S-B01 | F02 | components AddressForm, W04 §2 |
| US-120 | Pseudo-locale, logical CSS | all | — | content §2.4, §3 |
| US-139 | Billable weight (live readout) | S-W01 | F01 §1 | W01 |
| US-143 | Included cover line | S-W02, S-B05 | — | W02 breakdown |
| US-149 | Charge lines and explanation | S-W02, S-B05, S-C03 | — | components PriceBreakdown |
| US-150 | Booked price snapshot shown | S-B05, S-C03 | — | W07, W12 |
| US-154 | Quote expiry shown | S-W02 | F01 §2 | W02 |
| US-155 | Guest quoting, rate limit | S-W01, S-W02 | F01 | W02 §4 |
| US-156 | Validation, limit-based exclusion reasons | S-W01, S-W02 | F01 | W01 §3, W02 §4 |
| US-157 | Units toggle, live billable weight | S-W01 | F01 §1 | W01 |
| US-158 | Pre-rendered home with widget | S-W01 | F01 §1 | W01 |
| US-159 | Result card and breakdown | S-W02 | F01 §2 | W02 |
| US-160 | Progressive results, skeletons, partial | S-W02 | F01 §2 | W02 §4 |
| US-161 | Sort and badges | S-W02 | F01 §2 | W02 §3 |
| US-166 | Claim quote at booking start | S-B01 | F02 §1 | W04 |
| US-167 | Expired quote and re-quote | S-W02, S-B01a, S-B05 | F01 §4 | W02, W07 |
| US-168 | Rate-relevant change → new quote | S-B01, S-B01a | F02 §3 | W04 §3 |
| US-171 | Sign-in gate keeps selected option | S-A01, S-A02, S-B01 | F02 §1 | W03 (BookingContextCard) |
| US-172 | Draft, resume, concurrency | S-B01..S-B05, S-C04 | F02 §2 | W04 §1 |
| US-173 | Content type (parcel/document) | S-W01 | F01 §1 | W01 |
| US-174 | Responsive wizard shell | S-B01..S-B05 | F02 §2 | W04 §1 |
| US-175 | Step 1 parties and address book | S-B01 | F02 | W04 §2 |
| US-176 | Address validation | S-B01 | F02 | W04 §2 |
| US-177 | Tax and identity references | S-B01 | F02 | W04 §2 |
| US-180 | Step 2 contents, customs applicability | S-B02 | F02 §4 | W05 |
| US-181 | Customs lines, reason for export | S-B02 | F02 §4 | W05 |
| US-182 | Commodity code search | S-B02 | F02 §4 | W05 |
| US-183 | Prohibited and restricted check | S-B02 | F02 §4 | W05 |
| US-184 | DG attestation | S-B02 | F02 §4 | W05 |
| US-186 | Commercial / pro-forma invoice content | S-E05, S-B07 (download) | — | W17 §3 |
| US-189 | Collection mode | S-B03 | F02 §5 | W06 |
| US-191 | Review with price and edit-back | S-B05 | F02 §6 | W07 §2 |
| US-192 | Order basket model (1–10, one currency) | S-B05 | F02 §6 | W07 §2 |
| US-195 | Confirmation page | S-B07 | F03 §3 | W09 §2 |
| US-204 | Saga compensation outcome | S-B07 | F03 §3 | W09 variants |
| US-205 | Ambiguous outcome (EXCEPTION) | S-B07, S-C03 | F03 §3 | W09 variants |
| US-206 | Partial capture, multi-shipment | S-B07 | F03 §3 | W09 variants |
| US-207 | Booking progress stream | S-B07 | F03 §3 | W09 §1 |
| US-208 | Checkout gate | S-B05, S-B06 | F03 §1, F08 | W07, W08 |
| US-209 | Server-computed amount | S-B06 | F03 §2 | W08 |
| US-210 | Stripe test only (test-mode label) | S-B06, S-B07 | F03 | W08 |
| US-211 | Card only, no card data | S-B06 | F03 §2 | W08 §2 |
| US-212 | 3DS, declines, attempt limit | S-B06 | F03 §2 | W08 |
| US-214 | Checkout screen with test mode | S-B06 | F03 §2 | W08 |
| US-223 | Async documents (pending state) | S-B07, S-C03 | F03 §3 | W09 |
| US-224 | Document list and re-download | S-B07, S-C03 | F03 §5 | W09, W12 |
| US-225 | Pre-signed download (expiry handling) | S-B07, S-C03 | F03 §5 | W09 §3 |
| US-226 | Fail-closed download audit (message) | S-B07, S-C03 | F03 §5 | W09 §3 |
| US-232 | Pickup date and window rules | S-B03, schedule dialog | F02 §5 | W06 |
| US-233 | Pickup record and instructions | S-B03 | F02 §5 | W06 |
| US-234 | Pickup picker | S-B03 | F02 §5 | W06 |
| US-235 | Pickup in saga (result shown) | S-B07, S-C03 | F03 §3 | W09 |
| US-236 | Schedule pickup after booking | S-B07, S-C03 | F03 §4 | W09 dialog |
| US-237 | Cancel pickup (driver-may-attend notice) | S-C03 | F05 §3 | W12 §2 |
| US-243 | Stale tracking flag | S-W03, S-C03 | F04 | W10, W12 §3 |
| US-247 | Public tracking lookup | S-W03 | F04 | W10 |
| US-248 | Public page city-level only | S-W03 | F04 | W10 |
| US-249 | Public lookup rate limit | S-W03 | F04 | W10 §3 |
| US-251 | Authenticated tracking timeline | S-C03 | F05 §1 | W12 §3 |
| US-254 | Shipments list | S-C02 | F05 §1 | W11 §2 |
| US-255 | Shipment detail | S-C03 | F05 §1 | W12 |
| US-256 | Drafts list | S-C04 | F05 §2 | W11 §3 |
| US-257 | Tenant isolation (not-found UI) | S-C02..S-C04, S-W06 | F10 | W11 §4 |
| US-279 | Localised email rendering | S-E01..S-E04 | — | W17 §1 |
| US-280 | Recipient locale | S-E01..S-E04 | — | W17 §1, content §5 |
| US-282 | Verification, reset, security emails | S-E01, S-E02, S-E03 | F07, F08 | W17 §2 |
| US-283 | Booking confirmation email | S-E04 | F03 | W17 §2 |

**Must UI stories not covered: 0.**

Six states: every Must screen in §2 has a states table covering loading, empty, error, partial, permission-denied and offline, or an explicit "n/a" with the reason (for example, auth screens have no partial state, US-031). Emails and the invoice PDF (S-E01..S-E05) are non-interactive outputs and are exempt from screen states.

### 3.2 Must stories judged non-UI (106)

These have no screen and no user-visible state of their own. Where they influence a UI, the influence is handled by the UI story named in brackets.

| Epic | Stories | Reason |
|---|---|---|
| EPIC-01 Platform foundation | US-001..US-012 (12) | Tooling, config, logging, queues, outbox, health endpoints |
| EPIC-02 Identity | US-018 | Cookie rotation and reuse detection (its visible effect is US-020's signed-out redirect) |
| EPIC-03 Orgs, RBAC, RLS | US-061, US-062, US-063, US-064, US-065, US-066, US-067, US-068, US-071, US-074, US-075, US-076, US-077, US-078, US-079, US-080 (16) | Server-side model, catalogue, policies, tests (UI effect via US-069, US-070, US-072) |
| EPIC-04 Audit | US-086, US-087, US-088, US-089, US-090, US-091, US-092, US-094, US-095, US-096 (10) | Capture, chain, immutability, partitions, test generator (fields displayed by US-098) |
| EPIC-06 Carriers | US-121..US-137 (17) | Adapters, contract tests, resilience, SSE transport (rendered by US-160) |
| EPIC-07 Pricing | US-138, US-140, US-141, US-142, US-146, US-147, US-148, US-151, US-152 (9) | Pure engine and configuration (output rendered via US-149 and US-159) |
| EPIC-09 Booking | US-187 | Adapter-internal customs mapping |
| EPIC-10 Saga, payments | US-197, US-198, US-199, US-200, US-201, US-202, US-203, US-213 (8) | State machine, gateway abstraction, order numbers, saga, webhooks |
| EPIC-11 Documents | US-220, US-221, US-222 (3) | Storage, versioning, label formats |
| EPIC-13 Tracking | US-241, US-242, US-244, US-245 (4) | Mapping, event storage, polling, Mock scenarios |
| EPIC-15 Notifications | US-274, US-276, US-277, US-278, US-281, US-284, US-285 (7) | Provider, mail catcher, event mapping, jobs, CI parity, recipient rule |
| EPIC-16 API conventions | US-034, US-038, US-041, US-042, US-043, US-044, US-045, US-046, US-047, US-048 (10) | OpenAPI, idempotency, data representation, SSE convention, headers, CSRF, hardening, scanning |
| EPIC-17 Reference data | US-049, US-050, US-051, US-052, US-053, US-056, US-057, US-058 (8) | Seeds, endpoints, sequences, pack store |

Check: 108 UI + 106 non-UI = 214 Must stories (D-036 counts).

## 4. Milestone staging of screens

| Milestone | Screens delivered |
|---|---|
| M0 (R0 `v0.1.0-m0`) | Web shell, account overview shell (S-C01 minimal), S-A01..S-A06, S-W06; admin shell, S-D01..S-D07, S-D09; design system and shared states; S-E01..S-E03 rendering via the mail catcher. The M0 guest quote is demonstrated through the API (PRD §6.1 note), so no widget UI is needed in M0. |
| M1 (R1 `v0.1.0`) | S-W01..S-W05, S-B01..S-B07, S-C02..S-C04, S-E04, S-E05; Should screens as scheduled |

## 5. Open items for other agents (non-blocking; UX defaults already applied)

| # | Item | Owner | UX default applied |
|---|---|---|---|
| 1 | Email-link tokens (verify, reset, invitation) in the URL **fragment** so they never reach server logs or referrers | principal-architect (link format), security-analyst | D-UX-009: fragment, cleared with `replaceState` |
| 2 | Guest quote access token must survive reload and the sign-in/register detour within the same browser **without being in the URL** | principal-architect | D-UX-011: requirement stated; mechanism (for example a path-scoped HttpOnly cookie, or tab-scoped storage) is the architect's call |
| 3 | Does registration issue a session immediately? F02 assumes yes. If not, the post-register panel routes to sign-in with the same `returnUrl`. | principal-architect | Assumed yes |
| 4 | QR code for TOTP: server-rendered SVG versus a client QR library (new dependency) | principal-architect | No preference. The UI needs an image plus the manual key. |
| 5 | ICU MessageFormat in i18next needs an ICU plugin (dependency) | principal-architect (ADR) | ICU syntax specified. Native i18next plurals are the fallback. |
| 6 | Root `/` locale redirect, and `X-Robots-Tag: noindex` on `/{lng}/track?number=` | principal-architect / devops | Behaviour specified in IA §1 |
| 7 | Staff password reset: the email link must target the admin origin for staff accounts | principal-architect | Same screens in both apps |
| 8 | Commercial invoice prints the receiver ID in full (customs need it); everywhere else it is masked | security-analyst | W17 §3 |
| 9 | US-239 retagged Should (D-036, G1-C2). UX still specifies the drop-off list and confirmation content, so it can be built if scheduled. | product-manager | Resolved; no UX change |
| 10 | Carrier logos are trademarks. Only operator-supplied logo assets per carrier (configuration) are shown; the repository ships monograms. | principal-architect (config seam) | D-UX-018 |
| 11 | Spanish number grouping: helpers use `useGrouping: 'always'` to match US-116's "1.234,50" expectation | qa-lead (test data), principal-architect | D-UX-028 |

### Resolved by architecture (principal-architect, 2026-11-12; decisions D-ARCH-011..D-ARCH-016 in `docs/sdlc/DECISIONS.md`)

| # | Resolution | Where |
|---|---|---|
| 1 | Link format fixed: `<app origin>/verify-email#token=…`, `/reset-password#token=…`, `/invitations/accept#token=…` (unprefixed app routes); the SPA posts `{token}` in a body and clears the fragment; no other link parameter. Share links (US-165, Should) follow the same rule as `/q#token=…`; ux-designer aligns the S-W02s route (`/q/{token}`) when US-165 is scheduled. | ADR-0006 amendment 8; ADR-0016 amendment 6a; `docs/03-architecture/api/README.md` §1 |
| 2 | `localStorage` map `qt:<quoteId>` → `{token, expires_at}`; written once from `createQuote`, deleted on claim, expiry, sign-out or 404; survives reload, new tab and the register/sign-in detour; `X-Quote-Token` header unchanged; cookie and `sessionStorage` rejected with reasons. | ADR-0026 amendment 1; api/README §8 |
| 3 | **Registration does not issue a session** (202 identical for new and existing e-mails, EC-A01). The F02 assumption holds client-side: the web app calls `loginUser` immediately with the in-memory credentials; on `INVALID_CREDENTIALS` it shows the sign-in panel with the same `returnUrl` (the F02 fallback). No UX change needed beyond keeping the fallback panel. | ADR-0006 amendment 10; api/README §8 |
| 4 | Client-side QR: `uqr` (MIT, zero deps) renders the `provisioning_uri` as a React SVG in `packages/ui` (`<QrCode>`, `role="img"`, fixed dark-on-light, ≥ 200 px) next to the manual key; no server image endpoint; API contract unchanged. | ADR-0026 amendment 2; ADR-0025 (uqr); ADR-0006 amendment 11 |
| 5 | `i18next-icu` 2.7 + `intl-messageformat` 12 approved (licences MIT / BSD-3-Clause, maintained). Values are pre-formatted by the shared Intl helpers and passed as strings; ICU runtime counted inside the 170 kB public budget, measured in Wave 0; fallback = native i18next suffix plurals for all strings. | ADR-0026 amendment 3; ADR-0025 |
| 6 | Root `/`: Nginx in the `web` image answers 302 to `/{lng}/` from cookie `lng` → `Accept-Language` → `en`, `Cache-Control: no-store`, works without JavaScript; `/` is not pre-rendered (SPA fallback is `index.html`). `X-Robots-Tag: noindex` on `/{lng}/track` when `number` is present; admin app and API always `noindex`. Locale cookie is `lng` (`Path=/`, 1 year, `SameSite=Lax`, `Secure`). | ADR-0026 amendments 4–5; ADR-0016 amendment 6b; platform.md §3.3 |
| 7 | Reset and verification links target `ADMIN_APP_ORIGIN` for users with an ACTIVE OPERATOR membership and `WEB_APP_ORIGIN` otherwise, regardless of which app made the request; same screens in both apps as specified. | ADR-0006 amendment 9 |
| 8 | Owner security-analyst (unchanged; no architecture decision needed — the invoice PDF path is covered by ADR-0019 document access rules). | — |
| 9 | Already resolved (D-036). | — |
| 10 | `carriers.logo_asset_key` resolves to the same-origin path `/brand/carriers/<key>.svg` served from an operator-mounted directory (Compose volume / `web-assets` prefix `brand/`); reserved key `monogram` or a 404 → monogram chip; CSP `img-src 'self' data:` unchanged; repository ships no logos; M1 seed = `monogram`. | ADR-0026 amendment 6; platform.md §3.3 |
| 11 | `Intl.NumberFormat(locale, { useGrouping: 'always' })` in `packages/shared/format` for web, admin and worker (e-mails, PDFs); shared unit test pins the US-116 examples; supported by Node 24 and the browser matrix. | ADR-0026 amendment 7 |

## 6. Decisions

Logged in `docs/sdlc/DECISIONS.md` as D-UX-001..D-UX-029. Architecture resolutions of §5: D-ARCH-011..D-ARCH-016.
