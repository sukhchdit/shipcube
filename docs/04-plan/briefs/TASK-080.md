# Dispatch brief: TASK-080, default margin pricing as itemised lines and sample pricing configuration

- **Plan fold / dispatch plan:** D-SD-005 (2026-11-20); dispatched with D-ORCH-143. The card section below is copied verbatim from `docs/04-plan/tasks/WAVE-02.md`. If they differ, the generated card governs.
- **Branch:** `feat/TASK-080-default-margin-pricing-as-itemised`, from `origin/main` (`e245e6e6` at dispatch).
- **Specialist and model:** backend-developer, **sonnet** (card: complexity S, sonnet; escalate to opus from fix cycle 2).
- **Why now:** a Wave 2 batch 2.2 back-fill, like TASK-075/076/079. TASK-080 is on the closure of TASK-089 (the real demo users, the human's first priority, D-ORCH-126) and of TASK-083 (rate-shopping fan-out). It is also the deadline of three routed items: PR076-SEC-07 (open parts, "before TASK-080"), TASK-075 code review R1-m6 (CarrierMoney is ADR-0009 Money) and the vocabulary move of D-TASK075-02 / D-ARCH-168.
- **Dependencies:** TASK-076 (merged, PR #75, `2fd534ca`) and TASK-075 (merged, PR #73, `c6c98e67`). TASK-079 (the Mock carrier, PR #77, `8281055c`) is on main too, so the CarrierMoney change converts the Mock adapter in this PR.
- **Locks:** `pkg-pricing`. TASK-041 keeps its locks (working rule 7).
- **Planned union merges (no lock shows them):** TASK-043 (in flight) and TASK-051 (dispatched beside this task) also edit `packages/shared/src/classification/registry.ts`, `tools/db/grants-manifest.test.ts`, `prisma/sql/grants.manifest` and `tools/lint/negative-fixtures.test.ts`; TASK-043 adds a `./events` subpath to `packages/shared/package.json`. Whoever merges second re-merges `origin/main` and keeps both sides. Migration timestamps: TASK-043 uses `20261120000000`, TASK-040 `20261120100000`; take a later one and re-time on re-merge if main gains a later migration before this PR merges (an unmerged migration is not released).

## Read first (only these; do not re-read every ADR)

- US-140 in `docs/01-requirements/stories/EPIC-07-pricing-engine.md` (5 scenarios), REQ-PRICE-003 and DR-B07/DR-B08 in `docs/01-requirements/REQUIREMENTS.md`, A-060.
- ADR-0015 §1, §2, §4 and §7; ADR-0009 §3 (money).
- `packages/pricing/src/**` on main: `engine.ts` (`PRICING_STEPS`), `state.ts` (`appendLine`, `appendEntry`, rejected-candidate count), `rounding.ts` (`applyRate`, `Rate`), `lines/base-freight.ts` (the step shape to copy), `types.ts`.
- PR076-SEC-07: `docs/05-quality/security/PR-0075-TASK-076-security-review.md` lines 440-460 (probe, the validated four-edit patch) and line 510 (the open parts: edits 2 and 4 still apply). `tools/eslint-rules/pricing-purity.mjs`, its fixtures under `tests/fixtures/lint/` and their rows (`tools/lint/negative-fixtures.test.ts`, `tools/lint/lint-fixtures.mjs`).
- R1-m6 and D-TASK075-02: `docs/05-quality/reviews/PR-0073-TASK-075-code-review.md` lines 62 and 81; ADR-0010 amendment 12 item 2 (`docs/03-architecture/adr/ADR-0010-carrier-adapter-layer-and-resilience.md` line 128 ff.); D-ARCH-168 in `docs/sdlc/DECISIONS.md` (line 4691 ff.).
- `packages/carriers/src/canonical/{codes.ts,types.ts}`, `packages/carriers/src/index.ts`, every `amountMinor` user (`grep -rn amountMinor packages apps`), `packages/shared/src/money/money.ts` (`fromMajor`, exact, no float).
- Data model: `pricing_config_versions` (`docs/03-architecture/data-model.md` line 1815), §9.1 (seed rules: insert-only, audited) and §9.2 (the pricing row). The seed contract `prisma/seed/framework/contracts.ts` (read the "Contract limits"), `prisma/seed/reference/index.ts` (`REFERENCE_DATASETS` is empty: this is the first dataset). A GLOBAL, seed-written table to copy: `prisma/migrations/20261112030000_reference_dataset_versions/` and its `tools/db/table-classes/platform.json` entry.

## Scope notes (lead)

Work in this order and **commit after each part** (working rule 13):

1. **Margin step (US-140).** `packages/pricing/src/lines/margin.ts`, appended to `PRICING_STEPS` after the base freight step.
   - `PricingConfigSnapshot` gains `marginRules: readonly MarginRule[]`, where a rule is `{ ruleKey, priority, carrierCode: string | null, serviceCode: string | null, rate: Rate, isDefault }` (null matches any). Other DR-B08 dimensions (account, lane, segment, content type, weight band, dates) and FIXED margins arrive with US-141/US-152; do not add them now.
   - Validation (PRICING_CONFIG_INVALID): exactly one default rule (`isDefault`, priority −1000, every dimension null; AT-US-140-03 covers "none"), unique rule keys, a rate that `rateRatio` accepts and that is not negative, integer priority.
   - Selection: the matching rules ordered by priority (higher first), then specificity (service before carrier), then the lowest rule key. This is the M0 subset of DR-B08; write it so US-141 extends the comparator, not replaces it.
   - The margin is `applyRate(base freight amount, rate)` (rounded once, DR-B11), on base freight only. Line: code `MARGIN`, label key `charges.margin` (the openapi example), source `MARGIN`, zero tax, tax code null, not informational. One `FIRED` explanation entry (rule type `MARGIN`, the rule key, the config version, inputs without personal data, `effectMinor` = the margin); the other matching rules count as rejected candidates.
   - `ENGINE_VERSION` documents the step order: bump it (minor) and say so in a decision.
   - Tests: AT-US-140-01..05 with the IDs in the titles; fast-check properties (≥ 1,000 runs): margin ≥ 0 and equals the rounded rate of the base, Σ lines = net, selection is order-independent (shuffle the rules). Coverage on `packages/pricing` stays ≥ 95 % line and branch.
2. **Sample pricing configuration.** The runtime needs the rules before US-152 builds the rule tables, and `prisma` may not import `@platform/pricing` (no manifest or lockfile change, working rule 8). So:
   - The configuration as code: `packages/pricing/src/config/sample.ts` exports `SAMPLE_PRICING_CONFIG` (version key `pricing-2026.11.0`, one default rule `{ bps: 1500 }`, priority −1000; A-060, "ASSUMED seed") and its content hash as a literal. A pricing test proves the literal is the SHA-256 of the canonical JSON of the object, and a golden test prices a 2000 USD Mock cost with it to MARGIN 300 and net 2300.
   - The database row: `prisma/schema/pricing.prisma` + one expand-only migration (linter header, `down.sql`) creating `pricing_config_versions` as in data-model line 1815 (`version_key`, `effective_from`, `published_at`, `content_sha256` 32 bytes, `source`, `notes`, the standard columns written as the SYSTEM actor). GLOBAL class, new module manifest `tools/db/table-classes/pricing.json` with `runtimeReadOnly: true` (the seed as `platform_migrator` is the only writer, like `reference_dataset_versions`), `platform_app SELECT` in the migration and in `prisma/sql/grants.manifest` (+ the count pin in `tools/db/grants-manifest.test.ts`), classification registry rows for every new column (C10). The unique index on `version_key` and the active-version index of AP-PRICE-01. "Immutable when published" is a raise-only trigger; mind C15 (b) (a BEFORE ROW trigger whose name sorts after `trg_<t>__std_columns` is flagged: use an AFTER trigger or an earlier-sorting name). No `stdColumns` flag (no runtime writer), so the C15 literal is unchanged.
   - The seed: `prisma/seed/reference/pricing-sample.ts` is the first `REFERENCE_DATASETS` entry: dataset `pricing_config_versions`, `insertOnly` and `audited`, natural key `version_key`, one row with `source: 'SEED'` and `content_sha256` equal to the pricing literal. A unit test proves the seed literal equals the pricing literal (a text-level cross-check from a `tools/` test is fine, since neither workspace may import the other). An integration test (`*.int.test.ts`, lane B) proves first run applies, a re-run is a no-op, and a changed hash for the same version fails `SEED_INSERT_ONLY_CHANGED`.
3. **PR076-SEC-07 open parts** (due before this task's pricing step lands). In `tools/eslint-rules/pricing-purity.mjs` only (not `eslint.config.mjs`, which is the TASK-041 lint lock): edit 2 (refuse any `@platform/shared/<subpath>` import in `packages/pricing/src`; pricing needs the root only) and edit 4 (report a `declare` variable declarator named like a watched global, and any `declare global` block). One `bad-*` fixture each with its row; every existing pricing-purity fixture still reports exactly once and `ok-pure.ts` stays clean; the real pricing sources lint clean.
4. **CarrierMoney is ADR-0009 Money (R1-m6, D-TASK075-10).** `CarrierMoney` in `packages/carriers/src/canonical/types.ts` becomes `Money` from `@platform/shared` (keep the exported name as an alias of `Money` so no import breaks). Convert every `amountMinor` user (the Mock adapter, the guard and normalisers if they read it, test helpers and tests). Add one shared helper `carrierDecimalToMoney(value: string, currency: string): Money` in `packages/carriers/src/normalise/` on `fromMajor` (exact, no `parseFloat`; a value with more fraction digits than the currency allows is refused as invalid carrier data, and that refusal maps to the carrier layer's existing response-invalid error, not a raw `MoneyError`), with tests.
5. **Vocabularies to `packages/shared` (D-TASK075-02, ADR-0010 am. 12 item 2, D-ARCH-168).** `SURCHARGE_CODES`, `CARRIER_ERROR_CODES`, `TRACKING_STATUSES`, `DOCUMENT_FORMATS` (with their types and `is*` guards) move to a new browser-safe module of `packages/shared` exported from the root index (not `./logging` or `./queues`, which are Node-only). `packages/carriers/src/canonical/codes.ts` re-exports each moved list, so no adapter import changes; the other lists and the port's request and response types stay in `packages/carriers`. A parity test compares each moved list with its OpenAPI enum (read `docs/03-architecture/api/openapi.yaml`; add a compile-time equality against `types.gen.ts` where a named schema exists). If a list has no OpenAPI enum (the surcharge codes may not), keep its DR-B30 pin from `codes.test.ts` and record the gap as a decision.

## Acceptance (IDs in test titles)

- AT-US-140-01 … AT-US-140-05 (suite `unit`): 2000 + 15 % → MARGIN 300, net 2300 USD; every line has code, label key, amount, currency, tax amount, tax code and source; no default rule → PRICING_CONFIG_INVALID; cost 0 → margin 0 and total 0; a MOCK 10 % rule → margin 200.
- PR076-SEC-07: the subpath and `declare` fixtures report (`[AT-US-138-02]` rows, as TASK-076 named its purity rows).
- R1-m6: the Mock adapter returns `Money` values; `carrierDecimalToMoney` rows ("12.34" USD → 1234, "1234" JPY → 1234, "12.345" USD refused, "1e3" and "" refused).
- Vocabulary parity: each moved list equals its OpenAPI enum, element for element.
- Seed: dataset applies, re-run no-op, insert-only change refused (`*.int.test.ts`, lane B).

## Tests and evidence

- Unit on the host: `packages/pricing`, `packages/carriers`, `packages/shared`, `prisma/seed`, `tools/lint`, `tools/db` tests. Coverage of `packages/pricing` ≥ 95 % line and branch; changed files elsewhere ≥ 85/75.
- Lint (`--max-warnings 0`), format check, `npm run typecheck`, and `npm run build` of the touched workspaces.
- Lane B (orchestrator queue): the integration and catalog suites for the migration and the seed (C5 grants, C10 classification, C15, the migrations lint, `up-down-up`). Ask the lead for an **early lane B run on PostgreSQL 18** as soon as the migration and the seed integration test exist (working rule 3).
- Expected lane A extras: `security-integration` (the PR changes `prisma/**`).

## `.env.example` lines this task may need

None expected: the configuration is seed data and code, no new key.

## Working rules for this wave (apply to every brief of D-SD-005)

1. **Worktree and branch.** Work only in your own git worktree on the branch named above, created from the current `origin/main`. The main checkout is shared with other agents: never stash, reset or commit files you did not write, and never touch `.claude/agent-memory/**` of other agents.
2. **Node.** Every node or npm command starts with `export PATH="$APPDATA/fnm/aliases/default:$PATH";` (Node 24; Node 20 is rejected by `engine-strict`). Install with `npm ci --ignore-scripts`, then `npm run deps:rebuild`. Tools run through `npm exec --no --`, never `npx`.
3. **What you run on the host.** Lint, format check, typecheck, unit tests and the build of the workspaces you touch. Docker, Testcontainers, `quality:heavy` and the integration/api/catalog suites run only in the orchestrator's serial lane B queue (`../.orch/docker.lock`). Write the `*.int.test.ts` / `*.api.test.ts` files, make them compile, and ask for an **early lane B run on PostgreSQL 18** as soon as the migration and the first integration test exist. One heavy command host-wide at a time.
4. **Hand-written catalog literals.** Some catalog and manifest tests pin committed state as literals that a manifest change does not update. When you add a table:
   - `prisma/tests/catalog/c15-std-columns-guard.int.test.ts`: the `[SEC-TC-74] C15 (a) committed` test pins the sorted in-scope table list. If your manifest entry flags standard columns, extend that literal beside the manifest entry, with a comment naming your task.
   - `tools/db/grants-manifest.test.ts` pins counts of `prisma/sql/grants.manifest` lines: extend it together with the manifest.
   - `prisma/tests/catalog/tenant-keys.ts` and the C16 test, if the table carries an organisation key (this one does not).
   - The classification registry, for every new column (catalog C10).
5. **api/README rows.** A new problem code goes into `docs/03-architecture/api/README.md` §11 and the error catalogue in the same PR (parity test `tests/generated/error-catalogue.test.ts`, both directions, §11 table included). A new security event goes into §13 (SEC-TC-63). None is expected here: PRICING_CONFIG_INVALID already exists.
6. **`.env.example` is user-only.** Agents may not read or edit `.env*`. If you add a configuration key, put the exact placeholder lines in your Handoff Report. Prefer defaults in the schema.
7. **Files owned by TASK-041 (in flight, slot 1).** Do not edit `apps/api/src/app.ts`, `apps/api/src/start-api.ts`, `apps/api/src/main.ts`, `apps/api/src/platform/routing/pipeline.ts`, `apps/api/src/platform/authz/authorise.ts`, `apps/api/src/platform/audit/capture.ts`, `apps/api/src/platform/rate-limit/**`, `packages/audit/src/network.ts`, `tests/generated/rbac/matrix-app.ts` or `eslint.config.mjs` (the `lint` lock). If you need one of them, stop and ask; do not work around it. `packages/config/src/schema.ts`, `packages/config/src/guards.ts`, `packages/shared/src/logging/security-event.ts` and `package-lock.json` also change on TASK-041.
8. **No new dependency**, and no workspace manifest change that touches `package-lock.json`.
9. **Diff coverage and entry points.** The lane A diff-coverage gate fails changed lines that no test executes. Keep entry files (`main.ts`, `prisma/seed/index.ts`) untouched where you can and put logic in testable modules. A new file that holds only `export type …` fails the gate: put such types in an existing runtime module.
10. **Security-owned paths** (CODEOWNERS: `prisma/**`, `tools/db/**`, `tools/eslint-rules/**`, `tools/lint/**`, `tests/fixtures/lint/**`, `apps/api/src/platform/**`, every `package.json`, …) need a security record. List the owned paths you changed in the report.
11. **Commits.** Conventional Commits with a lower-case subject (commitlint), body lines under 100 characters, the task ID in the subject, decisions as `D-TASK080-nn` in the body, and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push, no PR. No secret-shaped literals in tests or fixtures (a SHA-256 hex literal is fine; do not invent key-shaped strings).
12. **Tests carry their IDs.** Every acceptance test title starts with its ID (`[AT-US-xxx-nn]`, `[SEC-TC-nn]`).
13. **Turn budget.** Commit after each part. If you are about to run out of turns, commit the work in progress and report exactly what is done, what is not, and the next step. Do not stop silently.
14. **Handoff Report** (`docs/sdlc/templates/HANDOFF.md`): branch and head SHA, files changed, test evidence (commands and counts), developer decisions as `D-TASK080-nn`, the security-owned paths touched, the `.env.example` lines needed, and open questions.

## Card (generated by docs/04-plan/generator/gen.mjs, verbatim)

#### TASK-080 — Default margin pricing as itemised lines and sample pricing configuration

| Field | Value |
|---|---|
| Stories (completes) | US-140 **DC** (M0 Must) Default margin pricing as itemised lines |
| REQs | REQ-PRICE-003 |
| NFRs | NFR-DATA-001 |
| Spikes / security / decisions | D-010, D-TASK075-02, D-TASK075-10, D-SD-003, D-ARCH-168 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | S |
| Depends on | TASK-076, TASK-075 |
| Batch · locks | 2.2 · pkg-pricing |
| Branch | `feat/TASK-080-default-margin-pricing-as-itemised` |
| Priority | Must · demo-critical |

**Files / modules**
- packages/pricing/src/lines/margin.ts
- prisma/schema/pricing.prisma + migration (pricing_config_versions minimal)
- prisma/seed/reference/pricing-sample.ts

**Acceptance tests to write**
- All US-140 scenarios (15 % default margin, itemised USD)
- CARRIER MONEY IS ADR-0009 MONEY (TASK-075 code review R1-m6; D-TASK075-10): CarrierMoney in packages/carriers/src/canonical/types.ts becomes the Money shape of ADR-0009 section 3 from @platform/shared (amount as branded minor units, ISO 4217 currency), so the pricing boundary needs no field mapping; a shared carrier decimal string to minor units helper without parseFloat
- CANONICAL VOCABULARIES TO packages/shared (D-TASK075-02, accepted for TASK-075 with the planned move; first consumer is this task): CARRIER_ERROR_CODES, TRACKING_STATUSES, DOCUMENT_FORMATS and the surcharge codes move from packages/carriers to packages/shared, with a parity test against the OpenAPI enums in packages/shared/src/api/types.gen.ts (ADR-0010 amendment 12 item 2; D-ARCH-168): packages/carriers re-exports each moved list so no adapter import changes; the request and response types of the port stay in packages/carriers; the moved lists go to the browser-safe side of packages/shared
- AT-US-140-01 … AT-US-140-05: all 5 scenarios of US-140, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Pure domain logic, no I/O in the domain layer; unit tests (+ fast-check properties where numeric/stateful); coverage on changed files ≥ 85/75 (95/95 in pricing/audit/authz).
- Expand-only migration with `down.sql`, linter header and RLS rendered from the module manifest `tools/db/table-classes/<module>.json`; every new tenant table is listed there (RLS generator coverage); classification registry updated for new columns; catalog tests green; no data-changing migration without the backup/restore rehearsal.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
