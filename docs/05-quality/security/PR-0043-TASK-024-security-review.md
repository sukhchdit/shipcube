# PR-0043 / TASK-024: generated cross-tenant isolation suite, DR-A14 policy sets, standard-columns guard and migration-linter rules (round 1)

| Field | Value |
|---|---|
| PR | #43 `feat(db): generated cross-tenant isolation suite and RLS tooling (TASK-024)`, https://github.com/sukhchdit/shipcube/pull/43, branch `feat/TASK-024-generated-cross-tenant-isolation-test`. Eight commits on merge base `201d8d9` (`daafd11`, `cbea77c`, `992d807`, `b20e136`, `6daa9ad`, `249ce4c`, code head `4513512`, evidence `8ac271d`). `main` has moved to `24fa3fc`: docs only since the merge base (33 paths under `docs/` and `.claude/agent-memory/`), so no owned path overlaps |
| Head | 8ac271d23aaa44388008ff9306a389b447eb0781 |
| Lane A evidence | Run [43550500753](https://github.com/sukhchdit/shipcube/actions/runs/43550500753) on `8ac271d`. `fast-lane` **success** with all 33 steps executed (lint, format, type-check, unit, build and the base-ref gates included). In `scans`, Gitleaks, Semgrep and oasdiff are green; only "Security-owned paths need a review record" failed, and with it `ci-gate`. This file is that record |
| Lane B evidence | `docs/05-quality/tests/runs/20261114T0257Z_4513512`, profile `pr`, verdict PASS: api 123, catalog-c1-c14 96, integration 285 (1 skip), unit 4445 (2 skip); `build_clean` true. `git_sha` `4513512`; `lockfile_sha256` and `manifest_sha256` equal the head's blobs (recomputed). `4513512..8ac271d` adds only the 7 run files. The generated suite `rls-cross-tenant` (92 tests) is `planned`, so it is **not** in this evidence (one green run reported in the PR body only; see PR43-SEC-08) |
| Owned paths changed | 103 (real checker, §9): `tools/db/**` (15 sources and tests plus 76 lint fixtures), `prisma/**` (10: 5 SQL templates, 4 catalog/migration tests, the deleted `policies.snapshot.json`), `eslint.config.mjs`, `tests/generated/tsconfig.json`. **Not owned** (the record stays valid if they change; see PR43-SEC-04): `tests/generated/rls/**` (6 files), the 7 evidence files |
| Reviewer / date | security-analyst, 2026-11-14, round 1. Read-only on code. Git ran in the main checkout against commit SHAs; the PR worktree was only read (Read tool) and receives this file. Probes ran on `git archive` extracts in session scratch: ESLint `calculateConfigForFile` head vs base, about 230 synthetic migrations through the head and base linters, a count-only host-fragment scan, and a record simulation in a `git clone --shared`. No Docker, no database, no install, build or test run |

## 1. Summary

TASK-024 delivers most of what the routed items asked for, and the core isolation mechanics hold:
- **Tenant context and role.** Every probe runs as `platform_app` (AT-04 asserts `session_user` = `current_user` = `platform_app`, no superuser, no BYPASSRLS, no owned table) and sets the context with the imported production `CONTEXT_STATEMENT_SQL`, never a second setter.
- **Fail-closed enumeration.** The committed layer is manifest-driven and empty today; an unlisted public table, a missing listed table, a missing ENABLE/FORCE, a missing isolation key and a missing de-claim trigger are each named, with a planted control. There is no table skip list.
- **Non-vacuous table matrix.** The probe layer plants one table per RLS class and the three DR-A14 sets from the real renderer and function templates; a leaking SELECT policy makes six probes of its table fail. SEC-TC-06 (forced OPERATOR scope; operator policies SELECT-only, with a -1 sentinel against a vacuous pass), the C12 guest probes (i)-(iv) with a positive control, the PR7-SEC-04 de-claim refusal and the legitimate claim all run.
- **Standard-columns guard (D-ARCH-091).** Assertion-only, SECURITY INVOKER, pinned `search_path = pg_catalog, pg_temp` (the temp schema is never searched for operators or functions), actor only through `platform.app_actor_id()`, value-free message. It fires on every row write path (raw SQL, `ON CONFLICT DO UPDATE`, COPY, MERGE). The migrator exemption is unreachable from `platform_app` (role memberships pinned by C13; SECURITY DEFINER functions on the `DEFINER_ALLOWED` list, none owned by the migrator). `session_replication_role` is SUSET. Cost 10.0 / 18.4 µs per row, under the 25 µs reopen line.
- **C3 derived (D-ARCH-072).** Every policy in every schema is dropped in a rolled-back savepoint and rebuilt from `renderRls` over the manifests; equality covers roles and PERMISSIVE. The oracle is the renderer, the templates and the manifests, all under `/tools/db/` and `/prisma/` in CODEOWNERS, so deleting the snapshot lets no policy change in without a security record.
- **`runtimeReadOnly`.** C5 compares every live ACL entry (all privilege types, via `aclexplode`) with the manifest in both directions, and `validateGrants` refuses any non-SELECT line for the four flagged tables, for every grantee, on the real manifest.
- **ESLint.** Exactly two effective changes (§5.6): `import-x/no-relative-packages` for `tests/generated/rls/**/*.ts`, anchored and widened by exactly `tools/db` and `prisma/tests/harness`, and the `keys` exemption for the one test file `tools/db/render-rls-dr-a14.test.ts`.
- **Linter.** Rules 11c (22 forms), 17, 18/19, token-level E-strings in both lanes, quoted and `set_config` lock_timeout keys, `set_config` of role/session_authorization, MAINTAIN, schema grants, operators and rules, CREATE TABLE outside `public`, and EXECUTE in routine bodies all fire with base-clean controls.

The gaps:
- **PR43-SEC-01 (MEDIUM):** the API-level proof is registration-only. `API_CASES` is a set of operationIds that silences `routeCaseFindings`, with no request run per registered route, and `guest` routes are excluded even though `getQuote` serves claimed (tenant) quotes by id.
- **PR43-SEC-03 (MEDIUM, regression of this PR):** the new block tracking in `splitStatements` counts any unquoted `begin` inside a routine head; `begin` is not reserved, so a routine named `begin` or a parameter `begin` merges the rest of the file into one statement and silences rules 2, 7, 8, 9, 11, 11c and 17 (probe: 1 statement instead of 7).
- LOW: 02 write probes cannot see a write-only policy leak; 04 the O3 oracle is outside CODEOWNERS; 05 the guard can be switched off by `ENABLE REPLICA TRIGGER` with no control firing; 06 escape processing and dynamic SQL without escape strings or EXECUTE.
- INFO 07-10.

**Findings: 2 MEDIUM, 4 LOW, 4 INFO. Nothing Critical or High. Verdict: PASS_WITH_CONDITIONS** (§11): C1 = PR43-SEC-03 fixed in this PR with a delta round; C2 = PR43-SEC-01 before the first tenant- or guest-resource route merges.

## 2. Method

| Area | How |
|---|---|
| Diff | `git diff 201d8d9...8ac271d` (116 paths: 33 sources/tests, 76 lint fixtures, 7 evidence). Read in full: `tests/generated/rls/*.ts`, `std-columns-guard.sql`, the policy templates, the `render-rls.ts`, `table-classes.ts`, `grants-manifest.ts`, `sql-text.ts`, `tenant-key-forms.ts` diffs, `c15-std-columns-guard.int.test.ts`, the `c01-c12` and `scans.ts` diffs, `up-down-up.ts`, the eslint diff with the `TENANT_CONTEXT_EXEMPTIONS` block, CODEOWNERS. `lint-migrations.ts` by rule section |
| P1 linter matrix | Head and base extracts of `tools/db`, `prisma/sql`, `prisma/migrations`, `prisma/bootstrap`; about 230 synthetic migration directories through `lintMigrations` / `lintBootstrap` and direct `splitStatements` / `containsEscapeString` calls; every family has a firing control; smoke controls 7/7. PostgreSQL acceptance of the attack inputs is reasoned from the grammar, not executed |
| P2 effective ESLint config | `calculateConfigForFile` over 25 paths on `git archive` extracts of head and base (config, `tools/eslint-rules`, `tools/lint`, workspace manifests), `node_modules` junctioned to the main checkout and removed afterwards (740 entries before and after). Mutation control (a widened glob and a widened exemption) shows 27 leaf differences |
| P3 PostgreSQL semantics | RLS command table of the PostgreSQL 18 `CREATE POLICY` page (footnote a: SELECT policies apply to UPDATE/DELETE only when the statement reads columns); `standard_conforming_strings` is still settable in 18; `has_table_privilege` ignores column-level grants |
| P4 hygiene | Count-only host-fragment scan (12 needle labels computed at run time: OS user name, its lower case, 8.3 stem, home in three spellings, temp dir in two, host name, git e-mail, `Users` path in two) over the 7 evidence blobs, with a synthetic control in which every label fires. Lockfile and manifest SHA-256 recomputed |
| P5 record simulation | Shared clone (§9); scenario commits built by plumbing on `8ac271d`; `main`'s real `tools/ci/check-security-owned-paths.mjs` against `24fa3fc` (§9) |
| Cross-check | No code-review record for PR #43 on `main` when this round was written. In-flight PRs touching `eslint.config.mjs` checked by hunk (§7) |

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR43-SEC-01 | API-level isolation proof is registration-only, and guest-tenancy routes are not enumerated | MEDIUM | CWE-693 (via CWE-639) | A01 | `tests/generated/rls/fixtures.ts:13`; `generator.ts:245-258`; `cross-tenant.int.test.ts:332`; `generator.test.ts:114-117` | senior-developer (TASK-024 follow-up or TASK-027); C2 |
| PR43-SEC-02 | Write probes cannot detect a write-only policy leak; no write mutation control, no re-parent or guest-context write probe | LOW | CWE-693 (via CWE-863) | A01 | `tests/generated/rls/database.ts:239-242`; `cross-tenant.int.test.ts:229-243` | senior-developer, before the `rls-cross-tenant` activation |
| PR43-SEC-03 | `splitStatements` treats any unquoted `begin` in a routine head as a block start: the rest of the file becomes one statement and seven linter rules go silent (regression) | MEDIUM | CWE-693 (via CWE-436) | A04 | `tools/db/sql-text.ts:169-170, 205-207` | senior-developer / database-engineer, **this PR** (C1) |
| PR43-SEC-04 | The O3 oracle (`tests/generated/rls/**`, `tests/generated/api-mounts.ts`) is outside CODEOWNERS | LOW | CWE-693 | A08 | `.github/CODEOWNERS` | this PR (preferred) or devops 015-C |
| PR43-SEC-05 | The standard-columns guard can be switched off by `ENABLE REPLICA` / `ENABLE ALWAYS TRIGGER` with no control firing; C15 (a) committed checks table names only | LOW | CWE-693 (via CWE-345) | A08 | `tools/db/lint-migrations.ts:909`; `c15-std-columns-guard.int.test.ts:154-155`; `database.ts:73-74` | senior-developer, before TASK-037 merges |
| PR43-SEC-06 | Escape processing and dynamic SQL outside the PR11-SEC-16 / PR11-SEC-14 b controls: `standard_conforming_strings`, `query_to_xml` family, nesting cap, name-keyed allow-lists | LOW | CWE-184 | A03 | `tools/db/lint-migrations.ts:577-589`; `sql-text.ts:229, 249-251`; `c01-c12.int.test.ts:1170-1177` | senior-developer / database-engineer, before TASK-037 merges |
| PR43-SEC-07 | SEC-TC-74 matrix and C15 completeness; parameter-ACL assertion | INFO | CWE-1068 | A04 | `c15-std-columns-guard.int.test.ts:226-344`; `c01-c12.int.test.ts:724` | TASK-024 follow-up / TASK-037 |
| PR43-SEC-08 | Probe fidelity notes (column-level grants, context state, operator positive control, evidence) | INFO | CWE-1068 | A04 | `database.ts:75, 254-261`; activation | TASK-051, qa-lead (activation) |
| PR43-SEC-09 | DR-A14 `INVITED` visibility rests on a tenant-writable row; ledgers not `runtimeReadOnly` | INFO | CWE-359 | A01 | `prisma/sql/policy-templates/dr-a14-users.sql`; `tools/db/table-classes/platform.json` | principal-architect + product-manager (TASK-037/049, US-083); TASK-037 |
| PR43-SEC-10 | Rule 9 / 14 residuals (SET SCHEMA, SELECT INTO, views outside `public`; object kinds refused only by privileges) | INFO | CWE-693 | A05 | `tools/db/lint-migrations.ts` rule 9 / 14 | TASK-037 (with PR11-SEC-11 e) |

## 4. Finding details

### PR43-SEC-01 (MEDIUM): the API-level proof is registration-only, and guest routes are not enumerated

**What.** AT-US-077-02 reads "user A calls each tenant-resource route with B's ID; every response is 404 NOT_FOUND with no B data". The suite implements:
- `API_CASES: ReadonlySet<string>` (`fixtures.ts:13`), a set of operationIds;
- `routeCaseFindings(descriptors, API_CASES)` (`cross-tenant.int.test.ts:332`), which reports a `tenant`/`user` route with a path parameter only while its operationId is **absent** from that set.

Nothing iterates `API_CASES`: no request is issued for a registered route (`git grep API_CASES` at `8ac271d`: two uses, both in `routeCaseFindings` calls). The one HTTP test is a fixture route defined in the test file. So the first module task that follows the `fixtures.ts` header ("TASK-027 and the module tasks add theirs with the route") by adding a string silences the check with nothing executed. That contradicts the PR's "there is no skip list"; at API level the set **is** the skip list.

Second, `tenantResourceRoutes` keeps `tenancy === 'tenant' || 'user'` only (`generator.ts:246`), and the unit test pins `getQuote` (`tenancy: 'guest'`) as excluded (`generator.test.ts:114-117`). In the contract, `getQuote` is `x-tenancy: guest` with `x-permission-authenticated: quote:read`: a dual-mode route that serves **claimed quotes of an organisation** by id to a session (openapi.yaml `getQuote`, 3 guest routes in total). That is exactly the IDOR surface of T-44 / SEC-TC-07 and is outside the API enumeration.

**Exploitability / impact.** RLS stays the primary control and the table matrix covers the database. But the API case is the only end-to-end proof for leaks RLS cannot see: a handler on the SYSTEM handle, a Valkey cache key without the organisation, an S3 object addressed by id, a worker job context. An undetected cross-tenant read is High impact; the documented workflow makes a registration-only entry the likely outcome (Medium). Matrix M impact (detection gap behind RLS) x M likelihood: **MEDIUM**.

**Remediation (code level).**
1. Turn the registry into executable cases:
   ```ts
   // tests/generated/rls/fixtures.ts
   export interface ApiCase {
     readonly table: string;                                  // the RLS table the route reads
     readonly request: (id: string) => { method: string; path: string; body?: unknown };
     readonly principal: 'tenant' | 'guest';                  // guest: token of hash H2 vs the row of hash H
   }
   export const API_CASES: ReadonlyMap<string, ApiCase> = new Map();
   ```
   In `cross-tenant.int.test.ts`, `it.each([...API_CASES])` mounts the **real** module registry through `createApp` with the test authenticate slot and asserts, per case: B's id gives 404 `NOT_FOUND` with no B id, organisation or data in the body; A's id (or H for guest) gives the positive status.
2. `routeCaseFindings` also reports a registered operationId with no route (stale entry) and a route whose case has no executable builder.
3. Enumerate `guest` routes too, and dual-mode routes (`x-permission-authenticated`) in both branches; update the unit test that pins `getQuote` as excluded.

**Verification.** A planted descriptor plus a registered case whose handler reads through the SYSTEM handle returns B's row: the generated case fails. Registering an operationId with no builder fails. Removing `getQuote`'s case fails once the quote route exists.

### PR43-SEC-02 (LOW): write probes cannot detect a write-only policy leak

**What.** `update-foreign-id` runs `UPDATE t SET k = k WHERE id = $1` and `delete-foreign-id` runs `DELETE FROM t WHERE id = $1` (`database.ts:239-242`). Per the PostgreSQL 18 `CREATE POLICY` command table, footnote (a), SELECT policies filter UPDATE/DELETE whenever the statement reads columns (a `WHERE`, `RETURNING` or `SET col = col`). Both probes read columns, so B's row is filtered by the SELECT policy before any UPDATE/DELETE policy matters. A permissive `FOR UPDATE USING (true)` or `FOR DELETE USING (true)` leaves both probes at 0 rows, while a blind `UPDATE t SET note = 'x'` or `DELETE FROM t` (no column read) would change every tenant's rows. The only mutation control plants a SELECT leak and expects only read probes to fail (`cross-tenant.int.test.ts:229-243`), so nothing shows the write probes can fail at all. Also missing: re-parenting A's own row to B's key (UPDATE WITH CHECK), and guest-context writes (a guest of hash H2 updating H's row; a guest inserting with an organisation).

**Exploitability / impact.** Today every write-capable policy is `FOR ALL` with the same USING as reads, the renderer allow-list demands a keyed atom in each predicate, C3 pins live = rendered and rule 9 refuses hand-written policies. A write-only leak therefore needs an owned renderer or template change that passes review, and the generator, the one semantic oracle, would not notice. High impact x Low likelihood would read MEDIUM; the renderer allow-list leaves only exotic shapes, so **LOW**.

**Remediation.** Add probe kinds whose statements read no column:
- `update-blind`: `UPDATE t SET <non-key synthetic column> = $1` (STD tables: `SET updated_by = $A, version = 2`, constants only), expected row count = A's visible rows under the UPDATE policy (1);
- `delete-blind`: `DELETE FROM t`, expected 1 with DELETE, else 42501;
- `reparent-own-row`: `UPDATE t SET <key> = $B WHERE id = $rowA`, expected 42501;
- GUEST_CAPABLE: `guest-update-other-hash` (0 rows) and `guest-insert-with-org` (42501).

Add a write mutation control that plants `FOR UPDATE USING (true)` and `FOR DELETE USING (true)` and expects the blind probes to fail.

**Verification.** The new mutation control fails only the blind probes; on the unmodified probe layer all new probes pass.

### PR43-SEC-03 (MEDIUM, regression): a `begin` identifier in a routine head swallows the rest of the file

**What.** `splitStatements` (`sql-text.ts:205-207`) raises the block depth for every unquoted `begin` or `case` word once the statement starts with `create [or replace] function|procedure`, and a `;` splits only at depth 0. PostgreSQL does not reserve `BEGIN`: it is valid as a routine name, a parameter name and a column reference. Probe P1:

| Statement before a six-statement tail (`BEGIN`, `COMMIT`, `GRANT TRUNCATE … TO platform_app`, `CREATE POLICY … USING (true)`, `DROP TABLE`, `SET lock_timeout`) | base statements | head statements | head findings |
|---|---|---|---|
| none (control) | 6 | 6 | 11c x2, 2, 8, 11, 9, 11 |
| `CREATE FUNCTION public.begin() … AS 'SELECT 1';` | 7 | **1** | only one rule-9 message |
| `CREATE FUNCTION public.f(begin integer) … RETURN begin;` | 7 | **1** | same |
| `CREATE OR REPLACE FUNCTION public.begin()` / `CREATE PROCEDURE public.p(begin integer)` | 7 | **1** | same |
| balanced `BEGIN ATOMIC … CASE … END; END;` (control) | 9 | 7 | all fire |

- An eight-statement demo after a `begin`-named function leaves rules 11c, 2, 8 (twice, including `GRANT platform_migrator TO platform_app`), 7 (`NO FORCE ROW LEVEL SECURITY`), 11 (twice) and 9 (`CREATE TABLE platform.zz`) silent.
- In `down.sql`, `DROP TABLE public.x;` after such a function lints clean (rule 17 lost).
- A later lone `END;` resynchronises, so only the statements in between escape.
- The same splitter feeds `runPrefixReversibility` (fewer prefixes checked) and the C3 derivation (renderer output only, not affected).

psql's own heuristic (`psqlscan.l`) counts `begin` only at parenthesis depth 0 and `case` only inside a block; this port has neither guard.

**Exploitability / impact.** Migrations are owned and reviewed, so this needs an unusual identifier, deliberate or accidental. The outcome controls still catch live grants (C5), policies (C3), RLS state (C1/C2) and memberships (C13) at catalog time. Nothing catches the lost rule 2 (a destructive statement in a migration declared `data-changing: no` skips the backup-and-restore guardrail), rules 11 / 11c (lock_timeout leak, transaction control), rule 17 and the schema scope. High impact on the guardrail x Low likelihood: **MEDIUM**. It is introduced by this PR in the function that carries SEC-TC-73.

**Remediation (C1).**
1. Open a block only for the two-word `begin atomic` at parenthesis depth 0 (look ahead past whitespace and comments). Count `case` only when depth >= 1, and `end` only when depth > 0.
2. Fail closed: when the file ends with depth > 0, or a routine statement still contains a top-level `;` followed by more text, report a finding (`unbalanced BEGIN ATOMIC block`) instead of returning one statement.
3. Fixtures under `tools/db/fixtures/lint/migrations/transaction-control/`: a function named `begin`, a parameter `begin`, `RETURN begin`, `RETURN CASE … END` at depth 0, each followed by a statement that must still be flagged; and a `down.sql` twin for rule 17.

**Verification.** The five rows of the table above give 7 statements on the fixed head with all tail findings; the balanced control stays at 7.

### PR43-SEC-04 (LOW): the O3 oracle is outside CODEOWNERS

`tests/generated/rls/**` (generator, probes, expected observations, `ROW_OVERRIDES`, `API_CASES`) and `tests/generated/api-mounts.ts` (the route enumeration source) match no CODEOWNERS line. A later PR can drop a probe kind, relax `expectedObservation`, add a registration-only `API_CASES` entry or override a seeded column without a security record. The record simulation confirms that a `fixtures.ts` edit after this record keeps it valid (S6, §9). This is the same class as PR24-SEC-04 (O4 oracles) and PR38-SEC-06.

**Remediation.** Add `/tests/generated/rls/` and `/tests/generated/api-mounts.ts` to `.github/CODEOWNERS`, and to the required-owned list if `check-security-owned-paths.test.ts` keeps one. **Verification:** re-run S6: `missing`.

### PR43-SEC-05 (LOW): the guard can be switched off by `ENABLE REPLICA TRIGGER` with no control firing

**What.**
- **(a) Lint.** `ALTER TABLE … ENABLE REPLICA TRIGGER trg_x__std_columns` and `ENABLE ALWAYS TRIGGER` lint clean on head and base: rule 7 matches `disable trigger` only (`lint-migrations.ts:909`). REPLICA mode stops the trigger in every normal (origin) session.
- **(b) Catalog.** C15 (a) committed asserts only the **table names** returned by `GUARD_TRIGGERS_SQL` (`c15-std-columns-guard.int.test.ts:154-155`). The shape `{enabled 'O', row, BEFORE, INSERT, UPDATE}` is asserted on the probe table only, so a disabled or replica-mode guard on a committed table passes.
- **(c) Order.** BEFORE triggers fire in name order. An enabled BEFORE ROW trigger on an in-scope table whose name sorts after `trg_<t>__std_columns` can rewrite or return a modified row after the assertion. C15 (c) is a lexical scan (`NEW.<col> :=`); a `RETURN jsonb_populate_record(NEW, …)` or `SELECT … INTO NEW.created_by` evades it.
- **(d) Generator.** The trigger listing (`database.ts:73-74`) ignores `tgenabled`. For the guest guard the de-claim probe still fails functionally, so (d) only affects the enumeration message.

**Exploitability / impact.** All need an owned migration. The effect is the PR26-SEC-03 class (forged attribution and version counter by raw SQL) on the affected table: **LOW**. Latent until TASK-037 adds the first in-scope table.

**Remediation.**
1. Rule 7: refuse `enable replica|always trigger|rule` outright; no migration needs them.
2. C15 (a) committed: assert the full per-row shape exactly as the probe test does (`enabled: 'O'`, `row_level`, `before`, `on_insert`, `on_update`, `!on_delete`, `!on_truncate`).
3. C15: on each in-scope table, no other enabled BEFORE INSERT/UPDATE ROW trigger may sort after the guard's name (byte order). Alternatively, rename the guard to sort last; that needs a data-model §7.6 amendment.
4. The generator's listing returns `tgenabled` and requires `O` or `A` for the guest guard.

**Verification.** Planted `ENABLE REPLICA TRIGGER`: lint finding and a C15 (a) failure. A planted `trg_<t>__zz` BEFORE trigger: C15 failure.

### PR43-SEC-06 (LOW): escape processing and dynamic SQL outside the escape-string and EXECUTE controls

**What (probe P1, base and head alike unless noted).**
- **(a) `standard_conforming_strings`.** No rule names `standard_conforming_strings` or `backslash_quote`. PostgreSQL 18 still lets any role set it.
  - With `SET standard_conforming_strings = off;` (also `TO off`, `set_config`, a routine `SET` clause), `DO $$ BEGIN EXECUTE 'SET LOCAL \x61pp.org_id = ''x'''; END $$` with **no** E prefix lints clean. The E-prefixed and plain-key twins are flagged.
  - In the bootstrap lane, `SET standard_conforming_strings = off; SELECT 'audit\x5fentries';` passes rule 12. The E-string twin needs the audit marker.
  - This reopens the PR11-SEC-16 class (a key or audit name hidden in escaped text) without an E-string.
- **(b) Dynamic SQL without the EXECUTE keyword.** `query_to_xml`, `query_to_xmlschema`, `query_to_xml_and_xmlschema` and `ts_stat('select …')` run a query string. They lint clean in plpgsql and in SQL-language bodies, and a keyword-split context setter passed through `query_to_xml` is clean. The catalog query `DYNAMIC_SQL_SQL` looks for `execute` in plpgsql only (`c01-c12.int.test.ts:1170-1177`).
- **(c) Nesting cap.** `containsEscapeString` stops at `MAX_NESTED_SQL_DEPTH = 4` and returns clean beyond it (`sql-text.ts:229, 249-251`). Chained DO string bodies reach that depth after 3 levels.
- **(d) Name-keyed allow-lists.** `DYNAMIC_SQL_ALLOW_LIST` (empty for migrations) is keyed by qualified name (`lint-migrations.ts:577-589`) and `DYNAMIC_SQL_REVIEWED` by signature, neither by body. Today's only entry, `ensure_audit_partitions`, is owned by `platform_audit_owner` and protected by rule 12 and bootstrap immutability.

**Exploitability / impact.** Owned migrations only. The outcome controls (withTenantTx leak check at checkout, C11 converse, C13) still bound the effect: **LOW**.

**Remediation.**
1. Both lanes: refuse `SET`, `set_config` and routine `SET` clauses of `standard_conforming_strings` and `backslash_quote`. Add a catalog assertion that no `pg_proc.proconfig` or `pg_db_role_setting` entry names them.
2. Treat `query_to_xml`, `query_to_xmlschema`, `query_to_xml_and_xmlschema`, `ts_stat` and `ts_rewrite` like `EXECUTE` in rule 16 and in `DYNAMIC_SQL_SQL`, for every language.
3. Beyond the depth cap, return **true** (fail closed).
4. Key both allow-lists by name plus the SHA-256 of the normalised body.

**Verification.** The probe P1 rows of (a)-(c) are flagged on the fixed head.

### PR43-SEC-07 (INFO): SEC-TC-74 and C15 completeness; parameter ACL

- **SEC-TC-74 cases not in the matrix:**
  - UPDATE `version` reset to 1 from a row at version >= 2 (logically covered by `<> OLD.version + 1`; not exercised);
  - the back-dated `updated_at` positive control;
  - both RLS-order cases (wrong stamps plus a foreign organisation: the guard fires first; right stamps plus a foreign organisation: the policy rejects), which belong on an RLS `stdColumns` table such as `rls_probe_parcels`;
  - MERGE forms (`WHEN MATCHED THEN UPDATE` with a forged `created_by`, `WHEN NOT MATCHED THEN INSERT` with `version` 7).
- **Parameter ACL.** C13 checks `pg_parameter_acl` for `app.%` only (`c01-c12.int.test.ts:724`). Add: no `pg_parameter_acl` row grants SET or ALTER SYSTEM to any `platform_%` role, and `has_parameter_privilege('platform_app', 'session_replication_role', 'SET')` is false. That is the one way a runtime role could stop an origin-mode guard. `GRANT SET ON PARAMETER` lints clean (P1); the migrator cannot grant a SUSET parameter, the bootstrap lane could.
- **Exemption invariant.** The guard exempts `current_user = 'platform_migrator'`. Keep the invariant "no `DEFINER_ALLOWED` entry is owned by `platform_migrator`" explicit in C15 or C11, because such a function would carry the exemption to `platform_app`.
- **Render check nit.** `renderStdColumnsGuardFunction` refuses `NEW.x :=` but not the plpgsql `NEW.x = …` assignment form. The template is owned; C15 (c) has the same lexical limit.

### PR43-SEC-08 (INFO): probe fidelity

- **(a) Column-level grants.** `appPrivileges` comes from `has_table_privilege` (`database.ts:75`), which ignores column-level grants. For `quotes` (data-model §4.4: `UPDATE (org_id, guest_token_hash, …)` only), `update-foreign-id` will expect 42501 while the statement runs and returns 0 rows: a false failure at TASK-051. Use `has_any_column_privilege` for UPDATE, or test the probe's SET column with `has_column_privilege`, and never resolve the mismatch by relaxing the expectation.
- **(b) Unset context.** `no-context` and `guest-no-settings` run on a connection that earlier probes used, so the `app.*` placeholders read `''`, not NULL. The never-set (NULL) state is exercised only by the first statement of a fresh session. Add one probe on a fresh `platform_app` connection.
- **(c) Operator positive control.** SEC-TC-06 has no positive control: a genuine operator (ACTIVE membership in an `OPERATOR` organisation, scope OPERATOR) should see B's row through `p_<t>__operator`. That proves the forced-scope probe reaches the operator branch. The dangerous mutations (operator policy without `app_is_operator()`, a membership check dropped) are already caught.
- **(d) Guest context.** No probe asserts that a guest context (hash H, no organisation) sees no tenant row of A or B (`countAll` = 1).
- **(e) Evidence.** The 92 generated tests are outside lane-B evidence (`planned`) and ran once; flake < 1 % over 20 runs is not measured. The activation PR must carry their JUnit (§8, D-SEC-PR43-04).

### PR43-SEC-09 (INFO): DR-A14 `INVITED` visibility; ledgers

- **(a) `INVITED` visibility.** `p_users__org_member_read` makes a user's row visible to every session of an organisation in which the user holds an `INVITED`, `ACTIVE` or `SUSPENDED` membership. `memberships` rows are writable by any session of that organisation under `p_memberships__tenant` (`FOR ALL`, WITH CHECK `org_id = app_org_id()`).
  - At the RLS level, an organisation can therefore "adopt" any user id with an `INVITED` row and read that user's `users` row before the invitee consents. Today REQ-ORG-010/011 invite by e-mail and activate on acceptance.
  - My own PR11-SEC-10 item 4 proposed the `INVITED` list entry, against enum growth. The disclosure aspect was not considered then.
  - Ruling needed before TASK-037/049 (US-083 is M1 Should): either an `INVITED` membership carries no `user_id` until acceptance (the invitation row holds the e-mail), or the users list drops `INVITED`, or the risk is recorded.
- **(b) Ledgers.** `_prisma_migrations` and `bootstrap_migrations` have no runtime grant but are not flagged `runtimeReadOnly`, so a future manifest write line for them would parse. A runtime-writable migration ledger could mark a migration as applied. Flag both (SELECT-only semantics, no change to today's empty grants).

### PR43-SEC-10 (INFO): rule 9 and 14 residuals

- **Schema scope.** CREATE TABLE outside `public` is now refused in every form (rule 9, PR11-SEC-11 e lint half). Still clean (P1):
  - `ALTER TABLE … SET SCHEMA platform`. An RLS table moved this way is caught at catalog time (C3's `DROP POLICY … ON public.<t>` errors, and the generator names the listed table as missing).
  - `SELECT … INTO platform.x` and `SELECT … INTO public.x`, which skips the manifest check that `CREATE TABLE` gets (C1/C2 and the generator catch the latter).
  - `CREATE [MATERIALIZED] VIEW platform.v`. FORCE RLS with no migrator policy makes such views return nothing.
  The catalog half of PR11-SEC-11 (e) ("`platform` holds no table, view or materialised view") remains open.
- **Object kinds refused only by migrator privileges** (P1, not executed): `ALTER OPERATOR FAMILY … ADD OPERATOR`; CREATE CAST, AGGREGATE, CONVERSION, TEXT SEARCH CONFIGURATION, EVENT TRIGGER, PUBLICATION and SUBSCRIPTION; `GRANT SET ON PARAMETER`; `SET SESSION AUTHORIZATION`.
- **Transaction control inside DO bodies or called procedures.** Rule 11c does not see it, but rule 11 still flags the file because a reset made there does not count against a top-level SET. Fail closed, no action.

## 5. Answers to the review focus

### 5.1 Isolation assurance

| Question | Answer |
|---|---|
| Zero cross-tenant read for every RLS class | **Yes on the probe layer**: select by id, by key, no / empty / malformed context, forced OPERATOR scope, all with the A positive control; DR-A14 visibility per status (12 cases) and `own_read` |
| Zero cross-tenant write | **Partly.** INSERT with B's key is refused by WITH CHECK (with A's stamps, so the guard is not what refuses). UPDATE/DELETE by B's id is 0 rows, but those probes are also filtered by the SELECT policy (PR43-SEC-02) |
| GUEST_CAPABLE | C12 (i)-(iv) plus the positive control; de-claim refused with `GUEST_DECLAIM_FORBIDDEN`; legitimate claim succeeds. Guest-context writes are not probed (PR43-SEC-02). SEC-TC-07 (concurrent claim) is correctly left to TASK-051 |
| Operator scope (SEC-TC-06) | A non-operator forcing `OPERATOR` sees nothing of B, and every operator policy is FOR SELECT, with a -1 sentinel. The forced context is meaningful: A is an ACTIVE member of a `BUSINESS_CUSTOMER` organisation, so `app_is_operator()` is false for the right reason. Positive control missing (PR43-SEC-08 c). The DB-level defence also relies on `trg_organisations__type_immutable` and `ux_organisations__single_operator` (data-model AP-ORG-02, line 1191): TASK-037 must ship both |
| Fail-closed against vacuity | No committed RLS table: the probe layer carries the proof, with a mutation control. An unlisted table is named (planted control). A listed but missing table fails both the matrix (`expect(plan).toBeDefined()`) and the enumeration. A new manifest entry yields its 11 cases with no edit. **API enumeration: not fail-closed** (PR43-SEC-01) |
| Context through production `CONTEXT_STATEMENT_SQL` as `platform_app` | Yes (`database.ts:13, 199-202`; AT-04 on both layers). The fixture route also goes through the composed `createApp` and the real runtime |

### 5.2 `std_columns_guard` (SEC-TC-74)

| Question | Answer |
|---|---|
| Forgery matrix complete | 9 of the 10 forged cases of SEC-TC-74 plus 6 positive controls. Missing: reset-to-1 from >= 2, back-dated `updated_at`, both RLS-order cases, MERGE (PR43-SEC-07) |
| Every write path including raw SQL | Yes by construction: a BEFORE INSERT OR UPDATE ROW trigger fires for raw INSERT/UPDATE, `ON CONFLICT DO UPDATE` (positive control), COPY FROM (non-RLS tables; RLS tables refuse COPY FROM), MERGE and auto-updatable views. Not covered by design: `updated_at` (application clock) and DELETE |
| Bypass by role | Only `current_user = 'platform_migrator'`. `platform_app` cannot reach it: memberships pinned by C13, SECURITY DEFINER functions allow-listed (`DEFINER_ALLOWED`, none owned by the migrator), `platform_definer` / `platform_erasure` write no in-scope table. A superuser can always disable a trigger (break-glass) |
| Bypass by `session_replication_role` | The trigger is origin-mode (`O`), so a replica session skips it. The parameter is SUSET; `platform_app` cannot set it unless granted `SET ON PARAMETER`, which no catalog test asserts against (PR43-SEC-07). Through migrations, `ENABLE REPLICA TRIGGER` turns it off for everyone, with no control firing (PR43-SEC-05) |

### 5.3 Migration linter (rules 11c / 17 / 18 / 19 and the rest)

| Item | Result (probe P1, head vs base) |
|---|---|
| SEC-TC-73 / rule 11c | All 22 forms flagged in `migration.sql` and `down.sql` (WORK, TRANSACTION ISOLATION LEVEL, AND [NO] CHAIN, SAVEPOINT, RELEASE [SAVEPOINT], ROLLBACK TO [SAVEPOINT], PREPARE / COMMIT / ROLLBACK PREPARED, leading comment, mixed case); `SET; BEGIN; RESET; ROLLBACK` clean on base, flagged twice on head. **Defeated by PR43-SEC-03** |
| E-string refusal | Token-level, in both lanes: `E'…'`, `e'…'`, `)E'…'`, continuation segments and nested dynamic SQL to depth 4 are flagged; `'abcde'`, `name'x'`, `date'…'`, `'a e'`, `'e'` stay clean. Residuals: depth > 4 and `standard_conforming_strings` (PR43-SEC-06) |
| Quoted `lock_timeout`, `set_config` keys | `SET "lock_timeout"` / `"LOCK_TIMEOUT"` and `set_config('lock_timeout', …)` with `false`, `'off'`, `0::boolean`, NULL, `concat(…)`, `pg_catalog.` prefix or an upper-case key: rule 11. `'lock_timeout'::text` and `' lock_timeout'` fail closed under rule 16. `RESET "lock_timeout"` counts as a reset |
| `set_config` of role | `'role'`, `'ROLE'`, `pg_catalog.set_config('session_authorization', …)`, DO body, nested literal, extra spaces, `'"role"'`: rule 15. `'role'::text` and `lower('ROLE')`: rule 16 |
| MAINTAIN, schema grants, operators, rules | `GRANT MAINTAIN` (8); `GRANT`/`REVOKE … ON SCHEMA` including `REVOKE CREATE ON SCHEMA public FROM PUBLIC` (14); `CREATE OPERATOR [CLASS | FAMILY]`, `CREATE [OR REPLACE] RULE` (14): all newly refused. Catalog twins (schema CREATE, `pg_rewrite`, operators outside extensions) have planted controls. Residual kinds: PR43-SEC-10 |
| Dynamic-SQL allow-list | Empty for migrations; EXECUTE in functions and procedures is refused in every form (`RETURN QUERY EXECUTE`, `FOR … IN EXECUTE`, `OPEN … FOR EXECUTE`, `EXECUTE format`, `EXECUTE/**/'…'`). It cannot admit anything today. Keyed by name, not body, and blind to `query_to_xml`-style executors (PR43-SEC-06) |
| Non-public schemas | `CREATE TABLE` outside `public` refused in every quoting, UNLOGGED, IF NOT EXISTS, PARTITION OF and `AS` form; SET SCHEMA, SELECT INTO and views are not (PR43-SEC-10) |
| `RULE_17_RELEASED` | Exactly `20261112010000_authz_catalogue_tables`, `20261112020000_platform_rls_helpers`, `20261112030000_reference_dataset_versions` (`lint-migrations.ts:1183-1187`). Matched by directory name, and only rule 17 is suppressed (11c still runs on their `down.sql`). Pinned exactly by `lint-migrations.test.ts:853-873`, which also proves each released file still trips rule 17. Immutable in practice: the released directories cannot change (`check-migration-immutability.mjs`, lane A), a same-named new directory cannot coexist, and extending the list needs an owned edit of the linter and its pin. Every DROP form without IF EXISTS gets rule 17 (only PR43-SEC-03 evades it) |
| Rules 18 / 19 | Covering-index and partial-index tolerance as specified; tenant index removal stays with rule 2 and the live C2 |

### 5.4 Catalog C3 derived from the manifests

- Deleting `policies.snapshot.json` is safe.
  - Every live policy, in every schema, is compared with `renderRls` output, including roles and PERMISSIVE.
  - The derivation drops **all** policies first, so a policy on an unlisted, GLOBAL or SYSTEM table breaks equality (D-TASK024-09).
  - A policy on a table outside `public` makes the derivation error, which is fail closed.
  - Probe controls: an added and an edited policy both break equality. For the DR-A14 sets, `drA14Findings` names planted recursion, another subquery table and an `IN` list off `m.status`.
- **Ownership.** The oracle inputs are `tools/db/render-rls.ts`, `prisma/sql/policy-templates/*` and `tools/db/table-classes/*.json`, all under CODEOWNERS (`/tools/db/`, `/prisma/`), as are migrations. So a policy change cannot land without a security record.
- **The residual is structural.** For the renderer's own output, C3 is tautological. The semantic checks are the renderer allow-list (keyed atoms), the render tests (the DR-A14 SQL compared with data-model §4.3 read from the doc) and the generated matrix (PR43-SEC-02).

### 5.5 `runtimeReadOnly` and `validateGrants`

Correct. `permissions`, `roles`, `role_permissions` (GLOBAL) and `reference_dataset_versions` (SYSTEM, D-TASK024-04) are flagged.
- `validateGrants` refuses any INSERT, UPDATE or DELETE line for every grantee, and the manifest grammar admits only SELECT, INSERT, UPDATE and DELETE.
- C5 compares every live ACL entry, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN included, in both directions.
- The real manifest is validated in a unit test, and the flagged set is pinned exactly.
- The manifest refuses `runtimeReadOnly` on RLS classes and together with `hardDelete` or `stdColumns`.

Ledger note: PR43-SEC-09 (b).

### 5.6 `eslint.config.mjs`

Effective-config diff (P2, 25 paths) shows exactly two real changes. Every other difference is the extract-path `packageDir` value.
1. `tests/generated/rls/**/*.ts`: `import-x/no-relative-packages` ignore changes from `^(?:\.\./)+(?:apps/api/src|tools/openapi)/(?!(?:.*/)?\.\.(?:/|$))` to the same pattern plus `|tools/db|prisma/tests/harness`.
   - The anchoring is kept: the alternation is followed by `/`, and no `..` segment may follow.
   - `.tsx` and `.mts` there, `tests/generated/rlsx/**` and the rest of `tests/generated/**` are unchanged.
2. `tools/db/render-rls-dr-a14.test.ts`: `platform/tenant-context-sql` changes from `error` to `error` with `allow: ['keys']`. It is one exact file in the existing renderer entry. `tests/generated/rls/**` has no exemption, so the rule still applies there (D-TASK024-02 holds).

The mutation control (widened glob, folder exemption) produced 27 leaf differences, so the probe sees both kinds of change.

### 5.7 Routing

- **PR32-SEC-07 (c)** (module raw SQL naming a SYSTEM table; SYSTEM tables have no RLS). The raw-SQL manifest it was routed to is rejected by D-ARCH-091 (2).
  - Proposed owner: principal-architect rules on the mechanism. Recommended: extend `platform/system-model-owner` (or `db-raw-sql`) so that a raw-SQL tagged template in `apps/*/src/modules/<m>/repository/**` may name a SYSTEM table only when its table-class manifest `module` is `<m>`. The rule refuses non-literal SQL already.
  - Implementer: senior-developer, with the next edit of those rules. That is 020-C if it is still open (it edits `eslint.config.mjs` and the boundaries policies, D-ORCH-060); otherwise a 020-D part.
  - Due before the first module repository with a raw statement on a SYSTEM table merges, and before G3.
  - With one runtime role there is no database backstop, so the lint is the only control.
- **PR24-SEC-06** (content-hash rule-12 marker). It is no longer needed and is closed as superseded:
  - `tools/ci/check-migration-immutability.mjs:10-15` now refuses any change, deletion or rename of a released `prisma/bootstrap/*.sql` file, base against head, and lane A runs it (`ci.yml:130`);
  - rule-12 approvals are bound to blob SHAs in the security records;
  - both bootstrap files are owned paths.

  The marker stays an optional hardening with no owner.

### 5.8 Evidence hygiene

- **D-SEC-PR23-02 statements.** They are present, verbatim in substance, in the PR's gate table ("`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first"; "`.git/info/exclude` is empty", 0 bytes, logged by the script). They are not in the evidence commit body, which matches the accepted practice for earlier PRs.
- **Lockfile.** This PR does not change it, so no `ajv` tuple statement is due.
- **Host-path scan.** 0 hits over the 7 run files for 12 needle labels; the synthetic control fired every label. This agrees with the PR's own count-only scan (7 files, 10 patterns, 0).
- **Hashes and range.** `lockfile_sha256` and `manifest_sha256` match the head blobs. `4513512..8ac271d` touches only the run directory.

## 6. DR-A14 mechanism sign-off (data-model A19: a merge condition of TASK-037 / TASK-049)

**Given for the mechanism shipped here.**
- Three named templates are selected by `policySet`. Each is accepted only on the table of the same name and class, checked both in the manifest loader and in the renderer, with `Object.hasOwn` against prototype keys.
- The exact atoms are admitted only in their own template, and the forbidden-token scan runs over the whole predicate, so `<>`, `!=`, `NOT`, `OR`, `coalesce`, `IS DISTINCT FROM` and raw `current_setting` stay refused inside the `EXISTS`.
- Positive status lists are used.
- The C3 derived equality holds, with the recursion, foreign-table and `IN`-list invariants carrying planted controls.
- The visibility semantics are proven on the probe sets.

**Conditions for TASK-037 / TASK-049.**
- List the real `users`, `memberships` and `organisations` with their `policySet` and `definerRead`. The probe layer then stops planting them, and the committed layer covers them.
- Ship `trg_organisations__type_immutable` and `ux_organisations__single_operator` in the same migration as `app_is_operator()`.
- Resolve PR43-SEC-09 (a) before US-083.

## 7. Sequencing with in-flight PRs that touch `eslint.config.mjs`

| PR | Hunks | Overlap with this PR (`193-199`, `702-720`) | What a union must preserve |
|---|---|---|---|
| #42 TASK-025 (`e7dfbac`) | `+4` in `TENANT_CONTEXT_EXEMPTIONS` after the `up-down-up.test.ts` entry; boundaries categories and policy for `packages/audit` and `prisma/tests/audit` | None textually (different lines; git merges cleanly) | Both exemption edits: this PR's `render-rls-dr-a14.test.ts` in the renderer `keys` entry, and #42's `packages/audit/src/store/prisma-store.ts` `setter` entry; this PR's `tests/generated/rls/**` block after the `apps/api/src|tools/openapi` block. The second merger's record needs a merge-only round, because both PRs change the owned `eslint.config.mjs` (PR10-SEC-21 class) |
| 020-C (`680e458`, branch only) | `303-320`, `385-404`, `893-910` (generated-client value importer narrowing) | None textually | Same two edits. After the union, re-lint `tests/generated/rls/**`: it imports `apps/api/src/platform/db/runtime.js` and `routing/*`, and a narrowed boundaries policy must not start refusing them, nor be loosened to admit them |
| #39 TASK-014 (`ace8c27`), #40 TASK-015 (`ee64946`) | No change to `eslint.config.mjs`, `tests/generated/tsconfig.json` or CODEOWNERS at their current heads | None | Re-check if either head moves. If PR43-SEC-04 adds a CODEOWNERS line and #40 also edits CODEOWNERS, the union keeps both |
| #44 020-C (`443c2f1`), added in round 2 | `eslint.config.mjs`, `tools/lint/lint-fixtures.mjs`, `tools/lint/negative-fixtures.test.ts` (disjoint hunks); the new ratchet `tools/repo/test-lane-idle-timeout.test.ts` | Semantic, not textual: the ratchet refuses the idle-in-transaction value `15_000` at `tests/generated/rls/cross-tenant.int.test.ts:549` (it requires `TEST_LANE_TX_IDLE_TIMEOUT_MS`) | The second merger sets the constant there. That file is owned since PR43-SEC-04, so the edit needs a record round (§R2.12, sim S9) |

`tests/generated/tsconfig.json` (owned via `**/tsconfig*.json`) is changed by no other open PR. Round 2 updates this table for the current heads of #44, #42 and #39 in §R2.12.

## 8. Routing, owners and proposed decisions

| Item | Owner | Due |
|---|---|---|
| PR43-SEC-03 (C1) | senior-developer / database-engineer, this PR, delta round 2 | before merge |
| PR43-SEC-01 (C2) | senior-developer (TASK-024 follow-up, or TASK-027 if it lands the first route) | before the first `tenant`, `user` or `guest` route with a path parameter merges; at the latest the `rls-cross-tenant` activation |
| PR43-SEC-02 | senior-developer | before the `rls-cross-tenant` activation PR |
| PR43-SEC-04 | this PR (one CODEOWNERS line pair; can ride C1) or devops 015-C | before the activation PR |
| PR43-SEC-05, PR43-SEC-06 | senior-developer / database-engineer | before TASK-037 merges (first in-scope table; SEC-TC-74 is its merge condition) |
| PR43-SEC-07 | TASK-024 follow-up / TASK-037 | with SEC-TC-74 adoption |
| PR43-SEC-08 | (a) TASK-051; (b)-(d) TASK-024 follow-up; (e) qa-lead | activation PR |
| PR43-SEC-09 | (a) principal-architect + product-manager; (b) TASK-037 | before TASK-037/049 merge; (a) before US-083 |
| PR43-SEC-10 | TASK-037 with PR11-SEC-11 (e) | before G3 |

Proposed decision text for the orchestrator (not edited here):
- **D-SEC-PR43-01.** PR #43 security r1 at `8ac271d` = PASS_WITH_CONDITIONS: 2 MEDIUM, 4 LOW, 4 INFO; nothing Critical or High.
  - C1 = PR43-SEC-03 (`splitStatements` `begin` regression): fixed in this PR, with fixtures; delta round 2 record before merge. This round does not authorise the merge.
  - C2 = PR43-SEC-01 (executable API cases, guest and dual-mode routes enumerated): before the first tenant-, user- or guest-resource route with a path parameter merges.
  - Follow-ups and owners per the record §8.
- **D-SEC-PR43-02.** DR-A14 mechanism sign-off given (record §6), with the TASK-037/049 conditions listed there. PR43-SEC-09 (a) (`INVITED` users-row visibility from a tenant-writable membership row) goes to principal-architect and product-manager for a ruling before US-083.
- **D-SEC-PR43-03.**
  - PR32-SEC-07 (c) is re-routed: principal-architect rules on a manifest-driven SYSTEM-table check in `system-model-owner` / `db-raw-sql`; senior-developer implements it with the next edit of those rules (020-C if still open, else 020-D), before the first module raw statement on a SYSTEM table.
  - PR24-SEC-06 is closed as superseded by the bootstrap immutability check (`check-migration-immutability.mjs`) and the blob-bound rule-12 approvals.
- **D-SEC-PR43-04.** Endorse the activation proposal (`rls-cross-tenant` active, `min_tests` = the generated count, `SEC-TC-06` required; SEC-TC-07 to `required_cases_pending` with TASK-051; SEC-TC-73 and SEC-TC-74 through `required_cases_pending`). Add two conditions for the activation PR: its evidence carries the generated suite's JUnit, and PR43-SEC-02 and PR43-SEC-04 are merged.

## 9. Record validation

Simulated with `main`'s real checker in a `git clone --shared` of the main repository. Scenario commits are built by plumbing on `8ac271d`, and the checker runs with `--base 24fa3fc --pr 43 --json`:

| Scenario | Expected | Result |
|---|---|---|
| S0 head without this record | missing | missing (owned 103) |
| S1 this record committed on `8ac271d` | pass | **pass**, bound to `8ac271d` |
| S2 same, `--pr 42` | missing | missing |
| S3 a later table whose last `Verdict` row is FAIL | missing | missing |
| S4 an owned `tools/db/` file added after the record | missing | missing (owned 104) |
| S5 a docs-only commit after the record | pass | pass |
| S6 `tests/generated/rls/fixtures.ts` edited after the record | pass (shows PR43-SEC-04) | pass |
| S7 merge of `main` `24fa3fc` after the record (docs-only overlap) | pass | pass |
| S8 `eslint.config.mjs` edited after the record | missing | missing |

The record has exactly one `Head` row and one `Verdict` row (the last table). It is LF-only (0 CR bytes), 390 lines. The clone's sparse set did not apply (a Git Bash path form), so the scenarios ran on full checkouts; that does not change the results. **For C1:** round 2 must append its own `| Head |` row naming the fix head and a final `| **Verdict** |` row. Any non-docs commit or `main` merge that changes an owned path after `8ac271d` voids this round's binding.

## 10. Hygiene

- Record content: no secret values, no host paths, no OS user name; SHAs and run ids only.
- A count-only scan of this file for host fragments found 0 hits. It used 8 labels: user name, 8.3 stem, home in two spellings, temp dir, host name, and the `Users` path in two spellings.
- A count-only scan for secret shapes also found 0 hits: AWS key id, GitHub token, private-key header, password assignment, JWT, e-mail address.
- The Gitleaks rule set was not run over this file. Lane A scans it on commit.
- Scratch probes ran under the session scratchpad. Junctions were removed by unlinking (`fs.rmdirSync`), and the main checkout's `node_modules` count is unchanged.
- No git, install, build or test command ran in the PR worktree. Its only change is this file, which was written with the editor tools and normalised to LF by a one-line Node script.

## 11. Verdict

| Field | Value |
|---|---|
| Critical / High | 0 / 0 |
| Medium | PR43-SEC-01 (C2), PR43-SEC-03 (C1) |
| Low | PR43-SEC-02, 04, 05, 06 |
| Info | PR43-SEC-07, 08, 09, 10 |
| Closed by this PR | PR11-SEC-03 residual (C3 derived, D-ARCH-072); PR11-SEC-07 remainder (rule 17, §8.4 prefix reversibility); PR11-SEC-10 (mechanism; §6); PR11-SEC-11 g (`runtimeReadOnly`); PR11-SEC-11 e lint half (rule 9 CREATE TABLE scope; catalog half open, PR43-SEC-10); PR11-SEC-14 b (lint and catalog halves; residual PR43-SEC-06 b/d); PR11-SEC-15 b/d/e/i; PR11-SEC-16 and PR24-SEC-05 (token-level E-strings in both lanes; residual PR43-SEC-06 a/c); PR11-SEC-17 c; PR24-SEC-02 class fix; PR24-SEC-11 (rule 11c, subject to C1); PR26-SEC-03 (mechanism; first instance TASK-037, SEC-TC-74); PR7-SEC-04 and PR7-SEC-07 item 3 (generated probes). PR24-SEC-06 closed as superseded (§5.7) |
| Conditions | **C1** PR43-SEC-03 fixed in this PR with fixtures, delta round 2, before merge. **C2** PR43-SEC-01 before the first tenant-, user- or guest-resource route with a path parameter merges |
| **Verdict** | **PASS_WITH_CONDITIONS.** No Critical or High finding is open for this change. C1 is a merge condition (round 2 record required); C2 and the follow-ups are tracked per §8 |

# Delta round 2 (fix cycle 1 + union with PR #40, head 585f163)

| Field | Value |
|---|---|
| PR | #43, branch `feat/TASK-024-generated-cross-tenant-isolation-test`. Fix cycle 1 (D-ORCH-063/064/065; PR body D-TASK024-12..18; comment issuecomment-6874036152): code head `9d679f0`, evidence commit `585f163`. Three `main` merges: `9198494` (docs only), `50670f4` (PR #40 `74385a1`), `64959f2` (docs only). Merge base with `main` is `c998fae`. `main` has since moved to `b6f5071` (PR #45 `4a60ca6`: `.gitleaks.toml`, `tools/ci/sec-static.test.ts`, `tools/quality/gitleaks-baseline.txt`; then docs only). None of those paths is changed by this PR |
| Head | 585f16318279f8f7f0975b762ea4412e84bf95f8 |
| Fix delta | `git diff <merge-tree(8ac271d, c998fae)> 585f163` lists exactly the fix cycle: 27 code and test files plus 65 new lint fixtures (92 owned files), this record and the 7 run files. So the three merges introduced nothing beyond a clean union (§R2.8) |
| Lane A evidence | Run [43572039629](https://github.com/sukhchdit/shipcube/actions/runs/43572039629) on `585f163`: `fast-lane` **success**, all 33 steps executed. In `scans`, Gitleaks, Semgrep and oasdiff are green; only "Security-owned paths need a review record" failed (182 owned paths; the round-1 record names `8ac271d`), and `ci-gate` failed as its aggregate. This round is that record |
| Lane B evidence | `docs/05-quality/tests/runs/20261114T0725Z_9d679f0`, profile `pr`, verdict PASS: api 123, catalog-c1-c14 102, integration 291 (1 skip), unit 4570 (2 skip); `build_clean` true; `git_sha` `9d679f0`. `lockfile_sha256` and `manifest_sha256` equal the blobs at `9d679f0` (recomputed). `9d679f0..585f163` adds only the 7 run files. `rls-cross-tenant` is still `planned` (skipped by manifest); its 126 tests ran inside the `generated` coverage-only run, whose case `coverage merge: generated coverage run` passed (unit JUnit line 4559; `heavy.mjs:734` fails that case on any failing test; the project is `tests/generated/**/*.{api,int}.test.ts`, `jest.config.ts:141`) |
| Reviewer / date | security-analyst, 2026-11-14, round 2 (delta). Read-only on code. Git ran in the main checkout and read-only in the PR worktree; the worktree's only change is this file. No Docker, database, install, build or test-suite run. Probes ran on `git archive` extracts of `585f163` and `8ac271d` in session scratch (§R2.2) |

## R2.1 Summary

Both conditions are closed, and so are the four LOW findings and the INFO parts claimed as done:
- **C1 = PR43-SEC-03 (closed).** The splitter opens a block only on `BEGIN ATOMIC` at parenthesis depth 0 in a routine statement and fails closed (new rule L) in `migration.sql`, `down.sql` and every bootstrap file. Every round-1 `begin` row gives 7 statements with all tail findings (R1 head: 1). The `END;` resync row is split correctly. The `down.sql` rule 17 is back.
- **C2 = PR43-SEC-01 (closed).** `API_CASES` is a map of executable cases. The suite runs every entry against the real module registry (`moduleRegistry` from `apps/api/src/modules/index.generated.js`, through `createApp` on the real runtime, with only the authenticate slot swapped). `guest` routes are enumerated. A stale or bare registration fails, and a leaking route fails its case. I drove the PR's own `runApiCase` and `routeCaseFindings` against stub routes (§R2.4).
- **LOW 02, 04, 05, 06: closed**, each with a probe on head and the R1 head as control (§R2.5). **INFO 07, 08, 09: closed** for the parts claimed; the rest is routed to TASK-037 / TASK-051, which is accepted. **INFO 10: partly closed** (catalog half of the schema scope).
- **DR-A14 users fence:** `('ACTIVE','SUSPENDED')` in the template, the renderer atom and data-model §4.3 (D-ARCH-123); the probe suite pins `INVITED` → 0.
- **Union with PR #40 is pure.** No existing check is weakened: `REQUIRED_CODEOWNED_PATHS`, CODEOWNERS and `suite-runners.json` only gain lines.
- **Evidence hygiene holds.** The gate table carries both D-SEC-PR23-02 statements verbatim, and the host-path scan is 0.

New in this round:
- **PR43-SEC-11 (LOW).** The splitter can still over-count inside a `BEGIN ATOMIC` body, and a later top-level `END;` resynchronises it. The code review found the `AS case` / `t.case` shapes (R2-m1). I add a bare label `case` and an in-block `begin atomic` (column plus bare label), which the reviewer's previous-token fix does not close. A structural fix is validated on a scratch copy.
- **PR43-SEC-12 (LOW).** `positiveStatus` is unconstrained. A registered case with a mis-mapped parameter and `positiveStatus: 404` passes against a route that leaks every row.
- **PR43-SEC-13 (INFO).** After D-ARCH-123, the users-row consent property rests on the service layer, because `memberships` stays tenant-writable.

**Findings this round: 0 Critical, 0 High, 0 Medium, 2 LOW new, 1 INFO new. Verdict: PASS_WITH_FOLLOW-UPS** (§R2.16).

## R2.2 Method

| Area | How |
|---|---|
| Delta | Three-way: `git merge-tree --write-tree 8ac271d c998fae` (clean) against `585f163` gives the fix delta (Field table). Read in full: the `sql-text.ts`, `lint-migrations.ts`, `api-cases.ts`, `generator.ts`, `fixtures.ts` diffs; the API, write-probe and DR-A14 parts of `cross-tenant.int.test.ts` and `database.ts`; the `c15`, `c01-c12` and `scans.ts` additions; CODEOWNERS, `check-workflow-policy.{mjs,test.ts}`, `suite-runners.json`, `lint-fixtures.mjs`, `negative-fixtures.test.ts`, the DR-A14 template / atom / render test and `platform.json` |
| P1 splitter and linter | `git archive` extracts of `tools/db`, `prisma/sql`, `prisma/migrations` and `prisma/bootstrap` at `585f163` and at `8ac271d` (control). About 75 synthetic migration and bootstrap inputs, each through both heads, went through the real `lintMigrations` / `lintBootstrap`, plus direct `splitStatements` calls (scripts `p1-begin`, `p2-lows`, `p3-toplevel`, `p5-labels`). Two candidate fixes ran on scratch copies of the head splitter, the second also over all 488 `.sql` files of the extract (`p6-fixb`). PostgreSQL acceptance of the attack inputs is taken from the PG 18 grammar (`REL_18_STABLE` `gram.y` and `kwlist.h`), not executed |
| P2 API runner | Extract of `apps/api/src`, `packages`, `tools/db` and `tests/generated` at `585f163`, run with type stripping and a resolve hook (`@platform/*` → package sources). The PR's real `runApiCase`, `fillPath`, `tenantResourceRoutes` and `routeCaseFindings` ran against a `node:http` stub with an isolating route and a route that leaks every row (`p4-cases`) |
| P3 catalog and suite | Reading only (Docker not used): C15 shape and order SQL, the dynamic-SQL, parameter-ACL and escape-setting catalog checks, the write mutation control, the DR-A14 probe tests |
| P4 union and policy | `git diff c998fae 585f163` over the paths that both `main` (`201d8d9..c998fae`) and this PR change. `checkCodeowners` read against the head CODEOWNERS; later-line override scan |
| P5 hygiene | Count-only host-fragment scan (12 labels computed at run time) over the 7 run blobs, with a synthetic control in which every label fires. Lockfile and manifest SHA-256 recomputed. `gh run view` for the lane A steps |
| P6 record simulation | §R2.14 |
| Cross-check | Code review round 2 on `main` (`22b0ebd`): APPROVED_WITH_NITS, R2-m1 (MINOR, security to rate), R2-n1..n3. The findings below cite it where they overlap |

## R2.3 C1 (PR43-SEC-03): closed

| Probe (P1; a statement before the six-statement tail of round 1 unless noted) | R1 head `8ac271d` | Head `585f163` |
|---|---|---|
| Control, no routine | 6 statements, all tail findings | same |
| `CREATE FUNCTION public.begin()` / `CREATE OR REPLACE FUNCTION public.begin()` | 1 statement, one rule-9 message | **7**, all tail findings |
| Parameter `begin` with `RETURN begin` / `CREATE PROCEDURE p(begin integer)` | 1 | **7**, all findings |
| `RETURNS TABLE (begin integer)`; `SET search_path = begin` (GUC value) | 1 | **7**, all findings |
| `RETURN CASE … END` at depth 0; `BEGIN /* c */ ATOMIC`; `BEGIN -- c` + newline + `ATOMIC`; procedure `BEGIN ATOMIC`; leading comment before CREATE; CASE in parentheses or nested inside a block | 7 | 7, all findings |
| Balanced `BEGIN ATOMIC … CASE … END; END;` (control) | 7 | 7 |
| Round-1 resync: `begin`-named function, `GRANT TRUNCATE`, lone `END;`, `GRANT TRUNCATE` | 2 statements (8 once) | 4 (11c, 8, 8) |
| `down.sql`: `begin`-named function then `DROP TABLE public.x;` | clean | **17** |
| Unbalanced `BEGIN ATOMIC` in `migration.sql` / `down.sql` / a bootstrap file | clean / clean / 12 only | **L** / **down: L** / **L** (bootstrap control clean) |

The fixtures under `transaction-control-begin/` (7 migrations), `bootstrap/unbalanced-atomic` and the `sql-text.test.ts` shapes exist and are pinned exactly in `lint-migrations.test.ts`. The code review reports that all 55 tracked non-fixture SQL files split identically under `main`, the R1 head and the head (209 statements), with 7 of 10 splitter mutants killed. `shadow-init.ts` and `up-down-up.ts` call the splitter directly; a lex error there throws, which is fail closed. **Residual: PR43-SEC-11** (in-block over-count shapes).

## R2.4 C2 (PR43-SEC-01): closed

- **Executes against the real registry.** The committed layer serves `moduleRegistry` (`cross-tenant.int.test.ts:35, 593`) through `createApp` on `databaseRuntimeFromConfig`. The pipeline is `{ ...defaultPipelineSlots(...), authenticate: probePrincipalSlot }` (`:558`), so only the authenticate slot is swapped. User A holds every catalogued permission, so a 403 can never pass for isolation.
- **Guest routes are enumerated.** `TENANT_RESOURCE_TENANCIES` = tenant, user, guest (`generator.ts:320`). `operator-cross-tenant` is excluded with a stated reason (SEC-TC-06 and the RBAC matrix cover it), which I accept.
- **Registration without execution is impossible.** `EXECUTED` is derived from `API_CASES` (`:579-582`). Each entry runs through `it.each`, and `expect(route).toBeDefined()` / `expect(plan).toBeDefined()` fail a stale entry or one without a seeded table. The type demands `table` and `params`. `routeCaseFindings` names a missing case, a stale case, wrong parameters, a non-RLS table, a quote-token route on a non-guest table and a credential the runner cannot present.
- **The mutation control fails.** The leaking route gives exactly 4 named problems (`:624-634`).

Probe P2 used the PR's own code against stub routes:

| Case (TENANT table, rows A and B) | Result |
|---|---|
| Leaking route, parameter mapped to `id` | FAIL, 4 problems (404 expected, not problem+json, code, 3 B values in the body) |
| Isolating route, same mapping | PASS |
| Leaking route, parameter mapped to `org_id` (wrong), default positive 200 | FAIL: positive control got 404 |
| **Leaking route, parameter mapped to `org_id`, `positiveStatus: 404`** | **PASS: no problem** (→ PR43-SEC-12) |
| Leaking route, correct mapping, `positiveStatus: 404` | FAIL, 5 problems |
| `tenantResourceRoutes` over tenant, guest (`{quoteId}`), user, `operator-cross-tenant`, list (no parameter), public | getParcel, getQuote, getMe |
| `routeCaseFindings`, no cases / full cases / case on a GLOBAL table / quote-token route on a TENANT table | 3 missing / none / both named |

**Residual: PR43-SEC-12.**

## R2.5 LOW and INFO items of round 1

| Item | Status | Evidence (P1/P3; head vs R1 head) |
|---|---|---|
| PR43-SEC-02 (blind writes, re-parent, guest writes, write mutation control) | **Closed** | `update-blind` (`UPDATE t SET k = $1` plus constant stamps; no WHERE, no RETURNING), `delete-blind` (`DELETE FROM t`), `reparent-own-row` (expectation follows the first guard: 23514 de-claim, P0001 standard-columns guard on id-keyed tables, else WITH CHECK 42501 with the RLS marker), `guest-update-other-hash`, `guest-insert-with-org`, `guest-context-tenant-rows` (`database.ts:292-326`, `generator.ts:193-205`). The write mutation control (`cross-tenant.int.test.ts:322-332`) pins exactly `['update-blind','delete-blind']` for `FOR UPDATE/DELETE USING (true)` on `rls_probe_tokens`, and `['update-blind','guest-update-other-hash']` for `FOR UPDATE USING (true)` on `rls_probe_quotes`. That is the outcome round 1 predicted for the column-reading probes |
| PR43-SEC-04 (CODEOWNERS) | **Closed** | `/tests/generated/rls/` and `/tests/generated/api-mounts.ts` owned (CODEOWNERS:80-81); both are in `REQUIRED_CODEOWNED_PATHS`. Mutation tests: deleted, commented out and ownerless each give one finding, and a sibling `/tests/generated/rbac/` line does not cover `rls/`. No later CODEOWNERS line matches either path without an owner (18 later lines, all owned). Lane A already counts `tests/generated/rls/*` as owned (base and head patterns), and record sim S6/S6b show an edit there now voids a record. The last-match precedence limit of `checkCodeowners` is the existing PR10-SEC-20 INFO |
| PR43-SEC-05 (a) rule 7 | **Closed** | `ENABLE REPLICA TRIGGER`, `ENABLE ALWAYS TRIGGER`, `ENABLE REPLICA RULE`, the `IF EXISTS ONLY` quoted form, a comment between the words and a second sub-command give 7 (R1: clean). Plain `ENABLE TRIGGER` is clean. The same ALTER inside a DO body is clean on both heads (the pre-existing DO-body class, like `DISABLE TRIGGER`); its committed effect is caught by (b) |
| PR43-SEC-05 (b) C15 committed shape | **Closed** | Per in-scope table `[expectedGuard(table)]` (`enabled 'O'`, row, BEFORE, INSERT, UPDATE, no DELETE/TRUNCATE), plus `guardShapeFindings`; REPLICA / ALWAYS / DISABLE are each named on the probe |
| PR43-SEC-05 (c) order | **Closed** | `AFTER_GUARD_SQL`: any other non-disabled BEFORE INSERT/UPDATE ROW trigger whose name sorts after the guard's (`COLLATE "C"`; tgtype bits 1, 2 and 4/16 are correct) is named; `__zz` and `__std_columnsZ` named, `__aa` / AFTER / disabled not |
| PR43-SEC-05 (d) generator listing | **Closed** | A replica-mode or dropped de-claim trigger is named (`cross-tenant.int.test.ts:273-303`) |
| PR43-SEC-06 (a) escape settings | **Closed** | Rule 20 fires in both lanes on `SET … = off`, `SET LOCAL … TO`, the quoted name in either case, `set_config(…)`, `backslash_quote`, `RESET`, a routine SET clause, a DO `EXECUTE` literal and a `::text` key (R1: all clean). In the bootstrap lane, `SET standard_conforming_strings = off` followed by an escaped plain string now gives 20 (R1: clean). A concatenated `set_config` key and a `U&` name give 16. The catalog asserts no `proconfig` or `pg_db_role_setting` entry, with planted controls. Remaining: a keyword-split name inside a DO-body `EXECUTE` lints clean. That is the stated dynamic-SQL limit, and the prosrc-based catalog scans see decoded text |
| PR43-SEC-06 (b) query-string executors | **Closed** | `query_to_xml` in an `AS '…'` SQL body, `pg_catalog.query_to_xml` in a `RETURN` body and the existing fixtures give 16 (R1: clean). Top-level and DO-body uses with a context setter in the literal give 16 on both heads. `cursor_to_xml` is clean: it takes an open cursor, not a query string. The catalog `DYNAMIC_SQL_SQL` covers every language and `BEGIN ATOMIC` bodies (`pg_get_function_sqlbody`) |
| PR43-SEC-06 (c) nesting cap | **Closed** | `containsEscapeString` returns true at the cap while a string or dollar token remains (the reviewer killed the fail-open mutant) |
| PR43-SEC-06 (d) allow-lists | **Closed** | Lint lane: name plus SHA-256 of the normalised CREATE statement (head and SET clauses included); the test shows whitespace kept, and a body change, `SECURITY DEFINER` or another name refused; the list is empty. Catalog: name plus SHA-256 of the normalised `prosrc`, with `ensure_audit_partitions(integer)` pinned. The catalog hash does not cover `prosecdef`/`proconfig`; C11 and bootstrap immutability cover those for that one function. No action |
| PR43-SEC-07 | **Closed (claimed part)** | `pg_parameter_acl`: no SET / ALTER SYSTEM to PUBLIC or `platform_%`; `has_parameter_privilege('platform_app','session_replication_role','SET')` false, with planted controls. The SEC-TC-74 matrix additions, the migrator-owned `DEFINER_ALLOWED` invariant and the `NEW.x =` render check are routed to TASK-037 (D-TASK024-18): **accepted** |
| PR43-SEC-08 | **Closed (claimed part)** | (b) a fresh-session NULL-context probe per layer (`:214-232`); (c) the genuine operator positive control (`:432`); (d) `guest-context-tenant-rows`; (e) 20 × 126 runs and an active heavy run, both reported but uncommitted (not verifiable here); the committed coverage-only run passed. (a) column-level grants routed to TASK-051: **accepted** |
| PR43-SEC-09 | **Closed** | (a) per D-ARCH-123 (§R2.7). (b) `_prisma_migrations` and `bootstrap_migrations` are `runtimeReadOnly`; write lines for either are refused for every grantee (`grants-manifest.test.ts`) |
| PR43-SEC-10 | **Partly closed** | The generator (R1-m4) names every relation outside `public`, and the catalog asserts no r/p/f/v/m relation there, with planted controls in `platform` and a new schema. That closes the SET SCHEMA / SELECT INTO / view residuals at catalog time, and the PR11-SEC-11 (e) catalog half. Still open (INFO, TASK-037): object kinds refused only by migrator privileges |

## R2.6 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR43-SEC-11 | In-block over-count of `splitStatements` (a label `case`, or the `begin atomic` alias pair) is resynchronised by a top-level `END`; the statements in between lint clean | LOW | CWE-693 (via CWE-436) | A04 | `tools/db/sql-text.ts:239-244` | senior-developer / database-engineer (§R2.13) |
| PR43-SEC-12 | `ApiCrossTenantCase.positiveStatus` is unconstrained, so a mis-mapped case with `positiveStatus: 404` passes against a leaking route | LOW | CWE-693 (via CWE-639) | A01 | `tests/generated/rls/generator.ts:356, 365-400`; `api-cases.ts:114` | senior-developer (§R2.13) |
| PR43-SEC-13 | After D-ARCH-123 the consent property of `p_users__org_member_read` rests on the service layer: `memberships` stays writable by any session of the organisation | INFO | CWE-359 | A01 | data-model §4.3 (`p_memberships__tenant`, `FOR ALL`, WITH CHECK `org_id = app_org_id()`); §4.3 note on registration and acceptance | TASK-227 / TASK-231, qa-lead (abuse suite) |

### PR43-SEC-11 (LOW): an in-block over-count plus a top-level `END` resync

**What.** Inside a block, the head counts every `case` and every `begin atomic` at parenthesis depth 0 as an opener (`sql-text.ts:240-241`). PostgreSQL 18 accepts four shapes in which those words are not openers:
- `SELECT 1 AS case` and `t.case` (`ColLabel` and `attr_name` admit reserved words): code review R2-m1;
- `SELECT 1 case`: CASE is a `bare_label_keyword`, so it is a column label without AS;
- `SELECT begin atomic FROM …`: `begin` is an unreserved column reference and ATOMIC a bare label (`target_el: a_expr BareColLabel`).

The routine's real `END` then leaves depth 1, and every later statement is swallowed until some top-level `END [WORK | TRANSACTION]` (a COMMIT synonym) brings it to 0.

| Shape inside the body, then `GRANT TRUNCATE … TO platform_app; DROP TABLE public.y; SET lock_timeout = '10s'; END; SELECT 1;` (P1 `p5-labels`) | R1 head | Head | Head without the `END;` | Code review fix (skip `case`/`end` after `as` or `.`) |
|---|---|---|---|---|
| `SELECT 1 AS n` (control) | 2, 11, 8 | 2, 11, 8 | 5 statements | unchanged |
| `SELECT 1 AS case` / `t.case` | clean | **clean** (2 statements) | L | closed (6 statements) |
| `SELECT 1 case` (bare label) | clean | **clean** | L | **not closed** (2) |
| `SELECT begin atomic FROM (VALUES (1)) v(begin)` | clean | **clean** | L | **not closed** (2) |

**Exploitability / impact.** No innocent form silences the gate any more. A label alone gives rule L (visible), and silencing needs a deliberate label plus a top-level `END;`, which is itself transaction control that a reviewer sees. Migrations are owned and security-reviewed. The outcome controls still catch grants (C5), policies (C3), RLS state, memberships (C13) and relations outside `public`. Rules 2, 7, 11, 11c, 14 and 17 have no backstop. Impact on the guardrail is High; the likelihood is below Low for a deliberate-only, two-artefact shape, the same reasoning as PR43-SEC-02 in round 1: **LOW**. Today no repository migration defines a `BEGIN ATOMIC` routine.

**Remediation (code level, validated on a scratch copy, `p6-fixb`).** A previous-token rule cannot close the bare-label and alias shapes, so make it structural:
1. Inside a block, count `BEGIN ATOMIC` only when the current body statement itself starts with `create [or replace] function|procedure`. Keep `bodyWords`, reset at each `;` inside the block and at a block open.
2. Track the CASE depth per body statement. At a `;` inside a block with an open CASE, throw `SqlLexError('unbalanced CASE … END in a BEGIN ATOMIC body statement')`, which is rule L. A CASE expression can never span a `;`, so an over-count can never survive one.
3. `end` closes a CASE while one is open in the body statement, else the block. A label `end` over-splits (fail-safe, as today).

On the scratch copy: `AS case`, `t.case` and bare `case` give **L**; the `begin atomic` alias gives the correct 5 statements; the controls (balanced CASE, two body statements, parameter `begin`, `RETURN CASE`) are unchanged. All **488** `.sql` files of the head extract (repository and lint fixtures) split identically to the head.

Fixtures: one per shape followed by hostile statements and a top-level `END;`, plus `AS end` (stays fail-safe) and the parenthesised label of code review R2-n1. Name the limit in the JSDoc.

**Verification.** The four shape rows give L or the correct split, each with the tail findings. The 55 repository SQL files are unchanged.

### PR43-SEC-12 (LOW): an unconstrained `positiveStatus` makes a case vacuous

**What.** `positiveStatus?: number` (`generator.ts:356`) replaces the positive control's expected 200 (`api-cases.ts:114`), and `routeCaseFindings` never checks it. Suppose a route answers with any row by id (a SYSTEM-handle read, a cache key without the organisation) and the case maps the path parameter to the wrong column. Then both calls return 404, and `positiveStatus: 404` turns the case green (P2, row 4). A developer whose positive control fails because of a wrong mapping can reach that state by copying the observed status into the case.

**Exploitability / impact.** This is the C2 surface (a detection gap behind RLS, Medium impact). It needs a non-2xx value in an owned, now CODEOWNED file, so likelihood is Low: **LOW**.

**Remediation.**
- In `routeCaseFindings`, refuse a `positiveStatus` that is not an integer in 200..299: `"<route>: positiveStatus <n> is not a success status (the positive control must reach the caller's own row)"`.
- In `runApiCase`, treat a positive call that returns 404 as a problem whatever the case says.
- Add a unit test of the runner over a `node:http` fake server: a leaking route, the mis-mapped `positiveStatus: 404` case, and a dropped positive-control branch must fail. This also covers code review R2-n2 (c).

**Verification.** Row 4 of the P2 table fails. A case with `positiveStatus: 201` on a creating route still passes.

### PR43-SEC-13 (INFO): the users-row consent property now rests on the service layer

D-ARCH-123 removes the designed pre-consent path: no `INVITED` membership is written, and acceptance inserts `ACTIVE`. At the RLS level, though, `p_memberships__tenant` is still `FOR ALL` with WITH CHECK `org_id = app_org_id()`. So any session of an organisation that a handler lets write a membership row for another `user_id` makes that user's `users` row visible through `p_users__org_member_read`. The data model already places the choice in the service ("the service is the only party that chooses it", §4.3 note).

Recommendation for TASK-227/231 (invitations, membership management) and qa-lead (abuse suite):
- an abuse case: a member of org A writes a membership for a user who has not accepted (direct route, mass-assignment of `user_id`, re-parenting an existing membership's `user_id`) → refused, and the users row stays invisible;
- principal-architect to consider a database-level guard (for example, `user_id` written only on acceptance, through a definer function that requires an `ACCEPTED` invitation row) before US-083.

## R2.7 DR-A14 users fence (D-ARCH-123)

| Place | Value |
|---|---|
| `prisma/sql/policy-templates/dr-a14-users.sql` | `AND m.status IN ('ACTIVE','SUSPENDED')` |
| `tools/db/render-rls.ts` `DR_A14_ATOMS['dr-a14-users']` | the same atom, exactly |
| data-model §4.3 fence (`main`, line 2560) and §1.7 (`INVITED` reserved) | `('ACTIVE','SUSPENDED')`, amended 2026-11-14 |
| `render-rls-dr-a14.test.ts` | reads the doc fence; a consistent template + atom pair that re-admits INVITED is killed by it (code review mutant e3). The describe title still says 2026-11-13 (code review R2-n3) |
| `cross-tenant.int.test.ts:404-415` | `INVITED` → 0, `ACTIVE` → 1, `SUSPENDED` → 1, `REMOVED` → 0, each with a 0-row control |

`organisations` keeps `('ACTIVE','SUSPENDED')`. The deny-list mutation still fails rule 9 and the renderer allow-list.

## R2.8 Union with PR #40 and with `main`

- **Fix delta is exact.** `585f163` against `merge-tree(8ac271d, c998fae)` differs only in the fix-cycle files (Field table). Every other path equals the clean union of the round-1 head and `main`.
- **Overlap files.** Both sides change `.github/CODEOWNERS`, `tools/ci/check-workflow-policy.mjs`, `tools/ci/check-workflow-policy.test.ts` and `tools/quality/suite-runners.json`. For each, `git diff c998fae 585f163` is additions only:
  - CODEOWNERS: +4 (comment + 2 lines);
  - `REQUIRED_CODEOWNED_PATHS`: +3, with PR40-SEC-01's `.gitattributes` entries kept right after;
  - the test file: +26 / −0;
  - `suite-runners.json`: one entry added.

  PR #40's content is therefore intact. The code review re-derived the `50670f4` resolution from its parents (conflict only in `REQUIRED_CODEOWNED_PATHS`, both sides kept).
- **`main` since the merge base.** `c998fae..b6f5071` (PR #45 and docs) touches no path this PR changes. Record sim S7 passes after merging `b6f5071`.
- **Evidence note.** Merging `main` into the branch makes `20261114T0725Z_9d679f0` stale for `check-evidence`, because non-docs paths change after `git_sha`. A squash merge without a branch update keeps it.

## R2.9 Evidence hygiene

- **D-SEC-PR23-02 statements.** Both are verbatim in the PR's gate table: "`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first" (Install row) and "`.git/info/exclude` is empty" (Clean tree row, 0 bytes, logged by the script). The lockfile is unchanged, so no `ajv` statement is due. The profile is `pr`, and no `wave` or `gate` run is committed.
- **Host-path scan.** 0 hits over the 7 run files for 12 labels; the synthetic control fires all 12. This agrees with the PR's own count-only scan.
- **Hashes and range.** The lockfile and manifest hashes match. `9d679f0..585f163` touches only the run directory.
- **Uncommitted evidence.** The 20-run flake table and the active run `20261114T0643Z_f12c7ba` are reported in the PR body only, and the FAIL run `20261114T0609Z_f12c7ba` is disclosed. They are not evidence of record. Activation (§R2.11) supplies the first credited run.

## R2.10 No existing check weakened

- **`check-workflow-policy.mjs`.** Only `REQUIRED_CODEOWNED_PATHS` changes (+2 paths, +1 comment).
- **`check-workflow-policy.test.ts`.** A new describe block only.
- **CODEOWNERS.** No line removed or reordered.
- **`suite-runners.json`.** One entry added; `required-suites.json` is unchanged.
- **Lint tooling.** `lint-fixtures.mjs` / `negative-fixtures.test.ts` add five repository probes (two allowed, three refused), which pin the anchored ignore of round 1 (R1-n3).
- **`eslint.config.mjs`.** Not changed by the fix cycle, so the round-1 effective-config analysis (§5.6) stands.
- **`lint-migrations.ts`.** Every rule of round 1 still fires on the round-1 probe rows. Rule 11 is widened (any non-routine statement), and rules 16 and 7 gain forms.

## R2.11 Activation deviation (D-SEC-PR43-04 adjusted)

**Endorsed**, as D-TASK024-16 and D-ORCH-071 state it. TEST-STRATEGY §9.3 rule 4 (`check-evidence.mjs:23, 352`) rejects a run that holds JUnit for a suite still `planned` in the base manifest. A code PR that activates its own suite can therefore never be credited, and activation is manifest-only by protocol (D-TASK276-02). The gap until activation is narrower than "runs in no lane": the 126 tests run inside the `generated` coverage-only run, and a failing test fails lane B. What is missing is the credit: suite-level reporting, `min_tests` and the SEC-TC-06 binding.

D-SEC-PR43-04's conditions become:
1. The manifest-only PR carries exactly the D-TASK024-16 diff. Its own lane-B run shows `rls-cross-tenant` with 126 tests, 0 failures and 0 skips; uncredited under rule 4 is acceptable.
2. It merges **before TASK-037** and before the first `tenant` / `user` / `guest` resource route with a path parameter (TASK-027/048/049/051).
3. `min_tests` equals the generated count at activation time, ratcheted afterwards.
4. PR43-SEC-02 and PR43-SEC-04 ship in this PR: done.

## R2.12 Sequencing update (§7)

| PR (head) | Overlap with this PR | What the union must preserve |
|---|---|---|
| #44 020-C (`443c2f1`, after its fix cycle 1) | `eslint.config.mjs`, `tools/lint/lint-fixtures.mjs`, `tools/lint/negative-fixtures.test.ts` (disjoint hunks; code review: `merge-tree` clean). **Semantic:** #44 adds the ratchet `tools/repo/test-lane-idle-timeout.test.ts`. It requires every `*.int`/`*.api` suite that calls `createApp(` to set `DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: TEST_LANE_TX_IDLE_TIMEOUT_MS` (1 000 ms), and `cross-tenant.int.test.ts:549` sets `15_000` | The second merger switches `:549` to the constant. That file is owned since PR43-SEC-04, so the edit needs a record round: S9 in §R2.14 shows it voids this record if #44 merges first. `serve()` must keep swapping only the authenticate slot, and `probePrincipalSlot` stays test-only. Re-lint `tests/generated/rls/**` with the new import (`apps/api/src/platform/tx/tests/runtime-twin.js`). #44 also changes `apps/api/src/app.ts` (`createApp`); `serve()` follows its signature without adding a second swapped slot |
| #42 TASK-025 (`d2ef478`) | `eslint.config.mjs`, `tools/lint/negative-fixtures.test.ts` (disjoint hunks) | Both exemption edits (round-1 §7); the second merger's record needs a merge-only round (PR10-SEC-21 class) |
| #39 TASK-014 (`7dd3c64`) | **Textual conflicts** in `tools/ci/check-workflow-policy.mjs` (adjacent `REQUIRED_CODEOWNED_PATHS` additions) and `check-workflow-policy.test.ts` (two adjacent describe blocks); CODEOWNERS also changes on both sides | Keep both required-path pairs and both describe blocks whole (code review R2.5). The second merger needs a merge-only security round. Check that both CODEOWNERS pairs are present and pinned |

## R2.13 Routing and proposed decision

| Item | Owner | Due |
|---|---|---|
| PR43-SEC-11 | senior-developer / database-engineer. Preferred in this PR if a further commit lands anyway (with code review R2-m1/R2-n1), else a follow-up | before the first migration that defines a `BEGIN ATOMIC` routine merges, and before TASK-037 merges |
| PR43-SEC-12 (with code review R2-n2 c) | senior-developer | before the first `API_CASES` entry merges (TASK-027/048/049/051 lines, D-ARCH-125 (4)) |
| PR43-SEC-13 | TASK-227 / TASK-231 + qa-lead (abuse suite); principal-architect for the DB-level guard | before US-083 |
| Activation conditions | qa-lead (manifest-only PR) | immediately after this PR merges; before TASK-037 |
| Open from round 1 | PR43-SEC-07 rest and SEC-10 rest (TASK-037), SEC-08 (a) (TASK-051), §6 conditions (TASK-037/049) | as in §8 |

Proposed decision text for the orchestrator (not edited here):
- **D-SEC-PR43-05.** PR #43 security round 2 (delta after fix cycle 1, union with PR #40) at `585f163` = **PASS_WITH_FOLLOW-UPS**. No Critical, High or Medium is open, so merge is allowed on security grounds.
  - **Closed:** C1 = PR43-SEC-03, C2 = PR43-SEC-01, PR43-SEC-02, -04, -05 (a)-(d), -06 (a)-(d) (keyword-split DO-body EXECUTE remains the stated limit), -07 parameter-ACL part, -08 (b)-(d), -09 (a)/(b), -10 schema-scope catalog half (with PR11-SEC-11 e catalog half). Routings to TASK-037 / TASK-051 accepted.
  - **New:** PR43-SEC-11 LOW (code review R2-m1 extended by a bare label `case` and the in-block `begin atomic` alias; the previous-token fix is insufficient; structural fix per record §R2.6). PR43-SEC-12 LOW (`positiveStatus` unconstrained). PR43-SEC-13 INFO (membership writes carry the consent property). Owners and dues as in §R2.13.
  - **D-SEC-PR43-04 adjusted:** activation through the manifest-only follow-up (D-ORCH-071), with the four conditions of §R2.11.
  - **Unions:** a later merge of `main` that changes no PR-owned path keeps this record (sim S7). The #44 idle-timeout edit of `cross-tenant.int.test.ts`, the #39 conflicts and an `eslint.config.mjs` change each void it, and the second merger then needs a merge-only round.

## R2.14 Record validation

Simulated with `main`'s real `tools/ci/check-security-owned-paths.mjs` (tip `b6f5071`) in a `git clone --shared` whose sparse set applied (`.github/`, `docs/05-quality/security/`, `tools/ci/`). Scenario commits are built by plumbing on `585f163`, and the checker runs with `--base b6f5071 --pr 43 --json`:

| Scenario | Expected | Result |
|---|---|---|
| S0 the head as pushed (round-1 text only) | missing | missing (182 owned; round 1 names `8ac271d`) |
| S1 this record committed on `585f163` | pass | **pass**, bound to `585f163` |
| S2 same, `--pr 42` | missing | missing |
| S3 a later table whose last `Verdict` row is FAIL | missing | missing |
| S4 an owned `tools/db/` file added after the record | missing | missing (owned 183) |
| S5 a docs-only commit after the record | pass | pass |
| S6 / S6b `tests/generated/rls/fixtures.ts` / `tests/generated/api-mounts.ts` edited after the record | missing (PR43-SEC-04 closed) | missing / missing |
| S7 merge of `main` `b6f5071` after the record | pass | pass |
| S8 `eslint.config.mjs` edited after the record | missing | missing |
| S9 the PR #44 union edit of `cross-tenant.int.test.ts:549` after the record | missing | missing |
| S10 round 2 without its own final Verdict row (procedural control) | passes on round 1's row | pass (procedural, see below) |
| S11 the round-1 text alone committed on the head | missing | missing |

S10 passes because round 1's `| **Verdict** |` row is then the last one. Each round must therefore end with its own Verdict row, as this one does (PR10-SEC-04, procedural). The record has two `Head` rows, `8ac271d` (round 1, which now produces only a note) and `585f163`, and its last `Verdict` row is this round's. The file is LF-only (0 CR bytes). Round 1's text is unchanged apart from one added §7 row and one sentence after that table.

## R2.15 Hygiene

- **Record content.** No secret values, no host paths and no OS user name; SHAs, run ids and repository paths only.
- **Scans of this file.** The count-only host-fragment scan (the 12 labels of §R2.2) and the secret-shape scan both give 0. The secret-shape scan covers AWS key id, GitHub token, private-key header, JWT, password assignment and e-mail address, with a control in which every shape fires. The Gitleaks default rule set (v8.30.1, emulated in Node; 221 of 222 rules compiled; three runtime positive controls fired) finds 0 hits in the appended lines and in the whole file. Lane A scans it on commit.
- **Scratch.** Probes ran in session scratch. The one `node_modules` junction was removed by unlinking, and the main checkout's `node_modules` count is unchanged (740).
- **PR worktree.** It received only this file, appended with the editor tools and normalised to LF; no build or test command ran there.

## R2.16 Verdict (round 2)

| Field | Value |
|---|---|
| Critical / High / Medium open | 0 / 0 / 0 |
| Closed this round | C1 = PR43-SEC-03; C2 = PR43-SEC-01; PR43-SEC-02, 04, 05 (a)-(d), 06 (a)-(d); PR43-SEC-07, 08 and 09 for the parts claimed (rest routed and accepted); PR43-SEC-10 schema-scope catalog half and PR11-SEC-11 (e) catalog half |
| New | PR43-SEC-11 LOW, PR43-SEC-12 LOW, PR43-SEC-13 INFO |
| Still open from round 1 | PR43-SEC-07 rest, 08 (a), 10 rest (INFO; TASK-037 / TASK-051); §6 DR-A14 conditions for TASK-037/049 |
| Conditions | None for this merge. Follow-ups and the adjusted activation conditions per §R2.11 and §R2.13 |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is open for this change, and the round-1 merge conditions C1 and C2 are closed. This round binds `585f163`; a later docs-only commit keeps it, while an owned-path change or a union that edits an owned path (#44, #39, #42) needs a merge-only round |
