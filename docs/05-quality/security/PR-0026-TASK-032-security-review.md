# PR-0026 / TASK-032: change-scoped security review (server-controlled standard columns, UTC time and the on-behalf seam: Prisma query extension, `withTenantTx` `scopeClient`, UUIDv7 helpers, `catalog-std`)

| Field | Value |
|---|---|
| PR | #26 `feat(api): server-controlled standard columns, utc time and on-behalf seam (TASK-032)`, https://github.com/sukhchdit/shipcube/pull/26 (US-064, REQ-RLS-009 / REQ-RLS-012 / REQ-ORG-007, NFR-DATA-002 / NFR-DATA-003, data-model §7.6, ADR-0005 am. 10 item 5 (SPK-03 F-05), D-TASK032-01..03) |
| Branch | `feat/TASK-032-server-controlled-standard-columns-utc`: four feature commits (`44f9eec` shared ids, `b727090` extension, `ff7b349` `catalog-std`, `b90e874` decisions) and four merges of main on the merge base `ddbeb49`; 18 files, +1 703 / -7, equal to `gh pr view` |
| Head | 84b70c4216ae6dd58a120b69fd333298ee276d73 |
| Main now | `6d12b24` at the end of the review (PR #28 merged as `ab42cc6` while I worked, activating five suites). Since the merge base `ddbeb49` main changed `docs/**`, `.claude/**` and two CODEOWNERS paths, `tools/quality/activation.test.ts` and `tools/quality/required-suites.json`; neither is in this PR's net change, so a merge of main keeps this record valid (§7 case D, run against `6d12b24`). PR #28's activation adds a lane-B evidence requirement for this PR's merge (D-ORCH-034; evidence lives under unowned `docs/05-quality/tests/runs/**`) |
| Security-owned paths changed (CODEOWNERS, as lane A run 43379147023 computed them) | `package-lock.json`, `tools/tsconfig.json` (2). **`apps/api/src/platform/db/**`, `packages/shared/**` and `prisma/tests/**` are not in CODEOWNERS** (PR26-SEC-07); the dispatch premise "with-tenant-tx.ts is security-owned" holds for D-ARCH-021's security-critical set, not for the record check. I reviewed all 18 files regardless |
| Dependencies / workflows | `uuid ^14.0.3` added to `packages/shared/package.json` and the matching `packages/shared` entry in `package-lock.json` (the only lock hunk, +4 / -1). `.github/**`, `tools/ci`, `tools/lint`, `tools/eslint-rules`, `eslint.config.mjs`, `.npmrc`, `.gitleaks*`, `.semgrep*`, CODEOWNERS are byte-identical to the merge base (three-dot diff empty). **No D-ORCH-021 lever moves** (§3.9) |
| Binding items checked | data-model P1/P2/P4, §1.6, §7.6, §4.1; ADR-0005 am. 10 items 1, 2, 5, 12, 16; ADR-0009 item 1 and 6; threat-model T-33 (mass assignment "including nested objects"), SEC-C03; US-064; D-TASK032-01..03; D-ARCH-080 (SYSTEM delegates, no interaction); D-ORCH-021; PR11-SEC-01/09/12/13 (TenantDb), PR24-SEC-04 (CODEOWNERS), code review r1 (`docs/05-quality/reviews/PR-0026-TASK-032-code-review.md`, security flags) |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. In the `Shipqube-TASK-032` worktree I ran no command and read no file. Everything came from `git show` / `git archive` of the head in the main checkout, probed in scratch extracts and one scratch `git clone --shared`. In the main checkout: `git fetch origin` (twice), read-only git, read-only `gh pr view` / `gh run view` / `gh pr list`. Network: anonymous registry GETs for `uuid` (packument, signature keys, advisory bulk endpoint). Docker was not used; lane A run 43379147023 and the developer's gate table stand for lint, typecheck, unit, build, integration and `catalog-std` (I did not re-run the heavy suites). The scratch extracts, the generated probe client, clones and `node_modules` junctions are removed at the end |

## 1. Summary

**The extension does what D-TASK032-02 and data-model §7.6 ask on every write operation, the stamp cannot be spoofed from repository input, and the `TenantDb` / leak-detector / latch machinery is untouched.** I found no Critical, High or Medium issue. Three LOW and five INFO items are follow-ups; none blocks the merge, and the cheap ones can ride a light fix cycle on unowned paths without voiding this record (§7 case D2).

- **Server fields in repository input are refused before any statement, for every write operation.** On a tenant-like model (`org_id`, `on_behalf_of_org_id`, relations) run through the real extension, the real `withTenantTx` and the real Prisma 7.10.1 client over a recording driver adapter: `create`, `createMany`, `createManyAndReturn`, `update`, `updateMany`, `updateManyAndReturn` and both `upsert` branches reject `id`, `orgId` (other than the transaction's), `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `version` and `onBehalfOfOrgId` with `AppError VALIDATION_ERROR / UNKNOWN_FIELD` and no statement but `ROLLBACK`; nested `create`, `createMany`, `connectOrCreate`, `upsert`, `update`, `updateMany`, `delete`, `deleteMany`, `set` give `NESTED_WRITE_UNSUPPORTED` (§3.1).
- **Two routes are not closed: relation-form `connect` and raw SQL.** `connect` on an FK-bearing relation changes `org_id` / `on_behalf_of_org_id` on update (`SET "org_id" = $4` reached the adapter), and `connect` on a to-many relation updates the child row without stamping it. **PR26-SEC-01 (LOW)** (the code review's m2, widened). A tagged `$executeRaw` can write any `created_by`, `updated_by`, `version`, and the database enforces none of them. **PR26-SEC-03 (LOW)** (§3.2, §3.3).
- **The stamp is bound to the transaction closure.** 200 interleaved transactions with distinct organisations and actors: 200 of 200 inserts and 200 of 200 updates carry their own stamp, 0 statements outside a transaction. `scopeClient` runs after context validation and receives the validated, lower-cased values (§3.4).
- **The wiring is the weak point, not the extension.** `scopeClient` is optional (`?? client`), `runtime.ts:211` is pinned by no test, and an empty or unknown catalogue passes writes through. With the wiring removed, updates silently stop being stamped and forged `version` / `updatedBy` persist (mutation run). **PR26-SEC-02 (LOW)** (the code review's m1 + m3) (§3.6).
- **`uuid` 14.0.3 is clean.** MIT, no dependencies, no install script, lock integrity equal to the registry's, both registry signatures valid (tamper control invalid), SLSA provenance attached, no advisory (positive control fires on 11.1.0 and 13.0.0), published 2026-10-10 (34 days, `min-release-age=7`), already in the tree for `apps/api` and `apps/worker`. Entropy is a CSPRNG; the in-code "74 random bits" is 73 at a new millisecond and 42 within one (**PR26-SEC-05, INFO**) (§3.7).

**Rulings on the focus questions** (details in §3):

| | Question | Ruling |
|---|---|---|
| (a) | Server fields refused before SQL for every write operation? Raw queries? | **Yes for every Prisma write operation and every scalar form; no for relation-form `connect` (SEC-01) and raw SQL (SEC-03).** §3.1-§3.3 |
| (b) | Stamp from the server closure? `orgId` equal-to-transaction check? On-behalf pinned NULL, DB-level? | **Closure-bound, proven under concurrency.** `orgId` is tolerated only when equal (case-folded) on create, refused on update and in an org-less transaction. On-behalf is stamped NULL on create; the database pin (`CHECK … IS NULL`) is a `catalog-std` rule that has no instance yet (no table carries the column), and the relation form bypasses the extension (SEC-01). §3.4, §3.8 |
| (c) | RLS interaction; no client escapes the transaction? | **Yes.** All statements run on the transaction connection (0 on the root connection over ~270 transactions); the extension issues no query; `TenantDb` surface identical. §3.5 |
| (d) | `with-tenant-tx.ts` change preserves the deny-by-default proxy, leak detector and latch? | **Yes.** The runtime change is two lines plus a type; nothing in `tenant-db.ts`, the context statement, `hasLeakedContext` / `reportLeak` or `probeFreshConnection` moved. §3.5 |
| (e) | UUIDv7 randomness; reserved actor IDs unusable by real users? | **CSPRNG, unique over 10^6, monotonic per process; ids are not secrets.** Real users get server-generated ids with a current timestamp, so a reserved id (timestamp 0) cannot be generated; nothing in `withTenantTx` stops a *context* from carrying one (**PR26-SEC-04, INFO**). §3.4, §3.7 |
| (f) | `uuid` dependency and lock delta? | **Clean.** §3.7 |
| (g) | `catalog-std` as a control? | **Sound with one hole.** Every rule is one query plus one pure function with planted controls; exemption lookups use `in`, so tables named like `Object.prototype` members are exempt (**PR26-SEC-06, INFO**). §3.8 |
| (h) | D-ORCH-021 levers; secrets? | **None moved; none added.** §3.9 |

Findings: **3 LOW and 5 INFO**, none blocking. No Critical, High or Medium.

## 2. Method

| Probe | What it did | Result |
|---|---|---|
| P1 | The PR head's `apps/api` and `packages/shared` sources, type-stripped (`stripTypeScriptTypes`, transform mode), with a Prisma 7.10.1 client **generated offline from a tenant-like schema** (`Org`, `Shipment` with `org_id`, `on_behalf_of_org_id`, relations, `Parcel`) and a recording fake driver adapter (`ROOT-conn` vs `TXn` tags). 45 write cases through the real `createWithTenantTx` + `withStandardColumns` | §3.1, §3.3 |
| P2 | Relation-form routes with an adapter that answers `SELECT` / `RETURNING` so Prisma proceeds to its follow-up statements; raw Prisma errors printed | `org: { connect }` and `onBehalfOfOrg: { connect }` on update reach `SET "org_id"` / `SET "on_behalf_of_org_id"`; to-many `connect` issues `UPDATE "parcels" SET "shipment_id"` with no stamp (§3.2) |
| P3 | What the runtime data model carries per relation field | `name`, `kind`, `type`, `relationName` only: no `relationFromFields`, no cardinality, `dmmf` empty |
| P4 | 200 interleaved transactions with distinct stamps; `scopeClient` call count; invalid context; reserved and empty actors; `TenantDb` surface; nested and kept-handle behaviour; cost of one `$extends` | §3.4, §3.5 |
| P5 / P5b | Production composition `createDatabaseRuntime` (with a client class that returns the probe client) on the head build and on a **mutated build with the `scopeClient` line deleted**; a runner built without `scopeClient` | §3.6 |
| P6 | `catalog-std` pure functions, extracted from the head, with prototype-named tables and CHECK forms | §3.8 |
| P7 | `uuidv7()` over 10^6 ids: format, uniqueness, order, layout, entropy; reserved ids | §3.7 |
| P8 | Hostile payload shapes: JSON-parsed `__proto__` own key, inherited, non-enumerable, accessor and `undefined` fields; `{ increment }` / `{ set }` wrappers; org-id case and padding | §3.1 |
| P9 | `uuid@14.0.3`: lock integrity, both ECDSA signatures with a tampered-integrity control, provenance, install scripts, advisory bulk endpoint with positive controls | §3.7 |
| P10 | Lane A's record step, simulated with main's checker in a scratch shared clone, 14 scenarios | §7 |
| Lane A | Run 43379147023 on the exact head: `fast-lane` success (workflow policy, install flags, migration immutability, lockfile provenance and delta, release cooldown, licences, registry signatures and provenance, `npm audit` + osv-scanner, lint, format, actionlint, typecheck, unit, build, clean tree); `scans`: gitleaks (PR range) success, Semgrep success, record step failure (expected) | relied on |

## 3. Rulings

### 3.1 Mass-assignment defence per operation (question a)

`stampArgs` (standard-columns.ts:181-212) validates every payload of the call, then rewrites; `$allOperations` rejects (never throws synchronously) and does not call `query` for a refused write. Probe P1 on the real client:

| Operation | Benign | Forged field | Outcome |
|---|---|---|---|
| `create` | INSERT with `id` (UUIDv7), `created_at = updated_at`, `created_by = updated_by = actor`, `version = 1`, `org_id` = transaction org, `on_behalf_of_org_id = NULL` | `createdBy`, `orgId` (other), `onBehalfOfOrgId`, `version`, `id`, `createdAt` | `VALIDATION_ERROR / UNKNOWN_FIELD` at `/body/<snake_name>`, no statement |
| `create`, `orgId` equal to the transaction's | tolerated, overwritten with the stamp (upper-case accepted, trailing space refused, `{ set: org }` wrapper refused) | | |
| `createMany` / `createManyAndReturn` | one stamped row per element, distinct time-ordered ids | forged field in the second row | refused as a whole, one issue per field in canonical order |
| `update` / `updateMany` / `updateManyAndReturn` | `SET …, updated_by, updated_at, version = version + 1` | `version`, `updatedBy`, `createdBy`, `orgId` | refused |
| `upsert` | create branch stamped like `create`, update branch like `update` | forged field in either branch | refused |
| nested `create`, `createMany`, `connectOrCreate`, `upsert`, `update`, `updateMany`, `delete`, `deleteMany`, `set` on a relation field | | | `DbError 500 NESTED_WRITE_UNSUPPORTED`, no statement |
| `delete`, `deleteMany`, reads | pass through by design (TASK-100) | | |

Shapes (P8): the extension sees Prisma's clone of the arguments, so an inherited or accessor `createdBy` arrives as an own property and is refused; a non-enumerable one is dropped by Prisma's copy of the arguments and never reaches the SQL (the insert carried the stamp); a JSON-parsed `__proto__` own key does not change any column or any prototype; `createdBy: undefined` is refused. A snake_case key (`created_by`) in repository input is a Prisma "unknown argument" (500), not a 400: the 400 belongs to the HTTP slot (TASK-020). Error text carries field names only, never values.

**Operations other than the above:** none of Prisma 7.10's model actions writes through another name; the `TenantDb` allow-list (`MODEL_OPERATIONS`) and the extension's two sets agree.

### 3.2 Relation-form writes (question a, nested)

D-TASK032-02 refuses nested writes "because Prisma runs no extension for nested rows" and allows `connect` / `disconnect`, with the comment "relation-field operations that write no row of the related model" (standard-columns.ts:60). Probes P2 and P3 show that comment is false in two ways, and that the extension cannot tell which relation backs which FK (the runtime data model has no `relationFromFields`):

1. **A relation whose FK is a server column.** `update({ data: { org: { connect: { id: other } } } })` passes the extension and issues `UPDATE "shipments" SET "updated_by" = $1, "updated_at" = $2, "version" = (…+ $3), "org_id" = $4`; `onBehalfOfOrg: { connect }` likewise sets `"on_behalf_of_org_id"`; both through `upsert.update` too. The scalar form of the same write is refused (control). On create the mixed checked/unchecked input is rejected by Prisma (`Unknown argument`), so create fails closed (as a 500, not a 400). Backstops once a tenant table exists: the TENANT template's `FOR ALL … WITH CHECK (org_id = platform.app_org_id())` stops a re-parent in every scope (the operator branch is SELECT-only), and the `CHECK (on_behalf_of_org_id IS NULL)` that `catalog-std` demands stops the seam. Neither exists on main today, because no tenant model does.
2. **A to-many (or non-owning one-to-one) relation.** `shipment.update({ data: { parcels: { connect: [{ id }] } } })` and `shipment.create({ data: { parcels: { connect } } })` issue `UPDATE "parcels" SET "shipment_id" = $1 WHERE "id" = $2`: a row of another model is written with no `updated_by`, `updated_at` or `version` stamp. That defeats the optimistic lock (TASK-100) and the attribution of the child row, and moves a row between parents through the parent's repository.

Both are the same defect (an allow-list that treats `connect` as a no-write) with the same fix: **PR26-SEC-01**.

### 3.3 Raw SQL path (question a)

`TenantDb` exposes `$queryRaw` / `$executeRaw` (tagged template only; PR11-SEC-13). They are not model operations, so no extension runs. Probe P1 E1/E2: `INSERT INTO shipments (… created_by, updated_by, version, org_id, on_behalf_of_org_id …) VALUES (<victim>, <victim>, 77, <org>, <other org>, …)` and `UPDATE shipments SET version = 1, org_id = <other>` reach the adapter unchanged. The database stops the `org_id` (RLS `WITH CHECK`, every scope) and the on-behalf value (`CHECK`), nothing else: `created_by` / `updated_by` are only `NOT NULL`, `version` only `>= 1`, and `id`, `org_id`, `created_*` are not immutable on UPDATE. The PR's "a raw INSERT cannot skip the stamping silently" is true and says nothing about forging. The `platform/db-raw-sql` lint polices the *shape* of raw calls, not DML. **PR26-SEC-03**.

### 3.4 Stamp binding, `orgId`, actors (question b, e)

- **Closure, not ambient state.** `withTenantTx` calls `deps.scopeClient({ orgId: values[0], actorId: values[1] })` with the validated, lower-cased bind values (the same two that become `app.org_id` / `app.actor_id`), after `contextValues` and the re-entrance check, and opens `txClient.$transaction`. P4 §1: 200 transactions with distinct org and actor, random delays: every insert and update carries its own stamp. P4 §2: upper-case input is stamped lower-case; an invalid actor throws `INVALID_TENANT_CONTEXT` and `scopeClient` is not called.
- **`orgId`.** Tolerated on create only when it equals the stamp (case-folded, no trim), overwritten with the stamp; always refused on update, in an org-less transaction, and for non-string values. Accepted as the documented deviation from §7.6's wording (code review n7).
- **On-behalf seam.** Stamped `null` on create for models that have the field; the scalar is refused on create and update. The relation form is SEC-01. `catalog-std` pins the database side (§3.8).
- **Reserved actors.** The generator cannot produce `…-7000-8000-000000000001/2` (timestamp 0; none among 10^6 generated). Nothing stops a *context* from carrying one: P4 §2 accepted `SYSTEM_ACTOR_ID` under `TENANT` scope, and an empty actor under `OPERATOR` scope is stamped as the anonymous actor. The rules belong to the context builder and the `users` table: **PR26-SEC-04**.

### 3.5 RLS interaction and the `with-tenant-tx.ts` change (questions c, d)

- **Diff.** `with-tenant-tx.ts`: `+TransactionStamp`, `WithTenantTxDeps<TTx = unknown>`, the optional `scopeClient`, and in `withTenantTx` two lines (`const txClient = deps.scopeClient?.(…) ?? client;` and `txClient.$transaction(…)`). `createTenantDb(tx)` / `handle.revoke()` in `finally`, `setTenantContext`, `hasLeakedContext` → `reportLeak` (counter, event, `markNotReady`), `probeFreshConnection` (root client), `assertNoSessionOptions` and `tenant-db.ts` are unchanged.
- **Extension inside the transaction.** The context statement is the first statement of every transaction and every model statement follows on the same `TXn`; 0 statements on the root connection across the ~270 transactions of P1/P4/P5. The extension only rewrites arguments (it never calls the client), so it cannot open a second connection.
- **`TenantDb` surface with the extended client (P4 §3).** `ownKeys(db)` = model delegates + `$queryRaw` + `$executeRaw`; `$extends`, `$parent`, `$transaction`, `_originalClient`, `delegate.$parent` throw `TenantDbAccessError`; a non-tagged call to `$queryRaw` / `$executeRaw` is refused; a delegate kept past commit gives `TENANT_TX_CLOSED`; a nested `withTenantTx` gives `NESTED_TENANT_TX`. The extended client itself never leaves `createWithTenantTx`.
- **Cost.** One `$extends` per transaction: 14 µs, no retained heap after GC (20 000 iterations). No DoS lever.
- **`scopeClient` throws** before the `try`, so the error is unmapped; acceptable for a composition defect (code review §2).

### 3.6 Wiring fails open (PR26-SEC-02)

- `WithTenantTxDeps.scopeClient` is optional and `?? client` falls back to the unextended root client (with-tenant-tx.ts:93, :334). The comment says the server columns are then "left to the database (`NOT NULL`, no default: inserts fail)". That holds for a correct repository only: P5, a runner built without `scopeClient`, persisted `createdBy`, `updatedBy`, `orgId`, `version` and `id` supplied by the caller.
- `runtime.ts:211` is the only production wiring. Mutation: with that line deleted, a benign insert fails loudly (missing required column), but **a benign update succeeds without `updated_by`, `updated_at` or the version bump, and `updateMany({ data: { version: 7, updatedBy: <victim> } })` persists** (P5b). `runtime.test.ts` runs no write through `tenantTx` (`grep`: it only checks that `tenantTx` is present or absent), and no integration test builds the runner through `createDatabaseRuntime` with a write. The code review's mutation run agrees (230 of 230 `platform/db` unit tests stay green).
- An empty or unknown catalogue (a Prisma upgrade that renames the private `_runtimeDataModel`) makes `stampArgs` return the arguments unchanged: the doc's "fails closed" holds for omitted columns on insert, not for forged ones on update (code review m3).

### 3.7 UUIDv7 and the `uuid` dependency (questions e, f)

- **Source.** `uuid/dist-node/v7.js` + `rng.js`: 48-bit `Date.now()`, a 31-bit counter seeded from the CSPRNG at each new millisecond and incremented inside it, 42 fresh random bits per call (`crypto.getRandomValues`, node and browser entries alike). P7: 10^6 ids unique, all canonical lower-case v7 / variant `10xx`, strictly ascending in process, 100 % of same-millisecond neighbours have `seq = previous + 1`, 42-bit tails all distinct over 200 000 ids with bit balance 0.497 to 0.502.
- **Reading.** Unpredictable enough for keys. Given one id, a sibling from the same millisecond is guessable up to 42 bits; from another millisecond about 73 bits. Ids are not capabilities in this design (guest access is a separate token hash, RLS decides the rest), and they disclose the creation millisecond of anything with a public id (ADR-0009: "public identifiers in URLs are the UUIDs"). The code comment's "74 random bits" is wrong: **PR26-SEC-05 (INFO)**.
- **Dependency (P9).** `uuid@14.0.3`: MIT; published 2026-10-10; no runtime dependencies; `prepare` is a dev script and the lock entry has no `hasInstallScript`; lock integrity equals the registry's; two ECDSA signatures valid, tampered-integrity control invalid; SLSA provenance attestation; advisory endpoint: `{}` for 14.0.3 / 14.0.2 / 14.0.0, with GHSA-w5hq-g745-h8pq firing on 11.1.0 and 13.0.0 and a Playwright control firing; ESM-only with a `node` and a `default` export condition (the web apps get the browser build). `apps/api` and `apps/worker` already depend on `^14.0.3`. The lock delta is one hunk (`packages/shared` gains `dependencies.uuid`), with no other path changed (deep diff of the lock: one differing path).
- **Reserved ids are valid v7.** `isUuidV7(SYSTEM_ACTOR_ID)` is true (timestamp 0). Any code that uses `isUuidV7` to accept an externally supplied id would accept them; no such code exists yet (**SEC-04** checks).

### 3.8 `catalog-std` as a control (question g)

I read the suite and probed its pure functions (P6): each rule is one query plus one pure function, run on the committed catalogue and on rolled-back planted violations; exemption maps are asserted to be load-bearing; `time` is allowed and `timestamp` is not; `NOT ENFORCED`, `NO INHERIT` and OR-weakened on-behalf CHECKs are flagged while bare and `NOT VALID` forms pass (a `NOT VALID` CHECK is enforced for new rows). Two gaps:

- **`in` on exemption maps** (`standard-columns-scans.ts:164`, `:258`): `'constructor' in {}` is true, so a table named `constructor`, `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf` or `__proto__` is skipped by every standard-column and on-behalf rule (P6: 9 findings for an ordinary table, 0 for each of those). A migration author could hide a table from NFR-DATA-003 and the on-behalf pin by name. `prisma/migrations` is CODEOWNED, so this needs a malicious reviewed migration: INFO, **PR26-SEC-06**.
- **No bridge between database names and Prisma names.** The extension keys on Prisma field names (`createdBy`, `orgId`, …); the suite checks database columns. A model that maps `creatorId @map("created_by")` is neither stamped nor refused. Same item (a parity assertion over `_runtimeDataModel` `dbName`).

The suite is not yet a control for the first tenant model's `org_id` / on-behalf pair: no table carries either, so those rules have no instance (the code review reached the same conclusion).

### 3.9 Owned paths, levers, secrets (question h)

- **Owned paths.** `tools/tsconfig.json`: two `files` entries (`extensions/standard-columns.ts`, `db/index.ts`) and nothing else (no `compilerOptions`, `extends`, `references`, `include` or `exclude` change); it only widens the type-checked set. `package-lock.json`: §3.7. `packages/shared/package.json` (not owned): `dependencies` only, no `scripts` (workspace scripts run in lane A's `typegen`, PR4-SEC-13).
- **D-ORCH-021 levers.** `git diff origin/main...84b70c4 -- .github tools/ci tools/lint tools/eslint-rules .npmrc eslint.config.mjs .gitleaks.toml .gitleaksignore .semgrep .semgrepignore` is empty; the PR's added lines hold none of `RANGE_BASE`, `BASH_ENV`, `BASH_FUNC`, `GITHUB_ENV`, `GITHUB_PATH`, `defaults:`, `run: >`. Nothing for the orchestrator's pre-merge workflow check to rule on.
- **Secrets / PII.** Lane A's gitleaks (PR range) and Semgrep pass. The added tests use `randomUUID()` / `randomBytes()` and fixed reserved-id constants; DECISIONS.md is append-only (+16 / -0). Error messages and `DbError` reasons carry field names and codes, never values.

## 4. Findings

| ID | Severity | Title |
|---|---|---|
| PR26-SEC-01 | LOW | Relation-form `connect` / `disconnect` bypasses the server-field refusal (FK columns) and writes child rows unstamped |
| PR26-SEC-02 | LOW | Stamping is an optional, unpinned dependency, and an unknown catalogue passes writes through |
| PR26-SEC-03 | LOW | Raw SQL writes bypass the stamping and the database enforces none of the stamped values |
| PR26-SEC-04 | INFO | No rule keeps reserved actor ids and empty actors out of a context |
| PR26-SEC-05 | INFO | UUIDv7 entropy statement; ids are not capabilities |
| PR26-SEC-06 | INFO | `catalog-std` exemption lookups use `in`; no database-name / Prisma-name parity |
| PR26-SEC-07 | INFO | CODEOWNERS and lane A's record step do not cover `apps/api/src/platform/db/**`, `packages/shared/**` or workspace manifests (extends PR24-SEC-04) |
| PR26-SEC-08 | INFO | Consistency items for TASK-100 and TASK-020 |

### PR26-SEC-01 (LOW): relation-form `connect` / `disconnect` bypasses the server-field refusal and writes child rows unstamped

| | |
|---|---|
| CWE / OWASP | CWE-915 (improperly controlled modification of dynamically-determined object attributes), CWE-639; A08:2021 (T-33 uses A08), A01:2021 for the tenant key |
| Location | `apps/api/src/platform/db/extensions/standard-columns.ts:60-61` (`ALLOWED_NESTED_OPERATIONS`), `:124-132` (`assertNoNestedWrites`) |
| Description | §3.2. `connect` / `disconnect` are allowed on every relation. (1) On a relation whose FK is `orgId` or `onBehalfOfOrgId`, `update` / `upsert.update` set the server column that the scalar form refuses (probe P2 B3, B4, B5: `SET "org_id" = $4`, `SET "on_behalf_of_org_id" = $4`). (2) On a to-many relation, `connect` updates the child's FK with no `updated_by` / `updated_at` / `version` (P2 D1, D3). The runtime data model has no `relationFromFields` (P3), so the extension cannot single out the FK-backed relations. |
| Exploitability / impact | Needs a repository that passes an attacker-influenced relation object into `data`. T-33 names "nested objects" and expects a structural control; the module doc claims one. Part (1) is defence in depth: no tenant model exists yet, and RLS `WITH CHECK` plus the on-behalf `CHECK` will backstop both FK columns. Part (2) has no backstop: child-row `version`, `updated_by` and `updated_at` are skipped silently. Impact M × likelihood L = LOW. |
| Remediation | D-TASK032-02 already requires repositories to use the *unchecked* create inputs (scalar FKs), so no repository needs a relation field. Refuse every relation field, deny by default:<br>`function assertNoRelationWrites(model: StandardColumnsModel, data: PlainObject): void {`<br>`  for (const relation of model.relations) {`<br>`    if (data[relation] !== undefined) throw new DbError(dbErrorMapping(500, 'NESTED_WRITE_UNSUPPORTED'));`<br>`  }`<br>`}`<br>and delete `ALLOWED_NESTED_OPERATIONS` and its comment. If a use case needs `connect`, add an explicit `Record<ModelName, ReadonlySet<relation>>` allow-list that a schema test derives from `prisma/schema/*.prisma` (`@relation(fields: […])`) and that excludes FK-backed server columns and every to-many relation. |
| Verification | Unit: replace "connect / disconnect are allowed" with cases that `connect`, `disconnect` and the nested writes on a relation field are refused on `create`, `update`, `upsert.create` and `upsert.update`, using a data-model fixture with `org` / `onBehalfOfOrg` / `parcels`. Real client: `rolePermission.update({ data: { role: { connect } } })` and `role.update({ data: { permissions: { connect } } })` give `NESTED_WRITE_UNSUPPORTED` in `standard-columns.int.test.ts`. Re-run P2: B3, B4, B5, D1, D3 must throw before any `UPDATE`. |
| Owner / due | senior-developer, in this PR's light fix cycle if one runs (unowned file, keeps the record), else before **TASK-037** (first tenant model) merges; principal-architect to align data-model §7.6 ("relation fields are not accepted in repository input") |

### PR26-SEC-02 (LOW): stamping is an optional, unpinned dependency, and an unknown catalogue passes writes through

| | |
|---|---|
| CWE / OWASP | CWE-693 (protection mechanism failure), CWE-1188 (insecure default); A05:2021 |
| Location | `with-tenant-tx.ts:93` (`scopeClient?`), `:334` (`?? client`); `runtime.ts:211`; `standard-columns.ts:188`, `:236-238`, `:253-260` |
| Description | §3.6. (a) `scopeClient` is optional and falls back to the root client: a runner built without it persists caller-supplied `createdBy` / `updatedBy` / `orgId` / `version` / `id` (P5). (b) The only production wiring is untested; with the line deleted updates stop being stamped and forged `version` / `updatedBy` persist while benign inserts fail loudly (P5b). (c) An empty or unknown catalogue returns the arguments unchanged. Same items as the code review's m1 and m3. |
| Exploitability / impact | No attacker path; a regression (a refactor of `runtime.ts`, a Prisma upgrade that renames `_runtimeDataModel`) removes the defence without failing a unit test. Integration tests of `standard-columns.int` would notice (c) on create only. Impact M × likelihood L = LOW. |
| Remediation | (a) Make it required: `readonly scopeClient: (stamp: TransactionStamp) => TransactionCapableClient<TTx>;` and `const txClient = deps.scopeClient({ orgId: values[0], actorId: values[1] });` (tests that want the plain client pass `scopeClient: () => client` explicitly). (b) In `runtime.test.ts`, build `createDatabaseRuntime` with a fake `Client` whose instance records `$extends(extension)`, runs `$transaction` and `$queryRaw`, call `runtime.tenantTx.withTenantTx(ctx, …)` and assert one `$extends` with `name: 'standard-columns'` and the transaction opened on the extended client. (c) `if (catalogue.size === 0) throw new TypeError('standard-columns: the client exposes no runtime data model');` in `catalogueOf`; in `$allOperations` reject a *write* operation whose `model` is not in the catalogue (reads pass). |
| Verification | The three unit cases above; mutation: delete `runtime.ts:211` and the new test must fail (P5b output must change from "OK, unstamped" to a type error or a red test); unit case `catalogueFromDataModel({})` → `withStandardColumns` throws. |
| Owner / due | senior-developer; the code review lists m1 and m3 as in-PR fixes, which security supports; at the latest before **TASK-037** merges |

### PR26-SEC-03 (LOW): raw SQL writes bypass the stamping and the database enforces none of the stamped values

| | |
|---|---|
| CWE / OWASP | CWE-345 (insufficient verification of data authenticity), CWE-915; A04:2021 |
| Location | `tenant-db.ts:47` (`TENANT_DB_RAW_MEMBERS`), `tools/eslint-rules/db-raw-sql.mjs` (shape only); data-model P2 / §7.6 |
| Description | §3.3. Tagged `$executeRaw` / `$queryRaw` are model-less operations. Probe P1 E1, E2: arbitrary `created_by`, `updated_by`, `version`, `on_behalf_of_org_id` on INSERT and `version = 1, org_id = …` on UPDATE reach the adapter. The database enforces `NOT NULL`, `version >= 1`, RLS on `org_id` and (when a table has it) the on-behalf CHECK; it does not tie `created_by` / `updated_by` to `app.actor_id`, make `version` monotonic, or make `id`, `org_id`, `created_*` immutable. |
| Exploitability / impact | A developer error (raw DML in a repository), not an external path; the HTTP boundary still validates bodies. Impact is attribution and optimistic-lock integrity (the tenant key stays behind RLS), M × L = LOW. The audit trail does not depend on the column (its actor comes from the context). |
| Remediation | Choose one, in this order of strength: (1) **a database guard** from the policy-template family, `BEFORE INSERT OR UPDATE` on every standard-column table: INSERT requires `created_by = updated_by = coalesce(platform.app_actor_id(), <anonymous id>)` and `version = 1`; UPDATE requires `NEW.id, org_id, created_at, created_by = OLD.…`, `NEW.version = OLD.version + 1` and `NEW.updated_by` = the effective actor (the extension stays for ergonomics and the 400); (2) **a lint rule** in `platform/db-raw-sql` that reports `INSERT INTO` / `UPDATE … SET` / `DELETE FROM` / `MERGE` in tagged templates of `apps/*/src` unless the module is on a manifest of reviewed raw writers; (3) accept and document in §7.6 that raw SQL is outside the extension and reviewed by hand. principal-architect / data-architect decide; the choice is logged. |
| Verification | (1) a `catalog` case that every standard-column table carries the trigger plus a planted-row control per rule, and P1 E1/E2 become errors; (2) a fixture where a raw `INSERT INTO shipments` fails lint and an allow-listed module passes. |
| Owner / due | principal-architect decision before **TASK-037** (the migration template is the cheapest place); lint half to **TASK-024** |

### PR26-SEC-04 (INFO): no rule keeps reserved actor ids and empty actors out of a context

`contextValues` accepts any UUID or `''` for `actorId` in any scope; P4 §2: `SYSTEM_ACTOR_ID` under `TENANT` scope is stamped as the system user, and `actorId: ''` with `actorScope: 'OPERATOR'` is stamped as the anonymous actor (`stampActor`, standard-columns.ts:105). Real users cannot *obtain* a reserved id (server-generated, timestamp ≈ now), but a pipeline bug could attribute a request's writes to SYSTEM or anonymous, and an operator action to anonymous. Checks for the owners: **TASK-020** (context builder): `actorId` only from the verified token `sub`; a request context never carries a reserved id and an `OPERATOR` context always has a real, non-reserved actor (`TenantContext` gains a kind, or the builder is tested); the validation slot wires `serverControlledFieldIssues` per body *and per item of bulk bodies*, and rejects the camel-case spellings through Joi `unknown(false)`; authz re-exports `SYSTEM_ACTOR_ID` from shared (code review n8). **TASK-037**: `users` rows `is_system` for exactly the two reserved ids, a CHECK or trigger that no other row may use them, and no credentials. **TASK-047**: worker contexts come from `platform.job_context`, SYSTEM only for system jobs.

### PR26-SEC-05 (INFO): UUIDv7 entropy statement; ids are not capabilities

`uuidv7.ts:3` says "74 random bits"; the layout gives 73 at a new millisecond (31-bit counter with the top bit masked, plus 42) and 42 within a millisecond (the counter increments; P7). Reword. Keep the rule that no endpoint treats an id as a bearer secret (guest quotes and tracking authenticate with the guest token hash), and note that public ids disclose creation time to the millisecond (acceptable; data-model/ADR-0009 note). Same as the code review's n8.

### PR26-SEC-06 (INFO): `catalog-std` exemption lookups use `in`; no database-name / Prisma-name parity

`standard-columns-scans.ts:164` (`table in exempt`) and `:258` (`row.table_name in exempt`): use `Object.hasOwn(exempt, key)` or a `Map`; add planted controls for `constructor`, `toString`, `__proto__` (P6 shows 0 findings for them today). Add one assertion over the generated client: for every model, a field with `dbName` in {`id`, `created_at`, `updated_at`, `created_by`, `updated_by`, `version`, `org_id`, `on_behalf_of_org_id`} is named {`id`, `createdAt`, …} and the converse, so naming drift cannot silently disable stamping and refusal (§3.8). Overlaps the code review's n3 (type set, anchored `audit_entries` pattern, OR-weakened `VERSION_CHECK`). Owner: test-engineer with the first tenant model (**TASK-037**).

### PR26-SEC-07 (INFO): CODEOWNERS and lane A's record step do not cover the DB platform code, shared package or workspace manifests

Lane A bound this security review to two paths (`package-lock.json`, `tools/tsconfig.json`) although the PR rewrites `with-tenant-tx.ts`, `runtime.ts` and adds the extension. That is **PR24-SEC-04** with more instances: add `/apps/api/src/platform/` (at least `db/`), `/packages/shared/src/ids/`, and `**/package.json` (workspace manifests carry `scripts` that lane A's `typegen` runs before the gates: PR4-SEC-13) to CODEOWNERS and `REQUIRED_CODEOWNED_PATHS`; until TASK-015 lands, D-ARCH-021's `security-integration` job does not exist and only the orchestrator's dispatch decides which PRs I review. Owner: devops-engineer (TASK-015).

### PR26-SEC-08 (INFO): consistency items

(a) `SERVER_CONTROLLED_FIELDS` (shared) and `SERVER_FIELD_API_NAMES` lack `deleted_at` / `deleted_by` (ADR-0009 item 6): add them with soft delete in **TASK-100**, together with `where.version` and the 412/409 mapping; keep the standard-columns extension innermost (code review §1.1). (b) `updated_at` comes from the application clock and `created_at` from the database clock (code review n2): document in §7.6 (a skew can give `updated_at < created_at`). (c) `serverStamped` removes the server columns from the *literal* type, but a spread (`{ ...dto }`) is not excess-property checked: the run-time refusal is the control, so keep it primary (code review n5). (d) `serverControlledFieldIssues` checks the top level only; nested item schemas must call it (SEC-04).

## 5. Closures and checks owed

| Task / owner | Check |
|---|---|
| **This PR (light fix cycle, optional)** | SEC-01 (refuse relation fields), SEC-02 (required `scopeClient`, wiring test, empty catalogue throws), code review m1/m3/m4. All on unowned paths: this record stays valid (§7 D2). A change to `package-lock.json` or `tools/tsconfig.json` voids it (§7 E, E2) |
| **TASK-037** (first tenant model) | SEC-01 closed; SEC-02 closed; SEC-06 parity assertion; `org` relation declared or not, and the RLS `WITH CHECK` planted-row control for an `update` that re-parents; `on_behalf_of_org_id` column with `ck_<table>__on_behalf_null_m1` (the `catalog-std` rule gets its first instance); SEC-03 decision applied in the table template; users table per SEC-04 |
| **TASK-020** | SEC-04 context builder and validation-slot checks; the `serverControlledFieldIssues` call sites; `tenancy` metadata; authz re-export of the system actor |
| **TASK-024** | SEC-03 lint half (raw DML manifest); keep PR11-SEC-14/16 and PR24 items |
| **TASK-100** | SEC-08 (a); the optimistic-lock `where.version`; extension order; soft-delete rewrite of `delete` |
| **TASK-015** (devops) | SEC-07 CODEOWNERS list; PR10-SEC-21 and the other open items stay with it |
| **principal-architect** | SEC-03 ruling; data-model §7.6 wording: equal-`orgId` tolerance, `upsert`, relation fields refused, raw SQL outside the extension, application-clock `updated_at` (code review n2, n7) |
| **orchestrator, merge order** | PR #24 and PR #20 also edit `tools/tsconfig.json`, PR #20 and PR #29 edit `package-lock.json`: whichever of these merges second needs a merge-only security round for its own record (§7 F, F2). Re-run `catalog-std` on the second of #24 / #26 (code review §5) |

## 6. Cross-reference to the code review's items

| Code review | Security rating / stance |
|---|---|
| m1 production wiring unpinned | **PR26-SEC-02 (b) LOW.** In-PR fix supported; not a security merge condition |
| m2 relation-form FK writes | **PR26-SEC-01 LOW**, widened by the to-many child-row write; fix by refusing relation fields (deny by default), not by the schema-file test alone |
| m3 empty catalogue fails open | **PR26-SEC-02 (c) LOW** |
| m4 DECISIONS.md split entry | Docs-only; no security view |
| n3 `catalog-std` type set, anchored pattern | folded into **PR26-SEC-06** |
| n2, n7, n8 | folded into **SEC-08**, the §7.6 wording item and **SEC-05** |
| Security flags: `orgId`-equal tolerance | **Accepted** (§3.4); `_runtimeDataModel` reliance: SEC-02 (c); `uuid` edge: clean (§3.7) |

## 7. Record-check simulation (P10)

Method: a scratch `git clone --shared --no-checkout` of the main checkout, detached at the reviewed head; main's `tools/ci/check-security-owned-paths.mjs` extracted from `origin/main` (`6d12b24`) and run from outside with `--root <clone> --base <main> --head <commit> --pr 26 --json`; every scenario is a plumbing-free commit in the clone. The record is the file you are reading, copied in as `PR-0026-TASK-032-security-review.md`.

| Case | Scenario | Result |
|---|---|---|
| B | Control: no record | `missing` ("no record named docs/05-quality/security/PR-0026-*.md") |
| A | Record committed on top of `84b70c4` (docs-only commit), base = `6d12b24` | **`pass`**, satisfied by `84b70c4`; owned set = `package-lock.json`, `tools/tsconfig.json` |
| A2 | Same, base = the original merge base `ddbeb49` | **`pass`** |
| C | Control: `--pr 27` | `missing` (no `PR-0027-*` record named for that number) |
| C2 | Control: `--pr 24` | `missing` (PR-0024's record names no commit of this PR) |
| D | Real main (`6d12b24`) merged after the record. Main's own owned changes since the merge base (`tools/quality/activation.test.ts`, `tools/quality/required-suites.json`, from PR #28) are not in this PR's net change | **`pass`** |
| D2 | The light fix cycle on unowned paths after the record (`standard-columns.ts`, `with-tenant-tx.ts`, `runtime.test.ts`) | **`pass`** |
| E | Control: `tools/tsconfig.json` edited after the record | `missing` ("names 84b70c4, but tools/tsconfig.json changed after it") |
| E2 | Control: `package-lock.json` edited after the record | `missing` (same message for the lock) |
| F | Main itself changes `tools/tsconfig.json` (as open PRs #20 and #24 do), merged after the record | `missing`. A merge-only security round is needed for whichever of #20, #24 and #26 merges later |
| F2 | Main itself changes `package-lock.json` (as open PRs #20 and #29 do), merged after the record | `missing`, same |
| F3 | Main changes `eslint.config.mjs` (not in this PR's net change), merged after the record | **`pass`** |
| G | Control: a later table row `Verdict` with the value FAIL | `missing` ("verdict FAIL is not one of PASS, PASS_WITH_FOLLOW-UPS, PASS_WITH_CONDITIONS") |
| H | Control: the head row names the merge base, which lies outside the range | `missing` ("its head row names no commit of this PR") |
| J | Control: the head row names `44f9eec`, before the `tools/tsconfig.json` change in `b727090` | `missing` ("names 44f9eec, but tools/tsconfig.json changed after it") |
| K | Control: the record has a wrong extension | `missing` |

Cases B, C, C2, E, E2, F, F2, G, H, J and K each fail for the reason the check names, so the passes in A, A2, D, D2 and F3 are not vacuous. The orchestrator's pre-merge `.github/workflows` check uses the three-dot form and finds nothing to compare (§3.9). Script: `scratchpad/review/PR-26-sec/record-sim.sh` (session-scoped).

## 8. What this record covers when the head moves

- **Valid** for any later commit that changes no CODEOWNERS path, including a light fix cycle on `apps/api/**`, `packages/shared/**`, `prisma/tests/**` and `docs/**` (cases D, D2) and a merge of main while main changes no path that this PR also changed.
- **Voided** by any later commit that touches `package-lock.json` or `tools/tsconfig.json`, and by a merge of main that brings in a change to either (cases E, E2, F, F2): the pre-merge SHA no longer satisfies clause (d). A merge-only round that names the merge commit is then enough if the paths in `diff <main parent> <merge>` equal this PR's net change and every blob equals the reviewed head's except the overlap paths.
- **Not extended** to content the PR does not contain: the PR #24 union (`map-db-error.ts`, `runtime.ts`) is unowned code, reviewed by the code reviewer's §6 steps; `catalog-std` against PR #24's `10-audit.sql` is the code reviewer's table (§5 there), which I spot-checked for `audit_entries` only.

## 9. Verdict

| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is open at head `84b70c4`, so the merge rule is met for the security dimension. **Rulings:** (a) every Prisma write operation refuses server fields before SQL for every scalar form, and refuses nested writes other than `connect` / `disconnect`; relation-form `connect` and raw SQL are open (SEC-01, SEC-03); (b) the stamp is closure-bound (200 of 200 interleaved transactions), `orgId` is tolerated only when equal on create, and the on-behalf database pin is a rule without an instance until the first tenant model; (c) no statement leaves the transaction and the extension issues none; (d) the `withTenantTx` change is two lines and a type, and the `TenantDb` proxy, leak detector and latch are unchanged; (e) UUIDv7 is CSPRNG-backed and not a capability, reserved ids cannot be generated but nothing bars them from a context (SEC-04); (f) `uuid` 14.0.3 and the one-hunk lock delta are clean; (g) `catalog-std` is a sound control with an `in`-operator hole (SEC-06); (h) no D-ORCH-021 lever moves. **Follow-ups:** LOW SEC-01 (refuse relation fields), SEC-02 (required `scopeClient`, wiring test, empty catalogue throws), SEC-03 (principal-architect ruling: DB guard trigger, raw-DML lint, or documented acceptance); INFO SEC-04..08. SEC-01 and SEC-02 are cheap and may ride a light fix cycle on unowned paths without voiding this record; all three LOW items are due before TASK-037 merges. **Merge:** allowed once this record is committed as a docs-only commit on top of `84b70c4` and lane A is green; do not touch `package-lock.json` or `tools/tsconfig.json` afterwards, and give whichever of PR #20, #24, #26, #29 merges later a merge-only security round (§5, §7 F/F2). |
