# Code review: PR #65 / TASK-037, round 1

Organisations, memberships and users with DR-A14 RLS and the standard-columns guard.

| Field | Value |
|---|---|
| Reviewer | code-reviewer |
| Date | 2026-11-18 |
| Reviewed range | `git diff origin/main...bf53c46`, with main at `36bc841` (main is now `dbbb815`, which changes docs/04-plan and docs/sdlc only, so nothing overlaps) |
| Head | `bf53c46` (local, not pushed) = PR head `d3c2c16` + 3 merges of main + fix cycle 1 (`fdfbbd8`, `1a8ca17`, `f3d3b3a`) |
| Scope | 38 files, +2151 / -39 |

## Verdict

**VERDICT: CHANGES_REQUESTED** (1 BLOCKER, 2 MAJOR, 4 MINOR, 7 NIT)

**SUMMARY**
- **The migration does not apply on PostgreSQL.** `platform.role_scope_matches_org()` puts a bare `CASE … THEN … END` inside a PL/pgSQL `IF … THEN`. PL/pgSQL stops reading the condition at the first `THEN`, so `CREATE FUNCTION` fails with 42601 and `migrate deploy` stops with P3018.
  - I reproduced this on PGlite 17.5.
  - The lane-B run in progress on `bf53c46` fails the same way (`.orch/laneb-queue/Shipqube-TASK-037.log:178-197`, every integration suite).
  - So no database test in this PR has ever run.
- **Two more tests fail once B1 is fixed.** Each was proven with a probe that patches B1 and applies all the migrations:
  - The C11 helper expectation was never adapted, although the card requires it (M1).
  - The AT-US-061-03 database test trips a CHECK before the trigger it means to prove (M2).
- **The design follows the card and the rulings.**
  - The reserved OPERATOR row is placed correctly and the rewritten AT-US-061-02 test proves the right thing.
  - The templates are copied verbatim, the RLS blocks are rendered, and the linter is clean.
  - The merges are pure.
  - The MINOR findings are tenant-integrity backstops worth closing while the migration is still mutable.

## 1. What I verified myself

Host rule: no npm, Jest, typecheck, build or Docker. I used static reading plus single-process Node probes on a `git archive` extract of `bf53c46`, with a `node_modules` junction to the worktree. I did not modify the worktree.

| Check | Result |
|---|---|
| Merge purity | `git diff origin/main bf53c46` equals `git diff origin/main...bf53c46` (same md5). All 3 merges (`664adec`, `694c8f7`, `bf53c46`) are byte-identical to `git merge-tree --write-tree` of their parents: no conflicts and no hand edits. |
| TASK-290 union (`tools/db/lint-migrations.ts`) | The PR's delta is one line (`COVERING_INDEX_TOLERANCE` gains `ix_memberships__user_status`). TASK-290's splitter is intact. `tsx tools/db/lint-migrations.ts` on the extract gives "no findings", and the Prisma schema validates. |
| Templates verbatim | `app-is-operator.sql` and `std-columns-guard.sql` are contained byte-for-byte in the migration (CR-normalised). |
| Prettier | `prettier --check` on every changed ts/json/md file: clean. |
| Migration on PGlite 17.5 (bootstrap 00-02 + every migration as `platform_migrator`, `uuidv7()` replaced by `gen_random_uuid()`) | The head **fails** at `role_scope_matches_org()` (42601). With only that `CASE` parenthesised, the whole file applies. |
| Probes on the patched migration | See the table below. |
| Lane A | The PR head `d3c2c16` shows fast-lane and ci-gate FAILURE. `bf53c46` has never been pushed, so no lane A has run on it. |
| Lane B | A run on `bf53c46` is in progress. Its log shows P3018 / 42601 "syntax error at end of input" (position 710) and every integration suite FAILING at template migrate. |
| Open-PR overlap (P1) | #58 (lock and package.json), #50, #49 and #16 share no file with this PR. 287-B is not a PR yet. |

