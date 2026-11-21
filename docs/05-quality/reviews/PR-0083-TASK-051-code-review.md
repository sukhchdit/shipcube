# Code review: TASK-051 guest-capable tables and atomic claim, operator staff grants (pre-push, round 1)

| Field | Value |
|---|---|
| Task | TASK-051 (US-080 DC, REQ-RLS-013, NFR-TENANT-001; AT-US-080-01..07 database halves; rulings §2.6/§2.7 cases G1-G7, T1-T5, S1-S4, C1-C6, R1-R4; PR7-SEC-04, PR7-SEC-12 (d), PR7-SEC-13; SEC-TC-07, SEC-TC-76; D-ARCH-162..166; PR65-SEC-02 (b), PR65-SEC-04 (a)) |
| Head | `203d02eb` (6 commits on main `e245e6e6`: `0467ea1b` guard function, `b55e9b6d` operator staff grants, `7be618aa` refused reference, `b34f954e` C16, `2e1c529f` guest binding and race, `203d02eb` prettier), branch `feat/TASK-051-guest-capable-tables-atomic-claim`; not pushed, no PR number yet |
| Reviewer | code-reviewer, 2026-11-21 |
| Bindings read | CLAUDE.md §5, §8, §9; brief `docs/04-plan/briefs/TASK-051.md` and its card; `rulings/wave-1-r-arch-34-operator-rulings.md` §2 (whole), §3.3-§3.5, §4.1, §7; ADR-0005 am. 10 items 11 and 15 and am. 14 items 31-36 (as quoted by the rulings); `render-rls.ts` and the three guest templates; `tests/generated/rls/probe.ts`; `with-tenant-tx.ts` `CONTEXT_STATEMENT_SQL`; `map-db-error.ts`; `expect-affected.ts`; `required-suites.json` (SEC-TC-07 pending in `rls-cross-tenant`), `suite-runners.json`, `trace.mjs`, `gherkin-test-map.md` rows AT-US-080-01..07; migration `20261117000000_organisations_identity` lines 401-428 |
| Main delta since base | `e245e6e6..origin/main` (`530629f4`) is docs and agent memory only; no file overlaps the branch |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: Both migrations are exactly the ruled text: the guard function equals the renderer's output and down.sql
         restores the original lifecycle body byte for byte. Every rulings §2.7 case, the 16 de-claim transitions,
         AT-US-080-06 and O1-O6 reproduce on PostgreSQL 17.5 (PGlite), and the operator-clause mutant is killed.
         One MAJOR: C16 (b), the gate for the TASK-087 quote tables, passes a NULLS NOT DISTINCT unique index through
         either owner column, which reopens the PR65-SEC-01 channel (proven: 23505 for a held value, 23503 for a free
         one). Four MINOR, six NIT. Lane B on PostgreSQL 18 at 203d02eb is red: C2 and C6 answer 23001 (a PostgreSQL 18
         observation that goes to principal-architect) and gitleaks-full finds one unbaselined secret in the ancestry.
