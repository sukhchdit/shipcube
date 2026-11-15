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

## Delta round 2 (fix cycle 1 + CI-minutes stage 1, head ad30316)

| Field | Value |
|---|---|
| Head | ad3031694a44ea75b3ea6f0f26248860e408150b |
| Commits since round 1 | `ed67a98` (merge of `main`, docs only), `5a48afb` (CI-minutes stage 1 and the round-1 fixes), `382a6e1` (SPK-07, CI-CD.md), `bb7cc2f` (evidence), `814c5bf` (merge of `main` `d753027`: PR #47, `tools/quality/required-suites.json`), `bea5b6d` (evidence), `6e94ba4` (lint heap, D-TASK015-63), `ad30316` (evidence). Code head `6e94ba4`; `6e94ba4..ad30316` adds only the run directory. Merge base `d753027`. `main` has since moved to `2ca8a9f` with docs and agent-memory commits only (no owned overlap, so P1 needs no union). D-ORCH-088 rules that PR #42 merges at its record head; if it lands first, R2.9 applies |
| Lane A evidence | Run [43609726745](https://github.com/sukhchdit/shipcube/actions/runs/43609726745) on `ad30316` (`RANGE_BASE` `d753027`, `RANGE_BEFORE` `bea5b6d`). `fast-lane` **success**, full mode, every step `success`. `scans` red only at "Security-owned paths need a review record" (round 1 names `12ea6a6`). `security-integration` skipped (not due: `record_ok=false`). `ci-gate`: `BLOCKED: scans failure; security-integration pending (record missing)`. Lane scope from the head (bootstrap, expected in the introducing PR): `push_scope=code`, `identical=ad30316 6e94ba4` (`bea5b6d` correctly excluded: the lint env differs), `security_paths=true`, no proof yet. Base-ref `check-evidence`: run `20261114T1505Z_6e94ba4` accepted; `…1421Z_814c5bf`, `…1401Z_382a6e1`, `…1124Z_fa8f6e2` and `…1017Z_8d83468` rejected as stale |
| Lane B evidence | `docs/05-quality/tests/runs/20261114T1505Z_6e94ba4`, profile `pr`, PASS: unit 4,910 (2 skip), integration 278, api 124, catalog-c1-c14 102, rls-cross-tenant 126. No lockfile change in the PR |
| Owned paths changed | 43 (main's real checker, R2.12), against 33 in round 1. The 10 added paths are the stage-1 tooling (`tools/ci/lane-scope.mjs` and its test, 7 policy fixtures) and `jest.config.ts` (comment only) |
| Reviewer / date | security-analyst, 2026-11-14, delta round 2. Read-only on the PR worktree: I appended only this section, and `git status` was clean before writing. No workflow was triggered and Docker was not used. Read-only `gh api` GETs: the run, its jobs and log, the PR list, the PR body and comment. I fetched PR #42's and #39's heads into two temporary refs in the main checkout and deleted them afterwards. Probes ran from session scratch (R2.2) |

### R2.1 Summary

The fix cycle closes PR46-SEC-01, -02 (the redirect refusal), -03 (for the pinned stage-1 shape) and -06. It closes the pr-secrets part of -07 and the wording part of -10. The six §6.2 invariants hold (R2.3).

Proof inheritance does what am. L item 1 says. A proof run must be on a commit whose tree diff to the head is docs-only. Proofs are read from step conclusions, never from a job colour. A light run, a failed, cancelled or in-progress run, and the current run are never proofs. `ci-gate` is red on every gap I constructed, 16 cases (R2.4). The token reaches only the two pinned lane-scope steps.

Three residual paths remain, all LOW:

- **PR46-SEC-11.** The inherited `npm audit`/osv result has no post-merge backstop at this head. The ruling's "lane C and nightly re-audit `main`" does not exist yet: neither workflow runs an audit (PR46-SEC-05).
- **PR46-SEC-12.** The `scans` step that sets `$GATE_LANE_SCOPE` is not pinned, and `ci-gate` trusts the proofs that `scans` outputs. An owned `ci.yml` edit can therefore hand the token and the proof outputs to head code. The same lever is pinned for `ci-gate`.
- **PR46-SEC-13.** A proof run is not bound to this PR's base branch. A run on the same head SHA for a PR into another branch (whose workflow and tooling are that branch's) is accepted as a proof.

**INFO PR46-SEC-14.** One unit test checks `docs/03-architecture/data-model.md` byte for byte, and that file is a docs path that is not a tooling input. Its result is therefore inherited across docs pushes.

**Decisions.** D-TASK015-52 (`ci-gate` holds `contents: read`) and D-TASK015-63 (lint heap) are acceptable. D-TASK015-58 needs one correction (R2.7).

**CODEOWNERS.** Add `/apps/api/src/modules/identity/` and `/packages/config/` (R2.8).

**Findings this round: 0 Critical, 0 High, 0 Medium, 3 LOW (new), 1 INFO (new). Verdict: PASS_WITH_FOLLOW-UPS** (R2.15).

### R2.2 Method

| Area | How |
|---|---|
| Diff | Read in full: the fix-cycle commits `12ea6a6..ad30316` without the main merges; `ci.yml`; `lane-scope.mjs`; the `check-workflow-policy.mjs` diff (stage-1 pins, `gh-token`, `ACTIONS_READ_JOBS`, `PLAYWRIGHT_HOST`, pr-secrets, `laneScopeFindings`); the `security-paths.mjs` lockfile rule; the `security-integration.mjs` and `rebuild.mjs` diffs; the 24-mutant table in `ci-policy.test.ts`. Also read: the ruling (`rulings/wave-0-ci-minutes.md` on `main`), ADR-0023 am. L, D-TASK015-50..63 in the PR body, and the fix-cycle PR comment |
| P1 policy matrix (`mut.mjs`) | 29 text mutants of the three head workflows through the head's `checkWorkflow` (the post-merge base-ref policy) and `main`'s, side by side. The mutants cover the stage-1 chain beyond the PR's own 24, the round-1 lane C/nightly cases and D-TASK015-63 |
| P2 lookup and gate (`p-lookup.mjs`) | The head's `proofSteps`, `lookupProofs` and `gateVerdict` over a fake jobs API seeded with the real jobs JSON of runs 43609726745 (full, green `fast-lane`) and 43605891791 (`fast-lane` failed at Lint): 20 lookup cases and 16 gate cases |
| P3 corpus (`p-corpus.mjs`) | The head's `classify` over 25 plumbing scenario commits on `ad30316` in a scratch `git clone --shared`. The scenarios cover paths and modes, push ranges, unknown ranges, a code change and its removal in one push, and forced-push and opened shapes. Also 12 lockfile-rule cases (`lockfileChange`) and the duplicate-`env:` union hazard |
| P4 record simulation and light-run prediction (`record-sim.mjs`) | `main`'s real `check-security-owned-paths.mjs` over 18 scenarios, plus the head's `classify` and `lookupProofs` (real jobs API, GET only) for this record's push (R2.12) |
| P5 hygiene | Lane A log of run 43609726745 (classification, check-evidence lines, masked token). Count-only host-fragment scan with a run-time positive control. A gitleaks v8.30.1 default-ruleset emulation over this section. `gh api …/vulnerability-alerts` (GET) |

### R2.3 The six invariants of §6.2

| # | Invariant | Result |
|---|---|---|
| 1 | Selection from base-ref code and data only | **Holds.** After merge, `fast-lane`'s classify step, `scans` and `ci-gate` run `lane-scope.mjs` from `git archive "$RANGE_BASE" tools/ci`; its siblings (`security-paths`, `check-security-owned-paths`, `check-workflow-policy`, `yaml-subset`) come from the same directory. It reads git objects only (the base manifest's `tooling_inputs`, trees, the base and head lockfiles), plus records from the checkout, as the record step already does. The proof step names come from the head's `ci.yml` through the base-ref `CI_REQUIRED_GATES`. This is consistent by construction: `ci.yml` is code, so the proof run ran the same file, and a renamed or duplicated step only fails closed (F10). The `security-integration` manifests come from the base ref with no head-copy branch, and that script is pinned. In this PR the head copy runs (bootstrap; R2.5 row 4) |
| 2 | Fail closed: unknown range, missing or crashing classifier, zero active suites | **Holds.** An unknown base gives `push_scope=code`, `identical` = the head only and `security_paths=true`. A git error gives code. A crashing or absent lane-scope step leaves the outputs empty, and `ci-gate` then reports `classification missing` (G8-G10, G15; X1 unsets `GATE_LANE_SCOPE`, so `node ""` exits 0 with no output, which is still red at run time). An API failure gives no proof (F14), and the 40-call cap gives no proof (F16). Zero active suites fails `security-integration` (unchanged) |
| 3 | "Not run" is green only on an explicit negative or a verified proof | **Holds.** Rule (e) is red whenever `security_paths=true` unless `security-integration` succeeded in this run or a security proof exists (G2, G3, G11, G12). Rule (c) is red for a docs push of a code PR without a code proof (G4). Proof authenticity is limited by PR46-SEC-12 and -13 |
| 4 | No third-party package code before the lane A supply-chain gates (PR46-SEC-01) | **Holds.** In full mode, `fast-lane` success implies that the CODE-gated lockfile, cooldown, licence, signature and audit steps ran and passed in this run. Only base-ref tools run before them, so head code cannot flip `CODE` first. In light mode the proof run's same steps must have concluded `success` (F1, F2). Limits: PR46-SEC-11 (time), -13 (which run) |
| 5 | Base-ref manifest and runners | **Holds.** `SECURITY_INTEGRATION_SCRIPT` is pinned line by line (`git show "$RANGE_BASE:tools/quality/$name.json"`, with a fail-closed exit when they are missing). Their mutants C5, W3, W1 and C9 give findings. The runner script stays head code, as in round 1 |
| 6 | Policy pins for the final shape | **Holds for the pinned shape.** Their 24 mutants and my X7 and X13-X18 give findings (R2.6). Gaps: the `scans` tooling step (PR46-SEC-12), the `fast-lane` classify step (X8: runtime rule (b) catches it) and the Lint step env (X11/X12: hygiene only, lint runs head code anyway) |

### R2.4 Proof inheritance

| Check | Result |
|---|---|
| Inheritance only from a byte-identical code tree (tree diff) | `identicalSet` holds the head plus the first-parent commits of `<base>..<head>` (at most 50) whose `git diff --raw --no-renames --ignore-submodules=none` to the head is docs-only, with both modes `100644` or absent. Corpus results:<br>- **Light, the pre-push commit is a proof candidate:** a new, changed or deleted docs file; a run directory; `.claude/agent-memory/**`; root `README.md`; a record.<br>- **Code:** mode `100755`, a symlink, a gitlink, `.claude/settings.json`, `tools/*.md`, `.github/*.md`, `docs/03-architecture/api/**`, `gherkin-test-map.md`, stories.<br>- **Code added and removed within one push:** light, with the pre-push commit as the proof; the intermediate commit is never a candidate, and gitleaks still scans every commit of the range.<br>- **A `before` that is not an ancestor, or no `before`** (opened): code for a code PR.<br>- **Push event:** code.<br>- **Owned docs-scope paths** (`CLAUDE.md`, `.claude/agents/**`) run light, but the record step still requires a record on every push.<br>Live: run 43609726745 computed exactly `ad30316 6e94ba4` |
| Proof from step conclusions, jobs API, base-ref tooling | A run counts when it is completed, `event == pull_request`, from path `.github/workflows/ci.yml`, with `head_sha` in `identical` and not the current run. Inside it, `fast-lane` must be `success` with each of the 13 CODE-gated required steps `success` (the base-ref lint-fixture step may be `skipped`), and the `scans` steps for gitleaks, Semgrep and openapi-breaking must be `success`; the record step may fail. Results:<br>- **Accepted:** F1 (the real run 43609726745).<br>- **Rejected:** F2 (the same run with its code steps skipped, i.e. a light run), F3 (real failed run), F4 (in progress), F5 (other SHA), F6a-c (push, lane-c path, `pull_request_target`), F10 (ambiguous step name), F11-F12 (gitleaks skipped, Semgrep failed), F15 (current run), F17 (cancelled), F18 (latest re-run attempt failed).<br>- **Security proof:** set only by a `security-integration` job `success` (F13) |
| `ci-gate` red on any gap | 16 gate cases. Red for: a code push run light (G5), a CODE step skipped on a code push (G6), any disagreement between the mode and the classification (G7), an empty or malformed output (G8-G10, G15 `TRUE`), a pending or red `security-integration` (G2, G11, G12) and a draft (G16). `MERGE-READY` only for G1 (proof + job success), G3 (security proof), G13 (PR docs-only) and G14 (no security path) |
| Token step-scoped, `actions: read` | `GH_TOKEN` appears only in the env of the `scans` lane-scope step and of `ci-gate`'s aggregation step, both pinned exactly (`LANE_SCOPE_ENV`, `CI_GATE_ENV`). The new `gh-token` rule refuses it:<br>- at workflow or job level and in `fast-lane` or `security-integration` (their mutants);<br>- in lane C (L18d);<br>- as a checkout `token:` (X18).<br>`actions:` is allowed only on `scans` and `ci-gate` (N6, their RR-8 (ii) mutant); `top-level actions:` is refused. The live log shows the value masked. Both jobs also hold `contents: read`, which the checkout needs, so "only `actions: read`" holds for the scope this PR adds. Source of the script that receives it: PR46-SEC-12 |
| A PR author who controls head code vs the base-ref `--lookup` / `--gate` | After merge, `scans` and `ci-gate` run no npm, no `node_modules` and no workspace script. `scans-isolation` now covers `ci-gate` (their mutant "ci-gate runs npm"; my X6 preload is refused). The head-controlled inputs are git objects and the `ci.yml` step names, and both are consistent with the proof run. A PR without an owned edit cannot reach either. An owned `ci.yml` edit can (X3, X4: PR46-SEC-12), and the record is the catch |
| A run from another PR or a fork adopted as proof | A run of another PR into `main` is accepted (F7, by design, RR-1). A run of a PR into a non-`main` base (F8) and a fork-shaped run with an empty `pull_requests` (F9) are **also accepted**: PR46-SEC-13 |
| Re-runs, cancellations, queueing | The runs list is filtered to `status=completed`, and the jobs list is the latest attempt. A failed re-run removes a proof (F18), and a run being re-run is not a candidate (F4). A cancelled run, or a pending run superseded by a newer push, is never a proof (F17). A cancelled full run leaves the next docs push red with "no code proof for this tree" (G4): the fix is a re-run or a code push (fail closed). `cancel-in-progress: false` and the per-PR group are pinned (`CI_CONCURRENCY`, their RR-7 mutant), so a docs push waits for the full run it inherits from |

### R2.5 The residuals of ADR-0023 am. L item 6, rated

| Residual | Rating | Reasoning |
|---|---|---|
| Time-dependent gates inherited between the proof run and the merge | **LOW, PR46-SEC-11** | The cooldown (`check-dep-age`) is monotonic: an age only grows. Licences and signatures are deterministic for a given lockfile. `npm audit` and osv are not: an advisory published after the last code push's run goes unseen until the next run. Before stage 1, the record push re-ran the audit minutes before the merge. Now the window runs from the last code push to the merge, typically the length of a review round. The ruling accepts this because "lane C `wave-end` and `nightly` re-audit `main`". At this head neither does: lane C `static` has no audit (PR46-SEC-05, open), `nightly` runs `npm outdated` as a report, and `GET …/vulnerability-alerts` answers 404 (Dependabot alerts not enabled, or not visible to this token). Accepted for stage 1 with the interim control and fix in R2.11 |
| Inherited head-code checks from a run on an older base | **INFO, accepted** | The proof run tested `merge(X, base_then)` with `base_then`'s tooling. Light mode re-runs every deciding gate (policy, install flags, migration immutability, check-evidence, gitleaks, Semgrep, oasdiff, record) with the current base. The inherited head-code checks and the security proof's suite set come from `base_then`, which is the same exposure as a PR that was not re-pushed. P1 (union when `main` moved under `tools/quality/**`, `tools/ci/**`, `.github/**`, the lockfile, `prisma/**`, `.npmrc`, `.semgrep/**`, `.gitleaks.toml`) turns exactly those moves into code pushes. D-TASK015-62 did so for PR #47's activation (`814c5bf`). Holds while the orchestrator applies P1 |
| `actions: read` on the no-head-code jobs, token on one step | **INFO, accepted for the pinned shape** | Verified in R2.4. The remaining lever, an owned edit of the unpinned `scans` tooling step, is PR46-SEC-12 |
| Bootstrap of `lane-scope.mjs` from the head in the introducing PR | **INFO, accepted** | Only PR #46 runs the head copy: the run log says "head (bootstrap: not on the base ref yet)" in `fast-lane` and `scans`. This review of `lane-scope.mjs` is the control: no shell, every SHA validated, GET only, outputs and summary lines sanitised, no write path. The push of this record runs the reviewed copy with the token in `scans` and `ci-gate`. After the squash merge, every PR's `pull_request.base.sha` is a `main` tip that has the file, so the bootstrap ends |
| Unit tests that read `docs/**` are inherited (PR comment) | **INFO, PR46-SEC-14** | Only `tools/db/render-rls-dr-a14.test.ts` (it reads `docs/03-architecture/data-model.md`, which is not a tooling input) and the record-format tripwire matter. The PR's own record is evaluated by the record step on every push anyway |

### R2.6 `security-integration` selection, `ci-gate`, and the policy matrix

- **`if` on `security_integration_due`.** The job condition is pinned exactly (`SECURITY_INTEGRATION_IF`) and `needs: [scans, fast-lane]` is pinned (`SECURITY_INTEGRATION_NEEDS`). Their mutants "fast-lane dropped from needs", "success condition dropped" and "selected by security paths alone" give findings, and so does my X16 (without `!cancelled()`).
- **Not skippable for a security-path head at merge.** `due` = `security_paths` and the record check passes and there is no security proof. The merge candidate is the head that carries the record, so the job runs there. Any other skip is red under rule (e).
- **This record's push.** The prediction (R2.12) is `security_integration_due=true` and a light run with code proof 43609726745. The job will run `catalog-c1-c14` and `rls-cross-tenant` (`main`'s active `security_integration_suites`).
- **PR46-SEC-01 is closed** (R2.3 invariant 4).

