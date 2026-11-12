# EPIC-05 — Design system, app shells, i18n and accessibility

- **Goal:** Every screen in both apps is consistent, responsive, accessible to WCAG 2.2 AA and fully available in English, Spanish and French from the first string shipped.
- **Milestone(s):** M0+M1
- **REQ areas covered:** REQ-UI, REQ-I18N (every REQ in these areas is linked by at least one story below)
- **Exit-demo contribution:** PRD §6.1 M0 exit demo: both app shells with locale switch, en/es/fr for shipped strings, six screen states, responsive 360/1280 px, a11y (axe zero serious), guest home page with quote hero. M1: sticky CTA, pre-rendered public pages, cookie banner, address layout, currency switcher.
- **Depends on epics:** EPIC-01 (PLAT: monorepo, CI, lint pipeline), EPIC-02 (AUTH/ADMIN: sign-in, user preferences), EPIC-03 (permissions for gating), EPIC-07/08 (QUOTE content for the hero), EPIC-17 (DATA: country, address and FX reference data), EPIC-15 (NOTIF: system messages)

## Story summary

| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs |
|---|---|---|---|---|---|---|
| US-101 | Design tokens and token lint | M0 | Must | S | EPIC-01 | REQ-UI-001 |
| US-102 | Light and dark themes with contrast verification | M0 | Must | M | US-101 | REQ-UI-002 |
| US-103 | Control sizing, interaction states and reduced motion | M0 | Must | M | US-101 | REQ-UI-003, REQ-UI-004, REQ-UI-005 |
| US-104 | Six screen states through shared components | M0 | Must | M | US-103, US-115 | REQ-UI-006, REQ-UI-007 |
| US-105 | Offline handling and outcome toasts | M0 | Must | M | US-104 | REQ-UI-008, REQ-UI-009 |
| US-106 | Inline form validation and semantic markup | M0 | Must | M | US-103, US-115 | REQ-UI-010, REQ-UI-022 |
| US-107 | Responsive layout, no horizontal scroll, table-to-card | M0 | Must | M | US-103 | REQ-UI-011, REQ-UI-012 |
| US-108 | Customer web shell | M0 | Must | M | US-107, US-117 | REQ-UI-013 |
| US-109 | Home quote hero and sticky mobile action bar | M1 | Must | M | US-108, EPIC-07 | REQ-UI-014, REQ-UI-015 |
| US-110 | Admin shell | M0 | Must | M | US-107, US-117, US-070 | REQ-UI-016 |
| US-111 | Table density and route-level code splitting | M1 | Should | S | US-110, US-107 | REQ-UI-017, REQ-UI-018 |
| US-112 | Pre-rendered public pages per locale | M1 | Must | M | US-108, US-117 | REQ-UI-019 |
| US-113 | Accessibility gate: axe scans and keyboard operability | M0 | Must | M | US-104, US-106 | REQ-UI-020, REQ-UI-021 |
| US-114 | Cookie consent banner | M1 | Should | M | US-112, EPIC-17 | REQ-UI-023 |
| US-115 | Localisable strings, en/es/fr parity and ICU messages | M0 | Must | M | EPIC-01 | REQ-I18N-001, REQ-I18N-002, REQ-I18N-003, REQ-I18N-013 |
| US-116 | Locale-aware formatting, time zones and collation | M0 | Must | M | US-115 | REQ-I18N-004, REQ-I18N-011, REQ-I18N-014 |
| US-117 | Locale resolution, persistence and system-message locale | M0 | Must | M | US-115, EPIC-02, EPIC-15 | REQ-I18N-006, REQ-I18N-007, REQ-I18N-008 |
| US-118 | Display currency switcher | M1 | Should | S | US-108, EPIC-17 | REQ-I18N-012 |
| US-119 | Country-driven address layout | M1 | Must | M | US-116, EPIC-17 | REQ-I18N-005 |
| US-120 | Pseudo-locale overflow tests and logical CSS | M0 | Must | M | US-115, US-107 | REQ-I18N-009, REQ-I18N-010 |

## Stories

### US-101 — Design tokens and token lint
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** EPIC-01
- **Linked REQs:** REQ-UI-001
- **As a** developer **I want** colour, typography, spacing, radius, elevation and motion tokens as CSS variables **so that** both apps look consistent and themable.
- **Notes:** 4/8 px grid. Per-tenant theming UI is out of scope (data model only).

