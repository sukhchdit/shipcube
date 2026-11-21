# PR-pending: TASK-080 (default margin pricing, sample pricing configuration, purity-rule hardening, carrier Money), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-080-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>` (D-ORCH-136, D-ORCH-138): open the PR as a draft, rename the record on main, confirm that the PR's merge ref contains the renamed record, then mark the PR ready.

**Finding IDs.** `PR080-SEC-nn` are the findings of this task (TASK-080). They are not findings of PR #80 (TASK-040, whose record is `PR-0080-TASK-040-security-review.md`).

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-080-default-margin-pricing-as-itemised` on base `e245e6e6`: `b9dff327` (margin step, sample configuration, purity-rule edits), `aee6c67e` (migration, schema, seed, grants), `4135a98d` (carrier Money), `4a0faee3` (vocabulary move) |
| Head | 4a0faee3201ddd3262ce071070914e2cc8f26cbc |
| Merge base with main | `e245e6e6`. Origin main when this round was written: `530629f4`; the main checkout carried 4 unpushed docs commits on top (`0e74c983`, including the code review twin `222fdf54`). `e245e6e6..530629f4` is docs and agent notes only. `git merge-tree --write-tree 530629f4 4a0faee3` is clean |
| Lane A evidence | None; the branch is not pushed. Main's classifier (`tools/ci/security-paths.mjs --base e245e6e6 --head 4a0faee3`) gives `security_paths=true` (11 paths), so the hosted `security-integration` job runs on the PR |
| Lane B evidence | None at review time (STATUS.md, D-ORCH-145). Every `*.int.test.ts` claim below is read from the source, not run on PostgreSQL 18. SQL behaviour was probed on PGlite 0.4.3 (PostgreSQL 17.5), noted per row |
| Owned paths changed | 17, as main's checker counts them (`--base e245e6e6 --head 4a0faee3 --pr 9999`, merge-ref form, no record: `missing`): the migration and its `down.sql`, `prisma/schema/pricing.prisma`, 4 under `prisma/seed/reference/` (`index.ts`, `pricing-sample.ts` and its test, `authz-parity-step.test.ts`), `prisma/sql/grants.manifest`, `prisma/tests/rls/tenant-db.real-client.test.ts`, `prisma/tests/seed/pricing-sample.int.test.ts`, 3 `bad-*` fixtures under `tests/fixtures/lint/rules/pricing-purity/`, `tools/db/grants-manifest.test.ts`, `tools/db/table-classes/pricing.json`, `tools/eslint-rules/pricing-purity.mjs`, `tools/lint/negative-fixtures.test.ts`. So this record is a merge condition |
| Unowned paths read | `packages/pricing/src/**` (margin step, sample configuration, engine, types, index), `packages/carriers/src/{normalise/money.ts,canonical/{codes,types}.ts,errors.ts,index.ts,adapters/mock/mock-adapter.ts,tests/fake-adapter.ts}`, `packages/shared/src/{vocabularies/carrier.ts,index.ts,classification/registry.ts,money/money.ts}`; for context `prisma/seed/framework/{runner,sql}.ts`, `prisma/seed/index.ts`, `prisma/tests/catalog/{c01-c12,c10-classification}.int.test.ts` and `scans.ts`, `tools/lint/check-suppressions.mjs`, `tools/eslint-rules/module-sources.mjs`, `apps/api/src/platform/db/{tenant-db,system-models}.ts` |
| Binding items checked | Brief `docs/04-plan/briefs/TASK-080.md` and its card; PR076-SEC-07 and D-SECPR076-02 (edits 2 and 4, due before TASK-080); D-TASK080-01..13 (commit bodies); data-model §1.5, §3.9, §4.4, §9.1, §9.2 and the durable `CONFIG_CHANGE` rule; ADR-0009 §3; ADR-0010 am. 12 item 2, D-ARCH-168; PR075-SEC-10; PR2-SEC-01 (suppression policy); code review round 1 (`docs/05-quality/reviews/PR-pending-TASK-080-code-review.md`, main checkout `222fdf54`) |
| Reviewer / date | security-analyst, 2026-11-21, round 1, pre-push. Host rule: foreground commands only, one at a time, no Docker, no command in the TASK-080 worktree (git reads used the shared object store from another checkout). Method: a `git archive 4a0faee3` extract (and an `e245e6e6` extract of the lint inputs as the positive control) in the session scratchpad, with a `node_modules` tree of junctions to the main checkout's entries and `@platform/*` pointing at the extract's own workspaces. ESLint ran with the repository's `eslint.config.mjs`, type-aware rules off. Sources were type-stripped for the money and linter probes. SQL ran on PGlite. Targeted Jest unit suites ran once on the extract |

## 1. Summary

The database side holds what the dispatch asked about:

- **Grants.** `platform_app` holds `SELECT` only. `INSERT`, `UPDATE`, `DELETE` and `TRUNCATE` are refused with 42501, and so is a direct call of the trigger function (no `USAGE` on `platform`). The manifest line, the pin test and `runtimeReadOnly` agree.
- **Immutability.** The `AFTER UPDATE OR DELETE` row trigger refuses every change to a published row for its owner: an update, a no-op update, un-publishing, a delete, and `INSERT … ON CONFLICT DO UPDATE` (P0001 `PRICING_VERSION_IMMUTABLE`). A draft row stays editable until it is published. `session_replication_role` is refused to the migrator (42501). `TRUNCATE` by the owner is not covered (PR080-SEC-04, INFO, with code review R1-n7).
- **Table class.** GLOBAL, no `org_id`, no RLS, read-only by grant. On `TenantDb` it is exposed like the authz catalogue (D-TASK080-09), and the DB refuses every write from the tenant transaction.
- **Seed.** Insert-only holds: the real statements of the PR insert 1 row, a re-run inserts 0, and a changed hash or changed notes for the same key counts 1 changed row, which the runner turns into `SEED_INSERT_ONLY_CHANGED` and rolls back.
- **Carrier money.** `carrierDecimalToMoney` never echoes the value or the currency. Across 39 hostile inputs, a sentinel appeared in none of message, `cause`, `toJSON`, `util.inspect` or the stack. It is linear at 1 MB.

The purity-rule hardening (PR076-SEC-07 edits 2 and 4) closes every form PR076-SEC-07 listed. Residual spellings remain, and the rule itself can be switched off inline:

- **PR080-SEC-01 (LOW).** `platform/pricing-purity` is not a protected rule. An inline `eslint-disable-next-line platform/pricing-purity -- TASK-080 …` passes the suppression checker, while the same line for `platform/money-arith` is refused. This is pre-existing (TASK-076) and found in this round.
- **PR080-SEC-02 (INFO).** Shadowing by a binding other than an identifier `declare`: `declare const { Date }: …`, `import type { Money as Date }` and a type-only `namespace Date {}`. TypeScript accepts all three, and the emitted code calls the real clock. The first two are lint-clean under the whole configuration. This extends code review R1-m3.
- **PR080-SEC-03 (INFO).** An expression-free template literal in `import()` skips every specifier arm of the rule. `` import(`@platform/shared/queues`) `` and `` import(`@platform/shared`) `` are lint-clean. This is code review R1-m1.
- **PR080-SEC-04 (INFO).** The immutability guard has no `TRUNCATE` arm. This is code review R1-n7.
- **PR080-SEC-05 (INFO, merge-relevant).** Catalog C9 will fail on lane B: `ck_pricing_config_versions__source` is an IN-list CHECK that is not in C9's `ENUM_CHECKS`. Neither the brief nor the code review lists C9.

A validated patch exists for 02 and 03: about 15 lines in the file this PR already edits. It keeps all 25 fixtures, the 10 real sources and the controls unchanged, and it reports all 11 bypass probes.

Nothing Critical, High or Medium. The verdict is PASS_WITH_CONDITIONS: C9 must be extended (with whatever source list code review R1-M1 leaves), lane B must pass, and the fix head needs a delta round.

## 2. What I verified

| Probe | How | Result |
|---|---|---|
| P1 purity bypass matrix (38 cases) | One `ESLint#lintText` process on the head extract, probe text at `packages/pricing/src/zz-probe.ts`, all rules of the real configuration counted | **Reported by pricing-purity:** the controls `Date.now()` and `declare const Date`; `declare let Date`, `declare var Math`, `export declare const process`, `declare function`+`namespace Date`, `declare class Date`, `declare namespace Date`, `declare enum Math`, `declare global { var … }`, `global {}` inside `declare module 'x'`, `interface Date {}` / `type Math` / a type parameter `Date` (type-only bindings do not capture the value reference); the subpath as named import, `export *`, named re-export, side-effect import, literal `import()`, `import { type X }`, and a deep `@platform/shared/src/…` path. **Not reported by pricing-purity:** `declare const { Date }: …` and `import type { Money as Date }` (no other rule either, PR080-SEC-02); type-only `namespace Date` / `module Date` / `export namespace Math` / `namespace process` / `namespace globalThis` / `namespace performance`, and `import Date = NS.T` (held only by `@typescript-eslint/no-namespace`); template-literal `import()` of the subpath and of the root (no other rule, PR080-SEC-03). Held by other rules: a concatenated specifier (`platform/static-module-specifier`), a relative path into `packages/shared/src` (`import-x/no-relative-packages`), `@platform/carriers` (boundaries). Clean controls: the type-only subpath import, a root vocabulary import, `instanceof Date` |
| P2 template specifiers and inline disables (12 cases, head and base) | Same harness on `4a0faee3` and on `e245e6e6` | Template `import()` of `node:fs`, `pg` and `@platform/shared/logging` is reported by `boundaries/dependencies` only, and pricing-purity is silent on both heads. Template `import()` of the queues subpath, of the root (`uuidv7`) and of a `./tests/` helper is **clean on both heads**. The literal controls are reported (the `logging` literal gains the pricing-purity report on the head only, as the PR intends). `// eslint-disable-next-line @typescript-eslint/no-namespace -- TASK-080 …` before a type-only `namespace Date` and `// eslint-disable-next-line platform/pricing-purity -- TASK-080 …` before `Date.now()` are both clean |
| P3 suppression policy (PR080-SEC-01) | Head `tools/lint/check-suppressions.mjs --root <scratch git repo> --json` over three files | Exit 1 with exactly one finding: the `platform/money-arith` control (`suppression/protected-rule`). The `platform/pricing-purity` and `@typescript-eslint/no-namespace` suppressions with a TASK ID pass. The tree has no existing suppression of either rule (`git grep` at the head: 0) |
| P4 TypeScript acceptance | `ts.createProgram` per file with `packages/pricing/tsconfig.json`'s parsed options (TS 6.0.3, `isolatedModules`, `verbatimModuleSyntax`), file emitted when clean | Accepted, and the emitted JS is a bare `Date.now()` or the template `import()`: type-only `namespace Date`, `declare const { Date }`, `import type { Money as Date }`, both template `import()` forms. Refused: `module Date` (TS1540), `import Date = NS.T` (TS1288, TS2866). Control `const bad: number = 'x'`: TS2322 |
| P5 candidate fix for 02 and 03 | The head rule patched in the extract (exact unique-string edits, then restored and `cmp`-checked); the same matrix run before and after: every pricing-purity fixture, every non-test pricing source, 11 bypass cases, 3 controls | All 25 fixtures unchanged (each `bad-*` exactly once, `ok-pure.ts` clean). The 10 real sources stay clean. All 11 bypasses are now reported (`shadowed Date`, `shadowed Math`, `shadowed process`, `shadowed globalThis`, the subpath, the root whole module, the test helper). The controls (`declare const Date` → `declare Date` once; `Math.max`/`Date.parse`/`getTime` clean; a parameter `value` clean) are unchanged |
| P6 migration, grants, trigger, CHECKs, seed SQL (PGlite 17.5) | Roles `platform_migrator` and `platform_app`, schema `platform`, a `uuidv7()` stub (PG 17 has none). `migration.sql` run as `platform_migrator`. Then the PR's own `renderInsertOnly` / `renderChangedCount` / `rowsParameter` on the real `pricingSampleDataset`, then 40 rows of probes, then `down.sql` twice and `migration.sql` again | Owner `platform_migrator`; the only non-owner grant is `platform_app SELECT`. Trigger `tgtype` 25 (row, AFTER, DELETE + UPDATE), enabled. Function `prosecdef = false`, `proconfig = search_path=pg_catalog, pg_temp`. Seed run 1: 1 inserted, 0 changed. Run 2: 0, 0. The stored hash equals the literal (32 bytes) and `published_at = effective_from`. A tampered hash for the same key: 0 inserted, 1 changed; notes only: 1 changed. Immutability rows as in §1. Draft insert, update and publish: OK; an update after publish: P0001. `TRUNCATE` as owner: **OK, 2 rows gone**; seed run 3 re-inserts 1 (the runner logs and reports this as `drift-restored`). `platform_app`: SELECT OK; INSERT, UPDATE, DELETE, TRUNCATE 42501; calling the function 42501. CHECKs: version key with a trailing newline, upper case, 65 characters and a leading dot, a 31-byte hash, `seed` in lower case, and 2,001-character notes all give 23514; a 64-character key is accepted. `down.sql` drops table and function, is idempotent, and `up` re-applies |
| P7 TRUNCATE guard candidate (PGlite 17.5) | A second invoker function and a `BEFORE TRUNCATE … FOR EACH STATEMENT` trigger added after the head migration | `TRUNCATE` with only draft rows: allowed. With a published row: P0001 `PRICING_VERSION_IMMUTABLE`, row kept. `down.sql` plus the extra `DROP FUNCTION`: clean |
| P8 carrier money (39 inputs + 3 timings) | `normalise/money.ts` type-stripped with the extract's `@platform/shared`; sentinel in value and currency | Accepted: `12.34` USD 1234, `1234` JPY 1234, `12.340` USD 1234, leading zeros, `-12.34` USD −1234 (D-TASK080-11; the engine refuses a negative carrier cost, `engine.ts:53`), `-0` gives `0` (not −0), `12.345` BHD 12345, `90071992547409.91` USD = `MAX_SAFE_INTEGER`. Refused as `CarrierError CARRIER_UNKNOWN_ERROR` with `cause {name, code}` only: exponent, empty, `+`, white space before or after, `\n`, `12.`, `.5`, Arabic-Indic and full-width digits, hex, `_`, `NaN`, `Infinity`, 30 and 31 nines, one past the safe range, `12.345` USD, `12.3456` BHD, `usd`, `XXX`, `__proto__`, `constructor`, `toString`, a sentinel currency, a number, `null`, an object with `toString`. **Leaks: 0.** 1 KB / 100 KB / 1 MB inputs: 0.04 / 0.07 / 0.60 ms |
| P9 migration linter | `lintMigrations(prisma/migrations, …, { tableClasses })` type-stripped on the extract; control: a copy with the header kind set to `bogus` and a `DROP TABLE` appended | Head: 0 findings. Control: 2 findings (rule 1 header, rule 2 destructive statement) |
| P10 secrets | `git log -p -U0 --diff-merges=first-parent e245e6e6..4a0faee3`, gitleaks v8.30.1 rules: over-approximation (keyword + regex), then the `generic-api-key` semantics (secret group, entropy ≤ 3.5, digit check, both rule allowlists, stopwords, global allowlist) | Over-approximation: 12 `generic-api-key` candidates (rule keys, version keys, the vocabulary lists) plus both runtime controls. Faithful: 0 reported (entropy or no digit); the runtime control is reported. No hex digest is quoted in this record |
| P11 targeted unit suites | Jest `--selectProjects unit --runInBand` on the extract: `tools/db/grants-manifest`, `prisma/seed/reference/pricing-sample`, `packages/carriers/src/normalise/money`, `packages/shared/src/vocabularies/carrier` (with `openapi.yaml` added to the extract), `packages/pricing/src/config/sample` | 5 suites, 48 tests pass |
| P12 C9 prediction (PGlite 17.5) | `pg_get_constraintdef` of a 3-value and a 1-value IN-list CHECK, then C9's own `enumCheckValues` filter (`prisma/tests/catalog/scans.ts:196-202`) read against it | The 3-value list deparses to `= ANY (ARRAY[…])` and is selected; the 1-value list (`ck_job_executions__status`) deparses to `=` and is not, which is why C9 passes on main today. `ENUM_CHECKS` (`c01-c12.int.test.ts:258-321`) has no pricing key, so `toEqual(ENUM_CHECKS)` at `:904` fails with the extra key `ck_pricing_config_versions__source` |

## 3. Findings

| ID | Title | Severity | CWE | OWASP | File:line | Owner / due |
|---|---|---|---|---|---|---|
| PR080-SEC-01 | `platform/pricing-purity` can be suppressed inline with any TASK ID | LOW | CWE-693 | A04 | `tools/lint/check-suppressions.mjs:25-42` (`PROTECTED_RULES`) | This PR's fix cycle (preferred: C3 forces a delta round anyway); else the next task that changes `packages/pricing/src` |
| PR080-SEC-02 | Purity shadowing by destructured `declare`, type-only import alias and type-only namespace | INFO | CWE-693 | A04 | `tools/eslint-rules/pricing-purity.mjs:221-224, 256-262, 263-268` | With code review R1-m3, this PR's fix cycle preferred |
| PR080-SEC-03 | Template-literal `import()` specifiers skip every arm of pricing-purity | INFO | CWE-693 | A04 | `tools/eslint-rules/pricing-purity.mjs:199-201` | With code review R1-m1, this PR's fix cycle preferred |
| PR080-SEC-04 | The immutability guard has no `TRUNCATE` arm | INFO | CWE-471 | A08 | `prisma/migrations/20261121000000_pricing_config_versions/migration.sql:46-59` | With code review R1-n7, this PR (the migration is not merged yet, so it is free now); else the US-152 rule-table migration |
| PR080-SEC-05 | C9 does not know `ck_pricing_config_versions__source`; lane B red predicted | INFO (merge-relevant) | CWE-710 | A05 | `prisma/tests/catalog/c01-c12.int.test.ts:258-321, 904`; `migration.sql:34` | This PR, merge condition C1 |

### PR080-SEC-01 (LOW): the purity rule is not protected from inline suppression

**Description.** `check-suppressions.mjs` refuses an inline suppression of the rules in `PROTECTED_RULES` (PR2-SEC-01; exceptions are file-scoped overrides in the code-owned lint configuration). Every other rule may be suppressed with a description that names a `TASK-\d{3}`. `platform/money-arith` is protected; `platform/pricing-purity` is not. P3: `// eslint-disable-next-line platform/pricing-purity -- TASK-080 temporary clock` before `Date.now()` in `packages/pricing/src` passes both ESLint and the checker, while the `money-arith` control is refused.

**Exploitability and impact.** No attacker input reaches this. The risk is an author, human or agent, who meets the rule and follows the checker's own guidance ("add a TASK ID") instead of moving the value into `PricingInput`. Every hardening of the rule (PR076-SEC-01, -07, this PR's edits) is then one comment away from irrelevant. The suppression is visible in the diff and counted in the NFR-MAINT-002 summary, so review can catch it. Impact medium: price determinism and the explain/replay property of AT-US-138-01/02, which booked-price snapshots and the audit trail rely on. Likelihood low. LOW.

**Remediation.** Add the rule to the protected list, and pin it:

```js
export const PROTECTED_RULES = Object.freeze([
  // …
  'platform/money-arith',
  'platform/pricing-purity', // PR080-SEC-01: the engine's purity (AT-US-138-02) is never waived inline
  // …
]);
```

No suppression exists today, so nothing breaks. `@typescript-eslint/no-namespace` does not need protecting once PR080-SEC-02 is fixed. Whether `platform/static-module-specifier` should be protected too is a separate question for its owner (not probed here).

**Verification.** A `check-suppressions.test.ts` row: an `eslint-disable-next-line platform/pricing-purity -- TASK-080 x` line gives `suppression/protected-rule`.

### PR080-SEC-02 (INFO): shadowing that the `declare` arm does not see

**Description.** Edit 4 reports a `declare` declarator, function, class, enum or namespace whose id is an *identifier* named like a watched global, plus `declare global`. The global-scope pass then skips any reference that resolves to a module-scope binding. Three bindings of a watched name escape both (P1, P4):

1. `declare const { Date }: { Date: DateConstructor };` (also `{ now: Date }`): `checkAmbient` reads `node.id.name`, and the id is an `ObjectPattern`.
2. `import type { Money as Date } from '@platform/shared';`: the type-only import binding captures the value reference in typescript-eslint's scope manager, while TypeScript resolves the value `Date` to the global (the alias has no value meaning).
3. `namespace Date { export type T = number }` (no `declare`): a non-instantiated namespace binds `Date` for the scope manager, while TypeScript resolves the value to the global and emits nothing for the namespace.

TypeScript accepts all three, and the emitted JS is a bare `Date.now()`. Forms 1 and 2 are clean under the whole configuration. Form 3 is held only by `@typescript-eslint/no-namespace`, which is not protected and is suppressible with a TASK ID (P2, P3).

This extends code review R1-m3, which found that only `declare const Date` is pinned (the mutant `WATCHED_GLOBALS = {Date}` survives).

**Exploitability and impact.** These are deliberate spellings that a reviewer sees, the same class and grade as PR076-SEC-07. INFO.

**Remediation (validated, P5).** Fail closed by name: refuse any binding of a watched global name, whatever declares it. Keep `checkAmbient` for its message, and skip the declarations it already reported:

```js
const ambientReported = new Set();
const checkAmbient = (node) => {
  const name = node.id?.type === 'Identifier' ? node.id.name : undefined;
  if (name !== undefined && WATCHED_GLOBALS.has(name)) {
    ambientReported.add(node);
    report(/** @type {never} */ (node), `declare ${name}`);
  }
};
// first lines of 'Program:exit':
for (const scope of context.sourceCode.scopeManager?.scopes ?? []) {
  for (const variable of scope.variables) {
    if (variable.defs.length === 0 || !WATCHED_GLOBALS.has(variable.name)) continue;
    if (variable.defs.some((def) => ambientReported.has(def.node))) continue;
    report(/** @type {never} */ (variable.defs[0].name), `shadowed ${variable.name}`);
  }
}
```

Pricing never needs a local named `Date`, `Math`, `process`, `crypto`, `performance`, `navigator`, `globalThis`, `self`, `window` or `global`. A legitimate shadow (a parameter `process`) is reported too, which is the intent.

**Verification.** Three `bad-*` fixtures (`bad-declare-destructured.ts`, `bad-shadow-import-type.ts`, `bad-shadow-namespace.ts`) with `[AT-US-138-02]` rows, and code review R1-m3's `it.each` over `WATCHED_GLOBALS`, so that the name list is pinned for both arms.

### PR080-SEC-03 (INFO): template-literal `import()` specifiers

**Description.** `checkSource` returns unless the source is a string `Literal` (`:200`), so `` import(`@platform/shared/queues`) `` (randomness through `retryDelayMs`), `` import(`@platform/shared`) `` (the whole root, carrying `uuidv7`) and `` import(`./tests/x.js`) `` are never checked (P2: clean on base and head). The repository treats an expression-free template as a static specifier (`platform/static-module-specifier` accepts it, and boundaries resolves it). So boundaries catches `node:fs`, `pg` and `@platform/shared/logging` in that spelling, but it admits `@platform/shared/**` for pricing. The subpath arm is new with edit 2. The root and test-helper arms are pre-existing (TASK-076). This is code review R1-m1, which I concur with.

**Exploitability and impact.** It needs an `async` detour in a synchronous engine and an unusual quote style, so a reviewer sees it. INFO, the PR076-SEC-07 grade.

**Remediation (validated, P5).** Use the shared helper that the other import rules use:

```js
import { staticSpecifier } from './module-sources.mjs';
// in checkSource:
const specifier = staticSpecifier(source);
if (specifier === undefined) return;
```

**Verification.** A `bad-template-import-subpath.ts` fixture (subpath) with its row. Optionally, a root-template row.

### PR080-SEC-04 (INFO): no TRUNCATE arm on the immutability guard

**Description.** The guard is a row trigger on `UPDATE OR DELETE`. `TRUNCATE` fires no row trigger. P6: the owner truncated two rows, one of them published, without a raise. Only the owner holds `TRUNCATE` (`platform_app` 42501). The owner can also drop or disable the trigger. The next reference seed re-inserts the sample row, and the runner logs and reports that as `drift-restored`, so it is not silent. The audit store's own guard covers `TRUNCATE` at statement level (`10-audit.sql:270-274`, `trg_audit_entries__no_truncate`). This is code review R1-n7.

**Exploitability and impact.** Defence in depth against a mistaken migration. Once US-152 adds rows that quotes reference by foreign key, a plain `TRUNCATE` is refused anyway, unless it is `CASCADE`. INFO.

**Remediation (validated on PGlite 17.5, P7).** In the same migration, before it merges:

```sql
CREATE FUNCTION platform.pricing_config_versions_no_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT FROM public.pricing_config_versions WHERE published_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PRICING_VERSION_IMMUTABLE: a published pricing configuration version cannot change; add a new version';
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_pricing_config_versions__no_truncate BEFORE TRUNCATE ON public.pricing_config_versions
  FOR EACH STATEMENT EXECUTE FUNCTION platform.pricing_config_versions_no_truncate();
```

Add `DROP FUNCTION IF EXISTS platform.pricing_config_versions_no_truncate();` to `down.sql`. A separate function is needed: `OLD` is NULL in a statement trigger, so the row function would never raise. The alternative is one sentence in the migration header that accepts it.

**Verification.** One `pricing-sample.int.test.ts` row: owner `TRUNCATE` after the seed gives P0001 and the row stays.

### PR080-SEC-05 (INFO, merge-relevant): C9 will fail

**Description.** C9 lists every `public` CHECK whose definition deparses to `= ANY (`, and it compares the result with the hand-kept `ENUM_CHECKS` (`toEqual`, `c01-c12.int.test.ts:904`). `ck_pricing_config_versions__source` has 3 values, so it is selected and is not in the list (P12). `ck_job_executions__status` escapes C9 only because a 1-value IN list deparses to `=`. This also holds for code review R1-M1's fix options: 2 or 3 values still deparse to `= ANY`. The brief's "hand-written catalog literals" list (working rule 4) omits C9, and so does code review merge condition 2.

**Impact.** Lane B red on the catalog suite. The control itself (closed vocabularies at the database) works as designed.

**Remediation.** Add the entry beside the others, equal to the list that ships after R1-M1, with a comment that names TASK-080 and data-model §1.7 `reference_source`. For example, for `('SEED', 'SAMPLE')`:

```ts
  // TASK-080 (data-model §1.7 reference_source, §3.9): the pricing configuration version sources.
  ck_pricing_config_versions__source: ['SAMPLE', 'SEED'],
```

(The values are sorted, as `enumCheckValues` sorts them.) This is an owned path, so it falls under C3.

**Verification.** C9 green on lane B. Its own drift control (`ck_roles__scope`) is unchanged.

## 4. Checked with no finding

| Item | Evidence |
|---|---|
| Least privilege (C5) | One manifest line `platform_app SELECT public.pricing_config_versions`, the pin test updated (tuple and table list), `runtimeReadOnly: true` (so `validateGrants` refuses any write line, `grants-manifest.ts:113-116`), and the migration `GRANT` is SELECT only. No default table ACL grants anything: bootstrap `01-schemas.sql:30-32` only revokes function `EXECUTE` from PUBLIC. P6: the live grant set is exactly `platform_app SELECT` |
| Trigger function | SECURITY INVOKER, `search_path = pg_catalog, pg_temp`, no request-context read (rule 16), in `platform`. `EXECUTE` is revoked from PUBLIC by default privileges, and the app has no `USAGE` on `platform` (P6: 42501). It reads `OLD` only and returns NULL; an AFTER row trigger's raise aborts the statement (P6) |
| D-TASK080-06 (AFTER, no `stdColumns` flag) | Concur. No runtime writer exists, and C15 (b) concerns BEFORE row triggers only. The C15 (a) scope literal is unchanged, as it should be |
| D-TASK080-09 (`pricingConfigVersion` on `TenantDb`) | Concur. `TenantDb` exposes every delegate except `SYSTEM_MODELS` (`system-models.ts:14`), so a GLOBAL model appears like `permission`. Writes reach the database as `platform_app` and fail with 42501. The surface pin lists it. Reads expose version keys, instants, a content hash and operator notes, all INT |
| RLS / class | GLOBAL, no `org_id`: C1's allow-list covers GLOBAL/SYSTEM, and C2 and C16 do not apply. No policy is rendered: `RLS_CLASSES` is TENANT, GUEST_CAPABLE and USER_OWNED (`tools/db/table-classes.ts:22`), and `runtimeReadOnly` is legal only outside them (`:125`) |
| Seed insert-only (data-model §9.1) | `runner.ts:50-68`: a known version with another hash is refused before any write. Otherwise `INSERT … ON CONFLICT DO NOTHING`, then a changed-row count over every payload column, so any difference is refused and the transaction rolls back. P6 ran the PR's own statements. Identifiers are rendered only after `SAFE_IDENTIFIER` |
| Audited dataset | `audited: true`. Until TASK-221's reconciler writes durable `CONFIG_CHANGE` entries for every audited dataset (data-model, "Durable CONFIG_CHANGE for seed-originated changes"), the seed path records `reference_dataset_versions` and logs (`prisma/seed/index.ts:48-52`). This is by design: the migrator gains no audit privilege. `pricing_config_versions` is the first audited dataset in TASK-221's scope (routing below) |
| Classification (C10) | Every new column has a registry row, all INT; `notes` is configuration text, capped at 2,000 characters |
| CHECKs | Version key `^[a-z0-9][a-z0-9._-]{0,63}$` (PostgreSQL `$` does not match before a trailing newline: P6), a 32-byte hash, and the source list; R1-M1 decides the list. The regex is anchored and linear |
| `down.sql` / up-down-up | Drops the table, then the function; prefix-idempotent; re-applies (P6). Migration lint clean, with a control (P9) |
| D-TASK080-10 / -11 (carrier Money) | Concur. The refusal is `CARRIER_UNKNOWN_ERROR` with `safeCause`, the value and currency are never echoed (P8), and the canonical code is not retried (ADR-0010; code review §3). On a `createShipment` response, the refusal is an ambiguous outcome, never a local one. Code review's forward note (keep the label when only the charge is unreadable) stands for TASK-101 and the adapter tasks. Negative amounts parse by design; the engine refuses a negative carrier cost |
| Vocabulary move (D-TASK080-13) | Constants and guards only, no Node import, exported from the browser-safe root. `CarrierError` now validates codes with the shared guard over the same list. The pricing allow-list and the root impurity pin (`pricing-purity-shared.test.ts`, which derives its module list) are unaffected |
| Margin step | No I/O. It reads rules field by field into frozen copies; errors name a rule position, never a value; rates must not be negative; keys are unique; exactly one default rule. The explanation inputs are the winning rule's dimensions, priority and rate, with no request or personal data (D-TASK080-03). Losing matches are only counted. Whether the explanation (rule key, rate) is shown to customers is a question for the API task that serialises `PricingResult` (routing below) |
| Secrets | P10: 0 reports. The hash literals are content digests, not credentials |

## 5. Code review twin (round 1, main checkout `222fdf54`, CHANGES_REQUESTED)

- **R1-M1 (`ADMIN` source value, D-TASK080-05 rejected):** I concur. There is no security objection to either fix option. Reserving a write value without a writer adds no privilege, but it contradicts data-model §1.7, and C9 pins whatever list ships (PR080-SEC-05).
- **R1-m1:** concur; it is PR080-SEC-03, with a validated patch.
- **R1-m3:** concur, and extended by PR080-SEC-02. The binding pass makes the list matter for every declaration kind, so the `it.each` pin covers both arms.
- **R1-n7:** concur; it is PR080-SEC-04, with a validated trigger.
- **R1-m2 (non-canonical hash):** no security finding. The digest identifies a configuration version; it is not an integrity control against tampering (no key, and the row is insert-only and owner-written). A canonical form matters for reproducing it in US-152, so I agree with fixing it before the first row is published.
- **R1-m4 (no carrier or operation context on the refusal):** no security finding. It is an observability gap, and the `cause` stays safe either way.
- **Not in the twin:** PR080-SEC-01 and PR080-SEC-05.

## 6. Routed items at this head

| Item | Status |
|---|---|
| PR076-SEC-07 (INFO, D-SECPR076-02: edits 2 and 4 before TASK-080) | **Closed for every listed form:** the queues subpath (static import, re-export, side effect, literal `import()`); `declare const` / `let` / `var` of `Date`, `process`, `Math` and the other watched names; `declare` function, class, enum and namespace; `declare global`. The residual spellings found now are new IDs PR080-SEC-02 and -03 |
| D-TASK075-10 / R1-m6, D-TASK075-02 / D-ARCH-168 | No security objection. Closure is code review §4 |

## 7. Lane B cases that must pass (PostgreSQL 18, final head)

1. `prisma/tests/seed/pricing-sample.int.test.ts`: all three cases. These are the first run and no-op re-run; `SEED_INSERT_ONLY_CHANGED` with the row unchanged; and owner immutability (P0001 on `UPDATE` and `DELETE`), `platform_app` 42501 on `UPDATE` and `INSERT`, and the editable draft. Add the PR080-SEC-04 row if that fix is taken.
2. `prisma/tests/catalog/c01-c12.int.test.ts`:
   - C1 (RLS allow-list);
   - C5 and the PR11-SEC-04 planted control (grants equal the manifest);
   - C8 (`uuidv7()` default, no naive timestamp);
   - **C9 (after C1 of this record)**;
   - C11 (the three rows on functions, including "migrator-created probe functions in platform and public are EXECUTE-able by neither PUBLIC nor platform_app");
   - C13;
   - rule 16 (no function body reads the security keys).
3. `prisma/tests/catalog/c10-classification.int.test.ts` (all three), `c15-std-columns-guard.int.test.ts` ([SEC-TC-74] C15 (a) committed scope unchanged, and (b)), `c16-tenant-keys.int.test.ts`.
4. `prisma/tests/migrations/up-down-up.int.test.ts`, `split-statements.int.test.ts`, `concurrent-index.int.test.ts`; `prisma/tests/shadow/shadow-init.int.test.ts` (schema and migration agree; the CHECKs, the partial index and the trigger are migration-only by the schema's own comment).
5. `prisma/tests/seed/seed.int.test.ts` and `prisma/tests/organisations/organisations.int.test.ts`: the second runs `REFERENCE_DATASETS` twice and compares snapshots, and that now includes the pricing dataset.

Lane A, which is not lane B but is also required: `prisma/tests/rls/tenant-db.real-client.test.ts` (surface pin), `tools/lint/negative-fixtures.test.ts` with the three new rows and the two-rule `bad-logging-specifier` row, `pricing-purity-shared.test.ts`, and `check-suppressions`. Also the hosted `security-integration` job at the pushed head (or the orchestrator's documented substitute while hosted CI is blocked, D-ORCH-146).

## 8. Routing

| Item | Owner | Due |
|---|---|---|
| PR080-SEC-05 | senior-developer (this PR) | Merge condition C1 |
| PR080-SEC-01 | senior-developer: this PR's fix cycle, preferred (one line plus a test row, in an owned file) | Else before the next change to `packages/pricing/src` merges |
| PR080-SEC-02, -03 | senior-developer: this PR's fix cycle, with code review R1-m1 and R1-m3 (validated patch above) | Else with the next `pricing-purity.mjs` change; before US-141 |
| PR080-SEC-04 | senior-developer: this PR (with R1-n7), or an accepting sentence in the migration header | Else the US-152 rule-table migration |
| Durable `CONFIG_CHANGE` for `pricing_config_versions` | TASK-221 card line: the reconciler covers every audited dataset, the first one being this one | With TASK-221 |
| Explanation exposure | The API task that serialises `PricingResult` (TASK-083 / TASK-101): the explanation entries (rule key, rate, priority) are INT, so a customer response carries the charge lines only, unless a ruling says otherwise | When the quote response is built |
| `notes` classification | The M2 pricing admin (the writer that R1-M1 names `OPERATOR`): free text written by an operator must stay non-personal for the INT class to hold, or the column is reclassified | M2 |

## 9. Conditions

- **C1.** PR080-SEC-05 fixed: C9 knows `ck_pricing_config_versions__source`, with the list as it ships after code review R1-M1.
- **C2.** Lane B on PostgreSQL 18 green at the final head for the cases in §7. Triage is not evidence.
- **C3.** A delta security round on the fix head. R1-M1 (`migration.sql`) and C1 (`c01-c12.int.test.ts`) both change owned paths, so this round's binding to `4a0faee3` does not carry over. A union merge of main that touches `grants.manifest`, `grants-manifest.test.ts` or `negative-fixtures.test.ts` (TASK-043 and TASK-051, the planned second merger) needs a merge-only round.
- **C4.** Rename this record on main once the PR exists, and confirm that the merge ref contains it (D-ORCH-136, D-ORCH-138).

| Field | Value |
|---|---|
| Verdict | PASS_WITH_CONDITIONS. No Critical, High or Medium finding. Conditions C1 to C4. LOW PR080-SEC-01 and INFO PR080-SEC-02..04 routed; INFO PR080-SEC-05 is condition C1 |

## Round 2: delta review of fix cycle 1 (condition C3)

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-080-default-margin-pricing-as-itemised`: one commit `3d3a7775` on `4a0faee3` (`fix(pricing): task-080 fc1, source check, truncate guard, canonical hash, purity hardening`; D-TASK080-14..19 in its body) |
| Head | 3d3a777587e567d2b8b8b6272ca8fa161ba4ffc8 |
| Merge base with main | `e245e6e6`, unchanged. Local main when this round was written: `965a5a34` (origin main `530629f4`). `e245e6e6..965a5a34` changes docs and agent notes only, so main touches no path of this PR. `git merge-tree --write-tree 965a5a34 3d3a7775` is clean |
| Record binding | Main's `check-security-owned-paths.mjs --base 965a5a34 --head 3d3a7775 --pr 9999`: **27 owned paths** (round 1: 17). The 10 new ones are `prisma/tests/catalog/c01-c12.int.test.ts`, `tools/lint/check-suppressions.mjs`, `tools/lint/check-suppressions.test.ts`, `tools/lint/pricing-purity-shared.test.ts` and 6 `bad-*` fixtures under `tests/fixtures/lint/rules/pricing-purity/`. The delta changes 20 of the 27, so the round-1 binding to `4a0faee3` is void and this round binds `3d3a7775`. Simulated in R2.1 (P13) |
| Lane A evidence | None; the branch is not pushed. Main's classifier (`security-paths.mjs --base e245e6e6 --head 3d3a7775`) gives `security_paths=true` with 12 paths; the new one is `c01-c12.int.test.ts` |
| Lane B evidence | At `4a0faee3`: red on C9 only (D-ORCH-147), as PR080-SEC-05 predicted. At `3d3a7775`: running in the TASK-080 worktree while this round was written. No result was read. SQL behaviour below was probed on PGlite 0.4.3 (PostgreSQL 17.5) |
| Delta | `4a0faee3..3d3a7775`: 28 files, +348/−42. Every hunk maps to a round-1 finding of this record or of the code review |
| Reviewer / date | security-analyst, 2026-11-21, round 2, pre-push. Host rule: foreground commands only, one at a time, each with a timeout of 8 minutes or less. No Docker, no command in the TASK-080 worktree. Git reads used the shared object store from the main checkout. Method: a `git archive 3d3a7775` extract in the session scratchpad. Its `node_modules` is a directory of junctions to the main checkout's entries, with `@platform/*` pointing at the extract's own workspaces. The `4a0faee3` rule file was swapped in and restored (`cmp` identical) as the positive control. ESLint ran with the repository's `eslint.config.mjs`, type-aware rules off. Sources were type-stripped for the money and hash probes. SQL ran on PGlite with the real bootstrap files `00`, `01` and `02` (passwords and the three `CREATE EXTENSION` lines removed) |

### R2.1 What I verified

| Probe | How | Result |
|---|---|---|
| P1 purity matrix (49 cases) | `ESLint#lintText` as `packages/pricing/src/zz-probe.ts`, all rules of the real configuration counted; the same cases with the `4a0faee3` rule swapped in | **Round-1 bypasses, 13 rebuilt cases:** `declare const { Date }` and `{ now: Date }`, `import type { Money as Date }`, type-only `namespace Date` / `module Date` / `export namespace Math` / `namespace process` / `namespace globalThis` / `namespace performance`, `import Date = NS.T`, and template `import()` of the queues subpath, of the root and of a `./tests/` helper. **13/13 reported at the head, 0/13 with the old rule.** **New spellings against the fix:** an overload `function process(…): void;`, a parameter `Math`, a destructured parameter `{ Date }`, `catch (Date)`, a type parameter `Date`, `interface Date`, `import type * as Date`, `import { type Money as Date }`, `enum E { Date = 1 }` and `import Date = require('./x.js')` all give `shadowed <name>`. A template with escapes (`` `@platform/shared/queues` ``, `` `node\x3afs` ``) is read cooked and reported. A `/* global Date */` comment still leaves `Date.now()` reported. `export declare function Date` gives one `declare Date` report and no second one. A class static member `Date` is not a binding (only `Date.now()` is reported). A wrong-case `eslint-disable-next-line platform/Pricing-Purity` does not suppress anything. **Not reported by pricing-purity (PR080-SEC-06):** `import q = require('@platform/shared/queues')`, `export import q = require(…)`, `import s = require('@platform/shared')` and `import x = require('./tests/x.js')` (only `@typescript-eslint/no-require-imports` reports them), and `import('@platform/shared/' + 'queues')`, `import('…' as string)` and `import('@platform/' + 'shared')` (only `platform/static-module-specifier` reports them). With an inline disable of that one rule plus a TASK ID, each of these is **clean under the whole configuration**. `import fs = require('node:fs')` and `import('node:fs' satisfies string)` stay held by the protected `boundaries/dependencies`. Controls: `Date.now()` reported once; `declare const Date` gives exactly one `declare Date`; `Math.max`, `Date.parse`, `instanceof Date`, a type-only subpath import and a pure function are clean; a literal `import()` of the subpath is reported |
| P2 fixtures and real sources | Every file under `tests/fixtures/lint/rules/pricing-purity/` linted at its fixture path; every non-test `packages/pricing/src` file | Head: 30/30 `bad-*` reported, each exactly once; `ok-pure.ts` clean; 11/11 real sources clean (including the new `canonical-json.ts`). With the old rule: 26/30. The 4 that the old rule misses are the new `bad-declare-destructured`, `bad-shadow-import-type`, `bad-shadow-namespace` and `bad-template-import-subpath`, so each one pins the fix. `bad-declare-math` and `bad-declare-process` pin the `WATCHED_GLOBALS` members (R1-m3) |
| P3 suppression policy | The head `check-suppressions.mjs --root <scratch git repo> --json` over 9 files under `packages/pricing/src` | Refused (`suppression/protected-rule`): `platform/pricing-purity` as `eslint-disable-next-line`, as an `eslint-disable` block, as `eslint-disable-line`, and inside a list with `no-console`; also the `platform/money-arith` control. `/* global Date */`: `suppression/inline-config`. Accepted: `platform/static-module-specifier` and `@typescript-eslint/no-require-imports` with a TASK ID (PR080-SEC-06), and the wrong-case name (harmless, P1). The checker over the whole head extract (after a `git init` of it): 0 findings, 6 suppressions, none of `pricing-purity` |
| P4 TypeScript acceptance | `ts.createProgram` with `packages/pricing/tsconfig.json`'s parsed options (TS 6.0.3), emit when clean | Accepted: `import q = require('@platform/shared/queues')` (emitted as `createRequire(import.meta.url)` plus `__require("@platform/shared/queues")`), `import fs = require('node:fs')`, the concatenated and the `as string` `import()`, and the overload `function process`. Control `const bad: number = 'x'`: TS2322 |
| P5 candidate fix for PR080-SEC-06 | The head rule patched in the extract (exact, unique edits), the P1 and P2 matrices re-run, the file restored and `cmp`-checked | Every SEC-06 form is now reported by pricing-purity, including the three that carry an inline disable. `import type T = require(…)` stays clean for pricing-purity. All other P1 rows are byte-identical. Fixtures 30/30 and 1/1, real sources 11/11 clean |
| P6 migration, triggers, grants (PGlite 17.5) | Bootstrap `00`/`01`/`02`, a `public.uuidv7()` stub, then `migration.sql` as `platform_migrator`. Probes ran as the owner and as `platform_app`, then `down.sql` twice, then `up` again | Both functions: owner `platform_migrator`, `prosecdef = false`, `proconfig = {search_path=pg_catalog, pg_temp}`, ACL `{platform_migrator=X/platform_migrator}` (no PUBLIC EXECUTE, via the bootstrap default privileges). Triggers: the row guard `tgtype` 25; `trg_pricing_config_versions__no_truncate` `tgtype` 34 (BEFORE, TRUNCATE, statement); both enabled. Table ACL: the owner, plus `platform_app=r` only. Sources: `ADMIN`, `ISO` and `seed` give 23514 on `ck_pricing_config_versions__source`; `OPERATOR`, `SAMPLE` and `SEED` are admitted. `TRUNCATE` over drafts only: allowed (0 rows). With a published row, `TRUNCATE`, `TRUNCATE ONLY`, `… CASCADE` and `… RESTART IDENTITY` all give P0001 `PRICING_VERSION_IMMUTABLE`, and both rows are kept. Deleting the draft: allowed. Deleting the published row: P0001. A direct call of the new function: 0A000 for the owner ("trigger functions can only be called as triggers") and 42501 for `platform_app`. `platform_app` `TRUNCATE`: 42501. `session_replication_role` for the migrator: 42501. The owner can still `DISABLE TRIGGER` and then truncate (shown inside a rolled-back transaction); that is the documented owner capability. `down.sql` ran clean twice and left no function and no table; `up` re-applied both triggers |
| P7 C9 (PGlite 17.5) | C9's own SQL (`c01-c12.int.test.ts:249-252`) and its `enumCheckValues` (`scans.ts:196-202`), copied verbatim | Selected: `ck_pricing_config_versions__source` → `['OPERATOR', 'SAMPLE', 'SEED']`, equal to the new `ENUM_CHECKS` entry. No other public CHECK of this migration is selected |
| P8 migration linter | `tsx tools/db/lint-migrations.ts` on the extract; 4 mutants of the new function, each restored (`cmp` identical) | Head: no findings; `prisma validate` passes. `SECURITY DEFINER` added: rule 15. A `current_setting('app.org_id')` read added: rule 16. `DROP TABLE` appended (control): rule 2. `SET search_path` removed: **no finding**; C11 also pins `search_path` for SECURITY DEFINER functions only (`c01-c12.int.test.ts:171-175`). See R2.4 |
| P9 carrier money with context (375 refusals) | `normalise/money.ts` type-stripped with the extract's sources; 15 hostile values × 5 currencies × 5 contexts; random sentinels in the value, the currency and the context | Every refusal is `CarrierError` `CARRIER_UNKNOWN_ERROR`. **Value or currency sentinel leaks: 0** across message, `cause`, `toJSON`, `util.inspect` (hidden fields too) and the stack. The context is reduced by the constructor: a valid context keeps `carrier` and `operation`. A hostile context keeps only code-shaped strings (`carrier` and `carrierErrorCode` match `isCarrierCode` / `SAFE_CODE`), drops a non-member `operation`, and its `cause` is overridden by the helper's. A `null` context gives the code only. Control: a shape-valid carrier is kept, so the scan sees context fields. A context with a throwing getter escapes as that getter's own `Error` (adapter code only, no carrier data) |
| P10 canonical JSON | `canonical-json.ts` and `config/sample.ts` type-stripped; 20,000 xorshift-generated JSON values; refusal and edge rows with a sentinel | SHA-256 of the UTF-8 `canonicalJson(SAMPLE_PRICING_CONFIG)` equals `SAMPLE_PRICING_CONFIG_SHA256` and the seed's `PRICING_SAMPLE_CONTENT_SHA256`. The old `JSON.stringify` digest does not, so the literals moved with the definition. Fuzz: **0 differences** from the RFC 8785 library `canonicalize` on every value it accepts. 4,893 values carried a lone surrogate; `canonicalize` refuses those, while `canonicalJson` writes them as `\udXXX` escapes (R2.5). Key-shuffle invariance: 0 differences. Parse round-trip: 0 differences. Positive control: insertion-order `JSON.stringify` differs from JCS. Refused with `PricingError PRICING_CONFIG_INVALID`, sentinel never echoed (15 rows): `undefined`, a function, a symbol, a bigint, `NaN`, `±Infinity`, a `Date`, a `Map`, a class instance, a sparse array, an `undefined` member, a `toJSON` member, a nested function, a boxed `String`. Dropped silently: symbol keys and non-enumerable properties (code review R2-n1). A cycle and 20,000-deep nesting give `RangeError`; 1,000-deep is accepted; 200,000 objects take 254 ms |
| P11 secrets | Gitleaks v8.30.1 emulation over `git log -p -U0 --diff-merges=first-parent --text`: hunk fragments, keywords, `secretGroup`, entropy, no digit check, rule and global allowlists, the repository `.gitleaks.toml` from main. Then an over-approximation (keyword plus regex only, no entropy, no allowlists) | `e245e6e6..3d3a7775` (1,682 added lines): **0**. `4a0faee3..3d3a7775` (348 added lines): **0**, and also 0 for the over-approximation. Runtime controls 1, 1, 0 (expected). The delta adds three 64-hex digest lines with two distinct values: the configuration hash in `config/sample.ts` and the seed, and the dataset hash in the seed test. None of their fragments has a rule keyword. No digest is quoted in this record |
| P12 targeted unit suites | Jest `--selectProjects unit --runInBand` on the extract | `packages/pricing/src/config` (canonical JSON, sample), `normalise/money`, `check-suppressions`, `pricing-purity-shared`, `prisma/seed/reference/pricing-sample`: 65 of 68 pass. The 3 others are the `check-suppressions` CLI rows, which need a git root; after a `git init` of the extract they pass (21/21). `negative-fixtures.test.ts` filtered to the pricing rows: 36 pass (404 skipped) |
| P13 record simulation | A `--shared --no-checkout` clone with a sparse checkout (`.github`, `docs/05-quality/security`, `tools/ci`). Plumbing scenario commits on main `965a5a34`, with this record (round 1 plus this round) renamed `PR-9999-…`. `git merge-tree` with the PR head, then `commit-tree` with both parents, checked out detached. Main's real checker `--base <scenario main> --head <scenario head> --pr 9999 --json` | **Pass, satisfied by `3d3a7775`:** the record merged with `3d3a7775`; a later `packages/pricing`-only commit; a later docs-only commit. **Missing, as expected:** no `PR-9999` record (the pending name only, round 1); round 1 only (it names `4a0faee3`, and owned paths changed after it); a FAIL verdict row appended; the round-2 Head row naming the main commit; a later `prisma/sql/grants.manifest` commit; a later `tools/eslint-rules/pricing-purity.mjs` commit (the PR080-SEC-06 fix, if taken here, needs its own delta round); round 2 under the pending name (C4). The candidate has 2 Head rows (one per round) and its last Verdict row is this round's |

### R2.2 Closure of the round-1 findings

| ID | Status | Evidence |
|---|---|---|
| PR080-SEC-01 (LOW) | **Closed** | `'platform/pricing-purity'` is in `PROTECTED_RULES` (`tools/lint/check-suppressions.mjs:33`), with a `[PR080-SEC-01]` test row. All four directive forms are refused (P3). The tree has no such suppression. Code review R2 killed the unprotect mutant |
| PR080-SEC-02 (INFO) | **Closed** | The `Program:exit` binding pass reports any binding of a `WATCHED_GLOBALS` name that `checkAmbient` has not already reported (`pricing-purity.mjs:280-287`). It covers all three listed forms and the namespace family, and fails closed for parameters, overloads, catch clauses, enum members and type-only imports (P1). Three fixtures pin it (P2), and `WATCHED_GLOBALS` is exported and pinned as a set. The residual spellings found now are in import arms, not in shadowing (PR080-SEC-06) |
| PR080-SEC-03 (INFO) | **Closed** | `checkSource` uses the shared `staticSpecifier` (`pricing-purity.mjs:210-211`), which reads an expression-free template literal, cooked. The subpath, root and test-helper template forms and the escaped forms are reported (P1). `bad-template-import-subpath` pins it |
| PR080-SEC-04 (INFO) | **Closed** | `trg_pricing_config_versions__no_truncate`, BEFORE TRUNCATE FOR EACH STATEMENT, with its own SECURITY INVOKER function (`migration.sql:64-79`); `down.sql` drops it. Behaviour and catalog as validated in round 1 (P6). The `[PR080-SEC-04]` case in `pricing-sample.int.test.ts` pins it for lane B (C2). Race-free by construction: PostgreSQL takes the ACCESS EXCLUSIVE lock in `ExecuteTruncate` before it fires the BEFORE TRUNCATE triggers (read from the source, not probed) |
| PR080-SEC-05 (INFO, merge-relevant) | **Closed in code; lane B proof under C2** | `ENUM_CHECKS.ck_pricing_config_versions__source = ['OPERATOR', 'SAMPLE', 'SEED']` (`c01-c12.int.test.ts:313-315`), equal to C9's selection on the shipped CHECK (P7). The drift control `ck_roles__scope` is unchanged |

### R2.3 New finding

| ID | Title | Severity | CWE | OWASP | File:line | Owner / due |
|---|---|---|---|---|---|---|
| PR080-SEC-06 | pricing-purity's import arms skip `import x = require(…)` and computed `import()` specifiers. Those forms are held only by unprotected rules | INFO | CWE-693 | A04 | `tools/eslint-rules/pricing-purity.mjs:266-268` (`ImportExpression`), no `TSImportEqualsDeclaration` visitor | senior-developer: the next change to `pricing-purity.mjs`, before US-141. Optional in this PR, which would need another delta round (P13) |

**Description.** The rule checks a specifier only when it is static (`staticSpecifier`), and it has no visitor for TypeScript's `import x = require('…')`. P1, P3 and P4 show two gaps:

1. `import q = require('@platform/shared/queues')`, `import s = require('@platform/shared')` and `import x = require('./tests/x.js')`. TypeScript 6 accepts these under the pricing options and emits a working `createRequire` load, which `require(esm)` serves on Node 24. Pricing-purity is silent. Only `@typescript-eslint/no-require-imports` reports them.
2. `import('@platform/shared/' + 'queues')`, `import('@platform/shared/queues' as string)` and `import('@platform/' + 'shared')`. TypeScript accepts these and emits the same `import()`. Pricing-purity is silent. Only `platform/static-module-specifier` reports them.

Neither of those two rules is in `PROTECTED_RULES`. So `// eslint-disable-next-line @typescript-eslint/no-require-imports -- TASK-nnn …` (or the `static-module-specifier` form) makes the import lint-clean under the whole configuration, and `check-suppressions` accepts it. The import can then load `retryDelayMs`, whose default random source is `Math.random`, or the root's `uuidv7`. The boundaries allow-list does not help, because it admits `@platform/shared/**` for pricing. Both gaps date from TASK-076. Round 1 did not probe these spellings, and the delta did not introduce them. Now that SEC-01 protects the purity rule itself, its import arms are only as strong as the unprotected rules that force a static ESM specifier.

