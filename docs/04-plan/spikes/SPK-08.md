# SPK-08 — Audit ownership separation, identity-based DDL guard and the Prisma 7 shadow database

| Field | Value |
|---|---|
| Task | TASK-012 (Wave 0, batch 0.4) · branch `feat/TASK-012-spk-08-spike-audit-owner` |
| Risk | SEC-P3-03 / SEC-P3-27 residual (RR-04), R-ARCH-18; batch-0.2 routed item (`migrations.initShadowDb` with the rendered bootstrap lane) |
| Design under test | ADR-0007 amendments 7 and 8; data-model.md §4.4 (both amendments), §4.6 C13/C14, §5.1–§5.3 (with amendments), §7.3, §12 "SPK-08 additions"; `rulings/batch-0.2-rulings.md` (TASK-012 item, rule 14) |
| Date / host | 2026-11-12 (fix cycle 1: 2026-11-13) · same Windows 11 / Docker Desktop host as SPK-03 · `postgres:18` = PostgreSQL **18.6** (Debian 18.6-1.pgdg13+2; the harness pin `sha256:e3d24f69…`) · `prisma` 7.10.1 |
| Owner | senior-developer (lead); database-engineer specialists 12A (§0–§4, §7–§9) and 12B (§5); desk research (§6) |
| Evidence | `prisma/tests/spikes/spk08-anchor.int.test.ts` — 7 tests, **7 passed** (10.7 s). `prisma/tests/spikes/spk08-audit-owner.int.test.ts` — 17 tests, **17 passed** (run 5 = PR #12 fix cycle 1, 42.2 s Jest time). Prototype SQL: `prisma/tests/spikes/spk08/10-audit.sql`, `90-audit-ddl-guard.sql`; fixture config `prisma/tests/spikes/spk08/prisma.config.ts`. Lifecycle of these files: §8.1 |
| **Verdict** | **GO** for the ADR-0007 am. 7/8 design on PostgreSQL 18: every tamper path of SEC-TC-43 and the SEC-TC-61 subset fails for `platform_migrator` with `42501`, **both halves of the identity guard are exercised** (`ddl_command_end` for planted audit names, `sql_drop` for a schema-owner and a superuser `DROP` of audit objects, §1), `ensure_audit_partitions` works for `platform_app` and is immune to the planted overloads, the guard admits all Prisma-style DDL on non-audit tables, and `migrations.initShadowDb` works with a migrator-runnable rendering that keeps the three `CREATE EXTENSION` lines. **Two spec amendments are required (no design change):** F-01 (`tables.external` must also cover the audit **partitions**, otherwise the first `migrate deploy` fails with P3005) and F-02 (the shadow rendering must drop/recreate `platform`, because Prisma resets only `public`). **Partial indexes (F-11, the routed `migrate dev` question):** with the `partialIndexes` preview off (the repository today) Prisma 7.10.1 keeps a raw-SQL partial index; with it on, the next generated migration **drops** an undeclared one, so every partial index must then be declared with a matching `where: raw(…)`. **Anchor signing (§5): GREEN** — SEC-TC-44 (a) signature, (b) head mismatch and (c) missing/reordered anchors are all detected with an in-memory P-256 key (7/7 tests); spec clarifications A-1..A-7 and writer/verifier pitfalls AF-1 (text-sorted `anchor_seq`) and AF-2 (microsecond timestamps). **RDS parity (§6): desk research, CONFIRMED** for event triggers by the master and the trusted extensions; the `createrole_self_grant` / self-`GRANT … WITH SET TRUE` → `REVOKE` sequence ending in the ADMIN-only row is documented for vanilla PostgreSQL 16+ and UNCLEAR on RDS; open M5 checks listed per item (COND-G4-PROD). |

Throwaway code: nothing here is a bootstrap file or a migration. The prototype is applied by the test superuser, in one
transaction per file, after the **pre-audit part of the real** bootstrap lane (the `0N-*.sql` files, today
`prisma/bootstrap/00-roles.sql` and `01-schemas.sql`, through `tools/db/bootstrap.ts` from a temporary copy). Applying
only `0N-*.sql` keeps both suites green once TASK-021 adds the real `10-audit.sql` / `90-*.sql` (§8.1). The real audit
DDL is TASK-021's. Every tamper attempt runs in a transaction that is rolled back.

## 0. What was built

- **Roles and schemas.** Unchanged repository bootstrap lane (TASK-003): `platform_audit_owner` and
  `platform_schema_owner` are `NOLOGIN NOINHERIT` with **no `pg_auth_members` row** (asserted), `public` and
  `platform` are owned by `platform_schema_owner`, the migrator holds `CONNECT` and `USAGE, CREATE` only.
- **`10-audit.sql` (prototype of the bootstrap-lane file).** `SET search_path = pg_catalog, pg_temp; SET ROLE
  platform_audit_owner;` then: `public.audit_entries` **verbatim from §5.1** (all columns incl. the generated
  `scope_org_id`, all CHECKs and the ten indexes), `ENABLE` + `FORCE ROW LEVEL SECURITY` with two placeholder policies
  `TO platform_app` (spike-only text), a minimal `public.audit_partitions`, `platform.audit_forbid_mutation()` and the
  two `audit_entries` triggers **verbatim from §5.2**, `platform.ensure_audit_partitions(integer)` **verbatim from
  §5.3**, the §4.4 grants, and `SELECT platform.ensure_audit_partitions(0)` (the "+1 partition": current month).
- **`90-audit-ddl-guard.sql`.** `platform.audit_ddl_guard()` and the event triggers `platform_audit_ddl_guard_end`
  (`ddl_command_end`) / `platform_audit_ddl_guard_drop` (`sql_drop`) **verbatim from the §5.2 amendments** (not
  `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`, OID-derived protected schemas), owned by the superuser.
- **Databases.** `spk08_audit` (bootstrap + prototype + guard; exits 1, 2, 3a and the `migrate dev` target of exit 4),
  `spk08_ddl` (same, for the Prisma-style DDL set and the generated-range deploy), `spk08_shadow` (empty, `OWNER
  platform_migrator`).

Command (Docker lock held; path before `--selectProjects`):

```
node --experimental-vm-modules --disable-warning=ExperimentalWarning node_modules/jest/bin/jest.js \
  prisma/tests/spikes/spk08-audit-owner.int.test.ts --selectProjects integration -i
# Tests: 17 passed, 17 total · Time: 42.2 s (run 5)
# SPK08_REPORT=<file> writes every observed outcome (SQLSTATE, message, guard DETAIL, CLI tails) as JSON.
```

Runs: run 1 (8/13: two test defects — `ORDER BY 1 COLLATE "C"` is not valid SQL, and the trigger message has a
suffix — plus three real findings F-01, F-02, F-05), run 2 (13/13 after the rendering fix and the external-table
variants), run 3 (14/14, adds the generated-range deploy of F-01). PR #12 fix cycle 1: run 4 (16/17; the new M1
partial-index probe recorded its outcome against a placeholder assertion) and two `-t M1` re-runs (they showed that
the preview flag follows the **config** schema, not the `--to-schema` target, so the probe now sets both), run 5 (17/17: adds the `sql_drop` test, the M1 probe, the F-02 negative
control, and unconditional assertions for F-01, the shadow database and the generated migration).

## 1. Exit 1 — SEC-TC-43 prototype: GREEN

Tests: `SEC-TC-43 (prototype) roles, owners, FORCE RLS, …` (catalog shape), `SEC-TC-43 every tamper statement fails
for platform_migrator with 42501, directly and through DO $$ EXECUTE $$`, `SEC-TC-43 where privilege admits the
migrator, the identity guard refuses (planted audit names) …`, `SEC-TC-43 / R-ARCH-18 the sql_drop guard refuses …`, `SEC-TC-43 SELECT platform.ensure_audit_partitions(3) as
platform_app succeeds …`, `C14 (b) prototype: …`.

**Catalog shape (asserted).** Both no-member roles `rolcanlogin = false`, `rolinherit = false`, 0 `pg_auth_members`
rows; schema owners `platform_schema_owner`; every `public.audit_*` relation owned by `platform_audit_owner`;
`audit_entries` `relkind = 'p'`, `relrowsecurity` and `relforcerowsecurity`; `proconfig`: guard and
`audit_forbid_mutation` exactly `{search_path=pg_catalog, pg_temp}`, `ensure_audit_partitions` `{search_path=pg_catalog,
pg_temp, TimeZone=UTC, lock_timeout=5s}` (`prosecdef` true only there); both event triggers `evtenabled = 'O'` calling
`platform.audit_ddl_guard`; the partition carries the cloned row trigger (`tgparentid <> 0`) and its own TRUNCATE trigger.

**Tamper statements as `platform_migrator`.** Each was run directly and as `DO $spk08$ BEGIN EXECUTE '…audit_' ||
'entries…'; END $spk08$` (for the schema: `'… pub' || 'lic …'`). All 14 × 2 failed with `42501`; the dynamic form
produced the identical message. **All were refused by privilege; none reached the guard.**

| Statement | Message (direct = dynamic) |
|---|---|
| `ALTER TABLE public.audit_entries DISABLE TRIGGER ALL` · `NO FORCE ROW LEVEL SECURITY` · `DISABLE ROW LEVEL SECURITY` · `DETACH PARTITION public.audit_entries_2026_11` · `DROP TABLE public.audit_entries` | must be owner of table audit_entries |
| `DROP TRIGGER trg_audit_entries__no_update_delete ON public.audit_entries` · `DROP POLICY p_audit_entries__app_select ON …` | must be owner of relation audit_entries |
| `DROP SCHEMA public CASCADE` | must be owner of schema public |
| `DROP TABLE public.audit_entries_2026_11` · `ALTER TABLE public.audit_entries_2026_11 DISABLE TRIGGER ALL` | must be owner of table audit_entries_2026_11 |
| `GRANT UPDATE, DELETE ON public.audit_entries TO platform_app` · `TRUNCATE public.audit_entries` | permission denied for table audit_entries |
| `CREATE OR REPLACE FUNCTION platform.audit_forbid_mutation() …` / `… ensure_audit_partitions(integer) …` | must be owner of function audit_forbid_mutation / ensure_audit_partitions |