| Probe (patched migration, platform_app with the production context keys) | Observed |
|---|---|
| AT-US-061-02: OPERATOR insert in the context of a fresh org id | `23505 ux_organisations__single_operator` (as the test expects) |
| AT-US-061-03 as tested: BUSINESS_CUSTOMER → INDIVIDUAL | `23514 ck_organisations__personal_owner`, **not** P0001 (M2) |
| AT-US-061-03: BUSINESS_CUSTOMER → PARTNER | `P0001 ORG_TYPE_IMMUTABLE` |
| AT-US-062-02 / 062-03 / SEC-TC-74 forged creator, forged version, re-parent | P0001 ROLE_NOT_ALLOWED / ok; 23505; P0001 created_by; P0001 version; 42501 RLS (all as the tests expect) |
| C11 helpers query on the committed state | `app_actor_id()` EXECUTE = [platform_app, **platform_definer**, platform_migrator]. A **4th** row `app_is_operator()` matches `LIKE 'app\_%'` (M1). |
| membership_roles row in A pointing at B's membership | `ok`: not refused (m1) |
| Multi-org actor (ACTIVE in A and B), A context, insert `org_id = B` | `42501 new row violates row-level security policy`: the trigger passes and WITH CHECK decides (m2) |
| Single-org actor, same insert | `P0001 ROLE_NOT_ALLOWED_FOR_ORG_TYPE` (the D-TASK037-14 expectation holds) |
| Personal org: re-point `personal_owner_user_id` to a visible DEACTIVATED user and set `deleted_at` in one UPDATE | `ok`: the row is deleted while its real owner is ACTIVE (m3) |
| A context: insert an ACTIVE membership for an arbitrary existing user id | `ok` (security flag S1) |

**Not re-run:** lint, typecheck, unit, build, coverage, integration and generated suites (host rule). For those, the evidence is the lane-B run once B1, M1 and M2 are fixed. No database test of this PR has ever executed, so treat the next lane-B run as the first evidence, not a confirmation.