**Exploitability and impact.** No attacker input reaches this. The author would have to rewrite an import into a non-idiomatic form on purpose, and also suppress a second rule. Both changes are visible in the diff and counted in the NFR-MAINT-002 summary. The impact is the same as SEC-01's (price determinism, AT-US-138-02). This is the PR076-SEC-07 / PR080-SEC-02/03 class: INFO.

**Remediation (validated, P5).** Pricing never needs a computed `import()`. Refuse it inside the protected rule, and check the import-equals form like any other import:

```js
      ImportExpression(node) {
        if (staticSpecifier(node.source) === undefined) report(node, 'import() of a computed specifier');
        else checkSource(node, node.source, true, []);
      },
      TSImportEqualsDeclaration(node) {
        if (node.importKind !== 'type' && node.moduleReference.type === 'TSExternalModuleReference')
          checkSource(/** @type {never} */ (node), node.moduleReference.expression, true, []);
      },
```

An alternative is to protect `platform/static-module-specifier` and `@typescript-eslint/no-require-imports`. That is a repository-wide policy change for their owner; the edit above stays inside pricing.

**Verification.** Two `bad-*` fixtures with `[AT-US-138-02]` rows: `bad-require-subpath.ts` (`import q = require('@platform/shared/queues')`, expecting the subpath message plus `no-require-imports`) and `bad-computed-import.ts` (`import('@platform/shared/' + 'queues')`, expecting `import() of a computed specifier` plus `static-module-specifier`).

