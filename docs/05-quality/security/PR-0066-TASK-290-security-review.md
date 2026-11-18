# PR-0066: TASK-290 grammar-exact BEGIN ATOMIC splitting and balanced shadow-init CHECK keep, security review

| Field | Value |
|---|---|
| PR | #66, https://github.com/sukhchdit/shipcube/pull/66, branch `feat/TASK-290-task-024-f-sql-splitter`. Two commits on merge base `466d2c4`: the code commit `ba921da` and the lane-B evidence commit `9a14659`, which changes only `docs/05-quality/tests/runs/20261118T1029Z_ba921da/`. When this round was written, `main` was at `982cb7f`. Since the merge base, `main` has changed `packages/authz/**`, `tests/generated/rbac/**`, `tools/test-support/**`, `tools/lint/**`, `tools/db/prisma-client-*`, `eslint.config.mjs` and `jest.config.ts` (plus docs). None of these is a path this PR changes, and `git merge-tree origin/main 9a14659` is clean |
| Head | 9a14659991ab13bd55b1ec97efe4f58f98c85c8a |
| Lane A evidence | Run 44291101362 on `9a14659` (`pull_request`; merge ref `c6bf591`, which merges `9a14659` into `55fdc1c`). **fast-lane:** workflow policy, install flags, migration immutability, lockfile, cooldown, install, licences and signatures are green. "Vulnerability audit" is red on GHSA-fc5q-39xc-vjpf (picomatch, high, dev closure). That failure is repo-wide: this PR changes no lockfile. As a result, check-evidence, deps:rebuild, commitlint, lint, format, actionlint, type-check, unit, the base-ref negative fixtures and build were **skipped**. **ci-gate:** Gitleaks (PR range), Semgrep and oasdiff are `success`. The record check is red: 27 owned paths and no record. **security-integration:** skipped. It needs a green fast-lane, and `security_integration_due` was false because `record_ok` was false |
| Lane B evidence | `20261118T1029Z_ba921da`, profile `pr`, verdict PASS. Unit 6,766 (2 skipped); integration 345, including the 14 `split-statements.int.test.ts` cases on PostgreSQL 18; api 173; catalog-c1-c14 102; rls-cross-tenant 126. Merged coverage 99.06 % lines / 97.08 % branches |
| Owned paths changed | 27, from the checker output of run 44291101362: `prisma/tests/migrations/split-statements.int.test.ts`; `tools/db/atomic-body-cases.ts`; the 18 files of `tools/db/fixtures/lint/migrations/atomic-body-labels/` (9 migrations); `tools/db/{sql-text,shadow-init,lint-migrations}.ts`; `tools/db/{sql-text,shadow-init,lint-migrations,render-rls-dr-a14}.test.ts` |
| Unowned paths changed | 9, all reviewed: `docs/03-architecture/data-model.md` (§8.3 rules 18, 19 and L) and the 8 lane-B evidence files |
| Binding items checked | The TASK-290 card (WAVE-00 batch 0.12), including its clause "structural fix validated on a scratch copy by security-analyst"; PR43-SEC-11 (D-SEC-PR43-05, D-ORCH-074); PR52-SEC-01 (D-SEC-PR52-01 (2), D-ARCH-135/137); PR #43 code review R2-m1, R2-n1 and R2-n3; data-model §8.3 rules 5, 9, 10, 11, 15 and L, and the `prisma/README.md` "Rule 5" record; D-TASK290-01 to -06 (in the PR body, not yet logged); the code review r1 on main (`fdb33ee`, APPROVED_WITH_NITS) |
| Reviewer / date | security-analyst, 2026-11-18, round 1. **Static review plus light Node probes**, under the host rule of D-ORCH-131: no npm, Jest, type-check, build or Docker. Nothing ran in a PR worktree, and nothing was written there. Git object reads, `gh` and `curl` ran from the main checkout. Single-process Node probes ran in the session scratchpad on `git archive` extracts of `tools/db` and `prisma` (head `ba921da` and merge base `466d2c4`), type-stripped, with no dependency installed. PostgreSQL facts come from `REL_18_STABLE` `src/backend/parser/scan.l` and `gram.y`: grammar-confirmed, not executed. Prisma's statement submission comes from the prisma-engines source: read, not executed. Line numbers come from single-file reads at `ba921da` |

## 1. Summary

This round asked one question. Can a mis-split file make the migration linter or the shadow rendering miss, drop or reorder security-relevant DDL, and does the splitter fail closed? Security-relevant DDL here means ENABLE/FORCE ROW LEVEL SECURITY, policies, GRANT/REVOKE, `SET ROLE` blocks and CHECK constraints.

