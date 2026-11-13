# PR #32 code review: TASK-020 mandatory route metadata, build-time route test and request-pipeline skeleton (round 1)

| Field | Value |
|---|---|
| PR | #32 `feat/TASK-020-mandatory-route-metadata-build-time` |
| Head reviewed | `fa67aca8325bf653599d281c3f7baa3668e9b58e` (evidence commit on top of `532b4ae`) |
| Base | `origin/main` `d4d7359` (merge-base `c2ddfac`; main delta since then is docs/.claude only) |
| Story | US-067 DC; REQ-RBAC-005; NFR-AUDIT-004, NFR-MAINT-004 |
| Reviewer | code-reviewer, 2026-11-13 |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A careful, well-tested skeleton. defineRoute refuses bad metadata at load time; mountRoutes is the only mount
  path; the slot order is pinned; the tx slot sends after COMMIT; authn fails closed with private, no-store; the
  route-metadata test covers §15 1-6 and 9-11; the authz, SYSTEM-port and lint work is solid.
  ONE MAJOR, cheap to fix: the TASK-020 sheet line "ESLint boundary for the S3 SDK" (D-ARCH-097 (6), PR30-SEC-08 (e))
  is on main, merged into this branch, and not delivered. Eight MINORs, most of them cheap in-PR hardening; R3-m1
  is only partly closed. Round 2 is a delta check. PR #20 merges first (D-ORCH-044), so this PR carries the union.
