---
name: project-p5-pr28-w0act1
description: PR #28 (W0-ACT-1 suite activation, qa-lead) R1 @22c6461 (tip d3f2b6d docs-only) PASS_WITH_FOLLOW-UPS; activation semantics probe-confirmed; PR28-SEC-01..04 (2 LOW, 2 INFO); staleness pattern .claude/agent-memory/*/*.md; checks owed at the staleness PR, Wave-0-exit, G3
metadata:
  type: project
---

PR #28 review: `docs/05-quality/security/PR-0028-W0-ACT-1-security-review.md` (R1, 2026-11-13).
- **Head row names `22c6461`**; the pushed tip `d3f2b6d` is docs-only after it (README, TEST-STRATEGY, removal of the superseded run `0616Z_629a84d`). Only 2 owned paths: `tools/quality/activation.test.ts`, `tools/quality/required-suites.json`. `.github`, `tools/ci`, `package.json`, the lockfile are byte-identical to the base.
- **Verdict PASS_WITH_FOLLOW-UPS.** W0-ACT-1 part of COND-PR23-2 satisfied (five suites with runners; `api` early). The rest of COND-PR23-2 stays open: Wave-0-exit activation, `v0.1.0-m0`, G3 gate transcript. PR23-SEC-03/04/05 are still due before the Wave-0-exit activation PR.

**Findings:** PR28-SEC-01 LOW (parked required cases: no expiry, no "now implemented" detection; gate-profile rule, and a NOTE only in profile pr to avoid deadlocking the owning task's own PR); PR28-SEC-02 LOW (8.3 `<FIRST6>~1` host path fragment in the committed JUnit, from a `bootstrap.test.ts:140` title built with `os.tmpdir()`; `heavy.mjs:806` scrubs only repoRoot and homedir); PR28-SEC-03 INFO (staleness PR checks); PR28-SEC-04 INFO (`min_tests: 1` ratchet at Wave-0 exit; mutation case hard-codes `lint`).

**Probe-confirmed facts:**
- Base checker on the PR: exit 0, `required []`, runs rejected as uncredited (rule 4). Head checker: accepts run `11f1877` at the evidence commit `dbfe4df`, but at `22c6461` it is stale (7 `.claude/agent-memory/*/*.md` paths).
- `required_cases_pending` is read only by `activation.test.ts`; listing an ID in both places keeps it required; a suite key typo exits 2.
- A later move of a case into pending changes `required-suites.json`, so the record is voided (sim D1).

**Staleness ruling (D-ORCH-034 (3)):** allow exactly `.claude/agent-memory/*/*.md` (four segments, `.md`, matches the 75 existing notes) as a constant in `lib/manifest.mjs`. `.claude/**` is MEDIUM, `.claude/agent-memory/**` LOW to MEDIUM; settings, agents, commands, worktrees stay non-docs. Nothing under `.claude/` is a Jest root, tsconfig reference or lint input. Optional mode guard (symlink named `.md`). `.claude/commands/` and `.claude/agent-memory/` are unowned by design; `.dockerignore` must exclude `.claude/` (TASK-014, with PR27-SEC-01).

**Why:** These items stay live until the staleness PR, the Wave-0-exit activation, the gate rule and the G3 transcript.

**How to apply:**
- **Staleness PR record (devops):** the exact pattern, the 13-case table test with a widen-the-glob mutation, an own record, and whether the same glob joins `docs-or-ci-only`.
- **Scrub fix:** `tmpdir()`, realpath and 8.3 forms in the scrub list, plus stable test titles; check the next evidence run with `evscan`.
- **Wave-0-exit activation record:** FAIL while PR23-SEC-03/04/05 are open; manifest-only plus a `pr` unit run; `min_tests` ratchet; mutation target not hard-coded.
- **G3:** `required_cases_pending` empty, gate transcript, SEC-P3-07 items 5 and 6.
- **Every later evidence commit:** the D-SEC-PR23-02 gate table until 03/04/05 merge.

Related: [[project-p5-pr23-lane-b]], [[project-p5-pr10-ci-lane]], [[project-security-review-conventions]]