- **The block layer is grammar-exact and fails closed.** `splitStatements` opens a block only on `BEGIN ATOMIC` at parenthesis depth 0 in a routine head. It closes a block only on `END` as the first piece of a body statement. Given the same tokens, each splitter boundary is a PostgreSQL boundary, and the reverse holds too (§5.1).
  - Where the head is stricter than `main`, PostgreSQL raises a syntax error: text after the body's `END`, and a body `;` inside parentheses.
  - The PR's 13-row case table splits as specified. I replayed 10 mutants of the new logic in Node against the PR's own rows, and all 10 are killed.
  - 22 shapes of my own split as PostgreSQL reads them, or fail closed where PostgreSQL refuses them.
  - Over the 532 tracked `.sql` files, 525 split exactly as on `main`; the 7 others are the new fixtures, which differ by design.
  - **PR43-SEC-11 is closed.**
- **The shadow KEEP form is closed.** `isCheckReplacement` refuses all six PR52-SEC-01 bypass shapes and a primary-key "replacement". It keeps the real `91` statement. The rendering of the real bootstrap lane is byte-identical to `main`'s. **PR52-SEC-01 is closed.**
- **The lexer under the splitter is not grammar-exact (PR66-SEC-01, LOW, pre-existing).** `tokenize`, which this PR does not change, reads three things differently from PostgreSQL's `scan.l`, and every difference is fail-open:
  - (a) a `--` comment that a lone CR ends;
  - (b) a dollar quote that opens right after a non-ASCII identifier character;
  - (c) a non-ASCII dollar tag.

  Through the real linter at the head, (a) and (b) hide a `GRANT … TO platform_app` that PostgreSQL runs (0 findings; the control gives rule 8). (c) makes the linter count a `RESET ROLE`, or an ENABLE + FORCE, that PostgreSQL never runs (rules 15 and 9 go silent). `migrate deploy` and the bootstrap runner both hand PostgreSQL the raw text, comments included. The shadow rendering drops the comment, so on the bootstrap lane the shadow and the real database diverge.
  - The code review raised (a) and (b) as R1-m1. I add (c), the deploy-path reading, and a correction: the bootstrap runner keeps the comment text (§4).
  - No tracked file and no file of PR #65 holds any of the three shapes. A three-line fix is validated over the whole corpus.
- **A stated limit overreaches (PR66-SEC-02, INFO).** The new limit sentence says text a body swallows "never runs as a migration step". That holds for utility statements (0A000). It does not hold for DML in a body that the same file then calls, and rule 10 does not see that case. This predates the PR.
- **Nothing else.** No new dependency, lockfile change, workflow change or secret. The new integration test runs constant SQL on a Testcontainers server. The new regular expressions are anchored and have no nested quantifier. The one removed regex (the PR52-SEC-01 lookahead loop) was the only one with a lookahead loop. Error messages are fixed strings, and refusal previews still come from `statementCode` (literals blanked).

Findings: 0 Critical, 0 High, 0 Medium, 1 LOW, 1 INFO.

**Verdict: PASS_WITH_FOLLOW-UPS.**

## 2. Method

1. Read the full diff `466d2c4...ba921da` (36 paths) and the evidence commit. Read at `ba921da` in full: `sql-text.ts` (the lexer, `splitStatements`, `substituteVariables`, `sqlText`), `shadow-init.ts`, `atomic-body-cases.ts`, `split-statements.int.test.ts`, the new unit tests, the 9 fixture migrations, and the `lint-migrations.ts` header and `lexedStatements`. Also read `bootstrap.ts` (`inFileTransaction`, how a file is sent) and `up-down-up.ts` (consumers of `splitStatements`), and data-model §8.3 at `ba921da`.
2. **PostgreSQL 18 facts.** I fetched `scan.l` and `gram.y` from `REL_18_STABLE` with `curl`, with these results:
   - `scan.l:208-213`: `space [ \t\n\r\f\v]`, `newline [\n\r]`, `non_newline [^\n\r]` and `comment ("--"{non_newline}*)`;
   - `scan.l:285-287`: `dolq_start [A-Za-z\200-\377_]`, `dolq_cont [A-Za-z\200-\377_0-9]`;
   - `scan.l:332-335`: `ident_cont [A-Za-z\200-\377_0-9\$]`;
   - `gram.y:8838-8877`: `opt_routine_body`, `routine_body_stmt_list` and `routine_body_stmt: stmt | ReturnStmt`;
   - `gram.y:986-989`: `toplevel_stmt: stmt | TransactionStmtLegacy`;
   - `opt_routine_body` is used only by the four `CreateFunctionStmt` productions (`gram.y:8362-8405`).