### R2.4 Checked with no finding

| Item | Evidence |
|---|---|
| D-TASK080-14 (`SEED`, `SAMPLE`, `OPERATOR`) | Concur. The CHECK follows data-model §1.7 `reference_source` without `ISO`, and C9 pins it (P6, P7). `OPERATOR` is reserved without a writer. The migrator is the only role that can write, and the seed validator admits ISO/SEED/SAMPLE only, so the reserved value adds no privilege. The int test pins `ADMIN` → 23514 on the named constraint |
| D-TASK080-17 (TRUNCATE guard) | Concur (PR080-SEC-04 closed). The function is INVOKER, uses a fully qualified table, reads no request context and returns NULL. The owner can still drop or disable the trigger (P6). That is the documented owner capability: the migration and its reviews are the control, as for the row guard. The linter and C11 pin `search_path` only for SECURITY DEFINER functions, so the P8 mutant without it survives. For an INVOKER trigger function this is defence in depth, and the function sets it. Accepted |
| D-TASK080-18 (money context) | Concur. The context goes through the `CarrierError` constructor's shape checks, and the explicit `cause` follows the spread, so a context cannot replace it. Neither the value nor the currency is echoed (P9) |
| D-TASK080-15 (canonical hash) | Concur. Round 1's ruling stands: the digest identifies a configuration version and is not an integrity control (no key; the row is insert-only and owner-written). Its definition is now order-free and reproducible (P10). `canonicalJson` has no production caller yet, only the export for US-152 and tests |
| D-TASK080-16, -19 | Concur (R2.2; D-TASK080-19 is a test-location ruling with no security content) |
| Seed and dataset literals | The configuration hash moved in both literals and in the dataset pin together. The cross-check test still compares the two texts. An already-published row with the old hash does not exist anywhere: the migration is unmerged, and lane B databases are rebuilt |
| Erratum to round 1 (P6 and §4 "Trigger function") | Round 1 gave the reason for the refused direct call as "no `USAGE` on `platform`". That is wrong: `platform_app` has `USAGE` on schema `platform` (`prisma/bootstrap/01-schemas.sql`, P6 `has_schema_privilege` = true). The refusal comes from the missing `EXECUTE`, which the bootstrap default privileges revoke from PUBLIC for `platform_migrator` (42501 "permission denied for function"). For the owner, a direct call gives 0A000. The conclusion is unchanged |