#### Acceptance criteria
```gherkin
Feature: Design tokens
  Scenario: Both apps consume tokens
    Then the web and admin builds expose the tokens from packages/ui as CSS variables (for example --space-2 = 8px)

  Scenario: Hard-coded colour fails lint
    Given feature code contains "#ff0000" or "rgb(0,0,0)" Then lint fails naming file and line

  Scenario: Off-grid spacing fails lint
    Given feature code contains "margin: 13px" Then lint fails

  Scenario: Tenant override
    Given a tenant theme override value for the primary colour Then the variable resolves to the override without code change

  Scenario: Permission path: not applicable — build tooling has no principal. Second negative: unknown token
    Given code references var(--colour-nonexistent) Then the style lint fails
```

### US-102 — Light and dark themes with contrast verification
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-101
- **Linked REQs:** REQ-UI-002
- **As a** user **I want** light and dark themes that follow my system and can be toggled **so that** the interface is comfortable and readable.
- **Notes:** Toggle persisted per user (guests: per browser). Contrast 4.5:1 text under 24 px, 3:1 for large text and UI components. Colour never the only meaning.

#### Acceptance criteria
```gherkin
Feature: Themes
  Scenario: First visit follows system
    Given prefers-color-scheme: dark and no stored choice Then the dark theme renders

  Scenario: Manual toggle persisted
    When a signed-in user toggles to light Then the choice is stored on their profile and applies after sign-in on another device; a guest's choice persists in the browser

  Scenario: Contrast test
    Then every text and UI token pair in both themes meets 4.5:1 (3:1 for large text and components) and a failing pair fails CI naming the pair

  Scenario: Colour-only meaning
    Then a status badge always carries an icon or text in addition to colour

  Scenario: Toggle operable
    Then it is reachable by keyboard, announced with its state, labelled in en, es and fr, and axe reports zero serious violations in both themes at 360 px and 1280 px

  Scenario: Permission path: not applicable — theming is available to all principals. Second negative: stored value invalid
    Given the stored theme is "purple" Then the system falls back to system preference
```

### US-103 — Control sizing, interaction states and reduced motion
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-101
- **Linked REQs:** REQ-UI-003, REQ-UI-004, REQ-UI-005
- **As a** user on any device **I want** comfortable targets, clear states and respect for reduced motion **so that** the UI is usable and not disorienting.
- **Notes:** 14 px base; 36 px control height on `pointer: fine`; 44 x 44 px on `pointer: coarse`; transitions 120–180 ms; focus indicator at least 2 px with 3:1 contrast; hover only inside `@media (hover: hover)`.

#### Acceptance criteria
```gherkin
Feature: Interaction foundation
  Scenario: Pointer sizes
    Given pointer emulation fine Then shared controls measure at least 36 px high; under coarse emulation at least 44 x 44 CSS px

  Scenario: All states exist
    Then each interactive component has distinct default, hover, focus-visible, active, disabled and loading appearances

  Scenario: Hover only on hover devices
    Given pointer emulation coarse Then no hover styling applies

  Scenario: Focus indicator
    Then the focus ring is at least 2 px with 3:1 contrast against adjacent colours in both themes

  Scenario: Reduced motion
    Given prefers-reduced-motion: reduce Then computed transition duration on shared components is about 0 ms and no autoplaying motion starts

  Scenario: Disabled and loading controls
    Then a disabled control is not focusable by activation and a loading button exposes aria-busy and ignores repeat activation

  Scenario: Permission path: not applicable — presentational. Second negative: transition outside range
    Given a component uses a 400 ms transition Then the style lint fails
```

### US-104 — Six screen states through shared components
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-103, US-115
- **Linked REQs:** REQ-UI-006, REQ-UI-007
- **As a** user **I want** every data screen to show clear loading, empty, error, partial, permission-denied and offline states **so that** I always know what is happening and what to do next.
- **Notes:** Skeleton after 150 ms; swap CLS at most 0.1; no spinner except inside buttons; error shows retry and correlation ID; permission-denied for 403 `AUTHZ_DENIED` and route-guard denials (not for 404, which shows not-found); no hint of resource existence.

#### Acceptance criteria
```gherkin
Feature: Screen states
  Scenario: Loading
    Given data takes 800 ms Then a skeleton sized like the final content appears after 150 ms and the swap causes CLS <= 0.1

  Scenario: Empty
    Then an explanatory message and a next-step action are shown

  Scenario: Error
    Given the API returns 500 "INTERNAL_ERROR" with correlation_id Then an error state with a Retry action and the correlation ID is shown, and Retry reissues the request

  Scenario: Partial
    Given one of two data sources fails Then available data shows with a notice naming what failed

  Scenario: Permission-denied
    Given a 403 "AUTHZ_DENIED" Then the state states the user lacks access, shows no data or resource hint, and offers "Go home" and "Switch organisation"; a 404 instead shows not-found

  Scenario: Render exception
    Given a component throws Then the error boundary shows the error state, not a blank page

  Scenario: Per-route checklist
    Then a route without all six states fails the UI checklist test

  Scenario: Locales and viewports
    Then all six states render in en, es and fr at 360 px and 1280 px with zero serious axe violations

  Scenario: Permission denied is localised
    Given a Viewer opens a guarded route Then the text comes from an i18n key and no data request was issued
```

