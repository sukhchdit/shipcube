# Code review: PR #21, TASK-017 contract-first OpenAPI pipeline (round 1)

| Field | Value |
|---|---|
| PR | #21 `feat/TASK-017-contract-first-openapi-pipeline-redocly` |
| Head reviewed | `b0ede35d82329dc1ff4108953d853da9fcedc16c` (merge of `origin/main` `80ff2c2`) |
| Stories | US-034 (DC, M0 Must), US-035 (M0 Should, D-PLAN-004) |
| Reviewer | code-reviewer, 2026-11-13 |
| CI | Run 43338335195. `fast-lane` passed: lint, format, typecheck, unit (80 suites, 2157 tests, including `tools/openapi/{drift,types-drift,lint}.test.ts`) and build. `ci-gate` is red only on "Security-owned paths need a review record". |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The pipeline is solid and well tested. It covers the Redocly lint gate, generated types with an in-CI freshness
         check, the Ajv 2020 strict validator, the stub server and the docs UI, and the 17 example edits keep their meaning.
         One MAJOR blocks approval: the route walker fails open. It silently skips a handler mounted at a path with
         router.use('/x', fn), which contradicts its own "unresolved layers are reported" contract (proven by a probe).
         The fix is 3 lines and the suite stays green with it. There are also 7 MINORs and 7 NITs.
