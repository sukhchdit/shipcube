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


---

## Round 2 (head 7662672)

| Field | Value |
|---|---|
| Head reviewed | `766267223e2adba6e29c14d5e34c9c86dec3128c` (merge of fix commit `5020ac6` with main `ccc1082`) |
| Delta since r1 (`6f498c4`) | merge `1fb76c1` (main `6fd801f`, includes PR #21) · `2318e55` guard invariant + tests · `3fd85d0` readiness SQL / squat event / cache / pendingCheck · `362f9f2` rule 11 · `5020ac6` contract union · merge `7662672` (main `ccc1082`: PRs #23, #25, docs) |
| Reviewer | code-reviewer, 2026-11-13 |
| Inputs | developer comment `#issuecomment-6846588883`; D-ARCH-081; D-SEC-PR24-01; D-ORCH-029/034 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Both r1 MAJORs are closed and proved. The post-state invariant refuses every squat form I have (P1/P1b/P1c/P1d
         multirange, L3-L5 SET SCHEMA, procedure/aggregate plants), the base guard accepts the same probes (negative
         control), and all controls still pass. The readiness SQL now resists the operator plants, and rule 11 only
         gets stricter (a superset of main). The merge is a pure union. Three NITs; none blocks the merge.
```

### R2.1 Verification performed

D-ORCH-010 constraints applied: no Docker, integration or coverage runs. The worktree stayed read-only. I used a `git archive` extract of `7662672` in the scratchpad with a `node_modules` junction, plus partial extracts of `1fb76c1` and `ccc1082` (`tools/db`). All of them were removed afterwards.

| Check | Result |
|---|---|
| **Union proof (SHA, no build):** `T = merge-tree --write-tree 6f498c4 ccc1082` = `13cf85e` (clean) | `git diff T 7662672` is **byte-identical** to `git diff 1fb76c1 5020ac6` (the 4 fix commits). Both merges are exact clean re-merges: `merge-tree(6f498c4, 6fd801f)` = `1fb76c1`, and `merge-tree(5020ac6, ccc1082)` = `7662672` |
| Rule-12 blobs | `90-audit-ddl-guard.sql` = **`9aab9aa`** (the C1 blob). `10-audit.sql` = `c3d4db9` (unchanged, approved in r1). The only bootstrap file changed since `6f498c4` is the guard |
| Targeted unit tests on the head extract (`tools/db/{lint-migrations,shadow-init,audit-external-tables,table-classes,bootstrap,grants-manifest}`, `tools/lint/tenant-context*`, `tools/openapi/**`, `apps/api/src/platform/{db,health,runtime}`, `apps/worker/src/platform/health`) | 25 suites, **526 passed** |
| `openapi:types --check` / `openapi:lint` on the head | exit 0 / exit 0 (the same 8 warnings as main) |
| api project (`--selectProjects api`) on the head | 5 suites, **81 passed** (contract-validation 12/12, including the new D-ARCH-081 `unavailable` 503 / `degraded` 200 variants) |
| Prettier `--check` on every file the fix commits touched | clean |
| **PGlite 0.4.3 (PG 17.5) guard probes**, lane 00→90 as written (only the r1 substitutions); 57 rows on the head guard (52 guard rows including 5 controls, plus 5 readiness-hijack rows). The 43 guard rows other than E1–E9 were rerun with the r1 guard (`1fb76c1` blob) as the negative control | R2.3 |
| Rule 11, head vs r1 (`1fb76c1`) vs main (`ccc1082`), over the 13 `lock-timeout-do-body` fixtures | main flags 4 (0800, 1000–1200). r1 flags 5 (0000–0400). Head flags **10** = r1 ∪ main ∪ {0500}. That is a strict superset of both: no weakening. `lintRepository` on the head tree gives 0 findings (the real lanes stay clean) |
| PR #26 catalog-std finding functions (`origin/pr26` `standard-columns-scans.ts`) run on PR #24's bootstrapped catalogue (PGlite, `pg_catalog.uuidv7()` shim) | 8 audit tables. `naiveTimestamp`, `dateZone`, `standardColumn`, `sequenceKey` and `onBehalf` all report **0 findings** (union pre-check, R2.5) |
| Guard cost probe: 600 migrator DDL statements in one transaction (PGlite WASM) | r1 guard 1.49 s; head guard 2.78 s / 3.09 s (R2-n2) |
| CI run 43383529879 on `7662672` | fast-lane **success**. scans/ci-gate fail **only** at "Security-owned paths need a review record" (expected until the security r2 record exists) |

Not re-run, so I relied on the developer's gate table: integration 218 passed / 1 skipped on `70afa8b`, and coverage 97.79 % / 97.02 % on `5fef0e1`. I checked that `git diff 70afa8b 7662672 -- apps prisma tools/db packages tests` is empty, and that `5fef0e1..7662672` outside docs touches only `.gitleaks.toml` and `tools/ci/sec-static.test.ts` (PR #25). The same holds for full lint, typecheck and build on `7662672`.

### R2.2 Findings

| ID | Sev | Location | Issue | Required fix |
|---|---|---|---|---|
| R2-n1 | NIT (routed) | `90-audit-ddl-guard.sql:32-33` (header consequence 2); `audit-owner.int.test.ts` "while a squat exists" | The statement "Dropping the squat itself still passes" is true only for **type, domain, composite, sequence, procedure and aggregate** squats (probes S1, S4, S5, S7, E8, E9). The `sql_drop` branch also refuses the drop of a **table** (S2), **view** (S3, via rule `_RETURN`), **matview** (E7), **index** (S6, F-08) or **function** (E6) squat, for every role except the audit owner. Those squats therefore stop all migrations until the superuser suspends `platform_audit_ddl_guard_drop`. The integration test plants only droppable kinds. This is fail-closed and needs a superuser or a suspended guard to create, so nothing is reachable by the migrator. | **Do not edit `90-*.sql` again for a comment.** A new blob would need a new rule-12 approval. Instead, record the per-kind removal path in data-model §5.2 and in the TASK-090 break-glass runbook (droppable: types, sequences, procedures, aggregates; trigger suspension needed: relations, indexes, functions). Optionally pin one table-squat `DROP` refusal in the integration test so the runbook claim is tested. |
| R2-n2 | NIT | `90-audit-ddl-guard.sql:126-140` | The invariant adds three regex scans (pg_class, pg_type, pg_proc) to every `ddl_command_end`. In PGlite, 600 DDLs went from 1.5 s to 2.8–3.1 s, and the cost grows with catalogue size. Native PG 18 is faster. This is acceptable for the migration lanes. | None now. Note it for TASK-024 if large generated migrations appear. If it is ever needed, the later guard-replacement file can restrict the scan by `relname`/`typname` prefix (`LIKE 'audit\_%'` uses the name index) before applying the regex. |
| R2-n3 | NIT (for the next guard version) | `90-audit-ddl-guard.sql:138` | `p.oid <> to_regprocedure('platform.audit_ddl_guard()')::oid` yields NULL if the guard is ever renamed, and then the routine arm matches nothing. Only the guard's owner (the bootstrap superuser) can rename it: X3 and X4 show that the migrator gets "must be owner", and a superuser `OWNER TO` change is refused by the guard. So the migrator cannot abuse it. The exemption is pinned by OID: an overload (R4), a homonym in a writable schema (X5, outside `v_ns`), a re-create (X1, 42723) and `CREATE OR REPLACE` (X2) all fail or stay outside scope. | When the guard is next replaced ("Changing the guard later", §5.2), exempt by `IS DISTINCT FROM` against the event trigger's `evtfoid`, or fail closed when the lookup is NULL. Record this in the §5.2 ceremony notes. |

No BLOCKER, MAJOR or MINOR is open.

### R2.3 Guard probe table (PGlite 17.5; `platform_migrator` unless noted; squat name `audit_entries_2027_06`)

| Probe | r1 guard (`1fb76c1`) | Head guard `9aab9aa` |
|---|---|---|
| C0 sanity `CREATE TABLE public.zz_ok`; C1 own-table ADD COLUMN / INDEX / GRANT / DROP; C2 plain range type; C3 `ensure(12)`; L0 `SET SCHEMA` moves under non-audit names | accepted | **accepted** (readiness `none`, `ensure(12)` ok) |
| **P1** multirange `public` · **P1b** `platform` · **P1c** via `DO … EXECUTE` · **P1d** as superuser | **accepted** (readiness type row; `ensure` NAME_TAKEN) | **42501** `CREATE TYPE leaves type <schema>.audit_entries_2027_06 squatting an audit name, by <role>` |
| P11 `ALTER TYPE zz_r_multirange RENAME TO audit_entries_…` | 42501 (own name) | 42501 (own name) |
| P2/P4 identity `SEQUENCE NAME` · P5 `ADD CONSTRAINT … UNIQUE` · P10 inline `EXCLUDE` · P8 sequence rename | 42501 | 42501 (unchanged) |
| E1 `SELECT … INTO` · E2 CTAS · E3 table rename · E4 index rename · E5 `RENAME CONSTRAINT` | n/a | 42501 |
| L2 table + audit-named index `SET SCHEMA public` · L8 the same with a named PK | 42501 (PR12-SEC-02-a) | 42501 |
| **L3** table + owned identity sequence · **L4** matview + index · **L5** view + owned sequence, `SET SCHEMA public` | **accepted** | **42501** `ALTER … leaves relation public.audit_entries_2027_06 …` |
| L6 range with an audit-named multirange `SET SCHEMA public` | n/a | accepted: on PG 17.5 the multirange **stays** in `evil` (catalogue read back), so nothing lands in `public`. If PG 18 moves it, the post-state check refuses it by construction |
| L7 enum `SET SCHEMA` · L9 function `SET SCHEMA` (audit routine name) | 42501 | 42501 |
| **R1** `CREATE PROCEDURE platform.ensure_audit_partitions(bigint)` · **R2/R3** `CREATE AGGREGATE` under audit names · **R6** procedure rename | **accepted** | **42501** |
| R4 guard overload · R5 function rename | 42501 | 42501 |
| X1–X5 self-exemption abuse (re-create, `CREATE OR REPLACE`, superuser `OWNER TO migrator`, rename, homonym in `evil`) | | 42723 / owner / 42501 guard / owner / accepted outside `v_ns` (R2-n3) |
| **S1/S4/S5/S7** squat planted with the guard suspended (multirange, sequence, enum, procedure): unrelated `CREATE TABLE` → `DROP` squat → `CREATE TABLE` | accepted (no invariant) · accepted · n/a | **42501 invariant · accepted · accepted** (accepted consequences 1 and 2 hold) |
| S2 table · S3 view · S6 index · E6 function · E7 matview squats: `DROP` of the squat | refused (sql_drop) | **refused** (sql_drop): R2-n1 |
| S9 `ensure(12)` with a squat present | NAME_TAKEN | NAME_TAKEN (layer 2 intact) |

**Readiness operator hijack (PR24-SEC-02):** `platform_app` with `search_path = pg_catalog, public`, using `PARTITION_CATALOGUE_SQL` from `1fb76c1` and from the head.

| Plant | r1 SQL | Head SQL |
|---|---|---|
| H1 granted `public.=(oid, integer)` returning false, plus a multirange squat | **squat hidden** (`none`) | type row reported |
| H2 ungranted `public.=(oid, regnamespace)`, plus a squat | **load fails** 42501 (fleet 503) | type row reported |
| H3 / H3b the same plants, no squat, guard on (the migrator can plant them) | load fails / `none` | `none` / `none` |
| H0 control | `none` | `none` |

Planting an operator is still allowed by the guard (it is not an audit name). The class fix (a catalogue assertion on `pg_operator`, or a lint refusal of `CREATE OPERATOR`) stays with TASK-024 (D-SEC-PR24-01).

### R2.4 Rulings on the fix commits

- **`2318e55` guard.** Correct, and it is the generalisation r1 asked for: a post-state catalogue read after the loop, so it also covers commands that report no row. The audit owner's own objects are excluded by owner, and `v_ns` stays OID-derived. The accepted consequence "all non-audit-owner DDL fails while any squat exists" is documented (header 1) and tested (F-08 `unrelated_ddl` plus the three plants). It is acceptable because the migrator can no longer create a squat (every creation path above is refused), so a squat implies a superuser or a suspended guard. Header consequence 2 is narrower than it reads (R2-n1). The `procedure` and `aggregate` additions to the per-row routine arm are correct.
- **`3fd85d0` readiness.** Every operator is now `OPERATOR(pg_catalog.…)` with `oid` operands, and the casts are qualified. `bareSqlResidue` pins this with a negative control. H1–H3 prove the before/after difference. Error level and `partition_name` match README §13 (runtime table, l. 505). `intervalCache(…, keep)` does not cache `unavailable`, so readiness recovers on the next poll. Squat events stay deduplicated by `reported`, and a re-read costs one catalogue query per readiness evaluation. `pendingCheck` refuses `audit_*` both in the type (`PendableComponent`) and at run time. The only production caller left is `object_storage`.
- **`362f9f2` rule 11.** Only DO-body raises count, and DEFAULT or a lower value inside a body is ignored. A top-level `SET`/`RESET` still governs. This closes the fail-open (w1–w3), and the newly flagged `do_set_then_reset` and `top_raised_do_lowers` are the intended price. The depth limit now fails closed. The R1-n7 limit is listed. The test comment "flagged by the base linter too" means main's linter (verified: main flags 0800 and 1000–1200), not r1.
- **`5020ac6` contract.** This is exactly the r1 R1-M1 recipe: `isCriticalComponent`, the `unavailable` 503 and `degraded` 200 variants, the regenerated `types.gen.ts` and the reworded `getReadiness` description. Traceability extensions are unchanged, so drift is not affected.
- **PR #20 sink routing left out: correct.** `RUNTIME_SECURITY_EVENTS`, `securityEventSinkFrom` and the per-event allow-list exist only on `origin/pr20` (`fafa3b5`). Main has no sink to route through. D-ARCH-081 and D-ORCH-029 assign it to the second merger. Until then, `audit_mutation_rejected` uses main's `log.warn('security.${event}')` path (`runtime.ts:226`), like the other DB events on main.

### R2.5 Union steps for the open PRs (verified with `git merge-tree --write-tree <pr> 7662672`)

**PR #20 (`fafa3b5`, TASK-010), whichever of #20/#24 merges second.** Textual conflicts: `apps/api/src/platform/db/runtime.ts` (imports) and `tools/tsconfig.json` (file list).
1. `runtime.ts` imports: keep both the `securityEventSinkFrom` import and the three `health/checks/*` imports. `tools/tsconfig.json`: keep `logging/security-events.ts` and the three `health/checks/*.ts` entries.
2. `packages/shared/src/logging/security-event.ts`: add `audit_mutation_rejected` and `audit_partition_squatted` to `RUNTIME_SECURITY_EVENTS`; set both to `error` in `SECURITY_EVENT_LEVEL`; set `SECURITY_EVENT_FIELDS` to `audit_mutation_rejected: ['sql_state']` and `audit_partition_squatted: ['partition_name', 'kind', 'reason', 'sql_state']` (README §13 runtime table, l. 504–505).
3. `packages/shared/src/logging/security-event.test.ts:87`: replace the `toEqual(['sql_state'])` loop over runtime events with a per-event expectation, ideally parsed from the README §13 runtime table. Add both events to the `error` list (about l. 94–105).
4. `apps/api/src/platform/logging/security-events.test.ts:57-67`: add both events to `emitted`. The type-level `Unlisted` check does not compile until step 2 is done, which is the intended tripwire.
5. In the PR #24 `runtime.ts` squat callback (head l. 271), replace `log.error('security.audit_partition_squatted', {...})` with `security.emit('audit_partition_squatted', { partitionName: object.name, kind: object.kind, reason: object.reason })`. **Drop `component`**: it is not in the allow-list and would be counted in `dropped_attributes`. Use the camelCase-to-snake convention that `sqlState` uses. `audit_mutation_rejected` then flows through PR #20's `onSecurityEvent → security.emit` with no further change. Add both names to the header comment of `apps/api/src/platform/logging/security-events.ts`.
6. Re-run typecheck, unit (`packages/shared/src/logging`, `apps/api/src/platform/{logging,db,health,runtime}`) and api. A merge-only security round applies (owned paths).

**PR #30 (`293fb62`, TASK-019 object storage).** Conflicts: `runtime/services.ts`, `runtime/services.test.ts`, `health/health.int.test.ts`.
1. `services.ts`: `readinessChecks(database, audit: AuditReadinessChecks, valkey, objectStorage)` returns `[database, createValkeyCheck(valkey), objectStorage, audit.partitions, audit.chain]`. The composition becomes `readinessChecks(database.readinessCheck, database.auditChecks, valkey, createObjectStorageCheck(storage, config.STORAGE_BUCKET_DOCUMENTS))` with both resources (`valkey`, `object_storage`). The doc comment should say that no component is pending. Drop the now-unused `pendingCheck` import (lint `--max-warnings 0`).
2. `services.test.ts`: keep both import sets; the call becomes `readinessChecks(fake as never, audit, fake as never, objectStorage)`. The brand positive control `pendingCheck('object_storage')` stays legal (`PendableComponent`). `wiredStubs()` is now `[]`.
3. `health.int.test.ts`: the header covers real object storage (RustFS) plus audit stand-ins. Imports: S3/RustFS plus `type ReadinessCheck`, and drop `pendingCheck` if it is unused. Checks: `createObjectStorageCheck(storage, DOCUMENTS_BUCKET), ...AUDIT_STAND_INS`.
4. Re-run unit (`runtime`, `health`) and integration `health.int.test.ts`.

**PR #26 (`84b70c4`, TASK-032).** Conflicts: `db/map-db-error.ts` and `db/runtime.ts`.
1. `DbErrorReason`: keep `'AUDIT_IMMUTABLE' | 'AUDIT_PARTITION_NAME_TAKEN'` **and** `'NESTED_WRITE_UNSUPPORTED'` with its doc comment. There is no exhaustive `Record<DbErrorReason, …>` on either side (grep), so nothing else changes.
2. `runtime.ts`: keep `runStartupAuditPartitionsCheck` **and** PR #26's `RuntimeDatabaseClient<TTx> extends TransactionCapableClient<TTx>, ExtendableClient` together with its doc comment.
3. catalog-std: no change is needed. PR #26's finding functions give 0 findings on PR #24's audit catalogue (R2.1). Its audit-table probes are catalogue rows, not DDL, so the post-state invariant does not affect them. Its migrator-planted probes (`std_*`, `*_probe`) use non-audit names (control C0). Re-run `prisma/tests/catalog/standard-columns.int.test.ts` on the union.

**PR #27 (`aa1cfb1`, SPK-04).** Only `docs/sdlc/DECISIONS.md` conflicts. PR #27 r1 M1 is still open at `aa1cfb1`: its harness reads `spk08/10-audit.sql` and `90-audit-ddl-guard.sql`, which PR #24 deletes. If PR #24 merges first, PR #27 must drop or retarget the harness before it merges.

**PR #28 (`6214283`, W0-ACT-1).** No conflict.

### R2.6 Follow-up closure (r1 items)

| Item | Status |
|---|---|
| R1-M1 union break | **Closed** (`5020ac6`; types check, api 81/81, contract 12/12) |
| R1-M2 multirange squat | **Closed** (`2318e55`; R2.3, with the r1-guard negative control) |
| R1-m1 AT-US-012-04 wording / out-of-window squats | **Closed by ruling** D-ARCH-081: "next partition" = current + 3, so there is no PM edit; any squat → `unavailable` (security PR24-SEC-08 (a) accepts) |
| R1-m2 squat event level | **Closed in-PR** (`error`, `partition_name`). The sink routing is the second merger's job (R2.5 PR #20, steps 2–5) |
| R1-m3 bootstrap immutability in CI | Routed: TASK-015 (PR24-SEC-04) |
| R1-n1 DO depth fail-open | **Closed** (fail closed, test with control) |
| R1-n2 `pendingCheck('audit_*')` | **Closed** (type plus run-time refusal) |
| R1-n3 schema-branch comment | **Closed** |
| R1-n4 sticky `unavailable` | **Closed** (`keep`, with tests) |
| R1-n5 port and delete in one commit | Open as a merge condition (squash) |
| R1-n6 image ships tools/db | Routed: TASK-014 |
| R1-n7 rule-11 stated limits | **Closed** |

### R2.7 Merge conditions

1. A security-analyst round-2 record naming **`7662672`**, which grants rule-12 approval for blob `9aab9aa` (D-SEC-PR24-01 C2). Then lane A green on the exact head: today the only red step is "Security-owned paths need a review record".
2. **Squash** merge (R1-n5).
3. **D-ORCH-034:** if PR #28 merges first, PR #24 must commit a fresh lane-B `quality:heavy --profile pr` evidence run on an ancestor of its head. Apply the PR28-SEC-02 temp-path scrub before that evidence commit. A later merge of main that brings non-`docs/**` paths (including `.claude/agent-memory/**`, until the narrow staleness pattern lands) makes that evidence stale again.
4. Any further merge of main that touches non-docs paths: repeat the merge-tree proof (`git diff merge-tree(5020ac6, main) <newHead>` is empty).
5. The second merger of PR #20 or PR #24 applies R2.5 PR #20, steps 1–6, with a merge-only security round. PR #26 and PR #30 apply their R2.5 steps when they merge after PR #24.
6. R2-n1 goes into data-model §5.2 and the TASK-090 runbook, not into `90-*.sql`. R2-n3 goes into the §5.2 "Changing the guard later" notes.

### R2.8 Good

- The negative-control discipline carried over. The `KNOWN_GUARD_GAP = []` pin and the "squat exists" control turn the accepted consequence into an asserted behaviour, not only a comment.
- The invariant raises a precise DETAIL (`<TAG> leaves <kind> <schema>.<name> …`), so an operator can see which object blocks the migrations.
- `bareSqlResidue` is a cheap static tripwire that sits alongside the integration plants. Both halves have controls.
- The fix-cycle comment's union proof matches mine to the SHA.
