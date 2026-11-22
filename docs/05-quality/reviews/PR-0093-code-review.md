# PR #93 code review, round 1: Dependabot regression repair (#90 to #92) and PR87-SEC-01

| Field | Value |
|---|---|
| PR | #93 `chore/dependabot-regressions-90-92` (worktree `Shipqube-NODE24`, read by SHA) |
| Head | `1b8db071ba8f1b2c3fa1e4bfa4bbfca9d7b03791` (3 commits on `origin/main` `3079e2f7`: `36b072cc` fix, `860d6651` lane-B record, `1b8db071` citation rename) |
| Reviewer | code-reviewer, 2026-11-22, orchestrator session D (D-ORCH-179/180) |
| Decision | D-CRCHORE-03 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The five FROM lines, the stylelint package files and the compose rustfs line are byte-exact reverts. The new
         node-major rule and check-node-security are correct, fail closed and well tested. Hosted CI is red: the lane-B
         run is stale at the head. Merge needs lane B on the final head and the missing D-DEVOPS-005 entry.
FINDINGS: 0 BLOCKER, 0 MAJOR, 4 MINOR, 6 NIT (section 3)
```

## 1. Verification I performed

Everything here ran with Node 24.22.3. I did not use Docker. I ran only targeted Jest files (D-ORCH-125 host rule) and did not open any `.env*` file.

| Check | Result |
|---|---|
| Revert, Dockerfiles: `git diff --quiet 7cc7d2e4 1b8db071` on the five Dockerfiles | equal to #87 at all five FROM lines. The only main commit to touch them since `7cc7d2e4` is #90 `be038127`. |
| Revert, stylelint: `git diff --quiet 95cb411d 1b8db071 -- package.json package-lock.json` | equal. #92 `03aec396` is the only commit that touches them after `95cb411d`. |
| Revert, rustfs | `compose.yaml` rustfs is the pre-#91 line, byte for byte, and equals `RUSTFS_IMAGE` in `apps/api/src/platform/storage/tests/rustfs.ts:14`. aws-cli 2.40.3 is kept. |
| Peer conflict claim | `node_modules/stylelint-use-logical/package.json` peer `stylelint ">= 11 < 18"`. Installed stylelint is 17.16.0. |
| Delta after lane B, `git diff -U0 36b072cc 1b8db071` outside `docs/05-quality` | 11 lines, all comments or doc text (`D-DEVOPS-004` changed to `D-DEVOPS-005`). No code changed. |
| Jest `--selectProjects unit --testPathPatterns tools/ci/(check-dockerfiles\|check-node-security\|sec-static\|check-dockerignore)` `--maxWorkers=2` | 4 suites, 207 tests passed |
| Prettier `--check` on the 9 changed non-evidence files | pass |
| ESLint `--max-warnings 0` on the 5 changed tools files | pass |
| `tsc -p tools/tsconfig.json --noEmit` (checkJs covers the `.mjs`) | pass |
| `check-dockerfiles --root .` at head | 5 Dockerfiles, 0 findings |
| `check-dockerfiles` on a `git archive` of main's Dockerfiles, `.node-version` and `package.json` (the #90 tree) | 10 `node-major` findings (major plus engines, times 5). The rule catches #90. |
| `node tools/ci/check-node-security.mjs` (live GET of nodejs.org `index.json`) | exit 0, `pinned node:24.22.3; newest 24.x 24.22.3; newest security release 24.22.3 (2026-11-10)` |
| `check-evidence --base origin/main --head 860d6651` / `--head 1b8db071` | PASS / **FAIL**: run `20261122T0507Z_36b072c` rejected as `stale: 5 path(s) ... changed since 36b072c` |
| Hosted CI on `1b8db071` (`gh pr checks 93`, run 44989509938) | `fast-lane` **fail** at step 15 "Lane B evidence" with the same stale reason. `ci-gate` fails as a consequence and `security-integration` is skipped. The dependabot.yml validation passes. Lint, type-check, unit and build did not run hosted. |

I did not run full `test:unit`, the integration, api or RLS suites, or coverage. For those I rely on lane B `20261122T0507Z_36b072c` at `36b072cc` (PASS, `git_dirty` false). Its result also holds semantically for `1b8db071`, because the delta between them is comments only.

## 2. Requirements (D-ORCH-179) against delivery

| Item | Status |
|---|---|
| (a) Restore the #87 Node 24 pins byte for byte | Met (section 1) |
| PR87-SEC-01 (a): a check-dockerfiles rule tying the major to `.node-version` and `engines`; PR-0087 R1-m1 | Met. `node-major` fails closed on an unreadable `.node-version`, a missing or unreadable `engines.node`, and a non-numeric tag. It is wired into `checkRepository` and the CLI. The "repository Dockerfiles" unit test runs it. The PR-time signal has a gap (R1-m2). |
| A Dependabot ignore that actually holds | Met. The race analysis is credible and consistent with D-ORCH-179's timeline. The absolute `versions: ['>= 25.a']` is the right fix, and sec-static pins it. |
| PR87-SEC-01 (b): security-release comparison | Implemented as a local tool. The security record asked for "lane C or nightly" (R1-m4, for security-analyst to rule on). |
| PR87-SEC-01 (c): hand-bump rule | Met (`docs/07-ops/CI-CD.md` section 6) |
| Stylelint 18: checks, then revert plus a major ignore by default | Met. A failed peer check ends the evaluation, so no architect consult was needed. The citation is off (R1-n5). |
| #91: fix only what breaks the harness or the policy | Met. rustfs is reverted; aws-cli is kept (R1-n6). |
| PR-0086/PR-0087 R1-n1 header bullet | Met |

## 3. Findings

| ID | Severity | file:line | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | PR body "Checks"; `1b8db071` | `1b8db071` edits 5 paths outside the staleness allow-list after the lane-B run, so the run is stale at the head and hosted `fast-lane` fails at "Lane B evidence". The PR body's "`check-evidence --base origin/main --head HEAD` PASS" was true at `860d6651` only. The delta is comment-only (I checked it), so this is a process miss, not a code risk. | Merge condition MC-1: lane B on the final head with its record committed, then hosted CI green. Correct the PR body. A comment-only rename after a lane-B run should go into the run's commit or wait for the next run. |
| R1-m2 | MINOR | `docs/07-ops/CI-CD.md` section 6, control 1; `.github/dependabot.yml:13-16` | The docs say node-major runs in "lane A and lane B unit ... so a Node 26 base fails before an image build", and that "the repository-side gates do" what the ignore cannot. On a Dependabot PR, lane A always stops at step 15 "Lane B evidence" (a Dependabot PR never carries evidence), and that happens before "Unit tests". So a #90-class PR still shows only the generic evidence failure, and node-major first fires after the merge (main-push unit step or the next lane B). That is the window in which #50 and #90 were merged. | devops-engineer follow-up, not a merge condition: add a fast-lane step `node tools/ci/check-dockerfiles.mjs --root .` before the evidence step (it runs in seconds; the workflow is a security-owned path). Otherwise, reword control 1 and the dependabot.yml note to "detects after merge". |
| R1-m3 | MINOR | `.github/dependabot.yml:12,15,32,69,71`; `tools/ci/check-dockerfiles.mjs:33`; `tools/ci/check-node-security.mjs:3`; `docs/07-ops/CI-CD.md:232`; two test headers | Six files cite D-DEVOPS-005, but no such entry exists on the branch or on main. The only mention is the D-ORCH-181 bookkeeping line ("renumbered D-DEVOPS-005 when it lands"). The decisions it should record are non-trivial and appear only in the PR body: the race analysis, absolute against relative ignore, the stylelint revert, local-only (b), rustfs revert against aws-cli keep, and the Valkey ignore left relative. This breaks CLAUDE.md section 10. | Merge condition MC-2: land the D-DEVOPS-005 entry (on main, or on the branch before the final lane-B run) with what, why, alternatives and reversibility. |
| R1-m4 | MINOR | `tools/ci/check-node-security.mjs:3-4`; `docs/07-ops/CI-CD.md` section 6 item 3 | PR87-SEC-01 (b) asked for "a lane C or nightly comparison". This PR delivers a manual tool plus an instruction that "the orchestrator runs it at each session start and before G3 and G4". Nothing enforces that: no orchestrator procedure, STATUS item or gate checklist line. The "zero hosted minutes" reason was written before D-ORCH-180, and on a public repository standard hosted runners are free. `nightly.yml` is `workflow_dispatch` only (ADR-0023 am. C), so a scheduled run needs an ADR-0023 touch. | security-analyst rules whether the local tool closes (b). Recommendation: a weekly scheduled job running `check-node-security` (exit 1 or 2 fails the job), with the ADR-0023 note. Otherwise, add the run to the orchestrator's session-start and G3/G4 checklists. |
| R1-n1 | NIT | `.github/dependabot.yml:36-37` | The npm `stylelint` ignore uses relative `update-types: semver-major`. By the PR's own argument at lines 73-75, once a stale job puts 18 in the tree, a relative rule offers 19. The race is proven for npm too: a job carries its trigger commit's config. | Use `versions: ['>= 18.a']`, matching node, and update the sec-static pin. |
| R1-n2 | NIT | `tools/ci/check-node-security.mjs:4` against `docs/07-ops/CI-CD.md` section 6 | The cadence differs: "before each lane B wave run" in the script against "session start, before G3 and G4" in the doc. | Make the two say the same thing. |
| R1-n3 | NIT | `tools/ci/check-node-security.mjs:108-110` | A retryable non-OK response (429 or 5xx) is not drained before the retry, so the undici connection waits for GC. The 429 branch has no test. | `await response.body?.cancel()` before the retry, plus a 429 row in the retry test. |
| R1-n4 | NIT | `tools/ci/check-node-security.mjs:126-129` | A trailing `--index` with no value silently falls back to the network, and a bare `--root` falls back to `.`. | Exit 2 when a flag has no value. |
| R1-n5 | NIT | `.github/dependabot.yml:32,34` | "ADR-0001 fixes Stylelint 17": ADR-0001 does not name Stylelint. The pin, with exactly this peer conflict, is ADR-0025 line 60 (and ADR-0002 item 5 / CLAUDE.md section 2). | Cite ADR-0025. The Stylelint 18 route is then an ADR-0025 row amendment. |
| R1-n6 | NIT | `compose.yaml:86` | aws-cli 2.40.3 (`storage-init`) is kept, but lane B `--profile pr` never runs it: `compose-up` is still `planned`. Only metadata checks support it. | Say this in D-DEVOPS-005. The first `compose up` or `compose-up` activation exercises it. |

## 4. Design and correctness notes (no finding)

- **`satisfiesEngines`** follows npm's x-range semantics for partial versions (`<25` means `<25.0.0`, `>24` means `>=25.0.0`, `<=24` means `<25.0.0`, bare `24` means `[24.0.0, 25.0.0)`). It returns `undefined`, which fails closed, for `^`, `~`, `x`, `*`, hyphen ranges, pre-releases, empty alternatives and a dangling operator (`">= "` backtracks to `>` plus `=`, which yields undefined). I traced every branch against the test table, and the table pins each one.
- **Partial tags.** A partial node tag is padded (`node:24` reads as `24.0.0`) and then fails `>=24.2`. That is a deliberate fail-closed choice and it is tested.
- **Indirect FROM.** `FROM ${ARG}` and other-registry references skip node-major. `from-digest` still rejects an unpinned ARG reference, so this is not a new gap.
- **`check-node-security`** fails closed with exit 2 when there are zero or several pins, a partial pin, an unreadable or malformed index, an unknown major, a 4xx, or 3 failed attempts. The GET has `redirect: 'error'`, a 20 s `AbortSignal.timeout` that also covers the body read, and backoff with jitter. CLAUDE.md section 9 is met.
- **Out of scope.** One blind spot remains, out of scope for this PR: once the pinned major is past EOL and gets no security releases, the tool reports OK indefinitely. ADR-0001 covers Node 24 until April 2028.
- **Tests.** The tests are deterministic and need no network (`fetchImpl` and `--index` seams). Assertions are exact `toEqual` or message checks. The repository-mode test compares rule ids only between the unpoliced and policed runs, but the CLI assertion then pins the major message, so the test is not vacuous.

## 5. Merge conditions

1. **MC-1:** lane B on the final head (`1b8db071` or later) with its record committed, and hosted `fast-lane` plus `ci-gate` green on that head (R1-m1).
2. **MC-2:** the D-DEVOPS-005 entry exists (R1-m3).
3. A security record on the final head for the owned paths: `.github/dependabot.yml`, the five Dockerfiles, `compose.yaml`, `package*.json`, `tools/ci/check-dockerfiles.*`, `tools/ci/check-node-security.*` and `tools/ci/sec-static.test.ts`. It should rule on R1-m4 and on PR87-SEC-01 closure.
4. **Re-review.** If a later head changes anything besides comments or evidence, this review needs a delta round. If MC-1 is met by an evidence-only commit, no new round is needed.

## 6. Security flags (for security-analyst)

- **PR87-SEC-01 (b) closure.** The deliverable is a local tool instead of a lane C or nightly run (R1-m4).
- **Hosted signal on Dependabot PRs.** No PR-time hosted node-major signal exists on a Dependabot PR (R1-m2). Pairs with the owner-only branch-protection settings in D-DEVOPS-004.
- **Outbound fetch.** `check-node-security` makes an outbound GET to a fixed URL (no SSRF surface). The request has no credentials and refuses redirects.
- **Relative ignores.** The Valkey ignore stays on relative `semver-major` (the PR's "Open" list), and so does the stylelint ignore (R1-n1).

## 7. Good

- The race diagnosis rests on the actual Dependabot job logs (job definition `ignore-conditions`, base SHA), not on a guess. The fix is a gate the race cannot get around.
- All three reverts are byte-exact and proven by SHA. This is the smallest change that makes main green again.
- The engines parser is written in-house for a narrow subset and refuses everything else, which avoids a new dependency. The fail-closed paths are all tested.
