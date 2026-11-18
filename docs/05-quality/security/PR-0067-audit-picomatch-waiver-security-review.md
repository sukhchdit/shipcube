# PR-0067 / D-SECAUDIT-01: change-scoped security review (waiver for the dev-only picomatch High GHSA-fc5q-39xc-vjpf)

| Field | Value |
|---|---|
| PR | #67 `chore(audit): waive dev-only picomatch GHSA-fc5q-39xc-vjpf, no upstream fix (D-SECAUDIT-01)`, https://github.com/sukhchdit/shipcube/pull/67 |
| Branch | `chore/audit-watch-picomatch`: 1 commit on the merge base `982cb7f` (`1f9c81f`). 2 files, +39 / -15 |
| Head | 1f9c81f369ea8029f471b64a9eb87c3f227d17bf |
| Main when written | `57140c7`. Since the merge base `982cb7f`, main gained only the PR #66 security record and its DECISIONS entry, and this record and D-SECAUDIT-01 follow it. None of these touches one of the PR's 2 owned paths |
| Security-owned paths changed (CODEOWNERS `/tools/ci/`, line 15) | `tools/ci/advisory-watchlist.json`, `tools/ci/check-audit.test.ts` (2) |
| Dependencies / workflows | `package.json`, `package-lock.json`, `.npmrc` and `.github/**` are untouched (`git diff --stat 982cb7f 1f9c81f` lists the 2 files only). `tools/ci/check-audit.mjs` and `dep-gates-lib.mjs` are unchanged. Lane A runs the base-ref copy of the checker anyway (`GATE_CHECK_AUDIT=_temp/base/...`) and reads the register from the PR's merge-ref work tree |
| Binding items checked | CLAUDE.md §5 (dependencies: no Critical/High; "an action that can't be done within them is replaced by a safe alternative"), §2 fixed stack, US-048 AT-US-048-06/07, code review m7 / PR10-SEC-12 (90-day waiver cap, DECISIONS ID), PR2-SEC-06 (watch-list convention, no overrides inside gate tooling), D-ARCH-003 rev 4 item 4 (maintenance exceptions: picomatch has none), PR1-SEC-07 / D-ARCH-043 (production closure) |
| Code-review twin | None yet. The PR changes test code (`check-audit.test.ts`), so a code-reviewer round is needed before merge |
| Reviewer / date | security-analyst, 2026-11-18. **I authored this change and I also review it here** (orchestrator dispatch: triage and deliver the fix). An independent read is therefore left to the code-reviewer twin. Commands in the new worktree `../Shipqube-audit-picomatch`: `git worktree add`, edits, `prettier --write` on the test file, ESLint/Prettier/scoped `tsc --noEmit` on the two files, one Jest file (`tools/ci/check-audit.test.ts`, `--runInBand`) through a temporary `node_modules` junction to the main checkout, `git commit`, one `git push`. The junction and a scratch `tools/tsconfig.scratch-sec.json` were removed afterwards, and main's `node_modules` count was unchanged (743). The worktree is clean at the head. No Docker, no heavy suite, no PostgreSQL. I ran `npm audit --json` once in the main checkout (read-only registry query) and `gh run view`/`gh api` (read-only) |

## 1. Summary

**The waiver is the correct form, it is exact, and it weakens no gate.** It is time-boxed to 86 days, and it is reachable only for a dev-closure advisory with no upstream fix.

- **Why the gate fails.** GitHub reviewed GHSA-fc5q-39xc-vjpf on 2026-11-17 at 15:56Z. It covers picomatch `<= 4.0.7`, is rated High (CVSS 3.1 7.5, CWE-1333) and describes a ReDoS through single-branch repeated extglobs. From then on, npm audit and osv-scanner both report it, and `check-audit` fails every PR. The first failure was run 44291101362 for PR #66 at 11:05Z: `audit/high: GHSA-fc5q-39xc-vjpf picomatch (high, dev closure, fix available)`.
- **There is no upstream fix.**
  - `first_patched_version` is null.
  - The registry's `latest` is 4.0.7, and all 35 published versions fall in the advisory's range. The upstream fix pull request the advisory cites is open and unmerged.
  - The "fix available" in the gate line is npm's `fixAvailable`. For picomatch it is `{ name: jest-util, version: 26.6.2, isSemVerMajor: true }`, a downgrade four majors back that still ships an affected picomatch. It is not a fix (PR67-SEC-03).