FINDINGS: 1 MAJOR, 7 MINOR, 7 NIT (table in section 3)
```

## 1. What I verified myself

The dispatch was memory-constrained: no `npm ci`, builds, Docker or full suites. I worked in a `git archive b0ede35` scratch copy with a `node_modules` junction to the PR worktree. The copy has been removed, and the worktree is clean with all 740 `node_modules` entries intact.

| Check | Result |
|---|---|
| `tools/openapi/drift.test.ts` (unit, single file) | 15/15 pass |
| `tests/api/contract-validation.api.test.ts` (api project, single file; lane A does not run `test:api`) | 8/8 pass |
| Mutation M1: drop the `not-in-ledger` push | 1 test fails (killed) |
| Mutation M2: neutralise the `sunset <= now` comparison | 1 test fails (killed) |
| Probe P1: normalised route-key collisions across all 133 operations; contract paths with `:` | none; none |
| Probe P1: `writeOnly` + `required` reachable from any response schema (false failures in the validator) | none |
| Probe P1: Ajv strict on a typo keyword (`minLenght`) / on the OAS 3.0 `nullable` | rejected / **accepted** (N3) |
| Probe P1: `GET /health/live/` (trailing slash; Express serves it with 200) | the validator reports "expected 404" (N4) |
| Probe P2: module router with `router.use('/webhooks/stripe', handler)` | **not listed, no finding** (R1-M1) |
| Probe P2: the candidate R1-M1 fix applied to the copy | drift suite still 15/15 |
| Probe P3: real HTTP over `createApp(... docs)` with `app.listen(0)` | `OPTIONS /health/live` gives 204 with `Allow: GET, HEAD, OPTIONS`. `OPTIONS /api/docs` gives 200 `text/plain` (N5). `POST` on a known path gives 405 with an `Allow` that omits OPTIONS (R1-m3). An undecodable param gives 400 problem |
| Probe P4: `api(app).options('/health/live')` through the PR's own helper; stub `resolveStub('OPTIONS', ...)` | helper **rejects** the app's 204 ("expected 405"); stub answers 405 (R1-m3) |
| 17 `openapi.yaml` example edits | Exactly 17 `+` lines, values only; no schema, path or extension line changed. Each marker meets its schema: 43-char `{43}` tokens, `csrf_token` minLength 32, `reauth_proof` minLength 20, `share_token` minLength 22 and the request pattern `{22,64}`. `share_token`, `share_path` and the share request `token` use the same marker. The old values are not quoted here. |
| `git merge-tree` with PR #20 head `dae1f96` | **3** conflicted files: `app.ts`, `main.ts` and `request-context.ts` (the PR body names two). PR #20 builds no `RequestContext` literals, so making `apiMode` required causes no semantic break there. |
| CI log | All openapi suites ran in lane A `test:unit`. |

**Not re-run (constraint):** `npm run lint`, `format:check`, `typecheck`, `build`, `test:integration`, `test:coverage`, the full `test:api`, and `serve.api.test.ts` / `runtime-seams.api.test.ts` / `contract-stubs.api.test.ts`. For these I rely on lane A run 43338335195 and the author's serial gate table (test:api 72, coverage 97.68 % / 97.06 %).

## 2. Focus-area rulings

1. **Drift ledger (`implemented-operations.json`).** The ledger cannot drift silently from the mounted set. `not-in-ledger` covers routes that are mounted and documented but missing from the ledger. `not-mounted` covers ledger entries that are not mounted. `unknown-ledger-entry` covers entries that are not in the document. So the ledger equals "mounted ∩ documented", enforced in both directions.
   - **What forces a new route to be listed:** both checks run on every `test:unit` (lane A).
   - **What does not hold:** "append-only" is a process rule, not a mechanism. Removing a route together with its ledger entry passes (N1; breaking-change detection is `oasdiff`, R1-m6).
   - **The real gap is the walker's input, not the ledger:** R1-M1 (path-mounted handler) and R1-m2 (mounts outside `api-mounts.ts`).
2. **`api-mounts.ts` loads apps/api by file URL.** Accepted as D-TASK017-01 (6) until TASK-020. The shapes are narrowed at the boundary and fail loudly. Cost: it re-states the composition of `createApp` (R1-m2), and boundaries lint cannot see the dependency. The cleaner `references` route belongs to TASK-020.
3. **Ajv strict vocabulary.** Correct. Only the four OAS-only keywords plus the `x-*` keys actually found in schema positions are declared, so a typo keyword still fails strict mode (probe). The in-house formats are linear and bounded, and an unknown `format` fails setup. Ajv's native `nullable` support is a residual blind spot (N3).
4. **`openapi:types --check`.** It is wired into CI through `types-drift.test.ts` in lane A `test:unit` (seen in the log). It is not part of `npm run lint`, which is acceptable: the unit lane is the CI gate. The `main(['--check'])` exit-1 path is untested (N6).
5. **`*.gen.ts` exclusions.**
   - The ESLint `globalIgnores` entry names one exact file: justified and scoped.
   - The coverage glob `!**/*.gen.ts` is repo-wide (N2).
   - Typecheck and `format:check` still cover the file.
6. **The two lint `files:` allowances.**
   - `tools/openapi/drift.test.ts` adding `express` through `packageDir`: fine.
   - `tests/api/**/*.api.test.ts` with `import-x/no-relative-packages: 'off'`: too wide (R1-m4). It repeats the pattern PR #5 R3-n1 removed from `prisma/tests/**`.
7. **`DOCS_ENABLED` exit 78.** Correct and scoped to `DocsSpecError`. The URL depth is right from both `src/` and `dist/`.
   - TASK-014 must ship `docs/03-architecture/api/openapi.yaml` at `<root>/docs/...`, relative to `apps/api/dist/main.js`. `compose.env` sets `DOCS_ENABLED=true`, so without the file the compose api exits 78 (merge-independent routed condition).
   - The default for staging is off, against the US-035 notes (N7).
8. **`apiMode` is `live` only in production.** Matches ADR-0016 §9 and REQ-API-020. Tests cover staging, local, test and production, plus the default.
9. **OPTIONS 204 + `Allow`.** Correct for health and module routes. It is not mirrored in the 405 `Allow`, in the PR's own validator or in the stubs (R1-m3), and the docs mount still gives Express's 200 `text/plain` (N5).
10. **The 17 example edits.** Meaning is preserved (section 1).
    - `access_token` is described as an "ES256 JWT" but the marker is not JWT-shaped. That is cosmetic and for api-designer (SHEET-FOLD-2 already tracks the confirmation).
    - The task sheet says contract edits go to api-designer. This one was routed by the orchestrator for PR10-SEC-08 and is logged in D-TASK017-01 (9) and STATUS SHEET-FOLD-2. **Ruling: accepted.**
11. **Test quality.** Good overall:
    - one seeded defect per drift rule;
    - real `createApp` and real HTTP for the docs;
    - a redaction sentinel;
    - real Redocly with exact warning counts.
    Weak spots:
    - the real-contract drift run pins `now` (R1-m1);
    - AT-US-035-01 proves the page and its assets at the HTTP level only, not that the page renders under the CSP (R1-m7);
    - `compileAll() > 133` is a loose bound.

## 3. Findings

| ID | Severity | File:line | Issue | Why it matters | Required fix |
|---|---|---|---|---|---|
| R1-M1 | **MAJOR** | `tools/openapi/drift.ts:122` | `if (!isRouter) continue;` skips every non-router layer, including a handler mounted at a path: `router.use('/webhooks/stripe', handler)`. This is a common pattern for raw-body webhook verification. Probe P2: the handler is not listed and produces no `undocumented-route` and no `unrecognised-route`. The comment's premise ("middleware serves no route of its own") is false for path-mounted handlers, and tools/openapi/README.md says the check fails on "a router layer the walker cannot resolve". | This is the core guard of US-034 AT-US-034-02-1 ("a mounted route missing from the document fails CI"), and it fails open. An undocumented endpoint can ship with a green drift check. | Report a non-router layer whose `slash !== true` as `unrecognised` ("middleware mounted under a path"), and add a fixture case to "reports router layers it cannot resolve". Verified on the copy: `if (!isRouter && layer.slash !== true) { out.push(unrecognised(prefix \|\| '/', 'middleware mounted under a path')); continue; }` keeps the suite 15/15, because the real tree has no such layer. Root-mounted middleware stays skipped by design; say so in the JSDoc. |
| R1-m1 | MINOR | `tools/openapi/drift.test.ts:50` (used by AT-US-034-01 at :86) | The real-contract drift run uses the fixed `now = 2026-11-13`. `sunset-passed` therefore can never fire on `main` for a real deprecated operation. README §1 item 3 requires the contract test to fail "if the sunset date has passed while the route is still mounted". | The rule is proven only on seeded data and is blind in practice. | Run the AT-US-034-01 assertion with the real clock (`drift({ at: new Date() })`). Keep the pinned dates for the seeded cases. |
| R1-m2 | MINOR | `tools/openapi/api-mounts.ts:37-58` | The mount list re-states `createApp`'s composition (health at the root, registry under `API_PREFIX`). Any router or route that `app.ts` mounts directly is outside the drift input. Examples: a future auth callback, or anything a merge with PR #20 adds. README §15 wants the real app stack walked, with explicit exclusions (`/api/docs/*`, `/metrics`). | The duplication can drift silently. Only `apiPrefix` equality is pinned. | Add a test that builds `createApp(...)` and asserts that its top-level `app.router.stack` holds only the expected middleware, the docs mount (an explicit exclusion) and the `routes` router. Or record this as a TASK-020 exit condition in D-TASK017-01. |
| R1-m3 | MINOR | `apps/api/src/platform/http/fallback.ts:95`; `tests/api/helpers/contract-validator.ts:334`; `tests/contract-stubs/stubs.ts:155` | The new OPTIONS behaviour (204 + `Allow` including OPTIONS) is not mirrored elsewhere. (a) The 405 `Allow` omits OPTIONS (P3: `GET, HEAD, DELETE`), although RFC 9110 §15.5.6 requires the methods the resource supports. (b) The PR's own `api(app).options(path)` rejects the app's 204 with "expected 405" (P4). (c) The stub server answers 405. | Three components disagree on one framework behaviour. Any API test that uses `client.options` fails falsely, and frontend work against the stubs sees a different answer. | Add OPTIONS to the 405 `Allow`. Teach the validator that OPTIONS on a known path is 204, no body, with `Allow` including OPTIONS, and do the same in the stubs. Add the behaviour to api/README §3 through api-designer (a one-line change request). |
| R1-m4 | MINOR | `eslint.config.mjs:531` | `import-x/no-relative-packages: 'off'` for `tests/api/**/*.api.test.ts` allows relative imports into **any** workspace's internals (`packages/*/src/...`), while the comment justifies only apps/api. PR #5 R3-n1 replaced the same tree-wide `'off'` on `prisma/tests/**` with an `ignore` regex (:548). | This is silent widening. The repo convention is "rule stays ON, ignore exactly the targets". | `['error', { ignore: ['^(?:\\.\\./)+apps/api/src/'] }]`, plus a negative fixture (or a probe in the security record) showing that a relative `packages/*/src` import still fails. |
| R1-m5 | MINOR | `tools/openapi/drift.ts:262` (`operationFindings`); `docs/sdlc/DECISIONS.md` D-TASK017-01 | Several README §15/§16/§17 items are neither delivered nor recorded as deferred with an owner: <br>• §15 rule 7: `x-requirements`, `x-milestone`, `x-moscow`. All 133 operations carry them today, so the check costs one line each.<br>• §16 "a lint rule forbids importing `supertest` anywhere else in API tests". Two PR tests use raw supertest.<br>• §16.6 the `(operationId,status)` contract-coverage report.<br>• §16.4 `expectEventStream`.<br>• §17 `client.ts`. | Deferrals that are not recorded get dropped (watchlist heuristic: "routed questions get dropped silently"). NFR-QUAL-004 says "100% of responses validate" and needs the supertest ban. | Implement the rule-7 check now. Append the rest to D-TASK017-01 with owners (TASK-020 for the supertest ban and coverage report; the SSE and typed-client tasks). |
| R1-m6 | MINOR | sheet TASK-017 NFRs; ADR-0016 §1 | NFR-MAINT-004 ("breaking changes against the last release are detected", `oasdiff`) is mapped to TASK-017, but this PR does not deliver it and no plan file mentions `oasdiff` (grep of `docs/04-plan`). | The NFR is unowned. There is no release tag yet, so nothing is broken today, but G3/G4 will look for it. | Record an owner and due point in D-TASK017-01 (the release/CI task before the first tag). |
| R1-m7 | MINOR | `apps/api/src/platform/openapi/serve.api.test.ts`; `serve.ts:41-51` | AT-US-035-01 says "Swagger UI **renders** the current document". The test proves HTML, assets and CSP headers over HTTP only. Whether the bundle actually renders under `script-src 'self'` / `default-src 'none'` is not shown. The bundle's `Function("return this")` fallbacks are short-circuited by `globalThis`/`self`, so it probably renders. | This acceptance test is HTTP-level only. | Add a minimal Playwright smoke test (page loads, `.swagger-ui .info .title` visible, no CSP violation) to the e2e harness (TASK-004 / T-QA), or record a manual check in the PR. |
| N1 | NIT | `tools/openapi/README.md:24`; `implemented-operations.json:2` | "Append-only" is not enforced. Removing a route together with its ledger entry passes. | Wording overclaims. | Reword as a process rule ("removal = breaking change, §18; caught by `oasdiff` once R1-m6 lands"). |
| N2 | NIT | `jest.config.ts:63` | `!**/*.gen.ts` is repo-wide; any future hand-written `*.gen.ts` escapes coverage. The ESLint ignore names the exact file. | Scope mismatch. | Use `'!packages/shared/src/api/types.gen.ts'`. |
| N3 | NIT | `tests/api/helpers/contract-validator.ts:203` | Ajv implements the OAS 3.0 `nullable` keyword natively, so strict mode accepts a stray `nullable: true` (probe). 3.1 semantics ignore it. | Validator and type generator could disagree with the 3.1 meaning. | Add `nullable` to an explicit deny-list in `scanSchemas`, or confirm that Redocly `struct` rejects it in 3.1 and note that. |
| N4 | NIT | `tests/api/helpers/path-match.ts:51` | A trailing slash (`/health/live/`) matches no template, so the validator demands 404 although Express (non-strict routing) serves 200. | It fails loudly (a false failure), not silently. | Strip one trailing `/` before matching, or document the behaviour. |
| N5 | NIT | `apps/api/src/app.ts:54` | `OPTIONS /api/docs` still gets Express's automatic 200 `text/plain` (P3), and `POST /api/docs` gets 404 rather than 405. | Inconsistent with the n9 closure; non-production only. | Mount the docs router inside `routes` (before the health router), or add `optionsResponder` to it. |
| N6 | NIT | `tools/openapi/types-drift.test.ts` | The CLI `--check` path (`main(['--check'])` gives exit 1 and prints `stale: <file>`) is not exercised. Only `checkGenerated` and the unknown-argument path are. | The AT-US-035-03 "fails listing the changed files" output contract is untested end to end. | Inject `specPath`/`outFile` into `main` (or spawn it) and assert exit 1 plus the stdout line. |
| N7 | NIT | `serve.ts:79` (initializer); `packages/config/src/schema.ts:224` (pre-existing) | (a) Swagger UI's default `validatorUrl` is `https://validator.swagger.io/validator`. On a non-localhost host the page tries to load an external badge carrying the spec URL. CSP `img-src 'self'` blocks it, leaving a console CSP error. (b) `DOCS_ENABLED` defaults to off in staging, but the US-035 notes and api/README §1 say "on in staging". | Privacy hygiene; story wording drift. | (a) Add `validatorUrl: null` to the initializer. (b) Route to the config owner and api-designer: either set staging in env (TASK-014) or fix the wording. |

## 4. Deviation rulings (D-TASK017-01)

| # | Deviation | Ruling |
|---|---|---|
| 1 | The validator lives in `tests/api/helpers/` instead of `apps/api/src/platform/openapi/response-validator.ts` | **Accepted.** This keeps Ajv out of the runtime closure. api-designer aligns the README §16 path. |
| 2 | Ledger instead of "every documented operation implemented" | **Accepted** for M0. 131 operations are not built yet, and both directions are enforced. Fix the wording (N1). |
| 3 | `x-error-codes` catalogue membership deferred to TASK-036 | **Accepted.** The validator already flags non-catalogue codes at run time. |
| 4 | `types.gen.ts` lint and coverage exclusion | **Accepted.** Narrow the coverage glob (N2). |
| 5 | Two lint allowances | The first is accepted. The second **needs R1-m4**. |
| 6 | Runtime load of apps/api by file URL | **Accepted** until TASK-020, with R1-m2. |
| 7 | Exit 78 on an unreadable contract | **Accepted.** Routed condition for TASK-014 (image path, see section 2.7). |
| 8 | `apiMode` `live` only in production | **Accepted** (ADR-0016 §9). |
| 9 | 17 example values | **Accepted.** Meaning is preserved. api-designer confirms the markers and the `provisioning_uri` / `next_cursor` items (SHEET-FOLD-2). |
| 10 | Opus instead of Sonnet | No review impact. |
| — | No new dependencies; MSW/Prism rejected for an in-house `node:http` stub | **Accepted.** Every tool used is already locked (redocly/cli, openapi-typescript, ajv, swagger-parser, swagger-ui-dist 5.34.1 Apache-2.0). |

## 5. Merge conditions

1. Fix R1-M1 and add its fixture case. A round-2 delta review checks that fix plus whatever MINORs are taken in-PR.
2. For each MINOR, either fix it in this PR or append it to D-TASK017-01 with an owner. Preferred in-PR: R1-m1, R1-m3 (the validator/stub/405 part), R1-m4 and the rule-7 part of R1-m5, all small.
3. Lane A's security-record step needs a security-analyst record that names a head at or after the fix commit. The PR touches `package.json`, `eslint.config.mjs`, `jest.config.ts`, `tsconfig.json` and `tests/*/tsconfig.json`.
4. Merge order with PR #20 (TASK-010): textual conflicts in **three** files (`app.ts`, `main.ts`, `request-context.ts`). Whoever merges second unions the `RequestContextOptions`, keeps both `RequestContext` members (`requestId` and `apiMode`) and re-runs typecheck, `test:unit` and `test:api` on the merge commit.
5. Routed, not blocking: TASK-014 ships `openapi.yaml` in the api image at `<app root>/docs/03-architecture/api/openapi.yaml` (compose sets `DOCS_ENABLED=true`, so without it the api exits 78). devops/security narrows the `.gitleaks.toml` OpenAPI allowlist to the `EXAMPLE_` markers (PR10-SEC-08).

## 6. GOOD (keep)

- A single contract loader (`tools/openapi/contract.ts`) shared by lint, drift, types, validator and stubs, so they cannot disagree on base paths.
- A drift walker that fails closed on arrays, RegExps, `all()`, optional/wildcard syntax, path-mounted routers and depth over 32, with an explicit `unrecognised-route` finding.
- In-house formats with length caps and linear regexes, and setup that fails on an unknown `format`.
- The redacted, capped failure excerpt with a sentinel test.
- A Redocly wrapper with telemetry and the update check off, a bounded run time and capped capture, and exact accepted-warning counts in the test.
- The docs router serves an asset allow-list only (no source maps, no OAuth redirect) with its own CSP, and reads its files once at start-up.
- `deprecationHeaderValues` validates RFC 3339 dates against real calendar dates (rejects `2026-02-30`), an https-only link and sunset after since, once at definition.
- The stub server is built from the examples at run time (nothing generated is committed), binds loopback by default, and the test validates every 2xx example against the same validator.

## 7. SECURITY-FLAGS (for security-analyst)

- **S1.** R1-M1 lets an undocumented endpoint ship with a green drift gate (A05 / CWE-1059 class: incomplete documentation of the attack surface).
- **S2.** `/api/docs` is public and unauthenticated by design. It serves the full contract and `openapi.yaml`, is on by default in local and test, is off in production unless `DOCS_ENABLED`, and uses CSP `style-src 'unsafe-inline'` on the docs page only. Confirm that the production default stays off and that staging exposure is intended (N7b).
- **S3.** The Swagger UI external validator badge (N7a) is blocked by CSP today. Set `validatorUrl: null`.
- **S4.** R1-m4: `no-relative-packages: 'off'` for `tests/api/**/*.api.test.ts`.
- **S5.** `api-mounts.ts` loads `apps/api` sources by computed file URL at test time. The dependency is invisible to boundaries lint; it is test-only.
- **S6.** PR10-SEC-08: the contract side is done (17 `EXAMPLE_` markers). The `.gitleaks.toml` allowlist is still value-unbounded. Two remaining secret-shaped examples (`provisioning_uri` `secret=` and `next_cursor` `eyJ…`) are left for api-designer.
- **S7.** The contract stub server takes its host from `CONTRACT_STUB_HOST` (it could bind 0.0.0.0). It is a dev tool that serves only documented examples.


## Round 2 (head b31483b)

| Field | Value |
|---|---|
| Head reviewed | `b31483b989827aeef29a97c17d5c0840f2b6163b`. Previous head `b0ede35`. Commits: `bf3d1f7` (merge of `origin/main` `d38500a`), then the fixes `97a21c8`, `58aa986`, `b1e2bb1`, `b31483b` |
| Fix-cycle comment | PR #21 issuecomment 6842037971 |
| Reviewer | code-reviewer, 2026-11-13 |
| CI | Lane A run 43351989787 on `b31483b`. `fast-lane` passed. `scans` failed only on "Security-owned paths need a review record" (Gitleaks and Semgrep passed). `ci-gate` failed only because of `scans`. |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R1-M1 is closed. A handler mounted under a path is now reported, and the walker covers the composed app with
         literal-only mount resolution. Mutants show that /api/:version and /*rest are rejected. Every round-1 MINOR is
         either fixed with tests that kill a mutant or routed with an owner (D-ORCH-023). The merge bf3d1f7 is a pure
         union. No lockfile delta. One new MINOR: array and optional-group mounts on a literal mount path still hide
         their extra paths. Merge with PR #20 needs a one-line move (section R2.5).
FINDINGS: 0 BLOCKER, 0 MAJOR, 1 MINOR, 4 NIT
```

