# PR-pending: TASK-051 (guest-capable de-claim guard, guest-row binding and the one-statement claim, C16 as amended, one answer for a refused reference, operator staff grants), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-051-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>` (D-ORCH-136, D-ORCH-138): open the PR as a draft, rename the record on main, confirm that the PR's merge ref contains the renamed record, then mark the PR ready.

**Finding IDs.** `PR051-SEC-nn` are the findings of this task (TASK-051). They are not findings of PR #51.

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-051-guest-capable-tables-atomic-claim` on base `e245e6e6`: `0467ea1b` (guard function), `b55e9b6d` (operator staff grants), `7be618aa` (refused reference), `b34f954e` (C16), `2e1c529f` (guest binding, claim, SEC-TC-07 race), `203d02eb` (prettier) |
| Head | 203d02eb1b92a721f64ccbd881b73a68c178e6f4 |
| Merge base with main | `e245e6e6`. Origin main when this round was written: `530629f4`; the main checkout carried unpushed docs commits on top (local main `d7585e78` when this record was committed, including the code review twin `fa98e4c5`/`b1efe502` and D-ORCH-147). `e245e6e6..d7585e78` changes no path outside `docs/` and `.claude/`. `git merge-tree --write-tree d7585e78 203d02eb` is clean |
| Lane A evidence | None; the branch is not pushed, and hosted CI does not start jobs (D-ORCH-146). Main's classifier (`tools/ci/security-paths.mjs --base e245e6e6 --head 203d02eb`) gives `security_paths=true` (18 paths), so the hosted `security-integration` job runs on the PR |
| Lane B evidence | Run `20261121T0336Z_203d02e` (`git_sha` `203d02eb`, `git_dirty` false, profile `pr`), uncommitted in the TASK-051 worktree, read with read-only file tools only: **FAIL**. `catalog-c1-c14`, `migrations`, `rls-cross-tenant` (both SEC-TC-07 tests), `api` and `unit` pass; `integration` fails C2 and C6 of `guest-claim.int.test.ts` (`23001` where §2.7 says `23503`) and both `gitleaks-full.int` cases (one fingerprint above the baseline, attributed by D-ORCH-147 to this PR's commit `b34f954e`). O1-O6, AT-US-080-01..07 and the 16 de-claim cases pass on PostgreSQL 18. See §8 |
| Owned paths changed | 20, as main's checker counts them (`--base e245e6e6 --head 203d02eb --pr 9999`, no record: `missing`): both migration directories (4 files), `prisma/schema/organisations.prisma`, `prisma/sql/grants.manifest`, `prisma/tests/catalog/{c16-tenant-keys.int.test.ts,tenant-keys.ts,tenant-keys.test.ts}`, `prisma/tests/harness/{guest-claim-probe.ts,guest-claim-probe.test.ts}`, `prisma/tests/organisations/{cases.ts,organisations.int.test.ts}`, `prisma/tests/rls/{guest-claim.int.test.ts,tenant-db.real-client.test.ts}`, `tests/generated/rls/guest-claim-race.int.test.ts`, `tests/generated/tsconfig.json`, `tools/db/grants-manifest.test.ts`, `tools/db/table-classes/organisations.json`, `apps/api/src/platform/db/map-db-error.test.ts`. Not owned: `packages/shared/src/classification/registry.ts`, `tools/repo/refused-reference-answer.test.ts`. So this record is a merge condition |
| Unowned paths read | `packages/shared/src/classification/registry.ts`, `tools/repo/refused-reference-answer.test.ts`; for context `tools/db/{render-rls,table-classes,sql-text,lint-migrations}.ts`, `prisma/sql/policy-templates/{guest,tenant,operator,dr-a14-memberships,guest-capable-guard-function,guest-capable-guard-trigger}.sql`, `prisma/migrations/20261112020000_platform_rls_helpers` and `20261117000000_organisations_identity`, `prisma/bootstrap/00..02`, `apps/api/src/platform/db/{map-db-error,with-tenant-tx,expect-affected}.ts`, `tests/generated/rls/probe.ts`, `prisma/tests/catalog/c15-std-columns-guard.int.test.ts`, `tools/quality/{gitleaks-full.mjs,gitleaks-full.int.test.ts,required-suites.json}`, `.gitleaks.toml` |
| Binding items checked | Brief `docs/04-plan/briefs/TASK-051.md` and its card; `rulings/wave-1-r-arch-34-operator-rulings.md` §2 (whole), §3, §4.1, §7; D-ARCH-154, D-ARCH-162..166; ADR-0005 am. 10 items 11 and 15, am. 14 items 31-36 (as the rulings quote them); PR7-SEC-04, PR7-SEC-12 (d), PR7-SEC-13; PR65-SEC-02, PR65-SEC-04; PR293-SEC-03; SEC-TC-07 (`required-suites.json`, `rls-cross-tenant` pending), SEC-TC-76; D-TASK051-01..09 (commit bodies); code review round 1 (`docs/05-quality/reviews/PR-pending-TASK-051-code-review.md`, main checkout `fa98e4c5`, `b1efe502`); D-ORCH-147 (lane B results and the gitleaks triage) |
| Reviewer / date | security-analyst, 2026-11-21, round 1, pre-push. Host rule: foreground commands only, one at a time, each at most 8 minutes, no Docker, nothing run in the TASK-051 worktree (git reads used the shared object store from another checkout; the lane B files were read with the read-only file tools). Method: `git archive` extracts of `203d02eb` and `e245e6e6` in the session scratchpad; the PR's own sources imported type-stripped through a resolve hook; SQL on PGlite 0.4.3 (PostgreSQL 17.5) with bootstrap files 00 to 02 and all 9 migrations applied as the runners apply them (statement by statement through `splitStatements`, as `platform_migrator`, `uuidv7()` stubbed); the PR's probe module (`plantGuestClaimProbe`, `seedQuote`, `CLAIM_SQL`, `asApp` with the real `CONTEXT_STATEMENT_SQL`) through a pg-shaped adapter; a gitleaks v8.30.1 emulation; main's real record checker in a sparse shared clone |

## 1. Summary

The database side holds what the dispatch asked about.

- **Guest-token RLS.** A guest reads and writes only rows whose `org_id` is NULL and whose `guest_token_hash` equals its own binding. The empty binding `''` and every malformed binding (upper case, a trailing newline, a leading space, 63 characters, a `\x` prefix, mixed case) read no guest row, also under organisation A, because `platform.app_guest_token_hash()` returns NULL for anything but 64 lower-case hex digits. An organisation context cannot plant a guest row (42501). A guest cannot plant a row carrying another guest's hash (G7, 42501). A guest cannot claim (AT-US-080-06, 42501). A row of another guest, of an organisation or an unknown id is refused on the one guest key (G1-G4, `23503`), so the database gives one answer to "foreign" and "absent".
- **De-claim guard.** `platform.guest_capable_guard()` is migrator-owned, `SECURITY INVOKER`, `proconfig` exactly `search_path=pg_catalog, pg_temp`, with no EXECUTE for PUBLIC or `platform_app`. It is the renderer's text byte for byte. It refuses all four forbidden transitions with `IS DISTINCT FROM` forms (org to NULL, org A to org B, NULL to hash, hash H1 to H2), as the superuser and as `platform_app` in the claim context, through `UPDATE`, `INSERT … ON CONFLICT DO UPDATE` and `MERGE`. The legitimate claim passes. It is the only control in two shapes: a childless organisation quote turned into a guest row, and an organisation child row moved under the guest's quote, which the guest token can then read (probed with the trigger dropped). Where children exist, the RESTRICT keys also refuse (PR051-SEC-04).
- **The claim.** It is one statement, and its outer count goes through `expectAffected`. A second claim, a claim with another guest's token and a hash-only context all touch 0 rows or are refused. SEC-TC-07 passes on PostgreSQL 18. It proves atomicity only for claimants of two different organisations, where row security alone already stops the loser. The `AND org_id IS NULL` predicate is what makes a same-organisation double submit atomic, and SEC-TC-07 cannot see it (PR051-SEC-02).
- **Operator staff grants.** A self-join into the operator organisation without a grant is refused through `INSERT`, `INSERT … ON CONFLICT DO NOTHING` and `MERGE`. With the guard of the previous migration (down.sql applied in the transaction, positive control) the same insert succeeds and the user sees 3 organisations. `platform_app` gets 42501 on INSERT, UPDATE, DELETE and TRUNCATE of the grants. `INVITED` is unreachable by UPDATE from ACTIVE and from SUSPENDED. **PR65-SEC-02 (b) closes with this migration** (lane B O1-O6 green on 18). The grant is read only on INSERT, so re-activating a SUSPENDED operator membership whose grant is gone needs none. That is latent in Run 1 (PR051-SEC-03).

Findings:

- **PR051-SEC-01 (LOW).** C16 (b), the isolation gate for the TASK-087 quote tables, counts an owner column in the key as owner scoping. It does that even when a `NULLS NOT DISTINCT` index or a non-equality exclusion operator makes that column unable to separate owners. Same finding as code review R1-M1. I add the cross-organisation form on the guest column and the TENANT reach of the exclusion form.
- **PR051-SEC-02 (LOW).** SEC-TC-07 cannot detect the loss of the claim predicate. It also runs the probe statement, not the claim repository.
- **PR051-SEC-03 (LOW, latent).** The operator rule is checked on INSERT only. SUSPENDED to ACTIVE does not consult the grant.
- **PR051-SEC-04 (INFO).** The de-claim trigger is load-bearing. A later-sorting BEFORE UPDATE trigger that assigns an owner column is invisible to it, and the template copy of the function is unpinned (code review R1-m2).
- **PR051-SEC-05 (INFO).** The staff list is readable by every runtime session and every module through `TenantDb` (ruled, §3.3 of the rulings).

Nothing Critical, High or Medium. Lane B at `203d02eb` is red for two reasons outside this review's findings:

- the PostgreSQL 18 SQLSTATE `23001` for a parent-side RESTRICT, which goes to the architect;
- one gitleaks-full fingerprint above the baseline. It is a false positive in this PR's commit `b34f954e` (`prisma/tests/catalog/tenant-keys.ts:75`, a doc comment). The orchestrator attributed it (D-ORCH-147), and my corrected emulation reproduces exactly that one (§8). The supersede route of D-ORCH-147 is confirmed.

Verdict: PASS_WITH_CONDITIONS.

## 2. What I verified

| Probe | How | Result |
|---|---|---|
| P1 text identity | `renderGuestCapableGuardFunction()` of the extract against `20261120200000_guest_capable_guard/migration.sql` (comments stripped, `splitStatements`, with a one-character mutant of the rendering as control); `20261120210000_operator_staff_grants/migration.sql` against the rulings §3.4 item 1 block (indent stripped); `down.sql` against `20261117000000_organisations_identity` lines 406-426; base against head for the released migrations and the five guest/tenant/operator templates | Guard: 2 statements equal; the mutant differs. Operator migration: byte-equal (3,278 bytes). `down.sql`: dollar body equal, header equal except `CREATE` → `CREATE OR REPLACE`. No released migration and no template changed |
| P2 guest binding and claim (PGlite 17.5, as `platform_app` with `CONTEXT_STATEMENT_SQL`) | PR's `plantGuestClaimProbe` as `platform_migrator`, seeds as the superuser, each case rolled back | Replicas: G1, G3 `23503 fk_gc_quote_packages__guest_token_hash_quote_id`; G7 42501; T1 `23503 …__org_id_quote_id`; C1 1 row, quote owned by A, `claimed_from_token_hash` = H1; C2 `23503` guest key (18: `23001`); C3 `23503` org key; C4 0 rows; AT-US-080-06 42501 on `gc_quotes`. Bindings: exact hex 1 row; `''`, upper case, `…\n`, leading space, 63 characters, `\x` prefix, one upper-case digit: 0 rows each. Organisation A inserting a guest row with H1: 42501; guest H1 its own: ok |
| P2 de-claim in the claim context (org A + H1, `platform_app`) | `UPDATE … SET org_id = NULL, guest_token_hash = H1` of A's quote; the same through `ON CONFLICT (id) DO UPDATE` and `MERGE`; H1 → H2 on H1's row; org A → org B | `23514 GUEST_DECLAIM_FORBIDDEN` in all five. With the trigger dropped, the quote that has children is still refused by the RESTRICT org key (`23503` on 17.5; `23001` expected on 18, as L-1) |
| P2b where the trigger is the only control | Childless org-A quote → guest H1; org-A option moved to H1's quote (`quote_id` changed too); org-A option → H1 on its own quote; then H1 reads the moved option. Trigger on, then dropped | Trigger on: `23514` in all four, H1 reads 0. Trigger dropped: the childless quote is de-claimed (1 row); the moved option is accepted (1 row) **and H1 reads it**; the same-quote move fails on the guest key (`23503`) |
| P2b trigger order | A BEFORE UPDATE trigger that sets `NEW.org_id := NULL` and a hash, named `trg_gc_quotes__zz` (sorts after `tg_gc_quotes__guest_capable_guard`) and, as control, `aa_gc_quotes` (sorts before) | `trg_…__zz`: the row is de-claimed (`org_id` NULL, hash set). `aa_…`: `23514`. PostgreSQL fires BEFORE row triggers in name order, so the guard sees only what earlier triggers did |
| P2 claim predicate (PR051-SEC-02) | `CLAIM_SQL` and a mutant with every `AND org_id IS NULL` removed. (i) A claims, then a second user of A claims; (ii) A claims, then B claims (the SEC-TC-07 pairing). Sequential in one transaction; under READ COMMITTED a blocked UPDATE re-evaluates the same predicate, row-security quals included, on the committed row | Real: (i) 1 then 0; (ii) 1 then 0. Mutant: (i) 1 then **1**: `claimed_by_user_id` becomes the second user and `claimed_from_token_hash` becomes NULL. (ii) 1 then 0. So the cross-organisation pairing answers the same for both statements |
| P3 C16 (b) reading (PR051-SEC-01) | Column `code` on `gc_quotes`; committed rows: guest H2 and org A each hold `X`. One shape per transaction, read with the PR's `TENANT_UNIQUE_INDEXES_SQL` and `tenantUniqueFindings`; then guest H1 and org B insert `X` and `Y` | `(org_id, code)` (control): no finding, nobody blocked. **`(org_id, code) NULLS NOT DISTINCT`: no finding; guest H1 `X` → `23505`** (H2 holds it), `Y` ok. **`(guest_token_hash, code) NULLS NOT DISTINCT`: no finding; org B `X` → `23505`** (A holds it). `EXCLUDE USING gist (org_id WITH =, code WITH =)` (control): no finding, nobody blocked. **`EXCLUDE USING gist (org_id WITH <>, code WITH =)`: no finding; org B `X` → `23P01`**. `btree_gist` is installed by `prisma/bootstrap/01-schemas.sql` |
| P4 operator rule (PGlite 17.5) | Users and organisations planted as in `cases.ts` (`session_replication_role = replica`); the grant written as `platform_migrator`; every case as `platform_app` with the production context statement | O1 `P0001 … needs a staff grant`. **Control:** `down.sql` applied in the transaction, the same insert `ok`, and the user then sees 3 organisations with the OPERATOR scope. `platform_app` on the grants: INSERT, UPDATE, DELETE, TRUNCATE all 42501; SELECT ok (1 row). Self-join through `MERGE … WHEN NOT MATCHED THEN INSERT` and `INSERT … ON CONFLICT DO NOTHING`: `P0001`. Moving an own org-A membership to the operator organisation: 42501 (WITH CHECK) from A's context, 0 rows from the operator context. Direct `INVITED` insert: `P0001 … created ACTIVE`. ACTIVE → INVITED and SUSPENDED → INVITED: `P0001 … INVITED is reserved`. A user without a grant joins a BUSINESS_CUSTOMER organisation: ok. **A SUSPENDED operator membership of a user without a grant, set ACTIVE by another user's operator-context session: ok, and the member then sees 3 organisations** (PR051-SEC-03). Impersonating a granted user (actor = that user, T-35): ok. A granted user with a REMOVED membership joins again: ok (ruled). Table: no RLS, owner `platform_migrator`, ACL `platform_app=r`. Lifecycle function: owner `platform_migrator`, not definer, fixed path |
| P5 migration linter | `lintMigrations(prisma/migrations, …, { tableClasses })` type-stripped on the extract; control: the guard made `SECURITY DEFINER` and the `operator_staff_grants` manifest entry removed | Head: 0 findings. Control: 2 findings (rule 15, rule 9) |
| P6 gitleaks | gitleaks v8.30.1 rules and main's `.gitleaks.toml`, emulated in git mode over `git log -p -U0 --diff-merges=first-parent --text`: per hunk, `regexTarget`, entropy, stopwords and commit-bound tables; named groups enabled (221 of 222 rules compile; `pkcs12-file` is a path rule, and no `.p12`/`.pfx` path exists in the history); runtime controls | **First run, with the "generic rule needs a digit" check of my earlier emulator:** full ancestry of `203d02eb` (610 commits, 1.46 million added lines) gives exactly the 17 baseline fingerprints and nothing else, so it could not explain lane B. **Corrected run, without that check:** exactly the 17 baseline fingerprints (same commit, path, rule and line) **plus `b34f954e:prisma/tests/catalog/tenant-keys.ts:generic-api-key:75`**, the orchestrator's attribution from the real image (D-ORCH-147). So v8.30.1 has no digit check, and the corrected emulation equals the real image over this whole history. The 9 main docs commits `728599e0^..e245e6e6`: 0 under both. This record and the D-SECPR051-01 text: 0 under both. Values were never printed |
| P7 record binding | Main's real `check-security-owned-paths.mjs` in a sparse shared clone, merge-ref form, `--pr 9999` | §10 |

Not run by me: any `*.int.test.ts` on PostgreSQL 18, the SEC-TC-07 race (PGlite has one connection), lint, typecheck, unit suites (the code review twin ran 8 suites / 127 tests, lint, format and `tsc -b` on an extract, all clean). Every concurrency statement in this record is reasoning over READ COMMITTED re-evaluation plus the sequential probe, and lane B's passing race tests.

## 3. Findings

| ID | Title | Severity | CWE | OWASP | File:line | Owner / due |
|---|---|---|---|---|---|---|
| PR051-SEC-01 | C16 (b) passes unique keys whose owner column cannot separate owners (`NULLS NOT DISTINCT`, non-equality exclusion operator) | LOW | CWE-1023 (impact CWE-203) | A01 | `prisma/tests/catalog/tenant-keys.ts:183-196` (`has_owner` at 186-189), `:207-217`; planted lists `:346-355` | senior-developer, this PR's fix cycle (= code review R1-M1, merge condition C1); principal-architect confirms the rule text |
| PR051-SEC-02 | SEC-TC-07 proves the concurrent claim only for two organisations, where row security alone stops the loser; the claim predicate and the production statement are not under test | LOW | CWE-362 | A04 | `tests/generated/rls/guest-claim-race.int.test.ts:138-140`; `prisma/tests/harness/guest-claim-probe.ts:127-135` | (a) senior-developer, this PR (test only); (b) TASK-146 before it credits SEC-TC-07 |
| PR051-SEC-03 | Operator rule on INSERT only: SUSPENDED → ACTIVE of an operator membership does not consult the grant | LOW (latent) | CWE-269 | A01 | `prisma/migrations/20261120210000_operator_staff_grants/migration.sql:46-50` | principal-architect: fold the UPDATE clause now, or make it part of the M2 grant-removal amendment (§3.3 item 4) |
| PR051-SEC-04 | The de-claim trigger is load-bearing; a later-sorting BEFORE UPDATE trigger that assigns an owner column bypasses it; the template copy is unpinned | INFO | CWE-696 | A04 | `prisma/sql/policy-templates/guest-capable-guard-trigger.sql`, `guest-capable-guard-function.sql:2`; `tests/generated/rls/probe.ts:106` | TASK-087 (first GUEST_CAPABLE tables) with the catalog row; the pin with code review R1-m2 |
| PR051-SEC-05 | The staff list is readable by every `platform_app` session and every module (`TenantDb.operatorStaffGrant`) | INFO | CWE-200 | A01 | `prisma/migrations/20261120210000_operator_staff_grants/migration.sql:28`; `prisma/tests/rls/tenant-db.real-client.test.ts:205` | TASK-089 (repository test), M2 |

### PR051-SEC-01 (LOW): C16 (b) reads the owner column, not whether it separates owners

- **What.** `TENANT_UNIQUE_INDEXES_SQL` sets `has_owner` when `org_id` or `guest_token_hash` is a key column. Rulings §2.4 U1 and U2 rest on "NULLs are distinct" and on equality. Two shapes break that while keeping an owner column in the key:
  - a unique index created `NULLS NOT DISTINCT` (PostgreSQL 15+) on a nullable owner column. On a GUEST_CAPABLE table both owner columns are nullable, so every guest row shares the NULL `org_id`, and every organisation row shares the NULL `guest_token_hash`;
  - an exclusion constraint whose owner column uses an operator other than `=` (for example `org_id WITH <>`). `btree_gist` is installed, so uuid has a GiST operator class.
- **Probe P3.** On the PR's own `gc_quotes`, C16 (b) reports neither shape. Each one reopens the PR65-SEC-01 channel:
  - `(org_id, code) NULLS NOT DISTINCT`: guest H1 gets `23505` for a value guest H2 holds, and `ok` for a free one;
  - `(guest_token_hash, code) NULLS NOT DISTINCT`: organisation B gets `23505` for a value organisation A holds. This is a cross-tenant existence oracle and a blocking write among organisation rows;
  - `EXCLUDE USING gist (org_id WITH <>, code WITH =)`: organisation B gets `23P01` for A's value. This shape also works on TENANT tables, where `org_id` is NOT NULL.

  The controls (plain index, `org_id WITH =`) block nobody. Code review R1-M1 shows the same with `ux_gc_quote_packages__guest_quote_seq` rebuilt `NULLS NOT DISTINCT`.
- **Exploitability.** None today: no committed index has either shape, and no GUEST_CAPABLE table exists. The risk is the gate's purpose. TASK-087 writes the first quote tables in hand-written SQL, and "one index with `NULLS NOT DISTINCT` covers both owners" is exactly the shortcut U2 forbids.
- **Impact.** Existence answers and blocked writes across owners (CWE-203), on a key a client chooses. Medium impact, low likelihood: LOW.
- **Fix (code-level).**
  - Return two more facts per index and decide in the pure function, so that `tenant-keys.test.ts` drives them with fixtures:
    - `nulls_not_distinct = i.indnullsnotdistinct`;
    - for each owner key column, whether it is NOT NULL and, for an exclusion constraint, whether its operator at that position (`pg_constraint.conexclop[k]`) is the type's equality operator (`pg_operator.oprname = '='` and `oprcanmerge` or membership in the btree equality strategy).
  - An owner column counts only when it is NOT NULL, or the index is not `NULLS NOT DISTINCT`. For an exclusion constraint it must also be compared with equality.
  - Planted on `c16_gparent`: `UNIQUE NULLS NOT DISTINCT (org_id, code)`, `UNIQUE NULLS NOT DISTINCT (guest_token_hash, code)` and `EXCLUDE USING gist (org_id WITH <>, code WITH =)` are reported. `EXCLUDE USING gist (org_id WITH =, code WITH =)` is not.
  - Plant the exclusion shape on a TENANT-scoped probe (`c16_parent`) too. Add the rule to the header's arm (b) text.
  - **My position on the code review's option** to make the exclusion half a stated limit: enforce both. If the architect still prefers a limit, it is acceptable only with a C16 (b) assertion that no TENANT or GUEST_CAPABLE table holds an exclusion constraint at all (none does today). Otherwise a limit leaves the gate silent on a buildable cross-tenant shape.
- **Verification.** The three planted shapes appear in `PLANTED_GUEST_UNIQUE_FINDINGS` (and the TENANT one in `PLANTED_UNIQUE_FINDINGS`). The committed run stays empty. A fixture row with `nulls_not_distinct: true` on a NOT NULL `org_id` is not reported.

### PR051-SEC-02 (LOW): SEC-TC-07 cannot see the predicate that makes the claim atomic

- **What.** The race opens claimants `a` and `b` with two random organisations (`guest-claim-race.int.test.ts:139-140`). When the loser's blocked UPDATE re-evaluates the committed row, the guest policy no longer admits it (`org_id` is set). The tenant policy does not either, because the organisation differs. The loser therefore touches 0 rows with or without `AND org_id IS NULL`.
- **Probe.** With the predicate removed, a second claim by a user of the same organisation succeeds (1 row). It overwrites `claimed_by_user_id` and sets `claimed_from_token_hash` to NULL, because the token hash was cleared by the first claim. A second claim by another organisation gets 0 rows under both statements. On the concurrent path the blocked statement re-checks the same quals on the new row version, so the race behaves like the sequential probe.
- **Exploitability and impact.** Today the statement is correct, and AT-US-080-05 (the same user twice, sequential) catches the mutant. The gap is in the evidence for the registered concurrency case.
  - The realistic race is a double submit by one user, or two users of one organisation. Without the predicate, both requests would get 200, the claim provenance (`claimed_by_user_id`, `claimed_from_token_hash`) would be overwritten with a NULL token hash, and the audit trail would carry two claim entries.
  - SEC-TC-07 also runs `CLAIM_SQL` of the probe module, not the statement TASK-146 will ship.
  - Medium impact (integrity of the claim record and audit), low likelihood: LOW.
- **Fix.**
  - (a) Add a same-organisation round to `guest-claim-race.int.test.ts`: user 1 and user 2 of organisation A, and the same user twice, both holding the token. Assert one `ok` and one `NOT_FOUND`, and that `claimed_by_user_id` is the winner's and `claimed_from_token_hash` is the token digest after both transactions end.
  - (b) TASK-146: the claim repository exports its statement (or a builder), and SEC-TC-07 runs that statement. Otherwise a unit test pins the repository SQL against the shape of rulings §2.3, predicate included, on the quote and every child.
- **Verification.** The mutant statement (predicate removed) fails the new round: both claims `ok`, `claimed_from_token_hash` NULL. The real statement passes.

### PR051-SEC-03 (LOW, latent): the grant is checked on INSERT only

- **What.** The UPDATE branch of `platform.memberships_lifecycle_guard()` (`migration.sql:46-50`) has no operator clause. It does not require member = actor either: any session in the operator organisation's context may update any membership row there (tenant policy).
- **Probe P4.** A SUSPENDED operator membership of a user without a grant was set ACTIVE by another user's operator-context session. Result: `ok`, and the member then sees 3 organisations with the OPERATOR scope.
- **Exploitability.** Unreachable in Run 1. Such a row exists only if a grant is deleted after the membership was created, or if the row predates the rule. Run 1 has no grant deletion (no runtime writer, rulings §3.3 item 4) and no operator membership before TASK-089, which runs after this migration. It becomes reachable when M2 adds staff removal. If offboarding is "suspend, then delete the grant", any operator-context session can re-activate the former staff member. Reaching that context is the PR65-SEC-02 (a) defect class or T-35. The ruled residuals stay as ruled: impersonating a granted user (T-35), and a granted user re-joining after REMOVED while the grant is live (probed: ok).
- **Impact.** Read access to every tenant for a former staff member: critical. Rated LOW for now, the same way as PR65-SEC-02: there is no route, and it needs a grant-removal flow that does not exist yet plus a context defect.
- **Fix (code-level).** Add the clause to the UPDATE `CASE`:

  ```sql
  WHEN NEW.status = 'ACTIVE' AND OLD.status IS DISTINCT FROM 'ACTIVE'
   AND NOT EXISTS (SELECT 1 FROM public.organisations o WHERE o.id = NEW.org_id AND o.type <> 'OPERATOR')
   AND NOT EXISTS (SELECT 1 FROM public.operator_staff_grants g WHERE g.user_id = NEW.user_id)
                                                                   THEN 'an operator membership needs a staff grant'
  ```

  Either the architect folds it into this PR's `CREATE OR REPLACE` (the ruled text is binding, so the change needs the ruling; `down.sql` is unaffected), or the M2 amendment must carry it, together with "offboarding = REMOVED plus grant deletion".
- **Verification.** A planted SUSPENDED operator membership without a grant, set ACTIVE as `platform_app`, gives `P0001 … needs a staff grant`. With a grant it is `ok`. ACTIVE ↔ SUSPENDED of a granted staff member stays `ok`.

### PR051-SEC-04 (INFO): the de-claim trigger is the control, so its order and its single source matter

- The guard is the only refusal in two shapes, both probed with the trigger dropped:
  - a childless organisation quote turned into a guest row;
  - an organisation child row moved under the guest's quote, which the guest token then reads.

  When the quote has children, the RESTRICT org key refuses too. So TASK-087's generated RLS suite must keep the guard's presence check (`tests/generated/rls/cross-tenant.int.test.ts:289-311` already reports a missing or disabled trigger).
- **Order.** BEFORE row triggers fire in name order, so the guard sees `NEW` as earlier triggers left it. A trigger named after `tg_<t>__guest_capable_guard` that assigns `NEW.org_id` or `NEW.guest_token_hash` de-claims a row unseen (probed). One named before it is caught. Today no such trigger exists, and the standard-columns guard only asserts (the renderer refuses `NEW.x :=`). C15 (b) checks ordering relative to the standard-columns guard only, and C15 (c) scans assigners of STD columns only.
- **Recommendation (TASK-087, with the first GUEST_CAPABLE tables).** A catalog row in the style of C15 (c) reports any trigger function on a GUEST_CAPABLE table other than the guard whose body assigns `NEW.org_id` or `NEW.guest_token_hash`.
- **Single source.** The function now lives in the migration, and the template is no longer used on a migrated database (`probe.ts:106`). Concur with code review R1-m2: pin "the migration contains the renderer's output verbatim" in a host test, and correct the template header.

### PR051-SEC-05 (INFO): staff list readable everywhere

- `platform_app` holds SELECT on `operator_staff_grants`. The lifecycle guard runs as the invoker, so the ruling needs this. `TenantDb` exposes `operatorStaffGrant` like the GLOBAL authz catalogue. Any module and any session (SQL injection included, T-35) can list the staff user ids.
- This adds little to what a forged operator context already reveals: the operator organisation's memberships.
- **Recommendation.**
  - TASK-089's repository test ("no module under `apps/` implements the grant port") also asserts that no module under `apps/` reads `operatorStaffGrant`, until the M2 amendment.
  - The M2 design keeps reads on the admin module only.

## 4. Checked with no finding

| Area | Result |
|---|---|
| Empty binding (D-TASK051-07, database half) | `platform.app_guest_token_hash()` (`20261112020000_platform_rls_helpers`) is NULL unless the setting matches `^[0-9a-f]{64}$`, case-sensitive, with `$` anchored at end of string. `guest_token_hash = NULL` is never true. Eight malformed bindings read nothing (P2). The guest policy is `org_id IS NULL AND guest_token_hash = …` for USING and WITH CHECK, so an organisation context can neither read nor plant a guest row |
| Guard function | Owner `platform_migrator`, `prosecdef` false, `proconfig` `{search_path=pg_catalog, pg_temp}`, ACL owner only (no PUBLIC, no `platform_app`; a trigger function needs no EXECUTE to fire). It reads no context key (rule 16). `RAISE … TABLE = TG_TABLE_NAME` carries no row data. The trigger template is `BEFORE UPDATE` for every row with no column list, so `ON CONFLICT DO UPDATE` and `MERGE … UPDATE` fire it (probed) |
| Legitimate claim | NULL → org with hash → NULL passes the guard as the superuser and as `platform_app` in the claim context. WITH CHECK then needs `org_id = app.org_id`, so a claim lands only in the context organisation; membership of that organisation is the context builder's job, as for every tenant write |
| Claim under concurrent guest writes (reasoned) | A guest insert of a child holds `FOR KEY SHARE` on the quote. The claim's quote update changes key columns and needs `FOR UPDATE`, so the two serialise. Either the claim's parent-side RESTRICT check (fresh snapshot under READ COMMITTED) sees the new child and refuses (`23503` on 17, `23001` on 18), or the child's key check, made after the claim commits, finds no `(H, quote)` parent and refuses. No guest child stays behind under a claimed quote. For TASK-146: this surfaces as a 500 by D-ARCH-164, and the retry succeeds |
| Owner CHECK | `num_nonnulls(org_id, guest_token_hash) = 1` refuses no owner and both owners (AT-US-080-03, 23514). It is what stops a claim-context insert of a row visible to both the organisation and the guest. TASK-087 must carry it on every quote table (rulings §2.1). The code review's R1-m3 tightening of AT-US-080-03 is concurred |
| Operator clause, fail-closed half | Unreachable for `platform_app`: the trigger is AFTER ROW, and WITH CHECK refuses a membership of an organisation outside the context first (P4, code review R1-n6). Defence in depth, sound as ruled |
| Lifecycle function replacement | `CREATE OR REPLACE` keeps owner, `SECURITY INVOKER` and the trigger. `down.sql` restores the body byte for byte, before the table is dropped. Table first in `migration.sql`, so a deploy that stops early keeps the old guard |
| Grants | One manifest line, `platform_app SELECT`, pinned in `grants-manifest.test.ts`. C5 compares the live ACL with the manifest exactly, so any extra privilege fails lane B. `runtimeReadOnly`, no RLS (GLOBAL), C15 out of scope |
| One answer for a refused reference (D-ARCH-164) | `mapDbError` reads only the SQLSTATE and the Prisma code: 500 `INTERNAL_ERROR`/`DB_ERROR` for any `23503`, and for `23001` through the fallthrough. `sqlState` never reaches a client body. No runtime file under `apps/` or `packages/` branches on a constraint name, a field name or an FK SQLSTATE (grep). G1-G4 and T1-T3 answer with one constraint per writer class. The PR's pins hold. Code review R1-m4 (`23001`) and R1-n4 (lexical tripwire) concurred |
| Migration linter | 0 findings, controls reported (P5) |
| Secrets | 0 in the PR range by emulation (P6). No secret-shaped literal in the tests (random hashes from `randomBytes`, fixed UUIDs are the reserved actors) |
| Restricted data | No legacy data, no fixtures copied; synthetic ids only |

## 5. Routed items at this head

| Item | Status |
|---|---|
| PR65-SEC-02 (b) (operator membership self-mint, database option) | **Closed when this migration merges.** Lane B at `203d02eb` passes O1-O6 on PostgreSQL 18. The PGlite positive control shows the probe sees the hole without the rule, and self-joins through MERGE and ON CONFLICT are refused. Residuals: PR051-SEC-03 (new, latent); T-35 impersonation and re-join after REMOVED with a live grant (ruled, rulings §3.3) |
| PR65-SEC-02 (a) (route conditions on TASK-049, TASK-224, TASK-227) | **Open, binding**, unchanged by this PR (rulings §3.3 "What it does not do") |
| PR65-SEC-04 (a) (INVITED by UPDATE) | **Closed** (O6 and SUSPENDED → INVITED probed) |
| PR7-SEC-04, PR7-SEC-12 (d) (de-claim, widened conditions) | **Closed at the database** subject to lane B at the final head: the function ships with the `IS DISTINCT FROM` forms, and the four transitions on all four tables as the superuser (16 cases, green on 18) plus the legitimate claim. TASK-087 renders the trigger per table |
| PR7-SEC-13 (claim through `expectAffected`) | Database half done (C1, C4, C5, AT-US-080-04/05, the race). The repository is TASK-146's (D-TASK051-08: concur) |
| PR293-SEC-03 (a)-(c) | Pinned as ruled; (c) exclusion constraints are now read. PR051-SEC-01 refines what "holds an owner column" means |
| D-TASK051-01..09 | No security objection. -03 (both-owner key reported) is the safe reading. -05 placement concurred. -06 (42501) confirmed on 17.5 and on 18. -07 needs the card lines of condition C6 |

## 6. Code review twin (round 1, main checkout `fa98e4c5` and `b1efe502`, CHANGES_REQUESTED)

- **R1-M1:** same finding as PR051-SEC-01. Concur. My additions are the cross-organisation form through `guest_token_hash` and the TENANT reach of the exclusion form, plus my position on the "stated limit" option (§3).
- **R1-m1 (T2-O entries not kind-checked, justifying CHECK not verified):** concur. It is defence in depth for the first exception entry (TASK-087).
- **R1-m2:** concur; it is part of PR051-SEC-04.
- **R1-m3:** concur.
- **R1-m4 (`23001` on 18):** concur. No oracle: `sqlState` is not client-visible and the mapping is identical. Add the pin.
- **R1-n1..n6:** no security objection. R1-n6 is recorded in §4.
- **L-1 (23001):** a PostgreSQL 18 observation. It goes to the architect, unadapted (condition C2).
- **L-2 (gitleaks):** §8.

## 7. SEC-TC assignment (rulings §7 item 3)

The next free ID is 79 (repository-wide grep: 01..78 plus test decoys).

| ID | Case | Suite | Tests | State |
|---|---|---|---|---|
| SEC-TC-79 | **Operator staff grant.** A self-join into an OPERATOR organisation without a grant raises `P0001 MEMBERSHIP_LIFECYCLE_VIOLATION: an operator membership needs a staff grant`, and the user still sees one organisation with the OPERATOR scope (O1). `platform_app` reads and cannot write the grants (O2). The provisioning lane's grant lets the user join, link an operator role and read across tenants (O3). The member-is-actor and created-ACTIVE rules hold for granted users (O4). A customer join needs no grant (O5). INVITED is unreachable by UPDATE (O6) | `integration` (`organisations.int`) | The O1-O6 test, tagged `[SEC-TC-79]` beside `[D-ARCH-165] [D-ARCH-166]` | `integration.required_cases` in qa-lead's next manifest commit after merge (D-SEC-PR47-01: an ID a passing test carries is never parked) |
| SEC-TC-80 | **Guest-row binding and the one-statement claim at the database.** As `platform_app` with the production context statement: G1-G7, T1-T5, S1-S4 (both owners) and R1-R4 answer the codes and the one constraint per writer class of rulings §2.7. C1 claims in one statement and C2/C3/C6 show why. C4/C5 touch 0 rows through `expectAffected`. The four de-claim transitions on every table as the superuser give `23514 GUEST_DECLAIM_FORBIDDEN`, and the legitimate claim passes. The empty binding and other guests read 0 rows (AT-US-080-02), and a hash-only context cannot claim (AT-US-080-06) | `integration` (`guest-claim.int`) | Those cases, tagged `[SEC-TC-80]`. The existing `[SEC-TC-76]` tags may stay; a test may carry both | Same as SEC-TC-79. The race stays SEC-TC-07 |
| SEC-TC-81 | **Route-side guest binding (D-TASK051-07).** Every registered route that does not declare `tenancy: guest`, other than the claim operation, binds `app.guest_token_hash = ''`. A guest route binds only the lower-case hex digest of the token it authenticated. An organisation session that presents a guest token on a non-guest route reads 0 guest rows | `unit` (registry walk) and `api` | None yet | `required_cases_pending`, owner TASK-091 (authenticator) and TASK-146 (claim) |

Also for qa-lead:

- **SEC-TC-07** keeps its ID. It gains the same-organisation round of PR051-SEC-02 (a). It returns from pending to `required_cases` of `rls-cross-tenant` at the first activation checkpoint after merge.
- **SEC-TC-76's catalogue text** follows C16 as amended: T2-G/T2-O in arm (a); TENANT plus GUEST_CAPABLE and exclusion constraints in arm (b); after PR051-SEC-01, the owner-separation rule.

## 8. Lane B at `203d02eb` and the gitleaks triage (code review L-1, L-2)

- **L-1.** C2 and C6 answer `23001 restrict_violation` on PostgreSQL 18, on the expected constraints. It is the parent-side RESTRICT action. The child-side check (C3, G1-G4, T1-T3) stays `23503`. No security impact: one answer per writer class still holds, and the mapping of `23001` equals that of `23503`. The test must not be adapted before the architect amends rulings §2.7 C2/C6, the §2.3 sentence and the TASK-146 card line (condition C2).
- **L-2.** `gitleaks-full` reports one fingerprint more than the 17-line baseline over the ancestry of `203d02eb`.
  - **Attribution (D-ORCH-147, real image):** `generic-api-key` at `prisma/tests/catalog/tenant-keys.ts:75` in this PR's commit `b34f954e`. My corrected emulation reproduces exactly this one fingerprint and nothing else (§2 P6). Main is clean: TASK-080's run on the same base passed, and the emulation finds nothing in the 9 docs commits.
  - **Why it fires.** The line is the doc comment of `TenantReference.rest`. The keyword `key` ("key columns") and the comma as the assignment operator are followed by a backticked `child=parent`: 12 characters of `[\w.=-]` with 12 distinct characters, entropy about 3.58, above the rule's 3.5. That is the secret group. The generic rule's allowlists (the `match`-target list and stopwords) do not cover it. **gitleaks v8.30.1 has no "generic secret needs a digit" check.** My earlier emulators assumed one, and that is why the first run missed it.
  - **Ruling: false positive, no secret.** I confirm the D-ORCH-147 handling, which is route (2) of D-SECPR040-02:
    - the fix cycle rewords the comment;
    - the branch is superseded by `feat/TASK-051-guest-capable-tables-atomic-claim-v2` (one squash commit on main), so `b34f954e` never reaches main;
    - the baseline and `.gitleaks.toml` stay unchanged.
  - **Conditions on the route:**
    - The new wording leaves no shape the rule takes, for example "the remaining key columns as child and parent column pairs". The shape to avoid is a keyword (`key`, `token`, `secret`, `auth`, `access`, `api`, `credential`, `passwd`/`password`) followed within about 20 word characters by `=`, `:`, `,` or `=>` and then a run of 10 or more `[\w.=-]` characters with high entropy.
    - The v2 range gives 0 under the corrected emulation and in lane A's PR-range scan.
    - gitleaks-full on the v2 head gives 0 against the unchanged 17-line baseline.
    - The supersede gets a round that binds the record to the v2 head by tree equality with the reviewed fix head (condition C5).

  This is condition C3.

## 9. Lane B cases that must pass (PostgreSQL 18, final head)

1. `prisma/tests/rls/guest-claim.int.test.ts`: every case, including C2/C6 as amended by the architect, the 16 de-claim cases, and AT-US-080-01..07 (07 only runs on 18).
2. `tests/generated/rls/guest-claim-race.int.test.ts` through the `rls-cross-tenant` runner (`--selectProjects generated`): SEC-TC-07, the deterministic lock wait, the 5 rounds, and the same-organisation round of PR051-SEC-02 (a) if it is taken in this cycle. Also the whole generated RLS suite (the GUEST_CAPABLE probe now runs over the migrated function).
3. `prisma/tests/organisations/organisations.int.test.ts`: O1-O6 and every TASK-037 block (a reseed regression would show here). The PR051-SEC-03 case too, if the architect folds the clause now.
4. `prisma/tests/catalog/c16-tenant-keys.int.test.ts`, with the PR051-SEC-01 planted shapes after the fix. `c01-c12.int.test.ts`: C1/C2 GLOBAL allow-list, C5 and its planted control, C8, C9, C11 (the new function: not definer, fixed path, EXECUTE for neither PUBLIC nor `platform_app`), C13, rule 16. `c10-classification.int.test.ts`, and `c15-std-columns-guard.int.test.ts` (scope unchanged).
5. `prisma/tests/migrations/up-down-up.int.test.ts` (function text unchanged after down/up), `prisma/tests/shadow/shadow-init.int.test.ts`, `prisma/tests/seed/seed.int.test.ts`.
6. `tools/quality/gitleaks-full.int.test.ts`, after condition C3.

The developer reports the operator-clause mutant from lane B (brief scope note 10). The PGlite controls of the code review and of P4 are supplementary.

## 10. Record binding and simulation

- **Binding.** This record binds the 20 owned paths of `e245e6e6...203d02eb` to head `203d02eb1b92a721f64ccbd881b73a68c178e6f4`.
  - Any later change to one of those paths voids it. That includes the fix cycle that conditions C1 and C2 require, and a union merge of main that touches `prisma/sql/grants.manifest`, `tools/db/grants-manifest.test.ts` or `prisma/tests/rls/tenant-db.real-client.test.ts` (TASK-040, TASK-043, TASK-080).
  - The unowned `packages/shared/src/classification/registry.ts` union does not void it.
  - Docs-only and lane B evidence commits after the head keep the binding.
- **Simulation.** Main's real checker at `d7585e78`, in a sparse shared clone. The record was committed as `PR-9999-TASK-051-security-review.md` on a main-tip commit, merged with the PR head through `git merge-tree` and `commit-tree`, and run with `--pr 9999`. The record has exactly one Head row and one Verdict row. 11 of 11 scenarios came out as expected, each counting 20 owned paths:
  - **Pass:**
    - the record merged with `203d02eb`, with `--base` the merge base and with `--base` the main tip;
    - a docs-only evidence commit after the head;
    - an edit of the unowned `registry.ts` after the head;
    - the branch merging a docs-only main.
  - **Missing:**
    - no record;
    - the placeholder name only;
    - a later FAIL verdict row;
    - a Head row naming a main commit;
    - an owned `tenant-keys.ts` edit after the head (the C1 fix cycle);
    - the branch merging a main that also appended to `grants.manifest` (a union merge).

## 11. Routing

| Item | Owner | Due |
|---|---|---|
| PR051-SEC-01 (= R1-M1) | senior-developer, this PR; principal-architect confirms the arm (b) text (code review §4 item 2) | Merge condition C1 |
| PR051-SEC-02 (a) | senior-developer, this PR's fix cycle (test only, owned path already changing) | Preferred now; at the latest before SEC-TC-07 returns to `required_cases` |
| PR051-SEC-02 (b) | TASK-146 card line: SEC-TC-07 runs the repository's claim statement, or a unit test pins it to rulings §2.3 with the predicate on the quote and every child | With TASK-146 |
| PR051-SEC-03 | principal-architect: fold the UPDATE clause into this migration (cheap, closes it before M2), or add it to the M2 grant-removal amendment with "offboarding = REMOVED plus grant deletion" | Before any grant removal exists (M2); preferably now |
| PR051-SEC-04 | TASK-087 card line: catalog assigner row for owner columns on GUEST_CAPABLE tables; the guard presence check stays in the generated suite. The pin: senior-developer, with R1-m2 | TASK-087; R1-m2 in this cycle |
| PR051-SEC-05 | TASK-089 card line (repository test also covers reads of `operatorStaffGrant`); M2 admin design | TASK-089; M2 |
| SEC-TC-79, -80, -81 and SEC-TC-07 / -76 text | qa-lead (catalogue rows, manifest) and senior-developer (tags in this PR's fix cycle) | Tags in this cycle; manifest right after merge |
| L-2 (false positive in `b34f954e`) | senior-developer (reword `tenant-keys.ts:75` in the fix cycle), orchestrator (v2 supersede, D-ORCH-147) | Merge condition C3 |
| Threat model T-35 | security-analyst (mine): cite the grant as what protects the operator membership from being minted, and PR051-SEC-03 as the reactivation residual (rulings §7 item 4) | Next threat-model revision, before G3 |

## 12. Conditions

- **C1.** PR051-SEC-01 (R1-M1) fixed: SQL facts, pure-rule fixtures, planted probes and header. If the architect makes the exclusion half a stated limit, it must come with the "no exclusion constraint in scope" assertion of §3.
- **C2.** The architect amends rulings §2.7 C2/C6 for PostgreSQL 18 (`23001`). The two expectations change only in a commit that cites the amendment. R1-m4's `23001` pin is added.
- **C3.** L-2 closed by the D-ORCH-147 route as confirmed in §8. The comment at `tenant-keys.ts:75` is reworded and the branch is superseded by the v2 squash. The v2 range scans clean (corrected emulation, lane A) and gitleaks-full on the v2 head is clean against the unchanged baseline.
- **C4.** Lane B on PostgreSQL 18 green at the final head for the cases in §9. Triage is not evidence.
- **C5.** A delta security round on the fix head (C1 and C2 change owned paths), and a supersede round on the v2 head. The supersede round proves tree equality with the reviewed fix head, writes its own Head row, and goes in a record named for the v2 PR. A merge-only round after any union merge of main that touches an owned path this PR changes.
- **C6.** The route-side binding (D-TASK051-07) and SEC-TC-81 are on the TASK-091 and TASK-146 cards (senior-developer fold), with the HTTP halves of AT-US-080-01..07, before this PR merges.
- **C7.** Rename this record on main once the PR exists, and confirm that the merge ref contains it (D-ORCH-136, D-ORCH-138).

The operator-grant half (migration 2, O1-O6, the grant pins) carries no open finding beyond the latent PR051-SEC-03. If the orchestrator splits it into its own PR for TASK-089, that PR needs its own record, because its owned-path set differs. A round on that head can reuse §2 P1/P4/P5 and §5.

| Field | Value |
|---|---|
| Verdict | PASS_WITH_CONDITIONS. No Critical, High or Medium finding. Conditions C1 to C7. LOW PR051-SEC-01 (condition C1), LOW PR051-SEC-02 and LOW latent PR051-SEC-03 routed; INFO PR051-SEC-04 and -05 routed. PR65-SEC-02 (b) and PR65-SEC-04 (a) close with this migration |

---

# Round 2: delta for fix cycle 1 and the v2 supersede, head `39cac6e5` on `feat/TASK-051-guest-capable-tables-atomic-claim-v2` (2026-11-21)

This round meets condition C5 of round 1 and the security half of QG-051-C4 (D-QG-005). It covers three steps:

- **Fix cycle 1 on the old branch, `203d02eb..a79facce`:**
  - `9d483b21`: C16 rules B1 and B2, the both-owner key and T2-O entries (D-ARCH-207 to D-ARCH-209; PR051-SEC-01);
  - `4e264a3b`: the operator rule on UPDATE and case O7 (D-ARCH-214; PR051-SEC-03);
  - `90f23f93`: C2 and C6 at `23001`, the four-combination pin and the three-token tripwire (D-ARCH-211, D-ARCH-212), and the AT-US-080-03 set;
  - `a79facce`: the same-organisation race rounds with their predicate control (PR051-SEC-02 (a)), the template pin (R1-m2) and the reworded comment (L-2).
- **The supersede `c1c8a6ec`:** one squash commit on main `530629f4`, on the new branch.
- **`39cac6e5`:** `[SEC-TC-79]` and `[SEC-TC-80]` in test titles only (code review R2-m1).

The old branch keeps its commits, unpushed, as the archive of the reviewed SHAs. No ref was moved, and nothing was pushed or force-pushed. The developer decisions D-TASK051-10 to -15 are in the commit bodies (accepted by reference, D-ORCH-149).

| Field | Value |
|---|---|
| Head | 39cac6e5f86d0f50332770e7bdac819b893a958a |
| What was reviewed | The code delta `203d02eb..a79facce` (14 files) in full. The supersede `c1c8a6ec` by tree equality (R2.1). The titles commit `39cac6e5` by a normalised comparison (R2.1) |
| Merge base with main | `530629f4`, the parent of `c1c8a6ec`. When this round was written, origin/main was `7f8731dd` and local main was `530bf62f`, two unpushed documents commits of other agents ahead. `530629f4..530bf62f` (34 commits) changes no path outside `docs/` and `.claude/`. `git merge-tree --write-tree` of `39cac6e5` with either tip is clean. No `feat/TASK-051*` ref exists on the remote |
| Owned paths changed | 21, as main's checker counts them (`--base 530629f4 --head 39cac6e5 --pr 9999`, no record: `missing`; the same 21 with `--base` the main tip). They are the 20 of round 1 plus `prisma/sql/policy-templates/guest-capable-guard-function.sql` (template header, R1-m2). Not owned, as before: `packages/shared/src/classification/registry.ts` and `tools/repo/refused-reference-answer.test.ts`. The classifier (`tools/ci/security-paths.mjs`) gives `security_paths=true` (19 paths), so the hosted `security-integration` job runs on the PR |
| Lane B evidence | **None for this head yet**; the final run on `39cac6e5` is queued.<br>- The run on `c1c8a6ec` (`20261121T0518Z_c1c8a6e`) is VOID: a Prisma spawn timed out under host load in one integration file, `c16-tenant-keys.int`. See `../.orch/laneb-queue/queue.log`.<br>- I read only the queue log and the lane B log. In that log, 1 of 44 integration files failed: that file, 15 tests. The `generated` project passed 162 of 162. The queue note says the race file was among them and the catalog copy of C16 passed 121 of 121.<br>- This agrees with the probes below. It is not credited |
| Method | - Git plumbing from the main checkout.<br>- `git archive` extracts of `39cac6e5` and `203d02eb` in the session scratchpad.<br>- PGlite 0.4.3 (PostgreSQL 17.5): bootstrap files 00 to 02, then all 9 migrations as `platform_migrator`, statement by statement, as the runners apply them.<br>- The head's own modules, type-stripped: `tenant-keys.ts`, `guest-claim-probe.ts`, `table-classes.ts`, `lint-migrations.ts`, with the production `CONTEXT_STATEMENT_SQL`.<br>- **Positive controls:** the round-1 rules and the round-1 function text.<br>- The gitleaks v8.30.1 emulation of round 1, which has no digit check.<br>- Main's real `check-security-owned-paths.mjs` in a sparse shared clone.<br>- **Not used:** Docker, PostgreSQL 18, Jest, the TASK-051 worktree |

## R2.1 Supersede: the code reviewed is the code of this head

| Check | Result |
|---|---|
| `tree(c1c8a6ec)` against `git merge-tree --write-tree a79facce 530629f4` | **Equal**: `6cc1ca4b` for both, exit 0 |
| Shape | `530629f4..39cac6e5` holds 2 commits and no merge. `c1c8a6ec` has the one parent `530629f4`, and `39cac6e5` has the one parent `c1c8a6ec` |
| The net diff | **Identical, ignoring `index` lines:** `git diff e245e6e6 a79facce` (the old branch against its base) equals `git diff 530629f4 c1c8a6ec` (2,955 lines). The file sets are equal (23 files). `e245e6e6..530629f4` touches none of them, and no path outside `docs/` and `.claude/` |
| `c1c8a6ec..39cac6e5` | **Titles only:**<br>- Two files: `organisations.int.test.ts` and `guest-claim.int.test.ts`.<br>- **Comparison method:** remove the two tags, all white space and the trailing commas before `)` (the Prettier re-wrap of two `it.each` calls). Both files are then equal to the `c1c8a6ec` text.<br>- **Controls:** without removing the tags, the texts differ; a one-token change in a test body also differs.<br>- `[SEC-TC-79]` is on the O1 to O6 title. `[SEC-TC-80]` is on 16 titles: G1-G6, G7, T1-T5, S1-S4, R1-R3, R4, C1 to C6, the 16 de-claim cases, the legitimate claim, AT-US-080-02 and AT-US-080-06. That is the list of round-1 §7 |

So round 1 and the delta review below hold for `39cac6e5` unchanged.

## R2.2 Delta: what changed and what I verified

| Item | Result |
|---|---|
| **PR051-SEC-01, C16 (b) rules B1 and B2** (`9d483b21`; D-ARCH-208) | - `TENANT_UNIQUE_INDEXES_SQL` (`tenant-keys.ts:306-326`) returns `nulls_not_distinct`, and for each owner key column `not_null` and `equality` (btree strategy 3 through `pg_amop`, `conexclop` by key position).<br>- `ownerColumnDefects` decides. A missing operator fact counts as "not equality", so it fails closed. An exception applies only to an index with no owner key column at all.<br>- **P8 (B), planted lists:** every planted list of the head gives exactly its expected findings. Arm (a): 9 keys, with `c16_g_both_parent`. Arm (b) TENANT: 4 indexes, with `c16_ex_org_ne_code`. Arm (b) GUEST_CAPABLE: 6 indexes, with both NULLS NOT DISTINCT shapes and `org_id WITH <>`. **The round-1 rules on the same rows** report 3 of the 4 TENANT and 3 of the 6 GUEST_CAPABLE indexes: they miss every shape of PR051-SEC-01.<br>- **P8 (A), committed schema:** both arms report 0 findings and 0 exception findings (scope: 4 tables) |
| **P8 (C): behaviour against classification on `gc_quotes`** | **Setup.** Committed rows: guest H2 and organisation A each hold `X`. Then guest H1 and organisation B insert `X` and `Y`, as `platform_app` with the production context statement. A "channel" means `X` and `Y` get different answers.<br>**The head reports every shape that opens a channel:**<br>- `(org_id, code) NULLS NOT DISTINCT`: guest `23505`;<br>- `(guest_token_hash, code) NULLS NOT DISTINCT`: organisation `23505`;<br>- `EXCLUDE gist (org_id WITH <>, code WITH =)`: organisation `23P01`;<br>- `EXCLUDE gist (guest_token_hash WITH <>, code WITH =)`: guest `23P01`;<br>- `(COALESCE(org_id, <zero uuid>), code)`: guest `23505`.<br>The round-1 rule misses the first four.<br>**Reported with no channel (fail closed):** `NULLS NOT DISTINCT (org_id, guest_token_hash, code)`, as D-ARCH-208 item 6 rules, and a partial NULLS NOT DISTINCT index `WHERE org_id IS NOT NULL`, the stated "predicates are not compared" limit.<br>**Passed with no channel:** `(org_id, code)`; `EXCLUDE (org_id WITH =, code WITH =)`; `EXCLUDE (org_id WITH =, guest_token_hash WITH <>, code WITH =)`; `EXCLUDE (org_id WITH =, code WITH <>)`.<br>`UNIQUE (code) INCLUDE (org_id)` could not be built over the seed rows; the planted `c16_ux_code_include` covers it.<br>**Result:** no shape opens a channel that the head passes |
| **C16 (a): both-owner key and T2-O entries** (`9d483b21`; D-ARCH-207, D-ARCH-209) | - `violationKind` reports a key that holds both owner columns as `both-owners` and never takes it as a sibling.<br>- `exceptionDefect` requires all of: kind `org-only`; exactly one other referencing column; the named constraint on the referencing table; `contype c`; `convalidated`; the exact printed predicate.<br>- Code review round 2 probed the CHECK variants (dropped, `OR org_id IS NULL`, `NOT VALID`, `NO INHERIT`, a rewritten predicate) and found that each fails closed.<br>- **One gap in how an entry is matched to its column:** PR051-SEC-06 (R2.4) |
| **PR051-SEC-03, the operator rule on UPDATE** (`4e264a3b`; D-ARCH-214) | - The migration equals the fenced block of rulings §3.4 item 1 byte for byte (indent stripped, 3,867 bytes). Its clause (`migration.sql:53-56`) is the one round 1 proposed. `down.sql` and the guard migration are unchanged since `203d02eb`.<br>- **Migration linter:** 0 findings on the head; the controls (guard made `SECURITY DEFINER`, manifest entry removed) give 2.<br>- **P9, every case as `platform_app` with the production context:**<br>&nbsp;&nbsp;- A SUSPENDED operator membership without a grant is set ACTIVE by another operator-context session: `P0001 … needs a staff grant`, and the member still sees 1 organisation.<br>&nbsp;&nbsp;- **Control, the round-1 function text replaced in the transaction:** `ok`, and the member sees 3 organisations.<br>&nbsp;&nbsp;- The same is refused through `INSERT … ON CONFLICT (id) DO UPDATE`, through `MERGE … WHEN MATCHED THEN UPDATE`, for `INVITED → ACTIVE`, and when the member reactivates itself.<br>&nbsp;&nbsp;- A granted member: `ok`, sees 3. A customer membership: `ok`.<br>&nbsp;&nbsp;- `ACTIVE → SUSPENDED` and `SUSPENDED → REMOVED` without a grant: `ok`, so offboarding is never blocked.<br>&nbsp;&nbsp;- `user_id` and `org_id` changes stay refused (`user_id cannot change`; a move into the operator organisation touches 0 rows).<br>&nbsp;&nbsp;- `ACTIVE → ACTIVE` without a grant: `ok`. This is the residual D-ARCH-214 states (deleting a grant does not end an ACTIVE membership; binding on the M2 amendment).<br>- **Trigger and function:** `AFTER INSERT OR UPDATE OF user_id, org_id, status`; the function is owned by `platform_migrator`, not definer, `search_path=pg_catalog, pg_temp`, EXECUTE for the owner only. After `down.sql` the body holds neither the grant rule nor the INVITED rule, which is the `20261117000000` body.<br>- O7 (`cases.ts:795`, `organisations.int.test.ts:316`) is the round-1 verification case. Code review round 2 killed its mutant on PGlite |
| **PR051-SEC-02 (a), same-organisation race rounds** (`a79facce`; D-TASK051-14) | - Two rounds in `guest-claim-race.int.test.ts:264-277`: two users of A, and one user twice. The lock wait is asserted through `pg_stat_activity`. The loser commits when its claim touched a row. The claim record must keep the winner and the token digest.<br>- **The control (`:279-286`)** runs `CLAIM_WITHOUT_PREDICATE_SQL` (`:146`). It also asserts that `CLAIM_SQL` holds the predicate 4 times: the quote and the three children.<br>- **P10, a sequential replay on PGlite** (one connection; it equals what the blocked UPDATE re-evaluates under READ COMMITTED). The real statement gives 1 then 0, and the claim record is kept. The test's mutant gives 1 then 1 for two users of A and for the same user twice: `claimed_from_token_hash` becomes NULL, and for two users the claimant is overwritten. For A then B, the mutant gives 1 then 0, the same as the real statement. So only the new rounds see the predicate.<br>- The concurrent run is lane B's (C4). Part (b) is the TASK-146 card line REAL CLAIM STATEMENT IN SEC-TC-07 (D-SD-011) |
| **C2 and C6 at `23001`; the D-ARCH-212 pins** (`90f23f93`) | - Only the two expectations, their titles and the header changed, citing D-ARCH-211. C3 stays `23503`.<br>- `map-db-error.test.ts` runs 2 SQLSTATEs × 2 Prisma codes, and asserts that the answers differ in `sqlState` only.<br>- `FK_CODE` carries three tokens, with positive and negative controls for each.<br>- **`git grep -P` with the tripwire pattern at the head:** no file under `apps/` or `packages/` names `P2003`, `23503` or `23001`, other than `map-db-error.*`. The timestamp `…20.123001Z` is not matched (digit lookbehind).<br>- No product code changed. The `sqlState` stays out of the client body (round 1, §4) |
| **Template pin and header** (`a79facce`; R1-m2, part of PR051-SEC-04) | - `guest-claim-probe.test.ts` asserts three things: the guard migration contains `renderGuestCapableGuardFunction()` verbatim; it has one `CREATE FUNCTION`; and nothing remains besides comments.<br>- The template header says that a change needs a new migration.<br>- The code review's mutant run killed the pin. I read it and did not re-run it |
| **AT-US-080-03 set** (`90f23f93`; D-TASK051-13) | Read. The set of nullable `org_id` roots is compared in both directions with GUEST_CAPABLE and a listed SYSTEM table. A union merge that adds a nullable `org_id` table now fails unless that table is flagged. No security objection |

Not run by me: anything on PostgreSQL 18, the two-connection race, Jest, lint, typecheck. Code review round 2 ran the unit suites, lint, format and `tsc -b` on a `c1c8a6ec` extract, all clean, and `39cac6e5` changes only titles. Lane B on `39cac6e5` is the PostgreSQL 18 evidence (C4).

## R2.3 Status of the round-1 findings at `39cac6e5`

| ID | Status |
|---|---|
| PR051-SEC-01 (LOW) | **Closed in code.** Rules B1 and B2 are enforced on TENANT and GUEST_CAPABLE tables, the exclusion half included, as round 1 asked (no "stated limit"). The planted probes, fixtures and header are in place. P8 shows every channel shape reported and the round-1 rule missing them. PostgreSQL 18 proof: lane B (C4) |
| PR051-SEC-02 (LOW) | **(a) closed in code** (the same-organisation rounds and the predicate control; P10). The concurrent proof on PostgreSQL 18 is lane B's (C4). **(b) open on TASK-146**, as its card line REAL CLAIM STATEMENT IN SEC-TC-07 says. It is not a TASK-051 item |
| PR051-SEC-03 (LOW, latent) | **Closed in code** (D-ARCH-214, ADR-0005 amendment 15 item 39; O7; P9). **Residual, stated and bound:** a member who is ACTIVE when the grant is deleted stays an operator. The M2 amendment of rulings §3.3 item 4 ties grant deletion to the membership. Until M2 only the migrator lane deletes grants |
| PR051-SEC-04 (INFO) | **The single-source half is closed** (the template pin). **The trigger-order half is open on TASK-087**, as card line OWNER COLUMN ASSIGNER (D-SD-011): a catalog check that reports a BEFORE UPDATE trigger assigning `org_id` or `guest_token_hash` on a GUEST_CAPABLE table |
| PR051-SEC-05 (INFO) | **Open on TASK-089**, as card line STAFF GRANT READS (D-SD-011); the M2 admin design follows |
| L-2 (gitleaks false positive, condition C3) | **Closed in the PR's history** (R2.5). The real-image proof is gitleaks-full in lane B on `39cac6e5` (C4) |

PR65-SEC-02 (b) and PR65-SEC-04 (a) close when this migration merges, as round 1 said; P9 adds the UPDATE half. PR7-SEC-04, PR7-SEC-12 (d) and PR7-SEC-13 are unchanged from round 1 §5.

## R2.4 New finding

| ID | Title | Severity | CWE | OWASP | File:line | Owner / due |
|---|---|---|---|---|---|---|
| PR051-SEC-06 | A T2-O exception entry is matched to its referencing column by splitting the `rest` text on `=` and `,`, so a column name that contains `=` lets a CHECK on another column hide the key | INFO | CWE-1023 | A01 | `prisma/tests/catalog/tenant-keys.ts:122` (`rest` as joined text), `:223-226` (`soleRestColumn`), `:239`; the same text is the sibling key at `:191` | TASK-298, which owns these files and merges before TASK-087 opens its PR. TASK-087 writes the first entry (`fk_quotes__requote_of_quote_id`) |

**PR051-SEC-06 (INFO): the entry check parses identifiers out of joined text.**

- **What.**
  - `TENANT_REFERENCES_SQL` builds `rest` as the text `child=parent,child=parent`.
  - `soleRestColumn` takes everything before the first `=` as the referencing column.
  - `exceptionDefect` then compares the named CHECK with `orgOnlyCheckDefinition(<that prefix>)`.
  - PostgreSQL identifiers may hold `=` and `,` when quoted, and the migration linter does not restrict column names.
- **Probe P8 (D).**
  - **The plant:** `c16_g_eq` with the columns `a` and `"a=x"`; the CHECK `a IS NULL OR org_id IS NOT NULL`; and the key `(org_id, "a=x") → c16_gparent (org_id, id)`.
  - **What C16 reads:** `rest` is `a=x=id`.
  - **The gate is silent:** an exception entry that names the key and the CHECK hides it, and `referenceExceptionFindings` reports nothing.
  - **The hole is real:** a guest row (`org_id` NULL) whose `"a=x"` names organisation A's parent is accepted (`ok`), because MATCH SIMPLE skips the key and the CHECK constrains `a`.
  - **Control:** the same entry shape on a table whose CHECK is on the real column `b` refuses the guest row (`23514`).
- **Exploitability.** Not reachable today: the exception map is empty until TASK-087. It needs both of these:
  - a migration that quotes a column name containing `=`;
  - an exception entry, which needs a principal-architect ruling, that names a CHECK on a different column.

  Neither is a plausible mistake. The gate exists to catch mistakes, so this is INFO.
- **Same construction elsewhere (reasoning, not probed).** The sibling comparison (`other.rest === row.rest`) compares the same text. So `a → "b=c"` and `"a=b" → c` would give equal `rest` values for different column pairs.
- **Fix (code-level, TASK-298).**
  - Return the pairs as structured data instead of joined text: `jsonb_agg(jsonb_build_array(ka.attname, kp.attname) ORDER BY k.n)`, or two `text[]` columns.
  - Compare the arrays for siblings.
  - `soleRestColumn` returns the referencing name of a one-element array.
  - Plant `c16_g_eq` with an entry; it must be reported together with the entry.

## R2.5 Gitleaks: the PR range holds no finding (condition C3)

**The emulator.** The round-1 emulator `gl-nodigit`: gitleaks v8.30.1 git mode, `-U0 --diff-merges=first-parent`. Each hunk's added lines form one fragment. It has no digit check, uses `regexTarget` allowlists and stopwords, and takes the repository's `.gitleaks.toml` from main.

**Controls.**
- The runtime controls fire (1, 1, 0 as expected).
- Main's `.gitleaks.toml` and `tools/quality/gitleaks-baseline.txt` are unchanged since `530629f4`.

| Range | Added lines | Findings |
|---|---|---|
| `e245e6e6..a79facce` (old branch, control) | 2,723 | **1**: `b34f954e:prisma/tests/catalog/tenant-keys.ts:generic-api-key:75`, the lane B fingerprint of round 1 |
| `203d02eb..a79facce` (fix cycle; includes the reword) | 877 | 0 |
| `530629f4..39cac6e5` (lane A's PR range: event base = merge base) | 2,553 | **0** |
| Whole ancestry of `39cac6e5` (what gitleaks-full scans) | 1,459,308 | **17, exactly the 17 fingerprints of `gitleaks-baseline.txt`** (`comm`: none extra, none missing) |

**What this means:**
- **Lane A** is clean.
- **Lane B and lane C** (gitleaks-full) see the baseline only, because `b34f954e` is not an ancestor of the v2 head.
- The baseline and `.gitleaks.toml` stay unchanged.

**What is still owed:** this is an emulation. The real image's gitleaks-full on `39cac6e5` is part of C4. No values were printed.

## R2.6 Items routed to security-analyst

| Item | Answer |
|---|---|
| **Does O7 join SEC-TC-79?** (D-ARCH-214; QG-051-C4; code review R2-m1) | **Yes.** O7 is the UPDATE half of the same control: an operator membership is ACTIVE only with a staff grant (ADR-0005 amendment 15 item 39). The SEC-TC-79 case text becomes O1 to O7. Add to it: "an operator membership that becomes ACTIVE by UPDATE, ON CONFLICT DO UPDATE or MERGE without a grant is refused, and offboarding to SUSPENDED or REMOVED needs none".<br>**The `[SEC-TC-79]` tag on the O7 title is a follow-up, not a merge condition:**<br>- SEC-TC-79 is already carried by a passing test (O1 to O6), so qa-lead's manifest commit after merge is not blocked.<br>- What the missing tag loses is the evidence rule that no SEC-TC case may be skipped. `integration` is not a zero-skip suite, so until the tag lands, a skipped O7 would go unnoticed.<br>- Adding the tag now would change an owned path after this head and void this record (R2.8 C5).<br>- **Owner:** the next commit that changes `prisma/tests/organisations/organisations.int.test.ts`, or a titles-only commit by senior-developer. **Due:** before G3, where D-QG-005 looks for O7 |
| SEC-TC-80 | Carried as round 1 §7 listed it (R2.1). qa-lead puts SEC-TC-79 and -80 into `integration.required_cases` in the manifest commit after merge (D-SEC-PR47-01) |
| SEC-TC-79, -80 and -81 catalogue rows, and the T-35 wording | **Mine**, in the next threat-model revision before G3: the rows go into the SEC-TC table of `threat-model.md`. T-35 cites the grant as what protects the operator membership, and the grant-deletion residual of D-ARCH-214 |
| D-ARCH-216 (QG-051-C6): a constraint counts only while it is enforced and validated | **Concur.** It is the reference-side twin of PR051-SEC-01. Reading `conenforced` and `convalidated` in the catalog covers `ALTER CONSTRAINT` and dynamic SQL, which a linter token rule would miss. The planted probes of arms (c) and (d) join **SEC-TC-76**: TASK-298 tags them `[SEC-TC-76]`, like the other C16 plants. I did not run them: `conenforced` does not exist on PostgreSQL 17, and I used no PostgreSQL 18 |
| D-ARCH-215 arm (d): every foreign key is `RESTRICT` on both actions | **Concur** (read, not executed). PostgreSQL runs a referential action as the owner of the referencing table with row security not forced. A `CASCADE` or `SET NULL` key would therefore rewrite rows past the policies, the standard-columns guard and the audit trail |

## R2.7 Conditions (these replace C1 to C7 of round 1)

| Round-1 condition | Status at `39cac6e5` |
|---|---|
| C1 (PR051-SEC-01) | **Closed** (R2.2, R2.3) |
| C2 (`23001`) | **Closed in code:** D-ARCH-211 amends rulings §2.7; `90f23f93` cites it; the four-combination pin is in place. PostgreSQL 18 proof: C4 |
| C3 (gitleaks) | **Closed in the history** (R2.5). The real-image proof is in C4 |
| C4 (lane B) | **Open.** See below |
| C5 (delta and supersede rounds) | **Closed by this round** for `39cac6e5`. It stays in force for later changes (see below) |
| C6 (card lines, SEC-TC-81) | **Closed** by D-SD-011 (`41bcb54a`), which carries the TASK-091 dispatch gate (QG-051-C5) |
| C7 (rename) | **Open.** See below |

**Open conditions for merge:**

- **C4.** Lane B green on PostgreSQL 18 at `39cac6e5`, with `git_dirty` false. Triage is not evidence. It must show:
  - `guest-claim.int.test.ts`: every case, C2 and C6 at `23001` and C3 at `23503`, the 16 de-claim cases, and AT-US-080-01 to -07;
  - `organisations.int.test.ts`: O1 to O7 and every TASK-037 block;
  - `c16-tenant-keys.int.test.ts`, in its integration copy and its catalog copy: the planted lists of `tenant-keys.ts` (the six D-ARCH-208 probes, `c16_g_both`), the four T2-O cases and the printed CHECK text;
  - `tests/generated/rls/guest-claim-race.int.test.ts` through `rls-cross-tenant`: the cross-organisation race, the 5 rounds, both same-organisation rounds and the predicate control;
  - `up-down-up`, `shadow-init`, `seed`, the generated RLS suite, and catalog C1 to C16;
  - `tools/quality/gitleaks-full.int.test.ts`, clean against the unchanged 17-line baseline.

  An answer on PostgreSQL 18 that differs from rulings §2.7 or §8 goes back to principal-architect, unadapted. The §8.3 definition text is the one exception.
- **C7.** Rename this record on main for the v2 PR, as `PR-<NNNN>-TASK-051-security-review.md` (D-ORCH-136, D-ORCH-138). Then confirm that the merge ref contains it.
- **C8 (new).** The hosted `security-integration` job is green on the PR's first `pull_request` event.
- **C5, as it stands.**
  - A change of an owned path after `39cac6e5` needs a new round. That includes the O7 tag of R2.6 if it is taken in this PR.
  - A union merge of main that touches `prisma/sql/grants.manifest`, `tools/db/grants-manifest.test.ts` or `prisma/tests/rls/tenant-db.real-client.test.ts` needs a merge-only round. TASK-040, TASK-043 and TASK-080 touch them.
  - Documents-only commits and lane B evidence commits keep the binding.

**Follow-ups, not merge conditions:**
- PR051-SEC-02 (b): TASK-146.
- PR051-SEC-04: TASK-087.
- PR051-SEC-05: TASK-089.
- PR051-SEC-06: TASK-298.
- The O7 tag: before G3.
- The SEC-TC catalogue rows and T-35: mine, before G3.

## R2.8 Record binding and simulation

- **Binding.** This round binds the 21 owned paths of `530629f4...39cac6e5` to head `39cac6e5f86d0f50332770e7bdac819b893a958a`.
  - The round-1 Head row (`203d02eb`) names a commit outside the v2 range. Main's checker skips such a row, so this round's row is the only one that can satisfy it.
  - Without this round, the result is `missing` ("its head row names no commit of this PR").
- **Simulation.** Main's real checker at `530bf62f`, in a sparse shared clone.
  - **Setup:** the record, rounds 1 and 2, committed as `PR-9999-TASK-051-security-review.md` on a main-tip commit; that commit merged with the PR head through `git merge-tree` and `commit-tree`; the checker run with `--pr 9999`.
  - **Record shape:** two Head rows (`203d02eb`, `39cac6e5`) and two Verdict rows; the last Verdict row is this round's.
  - **Results: 14 of 14 as expected, each counting 21 owned paths.**
    - **Pass, satisfied by `39cac6e5`:** the record merged with the head, with `--base` the merge base `530629f4` and with `--base` the main tip; a documents-only evidence commit after the head; an edit of the unowned `registry.ts` after the head; the branch merging a documents-only main.
    - **Missing:** no record; the round-1 record alone (its Head row `203d02eb` is outside the v2 range); the pending name only; a later FAIL verdict row; the Head row naming a main commit; the round-2 Head row naming `c1c8a6ec` (the titles changed after it); an owned `tenant-keys.ts` edit after the head; the O7 tag added to `organisations.int.test.ts` after the head; the branch merging a main that also appended to `grants.manifest` (a union merge).

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_CONDITIONS.** Round 2 (delta for fix cycle 1, and the supersede) at `39cac6e5` on `feat/TASK-051-guest-capable-tables-atomic-claim-v2`.<br>- **Supersede:** the tree of `c1c8a6ec` is the merge of the reviewed `a79facce` with main (`6cc1ca4b`), and `39cac6e5` changes test titles only.<br>- **Findings:** 0 Critical, 0 High, 0 Medium.<br>- **Closed:** PR051-SEC-01, PR051-SEC-02 (a), PR051-SEC-03, the single-source half of PR051-SEC-04, and L-2 in the history.<br>- **Open and routed:** PR051-SEC-02 (b) to TASK-146, PR051-SEC-04 to TASK-087, PR051-SEC-05 to TASK-089.<br>- **New:** PR051-SEC-06 (INFO), routed to TASK-298.<br>- **SEC-TC-79:** O7 joins it. Its title tag is a follow-up, due before G3.<br>- **Gitleaks:** the emulation finds 0 in `530629f4..39cac6e5`, and the head's ancestry gives exactly the 17-line baseline.<br>- **Conditions for merge:**<br>&nbsp;&nbsp;- C4: lane B green on PostgreSQL 18 at `39cac6e5`, gitleaks-full included;<br>&nbsp;&nbsp;- C7: the rename and the merge-ref check;<br>&nbsp;&nbsp;- C8: the hosted `security-integration` job |
