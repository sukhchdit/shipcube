# PR #26 — TASK-032 server-controlled standard columns, UTC time and on-behalf seam — code review r1

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The per-transaction query extension is correct on every path I exercised against the real generated
  Prisma 7 client: create/createMany/upsert stamping, update/version increment, refusal before SQL, nested-write
  refusal, and the closure-bound stamp. There are no BLOCKER or MAJOR findings. Four MINORs, three of them cheap
  in-PR fixes: the production wiring line is unpinned (the mutant survives), an empty or unknown catalogue lets
  forged fields through, and a merge split another agent's DECISIONS entry. One forward hazard (relation-form FK
  writes) is routed to the first tenant-model task.
```

- **Head reviewed:** `84b70c4216ae6dd58a120b69fd333298ee276d73` (branch `feat/TASK-032-server-controlled-standard-columns-utc`). Base `origin/main` @ `271fbf3`.
- **Commits:** 4 feature/doc commits (`44f9eec`, `b727090`, `ff7b349`, `b90e874`) and 4 merges of main.
  - The merges hand-resolve only `docs/sdlc/DECISIONS.md` (`524eaff`, `851bb39`). `36bcb10` and `84b70c4` are clean.
  - `main..84b70c4` holds no code drift: everything outside the 18 PR files is docs or `.claude` from main.

## 1. Verification I performed

| Check | Result |
|---|---|
| Lane A run 43379147023 on the exact head | `fast-lane` SUCCESS. `scans` fails only at "Security-owned paths need a review record", as expected (platform/db, package.json, lock). `ci-gate` is red only because of that step. |
| Targeted unit tests, run in an archive extract with a `node_modules` junction: `standard-columns.test`, `uuidv7.test`, `with-tenant-tx.test` | 3 suites, 114/114 pass (1.9 s) |
| Real-client probe: generated `PrismaClient` with a `PrismaPg` adapter at 127.0.0.1:1, no DB, tsx | See §1.1 |
| Mutation: drop `scopeClient` from `runtime.ts:211` | All 8 `platform/db` unit suites stay green (230/230). Statically, no integration test asserts stamping through `createDatabaseRuntime` (§3 m1). |
| Lock delta vs main | Only the `packages/shared` → `uuid ^14.0.3` dependency entry. `node_modules/uuid` 14.0.3 (MIT, ESM) was already in the tree for two other packages. |
| `uuid` v7 source (`dist-node/v7.js`, `rng.js`) | Reviewed (§4) |
| Merge with PR #24 head `7662672`: `git merge-tree` | Conflicts in `map-db-error.ts` and `runtime.ts` (union steps in §6). `tools/tsconfig.json` and DECISIONS.md auto-merge. |
| `catalog-std` against PR #24's `prisma/bootstrap/10-audit.sql`: every table and column checked by hand against each rule | Green in either merge order (§5) |

**Not re-run** (dispatch: no Docker, targeted unit only): lint, typecheck, full unit, api, integration, coverage, build. For these I relied on lane A (above) and the developer gate table in the PR body: integration 199 passed, `standard-columns.int` 7/7, `catalog-std` 7/7; coverage 97.8/97.0 with two `afterAll` timeouts in untouched suites, re-run green.

### 1.1 Real-client probe results

- `_runtimeDataModel` is readable on the root client and on an extended client (4 models). `Role.permissions` is classified as a relation.
- Stamping on the real client: an inner recorder extension saw `id` (UUIDv7), `createdBy = updatedBy = actor` and `version: 1` on `referenceDatasetVersion.create`.
- A forged `version` gives `AppError VALIDATION_ERROR`. `role.update({ permissions: { create: [] } })` gives `DbError NESTED_WRITE_UNSUPPORTED`.
- A batch `$transaction([...])` on the extended client reaches the connection attempt. The deferred `query()` call does not break the batch form.
- Mixing the checked and unchecked forms after stamping (`role: { connect }` + `permissionId`) gives `PrismaClientValidationError` before connecting, so it fails closed.
- **Cost:** `$extends` takes 20–22 µs per call on this host, or about 34 µs including the first two delegate accesses. The heap delta is noise. The "lightweight, once per transaction" claim holds.
- **Ordering (useful for TASK-100):** the query extension applied *earlier* runs *first* (outer). The per-transaction standard-columns extension is applied last, so it is the innermost and sees the final args. Keep it that way when the soft-delete and optimistic-lock extensions land.
- **The runtime data model has no `relationFromFields`.** A relation field carries only `name`, `kind`, `type` and `relationName`. This matters for m2.

## 2. Focus-question rulings

- **create / createMany / createManyAndReturn / upsert / update / updateMany / updateManyAndReturn:** correct. Every payload of a list is validated, and one 400 lists all the forged fields in canonical order. Args are never mutated (property test).
  - Nested rows are refused, not stamped.
  - Raw SQL passes through unchanged. Inserts are still backstopped: `created_by`/`updated_by` are `NOT NULL` with no default, and `catalog-std` pins that.
  - delete/deleteMany pass through by design (TASK-100).
- **Refusal before SQL (400 `UNKNOWN_FIELD`):** correct and proven twice. Unit: `query` is never called. Integration: an earlier write in the same transaction is rolled back and the row count is unchanged.
  - The issue shape is single-sourced with `serverControlledFieldIssues`. A test asserts that both lists name the same fields.
- **Nested write = 500, or a build-time error? Ruling: keep the runtime 500.**
  - It is a server programming error that the client cannot cause (unknown keys are rejected at the HTTP boundary), and it is non-retryable. Repositories can bypass any type-level seam, so the runtime guard has to be the primary control.
  - A type-level narrowing is a useful *addition*, not a replacement (n5).
- **`orgId` tolerated only when equal to the transaction's org:** accepted as a documented deviation (D-TASK032-02). Data-model §7.6 literally says "rejects any of these fields if present".
  - Rules: case-insensitive compare against the lowercased stamp; overwritten with the stamp; always refused on update and in an org-less transaction.
  - principal-architect should align the §7.6 sentence (doc only, n7).
- **`scopeClient(stamp)` placement:** correct.
  - It runs after `contextValues` validation (a test proves it is never called on an invalid context) and before `tenantTxScope.run` / `$transaction`.
  - It is built once per transaction and keyed on the validated lowercased values. The stamp comes from the closure, not from ALS (data-model §7.6).
  - A throw from `withStandardColumns` escapes unmapped. That is acceptable for a composition defect.
- **`serverStamped<T>()` cast:** acceptable. `Omit<T, ServerColumn>` → `T` is a widening cast at one documented seam (D-TASK032-02), and the extension makes it true inside `withTenantTx`.
  - The `ServerColumn` union and `SERVER_FIELD_API_NAMES` keys are maintained separately (n4).
- **UUIDv7:** correct. Details in §4.
- **SYSTEM_ACTOR_ID duplicate:** pinned by `standard-columns.test.ts:192-197` (equality with `@platform/authz`). The follow-up "authz re-exports from shared" needs an owner (n8).
- **Lock delta:** clean (§1).
- **Coverage-hook flakes:** they are not caused by this PR. However, both new integration suites use the same `afterAll(async () => … db.stop())` with the default 5 s timeout that timed out in `seed.int` and `spk03` under load (n6).

## 3. Findings

| ID | Severity | file:line | Problem — why it matters | Required fix |
|---|---|---|---|---|
| m1 | MINOR | `apps/api/src/platform/db/runtime.ts:211` | **The production wiring is unpinned.** Removing `scopeClient: (stamp) => withStandardColumns(client, stamp)` keeps every unit suite green (mutation run, 230/230). The only integration tests that build `createDatabaseRuntime` with a client (`session-scope-leak.int`, `health.int`) issue raw queries only. `standard-columns.int` builds its own runner. Without the line, inserts fail loudly, but **updates silently stop bumping `version`/`updated_by`/`updated_at`**. `scopeClient` is optional in `WithTenantTxDeps`, so the type system does not catch it either. | In `runtime.test.ts`, pass a fake `Client` constructor whose instance records `$extends` and fakes `$transaction`/`$queryRaw`. Run `runtime.tenantTx.withTenantTx(ctx, …)` and assert one `$extends` call with `name: 'standard-columns'` and the transaction opened on the extended client. Alternatively, add one assertion to `standard-columns.int` through `createDatabaseRuntime`. Consider making `scopeClient` required once TASK-020 lands. |
| m2 | MINOR (forward; DB-backstopped) | `extensions/standard-columns.ts:61, 113-132` | **Relation-form writes of server FK columns pass the extension.** `connect` is allowed on update. Once tenant models declare `org Organisation @relation(fields: [orgId])` (or an `onBehalfOfOrg` relation), `update({ data: { org: { connect: { id: OTHER } } } })` changes `org_id` while `orgId` is "server-owned on update". Proven on the real client with `rolePermission.update({ data: { role: { connect } } })`, which reaches the inner layer stamped and unrefused. The backstops are RLS `WITH CHECK` (org) and `CHECK (on_behalf_of_org_id IS NULL)` (seam), so the impact is defence in depth only. The runtime data model has no `relationFromFields`, so the extension cannot derive which relation backs which FK. | Route to the first tenant-model task (TASK-037), or fix now with either: (a) a schema-file test that forbids a Prisma `@relation(fields: [orgId…])` / `[onBehalfOfOrgId]` (keep the DB FK, no Prisma relation), or (b) refuse relation writes on update for relation fields whose `type` is the organisation model. Add a unit case and a fixture either way. |
| m3 | MINOR | `extensions/standard-columns.ts:84-86, 188, 253-260` | **An empty or unknown catalogue fails open for forged fields.** The doc says an unreadable data model "fails closed", but that is true only for omitted columns on insert. If `_runtimeDataModel` (a Prisma-internal property) is renamed in a Prisma upgrade, or a model is missing, `stampArgs` returns the args unchanged. Then `update({ data: { createdBy: X, version: 9 } })` persists the forged values. On real Prisma every model is in the data model, so `definition === undefined` always signals a broken assumption, never a legitimate case. `standard-columns.int` AT-US-064-03 would go red on create, so lane B catches it, but only where integration runs. | Throw a `TypeError` in `catalogueOf` when the catalogue is empty. In `$allOperations`, refuse (reject) a write operation for a `model` that is not in the catalogue. Keep reads passing. Add unit cases for both and fix the doc sentence. |
| m4 | MINOR | `docs/sdlc/DECISIONS.md:1453-1471` | **A merge split another agent's entry.** The D-TASK032-01..03 block now sits between D-SEC-PR20-02's `Decision` line and its `Reversibility` line (main has them adjacent at 1454-1455). D-SEC-PR20-02 lost its reversibility line and the blank line before the next heading. The orphan line now closes D-TASK032-03. The decision log is the audit record of who decided what. | Move the three entries below D-SEC-PR20-02's `- **Reversibility:** High.` + blank line, and give D-TASK032-03 its own reversibility line. Docs-only, so the evidence stays fresh. |
| n1 | NIT | `extensions/standard-columns.ts:149-173` | Stamping is keyed by field *name* only. A future model whose `id` is not an app-generated uuid (or that must know its id before the insert; the audit chain hashes the entry id), or whose `version` is a domain field, is silently overwritten or refused. | Check the runtime `type` (`id` → `String`, `version` → `Int`) and document the escape hatch to use when a pre-computed id is needed. |
| n2 | NIT | `extensions/standard-columns.ts:170`, `standard-columns.int.test.ts:142` | `updated_at` uses the **app** clock (`new Date()`), while `created_at` uses the **DB** clock (`now()` = transaction start). Under host/DB clock skew, `updated_at < created_at` is possible. This matches §7.6 ("`updatedAt = now`") but is not documented. The raw-SQL paths in the data model use DB `now()`. | Add a sentence to the module doc and to §7.6 (architect). No code change required. |
| n3 | NIT | `prisma/tests/catalog/standard-columns-scans.ts:93-98, 137-149` | AT-US-064-04 inspects only `typname = 'timestamp'`. It misses `_timestamp` (arrays), `tsrange`/`tsmultirange` and domains over `timestamp`. `/^audit_entries/` is a prefix match, so it exempts any future non-partition `audit_entries_*` table (partitions are already excluded by `relispartition`). `VERSION_CHECK` accepts OR-weakened checks. | Extend the type set (resolve domains via `typbasetype`), anchor the pattern to `^audit_entries(_\d{4}_\d{2})?$`, and add planted controls. |
| n4 | NIT | `extensions/standard-columns.ts:35-47` | The `ServerColumn` union and `SERVER_FIELD_API_NAMES` keys can drift. | `SERVER_FIELD_API_NAMES = {…} as const satisfies Record<ServerColumn, string>`. |
| n5 | NIT | `extensions/standard-columns.ts:56` | `serverStamped` could also narrow nested relation inputs to `{ connect?, disconnect? }`. Prisma's `UncheckedCreateInput` back-relations carry `create`/`createMany`/`connectOrCreate`. That would turn most nested writes into a compile error. The runtime 500 stays as the backstop (§2 ruling). | Optional; route to TASK-100 with the other extension work. |
| n6 | NIT | `prisma/tests/rls/standard-columns.int.test.ts:108-112`, `prisma/tests/catalog/standard-columns.int.test.ts:37-39` | `afterAll` stops a Testcontainer under the default 5 s timeout. This is the same shape that flaked in `seed.int` and `spk03` during this PR's coverage run. | Give `afterAll` an explicit timeout (e.g. `60_000`). The harness-wide fix belongs to TASK-276 (the qa-lead flake report). |
| n7 | NIT | data-model §7.6 (architect) | The sentence "rejects any of these fields if present" should name the tolerated equal-`orgId`-on-create case, `upsert`, and `NESTED_WRITE_UNSUPPORTED`. | principal-architect: wording only. |
| n8 | NIT | `packages/shared/src/ids/uuidv7.ts:3`; `@platform/authz` | The doc says "74 random bits". At a new millisecond it is 73: `v7Sequence` masks the top bit of the 31-bit counter seed, plus 42 tail bits. Within one millisecond only the 42 tail bits are fresh (the counter increments). The test title "over a burst in one millisecond" is not guaranteed. The authz re-export follow-up has no owner. | Fix the wording. Route "authz re-exports `SYSTEM_ACTOR_ID` from shared" to TASK-020 (it holds `pkg-authz`). |

## 4. UUIDv7 assessment

`uuid` 14.0.3 `v7()` without options:
- **Time:** 48-bit `Date.now()` milliseconds.
- **Monotonicity:** per process. A 31-bit counter is seeded randomly on each new millisecond (top bit masked to leave headroom) and incremented within a millisecond. On clock regression the counter keeps the last millisecond and increments; on overflow it advances the millisecond. Ids therefore never go backwards inside one process.
- **Ordering across processes:** only by millisecond, which is acceptable for keys.
- **Randomness:** `crypto.getRandomValues` (CSPRNG) on both the node and browser entries. The shared 16-byte buffer is copied into a fresh output, so there is no aliasing.
- **Validation:** `isUuidV7` requires canonical lowercase, version 7 and variant `10xx`. The reserved actors (timestamp 0) are valid v7, matching data-model §1.6.
- **Keys:** UUIDs are not used as secrets anywhere in this PR, so the 42-bit within-millisecond entropy is not a concern.

## 5. `catalog-std` vs PR #24 (merge order)

I checked the PR #24 head `7662672` `10-audit.sql` against every rule:
- `audit_entries`: append-only, `occurred_at timestamptz NOT NULL`. `stream_seq bigint` has no default. `scope_org_id` is GENERATED (not identity). `on_behalf_of_org_id` is exempt by exact name.
- `audit_stream_heads`, `audit_partitions`, `audit_chain_verifications`, `data_subjects`: the full contract holds.
- `audit_checkpoint_heads` and `audit_pii_vault`: append-only, with `created_at` and `CHECK (version = 1)`.
- `audit_anchors`: append-only. `anchor_seq bigint` PK has no sequence or identity.
- No `date` or naive `timestamp` columns.
- The planted probes use non-audit names, so PR #24's DDL guard does not refuse them.

Result: green in either order. Re-run `catalog-std` on whichever PR merges second, as the PR body says.

## 6. Union steps with PR #24 (whoever merges second)

- `map-db-error.ts`: `DbErrorReason` = union of `'NESTED_WRITE_UNSUPPORTED'` (with its doc comment) and `'AUDIT_IMMUTABLE' | 'AUDIT_PARTITION_NAME_TAKEN'`. Only the last member carries the `;`.
- `runtime.ts`: keep PR #24's `runStartupAuditPartitionsCheck` block, followed by this PR's `RuntimeDatabaseClient<TTx> extends TransactionCapableClient<TTx>, ExtendableClient` and its doc comment. Keep the `withStandardColumns` import and the `scopeClient` line.
- Re-run typecheck, then the `platform/db` and `runtime` unit tests and `catalog-std` + `standard-columns.int` on the merge commit.

## 7. Merge conditions

1. A security review record naming the final head (security-owned paths: `apps/api/src/platform/db/**`, `package.json`, lock), so lane A's record step turns green.
2. m1, m3 and m4 fixed in-PR (all cheap), or explicitly routed by the orchestrator. m2 routed to TASK-037 with security-analyst's rating.
3. Green lane A on the exact final head.
4. If PR #28 (W0-ACT-1) merges first: a lane-B evidence commit (`quality:heavy --profile pr`) on an ancestor of the head (D-ORCH-034). A merge of main that brings `.claude/agent-memory` changes makes that evidence stale.
5. The PR #24 union per §6, with `catalog-std` re-run on the second merge.
6. Squash merge (4 merge commits on the branch).

## 8. GOOD

- The extension is a pure args rewrite: no queries, and it rejects rather than throws synchronously. Refusal is proven to happen before SQL at both unit and integration level, including rollback of an earlier write in the same transaction.
- The stamp is closure-bound, applied after validation and built once per transaction. Its cost was measured here at about 20 µs.
- Columns come from the runtime data model, with a per-root WeakMap cache, so new models need no registry edit.
- Each `catalog-std` rule is one SQL plus one pure function, run on the committed catalogue and on rolled-back planted controls. The exemption maps are asserted to be load-bearing.
- The HTTP-boundary list and the repository list are single-sourced and parity-tested. The integration test reads the stored instant in an `Asia/Kolkata` session, proving that the stored instant does not depend on the session time zone.

## SECURITY-FLAGS (for security-analyst)

- m2: relation-form `connect` on update can change server FK columns. DB backstops: RLS `WITH CHECK` and the on-behalf `CHECK`. Please rate it and confirm the route to TASK-037.
- m3: reliance on the Prisma-internal `_runtimeDataModel`; an empty or unknown catalogue fails open for forged fields on update.
- The `orgId`-equal-on-create tolerance (D-TASK032-02).
- New runtime dependency edge `@platform/shared` → `uuid` 14.0.3 (MIT; already in the lock; browser entry uses `crypto.getRandomValues`).