- **Dev closure only.**
  - `npm ls --omit=dev picomatch` is empty.
  - All three lockfile tuples have `dev: true`: `node_modules/picomatch` 4.0.7, and 2.3.2 under both `anymatch` and `micromatch`. All MIT.
  - Dependents: Jest (`jest-util`, `jest-haste-map`, `jest-message-util`, `@parcel/watcher`, `anymatch`), Vite, `@react-router/dev` (via `tinyglobby`/`fdir`), Stylelint (via `micromatch`), `eslint-plugin-boundaries` (via `@boundaries/elements`).
  - No runtime image carries it. The web and admin runtime stages are nginx serving static files, and the api and worker `prod-deps` stages install with `--omit=dev`.
- **Not reachable with our patterns.** The advisory needs an attacker-supplied pattern such as `+(*)` or `+(*a)`.
  - Our sources contain no direct import of picomatch, micromatch, minimatch, tinyglobby, fast-glob, anymatch or glob.
  - The only glob call in our code is `posix.matchesGlob` in `tools/repo/jest-projects.test.ts`, which is Node's own matcher fed with committed `testMatch` values.
  - The only extglobs in committed config are `!(shared|ui)` and `!(pricing|shared)` (`eslint.config.mjs` lines 576 and 631, boundaries captures). They are multi-branch negations, not the vulnerable shape.
  - The probe in §2.2 confirms this.
- **The rulings asked for:**

| | Question | Ruling |
|---|---|---|
| (a) | Is a dated, justified **watch** entry acceptable? | **A watch entry cannot clear the gate.** `check-audit` turns a watch entry into a note and still raises `audit/high` for a High (`check-audit.mjs` lines 230-256; control C5 in §2.3 exits 1). The register's only route for a High without a fix is a **waiver** (`$comment` of the register, US-048 AT-US-048-07). A waiver carries a DECISIONS ID, a grant date and an expiry at most 90 days later, after which the finding fails again |
| (b) | Is a waiver compatible with CLAUDE.md §5 "no Critical/High known vulnerabilities"? | **Yes, as the guardrail's "safe alternative", bounded in time.** The alternatives are all worse; see the list below this table. The waiver keeps the finding visible (`audit/waived`, due date and days left in every lane A summary) and fails again on 2027-02-12 |
| (c) | Does any runtime (non-dev) closure include picomatch? | **No.** `npm ls --omit=dev` is empty, all lockfile tuples are `dev`, and no runtime image ships it. The gate does not enforce this for the waiver, though, which is PR67-SEC-02 (LOW) |
| (d) | Does any of our code pass untrusted input as a glob pattern? | **No.** See the bullet above and §2.2 |

The alternatives to a waiver, all rejected:

- **Bump:** none exists.
- **`overrides` to a patched fork:**
  - The upstream patch is unreviewed and unmerged.
  - Overriding the matcher inside Jest, ESLint, Stylelint and Vite can silently change test selection or lint coverage (PR2-SEC-06: "no overrides inside gate tooling").
  - A vendored or git-sourced package bypasses `npm audit signatures`, provenance and `min-release-age`.
- **Replacing the tools:** this contradicts the fixed stack (CLAUDE.md §2, ADR-0001).
- **npm's suggested "fix":** a jest-util 26 downgrade that breaks Jest 30 and stays affected.

## 2. Evidence

### 2.1 Advisory and registry

