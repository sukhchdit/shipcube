# PR #25 code review, round 1: TASK-007 follow-ups (D-ORCH-027)

Head reviewed: `20a0fc689abdd74311079e2f81a7204bc18047f1` (branch `ci/TASK-007-fu-gitleaks-allowlist-dependabot-ignores`, one commit on `c3ff7f1`, 3 files, +22/-14).

VERDICT: APPROVED_WITH_NITS

SUMMARY: The OpenAPI allowlist block is removed cleanly (agent-docs prose entry, default rules, AND-scoping and the AT-US-048-04 guards untouched). The Dependabot `ignore` entry is syntactically and semantically right next to cooldown and groups. Both new tests die under every realistic regression I injected; three small test-scoping nits survive. No BLOCKER or MAJOR.

## 1. Verification I performed myself

Constraints: read-only, no Docker, targeted tools/ci tests only. I probed an extract of the head (git archive plus a node_modules junction), never the worktree. The extract and junction are removed. The worktree is clean and its node_modules count is 748.

| Check | Result |
|---|---|
| `jest --selectProjects unit` on `tools/ci/sec-static` (extract) | 12/12 pass |
| prettier `--check` on `dependabot.yml` and `sec-static.test.ts` | pass (prettier has no TOML parser; `.gitleaks.toml` is outside format:check) |
| eslint `--max-warnings 0` on `sec-static.test.ts` | pass |
| `yaml` parse of `dependabot.yml` | npm `ignore` = `[{@platform/*}, {typescript, ['version-update:semver-major']}]`, `groups` and `cooldown` intact |
| Lane A on the head (run 43362451299) | fast-lane success; Gitleaks and Semgrep steps success; `ci-gate` red only on "Security-owned paths need a review record" (expected, record not yet committed) |
| Not re-run | full lint, typecheck, full unit and coverage (PR body evidence, change is config-plus-one-test-file) |
| Not re-run | real gitleaks v8.30.1 image (no Docker). Replaced by the static proof in §3 |

Note for the record: lane A's gitleaks step reads `.gitleaks.toml` from the BASE ref, so its green does not exercise the new config. The developer's local pinned-image runs are the only real-binary evidence for the new config. I rely on them and add an independent static proof in §3.

## 2. Mutation results (18 mutants, extract copy, `sec-static` suite)

