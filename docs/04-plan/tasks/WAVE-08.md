# WAVE-08 — Should stories (cuttable via PRD §7.1 ladder rung 2)

Owner: senior-developer · P4 plan v1.0 · 2026-11-12 · Milestone: **M0+M1** · Priority band: **Should** · **CUTTABLE** (PRD §7.1 ladder rung 2)

Tasks: **47** (S 17 / M 30; opus 10 / sonnet 37; demo-critical 0) in **13** batches of ≤ 4 parallel tasks. Estimated effort ≈ 115.5 developer-days (human-equivalent: S = 1.5, M = 3).

**Exit check:** Each merged Should passes regression; unfinished ones are deferred by product-manager (rung 2) without blocking G3.

**Stories completed in this wave (60):** US-014, US-026, US-028, US-029, US-033, US-060, US-073, US-099, US-100, US-111, US-114, US-118, US-144, US-145, US-162, US-163, US-164, US-165, US-169, US-170, US-178, US-179, US-185, US-188, US-190, US-193, US-194, US-196, US-215, US-216, US-217, US-218, US-219, US-227, US-228, US-229, US-230, US-238, US-239, US-246, US-250, US-252, US-258, US-259, US-260, US-261, US-262, US-263, US-265, US-266, US-267, US-268, US-269, US-272, US-273, US-275, US-286, US-287, US-288, US-289.

## Batches

| Batch | Tasks (parallel) | Locks held |
|---|---|---|
| 8.1 | TASK-219 Feature-flag evaluation and audited changes<br>TASK-220 Refuse sign-in for suspended/deactivated users; admin session lifetime and crawler exclusion<br>TASK-221 Role definitions change only via versioned migration<br>TASK-222 Reason-required mechanism and audit archiver seam | mod-admin-settings-flags<br>identity-core, admin-core<br>pkg-authz<br>pkg-audit-core |
| 8.2 | TASK-223 Customer TOTP settings, staff recovery-code regeneration and change password<br>TASK-225 Entity history view and panel<br>TASK-226 Table density and route-level code splitting | identity-mfa<br>admin-audit<br>ui-layout |
| 8.3 | TASK-228 Security settings screen<br>TASK-229 Privacy notice and consent-rule endpoint; cookie consent banner<br>TASK-230 Display currency switcher and indicative converter | web-account-security<br>mod-compliance-consent, web-consent<br>web-currency |
| 8.4 | TASK-232 Optional protection cover and price floor<br>TASK-233 Filter results with URL state; compare up to three options<br>TASK-234 Save a quote and reopen it; saved quotes list | pkg-pricing<br>web-quote-results<br>mod-quotes, web-account-quotes |
| 8.5 | TASK-235 Organisation profile and team invitations UI; protect last Owner and block self role change<br>TASK-236 Customer discounts and coupons; coupon entry on the review step<br>TASK-237 Share a quote by link<br>TASK-238 Public prohibited-items lookup page and volumetric calculator | web-account-org<br>pkg-pricing, mod-orders-coupon, web-wizard-review<br>mod-quotes<br>web-public-tools |
| 8.6 | TASK-239 Carrier address suggestions; Incoterm choice and de-minimis hint<br>TASK-240 Wizard autosave and offline edit queue<br>TASK-241 Paperless customs upload with printed-copy fallback<br>TASK-242 Wizard step 4 | mod-shipments-validation, mod-customs<br>web-wizard-shell<br>mod-customs-docs<br>web-wizard-extras |
| 8.7 | TASK-243 Add and remove shipments in the open order<br>TASK-244 EXCEPTION handling and automatic void retry<br>TASK-245 Drop-off service points list and drop-off confirmation<br>TASK-246 Authorisation and capture sweeper | mod-orders<br>mod-orders-saga<br>mod-pickups, web-wizard-step3<br>mod-payments-sweeper |
| 8.8 | TASK-247 Self-service shipment cancellation<br>TASK-248 Reschedule an active pickup<br>TASK-249 Saved payment methods with step-up and CVC recollection for stale sessions<br>TASK-250 Integrity check before download | mod-orders-cancel<br>mod-pickups<br>mod-payments-methods<br>mod-documents-download |
| 8.9 | TASK-251 Automatic full refund after cancellation<br>TASK-252 Void label on cancellation and refuse voided downloads<br>TASK-253 Cancel shipment entry point on the detail screen<br>TASK-254 Payment methods screen | mod-payments-refund<br>mod-documents-label<br>web-account-detail<br>web-account-payments |
| 8.10 | TASK-255 E-mail documents to the account address<br>TASK-256 Pickup confirmation document<br>TASK-257 Payment receipt and transactional lifecycle e-mails<br>TASK-258 Account dashboard with recent shipments, actions needed and monthly spend | mod-documents-email<br>mod-documents-render<br>mod-notifications<br>web-account-dashboard |
| 8.11 | TASK-259 Milestone notification events once per shipment and status; tracking milestone e-mails<br>TASK-260 Public tracking by customer reference plus receiver postcode<br>TASK-261 Accept signed carrier push notifications<br>TASK-262 Repeat a past shipment | mod-tracking-events, mod-notifications<br>mod-tracking-public<br>mod-tracking-push<br>web-account-detail |
| 8.12 | TASK-263 Notification preferences with consent records; suppress tracking e-mails at send time<br>TASK-264 Address book create, edit, delete and search; default sender address<br>TASK-265 No navigation or routes for out-of-scope account areas<br>TASK-266 SES adapter verified against recorded fixtures | mod-notifications-prefs, web-account-notif<br>mod-organisations-addressbook, web-account-addressbook<br>web-shell<br>mod-notifications-ses |
| 8.13 | TASK-267 Per-user notification log with PII minimisation<br>TASK-268 Locale, display currency and unit preferences | mod-notifications-log<br>web-account-prefs |

Locks are the exclusive-ownership units of PLAN.md §5 (overlap rule). Registries are per-module files aggregated by discovery (PLAN.md §5 rule 2), so tasks in a batch never edit the same file; the only serially merged shared files are `package-lock.json` (regenerated, never hand-merged) and `tools/quality/required-suites.json` (append-only).

Shared hot files (D-ORCH-118, D-ARCH-147): `api-tenant-db` = `apps/api/src/platform/db/tenant-db.*`, `apps/api/src/platform/db/with-tenant-tx.*`, `apps/api/src/platform/db/raw-statement.*`; `api-tx-execute` = `apps/api/src/platform/tx/**`; `api-platform-core` = `apps/api/src/app.*`, `apps/api/src/start-api.*`, `apps/api/src/main.*`; `api-routing` = `apps/api/src/platform/routing/pipeline.*`; `lint` = `eslint.config.mjs`. A card whose planned files name one of them holds that lock (the generator fails otherwise); a PR that needs such a file without holding the lock stops and asks the orchestrator for it first, so two in-flight PRs never edit the same shared file.

## Task specifications

### TASK-219 — Feature-flag evaluation and audited changes

