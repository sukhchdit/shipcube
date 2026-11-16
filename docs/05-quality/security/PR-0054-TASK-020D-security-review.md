# PR-0054: TASK-020 part 020-D (SYSTEM-table raw-SQL ownership, raw transaction-control guard, PR #44 lint residuals), security review

| Field | Value |
|---|---|
| PR | #54 `feat(lint): system-table raw-SQL ownership and transaction-control guards (TASK-020 020-D)`, https://github.com/sukhchdit/shipcube/pull/54, branch `feat/TASK-020-d-raw-sql-ownership`. 15 commits on the merge base `3e2da8b`: four code commits (`a436a31`, `73ca2ef`, `6a2ca88`, `2ca3886`), the PR #42 union fixture `eb31fb4`, the D-TASK020-94 test `7d35e91`, two comment commits (`e7e867a`, `f953187`), six merges of `main` (`274ccfa`, `4704eaa`, `dc3bc4a`, `ac3d7cb`, `34386bf`, `f01e470`) and the evidence commit `3efa2df` (8 added files under one run directory, parent `f01e470`). `main` was `7652ee2` when this round was finished; since the merge base it has moved by docs, review records and agent notes only (`DECISIONS.md`, `STATUS.md`, `docs/05-quality/reviews/PR-0053-*` and `PR-0054-*`, `.claude/agent-memory/*`) |
| Head | 3efa2df4f48707be473963304c4257bca922539d |
| Code head | `f01e470` (`git diff --name-only f01e470 3efa2df` = the evidence directory only) |
| Lane A evidence | Run 43739100307 on `3efa2df`. **fast-lane `success`**, every step ran: workflow policy, install flags, released migrations, lockfile, licences, signatures, audit, "Lane B evidence" (run `20261115T1641Z_f01e470` accepted), lint, format, type-check, unit, the base-ref negative fixtures against the head configs, build. **scans**: Gitleaks (PR commit range), Semgrep and oasdiff `success`; the only red step is "Security-owned paths need a review record". `ci-gate` is red only as the aggregate. This file is the missing record |
| Owned paths changed | 55 (main's `check-security-owned-paths.mjs`, base `origin/main`): `eslint.config.mjs`, the six changed rule files under `tools/eslint-rules/`, `tools/lint/{negative-fixtures,raw-sql-lexer}.test.ts`, `tools/tsconfig.json`, `apps/api/src/platform/db/{config-exit,raw-statement,raw-statement.test,tenant-db,tenant-db.test}.ts`, `apps/api/src/platform/tx/{execute-phases.test,route-phases.int.test}.ts`, `prisma/tests/rls/session-scope-leak.int.test.ts` and 37 lint fixture files |
| Unowned paths changed | `apps/api/src/start-api.ts` (two comments), `tests/fixtures/sql/raw-statement-corpus.json` (the shared oracle of both twins, see PR54-SEC-04), the run directory `docs/05-quality/tests/runs/20261115T1641Z_f01e470/` (8 files) |
| Binding items checked | D-ARCH-124 / PR32-SEC-07 (c) / D-SEC-PR43-03 (`rawSystemTable`), PR44-SEC-05, -10, -11, -14 (lint part), the D-SEC-PR42-02 020-D note (`UPDATE pg_settings`, DO-block setters), D-SEC-PR44-02 / D-ORCH-076, D-TASK020-78..94, the threat model's tenant-isolation and session-scope-leak items (F-04, ADR-0005 am. 10 item 16), D-SEC-PR23-02 (evidence-commit shape) |
| Reviewer / date | security-analyst, 2026-11-15, round 1. Read-only. Git object reads ran in the main checkout. Probes ran on `git archive` extracts of the head and the merge base in the session scratchpad, with a `node_modules` junction to the main checkout (removed afterwards, main's entry count unchanged at 743), and type-stripped copies of `apps/api/src/platform/db/{tenant-db,raw-statement,map-db-error,system-models,system-port}.ts`. Two short PostgreSQL 18.6 containers (pinned digest of the integration suites, loopback port, random credentials never printed) ran under `docker.lock` (owner tag `sec-pr54`) and were removed. In the PR worktree I only wrote this file (no git command there). Line numbers come from single-file reads at `3efa2df`. The code-review twin `docs/05-quality/reviews/PR-0054-TASK-020D-code-review.md` (CHANGES_REQUESTED, R1-M1) landed on `main` in `a1db134` while this round was being written; I read it before finalising and cite its IDs in §9 |

## 1. Summary

The PR delivers what D-ARCH-124 and PR44-SEC-05 ask for in their plain forms. `rawSystemTable` reads the table-class manifests, fails closed on a missing manifest or an unreadable template, and reports a SYSTEM table named from outside its owner's globs in every unquoted, quoted, schema-qualified, upper-case, partition, CTE and commented spelling I tried (§5.1). The TenantDb guard refuses `COMMIT`, `ROLLBACK`, `SET`, `RESET`, `DISCARD`, `DO`, `UPDATE pg_settings` and the setter without a literal `true` before Prisma is called; a real Prisma 7 interactive transaction on PostgreSQL 18.6 shows nothing reaches the server (§5.2). Fragments (`Prisma.sql`, `Prisma.join`) and the `*Unsafe` members stay refused at run time. PR44-SEC-10 and -11 are closed (the base crashes on four of my probe files, the head reports them), and most of PR44-SEC-14's lint part is closed.

The weakness is the shared premise of both twins: that they read the template the way PostgreSQL does. They do not, in five ways, and every way is fail-open for both the lint and the run-time guard (PR54-SEC-01). Two of them are the code review's R1-M1: a `--` comment ends at CR in PostgreSQL, and a Unicode space before `$q$` is part of an identifier there. Three are new here: a string continued across a newline keeps its `E'…'` backslash escapes; the twins join template parts with `' $1 '` while Prisma renders `$1` with no spaces, which flips dollar-quote parity; and the literal-`true` setter admits `standard_conforming_strings = off` for the rest of the transaction. On PostgreSQL 18.6, (a), (b), (c) and (e) each let a `COMMIT` through that commits a row the callback then tries to roll back. With (a), (c) and (d), a session `search_path` change survives on the pooled backend, and a SYSTEM table is read with no `rawSystemTable` finding. (d) needs a bound value, so it is limited to one statement and cannot carry a `COMMIT`. Separately, the refused set is a deny-list of first keywords. It misses `DECLARE … WITH HOLD`: a cursor declared under tenant A was fetched under tenant B on the same backend. It also misses session advisory locks, `ALTER ROLE` at run time, and identifier-free readers such as `database_to_xml` (PR54-SEC-02). Built-in loaders still escape through the dynamic `import('node:module')` (`.Module._load`, `.register`, `{ default: M }`, the code review's R1-m1) and through computed or reflective reads on `process` (PR54-SEC-03).

All of these need deliberately crafted source: no accidental spelling reaches them, and a reviewer sees the refused keyword in the template. They are LOW. But the PR's purpose is exactly this control, and the fix is small and validated: a patched lexer copy refuses every bypass, leaves the 73-case corpus unchanged and changes no verdict over the 96 real raw templates of the tree. The code review already requires a fix cycle for R1-M1. So I make the complete set a condition of that cycle.

D-TASK020-94 is sound. The leak detector is a sufficient backstop for carry-over of the four security keys across requests. It is not a backstop for a re-scope inside the same transaction, or for session settings other than those keys (PR54-SEC-05, INFO). Evidence hygiene holds: the D-SEC-PR23-02 statements are in the gate table verbatim, and the count-only host-fragment scan is 0, with a positive control.

Findings: 0 Critical, 0 High, 0 Medium, 3 LOW, 3 INFO.

**Verdict: PASS_WITH_CONDITIONS** (C1 = PR54-SEC-01 complete, C2 = PR54-SEC-02 (a), both in the fix cycle the code review already requires; §10).

## 2. Method

1. Read the full diff `3e2da8b...3efa2df`, both lexer twins, `db-raw-sql.mjs`, `system-model-owner.mjs`, `static-module-specifier.mjs`, `module-sources.mjs`, `no-external-calls-in-tenant-tx.mjs`, the `eslint.config.mjs` diff, `tenant-db.ts`, `with-tenant-tx.ts`, `session-integrity.ts`, the corpus, the new and changed tests and fixtures, D-ARCH-124, D-SEC-PR42-02, D-SEC-PR44-02, D-TASK020-78..94, and `tools/db/lint-migrations.ts` rules 16 and 20 (the migration-lane twins of the same ideas).
2. **PostgreSQL 18 lexer facts** from `REL_18_STABLE` `src/backend/parser/scan.l`: `space [ \t\n\r\f\v]`, `newline [\n\r]`, `non_newline [^\n\r]`, `comment ("--"{non_newline}*)`, `ident_start [A-Za-z\200-\377_]`, `ident_cont [A-Za-z\200-\377_0-9\$]`, the `xqs` quote-continuation state that returns to the state before the stop (so an `E'…'` string continues in E mode). Each fact was then executed (item 5).
3. **Twin probe** (`twins.mjs`): the lint twin and the type-stripped run-time twin side by side, with the real manifests, over 7 controls and 21 shape rows. The same file runs a linear-time series (§4, PR54-SEC-06).
4. **Lint probe** (`lintprobe.mjs`): `ESLint#lintText` with the extract's real `eslint.config.mjs` (type checking off), crash-tolerant, on the head and on the merge base as the positive control. 58 cases: 15 `rawSystemTable`, 10 `rawStatement`, 26 loaders and 7 T-83 (§5).
5. **PostgreSQL 18.6 probe** (`pgprobe.mjs`, `pgprobe2.mjs`): the head's REAL `createTenantDb` wraps a REAL Prisma 7.10 interactive transaction. It uses the main checkout's generated client and `@prisma/adapter-pg` with pool `max: 1`, so the session state of the one backend is observable. The caller is a non-superuser role (`ALTER ROLE … SET search_path = pg_catalog, public`) with an RLS table under `FORCE`. Each template's strings were passed as a frozen strings array with a frozen `raw`, which is what a tag delivers; the guard accepts both. The texts were built at run time, so CR, LF, backslash and the Unicode spaces are exact. The Prisma rendering (`strings[0] + '$1' + strings[1] …`) was read from `@prisma/client-runtime-utils` `Sql#text` and from the postgres branch of `@prisma/client/runtime/client.js` (`i=n.text`).
6. **Fix validation** (`fixcheck.mjs`, `fixcheck2.mjs`): exact-string patches on a scratch copy of the lint twin, each applied exactly once. The patched copy ran over the shared corpus (73 cases), the bypass shapes, and every tagged `$queryRaw` / `$executeRaw` template of the tree (96 templates in 555 files, production and tests, parsed with `typescript-estree`). A ReDoS probe covered the continuation regex the fix adds.
7. Evidence: lane A step list, the run's `summary.md`, the evidence-commit shape, and a count-only host-fragment scan with a positive control (§8). Then the record simulation (§12).

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR54-SEC-01 | Both lexer twins read a raw template differently from PostgreSQL 18 and from Prisma's rendering, always fail-open: (a) `--` comment ended by CR, (b) a Unicode space before `$tag$`, (c) an `E'…'` string continued across a newline, (d) template parts joined with `' $1 '` instead of `$1`, (e) a transaction-local `standard_conforming_strings = off` through the admitted literal-`true` setter. `COMMIT`, session `SET`, `DO`, the session setter and SYSTEM table names pass `rawStatement`, `rawSystemTable` and the TenantDb guard; PostgreSQL 18.6 executes them | LOW | CWE-436 | A04 | `tools/eslint-rules/raw-sql-lexer.mjs:29, 43-56, 114-116, 151, 180-182`; `apps/api/src/platform/db/raw-statement.ts:46, 74-87, 139, 160-162, 264-268`; consumer `tenant-db.ts:397` | senior-developer, **C1**: the fix cycle that closes code review R1-M1 (which is (a)+(b)) |
| PR54-SEC-02 | The refused set is a deny-list of first keywords and misses session state and identifier-free readers: (a) `DECLARE … WITH HOLD` / `FETCH` / `MOVE` / `CLOSE` (a cursor declared under tenant A was fetched under tenant B on the same backend) and session advisory locks; (b) `database_to_xml`, `schema_to_xml`, `table_to_xml('t', …)`, `cursor_to_xml`, `ts_stat`, `ts_rewrite`, `query_to_xml` read SYSTEM tables with no identifier; (c) `ALTER ROLE CURRENT_USER SET` runs through the guard (lint `no-alter-role-sql` and the integrity monitor catch it) | LOW | CWE-488 | A01 | `raw-sql-lexer.mjs:209-212, 259`; `raw-statement.ts:52-54, 214`; residual text in `system-model-owner.mjs:33-34` | senior-developer, **C2** = (a) in the same cycle (code review R1-m3, "at the security-analyst's choice": refuse); (b) and (c) follow-up, due before TASK-073's first raw statement |
| PR54-SEC-03 | Built-in loaders still escape the import controls: `(await import('node:module')).Module._load('pg')`, `.register(…)`, `const { default: M } = await import('node:module'); M._load(…)` / `M[k](url)('pg')` (= code review R1-m1), and `p['getBuiltin' + 'Module']`, `process[name]`, `Reflect.get(process, 'getBuiltinModule')`, `Object.getOwnPropertyDescriptor(process, …)`, `globalThis.process.binding`, an alias `p.binding`: all lint-clean in an api module | LOW | CWE-693 | A04 | `tools/eslint-rules/static-module-specifier.mjs:145-150, 173-196, 200-241`; `eslint.config.mjs:93-98` (`RESTRICTED_PROPERTIES`) | senior-developer, same cycle as code review R1-m1, else before the first module or worker-job PR (the D-ORCH-076 due point); interim: code review greps `import('node:module')`, `getBuiltinModule`, `binding`, `Reflect.get(process` |
| PR54-SEC-04 | Lint coverage statements wider than the code: `Prisma.sql` / `Prisma.join` fragments interpolated into a raw template are lint-legal and neither `rawStatement` nor `rawSystemTable` reads them (D-ARCH-124's "Why" and the rule header say `db-raw-sql` refuses them; only the TenantDb run-time guard does); `rawStatement` does not lint `packages/*/src` (= code review R1-n3); the shared corpus `tests/fixtures/sql/raw-statement-corpus.json` and `apps/api/src/start-api.ts` are not CODEOWNED | INFO | CWE-693 | A04 | `system-model-owner.mjs:29-30`; `eslint.config.mjs:991`; `.github/CODEOWNERS` | senior-developer (headers / scope, fix cycle); devops-engineer 015-C (CODEOWNERS, PR44-SEC-08 class); principal-architect may correct the D-ARCH-124 "Why" |
| PR54-SEC-05 | D-TASK020-94 residual rating: the in-statement detector is a sufficient backstop for a function body that leaves one of the four security keys session-level (next checkout, fail closed); it is not one for a re-scope inside the same transaction (the guard admits `set_config('app.org_id', $1, true)`; the lint `setter` form is the only control) or for other session settings (`search_path` changed through PR54-SEC-01 stayed on the backend; neither the detector nor the integrity monitor reads session values) | INFO | CWE-488 | A01 | `with-tenant-tx.ts` context statement; `session-integrity.ts` | principal-architect / senior-developer: optional hardening at the next `with-tenant-tx.ts` edit (pin `search_path` transaction-locally in the context statement) |
| PR54-SEC-06 | The classifier is quadratic in nested setter calls (`callArguments` re-scans per level): 8,000 levels 3.9 s (lint) / 6.1 s (run time), 32,000 levels 77 s / 101 s; and the continuation regex a fix will need must be the unambiguous form (the obvious one is exponential in a run of dashes). Input is static source text, never request data | INFO | CWE-407 | A04 | `raw-sql-lexer.mjs:231-250`; `raw-statement.ts:195-211` | senior-developer, with C1 |

## 4. Finding details

### PR54-SEC-01 (LOW): the twins and PostgreSQL disagree on the text, fail-open

**Description.** Both twins tokenise the template text to find the first keyword of every statement and the anywhere-forms (`rawStatement`, TenantDb guard), and the identifiers (`rawSystemTable`). The run-time twin also builds that text itself (`strings.join(' $1 ')`). Five disagreements with what PostgreSQL 18 parses make the twins see a comment or a string where the server sees code:

| | Twins | PostgreSQL 18 / Prisma 7 |
|---|---|---|
| (a) | a `--` comment ends at LF only (`raw-sql-lexer.mjs:114-116`, `raw-statement.ts:160-162`) | `comment ("--"{non_newline}*)`, `non_newline [^\n\r]`: ends at CR too (code review R1-M1) |
| (b) | `SPACE = /\s/u` (Unicode spaces) is tested before `WORD_START` (`:29`, `:46`) | `space [ \t\n\r\f\v]`; every byte >= 0x80 is `ident_start`/`ident_cont`, so `<NBSP>$q$` is one identifier (code review R1-M1) |
| (c) | after `E'…'` closes, a following `'…'` is a new standard string (`:151`, `:139`) | `'…'` + white space with a newline + `'…'` continues the SAME literal (`xqs` returns to `xe`), so `\'` is still an escaped quote |
| (d) | template parts joined with `' $1 '` (`:180-182`, `:264-268`) | Prisma's `Sql#text` is `strings[0] + '$1' + strings[1] + '$2' …` with no spaces, so `$q${v}$q$` is the dollar-quoted string `1` for the server and `$`, `q`, `$1`, then an opening `$q$` for the twins |
| (e) | `set_config(<any name>, …, true)` admitted (D-TASK020-80) | `standard_conforming_strings = off` for the rest of the transaction makes `\'` an escape in plain strings (`backslash_quote` default `safe_encoding` admits it in UTF8); the migration linter refuses the name anywhere (rule 20, PR43-SEC-06 a), the twins do not |

**Exploitability and impact.** Every refused form gets through. The probes ran on PostgreSQL 18.6, through the head's real TenantDb guard and a real Prisma 7 interactive transaction (`pgprobe.mjs`, `pgprobe2.mjs`). Each probe type was set up differently:
- **COMMIT rows:** the callback inserts a row, sends the text, then throws, so Prisma rolls back. A row that is still there afterwards means the hidden `COMMIT` ran.
- **SET rows:** the transaction commits normally, and `search_path` is then read on the same pooled connection.
- **Table rows:** the query result is returned.

| Probe | Template text (what the tag delivers) | Guard | Server effect |
|---|---|---|---|
| C0 control | `SELECT 1` | admitted | row rolled back (rollback works) |
| K1, K5 controls | `COMMIT`; `SELECT 1 -- x<LF>; COMMIT` | REFUSED (transaction-control) | row rolled back |
| P1 (a) | `SELECT 1 -- x<CR>; COMMIT` | admitted | **row committed despite the rollback** |
| P1b (a) | `-- x<CR>COMMIT` (one statement) | admitted | **row committed** |
| P2 (c) | `SELECT E'a'<LF>'\' ; ' ; COMMIT ; SELECT ' -- '` | admitted | **row committed** |
| P6 (e) | after `SELECT set_config('standard_conforming_strings', 'off', true)`: `SELECT 'x\' ; ' ; COMMIT ; SELECT ' -- '` | admitted (both) | **row committed**; control P6c (same string, setting untouched): the server rejects the text, row rolled back |
| P2c (c) | `SELECT E'a' -- c<LF>  '\' ; ' ; COMMIT ; SELECT ' -- '` (continuation across a comment line) | admitted | **row committed** |
| U-NBSP, U-BOM, U-U+3000, U-U+2028 (b) | `SELECT 1 AS <sp>$q$; COMMIT; SELECT 1 AS <sp>$q$` with that space (`pgprobe2.mjs`) | admitted (all four) | **row committed** (all four); for PostgreSQL `<sp>$q$` is one identifier |
| K4, K3 controls | `SET search_path TO public, pg_catalog`; setter with `false` | REFUSED | `search_path` unchanged |
| P3, P3b (a) | `SELECT 1 -- x<CR>; SET search_path TO public, pg_catalog`; `-- x<CR>SET …` | admitted | **session `search_path` changed and still changed on the pooled backend after the transaction** |
| P4 (d) | `SELECT $q${v}$q$::text AS a, $1::text AS b, set_config('search_path', 'public, pg_catalog', false) AS c -- $q$` (one bind value) | admitted | **session `search_path` changed** |
| P5 (c) | `SELECT E'a'<LF>'\', ' AS s, ${v}::text AS v, set_config('search_path', …, false) AS c, ' -- '` | admitted | **session `search_path` changed** |
| T0 control | `SELECT (SELECT count(*)::int FROM audit_entries) AS n` | admitted (lint reports `rawSystemTable`) | n = 3 |
| P7a (d), P7b (a), P7c (c) | the SYSTEM-table subquery inside the same three disguises | admitted | n = 3; **lint-clean** (S9, S10, S11 in §5.1) |

The lint twin is equally blind (twin probe: all 21 shape rows ALLOWED by both twins, all 7 controls refused or found by both). With the full repository config, the `rawStatement` shapes T2, T3, T4, T10 and the `rawSystemTable` shapes S9, S10, S11 lint clean in an api repository file (§5.1). The setter text itself is still caught by `platform/tenant-context-sql`'s `setter` form in source (T7). So (e) and the setter rows are run-time-only gaps, while every `COMMIT` / `SET` / table-name row is a gap in both layers.

Impact of a successful bypass is the PR44-SEC-05 impact the control exists for. An early `COMMIT` ends the read-only `load` transaction or separates the handler's writes from their audit entry: a business change committed without its entry, against the O4 guardrail. Everything after it runs in autocommit, without the tenant context. A session `SET` survives on the pooled backend for later requests; the leak detector watches only the four `app.*` keys. A SYSTEM table is read from a module that does not own it, and D-ARCH-124 says the lint is the only control there. Likelihood is low. Every shape is deliberate: a CR escape inside a SQL comment, an `E'…'` string followed by a newline and a second string, `$q${v}$q$`, an invisible Unicode space. The refused keyword stays visible to a reviewer, and the stated residuals (SQL text in a string) already give a deliberate author other routes. Medium impact × low likelihood = LOW. It is a condition anyway, because the fix is cheap and the PR's own deliverable is this control (§10).

**Remediation (both twins, code level).** Validated on a patched copy of the lint twin (`fixcheck.mjs`, `fixcheck2.mjs`). The corpus is unchanged at 73/73, every bypass shape above is refused, and 0 of the 96 real raw templates change verdict.

```js
// (a) a line comment ends at the first LF or CR
} else if (ch === '-' && next === '-') {
  const end = text.slice(i).search(/[\n\r]/u);
  i = end === -1 ? text.length : i + end + 1;
// (b) PostgreSQL's white space only; every other character >= U+0080 is an identifier character (WORD_START/WORD_PART)
const SPACE = /[ \t\n\r\f\v]/u;
// (c) in readString, at a closing quote that is not doubled: follow a quote continuation and keep the mode.
//     Unambiguous form only (see PR54-SEC-06): a comment always runs to the newline.
const CONTINUATION = /^[ \t\f\v]*(?:--[^\n\r]*)?[\n\r](?:[ \t\n\r\f\v]|--[^\n\r]*[\n\r])*'/u;
//   if (text[i + 1] !== "'") { const more = CONTINUATION.exec(text.slice(i + 1));
//     if (more === null) return { value, end: i + 1 }; i += more[0].length; continue; }
// (d) render exactly what Prisma sends (Sql#text)
const prismaText = (strings) => strings.reduce((text, part, index) => (index === 0 ? part : `${text}$${index}${part}`), '');
// (e) refuse the string-syntax settings anywhere (rule-20 parity), or narrow the literal-true setter to a literal name
//     on an allow-list (lock_timeout, statement_timeout)
if (statement.some((token) => /^(?:standard_conforming_strings|backslash_quote)$/u.test(token.value))) return refusal;
```

Code review R1-M1's alternative for (b) is also acceptable: report any character >= U+0080 outside strings and quoted identifiers as `unreadable`.

**Verification tests.**
- Corpus cases at TEMPLATE level (strings arrays) for (a)-(e) in both suites, so that the join is pinned too. The current corpus feeds rendered text and never exercises `refusedRawStatement`'s join.
- A `rawSystemTable` fixture with the CR and the continuation forms.
- One PostgreSQL 18 integration case per (a) and (c) next to the existing `route-phases.int` COMMIT case: 5xx, no phase run, 0 rows.
- Mutants that restore `\s`, the LF-only comment end, the `' $1 '` join and the missing continuation must each fail a test.

### PR54-SEC-02 (LOW): session state and identifier-free readers outside the deny-list

**Description.** Both headers say the twins refuse what "changes the pooled session". The refused first keywords are `set reset discard listen unlisten notify load execute deallocate` (plus the transaction-control list and `do`). PostgreSQL has more session state than that, and more ways to read a table than naming it.

**Exploitability and impact** (`pgprobe.mjs`, through the real guard):
- **P9:** `DECLARE leak CURSOR WITH HOLD FOR SELECT org, v FROM public.t_rls` in a transaction with `app.org_id = 'A'` was admitted. The next transaction on the same backend, with `app.org_id = 'B'`, ran `FETCH ALL FROM leak` (admitted) and got `[{"org":"A","v":"a-only"}]`, while `SELECT … FROM t_rls` there returned only B's row. The held portal was materialised under A's RLS context and outlives the commit. Lint: clean (T6).
- **Session advisory locks.** `pg_advisory_lock(…)` and `pg_try_advisory_lock(…)`, and their `_shared` forms, are held until the backend closes, which is a cross-request lock leak on the pool (by reasoning; the code review probed the twins).
- **P12, P12b:** `SELECT database_to_xml(true, true, '')` and `table_to_xml('audit_entries', true, false, '')` return the SYSTEM table's rows. The first names no table at all; `schema_to_xml` names only the schema. Lint: clean (S13, S14). The migration linter already treats `query_to_xml*`, `ts_stat` and `ts_rewrite` as dynamic SQL (rule 16, PR43-SEC-06 b); the twins do not.
- **P10:** `ALTER ROLE CURRENT_USER SET statement_timeout = 0` from a non-superuser was admitted at run time and written to `pg_db_role_setting`. Lint `platform/no-alter-role-sql` reports it (T5), and the session-integrity monitor raises `db_role_setting_drift` within one interval. Defence in depth only.

The risk is the same deliberate class as PR54-SEC-01, with one difference that matters for the rating: a held cursor is also a design a developer might reach for ("continue the export on the next request"). On a pool, that reads another tenant's rows. Impact high, likelihood low (insider-only or an unusual design), and the attacker already has easier channels (a module-level variable), so LOW.

**Remediation.** C2, which is code review R1-m3, decided as "refuse":
1. Add `declare`, `fetch`, `move` and `close` to the session first keywords in both twins.
2. Add the session advisory-lock names as an anywhere-form, like the setter: `pg_advisory_lock`, `pg_advisory_lock_shared`, `pg_try_advisory_lock`, `pg_try_advisory_lock_shared`. The `_xact_` forms stay legal.

Follow-up, before TASK-073: add the reader family as an anywhere-form in both twins, or state it word for word in both headers and in the corpus as `residual`: `query_to_xml`, `query_to_xmlschema`, `query_to_xml_and_xmlschema`, `table_to_xml*`, `schema_to_xml*`, `database_to_xml*`, `cursor_to_xml*`, `ts_stat`, `ts_rewrite`. Add `alter` as a first keyword at run time.

Preferred, and validated (`fixcheck.mjs` variant F5): replace the deny-list with an allow-list of first keywords, `select with insert update delete merge values table (`, plus the exact read-only allowance, and refuse more than one statement per raw call.
- Over the 96 real templates, that variant refuses nothing new. Its only corpus changes are the two intended ones (`INSERT …; SELECT 2;` and the `CALL` residual) and the form labels of already-refused cases.
- Prisma already sends one statement whenever a value is bound.

**Verification tests.**
- Corpus rows for `DECLARE … WITH HOLD`, `FETCH ALL FROM c`, `CLOSE ALL` and `SELECT pg_advisory_lock($1)`, each refused.
- `pg_advisory_xact_lock($1)` stays ok.
- A PostgreSQL 18 integration case: `DECLARE … WITH HOLD` through TenantDb answers 500 and leaves no cursor (`pg_cursors` is empty).

### PR54-SEC-03 (LOW): built-in loaders through the dynamic `node:module` import and through `process`

**Description and probe** (lint probe, full config, api module file; the merge base is clean for all of them too):
- **M22-M26** (= code review R1-m1): `(await import('node:module')).Module._load('pg')`, `m.register(…)`, `const { default: M } = await import('node:module'); M._load(…)` (also in the worker `platform/db`) and `M[k](import.meta.url)('pg')` are all CLEAN. D-TASK020-89 makes "a static member read" of the dynamic import legal, and `no-restricted-imports` does not see `import()`.
- **M7, M17, M10, M14:** `p['getBuiltin' + 'Module']('module')`, `process[name]` with a `const` name, `Reflect.get(process, 'getBuiltinModule')` and `Object.getOwnPropertyDescriptor(process, 'getBuiltinModule')?.value` are CLEAN. `no-restricted-properties` matches static names only.
- **M18, M19:** `globalThis.process.binding('fs')` and `const p = process; p.binding('fs')` are CLEAN, because `binding` / `_linkedBinding` are object-scoped to the identifier `process`.
- The closed forms are in §5.3.

**Impact.** `Module._load('pg')` or `createRequire(url)('pg')` builds a root `pg` pool, or loads the generated client, from module code. That leaves the tenant transaction and every import control: the PR44-SEC-01 impact, reached by a deliberate respelling, so LOW. This is the same rating as PR44-SEC-10.

**Remediation.**
- In `checkModuleValue`, `checkPattern` and the `.then` parameter, bound every `node:module` value by `NODE_MODULE_ALLOWED`, so that a static key other than `createRequire`, `builtinModules` or `isBuiltin` (`default`, `Module`, `register`, `registerHooks`, `_load`) is `loader`. This is the code review's R1-m1 fix.
- Report a computed member of `process` / `globalThis.process` whose key is not a static string, and `Reflect.get` / `Reflect.apply` / `Object.getOwnPropertyDescriptor` with `process` as the target. Make `binding` / `_linkedBinding` property-only, like `getBuiltinModule`.

**Verification test.** Fixtures M7, M10, M14, M17, M18, M19 and M22-M26 report, and a mutant restoring the static-member allowance fails `negative-fixtures`.

### PR54-SEC-04 (INFO): coverage statements wider than the code

- **Fragments.** `` db.$queryRaw`${Prisma.sql`SELECT count(*) FROM audit_entries`}` `` (S12) and `` db.$executeRaw`${Prisma.sql`COMMIT`}` `` (T8) lint clean: `db-raw-sql` lists tagged `Prisma.sql` fragments and `Prisma.join(ids)` as legal, and both checks read only the `$queryRaw` / `$executeRaw` template. The TenantDb guard refuses every interpolated fragment at run time (P8, P8b: "interpolated Sql fragment"), so a module repository fails closed. D-ARCH-124's "Why" and `system-model-owner.mjs:29-30` should say "the TenantDb guard refuses fragments" rather than "`db-raw-sql` already refuses Sql fragments". The alternative is to read `sql`-tagged templates of a tracked Prisma import in both checks.
- **Scope.** `rawStatement` lints `apps/*/src` only (`eslint.config.mjs:991`). The audit store's raw SQL in `packages/audit/src` is covered by `rawSystemTable` and, at run time, by the guard (`AuditSqlPort` is the TenantDb), but not by the lint form (= code review R1-n3).
- **Ownership.** The shared corpus `tests/fixtures/sql/raw-statement-corpus.json` is the oracle of an owned control but is not CODEOWNED: deleting cases needs no security record. `apps/api/src/start-api.ts` is not CODEOWNED either (PR44-SEC-08 widened). Route both to devops 015-C.

### PR54-SEC-05 (INFO): D-TASK020-94, how far the detector backs up the function-body residual

The test change is right (code review §3 item 6 agrees). It first asserts that the guard refuses the session setter, with no leak counted and the next tenant seeing only its own rows. Then it plants through a migrator-created function, which is the guard's stated residual, so the detector keeps a live end-to-end test. The function exists only in the suite's clone setup SQL. The file's exact-file `tenant-context-sql` exemption is unchanged.

Rating of the residual "a function body that commits or sets":
- **Creation.** The runtime roles cannot create functions (`00-roles.sql:51` revokes ALL on the database from PUBLIC; there is no schema CREATE). In `prisma/migrations`, rule 16 refuses every tenant-context write form, function and DO bodies included. `prisma/bootstrap` is a CODEOWNED review lane. A real migration cannot ship `rls_leak_plant` lint-clean.
- **Detector.** If such a body still runs, the context statement reads the four keys' prior values in the same statement that sets the new ones. A non-empty value means 500 `DB_SESSION_CONTEXT_LEAK`, a security event, and the process marked not-ready until restart. That fails closed on the next checkout of that backend, before any query of the next request.
- **Not covered:**
  1. A re-scope inside the same transaction. The guard admits `set_config('app.org_id', $1, true)` (P14 switched the transaction to tenant B's rows), and a function body can do the same. The source control is the lint `setter` / `keys` forms, plus rule 16 for bodies.
  2. Session settings other than the four keys. P3, P4 and P5 left `search_path` changed on the backend, and neither the detector nor the integrity monitor, which reads `pg_db_role_setting` only, sees that.

Rated INFO: (1) is T-35's accepted control (the setter only in `withTenantTx`, enforced by `tenant-context-sql`, plus rule 16), and (2) needs a PR54-SEC-01 bypass or a reviewed DDL lane. Optional hardening at the next `with-tenant-tx.ts` edit: add `set_config('search_path', 'pg_catalog, public', true)` to the context statement, or read `current_setting('search_path')` into `prev` and treat a mismatch with the role default as a leak.

### PR54-SEC-06 (INFO): linear time

The input is static template text from source; a request never reaches it. Most shapes scale linearly up to 563 KiB: strings, dollar quotes, bare `$`, nested comments, many statements, E-strings, each under 40 ms in both twins. The exception is nested setter calls, `set_config('a', ` × N … `, true)` × N, where `callArguments` re-scans the rest of the call at each level:

| N | Lint twin | Run-time twin |
|---|---|---|
| 2,000 (45 KiB) | 0.17 s | 0.21 s |
| 8,000 (180 KiB) | 3.9 s | 6.1 s |
| 32,000 (719 KiB) | 77 s | 101 s |

That is a lint-time or developer DoS only; the fix is one pass with a parenthesis stack. The continuation regex that C1 adds must be the unambiguous form shown in §4. The obvious `^(?:[ \t\f\v]|--[^\n\r]*)*[\n\r]…` is exponential in a run of dashes: 28 dashes take 2.6 ms, growing about ×3 per 2 more. The unambiguous form takes 0.6 ms on 200,000 dashes, and both pass the same four positive and negative controls.

## 5. Carried items

### 5.1 PR32-SEC-07 (c) / D-ARCH-124 / D-SEC-PR43-03: `rawSystemTable`

| Case (api `orders` repository unless noted) | Head | Merge base |
|---|---|---|
| S1 `SELECT count(*) FROM audit_entries WHERE id = ${v}` | `rawSystemTable` | clean |
| S2 `"audit_entries"`, S3 `PUBLIC.AUDIT_ENTRIES`, S4 `"public"."audit_entries"`, S5 `audit_entries_2026_11`, S6 CTE alias, S7 `/* x */ audit_entries -- y` | `rawSystemTable` (each) | clean |
| S8 the same statement in `apps/api/src/modules/audit/repository/` | clean (owner) | clean |
| S9 CR comment, S10 `E'…'` continuation, S11 `$q${v}$q$` | **clean** (PR54-SEC-01) | clean |
| S12 `Prisma.sql` fragment | **clean** (PR54-SEC-04; run time refuses) | clean |
| S13 `database_to_xml`, S14 `table_to_xml('audit_entries', …)` | **clean** (PR54-SEC-02 b) | clean |
| S15 `query_to_xml($$select * from audit_entries$$, …)` | clean (stated residual, D-TASK020-78) | clean |

The rule is right for the plain forms: manifest-driven, fail closed on a missing manifest (`manifest`) and on an unreadable template (`rawUnreadable`), the D-ARCH-124 owner map verbatim (D-TASK020-79), and the partition mapping. **Closed** for the plain forms. The residuals are PR54-SEC-01 (C1), PR54-SEC-02 (b) and PR54-SEC-04.

### 5.2 PR44-SEC-05 and the D-SEC-PR42-02 020-D note

Lint: T1 `COMMIT` and T9 `UPDATE pg_settings SET setting = ${v} WHERE name = 'search_path'` report `rawStatement` (the merge base is clean for both). T5 `ALTER ROLE` reports `no-alter-role-sql`, and T7 (the string-syntax setter) reports `tenant-context-sql:setter`. Run time, on PostgreSQL 18.6 through real Prisma:
- K1, K5, K4 and K3 are refused before anything reaches the server.
- P8 and P8b (interpolated `Prisma.sql` / `Prisma.join`) are refused.
- P13 (`$queryRawUnsafe`) is refused ("TenantDb does not expose $queryRawUnsafe").
- The refusal message names the form and keyword only, never statement text or values (D-TASK020-82).

`DO` is refused outright and the setter needs a literal `true`, so the D-SEC-PR42-02 note is closed. PR44-SEC-05 is **closed for every plain, commented and literal-wrapped form**. The fail-open lexer differentials are PR54-SEC-01 (C1), and the omitted session forms are PR54-SEC-02 (C2).

### 5.3 PR44-SEC-10, -11, -14 (lint part)

| Case (api `orders` service) | Head | Merge base |
|---|---|---|
| M3 ``m[`createRequire`](url)('pg')``, M4 ``{ [`createRequire`]: c }``, M5 `m[k]` | `loader` | **clean** |
| M2 `const r = createRequire(url); r('pg')`, M12 re-export, M13 `.then(m => m.createRequire…)` | `loader` | `loader` |
| M6 `process.getBuiltinModule('module').createRequire…` | `loader` + `restrictedProperty` | `loader` |
| M8 `globalThis['proc'+'ess'].getBuiltinModule`, M9 ``process[`getBuiltinModule`]``, M16 destructured from `globalThis.process` | `restrictedProperty` | **clean** |
| M11 `import x = require('node:module')` | `no-require-imports` + `loader` | **CRASH** |
| C1 module-level holder alias, C2 `import q = require('bullmq')` in a tenant transaction, C3 `import X = NS.y` | reported / no crash | **CRASH** (all three) |
| C4 destructured holder method, C5 `{ promises }` of a timer `import()` | `external` / `sleep` | clean |
| M15 `createRequire(url).resolve('pg')` (positive control) | clean | clean |
| M7, M10, M14, M17, M18, M19, M22-M26 | **clean** (PR54-SEC-03) | clean |
| C6 `globalThis['set' + 'Timeout']` in a tenant transaction | clean (PR44-SEC-04 residual class) | clean |

PR44-SEC-10 is **closed**: template-literal and computed keys on a `node:module` value now fail closed. PR44-SEC-11 is **closed**: the four former crashes now report, so the rule fails closed without hiding findings. PR44-SEC-14's lint part is **closed** for static imports, `getBuiltinModule` / `dlopen` under static keys, and the timer forms. The open forms move to PR54-SEC-03, so D-TASK020-86's "`Module`/`Module._load` and `register` (config)" holds for static imports only (the code review does not accept D-TASK020-86 as written, and I agree).

## 6. D-TASK020-78..94, security view

| Decision | Ruling |
|---|---|
| 78 identifiers only; residual SQL in strings | Accepted. Extend the stated residual (or refuse) per PR54-SEC-02 (b): `table_to_xml('t'…)` names a table in a string and `database_to_xml` / `schema_to_xml` name none |
| 79 `audit` owner globs | Accepted |
| 80 forms, `PREPARE`, exact-file read-only allowance, literal-`true` setter | Accepted with PR54-SEC-01 (e) and PR54-SEC-02 (a). `SET TRANSACTION READ WRITE` in the allowed file is still reported (fixture) |
| 81 two twins, one corpus | Accepted. The twins agree with each other (the code review's 200,000-text fuzz) but not with PostgreSQL. The corpus needs template-level cases and a CODEOWNERS line (PR54-SEC-04) |
| 82 error text without statement or values | Accepted (P-series messages checked) |
| 83, 84 built-in loaders, SEC-14 sources | Accepted for static imports; PR54-SEC-03 |
| 85 T-83 alias scope widened | Accepted (stricter) |
| 86 D-TASK020-59 residual status | Not accepted as written (PR54-SEC-03, code review R1-m1) |
| 87, 88 | Accepted (not security) |
| 89 strictness split | Accepted once the static key is bounded by `NODE_MODULE_ALLOWED` (PR54-SEC-03) |
| 90, 91 | Accepted; PR44-SEC-09 stays INFO with the next lint-lock holder |
| 92 R3-n3 fix shape | Accepted (M11, C2, C3) |
| 93 outage residue | Noted; the committed lexer is the reviewed one |
| 94 leak planted through a function body | Accepted; residual rated in PR54-SEC-05 |

## 7. Threat-model and requirement trace

- **Tenant isolation (O3; T-35 raw SQL changing the GUCs; the F-04 session-leak hazard, ADR-0005 am. 10 item 16).** The plain forms hold. PR54-SEC-01 and -02 (a) are cross-request carry-over paths that need crafted source, and P9 is the one cross-tenant read observed. Both are closed by C1 and C2.
- **Audit completeness (O4).** An early `COMMIT` separates a business write from its entry. The plain form is refused; the crafted forms are C1.
- **SYSTEM tables (D-ARCH-124).** The lint is the only control. Plain names hold; disguises are C1, readers are PR54-SEC-02 (b).
- **Proposed SEC-TC** (for the next threat-model text round, owner security-analyst): "a raw template that the TenantDb guard admits is executed by PostgreSQL 18 with the same statement boundaries and identifiers that the guard read". Evidence: the corpus at template level plus one PostgreSQL integration case per lexer rule (C1 verification tests).

## 8. Evidence and evidence hygiene

- **Lane B run `20261115T1641Z_f01e470`** (`summary.md` at `3efa2df`): profile `pr`, verdict PASS; api 128, catalog-c1-c14 102, integration 316, rls-cross-tenant 126 (0 failures, 0 skips), unit 6092 (2 skipped); merged coverage 99.02 % lines / 97.02 % branches; US-006 merged gate PASS. It is bound to the code head `f01e470`, and the evidence commit `3efa2df` (parent `f01e470`) adds only the 8 run files. Lane A's "Lane B evidence" step accepted it.
- **D-SEC-PR23-02.** The PR's gate table carries the statements verbatim: "`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first" and "`.git/info/exclude` is empty" (0 bytes, logged before the run). No `wave` or `gate` run is committed. The PR is not a lockfile PR (`package-lock.json` unchanged), so the lockfile statements do not apply.
- **Host-fragment scan** (count-only, needles computed at run time: user name, its 8.3 stem, home, temp dir in both slash forms, the MSYS home form, host name, git e-mail): **0** in each of the 8 run files, 0 over the whole PR diff `3e2da8b...3efa2df`, and 0 over the 15 commit messages. A synthetic positive control counted 4.
- **Lane A** run 43739100307: Gitleaks over the PR commit range `success`; Semgrep `success`; the base-ref negative fixtures against the head configs `success`.
- Earlier failed runs (`20261115T0637Z_4704eaa`, `…1417Z_ac3d7cb`, `…1457Z_34386bf`) are kept untracked in their evidence worktrees, not committed, which is correct.
- **The C1/C2 fix cycle changes owned paths**, so it voids this record (§12 S2). Round 2 needs fresh lane-B evidence on the fix head with the same statements.

## 9. Alignment with the code review (`a1db134`, CHANGES_REQUESTED)

| Code review | This record |
|---|---|
| R1-M1 (CR comment end; Unicode white space) | PR54-SEC-01 (a)(b); C1 adds (c)(d)(e), which the review did not find. Its PGlite (PostgreSQL 17.5) proof is consistent with my PostgreSQL 18.6 runs |
| R1-m1 (dynamic `node:module` static members; `process[k]`, `Reflect.get(process, …)`) | PR54-SEC-03 (also `getOwnPropertyDescriptor`, `binding` through `globalThis.process` / alias) |
| R1-m2 (corpus pins anywhere-forms only at the first occurrence) | Agreed. Not a security finding today (the code refuses both), but take it in the same cycle; C1's template-level cases sit in the same file |
| R1-m3 (WITH HOLD cursors, session advisory locks: "fixed or stated, at the security-analyst's choice") | **Choice: refuse** (C2 = PR54-SEC-02 (a)); proven cross-tenant on PostgreSQL 18 (P9) |
| R1-n3 (`rawStatement` scope) | PR54-SEC-04 |
| R1-n5 (`regclass` string) | PR54-SEC-02 (b) |
| §3 item 6 (D-TASK020-94 sound) | PR54-SEC-05 agrees and rates the residual |

## 10. Conditions and routing

**Conditions (PASS_WITH_CONDITIONS):** both are due in the fix cycle that code review R1-M1 already requires, before this PR merges. A security delta round 2 then re-runs `twins.mjs`, `lintprobe.mjs` (head versus `3efa2df` as the control) and the two PostgreSQL probes on the fix head.
- **C1, PR54-SEC-01 complete in both twins:** (a) CR, (b) PostgreSQL white space (or non-ASCII = `unreadable`), (c) quote continuation with the unambiguous regex, (d) Prisma's exact `$n` rendering in `templateText` / `refusedRawStatement`, (e) the string-syntax settings refused (or a literal-name allow-list for the literal-`true` setter). Add template-level corpus cases, a `rawSystemTable` fixture, PostgreSQL integration cases for (a) and (c), and the four mutants (§4).
- **C2, PR54-SEC-02 (a):** `declare`, `fetch`, `move` and `close` as session first keywords, and the session advisory-lock names as an anywhere-form, in both twins, with corpus rows and one PostgreSQL case. The first-keyword allow-list plus one statement per call (validated) satisfies C1 (e) and C2 in one step.

**Follow-ups:**
- PR54-SEC-02 (b)(c): before TASK-073's first raw statement.
- PR54-SEC-03: the same cycle as code review R1-m1, else before the first module or worker-job PR.
- PR54-SEC-04: the headers and scope in the cycle; CODEOWNERS for the corpus and `start-api.ts` with devops 015-C.
- PR54-SEC-05: optional, at the next `with-tenant-tx.ts` edit.
- PR54-SEC-06: with C1.

**Merge rules:** the C1/C2 commits void this record (owned paths), so round 2 is required anyway. A docs-only merge of `main` keeps it. A `main` change to one of the 55 owned paths that this PR also changes voids it (`eslint.config.mjs` and `tools/lint/negative-fixtures.test.ts` are the usual collisions with other lint PRs).

## 11. Proposed decision text (for the orchestrator to log)

**D-SEC-PR54-01 · 2026-11-15 · security-analyst · PR #54 (020-D) round 1 at `3efa2df`: PASS_WITH_CONDITIONS**
- **Decision.** 0 Critical/High/Medium; 3 LOW, 3 INFO. Closed: PR44-SEC-10 and PR44-SEC-11. PR44-SEC-05, D-ARCH-124 / PR32-SEC-07 (c) and the D-SEC-PR42-02 note are closed for every plain form, and PR44-SEC-14's lint part for static imports.
- **PR54-SEC-01 (LOW, CWE-436, = code R1-M1 widened)** — both lexer twins disagree with PostgreSQL 18 / Prisma 7 in five fail-open ways: CR ends `--`; Unicode spaces; `E'…'` continuation; the `' $1 '` join versus Prisma's `$1`; transaction-local `standard_conforming_strings` through the literal-`true` setter. On PostgreSQL 18.6 through the real guard, `COMMIT` committed a row the callback rolled back, a session `search_path` survived on the backend, and a SYSTEM table was read lint-clean.
- **PR54-SEC-02 (LOW, CWE-488)** — `DECLARE … WITH HOLD` read tenant A's rows under tenant B, and session advisory locks, the identifier-free readers (`database_to_xml` and family, `ts_stat`, `ts_rewrite`) and `ALTER ROLE` at run time are outside the deny-list.
- **PR54-SEC-03 (LOW, = code R1-m1 widened)** — the dynamic `node:module` members and computed or reflective `process` loaders are lint-clean.
- **INFO** — -04 (fragments and scope statements, corpus and `start-api.ts` not CODEOWNED); -05 (D-TASK020-94: the detector backs up the four keys across requests, not a same-transaction re-scope or other session settings); -06 (quadratic nested-setter classification; the continuation regex must be the unambiguous form).
- **Conditions, in code review R1-M1's fix cycle:**
  - C1: PR54-SEC-01 (a)-(e) in both twins, with template-level corpus cases, a `rawSystemTable` fixture, PostgreSQL cases for CR and continuation, and four mutants.
  - C2: PR54-SEC-02 (a), `declare` / `fetch` / `move` / `close` and session advisory locks refused (security choice for R1-m3).
  - Fix validated on a scratch copy: corpus 73/73 unchanged, every bypass refused, 0 of 96 real raw templates change verdict.
  - Then fresh lane-B evidence and a security delta round 2.
- **Follow-ups:**
  - PR54-SEC-02 (b)(c): before TASK-073's first raw statement.
  - PR54-SEC-03: same cycle as R1-m1, else before the first module or worker-job PR.
  - PR54-SEC-04: CODEOWNERS with devops 015-C; principal-architect may correct the D-ARCH-124 "Why" (the TenantDb guard, not `db-raw-sql`, refuses fragments).
  - PR54-SEC-05: optional, at the next `with-tenant-tx.ts` edit.
- **Threat model.** New SEC-TC proposed for the next text round: "a raw template the guard admits runs with the statement boundaries and identifiers the guard read".
- **Reversibility.** High.

## 12. Record simulation

`record-sim.mjs` ran `main`'s `tools/ci/check-security-owned-paths.mjs` (`--base origin/main --pr 54 --json`, `origin/main` = `7652ee2`) on plumbing scenario commits in a sparse `git clone --shared`. Nothing was pushed, and nothing was written to the PR worktree except this file. The candidate is LF, 0 CR bytes, with exactly one table row whose first cell starts with `Head` (the full head SHA) and exactly one `Verdict` row (the last line).

| Scenario | Checker | Expected |
|---|---|---|
| S0 control: the head without this record | missing ("no record named …PR-0054-*.md") | missing |
| S1 this record committed on `3efa2df` | pass | pass |
| S2 S1 + an owned change (`tools/eslint-rules/raw-sql-lexer.mjs`) | missing ("… changed after it") | missing |
| S3 S1 + a docs-only commit (`docs/sdlc/STATUS.md`) | pass | pass |
| S4 S1 + a merge of `main` `7652ee2` (docs, review records, agent notes) | pass | pass |
| S5 the Verdict cell set to FAIL | missing | missing |
| S6 the Head row naming a commit outside the range | missing | missing |
| S7 no Verdict row | missing | missing |
| S8 S1 + a change to the unowned corpus (PR54-SEC-04) | pass | pass (the gap) |
| S9 S1 + a change to the unowned `start-api.ts` (PR54-SEC-04) | pass | pass (the gap) |
| S10 only a record named for another PR | missing | missing |

11 of 11 as expected. A count-only scan of this file found 0 host fragments and 0 secret shapes (positive control 1).

| Field | Value |
|---|---|
| **Verdict** | **PASS_WITH_CONDITIONS.** 0 Critical, 0 High, 0 Medium; LOW PR54-SEC-01 (C1), PR54-SEC-02 ((a) = C2), PR54-SEC-03; INFO PR54-SEC-04, -05, -06. C1 and C2 are due in the fix cycle that code review R1-M1 requires, verified by a security delta round 2 on the fix head with fresh lane-B evidence |

# Round 2 (delta `3efa2df..a6fc0a3`)

| Field | Value |
|---|---|
| Delta | Fix cycle 1: code commits `485dcbb` (both twins, the corpus, the lint rules and fixtures) and `46ed1e4` (the C2 PostgreSQL 18 case); merge of `main` `c6c4961` (PR #53; `git show --remerge-diff c6c4961` is empty); evidence commit `f00cf5b` (8 added files under one run directory); code-review record `a6fc0a3` (docs only, `docs/05-quality/reviews/PR-0054-TASK-020D-code-review.md`). `origin/main` was `1128792` when this round was written; since `c6c4961` it moved by `DECISIONS.md` and `STATUS.md` only |
| Head | a6fc0a3b2ab0194d5be2e125bbda81c0f1ec2e50 |
| Code head | `c6c4961` (`git diff --name-only c6c4961 a6fc0a3` = the run directory and the code-review record) |
| Lane A evidence | Run 43807291356 on `f00cf5b`. **fast-lane `success`**, every step ran: workflow policy, install flags, released migrations, lockfile, cooldown, licences, signatures, audit, "Lane B evidence" (run `20261116T0440Z_c6c4961` accepted), commitlint, lint, format, actionlint, type-check, unit, the base-ref negative fixtures against the head configs, build. **scans**: Gitleaks (PR commit range), Semgrep and oasdiff `success`; the only red step is "Security-owned paths need a review record", and `ci-gate` is red only as the aggregate. `a6fc0a3` is docs-only |
| Lane B evidence | `20261116T0440Z_c6c4961`, profile `pr`, verdict PASS: api 128, catalog-c1-c14 102, integration 322 (316 at round 1, so the 6 new PostgreSQL 18 cases ran), rls-cross-tenant 126, unit 6286 (2 skipped), 0 failures; merged coverage 99.02 % lines / 97.02 % branches; US-006 merged gate PASS |
| Owned paths changed | 63 (main's `check-security-owned-paths.mjs`, base `origin/main`) |
| Binding items checked | D-SEC-PR54-01 conditions C1 (PR54-SEC-01 (a)-(e)) and C2 (PR54-SEC-02 (a)); PR54-SEC-03, -04, -06; D-TASK020-95..98; code review round 2 (`a6fc0a3`): R2-m1 (ruling requested), R2-n1, R2-n2 |
| Reviewer / date | security-analyst, 2026-11-17, round 2 (delta). Probes ran in the session scratchpad on `git show` copies of both twins at `f00cf5b` and at `3efa2df` (the positive control), type-stripped for the run-time twin, and on a `git archive` of the head's `apps packages prisma tests tools`. One short PostgreSQL 18.6 container (the integration suites' pinned digest, loopback port, random credentials never printed) ran as a non-superuser role without TEMPORARY and was removed. In the PR worktree I ran read-only git and a fetch, fast-forwarded it to `a6fc0a3`, and wrote and committed only this file. Line numbers come from single-file reads at `a6fc0a3` |

## R2.1 Summary

C1 and C2 are closed for every form that names the refused construct, in both twins. All 21 round-1 bypass rows now fail closed on both twins, while the same rows on the `3efa2df` copies are still admitted. The twins agree with each other on all 57 probe rows. I re-read PostgreSQL 18's `scan.l` rule by rule for what the delta changed: `space`, `newline`, `quotecontinue`, `xqs` entered from `xb`/`xh`/`xq`/`xe`/`xus`, `xqdouble` only in `xq`/`xe`/`xus`, nested `xcstart` with `yyless(2)`, the `dolqdelim` and `dolqfailed` rescans, `param`, `integer_junk`. Across 23 new hunt shapes I found no remaining lexer differential that fails open. Every shape either reads the same in both, or PostgreSQL rejects the whole string. The code review reached the same result independently: 55 PGlite probes and a 300,000-text twin fuzz. PR54-SEC-03 and PR54-SEC-06 are closed, and the PR54-SEC-04 scope and header items are closed.

What remains is the stated residual "SQL text inside a string literal" (corpus line 38). Code review R2-m1 showed that it carries the session setter and the session advisory lock. On PostgreSQL 18.6 it also carries **`COMMIT`**. One raw call changes `standard_conforming_strings` for the rest of the transaction: the name is split inside a `query_to_xml` string, so no token holds the refused name. The next raw call then hides `COMMIT` in a string that the twins read with the setting on. A row the callback inserted survived the rollback (§R2.4, X1). That reopens the impact C1 (e) closed: a business write separated from its audit entry, against O4. The fix is two lines per twin and is validated: 0 of 155 real raw templates change verdict. So I rule R2-m1 **fixed in this PR** as condition C3 (PR54-SEC-07). `pg_notify` (R2-n2) goes into the same change (PR54-SEC-08).

Declining F5 (the first-keyword allow-list) is **accepted** (§R2.5). None of the remaining paths is a first-keyword problem, so F5 would not have closed X1-X5.

Findings this round: 0 Critical, 0 High, 0 Medium, 1 LOW (PR54-SEC-07, C3), 1 INFO (PR54-SEC-08).

**Verdict: PASS_WITH_CONDITIONS** (C3 before merge; round 3 is a delta of the twins and the corpus with fresh lane-B evidence).

## R2.2 Method

1. Read the delta `3efa2df..f00cf5b` of both twins, `db-raw-sql.mjs`, `system-model-owner.mjs`, `module-sources.mjs`, `static-module-specifier.mjs` (the PR54-SEC-03 part), `no-external-calls-in-tenant-tx.mjs`, the `eslint.config.mjs` diff, the corpus, the new fixtures and the `route-phases.int.test.ts` cases. Also read D-TASK020-95..98 and the code review round 2.
2. **scan.l facts** from `REL_18_STABLE` `src/backend/parser/scan.l`, fetched for this round (the rules listed in §R2.1).
3. **Twin probe** (`twins.mjs`): both twins at the head and at `3efa2df` through their real entry points (`refusedRawStatement(frozen strings)` and `refusedStatement(templateText(strings))`). It covered 57 rows: 5 controls, 29 round-1 bypass and C2 rows, and 23 new hunt shapes. The hunt shapes were B/X strings with doubled quotes, `/*/`, `/**/` and nested comments inside comments, `$1$q$`, `a$q$`, `'a'e'…'`, `$e'…'`, VT/FF, NUL, non-ASCII and astral characters after an `E` backslash, the dynamic-SQL executors, `pg_notify`, `CREATE TEMP`, `SELECT INTO TEMP`, and `EXPLAIN ANALYZE DECLARE`. Special characters were built at run time.
4. **PostgreSQL 18.6 probe** (`pgprobe.mjs`). Each text is first passed through the head run-time twin. If admitted, it is sent with the simple protocol and no values, which is what Prisma's raw calls send through adapter-pg when nothing is bound (round-1 fact). The caller is a role with CONNECT only (`REVOKE ALL ON DATABASE … FROM PUBLIC`, as `00-roles.sql:51`) and role default `search_path = pg_catalog, public`.
   - COMMIT rows: insert, then send the texts, then ROLLBACK, then count.
   - Session rows: commit normally, then read the same backend.
5. **Linear time** (`timing.mjs`) at 2,000, 8,000 and 32,000 units over five shapes, head against `3efa2df`.
6. **Fix validation** (`fixcheck.mjs`). One exact-string patch on a scratch copy of the head lint twin, run over the shared corpus (132 entries), every tagged `$queryRaw` / `$executeRaw` template of the head tree (155 templates in 1,027 files, production and tests, parsed with `typescript-estree`), and the round-2 shapes.
7. Evidence: the lane A step list (`gh run view --json jobs`), the run's `summary.md`, the PR body's gate table, and a count-only host-fragment scan with a positive control. Then the record simulation (§R2.10).

## R2.3 Round-1 items

| Item | Status | Evidence |
|---|---|---|
| C1 (a) `--` ends at CR | **Closed** | `LINE_END = /[\n\r]/gu` in both twins (`raw-sql-lexer.mjs:45`, `raw-statement.ts:56`). P1, P1b, P3: head refuses with both twins, `3efa2df` admits. The CR row is in `route-phases.int` with a PostgreSQL commit control; dev mutant log 2/2 killed |
| C1 (b) Unicode white space | **Closed** | `SPACE = /[ \t\n\r\f\v]/u`; non-ASCII outside a string, quoted identifier or comment is `unreadable`; dollar tags are ASCII only (D-TASK020-95, accepted: stricter than PostgreSQL, and no ASCII identifier boundary differs from `ident_start` / `ident_cont`). NBSP, BOM, U+3000 and U+2028 rows: `unreadable` |
| C1 (c) quote continuation | **Closed** | `CONTINUATION` (`raw-sql-lexer.mjs:50`, `raw-statement.ts:58`) is language-equal to scan.l `{whitespace_with_newline}{quote}`: `non_newline_whitespace*` reduces to `[ \t\f\v]*(--[^\n\r]*)?`, then `special_whitespace*`, with no block comments. It is applied after every unpaired closing quote of every quote state, including B, X, N and U&, and it keeps the mode. P2, P2c, P2d and U& continuation: refused. Linear: §R2.6 |
| C1 (d) Prisma rendering | **Closed** | `templateText` and `prismaText` both produce `part$1part$2…`. P4, P4b and P5 (template rows): refused; template-level corpus rows in both suites |
| C1 (e) string-syntax settings | **Closed for every form that names the setting.** The dynamic-SQL route is PR54-SEC-07 | Literal-name allow-list for the literal-`true` setter, and `standard_conforming_strings` / `backslash_quote` in any token (D-TASK020-96). Rows P6, P6b-f refused, including `ALTER ROLE … SET`, `UPDATE pg_settings`, a concatenated name, and mixed case. X1 shows the split name inside `query_to_xml` |
| C2 cursors and session advisory locks | **Closed for the literal spellings.** The dynamic-SQL route is PR54-SEC-07 | `declare` / `fetch` / `move` / `close` in `SESSION`; `SESSION_LOCK` anywhere (word or quoted, qualified, case-folded); `_xact_` stays legal (K6). PostgreSQL 18 case (D-TASK020-97, accepted): if the guard admitted the text, the load would finish and the call phase would run, and the control proves PostgreSQL keeps both forms after COMMIT, so the assertion is not vacuous |
| PR54-SEC-02 (b) readers, (c) runtime `ALTER` | Open, follow-up (unchanged due point) | The SQL-executing members of (b) move to PR54-SEC-07 (C3). The readers that build their own query (`table_to_xml*`, `schema_to_xml*`, `database_to_xml*`, `cursor_to_xml*`) and `alter` as a run-time first keyword stay due before TASK-073's first raw statement |
| PR54-SEC-03 loaders | **Closed** | `NODE_MODULE_ALLOWED` is shared by `no-restricted-imports` and `static-module-specifier`; `processMember` covers the respellings; `binding` / `_linkedBinding` are matched on any object. The new fixtures `bad-node-module-members.ts`, `bad-process-respellings.ts` and `ok-node-module-allowed.ts` cover M7, M10, M14, M17-M19 and M22-M26 plus allowed controls. Lane A lint and negative fixtures are green, and the code review probed the same forms with the full config (R2.1). I did not re-run ESLint |
| PR54-SEC-04 | **Closed** in code and headers (`only: ['statement']` on `packages/*/src`; D-ARCH-131 corrected the "Why") | CODEOWNERS for the corpus and `start-api.ts` stays with devops 015-C |
| PR54-SEC-05 | INFO, unchanged | Optional hardening at the next `with-tenant-tx.ts` edit. X2 and X3 are further reasons to pin `search_path` transaction-locally |
| PR54-SEC-06 | **Closed** | §R2.6 |

## R2.4 Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR54-SEC-07 | The stated "SQL text in a string" residual carries every refused form except a direct `COMMIT`. `query_to_xml`, `query_to_xmlschema`, `query_to_xml_and_xmlschema`, `ts_stat` and `ts_rewrite` run SQL text through SPI. On PostgreSQL 18.6, through texts both twins admit: a transaction-local `standard_conforming_strings = off` (split name) followed by a second raw call COMMITTED a rolled-back row; a session `search_path` survived COMMIT (two executors); and a session advisory lock stayed held. This is code review R2-m1, widened by the COMMIT route | LOW | CWE-184 | A04 | `tools/eslint-rules/raw-sql-lexer.mjs:265, 339-360`; `apps/api/src/platform/db/raw-statement.ts:74, 263-279`; corpus residual row `raw-statement-corpus.json:38` | senior-developer, **C3**, this PR |
| PR54-SEC-08 | `NOTIFY` is refused as a first keyword, but its function form `pg_notify(…)` is admitted and delivers to a listener (X5). This is a consistency gap; NOTIFY is not pooled-session state (= code review R2-n2) | INFO | CWE-184 | A04 | `SESSION` (`raw-sql-lexer.mjs:253`, `raw-statement.ts:66`) | senior-developer, same change as C3 |

### PR54-SEC-07 (LOW): the dynamic-SQL executors

**Probe** (PostgreSQL 18.6; every text is ADMITTED by both head twins; role without TEMPORARY):

| Row | Text(s) | Server effect |
|---|---|---|
| X0 control | `` SELECT 'x\' ; ' ; COMMIT ; SELECT ' -- ' `` alone (setting on) | syntax error 42601, row rolled back |
| X1 | `SELECT query_to_xml('select set_config(''standard_'' \|\| ''conforming_strings'', ''off'', true)', true, false, '')`, then the X0 text as a second call in the same transaction | **row committed despite ROLLBACK** |
| X2 | `SELECT query_to_xml('select set_config(''search_path'', ''public, pg_catalog'', false)', true, false, '')` | **session `search_path` changed after COMMIT** (`pg_catalog, public` became `public, pg_catalog`) |
| X3 | `SELECT * FROM ts_stat('select set_config(''search_path'', ''public'', false)::tsvector')` | **session `search_path` changed after COMMIT** |
| X4 | `SELECT query_to_xml('select pg_advisory_lock(5454)', true, false, '')` | **session advisory lock held after COMMIT** (`pg_locks`, granted) |
| X5 | `SELECT pg_notify('changes', 'x')` (control: `NOTIFY changes, 'x'` is refused) | notification delivered (PR54-SEC-08) |
| X6, X7 | `CREATE TEMP TABLE …`, `SELECT … INTO TEMP …` | server refused 42501 (no TEMPORARY: the cross-request temp-table and `pg_temp` function routes are closed by `00-roles.sql:51`, not by the guard) |

**Why X1 works.** The simple protocol parses the whole text of one call before running it. So a setting changed inside a call affects only the next raw call of the transaction: round 1's P6, now reached without naming the setting. SPI rejects a direct `COMMIT` in these executors, which is what the code review saw, but the setting route does not need one. The executors run with `read_only = true`, which admits a `SELECT` of a volatile function. The probe ran without Prisma: the guard verdict is a pure function of the strings, and Prisma sends this text unchanged (round-1 fact).

**Exploitability and impact.** The impact is the PR44-SEC-05 impact, as for round 1's (e) and C2: a write separated from its audit entry (O4), session state carried across requests on the pool, and a lock held across requests. The likelihood is low and deliberate: the template must name an XML or text-search executor and carry SQL in a string, which a reviewer sees. So the rating is LOW, the same class and reasoning as round 1. I make it a condition because it reopens two of this PR's own conditions, the fix is two lines per twin, and the code review also prefers the fix (R2-m1).

**Remediation (both twins), validated.** One exact-string patch on a scratch copy of the head lint twin:
```js
const DYNAMIC_SQL = /^(?:query_to_xml|query_to_xmlschema|query_to_xml_and_xmlschema|ts_stat|ts_rewrite|pg_notify)$/u;
// in sessionSetter, next to SESSION_LOCK:
if (isName(token, DYNAMIC_SQL)) return { form: 'session', detail: 'a function that runs SQL text' };
```
Results of the patched copy:
- **Corpus:** 1 of 132 entries changes verdict, the intended one: the line-38 residual `query_to_xml('select 1', …)` goes from `ok` to `session`.
- **Real templates:** 0 of the 155 templates in the head tree change verdict.
- **Probe shapes:** every round-2 shape is refused, including the quoted, `pg_catalog.`-qualified and upper-case spellings.
- **Controls:** `ts_rank(v, q)` stays `ok`.

For PR54-SEC-08, dropping `notify` from `SESSION` with a one-line reason is equally acceptable (code review R2-n2).

The list follows migration-lint rule 16 (PR43-SEC-06 (b)). I did not run a catalog-wide audit of built-ins that call SPI. If an extension with SQL-text functions is ever installed (`dblink`, `tablefunc` `crosstab`, `xml2` `xpath_table`), its names join this list. Today only `pg_trgm`, `btree_gin` and `btree_gist` are installed (`01-schemas.sql:22-24`).

**Verification tests.**
- Corpus rows (refused) for each of the six names: plain, quoted and `pg_catalog.`-qualified.
- The X1 pair as two rows: the first call is refused, so the second is never reached.
- The line-38 row turned into a refusal, with the corpus `$comment` and both twin headers stating what the residual still covers: function bodies, plus the readers listed in PR54-SEC-02 (b).
- A mutant that removes the new check must fail a test in each suite.
- Recommended, not required: add `SELECT query_to_xml('select pg_advisory_lock(5454)', true, false, '')` as a third `SESSION_FORMS` row in `route-phases.int.test.ts`. It reuses the `pg_locks` assertion.
- Take code review R2-n1's two setter rows in the same change.

## R2.5 Rulings

| Item | Ruling |
|---|---|
| **R2-m1** (code review) | **Fix in this PR**: condition C3 = PR54-SEC-07, plus PR54-SEC-08 in the same change. Not accepted as a routed residual. On PostgreSQL 18 it reaches `COMMIT` (X1), which the code review's PGlite run did not show. The fix is validated with zero collateral, and the due point "before TASK-073's first raw statement" is not a hard gate for raw SQL that lands earlier |
| **F5 not taken** (D-TASK020-96) | **Accepted.** In round 1, F5 was the preferred way to satisfy C1 (e) and C2 in one step, never a requirement. The targeted forms satisfy both. F5 would not have closed X1-X5, because every one starts with `SELECT`. One statement per call would not stop X1 either, because X1 uses two calls. What F5 still adds is defence in depth against unknown first keywords, and its only concrete catch today is PR54-SEC-02 (c), `ALTER ROLE CURRENT_USER SET`. That is reported by the lint (`no-alter-role-sql`) and seen by the integrity monitor, and `alter` as a run-time first keyword stays a follow-up before TASK-073 |
| D-TASK020-95 | Accepted (§R2.3) |
| D-TASK020-96 | Accepted with C3. The allow-list is anchored and single-token. R2-n1's rows pin both properties |
| D-TASK020-97 | Accepted (§R2.3) |
| D-TASK020-98 | Accepted. The remerge-diff is empty, and the evidence is bound to the merge |

## R2.6 Linear time (PR54-SEC-06)

| Shape (lint / run-time twin, ms) | `3efa2df`, n = 32,000 | head, n = 2,000 / 8,000 / 32,000 |
|---|---|---|
| nested setter calls (719 KiB) | 46,117 / 66,673 | 7/11, 12/17, 48/56 |
| `'a'` followed by a run of dashes | 0 / 0 | 0 / 0 at every size |
| 32,000 continued strings (125 KiB) | 5 / 5 | 1 / 2 |
| comment lines after a quote (156 KiB) | 3 / 3 | 3 / 3 |
| unclosed continuations `'a'<LF>  -` repeated (219 KiB) | 6 / 6 | 21 / 10 |

**Closed.** `parentheses()` is a single pass. Each continuation attempt scans only the white space and comments that the main loop then skips, so the work is at most twice linear.

## R2.7 Evidence and evidence hygiene

- **Lane B `20261116T0440Z_c6c4961`**: bound to `c6c4961`. `f00cf5b` (parent `c6c4961`) adds only the 8 run files, and `a6fc0a3` adds only the code-review record. Lane A's "Lane B evidence" step accepted the run.
- **D-SEC-PR23-02**: the PR's gate table carries both statements verbatim: "`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first" and "`.git/info/exclude` is empty" (0 bytes, logged before the run). The PR is not a lockfile PR.
- The earlier FAIL runs at `485dcbb` (host-load flakes, D-TASK020-98 triage) are not committed, which is correct.
- **Host-fragment scan** (count-only; needles computed at run time: user name, its 8.3 stem, home and temp dir in both slash forms, the MSYS home form, host name, git e-mail). Results:
  - **0** in the diffs of `485dcbb`, `46ed1e4` and `f00cf5b` (the run directory);
  - **0** in the first-parent commit messages of the delta;
  - the positive control counted 3.
- **C3 changes owned paths**, so it voids this record (§R2.10, S2). Round 3 needs fresh lane-B evidence carrying the same statements.

## R2.8 Alignment with the code review (round 2, `a6fc0a3`, APPROVED_WITH_NITS)

| Code review | This record |
|---|---|
| R2.3 closure table (R1-M1, C1, C2 for literal spellings, R1-m1..m3, R1-n1..n5, PR54-SEC-06) | Agreed (§R2.3); my PostgreSQL 18.6 probe and the `3efa2df` control agree with its PGlite results |
| R2-m1 (dynamic-SQL residual reaches C2 and the setter; "COMMIT cannot get through") | PR54-SEC-07, ruled **fix now** (C3). On PostgreSQL 18, COMMIT does get through, in two calls via `standard_conforming_strings` (X1) |
| R2-n1 (setter allow-list mutants survive) | Agreed; take the two rows with C3 |
| R2-n2 (`pg_notify`) | PR54-SEC-08 (INFO), same change; either fix form is acceptable |
| R2.4 rulings on D-TASK020-95..98; F5 "the security-analyst's call" | Agreed; F5 decline accepted (§R2.5) |
| R2.5 item 2 (if R2-m1 is fixed: delta round 3 with fresh lane B) | Agreed |

## R2.9 Conditions and routing

**Condition C3 (PASS_WITH_CONDITIONS), before this PR merges:** PR54-SEC-07 in both twins: the six names as an anywhere-form, with `pg_notify` either refused or `notify` dropped from `SESSION` with a reason. Also the corpus rows, the line-38 residual turned into a refusal, the header and corpus residual text, a mutant per twin, and R2-n1's two rows (§R2.4). Then fresh lane-B evidence, a code-review delta round 3 and a security delta round 3 limited to the twins, the corpus and the tests.

**Follow-ups (unchanged owners):**
- PR54-SEC-02 (b): the readers `table_to_xml*`, `schema_to_xml*`, `database_to_xml*`, `cursor_to_xml*`.
- PR54-SEC-02 (c): `alter` as a run-time first keyword. Due with (b), before TASK-073's first raw statement.
- PR54-SEC-04: CODEOWNERS with devops 015-C.
- PR54-SEC-05: optional, at the next `with-tenant-tx.ts` edit.

**Merge rules:** C3 voids this record because it changes owned paths, so round 3 is required. A docs-only commit or a docs-only merge of `main` keeps the record. A `main` change to one of the 63 owned paths that this PR also changes voids it.

**Proposed decision text, for the orchestrator to log.** **D-SEC-PR54-02 · 2026-11-17 · security-analyst · PR #54 (020-D) round 2 at `a6fc0a3`: PASS_WITH_CONDITIONS**
- **Decision.** C1 and C2 are closed for every form that names the refused construct. The 21 round-1 bypass rows fail closed in both twins, and PostgreSQL 18 `scan.l` was re-checked. No fail-open lexer differential remains across 23 new shapes. PR54-SEC-03, -04 (code and headers) and -06 are closed. D-TASK020-95..98 are accepted, and declining F5 is accepted (F5 would not close the remaining paths).
- **New finding PR54-SEC-07 (LOW, CWE-184, = code R2-m1 widened).** `query_to_xml*`, `ts_stat` and `ts_rewrite` run SQL text and carry the refused forms. On PostgreSQL 18.6 they produced a rolled-back row that was COMMITTED (via a split `standard_conforming_strings` name and a second call), a session `search_path` that survived COMMIT, and a session advisory lock still held.
- **New finding PR54-SEC-08 (INFO, = R2-n2).** `pg_notify` is admitted while `NOTIFY` is refused.
- **Ruling on R2-m1: fix in this PR**, as condition C3. Refuse the six names anywhere in both twins (or drop `notify` from `SESSION`), turn the corpus residual row into a refusal, and add mutants plus R2-n1's rows. The fix is validated: 1 intended corpus change, 0 of 155 real templates change verdict. Then fresh lane B, code r3 and security r3 as delta rounds.
- **Follow-ups:** PR54-SEC-02 (b) readers and (c) runtime `ALTER`, before TASK-073's first raw statement; PR54-SEC-04 CODEOWNERS with 015-C; PR54-SEC-05 optional.
- **Reversibility:** High.

## R2.10 Record simulation

`record-sim.mjs` ran `main`'s `tools/ci/check-security-owned-paths.mjs` on plumbing scenario commits, with `--base origin/main --pr 54 --json` and `origin/main` = `1128792`, in a sparse `git clone --shared`. Nothing was pushed from the simulation. The candidate is LF with 0 CR bytes. Its round-2 part has exactly one table row whose first cell starts with `Head` (the full SHA of `a6fc0a3`), and the file's last line is the round-2 `Verdict` row.

| Scenario | Checker | Expected |
|---|---|---|
| S0 control: the head without the round-2 section (round-1 record only, naming `3efa2df`) | missing | missing |
| S1 this record committed on `a6fc0a3` | pass | pass |
| S2 S1 + an owned change (`tools/eslint-rules/raw-sql-lexer.mjs`) | missing | missing |
| S3 S1 + a docs-only commit (`docs/sdlc/STATUS.md`) | pass | pass |
| S4 S1 + a merge of `origin/main` `1128792` (`DECISIONS.md` only since `ba60aa7`) | pass | pass |
| S5 the round-2 Verdict cell set to FAIL | missing | missing |
| S6 the round-2 Head row naming `3efa2df` (owned paths changed after it) | missing | missing |
| S7 the round-2 Head row naming a commit outside the range | missing | missing |
| S8 only a record named for another PR | missing | missing |
| S9 the round-2 Verdict row removed (the round-1 Verdict row is then last; procedural, PR10-SEC-04) | pass | pass |

10 of 10 as expected. A count-only scan of the round-2 text found 0 host fragments and 0 secret shapes (positive control counted).

| Field | Value |
|---|---|
| **Verdict** | **PASS_WITH_CONDITIONS.** Round 2 at `a6fc0a3`: 0 Critical, 0 High, 0 Medium. C1 and C2 closed for every named form; PR54-SEC-03, -04 (code), -06 closed; F5 decline accepted. New LOW PR54-SEC-07 (dynamic-SQL executors reach COMMIT, session setters and session advisory locks on PostgreSQL 18) is condition **C3, fixed in this PR** (ruling on code review R2-m1), with INFO PR54-SEC-08 (`pg_notify`) in the same change; then fresh lane-B evidence and delta rounds 3 |
