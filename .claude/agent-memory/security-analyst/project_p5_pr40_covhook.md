---
name: project-p5-pr40-covhook
description: PR #40 (TASK-015 merged-coverage hook) R1 @2b651f7 + delta R2 @e8f4461 PASS_WITH_FOLLOW-UPS; SEC-01..04 closed; new LOW 07 (space in name), LOW 09 (probe temp Jest), INFO 08; 05/06 open; probe kit and facts
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0040-TASK-015-covhook-security-review.md` in worktree `Shipqube-COVHOOK` (LF; R1 lines 1-218, R2 appended to 419 lines, uncommitted when handed back 2026-11-14). Code review twin R2 (APPROVED_WITH_NITS) landed on main at `f155a0e` mid-round.

**R1 @2b651f7 (D-SEC-PR40-01):** PR33-SEC-06 closed; LOW 01 (.gitattributes blinds diff gate), INFO 02-06.

**R2 delta @e8f4461 (proposed D-SEC-PR40-02): PASS_WITH_FOLLOW-UPS.** Fix cycle 1 + union with PR #38 (merges 0b7ce90/08637c8/bc97720 all equal `git merge-tree` re-derivation; code final at 08637c8). CLOSED 01 (`--text --no-textconv --src/dst-prefix`, Binary-files throw, CODEOWNERS `/.gitattributes` + `**/.gitattributes`), 02 (exact name + classname = suite for `coverage gate:` IDs; reserved-prefix decoys rejected), 03 (per-project ran-own-file via Jest JSON `testResults`), 04 (fold case on win32 only, duplicate folded keys throw).
- **New LOW 07:** git appends a TAB to `+++ b/<name>` when the name has a space; `parseUnifiedDiff` keys `name\t`, `isCoverageScoped` rejects it, gate PASSES (pre-existing parser, both copies). Also C-quoted names on Linux. Fix: strip TAB, refuse `"`, cross-check `--name-only -z`. devops before G3.
- **New INFO 08:** `GIT_LITERAL_PATHSPECS=1` empties the new `:(glob)**/*.ts` pathspec (exit 0, empty diff); `git --glob-pathspecs` then dies 128 (fail closed).
- **New LOW 09:** `coverage-merge-probe.mjs` runs Jest with rootDir in `mkdtemp(os.tmpdir())`; Jest resolves `jest-environment-node` from rootDir ancestors first, so `C:\node_modules` (Authenticated Users have AD on C:\) or `/tmp/node_modules` is loaded silently (probe confirmed). qa-lead before the PR40-SEC-06 G3 re-run.
- 06 confirmed by code review R2-m1 (3 of 42 TS trials above combined run, uncovered never lower) - stays INFO; G3 adds per-file whole-repo comparison and a combined-run cross-check for critical scopes within 1 pp of 95%. 05 unchanged (TASK-025).

**Facts:** check-evidence `--json` gives `{verdict, runs[{id, accepted, tampered, reasons}], problems}`; ~13 s per run on the loaded host (30 runs about 7 min, use background). Jest classname = test-file path (`lib/convert.mjs:152`), so only fabricated evidence can carry classname `unit`. `@bcoe/v8-coverage` 0.2.3 is in main's node_modules (MIT LICENSE.md plus an ISC LICENSE.txt). Record owned set vs main = 22 paths; a later main merge voids the record only via package.json, CODEOWNERS, check-workflow-policy(.test).

**Kit (session scratch `review/PR-40-sec-r2/probes`):** `diffprobe.mjs` (19 variants x impl dirs), `mut.mjs` (unique replace), `vmatrix.mjs`/`vmatrix2.mjs` (plumbing scenarios x verifier copies, reason categories), `mergeprobe.mjs`, `portdiff.mjs` (port vs library + wrong-merge control), `searchpath.mjs` (planted ancestor package via TEMP), `recordsim.mjs` (15 scenarios incl. nested .gitattributes and moved-main merges), `hostscan.mjs`/`filescan2.mjs`, `junction.mjs`.

Related: [[project-p5-pr33-lane-a-hardening]], [[project-p5-pr23-lane-b]], [[project-p5-pr38-020b]], [[project-security-review-conventions]]