```

Scope: every file is on the card or the brief. The operator staff grant migration is the card's second migration (D-SD-003). The probe module `prisma/tests/harness/guest-claim-probe.ts`, the race test in `tests/generated/rls/` and the `tests/generated/tsconfig.json` file-list line are what the suite placement needs (D-TASK051-05). No file locked by TASK-040 or TASK-041 is touched, and `package-lock.json` is unchanged.

## 1. What I verified myself

Host rules of the dispatch: foreground only, one command at a time, timeouts of 8 minutes or less, no Docker, nothing run in the PR worktree. Everything ran in a `git archive 203d02eb` extract in the session scratchpad. `node_modules` was junctioned to the idle `Shipqube-STORIES-085-086` worktree, whose `package-lock.json` md5 (`7e5ffed3`) equals the head's. `@platform/*` junctions under the extract's `apps`, `packages`, `tests`, `prisma` and `tools` point at the extract's own packages. `prisma generate` wrote only the extract's `prisma/generated`. The `tsBuildInfoFile` of `tools` and `tests/generated` was redirected inside the extract. The PR worktree was never touched.

| Check | How | Result |
|---|---|---|
| Types | `tsc -b tools tests/generated prisma` (this builds `apps/api` and the referenced packages; `tools` type-checks `prisma/tests/**`) | Clean |
| Lint | `eslint --max-warnings 0` on the 14 changed `.ts` files (repository config, type-aware) | Clean |
| Format | `prettier --check` on every changed `.ts`/`.json` file (`.sql`, `.prisma` and `.manifest` have no parser) | Clean |
| Unit tests | `--testPathPatterns` over `tenant-keys.test`, `guest-claim-probe.test`, `map-db-error.test`, `refused-reference-answer`, `grants-manifest.test`, `tenant-db.real-client`, `render-rls.test`, `table-classes` (`--maxWorkers=2`) | 8 suites, 127 tests pass |
| Migration linter | `tsx tools/db/lint-migrations.ts` | No findings; `prisma validate` passes |
| Migration 2 vs ruling | `diff` of `20261120210000_operator_staff_grants/migration.sql` against rulings §3.4 item 1 | Identical except the markdown fence |
| down.sql vs original | `diff` of `down.sql` lines 4-24 against `20261117000000_organisations_identity/migration.sql` lines 406-426 | Identical except `CREATE` -> `CREATE OR REPLACE` |
| Migration 1 vs renderer | PGlite: `pg_proc.prosrc` of the migrated `platform.guest_capable_guard()` equals the `$$` body of `renderGuestCapableGuardFunction()`, and `migration.sql` contains the renderer's output verbatim | Both true |
| Apply on PostgreSQL 17.5 (PGlite) | `prisma/bootstrap/*.sql` and all 9 migrations, statement by statement through `tools/db/sql-text.ts` `splitStatements`, as `platform_migrator` (`uuidv7()` -> `gen_random_uuid()`, extensions created by hand) | All apply. Guard function: owner `platform_migrator`, not SECURITY DEFINER, `search_path=pg_catalog, pg_temp`, no EXECUTE for `platform_app`. `operator_staff_grants`: owner `platform_migrator`, no RLS, `platform_app` holds SELECT only. Lifecycle function: unchanged owner, definer flag and `proconfig` |
| Rulings §2.7 replay | `plantGuestClaimProbe` and `seedQuote` from the PR's own module through a pg-shaped adapter; every case in its own rolled-back transaction as `platform_app` with `CONTEXT_STATEMENT_SQL` | G1-G7, T1-T5, S1-S4 (both owners), R1-R4, C1-C6: all 28 match the expected codes and constraint names of the test file. AT-US-080-06: `42501` WITH CHECK on `gc_quotes`. Extra: the claim statement under organisation A with the empty guest binding touches 0 rows (D-TASK051-07, write side) |
| De-claim guard | The 4 forbidden transitions on each of the 4 tables as the superuser, plus the legitimate claim | 16 x `23514 GUEST_DECLAIM_FORBIDDEN`; the claim touches 1 row |
| O1-O6 | `operatorStaffGrants` from `cases.ts` in a rolled-back transaction | Every assertion of the test holds (O1 `P0001 ... needs a staff grant`, sees 1; O2 `42501`; O3 ok, 1 row, ok, ok, ok, sees 3; O4, O5, O6 as expected) |
| Operator-clause mutant (brief scope note 10) | The same run with the `NOT EXISTS ... operator_staff_grants` clause cut out of migration 2 | O1 becomes `ok` and sees 3, so both O1 assertions fail: the mutant is killed |
| Up-down-up of migration 2 | `down.sql` twice (prefix-idempotent), then `migration.sql` | After down, `prosrc` equals the original body and the table is gone. After up again, `pg_get_functiondef` equals the first up |
| Down of migration 1 with GUEST_CAPABLE tables present | `down.sql` while the `gc_` triggers exist | `2BP01`, as the down header says (the table migration is reverted first) |
| C16 gap probes | See R1-M1 and R1-m1 | Reproduced |
| Not re-run by me | every `*.int.test.ts` on PostgreSQL 18, AT-US-080-07 (`RETURNING old.*/new.*` is PostgreSQL 18 only), the SEC-TC-07 race (PGlite has one connection), full `test:unit`, coverage, lane A | Relied on the lane B run below |
| Lane B evidence (read only, after my run) | `docs/05-quality/tests/runs/20261121T0336Z_203d02e/` in the PR worktree (`summary.json`: `git_sha` `203d02eb`, `git_dirty` false; profile `pr`), uncommitted at the time of this record | **Verdict FAIL.** Passing: `unit` 8274 (2 skipped), `api` 179, `catalog-c1-c14` 116 (C16 incl. the planted T2-G and arm (b) probes), `migrations` 30 (up-down-up), `rls-cross-tenant` 159 (both SEC-TC-07 race tests), merged coverage 99.48 % lines / 97.3 % branches. `integration` 477 with 4 failures: **C2** and **C6** of `guest-claim.int.test.ts` receive `23001 fk_gc_quote_packages__guest_token_hash_quote_id` and `23001 fk_gc_quote_shares__guest_token_hash_quote_id` where rulings §2.7 (probed on 17.5) says `23503`; both `gitleaks-full.int.test.ts` cases find one more fingerprint than the baseline over the ancestry of `203d02eb`. The other 55 of the 57 `guest-claim.int.test.ts` cases (incl. AT-US-080-06/07 and the 16 de-claim cases) and O1-O6 passed on 18 |

Side effects disclosed: `prisma generate` and `lint-migrations` refreshed the git-ignored `node_modules/.cache/jiti` of the junction target (`Shipqube-STORIES-085-086`), which is harmless. The extract and its junctions are removed after this record.

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-M1 | MAJOR | `prisma/tests/catalog/tenant-keys.ts:183-196` (`TENANT_UNIQUE_INDEXES_SQL`, `has_owner`), `:207-217`; planted list `:346-355` | C16 (b) counts an owner column in the key as owner scoping whether or not it separates owners. On a GUEST_CAPABLE table both owner columns are nullable, and a unique index created `NULLS NOT DISTINCT` (PostgreSQL 15+) treats every row whose owner column is NULL as one owner. **Probe (PGlite, the PR's `gc_` tables):** `ux_gc_quote_packages__guest_quote_seq` recreated as `(guest_token_hash, quote_id, seq) NULLS NOT DISTINCT`: C16 (b) reports nothing; organisation B inserting a package that names A's quote gets `23505 ux_gc_quote_packages__guest_quote_seq` for a `seq` A holds and `23503 fk_gc_quote_packages__org_id_quote_id` for a free one. The mirror (`(org_id, quote_id, seq) NULLS NOT DISTINCT`, guest H1 naming H2's quote) gives the same split. This is exactly the L1/L4 channel of rulings §2.1 (PR65-SEC-01), and §2.4 rests on "NULLs are distinct". C16 is named as the gate for TASK-087 (rulings §6, TASK-087 line), and a single index with `NULLS NOT DISTINCT` is the obvious wrong way to "cover both owners" that U2 forbids. Second shape, same root cause: an exclusion constraint whose owner column uses an operator other than `=` (`EXCLUDE USING gist (org_id WITH <>, quote_id WITH =)`; `btree_gist` is installed by `prisma/bootstrap/01-schemas.sql`). It reads `has_owner = true`, and organisation B naming A's quote gets `23P01` against `23503` for an unknown id (probed). No committed index has either shape today (checked), so the fix adds no committed finding. | Count an owner column only when it separates owners: (i) for a unique index, it is NOT NULL or the index is not `indnullsnotdistinct`; (ii) for an exclusion constraint, its operator at that key position (`pg_constraint.conexclop`) is an equality operator. Return the two facts as columns and decide in the pure function, so `tenant-keys.test.ts` drives them with fixtures. Add planted probes on `c16_gparent`: `UNIQUE NULLS NOT DISTINCT (guest_token_hash, code)`, `UNIQUE NULLS NOT DISTINCT (org_id, code)` and `EXCLUDE USING gist (org_id WITH <>, code WITH =)` are reported. Add the same to the header's description of arm (b). This is fail-closed and stricter than the literal §2.6 text, like D-TASK051-03, so principal-architect confirms it (section 4). If the architect prefers, the exclusion-operator half may become a third stated limit instead. The NULLS NOT DISTINCT half may not. |
| R1-m1 | MINOR | `prisma/tests/catalog/tenant-keys.ts:155-171` (`tenantReferenceFindings`, `referenceExceptionFindings`), `:43-48` | `TENANT_REFERENCE_EXCEPTIONS` is "T2-O entries only", but nothing enforces the T2-O shape. An entry hides any reported key and counts as live whatever the violation kind. **Probes on the `gc_` schema:** (1) after `ALTER TABLE gc_quotes DROP CONSTRAINT ck_gc_quotes__requote_org_only`, the T2-O entry still hides `fk_gc_quotes__requote_of_quote_id` and is still live. Without that CHECK, a guest row can hold a re-quote reference that MATCH SIMPLE never checks: the L5 shape. (2) A single-column key `fk_gc_quote_options__quote_id` named in the map is hidden and live. Entries need an architect ruling, so this is a defence-in-depth gap. The first entry arrives with TASK-087. | Make liveness kind-aware: an entry is live only for a key reported as "org-bound without a guest-bound sibling" (return a `kind` from `referenceViolations`). Verify the justifying CHECK in the catalog: the child carries a validated CHECK named `ck_<child>__<x>_org_only`, or the map value names the CHECK and the int test checks it exists, is validated, and the key's column appears in it. Add both probes above to the T2-O test. |
| R1-m2 | MINOR | `prisma/sql/policy-templates/guest-capable-guard-function.sql:1-4`; `prisma/migrations/20261120200000_guest_capable_guard/migration.sql` | The function now exists twice: the migration (what every database runs) and the template (what `render-rls.test.ts` checks). `tests/generated/rls/probe.ts:106` renders the template only when the function is missing, which no longer happens on a migrated template. They are byte-equal today (verified), but nothing pins it. A later template edit would pass every test and change nothing in any database. The template header still says "Rendered ONCE (TASK-051 ships it, before the first GUEST_CAPABLE table)". | Add a host unit test (in `render-rls.test.ts` or `guest-claim-probe.test.ts`): `migration.sql` of `20261120200000_guest_capable_guard` contains `renderGuestCapableGuardFunction()` verbatim. Update the template header: shipped by that migration, changing it requires a new migration. |
| R1-m3 | MINOR | `prisma/tests/rls/guest-claim.int.test.ts:430-433` | AT-US-080-03 is "Null org_id only on flagged tables". The comment says "The only nullable org_id columns are those of the GUEST_CAPABLE probe tables", but the assertion is `arrayContaining(GC_TABLES)`, which says nothing about other tables. The claim is also false: `audit_entries` and its partitions have a nullable `org_id` (PGlite catalog query). The test pins "no TENANT table" and "the probe tables are nullable", but not "only flagged tables". A new USER_OWNED, GLOBAL or unlisted table with a nullable `org_id` passes. | Assert the set: every table with a nullable `org_id` is GUEST_CAPABLE in the manifests, or is `audit_entries` (SYSTEM, with its partitions, by `relispartition`/`pg_inherits`) on an explicit list with its reason. Fix the comment. |
| R1-m4 | MINOR | `apps/api/src/platform/db/map-db-error.test.ts:191-224`; `tools/repo/refused-reference-answer.test.ts:22` | Lane B on PostgreSQL 18 shows that a parent-side `RESTRICT` action answers `23001 restrict_violation`, not `23503` (C2, C6). Every key of the project is `ON DELETE/UPDATE RESTRICT`, so on 18 a refused reference comes in two SQLSTATEs. `mapDbError` already gives `23001` the same 500 `DB_ERROR` through its fallthrough, so E1 holds in fact. But the deep-equal pin covers `23503` only, and the D-ARCH-164 tripwire does not look for `23001`. A future `if (sqlState === '23001')` in a repository is invisible to both. | Add `23001` (raw, under `P2010`) as a third pair to the deep-equal test (two constraint names give the same mapping, with no constraint text), and add `23001` to `FK_CODE` with its control rows. Wording of D-ARCH-164 E1/E2: section 4 item 6. |
| R1-n1 | NIT | `prisma/tests/catalog/c16-tenant-keys.int.test.ts:103-114`; `tenant-keys.ts:295-315` | The both-owner-columns rule (D-TASK051-03) is proven only on fixture rows. The SQL that computes `org_bound` and `guest_bound` together for one key is never planted. | Plant `c16_g_both (org_id, guest_token_hash, parent_id) -> c16_gparent (org_id, guest_token_hash, id)` (the parent needs that unique key) and add it to `PLANTED_GUEST_REFERENCE_FINDINGS`. |
| R1-n2 | NIT | `prisma/tests/harness/guest-claim-probe.ts:14-16` | "PostgreSQL fires the referential triggers in name order (creation order)". The RI trigger names are `RI_ConstraintTrigger_<a/c>_<oid>`, so the order is the text order of the OIDs. That equals creation order only while the OIDs have the same number of digits. Only C2 depends on it (C3 and C6 can fail on one key only). | Say "name order, which is OID text order and equals creation order while the OIDs have the same width". Or make C2 accept any of the three children's guest keys and assert separately that the packages key is among the deferred violations. |
| R1-n3 | NIT | `tests/generated/rls/guest-claim-race.int.test.ts:150-151, 180` | On the failure paths, a rejected `pending` (when `waitForLockWait` throws first) or the second `runs[]` promise (when `Promise.race` rejects) is never awaited. The test then dies with an unhandled rejection instead of its own message. | Attach `.catch(() => undefined)` to the promise you may abandon, or `Promise.allSettled` both in `finally`. |
| R1-n4 | NIT | `tools/repo/refused-reference-answer.test.ts:20-22` | The tripwire is lexical: it sees `P2003`/`23503` in `.ts`/`.js`/`.json` only. It misses what D-ARCH-164 E2 also forbids: mapping by constraint name, field name or message without naming the code (`error.meta?.constraint === 'fk_x'`, `meta.field_name`), or `'2350' + '3'`. This is acceptable as the ruled control. | Note the limit in the file header (the review of each repository is the backstop). Optionally also flag `meta.constraint`/`field_name` reads outside `map-db-error.ts`. |
| R1-n5 | NIT | `docs/05-quality/tests/gherkin-test-map.md:400-406` | The map puts AT-US-080-01..06 in `rls-cross-tenant` and 07 in `audit-generator`. The database halves live in `prisma/tests/rls` (the `integration` project), and only AT-US-080-05 is also in `rls-cross-tenant` (the race). `trace.mjs` does not enforce the suite, so nothing fails, but the map and the evidence disagree until the HTTP halves land. | For qa-lead: keep the map as the target suite, and list the HTTP halves owed by TASK-087/091/146 (the developer's report) in the trace notes. No change in this PR. |
| R1-n6 | NIT (INFO for security-analyst) | `prisma/migrations/20261120210000_operator_staff_grants/migration.sql:43-45` | The "fail closed" half of the operator clause (an organisation the session cannot see counts as OPERATOR) is unreachable for every runtime role. The lifecycle trigger is AFTER ROW, so a membership of an organisation outside the context is refused by WITH CHECK first. The mutant that turns it fail-open survives all tests. It is the ruled text, and the property is sound. | Nothing for this PR. Record the clause in the security review as defence in depth that no test can reach. |

### Lane B observations at `203d02eb` (not code defects of this PR; they block the merge until resolved)

- **L-1, PostgreSQL 18 differs from rulings §2.7 (C2, C6).** On 18, the claim that updates the quote first (C2) and the claim without the shares CTE (C6) fail with `23001` (`restrict_violation`) on the expected constraint, where the 17.5 probe of the ruling (and my PGlite replay) give `23503`. The constraint names match the ruling, and C3 (child-side check) is still `23503`. The test header says such an observation goes to principal-architect unadapted, and the developer did not adapt it. That is correct, and it must stay so until the architect amends §2.7. The ruling text "a claim that forgets a child table fails with 23503" (§2.3) and the TASK-146 card line ("fails with 23503 by design") change with it. Expected outcome: the architect amends §2.7 C2/C6 to `23001` on 18, and the developer updates the two expectations in a follow-up commit that cites the amendment. R1-m4 is the code-side consequence.
- **L-2, `gitleaks-full` finds one fingerprint more than the 17-line baseline over the ancestry of `203d02eb`.** The JUnit carries only the count (redacted). TASK-040's lane B at `2abd665` was clean. Its ancestry lacks the 9 docs commits `728599e0..e245e6e6` of main and this PR's 6 commits, so the finding is in one of those 15. If it is on main, every branch cut from `e245e6e6` inherits it: the orchestrator triages it from the lane B report and routes it to security-analyst (baseline entry or removal). The commits are not pushed, but the guardrails forbid history rewrites, so a finding inside this PR's commits also goes through security-analyst. The brief warned that no secret-shaped literal may appear in tests. Nothing in my read of the diff is an obvious secret. The nearest generic-key shape is `claimed_from_token_hash = guest_token_hash` in `guest-claim-probe.ts:133` (low entropy).

Follow-up (no finding): SEC-TC-07 sits in `required_cases_pending` of `rls-cross-tenant`. The test now exists in the suite's runner path (`tests/generated/rls/`). By the file's own rule, qa-lead returns it to `required_cases` at the first activation checkpoint after this task merges (v0.1.0-m0 at the latest).

## 3. Rulings on the developer decisions

| Decision | Ruling |
|---|---|
| D-TASK051-01 (no template renamed; GUEST_CAPABLE already renders from `guest.sql` and the two guard templates) | **Accepted.** It matches brief scope note 1, and the renderer output was verified against the migration. See R1-m2 for the pin that keeps them together. |
| D-TASK051-02 (siblings match by equal column-to-column "rest", not containment; pure rules with a host unit test) | **Accepted.** It is what rulings §2.6 says ("same remaining columns"), stricter than containment for T2-N, and the fixture suite covers table pair, parent and rest mismatches. |
| D-TASK051-03 (a key holding both owner columns is reported and is nobody's sibling) | **Accepted. For principal-architect to confirm** (section 4). Under the owner CHECK, one owner column is NULL on every row, so a MATCH SIMPLE key over both is never checked (and a MATCH FULL key would refuse every row). Reporting it is the only safe reading. Plant it as well (R1-n1). |
| D-TASK051-04 (the swapped guest probe targets a second bytea parent column; its `(digest, id)` target is an arm (b) finding) | **Accepted.** `guest_token_hash` cannot pair with a uuid, so this is the only buildable "swapped" shape, and the extra arm (b) finding is listed. |
| D-TASK051-05 (probe module in `prisma/tests/harness`; race in `tests/generated/rls`) | **Accepted.** It is the only placement that credits SEC-TC-07 to `rls-cross-tenant` without touching the locked `eslint.config.mjs`. The `tests/generated/tsconfig.json` file entry type-checks, and the plant refuses to create the guard function itself. |
| D-TASK051-06 (AT-US-080-06 expects `42501`) | **Accepted. Confirmed on PostgreSQL 17.5 (PGlite) and on 18 (lane B at `203d02eb`).** The guest USING admits the row, and neither WITH CHECK admits `org_id` set while `app.org_id` is empty. Reproduced: `42501` WITH CHECK on `gc_quotes`, nothing changed. The brief allowed either outcome as long as it was recorded, and it is recorded. For the architect only as confirmation that the HTTP half (TASK-146) answers 401 before any database call. |
| D-TASK051-07 (route-side guest binding owed by TASK-091/TASK-146; database half proven) | **Accepted as a deferral, with a condition.** The database side holds: the empty binding reads 0 guest rows under every context (AT-US-080-02 rows), and I added the write side: the claim under organisation A with `''` touches 0 rows. The card's line "app.guest_token_hash is non-empty only on routes declaring tenancy: guest and on the claim operation" is not met by this PR, and no TASK-091/146 card names it today. Merge condition 5. |
| D-TASK051-08 (claim repository is TASK-146's; here the outer count goes through `expectAffected`) | **Accepted.** C1, C4, C5, AT-US-080-04/05 and the race read the outer count through `expectAffected`. `expect-affected.test.ts` already pins that 0 rows raise. |
| D-TASK051-09 (S3/S4 for both owners; R1-R4 included) | **Accepted.** It goes beyond §2.7 in the safe direction. |

## 4. For principal-architect

1. **D-TASK051-03:** confirm that a foreign key holding both owner columns is a C16 (a) finding and never a sibling, and add the sentence to data-model §4.6 C16 (a).
2. **R1-M1:** confirm the arm (b) refinement: an owner column counts only if it separates owners (`NULLS NOT DISTINCT` on a nullable owner column, or a non-equality exclusion operator, means no owner). Rule whether the exclusion-operator part is enforced or becomes a third stated limit. The §2.4 rationale ("NULLs are distinct") should name `NULLS NOT DISTINCT` as excluded, and U2 should say the two indexes are `NULLS DISTINCT`.
3. **R1-m1:** whether a T2-O exception entry must name its CHECK, so that C16 can verify the CHECK is present and validated.
4. **D-TASK051-06:** acknowledge `42501` for the hash-only claim context. Lane B on 18 confirms it.
5. **L-1 (PostgreSQL 18 observation):** C2 and C6 answer `23001 restrict_violation` on 18, not `23503`, on the expected constraints. Amend rulings §2.7 (C2, C6), the §2.3 sentence about a forgotten child table, and the TASK-146 card line. Also confirm that the claim repository (TASK-146) treats `23001` like `23503` (a defect, 500).
6. **R1-m4 / D-ARCH-164:** E1 and E2 name `23503` (and `P2003`) only. On 18, every refused `RESTRICT` action is `23001`. Extend E1/E2 to "`23503` or `23001`".

## 5. Merge conditions

1. **R1-M1 fixed** (SQL facts, pure-rule fixtures, planted probes, header). Architect item 2 answered, or the exclusion half recorded as a stated limit by the architect. R1-m1 to R1-m4 fixed or routed with an owner. NITs at the developer's discretion.
2. **L-1 and L-2 resolved:** the architect amends §2.7 C2/C6 (section 4 item 5), and the two expectations change in a commit that cites the amendment. The extra gitleaks fingerprint is attributed and closed by security-analyst (baseline entry or removal).
3. **Lane B green on PostgreSQL 18 at the final head.** At `203d02eb` everything below was already green except C2, C6 and gitleaks-full: `prisma/tests/rls/guest-claim.int.test.ts` (every §2.7 case with the expected constraint names, the 16 de-claim transitions, AT-US-080-01..07, including 07, which only PostgreSQL 18 can run), `tests/generated/rls/guest-claim-race.int.test.ts` through the `rls-cross-tenant` runner (`--selectProjects generated`; SEC-TC-07, the deterministic lock wait and 5 rounds), `prisma/tests/catalog/c16-tenant-keys.int.test.ts`, `prisma/tests/organisations/organisations.int.test.ts` (O1-O6), catalog C1-C12, C10 and C15, `prisma/tests/migrations/up-down-up.int.test.ts`, `prisma/tests/shadow/shadow-init.int.test.ts`, `prisma/tests/seed/seed.int.test.ts` and the whole generated RLS suite. The operator-clause mutant is reported from lane B by the developer (brief scope note 10). My PGlite run above (killed) is supplementary.
4. **security-analyst record** on the final head: SEC-TC ids for O1-O6 and the guest-binding cases (rulings §7 item 3), plus the items in SECURITY-FLAGS. Security-owned paths changed: `prisma/**` (2 migrations, schema, `grants.manifest`, tests), `tools/db/**` (`grants-manifest.test.ts`, `table-classes/organisations.json`), `apps/api/src/platform/**` (`map-db-error.test.ts` only), `packages/shared/src/classification/registry.ts`.
5. **MERGE PREREQUISITE TASK-293** is met (PR #72 on main); the orchestrator re-checks it at merge.
6. **Route-side binding (D-TASK051-07) is on the TASK-091 and TASK-146 cards** (senior-developer fold): `app.guest_token_hash` is non-empty only on `tenancy: guest` routes and the claim operation, and every other route binds `''`. Also list the HTTP halves of AT-US-080-01..07 there.
7. **Union merges (whoever merges second re-merges main, keeps both sides, sums counts):**
   - `prisma/sql/grants.manifest`: TASK-040 (`20261120100000_idempotency_keys`), TASK-043 (`20261120000000_outbox_events`) and TASK-080 (`20261121000000_pricing_config_versions`) all append at the end. Keep every block in migration-timestamp order.
   - `tools/db/grants-manifest.test.ts`: union the sorted tuple list, the `readOnly` list (this PR adds `operator_staff_grants`) and the `it(...)` title, which each task extends.
   - `packages/shared/src/classification/registry.ts`: keep every table block.
   - `prisma/tests/rls/tenant-db.real-client.test.ts`: TASK-080 also extends the delegate list. Keep both `operatorStaffGrant` and TASK-080's model, sorted.
   - Migration order: this PR's `20261120200000`/`20261120210000` sort after TASK-043's and TASK-040's and before TASK-080's `20261121000000`. No dependency exists between them. `check-migration-immutability.mjs` has no ordering rule for `prisma/migrations`, so either merge order works. After each union, re-run C16 (b) (any new TENANT table with a unique key is in scope) and the grants pins on lane B.
8. **Merged before TASK-089 opens its PR** (D-SD-003). TASK-089 depends only on the operator staff grant half. That half has no open finding: migration 2, O1-O6, up-down-up and the grant pins were all green on lane B at `203d02eb`. If R1-M1 or L-1/L-2 take longer than TASK-089 can wait, the orchestrator may split migration 2 and its pins into a PR of their own (R-CI-MIN prefers one PR; the call is the orchestrator's).

```
GOOD:
- Both migrations are the ruled text, checked mechanically: diff against rulings §3.4, byte-identical down body,
  prosrc equal to the renderer, and up-down-up stable.
- C16 finding rules are pure functions with a fixture suite that drives every branch and both exception paths.
  Liveness is checked for both maps, and the header states the two remaining limits honestly.
- The probe plant refuses to create the guard function, so the suite proves the migration, not the template.
- The SEC-TC-07 race uses a deterministic lock wait (pg_stat_activity) as well as simultaneous rounds, and reads
  winner, loser and token visibility through fresh platform_app connections.
- De-claim cases run as the superuser, so the trigger alone answers. Outcome strings distinguish the guard (message)
  from the owner CHECK (constraint), so each disjunct is pinned.

SECURITY-FLAGS:
- R1-M1: C16 (b) passes NULLS NOT DISTINCT owner indexes and non-equality exclusion operators (PR65-SEC-01 channel,
  SEC-TC-76 gate for TASK-087). Proven on the gc_ probe tables.
- R1-m1: T2-O exception entries are not kind-checked and their justifying CHECK is not verified (L5 shape if dropped).
- R1-m4: on PostgreSQL 18 a refused RESTRICT action is 23001; the D-ARCH-164 pin and tripwire cover 23503 only.
- L-2: gitleaks-full finds one unbaselined fingerprint over the ancestry of 203d02eb (main docs commits or this PR).
- R1-n4: the D-ARCH-164 repository tripwire is lexical (codes only).
- R1-n6: the fail-closed half of the operator clause is unreachable and unpinned (defence in depth, INFO).
- operator_staff_grants is readable by every platform_app session (staff user ids; ruled in §3.3, INFO).
- SEC-TC ids for O1-O6 and the guest-binding cases are still to be assigned (rulings §7 item 3).
```

---

# Round 2 (delta after fix cycle 1, and the v2 supersede)

| Field | Value |
|---|---|
| Heads | Old branch `feat/TASK-051-guest-capable-tables-atomic-claim` at `a79facce` (delta `203d02eb..a79facce`: `9d483b21` C16, `4e264a3b` operator rule on UPDATE and O7, `90f23f93` C2/C6 `23001`, D-ARCH-212 pins and AT-US-080-03, `a79facce` same-organisation race, template pin and probe notes). **v2 head `c1c8a6ec`** on `feat/TASK-051-guest-capable-tables-atomic-claim-v2`, one squash commit on main `530629f4`. Not pushed, no PR number yet |
| Reviewer | code-reviewer, 2026-11-21 |
| Bindings read | Round 1 above; rulings `wave-1-r-arch-34-operator-rulings.md` §3.4 as amended, §8.1 to §8.12 (D-ARCH-207 to D-ARCH-216; card lines §8.9); D-QG-005 (QG-051-C1 to C6); `PR-pending-TASK-051-security-review.md` (D-SECPR051-01, PR051-SEC-01 to -05, conditions C1 to C7, §7 SEC-TC table, §8 routing); D-PM-087; `plan-data.mjs` (TASK-051, TASK-146, TASK-237 lines) |
| Main delta | `530629f4..origin/main` (`7f7dcf52`, 25 commits) is docs and agent memory only. No file of the v2 diff changed on main, and `git merge-tree --write-tree c1c8a6ec origin/main` is clean |

```
VERDICT: APPROVED_WITH_NITS (bound to v2 head c1c8a6ec)
SUMMARY: Every round-1 finding is closed or routed, and every TASK-051 card line of rulings §8.9 is met: C16 (b) now
         counts an owner column only when it separates owners, T2-O entries are kind-checked and their CHECK verified,
         O7 kills the UPDATE-clause mutant, C2/C6 expect 23001, and v2 is the reviewed tree (merge-tree proof holds, the
         gitleaks shape is gone). One MINOR: the SEC-TC-79/80 tags of the security record are not in the titles.
         Lane B on PostgreSQL 18 at c1c8a6ec is still owed (C16 queries, 23001, the race rounds, gitleaks-full).
```

## R2.1 What I verified myself

Host rules of the dispatch were followed: foreground only, one command at a time, timeouts of 8 minutes or less, no Docker, nothing run in `Shipqube-TASK-051` (lane B). Everything ran in a `git archive c1c8a6ec` extract in the session scratchpad. `node_modules` was junctioned to the idle `Shipqube-STORIES-085-086` (its `package-lock.json` md5 `7e5ffed3` equals the head's). `@platform/*` junctions pointed at the extract's own packages. `prisma generate` wrote only the extract. The `tsBuildInfoFile` of `tools`, `tests/generated` and `prisma` was redirected inside the extract. The extract and its 76 junctions were removed afterwards, and the idle worktree still has 748 entries in `node_modules` and a clean status.

| Check | How | Result |
|---|---|---|
| Supersede: tree | `git merge-tree --write-tree a79facce 530629f4` and `git rev-parse c1c8a6ec^{tree}` | Both `6cc1ca4b1af707a743e66d4398bd80351b0e92e1`. Exit 0, no conflict |
| Supersede: shape | `git rev-list --count 530629f4..c1c8a6ec` = 1, no merge commit; parent `530629f4`; file set of `e245e6e6..a79facce` equals that of `530629f4..c1c8a6ec` (23 files); `e245e6e6..530629f4` touches none of them | Holds. The squash body carries D-TASK051-01 to -15 verbatim and cites D-ARCH-211 (as rulings §8.5 allows) |
| Supersede: gitleaks shape | A Node emulation of the default `generic-api-key` rule (the regex, entropy 3.5 and the `^[a-zA-Z_.-]+$` allowlist) over added lines. Control: `b34f954e` | Control reproduces L-2 exactly: `tenant-keys.ts:75`, secret `child=parent`, entropy 3.58. **v2 range `530629f4..c1c8a6ec`: 0 hits.** Each of the commits `e245e6e6..530629f4` of main: 0 hits. At `a79facce` and `c1c8a6ec` no file holds `child=parent`; `TenantReference.rest` is reworded. This is an emulation, not the pinned gitleaks image: gitleaks-full on lane B is the proof |
| Migration 2 vs ruling | `diff` of `migration.sql` at `a79facce` against the fenced block of rulings §3.4 item 1 as amended (D-ARCH-214) | Identical. `down.sql` is unchanged since round 1 |
| Types | `tsc -b tools tests/generated prisma apps/api` | Clean |
| Lint | `eslint --max-warnings 0` on the 14 changed `.ts` files of the v2 diff (repository config, type-aware) | Clean |
| Format | `prettier --check` on the 16 changed `.ts`/`.json` files | Clean |
| Unit tests | `--selectProjects unit --maxWorkers=2 --testPathPatterns` over `tenant-keys.test`, `guest-claim-probe.test`, `map-db-error.test`, `refused-reference-answer`, `grants-manifest.test`, `tenant-db.real-client`, `render-rls.test`, `table-classes` | 8 suites, 148 tests pass (127 in round 1) |
| Template pin mutant (R1-m2) | First `GUEST_DECLAIM_FORBIDDEN` of `guest-capable-guard-function.sql` changed in the extract; `guest-claim-probe.test` re-run | 1 failed, 7 passed: the pin kills it. File restored and `cmp`-equal to the head |
| PGlite 17.5 replay | `prisma/bootstrap/*.sql` and all 9 migrations statement by statement as `platform_migrator` (with `btree_gist`), then the PR's own modules (`cases.ts`, `tenant-keys.ts`, `guest-claim-probe.ts`, `table-classes.ts`) | See the next rows |
| O1-O7 | `operatorStaffGrants` and `operatorReactivation` in rolled-back transactions | O1-O6 as in round 1. O7: `P0001 MEMBERSHIP_LIFECYCLE_VIOLATION: an operator membership needs a staff grant`, sees 1; with the grant back `ok`, sees 3; customer `ok` |
| O7 mutant (card line "mutant by hand") | The same run with the new `WHEN NEW.status = 'ACTIVE' … THEN 'an operator membership needs a staff grant'` arm cut out of migration 2 | O7 becomes `ok` and sees 3: three O7 assertions fail, so the mutant is killed. O1-O6 are unchanged under the mutant (the INSERT arm stays) |
| C16 committed | Arm (a) with `exceptionCheckNames()` checks, arm (b) over `uniqueScope(loadTableClasses())` | No finding, every exception live. The live-grant index reads `owner_columns = [{org_id, not_null: true, equality: null}]` |
| C16 planted (both arms) | Every plant of `tenant-keys.ts` in a rolled-back transaction as the superuser | Exactly `PLANTED_REFERENCE_FINDINGS`, `PLANTED_GUEST_REFERENCE_FINDINGS` (with `c16_g_both_parent`, read as org- and guest-bound, rest `parent_id=id`), `PLANTED_UNIQUE_FINDINGS` (unscoped: none) and `PLANTED_GUEST_UNIQUE_FINDINGS`. Exclusion facts: `c16_gex_gist_org_code` and `c16_gex_org_code` `org_id:true`, `c16_gex_org_ne_code` `org_id:false`, `c16_gex_code` none |
| T2-O (rulings §8.3) | The four cases of the int test, plus two of mine: the CHECK `NO INHERIT`, and the equivalent predicate written `NOT (parent_id IS NOT NULL AND org_id IS NULL)` | The entry hides the key only with the validated predicate. Dropped, `OR org_id IS NULL`, `NOT VALID`, single-column entry, `NO INHERIT` and the rewritten predicate all report the key and the entry (fail closed). Printed text: `CHECK (((parent_id IS NULL) OR (org_id IS NOT NULL)))` |
| Extra arm (b) shapes (mine) | On `c16_gparent`: `EXCLUDE USING gist (guest_token_hash WITH <>, code WITH =)`; `UNIQUE NULLS NOT DISTINCT (org_id, guest_token_hash, code)`; `EXCLUDE (org_id WITH =, guest_token_hash WITH <>, code WITH =)`; `UNIQUE (org_id, guest_token_hash, code)` | Reported: the first two. Passed: the last two, as rulings §8.2 Q2g and §8.12 QG-051-C1 (b) rule |
| Round-1 probes, again | R1-M1 (`ux_gc_quote_packages__guest_quote_seq` recreated `NULLS NOT DISTINCT`) and R1-m1 (T2-O entry `fk_gc_quotes__requote_of_quote_id` naming `ck_gc_quotes__requote_org_only`, then the CHECK dropped) on the `gc_` tables | R1-M1: now reported. R1-m1: the entry with its CHECK is live and hides the key (definition `CHECK (((requote_of_quote_id IS NULL) OR (org_id IS NOT NULL)))`); with the CHECK dropped the key and the entry are reported |
| AT-US-080-03 set | The test's query over the migrated schema with the `gc_` tables planted | Nullable `org_id` roots = `audit_entries` + the four `gc_` tables = the flagged set; `audit_entries` is `SYSTEM` in its manifest; no GUEST_CAPABLE manifest table exists yet |
| Not re-run by me | Every `*.int.test.ts` on PostgreSQL 18: C2/C6 `23001`, the PostgreSQL 18 spelling of the T2-O CHECK, the three race tests and the predicate control (PGlite has one connection), AT-US-080-07, gitleaks-full; full `test:unit`, coverage, lane A | **Owed by lane B at `c1c8a6ec`.** No lane B run for `a79facce` or `c1c8a6ec` exists yet in the worktree's `docs/05-quality/tests/runs/`. PGlite answers `23503` for C2 and C6, which is the 17.5 answer (rulings §8.5) |

Two expectations of my own probe were wrong, not the code: the JSON key order of `owner_columns` (jsonb sorts keys; Jest `toEqual` does not care), and `ux_gc_quote_shares__share_token_hash`, which arm (b) reports when the `gc_` tables are put in scope. They are out of scope of every committed suite, and the real `quote_shares` index is a ruled exception on the TASK-237 card.

## R2.2 Round-1 findings

| ID | Status | Evidence |
|---|---|---|
| R1-M1 | **Closed** | `TENANT_UNIQUE_INDEXES_SQL` returns `nulls_not_distinct` and per owner key column `not_null` and `equality` (btree strategy 3 through `pg_amop`); `ownerColumnDefects` decides (B1, B2); fixtures drive every branch, including the missing equality fact (fail closed) and an exception that names a non-separating index. All six planted shapes of §8.2 are present and proven on PGlite. The header describes arm (b) and keeps the two stated limits |
| R1-m1 | **Closed** | `ReferenceException { check, reason }`; `exceptionDefect` requires kind `org-only`, a single other column, the named constraint on the referencing table, `contype c`, `convalidated` and the exact text. The four int cases of §8.3 plus seven unit fixtures |
| R1-m2 | **Closed** | `guest-claim-probe.test.ts` pins that the migration holds `renderGuestCapableGuardFunction()` verbatim and nothing else (comments aside). Mutant killed. The template header says a change needs a new migration |
| R1-m3 | **Closed** | AT-US-080-03 compares the set of nullable partition roots with GUEST_CAPABLE manifest tables, the `gc_` tables and `audit_entries` (listed, checked to be SYSTEM, with its reason). Verified on PGlite |
| R1-m4 | **Closed** | Deep-equal test for `23503` and `23001` under `P2010` and `P2003` (four combinations) plus the "differ in `sqlState` only" assertion; `FK_CODE` names `23001` with three positive and three negative controls per token |
| R1-n1 | **Closed** | `c16_g_both` planted, in `PLANTED_GUEST_REFERENCE_FINDINGS`; the int test also pins both flags and the rest |
| R1-n2 | **Closed** | Header explains OID text order |
| R1-n3 | **Closed** | `.catch(() => undefined)` on the abandoned `pending` and on every `runs[]` promise |
| R1-n4 | **Closed** | Stated limit in the tripwire header (rulings §8.6) |
| R1-n5 | **Routed, open** | qa-lead: suite column of AT-US-080-01..07 (D-PM-087 names it). No change in this PR |
| R1-n6 | **Routed, closed here** | Recorded by security-analyst (record §4). The UPDATE arm of D-ARCH-214 has the same unreachable fail-closed half (rulings §8.11) |
| L-1 | **Closed in code; lane B owed** | D-ARCH-211; C2 and C6 expect `23001` on the ruled constraints, titles and header follow, `90f23f93` and the squash cite D-ARCH-211 |
| L-2 | **Closed by the supersede; lane B owed** | Reworded at `9d483b21`; v2 range has no `generic-api-key` shape (emulation above). gitleaks-full at `c1c8a6ec` against the unchanged baseline is the proof (security condition C3) |

## R2.3 Card lines of rulings §8.9 for TASK-051

| Line | Status |
|---|---|
| C16 (a) both owner columns (D-ARCH-207) | Met. Kind `both-owners`, never a sibling, never excepted (fixture `names a key reported as both-owners`); planted |
| C16 (b) an owner column separates owners (D-ARCH-208) | Met in every clause, including "exception live only for an index with no owner key column at all" and the fixture over both owner columns |
| C16 (a) T2-O entry (D-ARCH-209) | Met. The committed map stays empty (`TENANT_REFERENCE_EXCEPTIONS.size` 0, `exceptionCheckNames()` `[]`) |
| PostgreSQL 18 answer of C2 and C6 (D-ARCH-211) | Met in code; C3 and every other case keep `23503`. Lane B owed |
| One answer, both SQLSTATEs (D-ARCH-212) | Met. No product code changed (`map-db-error.ts` untouched) |
| AT-US-080-06 database half (D-ARCH-210) | Met: the expectation is unchanged (`42501`) |
| Operator rule on UPDATE (D-ARCH-214) | Met: migration text identical to §3.4, `down.sql` unchanged, Prisma header follows, O7 as specified, mutant killed (PGlite). The developer's lane B mutant report is still owed (QG-051-C4) |
| C16 follow-up, arms (c) and (d) (D-ARCH-216, added after D-QG-005) | **Not in this fix cycle.** The ruling allows a late task on the same two files, merged before TASK-087 opens its PR. senior-developer names the task (not a TASK-051 merge condition; follow-up F1) |

## R2.4 New findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR | `prisma/tests/organisations/organisations.int.test.ts:300, 316`; `prisma/tests/rls/guest-claim.int.test.ts` (the §2.7 cases from line 213, the de-claim cases, AT-US-080-02/06) | The security record §7 assigns SEC-TC-79 (O1-O6) and SEC-TC-80 (G, T, S, R, C cases, de-claim, AT-US-080-02/06) and routes "Tags in this cycle" to senior-developer (§8 table). `git grep` at `c1c8a6ec` finds neither ID anywhere under `prisma`, `tests`, `tools` or `apps`. qa-lead's manifest commit after merge puts both IDs in `integration.required_cases` (D-SEC-PR47-01: an ID a passing test carries is never parked), so without the tags that commit fails, or the IDs get parked with no test. The AC trace pools IDs from titles, so the cases are invisible to it today | Add `[SEC-TC-79]` to the O1-O6 title (and to O7 if the security delta round says it joins), and `[SEC-TC-80]` beside `[SEC-TC-76]` on the cases the record lists. Titles only. Either a commit on the v2 branch before lane B's final run (it then binds lane B and the security round to the new head), or a tags-only follow-up that lands before qa-lead's manifest commit; the orchestrator chooses |
| R2-n1 | NIT | `tests/generated/rls/guest-claim-race.int.test.ts` (`CLAIM_WITHOUT_PREDICATE_SQL`) | The predicate control mutates the probe's own `CLAIM_SQL` constant. It proves that the same-organisation round detects the loss of `org_id IS NULL`, which is what D-TASK051-14 claims, but it cannot catch a future claim statement elsewhere that drops the predicate. That is PR051-SEC-02 (b) on the TASK-146 card, as the security record routes it | Nothing here. Keep the TASK-146 line (the race runs the repository's statement, or a unit test pins it) |
| R2-n2 | NIT | `tools/repo/refused-reference-answer.test.ts:28` | `FK_CODE` matches any free-standing `23001`, which is also a five-digit numeric literal (a US ZIP code in a fixture, an amount). A false positive fails closed and the message names the file, so the cost is a rename. `23503` had the same property | Nothing now. If it ever fires on a ZIP fixture, scope the scan to `.ts`/`.js` string and `case` positions instead of allow-listing the file |

## R2.5 Rulings on D-TASK051-10 to D-TASK051-15

| Decision | Ruling |
|---|---|
| D-TASK051-10 (entry `{ check, reason }`; checks read by name whatever their type; pure rule checks kind, sole column, table, `contype`, `convalidated`, exact text; 17.5 text pinned) | **Accepted.** Reading by name and deciding the type in the pure function gives a precise defect ("not a CHECK (contype u)") and stays fail closed. Rulings §8.12 N7 reports the same text on 18.6, and the int test "the planted CHECK prints as the T2-O predicate" pins it on lane B. My two extra shapes (`NO INHERIT`, an equivalent predicate written differently) are refused, which is the ruled "the predicate is the rule, the text is what is compared" |
| D-TASK051-11 (no owner column: PR65-SEC-01 finding, may be excepted; owner columns that all fail B1/B2: D-ARCH-208 finding, never excepted; missing equality fact = not equality) | **Accepted.** It is §8.2 "exceptions stay literal" and fails closed on a malformed row |
| D-TASK051-12 (O7 a test of its own; SUSPENDED memberships as fixture rows with triggers off; ACTIVE set from another user's operator-context session) | **Accepted.** The fixture is the realistic shape (a membership that predates the grant deletion), the grant insert and delete go through the migrator lane, and the mutant is killed on PGlite. O1-O6 stay byte-stable |
| D-TASK051-13 (AT-US-080-03 as a set over partition roots; `audit_entries` listed with its reason) | **Accepted.** The set equality is both directions ("every flagged table does" as well), the list is checked against the manifests, and the claim "only flagged tables" is now what the test asserts |
| D-TASK051-14 (same-organisation rounds sequenced through `pg_stat_activity`; loser commits when it touched a row; claim record asserted; predicate control on every run) | **Accepted.** It closes PR051-SEC-02 (a) as the record preferred. See R2-n1 for the reach of the control. Lane B is the only evidence (two connections) |
| D-TASK051-15 (template pin in `guest-claim-probe.test.ts`, unit project) | **Accepted.** It sits beside the probe that refuses to create the function, and the mutant run above shows it fails on a template edit |

## R2.6 Merge conditions (replace those of round 1)

1. **Lane B green on PostgreSQL 18 at `c1c8a6ec`** (or at the final v2 head if R2-m1 lands there), `git_dirty` false. It must show: `guest-claim.int.test.ts` with C2 and C6 at `23001` and every other §2.7 case, the 16 de-claim cases and AT-US-080-01..07; `c16-tenant-keys.int.test.ts` with the §8.2 plants, the four T2-O cases and the printed CHECK text; `organisations.int.test.ts` O1-O7; `tests/generated/rls/guest-claim-race.int.test.ts` through `rls-cross-tenant` (cross-organisation, both same-organisation rounds and the predicate control); `map-db-error.test`, `refused-reference-answer.test`, `guest-claim-probe.test`; `up-down-up`, `shadow-init`, `seed`, the generated RLS suite and catalog C1-C16; **`gitleaks-full` clean against the unchanged baseline**. The developer reports the O7 mutant from lane B or a hand run (QG-051-C4). An answer that differs from rulings §2.7 or §8 on 18 goes back to principal-architect unadapted (the §8.3 definition text excepted).
2. **security-analyst** delta round and supersede round on the v2 head (record conditions C3 to C5), including whether O7 joins SEC-TC-79.
3. **R2-m1** resolved by one of the two routes it names; the orchestrator records which.
4. **QG-051-C1 to C4 closed by the gatekeeper.** QG-051-C2 is still open: `plan-data.mjs` at main `d1612220` carries none of the §8.9 lines (TASK-146 still says "fails with 23503", TASK-237 still says "fails with 23503", the TASK-051 line still says "P2003 or 23503"). This also covers round-1 condition 6 and security condition C6 (route-side binding, SEC-TC-81 and the HTTP halves on the TASK-091 and TASK-146 cards).
5. **MERGE PREREQUISITE TASK-293** met (PR #72 on main); the orchestrator re-checks at merge.
6. **Union merges** as round-1 condition 7: `prisma/sql/grants.manifest`, `tools/db/grants-manifest.test.ts`, `packages/shared/src/classification/registry.ts`, `prisma/tests/rls/tenant-db.real-client.test.ts` with TASK-040, TASK-043 and TASK-080, keeping every block and sorted list; re-run C16 (b) and the grant pins on lane B after each union. None of these merged since `530629f4`.
7. **Merged before TASK-089 opens its PR** (D-SD-003). The split option of round 1 is no longer needed: the operator half has no open finding.
8. Rename this record (and the security record) for the v2 PR number once it exists (security condition C7).

## R2.7 Follow-ups (not TASK-051 merge conditions)

- **F1, senior-developer:** C16 arms (c) and (d) (D-ARCH-216, QG-051-C6) were not folded into this fix cycle. Name the late task on `tenant-keys.ts` and `c16-tenant-keys.int.test.ts` and keep it merged before TASK-087 opens its PR. Note for its review: `conenforced` does not exist on PGlite 17, so the reviewer's replay of that arm needs PostgreSQL 18.
- **F2, qa-lead:** R1-n5 (suite column), SEC-TC-07 back to `required_cases` of `rls-cross-tenant` at the first activation checkpoint, SEC-TC-79/80 into `integration.required_cases` after the tags exist.
- **F3, TASK-237:** `ux_quote_shares__share_token_hash` enters `TENANT_UNIQUE_EXCEPTIONS` (its card says so); the probe tables show arm (b) reports it otherwise.

```
GOOD:
- The C16 rules stay one fact per column: the SQL returns facts, the pure function decides, and the fixture suite
  drives every branch including malformed rows. Each new rule has a planted probe and a control that passes.
- T2-O verification compares the printed predicate, not the column set, and fails closed on every variant tried
  (dropped, OR org_id IS NULL, NOT VALID, NO INHERIT, rewritten predicate, wrong kind of key).
- O7 is the attack of PR051-SEC-03 replayed through the real lanes (migrator deletes, another operator session
  re-activates), and the UPDATE arm is the ruled text byte for byte.
- The same-organisation race carries its own mutant control, so losing the once-only predicate is caught on every
  lane B run.
- The supersede is mechanical and provable: merge-tree equality, one commit, decisions carried verbatim.

SECURITY-FLAGS:
- R2-m1: SEC-TC-79/80 tags missing at c1c8a6ec (security record §8 "Tags in this cycle").
- O7 and SEC-TC-79: the record decides whether O7 joins.
- D-ARCH-216 (C16 arms (c)/(d), NOT ENFORCED and non-RESTRICT keys): co-owned by security-analyst, not in this
  PR; needs an owner before TASK-087 opens its PR (F1).
- The UPDATE arm's fail-closed half (organisation not visible counts as OPERATOR) is unreachable, like R1-n6.
- gitleaks-full on the v2 head is the proof for L-2; my emulation is supplementary.
```
