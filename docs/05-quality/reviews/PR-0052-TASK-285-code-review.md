# Code review: PR #52, TASK-285 audit action vocabulary v2 (round 1)

| Field | Value |
|---|---|
| PR | #52 `feat(audit): widen the action CHECK to the 20 REQ-AUDIT-002 actions (TASK-285)` |
| Branch / head | `feat/TASK-285-audit-actions-v2` @ `a718dcd` (5 commits: 2 code/test, 2 merges of main, 1 evidence) |
| Merge-base with current main | `73addb0`. Main is now `78cd2a4`. The delta `73addb0..78cd2a4` touches only `.claude/agent-memory/senior-developer/*`, `docs/sdlc/DECISIONS.md` and `docs/sdlc/STATUS.md`. |
| Story / records | US-087 (partial; AT-US-087-07 CHECK half) · REQ-AUDIT-002/003/011 · NFR-AUDIT-001 · D-ARCH-119 · ADR-0007 am. 11 item 4 · D-TASK025-03 · data-model OI-07 · D-TASK285-01..07 |
| Reviewer | code-reviewer · 2026-11-15 · round 1 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The widening is correct and idempotent. It is one ALTER (DROP IF EXISTS + ADD) under SET ROLE
         platform_audit_owner, and it propagates to every partition (inherited, validated); the PG 18 suite proves
         this on fresh and existing databases. The name 91- is forced by the runner and lane A (ruling accepted).
         The shadow-init KEEP form is narrow and safe, the parity replay works and the contract-gap pin is not
         vacuous. There is no BLOCKER or MAJOR. Two MINORs: the contract change request has no owning card, and the
         existing-database upgrade runs on an empty store. Merge needs the security-analyst rule-12 record on blob
         9945c349.
