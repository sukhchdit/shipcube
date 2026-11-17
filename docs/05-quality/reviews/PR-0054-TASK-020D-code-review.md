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

# Round 2 (head f00cf5b)

Reviewer: code-reviewer (principal engineer), round 2, delta review. Head reviewed: `f00cf5b` (full SHA `f00cf5bd1e2af009ed189788e653203003a7e181`). Delta `3efa2df..f00cf5b`: code commits `485dcbb` (fix cycle 1) and `46ed1e4` (the C2 PostgreSQL case), merge `c6c4961` (main with PR #53), and the evidence commit `f00cf5b`.
- `git show --remerge-diff c6c4961` is empty, so the merge is a clean union.
- `git diff --name-only c6c4961 f00cf5b` lists only the evidence directory `20261116T0440Z_c6c4961`.
- `origin/main` has since moved by `DECISIONS.md` and `STATUS.md` only (`04bb7a2..ba60aa7`), and `git merge-tree --write-tree origin/main f00cf5b` is clean.

Rulings checked: r1 findings R1-M1, R1-m1..m3, R1-n1..n6; security conditions C1 (PR54-SEC-01 (a)-(e)) and C2 (PR54-SEC-02 (a)); PR54-SEC-03, -04 (scope), -06; D-TASK020-95..98 (DECISIONS.md on main).

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R1-M1 and C1 (a)-(e) are closed in both twins, which still agree (0 differences on 300 000 fuzzed texts and
  templates). Every r1 bypass and every new probe (dollar quoting, nested comments, E/B/X/N/U& strings, quote
  continuation, quoted identifiers) is refused or errors on PostgreSQL. C2 and R1-m1..m3 are closed, and 40 of my 42
  mutants are killed. ONE MINOR (security flag): the stated "SQL text inside a string" residual also carries the C2
  forms. query_to_xml / ts_stat run a session advisory lock or a session setter that survives COMMIT.
```

## R2.1 What I verified myself

Method:
- The review worktree, read-only (`git status` clean).
- Node 24 tsx and ESLint `lintText` probes from the scratchpad, with the full repository config and type checking disabled.
- PGlite 0.4.3 (PostgreSQL 17.5 WASM) from the worktree's node_modules.

No Docker, no installs.

| Check | Result |
|---|---|
| Targeted units: raw-statement, raw-sql-lexer, tenant-db, execute-phases (`--maxWorkers=2`) | 370 / 370 pass (4.4 s) |
| `tools/lint/negative-fixtures.test.ts` | 372 / 372 pass (26.2 s) |
| Prettier `--check` on every changed non-evidence file in `3efa2df..c6c4961` | clean |
| Twin equality: differential fuzz of `refusedStatement` vs `refusedRawText` over a 47-token alphabet, both allowance settings. The alphabet: quotes, `$q$`, `$$`, `$1`, `--`, `/*`, `*/`, CR, LF, VT, NBSP, U+2028, a lone surrogate, `E'`/`b'`/`U&'`/`U&"`, backslash, keywords, `set_config`, the lock and string-syntax names. Also `templateText` vs `prismaText` | 300 000 texts, **0 differences** (verdict, form and detail) |
| R1-M1 reproduction (the r1 texts) | All refused by both twins: CR -> `transaction-control` / `session`; NBSP, U+FEFF, U+3000, U+2028 -> `unreadable` |
| New bypass hunt on PGlite inside `BEGIN`: 55 probes. Dollar quoting: case-different tag, `a$q$`, `$1$q$`, `1$q$`, `$$$`. Nested comments: `/*/`, `/**/`, `/* **/`, `/*/**/`, operator-adjacent `+/*`, `*/*`, `-/* */-`. E strings: `\\`, `\x27`, `\'`. Continuation via VT, FF, `--x\r`, `--\r--\r`, a block comment, after U&/B/X/N strings. Junk prefixes: `1e'`, `0x1e'`, `x.e'`, `_e'`. Quoted identifiers with `""`, `U&"`, NBSP. A comment ended by U+2028 or U+0085. NUL | For every text both twins ALLOW, PostgreSQL either runs it without ending the transaction (txid unchanged, `search_path` unchanged) or rejects the whole string (syntax error, trailing junk, or `invalid message format` for NUL). **No fail-open lexer differential found.** The only allowed texts that leave session state are the R2-m1 functions |
| Full-config lint probes (virtual files in `modules/quotes/{repository,service}` and `packages/shared/src`) | R1-M1 escape forms (`\r`, ` `), the CR `rawSystemTable` disguise, the continuation and `$q${v}$q$` templates, `pg_advisory_lock`, `DECLARE … WITH HOLD`, `COMMIT` in a package: all reported. R1-m1 / PR54-SEC-03: `.Module._load`, `m.register`, `{ default: M }`, `m[k]`, `.then(({ registerHooks }) …)`, `import('module').Module`, `process[k]`, `Reflect.get(process, k)`, `const p = process`, `globalThis.process.binding`: all reported. Controls `(await import('node:module')).isBuiltin`, `const { env } = process`, `process.env[k]` stay clean. `f(process)` and `(globalThis as …)['process'][k]` are clean, as stated in the residuals |
| Mutants of my own (21 per twin, scored on what the shared corpus asserts: verdict, detail, templates, read-only allowance) | **40 / 42 killed**. Killed: LF-only comment end, `\s`, non-ASCII as punctuation, no continuation, continuation drops E mode, continuation without comments, CR-less continuation, spaced template join, `declare` dropped, lock check off, `_shared` dropped, any setting name, string-syntax off or words only, case-sensitive list, E escapes off, flat comments, only the first setter call, non-ASCII dollar tags. Survivors: R2-n1 |
| Evidence `20261116T0440Z_c6c4961` (summary.md) | PASS. unit 6286 (2 skipped), integration 322, api 128, catalog 102, rls 126/0/0. Merged coverage 99.02 % lines / 97.02 % branches. Bound to `c6c4961`; the head commit after it is evidence-only |
| CI on `f00cf5b` (`gh pr checks 54`, run 43807291356) | fast-lane **pass**. scans **fail** and ci-gate fails, waiting only on the round-2 security record |

Not re-run by me: lint, typecheck and build of the whole repository, the full unit and integration suites, coverage, and the new PostgreSQL 18 cases in `route-phases.int.test.ts`. I relied on lane B (integration 322, up from 316, so the 6 new cases ran) and on fast-lane.

## R2.2 Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR (security flag) | `tools/eslint-rules/raw-sql-lexer.mjs:339-360` and `apps/api/src/platform/db/raw-statement.ts:263-279` (`sessionSetter`); residual text `raw-statement.ts:25-26`, `db-raw-sql.mjs:46-49`; corpus row `raw-statement-corpus.json:38-40` | **The stated "SQL text inside a string" residual reaches the C2 forms and the session setter, but no header says so.** `query_to_xml`, `query_to_xmlschema`, `query_to_xml_and_xmlschema`, `ts_stat` and `ts_rewrite` execute a query given as text, through SPI. Both twins allow all of them, and the lint is clean too (probed in a repository file). On PGlite inside `BEGIN … COMMIT`: `SELECT query_to_xml('select set_config(''search_path'', ''pg_catalog'', false)', true, false, '')` leaves `search_path = pg_catalog` on the session after COMMIT. `SELECT * FROM ts_stat('select to_tsvector(set_config(''search_path'', ''pg_temp'', false))')` does the same. `SELECT query_to_xml('select pg_advisory_lock(77)', …)` (also `query_to_xml_and_xmlschema`) leaves the session advisory lock held after COMMIT, and after ROLLBACK too. So C2's "session advisory locks refused", and the PR44-SEC-05 session-setter form, hold only for the literal spellings. COMMIT itself cannot get through this route: SPI refuses it (`invalid query`). The corpus pins `query_to_xml('select 1', …)` as a residual about reading, and the WAVE-00 card lists "SQL text inside a string that a function executes" as stated (D-TASK020-81). Neither twin header names the consequence, a cross-request lock or setting leak on the pool, and the leak detector watches only the four `app.*` keys (PR54-SEC-05). Same deliberate-author class as PR54-SEC-02 (b), so not MAJOR. | Preferred, because it is cheap and fails closed: refuse the dynamic-SQL function names as an anywhere-form in both twins (`query_to_xml`, `query_to_xmlschema`, `query_to_xml_and_xmlschema`, `ts_stat`, `ts_rewrite`; the migration linter's rule 16 list, PR43-SEC-06 (b)). Add corpus rows for the lock and setter forms, and turn the current residual row into a refusal. Alternative, at the security-analyst's choice: state the lock and setter reach in both twin headers and in the corpus note, and route it with PR54-SEC-02 (b) (due before TASK-073's first raw statement). |
| R2-n1 | NIT | `raw-sql-lexer.mjs:326`, `raw-statement.ts:259` (`first !== open + 2`); `LOCAL_SETTING` anchors (`:261` / `:70`) | Two mutants of the new setter allow-list survive the corpus in both twins: (a) dropping the single-token name check (`first !== open + 2`), and (b) un-anchoring `LOCAL_SETTING`. Today they are near-equivalent, because no dangerous setting name contains a listed one. Still, nothing pins either property, and both guard the C1 (e) decision. | Add `SELECT set_config('lock_timeout' \|\| '', $1, true)` -> `session-setter` and `SELECT set_config('my.app.key', $1, true)` -> `session-setter`. |
| R2-n2 | NIT | `SESSION` in both twins (`notify`) | `NOTIFY` is refused as a first keyword, but its function form `pg_notify('c', 'x')` is allowed (probed). NOTIFY is queued until commit and is not session state, so this is a consistency point, not a leak. | Either drop `notify` from `SESSION` with a one-line reason, or refuse `pg_notify` as an anywhere-form. Only `listen` and `unlisten` are session state. |

## R2.3 r1 and security closure

| Item | Status | Evidence |
|---|---|---|
| R1-M1 / C1 (a) CR comment end, (b) Unicode spaces | **Closed** | `LINE_END = /[\n\r]/`, `SPACE = [ \t\n\r\f\v]`, non-ASCII outside literals is `unreadable` (D-TASK020-95). Corpus and template rows; mutants L1/L2/L3 killed in both twins; lint probes reported; PG 18 case for CR in `route-phases.int` with a commit control |
| C1 (c) E-string continuation | **Closed** | `CONTINUATION` matches scan.l `quotecontinue` (horizontal space, an optional `--` comment, a newline, then `special_whitespace*`) and keeps the mode. Mutants L4/L5/L6/L20 killed. The regex is unambiguous: one continuation attempt scans only white space and comments that the main loop then skips, so the time is linear. PG 18 case plus control |
| C1 (d) Prisma `$n` rendering | **Closed** | `templateText` and `prismaText` both produce `part$1part$2…`, equal on all fuzzed splits. `$q${v}$q$` templates are refused; mutant L7 killed |
| C1 (e) string-syntax settings | **Closed** | Literal-name allow-list for the literal-`true` setter (D-TASK020-96). `standard_conforming_strings` / `backslash_quote` are refused in any token, strings included. Mutants L11/L13/L14/L15 killed (R2-n1 for the two near-equivalents) |
| C2 / R1-m3 cursors and session advisory locks | **Closed for literal spellings** | `declare/fetch/move/close` in `SESSION`; `SESSION_LOCK` anywhere (word or quoted, `pg_catalog.`-qualified, case-folded); `_xact_` forms stay allowed. PG 18 case: 5xx problem, call and handler never run, `pg_locks` count 0, with a control proving that PG keeps both after COMMIT (D-TASK020-97, accepted). Dynamic-SQL reach: R2-m1 |
| R1-m1 / PR54-SEC-03 | **Closed** | `NODE_MODULE_ALLOWED` is shared by `no-restricted-imports` and `static-module-specifier`. Every member, destructuring key or rest element outside it is `loader`. `processMember` covers computed keys, Reflect/Object arguments and aliases. `binding` / `_linkedBinding` are matched on any object. Residuals are stated (TASK-113). D-TASK020-86 is now accurate |
| R1-m2 | **Closed** | Second-setter, `EXPLAIN ANALYZE UPDATE pg_settings` and nested-comment rows; mutants L18/L19 killed |
| R1-n1 | **Closed** | `execute-phases.test.ts` awaits the server-side `close` and the execute slot's end instead of `delay(100/200)` |
| R1-n2 | **Closed** | `isHolderMember` covers `const add = deps.queue.add` and `.bind(deps.queue)` (fixture `bad-holder-member-alias.ts`); `.call` / `.apply` and a second alias are stated in Limits |
| R1-n3 / PR54-SEC-04 scope | **Closed** | `only: ['statement']` on `packages/*/src` (probe: `COMMIT` in `packages/shared/src` is reported); the headers now say the TenantDb guard, not the lint, refuses `Prisma.sql` fragments |
| R1-n4 | **Closed** | `tenant-db.test.ts` sends `SET TRANSACTION READ ONLY` through TenantDb and expects a refusal (B5 is killed) |
| R1-n5 | **Closed** | `regclass` strings and `database_to_xml` / `schema_to_xml` named in the `system-model-owner` residual, routed to TASK-073 |
| R1-n6 | **Routed** | The WAVE-00 020-D card now sends the worker `main.ts` comment to TASK-035 (D-ARCH-136) |
| PR54-SEC-06 | **Closed** | `parentheses()` is a single pass with a stack. Corpus `linearTime` uses 50 000 nested setters (< 10 s bound; both suites pass in seconds) |

## R2.4 Deviation rulings (D-TASK020-95..98)

| Decision | Ruling |
|---|---|
| 95 non-ASCII outside literals is `unreadable`; ASCII dollar tags | Accepted. It is stricter than PostgreSQL. My probes show that PostgreSQL agrees on comment content: U+2028 and U+0085 do not end a `--` comment there either |
| 96 literal-name allow-list for the `true` setter; string-syntax names refused anywhere; first-keyword allow-list (F5) not taken | Accepted. Whether to take F5 is the security-analyst's call. R2-m1 is the cheapest step in that direction |
| 97 C2 proof via `pg_locks` plus "call and handler never ran"; cursor absence rests on the unit test | Accepted. A read-only `load` cannot carry a row-count proof, and the control shows the probe would see a leaked lock |
| 98 main merged before retaking evidence | Accepted. The remerge diff is empty, and the evidence is bound to the merge |

## R2.5 Merge conditions

1. A security round-2 record `docs/05-quality/security/PR-0054-*.md` naming the final head. It must rule on R2-m1 (refuse now, or state and route with PR54-SEC-02 (b)). Until then scans and ci-gate stay red. This review commit is docs-only (`docs/05-quality/reviews/`), so it does not touch the code bound by lane B evidence `20261116T0440Z_c6c4961`.
2. If R2-m1 is fixed in this PR, round 3 is a delta check of the twins and the corpus only, and needs fresh lane B evidence (the lexer is on the unit, api and integration paths).
3. No further `main` merge that changes an owned path. Squash merge.

## R2.6 Good patterns worth keeping

- The fail-closed choice for non-ASCII outside literals, rather than mirroring PostgreSQL's byte and encoding rules, makes a whole class of differentials unreachable.
- Template-level corpus rows that both twins render. They pin the Prisma rendering, which was the subtle (d) bypass.
- PostgreSQL controls next to the refusal cases. They prove the refused text really would commit or keep the lock, so the refusal test cannot pass vacuously.
- One allow-list constant (`NODE_MODULE_ALLOWED`) shared by configuration and rule.

# Round 3 (head cc95e38)

Reviewer: code-reviewer (principal engineer), round 3, narrow delta review.

Head reviewed: `cc95e38` (full SHA `cc95e38bfbd8d36df9248e1ba9e3cf2187d051a9`).

Delta `85cf474..cc95e38`:
- `e9dd29b`: C3 = R2-m1 = PR54-SEC-07, plus PR54-SEC-08 and R2-n1.
- `d716f7b`: the TASK-288 S3 flake in `execute-phases.test.ts`.
- `cc95e38`: the evidence commit.

Commits after round 2 (`a6fc0a3..85cf474`): only the security round 2 record.

Main merge state:
- `git merge-tree --write-tree origin/main cc95e38` is clean.
- `origin/main` now includes PR #55 (`11e2158`, `.github/dependabot.yml` and `tools/ci/**`). No file overlaps this PR's delta from the merge base.

Decisions checked: D-TASK020-99 and D-TASK020-100.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R2-m1 (PR54-SEC-07), R2-n1 and R2-n2 (PR54-SEC-08) are closed in both twins, which still agree (0 differences on
  300 000 fuzzed texts with the new names in the alphabet). 56 of 56 mutants are killed: the 42 from round 2, including
  both round 2 survivors, and 14 new ones on DYNAMIC_SQL / pg_notify. The deadline-test change keeps the magnitude pinned
  deterministically: the execute slot's "ignores callDeadlineMs" mutant fails both cases. One NIT, no new MINOR.
```

## R3.1 What I verified myself

Same method as round 2: the worktree, tsx and PGlite probes from the scratchpad, no Docker.

| Check | Result |
|---|---|
| Targeted units: raw-statement, raw-sql-lexer, tenant-db, execute-phases (`--maxWorkers=2`) | 506 / 506 pass (6.6 s) |
| Prettier `--check` on the 6 changed files | clean |
| Twin equality: `fuzz.mts` | **0 differences** in verdict, form and detail on 300 000 texts. The alphabet now also has `query_to_xml`, `TS_STAT`, `"ts_rewrite"` and `pg_notify`. `templateText` and `prismaText` agree |
| R2-m1 reproduction (`dyn.mts`: the seven round 2 PGlite texts) | All `session` / `session` in both twins: the `query_to_xml` setter, the lock, `commit`, `query_to_xmlschema`, `query_to_xml_and_xmlschema`, `ts_stat`, `ts_rewrite` |
| Mutants (`mut.mts`), scored on the shared corpus | **56 / 56 killed**. The 42 from round 2 are killed, including round 2 survivors L12/R12 (the single-token name check, killed by `'lock_timeout' \|\| ''`) and L16/R16 (`LOCAL_SETTING` anchors, killed by `'my.app.key'`). The 14 new ones per twin: DYNAMIC_SQL off; drops `ts_stat`, `query_to_xmlschema` or `query_to_xml_and_xmlschema`; words only (killed by quoted `"query_to_xml"`); case-sensitive (killed by `"QUERY_TO_XML"`); `pg_notify` off |
| Deadline mutant: `execute.ts:247`, `options.callDeadlineMs ?? CALL_DEADLINE_MS` -> `CALL_DEADLINE_MS`, temporary in the worktree and then restored (`git status` clean) | **Killed**: 2 failed (the call case and the stream case), 3 passed in the `never settles\|stream` subset |
| Real code that names the new functions | `grep` over `apps`, `packages` and `prisma` (non-test `.ts` / `.sql`): only the twin itself. This is consistent with the claim that 0 of 155 real templates changed verdict; I did not re-count the 155 |
| Evidence `20261117T0302Z_d716f7b` | PASS. unit 6422 (2 skipped), integration 323 (322 + the new `load-dynamic-sql-lock` row), api 128, catalog 102, rls 126. Merged coverage 99.02 % lines / 97.05 % branches. Bound to `d716f7b`; `cc95e38` is evidence-only |
| CI on `cc95e38` (run 44009817933) | fast-lane **pass**. scans and ci-gate fail, waiting on the security record for the head |

Not re-run by me: full lint, typecheck, build, the full suites, and the PG 18 integration row. I relied on lane B and fast-lane for those.

## R3.2 Closure

| Item | Status | Evidence |
|---|---|---|
| R2-m1 = PR54-SEC-07 (C3) | **Closed** | `DYNAMIC_SQL` is an anywhere-form `session` refusal in both twins. It matches words and quoted names, case-insensitively (D-TASK020-99: fail closed; a quoted upper-case name is a different function to PostgreSQL, so refusing it costs nothing). Corpus rows cover 4 spellings. There is a PG 18 route row (`load-dynamic-sql-lock`: refused, call and handler never run, `pg_locks` 0) and a control proving that PostgreSQL keeps a lock taken through `query_to_xml` in a READ ONLY transaction after COMMIT. Both headers and `db-raw-sql.mjs` now state the leftover risk precisely: function bodies, and the name-driven readers `table_to_xml*` / `schema_to_xml*` / `database_to_xml*` / `cursor_to_xml*` (PR54-SEC-02 (b), before TASK-073). I know of no other built-in in PostgreSQL 17/18 that runs SQL text and is callable by the runtime roles. `dblink` is not installed, `COPY … PROGRAM` needs superuser, and `PREPARE` / `EXECUTE` / `DO` are already refused |
| R2-n1 | **Closed** | Rows `SELECT set_config('lock_timeout' \|\| '', $1, true)` and `SELECT set_config('my.app.key', $1, true)` are both `session-setter`. They kill L12/R12 and L16/R16 |
| R2-n2 = PR54-SEC-08 | **Closed** (refuse option) | `pg_notify` is refused anywhere in both twins, consistent with the `NOTIFY` keyword. Mutant killed |
| TASK-288 S3 deadline cases (D-TASK020-100) | **Accepted, coverage not weakened in substance** | The `< 2_000` wall-clock bound is replaced by two checks. First, a `setTimeout` spy asserts that exactly one timer is armed with the configured 50 ms, and `execute.ts:182` arms the deadline with global `setTimeout`. Second, `timeOperation` `workMs < 50 + HOST_LOAD_SLACK_MS` shows the deadline fired rather than hung. This is a timer check, not CPU-bound, so D-SEC-PR53-02 allows `timeOperation`. `request()` and the two bulkhead cases now use `fetchOnce` and `closeLoopbackServer` (the PR #53 pattern) |

## R3.3 Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R3-n1 | NIT | `apps/api/src/platform/tx/execute-phases.test.ts` (both R1-M1 deadline cases) | `HOST_LOAD_SLACK_MS` (20 000) equals `CALL_DEADLINE_MS` (20 000). So the `workMs` bound cannot tell "the 50 ms deadline answered" from "a 20 s timer answered", and only the spy carries the magnitude. A mutant that arms the 50 ms timer but answers through a second, later timer passes, for example `setTimeout(() => setTimeout(abort, 15_000), deadlineMs)`. This is contrived, and today's code has one timer, hence a NIT. | Optional: also assert that the spy saw no timer of `CALL_DEADLINE_MS`, or that the 50 ms timer's callback is the one that ends the request (for example, invoke the recorded callback and assert the 503 with fake timers). Otherwise state that the spy is the magnitude pin in the case comment, which it partly does already. |

## R3.4 Deviation rulings

| Decision | Ruling |
|---|---|
| 99 DYNAMIC_SQL case-insensitive, refused anywhere, `session` form | Accepted (fail closed; mutants L26/R26 pin the case-insensitivity) |
| 100 setTimeout spy + `timeOperation` slack replaces the wall-clock bound | Accepted (deadline mutant killed; R3-n1 optional) |

## R3.5 Merge conditions

1. A security record naming the final head, which is this review commit's head (docs-only on top of `cc95e38`). Until then scans and ci-gate stay red.
2. Main now carries PR #55 (`tools/ci/**`, `.github/dependabot.yml`). It is disjoint from this PR and `merge-tree` is clean. Whether the tested-base rule that PR #55 introduces needs a `main` merge and a lane A rerun before merging is the orchestrator's call; this review needs no new code round for it. If `main` is merged, a docs-only or disjoint-tooling union keeps this verdict. Prove it with an empty `--remerge-diff`.
3. Squash merge.
