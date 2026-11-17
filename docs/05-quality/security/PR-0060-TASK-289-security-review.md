# PR-0060: TASK-289 RBAC matrix follow-up (TASK-027-F), security review

| Field | Value |
|---|---|
| PR | #60, https://github.com/sukhchdit/shipcube/pull/60, branch `feat/TASK-289-rbac-matrix-follow-up`. Merge base with `main` `c2b74c1`. Commits: `1353e78` (code), `df31b32` (lane B evidence only) and `89c24d8` (the code review r1 record, docs only). `main` was `f81e56a` when this round was written; since the merge base it gained PR #59 (`29318c3`, `.github/workflows/ci.yml` and `tools/ci/**`) and docs and agent-note commits. None of them touches a path this PR changes |
| Head | df31b3257cea15873a63a7f7bec36ea95e773587 |
| Lane A evidence | Run 44035635054 on `df31b32` (`pull_request`, stage-1 workflow, `RANGE_BASE` `0309d71`). **fast-lane `success`**: lane B evidence, commitlint, lint, actionlint, type-check, unit, the negative lint fixtures from the base ref against the head configs, build. **scans**: Gitleaks and Semgrep `success`; the only red step is "Security-owned paths need a review record" (this record is missing). `security_paths=true` (10 security-critical paths changed) but `security_integration_due=false`, because the job is selected only once the head's record check passes, so security-integration was skipped. `ci-gate` is red as the aggregate only. `main` now runs the stage-2 `ci.yml` (PR #59), so the record push needs a fresh code proof (orchestrator) |
| Lane B evidence | `20261117T0440Z_1353e78` PASS (profile `pr`): api 128, catalog-c1-c14 102, integration 323, rls-cross-tenant 126, unit 6,633 (2 skipped), 0 failures. Merged coverage (unit, unit-dom, integration, api, generated) lines 99.03 %, branches 97.05 %. `rbac-matrix` is still `planned` in the manifest, so its JUnit is not reported; the `generated` Jest project runs whole in the merged-coverage step, so a failing matrix test fails lane B. The new unit cases are in the unit JUnit with no failure: `runner.test.ts` 17, `entry.test.ts` 3, `matrix.test.ts` 13, `org-scope.test.ts` 4, `document.test.ts` 6, `rbac-matrix-doc.test.ts` 3, and the 9 `[PR48-SEC-03]` lint cases (4 seeded fixtures, 5 repository probes) |
| Owned paths changed | 20 (checker `owned[]`): `eslint.config.mjs`; `packages/authz/package.json`, `packages/authz/src/index.ts`, `packages/authz/src/generator/{index,matrix,document,org-scope}.ts` and the tests `{document,entry,matrix,org-scope}.test.ts`; 7 files under `tests/fixtures/lint/layering/authz-matrix-oracle/`; `tools/lint/lint-fixtures.mjs`, `tools/lint/negative-fixtures.test.ts` |
| Unowned paths changed | `tests/generated/rbac/` (8 files: `runner.ts`, `runner.test.ts` (new), `matrix-app.ts`, `rbac-matrix.api.test.ts`, `contract-routes.ts`, `write-matrix.ts`, `rbac-matrix-doc.test.ts`), `docs/03-architecture/generated/rbac-route-matrix.md`, the run directory `docs/05-quality/tests/runs/20261117T0440Z_1353e78/` (8 files) and the code review record. PR48-SEC-02 (CODEOWNERS for the first two) is still the activation PR's item. All of them were reviewed here |
| Binding items checked | The PR #48 security record (PR48-SEC-01 to -08, D-SEC-PR48-01) and code review (R1-m1 to R1-m4, R1-n1 to R1-n3); the TASK-289 sheet (WAVE-00); D-TASK289-01 to -12; D-SEC-PR53-02 (timing magnitude); D-ARCH-136 (the `./testing` convention, TASK-283); the TASK-052, TASK-055 and TASK-060 sheet lines that depend on TASK-289 (D-ARCH-134, D-ARCH-137); the PR #60 code review r1 (`89c24d8`, APPROVED_WITH_NITS) and its §8 security flags |
| Reviewer / date | security-analyst, 2026-11-17, round 1. Read-only apart from this record. Git object reads ran in the main checkout. The lint probes ran `ESLint#lintText` with the head's real `eslint.config.mjs` from the PR worktree (cwd and `node_modules` there; every file of `eslint.config.mjs`, `tools/eslint-rules`, `tools/lint`, `packages`, `apps/api/src` and `tests/generated/rbac` in the worktree hashes to its `1353e78` blob; nothing was written there by the probe). The other probes ran in the session scratchpad on `git show` copies. No install, Jest, Docker or GitHub run was started. In the PR worktree I only wrote this file and ran the pull, commit and push. Line numbers come from single-file reads at `1353e78`. The code review twin's mutation run (32 mutants) is cited by its IDs, not repeated |

## 1. Summary

The PR closes the PR #48 follow-ups that were bound to TASK-289.