P1 matrix, head checker (the post-merge policy) / `main`'s checker:

| Mutant | Head | `main` |
|---|---|---|
| C0, L0, N0 the head files | 0 | 0 |
| X1 `lane-scope` dropped from the `scans` tooling loop (`$GATE_LANE_SCOPE` unset) | 0 (run time: empty outputs, `ci-gate` red) | 0 |
| X2 `GATE_*` from `$GITHUB_WORKSPACE` | `scans-isolation` | `scans-isolation` |
| X3 `GATE_*` always from the head's git objects (`if false;`) | **0** (PR46-SEC-12) | 0 |
| X4 an inserted `scans` step re-points `GATE_LANE_SCOPE` at a head extract | **0** (PR46-SEC-12) | 0 |
| X5/X6 an inserted step writes a `NODE_OPTIONS` preload to `$GITHUB_ENV` (`scans` / `ci-gate`) | `node-options-preload` | `node-options-preload` |
| X7 an inserted `ci-gate` step overrides `CODE_PROOF` via `$GITHUB_ENV` | `required-gates` | 0 |
| X8 `fast-lane` classify forced light | 0 (run time: rule (b) red on a code push) | 0 |
| X9/X10 Lint `NODE_OPTIONS` plus `--require` or `--import=data:` | `node-options-preload` | `node-options-preload` |
| X11 an extra Lint env key; X12 the heap line removed | 0 / 0 (Lint env not pinned; hygiene) | 0 / 0 |
| X13 lane-scope step after gitleaks; X14 a literal `code_proof` output; X15 a step after the aggregation; X16 `!cancelled()` dropped | `required-gates` each | 0 each |
| X17 `branches: [main]` added to the `pull_request` trigger | 0 (accepted: usable for PR46-SEC-13) | 0 |
| X18 checkout `token: ${{ github.token }}` in `scans` | `gh-token` | 0 |
| L15 a non-GITHUB_TOKEN secret in a lane-c job env | `pr-secrets` (PR46-SEC-07 part closed) | 0 |
| L18/L18b/L18c `npm_config_` / `NPM_PACKAGE_CONFIG_` Playwright host in env or written to `$GITHUB_ENV` | `forbidden-env` each (PR46-SEC-02) | 0 |
| L18d `GH_TOKEN` in lane C; N6 `actions: read` on a nightly job | `gh-token`; `permissions` | 0; 0 |
| L20 `persist-credentials: true`; N3 `node node_modules/playwright/cli.js install` | 0; 0 (PR46-SEC-07 remainder, routed to 015-C) | 0; 0 |

### R2.7 Earlier findings and the fix-cycle decisions

| Item | Status at `ad30316` |
|---|---|
| PR46-SEC-01 (LOW) | **Closed** (D-TASK015-53; R2.3 invariant 4; R2.6) |
| PR46-SEC-02 (LOW) | **Closed** for the refusal: `rebuild.mjs` and the policy use `/^(?:npm_config_\|npm_package_config_)?playwright_(?:[a-z]+_)?download_host$/iu` on env keys and `run:` scripts (L18-L18c). Playwright 1.65.0 reads exactly four host names (`PLAYWRIGHT_DOWNLOAD_HOST`, `_CHROMIUM_`, `_FIREFOX_`, `_WEBKIT_`), and all four match. `rebuild-playwright.test.ts` covers the three spellings, and the refusal comes before any step. Item 3 (`check-install-flags` refusing `.npmrc`/`config` `playwright_*` keys) is routed to 015-C with PR10-SEC-09; the run-time refusal already covers it |
| PR46-SEC-03 (LOW) | **Closed** for the stage-1 shape (D-TASK015-54; their 24 mutants; R2.6). The unpinned source of `$GATE_LANE_SCOPE` in `scans` is the new PR46-SEC-12 |
| PR46-SEC-04, -05 (LOW) | Open, routed (D-TASK015-61): -04 to 015-C, before the release-pipeline task; -05 to 015-C, before the first `release-candidate` dispatch. -05 is now also the backstop that PR46-SEC-11 lacks |
| PR46-SEC-06 (INFO) | **Closed**: `nameHasId` from `check-evidence`; decoy test `SEC-TC-060` |
| PR46-SEC-07 (INFO) | **Partly closed**: pr-secrets now covers lane C and nightly outside `carrier-sandbox` (L15). `persist-credentials` (L20) and `cli.js install` (N3) are open, routed to 015-C |
| PR46-SEC-08, -09 (INFO) | Open, routed (principal-architect with each suite activation; before the first `*.tf`) |
| PR46-SEC-10 (INFO) | Wording fixed in `lane-c.yml` ("every commit reachable from it, merges diffed against their first parent"). The shifted-line integration case goes to qa-lead at the next image bump |
| D-TASK015-50 (no usable `before` → PR range) | Accepted. It matches ruling §3 (1) "else the PR range", and a code PR still runs full (corpus) |
| D-TASK015-51 (`DOCS_ONLY_PATHS`) | Accepted (corpus). See PR46-SEC-14 for one inherited test |
| D-TASK015-52 (`ci-gate` holds `contents: read` + `actions: read`) | **Accepted.** The checkout needs `contents: read` to extract the base-ref tool, and on a private repository the scope gives nothing beyond what the checkout already holds. `scans-isolation` now applies to `ci-gate`. The tooling and aggregation steps are pinned exactly, and the token is on the aggregation step only. Stage 2 folds `scans` in, which needs the scope anyway |
| D-TASK015-53..56 | Accepted (PR46-SEC-01, -03, -06; G7) |
| D-TASK015-57, -60 (inventory, `ci:minutes`) | No security impact: `gh api` uses its own auth and prints no token |
| D-TASK015-58 (gitleaks-full `--text --no-textconv --no-ext-diff`) | Accepted as hardening: `--no-ext-diff` also keeps any diff driver configured in a mounted `.git` from running. **Correction:** "lockfile content is now scanned" does not hold. `.gitleaks.toml` has `useDefault = true`, and the v8.30.1 default global allowlist excludes `(?:^\|/)(?:…\|package-lock\.json\|…)$`, so lockfile lines never become findings, with or without `--text`. The routed question (scan lockfile diffs on every PR) is answered no. The leak class it names, a `resolved` URL with embedded credentials, already fails lane A's base-ref `check-lockfile`, which requires the exact `https://registry.npmjs.org/<name>/-/<file>.tgz` form on every lockfile change (always a full run) |
| D-TASK015-59 (lockfile rule) | Accepted. Spot checks: a dev or devOptional bump, a new dev entry and a key-order-only change do not select; a prod patch, a dev→prod move, the root entry, a new prod entry, a `__proto__` key, corrupt, v1 and deleted lockfiles select. Any lockfile change is still a full lane A run (supply-chain gates), and lane B runs every suite |
| D-TASK015-61, -62 | Accepted (routing; unions conform to P1) |
| D-TASK015-63 (`NODE_OPTIONS=--max-old-space-size=4096` on the Lint steps) | **Accepted.** It sets a heap size only. `node-options-preload` refuses the dangerous forms on the same key (X9, X10), and Lint runs head code anyway (configs, rules, typegen), so the env adds no capability. A botched union that leaves two `env:` keys on the step is refused by the policy's YAML parser (`yaml-subset`, P3), which fails closed. Reverting the line (X12) passes the base-ref policy and fails only the head unit pin; that is acceptable, because the failure mode is an OOM, not a bypass |

### R2.8 CODEOWNERS for the remaining am. G item 5 paths (ruling risk; decided)

**Decision: add `/apps/api/src/modules/identity/` and `/packages/config/` to `.github/CODEOWNERS`, and to `REQUIRED_CODEOWNED_PATHS` in `check-workflow-policy.mjs`.**

**Why:**
- Authentication (ASVS V2/V3) and configuration and secret handling (`file-secret-provider.ts`, `secret-refs.ts`, `env-input.ts`) are security-critical by am. G item 5. They deserve the same record as `packages/authz` and `packages/audit`.
- Today only `packages/config/src/keys.ts` is owned. PR #39 adds seven more `packages/config/src` files (PR39-SEC-05), and the directory line subsumes them.
- The CI cost goes down, not up. Under stage 1, a path without a record requirement makes `record_ok=true` on every push, so `security-integration` runs on every new code tree. A record requirement runs it once, on the merge candidate.
- The cost is one security record per identity or config PR, which those PRs warrant anyway.
- `apps/api/src/modules/identity/` holds only `.gitkeep` files today, so adding it now costs nothing.

**Owner and due:**
- devops-engineer, as a small PR or in 015-C. `.github/CODEOWNERS` is owned, so the change needs its own record. It does not belong in this PR, because it would void this record (R2.12 G7).
- Due before the first PR that adds code under `apps/api/src/modules/identity/`, and at the latest before Wave-0 exit.
- If PR #39 merges first, its seven file lines may stay or be folded into the directory line.

### R2.9 Unions with open PRs (updated §7; the second merger needs a merge-only or delta security round)

PR #42 (code round 3 APPROVED_WITH_NITS, D-ORCH-085) and PR #39 (code round 2 APPROVED_WITH_NITS, D-ORCH-087) may merge before #46. Any union into #46 voids this record (R2.12 G1-G6).

| PR | Overlap with #46 (owned) | What the union must preserve |
|---|---|---|
| #42 TASK-025 (`96bd37a`) | `.github/workflows/ci.yml`, `eslint.config.mjs` | **`ci.yml`:**<br>- All three PRs add the same Lint env, each with its own comment. Exactly one `env:` mapping with exactly `NODE_OPTIONS: --max-old-space-size=4096`, the step's `if:` and `run: npm run lint` unchanged; one comment is enough. A duplicated `env:` key fails the policy (good), so a green `Workflow policy` step on the union run is the check.<br>- Every other #46 hunk byte for byte: concurrency, `fast-lane` outputs and the classify step, the `scans` permissions, outputs and lane-scope step, the `security-integration` and `ci-gate` jobs. After #46 is on `main`, `main`'s policy pins them on any union run.<br>**`eslint.config.mjs`:** #42's `TENANT_CONTEXT_EXEMPTIONS` entry for `packages/audit/src/store/prisma-store.ts` (`allow: ['setter']`) and its boundaries and audit-writer blocks, plus #46's removal of the spk03 entry. No `prisma/tests/spikes/` exemption may remain; `--print-config` on the old spike path must give bare `error` |
| #39 TASK-014 (`c85d5e5`) | `.github/workflows/ci.yml`, `jest.config.ts`, `package.json`, `tools/ci/check-workflow-policy.mjs` (+ test), `tools/deps/rebuild.mjs` | **`ci.yml`:** the same Lint env rule (#39 puts its comment above `- name:`).<br>**`jest.config.ts`:** #39's opt-in `stack` project and `stack` in the `testPathIgnorePatterns`, and #46's comment.<br>**`package.json`:** both `test:stack` and `ci:minutes`.<br>**Policy:**<br>- #39's `REQUIRED_CODEOWNED_PATHS` additions (images, compose, infra, seven config files).<br>- Every #46 addition: `CI_REQUIRED_GATES` lane-scope / security-integration / ci-gate entries, `laneScopeFindings`, `tokenFindings`, `ACTIONS_READ_JOBS`, the `PLAYWRIGHT_HOST` regex, `pr-secrets` for the no-release workflows, `scans-isolation` on `ci-gate`, the exported `gateStepIndex` (`lane-scope.mjs` imports it) and the round-1 rules.<br>- The test must keep both PRs' cases.<br>**`rebuild.mjs`:** #39's Prisma step through `prismaArgv` (no npm, PR9-SEC-15), and #46's exported `PLAYWRIGHT_REDIRECT` with `playwrightRedirects()` refusing before any step. The Playwright step stays `npm exec --no`.<br>**After #39 lands:** lane C `images` runs `test:stack -- --ci`, and Checkov `iac` scans #39's Dockerfiles. Any new `--skip-check` must be scoped and reviewed |
| #41 / #16 Dependabot | `package-lock.json` (not owned by #46) | No text overlap. Their next run after #46 merges is a full run (a lockfile change is code). `security-integration` is selected whenever the root or a workspace entry changes, and both edit `package.json` ranges (D-TASK015-59 note) |

### R2.10 Findings of this round

| ID | Severity | Title | Owner / due |
|---|---|---|---|
| PR46-SEC-11 | LOW | The inherited vulnerability audit has no post-merge backstop at this head | Interim: orchestrator, from this merge on. Fix: devops-engineer in the TASK-286 policy PR (or with PR46-SEC-05). Ruling text: principal-architect. At the latest before G3 |
| PR46-SEC-12 | LOW | The `scans` step that sets `$GATE_LANE_SCOPE` is unpinned, and `ci-gate` trusts the proofs `scans` outputs | devops-engineer, TASK-286 policy PR (stage 2); at the latest before G3 |
| PR46-SEC-13 | LOW | Proof runs are not bound to this PR's base branch: a run on the same SHA for a PR into another branch is adopted | devops-engineer (015-C or TASK-286). Precondition text in ADR-0023 am. L: principal-architect. Before G3, and before the first PR whose base is not `main` |
| PR46-SEC-14 | INFO | A unit test that reads a non-tooling-input doc (`data-model.md`) is inherited across docs pushes | qa-lead, with the next manifest commit (the SEC-TC-74 move of D-SEC-PR47-01) |