### US-105 — Offline handling and outcome toasts
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-104
- **Linked REQs:** REQ-UI-008, REQ-UI-009
- **As a** user on a poor connection **I want** to be told when I am offline and keep my input **so that** I do not lose work.
- **Notes:** EC-A37. No offline write queue. Toasts: `role="status"` polite, `role="alert"` for errors; success and info dismiss after 5 s; error until dismissed; at most 3 stacked; pause on hover and focus.

#### Acceptance criteria
Permission path: not applicable — client-side offline and toast behaviour; no server permission involved
```gherkin
Feature: Offline and toasts
  Scenario: Offline banner
    When the browser goes offline Then an offline banner appears within 3 s, entered form data is retained and submit actions needing the network are disabled

  Scenario: Back online
    When connectivity returns Then the banner clears and a Retry is offered

  Scenario: In-flight request fails
    Given a submit in flight when connectivity drops Then the error state with retry is shown and nothing is queued

  Scenario: Toast timing
    Then a success toast auto-dismisses after 5 s, an error toast stays until dismissed, and a 4th toast evicts the oldest so at most 3 show

  Scenario: Toast pause
    When the pointer hovers or focus enters a toast Then its dismissal timer pauses

  Scenario: Assistive announcement
    Then success and info toasts use role="status" and errors use role="alert"

  Scenario: Critical info is never toast-only
    Then an order number shown in a toast also appears on screen

  Scenario: Locales and viewports
    Then offline and toast text renders in en, es and fr at 360 px and 1280 px
```

### US-106 — Inline form validation and semantic markup
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-103, US-115
- **Linked REQs:** REQ-UI-010, REQ-UI-022
- **As a** user **I want** forms that explain errors beside the field and are properly labelled **so that** I can fix problems quickly, including with a screen reader.
- **Notes:** Zod on the client; server `errors[]` pointers mapped to fields; messages from `errors.<CODE>` keys. One `h1` per page; `lang` equals the active locale.

#### Acceptance criteria
```gherkin
Feature: Forms and semantics
  Scenario: Inline validation on blur
    When a user leaves the email field with "abc" Then the message appears beside the field linked by aria-describedby and the field has aria-invalid="true"

  Scenario: Submit moves focus
    When invalid fields remain on submit Then focus moves to the first invalid field and a summary lists all errors

  Scenario: Server errors mapped
    Given the API returns 400 "VALIDATION_ERROR" with a pointer "/address/postcode" Then the message shows on the Postcode field in the active locale

  Scenario: Not colour alone
    Then invalid fields show text and icon in addition to colour

  Scenario: Labels and headings
    Then every control has a programmatically associated visible label (placeholder never the only label), each page has exactly one h1 with ordered headings, informative images have alt text and icon-only buttons have an accessible name from an i18n key

  Scenario: Document language
    When the locale is "fr" Then the html lang attribute is "fr"

  Scenario: Permission denied on submit
    Given the API returns 403 "AUTHZ_DENIED" Then the permission-denied message shows without exposing field errors

  Scenario: Locales and viewports
    Then messages exist in en, es and fr and the summary is usable at 360 px and 1280 px
```

### US-107 — Responsive layout, no horizontal scroll, table-to-card
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-103
- **Linked REQs:** REQ-UI-011, REQ-UI-012
- **As a** mobile user **I want** every screen to work at 360 px and up **so that** I can use the product on my phone.
- **Notes:** Breakpoints 360, 768, 1024, 1280, 1536 px. Reflow at 400% zoom (320 CSS px). Table at 768 px and wider, stacked card list below, same fields and priority order. Only explicit regions (code blocks) may scroll horizontally.

#### Acceptance criteria
```gherkin
Feature: Responsive layout
  Scenario: No horizontal scroll
    Given viewports 360, 768, 1024, 1280 and 1536 px Then document scrollWidth equals clientWidth on every page

  Scenario: 400% zoom reflow
    Given an effective width of 320 CSS px Then content reflows with no two-dimensional scrolling and all functions remain available

  Scenario: Table at 768 px
    Then the shared data component renders a table with sortable headers, filters and pagination

  Scenario: Cards at 360 px
    Then it renders stacked cards with the same fields in the same order, and sort, filter and pagination controls stay usable

  Scenario: Permission path: not applicable — layout is principal-independent. Second negative: oversized content
    Given a 200-character unbroken value Then it wraps or truncates with accessible full text and causes no horizontal page scroll
```

