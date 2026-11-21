# Code review: TASK-045 cursor pagination, filtering and sorting (pre-push, round 1)

| Field | Value |
|---|---|
| Task | TASK-045 (US-037 M0 Must; REQ-API-007, REQ-API-008, NFR-PERF-006; AT-US-037-01..10); non-DC enabler of US-097, dependency of TASK-073 |
| Head | `b380f429` (3 commits on main `530629f4`: `d2a72698` validate slot INVALID_FILTER, `1c8cd622` pagination module, `b380f429` contract rules), branch `feat/TASK-045-cursor-pagination-filtering-sorting`; not pushed, no PR number yet |
| Reviewer | code-reviewer, 2026-11-21 |
| Bindings read | CLAUDE.md §8/§9; brief `docs/04-plan/briefs/TASK-045.md` and its card in `WAVE-01.md`; US-037 Gherkin (EPIC-16); `api/README.md` §4 and §11; `openapi.yaml` (`Limit`, `Cursor`, the `<Thing>List` schemas, every `sort` allow-list, the `filter` deepObjects of `listShipments`, `listOrders`, `listAuditEntries`); ADR-0016 item 5 and amendment 5 (d); ADR-0018 register row `CURSOR_KEY`; data-model P2, §3 access patterns (AP-ORG-07, AP-ORG-14, AP-ID-08, AP-AUD-01..10, AP-SHP-02) and the `audit_entries` table; `validate.ts`, `define-route.ts`, `tools/openapi/contract.ts` |
| Main delta since base | `530629f4..main` is docs only; `git merge-tree` of `main` and `b380f429` is clean |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A careful, well-tested module: the codec is sound (MAC first, constant time, dual verify, canonical MAC,
         uniform INVALID_CURSOR), Prisma 7's native cursor is exact at microseconds (proven here end to end), coverage
         100 % lines. One MAJOR: a cursor whose boundary row was deleted or became invisible answers 200 with
         items [] and has_more false, so a client silently loses the rest of the list (D-TASK045-03 as worded is not
         accepted). Six MINOR, four NIT.
