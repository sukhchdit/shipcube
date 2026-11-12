# E2E critical journeys (Playwright)

Version 1.0 · 2026-11-12 · owner qa-lead · implementers e2e-test-engineer (P5) · strategy: [TEST-STRATEGY.md](../TEST-STRATEGY.md) §7.8. Sources: PRD §6.1 and §6.2 (exit demos), PRD §4.2 O1 and §4.3 guardrails, UX flows F01–F10, NFR-COMPAT-002, NFR-A11Y-003, NFR-RES-006, NFR-SEC-013, ADR-0024.

## 1. Scope and rules

- **Critical journeys (10):** J-M0-01..04 (M0 exit demo, browser-observable), J-M1-01 (M1 exit demo outline), J-M1-02..06 (the remaining highest-risk customer paths). J-M0-05 is the demo's "generators pass" step and is satisfied by suite evidence, not by a browser. These are the journeys listed in `journeys_required_at_gate` of the manifest.
- **Supporting journeys:** J-SEC-01..02 (browser security cases), J-KB-01..09 (keyboard-only variants, NFR-A11Y-003), J-M1-01L (live sandbox, COND-SANDBOX-DEMO).
- **Projects** (8): `chromium-mobile` (360 × 780, `isMobile`, `hasTouch`), `chromium-desktop` (1280 × 800), `firefox-mobile` (360 × 780, `hasTouch`; no `isMobile` in Firefox, D-QA-005), `firefox-desktop`, `webkit-mobile` (360 × 780, `isMobile`, `hasTouch`), `webkit-desktop`, plus `chromium-390` (Pixel 7) and `webkit-390` (iPhone 14) for the 390 px compatibility class. "6 projects" below means the first six.
- **Always on:** axe after every navigation and state change (0 serious/critical), CSP `securitypolicyviolation` listener (0), console-error collector, response-header recorder, request-body recorder (for the PAN scanner). After the run, `log-scan` checks every container's logs.
- **Tags:** `@critical` (PR-level Chromium set), `@demo-m0`, `@demo-m1`, `@security`, `@keyboard`, `@live-sandbox`. Test titles carry the journey ID and the `AT-` IDs they verify (TEST-STRATEGY.md §6).
- **Profiles:** `pr` = `@critical` on `chromium-mobile` + `chromium-desktop` in en. `wave` = all critical journeys in en on 6 projects + es/fr on the two Chromium projects. `gate` = full matrix below, 0 flaky allowed.
- **Determinism:** no fixed sleeps; web-first assertions; per-test users and organisations; Mock scenarios selected per test; Mailpit polled through its HTTP API with a bounded wait (≤ 10 s); server-side ages created by the test-data CLI (T-QA-05), never through HTTP.

## 2. Shared data setup

| Item | How | Notes |
|---|---|---|
| Stack | `docker compose up -d --wait` from the build under test, `APP_ENV=test`, `MOCK_CARRIER_ENABLED=true`, `MOCK_SCENARIOS_ENABLED=true` | Ports on 127.0.0.1; edge TLS proxy |
| Reference and demo seed | `npm run db:seed` + `npm run db:seed:demo` (one user per role, demo organisations, Mock carrier, sample pricing, compliance packs, FX snapshot) | Seed passwords from `SEED_*` variables, never committed |
| Staff TOTP | The seeded Super Admin and Compliance Auditor have TOTP secrets provided to the test process through `SEED_*` variables; codes are generated with the same RFC 6238 parameters | Never logged; the log-scan sentinel set includes the secret |
| Per-test users | Factory via public API (register → verify through Mailpit → sign in) or test-data CLI for pre-verified users | Unique e-mail domain per run `<run>.test.invalid` |
| Carriers | Mock carrier (`X-Mock-Scenario` or `MOCK:` reference for `latency`, `fail`, `error`, `rates=empty`, `track=…`); DHL Express, FedEx and UPS adapters **fixture-backed** (D-003), selected through the seeded platform carrier accounts | Fixture adapters respond through nock-equivalent recorded responses inside the stack |
| Payments | Default lane: **Mock gateway** hosted-field test double in the web app with tokens `mock_ok`, `mock_3ds`, `mock_3ds_fail`, `mock_decline`, `mock_capture_fail`, and the CVC outcomes; the Stripe adapter is verified fixture-backed at API level (`payments-webhooks`). Real Stripe Payment Element only in `@live-sandbox` (D-QA-006, OI-QA-01) | "Test mode" badge asserted |
| E-mail | Mailpit API (`http://127.0.0.1:8025/api/v1`) | Locale of each message asserted |
| Clock | Client timers: `page.clock`; server-side ages: test-data CLI (e.g. quote `expires_at` in the past, `sessions.authenticated_at` 13 h ago) | |
| Locale | `Accept-Language` + the locale switcher; URL prefix `/<lng>/` for public pages | en, es, fr |