### US-108 — Customer web shell
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-107, US-117
- **Linked REQs:** REQ-UI-013
- **As a** shipper **I want** a consistent header, navigation and footer **so that** I can navigate, change language and sign in on any device.
- **Notes:** Brand logo and name from `BRAND_*` configuration (never a literal). Skip-to-content is the first focusable element. Navigation collapses to a menu button below 768 px. Switchers persist choices (US-117, US-118).

#### Acceptance criteria
```gherkin
Feature: Web shell
  Scenario: Header and footer content
    Given 1280 px When the home page loads Then the header shows brand logo and name, primary navigation, language switcher (en, es, fr), currency switcher and a sign-in link; the footer shows legal links

  Scenario: Skip link
    When a keyboard user presses Tab on load Then the first focused element is "Skip to content" and activating it moves focus to main

  Scenario: Mobile navigation
    Given 360 px Then navigation is behind a menu button with aria-expanded, opens as a dialog-like menu, closes on Escape and returns focus to the button

  Scenario: Locale switch
    When the user selects "Español" Then all shell text re-renders in es, html lang is "es" and the choice persists on reload

  Scenario: Signed-in menu
    Given the customer Owner is signed in Then the account menu replaces sign-in and shows only items permitted by their permissions

  Scenario: Permission denied
    Given a Viewer Then navigation entries needing unavailable permissions are absent from the accessibility tree

  Scenario: States
    Then the shell shows the offline banner, and a failed /me call shows the error state without losing the header

  Scenario: Brand from configuration
    Given BRAND_NAME is changed Then the header updates with no code change and lint fails on a literal brand string

  Scenario: Accessibility
    Then axe reports zero serious or critical violations in both themes at 360 px and 1280 px
```

### US-109 — Home quote hero and sticky mobile action bar
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-108, EPIC-07
- **Linked REQs:** REQ-UI-014, REQ-UI-015
- **As a** guest shipper **I want** the quote widget immediately on the home page, and a persistent main action on mobile flows **so that** I can get a price and continue without hunting for buttons.
- **Notes:** Widget fields and behaviour belong to EPIC-07. The pre-rendered page ships the widget shell, interactive after hydration without layout shift. Sticky bar below 768 px respects safe-area insets and is hidden when the keyboard covers an input.

#### Acceptance criteria
```gherkin
Feature: Quote hero and sticky bar
  Scenario: Hero above the fold
    Given viewports 360 x 640 and 1280 x 720 Then the quote widget occupies the first screen without scrolling and is the first interactive element after the shell

  Scenario: No layout shift
    Then CLS during hydration of the widget is at most 0.1

  Scenario: Sticky bar on mobile
    Given 360 px in the booking review Then the primary action bar is fixed at the bottom, respects safe-area insets and does not hide the end of the page content

  Scenario: Bar never covers focus
    When a lower input receives focus Then the bar does not overlap it and is hidden if the on-screen keyboard would cover the input

  Scenario: Not shown on desktop
    Given 1280 px Then no sticky bar is rendered

  Scenario: Locales
    Then hero and bar labels render in en, es and fr without clipping

  Scenario: Permission path
    Given an unauthenticated guest Then the hero is available without sign-in, while the sticky bar on an authenticated step shows permission-denied if the action requires "shipment:create" the user lacks
```

### US-110 — Admin shell
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-107, US-117, US-070
- **Linked REQs:** REQ-UI-016
- **As a** staff user **I want** a sidebar, breadcrumbs and header with language switcher **so that** I can reach what I am permitted to use.
- **Notes:** Sidebar 240 px expanded, 64 px collapsed, persisted per user; drawer below 1024 px; landmarks `banner`, `navigation`, `main`; entries filtered by permission; no entries for unimplemented modules (REQ-ADMIN-009); admin is client-rendered only.

#### Acceptance criteria
```gherkin
Feature: Admin shell
  Scenario: Layout at 1280 px
    Given the Super Admin signs in Then a 240 px sidebar, breadcrumb trail and a header with user menu and language switcher are shown; the audit log entry is in the sidebar

  Scenario: Collapse persisted
    When the sidebar is collapsed Then it is 64 px wide and remains collapsed after reload and on another device

  Scenario: Drawer below 1024 px
    Given 360 px Then the sidebar is a drawer opened by a button, trapped focus inside, closed by Escape with focus returned to the trigger

  Scenario: Entries filtered by permission
    Given a user holding no "audit:read" Then the "Audit log" entry is absent from the accessibility tree and a direct visit shows the permission-denied state

  Scenario: Unimplemented modules
    Then no navigation entry or placeholder exists for orders, customers, carriers, pricing, finance, reports or settings, and their paths show the not-found state

  Scenario: Locale switch in the header
    When the user chooses "Français" Then the shell re-renders in fr and the preference is stored on the profile with an audited "UPDATE"

  Scenario: Landmarks and states
    Then banner, navigation and main landmarks exist and loading, error, offline and permission-denied states render inside the shell

  Scenario: Accessibility
    Then axe reports zero serious or critical violations at 360 px and 1280 px in both themes
```