| Field | Value |
|---|---|
| Stories (completes) | US-014 (M0 Should) Feature-flag evaluation and audited changes |
| REQs | REQ-PLAT-020, REQ-PLAT-021 |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-191 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-029, TASK-039 |
| Batch · locks | 8.1 · mod-admin-settings-flags |
| Branch | `feat/TASK-219-feature-flag-evaluation-audited-changes` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/admin-settings/flags/**
- packages/ui/src/flags/**

**Acceptance tests to write**
- All US-014 scenarios
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: createFeatureFlag, updateFeatureFlag (optional) (D-SD-007)
- AT-US-014-01 … AT-US-014-06: all 6 scenarios of US-014, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-220 — Refuse sign-in for suspended/deactivated users; admin session lifetime and crawler exclusion

| Field | Value |
|---|---|
| Stories (completes) | US-029 (M0 Should) Refuse sign-in for suspended and deactivated users<br>US-033 (M0 Should) Admin session lifetime and crawler exclusion |
| REQs | REQ-AUTH-024, REQ-ADMIN-004, REQ-ADMIN-010 |
| NFRs | NFR-SEC-004 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-095, TASK-067 |
| Batch · locks | 8.1 · identity-core, admin-core |
| Branch | `feat/TASK-220-refuse-sign-suspended-deactivated-users` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/identity/core/account-state.*
- apps/admin robots/noindex headers

**Acceptance tests to write**
- All US-029 and US-033 scenarios
- AT-US-029-01 … AT-US-029-05: all 5 scenarios of US-029, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-033-01 … AT-US-033-09: all 9 scenarios of US-033, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`apps/api/src/modules/identity/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-221 — Role definitions change only via versioned migration (drift test)

| Field | Value |
|---|---|
| Stories (completes) | US-073 (M0 Should) Role definitions change only via versioned migration |
| REQs | REQ-RBAC-013 |
| NFRs | NFR-SEC-011 |
| Spikes / security / decisions | PR8-SEC-09, D-ARCH-060 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-013, TASK-029, TASK-023 |
| Batch · locks | 8.1 · pkg-authz |
| Branch | `feat/TASK-221-role-definitions-change-only-versioned` |
| Priority | Should · cuttable |

**Files / modules**
- packages/authz/test/role-drift.int.test.ts
- prisma/seed/reference/authz.ts (parity check + CONFIG_CHANGE per CATALOGUE_VERSION)

**Acceptance tests to write**
- All US-073 scenarios
- data-model §9.2 / ADR-0008 am. 2 item 3 (D-ARCH-060, PR8-SEC-09): a post-migrate reconciler run as SYSTEM_JOB digests permissions/roles/role_permissions as read from the database, compares with the last audited digest in reference_dataset_versions(dataset = authz_matrix, version, content_sha256), writes one CONFIG_CHANGE audit entry per changed version (role, old -> new permission set; the first run back-fills the baseline empty -> current) and writes nothing when unchanged (AT-US-073-04); it also fails the seed on catalogue <-> database drift; no migration ever inserts into audit_entries; if this task is cut, the G3 report names the guard tests and CODEOWNERS as the residual controls
- PR8-SEC-09 conditions 1-3 (verified at this task security review): the first CONFIG_CHANGE entry covers every version applied before the reconciler existed (old set ∅ → the current grants of v1 and any later version); the mechanism is the SYSTEM_JOB reconciler, never a migration INSERT into audit_entries; if this task is cut, T-107 residual controls (guard tests, CODEOWNERS from TASK-007) are recorded in the G3 residual-risk list
- D-ARCH-075 (PR13-SEC-04 / PR13-SEC-08; data-model §3.5/§4.4/§9.2 as amended 2026-11-13): the reconciler needs NO write on reference_dataset_versions (platform_app holds SELECT only) — it derives the last audited digest from the latest CONFIG_CHANGE entry for authz_matrix in audit_entries, so down.sql has no digest row to drop and a down -> up cannot produce a second baseline; the dataset name authz_matrix stays in RESERVED_DATASET_NAMES; the reconciler is GENERALISED to every audited dataset: for each reference_dataset_versions row it compares (dataset, dataset_version, content_sha256) with the last audited digest and writes one CONFIG_CHANGE per changed version (seed-originated changes are audited here because the seed runs as the migrator, which holds no audit privilege); an expand migration adds drift_restored_rows bigint NOT NULL DEFAULT 0 and last_drift_restored_at timestamptz Y to reference_dataset_versions, the seed increments them on a drift restore and the reconciler audits a changed counter as CONFIG_CHANGE reason drift-restored; wiring passes a pg.Client, never a pool (PR #13 n3); security-analyst confirms the boundary at review
- AT-US-073-01 … AT-US-073-04: all 4 scenarios of US-073, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/authz/**`, `prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-222 — Reason-required mechanism and audit archiver seam

| Field | Value |
|---|---|
| Stories (completes) | US-100 (M0 Should) Reason-required mechanism and archiver seam |
| REQs | REQ-AUDIT-025, REQ-AUDIT-018 |
| NFRs | NFR-AUDIT-007 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-029, TASK-090 |
| Batch · locks | 8.1 · pkg-audit-core |
| Branch | `feat/TASK-222-reason-required-mechanism-audit-archiver` |
| Priority | Should · cuttable |

**Files / modules**
- packages/audit/src/{reason.ts, archiver.ts}

**Acceptance tests to write**
- All US-100 scenarios
- AT-US-100-01 … AT-US-100-04: all 4 scenarios of US-100, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`packages/audit/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-223 — Customer TOTP settings, staff recovery-code regeneration and change password (API)

| Field | Value |
|---|---|
| Stories (completes) | — |
| Stories (partial; completed by TASK-228, TASK-228) | US-026 (M1 Should) Customer TOTP settings, re-authentication and staff recovery-code regeneration<br>US-028 (M1 Should) Change password |
| REQs | REQ-AUTH-019, REQ-AUTH-020, REQ-ADMIN-008, REQ-AUTH-023 |
| NFRs | NFR-SEC-004 |
| Spikes / security / decisions | SEC-COND-01 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-187, TASK-061 |
| Batch · locks | 8.2 · identity-mfa |
| Branch | `feat/TASK-223-customer-totp-settings-staff-recovery` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/identity/mfa/settings.*
- apps/api/src/modules/identity/core/change-password.*

**Acceptance tests to write**
- API scenarios of US-026 and US-028
- Covers the scenarios of AT-US-026-01 … AT-US-026-07 that belong to its layer; US-026 closes in TASK-228
- Covers the scenarios of AT-US-028-01 … AT-US-028-05 that belong to its layer; US-028 closes in TASK-228

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`apps/api/src/modules/identity/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-225 — Entity history view and panel (admin)

| Field | Value |
|---|---|
| Stories (completes) | US-099 (M1 Should) Entity history view and panel |
| REQs | REQ-AUDIT-021 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-081 |
| Batch · locks | 8.2 · admin-audit |
| Branch | `feat/TASK-225-entity-history-view-panel` |
| Priority | Should · cuttable |

**Files / modules**
- apps/admin/app/routes/audit/entities.$entity.$id.tsx

**Acceptance tests to write**
- All US-099 scenarios
- AT-US-099-01 … AT-US-099-05: all 5 scenarios of US-099, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-226 — Table density and route-level code splitting

| Field | Value |
|---|---|
| Stories (completes) | US-111 (M1 Should) Table density and route-level code splitting |
| REQs | REQ-UI-017, REQ-UI-018 |
| NFRs | NFR-WEB-004 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-069, TASK-053 |
| Batch · locks | 8.2 · ui-layout |
| Branch | `feat/TASK-226-table-density-route-level-code` |
| Priority | Should · cuttable |

**Files / modules**
- packages/ui/src/components/DataTable/density.ts

**Acceptance tests to write**
- All US-111 scenarios
- AT-US-111-01 … AT-US-111-05: all 5 scenarios of US-111, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-228 — Security settings screen (TOTP, recovery codes, change password)

| Field | Value |
|---|---|
| Stories (completes) | US-267 (M1 Should) Security settings screen<br>US-026 (M1 Should) Customer TOTP settings, re-authentication and staff recovery-code regeneration<br>US-028 (M1 Should) Change password |
| REQs | REQ-ACCT-013, REQ-AUTH-019, REQ-AUTH-020, REQ-ADMIN-008, REQ-AUTH-023 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-223, TASK-193 |
| Batch · locks | 8.3 · web-account-security |
| Branch | `feat/TASK-228-security-settings-screen` |
| Priority | Should · cuttable |

**Files / modules**
- apps/web/app/routes/account/security/**

**Acceptance tests to write**
- All US-267, US-026 and US-028 scenarios
- AT-US-267-01 … AT-US-267-09: all 9 scenarios of US-267, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-026-01 … AT-US-026-07: all 7 scenarios of US-026, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-028-01 … AT-US-028-05: all 5 scenarios of US-028, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-229 — Privacy notice and consent-rule endpoint; cookie consent banner

| Field | Value |
|---|---|
| Stories (completes) | US-060 (M1 Should) Privacy notice and consent rule endpoint<br>US-114 (M1 Should) Cookie consent banner |
| REQs | REQ-COMP-007, REQ-UI-023 |
| NFRs | NFR-PRIV-005 |
| Spikes / security / decisions | D-ARCH-191 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-127, TASK-189 |
| Batch · locks | 8.3 · mod-compliance-consent, web-consent |
| Branch | `feat/TASK-229-privacy-notice-consent-rule-endpoint` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/compliance/consent/**
- apps/web/app/features/cookie-banner/**

**Acceptance tests to write**
- All US-060 and US-114 scenarios
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: recordConsent (optional) (D-SD-007)
- AT-US-060-01 … AT-US-060-06: all 6 scenarios of US-060, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-114-01 … AT-US-114-09: all 9 scenarios of US-114, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-230 — Display currency switcher and indicative converter

| Field | Value |
|---|---|
| Stories (completes) | US-118 (M1 Should) Display currency switcher<br>US-169 (M1 Should) Display currency switcher and indicative converter |
| REQs | REQ-I18N-012, REQ-QUOTE-019, REQ-QUOTE-022 |
| NFRs | NFR-I18N-004 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-133, TASK-068 |
| Batch · locks | 8.3 · web-currency |
| Branch | `feat/TASK-230-display-currency-switcher-indicative-converter` |
| Priority | Should · cuttable |

**Files / modules**
- apps/web/app/features/currency/**

**Acceptance tests to write**
- All US-118 and US-169 scenarios
- AT-US-118-01 … AT-US-118-07: all 7 scenarios of US-118, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-169-01 … AT-US-169-09: all 9 scenarios of US-169, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-232 — Optional protection cover and price floor

| Field | Value |
|---|---|
| Stories (completes) | US-144 (M1 Should) Optional protection cover and price floor |
| REQs | REQ-PRICE-009, REQ-PRICE-018 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-198, TASK-129 |
| Batch · locks | 8.4 · pkg-pricing |
| Branch | `feat/TASK-232-optional-protection-cover-price-floor` |
| Priority | Should · cuttable |

**Files / modules**
- packages/pricing/src/lines/protection.ts

**Acceptance tests to write**
- All US-144 scenarios
- AT-US-144-01 … AT-US-144-07: all 7 scenarios of US-144, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-233 — Filter results with URL state; compare up to three options

| Field | Value |
|---|---|
| Stories (completes) | US-162 (M1 Should) Filter results with URL state<br>US-163 (M1 Should) Compare up to three options |
| REQs | REQ-QUOTE-010, REQ-QUOTE-013 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-145 |
| Batch · locks | 8.4 · web-quote-results |
| Branch | `feat/TASK-233-filter-results-url-state-compare` |
| Priority | Should · cuttable |

**Files / modules**
- apps/web/app/features/quote-results/{filter,compare}/**

**Acceptance tests to write**
- All US-162 and US-163 scenarios
- AT-US-162-01 … AT-US-162-07: all 7 scenarios of US-162, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-163-01 … AT-US-163-06: all 6 scenarios of US-163, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-234 — Save a quote and reopen it; saved quotes list

| Field | Value |
|---|---|
| Stories (completes) | US-164 (M1 Should) Save a quote and reopen it<br>US-259 (M1 Should) Saved quotes list |
| REQs | REQ-QUOTE-014, REQ-ACCT-005 |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-191 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-146, TASK-183 |
| Batch · locks | 8.4 · mod-quotes, web-account-quotes |
| Branch | `feat/TASK-234-save-quote-reopen-it-saved` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/quotes/saved/**
- apps/web/app/routes/account/quotes.tsx

**Acceptance tests to write**
- All US-164 and US-259 scenarios
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: saveQuote, deleteSavedQuote (optional) (D-SD-007)
- AT-US-164-01 … AT-US-164-10: all 10 scenarios of US-164, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-259-01 … AT-US-259-07: all 7 scenarios of US-259, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-235 — Organisation profile and team invitations UI; protect last Owner and block self role change

| Field | Value |
|---|---|
| Stories (completes) | US-268 (M1 Should) Organisation profile and team invitations<br>US-269 (M1 Should) Protect the last Owner and block self role change |
| REQs | REQ-ACCT-014, REQ-ACCT-015 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | PR8-SEC-06 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-231 |
| Batch · locks | 8.5 · web-account-org |
| Branch | `feat/TASK-235-organisation-profile-team-invitations-ui` |
| Priority | Should · cuttable |

**Files / modules**
- apps/web/app/routes/account/organisation/**

**Acceptance tests to write**
- All US-268 and US-269 scenarios
- PR8-SEC-06 (UI side; ADR-0008 am. 3 item 4): the role picker offers only roles `canAssignRole(actorRoles, role)` allows and the modify/remove controls are disabled (with an explanatory tooltip and an aria-disabled state) for members holding any role the actor cannot assign; the server remains authoritative — a 403 from the API is rendered as the permission-denied state, never retried
- AT-US-268-01 … AT-US-268-14: all 14 scenarios of US-268, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-269-01 … AT-US-269-07: all 7 scenarios of US-269, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-236 — Customer discounts and coupons; coupon entry on the review step

| Field | Value |
|---|---|
| Stories (completes) | US-145 (M1 Should) Customer discounts and coupons<br>US-194 (M1 Should) Coupon entry on the review step |
| REQs | REQ-PRICE-010, REQ-PRICE-011, REQ-BOOK-015 |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-191 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-192, TASK-164 |
| Batch · locks | 8.5 · pkg-pricing, mod-orders-coupon, web-wizard-review |
| Branch | `feat/TASK-236-customer-discounts-coupons-coupon-entry` |
| Priority | Should · cuttable |

**Files / modules**
- packages/pricing/src/discounts/**
- apps/api/src/modules/orders/coupon/**
- apps/web/app/features/wizard/review/coupon/**

**Acceptance tests to write**
- All US-145 and US-194 scenarios
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: applyOrderCoupon, removeOrderCoupon (optional) (D-SD-007)
- AT-US-145-01 … AT-US-145-07: all 7 scenarios of US-145, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-194-01 … AT-US-194-05: all 5 scenarios of US-194, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-237 — Share a quote by link (mint-and-revoke, byte-identical 404s)

| Field | Value |
|---|---|
| Stories (completes) | US-165 (M1 Should) Share a quote by link |
| REQs | REQ-QUOTE-015 |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | SEC-P3-32, SEC-P3-10, D-ARCH-162, D-ARCH-163, D-SD-003, D-ARCH-191 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-234 |
| Batch · locks | 8.5 · mod-quotes |
| Branch | `feat/TASK-237-share-quote-link` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/quotes/share/**
- apps/web/app/features/quote-results/share/**

**Acceptance tests to write**
- All US-165 scenarios
- SEC-TC-53 (amended): two mints -> two tokens, first 404; CREATE + UPDATE audit; 11th mint/hour -> 429; three byte-identical 404 bodies
- quote_shares AS AMENDED 2026-11-19 (D-ARCH-162, D-ARCH-163; data-model 3.10): the owner-bound pair; ux_quote_shares__org_quote_active and ux_quote_shares__guest_quote_active replace ux_quote_shares__quote_active; ux_quote_shares__share_token_hash is an entry of TENANT_UNIQUE_EXCEPTIONS with its reason; the claim statement gains the quote_shares update in this PR, with a test that a claim leaving a share behind fails with 23503
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: revokeQuoteShare (optional) (D-SD-007)
- AT-US-165-01 … AT-US-165-12: all 12 scenarios of US-165, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-238 — Public prohibited-items lookup page and volumetric calculator

| Field | Value |
|---|---|
| Stories (completes) | US-170 (M1 Should) Public prohibited-items lookup and volumetric calculator |
| REQs | REQ-QUOTE-020, REQ-QUOTE-021 |
| NFRs | NFR-WEB-005 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-196, TASK-189 |
| Batch · locks | 8.5 · web-public-tools |
| Branch | `feat/TASK-238-public-prohibited-items-lookup-page` |
| Priority | Should · cuttable |

**Files / modules**
- apps/web/app/routes/$lang.tools.*.tsx

**Acceptance tests to write**
- All US-170 scenarios
- AT-US-170-01 … AT-US-170-10: all 10 scenarios of US-170, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-239 — Carrier address suggestions; Incoterm choice and de-minimis hint

| Field | Value |
|---|---|
| Stories (completes) | US-178 (M1 Should) Step 1: carrier address suggestions<br>US-185 (M1 Should) Incoterm choice and de-minimis hint |
| REQs | REQ-BOOK-007, REQ-CUST-005, REQ-CUST-008 |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-202, D-SD-010 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-195, TASK-199 |
| Batch · locks | 8.6 · mod-shipments-validation, mod-customs |
| Branch | `feat/TASK-239-carrier-address-suggestions-incoterm-choice` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/shipments/validation/suggestions.*
- apps/api/src/modules/customs/incoterms.*

**Acceptance tests to write**
- All US-178 and US-185 scenarios
- D-ARCH-106: read-then-call route: load (the addressed shipment under RLS, 404 on a miss), call (carrier address validation, no transaction open), the handler returns the result (audit as declared); never a carrier call inside the tenant transaction
- CALL CLASS (ADR-0003 amendment 2026-11-20 rules (j) to (l); D-ARCH-202): the operation gets its row in the call table of the route-metadata test (read, inert or reachable); an inert or reachable operation has a fault test (the handler transaction fails after call, the provider fake shows no hold, charge, booking or message that no row names, the next request converges); an effect that is right only if the state change commits is an outbox event and a worker step; on this card: suggestShipmentAddress (carrier address validation in call) is class read
- AT-US-178-01 … AT-US-178-05: all 5 scenarios of US-178, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-185-01 … AT-US-185-06: all 6 scenarios of US-185, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-240 — Wizard autosave and offline edit queue

| Field | Value |
|---|---|
| Stories (completes) | US-179 (M1 Should) Autosave and offline edit queue |
| REQs | REQ-BOOK-004 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-156 |
| Batch · locks | 8.6 · web-wizard-shell |
| Branch | `feat/TASK-240-wizard-autosave-offline-edit-queue` |
| Priority | Should · cuttable |

**Files / modules**
- apps/web/app/features/wizard/autosave/**

**Acceptance tests to write**
- All US-179 scenarios
- AT-US-179-01 … AT-US-179-05: all 5 scenarios of US-179, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-241 — Paperless customs upload with printed-copy fallback

| Field | Value |
|---|---|
| Stories (completes) | US-188 (M1 Should) Paperless customs upload with printed-copy fallback |
| REQs | REQ-CUST-014 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-161, TASK-135 |
| Batch · locks | 8.6 · mod-customs-docs |
| Branch | `feat/TASK-241-paperless-customs-upload-printed-copy` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/customs/paperless.*

**Acceptance tests to write**
- All US-188 scenarios
- AT-US-188-01 … AT-US-188-05: all 5 scenarios of US-188, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-242 — Wizard step 4: extras, cover and references

| Field | Value |
|---|---|
| Stories (completes) | US-190 (M1 Should) Step 4: extras, cover and references |
| REQs | REQ-BOOK-011 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-198, TASK-156 |
| Batch · locks | 8.6 · web-wizard-extras |
| Branch | `feat/TASK-242-wizard-step-4-extras-cover` |
| Priority | Should · cuttable |

**Files / modules**
- apps/web/app/features/wizard/step-4/**

**Acceptance tests to write**
- All US-190 scenarios
- AT-US-190-01 … AT-US-190-07: all 7 scenarios of US-190, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-243 — Add and remove shipments in the open order

| Field | Value |
|---|---|
| Stories (completes) | US-193 (M1 Should) Add and remove shipments in the open order |
| REQs | REQ-BOOK-014 |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-191 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-153 |
| Batch · locks | 8.7 · mod-orders |
| Branch | `feat/TASK-243-add-remove-shipments-open-order` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/orders/basket/edit.*

**Acceptance tests to write**
- All US-193 scenarios
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: addOrderShipment, removeOrderShipment (optional) (D-SD-007)
- AT-US-193-01 … AT-US-193-06: all 6 scenarios of US-193, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-244 — EXCEPTION handling and automatic void retry

| Field | Value |
|---|---|
| Stories (completes) | US-215 (M1 Should) EXCEPTION handling and automatic void retry |
| REQs | REQ-BOOK-030 |
| NFRs | NFR-RES-005 |
| Spikes / security / decisions | D-ARCH-180 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-105, TASK-109 |
| Batch · locks | 8.7 · mod-orders-saga |
| Branch | `feat/TASK-244-exception-handling-automatic-void-retry` |
| Priority | Should · cuttable |

**Files / modules**
- apps/worker/src/processors/booking/void-retry.*

**Acceptance tests to write**
- All US-215 scenarios
- CANDIDATE FUNCTION void_retry_candidates: the function does not filter on organisations.deleted_at (D-ARCH-180; ADR-0013 amendment 4 item 21): it settles, cancels, expires or retries existing work, which a soft-deleted organisation still owns
- AT-US-215-01 … AT-US-215-07: all 7 scenarios of US-215, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-245 — Drop-off service points list and drop-off confirmation

| Field | Value |
|---|---|
| Stories (completes) | US-239 (M1 Should) Drop-off service points and drop-off confirmation |
| REQs | REQ-PICK-010, REQ-PICK-013 |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-008, D-ARCH-202, D-SD-010 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-203, TASK-163 |
| Batch · locks | 8.7 · mod-pickups, web-wizard-step3 |
| Branch | `feat/TASK-245-drop-off-service-points-list` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/pickups/service-points/**
- apps/web/app/features/wizard/step-3/drop-off/**

**Acceptance tests to write**
- All US-239 scenarios
- D-ARCH-106: read-then-call route: load (the addressed shipment under RLS, 404 on a miss), call (carrier service points, no transaction open), the handler returns the result (audit as declared); never a carrier call inside the tenant transaction
- CALL CLASS (ADR-0003 amendment 2026-11-20 rules (j) to (l); D-ARCH-202): the operation gets its row in the call table of the route-metadata test (read, inert or reachable); an inert or reachable operation has a fault test (the handler transaction fails after call, the provider fake shows no hold, charge, booking or message that no row names, the next request converges); an effect that is right only if the state change commits is an outbox event and a worker step; on this card: listServicePoints (carrier service points in call) is class read
- AT-US-239-01 … AT-US-239-10: all 10 scenarios of US-239, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-246 — Authorisation and capture sweeper

| Field | Value |
|---|---|
| Stories (completes) | US-219 (M1 Should) Authorisation and capture sweeper |
| REQs | REQ-PAY-018 |
| NFRs | NFR-RES-005 |
| Spikes / security / decisions | D-ARCH-180 |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-170, TASK-105 |
| Batch · locks | 8.7 · mod-payments-sweeper |
| Branch | `feat/TASK-246-authorisation-capture-sweeper` |
| Priority | Should · cuttable |

**Files / modules**
- apps/worker/src/processors/payments/sweeper.*

**Acceptance tests to write**
- All US-219 scenarios
- CANDIDATE FUNCTION payment_sweeper_candidates: the function does not filter on organisations.deleted_at (D-ARCH-180; ADR-0013 amendment 4 item 21): it settles, cancels, expires or retries existing work, which a soft-deleted organisation still owns
- AT-US-219-01 … AT-US-219-06: all 6 scenarios of US-219, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-247 — Self-service shipment cancellation (cancellation saga)

| Field | Value |
|---|---|
| Stories (completes) | US-196 (M1 Should) Self-service shipment cancellation |
| REQs | REQ-BOOK-029 |
| NFRs | NFR-RES-005 |
| Spikes / security / decisions | D-017, D-ARCH-191 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-244, TASK-203 |
| Batch · locks | 8.8 · mod-orders-cancel |
| Branch | `feat/TASK-247-self-service-shipment-cancellation` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/orders/cancellation-saga/**

**Acceptance tests to write**
- All US-196 scenarios
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: cancelShipment (required) (D-SD-007)
- AT-US-196-01 … AT-US-196-11: all 11 scenarios of US-196, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-248 — Reschedule an active pickup

| Field | Value |
|---|---|
| Stories (completes) | US-238 (M1 Should) Reschedule an active pickup |
| REQs | REQ-PICK-009 |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-191 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-203 |
| Batch · locks | 8.8 · mod-pickups |
| Branch | `feat/TASK-248-reschedule-an-active-pickup` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/pickups/reschedule.*

**Acceptance tests to write**
- All US-238 scenarios
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: reschedulePickup (required) (D-SD-007)
- AT-US-238-01 … AT-US-238-05: all 5 scenarios of US-238, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-249 — Saved payment methods with step-up and CVC recollection for stale sessions

| Field | Value |
|---|---|
| Stories (completes) | US-217 (M1 Should) Saved payment methods |
| REQs | REQ-PAY-014 |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | SEC-COND-01, SEC-COND-06, D-ARCH-191, D-ARCH-206, D-SECPR040-04, D-PM-086, D-ARCH-202, D-SD-010 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-174, TASK-187 |
| Batch · locks | 8.8 · mod-payments-methods |
| Branch | `feat/TASK-249-saved-payment-methods-step-up` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/payments/methods/**

**Acceptance tests to write**
- All US-217 scenarios
- SEC-TC-37 (amended, saved-card part): auth_time > 12 h -> require_cvc_recollection=true; after createReauthProof retried checkout has cvc_recollection_required=false
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: createPaymentMethod, createPaymentMethodSetup, updatePaymentMethod, deletePaymentMethod (optional) (D-SD-007)
- PAYMENT METHOD CALLS (ADR-0012 amendment 7; ADR-0003 amendment 2026-11-20 rule (j); D-ARCH-206): createPaymentMethodSetup has a call of class inert; createPaymentMethod a call of class reachable that acts only on the setup its committed row names; updatePaymentMethod and deletePaymentMethod have no call; deletePaymentMethod marks the method removed under the version check and publishes its event, and a worker step detaches at the gateway with its own key and then deletes the row (an already detached method counts as done); the contract description of deletePaymentMethod becomes: Removes the saved method; the gateway detach follows after the commit (change request to api-designer, in this pull request); housekeeping detaches the method of a completed setup that never became a saved method (with security-analyst); tests: a delete that loses its conditional write leaves the method attached and usable; a delete whose detach fails is retried and the method is not listed meanwhile; LIMIT (D-PM-086): a method marked removed does not count towards the limit of 10 saved methods; test: with 10 methods of which one is removed and not yet detached, an eleventh can be added
- PAYMENT METHOD SECURITY CONDITIONS (D-SECPR040-04 C-3 to C-9; security-analyst reviews the record): C-3 removed means unusable at once: from the commit of the handler a method marked removed is neither listed nor accepted by checkoutOrder or any other charge path, and the charge path checks the status, not only the list; test: a checkout naming a removed method is refused while its detach is still pending; C-4 the event carries only the method id (no gateway token); the worker step re-reads the row under the job context of the organisation and detaches only a row still marked removed, uses a gateway key derived from the method id, treats already detached as done, and deletes the row only after the gateway answers; C-5 retries are bounded: a detach that keeps failing goes to the dead-letter queue and is visible to operations (TASK-214 signal); the marked row, which holds the gateway reference but no card data, stays until the detach succeeds and no other cleanup deletes it first; C-6 the worker logs the method id and the outcome class only, never the gateway token; the DELETE audit entry of the user is written by the handler and the detach adds no user-attributed entry; C-7 the housekeeping acts only on setups the Platform itself started: it works from the own setup rows of the Platform, never from a list of the methods of the gateway customer, and a setup row qualifies when it is older than its TTL (24 h unless this task sets otherwise) and has no saved method; C-8 the housekeeping and a late createPaymentMethod exclude each other: each setup row is claimed by one conditional update (ACTIVE to ABANDONED), and createPaymentMethod refuses a setup that is no longer active, so a setup is either saved or detached, never both; test: the race in both orders; C-9 the gateway key is derived from the setup id; the step is idempotent and runs under the job context of the organisation, with SYSTEM batches only where ADR-0013 allows them; it logs counts and classes only; test: a completed setup that is never saved is detached after the TTL, and its method no longer exists at the gateway fake
- CALL CLASS (ADR-0003 amendment 2026-11-20 rules (j) to (l); D-ARCH-202): the operation gets its row in the call table of the route-metadata test (read, inert or reachable); an inert or reachable operation has a fault test (the handler transaction fails after call, the provider fake shows no hold, charge, booking or message that no row names, the next request converges); an effect that is right only if the state change commits is an outbox event and a worker step; on this card: createPaymentMethodSetup is class inert and createPaymentMethod class reachable, each with its fault test; updatePaymentMethod and deletePaymentMethod declare no call (PAYMENT METHOD CALLS, D-ARCH-206)
- AT-US-217-01 … AT-US-217-16: all 16 scenarios of US-217, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-250 — Integrity check before download

| Field | Value |
|---|---|
| Stories (completes) | US-227 (M1 Should) Integrity check before download |
| REQs | REQ-DOC-009 |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | D-ARCH-202, D-SD-010 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-162 |
| Batch · locks | 8.8 · mod-documents-download |
| Branch | `feat/TASK-250-integrity-check-before-download` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/documents/download/integrity.*

**Acceptance tests to write**
- All US-227 scenarios
- D-ARCH-106: the object read for the integrity check runs in the call phase (no transaction open); load resolves the document under RLS first and the handler writes the VIEW or DOWNLOAD audit entry before the response is released (fail closed)
- CALL CLASS (ADR-0003 amendment 2026-11-20 rules (j) to (l); D-ARCH-202): the operation gets its row in the call table of the route-metadata test (read, inert or reachable); an inert or reachable operation has a fault test (the handler transaction fails after call, the provider fake shows no hold, charge, booking or message that no row names, the next request converges); an effect that is right only if the state change commits is an outbox event and a worker step; on this card: the integrity-check route (the object read in call) is class read
- AT-US-227-01 … AT-US-227-05: all 5 scenarios of US-227, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-251 — Automatic full refund after cancellation

| Field | Value |
|---|---|
| Stories (completes) | US-216 (M1 Should) Automatic full refund after cancellation |
| REQs | REQ-PAY-013 |
| NFRs | NFR-RES-005 |
| Spikes / security / decisions | D-017 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-247 |
| Batch · locks | 8.9 · mod-payments-refund |
| Branch | `feat/TASK-251-automatic-full-refund-after-cancellation` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/payments/refunds/**

**Acceptance tests to write**
- All US-216 scenarios
- AT-US-216-01 … AT-US-216-08: all 8 scenarios of US-216, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-252 — Void label on cancellation and refuse voided downloads

| Field | Value |
|---|---|
| Stories (completes) | US-229 (M1 Should) Void label on cancellation and refuse voided downloads |
| REQs | REQ-DOC-013, REQ-DOC-014 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-247, TASK-155, TASK-250 |
| Batch · locks | 8.9 · mod-documents-label |
| Branch | `feat/TASK-252-void-label-cancellation-refuse-voided` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/documents/labels/void.*

**Acceptance tests to write**
- All US-229 scenarios
- AT-US-229-01 … AT-US-229-07: all 7 scenarios of US-229, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-253 — Cancel shipment entry point on the detail screen

| Field | Value |
|---|---|
| Stories (completes) | US-261 (M1 Should) Cancel shipment entry point on the detail screen |
| REQs | REQ-ACCT-007 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-247, TASK-185 |
| Batch · locks | 8.9 · web-account-detail |
| Branch | `feat/TASK-253-cancel-shipment-entry-point-detail` |
| Priority | Should · cuttable |

**Files / modules**
- apps/web/app/features/shipment-detail/cancel/**

**Acceptance tests to write**
- All US-261 scenarios
- AT-US-261-01 … AT-US-261-09: all 9 scenarios of US-261, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-254 — Payment methods screen

| Field | Value |
|---|---|
| Stories (completes) | US-265 (M1 Should) Payment methods screen |
| REQs | REQ-ACCT-011 |
| NFRs | NFR-A11Y-001 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-249, TASK-197 |
| Batch · locks | 8.9 · web-account-payments |
| Branch | `feat/TASK-254-payment-methods-screen` |
| Priority | Should · cuttable |

**Files / modules**
- apps/web/app/routes/account/payment-methods.tsx

**Acceptance tests to write**
- All US-265 scenarios
- AT-US-265-01 … AT-US-265-10: all 10 scenarios of US-265, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-255 — E-mail documents to the account address

| Field | Value |
|---|---|
| Stories (completes) | US-228 (M1 Should) Email documents to the account address |
| REQs | REQ-DOC-010 |
| NFRs | — |
| Spikes / security / decisions | D-051, D-ARCH-191 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-179, TASK-162 |
| Batch · locks | 8.10 · mod-documents-email |
| Branch | `feat/TASK-255-e-mail-documents-account-address` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/documents/email/**

**Acceptance tests to write**
- All US-228 scenarios
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: emailShipmentDocuments (optional) (D-SD-007)
- AT-US-228-01 … AT-US-228-09: all 9 scenarios of US-228, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-256 — Pickup confirmation document

| Field | Value |
|---|---|
| Stories (completes) | US-230 (M1 Should) Pickup confirmation document |
| REQs | REQ-DOC-003 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-158, TASK-178 |
| Batch · locks | 8.10 · mod-documents-render |
| Branch | `feat/TASK-256-pickup-confirmation-document` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/documents/renderer/pickup-confirmation.*

**Acceptance tests to write**
- All US-230 scenarios
- AT-US-230-01 … AT-US-230-04: all 4 scenarios of US-230, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-257 — Payment receipt and transactional lifecycle e-mails

| Field | Value |
|---|---|
| Stories (completes) | US-218 (M1 Should) Payment receipt<br>US-286 (M1 Should) Transactional lifecycle emails |
| REQs | REQ-PAY-015, REQ-NOTIF-009 |
| NFRs | NFR-I18N-002 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-169, TASK-170, TASK-178 |
| Batch · locks | 8.10 · mod-notifications |
| Branch | `feat/TASK-257-payment-receipt-transactional-lifecycle-e` |
| Priority | Should · cuttable |

**Files / modules**
- templates payment.*, lifecycle.* (en/es/fr)

**Acceptance tests to write**
- All US-218 and US-286 scenarios
- AT-US-218-01 … AT-US-218-05: all 5 scenarios of US-218, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-286-01 … AT-US-286-09: all 9 scenarios of US-286, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-258 — Account dashboard with recent shipments, actions needed and monthly spend

| Field | Value |
|---|---|
| Stories (completes) | US-258 (M1 Should) Dashboard with recent shipments, actions needed and monthly spend |
| REQs | REQ-ACCT-001 |
| NFRs | NFR-PERF-006 |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-183, TASK-170 |
| Batch · locks | 8.10 · web-account-dashboard |
| Branch | `feat/TASK-258-account-dashboard-recent-shipments-actions` |
| Priority | Should · cuttable |

**Files / modules**
- apps/web/app/routes/account/_index.tsx
- apps/api/src/modules/shipments/query/dashboard.*

**Acceptance tests to write**
- All US-258 scenarios
- AT-US-258-01 … AT-US-258-08: all 8 scenarios of US-258, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-259 — Milestone notification events once per shipment and status; tracking milestone e-mails

| Field | Value |
|---|---|
| Stories (completes) | US-246 (M1 Should) Emit milestone notification events once per shipment and status<br>US-287 (M1 Should) Tracking milestone emails |
| REQs | REQ-TRACK-007, REQ-NOTIF-010 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-172, TASK-169 |
| Batch · locks | 8.11 · mod-tracking-events, mod-notifications |
| Branch | `feat/TASK-259-milestone-notification-events-once-per` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/tracking/milestones.*
- templates tracking.* (en/es/fr)

**Acceptance tests to write**
- All US-246 and US-287 scenarios
- AT-US-246-01 … AT-US-246-06: all 6 scenarios of US-246, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-287-01 … AT-US-287-09: all 9 scenarios of US-287, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-260 — Public tracking by customer reference plus receiver postcode

| Field | Value |
|---|---|
| Stories (completes) | US-250 (M1 Should) Public tracking by customer reference plus receiver postcode |
| REQs | REQ-TRACK-009 |
| NFRs | NFR-PRIV-004 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · opus |
| Complexity | S |
| Depends on | TASK-176, TASK-210 |
| Batch · locks | 8.11 · mod-tracking-public |
| Branch | `feat/TASK-260-public-tracking-customer-reference-plus` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/tracking/public/by-reference.*

**Acceptance tests to write**
- All US-250 scenarios
- AT-US-250-01 … AT-US-250-08: all 8 scenarios of US-250, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-261 — Accept signed carrier push notifications

| Field | Value |
|---|---|
| Stories (completes) | US-252 (M1 Should) Accept signed carrier push notifications |
| REQs | REQ-TRACK-006 |
| NFRs | NFR-SEC-013 |
| Spikes / security / decisions | PR6-SEC-08, D-ARCH-110, PR32-SEC-14, D-ORCH-039, D-TASK020-41, D-SEC-PR38-02, D-ARCH-113, PR38-SEC-03, PR48-SEC-01, PR48-SEC-06, D-ARCH-134, D-ARCH-175, D-SD-004 |
| Specialist · model | backend-developer · opus |
| Complexity | M |
| Depends on | TASK-172, TASK-113 |
| Batch · locks | 8.11 · mod-tracking-push |
| Branch | `feat/TASK-261-accept-signed-carrier-push-notifications` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/tracking/push/**

**Acceptance tests to write**
- All US-252 scenarios
- PR6-SEC-08 (binding; D-059 REQ-TRACK-006 note): `POST /webhooks/carriers/{code}` is registered only for carriers whose `capabilities().pushTracking` is true — today none of the real carriers, so the route answers 404 for DHL, FedEx and UPS and no scheme is invented for them; REQ-TRACK-006 is proven with Mock-signed fixtures (HMAC compared in constant time, timestamp/replay window, body-size cap, secret via secretRef); enabling a real carrier requires an ADR-0010 amendment documenting its authenticity mechanism; ADR-0010 am. 9 applies (a push is a hint confirmed by `track()` before any cancellation-blocking or terminal transition)
- PR32-SEC-14 / D-ARCH-110: the carrier signature authenticator builds the provider principal exactly as TASK-171 does (credential signature, no actor, only the signature-only permission of the route) and its api tests run through the real authorise (valid 200, invalid 401, a bearer on the route 401, a principal without the permission 403); SEC-TC-22 push half (D-ORCH-039; threat model T-72, AC-36; the half that TASK-172 cannot test while this route is absent): a validly signed PICKED_UP push is stored as a hint and does not block cancellation or refund until a track() poll confirms it
- D-TASK020-41 / D-SEC-PR38-02 AUTHENTICATOR CONTRACT (ADR-0008 am. 6 item 2; D-ARCH-113): the carrier signature authenticator reads X-Carrier-Signature itself (signature is not a presentable kind) and only on routes whose auth set is [signature], never authorization, cookie or x-quote-token; the provider principal permissions are built with readonlySet holding exactly the signature-only permission of the route; markCredentialsRead(res) is called together with the decision (valid, invalid, replayed, oversized body, unknown carrier code alike) and private, no-store on every 401 and 404 comes from the descriptor test; x-carrier-signature is in CREDENTIAL_HEADER_NAMES, so the push route cannot declare it in schema.headers (020-C PR38-SEC-03) and the handler reads the hint from the verified body only; api tests: markCredentialsRead called once per request, a valid Mock signature plus a bearer is accepted with the bearer never parsed (spy), the permissions view throws on mutation
- RBAC MATRIX SEAM RETIREMENT, signature kind (PR48-SEC-01 remediation 2; PR48-SEC-06; PR #48 code review R1-m3; D-ARCH-134): this task replaces the synthetic signature seam for its [signature] rows with a real signed test body (test signing secret) through the real authenticate slot, keeps the signature-header:<name> foreign callers of TASK-289 (TASK-027-F; <name>: t=0,v1=0 on every route without signature in its auth set), regenerates the matrix and passes the still-stubbed-kinds tripwire of TASK-052
- SIGNATURE REFUSALS (ADR-0016 amendment 12 item 4; D-ARCH-175): a failed signature is a 401 raised in the authentication slot and no database call precedes the verification; the wrapper of TASK-041 counts it; test: 121 bad signatures from one IP give 429 at the 121st
- AT-US-252-01 … AT-US-252-09: all 9 scenarios of US-252, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-262 — Repeat a past shipment

| Field | Value |
|---|---|
| Stories (completes) | US-260 (M1 Should) Repeat a past shipment |
| REQs | REQ-ACCT-006 |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-191 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-185, TASK-149 |
| Batch · locks | 8.11 · web-account-detail |
| Branch | `feat/TASK-262-repeat-past-shipment` |
| Priority | Should · cuttable |

**Files / modules**
- apps/web/app/features/shipment-detail/repeat/**

**Acceptance tests to write**
- All US-260 scenarios
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: repeatShipment (optional) (D-SD-007)
- AT-US-260-01 … AT-US-260-08: all 8 scenarios of US-260, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-263 — Notification preferences with consent records; suppress tracking e-mails at send time

| Field | Value |
|---|---|
| Stories (completes) | US-266 (M1 Should) Notification preferences with consent records<br>US-288 (M1 Should) Suppress tracking emails by preference at send time |
| REQs | REQ-ACCT-012, REQ-NOTIF-011 |
| NFRs | NFR-PRIV-005 |
| Spikes / security / decisions | D-ARCH-191 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-259 |
| Batch · locks | 8.12 · mod-notifications-prefs, web-account-notif |
| Branch | `feat/TASK-263-notification-preferences-consent-records-suppress` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/notifications/preferences/**
- apps/web/app/routes/account/notifications.tsx

**Acceptance tests to write**
- All US-266 and US-288 scenarios
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: replaceNotificationPreferences (optional) (D-SD-007)
- AT-US-266-01 … AT-US-266-08: all 8 scenarios of US-266, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-288-01 … AT-US-288-09: all 9 scenarios of US-288, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Job payload v2 (identifiers only), tenant context from `platform.job_context`, deterministic job IDs, retries + DLQ, idempotent effects verified by a duplicate-delivery test, metrics per queue.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-264 — Address book create, edit, delete and search; default sender address (wizard picker enabled)

| Field | Value |
|---|---|
| Stories (completes) | US-262 (M1 Should) Address book create, edit, delete and search<br>US-263 (M1 Should) Default sender address |
| REQs | REQ-ACCT-008, REQ-ACCT-009 |
| NFRs | NFR-PERF-006 |
| Spikes / security / decisions | D-PLAN-006, D-ARCH-191 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-100, TASK-159 |
| Batch · locks | 8.12 · mod-organisations-addressbook, web-account-addressbook |
| Branch | `feat/TASK-264-address-book-create-edit-delete` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/organisations/address-book/**
- apps/web/app/routes/account/address-book/**

**Acceptance tests to write**
- All US-262 and US-263 scenarios; US-175 address-book selection scenario now runs
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: createAddressBookEntry, replaceAddressBookEntry, deleteAddressBookEntry (optional) (D-SD-007)
- AT-US-262-01 … AT-US-262-12: all 12 scenarios of US-262, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)
- AT-US-263-01 … AT-US-263-08: all 8 scenarios of US-263, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-265 — No navigation or routes for out-of-scope account areas

| Field | Value |
|---|---|
| Stories (completes) | US-273 (M1 Should) No navigation or routes for out-of-scope account areas |
| REQs | REQ-ACCT-019 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-068 |
| Batch · locks | 8.12 · web-shell |
| Branch | `feat/TASK-265-no-navigation-or-routes-out` |
| Priority | Should · cuttable |

**Files / modules**
- apps/web/app/layouts/account-nav.tsx

**Acceptance tests to write**
- All US-273 scenarios
- AT-US-273-01 … AT-US-273-05: all 5 scenarios of US-273, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-266 — SES adapter verified against recorded fixtures

| Field | Value |
|---|---|
| Stories (completes) | US-275 (M1 Should) SES adapter verified against recorded fixtures |
| REQs | REQ-NOTIF-002 |
| NFRs | — |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-074, TASK-113 |
| Batch · locks | 8.12 · mod-notifications-ses |
| Branch | `feat/TASK-266-ses-adapter-verified-against-recorded` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/notifications/provider/ses-provider.ts

**Acceptance tests to write**
- All US-275 scenarios
- AT-US-275-01 … AT-US-275-06: all 6 scenarios of US-275, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-267 — Per-user notification log with PII minimisation (masked recipient)

| Field | Value |
|---|---|
| Stories (completes) | US-289 (M1 Should) Per-user notification log with PII minimisation |
| REQs | REQ-NOTIF-012 |
| NFRs | NFR-PRIV-004 |
| Spikes / security / decisions | D-040 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-078, TASK-263 |
| Batch · locks | 8.13 · mod-notifications-log |
| Branch | `feat/TASK-267-per-user-notification-log-pii` |
| Priority | Should · cuttable |

**Files / modules**
- apps/api/src/modules/notifications/log/**

**Acceptance tests to write**
- All US-289 scenarios
- AT-US-289-01 … AT-US-289-12: all 12 scenarios of US-289, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

### TASK-268 — Locale, display currency and unit preferences

| Field | Value |
|---|---|
| Stories (completes) | US-272 (M1 Should) Locale, display currency and unit preferences |
| REQs | REQ-ACCT-018 |
| NFRs | — |
| Spikes / security / decisions | D-ARCH-191 |
| Specialist · model | frontend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-062, TASK-230 |
| Batch · locks | 8.13 · web-account-prefs |
| Branch | `feat/TASK-268-locale-display-currency-unit-preferences` |
| Priority | Should · cuttable |

**Files / modules**
- apps/web/app/routes/account/preferences.tsx

**Acceptance tests to write**
- All US-272 scenarios
- PRECONDITION PART 040-B (ADR-0014 amendment 9; D-ARCH-191): this task mounts an operation whose x-idempotency is required or optional, so part 040-B of TASK-040 is on main before this task is dispatched; without it the composition refuses the route at mount (IdempotencyNotWiredError); operations of this task in openapi.yaml: updateMe (optional) (D-SD-007)
- AT-US-272-01 … AT-US-272-08: all 8 scenarios of US-272, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- All strings in en/es/fr (no literals; ICU), six screen states where applicable, 360 px and 1280 px layouts, tokens only, axe 0 serious/critical in every state, keyboard path and visible focus, Playwright spec (Chromium on `pr`; three engines at wave end), `can()` gating for permissioned actions.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
