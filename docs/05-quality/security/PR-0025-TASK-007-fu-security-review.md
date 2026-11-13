# PR-0025 / TASK-007 follow-ups: change-scoped security review (Gitleaks OpenAPI allowlist removal, Dependabot TypeScript-major ignore, two sec-static cases)

| Field | Value |
|---|---|
| PR | #25 `ci(security): drop openapi gitleaks allowlist, ignore typescript major in dependabot`, https://github.com/sukhchdit/shipcube/pull/25 (D-ORCH-027 item 3) |
| Branch | `ci/TASK-007-fu-gitleaks-allowlist-dependabot-ignores`: one commit on the merge base `c3ff7f1`; 3 files, +22 / -14 |
| Head | 20a0fc689abdd74311079e2f81a7204bc18047f1 |
| Main now | `8ae440c` at hand-off (docs only after `94e8808`; the scans and the record simulation ran at `94e8808`). Main moved three times while I worked (`97bdd0a`, `3a51f79`, `94e8808`), the biggest step by merging PR #23 (TASK-011, `4bb6dc6`). Main's side since the merge base now touches security-owned paths (`.github/CODEOWNERS`, `.github/workflows/ci.yml`, `package.json`, `tools/ci/check-workflow-policy.*`, `tools/ci/ci-policy.test.ts`, `.prettierignore`, `tools/quality/**`), but none of the PR's three, so the intersection (`comm -12` of the two path lists) is empty and a later merge of main keeps this record valid (§7 case D) |
| Security-owned paths changed (CODEOWNERS, as lane A computes them) | `.github/dependabot.yml`, `.gitleaks.toml`, `tools/ci/sec-static.test.ts` (3) |
| Dependencies / workflows | `package.json`, `package-lock.json` and `.npmrc` are untouched. `.github/workflows/**` is byte-identical between the PR base and the head (the PR's net change holds no workflow edit), so no D-ORCH-021 lever moves (§3.6) |
| Binding items checked | D-ORCH-027 (3), D-ORCH-021 (1), PR10-SEC-08 (my PR-0010 record), PR-0021 record §5.1 option A, PR1-SEC-11, PR10-SEC-01 (`.git`-only mount, `--ignore-gitleaks-allow`), PR10-SEC-03 (config from the base ref), ADR-0001 (TypeScript pin), ADR-0023 item 4 (Gitleaks on every PR diff **and full history**), TEST-STRATEGY `gitleaks-full` |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. In the `Shipqube-CIFU` worktree I ran only read-only git (`status`, `log`, `rev-parse`) and read files (`sed`, `grep`, `cat`, `node` reading `package-lock.json`); all probes ran on `git archive` extracts and a scratch `git clone --local`, with the PR heads fetched into the scratch clone only. In the main checkout I ran one `git fetch origin`; `gh pr view` and `gh pr list` were read-only. Docker: the pinned Gitleaks image (`v8.30.1@sha256:c00b6bd0…`, the `GITLEAKS_IMAGE` digest of `ci.yml`), `--network none`, `.git` mounted read-only, one container per scan, each held under the shared `docker.lock` directory for seconds only. The scratch clones, extracts and the `node_modules` junction are removed at the end of the session |

## 1. Summary

**The change does what D-ORCH-027 (3) asks and nothing else.** I could find no way in which it weakens a gate, and it closes PR10-SEC-08.

- **PR10-SEC-08 is closed.** I reproduced the weakness with the real image and showed the fix. Three secret-shaped values (a JWT, a GitHub PAT and a Stripe live key, all built at run time) appended under `access_token:` / `refresh_token:` / `api_token:` in the contract are admitted by the old allowlist (0 findings) and reported by the new configuration (3 findings: `jwt`, `github-pat`, `stripe-access-token`). The same three lines in any other file are reported by both.
- **Nothing else in `.gitleaks.toml` changed.** The diff removes one `[[allowlists]]` table and its comment, and adds a header comment. `[extend] useDefault = true`, the agent-docs allowlist (path AND line, `condition = "AND"`) and the absence of a global `[allowlist]` are intact.
- **The Dependabot change is correct and minimal.** The file validates against the SchemaStore Dependabot 2.0 schema. Removing the new `ignore` entry gives a file deep-equal to the base, so the cooldowns (7 days, both ecosystems), the `npm-minor-and-patch` and `github-actions` groups, the PR limits (3 and 2), the monthly schedule and the `@platform/*` ignore are all intact.
- **The two new tests discriminate.** Each of seven mutations that should fail does fail one case (§4.1). Three weaker spots in the guard are recorded as PR25-SEC-02 (INFO).
- **Open PR ranges stay green** (§3.3): 0 findings for #15, #16, #20, #22, #23 and #24, both as they are and after a simulated merge of main.

**Rulings on the five questions** (details in §3):

| | Question | Ruling |
|---|---|---|
| (a) | Do the 17 historic hits need a `.gitleaksignore` fingerprint list before any lane B/C full-history scan? | **Yes, but not for this merge.** Lane A never sees them: it scans `base..head` and mounts only `.git`. The planned `gitleaks-full` suite (zero-skip, `gate` profile, ADR-0023 item 4) will fail on exactly these 17 until they are baselined, and history cannot be rewritten. All 17 are non-credentials (§3.2). The exact fingerprint list is in §3.2. Owner TASK-015 (runner and baseline), with qa-lead's activation of `gitleaks-full`. **PR25-SEC-01 (LOW)** |
| (b) | Do the open PR ranges #20, #23, #24 stay green after this lands? | **Yes.** §3.3. #23 merged while I worked (`4bb6dc6`); #20, #24 and the three Dependabot PRs were re-scanned at the new main |
| (c) | Is any other Gitleaks rule weakened? | **No.** §3.4. One pre-existing blind spot in the guard test is recorded as PR25-SEC-02 (INFO) |
| (d) | Is the Dependabot config correct, with the cooldowns, groups, limits and `@platform/*` ignore intact? | **Yes.** §3.5. Test-strength gaps are PR25-SEC-02 (INFO) |
| (e) | Are the D-ORCH-021 levers unchanged? | **Yes.** `.github/workflows/**` is identical on both sides; §3.6 |

Findings: **1 LOW and 2 INFO**, none blocking. No Critical, High or Medium.

## 2. Method

| Probe | What it did | Result |
|---|---|---|
| **P-1** Real Gitleaks image, git mode | Lane A's exact flags (`git /repo --config … --log-opts="--diff-merges=first-parent <range>" --ignore-gitleaks-allow --redact --no-banner --exit-code 1`, `.git` mount only, `--network none`) over 33 scans in a scratch clone, with the base-ref configuration (what lane A reads for **this** PR) and the head configuration (what every later PR reads). Controls were built at run time and never written to a record | §3.1 |
| **P-2** Default-rule emulation (Node) | A per-line emulation of the 221 v8.30.1 default rules over every file of main's tree (1,472 files at `3a51f79`, 1,493 at `94e8808`) and over the contract at main, the head, #20, #23 and #24. A hint only; P-1 is the proof | Main's tree: 2 raw hits, both the retained agent-docs prose; contract at main and at the head: 0 |
| **P-3** The suite itself | `sec-static.test.ts` from a `git archive` of the head, with `node_modules` junctioned to the main checkout, run through Jest (unit project, `--runInBand`). A mutation matrix on `.gitleaks.toml` and `dependabot.yml`, restored byte-identical after each run | §4.1 |
| **P-4** Dependabot file | Parsed with the `yaml` package, validated against the SchemaStore `dependabot-2.0.json`, deep-compared with the base, with two invalid-file controls | §3.5 |
| **P-5** Workflow policy and levers | `check-workflow-policy.mjs --root` on the head extract (0 findings, rc 0); `git diff` of `.github/workflows` against the base and against main (empty); lever token counts in base and head `ci.yml` | §3.6 |
| **P-6** Record check | Main's `tools/ci/check-security-owned-paths.mjs` against a scratch `clone --shared` at the head, with seven negative controls and four positive cases | §7 |
| Source review | The whole diff (4,552 bytes, ASCII only, no CR or control characters, `git diff --check` clean) and the surrounding files (`ci.yml` Gitleaks step, `CODEOWNERS`, the suite, `yaml-subset.mjs`) | — |

## 3. Rulings

### 3.1 Gitleaks results (real image)

Base configuration = the old allowlist, which is what lane A reads from the base ref for this PR. Head configuration = this PR's file.

| ID | Scenario (log range) | Base cfg | Head cfg |
|---|---|---|---|
| R1 | This PR: `main..head` (1 commit) | 0 | **0** |
| R2 | Control: three run-time secret-shaped values under `access_token`, `refresh_token`, `api_token`, appended to the contract on top of the head | **0 (hidden)** | **3** (`jwt`, `github-pat`, `stripe-access-token`) |
| R3 | Control: the same three lines in `docs/sim-control.md` | 3 | 3 |
| R4 | Main's whole current tree as one root commit (every line is an "added" line) | 0 | **0** |
| R4c | The same tree with the default rules only and no allowlist (positive control: R4 really scans the tree) | n/a | **2** (exactly the two agent-docs prose lines the retained allowlist admits) |
| R5 | Open PRs' own ranges `main..pr/N` for #15, #16, #20, #22, #23, #24 | — | **0 each** |
| R5m | The same after a simulated merge of main (its side arrives as added lines in the first-parent diff); #20 keeps its conflict markers, which makes it a superset | — | **0 each** |
| R8 | Positive control for the merge path: main plus the three planted lines merged into #24, range `ctrl-main..merge` | **0 (hidden)** | **3** (`jwt`, `github-pat`, `stripe-access-token`) |
| R6 | Full first-parent history of main plus the PR head (143 commits) | 2 | **17** |
| R6b | All ancestors of the head | 2 | 17 |
| R6c | All refs (adds the superseded PR #11 and #13 branches) | — | 20 |
| R7 | Rule-level override probe (§4.2) | — | 3 (`jwt` rule silenced, §4.2) |
| R9 | Baseline probe (§3.2) | — | 17 lines: 0; 16 lines: 1; shifted: 17 |
| R10 | This record added as a file on top of the head (the lines lane A will scan when the orchestrator commits it); text as of the first full draft, and the default-rule emulation again gives 0 for the final text | **0** | **0** |

R2 against R3 is the discriminating pair: the only difference is the file path, so the allowlist alone explains the 0. The figures in the PR body reproduce: 0 findings for the PR range, 3 for the run-time control, 17 on the full history against 2 under the base configuration. R4 and R5m go beyond the body: they cover the whole current tree and the post-merge shape of the open PRs.

Main moved to `94e8808` (PR #23 merged) while I worked, so I re-ran the scans that depend on main's content:

| ID | Scenario at main `94e8808` | Base cfg | Head cfg |
|---|---|---|---|
| R1n | This PR: `main..head` | 0 | **0** |
| R4n | Main's whole tree as one root commit (now includes PR #23's `tools/quality/**` and docs) | — | **0** |
| R5n | A simulated merge of `94e8808` into #20 (conflict markers kept), #22, #24, #15 and #16 | — | **0 each** |

The default-rule emulation over the same tree (1,493 files) again gives exactly the two retained agent-docs prose lines and nothing else.

### 3.2 (a) The 17 historic hits

**Where they are.** All 17 are `generic-api-key` findings in commits that are already on main and were never re-scanned by lane A.

- **15 in `docs/03-architecture/api/openapi.yaml`:** 14 in `b8f805f` (the P3 architecture commit) and 1 in `d5cdfa2` (the P3 remediation commit). They are among the 17 example values that PR #21 replaced with `EXAMPLE_` markers (the default rules flag 15 of those 17). The old allowlist is what hid them from a git-mode scan.
- **2 pre-existing, independent of this PR:** `63accea` (`docs/sdlc/DECISIONS.md`, one agent-memory file). Both appear under the base configuration too. The literal itself was scrubbed from the current tree in `2e29004`, which is on main; the history keeps it.

**Triage: not credentials.** I decoded the shapes without printing values. The four JWT-shaped values have header `alg ES256` and a single `sub` claim (no `iss`, `aud` or `exp`), and a 12-character signature segment (a real ES256 signature is 86), so none can verify. The other 11 are example-shaped: opaque values with `mfa_`, `sh_` and `rap_` prefixes or none (26 to 43 characters), one 29-character `pi_` value that lacks the `_secret_` part of a real Stripe client secret, and one share-link path. The 2 docs hits are a synthetic test literal (PR13-SEC-11). Nothing needs rotation.

**Ruling.** The fingerprint list is needed, for a different consumer than lane A:

- **Lane A is unaffected.** It scans `base..head`, mounts only `.git` (so `/repo/.gitleaksignore` cannot exist), and the 17 sit in merged history. A branch that merges main sees only main's net current lines as added, and main's current tree has 0 unallowlisted findings (R4).
- **`gitleaks-full` is the consumer.** TEST-STRATEGY lists it as a `gate`-profile suite, the manifest marks it `zero_skip`, `security: true`, `activate_with: W0 CI`, and ADR-0023 item 4 requires Gitleaks on "full history". With the allowlist gone it reports 17 on the first run (R6), and CLAUDE.md §5 forbids rewriting history. Without a baseline someone will be tempted to re-add a path allowlist, which is exactly what PR10-SEC-08 forbids.
- **How.** Use a `.gitleaksignore` of exact fingerprints (commit, path, rule, line), one per line, each group preceded by a `#` comment. `/.gitleaksignore` is already in CODEOWNERS, so every change to it needs a record. Do **not** use a `.gitleaks.toml` path or `commits` allowlist: those suppress future lines too. Verified (R9): with the 17 lines mounted, the full-history scan reports 0 findings (exit 0); with 16 lines it reports exactly the one line that was left out; with every line number shifted by one it reports all 17, so the list is exact and pins each hit.
- **Where it is read from.** Mount it explicitly from the base or gate ref (`git show <ref>:.gitleaksignore`, `--gitleaks-ignore-path`), never from a PR work tree: gitleaks loads `<source>/.gitleaksignore` unconditionally, and a PR could add its own fingerprints.
- **Scope of the scan.** Scan the gate SHA's ancestry (`<gate sha>` as the only revision), not `--all`. `--all` adds 3 findings from the superseded, unmerged PR #11 and #13 branches (`d68898a`, `e6ccf60`), which would otherwise need three more lines.
- **Timing.** The baseline must land before `gitleaks-full` is set to `active` in `tools/quality/required-suites.json` (the D-TASK011-01 activation protocol makes that a manifest-only PR) and in any case before G3. It is **not** a condition of this merge. The content is fixed by the list below (history cannot change), so the file can land in any security-recorded PR before TASK-015 if that is convenient; no new scan is needed to produce it.

The exact list (no secret material; fingerprints are `<commit>:<path>:<rule>:<line>`):

```text
63accea281c3ed383b116fe96b7d3f6233c8c145:.claude/agent-memory/senior-developer/feedback_lane_a_pr_hygiene.md:generic-api-key:10
b8f805f48711b9aa0fada72020e271f0e088e24e:docs/03-architecture/api/openapi.yaml:generic-api-key:197
b8f805f48711b9aa0fada72020e271f0e088e24e:docs/03-architecture/api/openapi.yaml:generic-api-key:381
b8f805f48711b9aa0fada72020e271f0e088e24e:docs/03-architecture/api/openapi.yaml:generic-api-key:461
b8f805f48711b9aa0fada72020e271f0e088e24e:docs/03-architecture/api/openapi.yaml:generic-api-key:486
b8f805f48711b9aa0fada72020e271f0e088e24e:docs/03-architecture/api/openapi.yaml:generic-api-key:590
b8f805f48711b9aa0fada72020e271f0e088e24e:docs/03-architecture/api/openapi.yaml:generic-api-key:906
b8f805f48711b9aa0fada72020e271f0e088e24e:docs/03-architecture/api/openapi.yaml:generic-api-key:1096
b8f805f48711b9aa0fada72020e271f0e088e24e:docs/03-architecture/api/openapi.yaml:generic-api-key:1192
b8f805f48711b9aa0fada72020e271f0e088e24e:docs/03-architecture/api/openapi.yaml:generic-api-key:3726
b8f805f48711b9aa0fada72020e271f0e088e24e:docs/03-architecture/api/openapi.yaml:generic-api-key:6309
b8f805f48711b9aa0fada72020e271f0e088e24e:docs/03-architecture/api/openapi.yaml:generic-api-key:7525
d5cdfa2877011a9c781dff375f2e8575b54cc603:docs/03-architecture/api/openapi.yaml:generic-api-key:7665
b8f805f48711b9aa0fada72020e271f0e088e24e:docs/03-architecture/api/openapi.yaml:generic-api-key:7673
b8f805f48711b9aa0fada72020e271f0e088e24e:docs/03-architecture/api/openapi.yaml:generic-api-key:12235
b8f805f48711b9aa0fada72020e271f0e088e24e:docs/03-architecture/api/openapi.yaml:generic-api-key:15883
63accea281c3ed383b116fe96b7d3f6233c8c145:docs/sdlc/DECISIONS.md:generic-api-key:1325
```

### 3.3 (b) Open PR ranges

Lane A reads `.gitleaks.toml` from the base ref, so after this lands every open PR scans with the new configuration. A PR range is its own commits plus the first-parent diff of any merge of main. R5 and R5m (§3.1) cover both, using the real image: **0 findings for #15, #16, #20, #22, #23 and #24** at main `3a51f79`, and 0 again for #15, #16, #20, #22 and #24 at main `94e8808` (R1n to R5n below; #23 merged in between as `4bb6dc6`, and its content is part of the R4n whole-tree scan). Why this holds:

- **#24 is the only open PR that edits the contract.** It adds 5 lines of prose, and its range scans clean (R5).
- **#20 and #24 still carry the old values in their trees** (P-2: 15 emulated raw hits in each branch's `openapi.yaml`), because they forked before PR #21. A merge of main arrives as removed old lines and added `EXAMPLE_` lines, and the first-parent diff counts only lines absent from the branch side. R5m shows 0 for both.
- **The merge path is really scanned.** R8 plants the three controls on the main side of a merge and expects the old configuration to miss them and the new one to report them.
- **A rebase of #20 or #24** replays their own diffs, which hold no old values.

### 3.4 (c) Other rules

The `.gitleaks.toml` diff is the removal of one table plus comments. Unchanged: `[extend] useDefault = true`, the retained allowlist (`condition = "AND"`, two exact paths, one line regex), and no global `[allowlist]`. R3 shows a secret-shaped value in a non-contract file is reported under both configurations. The default rules on main's whole tree report only the two retained agent-docs prose lines (R4, P-2).

The comment text added to the file is accurate for the current contract, where 21 lines contain `EXAMPLE` and the default-rule emulation gives 0 raw hits.

### 3.5 (d) Dependabot

- **Valid.** `ignore: [{dependency-name: '@platform/*'}, {dependency-name: typescript, update-types: ['version-update:semver-major']}]` on the npm entry is schema-valid. Two controls (a misspelt update type, a wrong key) are rejected by the same validator, so the check is not vacuous.
- **Intact.** With the new entry removed, the file deep-equals the base: npm and github-actions both monthly, cooldown 7 days on both, limits 3 and 2, groups `npm-minor-and-patch` (minor, patch) and `github-actions` (`*`), commit prefixes, and the `@platform/*` ignore. The new entry sits in the npm ecosystem, not the github-actions one.
- **Right target.** `typescript` is `6.0.3`, exact, in `package.json`. The only newer line is 7.x (`latest` is 7.0.2; the npm registry has no 6.1), so ignoring the major covers every proposal that contradicts ADR-0001. `typescript-eslint` 8.72.x peers `typescript <6.1.0`, so a hypothetical 6.1 minor would also be refused at install, not merged silently.
- **Security updates.** GitHub's options reference marks `ignore` as an option that also changes how security-update PRs are created; I did not confirm the exact effect. TypeScript is a build-time tool, and lane A's `npm audit`, osv-scanner and advisory watch-list gates do not depend on Dependabot, so the gating posture is unchanged.
- **Open PR #15** (TypeScript 7.0.2) is not closed by this file change on its own; the orchestrator's open request to the repository owner stands. I did not verify whether Dependabot closes it on its next monthly run.

### 3.6 (e) D-ORCH-021 levers

`git diff` of `.github/workflows` is empty between the PR base and the head, so the PR's net change holds no workflow edit; it was also empty against main at `3a51f79`. Main's `ci.yml` has since changed through PR #23 (a lane B evidence step; reviewed in PR-0023), so the orchestrator's pre-merge check must use the three-dot form `git diff origin/main...<head> -- .github/workflows`, which is empty; a plain two-dot diff against the moved main now shows PR #23's lines. The lever tokens are equal in the base and head `ci.yml` (`RANGE_BASE:` 8 and 8, `GITHUB_ENV` 8 and 8, and 0 and 0 for `BASH_ENV`, `BASH_FUNC`, `defaults:`, `GITHUB_PATH` and folded `run: >`). `check-workflow-policy.mjs` reports 0 findings on the head. Main's own `ci.yml` change (24 added lines, none removed) leaves those tokens equal as well (`GITHUB_ENV` 8, the rest 0). The only `.github/` file this PR changes is `dependabot.yml`.

## 4. Test evidence

### 4.1 `sec-static.test.ts` (head extract)

The unit project runs the whole file: 12 of 12 pass at the head. The matrix below runs the three relevant cases (`AT-US-048-04`, `PR10-SEC-08`, `D-ORCH-027`) after each mutation, and every file is restored byte-identical afterwards.

| Mutation | Expected | Result |
|---|---|---|
| M0 head as is | pass | 3 of 3 pass |
| M1 old allowlist block restored | the new case fails | `PR10-SEC-08` fails, the AT case passes |
| M2 marker-only allowlist whose path names the contract (PR-0021 §5.1 option B) | fail | 1 fails |
| M3 allowlist with a broad `^docs/.*\.yaml$` path | fail | 1 fails |
| M4 `typescript` ignore removed | fail | `D-ORCH-027` fails |
| M5 ignore of `semver-minor` instead of major | fail | 1 fails |
| M6 one cooldown removed | fail | 1 fails |
| M7 npm cooldown 7 changed to 1 | fail | 1 fails |
| **M8** `typescript` ignore moved under the github-actions entry (inert for npm) | should fail | **passes** (PR25-SEC-02) |
| **M9** `@platform/*` ignore removed | no case exists | **passes** (PR25-SEC-02) |
| **M10** `[[rules]] id = "jwt"` with a blanket `[[rules.allowlists]]` | should fail | **all 12 pass** (PR25-SEC-02) |

### 4.2 R7 (rule-level override)

The override `[[rules]] id = "jwt"` with a blanket `[[rules.allowlists]]` (`regexes = ['''.*''']`, `regexTarget = "line"`) appended to the head configuration is accepted and takes effect in the real image (R7). On the three-line control the `jwt` finding disappears. The same line is still reported, but by the generic fallback (`generic-api-key`), only because its key is `access_token`; a JWT under a key the generic rule does not match would pass silently. The Jest file still passes 12 of 12 (M10), so the guard does not see the change. A lane A scan still reads the configuration from the base ref, and the change is a security-owned path, so this is a regression-guard gap (PR25-SEC-02), not a bypass.

## 5. Findings

### PR25-SEC-01: the 17 historic hits need an exact-fingerprint baseline before `gitleaks-full` runs (LOW)

- **CWE / OWASP.** CWE-693 (protection mechanism failure, fail-closed direction) / A05:2021 Security Misconfiguration.
- **Where.** `.gitleaksignore` (absent), `tools/quality/required-suites.json` (`gitleaks-full`, `status: planned`), the TASK-015 lane C runner.
- **Description.** Removing the value-unbounded allowlist exposes 15 old example values in history that the allowlist used to hide, next to 2 older hits. The planned full-history suite is zero-skip and the history cannot be rewritten.
- **Impact.** The suite fails closed on its first run (verified, R6). The risk is the repair: a broad path or commit allowlist added in a hurry would silently re-open PR10-SEC-08 and also cover future lines. Likelihood is certain, impact is low, so **LOW**.
- **Remediation.** The list and the mounting rules are in §3.2: an exact `.gitleaksignore` (17 lines), read from the base or gate ref and mounted by the runner, scanning the gate SHA ancestry rather than `--all`.
- **Verification.** The runner's integration test scans a scratch history that holds one of the 17 lines (expect 0 findings with the list, 1 without) and one fingerprint with a shifted line number (expect 1). `gitleaks-full` is not activated until this passes.
- **Owner / due.** TASK-015 (runner and baseline file, a security-owned change that needs its own record), qa-lead (activation entry in the D-TASK011-01 plan). Due before `gitleaks-full` becomes `active` and before G3.

### PR25-SEC-02: the guard tests are text-level and miss three ways to weaken the controls (INFO)

- **CWE / OWASP.** CWE-693 (protection mechanism failure: the regression guard does not cover the control it protects) / A05:2021 Security Misconfiguration. Item 1 is pre-existing; item 2 is a test-strength gap in the new case, not a new weakness.
- **Description.**
  1. `AT-US-048-04` and the new case split `.gitleaks.toml` on `[[allowlists]]` only. A `[[rules]] id = "<default rule>"` entry with `[[rules.allowlists]]` extends the default rule's allowlists (gitleaks' extend merge) and the whole suite stays green (M10).
  2. The Dependabot case is a regex over the file text: an `ignore` entry placed under the wrong ecosystem passes (M8), and nothing asserts the `@platform/*` ignore, the groups, the limits or the schedule (M9).
- **Exploitability.** A change to either file is a security-owned path and needs a security record, and lane A reads the Gitleaks configuration from the base ref, so no PR weakens its own scan. This is a regression-guard gap, not a bypass. **INFO.**
- **Remediation.** In `tools/ci/sec-static.test.ts`, parse `dependabot.yml` with the existing `yaml-subset.mjs` and assert, per ecosystem, the ignore list, the cooldown, the groups, the limit and the schedule. For the TOML, assert that the top-level tables are exactly `title`, `extend` and the `[[allowlists]]` tables (no `[[rules]]`, no `[allowlist]`).
- **Verification.** M8, M9 and M10 each make the suite fail.
- **Owner / due.** TASK-015, together with PR10-SEC-17 (CI policy hardening).

### PR25-SEC-03: the example-marker rule for the contract is documented nowhere a contract author reads (INFO)

- **CWE / OWASP.** CWE-1059 (insufficient technical documentation) / A05:2021 Security Misconfiguration (secure-by-default guidance for the contract author).
- **Description.** After this merge a realistic-looking token pasted into `openapi.yaml` fails lane A. The `EXAMPLE_` marker convention is written only in review records; `docs/03-architecture/api/README.md` does not mention it, and no tool or test does.
- **Remediation.** One sentence in the API README (contract conventions): credential-shaped example values must be obviously fake `EXAMPLE_...` markers, and Gitleaks scans the contract like any other file (PR10-SEC-08).
- **Owner / due.** api-designer, at the next README touch (SHEET-FOLD-2 or TASK-020).

## 6. Closures and checks owed

| Item | Status |
|---|---|
| **PR10-SEC-08** (LOW) | **Closed.** Contract side by PR #21; allowlist side by this PR. Reproduced and fixed with the real image (R2) |
| PR1-SEC-11 (OpenAPI part) | Closed with it. The agent-docs part stays, by design |
| D-ORCH-027 (3) | Satisfied |
| PR25-SEC-01 (LOW) | Open. TASK-015 and qa-lead, due before `gitleaks-full` is activated and before G3 |
| PR25-SEC-02 (INFO) | Open. TASK-015 |
| PR25-SEC-03 (INFO) | Open. api-designer |

Checks owed elsewhere:
- **TASK-015:** PR25-SEC-01 and 02; the PR10-SEC-16/17/21 items already routed there. The `gitleaks-full` runner must read the baseline from the gate ref.
- **After merge:** on the first monthly Dependabot run, confirm that no `typescript` 7.x PR is proposed, that #15 is closed, and that no `private_source_not_reachable` appears (PR10-SEC residual, unchanged).
- **Any PR that touches `docs/03-architecture/api/openapi.yaml`** is now scanned without a contract allowlist. Expect `EXAMPLE_` markers or a lane A failure.

## 7. Record-check simulation (P-6)

Main's `check-security-owned-paths.mjs` at `94e8808`, run with `--root` set to a scratch `git clone --shared` at the head (it reads records from the working tree), with the real CODEOWNERS and the base `origin/main`.

The PR's net change is the three owned paths above; the paths that main changed since the merge base and the paths the PR changed do not intersect, so a merge of main cannot void the record (the failure mode seen with PR #9).

| Case | Setup | Result |
|---|---|---|
| A | The record committed on top of the head; base = main `94e8808` | **pass**, satisfied by the record naming `20a0fc6` |
| A2 | The same, base = the PR merge base `c3ff7f1` | **pass** |
| B | Control: no record | `missing` ("no record named PR-0025-*.md for PR #25"), rc 1 |
| C | Control: the record, but `--pr 24` | `missing` |
| D | Main merged after the record (main `94e8808` merged into the scratch clone; the merge brings main's owned-path changes, none of them one of the PR's three) | **pass**: clause (d) finds no owned path changed after `20a0fc6` |
| E1 | Control: `.gitleaks.toml` edited after the record | `missing`, "names 20a0fc6, but .gitleaks.toml changed after it" |
| E2 | Control: `.github/dependabot.yml` edited after the record | `missing`, same note for that path |
| E3 | Control: `tools/ci/sec-static.test.ts` edited after the record | `missing`, same note for that path |
| F | An unowned docs file edited after the record | **pass** (light fix cycles on unowned paths keep the record valid) |
| G | Control: a later table row whose first cell is Verdict, with the value FAIL, appended | `missing` ("verdict FAIL is not one of PASS, PASS_WITH_FOLLOW-UPS, PASS_WITH_CONDITIONS") |
| H | Control: the head row names only the PR base `c3ff7f1` | `missing` ("its head row names no commit of this PR") |

Four positive cases pass and seven controls are refused, so the check is not vacuous. The orchestrator commits this file unchanged on top of `20a0fc6` (or on any later commit that touches no owned path) and lane A's record step reads the head row and the last verdict row below.

## 8. Verdict

| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is open at head `20a0fc6`, so the merge rule is met for the security dimension. **Closed:** PR10-SEC-08 (allowlist side; reproduced and fixed with the real image) and the OpenAPI part of PR1-SEC-11. **Rulings:** (a) the 17 historic hits need an exact-fingerprint `.gitleaksignore` before `gitleaks-full` runs, not for this merge; (b) #15, #16, #20, #22, #23 and #24 stay green; (c) no other Gitleaks rule is weakened; (d) the Dependabot file is correct with every other setting intact; (e) the D-ORCH-021 levers are unchanged. **Open, none blocking:** PR25-SEC-01 (LOW, TASK-015 and qa-lead, due before `gitleaks-full` is activated and before G3), PR25-SEC-02 (INFO, TASK-015), PR25-SEC-03 (INFO, api-designer). The record stays valid for later commits on unowned paths and for a merge of main that brings no security-owned path (§7 cases D and F); any further change to `.gitleaks.toml`, `.github/dependabot.yml` or `tools/ci/sec-static.test.ts` needs a delta round. |