### US-111 — Table density and route-level code splitting
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-110, US-107
- **Linked REQs:** REQ-UI-017, REQ-UI-018
- **As a** staff user **I want** a compact table density option **so that** I can see more rows; and as a visitor I want fast first load.
- **Notes:** Density is Could (comfortable 48 px, compact 36 px rows); bundle budget is Should: initial JavaScript of the pre-rendered home page at most 170 KB gzipped (ASSUMED).

#### Acceptance criteria
```gherkin
Feature: Density and bundle budget
  Scenario: Compact density
    When the auditor selects Compact Then audit rows are 36 px high (from 48 px) and the choice persists per user

  Scenario: Density hidden on mobile cards
    Given 360 px Then the density control is not shown because cards are used

  Scenario: Route-level splitting
    Then each route's code loads on demand and the admin audit route chunk is not requested on the sign-in page

  Scenario: Budget exceeded
    Given initial home-page JavaScript is 171 KB gzipped Then the CI bundle check fails

  Scenario: Permission path: not applicable — presentational preference. Second negative: invalid stored density
    Given the stored value is "huge" Then the default Comfortable applies
```

### US-112 — Pre-rendered public pages per locale
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-108, US-117
- **Linked REQs:** REQ-UI-019
- **As a** visitor arriving from search **I want** fast, indexable public pages in my language **so that** I can find and trust the service.
- **Notes:** D-026. Home, public tracking page shell, prohibited-items lookup, terms, privacy and help placeholder pages, once per locale (en, es, fr), with unique title, meta description, canonical URL and `hreflang` alternates. Authenticated routes client-rendered; no user data server-rendered; admin never pre-rendered.

#### Acceptance criteria
```gherkin
Feature: Pre-rendered pages
  Scenario: HTML without JavaScript
    Given JavaScript is disabled When "/es/" is requested Then the response HTML contains the localised static content, a unique title, meta description, canonical URL and hreflang alternates for en, es and fr

  Scenario: Every public page per locale
    Then 6 pages x 3 locales are emitted at build time

  Scenario: Locale precedence
    When "/fr/" is the first load Then fr is active regardless of Accept-Language and the language switcher then sets the cookie

  Scenario: Authenticated routes are not rendered with data
    Then the HTML of "/account/shipments" contains no user data and the page client-renders after sign-in

  Scenario: Admin
    Then admin responses are client-rendered with "X-Robots-Tag: noindex, nofollow"

  Scenario: Missing translation
    Given a page key missing in es Then the build fails

  Scenario: Permission path
    Given an unauthenticated visitor opens "/account" Then they are redirected to sign-in with a return URL; public pages declare permission "public"

  Scenario: States and accessibility
    Then loading, error and offline states work on the tracking shell and axe reports zero serious violations at 360 px and 1280 px
```

### US-113 — Accessibility gate: axe scans and keyboard operability
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-104, US-106
- **Linked REQs:** REQ-UI-020, REQ-UI-021
- **As a** user relying on assistive technology **I want** every page and state to meet WCAG 2.2 AA **so that** I can use the product independently.
- **Notes:** Axe runs in the end-to-end suite on every page and each reachable state, in both themes, at mobile and desktop viewports. Minor and moderate findings tracked, not ignored.

#### Acceptance criteria
```gherkin
Feature: Accessibility gate
  Scenario: Axe zero serious or critical
    Given each page and each reachable screen state of both apps in light and dark at 360 px and 1280 px Then axe-core reports 0 serious and 0 critical violations

  Scenario: Violation fails CI
    Given a page with an unlabeled input Then the e2e run fails listing page, state and rule

  Scenario: Keyboard-only journeys
    Then the sign-in journey (and the quote journey for web) is completable using only the keyboard with logical focus order matching visual order

  Scenario: Dialogs and menus
    When a dialog opens Then focus moves into it, Tab does not escape, Escape closes it and focus returns to the trigger

  Scenario: No keyboard trap
    Then Tab and Shift+Tab can leave every component

  Scenario: Permission path
    Given the permission-denied and not-found states Then they too pass axe and are keyboard operable

  Scenario: Locales
    Then the axe and keyboard checks run in en, es and fr
```

