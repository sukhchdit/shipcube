# PR-0048: TASK-027 RBAC matrix test generator, security review

| Field | Value |
|---|---|
| PR | #48 `feat(authz): generate route x role RBAC matrix tests from route metadata (TASK-027)`, https://github.com/sukhchdit/shipcube/pull/48, branch `feat/TASK-027-rbac-matrix-test-generator`. Eight commits on the merge base `5d2c102`: `dd0df1b` (generator), `6f4d327` (API case runner items of TASK-024-F), `6800e5a` (suite, seams, committed matrix), `f0e4ba7` (loopback bounds), `77d4c58` (evidence), and three merges of `main` (`75aa83a`, `9e65e61`, `a4f2d51`; the last two bring docs only). `main` was `e1768ea` when this round was written; it has moved past the merge base by PR #39 (`3f58935`), which changes `package.json` (see §7), and since then by docs and agent notes only (`8c65315`, `e1768ea`) |
| Head | a4f2d51ddf0c8ddfa83997b53d7adb73d8a637c0 |
| Lane A evidence | Run 43687221665 on `a4f2d51` (`pull_request`, `RANGE_BASE` `5d2c102`). **fast-lane `success`**: workflow policy, install flags, migrations immutable, lockfile, licences, signatures, audit, "Lane B evidence" (accepted `20261115T0623Z_9e65e61`), lint, format, type-check, unit, negative fixtures, build. **scans**: Gitleaks, Semgrep and oasdiff `success`; the only red step is "Security-owned paths need a review record" (11 owned paths, no `PR-0048-*` record). `ci-gate` is red only as the aggregate. This file is the missing record |
| Owned paths changed | 11: `package.json` (one script, `authz:matrix`), `packages/authz/src/index.ts` (exports only), `packages/authz/src/generator/{matrix,document,org-scope}.ts` and their three tests (new), `tests/generated/rls/{api-cases.ts, api-cases.test.ts, generator.ts}` |
| Unowned paths changed | `tests/generated/rbac/` (6 new files), `docs/03-architecture/generated/rbac-route-matrix.md` (new) and the run directory `docs/05-quality/tests/runs/20261115T0623Z_9e65e61/` (8 files). Ownership ruling in §5.6 |
| Reviewer / date | security-analyst, 2026-11-15, round 1. Read-only. Git object reads ran in the main checkout. Probes ran on `git archive` extracts in the session scratchpad (one `node_modules` junction to the main checkout during probe B, removed afterwards; the main checkout's `node_modules` still has 740 entries). The lint probe used `ESLint#lintText` and wrote no file. The record simulation used a sparse `git clone --shared`. In the PR worktree I only wrote, edited and read this file (no git command there). No install, build, Jest, Docker or commit. The code-review twin is `docs/05-quality/reviews/PR-0048-TASK-027-code-review.md` on `main` (`e1768ea`, APPROVED_WITH_NITS); this record cites its IDs. Line numbers here come from single-file reads at `a4f2d51` (`runner.ts` has 144 lines, `org-scope.ts` 55), so where the twin's line numbers for those two files differ, use these |

## 1. Summary

The PR adds a pure RBAC matrix generator to `packages/authz` (one cell per route x caller, 33 caller columns), a suite that runs every cell over HTTP through `createApp` with the production authenticate fallback, MFA gate and authorise slots (a registry layer with the mounted routes and a contract layer with all 133 `openapi.yaml` operations, about 4,300 requests), the committed route matrix with a fast-lane drift test, the SEC-TC-01 `{orgId}` cases, and the API-case-runner items of TASK-024-F (PR43-SEC-12, code review R2-n2).

The assurance claim holds. An oracle I wrote separately from the PR (it reads `openapi.yaml` directly and models ADR-0008 amendments 4 and 5 from the ADR text) agrees with the committed matrix on all 4,389 cells and all 133 metadata rows. Every deny cell is a real request, not a registration. Deny cells must come back as a problem document that never reached the terminal. Signature-only permissions cannot be satisfied by a session or by an anonymous caller. Foreign credentials are run on every route. The three test seams are confined to `tests/generated`, and a production import of them fails lint (probe). The `packages/authz` change adds exports and new files only: production authorisation behaviour is unchanged.

The suite is fail-closed for new routes. Every mounted route gets a row from its own descriptor, a stale committed matrix fails the fast lane, and a failing matrix test fails lane B even before activation, because the merged-coverage step runs the `generated` project whole.

Findings: 0 Critical, 0 High, 0 Medium, 4 LOW, 4 INFO.

**Verdict: PASS_WITH_FOLLOW-UPS.**

## 2. Method

1. Read the full diff `5d2c102...a4f2d51` and the production slots it composes: `authenticate.ts`, `mfa-gate.ts`, `authorise.ts`, `route-state.ts`, `pipeline.ts`, `credentials.ts`, `routes.ts` (`PERMISSION_AUTH`) and the route-metadata checker. Read ADR-0008 amendments 4 to 6, D-ARCH-107/109/110/113/120/125, threat model T-32, AC-06, R-03 and SEC-TC-01, the PR-0043 record and D-SEC-PR43-05, and the TASK-060 sheet.
2. **Probe A, independent oracle** (`oracle.mjs`). It reads `openapi.yaml` itself: `security` alternatives to credential kinds, with `security: []` read as anonymous; plus `x-permission`, `x-permission-authenticated` and `x-mfa-gate-exempt`. It loads `ROLES` and `PERMISSION_DEFINITIONS` from the head extract (type-stripped). It builds the 33 columns and the cell rules from the ADR text, and compares every cell and every metadata cell with `docs/03-architecture/generated/rbac-route-matrix.md`. There are two modes: `stub` (a declared credential that does not verify gives 401, as the stub does) and `adr` (the ADR-0008 am. 5 item 1 table for `[session, quote-token]`). Mutation controls: an oracle that ignores `x-mfa-gate-exempt`, one that ignores `x-permission-authenticated`, and a committed matrix with a flipped `getShipment` cell.
3. **Probe B, runner power** (`runner-probe.mjs`). It runs the PR's real `matrixSlots`, `composeMatrixApp`, `contractDescriptor`, `runRow` and `observe` on the real `createApp` (type-stripped sources from the head extract). It wraps the authenticate slot to simulate future authenticator defects around a foreign credential, and checks whether `runRow` names them over 7 contract rows (`listCountries`, `getShipment`, `refreshSession`, `getQuote`, `createQuote`, `receiveStripeWebhook`, `receiveCarrierPush`).
4. **Probe C, lint confinement** (`lintprobe.mjs`). `ESLint#lintText` with the repository config (`eslint.config.mjs`, `tools/eslint-rules` and `tools/lint` are identical at the head and on `main`). It lints production files that import the generator, plus two controls.
5. Evidence checks: lane A step list and record-step output, the run's unit JUnit (counts per new test file, no failure), generator coverage, the evidence commit message and the PR body against D-SEC-PR23-02, and a count-only host-path scan with a positive control.
6. Record simulation (§9).

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR48-SEC-01 | Foreign-credential cells compare only status, code and `Cache-Control`, and no real provider-signature header is ever presented as a foreign credential. A foreign credential that adds `Set-Cookie` or `WWW-Authenticate`, changes a refusal body, or a signature header read on every route all pass the matrix (probe B) | LOW | CWE-693 (via CWE-287) | A07 | `tests/generated/rbac/runner.ts:94-99`; `packages/authz/src/generator/matrix.ts:166-167`; `tests/generated/rbac/matrix-app.ts:53, 125` | senior-developer (TASK-027 follow-up, together with code review R1-m1 and R1-n2) |
| PR48-SEC-02 | The O3 RBAC oracle (`tests/generated/rbac/`) and the effective-policy document (`docs/03-architecture/generated/rbac-route-matrix.md`) are outside CODEOWNERS | LOW | CWE-693 | A08 | `.github/CODEOWNERS`; `tools/ci/check-workflow-policy.mjs` `REQUIRED_CODEOWNED_PATHS` | devops-engineer / qa-lead (activation PR) |
| PR48-SEC-03 | The test oracle (`expectCell`, `generateMatrix`, ...) is exported from the production entry point `@platform/authz`, and no lint rule keeps production code from importing it. A production `authorise` that reused it would make the matrix confirm itself | LOW | CWE-693 | A04 | `packages/authz/src/index.ts:80-111`; `eslint.config.mjs` (no pattern) | senior-developer, before TASK-060 merges |
| PR48-SEC-04 | The generator encodes the stub's 401 for `[session, quote-token]` (8 cells of `getQuote` and `streamQuoteResults`), where ADR-0008 am. 5 item 1 and A-078 require 404 `NOT_FOUND` for no usable credential and a guest principal for a well-formed unknown token | LOW | CWE-693 (via CWE-204) | A01 | `packages/authz/src/generator/matrix.ts:20-23, 225-226`; `rbac-matrix.api.test.ts:342-349` | TASK-091 (sheet line) |
| PR48-SEC-05 | SEC-TC-01 case design: no proof that the route was reached, no AC-06 variant (caller also a member of the foreign organisation), and only the parameter name `orgId` is recognised. The T-32 enforcement has no owner | INFO | CWE-441 | A01 | `tests/generated/rbac/runner.ts:126-144`; `packages/authz/src/generator/org-scope.ts:14, 21-22` (with code review R1-n1, R1-n3) | TASK-060 (proposed owner of T-32); principal-architect confirms |
| PR48-SEC-06 | Seam retirement is not bound to the authenticator tasks. The role columns take grants from `ROLES` through the seam, so live permission resolution is outside the matrix. The coming TASK-041 limiter seam must stay test-only | INFO | CWE-1068 | A04 | `tests/generated/rbac/matrix-app.ts:91-160` (= code review R1-m3, extended) | TASK-052/055/091/171/261, MFA task, TASK-060, TASK-041 (sheet lines) |
| PR48-SEC-07 | R2-n2 (b) scans refusal headers for the other row's raw values only. A derived value (an ETag hash, a length difference) on a cross-tenant 404 is an existence oracle the scan cannot see | INFO | CWE-204 | A01 | `tests/generated/rls/api-cases.ts:157-161` | senior-developer, with the first `API_CASES` entry |
| PR48-SEC-08 | Nothing checks that every credential kind of `ROUTE_AUTHS` has a column that presents it, so a kind added later would be silently untested | INFO | CWE-693 | A04 | `packages/authz/src/generator/matrix.ts:127-149` | next change to the generator or to `ROUTE_AUTHS` |

## 4. Finding details

### PR48-SEC-01 (LOW): foreign-credential cells compare three fields only, and real signature headers are never presented

**Description.** D-ARCH-109 (2) says a foreign credential "cannot authenticate, cannot fail the request, cannot choose the principal and does not change the response headers". For a cell with `foreign: true`, `cellProblems` compares only `status`, `code` and `Cache-Control` with the `none` request (`runner.ts:94-99`). Separately, the signature callers apply only to `[signature]` routes (`matrix.ts:166-167`) and present the synthetic header `x-rbac-matrix-signature` (`matrix-app.ts:53`). So the three real provider headers in `CREDENTIAL_HEADER_NAMES` (`stripe-signature`, `x-mock-signature`, `x-carrier-signature`) are never sent to any route. ADR-0008 am. 5 item 6 (b) defines TASK-027's rows as "result and `Cache-Control`", so the PR meets the letter of its sheet. The finding is the gap between that sheet line and the rule the rows are meant to prove.

**Probe B** used the real `createApp`, the PR's slots and `runRow` over 7 contract rows. Each scenario wraps the authenticate slot:

| Scenario | `runRow` problems | What a direct request shows |
|---|---|---|
| S0 baseline (the PR's slots, no defect) | 0 | `listCountries` 204 for none, a refresh cookie and an expired bearer; no header difference |
| S1 a foreign refresh cookie makes the slot add `Set-Cookie` clearing it (a "clean up a stale cookie anywhere" authenticator, the TASK-055 risk) | **0** | header difference `set-cookie` |
| S2 a foreign bearer adds `WWW-Authenticate: Bearer error="invalid_token"`, status unchanged | **0** | header difference `www-authenticate` |
| S3 a foreign refresh cookie adds a field to the 401 body on `[session]` routes (status, code and `Cache-Control` unchanged) | **0** | (body only) |
| S4 a real `stripe-signature` header is read on every route and answers 401 | **0** | `listCountries` with `stripe-signature`: **401** (none: 204) |
| C1 control: a foreign refresh cookie answers 401 on an `[anonymous]` route | 6, first: `listCountries x refresh-cookie:valid: expected allowed, got 401 AUTH_REQUIRED` | status difference |

**Exploitability and impact.** There is no exposure today: the stub reads nothing and the seam reads only declared kinds. The risk arrives with TASK-052, TASK-055, TASK-091, TASK-171 and TASK-261. A defect of the S1 or S4 kind would clear every signed-in browser's session cookie on reference reads, or answer 401 on public routes when a client attaches a webhook-style header, and the matrix that is meant to prove D-ARCH-109 would stay green. Impact is availability and conformance (a foreign credential cannot raise privilege here, because the credential gate refuses any principal outside `route.auth`). LOW.

**Remediation (code level).**
1. In `runner.ts`, compare foreign cells on the whole response minus volatile parts:
   ```ts
   const VOLATILE = new Set(['date', 'x-correlation-id', 'connection', 'keep-alive', 'content-length']);
   const comparable = (o: Observed) => ({
     status: o.status,
     headers: [...o.headers].filter(([name]) => !VOLATILE.has(name)).sort(([a], [b]) => a.localeCompare(b)),
     body: o.problem ? JSON.stringify({ ...JSON.parse(o.body), instance: undefined, correlation_id: undefined }) : o.body,
   });
   if (cell.foreign && !isDeepStrictEqual(comparable(observed), comparable(none))) problems.push(`${label}: a credential outside the route's set changed the response ...`);
   ```
2. In the generator, add one foreign caller per real signature header name (`signature-header:<name>`, presenting `<name>: t=0,v1=0`). It applies to every route without `signature` in `auth` (its cell is `foreign` and must equal `none`). Keep the synthetic header for the declared `[signature]` rows until TASK-171/261 replace it (PR48-SEC-06).

**Verification.** Mutation tests in `rbac-matrix.api.test.ts`, shaped like the existing "without authorise" control. Wrappers S1, S2, S3 and S4 above must each be named by `runRow`, and the PR's own slots must stay at 0.

**Relation to the code review.** Code review R1-m1 found that the foreign-credential and `Cache-Control` checks have no negative control (deleting them leaves every test green). This finding is about what those checks compare. One fix cycle should do both: widen the comparison, then pin it with the S1-S4 mutation controls and R1-m1's fake-server cases. Code review R1-n2 (the admin refresh cookie is never presented as a foreign credential) belongs to the same fix.

### PR48-SEC-02 (LOW): the RBAC oracle and the committed matrix are not owned

**Description.** `tests/generated/rbac/` holds everything that turns the generator's expectations into a verdict: `cellProblems`, `runOrgCase`, the seams, the suite, the fast-lane drift test and the writer. An unowned PR can make `cellProblems` return `[]`, skip a describe block, or widen a seam, and no security record is required. The suite is not in `required-suites.json` yet, so `min_tests` and `required_cases` do not catch it either. `openapi.yaml` is unowned too. A PR that changes an operation's `x-permission` to `public`, drops a `security` alternative or adds `x-mfa-gate-exempt` regenerates the committed matrix (the fast-lane test forces it), and nothing owned changes.

**Impact.** This is the same class as PR43-SEC-04 (the RLS oracle), which was LOW and closed by `/tests/generated/rls/` plus `REQUIRED_CODEOWNED_PATHS`. The committed matrix is the only artefact in which a change to "who may call what" shows up as a reviewable diff, so owning it costs one record for exactly the contract changes security should see. The cost is low: the document changes only with contract authz metadata or the role seed, and the role seed is already owned.

**Remediation.** Ruling in §5.6: add `/tests/generated/rbac/` and `/docs/03-architecture/generated/rbac-route-matrix.md` to `.github/CODEOWNERS`, and `tests/generated/rbac/` and `docs/03-architecture/generated/rbac-route-matrix.md` to `REQUIRED_CODEOWNED_PATHS`.

**Verification.** The `checkCodeowners` mutation tests gain the two entries (deleted, commented out and ownerless lines each give one finding). A record simulation on the activation PR, with an edit to `tests/generated/rbac/runner.ts` and with a regenerated matrix, must give `missing` without a record.

### PR48-SEC-03 (LOW): the test oracle is importable by production code

**Description.** `packages/authz/src/index.ts:80-111` exports `generateMatrix`, `expectCell`, `matrixCallers`, `presentedKind`, `signatureOnlyOf`, `orgMismatchCases` and the document functions from the package root. Probe C (`ESLint#lintText`, repository config):

| Case | Result |
|---|---|
| `apps/api/src/platform/authz/authorise.ts` imports `{ expectCell, generateMatrix }` from `@platform/authz` | **clean** |
| the same file, `import * as authz from '@platform/authz'` | **clean** |
| `apps/api/src/modules/shipment/service/probe.ts` imports `expectCell` | **clean** |
| control: `authorise.ts` imports `../../../../../tests/generated/rls/api-cases.js` | `import-x/no-relative-packages` |
| control: `authorise.ts` imports `supertest` | `no-restricted-imports`, `import-x/no-extraneous-dependencies` |

**Exploitability and impact.** TASK-060 rewrites `authorise` (live permission resolution, operator scope). The generator's module comment reads as a specification of exactly that slot ("the rules, in pipeline order"), so reusing `expectCell` there is an easy step. Once production decides with the oracle, the HTTP run compares the oracle with itself and AT-US-071-01 stops proving anything about the slot. The `getShipment` assertion against `ROLES` would still hold, because it checks the generator and not the slot. No exposure today.

**Remediation (code level).**
1. Move the generator to a subpath export. In `packages/authz/package.json`: `"./matrix": { "@platform/source": "./src/generator/index.ts", "types": "./dist/generator/index.d.ts", "default": "./dist/generator/index.js" }`, and remove lines 80-111 from `src/index.ts`. The writer, the suite and the doc test import `@platform/authz/matrix`.
2. In `eslint.config.mjs`, add a `RESTRICTED_IMPORT_PATTERNS` entry `{ regex: '^@platform/authz/matrix(?:/.*)?$', message: 'the RBAC matrix generator is the US-071 test oracle; production code never imports it (PR48-SEC-03)' }`. Add an exception block for `tests/generated/rbac/**` and `packages/authz/src/generator/**` built with `restrictedImportsExcept`. Add a boundaries resolved-file arm so that non-test `apps/*/src/**` files may not import `packages/authz/src/generator/**`; this catches relative paths and the `@platform/source` resolution.
3. Add negative lint fixtures (named, namespace, re-export, dynamic `import()`) and one positive fixture under `tests/generated/rbac/`.

**Verification.** The four negative fixtures report and the positive one is clean. Probe C's three "clean" rows report.

### PR48-SEC-04 (LOW): the oracle encodes the stub's 401 where the ADR says 404 or a guest principal

**Description.** ADR-0008 am. 5 item 1, row `[session, quote-token]`: "well-formed: guest principal; none usable: 404 `NOT_FOUND` (A-078)". A-078 states the same for a wrong or missing token. The generator's rules 1 and 2 (`matrix.ts:20-23`, code at `225-226`) give 401 for a set without `anonymous` when no declared credential is presented, and 401 for any declared credential that does not verify. The committed matrix and the D-ARCH-107 named test (`rbac-matrix.api.test.ts:342-349`: "an unknown one is 401") make the stub's behaviour the expected one. Probe A in `adr` mode differs from the committed matrix in exactly these 8 cells, and in no other:

| Operation | Caller | Committed | ADR-0008 am. 5 |
|---|---|---|---|
| `getQuote`, `streamQuoteResults` | `none`, `refresh-cookie:valid`, `refresh-cookie:unknown` | 401 | 404 `NOT_FOUND` |
| `getQuote`, `streamQuoteResults` | `quote-token:unknown` (well-formed, unknown) | 401 | guest principal (passes authorise; the handler answers 404) |

**Impact.** No exposure today: the stub is meant to fail closed with 401 (am. 5 item 3). The risk is direction. TASK-091 meets an O3 oracle that expects 401 and acceptance tests for US-155 that expect 404, and the cheap way to turn the matrix green is the behaviour A-078 rejects. LOW, because it concerns the conformance of a security oracle and no data is exposed.

**Remediation.** Now: a line in the generator's rule comment and in the D-ARCH-107 test title naming the deviation as stub-era, with TASK-091 as the owner. With TASK-091: a `deny-404` outcome (`REFUSALS['deny-404'] = { status: 404, code: 'NOT_FOUND' }`, symbol `404`, private). For a route whose `auth` is exactly `[session, quote-token]`, rule 1 gives `deny-404` and rule 2 gives a guest principal for a well-formed token (and `deny-404` for a malformed one). Regenerate the matrix; this is an owned path, so it gets a security record.

**Verification.** Probe A's `adr` mode shows 0 differences after TASK-091. The US-155 "Wrong token" and "Missing token" API tests and the matrix agree.

### PR48-SEC-05 (INFO): SEC-TC-01 case design and the T-32 owner

1. **Route reached** (= code review R1-n3). `runOrgCase` (`runner.ts:126-144`) passes on any 404 `NOT_FOUND` problem document. A route that refuses every `orgId` passes, and so would a target path that the fallback answers. The target comes from the mounted walk today, so this is theoretical. It costs one request to close: send the same caller with its own organisation first, to the matrix app (where the terminal answers), and require `x-rbac-matrix: authorised`.
2. **AC-06 fidelity.** AC-06 is "Admin in A, Viewer in B". The case's caller has no membership in the foreign organisation, so a guard that tests "the path organisation is one of the caller's memberships" passes it too. Today the inert runner closes this: such a check needs the database and answers 500. Once the principal carries more than one organisation (US-081, switch organisation), a token-held membership list could make that confused-deputy guard pass. The guard must compare with `principal.orgId` only. The case should gain an AC-06 variant when the principal type grows.
3. **Parameter name and shape.** `orgScopedRoutes` (`org-scope.ts:21-22`) recognises exactly `orgId`, and only as a whole path segment (`org-scope.ts:14`; code review R1-n1: `/x/:orgId.json` is not enumerated). All 15 `{orgId}` operations in the contract use that name as a whole segment, and no other path parameter names an organisation. R-03 calls for a build test. A `tenant` route whose path names an organisation under any other name (`organisationId`, `orgID`, `targetOrgId`) or inside a segment should be refused by `defineRoute` or the route-metadata test, so that the enumeration cannot miss it.
4. **Owner (requested).** See §5.7: TASK-060.

### PR48-SEC-06 (INFO): seam retirement and what the matrix does not cover

- **Authenticator tasks** (= code review R1-m3, which also proposes a tripwire on the stub contract). TASK-052 (bearer), TASK-055 (refresh cookie), TASK-091 (guest token), TASK-171 and TASK-261 (signatures) and the MFA task each need a sheet line. When the authenticator lands, delete that kind's branch from `resolvePrincipal` (`matrix-app.ts:120-132`), or the `+mfa` seam, and present a real test credential through the real slot. Until then, the D-ARCH-109 rows prove `presentedKinds`, the stub and `authorise`, not the authenticators.
- **TASK-060.** Role principals take `permissions` from `ROLES` through the seam (`matrix-app.ts:91-109`). The matrix proves the gate on the seeded grants, not the live effective-permission query. PR8-SEC-07's integration test covers the query. When resolution goes live, add a seeded-database variant of the role columns, or name the gap at G3.
- **TASK-041.** D-TASK027-11: when the step-0 IP limiter becomes real, the matrix needs a seam. It must be a `createApp` option reachable only from tests (no environment or config switch), plus a test that production composition passes the real limiter.

### PR48-SEC-07 (INFO): the refusal header scan looks for raw values only

`runApiCase` scans every header of a cross-tenant refusal for the other row's raw values (`api-cases.ts:157-161`). That closes R2-n2 (b) as written. A derived value cannot be seen: a strong ETag hash of B's row, a `Content-Length` or `Last-Modified` difference, or a `Location` built from another column would tell an attacker that B's row exists, or which version it is. The stronger oracle is indistinguishability. Request a never-seeded id with the same caller, and require the cross-tenant refusal to equal that 404 in status, body (without `instance` and `correlation_id`) and header names and values (without the volatile set of PR48-SEC-01). Add it with the first `API_CASES` entry (TASK-048/049/051).

### PR48-SEC-08 (INFO): no coverage check of the credential kinds

The columns are fixed in `matrixCallers` (`matrix.ts:127-149`). If a kind joins `ROUTE_AUTHS` (`packages/authz/src/routes.ts:27`, for example a partner API key), its routes get rows where every caller is foreign. The matrix then shows 401 everywhere and never exercises the new kind. Add a unit test: for every `ROUTE_AUTHS` kind except `anonymous`, some caller has `presentedKind(caller) === kind` (the counterpart of the RLS enumeration's "a credential the runner cannot present" finding).

## 5. Verification of the requested items

### 5.1 Assurance

| Property | Result | Evidence |
|---|---|---|
| Allow and deny for every route x role x credential kind | **Yes**: 133 contract rows x 33 columns (31 applicable on non-signature routes), plus the registry rows | Probe A: oracle and committed matrix agree on **4,389 / 4,389 cells (133 x 33, the `-` cells included) and 133 / 133 metadata rows** (stub mode). Controls: an oracle ignoring `x-mfa-gate-exempt` differs in 32 cells, one ignoring `x-permission-authenticated` in 37, and a flipped `getShipment x PARTNER_OWNER` cell is found. The fast-lane test makes the committed matrix equal the generator output exactly, so the generator's cells equal the oracle's |
| Deny cases are real requests | **Yes** | `runRow` sends one request per cell (the `none` cell is the row's reference request). A refusal must have the `REFUSALS` status and code, `application/problem+json`, and no `x-rbac-matrix` header. The terminal sits after `authorise` in the fixed order, and `next(err)` skips it, so replacing steps 5-10 cannot turn a deny into an allow |
| The allow side is anchored outside the generator | **Yes** | Role principals carry the `ROLES` grants (`readonlySet`); `getShipment` is asserted role by role against `ROLES` (allow if and only if `shipment:read` is held); the stale-expectation control fails against the app. Allow-cell distribution (probe A): 1,474 session, 63 refresh-cookie, 62 guest token, 30 none, 4 signature |
| Signature-only routes are not satisfiable by a session or by `public` | **Yes** | `PERMISSION_AUTH` binds a `signatureOnly` permission to exactly `[signature]` (`routes.ts:192-199`, checked by `defineRoute` for all 133 contract descriptors), so a session is always foreign there: 401 in every role column of `receiveStripeWebhook` and `receiveMockGatewayWebhook`, and the anonymous principal gets 401 from the permission gate. `public` with signature (`receiveCarrierPush`) admits only a verified signature principal (D-TASK020-03). The `authorise` branches that the matrix cannot reach (the credential gate, a non-signature principal on a signature-only permission, the actor check) are pinned by `authorise.test.ts:99-100, 205-217`. Code review R1-m2 shows the same by mutation and asks for either a "rogue authenticator" row or reworded titles; I agree, and either option is enough for security |
| Foreign credentials ignored | **Partly**: each kind outside the set is run on every route and must equal `none` in status, code and `Cache-Control` | PR48-SEC-01: headers and body are not compared, and real signature headers are never sent |
| Dual-mode guest routes covered | **Yes** | `createQuote` (`[anonymous, session]`), `getQuote` and `streamQuoteResults` (`[session, quote-token]`) rows, the D-ARCH-107 named tests, and the API-case cross directions (§5.3). PR48-SEC-04 for the stub-era cells |
| MFA gate | **Yes** | The 8 pending-staff columns give `MFA` on every non-exempt route that declares `session` (on other routes they are foreign and equal `none`); on the four MFA-exempt operations they pass the gate; the "without the MFA gate" control names every exposed staff cell |

### 5.2 Fail-closed

- **A new route without a case.** It cannot happen in the registry layer: rows come from the mounted walk (`descriptorOf`), so a new module route gets its row and its 31 to 33 requests automatically. A raw handler is not in the matrix, but the route-metadata test names it (`raw-handler`). In the contract layer, a new `openapi.yaml` operation without a regenerated matrix fails the fast-lane unit test `rbac-matrix-doc.test.ts`, which compares the full text and runs `--check`.
- **An "allow" marked by mistake.** Not through the document: the fast lane requires exact equality with the generator output. Through the generator: only if the slot has the same defect, which is the independent-implementation risk that probe A addresses, and which PR48-SEC-03 keeps independent. Through the inputs: a wrong `x-permission` or `security` in the contract passes every test, because the matrix proves enforcement of declared metadata, not the declaration. That is why the committed matrix should be owned (PR48-SEC-02).
- **Drift check.** Fast lane (unit, `rbac-matrix-doc.test.ts`: 3 tests, all passed in the run). Lane B (subset drift of the mounted routes plus full drift of the contract, inside the suite). Before activation, the suite still runs in lane B: `merged_coverage.projects_if_suites: ["generated"]` runs the whole project, and a failing test case fails `coverage merge: generated coverage run` (`heavy.mjs` `mergedCoverageStep`). That case passed in `20261115T0623Z_9e65e61`.

### 5.3 SEC-TC-01, PR43-SEC-12 and R2-n2

- **SEC-TC-01.** Three `[SEC-TC-01]` tests. Registry: every mounted `tenant` route with `{orgId}` is executed through production `authorise` and `execute` with a database handle that throws on first use (0 routes today). Contract: the 15 operations are enumerated, each with an allowed caller, and not executed. Fixture proof: the refusing route passes, and the leaking route, the route that queries first and the 404 with the id in `Location` are each named. Until the first `{orgId}` route, the executed coverage is the fixture proof. Crediting SEC-TC-01 at activation is consistent with D-SEC-PR47-01 (1). At G3, the gatekeeper should record how many registry `{orgId}` routes were executed. Design residuals: PR48-SEC-05.
- **PR43-SEC-12: closed.** `isSuccessStatus` (an integer in 200..299) is enforced in `routeCaseFindings` (`generator.ts:396`) and in `runApiCase` (`api-cases.ts:137`), where a positive call answered with anything outside 2xx is a problem whatever the case says. `api-cases.test.ts` pins the mis-mapped `positiveStatus: 404` over a leaking route (now named twice) and `201` on a creating route (passes).
- **R2-n2: closed.** (a) `callsFor` adds `tenant-a -> G` and `guest-h -> B` on routes that accept both kinds (`api-cases.ts:81`), each a 404 with no leak; a cross-leak fake is named in both directions. (b) Every refusal header is scanned (residual PR48-SEC-07). (c) `api-cases.test.ts` drives the runner over a `node:http` fake without Docker, with 9 tests, all passed in the run.

### 5.4 Test seams

- **Where.** `matrixAuthenticate`, `matrixMfaGate`, the terminal, `inertRunner` and `rawInput` live in `tests/generated/rbac/matrix-app.ts` only. `apps/api` is untouched by the PR. `tests/generated` is a separate workspace package, and a production import of it fails lint with `import-x/no-relative-packages` (probe C control); `apps/api`'s `tsconfig` (`rootDir: src`) would also refuse it.
- **No relaxation of authz.** `matrixAuthenticate` resolves only the kinds the route declares (`presentedKinds(req.headers, route.auth)`) and only the matrix's synthetic labels. Everything else, including the expired bearer and the unknown cookie or token, goes to the production stub. The signature header is read only where `route.auth` contains `signature`. `matrixMfaGate` passes only the identity-matched `+mfa` principals and sends every other principal to the production gate. The terminal runs only after `authorise` has called `next()`. Production `authorise` and `mfaGate` are the real slot objects.
- **Test-only exports.** The seams and `registryCaseFindings` are confined. The generator exported from `@platform/authz` is not: PR48-SEC-03.

### 5.5 `packages/authz` changes: rated no behaviour change

The only existing file that changes is `src/index.ts`, and it gains export lines only (80-111). The new `src/generator/*` modules have no top-level side effects. The one global regex (`org-scope.ts:14`) is used only through `matchAll`, which copies it. No production module imports them, and `apps/api` and `packages/*` are otherwise untouched. Their regexes run on route paths and on the committed document, never on request input, and are linear. Coverage is 100 % lines, branches and functions for the three modules in the run. Rating: none (no production authorisation change); PR48-SEC-03 is about future use.

### 5.6 CODEOWNERS ruling (requested)

**Add both.**
- `/tests/generated/rbac/` is the O3 RBAC oracle, the same role `/tests/generated/rls/` has for RLS (PR43-SEC-04). Without the line, an unowned PR can neutralise `cellProblems`, a seam or the drift test with no record.
- `/docs/03-architecture/generated/rbac-route-matrix.md` is the effective RBAC policy of the contract. `openapi.yaml` is unowned, so this file is the one place where a change to who may call what is forced into an owned diff: the fast-lane test makes every authz-relevant contract change regenerate it.
- Both also go into `REQUIRED_CODEOWNED_PATHS` (`tests/generated/rbac/`, `docs/03-architecture/generated/rbac-route-matrix.md`), with the existing mutation tests extended.
- **When.** In this PR if a further commit lands anyway. Otherwise in the `rbac-matrix` activation PR (D-ORCH-092: qa-lead, with devops for `.github/CODEOWNERS` and `tools/ci`), before that PR merges, and before any other PR edits either path. The record check reads CODEOWNERS from the base and the head, so the PR that adds the lines is already bound by them.

### 5.7 Owner of the T-32 `{orgId}` rule (requested)

**Proposed owner: TASK-060** (batch 1.7, lock `api-authz`, files under `apps/api/src/platform/authz/`, an owned path). It already owns the pipeline's 401/403 outcomes and the operator cross-tenant scope (US-076), and T-32 is the tenant-side twin of that scope. It sits in batch 1.7, ahead of the wave-8 tasks that add the first `{orgId}` routes (US-082/083/085), so the due point "before the first `{orgId}` route merges" holds by construction.

Scope for the sheet:
- (a) A platform gate, run after the permission gate and before any slot that can query. For `route.tenancy === 'tenant'` and a path parameter `orgId`, when `req.params.orgId !== principal.orgId` it raises `AppError('NOT_FOUND')`. It compares with the token's active organisation only, never with a membership list.
- (b) The R-03 build rule of PR48-SEC-05 item 3 (only `orgId` names an organisation on `tenant` routes).
- (c) The `[SEC-TC-01]` registry case of this suite becomes its acceptance test, with the route-reached check of PR48-SEC-05 item 1.

principal-architect confirms the owner in a D-ARCH line (R-03 names principal-architect and api-designer for the design). Until it lands, the suite fails by design on the first unguarded `{orgId}` route.

### 5.8 Evidence hygiene

- **D-SEC-PR23-02, verbatim.** The evidence commit `77d4c58` and the PR body's gate table both state "`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first | yes (rc 0)" and "`.git/info/exclude` is empty | 0 bytes". Profile `pr`; no `wave` or `gate` run is committed.
- **Run binding.** `20261115T0623Z_9e65e61`: `git_sha` `9e65e61`, `git_dirty: false`, `build_clean: true`, verdict PASS. Between `9e65e61` and the head only the run directory and `docs/sdlc/STATUS.md` change. Lane A's base-ref `check-evidence` accepted it at `a4f2d51`.
- **The run itself.** The unit JUnit has 0 `<failure>` elements and carries the new files: `api-cases.test.ts` 9, `rbac-matrix-doc.test.ts` 3, `matrix.test.ts` 10, `document.test.ts` 6, `org-scope.test.ts` 3. `coverage merge: generated coverage run` passed (this is where `rbac-matrix.api.test.ts` ran). Generator coverage is 100 / 100.
- **Host-path scan: 0.** It counts only and computes its needles at run time (OS user name, its 8.3 stem, home, temp dir, both slash forms, host name, git e-mail). It covered the 8 blobs of the run directory, the PR diff, the commit messages and the PR body. Every needle class is 0. The positive control (each needle once) detected all of them.
- **Earlier failing runs** (`0516Z`, `0555Z` at the same SHA) are untracked and described in the PR; they are not credited.

## 6. Earlier items

| Item | State |
|---|---|
| PR43-SEC-12 (LOW) | **Closed** (§5.3) |
| Code review R2-n2 (a)(b)(c) of PR #43 | **Closed** (§5.3); residual PR48-SEC-07 (INFO) |
| PR43-SEC-01 / C2 (registration-only API cases) | Stays closed: the runner still executes every registered case, and the matrix follows the same rule (every cell is a request) |
| PR43-SEC-11, R2-n1, R2-n3 | Not in this PR; they stay with TASK-024-F (D-ORCH-074) |
| PR32-SEC-14 (D-ARCH-110) | The signature rows exist and pass through the real `authorise` (`signature:holds` allowed, `signature:lacks` 403, a session 401) |
| PR32-SEC-16 / D-ARCH-109 | Rows present per ADR-0008 am. 5 item 6 (b); widened by PR48-SEC-01 |
| D-TASK027-05 contract quirks (`getCsrfToken`, `reportCspViolation`, `refreshShipmentTracking`) | No authorisation impact: the normalised fields are `audit.entity` and `permissionJustification`, and probe A confirms that the permission, credential set, dual-mode permission and MFA exemption of all 133 operations match `openapi.yaml`. Routed to api-designer by the PR |

## 7. Sequencing and unions

- **`main` moved and overlaps.** PR #39 (`3f58935`) changed `package.json` (`test:stack`), which is in this PR's owned net change. `git merge-tree` of `a4f2d51` with `main` is clean, and its `package.json` is `main`'s plus the `authz:matrix` line. Any merge of `main` into this branch voids this record, so a merge-only round must name the merge commit. Check it as follows:
  - the paths in `diff <main parent> <merge>` equal the PR's net-change paths;
  - every blob equals `a4f2d51`'s except `package.json`;
  - `package.json` equals the `merge-tree` result.
  The same applies to Dependabot PR #51 (`package.json`) if it merges first. A squash merge without a branch update needs no new round. Lane A runs on the head only.
- **Activation PR** (D-ORCH-092). It carries the runner entry (`"rbac-matrix": { "kind": "jest", "project": "generated", "paths": ["tests/generated/rbac/"] }`), `status: active`, `required_cases: ["SEC-TC-01"]`, the PR48-SEC-02 CODEOWNERS lines, and `min_tests` taken from that PR's own run (the PR states 21).
- **Before TASK-060 merges:** PR48-SEC-03, and the TASK-060 sheet lines of §5.7 and PR48-SEC-06.
- **Before TASK-091 merges:** PR48-SEC-04.
- **Before the first real authenticator (TASK-052 or TASK-055) merges:** PR48-SEC-01.

## 8. Proposed decision

**D-SEC-PR48-01 · 2026-11-15 · security-analyst (to be logged by the orchestrator) · PR #48 r1; RBAC oracle ownership; T-32 owner.**
- **Decision.** PR #48 r1 at `a4f2d51` = **PASS_WITH_FOLLOW-UPS** (0 C/H/M).
  - The independent oracle agrees with the committed matrix on 4,389 / 4,389 cells and 133 / 133 metadata rows.
  - PR43-SEC-12 and R2-n2 are closed.
  - The `packages/authz` change has no production behaviour change.
- **(1) CODEOWNERS.** `/tests/generated/rbac/` and `/docs/03-architecture/generated/rbac-route-matrix.md` join CODEOWNERS and `REQUIRED_CODEOWNED_PATHS`: in this PR if a commit lands anyway, otherwise in the `rbac-matrix` activation PR before it merges (PR48-SEC-02).
- **(2) T-32 owner.** The `{orgId}` rule (404 before any query, compared with the token's active organisation only) and its R-03 build rule go to **TASK-060**, before the first `{orgId}` route (wave 8). principal-architect confirms in a D-ARCH line.
- **(3) SEC-TC-01 credit.** `required_cases: ["SEC-TC-01"]` at activation is accepted (D-SEC-PR47-01 (1)). At G3 the gatekeeper records the number of executed registry `{orgId}` routes.
- **(4) Follow-ups.**
  - PR48-SEC-01 (LOW): senior-developer, before TASK-052 or TASK-055 merges.
  - PR48-SEC-03 (LOW): senior-developer, before TASK-060 merges.
  - PR48-SEC-04 (LOW): TASK-091 sheet line, before TASK-091 merges.
  - INFO 05: TASK-060.
  - INFO 06: sheet lines in TASK-052/055/091/171/261, the MFA task, TASK-060 and TASK-041.
  - INFO 07: with the first `API_CASES` entry.
  - INFO 08: next generator change.
- **(5) Unions.** A merge of `main` (PR #39's `package.json`) or of PR #51 into the branch voids this record and needs a merge-only round (§7).
- **Reversibility.** High.

## 9. Record validation

The simulation script is `PR-48-sec/sim/record-sim.mjs` (session scratchpad). It works in a sparse `git clone --shared` of the main checkout (`.github/`, `docs/05-quality/security/`, `tools/ci/`). It builds scenario commits on `a4f2d51` with plumbing, checks each one out detached, and runs the base-ref copy of `tools/ci/check-security-owned-paths.mjs` (`5d2c102`; the same object at the `main` tip `e1768ea`) with `--json`. The input was this file, final text.

| Scenario | Result |
|---|---|
| S0: `a4f2d51` without a record, base `5d2c102` (control) | `missing`, exit 1: "no record named docs/05-quality/security/PR-0048-*.md for PR #48", 11 owned paths. This is the lane A failure |
| S1: this record committed on `a4f2d51`, base `5d2c102` (lane A's base) | `pass`, exit 0, satisfied by `a4f2d51`, 11 owned paths |
| S1b: as S1, base = the `main` tip `e1768ea` | `pass`, satisfied by `a4f2d51` |
| S2: `--pr 47` (control) | `missing`: the PR-0047 record's head row names no commit of this PR |
| S3: the last `Verdict` row set to FAIL (control) | `missing`: "verdict FAIL is not one of PASS, PASS_WITH_FOLLOW-UPS, PASS_WITH_CONDITIONS" |
| S4: the `Head` row names the `main` tip (control) | `missing`: "its head row names no commit of this PR" |
| S5: an edit to `packages/authz/src/generator/matrix.ts` after the record | `missing`: "names a4f2d51, but packages/authz/src/generator/matrix.ts changed after it" |
| S6: a docs-only commit after the record | `pass`, satisfied by `a4f2d51` |
| S7: union with the `main` tip, base `e1768ea` (the merged `package.json` equals `main`'s plus the `authz:matrix` line) | `missing`: "names a4f2d51, but package.json changed after it". A merge of `main` needs a merge-only round (§7) |

Checks on the file itself:
- Exactly one table row has a first cell starting with `Head` (the full SHA), and the only `Verdict` row is the last table row of §10.
- Gitleaks emulation over this file (v8.30.1 `config/gitleaks.toml`, 222 rules, 221 compiled) found 0 findings, and its run-time controls (GitHub PAT, AWS key id, generic API key) all fired.
- The count-only host-path scan of this file is 0 for every needle class.
- Line endings are LF.

## 10. Verdict

| Field | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium, 4 LOW (PR48-SEC-01 to -04), 4 INFO (PR48-SEC-05 to -08) |
| Conditions | None |
| Follow-ups | PR48-SEC-02 (CODEOWNERS): this PR or the activation PR, before it merges. PR48-SEC-01: before TASK-052 or TASK-055 merges. PR48-SEC-03: before TASK-060 merges. PR48-SEC-04: TASK-091. INFO 05 to 08 as in §8. Plus the §7 union obligations |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** The generated matrix proves allow and deny for every route, role and credential kind with real requests through the production authenticate fallback, MFA gate and authorise; an independent oracle agrees on every cell; the suite is fail-closed for new routes and a stale matrix; the seams are confined to tests; production authorisation is unchanged. No Critical or High finding is open for this change |
