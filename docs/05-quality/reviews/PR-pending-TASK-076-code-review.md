# Code review: TASK-076 (pure pricing engine, integer money, billable weight; lint rules), pre-push round 1

| Field | Value |
|---|---|
| PR | not pushed yet (pre-push review; the orchestrator renames this record once the PR exists) |
| Branch / head | `feat/TASK-076-pure-pricing-engine-integer-money` @ `e01979b` (two commits: `13bb74f` engine, `e01979b` lint rules), based on `origin/main` `5145d52` |
| Diff reviewed | `git diff 5145d52 e01979b`: 46 files, +2570 / -14 (`packages/shared/src/{money,units}/**`, `packages/shared/src/index.ts`, `packages/pricing/src/**`, `tools/eslint-rules/{pricing-purity,money-arith,index}.mjs`, `tools/lint/{lint-fixtures.mjs,negative-fixtures.test.ts}`, `tests/fixtures/lint/**`, `eslint.config.mjs`, `docs/03-architecture/api/README.md` §11) |
| Card | `docs/04-plan/tasks/WAVE-02.md` TASK-076 (US-138 DC, US-139 DC; REQ-PRICE-001/002/004; NFR-DATA-001, NFR-QUAL-002; PR40-SEC-05, D-ARCH-115; PR #2 m10) |
| Sources re-read | CLAUDE.md; US-138, US-139 (EPIC-07) and their AT ids; ADR-0009 §3/§4; ADR-0015 §1-§6; openapi `ChargeLine`, `PriceTotals`, `ExplanationEntry`, `PricingExplanation`; `tools/ci/coverage-gate.mjs`; jest `collectCoverageFrom` |
| Developer decisions | D-TASK076-01..10 (in the hand-off; not yet in DECISIONS.md) |
| Lock | `lint` (`eslint.config.mjs`) granted to TASK-076 by the orchestrator |
| Reviewer | code-reviewer, 2026-11-20 |

## 1. Verdict

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The money core is correct. Rounding is half away from zero and exact (bigint rationals). allocate conserves
         every unit, the currency exponents (JPY 0, KWD 3, CLF 4) and the overflow guards hold, and the billable-weight
         ladder gives the US-139 numbers. No BLOCKER or MAJOR. 5 MINORs: purity-rule reach, compound-assignment reach of
         money-arith, the step-output re-validation claim, and two ADR-0009 rulings to record (static ISO table, which rule applies). 11 NITs.
```

## 2. Verification performed

HOST RULE: static review and single-process Node probes on a `git archive e01979b` extract in the reviewer scratchpad (`review/T076-cr`), with a node_modules junction to the worktree. No npm, no Jest, no Docker. Nothing ran inside the PR worktree except a read-only `prettier --check`. The worktree was clean afterwards (`git status` empty, 748 node_modules entries), and the copy and junction were removed.

- **Type-check:** `tsc -p` over `packages/shared/src/**` and `packages/pricing/src/**` (scratch tsconfig extending the base, `customConditions: @platform/source`, noEmit) exits 0.
- **Lint:** type-aware ESLint with the repository `eslint.config.mjs` on the 25 changed source and tooling files: 0 messages, 14.9 s wall. Per-rule time: `platform/money-arith` 1.4 ms and `platform/pricing-purity` 1.1 ms in total. For comparison, `import-x/no-cycle` took 1611 ms and `boundaries` 443 ms. **The type-aware branch adds no measurable lint cost.**
- **Fixture harness:** `node tools/lint/lint-fixtures.mjs` on the copy took 22.7 s.
  - Every new row reports exactly as expected: 7 pricing-purity bad files, `bad-axios` with three rules, `layering/pricing-io` with boundaries plus pricing-purity, 3 carriers-deep files, and the typed `bad-minor-brand` with `'net'`.
  - Every `ok-*` file and the typed stand-in are clean.
  - **Mutant:** I disabled the type-aware branch (`const checker = null`). Then `typed/.../bad-minor-brand.ts` reports nothing, so the new negative-fixtures row kills it.
- **Format:** `prettier --check` on all 46 changed files in the worktree: clean.
- **Not re-run:** the Jest unit suite and coverage. I relied on the developer's report: unit 270/270, and 100 % lines/branches on pricing, money and units. Lane B is the binding evidence for the PR40-SEC-05 coverage quotes (§6).
- **Behaviour probes** (`probe1.ts`, tsx, importing the copy's sources):
  - **Rounding:** 1050 at 1500 bps gives 158, and -1050 gives -158. 0.5 gives 1, -0.5 gives -1, and 2.5 gives 3 (not half-even).
  - **Overflow:** `add(MAX_SAFE, 1)`, `add(MAX_SAFE, 2)`, `sub(-MAX_SAFE, 1)` and `mulRatio(MAX_SAFE, 2)` all throw MONEY_INVALID. A forged float amount also throws MONEY_INVALID.
  - **allocate:**
    - `[34,33,33]` and `[-2,-3]` as expected.
    - `MAX_SAFE` over `[1,1]` gives `[4503599627370496, 4503599627370495]`.
    - Zero weights never receive a bonus unit.
    - No `-0` appears.
    - Over 20 000 random cases there were 0 sum violations and 0 zero-weight violations.
  - **convert:**
    - USD 10.00 at 150.5 gives 1505 JPY.
    - 1505 JPY at 0.00205 gives 3085 KWD (3.085 KWD).
    - 1 KWD minor unit at 500 gives 1 JPY (0.5 rounded away from zero).
    - The AT-US-148 example (INR 16600000 at 0.012000) gives 199200 USD.
    - A forged Ratio with a zero or negative denominator gives RATE_INVALID.
  - **fromMajor / toMajorString:**
    - `"12.340"` USD gives 1234 and `"1e2"` gives 10000.
    - `0.1+0.2` gives MONEY_INVALID, which is correct (never a silent float).
    - `" 1"`, `"1."`, `".5"`, Arabic-Indic digits and full-width digits are all refused.
    - CLF 1 gives `"0.0001"`, and -MAX KWD gives `"-9007199254740.991"`.
  - **ISO table:** 166 codes, no duplicates across the exponent lists. `ANG` and `XCG` are both present (R1-n5).
  - **AT-US-139-04:**
    - 20 x 16 x 12 in normalises to 508 x 406 x 305 mm.
    - The volumetric weight is 12527 g, shown as "27.6" lb (exact in³/139 = 27.626).
    - The billable weight is 12701 g, shown as "28.0" lb.
    - The same package under the METRIC rule bills 13000 g (relevant to R1-m5).
  - **Imperial ladder:**
    - Exactly 1, 2, 5, 10, 70 or 150 lb bills that step.
    - One gram more bills the next step.
    - With a 50 centi-lb increment, 0.6 lb bills 454 g.
  - **Engine:**
    - A step line with `taxCode: { a: 1.5 }` and `informational: 'yes'` passes `chargeLine` unchanged, and the object is not frozen.
    - A line without `labelKey` throws a raw TypeError instead of PricingError.
    - `now: '2026-99-99T99:99:99Z'` is accepted.
    - A caller-forged `volumetricG: 1` for a 30x20x10 cm package is accepted.
    - Findings: R1-m3, R1-n2, R1-n10.
  - **Lint reach** (probe files in the copy's `packages/pricing/src`, linted with the real config; findings R1-m1, R1-m2, R1-n9):
    - **money-arith, reported:** a destructured `amount`, the renamed `{ amount: cents }`, `T extends Minor`, `acc + x.amount` in a reduce, `${m.amount / 100}`, `Math.round(m.amount * 1.15)`, and `s = s + x` over `Minor[]`.
    - **money-arith, NOT reported:** `t += m.amount`, `Number(m.amount) + 1` and `+m.amount * 1`. (`-m.amount` is caught by `@typescript-eslint/no-unsafe-unary-minus`.)
    - **pricing-purity, reported:** `Date.now`, `globalThis.Date.now()`, `process['env']` and `globalThis['process'].env`.
    - **pricing-purity, NOT reported:**
      - `const { env } = process`, `const { now } = Date`, `const { random } = Math`;
      - `const D = Date; new D()`, `new Date(...[])`;
      - `process.hrtime.bigint()`, `process.uptime()`, `performance.timeOrigin`, `process.argv`;
      - `Reflect.get(Math, 'random')`.
    - `new Intl.DateTimeFormat()` is caught by `no-tofixed-tolocalestring`. Global `fetch` is caught by `outbound-http-via-client`, which is scoped to packages/*.
- **Spec cross-checks:**
  - `LINE_SOURCES`, `RULE_TYPES`, `PRICING_WARNINGS` and the `ChargeLine` shape match openapi. `PriceTotals.tax_display`/`tax_label` arrive with the tax step (US-147).
  - Coverage: `packages/pricing/src/tests/**` (fixtures, `price-child.ts`) is outside `collectCoverageFrom` (`!**/{tests,fixtures}/**`) and outside pricing-purity (TEST_FILES), so the child-process helper neither drags the 95/95 scope nor trips the rule.
  - The CARRIERS_DEEP_IMPORT_PATTERN is compatible with TASK-075 at `c2eaa47`: carriers exports only `.`, and nothing deep-imports it.
  - TASK-075 and TASK-076 change disjoint file sets.
  - `origin/main` (`2ec81df`) changed only docs since `5145d52`, none of them in TASK-076 scope.

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `tools/eslint-rules/pricing-purity.mjs:98-122` | **The rule's header contract ("reads no clock, no randomness, no environment") is wider than what it detects.** Probe results: destructuring (`const { env } = process`, `const { now } = Date`, `const { random } = Math`), aliases (`const D = Date; new D()`), `new Date(...[])`, `Date(x)` (the call ignores its arguments and still returns the current time, but the rule exempts any call with arguments), and the clocks `process.hrtime`, `process.uptime`, `performance.timeOrigin` all pass. So do `process.argv`, `process.cwd()` and `process.platform`, which are environment. The boundaries allow-list does not see globals, and the determinism property only stubs `Date.now`/`Math.random`. The AT-US-138-02 forms themselves are covered. That, and the clean code today, keeps this MINOR. | Cheapest closure: in `packages/pricing/src` report **every** reference to the globals `process` and `performance` (the engine never needs either). Report `Date` called as a function whatever its arguments, and `new Date(...spread)`. Report `VariableDeclarator` with an `ObjectPattern` init of `Date`/`Math`/`crypto`/`globalThis` (or of any global through `context.sourceCode.getScope().through`). Add one fixture each for destructured `process.env` and `process.hrtime`. Otherwise, list the limits in the rule header the way `outbound-http-via-client` does. |
| R1-m2 | MINOR | `tools/eslint-rules/money-arith.mjs:128-132` | `AssignmentExpression` checks only `node.left`. `let total = 0; for (const l of lines) total += l.amount;` is the canonical accumulate-into-a-float bug, and it is not reported by either branch: `total` does not match the names, and the right side is never inspected even though it is `Minor`-typed and name-matched. The type-aware branch makes this a one-line fix. | Use `moneyName(node.left) ?? moneyName(node.right)` for `ARITHMETIC_ASSIGN`, and keep `+=` on a string left side allowed (`isStringish(node.left)` / type check). Add a typed bad fixture `total += m.amount` and an untyped one `t += line.amount`. |
| R1-m3 | MINOR | `packages/pricing/src/state.ts:244-283`, `engine.ts:197-215` | The engine comment (`engine.ts:200`) says re-validation means "no step can leave a float, a foreign currency or a mutable object". The probe shows otherwise. **Validation gaps** (at runtime; TS types only constrain compiled steps): <br>- `chargeLine` lets any `taxCode` and `informational` through. `{ a: 1.5 }` stays an unfrozen nested object with a float in the stored snapshot. <br>- A missing `labelKey` throws a raw TypeError. <br>- `explanationEntry` does not check `ruleType`/`outcome` against their enums. It copies `inputs` shallowly, so an object value stays mutable. <br>- `rejectedCandidateCount` and `warnings` from the state are copied unvalidated: openapi requires `minimum: 0` and the `PRICING_WARNINGS` enum. <br>The snapshot is immutable by contract (REQ-PRICE-017), and the deep-freeze test only samples paths. | In `chargeLine`: `typeof labelKey === 'string' && labelKey.length > 0`, `taxCode === null \|\| (typeof taxCode === 'string' && taxCode.length > 0)`, `typeof informational === 'boolean'`. In `explanationEntry`: check the `RULE_TYPES` and `outcome` enums, and require every `inputs` value to be `string \| boolean \| null` or a finite number. In `runPricing`: `Number.isSafeInteger(rejectedCandidateCount) && >= 0` and every warning in `PRICING_WARNINGS`. Use PricingError `PRICING_INPUT_INVALID` throughout. Add one test row each. |
| R1-m4 | MINOR | `packages/shared/src/money/currency.ts:1-41` (D-TASK076-06) | ADR-0009 §3 (Accepted) says "`currencies(code, exponent)` from reference data drives exponents". The PR makes a static code table authoritative, because the pure engine cannot read reference data. That is sound, but it contradicts the ADR wording. Nothing will keep the `currencies` seed (TASK-066, not landed) equal to the table. | Principal-architect ruling/amendment of ADR-0009 §3: the code table is authoritative for the pure helpers, and the seed must equal it. Route to TASK-066 a parity test: seed `currencies(code, minor_unit)` == `CURRENCY_EXPONENTS`, in both directions. The ruling is a merge condition (§6). The test is TASK-066's. |
| R1-m5 | MINOR | `packages/shared/src/units/billable-weight.ts:142-144` (D-TASK076-02) | Which rule applies (METRIC 5000/500 g vs IMPERIAL 139/1 lb) is left to the caller, "by origin country". ADR-0009 §4, US-139 and the downstream quote cards do not say this. The obvious reading of AT-US-139-04 is "imperial entry, imperial rule". A caller built that way breaks AT-US-139-05 parity at the quote level: the same package bills 12701 g imperial and 13000 g metric (probe). | Record the decision where the caller will read it: an ADR-0009 §4 line (architect) and a note on the quote-input card (TASK-093, or whichever builds `PricingRequest`). Not a merge condition. |
| R1-n1 | NIT | `packages/pricing/src/engine.test.ts:186`, `packages/shared/src/money/ratio.test.ts:151`, `money.test.ts:166-178` | The "ties go away from zero" clauses of the three rounding properties are vacuous. `rounded * numerator >= 0n` (and `margin * base * bps >= 0n`) also holds for half-toward-zero: 2.5 gives 2, `2*25*1000 >= 0`. The money property has no tie clause at all. The example tables (`1/2 -> 1`, `315/2 -> 158`) do pin the direction, so this is a title/claim issue only. | Assert `twiceError * sign(exact) === +bound` on ties, i.e. `twiceError * numerator > 0n` when `abs(twiceError) === bound`. |
| R1-n2 | NIT | `packages/pricing/src/engine.ts:152` | `ISO_UTC_INSTANT` accepts `2026-99-99T99:99:99Z`. `now` is not used yet, but FX staleness (US-148) will compute with it. | Range-check the fields, or round-trip via `new Date(now).toISOString()` (the rule allows `new Date(arg)`). |
| R1-n3 | NIT | `packages/pricing/src/rounding.ts:306` | A config object carrying both `bps` and `decimal` silently uses `bps`. | Refuse a rate with both keys or neither (PRICING_CONFIG_INVALID). |
| R1-n4 | NIT | `packages/shared/src/units/units.ts:78-91` | An untyped caller gets a raw TypeError, not VALIDATION_ERROR: an unknown `unit` (`toGrams(1, 'oz')`) or a `null` entry to `normalisePackage`. The API layer validates first, but the quote widget (US-157) calls this from the browser. | Guard `GRAMS_PER[unit]`/`MILLIMETRES_PER[unit]` with `Object.hasOwn`, and the entry with `typeof entry === 'object' && entry !== null`. |
| R1-n5 | NIT | `packages/shared/src/money/currency.ts:27` | `ANG` is listed next to its successor `XCG`. ANG was replaced by XCG in 2025, and the header says "active codes". | Re-check ANG (and CUC/SLL) against the current ISO 4217 List One when TASK-066 seeds `currencies`, and keep both sources in step (R1-m4). |
| R1-n6 | NIT | `tools/lint/negative-fixtures.test.ts:124-127` | The US-001 layering row `pricing-io` used to pin the boundaries message `packages/pricing has no I/O imports`. As a two-rule row with `''` it now pins only the rule ids. | Keep the message pin if the multi-rule helper allows it, or add a separate single-rule assertion of the message. |
| R1-n7 | NIT | `packages/pricing/src/billable-weight.test.ts:59-72` | The `rounding (DR-B11)` describe block for `rounding.ts` sits in `billable-weight.test.ts`. | Move it to `rounding.test.ts`. |
| R1-n8 | NIT | `packages/shared/src/units/units.ts:103-108` (spec observation) | Imperial dimensions are rounded to whole millimetres before the volumetric calculation (DR-B06 mandates integer mm). Per side the error is up to 0.5 mm, i.e. 2 % on a 1-inch side. At a step boundary the bill can therefore differ by one increment from the carrier's in³ figure ("the way carriers do", US-139). This is inherent to the spec, not a code defect. | For product-manager/architect: either accept and note it (A-xxx), or carry entry-unit dimensions to the volumetric step. No change requested in this PR. |
| R1-n9 | NIT | `tools/eslint-rules/money-arith.mjs:3-13` | Header limits not stated: `Number(m.amount) + 1` and `+m.amount * 1` are not reported (the conversion strips the brand). | Add a "Limits" sentence. Optionally report `Number(<Minor>)` and unary `+` on `Minor`. |
| R1-n10 | NIT | `packages/pricing/src/billable-weight.ts:1-13` | "Re-validates" covers integer, positive and `billable >= max(actual, volumetric)` only. A forged `volumetricG: 1` is accepted, because the engine has no rule with which to recompute it. That is correct per ADR-0015 §3 ("re-validates that it is integer grams"). | State in the header that volumetric/billable correctness is the caller's (computed by `billableWeight`). |
| R1-n11 | NIT | `packages/pricing/src/engine.test.ts:195-238` (D-TASK076-07) | AT-US-138-04 literally asks to replace "Number arithmetic results for non-integers with failures", which JS cannot intercept. The test stubs every `Math` function, `parseFloat` and `toFixed`, then asserts every output number is a safe integer. That is a reasonable reading. | qa-lead notes the interpretation in `gherkin-test-map.md` for AT-US-138-04. |

## 4. Deviation rulings (D-TASK076-01..10)

| Decision | Ruling |
|---|---|
| 01 billable weight in `packages/shared/units` | **Accepted.** ADR-0015 §3 and ADR-0009 §4 place it there, and the quote widget (US-157) needs it browser-side. |
| 02 rule independent of entry unit; the caller picks by origin country | **Accepted on the code**: it is what makes AT-US-139-05 hold for both rules. The decision must be recorded for the caller (R1-m5). |
| 03 imperial integer-gram ladder | **Accepted.** Exactly n lb bills n lb (probe). The error stays within 0.5 g of the exact step, inherent to integer grams. |
| 04 internal-only error codes (README §11) | **Accepted.** `MoneyError`/`PricingError` are not `AppError`, so they surface as 500 INTERNAL_ERROR. Messages carry currency codes, line codes and rule keys only (no PII). |
| 05 step pipeline with base freight only | **Accepted.** It matches the DR-B07 order seam. R1-m3 hardens the re-validation the later steps rely on. |
| 06 static ISO 4217 table | **Accepted technically, needs an ADR-0009 §3 ruling** (R1-m4; merge condition). |
| 07 AT-US-138-04 via throwing float helpers | **Accepted** (R1-n11 for the map note). |
| 08 pricing-purity duplicates the boundaries control | **Accepted.** ADR-0015 §6 asks for a lint rule, and two independent controls are proven by the `pricing-io` and `bad-axios` rows. The reach gaps are R1-m1. |
| 09 typed lint fixture roots | **Accepted.** Only `typed/<rule>` roots get a program. The harness took 22.7 s in total, the typed branch costs about 1 ms in the real lint, and the mutant is killed. |
| 10 internal codes in README §11 | **Accepted** (it fixes AT-US-036-04). |

## 5. Follow-up closure

- **PR #2 m10** (routed to TASK-076, watchlist): **closed.** The type-aware `Minor` branch exists, the name heuristic is kept as fallback, there is a typed negative fixture plus an ok fixture, and the mutation is killed (§2). R1-m2 is an adjacent reach gap, not a reopening.
- **TASK-075 code review m2 / AT-US-121-05** (deep `@platform/carriers/*`): the pattern and three fixtures (value, `import type`, `export type … from`) land here under the `lint` lock. TASK-075 must not re-add them. Whichever PR merges second re-runs `negative-fixtures` on the union.

## 6. Merge conditions

1. Lane B evidence on the pushed head (unit, the coverage gate, `negative-fixtures`). The PR body quotes the merged lines and branches of `packages/pricing` and `packages/shared/src/money` from that evidence (card item PR40-SEC-05 / D-ARCH-115). qa-lead's manifest-only activation of the four coverage-gate cases follows in the next checkpoint.
2. A security-analyst record on the head (no Critical/High).
3. The principal-architect ruling on R1-m4: the ADR-0009 §3 wording for the static exponent table, plus the parity test routed to TASK-066.
4. R1-m1, R1-m2 and R1-m3 are recommended in this PR, since they are cheap and the `lint` lock is held now. If they are deferred, they need named owners in STATUS.md before merge. R1-m5 is routed (not blocking). The NITs are at the developer's discretion.

## 7. Good

- Exact `bigint` rationals with a single rounding point. A JS number enters money only through its shortest round-trip text. `parseDecimal` is bounded: 64 characters, exponent at most 400.
- `CURRENCY_EXPONENTS` is a `Map`, so `__proto__`/`constructor` can never be read as currencies (and it is tested). Unknown codes throw instead of defaulting to 2.
- Every money result goes through a safe-integer check, so overflow never rounds silently. `-0` is normalised.
- The cross-process determinism test perturbs TZ and LANG, and the in-process property perturbs the clock, randomness and input key order (JSON round-trip).
- The imperial ladder is documented with the exact derivation `n >= (2w - 1) / (2 x increment)`, and it is property-tested against `toGrams(n, 'lb')`.
- `price-child.ts` and the fixtures sit under `src/tests/`, outside both the coverage scope and pricing-purity, by the existing conventions.