### R2.1 What I verified myself

This round was memory-constrained: no `npm ci`, build, Docker, integration or e2e. I used a `git archive b31483b` scratch copy with a `node_modules` junction to the main checkout. The lockfile is identical (Express 5.3.0, router 2.2.0, path-to-regexp 8.4.2). The copy has been removed. The PR worktree is still clean at `b31483b`, and main's `node_modules` still has 740 entries.

| Check | Result |
|---|---|
| `tools/openapi/{drift,contract,types-drift}.test.ts` (unit) | 26/26 pass. types-drift showed one false failure in the copy until `.prettierrc` was extracted. |
| API project, run serially: `serve`, `problem-handler`, `contract-validation`, `contract-stubs`, `runtime-seams` `*.api.test.ts` | 5 suites, 80/80 pass (matches the author's `test:api` 80) |
| Mutant: drop the R1-M1 `unrecognised` push | killed (1 test) |
| Mutant: drop the segment-swap check (any match counts as literal) | killed (1 test) |
| Mutant: drop the `/api/docs` exclusion | killed (6 tests) |
| Mutant: drop `missing-traceability` (rule 7) | killed (1 test) |
| Mutant: drop `layer.path !== relative` | **survives** (R2-n2) |
| Mutant: 405 `Allow` back to `allowed.join(', ')` | killed (3 tests) |
| Mutant: validator no longer requires OPTIONS in a 405 `Allow` | killed (1 test) |
| Walker probe: 13 mount shapes on the composed stack | Correct: `/api/:version`, `/*rest`, a path handler and a path sub-app are reported. The literal `/api/v1` is resolved and `/api/docs` is excluded. **Not reported:** `['/api/v1','/hidden']`, `/api/v1{/:x}`, `/api{/:v}/v1`, `/api/v1{*rest}`, and a sub-app at the root (R2-m1). Real HTTP shows `/api/v1/anything/secret` and `/api/zzz/v1/secret` returning 200. |
| Candidate R2-m1 fix applied in the copy | All 6 shapes are reported and `drift.test.ts` stays 18/18 |
| Lint probe (PR config, `lintText`) on `tests/api/*.api.test.ts` | Relative `apps/api/src` import: clean. Relative `packages/shared/src` import: `import-x/no-relative-packages`. `../../apps/api/src/../../../packages/shared/src/index.js`: **clean** (R2-n1) |
| Probe of PR #20 head `9647907`'s composition under the new walker | `routes.use(API_PREFIX, routePrefix(API_PREFIX), api)` is now `unrecognised-route` (R2.5) |

**Not re-run (constraint):** `lint`, `format:check`, `typecheck`, `build`, `test:coverage`, the full `test:unit`, `test:integration`, `openapi:lint` and the CI checkers. For these I rely on lane A run 43351989787 (fast-lane green: lint, typecheck, unit, base-ref negative fixtures, build) and on the author's serial gate table: coverage 97.70 % / 97.10 %, integration 185 passing, `openapi:types --check` fresh.

### R2.2 Focus rulings

1. **R1-M1: closed.**
   - `drift.ts:177-181`: a non-router layer with `slash !== true` becomes `unrecognised-route`, with the handler name.
   - Root middleware is still skipped. `drift.ts:172-176` and the JSDoc at :192-197 say so, as does tools/openapi/README.
   - The composed-app walk (`api-mounts.ts`) builds the real `createApp` with docs enabled and walks `app.router` from the top, with `mountPaths` = [`API_PREFIX`, `DOCS_PATH`] and `excluded` = [`DOCS_PATH`].
   - A path-mounted router resolves only when the layer matches the candidate, `layer.path` equals it, and no single-segment probe variant matches. That rejects `/api/:version` and `/*rest` (tested and mutant-killed).
   - Module routers sit under the `/api/v1` prefix, so no mount path can resolve below it. Every path-mounted layer inside a module fails closed.
   - R1-m2 is closed by the same change: a route or router mounted directly on the app is now seen (the "sees a route mounted directly on an app" test).
   - What remains is R2-m1. It is confined to layers that match one of the two literal mount paths, which means only `app.ts` and the root-mounted health router.
2. **R1-m3: closed.**
   - `fallback.ts:70-72` `allowHeader()` is the single point used by both the OPTIONS 204 and the 405.
   - The validator has a `validateOptionsResponse` branch (204, no body, `Allow` including OPTIONS) and requires OPTIONS in a 405 `Allow`.
   - The stubs return a `kind: 'options'` resolution and the server answers 204 + `Allow`. `contract-stubs.api.test.ts` checks this live and passes the response through the validator.
   - N5: the docs mount now sits inside `routes`, so `OPTIONS /api/docs` gives 204 and `POST` gives a 405 problem.
   - The story text is not blocking: D-063 has already amended AT-US-007-02 and REQ-PLAT-010.
3. **R1-m4 / N2: closed, with R2-n1.**
   - `eslint.config.mjs:543` keeps the rule ON with `ignore: ['^(?:\\.\\./)+apps/api/src/']`, scoped to `tests/api/**/*.api.test.ts`.
   - The positive and negative repository probes are in `lint-fixtures.mjs` and `negative-fixtures.test.ts`.
   - The regex has no end anchor, so a `..` traversal after `apps/api/src/` passes (R2-n1). This is a NIT: the import has to be deliberately obfuscated, and the result is still stricter than round 1's `'off'`.
   - `jest.config.ts:66` excludes exactly `packages/shared/src/api/types.gen.ts`.
4. **Merge `bf3d1f7`: a pure union.**
   - Re-merging `b0ede35` with `d38500a` through `git merge-tree` conflicts only in `eslint.config.mjs` and `package.json`. `git diff <tree> bf3d1f7` touches only those two files, and the only change is that the markers are removed with both sides kept:
     - ESLint: the TASK-017 `tools/openapi/drift.test.ts` and `tests/api/**` blocks plus main's TASK-004 `apps/{web,admin}/app/routes.ts` block.
     - `package.json`: both `openapi:*` scripts plus main's `npm run typegen && …` `lint` (main's line, without `--allow-empty-input`).
   - `jest.config.ts` and `tools/repo/root-scripts.test.ts` are byte-identical to git's automatic merge. `SWC_JEST_OPTIONS` with `swcrc: false` is kept, there is no committed `.swcrc`, and the `unit-dom` project is kept.
   - Partition proof:
     - files of `d38500a..b31483b` = files of `80ff2c2..b0ede35` ∪ files of `bf3d1f7..b31483b`, with nothing extra and nothing missing;
     - `git rev-list --merges` shows a single merge commit.
   - Nothing from PR #17, #18, #19 or #4 is reverted.