```

Scope: every file is under the card's `apps/api/src/platform/pagination/**`, plus the validate slot mapping the brief asks for (D-TASK045-04) and the contract checker of AT-US-037-08/09. `packages/ui/src/components/Pagination/**` is split off (D-TASK045-01, ruled below). No locked file of TASK-041 is touched; no dependency, lockfile, configuration key or `.env.example` line is added. No scope creep.

## 1. What I verified myself

Host rules of the dispatch: foreground commands only, one at a time, nothing run in the PR worktree. Everything ran in a `git archive b380f429` extract in the session scratchpad, with `node_modules` junctioned to the PR worktree's (same SHA, so the `@platform/*` links resolve to identical sources), the git-ignored `prisma/generated` copied in, and the `tools` `tsBuildInfoFile` redirected inside the extract. The worktree stayed clean. No Docker: the `*.api.test.ts` and `*.int.test.ts` files are lane B evidence (merge conditions).

| Check | How | Result |
|---|---|---|
| Types | `tsc -b apps/api tools` (covers every new `.ts`, including the api and int tests and the contract checker) | Clean |
| Lint | `eslint --max-warnings 0` on the 18 changed files, repository config, type-aware; sanity probe (an injected `any`) reported 2 errors, so the run is effective | Clean |
| Format | `prettier --check` on the 18 changed files | Clean |
| Unit tests | `--selectProjects unit --testPathPatterns 'platform/pagination/\|platform/validate/validate.test\|tools/openapi/list-contract' --maxWorkers=2` | 6 suites, 89 tests pass |
| Coverage of new code | same run with `--coverage` on the changed sources | 100 % lines on every file; branches: pagination 97.5 %, `validate.ts` 95.7 %, `list-contract.ts` 91.3 % |
| Prisma 7 cursor precision (the developer's named risk) | Probe P1: the PR's `parseListQuery` → `prismaListArgs` → real generated client → `PrismaPg` → PGlite 0.4.3 wire server (PG 17), 12 memberships one microsecond apart, walk at `limit=3` | Exact: the walk equals the database's `ORDER BY created_at, id`. Prisma emits one statement whose boundary is `(SELECT created_at FROM memberships WHERE id = $n)` subqueries, so the comparison is at column precision. Risk cleared on PG 17; lane B proves PG 18 |
| Boundary row deleted between pages | Probe P1, case B: delete the last row of page 1, request page 2 with its cursor | `items: []`, `has_more: false`, `next_cursor: null`; 9 rows still after the boundary are never returned (R1-M1) |
| Boundary row's sort key changes between pages | Probe P1, case C: move the boundary row's `created_at` forward by one hour | All 8 unchanged rows after the boundary are skipped (R1-m1) |
| Timestamp filter precision | Probe P1, case D: `filter[created_at_from]=2026-11-21T12:00:00.123456Z` | Parsed as `...00.123Z`: the bound is silently rounded (R1-n2) |
| Cursor size bounds | Probe P2: `encode` with keys inside `validKeys` bounds | Two 200-character keys or one 120-character CJK key throw `cursor exceeds 512 characters` (R1-m5) |
| List classification on the real contract | Probe P2: every GET whose 200 body has an `items` array | 28 operations; only `getShipmentCustoms` (line items, deliberately) is not a list; no bare-array list body exists |
| Mutation testing | 12 mutants, each against the 6 targeted suites, files restored and compared byte for byte afterwards | 9 killed: org binding, expiry boundary, previous-key verify, boundary drop, `take`, validate mapping, reference-ceiling check, any-of canonical order, x-max-limit tenancy rule. 3 survived: removing `actorId`, `guestTokenHash` or `operationId` from the binding (R1-m4) |
| Mergeability | `git merge-tree --write-tree main b380f429` | Clean |

Not re-run: `pagination.api.test.ts` and `list-keyset.int.test.ts` (Docker or loopback, lane B), full `test:unit`, `npm run build` (no build input changes beyond `apps/api` sources, which `tsc -b` emitted).

## 2. Findings

| ID | Severity | File:line | Problem | Why it matters | Required fix |
|---|---|---|---|---|---|
| R1-M1 | MAJOR | `apps/api/src/platform/pagination/page.ts:36-43`, `prisma-args.ts:50-51`, `tests/memory-list.ts:58-59` | When the boundary row of a cursor no longer exists for the caller (hard-deleted, purged by a retention job, or invisible under RLS, e.g. a guest quote claimed into an organisation), Prisma's boundary subqueries return NULL, the statement returns no row, and `pageOf` answers 200 `{ items: [], has_more: false, next_cursor: null }`. Probe P1 case B: 9 rows after the deleted boundary are never returned. The memory engine encodes the same behaviour (`boundary === undefined` → `[]`) and no test covers it. | `has_more: false` is a completeness claim. Every list of the product inherits this convention; a list screen, an export or a sync client stops early with no signal, against AT-US-037-01 ("continues without overlap or gaps") and CLAUDE.md §9 (no silent failure). | After a cursor, a query that returned no row at all cannot be continued reliably (a cursor is only issued when a row beyond the page existed). Make `pageOf` throw `AppError('INVALID_CURSOR')` when `request.after !== undefined && rows.length === 0`, so the client restarts the list (README §4: a cursor that can no longer be honoured is "expired"). Mirror it in the memory engine, and add tests: unit (`pageOf` with a cursor and no rows), api (delete the boundary record between pages → 400 `INVALID_CURSOR`) and int (delete the boundary row on PostgreSQL → 400, beside the existing status-change case). Amend D-TASK045-03's text accordingly. An equivalent repository-side check (look the boundary row up by id and refuse when it is gone) is acceptable if it is built into the module's contract and tested the same way. |
| R1-m1 | MINOR | `prisma-args.ts:6-15`, `list-spec.ts:8-10`, `paging.test.ts:108-118` | The native cursor resumes from the boundary row's *current* sort values. When the boundary row's sort key changes between pages, every unchanged row between its old and new position is skipped (probe P1 case C: 8 of 8) or repeated. The contract already sorts on mutable columns: `last_used_at` (sessions, rewritten every 5 min), `label` and `updated_at` (address book), `updated_at` (shipments), `display_name`, `name`. The existing test renames a row of the first page, not the boundary row. | A value keyset loses only the moved row; this design loses unrelated rows. Consumers will choose sort fields from the contract without knowing the trade-off. | Document the rule in the module header and in D-TASK045-03: exact for immutable sort keys only. For mutable ones, pick one and pin it with a test: (a) carry the boundary's sort keys in the cursor (`keysOf`, which already exists) and answer `INVALID_CURSOR` when the boundary row's current keys differ; or (b) a declared `mutable: true` on the sort field with a recorded acceptance by principal-architect. Add the boundary-row case to `paging.test.ts`. |
| R1-m2 | MINOR | `prisma-args.ts:6-12`, `cursor.ts:37-38` | The first consumer, TASK-073, lists `audit_entries`: primary key `(occurred_at, id)`, partitioned monthly. `cursor: { id }` is not a unique input there, and an id-only boundary subquery could use neither the primary key (`id` is its second column) nor partition pruning. The module's answer is the `keys` path (sort values in the cursor, comparison in the consumer's own SQL), but nothing proves that path on PostgreSQL, and the module header does not say which tables need it. | The audit viewer is on the M0 demo path; TASK-073 would discover this at build time. | State in the module header and D-TASK045-03 that composite-key or partitioned tables use the `keys` path (carrying `occurred_at` as exact text, for example `occurred_at::text` or epoch microseconds, never a JavaScript `Date`). Route a line to the TASK-073 brief. A small int or unit proof of the `keys` round trip with microsecond text is welcome here, or required in TASK-073. |
| R1-m3 | MINOR | `list-query.ts:158-166`, `list-query.ts:65-67` | The binding covers the list filters and sort but not the route-specific keys that `listQueryKeys` invites the route to spread beside it (`q`, min 2 characters, on shipments, address book, HS codes and prohibited items). A cursor from `q=acme` continues a `q=zeta` walk. | README §4 binds a cursor to "the sort, the filters and the tenant"; `q` is a filter. Mixed walks return wrong pages without an error. | Bind the canonical form of every validated query key except `limit` and `cursor` (sorted keys, canonical values), or take an explicit `extraBinding` argument and document that every route-specific key must be in it. Add a test. |
| R1-m4 | MINOR | `list-query.test.ts:305-319` | The header and D-TASK045-02 bind the operation, the actor and the guest-token hash, but removing any one of them from the binding passes all 89 tests (3 surviving mutants); only the organisation, sort and filter members are pinned at the `parseListQuery` level. | A refactor can drop a binding member silently. With the native cursor and RLS the effect is contained, but the `keys` path (R1-m2) has no such backstop. | Add one `INVALID_CURSOR` assertion each for another `operationId`, another `actorId` in the same organisation, and another `guestTokenHash`. |
| R1-m5 | MINOR | `cursor.ts:63-65`, `cursor.ts:83-89`, `cursor.ts:143` | `validKeys` admits up to 8 keys of 256 UTF-16 units, but the 512-character cursor fits about 350 bytes of payload JSON. Two 200-character keys, or one 120-character CJK key (3 bytes per character in UTF-8), make `encode` throw (probe P2). | `encode` documents the throw as a programming error, but here it depends on row data: a list sorted by a long `label` or `display_name` answers 500 for some pages. | Bound the keys by their encoded size (`Buffer.byteLength(JSON.stringify(keys))` against a budget derived from `MAX_CURSOR_LENGTH`) in `validKeys`, and document that consumers carry only bounded keys (or a hash) of long text columns. Test with a CJK key. |
| R1-m6 | MINOR | `prisma-args.ts:21-27`, `list-keyset.int.test.ts:176` | `PrismaListArgs` is untyped against the model: every consumer must write `args as unknown as Prisma.XFindManyArgs`, and spec `column` names and filter value types are free strings. A typo in a `column` is a Prisma validation error at request time (500), not at load or compile time. | Every list route repeats an `as unknown as` cast that switches off the type checker on the query. | Make the column type a parameter (`defineListSpec<TColumn extends string>`, propagated to `ListRequest` and `PrismaListArgs`) so a repository binds it to its model's field names, or ship a test helper that checks each spec's columns against `Prisma.dmmf` for its model. Either keeps the module free of Prisma imports. |
| R1-n1 | NIT | `keyset.test.ts:4`, `paging.test.ts:5`, `pagination.api.test.ts:5`, `tests/memory-list.ts:6` | They cite `tests/api/list-keyset.int.test.ts`; the file is `apps/api/src/platform/pagination/list-keyset.int.test.ts`. | Stale pointer. | Fix the paths. |
| R1-n2 | NIT | `list-query.ts:60-61` | `Joi.date().iso()` rounds a sub-millisecond bound to milliseconds (probe P1 case D) and accepts a date-only value, while the contract's `Timestamp` is a date-time. | A range bound is silently moved by up to 999 µs. | Refuse more than three fraction digits and date-only values (an ISO pattern before `.iso()`), or document the rounding. |
| R1-n3 | NIT | `list-query.ts:146-150` | The reference ceiling on a non-public route is refused per request (500 on every call) rather than when the route is declared. | Any api test of the route catches it, so acceptable; earlier is better. | Optional: take the route tenancy in `defineListSpec` or check at mount when `define-route` is next open. |
| R1-n4 | NIT | `validate.ts:189-192`, `validate.ts:91-92` | `toIssues` caps each part at 50 issues before `hasUnknownFilter` reads them, so 50 earlier query issues hide an unknown filter key (VALIDATION_ERROR instead of INVALID_FILTER). | Edge case only. | Optional: test the unknown-filter condition on the full Joi details, before the cap. |

## 3. Rulings on the developer decisions

| Decision | Ruling |
|---|---|
| D-TASK045-01 UI `Pagination` component split to a part B | Accepted. No US-037 scenario covers it, `packages/ui` is being shaped by TASK-038/046 in this batch, and the API convention is complete without it. Condition: the orchestrator records the split in DECISIONS.md with an owner (the first list screen task) so the card's second file line is not lost. |
| D-TASK045-02 HMAC cursor, binding recomputed, 1 h lifetime | Accepted. Verified: MAC checked before parsing, constant-time, under the current then the previous key; canonical MAC encoding; exact payload shape; one uniform `INVALID_CURSOR`; the 1 h lifetime matches the register's dual-verify window, so a retired key never strands a live cursor. Pin the remaining binding members (R1-m4) and extend the binding to route keys (R1-m3). |
| D-TASK045-03 Prisma native cursor on `id`, boundary row dropped by id | Accepted as the mechanism: probe P1 proves it exact at microseconds and the drop-by-id is correct when the boundary no longer matches the filters. Not accepted as worded: "a hard-deleted boundary row ends the walk" is a silent truncation (R1-M1). The text must also state the mutable-key trade-off (R1-m1) and the composite-key/partitioned-table route (R1-m2). |
| D-TASK045-04 Unknown filter keys mapped to INVALID_FILTER in the validate slot | Accepted. The mapping is narrow (list schemas only, `UNKNOWN_FIELD` at a `filter` pointer only), cached per prepared schema, keeps VALIDATION_ERROR with the pointer for bad filter values, and changes no other route (no mounted route declares `limit` and `cursor` yet). `validate.ts` is under `apps/api/src/platform/**`: security record required. |
| D-TASK045-05 Ranges half-open (`_from` inclusive, `_to` exclusive) | Accepted as the semantics. The contract and README §4 do not state inclusivity: route a change request to api-designer for the README line and the `*_from`/`*_to` parameter descriptions. |
| D-TASK045-06 Contract rules in the unit suite | Accepted. Pure document checks belong in lane A beside the drift checks; the real contract has no finding and each rule has a seeded defect naming the route. |
| D-TASK045-07 Codec wiring into the app deferred (TASK-041 holds `app.ts`, `start-api.ts`, `pipeline.ts`) | Accepted. The module takes the codec as a parameter and has no route of its own, which US-037 allows. Condition: name the owner (TASK-073, or a follow-up after 041-A lands) in DECISIONS.md, so the first list route does not build its codec ad hoc; the codec must be built once from `CURSOR_KEY` and `CURSOR_KEY_PREVIOUS` in the composition root. |
| D-TASK045-08 Int test on a bare PG 18 container with a memberships-shaped table | Accepted for this module, which is table-agnostic. It does not exercise RLS: with the real schema the boundary subqueries run under the same policy, which is good isolation but is exactly the invisible-boundary case of R1-M1. Condition: the first real list route (TASK-073 or the members list) proves its walk on the migrated schema as `platform_app`. |
| D-TASK045-09 Reference ceiling refused on non-public routes | Accepted (killed mutant; contract rule `max-limit-not-reference` backs it). Earlier detection is optional (R1-n3). The `listCountries` `x-max-limit` line goes to api-designer as a change request, as the brief says. |

## 4. Merge conditions

1. R1-M1 fixed with the three tests named in the finding; re-review (round 2) on the new head.
2. R1-m1 to R1-m6 fixed, or each routed with an owner and a due task in the handoff (R1-m2 must reach the TASK-073 brief either way).
3. Lane B green on the head under review:
   - `apps/api/src/platform/pagination/pagination.api.test.ts` (AT-US-037-01, -02, -03-1..4, -04-1..2, -05, -06, -07, -10, plus the R1-M1 deleted-boundary case);
   - `apps/api/src/platform/pagination/list-keyset.int.test.ts` on PostgreSQL 18 (AT-US-037-01, -02, -05, -10, the status-change boundary case, plus the R1-M1 deleted-boundary case);
   - the generated suites and the `validate` api tests still green with the slot change.
4. Security record for the `apps/api/src/platform/**` changes (`pagination/**`, `validate/validate.ts`); security flags below.
5. DECISIONS.md entries for D-TASK045-01..09 with the conditions above; change requests to api-designer for D-TASK045-05 and the `listCountries` `x-max-limit` line.
6. Hosted CI (lane A, `security-integration` when the classifier selects it) green on the pushed head.

## 5. Good patterns worth keeping

- MAC-then-parse with constant-time comparison, a context-separated MAC input, canonical base64url and one uniform error: no oracle for forgery versus expiry versus foreign cursor.
- The binding is recomputed rather than carried, so the cursor holds nothing the caller has not already seen.
- Drop-by-id instead of `skip: 1`, with an int test for the boundary that stops matching the filter.
- `defineListSpec` validates the whole declaration at load and lists every problem; one declaration drives Joi keys, parser, Prisma arguments and page.
- The contract checker is pure, green on the real document, and every rule has a seeded defect asserting the exact route text.

## 6. Security flags (for security-analyst)

- R1-M1: invisible-boundary behaviour under RLS (a cursor whose boundary row the caller can no longer see) must fail closed with `INVALID_CURSOR`, not end the list.
- R1-m3 and R1-m4: binding completeness (route-specific keys; actor, guest-token hash and operation unpinned).
- The boundary subqueries filter by `id` only; on SYSTEM tables without RLS (the audit viewer) the module relies on the cursor being authentic and bound to the caller. Confirm with TASK-073's scope rules (`scope_org_id`, operator scope) and the `keys` path (R1-m2).
- Key handling: `cursorKeyBytes` uses deployed material as decoded and stretches `local-only-*` markers per key id; relies on the configuration guard for the 32-byte minimum and the placeholder refusal outside local/test.

---

# Round 2: delta review of fix cycle 1

| Field | Value |
|---|---|
| Head | `3168c194` (one commit on `b380f429`: `fix(api): task-045 fail-closed cursor boundary, column-safe filters, full binding`; D-TASK045-10..14 in its body); branch `feat/TASK-045-cursor-pagination-filtering-sorting`; not pushed |
| Delta | `b380f429..3168c194`: 18 files, +742 / -77, all inside the round-1 scope (`apps/api/src/platform/pagination/**`, `validate.ts` and its test, `tools/openapi/list-contract*`). No dependency, lockfile, configuration key or migration is added. The int test reads the released migration `20261112020000_platform_rls_helpers` but does not change it |
| Main | The merge base is still `530629f4`. `530629f4..main` changes nothing outside `docs/` and `.claude/`. `git merge-tree --write-tree main 3168c194` is clean |
| Inputs | Round 1 above; the security record `docs/05-quality/security/PR-pending-TASK-045-security-review.md` (PR045-SEC-01..07, C1..C5, F1..F5); D-SD-011 (TASK-045 and TASK-073 card lines); D-ORCH-149 (D-TASK045-01..09 accepted by reference) |
| Reviewer | code-reviewer, 2026-11-21 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R1-M1 is closed. After a cursor, a page query that returns no row is 400 INVALID_CURSOR, decided on the
         caller's own result. Unit, api and PostgreSQL 18 cases cover deleted and RLS-moved boundaries. R1-m3/m4/m5,
         n1, n2 and n4 are closed and every new guard is pinned (29 of 29 mutants killed). R1-m6 is partly closed and
         m1/m2/n3 are routed acceptably. Two new MINOR and three NIT. The merge is conditional on lane B and the
         security delta round on this head.
```

## R2.1 What I verified myself

Host rules of the dispatch: foreground commands only, one at a time, no Docker, nothing run in the PR worktree. Everything ran in a `git archive 3168c194` extract in the session scratchpad:
- `node_modules` was junctioned to the PR worktree's (read only; the worktree is at `3168c194`, so the `@platform/*` links resolve to identical sources);
- the git-ignored `prisma/generated` was copied in;
- the `tools` `tsBuildInfoFile` was redirected inside the extract.

`git status` of the worktree is clean afterwards.

| Check | How | Result |
|---|---|---|
| Types | `tsc -b apps/api tools` (covers every changed `.ts`, including the api test, the int test with its `defineListSpec<Prisma.MembershipScalarFieldEnum>` and the `@ts-expect-error` pin of R1-m6) | Clean |
| Lint | `eslint --max-warnings 0` on the 18 changed files, repository config, type-aware. Sanity probe: an `any` injected into `page.ts` gave 3 errors, so the run is effective | Clean |
| Format | `prettier --check` on the 18 changed files | Clean |
| Unit tests | `--selectProjects unit --testPathPatterns 'platform/pagination/\|platform/validate/validate.test\|tools/openapi/list-contract' --maxWorkers=2` | 6 suites, 119 tests pass (89 in round 1) |
| Coverage of the changed sources | Same run with `--coverage` | 100 % lines on every source file. Branches: `cursor.ts` 97.5 %, `list-query.ts` 95.7 %, `list-spec.ts` 98.8 %, `page.ts` 100 %, `validate.ts` 95.9 %, `list-contract.ts` 91.5 % |
| Mutation testing | 29 mutants of the delta, each run against the 6 suites; files restored and compared byte for byte (`cmp` against `git cat-file`). Mutants: the empty-page refusal; each binding member (actor, guest hash, operation, actor scope, credential, path parameters, route query keys, canonical key order, filter-key exclusion, `include_total` exclusion); the decode expiry cap and its skew; key text, key integer, key count, undeclared key kind, timestamp key text; key kinds at load; NUL; int4 range and its default; timestamp min, max, text check and fraction digits; min/max on a non-integer filter; INVALID_FILTER read before the cap; the `/audit/` path condition | 29 killed, 0 survived. The three round-1 survivors (actor, guest hash, operation) are now killed |
| Int-test setup, without Docker | PGlite 0.4.3 (PG 17.5). The int test's own `MEMBERSHIPS_DDL` list was parsed out of the file and applied statement by statement as the superuser, after `CREATE ROLE platform_app`: `CREATE SCHEMA platform`, the released helpers migration read through the same relative URL, `ENABLE ROW LEVEL SECURITY` and the policy. Then Prisma's boundary-subquery shape ran as `SET LOCAL ROLE platform_app` with `app.org_id` set | Every statement applies (the migration needs only the schema and `platform_app`, both created first). The table is owned by the superuser, `relforcerowsecurity = false`, so the superuser seeding and `truth()` bypass RLS as the file says. As `platform_app`: own org 6 rows, no org setting 0 rows. After the boundary: 4 rows while visible, **0 rows when the boundary is moved to another org**, 4 rows again when it is moved back. This is the PG 18 RLS case of the int test in miniature; lane B proves it on PG 18 |
| Integer default range against a `smallint` column | Real generated client → `PrismaPg` → PGlite socket server, table `invitations(send_count smallint)` (`Invitation.sendCount` is `@db.SmallInt`), `where: { sendCount: v }` | `32767` → 0 rows. **`40000` → P2020, SQLSTATE 22003 "value out of range for type smallint"**: the parameter is untyped (`= $1`), so PostgreSQL types it as the column (R2-m1) |
| Mergeability | `git merge-tree --write-tree main 3168c194`; `git merge-base --is-ancestor b380f429 3168c194` | Clean; fast-forward of round 1's head |

Not re-run: `pagination.api.test.ts` and `list-keyset.int.test.ts` (loopback and Docker: lane B), the full `test:unit`, `npm run build`.

## R2.2 Closure of the round-1 findings

| ID | Status | Evidence |
|---|---|---|
| R1-M1 (= PR045-SEC-02) | **Closed** | `page.ts:74` refuses `after !== undefined && rows.length === 0` with `AppError('INVALID_CURSOR')`, before the drop-by-id. The decision is taken on the page query's own result, so the caller's scope and RLS decide it, with one answer for every cause (no existence oracle). It is correct for both paths: on the native path, a cursor exists only if a row lay beyond the boundary, and a visible boundary that still matches the filters always comes back itself; on the keys path, an empty answer means every later row is gone. A boundary that came back alone still ends the list with 200 (pinned). Tests: unit `paging.test.ts` (no rows → the exact problem body; only the boundary → 200 end), the memory engine's visible-set rule (`memory-list.ts:58-62`, header updated) with a delete-then-restore walk, api (deleted boundary → 400 with the catalogue detail), int (deleted → 400, then a fresh walk equals the truth; moved to another org → 400; moved back → the same cursor continues exactly; a policy probe proves RLS is on for `platform_app`). The module headers (`page.ts`, `prisma-args.ts`) and D-TASK045-10 carry the text that round 1 asked to be amended |
| R1-m1 | **Routed, accepted** (R2.5) | The trade-off is stated in `prisma-args.ts:17-24` and D-TASK045-10. The boundary-row forward move is pinned (`paging.test.ts:132`: the walk resumes from the renamed row's new position). The choice between (a) and (b) goes to principal-architect |
| R1-m2 | **Routed, accepted** | `prisma-args.ts:25-28` names the keys path for composite-key or partitioned tables (exact timestamp text, never a JavaScript `Date`, the comparison in the consumer's scoped SQL). D-SD-011 put AUDIT LIST ON THE KEYS PATH on the TASK-073 card (R1-m2, the D-TASK045-08 condition, PR045-SEC-04, PR045-SEC-06). See R2-n2 for one line to add to it |
| R1-m3 (= PR045-SEC-03, part) | **Closed** | The binding now contains: the path parameters; every validated query key except `limit`, `cursor`, `sort`, `include_total` and the filter keys (which are bound canonically as terms); and the actor scope and credential kind (`list-query.ts:195-211`). Canonical form: top-level keys sorted, JSON values, dates as ISO text (pinned: key order and `...00Z` vs `...00.000Z` give the same binding). Over-binding a nested value's key order would only fail closed |
| R1-m4 (= PR045-SEC-03, part) | **Closed** | `list-query.test.ts` has one `INVALID_CURSOR` row per member (13 rows), and `limit` and `include_total` may change. The api test covers another actor, another `q` and no `q`. Mutants M02..M08 are killed |
| R1-m5 (= PR045-SEC-04) | **Closed** | Keys are now at most 4 tokens of at most 48 characters of `[0-9A-Za-z :.+_-]`, or safe integers (`cursor.ts:70-75`, `isKeyValue` at `:93`), checked at encode and decode. The worst case (4 × 48-character keys, a 64-character id, an 11-digit expiry) is pinned at `<= 512`, so `encode` can no longer fail because of row data. Sort fields declare `key` kinds (`timestamp`, `integer`, `uuid`; no free text, so no personal data in URLs), validated at load. `pageOf` checks `keysOf` against them (`page.ts:59-71`) |
| R1-m6 | **Partly closed, accepted** | `defineListSpec<TColumn>` types `column` and `idColumn`. A repository that passes `Prisma.<Model>ScalarFieldEnum` gets a compile error for a misspelt column (pinned with `@ts-expect-error`; the int test uses it). The `as unknown as Prisma.XFindManyArgs` cast at the call site stays, because `PrismaListArgs` is not model-typed. I accept that: the cast hides only the shape, which `prismaListArgs` builds and the int test proves, while the column names, which were the 500 risk, are now checked. The parameter is opt-in (R2-n3) |
| R1-n1 | **Closed** | The four citations now name `apps/api/src/platform/pagination/list-keyset.int.test.ts` |
| R1-n2 | **Closed** (folded into PR045-SEC-01) | `DATE_TIME_TEXT` requires seconds, at most 3 fraction digits and `Z` or an offset. Date-only values, minute-only values, offset-less values, sub-millisecond values, space separators and epoch numbers are 400 `INVALID_FORMAT` (`list-query.test.ts`, api row). The years are bounded to 0001..9999 |
| R1-n3 | **Module side routed, accepted** (R2.5) | The contract side of PR045-SEC-07 is done: the 200 cap needs the `audit` tag AND an `/audit/` path, pinned both ways (M21 killed); the real contract's audit lists are under `/audit/`. The refusal at the `define-route` declaration is routed |
| R1-n4 | **Closed** | `hasUnknownFilter` reads the full Joi error of the query before the 50-issue cap (`validate.ts:171-177`). It is pinned with 55 earlier issues (M20 killed). The pointer logic is shared through `issueOf`, so the two paths cannot drift |

PR045-SEC-01 (code side): closed. Strings refuse U+0000. Integers are bounded to int4 by default, and a wider range must be declared as safe integers checked at load. Timestamps are bounded as above. Six api rows assert 400 `VALIDATION_ERROR` with the exact pointer and sub-code, and the int test has 200 controls at int4 max/min and at the years 0001 and 9999. PR045-SEC-05: closed (`cursor.ts:169-170`; the cap follows the codec's own `ttlMs` plus 60 s skew, pinned at both edges, M10/M11 killed). Security closes its own rows in the delta round; R2-m1 is the one gap I found in the SEC-01 fix.

## R2.3 New findings

| ID | Severity | File:line | Problem | Why it matters | Required fix |
|---|---|---|---|---|---|
| R2-m1 | MINOR | `list-spec.ts:59-64`, `list-spec.ts:182-185`, `list-query.ts:75-78` | An `integer` filter defaults to the int4 range. Prisma maps `@db.SmallInt` to `Int` as well, and its parameter is untyped (`"send_count" = $1`), so PostgreSQL types the value as the column: probe R2.1, `40000` against `invitations.send_count` → P2020 / SQLSTATE 22003, which `mapDbError` answers as a class-22 500, exactly the PR045-SEC-01 class. The data model has several `smallint` columns (`send_count`, `failed_attempts`, `response_status`, `percentage`, `hash_version`, `bcrypt_cost`). D-TASK045-11 says "a filter value the schema accepts is one the column accepts", and by default that holds only for `integer` columns. | No current list filters a `smallint` column, so this is latent. The default is silent, though: the repository author has to know that Prisma `Int` can be either width. | Preferred, and small: make `min` and `max` required for `kind: 'integer'` (`defineListSpec` reports a missing range at load, and `INT4_RANGE` becomes the value an int4 column spells out), so every integer filter states its column's range. Acceptable alternative: keep the default, and in the `FilterFieldSpec` doc and the module header state that a `smallint` (or CHECK-bounded) column must declare its range. Then add the line to the TASK-073 card's AUDIT LIST ON THE KEYS PATH rider, so the first repository author sees it. Fix it here or route it to part 045-C (the next pagination change) with that owner |
| R2-m2 | MINOR | `docs/03-architecture/api/README.md:140`, `:309` (not in the diff) | The contract text says a "tampered, expired or foreign cursor" is `INVALID_CURSOR`, and that it binds "the sort, the filters and the tenant". After D-TASK045-10/12, `INVALID_CURSOR` also means "the position no longer exists for you, restart from the first page". The binding is wider too (actor, actor scope, credential, path parameters, route keys such as `q`). | Clients (TASK-081's Pagination component, exports, the SDK) need to know that this 400 is a normal event that a restart answers, not a client bug. Otherwise a list screen shows an error where it should reload. | A change request to api-designer, riding the TASK-073 CONTRACT RIDERS with the D-TASK045-05 half-open-ranges line. The README §4 bullet gets one sentence ("a cursor whose position no longer exists for the caller, or that is presented with any other query, is 400 `INVALID_CURSOR`; restart from the first page"), and the catalogue row reads "tampered, expired, issued for another query, or its position no longer exists". The README is outside this PR's scope, so routing is the fix |
| R2-n1 | NIT | `prisma-args.ts:22-23` | "paging.test.ts pins both" covers the boundary moving forward (skip) and another row changing. The "repeated (it moved back)" half of the sentence is not pinned. | The header's claim is slightly wider than the tests. | Add the move-back case beside `paging.test.ts:132`, or reword to "pins the forward move and the other-row case" |
| R2-n2 | NIT | `page.ts:47`, `page.ts:55-71` | `TIMESTAMP_TEXT` accepts PostgreSQL `timestamptz::text`, but `infinity`, BC dates, 5-digit years and LMT offsets with seconds (`+05:53:28`) fail it and throw a plain `Error` (500). The rendered offset also depends on the session `TimeZone`, which `EXPECTED_ROLE_SETTINGS` does not pin. "Never row-data dependent" holds only for ordinary values. | `occurred_at` is `NOT NULL DEFAULT now()`, so this is theoretical for TASK-073. It matters only if a keys-path consumer reads a user-supplied timestamp. | One line on the TASK-073 rider: render the key explicitly in UTC (`to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')`) or as epoch microseconds through the `integer` kind (safe until year 2255), never through the session `TimeZone` |
| R2-n3 | NIT | `list-spec.ts:9-10` | The model binding of R1-m6 is opt-in. `defineListSpec({...})` without the type argument infers `TColumn` from the literals and checks nothing. | The first repositories set the convention. | Say "must" in the header ("a repository passes its model's `Prisma.<Model>ScalarFieldEnum`"), and let the TASK-073 rider name it. No code change is needed |

## R2.4 Rulings on D-TASK045-10..14

| Decision | Ruling |
|---|---|
| D-TASK045-10 (re-words D-TASK045-03): native cursor on `id`, empty page after a cursor → 400 `INVALID_CURSOR`, mutable-key trade-off documented and routed, composite-key or partitioned tables on the keys path | **Accepted.** This is the fix form that round 1 asked for. The check sits in the module's contract (`pageOf`), so every consumer inherits it. It is decided on the caller's own RLS-scoped result, the answer is uniform, and it is pinned on all three tiers. D-TASK045-03 as amended by this text governs (D-ORCH-149 already notes the amendment). R2-m2 carries the client-facing wording |
| D-TASK045-11: filter values the column accepts (NUL, int4 by default with declared wider ranges, RFC 3339 date-times to the millisecond, years 0001..9999) | **Accepted, with R2-m1.** The string, timestamp and int4 parts are right and pinned. The int4 default is not "the column's range" for `smallint` columns |
| D-TASK045-12: binding = principal (org, actor, actor scope, credential kind, guest hash) + operation + canonical sort and filters + path parameters + every route query key; only `limit` and `include_total` unbound | **Accepted.** It is complete for the inputs a list route can have, and canonical where reordering is possible. Each member has a test that kills its mutant. Binding the credential kind means a guest who signs in mid-walk restarts the list, which is the safe choice |
| D-TASK045-13: keys bounded to 4 tokens of 48 characters of a safe alphabet or safe integers; key kinds declared per sort field and checked in `pageOf`; decode refuses an expiry beyond lifetime + 60 s | **Accepted.** The size bound is now a property of the codec, not of row data, and is pinned at the worst case. No free text can enter a cursor. The decode cap follows the codec's own `ttlMs`. R2-n2 is a consumer rider, not a defect |
| D-TASK045-14 (amends D-TASK045-08): the PG 18 suite applies the released RLS helpers migration and a tenant policy; `defineListSpec` takes the model's field names as a type parameter | **Accepted.** I replayed the setup on PGlite (R2.1). It applies from the released file through the same relative URL and binds `platform_app` as the file says, and the RLS-moved case returns 0 rows there exactly as the int test expects. Reading a released migration, rather than copying it, keeps the policy honest if the helpers change. The round-1 condition of D-TASK045-08 (the first real list route proves its walk on the migrated schema as `platform_app`) stays on TASK-073 per D-SD-011. Lane-B note: the new `beforeAll` statements run before any test, so a failure there fails the whole file. A setup error on lane B is a finding, not a flake |

## R2.5 The routed items

- **R1-m1 (mutable sort keys) → principal-architect: acceptable.**
  - Round 1 allowed exactly this: the trade-off documented and pinned, with the choice between (a), keys carried and refused on change, and (b), a declared `mutable` flag, made by principal-architect.
  - Nothing in the code stops a route from declaring a sort on a mutable column, so the routing must hold at the plan level. Condition: the orchestrator records the routing in DECISIONS.md, with a DISPATCH GATE line on the first task whose list sorts on a mutable column (sessions `last_used_at`, address book `label`/`updated_at`, shipments `updated_at`, or any `name`/`display_name` sort). The ruling must exist before that task is dispatched.
  - TASK-073 (`occurred_at`, immutable) is not gated by it.
- **R1-n3 / PR045-SEC-07 module side → the next `define-route` change: acceptable**, with an owner.
  - The contract checker now enforces the audit cap.
  - The remaining gaps are a per-request refusal of a misdeclared ceiling (500 on the first api test) and an `audit` ceiling that a non-audit spec could still declare. Both are INFO/NIT.
  - "The next `define-route` change" must become a named task in DECISIONS.md (the next card that holds the `define-route.ts` lock), or the line is lost.

## R2.6 Merge conditions (replace round 1 §4)

1. **Lane B green on `3168c194`.** A later head needs a delta review first.
   - `pagination.api.test.ts`: AT-US-037-01..07 and -10, the deleted-boundary 400, the actor/`q`/no-`q` binding 400s, the six PR045-SEC-01 400 rows and the 200 controls.
   - `list-keyset.int.test.ts` on PostgreSQL 18: the round-1 cases, the policy probe, the deleted-boundary and RLS-moved-boundary 400s with the continuation after the move back, and the int4/year controls.
   - The generated suites and the `validate` api tests.
2. **Security delta round on `3168c194`** closing C1..C3 (the record's §6), with a verdict row that names this head.
3. **R2-m1** fixed here (a delta review of that commit), or routed in the handoff to part 045-C with the doc line, and in either case the TASK-073 rider line.
4. **R2-m2** and **R2-n2/R2-n3** added to the TASK-073 riders (CONTRACT RIDERS to api-designer; AUDIT LIST ON THE KEYS PATH), by the orchestrator or the next senior-developer fold.
5. **DECISIONS.md:**
   - D-TASK045-10..14 accepted by reference, as D-ORCH-149 did for 01..09;
   - the R1-m1 routing with its dispatch gate (R2.5);
   - the n3/SEC-07 module-side owner as a named task.
6. **Hosted CI on the pushed head:** lane A and `security-integration` (the classifier selects it for `apps/api/src/platform/**`) green.
7. Carried from round 1 and still open, unchanged: C5 / part 045-C (the codec is built once in the composition root from `CURSOR_KEY` / `CURSOR_KEY_PREVIOUS`, with its own security round) before the first list route is mounted.

## R2.7 Good patterns worth keeping

- The completeness failure is decided where the evidence is: the page query's own RLS-scoped result. A second lookup that could disagree with it, or leak existence, is avoided.
- The bound sits in the type of the data, not in a size check after the fact. Key tokens and kinds make the 512-character cursor a theorem, pinned by the worst-case test.
- The binding is canonical and test-pinned member by member. Each member has a mutant that dies.
- The int test reads the released migration instead of copying the helpers, and proves with a policy probe that RLS is in force before relying on it.
- Joi refusals carry the exact pointer and sub-code for every class the database would refuse, with 200 controls at each bound on the real engine.

## R2.8 Security flags (for security-analyst)

- R2-m1: integer filters on `smallint` columns can still reach SQLSTATE 22003 (500) under the default int4 range. This is the same class as PR045-SEC-01. Confirm in the delta round whether it stays under SEC-01 or gets its own row.
- R2-n2: the keys-path timestamp text depends on the session `TimeZone` (not a pinned role setting). Add it to F1 / the TASK-073 conditions with PR045-SEC-04 and -06.
- The binding now includes `credential` and `actorScope`, and it is never carried in the cursor, only used as MAC input, so its size does not matter. No new key handling.
