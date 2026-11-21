# Dispatch brief: TASK-045, cursor pagination, filtering and sorting (keyset, signed cursors)

- **Plan fold / dispatch plan:** D-SD-005 (2026-11-20), batch 1.3. The card section below is copied verbatim from `docs/04-plan/tasks/WAVE-01.md`. If they differ, the generated card governs.
- **Branch:** `feat/TASK-045-cursor-pagination-filtering-sorting`, worktree `../Shipqube-TASK-045`, from `origin/main` at `530629f4`.
- **Builder and model:** senior-developer (lead), solo, opus (card: backend-developer · sonnet, complexity M). Host load allows at most two build agents host-wide, so no specialist is dispatched; the card's escalation rule (opus from fix cycle 2) applies to any re-dispatch.
- **Why now:** TASK-045 is the non-DC enabler of US-097 (DC audit viewer list) and a dependency of TASK-073 (audit viewer API) on the path to the M0 demo, and of TASK-118 and TASK-183. Merges wait on CI minutes, so the run builds ahead to a committed head ready for code review, security review and lane B.
- **Dependencies:** TASK-036 (merged; the error catalogue already has `INVALID_CURSOR`, `INVALID_FILTER` and `INVALID_SORT`, and the api/README §11 rows exist).
- **Locks:** `api-pagination`. Beside it in flight: TASK-041 (working rule 7 files), TASK-040 part 040-A (PR #80: `apps/api/src/platform/idempotency/**`, `apps/api/src/platform/tx/execute.ts`), TASK-043 (outbox). This task touches none of their files.

## Read first

- US-037 Gherkin (`docs/01-requirements/stories/EPIC-16-api-conventions-security.md`, 10 scenarios) and its rows AT-US-037-01..10 in `docs/05-quality/tests/gherkin-test-map.md` (suite `api`, lane B).
- `docs/03-architecture/api/README.md` §4 (lists: `limit` 25/100, audit 50/200, never clamped; `INVALID_CURSOR` for tampered, expired or foreign cursors; HMAC-signed cursors bound to sort, filters and tenant; `filter[field]` deepObject with `additionalProperties: false`; any-of commas; `_from`/`_to` ranges; `sort=field,-field` from indexed fields; no totals unless documented) and §11 (the three list codes).
- `openapi.yaml` components `parameters/Limit` (1..100, default 25), `parameters/Cursor` (`maxLength: 512`), the `<Thing>List` schemas (`items`, `next_cursor`, `has_more`) and an example list operation (`listMembers`); `listAuditEntries` declares its own 1..200 `limit`.
- ADR-0016 item 5 and amendment 5 (d) (bounded reference lists may declare `x-max-limit` ≤ 300; tenant lists never may; D-041).
- ADR-0018 key register row `CURSOR_KEY` (HMAC-SHA-256, 30 d, dual verify 1 h); `packages/config` already has `CURSOR_KEY` and `CURSOR_KEY_PREVIOUS` (`schema.ts`, `keys.ts`). Do not add a key.
- Conventions: `apps/api/src/platform/routing/define-route.ts` (closed Joi schemas: no key patterns, no unknown keys), `apps/api/src/platform/validate/validate.ts`, `packages/audit/src/redaction/privacy.ts` (`auditKeyOf`: the local-only key derivation pattern), `tools/openapi/contract.ts` and `drift.ts`.
- data-model P4 (`timestamptz` is microsecond precision) and §3 access patterns (keyset keys `(sort cols, id)`, tenant indexes lead with `org_id`).

## Scope notes (lead)

- **Module.** `apps/api/src/platform/pagination/**`, self-contained, that later list routes adopt: `defineListSpec` (limit policy and ceiling, sort and filter allow-lists, `include_total`), `listQueryKeys` / `listQuerySchema` (closed Joi keys the route spreads into `schema.query`), `parseListQuery` (sort, filters, cursor), `prismaListArgs` (plain `findMany` arguments; the module imports nothing from Prisma) and `pageOf` (the response body). No route of its own (US-037: "shared list convention with no route of its own").
- **Unknown filter keys.** A closed query schema reports an unknown `filter[...]` key as `UNKNOWN_FIELD`; README §4 wants 400 `INVALID_FILTER`. Map it in the validate slot, only for list query schemas (they declare `limit` and `cursor`); a filter value outside its schema stays `VALIDATION_ERROR` with its pointer. Record the decision.
- **Cursors.** HMAC-SHA-256 under `CURSOR_KEY`, dual verify with `CURSOR_KEY_PREVIOUS`; the binding (operation, caller, canonical sort and filters) is recomputed per request rather than carried; every failure is the same `INVALID_CURSOR` with the catalogue detail; the lifetime is bounded by the dual-verify window. Fit `maxLength: 512`.
- **Exactness.** Sort columns such as `created_at` are `timestamptz(6)` while a JavaScript `Date` holds milliseconds: a value keyset built from what Prisma returns skips or repeats rows written within one millisecond. Choose a boundary mechanism that is exact at the database's precision and prove it on PostgreSQL 18 with microsecond-apart and equal timestamps.
- **Contract rules (AT-US-037-08/09).** A pure checker over the dereferenced contract (a list route without `limit`/`cursor` fails; `x-max-limit` on a non-public list fails naming the route), green on the real contract, with one seeded defect per rule.
- **Composition is out of scope here.** Building the codec from the configuration (`start-api.ts` → `createApp` → route context) touches TASK-041's locked files (working rule 7). The module takes the codec as a parameter; the first list route (TASK-073) or a follow-up after 041-A lands wires it. Name this in the report.
- **`packages/ui/src/components/Pagination/**`.** The card lists it, but no US-037 scenario covers it, `packages/ui` has no component tree yet, and TASK-038/TASK-046 are shaping `packages/ui` in this batch. Split it off as part B (first list screen) unless the orchestrator rules otherwise; record the decision.
- **No contract edit.** `listCountries` does not declare `x-max-limit` yet; the reference ceiling is built and tested on a fixture route, and the contract line goes to api-designer as a change request.

## Acceptance (IDs in test titles)

- AT-US-037-01 … AT-US-037-07 and AT-US-037-10 over HTTP (suite `api`, lane B): fixture list routes declared with `defineRoute` on the real `createApp` and pipeline, over an in-memory engine with the same boundary semantics; outline rows as `-1`, `-2`, … (AT-US-037-03-1..4, AT-US-037-04-1..2).
- AT-US-037-08 and AT-US-037-09: the contract checker on the real document and on seeded defects.
- AT-US-037-01, -02, -05, -10 on PostgreSQL 18 (suite `integration`, lane B): the Prisma arguments through `withTenantTx` as `platform_app`, against the database's own `ORDER BY`.

## Tests and evidence

- Unit: codec, declaration, query keys and parser, Prisma arguments and page, a whole-list walk, the validate mapping, the contract rules; coverage of new files at least 85 % line and 75 % branch.
- Host: ESLint (`--max-warnings 0`), Prettier, `npm run typecheck`, unit Jest of the touched workspaces (`--runInBand`). The `*.api.test.ts` and `*.int.test.ts` files compile and run only in lane B.

## `.env.example` lines this task may need

None: `CURSOR_KEY` and `CURSOR_KEY_PREVIOUS` are in the schema and the key register already.

## Working rules for this wave (apply to every brief of D-SD-005)

1. **Worktree and branch.** Work only in your own git worktree on the branch named above, created from the current `origin/main`. The main checkout is shared with other agents: never stash, reset or commit files you did not write, and never touch `.claude/agent-memory/**` of other agents.
2. **Node.** Every node or npm command starts with `export PATH="$APPDATA/fnm/aliases/default:$PATH";` (Node 24; Node 20 is rejected by `engine-strict`). Install with `npm ci --ignore-scripts`, then `npm run deps:rebuild`. Tools run through `npm exec --no --`, never `npx`.
3. **What you run on the host.** Lint, format check, typecheck, unit tests and the build of the workspaces you touch. Docker, Testcontainers, `quality:heavy` and the integration/api/catalog suites run only in the orchestrator's serial lane B queue (`../.orch/docker.lock`). Write the `*.int.test.ts` / `*.api.test.ts` files, make them compile, and ask the orchestrator for an **early lane B run on PostgreSQL 18** as soon as the migration and the first integration test exist. TASK-039 found a PostgreSQL 18-only failure (the C15 literal pin) on its first lane B run; finding such a failure on day 1 costs minutes, at review time it costs a fix cycle.
4. **Hand-written catalog literals.** Some catalog and manifest tests pin committed state as literals that a manifest change does not update. When you add a table:
   - `prisma/tests/catalog/c15-std-columns-guard.int.test.ts`: the `[SEC-TC-74] C15 (a) committed` test pins the sorted in-scope table list. If your manifest entry flags standard columns, extend that literal beside the manifest entry, with a comment naming your task, as TASK-037 and TASK-039 did.
   - `tools/db/grants-manifest.test.ts` pins counts of `prisma/sql/grants.manifest` lines: extend it together with the manifest.
   - `prisma/tests/catalog/tenant-keys.ts` and the C16 test, if the table carries an organisation key.
   - The classification registry, for every new column (catalog C10).
5. **api/README rows.** A new problem code goes into `docs/03-architecture/api/README.md` §11 and the error catalogue in the same PR: the parity test `tests/generated/error-catalogue.test.ts` compares both directions, and since TASK-292 it reads the §11 table too. A new security event goes into §13; SEC-TC-63 parses that table, so add a row and change no other cell. These code rows ride the PR (the D-API-003 pattern); api-designer acknowledges them at the next fold. Name each row you add in the PR body.
6. **`.env.example` is user-only.** Agents may not read or edit `.env*`. If you add a configuration key to `packages/config/src/schema.ts`, the parity test `tools/config/env-example-parity.test.ts` stays red until the user commits the placeholder line. Put the exact placeholder lines (key, placeholder value, one-line comment) in your Handoff Report under "`.env.example` lines needed". Prefer defaults in the schema, so that a missing line breaks only the parity test and not the run.
7. **Files owned by TASK-041 (in flight, slot 1).** Do not edit `apps/api/src/app.ts`, `apps/api/src/start-api.ts`, `apps/api/src/main.ts`, `apps/api/src/platform/routing/pipeline.ts`, `apps/api/src/platform/authz/authorise.ts`, `apps/api/src/platform/audit/capture.ts`, `apps/api/src/platform/rate-limit/**`, `packages/audit/src/network.ts`, `tests/generated/rbac/matrix-app.ts` or `eslint.config.mjs` (the `lint` lock). If you find you need one of them, stop and ask the orchestrator for the lock; do not work around it. `packages/config/src/schema.ts`, `packages/config/src/guards.ts`, `packages/shared/src/logging/security-event.ts`, `docs/03-architecture/api/README.md` §7 and `package-lock.json` also change on TASK-041. You may append to the first three if your card needs it. Merge `origin/main` again after part 041-A lands and resolve by keeping both sides.
8. **No new dependency** unless the card requires one. A lockfile change conflicts with TASK-041. If one is unavoidable, justify it in the report (licence against the allow-list, maintenance, size, alternatives) and regenerate the lockfile with `npm install --package-lock-only` after merging main.
9. **Diff coverage and entry points.** The lane A diff-coverage gate fails changed lines that no test executes. Keep entry files (`main.ts`) untouched and put logic in testable modules. Type-only files with no executable lines are fine.
10. **Security-owned paths** (CODEOWNERS: `prisma/**`, `tools/db/**`, `tools/ci/**`, `apps/api/src/platform/**`, every `package.json`, `stylelint.config.mjs`, `tools/stylelint-rules/**`, `tests/fixtures/lint/**`, …) need a security record. The orchestrator requests it; you list the owned paths you changed in the report.
11. **Commits.** Conventional Commits with a lower-case subject (commitlint), body lines under 100 characters, the task ID in the subject, and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never force-push. No secret-shaped literals in tests or fixtures: gitleaks scans the whole PR range on every push, and a committed false positive stays in the range.
12. **Tests carry their IDs.** Every acceptance test title starts with its ID (`[AT-US-xxx-nn]`, `[SEC-TC-nn]`). That is how `quality:trace` and `ac-trace.json` find them.
13. **Turn budget.** If you are about to run out of turns, commit the work in progress on the branch and report exactly what is done, what is not, and the next step. Do not stop silently.
14. **Handoff Report** (`docs/sdlc/templates/HANDOFF.md`): branch and head SHA, files changed, test evidence (commands and counts), developer decisions as `D-TASKxxx-nn`, the security-owned paths touched, the `.env.example` lines needed, and open questions.

## Card (generated by docs/04-plan/generator/gen.mjs, verbatim)

#### TASK-045 — Cursor pagination, filtering and sorting (keyset, signed cursors)

| Field | Value |
|---|---|
| Stories (completes) | US-037 (M0 Must) Cursor pagination, filtering and sorting |
| REQs | REQ-API-007, REQ-API-008 |
| NFRs | NFR-PERF-006 |
| Spikes / security / decisions | — |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-036 |
| Batch · locks | 1.3 · api-pagination |
| Branch | `feat/TASK-045-cursor-pagination-filtering-sorting` |
| Priority | Must |

> Scheduling note: Non-DC enabler of US-097 (DC audit viewer list).

**Files / modules**
- apps/api/src/platform/pagination/**
- packages/ui/src/components/Pagination/**

**Acceptance tests to write**
- All US-037 scenarios
- AT-US-037-01 … AT-US-037-10: all 10 scenarios of US-037, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`apps/api/src/platform/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
