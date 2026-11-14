# Code review: PR #45, commit-bound gitleaks allow-list for PR #39 `dd7a2dd` (D-ORCH-068), round 1

Reviewer: code-reviewer (principal engineer). Head reviewed: `66ae5c1` (full SHA `66ae5c14ea137d4a341d8db08db1c556e91c57c6`, branch `ci/gitleaks-allow-pr39-dd7a2dd`). Diff base: `git diff origin/main...66ae5c1` (merge base `7d19dbb`). Commits: `77dbf70` (entry + tests), `69af354` (`^\n?` anchor fix), `66ae5c1` (lane B evidence only).

Inputs: the PR body (D-GLALLOW-01..05), D-ORCH-068, the existing sec-static gitleaks pins (AT-US-048-04, PR10-SEC-08, PR25-SEC-01/02), and the evidence run `docs/05-quality/tests/runs/20261114T0634Z_69af354/`.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The entry is correct and as narrow as gitleaks allows: one full SHA, one rule, one anchored path, two anchored
  full-line patterns. Against the real commit its regexes match exactly lines 272 and 273 of that file (no other line of the
  file or of the commit's 14 added lines), and lane A on the head ran the Gitleaks step green. 18/18 sec-static pass.
  No BLOCKER or MAJOR. Three MINORs: the regex sources are not pinned, so some widenings survive the suite and contradict the
  D-GLALLOW-05 claim; the test oracle is stricter than gitleaks when `paths` or `regexes` are absent; there is no retirement
  trigger. Four NITs.
```

## 1. What I verified myself (and what I did not)

Method: the review worktree (read-only), Node 24, no Docker, no installs, no full suites. Probe scripts were written to the session scratchpad. They print only booleans, counts and line numbers, never the flagged values. `git status` in the worktree is clean.

| Check | Result |
|---|---|
| `tools/ci/sec-static.test.ts` run positionally (jest, `--experimental-vm-modules`) | 18 / 18 pass (2.4 s) |
| Prettier `--check` on the changed `.ts` | clean |
| Lane A run 43567874884 on `66ae5c1` | `fast-lane` SUCCESS. `scans`: base-ref config step, **Gitleaks (PR commit range)**, Semgrep and oasdiff all SUCCESS. It fails only at "Security-owned paths need a review record" (3 owned paths, no PR-0045 record yet), and `ci-gate` fails for that reason alone. This is expected until the security record lands |
| Lane B evidence `20261114T0634Z_69af354` | `summary.json` verdict PASS, profile `pr`: unit 4458, 0 failures. `git diff --name-only 69af354 66ae5c1` contains only the four files of that run directory, so the evidence covers the final code |
| Entry vs the real commit (`git show dd7a2dd:tools/docker/scan-image-secrets.mjs`) | No CR in the file. Line 272 matches regex 1 only and line 273 matches regex 2 only, both bare and with a leading `\n`. Over the **whole file**, the only matching lines are [272, 273]. Of the commit's 14 added lines for that path, 2 match. `dd7a2dd` is the only commit in PR #39's pushed range (`origin/main..origin/feat/TASK-014-…`) that adds an `"effect/` string. The pushed tip still carries 2; the local follow-up `756d505` (a descendant of `dd7a2dd`) carries 0, so a squash of PR #39 will not reintroduce the values |
| Gitleaks semantics (reasoned against v8 `[[allowlists]]`): `condition = "AND"` requires every *present* check; `targetRules` attaches the entry to the named rule only; `commits` is an exact SHA match; `regexes` are OR'd within the entry; `regexTarget = "line"` uses `finding.Line`, which starts at the previous newline (none for the first line of a fragment). That is why the `\n?` is optional, and this is right | consistent with the author's real-image controls in the PR body (other commit, other path, other rule, single regex, parent SHA: all still reported). I did not re-run the image (no Docker under the light-commands brief) |
| RE2 vs JS regex dialect for the two sources (`^`, `$` without `m`, `\n`, `\(`, `\.`, `{1,32}`, backticks) | same semantics in both. JS `$` without `m` does not match before a trailing newline, and neither does RE2 |
| Mutation probe of the two new tests (their logic copied into a scratch script and applied to mutated `.gitleaks.toml` text, 3 runs, all stable) | see §1.1 |

### 1.1 Mutation results (suite = description pin, AND/line loop, commit-bound guard, exact pins, positives, 13 controls)

| Mutant | Caught by |
|---|---|
| `^\n?[^\n]*$` replacing the line-272 pattern | control ("api key assignment"); the guard lets it through |
| `^\n?(?:.*)$` replacing the line-272 pattern | control; the guard lets it through |
| indent `  ` → `\s*` / `\s{0,8}` on 272 | control ("re-indented") |
| second regex widened to `^\n?\s*//.*$` | control |
| line-273 pattern dropped | `toHaveLength(2)` pin |
| `commits` line removed | exact commit pin (the guard is skipped for blocks without `commits`) |
| `targetRules` widened to two rules | guard |
| the six in-test mutations (`dropRule`, `shortSha`, `unanchoredPath`, `twoCommits`, `unanchoredLine`, `openEndedLine`) | guard, and each asserts `mutated !== entry`, so none is vacuous |
| **value class `effect/[A-Za-z]{1,32}` → `effect/[^"]*`** | **SURVIVES** |
| **value class → `effect/[\w/.-]{1,200}`** | **SURVIVES** |
| **line-273 tail `copies\.$` → `copies\.(?:.*)$`** | **SURVIVES** (the "secret appended" control exists only for line 272) |

Probe pitfall noted for the record: a string `String.replace` replacement that contains `$'''` expands `$'` ("text after match"). The first probe run produced garbage mutants that a pin happened to catch. I re-ran them with function replacers; the table shows the corrected results.

## 2. Findings

| ID | Severity | Location | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `tools/ci/sec-static.test.ts:207` (and the guard at `:181-191`) | The regex **sources** are pinned only by count (`toHaveLength(2)`). The guard checks the `^\n?` prefix, that the next character is not `.`, and the `$` suffix, so it lets through `(?:.*)$`, `[^\n]*$` and value-class widenings. Three widenings survive the whole suite (§1.1). That contradicts D-GLALLOW-05 ("any new or widened allowlist changes a test"). Real exposure is nil today, because `dd7a2dd` is immutable and only two of its lines match. The pin exists to force a review of future edits, though, and it does not force one here. | Pin the two sources exactly. They are value-free, so pinning them quotes nothing flagged: `expect(literals(entry, 'regexes')).toEqual(['^\\n?  // effect 3\\.20\\.0 …$', '^\\n?  // \`IntervalsSymbolKey …\\.$'])`. Optionally add the "secret appended" control for line 273 as well (`at(\`${line273(effectNamespaced())} token = ${awsKeyShaped()}\`)`). Either change kills all three survivors. Then either tone the guard's JSDoc down to "anchored" or make it reject a wildcard immediately after `^\n?` or immediately before `$`. |
| R1-m2 | MINOR | `tools/ci/sec-static.test.ts:54-62` | The oracle `allowedBy` is documented as "every **present** check must hold", but it requires `paths` and `regexes` (`[].some(...)` is `false`). Gitleaks skips an absent check. So for an entry without `paths` (or without `regexes`) the model says *not allowed* where gitleaks says *allowed*: the oracle fails open in the direction that makes negative controls pass. Today the positives, AT-US-048-04 and the guard catch every such mutant, but only together. The oracle is the reusable piece of this PR, and it is wrong for the general case. | `(paths.length === 0 \|\| paths.some(...)) && (regexes.length === 0 \|\| regexes.some(...))`, mirroring `commits`. Add one self-test: a synthetic block with no `paths` admits a finding at any path. |
| R1-m3 | MINOR | `.gitleaks.toml:32-35` (entry comment) | No retirement trigger. Main is squash-merged in practice (for example `74385a1`, `1735719` and `263b790` each have a single parent), so once PR #39 squash-merges or closes, `dd7a2dd` is in no lane A range and not in the gate-SHA ancestry that gitleaks-full scans. The entry then becomes dead weight, and the description pin keeps it there. The repo also allows merge commits (`allow_merge_commit: true`). If PR #39 lands that way, `dd7a2dd` enters main's history and the entry must stay **permanently** (the full-history scan reads the same file). | Add one line to the entry comment, such as "Retire after PR #39 squash-merges or closes; permanent if it merges with a merge commit". The orchestrator should track the removal as a follow-up on PR #39's merge (or require squash for PR #39). |
| R1-n1 | NIT | `.gitleaks.toml:16-17` | The wording "a bare `^<line>$` never matches" is too strong. The line target starts at the previous newline, and the first line of a scanned fragment has none, so a bare pattern does match there. That is exactly why `\n?` is optional and not `\n`. The verification covered these two lines only. | Say "…includes the preceding newline (absent only on the first line of a fragment), so a full-line pattern is written `^\n?<exact line>$`." The same applies to the JSDoc at `sec-static.test.ts:177-179`. |
| R1-n2 | NIT | `tools/ci/sec-static.test.ts:194, 203` (D-GLALLOW-05 maintainability) | The test title hard-codes "exactly the two", and the entry under test is chosen by position (`allowlists[1]`). A third entry, or a reorder, forces edits to the title and to the index, and points the per-entry pins at the wrong block. | Select by description (`allowlists.find((b) => b.includes('description = "D-ORCH-068 '))`) and drop the count from the title ("…holds exactly the reviewed allowlists…"). Keep the description-list `toEqual`: it is the right tripwire. When a second commit-bound entry arrives, make the per-entry pins and controls table-driven instead of copying the ~80 lines. |
| R1-n3 | NIT | `tools/ci/sec-static.test.ts:177` | "Why a commit-bound block is not exact" reads oddly for a function that returns violation reasons. | "Reasons a commit-bound block is not exact (empty = conforming): …". |
| R1-n4 | NIT | `tools/ci/sec-static.test.ts:241` | The control is labelled "the follow-up commit" but uses `'f'.repeat(40)`, not the follow-up SHA. Behaviour is the same; the label overstates. | Rename it to "same line, another full SHA", or use the parent SHA `8a31d1f…` (the author's image control used the parent). |

## 3. Deviation and decision rulings (code-review view; security rulings belong to security-analyst)

- **D-GLALLOW-01 (mechanism):** sound engineering. This change leaves lane A's mount set and flags untouched (the PR25-SEC-01 pin still holds), and the PR cannot widen its own scan, because lane A reads the base-ref config. Whether it conflicts with D-SEC-PR25-01 ("never a path/commit allowlist") is a **security ruling**; see the flags below. The narrowing in both headers ("never a commit-only, path-only or rule-only entry") is enforced by the guard.
- **D-GLALLOW-02 (content, not line number):** correct; gitleaks allowlists cannot bind a line number. The recorded fingerprint comment is pinned. R1-m1 tightens the content binding in the test.
- **D-GLALLOW-03 (`^\n?`):** correct, and consistent with how gitleaks computes the line. Only the "never" wording is off (R1-n1).
- **D-GLALLOW-04 (baseline unchanged):** correct. The 17-fingerprint pin is untouched, and adding to the baseline would be inert for lane A.
- **D-GLALLOW-05 (description pin):** keep it. It is maintainable once the entry is selected by description (R1-n2). The claim that it catches widening is only true once R1-m1 is fixed.

## 4. Merge conditions

1. A security-analyst record `docs/05-quality/security/PR-0045-*.md` with a passing verdict on a head after which no owned path changes, so that lane A `scans`/`ci-gate` go green on the head.
2. The MINORs may be fixed in this PR or tracked: R1-m1 and R1-m2 are about five test lines; R1-m3 is one comment line plus an orchestrator follow-up. If they are fixed here, the owned paths change, so the security record must name the new head.
3. After the merge, PR #39 needs a **new** `pull_request` event (push `756d505` or any synchronize). Re-running an old run reuses the old base SHA (as the PR body says).

## 5. Good

- Binding to an immutable full SHA plus `targetRules` makes the entry practically unwidenable in effect. The author proved every condition independently with the pinned image, including bisecting the failed first attempt to the regex check alone.
- No secret-shaped literal is committed. The `effect/…` and AWS-shaped values are generated at run time, and the gitleaks step on this PR's own range is green.
- The in-test mutations assert `mutated !== entry`, so a stale `replace` cannot make a mutation vacuous.
- Thirteen negative controls, each with a readable label, report the full list of wrongly allowed labels in one assertion.

## 6. Security flags (for security-analyst)

- **SF-1:** rule on D-GLALLOW-01 against D-SEC-PR25-01. Is a commit AND path AND rule AND anchored-line entry an acceptable second class in `.gitleaks.toml`, given that lane A cannot read the baseline?
- **SF-2:** R1-m3. Decide the retirement policy, or require squash for PR #39. A merge-commit landing makes the entry permanent in the full-history config.
- **SF-3:** confirm the value-class question in R1-m1. Today it is inert (immutable commit, exactly 2 matching lines verified), but the pin should catch future widening.
