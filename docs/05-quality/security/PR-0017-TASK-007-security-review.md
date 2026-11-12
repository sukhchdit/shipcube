# PR-0017 / TASK-007 follow-up: change-scoped security review (base-ref lint fixtures, no-weakening subset semantics)

| Field | Value |
|---|---|
| PR | #17 `ci(lint): base-ref fixture run checks no-weakening with subset semantics`, https://github.com/sukhchdit/shipcube/pull/17, branch `fix/ci-base-fixture-subset`, 1 commit on merge-base `eccdca1`, 10 files (+421 / −31) |
| Head | ea78d38b8d52b45dd1356c5f3c75034d967b8b56 |
| Scope | `.github/workflows/ci.yml` (base-ref fixture step), `tools/lint/fixture-expectations.mjs` (new), `tools/lint/negative-fixtures.test.ts`, `tools/lint/fixture-expectations.test.ts` (new), `tools/ci/check-workflow-policy.mjs` (required gate + rule `lint-fixture-mode`), `tools/ci/check-workflow-policy.test.ts`, `tools/ci/ci-policy.test.ts`, two workflow-policy fixtures, `tests/fixtures/lint/README.md` |
| Decisions in scope | D-ORCH-018 item 2, D-TASK007-03, D-TASK007-02 item 13 (record contract); PR2-SEC-08, PR10-SEC-02 (accepted: fast-lane base-ref steps are accident guards), PR10-SEC-17 (policy rules are pattern-narrow) |
| Lane A evidence | Run [43308041320](https://github.com/sukhchdit/shipcube/actions/runs/43308041320) on `ea78d38`: fast-lane `success`, no step skipped. The base-ref step ran main's old suite unfiltered (bootstrap, PR body E6): `Tests: 97 passed, 97 total`. scans failed only on "Security-owned paths need a review record" (this record); ci-gate red as a consequence |
| Reviewer / date | security-analyst, 2026-11-13. Read-only: no `npm ci`, no build, no Docker, no test suite. Probes run from a session scratch directory against `git archive` copies of `ea78d38` with main's installed `node_modules` (§2). One read-only `jest --showConfig` in the main checkout to confirm Jest 30.5.2 flag spellings (no test executed). No command was run in the PR worktree |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding; merge rule met for `ea78d38`. 4 LOW, 2 INFO, none a merge blocker. The control still detects every weakening class it targets (§1.1), and the head-controlled `--testNamePattern` is gone. The mode cannot be flipped or bypassed by an owned-path-free head change except through vectors of the already accepted PR10-SEC-02 class and one new unowned-config vector, PR17-SEC-01 (`.swcrc`), due before the first Wave-1 feature merge |

## 1. Summary

The change does what D-ORCH-018 item 2 asked:
- the base-ref run keeps failing on every weakening of a base `bad-*` expectation;
- it lets rule-adding PRs pass;
- it moves the decision about what the base run skips from a head-controlled command-line filter into the base suite.

`fixture-expectations.mjs` is taken from the base together with the suite, the harness and `tools/test-support`. The mode fails closed on an unknown value, and the new required-gate entry plus the `lint-fixture-mode` rule keep the variable off the head unit-test run as far as a workflow-text check can.

### 1.1 Does the control still detect weakening?

Yes. I checked each class against the head `noWeakening()` (probe P-3), the PR's unit fixtures and its local end-to-end runs E2/E8.

| Weakening | Base run (no-weakening) | Evidence |
|---|---|---|
| Rule removed or turned off | fails (`missing`) | P-3 P1; unit (a); E2, E8 |
| Downgraded to `warn` | fails | P-3 P2; unit (a); E2 |
| Same rule, policy message gone or changed | fails (message fragment) | P-3 H4; unit (a) |
| One of two independent controls dropped (bcrypt) | fails (distinct rule ids, one finding per entry) | P-3 H3; unit (a) |
| Replaced by another rule | fails | unit (a) |
| Fixture ignored by the head config | fails (ESLint's ignored-file warning has no rule id) | P-3 H6 |
| Parser change in the PR's config, parse error | fails | P-3 H5 |
| Repo-matrix severity or ignore change | fails: `effective` and `ignored` assertions still run unskipped with exact equality | suite lines 441-495 |
| Rule fires elsewhere in the same fixture instead of on the target construct | **passes**: location-blind matching, see PR17-SEC-02 | P-3 H1/H2 |
| `check-suppressions` dropped from `npm run lint` | **not checked** in the base run (skipped, as under the old filter), see PR17-SEC-04 | suite 431-439 |

The only assertion newly skipped in the base run, compared with the old `--testNamePattern`, is "every local platform/* rule has at least one negative fixture". It reads the head's rule list and is not a weakening detector, so nothing security-relevant is lost.

### 1.2 Can head code influence the mode?

**Base run.** The mode comes only from the step `env:`. `no-weakening` is already the weakest mode. Setting `exact` makes the run stricter (fail closed), and any other value throws at suite load (P-3). There is no value that skips the expected-findings assertions.

**Head run (`test:unit`).** The variable must be absent. These sources were checked:

| Source | Result |
|---|---|
| Workflow, job or other-step `env:` and `$GITHUB_ENV` lines in workflow text | Rejected by `lint-fixture-mode` (P-1 C3; PR fixtures). Not caught: split-string or encoded writes (P-1 K11), see PR17-SEC-03 |
| `jest.config.ts` and `package.json` | Owned (record required), LINT_CONTROLS triggers, and `ci-policy.test.ts` asserts no mention |
| `NODE_OPTIONS` | Step, job and workflow env are rejected by the existing `node-options-preload` rule (P-1 K10). The runner refuses `NODE_OPTIONS` from `$GITHUB_ENV` (GitHub changelog 2023-10-05, runner v2.309.0) |
| Cross-file `process.env` leakage inside Jest | None. jest-util 30 gives every test file a copied `process.env` (`createProcessEnv`), so an accidental `process.env.LINT_FIXTURE_MODE = …` in another test cannot reach `negative-fixtures.test.ts` |
| A `tools/test-support` or setup file | `tools/test-support` comes from the base. `jest.config.ts` declares no setup files, and adding one is an owned edit |
| Runtime writes by head code in earlier fast-lane steps (`test:unit`, `format:check` plugins, …) | Possible. This is the PR10-SEC-02 class, accepted at PR #10 R2: fast-lane base-ref steps are accident guards, and tamper code is visible to code review |

If the head run were flipped, it would lose only the head-only positive assertions. Every base-expected finding is still enforced in either mode.

### 1.3 Is any head-controlled file still loaded by the base run?

Yes; see the inventory in §4. Everything except `.swcrc` is either owned (record required) or the configuration under test. **`.swcrc` is unowned.** @swc/jest 0.2.39 passes the root file as the transform options. @swc/core then also resolves the **nearest** `.swcrc` upward from each test file. An unowned `tools/.swcrc` with a `jsc.paths` entry can therefore redirect the base suite's `@jest/globals` import (`expect`, `it`, `describe`) to an unowned shim (probe P-2). The PR's claim that "a PR cannot change what its own base run accepts" holds for owned-path edits only (PR17-SEC-01, PR17-SEC-06).

### 1.4 Gate and policy completeness compared with the PR10-SEC-17 patterns

The new entry pins the `if:` and the step `env:`, which is an improvement. However, the `run:` check is a deny-list:
- Jest 30.5.2 accepts `--test-name-pattern`, `--pass-with-no-tests` and `--test-path-ignore-patterns`, which defeat the stated filter ban.
- No-op forms pass: `--listTests`, `--showConfig`, `--onlyChanged`, inline-JSON `--config`, and `|| true`.
- A `shell:` or `working-directory:` override on the gate step passes.

All of these need a `ci.yml` edit (owned), so they sit inside the documented D-TASK007-03 residual. They are recorded as PR17-SEC-03 so that TASK-015 closes them together with PR10-SEC-17 (probes P-1, P-4).

## 2. Probes

All probes live in session scratch (`scratchpad/review/PR-17-sec/scripts/`). Inputs are `git archive ea78d38` copies, run with Node 24 and main's installed `node_modules`.

- **P-1 `policy-reach.mjs`**: the head `checkWorkflow(ci.yml, { requiredGates: true })` on mutated copies of the head `ci.yml`.

  | Case | Result |
  |---|---|
  | C0 (unmodified) | `[]` |
  | C1 (`--testNamePattern`), positive control | `[lint-fixture-mode, required-gates]` |
  | C2 (`-t`), positive control | `[lint-fixture-mode, required-gates]` |
  | C3 (job-level env), positive control | `[lint-fixture-mode]` |
  | K10 (step env `NODE_OPTIONS --require`) | `[node-options-preload]` |
  | K1 `--test-name-pattern` | `[]` |
  | K3 `--test-path-patterns nomatch --pass-with-no-tests` | `[]` |
  | K4 `--listTests` | `[]` |
  | K5 `--onlyChanged` | `[]` |
  | K6 `--showConfig` | `[]` |
  | K7 inline-JSON `--config` with `passWithNoTests` | `[]` |
  | K8 `\|\| true` | `[]` |
  | K9 `shell: 'true {0}'` | `[]` |
  | K11 split-string `$GITHUB_ENV` write | `[]` |
  | K12 `working-directory:` | `[]` |

  K2 (`-tvalue` attached) is not a Jest filter: Jest prints its usage, so the case is moot.
- **P-2 `swcrc-probe.mjs` and `nested-swcrc.cjs`** (@swc/core via main's `node_modules`).
  - With the repo `.swcrc`, the base suite requires `["node:fs","node:path","@jest/globals","../test-support/process.js","./fixture-expectations.mjs"]`.
  - With `jsc.baseUrl` + `jsc.paths {"@jest/globals": [<unowned shim>]}`, it requires `"../../apps/api/src/platform/testing/globals-shim"` instead.
  - Nested lookup, with options passed exactly as @swc/jest passes them (no `swcrc` key): a `tools/.swcrc` applies to `tools/lint/a.test.ts` and wins over a root `.swcrc`. The result is `["../shim"]`. The `swcrc: false` control gives `["@jest/globals"]`.
- **P-3 `subset-probe.mjs`**: the head `noWeakening()` compared with the suite's exact `expectOnly()` logic.

  | Case | Exact | Subset |
  |---|---|---|
  | P1 rule gone | fail | fail |
  | P2 downgraded to warning | fail | fail |
  | P3 PR #11 shape | fail | **pass** (intended) |
  | H1 1:1 same-rule substitution, empty fragment | **pass** | **pass** |
  | H2 substitution + one more same-rule finding | fail | **pass** |
  | H3 bcrypt, `no-restricted-imports` dropped and boundaries ×2 | fail | fail |
  | H4 other policy message | fail | fail |
  | H5 null-rule parse error | fail | fail |
  | H6 ignored-file warning | fail | fail |

  `fixtureMode` gives:
  - unset, `''` and `exact` → `exact`;
  - `no-weakening` → `no-weakening`;
  - `NO-WEAKENING`, `no-weakening ` and `subset` → throw.
- **P-4 Jest flag spellings** (`jest --showConfig --selectProjects unit <flag>`, Jest 30.5.2, main checkout, no test run):
  - `--test-name-pattern kebabzz` → `"testNamePattern": "kebabzz"`;
  - `--pass-with-no-tests` → `"passWithNoTests": true`;
  - `--test-path-ignore-patterns ignzz` → present in every project;
  - `-t=eqzz` → `"testNamePattern": "eqzz"` (already caught by the regex).
- **P-5 lane A log** for run 43308041320, job fast-lane, base-ref step: `PASS unit tools/lint/negative-fixtures.test.ts`, `Tests: 97 passed, 97 total`, step summary `exit 0`.
- **P-6 record check (simulated)**: see §6.

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location (head `ea78d38`) | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR17-SEC-01 | Unowned `.swcrc` files (root and nested, via swc's upward lookup) compile the base-ref suite and every Jest suite; a `jsc.paths` redirect of `@jest/globals` neuters them without a security record | LOW | CWE-693, CWE-284 | A08 | `jest.config.ts:24`; `.swcrc:1-10`; `.github/CODEOWNERS` (no entry); `ci.yml:99-103` (not a LINT_CONTROLS trigger) | devops-engineer | Open |
| PR17-SEC-02 | No-weakening matching is location-blind; 32 of 63 expectations match on rule id alone, and subset semantics also accept a substitution plus extra same-rule findings | LOW | CWE-1023, CWE-693 | A04 | `tools/lint/fixture-expectations.mjs:46-63`; `tools/lint/lint-fixtures.mjs:89, 106-110, 246-250`; case tables `negative-fixtures.test.ts:137-260` | devops-engineer | Open |
| PR17-SEC-03 | The required gate pins presence through a deny-list: Jest's kebab spellings of the banned flags, no-op flags, `\|\| true`, `shell:`/`working-directory:` and split-string `$GITHUB_ENV` writes all pass the checker | LOW | CWE-184, CWE-693 | A08 | `check-workflow-policy.mjs:121-122, 144-151, 590-594, 658-690` | devops-engineer (TASK-015, with PR10-SEC-17) | Open |
| PR17-SEC-04 | The lint-script wiring (the PR2-SEC-01 suppression counter in `npm run lint`) has no no-weakening twin: it is skipped in the base run, so only the owned-path record catches its removal | LOW | CWE-693 | A04 | `negative-fixtures.test.ts:431-439` | devops-engineer | Open |
| PR17-SEC-05 | Untrusted finding text is appended to `$GITHUB_STEP_SUMMARY` inside a fixed three-backtick fence, so a message containing a fence can render arbitrary markdown in the job summary | INFO | CWE-116 | A03 | `negative-fixtures.test.ts:311-318` | devops-engineer (with 02) | Open |
| PR17-SEC-06 | Base-sourcing closure and claim wording: the base run still loads head `jest.config.ts`, `.swcrc`, `tools/deps/npm-cli.mjs` (via base `test-support/process.ts:10`), `tools/lint/resolver.mjs`, `node_modules`, and the configs under test; "a PR cannot change what its own base run accepts" holds for owned-path edits only | INFO | CWE-345 | A08 | `ci.yml:259-276`; `tools/test-support/process.ts:10`; `tools/lint/lint-fixtures.mjs:27-28`; D-TASK007-03 residual text | orchestrator (wording) / devops-engineer | Open |

### PR17-SEC-01: unowned `.swcrc` controls how the base-ref suite is compiled (LOW)

**Description.**
- `jest.config.ts:24` maps every `.ts/.tsx/.js/.jsx` file to `'@swc/jest'` with no inline options. @swc/jest 0.2.39 (`index.js:115-143`) then reads `<cwd>/.swcrc` and hands the whole object to `transformSync` without a `swcrc` key.
- @swc/core therefore also resolves the nearest `.swcrc` upward from each compiled file, and that file takes precedence over the root one (P-2).
- Neither `/.swcrc` nor `**/.swcrc` is in CODEOWNERS or `REQUIRED_CODEOWNED_PATHS`, and `.swcrc` is not a LINT_CONTROLS trigger.
- The CODEOWNERS block "Test, type-check and commit-message configuration (review m4): each can drop or weaken a gate" was meant to cover exactly this class.

**Exploitability and impact.**
- The attack needs two unowned files. One is `tools/.swcrc` (or the root `.swcrc`, or `packages/.swcrc` for `packages/authz` and `packages/audit`) with `jsc.baseUrl` and `jsc.paths {"@jest/globals": [<shim>]}`. The other is a shim that wraps `it`/`expect` to swallow failures.
- Together they neuter the base-ref no-weakening run. They also neuter every other Jest gate in that subtree: the generated RBAC matrix, audit and RLS suites, and the `tools/ci` gate self-tests.
- The security-owned-paths record check is not triggered, so the only remaining backstop is code review.
- Exploitation needs a deliberate author, and the shim is conspicuous in the diff. This is the same exploitability as PR10-SEC-02 and PR10-SEC-16, hence LOW (Impact M × Likelihood L).
- No accidental path to a silent weakening was found. A broken `.swcrc` fails compilation, which is fail-closed.

**Remediation (code level).**
1. In `jest.config.ts`, use `transform: { '^.+\\.(t|j)sx?$': ['@swc/jest', { swcrc: false, jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2023', keepClassNames: true, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' }, sourceMaps: 'inline' }] }`.
   - Inline options stop @swc/jest from reading the root file.
   - `swcrc: false` stops @swc/core's own lookup (P-2 control).
   - The transform configuration then lives only in owned `jest.config.ts`.
2. Delete `.swcrc`, or keep it for editors only, and add `/.swcrc` and `**/.swcrc` to CODEOWNERS and `REQUIRED_CODEOWNED_PATHS`.
3. Add a repository-mode policy rule `swcrc` that fails on any `.swcrc` once it is no longer used. If it is kept, the rule fails on any non-root `.swcrc`.

**Verification test.**
- Build the transformer from the `jest.config.ts` transform entry (`createTransformer(options).process`).
- Compile a file under a temporary `tools/lint/` next to a planted `tools/.swcrc` that maps `@jest/globals` to `./shim`. The output must still `require("@jest/globals")`.
- Add a policy fixture with a nested `.swcrc` (rule fires) and a CODEOWNERS coverage assertion for `.swcrc`.

### PR17-SEC-02: location-blind no-weakening matching (LOW)

**Description.**
- `noWeakening()` matches an expectation on the triple (rule id, severity `error`, message includes fragment).
- The harness emits no line, column or `messageId` (`lint-fixtures.mjs:89, 106-110, 246-250`).
- 32 of the 63 `expectFindings` expectations use the empty fragment `''`:
  - any-justification ×4;
  - audit-writer, no-cycle ×2, money-arith, no-innerhtml ×2, no-tofixed ×4, node-path-only, outbound-http ×4, output-ignores ×3;
  - React ×6;
  - CSS ×4.
- For those 32, any same-rule error anywhere in the fixture satisfies the expectation.
- Exact mode had the same blindness for a 1:1 substitution (P-3 H1). Subset semantics also accept the substitution when the head adds any further same-rule finding (H2: exact fails, subset passes).
- In H1 the substitute is consumed by the match, so nothing appears in the extras summary.

**Exploitability and impact.** Accidental hiding needs a rule change that stops reporting the fixture's target construct while starting to report a different construct, with the same rule id, in the same minimal fixture. That is unlikely; impact is a silently weakened lint mitigation (M × L = LOW). A deliberate change of this kind needs an owned edit, so the record applies.

**Remediation (code level).**
1. `lint-fixtures.mjs` adds `line` and `column` to every finding (`result.messages[i].line/column`; Stylelint `warnings[i].line/column`), plus `messageId` where ESLint provides it.
2. The `Violation` tuple gains the expected line (or `[line, column]`).
3. `noWeakening()` requires a distinct finding at that line.
4. As an alternative for the empty-fragment rows, pin a non-empty message fragment or `messageId`.

The harness and suite come from the base, so the fix protects PRs opened after it merges.

**Verification test.** `fixture-expectations.test.ts`: expected R at line 3 against findings [(R, 7), (R, 9)] must give `missing`, and [(R, 3), (new, 5)] must give `extras: [new]`. A suite assertion checks that every reported finding carries a numeric `line`.

### PR17-SEC-03: the required gate is presence-only through a deny-list (LOW)

**Description.**
- `BASE_LINT_FIXTURES_RUN` forbids `--testNamePattern`, `--testPathIgnorePatterns`, `--passWithNoTests` and `\s-t[\s=]`. Beyond that, it only requires `jest.js "$suite" --selectProjects unit` to appear somewhere in the script.
- These forms all pass `check-workflow-policy` (P-1):
  - Jest 30.5.2's kebab spellings `--test-name-pattern`, `--pass-with-no-tests` and `--test-path-ignore-patterns`, all accepted by Jest (P-4);
  - zero-test exit-0 flags (`--listTests`, `--showConfig`, `--onlyChanged`, `--lastCommit`, `--changedSince`);
  - inline-JSON `--config '{"passWithNoTests":true,…}'`;
  - `|| true` instead of `|| status=$?`, and `exit 0`;
  - `shell: 'true {0}'` and `working-directory:` on the step.
- `lint-fixture-mode` also misses split-string or encoded `$GITHUB_ENV` writes (K11).
- The positional `"$suite"` is a regex, so any test file whose path contains `tools/lint/negative-fixtures?test?ts` (dot = any character) also joins the base run.

**Exploitability and impact.** Every form needs a `ci.yml` edit (owned, record required). That is the residual D-TASK007-03 already documents ("presence, not integrity"). The finding exists because the PR body and the decision describe the ban as complete, and because it is the same pattern-narrowness as PR10-SEC-17.

**Remediation (code level).**
- Pin the base-ref step's `run:` by exact text in the base checker: whitespace-normalised equality with a constant, or a SHA-256 of the normalised script. Any change to the step then needs a reviewed checker change on main first, which is the base-sourcing two-step.
- Use `--runTestsByPath "$suite"` instead of the regex positional.
- In `requiredGateFindings`, forbid `shell:`, `working-directory:` and `timeout-minutes: 0` on required gate steps.
- Track it with PR10-SEC-17 (TASK-015, before TASK-015 adds or refactors workflows).

**Verification test.** Add a policy fixture for each of K1, K3-K9 and K12, each yielding `required-gates`. The unmodified `ci.yml` still yields `[]`.

### PR17-SEC-04: lint-script wiring has no no-weakening twin (LOW)

**Description.**
- The `npm run lint` wiring assertion is `exactOnly`, so it is skipped in the base run, as it was under the old filter.
- Consider a PR that removes `node tools/lint/check-suppressions.mjs` from root `package.json` and also edits the head suite's expectation. It passes:
  - the head run (head suite);
  - the base run (skipped);
  - `npm run lint` (the counter no longer runs).
- After that, inline disables of security rules (PR2-SEC-01, MEDIUM at the time) go undetected again.
- Of the skipped assertions, this is the only one whose subset form is a weakening detector.

**Exploitability and impact.** Both files are owned, so the record catches it (M × L = LOW). The issue is pre-existing, not a regression.

**Remediation (code level).** In no-weakening mode, do not skip the assertion. Instead, require every base-expected step to appear in the head `lint` script, in order. For example, the step matchers `[/^eslint \. .*--max-warnings 0/, /^stylelint .*--max-warnings 0/, /^node tools\/lint\/check-suppressions\.mjs$/]` must match an increasing subsequence of `scripts.lint.split('&&')`. Extra steps are allowed.

**Verification test.** A `lint` script without the counter fails in no-weakening mode. A script with an extra step appended passes in no-weakening mode and fails in exact mode.

### PR17-SEC-05: unescaped finding text in the job summary (INFO)

**Description.** `afterAll` appends `formatExtras()` lines (head rule and plugin messages) between fixed three-backtick fences. A message containing a backtick fence closes the block, so arbitrary markdown can render in the summary, such as a fake "all gates passed" line. The sources are owned rules or locked plugins, and the step's exit status, not the summary, decides the gate.

**Remediation.** Open and close the fence with one more backtick than the longest backtick run in `text` (CommonMark). Alternatively, HTML-escape the text inside `<pre>`. Strip a leading `::` from lines echoed by `console.log`.

**Verification test.** A message containing a fence and a line starting with `::error::` stays inside one fenced block. Assert this on the string that is written.

### PR17-SEC-06: base-sourcing closure and claim wording (INFO)

The base run is not hermetic, and §4 lists what it still loads from the head. Within the accident-guard model accepted at PR10-SEC-02, that is acceptable. Two adjustments are proposed for the orchestrator to log as text (security-analyst does not edit decisions):
- The D-TASK007-03 residual and the `ci.yml` comment "so a PR cannot change what its own base run accepts" should read: "…through the suite, fixtures, harness and modes; the step is an accident guard (PR10-SEC-02): head code that runs earlier in fast-lane, owned configuration (`jest.config.ts`, `tools/deps/npm-cli.mjs`, lint configs and rules, lockfile) and, until PR17-SEC-01 is fixed, unowned `.swcrc` files can still change its outcome."
- Optionally, the step could also restore `tools/deps/npm-cli.mjs` from the base, because base `tools/test-support/process.ts` imports it. It is owned and benign today.

## 4. Head-controlled inputs of the base-ref run (`ea78d38`)

| Input | Owned | LINT_CONTROLS trigger | Role | Note |
|---|---|---|---|---|
| `tools/lint/negative-fixtures.test.ts`, `tests/fixtures/lint/**`, `tools/lint/lint-fixtures.mjs`, `tools/lint/fixture-expectations.mjs`, `tools/test-support/**` | yes | yes | taken from the **base** | removed first, then checked out from `$RANGE_BASE` |
| `eslint.config.mjs`, `stylelint.config.mjs`, `tools/eslint-rules/**`, `tools/stylelint-rules/**`, `.stylelintignore` | yes | yes | configuration under test | intended |
| `tools/lint/resolver.mjs` | yes | yes | under test (imported by `eslint.config.mjs`) and by the base harness | intended |
| `jest.config.ts` | yes | yes | Jest config of the base run | documented residual |
| `.swcrc` (root and any nested, upward lookup) | **no** | **no** | compiles the base suite | PR17-SEC-01 |
| `tools/deps/npm-cli.mjs` | yes | no | imported by base `tools/test-support/process.ts:10` | PR17-SEC-06 |
| root `package.json`, `package-lock.json` → `node_modules` (jest, @swc/*, eslint, stylelint, plugins) | yes | `package.json` only | runtime | documented residual |
| workspace manifests `apps/*/package.json`, `packages/*/package.json` | no | no | data for `@platform/*` resolution | the head exact run executes the identical suite when no trigger path changed |
| runner state written by earlier head-code steps (`$GITHUB_ENV`/`$GITHUB_PATH`, `node_modules`, Jest cache, `.git`) | n/a | n/a | everything | PR10-SEC-02 (accepted: accident guard) |

The LINT_CONTROLS gating is sound. When no trigger path changes, the head suite, fixtures and harness are byte-identical to the base copies, and the head run in `test:unit` executes them with the stricter exact semantics. `.swcrc` and `npm-cli.mjs` affect both runs alike.

## 5. Routing

| Item | Owner | Due |
|---|---|---|
| PR17-SEC-01: inline @swc/jest options with `swcrc: false`; CODEOWNERS and `REQUIRED_CODEOWNED_PATHS` for `/.swcrc` and `**/.swcrc`; repository rule; transformer test | devops-engineer (TASK-007 follow-up or TASK-015) | Before the first Wave-1 feature merge (with PR10-SEC-16/17), because the Wave-1 authz/audit suites rely on it |
| PR17-SEC-02 and PR17-SEC-05: line/column (and `messageId`) in the harness and case tables; fence-safe summary | devops-engineer | With the next change to the fixture harness, at the latest before G3 |
| PR17-SEC-03: exact-text pin of the step, `--runTestsByPath`, `shell`/`working-directory` ban | devops-engineer (TASK-015) | With PR10-SEC-17 |
| PR17-SEC-04: subset wiring check in no-weakening mode | devops-engineer | With PR17-SEC-02 |
| PR17-SEC-06: residual wording in D-TASK007-03 and the `ci.yml` comment | sdlc-orchestrator (logs the text); devops-engineer (comment) | Next DECISIONS update |
| Merge hygiene: `main` changed no security-owned path since `eccdca1` (only `.claude/agent-memory/**`, `docs/**`), so a later merge of `main` does not void this record today. Re-check the overlap if owned paths land on `main` first | sdlc-orchestrator | Before merge |

## 6. Record-check simulation

The check was run with main's `tools/ci/check-security-owned-paths.mjs` (extracted with `git archive origin/main tools/ci`) through its CLI with `--root <clone> --json`. The scratch clone was `git clone --shared --no-checkout` of the main checkout. A branch was made at `ea78d38`, this record was committed on top as a scratch commit, and the clone was removed afterwards. Script: `scratchpad/review/PR-17-sec/scripts/record-sim.sh`.

| Run | Status | Exit |
|---|---|---|
| Control A: record not committed (head `ea78d38`), `--base 8d421f8 --pr 17` | `missing`: "no record named …/PR-0017-*.md for PR #17" | 1 |
| Record committed on top of `ea78d38`, `--base 8d421f8 --pr 17` | `pass`: 10 owned paths, satisfied by this record naming `ea78d38b8d52b45dd1356c5f3c75034d967b8b56`, no notes | 0 |
| Same, `--base eccdca1` (merge base) `--pr 17` | `pass`: same binding | 0 |
| Control B: same tree, `--pr 18` | `missing` | 1 |

The parser's view of this file:
- `recordVerdict` is `PASS_WITH_FOLLOW-UPS`;
- `recordHeadShas` is `["ea78d38b8d52b45dd1356c5f3c75034d967b8b56"]`;
- there is exactly one `Verdict` table row.

## Round 2 (head 8dd1d24)

| Field | Value |
|---|---|
| Delta | `ea78d38..8dd1d24`: 1 commit, `ci(lint): fail ruleless findings and pin the base-ref fixture gate`, 13 files (+827 / −201). Merge base still `eccdca1`. `git ls-remote` confirms `8dd1d24` is the pushed head of `fix/ci-base-fixture-subset` and `refs/pull/17/head` |
| Head | 8dd1d24dc525954c2fd443496482901340bf69a6 |
| Scope | The fix-cycle-1 delta: `jest.config.ts` (inline `SWC_JEST_OPTIONS`), `.swcrc` (deleted), `.github/CODEOWNERS`, `tools/lint/jest.base-fixtures.config.json` (new), `.github/workflows/ci.yml` (base-ref step), `tools/ci/check-workflow-policy.mjs` (pinned step, gate step/env/defaults bans, `swcrc` rule, `findFilesNamed`), `tools/lint/fixture-expectations.mjs`, `tools/lint/negative-fixtures.test.ts`, the four test files, `tests/fixtures/lint/README.md`. Decision in scope: D-TASK007-04 |
| Lane A evidence | Run [43316597810](https://github.com/sukhchdit/shipcube/actions/runs/43316597810) on `8dd1d24`. fast-lane `success`: 63 suites and 1680 tests, including `PASS unit tools/ci/jest-transform.test.ts`. The base-ref step printed `PASS base-lint-fixtures tools/lint/negative-fixtures.test.ts`, 97/97, under the head copy of the new config (bootstrap: main has no config yet). scans failed only on "Security-owned paths need a review record"; ci-gate red as a consequence |
| Reviewer / date | security-analyst, 2026-11-13. Read-only: no `npm ci`, no build, no Docker, no project test suite. Probes ran from session scratch against `git archive 8dd1d24` copies with main's installed `node_modules`. They included one Jest run of a single synthetic test in a scratch directory (P-7) and bash runs of extracted step scripts with stubbed `git`/`node` in an empty scratch sandbox (P-3). No command was run in the PR worktree |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding; merge rule met for `8dd1d24`. **Closed:** PR17-SEC-01, -03, -04, -05, -06. **Open:** PR17-SEC-02 (LOW, routed to TASK-015 in the fix comment) and four new LOW findings, none a merge blocker. PR17-SEC-07 (a folded-scalar parser differential) and PR17-SEC-08 (job/workflow-level `BASH_ENV`/`PATH`) defeat the new pin, but only through owned `ci.yml` edits. PR17-SEC-09 is a pre-existing Jest mechanism of the PR17-SEC-01 class (unowned `__mocks__`). PR17-SEC-10 is the residual of -04 |

### R2.1 Closure of the round-1 findings

| ID | R1 severity | Status | Evidence |
|---|---|---|---|
| PR17-SEC-01 | LOW | **Closed** | The inline options carry `swcrc: false` in `jest.config.ts:21-31` and in the base JSON config, and the two are equal. Against a planted root `.swcrc` and `tools/.swcrc` that map `@jest/globals` to a shim, both compile to `require("@jest/globals")`. Positive controls without the `swcrc` key, or with no options, compile to the shim (P-4). The root `.swcrc` is deleted. `/.swcrc` and `**/.swcrc` are in CODEOWNERS and `REQUIRED_CODEOWNED_PATHS`. The repository rule `swcrc` flags a root and a nested file and skips `node_modules` (P-5). `jest-transform.test.ts` passed in lane A |
| PR17-SEC-02 | LOW | Open (not in this cycle) | Unchanged: substitution plus an extra same-rule finding still passes (P-6 W8). Routed to TASK-015 |
| PR17-SEC-03 | LOW | **Closed** | Every R1 vector now fails the head checker (P-1): K1-K8 give `lint-fixture-mode` + `required-gates`, K9/K12 `required-gates`, K10 `node-options-preload` + `required-gates`, K11 `lint-fixture-mode`. The run is an exact allow-list with `--runTestsByPath` and an `exit "$status"` tail. Step `shell:`/`working-directory:`, extra step env and workflow/job `defaults.run` fail (N6-N8). Trailing whitespace after a continuation passes the pin but fails closed in bash (N4 → exit 1, P-3). Residuals of the same class: PR17-SEC-07, PR17-SEC-08 |
| PR17-SEC-04 | LOW | **Closed** | The wiring check now runs in the base run. In no-weakening mode the base steps must appear as an ordered subsequence: a removed or reordered counter fails (P-6 S1, S2). Residual (matcher-shaped neutering): PR17-SEC-10 |
| PR17-SEC-05 | INFO | **Closed** | The fence is one backtick longer than the longest run in the text, so a planted fence stays inside the block. The list is capped at 200 lines plus a "more" line. `logText` splits leading `::` (also indented) (P-6 M1, M3, L1). Residual note, no new ID: `logText` splits on `\n` only, while the runner reads lines with `ReadLine` (CR also ends a line), so `x\r::error::y` still yields a workflow command (L2). The sources are owned rules and locked plugins, and Jest's own failure diff is not escaped either; fold it into the PR17-SEC-02 harness change |
| PR17-SEC-06 | INFO | **Closed** | The `ci.yml` comment, the module JSDoc and D-TASK007-04 now state the residual: accident guard, head code earlier in fast-lane, job-level env, and owned configuration named. Supplementary wording for PR17-SEC-07/08 is in R2.5 |

Other delta changes, checked for weakening:
- Null-rule findings now fail in no-weakening mode (P-6 W2, W4).
- The severity floor works: a warning fails an `error` case, and an error satisfies a `warning` case (W5-W7).
- Clean fixtures now run in both modes.
- These assertions moved to `exactOnly`: the ignore map's `true` half, the hasher's bcrypt exemption, and the `off` entries for `packages/ui` and `i18next` in tests. Each is an exception or exemption, so tightening it is strengthening. The weakening halves stay unskipped (source paths still linted; `error` levels; the bcrypt pattern elsewhere).
- `cache: false` in the base config means the base run no longer reads the transform cache that the head `test:unit` run wrote earlier in the job. That closes one PR10-SEC-02-class lever.

**Nested-checkout skip in `findFilesNamed` (orchestrator question).** A PR cannot exploit it.
- Git rejects any `.git` path component, case-insensitively, in the index (`Invalid path 'sub/.git'`, also for `.GIT`).
- On checkout, a hand-crafted tree with a `.git` entry gives `error: invalid path 'sub/.git'`, and `fsck` reports `hasDotgit` (P-5).
- The Workflow policy step runs right after checkout, setup-node and the classifier, before any head code. So nothing can plant a `.git` at run time.
- Gitlinks are checked out as empty directories, because `submodules` is not set.
- Symlinked directories are never walked (`Dirent.isDirectory()` is false), and with `swcrc: false` a `.swcrc` behind one is inert anyway.

**`swcrc` rule completeness.** swc reads only `.swcrc` (exact name, case-sensitive on the runner). Since `swcrc: false` makes every `.swcrc` inert, the rule and the CODEOWNERS lines are defence in depth (P-5 P3).

**Base-sourced Jest config.** `tools/lint/jest.base-fixtures.config.json` comes from the base on every PR after this one. This PR's own run used the head copy (bootstrap), which is the reviewed content.
- The config has no `setupFiles`, filters or `passWithNoTests`, and `ci-policy.test.ts` pins its key set.
- Its `roots` is `tools/lint` (owned), so a manual mock planted there needs a record. The same mechanism outside owned paths is PR17-SEC-09.
- A head deletion of the config fails the step at the closing `git checkout HEAD -- … "$config"` (fail-closed).

### R2.2 Probes (scratchpad `review/PR-17-sec-r2/scripts/`)

- **P-1 `policy-reach-r2.mjs`, `extra-env.mjs`**: the head `checkWorkflow(ci.yml, { requiredGates: true })` on mutated copies of the head `ci.yml`.

  | Case | Findings |
  |---|---|
  | C0 unmodified | `[]` |
  | K1-K8, N1 (`exit 0`), N3 (comment ending in `\`, then `exit 0`), N5 (blank after continuation) | `lint-fixture-mode`, `required-gates` |
  | K9, K12, N6 (step `BASH_ENV`), N7 (workflow `defaults.run`), N8 (job `defaults.run`) | `required-gates` |
  | K11 split-string `$GITHUB_ENV` write | `lint-fixture-mode` |
  | N9 lone CR, N10 NEL in a comment line | `yaml-subset` |
  | N2 comment-only line (inert) | `[]` (intended) |
  | N4 trailing spaces after `jest.js \` | `[]`; fails closed in bash (P-3) |
  | N11 run rewritten as `run: >` | `[]` (see P-2) |
  | R1 job env `BASH_ENV`, R2 workflow env `BASH_ENV`, R3 job env `PATH`, R4 job env `BASH_FUNC_node%%`, R5 earlier step writes `BASH_ENV` to `$GITHUB_ENV`, R6 earlier step appends to `$GITHUB_PATH`, R7 job `RANGE_BASE` = head SHA, R8 `BASH_ENV` on the unit-test gate step | `[]` each (PR17-SEC-08) |
  | R9 positive control, workflow env `LINT_FIXTURE_MODE` | `lint-fixture-mode` |

- **P-2 `folded-diff.mjs`**: the base-ref step's run rewritten as a folded scalar, parsed by `yaml-subset.mjs` and by a spec-compliant parser (eemeli/yaml 2.9.1 from main's `node_modules`, standing in for GitHub's YamlDotNet and actionlint's yaml.v3).

  | Variant | `checkWorkflow` | yaml-subset `commandLines` equal to the pin | Spec-parser script |
  |---|---|---|---|
  | F0 folded, nothing injected | `[]` | yes | blank lines after the two continuations (fails closed, P-3) |
  | F1 a comment line, then a more-indented `exit 0` after `set -euo pipefail` | `[]` | yes | line 3 is `  exit 0` |
  | F2 the same with `[ -n "${GITHUB_ACTIONS:-}" ] && exit 0` (reachable code after it, so no shellcheck SC2317) | `[]` | yes | line 3 is the conditional exit |

  On the YAML 1.2 Example 8.10 shape, the spec parser gives `"folded line\nnext line\n  * bullet\n\n  * list\nlast\n"` and yaml-subset gives `"folded line\nnext line  * bullet\n  * list last\n"`.
- **P-3 `bash-exec.sh`** (`bash --noprofile --norc -eo pipefail`, stub `node` exits 1 to model a weakened config):

  | Script | Exit | Jest invoked |
  |---|---|---|
  | control (literal step) | 1 | yes, with `--config … --runTestsByPath …` |
  | F0 | 1 | yes, without arguments (broken continuation) |
  | F1 | **0** | no |
  | F2 (`GITHUB_ACTIONS=true`) | **0** | no |
  | N4 | 1 | yes, with a single-space argument |
  | control + `BASH_ENV` defining `node()` | **0** | the function, not Jest |

- **P-4 `swcrc-r2.cjs`**: @swc/jest 0.2.39 `createTransformer(options).process` with a planted root and nested `.swcrc`. Inline and base-JSON options give `["@jest/globals"]`. Controls give `["../shim"]` without the `swcrc` key and `["../../shim"]` with no options (`<cwd>/.swcrc` read).
- **P-5 `swcrc-rule.mjs`** plus git path checks.
  - The `swcrc` rule reports `.swcrc` and `apps/web/app/.swcrc`. It skips `node_modules/x/.swcrc` and `tools/nested/.swcrc` (the `tools/nested` directory has a `.git` file), and ignores `.SWCRC` and `swcrc.json`.
  - Git refuses the paths `sub/.git`, `sub/.GIT`, `sub/.git/config` and `.git/hooks/x`. A crafted tree is flagged `hasDotgit`, and its checkout is refused.
- **P-6 `expectations-r2.mjs`**: the head `noWeakening`, `missingSteps`, `summaryMarkdown` and `logText` (cases quoted in R2.1 and PR17-SEC-10).
- **P-7 Jest manual mocks** (main's Jest 30.5.2, scratch project, `roots: ["<rootDir>/src"]`, one test):
  - `src/unowned-app/__mocks__/jose.js` and `__mocks__/@platform/authz.js` replace `require('jose')` and `require('@platform/authz')` in an unrelated suite with no `jest.mock` call (`MOCK jose`, `MOCK @platform/authz`).
  - With `modulePathIgnorePatterns: ["/__mocks__/"]`, the real modules are resolved.
  - Source: `jest-runtime/build/index.js:296-303`. For a bare specifier that is not a haste module, a manual mock found anywhere in `roots` is used.

### R2.3 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Location (head `8dd1d24`) | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR17-SEC-07 | yaml-subset folds more-indented lines differently from GitHub, so a `run: >` rewrite with a comment carrier hides commands from the pinned-step comparison | LOW | CWE-436, CWE-693 | A08 | `tools/ci/yaml-subset.mjs:222-230` (`foldLines`), `:189-219`; `tools/ci/check-workflow-policy.mjs:166-185` (comment lines dropped) | devops-engineer (TASK-015, with PR10-SEC-17/19) | Open |
| PR17-SEC-08 | Workflow/job-level `BASH_ENV`, `PATH`, `BASH_FUNC_*` and earlier-step `$GITHUB_ENV`/`$GITHUB_PATH` writes reach every gate step; the exact-env rule covers the step env of gates that declare one | LOW | CWE-184, CWE-693 | A08 | `check-workflow-policy.mjs:75` (`FORBIDDEN_ENV`), `:296-318`, `:784-803`; `ci.yml:61-65` | devops-engineer (TASK-015, with PR10-SEC-17) | Open |
| PR17-SEC-09 | Jest uses any `__mocks__/<pkg>` file under `roots` as the module for a bare `require('<pkg>')` in every suite, without `jest.mock`; `**/__mocks__/` is unowned and unchecked | LOW | CWE-427, CWE-693 | A08 | `jest.config.ts:38, 46`; `.github/CODEOWNERS` (no entry); jest-runtime 30.5.2 `build/index.js:296-303` | devops-engineer | Open |
| PR17-SEC-10 | Lint-script step matchers are prefix regexes: `\|\| true`, `; true` or extra flags inside a matched step pass both modes, and in no-weakening mode an inserted `cd …` or `export NODE_OPTIONS=…` step before the base steps also passes | LOW | CWE-1023, CWE-693 | A04 | `tools/lint/negative-fixtures.test.ts:267-271, 481-486`; `tools/lint/fixture-expectations.mjs:98-108` | devops-engineer (with PR17-SEC-02) | Open |

#### PR17-SEC-07: folded-scalar differential defeats the pinned step (LOW)

**Description.**
- `foldLines` appends a whitespace-leading ("more-indented") line to the previous line with no separator. It also folds a single empty line to one newline even next to more-indented lines.
- YAML 1.2 §6.5 and §8.1.3, which GitHub's parser, actionlint's parser and eemeli/yaml all follow, keep the line breaks around more-indented lines.
- So in a `run: >` block, the text `# note` followed by `  exit 0` is one comment line for yaml-subset. `commandLines` drops it, and the comparison with `BASE_LINT_FIXTURES_SCRIPT` still passes (P-2 F1, F2). GitHub hands bash `# note\n  exit 0`, and the step exits 0 before Jest (P-3).
- The blank lines that make yaml-subset produce one command per line break the two continuations in the spec view (F0). That does not matter once the injected exit has run.
- Correction: my PR-0010 statement that "folded scalars are understood (probe)" did not cover more-indented lines.

**Exploitability and impact.**
- The edit is to `ci.yml`, which is owned, so the record requirement applies. The rewrite is conspicuous in the diff: every command line is followed by a blank line under `run: >`.
- actionlint runs on the spec view. F2 avoids unreachable-code warnings, and comment lines, including shellcheck directives, are free under the pin. Whether shellcheck would flag the broken continuations was not verified (no Docker).
- Impact: the base-ref no-weakening gate is silently skipped (M × L = LOW).
- The same differential affects every yaml-subset consumer that relies on line structure. `check-install-flags` reads raw text and is not affected.

**Remediation (code level).**
1. In `yaml-subset.mjs`, fail closed: inside a `>` block scalar, throw `YamlSubsetError('folded scalar with a more-indented or empty line is not supported')` when any content line starts with whitespace or is empty. The repository uses `>`/`>-` only for single-level `if:` expressions.
   - Alternatively, port libyaml's `leading_break`/`trailing_breaks`/`leading_blank` folding exactly.
2. In `requiredGateFindings`, require the pinned step's raw `run:` line to end in `|` (from the parser's `lines` map).
3. Optional: reject comment-only lines in the pinned run, and move the documentation comments above the step.

**Verification test.** In `yaml-subset.test.ts`, the Example 8.10 shape either throws or equals the spec string. In `check-workflow-policy.test.ts`, the F1 and F2 mutations of `ci.yml` yield `yaml-subset` or `required-gates`, and F0 yields `required-gates`.

#### PR17-SEC-08: environment that reaches every gate step (LOW)

**Description.**
- `BASH_ENV` is sourced by GitHub's `bash --noprofile --norc -eo pipefail`. Set at workflow or job level, it can define `node()`, `npm()` or `git()` functions that replace the gate commands. P-3 shows the pinned step exiting 0 with the stub "weakened" `node` shadowed.
- `PATH` and exported functions (`BASH_FUNC_name%%`) do the same.
- So does an earlier `ci.yml` step that writes `BASH_ENV=` to `$GITHUB_ENV` or a directory to `$GITHUB_PATH`. The runner refuses only `NODE_OPTIONS` from `$GITHUB_ENV`.
- The fix comment names `BASH_ENV` and `PATH` as the reason for the exact step env, but only the step level is checked, and only for gates with an `env` entry (R8).
- The job `RANGE_BASE` expression (R7) is the input-sourcing part of PR10-SEC-17.
- D-TASK007-04 lists "job-level env" as residual. This finding makes the residual concrete.

**Exploitability and impact.** It needs an owned `ci.yml` edit (record required), or head code in an earlier step (accepted PR10-SEC-02 class). It affects all 21 required gates, not only this step (M × L = LOW).

**Remediation (code level).**
1. Add `BASH_ENV`, `ENV`, `PATH`, `SHELLOPTS`, `BASHOPTS`, `PS4`, `IFS` and the pattern `^BASH_FUNC_` to `FORBIDDEN_ENV`. `envEntryFindings` already runs on workflow, job, step and container `env`.
2. In `scriptFindings`, flag any write to `$GITHUB_PATH`, and any `$GITHUB_ENV` write whose name is not on an allow-list (`CODE`, `LINT_CONTROLS`, `GATE_*`, `RECORD_MODE`, `GATES_DIR`), or whose name is computed.
3. Pin the `fast-lane` and `scans` job `env` values of `RANGE_BASE`/`RANGE_HEAD`.
4. Apply the exact step-env rule to every gate, with an empty allow-list when `gate.env` is undefined.

**Verification test.** Each of P-1 R1-R8 yields a finding, and the unmodified `ci.yml` stays `[]`.

#### PR17-SEC-09: unowned Jest manual mocks (LOW)

**Description.**
- In jest-runtime 30.5.2, `requireModule` uses a manual mock for any bare specifier that is not a haste module, without a `jest.mock` call. The haste map registers every `__mocks__/<name>` file under `roots` (P-7). This is Jest's documented "node module mocks adjacent to node_modules are automatic" behaviour, but it applies to every `__mocks__` folder in `roots`.
- The unit, integration and api projects use `roots` `apps`, `packages`, `prisma`, `tests` and `tools`.
- So an unowned `apps/web/app/__mocks__/@platform/authz.ts` or `…/__mocks__/pg.ts` would replace `@platform/authz` or `pg` in every suite that imports them by name. That includes the Wave-1 RBAC-matrix, audit and RLS suites, and the security-owned-paths record does not trigger.
- The base-ref run is not exposed: its only root is `tools/lint` (owned).
- There are no `__mocks__` folders on main or in the head, so a ban costs nothing today.

**Exploitability and impact.** This is the PR17-SEC-01 class: a deliberate, conspicuous, unowned file that neuters test gates but not runtime code (M × L = LOW).

**Remediation (code level).**
1. In `jest.config.ts` `common`, set `modulePathIgnorePatterns: ['<rootDir>/.*/dist/', '<rootDir>/.*/build/', '/__mocks__/']`. Suites use `jest.mock(name, factory)` instead.
2. Add the same entry to `tools/lint/jest.base-fixtures.config.json`, and update the key allow-list in `ci-policy.test.ts`.
3. Add `**/__mocks__/` to CODEOWNERS and `REQUIRED_CODEOWNED_PATHS`, plus a repository rule `jest-manual-mocks` that rejects any `__mocks__` directory.
4. While touching the rule, also reject tracked paths with a `node_modules/` segment. Nearest-`node_modules` resolution is the sibling lever; it was not probed.

**Verification test.** A transformer-style test that plants `<tmp>/apps/x/__mocks__/<pkg>.js` and runs `jest.config.ts`'s module resolution, or the P-7 shape, gets the real module. A policy fixture with a `__mocks__` directory yields `jest-manual-mocks`.

#### PR17-SEC-10: lint-script step matchers are prefix regexes (LOW)

**Description.**
- `LINT_STEPS` matches `^eslint \. .*--max-warnings 0` and `^stylelint .*--max-warnings 0` with no end anchor, and the exact mode reuses the same regexes.
- So `eslint . --max-warnings 0 || true`, `… --rule x; true` and `eslint . --no-config-lookup --max-warnings 0` pass both modes (P-6 S4, S5, S8).
- The no-weakening subsequence also accepts a prefix step that changes shell state for the later ones, for example `cd tests/fixtures/empty && …` or `export NODE_OPTIONS=--require=… && …` (S6, S7: subset passes, exact fails).
- The exact mode in the head run is head-controlled, so the base run decides.

**Exploitability and impact.** Root `package.json` is owned (record required). The counter is the PR2-SEC-01 control (M × L = LOW).

**Remediation (code level).**
1. Anchor full-step matchers: `^eslint \. --max-warnings 0$`, `^stylelint "\*\*/\*\.css" --max-warnings 0 --allow-empty-input$` and `^node tools\/lint\/check-suppressions\.mjs$`.
2. Reject `;`, `|`, `&`, `$(`, backticks, `<` and `>` in any step.
3. In no-weakening mode, allow extra steps only after the last base step.

**Verification test.** S4-S8 fail in both modes; S3 (appended step) passes in no-weakening mode and fails in exact mode.

### R2.4 Head-controlled inputs of the base-ref run (changes from §4)

| Input | R2 status |
|---|---|
| `jest.config.ts` | No longer loaded by the base run. Jest runs `--config tools/lint/jest.base-fixtures.config.json`, a base copy (head copy only in this PR's bootstrap run) |
| `.swcrc` (any depth) | Inert (`swcrc: false`), owned, rejected by the `swcrc` rule |
| Jest transform cache written by the head `test:unit` run | Not read (`cache: false`) |
| Manual mocks under `roots` (`tools/lint/**/__mocks__`) | Owned (`/tools/lint/`). Outside `tools/lint`: PR17-SEC-09 (head runs only) |
| Step text, `if:`, step env, `shell`, `working-directory`, `defaults.run` | Pinned or banned. Folded-scalar bypass: PR17-SEC-07 |
| Workflow/job env, earlier-step `$GITHUB_ENV`/`$GITHUB_PATH` writes, `RANGE_BASE`, the classifier | PR17-SEC-08 / PR10-SEC-17 |
| `tools/deps/npm-cli.mjs`, lint configs and rules, `tools/lint/resolver.mjs`, lockfile and `node_modules`, runner state from earlier head-code steps | Unchanged (owned, or PR10-SEC-02 accepted) |

### R2.5 Routing

| Item | Owner | Due |
|---|---|---|
| PR17-SEC-07: fail-closed folded scalars in yaml-subset; literal `run: \|` for pinned steps; F0-F2 fixtures | devops-engineer (TASK-015, with PR10-SEC-17/19) | Before any further gate is pinned, and at the latest with TASK-015 |
| PR17-SEC-08: forbidden shell-environment names at every env level; `$GITHUB_ENV`/`$GITHUB_PATH` write allow-list; `RANGE_*` pin; exact env on every gate | devops-engineer (TASK-015, with PR10-SEC-17) | With TASK-015 |
| PR17-SEC-09: ignore `/__mocks__/` in both Jest configs; CODEOWNERS and repository rule; test | devops-engineer | Before the first Wave-1 feature merge (the due date PR17-SEC-01 carried) |
| PR17-SEC-10, PR17-SEC-02 and the PR17-SEC-05 CR note | devops-engineer (TASK-015) | With the next fixture-harness change, at the latest before G3 |
| Supplementary D-TASK007-04 residual text (security-analyst does not edit decisions): "…; until PR17-SEC-07/08 are fixed, owned `ci.yml` edits can still bypass the pin: a folded `run: >` rewrite (yaml-subset folds more-indented lines differently from GitHub) and workflow/job-level `BASH_ENV`/`PATH`/`BASH_FUNC_*` or an earlier step's `$GITHUB_ENV`/`$GITHUB_PATH` write" | sdlc-orchestrator | Next DECISIONS update |
| Merge hygiene: `main` (`9bbcb77`, checked 2026-11-13) changed no security-owned path since `eccdca1` (only `docs/**` and `.claude/agent-memory/**`), so the owned-path overlap with the PR is empty and a merge of `main` does not void this record. Re-check if owned paths land on `main` first | sdlc-orchestrator | Before merge |

### R2.6 Record-check simulation

The check was run with main's `tools/ci/check-security-owned-paths.mjs` (`git archive origin/main tools/ci`, main at `9bbcb77`) through its CLI with `--root <clone> --json`.
- The scratch clone was `git clone --shared --no-checkout` of the main checkout.
- A branch was made at `8dd1d24`, this record (R1 + R2) was committed on top as a scratch commit, and the clone was removed afterwards.
- Script: `scratchpad/review/PR-17-sec-r2/scripts/record-sim.sh`.

| Run | Status | Exit |
|---|---|---|
| Control A: no record in the PR tree (head `8dd1d24`), `--base 9bbcb77 --pr 17` | `missing`: "no record named …/PR-0017-*.md for PR #17" | 1 |
| Record committed on top of `8dd1d24`, `--base 9bbcb77 --pr 17` | `pass`: 15 owned paths, satisfied by this record naming `8dd1d24dc525954c2fd443496482901340bf69a6`. Note: the R1 head row `ea78d38` is followed by owned changes | 0 |
| Same, `--base eccdca1` (merge base) `--pr 17` | `pass`: same binding and note | 0 |
| Control B: same tree, `--pr 18` | `missing` | 1 |
| Control C: main's R1-only record on top of `8dd1d24`, `--pr 17` | `missing`: R1 names only `ea78d38`, and owned paths changed after it | 1 |

The parser's view of this file:
- `recordVerdict` is `PASS_WITH_FOLLOW-UPS`;
- `recordHeadShas` is `["ea78d38…", "8dd1d24…"]` (both rounds, PR10-SEC-21);
- there are two `Verdict` rows, and the R2 row is the last;
- the only rows whose first cell starts with `Head` are the two real head rows.