5. **Lockfile:** `git diff d38500a b31483b -- package-lock.json` is empty. The `package.json` delta against main is the two `openapi:*` scripts only.

### R2.3 Round-1 closure

| R1 item | Status | Evidence |
|---|---|---|
| R1-M1 | **Closed** | `drift.ts:177-181`; fixture `stripeWebhook` (5 unrecognised); mutant killed |
| R1-m1 | Closed | AT-US-034-01 uses `drift({ at: new Date() })`. The seeded cases stay pinned. |
| R1-m2 | Closed | Composed-app walk (`api-mounts.ts:51-78`) plus 3 tests |
| R1-m3 | Closed | (a)(b)(c) as in R2.2 item 2. The api/README §3 line is routed to api-designer (D-ORCH-023). |
| R1-m4 | Closed (R2-n1) | `eslint.config.mjs:543` plus 2 repository probes |
| R1-m5 | Rule 7 closed in this PR (`missing-traceability`, 7 seeded cases, mutant killed). The remainder is routed. | D-ORCH-023 (1) |
| R1-m6 | Routed: TASK-015, due before the `v0.1.0-m0` tag | D-ORCH-023 (1) |
| R1-m7 | Routed: TASK-022 (Playwright smoke under CSP, including BaseLayout) | D-ORCH-023 (1) |
| N1 | Closed | README and ledger `$comment`: "process rule, not a mechanism" |
| N2 | Closed | `jest.config.ts:66` |
| N3 | Closed | `scanSchemas` collects `nullable` and validator setup throws |
| N4 | Closed | `path-match.ts:53` strips one trailing `/` |
| N5 | Closed | Docs inside `routes`; `serve.api.test.ts` "[PR #21 N5]" |
| N6 | Closed | `main(argv, files, output)`; stale gives exit 1 and prints exactly `stale: …` |
| N7 | (a) closed (`validatorUrl: null`). (b) routed to PM + api-designer. | `serve.ts:101`; D-ORCH-023 |