### R2.5 Code review twin (round 2, main `965a5a34`, APPROVED_WITH_NITS)

- **R2-n1 (symbol and non-enumerable keys dropped, a cycle gives `RangeError`):** concur. P10 reproduces it. No security impact: the inputs are a frozen literal now and rule rows in US-152, and the hash is not an integrity control. If US-152 ever hashes operator-edited JSON, map a cycle or excessive depth to `PRICING_CONFIG_INVALID` so a request path gets a classified error.
- **R2-n2 ("exactly RFC 8785"):** concur, with one qualifier. P10 shows the claim holds for I-JSON values only. `canonicalJson` accepts a string or key with a lone surrogate and writes it as a `\udXXX` escape, while an RFC 8785 library refuses it (4,893 of 20,000 fuzz values). When D-TASK080-15 names RFC 8785, it should say "for well-formed strings", or `canonicalJson` should refuse ill-formed strings (`String.prototype.isWellFormed`). Otherwise a JCS-based verifier and this function diverge on such input. No security impact.
- **R2-n3:** concur. Enum members and catch parameters are reported, which is fail-closed (P1).
- **Not in the twin:** PR080-SEC-06. The twin's purity probes covered bindings and template specifiers, not `import = require` or computed specifiers.

### R2.6 Lane B cases (PostgreSQL 18, final head)