## 3. Critical journeys

### J-M0-01 Staff and customer sign-in to both apps (PRD §6.1 scenario 1) `@demo-m0 @critical`

| Step | Action | Assertions | AT IDs (examples) |
|---|---|---|---|
| 1 | Open admin app `/sign-in` | Page in the browser locale; axe clean | AT-US-031-* |
| 2 | Seeded Super Admin enters e-mail + password | 401 `MFA_REQUIRED` handled; `/sign-in/verify` shown; focus on the code field | AT-US-024-*, AT-US-031-* |
| 3 | Enter the current TOTP code | Admin shell with "Audit" in the navigation; user's locale applied (`lang`) | AT-US-032-*, AT-US-110-* |
| 4 | Open customer web app, sign in as the seeded customer Owner | Account dashboard shell shown | AT-US-017-*, AT-US-108-* |
| 5 | Inspect storage | No access token in `localStorage`, `sessionStorage`, IndexedDB or a readable cookie; refresh cookie `__Host-rt_*` is HttpOnly, Secure, SameSite=Strict, `Path=/` (from the `Set-Cookie` header) | AT-US-020-*, SEC-TC-09 |

Data: demo seed. Browsers/viewports: 6 projects. Locale: en (gate adds es, fr on Chromium).

### J-M0-02 Guest gets a mock quote through the API (PRD §6.1 scenario 2) `@demo-m0 @critical`

| Step | Action | Assertions |
|---|---|---|
| 1 | Open Swagger UI `/api/docs` | Loads; lists `createQuote` (excluded from axe, D-QA-009) |
| 2 | `POST /api/v1/quotes` as a guest: US 10001 → IN 400001, parcel, 2 kg, 30 × 20 × 10 cm (Playwright `request`) | 201; guest access token returned; at least one Mock service with an itemised price in USD; first result ≤ 1.5 s (functional check; the budget is proven by k6) |
| 3 | Read the quote with and without the guest token | With token: 200 and `expires_at` = created + 24 h; without or with another token: 404 |

AT IDs: AT-US-154-*, AT-US-155-*, AT-US-156-*. Runs once per project (API part is engine-independent; the Swagger UI load is per engine).

### J-M0-03 One Mock booking flows API → queue → worker (PRD §6.1 scenario 3) `@demo-m0 @critical`

| Step | Action | Assertions |
|---|---|---|
| 1 | Customer Owner holds a quote (factory) | |
| 2 | Book through the API with an `Idempotency-Key` (Mock gateway `mock_ok`) | 202; shipment passes DRAFT → QUOTED → PENDING_PAYMENT → PAID → BOOKING → BOOKED → LABEL_READY (polling the status endpoint or the event stream, bounded wait 20 s) |
| 3 | Inspect the Mock carrier call counter (test-only Mock admin endpoint, `APP_ENV=test`) | `createShipment` called exactly once; the job ran in the worker (worker log line with the same correlation ID) |
| 4 | Replay the identical request with the same key | Same order, same status and body; no second booking; Mock counter still 1 |