3. **How a migration reaches PostgreSQL.** Prisma 7.4.0 added statement splitting to the native schema engine (prisma-engines PR #5767, `flavour/postgres/connector/native/mod.rs`, read through `gh api`; the project pins 7.10.1).
   - `split_script_into_statements` parses the script with `sqlparser` (`PostgreSqlDialect`) and cuts it at the statement terminators. Comments stay in the pieces.
   - Each piece goes to `simple_query`, the simple protocol, where one piece may hold several commands. When `sqlparser` cannot parse the script, the whole script goes to `simple_query`.
   - This matches the `prisma/README.md` "Rule 5" observation. So PostgreSQL's own lexer always reads every byte of a deployed file.
   - The bootstrap runner sends `substituteVariables(file.sql, vars)` as one simple query (`bootstrap.ts:141-147`, `:294`). `substituteVariables` keeps every comment token verbatim (`sql-text.ts:150-159`).
4. **Probes** (session scratchpad, one Node process each, results in §4 and §5). They covered:
   - head and merge-base `splitStatements` over the PR's case table, 7 lexer shapes with controls and 17 block-layer edge shapes;
   - a corpus comparison over all 532 tracked `.sql` files;
   - a scaling run;
   - `lintMigrations` at the head over 10 scratch migration directories;
   - `renderShadowInit` (head against merge base) over 10 KEEP shapes and the real bootstrap lane, plus `lintRepository` at the head;
   - 10 splitter mutants judged by the PR's own rows;
   - the proposed tokenizer fix on a scratch copy, run over the whole corpus.
5. Evidence: the step list, classification and checker output of lane A run 44291101362 (`gh run view --log`), and the lane-B `summary.md` and `integration.junit.xml`.
6. Cross-checks: the code review on main (`fdb33ee`); the PR #65 migration at `d3c2c16` (a character census); `git merge-tree` against `main`.

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR66-SEC-01 | The tokenizer under `splitStatements` reads three things differently from PostgreSQL 18, all fail-open for the migration linter, the bootstrap-lane linter and the shadow rendering: (a) a `--` comment ended by a lone CR, (b) `$tag$` right after a non-ASCII identifier character, (c) a non-ASCII dollar tag. (a) and (b) hide a statement that PostgreSQL runs. (c) shows the linter a statement that PostgreSQL never runs (a faked `RESET ROLE`, or ENABLE + FORCE ROW LEVEL SECURITY). The PR does not change it | LOW | CWE-436, CWE-693 | A04 | `tools/db/sql-text.ts:29` (`DOLLAR_TAG`), `:55-59` (comment end), `:119` (dollar opener), `:226`, `:249` (`/^\s$/`, code review R1-n1) | This PR's fix cycle if one runs (lock `tests-gen-rls` + `prisma-core`). Otherwise a follow-up on the security-owned `tools/db` (database-engineer), due before the next PR after #65 that adds or changes a `prisma/migrations` or `prisma/bootstrap` file, and with any earlier change to `sql-text.ts` |
| PR66-SEC-02 | The new rule-L limit says text a body swallows "never runs as a migration step". That is true for utility statements (0A000), but DML in a body runs when the routine is called, and the same file may call it. Rule 10's own text says "CREATE FUNCTION bodies are not executed at migration time", and `CREATE FUNCTION … DELETE …; SELECT f();` lints clean without `data-changing: yes`. Not caused by the label shapes, and not introduced by this PR | INFO | CWE-693 | A04 | `tools/db/sql-text.ts:214-216`; data-model §8.3 rule L (line 4157) and rule 10; `tools/db/lint-migrations.ts:30-32` | Wording: principal-architect at the next §8.3 edit. Rule 10 call-site form: the next holder of the `tools/db` linter, or recorded as a stated limit next to rule 11's PR #24 R1-n7 |

## 4. Finding details

### PR66-SEC-01 (LOW): the lexer under the grammar-exact splitter is not PostgreSQL's

**Description.** `splitStatements` works on the token stream of `tokenize` (`sql-text.ts:39-132`). This PR makes the block layer grammar-exact. The lexer underneath was not changed, and it differs from `scan.l` in three places:

| | `tools/db/sql-text.ts` at `ba921da` | PostgreSQL 18 (`scan.l`) | Direction |
|---|---|---|---|
| (a) | A `--` comment runs to the next LF (`:56`, `sql.indexOf('\n', i)`) | `comment ("--"{non_newline}*)` with `non_newline [^\n\r]`: a CR ends it | PostgreSQL runs code that the tokenizer files as comment |
| (b) | A `$` opens a dollar quote unless the previous code character is ASCII `[A-Za-z0-9_$]` (`:119`, `IDENT_CHAR`). The non-ASCII-aware `isIdentifierChar` exists but is used only for the E prefix | `ident_cont [A-Za-z\200-\377_0-9\$]`: in `é$a$` the `$a$` belongs to the identifier | the tokenizer swallows code into a "dollar body" up to the next `$a$` |
| (c) | A dollar tag must start with `[A-Za-z_]` and continue with `[A-Za-z0-9_]` (`:29`) | `dolq_start [A-Za-z\200-\377_]`, `dolq_cont [A-Za-z\200-\377_0-9]`: `$é$ … $é$` is a string | the tokenizer splits inside a string, so the linter sees statements that never run |

**Probes** (`lintMigrations` at the head, real table-class manifests, one scratch migration directory each, header `expand / data-changing: no / reversible: yes`; the merge-base splitter gives the same split for every row):

| Case | File body (CR and LF are the characters themselves) | Linter | PostgreSQL 18 reads |
|---|---|---|---|
| control | `GRANT TRUNCATE ON public.fixture_items TO platform_app;` | rule 8 | the GRANT |
| (a) | `SELECT 1; -- note`CR`GRANT TRUNCATE … TO platform_app;`LF`SELECT 2;` | **0 findings** | `SELECT 1`, the GRANT, `SELECT 2` |
| (a) in a body | `CREATE FUNCTION public.f() … BEGIN ATOMIC SELECT 1; --`CR`END; GRANT …; CREATE FUNCTION public.g() … BEGIN ATOMIC SELECT 1;`LF`END;` | **0 findings** (one routine statement) | `f`, the GRANT, `g`: the CR closes `f`'s body early |
| (b) | `SELECT 1 AS é$a$; GRANT …; SELECT 2 AS ä$a$;` | **0 findings** (one SELECT) | three statements, the GRANT among them |
| (c), rule 15 | `SET ROLE platform_definer; CREATE FUNCTION … SECURITY DEFINER …; SELECT $é$; RESET ROLE; $é$;` | **0 findings** (the control without `RESET ROLE` gives rule 15) | the `RESET ROLE` is string content: the deploy session stays `platform_definer` |
| (c), rule 9 | `CREATE TABLE public.fixture_orders (…);` (a TENANT table), then `SELECT $é$; ALTER TABLE … ENABLE ROW LEVEL SECURITY; ALTER TABLE … FORCE ROW LEVEL SECURITY; $é$;` | **0 findings** (the control without the two ALTERs gives rule 9 "needs ENABLE and FORCE") | the table has no RLS |
| ASCII controls | `x$a$`, `$q$ … $q$`, LF-ended comment | correct | same |

**Who reads the raw text.**
- **`migrate deploy`:** the engine's `sqlparser` pieces, or the whole script, go through `simple_query` with comments kept (method item 3). Under (a) and (b) the hidden statement reaches PostgreSQL, either as its own piece or as a second command in one piece, and runs either way. Under (c) one of two things happens: the engine keeps the dollar string whole, so the faked statements never run, or it cuts inside it, so PostgreSQL refuses an unterminated dollar string and the deploy fails closed. The engine was not run here.
- **Bootstrap runner:** it sends the whole substituted file as one simple query, comments included (method item 3), so (a) and (b) run on that lane too. This corrects code review R1-m1, which says "the bootstrap runner drops the comment text". The runner keeps it.
- **Shadow rendering:** this is what drops the text. `renderShadowInit` keeps `splitStatements` output, from which comments are removed (`sql-text.ts:245-247`).
  - Probe: `… ADD CONSTRAINT ck_x CHECK (a > 0 --`CR`) NOT VALID, DISABLE TRIGGER ALL, ADD CONSTRAINT z CHECK (true`LF`);` is kept as the clean `CHECK (a > 0 )` (head and base).
  - The real lane runs `DISABLE TRIGGER ALL`. So the shadow and the real database diverge, and the bootstrap linter (rule 12) never saw the second action. That is the PR52-SEC-01 effect, reached through the lexer instead of the KEEP regex.

**Exploitability and impact.**
- **Who can do it.** It needs someone who can author a migration or bootstrap file. A lone CR is invisible in most diff views, and a non-ASCII letter next to `$` is easy to miss. The hidden or faked statement can be any privilege, RLS or role-state change, and the linter is the control that is meant to name it.
- **Outcome controls that remain.** Catalog C1 (ENABLE/FORCE), C5 (grants, PUBLIC included) and C11 (definer-owned objects) in lane B; the generated RLS suite; the audit DDL guard for audit objects; CODEOWNERS review of `prisma/migrations/` and `prisma/bootstrap/`.
- **Exposure today.** A census of the 532 tracked `.sql` files found 0 lone CRs (47 files hold non-ASCII characters). With the fix below applied, all 532 token streams are unchanged, so no tracked file holds any of the three shapes. The PR #65 migration (`d3c2c16`) is also clean: 0 lone CRs, and none of its 15 non-ASCII characters is next to a `$`. Nothing in the tree uses the gap.
- **Rating.** Impact Medium (a linter control bypass; the outcome controls stand) × likelihood Low = **LOW**. This is the same class and rating as PR43-SEC-11 and PR54-SEC-01, and the same as the code review's R1-m1 (MINOR).

**Remediation (code level, `tools/db/sql-text.ts`).**
1. (a) End a line comment at LF **or** CR (`:55-59`):
   ```ts
   if (ch === '-' && next === '-') {
     // scan.l: comment ("--"{non_newline}*), non_newline [^\n\r]: a CR ends the comment too (PR66-SEC-01 a).
     let stop = i + 2;
     while (stop < sql.length && sql[stop] !== '\n' && sql[stop] !== '\r') stop += 1;
     push({ kind: 'comment', text: sql.slice(i, stop) });
     i = stop;
   }
   ```
2. (b) A dollar quote never starts inside an identifier (`:119`):
   ```ts
   } else if (ch === '$' && !isIdentifierChar(code.at(-1)) && DOLLAR_TAG.test(rest)) {
   ```
3. (c) PostgreSQL's tag alphabet (`:29`):
   ```ts
   const DOLLAR_TAG = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/;
   ```
4. With these, apply code review R1-n1: `/^[ \t\n\r\f\v]$/` instead of `/^\s$/` at `:226` and `:249`. PostgreSQL refuses the R1-n1 shapes, so this is consistency, not a hole.
5. Optional, recommended because a CR cannot be seen in review: `lintMigrationDir` and `lintBootstrap` report a lone CR (a CR not followed by LF) anywhere in a file as rule L, the way `yaml-subset` refuses one in workflows.

**Validation of the fix** (items 1 to 3 applied to a scratch copy of the head file):
- Over all 532 tracked `.sql` files, the token streams and the splits are identical to the head. With every file converted to CRLF, the splits are identical apart from whitespace (`routineDefinitionSha256` collapses whitespace, so allow-list digests do not move).
- The PR's 13-row case table still splits as specified.
- (a) and (b) now show the GRANT as its own statement, and (c) keeps `SELECT $é$; RESET ROLE; $é$` as one statement. The ASCII controls are unchanged.
- The comment loop is linear: 40,000 comments tokenize in 33 ms.

**Verification tests.**
- `sql-text.test.ts`: one row per differential, with an ASCII control each:
  - CR before `GRANT`, before `END` in a body, and before `SET lock_timeout`;
  - `é$a$` / `ä$a$` around a GRANT;
  - `$é$ … RESET ROLE … $é$` as one statement;
  - NBSP, U+FEFF and U+3000 before `$q$`.
- `lint-migrations.test.ts`: fixtures for (a), (b) and (c). The hidden GRANT is reported (rule 8). The faked `RESET ROLE` leaves rule 15 firing, and the faked ENABLE/FORCE leaves rule 9 firing.
- `split-statements.int.test.ts`: the same shapes as new case-table rows. The whole text as one simple query and the split pieces must have the same effects. The current harness already proves that.

### PR66-SEC-02 (INFO): the "never runs as a migration step" limit holds for utility statements only

The new limit text (`sql-text.ts:214-216`; data-model §8.3 L) reasons: PostgreSQL refuses a utility statement inside a SQL function body at CREATE time (0A000), "so text that a body swallows by the grammar never runs as a migration step". That is right for GRANT, DROP, SET and nested CREATE. DML that the grammar places in a body (for example after a bare label `end`) is accepted at CREATE time and runs whenever the routine is called, and the same migration may call it.

Rule 10 reads its own limit the same way: "CREATE FUNCTION bodies are not executed at migration time and are not scanned" (`lint-migrations.ts:30-32`). Probe at the head:
- `DELETE FROM public.fixture_items;` gives rule 10;
- `CREATE FUNCTION public.f() RETURNS void LANGUAGE sql BEGIN ATOMIC DELETE FROM public.fixture_items; END; SELECT public.f();` gives 0 findings;
- the label form `… BEGIN ATOMIC SELECT 1 END; DELETE …; END; SELECT public.f();` also gives 0 findings.

So the label shapes add nothing to a gap that a plainly written body already has. This predates the PR.

Impact: a data change without `data-changing: yes` skips the backup guardrail of §8.6. Audit storage is not reachable this way: rule 12 refuses any audit name in `prisma/migrations`, and the immutability triggers refuse the write.

**Fix.**
- Reword both texts to "a utility statement in the body is refused at CREATE time (0A000); DML in the body runs when the routine is called, which rule 10 does not see".
- Either teach rule 10 that a top-level call of a routine created in the same file, whose body holds a write form, is data-changing, or list it as a stated limit next to rule 11's PR #24 R1-n7 ("a function created in the file … and that is then called").

## 5. Verification of the claims

### 5.1 The block layer against PostgreSQL's grammar

| PostgreSQL 18 (`gram.y`) | `splitStatements` at `ba921da` | Agreement |
|---|---|---|
| `BEGIN_P ATOMIC` appears only in `opt_routine_body`, used only by the four `CreateFunctionStmt` forms, after the parenthesised argument list and the options | Opens on `begin` with next word `atomic`, at parenthesis depth 0, in a statement whose first four words match `create [or replace] function\|procedure` (`:242-243`); inside a block, in a body statement with that head | Every PostgreSQL opener is seen. A text the splitter opens and PostgreSQL does not is a syntax error: no function option, type or name can be followed by `ATOMIC`. Where PostgreSQL opens nothing, the splitter opens nothing either (the PR's parameter `begin atomic` row; my rows `RETURN begin` and a top-level `SELECT begin atomic`) |
| `routine_body_stmt_list: routine_body_stmt_list routine_body_stmt ';' \| EMPTY`; `routine_body_stmt: stmt \| ReturnStmt`; `stmt` excludes `TransactionStmtLegacy` (only `toplevel_stmt` has it) | Closes only on `end` as the first non-space, non-comment piece of a body statement (`:294-301`). A string, identifier, dollar or variable token also starts the statement (`:258-261`). A body `;` resets it (`:271-275`) | `END_P` at a statement start can only be the body's END. Anywhere else, `END` is a CASE end, a label or a syntax error. A statement-start position is the same in both, so neither side can close where the other does not |
| `CreateFunctionStmt` ends after `opt_routine_body` | Only `;` (or the end of the text, at top level) may follow the closing `END` (`:253-255`), else rule L | Stricter: PostgreSQL refuses everything else (`END WORK`, `END LANGUAGE sql`, `END SELECT 1`, `END END`, a variable) |
| No statement allowed in a body has a `;` inside parentheses (CREATE RULE's `DO (a; b)` is grammar-legal but refused at CREATE, 0A000) | Throws at a body `;` inside parentheses (`:271`) | Fail closed |
| A text that ends inside a body is a syntax error | Throws with the number of open blocks (`:308-310`) | Fail closed |

The remaining differences sit one layer down, in which characters form a token. That is PR66-SEC-01.

### 5.2 Probes on the head splitter (head against merge base)

- **PR case table:** 13 of 13 rows split as `[routine, GRANT, DROP, SET, END]`. On the merge base, 6 of 13 do (positive control).
- **Block-layer edge shapes, 17.** Each splits as PostgreSQL reads it, or fails closed where PostgreSQL refuses it:
  - a quoted `"end"` as the first piece;
  - VT and FF around `END`; NBSP glued to `END` (one identifier piece);
  - `BEGIN -- c` LF `ATOMIC`;
  - `begin atomic` in a top-level SELECT; routine head words split by comments; a quoted `"atomic"`;
  - empty body statements `; ;`; `END END`; `atomic` as the first body word;
  - a dollar body holding `END; GRANT`; a string-led body statement; a variable after `END`;
  - `(END)`; an extra `)`; the RETURN form; a nested routine before a hostile tail.

  Three of them differ from the merge base, always towards fail-closed: `END END`, `END :'x'` and `'x' END; GRANT …; END`. PostgreSQL raises a syntax error on each, so the file fails as a whole.
- **Scaling.** A body of 32,000 statements splits in 75 ms. 32,000 `begin` words with 50 spaces each split in 657 ms (1.8 MB); `nextWord` only skips the whitespace that follows a `begin`, so the cost stays linear. Migration text is repository content.

### 5.3 Mutants (the card's scratch-copy validation)

Ten mutants of the new logic were applied one at a time to a scratch copy of `sql-text.ts`, by exact-string replacement (each anchor unique). Each was judged by the PR's own rows, replayed in Node without Jest:
- the 13-row case table;
- the 8 fail-closed rows of `sql-text.test.ts`;
- the nested-procedure and parenthesised-alias rows.

The unmutated head fails 0 rows.

| Mutant | Rows failing |
|---|---|
| s2 no paren gate | 1 |
| h1 nested opener without the routine head | 2 |
| n1 nested never opens | 4 |
| e1 any `end` closes | 5 |
| e2 `END` never closes | 20 |
| c1 no check after `END` | 5 |
| p1 no paren check at a body `;` | 1 |
| f1 EOF inside a block passes | 2 |
| o1 `atomic` counts as the first body word | 5 |
| r1 `started` not reset at a body `;` | 19 |

All 10 are killed, which agrees with the PR's 15 of 15. The card clause "structural fix validated on a scratch copy by security-analyst" is met by this section together with §5.2 and §5.4.

### 5.4 Corpus

There are 532 tracked `.sql` files at the head (514 on `main`, plus the 18 new fixture files).
- 525 split exactly as with the merge-base splitter: 879 statements, and 3 files that are rule L in both.
- 7 differ, exactly the 7 the PR lists:
  - the 4 label shapes, 1 → 3 statements;
  - `end_labels_control`, 4 → 2;
  - `end_not_last` and `paren_semicolon`, which become rule L.

This agrees with code review V4.

### 5.5 Shadow rendering and the repository lint

- **The real lane.** `shadowInitSql` over the head's `prisma/bootstrap` is byte-identical between the head and the merge-base `shadow-init.ts` (23,126 characters, same SHA-256). The `ck_audit_entries__action` replacement of `91-audit-actions-v2.sql` is kept. `prisma/bootstrap/` is unchanged, so the rule-12 approvals (10 `c3d4db9`, 90 `9aab9aa`, 91 `9945c349`) are untouched.
- **KEEP shapes** (head against merge base):
  - kept on both: the bare form, a trailing comment, a doubled quote in a quoted identifier (`"a""(b"`), an E-string holding `\'), x`, and a quoted table name that holds the head text;
  - refused on both: `CHECK ((a > 0)), DISABLE TRIGGER ALL` and `ck_x` → `ck_xy`;
  - **refused on the head, kept on the merge base:** `NOT VALID, DISABLE TRIGGER ALL, ADD CONSTRAINT z CHECK (true)` and `pk_audit_x` "replaced" by a CHECK.

  The CR shape is in PR66-SEC-01.
- **`isCheckReplacement` (`shadow-init.ts:182-200`)** is a linear forward scan. A doubled `""` pairs into two adjacent quoted runs, so the skip still covers the identifier. An unterminated quote returns false; `statementCode` already throws on it first.
- **`lintRepository` at the head:** 0 findings.
- I support code review R1-n2: the `ck_` prefix is the only evidence that the dropped constraint is a CHECK. The statement is kept verbatim, so the shadow still equals the real lane, and bootstrap files are CODEOWNERS-reviewed. I do not raise a separate finding. The optional `pg_constraint` assertion (`ck\_%` implies `contype = 'c'`) is a good C-series addition.

### 5.6 The PostgreSQL agreement test

`split-statements.int.test.ts` uses a strong, deterministic oracle:
- the whole text runs as one simple query, and the effects of its tail show at top level;
- every split piece runs as a named prepared statement under the extended protocol, which refuses two commands (42601) and a fragment (42601). Both refusals are proved by a control with its own positive control.

It uses a fresh database cloned from a template per case, runs as superuser only inside the Testcontainers cluster, and its SQL is constant. Lane B ran 14 of 14. The 120 s per-case timeout is a hang guard only (D-TASK290-06, consistent with D-SEC-PR53-02). The test's premise ("the split must be PostgreSQL's") is exactly what PR66-SEC-01 extends to the lexer, and the fix's verification adds its shapes to this same table.

### 5.7 Injection, secrets, ReDoS, messages

- **Injection.** No new process, shell, network or file-write path. The fixtures are data. The integration test interpolates only constants: `ATOMIC_CASE_SEARCH_PATH`, and database names `split_case_<n>`.
- **Secrets.** No secret-shaped value. Gitleaks (PR range) and Semgrep are green in run 44291101362.
- **ReDoS.**
  - `CHECK_REPLACEMENT_HEAD` is anchored. Its quantifiers are bounded by the literal that follows, its back-reference is to a name class that cannot hold `,` or a space, and it has no nested quantifier. Its input is bootstrap files at config load.
  - The removed KEEP regex `(?:(?!\) ?, ?[a-z])[^;])*\)$` was the only lookahead loop.
  - `/^\s$/` tests single characters.
- **Messages.** The new `SqlLexError` messages are fixed strings and echo no input. Shadow refusals still preview `statementCode` text, with literals blanked.

## 6. Earlier items and the D-TASK290 proposals

| Item | Status |
|---|---|
| PR43-SEC-11 (LOW): an in-body over-count of `splitStatements`, resynchronised by a top-level `END` | **CLOSED.** No counter is left to resynchronise (§5.1, §5.3). The four label shapes plus a hostile tail split, and the tail is linted (fixture test `atomic-body-labels`; my probe P0). The PostgreSQL 18 agreement is in lane B |
| PR52-SEC-01 (LOW): the shadow KEEP regex keeps an attribute tail plus any action, and a same-name CHECK in place of a PK | **CLOSED** (§5.5). The lexer route to the same effect is part of PR66-SEC-01 |
| PR #43 code review R2-m1, R2-n1 (paren gate pinned: mutant s2 killed), R2-n3 | Closed, as the code review records |
| Code review r1 R1-m1 | = PR66-SEC-01. Widened by (c) and by the deploy-path reading, and corrected on the bootstrap runner |
| Code review r1 R1-n1 | Folded into PR66-SEC-01 item 4 (consistency; PostgreSQL refuses those shapes) |
| Code review r1 R1-n2 | Supported (§5.5); no separate finding |
| Code review r1 R1-m2 (picomatch blocks lane A) | A merge condition (§8). GHSA-fc5q-39xc-vjpf lists no patched version (`<= 4.0.7`). The lockfile holds 4.0.7 and 2.3.2, both dev. So the route is a dated `audit/watched` entry with a dev-only justification, decided in its own triage, not in this record |

Security position on D-TASK290-01 to -06:
- **01, the grammar-exact close instead of a CASE depth:** accepted. It is exact against `gram.y` (§5.1). The CASE-depth sketch in my PR43-SEC-11 record would have refused valid SQL and kept a heuristic counter.
- **02, the two new rule-L shapes:** accepted. PostgreSQL refuses both, and the corpus is unchanged.
- **03, the KEEP name as the unquoted `ck_` name; quoted names refused:** accepted. It adopts PR52-SEC-01's optional rule, and refusing quoted names fails closed.
- **04, one case table feeding the PostgreSQL agreement test through named prepared statements:** accepted, as a strong one-command oracle.
- **05, the §8.3 wording of rules 18, 19 and L:** no objection to 18 and 19, which match the code as read. For L, see PR66-SEC-02.
- **06, the 120 s hang guard:** accepted.

## 7. Sequencing and unions

- **`main`:** there is no path in common since the merge base, and the merge is clean. A later merge of `main` into this branch voids this record only if `main` changed one of the 27 owned paths this PR changes. When this round was written, none had changed.
- **PR #65 (TASK-037):** it shares `tools/db/lint-migrations.ts` and `.test.ts`, in disjoint hunks, and the merge is clean (code review V8). The COORD-03 order is this PR first. If #65 merged first, and `main` were then merged into this branch, `lint-migrations.ts` would change after the head row's commit, and a merge-only round would be needed. The #65 migration has none of the PR66-SEC-01 shapes (census in §4), so PR66-SEC-01 does not block #65.

## 8. Proposed decision (for the orchestrator to log)

**D-SEC-PR66-01.** PR #66 (TASK-290) security r1 = PASS_WITH_FOLLOW-UPS at `9a14659`. Findings: 0 Critical, 0 High, 0 Medium, 1 LOW, 1 INFO.
- PR43-SEC-11 and PR52-SEC-01 are closed. The card's scratch-copy validation clause is met (§5.3).
- **PR66-SEC-01 (LOW):** align `tokenize` with `scan.l` on three points: a CR ends `--`, no dollar quote inside an identifier, a non-ASCII tag alphabet. Use the ASCII whitespace class (R1-n1). Optionally, refuse a lone CR in migration and bootstrap files. Fix validated over all 532 files. Due in this PR's fix cycle if one runs; otherwise a `tools/db` follow-up (database-engineer) before the next PR after #65 that adds or changes a migration or bootstrap file, and with any earlier change to `sql-text.ts`.
- **PR66-SEC-02 (INFO):** reword the rule-L and rule-10 limits for DML in a body that the same file calls, and either extend rule 10 to the call site or list it as a stated limit.
- **Merge conditions (security):**
  1. this record visible to ci-gate (§9);
  2. GHSA-fc5q-39xc-vjpf triaged repo-wide, then a lane-A run on the final head in which every fast-lane step executes and passes, including lint, type-check, unit, build, check-evidence and the base-ref negative fixtures (the no-weakening check the card relies on for the splitter);
  3. the hosted security-integration job, which becomes due once `record_ok` is true, runs and passes on that head;
  4. any later commit that changes one of the 27 owned paths needs a delta round naming the new head.

## 9. Record validation

- **Where it is read.** This record is committed on `main`, because the PR worktree is reserved for the lane-B queue. ci-gate checks out the merge ref (`refs/remotes/pull/66/merge`; run 44291101362 logs "HEAD is now at c6bf591 Merge 9a14659… into 55fdc1c…"). `check-security-owned-paths.mjs` reads records from that work tree, so the record counts from the **next `pull_request` event** after this commit. A re-run of 44291101362 reuses merge ref `c6bf591` and still fails.
- **The orchestrator's records-only commit.** The head row names `9a14659`. A commit after it that touches only records (`docs/**`: this record, DECISIONS, STATUS) changes no owned path (CODEOWNERS owns no `docs/` path), so the binding holds (case S3).
- **Simulation.** I ran `main`'s `tools/ci/check-security-owned-paths.mjs` in a shared, sparse clone over plumbing commits shaped like merge refs, with `--pr 66 --json`. The results are in the table below.

The checker is unchanged since `a813a01`, so it is the same file as at `55fdc1c`, the tools ref of run 44291101362. CODEOWNERS is also unchanged since `55fdc1c`.

| Case | Scenario | Expected | Result |
|---|---|---|---|
| S1 | `main` (`982cb7f`) plus this record, merged with `9a14659` (the shape of the next merge ref) | pass | pass: names `9a14659`, 27 owned paths |
| S2 | An orchestrator records-only commit after `9a14659` (this record plus a `docs/sdlc/STATUS.md` line), merged with `main` plus this record | pass | pass |
| S3 | As S1, with the merge base `466d2c4` as `--base` | pass | pass |
| S4 | A docs-only `main` commit after the record | pass | pass |
| S5 | The record only on the branch, in a records-only commit; `main` without it | pass | pass |
| C0 | The same merge without the record | fail | fail ("no record named PR-0066-*.md") |
| C1 | This record with a FAIL verdict row | fail | fail ("verdict FAIL is not one of …") |
| C2 | The head row naming a `main` commit | fail | fail ("its head row names no commit of this PR"). The first attempt hit a `git` timeout inside the checker under host load (exit 2), and the re-run alone gave this result |
| C3 | A commit after `9a14659` that changes `tools/db/sql-text.ts` | fail | fail ("… changed after it") |
| C4 | An owned fixture changed after a records-only commit | fail | fail |
| C5 | The old merge-ref shape (`55fdc1c` plus `9a14659`, which a re-run of 44291101362 checks out) | fail | fail ("no record") |

The record has exactly one head row and one verdict row. An over-approximating scan of this record with the 220 compilable rules of the pinned Gitleaks v8.30.1 config (keyword prefilter and rule regex only, no entropy and no allowlists) found 0 hits. The runtime positive controls (a GitHub PAT shape and an AWS key id) were detected.

## 10. Verdict

No Critical, High or Medium finding. PR66-SEC-01 (LOW) is a pre-existing lexer gap under the new splitter, with a validated fix and an owner. PR66-SEC-02 is INFO. From security, the PR may merge at `9a14659` once the merge conditions of §8 hold.

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is open for the change. PR43-SEC-11 and PR52-SEC-01 are closed. PR66-SEC-01 (LOW) is due in this PR's fix cycle, or before the next migration or bootstrap PR after #65. PR66-SEC-02 is INFO with an owner |
