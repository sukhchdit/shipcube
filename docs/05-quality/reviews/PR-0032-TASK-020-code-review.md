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

## Round 2 (head 11530cc)

| Field | Value |
|---|---|
| Head reviewed | `11530cc9b86d1964bd445bf04375319e92aaa184` |
| Delta since r1 | `fa67aca..11530cc`: union `4789de8` (PR #20), `4d21114` fix(lint), `e1d588e` fix(api), docs merge `c29e492`, `49eb01a` prettier, union `531a244` (PR #33), `64afb5b` CODEOWNERS, docs merge `11530cc` |
| Base | `origin/main` `bb070e2` (merge-base `f2f34a7`; the main delta since then is docs only, and `git merge-tree origin/main 11530cc` is clean) |
| Reviewer | code-reviewer, 2026-11-13 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: M1 and m1-m8 are closed as D-ARCH-106 (7) and D-ARCH-107 (7) prescribe, and 22 of 26 mutants are killed
  (3 survive, 1 is equivalent). Both unions match `git merge-tree` outside the declared files. There are 0 BLOCKER and 0 MAJOR
  findings. 4 new MINORs: two are cheap in-PR fixes (an open-schema form, untested wiring lines), two are routed
  (T-83 non-literal roots, refresh-cookie presence vs ADR-0006). Merge waits on lane-B evidence and on a lane A run
  that executes its steps; on 11530cc every lane A step after the evidence check was SKIPPED.
```

### R2.1 Verification I performed

The review worktree stayed read-only. All probes ran on a `git archive 11530cc` extract with a `node_modules` junction to the worktree. I added `@platform/{api,authz,shared}` overrides for the mutation runs and copied the git-ignored `prisma/generated` for tsc. Everything was removed afterwards. The worktree is clean at `11530cc` with 748 `node_modules` entries, and its `dist/` timestamps are unchanged. No Docker, no installs.

| Check | Result |
|---|---|
| Unions vs `git merge-tree` | `4789de8`: 10 files differ from the clean merge tree. These are the 5 conflicted files (`app.ts`, `main.ts`, `runtime-seams.api.test.ts`, `contract-validation.api.test.ts`, the modify/delete `tools/openapi/api-mounts.ts`) and 5 declared hand edits (`serve.ts` `routePrefix(DOCS_PATH)` inside `createDocsRouter`, `logging.api.test.ts`, `pipeline.test.ts` `debug`, `eslint.config.mjs` Supertest allow-list entry, `tests/generated/api-mounts.ts` `debug`). `531a244` (PR #33), `c29e492` and `11530cc` are byte-identical to `merge-tree`. Branch delta vs merge-base: `package-lock.json` and `docs/sdlc/DECISIONS.md` are unchanged. |
| r1 §6 a-h | a: order `requestContext -> requestLogger -> ipLimiter -> corsPreflight -> json -> routes[options, docs (routePrefix first), health, api (routePrefix first, mountRoutes)] -> fallback -> problem`. b: `main.ts` keeps PR #20's logger, `exitAfterFlush`, `installProcessErrorHandlers` above `createRuntimeServices` and `api.docs_unavailable`; the boot errors go through `bootFailureOf`. c, d, f: `debug` is on every logger. e: `logging.api.test.ts` uses descriptors and is on `SUPERTEST_ALLOW_LIST` with a reason. **All done.** |
| Targeted unit, in band | 50 suites / **959 pass**: `apps/api/src/platform/**`, `packages/authz`, `packages/shared/src/http`, `tests/generated`, `tools/openapi`, `tests/api/helpers`, `tests/contract-stubs`. Also `tools/lint/{negative-fixtures,system-models,tenant-context-forms-drift,tenant-tx-disable-ratchet}`: all pass except the 3 known archive-copy resolver false failures. The ratchet needs a git root, so it was re-run after `git init` in the copy (10/10). Parallel runs on the loaded host gave 5 s loopback timeouts, so I re-ran in band. |
| api project, in band | **101/101** (matches the PR body) |
| ESLint, real config, 92 changed source files | Clean apart from 4 `import-x/no-extraneous-dependencies` findings on `@platform/shared` in `tests/api/helpers` and `tests/contract-stubs`. These are copy artefacts: the symlink resolves outside the copy root. The same 3 files lint clean (exit 0) in the worktree, read-only. |
| `tsc -b` on shared, authz, api, tests/generated, tests/api, tests/contract-stubs, tools | exit 0 |
| Mutation (26) | Killed: credential gate; authn presence check; dual-mode permission gate; authorise private mark; `send` re-assert; problem-handler credential predicate (api project); brand check; the audit, idempotency and MFA stubs; nested schema walk; `none` with audit; `CSRF_COOKIE`; `PERMISSION_AUTH`; `AUTH_SET`; an extra `[quote-token]` set; `DUAL_MODE`; signature reverse arm; auth parity wiring; refresh-cookie presence; nested server-controlled walk. Disable ratchet: seeded `eslint-disable-next-line` and `eslint-disable-line` directives in `apps/api/src` and `packages/shared/src` are named. An inline `/* eslint rule: off */` is refused repo-wide by `suppression/inline-config`. **Survived:** `transactionProblems`, `permissionStatusProblems` and `reauthProblems` unwired from `checkRouteMetadata` (R2-m2). **Equivalent:** `principalOf` trusting an unknown credential (the credential gate still answers 401; the mutant is stricter on anonymous routes). |
| Lane A run 43457137317 on `11530cc` | fast-lane **failure** at "Lane B evidence". Lint, format, typecheck, unit, negative fixtures from the base ref and build were all **SKIPPED**. `scans` fails only on the security-owned review record (expected). CI has therefore not executed one gate on this head. |
| Not re-run by me | Full lint/format/unit, build, integration, coverage, gitleaks: Docker is hung (D-ORCH-049). For these I rely on the developer's gate table plus the scoped runs above. |

### R2.2 r1 findings: closure

| r1 | Status | Evidence |
|---|---|---|
| **M1** S3 SDK boundary | **Closed** | `S3_SDK_IMPORT_PATTERN` is in `RESTRICTED_IMPORT_PATTERNS`, and storage uses `restrictedImportsExcept` (no `'off'`). The fixtures pass. My lint probes flagged `@aws-sdk/lib-storage`, a type-only import, `export * from`, and an import in `apps/worker`. A literal `await import('@aws-sdk/client-s3')` is not seen by lint, but PR #30's `boundary.test` still covers it (R2-n2). |
| m1 SEC-TC-29 | **Closed** | (a) `send()` re-asserts on the private mark (mutant killed). (b) The problem handler reads `isPrivateResponse(res)` or `presentsCredential` (mutant killed in the api project). (c) The helper, stubs and app share one predicate from `@platform/shared` (D-TASK020-20). Pre-route problems need `no-store` only (D-TASK020-26), as I recommended. |
| m2 brand | **Closed** | P1: a spread descriptor throws `UndefinedRouteError`. The brand check is checked by mutation. Residual: R2-n1. |
| m3 stubs | **Closed** | P3: audit `CREATE`, idempotency `required` and rate-limit `auth` each throw `SlotNotImplementedError` naming TASK-029, TASK-040 and TASK-041. The other six rate-limit classes mount (pass-through, by design). The MFA stub refuses OPERATOR principals. |
| m4 T-83 | **Closed per D-ARCH-106 (7)** | R1, R2, R3, R5 and R6 are implemented. All 8 negative and 4 positive fixtures the ruling lists are present and pass; there is an extra `fixtureRoute` + `tenant` fixture. My probes confirmed that a `handler: async function named()` and a template-literal `` transaction: `none` `` (unknown, so treated as tenant) are both roots. Residual: R2-m3. |
| m5 RegExp mounts | **Closed** | The walker accepts only a string-path `match` matcher, so a renamed matcher fails closed. The lint covers literal, `new RegExp`, `RegExp()` and array forms. A RegExp held in a variable or spread passes lint, but the walker refuses it at run time (D-TASK020-22), so it is covered. The README is corrected. |
| m6 §15 sub-rules | **Closed (wiring untested)** | Both functions exist, have seeded defects and run on the whole contract. Removing their call lines from `checkRouteMetadata` leaves the test green (R2-m2). |
| m7 auth sets | **Closed** by D-ARCH-107 (see R2.4) | |
| m8 nested schemas | **Closed for the r1 forms** | Nested `unknown(true)`, `pattern`, arrays of open objects, `alternatives` and `when` branches are refused; the walk is checked by mutation. A new form escapes: R2-m1. |
| n1, n2, n3, n4, n7 | **Closed** | n4 via the frozen `ctx.transport`. n5 and n6 are routed (D-TASK020 routed list). |

### R2.3 D-ARCH-106 (T-83) conformance

- **Roots R1, R2, R3, R5 and R6.** All five are as ruled. `txFiles` and `txHandleTypes` are set explicitly in `eslint.config.mjs`. R6 is type-name based, and callback types are excluded.
- **Ratchets.**
  1. `TRANSACTION_NONE_OPERATIONS = {getLiveness, getReadiness}` is pinned. Its wiring into `checkRouteMetadata` is untested (R2-m2).
  2. The disable ratchet works and is checked by mutation.
  3. `defineRoute` refuses `transaction: 'none'` with an audited action (mutant killed).
- **Interim rule (9).** It holds: there is no `tenant` route with I/O in the tree.

### R2.4 D-ARCH-107 conformance, and D-TASK020-21 vs `createQuote`

- **Sets and kinds.** `ROUTE_AUTH_SETS` is exactly the six accepted sets, frozen and in canonical order. An extra `[quote-token]` set is caught by 3 tests.
- **Normalisation.** `findRouteAuthSet` is order-insensitive and refuses duplicates.
- **`permissionAuthenticated`** is required exactly on dual-mode routes and must be catalogued, neither self-service nor signature-only.
- **`Principal.credential`.** `principalOf` maps an unknown kind to ANONYMOUS.
- **Gate order.** The credential gate runs before the permission gate, `public` included.
- **Binding rules.** Each of the four rules has a negative test and a killed mutant; the signature reverse arm (D-TASK020-03) is kept.
- **Leaky-authn seam.** `public`+`signature`, `public`+`refresh-cookie`, `[session, quote-token]` and `[session]` all give 401. My probe confirmed the `[session, quote-token]` case, and an unknown credential also gives 401.
- **Parity.** Set equality holds, the counts are 29/95/3/3/1/2 over 133 operations, and five defects are seeded. CSRF parity runs through `x-csrf`.
- **D-TASK020-21 is sound and does not break `createQuote`.**
  - My probe on `[anonymous, session]` + `permissionAuthenticated` gave:
    - no credential: 201, the anonymous branch;
    - `Authorization`: 401, `private, no-store`;
    - refresh cookie only: 401.
  - That is the literal stub clause of D-ARCH-107 (5): "the anonymous principal when `anonymous` is in the set and no Authorization header, refresh cookie or X-Quote-Token is present, 401 with `private, no-store` otherwise".
  - A valid session cannot exist before TASK-052, and the stub cannot verify one.
  - Treating a present bearer as anonymous would silently drop the user's identity on the quote. That is the exact defect D-ARCH-107 (5) forbids for the real authenticator ("never replaced by another alternative").
  - The session branch is covered where it belongs: `authorise.test` checks `quote:create` (403 without it, 200 with it) and the guest-token branch. TASK-052 replaces only `platform/authn/`. The cookie half of the same rule needs a note: R2-m4.

### R2.5 New findings

| ID | Severity | Where | Problem | Why it matters | Required fix |
|---|---|---|---|---|---|
| **R2-m1** | MINOR (in-PR, cheap) | `routing/define-route.ts` `openSchemaProblems` | **Schema-level preferences re-open a schema at any depth, the top level included.** `Joi.object({ a: Joi.string() }).prefs({ allowUnknown: true })` (top level) and `.options({ allowUnknown: true })` (nested) are both ACCEPTED by `defineRoute`. At run time the top-level form returns `{"a":"x","smuggled":"y"}` to the handler, because a schema's own preferences override the validate options. `Joi.link(...)` is accepted without being walked. | REQ-SEC-007 and D-TASK020-24 ("closed at every depth"). A handler that spreads `input.body` into a write would accept columns that are not server-controlled (mass assignment). `serverControlledIssues` still catches `org_id` and the like. Same class as r1 m8, a different spelling. | In `openSchemaProblems`, refuse a node whose `preferences.allowUnknown === true`, at every node. Refuse `type: 'link'`, or resolve it by id and walk the target. Add one test per form. Otherwise route to TASK-100 with the forms named. |
| **R2-m2** | MINOR (in-PR, cheap) | `tests/generated/route-metadata.ts:437,446-447` | **Three wiring lines are unpinned.** Deleting `add('transaction', …)`, `add('permission-status', …)` or `add('reauth', …)` from `checkRouteMetadata` leaves the whole suite green (40/40). The functions are tested directly, and the real tree has no defect for the composed call to find. | The `transaction: none` pin is one of D-ARCH-106 (6)'s three ratchets, and m6's closure rests on these calls. A refactor that drops a line removes the control silently (the PR #26 "composition line" class). | Add one seeded case per rule through `checkRouteMetadata`: a mounted non-pinned `transaction: 'none'` route (`metadataFixtureSlots()`), a doc with `x-permission-status: proposed`, and a doc with max-age and no scope. Assert on `finding.rule`. |
| **R2-m3** | MINOR (route to 020-C, which edits this rule for R4) | `tools/eslint-rules/no-external-calls-in-tenant-tx.mjs` `collectRouteHandler`, `isNamedDependencyCall` | **Some handler shapes are silently not roots.** Lint probes gave 0 T-83 findings for: (a) `defineRoute(spec)` with a non-literal `spec`; (b) a module helper `tenantRoute = (id, handler) => defineRoute({ …, handler })` called with an inline async `fetch` handler (the handler is a parameter, which R3 does not resolve); (c) `ctx.deps.queue.add()` in an inline handler (only `deps.x` and `this.x` holders are recognised). `fetch` in (a) and (b) is still caught by `outbound-http-via-client`, but a `queue.add` would not be. | All three are outside the letter of R2 (literal argument) and R3 (const or function). A wrapper helper is the first refactor a module with 10 routes will make, and the rule then protects nothing in that module. The fail-closed spirit of R2 ("non-literal counts as tenant") argues for refusing what cannot be resolved. | 020-C: report a `defineRoute(` whose first argument is not an object literal, and a `handler` that resolves to neither a function nor a member expression (a parameter or a `let`): "declare route handlers inline or as same-file const functions". Match the `names` entry on any member chain (`a.b.queue.add`). One fixture each. |
| **R2-m4** | MINOR (route to the architect note plus the TASK-052/055 sheets) | `packages/shared/src/http/credentials.ts`; `authn/authenticate.ts` | **Refresh-cookie presence counts as a credential on every route.** ADR-0006 R-06: `__Host-rt_web` is `Path=/` (the `__Host-` prefix requires it), and it is "read only by `/api/v1/auth/refresh` and `/logout`, ignored everywhere else". My probe: a `[anonymous]` GET carrying only `__Host-rt_web` gets **401** from the stub. This follows D-ARCH-107 (5)'s stub clause verbatim and is latent today, because nothing issues the cookie before TASK-055. | Once TASK-055 lands, every same-host browser request from a signed-in user carries the cookie. If TASK-052 or TASK-055 keeps the stub's "presented credential, so refuse" rule for the cookie, `createSession` (login, `[anonymous]`), public tracking and reference reads answer 401 to any browser holding a stale cookie. Making the response private when a cookie is present is harmless and can stay. | No code change in this PR. Add one sentence in `authenticate.ts` and `credentials.ts`: the cookie-presence refusal is stub-only, and real authenticators ignore the refresh cookie on routes whose set lacks `refresh-cookie` (ADR-0006 R-06). Ask the architect to reconcile D-ARCH-107 (5) with ADR-0006 R-06, and add the line to the TASK-052 and TASK-055 sheets with one matrix row (TASK-027): `[anonymous]` + cookie gives 200. |
| R2-n1 | NIT | `define-route.ts` `defineRoute` | `Object.freeze` is shallow. `audit`, `reauth` and `deprecated` stay mutable. P1c: `(r.audit as {action:string}).action = 'NONE'` after `defineRoute` keeps the brand, and the audit stub then mounts a route declared `CREATE`. The `readonly` types make this a cast-only path. | | Deep-freeze `audit` (and `additional`), `reauth` and `deprecated` in the descriptor (copy, then freeze). |
| R2-n2 | NIT | `platform/storage/boundary.test.ts:2-3`; `eslint.config.mjs` S3 entry | The header still says there is "no ESLint entry while TASK-020 holds the lint lock". `no-restricted-imports` does not see `import('@aws-sdk/…')`, so the unit test remains the only control for dynamic imports. | | Update the comment: lint covers static imports, this test also covers dynamic and `require`. Optionally add `no-restricted-syntax` on `ImportExpression[source.value=/^@aws-sdk\//]`. |
| R2-n3 | NIT | `route-state.ts` `principalOf` | The unknown-credential fallback has no direct test; its mutant is equivalent at the authz gate. | | One unit case: `principalOf` with `credential: 'bearer'` returns ANONYMOUS. |

### R2.6 Decision rulings

| Decision | Ruling |
|---|---|
| D-TASK020-18 (MFA stub 403 `AUTHZ_DENIED`, not the auth module's code) | Accepted. |
| D-TASK020-19 (boot checks in `createApp`; production bindings by `apiMode === 'live'`; no runner check under a replaced pipeline) | Accepted. `main.ts` never passes `pipeline`. |
| D-TASK020-20 (shared `presentsCredential` in `@platform/shared`) | Accepted. See R2-m4 for its doc comment. |
| **D-TASK020-21** (stub refuses a presented credential on an anonymous-capable route; `authorise` marks private) | **Sound.** It is D-ARCH-107 (5) verbatim and does not break `createQuote` (R2.4). The refresh-cookie half is carried as R2-m4. |
| D-TASK020-22 (walker accepts only path-to-regexp `match`) | Accepted. It fails closed on a router upgrade. |
| D-TASK020-23 (`api-mounts` unused runner; `metadataFixtureSlots`) | Accepted. |
| D-TASK020-24 (closed at every depth, depth 32) | Accepted with R2-m1. |
| D-TASK020-25 (frozen `ctx.transport`) | Accepted. Closes n4. |
| D-TASK020-26 (pre-route problems need `no-store` only) | Accepted. It matches my r1 m1 recommendation. |
| D-TASK020-27 (`logging.api.test.ts` stand-in authenticator, Supertest allow-list) | Accepted. It is test-only, and the reason is recorded in `eslint.config.mjs`. |

### R2.7 Merge conditions

1. **Lane-B evidence** on an ancestor of the final head once Docker is back (D-ORCH-049). Then a lane A run on the final head whose lint, typecheck, unit, negative-fixtures and build steps actually **execute and pass**. On `11530cc` they were skipped.
2. **Security record** naming the final head. It covers the merge-only rounds for the PR #20 and PR #33 unions, the new `CODEOWNERS` line and the D-ARCH-107 implementation, with D-TASK020-03 and D-TASK020-21 confirmed.
3. **R2-m1 and R2-m2 in-PR before the evidence commit.** They are cheap, and evidence has not been produced yet, so they cost no extra lane-B run. The NITs can ride along. If they are not done, route R2-m1 to TASK-100 and R2-m2 to 020-C as sheet lines. R2-m3 goes to 020-C and R2-m4 to the architect plus TASK-052/055/027, as sheet lines either way.
4. After the evidence commit: no non-docs commit and no non-docs main merge before the squash. Squash with the linted PR title.
5. Next activation PR: qa-lead moves SEC-TC-29 back to `required_cases` (now 18 tagged tests across 7 files, fixed predicate).

### R2 GOOD

- **One predicate, three consumers.** `presentsCredential` and the `isPrivateResponse` mark replace header-text sniffing. The helper, stubs and app now agree by construction.
- **Stubs refuse at mount and name their owner.** `bootFailureOf` maps each refusal to its own event, with route identities only.
- **The ratchet test** reuses the suppression checker's lexer (strings and templates skipped) and covers blanket directives.
- **The union commits are clean.** Hand edits are confined to the conflicted files plus five declared ones, and the PR body carries a checklist that matches the tree.

### R2 SECURITY-FLAGS (for security-analyst)

- R2-m1: `prefs`/`options({ allowUnknown: true })` re-opens a schema (mass-assignment class); `Joi.link` is not walked.
- R2-m4: refresh-cookie presence vs ADR-0006 R-06 (login 401 risk once TASK-055 issues cookies); D-ARCH-107 (5) reconciliation.
- R2-m3: T-83 non-literal and wrapper roots (route to 020-C).
- R2-n1: shallow freeze of the descriptor's `audit`.
- Confirm D-TASK020-21 and the D-ARCH-107 credential-gate ordering on the final head.

## Round 3 (head 308eb83, delta)

| Field | Value |
|---|---|
| Head reviewed | `308eb8398382510c846e91b371e02d071ed1ddf7` |
| Delta since r2 | `11530cc..308eb83`: `68c3532` docs merge, `8c8147c` fix(api), `2b1b01a` test(api), `5eee2d0` docs(api), `2b0ee65` merge of `main` (PR #35), `f7428a6` docs(api), `5a145a8` merge of `main` (PR #36), `e7d1c9e` lane-B evidence, `308eb83` docs merge |
| Base | `origin/main` `a1f9cef` (merge base `e1805a5`; `main` has changed only `docs/sdlc/STATUS.md` since, and `git merge-tree origin/main 308eb83` is clean) |
| Reviewer | code-reviewer checks, run in one pass with the security round-3 delta by the security-analyst agent (D-ORCH-050: both delta checks, separate records). Read-only. One slip, disclosed: my first command ran read-only `git log` and `git status` inside the PR worktree; nothing was written. All other work used the main checkout and scratch extracts. Date 2026-11-14 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R2-m1 (schema-level prefs, Joi.link, Joi.extend), R2-m2 (three wiring lines), R2-n1 (shallow freeze) and R2-n3 are
  closed as D-ORCH-050 prescribes, and D-TASK020-28..31 are sound. 18 of 18 source mutants of the fix are killed; three
  defensive branches of the new extension walker survive (NIT). The four main merges are pure unions. The comment edits
  are accurate against D-ARCH-109 and change no behaviour. 0 BLOCKER, 0 MAJOR, 0 MINOR open from this delta; 3 NITs.
  Lane A executed every gate on this head and is green except the security-owned record step (this round's record).
```

### R3.1 Verification I performed

All probes ran on a `git archive 308eb83` extract (and `11530cc` as the positive control) with a `node_modules` of junctions to the main checkout; the PR worktree was not used. No Docker, no install.

| Check | Result |
|---|---|
| Targeted unit, in band | `apps/api/src/platform` (all), `packages/authz`, `packages/shared/src/http`, `tests/generated`, `tests/api/helpers`, `tests/contract-stubs`, `tools/openapi`: **51 suites, 977 tests pass** (round 2: 50 and 959; +1 suite, +18 tests = 7 + 2 for `define-route`, 6 for `route-state`, 3 for R2-m2) |
| Mutation of the fix (18) | **All killed.** `Joi.link` refusal, the `allowUnknown` check, the non-built-in type check, definition identity, the extension walk unwired, the `$_terms` walk, each of the `audit` / `reauth` / `deprecated` freezes, a shallow `frozenData`, `readonlySet` returning the `Set`, unfrozen, following its source, `ANONYMOUS.permissions` mutable, `principalOf` trusting an unknown kind, and each of the three `add(...)` calls in `checkRouteMetadata` (1 failing test each) |
| Mutation of the walker (5 more) | Array branch and plain-object branch removed: killed. **Survive:** the `definition === undefined ||` clause (equivalent under Joi 18.3.2), the `MAX_TERM_DEPTH` guard, the `seen` set (R3-n1) |
| Joi-upgrade simulations | `_definition` renamed: every schema refuses and the suite fails at module load. `$_terms` renamed: `defineRoute` keeps working and one test goes red (R3-n1) |
| Bypass matrix | 65 schema constructions through the validate slot and `routeDefinitionProblems`: on `11530cc` 22 are accepted while the slot hands an extra `role` to the handler; on the head **0**. Details and the other 15 schema-level preferences are in the security record, R3.3 and R3.5 |
| Merges vs `git merge-tree` | `68c3532`, `2b0ee65`, `5a145a8`, `308eb83`: each tree equals the clean merge of its parents; each `main`-side parent is an ancestor of `origin/main`. `tools/quality/**`, the workflows, `tools/ci/**`, the lockfile and the scanner configs are byte-identical to `origin/main`; `package.json` differs from `main` by the PR's own `test:contract` line only |
| Comment-only edits | `authn/authenticate.ts` and `packages/shared/src/http/credentials.ts` compile to identical output with comments removed (positive control: a one-token change is seen) |
| Lane A run 43498977127 | `fast-lane` **success, every step executed** (lane-B evidence, commitlint, lint, lint tree clean, format, actionlint, type-check, unit, base-ref negative fixtures, build, build tree clean). `scans`: Gitleaks, Semgrep, oasdiff green; only the security-owned record step is red |
| Lane-B evidence | The real `check-evidence --profile pr` passes on the head and credits run `20261113T1958Z_5a145a8` (api 101, catalog-c1-c14 74, integration 254, unit 4,141; clean tree, `build_clean`). `5a145a8` differs from the head only in `docs/**` and `.claude/**`. The run's host-fragment scan is 0 |
| Not re-run by me | Lint, format, type-check, build, integration, coverage: lane A executed lint, format, type-check, unit and build on the head, and the evidence run carries api, integration and unit. I rely on those, plus the scoped runs above |

### R3.2 Round-2 findings: closure

| r2 | Status | Evidence |
|---|---|---|
| **R2-m1** (schema-level `prefs`/`options`, `Joi.link`, `Joi.extend`) | **Closed** | Each of the six forms has a test that first proves the validate slot hands `role` to the handler and then proves `routeDefinitionProblems` names the form and `defineRoute` throws `RouteDefinitionError` (both halves checked: the precondition passes on the unfixed schema, the refusal on the fix). A seventh test keeps harmless preferences (`allowUnknown: false`, `convert`, `stripUnknown`) and built-in types from an extended root accepted. The link, the preference and the definition checks each kill a mutant. My matrix covers the families the six forms stand for (nested `when`, `alternatives`, `concat`, `unknown`, `pattern`, array items, `keys()`, `fork`, `compile`, `Joi.defaults`) with no bypass |
| **R2-m2** (three unpinned wiring lines) | **Closed** | Three seeded cases run through the composed `checkRouteMetadata`: a mounted public `transaction: 'none'` route outside `TRANSACTION_NONE_OPERATIONS`, a contract copy with `x-permission-status: proposed`, a contract copy with `x-reauth-max-age` and no scope. Each asserts `rule` and a message fragment, and the contract is `structuredClone`d so the shared document is never mutated. Deleting each of the three `add(...)` calls fails exactly one test |
| **R2-m3** (T-83 non-literal and wrapper roots) | Open, routed (as ruled) | Part 020-C (D-ARCH-111; the sheet line is present) |
| **R2-m4** (refresh cookie vs ADR-0006 R-06) | **Closed for this PR** | The comments say what R2-m4 asked, accurately (R3.3); the architect reconciled the rule (D-ARCH-109, ADR-0006 am. 17, ADR-0008 am. 5); the code is the part 020-B follow-up, due before TASK-027 merges and before TASK-052 starts (D-ORCH-051 (1)) |
| **R2-n1** (shallow freeze) | **Closed** | `audit` (with `additional`), `reauth` and `deprecated` are deep-frozen copies; `route.audit.action = 'NONE'` throws; a later change to the caller's objects does not reach the descriptor; no `reauth`/`deprecated` key is invented when absent. Four mutants killed |
| **R2-n2** (`boundary.test.ts` header still says "no ESLint entry") | **Open (NIT, carried)** | Not changed at the head. The file is under owned `apps/api/src/platform/`, so touching it now voids the security record; ride it on part 020-B (R3-n2) |
| **R2-n3** (`principalOf` unknown kind) | **Closed** | `route-state.test.ts` covers missing principal, unknown kind and a known kind returned as set; the mutant (`principalOf` trusting an unknown kind) is killed |

### R3.3 New findings

| ID | Severity | Where | Problem | Why it matters | Required fix |
|---|---|---|---|---|---|
| R3-n1 | NIT | `routing/define-route.ts` `extensionProblems` (`:275-299`) | **Three defensive branches of the new walker are not pinned by a test.** Removing the `definition === undefined ||` clause (`:287`), the `MAX_TERM_DEPTH` guard (`:280`) or the `seen` set (`:279`) leaves all 71 tests green. The first is equivalent under Joi 18.3.2, but it is the whole "fails closed" claim of D-TASK020-29. Related: a rename of `$_terms` is not fail-closed at run time (only the nested-extension test goes red), and the message names the root (`schema.body`), not the nested key | The behaviour is fine today; the guards are what a Joi upgrade leans on, and the nested path would make a refusal easier to act on | With the next edit of the file (see PR32-SEC-17): treat a schema with no `$_terms` object as a problem; one test for that on a schema instance (`Object.defineProperty(schema, '$_terms', { value: undefined })`); one test for the depth guard (a chain that needs more than four term hops per schema level, such as nested `when({ switch })`); optionally carry the key path into the message |
| R3-n2 | NIT | `platform/storage/boundary.test.ts:1-5` | The header still says "no ESLint entry while TASK-020 holds the lint lock"; this PR added the S3 `no-restricted-imports` entry (R2-n2, unchanged) | A reader concludes the unit test is the only control for static imports | Part 020-B (the file is owned: S15 in the security record). Wording: lint covers static imports, this test also covers dynamic imports and `require` |
| R3-n3 | NIT | `routing/define-route.ts` `frozenData` (`:437`) | The copy rebuilds every object through `Object.entries`/`Object.fromEntries`, so a non-plain value (a `Date`, `Map`, class instance or accessor) would be flattened into a plain object without an error; accessors are also read again after the checks ran | `AuditDescriptor`, `reauth` and `DeprecationInfo` hold strings, numbers, booleans, `null` and arrays and objects of those, so nothing is lost today. A future `Date` field would silently become `{}` | When a descriptor type gains a non-plain field: throw in `frozenData` for an object that is neither an array nor a plain object. No action now |

### R3.4 Decisions and comment accuracy

| Decision | Ruling |
|---|---|
| D-TASK020-28 (`Joi.link` refused, not resolved) | Accepted. Request bodies need no recursion, and resolving links would duplicate Joi's resolver |
| D-TASK020-29 (extension detection by definition identity; allow-list read from `Joi.types()`) | Accepted with R3-n1. Identity is the right test: a same-name extension is caught at every position I tried (key, `when` then/otherwise/switch, `alternatives`, array items/ordered, `fork`, `concat`, three levels down), and an extended root's built-in types stay accepted |
| D-TASK020-30 (only `allowUnknown` other than `false` among schema-level preferences) | Accepted. The 15 other preferences a schema can carry were probed; none admits a key |
| D-TASK020-31 (`readonlySet` in `routing/route-state.ts`; no extra `allowUnknown: false` in the validate slot) | Accepted. A schema's own preferences override `validate()` options, so the walker is the control; the view is frozen, holds its `Set` in a closure and fails `Set.prototype.add.call` |

**Comments (`5eee2d0`, `f7428a6`).** Accurate. `authenticate.ts` and `credentials.ts` say the stub's "present means refuse" follows D-ARCH-107 (5) verbatim and is superseded by D-ARCH-109 (a foreign credential is ignored and changes no header); they say TASK-020 part 020-B makes the slot and the predicate route-aware (`presentedKinds`) before TASK-027 merges and before TASK-052 starts, which is D-ORCH-051 (1). The ids (R2-m4, PR32-SEC-16) are right. No code changed.

### R3.5 Merge conditions

1. **No non-docs commit after the security record** (the record names `308eb83`). A `main` merge that is docs-only, or that changes an owned path this PR does not change, keeps it. A `main` change to an owned path this PR also changes (`package.json`, `eslint.config.mjs`, `jest.config.ts`, `.gitignore`, `.github/CODEOWNERS`, `tools/tsconfig.json`) needs a merge-only delta, as `2b0ee65` did.
2. **Lane A re-runs on the record commit** (docs only); `ci-gate` turns green when the record step passes (simulated: pass).
3. Squash with the linted PR title; nothing else outstanding for code review.
4. **Carried, as sheet lines:** R2-m3 to part 020-C; R2-m4's code and PR32-SEC-14 to the part 020-B follow-up; R2-n2, R3-n1 and R3-n3 with the next edit of the file concerned; qa-lead moves SEC-TC-29 to `required_cases` in the next activation PR.

### R3 GOOD

- **The tests prove their own precondition.** Each `it.each` row first shows that the validate slot would hand `role` to the handler, then shows the refusal, so a refusal can never pass for the wrong reason.
- **Identity, not names.** The allow-list is read from `Joi.types()` rather than listed by hand, so it follows Joi, and the fail-closed direction (an unknown definition refuses) is the safe one.
- **`readonlySet` is small and correct.** A closure-held `Set`, frozen, no mutators, with the `Set.prototype` route tested as well as the property route.
- **R2-m2 reuses the real helpers.** The three seeded cases go through `checkRouteMetadata` itself, on a `structuredClone` of the contract, instead of testing the sub-rules a second time.
- **The PR body keeps its record honest**: gate numbers carry the head they were taken at, uncommitted infrastructure FAIL runs are disclosed, and the decisions are in the body per D-ORCH-040.

### R3 SECURITY-FLAGS

- None open for the delta; the security-analyst's checks are in the security record, "Round 3 (head 308eb83, delta)" (PR32-SEC-13 and -15 closed; new INFO PR32-SEC-17 = R3-n1).