AT IDs: AT-US-202-01, AT-US-203-*, AT-US-038-*. Guardrails: 0 duplicate label, 0 captured without shipment.

### J-M0-04 Audit entries appear in the viewer (PRD §6.1 scenario 4) `@demo-m0 @critical`

| Step | Action | Assertions |
|---|---|---|
| 1 | After J-M0-01..03 (same organisation), the seeded Compliance Auditor signs in to admin with TOTP | |
| 2 | Filter by the customer's organisation and today's date, apply | Results include LOGIN, quote CREATE, shipment CREATE and every state transition, each with actor, IP, outcome; the chain chip shows "Verified" |
| 3 | Open one entry | Detail with diff, `[REDACTED]` markers where applicable, previous and entry hashes |
| 4 | Filter for the auditor's own actions | The auditor's VIEW of the audit log is recorded |
| 5 | Mobile project | Table renders as cards; no horizontal scroll |

AT IDs: AT-US-097-*, AT-US-098-*, AT-US-092-*. Data dependency: the journey seeds its own organisation and actions in a `beforeAll` (it does not depend on test order).

### J-M0-05 Generators pass (PRD §6.1 scenario 5), evidence-linked

Not a browser journey. Satisfied when the gate evidence shows `rbac-matrix` (100 % route × role, count = catalogue × roles) and `audit-generator` (every mutating route exactly one entry in-transaction) plus `audit-immutability` (every DB role) green. The gate report links the three JUnit files.

### J-M1-01 Book and pay a shipment end to end with `<carrier>` (PRD §6.2 outline) `@demo-m1 @critical`

Examples: `DHL_EXPRESS`, `FEDEX`, `UPS` (fixture-backed). Matrix at `gate`: 3 carriers × 3 locales (en, es, fr) × 6 projects = **54 runs**. At `wave`: 3 carriers × en × 6 projects + es/fr on Chromium. At `pr`: `DHL_EXPRESS`, en, Chromium mobile and desktop.

| # | PRD §6.2 step | Actions | Assertions | AT IDs (examples) |
|---|---|---|---|---|
| 1 | Guest on home requests a quote US 10001 → IN 400001, parcel, 2 kg, 30 × 20 × 10 cm | Open `/<lng>/` (pre-rendered), fill the widget, submit | Widget usable before hydration; live billable weight; navigates to `/quote/<id>` without the guest token in the URL | AT-US-158-*, AT-US-157-*, AT-US-109-* |
| 2 | Results stream in, sorted by cheapest, with Cheapest and Fastest badges | Wait for results | Skeletons replaced in place (CLS ≤ 0.1 via PerformanceObserver); sort order; badges as text; per-carrier status in the `complete` event; screen-reader live region polite | AT-US-159-*, AT-US-160-*, AT-US-161-*, AT-US-135-* |
| 3 | Guest selects the `<carrier>` service and is asked to register or sign in | Click "Select" | Auth gate keeps quote and option; `returnUrl` same-origin | AT-US-171-* |
| 4 | Register, verify e-mail via the mail catcher, return to the wizard with the quote claimed | Register (paste allowed), fetch the verification mail from Mailpit (in the active locale), open the `#token=` link | Signed in; wizard step 1; quote claimed; the guest `qt:` entry removed from `localStorage` (SEC-TC-54) | AT-US-015-*, AT-US-016-*, AT-US-166-* |
| 5 | Complete sender and receiver, customs lines with an HS code, pickup date and window, extras, review and basket | Steps 1–5; HS code search; pickup picker | Country-driven address layout; customs line with HS code accepted; prohibited-items check passes; pickup date rules; review shows itemised price; edit-back works; basket of 1 | AT-US-175-*, AT-US-180-*, AT-US-181-*, AT-US-182-*, AT-US-189-*, AT-US-234-*, AT-US-191-*, AT-US-192-* |
| 6 | Pay with a test card including a 3-D Secure challenge | Mock hosted fields with `mock_3ds`; complete the simulated challenge frame (keyboard-operable) | "Test mode" label visible (not colour-only); amount in sell currency; `livemode: false` in payment responses | AT-US-214-01/02/03/04, AT-US-212-* |
| 7 | Order PAID; shipment BOOKED then LABEL_READY with a `<carrier>` label and a commercial invoice PDF | Booking progress screen | Progress announced; confirmation page on LABEL_READY; label and invoice downloadable (pre-signed URL, TTL ≤ 300 s, audited) and the PDF opens | AT-US-207-*, AT-US-195-*, AT-US-222-*, AT-US-186-*, AT-US-225-* |
| 8 | Pickup reference shown; confirmation e-mail with documents in the user's locale | Read Mailpit | Pickup reference on the confirmation page; e-mail subject/body in the active locale; documents attached or linked per D-051 | AT-US-235-*, AT-US-283-*, AT-US-280-* |
| 9 | Public tracking page shows the tracking number with status and city-level location only | Open the tracking link signed out | Only status, timestamps, city-level location; DOM and API response contain no name, street, e-mail, phone or reference (allow-list) | AT-US-247-*, AT-US-248-* |
| 10 | Account shipment list shows the order with charges, documents and timeline | Sign back in; open the list and detail | Order present; charges equal the review; documents listed; timeline ordered | AT-US-254-*, AT-US-255-* |
| 11 | Post-checks | Request-body recorder + container logs + DB dump | PAN scanner: 0 Luhn-valid 13–19 digit numbers (NFR-SEC-013); no tokens in logs (SEC-TC-28) | SEC-TC-28 |

