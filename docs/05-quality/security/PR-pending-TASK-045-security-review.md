# PR-pending: TASK-045 (cursor pagination, filtering and sorting: HMAC-signed cursors, keyset arguments, the INVALID_FILTER mapping in the validate slot), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-045-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's checker does not count a `PR-pending-*` name (simulation C2 in §7).

**Finding IDs.** `PR045-SEC-nn` are the findings of this task (TASK-045). They are not findings of PR #45.

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-045-cursor-pagination-filtering-sorting` on base `530629f4`: `d2a72698` (validate slot: unknown `filter[...]` key is 400 `INVALID_FILTER` on list schemas), `1c8cd622` (pagination module), `b380f429` (contract rules, `tools/openapi/list-contract.ts`) |
| Head | b380f42918d7e51cb63d973b21e9cb0d21d2d464 |
| Merge base with main | `530629f4` (origin main when this round was written). The main checkout carried unpushed docs-only commits on top (local main `a9bac01a` when this record was written, including the code review twin `d12c22fd`). `530629f4..a9bac01a` changes nothing outside `docs/` and `.claude/agent-memory/`; `git merge-tree --write-tree` of local main and `b380f429` is clean |
| Lane A evidence | None: the branch is not pushed. Main's classifier (`tools/ci/security-paths.mjs --base 530629f4 --head b380f429`) gives `security_paths=true` (16 paths), so the hosted `security-integration` job runs on the PR |
| Lane B evidence | None yet. `pagination.api.test.ts` and `list-keyset.int.test.ts` compile (code review §1) and run only in lane B |
| Owned paths changed | 16, as main's checker counts them (`--base 530629f4 --head b380f429 --pr 9999`, no record: `missing`): `apps/api/src/platform/pagination/` (`cursor.ts`, `index.ts`, `list-query.ts`, `list-spec.ts`, `page.ts`, `prisma-args.ts`, `tests/list-fixture.ts`, `tests/memory-list.ts` and the six test files `cursor.test.ts`, `keyset.test.ts`, `list-keyset.int.test.ts`, `list-query.test.ts`, `pagination.api.test.ts`, `paging.test.ts`), `apps/api/src/platform/validate/validate.ts`, `apps/api/src/platform/validate/validate.test.ts`. `tools/openapi/list-contract{,.test}.ts` are not owned (read) |
| Unowned paths read | `tools/openapi/list-contract.ts`; for context `apps/api/src/platform/routing/{define-route,route-state}.ts`, `apps/api/src/platform/tx/execute.ts`, `apps/api/src/platform/errors/{classify,problem-handler}.ts`, `apps/api/src/platform/db/map-db-error.ts`, `apps/api/src/platform/logging/request-logger.ts`, `packages/config/src/{keys,schema,guards}.ts`, `@prisma/adapter-pg` 7.10.1 `dist/index.mjs` (`mapArg`, `formatDateTime`) |
| Binding items checked | Brief `docs/04-plan/briefs/TASK-045.md` and its card; US-037 and EC-A33; `api/README.md` §4 and §11; ADR-0016 item 5 and amendment 5 (d); ADR-0018 register row `CURSOR_KEY` (HMAC-SHA-256, 30 d, dual verify 1 h, blast radius "forged cursors (still RLS-bound)"); D-TASK045-01..09 (commit bodies and code review §3); code review round 1 `docs/05-quality/reviews/PR-pending-TASK-045-code-review.md` (CHANGES_REQUESTED) and its §6 security flags; PR56-SEC-01 (NUL in filter values, closed for the audit summary) |
| Reviewer / date | security-analyst, 2026-11-21, round 1, pre-push. Host rule: foreground commands only, one at a time, each at most 8 minutes, no Docker, nothing run in the TASK-045 worktree (git reads used the shared object store from the main checkout; every probe ran on a `git archive b380f429` extract in the session scratchpad) |

## 1. Summary

The cursor design holds what the dispatch asked about. The MAC is HMAC-SHA-256 under a dedicated key, over a context label, the recomputed binding and the exact encoded payload text; it is checked first, in constant time, under the current and then the previous key. 38,502 single-character mutants and 16 structural variants of an authentic cursor were all refused. Every failure is the same `AppError` (`INVALID_CURSOR`, catalogue title and detail, nothing about the cause and no cursor text). A cursor does not cross organisations, actors, guests, operations, sorts or filter sets. Filter and sort names cannot reach Prisma from the request: columns come from code, sort terms are Map lookups, values are typed by the closed Joi keys. The validate-slot change maps only an unknown `filter` key of a list schema; it adds no bypass and no new 500.

The module gives a confidentiality fail-safe but not an integrity one, and it lets values through that the database refuses:

- **PR045-SEC-01 (LOW, CWE-1284).** String, integer and timestamp filter values that the closed schema accepts and PostgreSQL refuses answer **500**: U+0000 in a string (`22021`), an integer outside `int4` (`22003`), year 0000 (`22008`) and negative years (`22007`, because the adapter formats them without a sign). Every list route inherits it.
- **PR045-SEC-02 (LOW, CWE-754) = code review R1-M1.** A boundary row that the caller can no longer see (moved to another organisation under RLS, probed; or deleted) answers 200 with `has_more: false`. No row leaks (a foreign boundary id under RLS returns nothing), but the list silently ends.
- **PR045-SEC-03 (LOW, CWE-345) = R1-m3 + R1-m4, widened.** Route keys such as `q`, the principal's `actorScope` and its `credential` are not in the binding (probed: accepted); the actor, guest and operation members are bound but unpinned by tests.
- **PR045-SEC-04 (LOW latent, CWE-400) = R1-m5, widened.** Row-derived sort keys can exceed the 512-character budget and make `encode` throw a plain `Error` (500) for every page that ends on such a row; free-text keys would also put personal data into URLs.
- **PR045-SEC-05 (INFO, CWE-613).** The one-hour lifetime is enforced only at issuance; an authentic cursor with a far expiry verifies for as long as its key is configured.
- **PR045-SEC-06 (INFO, CWE-639).** The native cursor reads the boundary row by id only. Without RLS, a foreign boundary positions the walk at that row's sort values (probed). The register's "still RLS-bound" holds for RLS tables only; conditions for TASK-073.
- **PR045-SEC-07 (INFO, CWE-770).** The `audit` page-size ceiling (200) is not tied to audit lists, neither in `defineListSpec` nor in the contract checker.

Verdict: **PASS_WITH_CONDITIONS.** No Critical, High or Medium finding. Conditions C1 to C5 (§6); C1 and C2 are fixed in this PR's fix cycle and checked in a delta round on the fix head, which code review R1-M1 requires anyway.

## 2. Method and evidence

All probes are single-process Node 24 scripts on a `git archive b380f429` extract with a `node_modules` junction to the main checkout (same lockfile; the PR adds no dependency), run through `tsx` with the `@platform/source` condition.

| Probe | What | Result |
|---|---|---|
| P1, end to end | The PR's `listQuerySchema` → `parseListQuery` → `prismaListArgs` → main's generated Prisma 7.10 client → `PrismaPg` → PGlite 0.4.3 (PostgreSQL 17.5) wire server, a `memberships`-shaped table with `version integer`, `status text`, `created_at timestamptz(6)`; errors classified by the head's `mapDbError`. RLS cases with a `FORCE`d policy `org_id = current_setting(...)` and a non-owner role. PGlite's socket server drops the first connection after an error response, so each case ran on a fresh client and was retried once on `P1017` (every class-22 result was also seen on a first attempt in an earlier run) | §4 PR045-SEC-01 table; R0 org A sees its 12 rows; R1 boundary moved to org B → `200 items=0 has_more=false`, R1c control (moved back) `items=3 has_more=true`; R2 foreign boundary id under RLS → `items=0`; R3 the same without RLS → org A rows after the foreign row's `(created_at, id)` |
| P2, codec and slot | Codec forgery matrix, binding matrix through `parseListQuery`, rotation, expiry, error identity, key budget, validate slot V1-V14, ReDoS scaling of the new request-input patterns through the real Joi keys | §3 and §4 |
| Gitleaks | Faithful v8.30.1 emulation (no generic digit check, per-hunk fragments, repo allow-lists from main), `git log -p -U0 --diff-merges=first-parent 530629f4..b380f429`, runtime positive controls `1,1,0` | 2,670 added lines, **0 findings**; control: the known `b34f954e` fingerprint is reproduced |
| Record binding | Main's real `check-security-owned-paths.mjs` in a sparse shared clone, plumbing scenarios | §7 |

Not run: Docker, PostgreSQL 18, the api and integration suites (lane B), lint and typecheck (the code review ran them clean on the same head).

## 3. What holds

- **MAC construction** (`cursor.ts:71`, `:128-129`, `:147-160`). `HMAC-SHA-256(key, "platform-cursor\0v1\0" ‖ binding ‖ "\0" ‖ base64url(payload))`, full 32 bytes. The binding is a JSON array, so it holds no raw NUL and the separators are unambiguous. The MAC covers the encoded payload text, so a non-canonical payload encoding is a different MAC input. The MAC must be the canonical 43-character encoding (trailing-bit variants refused). `timingSafeEqual` runs on two 32-byte buffers; the payload is parsed only after a MAC matched. Tamper fuzz: 38,502 single-character substitutions, insertions and deletions over the alphabet `[A-Za-z0-9-_.=+/ %]` and 16 structural variants (halves swapped, extra dots, padding, spaces, upper case, 513 characters, empty): **0 accepted**; the authentic control decodes.
- **Binding members** (`list-query.ts:158-166`), probed through `parseListQuery`: another organisation, actor in the same organisation, guest-token hash, operation, sort, filter value or extra filter → `INVALID_CURSOR`; the same any-of set reordered or duplicated → accepted (canonical). Not bound: `limit` and `include_total` (by design), route keys, `actorScope`, `credential` (PR045-SEC-03).
- **One error, no oracle, no echo.** Forged, foreign-binding, malformed and expired cursors raise byte-identical errors: `{ code: INVALID_CURSOR, status: 400, title: "Invalid cursor", detail: "Invalid cursor." }`; the cursor text is not in it. The problem handler drops the query string from `instance` (`problem.ts:27`), and the access log carries the route template only (`request-logger.ts:2`), so cursors and filter values do not reach logs through the platform.
- **Keys.** A cursor signed with the previous key verifies while `CURSOR_KEY_PREVIOUS` is configured and is refused once it is removed. A `local-only-*` marker yields different keys per key id, and the marker bytes used as a deployed key do not verify a locally derived cursor. Configuration: deployed HMAC material is at least 32 bytes (`keys.ts`, `checkMaterial`), duplicate material across variables is refused (`findDuplicateKeyMaterial`), and the placeholder guard refuses `local-only-*` outside `local`/`test` (`guards.ts:42-47`), so the stretched marker never signs outside those environments.
- **Expiry.** `x = floor((now + ttl) / 1000)` and refusal from `x` on: a cursor lives between 3,599 and 3,600 s.
- **Parsing bounds.** Joi refuses a 513-character cursor (`TOO_LONG`) and `decode` re-checks length, dot count and base64url before any work; the HMAC input is bounded by the query size. `readPayload` accepts exactly the keys `v`, `x`, `i`, `s` (an own `__proto__` from `JSON.parse` is an unknown key), a safe-integer expiry, a URL-safe id of at most 64 characters and at most 8 bounded keys, and it is reachable only with an authentic MAC.
- **No injection into Prisma arguments.** Column names come only from the declaration (`COLUMN_NAME` at `defineListSpec`), sort terms are `Map` lookups after `SORT_TERM` (so `constructor` and friends are unknown), and the module emits only `{ col: value }`, `in`, `gte` and `lt`. Operator-shaped query keys never reach it: `filter[status][ne]` is `INVALID_FILTER` (V3) and a repeated key is an array refused as `INVALID_TYPE` (V5). There is no raw SQL in the module.
- **DoS bounds.** `limit` above the declared maximum is `VALIDATION_ERROR`, never clamped (V11; `1e2` reads as 100, V12); ceilings 100/200/300 are checked at declaration, `reference` only on public routes; `take` is `limit + 2`; at most 4 sort terms (260 characters), 16 filter fields, 20 any-of values, 200 (at most 500) characters per string filter. ReDoS: 1 KiB versus 16 KiB inputs that fail at the end take 0.7 to 2.3 times as long (prefix-chained enum any-of, near-miss tokens, near-miss UUID lists, sort terms); every pattern is linear.
- **Validate slot** (`validate.ts:145-169`, `:192`). V1 unknown `filter[x]`, V2 a bare `filter` key, V3 an operator suffix and V10 `filter[__proto__]` → `INVALID_FILTER` with the catalogue detail and no value (a random sentinel key and value were not echoed); V4 `filterx`, V5 an array value and V6 an enum miss → `VALIDATION_ERROR` with the pointer; V7 a non-list route → `UNKNOWN_FIELD`. V8 and V9: an unknown filter pre-empts a server-controlled body field or another unknown key, but the request is still refused with 400, so nothing is bypassed. `isListQuerySchema` calls `describe()` on the prepared schema once (WeakMap); define-route already walks `describe()` of every mounted schema at mount, so no new 500 path.
- **Gitleaks:** 0 findings in the range (§2).

## 4. Findings

### PR045-SEC-01 (LOW): filter values the schema accepts but the column refuses answer 500

- **CWE / OWASP:** CWE-1284 (Improper Validation of Specified Quantity in Input), CWE-20; A03:2021 (the 2021 category of CWE-20).
- **Where:** `apps/api/src/platform/pagination/list-query.ts:54-61` (`filterValueSchema`: `string` is `Joi.string().min(1).max(n)`, `integer` is `Joi.number().integer()`, `timestamp` is `Joi.date().iso()`); the effect surfaces in `apps/api/src/platform/db/map-db-error.ts:238` (any SQLSTATE outside the mapped set is 500 `DB_ERROR`). `@prisma/adapter-pg` 7.10.1 `formatDateTime` pads the year with `padStart(4, "0")` and no sign, so year -1 is sent as `00-1-01-01 ...`.
- **Evidence (P1, real Prisma client and adapter, PostgreSQL 17.5):**

  | Case | Joi | Result |
  |---|---|---|
  | E0 control `filter[status]=ACTIVE` | accepted | 200, 12 items |
  | E1 string with U+0000 (`%00` in a query string arrives as U+0000) | accepted | 500 `DB_ERROR`, SQLSTATE `22021`, Prisma `P2039` |
  | E2 integer `3000000000` on an `int4` column | accepted | 500, `22003`, `P2020` |
  | E3 integer `-2147483649` | accepted | 500, `22003`, `P2020` |
  | E3c control `2147483647` | accepted | 200 |
  | E4 timestamp `0000-01-01T00:00:00Z` | accepted | 500, `22008`, `P2039` |
  | E5 timestamp `-000001-01-01T00:00:00Z` | accepted | 500, `22007`, `P2039` |
  | E6 timestamp `+275760-09-13T00:00:00Z` | accepted | 200 (in PostgreSQL's range, outside the contract's date-time) |
  | E7 control `0001-01-01T00:00:00Z` | accepted | 200 |
  | E8 date-only `2026-11-21` | accepted | 200 (R1-n2) |
  | E9 `9007199254740993` | refused (`number.unsafe`) | 400 |

- **Exploitability and impact.** Any caller of a list route that declares a string, integer or timestamp filter (authenticated tenant lists; anonymous on a public list with such a filter) gets a 500 on demand with one request. No data leaks (the problem body is the generic 500 and the log line carries the SQLSTATE, not the value). The cost is availability noise: one `http.request_failed` error line per request, 5xx-rate SLO alerts, and the default ROLLBACK_TRIGGERS ("error rate > 2× baseline") become client-drivable once a canary runs. The rate limiter bounds the volume per client. README §3 makes a value outside the field's type a 400 `VALIDATION_ERROR`, and CLAUDE.md §8 wants validation at every boundary. The first consumer, TASK-073, declares `filter[occurred_from]`, `filter[ip]` and `filter[entity_id]`. Impact low, likelihood medium: LOW.
- **Remediation (this PR).** Bound each kind to what the column accepts, so the closed schema refuses it with `VALIDATION_ERROR` and the pointer:

  ```ts
  // list-query.ts
  const NO_NUL = /^[^\0]*$/u; // PostgreSQL text refuses U+0000 (22021)
  const INT4 = Object.freeze({ min: -2_147_483_648, max: 2_147_483_647 });
  const TIMESTAMP_MIN = '0001-01-01T00:00:00.000Z';
  const TIMESTAMP_MAX = '9999-12-31T23:59:59.999Z';

  case 'string':
    return Joi.string().min(1).max(stringFilterMax(filter)).pattern(NO_NUL);
  case 'integer':
    // FilterFieldSpec gains optional `min`/`max`; the default is the int4 range, a bigint column widens it explicitly.
    return Joi.number().integer().min(filter.min ?? INT4.min).max(filter.max ?? INT4.max);
  case 'timestamp':
    return Joi.date().iso().min(TIMESTAMP_MIN).max(TIMESTAMP_MAX);
  ```

  `defineListSpec` checks `min <= max` and that both are safe integers. Fold R1-n2 into the same change (refuse more than six fraction digits and date-only values, or document the millisecond rounding). Recommended beyond this module (principal-architect, ADR-0016 validation conventions): refuse U+0000 in every string of every request part in the validate slot, because `q`, path parameters and body strings reach `text` parameters the same way; PR56-SEC-01 fixed only the audit summary side.
- **Fix candidate checked.** The three schemas above, run with the repository's Joi 18.3.2, refuse E1 (`string.pattern.base`), E2 and E3 (`number.max`, `number.min`), E4 and E5 (`date.min`) and E6 (`date.max`), and accept ACTIVE, a tab-containing string, `2147483647`, `0001-01-01T00:00:00Z` and `9999-12-31T23:59:59.999Z`.
- **Verification.** Unit: `listQueryKeys` refuses each of E1-E5 with `/query/filter[...]` and accepts E3c, E7 and `9999-12-31T23:59:59.999Z` (build the NUL value with `String.fromCharCode(0)`). Api: one request per kind answers 400 `VALIDATION_ERROR`, never 500. Integration on PostgreSQL 18: the three controls answer 200. Mutation: dropping each bound fails a test.

### PR045-SEC-02 (LOW): an invisible boundary row ends the list with `has_more: false` (= code review R1-M1)

- **CWE / OWASP:** CWE-754 (Improper Check for Unusual or Exceptional Conditions); A04:2021 Insecure Design.
- **Where:** `apps/api/src/platform/pagination/page.ts:32-44`, `prisma-args.ts:50-51`, `tests/memory-list.ts:58-59`.
- **Evidence (P1).** Under RLS as a non-owner role: R1, the boundary row moved to another organisation between pages → `200, items 0, has_more false`; R1c, moved back → `items 3, has_more true`. The code review shows the same for a deleted row.
- **Exploitability and impact.** Confidentiality holds: Prisma compares against boundary subqueries that see nothing, so the statement returns no row (R2: a foreign boundary id under RLS also returns nothing). Integrity does not: `has_more: false` is a completeness claim, and a list screen, an export or a sync client stops early with no signal. Triggers are ordinary (a retention purge, a claimed guest quote, a member moved, a hard delete). An insider can end another user's walk only by changing rows they may already change. LOW.
- **Remediation.** As R1-M1: in `pageOf`, `if (request.after !== undefined && rows.length === 0) throw new AppError('INVALID_CURSOR');` (a cursor is only issued when a row existed beyond the page), mirrored in the memory engine; or the equivalent boundary lookup. Security requirements on either form: decide inside the same statement or transaction scope as the page query (so the caller's RLS decides), answer the same `INVALID_CURSOR` for deleted, moved, invisible and foreign boundaries (no existence oracle for foreign rows), and never answer 404.
- **Verification.** R1-M1's three tests, plus in `list-keyset.int.test.ts` an RLS case: enable a tenant policy on the test table, run as the test's non-owner role, move the boundary row to another organisation between pages → 400 `INVALID_CURSOR`; moved back → the walk continues.

### PR045-SEC-03 (LOW): binding completeness (= R1-m3 and R1-m4, widened)

- **CWE / OWASP:** CWE-345 (Insufficient Verification of Data Authenticity); A08:2021 Software and Data Integrity Failures.
- **Where:** `apps/api/src/platform/pagination/list-query.ts:158-166`; `list-query.test.ts:305-319`.
- **Evidence (P2).** A cursor issued for `q=acme` is accepted with `q=zeta` and with `q` removed; one issued to a TENANT-scope principal is accepted for the same actor and organisation with `actorScope: OPERATOR`, and with `credential: api-key`. The code review's mutants show the actor, guest and operation members unpinned.
- **Exploitability and impact.** Every page re-applies the caller's own scope, so a crossed cursor exposes nothing the caller cannot list anyway (R2). The effect is a wrong page without an error, against README §4 ("bind the sort, the filters and the tenant"; `q` is a filter). The keys path (R1-m2) has no boundary lookup to fall back on, so a silently dropped member would matter more there. LOW.
- **Remediation.** Bind the canonical form of every validated query key except `limit`, `cursor` and `include_total`, plus the principal's `actorScope` and `credential`:

  ```ts
  const UNBOUND = new Set(['limit', 'cursor', 'include_total', 'sort']);
  const canonical = (v: unknown): string => (v instanceof Date ? v.toISOString() : JSON.stringify(v));
  const routeKeys = Object.keys(query)
    .filter((key) => !UNBOUND.has(key) && !key.startsWith('filter[') && query[key] !== undefined)
    .sort()
    .map((key) => [key, canonical(query[key])]);
  const binding = JSON.stringify(['list', route.operationId, principal.orgId, principal.actorId, principal.actorScope,
    principal.credential, principal.guestTokenHash, sortText, filterTriples, routeKeys]);
  ```

- **Verification.** One `INVALID_CURSOR` assertion per member at `parseListQuery` (organisation, actor, guest hash, operation, actor scope, credential, sort, filter, `q` changed, `q` removed) and still valid for another `limit` and `include_total`; over HTTP at least actor and `q`. Removing any member must fail a test.

### PR045-SEC-04 (LOW, latent): row-derived cursor keys can break pages (= R1-m5, widened)

- **CWE / OWASP:** CWE-400 (Uncontrolled Resource Consumption), CWE-598 (sensitive values in query strings); A04:2021 Insecure Design.
- **Where:** `apps/api/src/platform/pagination/cursor.ts:83-89`, `:143`; `page.ts:40-42`.
- **Evidence (P2).** `encode` throws a plain `Error` (500 through the problem handler) for two 200-character keys and for one 120-character CJK key; one ASCII key of the maximum 256 characters still fits with a UUID id.
- **Exploitability and impact.** Latent: no consumer passes `keysOf` yet. Once one carries a free-text sort key (a label or display name), a tenant user who may edit that text plants a row that makes every page ending on it answer 500 for everyone listing it, a stored, page-local denial of service. Free-text keys also put personal data into URLs, which load-balancer access logs keep with the query string even though the platform's own logs drop it.
- **Remediation.** As R1-m5 (byte budget in `validKeys` from `MAX_CURSOR_LENGTH`), and restrict the keys path at declaration to bounded, non-personal key types: exact timestamp text (for example `occurred_at::text`), integers and UUIDs. A sort field carried as a key declares its kind; `defineListSpec` refuses free-text kinds there, and `pageOf` checks `keysOf` output against the declared kinds. Due before any consumer passes `keysOf` (TASK-073).
- **Verification.** Declaring a text key is refused at load; the largest declared combination encodes within 512 characters; a CJK value at the bound is refused at declaration, not at request time.

### PR045-SEC-05 (INFO): the one-hour lifetime is an issuance property only

- **CWE / OWASP:** CWE-613 (Insufficient Session Expiration); A07:2021.
- **Where:** `apps/api/src/platform/pagination/cursor.ts:159`.
- **Evidence (P2).** A cursor minted with the previous key with a 10-year expiry verifies now and 9 years later, while `CURSOR_KEY_PREVIOUS` stays configured.
- **Impact.** Only a key holder can mint one, and a key holder can mint fresh cursors for as long as the key is configured, so the practical gain is small. The register's "dual verify 1 h" depends on the operator removing `CURSOR_KEY_PREVIOUS`; the codec cannot know the rotation time.
- **Remediation.** Refuse `payload.x * 1000 > now() + ttlMs + 60_000` at decode, and pin the removal of `CURSOR_KEY_PREVIOUS` one hour after rotation in the rotation runbook (owner: the composition task of D-TASK045-07, with devops).
- **Verification.** A unit case: an authentic cursor whose expiry is the lifetime plus two minutes ahead is `INVALID_CURSOR`.

### PR045-SEC-06 (INFO): the boundary subquery is scoped only by the connection

- **CWE / OWASP:** CWE-639 (Authorization Bypass Through User-Controlled Key); A01:2021.
- **Where:** `apps/api/src/platform/pagination/prisma-args.ts:50-51` (Prisma's native cursor: `(SELECT <sort cols> FROM t WHERE id = $n)`).
- **Evidence (P1).** R2: under RLS, a boundary id of another organisation's row yields no row. R3: on the same table without RLS, with the organisation only in the repository's `base`, the walk starts after the foreign row's `(created_at, id)`.
- **Impact.** Reaching R3 needs a forged cursor, so the key (the MAC holds, §3). Then a sort-value oracle on rows of other scopes exists for tables without RLS: SYSTEM tables, operator reads and owner connections. ADR-0018's blast radius "forged cursors (still RLS-bound)" is true for RLS tables only.
- **Conditions for consumers (TASK-073 first, and any list on a table without RLS).** (a) Use the keys path, or a boundary lookup that applies the same scope predicate as the page query. (b) Keys-path values only as bound parameters, never interpolated. (c) Operator scope selection (`scope_org_id`) is a filter, so it is in the binding. principal-architect: register wording "RLS-bound on RLS tables, scope-bound elsewhere".
- **Verification.** TASK-073's list test with a cursor whose boundary is a row outside the caller's scope (key in hand in the test) answers 400 or an empty walk, never rows positioned by it.

### PR045-SEC-07 (INFO): the audit ceiling is not tied to audit lists

- **CWE / OWASP:** CWE-770 (Allocation of Resources Without Limits or Throttling); A04:2021.
- **Where:** `apps/api/src/platform/pagination/list-spec.ts:110-120`, `list-query.ts:146-150` (only `reference` is checked against the route); `tools/openapi/list-contract.ts:136` (cap 200 for any operation tagged `audit`).
- **Impact.** A business list can declare `ceiling: 'audit'` and a 200 maximum, and the contract checker accepts it with an `audit` tag. Bounded (200), so INFO.
- **Remediation.** Accept `audit` only for routes classified as audit lists (the operation tag or the module the route is mounted under), in the same mount-time check as R1-n3; the contract rule requires the audit list body or path, not the tag alone.

## 5. Concurrence with the code review twin

| Code review item | Security view |
|---|---|
| R1-M1 deleted/invisible boundary | = **PR045-SEC-02** (LOW as a security finding; MAJOR as a defect stands). Probed under RLS as well; the fix form must meet the three requirements in §4 |
| R1-m1 mutable sort keys skip rows | Concur. Integrity only; an insider who can move the boundary row can already change the rows themselves. No separate security finding |
| R1-m2 composite-key and partitioned tables use the keys path | Concur; plus PR045-SEC-06 conditions (a)-(c) and PR045-SEC-04 key types for TASK-073 |
| R1-m3, R1-m4 binding | = **PR045-SEC-03**, widened by `actorScope` and `credential` |
| R1-m5 key size | = **PR045-SEC-04**, widened by key types (personal data in URLs) |
| R1-m6 untyped columns | Concur. Columns come from code only; a typo is a 500 at request time, not an injection |
| R1-n1 stale paths | No security view |
| R1-n2 sub-millisecond bound, date-only | Concur; fold into the PR045-SEC-01 fix |
| R1-n3 reference ceiling refused per request | Concur; do PR045-SEC-07 in the same mount-time check |
| R1-n4 issue cap hides an unknown filter | Concur; still 400 (V9), no bypass |
| D-TASK045-02, -04 | Concur (§3) |
| D-TASK045-07 codec wiring deferred | Concur, with condition C5 |
| D-TASK045-08 bare PG 18 table | Concur, with the RLS case of PR045-SEC-02 added to the same file now (a policy on the test table costs a few lines) |

Security flags of code review §6: invisible boundary under RLS → PR045-SEC-02 (fails closed for reads, not for completeness); binding → PR045-SEC-03; SYSTEM tables and id-only subqueries → PR045-SEC-06; key handling → holds (§3, Keys).

## 6. Conditions, follow-ups and routing

| ID | Condition or follow-up | Owner | Due |
|---|---|---|---|
| C1 | PR045-SEC-02 fixed with R1-M1's tests and the RLS-invisible int case (§4) | senior-developer | This PR's fix cycle; security delta round on the fix head |
| C2 | PR045-SEC-01 fixed (string, integer, timestamp bounds, R1-n2 folded), with the unit, api and PostgreSQL 18 cases (§4) | senior-developer | This PR's fix cycle |
| C3 | PR045-SEC-03 fixed with per-member assertions; if routed instead, due before the first consuming list route merges | senior-developer | This PR, else before TASK-073 merges |
| C4 | Lane B green on the fix head: `pagination.api.test.ts` (AT-US-037-01..07, -10, plus the deleted-boundary 400, one 400 per PR045-SEC-01 kind, actor and `q` binding 400), `list-keyset.int.test.ts` on PostgreSQL 18 (AT-US-037-01, -02, -05, -10, the status-change boundary, the deleted and RLS-invisible boundary 400, the PR045-SEC-01 controls 200), the generated suites and the validate api tests | orchestrator (lane B) | Before merge |
| C5 | Codec composition (D-TASK045-07): built once in the composition root from `CURSOR_KEY` / `CURSOR_KEY_PREVIOUS` of the parsed configuration, never from a literal or a test fixture; the owner named in DECISIONS.md; that wiring changes owned paths and gets its own security round | orchestrator, then the named owner | Before the first list route is mounted |
| F1 | PR045-SEC-04 (key budget and key types) | senior-developer | Before any consumer passes `keysOf` (TASK-073) |
| F2 | PR045-SEC-05 decode cap and rotation runbook line | senior-developer; devops | With C5 |
| F3 | PR045-SEC-06 conditions (a)-(c) into the TASK-073 brief; register wording | orchestrator; principal-architect | TASK-073 dispatch; next ADR-0018 fold |
| F4 | PR045-SEC-07 with R1-n3 | senior-developer | This PR or the next `define-route` change |
| F5 | NUL refusal for every request string in the validate slot (PR045-SEC-01, recommended part) | principal-architect | Before G3 |

**SEC-TC proposals** (for qa-lead's next manifest commit after merge, D-SEC-PR47-01; the next free ID on main is 82):

- **SEC-TC-82**, cursor isolation and fail-closed boundary: AT-US-037-10 plus the actor, guest, operation, actor-scope and `q` cases and the RLS-invisible boundary 400. `api.required_cases` and `integration.required_cases`.
- **SEC-TC-83**, list filter values the column refuses are 400, never 500 (PR045-SEC-01 cases). `api.required_cases`.

## 7. Record binding

Main's real checker (`tools/ci/check-security-owned-paths.mjs` from local main) in a sparse shared clone, merge-ref form (record committed on a main commit, then `git merge-tree` with the head and `commit-tree`), `--pr 9999`, record content = this file under the name `PR-9999-TASK-045-security-review.md`:

| Scenario | Expected | Result |
|---|---|---|
| S1 record on main merged with the head (`--base` = merge base `530629f4`) | pass | pass, 16 owned, satisfied by `b380f429` |
| S1b the same with `--base` = the main tip carrying the record | pass | pass |
| S2 a docs-only evidence commit after the head | pass | pass (the binding is kept) |
| S3 an unowned edit after the head (`tools/openapi/list-contract.ts`) | pass | pass |
| S4 the branch merges a docs-only main | pass | pass |
| C1 no record | missing | missing (exit 1) |
| C2 the record only under this `PR-pending` name | missing | missing: the orchestrator must rename it once the PR exists |
| C3 a later FAIL verdict row | missing | missing |
| C4 the Head row naming a main commit | missing | missing |
| C5 an owned edit after the head (`pagination/page.ts`, the fix cycle) | missing | missing: the fix head needs its own round |
| C6 the branch merges a main that also changed `validate.ts` (union) | missing | missing: such a merge needs a merge-only round |

11 of 11 as expected (main tip `a9bac01a` for the simulation; the record contains exactly one Head row and one Verdict row).

## 8. Verdict

| Field | Value |
|---|---|
| Verdict | PASS_WITH_CONDITIONS. No Critical, High or Medium finding. LOW PR045-SEC-01 (C2), LOW PR045-SEC-02 (C1, = R1-M1), LOW PR045-SEC-03 (C3), LOW latent PR045-SEC-04 (F1); INFO PR045-SEC-05, -06, -07. Conditions C1 to C5 in §6; a security delta round on the fix head checks C1 to C3 |
