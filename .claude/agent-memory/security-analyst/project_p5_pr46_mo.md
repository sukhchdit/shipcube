---
name: project-p5-pr46-mo
description: PR #46 merge-only round @0230e50 (union with #39/#48 against R3.9) PASS_WITH_FOLLOW-UPS; new INFO PR46-SEC-17 (RANGE_BASE = pull_request.base.sha is the MERGE BASE, not main's tip); live-binding prediction; 24 h proof deadline; kit
metadata:
  type: project
---

Section "Merge-only round (union with #39/#48, head 0230e50)" (MO.1-MO.13) appended uncommitted to `docs/05-quality/security/PR-0046-TASK-015B-security-review.md` in worktree `Shipqube-TASK-015B` on 2026-11-15. LF, 1144 lines. Head row `0230e50f67dd…`; proposed D-SEC-PR46-04.

**Verdict PASS_WITH_FOLLOW-UPS, 1 new INFO.**

Union purity:
- `f981713`'s tree `124180a` equals `merge-tree a351dbc 78cd2a4`.
- The brief and PR body say `merge-tree 4bbce92 78cd2a4`. That gives `969de83`, which differs only by the r3 record. This is a wording point.
- Five both-sides files, each delta-equivalent both ways.
- `REQUIRED_CODEOWNED_PATHS` has 60 entries: 45 old plus 15 from #39 (#46 and #48 added none).

**Key fact (verified live): `github.event.pull_request.base.sha` is the merge base, not main's tip.**
- Run 43726593786 had `RANGE_BASE` 78cd2a4.
- Its test merge `731eb7d` had parents [dbfb1bd = main tip, 0230e50]. Main reached dbfb1bd at 14:46:57Z, before the 14:50:59Z branch push (repos/…/activity API).
- So base-ref gate tooling lags main until the PR unions it. This is PR46-SEC-17: INFO, CWE-693, A08.
- Fix in TASK-286 together with -16: `TOOLS_REF=$(git rev-parse HEAD^1)` on pull_request runs, published as the tested base.
- R3.10's "base-ref gates run against 8c65315" was wrong in principle (it would have been 5d2c102). Corrected in MO.6.

**Prediction for the record push** (sim with real GET API, both bases 78cd2a4 and bf8b866):
- light;
- identical = record, 0230e50, f981713;
- `code_proof=43726593786:0230e50…`, no note;
- 6 API calls: 3 runs lists, pulls, 1 events page (13 referenced, no base_ref_changed), jobs;
- security_integration_due=true; suites catalog-c1-c14 + rls-cross-tenant;
- MERGE-READY if green.

**Merge conditions handed over:**
- the PR46-SEC-11 24 h rule: merge by 2026-11-16 14:51Z, or a fresh full run;
- P1: main docs-only since dbfb1bd.

PR #52 (3eafa74) merged before the proof run. The run tested it, so -16 was not live.

**Kit** (session scratch `mo46/`, may vanish):
- `record-sim-mo.mjs`: 14 scenarios plus row check plus `--lookup` with gh retries.
- `mut.mjs`: 9 policy cases.
- `hostscan.mjs`: 17 needles.
- `gl-shape.mjs`: the generic-api-key shape.

**Gotchas:**
- The sim's `show()` trims stdout, so `show()+'\n'` is a no-op edit. A J scenario passed falsely until fixed; assert that the diff is non-empty.
- A pipe inside backticks in a table cell breaks GFM tables. Avoid regex alternations in cells.
- A Bash heredoc mangles backslashes in JS regexes again. Use the Write tool for scripts.

Related: [[project-p5-pr46-r3]], [[project-p5-pr46-r2]], [[project-p5-pr39-mo]], [[project-security-review-conventions]]