Round 1 §7 stands, with these changes:

- `pricing-sample.int.test.ts` now has the `[PR080-SEC-04]` case: drafts truncate; published → P0001 for the owner and 42501 for `platform_app`; rows unchanged. The draft case also checks `ADMIN` → 23514 and `OPERATOR` admitted.
- C9 is expected green.
- C11 must also hold for `platform.pricing_config_versions_no_truncate()`: it is migrator-created and must not be EXECUTE-able by PUBLIC or `platform_app` (P6 predicts it holds).

Lane A, also required once the PR exists: `negative-fixtures` (6 new rows), `pricing-purity-shared`, `check-suppressions`, and the hosted `security-integration` job (12 paths).

### R2.7 Routing

| Item | Owner | Due |
|---|---|---|
| PR080-SEC-06 | senior-developer (validated patch and two fixtures, R2.3) | The next change to `tools/eslint-rules/pricing-purity.mjs`, and before US-141. If taken in this PR, a delta round follows (P13) |
| R2-n2 qualifier (RFC 8785 for well-formed strings) | sdlc-orchestrator, when recording D-TASK080-15; or senior-developer, if `canonicalJson` refuses ill-formed strings | With the D-TASK080-14..19 entries |
| Round-1 routes (TASK-221 `CONFIG_CHANGE`, TASK-083 / TASK-101 explanation exposure, M2 `notes` classification) | Unchanged | As in round 1 §8 |