### R2.4 Findings

| ID | Severity | File:line | Issue | Why it matters | Required fix |
|---|---|---|---|---|---|
| R2-m1 | MINOR | `tools/openapi/drift.ts:137-149` (`resolveMountPath`), `:172-176`; `tools/openapi/README.md:19-21` | Literal resolution only proves that the layer matches the literal path and no single-segment *substitution*. Three cases slip through:<br>• An **array** mount (`use(['/api/v1','/hidden'], r)`; router 2.x keeps one matcher per path in `layer.matchers`) resolves as `/api/v1`, and `/hidden/...` is never walked.<br>• **Optional groups** (`/api/v1{/:x}`, `/api{/:v}/v1`, `/api/v1{*rest}`) also resolve as `/api/v1`. Real HTTP serves `/api/v1/anything/secret` and `/api/zzz/v1/secret` with 200.<br>• A **sub-app at the root** (`use(express())`, which Express wraps as `mounted_app`) is skipped as "root middleware".<br>The README says "arrays … and optional/wildcard paths" are reported. That holds for route layers, not for mounts. | This is the same fail-open class as R1-M1, now confined to the composition root (`app.ts`) and the health router. Every module-level path mount fails closed. An alias mount (`['/api/v1', '/v1']`) is a plausible future edit and would expose every operation under an undocumented prefix while the drift check stays green. | In `resolveMountPath`, `continue` unless `Array.isArray(layer.matchers) && layer.matchers.length === 1`. Then require, in addition to the substitution check, that (i) no variant with `PROBE_SEGMENT` *inserted* between two segments matches, and (ii) `layerMatches(layer, relative + '/' + PROBE_SEGMENT)` leaves `layer.path === relative`. In `walk`, report a `slash` layer whose `layer.name === 'mounted_app'` as unrecognised ("Express sub-app"). I verified this on the copy: all 6 shapes are reported and `drift.test.ts` stays 18/18. Add those shapes to the "resolves … known literal path only" test. **In this PR (preferred, about 10 lines) or** as a D-TASK017-01 line owned by TASK-020. |
| R2-n1 | NIT | `eslint.config.mjs:543` | `^(?:\.\./)+apps/api/src/` has no end anchor, so `../../apps/api/src/../../../packages/shared/src/index.js` lints clean (probe). The PR #5 `prisma/tests` pattern at :572 anchors with `[^/]+$`. | An obfuscated traversal re-opens the allowance this cycle narrowed. | `'^(?:\\.\\./)+apps/api/src/(?!(?:.*/)?\\.\\.(?:/|$))'` (verified against 6 strings), plus a third repository probe for the traversal form. |
| R2-n2 | NIT | `tools/openapi/drift.ts:141` | The `layer.path !== relative` condition is a surviving mutant. The substitution probe already rejects a prefix mount (`/api` vs `/api/v1`). | Dead condition, or an untested one. | Keep it, because it becomes load-bearing with the R2-m1 "consumed" check, and pin it with a `use('/api', inner)` case. Otherwise drop it. |
| R2-n3 | NIT | `apps/api/src/app.ts:6` | The header comment line is about 190 characters, unwrapped, and runs two sentences together. | Readability; Prettier does not reflow comments. | Reflow to the 120-column style used by the rest of the header. |
| R2-n4 | NIT | `docs/sdlc/DECISIONS.md:1399` (D-TASK017-01) | Item (2) still says "append-only ledger" and item (4) still says `!**/*.gen.ts`. Both are superseded by N1 and N2. | The decision record contradicts the code. | Orchestrator appends an amendment line: the exact `types.gen.ts` path, "add-only is a process rule", the composed-app walk, and the R2-m1 owner if it is routed. |

