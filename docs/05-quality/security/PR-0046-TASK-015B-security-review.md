# PR-0046 / TASK-015 part 015-B: lane C and nightly workflows, `security-integration`, gitleaks-full runner, C-1 deletion, ci:minutes (round 1)

| Field | Value |
|---|---|
| PR | #46 `ci(lane-c): lane C and nightly workflows, security-integration job, ci:minutes and SPK-07`, https://github.com/sukhchdit/shipcube/pull/46, branch `feat/TASK-015-b-lane-c-nightly`. Code commits `44c4def`, `bc4a75b`, `6a1ac5c`, `9fd3b4d`, `8d83468` (C-1 deletion), docs `9eee00f`, merges of `main` `746a830` and `fa8f6e2` (union with `9ce5dcf`, PR #44), evidence commits `41c7856` and `12ea6a6`. Merge base `9ce5dcf`. `main` has since moved to `47f942d` (`docs/sdlc/DECISIONS.md` and `STATUS.md` only; no owned path) |
| Head | 12ea6a6647ad3b9e7aae48adfb24f37c0f428856 |
| Lane A evidence | Run [43590778652](https://github.com/sukhchdit/shipcube/actions/runs/43590778652) on `12ea6a6` (`RANGE_BASE` `9ce5dcf`). `fast-lane` **success**; `security-integration` **success** (`catalog-c1-c14` 102/102, 4 files); `scans`: classifier `security_paths=true (1 security-critical path(s) changed)` from the head's git objects (bootstrap: `main` has no `security-paths.mjs` yet), gitleaks range, Semgrep and oasdiff pass, the only failed step is "Security-owned paths need a review record" (33 owned paths); `ci-gate` fails for that reason alone. Base-ref `check-evidence`: **PASS**, run `20261114T1124Z_fa8f6e2` accepted, `20261114T1017Z_8d83468` rejected as stale (94 paths changed since `8d83468`), every older run rejected (not an ancestor of the head, or declared PASS but recomputed FAIL) |
| Lane B evidence | `docs/05-quality/tests/runs/20261114T1124Z_fa8f6e2`, profile `pr`, verdict PASS: unit 4784 (2 skip), integration 278, api 124, catalog-c1-c14 102; `git_sha` `fa8f6e2`, `fa8f6e2..12ea6a6` is the evidence commit only. The superseded pre-union run `20261114T1017Z_8d83468` (profile `pr`, PASS) is committed too. No lockfile change |
| Owned paths changed | 33 (main's real checker, §9; equals the lane A record step): `.github/workflows/{ci,lane-c,nightly}.yml`, `eslint.config.mjs`, `package.json`, `prisma/tests/spikes/spk03-rls-tx.int.test.ts` (deleted), `tools/ci/**` (17, of which 7 policy fixtures), `tools/deps/{rebuild.mjs,rebuild-playwright.test.ts}`, `tools/quality/**` (8: gitleaks-full runner and tests, heavy, inventory, suite-runners.json). Not owned: `tests/e2e/playwright.config.ts`, the docs (`SPK-03.md`, `SPK-07.md`, `ADR-0005`, `CI-CD.md`) and the run directories |
| Reviewer / date | security-analyst, 2026-11-14, round 1. Read-only on the PR worktree (no file but this record written; `git status` clean before writing). Probes ran from session scratch: the head's `checkWorkflow` on 40 workflow mutants, the head's `rebuild.mjs` / `security-integration.mjs` / `check-evidence.mjs` exports in-process, `npm exec --no -- playwright install --dry-run` (prints URLs, downloads nothing), ESLint `--print-config` in the worktree and in the main checkout, the PR's 10 tool test files (266/266), the real gitleaks image under the shared Docker lock (§5.3), and main's record checker in a scratch `git clone --shared` (§9). No workflow was triggered |

## 1. Summary

015-B does what D-TASK015-33..49 say, and the controls the brief asked about hold:

- **Workflows.** `lane-c.yml` and `nightly.yml` have exactly one trigger (`workflow_dispatch`), `contents: read` at workflow and job level (`{}` on the aggregate), no secrets, `persist-credentials: false` everywhere, every action pinned by a full SHA (the two new pins, `upload-artifact` v7.0.2 `cf430e0` and `download-artifact` v8.0.2 `9000827`, equal the upstream tags and are 38 days old), every image by digest (Checkov 3.4.3 and Terraform 1.17.1 digests equal Docker Hub's, both older than the 7-day cooldown). No `pull_request_target`, `workflow_run` or comment trigger. Lane C has no `ref` input (D-TASK015-34): every job checks out `GITHUB_SHA`, the dispatched SHA. No `docker push`, `npm publish`, `terraform apply/destroy`, AWS role or `id-token: write` (D-TASK015-35); the policy catches 7 of my 10 release-form mutants for the two files (L7-L11, L17, N4; §5.1), and the three it misses are PR46-SEC-04. Dispatch inputs reach scripts only through `env:`; `since` is validated (`^[0-9a-f]{7,40}$`) before use, `webkit_repeat_each` by a `1|5` case.
- **`security-integration` (D-TASK015-36/37).** The trigger list is the BASE ref's `security-paths.mjs` (`$GATE_SECURITY_PATHS` from the base `tools/ci`, the head's git objects only while `main` lacks the file); it writes only `security_paths=true|false` to `$GITHUB_OUTPUT` (no file names), diffs `base...head` with `--no-renames -z --ignore-submodules=none`, and fails closed (`true`) on an unknown base or a git error. The job reads the base ref's manifest and runners, fails closed with zero active suites, and `ci-gate` treats a skipped job as green only when the classifier said `false` (an empty output, e.g. a removed or crashing classifier step, fails `ci-gate`). The base-ref policy now requires `ci-gate` to need the job. A PR cannot edit the path list to skip itself. Residuals: the job runs PR lockfile packages before lane A's supply-chain gates (PR46-SEC-01, LOW), and `required-gates` pins none of the new chain except the `needs` entry (PR46-SEC-03, LOW).
- **gitleaks-full runner (PR33-SEC-08 and the runner half of PR25-SEC-01: closed).** Config and baseline come from `--ref` through `git show` after `rev-parse --verify --end-of-options`; it is the same `.gitleaks.toml` lane A reads from the base ref (D-SEC-PR45-01); every baseline line is validated against the sec-static regex with the exact count 17 and no duplicate before anything is mounted; only the validated lines are written, into a private `mkdtemp` directory, mounted read-only; `.git` (common dir) read-only, no working tree, `--network none`, `--ignore-gitleaks-allow`, `--redact`, ancestry of one full SHA. Real image: 17 lines 0 findings, 16 lines exactly the dropped fingerprint, a shifted line exactly that one, no baseline all 17 (§5.3). Lane A still never loads the baseline (unchanged step; sec-static pin). Residuals INFO (PR46-SEC-10).
- **C-1 deletion.** Commit `8d83468` removes the spike file, its exact-file `TENANT_CONTEXT_EXEMPTIONS` entry and the one-off ci.yml C-1 steps together. No exemption lingers: `eslint.config.mjs` has no `spikes` entry left, and the effective `platform/tenant-context-sql` options for the old path go from `allow: [setter, keys, session-set, session-set-config, unicode-escape]` on `main` to bare `error` on the head (same as any other spikes file); `session-scope-leak.int.test.ts` keeps its entry. The removal only tightens.
- **`{base}`, inventory, ci:minutes.** No injection: `{base}` is substituted into an argv array spawned without a shell, and gitleaks-full resolves it with `--end-of-options`; inventory validates `--since`, passes SHAs as single argv elements and reads committed run files only; ci:minutes validates `--repo`/`--month`, uses `gh api` auth and never reads or prints a token.
- **Checkov `CKV_GHA_7` skip (D-TASK015-43).** Justified for these two files (choice inputs and a validated SHA select checks; nothing is built for publication from a dispatch). It is global, though, and the no-release rule is keyed on file names, so a future `release.yml` (or a renamed `lane-c.yaml`) with dispatch inputs and a push passes both (PR46-SEC-04, LOW).
- **Playwright install scope (PR4-SEC-08 residual).** Browser installs and `--with-deps` appear only in lane C `e2e-stack` through `deps:rebuild`; the policy confines them. The new redirect refusal in `rebuild.mjs` misses the `npm_config_` and `npm_package_config_` spellings Playwright also reads, which an `.npmrc` key or a `package.json` `config` key produce (probe-confirmed, PR46-SEC-02, LOW).
- **Evidence hygiene: accepted.** The PR gate table carries the D-SEC-PR23-02 statements ("`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first", "`.git/info/exclude` is empty"), the run is profile `pr`, there is no lockfile change. My count-only host-fragment scan of both committed runs (14 files) and of the 37 other added/modified files is 0 for the account name, its 8.3 form, the home and temp directories in every spelling, and the directory-account prefix of file owners; the generic patterns hit only the fictitious `Zebediah` fixtures in `heavy.test.ts` and a `HEAD~1`. The positive control (the withdrawn PR #28 run) fires. `summary.json` host metadata has no host name. Keeping the superseded run is harmless: lane A rejects it as stale and inventory's "newest run" sorts after it.

**Findings: 0 Critical, 0 High, 0 Medium, 5 LOW, 5 INFO. Verdict: PASS_WITH_FOLLOW-UPS** (§11). D-ORCH-077 already sends this PR into a fix cycle for a cheaper `security-integration` trigger; PR46-SEC-01 and -03 belong in that cycle (§6.2 lists what the new design must keep), and a security delta round on its head is required.

## 2. Method

| Area | How |
|---|---|
| Diff | `git diff origin/main...12ea6a6` (52 files). Read in full: the three workflows, `security-paths.mjs`, `security-integration.mjs`, `gitleaks-full.mjs`, the `check-workflow-policy.mjs`, `rebuild.mjs`, `heavy.mjs`, `playwright.config.ts`, `eslint.config.mjs` and `package.json` hunks, `inventory.mjs` (git and file handling), `ci-minutes.mjs` (API and token handling), the `8d83468` commit, the new tests (titles and key assertions), SPK-03 §4.1, the ADR-0005 W-1 note, `CI-CD.md` |
| P1 workflow mutants (`policy-mut.mjs`) | The head's `checkWorkflow` (the copy that becomes the base-ref policy after merge) on 40 text mutants (including the three unmodified files): 23 of `lane-c.yml` (triggers, permissions, OIDC, push/publish/apply forms, expression injection, secrets, unpinned action, redirect variables, credentials, renamed file, new file), 6 of `nightly.yml`, 11 of `ci.yml` (the `security-integration` chain). Results in §5.1 |
| P2 Playwright redirect | `npm exec --no -- playwright install --dry-run chromium` in the worktree with `npm_config_playwright_download_host` and, as control, `PLAYWRIGHT_DOWNLOAD_HOST` set to `.invalid` hosts (dry run prints URLs, fetches nothing); the head's `playwrightRedirects()` on the three spellings; a scratch package (`.npmrc` key + `package.json` `config` key) under `npm run` to see what npm 11.19.1 exports; Playwright 1.65.0 `getFromENV` read from `playwright-core` |
| P3 security-integration | Head `suiteProblems` against `check-evidence` `nameHasId` on three names; manifest, runner and job order read against the fast-lane step order; Dependabot PRs #41/#16 file lists; lane A log of run 43590778652 (`gh run view --log`, classifier line, `GATE_SECURITY_PATHS` source, check-evidence lines, suite output) |
| P4 ESLint | `npm exec --no -- eslint --print-config` for the deleted spike path, another spikes path and `session-scope-leak.int.test.ts`, in the main checkout (`47f942d`) and in the worktree (`12ea6a6`) |
| P5 gitleaks-full | Unit tests; the real image `v8.30.1@sha256:c00b6bd…` through the head's `gitleaks-full.mjs` (CLI and `scan()`), under the shared `docker.lock` (owner tag `sec-pr46`), §5.3 |
| P6 hygiene | Count-only host-fragment scan (`hostscan.mjs`: needles computed at run time from the OS, labels and counts only) over the run directories and the other changed files, positive control on the withdrawn PR #28 run; PR-added lines grepped for credential shapes (only test titles); image digests checked against Docker Hub; action pins against `gh api repos/<action>/git/ref/tags/<tag>` |
| P7 record simulation (`record-sim.sh`) | Scratch `git clone --shared`, main's real `check-security-owned-paths.mjs`, 13 scenarios (§9) |

## 3. Findings

| ID | Severity | Title | Owner / due |
|---|---|---|---|
| PR46-SEC-01 | LOW | `security-integration` installs and executes the PR's lockfile packages before lane A's supply-chain gates | devops-engineer, in the D-ORCH-077 fix cycle of this PR; at the latest before G3 |
| PR46-SEC-02 | LOW | The Playwright download-redirect refusal misses `npm_config_*` / `npm_package_config_*` (PR4-SEC-08 residual still open) | devops-engineer, 015-C or the fix cycle; before the first hosted lane C dispatch |
| PR46-SEC-03 | LOW | `required-gates` pins only the `ci-gate` `needs` entry of the new `security-integration` chain | devops-engineer, with the D-ORCH-077 redesign (pin the final design), at the latest 015-C, before G3 |
| PR46-SEC-04 | LOW | No-release and dispatch-only rules are keyed on file names, and `CKV_GHA_7` is skipped globally: a new or renamed workflow can publish from a dispatch | devops-engineer, 015-C; before the release-pipeline task and G3 |
| PR46-SEC-05 | LOW | Lane C `static` is not "lane A non-incremental": no Semgrep, vulnerability audit, signatures, licences or lockfile/cooldown gates on the judged SHA | devops-engineer, before the first `release-candidate` dispatch (before G3) |
| PR46-SEC-06 | INFO | `security-integration` matches required cases by substring (`SEC-TC-050` satisfies `SEC-TC-05`), unlike `check-evidence` | devops-engineer, with SEC-03 |
| PR46-SEC-07 | INFO | Workflow-policy tripwire residuals: `playwright-install` text match, secrets and `persist-credentials` in dispatch-only workflows | devops-engineer, 015-C |
| PR46-SEC-08 | INFO | Trigger-list coverage (ADR-0023 am. G item 5 scope) once more security suites activate | principal-architect, with the D-ORCH-077 ruling |
| PR46-SEC-09 | INFO | `iac` residuals: unanchored `--skip-path`, whitespace-split module directories, module sources fetched without integrity | devops-engineer, before the first `*.tf` lands |
| PR46-SEC-10 | INFO | gitleaks-full residuals: description says "first-parent history", the config follows the dispatched ref, the shifted-line case is not in the integration test | devops-engineer / qa-lead, before `gitleaks-full` activates |

## 4. Finding details

### PR46-SEC-01 (LOW): `security-integration` executes PR lockfile packages before lane A's supply-chain gates

- **CWE-829** (Inclusion of Functionality from Untrusted Control Sphere) · **OWASP A08:2021** (Software and Data Integrity Failures).
- **Where.** `.github/workflows/ci.yml:462-521` (job `needs: [scans]`; `npm ci` at :487, `npm run deps:rebuild` at :504, Jest via `security-integration.mjs` at :521); trigger list `tools/ci/security-paths.mjs:32-40` (includes `package-lock.json`).
- **Description.** Fast-lane deliberately runs workflow policy, install flags, lockfile provenance (`check-lockfile`), release cooldown (`check-dep-age`) before `npm ci`, and licences, registry signatures and `npm audit` + osv-scanner after it, all before `deps:rebuild` or any test executes package code (ci.yml comment at the Licences step, PR10-SEC-02 item 2). The new job runs in parallel with fast-lane, needs only `scans`, and goes straight from checkout to `npm ci --ignore-scripts`, `deps:rebuild` (Prisma CLI) and Jest (pg, Prisma client, Testcontainers and their transitive packages), with none of those gates. D-TASK015-36 adds `package-lock.json` to the trigger list, so the job is selected exactly when the lockfile changes.
- **Exploitability / impact.** A malicious PR author gains nothing (they already run code in fast-lane). The case this ordering protects against is an honest lockfile PR carrying a bad package: a registry-signature failure, a release younger than the cooldown, a non-registry `resolved` URL, or a package that a malware advisory flagged after Dependabot's 7-day cooldown. Dependabot PRs #41 and #16 are open now and both change `package-lock.json`; they have no local lane B pre-run, so after merge the first Dependabot rebase would run their packages on a hosted runner before any of the backstops. The runner holds no secret and a read-only token, but it does hold the full checkout of this private repository with network egress. Impact medium (source confidentiality), likelihood low (the lockfile producers, `.npmrc` `min-release-age=7` and Dependabot `cooldown: 7`, already filter the fresh-release class): LOW.
- **Remediation (code level).** Pick one, in the D-ORCH-077 redesign:
  1. Make the job depend on the supply-chain gates: `needs: [scans, fast-lane]` and `if: ${{ !cancelled() && github.event_name == 'pull_request' && needs.fast-lane.result == 'success' && needs.scans.outputs.security_paths == 'true' }}`. This also saves minutes on every red fast-lane push (D-ORCH-077), at the cost of wall-clock. `ci-gate` already fails a skipped job when the classifier said `true`, so a red fast-lane cannot turn into a green gate.
  2. Or replicate the gates in the job from the base ref, in fast-lane's order: extract base `tools/ci` like fast-lane's "Gate tooling from the base ref" step; run `node "$GATE_CHECK_LOCKFILE" --root … --base "$RANGE_BASE"` and `node "$GATE_CHECK_DEP_AGE" …` before `npm ci`; run `node "$GATE_LICENCE_CHECK"`, `npm audit signatures --@platform:registry=https://registry.npmjs.org/` and the audit step after it; only then `deps:rebuild`.
- **Verification.** A `check-workflow-policy` rule (with SEC-03) that fails when the `security-integration` job neither needs `fast-lane` with a `success` condition nor runs the lockfile and cooldown gates before its `npm ci`; mutants: drop `fast-lane` from `needs`, move `npm ci` above the lockfile gate. On the PR: a lane A run where fast-lane fails at the cooldown gate shows `security-integration` skipped (option 1) or failed before `npm ci` (option 2).

### PR46-SEC-02 (LOW): the Playwright redirect refusal misses the `npm_config_` and `npm_package_config_` spellings

- **CWE-494** (Download of Code Without Integrity Check) · **OWASP A08:2021**.
- **Where.** `tools/deps/rebuild.mjs:129` (`PLAYWRIGHT_REDIRECT = /^PLAYWRIGHT_(?:[A-Z]+_)?DOWNLOAD_HOST$/iu`), :137-142, :159; `tools/ci/check-workflow-policy.mjs:105` (`PLAYWRIGHT_HOST`, same anchor, case-sensitive).
- **Description.** Playwright 1.65.0 `getFromENV(name)` returns `process.env[name]`, else `npm_config_<name lower-cased>`, else `npm_package_config_<name lower-cased>`, for `PLAYWRIGHT_DOWNLOAD_HOST` and the per-browser hosts. npm 11.19.1 exports an unknown `.npmrc` key `playwright_download_host=…` as `npm_config_playwright_download_host`, and a `package.json` `"config": {"playwright_download_host": …}` as `npm_package_config_playwright_download_host`, to `npm run` children (probe: both present under `npm run`; npm only warns "Unknown project config"). `npm run deps:rebuild` therefore starts `rebuild.mjs` with those variables, `playwrightRedirects()` returns `[]` for both spellings (the direct spelling is refused), and the `npm exec --no -- playwright install` child inherits them. Probe: with `npm_config_playwright_download_host=https://mirror.example.invalid`, `playwright install --dry-run chromium` lists every download URL on the mirror. The workflow policy also passes `npm_config_playwright_download_host` in a job `env:` (mutant L18: 0 findings; the direct spelling is caught, L19).
- **Exploitability / impact.** Playwright does not verify browser archives against pinned hashes, so a redirect substitutes the browser binary that lane C and every local e2e run then execute (on the Windows host: with the developer's user rights). The levers are `.npmrc`, `package.json` and the workflows, all CODEOWNED, so a record review is the remaining control; `check-install-flags` requires keys in `.npmrc` but does not refuse extra ones (PR10-SEC-09 still open). LOW. The PR body's "refuses `PLAYWRIGHT_*DOWNLOAD_HOST`" is accurate, but the PR4-SEC-08 residual is not fully closed.
- **Remediation (code level).**
  - `rebuild.mjs`: `const PLAYWRIGHT_REDIRECT = /^(?:npm_(?:package_)?config_)?playwright_(?:[a-z]+_)?download_host$/iu;` and, defence in depth, start the Playwright step with an env copy that deletes every key matching it (and `PLAYWRIGHT_BROWSERS_PATH` unless the operator set it on purpose, logged).
  - `check-workflow-policy.mjs`: the same pattern for `PLAYWRIGHT_HOST` (case-insensitive), checked on env keys and on `$GITHUB_ENV` writes.
  - `check-install-flags.mjs`: refuse an `.npmrc` key and a root or workspace `package.json` `config` key matching `^playwright_` (this is the first concrete item of the PR10-SEC-09 key allow-list).
- **Verification.** `rebuild-playwright.test.ts` cases for `npm_config_playwright_download_host`, `npm_package_config_playwright_webkit_download_host` and `NPM_CONFIG_PLAYWRIGHT_DOWNLOAD_HOST` (refused, exit 1, before any step); a policy fixture with the `npm_config_` key in a job env; an install-flags fixture `.npmrc` with `playwright_download_host=`.

### PR46-SEC-03 (LOW): `required-gates` pins only the `needs` entry of the `security-integration` chain

- **CWE-693** (Protection Mechanism Failure) · **OWASP A08:2021**. Extends PR10-SEC-17.
- **Where.** `tools/ci/check-workflow-policy.mjs:334-405` (`CI_REQUIRED_GATES` has no classifier, job or aggregate entry), :1110 (the `needs` list); the chain itself at `ci.yml:398-417`, `:462-521`, `:525-550`.
- **Description.** Mutants that pass the head's `checkWorkflow` with `requiredGates: true` (which becomes the base-ref policy after merge): C2 the classifier replaced by `echo "security_paths=false" >> "$GITHUB_OUTPUT"`; C3 the classifier given `--base "$RANGE_HEAD"` (empty diff, `false`); C4 `security_ok=true` as the aggregate's initial value; C5 the manifest step forced to the head copies (`if false; then`); C9 `|| true` after `security-integration.mjs`. C4, C5 and C9 also survive the head's `ci-policy.test.ts`, whose assertions are `toContain` on lines those edits keep. Caught: dropping the `needs` entry (C1), `continue-on-error` (C10), `contents: write` (C7); `if: ${{ false }}` (C6) passes the policy but `ci-gate` then fails at run time.
- **Exploitability / impact.** Each mutant is an edit of `ci.yml`, which is owned, so the record is the catch, as for the other gates (PR10-SEC-17). Without a pin, a later "small" `ci.yml` change can switch the job off silently. LOW.
- **Remediation (code level).** After the D-ORCH-077 design settles, add to `CI_REQUIRED_GATES`: the classifier (`job: 'scans'`, exact run line, `env: {}`, positioned before the gitleaks step, `id: security-paths`, and the `scans.outputs.security_paths` mapping); a job-level pin for `security-integration` (exact `needs`, exact `if:`, no `continue-on-error`, no `defaults.run`); the manifest step pinned line by line like `LANE_B_EVIDENCE_SCRIPT`; the `ci-gate` aggregate pinned line by line (`AGGREGATE_SCRIPT`). Two-step change: the pins land on `main` before a PR may change the chain. Tighten `ci-policy.test.ts` to exact equality on those scripts.
- **Verification.** C2-C5 and C9 (and the same edits on whatever the redesign produces) turn into `required-gates` findings in `check-workflow-policy.test.ts`.

### PR46-SEC-04 (LOW): file-name keyed no-release rules plus a global `CKV_GHA_7` skip

- **CWE-693** · **OWASP A08:2021**.
- **Where.** `tools/ci/check-workflow-policy.mjs:123-125` (`DISPATCH_ONLY_WORKFLOWS = ['lane-c.yml', 'nightly.yml']`, `NO_RELEASE_WORKFLOWS = ['ci.yml', 'ci.yaml', …]`), the terraform regexes in `scriptFindings`; `.github/workflows/lane-c.yml:320` (`--skip-check CKV_GHA_7` for every workflow).
- **Description.** Mutant L21 (`lane-c.yml` renamed `lane-c.yaml`, plus a `schedule` trigger and `docker push`) and mutant L22 (the same content as a new `release.yml` with dispatch inputs and `docker push`) give 0 policy findings. Checkov's `CKV_GHA_7` (dispatch inputs on a build workflow, an SLSA build-integrity check) is the rule that would flag L22, and it is skipped for all workflows. Mutant L12 (`docker.io/hashicorp/terraform:1.17.1@sha256:… apply`, the image named literally instead of `"$TERRAFORM_IMAGE"`) passes `ci-no-release`.
- **Exploitability / impact.** Adding or renaming a workflow is an owned `.github` change, so a record review is the catch; the risk is that ADR-0023 plans a `release.yml` (G4) and both automated checks would be silent on it. LOW. The skip itself is justified for `lane-c.yml` and `nightly.yml` (D-TASK015-43): `profile`, `job` and `webkit_repeat_each` are choices, `since` is validated before use, all go through `env:`, and nothing is built for publication from these runs.
- **Remediation (code level).** (a) Apply the no-release checks to every workflow file except an explicit `RELEASE_WORKFLOWS` allow-list, whose entries get their own required guards (tag or `main` only, environment, the lane C green check); (b) key `DISPATCH_ONLY_WORKFLOWS` on the stem (`/^(lane-c|nightly)\.ya?ml$/`) or refuse a `.yaml` twin of a listed file; (c) match terraform by image as well (`hashicorp\/terraform[:@]\S*(?:\s+-\S+)*\s+(?:apply|destroy)\b`) or forbid `apply|destroy` after any `docker run` of a `*terraform*` image; (d) scope `CKV_GHA_7`: Checkov inline suppressions in the two files if 3.4.3 honours them for `github_actions`, otherwise keep `--skip-check` and add a policy rule "workflow_dispatch `inputs` only in `DISPATCH_ONLY_WORKFLOWS` or `RELEASE_WORKFLOWS` with guards".
- **Verification.** L12, L21 and L22 as policy fixtures that must fail; a Checkov run in lane C `iac` on a fixture release workflow with an input (outside the skipped fixture folders, or with a scoped skip) that must fail.

### PR46-SEC-05 (LOW): lane C `static` lacks lane A's supply-chain and SAST gates

- **CWE-1395** (Dependency on Vulnerable Third-Party Component) · **OWASP A06:2021**.
- **Where.** `.github/workflows/lane-c.yml:61-108` (comment at :10 "static (lane A non-incremental)"); ADR-0023 am. C ("Everything in lane A (non-incremental …) plus …").
- **Description.** `static` runs the workflow policy, install flags, lint, format, actionlint, typecheck, build and porcelain. It does not run Semgrep, `npm audit` + osv-scanner (`check-audit`), `npm audit signatures`, the licence check, `check-lockfile`, `check-dep-age`, migration immutability or the base-ref lint fixtures. A `release-candidate` dispatch, which is the G3/G4 evidence on the judged SHA, therefore carries no vulnerability, signature or SAST result newer than the last PR's lane A run.
- **Exploitability / impact.** Advisories published after a merge go unseen by the gate evidence until another lockfile PR runs lane A. Dependabot security alerts and my P6 assessment partly cover it. LOW.
- **Remediation (code level).** Add to `static` (or a `supply-chain` job) the lane A steps with the same commands: install flags already; then `check-lockfile` (against the previous release tag or `--base` of the dispatched SHA's parent), `check-dep-age`, `npm ci`, licences, `npm audit signatures`, `npm audit`/osv + `check-audit`, `run-semgrep.mjs` over the whole tree (no `--test`), and migration immutability against the last release tag. Correct the lane-c.yml header if any of them is left out on purpose.
- **Verification.** `lane-c-policy.test.ts` asserts the presence of each step; the first `release-candidate` dispatch shows them in the summary.

### PR46-SEC-06 (INFO): substring match of required cases in `security-integration.mjs`

- **CWE-697** (Incorrect Comparison) · **OWASP A08:2021**.
- **Where.** `tools/ci/security-integration.mjs:94` (`name.includes(id)`).
- **Description / impact.** Probe: required `SEC-TC-05`, passing test `SEC-TC-050 decoy`: no problem reported by `suiteProblems`; `check-evidence`'s `nameHasId` returns false for it. The job is a Linux re-run of head code (its header says so), and lane B's base-ref check is the control, so INFO.
- **Remediation.** Import `satisfiesRequired` (or `nameHasId` plus the `coverage gate:` exact rule) from `tools/quality/check-evidence.mjs` and add the decoy as a test case.

### PR46-SEC-07 (INFO): workflow-policy tripwire residuals

- **CWE-693** · **OWASP A05:2021**.
- `playwright-install` is a text match: `node node_modules/playwright/cli.js install --with-deps chromium` in `nightly.yml` passes (N3); inventory's own `--playwright <dir>` flag (lane-c.yml:395) matches the pattern (a false positive that would fire if inventory ran in another workflow). Head code in lane A can run an install anyway, so the rule is hygiene, not a boundary.
- The policy forbids non-sandbox secrets only in `pull_request` workflows: `secrets.NPM_TOKEN` in a `lane-c.yml` job env passes the policy (L15; the head's `lane-c-policy.test.ts` catches it). The lane-c.yml header promise "GITHUB_TOKEN (read-only) is the only credential" is a unit-test pin, not a base-ref rule.
- `persist-credentials: true` passes (L20). With `contents: read` and a private repository this exposes only a read token to code that already has the checkout.
- **Remediation.** Extend `pr-secrets` to `NO_RELEASE_WORKFLOWS` (sandbox environment excepted, SEC-TC-51); require `persist-credentials: false` on every `actions/checkout`; for `playwright-install` also match `playwright(?:-core)?/cli\.js\s+install` and exempt the inventory flag by anchoring on `deps:rebuild`.

### PR46-SEC-08 (INFO): trigger-list coverage as security suites activate

- **OWASP A04:2021** (Insecure Design).
- The list is ADR-0023 am. G item 5 plus the lockfile (D-TASK015-36). It omits the test roots of planned `security_integration_suites` (`rls-cross-tenant` runs `tests/generated/rls/`; the RBAC-matrix and audit generators will live under `tests/generated/**` and `tools/`), `jest.config.ts` (it defines the `integration`/`generated` projects the job selects), `.npmrc` and `apps/worker/src/platform/**`. Today only `catalog-c1-c14` (`prisma/tests/catalog/`, covered) is active, so nothing is missed yet; base-ref `min_tests` and required cases catch a dropped suite on the next selected PR, and lane B evidence covers every PR.
- **For principal-architect (D-ORCH-077 ruling):** when a suite joins the active set, add its test roots and generator paths to the trigger list in the same activation PR, and state in the ADR that `security-paths.mjs` is the single source; §6.2 lists what any cheaper design must keep.

### PR46-SEC-09 (INFO): `iac` job residuals (no Terraform on the head yet)

- `--skip-path tools/ci/fixtures --skip-path tests/fixtures` are unanchored regexes, so any `*/tests/fixtures/*` Dockerfile or module anywhere is skipped too (none exists today; TASK-014's Dockerfiles are outside such paths). Anchor them (`^/src/tools/ci/fixtures/`, `^/src/tests/fixtures/`, as Checkov sees them in the container) or list the exact fixture directories.
- `git ls-files -- '*.tf' | xargs -r -n1 dirname` splits a directory name with a space (or a C-quoted non-ASCII name) into wrong directories, so that module is not validated (fmt and Checkov still see it). Use `git ls-files -z -- '*.tf' | xargs -0 -r -n1 dirname`.
- `terraform init -backend=false` with network fetches module sources (git, http, registry) that the provider lock file does not pin; `-lockfile=readonly` covers providers only. Require `?ref=<40-hex>` / exact registry versions (Checkov `CKV_TF_1`/`CKV_TF_2` will flag them, but Checkov runs after `init`), or run Checkov first.

### PR46-SEC-10 (INFO): gitleaks-full residuals

- lane-c.yml and nightly.yml say "the full first-parent history"; the runner scans every commit reachable from the SHA (`git log -p <sha>` with `--diff-merges=first-parent`, which only decides how merges are diffed). That is wider, so the behaviour is correct and the wording should change ("the ancestry of the SHA; merges diffed against their first parent").
- Lane C and nightly read the config and baseline from the dispatched SHA itself. On `main` that is the merged config; a dispatch on another branch judges itself with its own config. G3/G4 evidence must name a lane C run whose `GITHUB_SHA` is on `main` (quality-gatekeeper check).
- The PR25-SEC-01 verification list had a shifted-line case; the integration test has 17 → 0 and 16 → 1 only. My real-image probe shows the shifted case reports exactly that line (§5.3), so this is about keeping the property pinned across a future image bump: add it to `gitleaks-full.int.test.ts` with the next image change.

## 5. Focus areas checked

### 5.1 Workflow policy mutants (head `checkWorkflow`, the post-merge base-ref policy)

| Mutant | Result |
|---|---|
| L0 / N0 / C0 the head files | 0 findings each |
| L1 `schedule`, L2 `push` (lane-c.yml); N1 `schedule` (nightly.yml) | `dispatch-only` |
| L3 `pull_request_target`, L4 `workflow_run` | `dispatch-only`, `forbidden-trigger` |
| L5 `permissions: write-all`, L6 job `contents: write` | `permissions` |
| L7 `id-token: write` | `ci-no-release`, `permissions` |
| L8 `docker push`, L9 `buildx --push`, L17 `npm publish`, N4 `docker push` | `ci-no-release` |
| L10 `"$TERRAFORM_IMAGE" apply`, L11 `"$TERRAFORM_IMAGE" -chdir=/work apply` | `ci-no-release` |
| L12 literal terraform image + `apply` | **0 findings** (PR46-SEC-04) |
| L13 `"$TF" apply` | `image-digest` (incidental) |
| L14 `${{ inputs.since }}` in `run:` | `untrusted-expression` |
| L15 `secrets.NPM_TOKEN` in a job env | **0 findings** (PR46-SEC-07; head unit test catches it) |
| L16 `actions/upload-artifact@v7` | `pinned-action` |
| L18 env `npm_config_playwright_download_host` | **0 findings** (PR46-SEC-02) |
| L19 env `PLAYWRIGHT_DOWNLOAD_HOST` | `forbidden-env` |
| L20 `persist-credentials: true` | **0 findings** (PR46-SEC-07) |
| L21 renamed `lane-c.yaml` + `schedule` + `docker push`; L22 new `release.yml` with inputs + `docker push` | **0 findings** each (PR46-SEC-04) |
| N2 `npm exec --no -- playwright install`, N5 `DEPS_REBUILD_PLAYWRIGHT` env, C8 `--playwright=chromium` in ci.yml | `playwright-install` |
| N3 `node node_modules/playwright/cli.js install` | **0 findings** (PR46-SEC-07) |
| C1 `ci-gate` without `security-integration` | `required-gates` |
| C2 classifier → `echo security_paths=false`, C3 `--base "$RANGE_HEAD"`, C4 `security_ok=true`, C5 head manifests, C9 `\|\| true` | **0 findings** each (PR46-SEC-03) |
| C6 `if: ${{ false }}` | 0 findings; `ci-gate` fails at run time (skipped while `security_paths` is `true`) |
| C7 `contents: write`, C10 `continue-on-error: true` | `permissions`, `continue-on-error` |

### 5.2 Brief items

| Item | Result |
|---|---|
| Permissions minimal | Yes. Workflow `contents: read`; every job `contents: read`; `lane-c-gate` and `ci-gate` `{}`. `download-artifact` within the run needs no `actions: read` |
| Actions by SHA | Yes. 5 distinct pins (checkout v7.0.1, setup-node v7.1.0, cache v6.1.0, upload-artifact v7.0.2, download-artifact v8.0.2); the two new ones equal the upstream tag objects |
| No `pull_request_target` / `workflow_run` | None; both are `forbidden-trigger` and `dispatch-only` findings (L3, L4) |
| No secrets to PR code | `security-integration` (the only new PR job) has no secret, `contents: read`, `persist-credentials: false`; its env holds `pull_request.base.sha` only. Its cache writes (setup-node npm cache, Prisma engine) are scoped to the PR merge ref |
| No `ref` input (D-TASK015-34) | Inputs are `profile`, `since`, `webkit_repeat_each` only; no checkout passes `ref:`; `lane-c-policy.test.ts` pins it. Safer than ADR-0023 am. C's `ref` input (one SHA is both the code and the workflow) |
| No release / GHCR push (D-TASK015-35) | None in either file; policy catches the forms in §5.1 except L12/L21/L22 (PR46-SEC-04). The `images` job runs `npm run test:stack -- --ci` only when `compose.yaml` and the script exist |
| Playwright install scope | Only `e2e-stack` (`deps:rebuild -- "--playwright=$ENGINE"`); `rebuild.mjs` accepts only the `--playwright=` form, which the policy pattern covers; `--with-deps` on Linux only. Redirect residual PR46-SEC-02 |
| Classifier from the base ref | Yes (`$GATE_SECURITY_PATHS` from base `tools/ci`; head git objects only while `main` lacks the file, as for the other scans tools; `scans-isolation` holds: no npm, no workspace script). The run on `12ea6a6` used the bootstrap path, as expected before merge |
| Fails closed with no active suite | Yes (`planSecuritySuites`: empty or missing list, unknown id, active without a runner, non-Jest runner, zero active suites all error; tested) |
| `ci-gate` requires it; policy enforces | `needs` enforced (C1); the aggregate accepts `skipped` only on push or with classifier output exactly `false`. The rest of the chain is unpinned (PR46-SEC-03) |
| PR edits the path list to skip | Not possible: the head copy of `security-paths.mjs` is not used once `main` has the file. Removing the step, unsetting `GATE_SECURITY_PATHS` (`node ""` exits 0 with no output, PR33-SEC-09) or crashing it leaves the output empty, and `ci-gate` fails |
| gitleaks-full config | `.gitleaks.toml` from `--ref` via `git show` (lane B: the run's `--base`, default `origin/main`; lane C / nightly: the dispatched SHA), the same file lane A reads from the base ref (D-SEC-PR45-01) |
| Baseline handling (D-SEC-PR25-01, PR33-SEC-08) | Validated before mount (regex = the sec-static pin, count 17, no duplicates); only validated lines written; commit-less line rejected with exit 2 and no report (unit test). Lane A's gitleaks step is unchanged and still has no ignore path, baseline or `.gitleaksignore` (sec-static pin `[PR25-SEC-01] lane A gitleaks neither mounts nor references the baseline`, unchanged, passing) |
| Temp-file safety | `mkdtempSync(tmpdir()/gitleaks-full-)` (0700, random), config and baseline 0644, `out/` mode 0777 under the umask; all bind mounts read-only except `/out`; `rmSync` in `finally`; the report is copied only after a 0/1 exit with the native file present. The image runs as root (alpine, no `USER`), so `/out` is writable on Linux |
| C-1 deletion | One commit (`8d83468`): spike file, exemption entry, one-off steps. No `spikes` entry left in `eslint.config.mjs`; effective config tightened (§1). The only other mention is a stale comment in `jest.config.ts:127` (harmless) |
| `{base}` / inventory / ci:minutes injection | None (§1) |
| ESLint change only tightens | Yes: three deleted lines, no other hunk; `--print-config` before/after (§1) |
| Checkov `CKV_GHA_7` | Justified for these two files, too broad as a global skip (PR46-SEC-04) |
| Evidence hygiene | §1; D-SEC-PR23-02 statements present; host scan 0; superseded run harmless |
| Self-hosted switch | `runs-on: fromJSON(vars.HEAVY_RUNNER_LABELS \|\| '["ubuntu-24.04"]')` on lane C `integration`, `images`, `e2e-stack` only (a repository variable: admin-only). ADR-0023 am. C prerequisites (ephemeral runner, private repository, no `pull_request_target`) stand; every `pull_request` job, `security-integration` included, stays on `ubuntu-24.04` |
| Concurrency, inputs in names | `lane-c-${{ github.ref }}` / `nightly-${{ github.ref }}`, no cancellation; `${{ matrix.engine }}` and the `needs.*.result` values in names and env are fixed vocabularies |

### 5.3 gitleaks-full with the real image

`gl-probe.mjs` through the head's `tools/quality/gitleaks-full.mjs` (its `GITLEAKS_IMAGE`, `dockerArgs` and `scan()`; root = the PR worktree, whose git common dir is mounted read-only), under the shared Docker lock (acquired after 45 min of waiting, held 106 s, released). Findings are printed as rule, 12-character commit and line only, and every one was `REDACTED`.

| Case | Result |
|---|---|
| A: the CLI exactly as lane C runs it (`--ref 12ea6a6 --scan 12ea6a6`) | exit 0, "config and 17-line baseline from 12ea6a6647ad", `clean (0 finding(s))` |
| B: 16 lines (the fifth dropped) | `findings: 1`, exactly the dropped fingerprint (`generic-api-key`, `b8f805f48711`, line 461) |
| C: 17 lines, the fifth shifted by +1 | `findings: 1`, exactly that line (a shifted fingerprint suppresses nothing) |
| D: empty baseline (positive control) | `findings: 17` |
| E: `--scan --all` | exit 2 (`rev-parse` refuses it); no scan |
| F: this record in `dir` mode with main's `.gitleaks.toml` | 0 findings; the same file with a run-time random `service_api_key` appended: 1 (`generic-api-key`) |

So the runner is exact (B, C), complete (D) and refuses option-shaped targets (E); the PR's own integration test (2/2) and its 309-commit CLI run agree.

## 6. Earlier findings and decisions

### 6.1 Status

| Item | Status after this PR |
|---|---|
| PR33-SEC-08 (INFO, runner requirements) | **Closed**: every listed requirement is met and tested (17 → 0, 16 → 1, commit-less line rejected before the scan) |
| PR25-SEC-01 runner half (LOW) | **Closed** (baseline from the base or gate ref, ancestry of the gate SHA, not `--all`). The suite stays `planned`; activation is qa-lead's manifest change with its own record. Shifted-line test: PR46-SEC-10 |
| D-SEC-PR45-01 "the full scan reads the same `.gitleaks.toml`" | Satisfied (`CONFIG_PATH = '.gitleaks.toml'` from the ref) |
| PR4-SEC-08 residual (Playwright confinement) | Partly closed: policy confinement and the direct redirect spelling; PR46-SEC-02 open |
| PR11 / ADR-0005 am. 10 item 13 (delete the spike with its exemption) | **Done** in one commit |
| C-1 (SPK-03 GO condition) | Recorded (SPK-03 §4.1; end-to-end p95 delta 1.264 ms, server-side 0.050 ms); not a security item; performance-engineer at P6 |
| PR31-SEC-02 (tree invariant), PR45-SEC-01 (exact `.gitleaks.toml` pin), PR10-SEC-17/19/20/21, PR33-SEC-09 | Not touched by 015-B (PR45-SEC-01 and PR10-SEC-19..21 are routed to 015-C in the PR body; the others stay with their earlier owners and due points); unchanged |
| D-SEC-PR35-01 attachment hook | Deferred to 015-C by the PR with a reason; due date (before G3) unchanged; accepted |

### 6.2 What the D-ORCH-077 trigger redesign must keep

Any cheaper `security-integration` design that the fix cycle implements keeps: (1) selection from base-ref code and data only; (2) fail closed on an unknown range, a missing or crashing classifier and zero active suites; (3) `ci-gate` treats "not run" as green only on an explicit negative classification; (4) no third-party package code before the lane A supply-chain gates (PR46-SEC-01); (5) the base-ref manifest and runners; (6) policy pins for the final shape (PR46-SEC-03). The delta round checks these six on the new head.

## 7. Unions with open PRs (the second merger needs a merge-only or delta security round)

| PR | Overlap with #46 (owned) | What the union must preserve |
|---|---|---|
| #39 TASK-014 (`7dd3c64`) | `package.json`, `tools/ci/check-workflow-policy.mjs`, `tools/ci/check-workflow-policy.test.ts`, `tools/deps/rebuild.mjs` | `package.json`: both `ci:minutes` (#46) and `test:stack` (#39). Policy: #39's `REQUIRED_CODEOWNED_PATHS` additions and #46's `dispatch-only`, `ci-no-release` for `NO_RELEASE_WORKFLOWS`, `playwright-install`, and `ci-gate` needing `security-integration`. `rebuild.mjs`: #39's Prisma step through `prismaArgv` (no npm, PR9-SEC-15) and #46's `playwrightRedirects()` refusal before any step (with the PR46-SEC-02 fix if it lands first); the Playwright step stays `npm exec --no`. After #39 lands, lane C `images` runs `test:stack -- --ci` (check that #39's runner accepts `--ci` and pushes nothing) and Checkov `iac` scans #39's Dockerfiles: any new `--skip-check` must be scoped and reviewed |
| #42 TASK-025 (`d611fda`) | `eslint.config.mjs` | #42's new `TENANT_CONTEXT_EXEMPTIONS` entry (`packages/audit/src/store/prisma-store.ts`, `allow: ['setter']`) and boundaries/audit-writer changes, with #46's spk03 entry removal: the union must contain no `prisma/tests/spikes/` exemption. Re-run `--print-config` on the old spike path (expect bare `error`) |
| #41 / #16 Dependabot | `package-lock.json` (not owned by #46) | No text overlap. After #46 merges, their next `pull_request` event selects `security-integration` (PR46-SEC-01 applies until the fix) |

A merge of any of these into #46 after this record voids it (§9 G rows). PR #45's commit-bound allowlist stays relevant only to PR #39's `dd7a2dd` (not in `main`'s ancestry after a squash).

## 8. Checks owed (routed)

| When | Check |
|---|---|
| D-ORCH-077 fix cycle (this PR) | §6.2 items 1-6; PR46-SEC-01 option chosen; PR46-SEC-03 pins for the final shape; PR46-SEC-06 with it; fresh lane B evidence with the D-SEC-PR23-02 statements; a delta security round on the new head |
| First hosted lane C dispatch (Wave-0 exit) | PR46-SEC-02 fixed or the dispatch env checked for `npm_config_playwright*`; `scans-full` exit 0 with the 17-line baseline on `ubuntu-24.04`; `iac` Checkov green without new global skips; job summaries show no host path |
| First `release-candidate` dispatch / G3 | PR46-SEC-05; quality-gatekeeper uses a lane C run whose `GITHUB_SHA` is on `main` (PR46-SEC-10) |
| Release-pipeline task | PR46-SEC-04 (`RELEASE_WORKFLOWS` guards, scoped `CKV_GHA_7`) |
| First `*.tf` | PR46-SEC-09 |
| `gitleaks-full` activation (qa-lead) | Manifest-only PR with record; PR46-SEC-10 shifted-line case at the next image bump |

## 9. Record simulation and secret hygiene

`record-sim.sh`: a scratch `git clone --shared --no-checkout` of the main checkout, scenario commits made only in the clone, `main`'s real `tools/ci/check-security-owned-paths.mjs` (byte-identical to the head's; CODEOWNERS unchanged by the PR) extracted with `git archive` and run with `--root <clone> --pr 46 --json`; base `origin/main` (`47f942d`) unless stated. The clone was removed afterwards.

| # | Scenario | Expected | Result |
|---|---|---|---|
| A | This record committed on top of `12ea6a6` | pass | pass, satisfied at `12ea6a6` (exit 0) |
| A' | Same, base = the PR merge base `9ce5dcf` | pass | pass (exit 0) |
| B | No record | missing | missing (exit 1) |
| C | The same record named `PR-0045-…` | missing | missing (exit 1) |
| D | Last Verdict row changed to FAIL | missing | missing (exit 1) |
| E | An owned-path edit (`tools/ci/security-paths.mjs`) after the record | missing | missing (exit 1) |
| F | A docs-only commit after the record | pass | pass at `12ea6a6` (exit 0) |
| G1-G4 | An edit of `package.json`, `tools/deps/rebuild.mjs`, `tools/ci/check-workflow-policy.mjs` or `eslint.config.mjs` after the record (what a union with #39 or #42 brings) | missing | missing (exit 1) each |
| H | A merge of current `main` (`47f942d`, docs only) after the record | pass | pass at `12ea6a6` (exit 0) |
| I | Head row replaced by the base SHA | missing | missing (exit 1) |

The checker run read-only against the PR worktree with this final file (uncommitted in its working tree) gives `pass` at `12ea6a6`, 33 owned paths; the same call with `--pr 45` gives `missing`. This record has exactly one row whose first cell is `Head` and one `Verdict` row (the last). Secret hygiene of this record: the real-image `dir` scan in §5.3 F (0 findings, control 1) ran on the text before §5.3 was filled in; that table adds no secret-shaped value, and a count-only host-fragment scan of the final file is 0 for every needle.

## 10. Proposed decision entry (for the orchestrator; DECISIONS.md not edited)

**D-SEC-PR46-01 · 2026-11-14 · security-analyst · PR #46 (TASK-015 015-B) r1 PASS_WITH_FOLLOW-UPS.** Security round 1 at `12ea6a6` = PASS_WITH_FOLLOW-UPS (0 C/H/M; LOW PR46-SEC-01..05, INFO -06..-10). Closed: PR33-SEC-08, the runner half of PR25-SEC-01 (real image: 17 lines 0 findings, 16 lines exactly the dropped fingerprint, shifted line exactly that line); ADR-0005 am. 10 item 13 done (spike, exemption and one-off steps deleted in one commit; effective lint config tightened). D-TASK015-34 (no `ref` input) and -35 (no GHCR push) verified; D-TASK015-43 `CKV_GHA_7` skip justified for lane-c.yml/nightly.yml but too broad as a global skip (PR46-SEC-04). Routed: PR46-SEC-01 (security-integration runs lockfile packages before lane A's supply-chain gates) and -03 (pin the chain) into the D-ORCH-077 fix cycle together with the six invariants of record §6.2, then a security delta round; -02 (Playwright redirect via `npm_config_`/`npm_package_config_`) before the first hosted lane C dispatch; -05 (lane C static lacks audit/signatures/licences/Semgrep) before the first `release-candidate` dispatch; -04 before the release-pipeline task; INFO -06..-10 as listed. Second merger of #39 or #42 with #46 needs a merge-only security round against record §7. **Reversibility:** High.

## 11. Verdict

| Item | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium, 5 LOW (PR46-SEC-01..05), 5 INFO (PR46-SEC-06..10) |
| Closed | PR33-SEC-08; PR25-SEC-01 (runner half); ADR-0005 am. 10 item 13 / C-1 deletion |
| Merge | Not before the D-ORCH-077 fix cycle (orchestrator ruling) and a security delta round on its head; this round's verdict covers `12ea6a6` and any later commit that touches no owned path |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding at head `12ea6a6`. The workflows are dispatch-only, read-only, SHA- and digest-pinned and release nothing; `security-integration` is selected by base-ref code, fails closed and is required by `ci-gate`; the gitleaks-full runner meets every PR33-SEC-08 requirement with the real image; the C-1 deletion leaves no exemption. The five LOW items are routed with due points, two of them into the fix cycle D-ORCH-077 already requires |
