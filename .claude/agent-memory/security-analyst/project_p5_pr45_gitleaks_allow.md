---
name: project-p5-pr45-gitleaks-allow
description: PR #45 (D-ORCH-068 commit-bound gitleaks allow-list for PR #39 dd7a2dd) R1 @66ae5c1 PASS_WITH_FOLLOW-UPS; D-SEC-PR45-01 second false-positive class (clarifies D-SEC-PR25-01); PR45-SEC-01 LOW pin gaps incl. [extend] disabledRules; gitleaks line-target facts; PR #39 delta checks
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0045-gitleaks-allow-security-review.md`, written uncommitted into worktree `Shipqube-GLALLOW` on 2026-11-14 (LF, ~337 lines). R1 head `66ae5c14ea137d4a341d8db08db1c556e91c57c6`: **PASS_WITH_FOLLOW-UPS**. Code-review twin on main: `docs/05-quality/reviews/PR-0045-gitleaks-allow-code-review.md` (APPROVED_WITH_NITS; R1-m1 value class unpinned, R1-m2 oracle requires paths/regexes, R1-m3 retirement, R1-n1 "never matches" wording).

**D-SEC-PR45-01 (proposed, orchestrator logs it).** D-SEC-PR25-01 is clarified, not reversed: history hits on main stay baseline-only, and path-only/commit-only/path+line entries stay forbidden. Second class allowed only for a NON-credential false positive in an already-pushed PR commit:
1. Provenance proof, value never quoted.
2. One `[[allowlists]]` table: AND, `regexTarget = "line"`, one full 40-hex `commits`, one `targetRules`, one anchored path, `^\n?<exact line>$` with a constrained value class.
3. A fingerprint comment.
4. A sec-static pin change.
5. A real-image before/after with other-commit/path controls.
6. Its own PR to main with a record.
7. The affected PR removes the text before it merges.

Real credentials: never (incident, rotate). Lifetime: keep; remove only after a squash merge/close AND not an ancestor of main.

**Findings.**
- **PR45-SEC-01 (LOW, TASK-015 or the PR #45 fix cycle, due before the next `.gitleaks.toml` change / G3).** sec-static stays green with:
  - `[extend] disabledRules = ["generic-api-key"]` (the real image then reports 0);
  - PR1-SEC-11 paths widened;
  - the entry's value class widened;
  - a basic-string `commits = ["…"]`, which skips the guard.

  Fix: an exact parsed-config pin (`[extend]` keys = `useDefault = true` only; a per-description key/literal map).
- **PR45-SEC-02 (INFO).** The PR #39 delta round must show:
  - the final head carries `756d505` (0 quoted `effect/` strings);
  - a new `pull_request` event after #45 merges;
  - a range scan with the merged config = 0.

  No squash requirement: a merge-commit landing is also covered, because gitleaks-full reads the same config.

**Facts (real image v8.30.1, probe-confirmed 2026-11-14).**
- **Git-mode line target.** The `Line` handed to `regexTarget = "line"` starts at the PREVIOUS newline, so it carries a leading `\n` except on the first added line of a hunk. A bare `^…$` matches only first-in-hunk lines.
- **Commit binding is exact.** The same lines in other commits stay reported.
- **`targetRules`** scopes an entry to the named rule.
- **`[extend] disabledRules` is honoured.**
- **Squash merges** keep PR commits out of main's ancestry.
- **The two values** equal effect 3.20.0 `IntervalSymbolKey`/`IntervalsSymbolKey` (`Symbol.for` keys; tarball sha512 = lockfile integrity).

**Probe kit (session scratch `review/PR-45-sec/`, may vanish).**
- `scan.sh`: lock loop with owner file, `--mount` binds, `--pull=never`, JSON report to `out/`, `summarise.mjs` prints rule/commit/line only.
- `prep.mjs`: probe repo with exact lines mid-hunk, first-in-hunk and 6 near-miss variants, plus config variants (path moved, commit removed).
- `mutants.mjs`: real sec-static Jest on a `git archive` extract.
- `record-sim.mjs`: 10 cases.

**How to apply:**
- PR #39 delta round: the PR45-SEC-02 checks above.
- Any future commit-bound entry: hold it to the 7 conditions.
- TASK-015 / the next `.gitleaks.toml` PR: verify the PR45-SEC-01 mutants G1/G2/G3 turn red.

Related: [[project-p5-pr25-ci-followups]], [[project-p5-pr39-task014-images]], [[project-p5-pr33-lane-a-hardening]], [[project-security-review-conventions]]
