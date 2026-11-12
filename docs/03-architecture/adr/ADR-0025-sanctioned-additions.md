# ADR-0025: Sanctioned additions (brief §3.2) adopted in M0/M1 — one paragraph each

- **Status:** Accepted
- **Date:** 2026-11-12 (versions/licences verified against the npm registry on this date)
- **Deciders:** principal-architect
- **Related:** brief §3.2; ADR-0001; D-ARCH-003 (licence equivalences)

Each entry: why it is used, where, licence, and the alternative rejected. Items in §3.2 **not** used in this run are listed at the end so no silent dependency appears.

**Vite 8 (MIT).** Build/dev server for `apps/web` and `apps/admin` through `@react-router/dev`; provides route-level code splitting, pre-rendering and fast HMR. Alternative: Webpack — slower, more config.

**Tailwind CSS 4 (MIT) with design tokens.** Utility CSS; tokens (colour, type scale, spacing 4/8 px grid, radius, elevation, motion) declared once in `packages/ui/tokens.css` via `@theme` as CSS variables, themable per tenant (light/dark) and contrast-tested (NFR-A11Y-005). No hard-coded colours in feature code (lint). Alternative: CSS Modules only — more boilerplate, weaker token discipline.

**Radix UI primitives (MIT).** Accessible headless components (Dialog, Popover, Select, Tabs, Toast, Tooltip, Checkbox, RadioGroup, Switch) under `packages/ui`; WCAG 2.2 keyboard/focus behaviour comes with them. Alternative: hand-rolled ARIA — error-prone.

**TanStack Query 5 (MIT) on top of Axios 1.** Server-state cache, retries, optimistic updates and request de-duplication for both apps; Axios interceptors inject the bearer token and the single-flight refresh (ADR-0006). Alternative: SWR — fewer features for mutations.

**TanStack Table 9 (MIT).** Headless data grids for the audit viewer and shipment lists (server-side sort/filter/pagination, column chooser, density). Alternative: AG Grid — licence/size.

**react-i18next 18 / i18next 27 (MIT).** en/es/fr resources, ICU-style plurals/placeholders, `lang` attribute per locale; `eslint-plugin-i18next` forbids literals (NFR-I18N-001). Alternative: FormatJS — equivalent; i18next is sanctioned.

**motion 14 (MIT) — sanctioned, not adopted in M0/M1 (D-UX-016, 2026-11-12).** The UX specification meets the 120–180 ms micro-interaction need with CSS transitions honouring `prefers-reduced-motion`; no motion library is installed. Re-adoption (for orchestrated sequences) requires an amendment here, as D-UX-016 states.

**helmet 8 (MIT).** Secure headers on the API (REQ-SEC-001). Alternative: manual headers — Helmet is the sanctioned standard.

**express-rate-limit 8 + rate-limit-redis 6 (MIT).** Redis-backed limits shared across replicas with IETF draft-7 headers (REQ-SEC-005, REQ-API-014). Alternative: `rate-limiter-flexible` — fine, but §3.2 names express-rate-limit.

**jose 6 (MIT).** JWT ES256 sign/verify, JWK rotation (ADR-0006). Alternative: `jsonwebtoken` — HS/RS only via Node crypto, weaker key-set ergonomics; §3.2 allows either.

**bcrypt 6 (MIT, N-API prebuilds).** Password and recovery-code hashing at cost 12 (REQ-AUTH-003). Alternative: `bcryptjs` — pure JS, slower; `argon2` — not sanctioned.

**opossum 10 (Apache-2.0).** Circuit breaker per carrier account (ADR-0010). Requires Node ≥ 22 (hence Node 24 in ADR-0001). Alternative: `cockatiel` — equivalent, not sanctioned.

**pdfkit 0.20 (MIT).** Generated PDFs (ADR-0019). Alternative: headless Chromium — rejected for image size/determinism.

**OpenTelemetry SDK (`@opentelemetry/sdk-node` 0.301, auto-instrumentations; Apache-2.0).** Traces API → queue → worker → carrier (ADR-0017). Alternative: vendor agents — lock-in.

**Supertest 7, Testcontainers 12, nock 15, Playwright 1.65, @axe-core/playwright 4.14 (MPL-2.0), OWASP ZAP, Semgrep, Gitleaks, Trivy.** Testing and scanning per ADR-0024. ZAP/Semgrep/Gitleaks/Trivy run as CI tools (containers/actions), not as package dependencies.

**AWS: ElastiCache for Redis, KMS, CloudFront, ECR.** Designed in Terraform (platform.md); ECR deferred in favour of GHCR until M5 (D-005).

**Sanctioned but not used in this run (no dependency added):** Recharts (dashboards are M2), `exceljs` (bulk files are M4), `jsonwebtoken` (superseded by `jose`), headless Chromium (ADR-0019), motion (D-UX-016, above).

**Added on 2026-11-12 for the UX open items (`docs/02-ux/README.md` §5; registry checked the same day with `npm view` under the CLAUDE.md §2 PATH prefix):**

**uqr 0.1.3 (MIT; unjs; zero dependencies; last release 2026-04-03).** Encodes the TOTP `provisioning_uri` into a QR matrix that `packages/ui` renders as React SVG (ADR-0026 amendment 2). Alternatives: `qrcode` 1.5.4 — **rejected**, last release 2024-08-05 (> 18 months, CLAUDE.md §5) and it pulls `yargs` 15 / `pngjs`; server-rendered SVG — rejected (ADR-0006 amendment 11).

**i18next-icu 2.7.0 (MIT; last release 2026-11-05) with its peer intl-messageformat 12.1.5 (BSD-3-Clause; 2026-11-08) and @formatjs/icu-messageformat-parser 3.5.23 (MIT).** ICU MessageFormat plurals and selects in react-i18next as D-UX-028 specifies (ADR-0026 amendment 3). Expected ≈ 15–20 kB gzipped, measured in Wave 0 against the 170 kB public-page budget; the recorded fallback is native i18next suffix plurals. Alternative: FormatJS/react-intl end to end — rejected, i18next is the sanctioned library.

**Supporting libraries outside §3.2, each justified in ADRs and subject to D-ARCH-003:** `uuid` 14 (UUIDv7), `canonicalize` 5 (RFC 8785), `bowser` 2.15 (UA parsing; replaces AGPL `ua-parser-js`), `cookie` 2 (replaces stale `cookie-parser`), `p-limit` 7 (bulkhead), `otplib` 13 (TOTP), `nodemailer` 10 (MIT-0; SMTP to Mailpit), `stripe` 23, `@aws-sdk/*` v3 (S3, SES v2, presigner), `swagger-ui-dist` 5, `prom-client` 15, `zod` 4 (frontend validation, fixed by §3.3), `ajv` 8 + `@apidevtools/swagger-parser` 13 (OpenAPI response validation in tests), `@redocly/cli` 2 and `openapi-typescript` 7 (contract tooling), `fast-check` 4, `@swc/jest`, `size-limit` 14, `@lhci/cli` 0.16, `@stryker-mutator/core` 10, ESLint 10 + `typescript-eslint` 8 + `eslint-plugin-boundaries` 7 + `eslint-plugin-import-x` 4 + `eslint-plugin-i18next` 6 (ISC), Prettier 3, Stylelint 18 + `stylelint-use-logical` 2 (CC0-1.0), `tsx` 4.
