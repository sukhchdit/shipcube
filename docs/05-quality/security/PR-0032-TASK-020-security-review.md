# PR-0032 / TASK-020: mandatory route metadata, request-pipeline skeleton, SYSTEM-model port and new lint controls (round 1)

| Field | Value |
|---|---|
| PR | #32 `feat(api): mandatory route metadata and request-pipeline skeleton (TASK-020)`, https://github.com/sukhchdit/shipcube/pull/32, branch `feat/TASK-020-mandatory-route-metadata-build-time`. 21 first-parent commits on merge base `c2ddfac` (6 merges of `main`, 3 evidence commits). `main` is now `c48910d`; its delta since `c2ddfac` is docs and `.claude/agent-memory` only (D-ORCH-043/044, the PR #20 and PR #32 code-review records), so no owned path overlaps |
| Head | fa67aca8325bf653599d281c3f7baa3668e9b58e |
| Lane A evidence | Run [43425130109](https://github.com/sukhchdit/shipcube/actions/runs/43425130109) on `fa67aca`: **fast-lane `success`** (base-ref gates, lane-B evidence step, lint, typecheck, unit, build). `scans`: Gitleaks and Semgrep steps green; only "Security-owned paths need a review record (PR5-SEC-04, PR10-SEC-04)" failed, and `ci-gate` with it. This file is the missing record |
| Owned paths changed | 66 (simulated checker, §8): `tests/fixtures/lint/**` (40), `packages/authz/**` (8), `tools/eslint-rules/**` (7), `tools/lint/**` (4), `eslint.config.mjs`, `jest.config.ts`, `package.json`, `.gitignore` and three `tsconfig.json` (`tools/`, `tests/generated/`, `tests/contract-stubs/`). The rest of the 150-file net change (`apps/api/**`, `apps/worker/**`, `packages/shared/**`, `prisma/tests/**`, `tests/api/**`, `tests/generated/*.ts`, `tests/contract-stubs/stubs.ts`, `tools/openapi/**`, `tools/repo/**` and the three lane-B evidence runs under `docs/**`) is not owned on `main`. `package-lock.json`, `.github/**`, `tools/ci/**`, `tools/quality/**`, `.npmrc`, CODEOWNERS and the Gitleaks/Semgrep configs are byte-identical to the merge base |
| Reviewer / date | security-analyst, 2026-11-13, round 1. Read-only. Git ran in the main checkout against commit SHAs (one `git fetch`) and in a scratch `git clone --shared` checked out only at scenario commits. Probes ran on `git archive` extracts of `fa67aca` (type-stripped TypeScript under a resolve/load hook, `node_modules` junction to the main checkout, removed afterwards). No command of any kind ran in the PR worktree `Shipqube-TASK-020`. No Docker, no install, no build. Full lint, typecheck, unit, api, integration and coverage were not re-run: I rely on lane A run 43425130109, lane-B run `20261113T1202Z_532b4ae` and the code-review record (`docs/05-quality/reviews/PR-0032-TASK-020-code-review.md`, 505/505 targeted unit) |

## 1. Summary

TASK-020 is the platform's authorisation and validation chokepoint (O3). The skeleton is sound where it matters today:
- **No route can be mounted without metadata through the shipped composition.** `createApp` takes `RouteDescriptor[]` only and mounts them through `mountRoutes`; raw routers are gone; the drift walker and the route-metadata test (lane A unit) catch a raw handler, a path-mounted layer and any contract mismatch.
- **Authentication fails closed.** Every `session`, `quote-token` and `signature` route answers 401 `AUTH_REQUIRED` as `application/problem+json` with `Cache-Control: private, no-store` and the seven standard problem keys only, for GET, HEAD, upper-case and trailing-slash spellings (probe C). `anonymous` routes with a catalogued permission or `authenticated` also answer 401.
- **Authorisation is default-deny** for catalogued permissions (an authenticated principal holding the key), and a signature-only permission is never satisfied by `public` or a session (probe C7, control).
- **Order is right:** request context, step-0 limiter and CORS preflight path-less, then the JSON body, then `routes` (OPTIONS responder, docs, health, `/api/v1`); per route authn, MFA, authz, rate limit, validate, idempotency, ETag, execute. The tx slot runs handler and audit hook in one `withTenantTx` and sends after COMMIT (probe D0: a failing audit write gives 500, never 2xx).
- **Validation** rejects unknown top-level fields, never echoes values, and refuses server-controlled fields per body and per bulk item (probe B9). Joi 18.3.2 drops an own `__proto__` key from the validated value (B8).
- **SYSTEM-model port** (D-ARCH-080): SYSTEM delegates are absent from `TenantDb` at run time (`in`, `keys`, `Reflect.get` all refuse), reachable only through `systemDelegates(handle)` of a real handle, and closed by `revoke()` (probe P4).
- **Context builder** (PR26-SEC-04): reserved SYSTEM and ANONYMOUS ids, actor/authentication disagreement and an actorless OPERATOR are refused (probe P5, 6 of 6; 2 controls accepted).
- **PR8-SEC-05 (a)-(d) merge condition is met** (rules in `packages/authz/src/routes.ts`, one negative per rule, boot twin `assertRouteBindings` exits 78). **D-TASK020-03 is confirmed with a compensating control (§5).**
- Lockfile unchanged, no dependency added; no workflow change (D-ORCH-021 levers untouched); evidence run and all added lines carry 0 host fragments.

The gaps are in the controls that later tasks will lean on:
- **PR32-SEC-01 (MEDIUM): the T-83 lint never sees route handlers,** although the tx slot runs every handler inside the tenant transaction (lint probe T2/T2b/T3 silent, controls T1/T2c reported). The sheet put T-83 here because Wave-1 handlers are the first possible violators; as built, it protects no planned call site.
- **PR32-SEC-02 (LOW): `authorise` passes `public` without looking at the route's `auth`,** so on the six `public`-marker routes that are authenticated (carrier push, refresh, logout, CSRF token, guest quote read and stream) the authn slot is the only gate (C7: a leaky authn reaches the handler). This is the compensating control D-TASK020-03 needs.
- **PR32-SEC-03 (LOW): the audit, idempotency, rate-limit and MFA stubs fail open** where authn fails closed.
- LOWs 04 to 07 and INFOs 08 to 11 below.

**Findings: 1 MEDIUM, 6 LOW, 4 INFO. Nothing Critical or High. Verdict: PASS_WITH_CONDITIONS** (§9). The three conditions are small, in files this PR owns, and fit the fix cycle the code review already requested (CHANGES_REQUESTED: M1 S3-SDK boundary, m1-m8).

## 2. Method

| Area | How |
|---|---|
| Diff | `git diff c2ddfac fa67aca` (150 files). Read in full: `app.ts`, `main.ts`, `platform/routing/*`, every slot folder (`authn`, `mfa`, `authz`, `rate-limit`, `cors`, `validate`, `idempotency`, `etag`, `tx`, `audit`), `problem-handler.ts`, `fallback.ts`, `health/router.ts`, `db/{tenant-db,system-db,system-port,system-models}.ts`, the worker twin, `packages/authz` diff, the four new ESLint rules, the `eslint.config.mjs` diff, `tests/generated/{route-metadata,api-mounts}.ts`, `tools/openapi/drift.ts` diff, the SEC-TC-29 helper and api case, the coverage teardown |
| P1 composed app (`probes/p1-app.mjs`) | The head's real `createApp` over hand-built and `defineRoute` descriptors on a loopback listener: A hand-built descriptors (open query, `tenancy: tenant` + `transaction: none`, method `use`); B seven body schemas (six open forms, one closed control), nested and bulk server-controlled fields, own `__proto__`; C authn/authz responses for five auth/permission shapes across GET, HEAD, case, trailing slash, OPTIONS; C7 a pipeline whose authn slot calls `next()` without a principal; D a handler that writes through `ctx.req.res` with a failing audit hook (and the returned-result control); E `transaction: none` with an audited action |
| P2 lint (`p2-lint.mjs`, `p2c-lint.mjs`) | `ESLint#lintText` with the head's real `eslint.config.mjs` (`disableTypeChecked`, no project service) over in-memory files: T-83 in a `defineRoute` handler (inline and named) versus inside `withTenantTx(cb)`; aliasing forms; `system-model-owner` with literal, template-literal and computed dynamic imports, a re-export from `platform/db`, raw SQL on a SYSTEM table; the logging rules and the PR20-SEC-20/21 forms; Supertest static and dynamic import |
| P3 host fragments (`p3-hostscan.mjs`) | Count-only scan (labels and counts, never values) of every file of `20261113T1202Z_532b4ae` at the head and of every added line of `c2ddfac..fa67aca`, for the OS user name, its 8.3 stem, home and temp directories in both slash forms, host name and git e-mail; synthetic positive control built from the same needles at run time |
| P4 data layer (`p4-db.mjs`) | `isSqlFragment` over Prisma 7.10's real `sql`/`raw`/`Sql` (subclass, intermediate-prototype forge, getter, array, function, plain JSON) plus three negatives; `createTenantDb` over a fake client with one tenant and one SYSTEM model: top-level access, `in`/`keys`, `systemDelegates` on a real and a hand-made handle, `$queryRaw` naming the SYSTEM table, `revoke()` |
| P5 context builder (`p5-ctx.mjs`) | `tenantContextOf` over nine principals (reserved ids, actor/authentication mismatches, actorless OPERATOR, two accepted controls, the code review's n3 shape) |
| Contract facts | `openapi.yaml` scan: operations by `x-tenancy`, `x-audit.action`, `x-permission` and effective `security` (7 public-tenancy operations are audited; 6 `public`-marker operations are authenticated) |
| Lane A, evidence, ownership | Run 43425130109 job and step conclusions; CODEOWNERS on `main` and on PR #33's branch; owned-path overlap with open PRs #20 and #33 |
| Record | Simulated `check-security-owned-paths --pr 32` with main's `tools/ci` in a scratch clone, positive and negative controls (§8); Gitleaks v8.30.1 default-ruleset emulation over this record (§8) |

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner and due |
|---|---|---|---|---|---|---|
| PR32-SEC-01 | T-83 lint is lexical to `withTenantTx(cb)` and never sees route handlers, which the tx slot runs inside the tenant transaction | MEDIUM | CWE-400 | A04 | `tools/eslint-rules/no-external-calls-in-tenant-tx.mjs` `insideTenantTx` (lines 162-175); `platform/tx/execute.ts` `run` | senior-developer: **C1**, this fix cycle, at the latest before the first `transaction: 'tenant'` module route merges (TASK-026/TASK-040); principal-architect: pre-transaction phase ruling before the first handler that needs external I/O (checkout, booking, pickup) |
| PR32-SEC-02 | `authorise` passes the `public` marker without checking the route's declared `auth`; on authenticated `public` routes the authn slot is the only gate (D-TASK020-03 compensating control) | LOW | CWE-306 | A07 | `platform/authz/authorise.ts:14-17` | senior-developer: **C2**, this fix cycle, at the latest before the first non-anonymous `public` route (refresh/logout/CSRF, guest quote, carrier push); webhook tasks: §5 (ii) |
| PR32-SEC-03 | Slot stubs fail open: audit, idempotency, rate-limit (`auth`/`email-send` classes) and the staff MFA gate pass every route through | LOW | CWE-636 | A04 | `platform/{audit/capture,idempotency/idempotency,rate-limit/limits,mfa/mfa-gate}.ts` | senior-developer: **C3**, this fix cycle, at the latest before the first module route merges; each guard disappears when TASK-029/040/041 and the MFA task replace the folder |
| PR32-SEC-04 | Closed-schema check is top-level only: open and nested-open Joi objects, `pattern`, `Joi.any()` and open array items pass `defineRoute` and the parity test; nested server-controlled fields are not refused | LOW | CWE-915 | A08 | `routing/define-route.ts:193-211`; `validate/validate.ts:110-120`; `tests/generated/route-metadata.ts` `joiPart` | senior-developer, this fix cycle or before the first route with a request body; parity facets TASK-100 |
| PR32-SEC-05 | Composition invariants live outside the mount point: unbranded descriptors, boot checks only in `main.ts`, raw `req`/`res` in the handler context, `transaction: 'none'` with an audited action | LOW | CWE-693 | A04 | `routing/pipeline.ts:115-123`; `main.ts:26-28`; `routing/define-route.ts:83-92, 232-235` | senior-developer, this fix cycle (cheap) or before TASK-026 |
| PR32-SEC-06 | SEC-TC-29 verification gaps: the helper keys on `x-permission`, missing 6 authenticated operations (including the one that returns the access token); handler headers and the problem handler can drop `private` | LOW | CWE-525 | A04 | `tests/api/helpers/contract-validator.ts:224`; `tx/execute.ts:55-61`; `errors/problem-handler.ts:72-73` | senior-developer (helper, this fix cycle); TASK-052 (send/problem handler, before the first authenticated route answers 2xx) |
| PR32-SEC-07 | `system-model-owner` residuals: non-literal dynamic import, re-export from the rule-excluded `platform/db`, and raw SQL naming a SYSTEM table | LOW | CWE-284 | A01 | `tools/eslint-rules/system-model-owner.mjs:208-210, 303-311`; `eslint.config.mjs:755` (`ignores: [DB_PLATFORM, ...TEST_FILES]`); `db-raw-sql` scope | senior-developer (a, b) before TASK-040; TASK-024 raw-SQL manifest (c); devops CODEOWNERS (PR #33) |
| PR32-SEC-08 | Logging routings partly carried: PR20-SEC-13 item 4 done; PR20-SEC-20 (test-category imports) and -21 (literal event) not; -22 only for raw request names; T-83 lexical aliasing limits | INFO | CWE-532 | A09 | `tools/eslint-rules/no-raw-request-in-log.mjs`; `eslint.config.mjs` (no test-category boundary) | orchestrator: fold into TASK-022 / TASK-113 sheets |
| PR32-SEC-09 | Route authentication is single-valued: dual-mode and alternative schemes are not expressible, `x-permission-authenticated` is not in the metadata | INFO | CWE-287 | A07 | `packages/authz/src/routes.ts:24`; `tests/generated/route-metadata.ts:63-72`; `define-route.ts` `RouteSpec` | principal-architect ruling; TASK-052 / TASK-091 (first dual-mode route) |
| PR32-SEC-10 | Webhook principal and raw-body design unresolved: the context builder rightly refuses SYSTEM, the JSON parser runs app-wide before authn | INFO | CWE-347 | A08 | `tx/execute.ts:42-53`; `app.ts:73`; contract `receive*` operations | payments webhook task, carrier push task, principal-architect |
| PR32-SEC-11 | Ownership and boundary gaps around the O3 control: `tests/generated/**`, `app.ts`, `main.ts`, `tools/openapi/**`, `tools/db/table-classes/` unowned; PR30-SEC-08 (e) S3-SDK lint boundary not delivered (code review M1); RegExp-mount walker residual (code review m5) | INFO | CWE-693 | A08 | `.github/CODEOWNERS`; `eslint.config.mjs`; `tools/openapi/drift.ts:173-175` | devops (TASK-015 015-C); senior-developer (code review M1, m5) |

## 4. Finding details

### PR32-SEC-01 (MEDIUM): the T-83 lint never sees route handlers

**Where.** `no-external-calls-in-tenant-tx.mjs` `insideTenantTx` reports a call only when an ancestor function is an argument of a `withTenantTx(` / `.withTenantTx(` call. `tx/execute.ts` is the only per-request `withTenantTx` entry (the sheet says so), and it passes `inTransaction` by reference; `inTransaction` calls `route.handler(full)` and the audit hook. Module code therefore never contains `withTenantTx(`.

**Evidence (P2, P2c).** `fetch` plus a `setTimeout` sleep in a `defineRoute({ handler: async () => … })`: no T-83 finding (T2; `fetch` is reported only by the unrelated `outbound-http-via-client`). `deps.queue.add()` plus a `setTimeout` sleep in the same handler: **no finding at all** (T2b). A named handler function in the same file: none (T3). The identical body inside `withTenantTx(ctx, async () => …)`: reported (T1, T2c). The code review found the same (m4).

**Exploitability and impact.** No module route exists yet, but every Wave-1 tenant handler runs inside the transaction, and the pipeline offers no phase outside it. Checkout (Stripe), booking and pickup (carrier APIs), document e-mail and storage writes are the natural places for a developer to make an external call from the handler. Each such call holds a pooled connection, the tenant context and (with TASK-030) the audit stream lock for the length of the remote call, bounded only by the Prisma transaction timeout: pool exhaustion for every tenant (T-83, rated M/M MEDIUM in the threat model). A side effect performed before a later rollback (audit write failure, serialisation failure) cannot be undone, which is the shape of the "captured payment without a booked shipment" and "duplicate label" guardrails. Impact M, likelihood M: **MEDIUM**, the threat's own rating, because its only preventive mitigation does not reach the code it exists for.

**Remediation (C1).**
1. In `insideTenantTx`, also treat as a tenant-transaction root: (a) a function that is the value of a `handler` property of an object literal passed directly to `defineRoute(` (or `fixtureRoute(`), unless the same literal has `transaction: 'none'`; (b) an identifier there that resolves to a function declaration or `const` function in the same file; (c) functions typed or exported as the audit hook. Keep the "names" list; add the outbound client and carrier-adapter names when TASK-113 lands.
2. Negative fixtures, one per form: `rules/no-external-calls-in-tenant-tx/apps/api/src/modules/orders/routes/bad-handler-inline.ts`, `bad-handler-named.ts`, `bad-handler-queue.ts`, and a positive control `ok-handler-none.ts` (`transaction: 'none'`). Once on `main`, the base-ref no-weakening step keeps them.
3. principal-architect: give handlers a legitimate place for external I/O, either a `prepare(ctx)` step the execute slot runs before `withTenantTx` (its result passed to the handler) plus after-commit work only through the outbox, or a written rule that such work is always an outbox/worker step. Without it, C1 turns into lint disables at the first checkout handler.

**Verification.** The fixtures above report; T2b and T3 shapes in `negative-fixtures.test.ts`; a cross-file call stays a review/Semgrep item, as the sheet says.

### PR32-SEC-02 (LOW): `authorise` passes `public` whatever the route's `auth`

**Where.** `authorise.ts:14-17`: `if (route.permission === 'public') { next(); return; }` before any principal check. Six contract operations are `x-permission: public` but authenticated: `refreshSession`, `logoutSession`, `getCsrfToken` (session cookie), `getQuote`, `streamQuoteResults` (guest quote token), `receiveCarrierPush` (carrier signature).

**Evidence (P1 C7).** With an authn slot that calls `next()` without setting a principal (the defect a future authenticator could have), `public` + `signature` and `public` + `session` routes reached the handler (200), while `webhook:stripe:receive` + `signature` still answered 401 because authz checks the principal. Today's authn stub fails closed (probe C), so nothing is exploitable now.

**Impact.** On those routes, one defect in one replaceable folder (TASK-052 session, TASK-091 guest token, the webhook tasks) would expose a refresh or logout without a session, a guest quote without its token, or accept a forged carrier push (tracking state changes for any shipment). Exploitation needs that independent defect, so likelihood is very low; rated LOW like PR8-SEC-05.

**Remediation (C2).** In `authorise`, before the `public` shortcut: `if (route.auth !== 'anonymous' && !principalOf(res).authenticated) return next(new AppError('AUTH_REQUIRED'))`. The `public` marker then waives the permission only, never the authentication the route declares. The signature authenticator sets an authenticated provider principal (a principal kind with the provider id taken from the route, never a user actor); the quote-token authenticator sets an authenticated guest principal (the context-builder rule "authenticated ⇔ actor" needs the kind distinction then, code review n3). Test: the C7 seam on `public` + `signature`, `public` + `session` and `public` + `quote-token` routes gives 401.

### PR32-SEC-03 (LOW): slot stubs fail open

**Where and evidence.** `captureAudit` writes nothing for any action; `idempotency` and `etag` pass through; `routeRateLimit` passes every class; `mfaGate` passes every principal. The code review's probe P3 (a `public`, anonymous, `audit: CREATE`, `idempotency: required` route answered 201) shows the first two (m3). Authn is the one stub that fails closed.

**Impact.** The order of the batches is today's only control: a module route merged before TASK-029 writes no audit entry (O4), before TASK-040 accepts duplicate unsafe requests (duplicate-label and duplicate-payment guardrails), before TASK-041 serves the `auth` class without the brute-force limit that README §7 keeps even during a Redis outage, and once TASK-052 yields OPERATOR principals before the MFA task lands, staff without TOTP reach every route (REQ-AUTH-018). Impact M to H, likelihood L: LOW, made a condition because the fix is mechanical.

**Remediation (C3).** Each stub receives the descriptor at mount time, so it refuses at boot what it cannot honour, naming the owning task: audit throws for `audit.action !== 'NONE'` (TASK-029); idempotency for `required`/`optional` (TASK-040); rate-limit for classes `auth` and `email-send` (TASK-041); the MFA gate answers 403 `MFA_ENROLMENT_REQUIRED` for an OPERATOR principal on a route without `mfaGateExempt` (MFA task). The guards go away by construction when the owning task replaces the folder. Test: one mount-time refusal per stub.

### PR32-SEC-04 (LOW): nested and open Joi schemas

**Evidence (P1 B).** `defineRoute` accepts, and the slot lets through, `Joi.object()` without keys (B1: `{ role, status }` reached the handler), a nested `Joi.object()` (B2), a nested `.unknown(true)` (B3), `.pattern(/./, Joi.any())` (B4), `Joi.array().items(Joi.object())` (B5) and `Joi.any()` (B6); the closed control refused `role` (B0). A server-controlled field inside a nested object (`address.org_id`) is not refused (B7); in a bulk array item it is (B9). The parity test compares top-level facets only (D-TASK020 note, TASK-100), so a contract with `additionalProperties: false` at depth does not catch an open Joi object at depth. The code review found the nested case by inspection (m8).

**Impact.** Mass assignment of nested fields (REQ-SEC-007, AT-US-064-03). The standard-columns extension still refuses server columns and relation writes at the repository (PR #26), so the residual is business fields such as roles, statuses and amounts in nested objects. LOW.

**Remediation.** Walk `schema.describe()` recursively in `defineRoute`: every `object` node has `keys` (possibly empty), no `flags.unknown === true`, no `patterns`; no `any`/`alternatives` node without an explicit allow-list; every `array` has `items`. Run `serverControlledFieldIssues` over every nested object and array item (bounded by the validated depth). One test per form (B1-B7).

### PR32-SEC-05 (LOW): composition invariants outside the mount point

- **(a) Unbranded descriptors (P1 A; code review m2).** `RouteDescriptor` is structural. A hand-built descriptor with an open query schema and `tenancy: 'tenant'` + `transaction: 'none'` was mounted and answered 200 to `?anything=1` (A1); `defineRoute` would refuse both (A0). The registry knows it (A2), so the raw-handler check passes; the contract checks still catch method, path, permission, audit and top-level schema, but not `transaction`. Method `use` mounts a catch-all (A3: `POST /api/v1/u/deep/x` 200), which only the drift test catches. Fix: `defineRoute` adds each frozen descriptor to a module-private `WeakSet`; `mountRoutes` throws for any other object.
- **(b) Boot checks only in `main.ts`.** `assertPipelineReady` and `assertRouteBindings` run in `main.ts`; another composition (the worker's `@platform/api/runtime` consumers, a future server entry) would skip them. Fix: run both inside `createApp` (tests pass `production: false`).
- **(c) Raw request in the handler context (P1 D; code review n4).** `RouteContext.req` exposes `req.res`, `req.body`, `req.query`. A handler that answers through `ctx.req.res` sent **201 while the transaction rolled back** (D1: `committed 0, rolledBack 1`); the returned-result control gave 500 (D0). Fix: replace `req` with a frozen transport view (`ip`, `userAgent`, the declared headers) built in the context slot.
- **(d) `transaction: 'none'` with an audited action (P1 E).** Allowed today on `public` tenancy; seven public-tenancy contract operations are audited (`recordConsent`, `resolveSharedQuote`, `getPublicTracking`, `lookupPublicTracking` and the three webhooks). With no transaction the audit hook has no database handle (O4). Fix: `defineRoute` refuses `transaction: 'none'` unless `audit.action === 'NONE'`.

### PR32-SEC-06 (LOW): SEC-TC-29 verification gaps

- **(a) Helper predicate.** `requiresPrivateNoStore` is `x-permission !== 'public'`, so the helper never checks the six authenticated `public`-marker operations of PR32-SEC-02, among them `refreshSession` (its body carries the access token) and `getCsrfToken`. The app itself decides by `route.auth` and is right today (probe C). Fix: one predicate for helper, stubs and app: the operation's effective `security` has no `{}` alternative (`contractAuth(op) !== 'anonymous'`), plus a seeded-defect case for `refreshSession`.
- **(b) Overrides.** `send()` applies handler headers after the authn slot, so a handler `Cache-Control: public, max-age=…` wins (code review P2); the problem handler infers "authenticated" from the current header text. Fix (TASK-052, `send` is outside `platform/authn`): re-assert `private, no-store` after the result headers when `route.auth !== 'anonymous'`, and let the problem handler read the descriptor from `res.locals`.

SEC-TC-29 itself is carried (7 unit + 1 api case, titles carry the ID); qa-lead can move it back to `required_cases` in the next activation PR as D-ORCH-039 planned, with (a) fixed first.

### PR32-SEC-07 (LOW): `system-model-owner` residuals

The mechanism holds at run time (P4) and the rule reports the direct form (S1). Residuals (P2):
- **(a)** A template-literal `import(\`…/platform/db/system-db.js\`)` (S2) and a computed `import(where)` (S3) are not reported, although the rule header lists dynamic import as `untracked`; `sourceMatches` accepts a string `Literal` only, and no other rule bans a non-literal `import()` in application code. `createRequire(…)(…)` is not covered either. Fix: treat a no-substitution template as a literal, and report any `ImportExpression` or `require`/`createRequire` call whose source is not a string literal in `apps/*/src`, `packages/*/src`.
- **(b)** `platform/db/**` is outside the rule, so a file there can re-export the accessor (S4a) and a module repository can then use any SYSTEM model through it (S4b). Fix: lint `platform/db/**` with this rule and exempt only `tenant-db.ts` and `system-db.ts`; PR #33 adds `/apps/api/src/platform/` to CODEOWNERS.
- **(c)** `$queryRaw`/`$executeRaw` stay on `TenantDb`, and a module repository may name a SYSTEM table in raw SQL (S5; P4 reached the raw member). SYSTEM tables have no RLS. Fix: TASK-024's raw-SQL manifest gains a table-to-owner check from the same table-class manifests.

### PR32-SEC-08 (INFO): logging routings

PR20-SEC-13 item 4 is delivered: `no-raw-request-in-log` and `no-catch-message-interpolation` with fixtures (controls L1, L3 reported). Not carried by this PR (they were raised after the TASK-020 sheet was folded):
- PR20-SEC-20: a non-test file importing a test-category file (`apps/api/src/platform/http/l4b.ts` importing `../routing/tests/fixture-route.js`) gives no finding (L4b). Owner: the boundaries policy (TASK-022 with the bundle scan).
- PR20-SEC-21: a template-literal event argument built from request data gives no finding (L2). Owner: TASK-113 (literal-event rule plus the optional runtime guard).
- PR20-SEC-22: covered for stringifiers applied to raw request names inside the call; aliases, values stringified before the call, `util.inspect(new URL(…))` and `query: {…}` stay with TASK-113.
- T-83 lexical limits: `const g = fetch; g()` and `(0, fetch)()` inside `withTenantTx` are silent in both T-83 and `outbound-http-via-client` (T4, T5). Accepted as the sheet's "lexical" scope; a Semgrep twin may follow.

### PR32-SEC-09 (INFO): single-valued route authentication

`contractAuth` maps `{} | bearerAuth` (`createQuote`) to `anonymous`, so the authn slot never reads a present bearer token, and `bearerAuth | quoteToken` (`getQuote`, `streamQuoteResults`) to `quote-token`; `x-permission-authenticated` is in neither `RouteSpec` nor the parity test. README §8 requires that a present bearer token be valid and its permission checked. Owner: principal-architect ruling, applied by TASK-052/TASK-091 before the first dual-mode route: `auth` becomes a set with an "optional" flag, `permissionAuthenticated` joins the metadata and the parity test, and a present but invalid bearer fails closed (401) rather than falling back to the guest branch. The code review's m7 one-line refusal (`auth: 'anonymous'` with a non-`public` permission) is endorsed.

### PR32-SEC-10 (INFO): webhook principal and raw body

The context builder refuses SYSTEM on every request (correct, PR26-SEC-04), while the contract says the webhook effects are "actor SYSTEM". Keep the refusal: a signature route stores the verified event through `systemDelegates` (owner: the payments webhook module for `gateway_webhook_events`; the anonymous stamp of the request) and the processing runs in the worker under a SYSTEM job context from `platform.job_context` (TASK-047). `jsonBodyParser` runs app-wide before authn: the verifier needs the exact raw bytes (see §5 (ii)). Owners: the Stripe/mock gateway webhook task, the carrier push task, principal-architect.

### PR32-SEC-11 (INFO): ownership and boundary gaps

- The O3 control lives in `tests/generated/**` (route-metadata and drift suites), `apps/api/src/app.ts`, `apps/api/src/main.ts` (boot checks) and `tools/openapi/{drift,contract}.ts`; none is in CODEOWNERS, so a later PR can weaken it without a security record. PR #33 adds `/apps/api/src/platform/` only. `tools/db/table-classes/` (input of `system-model-owner` and of the RLS catalogue) is unowned too. Owner: devops, TASK-015 015-C.
- PR30-SEC-08 (e) (D-ARCH-097 (6)), the `no-restricted-imports` entry for `@aws-sdk/*`, `@smithy/signature-v4` and `aws-sdk` outside `platform/storage/**`, is on the sheet and not delivered. I endorse the code review's M1 fix (pattern, file-scoped exception, negative fixture, positive control).
- Code review m5 (a non-capturing or character-class RegExp mount in `app.ts` hides paths from the walker) is a composition-root edit; endorsed fix: `no-restricted-syntax` on RegExp path arguments in `apps/api/src/**`.

## 5. D-TASK020-03 ruling: a `signature` route may declare `public`

**Confirmed, subject to C2.**

1. **Does it weaken PR8-SEC-05 (c)?** No. The property (c) protects is kept verbatim: a signature-only permission is satisfied by `auth: signature` only, never by `public`, a session or a guest token (rule `SIGNATURE_AUTH`, negative test, C7 control). My R1 sketch wrote `⇔`, which over-specified the reverse direction: the contract's own `receiveCarrierPush` is `x-permission: public` with `security: carrierSignature`, so `⇔` would reject a contract operation. The PR's reverse arm (a signature route declares a signature-only permission or `public`, never `authenticated` or a session permission) is stricter than the sheet, and the parity test pins `auth: signature` from the contract's security scheme, so the route cannot quietly become `anonymous`.
2. **What it changes.** With `public`, the authz slot grants unconditionally, so on `receiveCarrierPush` the signature verifier in the authn slot is the only gate, where a signature-only permission keeps a second, independent check (C7). The same holds for the five other authenticated `public`-marker routes.
3. **Compensating controls.**
   - **(i) Now (C2, PR32-SEC-02):** `authorise` requires an authenticated principal on every route whose `auth` is not `anonymous`, `public` included; the signature authenticator sets an authenticated provider principal.
   - **(ii) In the webhook and carrier push tasks (the verifier itself):** it runs in the authn slot, before rate limit, validation and the handler; it is computed over the exact raw request bytes (a `verify` hook of the JSON parser keeps the raw buffer for `auth: signature` routes only, or those routes bypass the app-wide parser), "verified before the body is parsed into the domain" (README §8); constant-time comparison of equal-length digests; the scheme's timestamp tolerance (Stripe 300 s; the mock HMAC covers timestamp and body); the secret is chosen from the route descriptor, and for carrier push from `carrierCode` resolved against the configured adapters with push support, an unknown or disabled code answering before any body use; the Mock carrier and the mock gateway refused when `APP_ENV=production` (REQ-CARR-006; rule (d) is permission-keyed and cannot see a `public` carrier route); failure answers 400 `WEBHOOK_SIGNATURE_INVALID`, audited DENIED with the source IP and the security event, with `private, no-store`; replays de-duplicated by the provider event id. One negative test per item.
   - **(iii) Optional, long term:** a signature-only `webhook:carrier:receive` (api-designer change request) makes (c) two-way again (code review n5).

## 6. Routed items checked

| Item | Result |
|---|---|
| PR8-SEC-05 (a)-(d), TASK-020 merge condition | **Met.** (a) self-service only on `user`; (b) `operator-cross-tenant` ⇒ operator-only, `:any_org` ⇒ `operator-cross-tenant`; (c) as §5; (d) no `webhook:mock_gateway:receive` in production. One negative per rule in `packages/authz/src/routes.test.ts`, the real routes in dev and production in `route-metadata.test.ts`, boot twin in `main.ts` (exit 78). Closed |
| PR26-SEC-04 (TASK-020 half) | Reserved ids refused, authentication ⇔ actor, OPERATOR needs an actor (P5); `serverControlledFieldIssues` per body and per bulk item (B9); authz re-exports the shared `SYSTEM_ACTOR_ID`. **Closed for TASK-020**, except the nested-object part (moved to PR32-SEC-04). Owed by TASK-052: `actorId` only from the verified token `sub`, and `setPrincipal` called only from `platform/authn` (a lint or boundary entry); TASK-037 and TASK-047 halves unchanged |
| PR21-SEC-06 | Step-0 limiter and CORS preflight path-less before the body parser and `routes` (`app.ts:71-73`); assertion 11 order test; assertion 10 docs GET/HEAD only; assertion 2 permission equality. **Closed** for TASK-020 (limiter TASK-041, CORS TASK-048) |
| PR21-SEC-08 | `.invalid` host with "Unable to resolve $ref pointer" and not "Error downloading"; quoted-key `$ref` walk over the parsed YAML (`tools/openapi/contract.test.ts:89-109`); the PR reports the `DEREFERENCE_OPTIONS` mutant killed. **Closed** |
| PR21-SEC-09 | Anchored ignore `^(?:\.\./)+apps/api/src/(?!(?:.*/)?\.\.(?:/|$))` for `tests/api` and the same shape for `tests/generated`; third REPO_PROBES case with the traversal form. **Closed** (fixture run in the code review) |
| PR20-SEC-13 item 4; -20; -21; -22 | Item 4 **closed**; -20 and -21 not carried; -22 partly (PR32-SEC-08) |
| PR19-SEC-01 mechanism (D-ARCH-080) | Run-time exclusion, port on real handles only, `revoke()` closes the port (P4); lint direct form (S1); `SYSTEM_MODELS` proven equal to the manifests by `tools/lint/system-models.test.ts`. **Closed as a mechanism**; residuals PR32-SEC-07 |
| PR11-SEC-17 a/b, PR #11 R3-n2/n4 | `isSqlFragment` true for 8 fragment forms including the intermediate-prototype forge, false for 3 controls (P4); fluent accessors refused. **Closed** |
| PR11-SEC-09 at the tx slot | DbError gives status, catalogue code, `Retry-After` when retryable, generic text (pipeline tests); the slot takes the runner from `RuntimeServices.tenantTx` only, boundary fixture for `client.ts`. **Closed** |
| D-TASK020-05 `assertPipelineReady` deferral | **Accepted.** No tenant route is reachable without a runner: the execute slot answers 503 `SERVICE_UNAVAILABLE`, `main.ts` exits 78 before listening, `moduleRegistry` is empty and health is `transaction: 'none'`. Residuals: PR32-SEC-05 (a) and (b). The architect ruling on the generated-client location and the runner activation are due before the first `transaction: 'tenant'` route (TASK-026/TASK-040); the worker gets the same boot assertion with its first tenant job (TASK-047) |
| SEC-TC-29 (D-ORCH-039) | **Carried** (7 unit + 1 api); predicate gap PR32-SEC-06 (a) |
| New ESLint rules as controls | Real, not trivially bypassed in their stated scope: each reports its control form (T1, S1, L1, L3, U1) and the fixtures pass; once on `main`, the base-ref no-weakening step pins them. Scope gaps: PR32-SEC-01, -07, -08 |
| Lockfile and licences | `package-lock.json` byte-identical to the merge base; no dependency added or changed; `tsx` (teardown) is an existing dev dependency, spawned with `process.execPath` |
| D-ORCH-021 levers | No `.github/workflows/**` change: `RANGE_BASE`, `BASH_ENV`, `PATH`, `BASH_FUNC_*`, `defaults.run`, folded `run: >`, `$GITHUB_ENV`/`$GITHUB_PATH` untouched |
| New pre-gate execution points | None before lint. `tests/generated/tsconfig.json` project references and the api-lane `globalTeardown` (local lane B only, report-only, `process.execPath` + the repository's `tsx`) |
| Evidence `20261113T1202Z_532b4ae` | 7 files; count-only host-fragment scan **0** on every label (synthetic control counted every label); all added lines of the PR **0** |

## 7. Checks owed

- **Union with PR #20 (D-ORCH-044: #20 merges first; this PR carries the union).** Owned overlap: `eslint.config.mjs`, `tools/lint/negative-fixtures.test.ts`, `tools/tsconfig.json`; plus `app.ts`, `main.ts`, `problem-handler.ts`, `packages/shared/src/index.ts`, the contract helper. The union commit needs a merge-only security round. I will check: app order `requestContext` → `requestLogger` → `ipLimiter` → `corsPreflight` → `jsonBodyParser` → `routes` [`optionsResponder` → docs router with `routePrefix(DOCS_PATH)` as its first layer → health → `api` with `routePrefix(API_PREFIX)` first, then `mountRoutes`] → `routeFallback` → `problemHandler`; the problem handler keeps the `private` retention; `installProcessErrorHandlers` above `createRuntimeServices`; both boot checks in the `main.ts` try block with exit 78; `RESTRICTED_IMPORT_PATTERNS` keeps BCRYPT and SUPERTEST (and the S3 pattern of code review M1), every exception through `restrictedImportsExcept`, no rule `'off'`; `tools/tsconfig.json` a pure union; PR #20's `logging.api.test.ts` Supertest import allow-listed with a reason or moved to the helper; the lockfile equals PR #20's blob; this PR's rules clean over PR #20's files.
- **PR #33 (TASK-015 015-A)** overlaps owned `jest.config.ts`, `package.json`, `tools/lint/negative-fixtures.test.ts`: whichever of #32/#33 merges second needs a merge-only round.
- **This record binds `fa67aca` only.** The fix cycle and the union change owned paths, so round 2 (delta plus merge-only) names the new head.
- **TASK-040 (idempotency):** scope = organisation, or guest-token hash, or anonymous IP /64 HMAC, plus actor, method, route template and key; fingerprint per README §5; lookup before the re-auth proof on `payment_method.manage`; one-time-secret routes never stored (assertion 9); 5xx and 429 not stored; store through `systemDelegates` owned by `platform/idempotency`; body encrypted (AES-256-GCM, AAD per README §5). **TASK-096 (ETag):** precondition flag in the metadata (code review n6); strong `"<id>:<version>"`.
- **TASK-052:** PR26-SEC-04 sub binding; PR32-SEC-06 (b); C2's principal kinds; MFA stub replaced or C3 guard kept.
- **TASK-024:** PR32-SEC-07 (c).

## 8. Record simulation and secret hygiene

**Simulated `check-security-owned-paths --pr 32`** (main's `tools/ci` from `git archive c48910d`, scratch `git clone --shared`, scenario commits built with git plumbing on top of `fa67aca`, the clone checked out at each scenario because the checker reads records from the working tree; script `review/PR-32-sec/probes/record-sim.mjs`, session-scoped):

| Scenario | Exit | Status |
|---|---|---|
| B control: no record (head `fa67aca`, base = `main` tip) | 1 | missing ("no record named …PR-0032-*.md") |
| A this record committed on top of `fa67aca`, base = `main` tip | 0 | pass, satisfied by `fa67aca`; 66 owned paths |
| A2 same, base = merge base `c2ddfac` | 0 | pass |
| A3 control: same tree, `--pr 31` | 1 | missing |
| A4 control: the same text named `PR-0033-…`, `--pr 32` | 1 | missing |
| C control: owned `eslint.config.mjs` edited after the record | 1 | missing ("names fa67aca, but eslint.config.mjs changed") |
| C2 control: owned `packages/authz/src/routes.ts` edited after the record | 1 | missing |
| D unowned `apps/api/src/platform/authz/authorise.ts` edited after the record | 0 | pass (see note) |
| E docs-only evidence commit after the record | 0 | pass |
| F / F2 controls: last Verdict `FAIL` / `PENDING` | 1 / 1 | missing (verdict not accepted) |
| F3 positive: last Verdict `PASS_WITH_FOLLOW-UPS` | 0 | pass |
| G control: Head row names the `main` tip | 1 | missing ("names no commit of this PR") |
| G2 positive: Head row abbreviated to 7 hex | 0 | pass |
| H merge of `origin/main` (10 docs and `.claude` paths) after the record | 0 | pass |

Note on D: on today's CODEOWNERS the slot folders are not owned, so C2's one-line fix in `authorise.ts` alone would not void this record, while C1 (`tools/eslint-rules/`, fixtures) does. Round 2 reviews every commit after `fa67aca` anyway; PR #33 makes `apps/api/src/platform/` owned.

**Secret hygiene.** Gitleaks v8.30.1 default-ruleset emulation (222 rules compiled; run-time positive controls fired 1, 2 and 1 times) over this record: **0 findings**. Count-only host-fragment scan of this record (user name, 8.3 stem, home and temp in both slash forms, host name, git e-mail, drive-letter profile prefixes): **0** on every label, synthetic control positive on every label. No value is quoted anywhere in this record. Lane A's real Gitleaks passed on `fa67aca`.

## 9. Verdict

| Field | Value |
|---|---|
| Critical / High open | 0 / 0 |
| Medium | PR32-SEC-01 |
| Conditions | **C1** PR32-SEC-01: T-83 covers `defineRoute` handlers (inline, same-file named, audit hook) unless `transaction: 'none'`, with fixtures; architect ruling on a pre-transaction phase. **C2** PR32-SEC-02: `authorise` requires an authenticated principal on every non-anonymous route, `public` included (the D-TASK020-03 compensating control), with the C7 test. **C3** PR32-SEC-03: mount-time refusal in the audit, idempotency, rate-limit (`auth`, `email-send`) and MFA (OPERATOR) stubs. Due: this PR's fix cycle (preferred, all small and in owned files), at the latest before the first module route that needs each (C1: first `transaction: 'tenant'` module route; C2: first non-anonymous `public` route; C3: first module route) |
| Follow-ups | PR32-SEC-04 to -07 (LOW) and -08 to -11 (INFO) with the owners in §3; D-TASK020-03 confirmed (§5); D-TASK020-05 accepted (§6) |
| **Verdict** | **PASS_WITH_CONDITIONS.** No Critical or High finding; one MEDIUM with conditions C1-C3 due before the first module route that depends on them |
