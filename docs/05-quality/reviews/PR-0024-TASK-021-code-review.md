# Code review: PR #24, TASK-021 audit store SQL (bootstrap lane), round 1

| Field | Value |
|---|---|
| PR | #24 `feat/TASK-021-audit-store-sql-partitioned-audit` |
| Head reviewed | `6f498c41169bc098a0d7a5a028d72ce000cdf062` (merge of `4fcf55c` with main `6ac9836`) |
| Current main | `84d9299` (includes PR #21 `62e4961`); the PR has **not** merged it yet |
| Reviewer | code-reviewer, 2026-11-13 |
| Scope | 85 files, +4251/-1222: `prisma/bootstrap/{10-audit,90-audit-ddl-guard}.sql`, readiness checks, `mapDbError`, `prisma.config.ts` (external tables, initShadowDb), shadow-init renderer, rule-11 DO-body reader, rule-12 `U&`, table-class `immutable`, SPK-08 port-then-delete |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: Solid, well-tested audit store: the identity tests, the catalogue-based readiness, the shadow renderer and the
         port-then-delete are correct and match data-model §5.1-§5.3/§7.3. Two MAJORs block the merge. (1) The PR #21
         union is not a pure union: the merged tree fails openapi:types --check and 4 api contract tests (proved).
         (2) The guard misses one pg_type squat, the multirange_type_name side effect (proved on PG 17.5). It must be
         fixed before 90-audit-ddl-guard.sql becomes immutable.
```

## 1. Verification performed

The constraints were D-ORCH-010: no Docker, integration, e2e or coverage runs. The worktree stayed read-only. All probes ran on `git archive` extracts in the scratchpad, with node_modules junctions; the extracts were removed afterwards.

| Check | Result |
|---|---|
| Targeted unit tests, head copy: `tools/db/{lint-migrations,shadow-init,audit-external-tables,table-classes,bootstrap,grants-manifest}`, `tools/lint/tenant-context-exemptions`, `apps/api/src/platform/{db/map-db-error,db/runtime,health,runtime}`, `apps/worker/src/platform/health` | 15 suites, **325 passed** |
| Prettier `--check` on every changed `.ts/.mjs/.json/.yaml/.md` file | clean |
| `git merge-tree --write-tree 6f498c4 84d9299` | tree `5dc2f07`, no textual conflict. Files changed on both sides: `openapi.yaml`, `eslint.config.mjs` |
| Merged tree: `tools/openapi/types.ts --check` | **exit 1, `types.gen.ts` stale** (R1-M1 a) |
| Merged tree: `tools/openapi/lint.mjs` (Redocly + `missing-traceability`) | exit 0 (8 warnings that already exist on main) |
| Merged tree, after regenerating types: unit `tools/openapi/**` + `apps/api/src/platform/{runtime,health}` | 9 suites, 85 passed (drift, contract, types-drift, router, services, audit checks) |
| Merged tree: api project `tests/api/contract-validation.api.test.ts` | **4 failed / 11**: `TypeError: readiness check criticality does not match the schema: audit_partitions` (R1-M1 b) |
| Merged tree, with the R1-M1 fix applied + audit_partitions `unavailable`/`degraded` variants | 12/12 pass. **Negative control:** with the enum change removed, the validator rejects `/body/components/audit_partitions: must be equal to one of the allowed values (allowed: ["ok","degraded"])` |
| Merged tree: `tenant-context-exemptions` + `root-scripts` | 17 passed; the merged `eslint.config.mjs` has no `spk08` entry |
| **Guard probes on PGlite 0.4.3 (PostgreSQL 17.5)**: the PR's lane 00→90 applied as written, except `uuidv7()`→`gen_random_uuid()` (PG 18 only), the extension lines dropped, and psql variables substituted (`NULL` passwords) | lane applies; `ensure_audit_partitions(3)` creates 2026_11..2027_02. Results in §3 (R1-M2) |
| Same harness with the proposed R1-M2 fix | the bypass is closed; the sanity table, `ensure(12)` and every other probe are unchanged |
| PG 18 source (`REL_18_STABLE` utility.c, typecmds.c) | `T_CreateRangeStmt` collects only the address `DefineRange` returns (the range type); the multirange is created as a side effect |
| rule-11 DO reader probe (`doBlockLockTimeouts`, 16 forms) | correct for SET/RESET/SET SESSION/set_config (local `true` skipped, any other `is_local` counted), EXECUTE literals, IF/ELSIF/CASE/EXCEPTION, labels, `DO LANGUAGE`. **Fails open at nesting depth > 4** (R1-n1). Timing is quadratic but negligible (42 KB adversarial input = 0.25 s) |
| CI run 43357618208 | fast-lane green; scans/ci-gate red **only** at "Security-owned paths need a review record" (expected until the security record exists) |

Not re-run, so I relied on the developer's gate table (head 6f498c4): integration 213 passed / 1 skipped, coverage 97.89 % lines / 97.01 % branches, build, typecheck, full lint. All of them must be re-run on the merge-main head (§7).

## 2. Findings

| ID | Sev | Location | Issue | Required fix |
|---|---|---|---|---|
| **R1-M1** | MAJOR | merge with main `84d9299` (PR #21) | The merge is textually clean but semantically broken. (a) `packages/shared/src/api/types.gen.ts` is stale: `openapi:types --check` exits 1 (diff: `audit_partitions: 'ok' \| 'degraded' \| 'unavailable'` plus the description). (b) `tests/api/contract-validation.api.test.ts:24` keeps a local `CRITICAL = ['database','redis','object_storage']`, so `assertReadinessChecks` throws and 4 of 11 api tests fail. (c) `openapi.yaml:15503`, the `getReadiness` description, still says "audit partitions and chain verification report degraded without failing". Squash-merging the current head would turn main red. | In the merge commit: `npm run openapi:types`. In the contract test, replace the local list with `isCriticalComponent` from `readiness.ts` (single source), and add an `audit_partitions` 503 `unavailable` variant and a 200 `degraded` variant (the check resolves `'degraded'`). This is verified green on the copy, and the negative control proves the validator enforces the enum. Reword the `getReadiness` description to the three-state rule. No operation is added or changed, so `x-requirements`/`x-milestone`/`x-moscow` and the drift check are unaffected. |
| **R1-M2** | MAJOR | `prisma/bootstrap/90-audit-ddl-guard.sql:52-62` (type branch) | **Layer-1 squat bypass.** As `platform_migrator`, `CREATE TYPE public.zz_r AS RANGE (subtype = int4, multirange_type_name = public.audit_entries_2027_05)` is **accepted by the guard**. `ddl_command_end` reports only the range type `zz_r`, and its own name does not match. The multirange `audit_entries_2027_05` (`typtype 'm'`, `typrelid 0`) now squats the partition name. The same works in `platform`, and it survives a later `ALTER TYPE zz_r OWNER TO …`. Layers 2 and 3 hold: readiness reports a `type` squat row and `ensure_audit_partitions(12)` raises `AUDIT_PARTITION_NAME_TAKEN`. But the PR claim ("no relation or type can squat a partition name") and the sheet's "every pg_type kind" are false. With decision 1, a single statement by the migrator credential takes every API and worker instance to 503. The 8 other side-effect forms I probed are refused: ALTER/ADD/inline identity sequences, ADD CONSTRAINT UNIQUE (the PR12-SEC-02-a fix), inline EXCLUDE, multirange rename, sequence rename and shell type. | Add a post-loop invariant to the `ddl_command_end` branch. It catches every side-effect object, not just this one. Verified on PGlite: it closes P1, P1b and P11 and leaves the 8 refusals, the sanity DDL and `ensure(12)` unchanged: `IF EXISTS (SELECT FROM pg_catalog.pg_class c WHERE c.relnamespace = ANY (v_ns) AND c.relname ~ c_tbl AND c.relowner <> v_owner) OR EXISTS (SELECT FROM pg_catalog.pg_type t WHERE t.typnamespace = ANY (v_ns) AND t.typname ~ c_tbl AND t.typowner <> v_owner) THEN RAISE … 42501`. A narrower alternative is a `pg_range.rngmultitypid` name check in the type branch. Add `range_multirange: [[], 'CREATE TYPE public.squat_range AS RANGE (subtype = integer, multirange_type_name = public.{name})']` to `IMPLICIT` (`audit-owner.int.test.ts:~587`) with `KNOWN_GUARD_GAP = []`, plus the `platform` schema variant in `KINDS`. **This must be done before merge.** Today the file is new and is edited in place (as decision 3 did). After merge, any change needs a new NN file with the §5.2 "Changing the guard later" DISABLE → replace → ENABLE ceremony. |
| R1-m1 | MINOR | `docs/01-requirements/stories/EPIC-01-platform-foundation.md:478`; decision 1 | AT-US-012-04 reads "Given the **next** audit partition is missing → 200, degraded". In the implementation, current + 1 missing gives 503 `unavailable` (data-model §5.3 item 3), and only current + 3 gives `degraded`. The traceability row claims AT-US-012-04 with a different meaning. | Product-manager amends the AT wording (for example "the last pre-created partition (current + 3) is missing") in the same ruling as the architect's ratification of decision 1. The architect should also weigh this: a squat **outside** [current, current + 2] makes the whole fleet unready today, although writes are unaffected until that month. Recommendation: event + `degraded` for out-of-window squats. A squat inside the window already appears as a missing month, so it is `unavailable` anyway. |
| R1-m2 | MINOR | `apps/api/src/platform/db/runtime.ts:266-275`; `map-db-error.ts` `DbSecurityEvent` | `security.audit_partition_squatted` is an ad-hoc `log.warn`. D-ORCH-025 puts runtime database security events at `error`, because they are fail-closed signals that must alert. **PR #20 union:** its compile-time exhaustiveness check (`apps/api/src/platform/logging/security-events.test.ts:57`, `Exclude<… \| DbSecurityEvent, RuntimeSecurityEventName>`) fails to type-check once `DbSecurityEvent` gains `audit_mutation_rejected`/`audit_partition_squatted`. PR #20's `SECURITY_EVENT_FIELDS` for runtime events is `['sql_state']` only, so `name`/`kind`/`reason` would be dropped. | In this PR: log at `error`. Second merger (D-ORCH-022): add both events to `RUNTIME_SECURITY_EVENTS` and `SECURITY_EVENT_LEVEL` (`error`), allow-list the squat fields (`name`, `kind`, `reason`; never an owner), and route the squat through `securityEventSinkFrom(log)`, not `log.warn`. A merge-only security round applies. |
| R1-m3 | MINOR (routed) | `tools/ci/check-migration-immutability.mjs` (covers `prisma/migrations` only) | Bootstrap-lane immutability is enforced only by the runtime ledger sha. CI always bootstraps fresh databases, so it never sees a changed file. After merge, an in-place edit of `10-audit.sql`/`90-audit-ddl-guard.sql` passes every gate and fails only at the first deploy against an existing database. The gap already exists for 00–02, but it now covers security-critical SQL. | Route to TASK-015 (CI owner): extend the base-vs-head immutability check to `prisma/bootstrap/*.sql` (added files allowed; modified or deleted files refused). |
| R1-n1 | NIT | `tools/db/lint-migrations.ts:305,371` | The DO reader stops at `MAX_DYNAMIC_DEPTH = 4` and returns nothing deeper. Probe: `DO … EXECUTE $a$ DO $b$ … EXECUTE $c$ DO $d$ … SET lock_timeout = '10s' …` gives `[]`, while 2 levels give `set`. This limit is not in the header's "Stated limits". | At the depth limit, push `{ kind: 'set', value: <literal> }` when the literal matches `/lock_timeout/i` (fail closed), or list the limit in the header. |
| R1-n2 | NIT | `apps/api/src/platform/runtime/readiness.ts:~227` | `pendingCheck('audit_partitions')` now **passes** (critical stub → `ok`), which reverses PR9-SEC-11 ("an unverified audit … must never read healthy") for that component. It is still used by `apps/api/src/platform/health/health.int.test.ts:84`. | Throw in `pendingCheck` for `audit_*` (the real checks exist), and update the int test fixture. |
| R1-n3 | NIT | `90-audit-ddl-guard.sql:72-75` (decision 2) | The comment says the branch "admits only the no-op re-assertion". It admits every schema command that ends in the bootstrap state. The probe shows `COMMENT ON SCHEMA public IS NULL` is accepted for the superuser. This is harmless, because only the superuser or the NOLOGIN schema owner can issue it. | Reword the comment (it can be folded into the R1-M2 edit). |
| R1-n4 | NIT | `apps/api/src/platform/health/checks/catalog-reader.ts:20-37` | `intervalCache` caches a successful load whose evaluation is `unavailable` for 60 s. Readiness therefore stays 503 for up to a minute after the daily job repairs a missing month (the PR #9 M1 lesson: do not keep failing results sticky). | Cache only `ok`/`degraded` evaluations, or use a short TTL for `unavailable`. |
| R1-n5 | NIT | commits `7834d67` / `4fcf55c` | The sheet asks for "port and delete IN THE SAME COMMIT". The shadow port landed one commit before the deletion. A squash merge satisfies the requirement. | Squash merge (merge condition). |
| R1-n6 | NIT (routed) | root `prisma.config.ts` | Every Prisma command now imports `tools/db/{audit-external-tables,shadow-init,sql-text}.ts` and reads `prisma/bootstrap/*.sql` at config load. | TASK-014: the migrate/seed image and the compose job must ship those files (no Dockerfile exists yet). |
| R1-n7 | NIT | `lint-migrations.ts` header "Stated limits" | Rule 11 does not see a function created in the file whose body sets `lock_timeout` and that is then called (`SELECT f()`). | Add it to the stated limits (TASK-024 setter-key half). |

## 3. R1-M2 probe table (PGlite 17.5, the PR's lane, as `platform_migrator` unless noted)

| Probe | Guard | Readiness squat rows | `ensure(12)` |
|---|---|---|---|
| sanity `CREATE TABLE public.zz_ok (id int PRIMARY KEY)` | accepted | none | ok |
| **P1 `CREATE TYPE … AS RANGE (… multirange_type_name = public.audit_entries_2027_05)`** | **accepted** | `{name: audit_entries_2027_05, kind: type}` | `AUDIT_PARTITION_NAME_TAKEN` |
| **P1b same in `platform`** | **accepted** | n/a (public only) | n/a |
| **P11 P1 + `ALTER TYPE zz_r OWNER TO platform_migrator`** | **accepted** | type row | NAME_TAKEN |
| P2 `ALTER … ADD GENERATED … (SEQUENCE NAME audit_entries_…)` | 42501 guard | | |
| P3 ADD COLUMN identity · P4 inline identity · P8 identity seq rename | 42501 guard | | |
| P5 `ADD CONSTRAINT audit_entries_… UNIQUE` (PR12-SEC-02-a) | 42501 guard | | |
| P10 inline `CONSTRAINT audit_entries_… EXCLUDE` | 42501 guard | | |
| P7 `ALTER TYPE zz_r_multirange RENAME TO audit_entries_…` | 42501 guard | | |
| P6 shell type | 42501 privilege (base type needs superuser) | | |
| P9 `CREATE STATISTICS audit_entries_…` | accepted, but there is no pg_class/pg_type conflict | none | ok |
| decision 2 (superuser): `ALTER SCHEMA public\|platform OWNER TO platform_schema_owner` | accepted | | |
| decision 2 (superuser): `ALTER SCHEMA public OWNER TO platform_migrator` | 42501 guard | | |
| superuser `ALTER TABLE audit_entries DISABLE TRIGGER ALL` | 42501 guard | | |

With the invariant fix, P1, P1b and P11 are refused (42501) and every other row is unchanged.

## 4. Rulings on the developer decisions (D-TASK021-01 items 1–7)

1. **`audit_partitions` critical with three states:** this is consistent with the data-model §5.3 item 3 amendment, which is binding. The implementation is correct. `degraded` from a component without it in its enum fails closed, and `DRAINING_REPORT` reports it `unavailable`. Ratification belongs to the architect, together with the PM AT-US-012-04 amendment and the out-of-window squat recommendation (R1-m1). The enum change **passes PR #21's validator** (proved, with a negative control) once R1-M1 is done.
2. **Schema branch admits the no-op OWNER TO:** accepted. Only the superuser or the NOLOGIN, member-less schema owner can reach it. A rename or any other owner still raises (probe and C14). Comment wording: R1-n3.
3. **PR12-SEC-02-a fixed in place:** accepted. Both files are **new in this PR**: main's `prisma/bootstrap` holds only 00–02, and neither file has been applied to a shared database. The runtime ledger sha enforces immutability from the first apply. The same reasoning is why R1-M2 must be fixed now. The fix also refuses later DDL on a relation that carries a squatted index, and an index named `audit_entries_*` cannot be dropped by the migrator (the `sql_drop` `c_idx` prefix). Repairing one needs the superuser under `SET ROLE platform_audit_owner`. Put this in the TASK-090 runbook.
4. **Audit files non-idempotent:** accepted (plain CREATE refuses planted objects; the ledger applies each file once).
5. **Shadow init refuses a non-empty `public`:** accepted as hardening beyond §7.3. The integration F-02 two-run test passes, so Prisma's own shadow reset satisfies it. Keep it.
6. **Any `U&` token in the bootstrap lane needs the marker:** accepted. It is the same fail-closed choice as rule 16 (`\bu&["']`, migrations lane). This **closes PR #5 R2-n1** for both lanes. E-string escapes in `EXECUTE` operands (`E'audit…'`) are a separate item, routed to TASK-024 by sheet-fold (d), and are not covered here.
7. **`security-analyst` in `audit-ddl-reviewers.json`, marker dated 2026-11-13:** accepted procedurally. The security record must name the **final** head, which includes the R1-M2 edit to `90-audit-ddl-guard.sql`, and must explicitly approve both files.

## 5. Union pre-assessment: exact steps for the merge of main (PR #21)

1. `git merge origin/main`: no textual conflicts (`openapi.yaml`, `eslint.config.mjs` auto-merge).
2. `npm run openapi:types`: regenerates `packages/shared/src/api/types.gen.ts` (+5/−2 at about :3402). Then run `openapi:types --check` to exit 0.
3. `tests/api/contract-validation.api.test.ts`: replace `CRITICAL` (:24) with `isCriticalComponent`, and add the `audit_partitions` `unavailable` (503) and `degraded` (200) variants (R1-M1 b).
4. `openapi.yaml` `getReadiness` description (:15503): the three-state wording. `x-requirements` (REQ-PLAT-018, REQ-AUDIT-013, REQ-AUDIT-017), `x-milestone` and `x-moscow` are already present, and no operation changed, so `missing-traceability` stays green (lint exit 0 on the merged tree).
5. Drift: no route change. The drift, contract and types-drift tests are green on the merged copy after step 2.
6. `eslint.config.mjs`: a clean union. The `spk08` exemption is gone and the exemption tripwire is green. Lint must still run on the merge head.
7. Re-run lint, typecheck, test:unit, test:api, build and integration on the merge head. The security record then names that head (owned paths changed).
8. PR #20 (whichever merges second): R1-m2 items. These are in addition to the PR #20 / PR #21 union already ruled in D-ORCH-024/025.

## 6. Follow-up closure

| Item | Status |
|---|---|
| PR #12 M3 / D-TASK012-02 (1) port-then-delete | **Closed.** The audit-owner suite, `spk08/{10,90}-*.sql`, `spk08/prisma.config.ts` and the ESLint exemption are deleted. The SEC-TC-43 list, F-05 planted names, sql_drop as schema owner and as superuser (PR #12 M2), F-08, the SEC-TC-61 subset, F-01 deploy, and the F-02 negative control are ported. The anchor suite stays for TASK-116. |
| PR #11 R3-n5 (exemption-file tripwire) | **Closed** (`tools/lint/tenant-context-exemptions.test.ts`). |
| PR #9 m2 / D-TASK006-02 (audit readiness stubs) | **Closed** (the tripwire was replaced by a "real checks wired" assertion; `object_storage` stays with TASK-019). |
| PR #5 R2-n1 (`U&` evades rule 12) | **Closed** for both lanes (decision 6). |
| PR #11 R3-n3 / PR11-SEC-17 c (DO half) | **Closed** with R1-n1/R1-n7. The setter-key half stays with TASK-024. |
| PR11-SEC-11 c (prefix-derived events) | **Closed** (`mapDbError` reads only the prefix; 23514 is included). |
| PR11-SEC-11 h fallback `03-role-locale.sql` | Not needed (`02-role-backstops.sql` has `lc_messages = 'C'`). |

## 7. Merge conditions

1. R1-M1 and R1-M2 fixed. Round 2 is a delta review of the fix commits plus the merge-main proof.
2. Lane A green on the final head, and integration re-run on that head (the guard changes, so `audit-owner.int.test.ts` gains the multirange row).
3. A security-analyst record naming the final head, confirming the rule-12 approval of both files, and ruling on decisions 2, 3 and 5.
4. Architect ratification of decision 1, with the PM AT-US-012-04 amendment (R1-m1), logged before merge. The contract file changes in this PR.
5. **Squash** merge (R1-n5).
6. R1-m2 fixed in-PR (log level). The PR #20 union items go on the second merger's checklist. R1-m3 is routed to TASK-015 and R1-n6 to TASK-014. The remaining NITs are optional in-PR.

## 8. Good

- The identity test and readiness are both read from the **catalogue**, never from the writable registry. They include `inhdetachpending`, multiple-inheritance duplicates (`duplicate_name`) and `typrelid = 0` types. On PGlite they caught the very squat that the guard missed. The three-layer defence works as designed.
- Pinned known-gap arrays (`KNOWN_GUARD_GAP`) with `squatThenEnsure` turn a guard gap into a visible test diff. R1-M2 slots straight into this.
- The shadow renderer is deny-by-default (strip list, keep list, refuse everything else), and string literals are blanked in previews so they are never echoed.
- `mapDbError` classifies by fixed prefix only and never copies the text. Trigger-raised 23514 is anticipated.
- Spike lifecycle discipline: one commit for the port, the deletion and the exemption removal, plus a tripwire.
