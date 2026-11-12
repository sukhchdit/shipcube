# Code review: PR #12, TASK-012 SPK-08 spike (audit owner, DDL guard, signed anchors) (round 1)

- **PR:** #12 `feat/TASK-012-spk-08-spike-audit-owner`, head `2e0aa32` (base `c29f89b`; main has since moved by docs-only commits)
- **Reviewer:** code-reviewer · P5 Wave 0 · 2026-11-13
- **Inputs:** WAVE-00.md TASK-012; risks.md R-ARCH-18 (the spike's full exit list, incl. the SEC-P3-27 extension); ADR-0007 am. 6–8; data-model §4.4, §4.6 C13/C14, §5.1–§5.6, §7.3 (incl. A17); `rulings/batch-0.2-rulings.md`, `rulings/wave-0-batch-3-rulings.md`; `prisma/README.md` "Findings for SPK-03/SPK-08"; DECISIONS.md D-TASK012-01, D-ORCH-015; SPK-03.md (house style, PR #7 m7 lifecycle precedent)

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A rigorous spike. The prototype SQL really is verbatim from data-model §5.1–§5.3 and the §5.2 guard (I diffed it).
         The golden vectors and DER→P1363 conversion check out independently. The privilege-vs-guard classification is sound,
         and the RDS desk research is careful and honest. Three MAJORs, all cheap: (M1) a routed spike question
         (`migrate dev` vs raw-SQL partial indexes) is silently dropped; (M2) the guard's `sql_drop` refusal path, which
         R-ARCH-18 names explicitly ("schema-owner DROP TABLE"), is never exercised; (M3) the port-then-delete plan
         leaves 3 of the 5 spike code files without an owner, and it cannot work as ordered: both spike suites collide
         with TASK-021's real bootstrap files.
FINDINGS: M1–M3 (MAJOR); m1–m5 (MINOR); n1–n7 (NIT). See §3.
GOOD: see §5
SECURITY-FLAGS: M2; RDS `session_replication_role` / ENABLE ALWAYS; n4 (see §6)
```

## 1. Verification performed

The host is memory-constrained, so I ran no `npm ci`, build, Docker or full suite. The worktree is unchanged (`git status --porcelain` is empty).

| Check | Result |
|---|---|
| `git diff --stat c29f89b..2e0aa32` | 7 files, all under `prisma/tests/spikes/**` and `docs/04-plan/spikes/SPK-08.md`. No `eslint.config.mjs`, tsconfig, jest, bootstrap or migration change |
| `grep` for `eslint-disable`, `@ts-`, `as any` and non-null assertions in the new TS files | none |
| `eslint --max-warnings 0` (repository config, type-aware) on the 4 new TS files | exit 0 (15 s) |
| `prettier --check prisma/tests/spikes docs/04-plan/spikes/SPK-08.md` | clean |
| "Verbatim" claim: whitespace-normalised diff of `10-audit.sql` against data-model §5.1, §5.2 and §5.3 code blocks | §5.1 **identical**. §5.2: only the documented omission (checkpoint-head/anchor triggers). §5.3: identical, plus the two §4.4 grant lines |
| "Verbatim" claim: `90-audit-ddl-guard.sql` against the data-model §5.2 amendment guard block | **identical** |
| Golden vectors (§5.2), recomputed independently in Node from the data-model §5.5 / §3.4 byte layouts | `0425126b…cafc6` and `3bf63296…a9b5` **match** |
| `derToP1363` fuzz: 20,000 real P-256 DER signatures (lengths 69–72; 39 with a short INTEGER) checked with `crypto.verify(…, dsaEncoding: 'ieee-p1363')` | 0 failures. `sinkLine`/`parseSinkLine` round trip OK |
| F-04 premise: `20261112010000_authz_catalogue_tables/migration.sql:68` `INCLUDE ("permission_id")` vs `authz.prisma:61` `@@index([roleId], map: …)` | **confirmed**. Already documented in data-model §7.3 A17 and in the `authz.prisma` header (m4) |
| Marker probe: `-- @audit-ddl security-approved: spike-only (SPK-08) 2026-11-12` against `lint-migrations.ts` `AUDIT_MARKER` | does not match (fails closed if copied into `prisma/bootstrap`). `audit-ddl-reviewers.json` is empty (n4) |
| Collision probe: harness `bootstrap()` / `template()` apply every file in `prisma/bootstrap` | confirmed: TASK-021's real `10-audit.sql`/`90-*.sql` will make both spike suites fail on `CREATE TABLE public.audit_entries` (M3) |
| PR #10 lane A: Semgrep `raw-sql.yml` path excludes, CODEOWNERS-derived security-owned paths | spike files are excluded (`tests/`). No security-owned path is touched, so lane A requires no security record |
| PR #11 semantic merge: `02-role-backstops.sql` (platform_app `statement_timeout` only), new `platform_rls_helpers` migration | no effect on the spike assertions found by reading (the exit-4 regex `/platform/` scans Prisma's model diff only) |
| Routing trace: "`migrate dev` with partial indexes" | routed to TASK-012 only by batch-3 rulings :43. Not in batch-0.2, not in the sheet, not in SPK-08 (M1) |
| `gh pr view 12 --json statusCheckRollup` | `[]`: no CI on the head (lane A not on main, D-ORCH-004) |

**Not re-run:** typecheck, unit, integration (Docker: the 21 spike tests), build, audit. For those I rely on the developer's evidence on `2e0aa32`: format/lint/typecheck 0, unit 859, integration 9 suites / 73 passed / 1 skipped, build 0, audit 0, clean tree.

## 2. Reviewer-focus answers

| Focus | Answer |
|---|---|
| Does SPK-08 answer every sheet question with reproducible evidence? | **Sheet items: yes.** SEC-TC-43, SEC-TC-44, and the three checks (RDS, shadow DB, Prisma DDL) are each answered with a command and test names. **Gaps:** the R-ARCH-18 exit item "schema-owner `DROP TABLE` caught by the identity trigger" (M2); the routed partial-index question (M1); several recorded results come from the optional JSON report, not from assertions (m1) |
| Are the 21 tests deterministic, isolated and asserting correctly? | **Mostly deterministic.** One container per file; tamper attempts run in BEGIN…ROLLBACK; keys are generated in memory; the timing bound has about 130× headroom (fine under the PR #7 heuristic). **Isolation:** the audit-owner tests share databases and depend on file order. Exit 4 `migrate dev` only passes after exit 3 has deployed, and the hijack cleanup is not in `finally` (n2). **Assertions:** F-01's premise, the shadow-DB contents and the created-migration content are unasserted or vacuous (m1). The golden vectors are not pinned (n3) |
| Could prototype SQL be mistaken for product SQL? Any lint exemptions? | **No lint exemptions** were added (no config change, no disable comments, ESLint clean). The files carry a THROWAWAY header, live under `prisma/tests/spikes/`, and are outside the linter's and Semgrep's scan roots. Residual: the file names match the future bootstrap files exactly, and the header includes a pseudo-approval `@audit-ddl security-approved: spike-only …` line (n4). If it were copied into the bootstrap lane, the linter would reject it (fails closed), but it still reads as an approval |
| F-01/F-02 data-model amendment text | **Sound and minimal.** Both target existing rows (§4.4 evaluation table rows "`prisma migrate deploy`" and "Shadow database"; §7.3). F-01's generated window (current + 24 months) safely covers the `p_months_ahead ≤ 12` cap, and only the first deploy is affected. F-02 also benefits every migration that creates objects in `platform` (PR #11's helpers), not only audit. The DROP fails closed if someone points the shadow URL at a real database (the migrator does not own `platform` there) (n6). Missing: no deadline ("before TASK-021 starts", which D-TASK012-01 states but §9 does not) (m3) |
| F-04 INCLUDE-index drift claim | **Verified**, but it is not new. data-model §7.3 A17 (D-T013-09) and the `authz.prisma` header already record it. What *is* new and valuable is that `migrate dev --create-only` writes the DROP + CREATE (without INCLUDE) into **every** new migration. A17's by-name drift tolerance cannot detect a lost INCLUDE, because migrations and the database would then agree. The routing needs that concrete rule (m4) |
| Port-then-delete plan | **Incomplete and infeasible as ordered (M3).** §8 item 4 covers only `spk08-audit-owner.int.test.ts` and the two SQL files, with no deadline. `spk08-anchor.int.test.ts`, `spk08/anchor-prototype.ts` and `spk08/prisma.config.ts` have no owner. TASK-033 depends on TASK-021, and TASK-021 adds the real audit bootstrap files that break both suites, so "TASK-033 ports, then delete" leaves TASK-021's branch red |

## 3. Findings

| ID | Sev | File:line | Issue | Required fix |
|---|---|---|---|---|
| M1 | MAJOR | `docs/04-plan/spikes/SPK-08.md` §4/§8 (absent); `rulings/wave-0-batch-3-rulings.md:43`; data-model §7.3 row "Partial indexes" | Principal-architect routed "`migrate dev` with partial indexes" to TASK-012, but the record neither answers it nor re-routes it. The question is now orphaned: batch-3 says "already routed by batch-0.2", but batch-0.2 routed only `initShadowDb`. F-04 shows the mechanism is real: `migrate dev` re-emits raw-SQL-only index features as DROP + CREATE. A raw-SQL partial index silently becoming a full index, or being dropped, in a generated migration is a data/perf defect | **Either** add one exit-4 variant: append a migration with a raw partial index (and one declared via `partialIndexes` preview `where: raw(…)`) to the temp migrations copy, run `migrate dev --create-only`, and record whether the generated SQL drops or recreates it. **Or** add an explicit §8 open question with owner (TASK-016 or the first module needing a partial index) and a deadline, plus a DECISIONS line. Close the §7.3 "verify in P5 spike" note either way |
| M2 | MAJOR | `prisma/tests/spikes/spk08-audit-owner.int.test.ts:273-372`; SPK-08 §1, §7 F-08 | The guard's **`sql_drop` refusal branch is never exercised**. Every DROP in the suite is stopped by privilege first (migrator) or is a permitted non-audit drop (exit 3, hijack cleanup). C14 (b) and the planted names use `ddl_command_end` only. R-ARCH-18 lists "the identity-based event trigger catches … a schema-owner `DROP TABLE`" as an exit item. data-model §4.4 calls the `sql_drop` guard "the second layer" after SEC-P3-27. F-08's "a migrator DROP of a non-audit index named `audit_entries_*` would fail too" is inferred, not observed. The GO covers am. 7/8 in full, including this path | Add one test. As the superuser, `SET ROLE platform_schema_owner` (it has the privilege to drop any table in `public`). Inside a rolled-back tx, run `DROP TABLE public.<partition>`, `DROP TABLE public.audit_entries` and `DROP INDEX public.ix_audit__stream_seq`, and expect 42501 with the guard message and a DETAIL starting "DROP of". Also the superuser itself: `DROP TABLE public.audit_entries`. Add the F-08 case as the migrator: create `public.spk08_t`, then an index named `audit_entries_spk08_x` on it (allowed), then `DROP INDEX` (expect the guard). Record the results in §1 and F-08 |
| M3 | MAJOR | `docs/04-plan/spikes/SPK-08.md:384-386` (§8 item 4) | The lifecycle plan is incomplete and its order is infeasible. (a) `spk08-anchor.int.test.ts`, `spk08/anchor-prototype.ts` and `spk08/prisma.config.ts` have no owner or deletion trigger. (b) There is no deadline (SPK-03 §6 had "Due: before G3"). (c) `PlatformPostgres.bootstrap()`/`template()` apply **all** of `prisma/bootstrap`. When TASK-021 adds the real `10-audit.sql`/`90-*.sql`, the audit-owner suite fails on `CREATE TABLE public.audit_entries` (prototype re-applied), and so does the anchor suite (its `SPIKE_DDL` does the same on the bootstrapped template). TASK-033 depends on TASK-021, so "TASK-033 ports, then delete" means TASK-021 inherits two red suites and likely deletes them without porting. The sheet DoD says "throwaway code is not merged". Merging is acceptable under the SPK-03 precedent only with a complete, feasible plan | Rewrite §8 item 4 per file. **TASK-021's PR deletes** `spk08-audit-owner.int.test.ts` and `spk08/{10,90}-*.sql`, and also `spk08/prisma.config.ts` once the rendering moves to the root config. Before deleting, it ports the SEC-TC-43/61 assertions (incl. M2's `sql_drop` cases and F-05's planted names) into its C13/C14/SEC-TC-43 suite. For the anchor files, **either** TASK-021 also deletes them and moves the golden vectors plus the `derToP1363`/JCS/ORDER-BY regression cases into a pure unit test under `packages/audit` (no DB, so no collision) for TASK-033/116, **or** TASK-021 adapts the anchor suite to the real bootstrap tables. Name the due point ("in TASK-021's PR") and ask the orchestrator to add a matching DoD line to the TASK-021 sheet and a DECISIONS entry |
| m1 | MINOR | `spk08-audit-owner.int.test.ts:459-476, 577-596, 605-609` | Key recorded results are not asserted. (a) F-01's premise, "(b) parents-only → P3005", sits behind `if (parentsOnly.status !== 0)`, so the test passes either way. (b) "The shadow DB receives extensions, `platform` and the audit tables" exists only in `report['exit4_diff'].shadowAfter`. (c) Both "no audit object" checks are negative regexes over stdout or concatenated SQL, so they pass vacuously on empty output, e.g. if `migrate dev` created no migration. F-02's failure mode (second run without the DROP) is recorded from run 1 only | Assert `parentsOnly.status === 1` and `P3005`. Assert `shadow` (`extensions` = the three, `platformSchema` = '1', `auditRelations` ⊇ `audit_entries`, `audit_partitions`). Assert `created.length === 1`, and that the diff and migration contain `ix_role_permissions__role_id` (this also pins F-04). Optionally add an F-02 negative control: render without the DROP and run twice → "already exists" |
| m2 | MINOR | `SPK-08.md` §5.3 vs §7 | Two finding series share one namespace: F-1..F-12 (anchor) and F-01..F-10 (owner). F-7 ≠ F-07, F-1 ≠ F-01, F-2 ≠ F-02. The PR body says "Anchor F-1/F-2", and D-TASK012-01 cites "F-01..F-10" but leaves out the anchor series. TASK-033 receives items from both | Renumber the anchor series (e.g. `AF-1..AF-12`) and update the PR body and D-TASK012-01 wording |
| m3 | MINOR | `SPK-08.md` §8–§9 | Routed items carry owners but no due points. F-01/F-02/F-03 must land before TASK-021 starts (D-TASK012-01 says so; §9 does not). A-2/A-3/A-4 (byte layouts, JCS, timestamp form) must be ratified before TASK-033 writes the first anchor, because they are hash inputs and changing them later breaks every stored anchor. A-1/A-6/A-7 are due before TASK-116. The RDS M5 checks (§6.1 a–f, §6.2 a–d, §6.3, §6.4) are not mirrored into STATUS COND-G4-PROD, which mentions only "SPK-08 RDS C13(b) parity" | Add a "due" column to §7 and to the §9 bullets. Ask the orchestrator to extend COND-G4-PROD with the event-trigger upgrade drop/re-create, the `session_replication_role` check, and the `rds.allowed_extensions` check |
| m4 | MINOR | `SPK-08.md:367` (F-04) | The finding presents known, documented drift as new and proposes "document the index as raw-SQL-only", which data-model §7.3 A17 and the `authz.prisma` header already do. It misses the real gap. A17's catalog drift check tolerates the index **by name**, so a committed generated migration that drops it and re-creates it without INCLUDE passes everywhere and silently loses the covering column (AP-AUTHZ-02) | Cite §7.3 A17 / D-T013-09. Route a concrete TASK-016 linter rule: a migration may not `DROP INDEX` a name on the covering-index tolerance list unless the same file re-creates it with `INCLUDE`. Alternatively, the catalog check compares `pg_index.indnkeyatts < indnatts` for the tolerated names |
| m5 | MINOR | `SPK-08.md:176, 217` | Drafting residue in the record. §5 still contains the specialist hand-off line "For the lead to merge into `docs/04-plan/spikes/SPK-08.md`. Date 2026-11-12.", and the §5 date and PG lines duplicate the header. F-7 points to "§4 A-1", but A-1 is in §5.4. §6.1 has first-person "I took this quote from a search-result snippet" | Remove the hand-off line, fix the cross-reference to §5.4, and phrase the snippet caveat impersonally ("quoted from a search snippet; page not opened") |
| n1 | NIT | `spk08-audit-owner.int.test.ts:523-525`; `:332-343` | Time dependence. The generated window is hard-coded to 2026–2030 (fails after 2030-12). `expect(created).toBe(3)` fails if the suite crosses a UTC month boundary between `beforeAll` and the test. Harmless for a short-lived spike | Derive the window from `new Date()`, as F-01 recommends for the real config |
| n2 | NIT | `spk08-audit-owner.int.test.ts:404-444, 599-610, 183-188` | Isolation. The hijack plants and marker table are dropped outside `finally`, so a failed assertion leaves them for the exit-3/4 tests. Exit 4 `migrate dev` silently needs exit 3 to have deployed first (`-t "exit 4"` fails). `afterAll` calls `rmSync(workDir)` before `pgh?.stop()` and throws if `start()` failed | Use `try/finally` cleanup; deploy in an exit-4 `beforeAll` (or document the order); guard `workDir` |
| n3 | NIT | `spk08-anchor.int.test.ts:480-491` | The golden vectors that §5.2 publishes for TASK-033/116 are written to the report but not `expect`-ed (only the empty digest is). They are correct (§1) | Pin both hex values in the test |
| n4 | NIT | `spk08/10-audit.sql:8`, `spk08/90-audit-ddl-guard.sql:5` | `-- @audit-ddl security-approved: spike-only (SPK-08) 2026-11-12` mimics the security-approval marker without an approval. It fails closed in the linter, but `grep security-approved` audits will count it | Replace it with `-- NOT security-approved (SPK-08 prototype); the bootstrap file needs the rule-12 @audit-ddl marker` |
| n5 | NIT | `spk08-anchor.int.test.ts:511-529` | The openssl cross-check skips silently when `openssl` is absent and the test still passes. That is acceptable, but the record should say which run had it (it does, in the §5.2 header) | None required. Optionally fail when `SPK08_REQUIRE_OPENSSL=1` |
| n6 | NIT | `SPK-08.md` §9 F-02 bullet | The amendment should add one sentence: the `DROP SCHEMA … CASCADE` relies on the migrator owning the shadow database and its `platform`, and fails closed (42501) if `SHADOW_DATABASE_URL` points at a real database, where `platform_schema_owner` owns `platform`. It also covers objects that *migrations* create in `platform` (PR #11 helpers) | Add the sentence |
| n7 | NIT | `SPK-08.md` §9 | The data-model §7.3 "Verify in P5 spike" notes (partitions ignored by the differ: yes, but they count for P3005; the hook exists and runs: yes) are not explicitly listed as closed | List them in §9 so the architect strikes them |

## 4. Deviation rulings

| Deviation | Ruling |
|---|---|
| Sheet DoD "throwaway code is not merged". The PR merges 5 spike code files | **Accepted conditionally**, per the SPK-03 / PR #7 m7 precedent (spike suite kept as executable evidence, then ported and deleted). The condition is M3: a complete, per-file plan with a feasible due point (TASK-021's PR) |
| Sheet "Files / modules" lists 3 files; the PR adds `spk08/{10-audit.sql, 90-audit-ddl-guard.sql, prisma.config.ts, anchor-prototype.ts}` | Accepted. These are fixtures and helpers of the listed tests, test-scoped, and documented in the record |
| Sheet DoD migration items (expand-only, `down.sql`, RLS manifest, classification, backup rehearsal) | N/A: the PR adds no migration (verified by the diff) |
| Sheet DoD "hosted `security-integration` job runs on the PR" | That job does not exist yet (the bootstrap deferral recorded in earlier batches). The developer ran the integration suite locally. Merge condition 3 |
| SEC-TC-43 "dynamic-SQL bypass blocked by the event trigger", observed blocked by privilege instead | Accepted as a correct finding (F-05), not a gap. Defence in depth still requires the guard path to be proven for each event type (M2) |

## 5. Good (keep)

- **Verbatim prototype.** The SQL is a byte-faithful copy of the spec (normalised diff empty), so the GO really tests the specified design, not a variant.
- **Outcome classification.** `classify()` separates privilege from guard by message, the dynamic `DO … EXECUTE` form splits the literal at `audit_`, and the test asserts direct = dynamic message. That is exactly the evidence F-05 needs. F-10 rightly offers it as TASK-033's pattern.
- **Positive controls everywhere.** The hijack plants first resolve in the migrator's own session (two markers) before the test shows `ensure_audit_partitions` never calls them. `spk08_control` shows the guard admits ordinary DDL. A deliberately broken `initShadowDb` proves the hook runs.
- **Anchor rigour.** A fresh cloned DB per scenario. The attacker model is the real one (superuser plus `session_replication_role = replica`). The ORDER-BY-alias trap is caught at anchor 10, fixed with qualified columns, and covered by a regression at 1,000→1,001. Microsecond timestamps are rendered by PostgreSQL (F-2). The DER→P1363 conversion is fuzz-clean.
- **Key hygiene.** The private key never leaves memory, only public material reaches a temp dir, and nothing secret goes into the report.
- **Desk research.** Primary sources are quoted with access dates, there is a code-level reading of `event_trigger.c`/`user.c`, every UNCLEAR is stated as such, and each item ends with a concrete M5 check.
- **Spec contradictions surfaced with proposed wording** (A-1..A-7), e.g. A-2: ADR-0007 am. 6 vs data-model §5.5 field order (verified).

## 6. Security flags (for security-analyst)

1. **M2.** The `sql_drop` half of the identity guard (SEC-P3-03 / SEC-P3-27 second layer) is unproven at the spike level. The GO for am. 7/8 currently rests on `ddl_command_end` evidence plus privilege.
2. **RDS `session_replication_role` (§6.1).** Any `rds_superuser` member can suppress origin-mode event triggers and the audit row triggers per session. `ENABLE ALWAYS` for both event triggers and the audit triggers is proposed for TASK-021. This needs an architect/security decision, not just an M5 check, because it changes the bootstrap DDL TASK-021 writes.
3. **§6.2 residual.** The RDS master's surviving ADMIN row lets it re-grant `SET` on `platform_audit_owner` at will. Immutability against the master is detective only (anchors plus a locked sink). This is consistent with RR-04 and should be confirmed in the COND-G4-PROD wording (m3).
4. **n4.** The pseudo `security-approved` marker in non-approved SQL.

## 7. Merge conditions

1. M1–M3 closed in-PR (M1 and M3 can be closed in the document alone; M2 needs one test), with m1–m5 fixed or explicitly routed. Round 2 re-checks: the new `sql_drop` test results, the per-file lifecycle table, the M1 answer or routing, and the m1 assertions.
2. D-ORCH-015: merge after PR #10 (lane A), and confirm a lane-A run on the final head (the rollup is empty now).
3. The `security-integration` deferral remains on record for this PR (sheet DoD line 3). security-analyst reviews flags §6.1–§6.2.
4. Orchestrator: add the TASK-021 sheet DoD line "delete/port the SPK-08 spike files" (M3) and extend COND-G4-PROD (m3). Architect: F-01/F-02 amendments before TASK-021 starts. A-2/A-3/A-4 before TASK-033.

## 8. Watchlist / follow-up routing

- **TASK-021:** spike deletion/port (M3); F-01 window, F-02/F-03 rendering, `ck_audit_anchors__key_id`, the `ENABLE ALWAYS` decision; the M2 `sql_drop` cases in its suite.
- **TASK-016 (PR #11 or follow-up):** the m4 covering-index rule; the F-08 `audit_*` naming rule.
- **TASK-033:** F-05/F-07/F-10, the fail-closed guard test (§8 Q1), and the AF-series writer pitfalls (alias ORDER BY, µs timestamps, uuidv7 under the lock).
- **TASK-116:** A-1 precedence, A-6/A-7, F-2 text timestamps, the (iii)(b) `EXPLAIN` at volume.
- **Architect:** A-1..A-7; M1 if re-routed; close the §7.3 "verify in P5 spike" notes (n7).
