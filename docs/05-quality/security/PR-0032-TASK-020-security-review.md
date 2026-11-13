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

## Round 2 (head 11530cc, delta + merge)

| Field | Value |
|---|---|
| Round | 2: delta of fix cycle 1 plus a merge-only check of the PR #20 and PR #33 unions (D-SEC-PR32-01 conditions C1-C3, implemented per D-ARCH-106 (7) and D-ARCH-107 (7), decisions D-TASK020-18..27) |
| Head | 11530cc9b86d1964bd445bf04375319e92aaa184 |
| Range | `fa67aca..11530cc`. Own commits: `4d21114` fix(lint), `e1d588e` fix(api), `49eb01a` prettier, `64afb5b` CODEOWNERS. Merges of `main`: `4789de8` (PR #20 union), `c29e492` (docs only), `531a244` (PR #33 union), `11530cc` (docs only). Merge base with `main` is now `f2f34a7`; `main` was `e8829ef` when this round was written, and its delta since `f2f34a7` is docs and `.claude/agent-memory` only |
| Owned paths | 144 in the PR's net change against `main` (simulated checker, R2.7; `apps/api/src/platform/**` is owned since PR #33). 71 of them changed after `fa67aca`: 26 under `apps/api/src/platform/`, 28 lint fixtures, 6 files in `tools/eslint-rules/`, 3 in `packages/authz/`, 2 in `tools/lint/`, `eslint.config.mjs`, `jest.config.ts` and `package.json` (PR #33 side of the merge), `tools/tsconfig.json`, `tests/contract-stubs/tsconfig.json` (adds the cache-control helper to its file list) and `.github/CODEOWNERS`. The round-1 record therefore no longer binds the head |
| Lane A evidence | Run [43457137317](https://github.com/sukhchdit/shipcube/actions/runs/43457137317) on `11530cc`: `fast-lane` failed at "Lane B evidence (quality:check-evidence)" as expected (no lane-B run on an ancestor; Docker hung, D-ORCH-049), so lint, typecheck, unit, negative fixtures and build were **skipped** in CI. `scans`: Gitleaks and Semgrep green; only the security-owned record step failed. This round is that record |
| Reviewer / date | security-analyst, 2026-11-13, round 2. Read-only. Git ran in the main checkout against SHAs (`git fetch`, `git show`, `git archive`, `git merge-tree`, `gh`); no command of any kind ran in the PR worktree `Shipqube-TASK-020`. Probes ran on `git archive` extracts of `11530cc`, `fa67aca` and `main` (type-stripped TypeScript under a resolve/load hook; for Jest, a `node_modules` of junctions to the main checkout's packages with `@platform/*` pointing at the extract). The record simulation ran in a scratch `git clone --shared`. All scratch removed afterwards; the main checkout's `node_modules` is unchanged (740 entries). No Docker, no install, no build. The shared scratchpad was wiped once mid-round; the results below were taken before it |

### R2.1 Summary

The three conditions are met and the MEDIUM is closed.
- **C1 (PR32-SEC-01, T-83):** the rule now treats `defineRoute` handlers (inline, function expression, method shorthand, same-file named, spread or non-literal `transaction`), `fixtureRoute` with `tenant`, the `txFiles` (audit hook, outbox writer, audit store) and any function taking a `TenantDb`/`AppDb`/`AppTransactionClient` parameter as tenant-transaction roots; the four controls stay silent; the disable ratchet holds. The round-1 config, run as the positive control, misses every one of the new forms.
- **C2 (PR32-SEC-02):** the credential gate runs before the permission gate for every permission, `public` included. A leaky authenticator now reaches no `signature`, `refresh-cookie`, guest-token or `session` route (401), and dual-mode routes behave as D-ARCH-107 (6) says.
- **C3 (PR32-SEC-03):** each stub refuses at mount what it cannot honour and names the owning task; `createApp` throws, `main.ts` exits 78 with `api.slot_not_implemented`.
- **LOWs 05, 06, 07 are closed; 04 is closed for every round-1 form,** but a different spelling of the same class (schema-level `allowUnknown`, `Joi.link`, an extension type) still opens a body schema: new LOW PR32-SEC-13 (= code review R2-m1).
- **INFO 09 is closed** by the set form of D-ARCH-107; 11 is partly closed.
- **Both unions are faithful.** Every merge tree equals `git merge-tree` except five conflicts plus five declared hand edits in `4789de8`. The lockfile, workflows, `tools/ci`, `tools/quality` and scanner configs are byte-identical to `main`, and every PR #20 and PR #33 control I listed in §7 is intact.
- **D-TASK020-21 is confirmed** (R2.4): it fails closed and matches D-ARCH-107 (5). The refresh-cookie half needs an architect reconciliation with ADR-0006 before TASK-052/055 (PR32-SEC-16 = code review R2-m4).

**New: 2 LOW (PR32-SEC-12, -13), 3 INFO (-14 to -16). Nothing Critical, High or Medium open. Verdict: PASS_WITH_FOLLOW-UPS** (R2.9).

### R2.2 Method

| Area | How |
|---|---|
| Delta and unions | `git diff fa67aca 11530cc` (182 non-docs files). Read in full: the T-83 rule, `static-module-specifier.mjs`, the `module-sources.mjs` and `system-model-owner.mjs` diffs, the `eslint.config.mjs` diff, the disable ratchet, `authn/authenticate.ts`, `authz/authorise.ts`, `routing/{define-route,pipeline,route-state,slot}.ts`, the four stubs, `tx/execute.ts`, `validate/validate.ts`, `errors/problem-handler.ts`, `app.ts`, both `main.ts`, `packages/authz/src/routes.ts`, `packages/shared/src/http/credentials.ts`, `tests/api/helpers/cache-control.ts`. For every merge commit: `git merge-tree --write-tree <p1> <p2>` against the commit's tree |
| Lint probes | `ESLint#lintText` with the real `eslint.config.mjs` of `11530cc`, and of `fa67aca` as the positive control (`disableTypeChecked`, no project service), over in-memory files at the paths the rules scope to: 17 T-83 root forms, 6 silent controls, 9 residual shapes and a static-import positive control; 12 import-control forms for PR32-SEC-07 plus 3 evasion shapes; the S3-SDK and RegExp-path entries (code review M1, m5) |
| Composed app | The head's real `createApp` on a loopback listener (type-stripped sources): real slots, a leaky authenticator (`next()` without a principal) and an injected-principal seam, across 11 routes covering every accepted auth set; four credential forms (bearer, either refresh cookie, X-Quote-Token) on 6 routes; problem responses before a route matched; mount refusals for each stub; branding, boot checks, transport freezing; 17 Joi schema forms through `defineRoute` and end to end; 9 `presentsCredential` cases |
| SEC-TC-29 helper | `requiresPrivateNoStore` and `cacheRequirement` of `tests/api/helpers/cache-control.ts` over the 133 operations of the head's `openapi.yaml`, compared with the round-1 predicate |
| Scratch Jest on the extract | 11 security suites (authz routes, authenticate, authorise, pipeline-guards, define-route, pipeline, validate, credentials, route-metadata, contract-drift, cache-control): **247/247 pass**; `tools/lint/negative-fixtures.test.ts` **241/241**. Five source mutants (credential gate behind the `public` shortcut, authn ignoring a presented credential, audit stub accepting audited routes, nested schema walk removed, rate-limit stub accepting `auth`): **5/5 killed** (9, 4, 1, 8 and 2 failing tests). T-83 disable scan with the suppression checker's own lexer over the 209 source files of `apps/*/src` and `packages/*/src`: 0 disables, 0 inline configurations (three seeded controls detected). Not reproduced: full lint, typecheck, build, api and integration lanes |
| Hygiene | Gitleaks v8.30.1 default-ruleset emulation (222 rules, run-time positive controls fired) over the 3,285 lines added by the own commits and the `4789de8` hand edits: 0. Count-only host-fragment scan of the same lines (user name, 8.3 stem, home and temp in both slash forms, host name, git e-mail, profile prefixes): 0 on every label, synthetic control positive |
| Cross-check | Code review round 2 (`docs/05-quality/reviews/PR-0032-TASK-020-code-review.md`, on `main` in `e8829ef`, APPROVED_WITH_NITS): its R2-m1, R2-m3, R2-m4 and R2-n1 are the same items as my PR32-SEC-13, -12, -16 and part of -15; owners below follow it |

### R2.3 Conditions and round-1 findings: closure

| ID | Status | Evidence on `11530cc` |
|---|---|---|
| **C1 = PR32-SEC-01** (MEDIUM) | **Closed** | `queue.add` plus a `setTimeout` sleep is reported twice in an inline arrow, a function expression, a `handler() {}` shorthand, a same-file function declaration (declared after the call), a same-file `const` arrow, a `{ handler }` shorthand, a spread literal, `transaction: 'none'` followed by a spread, a non-literal and a template-literal `transaction`, and `fixtureRoute({ transaction: 'tenant' })`; `fetch` plus a sleep in `apps/api/src/platform/audit/` (R5); `fetch` in `create(db: AppDb)` and `queue.add` in methods taking `TenantDb`, `Db.TenantDb` and `TenantDb<X>` (R6); a static `undici` import used in a handler. Silent controls: `transaction: 'none'` (also `as const`), `outbox.publish(ctx.db, …)` in a handler, the `fixtureRoute` default, `ctx: CarrierContext`, `db: DatabaseRuntime`. The `fa67aca` config reports none of the new forms (positive control). Ratchet: `tenant-tx-disable-ratchet.test.ts` refuses named and blanket disables; inline `/* eslint … */` configuration is refused repo-wide by `check-suppressions` (`inline-config`). The `transaction: 'none'` operation pin exists, but its composition line in `checkRouteMetadata` is not pinned by a test (code review R2-m2, endorsed: one seeded case). The `defineRoute` refusal of `transaction: 'none'` with an audited action is in place (05 (d)). Residual lexical shapes: PR32-SEC-12. The pre-transaction phases are D-ARCH-106 (4), part 020-C |
| **C2 = PR32-SEC-02** (LOW) | **Closed** | `authorise.ts:26` checks `route.auth.includes(principal.credential)` before the `public` branch (`:30`). Real authn stub, no credential: `[signature]`, `[refresh-cookie]`, `[session, quote-token]`, `[session]` (catalogued and `authenticated`) and a signature-only route answer 401 `private, no-store`; `[anonymous]` and `[anonymous, session]` 200. Leaky authenticator: all six non-anonymous routes 401; `[anonymous, session]` serves the anonymous branch (200). Injected principals: dual mode `session` without `quote:create` 403, with it 200, both `private, no-store`; a guest on `[session, quote-token]` 200 private; a guest on `[anonymous, session]` 401; a `signature` principal on `public` + `[signature]` 200; a `session` principal on `[signature]` and a `signature` principal on `[refresh-cookie]` 401; an unknown credential kind is ANONYMOUS (401). Module-load refusals: unsafe `refresh-cookie` route without `csrf` (`CSRF_COOKIE`), `anonymous` with a catalogued permission (`PERMISSION_AUTH`, code review m7), an unlisted set and a repeated kind (`AUTH_SET`). The D-TASK020-03 ruling of §5 stands unchanged: (c) is still one-way strict, and the compensating control (i) is now in place. Mutant killed (credential gate behind the `public` shortcut: 9 failing tests) |
| **C3 = PR32-SEC-03** (LOW) | **Closed** | Mount-time `SlotNotImplementedError` with `bootFailureOf` event `api.slot_not_implemented`: audit `CREATE` (TASK-029; the stub refuses every action other than `NONE`), idempotency `required` and `optional` (TASK-040), rate-limit `auth` and `email-send` (TASK-041). Every other class mounts. MFA stub: an OPERATOR principal on a non-exempt route gets 403 `AUTHZ_DENIED` (D-TASK020-18, accepted: the code is the platform's, the contract code arrives with the MFA task). That 403 is `private, no-store` whenever the request carries a credential, which a real OPERATOR request always does. With a test-only principal and no credential header it is `no-store` (probe artefact, no finding). An audit hook injected through the `pipeline` test seam mounts an audited route by design; `main.ts` never passes `pipeline`. Mutants killed (audit and rate-limit stubs) |
| PR32-SEC-04 (LOW) | **Closed for the round-1 forms; residual PR32-SEC-13** | Refused at any depth: `Joi.object()` (top and nested), `.unknown(true)`, `.pattern(…)`, `Joi.array()` without items and with open items, `Joi.any()` without `valid`, an open object four levels down, open `alternatives`, `when` and `conditional … switch` branches, `object().keys()` without argument. Server-controlled fields are refused in a nested object (`/body/address/org_id`) and in array items (`/body/items/0/id`) even when the schema declares them. Mutant killed (nested walk removed: 8 failing tests). Still accepted, with an extra `role` reaching the handler: schema-level `prefs`/`options({ allowUnknown: true })` (top level and nested), `Joi.link('#id')` to a `.shared()` open object, and a `Joi.extend` type based on an open object (PR32-SEC-13) |
| PR32-SEC-05 (LOW) | **Closed** | (a) A spread copy `{ ...route, transaction: 'none' }`, `Object.create(route)` and a `Proxy` around a defined descriptor are refused with `UndefinedRouteError` before anything is mounted (`DEFINED` `WeakSet`, `define-route.ts:370`); the descriptor, its `schema` and its `auth` set are frozen. (b) `createApp` refuses a tenant route without a runner (`PipelineNotReadyError`) and the mock gateway webhook in `apiMode: 'live'` (`RouteBindingError`, also with a replaced pipeline), while `test` and `sandbox` mount it. (c) The handler context is `route, input, principal, correlationId, transport, db`; no `req` or `res`; `transport` is frozen `{ ip, userAgent }`. (d) As C1. Residual hardening: PR32-SEC-15 |
| PR32-SEC-06 (LOW) | **Closed** | (a) The helper predicate now reads the effective `security`: 103 of 133 operations require `private, no-store` (95 `[session]`, 3 `[refresh-cookie]`, 3 `[signature]`, 2 `[session, quote-token]`), which adds exactly the six operations of round 1 (`refreshSession`, `logoutSession`, `getCsrfToken`, `getQuote`, `streamQuoteResults`, `receiveCarrierPush`) to the round-1 predicate's 97 and drops none; `createQuote` (`{}` or bearer) requires it only when a credential is presented. (b) A handler's `Cache-Control: public, max-age=600` on an authenticated route is replaced by `private, no-store` after the handler headers; a throw after the mark gives a private 500. Problems raised before a route is known (`MALFORMED_REQUEST`, the 404 fallback) are `no-store`, and `private, no-store` with any of a bearer, either refresh cookie or `X-Quote-Token` (D-TASK020-26). `presentsCredential` (`packages/shared/src/http/credentials.ts`) is the single predicate for app, helper and stubs: 9/9 cases, including multi-valued cookie headers and a case-variant cookie name that is not a credential |
| PR32-SEC-07 (LOW) | **Closed (a), (b); (c) TASK-024** | `system-model-owner` reports a template-literal `import()` of the accessor, a literal `createRequire(…)('…/system-db.js')`, and a named or `export *` re-export from any `platform/db` file other than `system-db.ts`/`tenant-db.ts`. The new `static-module-specifier` reports a computed `import()`, a template with substitutions, `require(x)`, `module.require(x)`, `createRequire(url)(x)`, a `createRequire` alias variable and `mod.createRequire(url)(x)`; a literal `import()` stays silent. The `fa67aca` config reports none (positive control). `new Function` loaders are caught by `@typescript-eslint/no-implied-eval` (error in the effective config). Residual deliberate-evasion shapes: PR32-SEC-12 |
| PR32-SEC-08 (INFO) | Open, routed | Unchanged: TASK-022 / TASK-113 (D-TASK020-18..27 routed list) |
| PR32-SEC-09 (INFO) | **Closed** | D-ARCH-107: `auth` is a closed set read one to one from `security`, `permissionAuthenticated` is in the metadata and in parity (`route-metadata.test.ts` passes on the head contract: 29/95/3/3/1/2) |
| PR32-SEC-10 (INFO) | Open, routed | Webhook and carrier-push tasks (§5 (ii)); see also PR32-SEC-14 |
| PR32-SEC-11 (INFO) | **Partly closed** | Closed: `apps/api/src/platform/**` owned (PR #33), `tests/api/helpers/coverage-teardown.ts` owned (`64afb5b`), `tools/db/**` owned, the S3-SDK lint boundary (code review M1: a module service and a package refused, the storage seam allowed, bcrypt still refused inside it) and RegExp mounts (lint for literal, `new RegExp`, `RegExp()` and array forms; the drift walker refuses any non-string matcher, D-TASK020-22). Open (015-C): `tests/generated/**`, `apps/api/src/app.ts`, `apps/api/src/main.ts`, `tools/openapi/**` |

### R2.4 D-TASK020-21: a credential on an anonymous-capable route

**Confirmed for the stub.** The stub gives the anonymous principal only when the set contains `anonymous` and the request presents no `Authorization`, refresh cookie or `X-Quote-Token`, otherwise 401 `private, no-store` (`authenticate.ts:23`). This is the stub clause of D-ARCH-107 (5) word for word.

- **Security effect.** It fails closed. It cannot grant anything, and it removes the silent-downgrade path that README §8 forbids: a present bearer must never be dropped in favour of the anonymous branch. A present but unverifiable credential gets 401 rather than anonymous service. That costs only availability, and only before any session exists.
- **Should a valid session on `createQuote` be accepted?** Yes, but by the real authenticator (TASK-052), not by this stub. Under D-ARCH-107 (5)/(6):
  - a valid bearer on `[anonymous, session]` yields the `session` principal, which must hold `quote:create` (403 without it, probed above);
  - an invalid or expired bearer answers 401 and never falls back to anonymous.

  The stub cannot verify a bearer, so 401 is the correct placeholder. The refusal lives only in `platform/authn`, which TASK-052 replaces, so the stub does not constrain the real design.
- **What is not yet consistent:** the refresh cookie (PR32-SEC-16).

### R2.5 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner and due |
|---|---|---|---|---|---|---|
| PR32-SEC-12 | Lexical residuals of the new lint controls: T-83 roots that are not literals or same-file functions, and two import-control evasions | LOW | CWE-400 | A04 | `tools/eslint-rules/no-external-calls-in-tenant-tx.mjs` `collectRouteHandler` (`:364-378`), `isNamedDependencyCall` (`:400-409`), `takesTxHandle` (`:302-316`); `tools/eslint-rules/module-sources.mjs` `isCreateRequire` | Part 020-C (it reopens the rule for R4 and ships the runtime twin; due before batch 1.3, D-ARCH-108); the two import items with it or TASK-040 |
| PR32-SEC-13 | Closed-schema walk ignores schema-level preferences and indirection: `prefs`/`options({ allowUnknown: true })`, `Joi.link` to a shared schema, `Joi.extend` types | LOW | CWE-915 | A08 | `routing/define-route.ts` `openSchemaProblems` (`:258-274`); `validate/validate.ts:152` | senior-developer, this PR if the fix cycle reopens it, at the latest before the first route with a request body (as 04); TASK-100 parity facets |
| PR32-SEC-14 | A signature-only catalogued permission can never be satisfied: the permission gate requires a user actor, while D-ARCH-107 (4) defines the provider principal as `authenticated: false` | INFO | CWE-285 | A01 | `authz/authorise.ts:36-43` | TASK-171 / TASK-261 (webhook authenticators) with principal-architect |
| PR32-SEC-15 | Mutable shared state behind frozen objects: `ANONYMOUS.permissions` and the descriptor's nested `audit`, `reauth`, `deprecated` | INFO | CWE-471 | A04 | `routing/route-state.ts:18-26`; `routing/define-route.ts:381` | TASK-052 / TASK-060 (principal); senior-developer (descriptor, code review R2-n1) |
| PR32-SEC-16 | Refresh-cookie presence counts as a credential on every route: D-ARCH-107 (5) and ADR-0006 R-06 must be reconciled before the real authenticators | INFO | CWE-287 | A07 | `packages/shared/src/http/credentials.ts:33-36`; `authn/authenticate.ts:23` | principal-architect (ADR-0008 am. 4 / ADR-0006 wording); TASK-052, TASK-055, TASK-027 matrix row |

#### PR32-SEC-12 (LOW): lexical residuals of the new lint controls

**Evidence (lint probes on the head config).** The following give 0 T-83 findings:
- **(a)** `const spec = { handler: async () => { … } }; defineRoute(spec)`. The first argument must be an object literal (`:369`).
- **(b)** A wrapped handler `handler: timed(async () => …)`, and a module helper `tenantRoute(id, handler)` that calls `defineRoute({ …, handler })` (code review R2-m3 (b)).
- **(c)** An aliased factory `import { defineRoute as route }`.
- **(d)** Receivers other than `deps.<name>` and `this.<name>`, such as `ctx.deps.queue.add()` and `services.queue.add()`, and an alias `const q = deps.queue; q.add()`.
- **(e)** A class whose constructor takes `private readonly db: TenantDb` and whose methods do the I/O. R6 marks the constructor only.
- **(f)** Waits other than `setTimeout`: `scheduler.wait()` from `node:timers/promises`, and a synchronous `Atomics.wait()`.
- **(g)** A literal dynamic `await import('undici')`.
- **(h)** A handler imported from another file, whose own file has no root. This is accepted by D-ARCH-106 (5) and reached through R6 at the service.

Import controls:
- **(i)** `import { createRequire as mk } from 'node:module'` followed by `mk(url)(name)` is not seen by `static-module-specifier`.
- **(j)** A direct `eval('import(x)')`: the core `no-eval` is not enabled. `new Function` is caught.

**Impact.** Each shape moves the external call out of the rule's sight. (a), (b) and (e) are ordinary refactors that a module with many routes will make, after which T-83 protects nothing in that module (code review R2-m3). The guard rail until 020-C is procedural: D-ARCH-106 (9) allows no tenant route with external I/O, and the runtime twin (an idle-in-transaction timeout of 1,000 ms in the API lanes) arrives with 020-C. (i) and (j) are deliberate evasions in reviewed code. Likelihood is low, impact as T-83: **LOW**.

**Remediation (020-C).**
1. Fail closed on what cannot be resolved:
   - report a `defineRoute(` / `fixtureRoute(` whose first argument is not an object literal, unless it resolves to a same-file `const` object literal (then walk it);
   - report a `handler` value that is neither a function, a same-file function name nor a member expression, with the message "declare route handlers inline or as same-file const functions".
2. Match `names` on any member chain ending `.<name>.<method>()`.
3. Treat the methods of a class whose constructor has a `txHandleTypes` parameter property as roots.
4. Add `scheduler.wait` and `Atomics.wait` to the sleeps.
5. Treat a literal `import()` of an `EXTERNAL_MODULES` entry inside a root as external.
6. Resolve `createRequire` through import aliases in `module-sources.mjs`, and enable `no-eval` for `apps/*/src` and `packages/*/src`.

Add one negative fixture per form. Once on `main`, the base-ref no-weakening step pins them.

#### PR32-SEC-13 (LOW): schema-level preferences and indirection reopen a closed schema

**Evidence (composed app).** `defineRoute` accepts each of these, and an extra `role` reaches the handler's `ctx.input.body`:
- `Joi.object({ name }).prefs({ allowUnknown: true })` at the top level;
- `Joi.object({ a: Joi.object({ x }).options({ allowUnknown: true }) })` nested;
- `Joi.object({ a: Joi.link('#open') }).shared(Joi.object().id('open'))`;
- a `Joi.extend({ type: 'loose', base: Joi.object().unknown(true) })` type.

The cause: a schema's own preferences override the options `validateRequest` passes (`validate.ts:152`, `abortEarly` and `convert` only), `link` nodes are not followed, and node types outside Joi's built-ins are not inspected. `prefs({ stripUnknown: true })` is accepted too, but it drops the field, so it is harmless. `serverControlledIssues` still refuses `org_id`, `id`, `created_by` and similar at any depth, so the residual is business fields (roles, statuses, amounts).

**Impact.** Mass assignment of non-server fields (REQ-SEC-007). This is the same class and rating as 04, and `.options({ allowUnknown: true })` is a common Joi idiom. **LOW.**

**Remediation.**
1. In `openSchemaProblems`, refuse any node whose `preferences.allowUnknown === true`.
2. Either refuse `type: 'link'`, or resolve the link against `describe().shared` and walk the target.
3. Refuse node types outside Joi's built-in list (`validate.ts` `JOI_TYPES`) unless they are explicitly allowed.
4. As defence in depth, the validate slot can pass `allowUnknown: false` explicitly. A schema's own preferences still win, so the walker remains the control.

Add one negative test per form (code review R2-m1). **Note for the orchestrator:** `define-route.ts` is under `/apps/api/src/platform/` (owned), so an in-PR fix voids this record and needs a small delta round. A fix in TASK-100 does not.

#### PR32-SEC-14 (INFO): signature-only permissions cannot pass the permission gate

`authorise` requires `principal.authenticated` for every catalogued permission (`:36`). D-ARCH-107 (4) defines the signature principal as a provider with `authenticated: false` and no actor. A `signature` principal holding `webhook:stripe:receive` on a `[signature]` route therefore gets 401 (probe). This fails closed, and no webhook route exists yet. The webhook tasks will meet it first.

**Owner note.** Fix the gate, never the principal. For a signature-only permission, require credential `signature` and the permission held, with no actor. Do not set `authenticated: true` or invent an actor for providers: that would break `tenantContextOf`'s authenticated-means-actor rule (PR26-SEC-04) and attribute webhook writes to a fake user. Add a matrix row (TASK-027): a signature principal with the permission gets 200, and without it 403.

#### PR32-SEC-15 (INFO): mutable shared state behind frozen objects

- **`ANONYMOUS.permissions`** is a `Set` inside `Object.freeze`. A handler calling `ctx.principal.permissions.add(…)` changed the process-wide anonymous principal (probe: the added key was visible after the request; pre-existing since round 1). No grant follows today, because `authorise` needs an authenticated principal for catalogued permissions and checks `permissionAuthenticated` only for `session` principals. TASK-060 must not read `principal.permissions` without that guard. Fix: a read-only permission view per principal (a frozen wrapper exposing `has` only, or a fresh `Set` per request) in TASK-052/060.
- **`defineRoute`'s `Object.freeze` is shallow.** `audit`, `reauth` and `deprecated` stay mutable, so `route.audit.action = 'NONE'` after `defineRoute` keeps the brand and lets the audit stub mount a route declared `CREATE` (code review R2-n1). The parity test sees a mutation made at module load, and the types make it a cast-only path. Fix: copy and freeze the nested objects (`audit.additional` included).

#### PR32-SEC-16 (INFO): refresh-cookie presence vs ADR-0006 R-06

`presentsCredential` counts `__Host-rt_web`/`__Host-rt_admin` as a credential on every route, and the stub answers 401 to an `[anonymous]` request that carries one (probe). The `__Host-` prefix requires `Path=/`, so once TASK-055 issues the cookie, every credentialed browser request to the API host carries it. ADR-0006 R-06 says the cookie is read only by the refresh and logout endpoints and is ignored elsewhere (quoted by code review R2-m4). If TASK-052/055 keep the stub's "present means refuse" rule for the cookie, login (`createSession`, `[anonymous]`), public tracking and `createQuote` answer 401 to any signed-in or stale browser. That is an availability defect, and it creates pressure to weaken the gate in a hurry.

**Owner note.**
- **principal-architect:** reconcile D-ARCH-107 (5) with ADR-0006 R-06. The cookie is a credential only on routes whose set contains `refresh-cookie`, and it is otherwise ignored for authentication but still makes the response `private, no-store`. Also state the rule for a present `Authorization` header on an `[anonymous]`-only route; D-ARCH-107 (5) defines it only for sets that contain `session`.
- **TASK-052/055:** apply the reconciled rule; it changes no security property of this PR.
- **TASK-027:** matrix row `[anonymous]` + refresh cookie gives 200 `private, no-store`.

### R2.6 Union checks (PR #20 merged first, PR #33 merged during the cycle)

| Check | Result |
|---|---|
| Merge integrity | `c29e492`, `531a244` and `11530cc` trees equal `git merge-tree --write-tree` of their parents (clean auto-merges, no hand edit). `4789de8` (PR #20 union) differs from the clean merge tree in 10 paths: 5 conflicts (`app.ts`, `main.ts`, `runtime-seams.api.test.ts`, `contract-validation.api.test.ts`, `tools/openapi/api-mounts.ts` modify/delete, kept deleted) and 5 declared hand edits (`serve.ts` `routePrefix(DOCS_PATH)` as the docs router's first layer, `pipeline.test.ts` and `tests/generated/api-mounts.ts` `debug`, `logging.api.test.ts`, and in `eslint.config.mjs` one `SUPERTEST_ALLOW_LIST` entry with its reason, D-TASK020-27). This matches the PR comment's §6 checklist and the code review |
| Configuration overlap files | `eslint.config.mjs` = clean merge + that allow-list entry + `4d21114` (read in full). `jest.config.ts`, `package.json`, `tools/tsconfig.json` and `.gitignore` = `main` plus exactly the round-1 lines (`globalTeardown`; `test:contract`; three `platform/db` files; two ignore lines). `.github/CODEOWNERS` = `main` plus one rule with its comment (`/tests/api/helpers/coverage-teardown.ts`, required by PR #33's `jest-config-owned` test; the teardown is unchanged since `fa67aca`). `tests/generated/tsconfig.json` is unchanged since round 1 |
| Byte-identical to `main` | `package-lock.json` (no dependency change; `npm audit` not re-run), `.github/workflows/**`, `tools/ci/**`, `tools/quality/**`, `tools/hooks/**`, `tools/deps/**`, `tools/isolated/**`, `.npmrc`, `.gitleaks.toml`, `.gitleaksignore`, `.semgrep/**`, `.semgrepignore`, `.prettierignore`, `.swcrc`, `tsconfig*.json` at the root, `.node-version`, `commitlint.config.mjs`. So PR #33's pins, ASCII-only `ci.yml` (PR33-SEC-01), coverage gate, oasdiff gate, Gitleaks baseline and `__mocks__` confinement (`modulePathIgnorePatterns` unchanged; no `__mocks__` path in the PR) are intact, and the D-ORCH-021 levers are untouched |
| PR #20 controls | The server-only logging policies are still the last three entries of `BOUNDARIES_POLICIES` (`eslint.config.mjs:515`, `:516`, `:520`; the array ends at `:521`). `routePrefix(API_PREFIX)` is the first layer of `api` (`app.ts:110`) and `routePrefix(DOCS_PATH)` the first of the docs router. App order as §7 required. `installProcessErrorHandlers` sits above `createRuntimeServices` (`apps/api/src/main.ts:28`/`:30`; the worker `main.ts` equals `main`'s). Boot refusals exit 78 through `bootFailureOf` with route identities only. PR #20's logging, correlation, context and runtime sources are byte-identical to `main`, except `logging.api.test.ts` (descriptor conversion; 61 `expect` and 13 cases on both sides, careless-code probes kept) and `services.ts` (round 1's `tenantTx` field). `no-raw-request-in-log` and `no-catch-message-interpolation` and their fixtures are unchanged since round 1; the 20 shared-logging fixtures equal `main`'s |
| Rule weakening | The set of rules configured `'off'` is identical on `main` and the head. `RESTRICTED_IMPORT_PATTERNS` is BCRYPT, SUPERTEST and the new S3 pattern; each exception goes through `restrictedImportsExcept`. There is one `no-restricted-syntax` block (`apps/api/src/**`), so no earlier block's options are replaced. The negative-fixtures suite passes on the extract |
| New pre-gate execution points | None in this round |

### R2.7 Record simulation and secret hygiene

**Simulated `check-security-owned-paths --pr 32`.** I used `main`'s `tools/ci` (`git archive e8829ef`) in a scratch `git clone --shared`. The scenario commits were built with git plumbing on top of `11530cc`, and the clone was checked out at each scenario, because the checker reads records from the working tree. The record is this file as it stands on `main` (round 1) with this section appended.

| Scenario | Exit | Status |
|---|---|---|
| S0 control: `11530cc` as pushed (round-1 record only), base `main` tip | 1 | missing ("names fa67aca, but … changed after it") |
| S1 this record committed on top of `11530cc`, base `main` tip | 0 | pass, satisfied by `11530cc`; 144 owned paths (the round-1 head row only adds a note) |
| S2 same, base = merge base `f2f34a7` | 0 | pass |
| S3 control: `--pr 31` | 1 | missing |
| S4 control: the same text named `PR-0033-…` | 1 | missing |
| S5 control: owned `eslint.config.mjs` edited after the record | 1 | missing |
| S6 control: owned `apps/api/src/platform/routing/define-route.ts` edited after the record (a PR32-SEC-13 fix) | 1 | missing |
| S7 control: owned `tests/api/helpers/coverage-teardown.ts` edited after the record | 1 | missing |
| S8 unowned `tests/generated/route-metadata.ts` edited after the record (a code review R2-m2 fix) | 0 | pass (lane B then needs a new run) |
| S9 docs-only lane-B evidence commit after the record | 0 | pass |
| S10 merge of the docs-only `main` tip after the record | 0 | pass |
| S11 control: merge of a `main` that changed owned `eslint.config.mjs` | 1 | missing |
| S12 / S13 controls: this round's last Verdict `FAIL` / `PENDING` | 1 / 1 | missing |
| S14 control: this round's head row names the `main` tip | 1 | missing |
| S15 positive: head row abbreviated to 7 hex | 0 | pass |

**Secret hygiene.** Gitleaks default-ruleset emulation over this section: 0 findings (run-time positive controls fired). Count-only host-fragment scan of this section: 0 on every label (synthetic control positive). No value is quoted. Lane A's real Gitleaks passed on `11530cc`.

### R2.8 Checks owed

- **Before merge (procedural; not a security condition):**
  - the lane-B evidence commit, docs-only (S9 keeps this record);
  - a lane A run on the final head in which lint, typecheck, unit, base-ref negative fixtures and build actually execute and pass (all skipped on `11530cc`);
  - no non-docs commit and no main merge touching an owned path after this record (S5-S8, S11).

  If the fix cycle reopens for code review R2-m1 (= PR32-SEC-13), the `define-route.ts` change needs a delta round (S6). R2-m2 alone does not void the record (S8).
- **Part 020-C:** PR32-SEC-12, the R4 line, the runtime twin. Its own record is required (D-ARCH-108).
- **TASK-052/055/060/091/171/261:** PR32-SEC-14, -15, -16 plus the round-1 owner list (§7). TASK-027: matrix rows for PR32-SEC-14 and -16.
- **qa-lead:** SEC-TC-29 can return to `required_cases` in the next activation PR; its predicate is fixed (PR32-SEC-06 (a)).

### R2.9 Verdict

| Field | Value |
|---|---|
| Critical / High / Medium open | 0 / 0 / 0 |
| Closed this round | PR32-SEC-01 (C1), -02 (C2), -03 (C3), -05, -06, -07 (a)(b), -09; -04 for the round-1 forms; -11 in part |
| Open, routed | LOW PR32-SEC-12 (020-C), -13 (before the first route with a request body), -07 (c) (TASK-024); INFO -08, -10, -11 (rest), -14, -15, -16 with the owners in R2.5 and R2.3 |
| Decisions | D-TASK020-21 confirmed (R2.4); D-TASK020-03 stands with control (i) in place; D-TASK020-18, -19, -20, -22..-27 accepted |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** Conditions C1-C3 met and the MEDIUM closed; no Critical, High or Medium finding open; merge still needs lane-B evidence and a lane A run that executes its gates on the final head |