- **PR48-SEC-01 (foreign credentials): closed.** A foreign-credential cell is now compared with the no-credential response in status, every header outside a six-name volatile set, and the body (a problem document without `instance` and `correlation_id`). The generator adds one foreign column per real provider signature header on the 130 routes without `signature`, and the unknown refresh cookie is now the admin cookie, so both cookie names are presented as foreign. The S1 to S4 scenarios of my probe B are now pinned twice: in `runner.test.ts` over a fake server with exact problem strings, and in `rbac-matrix.api.test.ts` against the real app. I looked for a volatile name or ETag exception that hides a real difference and found none. The ETag exception drops only an ETag equal to Express's weak hash of the same response's own body, and that body is compared (§5.1). The code review's mutation run agrees (R4 killed; residual test gap R1-n2).
- **PR48-SEC-03 (oracle importable by production): closed for every direct form.** The generator moved to the `@platform/authz/matrix` subpath, and `@platform/authz` exports none of it (value-identity test). 22 import forms from application and package code are each refused by one or more of `no-restricted-imports`, the two boundaries arms and `platform/static-module-specifier`. The forms are named, namespace, type-only, `export *`, `export * as`, a named re-export, `import()` with a literal and with a no-substitution template, a computed and a concatenated specifier, `require`, `import = require`, `createRequire`, relative `.js` and `.ts` paths, a package-internal re-export, CommonJS, the worker, a web route, the seed and a trailing slash. **Residual: PR60-SEC-01 (LOW).** The test exception is path-shaped. A file in a `test/` or `__tests__/` folder inside `apps/*/src` or `packages/*/src` may import the oracle, production code may import that file, and both folders ship in the API image. The fix is the boundaries arm D-ARCH-136 (b) already plans on TASK-283, which must land before TASK-060 merges.
- **PR48-SEC-05 items 1 and 3 (a): closed** (the route-reached control and in-segment parameters). Items 2 and 3 (b) are on the TASK-060 sheet as routed. **PR48-SEC-08: closed** (with code review R1-n1).
- **R1-m4:** the 30 s per-request deadline is pinned in magnitude and use (D-SEC-PR53-02), and transport errors are named.
- **D-TASK289-09:** `STUBBED_CREDENTIAL_KINDS` drives `resolvePrincipal`. No test makes that load-bearing (PR60-SEC-03, INFO; the code review's mutant A3 survives).
- **The regenerated matrix changes no cell.** I compared all 4,921 base cells (133 rows x 37 columns, metadata included) and found them unchanged. The 399 new cells equal the row's `none` cell on the 130 non-signature routes and are `-` on the 3 signature routes. Controls (one flipped existing cell, one wrong new cell) are each named.
- **The code reviewer's security flags** (§5.6): (a) the `./matrix` name is outside the D-ARCH-136 `./testing` convention, so the oracle ships in both images and the preflight imports it (PR60-SEC-05, INFO, TASK-283). (b) A dynamic `import()` of the oracle from `prisma/seed` or `tools` is not refused (probed). This is accepted, because neither makes a request authorisation decision. (c) The proof headers are never presented, and code review R1-m1 is the same gap (both are PR60-SEC-02).
- The `packages/authz` production entry loses exports only. Production authorisation behaviour is unchanged.

Findings: 0 Critical, 0 High, 0 Medium, 1 LOW, 4 INFO.

**Verdict: PASS_WITH_FOLLOW-UPS.**

## 2. Method

1. Read the full diff `c2b74c1...df31b32` (36 paths; 28 without the run directory). Read the head files `runner.ts`, `runner.test.ts`, `matrix-app.ts`, `rbac-matrix.api.test.ts`, `matrix.ts`, `org-scope.ts`, `generator/index.ts`, `entry.test.ts`, the `eslint.config.mjs` blocks, `tools/lint/{lint-fixtures.mjs,resolver.mjs}`, `tools/docker/{prune-dist.mjs,preflight.mjs}`, `apps/api/Dockerfile` (build and prune stage), `apps/api/src/platform/errors/{problem.ts,problem-handler.ts}` (what `instance` and the ETag are), `packages/shared/src/http/credentials.ts`, `.github/CODEOWNERS`, and the TASK-052/055/060/283 sheet lines.
2. **Probe C2, lint confinement** (`ESLint#lintText`, the head's real config, the repository's own probe options: `disableTypeChecked`, `projectService: false`). There are 22 bypass forms of the oracle import from production paths, 4 laundering cases through test-category files, 4 seed and tooling cases (the reviewer's flag (b)), and 4 controls (§5.2). The 30 production and control cases also ran with one candidate boundaries policy added (the PR60-SEC-01 fix).
3. **Production-to-test import scan** (`git show` at `1353e78`). Every non-test file under `apps/*/{src,app}`, `packages/*/src` and `prisma/seed` was scanned for relative imports that land on a `TEST_FILES` path. Result: 201 files, 0 such imports. The positive control (a synthetic `../routing/tests/loopback.js` import) is detected.
4. **Probe D, comparison power** (`responseDifferences` from a type-stripped copy of the head `runner.ts`, imports stubbed). Crafted response pairs, 4 controls and 7 residual shapes (§5.1).
5. **Matrix regeneration** (§5.4). A cell-by-cell comparison of `rbac-route-matrix.md` at `c2b74c1` and `1353e78`, plus two mutation controls.
6. `prune-dist.mjs` `shouldRemove`, called on folder and file names (`tests`, `test`, `__tests__`, `generator`, the query counter, a `.test.js`).
7. Evidence: the lane A step list and selection output (`gh run view --log`), the lane B summary and the unit JUnit (counts per new test file, no failure).
8. Record simulation (§9).

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR60-SEC-01 | The oracle confinement exempts every `TEST_FILES` path, and production code may import a test-category file. A helper in a `test/` or `__tests__/` folder inside `apps/*/src` or `packages/*/src` re-exports the oracle lint-clean, a service or `authorise` imports that helper lint-clean, and both folders (unlike `tests/`) are compiled into `dist` and kept in the API image, together with `packages/authz/dist/generator` | LOW | CWE-693 | A04 | `eslint.config.mjs:145` (`TEST_FILES`), `:325` (category `test`), `:677` (`noneOf: ['test', …]`), `:1089-1090` (exception); `tools/docker/prune-dist.mjs:56` | TASK-283 (D-ARCH-136 (b) arm, plus the laundering fixture and the `test`/`__tests__` prune), due before TASK-060 merges; or this PR if a fix cycle runs |
| PR60-SEC-02 | The signature-header columns are derived by the suffix `-signature`. Nothing checks that every name in `CREDENTIAL_HEADER_NAMES` is presented by some column: a provider header without that suffix, `x-csrf-token` and `x-reauth-proof` are never sent as foreign credentials (= code review R1-m1 and its flag (c)) | INFO | CWE-693 | A04 | `packages/authz/src/generator/matrix.ts:87-88`; `matrix.test.ts` (the pin to the 3 names) | R1-m1's partition assertion at the next touch of the generator; proof-header columns with TASK-048 (CSRF) and TASK-187 (re-authentication proof) |
| PR60-SEC-03 | `STUBBED_CREDENTIAL_KINDS` drives the seam (D-TASK289-09), but no test makes the list load-bearing. The mutant `seamed = route.auth.includes(kind)` (code review A3) passes every test, so the TASK-052 tripwire could pass while the seam still resolves the retired kind (= code review R1-n3) | INFO | CWE-1068 | A04 | `tests/generated/rbac/matrix-app.ts:74-79, 153-154, 160-168`; `rbac-matrix.api.test.ts` (D-ARCH-134 test) | TASK-052 (tripwire sheet line), or R1-n3's injectable list at the next touch |
| PR60-SEC-04 | Every column presents one credential. The D-ARCH-109 clause "a foreign credential cannot choose the principal" needs a declared credential and a foreign one together, which is the normal browser request: the `__Host-` refresh cookie (`Path=/`) rides along on every API call | INFO | CWE-287 | A07 | `packages/authz/src/generator/matrix.ts` (`matrixCallers`); `tests/generated/rbac/matrix-app.ts` (`callerHeaders`) | TASK-052 (bearer) and TASK-055 (cookie) sheet lines |
| PR60-SEC-05 | The oracle subpath is `./matrix`, outside the D-ARCH-136 `./testing` convention. After TASK-283 it is still neither pruned nor skipped: `dist/generator` ships in the api and worker images, the image preflight imports `@platform/authz/matrix` at build time, and the planned `@platform/*/testing` pattern does not cover it (this PR's own pattern does) (= the code reviewer's flag (a)) | INFO | CWE-1164 | A05 | `packages/authz/package.json` (`./matrix`); `tools/docker/preflight.mjs:25` (`SKIPPED_EXPORTS`) | TASK-283 |

## 4. Finding details

### PR60-SEC-01 (LOW): a test-category file launders the oracle into production code

**Description.** D-TASK289-07 lets `TEST_FILES` import `@platform/authz/matrix` (`eslint.config.mjs:1089-1090`), and the boundaries arm excludes the `test` category from its importers (`:677`). `TEST_FILES` is `['**/*.test.{ts,tsx,js,jsx}', '**/{test,tests,__tests__}/**']` (`:145`). It therefore includes helper folders inside production source trees, of which the repository already has seven (`apps/api/src/platform/{routing,storage,tx}/tests/*.ts`, `packages/audit/src/tests/fake-sql.ts`, `packages/authz/src/tests/repo.ts`). Boundaries' default is `allow`, and no policy keeps application or package code from importing a `test`-category file. Probe C2:

| Case | Result |
|---|---|
| L1 `apps/api/src/platform/authz/__tests__/decide.ts`: `export { expectCell } from '@platform/authz/matrix'` | **clean** |
| L2 `packages/authz/src/test/decide.ts`: `export { expectCell, generateMatrix } from './../generator/index.js'` | **clean** |
| L3 `apps/api/src/platform/authz/authorise.ts` imports an existing test-category file (`../routing/tests/loopback.js`) | **clean** |
| L4 `packages/authz/src/policy-probe.ts`: `export * from './tests/repo.js'` (existing) | **clean** |
| Control: `authorise.ts` imports `@platform/authz/matrix` directly | `no-restricted-imports` + `boundaries/dependencies` (oracle message) |

L1 or L2 followed by an L3-shaped import of the helper is the laundering: `authorise` decides with `expectCell` and lint stays green. At run time it works in the image too. `tsc -b` compiles all of `src` (no `exclude`). `prune-dist.mjs` `shouldRemove` removes `tests/` folders but keeps `test/` and `__tests__/` folders (`:56`; probe: `platform/authz/__tests__` kept, `platform/authz/tests` removed), and the preflight's `TEST_ARTIFACT` pattern (`preflight.mjs`) has the same three names. The image also keeps `packages/authz/dist/generator/` (`generator` kept). The same two hops reach the query counter (PR34-SEC-01): the policy `from test allow db-test-seam` covers a `__tests__/` helper. There, though, `prune-dist` deletes the compiled counter, so the image fails closed.

**Exploitability and impact.** This is the PR48-SEC-03 risk again, through two hops: TASK-060 rewrites `authorise`, and a production decision built on the oracle makes the matrix confirm itself (AT-US-071-01 proves nothing about the slot). It needs a decision helper placed in a test-named folder. `apps/api/src/platform/` and `packages/authz/` are CODEOWNERS-owned, so doing it there needs a security record. Module code (`apps/api/src/modules/**`) is not owned. No exposure today. Medium impact (O3 assurance) x low likelihood = LOW.

**Remediation (code level).** D-ARCH-136 (b) already plans the arm on TASK-283 (for PR53-SEC-05: "a boundaries policy arm refuses a non-test app or package file importing a file of category test"). This finding adds the oracle consequence, the two folder names the prune misses, and a due point.
1. In `eslint.config.mjs`, append to `BOUNDARIES_POLICIES` (after the oracle policy):
   ```js
   {
     from: { file: { categories: { anyOf: ['app', 'package'], noneOf: ['test'] } } },
     disallow: [{ to: toLayer('test') }],
     message:
       'application and package code never imports a test file or test helper (TEST_FILES): a test-only allowance (the RBAC matrix oracle, the query counter, Supertest) must not reach production through one (PR53-SEC-05, PR60-SEC-01).',
   },
   ```
   Probe C2 with exactly this policy: L3 and L4 report it, and the 22 direct forms and 4 controls are unchanged. The scan in §2 item 3 found no production file that imports a test-category file today (201 files), so the policy adds no finding on the tree. Re-run the seeded negative fixtures, because a fixture root may contain such an import.
2. Add a negative fixture to TASK-283's set: `tests/fixtures/lint/layering/authz-matrix-oracle/apps/api/src/platform/authz/bad-oracle-laundered.ts` imports `./__tests__/decide.js`, and a clean `__tests__/decide.ts` beside it re-exports the stand-in generator. Add a repository probe at `apps/api/src/platform/authz/authorise.ts` importing `../routing/tests/loopback.js` (expect `boundaries/dependencies`).
3. Defence in depth (TASK-283, which owns `prune-dist` and the preflight under D-ARCH-136 (a)): `shouldRemove` removes `test` and `__tests__` folders like `tests`, and the preflight's `TEST_ARTIFACT` names the same folders, matching `TEST_FILES`. Unit rows go in their tests.
4. **Due point.** TASK-060 has no dependency edge on TASK-283 (task map: TASK-056, TASK-020, TASK-013, TASK-289). Either the planner adds TASK-283 → TASK-060, or this PR takes item 1 and item 2 in a fix cycle.

**Verification.** The laundering fixture and probe report; L1/L2 stay clean (test files may still use the oracle); `negative-fixtures.test.ts` and `npm run lint` green.

### PR60-SEC-02 (INFO): signature-header columns by suffix, no totality check over the credential headers

`SIGNATURE_HEADER_NAMES = CREDENTIAL_HEADER_NAMES.filter((name) => name.endsWith('-signature'))` (`matrix.ts:87-88`). The test pins the result to the three current names and to the filter. A fourth provider header without the suffix (`x-hub-signature-256`, `paypal-transmission-sig`, `x-shopify-hmac-sha256`) added to `CREDENTIAL_HEADER_NAMES` would get no column, and both pins would stay green (code review R1-m1, MINOR). The two proof headers of the same list (`x-csrf-token`, `x-reauth-proof`; D-ARCH-113 (1)) are never presented either (the reviewer's flag (c)). They are proofs, not `ROUTE_AUTHS` kinds, so PR48-SEC-01 did not ask for them. Still, a CSRF or re-authentication slot that reads them on routes that do not require them, and answers differently from `none`, would pass the matrix. Remediation: R1-m1's partition assertion, written as a totality test. Collect the header names every caller presents (`callerHeaders` over all callers), and require each `CREDENTIAL_HEADER_NAMES` entry to be presented or to be on an explicit exclusion list with its reason and owner (today: `x-csrf-token` → TASK-048, `x-reauth-proof` → TASK-187). Those tasks then add the foreign columns along with the generator rule for their routes.

### PR60-SEC-03 (INFO): the still-stubbed list is not load-bearing in any test

`resolvePrincipal` returns `undefined` for a declared kind that is not in `STUBBED_CREDENTIAL_KINDS` (`matrix-app.ts:153-154, 163`), so the list does drive the seam (D-TASK289-09, verified by reading). Every kind is listed today, and no test removes one. The code review's mutant A3 (`seamed` ignores the list) survives every test. The cost is small, because TASK-052 also replaces the callers' credentials with real ones, which the seam's map does not know. Remediation (either one): add to the TASK-052 tripwire line that after `session` leaves the list, a seam-format bearer (`Bearer rbac-matrix.<ROLE>`) on a `[session]` route answers 401 from the real authenticator; or take R1-n3's injectable `matrixAuthenticate(principals, stubbed = STUBBED_CREDENTIAL_KINDS)` with its one test.

### PR60-SEC-04 (INFO): no combined-credential cells

D-ARCH-109 (2): a foreign credential "cannot authenticate, cannot fail the request, cannot choose the principal and does not change the response headers". Single-credential columns prove three of the four. "Cannot choose the principal" is a precedence question: with a valid bearer and a refresh cookie, which principal wins. Browsers send the `__Host-` refresh cookie with every request to the API host, so this is the normal request shape on `[session]` routes. The seam cannot get it wrong (it reads only `presentedKinds(headers, route.auth)`). A real authenticator could, and the authenticator contract (D-TASK020-41) and TASK-055's `refreshSession` spy test cover it only in part. Remediation, on the TASK-052 and TASK-055 sheets: one combined row per role, the bearer plus `refresh-cookie:valid`, plus `refresh-cookie:unknown` and plus one signature header. On `[session]` routes it must equal the bearer-only response under `responseDifferences` as it stands; on the three `[refresh-cookie]` routes it must equal the cookie-only response.

### PR60-SEC-05 (INFO): the oracle subpath is outside the `./testing` convention

D-ARCH-136 makes `./testing` the one sanctioned test-helper subpath. Its runtime target will be pruned from both images (TASK-283 (a)), the preflight skips it (`SKIPPED_EXPORTS = ['./testing']`, `preflight.mjs:25`), and `no-restricted-imports` will refuse `@platform/*/testing` outside tests (TASK-283 (b)). The oracle uses `./matrix`, a name the card and my PR48-SEC-03 remediation gave it. So after TASK-283 the oracle still ships (`dist/generator`). The preflight imports it at build time; it is a pure module with no top-level effects, so this is harmless. And only this PR's own pattern refuses it. No exposure: lint confines it, and a run-time import would need code that lint refuses (or PR60-SEC-01's laundering). Remediation on TASK-283, either one: add `./matrix` to the value-pinned `SKIPPED_EXPORTS` so the prune removes `packages/authz/dist/generator` and the preflight stops importing it, or rename the subpath `./testing` at the next `packages/authz` touch, which brings it under all three rules at once. Verification: the stack suite asserts `packages/authz/dist/generator` is absent from both images, and `image-exports.test.ts` pins the list.

## 5. Verification of the claims

### 5.1 PR48-SEC-01: whole-response comparison, volatile set, ETag exception, signature-header callers, admin cookie

- **What is compared** (`runner.ts:174-204, 221-226`): the status; every header except `VOLATILE_HEADERS` (`date`, `x-correlation-id`, `connection`, `keep-alive`, `content-length`, `transfer-encoding`) and except an `etag` whose value equals `weakBodyEtag` of the same response's body; and the body (a problem document re-serialised without `instance` and `correlation_id`, any other body byte for byte). `Set-Cookie`, `WWW-Authenticate`, `Cache-Control`, `Vary`, `Content-Type` and any new header are compared in name and value. Repeated headers are joined with a line feed. That join is untested: code review R1-n2 (mutant R10, last value wins, survives). I agree with its one-case fix; no separate finding.
- **ETag exception.** The problem handler removes any ETag (`DROPPED_ON_PROBLEM`), and Express then sets its weak hash of the body. That body carries the per-request `correlation_id`, so the ETag differs on every request. The exception drops an ETag only when it is a pure function of the same response's body, and the body is compared. So it hides nothing beyond the volatile body members. A foreign credential that adds or keeps any other ETag is named (probe D K2; `runner.test.ts` "any other ETag"; code review R4 killed).
- **Probe D** (`responseDifferences`): K0 identical-but-volatile → same; K1 `Set-Cookie` → named; K2 non-body ETag → named; K3 `detail` → named; H8 value case change → named. Residual shapes reported as the same: H1 ETag removed, H6 `Connection: close`, H7 chunked framing (all framing or body-derived; the body is compared); H2/H5 a correlation id with a credential-derived value (the correlation id is assigned by the request-context step before authentication); H3 a changed `instance`. **Note on `instance`** (= code review R1-n4): it is `instanceOf(req.originalUrl)` (`problem.ts:34-38`). That path is the same for the `none` request and every foreign request of a row, so it is not volatile in the matrix. My R1 remediation listed it as volatile. Comparing it would cost nothing. Today only an authenticator that rewrote `originalUrl` could change it, so I record no finding.
- **Signature headers:** three columns (`matrix.ts:87-88, 168`), on exactly the routes without `signature` (`appliesTo`, `:193`), presenting `<name>: t=0,v1=0`. Rule 2 covers the header on a signature route (401), and `appliesTo` never pairs the two. Named rows: `listCountries` and `getShipment` equal `none`. Suffix derivation: PR60-SEC-02.
- **Admin cookie (R1-n2 of PR #48):** `refreshCookieName(false)` = `__Host-rt_admin` for `refresh-cookie:unknown` (`matrix-app.ts:98, 113`), so both names are foreign on every route outside `[refresh-cookie]`. The fake-server test records both names on the wire.
- **Pinning (PR #48 R1-m1):** the fake-server test pins the volatile set by value, and the S1 to S4, Cache-Control, refusal-shape and unknown-caller cases by exact strings. The real-app S1 to S4 controls pin `runRow` over the contract app. The code review ran 32 mutants (29 killed; R10 and A3 survive, R17 equivalent), which confirms that the foreign block, the volatile set, the body comparison and the ETag rule are each load-bearing.

### 5.2 PR48-SEC-03: subpath and lint (probe C2)

| Form (production path) | Result |
|---|---|
| Named import, namespace import, `import type`, `export *`, `export * as`, named re-export (`packages/shared`), worker, web route | `no-restricted-imports` + `boundaries/dependencies`, oracle message |
| `import('@platform/authz/matrix')`, ``import(`@platform/authz/matrix`)``, CommonJS `require`, package-internal `./generator/matrix.js` re-export | `boundaries/dependencies` (oracle message) |
| `import(s)` with `const s = '…'`, `import('@platform/authz/' + 'matrix')` | `platform/static-module-specifier` |
| `require(...)` in `.ts`; `import o = require(...)` | `@typescript-eslint/no-require-imports` + boundaries (and `no-restricted-imports` for `import =`) |
| `createRequire(import.meta.url)('@platform/authz/matrix')` | `static-module-specifier` + boundaries |
| Relative `.js` / `.ts` path into `packages/authz/src/generator` | `import-x/no-relative-packages` + boundaries |
| `prisma/seed` static import, a non-test file inside `generator/` | `no-restricted-imports` |
| `@platform/authz/matrix/` | `no-restricted-imports`, `no-unresolved`, boundaries |
| `prisma/seed`: `import()` with a literal or a computed specifier; `tools/authz`: `import()` (the reviewer's flag (b)) | clean (accepted, see below) |
| Controls: `tests/generated/rbac` and a generator unit test import the oracle | clean |
| Controls: Supertest from production, and from `tests/generated/rbac` | `no-restricted-imports` (the test exception keeps every other pattern) |
| L1 to L4 laundering | clean: **PR60-SEC-01** |

`entry.test.ts` checks that `@platform/authz` exports none of the 22 oracle values, by name and by value identity, and pins the manifest's `./matrix` entry. The only importers of the subpath are `tests/generated/rbac` and the lint probes (`git grep` at `1353e78`).

**Ruling on flag (b): accepted, no finding.** The oracle confinement exists so that a production *request* authorisation decision never uses the oracle. `prisma/seed` writes reference data and `tools/` is build and test tooling, and neither decides a request. A dynamic import there cannot make the matrix confirm itself. The static form is refused anyway. The boundaries arm's `from` could add `'prisma-seed'` with no cost when TASK-283 edits the policies. That is optional.

A package `imports` alias (`#oracle`) needs a `package.json` edit (CODEOWNERS `**/package.json`), and its target must be a bare specifier. The lint resolver (`unrs-resolver`, `@platform/source` condition) sends that to `src/generator`, which the resolved arm refuses (by reasoning, not probed). The flat-config order holds: the `TEST_FILES` block comes before the hasher, Supertest and S3 exceptions, so those files keep the oracle pattern, and no other block re-declares `no-restricted-imports` for test files.

### 5.3 PR48-SEC-05, PR48-SEC-08, R1-m4, D-TASK289-09

- **Item 1 (route reached): closed.** `runOrgCase` first sends the caller with its own organisation to the authorisation app and requires 204 with `x-rbac-matrix: authorised` (`runner.ts:273-276`). The fixture proof names an unmounted target, and the fake server names a route that refuses every `orgId`.
- **Item 3 (a): closed.** `PATH_PARAMETER` matches `:name` and `{name}` anywhere in a segment (`org-scope.ts`), and the unit rows cover `.json`, `.csv`, `x:orgId`, `from-:to` and `orgIdentifier` (not matched). The regex is linear and runs on route paths only. An Express 5 `*name` wildcard is not enumerated (code review R1-n5). Contract-bound routes come from `{name}` paths, so none can be mounted today.
- **Items 2 and 3 (b): TASK-060.** The sheet line says to compare with `principal.orgId` only, never with a membership list, and gives the R-03 build rule. Both are as routed in D-SEC-PR48-01.
- **PR48-SEC-08: closed.** A unit test requires every `ROUTE_AUTHS` kind except `anonymous` to be presented by some caller, and the API test equates that set with the still-stubbed list. Code review R1-n1: for `signature` the check is satisfied by the `signature-header` callers, which never apply to a signature route (mutant G5). The column pins cover it today. I agree with R1-n1's stronger form (a caller that presents the kind AND applies to a route declaring it), at the next touch.
- **R1-m4 (deadline):** `OBSERVE_DEADLINE_MS = 30_000`. A spy on `AbortSignal.timeout` records one 30 s call per request, which pins both the magnitude and its use (D-SEC-PR53-02). A hang, a reset and a failing reference each produce one named problem. Error text carries the operation, caller id and transport cause, never a credential: the credentials are synthetic labels.
- **D-TASK289-09:** verified by reading; residual PR60-SEC-03.
- **Truth in labelling (R1-m2):** the test titles and JSDoc now say what the matrix proves and that `authorise.test.ts` proves the credential and actor gates.

### 5.4 Matrix regeneration: no cell changed

The base matrix has 133 rows and 37 columns (4 metadata, 33 callers); the head adds 3 columns. All 4,921 base cells are identical, and row and column order are unchanged. The 399 new cells: on non-signature routes 90 `Y` and 300 `401`, each equal to that row's `none` cell; on the 3 signature routes, 9 `-`. Outside the table, the description paragraph and the footer (`133 operations x 36 callers.`) changed. Controls: a flipped existing cell (`getShipment x OPERATOR_SUPER_ADMIN` `MFA` → `Y`) and a wrong new cell (`listCountries x signature-header:x-carrier-signature` `401`) are each named. The fast-lane drift test proves the document equals the generator output.

### 5.5 `packages/authz` production entry

`src/index.ts` loses the generator exports. `package.json` gains the `./matrix` entry. The generator gains `CREDENTIAL_HEADER_NAMES` from `@platform/shared` (a declared dependency) and the `signature-header` caller. No production module imports the generator, so production authorisation behaviour is unchanged. The oracle subpath is resolvable in the runtime image (`dist/generator` kept): PR60-SEC-05.

### 5.6 The code reviewer's security flags (rulings)

| Flag | Ruling |
|---|---|
| (a) `./matrix` is not a `./testing` subpath: the oracle ships in the images and the preflight imports it | Confirmed. **PR60-SEC-05 (INFO)**, TASK-283: `SKIPPED_EXPORTS` gains `./matrix` (pruned, not imported), or the subpath is renamed `./testing`. Not a defect of this PR: the card named it |
| (b) `prisma/seed/**` and `tools/**` are outside the boundaries arm; `import()` there is not refused | Confirmed by probe (3 cases clean, static control refused). **Accepted, no finding** (§5.2): neither decides a request; optional `'prisma-seed'` in the arm |
| (c) `x-csrf-token` and `x-reauth-proof` are never presented as foreign headers | Confirmed. Folded into **PR60-SEC-02 (INFO)** with R1-m1: a totality test with an owned exclusion list (TASK-048, TASK-187) |
| R1-m1 suffix derivation | Same gap, **PR60-SEC-02**. R1-m1's one assertion is the fix I would take if a fix push happens |

## 6. Earlier items

| Item | Status |
|---|---|
| PR48-SEC-01 (LOW) | **Closed** (§5.1); new INFO PR60-SEC-02 and -04 |
| PR48-SEC-02 (LOW) CODEOWNERS for `tests/generated/rbac/` and the matrix document | Open: the `rbac-matrix` activation PR (qa-lead; `min_tests` from that PR's own run, D-TASK289 follow-up) |
| PR48-SEC-03 (LOW) | **Closed** for every direct form (§5.2); residual PR60-SEC-01 (LOW) and PR60-SEC-05 (INFO) |
| PR48-SEC-04 (LOW) | Open: TASK-091 |
| PR48-SEC-05 (INFO) | Items 1 and 3 (a) **closed**; items 2 and 3 (b) TASK-060 |
| PR48-SEC-06 (INFO) | Labelling done; seam retirement stays with TASK-052/055/091/171/261/067 and TASK-041 (sheet lines present) |
| PR48-SEC-07 (INFO) | Open: with the first `API_CASES` entry |
| PR48-SEC-08 (INFO) | **Closed** (§5.3), with code review R1-n1 |
| PR53-SEC-05 (INFO), D-ARCH-136 | Open on TASK-283; its boundaries arm is also the PR60-SEC-01 fix |
| PR #48 code review R1-m1, R1-m2, R1-m4, R1-n1, R1-n2, R1-n3 | Closed per the PR #60 code review r1 (§6 of that record) |

## 7. Sequencing and unions

- **TASK-060 and TASK-052 merge prerequisites (D-ARCH-137)** are met by this PR once it merges: PR48-SEC-01 and PR48-SEC-03 are closed. PR60-SEC-01 has the same due point as PR48-SEC-03: before TASK-060 merges. TASK-283 carries the arm, and the task map has no TASK-283 → TASK-060 edge.
- **TASK-283** (lint lock, D-ARCH-136) also takes PR60-SEC-05 and the `test`/`__tests__` prune, and gets the laundering fixture of PR60-SEC-01 item 2. If TASK-283 starts after this PR merges, its `eslint.config.mjs` edit meets this PR's oracle policy. The new arm goes after it, both stay last, and neither re-opens the other.
- **Union with `main`:** since the merge base, `main` changed `.github/workflows/ci.yml`, `tools/ci/**` and docs only. None is a path this PR changes, so a `main` merge does not void this record. `eslint.config.mjs` and `packages/authz/**` are the overlap triggers for any PR merging before #60: a change to either on `main` that this PR also touches needs a merge-only round.
- **security-integration** was not selected in run 44035635054 because the record was missing. It is due on the record-push run and must succeed (D-ARCH-021).

## 8. Proposed decision (for the orchestrator to log)

- **D-SEC-PR60-01 · 2026-11-17 · security-analyst · PR #60 (TASK-289) security review r1 @df31b32**
  - **PASS_WITH_FOLLOW-UPS** (0 C/H/M, 1 LOW, 4 INFO).
  - PR48-SEC-01, PR48-SEC-08 and PR48-SEC-05 items 1 and 3 (a) are closed.
  - PR48-SEC-03 is closed for every direct import form (22 probed).
  - The regenerated matrix changes no existing cell (4,921 compared; the 399 new cells equal `none` or `-`).
  - **PR60-SEC-01 (LOW):** a `test/` or `__tests__/` helper inside a production source tree may import the oracle, and production may import it; both folders ship in the image. Fix: the D-ARCH-136 (b) boundaries arm (application and package code imports no `test`-category file; 0 hits in the tree today), a laundering fixture, and `prune-dist`/preflight naming `test` and `__tests__`. Owner TASK-283, due before TASK-060 merges. Add the TASK-283 → TASK-060 edge, or this PR takes the arm and the fixture in a fix cycle.
  - **PR60-SEC-02 (INFO, = code review R1-m1 and flag (c)):** a totality test over `CREDENTIAL_HEADER_NAMES` with an owned exclusion list (`x-csrf-token` → TASK-048, `x-reauth-proof` → TASK-187).
  - **PR60-SEC-03 (INFO, = R1-n3):** TASK-052's tripwire also proves that a retired kind's seam-format credential is refused.
  - **PR60-SEC-04 (INFO):** TASK-052 and TASK-055 add combined-credential rows (declared plus foreign equals declared alone).
  - **PR60-SEC-05 (INFO, = flag (a)):** TASK-283 brings `./matrix` under the `./testing` convention (`SKIPPED_EXPORTS` and the prune, or a rename).
  - **Flag (b) accepted:** a seed or tooling `import()` of the oracle decides no request.
- **Reversibility:** High.

## 9. Record validation

A simulation with `main`'s `tools/ci/check-security-owned-paths.mjs` (`--base` = `main` at `f81e56a`, PR 60, `--json`). The scenario commits are plumbing commits on top of `89c24d8` in the main repository's object store; no ref moved. They were checked out one by one in a sparse `git clone --shared` (`.github/`, `docs/05-quality/security/`, `tools/ci/`), because the checker reads records from the work tree. The record text is this file with LF line ends; it has exactly one `Head` row and one `Verdict` row.

| Scenario | Result | Expected |
|---|---|---|
| S0 no record (the code review commit `89c24d8` only) | `missing` ("no record named …PR-0060-*.md") | missing |
| S1 this record on top of `89c24d8` | `pass` | pass |
| S2 the same record with a `FAIL` verdict | `missing` ("verdict FAIL is not one of …") | missing |
| S3 S1, then an `eslint.config.mjs` edit | `missing` ("names df31b32, but eslint.config.mjs changed after it") | missing |
| S4 a record whose head row names the merge base `c2b74c1` | `missing` ("its head row names no commit of this PR") | missing |
| S5 S1, then an unowned docs edit | `pass` | pass |
| S6 S1, then a clean merge of `main` (`f81e56a`) | `pass` | pass |

## 10. Verdict

| Field | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium, 1 LOW (PR60-SEC-01), 4 INFO (PR60-SEC-02 to -05) |
| Follow-ups | PR60-SEC-01: TASK-283 (or this PR), before TASK-060 merges. PR60-SEC-02: R1-m1's assertion at the next generator touch; columns with TASK-048/TASK-187. PR60-SEC-03: TASK-052. PR60-SEC-04: TASK-052/TASK-055. PR60-SEC-05: TASK-283. Still open from PR #48: PR48-SEC-02 (activation PR), -04 (TASK-091), -06 (seam tasks), -07 (first `API_CASES` entry) |
| Verdict | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding. PR48-SEC-01, -03 (direct forms), -05 items 1 and 3 (a) and -08 are closed; PR60-SEC-01 (LOW) is due before TASK-060 merges. |

---

# Delta round 2 (fix cycle 1 and the merge of `main`)

| Field | Value |
|---|---|
| Head | c912a0af7b7321eea09a528062c3ecafa950b2c7 |
| Range | `df31b32..c912a0a`. First-parent commits: <ul><li>`89c24d8`: code review r1, docs.</li><li>`cb3bf8d`: this record, round 1.</li><li>`b66f450`: fix cycle 1. Tests, JSDoc and one exported constant: R1-m1 (= PR60-SEC-02), R1-n1, R1-n2, R1-n4, R1-n5, R1-n6.</li><li>`f2a7411`: merge of `main` at `d173d8f`. This brings PR #56 (`27f0189`) and PR #59 (`29318c3`).</li><li>`c912a0a`: lane B evidence only.</li></ul>The code head is `f2a7411`. This round names `c912a0a`, the pushed head; only this record follows it. The PR's merge base is now `d173d8f`, the `RANGE_BASE` of run 44093161786. `main` is `80dce9e`. Its changes since `d173d8f` (PR #57 `7db21b7`, plus docs) touch none of the PR's 46 net paths, and `git merge-tree` with it is clean |
| Lane A evidence | Run 44093161786 on `c912a0a` (`pull_request`, stage-2 `ci.yml`, tested base `732ad20`). **fast-lane `success`**: the lane B evidence check, commitlint, lint, the porcelain check, actionlint, type-check, unit, the negative lint fixtures from the base ref, and the Semgrep rule self-test. **ci-gate**: Gitleaks and Semgrep are `success`. The only red step is the record check: "names df31b32, but eslint.config.mjs, packages/authz/src/generator/entry.test.ts, … changed after it". Both fix cycle 1 and `main`'s `eslint.config.mjs` hunk void the round 1 Head row. security-integration was skipped because the record step failed. It is due on the record-push run and must succeed (D-ARCH-021) |
| Lane B evidence | `20261117T1247Z_f2a7411` PASS: profile `pr`, `git_dirty` false, `build_clean` true, and the lockfile SHA-256 equals the head's `package-lock.json`. Results: api 173, catalog-c1-c14 102, integration 331, rls-cross-tenant 126, unit 6,763 (2 skipped), 0 failures. Merged coverage: lines 99.06 %, branches 97.09 %. The unit JUnit holds the new cases: the PR60-SEC-02 totality test, the R1-n1 PR48-SEC-08 test, the R1-n5 wildcard test, the R1-n2 and R1-n4 fake-server tests, and the two `[PR48-SEC-03] allowed fixture` cases. `rbac-matrix` is still `planned`, so `rbac-matrix.api.test.ts` (the D-ARCH-134 test change) runs in the merged-coverage step of the `generated` project, where a failure fails lane B |
| Reviewer / date | security-analyst, round 2, 2026-11-17. Read-only. <ul><li>Git object reads ran in the main checkout.</li><li>The lint probes ran `ESLint#lintText` with the head's real `eslint.config.mjs` from the PR worktree. The worktree was clean at `c912a0a`, and nothing was written there.</li><li>The mutation probe imported the worktree's real generator sources read-only, through a resolve/load hook that applied each mutation in memory.</li><li>No install, Jest, Docker or GitHub write.</li></ul>This section was written outside the repository for the orchestrator to commit |

## R2.1 Summary

- **PR60-SEC-02 (INFO): closed.**
  - `UNPRESENTED_CREDENTIAL_HEADERS` (`matrix.ts`) names the two proof headers with their owners: `x-csrf-token` → TASK-048 and `x-reauth-proof` → TASK-187. The list is pinned by value.
  - The new test requires every `CREDENTIAL_HEADER_NAMES` entry to be presented by some caller or to be on that list. It also pins the non-signature partition by value.
  - A provider header without the `-signature` suffix now fails the build until it gets a column or an owned exclusion.
  - My mutation probe (§R2.2) kills all nine mutants.
- **The other fix-cycle items** are test and JSDoc changes. They strengthen the matrix and weaken nothing:
  - R1-n1: PR48-SEC-08 in its strong form. The code review's mutant G5 is now a control.
  - R1-n2: the join of repeated `Set-Cookie` headers is pinned.
  - R1-n4: `instance` is compared (D-TASK289-13).
  - R1-n5: SEC-TC-01 enumerates Express 5 `*name` wildcards.
  - R1-n6: the oracle's positive fixtures are named under `-t PR48-SEC-03`.
- **The merge of `main` is a pure union.**
  - `git merge-tree --write-tree b66f450 d173d8f` gives `6d1f1cb`, which is the tree of `f2a7411`, and the remerge diff is empty.
  - Only one path changed on both sides: `eslint.config.mjs`. This PR added the oracle policy, and PR #56 added the `api-pipeline-composition` category.
  - The oracle policy is still last. All 22 import forms from round 1 are still refused, and so are 6 new forms from the files PR #56 changed (§R2.3).
- **No cell changed.** The delta does not touch `rbac-route-matrix.md` or `openapi.yaml`, and the drift test ran green in fast-lane.
- **PR60-SEC-01 (LOW) is unchanged.** L1–L4 are still lint-clean on the merged config. Its owner and due point stand: TASK-283, before TASK-060 merges. PR60-SEC-03, -04 and -05 are unchanged.

New findings: none.

**Verdict: PASS_WITH_FOLLOW-UPS.**

## R2.2 PR60-SEC-02: verification

**Read.**
- `UNPRESENTED_CREDENTIAL_HEADERS` in `matrix.ts` is frozen and exported through `@platform/authz/matrix` only. `entry.test.ts` adds it to the oracle names that `@platform/authz` must not export (23 now).
- The test's `KIND_HEADER` (session → `authorization`, refresh-cookie → `cookie`, quote-token → `x-quote-token`) equals the stub's `READERS` (`packages/shared/src/http/credentials.ts`). It also equals the wire headers of `callerHeaders` (`tests/generated/rbac/matrix-app.ts`).
- In round 1 I suggested computing the set from `callerHeaders`. The test uses a model instead, because a package cannot import `tests/`. The declared cells of the API matrix tie that model to the wire: a caller whose header `READERS` does not read could not produce its `Y` cells.

**Mutation probe.** It evaluates the test's three assertions and the neighbouring pins over the worktree's real `matrix.ts`, `roles.ts`, `routes.ts` and `credentials.ts`, with one in-memory mutation per child process.

| Mutant | Killed by |
|---|---|
| M0: no mutation | (all pass) |
| M1: `x-hub-signature-256` added to `CREDENTIAL_HEADER_NAMES` | the totality check (which names it) and the partition pin |
| M2: `paypal-transmission-sig` added | totality, partition pin |
| M3: `x-api-key` added (a header no kind reads) | totality, partition pin |
| M4: `x-github-signature` added (with the suffix) | It gets its own foreign column. The signature-name pin and the caller count (37) fail |
| M5: `constructor` added | Totality passes, because the `in` operator sees `Object.prototype`. The partition pin fails, so there is no gap |
| M6: `x-quote-token` silently added to the exclusion list | the exclusion pin |
| M7: the CSRF exclusion removed | the exclusion pin, totality |
| M8: no `signature-header` callers | totality (it names the 3 signature headers), caller count |
| M9: the credential callers present nothing | totality (`cookie`, `x-quote-token`), the R1-n1 test |

The proof-header columns (the second half of PR60-SEC-02) stay with TASK-048 and TASK-187. The code now names those owners next to the list that forces the columns.

## R2.3 Other fix-cycle items and the merge

| Item | Check | Result |
|---|---|---|
| R1-n1, PR48-SEC-08 strong form | `matrix.test.ts` requires each non-anonymous `ROUTE_AUTHS` kind to be presented by a caller that `appliesTo` a route declaring it. Mutant G5 (no synthetic signatures) is a control that must fail. `rbac-matrix.api.test.ts` uses the same form over `contractMatrix.rows` | Strengthens the check. It also catches my probe's M9 |
| R1-n4, `instance` compared | `instanceOf(req.originalUrl)` drops the query and caps the length (`problem.ts:34-38`). `runRow` observes the `none` reference and every cell on the same `target`, so the member is equal unless a credential changes it. `VOLATILE_PROBLEM_MEMBERS` is now `['correlation_id']`, pinned. The org case still drops `instance`, because its paths differ by design (`runner.ts:286-290`) | The volatile set is strictly narrower. This closes the "H3 changed `instance`" residual of r1 §5.1 |
| R1-n2, repeated `Set-Cookie` | The join (`runner.ts:160`) is now pinned by a fake-server case that puts a clearing cookie before the reference one | Test only |
| R1-n5, Express 5 wildcards | `PATH_PARAMETER` now also matches `*name` wildcards. It is linear and runs on route paths only, never on request input. Over-matching only adds SEC-TC-01 cases, which is fail-safe | Closes the r1 §5.3 note on `*name` |
| R1-n6 | Two named positive fixtures | Test only |
| Merge purity | <ul><li>`merge-tree` equals the commit tree, and the remerge diff is empty.</li><li>The merge's path set (`d173d8f..f2a7411`) equals the PR's net change (`c2b74c1..b66f450`).</li><li>Every path except `eslint.config.mjs` has `b66f450`'s blob.</li><li>Each side's `eslint.config.mjs` change is line-identical to that side's own diff: this PR's 34 lines, and PR #56's category and policy.</li></ul> | Pure union |
| Oracle confinement on the merged config | Lint probe, 38 cases. <ul><li>P1–P22 behave as in round 1.</li><li>New M1–M6 are all refused with the oracle message: `routing/pipeline.ts`, which is now also `api-pipeline-composition` (static, relative `.js`, `import()`); a `tx/execute.ts` re-export; `audit/capture.ts` relative into the generator; `authorise.ts` `createRequire`. The category list accumulates, and the oracle policy stays last (`eslint.config.mjs:683`).</li><li>Controls M7 (`pipeline.ts` → `capture.ts`, allowed) and M8 (a non-allow-listed module → `capture.ts`, refused) show that PR #56's guard is intact.</li><li>C1–C4 behave as in round 1.</li></ul> | No regression. L1–L4 are still clean, so PR60-SEC-01 is unchanged |
| PR #56's `authorise` change | The matrix composes `authorise` = `authoriseSlot()`, with no capture. The decision path is shared with `authoriseSlot({ capture })`: `catalogueRefusal`, the public `permissionAuthenticated` gate, and the credential and actor gates. The capture only writes a PERMISSION_DENIED entry before the same 403, or answers the write failure. A matrix decision therefore holds for production. The audited-denial path belongs to PR #56 (`capture.api.test.ts`, `audit-failure.api.test.ts`) | No effect on what the matrix claims |
| Secrets and scans | Gitleaks and Semgrep `success` on the range (run 44093161786). The delta is tests, JSDoc and one exported constant | Clean |

**Routing note on PR56-SEC-12** (INFO; D-ORCH-123 gives its owner as "next PR touching `eslint.config.mjs`"):
- PR #60 does change `eslint.config.mjs`, but that edit predates this routing, and fix cycle 1 did not edit the file.
- PR56-SEC-12 is outside TASK-289's scope, so this PR does not take it.
- The next lint-lock holder that edits the audit composition policies should carry it; TASK-283 is the planned one. The orchestrator should record this.

## R2.4 Record check

**Simulation setup.**
- Checker: `main`'s `tools/ci/check-security-owned-paths.mjs` from the tested base `732ad20` (unchanged at `80dce9e`), run with `--pr 60 --json` and `--base d173d8f` unless the row says otherwise.
- Scenario commits are plumbing commits in a scratch `git clone --shared` of the main repository, so no object or ref was written to the repository. Each was checked out sparsely there (`.github/`, `docs/05-quality/security/`), because the checker reads records from the work tree.
- The record text is this file with LF line ends. It holds one round 2 `Head` row and ends with the round 2 `Verdict` row.
- `.github/CODEOWNERS` is the same at `d173d8f`, `c912a0a` and `80dce9e`, and 20 owned paths are changed.

| Scenario | Result | Expected |
|---|---|---|
| S0: the pushed head `c912a0a` with the round 1 record only | `missing`: "names df31b32, but eslint.config.mjs, … changed after it" (reproduces run 44093161786) | missing |
| S1: this record on top of `c912a0a` | `pass` (satisfied by `c912a0a`) | pass |
| S1b: S1 with `--base 80dce9e` (`main` now) | `pass` (`c912a0a`) | pass |
| S2: the round 2 Verdict row says FAIL | `missing` ("verdict FAIL is not one of …") | missing |
| S3: S1, then an owned edit (`generator/matrix.ts`) | `missing` ("names c912a0a, but packages/authz/src/generator/matrix.ts changed after it") | missing |
| S4: S1, then an unowned docs edit | `pass` | pass |
| S5: the round 2 Head row names `b66f450` (fix cycle 1, before the merge) | `missing` ("names b66f450, but eslint.config.mjs changed after it"): the merge brought `main`'s hunk of an owned path that this PR also changes | missing |
| S6: the round 2 Head row names `f2a7411` (the merge) | `pass` (`f2a7411`) | pass |
| S7: S1, then an edit to `tests/generated/rbac/runner.ts` | `pass`. The file is still unowned (PR48-SEC-02, activation PR) | pass |
| S8: S1 checked as PR 61 | `missing` ("no record named …PR-0061-*.md") | missing |
| S9: S1, then a clean merge of `main` `80dce9e` (`--base 80dce9e`) | `pass` (`c912a0a`) | pass |
| S10: S1, then an `eslint.config.mjs` edit | `missing` ("names c912a0a, but eslint.config.mjs changed after it") | missing |

**What voids this record.**
- Any later push to one of the 20 owned paths voids it.
- So does a merge of `main` that brings a change to one of them: today that means `eslint.config.mjs` or `packages/authz/**`, for example TASK-283 (the next `lint` lock holder) if it merged first. The open branches of PR #61 (TASK-028) and TASK-287A change none of the 20 paths.
- Docs and evidence commits do not void it. A merge of `main` at `80dce9e` does not void it either.

| Field | Value |
|---|---|
| Round 2 Critical / High / Medium / Low / Info | 0 / 0 / 0 / 0 / 0 new. Closed: PR60-SEC-02. Open: PR60-SEC-01 (LOW; TASK-283, before TASK-060 merges), PR60-SEC-03 (TASK-052), -04 (TASK-052, TASK-055), -05 (TASK-283). From PR #48: -02 (activation PR), -04 (TASK-091), -06, -07 |
| Verdict | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is open. PR60-SEC-02 is closed, and the merge of `main` is a pure union that weakens no closed item. From security, the PR may merge at this head |