```

## 1. Verification I performed myself

| # | Check | Result |
|---|---|---|
| V1 | `git diff origin/main...a718dcd --stat`; `git log` | There are 19 files. 10 of them are code or test: `prisma/bootstrap/91-audit-actions-v2.sql` (new), `packages/audit/src/actions{,.test}.ts`, `prisma/tests/audit/audit-actions-v2.int.test.ts` (new, 12 tests), `prisma/tests/{bootstrap,catalog}` ripple, and `tools/db/{shadow-init,shadow-init.test,bootstrap.test,lint-migrations.test}.ts`. The other 9 are files of the evidence run. `10-audit.sql` is untouched. |
| V2 | Targeted unit run in the worktree: `jest packages/audit/src/actions.test.ts tools/db/shadow-init.test.ts tools/db/bootstrap.test.ts tools/db/lint-migrations.test.ts --selectProjects unit --maxWorkers=2` | 4 suites, **249 passed**, 2.3 s. |
| V3 | `prettier --check` on the changed non-evidence files (the `.sql` file has no Prettier parser, as on main); `eslint --max-warnings 0` on the changed `.ts` files | Both clean. |
| V4 | `tsc -b packages/audit` | Clean. The compile-time contract check type-checks. |
| V5 | Contract-parity type probe: the same `ContractParity` type applied to the generated `types.gen.ts` types, in a scratch file with `tsc --strict` | The real contract compiles. All 4 mutants are TS2322 errors: the contract gains both new values (the fix the pin is waiting for), the contract gains `BOGUS`, the contract loses `LOGIN`, and `any`. The pin is not vacuous in either direction. |
| V6 | Shadow-init KEEP probe: `renderShadowInit` on 17 statement forms (tsx, no edits) | **Kept:** same-name replacement with or without `IF EXISTS`, `ONLY`, nested parentheses, function calls, a quoted name on both sides, and a string literal holding `), add column` (strings are blanked before matching). **Refused:** a trailing action after `) ,` / `) /*c*/,` / `), ADD CONSTRAINT … CHECK (…)`, `NOT VALID`, `NOT ENFORCED` (PG 18), `NO INHERIT`, `CASCADE`, a different or prefix name, quoted vs unquoted, `ALTER TABLE IF EXISTS`, and `greatest(f(a), b)` (fail closed). **ReDoS:** 60 kB adversarial bodies (`') ,'` × 20 000; `')'` × 50 000) took 31 ms and 17 ms. |
| V7 | Mutation run: scratch copy (`git archive a718dcd` + `node_modules` junction), unit lane only | 14 mutants: 10 killed, 2 survived, 1 equivalent, and 1 survives the unit lane but is killed in integration. See §3. |
| V8 | `node tools/ci/check-migration-immutability.mjs --base origin/main --head HEAD` | PASS (1 added bootstrap file). `checkBootstrapChanges` on `prisma/bootstrap/11-audit-actions-v2.sql` against main's file list returns `bootstrap/added-out-of-order`. This confirms D-TASK285-01. |
| V9 | Hosted CI on `a718dcd` (run 43721397887) | `fast-lane`: every step succeeded on the exact head, including lint, format, typecheck, unit and build. `scans` fails only on "Security-owned paths need a review record", and `ci-gate` fails as a consequence. |
| V10 | Evidence `20261115T1311Z_552a772` | Verdict PASS on `552a772`. `a718dcd` differs from it only by the run directory. Integration ran 333 tests with 0 failures; all **12 AT-US-087-07 cases are present** and pass. The 1 skip is the opt-in SPK-03 (d) benchmark, which predates this PR. Catalog 102, migrations 8, rls 126, api 128, unit 5669. |
| V11 | Merges and unions | `git merge-tree --write-tree a718dcd origin/main` is clean. The union with PR #53 (`8a48139`) is clean too (tree `c2454d6`), with no overlapping file. |
| V12 | Consumers of the vocabulary | Outside `packages/audit` and the generated contract types, nothing else uses `AUDIT_ENTRY_ACTIONS` or `AuditEntryAction`. There is no exhaustive switch on actions and no UI label table. |
| Not re-run | full `lint`/`typecheck`/`build`/unit; the Docker suites (integration, catalog, migrations); `quality:heavy` | Per the brief (no Docker; host saturated, D-ORCH-096). I relied on V9 (hosted fast-lane on the exact head) and V10 (lane-B evidence). |

## 2. Findings

| ID | Severity | Location | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `packages/audit/src/actions.test.ts:135-161`; `docs/03-architecture/api/openapi.yaml` (`AuditEntry.action`, `AuditEntrySummary.action`, `filter[action]`: 18 values); D-TASK285-02 | **The card's PARITY AC is not met, and the change request that replaces it has no owner.** The card asks that "the contract enum (openapi AuditAction, 20 values) equals AUDIT_ENTRY_ACTIONS". ADR-0007 am. 11 item 4 and the sheet-fold-7 ruling (3) both say the contract "already lists 20", but it lists 18. The deviation itself is right: contract edits belong to api-designer, and the compile-time pin is exact (V5), so the contract fix cannot land without updating it. But D-TASK285-02's "change request to api-designer, due before TASK-073 exposes them" appears in no card, plan-data line or STATUS row (`grep D-TASK285-02` finds only DECISIONS.md). Until the CR lands, an audit-viewer response carrying `SESSION_REVOKED` would fail OpenAPI response validation. | Orchestrator: add one AC line to TASK-073 (or a named api-designer task) saying "openapi enums `AuditEntry.action`, `AuditEntrySummary.action` and `filter[action]` gain MFA_RECOVERY_USED and SESSION_REVOKED; actions.test.ts's expected gap becomes `never`". It must land before TASK-059/061 emit. Architect (SHEET-FOLD-8): correct "the contract enum already lists 20" in ADR-0007 am. 11 item 4 and in ruling (3), together with the 11 → 91 rename. No code change in this PR. |
| R1-m2 | MINOR | `prisma/tests/audit/audit-actions-v2.int.test.ts`, describe "an existing database" (beforeAll + "before the upgrade …") | **The upgrade is proved only on an EMPTY store.** Before the upgrade, the only writes are the two new actions, and both are refused, so `audit_entries` has 0 rows when 91 runs. The header's "a superset CHECK validates every existing row (one scan per partition under ACCESS EXCLUSIVE)" claim and hash-chain continuity across the DDL are not exercised. Real environments upgrade a non-empty store. | Before `bootstrap(existing)`, write one entry with a v1 action (for example `LOGIN`) for org X. After the upgrade, assert that the row is unchanged (`action`, `entry_hash`). Then write `SESSION_REVOKED` for the same org and assert `stream_seq = 2` and that its `prev_hash` links to the first entry. That is about 8 lines. |
| R1-n1 | NIT | `tools/db/shadow-init.ts:157` (lookahead `(?!\) ?, ?[a-z])`), `tools/db/shadow-init.test.ts` refusal rows | Mutant K2 (lookahead removed) survives all 59 shadow-init tests. The only "followed by another action" fixture ends in `int`, which `\)$` already refuses. A trailing action that ends in `)` (for example `…, ADD CONSTRAINT ck_y CHECK (b > 0)`) is refused today (V6) but is pinned by nothing. | Add that refusal row. |
| R1-n2 | NIT | `packages/audit/src/actions.test.ts:49-66` (`effectiveChecks`) | The replay is lexical and three cases are unpinned. (a) Mutant P2 (no comment stripping) survives: the fixture's commented definition is overwritten by the real one that follows it, so the comment test is vacuous. (b) `/* … */` comments are not stripped, so a block-commented widening counts (probe). (c) A `--` inside a string literal strips the rest of that line (probe: the widening on the same line was missed, which fails closed). The real lane is unaffected today: the PG 18 suite and C9 read the database truth, and shadow-init refuses `NOT VALID`. | Move the comment fixture AFTER the definition, so a non-stripping replay differs. Strip `/* … */` too, or replay over `tools/db/sql-text` (`sqlText(sql, false)`) if the boundary rules allow `packages/audit` tests to reach it. |
| R1-n3 | NIT | `prisma/bootstrap/91-audit-actions-v2.sql` header "Data:"; ADR-0007 am. 11 item 4 ("validates trivially") | The one-shot validation is a full scan of every partition under ACCESS EXCLUSIVE. The runner bounds it at `FILE_STATEMENT_TIMEOUT = '5min'` (`tools/db/bootstrap.ts:54`), and the session `lock_timeout` also applies. On a large store the file therefore fails closed and rolls back rather than finishing in the "deploy window". That is safe, but the runbook should say so. | Route to the TASK-090 runbook or the architect fold: state the scan cost and the 5-minute bound, and what to do when it trips. The immutable file needs no change. |

## 3. Mutation table (V7)

| ID | Mutant | Tests run | Result |
|---|---|---|---|
| K1 | KEEP backreference `\1` replaced by any `NAME` | shadow-init.test | killed (1 failed) |
| K2 | KEEP lookahead `(?!\) ?, ?[a-z])` removed | shadow-init.test | **survived** (R1-n1) |
| K3 | KEEP tail accepts `( not valid)?` | shadow-init.test | killed |
| K4 | KEEP line made unmatchable | shadow-init.test | killed (the real-lane rendering throws at collection) |
| P1 | replay ignores `DROP CONSTRAINT` | actions.test | killed |
| P2 | replay keeps comments | actions.test | **survived** (R1-n2) |
| P3 | replay: the first definition wins | actions.test | survived, **equivalent**: valid SQL cannot re-ADD a constraint name without a DROP first, and the DROP clears the entry |
| S1 | 91: `MFA_RECOVERY_USED`/`SESSION_REVOKED` swapped | actions.test | killed (order is pinned) |
| S2 | 91: `SESSION_REVOKED` dropped | actions.test | killed |
| S3 | 91: `NOT VALID` appended | shadow-init.test | killed (rendering refuses) |
| S4 | 91: `SET ROLE platform_audit_owner` removed | lint-migrations, shadow-init, bootstrap tests | survives the unit lane. It is **killed in integration**: the 90 guard refuses the superuser without SET ROLE (42501, the PR's own test 6), so the fresh-database bootstrap fails. |
| S5 | 91: rule-12 marker removed | lint-migrations.test | killed (3 failed) |
| S6 | 91: split into two statements | shadow-init, lint-migrations, actions tests | killed (suite error) |
| A1 | `AUDIT_ENTRY_ACTIONS` without `MFA_RECOVERY_USED` | actions.test | killed (3 failed) |

## 4. Rulings on the focus items and deviations

1. **Correctness and idempotency of DROP IF EXISTS + ADD under SET ROLE: sound.**
   - PostgreSQL runs the DROP subcommands of one ALTER TABLE before the ADD-CONSTRAINT pass, so reusing the name is valid.
   - The runner applies the file in one transaction with its ledger row (`bootstrap.ts:140-143`, 296-298), so the change is atomic as well as single-statement.
   - Partitions are created with `LIKE … INCLUDING CONSTRAINTS` followed by `ATTACH PARTITION` (`10-audit.sql:375-378`). Attaching merges the copied CHECK as inherited (`conislocal = false`). That is why the parent-level DROP reaches every partition and the ADD re-propagates.
   - The suite asserts `conislocal = false`, `coninhcount = 1`, `convalidated = true` and an identical definition on every partition, both before and after `ensure_audit_partitions(6)`.
   - Re-running with the ledger row removed leaves an identical `pg_get_constraintdef`.
   - The guard admits only `platform_audit_owner`: the superuser without SET ROLE gets `audit objects are immutable`, and the migrator gets `must be owner`.
   - D-TASK285-05 (idempotent, unlike 10 and 90) is accepted. 91 creates no object that could be planted.
2. **The parity test is robust enough for its role.** Order is now pinned (it used to be sorted). The test shows that 10-audit.sql alone no longer matches, and it names exactly the two files that define the constraint. The lexical gaps are NIT R1-n2. The authoritative check is the database side: C9 and the PG 18 suite's value-for-value, in-order comparison on the parent and on every partition.
3. **The shadow-init KEEP form (D-TASK285-03) is safe and narrow: accepted.**
   - The kept statement is byte-for-byte what the real lane runs, so the shadow stays faithful.
   - Ownership clauses and psql variables are refused before KEEP is consulted.
   - The regex is linear (V6).
   - One residual: `DROP CONSTRAINT pk_x, ADD CONSTRAINT pk_x CHECK (…)` is kept, so the dropped constraint can be of a different kind under the same name. That is harmless, because the shadow mirrors whatever the lane does.
   - Only the lookahead lacks a pin (R1-n1).
4. **Test quality: good.** The PG 18 suite covers fresh and existing databases, writer round-trips as `platform_app` through the real `withTenantTx`, 23514 on the store path, immutability for every role, the guard identity rule with negative controls, post-upgrade partitions and re-application. The gap is R1-m2.
5. **File name (D-TASK285-01): accepted.** `11-` is refused twice over:
   - by the runner on any database that already has 90 (`bootstrap.ts:291-293`);
   - by lane A (`bootstrap/added-out-of-order`, V8).

   That would contradict the card's own "existing database" scenario. `91-` keeps the same order on fresh and existing databases, after the guard that admits the owner. The knock-on test edits are correct and minimal: the PR12-SEC-03 ledger-order test deletes 91's row first, and the guard-plant lane copy drops 91. The architect's text ratification (D-ARCH-119, ADR-0007 am. 11 item 4, the WAVE-00 card and plan-data, which still say `11-`) is SHEET-FOLD-8 and does not block merge.
6. **D-TASK285-02: accepted, with R1-m1.** **D-TASK285-04** (marker dated 2026-11-15) is accepted. The approval itself belongs to the security record.

## 5. Merge conditions

1. A security-analyst record approves the rule-12 marker on blob `9945c349e2334c60b1b2238d438ad8827b2a7b22` and names head `a718dcd` or later, so that `scans` and `ci-gate` turn green.
2. **Do not merge main into the branch again** before squashing. Main's delta since `73addb0` includes `.claude/agent-memory/senior-developer/*`, which is outside the evidence staleness allowance (`docs/**` only), so it would stale lane-B evidence `552a772`. Squash onto main as is: the merge-tree is clean (V11).
3. Squash with a Conventional Commits title.
4. R1-m1 routing is recorded (orchestrator), either before or with the merge. R1-m2 can be done in-PR, which would need fresh lane-B evidence, or routed to TASK-033 (the generated audit suites) or the TASK-059 PR, whichever writes the first entry before the widening.

## 6. Good patterns worth keeping

- The parity replay of the EFFECTIVE constraint across the lane, plus the explicit "10-audit.sql alone no longer matches" assertion. Together they make the immutability-plus-new-file model testable.
- The compile-time pin of a known contract gap that fails when the gap closes, in both directions (V5).
- The "existing database" path built from a lane copy without the new file, so the upgrade itself runs through the real runner and ledger.
- A fail-closed KEEP form with a negative row for each neighbouring shape.

## 7. Security flags (for security-analyst)

- Rule-12 approval of blob `9945c349` (the file carries the marker `security-analyst 2026-11-15` ahead of the record).
- `tools/db/shadow-init.ts` KEEP widening (D-TASK285-03): it runs as the migrator on the shadow database only. My probe found no ownership or role statement that can pass. Please confirm.
- The guard identity rule for 91 is proved by negative controls (superuser without SET ROLE: guard; migrator: owner check).