### US-114 — Cookie consent banner
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-112, EPIC-17
- **Linked REQs:** REQ-UI-023
- **As a** visitor **I want** a clear choice about cookies **so that** my privacy preferences are respected.
- **Notes:** D-027, EC-A47. Categories `necessary`, `preferences`, `analytics`, `marketing`; `necessary` cannot be declined. Consent rule version from the compliance pack; `NOTICE_ONLY` shows an informational notice. No analytics or marketing scripts exist in M1 (GAP-A-16), so declining changes only the stored record.

#### Acceptance criteria
```gherkin
Feature: Cookie consent
  Scenario: First visit
    Given no stored decision Then the banner shows "Accept all", "Reject non-essential" and "Customise" with equal visual prominence and no non-essential storage or script has loaded

  Scenario: Accept and reject recorded
    When the visitor chooses "Reject non-essential" Then a consent record is stored with categories, consent-rule version, timestamp and an anonymous identifier and the banner closes

  Scenario: Customise
    Then toggles exist for preferences, analytics and marketing, and "necessary" is on and cannot be switched off

  Scenario: Reopen from footer
    When the visitor activates "Cookie settings" in the footer Then the choice dialog reopens with current values

  Scenario: Withdraw after accepting
    Then a new consent record is stored, history is kept, non-essential storage is cleared and the banner stays closed until the consent-rule version changes

  Scenario: NOTICE_ONLY rule
    Given the resolved rule is NOTICE_ONLY Then an informational notice is shown instead of choices

  Scenario: Keyboard and accessibility
    Then focus moves into the dialog, Escape does not hide it without a decision being recorded as dismissed-necessary-only, and axe reports zero serious violations

  Scenario: Locales and viewports
    Then text renders in en, es and fr at 360 px and 1280 px without covering the primary content actions

  Scenario: Permission path
    Given an anonymous visitor Then the consent endpoint accepts the record without authentication (descriptor ANONYMOUS, rate limited), and an invalid category returns 400 "VALIDATION_ERROR"
```

### US-115 — Localisable strings, en/es/fr parity and ICU messages
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-01
- **Linked REQs:** REQ-I18N-001, REQ-I18N-002, REQ-I18N-003, REQ-I18N-013
- **As a** Spanish or French speaker **I want** every string available in my language **so that** nothing appears untranslated.
- **Notes:** Keys for text, aria-label, placeholder, title, alt, validation messages, email subject/body. API error text stays English; clients render `errors.<CODE>`. Developer-authored es/fr are acceptable and tracked as pending linguistic review. EC-A36.

#### Acceptance criteria
```gherkin
Feature: i18n keys and parity
  Scenario: Literal string fails lint
    Given a React component contains the literal "Book now" Then lint fails naming file and line

  Scenario: Missing, unused or partial key fails CI
    Given a key present in en and es but absent in fr Then CI fails; likewise an unused key

  Scenario: Placeholder mismatch fails CI
    Given en "Hello {name}" and fr "Bonjour {nom}" Then CI fails

  Scenario: ICU plurals in all locales
    Then the plural test for counts 0, 1, 2 and 1,000,000 passes in en, es (one/many/other) and fr

  Scenario: Concatenation forbidden
    Given code writes t("a") + t("b") Then lint fails

  Scenario: Pending review list
    Then a repository file lists each es and fr namespace with status "pending" and CI prints the pending count

  Scenario: Runtime missing key
    Given a key missing in es in a production build Then the en text shows and a warning is logged once per key

  Scenario: Error codes localised
    When the API returns "AUTHZ_DENIED" Then the UI shows the text for key errors.AUTHZ_DENIED in the active locale

  Scenario: Permission path: not applicable — build tooling has no principal. Second negative: key-name collision across namespaces
    Given two namespaces define the same key with different params Then CI fails
```

### US-116 — Locale-aware formatting, time zones and collation
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-115
- **Linked REQs:** REQ-I18N-004, REQ-I18N-011, REQ-I18N-014
- **As a** user in any locale **I want** numbers, money, dates, units and times in my conventions and time zone **so that** nothing is misread.
- **Notes:** Formatting at the edge only; stored values canonical (API money in integer minor units, UTC ISO 8601 with `Z`). Example: 1234.5 renders `1,234.50` (en), `1.234,50` (es), `1 234,50` with narrow no-break space (fr). DR-A19, EC-A34. Date-only values are never converted.