**Where privilege admits the migrator, the guard refuses** (direct and dynamic; `42501` "audit objects are immutable
(SEC-P3-03)"). Control: `CREATE TABLE public.spk08_control (id integer)` succeeds.

| Statement | Guard DETAIL |
|---|---|
| `CREATE TABLE public.audit_spk08_planted (id integer)` | CREATE TABLE on table public.audit_spk08_planted by platform_migrator |
| `CREATE TABLE public.audit_entries_2099_01 (id integer)` | CREATE TABLE on table public.audit_entries_2099_01 by platform_migrator |
| `CREATE FUNCTION platform.ensure_audit_partitions(bigint) …` (overload) | CREATE FUNCTION on function platform.ensure_audit_partitions(bigint) by platform_migrator |
| `CREATE FUNCTION public.audit_forbid_mutation() …` | CREATE FUNCTION on function public.audit_forbid_mutation() by platform_migrator |

**The `sql_drop` half of the guard** (R-ARCH-18 exit item "schema-owner `DROP TABLE`"; SEC-P3-27 second layer; test
`SEC-TC-43 / R-ARCH-18 the sql_drop guard refuses …`). `platform_schema_owner` owns `public`, so privilege **admits** its
`DROP` of any relation there (PostgreSQL lets the schema owner drop objects in its schema); only the guard can stop it.
Each statement ran in a rolled-back transaction, as the superuser after `SET LOCAL ROLE platform_schema_owner`, or as the
superuser itself. Every one failed with `42501` "audit objects are immutable (SEC-P3-03)":

| Statement | Guard DETAIL (`sql_drop`) |
|---|---|
| `DROP TABLE public.audit_entries_2026_11` (schema owner) | DROP of table public.audit_entries_2026_11 by platform_schema_owner |
| `DROP TABLE public.audit_entries` (schema owner) | DROP of table public.audit_entries by platform_schema_owner |
| `DROP INDEX public.ix_audit__stream_seq` (schema owner) | DROP of index public.ix_audit__stream_seq by platform_schema_owner |
| `DROP TABLE public.audit_entries` (superuser) | DROP of table public.audit_entries by postgres |
| As the migrator: `CREATE TABLE public.spk08_t`, then `CREATE INDEX audit_entries_2099_02 ON public.spk08_t (id)` → **both succeed**; then `DROP INDEX public.audit_entries_2099_02` | DROP of index public.audit_entries_2099_02 by platform_migrator |

The last row turns F-08's inference into an observation. It also reproduces PR12-SEC-02 (a) and (c): an index can squat
a partition name past the guard, and the migrator then cannot remove it again (§8 item 6).

**`ensure_audit_partitions(3)` as `platform_app`** created the missing months of current … current + 3 (the test
derives the expected count from the clock; it was `3` with only the current month present), each partition owned by
`platform_audit_owner` with its `trg_<partition>__no_truncate` trigger. `platform_app` inserted one row. A superuser
`UPDATE public.audit_entries …` (privilege and RLS bypassed) was refused by the cloned row trigger: `42501`
"AUDIT_IMMUTABLE: UPDATE on audit_entries_2026_11 is not permitted" (`TG_TABLE_NAME` is the **partition**, see F-07).

**C14 (b)** (bonus): the superuser's `ALTER SCHEMA public RENAME TO c14_x` / `platform … c14_y` were refused by the
guard (`42501`, DETAIL "ALTER SCHEMA on schema c14_x by postgres"): the OID match works after the rename is applied.

## 2. Exit 2 — SEC-TC-61 subset: GREEN

Tests: `SEC-TC-61 DROP FUNCTION platform.audit_ddl_guard() CASCADE, DROP SCHEMA platform CASCADE and schema renames fail
by privilege …`, `SEC-TC-61 planted public.pg_advisory_xact_lock(integer) and public.to_char(date, text) are never
called by ensure_audit_partitions`.

| Statement as `platform_migrator` | SQLSTATE / message |
|---|---|
| `DROP FUNCTION platform.audit_ddl_guard() CASCADE` | 42501 must be owner of function platform.audit_ddl_guard |
| `DROP SCHEMA platform CASCADE` | 42501 must be owner of schema platform |
| `ALTER SCHEMA public RENAME TO x` · `ALTER SCHEMA public OWNER TO platform_migrator` | 42501 must be owner of schema public |
| `ALTER SCHEMA platform RENAME TO y` | 42501 must be owner of schema platform |
| `DROP EVENT TRIGGER platform_audit_ddl_guard_end` · `ALTER EVENT TRIGGER … _drop DISABLE` | 42501 must be owner of event trigger … |
| `SET event_triggers = off` (PG 17+ GUC) · `SET session_replication_role = replica` | 42501 permission denied to set parameter "…" |

**Search-path hijack.** The migrator planted `public.pg_advisory_xact_lock(integer)` and `public.to_char(date, text)`
(both writing a marker row, `EXECUTE` granted to `PUBLIC`). **Positive control:** an unqualified `SELECT
to_char(current_date, 'YYYY'), pg_advisory_xact_lock(1)` in the migrator's session resolved to **both** plants (2
markers, rolled back) — they are genuinely better matches than the `pg_catalog` built-ins. Then `platform_app` ran
`ensure_audit_partitions(6)`: returned `3` (months +4..+6, so the advisory-lock and `to_char` paths ran), **0 marker
rows**, 0 audit triggers with `tgenabled <> 'O'`, both event triggers enabled. Plants removed afterwards.

## 3. Exit 3 — no Prisma-generated DDL is blocked by the guard: GREEN (with finding F-01)

Tests: `SPK-08 exit 3 prisma migrate deploy … with the guard installed`, `SPK-08 exit 3 a representative
Prisma-generated DDL set …`, `SPK-08 exit 3 first migrate deploy succeeds when tables.external lists a generated range of
partition names …`.

**`migrate deploy`** of the repository's three migrations as the migrator, guard installed:

| Variant (`tables.external`) | Result |
|---|---|
| (a) `public.bootstrap_migrations` only (the repository `prisma.config.ts` before TASK-021; run through the fixture config so the test does not depend on the root config) | **exit 1, P3005** "The database schema is not empty" (asserted) |
| (b) + `public.audit_entries`, `public.audit_partitions` (parents, as §7.3 says) | **exit 1, P3005** (the 7 partitions are still counted; asserted unconditionally since fix cycle 1) |
| (c) + every existing `public.audit_entries_YYYY_MM` | exit 0, "All migrations have been successfully applied"; `migrate status` "up to date" |
| (d) + a generated range of 60 names, January of the current UTC year + 59 months (most not existing; computed from the clock), on `spk08_ddl` | exit 0; `migrate status` exit 0 — non-existent external names are accepted |

The guard never interfered with a deploy; the P3005 is Prisma's first-deploy emptiness check (F-01). SPK-08 record 3
of `prisma/README.md` (no database ownership needed) is not repeated here.

**Prisma-style DDL set** (Prisma's quoting, run one by one as the migrator outside an explicit transaction, guard
installed, all **succeeded**): `CREATE TYPE … AS ENUM`; `CREATE TABLE` ×2 with `PRIMARY KEY` constraint, enum column,
`TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP`; `ALTER TABLE … ADD COLUMN`; `CREATE INDEX`; `CREATE UNIQUE INDEX`; **`CREATE
INDEX CONCURRENTLY`**; `CREATE INDEX … USING GIN ("name" gin_trgm_ops)` (extension opclass from the bootstrap role's
`pg_trgm`); `ALTER COLUMN … SET DATA TYPE BIGINT`; `ALTER COLUMN … SET DEFAULT`; `ADD CONSTRAINT … FOREIGN KEY …
ON DELETE RESTRICT ON UPDATE CASCADE`; `ALTER TYPE … ADD VALUE`; `RENAME COLUMN`; `ALTER INDEX … RENAME TO`; `ENABLE` /
`FORCE ROW LEVEL SECURITY`; `CREATE POLICY … TO platform_app`; `GRANT SELECT, INSERT, UPDATE … TO platform_app`;
`CREATE FUNCTION platform.spk08_helper()`; `DROP INDEX`; `DROP CONSTRAINT`; `DROP COLUMN`; `ALTER TABLE … RENAME TO`;
`DROP POLICY`; `DROP FUNCTION`; `DROP TABLE` ×2; `DROP TYPE` (28 statements). **`CREATE SCHEMA IF NOT EXISTS "public"`**
failed as the batch-0.2 ruling predicts: `42501` "permission denied for database spk08_ddl" (privilege, not the guard).

## 4. Exit 4 — `migrations.initShadowDb` with the rendered bootstrap lane: GREEN (with findings F-02, F-03, F-04, F-11)

Tests: `SPK-08 exit 4 the rendering keeps the three CREATE EXTENSION IF NOT EXISTS lines …`, `… negative control: a
failing initShadowDb script fails migrate diff …`, `… migrate diff --from-migrations --to-schema with the shadow
database succeeds; the diff touches no bootstrap-lane object`, `… migrate dev --create-only against the bootstrapped,
audit-prototyped, migrated database succeeds …`.

- **Property name.** `@prisma/config` 7.10.1: `migrations.initShadowDb?: string` — the SQL **text**, not a path. The
  fixture config reads the rendered file with `readFileSync` (`prisma/tests/spikes/spk08/prisma.config.ts`).
