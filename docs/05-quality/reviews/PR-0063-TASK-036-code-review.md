# Code review: PR #63, TASK-036 error catalogue and validation error format (round 1)

| Field | Value |
|---|---|
| PR | #63 `feat(errors): complete error catalogue and contract-wide error-code check (TASK-036)` |
| Branch / head | `feat/TASK-036-error-catalogue-validation-error-format` @ `fcdb7ac` (one commit on `80dce9e`) |
| Scope / records | TASK-036 card (WAVE-01) · US-036 AT-US-036-01..06 · REQ-API-005/006 · DR-A26 · api/README §11, §15 assertion 6 · D-TASK017-01 (3), D-ARCH-084 · D-TASK036-01..03 (accepted in D-ORCH-COORD-03 / D-ORCH-131, pending review) · ADR-0016 §3, ADR-0003, ADR-0026 |
| Reviewer | code-reviewer · 2026-11-18 · round 1 · **static review only** (host rule D-ORCH-131: lane-B queue running) |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The catalogue is complete and exact. I checked three sources: the DR-A26 list (45/45 codes and statuses),
         the api/README §11 table (79/79 codes and statuses) and the openapi.yaml shared problem examples (78/78 code,
         status, title and derived type; METHOD_NOT_ALLOWED is the declared framework-only exception). Assertion 6 now
         holds across the whole contract: 133 operations and 1,687 x-error-codes entries, 0 uncatalogued, 0 without a
         response. The AT-US-036 tests are meaningful and fail on mutation. There is no BLOCKER or MAJOR. Three MINORs:
         README §11 still describes an `api:check-errors` script and a README-table check that do not exist; the
         AT-US-036-04 scan only sees what the compiler already refuses (PR #65 already shows the gap); and the module half
         of assertion 6 checks only what each module declares. Seven NITs.
```

## 1. Verification I performed myself

Gates were not re-run (dispatch host rule: no test, typecheck, lint, build or Docker). Lane A run `44104641784` stopped at
the lane-B evidence step, so **lint, format, typecheck, unit and build are skipped in CI on this head**. For those I relied
on the developer's local claim in the PR body (lint, format:check, typecheck green; 6 affected suites 37/37). That is a
merge condition (§5), not a finding.

| # | Check | Result |
|---|---|---|
| V1 | `git diff origin/main...fcdb7ac --stat`, `git log` | 34 files, +1,467/−38. The code changes are in 13 catalogue files (12 new), `define-route.ts` (a type only), the module-registry generator and its output, the `tests/generated` route-metadata check and a new parity test, web/admin `error-messages.ts` and 6 locale files. The new tests are an `error-format.api.test.ts` and one case in `capture.api.test.ts`. No `openapi.yaml`, `app.ts`, `pipeline.ts`, `eslint.config.mjs` or workflow is touched. |
| V2 | DR-A26 (REQUIREMENTS.md:704) vs catalogue, code+status, awk extraction | 45 of 45 present with the same status (`comm -23` empty). |
| V3 | api/README §11 table vs catalogue, code+status | 79 = 79, `diff` empty. |
| V4 | `components/responses` problem examples vs catalogue, code+status+title (awk over openapi.yaml 15953-16918) | 78 examples. `diff` differs only by `METHOD_NOT_ALLOWED 405` (the declared `FRAMEWORK_ONLY_CODES`). Every example `type` = `https://docs.platform.invalid/problems/<code>` = `DEFAULT_PROBLEM_TYPE_BASE` + code. |
| V5 | Assertion 6 contract half, statically, over every operation (awk: per operation `x-error-codes` items vs the catalogue and the operation's `responses` keys) | 133 operations, 1,687 entries: **0 uncatalogued, 0 without a response for their status**. The new contract-wide `errorCodeProblems` loop is therefore green on today's document. Only `REASON_REQUIRED` (M2 mechanism) and `METHOD_NOT_ALLOWED` are never listed. |
| V6 | PUBLISHED pin vs catalogue | 45 DR-A26 + 34 Part B = 79 = catalogue key count. |
| V7 | Locales: `errors.*` key count per app/locale; es/fr web vs admin | 80 keys (79 + `UNKNOWN`) in all 6 files. The web and admin `errors` blocks are identical per locale. `INVALID_CREDENTIALS` is one identical message (no enumeration hint). |
| V8 | Browser safety of the first value import of `@platform/shared` into web/admin | The shared root index has no `node:` import and no logging re-export, so the SERVER_LOGGING guards hold. Vite and SSR resolve `@platform/source`, so no `dist` is needed in the web build. `@platform/shared` is already in the web dependencies. ESLint allows web/admin → shared root. |
| V9 | Layering | `index.generated.ts` → `platform/routing/define-route.js` is a type-only import from the `api-module` category, the same kind as its existing `../app.js` import. `tests/generated/*` → `apps/api/src/**` is within the anchored `no-relative-packages` ignore. `define-route.ts` is under no lock (D-ARCH-147: `api-routing` = `pipeline.ts` only). |
| V10 | Mutation reasoning on the new checks | Each of these would fail a test. Dropping `errorCodeProblems` from the all-operations loop fails the "mounted or not" seeded test (getShipment is not mounted). Dropping the `routeErrors` loop fails the composed seeded test (`toHaveLength(1)`). A status change fails `publishedDrift` (it names both values). A lost locale key fails the type-check (`Record<ErrorCode\|'UNKNOWN'>`) and the sorted-keys test. The scanner has a seeded `MY_NEW_ERROR` plus a `files.length > 50` non-vacuity guard, and 20 live `new AppError('…')` literals exist. |
| V11 | Other open PRs: `comm -12` of changed-file lists vs #61 `14cdeed`, #62 `1c4dc00`, #64 `90ef83f`, #65 `d3c2c16`, TASK-290 `ba921da` | **No textual overlap with any of them.** Semantic overlap is in §4. |

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `docs/03-architecture/api/README.md:298`, `:626`; `tests/generated/error-catalogue.test.ts` | D-TASK036-03 implements `api:check-errors` as a parity test, with no npm script. README §11 still says `npm run api:check-errors` "asserts that the set and statuses equal the examples under components/responses **and the table below**", that `api:sync-errors` regenerates both, and that the catalogue is `catalogue.ts` with a `source` field. README §16 step 2 still says the script "lands with TASK-036". The test has no README-table arm, so a §11 table edit (or a catalogue change that skips the table) goes unnoticed. The table is equal today (V3), so nothing is wrong yet. | In this task, add the cheap missing arm: parse the §11 table rows (`` ^\| `CODE` \| NNN ``) and compare the code+status set with `ERROR_CATALOGUE`, failing with the code named. Route a doc change request to api-designer to replace the script wording in §11 and §16 with the test path, drop `api:sync-errors`, and fix the file name and the `source` column. Log it with D-TASK036-03. |
| R1-m2 | MINOR | `tests/generated/error-catalogue.test.ts:78` (`APP_ERROR_LITERAL`) | AT-US-036-04 ("a service throws an error with code MY_NEW_ERROR … fails naming the code") is realised as a scan for `new AppError('<literal>')`. `AppError` already types its code as `ErrorCode`, so the scan adds coverage only for casts and JS. Domain error classes that carry a code are invisible to it. Example: PR #65 adds `OrganisationRuleError extends Error` with `'MEMBERSHIP_STATUS_NOT_WRITABLE'`, which is not a catalogue code, and this suite stays green after both merge. REQ-API-005 ("a test fails when a thrown error has no catalogue entry") is then defended only by whichever mapping code exists later. | Either (a) widen the scan to SCREAMING_SNAKE string literals passed to `new <Name>Error(` / `super(`, with an explicit allow-list for the README §11 "Codes that are not HTTP problem codes" namespaces (carrier, payment-failure, audit-reason, internal); or (b) record the limitation in DECISIONS with an owner and require domain error classes to type their code as `ErrorCode` (or a declared subset). Option (a) is preferred. Either way, tell the PR #65 reviewer (§4 item 2). |
| R1-m3 | MINOR | `tests/generated/route-metadata.ts:374-388`; `apps/api/src/platform/routing/define-route.ts:56` | The module half of assertion 6 checks that each module's **declared** `routeErrors` ⊆ the operation's `x-error-codes`. Nothing ties the declaration to what the module's services throw, or checks that the operationId belongs to the module that declares it (any implemented operation passes). No module mounts a route today, so the half is proven only on seeded data, which the PR states. | Not blocking. Name an owner in DECISIONS: the first module task that adds a `routes.ts`. Suggested hardening for that task: the codes thrown as literals under `apps/api/src/modules/<m>/**` ⊆ ∪ `<m>.routeErrors`, and each `routeErrors` key is an operationId mounted by `<m>`. |
| R1-n1 | NIT | `apps/api/src/platform/routing/define-route.ts:49` | The new `RouteErrors` JSDoc was inserted under the existing `/** The four request parts a route validates … */`. That comment is now orphaned above another doc block, and `RouteSchemas` lost its doc. | Move the old one-liner back above `export interface RouteSchemas`. |
| R1-n2 | NIT | `tests/generated/route-metadata.ts:451` | `routeErrors = {}` is an optional, fail-open default. A future caller that forgets it silently skips the module half (today the only real caller passes `moduleRouteErrors`). | Make `routeErrors` required in `MetadataInput` and pass `{}` explicitly in the seeded tests. |
| R1-n3 | NIT | `tests/generated/route-metadata.test.ts:17` | The `modules/index.generated.js` import sits between two `platform/routing` imports. No lint rule catches it, but it breaks the file's path order. | Move it above `platform/http/fallback.js`. |
| R1-n4 | NIT | `apps/{web,admin}/app/i18n/error-messages{,.test}.ts` | The web and admin files are byte-identical (blobs `61af52c`, `ab9fe05`). This follows the card ("apps/{web,admin} … map") and the existing duplicated `messages.ts`. | When TASK-042 replaces `messages.ts`, move the code→key function to `packages/ui` with the catalogue as a parameter (ADR-0026 am. 14). |
| R1-n5 | NIT | `apps/*/locales/*/common.json` (e.g. en `:42`, `:96`, `:105`) | The copy hard-codes the configured limits "15 minutes", "an hour" and "10 characters". If a limit changes, the message is wrong. | TASK-042 (ICU): take the wait from `Retry-After` and the limits from shared constants. |
| R1-n6 | NIT | `apps/api/src/platform/audit/capture.api.test.ts:498` | The gherkin map's primary suite for AT-US-036-06 is `rbac-matrix` (B+A*). The test lives in the `api` suite. `quality:trace` does not enforce the suite, so G3 still counts it. | None now. When the generated matrix gains named scenario tests, add the AT ID there too. |
| R1-n7 | NIT | `packages/shared/src/errors/catalogue.test.ts:174` | The PUBLISHED pin is in the same tree as the catalogue, so one PR can change a status and its pin together. The guard against that is social ("never edit an entry"). | Optional: compare against the base ref's catalogue (the no-weakening pattern) in a later hardening task. |

## 3. Deviation rulings

| Item | Ruling |
|---|---|
| D-TASK036-01 (Part B codes in per-module catalogue files created by this task) | **Accepted.** It follows the `audit.ts` precedent and PLAN §5 rule 2. `mergeCatalogues` refuses a duplicate code at load time. Each file says the owning module takes it over. |
| D-TASK036-02 (`routeErrors` as a module export collected by the generated registry; `app.ts` untouched) | **Accepted.** Fail-closed: a routes-bearing module without the export fails the type-check (named import in the generated file). It keeps the `api-platform-core` lock free. See R1-m3 for the limits. |
| D-TASK036-03 (`api:check-errors` realised as a parity test, no npm script) | **Accepted, provided R1-m1 is done.** The test must cover what README §11 says the check asserts, and the README must stop naming a script that does not exist. |
| Card path `apps/api/src/platform/validation/joi-to-problem.ts` not created | **Accepted.** The one Joi→problem mapper already exists in `platform/validate/validate.ts` (TASK-020). A second mapper would duplicate it. |
| Validation sub-code i18n (`INVALID_FORMAT`, `TOO_SHORT`, …) not mapped | Out of scope. It belongs to TASK-058 (REQ-UI-010 form kit). |

## 4. Cross-PR (P1) notes

1. **No textual overlap** with #61, #62, #64, #65 or TASK-290 (V11). The merge order is free with respect to this PR.
2. **PR #65 (TASK-037):**
   - It adds `apps/api/src/modules/organisations/index.ts` but no `routes.ts`, so the registry generator is not triggered. When a routes file lands (TASK-224/231), that module's `index.ts` must export `routeErrors` or the type-check fails. That is intended.
   - `ORGANISATION_RULE_CODES` includes `MEMBERSHIP_STATUS_NOT_WRITABLE`, which is not in this catalogue, and the type is a plain string union. Its comment relies on `ORG_TYPE_NOT_ALLOWED` / `ROLE_NOT_ALLOWED_FOR_ORG_TYPE` being catalogue codes, which is true only after #63 merges.
   - Recommendation for the #65 reviewer: after #63, type the HTTP-facing rule codes as `Extract<ErrorCode, …>`, and either catalogue `MEMBERSHIP_STATUS_NOT_WRITABLE` (a contract change request) or document it as internal-only (README §11 "not HTTP problem codes"). See R1-m2.
3. **PR #64 (TASK-035):** it adds `joi` to `@platform/shared` under the `./queues` subpath only; the root index is unchanged. With this PR, web/admin import the shared **root** at runtime for the first time, so a future re-export of `queues` from the root would put Joi into the browser bundle. Suggest a guard for the #64 reviewer or security, like SERVER_LOGGING_TARGETS: web/admin/ui must not import `@platform/shared/queues`, and the shared root must not re-export it.
4. **Any later PR that adds a catalogue code** must, in the same change: add the PUBLISHED pin, add the 6 locale entries (web and admin × en/es/fr), add the openapi shared example, and add the README §11 row (with R1-m1). The type-check and tests enforce all of these except the README row today.

## 5. Merge conditions

- Lane-B evidence on the final head with verdict PASS (the orchestrator's queue). The earlier `20261117T1412Z_fc14eab` FAIL was contention-suspect and is not evidence.
- A lane-A run on the final head where lint, format, typecheck, unit and build actually execute and pass. They were skipped on `44104641784`, and this review did not re-run them.
- A security-analyst record on the head (`apps/api/src/platform/**` is on the security path list).
- R1-m1 fixed (the README-table arm in the test, plus the README change request filed), or carried as a logged condition with an owner. R1-m2 and R1-m3 are logged in DECISIONS with owners if they are not fixed here. NITs are optional.

## 6. Good patterns worth keeping

- Parity tests that report each disagreement by name (`publishedDrift`, `catalogueParityProblems`), each with a seeded negative.
- `Record<ErrorCode | 'UNKNOWN', string>` makes a missing message a compile error, and the `errorMessageKey` guard uses `Object.hasOwn`, so `toString` and `__proto__` map to `UNKNOWN`.
- The PII check in AT-US-036-02 (no request value appears in the problem body). The brand-base check of the derived `type`.
- The generator change is fail-closed: a missing `routeErrors` export is a type error, not a silent skip.
