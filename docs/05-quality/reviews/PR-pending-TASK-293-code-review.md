# Code review: TASK-293 (`lexfu`, TASK-290-F), pre-push round 1

| Field | Value |
|---|---|
| PR | not pushed yet (pre-push review; the orchestrator renames this record once the PR exists) |
| Branch / head | `feat/TASK-293-task-290-f-tools-db` @ `3183525` (one commit), based on `origin/main` `ca7e4b7` |
| Diff reviewed | `git diff ca7e4b7 3183525`: 12 files, +866 / -31 |
| Card | `docs/04-plan/tasks/WAVE-00.md` batch 0.13, TASK-293; PR66-SEC-01/02, D-SEC-PR66-01/02, PR #66 code review R1-m1/R1-n1/R1-n2; routed scope (D-ORCH-137): D-ARCH-154 C16 (rulings `wave-1-pr65-r1-rulings.md`), D-SEC-PR65-01/02 (PR65-SEC-01 rule, PR65-SEC-05) |
| Developer decisions | D-TASK293-01..06 (in the hand-off; not yet in DECISIONS.md) |
| Reviewer | code-reviewer, 2026-11-19 |

## 1. Verdict

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The lexer now matches scan.l on all four shapes (lone CR, identifier-character $, non-ASCII tags, ASCII white space).
         Re-checked on PGlite and on the whole corpus: 534/534 files give the same output from every exported helper; with CRLF
         the only differences are white space. C16 and P9-CK are correct on the built schema, and 113 = 106 + 7 matches the
         base. No BLOCKER and no MAJOR. Three MINORs: the call-site rule crashes on regex metacharacters in a quoted routine
         name; its transitivity depends on statement order; SEC-TC-76..78 are orphans for quality:trace.