| Mutant | Outcome |
|---|---|
| Allowlist block restored verbatim | KILLED |
| Restored with a different `description` | KILLED |
| Restored with `paths` = `^docs/03-architecture/api/.*$` | KILLED |
| Restored with unanchored `openapi\.yaml$` | KILLED |
| Restored with `paths` = `^docs/` | KILLED |
| Restored with a two-entry `paths` array | KILLED |
| Global `[allowlist]` for `openapi.yaml` | KILLED (AT-US-048-04) |
| `[[rules]]` + `[[rules.allowlists]]` scoped to `openapi.yaml` | SURVIVED (N2) |
| `ignore` entry removed | KILLED |
| `update-types` changed to `semver-minor` | KILLED |
| `update-types` line dropped (ignores every version) | KILLED |
| `dependency-name` changed to `typescript-eslint` | KILLED |
| Double-quoted `update-types` | KILLED (N3: format-brittle) |
| Block-list style `update-types` | KILLED (N3: format-brittle) |
| One cooldown removed / changed to 3 days | KILLED / KILLED |
| `@platform/*` ignore removed | SURVIVED (out of this PR's scope; pre-existing, untested) |
| `typescript` ignore moved from the npm entry to the github-actions entry | SURVIVED (N1) |

AT-US-048-04 is still meaningful with one allowlist: it asserts `useDefault`, no global `[allowlist]`, `allowlists.length > 0`, `condition = "AND"`, non-empty `paths` and `regexes`, and that neither the paths nor the regexes admit an AWS-key-shaped value or `apps/api/src/config.ts`. The remaining agent-docs block satisfies all of it.

## 3. Focus items

- **Dependabot syntax.** `ignore: [{dependency-name: typescript, update-types: ['version-update:semver-major']}]` is valid v2 syntax. It sits in the npm entry beside `cooldown` and `groups`. Ignore conditions are applied before grouping, so no separate TS 7 PR appears. The group `update-types: [minor, patch]` could not have captured a major anyway, so the two do not conflict. Cooldown is orthogonal. The exact `typescript: 6.0.3` pin in `package.json` and typescript-eslint's `<6.1.0` peer mean no in-range minor exists, so the comment "minor and patch still flow through the group" is harmless. Scope is right: PRs #15/#16/#22 untouched; other majors deliberately not ignored (ADR-0001 line 37 pins exact versions but only TS has a stated deferral).
- **Nothing else weakened in `.gitleaks.toml`.** The diff removes only the OpenAPI block and its comment, and adds a 2-line explanatory comment. `[extend] useDefault = true`, the agent-docs allowlist (path AND line scoped), `condition = "AND"` and `regexTarget = "line"` are byte-identical.
- **Does removal expose anything in contract content that open PRs will re-scan?** Static proof, independent of the developer's binary runs. Lane A scans `--diff-merges=first-parent` over `base..head`, so only added lines matter. The removed block could suppress only lines of three shapes (`*token|proof: <value>`, `share_path: /q#...`, `client_secret: pi_...`). For every commit in the open ranges that touches `openapi.yaml`, I took the added lines of `git diff <c>^1 <c>` and counted those matching the old shapes without `EXAMPLE`: PR #24 `d98060c` (5 added) = 0; PR #23 merges `055d373` (17 added) = 0 and `c0b1b31` (4 added) = 0; PR #20 has no `openapi.yaml` commit in its first-parent range. So no open range newly relies on the removed allowlist. This matches the developer's statement that only #24 (prose) touches the contract, plus the two PR #23 merge-of-main commits, which only bring the already-marked values.
- **Current contract on `origin/main` (3a51f79).** 17 lines match the old token/proof shape: 14 contain `EXAMPLE`, 3 are `test_token: null|mock_ok|mock_cvc_fail` (short, low-entropy, not secret-shaped). `share_path` and `client_secret` examples are `EXAMPLE_` markers. Zero hits for JWT, `ghp_`, `sk_live`, AWS key or PEM shapes. Consistent with the developer's "0 findings in git mode" and the security record's emulation.
- **Evidence honesty.** The history-wide result (17 = 15 historic contract commits + 2 pre-existing prose literals in docs commit 63accea) is correctly characterised: ranges never re-scan merged history, and the 2 pre-existing hits are independent of this PR and already flagged. Not a gate on this PR.

## 4. Findings

| ID | Severity | Location | Issue | Required fix |
|---|---|---|---|---|
| N1 | NIT | `tools/ci/sec-static.test.ts` (D-ORCH-027 case) | The regex over the whole `dependabot.yml` text also matches an `ignore` entry placed under the github-actions ecosystem (mutant survives), where it would do nothing for `typescript`. | Parse with the `yaml` package (already in the tree) and assert on the `package-ecosystem: npm` entry's `ignore`, `cooldown` and `groups`; this also removes the single-quote, indentation and flow-list formatting dependence (N3). |
| N2 | NIT | `tools/ci/sec-static.test.ts` PR10-SEC-08 case (and pre-existing AT-US-048-04) | Only `[[allowlists]]` tables are inspected. A `[[rules]]`/`[[rules.allowlists]]` override or a rule `path` allowlist for `openapi.yaml` would pass both cases. Config is base-ref-read, so a PR cannot add it to itself, but a later reviewed PR could. | Add an assertion that `.gitleaks.toml` contains no `[[rules]]` / `[[rules.allowlists]]` / `[allowlist]` tables (or that `openapi.yaml` appears nowhere except in the explanatory comment). Can be a follow-up with the next gitleaks-config touch. |
| N3 | NIT | `tools/ci/sec-static.test.ts` | `toHaveLength(2)` on the cooldown count will go red when TASK-014/017 add `docker`/`terraform` ecosystems (the file header says they are coming), and the `ignore` regex is quote-style-sensitive. | Count `package-ecosystem:` occurrences and require the same number of 7-day cooldowns, or fold into the parsed assertion in N1. |
| N4 | NIT | `docs/05-quality/security/` | `.github/`, `.gitleaks.toml` and `tools/ci/` changes make the lane A security-owned-paths gate red until the security review record lands (known, stated in the PR body). | Merge condition below. |

No BLOCKER, MAJOR or MINOR findings.

## 5. Deviation rulings

None needed. The change implements option A of PR21 security §5.1 exactly (delete the whole first block, keep the agent-docs block, add the `paths`-vs-contract test) and the D-ORCH-027 (3) Dependabot rule.

## 6. Follow-up closure

- PR10-SEC-08, allowlist side: closes on merge (the finding also closes on the contract side per PR #21 security). security-analyst to mark it closed in its PR #25 record.
- N2 can ride with the next `.gitleaks.toml` change; N1/N3 may be folded into this PR's next push or a later CI-test touch. None blocks.

## 7. Merge conditions

1. security-analyst PR #25 record committed so the "security-owned paths" step turns green on the final head (N4).
2. If the branch is updated (merge of main), only docs changed on main since `c3ff7f1` (`git diff --name-only 20a0fc6~1 origin/main -- .gitleaks.toml .github tools/ci` is empty), so a merge-only delta is trivially a pure union; re-confirm by SHA if it happens.
3. Squash-merge as usual; no force push.

GOOD: Minimal, surgical diff; explanatory comment states the invariant ("deliberately no allowlist") next to the config; the new test asserts the property (no `paths` entry admits the contract) rather than just the textual absence, and also pins the description; the Dependabot comment cites ADR-0001 and states the exit path (superseding ADR, reviewed task PR); developer evidence includes a positive control and a clear separation of the 15 historic hits.

SECURITY-FLAGS: (for security-analyst) confirm the real-binary evidence for the new config (lane A reads the base config, so it did not exercise it); note `test_token: mock_ok|mock_cvc_fail` in the contract as non-secret test inputs; N2 (rule-level allowlist gap, pre-existing); the 2 pre-existing prose literals in docs commit 63accea remain as already flagged.