- **Rendering** (`renderShadowInit` in the test; input `01-schemas.sql` + the `10-audit.sql` prototype; `00-roles.sql`
  and `90-*` are not rendered). Kept: both `SET search_path = pg_catalog, pg_temp`, `DROP SCHEMA IF EXISTS platform
  CASCADE` (added, F-02), `CREATE SCHEMA IF NOT EXISTS platform` (AUTHORIZATION stripped), **the three `CREATE EXTENSION
  IF NOT EXISTS … WITH SCHEMA public`**, all audit tables/indexes/RLS/policies/functions/triggers and `SELECT
  platform.ensure_audit_partitions(0)`. Dropped (19): `ALTER … OWNER TO` ×4, `SET ROLE`/`RESET ROLE`, every `GRANT` /
  `REVOKE`, the three `ALTER DEFAULT PRIVILEGES`.
- **Negative control:** an init script `SELECT pg_catalog.spk08_missing_function();` makes `migrate diff` exit 1 with
  that PostgreSQL error — the hook runs, against the shadow database.
- **`migrate diff --from-migrations <copy> --to-schema prisma/schema --script`**: exit 0. The script contains **no**
  audit, platform, extension or schema statement; its only content is the pre-existing repository drift F-04 (asserted
  present, so the negative check cannot pass on an empty script).
- **Does the shadow database receive the bootstrap-lane objects? Yes** (asserted), and Prisma leaves them there after
  the run: extensions `btree_gin, btree_gist, pg_trgm` (plus the built-in `plpgsql`), schema `platform`,
  `audit_entries`, `audit_entries_2026_11`, `audit_partitions`, next to the migrated `permissions, role_permissions,
  roles`.
- **`migrate dev --create-only --name spk08_probe`** against `spk08_audit` (bootstrap lane + prototype + guard + 7
  partitions + deployed migrations; `tables.external` = bootstrap ledger + the two audit **parents** only): exit 0, **no
  drift reported**, exactly one new migration in the temporary copy of `prisma/migrations`. Its statements are
  **identical** to the `migrate diff` script above (asserted), i.e. only F-04. The partitions were ignored by the differ
  and by drift detection without being listed (contrast F-01). The test re-runs the (idempotent) exit-3 deploy first, so
  `-t "exit 4"` works on its own.
- **F-02 negative control** (`SPK-08 exit 4 (F-02) negative control …`): the same rendering without the `DROP SCHEMA IF
  EXISTS platform CASCADE` line fails on a shadow database that already went through one run: exit 1, "function
  \"audit_forbid_mutation\" already exists with same argument types" (asserted on the second of two runs; the first
  failed the same way because the earlier tests had left `platform` populated).
- **Partial indexes (M1 of the PR #12 review; the routed "`migrate dev` with partial indexes" question; data-model §7.3
  row "Partial indexes" "verify in P5 spike").** Test `SPK-08 exit 4 (M1) …`. A migration appended to a copy of the
  history adds `CREATE INDEX "ix_roles__key_system" ON "public"."roles"("key") WHERE "is_system"`. The shadow database
  contains it after every replay (asserted from `pg_indexes`). `migrate diff --from-migrations <copy> --to-schema
  <variant>` prints what `migrate dev` writes (previous bullet). Each schema variant was used as **both** the config
  schema and the target: the preview flag is read from the config schema, and with only the target carrying it the
  result equals "preview off".

  | Schema variant | Statements about `ix_roles__key_system` in the next generated migration |
  |---|---|
  | Preview off (repository today), index not declared | **none: the raw partial index is kept** |
  | Preview off, declared as plain `@@index([key], map: …)` (predicate forgotten) | none: compares **equal**; the predicate is invisible to the differ and to drift detection |
  | `previewFeatures = ["partialIndexes"]`, index not declared | **`DROP INDEX "ix_roles__key_system"`** |
  | Preview on, declared `where: raw("is_system")` | none: kept |
  | Preview on, declared `where: raw("NOT is_system")` | `DROP INDEX` + `CREATE INDEX "ix_roles__key_system" ON "roles"("key") WHERE (NOT is_system)` |

  `partialIndexes` is still a **preview** feature in 7.10.1 (the schema engine's error text: "Partial indexes are a
  preview feature. Add \"partialIndexes\" to previewFeatures in your generator block"). Consequences: F-11.

## 5. Anchor signing (SEC-TC-44): GREEN (with findings AF-1, A-1..A-7)

Specialist 12B (database-engineer), `prisma/tests/spikes/spk08-anchor.int.test.ts` + `prisma/tests/spikes/spk08/anchor-prototype.ts`: **7 tests, 7 passed** (13.1 s Jest time, about 14 s wall clock). Keys are generated in memory at test time and never exported or printed. **GREEN** for SEC-TC-44: every tamper case is detected; finding A-1 refines which `failure_kind` case (a) reports.

Host tools for this section: Node v24.22.3; OpenSSL 3.5.4 (host, Git for Windows). The anchor finding series is numbered **AF-1..AF-12** so that it cannot be confused with the owner/guard series F-01..F-10 of §7.

### 5.1 What was built

- `prisma/tests/spikes/spk08-anchor.int.test.ts`: 7 integration tests. Each scenario gets a fresh clone of the bootstrapped template database. A reduced audit schema is created inside the test as `platform_audit_owner`: `audit_entries` (partitioned, with only the chain-relevant columns), `audit_stream_heads`, `audit_checkpoint_heads`, `audit_anchors` (full §3.4 column set and CHECKs), and the §5.2 `audit_forbid_mutation` row and statement triggers. Grants follow §4.4: `platform_app` gets `SELECT, INSERT` on entries, checkpoint heads and anchors, plus `UPDATE` on stream heads. This is throwaway SQL. Nothing was added to `prisma/bootstrap/**` or `prisma/migrations/**`.
- `prisma/tests/spikes/spk08/anchor-prototype.ts` holds the pure helpers and the verifier: `be64`, `headsDigest`, `anchorHash`, `signAnchorHash`/`verifyAnchorSignature` (DER), `derToP1363` (for WebCrypto), `sinkLine`/`parseSinkLine` (JCS), `verifyAnchorLog` (step i), `verifyAnchorSignatures` (step ii), `verifyAnchoredHeads` (step iii a+b), `verifyStreamChain` (§5.6 chain walk), and the DB readers. `tools/tsconfig.json` already includes `../prisma/tests/**/*.ts`, so no tsconfig edit was needed.
- The writer and the checkpoint follow the §5.4 and §5.5 procedures and run as `platform_app`: `audit:anchors` advisory lock, one head snapshot, delta `audit_checkpoint_heads` insert via `unnest` plus `LATERAL`, the anchor insert, then the shard-0 `CHAIN_CHECKPOINT` entry last. After COMMIT the record is appended to a `file:` JSONL sink (fsync per record) in a temp directory under `os.tmpdir()`, which is deleted in `afterAll`.
- The attacker is the cluster superuser with `SET LOCAL session_replication_role = replica`, which skips the append-only triggers. It re-hashes streams, rewrites stream heads, checkpoint-head rows, the checkpoint entry and anchors, and optionally the sink.
- Keys: `generateKeyPairSync('ec', { namedCurve: 'P-256' })` runs in memory per run. The private key is never exported, written or printed. Only the SPKI PEM, signatures and hashes reach disk, and only for the openssl check.

### 5.2 Checks

| # | Check | Test (title prefix) | Result |
|---|---|---|---|
| 1 | Keys and signature encoding: DER (first byte 0x30, 70 bytes here, inside the CHECK 8..72); Node `crypto.verify` accepts it; a wrong message is rejected; **`openssl dgst -sha256 -verify pub.pem -signature sig.der anchor_hash.bin` → `Verified OK`**; WebCrypto accepts only the P1363 conversion and rejects raw DER; golden vectors recorded | `SPK-08-ANCHOR-01 keys: …` | GREEN |
| 2 | Happy path: two org streams, three checkpoints. `anchor_seq` = [1,2,3], `prev_anchor_hash` chained (seq 1 = 32 zero bytes), the sink matches the table byte for byte, delta rows per checkpoint are [2,3,3] and an idle checkpoint writes 1. Chain walk plus steps (i)-(iii) give no failures. The newest anchor missing from the sink is tolerated only while the retry window is open, and gives `ANCHOR_MISSING` once it closes | `SPK-08-ANCHOR-02 happy path: …` | GREEN |
| 3 | SEC-TC-44 (a): entry `ORG_A` seq 2, older than every anchor, is altered. The attacker re-chains the stream, rewrites the stream head and the `audit_checkpoint_heads` rows, rewrites the latest checkpoint entry's `new_value.heads_digest` (re-chaining shard 0), and rewrites the anchor's `heads_digest` and a recomputed `anchor_hash`. The chain walk reports nothing. With the sink untouched the result is `CHECKPOINT_SIGNATURE_INVALID@ii` plus `ANCHOR_MISSING@i`. With the sink line forged as well it is **`CHECKPOINT_SIGNATURE_INVALID@ii` alone** | `SEC-TC-44 (a) …` | GREEN |
| 4 | SEC-TC-44 (b): the same tamper with the anchor untouched gives exactly **`CHECKPOINT_HEAD_MISMATCH@iii-a`** (the reconstructed digest differs from the anchor). A lazier attacker who leaves `audit_checkpoint_heads` alone is caught by the per-stream probe `CHECKPOINT_HEAD_MISMATCH@iii-b` on `ORG_A` | `SEC-TC-44 (b) …` | GREEN |
| 5 | SEC-TC-44 (c): deleted middle anchor, deleted newest anchor (also with the retry window open, because the sink holds a record the table lacks), swapped `anchor_seq` 2 and 3 in the table, and swapped sink lines 2 and 3. Every variant gives **`ANCHOR_MISSING@i`**. Reordered rows also give `CHECKPOINT_SIGNATURE_INVALID@ii`, because `anchor_seq` is hashed | `SEC-TC-44 (c) …` | GREEN |
| 6 | Append-only: `platform_app` UPDATE, DELETE and TRUNCATE each fail with 42501 "permission denied for table audit_anchors" (privilege). The owner `platform_audit_owner` fails with 42501 `AUDIT_IMMUTABLE: <op> on audit_anchors is not permitted` (trigger). An anchor that is correctly chained and present in the sink but signed under the unregistered `audit-anchor-v9` gives exactly `CHECKPOINT_SIGNATURE_INVALID` ("unknown key_id audit-anchor-v9"). The same anchor relabelled with the registered `key_id` gives "signature does not verify" | `SPK-08-ANCHOR-06 append-only: …` | GREEN |
| 7 | Measure (Windows 11 dev host, Docker Desktop): sign plus verify of one anchor **0.257 ms** (mean of 200). Reading 1,000 anchors from PostgreSQL **20 ms**. Steps (i)+(ii) over 1,000 anchors, including 1,000 ECDSA verifies and JCS re-serialisation, **227 ms**. The bound was < 30 s. After the 1,000 anchors, a real checkpoint correctly produces seq 1001 chained to anchor 1000 (regression for finding AF-1) | `SPK-08-ANCHOR-07 measure: …` | GREEN |

