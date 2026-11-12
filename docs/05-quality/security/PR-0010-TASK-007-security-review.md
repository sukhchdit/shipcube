# PR-0010 / TASK-007: change-scoped security review (CI lane A and supply-chain hardening)

| Field | Value |
|---|---|
| PR | #10 `TASK-007: CI lane A fast-lane workflow and supply-chain install hardening (SPK-01 ubuntu half)`, https://github.com/sukhchdit/shipcube/pull/10 |
| Branch / head | `feat/TASK-007-ci-lane-fast-lane-workflow` @ `28442b6`; merge-base `main` @ `7712c7c`. 11 commits (2 merges of `main`), 117 files, +9,044 / −24 |
| Scope | `.github/{workflows/ci.yml,CODEOWNERS,dependabot.yml}`, `.gitleaks.toml`, `.semgrep/*.yml`, `.semgrepignore`, `.gitignore`, `.stylelintignore`, `.prettierignore`, `eslint.config.mjs`, root `package.json`, `tools/ci/**` (12 checkers, 4 registers, fixtures), `tools/lint/check-suppressions.mjs`, `tools/eslint-rules/any-justification.mjs`, `tools/hooks/*`, `tools/repo/gitignore.test.ts`, `tests/fixtures/{lint/suppressions,semgrep}/**` |
| Lane A evidence | Run [43268839024](https://github.com/sukhchdit/shipcube/actions/runs/43268839024) on `28442b6`: all 3 jobs and every fast-lane step `success`. Bootstrap state: every checker ran from the head, and the record check ran `--report-only` (D-ORCH-004) with "record pending" for 115 owned paths |
| Security requirements in scope | REQ-SEC-011/013, NFR-SEC-002/012, US-005, US-048 (AT-US-048-01..07); SEC-P3-04, SEC-P3-31; SEC-TC-32/45/51/64 (CI parts); ADR-0023 am. F/H/I/J; D-ARCH-003 rev 4, D-ARCH-040/041/042/043/044, D-ARCH-070; D-TASK007-01..09; the routed items in §5 |
| Reviewer / date | security-analyst, 2026-11-12. Read-only. No `npm ci`, no build, no test suite (D-ORCH-010). **One** Docker run: a gitleaks probe on a synthetic scratch repository with the PR's own `.gitleaks.toml` (§2) |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open, so the merge rule is met for `28442b6`. 1 MEDIUM, 7 LOW, 7 INFO. **PR10-SEC-01 (MEDIUM) is strongly recommended for this PR's fix cycle**, because the fix is a few lines in the gitleaks step plus one policy rule. If it is deferred, it is due before the first Wave-1 feature merge. 33 of the 36 routed items are closed; 3 are partial or after-merge (§5) |

## 1. Summary

This is a careful and largely sound implementation of the CI security boundary.
- **The trigger model is safe.** `pull_request` only, top-level `contents: read`, `ci-gate` with `permissions: {}`, no secrets, `persist-credentials: false`. `pull_request_target`/`workflow_run` are banned by policy. The repository's default workflow token is read-only and cannot approve PRs.
- **No script injection.** No `run:` block interpolates an event field. The PR title reaches commitlint through `env` and `printf '%s\n'` (`ci.yml:234-245`).
- **Pins.** Every action is SHA-pinned with a version comment. Every container tool is digest-pinned. The YAML subset parser fails closed on the escape forms that would hide `npx` or `|| true` from the policy (probe §2).
- **Install and supply chain.** Scripts are off at workflow and job level. Lockfile provenance, `@platform` link-only rules and the 7-day cooldown all run **before** `npm ci`. `npm audit signatures` uses the safe scope-override form: the run verified 1,490 signatures and 569 attestations.
- **Advisories and licences.** Advisory, licence and freshness gates fail closed on missing or erroring input, and their registers carry decisions and expiries.
- **Migrations.** Released migrations are immutable relative to the merge base (`--no-renames`; A-only), checked before any head code runs.
- **Static analysis.** The suppression counter and Semgrep packs close PR2-SEC-01/02/04 for code files. `--disable-nosem` is set and the Semgrep self-test passed 5/5.

The findings concern **where the gates get their inputs and how much they can be steered by the PR they judge**:
- **01 (MEDIUM):** the PR itself can switch the gitleaks gate off. Lane A honours inline `gitleaks:allow` (the counter is blind in `.md`/`.json`/`.sql`/`docs/`/`.claude/`). Gitleaks auto-loads a `.gitleaksignore` committed by the PR. Merge commits are never diffed. All three paths were confirmed against the PR's own config and flags.
- **02 (LOW):** the base-ref gates (gitleaks, Semgrep, the record check, plus licence/signatures/audit) run in the **same job after head-controlled code** (`deps:rebuild`, lint, tests, build). Head code can rewrite `$RUNNER_TEMP/base` or `$GITHUB_ENV` and neutralise them without touching an owned path. This is the residual of SEC-P3-31.
- **03 (LOW):** Semgrep's scan scope (`.semgrepignore` and its `:include .gitignore`) comes from the head.
- **04 (LOW):** the review-record check is self-attestable and loosely bound. A record committed by anyone, with any `PR-nnnn` name, passes, and only a verdict *starting with* `FAIL` fails. CODEOWNERS also misses the agent control plane (`.claude/settings.json` with hooks and 78 permission rules, `CLAUDE.md`, `.claude/agents/`) and `.gitleaksignore`.
- **05 (LOW): repository platform facts.** The repository is private on a plan where branch protection and rulesets are unavailable (HTTP 403), so `ci-gate` cannot be a required check. The Actions policy allows all actions and does not require SHA pinning. All three merge methods are enabled, although D-TASK007-08 assumes squash.
- **06–08 (LOW):** licence and closure data come from author-editable lockfile metadata. The workflow policy lacks an untrusted-expression rule and does not ban `issue_comment`. The OpenAPI gitleaks allowlist is bounded by path but not by value.

## 2. Method

- **Diff review.** `gh pr view 10`, `gh pr diff 10`, and `git diff 7712c7c 28442b6` in the read-only worktree. I read every checker in full (`tools/ci/*.mjs`: 3,709 lines), plus `check-suppressions.mjs`, the five Semgrep packs, `ci.yml`, CODEOWNERS, Dependabot, the hooks, the `.gitignore`/`.stylelintignore`/`.prettierignore` deltas and the tests that pin the order (`ci-policy.test.ts`) and the allowlists (`sec-static.test.ts`).
- **Lane A run** 43268839024 (`gh run view --log`): step results and gate outputs.
  - `check-migration-immutability`: PASS (0 changes).
  - `check-lockfile`, `check-dep-age` (×2), `licence-check`, `check-audit`: PASS.
  - `check-suppressions`: 1 suppression, 0 findings.
  - Unit tests: 46 suites, 1,205 tests passed.
  - Base-ref fixture step: 68 passed, 24 skipped by the name filter.
  - Gitleaks: **9 commits scanned** (11 in range, 2 merges), no leaks.
  - Semgrep: self-test 5/5, scan 0 findings in 90 files.
  - Record check: report-only, "record pending".
- **Repository settings** (`gh api`). Visibility is `PRIVATE`. `branches/main/protection` and `rulesets` return **403 "Upgrade to GitHub Pro or make this repository public"**. `actions/permissions`: `allowed_actions: all`, `sha_pinning_required: false`. `actions/permissions/workflow`: `default_workflow_permissions: read`, `can_approve_pull_request_reviews: false`. Squash, merge-commit and rebase merges are all enabled. There are no repository variables, so `CI_MAIN_FAST_LANE` is unset and the push-to-main lane never runs.
- **Upstream facts.**
  - gitleaks v8.30.1 `cmd/root.go`: `Detector()` loads `filepath.Join(source, ".gitleaksignore")` unconditionally. `--ignore-gitleaks-allow` defaults to false.
  - `sources/git.go`: with `--log-opts` the command is `git log -p -U0 <opts>`, with no `-m`/`--cc`/`--diff-merges`.
- **Probes** (scratch `…/scratchpad/review/PR-10-sec/scripts/`; each has a positive control):
  - `gitleaks-probe.sh`: the single Docker run. Pinned image `ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0…`, the PR head `.gitleaks.toml`, and the exact `ci.yml:295-298` flags (`git /repo --log-opts=<base>..<head> --redact --exit-code 1`), over a synthetic repository. All tokens are random strings in provider formats, not credentials, and the repository was deleted after the run. Results:

    | Case | Content | Reported? |
    |---|---|---|
    | **Control** | `ctl.json` with an AWS-format key and a GitHub-PAT-format token | **Yes, both** (`aws-access-token`, `github-pat`) |
    | (a) | `allow.md`: key + `<!-- gitleaks:allow -->` | **No** |
    | (b) | `ign.txt`: PAT whose fingerprint `<commit>:ign.txt:github-pat:1` is in a `.gitleaksignore` committed in the range | **No** |
    | (c) | `evil.txt`: key introduced only in the merge commit | **No**; "3 commits scanned" for a 4-commit range |

  - `policy-probe.mjs`: `checkWorkflow()` from the PR head, over 10 workflow snippets (results in PR10-SEC-07).
  - An allowlist probe: the three OpenAPI allowlist regexes over the current `openapi.yaml` and over realistic tokens (PR10-SEC-08).
  - A merge-content check: `git diff-tree -p --cc` on both merge commits of this PR. `66d9943` resolves one conflict hunk, the `package.json` `lint` line, which is benign and equal to the PR's change. `681a22a` resolves none. **This PR has no unscanned merge content.**
- **Secrets in this PR.** The lane A gitleaks run (9 commits) was clean. My merge-content check covers the 2 merges. The test fixtures contain only marker strings (`gitleaks:allow`, `nosemgrep`), no credential-shaped values.
- **Not run.** Semgrep and actionlint locally (no host install; Docker budget used by the gitleaks probe). I rely on the lane A run evidence above.

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR10-SEC-01 | The PR can switch off the gitleaks gate: inline `gitleaks:allow` (counter blind outside code types), auto-loaded `.gitleaksignore`, merge commits not scanned | **MEDIUM** | CWE-693, CWE-540 | A05 / A08 | `ci.yml:290-298`; `check-suppressions.mjs:45, 329-343, 440`; `.github/CODEOWNERS` | senior-developer / devops-engineer (this PR's fix cycle) | Open |
| PR10-SEC-02 | Base-ref gates share the runner with head-controlled code (`deps:rebuild`, lint, tests, build) and run after it | LOW | CWE-693, CWE-345 | A08 | `ci.yml:125-157` vs `:198-317` | devops-engineer (this PR or TASK-015) | Open |
| PR10-SEC-03 | Semgrep scope comes from the head: `.semgrepignore` and its `:include .gitignore` | LOW | CWE-693 | A08 | `run-semgrep.mjs:73-98`; `.semgrepignore:1-11`; `ci.yml:130` | devops-engineer | Open |
| PR10-SEC-04 | The security-review-record check is self-attestable and loosely bound; CODEOWNERS misses the agent control plane and `.gitleaksignore` | LOW | CWE-345, CWE-284 | A04 / A08 | `check-security-owned-paths.mjs:37, 86-90, 103-123, 168-174`; `ci.yml:312-317`; `.github/CODEOWNERS` | devops-engineer; principal-architect (ADR-0023 wording); orchestrator (merge procedure) | Open |
| PR10-SEC-05 | Platform controls: no branch protection or rulesets on this plan (`ci-gate` not enforceable), Actions policy allows all actions without SHA pinning, all merge methods enabled | LOW | CWE-693 | A05 | repository settings | orchestrator + devops-engineer | Open |
| PR10-SEC-06 | Licence and closure come from author-editable lockfile metadata, not from the integrity-verified installed manifests | LOW | CWE-345 | A08 | `licence-check.mjs:223-227`; `dep-gates-lib.mjs:55-57` | senior-developer | Open |
| PR10-SEC-07 | Workflow policy: no untrusted-expression rule, `issue_comment` and other privileged triggers allowed, no required-gate-step assertion | LOW | CWE-78, CWE-693 | A03 / A08 | `check-workflow-policy.mjs:174-237, 282-284` | devops-engineer (before TASK-015 adds workflows) | Open |
| PR10-SEC-08 | The OpenAPI gitleaks allowlist is path-bounded but value-unbounded | LOW | CWE-798, CWE-693 | A07 / A05 | `.gitleaks.toml:15-24` | api-designer + devops-engineer | Open |
| PR10-SEC-09 | `.npmrc` check has no key allow-list (`registry=`, `omit=`, `node-options=`, `strict-ssl=false` pass) | INFO | CWE-15 | A05 | `check-install-flags.mjs:56-75` | devops-engineer | Open |
| PR10-SEC-10 | Migration-immutability residuals: symlink/mode entries, and directories released on `main` after the fork point | INFO | CWE-693 | A04 | `check-migration-immutability.mjs:33-55, 79-89` | devops-engineer (before M5) | Open |
| PR10-SEC-11 | Classification and gate semantics: PR files API (3,000-file cap), `.claude/` counted as docs, push-event record semantics, a skipped `ci-gate` reads as success | INFO | CWE-693 | A05 | `ci.yml:64-95, 312-321` | devops-engineer | Open |
| PR10-SEC-12 | Registers: waivers have no maximum span and no decision-ID check; a same-tuple integrity change is reported, not failed | INFO | CWE-1104 | A06 | `check-audit.mjs:50-58`; `check-lockfile.mjs:209-218` | senior-developer | Open |
| PR10-SEC-13 | Digest-pinned container tools (gitleaks, actionlint, osv-scanner, Semgrep) have no update channel | INFO | CWE-1104 | A06 | `ci.yml:45-47`; `run-semgrep.mjs:20` | devops-engineer (TASK-015) | Open |
| PR10-SEC-14 | Fixture blind spots: unanchored `fixtures/` exclude in `password-hashing.yml`; `/tests/fixtures/` is excluded from Semgrep, from ESLint (semgrep fixtures) and from the counter | INFO | CWE-693 | A04 | `.semgrep/password-hashing.yml:24`; `.semgrepignore:11` | senior-developer | Open |
| PR10-SEC-15 | PR1-SEC-10 half: `THIRD_PARTY_NOTICES.md` (caniuse-lite CC-BY-4.0 attribution, D-ARCH-003 rev 2 item 2) does not exist | INFO | n/a | n/a | repository root | technical-writer (P7) or this PR | Open |

### PR10-SEC-01: the PR can switch off the gitleaks gate (MEDIUM)

**Description.** Lane A's gitleaks step reads its config from the base ref, "so a PR cannot widen its own allowlist" (`.gitleaks.toml:1-2`). Three other suppression paths remain under the PR's control or outside the scan. All three are confirmed by the probe in §2.
- **(a) Inline markers are honoured.** `ci.yml:298` does not pass `--ignore-gitleaks-allow`. The compensating counter (`check-suppressions.mjs:368-374`) runs only on files that `isScanned` (`:340-343`) accepts: JS/TS, CSS, `.yml/.yaml/.toml/.sh`, `.npmrc`, `.env.example`, Dockerfiles, and nothing under `docs/` or `.claude/` (`:45`). A marker in `.md`, `.json`, `.sql`, `.prisma`, `.html` or `.txt`, or anywhere in `docs/`/`.claude/`, is never counted. On docs-only PRs the whole `lint` step is skipped (`ci.yml:224`).
- **(b) `.gitleaksignore` is auto-loaded from the head checkout.** gitleaks loads `<source>/.gitleaksignore`, and `/repo` is the head working tree (`ci.yml:296`). A PR can commit fingerprints (`<commit>:<file>:<rule>:<line>`) for its own findings. No checker rejects the file, and CODEOWNERS does not cover it.
- **(c) Merge commits are not diffed.** `git log -p` over `base..head` prints no patch for a merge commit. Content that exists only in a merge commit (a conflict resolution, or an "evil merge") is never scanned. Task branches merge `main` routinely (two merges in this PR). The push-to-main lane, which would scan the squash commit, is off: `CI_MAIN_FAST_LANE` is unset.

**Exploitability and impact.** No adversary is needed for the accident case. An agent that hits a gitleaks finding in a fixture, runbook or JSON capture (for example a recorded carrier sandbox response under `CARRIER_LIVE_SANDBOX=1`) can "fix" it with a marker or an ignore entry, and lane A stays green. A secret introduced while resolving a merge conflict passes silently.

The impact is High under CLAUDE.md §5. The history is permanent, because force pushes are banned, so the credential must be rotated. Likelihood is Low. H×L = **MEDIUM**, consistent with PR2-SEC-01, the inline-suppression analogue for the lint rules. This PR claims US-048 (AT-US-048-04) and PR1-SEC-11 closure on this gate.

**Remediation (code level).**
1. `ci.yml` gitleaks step:
   - mount only the object store, so no working-tree file can reach `/repo`;
   - make inline markers inert;
   - diff merges against their first parent;
   - run with no network.
   ```yaml
      - name: Gitleaks (PR commit range)
        run: |
          set -euo pipefail
          range="$RANGE_BASE..$RANGE_HEAD"
          if [ -z "$RANGE_BASE" ] || [ "$RANGE_BASE" = "0000000000000000000000000000000000000000" ]; then range="-1 $RANGE_HEAD"; fi
          # Only .git is mounted: gitleaks auto-loads <source>/.gitleaksignore, so no working-tree file may reach /repo.
          docker run --rm --network none \
            -v "$GITHUB_WORKSPACE/.git:/repo/.git:ro" -v "$GITLEAKS_CONFIG_DIR/.gitleaks.toml:/config/gitleaks.toml:ro" \
            -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/repo \
            "$GITLEAKS_IMAGE" git /repo --config /config/gitleaks.toml \
            --log-opts="--diff-merges=first-parent $range" --ignore-gitleaks-allow \
            --redact --no-banner --exit-code 1
   ```
   `--diff-merges=first-parent` re-shows main's incoming changes on a merge commit. They passed their own PR's gate, and a pre-existing hit fails closed and must be fixed anyway.
2. `check-workflow-policy.mjs`, repository mode (base-ref, before any install):
   - fail on any tracked `.gitleaksignore` (`git ls-files -- '.gitleaksignore' '**/.gitleaksignore'`);
   - in `ci.yml`, require the gitleaks step to carry `--ignore-gitleaks-allow` and `--diff-merges=first-parent` and to mount `.git` only.
3. Add `/.gitleaksignore` to CODEOWNERS and to `REQUIRED_CODEOWNED_PATHS`, as defence in depth.
4. With (1) in place the inline marker is inert, so the counter need not scan `docs/`. The counter's `gitleaks-allow` finding stays as hygiene.

**Verification.**
- Re-run `gitleaks-probe.sh` (§2) with the fixed invocation. Expect **5** findings: both controls, `allow.md`, `ign.txt` and `evil.txt`.
- New `check-workflow-policy` fixtures: `gitleaks-allow-honoured.yml` (no `--ignore-gitleaks-allow`) and `gitleaks-no-merge-diffs.yml` fail.
- A repository-mode case with a tracked `.gitleaksignore` fails.

### PR10-SEC-02: base-ref gates share the runner with head code (LOW)

**Description.** The base-ref extraction (`ci.yml:125-157`) writes the gate paths into `$GITHUB_ENV` and the base files into `$RUNNER_TEMP/base`. The gates fall into two groups:
- **Run before any head code:** the workflow policy, install flags, migration immutability, lockfile and dep-age gates. They are robust.
- **Run after head code:** licence, `npm audit signatures`, audit, porcelain, gitleaks, Semgrep and the record check. They follow `npm run deps:rebuild`, and the last four also follow `npm run lint`, `test:unit` and `build` (`ci.yml:198-317`). All of those execute head-controlled code: root `package.json` scripts, the ESLint config and rules, any `*.test.ts`, and allow-listed install scripts.

On a GitHub-hosted runner that code runs as the same user, with passwordless sudo. A test file can append `GATE_RUN_SEMGREP=/dev/null` to `$GITHUB_ENV`, rewrite `$RUNNER_TEMP/base/tools/ci/*.mjs`, or shim `docker`. Every later "base-ref" gate then passes. Such a test touches **no** security-owned path, so even the record check is not triggered.

**Exploitability and impact.** This needs a malicious insider, a compromised agent or a targeted dependency. The repository is private, single-maintainer and closed to outside forks. The tamper code is visible in the diff to code-review. The impact is loss of the automated gates for that PR, compensated by review.

This is the residual of SEC-P3-31 (LOW at P3). SEC-TC-64 as written (an edited checker cannot pass, because the base copy runs) **is met**. The PR's own wording "a PR can neither weaken nor delete the rules it is scanned with" holds only for the five pre-install gates. **LOW.**

**Remediation.**
1. Add an isolated `scans` job. It runs on a fresh VM, so no head code shares its runner.
   - `needs: changes`;
   - `permissions: contents: read`;
   - checkout with `persist-credentials: false`;
   - `actions/setup-node` with a literal `node-version: '24.x'` and no npm cache;
   - **no `npm`, and no script from `$GITHUB_WORKSPACE`**;
   - steps: the base-ref extraction (add `.semgrepignore` and `.gitignore`, PR10-SEC-03), then gitleaks (PR10-SEC-01 form), Semgrep with base rules and ignores, and the record check;
   - `ci-gate` gets `needs: [changes, fast-lane, scans]`.

   Write the YAML in block style (the subset parser rejects flow maps). Cost: about +1 billable job-minute per run, inside D-ARCH-010's ≈ 8 target (measured 5–7).

   AT-US-005-01 fixes the fast-lane order (…build → security). Keep fast-lane's in-lane copies, so the order still holds, or ask product-manager to word "security" as the parallel `scans` job. That is wording only.
2. In fast-lane, move licence, `npm audit signatures` and audit **before** `deps:rebuild`. They need `node_modules`, not lifecycle code. This keeps them pre-head-code at zero cost.
3. Add a `check-workflow-policy` rule (base-ref): in `ci.yml`, no step of job `scans` matches `\bnpm\b`, `node_modules` or `"\$GITHUB_WORKSPACE/[^"]*\.m?[jt]s"`.

**Verification.**
- A policy fixture adds `run: npm ci --ignore-scripts` to `scans`: it fails.
- A `ci-policy.test.ts` assertion checks the `scans` job steps and the `ci-gate` needs.
- A one-off negative PR (not merged) whose unit test appends `GATE_RUN_SEMGREP=/bin/true` to `$GITHUB_ENV` and adds a Semgrep violation: lane A still fails in `scans`.

### PR10-SEC-03: Semgrep scope comes from the head (LOW)

**Description.** `buildScanArgs` mounts the head checkout at `/src` and runs `semgrep scan … .` with `--workdir /src` (`run-semgrep.mjs:73-98`). Semgrep reads `/src/.semgrepignore`, which is the head copy. Through `:include .gitignore` it also reads the head `.gitignore`.

So a PR can add `/apps/api/src/feature/` to `.semgrepignore`, or force-add a tracked file that the head `.gitignore` matches, and the **base-ref rules never see that code**. `--disable-nosem` does not help. The "0 files scanned" guard (`:155`) only catches the extreme case. Both files are owned paths, but the record is self-attestable (PR10-SEC-04).

**Remediation.**
- Extract `.semgrepignore` and `.gitignore` in the base-ref step (`ci.yml:130`).
- Add `run-semgrep.mjs --ignore-from <dir>`. It bind-mounts `<dir>/.semgrepignore` and `<dir>/.gitignore` read-only over `/src/.semgrepignore` and `/src/.gitignore`, and falls back to the head copies only when the base lacks them (bootstrap).
- Print the scanned-file count next to the base run's count in the summary.

**Verification.** A fixture repository whose head `.semgrepignore` adds `/apps/`, plus a seeded `apps/api/src/x.ts` with `import axios from 'axios'`. With `--ignore-from <base>` the finding is reported. Without it, it is not (the negative control).

### PR10-SEC-04: the review-record check is self-attestable and loosely bound (LOW)

**Description.** This is how "CODEOWNERS" is implemented in a single-maintainer repository (PR5-SEC-04; D-TASK007-04). It catches a **forgotten** review, but it cannot catch a **forged** one, and its binding is loose:
1. **Records come from the PR's own tree** (`:168-174`). Whoever can push the branch can commit a record. The check proves that a record exists, not who wrote it.
2. **The name is not bound to the PR.** Any `PR-\d{4}-*.md` counts (`:37`), including another PR's record, if it names a commit in this range (for example on a stacked branch).
3. **Loose verdict parsing** (`:86-90, :110`). The *last* `Verdict` + `:`/`|` + upper-case token anywhere in the file wins, so a quoted example later in a record changes its verdict. Any token not starting with `FAIL` passes, including "PENDING", "TBD" and "BLOCKED".
4. **Push events.** On a push to `main` (when `CI_MAIN_FAST_LANE` is enabled) the range is the squash commit. Records name branch commits, so every merge that touches an owned path fails lane A on `main`. This is latent because the variable is unset.
5. **CODEOWNERS coverage.** The agent control plane is unowned. That covers `.claude/settings.json` (tracked: `PostToolUse` hooks and 78 permission allow-rules, which execute and authorise on the maintainer's host), `CLAUDE.md` (the guardrails) and `.claude/agents/` (29 files, including this reviewer's definition). Lane A also treats them as docs-only (`ci.yml:85`). `.gitleaksignore` (PR10-SEC-01) and `.node-version` are unowned too.

**Exploitability and impact.** Forging a record requires the same trust that pushes the branch. In this process the orchestrator commits records that security-analyst authors. A merged change to `.claude/settings.json` could add a hook that runs on every tool call on the host, or widen agent permissions, without a security record. That would only happen through a reviewed PR, but no automated tripwire asks for the record. **LOW.**

**Remediation.**
- `--pr "$PR_NUMBER"` from `ci.yml`. Accept only `docs/05-quality/security/PR-<printf %04d $PR_NUMBER>-*.md`.
- Parse a fixed header row only: the first `| **Verdict** |` row of the first table, plus a `| Branch / head |` cell naming the reviewed SHA. Allow-list the verdicts `PASS`, `PASS_WITH_FOLLOW-UPS` and `PASS_WITH_CONDITIONS`; everything else fails.
- On `push`, skip with a summary note (it is a PR-time control), or map the squash commit to its PR through `gh api repos/{repo}/commits/{sha}/pulls` and apply the PR rule.
- CODEOWNERS and `REQUIRED_CODEOWNED_PATHS`: add `/.claude/settings.json`, `/.claude/agents/`, `/CLAUDE.md`, `/.gitleaksignore` and `/.node-version`. Change the `changes` classifier so that `.claude/settings.json` is not docs-only.
- principal-architect: add the residual to ADR-0023 (PR5-SEC-04 item 3). "CODEOWNERS" means this check. It detects omission, not forgery. Forgery is controlled by the procedure in PR10-SEC-05 (only the orchestrator commits records, and verifies them against `docs/05-quality/security/` in the main checkout before merging).

**Verification.** New fixtures:
- a record named for another PR number fails;
- a record whose header verdict is a non-allow-listed token fails;
- a header-PASS record with a later quoted FAIL example passes, because the header wins;
- a change to `.claude/settings.json` needs a record;
- `push` mode is not evaluated against branch commits.

### PR10-SEC-05: platform controls (LOW)

**Description.** The repository is private on a plan where `branches/main/protection` and `rulesets` return 403. There is therefore **no required status check, no CODEOWNERS enforcement and no force-push block at the platform**.
- "`ci-gate` is the single required check" (PR body, `ci.yml:6`) is a process convention.
- A skipped `ci-gate` (draft PR) reports as success.
- The Actions policy is `allowed_actions: all`, `sha_pinning_required: false`.
- Merge commit and rebase merges are enabled, although D-TASK007-08 relies on squash (the PR title is linted as the landing header).

**Exploitability and impact.** Every gate is advisory unless the merge procedure enforces it. The Actions settings, unlike `ci.yml`, cannot be weakened from a PR. **LOW.**

**Remediation** (orchestrator and devops-engineer; log in DECISIONS.md):
1. **Actions policy, available now:**
   - `PUT repos/sukhchdit/shipcube/actions/permissions` with `allowed_actions: selected` and `sha_pinning_required: true`;
   - `PUT …/actions/permissions/selected-actions` with `github_owned_allowed: true`, `verified_allowed: false`, `patterns_allowed: []`. Add patterns as TASK-015 needs them.
2. **Merge methods:** squash only (`allow_merge_commit=false`, `allow_rebase_merge=false`, `squash_merge_commit_title=PR_TITLE`).
3. **Merge procedure (D-ORCH merge rule).** Merge with `gh pr merge <n> --squash --match-head-commit <reviewed sha>`, only after verifying both of the following:
   - the `ci-gate` check run for that SHA has conclusion `success` (not `skipped`);
   - the record names that SHA, or a commit after which only `docs/` changed.
4. When the plan allows (Pro, Team or public), enable branch protection: require `ci-gate`, linear history and no force pushes.

**Verification.** `gh api repos/sukhchdit/shipcube/actions/permissions` shows `sha_pinning_required: true`. A scratch workflow on a throwaway branch using `actions/checkout@v7` (a tag) is rejected at queue time. `gh repo view --json mergeCommitAllowed,rebaseMergeAllowed` shows both false.

### PR10-SEC-06: licence and closure from lockfile metadata (LOW)

**Description.** `licence-check` takes the licence from the lockfile entry first and falls back to the installed `package.json` only when the lockfile has none (`licence-check.mjs:223-227`). Production versus dev comes from the lockfile `dev`/`optional`/`devOptional` flags (`dep-gates-lib.mjs:55-57`). Neither is covered by `integrity`: `npm ci` does not compare lockfile metadata with the tarball.

`package-lock.json` is `-diff` for reviewers, and the delta summary lists tuples, not metadata. A lockfile edit can therefore relabel a GPL package as `MIT`, or mark a production package `dev: true`. The latter admits CC-BY or the `elkjs`-style dev-only exceptions in production and hides production moderates as "dev".

**Exploitability and impact.** This is deliberate and needs an owned-path change (`package-lock.json` is code-owned). High/Critical advisories fail in any closure, so the impact is licence compliance and labelling. **LOW.**

**Remediation.**
- After `npm ci`, read the licence from `node_modules/<key>/package.json` (tarball-verified) as the authority. Emit `licence/lockfile-mismatch` when the lockfile disagrees.
- Derive the production closure by walking installed manifests (`dependencies` and `optionalDependencies`) from each workspace's `dependencies`. Fail on a lockfile flag that disagrees.

**Verification.** Fixtures: a lockfile `license: "MIT"` over an installed `GPL-3.0-only` manifest fails, and a `dev: true` flag on a package reachable from `apps/api` `dependencies` fails.

### PR10-SEC-07: workflow-policy gaps for future workflows (LOW)

**Description.** `policy-probe.mjs` against the PR head `checkWorkflow()`:

| Snippet | Policy result |
|---|---|
| `run: npx foo` (control) | `npx` |
| `run: "\x6epx foo"`, and `"npm audit signatures \x7c\x7c true"` | `yaml-subset` (fails closed) |
| quoted key `"run": npx foo`; folded `run: >` | `npx` |
| `run: echo "${{ github.event.pull_request.title }}"` | **no finding** |
| `run: git checkout ${{ github.head_ref }}` | **no finding** |
| `actions/github-script` `script:` with `${{ github.event.pull_request.body }}` | **no finding** |
| `on: issue_comment` (runs the base workflow with secrets and a write token) | **no finding** |

actionlint (`ci.yml:247-248`) flags untrusted inputs in `run:` and `script:`, but its configuration (`.github/actionlint.yaml`) comes from the head. The policy also does not assert that `ci.yml` keeps its gate steps unconditional. A TASK-015 refactor that drops or `if:`-guards the gitleaks step would pass.

**Remediation.**
- `untrusted-expression` rule: in `run:` and `with.script`, reject any `${{ … }}` except an allow-list of non-attacker contexts: `github.{sha,ref,repository,run_id,run_attempt,workflow,event_name}`, `runner.*`, `steps.*.outputs.*`, `needs.*.outputs.*`, `matrix.*`, `env.*`, and `secrets.*` in non-PR workflows. Everything else must go through `env:`.
- Add `issue_comment`, `pull_request_review`, `pull_request_review_comment`, `discussion` and `discussion_comment` to `forbidden-trigger`.
- `required-gates` (ci.yml): a manifest of gate steps that must exist, with only the `CODE`/`LINT_CONTROLS` `if:` forms and their required flags.

**Verification.** One fixture per row above that currently shows "no finding", each failing; `valid.yml` and the real `ci.yml` still pass.

### PR10-SEC-08: the OpenAPI allowlist is value-unbounded (LOW)

**Description.** The first allowlist suppresses **any** value matching `[A-Za-z0-9_.=-]+` under **any** key ending in `token` or `proof`, plus any `client_secret: pi_*`, anywhere in the 16k-line `openapi.yaml`. Today it covers 19 lines across 10 keys.

Probe: `access_token: <JWT>`, `refresh_token: ghp_<36>` and `api_token: sk_live_…` are all suppressed. `sec-static.test.ts` checks only that no allowlist admits an AWS-key-shaped value.

**Exploitability and impact.** The realistic case is accidental. An agent pastes a captured carrier or Stripe sandbox response as an example. Carrier OAuth tokens are short-lived, but other key types are not. **LOW.**

**Remediation.** Prefer api-designer's switch to marker values, after which the allowlist requires the marker, for example `'''^\s+[a-z_]*(?:token|proof):\s+EXAMPLE[A-Za-z0-9_.=-]*\s*$'''`. Until then, replace the value classes with the exact current example values (19 literal regexes), so any new or changed value is scanned.

**Verification.** A `sec-static.test.ts` case runs the allowlist regexes over JWT-, GitHub-PAT- and `sk_live_`-shaped values under `access_token:`. None is admitted.

### PR10-SEC-09 to PR10-SEC-15 (INFO)

- **PR10-SEC-09: `.npmrc` key allow-list.** `checkNpmrc` requires 4 keys but accepts any others.
  - `registry=` redirects `npm audit` (the advisory source) and `npm audit signatures` (the key source) to a chosen host. Integrity still protects tarballs, and osv-scanner still backstops advisories.
  - `omit=dev` hides dev advisories from `npm audit`.
  - `node-options=` preloads into every `npm run`.
  - The file is code-owned and tiny, so a change is visible.

  **Fix:** a fail-closed key allow-list (`ignore-scripts`, `engine-strict`, `min-release-age`, `@platform:registry`, plus named cosmetic keys such as `fund`). Fixtures cover `registry=`, `omit=dev` and `strict-ssl=false`.
- **PR10-SEC-10: migration immutability.**
  - (a) An added `prisma/migrations/<new>/migration.sql` that is a **symlink** (mode `120000`) passes as `A`, so its SQL can live outside the immutable tree and change later. Fresh and existing databases would then fork (the PR8-SEC-01 class).
  - (b) `baseDirs` comes from the merge base (`:79-89`), so a directory released on `main` after the fork point counts as "new".

  **Fix:** use `git diff --raw` and accept only mode `100644` under `prisma/migrations`. Take `baseDirs` from (merge base ∪ base tip). **Due before M5.**
- **PR10-SEC-11: classification and semantics.**
  - `changes` uses the PR files API, which caps at 3,000 files and returns the PR's current files rather than the event SHA's.
  - `.claude/**` is docs-only (see PR10-SEC-04).
  - The record check fails on push for squash merges (latent).
  - A skipped `ci-gate` reports success.

  **Fix:** classify with `git diff --name-only "$RANGE_BASE...$RANGE_HEAD"` inside fast-lane or `scans` (the full checkout is already there). Make `ci-gate` fail when `changes` was skipped on `pull_request`.
- **PR10-SEC-12: registers.**
  - Waivers (`check-audit.mjs:54`) have no `granted` date, no maximum span and no decision-ID format. Overrides are capped at 30 days, and maintenance entries check `^D-[A-Z]+-\d+`, so a waiver can be dated 2099.
  - A same-tuple integrity change is only reported. `npm ci` would fail it on EINTEGRITY anyway, because npmjs versions are immutable.

  **Fix:** waivers need `granted`, `expires − granted ≤ 90 days` and a decision ID. Integrity changes fail (`lockfile/integrity-changed`).
- **PR10-SEC-13: container tool freshness.** Dependabot covers npm and actions only. The gitleaks default rules ship inside the pinned image and will age. **Fix (TASK-015):** a monthly lane C job, or a `review_by` date per digest in a register that `check-dep-age` evaluates.
- **PR10-SEC-14: fixture blind spots.**
  - `password-hashing.yml:24` excludes `fixtures/` at any depth, so production code under `apps/*/src/**/fixtures/` is skipped. This is the PR2-SEC-09 class.
  - `/tests/fixtures/` is excluded from Semgrep, from ESLint (the semgrep fixtures) and from the counter. Nothing there ships, but `*.test.ts` files under it would execute in CI.

  **Fix:** anchor the exclude to `/tests/fixtures/`, and assert that no `*.test.*` file exists under `tests/fixtures/`.
- **PR10-SEC-15: PR1-SEC-10, caniuse-lite half.** `licence-check` emits the attribution note, but `THIRD_PARTY_NOTICES.md` does not exist. caniuse-lite is build-time data and is never redistributed, so this is policy conformance (D-ARCH-003 rev 2 item 2), not a legal exposure. Create the file in the fix cycle, or route it to technical-writer for P7.

## 4. Reviewer-focus answers and D-TASK007 decisions

1. **YAML subset parser (focus 1).** It is adequate for TASK-015 as long as it stays fail-closed. Escapes, anchors and flow maps are rejected, and quoted keys and folded scalars are understood (probe). Use block style in new workflows.
2. **Bootstrap rule (focus 2).** Refusing `--report-only` once the base contains the script is sound, but `ci.yml` itself can still drop or guard the step (PR10-SEC-07 `required-gates`). Under `pull_request` the head workflow file always decides which steps run. Only platform controls (PR10-SEC-05) and the merge procedure sit outside it.
3. **`check-dep-age --fetch` (focus 3).** Accepted. It is scoped to delta tuples on PRs, never queries `@platform/*`, and uses `redirect: 'error'`, a 30 s timeout, 3 attempts with jitter, and bounded concurrency (≤ 16). The cooldown reference min(now, lockfile committer time) is correct: a forged past date makes it stricter, and a forged future date is clamped to now (D-TASK007-03).
4. **Gitleaks allowlists (focus 4):** PR10-SEC-08. I agree with the `EXAMPLE_…` route.
5. **`@ts-expect-error` needs a TASK-ID (focus 5).** Accepted. The one suppression (`catalogue.test.ts`, TASK-013) is compliant.
6. **D-TASK007-08 (focus 7).** Security-neutral and well implemented: the title goes through `env` and `printf`. It depends on squash-only merges (PR10-SEC-05 item 2).
7. **Decisions D-TASK007-01..09.**
   - **01** (stale transitives report-only): consistent with D-ARCH-003 rev 4.
   - **02** (dated waivers): accepted, with the PR10-SEC-12 cap.
   - **03** (cooldown reference): verified.
   - **04** (record rule): accepted, with PR10-SEC-04.
   - **05** (dates), **06** (osv-scanner v2.7.0, inside the cooldown) and **09** (CODEOWNERS coverage, migration message): fine.
   - **07** (fixture ignores): fine, with PR10-SEC-14.

## 5. Routed-item closure

Closure was checked against the head code, fixtures and lane A run. "Residual" points to a new finding above; none of them reopens the routed item's own requirement.

| Item (source review) | Requirement routed to TASK-007 | Status | Evidence / residual |
|---|---|---|---|
| PR1-SEC-02 item 5 | Policy rejects engine-redirect env; engine cache keyed by `enginesVersion` + OS; `check-no-raw-prisma` | **Closed** | `FORBIDDEN_ENV` (10 vars) incl. run-script form; `ci.yml:183-200` (re-verified by `deps:rebuild`); `check-install-flags` raw-prisma rule + fixture |
| PR1-SEC-03 (b) | Post-build porcelain gate with a negative fixture | **Closed** | `ci.yml:286-288`; `check-porcelain.test.ts` temp repo whose build rewrites `package.json` |
| PR1-SEC-03 (c) | Job-level `NPM_CONFIG_IGNORE_SCRIPTS` | **Closed** | `ci.yml:106` (also workflow level, `:41`). The TASK-014 image part of PR1-SEC-03 remains |
| PR1-SEC-05 | `elkjs` named exception, dev only; another EPL-2.0 package fails | **Closed** | `licence-exceptions.json` (exact tuple, SPDX, via chain, `closure: dev`); `exception-chain` / `exception-in-production` rules |
| PR1-SEC-06 | bcrypt register for the freshness gate | **Closed (TASK-007 part)** | `maintenance-exceptions.json` D-ARCH-042, expires 2027-05-11; a High voids it (`check-audit`). TASK-049 part remains |
| PR1-SEC-07 | `node-abort-controller` ruling in the register | **Closed** | D-ARCH-043, expires 2027-05-12 (D-TASK007-05) |
| PR1-SEC-08 | Workflow-level `CHECKPOINT_DISABLE`, `SCARF_ANALYTICS` | **Closed (workflow part)** | `ci.yml:42-43`; `REQUIRED_WORKFLOW_ENV` enforced for every workflow. TASK-014 part remains |
| PR1-SEC-10 | `png-js` override; caniuse-lite attribution | **Partial** | png-js `metadataOverrides` with evidence: closed. `THIRD_PARTY_NOTICES.md` absent: PR10-SEC-15 |
| PR1-SEC-11 | `.gitleaks.toml` handling of the example hits | **Closed** | Path AND line allowlists (19 lines today). Residual: PR10-SEC-08 |
| PR1-SEC-12 | Signatures with the scope override only; `\|\| true` rejected; lockfile-driven freshness; Dependabot ignore | **Closed; after-merge check open** | `ci.yml:208` (run: 1,490 signatures, 569 attestations); `platform-registry` and `audit-signatures-masked` rules and fixtures; `check-dep-age` (no `npm outdated`); `dependabot.yml:16-17`. **After merge:** check the first Dependabot run for `private_source_not_reachable` |
| PR1-SEC-13 + R2-n4 | `@platform/*` link-only incl. alias/name/resolved forms; no integrity on links; delta summary | **Closed** | `check-lockfile.mjs` `platform/*` rules; `negative.json` fixtures; `lockfileDelta` in the job summary |
| PR2-SEC-01 items 1, 2, 4 | Suppression counter (third `lint` step), protected rules, `TASK-\d{3}`; any-justification TASK-ID | **Closed for code files** | `check-suppressions.mjs`; `package.json` `lint`; `any-justification.mjs` + `bad-no-task-id` fixture. Gitleaks-marker half ineffective outside code types: PR10-SEC-01 |
| PR2-SEC-02 | Mandatory Semgrep `password-hashing` with the residual forms, base ref, `--disable-nosem` | **Closed** | Every listed form is in `password-hashing.yml` (aliased/member `createRequire`, `$R("<bcrypt>")`, `.call/.apply`, `["require"]`, `_load`, non-literal loads, hasher re-exports); self-test 5/5. Residuals: PR10-SEC-02/03/14 |
| PR2-SEC-04 (Semgrep half) | Same sink list as the ESLint rules | **Closed** | `outbound-http.yml` ⊇ the ESLint list (axios, node-fetch, cross-fetch, got, ky, undici, superagent, request, needle, http/https) plus http2/net/tls, WebSocket/EventSource and global fetch; `innerhtml.yml` |
| PR2-SEC-06 | Watchlist for the 3 dev GHSAs | **Closed; baseline open** | `advisory-watchlist.json` (`review_by` 2027-02-12). **After merge:** dependency-auditor baseline (R-ARCH-12) |
| PR2-SEC-07 | Legacy `licenses` arrays; permissive equivalents; stale-transitive report | **Closed** | `declaredLicence` array handling; `PRODUCTION_ALLOWED` (MIT-0, 0BSD, BlueOak, PSF/Python); report-only per D-TASK007-01 |
| PR2-SEC-08 | CODEOWNERS on the lint controls; base-ref negative-fixture suite | **Closed** | CODEOWNERS lines 19-30; `ci.yml:258-280` (no-weakening subset; the run executed 68 cases) |
| PR2-SEC-11 / R2-m1 | `.gitignore` anchoring + `check-ignore` test | **Closed** | `.gitignore` matrix; `tools/repo/gitignore.test.ts` |
| R2-n8 | `.stylelintignore` symmetric with ESLint ignores | **Closed** | `.stylelintignore`; symmetry asserted in `gitignore.test.ts` |
| PR4-SEC-04 | Porcelain backstop | **Closed** | As PR1-SEC-03 (b) |
| PR4-SEC-08 | Reject `PLAYWRIGHT_*DOWNLOAD_HOST` | **Partial (as planned)** | `PLAYWRIGHT_HOST` regex in env and run scripts; browser cache and `--with-deps` confinement stay with TASK-011/015 |
| PR4-SEC-09 | Freshness report lists `nanospinner` | **Closed (fixture)** | `check-dep-age.test.ts`; the live whole-lockfile report runs in lane C (TASK-015) |
| PR4 gitleaks on PR ranges | Lane A gitleaks over the PR range | **Closed** | `ci.yml:290-298`; residual PR10-SEC-01 |
| PR5-SEC-04 | CODEOWNERS (paths listed in PR-0005) + record check from the base ref | **Closed (implementation)** | Every PR-0005 path is covered; `check-security-owned-paths.mjs` + fixtures. Residual: PR10-SEC-04. **Item 3 (ADR-0023 wording) open:** principal-architect |
| PR5-SEC-07 (workflow half) | Reject `NODE_OPTIONS` preloads and `NODE_TLS_REJECT_UNAUTHORIZED=0` | **Closed** | `PRELOAD` and `tls-verify-disabled` rules + fixtures |
| PR5 n8 | No direct `_prisma_migrations` writes outside `prisma/tests` | **Closed** | `prisma-migrations-write` rule |
| SEC-FU-PR1 (TASK-007 half) | D-ARCH-003 rev 4 registers, checks, negative fixtures; closures from lockfile flags | **Closed** | 4 registers with validators; residual on flag trust: PR10-SEC-06 |
| PR8-SEC-01 (generic backstop) | Released migration directories stay byte-identical | **Closed** | A-only rule relative to the merge base, `--no-renames`, before any head code. INFO residual: PR10-SEC-10 |
| PR8-SEC-11 | CODEOWNERS on `packages/authz`, `prisma/migrations` | **Closed** | CODEOWNERS lines 33-40; `REQUIRED_CODEOWNED_PATHS` |
| PR8-SEC-13 | Base-ref A-only migration check + CODEOWNERS for `packages/authz`, `tools/authz`, `prisma/migrations` | **Closed (lane A)** | As PR8-SEC-01 and PR8-SEC-11; `tools/authz/` is owned |
| SEC-TC-32 (CI) | Read-only token, no `pull_request_target`, SHA pins, `--ignore-scripts`, signatures | **Closed** | `ci-policy.test.ts`; policy rules |
| SEC-TC-45 (CI) | Scripts off at workflow and job level; provenance and cooldown before install | **Closed** | `ci.yml:41, 106, 168-181` |
| SEC-TC-51 (workflow) | `CARRIER_*`/`STRIPE_*` only under `environment: carrier-sandbox`, never on PR/push | **Closed** | `sandbox-secrets` rule + 3 fixtures |
| SEC-TC-64 (CI) | An edited gate script cannot pass because the base copy runs; `npm exec --no` | **Closed as specified** | Base-ref extraction (bootstrap: head). Residual beyond the TC's wording: PR10-SEC-02 |
| SEC-P3-31 | Gate tooling from the base ref; no `npx` | **Closed with residual** | As SEC-TC-64; PR10-SEC-02/03 |

## 6. Actions

| Action | Finding | Owner | Due |
|---|---|---|---|
| Gitleaks: `.git`-only mount, `--ignore-gitleaks-allow`, `--diff-merges=first-parent`, `--network none`; policy rule and fixtures; CODEOWNERS `.gitleaksignore` | PR10-SEC-01 | senior-developer → devops-engineer | **This PR's fix cycle (recommended)**; at the latest before the first Wave-1 feature merge |
| Isolated `scans` job; licence/signatures/audit before `deps:rebuild`; policy rule | PR10-SEC-02 | devops-engineer; product-manager only if AT-US-005-01 wording changes | This PR or TASK-015; before the first Wave-1 feature merge |
| Semgrep `--ignore-from` base `.semgrepignore`/`.gitignore` | PR10-SEC-03 | devops-engineer | With PR10-SEC-02 |
| Record check bound to the PR number, header verdict allow-list, push semantics; CODEOWNERS for the agent control plane | PR10-SEC-04 | devops-engineer; principal-architect (ADR-0023 residual wording) | Before the first Wave-1 feature merge |
| Actions policy (`sha_pinning_required`, selected actions), squash-only merges, `--match-head-commit` merge procedure | PR10-SEC-05 | orchestrator + devops-engineer (DECISIONS.md) | Now (settings); procedure from the next merge |
| Licence and closure from installed manifests | PR10-SEC-06 | senior-developer | Before TASK-014 images |
| `untrusted-expression`, privileged triggers, `required-gates` | PR10-SEC-07 | devops-engineer | Before TASK-015 adds workflows |
| OpenAPI example marker values, then exact allowlist | PR10-SEC-08 | api-designer + devops-engineer | Next contract revision |
| INFO items 09–15 | PR10-SEC-09..15 | as listed | Opportunistic; PR10-SEC-10 before M5; PR10-SEC-15 by P7 |
| After merge: Dependabot `private_source_not_reachable` check; dependency-auditor baseline incl. a one-off **full-history** gitleaks scan with `--ignore-gitleaks-allow` | PR1-SEC-12, PR2-SEC-06, PR10-SEC-01 | security-analyst | First Dependabot run / R-ARCH-12 |

## 7. Merge statement

- **Merge rule.** No Critical or High finding is open, so the change may merge (CLAUDE.md §8, acceptance "no Critical/High open").
- **What this record names.** It reviews head `28442b6`, after which no security-owned path has changed.
- **Under the bootstrap rule** (D-ORCH-004) the record check runs `--report-only` on this PR.
- **If a fix cycle changes owned paths** (PR10-SEC-01 touches `.github/` and `tools/ci/`), a round-2 section must name the new head. Once merged, the check is enforcing for every later PR.

## Round 2 (head 26fc08d)

| Field | Value |
|---|---|
| Head | `26fc08da753ceb9dd8b9638cb4c70e19580a3c47` on `feat/TASK-007-ci-lane-fast-lane-workflow`. It merges `main`, which brings in docs only, on top of the last code commit `a88aaea`; `git diff a88aaea 26fc08d -- . ':!docs' ':!.claude'` is empty |
| Delta reviewed | `git diff 28442b6..a88aaea`, which is `1cff9ac` (the fix) plus `a88aaea` (suppression-counter wording). In scope: `.github/workflows/ci.yml`, `.github/CODEOWNERS` and `tools/ci/**`. That covers `check-workflow-policy`, `check-security-owned-paths`, `check-audit`, `check-install-flags`, the new `npm-command`, `run-semgrep`, `yaml-subset`, and their tests and fixtures |
| Inputs | Fix comment [6832420637](https://github.com/sukhchdit/shipcube/pull/10#issuecomment-6832420637); D-TASK007-02; D-ORCH-012/013; the round-1 sections above |
| Lane A evidence | Run [43279941688](https://github.com/sukhchdit/shipcube/actions/runs/43279941688): `pull_request` on head `26fc08d`, merge ref `f0a8d9c`, base `c29f89b`. `fast-lane`, `scans` and `ci-gate` all concluded `success`. In `scans`, gitleaks scanned **15 commits** (4 of them merges) with the hardened flags and found no leaks. Semgrep reported 0 findings in 91 files, with the scope taken from the base. The record check ran report-only (bootstrap) and correctly reported the round-1 record as stale |
| Reviewer / date | security-analyst, 2026-11-13. Read-only: no `npm ci`, no build, no test suite. **One** Docker run (the gitleaks probe in R2.2); every other probe is a Node script over a `git archive 26fc08d` copy in scratch |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open, so the merge rule is met for `26fc08d`. PR10-SEC-01, the only MEDIUM, is **closed**, and the probe proves it. Of the round-1 items, 01, 02, 04, 07 and 11 are closed; 03 and 12 are partly closed; 05, 06, 08, 09, 10, 13, 14 and 15 stay open as routed. Round 2 adds **2 LOW** (PR10-SEC-16, -17) and **3 INFO** (PR10-SEC-18..20). None of them blocks this merge |

### R2.1 Summary

The fix cycle does what round 1 asked, and its core claims hold under test.
- **Gitleaks can no longer be switched off by the PR.** Only `.git` is mounted, inline markers are inert, merges are diffed against their first parent, and the container has no network. I re-ran my round-1 probe with the CI flags, and all 5 cases are now reported. A `.gitattributes` committed by the PR (`-diff` / `binary`) cannot hide a file either (R2.2).
- **`scans` is isolated.** It runs on its own runner, with no npm and no workspace script. Its Node scripts import only `node:` built-ins. Its git calls are read-only plumbing with no head-controlled configuration, hooks or drivers. Head content reaches it only as data (gitleaks, Semgrep, records).
- **The record check is bound to the PR number.** The verdict is allow-listed, SHAs come from head rows only, renames count, and merges of `main` are handled. The parser behaves as documented, and this record parses under it (R2.6).
- **Waivers are capped** at 90 days and need a decision ID.
- **Install-flag detection held.** It flagged every lifecycle-script override form I tried.

The new findings concern how far the new guards reach, not the controls themselves.
- **16 (LOW): nested Semgrep scope files.** Semgrep 1.183 uses Semgrepignore v2, which honours `.semgrepignore` and `.gitignore` files in **any** folder. `--ignore-from` overlays only the root copies, and the nested ones are unowned.
- **17 (LOW): pattern-narrow policy rules.** Each of the following passes:
  - a relative `node tools/ci/x.mjs` in `scans`;
  - a gitleaks bind written with `--mount`;
  - `--exit-code 0` or `\|\| true` on the gitleaks step;
  - an edited base-ref extraction step.

  `untrusted-expression` also admits `env.*`, step outputs and `matrix.*`, which allows second-order injection. That allow-list was my own round-1 proposal.
- **18–20 (INFO):**
  - setup-node's automatic package-manager cache;
  - record-parser residuals;
  - `REQUIRED_CODEOWNED_PATHS` and CODEOWNERS gaps.

### R2.2 Method and probes

**Gitleaks probe** (`…/scratchpad/review/PR-10-sec-r2/scripts/gitleaks-probe-r2.sh`):
- **Setup.** The pinned image `sha256:c00b6bd0…` with the PR's `.gitleaks.toml`, invoked exactly as `ci.yml:362-367` does:
  - `-v <repo>/.git:/repo/.git:ro`;
  - `--log-opts="--diff-merges=first-parent <A>..<M>"`;
  - `--ignore-gitleaks-allow`;
  - `--network none`.
- **The synthetic repository** is the round-1 one plus three attribute cases. Its base carries the repository's real `package-lock.json linguist-generated=true -diff` line. All values are random strings in provider formats.

  | Case | Content | Round 1 | Round 2 |
  |---|---|---|---|
  | Control | `ctl.json`: an AWS-format key and a GitHub-PAT-format token | Reported (2) | **Reported (2)** |
  | (a) | `allow.md`: key + `<!-- gitleaks:allow -->` | Not reported | **Reported** |
  | (b) | `ign.txt`: PAT fingerprinted in a `.gitleaksignore` committed by the PR | Not reported | **Reported** |
  | (c) | `evil.txt`: key only in the merge commit | Not reported (3 of 4 commits scanned) | **Reported** (4 of 4) |
  | (d) new | `attr.txt`: key; the PR adds `attr.txt -diff` to the root `.gitattributes` | n/a | **Reported** |
  | (e) new | `sub/x.txt`: key; the PR adds `sub/.gitattributes` with `* binary` | n/a | **Reported** |
  | (f) new | `package-lock.json`: PAT under an extra key | n/a | Not reported, by design (see below) |

- **Result: 7 findings.** These are the 5 that round 1 expected, plus (d) and (e).
- **Why (d) and (e) are reported.** `git log -p` takes attributes from the work tree. A host experiment showed git applies a committed `-diff` only when the work tree holds the file, and the container has no work tree. So the `.git`-only mount neutralises attribute-based hiding as well.
- **Why (f) is not reported.** Gitleaks' default global allowlist skips `package-lock.json`, `node_modules/` and other lockfiles, and `useDefault = true` inherits it. That is accepted:
  - `check-lockfile` pins every `resolved` to the exact npmjs tarball URL, so a credential-bearing URL fails there;
  - `package-lock.json` is code-owned.
- **No other ignore file is loaded.** Gitleaks' `--gitleaks-ignore-path` defaults to `.`, which is `/` in the image (WorkingDir `/`), and there is no ignore file there.

**Policy probe** (`policy-probe-r2.mjs`). It runs `checkWorkflow` / `checkWorkflowPolicy` from `git archive 26fc08d`.
- **Controls that flag:**
  - an untrusted title in `run:`;
  - the upper-case form `GITHUB.EVENT…`;
  - `$GITHUB_WORKSPACE/…mjs` in `scans`;
  - a full-workspace gitleaks `-v`;
  - a removed gitleaks step.
- **The real `ci.yml` passes.**
- **Gaps:** listed in PR10-SEC-17.

**Install-flag spot probe** (`npm-probe-r2.mjs`, against `scriptFindings`).
- **Flagged:**
  - `--ignore-scripts=false`, `=FALSE` and `=0`;
  - the flag placed before the command;
  - the `isntall` alias;
  - `NPM_CONFIG_IGNORE_SCRIPTS=false` and the empty-value prefix;
  - `npm config delete ignore-scripts`;
  - `echo ignore-scripts=false >> .npmrc`.
- **Not flagged:** `env -u` and `unset` of the variable. They are harmless, because the code-owned `.npmrc` still sets `ignore-scripts=true` and `check-install-flags` requires that line.

**Isolation review of `scans`** (`ci.yml:288-382`).
- **Module resolution.** `check-security-owned-paths.mjs` and `run-semgrep.mjs` import only `node:` modules and sit under `$RUNNER_TEMP`. Module resolution therefore never walks into `$GITHUB_WORKSPACE`.
- **Git calls.** They are `diff --name-only`, `show <rev>:<path>`, `rev-list`, `cat-file` and `archive <base>`. None of them runs an attribute-driven driver. `.git/config` is written by `actions/checkout`, not the PR.
- **Node 24** loads no project configuration unless a flag asks for it.
- **setup-node:** see PR10-SEC-18.

**Repository settings**, re-read on 2026-11-13, are unchanged:
- `allowed_actions: all` and `sha_pinning_required: false`;
- all three merge methods enabled;
- branch protection returns 403.

### R2.3 Closure of round-1 findings

| ID | Round-1 severity | Status at `26fc08d` | Evidence / residual |
|---|---|---|---|
| PR10-SEC-01 | MEDIUM | **Closed** | Gitleaks step `ci.yml:357-367`: `.git`-only mount, `--ignore-gitleaks-allow`, `--diff-merges=first-parent`, `--network none`, base config. The probe reports 5 of 5 cases plus the attribute cases. CI scanned 15 commits, including 4 merges. Added: rule `gitleaks-hardening` with 4 failing fixtures and 1 passing; repository rule `gitleaksignore`; `/.gitleaksignore` in CODEOWNERS:27 and in `REQUIRED_CODEOWNED_PATHS`. Guard reach: PR10-SEC-17 |
| PR10-SEC-02 | LOW | **Closed** | A separate `scans` job (`ci.yml:288-382`) runs no npm and no workspace script. Licences, signatures and audit now run before `deps:rebuild` (`ci.yml:160-203`). Added: rule `scans-isolation` with 3 fixtures; `ci-gate needs [fast-lane, scans]`. Fast-lane steps that still run after head code (porcelain, commitlint, actionlint, base-ref lint fixtures, Semgrep self-test) are accident guards whose subject is the head itself. Guard reach: PR10-SEC-17 |
| PR10-SEC-03 | LOW | **Partly closed** | The root `.semgrepignore` and `.gitignore` come from the base and are bind-mounted read-only (`run-semgrep.mjs:108-118`, `ci.yml:370`), proven by `run-semgrep.int.test.ts`. The lint-fixture harness and `tools/test-support/` also come from the base (`ci.yml:250-260`). Nested scope files: **PR10-SEC-16** |
| PR10-SEC-04 | LOW | **Closed (implementation)** | In `check-security-owned-paths.mjs` (`:149-212, 249-283, 343`): `--pr` binding, an allow-list for the last Verdict row, SHAs from head rows only, `--no-renames`, merge-of-main handling, and a push skip. CODEOWNERS:59-61 covers the agent control plane, plus `.node-version` and `.gitleaksignore`. The classifier treats `.claude/settings.json` as code (`ci.yml:94`). Parser residuals: PR10-SEC-19. **Still open:** item 3, the ADR-0023 wording (principal-architect) |
| PR10-SEC-05 | LOW | **Open (procedural mitigation)** | The settings change was denied (D-ORCH-012). The merge procedure is `--squash --match-head-commit`, only after a `success` ci-gate on that SHA (D-ORCH-013 and the `ci.yml:9-12` header). Draft PRs now get a red ci-gate. The repository-owner action stays listed |
| PR10-SEC-06 | LOW | Open | Routed: due before TASK-014 |
| PR10-SEC-07 | LOW | **Closed (as specified)** | `untrusted-expression`, the extended `forbidden-trigger` and `required-gates` (`check-workflow-policy.mjs:93-136, 317-330, 598-629`), with fixtures. Reach of the new rules: **PR10-SEC-17** |
| PR10-SEC-08 | LOW | Open | Routed to api-designer |
| PR10-SEC-09 | INFO | Open | There is still no `.npmrc` key allow-list. D-TASK006-02 item 5 routed its own `.npmrc` residual (`script-shell` and similar keys) to this item, so it now has a second consumer |
| PR10-SEC-10 | INFO | Open | Due before M5 |
| PR10-SEC-11 | INFO | **Closed** | Fast-lane classifies with `git diff --no-renames base...head`: no API call, no file cap. `.claude/settings.json` counts as code. Push skips the record check. ci-gate fails when a lane was skipped (`ci.yml:384-403`) |
| PR10-SEC-12 | INFO | **Partly closed** | Waivers now need a `granted` date that is not in the future, a span of at most 90 days and a decision ID, otherwise exit 2 (`check-audit.mjs:50-96`; 90- and 91-day fixtures). A same-tuple integrity change is still reported, not failed (`check-lockfile.mjs` is unchanged); `npm ci` EINTEGRITY remains the backstop |
| PR10-SEC-13 | INFO | Open | TASK-015 |
| PR10-SEC-14 | INFO | Open | `.semgrep/password-hashing.yml` and `.semgrepignore` are unchanged. The anchoring done in this cycle is `check-install-flags` `SKIP_ROOTED` (code-review n2) |
| PR10-SEC-15 | INFO | Open | Due by P7 |

### R2.4 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR10-SEC-16 | Nested `.semgrepignore`/`.gitignore` files (Semgrepignore v2) can still narrow the Semgrep scope | LOW | CWE-693 | A08 | `run-semgrep.mjs:99, 108-118`; `ci.yml:370`; CODEOWNERS:23-24 | devops-engineer | Open |
| PR10-SEC-17 | The new policy rules are pattern-narrow: `scans-isolation`, `gitleaks-hardening`, `required-gates` (gate inputs not pinned) and `untrusted-expression` (`env.*`, outputs, `matrix.*`) | LOW | CWE-693, CWE-78 | A08 / A03 | `check-workflow-policy.mjs:108-109, 115-139, 337-353, 578-592` | devops-engineer | Open |
| PR10-SEC-18 | setup-node's automatic package-manager cache is not disabled in `scans` | INFO | CWE-829 | A08 | `ci.yml:309-312`; `check-workflow-policy.mjs:589-590` | devops-engineer | Open |
| PR10-SEC-19 | Record-parser residuals: any one record passes, rows inside HTML comments count, `Head\b` is broad, records can be planted for another PR | INFO | CWE-345 | A04 | `check-security-owned-paths.mjs:116-141, 161-164, 185-210` | devops-engineer; orchestrator | Open |
| PR10-SEC-20 | Ownership residuals: `REQUIRED_CODEOWNED_PATHS` is a subset of CODEOWNERS; `.gitattributes`, nested scope files and reviewer instruction files are unowned | INFO | CWE-284 | A04 | `check-workflow-policy.mjs:656-682`; `.github/CODEOWNERS` | devops-engineer; orchestrator | Open |

#### PR10-SEC-16: nested Semgrep scope files (LOW)

**Description.** The pinned Semgrep 1.183.0 selects targets with **Semgrepignore v2**, the default since 1.117.0. Its reference says that, in a git project, it consults "all the `.semgrepignore` files in the project" and "all the `.gitignore` files in the project", in gitignore order and with negation. `--ignore-from` (`run-semgrep.mjs:108-118`) overlays only `/src/.semgrepignore` and `/src/.gitignore`.

A PR can therefore remove a folder from the base-ref scan in two ways:
- add `apps/api/src/feature/.semgrepignore` containing `*`;
- add a nested `.gitignore` that matches tracked source.

CODEOWNERS owns only `/.gitignore` and `/.semgrepignore` (lines 23-24), so neither change requires a record. The scanned-file count is printed (91 today) but compared only with zero.

**Exploitability and impact.**
- **Deliberate case.** A malicious agent hides code from the password-hashing, outbound-HTTP, raw-SQL and innerHTML packs. ESLint duplicates part of this, which limits the impact.
- **Accidental case.** A nested `.gitignore` for generated code that is tracked.

Evidence: Semgrep's v2 reference. Not executed here, because of the one-Docker-run budget. Impact Medium × Likelihood Low = **LOW**, the PR10-SEC-03 class.

**Remediation.**
1. In `scans`, Semgrep scans a clean export instead of the checkout:
   ```bash
   src="$RUNNER_TEMP/scan-src"; mkdir -p "$src"
   git archive "$GITHUB_SHA" | tar -x -C "$src"   # merge-ref tree, no .git
   find "$src" -mindepth 2 \( -name .semgrepignore -o -name .gitignore \) -delete
   node "$GATE_RUN_SEMGREP" --root "$src" --rules-from "$GATES_DIR/.semgrep" --ignore-from "$GATES_DIR" --summary "$GITHUB_STEP_SUMMARY"
   ```
   Without `.git`, the project root is the scan root, and the overlaid base copy is the only scope file left. Alternative: keep the checkout, and have `run-semgrep --ignore-from` exit 2 when the scanned tree contains any non-root `.semgrepignore` or `.gitignore`.
2. Add a repository-mode policy rule `nested-scope-file` that fails on any non-root `.semgrepignore`. Add `**/.semgrepignore` and `**/.gitignore` to CODEOWNERS and `REQUIRED_CODEOWNED_PATHS` (PR10-SEC-20).
3. Print the scanned-file count next to the count for the base scope.

**Verification.**
- Extend `run-semgrep.int.test.ts` with a seeded `apps/api/src/x.ts` that calls `fetch(…)`, plus `apps/api/src/.semgrepignore` containing `*`. With the fix, the call is reported. Without the fix, it is not (negative control).
- Add a policy fixture with a nested `.semgrepignore`; it must fail.

#### PR10-SEC-17: the new policy rules are pattern-narrow (LOW)

**Description.** Probe results from `policy-probe-r2.mjs`. Each control was flagged; every case below passed without a finding.

| Rule | Cases that pass the policy |
|---|---|
| `scans-isolation` (`:584-590`) | `node tools/ci/run-semgrep.mjs …` (relative; the `scans` cwd is the head checkout, and this is fast-lane's self-test line copied over); `node "$GITHUB_WORKSPACE"/tools/ci/x.mjs`; `node "$PWD/…"`; `bash ./tools/ci/x.sh`; `make scan`; `docker run -v "$GITHUB_WORKSPACE:/src:ro" "$NODE_IMAGE" node /src/…` |
| `gitleaks-hardening` (`:337-353`) | `--mount type=bind,source=$GITHUB_WORKSPACE,target=/repo` (the style `run-semgrep` uses); `-v "$PWD:/repo:ro"`; `--exit-code 0`; a trailing `\|\| true` |
| `required-gates` (`:115-136, 598-629`) | an edited `scans` extraction step that always takes `tools/ci`, `.gitleaks.toml` and `.semgrep` from the head (`if false; then` in place of the base branch); the same edit in fast-lane, which also turns `check-workflow-policy` into the head copy; `GITLEAKS_IMAGE` swapped for any other digest-pinned image |
| `untrusted-expression` (`:108-109`) | `${{ env.T }}` with `T: ${{ github.event.pull_request.title }}`; `${{ steps.<id>.outputs.<x> }}`; `${{ matrix.<x> }}`; `on: issues`; a docker action's `with.args: ${{ github.event.pull_request.title }}` |

Forcing `RECORD_MODE=report-only` also passes the policy. That edit defends itself: at runtime the base checker refuses `--report-only` (exit 2).

**Exploitability and impact.**
- **Every case needs an edit to `.github/workflows/ci.yml`.** That path is owned, so the edit needs a security record. Under `pull_request` the head workflow always runs, so these rules are accident guards.
- **The realistic case is a TASK-015 refactor.** Either of these would silently restore head-code execution in `scans`, or the `.gitleaksignore` path:
  - a relative `node tools/ci/…` line copied into `scans`;
  - a gitleaks step rewritten in the `--mount` style.
- **`env.*` and outputs reintroduce script injection.** GitHub substitutes `${{ }}` into the script text before the shell runs. That allow-list was my round-1 proposal, and it was too broad.
- **No impact today.** `ci.yml` has no `${{ }}` inside any `run:`, and no workflow holds secrets or write scopes.

**LOW**, consistent with round-1 PR10-SEC-07.

**Remediation** (`check-workflow-policy.mjs`).
1. **`scans-isolation` becomes an allow-list.** In job `scans`:
   - every `node` segment must be `node "$GATE_<NAME>"`;
   - reject `bash`, `sh`, `make`, `python`, `./`, relative `tools/`, `$PWD`, `$(pwd)` and the quoted `"$GITHUB_WORKSPACE"/` form;
   - allow `docker run` only for `"$GITLEAKS_IMAGE"`;
   - optionally start every `scans` script with `cd "$RUNNER_TEMP"`, so a relative path cannot resolve into the checkout.
2. **`gitleaks-hardening`:**
   - parse `--mount … source=` as well as `-v` and `--volume`;
   - allow exactly two sources, `"$GITHUB_WORKSPACE/.git"` and `"$GATES_DIR/.gitleaks.toml"`;
   - reject any `--exit-code` other than `1`, and reject `--baseline-path`, `--gitleaks-ignore-path` and `--max-target-megabytes`;
   - reject `set +e` in the step and a gitleaks segment followed by `\|\|` (`shellSegments` already records the following operator).
3. **`required-gates`:**
   - pin both extraction steps: the `git archive "$RANGE_BASE" "$path"` branch with its exact condition, and `GATE_*`/`GATES_DIR` values only under `$RUNNER_TEMP`;
   - pin `GITLEAKS_IMAGE` to `ghcr.io/gitleaks/gitleaks:`.

   Changing them then follows the two-step procedure the `ci.yml` header already describes.
4. **`untrusted-expression`:**
   - drop `env\.` from `SAFE_EXPRESSION` and reference `"$VAR"` in the shell instead;
   - drop `steps.*.outputs`, `needs.*.outputs` and `matrix.*`, or allow only outputs named in a list;
   - also check `with.args` and `with.entrypoint` of `docker://` steps;
   - add `issues` to `FORBIDDEN_TRIGGERS`, because issue titles and bodies become attacker text if the repository is ever public.

**Verification.**
- One failing fixture for each row of the table above.
- `ci.yml` and `gitleaks-hardened.yml` still pass.
- A `ci-policy.test.ts` case that rewrites the extraction condition fails.

#### PR10-SEC-18 to PR10-SEC-20 (INFO)

- **PR10-SEC-18: setup-node's automatic cache in `scans`.**
  - **The behaviour.** setup-node v7.1.0 (`949feb2`) has the input `package-manager-cache`, default `true`: "caching is enabled when either `devEngines.packageManager` or the top-level `packageManager` field in package.json specifies npm". The root `package.json` has neither field today.
  - **The risk.** A later, harmless-looking `"packageManager": "npm@11.x"` would make setup-node in `scans` run npm in the head checkout (`npm config get cache`, which reads the head `.npmrc`) and restore and save `~/.npm`. The "no npm in `scans`" invariant would then break silently. `scans-isolation` checks only `cache` and `node-version-file`, so it would not catch this.
  - **Fix:**
    - set `package-manager-cache: false` on the `scans` setup-node step;
    - make `scansStepViolations` require it;
    - add a failing fixture `ci-scans-setup-node-auto-cache.yml`.
- **PR10-SEC-19: record-parser residuals.**
  - **(a) Any one record passes.** `evaluate` (`:187-210`) passes as soon as any `PR-<n>-*.md` binds. A second record with an allow-listed verdict therefore overrides a record whose last verdict is FAIL.
  - **(b) Hidden rows count.** `tableRows` skips fenced and indented code, but not `<!-- … -->` blocks. An invisible `| Verdict | PASS |` inside a comment wins over a visible FAIL.
  - **(c) Head rows match too broadly.** `^(?:Branch / head|Head)\b` also matches rows such as `Head-of-line …`.
  - **(d) Records can be planted for another PR.** This is the unchanged forgery residual (D-ORCH-013). `docs/05-quality/security/` is unowned, so a docs-only PR can add `PR-<other>-*.md` for another open PR. Records also arrive through direct docs pushes to `main`.

  **Fix:**
  - fail when any record of the PR has a last verdict outside the allow-list;
  - skip HTML comment blocks the same way fences are skipped;
  - match head rows exactly: `/^(?:Branch \/ head|Head(?: \/ range)?)$/i`;
  - fail a PR whose diff adds or changes a record named for a different PR number.

  Add one test per item.
- **PR10-SEC-20: ownership residuals.**
  - **(a) `REQUIRED_CODEOWNED_PATHS` (`:656-682`) is a strict subset of the security-owned CODEOWNERS lines.** It requires only `.github/workflows/`, not `/.github/` itself, and it lacks all of these:
    - `.npmrc`, `package.json`, `package-lock.json`;
    - `tools/deps/`, `tools/hooks/`, `tools/isolated/`;
    - `stylelint.config.mjs`, `.stylelintignore`, `tools/stylelint-rules/`, `tools/lint/`;
    - `tests/fixtures/{lint,semgrep}/`;
    - `tools/db/audit-ddl-reviewers.json`, `packages/audit/`, `packages/config/src/keys.ts`;
    - `**/tsconfig*.json`.

    Once one reviewed PR drops such a line, later PRs change that path with no record and no policy finding. **Fix:** a test that asserts the two lists are equal.
  - **(b) Unowned paths that steer the gates or the reviewers:**
    - **`.gitattributes`:**
      - `-diff` and `binary` make a local `git diff` review print "Binary files … differ" for chosen source files (verified on the host);
      - `linguist-generated` collapses diffs on GitHub;
      - `export-ignore` changes what the bootstrap `git archive "$RANGE_HEAD"` extracts.
    - **Nested `.semgrepignore` and `.gitignore`** (PR10-SEC-16).
    - **`.claude/commands/`:** the orchestrator's prompts.
    - **`.claude/agent-memory/{security-analyst,code-reviewer}/`:** loaded into the reviewers' context every time, so a PR could plant "accepted" notes.

    **Fix:**
    - add `/.gitattributes`, `**/.gitattributes`, `**/.semgrepignore`, `**/.gitignore` and `/.claude/commands/` to CODEOWNERS and `REQUIRED_CODEOWNED_PATHS`;
    - the orchestrator rejects any PR diff that touches another agent's memory directory, since memory is committed through the orchestrator's own docs pushes, not through PRs.

### R2.5 Reviewer-focus answers

1. **Are the gitleaks flags effective in CI?** Yes.
   - The run log shows the exact flags and "15 commits scanned", including 4 merges.
   - The probe proves the behaviour of each flag.
   - The `.git`-only mount defeats both `.gitleaksignore` and `.gitattributes` committed by the PR.
2. **Is `scans` truly isolated?** Yes, in the steady state: nothing from the PR executes there.
   - **Bootstrap runs head code.** Reading head git objects with `git archive` still executes head code once `node` runs the extracted script. It is no safer than the working tree, because the bytes are the same.
   - **Why that is acceptable.** It applies only while the base lacks the script, which means this PR, or a later PR that introduces a new `scans` gate script. Both also change `ci.yml`, which is owned and needs a record, and the job summary labels the bootstrap.
   - **What it meant for PR #10.** `scans` ran the head copies of `run-semgrep.mjs`, `check-security-owned-paths.mjs`, `.gitleaks.toml`, `.semgrep/`, `.semgrepignore` and `.gitignore`. `.gitleaks.toml` has not changed since round 1, where I reviewed it.
3. **Can the PR swap the base-ref sourcing?** Not without editing `ci.yml`.
   - `RANGE_BASE`, `RANGE_HEAD` and `PR_NUMBER` come from the event.
   - The base copy wins whenever the base has the path.
   - A deletion in the head does not affect the base extraction.

   Editing `ci.yml` can swap it. That is inherent to `pull_request`, only the owned-path record catches it, and it is the guard gap in PR10-SEC-17 item 3.
4. **Can a PR forge or reuse a record?** It can forge one, but it cannot reuse one.
   - **No reuse.** A record is bound to the PR number, to a head-row commit inside `base..head`, and to the PR's owned paths not changing after that commit. A merge of `main` does not void the record; an evil merge that changes an owned path does.
   - **Forgery.** Anyone who can push can commit a record. This is the documented residual (D-ORCH-013); PR10-SEC-19 lists cheap tightenings.
   - **Verdict row.** "Last row wins" is the right rule for multi-round records, and it is tested.
5. **Is CODEOWNERS complete?** The round-1 control-plane gaps are closed. The remaining gaps are in PR10-SEC-20.
6. **How far does the untrusted-expression rule reach?**
   - **Flagged in `run:` and `with.script`:** event fields, `head_ref`, `inputs` and `secrets`. Case does not matter, because anything not on the allow-list is rejected.
   - **Not flagged:** second-order contexts (PR10-SEC-17 item 4).
   - **Triggers:** the forbidden list now includes the comment and review family. `issues` is missing (same item).
7. **Waiver cap.** Closed as specified. The `--now` override can be set only from `ci.yml`, which is owned.

**Wording note for the orchestrator.** D-TASK007-02 item (10) can be read as saying that `scans` runs "licences, signatures and audit before `deps:rebuild`". Those three run in **fast-lane**, before `deps:rebuild`; `scans` runs gitleaks, Semgrep and the record check.

### R2.6 Actions and merge statement

| Action | Finding | Owner | Due |
|---|---|---|---|
| Scan a clean export, or fail on nested scope files; policy rule; CODEOWNERS for `**/.semgrepignore` and `**/.gitignore` | PR10-SEC-16 | devops-engineer | Before the first Wave-1 feature merge (with PR10-SEC-17) |
| Turn `scans-isolation` into an allow-list; check `--mount` and the exit path in `gitleaks-hardening`; pin the extraction steps and the gitleaks image in `required-gates`; narrow `SAFE_EXPRESSION`; forbid `issues` | PR10-SEC-17 | devops-engineer | Before TASK-015 adds or refactors workflows |
| `package-manager-cache: false` in `scans`, plus the rule | PR10-SEC-18 | devops-engineer | With PR10-SEC-17 |
| Tighten the parser; add the cross-PR record rule | PR10-SEC-19 | devops-engineer; orchestrator (procedure) | Opportunistic, before Wave 1 |
| Make `REQUIRED_CODEOWNED_PATHS` equal CODEOWNERS; own `.gitattributes`, the scope files and `.claude/commands/`; add the reviewer-memory rule | PR10-SEC-20 | devops-engineer; orchestrator | Opportunistic, before Wave 1 |
| ADR-0023 residual wording (the check detects omission, not forgery) | PR10-SEC-04 item 3 | principal-architect | Open since round 1 |
| Round-1 items still open: 05, 06, 08, 09, 10, the integrity half of 12, 13, 14, 15 | as routed | as in §6 | as in §6 |
| After merge: check the first Dependabot run for `private_source_not_reachable`; dependency-auditor baseline, including a one-off full-history gitleaks scan with the round-2 flags | PR1-SEC-12, PR2-SEC-06, PR10-SEC-01 | security-analyst | First Dependabot run / R-ARCH-12 |

**Merge statement.**
- **Merge rule.** No Critical or High finding is open, so PR #10 may merge at `26fc08d` (CLAUDE.md §8).
- **What this round names.** It names `26fc08d`, after which no security-owned path has changed. Later commits that only merge `main` or touch docs keep the record valid. Any change to an owned path needs round 3.
- **After merge.** The record check enforces on every later PR: the record must be named `PR-<nnnn>-*.md` for that PR, and its last Verdict row must be on the allow-list.
- **Validation.** This record was checked with the PR's own parser before hand-off (`recordVerdict`, `recordHeadShas` and `checkSecurityOwnedPaths` against `26fc08d`).
