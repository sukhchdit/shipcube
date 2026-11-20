# PR-pending: TASK-076 (pure pricing engine, integer money and rounding, billable weight; pricing-purity and money-arith lint), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-076-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>`, so under the placeholder name the record step is red (section 7, control S5).

Order (D-ORCH-136, D-ORCH-138):
1. Open the PR as a draft.
2. Rename the record on main.
3. Confirm that the PR's merge ref contains the renamed record: `git fetch origin refs/pull/<n>/merge`, then `git ls-tree` it. Its first parent must be the rename commit or later.
4. Mark the PR ready.

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-076-pure-pricing-engine-integer-money`, two commits on `5145d52` (an ancestor of main): `13bb74f` (engine, money, units) and `e01979b` (lint rules). Main has moved since `5145d52` by docs, `tools/db` and `prisma/tests` commits, none of which touch this PR's paths |
| Head | e01979b59fb8867f167743a7ac3f3d4679bbcc33 |
| Lane A evidence | None: the branch is not pushed. Main's classifier (`tools/ci/security-paths.mjs`, run from the main checkout on `5145d52..e01979b`) gives `security_paths=false` (no security-critical path among 46), so the hosted `security-integration` job is not selected |
| Lane B evidence | None for `e01979b` at review time. The code review twin quotes the developer's report (unit 270/270; 100 % lines and branches on pricing, money and units); I did not read run files |
| Owned paths changed | 23, as main's checker counts them (`--base 5145d52 --head e01979b`): `eslint.config.mjs`; `tools/eslint-rules/{index,money-arith,pricing-purity}.mjs`; `tools/lint/{lint-fixtures.mjs,negative-fixtures.test.ts}`; 17 files under `tests/fixtures/lint/` (README, the `carriers-deep-import`, `pricing-purity` and `typed/money-arith` roots). So this record is a merge condition |
| Unowned paths changed | 23: `packages/pricing/src/**` (12), `packages/shared/src/{index.ts,money/**,units/**}` (10), `docs/03-architecture/api/README.md` (§11 internal-only codes) |
| Binding items checked | The TASK-076 card (`docs/04-plan/tasks/WAVE-02.md`: US-138, US-139, PR40-SEC-05, D-ARCH-115, PR #2 m10); ADR-0015 §1-§6, ADR-0009 §3/§4 (as quoted by the twin and the sources); api/README.md §11; `apps/api/src/platform/errors/classify.ts` (how a non-`AppError` reaches the client); `tools/ci/coverage-gate.mjs:49`, `:61`; the lane A no-weakening step (`.github/workflows/ci.yml:350-381`). The code review twin on main: `docs/05-quality/reviews/PR-pending-TASK-076-code-review.md` (`f938174`, APPROVED_WITH_NITS) |
| Reviewer / date | security-analyst, 2026-11-20, round 1, pre-push. Host rule (lane B owns the machine): no npm, Jest, type-check, build or Docker. Method: static review plus single-process Node 24 probes on `git archive` extracts of `e01979b` and `5145d52` (each with a `node_modules` directory of junctions to the main checkout's packages and `@platform/*` pointing at the extract's own workspaces): ESLint `calculateConfigForFile`/`lintText`/`lintFiles` with the extract's real `eslint.config.mjs`, and the TypeScript sources type-stripped by a resolve/load hook. Nothing ran in the PR worktree, not even read-only git: commits were read from the main checkout's shared object store. Line numbers come from single-file reads at `e01979b` |

## 1. Summary

The money core and the lint changes hold where the focus items point:

- **No lint control is weakened.** An effective-configuration diff of base and head over 58 repository paths shows only additions: `platform/pricing-purity` on the six non-test `packages/pricing/src` paths, and exactly one new `no-restricted-imports` pattern (`^@platform/carriers/.+$`) on all 58 paths, with no pattern or path lost. A mutation control (one rule turned off) is seen. `money-arith` only gains a fallback branch.
- **The carriers pattern reaches every re-declaration.** It sits in `RESTRICTED_IMPORT_PATTERNS`, so the test-file, hasher, Supertest and S3-seam blocks inherit it (all four probed).
- **Money integrity in the engine.** No float, string or bigint amount gets into a priced result. Overflow is refused at every helper, currency mismatch is refused, and the currency table is a `Map` (10 inherited and near-miss spellings refused). Rounding is exact and happens once, and `allocate` conserves every unit (20,000-case fuzz).
- **Error codes stay internal.** `MoneyError` and `PricingError` are not `AppError`, so `classifyThrown` maps them to 500 `INTERNAL_ERROR`.

Two LOW findings:

- **PR076-SEC-01:** the purity controls miss the clock and randomness that the allow-listed `@platform/shared` root exports (`uuidv7`), any module under `src/tests/` (outside the rule), and the respelling family of code review R1-m1 (destructuring, aliases, `process.hrtime`/`uptime`/`argv`). A candidate rule extension, validated on a scratch copy, closes all natural forms with the real sources still clean.
- **PR076-SEC-02:** the shared Money helpers check results, not operands. `add` of two forged 0.5 amounts returns 1, `sub` of two numeric strings returns a number, and `compare('9', '10')` answers 1. The engine is protected by its own `isMoney` checks; later callers (payments, the stored price snapshot) are not. A one-function operand check is validated on a scratch copy: only the forged rows change.

Four INFO items: PR076-SEC-03 to -06.

## 2. Findings

| ID | Severity | CWE / OWASP 2021 | Where (`e01979b`) | Title | Owner, due |
|---|---|---|---|---|---|
| PR076-SEC-01 | LOW | CWE-693 / A04 | `tools/eslint-rules/pricing-purity.mjs:42-46`, `:98-129`; `eslint.config.mjs:1041-1048`, `:665-674`; `packages/shared/src/index.ts:35` | Pricing purity misses `uuidv7` from the shared root, test-folder modules and respelled globals | This PR's fix cycle with code review R1-m1 (the `lint` lock is held now); at the latest before TASK-080 adds the next pricing step |
| PR076-SEC-02 | LOW | CWE-1287 / A04 | `packages/shared/src/money/money.ts:58-62`, `:65-100`, `:111-143`, `:177-184` | The Money helpers check results, not operands | This PR's fix cycle; at the latest before TASK-085 (payments) uses the helpers |
| PR076-SEC-03 | INFO | CWE-1321 / A08 | `packages/pricing/src/rounding.ts:18`; `money.ts:60` | Rates and Money are read through the prototype chain | This PR (with the 02 fix and code review R1-n3) |
| PR076-SEC-04 | INFO | CWE-117 / A09 | `packages/pricing/src/state.ts:25`, `:51`; `money.ts:67` | Error messages interpolate values before they are validated | This PR (with code review R1-m3) |
| PR076-SEC-05 | INFO | CWE-367 / A04 | `packages/pricing/src/state.ts:50`, `:59` | `explanationEntry` validates one read of `effectMinor` and copies another | This PR (with code review R1-m3) |
| PR076-SEC-06 | INFO | CWE-693 / A04 | `eslint.config.mjs:77-81` (compare `:716-724`) | The carriers deep-import control has no any-spelling twin | The task that first adds a subpath export to `@platform/carriers` |

## 3. Findings in detail

### PR076-SEC-01 (LOW): pricing purity misses `uuidv7` from the shared root, test-folder modules and respelled globals

**Where.**
- `pricing-purity.mjs` reports a fixed list of member forms (`:98-113`: `Date.now`, `Math.random`, `performance.now`, `crypto.<random>`, `process.env`, each also behind `globalThis.`), `Date()`/`new Date()` with zero arguments (`:114-118`), and I/O specifiers only (`isIoModule`, `:42-46`).
- The rule's block ignores `TEST_FILES` (`eslint.config.mjs:1045`, which includes `**/{test,tests,__tests__}/**`).
- The second control, the boundaries allow-list for `packages/pricing` (`:665-674`), admits `@platform/shared`, whose root exports `uuidv7` and `uuidV7Timestamp` (`packages/shared/src/index.ts:35`; `ids/uuidv7.ts:14-16`: `uuid` `v7()`, a 48-bit millisecond timestamp plus random bits). Outside `logging/` and `queues/`, `uuid` is the only clock or randomness source under `packages/shared/src`.

**Probe.** 40 cases (36 bypass probes and 4 controls), each linted as `packages/pricing/src/probe.ts` with the extract's real config (non-typed parsing). The positive controls (`Date.now()`, `Math.random()`, `process.env[...]`) are reported, and the clean control is clean. **Missed by every control:**
- **(a)** `import { uuidv7 } from '@platform/shared'` with `uuidv7()`, and `uuidV7Timestamp(uuidv7())`, which is the clock in milliseconds.
- **(b)** A production module importing `./tests/clock.js` with a real file behind it, where `clock()` returns `Date.now()`. The helper is outside the rule, and no boundaries policy stops production code in `packages/pricing` from importing its `tests/` folder.
- **(c)** The respelling family (concurs with code review R1-m1, which found most of it): `const { env } = process`, `const { now } = Date`, `const D = Date; new D()`, `const M = Math; M.random()`, `` Math[`random`]() ``, `new Date(...[])`, `Reflect.construct(Date, [])`, `process.hrtime.bigint()`, `process.uptime()`, `process.argv`, `performance.timeOrigin`, `Date.prototype.constructor()` and `crypto.subtle.*`.

**Held:**
- `fetch` (`outbound-http-via-client`) and `Intl` (`no-tofixed-tolocalestring`).
- `node:*` in six forms: static import, `export *`, `import()`, `import x = require()`, `require()` and `createRequire`. Boundaries, plus `pricing-purity` where it applies.
- `@platform/shared/logging`, `pino` and the `uuid` package (boundaries).
- `new Function` is `@typescript-eslint/no-implied-eval` in the real (type-aware) lint.

**Impact.** AT-US-138-02 states that the engine reads no clock, randomness or environment. A step that does breaks AT-US-138-01's byte-identical result and makes the stored price snapshot (REQ-PRICE-017) impossible to reproduce for audit, disputes or a re-check. A step that reads the environment makes the price depend on the deployment. No user input reaches this; it needs a developer change that passes review. (a) is the natural spelling for "an id for an explanation entry", which later steps add. Impact medium × likelihood low = LOW.

**Remediation (validated on a scratch copy).** Extend the rule:
1. **A global-scope pass.** On `Program:exit`, walk `context.sourceCode.scopeManager.globalScope.through` (plus the references of configured globals, `variables` with no `defs`), skipping type-only references.
   - Report every value reference to `process`, `performance`, `crypto`, `globalThis`, `self`, `window` and `global`. The engine needs none of them.
   - Report `Date` except in `new Date(<one non-spread argument>)`, `Date.UTC` and `Date.parse`.
   - Report `Math` except as `Math.<static name other than random>`.
   - Aliases, destructuring, computed and template keys, spread and `Reflect` calls then all fall out.
2. **Imports.**
   - From `@platform/shared`: refuse the named imports or re-exports `uuidv7` (an `IMPURE_SHARED_EXPORTS` list), and refuse a namespace import, a default import, `export *` or `import()` of the root.
   - Refuse relative specifiers into `tests/`, `test/` or `__tests__/`, and `*.test.*`.

The candidate was installed in the extract's rule beside the existing visitors. Results:
- 31 of the 36 bypass probes are then reported, including every (a)-(c) case; the 3 positive controls still report and the clean control stays clean.
- The 5 left: `Intl` is caught by `no-tofixed-tolocalestring` and `new Function` by the type-aware `no-implied-eval`. `new Event().timeStamp`, `import.meta.dirname` and `setTimeout` remain; they are contrived or not clock reads.
- The 8 real non-test pricing sources stay clean.
- The 7 `bad-*` pricing-purity fixtures and `layering/pricing-io` still report, and `ok-pure.ts` stays clean.

The real fix should merge the visitors so a form is reported once. **Test:** one `bad-*` fixture each for `uuidv7` from `@platform/shared`, a `./tests/` import, a destructured `process`, an aliased `Date` and `process.hrtime`.

### PR076-SEC-02 (LOW): the Money helpers check results, not operands

**Where.**
- `isMoney` (`money.ts:58-62`) is the only operand check, and only the callers that choose to call it get it.
- `add`, `sub` and `compare` start with `assertSameCurrency` (`:65-69`), which compares the two currency strings and nothing else.
- `add`/`sub` validate the result with `minor()`.
- `compare` and `equals` (`:92-100`) validate nothing.
- `mulRatio`, `allocate` and `convert` (`:111-161`) call `BigInt(value.amount)`.
- `toMajorString` (`:177-184`) formats whatever it gets.

**Probe** (type-stripped sources, forged `{ amount, currency }` objects):
- `add(0.5, 0.5)` returns `{ amount: 1 }`.
- `sub('1050', '1')` returns `{ amount: 1049 }`.
- `compare('9', '10')` returns `1`: lexicographic, where the numeric answer is `-1`.
- `add` of two `{ currency: '__proto__' }` values returns a Money in `__proto__`.
- `equals(1050n, 1050)` returns `false`.
- `mulRatio` and `allocate` of 0.5 throw a raw `RangeError` from `BigInt`, not `MONEY_INVALID`.
- `toMajorString` of 0.5 prints `0..5`.

The valid paths hold: overflow is `MONEY_INVALID` everywhere it was probed, and `CURRENCY_MISMATCH` fires for USD/EUR.

**Why the engine is safe today.** `validateInput` calls `isMoney` on the cost (`engine.ts:51`): float, string and bigint costs are all refused. `chargeLine` calls it on every line. `totalsOf` sums from `zero`, so every partial sum, and therefore every line, must be a safe integer.

**Impact.** The helpers are exported from the `@platform/shared` root to every app, and the type is structural. Later callers will hand them a Money they did not build:
- the stored price snapshot read back from JSON (REQ-PRICE-017);
- a raw-SQL row (`pg` returns `int8` as a string);
- a request value after a schema that allows numbers.

A wrong `compare` in a "refund at most the captured amount" or "cover at most the maximum" check (payments, TASK-085; cover, later), or a `sub` over strings, moves money on a wrong figure without an error. Impact medium × likelihood low = LOW.

**Remediation (validated on a scratch copy).**
- `isMoney` reads own data properties only (`Object.getOwnPropertyDescriptor(value, key)`, `'value' in descriptor`).
- A private `operand(value)` throws `MONEY_INVALID` unless `isMoney(value)`. It is called first in `assertSameCurrency` (which covers `add`, `sub` and `compare`), `negate`, `equals`, `mulRatio`, `allocate`, `convert` and `toMajorString`.

A differential run of the full runtime probe set (114 rows) on the patched copy (this fix plus the PR076-SEC-03 `Object.hasOwn` change) and the unpatched copy changed exactly 19 rows, all with forged inputs:
- 13 that were accepted, threw a raw `RangeError` or printed `0..5` now fail with `MONEY_INVALID` (`PRICING_CONFIG_INVALID` for the inherited `bps`);
- 6 that were already refused now fail earlier, with the operand message.

Every valid row is identical, including the 20,000-case `allocate` fuzz, the USD to INR/JPY/KWD conversions, rounding, overflow and engine determinism.

**Test:** the forged rows above expect `MONEY_INVALID`, and `isMoney(Object.create({ amount: 1, currency: 'USD' }))` is `false`.

### PR076-SEC-03 (INFO): rates and Money are read through the prototype chain

`rateRatio` chooses the basis-point form with `'bps' in rate` (`rounding.ts:18`), and `isMoney` destructures (`money.ts:60`). Both read inherited properties:
- `rateRatio(Object.create({ bps: 1500 }))` uses the inherited 1500.
- `isMoney(Object.create({ amount: 1, currency: 'USD' }))` is `true`.

The precondition is a prototype-pollution bug elsewhere in the process. Given that, a polluted `Object.prototype.bps` would silently turn every `{ decimal }` rate from configuration JSON into that basis-point value (margins, surcharges and tax alike), and a polluted `amount`/`currency` would make `isMoney({})` true.

**Fix.**
- `Object.hasOwn(rate, 'bps')`, and refuse a rate with both keys or neither (code review R1-n3). Validated: the inherited case becomes `PRICING_CONFIG_INVALID`.
- Own-data reads in `isMoney` (the 02 fix).

### PR076-SEC-04 (INFO): error messages interpolate values before they are validated

Three messages interpolate a value before it is checked:
- `chargeLine` builds its `MONEY_INVALID` message with `line.code` (`state.ts:25`) before the `LINE_CODE` check (`:29`).
- `explanationEntry` interpolates `ruleKey` (`:51`), which is never validated.
- `assertSameCurrency` interpolates both currencies (`money.ts:67`) without checking that they are codes.

Probe: a line code carrying a newline and an e-mail-shaped value, a rule key with a newline, and a 30-character "currency" ending in a newline all appear verbatim in `message`.

The codes are internal: `classifyThrown` returns `unexpected` for a non-`AppError`, and the client gets 500 `INTERNAL_ERROR`. So the text reaches only the error log, where Pino's JSON encoding escapes the newline. The developer's D-TASK076-04 and the twin's ruling ("messages carry currency codes, line codes and rule keys only") hold only for validated values.

**Fix.**
- Validate before interpolating: check `LINE_CODE` first, and interpolate a code only after it passes.
- The 02 fix already validates currencies before the mismatch message is built.

### PR076-SEC-05 (INFO): `explanationEntry` validates one read of `effectMinor` and copies another

`explanationEntry` checks `Number.isSafeInteger(entry.effectMinor)` (`state.ts:50`) and then copies `entry.effectMinor` again (`:59`). A step that places an entry in the state directly, not through `appendEntry`, with an accessor-backed `effectMinor` gets `0.5` into the frozen result. Probe: `runPricing` with such a step returns `effectMinor: 0.5`.

Lines are not affected: the same trick on two lines is refused by `totalsOf`, and through `appendLine` the second `chargeLine` pass refuses the copy. Steps are reviewed engine code, so this is INFO. It is one more case of code review R1-m3.

**Fix.** Copy first, validate the copy, then freeze the copy. Do the same for the `chargeLine` fields that R1-m3 adds.

### PR076-SEC-06 (INFO): the carriers deep-import control has no any-spelling twin

`CARRIERS_DEEP_IMPORT_PATTERN` is a `no-restricted-imports` pattern. The core rule does not visit `import()`, and `.+` needs at least one character after the slash. `import('@platform/carriers/guard')` and `import * as c from '@platform/carriers/'` are therefore reported only by `import-x/no-unresolved`, because `@platform/carriers` exports `.` only. TypeScript (NodeNext) and Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` refuse them too.

That holds while the exports map has one entry. Once a subpath is exported (a `./testing` entry for the Mock adapter is the likely first), a dynamic import of it passes lint.

The RBAC matrix control has the boundaries twin for exactly this case (`eslint.config.mjs:716-724`).

**Fix, when the first subpath export is added.** Either:
- a boundaries `dependency.source` arm for `@platform/carriers/**` from app and package code; or
- a repository test that pins the carriers `exports` map to `.`.

## 4. Verification of the focus items

### 4.1 No lint control weakened (effective-configuration diff)

**Method.** `ESLint#calculateConfigForFile` over 58 paths, on the head and base extracts, comparing every rule's severity and options after scrubbing the root.

**Paths covered:**
- pricing sources in five extensions, tests, `src/tests/`, `__tests__/` and `test/`;
- near misses: `packages/pricing-v2`, `packages/Pricing`, `packages/pricing/x.ts`;
- money, units, `uuidv7`, the shared root and logging;
- carriers;
- the audit store and the authz generator;
- api modules, the S3 seam, the hasher, egress, the db client homes and the audit viewer;
- worker, web and admin;
- `tests/api/helpers` and the RBAC tests;
- `tools/**`, `prisma/**` and the root configuration files.

**Result.** 0 weakened. Added:
- `platform/pricing-purity` on `packages/pricing/src/{engine.ts, lines/base-freight.ts, new-step.mts, helper.js, helper.cjs, x.tsx}`.
- On all 58 paths, `no-restricted-imports` gained exactly `^@platform/carriers/.+$`. No pattern was lost, and `paths` is unchanged.

**Mutation control.** `platform/money-arith` turned off for `packages/shared/**` in the head run reported 4 weakened paths.

**Rule logic.**
- `money-arith`'s name branch is unchanged, except that `return null` became `return brandedName(inner)`. `brandedName` returns `null` without a program, so the reported set can only grow.
- `pricing-purity` is new.
- `index.mjs` only registers it.

### 4.2 `CARRIERS_DEEP_IMPORT_PATTERN` and the `restrictedImportsExcept` re-declarations

**Reported by `no-restricted-imports`** (12 probes):
- a value import;
- an upper-case variant (ESLint's `regex` patterns are case-insensitive by default);
- `export *`;
- `import c = require()`;
- the same import in a `*.test.ts` file (the `TEST_FILES` re-declaration, `:1165-1171`), in the S3 seam, in the hasher module and in the Supertest helper folder. The pattern is in `RESTRICTED_IMPORT_PATTERNS`, so every `restrictedImportsExcept` block inherits it.

**Other controls:**
- A relative `../packages/carriers/src/index.js` is reported by `import-x/no-relative-packages`.
- `import()` and the trailing-slash form: PR076-SEC-06.

**Root import:** lints clean.

`git grep` finds no deep carriers import in code at the head.

### 4.3 The typed fixture pass (`tools/lint/lint-fixtures.mjs:68-71`, `:79-92`)

**Scope of the change.**
- Only `typed/<rule>` roots replace `disableTypeChecked` with `project: <root>/tsconfig.json`.
- The other roots, the hermetic overrides and the rules under test are unchanged.
- Lane A's no-weakening step checks out the base copies of the suite, the fixtures and `lint-fixtures.mjs` (`ci.yml:350-381`), so the base run never meets `typed/`.

**Type-aware branch against the real `Minor` brand.** 24 cases with the real configuration and the project service, written into the extract's `packages/pricing/src`.

**Reported:**
- parameters and locals;
- `T extends Minor`;
- a `reduce` accumulator;
- a `Minor` property;
- `a ?? 0`;
- `as number` and `satisfies`;
- destructured, indexed and template-indexed members;
- tuple elements;
- `Math.round(a * 1.15)`.

**Not reported:**
- the brand-stripping conversions `Number(a)`, `+a`, `const n: number = a`, `a.valueOf()` and `<number>a`;
- a compound assignment whose `Minor` operand is on the right only.

These concur with code review R1-m2 and R1-n9. No new ID.

One note for R1-n9: the rule's brand constants (`__brand`, `'Minor'`) are not tied to `money.ts:21`, because the typed fixture uses a stand-in. A one-line test that reads the brand from `money.ts` would catch a rename.

### 4.4 Money integrity

**Engine:**
- Float, string and bigint costs are refused.
- The arithmetic is bigint rationals only.
- `fromMajor` refuses `0.1 + 0.2` and `1.005` for USD, rather than rounding them.
- A JavaScript number enters only through its shortest round-trip text.

**Overflow** is refused for `add`/`sub`/`sum` at `MAX_SAFE_INTEGER`, for `mulRatio`, and for `fromMajor` of `90071992547409.92`, `1e400` and `1e21`. Two `MAX_SAFE_INTEGER` lines are refused in totals. A single `MAX_SAFE_INTEGER` cost prices.

**Currency mismatch** is refused (USD/EUR in the helpers and in the engine).

**Currency lookups.** `money(1, x)` is `CURRENCY_UNKNOWN` for these 10 values: `__proto__`, `constructor`, `toString`, `hasOwnProperty`, `valueOf`, `usd`, ` USD`, a NUL suffix, `XTS` and `XAU`. The same holds for `new String('USD')`, for `convert` to `__proto__`, and for `sellCurrency: '__proto__'`.

**Unit tables are plain objects.** `toGrams`/`displayWeight` with `__proto__`, `constructor` or `toString` throw a `TypeError`: fail-closed. I concur with code review R1-n4. `normalisePackage` with `unitSystem: '__proto__'` gives `VALIDATION_ERROR`.

**Rounding:**
- Half away from zero: 1050 at 1500 bps gives 158, and -1050 gives -158.
- `allocate` conserves every unit: 20,000 seeded cases, 0 mismatches.

**`parseDecimal`:**
- The regex is linear and runs only after a 64-character bound.
- The exponent is at most 400.
- 40,000 worst-case parses took 237 ms in total.

Gaps: PR076-SEC-02 and -03.

### 4.5 Determinism

- Two `price()` calls on equal inputs serialise to identical JSON.
- The sampled result paths are frozen.
- `RATE_CARD` is refused before M2 (`COST_SOURCE_NOT_SUPPORTED`).
- The lint side is PR076-SEC-01.

### 4.6 Error codes do not leak

`classifyThrown` (`apps/api/src/platform/errors/classify.ts`) gives `AppError`, `DbError` and the known framework failures a 4xx status; every other `Error` is `unexpected`, and the client gets 500 `INTERNAL_ERROR`. `MoneyError` and `PricingError` extend `Error`, so their codes and messages never reach a response body. The api README §11 row lists them as internal-only.

The units module's `VALIDATION_ERROR` issues name the field and the JSON pointer, never the entered value. Message hygiene is PR076-SEC-04.

### 4.7 Secrets

**Scan.** An over-approximating Gitleaks scan of the 2,570 added lines:
- the pinned v8.30.1 `config/gitleaks.toml`, keyword prefilter and rule regexes only (no entropy, no allowlists);
- 220 rules compiled;
- the runtime PAT and AWS-id controls fired.

**Result.** 4 `generic-api-key` hits, all on i18n label-key lines (the `charges.*` label constants and test expectations). They are false positives, with no secret, and the real rule's entropy threshold drops them. The test data is synthetic.

**Not scanned:** `.env*` files; the PR changes none.

## 5. Earlier items

- **PR #2 m10** (type-aware `money-arith`). Closed by the code review twin. I concur: the branch works against the real brand (section 4.3).
- **PR40-SEC-05 / D-ARCH-115.** The `packages/pricing` and `packages/shared/src/money` 95/95 scopes exist in `tools/ci/coverage-gate.mjs` (`:49`, `:61`). This PR lands their first measured sources, so the coverage quotes from lane B are condition C1.
- **TASK-075 code review m2 / AT-US-121-05.** The carriers pattern and its three fixtures land here, under the `lint` lock. TASK-075's fix cycle must not add them to `eslint.config.mjs` again. TASK-075's only owned path is `tools/lint/carrier-wire-boundary.test.ts`, and the two PRs' owned sets are disjoint. A main merge into whichever PR is second therefore voids neither record, unless that PR's fix cycle starts editing one of this PR's owned files.

## 6. Code review twin

The twin record is on main at `f938174`: APPROVED_WITH_NITS, 5 MINOR, 11 NIT.

**Concurrence:**
- **R1-m1** (purity reach): rated LOW in PR076-SEC-01, which adds (a) `uuidv7` through the allow-listed import and (b) the `tests/` folder. Neither is in the twin's list.
- **R1-m2** (compound assignment): concur. A reach gap of a money lint; no separate ID.
- **R1-m3** (re-validation claim): concur. PR076-SEC-05 adds the double read, and PR076-SEC-04 the message ordering.
- **R1-m4 and R1-m5:** concur. Architect rulings; no security impact beyond parity.
- **The NITs:** concur with R1-n2 (`now` calendar range, before FX staleness uses it), R1-n3 (with PR076-SEC-03), R1-n4 (section 4.4), R1-n6 (the message pin is lost in the head suite, but the lane A base-ref run still pins it), R1-n9 (section 4.3) and R1-n10.
- **R1-n10, from the security side:** billable weight does not price anything before `RATE_CARD` (M2). The task that prices from billable weight must have the engine derive or verify the volumetric weight from the service rule. A forged `volumetricG: 1` is accepted today, and in M2 it would undercharge.

None of the twin's rulings conflicts with this record.

One citation note: the twin's line numbers for `state.ts`, `engine.ts` and `rounding.ts` (for example `state.ts:244-283`; the file has 66 lines) look offset, as from a multi-file listing. This record cites single-file lines at `e01979b`.

## 7. Record binding and simulation

- **The binding.** The single `Head` row names `e01979b`. The PR changes 23 owned paths.
- **When the fix cycle voids the binding.** The checker voids it when any owned path changes after `e01979b`. The R1-m1/R1-m2 and PR076-SEC-01 fixes all touch `tools/eslint-rules/**` and `tests/fixtures/lint/**`. So a fix cycle that takes them needs a new round (C3).
- **An unowned-only fix keeps the binding** (`packages/**` only: PR076-SEC-02 to -05, R1-m3). I ask for a delta round anyway when PR076-SEC-01 or -02 is fixed, because both touch reviewed controls.

**Simulation.** I used main's real `tools/ci/check-security-owned-paths.mjs` (copied from `origin/main` out of the clone) in a `--shared` sparse clone. Scenario commits were built by plumbing on top of `e01979b` and the main tip. This record was placed as `PR-9999-TASK-076-security-review.md` (`--pr 9999`, `--base 5145d52`, the merge base). The results are in the table below.

| Scenario | Expected | Result |
|---|---|---|
| S1 The record committed on top of `e01979b` (`--head` = that record commit) | pass | pass |
| S2 Merge ref: the record committed on main (tip `d52a340` when this round was written), merged with the head; `--base` = merge base `5145d52` | pass | pass |
| S3 Control: the merge ref without a record | fail | fail (`missing`) |
| S4 Control: `eslint.config.mjs` changed after the head | fail | fail (the record names `e01979b`) |
| S4b Control: `tools/eslint-rules/pricing-purity.mjs` changed after the head (the R1-m1 / PR076-SEC-01 fix shape) | fail | fail |
| S4c Commits after the head that change `packages/pricing/src/engine.ts` and `packages/shared/src/money/money.ts` only (the PR076-SEC-02 fix shape) | pass | pass (the checker keeps the binding; C3 asks for the delta round anyway) |
| S5 Control: the placeholder name `PR-pending-TASK-076-…` | fail | fail |
| S6 Control: a later `FAIL` verdict row | fail | fail |
| S7 Control: the `Head` row names the base `5145d52` | fail | fail |
| S8 Control: the `Head` row names a main commit | fail | fail |

10 of 10 as expected. The record has exactly one `Head` row and one `Verdict` row (the last table row of the file).

## 8. Merge conditions and routes

**Conditions.**
- **C1.** Lane B evidence at the pushed head:
  - `unit`, with the money, units, pricing and lint-fixture tests;
  - the coverage gate, whose `packages/pricing` and `packages/shared/src/money` figures the PR body quotes (PR40-SEC-05).
  - The hosted `security-integration` job is not selected (`security_paths=false`).
- **C2.** Rename the record, then confirm the merge ref contains it (D-ORCH-136/138).
- **C3.** A security delta round on the fix-cycle head, if the fix cycle changes an owned path (the R1-m1, R1-m2 or PR076-SEC-01 fixes) or fixes PR076-SEC-02.

**Routes.**
- **PR076-SEC-01:** this PR's fix cycle, with R1-m1, while the `lint` lock is held. Otherwise it is due before TASK-080 adds the next pricing step.
- **PR076-SEC-02:** this PR's fix cycle. Otherwise it is due before TASK-085 (payments) uses the helpers.
- **PR076-SEC-03, -04, -05:** this PR, with the 02 fix and R1-m3.
- **PR076-SEC-06:** the task that first adds a subpath export to `@platform/carriers`.
- **R1-n10 (security side):** the M2 task that prices from billable weight.

| Verdict | **PASS_WITH_FOLLOW-UPS.** 0 Critical, 0 High, 0 Medium. New: PR076-SEC-01 LOW (pricing purity misses `uuidv7` from the shared root, test-folder modules and respelled globals), PR076-SEC-02 LOW (Money helpers check results, not operands), PR076-SEC-03..06 INFO. No lint control is weakened (58-path effective-config diff with a mutation control). Fixes for 01, 02 and 03 validated on scratch copies, preferred in this PR's fix cycle with code review R1-m1..m3. Conditions: C1 lane B at the pushed head (unit, negative fixtures, coverage quotes), C2 rename and merge-ref confirmation, C3 security delta round if owned paths change or 01/02 are fixed |
