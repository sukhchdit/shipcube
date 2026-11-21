# Code review: TASK-080 default margin pricing as itemised lines and sample pricing configuration (pre-push, round 1)

| Field | Value |
|---|---|
| Task | TASK-080 (US-140 DC, REQ-PRICE-003, NFR-DATA-001; AT-US-140-01..05; routed items PR076-SEC-07 edits 2 and 4, TASK-075 code review R1-m6 / D-TASK075-10, D-TASK075-02 / ADR-0010 am. 12 item 2 / D-ARCH-168) |
| Head | `4a0faee3` (4 commits on main `e245e6e6`: `b9dff327` pricing, `aee6c67e` prisma, `4135a98d` carriers money, `4a0faee3` shared vocabularies), branch `feat/TASK-080-default-margin-pricing-as-itemised`; not pushed, no PR number yet |
| Reviewer | code-reviewer, 2026-11-21 |
| Bindings read | CLAUDE.md §8/§9; brief `docs/04-plan/briefs/TASK-080.md` and its card in `WAVE-02.md`; US-140 Gherkin (EPIC-07) and its gherkin-test-map rows; REQ-PRICE-003/005 and DR-B08; ADR-0009 §3 (money), ADR-0010 am. 12 item 2, ADR-0015 §4; data-model §1.7 (enumeration catalogue), §3.9 (`pricing_config_versions`), §9.1/§9.2 (seed rules); PR076-SEC-07 (security review of PR #75, lines 440-460 and 510); seed framework `contracts.ts`, `runner.ts`, `validate.ts`; carriers `errors.ts`, `guard.ts` |
| Main delta since base | `e245e6e6..origin/main` is docs only (5 commits); no code conflict today |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The margin step is correct and well pinned: DR-B08 M0 order, one FIRED entry, losers counted, applyRate on the
         base freight, 100 % coverage and 10 of 11 margin mutants killed. Money, vocabulary move and seed all sound.
         One MAJOR: the new CHECK admits a source value ADMIN that the data-model enum (ISO, SEED, SAMPLE, OPERATOR) does
         not have, in a migration that becomes immutable at merge (D-TASK080-05 rejected). Four MINOR, seven NIT.
```

Scope: every addition is on the card or the brief. The `pricing_config_versions` table, migration and seed are on the card ("prisma/schema/pricing.prisma + migration (pricing_config_versions minimal)", "prisma/seed/reference/pricing-sample.ts"), the carrier money refactor is the card's R1-m6 line, and the vocabulary move is the card's D-TASK075-02 line. PR076-SEC-07 edits 2 and 4 are routed to this task by D-SECPR076-02 and the brief. No scope creep.

## 1. What I verified myself

Host rules of the dispatch: foreground commands only, one at a time, nothing in the PR worktree beyond reads. I ran everything in a `git archive 4a0faee3` extract in the session scratchpad, with `node_modules` junctioned to the PR worktree's (same SHA, so the `@platform/*` links resolve to identical sources). The git-ignored `prisma/generated` was copied in, and the root-cache `tsBuildInfoFile` paths of `tools` and `tests/*` were redirected inside the extract, so nothing was written into the worktree. Afterwards the worktree was still clean (`git status` empty).

| Check | How | Result |
|---|---|---|
| Types | `react-router typegen` (web, admin) then full `tsc -b` of the solution | Clean (every project, including the `COMPILE_TIME_PARITY` check in `carrier.test.ts`, which `packages/shared` type-checks) |
| Lint | `eslint --max-warnings 0` on the 32 changed `.ts`/`.mjs` files outside fixtures, then on all of `packages/pricing`, `packages/carriers`, `packages/shared/src`, `prisma/seed`, `prisma/tests/seed` (repository config, type-aware) | Clean; the real pricing sources lint clean under the hardened purity rule |
| Format | `prettier --check` on every changed file Prettier can parse (the `.sql`, `.prisma` and `.manifest` files have no parser) | Clean |
| Pricing unit tests and coverage | `--testPathPatterns packages/pricing/ --coverage` | 6 suites, 98 tests pass. `margin.ts`, `config/sample.ts`, `engine.ts`, `types.ts` 100 % lines and branches (package 99.5 % branches; only the barrel `index.ts` is unexecuted) |
| Other touched unit suites | carriers (16 suites), shared money/classification/vocabularies, `prisma/seed/**`, `tools/db/grants-manifest`, `tools/db/table-classes`, `prisma/tests/rls/tenant-db.real-client` (`--maxWorkers=2`) | 35 suites, 648 tests pass |
| Changed-file coverage outside pricing | `normalise/money.ts`, `vocabularies/carrier.ts`, `pricing-sample.ts` | 100 % lines and branches each |
| Lint fixtures | `tools/lint/negative-fixtures` + `pricing-purity-shared` | 426/434 in the extract; the 8 failures are the known extract artefacts (repository-probe and `@platform/source` path assertions). Re-run read-only in the PR worktree with `-t 'repository probes\|lint wiring'`: 52/52 pass |
| Migrations lint | `tsx tools/db/lint-migrations.ts` | No findings; `prisma validate` passes |
| Mutants (19, `t080-mutants.cjs`, one at a time, file restored and `cmp`-checked after each) | margin selection/validation (11), `carrierDecimalToMoney` (3), pricing-purity (4), seed source (1) | 15 killed. Survivors: rejected-count carry-over (n4, equivalent today), leading/trailing-dot regex widening (equivalent: `fromMajor` refuses `12.` too), `WATCHED_GLOBALS = {Date}` (m3), drop the `kind === 'global'` branch (equivalent: `declare global` also has `declare: true` and id `global`, a watched name) |
| Purity probes (real config, probe files in the extract's `packages/pricing/src`, then deleted) | `declare const process/Math/globalThis`, `export declare const Date`, `declare namespace Date`, `declare var performance`, `export { retryDelayMs } from '@platform/shared/queues'`, type-only subpath import, template-literal `import()` of `@platform/shared/queues`, `@platform/shared` and `node:fs` | All `declare` forms and the re-export are reported. Template-literal `import()` of `@platform/shared/queues` and of the whole `@platform/shared` root lint CLEAN (m1); `node:fs` in a template is caught by boundaries |
| Static checks | data-model §1.7 `reference_source` and seed `validate.ts` `SOURCES`; DR-B08 order vs `compareMarginRules`; `fromMajor` on `-0`, `12.340`, 30-digit inputs; `safeCause` reduction of the helper's cause; guard pass-through of `CarrierError` (`guard.ts:158-162`); ADR-0010 retry policy (codes are not retried, only network/429/5xx); `ENGINE_VERSION` pins (only OpenAPI examples, n5); every `amountMinor` user (none left in carrier code); sibling migration timestamps (TASK-051 `20261120210000`, TASK-043 `20261120000000`, TASK-040 `20261120100000`) | See findings |
| Not re-run | every `*.int.test.ts` (`pricing-sample.int.test.ts`: first run, no-op re-run, SEED_INSERT_ONLY_CHANGED, immutability, read-only grant), catalog C5/C10/C15, `up-down-up`, full `test:unit`, coverage merge, `npm run build` of web/admin (not touched), lane A | Lane B on PostgreSQL 18 has not run on this branch yet (STATUS.md, D-ORCH-145); it is a merge condition |

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-M1 | MAJOR | `prisma/migrations/20261121000000_pricing_config_versions/migration.sql:34`; D-TASK080-05 | `ck_pricing_config_versions__source CHECK ("source" IN ('SEED', 'SAMPLE', 'ADMIN'))`. `ADMIN` is not in the data model. Data-model §1.7 enumerates `reference_source` as `ISO`, `SEED`, `SAMPLE`, `OPERATOR` and makes that catalogue the single source of every CHECK list, and §9.2 puts this table's seed row under `SEED` (A-060). The operator-entered value the M2 pricing admin will write is therefore `OPERATOR`, not `ADMIN`. The seed framework (`prisma/seed/framework/validate.ts:7`) admits only `ISO`, `SEED`, `SAMPLE`. D-TASK080-05's reason ("named now so that widening needs no CHECK swap on a populated table") defeats itself: an M2 writer that follows the data model writes `OPERATOR`, the CHECK refuses it, and a CHECK swap is needed anyway. Reserving a value for a future writer without an architect ruling also runs against the §1.7 precedent (`membership_status` `INVITED`: "a future writer ... needs an ADR amendment"). The migration becomes immutable once it is on main, so this is the last cheap moment. | Drop `ADMIN`. Either `CHECK ("source" IN ('SEED', 'SAMPLE'))` (the M2 admin widens it in its own expand migration, `ADD CONSTRAINT ... NOT VALID` then `VALIDATE`, which is cheap on a handful of rows), or `('SEED', 'SAMPLE', 'OPERATOR')` if you want the §1.7 value reserved now. Update the migration header, the `pricing.prisma` comment if it names the values, and the D-TASK080-05 text. Lane B re-runs on the fixed head. |
| R1-m1 | MINOR | `tools/eslint-rules/pricing-purity.mjs:199-200` | `checkSource` returns early unless the specifier is a `Literal`, so an expression-free template literal is never checked. Probed under the full repository config: `import(\`@platform/shared/queues\`)` (randomness via `retryDelayMs`) and `import(\`@platform/shared\`)` (the whole root, carrying `uuidv7`) both lint clean. Boundaries does not cover them, because the pricing allow-list admits `@platform/shared/**`. The root form is pre-existing; the subpath form is a residual of PR076-SEC-07 edit 2 ("refuse any `@platform/shared/<subpath>` import"). The same file already reads expression-free templates for member names (`propertyName`). | In `checkSource`, accept a `TemplateLiteral` with no expressions and use `quasis[0].value.cooked` as the specifier. Add one `bad-*` fixture (template `import()` of a subpath) with its `[AT-US-138-02]` row. Flag for security-analyst as the PR076-SEC-07 closure check. |
| R1-m2 | MINOR | `packages/pricing/src/config/sample.ts:8,29-30`; `prisma/seed/reference/pricing-sample.ts:19-20`; D-TASK080-02 | `content_sha256` is the SHA-256 of `JSON.stringify(SAMPLE_PRICING_CONFIG)`, so it depends on the insertion order of the literal's keys. Nothing else in the design defines the hash (ADR-0015 §4 and data-model §3.9 are silent), so this PR defines it for the first published, immutable row. US-152 materialises the configuration from rule rows; reproducing this hash there needs the exact key order of this literal, which is not a canonical form. The repository already has sorted-key canonical serialisers (`prisma/seed/framework/hash.ts` `canonicalValue`, `packages/audit/src/entry-hash.ts`); pricing may import neither. | Preferred: hash a sorted-key canonical serialisation (a small pure helper in `packages/pricing`, pinned by a test that a reordered copy hashes the same), then re-pin `SAMPLE_PRICING_CONFIG_SHA256`, `PRICING_SAMPLE_CONTENT_SHA256` and the dataset hash. Alternatively, record the hash definition in D-TASK080-02 as a contract that US-152 must reproduce, and add a pointer to it in the data model. |
| R1-m3 | MINOR | `tools/lint/negative-fixtures.test.ts:358-359`; `tools/eslint-rules/pricing-purity.mjs:45` | Only `declare const Date` has a fixture. The mutant `WATCHED_GLOBALS = new Set(['Date'])` survives every pricing-purity row (25/25 pass), so the `process`, `Math`, `globalThis`, `performance` and `crypto` members, which the PR076-SEC-07 probe named, are unpinned. The `declare global` fixture also does not pin its own branch: the `declare: true` / id `global` path reports the same text. | Add `bad-declare-process.ts` and `bad-declare-math.ts` fixtures (or one `it.each` over `WATCHED_GLOBALS` in a rule-level test). Optionally make the `declare global` message distinct from `declare ${name}` so its branch is pinned. |
| R1-m4 | MINOR | `packages/carriers/src/normalise/money.ts:21-29` | The refusal is `new CarrierError('CARRIER_UNKNOWN_ERROR', { cause })` with no `carrier` and no `operation`. The guard passes a `CarrierError` through unchanged (`guard.ts:158-162`; it adds context only to a `CarrierContractError`). The one failure that means "this carrier sent money we cannot read" therefore reaches logs and metrics with less context than every other unknown error the guard produces. | Accept an optional `{ carrier, operation }` argument and pass it to `CarrierError` (the constructor already validates both). Alternatively, have the guard enrich a context-free `CarrierError`. Add one test row. |
| R1-n1 | NIT | `packages/carriers/src/normalise/money.ts:6-9` | The JSDoc says "a value with more fraction digits than the currency allows (`"12.345"` USD) ... is invalid", but `"12.340"` USD is accepted (an intentional test row; `fromMajor` is exact). | Say "a non-zero digit beyond the currency's exponent". |
| R1-n2 | NIT | `packages/shared/src/vocabularies/carrier.test.ts:78-81` | The "no OpenAPI enum" check looks only for a schema named `SurchargeCode`, and its positive (`toContain('CARRIER_OTHER')`) is unrelated. An enum added under another name (a `ChargeLine.code` enum, say) passes it. | Assert that no `enum:` list in `openapi.yaml` contains `- REMOTE_AREA` (any DR-B30 surcharge member), and keep the schema-name check. |
| R1-n3 | NIT | `packages/carriers/src/canonical/codes.test.ts:39-44` vs ADR-0010 am. 12 item 2 | The amendment says "what moves is the list with its type and guard, and the part of `codes.test.ts` that pins it to DR-B30". The DR-B30 pins of the surcharge and error codes stay in `packages/carriers` and test the re-export, which is the same object, so nothing is lost. | Record it in D-TASK080-12 (which today mentions only the surcharge pin), or move the two pins beside `carrier.test.ts`. |
| R1-n4 | NIT | `packages/pricing/src/lines/margin.ts:153` | `withEntry.rejectedCandidateCount + rejected` keeps the earlier steps' count. The mutant that drops the carry-over survives, because base freight adds no candidates today. | Add one `runPricing` test with a stub step before `marginStep` that records rejected candidates. |
| R1-n5 | NIT | `docs/03-architecture/api/openapi.yaml:6831,7285,7556,8507` | The examples still say `engine_version: 1.0.0`. They are only examples. | Refresh them with the next contract-touching task (not this PR's lock). |
| R1-n6 | NIT | `tools/eslint-rules/pricing-purity.mjs:257` | `TSDeclareFunction` also matches overload signatures without `declare`. `function process(a: string): void;` is reported as "declare process", which is harmless but misleading. | Report overloads with their own wording, or leave as is and note it in the rule's Limits paragraph. |
| R1-n7 | NIT (INFO for security-analyst) | `migration.sql:58-59` | The immutability trigger is `AFTER UPDATE OR DELETE` FOR EACH ROW, so `TRUNCATE` by the owner (`platform_migrator`) bypasses it. `platform_app` has SELECT only, and the owner could also drop the trigger, so this is a documentation point. | Mention it in the migration header, or add a `BEFORE TRUNCATE ... FOR EACH STATEMENT` raise. |

Forward note (no finding, for the real-adapter tasks): when an adapter's `createShipment` response holds a label but an unreadable charge, `carrierDecimalToMoney` throws. The saga then sees an ambiguous create (EXCEPTION, no retry; the zero-duplicate-label guardrail holds), but the label bytes are dropped. Adapters should parse the charge in a way that keeps the confirmation, for example by recording the charge failure separately. Route this to TASK-101 (the contract suite) and the DHL/FedEx/UPS adapter tasks.

## 3. Rulings on the developer decisions

| Decision | Ruling |
|---|---|
| D-TASK080-01 `ENGINE_VERSION` 1.0.0 → 1.1.0 | Accepted. The brief asks for a minor bump. Results now carry the step order they were priced with. |
| D-TASK080-02 hash = SHA-256 of `JSON.stringify(SAMPLE_PRICING_CONFIG)` | Accepted with R1-m2. Correct and pinned for this object, but it is not a canonical form; fix now, or make the definition an explicit contract for US-152. |
| D-TASK080-03 margin explanation inputs | Accepted. Rule dimensions, priority, default flag and rate only; no request values and no personal data. |
| D-TASK080-04 `bad-logging-specifier` pricing row expects both rules | Accepted. Two controls on one specifier, the same pattern as the pricing `node:fs` row. |
| **D-TASK080-05 `ADMIN` source value** | **Rejected (R1-M1).** It contradicts data-model §1.7 `reference_source` (the operator value is `OPERATOR`), it is not a seed source (`validate.ts`), and it cannot avoid the CHECK swap it was meant to avoid. |
| D-TASK080-06 raise-only AFTER trigger | Accepted. Nothing runs after a BEFORE row change, so C15 (b) does not apply, and there is no `stdColumns` flag because there is no runtime writer. The lane B immutability and owner tests prove it on PostgreSQL 18 once run. See R1-n7 for TRUNCATE. |
| D-TASK080-07 fixed `effective_from` = `published_at` = 2026-11-01T00:00Z | Accepted. Needed for a stable dataset hash; the notes name A-060 and the ASSUMED seed. |
| D-TASK080-08 migration timestamp `20261121000000` | Accepted. It sorts after TASK-043 and TASK-040. TASK-051's `20261120210000` sorts before it: if this PR merges first, TASK-051 re-times on its re-merge, so `prisma/migrations` stays monotonic on main. |
| D-TASK080-09 TenantDb exposes `pricingConfigVersion` | Accepted. GLOBAL and read-only by grant, the same as the authz catalogue; the real-client surface pin lists it. |
| **D-TASK080-10 invalid carrier money → `CARRIER_UNKNOWN_ERROR`** | **Accepted.** DR-B30 and the OpenAPI `CarrierErrorCode` enum have no response-invalid code, and the guard already maps a contract failure inside an adapter to `CARRIER_UNKNOWN_ERROR` (PR075-SEC-10), so this is the "existing response-invalid error" the brief asks for. ADR-0010 retries on network errors, 429 and 5xx only, never on a canonical code, so the refusal is not retried. `safeCause` reduces the `MoneyError` to `{ name, code }` and the value is never echoed (tested). The missing carrier/operation context is R1-m4. |
| D-TASK080-11 helper stricter than `fromMajor` | Accepted. ASCII digits only (`\d` with `u`), no exponent, no sign other than a leading minus, at most 30+30 digits. `-0` yields `0`. |
| D-TASK080-12 surcharge codes have no OpenAPI enum and keep the DR-B30 pin | Accepted. Verified: `openapi.yaml` has no surcharge enum. See R1-n2 (weak negative) and R1-n3 (ADR wording). |
| D-TASK080-13 `vocabularies/carrier.ts` in the shared root | Accepted. Browser-safe (no Node import), exported from the root, so `package.json` `exports` is unchanged and the lock untouched. |

## 4. Routed items closed by this PR

- **PR076-SEC-07 edits 2 and 4:** implemented and fixture-pinned (subpath refusal, `declare` declarators, `declare global`). Two residuals: the template-literal specifier gap (R1-m1) and the unpinned watched-name list (R1-m3). The security-analyst owns the closure call.
- **R1-m6 / D-TASK075-10:** closed. `CarrierMoney = Money`, the Mock returns its `rates.ts` Money values unchanged, no `amountMinor` remains in carrier code, and `carrierDecimalToMoney` covers every brief row (`"12.34"` USD → 1234, `"1234"` JPY → 1234, `"12.345"`, `"1e3"` and `""` refused).
- **D-TASK075-02 / D-ARCH-168:** closed. The four lists, their types and guards moved; `codes.ts` re-exports them; the parity test compares each list with the OpenAPI enums element for element and checks equality at compile time against `types.gen.ts`.

## 5. Merge conditions

1. **R1-M1 fixed** on the branch (CHECK list without `ADMIN`; D-TASK080-05 text amended), then a delta review of the fix.
2. **Lane B on PostgreSQL 18 green on the final head:** `prisma/tests/seed/pricing-sample.int.test.ts`, catalog C5 (grants), C10 (classification), C15, the migrations lint and `up-down-up`.
3. **Security-analyst record on the final head.** Owned paths changed: `prisma/**` (migration, schema, seed, `sql/grants.manifest`, tests), `tools/db/**`, `tools/eslint-rules/pricing-purity.mjs`, `tools/lint/negative-fixtures.test.ts`, `tests/fixtures/lint/**`. Flags: R1-M1, R1-m1, R1-m3, R1-n7, and the SECURITY INVOKER trigger function with fixed `search_path` in schema `platform`.
4. **Planned union merges:** whoever merges second re-merges `origin/main` and keeps both sides in `packages/shared/src/classification/registry.ts`, `prisma/sql/grants.manifest`, `tools/db/grants-manifest.test.ts` and `tools/lint/negative-fixtures.test.ts` (TASK-043, TASK-051). Migration timestamps stay monotonic (D-TASK080-08 ruling).
5. **Hosted lane A green**, including `security-integration` (the PR changes `prisma/**`).
6. **The orchestrator records D-TASK080-01..13 in DECISIONS.md** with these rulings.
7. **MINOR findings:** fix them in this PR (R1-m1 and R1-m3 are small and in files this PR already owns; R1-m2 is cheapest before the first row is published), or route each to a named owner with a due date in DECISIONS.md. NITs are optional.

## 6. Good patterns worth keeping

- Rules are read the `state.ts` way: each field once, from an own property, into a frozen copy, with error messages that name a position and never a configuration value. The "flipping getter" test pins this.
- The comparator is a total order: priority, then service, then carrier, then rule key, with keys unique. The order-independence property (1,000 shuffles) proves it, and US-141 can extend it without replacing it.
- The text-level cross-check between the pricing literal and the seed literal respects the no-import boundary in both directions without a manifest change.
- The seed integration test covers the whole lifecycle on the real migrated schema: apply, no-op, SEED_INSERT_ONLY_CHANGED with no config-change emitted, owner immutability, `platform_app` 42501, and draft editability.
- The carrier money helper fails closed with a safe cause, never echoes the value, and has a round-trip property.

## Round 2: delta review of fix cycle 1

| Field | Value |
|---|---|
| Head | `3d3a7775` (one commit on `4a0faee3`: `fix(pricing): task-080 fc1, source check, truncate guard, canonical hash, purity hardening`; decisions D-TASK080-14..19 in its body), branch `feat/TASK-080-default-margin-pricing-as-itemised`; not pushed, no PR number yet |
| Reviewer | code-reviewer, 2026-11-21 |
| Delta | `4a0faee3..3d3a7775`: 28 files, +348/−42. Every hunk maps to a round-1 finding, a security finding (PR080-SEC-01..05) or a NIT. No scope creep |
| Main delta since base | `e245e6e6..origin/main` is still docs only (7 commits), so there is no code conflict |
| Inputs | Round 1 above; security record `docs/05-quality/security/PR-pending-TASK-080-security-review.md` (PR080-SEC-01..05, conditions C1..C4); D-ORCH-147 (lane B at `4a0faee3` was red on C9 only) |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Every round-1 finding is closed except NIT n5, which is deferred with the contract lock (accepted). R1-M1 is fixed
         as SEED/SAMPLE/OPERATOR and pinned three ways. The canonical hash is order-free and independently reproduced.
         The purity rule fails closed by name, and the TRUNCATE guard works on a PostgreSQL replay. 14 of 15 new mutants
         are killed; the survivor is equivalent. Three NITs. Merge waits on lane B and security on this head.
```

### R2.1 What I verified myself

Host rules of the dispatch: foreground only, one command at a time, timeouts of 8 minutes or less, no Docker, nothing run in the PR worktree. I ran everything in a `git archive 3d3a7775` extract in the session scratchpad. Its `node_modules` was junctioned to the PR worktree's; that worktree is at the same SHA and clean, so the `@platform/*` links resolve to identical sources. The git-ignored `prisma/generated` was copied in. The `tsBuildInfoFile` paths of `tools` and `tests/*` that point at the root cache were redirected into the extract, so nothing was written into the worktree. Afterwards the junction was removed first, then the extract; the worktree was still at `3d3a7775`, clean, with 748 `node_modules` entries.

| Check | How | Result |
|---|---|---|
| Types | `tsc -b packages/shared packages/pricing packages/carriers prisma tools` | Clean |
| Lint | `eslint --max-warnings 0` (repository config, type-aware) on `packages/pricing`, `packages/carriers/src`, `packages/shared/src/vocabularies`, `prisma/seed`, `prisma/tests/seed`, `c01-c12.int.test.ts` and the four changed `tools/` files | Clean. The real pricing sources and tests raise no `shadowed` false positive |
| Format | `prettier --check` on the 25 changed `.ts`/`.mjs` files | Clean |
| Migrations | `tsx tools/db/lint-migrations.ts`; `prisma validate` | No findings; valid |
| Pricing unit tests and coverage | `--testPathPatterns packages/pricing/ --coverage` | 7 suites, 115 tests pass. `canonical-json.ts`, `sample.ts`, `margin.ts`, `engine.ts`: 100 % lines and branches |
| Other touched suites | carriers `normalise/money` and `canonical/codes`, shared `vocabularies`, `prisma/seed/reference/`, `check-suppressions`, `pricing-purity-shared` | 66/66 pass. The 3 `check-suppressions` CLI rows need a git root; they pass after a `git init` of the extract (21/21) |
| Lint fixtures | `tools/lint/negative-fixtures` | 432/440. The 8 failures are the round-1 extract artefacts (7 repository probes and the `@platform/source` resolver). Every pricing-purity row passes, including the 6 new ones |
| Independent hash | tsx probe: a separate sorted-key serialiser over `SAMPLE_PRICING_CONFIG` | Its text equals `canonicalJson`'s. The SHA-256 is `c4be2d6d…180b`, which equals `SAMPLE_PRICING_CONFIG_SHA256` and `PRICING_SAMPLE_CONTENT_SHA256`. The dataset hash `63600bde…79d3` is pinned by the passing seed suite |
| `canonicalJson` edge probes | `-0`, `1e21`, `0.1 + 0.2`, lone surrogates in a key and a value, a `toJSON` string member, symbol and non-enumerable keys, extra array properties, a cycle | JSON-identical number and string forms; `toJSON` is kept as data. Symbol-keyed, non-enumerable and extra array members are dropped silently, and a cycle throws `RangeError` (R2-n1) |
| PostgreSQL replay (PGlite 0.4.3, PG 17.5 WASM; not a substitute for lane B) | The whole migration applied (`uuidv7()` → `gen_random_uuid()`), the table owned by `platform_migrator`, statements run under `SET LOCAL ROLE platform_migrator` | `ADMIN` and `ISO` → 23514; `OPERATOR` is admitted. `TRUNCATE` over drafts only → allowed (0 rows). With a published row, each of these → P0001 `PRICING_VERSION_IMMUTABLE`: `TRUNCATE`, `TRUNCATE ONLY … RESTART IDENTITY`, and `DELETE` of the draft then `TRUNCATE` in one transaction. `tgtype` 25 (AFTER ROW UPDATE/DELETE) and 34 (BEFORE STATEMENT TRUNCATE). Both functions are SECURITY INVOKER with `search_path=pg_catalog, pg_temp`. `down.sql` leaves 0 functions in `platform`, and the migration re-applies |
| Catalog reading | C9 `enumCheckValues` sorts (the drift row proves it), so `['OPERATOR', 'SAMPLE', 'SEED']` is the rendered form. C11 public-EXECUTE scan: the new function gets its ACL from the `01-schemas.sql` default privileges (`REVOKE EXECUTE … FROM PUBLIC` for `platform_migrator`), as the row guard does. The dynamic-SQL scan (no `EXECUTE` in the body) and C15 assigners (no `NEW` assignment) do not select it. No helper or test truncates `pricing_config_versions` except the new case (`grep`; the `authz-seed` TRUNCATE rows are authz tables as `platform_app`) | No predicted lane-B failure |
| Purity probes (real config, probe files in the extract's `packages/pricing/src`, then deleted) | A parameter `Date`, an overload `function process(…): string;`, `enum Unit { Date = 1 }`, `catch (crypto)`, `` import(`@platform/shared`) ``, `` import(`node:fs`) `` | All four bindings → `shadowed <name>`. The template root → `@platform/shared (whole module)`. The template `node:fs` → pricing-purity and boundaries |
| Mutants (15, one at a time, file restored and byte-compared after each) | pricing-purity (5), `check-suppressions` (1), `canonicalJson` (5), `carrierDecimalToMoney` context (2), margin carry-over (1), an `openapi.yaml` enum gaining `- REMOTE_AREA` (1) | **14 killed:** binding pass off; ambient skip removed (double report); literal-only specifiers; lib globals in the binding pass (crash); pricing-purity unprotected; no key sort; `localeCompare` order; any object plain; `map` keeps holes; non-finite admitted; both context drops; rejected carry-over dropped (n4); enum gains a surcharge (n2). **1 survivor, equivalent:** `TSDeclareFunction` without `[declare=true]`. An overload is still reported, as `declare process` instead of `shadowed process` |
| Not re-run | every `*.int.test.ts` (seed, catalog C5/C9/C10/C11/C15), `up-down-up`, full `test:unit`, coverage merge, web/admin build, lane A | Lane B on PostgreSQL 18 is running on `3d3a7775` (the orchestrator's evidence); merge condition R2-1 |

### R2.2 Closure of the round-1 findings

| ID | Status | Evidence |
|---|---|---|
| R1-M1 | **Closed** | `CHECK ("source" IN ('SEED', 'SAMPLE', 'OPERATOR'))`, the data-model §1.7 `reference_source` values without `ISO`. The migration header, the `pricing.prisma` comment and C9 `ENUM_CHECKS` say the same. The seed int test pins `ADMIN` → 23514 on the named constraint and `OPERATOR` admitted on a draft; my replay agrees. D-TASK080-14 replaces D-TASK080-05. It also closes PR080-SEC-05 (C9 knows the constraint) |
| R1-m1 | **Closed** | `checkSource` uses the shared `staticSpecifier` (literal or expression-free template), the helper `no-external-calls-in-tenant-tx` and `system-model-owner` already use. Fixture `bad-template-import-subpath` has its `[AT-US-138-02]` row; the literal-only mutant is killed. The security closure call is security's (PR080-SEC-03) |
| R1-m2 | **Closed (preferred route)** | `canonicalJson`: sorted keys at every depth, no white space, refuses non-JSON values. The hash and the seed literal are re-pinned to the canonical text, and a test shows that a rebuilt copy with a different key order has the same hash. The sort and order mutants are killed. Exported from `@platform/pricing` for US-152. See R2-n1 and R2-n2 |
| R1-m3 | **Closed** | `bad-declare-process` and `bad-declare-math` fixtures. `WATCHED_GLOBALS` is exported and pinned element by element in `pricing-purity-shared.test.ts`. The optional distinct `declare global` wording was not taken; that is acceptable |
| R1-m4 | **Closed** | Optional `CarrierAmountContext` (`carrier`, `operation`) is spread into both throws. The constructor validates both. The test checks `toJSON()` with and without the context and that the value is not echoed. Each throw's context-drop mutant is killed |
| R1-n1 | Closed | JSDoc: "a non-zero digit beyond the currency's exponent", `"12.340"` named as accepted |
| R1-n2 | Closed | The test now scans every `enum:` block (143 in `openapi.yaml`, no flow-style enums) and allows only `FUEL`, which is shared with `ChargeLine.source`. The REMOTE_AREA mutant is killed |
| R1-n3 | Closed | D-TASK080-19 records that both DR-B30 pins stay in `codes.test.ts` on the re-exported (identical) lists |
| R1-n4 | Closed | A `runPricing` test puts a counting stub before `marginStep` (3 + 1 = 4); the carry-over mutant is now killed |
| R1-n5 | **Deferred, accepted** | Round 1 itself said "not this PR's lock". Merge condition R2-5 routes it |
| R1-n6 | Closed | `TSDeclareFunction[declare=true]` only. An overload signature is now reported by the binding pass as `shadowed <name>` (probed) |
| R1-n7 | Closed | BEFORE TRUNCATE FOR EACH STATEMENT trigger with its own invoker function, so PR080-SEC-04 is implemented. It is pinned by the new int case (drafts truncate; published → P0001 for the owner, 42501 for `platform_app`, rows unchanged) and by my replay. `down.sql` drops the new function |
| PR080-SEC-01 | Implemented | `platform/pricing-purity` is in `PROTECTED_RULES`, with a test row; the unprotect mutant is killed. Closure is security's call |
| PR080-SEC-02 | Implemented | The binding pass covers the destructured `declare`, the type-only import alias and the type-only namespace, with three fixtures (the namespace row also expects `no-namespace`). Closure is security's call |

### R2.3 New findings (round 2)

| ID | Severity | File:line | Issue | Suggested fix |
|---|---|---|---|---|
| R2-n1 | NIT | `packages/pricing/src/config/canonical-json.ts:7-10, 33-39` | The JSDoc says every non-JSON value "is refused with PRICING_CONFIG_INVALID, never silently dropped". Probed: symbol-keyed members, non-enumerable own properties and extra properties of an array are dropped silently (`Object.keys`, `Array.from`), and a cycle throws `RangeError: Maximum call stack size exceeded`. The inputs today (the frozen literal; rule rows in US-152) cannot carry any of these, so the hash is not at risk. | Either narrow the wording ("own enumerable string keys; a cycle is not detected"), or refuse `Object.getOwnPropertySymbols(value).length > 0` and map a cycle to PRICING_CONFIG_INVALID (a `WeakSet` of ancestors). |
| R2-n2 | NIT | D-TASK080-15 (commit body; DECISIONS.md text) | For JSON values, `canonicalJson` is exactly RFC 8785 (JCS): UTF-16 code-unit key order and ECMAScript number and string serialisation. That is a standard a non-TypeScript verifier (an auditor's script, a SQL-side check) can reproduce without reading this file. | Name RFC 8785 in the D-TASK080-15 text when the orchestrator records it, and optionally in the module JSDoc. No code change. |
| R2-n3 | NIT | `tools/eslint-rules/pricing-purity.mjs:32-35` | The binding pass reports any binding named like a watched global, so `enum Unit { Date = 1 }` (an enum member) and `catch (crypto)` are reported too (probed). This is fail-closed and harmless. The header lists declarations, parameters and locals, but not enum members. | Add "an enum member" to the list in the header, or leave as is. |

No BLOCKER, MAJOR or MINOR finding in the delta.

### R2.4 Rulings on D-TASK080-14..19

| Decision | Ruling |
|---|---|
| D-TASK080-14 `source` ∈ {SEED, SAMPLE, OPERATOR} (replaces D-TASK080-05) | **Accepted.** It follows data-model §1.7 `reference_source` and leaves out `ISO`, which no pricing version can have. Reserving `OPERATOR` now is the second option round 1 offered, and the §1.7 value is the one the M2 admin will write, so no CHECK swap is needed. The seed validator still admits ISO/SEED/SAMPLE only, so the seed cannot write `OPERATOR` |
| D-TASK080-15 `content_sha256` = SHA-256 of the UTF-8 `canonicalJson(config)` (amends D-TASK080-02) | **Accepted.** It is a definition US-152 can reproduce from rule rows, it is pinned by an order-independence test and a 1,000-run property, and I reproduced it independently. See R2-n2 (cite RFC 8785) and R2-n1 (doc wording). Duplicating the sorted-key serialiser is correct here, because pricing may import neither `prisma/seed/framework/hash.ts` nor `packages/audit` |
| D-TASK080-16 purity fails closed by name; `staticSpecifier`; overloads excluded from `declare`; rule protected | **Accepted.** Reporting any binding of a watched name is the right shape: it closes the bypass class instead of enumerating syntax. Pricing has no legitimate local called `Date`, `Math` or `process`. The skip set keeps one report per ambient declaration (the double-report mutant is killed). See R2-n3 |
| D-TASK080-17 BEFORE TRUNCATE statement trigger, drafts may be truncated | **Accepted.** A separate function is needed because `OLD` does not exist at statement level. It is INVOKER with a fixed `search_path` and a fully qualified table, and it uses the same SQLSTATE and message as the row guard. Editing the unmerged migration is correct (it is not on main). The owner can still `DROP TRIGGER`; as in round 1, that is a documentation point, not a finding |
| D-TASK080-18 optional `{ carrier, operation }` context | **Accepted.** Backward compatible (the default is `{}`), validated by the `CarrierError` constructor, and the value is never echoed. Real adapters (TASK-101 and the DHL/FedEx/UPS tasks) should always pass it |
| D-TASK080-19 DR-B30 pins stay in `packages/carriers` (amends D-TASK080-12 wording) | **Accepted.** They test the same list objects through the re-export; nothing is lost |

### R2.5 Merge conditions (replace round 1's §5)

1. **R2-1 Lane B on PostgreSQL 18 green on `3d3a7775`** (running now): `prisma/tests/seed/pricing-sample.int.test.ts` (all four cases, including the TRUNCATE case and the `ADMIN` 23514 / `OPERATOR` row), catalog C5, C9 (now with `ck_pricing_config_versions__source`), C10, C11 (public EXECUTE on the new function), C15, the migrations lint and `up-down-up`. At `4a0faee3` only C9 was red (D-ORCH-147).
2. **R2-2 Security-analyst delta record on `3d3a7775`**, closing PR080-SEC-01..05 and conditions C1..C4. Owned paths changed again: the migration and `down.sql`, `pricing.prisma`, the seed and its tests, `c01-c12.int.test.ts`, `pricing-purity.mjs`, `check-suppressions.mjs`, `negative-fixtures.test.ts` and 6 `bad-*` fixtures.
3. **R2-3 Planned union merges:** whoever merges second re-merges `origin/main` and keeps both sides in `packages/shared/src/classification/registry.ts`, `prisma/sql/grants.manifest`, `tools/db/grants-manifest.test.ts` (TASK-040 PR #80, TASK-043, TASK-051), `tools/lint/negative-fixtures.test.ts` (TASK-043) and, new in this round, `prisma/tests/catalog/c01-c12.int.test.ts` (TASK-040 also edits it). Migration timestamps stay monotonic: TASK-040 `20261120100000` and TASK-051 `20261120210000` sort before this PR's `20261121000000`. After the union, re-run `negative-fixtures` and C9.
4. **R2-4 Hosted lane A green**, including `security-integration` (the PR changes `prisma/**`).
5. **R2-5 The orchestrator records D-TASK080-01..19 in DECISIONS.md** with the round-1 and round-2 rulings (-05 superseded by -14, -02 amended by -15, -12 by -19). Route R1-n5 (OpenAPI `engine_version` examples) to the next contract-touching task with a named owner.
6. NITs R2-n1..n3 are optional; no further code review round is needed for them.

### R2.6 Good patterns worth keeping

- The fix pins every closed finding with the mutant that would have survived (n2, n4, the context drops, the key order), not only a happy-path row.
- `canonicalJson` refuses values instead of converting them (`undefined`, holes, non-finite numbers, non-plain objects), and its property test checks round-trip and order independence on arbitrary JSON.
- The purity rule now reasons about names, not syntax forms, and reuses the repository's `staticSpecifier` instead of re-implementing it.
- The TRUNCATE case uses two clones, one with drafts only and one seeded, so both sides of the guard are tested on the real schema, with the rows compared before and after.