| Item | Value |
|---|---|
| GHSA / CVE | GHSA-fc5q-39xc-vjpf / CVE-2026-112366, published 2026-10-19, GitHub-reviewed 2026-11-17T15:56:42Z, not withdrawn |
| Range / patched | `<= 4.0.7` / `null` |
| Severity | high. CVSS 3.1 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H` 7.5; CVSS 4.0 8.7; EPSS 0.34 % |
| Registry | `picomatch` dist-tags `{ latest: 4.0.7 }`, 35 versions, the last 4.0.3..4.0.7 |
| npm audit (main lockfile, 2026-11-18) | 68 entries (49 high, 19 moderate, 0 critical). All the highs are effects of this one advisory propagated to its dependents. The only advisories are GHSA-fc5q-39xc-vjpf (high) and the watched GHSA-3g3m-2fjr-6pw4 / GHSA-g3hv-75wg-m249 (moderate) |
| Maintenance exceptions | picomatch is not in `tools/ci/maintenance-exceptions.json`, so a waiver can apply (D-ARCH-003 rev 4 item 4) |

### 2.2 ReDoS probe (child process per case, 4 s watchdog, installed copies from the main checkout's `node_modules`)

| Pattern | picomatch 4.0.7 | picomatch 2.3.2 |
|---|---|---|
| `+(*a)` (positive control), input `a`×n + `!` | n=16: 17 ms, n=24: 3,548 ms, n=32: > 4 s | n=16: 15 ms, n=24: 3,220 ms, n=32: > 4 s |
| `+(*)` (positive control), input `a`×n + `/` | n=16: 49 ms, n=24: > 4 s | n=16: 36 ms, n=24: > 4 s |
| `!(shared\|ui)`, `!(pricing\|shared)` (ours) | ≤ 1 ms for n = 16, 24, 32, 4,096 on 5 input families | ≤ 4 ms, same inputs |
| Vite `fs.deny` defaults (`**/.env.*`, `**/*.{crt,pem}`, `**/.git/**`) | ≤ 2 ms at n = 4,096 | ≤ 3 ms at n = 4,096 |

The vulnerability is in the pattern compiler. Attacker-chosen *input strings* against our committed patterns stay linear, and the positive controls show that the probe can see the blow-up.

### 2.3 `check-audit` matrix

These runs use main's script (byte-equal to the head's), today's `npm audit --json`, and a lockfile identical to main's. osv-scanner was not run (no Docker). Lane A merges both scanners under the same `GHSA|package` key (run 44291101362 shows `(npm audit + osv-scanner)` on one line), so one waiver covers both.

| Run | Register | `--now` | Exit | Result |
|---|---|---|---|---|
| R1 | head | 2026-11-18 | **0** | `audit/waived: GHSA-fc5q-39xc-vjpf picomatch (high, dev closure, fix available): tracked by D-SECAUDIT-01, due 2027-02-12 (86 days)`; the two moderates stay `watched` |
| C1 | main (control) | 2026-11-18 | 1 | `audit/high: GHSA-fc5q-39xc-vjpf picomatch …` (reproduces lane A) |
| C2 | head | 2027-02-12 | 1 | `audit/waiver-expired: … waiver D-SECAUDIT-01 expired on 2027-02-12` |
| C3 | head | 2026-11-17 | 2 | `waivers[0].granted (2026-11-18) is in the future` |
| C4 | head with the decision `D-SEC-AUDIT-01` | 2026-11-18 | 2 | `waivers[0].decision must be a DECISIONS.md ID (/^D-[A-Z0-9]+-\d+$/)` |
| C5 | main + a picomatch **watch** entry only | 2026-11-18 | 1 | `audit/high` plus `note audit/watched`: a watch entry does not clear it |

### 2.4 Tests

`tools/ci/check-audit.test.ts` at the head has three changes:

- Line 76 pins the committed waiver tuple (id, package, decision, granted, expires). It replaces `waivers == []`.
- Line 81 adds a new test: the waiver passes a dev-closure picomatch High at 2026-11-18 and yields `audit/waiver-expired` at 2027-02-12T00:00Z.
- Line 196: the CLI tests that copy the committed register now run at its newest grant date (`cliNow`). Without this, `--now 2026-11-12` makes those two tests exit 2. The reduction keeps future waivers from breaking them again.

| Check | Result |
|---|---|
| `jest --selectProjects unit --runInBand tools/ci/check-audit.test.ts` | 28/28 pass |
| Mutant M1: waiver removed from the register | 2 tests red (pin, D-SECAUDIT-01 test) |
| Mutant M2: `cliNow` back to the fixed `'2026-11-12'` | 2 tests red (both CLI tests, exit 2) |
| ESLint (`--max-warnings 0`), Prettier `--check` | clean |
| Scoped `tsc --noEmit` (the tools tsconfig, this file only) | clean. The control mutant `severity: 'severe'` gives 1 error |

Lane A's lint, type-check and unit steps and lane B's `unit` suite are still owed. This is not a substitute for them.

## 3. Findings

| ID | Severity | CWE / OWASP 2021 | Location | Status |
|---|---|---|---|---|
| PR67-SEC-01 | LOW (in context; advisory High) | CWE-1333 / A06 Vulnerable and Outdated Components | lockfile tuples `picomatch` 4.0.7 and 2.3.2 (dev) | Waived by D-SECAUDIT-01 until 2027-02-12 |
| PR67-SEC-02 | LOW | CWE-1104 / A06 | `tools/ci/check-audit.mjs` lines 250-269 (a waiver matches `id`+`package` in any closure) | Open, follow-up |
| PR67-SEC-03 | INFO | n/a / A06 | `tools/ci/check-audit.mjs` lines 136 and 204 (`fixAvailable !== false`, OR-merged) | Open, optional |
| PR67-SEC-04 | INFO | n/a | `tools/ci/check-audit.mjs` line 54 (`DECISION_ID`) | Open, documentation |

**PR67-SEC-01 (LOW): GHSA-fc5q-39xc-vjpf, picomatch ReDoS in the dev closure.**

- **Exploitability.** It needs an attacker-chosen glob pattern with a single-branch repeated extglob. In this repository, patterns reach picomatch only from committed config (Jest `testMatch`/haste, Vite, Stylelint `ignoreFiles`, boundaries captures) or from a developer's own CLI arguments. A hostile PR that plants `+(*a)` in config could stall a lane A job until its timeout. Such a PR can already run arbitrary code at lint or type-gen time (PR4-SEC-13), so this adds no capability.
- **Rating.** Impact Low (a CI job or local tool hangs; no confidentiality or integrity effect) × Likelihood Low gives LOW by the threat-model §1 matrix.
- **Remediation.** When a picomatch release outside the range ships, refresh the lockfile (`npm update picomatch`; every dependent's range `^4.0.x` / `^2.3.1` admits it, and `min-release-age=7` applies) and remove the waiver in the same PR. Until then, the waiver stays.
- **Verification.** The `[D-SECAUDIT-01]` unit test, plus lane A turning red again on 2027-02-12 if nothing is done.

**PR67-SEC-02 (LOW): the waiver is not bound to the dev closure.**

- **Problem.** `checkAudit` applies a waiver by `id`+`package` whatever `advisory.production` says. The waiver's justification ("dev-only") is not machine-checked. If a runtime dependency began to pull picomatch during the waiver window, the High would stay waived.
- **Compensating control.** `package.json` and `package-lock.json` are CODEOWNERS-owned, so such a change already needs a security record, whose reviewer sees the closure. That is a procedural control.
- **Code-level fix.** Choose one, owner devops-engineer via senior-developer, before the next waiver is added and at the latest by 2027-02-12:
  - (i) An optional waiver field `"closure": "dev"`, enforced in `checkAudit`: if `waiver.closure === 'dev' && advisory.production`, push `audit/high` with "waiver is dev-only"; or
  - (ii) In `check-audit.test.ts`, assert that every committed waiver whose reason starts with "Dev-only" or carries `closure: dev` has no production tuple in the committed `package-lock.json` (`tuplesOf(lock)`). Lane A's unit step then fails the PR that moves picomatch into a runtime closure.
- **Verification.** A fixture with the waived advisory at `production: true` must fail.

**PR67-SEC-03 (INFO): "fix available" counts npm's downgrade suggestions.**

- **Problem.** `fromNpmAudit` sets `fixAvailable: vulnerability.fixAvailable !== false`, and `mergeAdvisories` ORs it with osv-scanner's. Here npm proposed `jest-util@26.6.2` (semver-major, older than the installed 30.5.1), so the label said "fix available". It also suppressed the gate's own hint "no upstream fix: track it with a dated waiver" (line 254), which is exactly the right guidance for this case.
- **Fix (optional).** Treat an object `fixAvailable` with `isSemVerMajor: true` as "major-change fix" and label it as such, or prefer osv's `fixed` event or GHSA `first_patched_version`. No gate impact.

**PR67-SEC-04 (INFO): `DECISION_ID` accepts one area segment only.**

- **Problem.** `^D-[A-Z0-9]+-\d+$` accepts `D-TASK007-01` and `D-ORCH-013`. It rejects the security-analyst ID families in DECISIONS.md (`D-SEC-PR64-01`, `D-SEC-TM-01`) and the requested `D-SEC-AUDIT-01`. A waiver citing one of them makes the register invalid, so check-audit exits 2 on every PR (control C4).
- **Ruling.** Waiver decisions use a single-segment area. This one is `D-SECAUDIT-01`, and the register's `$comment` already documents `D-<AREA>-<n>`. No code change is needed.

## 4. Process

- **Lane B evidence is required.** `selectSuites` (main's manifest, profile `pr`) gives `required: ["unit"]` for `tools/ci/advisory-watchlist.json` and for `tools/ci/check-audit.test.ts`: no path rule matches, so `profiles.pr.always` applies. The worktree `../Shipqube-audit-picomatch` is at the head, clean, with no `node_modules`, and ready for the queue.
- **Code review is needed** (test code changed; CLAUDE.md §5 DoD).
- **This record is committed on main.** ci-gate checks out `refs/remotes/pull/67/merge` and reads records from that tree, so the record counts from the next `pull_request` event on #67, for example the lane B evidence push. A re-run of the first run reuses the old merge ref and still fails the record check. §5 shows main's record check passing on a simulated merge of the head with this record.
- **Effect on other PRs.** After #67 merges, each open PR passes the audit step at its next `pull_request` event, since the register is read from the merge-ref work tree. Re-running an old run does not help.
- **PR #66 merge condition 2** (D-SEC-PR66-01; the PR-0066 record's row "Code review r1 R1-m2") expected "a dated `audit/watched` entry". That form cannot clear a High (control C5). The route is this waiver, and the first half of that condition ("triaged repo-wide") is met when #67 merges. The second half, a fully green lane A run on PR #66's final head, stays with PR #66.
- **Follow-ups:** PR67-SEC-02 (LOW) to devops-engineer via senior-developer. PR67-SEC-01 is re-checked on 2027-02-12, or earlier when picomatch ships a release outside the range.

## 5. Record simulation

This runs main's `tools/ci/check-security-owned-paths.mjs` in a sparse `clone --shared` (`.github/`, `docs/05-quality/security/`, `tools/ci/`).

- Each scenario is a merge commit built with plumbing (`merge-tree --write-tree`, `commit-tree`): a main-side commit on main's tip `57140c7`, merged with the head.
- No ref moved and no work tree was touched.
- Every run uses `--base 982cb7f --head 1f9c81f… --pr 67 --json`.

| Scenario | Expected | Exit / status |
|---|---|---|
| S1 this record on main, merged with the head | pass | 0 / pass |
| C1 no record | missing | 1 / missing |
| C2 this record with the Verdict cell set to `FAIL` | rejected | 1 / missing |
| C3 the Head row naming a main commit (`982cb7f`) | rejected | 1 / missing |
| C4 this record filed as `PR-0068-…` | missing | 1 / missing |

The record has exactly one row whose first cell starts with `Head`, and one `Verdict` row, which is the last.

**Lane A on the head** (run 44297523492, `pull_request`, merge ref with `982cb7f`, fast-lane job):

- The real npm audit and osv-scanner give `note audit/waived: GHSA-fc5q-39xc-vjpf picomatch (high, dev closure, fix available): tracked by D-SECAUDIT-01, due 2027-02-12 (85 days) (npm audit + osv-scanner)` and `check-audit: PASS`. So the waiver matches both scanners' key.
- "Lane B evidence" failed as expected, since no evidence exists yet.
- The ci-gate record check of that event predates this record.

## 6. Verdict

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_FOLLOW-UPS.** 0 Critical/High open for this change. PR67-SEC-01 (LOW) is waived until 2027-02-12 under D-SECAUDIT-01. Follow-ups: PR67-SEC-02 (LOW), PR67-SEC-03 and PR67-SEC-04 (INFO). Lane B `unit` evidence and a code-review round are still owed before merge |