Probe scripts are in the session scratchpad: `pr65/probe/probe0.mts` (minimal 42601 reproduction), `probe1.mts`, `probe2.mts`, `probe3.mts` and `probe4.mts`.

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| **R1-B1** | **BLOCKER** | `prisma/migrations/20261117000000_organisations_identity/migration.sql:349-350` | `IF v_type IS NULL OR … IS DISTINCT FROM CASE v_type WHEN 'OPERATOR' THEN … END THEN`. PL/pgSQL reads an `IF` condition up to the first `THEN` at parenthesis depth 0 and does not track `CASE`. The condition becomes `… CASE v_type WHEN 'OPERATOR'`, so `CREATE FUNCTION` fails with 42601 (check_function_bodies is on) and `migrate deploy` fails with P3018. Every migrated template, every integration, catalog, generated and API suite, `compose up` and the up-down-up check all fail. The linter cannot see this: it is not a PL/pgSQL parser. Proven by `probe0.mts` (bare CASE: 42601; parenthesised: created) and by lane B on `bf53c46`. | Parenthesise the CASE: `IS DISTINCT FROM (CASE … END) THEN`. Alternatively, assign the expected scope to a variable first. After the edit, run at least the `migrations` and `catalog-c1-c14` suites before hand-over: the PR went to review without its migration ever being applied. |
| **R1-M1** | **MAJOR** | `prisma/tests/catalog/c01-c12.int.test.ts:934-941` | The card's catalog adaptation of C11 is missing. The card says "C11 expects `platform.app_actor_id()` EXECUTE for platform_app, platform_migrator AND platform_definer, and `app_is_operator()` owned by platform_definer, SECURITY DEFINER, fixed search_path, EXECUTE for platform_app only". The helper assertion still expects 3 rows with `execute: [platform_app, platform_migrator]`. On the committed schema, the migration's `GRANT EXECUTE ON FUNCTION platform.app_actor_id() TO platform_definer` adds `platform_definer`. The query's `LIKE 'app\_%'` also returns `platform.app_is_operator()` (owner platform_definer, prosecdef, proconfig set). So `C11 [SEC-TC-05]` fails as soon as R1-B1 is fixed (probe4). | Update the helper expectation: `app_actor_id()` gets execute `[platform_app, platform_definer, platform_migrator]`, and `app_is_operator()` is either excluded from the helper list (it is asserted by the definer allow-list) or asserted with its own definer shape. Keep the other two helpers exactly as they are. |
| **R1-M2** | **MAJOR** | `prisma/tests/organisations/organisations.int.test.ts:291-301` | The database half of `[AT-US-061-03]` changes `BUSINESS_CUSTOMER → INDIVIDUAL` on an organisation with no personal owner. `ck_organisations__personal_owner` runs in `ExecConstraints` before any AFTER trigger, so the statement fails with 23514, not with the `P0001 ORG_TYPE_IMMUTABLE` the test expects. As written, the test fails and does not prove the trigger (probe3: INDIVIDUAL gives 23514, PARTNER gives P0001). | Prove the trigger with a change that satisfies every CHECK (BUSINESS_CUSTOMER → PARTNER, plus OPERATOR → BUSINESS_CUSTOMER on the reserved row). If you keep INDIVIDUAL, keep it as a separate case expecting 23514. Add a mutant check by hand: dropping `trg_organisations__type_immutable` must turn the PARTNER case into `ok`. |
| R1-m1 | MINOR | `apps/api/src/modules/organisations/service/organisation-service.ts:91-95`; `repository/organisation-repository.ts:125-126`; `migration.sql:129,137-139` | **Ids that point into another tenant are not bound to the row's tenant.** (a) `assignRole` takes `membershipId` and `orgId` from the caller and checks neither against the transaction's organisation. The port JSDoc says "A role of a membership of the context organisation", but nothing enforces it. `organisationType(orgId)` reads any *visible* organisation (`member_read`), while the row is stamped with the context organisation. (b) In the database, `membership_roles(org_id = A, membership_id = <B's membership>)` is accepted (probe1 #1), because RI checks bypass RLS. The forged row is invisible to B, but any later query that counts roles by `org_id` and joins memberships without `m.org_id = mr.org_id` (LAST_OWNER, AP-ORG-04 owner cap) sees it. ADR-0005: "a crafted foreign ID is invisible under RLS, so the API answers 404". | In this PR: `assignRole` takes the organisation from the transaction context (or asserts equality) and resolves the membership with an explicit `orgId` filter (`findFirst({ where: { id, orgId } })`; `p_memberships__own_read` shows the actor's memberships in other orgs), then refuses a miss as not found. Add a unit case. Architect, before this migration becomes immutable: data-model P12 composite FKs, i.e. `UNIQUE (org_id, id)` on memberships plus `(org_id, membership_id) → memberships(org_id, id)`, and the same for `memberships.invitation_id` → invitations. |
| R1-m2 | MINOR | `tests/generated/rls/generator.ts:213-216`, `fixtures.ts:219-222` | **D-TASK037-14 is accepted, but WITH CHECK on `membership_roles` and `invitations` is now proven by no executing test.** Their `insert-foreign-key` and `reparent-own-row` cases expect the role-scope trigger's P0001, which fires before WITH CHECK. For an actor who is a member of B, the trigger passes and WITH CHECK is the only control (probe1 #2: 42501 RLS). The policy text is pinned statically (rule 9 renderer equality, C3 derived set), but not its effect. | Add one case per guarded table to `organisations.int.test.ts` using `world()`'s `userA`, who is already ACTIVE in A and B. From A's context, insert with `org_id = B` and re-parent an A row to B; each must give 42501 with the RLS marker. The suggested alternative (suppressing triggers) is not needed. |
| R1-m3 | MINOR | `migration.sql:325-327` | `organisations_personal_delete_guard()` checks the owner in `NEW.personal_owner_user_id`. One UPDATE that re-points the owner to a visible DEACTIVATED (or deleted) user and sets `deleted_at` passes, and deletes the personal organisation of an ACTIVE user (probe2). This needs raw platform_app SQL (a service bug), so it weakens a backstop and is not an exploit. | Check `OLD.personal_owner_user_id`, or refuse every change of `personal_owner_user_id` (immutable, like `type`). Add the probe as a negative case. |
| R1-m4 | MINOR (routed) | `tools/quality/required-suites.json:51` | `SEC-TC-74` is still in `required_cases_pending.catalog-c1-c14`. The card calls the SEC-TC-74 matrix a merge condition of this PR. D-SEC-PR47-01 (1)/(2) and D-ORCH-092 moved it to `required_cases` "before TASK-037 takes evidence". Until then, deleting every `[SEC-TC-74]` test still passes the evidence verifier. | Orchestrator / qa-lead: land the manifest-only move before this PR's credited lane-B run, or record why not. This is not a developer fix (code-owned tooling input). |
| R1-n1 | NIT | `migration.sql:358-359` | `trg_invitations__role_scope` reuses the type → scope mapping, so an OPERATOR-scope invitation in the OPERATOR organisation passes. data-model §3.2 says invitations hold "customer roles only". | Architect: either reword the data-model or decide on a stricter trigger with TASK-227. |
| R1-n2 | NIT | `policies/organisation-rules.ts:106-109`, `service/organisation-service.ts:74` | `.slice(0, 120)` counts UTF-16 units and can split a surrogate pair. pg then stores U+FFFD. There is no re-trim after the slice. The business create path trims but does not NFC-normalise, unlike the personal path. | Slice by code points (`Array.from`) and use the same normalisation on both paths. |
| R1-n3 | NIT | `service/organisation-service.ts:32` | A role key that is valid in `ROLES` but missing from the `roles` table (seed drift) becomes 422 `ROLE_NOT_ALLOWED_FOR_ORG_TYPE`. It is a server fault. | Throw an internal error (500). |
| R1-n4 | NIT | `organisations.int.test.ts:383-389` | The forced-OPERATOR C12 case uses a random actor with no membership. The card says "a customer". | Use a customer who is ACTIVE in A only (not `userA`, who is also in B). |
| R1-n5 | NIT | `apps/api/src/platform/db/extensions/standard-columns.ts:47-50` | `TENANT_KEY_MODELS` is a hand list keyed by Prisma model name. A future model keyed on `id` silently gets a fresh UUIDv7. RLS then refuses the row, so it fails closed. | Add a parity test against the manifests (isolation key `id` / USER_OWNED). |
| R1-n6 | NIT | developer report (D-TASK037-16) | The report says "87 columns". The registry adds 85: users 25, organisations 15, memberships 14, membership_roles 12, invitations 19. | Correct the wording. C10 is the real check. |
| R1-n7 | NIT | `packages/shared/src/logging/string-redaction.ts:134` | `'timezone'` is a substring part, so any log key containing it (for example `timezoneOffset`) is redacted. That fails closed and is accepted. | None. Noted for the logging owner. |

## 3. Rulings on the developer decisions

| Decision | Ruling |
|---|---|
| D-TASK037-06 (`app_is_operator()` before the RLS blocks) | **Accepted.** `CREATE POLICY` resolves the function when it is created, so the template's "after the blocks" order cannot run. The function runs as platform_definer through the definer-read policies granted later in the same file. No prefix exposes anything (the tables have no runtime grant until the end). |
| 08 (`MEMBERSHIP_STATUS_NOT_WRITABLE` internal-only, mapped to INTERNAL_ERROR; refusal codes `satisfies readonly ErrorCode[]`) | **Accepted.** The unit test pins the catalogue status (422), the INTERNAL_ERROR mapping and the README §11 row. This closes the PR #63 R1-m2 cross-PR item for this module. |
| 09 (reserved id repeated as a literal in prisma/tests) | **Accepted.** Precedent: `prisma/tests/rls/standard-columns.int.test.ts:26`. The unit test ties the migration row to `OPERATOR_ORG_ID`, and the integration test ties the migrated row to the literal. |
| 10 (`ROW_OVERRIDES.organisations.type = BUSINESS_CUSTOMER`) | **Accepted.** It is required by the occupied single-operator index and also satisfies `ck_organisations__personal_owner`. |
| 11 (TenantDb surface gains the 5 models) | **Accepted.** |
| 12 (branch `task-037-fc1`, fast-forwarded) | **Accepted.** `bf53c46` contains `fdfbbd8`, `1a8ca17` and `f3d3b3a` on its first-parent line, and the merges are pure. |
| 13 (lowercase synthetic text) | **Accepted.** The tags stay distinct and a unit test pins it. |
| 14 (`roleScopeGuard` trait) | **Accepted, with R1-m2.** The expectation is correct for a single-org actor (probe1 #3). The trigger list is pinned against the migrations and against live triggers. Add the direct WITH CHECK cases. |
| 15 (CUSTOMER_VIEWER literal pinned against the authz seed) | **Accepted.** |
| 16 (C10 classifications; `timezone` in PII_KEY_PARTS) | **Accepted.** The classes match data-model §3.1/§3.2 (`time_zone` PER, `token_hash` SEC). See R1-n6 and R1-n7. |

The other review targets in the dispatch:
- **Reserved OPERATOR row.** It is placed directly after the reserved users, after `ux_organisations__single_operator` and before the first `ENABLE ROW LEVEL SECURITY`. The statement is identical to rulings §2.3, and a unit test pins its order and values.
- **Rewritten AT-US-061-02.** It matches ruling 2.4 item 4. The probe confirms 23505 for platform_app in the context of a fresh org id. The superuser path under `replica` is still refused by the unique index.
- **AT-US-061-01.** It asserts exactly one row, the reserved id, the SYSTEM actor, version 1, no member, and an unchanged xmin and count after two reference-seed runs.
- **Fixtures.** No fixture plants an OPERATOR organisation (`plantProbe` committed branch and the SEC-TC-06 control both use `OPERATOR_ORG_ID`).
- **TASK-290 prerequisite.** No BEGIN ATOMIC routine and no bootstrap file are added (header line 19, verified).
- **PR #43 R1-m3 (probe.ts 42P07).** Closed on main: `PROBE_ENTRIES` drops committed DR-A14 tables.
- **PR #26 m2 (relation-form connect on update).** Closed by PR #26's deny-by-default refusal of relation fields. The new `@relation(fields: [orgId])` fields cannot be written through the extension.
- **Indexes.** They follow AP-ORG-02..13, and every tenant index leads with `org_id`. There is no N+1: each service operation makes 3-4 single-row statements.

## 4. Security flags (for the security analyst)

- **S1.** In the context of org A, platform_app can insert an ACTIVE membership for any existing user id (the FK bypasses RLS). `p_users__org_member_read` then exposes that user's profile row (email, display_name) to org A. This is the D-ARCH-123 concern, which was raised for INVITED; with ACTIVE it is equally reachable at the database level, and only the service layer (registration, invitation acceptance) prevents it. Decide whether a database binding is wanted, for example a trigger that requires `user_id = app_actor_id()` or an accepted invitation, or record the residual.
- **S2.** R1-m1 (cross-tenant references by id) and R1-m3 (personal-org guard reads NEW).
- **S3.** The merge condition PR11-SEC-10 and PR26-SEC-03 sign-off on the rendered DR-A14 policies and the guard still stands. No sign-off is possible on evidence until R1-B1 is fixed, because the policies have never existed in a database.

## 5. Good

- The rulings were applied exactly: the reserved row, `OPERATOR_ORG_ID` next to the actor ids, and a pin from the constant to the migration text.
- Fail-closed choices are documented where they are made: the personal-delete guard treats an invisible owner as active, and the role-scope trigger refuses when it cannot see the org or the role.
- `ROLE_SCOPE_GUARDS` is checked both ways: against the migrations text (with a count of all `EXECUTE FUNCTION` uses) and against the live triggers.
- The refusal codes are typed against `ErrorCode`, and a test pins the internal-only code to the README row.
- All three merges are clean, and the PR's own delta on the shared linter is one line.

## 6. Merge conditions

1. Fix R1-B1, R1-M1 and R1-M2 in-branch. R1-m1(a), R1-m2 and R1-m3 are cheap and should go in the same cycle. R1-m1(b) needs an architect decision before merge, because the migration is immutable afterwards.
2. A full lane-B PASS on the final head. It is the first execution of this PR's database tests, so expect more failures. Every integration, catalog-c1-c14, generated rls-cross-tenant and migrations (up-down-up) suite must pass.
3. A full lane-A run on the pushed head, with lint, format, typecheck, unit and build actually executed (not skipped).
4. R1-m4: SEC-TC-74 moved into `catalog-c1-c14.required_cases` before the credited lane-B run.
5. The security-analyst sign-off on the DR-A14 policies and the standard-columns guard (card MERGE CONDITION), on that evidence.
6. Squash merge.

Round 2: delta review of the fix commits, re-running probe0 to probe4 against the new head.
