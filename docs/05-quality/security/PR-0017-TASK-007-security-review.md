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