```

## 1. Verification I performed

The review worktree stayed read-only. The probes ran on a `git archive fa67aca` extract with a `node_modules` junction to the worktree, plus a `git archive` of the PR #20 × PR #32 `merge-tree` result. Both were removed afterwards. The worktree is still clean at `fa67aca` with 748 entries in `node_modules`. No Docker, no installs, all runs serial.

| Check | Result |
|---|---|
| Targeted unit (19 suites): `tests/generated/{route-metadata,contract-drift}`, `platform/{routing,validate,tx,db,errors,http}`, `packages/authz/src/{routes,roles}` | **505/505 pass** |
| `tools/lint/{negative-fixtures,system-models,tenant-context-forms-drift}` | 236 pass, 3 fail. The 3 failures are known archive-copy false failures: two `@platform` resolver-path probes and the `@platform/source` resolver assertion, because the junction resolves into the worktree. Every new rule fixture passes. |
| Lane A run 43425130109 on `fa67aca` | fast-lane **success** (includes the lane-B evidence step). `scans` fails only on "Security-owned paths need a review record", which is expected. |
| Lane-B evidence `20261113T1202Z_532b4ae` | PASS: unit 3287, api 82, integration 252, catalog 74. Its coverage-summary gives **total 96.67 % lines / 96.29 % branches**. `packages/authz` routes.ts and guard.ts are 100/100. tx/execute is 100/100. routing/pipeline.ts is 100/84, define-route 99.3/93.0, validate 100/96.3. The PR body says coverage was "not re-run after the merges", but the evidence file on the head carries it (n7). |
| Main unions (6 merge commits) | Each merge equals `git merge-tree P1 P2` outside its conflicted files. Hand resolutions (`git show --cc`) keep both sides: shared index exports, PR #24/#30 `readinessChecks(db, audit, valkey, objectStorage)`, `isCriticalComponent`. There is no DECISIONS.md or `.claude` delta against `c2ddfac`. Main after the last merge is docs-only (D-ORCH-043/044), so no overlap. |
| SEC-TC-29 (D-ORCH-039) | **Carried.** 6 unit cases in `tests/api/helpers/cache-control.test.ts`, 1 in `pipeline.test.ts`, and 1 api case in `contract-validation.api.test.ts`. Every title carries `[SEC-TC-29]`. Gaps are in m1. |
| Probes (tsx over the real `createApp`) | P1 forged descriptor; P2 authenticated 200 cache header; P3 fail-open audit/idempotency; P4 problem cache headers. See m1 to m3. |
| Lint probes (real `eslint.config.mjs`) | T-83 on a `defineRoute` handler versus an inline `withTenantTx` callback (m4). PR #32's new rules run over PR #20's 66 changed files on the union tree (§6). |
| Drift probe | RegExp mount shapes against the R3-m1 fix (m5). |
| Gates not re-run by me | Full lint, format, typecheck, build, full unit/api, integration and coverage. For these I rely on the lane A run above, the lane-B evidence at 532b4ae and the developer's gate table. |

## 2. Findings

| ID | Severity | Where | Problem | Why it matters | Required fix |
|---|---|---|---|---|---|
| **M1** | **MAJOR** | `eslint.config.mjs` (no entry); PR body "Not in this PR" | The sheet line **"ESLINT BOUNDARY FOR THE S3 SDK (PR30-SEC-08 (e), PR #30 R1-m7; D-ARCH-097)"** is on the TASK-020 sheet. It has been on main since `b85fdca` (SHEET-FOLD-4), which this branch merged. It asks for a `no-restricted-imports` entry that denies `@aws-sdk/*`, `@smithy/signature-v4` and `aws-sdk` outside `apps/api/src/platform/storage/**`, with a negative fixture. The config has no such entry. The PR body calls it "not taken (optional routing)", but D-ARCH-097 (6) assigns it to TASK-020 as an acceptance line. | It is an unmet acceptance line on an owned path. PR #30's `boundary.test` stays the only control (PR #30 R1-m7). This PR is the lint-lock holder, and the line was added so a later PR would not have to reopen the lock. | Add `S3_SDK_IMPORT_PATTERN` (`^(?:@aws-sdk/.*|@smithy/signature-v4(?:/.*)?|aws-sdk(?:/.*)?)$`) to `RESTRICTED_IMPORT_PATTERNS`. Add a `restrictedImportsExcept(S3_SDK_IMPORT_PATTERN)` block for `apps/api/src/platform/storage/**`. Add a negative fixture (a module service importing `@aws-sdk/client-s3`) and a positive control in `platform/storage`. `git grep` shows every current importer is already inside `platform/storage`, so nothing else changes. |
| m1 | MINOR | `tx/execute.ts:55-61`; `errors/problem-handler.ts:73-74`; `tests/api/helpers/contract-validator.ts:224`; `tests/contract-stubs/stubs.ts:117` | **SEC-TC-29 can be undone, and the helper and the app disagree on what "authenticated" means.** (a) `send()` applies `result.headers` after the authn slot. Probe P2 (authenticated principal, handler returns `Cache-Control: public, max-age=3600`) gave 200 with `public, max-age=3600`. (b) The problem handler decides "authenticated" by checking whether the current header contains `private`. A handler that sets `no-cache` and then throws loses `private`. Errors raised before the route slots, such as a malformed JSON body on an authenticated route (P4b), get `no-store` only, and the helper would fail them. (c) The helper requires private/no-store when `x-permission !== 'public'`. The app uses `auth !== 'anonymous'`. `getQuote` and `streamQuoteResults` are `public` plus `bearerAuth \| quoteToken`: guest-token-authenticated responses carrying the quote. The app marks them private; the helper would accept them without it. | Today this is latent, because no authenticated route can succeed while authn is the stub. TASK-052 replaces only `platform/authn/`, and `send()` is not in that folder. | `execute` re-asserts `private, no-store` after the result headers when `route.auth !== 'anonymous'`, or refuses a handler `Cache-Control` on such routes. The problem handler reads the route descriptor from `res.locals` instead of the header text. Use one predicate for the helper and the stubs: the operation's effective `security` has no `{}` alternative (equivalently `contractAuth !== 'anonymous'`). Decide and document whether pre-route framework errors on an authenticated path must carry `private` (I recommend that the helper accepts `no-store` on framework 4xx). |
| m2 | MINOR | `routing/pipeline.ts:115-122` | **"Descriptor-only mounting" holds by convention only.** `mountRoutes` accepts any object of type `RouteDescriptor`. Probe P1: `{ ...fixtureRoute(...), tenancy: 'tenant', transaction: 'none', audit: undefined, schema: { query: Joi.object().unknown(true) } }` mounts and answers **200** to `/thing?anything=1`. The route-metadata test catches the fields the contract can see. It does not catch `transaction` or `handler`, and for a missing audit it crashes (TypeError in `auditProblems`) instead of reporting a finding. The tests do this spread themselves: `pipeline.test.ts:124,143` and the route-metadata AT cases. | D-TASK020-01 and the PR body promise that no incomplete route can be mounted. A spread silently drops the transaction or audit invariants. | `defineRoute` adds every frozen descriptor it returns to a module-private `WeakSet`. `mountRoutes` throws for any descriptor not in it. Convert the spreading tests to `fixtureRoute`/`defineRoute`. |
| m3 | MINOR | `audit/capture.ts`, `idempotency/idempotency.ts` (also `etag`, `rate-limit`) | **The stubs fail open, unlike authn.** Probe P3: a `public`, anonymous, `audit: CREATE`, `idempotency: 'required'` route with a runner answers **201** (`begin,commit`). No audit entry is written and no `Idempotency-Key` is asked for. | Today only batch order (TASK-029 in 0.8, TASK-040 in 1.2) keeps the O4 "100 % audit completeness" and duplicate-label guardrails safe. Module routes that land early, such as public reference reads or guest flows, would ship unaudited or unprotected. | Each stub receives the descriptor at mount time, so it can refuse at boot what it cannot honour. The audit stub throws for `action !== 'NONE'`. The idempotency stub throws for `required`/`optional`. Name the owning task in the error. When TASK-029/040 replace the folder, the guard goes away by construction. |
| m4 | MINOR | `tools/eslint-rules/no-external-calls-in-tenant-tx.mjs:162-175` | **T-83 never sees route handlers.** Lint probe on `apps/api/src/modules/zzprobe/routes.ts`: `fetch(...)` plus a `setTimeout` sleep inside a `defineRoute({ handler: async () => … })` gave **0** T-83 findings. The same `fetch` in an inline `runner.withTenantTx({}, async () => …)` gave 1. The only `withTenantTx` call in apps is `tx/execute.ts:73`, which passes `inTransaction` by reference. | The sheet's reason for putting T-83 in TASK-020 is that "wave-1 modules are the first possible violators". Their handler bodies run inside the tenant transaction, yet the rule as built protects no current or planned call site. | Also treat the function-valued `handler` property of a `defineRoute({...})` object literal as a tenant-tx callback, unless the literal has `transaction: 'none'`. Add a fixture of each kind. Named handlers in other files remain a review/Semgrep item, as the sheet says. |
| m5 | MINOR | `tools/openapi/drift.ts:173-175`; `tools/openapi/README.md:20-22` | **R3-m1 is only partly closed.** The `capturedParams` check rejects capturing groups only. Probe: `/^\/api\/(?:v1|v2)/`, `/^\/api\/v[12]/` and `/^\/api\/v1|^\/hidden/` each resolve to `["GET /api/v1/things"]`, while the app serves `/api/v2/things` (200) or `/hidden/things` (200). The README now claims RegExp mounts with alternation are caught. | This is the fail-open walker class from PR #21. The route-metadata test inherits the blind spot. | Implement the sheet's "and/or" lint half. Add `no-restricted-syntax` on RegExp literal and `new RegExp(...)` path arguments to `.use/.get/.post/.put/.patch/.delete/.all/.route` in `apps/api/src/**`, with a fixture. Correct the README sentence. |
| m6 | MINOR | `tests/generated/route-metadata.ts` | Two README §15 sub-rules are missing. Assertion 2 says "No `x-permission-status: proposed` remains on main" (no check anywhere). Assertion 4 says `x-reauth-max-age` appears only with `x-reauth-scope`, and a reauth route references `ReauthProof`/`ReauthProofConditional` and lists `REAUTH_REQUIRED` (not implemented; 11 operations carry max-age today). | The brief asks for assertions 1-6 and 9-11. Both checks are contract-wide and cost about as much as `errorCodeProblems` and `oneTimeSecretProblems`. | Add `permissionStatusProblems(op)` and `reauthProblems(op)` over all operations, with one seeded defect each. |
| m7 | MINOR (route) | `tests/generated/route-metadata.ts:63-72`; `RouteAuth` (`packages/authz/src/routes.ts:24`) | `RouteAuth` holds one value, but the contract has alternatives. `contractAuth` turns `{} \| bearerAuth` (`createQuote`) into `anonymous`, and `bearerAuth \| quoteToken` (`getQuote`, `streamQuoteResults`) into `quote-token`. So parity cannot detect a route that drops an alternative, and TASK-052/091 cannot declare "optional session" or "session or quote token". Separately, `defineRoute` and the binding rules accept `auth: 'anonymous'` with a non-`public` permission: a route that can never succeed, and whose 401 lacks `private`. | This design decision belongs before the first session or guest route, not after. | Architect ruling, folded into TASK-052/TASK-091: `auth` becomes a set plus an optional flag, and parity compares sets. Here, refuse `auth: 'anonymous'` with a permission other than `public` (cheap; one test). |
| m8 | MINOR | `routing/define-route.ts:193-204`; `validate/validate.ts:110-120` | The closed-schema check covers the top level only. A nested `Joi.object().unknown(true)` or `.pattern(...)` is accepted (by inspection). `serverControlledIssues` checks the body top level and one array level only. Nested parity is deferred to TASK-100, so a nested open object would accept `org_id` and similar fields. | REQ-SEC-007 ("unknown fields rejected") and PR26-SEC-04 both rely on closed schemas at every depth. | Walk `describe()` recursively in `defineRoute` and refuse `flags.unknown === true`, `patterns` and `Joi.any()` object values. Add one test per form. |
| n1 | NIT | `main.ts:41` | `RouteBindingError` is logged as `api.pipeline_not_ready`, with only the error name. | | Give it its own event and log the `rule` plus the route template of each violation (templates are not PII). |
| n2 | NIT | `db/tenant-db.ts` `guardResult` | Reading any other string key throws, including `toJSON`, `$$typeof` and `asymmetricMatch`. `JSON.stringify(pending)`, Jest's pretty-format and a careless log field therefore throw `TenantDbAccessError`. | | Keep the refusal for fluent accessors. Return `undefined` for those well-known probe keys. |
| n3 | NIT | `tx/execute.ts:42-53` | The "authenticated ⇔ actor" invariant means a quote-token guest principal must be `authenticated: false`, otherwise the request fails with 500. An authenticated TENANT principal with `orgId: ''` is not refused. | | Document this for TASK-091, or refuse an authenticated TENANT principal without an org. |
| n4 | NIT | `routing/define-route.ts:90-91` | `ctx.req.res` lets a handler write the response inside the transaction, before COMMIT. That defeats "send after COMMIT". | | Pass a narrowed view (ip, headers) instead of `req`, or document and lint it. |
| n5 | NIT | D-TASK020-03 / `receiveCarrierPush` | The `public` marker on a signature route carries no provider identity. | | The carrier webhook authenticator must choose the verifier from `carrierCode` and fail closed on an unknown code. Long term, a signature-only `webhook:carrier:receive` lets rule (c) become two-way. |
| n6 | NIT | `etag/etag.ts` | Route metadata has no If-Match/precondition flag, and `if-match` is excluded as a pipeline header. TASK-096's slot will have nothing to key on. | | TASK-096 (or TASK-036) adds the flag from the contract's `If-Match` parameter. |
| n7 | NIT | PR body gate table | The coverage row says "not re-run after the merges", but `20261113T1202Z_532b4ae/coverage-summary.json` (96.67/96.29) is on the head. | | Correct the row. |

## 3. Focus items (brief)

- **Descriptor-only mounting and load-time refusal.** `createApp` takes descriptors only; raw routers are gone; `defineRoute` names every problem in one error; AT-US-067-02 shows both the throw and the raw-handler finding `GET /api/v1/example`. The remaining gap is the brand (m2).
- **Slot order and semantics.** The order is pinned by `pipeline.test.ts` and by the route-metadata assertion 11 over the real `/health/live` stack.
  - authn fails closed with 401 and `private, no-store` (verified, P4a).
  - mfa is a pass-through; this is acceptable because no operator principal can exist yet.
  - authz returns 401 then 403 `AUTHZ_DENIED`.
  - validate uses value-free messages (sentinel test; `SAFE_MESSAGES` pinned) and reports server-controlled fields per body and per bulk item.
  - The tx slot runs handler plus audit in one `withTenantTx` and sends after COMMIT (event-order test; audit failure means no 2xx).
  - A `DbError` becomes problem+json with no reason, SQLSTATE or Prisma code (`[PR11-SEC-09]`).
  - Gaps: m1, m3, m8.
- **Step-0 limiter and CORS.** Both are path-less `ipLimiter` and `corsPreflight` layers ahead of `routes` (slash true; the order is asserted). The walker was not widened. Matches D-ORCH-024 (5).
- **Drift residuals.** R3-n1 (leading parameter) and R3-n2 (`isSubApp`) are closed. R3-m1 is closed for capturing groups only (m5). R2-n1/PR21-SEC-09 anchored ignores are closed for `tests/api` and `tests/generated`.
- **Route-metadata coverage.** §15 assertions 1, 3, 5 (top level), 6 (contract half), 9, 10 and 11 are covered, as are AT-US-067-01..04 and PR8-SEC-05 (a)-(d) (one boot refusal per rule, plus the real routes in dev and production). Assertions 2 and 4 are missing sub-rules (m6). `routeErrors` goes to TASK-036; nested parity goes to TASK-100.
- **ESLint rules.**
  - T-83: source list, sleeps and names are as on the sheet; one fixture per source; gap m4.
  - catch-message and raw-request-in-log: fixtures pass; `tools/**` is excluded for catch-message (D-TASK020-08, accepted).
  - system-model-owner: manifest-driven, fail-closed on unreadable manifests, re-export, port and dynamic forms reported; `system-models.test.ts` proves list equals manifests.
  - Supertest ban: exact-file allow-list with reasons.
  - Anchored ignore: correct.
  - On the PR #20 union tree, PR #32's rules give exactly one new finding on PR #20 files (§6 e).
- **SYSTEM port and PR11-SEC-17.** Type-level and run-time exclusion; `systemDelegates` refuses non-handles (WeakMap); SYSTEM guards close with the handle; the worker twin fails closed until TASK-047. `isSqlFragment` is now `in`-based and walks the whole prototype chain (bounded at 32, fail-closed).
- **Reserved-actor context builder.** Refuses SYSTEM, ANONYMOUS, actorless authenticated principals and actorless OPERATOR (5 cases). See n3.
- **authz.** Re-exports the shared `SYSTEM_ACTOR_ID` (PR #26 n8 closed). `SUB_RESOURCES`/`WEBHOOK_PROVIDERS` closed set: PR #8 R2-m1 closed. `AUDITOR_NON_READ_PERMISSIONS`: R2-n1 closed. Grants unchanged.

## 4. Deviation rulings

| Decision | Ruling |
|---|---|
| D-TASK020-01, -02, -04, -06, -07, -09 to -17 | Accepted. |
| **D-TASK020-03** (a signature route may declare `public`) | **Sound.** The sheet's rule (c) has one direction only: a signatureOnly permission implies `auth: signature`. The PR adds a reverse arm (a signature route declares a signatureOnly permission or `public`, never `authenticated` or a session permission). That makes it stricter than the sheet, not weaker. `public` on `receiveCarrierPush` is the contract's own value, and the route-metadata parity pins `auth: signature` from `carrierSignature`. Security-analyst confirmation is still requested (D-ORCH-043 (3)). See n5. |
| **D-TASK020-05** (runner activation deferred; `assertPipelineReady`) | **Acceptable as an interim**, because it fails closed: a deployed process mounting any `transaction: 'tenant'` route without a runner exits with 78, and `createApp` returns 503 meanwhile (tested). Conditions: the principal-architect ruling on the generated-client location (dispatched, `c84277d`) lands before the first tenant route (TASK-026/TASK-040). The worker gets the same boot assertion when it takes its first tenant job (TASK-047). PR #11 R3-m1 (iii) stays open with those owners. |
| D-TASK020-08 (catch-message rule not on `tools/**`) | Accepted. It writes to CLI stderr, not the application log. |
| "PR #30 R1-m7 storage entry not taken (optional routing)" | **Rejected.** It is a sheet acceptance line (D-ARCH-097 (6)). See M1. |

## 5. Follow-up closure

- **Closed and verified in this PR:**
  - PR #8 R2-m1 and R2-n1
  - PR #11 R3-n1, n2, n4 and n6 (fixtures and tests pass)
  - PR #21 R1-m5 (a) supertest ban and (b) coverage report (report only)
  - PR #21 R2-n1, R3-n1 and R3-n2
  - PR21-SEC-06 assertions 2, 10 and 11; PR21-SEC-08
  - D-TASK017-01 (6)
  - PR #20 n6 route template (contextSlot + OPTIONS template)
  - PR #26 n8; the PR26-SEC-04 call sites
  - PR #26 m1 (scopeClient pin: unchanged here)
- **Partly closed:** R3-m1 (m5); PR #11 R3-m1 (iii) (D-TASK020-05).
- **Still open, owned elsewhere:** PR20-SEC-16 (not applicable while PR #20 is open); `routePrefix(DOCS_PATH)` (union step, §6).

## 6. Union with PR #20 (merges first, D-ORCH-044): pre-assessment for this PR as second merger

`git merge-tree 3f585b7 fa67aca` (tree `a53eed0`) has **5 conflicts**: `apps/api/src/app.ts`, `apps/api/src/main.ts`, `apps/api/src/platform/openapi/runtime-seams.api.test.ts`, `tests/api/contract-validation.api.test.ts`, and the modify/delete `tools/openapi/api-mounts.ts`. Several cleanly auto-merged files then fail typecheck or lint. The union commit must:

- **a. `app.ts`.**
  - `requestContextMiddleware`, then PR #20's `requestLogger(logger)`, then the rest of PR #32's order.
  - Logger: `createRuntimeLog('api', process.stdout, { context: requestLogContext })`; `AppLogger` gains `debug`; drop the now-unused `ErrorLogFields` import if it is unused.
  - **`api.use(routePrefix(API_PREFIX))` as the first layer of `api`, then `mountRoutes(api, …)`**, then `routes.use(API_PREFIX, api)`.
  - The docs router gets `routePrefix(DOCS_PATH)` as its first layer. It must not be path-mounted outside the router (drift).
  - Assertion 11's name checks (`ipLimiter`, `corsPreflight`, `router`, `optionsResponder` first in `routes`) must stay green.
- **b. `main.ts`.**
  - From PR #20: the `log` with version, level and context; `exit = exitAfterFlush(...)`; `installProcessErrorHandlers` **above** `createRuntimeServices` (PR30-SEC-11); `logger: log` into `createApp`.
  - From PR #32: `healthRoutes`, and `assertPipelineReady` plus `assertRouteBindings` in the try block.
  - The boot-check failure keeps the bare `process.exit(CONFIG_EXIT_CODE)`, as PR #20 does for `docs_unavailable` (control flow needs `never`). Give the binding error its own event (n1).
- **c. `tools/openapi/api-mounts.ts`.** Delete it, as PR #32 does. Port PR #20's one change: `silentLogger` gains `debug` in **`tests/generated/api-mounts.ts:26`** (clean auto-merge, but a type error).
- **d. `apps/api/src/platform/routing/pipeline.test.ts:31` `silent`.** Add `debug` (clean auto-merge, type error). Apply the same to every other `{ info, error }` logger handed to `createApp` (`serve.api.test.ts:45`, the two conflicted test files).
- **e. `apps/api/src/platform/logging/logging.api.test.ts` (PR #20 file, auto-merged).**
  - It still calls `createApp({ healthRouter, modules: [{ router }] })`, which is a type error under PR #32. Convert its harness to `fixtureRoute` descriptors. The careless handlers become `({ req }) => { logger.info(...JSON.stringify(req.rawHeaders)...); return { status: 200, body: { ok: true } }; }` and the throwing route becomes a throwing handler.
  - Its direct `import request from 'supertest'` (line 11) is the **one** finding PR #32's rules give on PR #20's 66 changed files (verified on the union tree). Add it to `SUPERTEST_ALLOW_LIST` with a reason (logging sink below the contract helper), or move it to the helper.
- **f. `contract-validation.api.test.ts` / `runtime-seams.api.test.ts`.** Hand-merge: PR #32's descriptor fixtures plus PR #20's `debug` and any access-line assertions.
- **g. Behaviour checks.** PR #20's access log reads the same `res.locals.routeTemplate` key that PR #32's context slot sets, so health lines stay at `debug` (template `/health/…`). The problem handler auto-merges with PR #32's `private` logic intact.
- **h. Re-run.** Run typecheck, lint, unit (incl. `tests/generated`), api and `test:contract` on the union commit. The union touches `eslint.config.mjs` and test files, so a merge-only security round applies, and fresh lane-B evidence is needed after the union (D-ORCH-034).

## 7. Merge conditions

1. **M1 fixed** in a fix cycle. Round 2 is a delta check (expected APPROVED_WITH_NITS if M1 lands with its fixture).
2. MINORs:
   - In this PR (cheap; all in files this PR owns): m1 (a)/(b)/(c), m2, m3, m4, m5, m6, and the m7 one-line refusal.
   - Otherwise routed with sheet lines: m1 → TASK-052; m3 → TASK-029/040; m4 → TASK-026; m5 → TASK-048; m6 → TASK-036; m7 → architect + TASK-052/091; m8 → TASK-100.
3. A security record naming the final head. `scans` is red until then. D-TASK020-03 must be confirmed explicitly in that record.
4. The §6 union steps on the union commit (PR #20 first), followed by a merge-only security round and lane-B evidence on an ancestor of the final head.
5. Squash merge with the linted PR title.
6. Next activation PR: qa-lead moves SEC-TC-29 from `required_cases_pending` back to `required_cases` (the IDs are carried in 7 unit and 1 api test).

## GOOD

- Every slot is in its own folder behind a `RouteSlot` contract, so later tasks replace one folder.
- `routeHandlers` names each layer `route:<step>`, which makes the order assertable on the real stack.
- The registry is keyed by the final handler in a `WeakMap`, so each `createApp` keeps its own entries.
- Validation messages are value-free in two layers: the fixed body text, and `SAFE_MESSAGES` built from Joi's own type definitions, pinned by a test.
- The SYSTEM port is a handle-keyed `WeakMap` with run-time and type-level exclusion. The worker twin fails closed until bound.
- `DB_PROBLEM_CODES … satisfies readonly ErrorCode[]` makes a catalogue change a compile error.
- Merge hygiene is good: six main merges with clean hand resolutions, and the decisions are kept in the PR body per D-ORCH-040.

## SECURITY-FLAGS (for security-analyst)

- Confirm D-TASK020-03 (signature route + `public`) and n5.
- m1: SEC-TC-29 override and the helper criterion. `getQuote`/`streamQuoteResults` are guest-token-authenticated but `public`.
- m3: fail-open audit and idempotency stubs (O4 guardrail).
- m2: forged descriptor bypasses `transaction` and audit invariants.
- m5: RegExp mount evasion of the walker.
- m8: nested open Joi objects and server-controlled fields.
- M1: S3 SDK boundary.
- n4: `ctx.req.res` lets a handler write before COMMIT.