Not run: `EXPLAIN (ANALYZE)` of the step (iii)(b) probe at volume. The spike tables hold a few rows, so the plan would not mean anything. TASK-116 should capture it on the NFR-PERF-006 seeded dataset. The expected path is one index probe on the PK `(occurred_at, id)` or `ix_audit__stream_seq` per stream, pruned to one partition by the exact `occurred_at = head_occurred_at` predicate.

Golden vectors (for TASK-116 unit tests; pinned in `SPK-08-ANCHOR-01` since fix cycle 1):
- `headsDigest([{00000000-0000-0000-0000-000000000002, 2, 0x22×32}, {…0001, 1, 0x11×32}])` = `0425126b6f48a8a14993da0de8d42d83f1625e62b687cd46d6d70bfc154cafc6`. The input order is deliberately unsorted.
- `anchorHash(seq 1, '2026-11-12T10:00:00.000000Z', <digest above>, 32×0x00)` = `3bf63296f767bb8bd33b648d2aa65a991fe99cce26aafa527c0ef73594a2a9b5`
- `headsDigest([])` = SHA-256("") = `e3b0c442…b855`

### 5.3 Findings for consumers

#### Checkpoint/anchor writer (TASK-116 per `task-map.csv`, "hourly ECDSA-signed anchors"; the round-1 record said TASK-033, which owns the immutability tests)
- **AF-1 (bug class, found by the spike): the ORDER BY alias trap.** `SELECT anchor_seq::text AS anchor_seq … ORDER BY anchor_seq DESC LIMIT 1` sorts by the *text output alias*, because PostgreSQL resolves ORDER BY names to output columns first. After anchor 10 the writer picks '9' as the previous anchor, and the insert either breaks the chain or hits a PK violation. The same applies to `stream_seq::text AS stream_seq … ORDER BY stream_seq` in the chain walk. Qualify the column (`ORDER BY a.anchor_seq`) or do not alias casts to the column name. The spike failed on exactly this at 1,000 anchors before the fix. Add a lint or unit rule, or at least a ≥ 11-anchor test.
- **AF-2: microsecond timestamps cannot come from JS `Date`.** It has millisecond precision, and `pg` parses `timestamptz` into `Date`, which loses the microseconds. Take `created_at` from `clock_timestamp()` inside the anchor transaction, rendered by PostgreSQL as `to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, and bind that text back as `$n::timestamptz`. The text round-trips exactly. Do the same for `occurred_at` in §5.4.
- AF-3: generate `checkpoint_entry_id` with `pg_catalog.uuidv7()` inside the transaction that holds `audit:anchors`. The reconstruction `checkpoint_entry_id <= k` relies on UUIDv7 order matching anchor order, and IDs minted in the app on different hosts could misorder under clock skew. The spike does this.
- AF-4: the delta set is never empty after the first checkpoint. Shard 0 always moves, because of the previous checkpoint entry, so an idle hour writes one row. Shard 0 first appears in checkpoint 2, because its entry is appended after the snapshot. This is consistent with §5.5 and has no effect on volume.
- AF-5: the `unnest(uuid[], bigint[], bytea[], timestamptz[])` delta insert with `LEFT JOIN LATERAL … ORDER BY checkpoint_entry_id DESC LIMIT 1` works as specified with node-pg (Buffer arrays bind as `bytea[]`; bigint as decimal strings).
- AF-6: the sink must be written *after* COMMIT, as specified. The test covers the "COMMIT done, sink not yet written" state (green inside the retry window, `ANCHOR_MISSING` after it).

#### TASK-116 (verifier)
- AF-2 applies: select `created_at`/`occurred_at` as text with the same `to_char` format. With `Date` every anchor would recompute to a different hash and report a false `CHECKPOINT_SIGNATURE_INVALID`.
- **AF-7: a single run can raise more than one kind.** Case (a) with an honest (locked) sink yields both `ANCHOR_MISSING` (table and sink differ) and `CHECKPOINT_SIGNATURE_INVALID`. Reordered table rows also yield both. `audit_chain_verifications.failure_kind` holds one value, so a precedence rule is needed (see §5.4 A-1).
- AF-8: "byte-identical" table/sink comparison is implemented as: serialise the table row with the *same* canonical serialiser (JCS, see A-3) and string-compare it with the sink line. Byte-identical duplicates in the sink collapse; a differing duplicate gives `ANCHOR_MISSING`. A record in the sink but missing from the table gives `ANCHOR_MISSING` even inside the retry window.
- AF-9: the chain walk alone is fooled by every SEC-TC-44 tamper (zero `chain` failures in (a) and (b)). The anchors are the only control against a superuser, so step (iii) must not be skipped on hourly runs. *Qualifier (PR12-SEC-05):* the spike's `verifyAll` walks every stream from seq 1 on every run, which is the **nightly** shape. The production hourly run is incremental (data-model §5.6: `stream_seq > last_verified_*`, a value `platform_app` can update) and detects changes to anchored head rows; a rewrite **behind** an anchored head that leaves the head row intact passes the hourly run and is detected only by the nightly full walk (`PREV_HASH_MISMATCH` / `HASH_MISMATCH`, ≤ 24 h, as §5.6 allows). The nightly run starts every stream at seq 1 from `ZERO32` and ignores `last_verified_*`.
- AF-10: step (iii)(b) can be one statement: `unnest` of the anchored heads `LEFT JOIN audit_entries ON (stream_id, stream_seq, occurred_at = head_occurred_at)`. A NULL join result or a differing `entry_hash` gives `CHECKPOINT_HEAD_MISMATCH` with `first_broken_stream_id`. Batch it (e.g. 10,000 streams per statement) at Y1 volume.
- AF-11: an in-browser verifier (WebCrypto) must convert the DER signature to IEEE P1363 `r‖s`. That is about 20 lines (`derToP1363` in the prototype). WebCrypto `verify` rejects DER outright (test 1).
- AF-12: checking only the latest anchor in (iii) is sound **together with a full walk from seq 1 in the same run (nightly)**. Each anchored `head_hash` commits to the whole stream prefix, so any rewrite at or before an anchored head changes some latest anchored head or breaks (iii)(b) or the full walk. The hourly incremental run detects head-row changes; behind-head rewrites with an intact head row are detected by the nightly full walk (≤ 24 h, §5.6). Older anchors' head sets are not re-checked, and they need not be. TASK-116 adds the SEC-TC-44 variant "behind-head rewrite, head row intact" (hourly: no failure, documented; nightly: `PREV_HASH_MISMATCH`/`HASH_MISMATCH`) plus the `algorithm ≠ ECDSA_P256_SHA256` and malleated-signature rows (PR12-SEC-05 b).
- Measured cost: steps (i)+(ii) take about 0.23 ms per anchor, so 24/h and the nightly "since last nightly" range are negligible.

#### TASK-021 (DDL)
- The §3.4 `audit_anchors` DDL works as written on PG 18: PK `anchor_seq` `CHECK >= 1`, `checkpoint_entry_id UNIQUE`, `anchor_hash UNIQUE`, octet-length CHECKs, the `algorithm` CHECK, and signature `BETWEEN 8 AND 72`. DER P-256 signatures were 70-72 bytes, and shorter ones are possible with low probability.
- Recommend adding `CHECK (key_id ~ '^[a-z][a-z0-9-]*-v[0-9]+$')` (named `ck_audit_anchors__key_id`) to match the other `<purpose>-v<n>` columns. §3.4 does not list it for `audit_anchors`. The spike used it.
- The append-only behaviour is confirmed. For `platform_app` the privilege denies UPDATE, DELETE and TRUNCATE before the trigger fires. For the owner the trigger raises 42501 `AUDIT_IMMUTABLE`. Superuser with `session_replication_role = replica` bypasses both, which is the threat model; the anchors detect it.
- `audit_checkpoint_heads` needs `ix_audit_checkpoint_heads__stream_checkpoint (stream_id, checkpoint_entry_id DESC)` for both the LATERAL delta lookup and the `DISTINCT ON (stream_id) … ORDER BY stream_id, checkpoint_entry_id DESC` reconstruction. Both shapes work.

### 5.4 Spec ambiguities / contradictions (with proposed wording)

- **A-1 (contradiction, §5.6 amendment "How the review's tamper case maps"):** the text says (a) → `CHECKPOINT_SIGNATURE_INVALID`. When the sink is honest, step (i) also fails, because the table's rewritten `heads_digest` differs from the sink record. In a step-ordered verifier the run reports `ANCHOR_MISSING` first. Proposed wording: "The verifier runs steps (i)-(iii) to completion and emits the security event of every failing step. `failure_kind` records the most specific failure by precedence `CHECKPOINT_SIGNATURE_INVALID` > `CHECKPOINT_HEAD_MISMATCH` > `ANCHOR_MISSING` > chain kinds, with `anchor_seq_from/_to` covering the range." Alternative: add `failure_kinds text[]`.
- **A-2 (contradiction, digest field order):** ADR-0007 amendment 6 says the digest is over the ordered `(stream_id, head_hash, stream_seq)` list. data-model §3.4 and §5.5 say `stream_id(16 B) ‖ be64(entry_count) ‖ head_hash(32 B)`. The spike follows data-model §5.5. Proposed: amend ADR-0007 am. 6 to "… the digest defined in data-model.md §5.5". Also state that "sorted by stream_id" means ascending by the 16 raw UUID bytes (= PostgreSQL `uuid` order = lower-case hex order), and that the empty set digests to SHA-256 of the empty string.
- **A-3 (ambiguity, sink record):** "byte for byte" is undefined without a serialisation, and `anchor_seq` type is unstated. Proposed §5.5 "Sink record": "One line per record: the RFC 8785 (JCS) serialisation of `{anchor_seq: <JSON number>, checkpoint_entry_id: <lower-case UUID>, created_at: <hashed text form>, heads_digest, prev_anchor_hash, anchor_hash: <lower-case hex>, algorithm, key_id, signature: <base64 of DER>}`, followed by `\n`."
- **A-4 (ambiguity, §5.5 "created_at = now, truncated to µs"):** in Node this is not implementable as written (AF-2). Proposed: "created_at = `clock_timestamp()` read in the anchor transaction, rendered by PostgreSQL as `to_char(… AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')`; the verifier reads it in the same form."
- **A-5 (inaccuracy, ADR-0007 am. 8 item 5 / §5.5):** "WebCrypto `ECDSA` … without new code" does not hold for verification. WebCrypto takes IEEE P1363 signatures, while the stored form is DER (AF-11). Proposed: "… WebCrypto `ECDSA` (after converting the DER signature to IEEE P1363 r‖s) …". The DER choice itself is right: openssl and KMS `Sign` both produce and verify DER.
- **A-6 (ambiguity, §5.6 step i "only while the writer's sink retry (≤ 15 min) is still running"):** the verifier runs in another process and cannot observe the retry. Proposed: "… the newest table anchor may be absent from the sink while its `created_at` is less than 15 min before the verifier's clock".
- **A-7 (ambiguity, §5.6 step iii "for the latest anchor"):** if the latest table anchor fails (i) or (ii), it is unclear which anchor (iii) should use. Proposed: "… for the latest anchor that passed (i) and (ii); if none in range passed, (iii) is skipped and the run is FAILED already".

### 5.5 Reproduce

From the TASK-012 worktree (Docker Desktop running; take the host docker.lock first):

```
export PATH="$APPDATA/fnm/aliases/default:$PATH"
SPK08_ANCHOR_REPORT=<scratch>/anchor-report.json node --experimental-vm-modules --disable-warning=ExperimentalWarning node_modules/jest/bin/jest.js prisma/tests/spikes/spk08-anchor.int.test.ts --selectProjects integration -i
```

Result: 7 passed, 7 total. Jest time 13.1 s (about 14 s wall), of which about 4.9 s is container start plus bootstrapped template. `SPK08_ANCHOR_REPORT` is optional and writes the measured values and per-variant failure kinds as JSON.

## 6. RDS parity (desk research): CONFIRMED with M5 checks

Desk research only (AWS and PostgreSQL documentation, release notes, REL_18_STABLE source, pgsql-bugs; accessed 2026-11-12). Nothing here was run on RDS: every row ends with the check that must be repeated on a real RDS 18 instance at M5 (COND-G4-PROD). Mitigation proposed for the `session_replication_role` bypass: create the event triggers and the audit row/statement triggers `ENABLE ALWAYS` (they then fire in replica mode too) — to be decided by principal-architect with TASK-021.

All sources accessed **2026-11-12**. This is desk research only: nothing was run on RDS. "Vanilla" means community PostgreSQL. On RDS the bootstrap superuser is `rdsadmin` (internal). The master user (`postgres` by default) is `NOSUPERUSER CREATEROLE CREATEDB` and a member of `rds_superuser`.

### 6.1 Can the RDS master create event triggers (`ddl_command_end`, `sql_drop`)?
**Verdict: CONFIRMED** for creation by the master user, on every available RDS version (17 and 18 included). The docs show only a `ddl_command_end` example. `sql_drop` is not named, but it is a standard event type, and the docs grant the general right without restricting event types.
- AWS, *Event triggers for RDS for PostgreSQL* (https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.FeatureSupport.EventTriggers.html): "All current PostgreSQL versions support event triggers, and so do all available versions of RDS for PostgreSQL. You can use the main user account (default, `postgres`) to create, modify, rename, and delete event triggers. Event triggers are at the DB instance level, so they can apply to all databases on an instance."
- The same page lists these limits: "You can't create event triggers on read replicas." The triggers are copied to replicas and do not fire there until the replica is promoted. Also: "To perform a major version upgrade to a PostgreSQL DB instance that uses event triggers, make sure to delete the event triggers before you upgrade the instance." **This affects the M5 runbook: every major upgrade needs a drop and re-create step.**
- Since when: AWS What's New, 2016-09 (https://aws.amazon.com/about-aws/whats-new/2016/09/amazon-rds-for-postgresql-enhancements-support-for-new-minor-versions-logical-replication-and-amazon-rds-postgresql-as-a-source-for-aws-dms): "Amazon RDS now supports the event triggers in PostgreSQL versions 9.4.9 and later and version 9.5.4 and later." (Quoted from a search snippet; page not opened.)
- How vanilla behaves (REL_18_STABLE `src/backend/commands/event_trigger.c`, https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/commands/event_trigger.c):
  - `CreateEventTrigger` checks `if (!superuser())` and fails with "Must be superuser to create an event trigger." RDS must patch this check so that `rds_superuser` passes. AWS does not document how it does this.
  - The source has **no ownership check on the trigger function**. It only requires the function to return `event_trigger`. So the function can be owned by another role, for example a `SECURITY DEFINER` function owned by `platform_audit_owner`.
  - Event-trigger ownership rule: "The owner of an event trigger must be a superuser" (`AlterEventTriggerOwner_internal`).
  - Whether a trigger fires depends only on four things: `IsUnderPostmaster`, the `event_triggers` GUC, `session_replication_role`, and the command tag. **No check exempts any role, so triggers also fire for superuser and `rds_superuser` sessions.**
  - `filter_event_trigger` skips triggers that are in the default (`ENABLE`, origin) state when `SessionReplicationRole == SESSION_REPLICATION_ROLE_REPLICA`.
- Bypass paths (PG 18 docs, https://www.postgresql.org/docs/18/runtime-config-client.html):
  - `event_triggers`: "All event triggers will be disabled by setting it to `false` … Only superusers and users with the appropriate `SET` privilege can change this setting." This GUC was added in PG 17.
  - `session_replication_role` has the same "superusers … appropriate `SET` privilege" rule.
  - A third-party source (Xata pgstream docs) says RDS lets `rds_superuser` set `session_replication_role`. **If so, any `rds_superuser` member can silently suppress origin-mode event triggers.** Possible mitigations: `ALTER EVENT TRIGGER … ENABLE ALWAYS`, or detecting the suppression.
- **Verify at M5 (RDS 18):**
  - (a) `CREATE EVENT TRIGGER` works for `ddl_command_end` and `sql_drop` as the master user.
  - (b) A trigger function owned by a non-`rds_superuser` role is accepted.
  - (c) Triggers fire for the master user's own DDL and for DDL from other `rds_superuser` members.
  - (d) Whether the master user can `SET session_replication_role = replica` and `SET event_triggers = off`. Check `pg_settings.context` and use `has_parameter_privilege`.
  - (e) Whether `ENABLE ALWAYS` triggers still fire under `replica`.
  - (f) Rehearse the drop and re-create of event triggers around a major-version upgrade.
  - (g) Whether the master user can `SET pgaudit.log = 'none'` in its own session. If it can, the connection and credential-retrieval alarms are the only signal (PR12-SEC-04).
  - (h) That the major-upgrade event-trigger drop and re-create (f) runs with migrations frozen and is followed immediately by the C14 catalog check (PR12-SEC-04).
- **`ENABLE ALWAYS` is not a decided mitigation.** It closes only the `session_replication_role = replica` bypass; it does not close `event_triggers = off` (if the master can set it, check d), `ALTER EVENT TRIGGER … DISABLE` or the `SET ROLE platform_audit_owner` path of §6.2. If adopted, `ensure_audit_partitions` must also set `ALWAYS` on each per-partition TRUNCATE trigger, and C6/C14 must expect `evtenabled`/`tgenabled = 'A'` instead of the spike's `'O'` (PR12-SEC-04 item 3). Decision: principal-architect with security-analyst, before TASK-021 writes the bootstrap DDL.

### 6.2 How does a CREATEROLE non-superuser `SET ROLE` to a role it creates, then drop back to an ADMIN-only membership?
**Verdict: CONFIRMED on vanilla PG 16+. RDS-specific behaviour is UNCLEAR (not documented by AWS).**
- PG 16 release notes (https://www.postgresql.org/docs/16/release-16.html):
  - "Allow roles that create other roles to automatically inherit the new role's rights or the ability to `SET ROLE` to the new role … This is controlled by server variable `createrole_self_grant`."
  - "Add `GRANT` to control permission to use `SET ROLE` … controlled by a new `GRANT ... SET` option."
  - "Allow multiple role membership records."
  - "Add dependency tracking of grantors for `GRANT` records."
- `createrole_self_grant` (https://www.postgresql.org/docs/18/runtime-config-client.html): "If a user who has `CREATEROLE` but not `SUPERUSER` creates a role, and if this is set to a non-empty value, the newly-created role will be granted to the creating user with the options specified. The value must be `set`, `inherit`, or a comma-separated list … Since a `CREATEROLE` user is always implicitly granted `ADMIN OPTION` on created roles, that user could always execute a `GRANT` statement that would achieve the same effect."
- Source (`src/backend/commands/user.c`, REL_18_STABLE, `CreateRole`):
  - The implicit grant is created with `poptself.admin = true; poptself.inherit = false; poptself.set = false;` and grantor `BOOTSTRAP_SUPERUSERID`. Code comment: "The grantor of record for this implicit grant is the bootstrap superuser, which means that the CREATEROLE user cannot revoke the grant."
  - The self-grant from `createrole_self_grant` is a **second** `pg_auth_members` row whose grantor is `currentUserId`.
- GRANT docs (https://www.postgresql.org/docs/18/sql-grant.html):
  - "The `SET` option, if it is set to `TRUE`, allows the member to change to the granted role using the `SET ROLE` command."
  - "To create an object owned by another role or give ownership of an existing object to another role, you must have the ability to `SET ROLE` to that role."
- REVOKE docs (https://www.postgresql.org/docs/18/sql-revoke.html):
  - "it is also possible to revoke `INHERIT OPTION` or `SET OPTION`. This is equivalent to setting the value of the corresponding option to `FALSE`."
  - "A user can only revoke privileges that were granted directly by that user."
- Recommended sequence. Run it as the master user, in one migration transaction:
  ```sql
  CREATE ROLE platform_audit_owner NOLOGIN;            -- implicit row: admin=t, inherit=f, set=f, grantor=bootstrap (rdsadmin)
  GRANT platform_audit_owner TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;  -- 2nd row, grantor=current user (allowed via ADMIN)
  -- (equivalent shortcut: SET LOCAL createrole_self_grant = 'set'; before CREATE ROLE)
  SET ROLE platform_audit_owner;  CREATE TABLE/FUNCTION ... ;  RESET ROLE;    -- objects owned by platform_audit_owner
  REVOKE platform_audit_owner FROM CURRENT_USER;       -- removes ONLY the self-granted row; ADMIN row (bootstrap grantor) remains
  ```
  Use the full `REVOKE`, not `REVOKE SET OPTION FOR …` or `GRANT … WITH SET FALSE`. Those two leave a useless row (admin=f, inherit=f, set=f) in `pg_auth_members`.
- **Residual risk** (proposed COND-G4-PROD statement, PR #12 security review §6, PR12-SEC-04; replaces this record's earlier sentence, which counted on event-trigger detection that does not exist for this path):

  > On RDS the master user (a member of `rds_superuser`) keeps an ADMIN-only membership in `platform_audit_owner` and `platform_schema_owner` that it cannot revoke. With it, the master can at any time grant itself `SET`, `SET ROLE platform_audit_owner` and run any audit DDL. The identity guard exempts that role, and PostgreSQL fires no event trigger for role grants, `SET ROLE`, `REASSIGN OWNED` or commands on event triggers. **Against the master, the database therefore provides no prevention, and event triggers provide no detection.** `ENABLE ALWAYS` closes only the `session_replication_role = replica` bypass.
  >
  > Tamper evidence against this actor consists of:
  > 1. The signed anchors:
  >    - a change to an anchored head is detected within 1 h;
  >    - a rewrite behind an intact anchored head is detected by the nightly full walk within 24 h;
  >    - entries newer than the latest anchor (≤ 1 h plus the 15-minute sink retry) can be rewritten undetected.
  > 2. The locked anchor sink (Object Lock compliance mode, conditional puts).
  > 3. `pgaudit` with `ddl, role, misc_set`, exported to a log group no app, CI or master-adjacent role can alter, with the alarms of PR12-SEC-04.
  > 4. The break-glass alarm on every `GetSecretValue` of the master secret.
  >
  > M5 checks (a)–(h) of SPK-08 §6 and PR12-SEC-04 are G4-production preconditions.

  The `pgaudit` classes and metric filters, M5 checks (g)/(h) and the upgrade-window procedure are owned by principal-architect / platform-architect and release-manager (G4-production checklist), not by this spike.
- **Verify at M5:**
  - (a) Whether RDS changes `CreateRole` for `rds_superuser` members, i.e. the implicit row exists with grantor = `rdsadmin`.
  - (b) `SELECT context FROM pg_settings WHERE name='createrole_self_grant'` shows `user`, and the parameter-group default is empty.
  - (c) After the `REVOKE`, `pg_auth_members` contains exactly one row (admin=t, set=f, inherit=f).
  - (d) `SET ROLE platform_audit_owner` then fails.

### 6.3 Can an `rds_superuser` member `ALTER … OWNER TO`, or create a `SECURITY DEFINER` function owned by, a role it cannot `SET ROLE` to?
**Verdict: NOT SUPPORTED on vanilla. UNCLEAR on RDS. Design for the documented path: a temporary SET grant (Q2).**
- ALTER TABLE (https://www.postgresql.org/docs/18/sql-altertable.html): "To alter the owner, you must be able to `SET ROLE` to the new owning role, and that role must have `CREATE` privilege on the table's schema. … However, a superuser can alter ownership of any table anyway." ALTER FUNCTION (https://www.postgresql.org/docs/18/sql-alterfunction.html) has the same wording.
- An RDS divergence is reported in PG bug #18411 (https://www.postgresql.org/message-id/flat/18411-fdfca450bc4e7dd8%40postgresql.org):
  - On RDS 16.2, `postgres` got `CREATE DATABASE … OWNER=my_user` → "ERROR: must be able to SET ROLE "my_user"", **but `ALTER DATABASE … OWNER TO my_user` succeeded**.
  - Tom Lane: "Both things fail for me … I suggest taking this up with AWS."
  - This shows that RDS patches some ownership checks for `rds_superuser`. It is undocumented and might not cover tables or functions.
- No `SET ROLE` to `rds_superuser` is possible. A third-party blog (thebuild.com) reports it is reserved.
- `SECURITY DEFINER` owned by X: on vanilla you need either `SET ROLE X` followed by `CREATE FUNCTION … SECURITY DEFINER`, or `CREATE` followed by `ALTER FUNCTION … OWNER TO X`. Both need the SET option. The Q2 sequence covers this, and X needs `CREATE` on the schema.
- **Verify at M5:** as the master user, *without* a SET grant, try `ALTER TABLE t OWNER TO platform_audit_owner` and `ALTER FUNCTION f() OWNER TO platform_audit_owner`. Record the result. Do not rely on any bypass.

### 6.4 Are `pg_trgm`, `btree_gin` and `btree_gist` trusted on PG 18 and available on RDS 17 and 18?
**Verdict: CONFIRMED.**
- PG 18 Appendix F (https://www.postgresql.org/docs/18/contrib.html): "Trusted extensions can be run by any user who has `CREATE` privilege on the current database." The list of extensions "trusted in a default installation" includes btree_gin, btree_gist and pg_trgm.
- Each module's page (pgtrgm.html, btree-gin.html, btree-gist.html, v18) says: "This module is considered "trusted", that is, it can be installed by non-superusers who have `CREATE` privilege on the current database."
- AWS (https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.FeatureSupport.Extensions.html): "As of RDS for PostgreSQL 13, certain extensions can be installed by database users other than the `rds_superuser`." The trusted list includes btree_gin, btree_gist and pg_trgm. The page warns that `rds.allowed_extensions` (default `*`) can block installation ("permission denied to create extension … not specified in "rds.allowed_extensions"").
- AWS release notes (https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-extensions.html) list these versions:

  | | pg_trgm | btree_gin | btree_gist |
  |---|---|---|---|
  | RDS 18 (18.6 down to 18 Beta 1) | 1.6 | 1.3 | 1.8 |
  | RDS 17 (17.11) | 1.6 | 1.3 | 1.7 |
- **Verify at M5:**
  - `SHOW rds.allowed_extensions` and `SHOW rds.extensions` on the parameter group.
  - `CREATE EXTENSION` works as a non-`rds_superuser` database owner.
  - Pin extension versions in migrations, or accept the RDS defaults.

### 6.5 Can a non-superuser on vanilla PG 18 create event triggers?
**Verdict: NOT SUPPORTED.**
- CREATE EVENT TRIGGER, v18 (https://www.postgresql.org/docs/18/sql-createeventtrigger.html): "Only superusers can create event triggers." ALTER EVENT TRIGGER (https://www.postgresql.org/docs/18/sql-altereventtrigger.html): "You must be superuser to alter an event trigger."
- PG 18 predefined roles (https://www.postgresql.org/docs/18/predefined-roles.html) lists 16 roles, from `pg_checkpoint` to `pg_use_reserved_connections`. **None of them is a `pg_create_event_trigger` or any other event-trigger role.**
- Release notes:
  - PG 17 (https://www.postgresql.org/docs/17/release-17.html) adds connection-time (login) event triggers, a REINDEX event, and the `event_triggers` GUC. It does not delegate event-trigger creation.
  - PG 18 (https://www.postgresql.org/docs/18/release-18.html) has no event-trigger permission item. Its only new predefined role is `pg_signal_autovacuum_worker`.
- Consequence: local Docker (vanilla PG 18) must create event triggers as a **real superuser** in a bootstrap step, while RDS uses the `rds_superuser` master. The migration role model needs a "superuser-equivalent bootstrap" seam.
- **Verify at M5:** nothing on RDS. Re-check the PG 19 release notes when they are published.

### 6.6 Summary
| # | Question | Verdict | Key M5 check on real RDS 18 |
|---|---|---|---|
| 1 | Master creates `ddl_command_end`/`sql_drop` event triggers | CONFIRMED (drop before major upgrade; not on replicas) | Firing for `rds_superuser` DDL; whether master can set `session_replication_role`/`event_triggers` |
| 2 | CREATEROLE self-grant SET, then back to ADMIN-only | CONFIRMED vanilla / UNCLEAR on RDS | `pg_auth_members` rows and grantor (`rdsadmin`) after `REVOKE … FROM CURRENT_USER` |
| 3 | `OWNER TO` / SECURITY DEFINER without a SET grant | NOT SUPPORTED vanilla / UNCLEAR RDS (bug #18411 shows a divergence) | Try `ALTER TABLE/FUNCTION … OWNER TO` without a SET grant; do not rely on it |
| 4 | pg_trgm / btree_gin / btree_gist trusted, on RDS 17/18 | CONFIRMED (1.6 / 1.3 / 1.8 on 18) | `rds.allowed_extensions`; install as non-`rds_superuser` DB owner |
| 5 | Non-superuser event triggers on vanilla PG 18 | NOT SUPPORTED (no predefined role in 17/18) | none (local bootstrap needs a true superuser) |

## 7. Findings for consumers

Due points: TASK-021 starts in batch 0.6 and TASK-033 merges in batch 0.10 (WAVE-00); TASK-116 is batch 3.6.

| ID | Finding | Consumer / action | Due |
|---|---|---|---|
| F-01 | **First `migrate deploy` fails with P3005 once the bootstrap lane has created the audit tables, unless every partition is in `tables.external`.** Listing the parents (§7.3) is not enough: Prisma's "schema not empty" check counts `audit_entries_YYYY_MM`. Non-existent external names are accepted, so a **generated range** works (60 names verified). Later deploys (with `_prisma_migrations` present) and the differ are not affected (exit 4). | **TASK-021**: root `prisma.config.ts` `tables.external` = the eight audit tables **plus** `public.audit_entries_YYYY_MM` generated in the config for a bounded window (e.g. 2026-01 to the current month + 24, a pure function, no DB access). Security ruling (PR12-SEC-07): the generated window is approved; the lane re-ordering alternative ("first `migrate deploy` before `10-audit.sql`") is **rejected**; the M5 dedicated `audit` schema stays the preferred long-term option. **TASK-034**: the restore rehearsal's post-restore `migrate status`/`deploy` uses the same config | Spec: before TASK-021 starts. Code: TASK-021 merge |
| F-02 | **Prisma resets only `public` of the shadow database.** Objects in `platform` survive between runs, so a second run without the DROP fails with "function \"audit_forbid_mutation\" already exists with same argument types" (run 1; asserted since fix cycle 1 by the F-02 negative control). | Whoever implements the shadow rendering (TASK-021 with §7.3): emit `DROP SCHEMA IF EXISTS <s> CASCADE` before each `CREATE SCHEMA IF NOT EXISTS <s>`, or make every rendered statement idempotent. The DROP relies on the migrator owning the shadow database and its `platform`; if `SHADOW_DATABASE_URL` points at a real (bootstrapped) database, where `platform_schema_owner` owns `platform`, it fails closed with `42501`. It also clears objects that **migrations** create in `platform` (TASK-016's helper functions). On a non-bootstrapped developer database owned by the migrator a mis-set URL would wipe `platform`, so the rendered init's first statement must refuse unless `current_database()` is owned by `current_user` (PR12-SEC-07) | Spec: before TASK-021 starts. Code: TASK-021 merge |
| F-03 | **The rendering must strip grants and default privileges too**, not only roles / `SET ROLE` / `OWNER TO` / `AUTHORIZATION` / event triggers as §7.3 lists. Not individually tested whether they would run; `ALTER DEFAULT PRIVILEGES FOR ROLE platform_audit_owner` cannot (the migrator is not a member), and grants are not diffed. Policies `TO platform_app` were kept and ran (the Compose cluster has the roles) | §7.3 text; the rendering code (TASK-021) | Spec: before TASK-021 starts |
| F-04 | **Known drift, already recorded** in data-model §7.3 A17 (D-T013-09) and the `authz.prisma` header: `ix_role_permissions__role_id … INCLUDE ("permission_id")` cannot be expressed in the Prisma schema. **New:** `migrate dev --create-only` writes `DROP INDEX` + `CREATE INDEX "ix_role_permissions__role_id" ON "role_permissions"("role_id")` (without `INCLUDE`) into **every** new migration (asserted in exit 4). A17's catalog drift check tolerates the index **by name**, so a committed generated migration that drops and re-creates it without `INCLUDE` passes everywhere: migrations and database then agree, and the covering column is silently lost (AP-AUTHZ-02) | **TASK-016** linter rule: a migration may not `DROP INDEX` a name on the covering-index tolerance list unless the same file re-creates it with `INCLUDE`. Alternative: the catalog check compares `pg_index.indnkeyatts < indnatts` for the tolerated names. Module authors delete the two statements from generated migrations until then | TASK-016 follow-up, before the next migration-adding task merges |
| F-05 | **For the SEC-TC-43 statements the guard is never reached by the migrator on PG 18**: all 14 fail by privilege (`must be owner of …` or `permission denied for table …`). The guard is reached by the migrator only for **creations under audit names** (4 cases in §1) and for the `DROP` of an audit-named index on its own table (F-08). Privilege does not stop the **schema owner**, so the `sql_drop` cases in §1 are the guard's own evidence | **TASK-021** (port, §8.1): the privilege list, the four planted-name cases and the `sql_drop` cases into its C14/SEC-TC-43 suite. **TASK-033**: assert `42501` + the privilege message per role, plus the PR12-SEC-01 escalation primitives | TASK-021 merge; TASK-033 merge |
| F-06 | **The guard fires for the migrator although `EXECUTE` on `audit_ddl_guard()` is revoked from `PUBLIC`** — event-trigger invocation does not check `EXECUTE` (DETAIL "… by platform_migrator"). The §5.2 `REVOKE` is correct and needs no compensating grant | TASK-021 (keep as specified) | TASK-021 merge |
| F-07 | **Trigger messages name the partition** (`TG_TABLE_NAME` = `audit_entries_2026_11`), not `audit_entries`. | **TASK-033** / REQ-AUDIT-015 tests: match `^AUDIT_IMMUTABLE: (UPDATE|DELETE) on audit_entries(_\d{4}_\d{2})? is not permitted$` (the spike test now uses this form) | TASK-033 merge |
| F-08 | **Naming constraint from the guard:** any migrator `CREATE` of a table in `public`/`platform` matching `^(audit_[a-z0-9_]+|data_subjects)$`, or of a function named like an audit function, fails; a migrator `DROP` of a non-audit index named `ix_audit__*`, `pk_audit_*`, `ux_audit_*` or `audit_entries_*` fails too (name-matched at `sql_drop`; **observed** since fix cycle 1, §1). The `CREATE` of such an index on the migrator's own table is **not** refused (the guard maps an index to its table), which is the partition-name squat of PR12-SEC-02 (§8 item 6) | TASK-016 linter (rule proposal: reject `@@map("audit_…")` / such index, view, sequence or type names outside the bootstrap lane); the guard amendment of PR12-SEC-02 (principal-architect); module authors | Linter: TASK-016 follow-up. Guard: spec before TASK-021 starts |
| F-09 | **PG 18 confirmations used by the design:** `CREATE TABLE … (LIKE … INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED)` + `ATTACH PARTITION` works with the generated `scope_org_id`; the row trigger is cloned (`tgparentid`); `pg_catalog.uuidv7()` exists; `event_triggers` and `session_replication_role` are superuser-only, so the migrator cannot switch the guard or row triggers off per session | TASK-021; C13 adds `has_parameter_privilege(<role>, 'session_replication_role' / 'event_triggers' / 'pgaudit.log', 'SET')` = false for the migrator and `platform_app` (PR12-SEC-06) | TASK-021 merge |
| F-10 | **Test pattern** (reusable by TASK-033): bootstrap via the harness, prototype applied as the superuser in one transaction, tamper attempts in `BEGIN … ROLLBACK`, `DO`-block variants built by splitting the literal at `audit_`, outcomes classified by message (`privilege` / `guard`) | TASK-021, TASK-033 | TASK-033 merge |
| F-11 | **Raw-SQL partial indexes and `migrate dev` (§4).** With `partialIndexes` off, Prisma 7.10.1 keeps a raw-SQL partial index, and a plain `@@index` of the same name and columns hides the predicate from the differ. With it on, the next generated migration **drops** every partial index the schema does not declare, and re-creates one whose declared predicate differs. The preview flag is read from the **config** schema. `partialIndexes` is still preview in 7.10.1 | **principal-architect**: close the data-model §7.3 "Partial indexes" note with this result and record the rule "when `partialIndexes` is enabled, every partial index is declared with its exact `where: raw(…)`; until then partial indexes stay raw SQL and are **not** declared as plain `@@index`". **TASK-016** (linter or CI check): a generated migration must not `DROP INDEX` an index that an earlier migration created with `WHERE` unless the same file re-creates it; the CI `migrate diff --exit-code` (once F-04 is resolved) catches undeclared ones after the preview is enabled | Spec: before the first module migration with a partial index (the AP-PAY/AP-ORD/AP-SHP tasks); linter: TASK-016 follow-up |

## 8. Open questions and routed items

1. **Fail-closed path not exercised:** the guard raising "cannot resolve the protected schemas" when the audit owner owns
   nothing (e.g. a database where `90-*` runs without `10-audit.sql`). Owner: TASK-033 (one test). Due: TASK-033 merge.
2. **F-01 option choice** (generated range vs. lane re-ordering vs. dedicated schema): security-analyst ruled in PR #12
   (PR12-SEC-07): generated window approved, lane re-ordering rejected. principal-architect ratifies the §7.3 text
   before TASK-021 starts.
3. **The other audit tables** (`audit_stream_heads`, `audit_checkpoint_heads`, `audit_chain_verifications`,
   `audit_anchors`, `audit_pii_vault`, `data_subjects`, `audit_vault_guard()`) were not prototyped; by construction they
   follow the same ownership and guard rules (relname/ownership match). TASK-021's C13/C14 suite covers them.
4. **Spike file lifecycle:** see §8.1.
5. **`migrate dev` with partial indexes** (batch-3 rulings, routed to TASK-012): **answered** by the M1 probe (§4, F-11).
   Closed for the spike; the follow-ups are F-11's.
6. **Known finding PR12-SEC-02 (MEDIUM, from the PR #12 security review): partition-name squatting.** The guard does not
   cover indexes, views, sequences or types under an audit name; `ensure_audit_partitions` then skips that month
   silently (`to_regclass(...) IS NOT NULL`), and the "≥ 2 future partitions" readiness rule never fires for one missing
   month. Every audited write then fails on the first instant of that month. The spike observed the index variant
   (§1: `CREATE INDEX audit_entries_2099_02` on the migrator's own table succeeds; its `DROP` is refused, so removal
   needs break-glass). Routed: principal-architect / data-architect amend data-model §5.2 (guard matches the object's
   own name for every `pg_class`/`pg_type` kind), §5.3 (identity test with `AUDIT_PARTITION_NAME_TAKEN`) and the
   readiness rule (contiguity from the catalogue) **before TASK-021 starts**; TASK-021 implements; TASK-033 tests.
   The spike prototype is **not** changed: it stays verbatim to the current spec.
7. **Port warnings (PR12-SEC-08).** Do **not** port the prototype's `ENABLE`/`FORCE ROW LEVEL SECURITY` and placeholder
   policies on `audit_entries` (`10-audit.sql`; asserted only by the prototype catalog test): data-model §3 classifies
   `audit_entries` as SYSTEM (no RLS), the viewer repository applies the scope, and C1 allow-lists it. If RLS is ever
   added, the partitions must keep zero privileges (C5). Do not port the prototype header lines either: they record
   **no** security approval, and TASK-021's bootstrap files need the real rule-12 audit-DDL marker with an entry in
   `tools/db/audit-ddl-reviewers.json`. The first-install guard file should not use `CREATE OR REPLACE` (PR12-SEC-03).

### 8.1 Spike file lifecycle (port, then delete)

The merged spike files stay as executable evidence (SPK-03 / PR #7 m7 precedent) until their consumer ports them.
Both suites apply only the pre-audit bootstrap files (`0N-*.sql`) and create their own audit objects, so TASK-021's real
`10-audit.sql` / `90-*.sql` do not break them; nothing has to be deleted early to keep TASK-021's branch green.

| File | Ported by, into | Deleted by | Due |
|---|---|---|---|
| `prisma/tests/spikes/spk08-audit-owner.int.test.ts` | TASK-021: the SEC-TC-43 privilege list, the four planted-name guard cases (F-05), the `sql_drop` cases incl. the audit-named index (§1, F-08), the SEC-TC-61 subset, the generated-window deploy (F-01) and the shadow-rendering assertions incl. the F-02 negative control, into its C13/C14/SEC-TC-43 and shadow-init tests | **TASK-021's PR**, in the same commit as the port | TASK-021 merge (batch 0.6) |
| `prisma/tests/spikes/spk08/10-audit.sql` | Nothing ported: the real file is written from data-model §5.1–§5.3 with the F-0x and PR12-SEC amendments (§8 items 6–7) | TASK-021's PR | TASK-021 merge |
| `prisma/tests/spikes/spk08/90-audit-ddl-guard.sql` | Nothing ported: the real file follows the amended §5.2 (PR12-SEC-02 item 1, PR12-SEC-03) | TASK-021's PR | TASK-021 merge |
| `prisma/tests/spikes/spk08/prisma.config.ts` | TASK-021: `migrations.initShadowDb` with the rendered lane and the generated `tables.external` window move into the root `prisma.config.ts` | TASK-021's PR | TASK-021 merge |
| `prisma/tests/spikes/spk08-anchor.int.test.ts` | TASK-116: SEC-TC-44 (a)–(c) and ANCHOR-02/06/07 (incl. the ≥ 11-anchor ORDER-BY regression of AF-1) into its verifier integration suite, plus the PR12-SEC-05 (b) variants; the golden vectors into a `packages/audit` unit test | **TASK-116's PR**, in the same commit as the port | TASK-116 merge (batch 3.6), and in any case before G3 |
| `prisma/tests/spikes/spk08/anchor-prototype.ts` | TASK-116: `headsDigest`, `anchorHash`, `derToP1363`, `sinkLine` (JCS) and the verifier steps, as product code in `packages/audit` with unit tests | TASK-116's PR | TASK-116 merge |

Requested of the orchestrator: a DoD line on the TASK-021 sheet ("port and delete the SPK-08 audit-owner spike files,
§8.1") and on the TASK-116 sheet ("port and delete the SPK-08 anchor spike files, §8.1"), and a DECISIONS entry.

## 9. ADR / spec notes for principal-architect

No ADR-0007 change is needed for GO: amendments 7 and 8 hold on PostgreSQL 18 as written. Proposed data-model
amendments (text only), each with its due point:

- **§7.3 / §4.4 evaluation table, row "`prisma migrate deploy`"** (before TASK-021 starts): add "the audit **partitions**
  must also be covered by `tables.external` (Prisma's P3005 emptiness check on the first deploy counts them);
  `prisma.config.ts` lists `public.audit_entries_YYYY_MM` for a generated window" (F-01).
- **§7.3 / §4.4 evaluation table, row "Shadow database"** (before TASK-021 starts): "Prisma resets only `public`; the
  rendering drops and recreates every other schema it creates (`platform`) and also strips `GRANT`/`REVOKE`/`ALTER
  DEFAULT PRIVILEGES`" (F-02, F-03). Add: "The `DROP SCHEMA … CASCADE` relies on the migrator owning the shadow database
  and its `platform`; it fails closed (`42501`) if `SHADOW_DATABASE_URL` points at a real database, where
  `platform_schema_owner` owns `platform`, and it also clears objects that migrations create in `platform`. The rendered
  init refuses to run unless the current database is owned by the current user (PR12-SEC-07)." The statement "the
  shadow database receives the bootstrap-lane objects" is verified (asserted), including the three extensions.
- **§7.3 row "Partial indexes"** (before the first module migration with a partial index): the F-11 result and rule.
- **§5.2 "Tests (SEC-TC-43)"** (before TASK-021 starts): "fail too, with the guard's message wherever privilege did not
  already stop them" — on PG 18 privilege stops every listed statement for the migrator; add the planted-name creations
  and the schema-owner/superuser `sql_drop` cases as the guard's own cases (F-05, §1). §4.4 "Consequences" lists `GRANT`
  under "must be owner"; the observed message is "permission denied for table audit_entries" (both `42501`).
- **§5.2 / §5.3 / readiness rule** (before TASK-021 starts): PR12-SEC-02 (§8 item 6) and PR12-SEC-03.
- **§5.5/§5.6 anchor format (from §5.4 of this record).** A-2, A-3 and A-4 are hash or sink inputs, so changing them
  later breaks every stored anchor: **ratify before TASK-116 writes the first anchor** (and before any TASK-033 test
  fixes a byte layout). A-1, A-5, A-6 and A-7 are due **before TASK-116 starts**, with the security conditions of
  PR12-SEC-05 (c) and (d). In detail: A-1 `failure_kind` precedence when several steps fail (SIGNATURE > HEAD_MISMATCH >
  ANCHOR_MISSING > chain kinds; every event still emitted; `failure_kinds` or details; a distinct detail code for a
  table/sink content mismatch); A-2 the heads-digest field order in ADR-0007 am. 6 should point to data-model §5.5
  (`stream_id ‖ be64(entry_count) ‖ head_hash`, raw-UUID sort, empty set = SHA-256 of the empty string); A-3 sink line
  serialisation = JCS (RFC 8785), compared as a string; A-4 `created_at` rendered by PostgreSQL; A-5 "every verifier
  without new code" holds for OpenSSL/Node (DER) but WebCrypto needs a DER → P1363 conversion; A-6/A-7 time-based retry
  window (clamped to [now − 15 min, now + 2 min]) and step (iii) on the latest anchor that passed (i) and (ii).
- **AF-9/AF-12 qualifier** (before TASK-116 starts): the latest-anchor check is sound only with the nightly full walk;
  behind-head rewrites are caught within 24 h (§5.3, PR12-SEC-05).
- **RDS (§6)** (before TASK-021 writes the bootstrap DDL; M5 checks before G4-production): the `session_replication_role
  = replica` / `event_triggers = off` bypass is closed for the migrator by privilege (F-09) but open to an
  `rds_superuser` member. `ENABLE ALWAYS` for the event triggers and the audit triggers is an architect/security
  decision with its limits stated in §6.1. Add the drop/re-create of event triggers around a major-version upgrade to
  the M5 runbook. §6.2's residual-risk statement is the PR12-SEC-04 text. Requested of the orchestrator: extend STATUS
  COND-G4-PROD with the event-trigger upgrade drop/re-create (§6.1 f, h), the `session_replication_role` /
  `event_triggers` / `pgaudit.log` SET checks (§6.1 d, g), the `rds.allowed_extensions` check (§6.4) and the §6.2 a–d
  and §6.3 checks.
- **Data-model §7.3 "verify in P5 spike" notes now closed** (for the architect to strike):
  - "Verify … that dynamically created partitions (`audit_entries_YYYY_MM`) are ignored by the differ": **yes** for
    `migrate diff` / `migrate dev` (exit 4), **but** they count for the first-deploy P3005 check (F-01).
  - "Verify … that the hook exists at 7.10 and that partitions created by `ensure_audit_partitions` are ignored by the
    differ": the hook `migrations.initShadowDb` exists and runs (negative control, exit 4); partitions as above.
  - "Exercising it with the rendered SQL remains SPK-03 (TASK-012) scope": done (exit 4, F-02, F-03).
  - Row "Partial indexes": "verify … that `migrate dev` does not emit `DROP INDEX` for raw-SQL partial indexes": it
    does not with the preview off and **does** with it on (F-11).
  - `previewFeatures = ["partialIndexes"]` "verify GA/preview status at 7.10": still **preview** in 7.10.1.
