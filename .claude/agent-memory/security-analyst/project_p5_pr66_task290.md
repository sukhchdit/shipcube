---
name: project-p5-pr66-task290
description: PR #66 (TASK-290 grammar-exact BEGIN ATOMIC splitter + shadow KEEP balanced CHECK) security r1 @9a14659 PASS_W_F-U, record + D-SEC-PR66-01..02 on MAIN (57140c7); PR43-SEC-11 and PR52-SEC-01 closed; new LOW 01 tokenizer vs scan.l (CR, é$a$, $é$), INFO 02 limit wording / rule 10 call site; Prisma deploy-path facts
metadata:
  type: project
---

Round 1, 2026-11-18, static plus light Node probes (D-ORCH-131 host rule). Record `docs/05-quality/security/PR-0066-TASK-290-security-review.md` and D-SEC-PR66-01/-02 committed **on main** `57140c7` (pushed), like PR-0063. Code twin `fdb33ee` APPROVED_WITH_NITS (R1-m1 = my 01, R1-m2 picomatch, R1-n1/n2/n3).

**Findings:**
- **PR66-SEC-01 LOW (CWE-436/693):** `tools/db/sql-text.ts` tokenize (unchanged by the PR) vs PG 18 scan.l: (a) `--` ends at a lone CR, (b) `é$a$` is an identifier (dollar rule uses ASCII `IDENT_CHAR`, `:119`), (c) `$é$` is a valid tag (`DOLLAR_TAG` ASCII, `:29`). (a)/(b) hide a GRANT from the real linter (0 findings); (c) fakes RESET ROLE (rule 15) and ENABLE+FORCE (rule 9). Fix validated: 532/532 token streams unchanged. Due this PR's fix cycle, else tools/db follow-up before the next migration/bootstrap PR after #65.
- **PR66-SEC-02 INFO:** "never runs as a migration step" holds for utility statements only; rule 10 misses `CREATE FUNCTION … DELETE …; SELECT f();` (pre-existing).
- Correction to code review R1-m1: the bootstrap runner KEEPS comments (`substituteVariables` returns comment tokens verbatim); only the shadow rendering (splitStatements output) drops them.

**Facts:**
- Prisma ≥ 7.4 native schema engine (prisma-engines PR #5767, `flavour/postgres/connector/native/mod.rs`): `split_script_into_statements` uses sqlparser 0.60 PostgreSqlDialect, cuts at terminators, keeps comments, sends each piece with `simple_query`; parse failure → whole script in one `simple_query`. So PG's lexer reads every deployed byte. `@prisma/adapter-pg` `executeScript` is a naive `split(';')` but migrate does not use it.
- lane-scope: `security_integration_due = pull_request && security_paths && record_ok && security_proof == ''`, and the job needs fast-lane success. GHSA-fc5q-39xc-vjpf (picomatch ≤ 4.0.7, no patched version) blocked every PR's fast-lane on 2026-11-18.
- Under host load the checker's internal `git` hit its 60 s ETIMEDOUT (exit 2) once; re-run the single case.

**How to apply:** delta round if a commit after `9a14659` touches one of the 27 owned paths (tools/db/**, prisma/tests/migrations/**). At the PR66-SEC-01 fix review: check (a)(b)(c) rows + R1-n1 ASCII whitespace + lint fixtures that keep rules 8/15/9 firing + int-test rows; re-run corpus identity. Kit (session scratch `pr66/probes/`): `hooks.mjs`, `probe1..5.mjs`, `fixcheck.mjs`, `mutants.mjs`, `sim.mjs` (SIM_ONLY filter), `gl.mjs`.

Related: [[project-p5-pr43-task024-rls-generator]], [[project-p5-pr52-pr53]], [[project-p5-pr54-020d]], [[project-p5-pr63-task036]], [[project-security-review-conventions]]