### R2.5 Merge with PR #20: a semantic conflict, not only a textual one

`git merge-tree b31483b 9647907` (PR #20 head) still conflicts in exactly `app.ts`, `main.ts` and `request-context.ts`. On top of that, PR #20 composes `routes.use(API_PREFIX, routePrefix(API_PREFIX), api)`, and `routePrefix` is a plain handler mounted under a path. Under this PR's R1-M1 fix the walker reports it (probe: `middleware "<anonymous>" mounted under a path`), so **AT-US-034-01 fails on the union** even if every textual conflict is resolved correctly.

The fix, for whichever PR merges second: `api.use(routePrefix(API_PREFIX))` as the first layer of the `api` router, then `routes.use(API_PREFIX, api)`. That gives the same `res.locals` before any module router, and the probe walks clean. Do not widen the walker to skip path-mounted middleware.

Also on the union:
- keep the docs mount inside `routes` after `optionsResponder`;
- keep both `RequestContext` members (`requestId` and `apiMode`);
- re-run `drift.test.ts`, `test:unit` and `test:api` on the merge commit.

### R2.6 Routing rulings (D-ORCH-023)

All routings are accepted.
- m5 remainder: the supertest ban and the coverage report to TASK-020, `expectEventStream` to TASK-044, `client.ts` to TASK-065. Each is the first consumer of its piece.
- m6 `oasdiff` to TASK-015, due before the `v0.1.0-m0` tag. Accepted, because the date sits before the first release the NFR protects.
- m7 to TASK-022 (CSP spike). Accepted. It must also cover the `BaseLayout` page, since the non-local layout changed in this cycle.
- PR21-SEC-03 / N7b to PM + api-designer.
- PR21-SEC-06 remainder to TASK-020 / TASK-048. Note for both: a limiter or CORS mounted under a path (`app.use('/api', limiter)`) now fails the drift check by design. Mount such middleware path-less inside the target router, as R2.5 does, or add an explicit, tested exclusion to `WalkOptions`.
- PR21-SEC-07(b) to TASK-010 (or TASK-020 if PR #20 merges first).
- api/README §3 OPTIONS line to api-designer.
- `openapi.yaml` in the image to TASK-014. Unchanged; compose still sets `DOCS_ENABLED=true`.

### R2.7 Merge conditions

1. A security-analyst delta record naming `b31483b` or later. Lane A's security-record step is the only red step; this cycle changed `eslint.config.mjs` and `jest.config.ts`.
2. R2-m1: fixed in this PR (preferred; the candidate is verified) **or** recorded in D-TASK017-01 with owner TASK-020. If it is fixed, a code-review delta check covers only `drift.ts` and its test. NITs R2-n1 to R2-n3 are optional in this PR; R2-n4 is the orchestrator's.
3. Merge order with PR #20: R2.5. The `routePrefix` move is required on the union commit.
4. Fast-lane green on the final head, then squash merge.

### R2.8 GOOD (keep)

- Literal-mount resolution by behaviour (the layer's own matcher plus probe variants) rather than by reading `layer.regexp`, which Express 5 no longer exposes reliably.
- The exclusion is tested as load-bearing: without it, `GET /api/docs` shows up.
- `allowHeader()` gives one revert point for the `Allow` parity, and the stubs and the validator mirror it with tests that kill mutants.
- Precomputed strong ETags, with a test proving the `etag` function is never called and that 304 has an empty body.
- The initializer is built with `JSON.stringify` from typed options, with no string concatenation of configuration.
- The `$ref` loader is offline-only, with a test that counts zero requests to a local server.
- The fix-cycle comment maps every finding to its proof, and the re-merge proof equates `+/-` lines across `d700eb5` and `bf3d1f7`.

### R2.9 SECURITY-FLAGS (for security-analyst)

- **S8.** R2-m1: array and optional-group mounts at `/api/v1`, and root sub-apps, can expose undocumented aliases with a green drift gate (the same class as S1).
- **S9.** R2-n1: the `no-relative-packages` ignore can be bypassed by traversal in `tests/api/*.api.test.ts` (test code only).
- **S10.** R2.5: the PR #20 union must move `routePrefix`, not exempt path-mounted middleware from the walker.
