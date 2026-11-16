# Code review: PR #54, TASK-020 part 020-D (SYSTEM-table raw-SQL ownership, raw transaction-control guard, PR #44 lint residuals), round 1

Reviewer: code-reviewer (principal engineer). Head reviewed: `3efa2df` (full SHA `3efa2df4f48707be473963304c4257bca922539d`, branch `feat/TASK-020-d-raw-sql-ownership`); code head `f01e470` (`git diff --name-only f01e470 3efa2df` = the evidence directory only). Diff base: `git diff origin/main...3efa2df`. `origin/main` has since moved by docs and agent notes only (`985955f`..`91b5dc7`: DECISIONS, STATUS, a review record, agent memory); `git merge-tree --write-tree origin/main 3efa2df` is clean.

Rulings checked against the code:
- D-ARCH-124 (rulings/wave-0-sheet-fold-7.md §(9));
- PR44-SEC-05, -10, -11, -14 (docs/05-quality/security/PR-0044-TASK-020C-security-review.md) and D-SEC-PR42-02 (the 020-D note);
- PR #44 code review R2-m1, R2-m2, R2-m3, R2-n3, R1-n6; PR #42 R3-n3; PR #39 R2-n2;
- D-TASK020-78..94 (PR body; already appended to DECISIONS.md on main).

```
VERDICT: CHANGES_REQUESTED
SUMMARY: rawSystemTable is manifest-driven, fail-closed and owned exactly as D-ARCH-124 rules (audit = packages/audit/src/**
  + apps/*/src/modules/audit/**); the R2-m1 test, the template/computed createRequire keys, the T-83 crash guards, the
  import-equals guard, the SEC-14 config and the comment fixes are all in place, and the two lexer twins agree on 400 000
  random inputs. ONE MAJOR: both twins disagree with PostgreSQL on what is white space and where a `--` comment ends, so
  `SELECT 1 -- n\r; COMMIT` and `SELECT 1 AS  $q$; COMMIT; SELECT 1 AS  $q$` pass the lint AND the TenantDb guard,
  and PostgreSQL executes the COMMIT (PGlite probe: the transaction id changes). Four MINORs (two security flags), six NITs.
```

## 1. What I verified myself (and what I did not)

Method: the review worktree (read-only), tsx and ESLint `Linter`/`ESLint.lintText` probes from the scratchpad, PGlite 0.4.3 (PostgreSQL 17.5 WASM) from the worktree's node_modules. Node 24, no Docker, no installs, no full suites (dispatch constraint). `git status` of the worktree is clean.

| Check | Result |
|---|---|
| Targeted unit run (positional, `--maxWorkers=2`): raw-statement, raw-sql-lexer, tenant-db, execute-phases | 225 / 225 pass (9.8 s) |
| `tools/lint/negative-fixtures.test.ts` | 365 / 365 pass (28.7 s) |
| Prettier `--check` on the 56 changed non-evidence files | clean |
| Twin equality: differential fuzz, `refusedStatement` (lint) vs `refusedRawText` (runtime), 38-token SQL alphabet (quotes, `$q$`, `$$`, `$1`, `--`, `/*`, `\r`, NBSP, prefixes, keywords), 200 000 texts x both allowance settings | **0 differences** |
| Lexer vs PostgreSQL (PGlite, inside `BEGIN`): texts both twins ALLOW | 3 of 5 end the transaction (txid 738 -> 739), 2 run a session `SET`: R1-M1 |
| Full repository ESLint config (`lintText`, type checking disabled) on probe files under `apps/api/src/modules/**/repository` | the R1-M1 escape-sequence forms are lint-clean; the plain forms are reported |
| Full config: builtin-loader probes | `(await import('node:module')).Module._load('pg')`, `.register()`, `M[k]` on the default member: lint-clean (R1-m1) |
| Lexer mutants of my own (corpus = what both suites assert) | 14 run: 2 killed, 6 equivalent, **4 meaningful survivors** (R1-m2, n4) |
| Evidence `20261115T1641Z_f01e470` | read summary.md: PASS (api 128, catalog 102, integration 316, rls 126, unit 6092; merged 99.02 % / 97.02 %); bound to the code head; head commit docs-only |
| CI on `3efa2df` (`gh pr checks 54`) | fast-lane **pass**; scans **fail** only on the missing security record (`no record named docs/05-quality/security/PR-0054-*.md`); ci-gate fails on scans |