### R2.11 Finding details

#### PR46-SEC-11 (LOW): the inherited vulnerability audit has no post-merge backstop at this head

- **CWE-1395** (Dependency on Vulnerable Third-Party Component) · **OWASP A06:2021**.
- **Where:**
  - `.github/workflows/ci.yml:206-217`: `Vulnerability audit`, `if: env.CODE == 'true'`, skipped on light runs.
  - `.github/workflows/lane-c.yml` and `nightly.yml`: no `npm audit` or osv step.
  - ruling §3, "Why inheritance is as strong as re-running", bullet 3; ADR-0023 am. L item 6.
- **Description.** A docs push inherits the audit result of the last code push's run. The ruling accepts the window between that run and the merge because "Lane C `wave-end` and `nightly` re-audit `main`". At this head, neither workflow runs `npm audit`, osv-scanner or `check-audit`: lane C `static` lacks them (PR46-SEC-05), and `nightly`'s `dependency-freshness` is `npm outdated`, a report. Dependabot alerts do not answer either (`GET …/vulnerability-alerts`: 404). Am. L item 5 caps `wave-end` at one a month while the forecast exceeds 60 %, so even after PR46-SEC-05 the backstop is monthly.
- **Exploitability / impact.** An advisory, including a malware advisory, published between the proof run and the merge for a package the PR adds or bumps is not seen before the merge, and is seen only by the next lockfile PR's run. Before stage 1, the merge-candidate push re-ran the audit. Likelihood low: the window is hours, and the 7-day cooldown and Dependabot cooldown already filter fresh releases. Impact medium. LOW.
- **Remediation (code level).**
  1. TASK-286 policy PR: let `Vulnerability audit` and `Registry signatures` run on every push. Change their `CI_REQUIRED_GATES` `ifs` to `[]`, keeping the step order after `npm ci`. Light mode already runs `npm ci --ignore-scripts`, so the cost is about 20-40 s and usually no extra billed minute. Stage 2 makes the install CODE-gated; keep it unconditional when the audit is.
  2. Make PR46-SEC-05's lane C `static` audit real, and add `check-audit` to `nightly` (or `wave-end`).
  3. Recommend that the human enable Dependabot security alerts (a settings change, outside agent scope per D-ORCH-012).
  4. Principal-architect corrects ruling §3 bullet 3 to name the control that exists.
  - **Interim (orchestrator, from this merge on):** before `gh pr merge`, check that the code proof run named in the `scans` summary finished at most 24 h earlier. Otherwise re-run it (`gh run rerun <id>`) and merge only after it is green again.
- **Verification.** A policy-test fixture with the audit step unconditional passes, and one with it removed fails. A light run's jobs list shows `Vulnerability audit: success`.

#### PR46-SEC-12 (LOW): the `scans` step that sets `$GATE_LANE_SCOPE` is unpinned, and `ci-gate` trusts the proofs `scans` outputs

- **CWE-693** (Protection Mechanism Failure) · **OWASP A08:2021**. Extends PR33-SEC-09 and PR10-SEC-17.
- **Where:**
  - `.github/workflows/ci.yml:414-452`: the "Gate tooling and scan configuration from the base ref" loop, which writes `GATE_LANE_SCOPE` to `$GITHUB_ENV`.
  - `tools/ci/check-workflow-policy.mjs`: `CI_REQUIRED_GATES` pins the lane-scope `run:` and env, but not this step or the steps before it.
  - `tools/ci/lane-scope.mjs` `gateVerdict`: rules (c) and (e) take `CODE_PROOF`, `SECURITY_PROOF`, `SECURITY_PATHS` and `RECORD_OK` from the `scans` outputs as given.
- **Description.** These two mutants pass the post-merge policy with 0 findings:
  - X3: `if [ -f "$gates/base/tools/ci/$tool.mjs" ]` replaced by `if false;`, so every `GATE_*` comes from the head's git objects.
  - X4: a step inserted before the lane-scope step that extracts the head's `tools/ci` and re-points `GATE_LANE_SCOPE`.

  In both, head code runs in `scans` with the `actions: read` token and writes the seven outputs, for example a well-formed `code_proof` naming any green run, `security_paths=false` or `record_ok=true`. `ci-gate` then evaluates them without re-reading the proof run, and shows `MERGE-READY`. The same lever is closed for `ci-gate`: `CI_GATE_TOOLING_SCRIPT` is pinned, and their mutant "ci-gate tooling from the head working tree" gives a finding. Am. L item 1 says "`ci-gate` recomputes the classification with base-ref tooling". In stage 1 the recomputation happens in `scans`, and TASK-286 is planned to add the compare.
- **Exploitability / impact.** Each mutant is an edit of `ci.yml`, which is owned, so the record review is the catch, as for every unpinned input-sourcing step (PR10-SEC-17). Without a pin, a later "small" `scans` change could silently move the token to head code and let the gate trust forged proofs. LOW.
- **Remediation (code level).**
  1. Pin the `scans` tooling step exactly, like `CI_GATE_TOOLING_SCRIPT` (a `SCANS_TOOLING_SCRIPT` constant through `pinnedScriptProblems`), and refuse any step between it and the lane-scope step other than the pinned `Security-critical paths` step.
  2. Write `node "${GATE_LANE_SCOPE:?}"` in the pinned run line (PR33-SEC-09), so an unset variable fails the step instead of exiting 0.
  3. In TASK-286, have `ci-gate`'s base-ref `lane-scope.mjs --gate` re-read `CODE_PROOF` and `SECURITY_PROOF` through the jobs API (one call each, the same `fastLaneProblems`, `scansProblems` and `securityIntegrationPassed` checks) and go red on a mismatch.
- **Verification.** X3 and X4 become `required-gates` findings in `ci-policy.test.ts`. A `lane-scope.test.ts` gate case with a `CODE_PROOF` whose run has a skipped code step is `BLOCKED`.

#### PR46-SEC-13 (LOW): proof runs are not bound to this PR's base branch

