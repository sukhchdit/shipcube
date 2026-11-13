# PR-0034 / TASK-276: Jest `generated` project, seeded factories, fake clock, leakage scanner, sentinels, Mock scenario helper and Prisma query counter (senior-developer / test-engineer)

| Field | Value |
|---|---|
| PR | #34 `feat(tests): test harness, generated jest project and query counter (TASK-276)`, branch `feat/TASK-276-test-harness-generated-jest-project`, https://github.com/sukhchdit/shipcube/pull/34. Five commits (`2806b1d` helpers and factories, `dfbc044` query counter, `c878976` jest project and hook timeouts, `000e10e` README and root-script tests, merge `4643265`). Base `55d6474` (the `main` tip when this round was written, and the merge's second parent, so `base...head` is exactly the PR's own change and the merge adds no `main`-side owned path). +1,968 / -8 lines, 25 files. |
| Head | 46432656db5e625f3af9e4960e2c95642834682d |
| Lane A evidence | Run [43455142337](https://github.com/sukhchdit/shipcube/actions/runs/43455142337) on `4643265` (`pull_request`). Green: classifier, base-ref gate tooling, workflow policy, install flags, migrations, lockfile, cooldown, install, licences, signatures, audit, **Gitleaks (PR commit range)** and **Semgrep**. Red, both as expected: "Lane B evidence" (no accepted run for api, catalog-c1-c14, integration, unit: orchestrator-owned, Docker is down) and "Security-owned paths need a review record" (this record). Because the evidence step aborts the job, lint, format, type-check, unit and build did **not** run in CI on this head; section 2 (g) gives my substitutes. |
| Owned paths changed | 11, per the base-ref `check-security-owned-paths` (section 10): `apps/api/src/platform/db/query-counter.ts`, `query-counter.test.ts`, `jest.config.ts`, `package.json`, `prisma/tests/db/query-counter.int.test.ts`, `prisma/tests/seed/seed.int.test.ts`, `prisma/tests/spikes/spk03-rls-tx.int.test.ts`, `tests/factories/tsconfig.json`, `tests/helpers/tsconfig.json`, `tools/tsconfig.json`, `tsconfig.json`. The other 14 files (helpers, factories, README, two `tools/repo` tests) are unowned. |
| Reviewer / date | security-analyst, 2026-11-13, round 1. Read-only. Git commands ran in the main checkout against commit SHAs (after `git fetch`) or in a scratch `git clone --shared`; probes ran on `git archive` extracts of the head, of `main` (`55d6474`) and in scratch directories. **No Docker**: the host's Docker Desktop is hung, so nothing in this record rests on a container (section 8 lists what that leaves unproven). |

## 1. Summary

PR #34 is the Wave 0 test harness (T-QA-03): a fifth Jest project `generated` for the RBAC, audit, RLS and abuse generators, seeded factories with `.test.invalid` e-mail addresses, a fake clock, SHA-256-derived sentinels with a leakage scanner, the Mock scenario builder, and a Prisma `$allOperations` query counter for NFR-PERF-006. It touches no workflow, no lockfile, no dependency and none of the base-ref gate tooling.

**What holds.**
- **The query counter is a seam nothing mounts.** The only importers are its own unit test, its integration test and the `tools/tsconfig.json` file list; it is not re-exported from `platform/db/index.ts`, reads no environment variable or config key, has no import-time effect and records operation names, never arguments (section 2 (a)).
- **The Jest edit is narrow.** Effective-config diff on the real modules: coverage collection, thresholds, `swcrc: false`, `modulePathIgnorePatterns` (`/__mocks__/`) are byte-equal; per project only `testPathIgnorePatterns` gains `/tests/generated/`. `jest --listTests` main versus head: **0 files dropped from any project** (unit 145 to 150, integration 25 to 26, unit-dom and api unchanged; the five additions are the PR's own tests) (section 2 (d)).
- **The sentinels are not literals** (`sentinels.ts:25` derives them; a test asserts the source holds none) and **the factories are synthetic**: 126,900 generated strings (59,545 distinct) over 300 seeds and 3 workers gave 2,700 e-mail addresses that all match `user-<n>@r<10 hex>.test.invalid`, 900 distinct run ids, no SSN shape, no credential word other than the mock gateway token, 0 sentinel collisions, 0 Gitleaks-emulator findings (section 2 (b), (c)).
- **The timeouts mask nothing.** The two `afterAll(..., 60_000)` budgets are real and fail closed; the project-level `testTimeout` values are inert in Jest 30.5.2 (PR34-SEC-04), so the 5 s default still applies there.
- D-ORCH-021 levers, lock delta, base-ref gates: unchanged (section 6). Gitleaks emulation over the 1,968 added lines: 0 findings (positive controls fire).

**What does not hold, as a control.** Two LOW findings and four INFO:
- **PR34-SEC-01 (LOW):** "never mounted in production" is a convention. The layering lint lets every production layer import the counter, and the files where a mount would go (`app.ts`, `main.ts`, `modules/**`) are not security-owned.
- **PR34-SEC-02 (LOW):** the leakage scanner misses real leak shapes in log output: base64 with any prefix (the Basic-auth shape), a trailing unterminated line, upper-case e-mail, Error `cause`, `URL`/`Headers`/typed arrays, values deeper than 24 levels (skipped silently), PAN with dots, two spaces or NBSP. Probe table in section 3.
- INFO: a sentinel used as an object key is echoed into the failure message (03); project-level `testTimeout` is inert (04); the `generated` project has no lane A runner and `test:generated` passes on zero tests (05); the platform logger keeps PAN, name and tax-id values, as D-TASK276-04 already notes (06).

**Not security, but the orchestrator should know:** ESLint reports one error on this head (`tests/helpers/leakage-scanner.test.ts:5`, `import-x/no-extraneous-dependencies` for `@platform/shared`); lane A has not reached lint yet. The fix touches an owned file (`eslint.config.mjs` or a new `package.json`), so it needs a round-2 record, and PR34-SEC-01 is a natural fit for the same `eslint.config.mjs` edit.

**Findings: 2 LOW, 4 INFO. Nothing Critical, High or Medium.** Verdict in section 11.

## 2. What was checked

| | Check | Result |
|---|---|---|
| (a) | Query counter confinement. `git grep` over the head for every importer; `process.env` and config reads in the file; export surface of `platform/db/index.ts`; an ESLint probe with the head's real `eslint.config.mjs` (12 import sites, a root-client control that must be refused) | Importers: its two tests and `tools/tsconfig.json`. No environment or config read, no side effect at import. Lint **allows** `modules/*/service`, `repository`, `routes`, the module entry, `app.ts`, `main.ts`, `platform/runtime` and `platform/http` to import it; refused only for `apps/worker` (cross-app) and for the root-client control. PR34-SEC-01 |
| (b) | Sentinels and the scanner as a control. 60 object, encoding and log shapes through the PR's real `leakage-scanner.ts` (type-stripped), plus 13 shapes through the real platform logger (`createLogger`) and the scanner | PR34-SEC-02, -03, -06. Positive controls hit (raw, nested, hex, whole-value base64, percent, PAN raw and grouped, number); negative control clean |
| (c) | Factories. 300 seeds x 3 workers x 3 rounds x 8 entity kinds; triage of every hit class | No real-looking PII or credential. 107 "Luhn-valid 13 to 19 digit run" and 135 "phone-shaped" hits are all UUID-shaped ids, e-mail local parts and slugs (false positives, relevant only to `anyPan: true`). Tracking numbers are `MOCK` plus 10 digits |
| (d) | `jest.config.ts`. Real module import on `main` and head, per-project key diff; `jest --listTests --json` per project on both extracts; six planted files under `tests/generated/` (suffixes `.test.ts`, `.int.test.ts`, `.api.test.ts`, `.test.tsx`), `tools/ci/tests/generated/` and `apps/api/src/tests/generated/` | Section 1. All planted files go to `generated` and to no other project. The rule is the substring `/tests/generated/` in the path, wherever it sits |
| (e) | Timeouts. Jest 30.5.2 source (`jest-circus` reads `globalConfig.testTimeout` only) and a two-config probe (a 400 ms test; project-level `testTimeout: 50` passes, global `testTimeout: 50` fails with "Exceeded timeout of 50 ms") | PR34-SEC-04. The `afterAll` budgets (`seed.int.test.ts:41`, `spk03-rls-tx.int.test.ts:349`) are valid per-hook timeouts and fail closed |
| (f) | PR17-SEC-09 and the PR #33 `__mocks__` rule. Diff names; added lines searched for `__mocks__`, `jest.mock`, `unmock`, `doMock`, `spyOn`, `unstable_mockModule`, `moduleNameMapper`, `setupFiles` | None present. The `generated` project spreads `common`, so it keeps `modulePathIgnorePatterns` and the inline SWC transform |
| (g) | Lane A skipped lint, type-check, unit, build. Substitutes on the head extract: `tsc -b apps/api tools tests/helpers tests/factories` (clean; an injected type error is reported, control); 9 Jest suites (the PR's five plus `jest-transform`, `jest-esm`, `jest-config-owned`, `root-scripts`): 113 passed; `coverage-scope.test.ts` fails here and on `main` alike (no `.git` in an extract: environment); ESLint on the PR's files | One lint error (section 1, last paragraph). The real `npm run lint`, `format:check` and `build` were **not** run |
| (h) | Secrets. Gitleaks v8.30.1 default rules emulated in Node (222 rules compile; runtime positive controls for a GitHub token, an AWS id and a generic key fire) over the 1,968 added lines and over the 59,545 distinct factory strings | 0 findings. Lane A's real Gitleaks and Semgrep steps are green on this head |

## 3. Findings

### PR34-SEC-01: the query counter is confined by convention, not by a control (LOW)

| | |
|---|---|
| Severity | LOW (Impact L: the counter keeps operation names and counts, never arguments, and nothing exposes `requests()`; a mount would cost an extension layer, AsyncLocalStorage and a 1,000-entry array copy per request. Likelihood L: nothing imports it today; the first importer will be the API test app builder) |
| CWE / OWASP | CWE-489 Active Debug Code · A05:2021 |
| Location | `apps/api/src/platform/db/query-counter.ts:4` (the claim), `eslint.config.mjs` boundaries policy (category `db-platform`), unowned `apps/api/src/app.ts`, `main.ts`, `modules/**` |
| Description | D-TASK276-03 and the file header say the module "is not mounted by the production composition root". That is true on this head. But the only machine rule on the deep file is the root-client refusal (`db-root-client`); every other `db-platform` file is importable from every production layer. Probe (head config, 12 sites): ALLOWED from module service, repository, routes, module entry, `app.ts`, `main.ts`, `platform/runtime`, `platform/http`; REFUSED from `apps/worker` and for the `client.ts` control. `tools/test-support` is equally importable from `app.ts`. CODEOWNERS owns `/apps/api/src/platform/` but not `app.ts`, `main.ts` or `modules/**`, so a one-line mount in `app.ts` needs no security record. Separately, `apps/api/tsconfig.json` has `include: ["src"]`, so `dist/` (and the image TASK-014 will build from it) will carry `query-counter.js` and every `*.test.js`. Inert, but not "absent from production" |
| Exploitability / impact | No exploit path today. The risk is drift: a developer reaches for the counter in a "debug" middleware and ships it. Impact is bounded by what the module stores |
| Remediation | In `eslint.config.mjs` (owned): add a boundaries category `db-test-seam` for `apps/*/src/platform/db/query-counter.ts` and a policy that only the `test` and `prisma-tests` categories (and the future API test app builder folder) may depend on it, in the existing `boundaries/dependencies` list rather than as a second rule block that overrides it. Add a repository guard test (`tools/repo`) that reads every non-test `apps/*/src/**/*.ts` and fails on an import or `import()` specifier ending in `query-counter` or `query-counter.js`, with a planted-import positive control. TASK-014's image build prunes `*.test.js` and the seam |
| Verification | Re-run `probes/lint-qc.mjs` on the fixed head: every production row REFUSED, the two test rows ALLOWED. Guard test red on a planted `app.ts` import |
| Owner / due | senior-developer: in the PR #34 fix cycle (the lint error needs an `eslint.config.mjs` edit anyway), otherwise with the API test app builder, before G3 |

### PR34-SEC-02: the leakage scanner misses leak shapes that matter in log output (LOW)

| | |
|---|---|
| Severity | LOW (Impact M: a false negative lets a leak pass a test that exists to catch it, NFR-PRIV-001 "0 matches"; Likelihood L: the logger's own redaction and the later `log-scan` suite are independent layers) |
| CWE / OWASP | CWE-693 Protection Mechanism Failure · A09:2021 |
| Location | `tests/helpers/leakage-scanner.ts:42-55` (needles), `:97-137` (graph walk), `:173-194` and `:208-215` (capture and guard) |
| Description | HIT = flagged, GAP = not flagged; every GAP row was run through the real module. **Encodings.** Base64 is one needle (`:49`): it matches only when the value starts on a 3-byte boundary and what follows leaves the last character unchanged. GAP: `Basic base64("user:" + value)`, base64 of `{"token":value}`, base64 of `prefix-value-suffix`, 1-byte and 2-byte offsets, value plus one trailing byte. HIT only by accident when the next byte's top bits are zero (a newline, a colon). Upper-case hex and an upper-case e-mail are GAP (needles are the raw value and its lower case only). **Log capture.** `lines()` (`:188`) leaves out a trailing line with no newline, so `assertClean` (`:209`) never sees it; a `destination.write` without a newline yields 0 lines. CRLF lines keep the CR. **Object graph.** GAP: `Error.cause`, `AggregateError.errors`, `URL`, `URLSearchParams`, `Headers`, a plain `Uint8Array` and an `ArrayBuffer`, getters on the prototype, `#private` fields, symbol keys, non-enumerable properties, a boxed `String`. Values deeper than `maxDepth` are skipped with no finding (`:106`). A getter that throws aborts the scan. **PAN.** HIT: raw, single-space or dash groups, number. GAP: dots, two spaces, NBSP, JSON array of groups, a grouped PAN inside a longer digit run. **Through the real logger (13 shapes):** the logger redacted token, e-mail and `Basic` values; it kept name and PAN (DETECTED) and kept `base64({"token":value})` and the dotted PAN, which the scanner MISSED (the live-leak shape: kept by the logger, invisible to the guard) |
| Exploitability / impact | A redaction regression that emits a credential inside base64, an upper-cased e-mail, an Error `cause` or a typed array passes `useLeakageGuard`. The `redaction` and `log-scan` suites (US-008, T-QA-05) will credit this scanner for NFR-PRIV-001 |
| Remediation | (1) **base64:** one needle per byte alignment, keeping only characters fully determined by the value (verified: all 6 embedded shapes HIT, the unrelated-payload control stays clean, 3 needles per sentinel). `const bytes = Buffer.from(value); for (const k of [0, 1, 2]) { const enc = Buffer.concat([Buffer.alloc(k), bytes]).toString('base64'); const needle = enc.slice(Math.ceil((8 * k) / 6), Math.floor((8 * (k + bytes.length)) / 6)); if (needle.length >= 16) needles.push(needle, needle.replaceAll('+', '-').replaceAll('/', '_')); }`. (2) Compare a lower-cased copy of the text with lower-cased needles, add upper-case hex. (3) `createLogCapture().lines()` includes the pending partial line, and `assertClean` scans it. (4) After the walk, scan `util.inspect(subject, { depth: Infinity, showHidden: true, maxArrayLength: null, maxStringLength: null, breakLength: Infinity })` as text, walk `cause` and `errors`, decode ArrayBuffer views, and report the depth limit as a finding (`encoding: 'depth-limit'`) instead of skipping. (5) PAN separators `[ <U+00A0>.-]{1,2}` |
| Verification | One failing test per GAP label first (`probes/leak-probe.mjs` lists them), then all HIT; keep the ordinary-data control clean; a test that a trailing unterminated line is flagged |
| Owner / due | test-engineer, before the `redaction` or `log-scan` suite is activated (US-008, T-QA-05), at the latest before G3; cheaper inside the PR #34 fix cycle |

### PR34-SEC-03: a sentinel used as an object key is echoed into the failure message (INFO)

`scanForLeaks` builds child paths as `` `${path}.${key}` `` (`:135`) and `LeakageError` prints every path (`:147-149`). The header (`:5-6`), the README and a test (`leakage-scanner.test.ts:86-100`) say the value is NEVER reported. Probe: `{ [emailSentinel]: { note: nameSentinel } }` gives the finding path `$.<the e-mail value>.note`, and `LeakageError.message` contains the e-mail value (also for a token inside a longer key). The sentinels are synthetic, so nothing real leaks; with `anyPan: true` the same shape would print a PAN-looking key into a CI log. Fix: build the path segment from an index when the key itself matches a needle (`$.<key 3>.note`) and extend the existing test with a sentinel-keyed object. CWE-532 · A09:2021. Owner: test-engineer, with SEC-02.

### PR34-SEC-04: project-level `testTimeout` is a no-op in Jest 30.5.2 (INFO)

`jest.config.ts:129` (integration) and `:143` (generated) set `testTimeout: 30_000` inside `projects[]`. `jest-circus` reads only `globalConfig.testTimeout`; a probe with a 400 ms test passes under a project-level 50 ms and fails under a global 50 ms. Nothing is masked: the 5 s default still applies there, and lane B's `--testTimeout` flag (`heavy.mjs:81, :278`, which adds `-i --testTimeout=...` for `IN_BAND_PROJECTS`) is the working lever, so the activation PR that adds `generated` to `IN_BAND_PROJECTS` carries it. The comment at `:127-128` and D-TASK276 overstate the effect; code review's concern, listed so the security reading is on record. The `afterAll(..., 60_000)` budgets are effective and fail closed (a hung `db.stop()` fails the suite after 60 s).

### PR34-SEC-05: the `generated` project has no lane A runner and `test:generated` passes on zero tests (INFO)

Lane A runs `--selectProjects unit unit-dom`; the `generated` project (RBAC matrix, audit, RLS and abuse generators) runs only from lane B, and `package.json:45` adds `--passWithNoTests`. Any `*.test.ts` under any `/tests/generated/` path (probe: also `tools/ci/tests/generated/`) leaves lane A's unit run. The real control is the base-ref manifest: `rbac-matrix`, `audit-generator`, `rls-cross-tenant` and `abuse` already carry `min_tests: 1`, `zero_skip: true`, `security: true` and the runner text `jest --selectProjects generated`. Keep it that way: the activation PRs must not lower those values, and `--passWithNoTests` should be dropped when the first generated suite lands. Owner: qa-lead (activation PRs).

### PR34-SEC-06: the platform logger keeps PAN, name and tax-id values in unkeyed fields (INFO)

D-TASK276-04 records it; the probe confirms: an unkeyed `note` field carrying the PAN sentinel or the name sentinel is written as is (key-based card redaction exists in `string-redaction.ts:59,77,80`, no value-based PAN rule). The platform should never hold a PAN (gateway-hosted fields), so this is a detection question, not a live leak, but NFR-PRIV-001 lists "card and payment data" in the redaction list and its test is "0 matches". Route: principal-architect and the `redaction` suite owner (US-008): decide a Luhn-based value rule in the logger (cheap: the scanner's `DIGIT_RUN` plus a Luhn check) or state that the PAN scanner (`log-scan`) is the control and PAN sentinels are used only there. Not a defect of this PR.

## 4. Sentinels and factories

- `sentinels.ts` derives each value as `SHA-256("sentinel:" + label)` (`:25`); the e-mail uses `sentinel.test.invalid`; the PAN is a 16-digit Luhn-valid number with the 424242 test prefix. The values are public (computable from the repository), so they are synthetic markers, not secrets, and a real value cannot collide with a 64-bit tag. `leakage-scanner.test.ts:31-34` fails if any value is written into `sentinels.ts`.
- `rng.ts` is mulberry32 seeded from SHA-256 (32-bit state): fine for test data, never for identifiers that must be unguessable; ids it makes are not production ids. `Math.random` is not used.
- `factories.ts`: e-mail domain `<run>.test.invalid` (`.invalid` never resolves), names from two 10-item lists, one mock gateway token (`mock_ok`), no password, key or token field. `JEST_WORKER_ID` and `TEST_RUN_ID` are the only environment reads.
- `mock-scenario.ts` mirrors the `X-Mock-Scenario` vocabulary (DR-B29); it validates like the API and offers `rawScenario` for negative tests. It is a helper, not a Jest manual mock.

## 5. Probe inventory

`probes/lint-qc.mjs`, `lint-ts.mjs` (boundary matrix); `hooks.mjs` and `jest-globals-stub.mjs` (run the head's TypeScript with plain Node); `leak-probe.mjs` (60 shapes), `logger-probe.mjs` (13 logger shapes), `b64-fix.mjs` (the base64 fix); `factories-probe.mjs`; `jestcfg-diff.mjs`, `listdiff.mjs` (config and project membership); `gl-emul.mjs` (Gitleaks); `record-sim.mjs`. All under the session scratchpad (`review/PR34-35-sec/`), which is session-scoped: re-create from the method rows above if it is gone.

## 6. D-ORCH-021 levers, lock delta, base-ref gates

- `git diff origin/main...46432656 -- .github` is empty: `RANGE_BASE`, `BASH_ENV`, `PATH`, `BASH_FUNC_*`, `defaults.run`, folded `run: >` on gate steps and `$GITHUB_ENV` / `$GITHUB_PATH` writes: none changed.
- `package-lock.json`: no change. `package.json`: one added script (`test:generated`); no dependency, `overrides`, `.npmrc` or lifecycle-script change. Workspace manifests untouched. `tests/helpers` and `tests/factories` are not workspaces (no `package.json`), as `tests/api` already is.
- `tools/ci`, `tools/deps`, `.gitleaks.toml`, `.gitleaksignore`, `eslint.config.mjs`, `tools/lint`, `tools/eslint-rules`, `tools/test-support`: unchanged. No weakening of any base-ref gate; `jest-transform.test.ts` (inline SWC options equal the base-ref copy) and `jest-config-owned.test.ts` pass on the head.
- `tools/tsconfig.json`: one line added to `files` (`query-counter.ts`); `tsconfig.json`: two `references` added. No `include`, `exclude` or compiler option changed.

## 7. D-SEC-PR23-02 interim controls (evidence pending)

| Control | State on this head |
|---|---|
| Lockfile PR states the `node_modules/ajv` entry and that no non-`@platform` `link:true` entry exists | Not applicable: no lockfile change |
| No `wave` or `gate` run committed | True: no run directory in the diff |
| Evidence commit's gate table states `npm ci --ignore-scripts` + `deps:rebuild` before `quality:heavy` and an empty `info/exclude` | **Pending.** No lane B evidence exists for this head (base-ref `check-evidence`: no accepted run for api, catalog-c1-c14, integration, unit). The orchestrator's evidence commit must carry that table. Docker is down, so the integration run (including `query-counter.int.test.ts`) cannot be produced now |

## 8. What this review could not prove

- **No container ran.** `prisma/tests/db/query-counter.int.test.ts` (the top-level `$allOperations` hook sees model and raw operations through the real Prisma 7 client, ALS survives an interactive transaction and the `withStandardColumns` stack, two concurrent scopes stay apart) is the only proof of those claims; the unit suite uses a fake client. Not a security claim of this record.
- The real `npm run lint`, `format:check`, `build` and the Linux behaviour of the new tests were not run (Windows host, extract-based substitutes in section 2 (g)).
- The scanner probes show the scanner's behaviour on shapes I chose; the list is not exhaustive.

## 9. Routing and checkpoints

| Item | Severity | Owner | Due |
|---|---|---|---|
| PR34-SEC-01 | LOW | senior-developer (`eslint.config.mjs` policy + guard test) | PR #34 fix cycle, else with the API test app builder, before G3 |
| PR34-SEC-02 | LOW | test-engineer | before `redaction` / `log-scan` activate (US-008, T-QA-05), before G3 |
| PR34-SEC-03 | INFO | test-engineer | with SEC-02 |
| PR34-SEC-04 | INFO | senior-developer (comment and D-TASK276 wording; lane B flag at activation) | next touch |
| PR34-SEC-05 | INFO | qa-lead | activation PRs for the generated suites |
| PR34-SEC-06 | INFO | principal-architect with the `redaction` suite owner | before US-008 |
| Lint error `leakage-scanner.test.ts:5` | not a finding | senior-developer | before merge (needs an owned-path edit, so a round-2 record) |
| Lane B evidence for api, catalog-c1-c14, integration, unit | process | orchestrator | before merge (Docker) |

Checkpoints for later PRs: the API test app builder mounts the counter only from a test-category file (SEC-01); TASK-014's image build excludes `dist/**/*.test.js` and the seam; the first generated suite keeps `min_tests`/`zero_skip` and drops `--passWithNoTests` (SEC-05).

ASVS L2 (touched): V7.1 log content (the scanner is the control for it), V14.1 build and deploy (test seams), V14.2 dependencies (no change). No runtime surface, no new dependency, no secret.

## 10. Record check simulation (`check-security-owned-paths --pr 34`)

Method: `git clone --shared` of the main checkout (nothing written to its `.git`), base `55d6474`, head `4643265` checked out detached, this record copied into the clone's working tree, the base-ref `tools/ci` from `origin/main` (what CI runs today), scenario commits built with plumbing on top of the head. The tool reads the record from the clone's working tree. 17 scenarios, all as predicted (the record text used is this file; the sim script names it `PR-0034-sim-security-review.md`). Owned count 11.

| Case | Scenario | Result |
|---|---|---|
| A, A2 | record as written / Head row abbreviated to 7 hex | pass, satisfied at `4643265` |
| B | no record | missing |
| C | record file named for PR 35 | missing |
| D, D2, D3, D4 | final Verdict FAIL / PENDING / a later FAIL row after the PASS row / no Verdict row | missing (the last Verdict row wins) |
| E | Head row names the first PR commit `2806b1d` (owned paths changed after it) | missing |
| E2 | Head row names the `main` tip (not a commit of the PR) | missing |
| E3 | Head row removed | missing |
| F | owned `jest.config.ts` edited after the named head | missing |
| G | unowned `tools/repo/zz-sim.test.ts` added after the named head | pass |
| J | `.github/workflows/ci.yml` edited after the named head | missing (owned count 12) |
| K | `package-lock.json` re-added with identical bytes | pass (no net change) |
| P | an owned change after the record, then a round-2 record naming the new head | pass, satisfied at the new head |
| Q | the same with a FAIL round 2 | missing |

At the end of the round `origin/main` had moved to `e8829ef`: docs and `.claude/agent-memory` only since `55d6474`, so no owned path overlaps this PR and no merge-only round is needed on that account.

Negative controls for "no weakening": the base-ref checker is the one from `main` (this PR changes nothing under `tools/ci`), and D3 shows a later FAIL row cannot be hidden behind an earlier PASS (PR10-SEC-21 is still open: a head row of an older round stays bindable, unchanged by this PR).

## 11. Verdict

| Item | Value |
|---|---|
| Critical / High / Medium open | 0 / 0 / 0 |
| LOW open | 2 (PR34-SEC-01, -02) |
| INFO open | 4 (PR34-SEC-03 to -06) |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** The query counter is not mounted anywhere and records names only; the Jest change leaves coverage, transform, mock confinement and project membership intact (0 files dropped); sentinels and factories are synthetic; D-ORCH-021 levers, lock and base-ref gates are unchanged; Gitleaks emulation is clean. Two LOW follow-ups (seam confinement as a lint policy; scanner false negatives) are due as routed in section 9, not blocking. Lane B evidence is the orchestrator's merge precondition (Docker). Any fix commit that touches an owned path voids this record and needs a round 2 (the lint error already forces one). |
