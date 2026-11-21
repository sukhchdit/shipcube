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

---

# Round 2: delta review of fix cycle 1

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-045-cursor-pagination-filtering-sorting`, one fix commit `3168c194` on round 1's head `b380f429` (`fix(api): task-045 fail-closed cursor boundary, column-safe filters, full binding`; D-TASK045-10..14 in its body). Not pushed |
| Head | 3168c194eaf2cf6aac660e3f07eaf427a7ded280 |
| Delta | `b380f429..3168c194`: 18 files, +742 / -77, all inside round 1's scope: the 16 owned paths (`apps/api/src/platform/pagination/**`, `apps/api/src/platform/validate/validate{,.test}.ts`) and the unowned `tools/openapi/list-contract{,.test}.ts`. No dependency, lockfile, configuration key or migration. The int test reads the released migration `20261112020000_platform_rls_helpers` and does not change it |
| Merge base with main | Still `530629f4`. `530629f4..main` changes nothing outside `docs/` and `.claude/agent-memory/` (local main `a385cc9c` when this round was written). `git merge-tree --write-tree main 3168c194` is clean. Main's classifier (`tools/ci/security-paths.mjs --base 530629f4 --head 3168c194`) gives `security_paths=true` (16 paths) |
| Lane A evidence | None: the branch is not pushed |
| Lane B evidence | None yet. The orchestrator has queued lane B on `3168c194` (condition C4, R2.8) |
| Binding items checked | Round 1 (§1 to §8 above); D-TASK045-10..14 (commit body); code review round 2 `16819e33` (APPROVED_WITH_NITS: R2-m1, R2-m2, R2-n1..n3 and its §R2.8 security flags); D-ORCH-150 (TASK-045 routings: R1-m1 dispatch gate, the R1-n3 / PR045-SEC-07 module side to TASK-096, R2-m1 decided after this round); the TASK-073 card lines of D-SD-011 (`41bcb54a`: AUDIT LIST ON THE KEYS PATH, CURSOR CODEC FROM THE COMPOSITION ROOT) and the part 045-C line on the TASK-045 card |
| Reviewer / date | security-analyst, 2026-11-21, round 2 (delta), pre-push. Host rules: foreground commands only, each at most 8 minutes, no Docker, nothing run in the TASK-045 worktree (git reads through the shared object store from the main checkout; every probe ran on a `git archive 3168c194` extract in the session scratchpad, with a `node_modules` junction to the main checkout) |

## R2.1 Summary

Every round-1 condition that this fix cycle owned is met, and each closure was probed, not read:

- **PR045-SEC-02 (C1) is closed.** Under the int test's own RLS setup, a boundary row moved to another organisation, a deleted boundary, a foreign boundary id and an id that never existed all answer one byte-identical 400 `INVALID_CURSOR`. The same error comes back for forged and expired cursors. The control (boundary moved back) continues the walk. On round 1's head the same probe gave 200 with an empty page for each of these, so the probe sees the defect.
- **PR045-SEC-01 (C2) is closed** for the classes found. 41 filter values went through the real Prisma client to PostgreSQL 17.5: none answers 5xx (round 1's head: 7 answered 500). Every refused value is a 400 with the pointer, and no response echoes the value.
- **PR045-SEC-03 (C3) is closed.** All 23 binding variants behave as specified, including path parameters, extra route keys and the canonical form.
- **PR045-SEC-04 and PR045-SEC-05 are closed in code.** So is the contract half of PR045-SEC-07.
- **Mutants:** 21 mutants of the fix, run against the PR's own unit suites, are all killed. The code review killed 29 of 29.

Two residuals of the same classes remain, both latent, because no list route exists yet:

- **PR045-SEC-08 (LOW latent, CWE-1284) = code review R2-m1.** An `integer` filter defaults to the `int4` range. On a `smallint` column (`Invitation.sendCount`), `32768` answers 500 `DB_ERROR` (SQLSTATE `22003`). Reproduced independently.
- **PR045-SEC-09 (INFO latent, CWE-1284) = code review R2-n2, widened.** A keys-path timestamp key whose stored value falls outside the `TIMESTAMP_TEXT` grammar makes `pageOf` throw a plain `Error` (500) for every page that ends on that row. Such values are a year of 10000 or more, `infinity`, a BC date, or an offset with seconds. A year 10000 value can be written through any body field validated by a plain `Joi.date().iso()`.

Verdict: **PASS_WITH_CONDITIONS.** No Critical, High or Medium finding is open. The merge condition is lane B green on `3168c194` (C4). PR045-SEC-08 is routed to part 045-C, which merges before any list route is mounted. C5 is unchanged.

## R2.2 Method and evidence

| Probe | What | Result |
|---|---|---|
| P1, end to end (`r2-p1-e2e.mts`) | The head's `listQuerySchema`, `parseListQuery`, `prismaListArgs` and `pageOf`, then main's generated Prisma 7.10 client, then `PrismaPg`, then the PGlite 0.4.3 wire server (PostgreSQL 17.5). The table, index, grants, `CREATE SCHEMA platform`, the released RLS helpers migration (read from the extract) and the policy `p_memberships__tenant ... FOR SELECT TO platform_app USING (org_id = platform.app_org_id())` are the int test's `MEMBERSHIPS_DDL` statements, plus a `uuidv7()` stub. The boundary cases read inside a transaction as `SET LOCAL ROLE platform_app`, with `set_config('app.org_id', <org>, true)`, which is the GUC that `withTenantTx` sets. Errors are classified by the head's `mapDbError`. A fresh client is used per case, with a retry on `P1017` (PGlite's socket server drops a connection after a previous client closes). The same file was run on round 1's head as the positive control | §R2.3 (C1, C2 rows) |
| P2, codec, binding and slot (`r2-p2-codec.mts`) | A 23-variant binding matrix through `parseListQuery`; canonical-form collisions; a tamper fuzz on a cursor that carries keys; the expiry cap at the edges (current and previous key, a 10-minute codec, issuing instances 59 s and 62 s ahead); the key budget and key kinds at encode and decode (key holder); `pageOf` key-kind checks with PostgreSQL `timestamptz::text` renderings; validate slot V1 to V18; the new declaration checks; ReDoS scaling at 1 KiB and 16 KiB | §R2.3, §R2.4 |
| P3, contract (`r2-p3-contract.mts`) | The head's `checkListContract` on the head's real `openapi.yaml`, plus seeds | 27 list operations, 0 findings. `/audit/entries` at maximum 200: no finding; at 201: `limit-out-of-policy`. A business list (`/me/organisations`) tagged `audit` at 200: `limit-out-of-policy`; at 100: no finding |
| P4, `smallint` (`r2-p4-smallint.mts`) | An integer filter on `Invitation.sendCount` (`@db.SmallInt`), with the default range and with a declared range, through the same stack as P1 | §R2.4 PR045-SEC-08 |
| Mutants (`r2-mutants.mjs`) | 21 single edits of the fix, each run against the PR's unit suites (`pagination/**` and `validate.test.ts`: 5 suites, 107 tests, Jest 30 `--selectProjects unit --maxWorkers=2` on the extract with the head's `jest.config.ts`). Files were restored, and their blob hashes were checked against `3168c194` | 21 of 21 killed (§R2.3). The control was green before and after |
| Gitleaks | Faithful v8.30.1 emulation (per-hunk fragments, no generic digit check, main's `.gitleaks.toml`), `git log -p -U0 --diff-merges=first-parent b380f429..3168c194`, runtime controls `1,1,0` | 742 added lines, **0 findings**. Control: `b34f954e`'s known fingerprint is reproduced |
| Record binding | Main's real `check-security-owned-paths.mjs` in a sparse shared clone, in merge-ref form | §R2.9 |

Not run: Docker, PostgreSQL 18, `pagination.api.test.ts` and `list-keyset.int.test.ts` (lane B), lint, typecheck and build (the code review ran `tsc -b`, ESLint and Prettier clean on this head).

## R2.3 Closure of PR045-SEC-01..07 and C1..C5

| ID | Status | Evidence |
|---|---|---|
| PR045-SEC-02 (C1, = R1-M1) | **Closed** | `page.ts:74` throws `AppError('INVALID_CURSOR')` when `after !== undefined && rows.length === 0`, before the drop-by-id. The decision is taken on the page query's own result, inside the caller's transaction and RLS. P1, run as `platform_app` under the int test's policy: R0 sees its own 12 rows (all organisations hold 15); R0b, with `app.org_id` unset, sees 0 rows (fails closed). R1 (boundary moved to org B) → **400 `INVALID_CURSOR`**; R1c (moved back) → 200, 3 items, `has_more` true; R1d (boundary deleted) → **400**; R2 (foreign org B row id, key holder) → **400**; R2b (an id that never existed) → **400**. R2c: R1, R1d, R2, R2b, a forged cursor and an expired cursor raise **1 distinct error shape** (`AppError`, `INVALID_CURSOR`, 400, "Invalid cursor", "Invalid cursor.", no extensions, no cursor text), so foreign rows have no existence oracle. R4: the boundary is present and every later row stopped matching → 200, 0 items, `has_more` false (rows = 1, the boundary: the list really ended). R5: the boundary and every later row stopped matching → 400. **Positive control, round 1's head:** R1, R1d, R2, R2b and R5 answer 200 with an empty page. Mutant M7 (check removed) is killed by `paging.test.ts`. The PostgreSQL 18 cases are lane B's (C4) |
| PR045-SEC-01 (C2) | **Closed** for the classes found (for `smallint` columns see PR045-SEC-08) | `list-query.ts:46` `NO_NUL`, `:75-78` integer range from `integerFilterRange` (default `INT4_RANGE`, `list-spec.ts:125`; declared `min`/`max` checked at load, `list-spec.ts:166`), `:79-88` timestamps `min(0001-01-01T00:00:00.000Z)`, `max(9999-12-31T23:59:59.999Z)` and `DATE_TIME_TEXT` (`:48`). **P1, 41 values, 0 answering 5xx** (round 1's head: 7 answer 500, namely E1, E2, E2b, E3, E4, E5 and E7c). U+0000 → 400 `string.pattern.base`. `2147483648`, `3000000000` → `number.max`; `-2147483649` → `number.min`. Year 0000, and `0001-01-01T00:00:00+01:00` (year 0000 in UTC) → `date.min`. `-000001-…`, `+010000-…`, `+275760-…` and `9999-12-31T23:30:00-01:00` (year 10000 in UTC) → `date.min`/`date.max`. Date-only, microseconds, 4 fraction digits, no seconds, lower-case `t`/`z`, hour 24, second 60, offsets `+24:00` and `+99:99`, month 13, a comma fraction and epoch milliseconds → `date.format`. Controls answer 200: `±int4` bounds, `1e3`, `" 12 "`, `-0`, `1.0`, U+0001, a lone surrogate, 200 characters, years 0001 and 9999, `+05:30`. `2026-02-30T00:00:00Z` is 200 (JavaScript rolls it over to 2 March): a date Joi normalises, not a database error. The validate slot answers V16 (NUL), V17 (date-only) and V18 (beyond `int4`) as `VALIDATION_ERROR` with the `/query/filter[...]` pointer and no value echo. Mutants M8 to M12 are killed |
| PR045-SEC-03 (C3) | **Closed** | `list-query.ts:199-211`. P2: 23 of 23 variants as specified. `INVALID_CURSOR` for organisation, actor, guest hash, operation, `actorScope`, `credential`, sort, filter value, extra filter, `q` changed, `q` removed, another route key flipped (`archived`), a route key added (`since`), a path parameter changed, removed or renamed with the same value. Accepted: the same request, `limit` changed, `include_total` added, any-of reordered or duplicated, and `archived` given as the boolean instead of the string. Also accepted, because nothing in them crosses scope: `permissions` and the route's `tenancy` (each page re-applies the caller's scope; the operation id is bound). Canonical form: a `q` holding JSON metacharacters (`acme"],["x`) gives a different binding (no injection into the outer array), and one instant in two offsets gives the same binding. Unit tests: one row per member (13 rows); mutants M1 to M6 are killed (actor scope, credential, path parameters, route keys, `q` as a list key, guest hash) |
| PR045-SEC-04 (F1) | **Closed in code**; consumer residual PR045-SEC-09 | `cursor.ts:70-73`, `:93`: at most 4 keys, each a `[0-9A-Za-z :.+_-]{1,48}` token or a safe integer; key kinds are declared per sort field (`timestamp`, `integer`, `uuid`) and checked at load and in `pageOf` (`page.ts:59`). P2: the largest cursor (4 × 48-character keys, a 64-character id) is **448 characters** and decodes. Encode throws (a programming error) for 5 keys, 49 characters, an empty string, `/`, `"`, a backslash, `é`, NUL, `,`, `%`, a newline, `1.5`, `2^53`, NaN, a bigint and a boolean. Decode (key holder, MAC-authentic payloads) refuses 5 keys, a 49-character key, a quote and a float with `INVALID_CURSOR`. No free text and no personal data can enter a cursor. Mutants M15 to M19 are killed |
| PR045-SEC-05 (F2) | **Closed in code**; the runbook line is still unowned | `cursor.ts:170`. P2: a 10-year expiry is refused under both the current and the previous key; `now + 1 h + 61 s` is refused, `now + 1 h + 59 s` accepted; a 10-minute codec refuses `now + 11 min + 1 s`. A cursor is accepted at 1 h - 1 s and refused at 1 h. One issued by an instance 59 s ahead is accepted, one issued 62 s ahead is refused (a functional limit that assumes NTP; no security effect). Mutants M13 (cap removed) and M14 (skew ×10) are killed. The rotation-runbook line ("remove `CURSOR_KEY_PREVIOUS` one hour after rotation") was routed to devops by D-SECPR045-01, but no card or runbook holds it yet (§R2.8) |
| PR045-SEC-06 (F3) | **Open (INFO), routed and carded** | P1 R3: on a connection not subject to RLS, a foreign boundary id still positions the walk (200, 10 items). This is unchanged and expected: the native cursor is unchanged. The conditions are on the TASK-073 card (AUDIT LIST ON THE KEYS PATH, D-SD-011 `41bcb54a`: keys path or a same-scope lookup, bound parameters, operator scope as a filter). The ADR-0018 register wording stays with principal-architect |
| PR045-SEC-07 (F4) | **Contract half closed**; module half routed to TASK-096 (D-ORCH-150) | `list-contract.ts:91` `isAuditList` = tag `audit` AND a path under `/audit/`. P3: the real contract has 0 findings (27 list operations; the audit lists are `/audit/entries` and `/audit/entities/{entityName}/{entityId}/history`). A business list with an `audit` tag at 200 is refused. `defineListSpec({ ceiling: 'audit' })` is still accepted on any route. That part is INFO, bounded at 200, and owned by TASK-096 |
| C4 | **Open: merge condition** | Lane B on `3168c194` (§R2.8 lists the cases) |
| C5 | **Open, carded** | Part 045-C on the TASK-045 card (D-SD-011): the codec is built once in the composition root, with its own security round, and merges before TASK-073 opens its PR |
| F5 | **Open** | principal-architect: NUL refusal for every request string in the validate slot, before G3 |

**No new path answers 500 or echoes a value** (P1, P2):

- The new refusals are `AppError('INVALID_CURSOR')` and Joi errors that map to `VALIDATION_ERROR` or `INVALID_FILTER`. V1 to V18 carry no random sentinel key or value.
- `canonicalEntries` calls `JSON.stringify` on validated route inputs. `params` is always an object (`validateRequest` validates `{}` when there is no schema, `validate.ts:197`), and Joi produces no BigInt or circular values, so the call cannot throw.
- The only new plain `Error` paths are `checkedKeys` (`page.ts:59-71`) and `encode` bounds. Both are reachable only by a consumer that passes `keysOf`, and none exists yet. See PR045-SEC-09 for the row-data case.
- `hasUnknownFilter` now reads the whole query error before the 50-issue cap. V15 (60 unknown keys, then an unknown filter) answers `INVALID_FILTER`, and mutant M20 is killed. A refusal is still a refusal (V8, V9).
- ReDoS: the new patterns scale linearly on request input, at 1 KiB versus 16 KiB. String NUL at the end: 1.1×. Timestamp near-miss digits: 2.6×. Timestamp garbage: 1.2×. Long integer digits: 4.1×, below the 16× of the input growth.

**The int-test RLS setup is sound** (`list-keyset.int.test.ts:43-70`, `:212-231`; replayed as P1):

- `CREATE SCHEMA platform` and `GRANT USAGE` run before the released migration. The migration needs only that schema and `platform_app`, which `createAppRole` creates first. It revokes PUBLIC EXECUTE on the helpers and grants it to `platform_app`.
- The policy is `FOR SELECT TO platform_app` over `platform.app_org_id()`. That helper reads `app.org_id` and returns NULL when it is unset or malformed. R0b confirms that a missing setting returns 0 rows.
- The table is owned by the superuser with `ENABLE` (not `FORCE`), so the superuser seeding and `truth()` bypass RLS by design while `platform_app` is bound.
- The test `the tenant policy binds platform_app` (count = 12 for ORG_D, out of 87 rows) is the positive control that RLS is in force before the RLS-moved case relies on it. Without RLS, that case would return rows and the test would fail, so it really proves RLS.
- `import.meta.url` in a Jest suite has precedent in lane B (`audit/composition.int.test.ts`).
- As the code review notes, a failure in the new `beforeAll` statements fails the whole file on lane B. Treat it as a finding, not a flake.

## R2.4 New findings

### PR045-SEC-08 (LOW, latent): the default integer range does not fit `smallint` columns (= code review R2-m1)

- **CWE / OWASP:** CWE-1284 (Improper Validation of Specified Quantity in Input); A03:2021.
- **Where:** `apps/api/src/platform/pagination/list-spec.ts:59-64` (optional `min`/`max`), `:182-185` (`integerFilterRange` defaults to `INT4_RANGE`), `list-query.ts:75-78`.
- **Evidence (P4, real client and adapter, PostgreSQL 17.5).** An `integer` filter on `Invitation.sendCount` (`@db.SmallInt`), default range:

  | Value | Result |
  |---|---|
  | `1` | 200, 1 row |
  | `32767` | 200, 0 rows |
  | `32768`, `40000`, `-32769` | **500 `DB_ERROR`**, SQLSTATE `22003`, Prisma `P2020` |

  The same filter with `min: -32768, max: 32767` declared answers 400 (`number.max`, `number.min`). Prisma maps `@db.SmallInt` to `Int` and sends the parameter untyped, so PostgreSQL types it as the column. This matches the code review's probe.
- **Exploitability and impact.** This is the PR045-SEC-01 class: a client-driven 500 with one request, no data exposure, error-rate noise that a canary's rollback trigger can see. It is latent: no list route exists, and the schema has `smallint` columns (`send_count` today; the data model lists more) that no planned list filters yet. D-TASK045-11 ("a filter value the schema accepts is one the column accepts") holds only for `integer` columns by default. Impact low, likelihood low once a route exists: LOW.
- **Remediation (preferred, as R2-m1).** Make `min` and `max` required for `kind: 'integer'` in `filterProblems`, so a declaration without a range fails at module load. `INT4_RANGE` then becomes the constant an `int4` column spells out (`{ column: 'version', kind: 'integer', ...INT4_RANGE }`), and `SMALLINT_RANGE` is added beside it. Acceptable alternative: keep the default and state in the `FilterFieldSpec` doc and the module header that a `smallint` column must declare its range, with the line on the first consumer's card.
- **Routing (this round's ruling, asked for by D-ORCH-150).** Both forms are acceptable for security. **Route it to part 045-C** (the next pagination change, with its own security round, merged before any list route is mounted, C5), so TASK-045 needs no new head and no second lane-B run. If senior-developer fixes it in TASK-045 instead, that commit needs a delta round.
- **Verification.** Unit: a declaration without a range is a `ListSpecError`. Api: a `smallint`-backed fixture filter refuses `32768` with 400 and the pointer. PostgreSQL 18: `32767` answers 200. Mutation: dropping the required-range check fails a test.

### PR045-SEC-09 (INFO, latent): keys-path timestamp keys are row-data dependent outside the `TIMESTAMP_TEXT` grammar (= code review R2-n2, widened)

- **CWE / OWASP:** CWE-1284; CWE-400 (a stored, page-local 500); A04:2021.
- **Where:** `apps/api/src/platform/pagination/page.ts:47` (`TIMESTAMP_TEXT` requires 4-digit years and an offset without seconds), `:57` (the comment says "never row-data dependent"), `:59-71` (`checkedKeys` throws a plain `Error`).
- **Evidence (P2).** A sort field declaring `key: 'timestamp'`, with `keysOf` returning PostgreSQL's own `timestamptz::text`:

  | Key value | Result |
  |---|---|
  | `2026-11-21 12:00:00.123456+00`, `+05:30`, ISO `Z` | encodes |
  | `10000-01-01 00:00:00+00`, `0001-12-31 23:59:59+00 BC`, `infinity`, `1800-01-01 00:00:00+05:53:28` (an LMT offset when the session `TimeZone` is not UTC; `EXPECTED_ROLE_SETTINGS` does not pin `TimeZone`) | plain `Error`, so 500 |
  | An integer key of `2^53` (a `bigint` sequence past the safe range) | plain `Error`, so 500 |

  **Widened: the write path.** Joi's `date().iso()` accepts extended years: round 1's head took `+010000-01-01T00:00:00Z` as a filter, P1 E6b. PostgreSQL stores years up to 294276. So any body field validated by a plain `Joi.date().iso()` can store a year-10000 value. If that column is ever a keys-path sort key, every page that ends on that row answers 500 for every caller listing it. This is the stored, page-local denial-of-service class of PR045-SEC-04.
- **Impact.** Latent and narrow. The first keys-path consumer is TASK-073, and `audit_entries.occurred_at` is set by the server, so it cannot hold these values. INFO.
- **Remediation (consumer condition, with the PR045-SEC-04 and PR045-SEC-06 lines on the TASK-073 card).**
  - (a) A timestamp key comes only from a column the server sets, or from one bounded to the years 0001..9999 on write (a CHECK, or the PR045-SEC-01 bounds on the body field).
  - (b) The key text is rendered explicitly in UTC (`to_char(col AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')`) or as epoch microseconds through the `integer` kind, never through the session `TimeZone`.
  - (c) Integer keys come from `int4`/`int8` columns whose values stay within the safe integers.
  - Optional in part 045-C: reword `page.ts:57` to "never row-data dependent for keys from bounded columns".
- **Verification.** TASK-073's keys-path test uses a boundary whose `occurred_at` has microseconds (already on its card). A unit case in part 045-C, if (a) becomes a declaration flag, shows that an unbounded column is refused at load.

## R2.5 Concurrence with code review round 2

| Code review item | Security view |
|---|---|
| R1-M1 closed; D-TASK045-10 accepted | Concur: PR045-SEC-02 is closed (§R2.3). The uniform answer was probed across six causes |
| R2-m1 `smallint` | = **PR045-SEC-08** (its own row, LOW latent; PR045-SEC-01 closes for the classes it found). Route to part 045-C (preferred form: a required range) |
| R2-m2 README wording (`INVALID_CURSOR` also means "restart") | Concur. No security effect beyond client UX. It rides the TASK-073 CONTRACT RIDERS |
| R2-n1 move-back case unpinned | No security view (R1-m1 class, integrity only) |
| R2-n2 timestamp key text | = **PR045-SEC-09** (INFO), widened by the write path and by the integer-key case |
| R2-n3 model binding is opt-in | Concur. Columns come from code either way, so a missing type argument is a 500 at request time, not an injection |
| D-TASK045-11, -12, -13, -14 | Concur. -11 with PR045-SEC-08; -13 with PR045-SEC-09; -14 replayed on PGlite (§R2.3) |
| R1-m1 dispatch gate, R1-n3 / PR045-SEC-07 module side to TASK-096 (D-ORCH-150) | Concur. The audit ceiling stays bounded at 200 until TASK-096 |

## R2.6 Routing

| ID | Item | Owner | Due |
|---|---|---|---|
| C4 | Lane B green on `3168c194` (cases in §R2.8) | orchestrator (lane B) | Before merge |
| C5 | Part 045-C: the codec is built once in the composition root, with its own security round (carded) | senior-developer (part 045-C) | Before the first list route is mounted, and before TASK-073 opens its PR |
| F2' | The PR045-SEC-05 rotation-runbook line ("remove `CURSOR_KEY_PREVIOUS` one hour after rotation; the codec refuses any expiry beyond lifetime + 60 s"). It has no holder yet: add it to the part 045-C card (the codec's wiring and configuration notes), and devops writes the runbook entry | orchestrator (card line); devops | With part 045-C |
| F3 | PR045-SEC-06 conditions | TASK-073 (carded, `41bcb54a`); principal-architect (register wording) | TASK-073 merge; next ADR-0018 fold |
| F4' | PR045-SEC-07 module side | TASK-096 (D-ORCH-150) | With TASK-096 |
| F5 | NUL refusal in the validate slot for every request string | principal-architect | Before G3 |
| F6 | PR045-SEC-08: a required integer range (preferred), with the tests in §R2.4 | senior-developer (part 045-C) | Part 045-C merge |
| F7 | PR045-SEC-09 conditions (a) to (c), as one more line on the TASK-073 card's AUDIT LIST ON THE KEYS PATH rider, next to R2-n2 | orchestrator (card fold) | TASK-073 dispatch |

**SEC-TC proposals** (unchanged from round 1, for qa-lead's manifest commit after merge): SEC-TC-82 now also lists the deleted, foreign and RLS-moved boundary 400s, and the actor-scope, credential, path-parameter and `q` members. SEC-TC-83 gains the `smallint` case once F6 lands.

## R2.7 What did not change

The MAC construction, constant-time verification, key handling, rotation and the `local-only-*` separation are unchanged since round 1 (`cursor.ts` changed only `isKeyValue`, the key constants and the decode cap). A tamper fuzz on a cursor that carries keys tried 38,502 single-character mutants and accepted **0**; the authentic control decodes.

## R2.8 Lane B cases for C4

On `3168c194`. A later head needs a delta round first.

- **`apps/api/src/platform/pagination/pagination.api.test.ts`:**
  - AT-US-037-01, -02, -03-1, -03-4, -05, -06, -07 and -10;
  - PR045-SEC-03: the actor, `q` and no-`q` cases each answer 400 `INVALID_CURSOR`;
  - R1-M1 / PR045-SEC-02: a deleted boundary answers 400 `INVALID_CURSOR` with the catalogue detail;
  - PR045-SEC-01: the six rows (U+0000, `3000000000`, `-2147483649`, year 0000, date-only, sub-millisecond) each answer 400 `VALIDATION_ERROR` with the exact pointer and sub-code;
  - the controls (int4 maximum, years 0001 and 9999) answer 200.
- **`apps/api/src/platform/pagination/list-keyset.int.test.ts` (PostgreSQL 18, Testcontainers):**
  - the `beforeAll` setup (`CREATE SCHEMA platform`, the released helpers migration, the policy) must apply;
  - AT-US-037-01, -02, -05 and -10, and the status-change boundary;
  - the policy probe (12 rows for ORG_D);
  - the deleted boundary answers 400, then a fresh walk equals the truth;
  - the RLS-moved boundary answers 400, then after the move back the same cursor continues exactly;
  - the int4 and year controls answer 200.
- The generated suites (RBAC matrix, audit, RLS, abuse) and the `validate` api tests stay green with the slot change.

## R2.9 Record binding

Main's real checker (`tools/ci/check-security-owned-paths.mjs`) ran in a sparse shared clone, in merge-ref form: the record committed on a main commit, then `git merge-tree` with the head and `commit-tree`, `--pr 9999`. The record content was this file with round 2 appended, under the name `PR-9999-TASK-045-security-review.md`:

| Scenario | Expected | Result |
|---|---|---|
| S1 record on main merged with the head (`--base` = merge base `530629f4`) | pass | pass, 16 owned, satisfied by `3168c194` |
| S1b the same with `--base` = the main tip that carries the record | pass | pass, satisfied by `3168c194` |
| S2 a docs-only evidence commit after the head | pass | pass |
| S3 an unowned edit after the head (`tools/openapi/list-contract.ts`) | pass | pass |
| S4 the branch merges a docs-only main | pass | pass |
| C1 no record | missing | missing |
| C2 the record only under this `PR-pending` name | missing | missing: the orchestrator renames it once the PR exists |
| C3 a later FAIL verdict row | missing | missing |
| C4 round 2's Head row naming a main commit (round 1's `b380f429` row stays) | missing | missing: round 1's head has owned changes after it |
| C5 an owned edit after the head (`pagination/page.ts`) | missing | missing: a later head needs its own round |
| C6 the branch merges a main that also changed `validate.ts` (union) | missing | missing: such a merge needs a merge-only round |
| C7 round 1 alone (the record before this section) | missing | missing: `b380f429` names a commit with 16 owned changes after it |

12 of 12 as expected (main tip `a385cc9c`). The combined record has two `Head` rows (`b380f429`, `3168c194`) and two `Verdict` rows; the last row is this round's.

## R2.10 Verdict

| Field | Value |
|---|---|
| Verdict | PASS_WITH_CONDITIONS. No Critical, High or Medium finding open at `3168c194`. Closed: PR045-SEC-01 (classes found), -02, -03; -04 and -05 in code; -07 contract half. Open: LOW latent PR045-SEC-08 (= R2-m1, routed to part 045-C), INFO PR045-SEC-06 (TASK-073 card), INFO PR045-SEC-07 module half (TASK-096), INFO PR045-SEC-09 (= R2-n2, TASK-073 card). Merge condition C4: lane B green on `3168c194`. C5 and F2' ride part 045-C |