#### Acceptance criteria
Permission path: not applicable — pure formatting with no principal; the invalid-currency and unknown-locale scenarios are the two negatives.
```gherkin
Feature: Formatting
  Scenario: Number formats
    Then 1234.5 renders "1,234.50" in en, "1.234,50" in es and "1 234,50" (narrow no-break space) in fr

  Scenario: Currency
    Then 123456 minor units of USD render "$1,234.56" (en) and the stored value is unchanged

  Scenario: Units
    Given a canonical 2000 g Then en-US users see "4.41 lb" and metric users "2 kg"; stored canonical value unchanged

  Scenario: Timestamp in viewer zone
    Given an instant 2026-11-12T13:30:00Z and the user's zone Europe/Paris Then it renders "12 Nov 2026, 14:30 CET" (en) with the zone abbreviation or offset shown

  Scenario: DST change
    Given instants either side of the 2027-03-28 transition in Europe/Paris Then offsets follow IANA rules (CET then CEST)

  Scenario: Zone preference order
    Given no stored zone preference Then the browser IANA zone is used

  Scenario: Date-only value
    Given a pickup date 2026-12-25 with zone Asia/Kolkata Then it renders as 25 Dec 2026 in every viewer zone without shifting, with the location zone name shown where relevant

  Scenario: Collation
    Then "Åland Islands" sorts with A in en, es and fr country lists

  Scenario: Invalid input
    Given an unknown currency code "XXY" Then the money helper rejects it and the UI shows the error state

  Scenario: Unknown locale for formatting
    Given a locale "xx" is requested Then the formatter falls back to en and logs a warning
```

### US-117 — Locale resolution, persistence and system-message locale
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-115, EPIC-02, EPIC-15
- **Linked REQs:** REQ-I18N-006, REQ-I18N-007, REQ-I18N-008
- **As a** user **I want** my language remembered everywhere, including in emails **so that** I always get my language.
- **Notes:** DR-A18, EC-A35. Order: stored user preference, switcher cookie, `Accept-Language` best match among en/es/fr (q-values honoured, regional variants mapped), then `en`. `Content-Language` header and `lang` attribute. Recipient locale captured on the event at creation.

#### Acceptance criteria
```gherkin
Feature: Locale resolution
  Scenario: Accept-Language matching
    Then "de-DE,de;q=0.9,es;q=0.5" resolves to es; "es-MX" resolves to es; no header resolves to en; "de" alone resolves to en

  Scenario: Precedence
    Given a stored user locale "fr" and a cookie "es" Then fr is used; for a guest with cookie "es" and Accept-Language fr, es is used

  Scenario: Change persists
    When a signed-in user switches to es Then profile locale is "es", html lang and Content-Language are "es", and an audit "UPDATE" entry on the user profile records old and new locale

  Scenario: Guest cookie
    When a guest switches to fr Then a first-party preference cookie is set and the choice survives reload

  Scenario: Across devices
    Given the user signs in on another device Then their stored locale applies

  Scenario: Email locale captured at event time
    Given a user switches language after triggering an event Then the email is rendered in the locale recorded on the event; for guests in the request's active locale

  Scenario: Missing template locale
    Given no fr template exists Then the en template is used

  Scenario: Invalid locale value
    When the client sends locale "xx" Then 400 "VALIDATION_ERROR" and the stored locale is unchanged

  Scenario: Permission denied
    Given an unauthenticated user calls the profile locale endpoint Then 401 "AUTH_REQUIRED"; another user's profile returns 404 "NOT_FOUND"
```

### US-118 — Display currency switcher
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-108, EPIC-17
- **Linked REQs:** REQ-I18N-012
- **As a** shopper **I want** to see approximate amounts in my currency **so that** I can compare prices, knowing charges stay in the pricing currency.
- **Notes:** Persist per user (guests per browser). Uses latest FX snapshot at or before request time labelled approximate. Rounding by target currency minor-unit exponent. Charge currency follows origin (EPIC-06/07).

#### Acceptance criteria
```gherkin
Feature: Currency switcher
  Scenario: Converted informational amount
    Given a price of 4500 USD cents and FX USD to INR snapshot Then selecting INR shows an approximate converted amount labelled "approx." and the charge currency remains USD

  Scenario: Persistence
    Then a signed-in user's choice is stored on the profile and a guest's in the browser

  Scenario: Missing FX pair
    Given no snapshot for the pair Then the amount stays in the pricing currency with no guess and a notice

  Scenario: Invalid currency
    When the client sends "ZZZ" Then 400 "VALIDATION_ERROR"

  Scenario: Rounding
    Then results use the target currency's minor-unit exponent

  Scenario: Accessibility and locales
    Then the switcher is keyboard operable, labelled in en, es and fr, and works at 360 px and 1280 px

  Scenario: Permission path
    Given an unauthenticated guest Then switching works without sign-in; saving to a profile requires authentication (401 "AUTH_REQUIRED")
```

### US-119 — Country-driven address layout
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-116, EPIC-17
- **Linked REQs:** REQ-I18N-005
- **As a** shipper sending to another country **I want** address fields in that country's order and wording **so that** the address is entered and printed correctly.
- **Notes:** The country, not the UI language, determines field order, labels (ZIP code, PIN code, postcode, state, province, county) and required fields, from reference data. Labels still translated per UI locale.

