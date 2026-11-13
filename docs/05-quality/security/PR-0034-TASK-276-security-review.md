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

---

## Round 2 (head 3934d12, delta + merge)

| Field | Value |
|---|---|
| PR | #34, branch `feat/TASK-276-test-harness-generated-jest-project`, https://github.com/sukhchdit/shipcube/pull/34. Fix cycle 1 for code review r1 (CHANGES_REQUESTED) and this record's round 1. Base `d693e8c` (the PR's base SHA and the `main` code tip; `origin/main` is `e1805a5`, five docs and agent-memory files further, so no owned path moved on `main`). The PR's own change against `d693e8c` is 35 non-docs files, +2,527 / -10, plus 7 evidence files. |
| Head | 3934d1224f090701c8c5ca230633971e19cf9d0d |
| Commits since round 1 (`4643265`) | merge `422607d` (main `6420f90`), fix `8aa5b66` (the whole fix cycle), fix `81bea01` (lazy `PrismaPromise` in `measure()`), merge `030fae9` (main `d693e8c`, carries PRs #35 and #36), evidence `3934d12` (docs only). |
| Lane A evidence | Run [43496097102](https://github.com/sukhchdit/shipcube/actions/runs/43496097102) on `3934d12`. `fast-lane` is green end to end: workflow policy, install flags, lockfile, cooldown, licences, signatures, audit, **Lane B evidence**, commitlint, Lint, Lint must not mutate the tree, Format, actionlint, Type-check, Unit tests, "Lint negative fixtures from the base ref against the head configs", Build. `scans`: **Gitleaks (PR commit range)**, **Semgrep** and OpenAPI breaking changes green. Red only at "Security-owned paths need a review record" (this record), and `ci-gate` for that reason alone. Round 1 could not see lint, type-check, unit or build in CI; this head can, so no extract substitutes are needed for them. |
| Owned paths changed | 19 (round 1: 11), per the base-ref `check-security-owned-paths` on the main-tip tooling: the eleven of round 1 plus `eslint.config.mjs`, `tools/lint/negative-fixtures.test.ts`, `tools/quality/heavy.mjs`, `tools/quality/heavy.test.ts` and the four fixtures under `tests/fixtures/lint/layering/query-counter-seam/`. |
| Reviewer / date | security-analyst, 2026-11-14, round 2. Read-only. Git ran in the main checkout against commit SHAs, in a scratch `git clone --shared`, and on `git archive` extracts (head, `4643265`, `d693e8c`, and the `git merge-tree` union with PR #32); the PR worktree was not touched. **No Docker**: the lane B container run is the orchestrator's accepted evidence (R2.7), not mine. Every mutant was applied to an extract and restored (byte-equal to the head blobs afterwards); the `refs/remotes/origin/pr-32-head` ref created for the union was deleted at the end. |

### R2.1 Summary

Round 2 verifies the fix cycle against my round 1: **PR34-SEC-01 and PR34-SEC-02 are closed** (both LOW), together with INFO 03 and 04; INFO 05 narrows and stays open with 06; **two new INFO findings** (07, 08) come out of the bypass and residual probes. The owned-path edits (`jest.config.ts`, `eslint.config.mjs`, `heavy.mjs`, fixtures, tsconfigs, `package.json`) weaken nothing: coverage collection, thresholds, `swcrc: false`, the `__mocks__` ignore, `check-evidence` and the manifest are leaf-equal to `main`, and each "no weakening" probe was shown to see a planted weakening. Both merges are pure unions. The evidence is accepted by the base-ref verifier and holds no host fragment. No new dependency, no lockfile or workflow change.

| ID | Round 1 | Now | Basis |
|---|---|---|---|
| PR34-SEC-01 | LOW open | **Closed** | `db-test-seam` policy refuses 21 of 21 production importer shapes (round 1 build: allowed 19 of those 21) and the five bypass spellings it can see; allows the six test shapes; 7 of 8 policy mutants die; scan tripwire with positive control (R2.2) |
| PR34-SEC-02 | LOW open | **Closed** | 243-row probe: round 1 build differs on 124 rows, head on 8 (all explained); real logger, 23 shapes: round 1 scanner missed 8 of the 14 shapes that survive into a log line, head misses none; linear time; 61 mutants of the PR's tests, 54 killed (R2.3) |
| PR34-SEC-03 | INFO open | **Closed** | 11 key shapes, 0 echoes; 4 mutants die |
| PR34-SEC-04 | INFO open | **Closed** | both project-level `testTimeout` values are gone from `jest.config.ts` (leaf diff); hook budgets stay per hook |
| PR34-SEC-05 | INFO open | Open, narrowed | a plain `*.test.ts(x)` under `tests/generated/` now runs in lane A `unit` / `unit-dom`; only `*.api` / `*.int` generated suites remain lane B only, and `test:generated` still has `--passWithNoTests` (R2.4) |
| PR34-SEC-06 | INFO open | Open | data refreshed: the logger keeps name, tax id and PAN in all spellings; the scanner now flags every one (R2.4) |
| PR34-SEC-07 | new | INFO open | the seam allowance keys on the importer's path category, so a production file can reach the seam through a `tests/` folder or `*.test.ts` file; computed specifiers; scan walk can go vacuous (R2.5) |
| PR34-SEC-08 | new | INFO open | residual scanner false negatives that are contrived or opaque (R2.5) |

### R2.2 PR34-SEC-01: closed

The policy: category `db-test-seam` for `apps/*/src/platform/db/query-counter.ts`, a last-position `disallow` to that category for every importer, and one `allow` for the `test` and `prisma-tests` categories (`eslint.config.mjs:177`, `:430-439`). Probe: the head's real `eslint.config.mjs` over a `git archive` extract, `ESLint#lintText` with type-aware rules disabled, 37 import sites (script `lint-seam.mjs`; a planted-file extract of `apps/api/src/tests/mount.ts` and `mount.test.ts` gives the resolved arm real targets); the same sites on the round 1 extract as the positive control.

| Group | Head | Round 1 build (control) |
|---|---|---|
| 21 production importer shapes: `app.ts`, `main.ts`, module service, repository, routes, controller, entry `index.ts`, schemas, `platform/runtime`, `platform/http`, another `platform/db` file, three re-export forms in `platform/db/index.ts` (`export {} from`, `export * from`, `export * as`), `apps/worker`, `packages/shared`, `tools/`, `prisma/seed` by relative path, a specifier without extension, with `.ts`, a side-effect import | **21 REFUSED** with the seam message | **19 allowed**, 2 refused only by unrelated cross-app and cross-package rules |
| Bypass attempts the lint can see: type-only import, `import('...')` with a string, `import(\`...\`)` with a template literal, `createRequire(import.meta.url)('...')`, a bare `require('...')` | **5 REFUSED** (imported file resolved, not just the text) | 5 allowed |
| Root-client control (`platform/db/client.ts` from `app.ts`) | refused (`db-root-client`) | refused |
| 6 test shapes: `query-counter.test.ts`, `prisma/tests/**/*.int.test.ts`, a module service test, `apps/api/tests/*.api.test.ts`, `apps/api/src/tests/` builder, `tests/api/helpers/` builder | **6 ALLOWED** | allowed |
| `.ts`, `.mts`, `.tsx`, `.cts`, `.js`, `.mjs`, `.jsx` importers | all refused (`.cjs` does not parse ESM syntax; a `require` there is the covered form) | not applicable |

Policy mutants run through the PR's own fixture cases (`negative-fixtures.test.ts`, the three seam cases): category row dropped, disallow dropped, allow dropped (a test refused), allow broadened to every file, to `api-module` and to `app`, allow listed before the disallow: **7 killed**. One survivor: widening the seam category to the whole `platform/db` folder, which only the full lint (every real db importer) would reject. The source-scan tripwire (`tools/repo/test-seams.test.ts`, positive control over five import forms): mutants that blind the seam regexp, drop the `from` form or drop the `require` form die; two mutants that make the walk vacuous survive (code review R2-m2). CI ran the base-ref copy of the fixture step against the head config: green.

What still gets past both arms is PR34-SEC-07 (R2.5): computed specifiers, and a production file that reaches the seam through a `tests/` folder or a `*.test.ts` file. The `apps/api/dist` point of round 1 is unchanged by this PR (`apps/api/tsconfig.json` is untouched): TASK-014's image build must still exclude `dist/**/*.test.js` and `query-counter.js`.

### R2.3 PR34-SEC-02 and -03: closed

Probe `leak-probe.mjs`: the head's real `leakage-scanner.ts` and `sentinels.ts`, type-stripped, 243 rows, labels and HIT/GAP only (no value is printed). 188 rows expect a hit, 43 expect a gap (documented residuals and negative controls) and 12 expect a thrown message without an echo or a throw. **Head: 235 as expected, 8 differ**, all mine to explain: four rows `base64 of UPPER value` (those four sentinels are already upper-case, so the hit is right), PAN as a JSON array of groups (a residual, SEC-08), `Uint16Array` (decoded as UTF-8, residual), a function with own properties (functions are not walked, residual), and a `toJSON` accessor that throws (the one `Reflect.get` outside the `try`; the scan throws, it does not pass: code review R2-n1). **Round 1 build: 124 rows differ** (68 of them base64, base64url, `Basic` and JWT shapes, plus upper-case e-mail and hex, PAN dots, double space, NBSP, dash plus space and mixed, Error `cause`, `AggregateError`, `Uint8Array`, `ArrayBuffer`, `DataView`, `URL`, `URLSearchParams`, `Headers`, `toJSON`, non-enumerable and symbol keys, depth 40, unterminated line, three key echoes, key by case or symbol): the probe sees what the fix closed.

| Check | Result |
|---|---|
| Encodings at every alignment | the five text sentinels at byte offsets 0, 1, 2 as bare base64, with a trailing byte, inside JSON, base64url without padding, `Basic user:value`, `Basic value:pw`, a JWT payload and a JSON log line: all hit (head); round 1 missed 68 rows |
| Real platform logger, 23 shapes (`createLogger` into `createLogCapture`, head scanner versus round 1 scanner) | 14 shapes keep a sentinel in the logged line: name, tax id, PAN raw, PAN grouped by spaces, dots, NBSP and dash plus space, base64 of `{"token":...}` and of `{"email":...}`, a JWT-shaped string, base64 JSON of the name at offset 1, upper-case hex, a sentinel as object key, a nested array. **Head flags 14 of 14; round 1 flagged 6**, so the live-leak shapes of round 1 (kept by the logger, invisible to the guard) are closed. The other nine shapes are redacted or omitted by the logger itself (token, secret, e-mail, `Basic` value, `Error` and `AggregateError`, `URL`, bytes as `[Binary]`) |
| Keys never echoed (SEC-03) | 11 shapes (sentinel e-mail as key, a token inside a longer key, PAN as key, base64, hex, percent and upper-case spellings of a sentinel as key, `Map` key, symbol description, nested under a safe key, safe key keeps its name): 0 echoes in the thrown message; 4 mutants die |
| Hook (code review R1-M2) | mutate `assertClean()` in the registered hook to `void 0`: 1 of 51 fails (round 1: 0 of 15); `clear()` dropped: 7 fail; never registered: 4 fail |
| Time | 11 adversarial text shapes (digit and separator runs, near-miss PANs, NBSP runs, half-sentinel repeats) at 8 KiB, 32 KiB, 128 KiB, 1 MiB: ratio 128k/8k between 1.6 and 10.8 (linear is 16), 1 MiB in 2.3 to 34 ms, so no ReDoS in the new `DIGIT_RUN`; 300,000 small objects in 1.9 s. `createLogCapture` re-splits its pending buffer per write (32,000 unterminated writes: 1.7 s): test-only, code review R2-n2 |
| Mutants of the PR's own tests | 61 run (scanner, hook, fake clock, run identity, query counter, project map, `heavy.mjs`, seam scan): 54 killed; the 7 survivors are listed in the code review round 2 and none is a security-relevant gap in the scanner itself |

### R2.4 The other round 1 items

- **PR34-SEC-04 (INFO) closed.** The effective `jest.config.ts` no longer has a project-level `testTimeout`; `D-TASK276-07` records it. The `afterAll(..., 60_000)` budgets are unchanged and fail closed.
- **PR34-SEC-05 (INFO) open, narrowed.** Round 1 found that any `*.test.ts` under any `/tests/generated/` path left lane A. Now `jest --listTests` on the union with PR #32 and nine planted files shows plain `.test.ts` in `unit`, plain `.test.tsx` in `unit-dom`, and only `*.api` / `*.int` under `tests/generated/` (any depth, any prefix such as `tools/ci/tests/generated/`) in `generated`, with no file in two projects and none dropped from `main` (unit 149 to 156, integration 25 to 26, other projects equal). `heavy.mjs` accepts `generated` and runs it in band, so activation is manifest-only; the four planned manifest entries (`rbac-matrix`, `audit-generator`, `rls-cross-tenant`, `abuse`) keep `min_tests: 1`, `zero_skip` and `security: true`, and `heavy.mjs` adds no `--passWithNoTests`. Still open: `package.json` `test:generated` carries `--passWithNoTests`; drop it when the first generated suite lands (qa-lead, activation PRs).
- **PR34-SEC-06 (INFO) open, no change of owner.** The real-logger run above shows the logger keeps name, tax id and PAN (raw and in four grouped spellings) in an unkeyed field and redacts token, secret, e-mail and `Basic`. The scanner now flags all of them, which is the control until principal-architect and the `redaction` suite owner rule on a Luhn value rule in the logger (US-008).

### R2.5 New findings

#### PR34-SEC-07: the seam allowance keys on the importer's path, so a hop through a test-category file reaches it (INFO)

| | |
|---|---|
| Severity | INFO (Impact L: the seam stores operation names and counts, never arguments; Likelihood VL: it needs a deliberate detour, not a careless import) |
| CWE / OWASP | CWE-489 Active Debug Code · A05:2021 |
| Location | `eslint.config.mjs:49` (`TEST_FILES`), `:430-439` (the seam policies), `tools/repo/test-seams.test.ts:20` (`TEST_FILE`) |
| Description | Probed with the head's real config: `apps/api/src/app.ts` importing `./tests/mount.js` (a file in a folder named `tests`, which imports the seam) and `apps/api/src/app.ts` importing `./mount.test.js` are both **ALLOWED**. The `test` category is `**/*.test.{ts,tsx,js,jsx}` or any `test`, `tests`, `__tests__` folder at any depth, the seam allowance is granted to that whole category, no policy forbids a non-test file from importing a test-category file, and the source scan exempts the same paths. Also not seen by either arm: a computed specifier (`import('./platform/db/' + 'query-counter.js')`, ALLOWED). The scan alone misses a template-literal `import()` and `createRequire(...)(...)`; the lint refuses both. No current instance: 0 imports into a test-category file in the 242 non-test source files of `apps`, `packages`, `prisma` and `tools` (relative specifiers), so the policy below costs nothing today |
| Exploitability / impact | None today. A future "debug" mount would have to be written into a `tests/` folder and imported from production on purpose |
| Remediation | Add one policy to `BOUNDARIES_POLICIES` before the seam pair: `{ from: { file: { categories: { noneOf: ['test'] } } }, disallow: { to: toLayer('test') }, message: 'production code never imports a test file or folder' }`, with one negative fixture (`app.ts` importing a `tests/` helper). Give the scan a non-vacuity assertion (files scanned `> 0`, a planted offender in a temp tree is reported). Both belong with the API test app builder PR, the first PR that imports the seam from a `tests/` folder |
| Verification | `app.ts` importing `./tests/mount.js` becomes REFUSED; the six test shapes stay ALLOWED; the two surviving scan mutants die |
| Owner / due | senior-developer, with the API test app builder PR, before G3 |

#### PR34-SEC-08: residual scanner false negatives (INFO)

| | |
|---|---|
| Severity | INFO (Impact M, Likelihood VL: every row needs an unusual rendering of a value that a logger would have to produce unredacted) |
| CWE / OWASP | CWE-693 Protection Mechanism Failure · A09:2021 |
| Location | `tests/helpers/leakage-scanner.ts:90` (`DIGIT_RUN`), `:160-187` (the walk) |
| Description | Probed and not found: a PAN written as a JSON array of groups, with three or more separators, with a thin space (U+2009), or as a grouped PAN directly followed by more digits; a boxed `String` object; own properties on an `Array`, `Map`, `Set` or typed array; a function with properties; prototype getters and `#private` fields (the header says so); a `Uint16Array` of UTF-16 text; a value encoded twice (base64 of base64), reversed, or split by spaces; a `toJSON` accessor that throws aborts the scan with its own error. A value split across two log lines is not joined. None is a regression of round 1 |
| Remediation | None required now. If the `redaction` or `log-scan` suites need more, add the JSON-array and thin-space PAN forms to the separator class and read a boxed primitive with `valueOf()`; keep every extension behind a failing test first |
| Owner / due | test-engineer, with the `redaction` / `log-scan` activation (US-008, T-QA-05) |

### R2.6 Owned paths: no weakening

| Path | Check | Result |
|---|---|---|
| `jest.config.ts` | Every leaf of the effective config, `main` to head (script `jestcfg-diff.mjs`) | `collectCoverageFrom`, `coverageThreshold` (85 / 75), `coverageProvider`, `SWC_JEST_OPTIONS` (`swcrc: false`, inline options), `modulePathIgnorePatterns` (`/__mocks__/` still ignored), roots, environments, `transform`, the `unit` and `unit-dom` ignore lists: equal. Changed: `api` and `integration` gain the `/tests/generated/` ignore; the new `generated` project spreads `common` (same transform, same `__mocks__` ignore). Control: removing `swcrc: false` fails `tools/ci/jest-transform.test.ts` (3 of 3); removing the `__mocks__` ignore fails `jest-config-owned.test.ts` (2 of 4) |
| `eslint.config.mjs` | Effective config (`calculateConfigForFile`) for 32 representative and near-miss paths on `main` and head, semantic diff (script `effcfg-sem.mjs`) | Per path only: `boundaries/files` plus one category row, `boundaries/dependencies` plus two policies, appended after the 35 existing ones with the options object and severity (error) unchanged. One rule leaf changes anywhere: `import-x/no-extraneous-dependencies` at exactly `tests/helpers/leakage-scanner.test.ts`, to the same options the existing `tools/repo/jest-esm.test.ts` allowance carries (`devDependencies: true`, `packageDir` root and `apps/api`); its siblings (`.ts`, `fake-clock.test.ts`, a nested `.test.ts`, `.test.tsx`) are equal to `main`. Controls: widening that glob to `tests/**/*.test.ts` makes six paths differ (five beyond the real change); switching the rule off shows as severity 0 at the file |
| `tools/quality/heavy.mjs`, `heavy.test.ts` | Diff and mutants | `generated` added to the typedef, `IN_BAND_PROJECTS` and `JEST_PROJECTS` (11 changed lines); `check-evidence.mjs`, `lib/**`, `required-suites.json`, `suite-runners.json`, `summary.schema.json` untouched (the only `tools/quality` files in the PR's range are these two); dropping `generated` from either set fails `heavy.test.ts` |
| `tools/lint/negative-fixtures.test.ts`, 4 fixtures | Diff | 3 cases added (two refusals, one allowance) in the existing TENANT_DB and allowed tables; fixtures sit under the ignored `tests/fixtures/lint/**` tree; no existing case removed or relaxed; CI ran the base-ref fixture harness against the head config: green |
| `package.json`, `tsconfig.json`, `tools/tsconfig.json`, `tests/{helpers,factories}/tsconfig.json` | Diff | one script (`test:generated`), two `references`, one `files` entry, two new type-check-only tsconfigs (`noEmit`, no `package.json`, not workspaces); no dependency, `overrides`, `.npmrc`, lifecycle script or workspace change; `package-lock.json` and every workspace `package.json` unchanged |
| `apps/api/src/platform/db/query-counter.ts` and its test, `prisma/tests/**` | Diff | `measure()` awaits the measured function inside the scope (one line); two `afterAll(..., 60_000)` budgets; one new int test. The counter still records operation names, never arguments, and is unreachable from production code per R2.2 |

### R2.7 Evidence, secrets and levers

- **Evidence accepted.** Run `20261113T1943Z_030fae9` (profile pr, PASS; unit 3,890, integration 257, api 94, catalog-c1-c14 74; `git_dirty` false, `build_clean` true, no env override) is accepted by the base-ref `check-evidence` run in a shared clone at the head with the tooling of `d693e8c` and of `e1805a5` (exit 0 both; the other run directories on `main` are rejected as not-ancestors, as designed). Its `lockfile_sha256` equals the head's `package-lock.json`, its `manifest_sha256` equals the head's `required-suites.json`, and `quality:heavy` ran at `030fae9`, an ancestor of the head with only docs after it. `prisma/tests/db/query-counter.int.test.ts` executed: 4 of 4 passing, none skipped. The skips (1 integration: the SPK-03 set_config timing test, 2 unit: POSIX-only `file-secret-provider` cases) are on `main` too and none carries a SEC-TC.
- **Host-path scan, count only.** 7 blobs of the run directory, 10 labels (OS user name, its 8.3 stem, home in both spellings, tmpdir in both, host name, git e-mail local part, `documents/projects`, `appdata`): **0 hits**; positive control 10 of 10 on a synthetic text. The commit message gate table is present, as D-SEC-PR23-02 asks (`npm ci --ignore-scripts` plus `deps:rebuild`, empty porcelain and `info/exclude`).
- **Gitleaks emulation** (v8.30.1 default rules in Node, 222 rules, 220 compile; runtime positive controls for a GitHub token, an AWS id and a generic key fire): 0 findings over the 2,293 added code lines of the PR's range and over the 8,132 added evidence lines. Lane A's real Gitleaks and Semgrep steps are green on this head.
- **D-ORCH-021 levers.** `git diff d693e8c 3934d12` over `.github`, `tools/ci`, `tools/deps`, `tools/eslint-rules`, `tools/test-support`, `.gitleaks.toml`, `.gitleaksignore`, CODEOWNERS: empty. `RANGE_BASE`, `BASH_ENV`, `PATH`, `BASH_FUNC_*`, `defaults.run`, folded `run: >` and `$GITHUB_ENV` / `$GITHUB_PATH` writes are therefore unchanged. Lock delta: none.
- **Pre-lint execution points.** The PR adds none (no `vite.config`, `routes.ts`, `prisma.config.ts`, workspace script or typegen input).
- **Not run by me:** Docker, the real `npm run lint`/`build` (lane A ran them, green), the Linux behaviour of the new tests beyond lane A and lane B.

### R2.8 Merges and PR #32

- **Merge `422607d` and merge `030fae9`: pure unions.** `git merge-tree --write-tree` of each merge's parents gives the merge commit's tree exactly (`73a59d5e...` and `212d4a43...`). The PR's range against `d693e8c` contains only PR files plus the 7 evidence files; no `main`-side path was reverted.
- **Main drift.** `origin/main` (`e1805a5`) differs from the PR base by `docs/sdlc/DECISIONS.md`, `STATUS.md` and three agent-memory files: no owned path, no merge-only round on that account.
- **Union with PR #32 (`5eee2d0`).** `jest.config.ts`, `package.json` and `tools/tsconfig.json` auto-merge; three textual conflicts of two independent additions each (`eslint.config.mjs` allowance blocks, `negative-fixtures.test.ts` cases, `jest-esm.test.ts` script list; resolution in the code review R2.5). After the union both PR #32 suites stay in `unit` and no file is in two projects; the `db-test-seam` policy and PR #32's root-client policy are independent entries of the same list. The second merger needs fresh lane B evidence and a merge-only security round that re-checks the three resolved files, the effective `eslint.config.mjs` diff and `jest.config.ts`.

### R2.9 Routing and checkpoints

| Item | Severity | Owner | Due |
|---|---|---|---|
| PR34-SEC-07 | INFO | senior-developer (policy, fixture and scan non-vacuity) | with the API test app builder PR, before G3 |
| PR34-SEC-08 | INFO | test-engineer | with the `redaction` / `log-scan` activation (US-008, T-QA-05) |
| PR34-SEC-05 | INFO | qa-lead | activation PRs for the generated suites: keep `min_tests` / `zero_skip`, drop `--passWithNoTests` |
| PR34-SEC-06 | INFO | principal-architect with the `redaction` suite owner | before US-008 |
| Code review R2-m1, R2-m2, R2-n1..n3 | MINOR / NIT | test-engineer | next touch of `tests/helpers` and `tools/repo/test-seams.test.ts` (unowned paths, but any non-docs commit stales the lane B run) |

Checkpoints for later PRs: the API test app builder mounts the counter only from a test-category file; TASK-014's image build excludes `dist/**/*.test.js` and `query-counter.js`; the second merger of #32 and #34 gets a merge-only round; ASVS L2 touched: V7.1 log content (the scanner is the control), V14.1 build and deploy (test seams), V14.2 dependencies (no change). No runtime surface, no new dependency, no secret.

### R2.10 Record check simulation (`check-security-owned-paths --pr 34`)

Method: `git clone --shared` of the main checkout (nothing written to its `.git`), base `d693e8c`, head `3934d12` checked out detached, this record (round 1 plus this round) copied into the clone's working tree, the base-ref `tools/ci` from `origin/main` (`e1805a5`, what CI runs), scenario commits built on top of the head. The tool reads the record from the clone's working tree. 39 scenarios; 37 came out as predicted and the two that did not (E2, K) failed in the safe direction and are explained. Owned count 19 (20 when `ci.yml` is touched).

| Case | Scenario | Result |
|---|---|---|
| A, A2, A3 | record as written / round 2 Head row abbreviated to 7 hex / `--base` = `main` tip `e1805a5` | pass, satisfied at `3934d12` |
| B | round 1 record only (what `main` carries today; its note names `4643265`) | missing |
| C, C2 | no record / record file named for PR 35 | missing |
| D, D2, D3, D6 | final Verdict FAIL / PENDING / a later FAIL row after the PASS row / lower-case token | missing (the last Verdict row wins) |
| D4, D5 | round 2 without its own Verdict row (the round 1 PASS row is last: PR10-SEC-04, procedural) / PASS_WITH_CONDITIONS | pass |
| E, E4, E5, E6, E7 | Head row names fix `8aa5b66` / the `main` tip / is removed (round 1 row remains) / names the round 1 head / a non-hex token | missing |
| E2 | Head row names fix `81bea01` | missing. I predicted pass: the merge `030fae9` that follows it brought PR #35's `tools/quality` files, which are owned paths, so owned paths did change after that commit. Only the head or the merge `030fae9` can be named |
| E3 | Head row names the merge `030fae9` (docs-only evidence after it) | pass, satisfied at `030fae9` |
| F, F2, F3, F4, F5, F6, F7, H | owned `jest.config.ts`, `eslint.config.mjs`, `tools/quality/heavy.mjs`, `query-counter.ts`, a seam fixture, `negative-fixtures.test.ts`, `package.json`, `ci.yml` edited after the named head | missing |
| G, G2, G3 | an unowned new test file / an evidence run file / an edit of the unowned `tests/helpers/leakage-scanner.ts` (the code review nits) after the head | pass (the nits would not void this record; any non-docs commit still stales the lane B run) |
| I | `package-lock.json` deleted then re-added with identical bytes | pass (no net change) |
| J | real merge of `main` `e1805a5` after the record | pass |
| K, K2 | revert of both fix commits / of `81bea01` only, after the record | missing. For K I predicted pass through the round 1 Head row (PR10-SEC-21); it does not bind here because the owned files `main`'s merge brought in changed after `4643265`, so the record cannot be reused for a reverted tree |
| M | `--event push` | skipped |
| N | round 2 Head row only inside a fenced block | missing |
| O | an extra Head row naming a non-PR commit above the right row | pass |
| P, Q | an owned change after the record, then a round 3 naming the new head, with PASS / with FAIL | pass, satisfied at the new head / missing |

Negative controls for "no weakening": the checker is the base-ref copy (`git diff d693e8c 3934d12 -- tools/ci` is empty), and D3 shows a later FAIL row cannot be hidden behind an earlier PASS.

### R2.11 Verdict

| Item | Value |
|---|---|
| Critical / High / Medium open | 0 / 0 / 0 |
| LOW open | 0 (PR34-SEC-01 and -02 closed) |
| INFO open | 4 (PR34-SEC-05, -06, -07, -08); closed in this round: -03, -04 |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** Both round 1 LOW findings are closed with probes that fail on the round 1 build and pass on this head: the query counter seam is refused from every production importer shape the lint can parse, and the leakage scanner finds every live-leak shape the platform logger lets through. The owned-path edits (`jest.config.ts`, `eslint.config.mjs`, `heavy.mjs`, fixtures, tsconfigs, `package.json`) are leaf-equal to `main` except for the intended additions, so no gate, coverage collection, transform, `__mocks__` confinement or `check-evidence` rule is weaker. The two merges are pure unions, the lane B evidence is accepted with no host fragment, and no lever, lock or dependency changed. Four INFO follow-ups are routed in R2.9, none blocking. Any later commit to an owned path voids this record and needs a round 3; any later non-docs commit voids the lane B run. |
