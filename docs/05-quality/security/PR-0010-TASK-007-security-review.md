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