### J-M1-01L Real sandbox label (PRD §6.2 COND-SANDBOX-DEMO) `@live-sandbox`

- **Preconditions:** carrier sandbox credentials for DHL Express, FedEx and UPS and a Stripe test key (`rk_test_`) supplied as user-scoped environment variables or `.env.local` (never committed; hosted only through the `carrier-sandbox` environment of `nightly.yml`).
- **Command:** `CARRIER_LIVE_SANDBOX=1 STRIPE_TEST_LIVE=1 npx --no-install playwright test --grep @live-sandbox` (with the CLAUDE.md §2 PATH prefix locally).
- **Runs:** J-M1-01 steps 1–10 per carrier on `chromium-mobile` and `chromium-desktop` in en (one phone, one desktop, as the brief's M1 demo states), with the real Stripe Payment Element and Stripe's documented 3DS-required test card.
- **Assertions:** each carrier returns a real sandbox label (non-fixture tracking number format, label bytes from the sandbox), the PaymentIntent is authorised and then captured after carrier confirmation, the order reaches LABEL_READY.
- **Covers:** AT-US-131-09, AT-US-132-*, AT-US-133-* (live scenarios), AT-US-214-09, AT-US-222 (`@live-sandbox` scenario), AT-US-137 (live opt-in).
- **Status:** not part of G3/G4 in this run; recorded as the post-release condition COND-SANDBOX-DEMO. Without credentials the command prints "Live sandbox credentials not configured (D-003); skipping" and exits 0; that output is not evidence of anything.

### J-M1-02 Degraded carriers: partial results with a named notice (NFR-RES-006) `@critical`

| Variant | Mock setup | Assertions |
|---|---|---|
| a | One carrier `error`, others `fast` | Remaining cards shown; notice names the unavailable carrier; `complete` lists it as `failed` |
| b | One carrier `hung` | Results from the others arrive; done ≤ 5 s; notice names the timed-out carrier (`timed_out`) |
| c | All carriers `hung` | Done ≤ 5 s; empty-with-reason state; retry offered |
| d | Booking on a carrier whose breaker is open | Stable error code (`CARRIER_UNAVAILABLE`); no charge captured (Mock gateway counter) |

Locales en, es, fr (notice text from i18n keys); 6 projects at gate. AT IDs: AT-US-126-*, AT-US-160-*, AT-US-130-*.

### J-M1-03 Payment failure paths `@critical`

| Variant | Setup | Assertions |
|---|---|---|
| a | `mock_3ds_fail` | "Authentication failed" with retry; order stays PENDING_PAYMENT; retry with `mock_3ds` succeeds |
| b | `mock_decline` | Decline message; attempt counted; after the attempt limit → limit message (US-212) |
| c | Double click on Pay | One authorisation (same `Idempotency-Key`) |
| d | Gateway unavailable | Error state with retry; order PENDING_PAYMENT or back to QUOTED |
| e | Unverified e-mail at checkout | Checkout gate blocks payment, offers resend; after verification the user resumes at review (US-208) |

AT IDs: AT-US-212-*, AT-US-214-05/06, AT-US-208-*. 6 projects at gate, en.

### J-M1-04 Public tracking `@critical`

| Variant | Assertions |
|---|---|
| a | Lookup by tracking number and by order number → status, timestamps, city-level location; timeline as an ordered list |
| b | Unknown or malformed number (Luhn failure) → not-found state, no stack or detail leakage |
| c | Rate limit → retry time shown, button re-enabled after `Retry-After` (limit lowered by config for the test) |
| d | Pre-rendered shell works with the query parameter (D-UX-029); `noindex` header for result URLs |

AT IDs: AT-US-247-*, AT-US-248-*, AT-US-249-*. 6 projects, en/es/fr at gate on Chromium.

### J-M1-05 Expired quote and re-quote `@critical`

Setup: test-data CLI creates a claimed quote with `expires_at` in the past and a draft shipment. Assertions: results page shows the expired state with absolute times and a one-action re-quote; re-quote keeps the route and packages; a rate-relevant change in wizard step 1 creates a new quote (US-168); the draft resumes from the account drafts list. AT IDs: AT-US-167-*, AT-US-168-*, AT-US-172-*, AT-US-256-*.

### J-M1-06 Account: shipments, detail and document re-download `@critical`

Setup: a user with 30 shipments in mixed states (factory), plus one shipment of another organisation. Assertions: list with search, filters and cursor pagination (no duplicates across pages); detail with timeline, charges, documents and tracking; re-download issues a fresh pre-signed URL (TTL ≤ 300 s) and writes an audit entry; a Viewer sees documents but gets a permission-denied state for actions they lack; the other organisation's shipment URL shows not-found; mobile project shows cards. AT IDs: AT-US-254-*, AT-US-255-*, AT-US-224-*, AT-US-225-*, AT-US-257-*.

## 4. Supporting journeys

### J-SEC-01 Admin idle timeout (SEC-TC-39) `@security`

Signed-in staff, `page.clock` installed. No input for 28 min → warning `alertdialog` shown; background refetches continue but do not reset the idle clock; at 30 min silent refresh stops, logout is called, the sign-in page is shown with `returnUrl`. A server-side check (API suite) rejects an admin refresh token idle > 30 min. Projects: 3 engines desktop.

### J-SEC-02 Token hygiene (SEC-TC-09, SEC-TC-28, SEC-TC-54) `@security`

Flows: e-mail verification, password reset (F07), guest quote → claim → sign-out → 404 → expiry sweep, share (if US-165 ships), invitation (if US-084 ships). Assertions: tokens only in the URL fragment, cleared after use; never in `history.state`, `Referer` of outgoing requests, Nginx/API logs or OTel output; `localStorage` holds no `qt:` entry after claim, sign-out, 404 or expiry, and at most 20 entries on app start; the refresh cookie is accepted by all three engines. Projects: 6.

### J-KB-01..09 Keyboard-only variants (NFR-A11Y-003) `@keyboard`

No pointer events (mouse and touch disabled); Tab, Shift+Tab, Enter, Space, arrows and Escape only. Each journey also runs the Tab sweep (focus visible ≥ 2 px and ≥ 3:1, not obscured by sticky header or sticky mobile action bar, skip link first, 0 traps). Projects: `chromium-desktop`, `firefox-desktop`, `webkit-desktop` at gate.

| ID | Journey | Based on |
|---|---|---|
| J-KB-01 | Customer sign-in | J-M0-01 steps 4–5 |
| J-KB-02 | Guest quote and compare | J-M1-01 steps 1–2 |
| J-KB-03 | Register | J-M1-01 step 4 |
| J-KB-04 | Booking wizard steps 1–5 | J-M1-01 step 5 |
| J-KB-05 | Pay (incl. the 3DS frame) | J-M1-01 step 6 |
| J-KB-06 | Label download | J-M1-01 step 7 |
| J-KB-07 | Track | J-M1-04 a |
| J-KB-08 | Staff sign-in with TOTP | J-M0-01 steps 1–3 |
| J-KB-09 | Audit viewer filter and entry detail | J-M0-04 steps 2–3 |

## 5. Gate matrix summary

| Journey | Projects | Locales | Variants | Runs at `gate` |
|---|---|---|---|---|
| J-M0-01 | 6 | en (+ es, fr on Chromium ×2) | 1 | 10 |
| J-M0-02 | 6 | en | 1 | 6 |
| J-M0-03 | 6 | en | 1 | 6 |
| J-M0-04 | 6 | en (+ es, fr on Chromium ×2) | 1 | 10 |
| J-M1-01 | 6 | en, es, fr | 3 carriers | 54 |
| J-M1-02 | 6 | en (+ es, fr on Chromium ×2) | 4 | 40 |
| J-M1-03 | 6 | en | 5 | 30 |
| J-M1-04 | 6 | en (+ es, fr on Chromium ×2) | 4 | 40 |
| J-M1-05 | 6 | en | 1 | 6 |
| J-M1-06 | 6 | en | 1 | 6 |
| J-SEC-01 | 3 desktop | en | 1 | 3 |
| J-SEC-02 | 6 | en | 1 | 6 |
| J-KB-01..09 | 3 desktop | en | 9 | 27 |
| **Total** | | | | **≈ 244** |

At an estimated 40–90 s per run with 4 Playwright workers, the gate e2e set takes ≈ 60–90 min on the developer host, inside the `gate` profile budget (ADR-0023 amendment A: 2–3 h). Lane C runs the same set sharded per browser.

## 6. Exit-demo traceability

| PRD step | Journey step | Evidence |
|---|---|---|
| §6.1 Background (single `docker compose up`, Mock only) | Stack setup (§2) | `compose-up.json` |
| §6.1 S1 Staff and customer sign-in | J-M0-01 | `e2e-*.junit.xml` |
| §6.1 S2 Guest mock quote | J-M0-02 (+ k6 `sse` for ≤ 1.5 s) | `e2e-*.junit.xml`, `k6-sse.summary.json` |
| §6.1 S3 Mock booking API → queue → worker | J-M0-03 | `e2e-*.junit.xml` |
| §6.1 S4 Audit entries in the viewer | J-M0-04 | `e2e-*.junit.xml` |
| §6.1 S5 Generators pass | J-M0-05 | `rbac-matrix.junit.xml`, `audit-generator.junit.xml`, `audit-immutability.junit.xml` |
| §6.2 Background (fixture-backed carriers and Stripe; 360/1280 in en, es, fr) | Project and locale matrix | Gate run |
| §6.2 Outline steps 1–10 × 3 carriers | J-M1-01 | `e2e-*.junit.xml` |
| §6.2 Real sandbox label | J-M1-01L | `e2e-live.junit.xml`, `contract-live.junit.xml` when credentials exist (post-release) |
