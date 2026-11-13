---
name: lane-b-evidence-run
description: Committing lane-B quality:heavy --profile pr evidence for PRs #24/#26 (2026-11-13) - scripted install+gates+lock, hostscan, check-evidence, the `;` vs `&&` push trap
metadata:
  type: feedback
---

Lane-B evidence per PR took about 25 min wall (npm ci 1.5 min, lint 1.3, unit 3, then heavy 8-11 min once docker.lock was free; waiting for another agent's lock took 11 min). Both PRs passed lane A (scans, fast-lane, ci-gate) on the first push.

**How to apply / pitfalls:**
- **One scratchpad script per PR** (`wave0/ev/run-ev.sh <worktree> <tag> <outdir>`): npm ci, deps:rebuild, lint, format, typecheck, unit, tree/exclude check, then lock wait + `quality:heavy --profile pr`, then release lock only if the owner file still holds my tag. Run it with `run_in_background`, poll `summary.txt` with `timeout 570 bash -c "until grep ..."`.
- **Do not touch the worktree while heavy runs** (clean-tree rule): copy review files or commit only after `ALL DONE`.
- **Integration already runs in band** via `tools/quality/suite-runners.json`; no extra `-i` needed.
- **Count-only host-path scan** (`wave0/ev/hostscan.mjs`, `SCAN_ROOT=$(pwd -W)`): lowercases, covers backslash, forward-slash, JSON-escaped forms, plus generic profile shapes; prints only counts per label.
- **Parked SEC-TC note** is printed by check-evidence only when a passing test carries a parked ID; with none it prints nothing (pr profile).
- **Chaining trap:** `git fetch; git merge-base --is-ancestor ...; git push` pushed although main had moved (`;` not `&&`). Main moved docs-only, so the evidence stayed valid, but gate pushes with `&&`.
- **Review record already on the branch:** when main carries the security review, the merge brings it in byte-identical; `cmp` against the main checkout before "copying" it.
- **Merging main after the evidence commit** (docs-only main delta) keeps the evidence valid: prove with `git diff <evidence commit> HEAD -- . ':!docs' ':!.claude'` empty, then re-run check-evidence. The DECISIONS rebuild script is `wave0/ev/rebuild-decisions.mjs <wt> <PREFIX>`.

Related: [[pr24-fc1-lessons]], [[pr26-fc1-lessons]], [[p5-dispatch]]