```

Nothing is pushed and there is no lane-B evidence yet, so R1-m1 and R1-m2 cost almost nothing to fix before the push. I recommend fixing them now, but they do not block. R1-m3 is a qa-lead registry row.

## 2. Verification performed (HOST RULE: static review and single-process Node/PGlite probes on `git archive` extracts; no npm, no Jest, no Docker)

Set-up: `git archive 3183525` (full tree) and `git archive ca7e4b7 tools/db prisma/sql` were extracted into the reviewer scratchpad (`review/t293-cr`). The head copy uses a node_modules junction to the worktree. Nothing ran inside the PR worktree, and its `git status` is clean.

- **Corpus (card AC "every tracked .sql file tokenizes unchanged").** My own probe (`probes/corpus.ts`, tsx) compared base and head on all 534 files from `git ls-files '*.sql'`. It checked `tokenize`, `splitStatements`, `stripComments`, `sqlText(…, true/false)`, `containsEscapeString` and `referencedVariables`.
  - LF as committed: **534/534 byte-identical** on every function. The 5 files that throw are the same 5 negative fixtures at base and head.
  - 0 files contain a CR. 49 files contain non-ASCII text, all inside comments or strings.
  - CRLF variant (every LF rewritten as CRLF): `splitStatements` gives 532 exact and 2 white-space-only differences; `stripComments` and `sqlText` give 452 white-space-only differences; `containsEscapeString`, `referencedVariables` and `substituteVariables` are 534/534 exact. The cause is that a `--` comment no longer swallows the `\r` of a CRLF. The bootstrap runner sends `substituteVariables` output, which is unchanged byte for byte.
  - Repository lanes with the head linter: `lintMigrations(prisma/migrations)` gives 0 findings (base 0), and `lintBootstrap(prisma/bootstrap)` with the real reviewers file gives 0. No existing migration trips the new rule-10 call site or rule L.
- **scan.l parity, checked against the server (`probes/scan.mjs`, PGlite 17.5; these scan.l rules are the same in 18).** The head `splitStatements` agreed with the server's statement count on every shape:
  - CR-ended `--`;
  - `é$q$`, ` $q$`, `﻿$q$`, `　$q$` and an astral character before `$q$` (each is one identifier: 2 results);
  - `$é$`, `$ $` and astral tags (1 result);
  - a closing tag directly after body text (`$a$xb$a$`);
  - a quoted identifier followed by `$q$`;
  - `  END` inside `BEGIN ATOMIC` (PG 42601; the splitter throws);
  - VT/FF as white space.
  - The documented approximation (`1$a$`, `1e5$a$`) is a syntax error in PG (42601 / "trailing junk") and a SqlLexError in the splitter. Both refuse it.
- **Case table.** For all 8 `LEXER_CASES` rows, head `splitStatements(text)` equals `pieces`, and **base** `splitStatements(text)` equals `before`. So every row is a real differential, as the JSDoc says.
- **C16 / P9-CK.** I ran the exact SQL of `tenant-keys.ts` on the PGlite-built schema (bootstrap plus all migrations):
  - committed (a): two rows, both composite with a sibling, 0 findings;
  - committed (b): six unique indexes on the TENANT tables; only `ux_invitations__token_hash` lacks `org_id`, and it is the one live exception;
  - P9-CK: 152 `ck_` rows, all `contype = 'c'`, partitions and both lanes included;
  - planted (a), (b), the PR #65 mutants and the planted ck names each give exactly the declared findings.
  - Query review: `array_position(conkey, child org) = array_position(confkey, parent org)` is a correct position match. A NULL `composite` (child `org_id` in the key, parent's not) counts as non-composite, so it fails closed. `conparentid = 0` drops partition clones. `indkey::int2[]` with ordinality `<= indnkeyatts` excludes INCLUDE columns and expressions (attnum 0). Partial indexes stay in scope, which is right: a predicate on `org_id` scopes nothing.
- **min_tests 113.** `catalog-c1-c14` runs `prisma/tests/catalog/` (`suite-runners.json:13`). Lane B `20261119T1143Z_d4de55d` observed 106. `git diff d4de55d ca7e4b7` is empty for `prisma/tests/catalog`, the harness and `table-classes.ts`. This PR adds exactly 7 `it(` (5 C16, 2 P9-CK) and no `it.each`. 106 + 7 = 113; lane B must confirm it.
- **Rule 10 call site (`probes/rule10.ts`, 18 shapes, head vs base linter).** Results are in R1-m1, R1-m2, R1-n1 and R1-n2. Detected as intended:
  - BEGIN ATOMIC, PL/pgSQL `$$`, SQL string bodies and `CALL`;
  - DO + `PERFORM`, a CTE, a quoted name and a `$` in a name;
  - `RETURN QUERY UPDATE`, `ELSIF … THEN DELETE`, `EXCEPTION WHEN … THEN UPDATE` and a `<<label>> DECLARE` block;
  - carry-over across files, including a writer created in a `data-changing: yes` file and called from a later `no` file.
  - Fail-closed false positives, as stated in D-TASK293-03: `CREATE VIEW … AS SELECT writer()`, `CREATE TABLE … DEFAULT writer()` and the name inside a string literal.
- **Cost (`probes/redos.ts`).** 300 writers plus 300 calls: 256 ms (base 57 ms). For adversarial bodies, see R1-n3.
- **Gates I could run:**
  - `prettier --check` on the 12 changed files: clean. The developer's `format.log` (19:45) showed two warnings; they were fixed before the 19:57 commit.
  - ESLint (repo config, typed) on the 9 changed TS files in the extract: 0 problems.
- **Not re-run (host rule):** `tsc -b` (I rely on the developer's `typecheck.log`); Jest unit (the developer's `mutants.mjs` reports 12 mutants); every PostgreSQL 18 integration file (`c16-tenant-keys.int`, the 8 new `split-statements.int` cases, `organisations.int`). Those are lane B's to observe.
- **Commit:** one commit, Conventional, header 99 characters (limit 100).

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `tools/db/lint-migrations.ts:745,752` | `escapeRegExp` escapes only `$` and `.`. `qualify()` keeps every character of a quoted name, so a valid routine named `"f("`, `"g["` or `"h)"` that has a writing body makes `calledWriter` build an invalid RegExp. After that, **every later statement of every later file** throws `SyntaxError: Invalid regular expression … Unterminated group`. Probe: the head linter crashes, the base linter gives `[]`. The effect fails closed, since the CI lint exits non-zero, but it is a crash instead of a finding. That breaks the linter's stated "never a crash" property (rule L JSDoc), and the message does not point at the file. | Escape the full metacharacter set, for example `text.replace(/[.*+?^${}()\|[\]\\]/g, '\\$&')`, or compare tokens instead of building a regex. Add one test row with a quoted name holding `(`. |
| R1-m2 | MINOR | `tools/db/lint-migrations.ts:727-739,760-770` | Transitivity depends on statement order. A routine is marked writing only if the writer it calls is **already** in the set when its definition is read. PL/pgSQL does not resolve callees at CREATE time, so the following is legal and **missed**: `CREATE FUNCTION a() … plpgsql AS $$ BEGIN PERFORM b(); END $$; CREATE FUNCTION b() … DELETE …; SELECT a();`. The probe result is `[]`. The JSDoc ("or that calls such a routine") reads as order-independent. A forward reference does not occur in SQL string bodies or BEGIN ATOMIC bodies, which resolve at CREATE time with `check_function_bodies`. | Record each definition's callee names (`MigrationHistory.routineCalls: Map<string, Set<string>>`) and resolve transitively at the call site, so the result does not depend on order. Or state the limit next to the other "Not seen" items in both JSDoc blocks. |
| R1-m3 | MINOR | `prisma/tests/organisations/organisations.int.test.ts:196-262`; `prisma/tests/catalog/c16-tenant-keys.int.test.ts`; `docs/05-quality/tests/security-test-cases.md` | SEC-TC-76, -77 and -78 are now in test titles and in `required_cases`, but `security-test-cases.md` has no rows for them; the threat-model §10.4 F table is not one of the trace maps. `trace.mjs isKnown()` returns `false` for 76/77/78 and `true` for 74/75 (probe on the head tree). So the next `npm run quality:trace` over a lane-B run with these titles reports 3 orphans and exits 1. D-SEC-PR65-01 named only the threat-model table, which is why this was missed. | Add the three rows to `security-test-cases.md`, the qa-lead path, in this PR or a qa-lead commit before the next trace run: either under "Proposed cases" as 69..75 are, or as adopted rows, which also needs the "64 adopted cases" pin in `tools/quality/lib/test-ids.test.ts:101`. Then re-run `isKnown`. |
| R1-n1 | NIT | `tools/db/lint-migrations.ts:748-753`, `qualify` `:689` | Names: (i) a routine created unqualified is recorded as `public.<name>`, but under a migration-level `SET search_path = platform, …` it lives in `platform`, and the call `SELECT platform.purge_x()` is missed (probe `[]`); (ii) `unquote` strips spaces, so `"my purge"` never matches its own call (probe `[]`); (iii) `ALTER FUNCTION w() RENAME TO v` drops the tracking. All of these are rare in migrations. | For an unqualified definition, match any qualifier (`(?:IDENT ?\. ?)?name`). Keep spaces inside quoted names. Optionally carry a RENAME. Or list these as limits. |
| R1-n2 | NIT | `tools/db/lint-migrations.ts:735-736` | "CREATE TRIGGER (the trigger runs at a later DML statement, which rule 10 judges itself)" holds for UPDATE, DELETE, MERGE and INSERT … SELECT. It does not hold for a plain `INSERT … VALUES`, which is not a rule-10 form. A writing trigger fired by a seed INSERT is unseen: the probe's only finding is the unrelated rule 11. | Reword to "which rule 10 judges itself, except a plain INSERT … VALUES", or list it under "Not seen". |
| R1-n3 | NIT | `tools/db/lint-migrations.ts:716-719,741` | `BODY_DATA_CHANGING_FORM` nests lazy `[^;]*?` runs (`insert into … on conflict … do update`, `with … update`). That backtracking was already reachable in DO blocks: base needs 26 s for a 2000-repeat `then insert into t on conflict` body. With the `as` anchor it now also runs on **every routine definition**: `as insert into t on conflict` ×2000 (about 60 KB, no `;`) takes 20.9 s on head against 29 ms on base, and ×500 takes 555 ms. Input is author-controlled and CODEOWNERS-reviewed, so the only cost is lane-A time. | Split the expanded body on `;` and test each statement with anchored, non-nested patterns. Or route this to the next tools/db card along with the DO-block twin. |
| R1-n4 | NIT | `prisma/tests/catalog/tenant-keys.ts:70-72`; data-model §4.6 | (i) The T2 sibling test uses set containment (`<@`), not column-to-column mapping, so an unusual sibling such as `(org_id, parent_id, x) → (org_id, x_id, id)` would vouch for `(parent_id) → (id)`. No such key exists today. (ii) C16 (b) reads `indisunique`, so an `EXCLUDE` constraint without `org_id` on a TENANT table (`23P01` against `23503`) is out of scope. (iii) data-model §4.6 has C16 (a) only. Arm (b), its exception map and P9-CK are not in the catalogue table. | (i)/(ii): state them or tighten them when the first GUEST_CAPABLE or EXCLUDE table arrives. (iii): principal-architect, next fold. |

Developer decisions: all accepted.
- **D-TASK293-01 (isIdentifierChar dollar rule):** confirmed against scan.l `ident_cont` and on the server.
- **D-TASK293-02 (lone CR is rule L, lint continues):** sound. A CR inside a string literal is also reported; this fails closed and matches the `.gitattributes` `eol=lf` policy, which normalises CRLF but not a lone CR.
- **D-TASK293-03 (call-site rule, name-matched, fail closed):** accepted with R1-m1, R1-m2 and R1-n1. The card allowed "a call-site rule or the stated limit", and the stated limits are honest apart from R1-m2 and R1-n2.
- **D-TASK293-04 (harness-free query module):** good. It made the PGlite probe possible.
- **D-TASK293-05 (one exception `ux_invitations__token_hash`):** matches the PR65-SEC-01 remediation text ("global secret digests"). The liveness check (the exception must exist and lack `org_id`) stops the map from hiding drift.
- **D-TASK293-06 (SEC-TC-76 also in the catalog required cases; min_tests 113 = 106 + 7):** verified in §2.

## 4. Requirements trace

| Card item | Status |
|---|---|
| PR66-SEC-01 (a) lone CR ends `--` | Done (`sql-text.ts:72-77`); unit, lint (rule 8) and PG 18 int rows |
| (b) isIdentifierChar before `$` | Done (`:137`); é, U+00A0, U+FEFF, U+3000 rows; lint rule 8 for é/ä/U+00A0 |
| (c) non-ASCII tag alphabet | Done (`:44`); lint rule 15 (fake RESET ROLE) and rule 9 (fake ENABLE + FORCE) |
| Optional: refuse a lone CR | Done (rule L, non-stopping; migration.sql, down.sql, bootstrap) |
| Corpus check | Done (developer; re-run independently in §2) |
| R1-n1 ASCII white space in both places | Done (`:251`, `:276`); U+00A0/U+FEFF/U+3000 rows plus ASCII controls |
| R1-n2 isCheckReplacement JSDoc + optional ck_ catalog assertion | Done (`shadow-init.ts:198-204`; P9-CK in a new file, not in c01-c12) |
| PR66-SEC-02 call-site rule or stated limit | Done as a rule (R1-m1/m2/n1/n2), and the rule-11 note is extended |
| Routed: C16 (a) and (b), PR65-SEC-05 (a) tags, (b) min_tests ratchet | Done; (a) also adds the required cases and the threat-model rows |
| PR65-SEC-05 (d): PR43-SEC-07 remainder regression cases as `[SEC-TC-74]` cases of `organisations.int` (security record §4 (d)) | **Not delivered and not routed.** D-ORCH-137 routed PR65-SEC-05 to TASK-293 as "tags, required cases, min_tests ratchet" only. The orchestrator must route (d): either this PR or a named task, before TASK-049 merges, the same due date as (a) |

## 5. Good

- One case table (`lexer-cases.ts`) feeds both the unit split pins and the PostgreSQL 18 piece-by-piece oracle, and it carries a `before` column, so every row proves a real differential.
- The C16 queries live in a harness-free module, so the exact SQL can be probed outside Jest. Planted probes run in rolled-back superuser transactions, and both PR #65 shapes are re-planted as mutants on the real tables.
- The exception map is held live: an entry must exist and must lack `org_id`.
- The call-site rule fails closed: the writer set never shrinks, unqualified names and strings count, and the exemptions are explicit and tested in both directions, with list GRANTs and CAST … WITH FUNCTION as controls.
- The JSDoc cites the exact scan.l productions, and the "approximate without effect" paragraph names the one remaining divergence and why it is safe.

## 6. Security flags (for security-analyst)

- S1: R1-m1 is a linter crash on a valid name. It fails closed in CI, but the crash comes from data flowing from SQL text into a dynamically built RegExp, which is the class to watch in security-owned tools.
- S2: Rule-10 call-site coverage limits: R1-m2 (forward reference), R1-n1 (search_path, rename) and R1-n2 (writing trigger on INSERT … VALUES). Rule 10 is a backup guardrail (§8.6), so these weaken the backup prompt, not tenant isolation.
- S3: PR65-SEC-05 (d) is unowned (§4).
- S4: P9-CK has been probed on 17.5 only. PostgreSQL 18 catalogues NOT NULL as `contype 'n'`; today no constraint of that kind is named `ck_`, and lane B confirms it.

## 7. Merge conditions

1. A lane-B PASS on the pushed head: `catalog-c1-c14` = 113 tests, with 0 failures and 0 skips. If the observed count differs, `min_tests` must equal the observed count. `split-statements.int`'s 8 `[PR66-SEC-01]` cases, `c16-tenant-keys.int`'s 7 cases and `organisations.int`'s retagged cases must all pass on PostgreSQL 18.
2. A security record on this head (tools/db is CODEOWNERS security-owned).
3. qa-lead acknowledges the `required-suites.json` edit (owned path), and R1-m3 (registry rows) is resolved, here or in a qa-lead commit before the next `quality:trace`.
4. The orchestrator routes PR65-SEC-05 (d) and logs D-TASK293-01..06 in DECISIONS.md.
5. Recommended but not blocking: fix R1-m1 and R1-m2 (code or stated limit) before the first push. They are cheap now and would stale lane-B evidence later. If they are fixed, a delta re-check of `lint-migrations.ts` and its test is enough.
6. Merge before the next PR after TASK-037 that adds or changes a migration or bootstrap file (DUE, D-ORCH-134).

---

# Round 2 (delta): `3183525` → `85afc70`

| Field | Value |
|---|---|
| Head | `85afc70` (one commit on `3183525`; still not pushed) |
| Diff reviewed | `git diff 3183525 85afc70`: 5 files, +226 / -39 (`lint-migrations.ts` and its test, `tenant-keys.ts` JSDoc, `security-test-cases.md`, `test-ids.test.ts`) |
| Developer decisions | D-TASK293-07 replaces the regex matching of D-TASK293-03 (RoutineRegistry) |
| Reviewer | code-reviewer, 2026-11-19 |

## R2.1 Verdict

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R1-m1, R1-m2 and R1-m3 are closed, and so are R1-n1..n4. No regex is built from SQL text any more, writers are
         resolved order-independently at the call, and the body scan is linear. On a 400k-text fuzz it is equivalent to
         the old pattern (0 mismatches). SEC-TC-76..78 are known to quality:trace. No BLOCKER, MAJOR or MINOR. One NIT:
         a non-ASCII routine name is still skipped, a residual of the lint-wide ASCII IDENT class that r1 missed.
```

## R2.2 Verification performed (same host rule: `git archive 85afc70` extract with a node_modules junction; tsx/Node single process; no npm, Jest or Docker; nothing ran in the worktree)

- **Scope of the delta.** `sql-text.ts`, the lexer cases, C16 SQL, the int tests and the manifest are unchanged since `3183525` (`git diff --quiet` on `sql-text.ts`). So the round-1 corpus, scan.l and C16 results still hold.
- **Call-site rule (`probes/r2.ts`, 18 shapes on the head linter):**
  - `public."f("` is a rule-10 finding at its call, and `"g["` with no call lints the next file. No crash. (R1-m1)
  - A forward reference is found, and so is a reversed 3-level chain (`a1 → a2 → a3`, the writer defined last), each at its call. Mutual recursion with no writer stays clean. (R1-m2)
  - Calls now matched (R1-n1):
    - an unqualified creation under `SET search_path = platform`, called as `platform.purge_x()`;
    - `"my purge"` with a space;
    - a qualified caller of an unqualified writer.
  - Controls: `other.qq()` against `public.qq` and a caller naming `other.wz` stay clean.
  - Still fail closed: `CREATE OR REPLACE` with a reader body keeps the writer status, and a DO `PERFORM` of a writer counts.
  - New finding R2-n1: a non-ASCII routine name is not seen.
- **Equivalence of the new body scan.** I fuzzed the replaced nested regex (copied from `3183525`) against the exported `bodyDataChanging`. I used both anchor sets (DO and routine), 400,000 random normalised texts over a 41-token vocabulary (keywords, near-miss words like `selection` and `forupdate`, `;`, `'`, quoted names) with joined and unjoined forms. Result: **0 mismatches**, with 4,489 positives. The "earliest start, then plain search" argument is sound: for a fixed segment, the rest after the earliest qualifying start contains the rest after every later start, so existence is preserved for INSERT … SELECT, ON CONFLICT … DO UPDATE and WITH … writes.
- **Cost.**
  - Bodies that took 20.9 s / 26 s in round 1 now take: 60 KB routine body (insert / on conflict) 27 ms, 60 KB DO block 31 ms, 60 KB `with` body 24 ms.
  - 600 chained routines plus 300 calls take 100 ms, with all 300 calls found through the chain.
- **Repository lanes** with the head linter: `prisma/migrations` 0 findings; `prisma/bootstrap` (real reviewers file) 0.
- **R1-m3.** `parseSecurityCases` on the head registry gives 67 adopted (01..64 and 76..78) and 7 proposed, with no duplicate. `trace.mjs isKnown()` is now `true` for SEC-TC-76, -77 and -78. The rows match D-SEC-PR65-01 (a) and the threat-model §10.4 F text.
- **Gates I could run:** `prettier --check` on the 5 files is clean; typed ESLint on the 3 changed TS files gives 0 problems; the commit header is 94 characters.
- **Not re-run:**
  - Jest unit and `tsc -b`: I rely on the developer's 17/17 mutants.
  - Lane B on `85afc70`, which is queued. The coordinator reports that lane B on `3183525` passed every TASK-293 check on PostgreSQL 18: catalog 113, the 8 lexer rows, C16 7, SEC-TC-76..78. Its only failure was the unrelated `consumer.int` AT-US-009-04 race. That run's evidence is not committed on main, so I could not read it myself.

## R2.3 Round-1 closure

| R1 item | Status | Evidence |
|---|---|---|
| R1-m1 regex from SQL text | **Closed** | `CALL_IDENT` / `NAMED_CALL` / `DEFINED_NAME` are fixed patterns, names compare as parsed identifier values (`identifierValue`, `""` unescaped). 7 metacharacter and quote rows in the test, plus my probe |
| R1-m2 order-dependent transitivity | **Closed** | `RoutineRegistry` keeps every definition with its callees; `writingRoutines()` runs a BFS over callers on demand, with the cache cleared by every `define`. The test covers forward, "judged between the two definitions" and cross-file cases plus a control; my probe adds a reversed 3-level chain and mutual recursion |
| R1-m3 trace orphans | **Closed** | New "Adopted cases SEC-TC-76..78" section; `test-ids.test.ts` pin is 67 |
| R1-n1 names | **Closed** (RENAME and three-part names documented) | Unqualified definition is `schema: null` and matches any schema; spaces kept |
| R1-n2 trigger wording | **Closed** | JSDoc now says "except a plain `INSERT … VALUES` … not seen" |
| R1-n3 backtracking | **Closed** | Segment-wise linear scan, also for DO blocks (it fixes the base twin as well); test bound < 5 s |
| R1-n4 C16 limits | **Closed** (stated) | `tenant-keys.ts` JSDoc; data-model §4.6 (b)/P9-CK stays with the architect |

D-TASK293-07 is accepted. A fixed identifier grammar plus a call-time fixpoint is the right shape, and the registry is cohesive and exported for tests only through the history type.

## R2.4 Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R2-n1 | NIT | `tools/db/lint-migrations.ts` `CALL_IDENT` (plain branch `[a-z_][a-z0-9_$]*`), `NAMED_CALL` lookbehind, `DEFINED_NAME` | **Non-ASCII routine names are not seen.** PostgreSQL accepts `public.purgé()` and `public.é()` as plain identifiers (scan.l `ident_start`/`ident_cont` include `\200-\377`, which is this task's own point (b)). `DEFINED_NAME` then fails to match, so the definition is silently not registered, and the call `SELECT public.purgé()` gives `[]` (probe). It fails open, but only for the backup prompt. The same ASCII-only `IDENT` exists in `ROUTINE_NAME` and the other name-based rules on base, so this is a residual class that round 1 missed, not a regression. | In-PR is optional: add `\u0080-￿` to both ranges of the plain branch (as `CODE_PIECE` does) and to the lookbehind, and when `ROUTINE_DEFINITION` matches but `DEFINED_NAME` does not, record the definition as a writer under its masked text or report it (fail closed). Otherwise route the lint-wide IDENT class to the next tools/db card. |
| R2-n2 | NIT | `lint-migrations.ts` JSDoc "Not seen … a call written with a three-part name" | Conservative: `SELECT mydb.public.t3()` **is** found today (the `.` is not in the lookbehind, so `public.t3(` matches). It does no harm. | Drop it from the "not seen" list, or leave it as is. |
| R2-n3 | NIT | `docs/05-quality/TEST-STRATEGY.md:192,599` | The adopted set is now 67, but the G3 line still reads "SEC-TC-01..64, 64/64". The registry amendment explains that the "64" counts describe the 2026-11-12 set, but the G3 checklist is what the gatekeeper reads. | qa-lead: change both lines (192, and 599 = §15 item 6) to "01..64 and 76..78 (67)" in the qa-lead acknowledgement commit (merge condition 3). |

## R2.5 Merge conditions (replace §7)

1. A lane-B PASS on `85afc70` (queued). It must observe `catalog-c1-c14` = 113 with 0 failures and 0 skips; the 8 `[PR66-SEC-01]` rows; the 7 C16 / P9-CK cases; SEC-TC-76..78 passing; and the unit `lint-migrations` / `test-ids` suites. An unrelated `consumer.int` AT-US-009-04 failure needs the orchestrator's usual flake ruling (TASK-W0-FLAKE line), not a code change here.
2. A security record on `85afc70` (tools/db is security-owned).
3. qa-lead acknowledges the `required-suites.json` and `security-test-cases.md` edits (owned paths, adopted 64 → 67), with R2-n3.
4. The orchestrator routes PR65-SEC-05 (d), which is still unowned (§4), and logs D-TASK293-01..07 in DECISIONS.md.
5. DUE (D-ORCH-134): merge before the next PR after TASK-037 that adds or changes a migration or bootstrap file.