Not re-run: lint, typecheck, build, the full unit and integration suites, coverage. I rely on the lane B evidence above and on the fast-lane run for those.

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-M1 | **MAJOR** | `tools/eslint-rules/raw-sql-lexer.mjs:29, 114-116`; `apps/api/src/platform/db/raw-statement.ts:46, 160-162` | **The lexer's white space and line-comment end differ from PostgreSQL's, in the fail-open direction.** (a) `--` comments end only at `\n`; PostgreSQL's `comment ("--"{non_newline}*)` with `non_newline [^\n\r]` ends them at `\r` too. (b) `SPACE = /\s/u` treats U+00A0, U+FEFF, U+2028, U+3000 and the other Unicode spaces as white space, and the SPACE test runs before WORD_START. PostgreSQL's `space` is only `[ \t\n\r\f\v]` and every byte >= 0x80 is an identifier character, so ` $q$` is one identifier for the server and a dollar-quote opening for the guard. Proof, PGlite inside `BEGIN`, texts that BOTH twins allow: `SELECT 1 -- note\r; COMMIT; SELECT 2` (txid 738 -> 739), `SELECT 1 AS  $q$; COMMIT; SELECT 1 AS  $q$` (738 -> 739), `SELECT 1 AS ﻿$q$; ROLLBACK; SELECT 1 AS ﻿$q$` (738 -> 739), `SELECT 1 -- note\r; SET search_path TO pg_catalog` and the U+3000 form (statement executed). Lint: with the full config, `` db.$executeRaw`SELECT 1 -- n\r; COMMIT; SELECT 2` `` and the ` ` escape form in a repository file are **lint-clean** (only literal irregular white space trips `no-irregular-whitespace`; the escape does not). The same hole defeats `rawSystemTable`: `` db.$queryRaw`SELECT * FROM -- x\raudit_entries` `` and `` `SELECT 1 AS ﻿$q$, e.* FROM audit_entries e, (SELECT 1) AS ﻿$q$` `` in a quotes repository are lint-clean. With a bind parameter the extended protocol allows one statement only, but the setter form still passes the runtime guard: `` SELECT ${v} -- n\r, pg_catalog."set_config"('search_path', 'x', false) `` (the lint catches that one only through `tenant-context-sql`'s `setter` name form). This is the core deliverable of PR44-SEC-05 and D-ARCH-124, and the PR claims "an unreadable template fails closed". | In BOTH twins: `SPACE = /[ \t\n\r\f\v]/u`, and a line comment ends at the first `\n` **or** `\r`. Alternative that is simpler to keep right: report any character >= U+0080 outside strings and quoted identifiers as `unreadable` (application SQL is ASCII). Add corpus cases: the CR comment before `COMMIT` and before `SET`, NBSP / U+FEFF / U+3000 / U+2028 before `$q$`. Add a `rawSystemTable` fixture with the CR form, and kill a mutant that restores `\s`. |
| R1-m1 | MINOR (security flag) | `tools/eslint-rules/static-module-specifier.mjs:145-150, 173-196, 200-228` (`checkPattern`, `checkModuleValue`, `checkModulePromise`); claims in D-TASK020-86 and `eslint.config.mjs:470-476` | **The dynamic import of `node:module` admits ANY static member.** D-TASK020-89 makes "a member read under a static key" legal, and `no-restricted-imports` does not see `import()`. So all of these are lint-clean in an api repository or the worker `platform/db`: `(await import('node:module')).Module._load('pg')`; `const m = await import('node:module'); m.register('data:…')`; `.registerHooks({})`; `const { default: M } = await import('node:module'); M._load('node:child_process')`; and `M[k](url)('pg')`, where the default member is the whole module again, so the computed key is not checked. `Module._load('pg')` then constructs a `pg` client with a computed key, with no finding from any rule (only the literal `new c.PrismaClient()` trips `prisma-client-construction`). D-TASK020-86 lists "`Module`/`Module._load` and `register` (config)" as closed, and the boundaries policy comment says no-restricted-imports refuses them. That is true only for static imports. This is the same class as PR #44 R2-m2 (rated MINOR / LOW there). Separately, `no-restricted-properties` matches names only: `process[k]('node:child_process')` and `Reflect.get(process, 'getBuiltinModule')` are clean, which is not stated. | Bound every `node:module` value by the configuration's own allow-list: in `checkModuleValue`, `checkPattern` and the `.then` parameter, a static key other than `createRequire`, `builtinModules` or `isBuiltin` (so also `default`, `Module`, `register`, `registerHooks`, `_load`) is `loader`. Reuse `NODE_MODULE_ALLOWED`, for example by moving it to a shared module. Add fixtures for `.Module._load`, `.register`, `{ default: M }` and `M[k]`, and kill a mutant. State the `process[k]` / `Reflect.get(process, …)` residual in the SEC-14 comment, or route it to TASK-113. |
| R1-m2 | MINOR | `tests/fixtures/sql/raw-statement-corpus.json` | **The anywhere-forms are pinned only at their first occurrence and first position.** My mutants survive the corpus in both twins. B1 "only the first setter call is checked" (a `break` after the first `set_config`) survives. B2 "`UPDATE … pg_settings` only as the first keyword" survives. Both are real session leaks on PostgreSQL (PGlite: `EXPLAIN ANALYZE UPDATE pg_settings SET setting = 'pg_catalog' WHERE name = 'search_path'` and `SELECT set_config('statement_timeout', '5s', true), set_config('search_path', 'pg_catalog', false)` both leave `search_path = pg_catalog` after COMMIT). The code refuses both today; nothing stops a refactor from dropping that. A3 "comment nesting flattened" also survives: the nested-comment case has nothing dangerous after the inner `*/`. | Add three corpus cases: `EXPLAIN ANALYZE UPDATE pg_settings …` -> `session-setter`; the two-setter SELECT above -> `session-setter`; and an ok case with a statement inside the outer comment after the inner close (`SELECT 1 /* a /* b */ ; COMMIT */`) -> `ok`. |
| R1-m3 | MINOR (security flag) | `raw-sql-lexer.mjs:211`, `raw-statement.ts:53` (`SESSION`); headers of both twins | **Session state that outlives the request is not in the refused set, although both headers say "changes the pooled session" is refused.** (a) `DECLARE c CURSOR WITH HOLD FOR SELECT …` materialises tenant A's rows at COMMIT and keeps them on the pooled backend; a later request's `FETCH`/`CLOSE` reads them. (b) Session-level advisory locks (`pg_advisory_lock`, `pg_try_advisory_lock`, the `_shared` variants) are held until the backend closes. That is a cross-request lock leak on the pool. All are allowed by both twins (probed). Temp tables are not a hole: `00-roles.sql:51` revokes ALL on the database from PUBLIC, so no TEMPORARY. | Either add `declare` (or `declare … with hold`), `fetch`, `move` and `close` to the session first keywords, plus the session advisory-lock function names as an anywhere-form (like the setter), with corpus cases; or state them as residuals in both headers and in the corpus with `residual` notes, routed by security-analyst. |
| R1-n1 | NIT | `apps/api/src/platform/tx/execute-phases.test.ts:548-553` | The R2-m1 test sequences on fixed delays (`delay(100)` for "the server has seen the close", `delay(200)` for "nothing ran"). Under host load the first can fail the test, and the second can let the guard-removed mutant pass. | Await the server-side close (a `res.once('close')` promise in the held etag slot) before `release()`, and await a positive end signal, such as the response `close` or `finish`, instead of `delay(200)`. |
| R1-n2 | NIT | `tools/eslint-rules/no-external-calls-in-tenant-tx.mjs:852-867` (`isHolderMethod`) | R2-n3's destructured holder method is reported, but its member-alias sibling `const add = deps.queue.add; add()` (also with `.bind(deps.queue)` at module level) is clean, and it is not in the Limits paragraph. | Accept an `Identifier` id whose `init` is a member expression whose object `endsInName`, or add the form to Limits. |
| R1-n3 | NIT | `eslint.config.mjs:987-995` (`db-raw-sql` files) | `rawStatement` lints `apps/*/src` only. The one package with raw SQL (`packages/audit/src/store/prisma-store.ts`) is covered by `rawSystemTable` and, at run time, by the TenantDb guard, but not by the lint form the PR body describes ("refused by the lint"). | Either scope the `rawStatement` check to `packages/*/src` too, for example through a `platform/db-raw-sql` option that enables only the statement check there, or state the scope in the rule header. |
| R1-n4 | NIT | `apps/api/src/platform/db/raw-statement.ts:264-269`; `tenant-db.test.ts:380-413` | Mutant B5 survives: `refusedRawStatement` passing `{ allowReadOnlyTransaction: true }`. D-TASK020-80 says the TenantDb guard has no allowance, but no test sends `SET TRANSACTION READ ONLY` through TenantDb. | One more `refused(...)` line in the tenant-db test. |
| R1-n5 | NIT | `system-model-owner.mjs` header (residual) | The residual names SQL text inside a string. A table NAME in a string cast to `regclass` (`table_to_xml('audit_entries'::regclass, true, false, '')`, `table_to_xmlschema`) reads a SYSTEM table with no identifier. | Add the `regclass` string form to the stated residual (review item). |
| R1-n6 | NIT (orchestrator) | D-TASK020-91 | The worker `main.ts:27` "exit 1" comment is deferred to TASK-283, but the TASK-283 card in `WAVE-00.md` does not carry it. | Add the line to the TASK-283 AC, or to whichever task first moves the worker entry to the `startApi` pattern. |

## 3. Focus items

1. **`rawSystemTable` (D-ARCH-124).** Correct, apart from R1-M1.
   - It reads `tools/db/table-classes/*.json` at lint time (`cachedTables`). Missing or invalid manifests report `manifest`, and an unreadable template reports `rawUnreadable`.
   - Identifiers: unquoted ones are lower-cased, quoted ones are kept as written, so `PUBLIC.OUTBOX_EVENTS` and `"public"."outbox_events"` count while `"AUDIT_ENTRIES"` does not. `<table>_YYYY_MM` maps to its table. One finding per table per template.
   - The owner entry `audit: ['packages/audit/src/**', 'apps/*/src/modules/audit/**']` is the ruling verbatim. An explicit entry replaces the default glob, so listing the module glob is required (D-TASK020-79 is right).
   - The rule scope (`apps/*/src`, `packages/*/src`, minus the accessor homes and tests) covers the audit store. All the fold-7 fixtures are present, plus a TASK-073 viewer control and a mentions control.
2. **PR44-SEC-05 lexer and guard.**
   - Every named form is refused by both twins: raw COMMIT, ROLLBACK, END, ABORT, SAVEPOINT, RELEASE, BEGIN, START and PREPARE, the session first keywords, DO, and `UPDATE pg_settings`.
   - The TenantDb guard throws before Prisma is called (tenant-db.test asserts that `sent` is empty), and the PG 18 integration case asserts 5xx, no phase run and 0 rows.
   - `set_config` is allowed only with exactly three top-level arguments and a bare `true` word as the third (case-insensitive). The corpus pins `$1`, `false`, `'true'`, `true OR false`, a missing argument, an unbalanced call and the quoted name. The named-argument form `is_local => true` is refused, which fails closed.
   - Quoting (`''`, `""`), dollar quotes (tag-exact close), nested block comments and E-strings (`\'`, `\\`) match PostgreSQL. B/X/N strings differ on `''`, but the token boundaries come out the same, because PostgreSQL starts a new string at the second quote.
   - **White space and line comments do not match PostgreSQL: R1-M1.**
   - Transaction-local `set_config` of a tenant key is still allowed at run time. That is outside PR44-SEC-05; the source control is `tenant-context-sql`'s `setter` form.
3. **R2-m1.** The test holds the etag slot, aborts the client, releases, and asserts no `call`, no `begin:rw` and no handler. It pins the pre-slot `res.closed || res.destroyed` branch (`execute.ts:176`). The logic is sound; the timing is R1-n1.
4. **R2-m2 / R2-m3 / PR #42 R3-n3.**
   - `isCreateRequireKey` now uses `staticSpecifier`, which covers literals and no-substitution templates. Probed: the template key as a member, in a destructure and in a `.then` parameter, and the `{ default: M }` + `M.createRequire` and `const { createRequire: c } = M` forms are all `loader`.
   - `enclosingFunction` (the `Program.parent === null` crash) is gone; aliases resolve through `constDefs` in any scope. Module-level and factory aliases are reported.
   - `nodeModuleImport` guards on `ImportDeclaration`. `import m = require('node:module')` gives `no-require-imports`, and `import X = NS.y` no longer crashes (probed, no fatal).
5. **SEC-14.**
   - The static `node:module` imports are bounded to createRequire, builtinModules and isBuiltin, including `import type { Module }`, which is reported (harmless, fails closed).
   - `getBuiltinModule` and `dlopen` are refused on any object under a static key, and the `node:process` named imports are refused.
   - The timer `promises` member and a timer `import()` (also through `.then`) are `sleep`.
   - The dynamic `node:module` import is open: R1-m1.
6. **D-TASK020-94: sound.**
   - The case first asserts the refusal (`session-setter statement`), checks that the leak counter stays 0 and that the next tenant sees only its own rows. Only then does it plant the leak through a migrator-created plpgsql function, which is exactly the guard's stated residual (runtime roles cannot create functions).
   - `PERFORM set_config(…, false)` in the callee persists after the callback commits, so the detector, the security event and the latch are still exercised end to end.
   - The function lives in the suite's own clone, and the file's exact-file `tenant-context-sql` exemption is unchanged.
7. **Comments.**
   - `start-api.ts:97-98, 169-171` now defer the code to `installProcessErrorHandlers`.
   - The `config-exit.ts` JSDoc correctly says the api builds the services inside `startApi` and `main.ts` re-raises through `raiseStartupError`; I checked `main.ts`.
   - The worker comment is deferred (R1-n6).
8. **Mutation.** The 26/26 claim is consistent with what I can see. For example, their L7 equals my B3 (killed by 3 corpus cases). My own 14 mutants of the twins add four meaningful survivors: B1/A4, B2/A5, A3 (R1-m2) and B5 (R1-n4). A1 (`''` not an escape), A6, A7, A8, A9 and B4 are equivalent, or only add refusals.

## 4. Deviation rulings (D-TASK020-78..94)

| Decision | Ruling |
|---|---|
| 78 identifiers only; residual SQL-in-strings; generalised partition | Accepted. Add `regclass` strings to the residual (R1-n5). |
| 79 `audit` lists both globs | Accepted (ruling verbatim). |
| 80 forms; PREPARE both forms; exact-file read-only allowance; literal-true setter | Accepted. Fixture: READ WRITE in the same file is still reported. Coverage gaps are R1-m2 and R1-m3. |
| 81 two twins, one JSON corpus | Accepted. Differential fuzz: 0 differences. Both twins share R1-M1. |
| 82 `TenantDbAccessError` wording, no statement text | Accepted (`detail` is a keyword or a fixed phrase only). |
| 83 built-in loaders everywhere | Accepted for static imports; dynamic import open (R1-m1). |
| 84 SEC-14 sources, X09/X10 to TASK-113 | Accepted. |
| 85 T-83 alias scope widened | Accepted (stricter). The architect may note it under ADR-0005 am. 11 item 22 (d). |
| 86 D-TASK020-59 residual status | **Not accepted as written.** "`Module`/`Module._load` and `register` (config)" holds only for static imports (R1-m1). |
| 87 R1-n6 control route | Accepted. |
| 88 R2-n1 deferred | Accepted. |
| 89 strictness split | Accepted, with the static key bounded by the allow-list (R1-m1). |
| 90, 91 not taken here / R2-n2 split | Accepted; TASK-283 card line owed (R1-n6). |
| 92 R3-n3 fix shape | Accepted (probed). |
| 93 outage residue | Noted; the committed lexer equals the reviewed one. |
| 94 leak planted through a function body | Accepted (§3 item 6). |

## 5. Merge conditions

1. R1-M1 fixed in both twins, with corpus cases and a killed `\s` mutant. Fix R1-m1 and R1-m2 in the same cycle; they are small and in the files already being changed. R1-m3 is fixed or stated, at the security-analyst's choice.
2. Fresh lane-B evidence on the fix head. The lexer is in the unit, api and integration paths.
3. A security record `docs/05-quality/security/PR-0054-*.md` naming the final head. Until then scans and ci-gate stay red.
4. Squash merge. Round 2 is a delta review of the fix commits and the corpus additions; re-run the PGlite and full-config ESLint probes from §1.

## 6. Good patterns worth keeping

- One shared JSON corpus driving both twins. Keeping comparison literals out of the source avoids tripping `tenant-context-sql`.
- Fail-closed `unreadable` and `manifest`, and a miniature manifest per fixture root instead of a softer rule.
- Integration proof on real PostgreSQL that the guard acts before the server: phases never run, and the count query is 0.
- D-TASK020-94: the guard's own residual becomes the planting route, so the backstop detector keeps a live end-to-end test.
- Turning the R2-m3 crash into a report, failing closed, rather than silently skipping.