### R2.8 Conditions

- **C1.** Closed. The C9 entry equals the shipped list (P7); proof on PostgreSQL 18 is C2.
- **C2.** Open. Lane B on PostgreSQL 18 must be green at `3d3a7775`, or at the final head, for the round-1 §7 cases plus R2.6. Triage is not evidence.
- **C3.** Closed for `3d3a7775` by this round. It stays standing for two events:
  - a further change to any of the 27 owned paths needs a delta round (P13 shows the record is voided);
  - a union merge of main that touches `prisma/sql/grants.manifest`, `tools/db/grants-manifest.test.ts`, `tools/lint/negative-fixtures.test.ts` or `prisma/tests/catalog/c01-c12.int.test.ts` (TASK-043 and TASK-051) needs a merge-only round.
- **C4.** Open. Rename this record on main once the PR exists, and confirm that the merge ref contains it (D-ORCH-136, D-ORCH-138).

| Field | Value |
|---|---|
| Verdict | PASS_WITH_CONDITIONS. No Critical, High or Medium finding. PR080-SEC-01..05 are closed (05 in code; its proof on lane B is C2). New: INFO PR080-SEC-06, routed with a validated patch. Open conditions: C2 (lane B on PostgreSQL 18) and C4 (rename); C3 stands for later owned-path changes and union merges |