#### Acceptance criteria
```gherkin
Feature: Address layout by country
  Scenario: United States
    Given country US in the French UI Then the fields follow US order with label "Code ZIP" and State required

  Scenario: India
    Given country IN Then the label "PIN code" (translated per locale) and State required

  Scenario: United Kingdom
    Given country GB Then the label "Postcode" and no state field

  Scenario: Rendered address block
    Then the block is rendered in the destination country's convention regardless of UI language

  Scenario: Country change re-lays out the form
    When the country changes from US to IN Then fields re-order, entered values for shared fields are kept and focus remains on the country selector

  Scenario: Required field missing
    Given country CA without province Then inline error "Province is required" (localised) and 400 "VALIDATION_ERROR" from the API

  Scenario: Unsupported country
    Given a non-enabled country Then 422 "COUNTRY_NOT_SUPPORTED"

  Scenario: Locales and viewports
    Then the layout works in en, es and fr at 360 px and 1280 px with zero serious axe violations

  Scenario: Permission path
    Given an unauthenticated guest Then the layout is available for quoting; saving an address to the address book requires "address_book:manage" (403 "AUTHZ_DENIED" otherwise)
```

### US-120 — Pseudo-locale overflow tests and logical CSS
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-115, US-107
- **Linked REQs:** REQ-I18N-009, REQ-I18N-010
- **As a** developer **I want** a pseudo-locale and logical-CSS lint **so that** long translations never break layouts and right-to-left can be added later.
- **Notes:** Pseudo-locale (30% longer, accented) in non-production builds only. No RTL locale ships.

#### Acceptance criteria
```gherkin
Feature: Layout tolerance
  Scenario: Pseudo-locale expands strings
    Given the pseudo-locale is active Then every string is about 30% longer and accented

  Scenario: No clipping or overlap
    Then at 360 px and 1280 px no text on shared components or on any page is clipped, overlapped or overflows its container; failures list page, viewport and element

  Scenario: Production excludes pseudo-locale
    Given a production build Then the pseudo-locale is unavailable and "?lng=pseudo" resolves to en

  Scenario: Physical properties fail lint
    Given application CSS contains "margin-left" or "text-align: left" Then lint fails unless annotated

  Scenario: Logical properties pass
    Then margin-inline-start, padding-block and text-align: start pass

  Scenario: Permission path: not applicable — build and test tooling. Second negative: annotated exception without reason
    Given a physical-property annotation lacking a justification Then lint fails
```

## Coverage check

| REQ | Stories |
|---|---|
| REQ-UI-001 | US-101 |
| REQ-UI-002 | US-102 |
| REQ-UI-003 | US-103 |
| REQ-UI-004 | US-103 |
| REQ-UI-005 | US-103 |
| REQ-UI-006 | US-104 |
| REQ-UI-007 | US-104 |
| REQ-UI-008 | US-105 |
| REQ-UI-009 | US-105 |
| REQ-UI-010 | US-106 |
| REQ-UI-011 | US-107 |
| REQ-UI-012 | US-107 |
| REQ-UI-013 | US-108 |
| REQ-UI-014 | US-109 |
| REQ-UI-015 | US-109 |
| REQ-UI-016 | US-110 |
| REQ-UI-017 | US-111 |
| REQ-UI-018 | US-111 |
| REQ-UI-019 | US-112 |
| REQ-UI-020 | US-113 |
| REQ-UI-021 | US-113 |
| REQ-UI-022 | US-106 |
| REQ-UI-023 | US-114 |
| REQ-I18N-001 | US-115 |
| REQ-I18N-002 | US-115 |
| REQ-I18N-003 | US-115 |
| REQ-I18N-004 | US-116 |
| REQ-I18N-005 | US-119 |
| REQ-I18N-006 | US-117 |
| REQ-I18N-007 | US-117 |
| REQ-I18N-008 | US-117 |
| REQ-I18N-009 | US-120 |
| REQ-I18N-010 | US-120 |
| REQ-I18N-011 | US-116 |
| REQ-I18N-012 | US-118 |
| REQ-I18N-013 | US-115 |
| REQ-I18N-014 | US-116 |

All Must REQs of REQ-UI and REQ-I18N are covered by Must stories (UI-001..016, 019..022 by US-101..110, US-112, US-113; I18N-001..009, 011 by US-115..117, US-119, US-120). Should/Could REQs (UI-017 Could, UI-018 Should, UI-023 Should, I18N-010 Should, I18N-012 Should, I18N-013 Should, I18N-014 Could) are linked as stated; I18N-010, I18N-013 and I18N-014 ride inside Must stories that deliver the same mechanism, I18N-010 being enforced by lint with the Must pseudo-locale test in US-120.
