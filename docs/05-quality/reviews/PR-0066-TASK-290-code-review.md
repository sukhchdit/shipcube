# Code review: PR #66, TASK-290 (TASK-024-F) grammar-exact BEGIN ATOMIC splitting and balanced shadow-init CHECK keep (round 1)

| Field | Value |
|---|---|
| PR | #66 `fix(db): grammar-exact BEGIN ATOMIC splitting and balanced shadow-init CHECK keep (TASK-290)` |
| Branch / head | `feat/TASK-290-task-024-f-sql-splitter` @ `9a14659` (code commit `ba921da` + evidence-only commit `9a14659`) |
| Merge-base with current main | `466d2c4`; main is at `55fdc1c` |
| Scope / records | TASK-290 card (WAVE-00 batch 0.12) · PR43-SEC-11, PR52-SEC-01, PR #43 code review R2-m1 / R2-n1 / R2-n3 · D-SEC-PR43-05, D-SEC-PR52-01 (2), D-ARCH-135/137, D-TASK024-13 · D-TASK290-01..06 (proposed in the PR body; not yet in DECISIONS.md) · D-ORCH-131 host rule |
| Reviewer | code-reviewer · 2026-11-18 · round 1 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The splitter now follows gram.y: a block opens on BEGIN ATOMIC at paren depth 0 in a routine head (top level
         or a nested body statement) and closes only on END as the first word of a body statement; CASE is not
         counted. That closes PR43-SEC-11 without the false rule-L refusals the card's CASE-depth sketch would cause,
         and leaves no counter a top-level END could resync. The deviation (D-TASK290-01) is accepted.
         isCheckReplacement is a correct balanced scan with a quoted-identifier skip and a same-name ck_ head.
         No BLOCKER or MAJOR. Two MINOR: (m1) a pre-existing lexer gap in tokenize, routed; (m2) process: lane A
         stopped at a new repo-wide picomatch advisory, so lint/typecheck/unit/build never ran on the head. Three NITs.
