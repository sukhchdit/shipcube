---
name: wave0-sheet-fold9-rulings
description: Context behind Wave-0 sheet-fold-9 (D-ARCH-139..147, rulings/wave-0-sheet-fold-9.md, 2026-11-17) — security-integration trigger list widened and the card DoD line derived from the classifier (gen.mjs imports it), TASK-287 part order 287-A/B/C, capture follow-through owners (TASK-028/041/052/060/030/040/033), PR54-SEC-02 (b)(c) on TASK-030, TASK-291 flake3 (batch 0.13), shared hot-file locks (D-ORCH-118); shared-checkout and tooling lessons
metadata:
  type: project
---

Fold 9 (docs/plan only; committed and pushed by me this time): ADR-0023 am. N (5 items), platform.md §7.2 notes, plan-data (17 blocks, 1 late task, `sharedFileLocks`), gen.mjs (2 changes), regenerated CSV + all WAVE files (291 tasks, 0 errors; Wave 0 = 46 tasks, 13 batches). CSV diff: `refs` 15 rows, `depends_on` TASK-049 ← TASK-028, new row TASK-291. Earlier folds: [[wave0-sheet-fold8-rulings]], [[wave0-ci-minutes-rulings]].

**Non-obvious outcomes to defend:**
- **A plan is not a diff (D-ARCH-139).** The DoD line "security-integration runs" was generated from planned files; TASK-288 planned `prisma/tests/harness`, did not touch it, and the PR body repeated the promise. Fix = gen.mjs IMPORTS `SECURITY_INTEGRATION_PATHS`/`globsMatch` from `tools/ci/security-paths.mjs` (never a copy, so a card cannot be ahead of the classifier) AND the line is conditional with both outcomes. After TASK-287 part 287-A merges, a generator re-run adds four cards. The list stays narrower than `security_critical_paths` (tools/ci, tools/quality, .github gate, they do not change what the suites exercise).
- **TASK-287 needs an order (D-ARCH-140):** 287-A policy PR → 287-B one-line workflow PR (`HEAD == $GITHUB_SHA`) → 287-C incremental lane; A/B before ANY other `.github/workflows/**` PR (015-C, Dependabot actions) or D-ORCH-116 applies. Policy first because the tested base's policy judges the PR.
- **First audited module route = TASK-049 register, not TASK-026** (`listCountries` is public, audit none) → edge TASK-049 ← TASK-028. TASK-028/029 share batch 0.8, so their order is a PRECONDITION line (no edge possible) and TASK-029 does not list app.ts/start-api.ts/pipeline.ts.
- **T-39 (D-ARCH-142):** aggregated entry written AT THE CROSSING (nothing runs at window end; a job needs the worker audit port, TASK-047, later); count carried lazily; security-analyst still has to confirm the shape.
- **Orphans given to TASK-060:** PR56-SEC-07 target organisation (`auditTargetOrgId`, mount refusal) and the PR56-SEC-13 capture change. Open findings in security suites are PINNED (`[… OPEN]` test of current behaviour), never skipped (manifest rule skipped = 0).
- **PR54-SEC-02 (b)(c) rides TASK-030** (existing edge to TASK-073) instead of a late task — the CI-minutes forecast was over the allowance, so no extra PR for a list of names.
- **W0-FLAKE-3 = TASK-291 `flake3`, batch 0.13:** transport + shrink-only allow-list (ratchet) instead of a sweep (a sweep needs every platform lock). React Router 8.5.1 exposes ONLY `prerender.concurrency`; timeout 10 s / retryCount 0 are internal → product build stays un-retried; the only allowed retry is in `tools/quality/heavy.mjs`, no summary.json schema change.
- **Shared hot files (D-ARCH-147, D-ORCH-118):** `sharedFileLocks` in plan-data (api-tenant-db, api-tx-execute, api-platform-core, api-routing, lint); gen.mjs fails when a card's `f` names one without the lock; dispatch rule = no task starts while an in-flight task of ANY batch holds one of its locks.
- **Still open:** the capture seam for old/new values, reason and `additional[]` (TASK-031) needs a ruling before dispatch; `.npmrc` and `apps/worker/src/platform/**` on the trigger list (security-analyst); CI-minutes options O2a/O4a/O4b (not touched, D-ORCH-117/119).

**plan-data key map additions:** flake3=291, logging=010, rls=016, redact=028, capture=029, chain=030, diffs=031, auditgen=033, idem=040, ratelimit=041, jobctx=047, register=049, signin=052, authzmw=060, auditapi=073, admitcls=284, fastlaneinc=287.

**Process lessons:**
1. **The orchestrator commits on `main` in the SAME checkout while a fold runs.** My uncommitted DECISIONS.md append was swept into its commit (e1cbf53). Append to DECISIONS.md only in the same step as my own commit, and before any re-append diff the intended text against HEAD.
2. **`main` moves during a fold** (PR #59 merged, TASK-287 dispatched, D-TASK289-06 made a lock unnecessary, PR56-SEC-14 closed). Re-read the DECISIONS tail right before writing the ruling and again before committing.
3. **Write scratch scripts with the Write tool, not Bash heredocs:** the heredoc path lost `\\` (a `'\\'` literal became `'\'`). Use `String.fromCharCode(92)` for backslash and `fromCharCode(39)` for the quote in the applier.
4. **`MSYS_NO_PATHCONV=1` breaks node `spawn` with a POSIX `cwd`:** pass `C:/…` paths to scripts that shell out to git.
5. Toolkit that worked (rebuild from this description): `apply2.mjs` (quote-aware `fieldArray`, `appendItems`, `replaceItem`, `appendTask`), `subst.mjs` (exact once-replacements from a pairs file), `verify.mjs` (import both versions, per-field diff), `csvdiff.mjs`, `dups.mjs`, plus a negative test of each new generator check in a scratch copy.
6. Angle-bracket placeholders with spaces in card text render as HTML and vanish; write them out in words.
