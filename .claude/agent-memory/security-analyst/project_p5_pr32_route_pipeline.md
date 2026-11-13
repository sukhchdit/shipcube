---
name: project-p5-pr32-route-pipeline
description: PR #32 (TASK-020 defineRoute, request pipeline, SYSTEM port, lint) R1 @fa67aca 2026-11-13 PASS_WITH_CONDITIONS; PR32-SEC-01 MEDIUM T-83 blind to handlers; C1-C3; D-TASK020-03 confirmed with C2; R2 = delta + PR #20 union checks
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0032-TASK-020-security-review.md` (R1 written uncommitted into the main checkout, 222 lines). Head `fa67aca8325bf653599d281c3f7baa3668e9b58e`, merge base `c2ddfac`, main `c48910d` at the time. Verdict **PASS_WITH_CONDITIONS**: 1 MEDIUM, 6 LOW, 4 INFO. Code review R1 (same day) was CHANGES_REQUESTED (M1 S3-SDK lint boundary = PR30-SEC-08 (e) not delivered; m1-m8 overlap my 01/03/04/05/06).

**Findings.**
- 01 MEDIUM: T-83 rule `no-external-calls-in-tenant-tx` is lexical to `withTenantTx(cb)`; the tx slot runs every `defineRoute` handler inside the transaction, so handlers are never seen (probe: queue.add + setTimeout in a handler = 0 findings).
- 02 LOW: `authorise` passes `public` before checking the route's `auth`; 6 `public`-marker ops are authenticated (refreshSession, logoutSession, getCsrfToken, getQuote, streamQuoteResults, receiveCarrierPush). Leaky-authn probe reaches the handler.
- 03 LOW: audit/idempotency/rate-limit/MFA stubs fail open (authn fails closed).
- 04 LOW: closed-schema check top-level only (`Joi.object()` without keys accepts anything; nested open; serverControlled not nested).
- 05 LOW: unbranded descriptors mount (hand-built `transaction:none` on tenant, method `use`); boot checks only in main.ts; `ctx.req.res` sends before COMMIT (201 while rolled back); `transaction:none` + audited action allowed (7 public-tenancy audited ops).
- 06 LOW: SEC-TC-29 helper keys on `x-permission`, misses the 6 ops above; handler headers override private,no-store.
- 07 LOW: system-model-owner misses template-literal/computed `import()`, re-export from rule-excluded platform/db, raw SQL on SYSTEM tables (TASK-024).
- 08-11 INFO: PR20-SEC-20/21 not carried, -22 partly; single-valued RouteAuth (dual-mode); webhook principal + raw body; CODEOWNERS gaps (`tests/generated`, app.ts, main.ts, tools/openapi, tools/db/table-classes) + PR30-SEC-08 (e) + RegExp mount (CR m5).

**Conditions.** C1 = 01 (lint covers defineRoute handlers inline/same-file named/audit hook unless `transaction:'none'`, fixtures; architect pre-tx phase ruling). C2 = 02 (`auth !== 'anonymous'` ⇒ authenticated principal, before the `public` shortcut). C3 = 03 (mount-time refusal per stub). Preferred in the fix cycle; latest before the first module route needing each.

**D-TASK020-03 ruling:** confirmed. (c) forward direction kept; my R1 PR-0008 `⇔` over-specified (contract's receiveCarrierPush is `public` + carrierSignature). Compensation: C2 now; verifier list for webhook tasks (raw bytes, constant-time, tolerance, secret from route/carrierCode, mock refused in production, 400 WEBHOOK_SIGNATURE_INVALID audited, event-id de-dup).

**Closed here:** PR8-SEC-05 (a)-(d) merge condition; PR26-SEC-04 TASK-020 half (nested part moved to 04); PR21-SEC-06/08/09; PR20-SEC-13 item 4; PR19-SEC-01 mechanism; PR11-SEC-17 a/b; PR11-SEC-09 at tx slot. D-TASK020-05 deferral accepted (fails closed).

**Why:** this is the O3 chokepoint; every later module route inherits its gaps, and the conditions are cheap only before routes exist.

**How to apply (R2 and later):**
- R2 must be delta + merge-only: D-ORCH-044 merges PR #20 first, so #32 carries the union (owned overlap eslint.config.mjs, tools/lint/negative-fixtures.test.ts, tools/tsconfig.json). Check the §7 union list (app order, routePrefix first in `api` and on docs router, problem-handler `private`, installProcessErrorHandlers above services, both boot checks exit 78, RESTRICTED_IMPORT_PATTERNS BCRYPT+SUPERTEST+S3, no rule `off`, PR #20 logging.api.test supertest allow-list, lock = PR #20 blob). PR #33 overlaps jest.config.ts/package.json/negative-fixtures: second merger needs merge-only round.
- Note: on main's CODEOWNERS the slot folders are unowned, so a C2/C3-only fix in `platform/authz|audit|...` does not void the record (sim D); review all commits after fa67aca regardless. PR #33 adds `/apps/api/src/platform/`.
- TASK-052: actorId only from verified `sub`, `setPrincipal` only from platform/authn, principal kinds for provider/guest (CR n3), SEC-06 (b). TASK-040: idempotency scope list in §7. TASK-024: SEC-07 (c). TASK-091/052: SEC-09. Webhook tasks: §5 (ii) verifier list + SEC-10.

**Probe kit (session scratch, `review/PR-32-sec/probes/`):** `hooks.mjs` (copied PR-30 type-strip hooks), `p1-app.mjs` (composed createApp: hand-built descriptors, open schemas, authn/authz matrix, leaky-authn seam via `pipeline`, response-before-commit with a fake tenantTx + failing audit), `p2-lint.mjs`/`p2c-lint.mjs` (lintText on the head config), `p3-hostscan.mjs` (run dir + added lines, count-only), `p4-db.mjs` (isSqlFragment + TenantDb SYSTEM exclusion on a fake client), `p5-ctx.mjs`, `p7-filescan.mjs`, `record-sim.mjs` (15 scenarios). Extracts and clone removed; junctions unlinked (main node_modules 740).

Related: [[project-p5-pr8-authz-review]], [[project-p5-pr26-standard-columns]], [[project-p5-pr21-openapi-pipeline]], [[project-p5-pr20-logging]], [[project-p5-pr10-ci-lane]], [[project-security-review-conventions]]
