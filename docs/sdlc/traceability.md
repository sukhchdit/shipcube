# Traceability Matrix
Version 1.5 · 2026-11-13 · maintained by product-manager (P1), extended by principal-architect (Design), senior-developer (Tasks), qa-lead (Tests).
v1.5 (D-061, US-049 delivery split after PR #13 code review M1): REQ-DATA-001 and REQ-DATA-002 Task(s) now read `TASK-023, TASK-014, TASK-089` with a "Planned (partial …)" status naming which AT-US-049 scenarios each task owns; US-049 becomes Implemented only when all three tasks are merged. No REQ or story IDs, links, priorities, milestones or DC tags changed; every count below is unchanged.
Status values: Specified → Designed → Planned → Implemented → Verified.
v1.4 (G2-C2 closure, principal-architect): the Design (ADR/Spec) column is populated for all 434 REQ rows as "owning module · ADR or spec section" (generated from `ARCHITECTURE.md` §6 and the ADR amendment index with an explicit per-REQ mapping, then reviewed row by row; no REQ carries only an area default) and every REQ status moved Specified → Designed. Task(s) stays "–" until senior-developer/orchestrator fill it in P4 (→ Planned); Test(s) is qa-lead's. No REQ or story IDs, links, priorities, milestones or DC tags changed; counts below are unchanged.
v1.3 (P3 security remediation, D-046..D-052, see PRD §11): REQ-AUTH-020/021/022 Should → Must; new REQ-AUTH-025 (M1 Must), REQ-AUTH-026 (M0 Must), REQ-CARR-022 and REQ-CARR-023 (M1 Must); new Must stories US-291 (EPIC-02, M1), US-292 (EPIC-02, M0), US-293 (EPIC-06, M1); US-027 Should → Must. None of the new or promoted stories is demo-critical (DC set unchanged at 134). Tables below regenerated from the files on 2026-11-12.
v1.2 (P3 alignment, D-038..D-045): wording-only amendments to REQUIREMENTS.md 1.2, NFR.md 1.2 and the stories (see PRD §11); no REQ or story IDs, links, priorities, milestones or DC tags changed, so every count below is unchanged and was re-verified against the files on 2026-11-12. The Design column is populated by principal-architect at G2.
v1.1 (G1 condition closure): tags corrected per D-036; DC (demo-critical) column added to "Story → Requirement" per D-037; early-delivery notes and NFR traceability link added.

## Summary
| Metric | Value |
|---|---|
| Total REQs | 434 (324 Must · 91 Should · 19 Could; 205 M0 · 229 M1) |
| REQs linked by ≥1 story | 434 |
| Orphan REQs | 0 |
| Total stories | 293 |
| Stories per MoSCoW | Must 218 · Should 67 · Could 8 |
| Stories per milestone | M0 120 · M1 173 |
| Demo-critical (DC) stories (D-037) | 134 (M0 74 · M1 60) of 218 Must |
| Must REQs not linked by a Must story | 0 |

**Early delivery (G1-C2 note).** Four M1 REQs are delivered by M0 stories and are therefore available from R0: REQ-DATA-014 (FX seed) by US-052, REQ-SEC-008 (Joi/Zod parity) by US-046, REQ-QUOTE-004 (package limits) by US-156 (all Must), and REQ-AUDIT-018 (archiver seam, Could) by US-100 (Should). Their M1 tag is kept because M1 is the first milestone that needs them; the R0 regression may already exercise them. These are the only REQs whose milestone differs from every linked story (verified 2026-11-12).

| Epic | File | Stories | Must | Should | Could | M0 | M1 |
|---|---|---|---|---|---|---|---|
| EPIC-01 | stories/EPIC-01-platform-foundation.md | 14 | 12 | 2 | 0 | 14 | 0 |
| EPIC-02 | stories/EPIC-02-identity-sessions.md | 21 | 17 | 4 | 0 | 17 | 4 |
| EPIC-03 | stories/EPIC-03-organisations-rbac-tenancy.md | 25 | 19 | 6 | 0 | 19 | 6 |
| EPIC-04 | stories/EPIC-04-audit-trail-viewer.md | 15 | 13 | 2 | 0 | 14 | 1 |
| EPIC-05 | stories/EPIC-05-design-system-shells-i18n.md | 20 | 17 | 3 | 0 | 14 | 6 |
| EPIC-06 | stories/EPIC-06-carrier-integration.md | 18 | 18 | 0 | 0 | 6 | 12 |
| EPIC-07 | stories/EPIC-07-pricing-engine.md | 16 | 13 | 2 | 1 | 3 | 13 |
| EPIC-08 | stories/EPIC-08-quote-and-comparison.md | 17 | 11 | 6 | 0 | 3 | 14 |
| EPIC-09 | stories/EPIC-09-booking-wizard-customs-basket.md | 26 | 18 | 8 | 0 | 1 | 25 |
| EPIC-10 | stories/EPIC-10-payments-booking-saga.md | 23 | 18 | 5 | 0 | 9 | 14 |
| EPIC-11 | stories/EPIC-11-documents.md | 12 | 7 | 4 | 1 | 0 | 12 |
| EPIC-12 | stories/EPIC-12-pickup-and-dropoff.md | 9 | 6 | 2 | 1 | 0 | 9 |
| EPIC-13 | stories/EPIC-13-tracking.md | 13 | 9 | 3 | 1 | 0 | 13 |
| EPIC-14 | stories/EPIC-14-customer-account.md | 20 | 4 | 13 | 3 | 0 | 20 |
| EPIC-15 | stories/EPIC-15-notifications.md | 17 | 11 | 5 | 1 | 0 | 17 |
| EPIC-16 | stories/EPIC-16-api-conventions-security.md | 15 | 14 | 1 | 0 | 15 | 0 |
| EPIC-17 | stories/EPIC-17-reference-data-compliance-packs.md | 12 | 11 | 1 | 0 | 5 | 7 |
| **Total** | 17 files | 293 | 218 | 67 | 8 | 120 | 173 |

## Requirement → Story
| REQ | MS | MoSCoW | Story | Design (ADR/Spec) | Task(s) | Test(s) | Status |
|---|---|---|---|---|---|---|---|
| REQ-PLAT-001 | M0 | Must | US-001 | platform · ADR-0002 §Workspaces (monorepo layout); ARCHITECTURE §11 blueprint | TASK-001, TASK-002 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-PLAT-002 | M0 | Must | US-001 | platform · ADR-0003 §Layering (routes → controller → service → repository, `eslint-plugin-boundaries`); ADR-0002 §5 | TASK-001, TASK-002 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-PLAT-003 | M0 | Must | US-001 | platform · ADR-0001 (TypeScript 6 strict); ADR-0002 §Scripts (`tsc -b`, root scripts) | TASK-001, TASK-002 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-PLAT-004 | M0 | Must | US-002 | packages/config · ADR-0018 §Typed configuration (Joi schema, fail-fast, `.env.example` parity) | TASK-005 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-PLAT-005 | M0 | Must | US-003 | infra/ (compose) · platform.md §2 Compose stack (`--wait` ≤ 180 s); ADR-0021 (RustFS); ADR-0001 (Valkey 8) | TASK-014, TASK-026, TASK-089 | – | Planned |
| REQ-PLAT-006 | M0 | Must | US-004 | infra/ (Dockerfiles) · platform.md §3 hardened images; ADR-0022; ADR-0023 am. F (`npm ci --ignore-scripts`) | TASK-014 | – | Planned |
| REQ-PLAT-007 | M0 | Must | US-005 | .github/ · ADR-0023 §1 + am. A–D lane model (D-ORCH-001); platform.md §7 | TASK-007 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-PLAT-008 | M0 | Must | US-006 | .github/ · ADR-0024 (Jest thresholds 85/75, 95 on pricing/audit/authz); ADR-0023 am. A diff-coverage gate | TASK-015 | – | Planned |
| REQ-PLAT-009 | M0 | Must | US-007 | platform · ADR-0016 §3 single problem+json error handler; api/README §3 | TASK-006 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-PLAT-010 | M0 | Must | US-007 | platform · ADR-0016 §3 framework-failure codes; api/README §11 error catalogue | TASK-006 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-PLAT-011 | M0 | Must | US-008 | platform · ADR-0017 §1–2 correlation ID (validate, generate, echo) | TASK-010 | – | Planned |
| REQ-PLAT-012 | M0 | Must | US-008 | platform · ADR-0017 §1 Pino JSON fields and redaction | TASK-010 | – | Planned |
| REQ-PLAT-013 | M0 | Must | US-009 | platform (worker) · ADR-0013 §Queues (attempts 5, exponential backoff + jitter, DLQ per queue) | TASK-035 | – | Planned |
| REQ-PLAT-014 | M0 | Must | US-010 | platform (worker) · ADR-0013 §Idempotent processors (deterministic job IDs, `job_executions`); data-model §3.5 | TASK-039 | – | Planned |
| REQ-PLAT-015 | M0 | Must | US-010 | platform (worker) · ADR-0013 §Repeatable jobs (idempotent registration) | TASK-039 | – | Planned |
| REQ-PLAT-016 | M0 | Must | US-011 | platform · ADR-0004 §Outbox write (same transaction); data-model §6.1 | TASK-043 | – | Planned |
| REQ-PLAT-017 | M0 | Must | US-011 | platform (worker) · ADR-0004 §Relay (at-least-once, per-aggregate order, 500 ms); data-model §6.1 | TASK-043 | – | Planned |
| REQ-PLAT-018 | M0 | Must | US-012 | platform · ADR-0013 §7 / ADR-0017 §5 `/health/live`, `/health/ready` (≤ 2 s per dependency) | TASK-006 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-PLAT-019 | M0 | Should | US-013 | platform · ADR-0017 §4 OpenTelemetry seam (`OTEL_*` config, BullMQ spans) | TASK-214 | – | Planned |
| REQ-PLAT-020 | M0 | Should | US-014 | admin-settings · ADR-0027 §Feature flags (DB-backed, 30 s cache); data-model §3.5 | TASK-219 | – | Planned |
| REQ-PLAT-021 | M0 | Should | US-014 | admin-settings · ADR-0027 (`CONFIG_CHANGE` audit on every flag change); ADR-0007 §Capture | TASK-219 | – | Planned |
| REQ-PLAT-022 | M0 | Could | US-013 | platform · ADR-0013 §7 graceful shutdown (SIGTERM drain ≤ 30 s); ADR-0017 §5 | TASK-214 | – | Planned |
| REQ-AUTH-001 | M0 | Must | US-015 | identity · ADR-0006 §Registration (one tx: user + INDIVIDUAL org + terms); am. 10/15 (identical 202, RR-16); data-model §3.1 | TASK-049, TASK-072 | – | Planned |
| REQ-AUTH-002 | M0 | Must | US-015 | identity · ADR-0006 §Passwords (12–128 chars, offline breached list) | TASK-049, TASK-072 | – | Planned |
| REQ-AUTH-003 | M0 | Must | US-015 | identity · ADR-0006 §Passwords (bcrypt cost ≥ 12, prefix test) | TASK-049, TASK-072 | – | Planned |
| REQ-AUTH-004 | M0 | Must | US-016 | identity · ADR-0006 §Email verification (256-bit hashed token, 24 h); am. 15 (verification revokes other sessions, D-050) | TASK-059, TASK-072 | – | Planned |
| REQ-AUTH-005 | M0 | Must | US-017 | identity · ADR-0006 §Tokens (15-min ES256 access JWT, refresh cookie) | TASK-052, TASK-072 | – | Planned |
| REQ-AUTH-006 | M0 | Must | US-018 | identity · ADR-0006 §Tokens/§CSRF (`__Host-rt` HttpOnly Secure SameSite=Strict cookie, path scoped) | TASK-055 | – | Planned |
| REQ-AUTH-007 | M0 | Must | US-018 | identity · ADR-0006 §Tokens rotation + am. 12 (30-day sliding inside 30-day absolute cap, `SESSION_EXPIRED`) | TASK-055 | – | Planned |
| REQ-AUTH-008 | M0 | Must | US-018 | identity · ADR-0006 §Reuse detection (family revocation, `TOKEN_REUSE_DETECTED`); ARCHITECTURE §7.4 | TASK-055 | – | Planned |
| REQ-AUTH-009 | M0 | Must | US-019 | identity · ADR-0006 §Logout (cookie cleared, family revoked); ADR-0007 (`LOGOUT` audit) | TASK-095 | – | Planned |
| REQ-AUTH-010 | M0 | Must | US-020 | apps/web + apps/admin · ADR-0026 §5 auth in the browser (token in memory, single-flight silent refresh) | TASK-065 | – | Planned |
| REQ-AUTH-011 | M0 | Must | US-021 | identity · ADR-0006 §Password reset (identical 202, `#token=` link per am. 9) | TASK-099, TASK-117 | – | Planned |
| REQ-AUTH-012 | M0 | Must | US-021 | identity · ADR-0006 §Password reset (revoke sessions, notify); am. 15 (redeemed reset verifies the mailbox, D-050) | TASK-099, TASK-117 | – | Planned |
| REQ-AUTH-013 | M0 | Must | US-022 | identity · ADR-0006 §Lockout (progressive delay after 5 failures) | TASK-103, TASK-117 | – | Planned |
| REQ-AUTH-014 | M0 | Must | US-022 | identity · ADR-0006 §Lockout (15-min lock after 10 failures, `ACCOUNT_LOCKED` event) | TASK-103, TASK-117 | – | Planned |
| REQ-AUTH-015 | M0 | Must | US-023 | identity · ADR-0006 §TOTP (`otplib`, RFC 6238); am. 11 (client-side QR with `uqr`, D-ARCH-013) | TASK-057 | – | Planned |
| REQ-AUTH-016 | M0 | Must | US-023 | identity · ADR-0006 §Recovery codes (10 single-use, hashed) | TASK-057 | – | Planned |
| REQ-AUTH-017 | M0 | Must | US-024 | identity · ADR-0006 §MFA challenge (401 `MFA_REQUIRED`, challenge token, per-user MFA lock) | TASK-061, TASK-072 | – | Planned |
| REQ-AUTH-018 | M0 | Must | US-025 | identity · ADR-0006 §Staff gate + am. 14 (enrolment e-mail code, 24 h deadline via `housekeeping`, `ops:staff-reactivate`) | TASK-063 | – | Planned |
| REQ-AUTH-019 | M1 | Should | US-026 | identity · ADR-0006 §TOTP (customer enable/disable behind re-auth scope `mfa.totp.disable`) | TASK-223, TASK-228 | – | Planned |
| REQ-AUTH-020 | M1 | Must | US-026, US-291 | identity · ADR-0006 am. 12 step-up (`createReauthProof`, `X-Reauth-Proof`, scopes); ADR-0016 am. 8 | TASK-187, TASK-197, TASK-223, TASK-228 | – | Planned |
| REQ-AUTH-021 | M1 | Must | US-027 | identity · ADR-0006 §Sessions (list with parsed UA, current marker); data-model §3.1 sessions; D-047 | TASK-186, TASK-193 | – | Planned |
| REQ-AUTH-022 | M1 | Must | US-027 | identity · ADR-0006 §Sessions (remote sign-out, Redis revocation set ≤ 5 s) | TASK-186, TASK-193 | – | Planned |
| REQ-AUTH-023 | M1 | Should | US-028 | identity · ADR-0006 §Password change (re-auth scope `auth.password.change`, other sessions revoked) | TASK-223, TASK-228 | – | Planned |
| REQ-AUTH-024 | M0 | Should | US-029 | identity · ADR-0006 §Status checks (SUSPENDED/DEACTIVATED → generic `INVALID_CREDENTIALS`) | TASK-220 | – | Planned |
| REQ-AUTH-025 | M1 | Must | US-291 | identity · ADR-0006 am. 12 (`auth_time` claim, `x-reauth-max-age`, `sessions.authenticated_at`); ADR-0016 am. 8 | TASK-187, TASK-197 | – | Planned |
| REQ-AUTH-026 | M0 | Must | US-292 | identity · ADR-0006 am. 15 (`AUTH_UNVERIFIED_TTL=7d`, `housekeeping` deactivation, address freed); D-050 | TASK-107 | – | Planned |
| REQ-ORG-001 | M0 | Must | US-061 | organisations · data-model §3.2 organisations (`type` enum); ADR-0005 §Tenant model | TASK-037 | – | Planned |
| REQ-ORG-002 | M0 | Must | US-062 | organisations · ADR-0006 §Registration (personal INDIVIDUAL org, user = Owner); data-model §3.2 | TASK-037 | – | Planned |
| REQ-ORG-003 | M0 | Must | US-062 | organisations · data-model §3.2 memberships (role set); ADR-0008 §Roles | TASK-037 | – | Planned |
| REQ-ORG-004 | M0 | Must | US-062 | organisations · ADR-0008 §Roles per organisation type; data-model §3.3 authz | TASK-037 | – | Planned |
| REQ-ORG-005 | M0 | Must | US-063 | organisations · ADR-0005 §Context (one active org per request, `app.org_id`); ADR-0006 §Tokens (org claim) | TASK-056 | – | Planned |
| REQ-ORG-006 | M1 | Should | US-081 | organisations · ADR-0006 §Tokens (org switch re-issues tokens); ADR-0005 §Context | TASK-224 | – | Planned |
| REQ-ORG-007 | M0 | Must | US-064 | platform · ADR-0009 §Standard columns (`created_by`/`updated_by` stamping extension); data-model P-rules | TASK-032 | – | Planned |
| REQ-ORG-008 | M1 | Should | US-082 | organisations · data-model §3.2 organisations profile; api/openapi `updateOrganisation` (`org:update`) | TASK-224 | – | Planned |
| REQ-ORG-009 | M1 | Should | US-082 | organisations · data-model §3.2; api/openapi `createOrganisation` (creator = Owner) | TASK-224 | – | Planned |
| REQ-ORG-010 | M1 | Should | US-083 | organisations · data-model §3.2 invitations; ADR-0006 am. 12 (`org.member.manage`, `x-reauth-max-age: 43200`) | TASK-227 | – | Planned |
| REQ-ORG-011 | M1 | Should | US-084 | organisations · data-model §3.2 invitations (verified e-mail match); ADR-0006 am. 9 (`#token=` links) | TASK-227 | – | Planned |
| REQ-ORG-012 | M1 | Should | US-085 | organisations · ADR-0008 §Roles; ADR-0006 am. 12 step-up; data-model §3.2 memberships (suspend/remove) | TASK-231 | – | Planned |
| REQ-ORG-013 | M1 | Should | US-085 | organisations · ADR-0016 am. 5(f) (`LAST_OWNER` 422); data-model §3.2 owner invariant | TASK-231 | – | Planned |
| REQ-ORG-014 | M1 | Should | US-085 | organisations · data-model §3.2 (INDIVIDUAL single-membership constraint) | TASK-231 | – | Planned |
| REQ-RBAC-001 | M0 | Must | US-065 | packages/authz · ADR-0008 §Permission catalogue (`PERMISSIONS` typed constants) | TASK-013 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-RBAC-002 | M0 | Must | US-066 | packages/authz + prisma/ · ADR-0008 §Role seed (operator roles); data-model §9 seed plan | TASK-013 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-RBAC-003 | M0 | Should | US-066 | packages/authz · ADR-0008 §Role seed (partner roles); ADR-0011 partner seam | TASK-013 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-RBAC-004 | M0 | Must | US-066 | packages/authz · ADR-0008 §Build-time tests (Super Admin holds all; Viewer exclusions, D-051) | TASK-013 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-RBAC-005 | M0 | Must | US-067 | platform · ADR-0003 §Route metadata (`defineRoute` refuses routes without permission); ADR-0008 | TASK-020 | – | Planned |
| REQ-RBAC-006 | M0 | Must | US-068 | platform · ADR-0003 §Request pipeline (authenticate → authorise → validate → execute → audit) | TASK-060 | – | Planned |
| REQ-RBAC-007 | M0 | Must | US-069 | packages/authz + packages/audit · ADR-0008; ADR-0007 §Capture (`PERMISSION_DENIED` entry, `permission_denied` event) | TASK-104 | – | Planned |
| REQ-RBAC-008 | M0 | Must | US-068 | packages/authz · ADR-0008 §Resolution (server-side effective permissions, 5 s authz cache) | TASK-060 | – | Planned |
| REQ-RBAC-009 | M0 | Must | US-070 | packages/ui + apps · ADR-0026 §5 `can()` helper; api/openapi `getMe` permissions | TASK-064 | – | Planned |
| REQ-RBAC-010 | M0 | Must | US-070 | apps/web + apps/admin · ADR-0026 §5 route guards (permission-denied state without fetch) | TASK-064 | – | Planned |
| REQ-RBAC-011 | M0 | Must | US-071 | packages/authz · ADR-0008 §Matrix generator (route × role, 401, cross-tenant 404); ADR-0024 | TASK-027 | – | Planned |
| REQ-RBAC-012 | M1 | Must | US-072 | packages/authz · ADR-0008 (`*:download`/`*:export` permissions); ADR-0021 (presign only after permission) | TASK-162 | – | Planned |
| REQ-RBAC-013 | M0 | Should | US-073 | packages/authz + prisma/ · ADR-0008 §Versioned seeds/migrations only; data-model §8 | TASK-221 | – | Planned |
| REQ-RBAC-014 | M0 | Must | US-065 | packages/authz · ADR-0008 §Catalogue completeness test (every referenced string declared) | TASK-013 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-AUDIT-001 | M0 | Must | US-086 | packages/audit · ADR-0007 §Capture (metadata-driven middleware, allow-listed direct callers); ADR-0003 | TASK-029 | – | Planned |
| REQ-AUDIT-002 | M0 | Must | US-087 | packages/audit · ADR-0007 §Capture (action types incl. `STATE_TRANSITION`, `CONFIG_CHANGE`) | TASK-025 | – | Planned |
| REQ-AUDIT-003 | M0 | Must | US-087 | packages/audit · ADR-0007 §Storage columns; data-model §3.4 `audit_entries` | TASK-025 | – | Planned |
| REQ-AUDIT-004 | M0 | Must | US-088 | packages/audit · ADR-0007 §Capture (same transaction, 500 `AUDIT_WRITE_FAILED`); ARCHITECTURE §7.3 | TASK-025 | – | Planned |
| REQ-AUDIT-005 | M0 | Must | US-089 | packages/audit · ADR-0007 §Capture (fail-closed SENSITIVE views/downloads, 503 `AUDIT_UNAVAILABLE`) | TASK-114 | – | Planned |
| REQ-AUDIT-006 | M0 | Must | US-086 | platform · ADR-0003 §Route metadata audit descriptor; ADR-0016 am. 5(c) (`NONE` justifications) | TASK-029 | – | Planned |
| REQ-AUDIT-007 | M0 | Must | US-090 | packages/audit · ADR-0007 §Capture (RFC 8785 field-level diffs) | TASK-031 | – | Planned |
| REQ-AUDIT-008 | M0 | Must | US-091 | packages/audit · ADR-0007 §Redaction (`[REDACTED]` before hashing) | TASK-028 | – | Planned |
| REQ-AUDIT-009 | M0 | Must | US-091 | packages/audit · ADR-0007 §Redaction and classification (registry, build-time completeness test) | TASK-028 | – | Planned |
| REQ-AUDIT-010 | M0 | Must | US-088 | packages/audit · ADR-0007 §Capture (`DENIED`/`FAILED` outcomes in their own transaction) | TASK-025 | – | Planned |
| REQ-AUDIT-011 | M0 | Must | US-087 | packages/audit · ADR-0007 §Capture (actor types, sources from `X-Client-App`) | TASK-025 | – | Planned |
| REQ-AUDIT-012 | M0 | Must | US-092 | packages/audit · ADR-0007 §Hash chain (per-stream SHA-256, advisory lock, sharded SYSTEM); data-model §5.4 | TASK-030 | – | Planned |
| REQ-AUDIT-013 | M0 | Must | US-093 | audit (worker) · ADR-0007 §Hash chain verification + am. 7 (hourly ECDSA anchors); data-model §5.5/§5.6 | TASK-116 | – | Planned |
| REQ-AUDIT-014 | M0 | Must | US-094 | prisma/ (bootstrap lane) · ADR-0007 §Storage immutability + am. 7–8 (`platform_audit_owner`, `search_path` hardening); data-model §4.4/§5.2 | TASK-021, TASK-033 | – | Planned |
| REQ-AUDIT-015 | M0 | Must | US-094 | prisma/ + tests · ADR-0007 §Storage (UPDATE/DELETE/TRUNCATE per role); data-model §4.6 C13/C14; SEC-TC-43/61 | TASK-021, TASK-033 | – | Planned |
| REQ-AUDIT-016 | M0 | Must | US-095 | prisma/ · ADR-0007 §Storage (monthly range partitions, prune test); data-model §5.1 | TASK-021, TASK-090 | – | Planned |
| REQ-AUDIT-017 | M0 | Must | US-095 | audit (worker) · ADR-0007 §Storage (`ensure_audit_partitions`, daily `audit-maintenance`); data-model §5.3 | TASK-021, TASK-090 | – | Planned |
| REQ-AUDIT-018 | M1 | Could | US-100 | audit · ADR-0007 §Archive seam (`AuditArchiver`, `archived_at`, manifest) | TASK-222 | – | Planned |
| REQ-AUDIT-019 | M0 | Must | US-097 | audit module + apps/admin · ADR-0007 §Viewer (keyset list, filters, ≤ 31 d range); ADR-0026 §1 | TASK-073, TASK-081 | – | Planned |
| REQ-AUDIT-020 | M0 | Must | US-098 | audit module + apps/admin · ADR-0007 §Viewer (detail: diff, hashes, vault tokens) | TASK-073, TASK-081 | – | Planned |
| REQ-AUDIT-021 | M1 | Should | US-099 | audit module + apps/admin · ADR-0007 §Viewer (entity history) | TASK-225 | – | Planned |
| REQ-AUDIT-022 | M0 | Must | US-098 | audit module · ADR-0007 §Viewer (one `VIEW` entry per viewer request, fail-closed) | TASK-073, TASK-081 | – | Planned |
| REQ-AUDIT-023 | M0 | Must | US-097 | audit module · ADR-0007 §Viewer (`audit:read` only); ADR-0005 operator cross-tenant branch | TASK-073, TASK-081 | – | Planned |
| REQ-AUDIT-024 | M0 | Must | US-096 | packages/audit · ADR-0007 §Consequences (audit test generator over route metadata); ADR-0024 | TASK-033 | – | Planned |
| REQ-AUDIT-025 | M0 | Should | US-100 | platform · ADR-0003 §Route metadata (`reasonRequired` → 422 `REASON_REQUIRED`); ADR-0007 §Viewer | TASK-222 | – | Planned |
| REQ-RLS-001 | M0 | Must | US-074 | prisma/ · ADR-0005 §Tenant tables (`org_id`, composite indexes, global-table list); data-model §4.1, C-tests | TASK-003, TASK-016 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-RLS-002 | M0 | Must | US-074 | prisma/ · ADR-0005 §Policies (`ENABLE` + `FORCE` RLS, policy templates); data-model §4.3 | TASK-003, TASK-016 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-RLS-003 | M0 | Must | US-075 | platform · ADR-0005 §Context (`withTenantTx`, `set_config` first statement); ADR-0003 | TASK-016 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-RLS-004 | M0 | Must | US-075 | prisma/ · ADR-0005 §Policies (unset context → zero rows, writes rejected); data-model §4.3 | TASK-016 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-RLS-005 | M0 | Must | US-074 | prisma/ · ADR-0005 §Roles (`platform_app` NOSUPERUSER NOBYPASSRLS); data-model §4.4 | TASK-003, TASK-016 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-RLS-006 | M0 | Must | US-076 | prisma/ · ADR-0005 §Operator branch (read-only cross-tenant policy); data-model §4.3 | TASK-060 | – | Planned |
| REQ-RLS-007 | M0 | Must | US-077 | prisma/ + tests · ADR-0005 §Verification (generated cross-tenant suite); data-model §4.6 catalog tests | TASK-024 | – | Planned |
| REQ-RLS-008 | M0 | Must | US-078 | platform (worker) · ADR-0013 am. 1–5 (`platform.job_context`, payload v2); ADR-0005; data-model §4.5 | TASK-047 | – | Planned |
| REQ-RLS-009 | M0 | Must | US-064 | prisma/ · ADR-0009 §Standard columns (UUIDv7, `timestamptz`, actor stamps); data-model P1/P2 | TASK-032 | – | Planned |
| REQ-RLS-010 | M0 | Must | US-079 | prisma/ · ADR-0009 §Soft delete (partial unique indexes); ADR-0005 (no DELETE grant); data-model P3 | TASK-100 | – | Planned |
| REQ-RLS-011 | M0 | Must | US-079 | platform · ADR-0009 §Optimistic locking (`version`, conditional UPDATE → 409/412); ADR-0016 §6 | TASK-100 | – | Planned |
| REQ-RLS-012 | M0 | Must | US-064 | prisma/ · ADR-0009 §Time (`timestamptz` UTC; local `date` + IANA zone); data-model P-rules | TASK-032 | – | Planned |
| REQ-RLS-013 | M0 | Must | US-080 | prisma/ · ADR-0005 §Guest-capable tables (null `org_id`, `ck_<t>__owner`, guest claim policy); data-model §3.10 | TASK-051 | – | Planned |
| REQ-DATA-001 | M0 | Must | US-049 | prisma/ (seed) · data-model §9 seed plan (idempotent upsert by natural key) | TASK-023, TASK-014, TASK-089 | – | Planned |
| REQ-DATA-002 | M0 | Must | US-049 | prisma/ (seed) · ADR-0018 (`SEED_*` env); ADR-0006 am. 14 (non-local staff created without passwords); data-model §9 | TASK-023, TASK-014, TASK-089 | – | Planned |
| REQ-DATA-003 | M0 | Must | US-050 | prisma/ (seed) · data-model §9 (operator org with 8 role users, demo organisations) | TASK-089 | – | Planned |
| REQ-DATA-004 | M0 | Must | US-051 | admin-settings + prisma/ · data-model §3.6 countries (ISO 3166-1, names en/es/fr); §9 | TASK-026 | – | Planned |
| REQ-DATA-005 | M0 | Must | US-051 | admin-settings · data-model §3.6 countries (`shipping_enabled` launch set, D-007) | TASK-026 | – | Planned |
| REQ-DATA-006 | M0 | Must | US-052 | admin-settings · data-model §3.6 currencies; ADR-0009 §Money (ISO 4217 minor units) | TASK-066 | – | Planned |
| REQ-DATA-007 | M0 | Must | US-051 | admin-settings · data-model §3.6 subdivisions (US/IN/CA; D-013) | TASK-026 | – | Planned |
| REQ-DATA-008 | M1 | Must | US-054 | admin-settings · data-model §3.6 holidays 2026–2027; ADR-0009 §Time (local dates) | TASK-122 | – | Planned |
| REQ-DATA-009 | M1 | Must | US-054 | admin-settings · data-model §3.8 carrier_services transit ranges | TASK-122 | – | Planned |
| REQ-DATA-010 | M1 | Must | US-054 | customs · data-model §3.18 HS headings seed (≥ 200, keyword index) | TASK-122 | – | Planned |
| REQ-DATA-011 | M1 | Must | US-055 | customs · data-model §3.18 prohibited/restricted items per country and carrier | TASK-196 | – | Planned |
| REQ-DATA-012 | M1 | Must | US-054 | customs · data-model §3.18 export reasons | TASK-122 | – | Planned |
| REQ-DATA-013 | M1 | Must | US-054 | customs · data-model §3.18 Incoterms 2020 | TASK-122 | – | Planned |
| REQ-DATA-014 | M1 | Must | US-052 | pricing · data-model §3.9 `fx_rates` snapshot; ADR-0015 §FX; ADR-0009 §Money (NUMERIC(18,6)) | TASK-066 | – | Planned |
| REQ-DATA-015 | M1 | Must | US-056 | admin-settings · ADR-0009 §Numbering (per-origin-country sequence); data-model §6.4 `number_sequences` | TASK-126 | – | Planned |
| REQ-DATA-016 | M0 | Must | US-053 | admin-settings · api/README §4 bounded lists (`x-max-limit`, ADR-0016 am. 5(d)); data-model §3.6 | TASK-026, TASK-070 | – | Planned |
| REQ-DATA-017 | M1 | Could | US-056 | admin-settings · data-model §3.9 zones seam (empty tables for M2 rate cards); ADR-0015 §Seams | TASK-126 | – | Planned |
| REQ-COMP-001 | M1 | Must | US-057 | compliance · data-model §3.7 compliance packs (versioned per country); ARCHITECTURE §6 `CompliancePackResolver` | TASK-123 | – | Planned |
| REQ-COMP-002 | M1 | Must | US-057 | compliance · data-model §3.7 (published versions immutable; new version on change) | TASK-123 | – | Planned |
| REQ-COMP-003 | M1 | Must | US-058 | compliance · data-model §3.7 + §9 seed (US/IN/GB/CA packs, EU template) | TASK-127 | – | Planned |
| REQ-COMP-004 | M1 | Must | US-059 | compliance · data-model §3.7 (`reviewed_at` null → `unreviewed: true`); api/openapi `CompliancePack` | TASK-130 | – | Planned |
| REQ-COMP-005 | M1 | Must | US-059 | packages/pricing · ADR-0015 §Tax (pack-resolved rule, display mode, pack version in snapshot); data-model §3.7 | TASK-130 | – | Planned |
| REQ-COMP-006 | M1 | Must | US-059 | compliance + customs · data-model §3.7 de-minimis threshold and document exemption; ADR-0015 §FX conversion | TASK-130 | – | Planned |
| REQ-COMP-007 | M1 | Should | US-060 | compliance · data-model §3.7 privacy notices per country/locale; ADR-0026 §1 (pre-rendered legal pages) | TASK-229 | – | Planned |
| REQ-COMP-008 | M1 | Should | US-058 | compliance · ADR-0007 §Capture (`CONFIG_CHANGE` on pack load/version); data-model §3.7 | TASK-127 | – | Planned |
| REQ-UI-001 | M0 | Must | US-101 | packages/ui · ADR-0025 (Tailwind 4 + DTCG tokens); docs/02-ux tokens.json | TASK-038 | – | Planned |
| REQ-UI-002 | M0 | Must | US-102 | packages/ui · ADR-0026 §3 themes (`prefers-color-scheme`, persisted preference) | TASK-098 | – | Planned |
| REQ-UI-003 | M0 | Must | US-103 | packages/ui · ADR-0026 §3 control sizes (36 px pointer / 44 px coarse); ADR-0025 tokens | TASK-046 | – | Planned |
| REQ-UI-004 | M0 | Must | US-103 | packages/ui · ADR-0026 §3 component states (default/hover/focus-visible/active/disabled); ADR-0025 | TASK-046 | – | Planned |
| REQ-UI-005 | M0 | Must | US-103 | packages/ui · ADR-0026 §3 reduced motion (`--motion-duration: 0ms`, `useReducedMotion`); am. 7 (motion not adopted) | TASK-046 | – | Planned |
| REQ-UI-006 | M0 | Must | US-104 | packages/ui + apps · ADR-0026 §6 `ScreenState` (loading/empty/error/offline/denied/success) | TASK-054 | – | Planned |
| REQ-UI-007 | M0 | Must | US-104 | apps/web + apps/admin · ADR-0026 §5 permission-denied state; ADR-0008 | TASK-054 | – | Planned |
| REQ-UI-008 | M0 | Must | US-105 | apps/web + apps/admin · ADR-0026 §6 offline detection and retry | TASK-102 | – | Planned |
| REQ-UI-009 | M0 | Must | US-105 | packages/ui · ADR-0026 §3 toasts (live region, dismissible) | TASK-102 | – | Planned |
| REQ-UI-010 | M0 | Must | US-106 | apps/web + apps/admin · ADR-0026 §4 Zod forms (shared constants with Joi, ADR-0016 §4) | TASK-058 | – | Planned |
| REQ-UI-011 | M0 | Must | US-107 | packages/ui · ADR-0026 §3 breakpoints 360/768/1024/1280/1536; ADR-0025 tokens | TASK-053 | – | Planned |
| REQ-UI-012 | M0 | Must | US-107 | packages/ui · ADR-0026 §3 `DataTable` (table ≥ 768 px, cards below) | TASK-053 | – | Planned |
| REQ-UI-013 | M0 | Must | US-108 | apps/web · ADR-0026 §1 web shell; am. 5 (root `/` locale redirect by Nginx, D-ARCH-015) | TASK-068 | – | Planned |
| REQ-UI-014 | M1 | Must | US-109 | apps/web · ADR-0026 §6 home layout (quote widget in first screen); UX W01 | TASK-137 | – | Planned |
| REQ-UI-015 | M1 | Must | US-109 | apps/web · ADR-0026 §3 sticky action bar below 768 px (safe-area insets) | TASK-137 | – | Planned |
| REQ-UI-016 | M0 | Must | US-110 | apps/admin · ADR-0026 §1 admin shell (collapsible sidebar); ARCHITECTURE §5.4 | TASK-069 | – | Planned |
| REQ-UI-017 | M1 | Could | US-111 | apps/admin · ADR-0026 §3 table density setting | TASK-226 | – | Planned |
| REQ-UI-018 | M1 | Should | US-111 | apps/web + apps/admin · ADR-0026 §10 route-level code splitting; ADR-0002 §4 `size-limit` budgets | TASK-226 | – | Planned |
| REQ-UI-019 | M1 | Must | US-112 | apps/web · ADR-0026 §1 React Router `prerender` per locale (home, tracking, legal); D-ARCH-015 | TASK-189 | – | Planned |
| REQ-UI-020 | M0 | Must | US-113 | tests · ADR-0024 (shared Playwright axe fixture, routes × states); ADR-0026 §3 | TASK-106 | – | Planned |
| REQ-UI-021 | M0 | Must | US-113 | packages/ui · ADR-0026 §3 keyboard operability, skip link, focus ring token | TASK-106 | – | Planned |
| REQ-UI-022 | M0 | Must | US-106 | packages/ui · ADR-0026 §3 labelled controls, `lang` per locale; §4 error association | TASK-058 | – | Planned |
| REQ-UI-023 | M1 | Should | US-114 | compliance + apps/web · ADR-0026 §9 consent banner (lazy Stripe.js, am. 9); data-model §3.7 `consent_records` | TASK-229 | – | Planned |
| REQ-I18N-001 | M0 | Must | US-115 | apps · ADR-0026 §2 i18next keys everywhere; ADR-0002 §5 `i18next/no-literal-string` lint | TASK-042 | – | Planned |
| REQ-I18N-002 | M0 | Must | US-115 | apps + notifications · ADR-0026 §2 en/es/fr resources; ADR-0020 §3 template sets; CI parity script | TASK-042 | – | Planned |
| REQ-I18N-003 | M0 | Must | US-115 | apps · ADR-0026 am. 3 ICU MessageFormat (`i18next-icu`, D-ARCH-014) | TASK-042 | – | Planned |
| REQ-I18N-004 | M0 | Must | US-116 | packages/shared/format · ADR-0009 §Formatting (Intl helpers only); ADR-0026 am. 7 (`useGrouping: 'always'`) | TASK-050 | – | Planned |
| REQ-I18N-005 | M1 | Must | US-119 | apps/web · ADR-0026 §4 country-aware address forms; data-model §3.6 country address rules | TASK-143 | – | Planned |
| REQ-I18N-006 | M0 | Must | US-117 | apps + platform · ADR-0026 §2 locale resolution order; ADR-0016 (`Accept-Language` parameter) | TASK-062 | – | Planned |
| REQ-I18N-007 | M0 | Must | US-117 | identity + apps · ADR-0026 §2 locale persistence; data-model §3.1 `users.locale` | TASK-062 | – | Planned |
| REQ-I18N-008 | M0 | Must | US-117 | notifications · ADR-0020 §3 render in recipient locale (fallback chain) | TASK-062 | – | Planned |
| REQ-I18N-009 | M0 | Must | US-120 | apps · ADR-0026 §2 pseudo-locale build (+30 % expansion); ADR-0002 §5 | TASK-110 | – | Planned |
| REQ-I18N-010 | M0 | Should | US-120 | packages/ui · ADR-0026 §3 logical CSS properties (`stylelint-use-logical`) | TASK-110 | – | Planned |
| REQ-I18N-011 | M0 | Must | US-116 | packages/shared/format · ADR-0009 §Time zones (viewer zone, offset label); ADR-0026 §2 | TASK-050 | – | Planned |
| REQ-I18N-012 | M1 | Should | US-118 | apps/web + pricing · ADR-0026 §2 display-currency switcher; ADR-0015 §FX (display conversion only) | TASK-230 | – | Planned |
| REQ-I18N-013 | M0 | Should | US-115 | apps · ADR-0026 §2 (pending-linguistic-review marker per namespace); D-023 | TASK-042 | – | Planned |
| REQ-I18N-014 | M0 | Could | US-116 | packages/shared/format · ADR-0009 §Formatting (`Intl.Collator` for localised lists) | TASK-050 | – | Planned |
| REQ-API-001 | M0 | Must | US-034 | platform · ADR-0016 §1 paths and versioning (`/api/v1`, 404 `NOT_FOUND`); api/README §1 | TASK-017 | – | Planned |
| REQ-API-002 | M0 | Must | US-034 | api/ · ADR-0016 §1 contract-first OpenAPI 3.1; api/README §15 drift test, §18 change process | TASK-017 | – | Planned |
| REQ-API-003 | M0 | Should | US-035 | platform · ADR-0016 §1 (Swagger UI at `/api/docs`, config-gated) | TASK-017 | – | Planned |
| REQ-API-004 | M0 | Must | US-034 | tests · ADR-0024; api/README §16 Supertest response-validation helper (Ajv) | TASK-017 | – | Planned |
| REQ-API-005 | M0 | Must | US-036 | packages/shared · ADR-0016 §3 RFC 9457 problem details, stable codes; api/README §3/§11 | TASK-036 | – | Planned |
| REQ-API-006 | M0 | Must | US-036 | platform · ADR-0016 §3/§4 (400 `VALIDATION_ERROR` with `errors[]`); api/README §3 sub-codes | TASK-036 | – | Planned |
| REQ-API-007 | M0 | Must | US-037 | platform · ADR-0016 §5 keyset pagination (opaque cursors, limit 25/100); api/README §4; am. 5(d) | TASK-045 | – | Planned |
| REQ-API-008 | M0 | Must | US-037 | platform · ADR-0016 §5 `filter[field]` / `sort` grammar; api/README §4 | TASK-045 | – | Planned |
| REQ-API-009 | M0 | Must | US-038 | platform · ADR-0016 §Idempotency; ADR-0014 am. 1/4 (scope, one-time-secret routes); api/README §5; data-model §6.2 | TASK-040 | – | Planned |
| REQ-API-010 | M0 | Must | US-038 | platform · ADR-0014 am. 1 (fingerprint replay, encrypted stored bodies, `Idempotent-Replayed`); api/README §5 | TASK-040 | – | Planned |
| REQ-API-011 | M0 | Must | US-038 | platform · ADR-0014 am. 1 (422 `IDEMPOTENCY_KEY_REUSED` on fingerprint mismatch); api/README §5 | TASK-040 | – | Planned |
| REQ-API-012 | M0 | Should | US-039 | platform · ADR-0016 §6 strong `ETag` from id + `version`; api/README §6 | TASK-096 | – | Planned |
| REQ-API-013 | M0 | Must | US-039 | platform · ADR-0016 §6 `If-Match` (412 `PRECONDITION_FAILED`, 428); api/README §6 | TASK-096 | – | Planned |
| REQ-API-014 | M0 | Must | US-040 | platform · ADR-0016 §8 + am. 7 (`draft-6` RateLimit headers, `Retry-After`); api/README §7 | TASK-041 | – | Planned |
| REQ-API-015 | M0 | Could | US-035 | platform · ADR-0016 §1 deprecation seam; api/README §1 Deprecation/Sunset/Link | TASK-017 | – | Planned |
| REQ-API-016 | M0 | Must | US-041 | packages/shared · ADR-0009 (ISO 8601 `Z`, `YYYY-MM-DD` + zone, Money); api/README §2 | TASK-115 | – | Planned |
| REQ-API-017 | M0 | Must | US-042 | platform · ADR-0016 §10 SSE (`text/event-stream`, heartbeat, `Last-Event-ID` am. 3); api/README §9 | TASK-044 | – | Planned |
| REQ-API-018 | M0 | Must | US-042 | platform · ADR-0016 §10 SSE termination (`complete`/`error`, ≤ 30 s cap); am. 9 stream caps; api/README §9 | TASK-044 | – | Planned |
| REQ-API-019 | M0 | Should | US-035 | apps · api/README §17 type generation from the contract; ADR-0016 §1 | TASK-017 | – | Planned |
| REQ-API-020 | M0 | Could | US-035 | platform · ADR-0016 (`ApiMode` request context, `test` in this run); ADR-0012 §7 (`livemode: false`) | TASK-017 | – | Planned |
| REQ-SEC-001 | M0 | Must | US-043 | platform + infra/ (edge) · ADR-0016 §11 Helmet headers; ADR-0026 §9 static-site headers | TASK-111 | – | Planned |
| REQ-SEC-002 | M0 | Must | US-043 | apps + infra/ (edge) · ADR-0026 §9 hash-based CSP (exact Stripe hosts, report endpoint); ADR-0016 §11; SPK-06 | TASK-111 | – | Planned |
| REQ-SEC-003 | M0 | Must | US-043 | infra/ (edge) · ADR-0016 §11 HSTS outside local; platform.md §2.2 edge / §4 CloudFront | TASK-111 | – | Planned |
| REQ-SEC-004 | M0 | Must | US-044 | identity + platform · ADR-0006 §CSRF (Origin allow-list + `X-CSRF-Token` + SameSite=Strict); ADR-0016 §11 | TASK-048 | – | Planned |
| REQ-SEC-005 | M0 | Must | US-040 | platform · ADR-0016 §8 + am. 11 rate classes (`auth`, `email-send`, `public-quote`, `quote-create`, …); api/README §7 | TASK-041 | – | Planned |
| REQ-SEC-006 | M0 | Should | US-040 | platform · ADR-0016 §8 (in-memory auth-route fallback on Redis outage, ERROR security event) | TASK-041 | – | Planned |
| REQ-SEC-007 | M0 | Must | US-045 | platform · ADR-0016 §3/§4 Joi `allowUnknown: false` from route metadata (body, query, params) | TASK-108 | – | Planned |
| REQ-SEC-008 | M1 | Must | US-046 | packages/shared · ADR-0016 §4 Joi/Zod parity (shared constants, parity fixtures); ADR-0026 §4 | TASK-112 | – | Planned |
| REQ-SEC-009 | M0 | Must | US-046 | platform · ADR-0003 (Prisma parameterised queries only); ADR-0023 §1 Semgrep rule for raw SQL | TASK-112 | – | Planned |
| REQ-SEC-010 | M0 | Must | US-047 | platform · ADR-0016 §13 `OutboundHttpClient` (https, allow-list, private-IP and redirect checks); am. 10 SDK exceptions | TASK-113 | – | Planned |
| REQ-SEC-011 | M0 | Must | US-048 | packages/config · ADR-0018 §Secret references + am. 1–4 key register; `.env.example` placeholders only | TASK-007 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-SEC-012 | M0 | Must | US-047 | platform · ADR-0017 §1 security events (`event_type=security`); api/README §13 catalogue (SEC-P3-30); ADR-0007 §Capture | TASK-113 | – | Planned |
| REQ-SEC-013 | M0 | Must | US-048 | .github/ · ADR-0023 §1 security job + am. F (cooldown, lockfile provenance, `--ignore-scripts`); ADR-0024 | TASK-007 | – | Implemented (tasks merged; acceptance at G3) |
| REQ-SEC-014 | M0 | Must | US-044 | platform · ADR-0016 §11 exact-origin CORS with credentials (600 s preflight) | TASK-048 | – | Planned |
| REQ-SEC-015 | M0 | Should | US-045 | platform · ADR-0016 §3 body limits (1 MB default, per-route override) and content-type checks | TASK-108 | – | Planned |
| REQ-SEC-016 | M0 | Should | US-046 | apps · ADR-0026 §9 (no `innerHTML`/`dangerouslySetInnerHTML` outside one reviewed helper; Trusted Types spike SPK-06); ADR-0002 §5 lint | TASK-112 | – | Planned |
| REQ-ADMIN-001 | M0 | Must | US-030 | apps/admin · ADR-0026 §1 separately built static admin app; platform.md §2.2 edge routing (`/admin`) | TASK-067 | – | Planned |
| REQ-ADMIN-002 | M0 | Must | US-031 | identity + apps/admin · ADR-0006 §Staff gate (password → TOTP/recovery); ARCHITECTURE §5.4 | TASK-071 | – | Planned |
| REQ-ADMIN-003 | M0 | Must | US-030 | identity · ADR-0006 §Staff gate (no OPERATOR membership → generic failure, `login_failed`) | TASK-067 | – | Planned |
| REQ-ADMIN-004 | M0 | Should | US-033 | identity · ADR-0006 am. 12–13 (`AUTH_ADMIN_SESSION_ABSOLUTE_TTL=12h`, 30-min sliding idle refresh); ADR-0026 am. 8 | TASK-220 | – | Planned |
| REQ-ADMIN-005 | M0 | Must | US-032 | apps/admin · ADR-0026 §1 admin landing (`/audit` when `audit:read`); ARCHITECTURE §5.4 | TASK-077 | – | Planned |
| REQ-ADMIN-006 | M0 | Must | US-032 | apps/admin · ADR-0007 §Viewer; ADR-0026 §1 (URL-held filter state); ARCHITECTURE §5.4 | TASK-077 | – | Planned |
| REQ-ADMIN-007 | M1 | Should | US-027 | apps/admin + identity · ADR-0006 §Sessions; ARCHITECTURE §5.4 "My sessions" | TASK-186, TASK-193 | – | Planned |
| REQ-ADMIN-008 | M1 | Should | US-026 | identity · ADR-0006 §Recovery codes (regenerate behind re-auth; staff cannot disable TOTP) | TASK-223, TASK-228 | – | Planned |
| REQ-ADMIN-009 | M0 | Must | US-032 | apps/admin · ADR-0026 §1 (no placeholder routes or navigation for unimplemented modules); ARCHITECTURE §5.4 | TASK-077 | – | Planned |
| REQ-ADMIN-010 | M0 | Should | US-033 | infra/ (edge) + apps/admin · ADR-0026 §9 (`X-Robots-Tag: noindex, nofollow`, `robots.txt`); D-ARCH-015 | TASK-220 | – | Planned |
| REQ-CARR-001 | M0 | Must | US-121 | packages/carriers · ADR-0010 §Interface (`CarrierAdapter`, canonical types) | TASK-075 | – | Planned |
| REQ-CARR-002 | M0 | Must | US-121 | packages/carriers · ADR-0010 §Interface `capabilities()` declaration | TASK-075 | – | Planned |
| REQ-CARR-003 | M0 | Must | US-121 | packages/carriers · ADR-0010 §Interface (`CAPABILITY_NOT_SUPPORTED` without network I/O) | TASK-075 | – | Planned |
| REQ-CARR-004 | M0 | Must | US-122 | packages/carriers · ADR-0010 §Mock carrier (deterministic prices, full contract) | TASK-079 | – | Planned |
| REQ-CARR-005 | M0 | Must | US-123 | packages/carriers · ADR-0010 §Mock carrier scenario directives (DR-B29, `X-Mock-Scenario`) | TASK-097 | – | Planned |
| REQ-CARR-006 | M0 | Must | US-123 | packages/carriers · ADR-0010 am. 9 (`MOCK_CARRIER_ENABLED` / `MOCK_SCENARIOS_ENABLED`, production refuses) | TASK-097 | – | Planned |
| REQ-CARR-007 | M0 | Must | US-124 | packages/carriers · ADR-0010 §Interface canonical mapping (DR-B18 statuses, DR-B30 services, surcharges, errors) | TASK-075 | – | Planned |
| REQ-CARR-008 | M0 | Must | US-126 | quotes · ADR-0010 §Rate shopping (`Promise.allSettled` fan-out, 4 s / 5 s deadlines); ARCHITECTURE §7.1 | TASK-083 | – | Planned |
| REQ-CARR-009 | M1 | Must | US-135 | quotes · ADR-0010 §Rate shopping SSE + am. 5 (subscribe-only); ADR-0016 §10 / am. 9; api/README §9 | TASK-141 | – | Planned |
| REQ-CARR-010 | M1 | Must | US-134 | quotes · ADR-0010 §Rate shopping cache (Redis 300 s, carrier costs only, normalised key) | TASK-136 | – | Planned |
| REQ-CARR-011 | M0 | Must | US-125 | packages/carriers · ADR-0010 §Mock carrier (shared contract suite × 4 adapters); ADR-0024 | TASK-101 | – | Planned |
| REQ-CARR-012 | M1 | Must | US-131 | packages/carriers · ADR-0010 §Real adapters (DHL MyDHL API 3.3.x, HTTP Basic); R-ARCH-02 / SPK-02 | TASK-135 | – | Planned |
| REQ-CARR-013 | M1 | Must | US-132 | packages/carriers · ADR-0010 §Real adapters (FedEx REST, OAuth client credentials); SPK-02 | TASK-139 | – | Planned |
| REQ-CARR-014 | M1 | Must | US-133 | packages/carriers · ADR-0010 §Real adapters (UPS REST v2409, OAuth); SPK-02 | TASK-140 | – | Planned |
| REQ-CARR-015 | M1 | Must | US-128 | carriers · ADR-0010 §Carrier accounts (D-012, `credential_secret_ref`); ADR-0018; data-model §3.8 | TASK-128 | – | Planned |
| REQ-CARR-016 | M1 | Must | US-129 | packages/carriers · ADR-0010 §Ports `TokenCache` (expiry − 60 s, single refresh) + am. 7 (AES-256-GCM encrypted cache) | TASK-131 | – | Planned |
| REQ-CARR-017 | M1 | Must | US-130 | packages/carriers · ADR-0010 §Resilience wrapper (timeouts, retries, breaker) + am. 1 (two bulkheads); ADR-0014 am. 3 | TASK-132 | – | Planned |
| REQ-CARR-018 | M1 | Must | US-136 | packages/carriers · ADR-0010 §Raw payload retention + am. 8 (`$blob` descriptors, allow-list redaction); ADR-0021 | TASK-188 | – | Planned |
| REQ-CARR-019 | M1 | Must | US-137 | packages/carriers · ADR-0010 §Real adapters (fixtures, adapter READMEs with docs version/date); ADR-0024 nock | TASK-191 | – | Planned |
| REQ-CARR-020 | M1 | Should | US-137 | tests · ADR-0010 §Real adapters (`CARRIER_LIVE_SANDBOX=1` opt-in); ADR-0023 am. H (environment secrets) | TASK-191 | – | Planned |
| REQ-CARR-021 | M1 | Must | US-127 | carriers · data-model §3.8 `carrier_services` reference data; ARCHITECTURE §6 `CarrierServiceCatalogue` | TASK-124 | – | Planned |
| REQ-CARR-022 | M1 | Must | US-293 | carriers · ADR-0010 am. 2 (anonymous share + global bucket) + am. 10 (unverified = anonymous); NFR-RES-007 | TASK-190 | – | Planned |
| REQ-CARR-023 | M1 | Must | US-293 | carriers · ADR-0010 am. 3 (daily quota guard, 40 % reserve, 70/90 % alarms) + am. 10 (per-organisation share); NFR-RES-007 | TASK-190 | – | Planned |
| REQ-PRICE-001 | M0 | Must | US-138 | packages/pricing · ADR-0015 §Pure function (no I/O, deterministic) | TASK-076 | – | Planned |
| REQ-PRICE-002 | M0 | Must | US-138 | packages/shared · ADR-0009 §Money (integer minor units, `Money` branded type) | TASK-076 | – | Planned |
| REQ-PRICE-003 | M0 | Must | US-140 | packages/pricing · ADR-0015 §Margin rules (seeded default rule) | TASK-080 | – | Planned |
| REQ-PRICE-004 | M0 | Must | US-139 | packages/pricing · ADR-0015 §Billable weight (volumetric divisor per carrier/service) | TASK-076 | – | Planned |
| REQ-PRICE-005 | M1 | Must | US-141 | packages/pricing · ADR-0015 §Margin rules (single most-specific match); data-model §3.9 | TASK-192 | – | Planned |
| REQ-PRICE-006 | M1 | Must | US-142 | packages/pricing · ADR-0015 §Surcharges (fuel % of discounted base freight) | TASK-129 | – | Planned |
| REQ-PRICE-007 | M1 | Must | US-142 | packages/pricing · ADR-0015 §Surcharges (carrier pass-through at converted cost) | TASK-129 | – | Planned |
| REQ-PRICE-008 | M1 | Must | US-143 | packages/pricing · ADR-0015 §Cover (included liability as zero-priced line) | TASK-198 | – | Planned |
| REQ-PRICE-009 | M1 | Should | US-144 | packages/pricing · ADR-0015 §Cover (additional protection: max(minimum, % of value)) | TASK-232 | – | Planned |
| REQ-PRICE-010 | M1 | Should | US-145 | packages/pricing · ADR-0015 §Discounts (customer by domain/org); data-model §3.9 | TASK-236 | – | Planned |
| REQ-PRICE-011 | M1 | Should | US-145 | packages/pricing · ADR-0015 §Discounts (coupon validity, usage); data-model §3.9 coupons | TASK-236 | – | Planned |
| REQ-PRICE-012 | M1 | Could | US-153 | packages/pricing · ADR-0015 §Discounts (volume tier seam) | TASK-269 | – | Planned |
| REQ-PRICE-013 | M1 | Must | US-146 | packages/pricing · ADR-0015 §Discounts (stackability flag, ordering) | TASK-192 | – | Planned |
| REQ-PRICE-014 | M1 | Must | US-147 | packages/pricing · ADR-0015 §Tax (per charge line from the compliance pack); data-model §3.7 | TASK-134 | – | Planned |
| REQ-PRICE-015 | M1 | Must | US-148 | packages/pricing · ADR-0015 §FX (snapshot rate, rounding); data-model §3.9 `fx_rates` | TASK-133 | – | Planned |
| REQ-PRICE-016 | M1 | Must | US-149 | packages/pricing · ADR-0015 §Output (immutable ordered charge lines) | TASK-138 | – | Planned |
| REQ-PRICE-017 | M1 | Must | US-150 | quotes + shipments · ADR-0015 §Snapshots (engine/config/pack versions); data-model §3.10 price snapshot | TASK-175 | – | Planned |
| REQ-PRICE-018 | M1 | Should | US-144 | packages/pricing · ADR-0015 §Invariants (base freight never below converted cost) | TASK-232 | – | Planned |
| REQ-PRICE-019 | M1 | Must | US-151 | packages/pricing · ADR-0015 §6 property tests (fast-check ≥ 1,000 cases); ADR-0024 Stryker | TASK-206 | – | Planned |
| REQ-PRICE-020 | M1 | Must | US-152 | pricing · ADR-0015 §Configuration (versioned seeded rules); data-model §3.9 | TASK-202 | – | Planned |
| REQ-PRICE-021 | M1 | Could | US-153 | packages/pricing · ADR-0015 §Seams (discriminated cost-source and surcharge inputs) | TASK-269 | – | Planned |
| REQ-QUOTE-001 | M0 | Must | US-154 | quotes · data-model §3.10 quotes (separate from shipments, 24 h expiry); ADR-0010 §Rate shopping | TASK-087 | – | Planned |
| REQ-QUOTE-002 | M0 | Must | US-155 | quotes · ADR-0005 §Guest-capable (guest token hash); ADR-0016 §8 `public-quote`; ADR-0026 am. 9 (`localStorage` TTL) | TASK-091 | – | Planned |
| REQ-QUOTE-003 | M0 | Must | US-156 | quotes · api/openapi `QuoteRequest` (country-dependent postcode/city rules); data-model §3.6 | TASK-093 | – | Planned |
| REQ-QUOTE-004 | M1 | Must | US-156 | quotes · api/openapi `QuoteRequest` package limits (DR-B34); packages/shared constants | TASK-093 | – | Planned |
| REQ-QUOTE-005 | M1 | Must | US-157 | apps/web · ADR-0026 §2 unit-system default by origin; packages/shared/format | TASK-201 | – | Planned |
| REQ-QUOTE-006 | M1 | Must | US-157 | apps/web · ADR-0026 (quote widget live volumetric weight); ADR-0015 §Billable weight (shared pure helper) | TASK-201 | – | Planned |
| REQ-QUOTE-007 | M1 | Must | US-159 | apps/web · UX W02 results card; ADR-0026 am. 6 (carrier logo seam, D-ARCH-016) | TASK-144 | – | Planned |
| REQ-QUOTE-008 | M1 | Must | US-160 | apps/web · ADR-0026 §6 streaming results (fixed-height skeletons, CLS ≤ 0.1); api/README §9 | TASK-142 | – | Planned |
| REQ-QUOTE-009 | M1 | Must | US-161 | quotes + apps/web · api/openapi `QuoteOption` (gross price, transit days) sort keys; ADR-0015 §Output | TASK-145 | – | Planned |
| REQ-QUOTE-010 | M1 | Should | US-162 | apps/web · UX W02 filters (carrier, speed, cover); api/openapi `QuoteOption` facets | TASK-233 | – | Planned |
| REQ-QUOTE-011 | M1 | Should | US-161 | apps/web · UX W02 badges (Cheapest / Fastest tie rules) | TASK-145 | – | Planned |
| REQ-QUOTE-012 | M1 | Must | US-159 | apps/web · ADR-0015 §Output charge lines rendered in UX W02 breakdown | TASK-144 | – | Planned |
| REQ-QUOTE-013 | M1 | Should | US-163 | apps/web · UX W02 compare panel (≤ 3 options) | TASK-233 | – | Planned |
| REQ-QUOTE-014 | M1 | Should | US-164 | quotes · data-model §3.10 saved quotes; api/openapi `saveQuote` / `listQuotes` (`quote:create`) | TASK-234 | – | Planned |
| REQ-QUOTE-015 | M1 | Should | US-165 | quotes · ADR-0014 am. 4 + ADR-0016 am. 11 (mint-and-revoke, 10 mints/quote/h, identical 404); data-model §3.10 `quote_shares` | TASK-237 | – | Planned |
| REQ-QUOTE-016 | M1 | Must | US-166 | quotes · data-model §3.10 claim (`claimQuote`, guest → org); ADR-0005 guest claim policy | TASK-146 | – | Planned |
| REQ-QUOTE-017 | M1 | Must | US-167 | quotes · api/openapi `claimQuote` 409 `QUOTE_EXPIRED` + re-quote action; ADR-0010 §Rate shopping | TASK-194 | – | Planned |
| REQ-QUOTE-018 | M1 | Must | US-168 | quotes · data-model §3.10 (quotes immutable; input change = new quote) | TASK-194 | – | Planned |
| REQ-QUOTE-019 | M1 | Should | US-169 | apps/web · ADR-0026 §2 display-currency switcher; ADR-0015 §FX (display conversion) | TASK-230 | – | Planned |
| REQ-QUOTE-020 | M1 | Should | US-170 | apps/web + customs · ADR-0026 §1 pre-rendered prohibited-items page; data-model §3.18 | TASK-238 | – | Planned |
| REQ-QUOTE-021 | M1 | Could | US-170 | apps/web · ADR-0026 §1 public volumetric calculator (`GET /reference/volumetric`, ADR-0016 am. 5(c)) | TASK-238 | – | Planned |
| REQ-QUOTE-022 | M1 | Could | US-169 | apps/web · ADR-0026 §1 public currency converter (`GET /reference/fx-rates/convert`) | TASK-230 | – | Planned |
| REQ-QUOTE-023 | M1 | Must | US-158 | apps/web · ADR-0026 §1 React Router `prerender` home shell (quote widget hydrates); D-ARCH-015 | TASK-125 | – | Planned |
| REQ-BOOK-001 | M1 | Must | US-171 | shipments + identity · ADR-0006 (sign-in before first draft save); ADR-0005 guest quote claim; UX F03 | TASK-146, TASK-152 | – | Planned |
| REQ-BOOK-002 | M1 | Must | US-172 | shipments · data-model §3.11 shipments (`DRAFT` on first step-1 save, quote link) | TASK-149 | – | Planned |
| REQ-BOOK-003 | M1 | Must | US-174 | apps/web · ADR-0026 §6 wizard (one step per screen < 768 px, sticky summary); UX W03–W07 | TASK-156 | – | Planned |
| REQ-BOOK-004 | M1 | Should | US-179 | apps/web + shipments · ADR-0026 (debounced autosave); api/openapi `updateShipmentDraft` | TASK-240 | – | Planned |
| REQ-BOOK-005 | M1 | Must | US-175 | shipments · data-model §3.11 shipment parties; api/openapi step-1 schemas | TASK-159 | – | Planned |
| REQ-BOOK-006 | M1 | Must | US-176 | shipments · data-model §3.6 country address rules; ADR-0016 §4 validation (Joi/Zod parity) | TASK-195 | – | Planned |
| REQ-BOOK-007 | M1 | Should | US-178 | shipments + carriers · ADR-0010 §Interface `validateAddress` (capability-gated suggestion) | TASK-239 | – | Planned |
| REQ-BOOK-008 | M1 | Must | US-177 | shipments + compliance · data-model §3.7 pack reference rules; §3.11 party references | TASK-195 | – | Planned |
| REQ-BOOK-009 | M1 | Must | US-180 | customs · data-model §3.11 customs lines and contents; UX W04 | TASK-154, TASK-160 | – | Planned |
| REQ-BOOK-010 | M1 | Must | US-189 | pickups · data-model §3.15 pickups; ADR-0010 §Interface `schedulePickup`; UX W05 | TASK-163 | – | Planned |
| REQ-BOOK-011 | M1 | Should | US-190 | shipments · ADR-0015 §Cover (additional protection); data-model §3.11 extras | TASK-242 | – | Planned |
| REQ-BOOK-012 | M1 | Must | US-191 | apps/web · UX W07 review and basket; ADR-0015 §Output (price summary) | TASK-164 | – | Planned |
| REQ-BOOK-013 | M1 | Must | US-192 | orders · data-model §3.12 orders (1–10 shipments, single currency) | TASK-153 | – | Planned |
| REQ-BOOK-014 | M1 | Should | US-193 | orders · data-model §3.12; api/openapi `addShipmentToOrder` | TASK-243 | – | Planned |
| REQ-BOOK-015 | M1 | Should | US-194 | orders + packages/pricing · ADR-0015 §Discounts (coupon); data-model §3.9 coupons | TASK-236 | – | Planned |
| REQ-BOOK-016 | M1 | Must | US-208 | orders · ADR-0014 §Checkout preconditions; api/openapi `checkoutOrder` (409/412/428) | TASK-166 | – | Planned |
| REQ-BOOK-017 | M1 | Must | US-195 | apps/web · UX W09 confirmation; ADR-0014 §Steps 4–6 (documents, pickup, notification) | TASK-182 | – | Planned |
| REQ-BOOK-018 | M0 | Must | US-197 | shipments · ADR-0014 §State machine (DR-B01 enforced in `ShipmentStateMachine`); data-model §3.11 | TASK-084 | – | Planned |
| REQ-BOOK-019 | M0 | Must | US-198 | shipments · data-model §3.11 `shipment_state_history`; ADR-0007 (`STATE_TRANSITION` entries) | TASK-084 | – | Planned |
| REQ-BOOK-020 | M0 | Must | US-202 | orders (worker) · ADR-0014 §Saga steps 1–6 on the `booking` queue; ARCHITECTURE §7.2 | TASK-092 | – | Planned |
| REQ-BOOK-021 | M0 | Must | US-203 | orders (worker) · ADR-0014 §Step keys (client reference persisted before the carrier call); data-model §6.3 | TASK-094 | – | Planned |
| REQ-BOOK-022 | M0 | Must | US-204 | orders (worker) · ADR-0014 §Compensation (DR-B03: release, void, cancel); ARCHITECTURE §7.2 | TASK-105 | – | Planned |
| REQ-BOOK-023 | M0 | Must | US-205 | orders (worker) · ADR-0014 §Step 2 failures + am. 3 (`LOCAL_REJECT` retry, DRAFT at deadline); ADR-0010 am. 4 | TASK-109 | – | Planned |
| REQ-BOOK-024 | M1 | Must | US-206 | orders (worker) · ADR-0014 §Step 3 partial capture (`PARTIALLY_BOOKED`, `amount_to_capture`); ADR-0012 §2 | TASK-200 | – | Planned |
| REQ-BOOK-025 | M1 | Must | US-207 | orders · api/openapi `getOrderBookingStatus` / `streamOrderBooking`; ADR-0016 §10 SSE | TASK-173 | – | Planned |
| REQ-BOOK-026 | M0 | Must | US-201 | admin-settings · ADR-0009 §Numbering (allocate at checkout start); data-model §6.4 `number_sequences` | TASK-088 | – | Planned |
| REQ-BOOK-027 | M0 | Must | US-173 | shipments · data-model §3.11 direction derivation (EXPORT/IMPORT/DOMESTIC); packages/shared | TASK-087 | – | Planned |
| REQ-BOOK-028 | M0 | Must | US-173 | shipments · data-model §3.11 content type and package type enums | TASK-087 | – | Planned |
| REQ-BOOK-029 | M1 | Should | US-196 | shipments (worker) · ADR-0014 §Cancellation saga (`cancelPickup` → `cancelShipment` → refund); data-model §3.11 | TASK-247 | – | Planned |
| REQ-BOOK-030 | M1 | Should | US-215 | shipments (worker) · ADR-0014 §Cancellation (void failure or in-transit → `EXCEPTION`, no refund) | TASK-244 | – | Planned |
| REQ-CUST-001 | M1 | Must | US-180 | customs · data-model §3.11 customs requirement rule (PARCEL × cross-border); packages/shared | TASK-154, TASK-160 | – | Planned |
| REQ-CUST-002 | M1 | Must | US-180 | customs · data-model §3.11 (DOCUMENT shipments: attestation instead of lines) | TASK-154, TASK-160 | – | Planned |
| REQ-CUST-003 | M1 | Must | US-181 | customs · data-model §3.11 `customs_lines`; api/openapi `CustomsLine` | TASK-154, TASK-160 | – | Planned |
| REQ-CUST-004 | M1 | Must | US-181 | customs · data-model §3.18 export reasons; api/openapi `CustomsDeclaration.reason` | TASK-154, TASK-160 | – | Planned |
| REQ-CUST-005 | M1 | Should | US-185 | customs · data-model §3.18 Incoterms; ADR-0010 `capabilities()` (DDP support) | TASK-239 | – | Planned |
| REQ-CUST-006 | M1 | Must | US-182 | customs · data-model §3.18 HS search (prefix/keyword index); api/openapi `searchCommodityCodes` | TASK-157 | – | Planned |
| REQ-CUST-007 | M1 | Must | US-182 | customs · packages/shared validators (HS code digits 6–10); ADR-0016 §4 | TASK-157 | – | Planned |
| REQ-CUST-008 | M1 | Should | US-185 | customs + compliance · data-model §3.7 de-minimis comparison; ADR-0015 §FX conversion | TASK-239 | – | Planned |
| REQ-CUST-009 | M1 | Must | US-183 | customs · ARCHITECTURE §6 `ProhibitedItemsChecker`; data-model §3.18 prohibited items | TASK-196 | – | Planned |
| REQ-CUST-010 | M1 | Must | US-184 | customs · data-model §3.11 dangerous-goods attestation | TASK-199 | – | Planned |
| REQ-CUST-011 | M1 | Must | US-184 | customs · data-model §3.11 `screening_status = NOT_SCREENED` | TASK-199 | – | Planned |
| REQ-CUST-012 | M1 | Must | US-186 | documents · ADR-0019 §Commercial invoice + am. 1 (`invoice_print` FULL or MASKED per reference type, D-051) | TASK-161 | – | Planned |
| REQ-CUST-013 | M1 | Must | US-186 | documents + carriers · ADR-0019 §Carrier-returned documents; ADR-0021 §Buckets | TASK-161 | – | Planned |
| REQ-CUST-014 | M1 | Should | US-188 | carriers · ADR-0010 §Interface `uploadCustomsDocuments` (paperless, capability-gated) | TASK-241 | – | Planned |
| REQ-CUST-015 | M1 | Must | US-187 | packages/carriers · ADR-0010 §Interface (customs and Incoterm mapping inside each adapter) | TASK-199 | – | Planned |
| REQ-PAY-001 | M0 | Must | US-199 | payments · ADR-0012 §1 `PaymentGateway` interface (authorise/capture/void/refund/webhook) | TASK-085 | – | Planned |
| REQ-PAY-002 | M0 | Must | US-199 | payments · ADR-0012 §4 Mock gateway (reserved tokens) + am. 4 (`mock_cvc_*` outcomes) | TASK-085 | – | Planned |
| REQ-PAY-003 | M0 | Must | US-200 | payments · ADR-0012 §5 payment records and status history; data-model §3.13 | TASK-085 | – | Planned |
| REQ-PAY-004 | M1 | Must | US-210 | payments · ADR-0012 §2 Stripe adapter + am. 2 (`rk_test_` default, `PAYMENT_LIVE_KEY_FORBIDDEN`) | TASK-167 | – | Planned |
| REQ-PAY-005 | M1 | Must | US-211 | payments + apps/web · ADR-0012 §2 Payment Element only (SAQ A, `CARD_DATA_NOT_ACCEPTED`); NFR-SEC-013 | TASK-177 | – | Planned |
| REQ-PAY-006 | M1 | Must | US-209 | payments · ADR-0012 §1 server-side amounts from price snapshots; ADR-0015 §Output | TASK-170 | – | Planned |
| REQ-PAY-007 | M1 | Must | US-208 | payments · ADR-0012 (unverified e-mail → refusal); ADR-0006 am. 15 (verification state) | TASK-166 | – | Planned |
| REQ-PAY-008 | M1 | Must | US-209 | payments · ADR-0012 §2/§6 manual capture and lifecycle guards; ADR-0014 §Steps 1 and 3 | TASK-170 | – | Planned |
| REQ-PAY-009 | M1 | Must | US-212 | payments · ADR-0012 §2 3-D Secure (`REQUIRES_ACTION`, `client_secret`, `confirmPayment`) | TASK-174 | – | Planned |
| REQ-PAY-010 | M1 | Must | US-212 | payments · ADR-0012 §5 decline mapping + am. 4 (`AUTHENTICATION_FAILED` when `cvc_check ≠ pass`) | TASK-174 | – | Planned |
| REQ-PAY-011 | M1 | Must | US-213 | payments · ADR-0012 §3 webhook signature/tolerance + am. 3 (`livemode` rejection, type allow-list) | TASK-171 | – | Planned |
| REQ-PAY-012 | M1 | Must | US-213 | payments · ADR-0012 §3 (`gateway_webhook_events` dedupe, retrieve-then-derive); data-model §3.13 | TASK-171 | – | Planned |
| REQ-PAY-013 | M1 | Should | US-216 | payments · ADR-0012 §2 refunds (full captured amount after VOIDED); ADR-0014 §Cancellation | TASK-251 | – | Planned |
| REQ-PAY-014 | M1 | Should | US-217 | payments · ADR-0012 §1 saved methods; ADR-0006 am. 12 (`payment_method.manage` step-up); api/README §5/§8 replay rule | TASK-249 | – | Planned |
| REQ-PAY-015 | M1 | Should | US-218 | payments + notifications · ADR-0012 §5; ADR-0020 §4 receipt template | TASK-257 | – | Planned |
| REQ-PAY-016 | M1 | Must | US-214 | apps/web · ADR-0012 §7 test-mode indicator (not colour-only); UX W08 | TASK-181 | – | Planned |
| REQ-PAY-017 | M1 | Must | US-210, US-214 | payments · ADR-0012 §2 fixture-backed adapter (`STRIPE_TEST_LIVE=1` opt-in) | TASK-167, TASK-181 | – | Planned |
| REQ-PAY-018 | M1 | Should | US-219 | payments (worker) · ADR-0012 §6 sweeper (5 min, 30-min authorisations, CAPTURED-without-BOOKED repair); data-model §6.3 | TASK-246 | – | Planned |
| REQ-PAY-019 | M1 | Should | US-211 | payments · ADR-0012 §8 seams (`CARD` only; 400 `PAYMENT_METHOD_NOT_AVAILABLE`) | TASK-177 | – | Planned |
| REQ-DOC-001 | M1 | Must | US-220 | documents · ADR-0019 §Document types; data-model §3.14 documents | TASK-147 | – | Planned |
| REQ-DOC-002 | M1 | Must | US-222 | documents · ADR-0019 §Labels (formats per service); ADR-0021 am. 2 (label byte validation) | TASK-155 | – | Planned |
| REQ-DOC-003 | M1 | Should | US-230 | documents · ADR-0019 §Pickup confirmation PDF (pdfkit) | TASK-256 | – | Planned |
| REQ-DOC-004 | M1 | Must | US-221 | documents · ADR-0019 §Versioning (new version per regeneration); data-model §3.14 | TASK-150 | – | Planned |
| REQ-DOC-005 | M1 | Must | US-220 | documents · ADR-0021 §Integrity (SHA-256 of stored bytes); data-model §3.14 `sha256` | TASK-147 | – | Planned |
| REQ-DOC-006 | M1 | Must | US-220 | documents · ADR-0021 §Buckets (SSE, RustFS locally, D-039) + am. 3 (SENSITIVE document storage) | TASK-147 | – | Planned |
| REQ-DOC-007 | M1 | Must | US-225 | documents · ADR-0021 §Pre-signed URLs (300 s, after permission); ADR-0008 (`document:download`) | TASK-162 | – | Planned |
| REQ-DOC-008 | M1 | Must | US-226 | documents · ADR-0007 §Capture (`DOWNLOAD` entry before presign, fail-closed); ADR-0021 | TASK-205 | – | Planned |
| REQ-DOC-009 | M1 | Should | US-227 | documents · ADR-0021 §Integrity (re-hash before download URL) | TASK-250 | – | Planned |
| REQ-DOC-010 | M1 | Should | US-228 | documents + notifications · ADR-0019 am. 1 (SENSITIVE never attached, D-051); ADR-0020 §4; api/README §7 route limit | TASK-255 | – | Planned |
| REQ-DOC-011 | M1 | Must | US-224 | documents · api/openapi `listShipmentDocuments`; data-model §3.14 | TASK-165 | – | Planned |
| REQ-DOC-012 | M1 | Must | US-223 | documents (worker) · ADR-0019 §Generation jobs (deterministic IDs); ADR-0013 | TASK-158 | – | Planned |
| REQ-DOC-013 | M1 | Should | US-229 | documents · ADR-0019 (label `VOIDED` on confirmed void); ADR-0014 §Cancellation | TASK-252 | – | Planned |
| REQ-DOC-014 | M1 | Should | US-229 | documents · api/openapi `getDocumentDownloadUrl` 410 `DOCUMENT_VOIDED`; ADR-0007 (`DENIED` audit) | TASK-252 | – | Planned |
| REQ-DOC-015 | M1 | Could | US-231 | documents · ADR-0019 §Labels (ZPL seam) | TASK-270 | – | Planned |
| REQ-PICK-001 | M1 | Must | US-233, US-234 | pickups · data-model §3.15 pickups (local date + IANA zone + window); ADR-0009 §Time | TASK-151, TASK-163 | – | Planned |
| REQ-PICK-002 | M1 | Must | US-232, US-234 | pickups · ARCHITECTURE §6 `PickupAvailability` (cut-off, holidays); data-model §3.6 holidays | TASK-148, TASK-163 | – | Planned |
| REQ-PICK-003 | M1 | Must | US-232 | admin-settings · data-model §3.6 holidays (pickup-unavailable flag) | TASK-148 | – | Planned |
| REQ-PICK-004 | M1 | Must | US-232, US-234 | pickups · data-model §3.15 windows; api/openapi `PickupWindow` (standard and custom) | TASK-148, TASK-163 | – | Planned |
| REQ-PICK-005 | M1 | Must | US-235 | orders (worker) · ADR-0014 §Step 5 schedule pickup after documents; ADR-0010 | TASK-178 | – | Planned |
| REQ-PICK-006 | M1 | Must | US-235 | orders (worker) · ADR-0014 §Step 5 failure (shipment stays `LABEL_READY`, `pickup.failed`, notification) | TASK-178 | – | Planned |
| REQ-PICK-007 | M1 | Must | US-236 | pickups · api/openapi `schedulePickup`; ADR-0008 (`pickup:schedule`) | TASK-203 | – | Planned |
| REQ-PICK-008 | M1 | Must | US-237 | shipments (worker) · ADR-0014 §Cancellation (`cancelPickup` before `cancelShipment`) | TASK-203 | – | Planned |
| REQ-PICK-009 | M1 | Should | US-238 | pickups · api/openapi `reschedulePickup` (2 h cut-off); data-model §3.15 | TASK-248 | – | Planned |
| REQ-PICK-010 | M1 | Should | US-239 | pickups + carriers · ADR-0010 §Interface `findServicePoints` (list only, D-ARCH-008) | TASK-245 | – | Planned |
| REQ-PICK-011 | M1 | Could | US-240 | apps/web · D-ARCH-008 (map not built in M1; seam only) | TASK-271 | – | Planned |
| REQ-PICK-012 | M1 | Must | US-233 | pickups · api/openapi `PickupRequest.instructions` (≤ 200 chars, control characters stripped); ADR-0016 §4 | TASK-151 | – | Planned |
| REQ-PICK-013 | M1 | Should | US-239 | apps/web + pickups · UX W05 drop-off summary; data-model §3.15 service point reference | TASK-245 | – | Planned |
| REQ-PICK-014 | M1 | Could | US-240 | pickups · ADR-0014 (pickup consolidation seam per order); data-model §3.15 | TASK-271 | – | Planned |
| REQ-TRACK-001 | M1 | Must | US-241 | tracking · ADR-0010 §Interface canonical statuses (DR-B18); data-model §3.16 | TASK-168 | – | Planned |
| REQ-TRACK-002 | M1 | Must | US-242 | tracking + shipments · ADR-0014 §State machine (forward-only); ADR-0010 am. 9 (pushes confirmed by `track()`) | TASK-172 | – | Planned |
| REQ-TRACK-003 | M1 | Must | US-243 | tracking (worker) · ARCHITECTURE §7.5 adaptive poll intervals; data-model §3.16 `tracking_poll_schedule` | TASK-204 | – | Planned |
| REQ-TRACK-004 | M1 | Must | US-244 | tracking (worker) · ARCHITECTURE §7.5 batching per account; ADR-0010 am. 1 (`transactional` pool) | TASK-207 | – | Planned |
| REQ-TRACK-005 | M1 | Must | US-242 | tracking · data-model §3.16 `tracking_events` (dedupe by carrier event ID or hash) | TASK-172 | – | Planned |
| REQ-TRACK-006 | M1 | Should | US-252 | tracking · ADR-0010 am. 9 (pushes as hints); ADR-0016 am. 5(b) (401 on bad signature); api/README §7 `webhook` class | TASK-261 | – | Planned |
| REQ-TRACK-007 | M1 | Should | US-246 | tracking + notifications · ADR-0004 outbox events per milestone; ADR-0020 §4 (DR-B28) | TASK-259 | – | Planned |
| REQ-TRACK-008 | M1 | Must | US-247 | tracking · ADR-0016 am. 2 (POST lookup, token-free URLs); api/openapi `lookupPublicTracking`; ADR-0026 §1 pre-rendered page | TASK-176 | – | Planned |
| REQ-TRACK-009 | M1 | Should | US-250 | tracking · api/openapi `lookupPublicTracking` (reference + receiver postcode, D-043) | TASK-260 | – | Planned |
| REQ-TRACK-010 | M1 | Must | US-249 | platform · ADR-0016 §8 `public-tracking` class (30/min, 300/h, 10/min failed); api/README §7 | TASK-210 | – | Planned |
| REQ-TRACK-011 | M1 | Must | US-248 | tracking · ADR-0020 §5 / NFR-PRIV-004 allow-list projection `PublicTracking` | TASK-180 | – | Planned |
| REQ-TRACK-012 | M1 | Must | US-247 | tracking · api/openapi identical 404 `TRACKING_NOT_FOUND`; ADR-0009 Luhn pre-check | TASK-176 | – | Planned |
| REQ-TRACK-013 | M1 | Must | US-251 | tracking + apps/web · api/openapi `getShipmentTracking` (full timeline); UX W11 | TASK-184, TASK-185 | – | Planned |
| REQ-TRACK-014 | M1 | Must | US-245 | packages/carriers · ADR-0010 §Mock carrier tracking scenarios (`track=…`) | TASK-208 | – | Planned |
| REQ-TRACK-015 | M1 | Could | US-253 | tracking · api/README §7 route limit `refreshShipmentTracking` (1 per shipment per 5 min) | TASK-272 | – | Planned |
| REQ-ACCT-001 | M1 | Should | US-258 | apps/web · UX W10 dashboard; api/openapi `getDashboard` | TASK-258 | – | Planned |
| REQ-ACCT-002 | M1 | Must | US-254 | shipments · ADR-0016 §5 keyset pagination; data-model §3.11 indexes (AP-SHP-*) | TASK-183 | – | Planned |
| REQ-ACCT-003 | M1 | Must | US-255 | shipments + apps/web · api/openapi `getShipment` (history, tracking, documents); UX W11 | TASK-185 | – | Planned |
| REQ-ACCT-004 | M1 | Must | US-256 | shipments · data-model §3.11 drafts (step reached); api/openapi `listDrafts` | TASK-209 | – | Planned |
| REQ-ACCT-005 | M1 | Should | US-259 | quotes · data-model §3.10 saved quotes; api/openapi `listQuotes` | TASK-234 | – | Planned |
| REQ-ACCT-006 | M1 | Should | US-260 | shipments · api/openapi `repeatShipment` (new DRAFT prefilled) | TASK-262 | – | Planned |
| REQ-ACCT-007 | M1 | Should | US-261 | apps/web · UX W11 cancel action; ADR-0014 §Cancellation (allowed states) | TASK-253 | – | Planned |
| REQ-ACCT-008 | M1 | Should | US-262 | organisations · data-model §3.2 `address_book`; ADR-0008 (`address_book:manage`) | TASK-264 | – | Planned |
| REQ-ACCT-009 | M1 | Should | US-263 | organisations · data-model §3.2 `address_book` default sender; UX W03 prefill | TASK-264 | – | Planned |
| REQ-ACCT-010 | M1 | Could | US-264 | organisations · api/openapi `importAddressBook` (CSV ≤ 1 MB); ADR-0021 (upload seam) | TASK-273 | – | Planned |
| REQ-ACCT-011 | M1 | Should | US-265 | apps/web + payments · ADR-0012 §1 saved methods; ADR-0006 am. 12 step-up; UX W13 | TASK-254 | – | Planned |
| REQ-ACCT-012 | M1 | Should | US-266 | notifications · data-model §3.17 preferences; ADR-0020 §Preferences | TASK-263 | – | Planned |
| REQ-ACCT-013 | M1 | Should | US-267 | apps/web + identity · UX W13 security screen; ADR-0006 §TOTP / §Sessions | TASK-228 | – | Planned |
| REQ-ACCT-014 | M1 | Should | US-268 | organisations · api/openapi `getOrganisation`; ADR-0008 (`org:read`) | TASK-235 | – | Planned |
| REQ-ACCT-015 | M1 | Should | US-269 | organisations · ADR-0016 am. 5(f) (`LAST_OWNER` 422); data-model §3.2 owner invariant | TASK-235 | – | Planned |
| REQ-ACCT-016 | M1 | Could | US-270 | identity · ADR-0006 am. 12 (`privacy.export` scope); api/openapi `requestPrivacyExport` (1/min); ADR-0021 | TASK-274 | – | Planned |
| REQ-ACCT-017 | M1 | Could | US-271 | identity · ADR-0006 am. 12 (`privacy.delete` scope); ADR-0007 §Erasure (vault delete, M4/M5 jobs) | TASK-274 | – | Planned |
| REQ-ACCT-018 | M1 | Should | US-272 | identity · data-model §3.1 user preferences (locale, currency, units, zone); ADR-0026 §2 | TASK-268 | – | Planned |
| REQ-ACCT-019 | M1 | Should | US-273 | apps/web · ADR-0026 §1 (no placeholder routes); ARCHITECTURE §10 backlog seams | TASK-265 | – | Planned |
| REQ-ACCT-020 | M1 | Must | US-257 | platform · ADR-0005 §Policies (org-scoped lists; foreign IDs → 404) | TASK-211 | – | Planned |
| REQ-NOTIF-001 | M1 | Must | US-274 | notifications · ADR-0020 §1 `NotificationProvider` interface (`send`) | TASK-074 | – | Planned |
| REQ-NOTIF-002 | M1 | Should | US-275 | notifications · ADR-0020 §2 SES adapter (M5); ADR-0016 am. 10 (SDK egress exception) | TASK-266 | – | Planned |
| REQ-NOTIF-003 | M1 | Must | US-276 | notifications · ADR-0020 §2 Mailpit locally (`MAIL_HOST`); platform.md §2.2 | TASK-074 | – | Planned |
| REQ-NOTIF-004 | M1 | Must | US-277 | notifications · ADR-0020 §4 event → template map (DR-B28) | TASK-086, TASK-169 | – | Planned |
| REQ-NOTIF-005 | M1 | Must | US-279 | notifications · ADR-0020 §3 versioned templates; data-model §3.17 | TASK-082 | – | Planned |
| REQ-NOTIF-006 | M1 | Must | US-280 | notifications · ADR-0020 §3 locale rendering (fallback chain); ADR-0026 am. 3 ICU | TASK-082 | – | Planned |
| REQ-NOTIF-007 | M1 | Must | US-282 | notifications · ADR-0020 §4 (verification, reset and security notices ignore preferences) | TASK-086 | – | Planned |
| REQ-NOTIF-008 | M1 | Must | US-283 | notifications · ADR-0020 §4 booking confirmation; ADR-0019 am. 1 (SENSITIVE documents never attached, D-051) | TASK-179 | – | Planned |
| REQ-NOTIF-009 | M1 | Should | US-286 | notifications · ADR-0020 §4 (receipt, pickup scheduled/cancelled/failed, booking failed templates) | TASK-257 | – | Planned |
| REQ-NOTIF-010 | M1 | Should | US-287 | notifications · ADR-0020 §4 tracking milestone templates; REQ-TRACK-007 events | TASK-259 | – | Planned |
| REQ-NOTIF-011 | M1 | Should | US-288 | notifications · ADR-0020 §Preferences (`tracking_updates` suppression) | TASK-263 | – | Planned |
| REQ-NOTIF-012 | M1 | Should | US-289 | notifications · ADR-0020 §5 notification log (masked recipient, D-040); data-model §3.17 | TASK-267 | – | Planned |
| REQ-NOTIF-013 | M1 | Must | US-284 | notifications (worker) · ADR-0020 §6 `notifications` queue (5 attempts, backoff); ADR-0013 | TASK-074 | – | Planned |
| REQ-NOTIF-014 | M1 | Must | US-278 | notifications (worker) · ADR-0004 outbox → job idempotency key; ADR-0013 | TASK-078 | – | Planned |
| REQ-NOTIF-015 | M1 | Must | US-285 | notifications · ADR-0020 §4 recipient rules (booking organisation only) | TASK-213 | – | Planned |
| REQ-NOTIF-016 | M1 | Could | US-290 | notifications · ADR-0020 §1 channel seams (`SMS`, `WHATSAPP` not implemented) | TASK-275 | – | Planned |
| REQ-NOTIF-017 | M1 | Must | US-281 | notifications · ADR-0020 §3 template completeness CI check (subject, HTML, text × en/es/fr) | TASK-212 | – | Planned |

## Story → Requirement
| Story | Epic | MS | MoSCoW | Size | Linked REQs | DC |
|---|---|---|---|---|---|---|
| US-001 | EPIC-01 | M0 | Must | M | REQ-PLAT-001, REQ-PLAT-002, REQ-PLAT-003 | DC |
| US-002 | EPIC-01 | M0 | Must | S | REQ-PLAT-004 | DC |
| US-003 | EPIC-01 | M0 | Must | M | REQ-PLAT-005 | DC |
| US-004 | EPIC-01 | M0 | Must | M | REQ-PLAT-006 | DC |
| US-005 | EPIC-01 | M0 | Must | M | REQ-PLAT-007 |  |
| US-006 | EPIC-01 | M0 | Must | S | REQ-PLAT-008 |  |
| US-007 | EPIC-01 | M0 | Must | M | REQ-PLAT-009, REQ-PLAT-010 |  |
| US-008 | EPIC-01 | M0 | Must | M | REQ-PLAT-011, REQ-PLAT-012 |  |
| US-009 | EPIC-01 | M0 | Must | M | REQ-PLAT-013 | DC |
| US-010 | EPIC-01 | M0 | Must | M | REQ-PLAT-014, REQ-PLAT-015 | DC |
| US-011 | EPIC-01 | M0 | Must | M | REQ-PLAT-016, REQ-PLAT-017 | DC |
| US-012 | EPIC-01 | M0 | Must | S | REQ-PLAT-018 | DC |
| US-013 | EPIC-01 | M0 | Should | S | REQ-PLAT-019, REQ-PLAT-022 |  |
| US-014 | EPIC-01 | M0 | Should | M | REQ-PLAT-020, REQ-PLAT-021 |  |
| US-015 | EPIC-02 | M0 | Must | M | REQ-AUTH-001, REQ-AUTH-002, REQ-AUTH-003 | DC |
| US-016 | EPIC-02 | M0 | Must | S | REQ-AUTH-004 | DC |
| US-017 | EPIC-02 | M0 | Must | M | REQ-AUTH-005 | DC |
| US-018 | EPIC-02 | M0 | Must | M | REQ-AUTH-006, REQ-AUTH-007, REQ-AUTH-008 | DC |
| US-019 | EPIC-02 | M0 | Must | M | REQ-AUTH-009 |  |
| US-020 | EPIC-02 | M0 | Must | M | REQ-AUTH-010 | DC |
| US-021 | EPIC-02 | M0 | Must | M | REQ-AUTH-011, REQ-AUTH-012 |  |
| US-022 | EPIC-02 | M0 | Must | M | REQ-AUTH-013, REQ-AUTH-014 |  |
| US-023 | EPIC-02 | M0 | Must | M | REQ-AUTH-015, REQ-AUTH-016 | DC |
| US-024 | EPIC-02 | M0 | Must | M | REQ-AUTH-017 | DC |
| US-025 | EPIC-02 | M0 | Must | S | REQ-AUTH-018 | DC |
| US-026 | EPIC-02 | M1 | Should | M | REQ-AUTH-019, REQ-AUTH-020, REQ-ADMIN-008 |  |
| US-027 | EPIC-02 | M1 | Must | M | REQ-AUTH-021, REQ-AUTH-022, REQ-ADMIN-007 |  |
| US-028 | EPIC-02 | M1 | Should | S | REQ-AUTH-023 |  |
| US-029 | EPIC-02 | M0 | Should | S | REQ-AUTH-024 |  |
| US-030 | EPIC-02 | M0 | Must | S | REQ-ADMIN-001, REQ-ADMIN-003 | DC |
| US-031 | EPIC-02 | M0 | Must | M | REQ-ADMIN-002 | DC |
| US-032 | EPIC-02 | M0 | Must | M | REQ-ADMIN-005, REQ-ADMIN-006, REQ-ADMIN-009 | DC |
| US-033 | EPIC-02 | M0 | Should | S | REQ-ADMIN-004, REQ-ADMIN-010 |  |
| US-034 | EPIC-16 | M0 | Must | M | REQ-API-001, REQ-API-002, REQ-API-004 | DC |
| US-035 | EPIC-16 | M0 | Should | M | REQ-API-003, REQ-API-015, REQ-API-019, REQ-API-020 |  |
| US-036 | EPIC-16 | M0 | Must | M | REQ-API-005, REQ-API-006 |  |
| US-037 | EPIC-16 | M0 | Must | M | REQ-API-007, REQ-API-008 |  |
| US-038 | EPIC-16 | M0 | Must | M | REQ-API-009, REQ-API-010, REQ-API-011 | DC |
| US-039 | EPIC-16 | M0 | Must | M | REQ-API-012, REQ-API-013 |  |
| US-040 | EPIC-16 | M0 | Must | M | REQ-API-014, REQ-SEC-005, REQ-SEC-006 |  |
| US-041 | EPIC-16 | M0 | Must | S | REQ-API-016 |  |
| US-042 | EPIC-16 | M0 | Must | M | REQ-API-017, REQ-API-018 | DC |
| US-043 | EPIC-16 | M0 | Must | M | REQ-SEC-001, REQ-SEC-002, REQ-SEC-003 |  |
| US-044 | EPIC-16 | M0 | Must | M | REQ-SEC-004, REQ-SEC-014 |  |
| US-045 | EPIC-16 | M0 | Must | M | REQ-SEC-007, REQ-SEC-015 |  |
| US-046 | EPIC-16 | M0 | Must | M | REQ-SEC-008, REQ-SEC-009, REQ-SEC-016 |  |
| US-047 | EPIC-16 | M0 | Must | M | REQ-SEC-010, REQ-SEC-012 |  |
| US-048 | EPIC-16 | M0 | Must | M | REQ-SEC-011, REQ-SEC-013 |  |
| US-049 | EPIC-17 | M0 | Must | M | REQ-DATA-001, REQ-DATA-002 | DC |
| US-050 | EPIC-17 | M0 | Must | M | REQ-DATA-003 | DC |
| US-051 | EPIC-17 | M0 | Must | M | REQ-DATA-004, REQ-DATA-005, REQ-DATA-007 | DC |
| US-052 | EPIC-17 | M0 | Must | S | REQ-DATA-006, REQ-DATA-014 | DC |
| US-053 | EPIC-17 | M0 | Must | M | REQ-DATA-016 | DC |
| US-054 | EPIC-17 | M1 | Must | M | REQ-DATA-008, REQ-DATA-009, REQ-DATA-010, REQ-DATA-012, REQ-DATA-013 | DC |
| US-055 | EPIC-17 | M1 | Must | M | REQ-DATA-011 |  |
| US-056 | EPIC-17 | M1 | Must | M | REQ-DATA-015, REQ-DATA-017 | DC |
| US-057 | EPIC-17 | M1 | Must | M | REQ-COMP-001, REQ-COMP-002 |  |
| US-058 | EPIC-17 | M1 | Must | M | REQ-COMP-003, REQ-COMP-008 |  |
| US-059 | EPIC-17 | M1 | Must | M | REQ-COMP-004, REQ-COMP-005, REQ-COMP-006 |  |
| US-060 | EPIC-17 | M1 | Should | S | REQ-COMP-007 |  |
| US-061 | EPIC-03 | M0 | Must | S | REQ-ORG-001 | DC |
| US-062 | EPIC-03 | M0 | Must | M | REQ-ORG-002, REQ-ORG-003, REQ-ORG-004 | DC |
| US-063 | EPIC-03 | M0 | Must | M | REQ-ORG-005 | DC |
| US-064 | EPIC-03 | M0 | Must | M | REQ-RLS-009, REQ-RLS-012, REQ-ORG-007 |  |
| US-065 | EPIC-03 | M0 | Must | S | REQ-RBAC-001, REQ-RBAC-014 | DC |
| US-066 | EPIC-03 | M0 | Must | M | REQ-RBAC-002, REQ-RBAC-003, REQ-RBAC-004 | DC |
| US-067 | EPIC-03 | M0 | Must | M | REQ-RBAC-005 | DC |
| US-068 | EPIC-03 | M0 | Must | M | REQ-RBAC-006, REQ-RBAC-008 | DC |
| US-069 | EPIC-03 | M0 | Must | S | REQ-RBAC-007 |  |
| US-070 | EPIC-03 | M0 | Must | M | REQ-RBAC-009, REQ-RBAC-010 |  |
| US-071 | EPIC-03 | M0 | Must | M | REQ-RBAC-011 | DC |
| US-072 | EPIC-03 | M1 | Must | S | REQ-RBAC-012 |  |
| US-073 | EPIC-03 | M0 | Should | S | REQ-RBAC-013 |  |
| US-074 | EPIC-03 | M0 | Must | M | REQ-RLS-001, REQ-RLS-002, REQ-RLS-005 | DC |
| US-075 | EPIC-03 | M0 | Must | S | REQ-RLS-003, REQ-RLS-004 | DC |
| US-076 | EPIC-03 | M0 | Must | S | REQ-RLS-006 | DC |
| US-077 | EPIC-03 | M0 | Must | M | REQ-RLS-007 |  |
| US-078 | EPIC-03 | M0 | Must | S | REQ-RLS-008 | DC |
| US-079 | EPIC-03 | M0 | Must | M | REQ-RLS-010, REQ-RLS-011 |  |
| US-080 | EPIC-03 | M0 | Must | S | REQ-RLS-013 | DC |
| US-081 | EPIC-03 | M1 | Should | S | REQ-ORG-006 |  |
| US-082 | EPIC-03 | M1 | Should | M | REQ-ORG-008, REQ-ORG-009 |  |
| US-083 | EPIC-03 | M1 | Should | M | REQ-ORG-010 |  |
| US-084 | EPIC-03 | M1 | Should | S | REQ-ORG-011 |  |
| US-085 | EPIC-03 | M1 | Should | M | REQ-ORG-012, REQ-ORG-013, REQ-ORG-014 |  |
| US-086 | EPIC-04 | M0 | Must | M | REQ-AUDIT-001, REQ-AUDIT-006 | DC |
| US-087 | EPIC-04 | M0 | Must | M | REQ-AUDIT-002, REQ-AUDIT-003, REQ-AUDIT-011 | DC |
| US-088 | EPIC-04 | M0 | Must | M | REQ-AUDIT-004, REQ-AUDIT-010 | DC |
| US-089 | EPIC-04 | M0 | Must | S | REQ-AUDIT-005 |  |
| US-090 | EPIC-04 | M0 | Must | S | REQ-AUDIT-007 |  |
| US-091 | EPIC-04 | M0 | Must | M | REQ-AUDIT-008, REQ-AUDIT-009 |  |
| US-092 | EPIC-04 | M0 | Must | M | REQ-AUDIT-012 | DC |
| US-093 | EPIC-04 | M0 | Must | S | REQ-AUDIT-013 |  |
| US-094 | EPIC-04 | M0 | Must | M | REQ-AUDIT-014, REQ-AUDIT-015 | DC |
| US-095 | EPIC-04 | M0 | Must | M | REQ-AUDIT-016, REQ-AUDIT-017 | DC |
| US-096 | EPIC-04 | M0 | Must | M | REQ-AUDIT-024 | DC |
| US-097 | EPIC-04 | M0 | Must | M | REQ-AUDIT-019, REQ-AUDIT-023 | DC |
| US-098 | EPIC-04 | M0 | Must | M | REQ-AUDIT-020, REQ-AUDIT-022 | DC |
| US-099 | EPIC-04 | M1 | Should | S | REQ-AUDIT-021 |  |
| US-100 | EPIC-04 | M0 | Should | S | REQ-AUDIT-025, REQ-AUDIT-018 |  |
| US-101 | EPIC-05 | M0 | Must | S | REQ-UI-001 | DC |
| US-102 | EPIC-05 | M0 | Must | M | REQ-UI-002 |  |
| US-103 | EPIC-05 | M0 | Must | M | REQ-UI-003, REQ-UI-004, REQ-UI-005 |  |
| US-104 | EPIC-05 | M0 | Must | M | REQ-UI-006, REQ-UI-007 |  |
| US-105 | EPIC-05 | M0 | Must | M | REQ-UI-008, REQ-UI-009 |  |
| US-106 | EPIC-05 | M0 | Must | M | REQ-UI-010, REQ-UI-022 |  |
| US-107 | EPIC-05 | M0 | Must | M | REQ-UI-011, REQ-UI-012 | DC |
| US-108 | EPIC-05 | M0 | Must | M | REQ-UI-013 | DC |
| US-109 | EPIC-05 | M1 | Must | M | REQ-UI-014, REQ-UI-015 | DC |
| US-110 | EPIC-05 | M0 | Must | M | REQ-UI-016 | DC |
| US-111 | EPIC-05 | M1 | Should | S | REQ-UI-017, REQ-UI-018 |  |
| US-112 | EPIC-05 | M1 | Must | M | REQ-UI-019 |  |
| US-113 | EPIC-05 | M0 | Must | M | REQ-UI-020, REQ-UI-021 |  |
| US-114 | EPIC-05 | M1 | Should | M | REQ-UI-023 |  |
| US-115 | EPIC-05 | M0 | Must | M | REQ-I18N-001, REQ-I18N-002, REQ-I18N-003, REQ-I18N-013 | DC |
| US-116 | EPIC-05 | M0 | Must | M | REQ-I18N-004, REQ-I18N-011, REQ-I18N-014 | DC |
| US-117 | EPIC-05 | M0 | Must | M | REQ-I18N-006, REQ-I18N-007, REQ-I18N-008 | DC |
| US-118 | EPIC-05 | M1 | Should | S | REQ-I18N-012 |  |
| US-119 | EPIC-05 | M1 | Must | M | REQ-I18N-005 | DC |
| US-120 | EPIC-05 | M0 | Must | M | REQ-I18N-009, REQ-I18N-010 |  |
| US-121 | EPIC-06 | M0 | Must | M | REQ-CARR-001, REQ-CARR-002, REQ-CARR-003 | DC |
| US-122 | EPIC-06 | M0 | Must | M | REQ-CARR-004 | DC |
| US-123 | EPIC-06 | M0 | Must | M | REQ-CARR-005, REQ-CARR-006 |  |
| US-124 | EPIC-06 | M0 | Must | S | REQ-CARR-007 | DC |
| US-125 | EPIC-06 | M0 | Must | M | REQ-CARR-011 |  |
| US-126 | EPIC-06 | M0 | Must | M | REQ-CARR-008 | DC |
| US-127 | EPIC-06 | M1 | Must | S | REQ-CARR-021 | DC |
| US-128 | EPIC-06 | M1 | Must | S | REQ-CARR-015 | DC |
| US-129 | EPIC-06 | M1 | Must | S | REQ-CARR-016 |  |
| US-130 | EPIC-06 | M1 | Must | M | REQ-CARR-017 |  |
| US-131 | EPIC-06 | M1 | Must | M | REQ-CARR-012 | DC |
| US-132 | EPIC-06 | M1 | Must | M | REQ-CARR-013 | DC |
| US-133 | EPIC-06 | M1 | Must | M | REQ-CARR-014 | DC |
| US-134 | EPIC-06 | M1 | Must | S | REQ-CARR-010 |  |
| US-135 | EPIC-06 | M1 | Must | M | REQ-CARR-009 | DC |
| US-136 | EPIC-06 | M1 | Must | S | REQ-CARR-018 |  |
| US-137 | EPIC-06 | M1 | Must | S | REQ-CARR-019, REQ-CARR-020 |  |
| US-138 | EPIC-07 | M0 | Must | M | REQ-PRICE-001, REQ-PRICE-002 | DC |
| US-139 | EPIC-07 | M0 | Must | S | REQ-PRICE-004 | DC |
| US-140 | EPIC-07 | M0 | Must | S | REQ-PRICE-003 | DC |
| US-141 | EPIC-07 | M1 | Must | S | REQ-PRICE-005 |  |
| US-142 | EPIC-07 | M1 | Must | M | REQ-PRICE-006, REQ-PRICE-007 |  |
| US-143 | EPIC-07 | M1 | Must | S | REQ-PRICE-008 |  |
| US-144 | EPIC-07 | M1 | Should | M | REQ-PRICE-009, REQ-PRICE-018 |  |
| US-145 | EPIC-07 | M1 | Should | M | REQ-PRICE-010, REQ-PRICE-011 |  |
| US-146 | EPIC-07 | M1 | Must | S | REQ-PRICE-013 |  |
| US-147 | EPIC-07 | M1 | Must | M | REQ-PRICE-014 |  |
| US-148 | EPIC-07 | M1 | Must | S | REQ-PRICE-015 |  |
| US-149 | EPIC-07 | M1 | Must | M | REQ-PRICE-016 |  |
| US-150 | EPIC-07 | M1 | Must | M | REQ-PRICE-017 | DC |
| US-151 | EPIC-07 | M1 | Must | M | REQ-PRICE-019 |  |
| US-152 | EPIC-07 | M1 | Must | M | REQ-PRICE-020 |  |
| US-153 | EPIC-07 | M1 | Could | S | REQ-PRICE-012, REQ-PRICE-021 |  |
| US-154 | EPIC-08 | M0 | Must | M | REQ-QUOTE-001 | DC |
| US-155 | EPIC-08 | M0 | Must | M | REQ-QUOTE-002 | DC |
| US-156 | EPIC-08 | M0 | Must | M | REQ-QUOTE-003, REQ-QUOTE-004 | DC |
| US-157 | EPIC-08 | M1 | Must | M | REQ-QUOTE-005, REQ-QUOTE-006 |  |
| US-158 | EPIC-08 | M1 | Must | M | REQ-QUOTE-023 | DC |
| US-159 | EPIC-08 | M1 | Must | M | REQ-QUOTE-007, REQ-QUOTE-012 | DC |
| US-160 | EPIC-08 | M1 | Must | M | REQ-QUOTE-008 | DC |
| US-161 | EPIC-08 | M1 | Must | M | REQ-QUOTE-009, REQ-QUOTE-011 | DC |
| US-162 | EPIC-08 | M1 | Should | S | REQ-QUOTE-010 |  |
| US-163 | EPIC-08 | M1 | Should | S | REQ-QUOTE-013 |  |
| US-164 | EPIC-08 | M1 | Should | M | REQ-QUOTE-014 |  |
| US-165 | EPIC-08 | M1 | Should | M | REQ-QUOTE-015 |  |
| US-166 | EPIC-08 | M1 | Must | S | REQ-QUOTE-016 | DC |
| US-167 | EPIC-08 | M1 | Must | M | REQ-QUOTE-017 |  |
| US-168 | EPIC-08 | M1 | Must | S | REQ-QUOTE-018 |  |
| US-169 | EPIC-08 | M1 | Should | M | REQ-QUOTE-019, REQ-QUOTE-022 |  |
| US-170 | EPIC-08 | M1 | Should | M | REQ-QUOTE-020, REQ-QUOTE-021 |  |
| US-171 | EPIC-09 | M1 | Must | M | REQ-BOOK-001 | DC |
| US-172 | EPIC-09 | M1 | Must | M | REQ-BOOK-002 | DC |
| US-173 | EPIC-09 | M0 | Must | S | REQ-BOOK-027, REQ-BOOK-028 | DC |
| US-174 | EPIC-09 | M1 | Must | M | REQ-BOOK-003 | DC |
| US-175 | EPIC-09 | M1 | Must | M | REQ-BOOK-005 | DC |
| US-176 | EPIC-09 | M1 | Must | S | REQ-BOOK-006 |  |
| US-177 | EPIC-09 | M1 | Must | S | REQ-BOOK-008 |  |
| US-178 | EPIC-09 | M1 | Should | S | REQ-BOOK-007 |  |
| US-179 | EPIC-09 | M1 | Should | M | REQ-BOOK-004 |  |
| US-180 | EPIC-09 | M1 | Must | M | REQ-BOOK-009, REQ-CUST-001, REQ-CUST-002 | DC |
| US-181 | EPIC-09 | M1 | Must | M | REQ-CUST-003, REQ-CUST-004 | DC |
| US-182 | EPIC-09 | M1 | Must | S | REQ-CUST-006, REQ-CUST-007 | DC |
| US-183 | EPIC-09 | M1 | Must | M | REQ-CUST-009 |  |
| US-184 | EPIC-09 | M1 | Must | S | REQ-CUST-010, REQ-CUST-011 |  |
| US-185 | EPIC-09 | M1 | Should | S | REQ-CUST-005, REQ-CUST-008 |  |
| US-186 | EPIC-09 | M1 | Must | M | REQ-CUST-012, REQ-CUST-013 | DC |
| US-187 | EPIC-09 | M1 | Must | S | REQ-CUST-015 |  |
| US-188 | EPIC-09 | M1 | Should | S | REQ-CUST-014 |  |
| US-189 | EPIC-09 | M1 | Must | S | REQ-BOOK-010 | DC |
| US-190 | EPIC-09 | M1 | Should | M | REQ-BOOK-011 |  |
| US-191 | EPIC-09 | M1 | Must | M | REQ-BOOK-012 | DC |
| US-192 | EPIC-09 | M1 | Must | S | REQ-BOOK-013 | DC |
| US-193 | EPIC-09 | M1 | Should | S | REQ-BOOK-014 |  |
| US-194 | EPIC-09 | M1 | Should | S | REQ-BOOK-015 |  |
| US-195 | EPIC-09 | M1 | Must | M | REQ-BOOK-017 | DC |
| US-196 | EPIC-09 | M1 | Should | M | REQ-BOOK-029 |  |
| US-197 | EPIC-10 | M0 | Must | M | REQ-BOOK-018 | DC |
| US-198 | EPIC-10 | M0 | Must | S | REQ-BOOK-019 | DC |
| US-199 | EPIC-10 | M0 | Must | M | REQ-PAY-001, REQ-PAY-002 | DC |
| US-200 | EPIC-10 | M0 | Must | S | REQ-PAY-003 | DC |
| US-201 | EPIC-10 | M0 | Must | S | REQ-BOOK-026 | DC |
| US-202 | EPIC-10 | M0 | Must | M | REQ-BOOK-020 | DC |
| US-203 | EPIC-10 | M0 | Must | M | REQ-BOOK-021 | DC |
| US-204 | EPIC-10 | M0 | Must | M | REQ-BOOK-022 |  |
| US-205 | EPIC-10 | M0 | Must | S | REQ-BOOK-023 |  |
| US-206 | EPIC-10 | M1 | Must | S | REQ-BOOK-024 |  |
| US-207 | EPIC-10 | M1 | Must | S | REQ-BOOK-025 | DC |
| US-208 | EPIC-10 | M1 | Must | M | REQ-BOOK-016, REQ-PAY-007 | DC |
| US-209 | EPIC-10 | M1 | Must | M | REQ-PAY-006, REQ-PAY-008 | DC |
| US-210 | EPIC-10 | M1 | Must | M | REQ-PAY-004, REQ-PAY-017 | DC |
| US-211 | EPIC-10 | M1 | Must | S | REQ-PAY-005, REQ-PAY-019 |  |
| US-212 | EPIC-10 | M1 | Must | M | REQ-PAY-009, REQ-PAY-010 | DC |
| US-213 | EPIC-10 | M1 | Must | M | REQ-PAY-011, REQ-PAY-012 | DC |
| US-214 | EPIC-10 | M1 | Must | M | REQ-PAY-016, REQ-PAY-017 | DC |
| US-215 | EPIC-10 | M1 | Should | M | REQ-BOOK-030 |  |
| US-216 | EPIC-10 | M1 | Should | M | REQ-PAY-013 |  |
| US-217 | EPIC-10 | M1 | Should | M | REQ-PAY-014 |  |
| US-218 | EPIC-10 | M1 | Should | S | REQ-PAY-015 |  |
| US-219 | EPIC-10 | M1 | Should | S | REQ-PAY-018 |  |
| US-220 | EPIC-11 | M1 | Must | M | REQ-DOC-001, REQ-DOC-005, REQ-DOC-006 | DC |
| US-221 | EPIC-11 | M1 | Must | S | REQ-DOC-004 |  |
| US-222 | EPIC-11 | M1 | Must | M | REQ-DOC-002 | DC |
| US-223 | EPIC-11 | M1 | Must | M | REQ-DOC-012 | DC |
| US-224 | EPIC-11 | M1 | Must | M | REQ-DOC-011 | DC |
| US-225 | EPIC-11 | M1 | Must | M | REQ-DOC-007 | DC |
| US-226 | EPIC-11 | M1 | Must | S | REQ-DOC-008 |  |
| US-227 | EPIC-11 | M1 | Should | S | REQ-DOC-009 |  |
| US-228 | EPIC-11 | M1 | Should | M | REQ-DOC-010 |  |
| US-229 | EPIC-11 | M1 | Should | M | REQ-DOC-013, REQ-DOC-014 |  |
| US-230 | EPIC-11 | M1 | Should | S | REQ-DOC-003 |  |
| US-231 | EPIC-11 | M1 | Could | S | REQ-DOC-015 |  |
| US-232 | EPIC-12 | M1 | Must | M | REQ-PICK-002, REQ-PICK-003, REQ-PICK-004 | DC |
| US-233 | EPIC-12 | M1 | Must | S | REQ-PICK-001, REQ-PICK-012 | DC |
| US-234 | EPIC-12 | M1 | Must | M | REQ-PICK-001, REQ-PICK-002, REQ-PICK-004 | DC |
| US-235 | EPIC-12 | M1 | Must | M | REQ-PICK-005, REQ-PICK-006 | DC |
| US-236 | EPIC-12 | M1 | Must | S | REQ-PICK-007 |  |
| US-237 | EPIC-12 | M1 | Must | S | REQ-PICK-008 |  |
| US-238 | EPIC-12 | M1 | Should | S | REQ-PICK-009 |  |
| US-239 | EPIC-12 | M1 | Should | M | REQ-PICK-010, REQ-PICK-013 |  |
| US-240 | EPIC-12 | M1 | Could | S | REQ-PICK-011, REQ-PICK-014 |  |
| US-241 | EPIC-13 | M1 | Must | M | REQ-TRACK-001 | DC |
| US-242 | EPIC-13 | M1 | Must | M | REQ-TRACK-002, REQ-TRACK-005 | DC |
| US-243 | EPIC-13 | M1 | Must | M | REQ-TRACK-003 |  |
| US-244 | EPIC-13 | M1 | Must | M | REQ-TRACK-004 |  |
| US-245 | EPIC-13 | M1 | Must | S | REQ-TRACK-014 |  |
| US-246 | EPIC-13 | M1 | Should | S | REQ-TRACK-007 |  |
| US-247 | EPIC-13 | M1 | Must | M | REQ-TRACK-008, REQ-TRACK-012 | DC |
| US-248 | EPIC-13 | M1 | Must | M | REQ-TRACK-011 | DC |
| US-249 | EPIC-13 | M1 | Must | S | REQ-TRACK-010 |  |
| US-250 | EPIC-13 | M1 | Should | S | REQ-TRACK-009 |  |
| US-251 | EPIC-13 | M1 | Must | M | REQ-TRACK-013 | DC |
| US-252 | EPIC-13 | M1 | Should | M | REQ-TRACK-006 |  |
| US-253 | EPIC-13 | M1 | Could | S | REQ-TRACK-015 |  |
| US-254 | EPIC-14 | M1 | Must | M | REQ-ACCT-002 | DC |
| US-255 | EPIC-14 | M1 | Must | M | REQ-ACCT-003 | DC |
| US-256 | EPIC-14 | M1 | Must | M | REQ-ACCT-004 |  |
| US-257 | EPIC-14 | M1 | Must | S | REQ-ACCT-020 |  |
| US-258 | EPIC-14 | M1 | Should | M | REQ-ACCT-001 |  |
| US-259 | EPIC-14 | M1 | Should | S | REQ-ACCT-005 |  |
| US-260 | EPIC-14 | M1 | Should | S | REQ-ACCT-006 |  |
| US-261 | EPIC-14 | M1 | Should | S | REQ-ACCT-007 |  |
| US-262 | EPIC-14 | M1 | Should | M | REQ-ACCT-008 |  |
| US-263 | EPIC-14 | M1 | Should | S | REQ-ACCT-009 |  |
| US-264 | EPIC-14 | M1 | Could | M | REQ-ACCT-010 |  |
| US-265 | EPIC-14 | M1 | Should | S | REQ-ACCT-011 |  |
| US-266 | EPIC-14 | M1 | Should | S | REQ-ACCT-012 |  |
| US-267 | EPIC-14 | M1 | Should | S | REQ-ACCT-013 |  |
| US-268 | EPIC-14 | M1 | Should | M | REQ-ACCT-014 |  |
| US-269 | EPIC-14 | M1 | Should | S | REQ-ACCT-015 |  |
| US-270 | EPIC-14 | M1 | Could | S | REQ-ACCT-016 |  |
| US-271 | EPIC-14 | M1 | Could | S | REQ-ACCT-017 |  |
| US-272 | EPIC-14 | M1 | Should | S | REQ-ACCT-018 |  |
| US-273 | EPIC-14 | M1 | Should | S | REQ-ACCT-019 |  |
| US-274 | EPIC-15 | M1 | Must | S | REQ-NOTIF-001 | DC |
| US-275 | EPIC-15 | M1 | Should | S | REQ-NOTIF-002 |  |
| US-276 | EPIC-15 | M1 | Must | S | REQ-NOTIF-003 | DC |
| US-277 | EPIC-15 | M1 | Must | M | REQ-NOTIF-004 | DC |
| US-278 | EPIC-15 | M1 | Must | M | REQ-NOTIF-014 | DC |
| US-279 | EPIC-15 | M1 | Must | M | REQ-NOTIF-005 | DC |
| US-280 | EPIC-15 | M1 | Must | S | REQ-NOTIF-006 | DC |
| US-281 | EPIC-15 | M1 | Must | S | REQ-NOTIF-017 |  |
| US-282 | EPIC-15 | M1 | Must | M | REQ-NOTIF-007 | DC |
| US-283 | EPIC-15 | M1 | Must | M | REQ-NOTIF-008 | DC |
| US-284 | EPIC-15 | M1 | Must | M | REQ-NOTIF-013 | DC |
| US-285 | EPIC-15 | M1 | Must | S | REQ-NOTIF-015 |  |
| US-286 | EPIC-15 | M1 | Should | M | REQ-NOTIF-009 |  |
| US-287 | EPIC-15 | M1 | Should | S | REQ-NOTIF-010 |  |
| US-288 | EPIC-15 | M1 | Should | S | REQ-NOTIF-011 |  |
| US-289 | EPIC-15 | M1 | Should | M | REQ-NOTIF-012 |  |
| US-290 | EPIC-15 | M1 | Could | S | REQ-NOTIF-016 |  |
| US-291 | EPIC-02 | M1 | Must | M | REQ-AUTH-020, REQ-AUTH-025 |  |
| US-292 | EPIC-02 | M0 | Must | S | REQ-AUTH-026 |  |
| US-293 | EPIC-06 | M1 | Must | M | REQ-CARR-022, REQ-CARR-023 |  |

## NFR traceability
NFR → mechanism/ADR → test rows (all 91 NFR IDs incl. NFR-RES-007 added in v1.3, G1-C4) live in [`docs/03-architecture/nfr-traceability.md`](../03-architecture/nfr-traceability.md), owned by principal-architect (Design column) and qa-lead (Test column).