```

## 1. Verification I performed myself

Host rule (D-ORCH-131, repeated in the dispatch): static review only. I ran no `npm test`, typecheck, lint or build and no Docker. My only executions were sub-second Node probes in the session scratchpad (`node --experimental-transform-types`). They import the head and main copies of `tools/db/sql-text.ts`, `tools/db/atomic-body-cases.ts` and `tools/db/shadow-init.ts`, taken with `git show` (no worktree was touched). Mutation results, the PG 18 integration run and the unit totals come from the PR body and the lane-B evidence. I did not re-run them.

| # | Check | Result |
|---|---|---|
| V1 | `git log` / `git diff --stat origin/main...9a14659` | 36 files. Code: `sql-text.ts` (114 lines changed), `shadow-init.ts` (+57), new `atomic-body-cases.ts`, 9 fixture migrations (18 files), the PG 18 int test, unit tests, a describe title, a comment-only change to `lint-migrations.ts`, and data-model §8.3. Evidence commit `9a14659` touches only `docs/05-quality/tests/runs/20261118T1029Z_ba921da/`. No lockfile, migration or bootstrap file. |
| V2 | Read `splitStatements` in full (sql-text.ts:211-313) against gram.y `opt_routine_body` / `routine_body_stmt_list` / `toplevel_stmt: stmt \| TransactionStmtLegacy` | Open, close and fail-closed rules hold as the JSDoc says. `parens` is 0 at every close, because a close follows only `ATOMIC` (gate 0) or a body `;` (checked 0). `openerPending` consumes exactly the `atomic` piece that `nextWord` found, so `atomic` never counts as a first body word. `closed` lets only comments and whitespace through before `;` or EOF. A nested block left open, or closed at EOF, throws. |
| V3 | Edge-case probe (`probe.mts`, 22 shapes, head vs main) | Dollar body holding `;END;`, a string holding `END;`, a quoted `"end"` as first piece, a paren-led body statement, empty body statements `; ;`, mixed case `Begin Atomic … eNd`, comments between END and `;`, a nested routine with `CASE … END AS end` and a bare `case`, a nested head inside parentheses, `END$$` (an identifier: stays open → L), two routines in one file, `RETURNS TABLE (…)` before the opener, a procedure with a `SET` option: all split as PostgreSQL's grammar reads them, or fail closed where PostgreSQL would raise a syntax error. The head fixes three main behaviours: main over-splits `AS end` (4 pieces), swallows a token after END into the routine, and throws L on a second routine that uses `AS case`. |
| V4 | Corpus re-run (`corpus.mts` over `git archive 9a14659 '**/*.sql'`, head vs main splitter) | **525 identical** (the PR's 514 + 11 of the 18 new fixtures), 879 statements, 3 rule-L files in both. **7 differ**, exactly the 7 the PR lists (4 label shapes 1→3, `end_labels_control` 4→2, `end_not_last` and `paren_semicolon` → L). This confirms the PR's corpus claim. |
| V5 | `isCheckReplacement` probe (20 shapes through `statementCode`) | KEEP: bare, trailing comment, `"x)"`, `'x)'`, `E'\')'`, `$$)$$`, `"a"""` and `"a"")"` (doubled quotes pair up correctly), unquoted `CK_T__A` vs `ck_t__a` (the same name to PostgreSQL), `ONLY "Public"."T"` with tight commas, a nested sub-select. Refuse: `NOT VALID`, `NO INHERIT`, a commented second action, an unbalanced `((`, an extra `))`, `ck_t__a` → `ck_t__ab`, `pk_t`, quoted `"ck_t__a"`. An unterminated quote throws in `statementCode` (fail closed). |
| V6 | Lane-B evidence `20261118T1029Z_ba921da` (on `9a14659`) | PASS. unit 6766 (2 skipped), integration 345, api 173, catalog 102, rls 126, 0 failures. `integration.junit.xml` holds the 14 `[PR43-SEC-11] splitStatements agrees with PostgreSQL 18` cases. `unit.junit.xml` holds 45 `PR43-SEC-11` / `PR52-SEC-01` test cases. Merged coverage 99.06 % / 97.08 %. |
| V7 | Lane A run 44291101362 (`gh run view`, on `9a14659`) | **failure.** `ci-gate` fails only on the missing security record (expected). `fast-lane` fails at step 14, "Vulnerability audit": `audit/high: GHSA-fc5q-39xc-vjpf picomatch (high, dev closure, fix available)`. This PR does not cause it: the lockfile is unchanged, and runs 44105548507 / 44109257822 on 2026-11-17 had `check-audit: PASS`. Steps 15-29 were **skipped**: check-evidence, commitlint, lint, format, typecheck, unit, base-ref negative fixtures, build. See R1-m2. |
| V8 | P1 overlap. `origin/main...` file sets of #61 `14cdeed`, #62 `1c4dc00`, #63 `fcdb7ac`, #64 `90ef83f`, #65 `d3c2c16` vs this PR; `git merge-tree --write-tree` | vs main: only `docs/03-architecture/data-model.md`, merge-tree clean. #61-#64: no common file. **#65 shares `tools/db/lint-migrations.ts` and `.test.ts`**, which the PR body does not mention. The hunks are disjoint (#65 @542 REFUSED_OBJECTS and @801 a test title; this PR @73 and @1246, comments only, plus a new test after line 881). `git merge-tree 9a14659 pr/65` is clean. #65's new migration (`20261117000000_organisations_identity`, 2 files, 88 statements) splits identically under head and main. |
| V9 | AC walk against the TASK-290 card | See §3. |

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR (pre-existing, not introduced here; route) | `tools/db/sql-text.ts:56` (`--` ends at `indexOf('\n')`), `:119` (`$` opens a dollar quote unless the previous char is ASCII `IDENT_CHAR`) | **`tokenize` still has two of the scan.l differences that PR #54 fixed in the raw-SQL twins (R1-M1 / PR54-SEC-01 a, b), both fail-open for the migration linter.** PostgreSQL ends a `--` comment at `\r` too (`non_newline [^\n\r]`), and every byte >= 0x80 is an identifier character, so ` $q$` is an identifier there. Probe (head and main identical): `SELECT 1; -- n\rGRANT TRUNCATE ON public.t TO platform_app;\nSELECT 2;` splits to `["SELECT 1","SELECT 2"]`, so the GRANT disappears from every rule. `SELECT 1 AS  $q$; GRANT …; SELECT 1 AS  $q$;` becomes one SELECT statement. `.gitattributes` `eol=lf` does not normalise a lone CR. **Not verified:** whether Prisma's one-statement-at-a-time submission (prisma/README "Rule 5") executes the GRANT in these shapes (Docker barred). The bootstrap runner drops the comment text, so on that lane the GRANT would be lost, not run. The PR's "grammar-exact" claim covers the block layer only. This is the lexer underneath it, unchanged by the PR. | Route as a follow-up on the security-owned `tools/db` (database-engineer; due before the next migration-heavy batch or with the next `sql-text.ts` change). In `tokenize`, end `--` at `\n` or `\r`, and use `isIdentifierChar(code.at(-1))` in the dollar rule (the helper already exists for the E-prefix, PR #43 R1-n2). Add corpus rows for CR before GRANT/SET/END and NBSP/U+FEFF/U+3000 before `$q$`, plus a PG 18 case in `split-statements.int.test.ts`. Fold R1-n1 into the same change. |
| R1-m2 | MINOR (process; merge condition, not a code defect) | lane A run 44291101362, `fast-lane` step 14 | A new advisory, **GHSA-fc5q-39xc-vjpf (picomatch, high, dev closure)**, now fails `check-audit` on every PR. Steps 15-29 were therefore skipped on this head: no lane-A lint, format, typecheck, unit, build, check-evidence, commitlint or base-ref negative-fixture / no-weakening run exists for `9a14659`. That last check matters here, because the card says a weakened splitter is a base-ref no-weakening finding. The developer's local gates and lane B (tests only) are all the gate evidence there is. | Orchestrator routes the advisory (bump `picomatch` within its range if the fix is in-range, or a dated `audit/watched` entry with a dev-only justification by security-analyst, as for `glob` / `minimatch`). Then re-run lane A on this PR's final head; it must be green through step 29. |
| R1-n1 | NIT | `tools/db/sql-text.ts:226, 249` | `/^\s$/` treats a lone U+00A0 / U+FEFF / U+3000 piece as white space, so `SELECT 1;   END` closes the block (probe). PostgreSQL reads that character as an identifier and refuses the statement (syntax error), so nothing is hidden: under one-at-a-time execution the earlier statements are linted correctly and the divergent one fails. It is the same JS-`\s`-vs-scan.l pattern as R1-m1. | Use `/^[ \t\n\r\f\v]$/` in both places, with R1-m1. |
| R1-n2 | NIT | `tools/db/shadow-init.ts:162` (`CHECK_NAME`), D-TASK290-03 | "The dropped constraint is the CHECK being replaced" rests on the P9 `ck_` naming convention. No lint rule or catalog assertion enforces that a `ck_%` constraint is `contype = 'c'`. A bootstrap file (security-owned, CODEOWNERS) could name a PK or FK `ck_…`. That is a stated, text-level residual. | Say so in the `isCheckReplacement` JSDoc. Optionally add a C-series catalog assertion: every `pg_constraint` named `ck\_%` has `contype = 'c'`. Route to the next catalog-test task; no change needed in this PR. |
| R1-n3 | NIT | PR body "P1" line | "The only file both sides changed is data-model.md" is true for main. It leaves out open PR #65, which edits `tools/db/lint-migrations.ts` and `.test.ts`. The hunks are disjoint and the merge is clean (V8). | Mention #65 in the body or the merge note. When #65 merges main after this PR (COORD-03 order), its reviewer should confirm that `lint-migrations.test.ts` keeps both new tests. |

No BLOCKER or MAJOR.

## 3. Acceptance criteria and the D-TASK290-01 ruling

**D-TASK290-01 (grammar-exact close instead of a per-statement CASE depth): ACCEPTED. The AC's intent is met; only its mechanism line is replaced.**

The card's PR43-SEC-11 clause has a mechanism ("CASE depth is tracked per body statement and fails closed to rule L at the semicolon that leaves it open") and an intent:
- (i) `case` and `begin atomic` count only where PostgreSQL treats them as openers;
- (ii) a nested BEGIN ATOMIC counts only after a routine head;
- (iii) a later top-level END never resynchronises a swallowed block;
- (iv) the four label fixtures, each with a hostile statement, stay split and the hostile statement is reported;
- (v) the corpus splits identically.

The grammar-exact rule meets every intent clause, and more precisely than the sketch:
- **(i)** CASE is no opener in PostgreSQL's grammar for body boundaries at all. Only `END_P` at the start of a `routine_body_stmt` position ends the list, and `routine_body_stmt: stmt | ReturnStmt` excludes `TransactionStmtLegacy` (the only statements that begin with BEGIN/END). So "END as the first word of a body statement" is exactly the grammar's close. The PG 18.6 probes in the PR body confirm it, including the bare label `SELECT 1 END; GRANT …` that keeps the GRANT in the body (0A000), and the int test proves it per case: whole text vs pieces under the extended protocol, with the two 42601 controls.
- **(iii)** Holds by construction: no depth counter exists that a stray top-level END could decrement. Every case-table row ends in a top-level `END` that stays its own statement, and mutants e1/e2 pin the close.
- **The sketch's weaknesses:** the CASE-depth sketch would refuse valid label SQL (`AS case`) as rule L, would still over-split `AS end`, and would keep a counter whose correctness depends on a label heuristic. Both reviewers flagged that class twice in PR #43.
- **(ii)** Pinned by the nested-routine rows and the parenthesised-alias row.
- **(iv)** Pinned by the `atomic-body-labels` fixture test (GRANT → rule 8, DROP → rule 2, SET lock_timeout → rule 11, plus 11c for the trailing END).
- **(v)** Re-verified (V4).

The rule-L additions (D-TASK290-02) refuse only text PostgreSQL also refuses. Data-model §8.3 rule L records the change.

**Conditions of the ruling:**
- the orchestrator logs D-TASK290-01..06 in DECISIONS.md;
- the card's "validated on a scratch copy by security-analyst" clause stays with the security round.

| AC (card) | Status | Evidence |
|---|---|---|
| PR43-SEC-11 (i)-(v) | Met (mechanism replaced, accepted above) | `sql-text.test.ts` `[PR43-SEC-11]` table (13 shapes × the 4-statement hostile tail), nested and fail-closed tables; `lint-migrations.test.ts` atomic-body-labels; `split-statements.int.test.ts` 14/14 in lane B; corpus V4 |
| R2-n1: paren-gate fixture, mutant s2 dies | Met | `20261117000400_parenthesised_labels`, `20261117000500_begin_atomic_param`, `PAREN_CASES`. s2 is killed by the `begin atomic` parameter row: without the gate the parameter opens a block and the tail `END` closes it, swallowing the GRANT. I confirmed this by reading the code; the mutant was not re-run |
| R2-n3: describe title names the 2026-11-14 amendment (D-ARCH-123) | Met | `render-rls-dr-a14.test.ts:3-4, 68` |
| PR52-SEC-01: prefix + balanced scan with quoted-identifier skip, closing paren last, the dropped constraint is the CHECK; 7 controls, 6 bypass shapes, ≥ 5 refusal fixtures, the real 91 statement renders | Met (the "is the CHECK" part by naming, R1-n2) | `shadow-init.test.ts` 4 keep rows, 15 refusal rows, direct `isCheckReplacement` cases; the unchanged real-lane 91 test is green in lane B; V5 |
| Data-model §8.3 rules 18/19/20/L reconciled, said so in the body | Met | diff of §8.3. Rule 18: keyed on `COVERING_INDEX_TOLERANCE`. Rule 19: triggered by `DROP INDEX`. Rule 20: unchanged. Rule L: rewritten. All match `lint-migrations.ts` as read |
| AT-US-077-01..04 (this layer) | Met at this layer | no generated RLS file changed; rls-cross-tenant 126/126 in lane B |

## 4. Design and test quality

- **Good:**
  - One shared case table (`atomic-body-cases.ts`) feeds both the unit test and the PostgreSQL agreement test, so the two cannot drift.
  - The integration test's oracle is strong and deterministic. The extended protocol's "one command per prepared statement" refusal (with its own 42601 controls) proves that each piece is exactly one command, and the tail's effects (privilege, dropped table, `lock_timeout`) prove top-level execution.
  - Fresh database per case from a template: no shared state.
  - Fail-closed messages are distinct per shape, and each is pinned.
  - `isCheckReplacement` is small, exported and directly unit-tested.
  - The KEEP regex keeps the strict fail-closed list.
  - The JSDoc states the grammar rule and its limit honestly.
- The case-table coverage test (`toContain` on joined routine text) is a light anti-drift pin, which is enough for a fixture list.
- The per-case 120 s timeout is a hang guard only (D-TASK290-06, consistent with D-SEC-PR53-02).
- Readability: the `opens` / `closed` / `openerPending` state is commented at each declaration. A new engineer can change it safely with the fail-closed table and the mutants as the safety net.

## 5. Security flags (for security-analyst)

- R1-m1: `tokenize` CR comment end and the dollar-quote rule after a non-ASCII character are fail-open for the migration linter. Same class as PR54-SEC-01 (a)(b), unchanged by this PR. Please rate it and decide whether to verify the Prisma submission path on PG 18.
- R1-n2: the CHECK identity is proved by the `ck_` name only. Optional catalog assertion.
- The card's "structural fix validated on a scratch copy by security-analyst" clause is yours. The case table plus the int test are the natural harness.
- `tools/db` is security-owned: lane A `ci-gate` needs the PR-0066 security record on the final head.

## 6. Merge conditions

1. The security record `docs/05-quality/security/PR-0066-*.md` exists with a passing verdict that binds the final head.
2. R1-m2: the picomatch advisory is routed and cleared repo-wide, and lane A is green on the final head through all fast-lane steps, including lint, typecheck, unit, build, check-evidence and the base-ref negative fixtures.
3. D-TASK290-01..06 are logged in DECISIONS.md, and the D-TASK290-01 ruling above is recorded.
4. R1-m1 (with R1-n1) is routed to a tracked follow-up task on `tools/db`. R1-n2 is routed to the next catalog-test task. R1-n3 is a note for the #65 merge-main cycle.
5. Merge order per COORD-03: this PR before #65; #65 then merges main and is re-checked for the `lint-migrations.test.ts` union.
