# PR-0011 / TASK-016: change-scoped security review (row-level security foundations)

| Field | Value |
|---|---|
| PR | #11 `feat(db): row-level security foundations — manifests, renderer, withTenantTx, catalog C1-C14, migration-lint 3-9/11/14-16 (TASK-016)`, https://github.com/sukhchdit/shipcube/pull/11 |
| Branch / head | `feat/TASK-016-row-level-security-foundations-table` @ `557aada` (a merge of `origin/main` @ `de04877`; main's delta is docs only). Task commits `f658225`, `c444bbb`, `ccfe895`, `090bf84`, `b84325d`. 246 files, +6,326 / −73. **No dependency change** (`package.json` / `package-lock.json` untouched) |
| Scope | `apps/api/src/platform/db/{with-tenant-tx,tenant-db,map-db-error,expect-affected,index}.ts`; `prisma/bootstrap/02-role-backstops.sql`; `prisma/migrations/20261112020000_platform_rls_helpers`; `prisma/sql/{policy-templates,function-templates}/*.sql`, `prisma/sql/grants.manifest`; `tools/db/{render-rls,table-classes,grants-manifest,lint-migrations,bootstrap}.ts`; `tools/eslint-rules/{tenant-context-sql,db-raw-sql,no-alter-role-sql,prisma-client-construction,expect-affected,string-literals}.mjs`; `eslint.config.mjs`; `packages/config` `DB_TX_*`; `prisma/tests/{catalog,rls,migrations}/**` |
| Binding items checked | PR7-SEC-01/02/03/05/06/07/09/11/13/14 (PR-0007 §5 + R2), PR8-SEC-10/13/14, PR5-SEC-09/11/12, PR2-SEC-05 (+ addendum), PR9-SEC-03 (factory half), SEC-P3-34 (TASK-016 half), P3 §15 deviation 7 condition (D-ORCH-005 (7)), SPK-03 F-01..F-13, ADR-0005 am. 10 items 1–16, linter rules 3–9/11/14–16 (SEC-TC-33, NT-AVAIL-003-a), catalog C1–C14 (SEC-TC-05), D-ARCH-058/063..066/069, D-TASK016-01, merge rule D-ORCH-004 |
| Reviewer / date | security-analyst, 2026-11-12. Read-only on the worktree (`git status` clean before and after). No install, build, Docker or suite run (memory-constrained host). |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding; the D-ORCH-004 merge rule ("no Critical/High open") is met. 7 LOW, 4 INFO. PR11-SEC-01, -02, -04 and -08 are small changes to this PR's own code and are **recommended in this PR's fix cycle**; if they are not taken here they become tracked follow-ups with the owners in §6. |

## 1. Summary

The core control is sound. Every check that the O3 property depends on holds up under independent probing against the real `@prisma/client` 7.10.1 runtime:

- **Context statement.** The data-model §4.1 eight-setting statement runs as the first statement of the interactive transaction (probe log: `TX1 begin` → `WITH prev AS MATERIALIZED …` → callback SQL → `COMMIT`). `is_local` is the literal `true` eight times. Every bound value is a validated string; a non-string (`Prisma.Sql`, `String` object, `null`) is refused before checkout. The `MATERIALIZED` leak detector throws `DB_SESSION_CONTEXT_LEAK` before `fn` runs, and a missing row counts as a leak (fail closed).
- **Re-entrance.** `NESTED_TENANT_TX` is a run-time `AsyncLocalStorage` throw shared by every runner instance (AT-US-075-04).
- **Error mapping.** On the real Prisma runtime with a synthetic driver error, a `P2010` (raw) and a `P2039` (model) 42501 map to 403 `AUTHZ_DENIED` + `rls_write_rejected` for the RLS prefix and to 500 + `db_privilege_denied` otherwise. Neither the `DbError` nor its JSON carries the table name, `detail` or `hint`; `DbError` has no `cause`.
- **Helpers and catalogue.** Helpers are fail-closed for NULL, `''` and malformed values (F-07 catalog test). C13 asserts the exact `platform_app` role rows including the new `statement_timeout=30s` backstop and no `app.%` row in `pg_db_role_setting`/`pg_parameter_acl`. PR5-SEC-09 now covers predefined `pg_*` roles. The authz catalogue is SELECT-only through C5 equality. The PR8-SEC-14 backstop keys on the key rule and has a planted-row control.
- **Supply side.** The bootstrap file `02-role-backstops.sql` is clean: first statement `SET search_path`, no variables, idempotent, ledger-pinned. `readSecret` meets the D-ARCH-052 list. `prisma-client-construction` is keyed on the explicit `apps/*/src/platform/db/**` path, so the two planned SYSTEM-writer files are **not** exempt.

The LOW findings are completeness gaps around these controls. None of them is exploitable without a developer or migration-author defect that also passes review:

- **01:** the run-time `TenantDb` Proxy can be stepped around through Prisma's `$parent` back-reference, on the client and on every model delegate. Proven: `db.$parent._originalClient` runs SQL on a **non-transaction connection** without context.
- **02:** the rule-16 linter and the C-series `prosrc` scan miss eight PostgreSQL-valid write forms (concatenated key, quoted function name, `format('%I')`, quoted or spaced GUC names) and are narrower than ADR-0005 am. 10 item 1 (i).
- **03:** the predicate allow-list exists only in the renderer. A hand-written tautology policy passes rule 9, rule 16 and C3, and the renderer's own operator policy **fails** rule 16, so the first module migration will hit a false positive.
- **04:** C5 ignores grants to `PUBLIC`, which reach `platform_app` (and `TRUNCATE` bypasses RLS).
- **05:** the raw-SQL and driver lint perimeter has holes: `Prisma.raw`; `pg` in repositories, which is the open part of the PR2-SEC-05 addendum; services outside `db-raw-sql`; the test-folder hole; and an unowned T-83 rule.
- **06:** the C11 "`platform_definer` owns exactly …" condition of P3 deviation 7 is not implemented.
- **07:** the PR's own rule-5 probe shows that migration files are **not atomic**. That makes rule 11's acceptance of `SET LOCAL lock_timeout` ineffective and leaves rule 15's "grants before `OWNER TO`" alternative with durable partial states.

## 2. Method

| Probe (scratch, session-scoped) | What it did | Result |
|---|---|---|
| **P-A** `tenantdb-escape.mjs` | `git archive 557aada` sources plus the worktree's generated client, type-stripped with Node 24.22.3 (`stripTypeScriptTypes`, transform mode) and run against the worktree's `node_modules` through a scratch junction (removed afterwards). Real `@prisma/client` 7.10.1 runtime with a **recording fake driver adapter**: each statement is logged with the queryable that ran it (`TXn` or `ROOT-conn`). It ran `createWithTenantTx(...).withTenantTx(ctx, fn)`, the escape candidates inside `fn`, and raw/model 42501 errors through `mapDbError` | Controls hold (`$queryRawUnsafe`, `$transaction`, `_originalClient` throw). **Escapes succeed:** `db.$parent.$executeRawUnsafe` → `TX1` (unguarded); `db.$parent.$transaction` → `SAVEPOINT prisma_sp_0`; `db.$parent._originalClient.$executeRawUnsafe` and `db.permission.$parent._originalClient…` → **`ROOT-conn`**; a symbol-keyed property → `TX1` unguarded. Mapping: P2010/P2039 correct; leak regex over JSON + message + stack = false |
| **P-B** `rule16.mjs` | 16 function bodies through `scanFunctionBodies` (C-series) and `lintMigrationDir` (rule 16), with positive controls | Controls flagged by both. 8 write forms and 2 read forms missed (table in PR11-SEC-02) |
| **P-C** `rendered-lint.mjs` | The renderer's own TENANT block pasted into a migration; a tautology policy through the linter and `scanPolicies` | Rendered block → **rule 16 finding** on the operator policy. `USING (org_id = org_id)` → linter none, C3 none; `USING (org_id IS NULL)` → C3 none |
| **P-D** `eslint-probe.mjs` | 9 cases through `ESLint#lintText` on the worktree's real `eslint.config.mjs` (`disableTypeChecked`, `projectService: false` overrides) | POS-CONTROL `new PrismaClient` in a repository → `platform/prisma-client-construction`. Clean (no security rule fires): `pg.Pool` in a repository; `Prisma.raw(input)` in a repository; `$parent.$queryRawUnsafe` in a service; a new file under `prisma/tests/catalog/` with `SET app.org_id`; a repository file under `tests/` with `$queryRawUnsafe` and an unchecked `updateMany`; a transaction-local `set_config('app.org_id', …)` in `session-integrity.ts`. The unlisted `prisma/tests/rls/helper.ts` control → `platform/tenant-context-sql` |
| Source review | All SQL, the C-series queries, the bootstrap runner and linter, ESLint rules and config, the unit and integration tests | — |
| Secrets | Added lines (excluding `.env.example`, which is off-limits to this agent) grepped for credential shapes: 0 hits. Positive control "password": 13 hits, all lint fixtures and patterns. gitleaks was not run (Docker off-limits); lane A covers the merge | Clean |

**Not executed:** the PostgreSQL integration and catalog suites. I rely on the PR body's serial gate on `557aada` (integration 95 passed / 1 skipped, coverage 99.17 % lines, lint/typecheck/build/audit clean). The PostgreSQL validity of the quoted and spaced `SET`/`RESET` forms in PR11-SEC-02 follows from `gram.y` (`var_name: ColId | var_name '.' ColId`) and is not run here. The fix should add them as executed C-series fixtures, which proves validity and coverage together.

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR11-SEC-01 | The `TenantDb` run-time guard is bypassable through Prisma's `$parent` (client and model delegates) and symbol keys; `$parent._originalClient` reaches the root client | LOW | CWE-693 | A01 | `apps/api/src/platform/db/tenant-db.ts:22-30, 40-42, 62-73` | TASK-016 (this PR) | Open |
| PR11-SEC-02 | Rule 16 and the C-series `prosrc` scan miss PostgreSQL-valid write/read forms; both are narrower than am. 10 item 1 (i) | LOW | CWE-184, CWE-488 | A04 | `prisma/tests/catalog/scans.ts:73-81`; `tools/db/lint-migrations.ts:251-257, 575-584` | TASK-016 (this PR) | Open |
| PR11-SEC-03 | The predicate allow-list is enforced only in the renderer: hand-written policies pass rule 9/16 and C3; the renderer's own operator policy fails rule 16 | LOW | CWE-184, CWE-863 | A01 | `tools/db/lint-migrations.ts:506-532, 581-583`; `prisma/tests/catalog/scans.ts:35-56` | TASK-016 or TASK-037 (before the first `CREATE POLICY` migration) | Open |
| PR11-SEC-04 | C5 excludes `PUBLIC` grants; rule 8 ignores `TO PUBLIC` and `TRUNCATE`/`TRIGGER`/`REFERENCES` | LOW | CWE-732 | A01 | `prisma/tests/catalog/c01-c12.int.test.ts:163-172`; `tools/db/lint-migrations.ts:534-556` | TASK-016 (this PR) | Open |
| PR11-SEC-05 | Raw-SQL and driver lint perimeter: `Prisma.raw` not banned; `pg`/`pg-pool` still allowed in repositories and planned SYSTEM writers (PR2-SEC-05 addendum); `db-raw-sql` scope; test-folder hole; T-83 rule unowned | LOW | CWE-89 (precursor), CWE-284 | A03, A01 | `tools/eslint-rules/db-raw-sql.mjs:12-44`; `eslint.config.mjs:181-183, 579-582` | TASK-016 / orchestrator (T-83) | Open |
| PR11-SEC-06 | The C11 converse condition of P3 deviation 7 (`platform_definer` owns exactly the §4.5 functions + `app_is_operator`, no other function, relation or type) is not implemented | LOW | CWE-269 | A01 | `prisma/tests/catalog/c01-c12.int.test.ts:546-602` | TASK-016 (or TASK-037) | Open |
| PR11-SEC-07 | Migration files are not atomic (decision 4): rule 11 accepts an ineffective `SET LOCAL lock_timeout`; rule 15's "grants before `OWNER TO`" form and grant-before-RLS ordering leave durable unsafe partial states; a file may end inside `SET ROLE platform_definer` | LOW | CWE-696 | A04 | `tools/db/lint-migrations.ts:245, 558-571`; ADR-0005 am. 10 item 9; data-model §8.3/§8.4 | TASK-016 (linter) + principal-architect (text) | Open |
| PR11-SEC-08 | Exemption hygiene: the `prisma/tests/catalog/**` glob; `session-integrity.ts` pre-exempted for the setter; spike-exemption lifecycle | INFO | CWE-693 | A05 | `eslint.config.mjs:101, 107, 109` | TASK-016 (this PR); TASK-015 (spike) | Open |
| PR11-SEC-09 | Composition-root wiring (D-TASK016-01 (a)–(c)) is recorded only in DECISIONS; until done, the leak sinks, the fresh-connection probe and the env passed to the `PGOPTIONS` check are unwired. The `DbError` → problem+json surface is unspecified | INFO | CWE-778, CWE-209 | A09 | `with-tenant-tx.ts:68-77, 275-279, 327-331`; `map-db-error.ts:113-138` | orchestrator → second of PR #9 / PR #11 | Open |
| PR11-SEC-10 | Risk statement: the DR-A14 special policies lie outside the allow-list (decision 5); requirements for the TASK-037 resolution | INFO | CWE-863 | A01 | data-model §4.3 `:2521-2553` | principal-architect + TASK-037 | Open |
| PR11-SEC-11 | Hardening list (a)–(h): helper name qualification, C13 case-folding and `proconfig`, trigger-raised 42501 events, `readSecret` open-once, C1/rule 9 schema scope, `$executeRaw` UPDATE in `expect-affected`, GLOBAL read-only flag, `lc_messages` | INFO | various | A05 | see item | as listed | Open |

### PR11-SEC-01 (LOW): the `TenantDb` run-time guard is bypassable through `$parent`

**Description.** Am. 10 item 1 makes the `Proxy` the run-time half of `TenantDb`, because "`Omit<…>` alone is compile-time only: `as any` or a structural cast bypasses it" (PR7-SEC-05). The Proxy blocks the three omitted members, the lifecycle members and top-level `_`-prefixed keys (`tenant-db.ts:22-42`). It does not block three things:

- **`$parent`.** In `@prisma/client` 7.10.1, every client and every model delegate carries a `$parent` layer: `ae("$parent",()=>e._appliedParent)` in `runtime/client.js`, for `Zn` (model) and `Yt` (client). For an interactive-transaction client, `_createItxClient` sets `_appliedParent` to `this._appliedParent._createItxClient(...)`. So `db.$parent` is a **full, unguarded transaction client** of the same transaction. Its `_originalClient` is the **root `PrismaClient`**.
- **Symbol keys.** `ae(Xn, () => e)` exposes the underlying client under a module-private symbol that `Object.getOwnPropertySymbols(db)` enumerates.
- **Nested objects.** Model delegates are returned unwrapped, so `db.<model>.$parent` is open even if `db.$parent` were blocked.

Probe P-A, inside `withTenantTx`, with statements recorded per connection:

```
db.$parent.$executeRawUnsafe('SELECT 101')                         -> TX1 executeRaw   (unguarded *Unsafe)
db.$parent.$transaction(async sp => …)                             -> TX1 savepoint prisma_sp_0 (F-01 savepoint re-exposed)
db.$parent._originalClient.$executeRawUnsafe('SELECT 103')         -> ROOT-conn        (outside the transaction, no context)
db.permission.$parent._originalClient.$executeRawUnsafe('SELECT 104') -> ROOT-conn
<symbol-keyed value>.$executeRawUnsafe('SELECT 105')               -> TX1
```

`db.constructor` is also returned, as a bound `PrismaClient` class (`new db.constructor({ adapter })`). That path needs an adapter, whose import is banned by lint, so it is minor.

**Exploitability / impact.** It needs developer code that casts (`$parent` is typed only through `Prisma.getExtensionContext`; `TransactionClient` does not declare it). That is exactly the cast the Proxy exists to defeat. Reaching the root client recreates the PR7-SEC-01 hazards:
- SYSTEM-table writes (audit, outbox, idempotency) commit outside the business transaction;
- absence-based checks on RLS tables read 0 rows;
- a nested savepoint can swallow a 42501.

`*Unsafe` on `$parent` is an injection surface whose payload can `set_config('app.org_id', <victim>, true)` (T-35). Likelihood L × Impact M → **LOW**, consistent with PR7-SEC-05. The reviewer-focus question "any path back to the root client" is answered **yes**.

**Remediation (code).** In `tenant-db.ts`:
- block `$parent` and `constructor`;
- return `undefined` for symbol keys;
- hide blocked keys from `getOwnPropertyDescriptor`/`ownKeys`;
- wrap object-valued members (the model delegates) in the same guard. The callback still receives only Prisma's normal surface.

```ts
const BLOCKED: ReadonlySet<PropertyKey> = new Set<PropertyKey>([
  ...TENANT_DB_OMITTED, '$connect', '$disconnect', '$on', '$use', '$extends', '$runCommandRaw',
  '$parent',     // extension back-reference: unguarded client of the same tx; its _originalClient is the root client
  'constructor', // bound PrismaClient class
]);
const isBlocked = (key: PropertyKey): boolean => BLOCKED.has(key) || (typeof key === 'string' && key.startsWith('_'));

function guard<T extends object>(target: T, state: { closed: boolean }): T {
  const cache = new Map<PropertyKey, unknown>();
  return new Proxy(target, {
    get(t, key) {
      if (state.closed) throw new DbError(dbErrorMapping(500, 'TENANT_TX_CLOSED'));
      if (typeof key === 'symbol') return undefined;            // hides Prisma's private client symbol
      if (isBlocked(key)) throw new TenantDbAccessError(key);
      if (cache.has(key)) return cache.get(key);
      const value: unknown = Reflect.get(t, key, t);
      const out = typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(t)
        : typeof value === 'object' && value !== null ? guard(value, state)   // model delegates get the same rules
        : value;
      cache.set(key, out);
      return out;
    },
    getOwnPropertyDescriptor: (t, key) =>
      typeof key === 'symbol' || isBlocked(key) ? undefined : Reflect.getOwnPropertyDescriptor(t, key),
    ownKeys: (t) => Reflect.ownKeys(t).filter((k) => typeof k !== 'symbol' && !isBlocked(k)),
    // has / set / defineProperty / deleteProperty / setPrototypeOf as today
  });
}
```

Respect the Proxy invariants: run the test below against the real runtime, not a `FakeTx`. Also add `$parent` to the `db-raw-sql` member list (PR11-SEC-05).

**Verification.** Add a unit or integration test on the **real Prisma runtime** with a recording adapter; probe P-A is a ready pattern. Inside `withTenantTx`:
- `(db as any).$parent`, `(db as any).<model>.$parent`, `db.constructor` and every `Object.getOwnPropertySymbols(db)` value throw or are `undefined`;
- the adapter log shows **no** statement on a non-transaction connection between `begin` and `commit`.

### PR11-SEC-02 (LOW): rule 16 and the `prosrc` scan miss PostgreSQL-valid forms

**Description.** Am. 10 item 1 (i) rejects "any write form — `set_config(`, `SET`/`SET SESSION`/`SET LOCAL` followed by `app.`, `RESET`, `DISCARD`". The implementation narrows this.

- **C-series** (`scans.ts:75`): `set_config(` passes when its first token is a quoted literal not starting with `app.`. That admits `'' || 'app.org_id'`. Reads are matched only for the literal-key form.
- **Linter** (`lint-migrations.ts:251-257`): `set_config ?\( ?(?:'app\.|[^' ])` admits the same concatenation. `SET`/`RESET` match only an unquoted `app.` with no space. Dynamic `current_setting(k)` reads are not flagged at all, although the C-series flags them.

Probe P-B (both scanners, positive controls flagged):

| Form | C-series | Rule 16 |
|---|---|---|
| `set_config('' \|\| 'app.org_id', p, true)` | missed | missed |
| `"set_config"('app.org_id', p, true)` / `pg_catalog."set_config"(…)` | missed | missed |
| `EXECUTE format('SET LOCAL %I = %L', 'app.org_id', p)` (idiomatic plpgsql) | missed | missed |
| `SET LOCAL "app".org_id = …` / `RESET "app".org_id` / `SET app . org_id = …` | missed | missed |
| `EXECUTE 'SET LOCAL "app.org_id" = ' \|\| quote_literal(p)` | flagged | missed |
| `current_setting('app.' \|\| 'org_id', true)` / `EXECUTE format('SHOW %s', 'app.org_id')` | missed | missed |
| `current_setting(k, true)` (dynamic) | flagged | **missed** |

GUC names are case-insensitive and `var_name` accepts quoted parts, so each form writes or reads `app.org_id`. A related lexical residual is in rule 13 (PR5-SEC-11): `SET "search_path" = public` after the fixed path is not counted. C11's `proconfig` query (`DEFINER_PATH_SQL`) still catches it in the catalogue.

**Exploitability / impact.** It needs a migration author to write such a function (the `format('%I')` form is common plpgsql) and review to miss it. Impact: a transaction-local write switches tenant for the rest of the caller's transaction (T-35). A session-level write leaks to the next checkout (caught for `withTenantTx` users by the item 16 detector, but not for root-client users). Likelihood L × Impact M → **LOW**, the same rating as PR7-SEC-11.

**Remediation (code; one list shared by `scans.ts` and rule 16).**

```ts
const KEY = String.raw`(?:(?:"app"|app)\s*\.\s*"?(?:org_id|actor_id|actor_scope|guest_token_hash)\b|"app\.(?:org_id|actor_id|actor_scope|guest_token_hash)")`;
const WRITE_FORMS = [
  ['set_config(', /(?:\bset_config|"set_config")\s*\(/i],                     // ANY call (am. 10 item 1 (i)); allow-list by regprocedure if ever needed
  ['SET/RESET app.', /\b(?:set|reset)\s+(?:session\s+|local\s+)?(?:"app"\s*\.|app\s*\.|"app\.)/i],
  ['RESET ALL', /\breset\s+all\b/i],
  ['DISCARD', /\bdiscard\b/i],
] as const;
const KEY_MENTION = new RegExp(KEY, 'i');                                     // outside the §4.2 helpers: any mention (catches format/%I, SHOW)
const DYNAMIC_READ = /\bcurrent_setting\s*\(\s*(?!'[^']*'\s*[,)])/i;          // outside the helpers: non-literal key
```

Apply `KEY_MENTION` and `DYNAMIC_READ` to every function except the §4.2 helpers (C-series by `regprocedure`; rule 16 by `HELPER_DEFINITION`), with string literals kept. Keep the `app.correlation_id` allowance; `KEY` does not match it. For rule 13, count `\bset\s+"?search_path"?\b`.

**Verification.** Add every row of the table above as a fixture:
- as C-series `it.each` cases executed on PostgreSQL (which also proves each form is valid SQL);
- as rule-16 linter fixtures.

The current catalogue and `20261112020000_platform_rls_helpers` must stay clean.

### PR11-SEC-03 (LOW): the allow-list stops at the renderer

**Description.** Am. 10 item 7 says the renderer emits policies **only** from the §4.3 templates. PR7-SEC-07 item 1 asked for the allow-list in the renderer **and the migration linter**. Today:

1. Rule 9 checks `DROP`/`ALTER POLICY` and ENABLE + FORCE, but never compares a `CREATE POLICY` with the renderer output.
2. C3 is a deny-list plus a snapshot that the same PR updates.

Probe P-C:
- `CREATE POLICY … USING (org_id = org_id) WITH CHECK (org_id = org_id)` → **no linter finding, no C3 finding**;
- `USING (org_id IS NULL)` on a GUEST_CAPABLE table, which exposes every guest row to every session → **no C3 finding**.

Conversely, the renderer's **own** TENANT block fails rule 16 (`reads a tenant security key outside the §4.2 helpers`). The operator template's `current_setting('app.actor_scope', true) = 'OPERATOR'` is not exempted in the linter, although C3 exempts its deparsed form (`scans.ts:19`). TASK-037's first RLS migration will therefore fail lint. The quick fix, loosening rule 16 for policies, would open a hole.

**Exploitability / impact.** A fail-open policy needs a migration author and a reviewer miss. Impact: cross-tenant or all-guest reads. Likelihood L × Impact M (after review) → **LOW**, consistent with PR7-SEC-07.

**Remediation (code).**
1. **Rule 16.** Exempt exactly the rendered operator atom, and only inside `CREATE POLICY`:
   ```ts
   const OPERATOR_ATOM = "current_setting('app.actor_scope', true) = 'operator'"; // normalised
   const readText = /^create policy\b/.test(texts[index] ?? '') ? withStrings.split(OPERATOR_ATOM).join(' ') : withStrings;
   ```
2. **Rule 9.** Every `CREATE POLICY` in `prisma/migrations/**` must equal, after `masked()` normalisation, a statement of `renderRls(entry)` for its table's manifest entry. The only alternative is an entry in a reviewed exemption file keyed by `table.policy` plus the exact normalised text (PR11-SEC-10). Otherwise rule 9 reports "policy not rendered from the templates".
3. **C3.** Add a keyed-atom presence check to `scanPolicies`: every `TO platform_app` qual/with_check references `platform.app_org_id()`, `platform.app_actor_id()`, `platform.app_guest_token_hash()` or `platform.app_is_operator()`. That catches `org_id IS NULL`, `org_id = org_id` and `1 = 1`. Preferably also derive the expected policy set from the manifests and the renderer, rather than from a snapshot the author edits.

**Verification.**
- Linter fixtures `policy-tautology` and `policy-unkeyed` fail.
- A fixture holding the rendered TENANT, GUEST_CAPABLE and USER_OWNED blocks lints **clean**.
- C3 planted `p_bad_tautology` and `p_bad_unkeyed` are reported.

### PR11-SEC-04 (LOW): C5 ignores `PUBLIC`; rule 8 ignores `TO PUBLIC` and RLS-bypassing privileges

**Description.** data-model C5 states that "table and column privileges of `platform_app` equal the grant manifest". `TABLE_ACL_SQL` filters `a.grantee <> 0` (`c01-c12.int.test.ts:166, 171`), so a grant to `PUBLIC`, which `platform_app` holds implicitly, is invisible. Rule 8 tests the grantee with `PLATFORM_APP` only and checks only `delete|all`.

So `GRANT TRUNCATE ON public.<tenant table> TO PUBLIC` (TRUNCATE is **not** subject to RLS), `GRANT INSERT ON public.role_permissions TO PUBLIC` (authz escalation), or `GRANT TRIGGER …` passes both the linter and C5. Function `EXECUTE` to `PUBLIC` is covered by C11. The PR5-SEC-09 membership assertion closes the role-membership path, which leaves `PUBLIC` as the only implicit path.

**Exploitability / impact.** It needs a migration author to grant to `PUBLIC`, which is plausible for "everyone may read" reference tables, and a review miss. A write or `TRUNCATE` grant then gives `platform_app` RLS-independent power. Likelihood L × Impact M → **LOW**.

**Remediation (code).**

```sql
-- TABLE_ACL_SQL, both halves: include PUBLIC, render it, and let the manifest (which cannot express PUBLIC) refuse it
SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END || ' ' || a.privilege_type || ' ' || …
 WHERE n.nspname IN ('public', 'platform')
   AND (a.grantee = 0 OR a.grantee::regrole::text IN ('platform_app', 'platform_definer', 'platform_erasure'))
```

In `lint-migrations.ts` rule 8:
- report a table/sequence `GRANT … TO PUBLIC`;
- report `TRUNCATE`, `TRIGGER` and `REFERENCES` granted to `platform_app` (`/\b(?:truncate|trigger|references)\b/` on the privilege list).

**Verification.**
- A planted, rolled-back `GRANT TRUNCATE ON public.permissions TO PUBLIC` makes C5 fail.
- Linter fixtures `grant-to-public` and `truncate-to-app` fail.

### PR11-SEC-05 (LOW): raw-SQL and driver lint perimeter

**Description.** Probe P-D found five gaps.

1. **`Prisma.raw(input)` lints clean in a repository.** `$queryRaw(Prisma.raw(s))` is the injection equivalent of the banned `$queryRawUnsafe`, and PR7-SEC-05 item 3 listed `Prisma.raw(`. The binding text of am. 10 item 4 names only the two `*Unsafe` members, so this is residual hardening, not a missed binding item.
2. **`import pg from 'pg'; new pg.Pool(…)` lints clean in a repository.** In `packages/audit/src/store/prisma-store.ts` the only finding is the incidental `import-x/no-extraneous-dependencies`. The PR2-SEC-05 addendum asked that `pg`/`pg-pool` value imports be allowed only under `apps/*/src/platform/db/**`; `DATABASE_CODE` (`eslint.config.mjs:183`) still includes `repository` and the planned files. A second pool runs without context, and SYSTEM writes leave the business transaction.
3. **`db-raw-sql` covers `platform/db` and repositories only.** A service holding the `TenantDb` can call `$parent.$queryRawUnsafe` with no finding.
4. **The new rules inherit the `**/{test,tests,__tests__}/**` hole.** A non-test file under `repository/tests/` escapes `db-raw-sql`, `expect-affected` and `prisma-client-construction` (PR-0002 test-folder hole).
5. **T-83 is unowned.** The "no external calls inside `withTenantTx`" lint (PR2-SEC-05 T-83 half) has no owner in any sheet or decision. The per-transaction `statement_timeout`/`idle` settings and Prisma `timeout` now bound the impact, so the residual is LOW.

**Exploitability / impact.** No vulnerable code exists, and each item needs a developer anti-pattern plus a review miss. Impact for item 1: SQL injection as `platform_app`, which can switch tenant inside the transaction. Likelihood L × Impact M (two review gates remain) → **LOW**.

**Remediation (code).**

```js
// tools/eslint-rules/db-raw-sql.mjs
const UNSAFE_MEMBERS = new Set(['$executeRawUnsafe', '$queryRawUnsafe', '$parent']);
// + CallExpression: callee `Prisma.raw` (MemberExpression, object Identifier `Prisma`, property `raw`) and a named
//   import of `raw` from '@prisma/client-runtime-utils' / '@prisma/client/runtime/*' → messageId 'prismaRaw'
```

```js
// eslint.config.mjs
{ files: [`apps/*/src/**/*.${LINTED}`, ...PLANNED_PRISMA_FILES], ignores: TEST_FILES, plugins: { platform },
  rules: { 'platform/db-raw-sql': 'error' } },   // was: DB_PLATFORM + REPOSITORY_FILES
// SQL driver only in the database platform core, prisma/, tools/db and tests (PR2-SEC-05 addendum):
{ from: { file: { categories: { anyOf: ['db-platform-core', 'prisma', 'tools-db', 'test'] } } },
  allow: SQL_DRIVER_TARGETS.map((to) => ({ to })) },
```

Anchor `TEST_FILES` (PR2-SEC-09 owners TASK-004/007). The orchestrator assigns T-83: either a rule reporting `fetch`/`OutboundHttpClient`/queue calls lexically inside a `withTenantTx(` callback, or a principal-architect amendment of the T-83 verification to "review + Semgrep".

**Verification.** Negative fixtures for `prisma-raw` (repository), `pg-pool` (repository and `packages/audit/src/store/prisma-store.ts`), `parent-unsafe` (service) and `repository/tests/helper.ts`; each must fail.

### PR11-SEC-06 (LOW): C11 does not assert `platform_definer`'s owned-object set

**Description.** P3 review §15 accepted deviation 7 (`platform_definer` holds `CREATE` on `platform`) on the condition that "C11 adds the converse assertion: `platform_definer` owns exactly the §4.5 functions plus `app_is_operator`, and no other function, relation or type" (D-ORCH-005 (7)). C11 (`:546-602`) checks only `prosecdef` functions against the allow-list. A view, table, type or invoker function owned by `platform_definer` passes.

A definer-owned **view** in `platform` reads the definer-read tables under their `USING (true)` policies, which is every tenant's rows. Only C5 equality, through a manifest line for a grant to `platform_app`, stands between that and cross-tenant reads.

**Exploitability / impact.** It needs a migration that runs `SET ROLE platform_definer` and creates such an object, plus a manifest edit, plus a review miss. Likelihood L × Impact M → **LOW**. It is listed because the deviation's acceptance rests on it.

**Remediation (code, C11).**

```sql
SELECT 'proc' AS kind, p.oid::regprocedure::text AS obj FROM pg_catalog.pg_proc p WHERE p.proowner = 'platform_definer'::regrole
UNION ALL SELECT 'rel',    c.oid::regclass::text  FROM pg_catalog.pg_class c     WHERE c.relowner  = 'platform_definer'::regrole
UNION ALL SELECT 'type',   t.oid::regtype::text   FROM pg_catalog.pg_type t      WHERE t.typowner  = 'platform_definer'::regrole
UNION ALL SELECT 'schema', n.nspname              FROM pg_catalog.pg_namespace n WHERE n.nspowner  = 'platform_definer'::regrole
-- expected: exactly the `allowed` procs with owner platform_definer (today: none committed); nothing else
```

**Verification.** A planted, rolled-back `SET ROLE platform_definer; CREATE VIEW platform.v AS SELECT 1;` and an invoker function are both reported.

### PR11-SEC-07 (LOW): the consequences of non-atomic migration files

**Description.** Decision 4 and `prisma/README.md` "Rule 5" establish that `migrate deploy` (Prisma 7.10.1 / PG 18.6) runs a file's statements one at a time, outside a transaction block, and that a failed file keeps the effects of its earlier statements. Three linter assumptions break.

1. **Rule 11 accepts `SET LOCAL lock_timeout`** (`LOCK_TIMEOUT = /^set (?:local |session )?lock_timeout\b/`, `:245`). Outside a transaction block `SET LOCAL` "emits a warning and otherwise has no effect" (PostgreSQL *SET*). A file that complies with rule 11 that way runs its `ALTER TABLE` with **no** lock timeout. That is the deploy-time lock pile-up NFR-AVAIL-003 guards against.
2. **Rule 15's accepted alternative, "grants before `OWNER TO`" (`handedOver`, `:563`), now has a real window and a durable failure state.** If `ALTER FUNCTION … OWNER TO platform_definer` fails after `GRANT EXECUTE … TO platform_app` succeeded, a **migrator-owned** `SECURITY DEFINER` function executable by `platform_app` stays in place. The migrator owns the SYSTEM/GLOBAL tables, which have no RLS (PR7-SEC-09). Similarly, a `GRANT … TO platform_app` placed before a table's `ENABLE`/`FORCE ROW LEVEL SECURITY` leaves a granted table without RLS if a later statement fails.
3. **A file may end inside `SET ROLE platform_definer`** (no end-of-file check). The rest of the file, and later files if the deploy connection is reused, then create objects owned by `platform_definer`. This links to PR11-SEC-06.

**Exploitability / impact.** It needs a partially failed deploy plus a further defect or injection to use the left-over object. Item 1 is an availability exposure on every deploy that uses `SET LOCAL`. Likelihood L × Impact M → **LOW**.

**Remediation.**
- **Rule 11:** `LOCK_TIMEOUT = /^set (?:session )?lock_timeout\b/`, with a fixture where `SET LOCAL lock_timeout` must fail.
- **Rule 15:** report a file whose statements end with the definer role still set. principal-architect amends am. 10 item 9 so that the **`SET ROLE` form is the only accepted form**, and rule 15 drops the `handedOver` branch.
- **Rule 9:** a `GRANT` to `platform_app` on an RLS-class table must come after that table's `ENABLE` + `FORCE` (and its policies) in the same file.
- **data-model §8.3/§8.4** (principal-architect): "a migration file is not atomic; order statements so that every prefix of the file leaves the schema safe".

**Verification.** Fixtures `set-local-lock-timeout` (rule 11), `definer-role-not-reset` (rule 15) and `grant-before-force` (rule 9) each fail.

### PR11-SEC-08 (INFO): exemption hygiene

- **`prisma/tests/catalog/**`** (`eslint.config.mjs:109`) is a folder glob with `tokens` + `session-set`. Am. 10 item 1 and PR7-SEC-10 require exact-file exemptions. Probe P-D: a new `prisma/tests/catalog/helper.ts` with `SET app.org_id` lints clean. Replace it with `prisma/tests/catalog/c01-c12.int.test.ts` (`tokens`, `session-set`) and `prisma/tests/catalog/scans.ts` (`tokens`).
- **`session-integrity.ts`** (`:101`, a future TASK-006 file) is exempted with `tokens`, which also admits a **transaction-local `set_config('app.org_id', …, true)`** (probe P-D). That would make a second context writer lint-legal. Split the `tokens` form into `keys` (security-key text, which the readiness reads need) and `setter` (`set_config`). Give `session-integrity.*` only `keys`; `with-tenant-tx.ts` keeps both.
- **The spike exemption** (`:107`) allows all three forms. Remove it **in the same commit** that deletes `prisma/tests/spikes/spk03-rls-tx.int.test.ts`; a stale entry would exempt any future file at that path.

### PR11-SEC-09 (INFO): composition-root wiring and the `DbError` surface (acceptance list)

D-TASK016-01 assigns (a)–(c) to "whichever of PR #9 / PR #11 merges second", and records this only in DECISIONS. Until they are done, no runtime path uses `withTenantTx`, so there is no exposure. When wired, the review checks:

1. **One composition function inside `apps/*/src/platform/db/`**, the only importer of `client.ts`, builds the client and the runner and returns the runner only. The worker uses the same.
2. **`deps.env` is omitted** (so `process.env` is checked) and is never `{}`. A test proves the `PGOPTIONS` refusal through the composition function. This closes PR9-SEC-03's factory half.
3. **`probeFreshConnection()` is awaited at start-up** before readiness turns ready. A failure means not-ready / exit 78.
4. **Sinks:**
   - `onSecurityEvent` goes to the TASK-010 security logger with `{event, correlationId, sqlState}` only;
   - the counter becomes a metric;
   - `markNotReady('db_session_context_leak')` **latches**: PR #9's 5-minute re-check must not clear it.
5. **`EXPECTED_ROLE_SETTINGS` gains `statement_timeout=30s`**, and the lock_timeout-RESET test asserts drift ((a), (b)).
6. **problem+json for `DbError`** carries `status`, the catalogue `code`, `Retry-After` from `retryAfterSeconds` and generic text. It never carries `message` (`"Database error: RLS_WRITE_REJECTED"`), `reason`, `sqlState` or `prismaCode`; those are log-only.

Owner: the orchestrator writes these into the follow-up task (TASK-006 follow-up or TASK-020).

### PR11-SEC-10 (INFO): risk statement for the DR-A14 special policies (decision 5)

- **Today.** There is no exposure, because the tables do not exist yet.
- **As written, the policies are fail-closed.** Every context reference is `= platform.app_*()`. But they use shapes outside the renderer allow-list (`EXISTS`, `id =`) and a forbidden token (`<>`), so TASK-037 cannot ship them through the renderer or C3 as they stand.
- **The risk is in the resolution.** An exemption "by policy name" would permanently remove those tables from C3 and from PR11-SEC-03's rule-9 check, and later edits to an exempted predicate would go unchecked.

Requirements for principal-architect's choice:
1. **Prefer named renderer templates** (`org-member-read`, `member-orgs-read`, `own-by-id`, `active-org-by-id`) with their own exact shapes. The renderer and C3 stay the only source.
2. **If an exemption list is chosen**, key it by `table.policy` plus the exact normalised predicate (or its SHA-256), in one reviewed file read by both rule 9 and C3, under CODEOWNERS with security-analyst. Any drift fails.
3. **Inside an `EXISTS`**, every context reference is `col = platform.app_*()`; no `coalesce`/`IS DISTINCT FROM`/`NOT` touches a context value.
4. **Replace `m.status <> 'REMOVED'` with a positive list**, for example `m.status IN ('ACTIVE','INVITED','SUSPENDED')`. The deny-list form makes a user's row readable by fellow members for any **future** status value by default: fail-open on enum growth. `p_organisations__member_read` already uses a positive list.
5. **Keep the "memberships policies reference no other RLS table" invariant** as a C-series assertion; otherwise policy recursion raises 42P17. The TASK-024 generator covers these policies.

### PR11-SEC-11 (INFO): hardening list

| # | Item | Owner |
|---|---|---|
| a | The §4.2 helper bodies resolve `current_setting`, `~*` and `decode` through the caller's `search_path` (inlined SQL). Qualify them as `pg_catalog.current_setting(…)`, `OPERATOR(pg_catalog.~*)` and `pg_catalog.decode(…)`. Inlining is unaffected (only `SET`, `SECURITY DEFINER` or a non-SQL language prevent it). The current text equals data-model §4.2, so the data-model changes first | data-architect → next helper migration |
| b | C13 `c LIKE 'app.%'` / `parname LIKE 'app.%'` are case-sensitive, while GUC names are not. Use `lower(c) LIKE 'app.%'`. Also assert no `pg_proc.proconfig` entry `ILIKE 'app.%'`: function `SET` clauses on placeholders need superuser or `SET` privilege, so only the bootstrap lane could add one | TASK-016 / TASK-021 |
| c | Trigger-raised 42501/23514 (`AUDIT_IMMUTABLE`, `GUEST_DECLAIM_FORBIDDEN`) map to `db_privilege_denied` / `DB_ERROR`. Am. 10 item 6 asks that the event name come from the message, so add distinct events when TASK-021/051 land | TASK-021, TASK-051 |
| d | `readSecret` stats and reads by path (`statSync` then `readFileSync`), not on one handle with `O_NOFOLLOW` as the `file` provider does (PR3 bar). A swap between the two calls can force an unbounded read before the size re-check. Open once, `fstatSync(fd)`, bounded `readSync` | TASK-016 / TASK-034 |
| e | C1 and rule 9 cover `public` only. A table in `platform` escapes the RLS assertions (C5 still covers its grants). Extend C1 to every non-system schema, or assert that `platform` holds no table | TASK-016 / TASK-037 |
| f | `platform/expect-affected` covers `updateMany`/`deleteMany` only. A `$executeRaw` `UPDATE`/`DELETE` result is unchecked | TASK-051 (raise to `error`) |
| g | The GLOBAL authz tables are SELECT-only by C5 equality alone. A `runtimeReadOnly` manifest flag, checked by `validateGrants`, would refuse a write line at parse time | TASK-016 / TASK-020 |
| h | The RLS prefix check reads English server text. A non-English `lc_messages` maps an RLS rejection to 500 + `db_privilege_denied` (fail-safe). Pin `lc_messages = 'C'` for `platform_app` in the bootstrap lane, or note the dependency | TASK-014 / M5 |

## 4. Closure of the binding items

**A. PR-0007 §5 and round 2**

| Item | Status | Evidence / residual |
|---|---|---|
| PR7-SEC-01 (MEDIUM): no exported client; `NESTED_TENANT_TX`; SYSTEM writers on `TenantDb`; P2028 → 503; AT-US-075-04 run-time | **Closed for TASK-016's scope**, residual PR11-SEC-01 | `index.ts` does not re-export `client.ts`; `db-root-client` boundaries policy + fixture; ALS guard shared across runners; P2028/P2034 → 503 (unit + integration). SYSTEM writers do not exist yet: check at TASK-025/043. The `$parent` path reaches the root client (PR11-SEC-01) |
| PR7-SEC-02: literal `true`, validated strings; fresh probe; `PGOPTIONS`; C13 `app.%`; negative control | **Closed**, wiring per PR11-SEC-09 | `with-tenant-tx.ts:141-169, 187-205, 276-278, 327-331`; C13 (d); `session-scope-leak.int.test.ts` (pool 1, pid per step, RESET in `finally`) |
| PR7-SEC-03 item 1 (`originalCode`) / item 4 (`errorFormat`) | **Closed** / closed in PR #9 (PR-0009) | P-A: real-runtime P2010 and P2039 map correctly with no text |
| PR7-SEC-05: Proxy; token ban with exact-file exemptions; `prosrc` scan | **Partially closed** | Proxy: PR11-SEC-01. Exemptions: PR11-SEC-08 (catalog glob). Scan: PR11-SEC-02 |
| PR7-SEC-06: per-transaction lock/idle/statement timeouts; C13 rows; `ALTER ROLE` lint | **Closed** (TASK-016 part) | Eight-setting statement; C13 (d) exact rows; `platform/no-alter-role-sql`. Readiness drift: PR #9 + PR11-SEC-09 item 5 |
| PR7-SEC-07: renderer allow-list; C3 forbidden tokens; (linter allow-list) | **Partially closed** | Renderer ✓, C3 ✓ (8 planted policies). Linter half and C3 tautology/unkeyed: PR11-SEC-03. C12 guest probes: TASK-024 |
| PR7-SEC-09 → rule 15 | **Closed**, with PR11-SEC-07 | 4 fixtures; template under `SET ROLE platform_definer` |
| PR7-SEC-11: scan by form across all non-system schemas incl. `platform` | **Closed for scope** (namespaces), residual PR11-SEC-02 | `PROSRC_SQL` `USER_NAMESPACES`; 3 negative fixtures executed on PG |
| PR7-SEC-13: F-02 text; `expectAffected`; lint | **Closed** | `expect-affected.ts`; integration title "INSERT: 42501; UPDATE/DELETE: 0 rows silently"; `platform/expect-affected` at `warn`, blocking under `--max-warnings 0` |
| PR7-SEC-14 (binding per D-ARCH-066): `MATERIALIZED` detector | **Closed**, wiring per PR11-SEC-09 | Same round trip; throws before `fn`; event + counter + not-ready; negative control proves it fires and that NULL/`''` pass |

**B. PR-0008**

| Item | Status | Evidence |
|---|---|---|
| PR8-SEC-10: GLOBAL authz tables in the C1 allow-list; SELECT-only grants in the manifest | **Closed** | `authz.json`; `grants.manifest:15-17`; C5 equality. Hardening: PR11-SEC-11 g |
| PR8-SEC-13 fallback | **Not needed** | PR #10 (TASK-007) ships `tools/ci/check-migration-immutability.mjs` and `.github/CODEOWNERS`. If PR #11 merges first, its only migration change is an `A` entry |
| PR8-SEC-14: key-rule predicate; planted-row control | **Closed** | `ESCALATION_SQL`; rolled-back CUSTOMER_VIEWER→`audit:read` yields exactly 1 row; `webhook:%` = 0 |

**C. PR-0005, SEC-P3-34 and P3 deviation 7**

| Item | Status | Evidence |
|---|---|---|
| PR5-SEC-09: membership assertion incl. `pg_*` | **Closed** | C13 `pg_auth_members` exact set for every `platform_%` role on either side |
| PR5-SEC-11: rule 13 counts `SET search_path` = 1; `ALTER ROUTINE` | **Closed**; quoted-name residual in PR11-SEC-02 (C11 `proconfig` catches it) | `definerWithoutFixedPath`; 5 fixtures |
| PR5-SEC-12: bootstrap variables allow-list; `PASSWORD` operand | **Closed** | Rule S; 3 fixtures |
| C13 post-bootstrap; harness `options`; `pg_default_acl` `ns=0` rows | **Closed** | C11 three global `'f'` rows; C5 no r/S/T/n rows; C13 (c)/(d) |
| SEC-P3-34 (TASK-016 half): C13 bootstrap-role `search_path` row; no database-wide row | **Closed** | C13 (d) |
| P3 §15 deviation 7: C11 converse ownership assertion | **Open** | PR11-SEC-06 |

**D. PR-0002 and PR-0009**

| Item | Status | Evidence |
|---|---|---|
| PR2-SEC-05: `prisma-client-construction` on the explicit path | **Closed** | Rule ignores `DB_PLATFORM`, `prisma/**`, `tools/db/**` and tests only; P-D control fires in a repository |
| PR2-SEC-05 addendum: `pg`/`pg-pool` only under `platform/db` | **Open** | PR11-SEC-05 item 2 |
| PR2-SEC-05 T-83 lint | **Open, unowned** | PR11-SEC-05 item 5 |
| PR #5 R3-n1: `prisma/tests` import policy | **Closed** | Narrow `no-relative-packages` ignore + `prisma-tests` boundaries policy + negative fixture |
| PR9-SEC-03 (factory half): refuse `PGOPTIONS` | **Closed in the runner**, wiring per PR11-SEC-09 item 2 | `with-tenant-tx.ts:275-278` |

**E. SPK-03 F-01..F-13**

| F | Status | Note |
|---|---|---|
| F-01 | Closed, residual | Savepoints hidden on `TenantDb`, but re-exposed through `$parent.$transaction` (PR11-SEC-01) |
| F-02 | Closed | Run-time guard; text ported |
| F-03 | Closed | Explicit `{maxWait ≤ pool, timeout ≥ statement}`; per-transaction timeouts; P2028 → 503 |
| F-04 | Closed | Token ban; literal `true`; `SET LOCAL` banned in `platform/db` and repositories |
| F-05 | n/a here | TASK-032; the generic `TransactionCapableClient<TTx>` accepts the extended client |
| F-06 | Closed | `originalCode` on P2010/P2039 (real runtime) |
| F-07 | Closed | Helpers + catalog test; residual C3 allow-list (PR11-SEC-03) |
| F-08 | Closed | `guestTokenHash` = lowercase hex SHA-256, server-side; `^[0-9a-f]{64}$` |
| F-09 | Closed | 40001/40P01/55P03/57014 retryable |
| F-10 | Closed | Rule 15 + template; PR11-SEC-07 |
| F-11 / F-12 | n/a here | TASK-276 docs / dispatch template |
| F-13 | Closed | Superuser observer; runtime asserted through `platform_app` |

**F. ADR-0005 am. 10 items 1–16**

| Item | Status | Item | Status |
|---|---|---|---|
| 1 | Partial (PR11-SEC-01, -02, -08) | 9 | Closed (rule 15, template); PR11-SEC-07 |
| 2 | Closed (SYSTEM writers → TASK-025/043) | 10 | n/a (TASK-276) |
| 3 | Closed | 11 | Template closed (both `IS DISTINCT FROM` conditions); trigger + superuser tests → TASK-051 |
| 4 | Closed (wiring PR11-SEC-09) | 12 | Closed (02 file, statement, `DB_TX_*` keys, C13, lint); readiness → PR #9 + PR11-SEC-09 |
| 5 | n/a (TASK-032) | 13 | **Deferred to TASK-015** (C-1), acceptable (§5 ruling 2) |
| 6 | Closed | 14 | n/a (M5) |
| 7 | Closed as written; residual PR11-SEC-03 | 15 | Closed |
| 8 | Closed | 16 | Closed (wiring PR11-SEC-09) |

**G. Linter rules (SEC-TC-33 / NT-AVAIL-003-a).** Rules 3, 4, 5, 6, 7, 8, 9, 11, 14, 15 and 16 are implemented, each with negative fixtures, plus PR5-SEC-11/12. Residuals:
- rule 8: `PUBLIC`/`TRUNCATE` (PR11-SEC-04);
- rule 9: predicates and grant order (PR11-SEC-03, -07);
- rule 11: `SET LOCAL` (PR11-SEC-07);
- rule 15: end-of-file role and the alternative form (PR11-SEC-07);
- rule 16: forms (PR11-SEC-02).

`required-suites.json` still marks `migration-lint` and `catalog-c1-c14` as `planned`. Per the sheet, they activate with US-074; that is a qa-lead change at merge (§6).

**H. Catalog C1–C14 (SEC-TC-05 = C4, C11).**

| C | Status |
|---|---|
| C1 | Closed (`public` only, PR11-SEC-11 e) |
| C2 | Closed |
| C3 | Deny-list + snapshot (PR11-SEC-03) |
| C4 | Closed |
| C5 | `PUBLIC` gap (PR11-SEC-04) |
| C6, C7, C8, C9, C10 | **Not in this suite**, although the PR body says "C1-C12 green". C6/C7/C14 audit and immutability triggers belong to TASK-021/033 and C10 to TASK-028; C8/C9 need an owner. Routed in §6 |
| C11 | Closed except the converse (PR11-SEC-06) |
| C12 | Proven on a rendered probe; generator → TASK-024 |
| C13 | Closed |
| C14 | As far as the objects exist (TASK-021) |

**I. Sheet items.**
- **`readSecret` parity (D-ARCH-052):** closed (`bootstrap.ts`; tests cover outside root, `..`, junction escape, directory, > 64 KiB, missing, both set, empty, newline). Hardening in PR11-SEC-11 d.
- **`DB_TX_*` keys:** closed; the bounds are 100–120,000 / 100–60,000 / 1,000–600,000 ms.
- **AT-US-074-01..05 and AT-US-075-01..04:** present in the test titles; executed by senior-developer per the PR body.

## 5. Rulings on the PR's open decisions

1. **`GRANT EXECUTE ON FUNCTION platform.app_actor_id() TO platform_definer` (decision 3) is ACCEPTED.** The definer body calls the helper, `PUBLIC` holds no `EXECUTE` (global default privileges), and the function only reads a GUC. principal-architect adds it to data-model §4.4. When TASK-037 applies the template, C11's helper expectation for `app_actor_id` gains `platform_definer`.
2. **The C-1 deferral to TASK-015 is ACCEPTABLE from a security standpoint.** C-1 is a performance record (W-1, item 13), not a control. Conditions:
   - TASK-015's sheet carries C-1: today it is only in D-TASK016-01;
   - the spike file's `TENANT_CONTEXT_EXEMPTIONS` entry is removed in the deleting commit (PR11-SEC-08);
   - until then the spike runs only against throw-away test databases.
3. **The guardrail note on `02-role-backstops.sql` is ACCEPTED.** It changes no data, is idempotent, is ledger-pinned and is asserted by C13. Role defaults are not a boundary; the per-transaction values win.
4. **Decision 4 (non-atomic files)** has security consequences beyond rule 5: see PR11-SEC-07.
5. **Decision 5 (DR-A14):** see the PR11-SEC-10 risk statement. Security-analyst sign-off is required on the chosen mechanism before TASK-037 merges.
6. **Decision 7 (`TenantDb<TTx>` generic; P2034 → 503):** no objection.

## 6. Routing

| Owner | Item | Due |
|---|---|---|
| TASK-016 fix cycle (recommended) | PR11-SEC-01, -02, -04, -08 (all in this PR's code); optionally -06 and the rule 11/15 parts of -07 | Before merge if taken; otherwise before TASK-037 |
| TASK-016 or TASK-037 | PR11-SEC-03 (rule 16 operator-atom exemption is **required before TASK-037's first RLS migration**), PR11-SEC-06, PR11-SEC-11 e | Before the first `CREATE POLICY` migration |
| principal-architect | Am. 10 item 9 (`SET ROLE` form only), data-model §8.3/§8.4 non-atomicity wording (PR11-SEC-07); §4.4 grant (ruling 1); §4.2 qualification (PR11-SEC-11 a); DR-A14 mechanism (PR11-SEC-10); T-83 verification wording if no lint (PR11-SEC-05) | Before TASK-037 |
| orchestrator | Write PR11-SEC-09 items 1–6 into the task that wires the composition root; put C-1 on TASK-015's sheet; assign T-83; assign C8/C9 owners | Before the first `withTenantTx` consumer |
| qa-lead | Flip `migration-lint` and `catalog-c1-c14` to active in `required-suites.json` with US-074. The catalog suite runs only locally until TASK-015's `security-integration` job exists (D-ORCH-004 evidence) | At merge |
| TASK-025 / TASK-043 | SYSTEM writers take `TenantDb`; no client or `pg` of their own (PR2-SEC-05 addendum, PR11-SEC-05) | With those tasks |
| TASK-051 / TASK-021 | Trigger event names (PR11-SEC-11 c); `expect-affected` to `error` (f) | With those tasks |
| TASK-024 | C12 generator incl. guest probes (PR7-SEC-07 item 3) and the DR-A14 policies | Wave 0 |

## 7. ASVS / OWASP mapping

| ASVS | Status | Findings |
|---|---|---|
| V4.1.1, V4.1.3 (access control enforced at a trusted service layer, least privilege) | Met by FORCE RLS, NOBYPASSRLS and the grant manifest | Residuals PR11-SEC-01, -04, -06 |
| V4.1.5 (fail securely) | Met by the helpers, the fail-closed detector and the context validation | Residuals PR11-SEC-03, -07 |
| V5.3.4 (parameterised queries) | Met | Residual PR11-SEC-05 |
| V7.4.1 (generic errors) | Met for `mapDbError` | Surface PR11-SEC-09 item 6 |
| V14.1.x (configuration hardening) | Met by the 02 backstop, C13 and the `ALTER ROLE` lint | — |

OWASP 2021 categories as in §3.

Sources: `@prisma/client` 7.10.1 `runtime/client.js` (`Zn`, `Yt`, `_createItxClient`, `$parent`/`Xn` layers) and `@prisma/driver-adapter-utils` in the worktree's `node_modules`; PostgreSQL 18 documentation (*SET*: `SET LOCAL` outside a transaction block; *ALTER DEFAULT PRIVILEGES*; §5.9 *Row Security Policies*: `TRUNCATE` and `REFERENCES` are not subject to row security); `gram.y` `var_name`; PR #11 `prisma/README.md` "Rule 5".

## Round 2 (head a3e8edd)

| Field | Value |
|---|---|
| Scope | Delta `557aada..a3e8edd`: fix cycle 1, 5 commits (`5ed304a`, `a15e3d7`, `af518f2`, `7037db8`, `a3e8edd`), 92 files, +1,751 / −225. **No dependency change.** Unchanged in the delta: `with-tenant-tx.ts`, `map-db-error.ts`, the helpers migration, `02-role-backstops.sql`, `bootstrap.ts` |
| Head | `a3e8edde8ecc1b9ea94da2ef19c7a53c18433605` (`feat/TASK-016-row-level-security-foundations-table`) |
| Inputs | Fix comment https://github.com/sukhchdit/shipcube/pull/11#issuecomment-6833014750; `docs/03-architecture/rulings/wave-0-task-016-rulings.md`; DECISIONS D-ARCH-071..074; round 1 above |
| Reviewer / date | security-analyst, 2026-11-13. **No command run in the worktree** (no git, no cwd there): sources came from `git archive a3e8edd` in the main checkout, and the worktree's `node_modules` and git-ignored generated client were read through scratch junctions, which were removed afterwards. No install, build, Docker or suite run |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open, so the merge rule (D-ORCH-004) is met for the security dimension. **Closed:** PR11-SEC-01, -02, -03 (PR scope), -04, -05 (items 1–3), -06, -07 (finding items) and -08. **New:** 3 LOW (PR11-SEC-12, -13, -14) and 1 INFO (-15). **This is not a merge authorisation for `a3e8edd`.** The architecture's required items 1 (second half), 2 (b), 5, 6 and 8 are still open (§R2.5). They change security-owned paths, so the reconciliation head needs a Round 3 delta review, and lane A must be green on that exact head |

### R2.1 Summary

The fix cycle closes every round-1 route that was in scope, and probes confirm the closures against the real Prisma 7.10.1 runtime:

- `$parent` (top level and delegates), `constructor`, `_*` and Prisma's private symbol are refused. `then` reads `undefined`. Kept references throw `TENANT_TX_CLOSED`. `JSON.stringify(db)` throws.
- Every R1 rule-16 / C-series evasion is now flagged by both scanners, from one shared list.
- Rendered TENANT, GUEST_CAPABLE and USER_OWNED blocks lint clean. A tautology, an edited predicate, policy DDL in a DO block and a policy on a GLOBAL table each fail rule 9.
- C5 sees `PUBLIC`. The C11 converse exists. `SET LOCAL lock_timeout`, grants before `OWNER TO` and an unreset role all fail.
- The `pg` driver is confined to the platform core. Exemptions are exact files with the setter/keys split.

Three LOW completeness gaps remain. None is exploitable without a developer or migration-author defect that also passes review.

- **12: the deep guard stops at return values.** Every allowed member returns a `PrismaPromise`, and its `requestTransaction(null)` re-runs the query on a **non-transaction pooled connection** without context. This includes model operations, works **after commit** too, and proves false the PR's "no route to the root client" claim.
- **13: `Sql` objects splice raw SQL.** An `Sql` object interpolated **into** a tagged `$queryRaw` is spliced as raw SQL. `new Prisma.Sql`, a non-tagged `Prisma.sql([...])`, `Prisma.join(…, sep)`, an aliased `P.raw` and a runtime `Sql` import all lint clean and pass the tagged-only run-time check.
- **14: obfuscated forms evade the shared form list.** Unicode-escape identifiers (`U&"\0061pp"`), keyword-split dynamic SQL and fully computed `EXECUTE` get past rule 16 and the C-series. The C-series is the same lexical list, so it has no catalogue backstop for tenant-context writes.

### R2.2 Method

| Probe (scratch `review/PR-11-sec-r2/`, session-scoped) | What it did | Result |
|---|---|---|
| **P-A2** `tenantdb-escape-r2.mjs` | `git archive a3e8edd` sources, type-stripped (Node 24.22.3, transform mode). Run against the worktree's generated client and `node_modules` through a scratch junction: the real `@prisma/client` 7.10.1 runtime with a recording fake adapter (`TXn` vs `ROOT-conn`). Re-ran the R1 escapes, then new candidates inside `withTenantTx` and after commit | **R1 escapes refused** (`$parent`, `permission.$parent`, `constructor`, `_originalClient` → `TenantDbAccessError`; 0 symbols; `ownKeys` = 3 delegates + 3 raw members; `then` undefined; `JSON.stringify` throws; kept `db.permission` → `TENANT_TX_CLOSED`; kept lazy promise → "Transaction already closed"). **New:** `findMany().requestTransaction(null)` → `ROOT-conn`; `` $executeRaw`…`.requestTransaction(null) `` → `ROOT-conn`; `requestTransaction({kind:'batch'})` → `ROOT-conn`; kept promise `.requestTransaction(null)` **after commit** → `ROOT-conn`. Tagged `$queryRaw` with `${new Prisma.Sql([s],[])}`, `${Prisma.sql([s])}`, `${Prisma.join([1], ',', s)}` or `${Prisma.raw(s)}` → `s` spliced into the statement text on `TX1`. `$queryRawTyped` → refused by Prisma (typedSql preview off) |
| **P-B2** `rule16-r2.mjs` | 26 plpgsql bodies through `scanFunctionBodies` and `lintMigrationDir` | **All 12 R1 forms + control flagged by both.** Named-argument, `E'…'`-key and `ALTER FUNCTION … SET app.` forms are flagged. **Missed by both:** `SET LOCAL U&"\0061pp".org_id`, `U&"\0073et_config"('ap' \|\| 'p.org_id', …)`, `EXECUTE U&'SET LOCAL \0061pp.org_id = '…`, `EXECUTE 'SET' \|\| ' LOCAL ' \|\| 'app.' \|\| 'org_id' …`, `EXECUTE format('%s %s = %L', 'SET LOCAL', 'app.' \|\| 'org_id', p)`, `EXECUTE chr(83) \|\| …`, `EXECUTE r` (statement read from a table), and a read through `pg_show_all_settings()` with a split key. Benign `set_config('search_path')` and `app.correlation_id` are clean |
| **P-C2** `policy-grant-role-r2.mjs` | 29 migration fixtures through `lintMigrationDir` with the real manifests + 3 probe entries; `scanPolicies` rows | Rendered blocks clean (A1–A3). Rule 9: `OR true` edit, DO-block policy and policy on `permissions` fail; grant before ENABLE/FORCE fails (top level, incl. `ALL TABLES IN SCHEMA`). Rule 8: `TO PUBLIC` (also `"public"`, sequences), `TRUNCATE` to app fail. Rule 11: `SET LOCAL` fails. Rule 15: grants-before-`OWNER TO`, unreset role (also `SET role = …`) and `SET LOCAL ROLE` fail. **Clean (residuals):** grant inside DO (before FORCE, to PUBLIC, dynamic), `SET ROLE` inside DO, `set_config('role', …)`, `ALTER FUNCTION/VIEW … OWNER TO platform_definer`, `GRANT CREATE ON SCHEMA public TO PUBLIC`, `GRANT MAINTAIN`, `CREATE RULE`, `SET lock_timeout = '30s'` without `RESET`. C3 flags `org_id = org_id`, but **passes** `(platform.app_org_id() IS NULL) AND (org_id IS NULL)` and `platform.app_org_id() = platform.app_org_id()` |
| **P-D2** `eslint-probe-r2.mjs` | `ESLint#lintText` on the head's own `eslint.config.mjs` (full tree via `git archive`, `docs/` excluded; junctioned `node_modules`; `disableTypeChecked`, `projectService: false`) | R1 P1–P5/P8 now fire (`boundaries/dependencies`, `platform/db-raw-sql`, `platform/tenant-context-sql`); key read in `session-integrity.ts` is clean as intended; dynamic `import('pg')`, `pg` in a service and `@prisma/adapter-pg` in a repository fire. **Clean (residuals):** `new Prisma.Sql`, `Prisma.sql([…])`, `Prisma.join(ids, sep)`, `P.raw` (aliased), `const { raw } = Prisma`, `import { Sql } from '@prisma/client/runtime/client'`, `const { $queryRawUnsafe } = db`, ``db[`$parent`]``, `.requestTransaction(null)`, and `` $executeRaw`SET "app".org_id = …` `` / `SET app . org_id` in app code. A tagged bound-value control is clean |
| `lint-committed.mjs` | `lintMigrations` over the head's `prisma/migrations` | 0 findings |
| Secrets | Added lines (`.env*` excluded) grepped for credential shapes | 0 hits. Positive control `set_config`: 25 hits. The `secret`/`token` mentions are key names and tokenizer code |

**Not executed:** the PostgreSQL integration and catalog suites. I rely on the fix comment's serial gate on `a3e8edd` (unit 1184, integration 112 passed / 1 skipped, coverage 99.2 % lines, `db:lint-migrations` clean, audit clean).

The validity of the `U&` forms in PR11-SEC-14 follows from `scan.l` (`xuistart`) and `parser.c` (`UIDENT` → `IDENT`) and was not run here. The fix should add them as executed C-series fixtures, as was done for the R1 forms.

### R2.3 Closure of PR11-SEC-01..08

| ID | R2 status | Evidence / residual |
|---|---|---|
| PR11-SEC-01 | **Closed** (the R1 routes) | Deny-by-default deep guard (`tenant-db.ts:121-229`): only delegates + 3 raw members. A null-prototype target keeps the Proxy invariants. Delegates are child-guarded, and `revoke()` covers method references. P-A2 and the PR's real-client test show 0 `ROOT` statements for those routes. **Residual:** the returned promise (PR11-SEC-12) |
| PR11-SEC-02 | **Closed** for the R1 table | `tools/db/tenant-key-forms.ts` is shared by rule 16 and `scans.ts`, with 16 forms executed on PostgreSQL in the C-series. P-B2: all R1 rows flagged by both. **Residual class:** PR11-SEC-14 |
| PR11-SEC-03 | **Closed for PR scope** | Rule 16 b: exact operator atom, only in `CREATE POLICY`. Rule 9 a: `canonicalPolicy` equality with `renderRls(entry)`, keeping literals (U+E000 marker). C3: keyed-atom presence. **Remaining:** C3 presence does not check shape (P-C2 keyed tautologies pass C3; rule 9 a catches them in migrations). The derived expected set is TASK-024 (D-ARCH-072) |
| PR11-SEC-04 | **Closed** | `TABLE_ACL_SQL` includes `grantee = 0` → `PUBLIC` (table + column) and a planted rolled-back control. Rule 8 covers `TO PUBLIC` (tables, sequences, `ALL TABLES`) and `TRUNCATE/TRIGGER/REFERENCES/ALL` to app. **Residual:** grants inside DO blocks (PR11-SEC-15 a); C5 catches the catalogue result |
| PR11-SEC-05 | **Items 1–3 closed; 4 routed; 5 owned** | (1) `Prisma.raw` / named `raw` import / non-tagged call reported, plus the run-time tagged-only check; **residual class** in PR11-SEC-13. (2) `SQL_DRIVER_CODE` = platform core, `prisma/`, `tools/db`, tests (P-D2 R1-P1/P2, N13, N15). (3) `db-raw-sql` on all of `apps/*/src` + planned files. (4) Test-folder hole → PR2-SEC-09 owners TASK-004/007 (unchanged). (5) T-83 → TASK-020 (D-ARCH-074) |
| PR11-SEC-06 | **Closed** | `DEFINER_OWNED_SQL` (proc/rel/type/schema) asserted on the committed catalogue, with planted view + invoker-function controls. Done here instead of TASK-024 |
| PR11-SEC-07 | **Closed** (finding items 1–3) | Rule 11 accepts session form only. Rule 15 has the `SET ROLE` block only (`handedOver` removed); an unreset role at end of file fails; `SET LOCAL ROLE` does not count. Rule 9 b requires ENABLE+FORCE before the grant (earlier files tracked in `history.rlsProtected`). `prisma/README.md` describes the consequences. **Ruling extras still open:** §R2.5 items 1 and 2 |
| PR11-SEC-08 | **Closed** | Exact files only; `tokens` → `setter` + `keys`; `session-integrity.*` = `keys` (P-D2 R1-P8 fails, R1-P8b clean); spike entry carries the delete-together note (TASK-015 sheet per D-ARCH-074) |
| PR11-SEC-09 | Open | Reconciliation pass (D-ORCH-014; merge condition per D-ARCH-074) |
| PR11-SEC-10 | **Closed at design level** | D-ARCH-072 adopts requirements 1, 3, 4 and 5 (2 not needed). Sign-off at TASK-037/049 |
| PR11-SEC-11 | b closed; a, h open (required, §R2.5); c–g as routed | C13 `lower(…)` + `proconfig ILIKE 'app.%'` |

### R2.4 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR11-SEC-12 | `PrismaPromise.requestTransaction` returned by every allowed `TenantDb` member re-runs the query outside the transaction (root pool), also after commit | LOW | CWE-693 | A01 | `apps/api/src/platform/db/tenant-db.ts:167-176` (`bindMember` returns `fn.apply(raw, args)` unwrapped) | TASK-016 reconciliation pass (recommended); else TASK-020 | Open |
| PR11-SEC-13 | `Sql`-object values inside a tagged `$queryRaw`/`$executeRaw` splice raw SQL; constructor, non-tagged `sql`, `join` separators, aliased/destructured `raw` and runtime imports are lint-clean | LOW | CWE-89 (precursor), CWE-184 | A03 | `tools/eslint-rules/db-raw-sql.mjs:67-83`; `tenant-db.ts:195-199` | TASK-016 reconciliation pass (recommended); else TASK-020 | Open |
| PR11-SEC-14 | Obfuscated tenant-context writes evade the shared form list and therefore both rule 16 and the C-series: `U&` escapes, keyword-split or fully computed dynamic SQL | LOW | CWE-184 | A04 | `tools/db/tenant-key-forms.ts:28-61`; `lint-migrations.ts:336-346` (rule 10 DO bodies) | `U&` ban: TASK-016 reconciliation pass; dynamic-SQL allow-list: TASK-024; rule 10: TASK-021 | Open |
| PR11-SEC-15 | Residual linter/catalog gaps with catalogue backstops (DO-block grants/roles, `OWNER TO platform_definer`, schema ACL, `CREATE RULE`, TS quoted GUC names, `$queryRawTyped`, C3 shape) | INFO | CWE-184, CWE-732 | A05 | see list | as listed | Open |

#### PR11-SEC-12 (LOW): the deep guard stops at the returned promise

**Description.** Every exposed function is wrapped by `bindMember`, which returns `fn.apply(raw, args)` unchanged. For model operations and the raw members, that value is Prisma's `PrismaPromise`, whose `requestTransaction(t)` re-invokes the query callback with a caller-supplied transaction. In `runtime/client.js`, `ji(...)`:

- `requestTransaction(s){ let a = o(s); … }`;
- `o(s)` caches only for `undefined`/`itx` and otherwise calls `r(s)`;
- `Tm(null)` gives no transaction.

So `null`, or any `{kind:'batch'}` object, routes the query to the adapter itself, not to the interactive transaction. P-A2 showed this, logging each statement with the connection that ran it:

```
db.permission.findMany({…}).requestTransaction(null)         -> ROOT-conn queryRaw SELECT "public"."permissions"…
db.$executeRaw`SELECT 301`.requestTransaction(null)           -> ROOT-conn executeRaw SELECT 301
db.$executeRaw`SELECT 302`.requestTransaction({kind:'batch'}) -> ROOT-conn executeRaw SELECT 302
<promise kept from a committed withTenantTx>.requestTransaction(null) -> ROOT-conn executeRaw SELECT 501
```

The PR's real-client test asserts 0 `ROOT` statements only for the routes it exercises. The commit title's "no route to the root client" therefore does not hold.

**Exploitability / impact.** `requestTransaction` is not on the public `PrismaPromise<T>` type (`runtime/client.d.ts:2181`), so it needs a cast, the same precondition as round 1's `$parent`. No lint rule reports it (P-D2 N9).

The impact is the PR7-SEC-01 set:
- SYSTEM-table writes (audit, outbox, idempotency) commit outside the business transaction;
- reads of RLS tables run on a connection with no context and return 0 rows, so absence-based checks pass wrongly;
- a kept promise keeps working after the transaction settled, which defeats `revoke()`.

Likelihood L × Impact M → **LOW**, consistent with PR11-SEC-01.

**Remediation (code, `tenant-db.ts`).** Wrap what an exposed function returns. Hide `requestTransaction`, and wrap function-valued members (fluent relation accessors) recursively. Laziness is kept, because nothing runs until `then`/`catch`/`finally`.

```ts
/** A PrismaPromise without `requestTransaction` (it re-runs the query with a caller-chosen transaction; null = root pool). */
function guardResult(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || typeof Reflect.get(value, 'then') !== 'function') return value;
  return new Proxy(value, {
    get(target, key) {
      if (key === 'requestTransaction') return undefined;
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === 'function'
        ? (...args: unknown[]) => guardResult((member as AnyFunction).apply(target, args))
        : member;
    },
    has: (target, key) => key !== 'requestTransaction' && Reflect.has(target, key),
  });
}
// bindMember: return guardResult(fn.apply(raw, args));
```

Also drop `$queryRawTyped` from `TENANT_DB_RAW_MEMBERS` until typedSql is adopted (PR11-SEC-15 f).

**Verification.** Extend `prisma/tests/rls/tenant-db.real-client.test.ts`:
- For a model operation, a fluent accessor, `$queryRaw` and `$executeRaw`, `(p as any).requestTransaction` is `undefined`.
- Calling it through a retained raw reference is impossible.
- The `ROOT` log stays empty, including for a promise kept past commit.

#### PR11-SEC-13 (LOW): `Sql` values in a tagged template splice raw SQL

**Description.** The fix checks that the **first** argument of `$queryRaw`/`$executeRaw` is a `TemplateStringsArray`, and the lint reports `Prisma.raw(…)` and a named `raw` import. But `sql-template-tag` (`@prisma/client-runtime-utils` `Sql` constructor) flattens any interpolated `Sql` instance into the statement text. `raw(v)`, `new Sql([v], [])`, a non-tagged `sql([v])` and `join(values, separator, prefix, suffix)` all produce such instances from arbitrary strings. The generated namespace exports `sql`, `join`, `raw` and `Sql` (`internal/prismaNamespace.ts:50-55`), and repositories may import `@prisma/client/runtime/client`, which exports `Sql`, `sqltag`, `join`, `raw` and `makeTypedQueryFactory`.

P-A2: `` db.$queryRaw`SELECT ${new Prisma.Sql([s], [])}` `` ran `SELECT 1; SELECT set_config('app.org_id', 'victim', true)` on `TX1`. The same happened for `Prisma.sql([s])`, `Prisma.join([1], ',', s)` and `Prisma.raw(s)`. P-D2: N1–N6 lint clean. The fix comment's "`Prisma.sql` objects … are refused" holds only for the first argument.

**Exploitability / impact.** It needs a developer to build a fragment from input; dynamic `ORDER BY` / column lists are the classic case. It also needs review to miss it. With `Prisma.raw` now banned, the constructor or `join` separator is the obvious lint-driven workaround. Impact: SQL injection as `platform_app` inside the tenant transaction, including `set_config('app.org_id', …)` (T-35). Likelihood L × Impact M → **LOW**, consistent with R1's PR11-SEC-05.

**Remediation (code, `tools/eslint-rules/db-raw-sql.mjs`).** Track local bindings imported from `PRISMA_SOURCES` (the namespace `Prisma` under any alias, and the named helpers), then report:

```js
// on an identifier bound to an import from PRISMA_SOURCES (namespace member or named import):
//  - any use of `raw` or `Sql` (call, `new`, member access, re-export, destructuring `const { raw, Sql } = Prisma`)
//  - `sql` / `sqltag` used as a CALL (only the TaggedTemplateExpression form binds values)
//  - `join(values, …)` with a 2nd-4th argument that is not a string Literal (separator/prefix/suffix are raw text)
//  - a named import of `makeTypedQueryFactory` / `TypedSql` outside the generated client
//  - any `new <x>.Sql(` / `new Sql(` regardless of binding (cheap belt and braces)
```

The run-time guard cannot tell a legitimate `` Prisma.sql`…` `` fragment from `raw(input)`, so lint is the control. Keep `Prisma.join(ids)` with the default separator and tagged `` Prisma.sql`…` `` fragments legal.

**Verification.** Add negative fixtures for N1–N6 (repository) and a service variant. A `Prisma.join(ids)` + tagged-fragment control lints clean.

#### PR11-SEC-14 (LOW): obfuscated forms evade the shared tenant-context form list

**Description.** `tenant-key-forms.ts` is lexical, and the C-series uses the **same** list on `prosrc`, so there is no independent catalogue check for tenant-context writes inside function bodies. P-B2 shows three PostgreSQL-valid classes that neither scanner sees:

1. **Unicode escapes.**
   - `U&"\0061pp"` is a quoted identifier, so `SET LOCAL U&"\0061pp".org_id = …` and `U&"\0073et_config"(…)` evade the forms.
   - `U&'…'` strings evade them in dynamic SQL.
   - No migration in this repository needs `U&`.
2. **Keyword-split dynamic SQL.** Examples: `'SET' || ' LOCAL ' || 'app.' || 'org_id'`, or `format('%s %s = %L', 'SET LOCAL', 'app.' || 'org_id', p)`. The dynamic-SET form needs whitespace after `SET` and then `%` or `'`, and the key-mention form needs the key unsplit.
3. **Fully computed statements.** Examples: `EXECUTE r` from a table, or `chr()` building. Rule 10 has the same blind spot for data changes in DO blocks, as the fix comment notes.

A trigger function of class 1–3 fires inside `platform_app`'s `withTenantTx` transaction, and trigger execution does not check `EXECUTE` at fire time. It switches tenant for the rest of that transaction (T-35).

**Exploitability / impact.** Unlike R1's PR11-SEC-02 forms, none of these is idiomatic: each needs deliberate obfuscation by a migration author plus a CODEOWNERS review miss. Impact: a cross-tenant read/write within the transaction. Likelihood L × Impact M → **LOW**.

**Remediation.**
- (a) **This PR (`tenant-key-forms.ts`, one entry + fixtures).** Add a write form `['Unicode-escape string or identifier', /\bu&["']/i]`. It applies to every function body and migration statement, the helpers included.
- (b) **TASK-024 (catalog family).** Add a dynamic-SQL allow-list. The C-series reports every plpgsql function whose `prosrc` matches `/\bexecute\b/i` and that is not on a reviewed `regprocedure` list; today that is `platform.ensure_audit_partitions(integer)`. Rule 16 reports `EXECUTE` in a `CREATE FUNCTION` body unless the function is listed. That turns "computed" into "reviewed".
- (c) **TASK-021 (rule 10 DO-body carry-overs, D-ARCH-074).** A DO block whose `EXECUTE` operand is not a single literal (or `format()` with a literal template) needs `data-changing: yes`.

**Verification.**
- Add C-series fixtures (executed on PostgreSQL) and linter fixtures for N1, N2 and N7 (must fail after (a)), and for N3–N6 (must fail after (b)).
- The committed catalogue stays clean, with `ensure_audit_partitions` on the list.

#### PR11-SEC-15 (INFO): residuals with catalogue backstops

| # | Residual (P-C2 / P-D2) | Backstop today | Owner |
|---|---|---|---|
| a | Rules 8, 9 b and 15 do not read DO bodies: `GRANT … TO PUBLIC`/app, a grant before FORCE, and a persisting `SET ROLE platform_definer` inside `DO $$…$$` lint clean. Apply the rule-10 body expansion (`sqlText(…, true)`) to these three rules, or forbid GRANT/REVOKE/SET ROLE inside DO | C5 (grants incl. PUBLIC), C11 converse (definer-owned objects), C1 (ENABLE/FORCE) | TASK-021 (with the rule-10 DO-body carry-overs) |
| b | `SELECT set_config('role', 'platform_definer', false)` changes the role without rule 15 seeing it; the setter exemption admits non-`app.` literals. Treat a `role`/`session_authorization` key as a rule-15 `SET ROLE` | C11 converse | TASK-024 |
| c | `ALTER FUNCTION/VIEW … OWNER TO platform_definer` lints clean (rulings item 2 (b), see §R2.5) | C11 converse | Reconciliation pass |
| d | `GRANT CREATE ON SCHEMA public` (or `platform`) `TO PUBLIC` (or `platform_app`) has no lint rule and no catalog assertion (`01-schemas.sql` sets the intended ACL). Add rule 14 (`grant … on schema` bootstrap-only) and a C13 assertion that `has_schema_privilege('platform_app', n.oid, 'CREATE')` is false for every non-system schema | None | TASK-024 |
| e | `CREATE RULE … DO ALSO …` on a table runs its action with the table owner's (migrator's) privileges; there is no lint rule and no catalog check. Assert `pg_rewrite` holds only `_RETURN` rules of views | None (CODEOWNERS review) | TASK-024 |
| f | `$queryRawTyped` is exposed. It is inert while the typedSql preview is off (P-A2). If typedSql is enabled, `makeTypedQueryFactory` (importable by repositories) builds a `TypedSql` from any string. Drop it from the guard until adopted (PR11-SEC-12) and ban the factory import (PR11-SEC-13) | Prisma preview flag | Reconciliation pass / TASK-020 |
| g | TS `platform/tenant-context-sql` misses quoted or spaced GUC names (`` $executeRaw`SET "app".org_id = '…'` ``, `SET app . org_id`); `db-raw-sql` misses `$parent`/`*Unsafe` reached by destructuring or a template-literal key. Port the shared namespace pattern into the `.mjs` rule; report `ObjectPattern` keys and template-literal computed keys | Run-time guard refuses `$parent`/`*Unsafe`; the leak detector catches a session `SET` at the next checkout (not the in-transaction switch) | TASK-020 (`lint` lock) |
| h | C3 keyed-atom presence passes keyed tautologies (`app_org_id() = app_org_id()`, `app_org_id() IS NULL AND org_id IS NULL`) | Rule 9 a in migrations | TASK-024 (C3 derived set, D-ARCH-072) |
| i | `MAINTAIN` (PG 17+) is not in rule 8's RLS-independent list (`LOCK TABLE` is an availability concern only) | C5 equality | TASK-024 |

### R2.5 Architecture "Required in PR #11 before merge" (rulings §"Required code changes") at `a3e8edd`

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Rule 11 session-only; `RESET lock_timeout` at end of file when the value exceeds `3s` | **Partial**: session-only done; **RESET requirement not implemented** | P-C2 D1 fails; D3 (`SET lock_timeout = '30s'`, no RESET) lints clean |
| 2 | Rule 15: `handedOver` removed; outside-block definer fails; `ALTER … OWNER TO platform_definer` fails; end-of-file role fails; fixtures | **Partial**: (a), (c) and the fixtures done; **(b) `OWNER TO platform_definer` ban not implemented** | P-C2 E2/E3/E9 fail; E7/E8 clean (C11 converse is the backstop) |
| 3 | Rule 9 b grant order | **Done** (top-level statements; DO-body residual PR11-SEC-15 a) | P-C2 B1/B2 |
| 4 | Rule 16 b operator atom; rendered blocks lint clean | **Done** | P-C2 A1–A3 |
| 5 | Qualified helper bodies in `20261112020000_platform_rls_helpers` (unmerged) | **Not done** | Bodies unchanged at `a3e8edd` (unqualified `current_setting`, `~*`, `decode`) |
| 6 | `02-role-backstops.sql` `lc_messages = 'C'`; C13 five rows; `EXPECTED_ROLE_SETTINGS` row | **Not done** | File unchanged (one `ALTER ROLE`) |
| 7 | C13 case folding + `proconfig ILIKE 'app.%'` | **Done** | C13 (d) |
| 8 | D-ORCH-014 (a)–(f) and PR11-SEC-09 items 1–6 | **Not done** (declared for the merge-main pass) | Fix comment "Still open" |

Items 5 and 6 edit an unmerged migration and an unmerged bootstrap file. After merge, both become immutable-file follow-ups (D-ARCH-073), so they belong in the reconciliation pass.

### R2.6 Routing (additions to §6)

| Owner | Item | Due |
|---|---|---|
| TASK-016 reconciliation pass | §R2.5 items 1 (RESET), 2 (b), 5, 6, 8. Recommended: PR11-SEC-12 (`guardResult`), PR11-SEC-13 (lint), PR11-SEC-14 (a) (`U&` form), PR11-SEC-15 c and f | Before merge (items 1, 2, 5, 6, 8 per rulings); recommended items else as below |
| TASK-020 | PR11-SEC-12 / -13 if not taken in PR #11; PR11-SEC-15 g; verify PR11-SEC-09 at the `tx` slot (unchanged) | Wave 0.6 |
| TASK-024 | PR11-SEC-14 (b) dynamic-SQL allow-list; PR11-SEC-15 b, d, e, h, i (with the C3 derived set, C11, C1 scope it already owns) | Before TASK-037 |
| TASK-021 | PR11-SEC-14 (c) and PR11-SEC-15 a (DO-body reading for rules 8/9 b/10/15) | With its rule-10 carry-overs |

### R2.7 What Round 3 checks on the reconciliation head

1. The delta to the reconciliation head, including the `main` merge.
2. §R2.5 items 1, 2 (b), 5, 6 and 8:
   - the helper bodies equal data-model §4.2, and the C-series and F-07 stay green;
   - the C13 rows equal the five-row set;
   - the composition function satisfies PR11-SEC-09 items 1–6, including the `DbError` problem body.
3. Whichever of PR11-SEC-12, -13, -14 (a) and -15 c/f were taken; re-run P-A2 / P-B2 / P-D2.
4. The record names the final head, and lane A is green on it.

## Round 3 (head 37a2109)

| Field | Value |
|---|---|
| Scope | Net change `git diff 63accea 37a2109`: 377 files, +10,071 / −226. It touches no `docs/` or `.claude/` path, and neither `package-lock.json` nor `prisma/schema`. Reviewed in three parts: **fix delta** `a3e8edd..80bcda1` (`b00cd6e`, `91c90bf`, `41afe58`, `80bcda1`; 57 files, +1,469 / −125); **merge** `d68898a` (parents `80bcda1` + `63accea`); **reconciliation** `d68898a..37a2109` (`ddf27d6`, `a7df29f`, `198328a`, `9482f38`, `37a2109`; 21 files, +875 / −153) |
| Head | `37a21099d8188d33aba3b155de559d1b17e82b2f` (`feat/TASK-016-row-level-security-foundations-table`) |
| Inputs | Fix and reconciliation comment https://github.com/sukhchdit/shipcube/pull/11#issuecomment-6835514581; lane A comment https://github.com/sukhchdit/shipcube/pull/11#issuecomment-6835649182; `docs/03-architecture/rulings/wave-0-task-016-rulings.md`; DECISIONS D-ARCH-071..074, D-ORCH-014, D-ORCH-018; rounds 1–2 above |
| Reviewer / date | security-analyst, 2026-11-13. **No command was run in the worktree.** Sources came from `git archive 37a2109` in the main checkout and were type-stripped into scratch. `node_modules` came through a scratch junction to the main checkout's install (the PR's `package-lock.json` equals main's). The generated client is the round-2 scratch copy (`prisma/schema` is unchanged since `a3e8edd`). Junctions were removed afterwards. No install, build, Docker, gitleaks or suite run |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open, so the merge rule (D-ORCH-004) is met for the security dimension. **Closed:** PR11-SEC-09 (items 1–6), -11 a and h, -12, -13, -14 (a), and -15 c, f and g. Every architecture item "Required in PR #11 before merge" is done: items 1, 2 (b), 5, 6 and 8 in this round, items 3, 4 and 7 in round 2. **New:** 1 LOW (PR11-SEC-16, `E'…'` escape strings in `EXECUTE` operands) and 1 INFO (PR11-SEC-17); neither blocks. **This round authorises the content of `37a2109` for merge.** `37a2109` itself is not merged: its merge commit `d68898a` carries main's since-scrubbed literal (lane A gitleaks is red). Per D-ORCH-018 the superseding branch merges instead, after (1) a supersede round in this record names its head (§R3.7) and (2) lane A is green on that head |

### R3.1 Summary

The fix delta and the reconciliation close every round-2 item that was in PR scope. The probes confirm this against the real Prisma 7.10.1 runtime and the head's own linters:

- **`TenantDb` results are wrapped (PR11-SEC-12).**
  - What an exposed member returns is a frozen, null-prototype, lazy thenable with only `then`, `catch`, `finally` and `Symbol.toStringTag`.
  - `requestTransaction`, `spec` and the fluent accessors are gone.
  - A result kept past commit rejects with `TENANT_TX_CLOSED` and sends nothing.
  - The P-A3 SQL log has **0 `ROOT-conn` statements**.
- **`Sql` fragments are refused at run time and reported by lint (PR11-SEC-13).**
  - Every non-forged fragment shape is refused before Prisma is called.
  - The lint now resolves bindings, and all six round-2 lint-clean shapes are reported.
- **`U&` is refused by both scanners (PR11-SEC-14 a).** Comment-split forms read as written, and rule 16 and the C-series share `sqlText`.
- **Linter rules 11 and 15.**
  - Rule 11 requires `RESET lock_timeout` when a file leaves the value above 3 s. The value parser fails closed.
  - Rule 15 fails any `ALTER … OWNER TO platform_definer`.
- **Helpers and role backstops.**
  - The helper bodies are byte-identical to data-model §4.2.
  - `platform_app` runs with `lc_messages = 'C'` and cannot change it (42501).
- **The composition function (`platform/db/runtime.ts`).**
  - It refuses `PGOPTIONS` before it builds or validates anything.
  - The fresh-connection probe is the first client query.
  - A leak latches readiness to not ready until restart.
  - Security events carry `component`, `correlationId` and `sqlState` only.
  - The `DbError` problem body comes from catalogue data only, with a bounded `Retry-After`.

Two residuals remain, neither blocking:

- **16 (LOW):** `E'…'` escape strings decode `\x61` / `\141` / `a` in the lexer just as `U&` does, so a dynamic `EXECUTE E'SET LOCAL \x61pp.org_id = …'` evades both scanners.
- **17 (INFO):** the limits of the new controls:
  - a deliberate `Sql` forge passes the duck-typed check;
  - the lint's binding analysis does not follow the namespace through arguments, literals or conditionals;
  - rule 11 does not track `"lock_timeout"`, `set_config('lock_timeout', …)` or a `SET` inside a DO body.

### R3.2 Method

| Probe (scratch `review/PR-11-sec-r3/`, session-scoped) | What it did | Result |
|---|---|---|
| **P-A3** `tenantdb-escape-r3.mjs` | Real `@prisma/client` 7.10.1 runtime and generated client, with a recording fake adapter (`TXn` vs `ROOT-conn`) and `createWithTenantTx` from the stripped head | **Controls:** `$parent`, `permission.$parent`, `_originalClient`, `$queryRawTyped` and `$transaction` → `TenantDbAccessError`; `ownKeys(db)` = 3 delegates + `$queryRaw`, `$executeRaw`. **Result surface:** keys `then, catch, finally, Symbol(Symbol.toStringTag)`; prototype `null`; frozen; `requestTransaction`, `spec`, `constructor` and the fluent `.roles` are `undefined`; `"requestTransaction" in result` is false; assignment and `defineProperty` throw. It is lazy (0 statements until `then`), and `then` returns a native `Promise`. **After commit:** kept unstarted and started results, a kept `$queryRaw` reference and a kept delegate → `TENANT_TX_CLOSED` with no statement. A result returned from the callback (async or sync) runs on its own transaction before `revoke`. **`Sql` values refused:** `Prisma.raw`, `Prisma.sql([s])`, `Prisma.join([1], ',', s)`, `new Prisma.Sql`, `Prisma.empty`, a tagged fragment (by design), a subclass, `new (fragment.constructor)(…)`, a plain object re-parented to `Sql.prototype`, and a JSON `{strings, values}` value. An array of fragments is bound as `$1`. **Spliced (deliberate forges):** forge 1 (an intermediate prototype with its own `constructor` and array-like `strings`; `instanceof Sql` but `isSqlFragment` false) and a frozen array with a frozen `raw` (the documented limit). **`ROOT-conn` statements: 0** |
| **P-B3** `rule16-r3.mjs` | 29 PL/pgSQL bodies through `scanFunctionBodies` and `lintMigrationDir` | **Both scanners flag:** the control; R1 rows W1, W2, W4, W5, W8 and R2; `U&` identifier, setter and string; lower-case `u&`; `U&'…' UESCAPE '!'`; `RESET U&"…"`; `set_config(E'app\x2eorg_id', …)`; `EXECUTE E'SELECT set_config(\x27…'`. **Missed by both (stated limits):** keyword-split, `format('%s %s')`, table-read `EXECUTE r`, `chr()`, hex-`decode` and `pg_show_all_settings`. **Missed by both (PR11-SEC-16):** `EXECUTE E'SET LOCAL \x61pp.org_id = '…`, octal `\141pp`, `app` and `app\x2eorg_id`. **Clean controls:** `set_config('search_path')`, `app.correlation_id`, `menu & 'x'`, `U&` inside a comment |
| **P-C3** `policy-grant-role-r3.mjs` | 33 migration fixtures through `lintMigrationDir` with the real manifests | **Round-2 regression unchanged:** rendered TENANT block clean; `OR true` and grant-before-FORCE → 9; `SET LOCAL` → 11. **Rule 11:** `30s`, `3001`, `'0'`, `'0x7fffffff'`, `'1e4'`, `'1 min'`, a comment inside `SET /* c */ lock_timeout`, and a re-raise after `RESET` all fail. `RESET`, `TO DEFAULT`, `3s`, `SESSION … 2.5s` and `500us` are clean. Parser: `0`, hex and exponent → ∞. **Missed (PR11-SEC-17 c):** `SET "lock_timeout" = 0`, `set_config('lock_timeout', '0', false)`, `SET` inside DO. **Rule 15:** `ALTER FUNCTION`, `VIEW` (quoted role), `TABLE`, `ROUTINE /* c */`, `SEQUENCE` (upper case), `TYPE` and `MATERIALIZED VIEW … OWNER TO platform_definer` all fail. The `platform_definer_x` control is clean. `ALTER FUNCTION … SECURITY DEFINER` → 13. `CREATE SCHEMA … AUTHORIZATION platform_definer` → 14. **Clean:** `OWNER TO` inside DO `EXECUTE` (PR11-SEC-15 a). `REASSIGN OWNED BY platform_migrator TO platform_definer` is also clean but cannot run: PostgreSQL requires the privileges of both roles, and the migrator's membership is `INHERIT FALSE` (`00-roles.sql:40`). C11 converse |
| **P-D3** `eslint-probe-r3.mjs` | `ESLint#lintText` on the head's own `eslint.config.mjs` (full tree from `git archive`, `docs/` excluded; `disableTypeChecked`, `projectService: false`) | **`platform/db-raw-sql` reports** all round-2 residual rows N1–N9, plus the factory import, `require`, `import()`, the default import, the generated-path import and `@prisma/client-runtime-utils`. **`platform/tenant-context-sql` reports** N10 and N11. **Clean (PR11-SEC-17 b):** the namespace passed as an argument, in an object or array literal, through `?:` or `??`; `new (Prisma.sql\`1\`.constructor)`; `const run = db.$queryRaw; run(s)`; `Reflect.apply(db.$queryRaw, …)`; `db[k]`. **Exemptions are exact files:** a sibling `session-integrity2.int.test.ts`, a new spike file, `is_local = false` in `session-integrity.int.test.ts`, and a setter in the `spk08` spike all fail. The tagged-fragment + `Prisma.join(ids, ', ')` control is clean |
| **P-E3** `runtime-r3.mjs` | `createDatabaseRuntime` with an unreachable `127.0.0.1:1` URL (no credentials) and a fake client class whose fresh connection reports `app.org_id` | `PGOPTIONS` plus an invalid URL gives `TenantTxConfigError`, so the refusal comes before URL validation and before the pool. Client calls: constructor `{adapter, errorFormat: 'minimal'}`, then the `unnest(app.*)` probe as the first query. One `security.db_session_context_leak` with `{component}`; `sessionContextLeaks()` = 1; one `db.not_ready_latched`; 3 later readiness polls → `DatabaseNotReadyError(db_session_context_leak)`. No log field holds a UUID. Without a client, `tenantTx` is `undefined` and only the integrity check runs |
| `lint-committed.mjs` | `lintMigrations` and `lintRepository` over the head's `prisma/` | 0 / 0 findings |
| `estring-fp.mjs` | Candidate PR11-SEC-16 patterns over the head's 21 committed `.sql` files (`sqlText`, strings kept) | 0 hits for both candidates. Positive control flagged. Negative control: `/\be'/i` false-positives on `type = 'e'`, so the remediation is token-level |
| Merge and text checks | `git show --remerge-diff d68898a`; the three helper blocks against data-model §4.2 on main; the net diff's added lines | **Merge:** conflicts only in `.env.example` and `packages/config/src/{index,schema}.ts`, each a pure union (main's `DB_STATEMENT_TIMEOUT_MS*` and the branch's `DB_TX_*`). **Helpers:** `diff` reports the blocks identical. **Added lines (`.env*` excluded):** 0 hits for private keys, cloud or VCS token prefixes, credentials in a URL, or the PR13-SEC-11 literal shape (the broad `secret`/`password`/`token` hits are key names). No `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `nosemgrep` or `gitleaks:allow`. No change to `.gitleaks.toml`, `.gitleaksignore`, `.github/` or `tools/ci/` |

**Not executed:**
- The PostgreSQL integration and catalog suites, and gitleaks (Docker is out of scope for this round). I rely on:
  - the fix comment's local gate on `9482f38`: unit 2057 passed; integration 154 passed / 1 skipped; coverage 97.54 % lines / 97.08 % branches; `db:lint-migrations` 0; audit 0;
  - `37a2109` being a test-only commit on top of that.
- **Lane A on `37a2109` is red for reasons outside the content**, both handled under D-ORCH-018:
  - gitleaks reports the merge-borne literal;
  - the base-ref fixture step asserts an exact rule set.

`pg` reads `PGOPTIONS` from the environment, and it is the only `pg` variable that injects session settings. `statement_timeout`, `lock_timeout` and `idle_in_transaction_session_timeout` are read from config only. `PGCLIENT_ENCODING`, `PGREPLICATION`, `PGBINARY` and `PGSSLNEGOTIATION` can only break the connection (`ssl` is explicit). No finding.

### R3.3 Closure of the round-2 open items

| ID | R3 status | Evidence / residual |
|---|---|---|
| PR11-SEC-09 | **Closed** (items 1–6) | (1) `platform/db/runtime.ts` is the only runtime importer of `client.ts`; `dedicated-connection.ts` also imports its `toPoolConfig`. It returns `readinessCheck`, `tenantTx`, `startup`, `resources` and `sessionContextLeaks`, never the pool or the client. `platform/runtime/{services,index}.ts`, the worker and `health.int.test.ts` go through it, and the `db-root-client` policy is unchanged. (2) `assertNoSessionOptions(process.env)` is its first statement (P-E3), and `deps.env` is never passed. (3) The fresh probe is the first client query; readiness re-runs it until it passes. (4) Sinks: P-E3 above; `db_session_default_tampered` latches too; nothing clears the latch. (5) Five `EXPECTED_ROLE_SETTINGS` rows; the pin test parses every `prisma/bootstrap/*.sql`; the RESET-drift integration test. (6) `classifyDbError` reads own data properties only and needs a catalogue code whose status matches, else a generic 500. `Retry-After` is sent only for a retryable integer in 1..3600. The body is built from catalogue data. The API tests assert that no reason, SQLSTATE, Prisma code or "Database error" text is sent, and `DbError` carries no `cause`. **Activation:** a runner exists only when the generated client class is passed. The entry points do not pass it yet (data-model §7.2 alias), so items 3–4 take effect with TASK-020's `tx` slot (§R3.6) |
| PR11-SEC-11 | a and h **closed**; d → TASK-034; c, e, f, g as routed | (a) Helper bodies are identical to §4.2. The PR's C-series test plants `public.current_setting` under `search_path = public, pg_catalog`; the helper still reads the real setting, and the plan keeps the inlined index condition. (h) `ALTER ROLE platform_app SET lc_messages = 'C'`; C13 has five rows; `SET lc_messages` by `platform_app` → 42501 (SUSET); RDS parity is recorded for SPK-08/M5 |
| PR11-SEC-12 | **Closed** | P-A3 result surface and after-commit rows; 0 `ROOT-conn` statements. The real-client test in the PR mutation-checks the wrapper |
| PR11-SEC-13 | **Closed** (residual PR11-SEC-17 a, b) | **Run time:** every non-forged fragment shape is refused before Prisma is called (P-A3); the first argument must be a template strings array whose `raw` is frozen. **Lint:** binding-aware, reporting `raw`/`Sql` uses, non-tagged `sql`/`sqltag`, a `join` text argument that is not a literal, typed-SQL factories, a computed namespace member and re-exports (P-D3). The controls stay clean |
| PR11-SEC-14 | (a) **closed**; (b) TASK-024 and (c) TASK-021 unchanged; sibling gap PR11-SEC-16 | P-B3 `U&` rows are flagged by both scanners. The PR adds executed C-series fixtures for the three `U&` forms and the three comment-split forms. The stated limits are now written in the linter and form-list headers |
| PR11-SEC-15 | c, f, g **closed**; a, b, d, e, h, i as routed | (c) P-C3 rule-15 rows. (f) `$queryRawTyped` is refused at run time and omitted from the type, and the factory import is reported. (g) P-D3 N7–N11 |

### R3.4 Architecture "Required in PR #11 before merge" at `37a2109`

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Rule 11 session-only; `RESET lock_timeout` when the value exceeds `3s` | **Done** | P-C3 rule-11 rows. The parser fails closed. Residual PR11-SEC-17 c |
| 2 | Rule 15 incl. (b) `OWNER TO platform_definer` ban | **Done** | (a) and (c) since round 2; (b) P-C3 rule-15 rows; fixture `definer-owner-to` |
| 3, 4, 7 | Rule 9 b; rule 16 b; C13 case folding | **Done** (round 2) | P-C3 regression rows unchanged |
| 5 | Qualified helper bodies | **Done** | Identical to data-model §4.2; shadowing test |
| 6 | `lc_messages = 'C'`, C13 five rows, `EXPECTED_ROLE_SETTINGS` row | **Done** | `02-role-backstops.sql`, C13 (d), pin test |
| 8 | D-ORCH-014 (a)–(f) and PR11-SEC-09 items 1–6 | **Done** | (a)–(d) and PR11-SEC-09: §R3.3. (e) Exact-file exemptions: `session-integrity.int.test.ts` gets `setter`, `keys` and `session-set` (no `is_local = false`); the `spk08-audit-owner.int.test.ts` spike gets `keys` with a delete-together note; P-D3 exemption rows; no inline disables. (f) Pure union (remerge-diff) |

### R3.5 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR11-SEC-16 | `E'…'` escape-string literals hide a tenant-context write inside an `EXECUTE` operand from rule 16 and the C-series | LOW | CWE-184 | A04 | `tools/db/tenant-key-forms.ts:43-50` (write forms; the header at :20 claims escaped strings cannot hide a key); `tools/db/sql-text.ts:77` (the tokenizer already recognises the `E` prefix) | TASK-024 (with PR11-SEC-14 b) | Open |
| PR11-SEC-17 | Residual limits of the new controls: deliberate `Sql` forge, lint binding flow, rule-11 tracking | INFO | CWE-184 | A03 / A05 | see list | as listed | Open |

#### PR11-SEC-16 (LOW): `E'…'` escape strings in dynamic SQL

**Description.** PostgreSQL's escape-string syntax decodes `\xHH`, octal `\ooo`, `\uXXXX` and `\UXXXXXXXX` in the lexer. That is the same capability that `U&` gives and that the PR now refuses. The shared form list does not cover it.

P-B3 ran each of these PL/pgSQL bodies through both scanners, and both missed all four:
- `EXECUTE E'SET LOCAL \x61pp.org_id = ' || quote_literal(p);`
- the octal (`\141pp`) and `app` spellings of the same statement;
- `app\x2eorg_id`.

A setter call stays visible, because the function name is not escaped: `set_config(E'app\x2eorg_id', …)` and `EXECUTE E'SELECT set_config(\x27…'` are flagged. Identifiers cannot use `E` escapes, so only string operands of `EXECUTE` are affected.

The new header sentence in `tenant-key-forms.ts` ("escaped identifiers and strings cannot hide a key") therefore overstates the control.

**Exploitability / impact.** The precondition is the same as PR11-SEC-14: a function or trigger body written with deliberate obfuscation, plus a CODEOWNERS review miss. Such a body would run inside `platform_app`'s `withTenantTx` transaction and switch tenant for the rest of it (T-35). No committed migration uses an `E'…'` string. Likelihood L × Impact M → **LOW**.

**Remediation.**
- (a) **Refuse escape strings outright, as for `U&`.** No committed migration, bootstrap file or template uses one (a scan of 21 files found no hit, with a positive control). Make it a token-level check, not a regex over the text: the tokenizer in `sql-text.ts:77` already knows when a string token has an `E` prefix (`escaped`).
  - Have `sqlText` mark such a token, for example by keeping the prefix as `E'` and emitting a sentinel, and let one write form match the sentinel in both scanners.
  - Do not use a plain regex. `/\be'/i` also matches the closing quote of a string that ends in a lone `e` (`type = 'e'`, a probe false positive).
  - In either case, fix the header sentence.
- (b) TASK-024's dynamic-SQL allow-list (PR11-SEC-14 b) also covers this case once it lands.
- (c) Principal-architect adds `E'…'` strings in `EXECUTE` operands to the data-model §8.3 "Limits" text, which is already pending from the fix comment.

Per D-ORCH-018, the superseding branch carries PR #11's net change unchanged, so this goes to TASK-024.

**Verification.**
- A C-series fixture `EXECUTE E'SET LOCAL \x61pp.org_id = …'`, executed on PostgreSQL 18, fails the scan.
- A linter fixture `context-escape-string` fails rule 16.
- The committed catalogue and migrations stay clean.

#### PR11-SEC-17 (INFO): residual limits of the new controls

| # | Residual | Backstop today | Owner |
|---|---|---|---|
| a | **A deliberate `Sql` forge passes `isSqlFragment`.** An object whose prototype chain reaches `Sql.prototype` through an intermediate object with its own `constructor`, and whose `strings`/`values` are array-likes, is `instanceof Sql`, so Prisma splices it. `isSqlFragment` returns false for it (P-A3 forge 1: the injected text reached `TX1`). The forge is lint-clean when the prototype comes from `Object.getPrototypeOf(Prisma.sql\`…\`)`. **Hardening:** test `'strings' in v && 'values' in v` instead of `Array.isArray`, and walk the whole prototype chain for a `Sql`/`_Sql` constructor. Alternatively, test `instanceof` against the `Sql` class of `@prisma/client/runtime/client`, which is the class Prisma's own check uses. Then state the limit in the JSDoc, as was done for `isTemplateStringsArray` | Lint and review (the same deliberate-forge class as the documented frozen `raw` forge) | TASK-020 |
| b | **The `db-raw-sql` binding analysis follows a tracked value only through member reads, declarators, `=` and calls.** These lint clean (P-D3): the namespace passed as an argument, held in an object or array literal, or chosen by `?:` / `??`; `new (Prisma.sql\`…\`.constructor)(…)`; an aliased or `Reflect.apply`'d `$queryRaw`; `db[k]`. **Optional:** report any other use of a tracked container (as `helperValue` already does for helpers), and any read of `$queryRaw`/`$executeRaw` that is not a template tag | The run-time guard refuses every non-forged value these produce (P-A3), and `db[k]` throws | TASK-020 (`lint` lock) |
| c | **Rule 11 tracks only `SET [SESSION] lock_timeout`.** `SET "lock_timeout" = 0`, `SELECT set_config('lock_timeout', '0', false)` and a `SET` inside a DO body lint clean and leave the session value raised for later files. This affects availability only (NFR-AVAIL-003) and needs deliberate code. **Fix:** fold quoted names into `LOCK_TIMEOUT_VALUE`; treat a `set_config` of `lock_timeout` as a SET, together with PR11-SEC-15 b's `role`/`session_authorization` keys; handle DO bodies with PR11-SEC-15 a | A later file that alters a table must start with `SET lock_timeout` (rule 11), which replaces the value for that file | TASK-024 (setter keys), TASK-021 (DO bodies) |

### R3.6 Routing (additions to §6 and §R2.6)

| Owner | Item | Due |
|---|---|---|
| TASK-024 | PR11-SEC-16 (`E'…'` form, header sentence), with PR11-SEC-14 (b); PR11-SEC-17 c (setter keys, quoted name) | Before TASK-037 |
| TASK-020 | **Runner activation:** pass the generated client class through `createRuntimeServices` → `databaseRuntimeFromConfig(…, Client)`, never through a second composition. Keep `startup()` awaited before listen and before the worker takes work. Then verify PR11-SEC-09 items 3–4 at the `tx` slot (already on the sheet). Also PR11-SEC-17 a and b | Wave 0.6 |
| TASK-021 | PR11-SEC-17 c DO-body part (with PR11-SEC-15 a) | With its rule-10 carry-overs |
| TASK-010 | Re-point the `security.*` runtime-log events to the security logger, keeping `{event, correlationId, sqlState}`. Export `sessionContextLeaks()` as the `db_session_context_leak` metric when the metrics pipeline exists | With TASK-010 / the metrics pipeline |
| TASK-034 | PR11-SEC-11 d (`readSecret` open-once; not taken in PR #11) | Unchanged |
| principal-architect | data-model §8.3 "Limits": add `E'…'` strings in `EXECUTE` operands (PR11-SEC-16 c) | With the pending "Limits" text |
| sdlc-orchestrator | Supersede per D-ORCH-018 and dispatch the supersede round (§R3.7). The D-ORCH-018 (2) harness fix on main (base-ref subset semantics) changes a security-owned CI check, so it needs its own security review | Before merge |
| qa-lead | Unchanged: activate `migration-lint` and `catalog-c1-c14` at merge | At merge |

### R3.7 What the supersede round checks (D-ORCH-018)

1. **No old ancestry.** `git merge-base --is-ancestor d68898a <new-head>` is false, and so is the same check for every other commit of the old branch.
2. **Tree equality outside docs.** `git diff 37a2109 <new-head> -- . ':!docs' ':!.claude'` is empty, because main changed only `docs/` and `.claude/` after `63accea`. In addition, `git diff <branch-point> <new-head>` touches no `docs/` or `.claude/` path, and its stat equals `git diff --stat 63accea 37a2109`.
3. **Configuration and checks.**
   - `.gitleaks.toml` and `.gitleaksignore` are unchanged.
   - No allowlist entry and no inline allow marker are added.
   - Lane A is green on the new head, including gitleaks and the PR2-SEC-08 base-ref step (after the D-ORCH-018 (2) fix lands on main).
4. **The record.** It gains "## Supersede round (head …)" with a `Head` row naming the full SHA and a final `Verdict` row.