- **CWE-345** (Insufficient Verification of Data Authenticity) · **OWASP A08:2021**.
- **Where.** `tools/ci/lane-scope.mjs` `lookupProofs` (candidate filter: `head_sha`, `event`, `status`, `path`, run id; nothing about the PR or its base).
- **Description.**
  - **What the lookup accepts.** Any completed `ci.yml` `pull_request` run on a code-identical SHA counts as proof: the run of another PR into `main` (F7, intended by RR-1), the run of a PR into a non-`main` branch (F8), and a fork-shaped run with an empty `pull_requests` (F9).
  - **What such a run executed.** A `pull_request` run executes the workflow of `merge(X, its base)` with that base's `RANGE_BASE` tooling. Suppose a branch `B` whose `ci.yml` keeps the step names but no-ops the CODE-gated commands, and a second PR from the same head branch into `B`. That run produces a green `fast-lane` with all 13 required steps `success`.
  - **The bypass.** After any docs push, the original PR into `main` runs light, adopts that run, and `ci-gate` shows `MERGE-READY`. No lint, type-check, unit test, build, lockfile, cooldown, licence, signature or audit step has then run against `main`'s tooling. `security-integration` also runs the PR's packages behind a proof that ran no supply-chain gate (PR46-SEC-01's premise). The PR's own diff can be unowned and innocent-looking, so no record is required.
  - **Binding is best-effort.** GitHub's `pull_requests` field on a run is best-effort: it is empty for fork PRs, and it can list PRs other than the triggering one.
- **Exploitability / impact.** The attacker needs write access to create branch `B` and the second PR. Today all 47 PRs of the repository target `main`, and `main` has no branch protection (D-ORCH-012/013), so a writer has more direct options. The finding matters once branch protection exists (G4 or a plan change) and for honest stacked PRs. Likelihood low, impact medium. LOW.
- **Remediation (code level).**
  1. In `lookupProofs`, accept a run only when `run.pull_requests` is non-empty and every entry has `base.ref === 'main'` (or the current PR's base ref passed in a later, two-step argument) and `base.repo.full_name === repo`. Add `git merge-base --is-ancestor <entry base.sha> <current base>`. An empty list gives no proof: the fail-closed path is a full run of about 6 minutes. `lane-scope.mjs` is base-ref tooling, so a filter with no new CLI argument lands in one PR.
  2. Add `branches: [main]` to `ci.yml`'s `pull_request` trigger (X17: the post-merge policy accepts it), so honest non-`main` PRs produce no `ci.yml` runs.
  3. Principal-architect states the precondition in ADR-0023 am. L: proof runs are runs against `main`, and the proof model relies on protected `main` with restricted branch creation once the plan allows.
- **Verification.** `lane-scope.test.ts`: F8 and F9 rejected, F7 still accepted; a `base.sha` outside `main`'s ancestry rejected.

#### PR46-SEC-14 (INFO): a unit test that reads a non-tooling-input doc is inherited across docs pushes

- **CWE-1068** (Inconsistency Between Implementation and Documented Design) · **OWASP A04:2021**.
- **Where.**
  - `tools/db/render-rls-dr-a14.test.ts` reads `docs/03-architecture/data-model.md` §4.3 and compares the DR-A14 SQL block byte for byte with the templates.
  - `main`'s `tooling_inputs` does not list the file, so the corpus classifies it as docs (light).
- **Impact.** An edit of the reviewed RLS design text in a docs push skips the drift check in lane A (and in lane B staleness). The next unrelated code PR then fails on it. Enforcement (the templates and SQL) is unchanged. INFO.
- **Remediation.** qa-lead adds `docs/03-architecture/data-model.md` to the manifest's `tooling_inputs` (base-ref data, one line). This makes such edits code for lane scope and stale for lane B. The record-format tripwire (records are docs) needs nothing, because the record step evaluates the PR's own record on every push.

### R2.12 Record simulation, light-run prediction and hygiene

`record-sim.mjs`, run in a scratch `git clone --shared` with a sparse working tree. Scenario commits are plumbing-only in the clone. `main`'s real `check-security-owned-paths.mjs` runs with `--pr 46 --json`. Unless stated, the base is `main` at `2ca8a9f` (`origin/main` when this round was written; docs-only since `d753027`). The checker is byte-identical on `main` and the head, because the PR does not change it. The clone was removed afterwards.

| # | Scenario | Expected | Result |
|---|---|---|---|
| A | This record committed on `ad30316` | pass | pass at `ad30316` (exit 0, 43 owned paths) |
| A' | Same, base `d753027` (the PR merge base) | pass | pass at `ad30316` (exit 0) |
| B | Round-1 record only (the branch as pushed; what run 43609726745 saw) | missing | missing (exit 1) |
| C | This record named `PR-0045-…` | missing | missing (exit 1) |
| D | Last Verdict row changed to FAIL | missing | missing (exit 1) |
| E | Owned edit after the record (`tools/ci/lane-scope.mjs`) | missing | missing (exit 1) |
| F | Docs-only commit after the record (`docs/04-plan/spikes/SPK-07.md`, where the first light-run figure goes) | pass | pass at `ad30316` (exit 0) |
| G1-G6 | An edit after the record of `.github/workflows/ci.yml`, `eslint.config.mjs`, `package.json`, `tools/ci/check-workflow-policy.mjs`, `tools/deps/rebuild.mjs` or `jest.config.ts` (what a union with #42 or #39 brings) | missing | missing (exit 1) each |
| G7 | `.github/CODEOWNERS` edited after the record (the R2.8 change in this PR) | missing | missing (exit 1, 44 owned paths) |
| H | Merge of current `main` (`2ca8a9f`, docs only) after the record | pass | pass at `ad30316` (exit 0) |
| I | This round's Head row replaced by the round-1 head `12ea6a6` | missing | missing (exit 1) |
| J | This round's Head row naming the code head `6e94ba4` instead (control) | pass | pass at `6e94ba4` (exit 0) |

**Light-run prediction for the push of this record** (the head's `classify` and `lookupProofs`, real jobs API, GET only):
- `push_scope=docs` (light), `pr_docs_only=false`.
- `identical` = the record commit, `ad30316` and `6e94ba4`.
- `security_paths=true`, `record_ok=true` (record check `pass`).
- Code proof run 43609726745 on `ad30316`; no security proof; `security_integration_due=true`.

So `fast-lane` runs light, `security-integration` runs (the `if` holds through the code proof), and with that job green `gateVerdict` gives `MERGE-READY`.

**Hygiene:**
- **D-SEC-PR23-02 statements.** The PR body's fix-cycle gate table carries both verbatim: "`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first" and "`.git/info/exclude` is empty". The run of record is profile `pr`, and there is no lockfile change.
- **Host-fragment scan** (count-only). Needles are computed at run time: the account name, its 8.3 stem, the home and temp directories in four spellings each, the host name, the git e-mail, the drive-letter and POSIX users-directory forms, and the directory-account prefix. A built-in positive control fires for every needle.
  - The three new run directories (23 files): **0 for every needle**.
  - The 57 other files added or modified since round 1: 0 for every host-specific needle. The two generic path patterns hit only the fictitious fixtures in `tools/quality/heavy.test.ts` (known from round 1) and one fictitious example in a code-reviewer memory note.
- **Superseded runs.** `20261114T1401Z_382a6e1` (PASS against the pre-#47 base) and `20261114T1421Z_814c5bf` (PASS, before the heap fix) are committed and harmless: lane A rejects both as stale (log above), and no FAIL run was added.
- **This record.** A gitleaks v8.30.1 default-ruleset emulation (the pinned tag's `config/gitleaks.toml`: 222 rules, 215 compiled) found 0 findings over this section. Run-time positive controls for a GitHub token, an AWS key id and a generic key all fire. Lane A's real gitleaks scans the record push. The record has two rows whose first cell is `Head` (round 1's `12ea6a6`, which a round-1 PASS_WITH_FOLLOW-UPS bound, PR10-SEC-21, and this round's `ad30316`). The last `Verdict` row is this round's. A count-only host-fragment scan of the final file is 0 for every host-specific needle.

### R2.13 Checks owed (routed)

| When | Check |
|---|---|
| The push of this record (first light run) | The `scans` summary shows the predicted values. `security-integration` runs and succeeds (`catalog-c1-c14`, `rls-cross-tenant`). `ci-gate` shows `MERGE-READY`. The orchestrator merges only on that exact SHA. SPK-07 §6 records the billed minutes (a docs-only follow-up keeps this record valid, R2.12 F) |
| Merge of #46 (orchestrator) | PR46-SEC-11 interim rule (proof run ≤ 24 h old) from this merge on, and P1 applied to every later union decision |
| #42 or #39 merges first | Union per R2.9, then a merge-only security round against R2.9 |
| TASK-286 policy PR (stage 2) | PR46-SEC-11 item 1, PR46-SEC-12 (pin and `${GATE_LANE_SCOPE:?}`; proof re-read in `ci-gate`), PR33-SEC-09 for the other `GATE_*` |
| 015-C | PR46-SEC-13 item 1 (filter) and 2 (`branches: [main]`) unless TASK-286 takes them; PR46-SEC-04, -05, -07 remainder, -02 item 3 |
| CODEOWNERS PR (R2.8) | Before the first identity-module code PR; at the latest Wave-0 exit |
| Next manifest commit (qa-lead) | PR46-SEC-14 together with D-SEC-PR47-01's SEC-TC-74 move |
| G3 | No LOW of this record open without a recorded owner decision; lane C `release-candidate` carries the audit (PR46-SEC-05/-11) |

### R2.14 Proposed decision entry (for the orchestrator; DECISIONS.md not edited)

**D-SEC-PR46-02 · 2026-11-14 · security-analyst · PR #46 (TASK-015 015-B) security delta round 2 at `ad30316` (fix cycle 1 + CI-minutes stage 1) = PASS_WITH_FOLLOW-UPS.**

- **Result.** 0 C/H/M. Closed: PR46-SEC-01, -02 (refusal), -03 (stage-1 shape), -06. Partly closed: -07 (pr-secrets) and -10 (wording).
- **Verified.** The §6.2 invariants hold. Proof inheritance only from a code-identical tree (tree diff with mode guard), read from step conclusions; light, failed, cancelled, in-progress and current runs are never proofs; `ci-gate` is red on every gap of a 16-case matrix. The token is step-scoped and `actions:` is limited to `scans` and `ci-gate`. `security-integration` is not skippable for a security-path merge candidate and runs only after the supply-chain gates passed on the tree. D-TASK015-52 and -63 are accepted. D-TASK015-58 is accepted with a correction: lockfile lines stay excluded by the gitleaks default allowlist, so lockfile diffs are not scanned in lane A, and `check-lockfile` covers credentialed `resolved` URLs.
- **New LOW, routed.**
  - PR46-SEC-11: the inherited audit has no post-merge backstop. Interim: the orchestrator re-runs a proof run older than 24 h before merging. Fix in the TASK-286 policy PR (audit and signatures on every push) or with PR46-SEC-05. Principal-architect corrects ruling §3.
  - PR46-SEC-12: the `scans` `$GATE_LANE_SCOPE` source is unpinned and `ci-gate` trusts the `scans` proofs. Fix in TASK-286.
  - PR46-SEC-13: proof runs are not bound to the PR's base branch. Fix in 015-C or TASK-286, with the ADR-0023 am. L precondition by principal-architect, before G3 and before any non-`main` PR.
- **New INFO.** PR46-SEC-14 (`data-model.md` into `tooling_inputs`; qa-lead, next manifest commit).
- **Residuals of am. L item 6.** Time is LOW (PR46-SEC-11). Base movement, the token and the bootstrap are INFO, accepted (P1 must be applied).
- **CODEOWNERS ruling.** Add `/apps/api/src/modules/identity/` and `/packages/config/` to CODEOWNERS and `REQUIRED_CODEOWNED_PATHS`: devops-engineer, own PR, before the first identity-module code PR and at the latest Wave-0 exit.
- **Unions.** A union with #42 or #39 voids this record and needs a merge-only round against record R2.9 (one Lint `env:` line; every stage-1 hunk and pin preserved).
- **Reversibility:** High.

### R2.15 Verdict (delta round 2)

| Item | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium. New: 3 LOW (PR46-SEC-11..13), 1 INFO (PR46-SEC-14). Still open from round 1: LOW PR46-SEC-04, -05; INFO -07 (remainder), -08, -09, -10 (test case) |
| Closed | PR46-SEC-01, -02 (refusal; item 3 routed), -03 (stage-1 shape), -06 |
| Merge | Valid for `ad30316` and any later commit that touches no owned path (R2.12 F, H). A union with #42 or #39, or any owned edit, voids it (R2.12 E, G1-G7). The merge also needs `ci-gate` `MERGE-READY` on the record push, which includes this PR's first `security-integration` run |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding at head `ad30316`. CI-minutes stage 1 keeps every deciding gate on the exact head, and it inherits head-code checks only from a verified run on a byte-identical code tree. `security-integration` now runs once per tree, after the supply-chain gates, and cannot be skipped for a security-path merge candidate. The round-1 fix-cycle findings are closed. The three new LOW items limit how far a proof can be trusted (audit freshness, an unpinned tooling source, runs against another base); all are routed with due points before G3 |

## Delta round 3 + merge-only (fix cycle 2 + union with #42, head 4bbce92)

| Field | Value |
|---|---|
| Head | 4bbce92ff4d90299ad6c3c547e824dfb410c4d8f |
| Commits since round 2 | `d76e37f` (the round-2 record), `97bb61c` (merge of `main` `3d9aa8b`: PR #42 `a082560` plus docs), `22e9ea3` (proof binding, R2-M1), `0f17495` (`scans` `pull-requests: read`), `6a845d6` (evidence), `4bbce92` (merge of `main` `5d2c102`, docs only: `docs/sdlc/STATUS.md`). Code head `0f17495`; `0f17495..4bbce92` adds only `docs/**`, and `4bbce92`'s tree equals `git merge-tree --write-tree` of its parents. Merge base `5d2c102` |
| State of `main` | `8c65315` when this round was written. **PR #39 merged at `3f58935` (07:12Z) while this round ran**, under five owned paths that this PR also changes (R3.9). `1757fe1`, `1d24416` and `8c65315` itself are docs only. Before hand-off `main` moved on to `3e13d83`, docs only (the code-review records of PR #48 and of this PR's round 3) |
| Lane A evidence | Run [43687170281](https://github.com/sukhchdit/shipcube/actions/runs/43687170281) on `4bbce92` (`RANGE_BASE` `5d2c102`). `fast-lane` **success**, full mode, every step `success` (Unit tests: 5,197 passed, including `lane-scope.test.ts`, `ci-policy.test.ts` and `check-workflow-policy.test.ts`). `scans` red only at "Security-owned paths need a review record" (44 owned paths; the round-2 record names `ad30316`). `security-integration` skipped (record missing). `ci-gate` `BLOCKED`. Lane scope (head bootstrap): `push_scope=code`, `identical=4bbce92 6a845d6 0f17495`, `security_paths=true`, `record_ok=false`, no proof. No completed run existed on those commits, so the binding made no call (lazy, D-TASK015-64). The step env shows `HEAD_REF` as the plain branch name and `GH_TOKEN` masked. Base-ref `check-evidence`: run `20261115T0609Z_0f17495` accepted, every earlier run rejected (recomputed FAIL under the current base manifest, or not an ancestor of the head) |
| Lane B evidence | `docs/05-quality/tests/runs/20261115T0609Z_0f17495`, profile `pr`, PASS: unit 5,217 (2 skip), integration 301, api 128, catalog-c1-c14 102, rls-cross-tenant 126 (0 skipped). No lockfile change in the PR |
| Owned paths changed | 44 (run log), against 43 in round 2. The added path is the policy fixture `tools/ci/fixtures/workflow-policy/ci-actions-read-top-level.yml` |
| Reviewer / date | security-analyst, 2026-11-15, delta round 3 + merge-only. Read-only on the PR worktree: I appended only this section, and `git status` there was clean before writing. No workflow was triggered and Docker was not used. Read-only `gh api` GETs: run 43687170281 (run, jobs, log), run 43609726745, the PR, its body and the fix-cycle-2 comment, the head branch's pull requests, PR #46's issue events, the closed-PR list and three of its head-branch queries. Probes ran from session scratch (R3.2) |

### R3.1 Summary

**PR46-SEC-13 (code R2-M1) is closed.** `lookupProofs` now accepts a run only when it is a run of this pull request into `main` on this repository: the head branch has exactly one pull request (state all), this one into `main`; the run is on that branch and repository; its `pull_requests` lists exactly this PR with base `main`; and it was created after the PR's last `base_ref_changed` event. Every failed or malformed binding call gives no proof at all. The probe matrix refuses all 45 negative cases and accepts all 6 controls; on the previous head `ad30316`, 42 of those 45 negatives were accepted as proofs (R3.3). Each of 8 mutants of the fix is caught.

**Rulings.**
- D-TASK015-64 (binding shape): accepted.
- D-TASK015-65 (no `base.sha` ancestry check): accepted. I withdraw that sub-item of my R2 remediation, because the field records the PR's current state, not the run's base (verified live, R3.4).
- D-TASK015-66 (`scans` gets `pull-requests: read`): accepted. The scope is needed, read-only, pinned exactly in `PINNED_JOB_PERMISSIONS`, and the token still reaches only the lane-scope step (R3.4).
- `branches: [main]` is pinned by the post-merge policy (`CI_PULL_REQUEST_BRANCHES`), including against widening, globs and `branches-ignore` (R3.4).
- `HEAD_REF` comes in through `env:` only. A branch name cannot inject into the shell, the API path or the outputs (R3.4).

**Merge-only (#42).** The union conforms to R2.9: exactly one Lint `env:` with the heap line; every stage-1 hunk kept (delta equivalence); #42's `prisma-store.ts` exemption kept; no `prisma/tests/spikes/` exemption (R3.5).

**PR46-SEC-12 deferral to TASK-286 (D-TASK015-68): accepted**, due in the TASK-286 policy PR and at the latest before G3 (R3.6).

**Evidence hygiene holds.** The two D-SEC-PR23-02 statements are verbatim, and the host-fragment scan is 0 (R3.10).

**New this round:** two INFO items. PR46-SEC-15: the `pull-requests:` scope is not confined to `scans` the way `actions:` is. PR46-SEC-16: proofs are not bound to the base the proof run tested, so P1 stays procedural; this is live now with PR #39.

**PR #39 merged during this round.** This record is valid for `4bbce92` (R3.10). The merge itself still needs the union with `main` and a merge-only round against R3.9 (P1, D-ORCH-093).

**Findings this round: 0 Critical, 0 High, 0 Medium, 0 new LOW, 2 INFO (new). Verdict: PASS_WITH_FOLLOW-UPS** (R3.13).

### R3.2 Method

| Area | How |
|---|---|
| Diff | Read in full: `97bb61c..0f17495` (`lane-scope.mjs` binding, the policy diff, `ci.yml`, the test and fixture list), the PR body "Fix cycle 2", D-TASK015-64..69, the fix-cycle-2 PR comment, D-ORCH-090 and D-ORCH-093, and code review round 2 (R2-M1, R2-m2, R2-n2, SECURITY-FLAGS) on `main` |
| Q1 binding matrix (`p-bind.mjs`) | The head's (`0f17495`) and the previous head's (`ad30316`) `lookupProofs`, side by side, over a fake API seeded with the real run 43687170281 (its run object and jobs JSON) and each head's `proofSteps(ci.yml)`: 51 cases (R3.3) |
| Q2 binding mutants | 8 text mutants of the head's `lane-scope.mjs`, through the same matrix |
| Q3 live API | The binding's own GETs with the reviewer's read token: the head branch's pull requests, PR #46's issue events, run 43687170281 and run 43609726745; the `head=` filter on three closed PRs whose branches were deleted. GitHub's documentation for the `base_ref_changed` event and for the scopes of the two endpoints |
| Q4 policy matrix (`p-policy.mjs`) | 23 text mutants (Y1-Y21, and R2's X3/X4 re-run) of the head workflows through the head's `checkWorkflow` (the post-merge base-ref policy) and `main`'s (`1757fe1`, equal to `5d2c102`'s), with the unchanged files as controls. Also `main`'s `8c65315` checker (after PR #39) over the merge tree with PR #39 |
| Q5 union | `97bb61c` against `git merge-tree --write-tree` of its parents; a three-way tree compare from `d753027`; delta equivalence of `ci.yml` and `eslint.config.mjs` |
| Q6 record simulation and live-run prediction (`record-sim3.mjs`) | `main`'s real `check-security-owned-paths.mjs` over 17 scenarios in a scratch `git clone --shared`, then the head's `lane-scope.mjs` `main()` CLI (`--pr 46 --head-ref … --lookup --json`) for the record push, against the real API (GET only) |
| Q7 hygiene | Count-only host-fragment scan with a run-time positive control; the PR body's statements; a gitleaks v8.30.1 default-ruleset emulation over this section |

### R3.3 PR46-SEC-13 / R2-M1: the binding (probe matrix)

| Group | Cases | `0f17495` (this head) | `ad30316` (round 2) |
|---|---|---|---|
| Controls: the live run; two runs on the SHA (the newer from another PR); a retarget before the run on events page 1 and on page 2; a bound run on the second identical SHA after a foreign run on the first; `number` as the string `"46"` | C0-C4, E4 | proof (6/6) | proof (6/6) |
| Another PR: another head branch, or the same branch name listing PR 47 | F7, F7b | no proof | proof |
| Another base (`weak`), or base `main` in another repository | F8, F8b | no proof | proof |
| Fork shapes: another head repository with an empty or a mislisted `pull_requests`; the entry's head repository a fork or missing; `head_repository` missing | F9, F9b-F9e | no proof | proof |
| `pull_requests` empty, ambiguous (46 and 47) or not an array; the entry's head ref or the run's `head_branch` differs; no `created_at` | E1-E3, E5-E7 | no proof | proof |
| Retarget cutoff: retarget after the run, at the same second, away before and back after, on events page 2 or page 3, an event without a valid time, a re-run (attempt 2, later `run_started_at`) of a run created before the cutoff | R1-R7 | no proof | proof |
| The head branch's pull requests: a second PR (open into `weak`, or closed into `main`), only another PR, none, this PR currently into `weak`, this PR with a fork head, an object instead of a list | H1-H7 | no proof | proof |
| Failed calls: pulls; events page 1; events page 2 after a full page 1; an event that is not an object; an events object; 50 full pages (the 40-call cap); the jobs call; the runs list; the binding failing on the first identical SHA while the second has a bound run | K1-K9 | no proof | proof for K1-K6 and K9; no proof for K7, K8 |
| CLI inputs: no `--pr`; no `--head-ref`; a head ref with shell metacharacters (`;`, `$(`); the value `--lookup`; a `..`; `--pr 47` with this branch | A1-A5, A7 | no proof | proof |
| Repository casing differs (the fake answers only the canonical path) | A6 | no proof | no proof |

**Result:** 51 of 51 as expected. On `ad30316`, 42 of the 45 negatives were proofs, which is the positive control that the matrix sees the old acceptance.

**Mutants of the fix** (the cases each one flips back to "proof"):

| Mutant | Flipped |
|---|---|
| M1 cutoff check removed | R1-R5, R7 |
| M2 "exactly one PR on the head branch" relaxed to "this PR among them" | H1, H2 |
| M3 base `main` not required (repository still checked) | F8, H5 |
| M4 `head_repository` check removed | F9b, F9e |
| M5 a binding failure ignored (since = 0) | R6, H1-H7, K1-K5, K9 |
| M6 `listed.length !== 1` relaxed to `=== 0` | E2 |
| M7 events paging stops after page 1 | R4, R5, K3, K6 |
| M8 `head_branch` check removed | E6 |

M4 leaves F9 refused, because the empty `pull_requests` list refuses it on its own. The PR's own binding mutants (B1-B28) are all killed by `lane-scope.test.ts` (fix-cycle-2 comment), and that test file passed in run 43687170281.

**Attack paths beyond the matrix:**
- **A stacked or second PR from the same branch.** The pulls check fails the binding closed, also for a closed earlier PR. Live: `pulls?state=all&head=<owner>:<branch>` still lists PRs #41, #29 and #22, whose head branches were deleted. So deleting and re-creating the branch does not reset "one PR per branch".
- **A run against another base that GitHub later lists with base `main`.** `pull_requests` reflects the PR's current state (R3.4). Such a run is refused by the cutoff when the PR was retargeted (R1-R7), and by the pulls check when it came from a second PR (H1, H2).
- **A fork with the same branch name.** Refused by `head_repository` (F9b), and by the empty list.
- **A re-run.** A re-run executes the original event's merge commit, so it must keep the original run's status. GitHub's run schema describes `run_started_at` as "Resets on re-run" and `created_at` as the run's creation time. So a re-run of a pre-cutoff run stays refused (R7). No re-run exists in this repository to confirm this live; if GitHub ever moved `created_at`, a retarget plus a re-run would be the way round the cutoff, and the no-retarget rule (D-ORCH-090) is the backstop.

### R3.4 Rulings on D-TASK015-64..66, the trigger pin and `HEAD_REF`

**D-TASK015-64 (binding shape): accepted.**
- The cutoff uses `<=` and `created_at` (R7 and R3.3).
- The pulls check uses `state=all`. Repositories are compared by `full_name` on pulls items and by the API `url` suffix `/repos/<owner>/<name>` on run entries. Live: a run entry's `base.repo` carries `id`, `url` and `name` only.
- The binding is read lazily, once, within the 40-call cap. For the record push that is 2 calls (one pulls page, one events page; R3.10).

**D-TASK015-65 (no `base.sha` ancestry check): accepted; I withdraw that sub-item of R2.11 PR46-SEC-13 item 1.**
- **Live evidence.** Run 43609726745 ran on `ad30316` with `RANGE_BASE` `d753027` (round 2). Today it lists `head.sha` `4bbce92` and `base.sha` `5d2c102`: the PR's state at its last push, not the run's own base.
- **Consequence.** An entry's `base.sha` says nothing about what that run tested. An ancestry check would mostly be uninformative rather than harmful.
- **What carries the binding instead.** The `base_ref_changed` cutoff. GitHub documents that event in the Issue events API for pull requests. PR #46 has none today (10 `referenced` events), so `since = 0`.

**D-TASK015-66 (`scans` holds `pull-requests: read`): accepted.**
- **Needed.** GitHub's permission table lists `GET /repos/{owner}/{repo}/pulls` under "Pull requests" read only. `GET …/issues/{issue_number}/events` is listed under either "Issues" read or "Pull requests" read for installation tokens. Without the scope, every binding would fail closed and every docs push would run full.
- **Minimal and pinned.** `PINNED_JOB_PERMISSIONS` compares the whole map exactly (`sameMap`):
  - `write` gives `permissions` + `required-gates` (Y10);
  - removing the scope gives `required-gates` (Y11);
  - adding `issues: read` gives `required-gates` (Y12);
  - granting it to `ci-gate` gives `required-gates` (Y13).
- **Token still step-scoped.** `GH_TOKEN` on any other `scans` step gives `gh-token` (Y14). All four `ci.yml` checkouts set `persist-credentials: false`. The steps of `scans` run no npm and no head code after merge.
- **Residual:** PR46-SEC-15 (INFO).

**`on.pull_request.branches: [main]`: pinned.** The post-merge policy (`laneScopeFindings`, `CI_PULL_REQUEST_BRANCHES`) gives a `required-gates` finding for each of these; `main`'s current copy gives 0 for each, because the pin arrives with this PR:
- the filter dropped (Y1);
- `[main, weak]` (Y2);
- `['**']` (Y3);
- a `branches-ignore` next to it (Y4);
- the glob `main*` (Y5).

The filter is defence in depth. A `pull_request` run takes its workflow from the merge with its base, so an attacker-controlled base can drop the filter. The binding in `lane-scope.mjs` is the control, as the new `ci.yml` comment says.

**`--head-ref "$HEAD_REF"` via `env:`.**
- **Where the expression appears.** `${{ github.head_ref }}` occurs once in the head workflows: as the `HEAD_REF` value in the lane-scope step's `env:`. It is not in any `run:`. `PR_TITLE` (commitlint) is the only other event-text expression, and it is also in `env:`.
- **The run line.** It expands `"$HEAD_REF"` in double quotes. Git ref names may contain `$`, `(`, `;` and backticks, but the expansion of a quoted parameter is never re-parsed by the shell.
- **The policy.** `untrusted-expression` refuses the interpolated form under both checkers (Y6). Moving `HEAD_REF` to the job env (Y18), sourcing it from `github.base_ref` (Y8), or dropping it (Y7, Y9) gives `required-gates`.
- **Inside `lane-scope.mjs`.**
  - The `BRANCH` allow-list (`[A-Za-z0-9._/-]`, no leading `-`, `/` or `.`, no `..`, `//`, `@{`, trailing `.lock`, `/` or `.`) refuses the hostile names with no proof (A3-A5).
  - The value reaches `gh api` only inside `encodeURIComponent`, so `gh`'s `{owner}`/`{repo}`/`{branch}` placeholders and query separators cannot appear.
  - `gh` is spawned with an argument vector, not a shell.
  - Notes never echo the branch name, and summary lines pass through `safe()`.
  - The regex has a single anchored `.*` look-ahead, which is linear.

### R3.5 Merge-only: the union with PR #42 (record R2.9)

| Check | Result |
|---|---|
| Purity of `97bb61c` | Against `git merge-tree --write-tree d76e37f 3d9aa8b`, only `ci.yml` conflicts (the Lint comment). The merge differs from that tree only by the conflict block: `main`'s three comment lines are kept and #46's are dropped (D-TASK015-67) |
| Three-way compare from `d753027` | Paths changed by both sides: `ci.yml` and `eslint.config.mjs` only. Every PR-only path equals the PR side (the record equals `d76e37f`'s; the spike stays deleted), and every `main`-only path equals `main`'s |
| `ci.yml` | Exactly one `env:` on the Lint step, with exactly `NODE_OPTIONS: --max-old-space-size=4096`. The `if:` and `run: npm run lint` are unchanged, and the Lint step equals `main`'s byte for byte. **Delta equivalence:** `diff(d753027 → ad30316)` without the Lint hunk equals `diff(3d9aa8b → 97bb61c)` (220 changed lines, identical). So every stage-1 hunk is kept: concurrency, the `fast-lane` classify step and `mode`, the `scans` permissions, outputs and lane-scope step, `security-integration`, `ci-gate`. Two `env:` keys would be refused by `yaml-subset` (Y15), and a preload by `node-options-preload` (Y16). Dropping the heap line passes (Y17; hygiene, accepted in R2 X12) |
| `eslint.config.mjs` | Delta equivalence in both directions (PR delta equals union-from-`main` delta; `main` delta equals union-from-PR delta). #42's `{ files: ['packages/audit/src/store/prisma-store.ts'], allow: ['setter'] }` is kept, and there is no `prisma/tests/spikes/` entry |
| The fix-cycle-2 code on top | `ci.yml` changes after the union: only the trigger filter, the `scans` permission and the lane-scope step `env`/`run` (plus comments). All three are pinned by the post-merge policy (R3.4) |

### R3.6 Earlier findings and the fix-cycle-2 decisions

| Item | Status at `4bbce92` |
|---|---|
| PR46-SEC-13 (LOW) | **Closed** (R3.3, R3.4) |
| PR46-SEC-12 (LOW) | **Open; the deferral to TASK-286 (D-TASK015-68) is accepted.** Re-probed: X3 (`if false;` in the `scans` tooling loop) and X4 (an inserted step that re-points `GATE_LANE_SCOPE`) still give 0 findings under the head's policy. **Why the deferral is acceptable:** the lever still needs an owned `ci.yml` edit, and that edit needs a record. Moving the proof re-read into `ci-gate` needs the binding inputs there too (PR number, head ref, `pull-requests: read`) and their tests. TASK-286 is dispatched right after this merge and must land in November (D-ORCH-090, D-ORCH-093). **The token's reach under X3/X4 is now `contents`, `actions` and `pull-requests` read, all on this repository, which a writer can read anyway. Due:** TASK-286 policy PR; at the latest before G3 |
| PR46-SEC-11 (LOW) | Open, routed as recorded. Interim: before merging, the proof run must be at most 24 h old, or it is re-run. 43687170281 was created 2026-11-15 06:49Z |
| PR46-SEC-14 (INFO) | Open, routed to qa-lead's single manifest PR (D-ORCH-092) |
| PR46-SEC-04, -05 (LOW); -07 remainder, -08, -09, -10 test case (INFO) | Unchanged, routed as in R2.7 |
| D-TASK015-64, -65, -66 | Accepted (R3.4) |
| D-TASK015-67 (`main`'s Lint comment kept) | Accepted; comment only |
| D-TASK015-68 (PR46-SEC-12 → TASK-286) | Accepted (above) |
| D-TASK015-69 (R2-n2 accepted as a residual) | Accepted. Added to the am. L item 6 residuals (R2.5) as INFO. The record-format tripwire (`check-security-owned-paths.test.ts`) reads committed `docs/**`, so its result is inherited across docs pushes. A malformed record of another PR can merge in a light run and turn later unit lanes red. That is an availability issue, not a bypass: the base-ref record step parses each PR's own record on every push |
| Code review R2-m2 (`devOptional` lockfile entries) | **Security view: the routing to principal-architect (SHEET-FOLD-8) is accepted.** Until the amendment, a Prisma CLI or engines change that only touches the lockfile does not select `security-integration`. It still runs lane A in full (every supply-chain gate), and lane B runs every suite. Due with SHEET-FOLD-8, and before G3 |
| Code review SECURITY-FLAG 3 (an inherited `security_proof` is not bound to the current manifest's suite list) | Same class as PR46-SEC-16 (below) |
| Code review round 3 (APPROVED_WITH_NITS, on `main` at `3e13d83`) | Read before hand-off. It agrees on R2-M1, D-TASK015-65 and -66, the `HEAD_REF` plumbing and the union with #42. Its own binding mutants: 41 of 42 killed |
| Code review R3-n1 (NIT: `sameRepo` with a `null` repository, mutant B27 survives) | Agreed. The current code fails closed: my case F9d (an entry head repository of `null`) is refused. One test row pins it; optional |
| Code review R3-n2 (the binding calls have not yet run with the job token) | Agreed; this is the live check of R3.10 and R3.11. A scope gap fails closed |
| Code review R3-n3 (the retarget cutoff relies on `base_ref_changed` being in the issue events API, and on that API being current when the next run reads it) | **Accepted as an INFO residual, added to the am. L item 6 list (R2.5).** (1) The event type is documented for pull requests in the Issue events API, but no retarget has happened on this repository, so it has not been observed live. (2) A writer who retargets to another base, pushes, retargets back and pushes a docs commit within the API's propagation lag could slip a run past the cutoff. That needs a deliberate retarget, which the no-retarget rule (D-ORCH-090) forbids for agents, and write access, so it is in the trusted-writer class of PR10-SEC-04. Revisit when branch protection arrives (PR46-SEC-13 item 3 precondition text) |

### R3.7 Findings of this round

| ID | Severity | Title | Owner / due |
|---|---|---|---|
| PR46-SEC-15 | INFO | The `pull-requests:` scope is not confined to `scans` the way `actions:` is | devops-engineer, TASK-286 policy PR |
| PR46-SEC-16 | INFO | Proofs are not bound to the base the proof run tested; P1 stays procedural (live with PR #39) | Control until then: orchestrator (P1, D-ORCH-093). Fix: devops-engineer, TASK-286, before G3 |

### R3.8 Finding details

#### PR46-SEC-15 (INFO): the `pull-requests:` scope is not confined to `scans` the way `actions:` is

- **CWE-272** (Least Privilege Violation) · **OWASP A05:2021**.
- **Where.** `tools/ci/check-workflow-policy.mjs`: `ACTIONS_READ_JOBS` and the top-level `actions:` refusal have no `pull-requests` counterpart. `PINNED_JOB_PERMISSIONS` covers only the four `ci.yml` jobs.
- **Description.** These pass both policies with 0 findings:
  - `pull-requests: read` added to the workflow-level `permissions:` of `ci.yml` (Y19);
  - the same scope added to a `lane-c.yml` job (Y21).

  `write` is refused everywhere (Y10, Y20).
- **Impact.** None today:
  - every `ci.yml` job pins its permissions exactly, so a workflow-level grant reaches no job;
  - every checkout in the three workflows sets `persist-credentials: false`;
  - `gh-token` keeps the token off every step but the two pinned ones.

  A new job, or a lane C job with a persisted checkout (the PR46-SEC-07 remainder), would make a read scope reachable by head code. INFO.
- **Remediation.** In the TASK-286 policy PR:
  - add `PULL_REQUESTS_READ_JOBS = ['ci.yml:scans']` (plus `ci.yml:ci-gate` once it re-reads proofs, PR46-SEC-12);
  - refuse `pull-requests:` other than `none` on any other job and at workflow level, as for `actions:`.
- **Verification.** Y19 and Y21 give `permissions` findings, and the head workflows stay at 0.

#### PR46-SEC-16 (INFO): proofs are not bound to the base the proof run tested; P1 stays procedural

- **CWE-345** (Insufficient Verification of Data Authenticity) · **OWASP A08:2021**. Rates the R2.5 row 2 residual and code review SECURITY-FLAG 3 together, now that they are live.
- **Where.** `tools/ci/lane-scope.mjs` `lookupProofs` (binding by PR, branch and creation time, not by base content); ruling §3 (P1).
- **Description.**
  - **What a proof carries.** A code or security proof says that a run of this PR on a code-identical head passed. It does not say which `main` that run merged with.
  - **What a light run does.** When `main` later moves under tooling or shared code, a docs push still runs light. It re-runs the base-ref deciding gates, but it inherits lint, type-check, unit, build and `security-integration` from a run that tested the old merge.
  - **The live case.** Run 43687170281 tested `merge(4bbce92, 5d2c102)`. PR #39 (`3f58935`) has since changed `jest.config.ts`, `package.json`, `tools/ci/check-workflow-policy.mjs` (+ test) and `tools/deps/rebuild.mjs`, which this PR also changes, plus new `tools/ci` checkers, `.github/CODEOWNERS`, the lockfile and `prisma/**`. The merge tree is clean, so the record push will run, and `ci-gate` can show `MERGE-READY` for a merge that no head-code check has seen (R3.10).
  - **What controls it today.** P1 (D-ORCH-093: union, then a merge-only round). Code review SECURITY-FLAG 3, the suite list of an inherited `security_proof`, is the same gap.
- **Exploitability / impact.**
  - No attacker lever beyond merge timing: the inherited checks are the ones the PR passed.
  - The risk is a semantic conflict, or a new `main` rule that the merged code never met, reaching `main`. Post-merge lane A on `main` is off (`CI_MAIN_FAST_LANE`), so `nightly` or `wave-end` would be the first to see it.
  - The procedural control is in place and applied. INFO.
- **Remediation (TASK-286).**
  - In base-ref `lane-scope.mjs`, void a proof when `git log -1 --format=%cI <base> -- <P1 paths ∪ tooling_inputs>` is later than the proof run's `created_at`. Squash merges on `main` set the committer date to the merge time.
  - Alternatively, have the proof run publish its `RANGE_BASE` (a job output), and require `merge-base --is-ancestor` plus an empty `git diff --name-only <proof base> <base> -- <P1 paths>`.
  - Until then, the orchestrator applies P1 to every union decision (D-ORCH-093 does so here).
- **Verification.** A `lane-scope.test.ts` case where a commit on `main` touching `package.json` is newer than the candidate run gives no proof, and the same commit touching only `docs/**` keeps the proof.

### R3.9 PR #39 merged during this round: union checklist (PR #46 is the second merger)

PR #39 merged at `3f58935`, so the union voids this record (R3.10 G), and a merge-only round against this list follows (D-ORCH-093). `git merge-tree --write-tree 4bbce92 8c65315` is clean (tree `7600a9d`).

| Path (owned) | What the union must preserve |
|---|---|
| `.github/workflows/ci.yml` | No text overlap: `main`'s `ci.yml` is still `5d2c102`'s. The union's `ci.yml` must equal `4bbce92`'s byte for byte. That means one Lint `env:` with the heap line, every stage-1 hunk, and the fix-cycle-2 hunks: `branches: [main]`, `scans` `pull-requests: read`, and the lane-scope `HEAD_REF` env and `--head-ref "$HEAD_REF"` |
| `tools/ci/check-workflow-policy.mjs` (+ test, fixtures) | #39's `REQUIRED_CODEOWNED_PATHS` additions and any rule #39 added. Every #46 addition: the round-1 and stage-1 rules, `gateStepIndex` exported, and the fix-cycle-2 `CI_PULL_REQUEST_BRANCHES`, `LANE_SCOPE_RUN`/`LANE_SCOPE_ENV` with `HEAD_REF`, `PINNED_JOB_PERMISSIONS.scans` with `pull-requests: read`, and the trigger check in `laneScopeFindings`. The test keeps both PRs' cases. In the merge tree, all named symbols are present |
| `tools/deps/rebuild.mjs` | #39's Prisma step through `prismaArgv` (no npm) and #46's `PLAYWRIGHT_REDIRECT` / `playwrightRedirects()` refusal before any step. Both are present in the merge tree |
| `jest.config.ts` | #39's opt-in `stack` project (and its ignore pattern) and #46's comment |
| `package.json` | Both `test:stack` and `ci:minutes` (both present in the merge tree) |
| Policy run on the union | `main`'s `8c65315` checker over the merge-tree workflows: 0 findings each for `ci.yml`, `lane-c.yml` and `nightly.yml`, and `checkCodeowners` 0. The head's checker over the same files: 0 |

The merge-only round checks the purity against `git merge-tree`, the three-way compare, the list above, the policy at 0, fresh lane B evidence (the union changes code), and the live outputs of its record push.

### R3.10 Record simulation, live-run prediction and hygiene

`record-sim3.mjs` runs in a scratch `git clone --shared` with a sparse working tree. Scenario commits are plumbing-only in the clone. `main`'s real `check-security-owned-paths.mjs` (byte-identical at `5d2c102`, `0f17495` and `8c65315`) runs with `--pr 46 --json`. Unless stated, the base is `main` at `8c65315`. The clone was removed afterwards.

| # | Scenario | Expected | Result |
|---|---|---|---|
| A | This record committed on `4bbce92`, base `8c65315` (`main` after PR #39) | pass | pass at `4bbce92` (exit 0, 44 owned paths) |
| A' | Same, base `5d2c102` (the merge base) | pass | pass at `4bbce92` (exit 0, 44 owned paths) |
| A'' | Same, base `1757fe1` (`main` when the round was briefed) | pass | pass at `4bbce92` (exit 0, 44 owned paths) |
| B | Round-2 record only (the branch as pushed; what run 43687170281 saw) | missing | missing (exit 1, 44 owned paths) |
| C | This record named `PR-0045-…` (round-2 record left in place) | missing | missing (exit 1, 44 owned paths) |
| D | Last Verdict row changed to FAIL | missing | missing (exit 1, 44 owned paths) |
| E | Owned edit after the record (`tools/ci/lane-scope.mjs`) | missing | missing (exit 1, 44 owned paths) |
| F | Docs-only commit after the record (`docs/07-ops/CI-CD.md`) | pass | pass at `4bbce92` (exit 0, 44 owned paths) |
| G | Union with `main` `8c65315` (PR #39) after the record (real merge tree) | missing | missing (exit 1, 44 owned paths) |
| G1 | Union-like edit of `jest.config.ts` after the record | missing | missing (exit 1, 44 owned paths) |
| G2 | Union-like edit of `package.json` after the record | missing | missing (exit 1, 44 owned paths) |
| G3 | Union-like edit of `tools/ci/check-workflow-policy.mjs` after the record | missing | missing (exit 1, 44 owned paths) |
| G4 | Union-like edit of `tools/deps/rebuild.mjs` after the record | missing | missing (exit 1, 44 owned paths) |
| G5 | Union-like edit of `.github/workflows/ci.yml` after the record | missing | missing (exit 1, 44 owned paths) |
| H | Merge of a docs-only `main` (`1757fe1`) after the record, base `1757fe1` | pass | pass at `4bbce92` (exit 0, 44 owned paths) |
| I | This round's Head row replaced by the round-2 head `ad30316` | missing | missing (exit 1, 44 owned paths) |
| J | This round's Head row naming the code head `0f17495` instead (control) | pass | pass at `0f17495` (exit 0, 44 owned paths) |
| K | Row check of the candidate: first cells starting with `Head` | 3 (`12ea6a6`, `ad30316`, `4bbce92`) | 3; three `Verdict` rows, and the last table row of the file is this round's `Verdict` row |

All 17 checker scenarios give the expected result. G is the real merge tree of this record with `main` `8c65315`: the union with PR #39 voids the record, as R3.9 says. Re-runs on the final text with bases `e1768ea` and `3e13d83` (both docs only after `8c65315`) gave the same 17 results and the same prediction.

**Live prediction for the push of this record on `4bbce92`** (the head's `lane-scope.mjs` `main()` with `--pr 46 --head-ref feat/TASK-015-b-lane-c-nightly --lookup`, real API, GET only, base `8c65315`):

- **`fast-lane`** (classify step, head bootstrap of `lane-scope.mjs`): `push_scope=docs`, `mode=light`, `code_changed=false`, `pr_docs_only=false`. The CODE-gated steps are skipped. The base-ref gates run against `main` `8c65315`:
  - the workflow policy: 0 findings on the merge tree (R3.9);
  - `check-evidence`: run `20261115T0609Z_0f17495` accepted, because `0f17495..<record commit>` is docs only.
- **`scans`**, lane-scope step:
  - `identical=<record commit> 4bbce92 6a845d6 0f17495`, `security_paths=true`, `record_ok=true`;
  - `code_proof=43687170281:4bbce92ff4d90299ad6c3c547e824dfb410c4d8f`, `security_proof=` (empty), `security_integration_due=true`;
  - no note. A binding problem would show as `no proof (binding, fail closed): …`, and a refused run as `run … is not a run of this PR into main: …`;
  - 7 API calls: four runs lists, the binding's pulls list and one events page, and the jobs of run 43687170281. The summary lists `tools/ci/lane-scope.mjs` as "head (bootstrap: not on the base ref yet)".
  - Gitleaks (`8c65315..<record commit>`, first parent), Semgrep, openapi-breaking and the record step pass. The record step passes at `4bbce92` (sim A). The gitleaks emulation of this section is 0, and the PR body's range scan of `origin/main..4bbce92` was 0.
- **`security-integration`** runs: `catalog-c1-c14` and `rls-cross-tenant`, the active `security_integration_suites` of `8c65315`'s manifest.
- **`ci-gate`**: `MERGE-READY` if `security-integration` succeeds. Control: `BLOCKED: security-integration red` if it fails.
- **Assumptions.**
  - The prediction used the reviewer's read token. The job's token holds `contents`, `actions` and `pull-requests` read; if GitHub answered it differently, the binding fails closed (no proof, `ci-gate` red with "no code proof for this tree"), never open.
  - It also assumes that `main` stays mergeable with the branch. A conflicting PR gets no `pull_request` run at all, so the merge tree with `8c65315` (clean) is what GitHub builds today.

**This is the first live test of the binding, and it is not a merge authorisation.** Even if `ci-gate` shows `MERGE-READY`, PR #39's move of five owned paths requires the union and a merge-only round first (P1, D-ORCH-093; PR46-SEC-16). The CI-minutes guard is close (forecast 97.8 %). A cheaper order is to skip this push, union first (a full run, with the binding not exercised), and push the merge-only record on the union head: that push is then the first live binding test, with the union's full run as the proof, and `security-integration` runs once on the final tree. Code review round 3 recommends the same order (its R3.7 item 2). Either order is sound; the cheaper one saves one light run and one `security-integration` run.

**Hygiene:**
- **D-SEC-PR23-02 statements.** The PR body's fix-cycle-2 gate table carries both verbatim: "`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first" and "`.git/info/exclude` is empty". The run of record is profile `pr`, with no lockfile change and no FAIL run added.
- **Host-fragment scan** (count-only). Needles are computed at run time: the account name, its 8.3 stem, the home and temp directories in four spellings each, the host name, the git e-mail, the drive-letter and POSIX users-directory forms, and the directory-account prefix. A built-in positive control fires for every needle.
  - The new run directory (8 files): **0 for every needle**.
  - The 8 files the fix-cycle-2 commits add or change: 0 for every needle.
  - All 96 files added or changed in `ad30316..0f17495` (mostly PR #42's, through the union): 0 for every host-specific needle. The two generic users-directory patterns hit once each, in a code-reviewer memory note and a security-analyst memory note. Both are fictitious examples that came from `main`.
- **This section.** A gitleaks v8.30.1 default-ruleset emulation (the pinned tag's `config/gitleaks.toml`) finds 0 findings, and the run-time positive controls fire. Lane A's real gitleaks scans the record push. The record now has three rows whose first cell is `Head` (`12ea6a6`, `ad30316` and this round's `4bbce92`), and the last `Verdict` row is this round's. A count-only host-fragment scan of the final file is 0 for every host-specific needle.

### R3.11 Checks owed (routed)

| When | Check |
|---|---|
| The push of this record (if the orchestrator keeps this order) | The `scans` summary shows the predicted values (R3.10), in particular `code proof: run 43687170281:4bbce92…` with no binding note. `security-integration` runs and succeeds (`catalog-c1-c14`, `rls-cross-tenant`). `ci-gate` shows `MERGE-READY`. **No merge on it** (R3.9). If the binding fails closed instead (`no proof (binding, fail closed): …` in the summary), read the note. A `pull requests of the head branch` or `events` problem means the token scope or the API answer differs from the reviewer's read token. There is no security impact (fail closed). The fix (code review R3-n2): add `issues: read` to `scans` and pin it in `PINNED_JOB_PERMISSIONS` (a new owned change, so a delta round), or close and reopen the PR for a full run. Record the outcome in the PR comment. The same check applies to whichever push is the first light run (R3.10) |
| Union with `main` after PR #39 | R3.9 list; then a merge-only security round naming the union head (or a later docs-only commit on it) |
| Merge of #46 (orchestrator) | PR46-SEC-11 interim rule (a proof run at most 24 h old); P1 for every later union (PR46-SEC-16) |
| TASK-286 policy PR (stage 2) | PR46-SEC-11 item 1; PR46-SEC-12 (the pin, `${GATE_LANE_SCOPE:?}`, and the proof re-read in `ci-gate` with the binding); PR46-SEC-15; PR46-SEC-16 (mechanical P1); PR33-SEC-09 for the other `GATE_*` |
| SHEET-FOLD-8 (principal-architect) | Code review R2-m2 (`devOptional`), before G3 |
| Next manifest PR (qa-lead) | PR46-SEC-14, with SEC-TC-74/73 and `rbac-matrix` (D-ORCH-092) |
| 015-C | PR46-SEC-04, -05, -07 remainder, -02 item 3 |
| G3 | No LOW of this record open without an owner decision; lane C `release-candidate` carries the audit (PR46-SEC-05/-11) |

### R3.12 Proposed decision entry (for the orchestrator; DECISIONS.md not edited)

**D-SEC-PR46-03 · 2026-11-15 · security-analyst · PR #46 (TASK-015 015-B) security delta round 3 + merge-only at `4bbce92` (fix cycle 2 + union with PR #42) = PASS_WITH_FOLLOW-UPS.**

- **Result.** 0 C/H/M, no new LOW. **PR46-SEC-13 / code R2-M1 closed.**
- **The binding.** A proof is a run of this PR into `main`:
  - the head branch has exactly one PR (state all, so closed PRs count, and live checks show the `head=` filter still lists them after the branch is deleted);
  - the run is on that branch and repository;
  - its `pull_requests` lists exactly this PR with base `main`;
  - it was created after the last `base_ref_changed`;
  - any failed or malformed call gives no proof.

  Matrix: 51/51 (45 negatives refused; 42 of them were proofs at `ad30316`). 8 of 8 mutants of the fix are caught.
- **Rulings.**
  - D-TASK015-64 accepted.
  - D-TASK015-65 accepted: the security record's ancestry sub-item is withdrawn, because `pull_requests` carries the PR's current state (live: run 43609726745 lists `5d2c102`/`4bbce92`).
  - D-TASK015-66 accepted: `pull-requests: read` is needed (pulls list), read-only, pinned exactly, and the token stays on the one step.
  - `branches: [main]` is pinned against drop, widening, glob and `branches-ignore`.
  - `HEAD_REF` comes only through `env:`: `untrusted-expression` refuses the interpolated form, and the `BRANCH` allow-list plus `encodeURIComponent` neutralise hostile names.
  - D-TASK015-67/-69 accepted. R2-n2 is added to the am. L residuals.
  - D-TASK015-68 accepted: PR46-SEC-12 goes to the TASK-286 policy PR, at the latest before G3.
  - R2-m2 routing to SHEET-FOLD-8 accepted (before G3).
  - Code review R3-n3 accepted as an INFO residual (am. L item 6 list): the retarget cutoff relies on `base_ref_changed` being present and current in the issue events API. Slipping it needs a deliberate retarget by a writer within the API lag, which D-ORCH-090 forbids.
- **Union with #42.** It conforms to R2.9: one Lint heap `env:`, every stage-1 hunk (delta equivalence), #42's `prisma-store.ts` exemption, no spike exemption.
- **New INFO** (devops-engineer, TASK-286):
  - PR46-SEC-15: `pull-requests:` is not confined like `actions:`.
  - PR46-SEC-16: proofs are not bound to the tested base, so P1 stays procedural; the orchestrator applies P1 until it is mechanical.
- **PR #39 merged (`3f58935`) during the round.** The record is valid for `4bbce92`. The merge needs the union and a merge-only round against record R3.9. The record push is the first live binding test (predicted proof: run 43687170281), not a merge authorisation.
- **Reversibility:** High.

### R3.13 Verdict (delta round 3 + merge-only)

| Item | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium. New: 2 INFO (PR46-SEC-15, -16). Still open: LOW PR46-SEC-04, -05, -11, -12; INFO -07 (remainder), -08, -09, -10 (test case), -14 |
| Closed | PR46-SEC-13 (code R2-M1) |
| Merge | Valid for `4bbce92` and any later commit that touches no owned path (R3.10 A, F, H). The union with `main` after PR #39 voids it (R3.10 G), so the merge needs that union and a merge-only round against R3.9, then `ci-gate` `MERGE-READY` on the exact final head (with `security-integration`) and the PR46-SEC-11 interim rule |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding at head `4bbce92`. Proofs are now bound to runs of this PR into `main`: another PR, a fork, another base, a retarget, a second PR on the branch, an empty or ambiguous `pull_requests` and every failed call give no proof. The trigger filter, the `pull-requests: read` scope and the `HEAD_REF` plumbing are pinned by the post-merge policy, and branch names cannot inject. The union with PR #42 kept every stage-1 hunk and one heap line. Two INFO items remain (scope confinement, base binding of proofs), both routed to TASK-286 |

## Merge-only round (union with #39/#48, head 0230e50)

| Field | Value |
|---|---|
| Head | 0230e50f67dd34012896b8a98316feb8e4512db2 |
| Commits since round 3 | `a351dbc` (the round-3 record; parent `4bbce92`), `f981713` (merge of `main` `78cd2a4`, which brings PR #39 `3f58935`, PR #48 `be4b0d3` and docs; the code head), `0230e50` (lane B evidence `20261115T1431Z_f981713`, 8 files, docs only). One push `4bbce92..0230e50` at 14:50:59Z. Merge base with `main`: `78cd2a4` |
| State of `main` | `78cd2a4` at the union. Since then: `cb96be4` and `f0d5052` (docs); **PR #52 `3eafa74` (TASK-285, merged 14:45:40Z)**; then `7e97eb7`, `dbfb1bd` and `bf8b866` (docs). PR #52 changes `packages/audit/src/actions{,.test}.ts`, `prisma/bootstrap/91-audit-actions-v2.sql`, three `prisma/tests` suites and four `tools/db` files. None of them is a path of this PR. `tools/ci`, `tools/quality`, `.semgrep`, `.gitleaks.toml`, `.semgrepignore`, `.gitignore` and `eslint.config.mjs` are blob-equal at `78cd2a4` and `bf8b866`. `git merge-tree --write-tree 0230e50 bf8b866` is clean (`a233fda`) |
| Lane A evidence | Run [43726593786](https://github.com/sukhchdit/shipcube/actions/runs/43726593786) on `0230e50`, created 14:51:04Z, attempt 1. GitHub's test merge is `731eb7d` "Merge 0230e50 into dbfb1bd" (parents `dbfb1bd`, `0230e50`; tree `d10ad7f`, equal to the local `git merge-tree --write-tree 0230e50 dbfb1bd`), so the run tested this PR merged with PR #52. `RANGE_BASE` was `78cd2a4`, the merge base, not `main`'s tip (MO.6). `fast-lane` **success**, full mode, 33 of 33 steps `success`. `scans`: gitleaks (28 commits) no leaks, Semgrep pass, openapi-breaking PASS. The only red step is "Security-owned paths need a review record" (44 owned paths): the three `Head` rows name `12ea6a6`, `ad30316` and `4bbce92`, and the five overlap files changed after `4bbce92`. `security-integration` skipped; `ci-gate` `BLOCKED`. Lane scope: `push_scope=code`, `mode=full`, `identical=0230e50 f981713`, `security_paths=true` (the deleted `prisma/tests/spikes/spk03-rls-tx.int.test.ts`), `record_ok=false`, `code_proof` empty, `security_integration_due=false`. `GATE_LANE_SCOPE` and `GATE_SECURITY_PATHS` were head bootstrap; the other three gate scripts came from the base ref. `HEAD_REF` showed as the plain branch name, and `GH_TOKEN` was masked |
| Lane B evidence | `docs/05-quality/tests/runs/20261115T1431Z_f981713`, profile `pr`, PASS (`git_dirty` false, `build_clean` true, no `env_overrides`, no `invalid_reasons`). Suites: unit 5,883 (2 skip), integration 303, api 128, catalog-c1-c14 102, rls-cross-tenant 126 (0 skipped). Merged coverage 99 % lines, 96.93 % branches. Base-ref `check-evidence` (`78cd2a4`'s `tools/quality`, re-run by me on `0230e50`): PASS. The run is accepted and 29 earlier runs are rejected (stale, not an ancestor, or missing the `packages/audit` gate cases). The notes are the planned suites and the parked SEC-TC-74. `package-lock.json` at `0230e50` equals `78cd2a4`'s (blob `be89160`): the PR's net change has no lockfile change. #39's lockfile change reaches the branch through the merge |
| Owned paths changed | 44 (run log, and the checker in MO.10), the same as round 3 |
| Reviewer / date | security-analyst, 2026-11-15, merge-only round against R3.9. Read-only on the PR worktree: I appended only this section, and `git status` there was clean before writing. No workflow was triggered and Docker was not used. Read-only `gh api` GETs: PR #46 (body, state), comment 6896616255, run 43726593786 (run, jobs, three job logs), the test-merge commit `731eb7d`, the repository activity of `main` and of the head branch, the head branch's pull requests and PR #46's issue events. Probes ran from session scratch (MO.2) |

### MO.1 Summary

**The union is pure.** `f981713` is a conflict-free merge, and its tree `124180a` equals `git merge-tree --write-tree` of its parents `a351dbc` and `78cd2a4`. The three-way compare from `5d2c102` shows that only the five expected paths were changed by both sides. Those five files are delta-equivalent in both directions (MO.3).

**R3.9 is met** (MO.4):
- the three workflows equal `4bbce92`'s byte for byte;
- there is no spike exemption;
- PR #39's `test:stack`, `stack` project and `prismaArgv`, and PR #48's `authz:matrix`, are present;
- `rebuild.mjs` keeps the Playwright redirect refusal before any step;
- the policy keeps every PR #46 pin and both `REQUIRED_CODEOWNED_PATHS` sets (60 entries).

**Policy.** The head checker and `main`'s checkers (`78cd2a4`, `bf8b866`) give 0 findings on the union. Eight mutant controls give the expected findings (MO.5).

**What the proof run tested.** Run 43726593786 tested this PR merged with `main` `dbfb1bd`, which includes PR #52. `main` has since moved only by docs, so PR46-SEC-16 is not live for the record push (MO.6).

**New INFO PR46-SEC-17.** `RANGE_BASE` (the event's `base.sha`) is the merge base, not `main`'s tip. So base-ref gate tooling is the `main` a branch last merged, not the current one. This has no effect here, because every base-ref input is blob-equal at `78cd2a4` and `bf8b866` (MO.6, MO.9).

**Evidence hygiene holds.** The two D-SEC-PR23-02 statements are verbatim, and the host-fragment scan is 0 (MO.10).

**Live prediction for the record push** (MO.10): `push_scope=docs`, `mode=light`, `code_proof=43726593786:0230e50f67dd34012896b8a98316feb8e4512db2`, `security_integration_due=true`. `security-integration` runs `catalog-c1-c14` and `rls-cross-tenant`, and `ci-gate` shows `MERGE-READY` if they pass.

**Findings this round: 0 Critical, 0 High, 0 Medium, 0 LOW, 1 INFO (new). Verdict: PASS_WITH_FOLLOW-UPS** (MO.13).

### MO.2 Method

| Area | How |
|---|---|
| Inputs | The PR body sections "Union with `main` after PR #39 and PR #48" and "Gate table (union)", comment 6896616255, D-ORCH-095/098/100 and D-SEC-PR52-01 on `main`, and R3.9 of this record |
| Purity | `git merge-tree --write-tree` of the union's real parents, and of `4bbce92` with `78cd2a4` (the form in the PR body). Then a three-way compare from `5d2c102`: path sets per side, and blob equality of every one-sided path in the union |
| Delta equivalence | For each of the five overlap files, the `-U0` hunk bodies (headers stripped): `diff(5d2c102→a351dbc)` against `diff(78cd2a4→f981713)`, and `diff(5d2c102→78cd2a4)` against `diff(a351dbc→f981713)` |
| R3.9 symbols | `git show 0230e50:<path>` reads of `ci.yml`, `eslint.config.mjs`, `jest.config.ts`, `package.json`, `rebuild.mjs` and `check-workflow-policy.mjs`. Blob ids of the workflows at `4bbce92`, `f981713`, `0230e50` and on `main` |
| Policy | `git archive 0230e50` into scratch. The checkers of `0230e50`, `78cd2a4` and `bf8b866` over it, plus 8 text mutants of the union's `ci.yml` and `CODEOWNERS` (`mut.mjs`) |
| Tested base | Run 43726593786: its run object, jobs, job logs (checkout and env groups), the test-merge commit, and the repository activity API for `main` and the head branch |
| Record simulation and live prediction (`record-sim-mo.mjs`) | 14 scenarios in a scratch `git clone --shared` with a sparse working tree. The commits are plumbing only. The checkers are `main`'s real `check-security-owned-paths.mjs` copies at `78cd2a4` and `bf8b866` (blob-equal to the head's). Then the head's `lane-scope.mjs` `main()` CLI (`--pr 46 --head-ref … --lookup --json`) for the record commit, against the real API (GET only, through `gh` with its stored auth, `GH_TOKEN` removed from the child env, three attempts per call as in `ghApi`), with `--base` `78cd2a4` and with `bf8b866`. The clone was removed afterwards |
| Hygiene | Count-only host-fragment scan (`hostscan.mjs`; needles computed at run time, 17 needles, positive control). The PR body's statements. A gitleaks `generic-api-key`-shaped scan of this section (MO.10) |

### MO.3 Union purity

| Check | Result |
|---|---|
| `f981713` against `git merge-tree` | Parents `a351dbc` (the round-3 record on `4bbce92`) and `78cd2a4`. `git merge-tree --write-tree a351dbc 78cd2a4` = `124180a` = the union's tree, clean |
| The PR body's form | `git merge-tree --write-tree 4bbce92 78cd2a4` = `969de83`. That tree differs from `124180a` only by the round-3 record (327 added lines, `a351dbc`'s only change). The PR body's "identical to `git merge-tree --write-tree 4bbce92 78cd2a4`" holds once that record is added. This is a wording point, not a finding |
| Three-way compare from `5d2c102` | PR side 95 paths, `main` side 234 paths. Changed by both: exactly `jest.config.ts`, `package.json`, `tools/ci/check-workflow-policy.mjs`, `tools/ci/check-workflow-policy.test.ts` and `tools/deps/rebuild.mjs`. All 90 PR-only paths equal `a351dbc`'s (the spike test stays deleted), and all 229 `main`-only paths equal `78cd2a4`'s. No path differs from both sides |
| Delta equivalence | Both directions are equal for all five files. PR side over `main`: `jest.config.ts` 2 lines, `package.json` 1, `check-workflow-policy.mjs` 546, `.test.ts` 60, `rebuild.mjs` 32. `main` side over the PR: 9, 2, 17, 77 and 18. So both PRs' changes are kept whole, with no hunk lost, duplicated or re-resolved |
| `0230e50` | Adds only the 8 files of `docs/05-quality/tests/runs/20261115T1431Z_f981713/` |

### MO.4 R3.9 checklist

| R3.9 row | Result at `0230e50` |
|---|---|
| `.github/workflows/ci.yml` | Blob `84ba61b` at `4bbce92`, `f981713` and `0230e50` (`main`'s is `a477711`). `lane-c.yml` (`12f9aff`) and `nightly.yml` (`26e63f9`) are also unchanged from `4bbce92`; `main` has neither. So the R3.4/R3.5 results carry over unchanged: <ul><li>one Lint `env:` with exactly `NODE_OPTIONS: --max-old-space-size=4096` (one `NODE_OPTIONS` in the file);</li><li>`pull_request` `branches: [main]`;</li><li>`scans` `contents`/`actions`/`pull-requests` `read`;</li><li>`${{ github.head_ref }}` only as the lane-scope step's `HEAD_REF` env, with the run line `--head-ref "$HEAD_REF"`;</li><li>`ci-gate` as reviewed</li></ul> |
| No spike exemption | `eslint.config.mjs` equals `4bbce92`'s (blob `1e8a779`). It has 0 occurrences of `spikes`, and #42's `prisma-store.ts` `setter` exemption is kept. `main` and the union differ in this file only by this PR's own change |
| `jest.config.ts` | #39's opt-in `stack` project (only with `JEST_STACK=1`) and the `int`/`api`/`stack` test-suffix pattern in the unit ignore list; #46's comment. Delta-equivalent (MO.3) |
| `package.json` | `test:stack` (#39), `authz:matrix` (#48) and `ci:minutes` (#46) are all present. `deps:rebuild` is unchanged |
| `tools/deps/rebuild.mjs` | #39's Prisma step goes through `prismaArgv` (`step.runner === 'prisma'`, imported from `prisma-engines.mjs`). #46's `PLAYWRIGHT_REDIRECT` / `playwrightRedirects()` refusal runs after `forbiddenEnv` and before the first step, so before any network call |
| `tools/ci/check-workflow-policy.mjs` (+ test) | `REQUIRED_CODEOWNED_PATHS` has 60 entries: round 3's list (PR #46 added none) plus #39's 15 (images, compose, infra and the `packages/config` start-up guards). PR #48 added none. Every #46 symbol is present: <ul><li>`CI_PULL_REQUEST_BRANCHES = ['main']`;</li><li>`LANE_SCOPE_RUN` with `--head-ref "$HEAD_REF"`;</li><li>`LANE_SCOPE_ENV.HEAD_REF`;</li><li>`PINNED_JOB_PERMISSIONS.scans` with `pull-requests: read`;</li><li>`ACTIONS_READ_JOBS`;</li><li>`export function gateStepIndex`;</li><li>the trigger check in `laneScopeFindings`</li></ul> The test file is delta-equivalent both ways, so both PRs' cases are kept |
| Policy on the union | 0 findings from all three checkers (MO.5) |

### MO.5 Policy on the union and mutant controls

The checkers are `0230e50`'s (head) and `main`'s `78cd2a4` and `bf8b866` copies (blob-equal to each other). Each runs over `git archive 0230e50`, with the union's `ci.yml`, `lane-c.yml`, `nightly.yml` and `CODEOWNERS`. Each mutant is a copy of the union's `.github` with one text change.

| Case | head | `main` (`78cd2a4` = `bf8b866`) |
|---|---|---|
| Union as is (control) | 0 | 0 |
| m1 `branches: [main]` dropped from `pull_request` | `required-gates` | 0 (the pin arrives with this PR, as in R3 Y1) |
| m2 `scans` `pull-requests: write` | `permissions`, `required-gates` | `permissions` |
| m3 `--head-ref "${{ github.head_ref }}"` interpolated | `untrusted-expression`, `required-gates` | `untrusted-expression` |
| m4 a second `NODE_OPTIONS` key on the Lint step | `yaml-subset` | `yaml-subset` |
| m5 the heap line plus `--require ./x.cjs` | `node-options-preload` | `node-options-preload` |
| m6 `CODEOWNERS` loses `/infra/` (#39's set) | `codeowners-coverage` | `codeowners-coverage` |
| m7 `CODEOWNERS` loses `/tools/ci/` (the older set) | `codeowners-coverage` | `codeowners-coverage` |
| m8 `CODEOWNERS` loses `/tools/compose/` (#39's set) | `codeowners-coverage` | `codeowners-coverage` |

9 of 9 as expected. #39's coverage rows are active in both checkers, and the head checker refuses each #46 pin that is mutated.

### MO.6 What the proof run tested, and what "base ref" means

- **The tested tree.**
  - Run 43726593786 checked out `refs/pull/46/merge` = `731eb7d`, whose first parent is `main`'s tip `dbfb1bd`. The activity API confirms the timing: `main` reached `dbfb1bd` at 14:46:57Z, and the branch push came at 14:50:59Z.
  - So lint, type-check, unit, build and every supply-chain gate of that run saw this PR merged with PR #52 (`3eafa74`).
  - Since then `main` gained only `bf8b866`. The union trees `d10ad7f` (with `dbfb1bd`) and `a233fda` (with `bf8b866`) differ only in `docs/sdlc/DECISIONS.md` and `docs/sdlc/STATUS.md`.
  - The inherited code proof therefore covers the tree the record push will test. PR46-SEC-16 is not live for this push. It becomes live again if `main` gains a non-docs commit before the push or the merge (P1, MO.11).
- **The base ref.**
  - The event's `pull_request.base.sha`, and so `RANGE_BASE`, was `78cd2a4`: the merge base of `0230e50` and `main`, not the tip `dbfb1bd` that the run actually merged with. The PR object still shows `base.sha` `78cd2a4` now that `main` is at `bf8b866`.
  - Every base-ref input therefore came from `78cd2a4`: lane-scope's tooling inputs, the workflow policy, `check-evidence`, the scans tooling and configuration, and `security-integration`'s manifest.
  - For this PR that makes no difference, because each of them is blob-equal at `78cd2a4` and `bf8b866` (header).
  - In general it means that a gate added to `main` reaches a PR only when the PR merges `main` (PR46-SEC-17).
- **Correction to R3.10.** That prediction said the base-ref gates "run against `main` `8c65315`". Under the observed behaviour they would have run against the merge base `5d2c102`. That push never happened on its own (D-ORCH-095), and the two refs' gate inputs were equal, so nothing depended on it.

### MO.7 Earlier findings and decisions

| Item | Status at `0230e50` |
|---|---|
| PR46-SEC-11 (LOW) | Open, routed. Interim rule: the proof run must be at most 24 h old at merge. Run 43726593786 was created 2026-11-15 14:51:04Z, so a merge after 2026-11-16 14:51Z needs a fresh full run on the code tree first (a code push, or close and reopen) |
| PR46-SEC-12 (LOW) | Open; deferral to TASK-286 (D-TASK015-68) unchanged. The union does not touch the `scans` tooling loop (`ci.yml` blob-equal) |
| PR46-SEC-15, -16 (INFO) | Open, routed to TASK-286. -16 is not live for the record push (MO.6) |
| PR46-SEC-04, -05 (LOW); -07 remainder, -08, -09, -10 test case, -14 (INFO) | Unchanged, routed as in R3.6 |
| D-ORCH-100 (CI-minutes guard) | Consistent with this order. No code push is still coming for this PR, so the record push is the one light run. `security-integration` runs once on the final tree, and TASK-286 follows the merge |

### MO.8 Findings of this round

| ID | Severity | Title | Owner / due |
|---|---|---|---|
| PR46-SEC-17 | INFO | Base-ref gate tooling is the PR's merge base (`pull_request.base.sha`), not `main`'s tip | devops-engineer, TASK-286 (with PR46-SEC-16); control until then: P1 (orchestrator) |

### MO.9 Finding details

#### PR46-SEC-17 (INFO): base-ref gate tooling is the PR's merge base, not `main`'s tip

- **CWE-693** (Protection Mechanism Failure) · **OWASP A08:2021**.
- **Where.** `.github/workflows/ci.yml`:
  - `RANGE_BASE: ${{ github.event.pull_request.base.sha || github.event.before }}` in `fast-lane`, `scans` and `security-integration`;
  - every base-ref extraction that follows it: `git archive "$RANGE_BASE" tools/ci`, `tools/quality`, `.semgrep`, `.gitleaks.toml`, `.semgrepignore`, `.gitignore`, the lint fixtures, and the `security-integration` manifests.
- **Description.**
  - **What GitHub sent.** For the synchronize event of run 43726593786, `pull_request.base.sha` was `78cd2a4`, the merge base of the head and `main`. `main`'s tip was `dbfb1bd`, the first parent of the test merge that the run checked out.
  - **Effect on the gates.** "Base ref" gate tooling is the `main` commit the branch last merged (or forked from), not the current `main`.
  - **What is still fresh.** The code under test is the merge with the tip, so the test results are current. Only the deciding tooling and the manifests lag.
- **Exploitability / impact.**
  - **Who could use it.** Someone with push access, the trusted-writer class of PR10-SEC-04. They keep a branch on an old base, so a gate added to `main` since then (a policy pin, a Semgrep rule, a manifest activation, a `check-evidence` rule) does not apply to the PR.
  - **What still holds:**
    - `base.sha` is always a commit of `main`'s history, so a PR still cannot supply its own gate code;
    - owned edits still need a record (the record check is on every relevant base);
    - P1 (union, then a merge-only round) moves the merge base to the tip before a merge.
  - **Why it matters anyway.** The post-merge lane on `main` is off (`CI_MAIN_FAST_LANE`), so no run re-checks the squash under the newest gates before `nightly` or `wave-end`.
  - **Here:** no effect, because all base-ref inputs are blob-equal at `78cd2a4` and `bf8b866`. INFO.
- **Remediation (TASK-286, in the same change as PR46-SEC-16).**
  - For `pull_request` runs, take the tooling and manifests from the test merge's first parent:
    ```
    TOOLS_REF=$(git rev-parse HEAD^1)
    ```
    Require that `HEAD^2` is `RANGE_HEAD`, and that `git merge-base --is-ancestor "$RANGE_BASE" "$TOOLS_REF"` holds. Keep `RANGE_BASE` for the range diffs (`<base>...<head>` is unchanged).
  - Publish `TOOLS_REF` as a job output. That is the "tested base" which PR46-SEC-16's option 2 needs, so the light run can void a proof whose tested base is older than the current base on P1 paths.
  - Pin the `git archive` sources to `$TOOLS_REF` in the policy.
- **Verification.**
  - A policy test refuses `git archive "$RANGE_BASE" tools/ci` once `TOOLS_REF` exists.
  - On a PR whose merge base is behind `main`, the scans summary names the tip as the gate source.
  - A `lane-scope.test.ts` case: a proof whose published tested base precedes a P1-path commit on `main` gives no proof.

### MO.10 Record simulation, live-run prediction and hygiene

`record-sim-mo.mjs` committed this record on `0230e50` as the scenario head (plumbing only) and ran `main`'s real checkers (`78cd2a4` and `bf8b866` copies) with `--pr 46 --json`. Both copies gave the same result in every scenario.

| # | Scenario | Expected | Result |
|---|---|---|---|
| A | This record on `0230e50`, base `78cd2a4` (the expected `RANGE_BASE`) | pass | pass by `0230e50` (exit 0, 44 owned paths) |
| A' | Same, base `bf8b866` (`main`'s tip) | pass | pass by `0230e50` |
| A'' | Same, base `dbfb1bd` | pass | pass by `0230e50` |
| B | `0230e50` as pushed (round-3 record only: what run 43726593786 saw) | missing | missing (exit 1, 44 owned paths) |
| C | This round's Head row naming the code head `f981713` instead (control) | pass | pass by `f981713` |
| D | Last Verdict row changed to FAIL | missing | missing |
| E | Owned edit after the record (`tools/ci/lane-scope.mjs`) | missing | missing |
| F | Docs-only commit after the record (`docs/07-ops/CI-CD.md`) | pass | pass by `0230e50` |
| G | Head row naming the pre-union `a351dbc` | missing | missing |
| H | Head row naming `4bbce92` (round 3) | missing | missing |
| I | Merge of `main` `bf8b866` (docs only) after the record, base `bf8b866` | pass | pass by `0230e50` |
| J | Merge of a `main` commit that edits `package.json` (an owned path this PR changes) after the record, base that commit | missing | missing |
| J2 | Merge of a `main` commit that edits `tools/db/shadow-init.ts` (owned, not changed by this PR) after the record, base that commit | pass (by design: the owned set is the PR's own net change) | pass by `0230e50` |
| K | This record also saved as `PR-0045-…` (the round-3 record left in place) | missing | missing |
| L | Row check of the candidate | 4 `Head` rows (`12ea6a6`, `ad30316`, `4bbce92`, `0230e50`), 4 `Verdict` rows, and the last table row of the file is this round's `Verdict` | as expected; last verdict token `PASS_WITH_FOLLOW-UPS` |

**Live prediction for the push of this record on `0230e50`.** I ran the head's `lane-scope.mjs` `main()` with `--base 78cd2a4 --before 0230e50 --pr 46 --head-ref feat/TASK-015-b-lane-c-nightly --lookup` against the real API (GET only). A second run with `--base bf8b866` gave the same outputs.

- **`fast-lane`** (classify step, head bootstrap):
  - `push_scope=docs`, `mode=light`, `code_changed=false`, `pr_docs_only=false`. Push range `0230e50..<record>`: 1 path, all docs; PR range: 103 paths.
  - The CODE-gated steps are skipped. The base-ref gates run with `78cd2a4`'s tooling: the workflow policy gives 0 findings (MO.5), and `check-evidence` accepts `20261115T1431Z_f981713` (PASS on `0230e50`; the record commit adds only a `docs/05-quality/security` file).
- **`scans`, lane-scope step:**
  - `identical=<record> 0230e50f67dd34012896b8a98316feb8e4512db2 f981713d87f2a95f55e7d9df94b9bf86f0c258c8`;
  - `security_paths=true` (the deleted spike test), `record_ok=true`;
  - **`code_proof=43726593786:0230e50f67dd34012896b8a98316feb8e4512db2`**, `security_proof=` (empty), **`security_integration_due=true`**;
  - no note. A binding problem would show `no proof (binding, fail closed): …`, and a refused run `run … is not a run of this PR into main: …`;
  - **6 API calls:** three runs lists (the record commit: its own run is not complete; `0230e50`; `f981713`: none), the binding's pulls list (one PR, #46 open into `main`), one events page (13 `referenced`, no `base_ref_changed`, so `since = 0`), and the jobs of run 43726593786.
  - **The proof run qualifies.** Its `fast-lane` steps are all `success`. Its `scans` proof steps succeeded; the record step is not one of them. `security-integration` was skipped, so there is no security proof.
- **`scans`, other steps.** Gitleaks over `78cd2a4..<record>` (first parent, 29 commits), Semgrep and openapi-breaking pass. The record step passes at `0230e50` (sim A).
- **`security-integration`** runs: `due`, `fast-lane` success, and `code_proof` is not empty. Its suites are `catalog-c1-c14` and `rls-cross-tenant`, the active `security_integration_suites` of `78cd2a4`'s manifest; `rbac-matrix`, `audit-generator`, `audit-immutability` and `csrf-cookie` are planned.
- **`ci-gate`**: `MERGE-READY` if `security-integration` succeeds. Control: `BLOCKED: security-integration red` if it fails.
- **Assumptions.**
  - The job token (`contents`, `actions`, `pull-requests` read) gets the same answers as my read token. If it does not, the binding fails closed: no proof, and `ci-gate` is red with "no code proof for this tree".
  - No new push or retarget lands before the record push.
  - `main` stays clean-mergeable (`a233fda` today).

**This push is the first live test of the binding.** For security, it is also the last check before the merge (MO.11).

**Hygiene.**
- **D-SEC-PR23-02 statements.** The "Gate table (union)" carries both verbatim: "`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first" and "`.git/info/exclude` is empty". The run of record is profile `pr`: no `wave` or `gate` run is committed, no FAIL run was added, and the PR has no lockfile change.
- **Host-fragment scan (count-only).** The needles are computed at run time: the account name, its 8.3 stem, the home and temp directories in four spellings each, the host name, the git e-mail, the drive-letter and POSIX users-directory forms, and the directory-account prefix. A positive control file fires.
  - The 8 files of `20261115T1431Z_f981713`: **0 for every needle**.
  - The final record file: 0 for every host-specific needle.
- **This section.** A `generic-api-key`-shaped scan (keyword, assignment operator, a 10+ character value with Shannon entropy at least 3.5) finds 0 lines. The only long hex strings are commit ids in `Head`, `identical` and `code_proof` positions. Lane A's real gitleaks scans the record push.

### MO.11 Checks owed (routed)

| When | Check |
|---|---|
| The push of this record | The `scans` summary shows the MO.10 values: `code proof: run 43726593786:0230e50…`, no binding note, `security-integration due: true`. `security-integration` succeeds and `ci-gate` shows `MERGE-READY`. **If the binding fails closed instead**, read the note: <ul><li>a `pull requests of the head branch` or `events` problem is a token-scope difference (R3.11: add `issues: read` to `scans` and pin it, which is an owned change and so a delta round);</li><li>a refused run names its reason.</li></ul> No security impact either way (fail closed). Record the outcome in a PR comment |
| Merge of #46 (orchestrator) | Merge only if all of these hold: <ul><li>`ci-gate` `MERGE-READY` on the exact final head (this record's commit, or a later docs-only one);</li><li>the PR46-SEC-11 interim rule (proof run 43726593786 at most 24 h old: merge by 2026-11-16 14:51Z, otherwise a fresh full run);</li><li>**P1**: `git diff --name-only dbfb1bd origin/main` at merge time touches only `docs/**` or agent memory. Otherwise the union and a merge-only round come again (PR46-SEC-16, -17).</li></ul> Code review's sign-off on the union is a separate DoD item |
| TASK-286 policy PR (stage 2, right after this merge; D-ORCH-100) | PR46-SEC-11 item 1; PR46-SEC-12; PR46-SEC-15; PR46-SEC-16 together with PR46-SEC-17 (`TOOLS_REF` = the test merge's first parent, published as the tested base); PR33-SEC-09 |
| SHEET-FOLD-8, next manifest PR, 015-C, G3 | As in R3.11 |

### MO.12 Proposed decision entry (for the orchestrator; DECISIONS.md not edited)

**D-SEC-PR46-04 · 2026-11-15 · security-analyst · PR #46 (TASK-015 015-B) merge-only security round at `0230e50` (union with `main` `78cd2a4` after PR #39 and PR #48), against record R3.9 = PASS_WITH_FOLLOW-UPS.**

- **Union.** It is pure: `f981713`'s tree `124180a` equals `git merge-tree` of its parents `a351dbc` and `78cd2a4`. The PR body's `4bbce92` form differs only by the r3 record. Only the five expected paths were changed by both sides, and each is delta-equivalent both ways.
- **R3.9.** It is met:
  - workflows byte-equal to `4bbce92`: one Lint heap line, `branches: [main]`, `pull-requests: read`, `HEAD_REF` via env;
  - no spike exemption;
  - `test:stack`, the `stack` project, `prismaArgv` and `authz:matrix` present;
  - the Playwright refusal kept before any step;
  - every #46 pin and both `REQUIRED_CODEOWNED_PATHS` sets (60 entries) kept.

  The policy gives 0 findings under the head's and `main`'s checkers, and 8 mutant controls fire as expected.
- **Evidence.** `20261115T1431Z_f981713` is accepted by the base-ref `check-evidence`. The D-SEC-PR23-02 statements are verbatim, and the host scan is 0.
- **Tested base.** Proof run 43726593786 tested the merge with `dbfb1bd`, which includes PR #52. `main` has moved only by docs since, so PR46-SEC-16 is not live for the record push.
- **New INFO PR46-SEC-17** (devops-engineer, TASK-286 with -16): `RANGE_BASE` = `pull_request.base.sha` is the merge base, not `main`'s tip, so base-ref gates lag `main` until the PR unions it. No effect here, because the gate inputs at `78cd2a4` and `bf8b866` are equal. The control until the fix is P1.
- **Record push.** Predicted: light, `code_proof=43726593786:0230e50…`, `security_integration_due=true`, 6 API calls; `security-integration` runs `catalog-c1-c14` and `rls-cross-tenant`; `ci-gate` `MERGE-READY` if green.
- **Merge, from the security side:** allowed on `MERGE-READY` for the exact final head, with the PR46-SEC-11 24-hour rule (by 2026-11-16 14:51Z) and P1 (`main` docs-only since `dbfb1bd`).
- **Reversibility:** High.

### MO.13 Verdict (merge-only round)

| Item | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium, 0 LOW. New: 1 INFO (PR46-SEC-17). Still open: LOW PR46-SEC-04, -05, -11, -12; INFO -07 (remainder), -08, -09, -10 (test case), -14, -15, -16 |
| Closed | None this round (merge-only) |
| Merge | Valid for `0230e50` and any later commit that touches no owned path of this PR (MO.10 A, F, I, J2). A union that brings `main` changes to an owned path this PR changes voids it (J). Merge on `ci-gate` `MERGE-READY` for the exact final head, with the PR46-SEC-11 interim rule and P1 (MO.11) |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding at head `0230e50`. The union with `main` after PR #39 and PR #48 is pure and delta-equivalent, and it keeps every R3.9 item: workflows byte-equal to `4bbce92`, no spike exemption, both PRs' `package.json`/`jest.config.ts`/`rebuild.mjs` changes, and every PR #46 pin with both CODEOWNERS sets. The proof run tested the current code merge. One INFO item (PR46-SEC-17, base-ref tooling from the merge base) is routed to TASK-286 |
